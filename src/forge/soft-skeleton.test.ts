/**
 * The soft finishes that move a letter's skeleton or its sides: a shoulder
 * that leaves its stem lower (`shoulder.rise`), the foot of a c and an e laid
 * flatter (`bowl.tail`), and a bowl heavier at its foot than at its crown
 * (`bowl.heft`, `bowl.heftTilt`).
 *
 * Each is measured against the same letter drawn without it, so a test here
 * fails the moment its finish stops doing anything, and each is held to the
 * same points at every weight and width it is drawn at.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contourArea, contoursBounds } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import type { Contour, Vec2 } from "@/font/types";
import { builtFrom, drawLetter, letterNames } from "./build";
import { widthedStyle } from "./family";
import { heftShift } from "./heft";
import { recipeOf } from "./letters";
import { frame } from "./letters/common";
import { openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { flatten } from "./soft";
import { SANS, SERIF, type Style } from "./style";
import { penReach, segmentEnd, sweep } from "./sweep";
import { FOLD_WEIGHTS, foldFaces, foldSweep, withField } from "./testing/fold-sweep";
import { signatureText } from "./testing/signature";
import type { Spine, SpineArc, Stroke } from "./types";

beforeAll(async () => {
  await ready();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];

const atPen = (style: Style, weight: number): Style => ({
  ...style,
  pen: { ...style.pen, weight },
});
const risen = (style: Style, rise = 0.3): Style => withField(style, "shoulder.rise", rise);
const tailed = (style: Style, tail = 0.8): Style => withField(style, "bowl.tail", tail);
const hefted = (style: Style, heft = 0.08, tilt?: number): Style => {
  const heavy = withField(style, "bowl.heft", heft);
  return tilt === undefined ? heavy : withField(heavy, "bowl.heftTilt", tilt);
};
/** Every finish here at once, with the soft tips and the dot's scale: the A1 set. */
const everything = (style: Style): Style =>
  hefted(tailed(risen(withField(withField(style, "slab.tip", 1), "metrics.dotScale", 1.27))));

/** A letter in the form `form` names: the face's own, or the default. */
const drawIn = (name: string, style: Style, form: "own" | "default") =>
  drawLetter(name, style, form === "own" ? style.forms?.[name] : undefined)!;

/**
 * Every letter whose points `make` lets differ between two pens and widths
 * where the face's own drawing has the same points: with the finish on, a
 * letter is to be drawn with the same points everywhere it was without it.
 *
 * Asked that way rather than as "the same points everywhere" because a few
 * letters are drawn differently already across the width axis without any
 * finish -- the Sans's grotesque a has two windings of its bowl's inside,
 * one for its narrow and normal widths and one for its wide -- and that is
 * not a finish's to answer for. Where the face's own drawing has the same
 * points everywhere, as every Serif letter here does, it is the same thing.
 */
function drift(
  face: Style,
  make: (style: Style) => Style,
  letters: string,
  form: "own" | "default" = "own",
): string[] {
  const out: string[] = [];
  let changed = false;
  for (const name of letters) {
    const under = new Map<string, Set<string>>();
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        const style = widthedStyle(atPen(face, pen), width);
        const plainDrawn = drawIn(name, style, form).contours;
        const softDrawn = drawIn(name, make(style), form).contours;
        const plain = signatureText(plainDrawn);
        const soft = signatureText(softDrawn);
        under.set(plain, (under.get(plain) ?? new Set()).add(soft));
        changed ||= JSON.stringify(softDrawn) !== JSON.stringify(plainDrawn);
      }
    }
    for (const seen of under.values()) {
      if (seen.size > 1) out.push(`${face.name} ${name}: ${[...seen].join(" | ")}`);
    }
  }
  // And the finish did something, or the same points everywhere is no news.
  if (!changed) out.push(`${face.name} ${letters}: drawn no differently`);
  return out;
}

/**
 * The same, drawn with a wave book recorded at the face's own pen, as a
 * family is exported: every master drawn with the points of the drawn
 * weight's, wherever the face's own masters are.
 */
function driftInBook(
  face: Style,
  make: (style: Style) => Style,
  letters: string,
  form: "own" | "default" = "own",
): string[] {
  const out: string[] = [];
  const book: WaveBook = {
    lengths: new Map(),
    bowls: new Map(),
    balls: new Map(),
    corners: new Map(),
    recording: true,
  };
  // Each master's points, read back from a book recorded at the face's own pen.
  const masters = (name: string, finish: (style: Style) => Style): string[] => {
    book.lengths.clear();
    book.bowls.clear();
    book.balls.clear();
    book.corners.clear();
    book.recording = true;
    waveBookAt(name);
    const drawn = [signatureText(drawIn(name, finish(face), form).contours)];
    book.recording = false;
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        waveBookAt(name);
        const style = finish(widthedStyle(atPen(face, pen), width));
        drawn.push(signatureText(drawIn(name, style, form).contours));
      }
    }
    return drawn;
  };
  const was = openWaveBook(book);
  try {
    for (const name of letters) {
      const [plainOwn, ...plain] = masters(name, (style) => style);
      const [softOwn, ...soft] = masters(name, make);
      soft.forEach((now, index) => {
        if (plain[index] === plainOwn && now !== softOwn) {
          out.push(`${face.name} ${name} at master ${index}: ${now} for ${softOwn}`);
        }
      });
    }
  } finally {
    openWaveBook(was);
  }
  return out;
}

/** Where a vertical line at `x` crosses the contours, lowest first. */
function crossings(contours: Contour[], x: number): number[] {
  const out: number[] = [];
  for (const { points } of flatten(contours, 64).polygons) {
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) {
        out.push(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** The heading a spine leaves its last point with. */
const endOf = (spine: Spine): Vec2 => segmentEnd(spine.segments[spine.segments.length - 1]);

describe("a shoulder that rises", () => {
  /**
   * Where the counter of an n meets the stem's right edge, and where the
   * arch's outside does: the lowest and the highest the arch's own outline
   * crosses a line a hair right of the stem. Measured on the n's two strokes
   * as the sweep draws them, so a serif or a notch laid on afterwards does
   * not stand in the way.
   */
  const shoulder = (style: Style) => {
    const [stem, arch] = recipeOf("n")!(style).strokes;
    const edge = contoursBounds(sweep(stem)).xMax + 0.5;
    const ys = crossings(sweep(arch), edge);
    return { notch: ys[0], outside: ys[ys.length - 1] };
  };

  it("leaves the stem lower on the Serif and the Sans", () => {
    for (const face of [SERIF, SANS]) {
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const style = widthedStyle(atPen(face, pen), width);
          const x = frame(style).x;
          const was = shoulder(style);
          const now = shoulder(risen(style));
          const at = `${face.name} ${pen}/${width}`;
          // Never higher anywhere -- by a hundredth of a unit where the rise
          // is held at nothing and a superelliptic quarter is fitted afresh --
          // and lower by a good share of the x-height at a text weight.
          expect(now.notch, at).toBeLessThanOrEqual(was.notch + 0.05);
          expect(now.outside, at).toBeLessThanOrEqual(was.outside + 0.05);
          if (pen === 87 && width === 100)
            expect(was.notch - now.notch, at).toBeGreaterThan(0.07 * x);
          if (face === SERIF) expect(was.notch - now.notch, at).toBeGreaterThan(0.04 * x);
        }
      }
    }
  });

  it("keeps the same points at every pen and width", { timeout: 120_000 }, () => {
    expect(drift(SERIF, (style) => risen(style), "nmhr")).toEqual([]);
    expect(drift(SANS, (style) => risen(style), "nmhr", "default")).toEqual([]);
    expect(driftInBook(SERIF, (style) => risen(style), "nmhr")).toEqual([]);
  });

  it("folds nothing at its least, middle and most", { timeout: 120_000 }, () => {
    expect(foldSweep("shoulder.rise", [0.05, 0.4, 0.8])).toEqual([]);
  });
});

describe("a flat tail", () => {
  /** The c's run, its end, and where it leaves the bottom of its bowl. */
  const foot = (style: Style, form?: string) => {
    const [stroke] = recipeOf("c", form)!(style).strokes;
    const bottom = stroke.spine.segments.find(
      (one): one is SpineArc =>
        one.kind === "arc" &&
        Math.abs(Math.sin(one.startAngle) + 1) < 1e-9 &&
        Math.cos(one.startAngle) > -1e-6,
    );
    return { end: endOf(stroke.spine), bottom };
  };

  it("lays the c's foot lower, and never below the bottom of the bowl", () => {
    for (const [face, form, least] of [
      [SERIF, "humanist", 0.12],
      [SERIF, undefined, 0.02],
      [SANS, undefined, 0.02],
    ] as const) {
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const style = widthedStyle(atPen(face, pen), width);
          const was = foot(style, form);
          const now = foot(tailed(style), form);
          const at = `${face.name} ${form ?? "-"} ${pen}/${width}`;
          expect(was.bottom, at).toBeDefined();
          const leaves = was.bottom!.centre.y - was.bottom!.radius;
          expect(was.end.y - now.end.y, at).toBeGreaterThan(least * frame(style).bowlH);
          expect(now.end.y, at).toBeGreaterThanOrEqual(leaves - 1e-9);
        }
      }
    }
  });

  it("changes the Sans's c, so the control is not decoration there", () => {
    const was = drawLetter("c", SANS)!;
    const now = drawLetter("c", tailed(SANS, 1.5))!;
    expect(JSON.stringify(now.contours)).not.toBe(JSON.stringify(was.contours));
  });

  it("keeps the same points at every pen and width, the e at the Black too", {
    timeout: 120_000,
  }, () => {
    expect(drift(SERIF, (style) => tailed(style), "ce")).toEqual([]);
    expect(driftInBook(SERIF, (style) => tailed(style), "ce")).toEqual([]);
    // And in the default forms, the Sans's too: its own grotesque c and e are
    // other drawings, with no tail of the bowl's to lay.
    for (const face of [SERIF, SANS]) {
      expect(drift(face, (style) => tailed(style), "ce", "default")).toEqual([]);
      expect(driftInBook(face, (style) => tailed(style), "ce", "default")).toEqual([]);
    }
  });

  it("folds nothing at its least, middle and most", { timeout: 120_000 }, () => {
    expect(foldSweep("bowl.tail", [0.05, 0.75, 1.5])).toEqual([]);
  });
});

describe("a bowl's heft", () => {
  /** A ring of radius 200 about (400, 300), anticlockwise from its right. */
  const ring = (): Spine => ({
    closed: true,
    segments: [0, 90, 180, 270].map(
      (from): SpineArc => ({
        kind: "arc",
        centre: { x: 400, y: 300 },
        radius: 200,
        startAngle: (from * Math.PI) / 180,
        endAngle: ((from + 90) * Math.PI) / 180,
        sweepPositive: true,
      }),
    ),
  });
  const stroke = (spine: Spine, pen: Stroke["pen"], heft?: Stroke["heft"]): Stroke => ({
    spine,
    pen,
    start: { kind: "butt" },
    end: { kind: "butt" },
    ...(heft ? { heft } : {}),
  });
  const counterOf = (contours: Contour[]) =>
    contours.reduce((one, other) =>
      Math.abs(contourArea(other)) < Math.abs(contourArea(one)) ? other : one,
    );
  const outsideOf = (contours: Contour[]) =>
    contours.reduce((one, other) =>
      Math.abs(contourArea(other)) > Math.abs(contourArea(one)) ? other : one,
    );
  const highest = (contour: Contour) => Math.max(...contour.nodes.map((one) => one.point.y));
  const lowest = (contour: Contour) => Math.min(...contour.nodes.map((one) => one.point.y));

  it("makes a ring thinner across its crown and heavier across its foot, exactly", () => {
    // Held level, so the crown and the foot are nodes of both rings.
    const pen = { weight: 80, contrast: 0.5, angle: 0 };
    const plain = sweep(stroke(ring(), pen));
    const heavy = sweep(stroke(ring(), pen, { share: 0.4, tilt: 0 }));
    const w = Math.abs(penReach(pen).along);
    const d = Math.min(0.4 * 2 * w, 1.2 * penReach(pen).along);
    const crown = highest(outsideOf(heavy)) - highest(counterOf(heavy));
    const sole = lowest(counterOf(heavy)) - lowest(outsideOf(heavy));
    expect(crown).toBeCloseTo(2 * w - d, 6);
    expect(sole).toBeCloseTo(2 * w + d, 6);
    expect(heavy.map((one) => one.nodes.length)).toEqual(plain.map((one) => one.nodes.length));
    expect(signatureText(heavy)).toBe(signatureText(plain));
  });

  it("moves the whole counter by the heft and nothing else, whatever the pen", () => {
    for (const tilt of [-30, 0, 45]) {
      const pen = { weight: 87, contrast: 0.55, angle: 8 };
      const heft = { share: 0.4, tilt };
      const plain = sweep(stroke(ring(), pen));
      const heavy = sweep(stroke(ring(), pen, heft));
      const by = heftShift(stroke(ring(), pen, heft), penReach(pen));
      expect(Math.hypot(by.x, by.y)).toBeGreaterThan(1);
      const moved = (p: Vec2 | null) => p && { x: p.x + by.x, y: p.y + by.y };
      const was = counterOf(plain).nodes;
      const now = counterOf(heavy).nodes;
      expect(now.length).toBe(was.length);
      now.forEach((node, index) => {
        for (const [one, other] of [
          [node.point, moved(was[index].point)],
          [node.handleIn, moved(was[index].handleIn)],
          [node.handleOut, moved(was[index].handleOut)],
        ] as const) {
          expect(one === null).toBe(other === null);
          if (one && other) expect(Math.hypot(one.x - other.x, one.y - other.y)).toBeLessThan(1e-9);
        }
      });
      expect(outsideOf(heavy)).toEqual(outsideOf(plain));
    }
  });

  it("keeps an open bowl's ends square: each inner corner on its end's own line", () => {
    const settings = [
      [SERIF, "humanist"],
      [SERIF, undefined],
      [SANS, undefined],
    ] as const;
    for (const [face, form] of settings)
      for (const pen of [30, 87, 142, 260])
        for (const share of [0.08, 0.4])
          for (const tilt of [-45, 0, 30, 45]) {
            const style = atPen(face, pen);
            const [bowl] = recipeOf("c", form)!(style).strokes;
            const heft = { share, tilt };
            const plain = sweep(stroke(bowl.spine, bowl.pen))[0].nodes;
            const heavy = sweep(stroke(bowl.spine, bowl.pen, heft))[0].nodes;
            const by = heftShift(stroke(bowl.spine, bowl.pen, heft), penReach(bowl.pen));
            const at = `${face.name} ${form ?? "-"} ${pen}, ${share} tilted ${tilt}`;
            expect(heavy.length, at).toBe(plain.length);
            // The inner side moved by the heft, away from its ends.
            const moved = heavy.filter((node, index) => {
              const was = plain[index].point;
              return Math.hypot(node.point.x - was.x - by.x, node.point.y - was.y - by.y) < 1e-9;
            });
            expect(moved.length, at).toBeGreaterThanOrEqual(5);
            // The two ends are the two straight edges; on each, one corner stayed
            // where the pen put it and the other lies on the line through it and
            // where the pen put the corner that moved.
            let ends = 0;
            plain.forEach((node, index) => {
              const next = (index + 1) % plain.length;
              if (node.handleOut !== null || plain[next].handleIn !== null) return;
              ends++;
              const stayed = [index, next].filter(
                (k) =>
                  Math.hypot(
                    heavy[k].point.x - plain[k].point.x,
                    heavy[k].point.y - plain[k].point.y,
                  ) < 1e-9,
              );
              expect(stayed.length, at).toBe(1);
              const outer = plain[stayed[0]].point;
              const inner = stayed[0] === index ? next : index;
              const was = plain[inner].point;
              const now = heavy[inner].point;
              const line = { x: was.x - outer.x, y: was.y - outer.y };
              const off =
                ((now.x - outer.x) * line.y - (now.y - outer.y) * line.x) /
                Math.hypot(line.x, line.y);
              expect(Math.abs(off), at).toBeLessThan(1e-6);
            });
            expect(ends, at).toBe(2);
          }
  });

  it("draws the Serif's bowls heavier at the foot", () => {
    const plain = drawLetter("o", SERIF, "humanist")!.contours;
    const heavy = drawLetter("o", hefted(SERIF, 0.2), "humanist")!.contours;
    const x = (contoursBounds(plain).xMin + contoursBounds(plain).xMax) / 2;
    const [a, b, c, d] = crossings(plain, x);
    const [e, f, g, h] = crossings(heavy, x);
    expect(f - e).toBeGreaterThan(b - a + 5);
    expect(h - g).toBeLessThan(d - c - 5);
  });

  it("keeps the same points at every pen and width", { timeout: 120_000 }, () => {
    for (const face of [SERIF, SANS]) {
      expect(drift(face, (style) => hefted(style, 0.3, 20), "ceobdpqga")).toEqual([]);
      expect(driftInBook(face, (style) => hefted(style, 0.3, 20), "ceobdpqga")).toEqual([]);
    }
  });

  it("folds nothing at its least, middle and most, turned either way", { timeout: 120_000 }, () => {
    expect(foldSweep("bowl.heft", [0.02, 0.25, 0.5])).toEqual([]);
    const names = letterNames().filter((name) => !builtFrom(name));
    const folds: string[] = [];
    for (const tilt of [-45, 45]) {
      for (const weight of FOLD_WEIGHTS) {
        for (const [face, base] of foldFaces(weight)) {
          const style = hefted(base, 0.5, tilt);
          for (const name of names) {
            const own = style.forms?.[name];
            for (const form of own ? [undefined, own] : [undefined]) {
              const drawn = drawLetter(name, style, form);
              if (!drawn || drawn.contours.some((contour) => contoursIntersect([contour]))) {
                folds.push(`${face} ${name}/${form ?? "-"} at tilt ${tilt}, weight ${weight}`);
              }
            }
          }
        }
      }
    }
    expect(folds).toEqual([]);
  });
});

describe("the skeleton, bowls and tips together", () => {
  it("keeps the same points at every pen and width", { timeout: 240_000 }, () => {
    const letters = "lnEIThimprfysijceoaS";
    for (const face of [SERIF, SANS]) {
      expect(drift(face, everything, letters)).toEqual([]);
      expect(driftInBook(face, everything, letters)).toEqual([]);
    }
    // The Serif's own letters have the same points everywhere, so with every
    // finish on they do too, outright.
    const varies = [...letters].filter((name) => {
      const seen = new Set<string>();
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const style = everything(widthedStyle(atPen(SERIF, pen), width));
          seen.add(signatureText(drawIn(name, style, "own").contours));
        }
      }
      return seen.size > 1;
    });
    expect(varies).toEqual([]);
  });

  it("folds nothing on either face", { timeout: 120_000 }, () => {
    const names = letterNames().filter((name) => !builtFrom(name));
    const folds: string[] = [];
    for (const weight of [12, ...PENS]) {
      for (const [face, base] of foldFaces(weight)) {
        const style = everything(base);
        for (const name of names) {
          const own = style.forms?.[name];
          for (const form of own ? [undefined, own] : [undefined]) {
            const drawn = drawLetter(name, style, form);
            if (!drawn || drawn.contours.some((contour) => contoursIntersect([contour]))) {
              folds.push(`${face} ${name}/${form ?? "-"} at weight ${weight}`);
            }
          }
        }
      }
    }
    expect(folds).toEqual([]);
  });
});
