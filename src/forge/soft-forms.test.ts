/**
 * The soft text serif's own letters (`letters/soft.ts`): the curled a, the
 * swung y and the tucked f.
 *
 * Each is offered on every face, so the loops over every form in
 * `controls.test.ts`, `letters.test.ts`, `serif-forms.test.ts`,
 * `script.test.ts` and `ink-frame.test.ts` already hold them to the rules
 * every alternate keeps: no fold on any base at any weight, one piece,
 * inside the line, different from the forms beside it. What is here is what
 * makes each of them the letter it is meant to be, and the points each keeps
 * at every pen and width -- with the face's finishes off, and with the soft
 * serif's own finishes on, which is where these letters are meant to be
 * drawn.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contoursBounds } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import type { Contour, Vec2 } from "@/font/types";
import { drawLetter } from "./build";
import { widthedStyle } from "./family";
import { formsOf, LETTERS, recipeOf } from "./letters";
import { frame } from "./letters/common";
import { CURLED_TILT, CURLED_TILT_EASE, SWUNG_CROTCH, TUCKED_LEFT } from "./letters/soft";
import { openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { pointAt } from "./soft";
import { BASES, SANS, SERIF, type Style } from "./style";
import { withField } from "./testing/fold-sweep";
import { signatureText } from "./testing/signature";

beforeAll(async () => {
  await ready();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];
const FORMS: Array<[string, string]> = [
  ["a", "curled"],
  ["y", "swung"],
  ["f", "tucked"],
];

const atPen = (style: Style, weight: number): Style => ({
  ...style,
  pen: { ...style.pen, weight },
});

/** The soft serif's finishes (plan B2's values), laid on a face. */
function softened(style: Style): Style {
  let out = style;
  const fields: Array<[string, number]> = [
    ["metrics.dotScale", 1.27],
    ["slab.tip", 1],
    ["slab.swell", 0.3],
    ["shoulder.rise", 0.3],
    ["bowl.tail", 0.8],
    ["bowl.heft", 0.08],
    ["terminal.soft", 0.3],
    ["terminal.taper", 0.5],
    ["terminal.dropSize", 0.15],
    ["terminal.dropHang", 0.3],
    ["terminal.dropCurl", 0.6],
    ["terminal.dropNeck", 1],
    ["corner.fillet", 0.35],
  ];
  for (const [field, value] of fields) out = withField(out, field, value);
  return out;
}

/** The Serif on the soft serif's own pen, which is the pen these letters were drawn for. */
const SOFT_PEN: Style = { ...SERIF, pen: { ...SERIF.pen, weight: 84, contrast: 0.7, angle: 18 } };

/** A contour as a closed polygon, each edge in sixteen steps. */
function polygonOf(contour: Contour): Vec2[] {
  const out: Vec2[] = [];
  const { nodes } = contour;
  for (let index = 0; index < nodes.length; index++) {
    const from = nodes[index];
    const to = nodes[(index + 1) % nodes.length];
    for (let step = 0; step < 16; step++) out.push(pointAt(from, to, step / 16));
  }
  return out;
}

/** Twice the signed area of a polygon: positive anticlockwise. */
function areaOf(points: Vec2[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * The direction of a region's long axis, in degrees from the level, from its
 * second moments about its own centroid (Green's theorem over the polygon).
 */
function principalAxis(points: Vec2[]): number {
  let a = 0;
  let cx = 0;
  let cy = 0;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let index = 0; index < points.length; index++) {
    const p = points[index];
    const q = points[(index + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
    xx += (p.y * p.y + p.y * q.y + q.y * q.y) * cross;
    yy += (p.x * p.x + p.x * q.x + q.x * q.x) * cross;
    xy += (p.x * q.y + 2 * p.x * p.y + 2 * q.x * q.y + q.x * p.y) * cross;
  }
  a /= 2;
  cx /= 6 * a;
  cy /= 6 * a;
  // About the origin, then moved to the centroid.
  const ixx = xx / 12 - a * cy * cy;
  const iyy = yy / 12 - a * cx * cx;
  const ixy = xy / 24 - a * cx * cy;
  // The long axis is the one the region's spread along is greatest; wound
  // clockwise every moment comes out negated, which turns the answer square.
  const wound = Math.sign(a);
  return (Math.atan2(2 * ixy * wound, (iyy - ixx) * wound) / 2) * (180 / Math.PI);
}

/** The direction a spine's last piece leaves in, as a unit vector. */
function endHeading(
  stroke: ReturnType<ReturnType<typeof recipeOf> & object>["strokes"][number],
): Vec2 {
  const last = stroke.spine.segments[stroke.spine.segments.length - 1];
  if (last.kind === "line") {
    const d = Math.hypot(last.to.x - last.from.x, last.to.y - last.from.y);
    return { x: (last.to.x - last.from.x) / d, y: (last.to.y - last.from.y) / d };
  }
  const way = last.sweepPositive ? 1 : -1;
  return { x: -Math.sin(last.endAngle) * way, y: Math.cos(last.endAngle) * way };
}

describe("the soft forms are offered", () => {
  it("as the curled a, the swung y and the tucked f", () => {
    for (const [name, id] of FORMS) {
      expect(formsOf(name).map((form) => form.id)).toContain(id);
    }
  });

  it("drawn as the plain letter on a joined face and with a pen held near the upright", () => {
    const joined = BASES.filter((base) => base.parts.script.on);
    expect(joined.length).toBeGreaterThan(0);
    const upright: Style = { ...SERIF, pen: { ...SERIF.pen, angle: 80 } };
    for (const style of [...joined, upright]) {
      for (const [name, id] of FORMS) {
        const plain = recipeOf(name)!(style);
        const drawn = recipeOf(name, id)!(style);
        expect(JSON.stringify(drawn.strokes), `${style.name} ${name}/${id}`).toBe(
          JSON.stringify(plain.strokes),
        );
      }
    }
  });
});

describe("the curled a", () => {
  /*
   * On the pen it was drawn for, and on a round one. The Serif's own nib,
   * held at eight degrees with its weight on the upright strokes, thickens
   * the counter's sides unevenly and leans it ten degrees further.
   */
  it("leans its counter back by about its tilt", () => {
    for (const style of [SOFT_PEN, softened(SOFT_PEN), SANS]) {
      const drawn = drawLetter("a", style, "curled")!;
      // The counter is the bowl's inner outline: the one wound against the others.
      const outer = Math.sign(areaOf(polygonOf(drawn.contours[0])));
      const counters = drawn.contours
        .map(polygonOf)
        .filter((points) => Math.sign(areaOf(points)) !== outer);
      expect(counters.length, style.name).toBeGreaterThan(0);
      const counter = counters.reduce((one, other) =>
        Math.abs(areaOf(other)) > Math.abs(areaOf(one)) ? other : one,
      );
      const heavy = 0; // every one of these is at its own text weight
      const tilt = CURLED_TILT * (1 - CURLED_TILT_EASE * heavy);
      // The plan's 15 to 25 degrees for a tilt of twenty.
      expect(Math.abs(principalAxis(counter) - tilt), style.name).toBeLessThanOrEqual(5);
    }
  });

  it("curls its foot up to the right of the stem", () => {
    for (const style of [SERIF, SOFT_PEN, softened(SOFT_PEN)]) {
      const f = frame(style);
      const [, stem] = recipeOf("a", "curled")!(style).strokes;
      const [foot, upright] = stem.spine.segments;
      expect(foot.kind).toBe("arc");
      expect(upright.kind).toBe("line");
      if (upright.kind !== "line" || foot.kind !== "arc") continue;
      const end = {
        x: foot.centre.x + foot.radius * Math.cos(foot.startAngle),
        y: foot.centre.y + foot.radius * Math.sin(foot.startAngle),
      };
      expect(end.x, style.name).toBeGreaterThan(upright.from.x);
      /*
       * Up off the line: the curl's end is half its radius over the dip, which
       * at seven tenths of a text stem is 0.058 to 0.069 of the x-height. (The
       * plan's 0.08 is out of reach of its own curl, radius and start alike.)
       */
      expect(end.y, style.name).toBeGreaterThan(f.x * 0.05);
    }
  });

  it("stands no serif under its foot", () => {
    // Nothing drawn that stays down by the line on its own, where the face
    // finishes its ends soft: the foot does not hang a drop, and is cut plain.
    for (const style of [softened(SOFT_PEN), softened(SERIF), softened(atPen(SERIF, 260))]) {
      const f = frame(style);
      const drawn = drawLetter("a", style, "curled")!;
      const low = drawn.contours.filter((contour) => contoursBounds([contour]).yMax < f.x * 0.25);
      expect(low.length, style.name).toBe(0);
    }
    // And on the plain Serif no more than the slivers a serif refused on a
    // curve leaves buried in the stroke, as every curved end of that face does.
    const f = frame(SERIF);
    const drawn = drawLetter("a", SERIF, "curled")!;
    for (const contour of drawn.contours) {
      if (contoursBounds([contour]).yMax >= f.x * 0.25) continue;
      expect(Math.abs(areaOf(polygonOf(contour))) / 2).toBeLessThan(f.half * f.half * 0.05);
    }
  });
});

describe("the swung y", () => {
  it("keeps the hooked y's run: one straight, then one turn pinned to two pieces", () => {
    for (const base of BASES) {
      for (const weight of [8, 87, 260]) {
        const style = atPen(base, weight);
        if (style.parts.script.on || Math.abs(Math.abs(style.pen.angle) - 90) < 30) continue;
        const [, tail] = recipeOf("y", "swung")!(style).strokes;
        const kinds = tail.spine.segments.map((one) =>
          one.kind === "arc" ? `arc${one.pieces}` : one.kind,
        );
        expect(kinds, `${base.name} ${weight}`).toEqual(["line", "arc2"]);
      }
    }
  });

  it("stops its left arm inside the tail's straight run, at every weight on every face", () => {
    for (const base of BASES) {
      for (const weight of [8, 40, 92, 150, 210, 260]) {
        for (const width of WIDTHS) {
          const style = widthedStyle(atPen(base, weight), width);
          if (style.parts.script.on || Math.abs(Math.abs(style.pen.angle) - 90) < 30) continue;
          const [arm, tail] = recipeOf("y", "swung")!(style).strokes;
          const armLine = arm.spine.segments[0];
          const run = tail.spine.segments[0];
          if (armLine.kind !== "line" || run.kind !== "line") throw new Error("not straight");
          // The knee, where the straight turns, is no higher than where the arm stops.
          expect(run.to.y, `${base.name} ${weight}/${width}`).toBeLessThanOrEqual(
            armLine.to.y + 1e-9,
          );
        }
      }
    }
  });

  it("ends heading left", () => {
    for (const style of [SERIF, SOFT_PEN, SANS]) {
      const [, tail] = recipeOf("y", "swung")!(style).strokes;
      const heading = endHeading(tail);
      // Left, and rising by less than a third of a right angle.
      expect(heading.x, style.name).toBeLessThan(-Math.cos(Math.PI / 6));
      expect(heading.y, style.name).toBeGreaterThanOrEqual(0);
    }
  });

  it("hangs a long pear level along the bottom, on a face that hangs them", () => {
    const wrong: string[] = [];
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        const style = softened(widthedStyle(atPen(SOFT_PEN, pen), width));
        const drawn = drawLetter("y", style, "swung")!;
        const all = contoursBounds(drawn.contours);
        // The drop: the lowest of the five-node pieces a drop is drawn as.
        const drops = drawn.contours.filter((contour) => contour.nodes.length === 5);
        const drop = contoursBounds([
          drops.reduce((one, other) =>
            contoursBounds([other]).yMin < contoursBounds([one]).yMin ? other : one,
          ),
        ]);
        const long = (drop.xMax - drop.xMin) / (drop.yMax - drop.yMin);
        const said = `${pen}/${width}`;
        // Carried out level, not shrunk to a knob on the end.
        if (long < 1.4) wrong.push(`${said} pear only ${long.toFixed(2)} times as long as deep`);
        // Along the bottom of the letter.
        if (drop.yMin > all.yMin + 2)
          wrong.push(`${said} pear ${drop.yMin - all.yMin} over the bottom`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("rounds its crotch by its own share of the face's rounding", () => {
    const [arm] = recipeOf("y", "swung")!(softened(SERIF)).strokes;
    expect(arm.end.fillet).toEqual({ left: SWUNG_CROTCH });
    // And not at all where the face rounds nothing.
    const [plainArm] = recipeOf("y", "swung")!(SERIF).strokes;
    expect(plainArm.end.fillet).toBeUndefined();
  });
});

describe("the tucked f", () => {
  /** How far a bar stroke reaches left of the stem's spine. */
  const reachLeft = (style: Style, form?: string): number => {
    const strokes = recipeOf("f", form)!(style).strokes;
    const stem = strokes[0].spine.segments[0];
    if (stem.kind !== "line") throw new Error("no stem");
    const bars = strokes.slice(1).flatMap((one) => one.spine.segments);
    const leftmost = Math.min(
      ...bars.flatMap((one) => (one.kind === "line" ? [one.from.x, one.to.x] : [])),
    );
    return stem.from.x - leftmost;
  };

  it("reaches its bar back past the stem by its share of the plain f's", () => {
    // Faces whose bars are cut square, so no round cap pulls either bar's ends in.
    for (const style of [SERIF, SOFT_PEN, SANS, atPen(SERIF, 30), atPen(SERIF, 260)]) {
      const ratio = reachLeft(style, "tucked") / reachLeft(style);
      expect(ratio, style.name).toBeCloseTo(TUCKED_LEFT, 9);
      expect(ratio, style.name).toBeLessThan(1);
    }
  });

  it("keeps the plain f's stem and hook", () => {
    for (const base of BASES) {
      if (base.parts.script.on || Math.abs(Math.abs(base.pen.angle) - 90) < 30) continue;
      const plain = LETTERS.f(base).strokes[0];
      const tucked = recipeOf("f", "tucked")!(base).strokes[0];
      expect(JSON.stringify(tucked.spine), base.name).toBe(JSON.stringify(plain.spine));
    }
  });

  it("rounds the short bar's join above it, where the face rounds its joins", () => {
    const [, left, right] = recipeOf("f", "tucked")!(softened(SERIF)).strokes;
    expect(left.start.fillet).toEqual({ right: 1 });
    expect(right.start.fillet).toBeUndefined();
    expect(left.end.seen).toBe(true);
    expect(right.end.seen).toBe(true);
    const [, plainLeft] = recipeOf("f", "tucked")!(SERIF).strokes;
    expect(plainLeft.start).toEqual({ kind: "butt" });
  });
});

describe("the soft forms at every master", () => {
  /** Each form's signature at every pen and width, and with a wave book replayed at 30 and 260. */
  function signatures(face: Style, name: string, form: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        const drawn = drawLetter(name, widthedStyle(atPen(face, pen), width), form)!;
        out.set(`${pen}/${width}`, signatureText(drawn.contours));
      }
    }
    const book: WaveBook = {
      lengths: new Map(),
      bowls: new Map(),
      balls: new Map(),
      corners: new Map(),
      recording: true,
    };
    const was = openWaveBook(book);
    try {
      waveBookAt(name);
      out.set("book", signatureText(drawLetter(name, face, form)!.contours));
      book.recording = false;
      for (const pen of [30, 260]) {
        waveBookAt(name);
        const drawn = drawLetter(name, widthedStyle(atPen(face, pen), 100), form)!;
        out.set(`book ${pen}`, signatureText(drawn.contours));
      }
    } finally {
      openWaveBook(was);
    }
    return out;
  }

  const faces: Array<[string, Style]> = [
    ["Serif", SERIF],
    ["Sans", SANS],
    ["Sans with serifs", withField(SANS, "slab.on", true)],
    ["Serif on the soft pen", SOFT_PEN],
    ["Serif with the soft finishes", softened(SOFT_PEN)],
    ["Sans with the soft finishes", softened(withField(SANS, "slab.on", true))],
  ];

  it.each(faces)("keep their points on the %s", (label, face) => {
    const wrong: string[] = [];
    for (const [name, form] of FORMS) {
      const seen = new Set(signatures(face, name, form).values());
      if (seen.size > 1) wrong.push(`${label} ${name}/${form}: ${[...seen].join(" | ")}`);
    }
    expect(wrong).toEqual([]);
  });

  it("never fold with the soft finishes on, on any base", () => {
    const wrong: string[] = [];
    for (const base of BASES) {
      for (const weight of [8, 40, 92, 150, 210, 260]) {
        const style = softened(atPen(base, weight));
        for (const [name, form] of FORMS) {
          for (const contour of drawLetter(name, style, form)!.contours) {
            if (contoursIntersect([contour]))
              wrong.push(`${base.name} ${name}/${form} at ${weight}`);
          }
        }
      }
    }
    expect([...new Set(wrong)]).toEqual([]);
  });
});
