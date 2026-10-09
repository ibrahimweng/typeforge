/**
 * Pear drops: a teardrop sized by the face (`terminal.dropSize`), its ball
 * carried on along its axis (`dropHang`), that axis turned toward plumb on a
 * drop hanging from a curve above it (`dropCurl`), and its neck leaving the
 * stroke as bent as the stroke's own edge is, with its closing edge run along
 * the stroke (`dropNeck`) -- and an end's own multipliers on all of it
 * (`Terminal.pear`).
 *
 * Every measurement here is taken off the drawn letter, against the same
 * letter drawn without the field, so each fails the moment its finish stops
 * doing anything; and every letter is held to the same points at every pen
 * and width it is drawn at.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

import { ready } from "@/font/boolean";
import { contoursIntersect } from "@/font/outline";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { builtFrom, drawLetter, letterNames, makeLetter } from "./build";
import { widthedStyle } from "./family";
import { heftShift } from "./heft";
import { everyFormOf, recipeOf } from "./letters";
import { ALTERNATES } from "./letters/alternates";
import { openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { flatten, pointAt, windingAt } from "./soft";
import { DIDONE, GEOMETRIC, GROTESQUE, SANS, SERIF, SLAB, type Style } from "./style";
import { penReach } from "./sweep";
import { FOLD_WEIGHTS, foldFaces, foldSweep, withField } from "./testing/fold-sweep";
import { signatureText } from "./testing/signature";
import type { Stroke } from "./types";

/*
 * The bowls' heft, given as the style asks for it. Its package draws it, and
 * may not be in this tree yet; where `withHeft` hands a marked bowl back as it
 * was, the stroke is given its `heft` here as that package gives it -- every
 * closed spine and every stroke marked `heftable`, while `bowl.heft` is above
 * nought -- so a pear can be asked where it meets a moved inner side.
 */
vi.mock("./heft", async (importOriginal) => {
  const real = await importOriginal<typeof import("./heft")>();
  return {
    ...real,
    withHeft: (stroke: Stroke, style: Style): Stroke => {
      const made = real.withHeft(stroke, style);
      const share = style.parts.bowl.heft ?? 0;
      if (made !== stroke || !(share > 0) || !(stroke.spine.closed || stroke.heftable)) return made;
      return { ...stroke, heft: { share, tilt: style.parts.bowl.heftTilt ?? 0 } };
    },
  };
});

beforeAll(async () => {
  await ready();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];
/** The pens a text face is set at, where every drop has its room. */
const TEXT = [30, 60, 87];
/** The letters the Serif hangs a drop on: one each. */
const DROPS = "acfryj";

/** The Soft Serif's drop, as the starting face sets it. */
const PEAR = { dropSize: 0.15, dropHang: 0.3, dropCurl: 0.6, dropNeck: 1 };

type Fields = Partial<Style["parts"]["terminal"]>;

const at = (pen: number, width = 100, style: Style = SERIF): Style =>
  widthedStyle({ ...style, pen: { ...style.pen, weight: pen } }, width);
const dropped = (style: Style, fields: Fields): Style => ({
  ...style,
  parts: { ...style.parts, terminal: { ...style.parts.terminal, ...fields } },
});

/** A drop's five nodes, named, each with its handles the way `tear` lays them out. */
interface Pear {
  /** The outer corner it stands on. */
  O: GlyphNode;
  /** The tip, a radius on from the ball's centre along its axis. */
  F: GlyphNode;
  /** The ball's top, a radius in from its centre square to its axis. */
  T: GlyphNode;
  /** Where the neck meets the stroke's inner edge. */
  M: GlyphNode;
  /** The point on the spine the closing edge leaves from. */
  B: GlyphNode;
}

/**
 * A drop, told apart from every other contour of these letters by its two
 * smooth nodes side by side among three corners; drawn either way round,
 * since it is stored turning anticlockwise.
 */
function pearOf(contour: Contour): Pear | null {
  if (contour.nodes.length !== 5) return null;
  const types = contour.nodes.map((one) => (one.type === "smooth" ? "s" : "c")).join("");
  const flip = (one: GlyphNode): GlyphNode => ({
    ...one,
    handleIn: one.handleOut,
    handleOut: one.handleIn,
  });
  if (types === "csscc") {
    const [O, F, T, M, B] = contour.nodes;
    return { O, F, T, M, B };
  }
  if (types === "ccssc") {
    const [B, M, T, F, O] = contour.nodes.map(flip);
    return { O, F, T, M, B };
  }
  return null;
}

/** Each drop of a letter, with the swept stroke it hangs on. */
function pearsIn(name: string, style: Style): Array<{ pear: Pear; ink: Contour }> {
  const made = makeLetter(name, style, style.forms?.[name]);
  if (!made) throw new Error(`${name} did not draw`);
  const out: Array<{ pear: Pear; ink: Contour }> = [];
  for (const run of made.runs) {
    for (const contour of run.contours) {
      const pear = pearOf(contour);
      if (pear) out.push({ pear, ink: run.contours[0] });
    }
  }
  return out;
}

/** The one drop a letter of `DROPS` hangs. */
function onlyPear(name: string, style: Style): { pear: Pear; ink: Contour } {
  const all = pearsIn(name, style);
  if (all.length !== 1) throw new Error(`${name}: ${all.length} drops`);
  return all[0];
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const length = (a: Vec2): number => Math.hypot(a.x, a.y);
const unit = (a: Vec2): Vec2 => ({ x: a.x / length(a), y: a.y / length(a) });
const angle = (a: Vec2, b: Vec2): number =>
  Math.acos(Math.min(1, Math.max(-1, dot(unit(a), unit(b)))));

/** The ball's radius: its tip and top are a quarter circle apart. */
const ballOf = (pear: Pear): number => length(sub(pear.F.point, pear.T.point)) / Math.SQRT2;
/** The way the end was going, along which the drop leaves its outer corner. */
const headingOf = (pear: Pear): Vec2 => unit(sub(pear.O.handleOut!, pear.O.point));
/** The pear's axis, along which its top's handle reaches back toward the tip. */
const axisOf = (pear: Pear): Vec2 => unit(sub(pear.T.handleIn!, pear.T.point));
/** The ball's centre, a radius back from the tip along the axis. */
const centreOf = (pear: Pear): Vec2 => {
  const axis = axisOf(pear);
  const r = ballOf(pear);
  return { x: pear.F.point.x - axis.x * r, y: pear.F.point.y - axis.y * r };
};

/** Points along the drop's outline, `steps` to an edge. */
function outlineOf(pear: Pear, steps = 64): Vec2[] {
  const nodes = [pear.O, pear.F, pear.T, pear.M, pear.B];
  const points: Vec2[] = [];
  for (let edge = 0; edge < nodes.length; edge++) {
    const from = nodes[edge];
    const to = nodes[(edge + 1) % nodes.length];
    for (let step = 0; step < steps; step++) points.push(pointAt(from, to, step / steps));
  }
  return points;
}

type Cubic = [Vec2, Vec2, Vec2, Vec2];
const cubicOf = (from: GlyphNode, to: GlyphNode): Cubic => [
  from.point,
  from.handleOut ?? from.point,
  to.handleIn ?? to.point,
  to.point,
];
function speedOf([p0, p1, p2, p3]: Cubic, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}
function turnOf([p0, p1, p2, p3]: Cubic, t: number): Vec2 {
  return {
    x: 6 * (1 - t) * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x),
    y: 6 * (1 - t) * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y),
  };
}
/** How tightly a cubic turns at `t`: the radius of the circle it follows there. */
function radiusOf(curve: Cubic, t: number): number {
  const d = speedOf(curve, t);
  const dd = turnOf(curve, t);
  return length(d) ** 3 / Math.abs(d.x * dd.y - d.y * dd.x);
}

/** The swept stroke as a dense line of points, for measuring its edge. */
function edgePoints(ink: Contour): Vec2[] {
  const points: Vec2[] = [];
  for (let k = 0; k < ink.nodes.length; k++) {
    const from = ink.nodes[k];
    const to = ink.nodes[(k + 1) % ink.nodes.length];
    for (let step = 0; step < 400; step++) points.push(pointAt(from, to, step / 400));
  }
  return points;
}

/**
 * The radius of the stroke's edge where it passes nearest `point`: the circle
 * through the nearest point of it and the points six units either way along.
 */
function edgeRadiusAt(points: Vec2[], point: Vec2): number {
  let nearest = 0;
  points.forEach((one, k) => {
    if (length(sub(one, point)) < length(sub(points[nearest], point))) nearest = k;
  });
  const walk = (way: number): Vec2 => {
    let k = nearest;
    let gone = 0;
    while (gone < 6) {
      const next = (k + way + points.length) % points.length;
      gone += length(sub(points[next], points[k]));
      k = next;
    }
    return points[k];
  };
  const a = walk(-1);
  const b = points[nearest];
  const c = walk(1);
  const ab = sub(b, a);
  const bc = sub(c, b);
  return (length(ab) * length(bc) * length(sub(c, a))) / (2 * Math.abs(ab.x * bc.y - ab.y * bc.x));
}

/** How far a point is from the nearest of a line of points, taken as a closed polygon. */
function distanceTo(points: Vec2[], point: Vec2): number {
  let nearest = Infinity;
  for (let k = 0; k < points.length; k++) {
    const a = points[k];
    const b = points[(k + 1) % points.length];
    const ab = sub(b, a);
    const share = Math.min(1, Math.max(0, dot(sub(point, a), ab) / Math.max(dot(ab, ab), 1e-12)));
    nearest = Math.min(
      nearest,
      length(sub(point, { x: a.x + ab.x * share, y: a.y + ab.y * share })),
    );
  }
  return nearest;
}

/**
 * How deep under the stroke's own edge a drop's neck runs: the deepest of
 * sixteen points along it that lie inside the stroke, as far as the nearest
 * edge; nought where none does.
 */
function dipOf(pear: Pear, ink: Contour): number {
  const flat = flatten([ink], 48);
  const polygon = flat.polygons[0].points;
  let deepest = 0;
  for (let step = 1; step <= 16; step++) {
    const point = pointAt(pear.T, pear.M, step / 17);
    if (windingAt(flat, point) !== 0) deepest = Math.max(deepest, distanceTo(polygon, point));
  }
  return deepest;
}

describe("the drop's size", () => {
  it("grows the c's drop by three tenths at dropSize 0.3, where it has the room", () => {
    for (const pen of PENS) {
      const was = ballOf(onlyPear("c", at(pen)).pear);
      const now = ballOf(onlyPear("c", dropped(at(pen), { dropSize: 0.3 })).pear);
      // At a text weight the drop has its room; past one, the curve's room
      // or the stroke's band holds it, and it is never made smaller.
      if (TEXT.includes(pen)) expect(now / was, `c at ${pen}`).toBeGreaterThanOrEqual(1.2);
      else expect(now / was, `c at ${pen}`).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it("shrinks it below a size of nought, as far as the least that covers the end", () => {
    for (const pen of TEXT) {
      const was = ballOf(onlyPear("c", at(pen)).pear);
      const now = ballOf(onlyPear("c", dropped(at(pen), { dropSize: -0.3 })).pear);
      expect(now / was, `c at ${pen}`).toBeLessThan(0.99);
    }
  });
});

describe("the drop's hang", () => {
  /** How far past its outer corner a drop reaches along the way the end was going. */
  const reachOf = (pear: Pear): number => {
    const heading = headingOf(pear);
    return Math.max(...outlineOf(pear).map((point) => dot(sub(point, pear.O.point), heading)));
  };

  it("carries the ball on past the end by half its radius at dropHang 0.5", () => {
    const short: string[] = [];
    // The f's hook ends heading up, out of its own band: its pear has no room
    // to be carried on, and gives its hang up first (see `teardropsFor`).
    for (const name of "acryj") {
      for (const pen of [...TEXT, 142]) {
        const was = onlyPear(name, dropped(at(pen), { dropHang: 1e-9 })).pear;
        const now = onlyPear(name, dropped(at(pen), { dropHang: 0.5 })).pear;
        const carried = (reachOf(now) - reachOf(was)) / ballOf(now);
        if (carried < 0.4) short.push(`${name} at ${pen}: ${carried.toFixed(3)} r`);
      }
    }
    expect(short).toEqual([]);
  });

  it("keeps the y's and the j's tails above the descender's overshoot", () => {
    const below: string[] = [];
    for (const name of "yj") {
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const style = dropped(at(pen, width), { ...PEAR, dropHang: 1.5 });
          const { pear } = onlyPear(name, style);
          const floor = style.metrics.descender - style.metrics.overshoot - 1;
          const bottom = Math.min(...outlineOf(pear).map((point) => point.y));
          if (bottom < floor) below.push(`${name} at ${pen}/${width}: ${bottom.toFixed(1)}`);
        }
      }
    }
    expect(below).toEqual([]);
  });
});

describe("the drop's curl", () => {
  it("hangs the c's drop plumb from its ball at dropCurl 1", () => {
    for (const pen of PENS) {
      const { pear } = onlyPear("c", dropped(at(pen), { dropCurl: 1 }));
      const centre = centreOf(pear);
      const r = ballOf(pear);
      const outline = outlineOf(pear, 256);
      const lowest = outline.reduce((low, point) => (point.y < low.y ? point : low));
      // Its lowest point straight under the ball's centre, a radius down, and
      // that point the pear's tip.
      expect(Math.abs(lowest.x - centre.x), `c at ${pen}`).toBeLessThan(0.02 * r);
      expect(lowest.y, `c at ${pen}`).toBeLessThan(centre.y - 0.99 * r);
      expect(length(sub(lowest, pear.F.point)), `c at ${pen}`).toBeLessThan(0.5);
      expect(angle(axisOf(pear), { x: 0, y: -1 }), `c at ${pen}`).toBeLessThan(
        (0.5 * Math.PI) / 180,
      );
    }
  });

  it("never turns a drop more than sixty degrees, and never a tail's", () => {
    for (const name of DROPS) {
      for (const pen of PENS) {
        const { pear } = onlyPear(name, dropped(at(pen), { dropCurl: 1 }));
        const turned = angle(headingOf(pear), axisOf(pear));
        expect(turned, `${name} at ${pen}`).toBeLessThanOrEqual(Math.PI / 3 + 1e-9);
        if (name === "y" || name === "j") expect(turned, `${name} at ${pen}`).toBeLessThan(1e-6);
      }
    }
  });
});

describe("the drop's neck", () => {
  it("never bends tighter than 0.35 of the c's edge radius, at a text weight", () => {
    const tight: string[] = [];
    for (const pen of TEXT) {
      for (const width of WIDTHS) {
        const { pear, ink } = onlyPear("c", dropped(at(pen, width), PEAR));
        const edge = edgeRadiusAt(edgePoints(ink), pear.M.point);
        const neck = cubicOf(pear.T, pear.M);
        let least = Infinity;
        for (let step = 0; step <= 64; step++) least = Math.min(least, radiusOf(neck, step / 64));
        if (least < 0.35 * edge) tight.push(`c at ${pen}/${width}: ${(least / edge).toFixed(3)}`);
      }
    }
    expect(tight).toEqual([]);
  });

  /*
   * Bent as the edge it arrives on, within half as much again either way. The
   * neck arrives a little more bent than the edge, and never more bent than
   * the stroke's own inner half width: the j's tail hooks tighter than that.
   */
  it("arrives at the stroke's edge bent as the edge is, on every drop", () => {
    const off: string[] = [];
    for (const name of DROPS) {
      for (const pen of TEXT) {
        for (const width of WIDTHS) {
          const { pear, ink } = onlyPear(name, dropped(at(pen, width), PEAR));
          const edge = edgeRadiusAt(edgePoints(ink), pear.M.point);
          const neck = radiusOf(cubicOf(pear.T, pear.M), 1);
          if (!(neck <= 1.5 * edge && neck >= edge / 1.5)) {
            off.push(`${name} at ${pen}/${width}: ${(neck / edge).toFixed(3)}`);
          }
        }
      }
    }
    expect(off).toEqual([]);
  });

  it("never dips under the stroke's own edge on the way", () => {
    const dips: string[] = [];
    for (const name of DROPS) {
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          // At 142 and the narrow width the c's counter closes to a point at
          // its top that the sweep trims away, so the edge the neck is sent to
          // meet there is not the edge that is drawn: a known exception.
          if (name === "c" && pen === 142 && width === 75) continue;
          const { pear, ink } = onlyPear(name, dropped(at(pen, width), PEAR));
          const dip = dipOf(pear, ink);
          if (dip > 0.5) dips.push(`${name} at ${pen}/${width}: ${dip.toFixed(2)}`);
        }
      }
    }
    expect(dips).toEqual([]);
  });

  it("runs its closing edge along the stroke, with both handles there at every pen", () => {
    for (const name of DROPS) {
      for (const pen of PENS) {
        const { pear } = onlyPear(name, dropped(at(pen), { dropNeck: 1 }));
        expect(pear.B.handleOut, `${name} at ${pen}`).not.toBeNull();
        expect(pear.O.handleIn, `${name} at ${pen}`).not.toBeNull();
        const plain = onlyPear(name, dropped(at(pen), { dropHang: 1e-9 })).pear;
        expect(plain.B.handleOut, `${name} at ${pen}`).toBeNull();
        expect(plain.O.handleIn, `${name} at ${pen}`).toBeNull();
      }
    }
  });
});

describe("a pear on a bottom-heavy bowl", () => {
  it("meets the c's inner side where its heft moved it", () => {
    for (const pen of TEXT) {
      const style = dropped(at(pen), PEAR);
      const heavy = {
        ...style,
        parts: { ...style.parts, bowl: { ...style.parts.bowl, heft: 0.08 } },
      };
      const moved = onlyPear("c", heavy).pear.M.point;
      const { pear, ink } = onlyPear("c", style);
      // The heft's own shift, on the pen the c's bowl is drawn with (see `swollen`).
      const bowl = recipeOf("c", "humanist")!(style).strokes[0];
      const shift = heftShift({ ...bowl, heft: { share: 0.08, tilt: 0 } }, penReach(bowl.pen));
      expect(length(shift), `c at ${pen}`).toBeGreaterThan(1);
      expect(length(sub(sub(moved, pear.M.point), shift)), `c at ${pen}`).toBeLessThan(1e-6);
      // Moved back by it, the neck meets the inner side drawn without one.
      expect(distanceTo(edgePoints(ink), sub(moved, shift)), `c at ${pen}`).toBeLessThan(0.5);
    }
  });
});

describe("an end's own pear", () => {
  /*
   * A c whose ends ask for twice the face's drop, twice its hang and half its
   * curl: the form a letter's recipe would hand the hint on with. The c's top
   * is a serif's end refused on a curve, so this also asks that the hint is
   * carried across when the end is rebuilt as the face's curved terminal.
   */
  const hinted = (pear: Stroke["end"]["pear"]) => ({
    id: "pear-test",
    label: "Pear test",
    hint: "",
    build: (style: Style) => {
      const recipe = ALTERNATES.c.find((one) => one.id === "humanist")!.build(style);
      return {
        ...recipe,
        strokes: recipe.strokes.map((stroke) => ({
          ...stroke,
          start: { ...stroke.start, pear },
          end: { ...stroke.end, pear },
        })),
      };
    },
  });

  it("scales the face's size, hang and curl", () => {
    ALTERNATES.c.push(hinted({ size: 2, hang: 2, curl: 0.5 }));
    try {
      const style = dropped(at(87), { dropSize: 0.3, dropHang: 0.5, dropCurl: 0.6 });
      const plain = onlyPear("c", { ...style, forms: { ...style.forms, c: "humanist" } }).pear;
      const own = onlyPear("c", { ...style, forms: { ...style.forms, c: "pear-test" } }).pear;
      // Twice the size asked for, as far as the room it is given allows.
      expect(ballOf(own) / ballOf(plain)).toBeGreaterThan(1.1);
      // Half the turn toward plumb.
      const turned = (pear: Pear) => angle(headingOf(pear), axisOf(pear));
      expect(turned(own) / turned(plain)).toBeCloseTo(0.5, 2);
      // Carried twice as many radii on along its axis: the ball's centre stands
      // a radius in from the corner, turned with the axis, and the hang on.
      const carried = (pear: Pear) =>
        dot(sub(centreOf(pear), pear.O.point), axisOf(pear)) / ballOf(pear) -
        Math.sin(turned(pear));
      expect(carried(plain)).toBeCloseTo(0.5, 6);
      expect(carried(own)).toBeCloseTo(1, 6);
    } finally {
      ALTERNATES.c.pop();
    }
  });
});

describe("a pear at every master", () => {
  /** Each drop letter's points at every pen and width, as one line each. */
  const masters = (name: string, finish: (style: Style) => Style): Set<string> => {
    const seen = new Set<string>();
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        const style = finish(at(pen, width));
        seen.add(signatureText(drawLetter(name, style, style.forms?.[name])!.contours));
      }
    }
    return seen;
  };

  it("hangs one drop of five nodes on each letter, everywhere", () => {
    for (const name of DROPS) {
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          expect(
            pearsIn(name, dropped(at(pen, width), PEAR)),
            `${name} at ${pen}/${width}`,
          ).toHaveLength(1);
        }
      }
    }
  });

  it("keeps the same points at every pen and width", { timeout: 120_000 }, () => {
    const drift: string[] = [];
    for (const name of DROPS) {
      const plain = masters(name, (style) => style);
      for (const fields of [PEAR, { dropSize: 0.6, dropHang: 1.5, dropCurl: 1, dropNeck: 0.5 }]) {
        const pear = masters(name, (style) => dropped(style, fields));
        // The face draws each of these with one set of points, and so does its pear.
        if (plain.size !== 1 || pear.size !== 1) {
          drift.push(`${name}: ${[...plain].join(" | ")} -> ${[...pear].join(" | ")}`);
        }
      }
    }
    expect(drift).toEqual([]);
  });

  it("keeps the same points with the wave book open, as a family is exported", () => {
    const book: WaveBook = {
      lengths: new Map(),
      bowls: new Map(),
      balls: new Map(),
      corners: new Map(),
      recording: true,
    };
    const was = openWaveBook(book);
    const drift: string[] = [];
    try {
      for (const name of DROPS) {
        book.lengths.clear();
        book.bowls.clear();
        book.balls.clear();
        book.corners.clear();
        book.recording = true;
        waveBookAt(name);
        const own = dropped(SERIF, PEAR);
        const drawn = signatureText(drawLetter(name, own, own.forms?.[name])!.contours);
        book.recording = false;
        for (const pen of PENS) {
          for (const width of WIDTHS) {
            waveBookAt(name);
            const style = dropped(at(pen, width), PEAR);
            const now = signatureText(drawLetter(name, style, style.forms?.[name])!.contours);
            if (now !== drawn) drift.push(`${name} at ${pen}/${width}: ${now} against ${drawn}`);
          }
        }
      }
    } finally {
      openWaveBook(was);
    }
    expect(drift).toEqual([]);
  });

  it("folds nothing with every drop field on, at every weight, on either face", {
    timeout: 120_000,
  }, () => {
    const folded: string[] = [];
    const names = letterNames().filter((name) => !builtFrom(name));
    for (const weight of FOLD_WEIGHTS) {
      for (const [face, base] of foldFaces(weight)) {
        const style = dropped(base, PEAR);
        for (const name of names) {
          const drawn = drawLetter(name, style, style.forms?.[name]);
          if (drawn?.contours.some((contour) => contoursIntersect([contour]))) {
            folded.push(`${face} ${name} at ${weight}`);
          }
        }
      }
    }
    expect(folded).toEqual([]);
  });
});

describe("each drop field alone, at its least, middle and most", () => {
  it("folds nothing at any size", { timeout: 120_000 }, () => {
    expect(foldSweep("terminal.dropSize", [-0.3, 0.15, 0.6])).toEqual([]);
  });
  it("folds nothing at any hang", { timeout: 120_000 }, () => {
    expect(foldSweep("terminal.dropHang", [0.05, 0.75, 1.5])).toEqual([]);
  });
  it("folds nothing at any curl", { timeout: 120_000 }, () => {
    expect(foldSweep("terminal.dropCurl", [0.05, 0.5, 1])).toEqual([]);
  });
  it("folds nothing at any neck", { timeout: 120_000 }, () => {
    expect(foldSweep("terminal.dropNeck", [0.05, 0.5, 1])).toEqual([]);
  });
});

describe("the drop fields together", () => {
  /** The Soft Serif's pen on the Serif: its contrast and its angle. */
  const SOFT_PEN: Style = { ...SERIF, pen: { ...SERIF.pen, contrast: 0.7, angle: 18 } };

  /**
   * Every letter, in every form, with a contour that crosses itself drawn
   * with `fields` but not drawn without them, at each pen and width: a face's
   * own folds, which these fields do not touch, are not theirs to answer for.
   * Letters built from others (an `Aacute`) are their pieces, moved.
   */
  const newFolds = (base: Style, fields: Fields, pens: number[], widths: number[]): string[] => {
    const crosses = (style: Style, name: string, form?: string): boolean =>
      drawLetter(name, style, form)?.contours.some((contour) => contoursIntersect([contour])) ??
      false;
    const folded: string[] = [];
    for (const name of letterNames().filter((one) => !builtFrom(one))) {
      for (const { id } of everyFormOf(name)) {
        const form = id || undefined;
        for (const pen of pens) {
          for (const width of widths) {
            const plain = at(pen, width, base);
            if (crosses(dropped(plain, fields), name, form) && !crosses(plain, name, form)) {
              folded.push(`${base.name} ${name}${form ? `/${form}` : ""} at ${pen}/${width}`);
            }
          }
        }
      }
    }
    return folded;
  };

  /**
   * `foldSweep` with several fields set at once: every letter, in its default
   * form and the face's own, at the weights the controls are driven at, on
   * the Sans with serifs and the Serif.
   */
  const foldSweepTogether = (fields: Fields): string[] => {
    const folds: string[] = [];
    const names = letterNames().filter((name) => !builtFrom(name));
    for (const weight of FOLD_WEIGHTS) {
      for (const [face, base] of foldFaces(weight)) {
        const style = dropped(base, fields);
        for (const name of names) {
          const own = style.forms?.[name];
          for (const form of own ? [undefined, own] : [undefined]) {
            const drawn = drawLetter(name, style, form);
            if (drawn?.contours.some((contour) => contoursIntersect([contour])) ?? true) {
              folds.push(`${face} ${name}${form ? `/${form}` : ""} at ${weight}`);
            }
          }
        }
      }
    }
    return folds;
  };

  /*
   * The Soft Serif's drop on the Soft Serif's pen. Turned toward plumb at a
   * heavy weight, its pear sat its ball back over the c's narrow top and its
   * neck crossed its own closing edge; and every pear the ladder drew again
   * kept the hang it had settled at turned, which unturned left the band.
   */
  it("folds nothing at the Soft Serif's pen, in any letter or form, at any pen and width", {
    timeout: 300_000,
  }, () => {
    expect(newFolds(SOFT_PEN, PEAR, PENS, WIDTHS)).toEqual([]);
  });

  it("keeps the same points at every pen and width at the Soft Serif's pen", () => {
    const drift: string[] = [];
    for (const name of DROPS) {
      const seen = new Set<string>();
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const style = dropped(at(pen, width, SOFT_PEN), PEAR);
          seen.add(signatureText(drawLetter(name, style)!.contours));
        }
      }
      if (seen.size !== 1) drift.push(`${name}: ${[...seen].join(" | ")}`);
    }
    expect(drift).toEqual([]);
  });

  it("folds nothing with all four at their least, middle or most", { timeout: 300_000 }, () => {
    const folded = [
      { dropSize: -0.3, dropHang: 0.05, dropCurl: 0.05, dropNeck: 0.05 },
      { dropSize: 0.15, dropHang: 0.75, dropCurl: 0.5, dropNeck: 0.5 },
      { dropSize: 0.6, dropHang: 1.5, dropCurl: 1, dropNeck: 1 },
    ].flatMap((fields) =>
      foldSweepTogether(fields).map((one) => `${JSON.stringify(fields)}: ${one}`),
    );
    expect(folded).toEqual([]);
  });

  /*
   * The pairs and threes that folded the long s's hook from a Bold up, each
   * field of them clean alone: a ball carried on and turned, with and without
   * a neck, and the Soft Serif's drop carried on further.
   */
  it("folds nothing with the hang and the curl together, with or without a neck", {
    timeout: 300_000,
  }, () => {
    const folded = [
      { dropHang: 1.5, dropCurl: 1 },
      { dropSize: 0.3, dropHang: 0.75, dropCurl: 0.5 },
      { dropSize: 0.3, dropHang: 0.75, dropCurl: 0.5, dropNeck: 0.5 },
      { ...PEAR, dropHang: 1 },
    ].flatMap((fields) =>
      foldSweepTogether(fields).map((one) => `${JSON.stringify(fields)}: ${one}`),
    );
    expect(folded).toEqual([]);
  });

  /*
   * Any face whose terminal is set to a teardrop hangs a pear where it hangs
   * a drop: the Didone's f, the Grotesque's and the Geometric's s, a dollar.
   */
  it("folds nothing new on another face set to teardrops", { timeout: 300_000 }, () => {
    const faces = [SANS, GROTESQUE, GEOMETRIC, DIDONE, SLAB].map((face) =>
      withField(face, "terminal.kind", "teardrop"),
    );
    expect(faces.flatMap((face) => newFolds(face, PEAR, PENS, [100]))).toEqual([]);
  });
});
