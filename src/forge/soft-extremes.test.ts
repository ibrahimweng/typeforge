/**
 * The soft finishes at the far ends of what they are offered at: the curled a
 * at a Black, the inside rounding turned all the way up, a bowl as heavy at
 * its foot as the panel lets it be, a shoulder risen as far as it goes, and
 * two inside corners of one stroke a short run apart.
 *
 * Each of these drew something wrong that nothing measured -- a slot for a
 * counter, a horn above an arch, a cusp in a counter, an m that read as rn,
 * an edge cut back past the next corner -- and each test here is written
 * against the drawing, so it fails if the fault comes back by any road.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contoursIntersect } from "@/font/outline";
import type { Contour, Vec2 } from "@/font/types";
import { drawLetter } from "./build";
import { widthedStyle } from "./family";
import { LETTERS, recipeOf } from "./letters";
import { BUTT, frame } from "./letters/common";
import { type Flat, flatten, pointAt, windingAt } from "./soft";
import { SOFT_SERIF } from "./starts";
import { BASES, heavier, SANS, SERIF, type Style } from "./style";
import { sweep } from "./sweep";
import { withField } from "./testing/fold-sweep";
import { signatureText } from "./testing/signature";
import type { Stroke } from "./types";

beforeAll(async () => {
  await ready();
});

const WIDTHS = [75, 100, 125];
const SLAB = BASES.find((base) => base.name === "Slab")!;

const atPen = (style: Style, weight: number, width = 100): Style =>
  widthedStyle({ ...style, pen: { ...style.pen, weight } }, width);

/** A contour as a closed polygon, each edge in `steps` steps. */
function polygonOf(contour: Contour, steps = 24): Vec2[] {
  const out: Vec2[] = [];
  const { nodes } = contour;
  for (let index = 0; index < nodes.length; index++) {
    const from = nodes[index];
    const to = nodes[(index + 1) % nodes.length];
    for (let step = 0; step < steps; step++) out.push(pointAt(from, to, step / steps));
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

/** How far a point is from the nearest edge of a flattened outline. */
function distanceTo(flat: Flat, point: Vec2): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const { points } of flat.polygons) {
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = dx * dx + dy * dy;
      const share =
        length > 0
          ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
          : 0;
      nearest = Math.min(nearest, Math.hypot(point.x - (a.x + dx * share), point.y - (a.y + dy * share)));
    }
  }
  return nearest;
}

/** Whether a point is ink, or within half a unit of it. */
const inked = (flat: Flat, point: Vec2): boolean =>
  windingAt(flat, point) !== 0 || distanceTo(flat, point) < 0.5;

/** The contours drawn with `on` that are not in the same letter drawn with `off`. */
function added(name: string, on: Style, off: Style): { fillets: Contour[]; rest: Contour[] } {
  const was = new Set(
    drawLetter(name, off, off.forms?.[name])!.contours.map((contour) => JSON.stringify(contour)),
  );
  const now = drawLetter(name, on, on.forms?.[name])!.contours;
  const fillets = now.filter((contour) => !was.has(JSON.stringify(contour)));
  return { fillets, rest: now.filter((contour) => !fillets.includes(contour)) };
}

describe("the curled a at a heavy weight", () => {
  const faces: Array<[string, Style]> = [
    ["Soft Serif", SOFT_SERIF],
    ["Serif", SERIF],
    ["Sans", SANS],
    ["Slab", SLAB],
  ];

  /** The a's counter: the bowl's inner outline, the one contour wound against the others. */
  function counterOf(drawn: Contour[]): Vec2[] {
    const polygons = drawn.map((contour) => polygonOf(contour));
    const outer = Math.sign(areaOf(polygons[0]));
    const counters = polygons.filter((points) => Math.sign(areaOf(points)) !== outer);
    expect(counters.length).toBeGreaterThan(0);
    return counters.reduce((one, other) =>
      Math.abs(areaOf(other)) > Math.abs(areaOf(one)) ? other : one,
    );
  }

  /** The counter's outline as drawn, the same one `counterOf` finds. */
  function counterContour(drawn: Contour[]): Contour {
    const outer = Math.sign(areaOf(polygonOf(drawn[0])));
    const counters = drawn.filter((contour) => Math.sign(areaOf(polygonOf(contour))) !== outer);
    return counters.reduce((one, other) =>
      Math.abs(areaOf(polygonOf(other))) > Math.abs(areaOf(polygonOf(one))) ? other : one,
    );
  }

  /**
   * How tightly a counter turns where it turns most -- its least radius of
   * curvature, over the radius of a circle as large as it -- and how narrow it
   * is: its narrowest spread against its widest, from its second moments.
   */
  function shapeOf(contour: Contour): { turn: number; spread: number } {
    let least = Number.POSITIVE_INFINITY;
    const { nodes } = contour;
    for (let index = 0; index < nodes.length; index++) {
      const from = nodes[index];
      const to = nodes[(index + 1) % nodes.length];
      const p = [from.point, from.handleOut ?? from.point, to.handleIn ?? to.point, to.point];
      for (let step = 0; step <= 64; step++) {
        const t = step / 64;
        const u = 1 - t;
        const d1 = {
          x: 3 * u * u * (p[1].x - p[0].x) + 6 * u * t * (p[2].x - p[1].x) + 3 * t * t * (p[3].x - p[2].x),
          y: 3 * u * u * (p[1].y - p[0].y) + 6 * u * t * (p[2].y - p[1].y) + 3 * t * t * (p[3].y - p[2].y),
        };
        const d2 = {
          x: 6 * u * (p[2].x - 2 * p[1].x + p[0].x) + 6 * t * (p[3].x - 2 * p[2].x + p[1].x),
          y: 6 * u * (p[2].y - 2 * p[1].y + p[0].y) + 6 * t * (p[3].y - 2 * p[2].y + p[1].y),
        };
        const speed = Math.hypot(d1.x, d1.y);
        const bend = Math.abs(d1.x * d2.y - d1.y * d2.x);
        if (speed > 1e-9 && bend > 1e-12) least = Math.min(least, speed ** 3 / bend);
      }
    }
    const points = polygonOf(contour);
    const size = Math.sqrt(Math.abs(areaOf(points)) / 2 / Math.PI);
    const n = points.length;
    const cx = points.reduce((sum, p) => sum + p.x, 0) / n;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / n;
    let xx = 0;
    let yy = 0;
    let xy = 0;
    for (const p of points) {
      xx += (p.x - cx) ** 2;
      yy += (p.y - cy) ** 2;
      xy += (p.x - cx) * (p.y - cy);
    }
    const half = (xx + yy) / 2;
    const off = Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
    return { turn: least / size, spread: Math.sqrt((half - off) / (half + off)) };
  }

  /*
   * Brought down by a heavy weight's sink to the least the pen goes round,
   * the bowl's counter had no turn left at its ends: a parallelogram at 194
   * and a straight-sided slot at 260, turning at its corners on a few tenths
   * of a unit -- under a twentieth of the counter's size, against 0.19 to
   * 0.4 for the humanist a's counter at the same pens -- and at 260 under
   * two fifths as wide as it is long.
   */
  it("keeps its counter an oval, never a slot", () => {
    const wrong: string[] = [];
    for (const [label, face] of faces) {
      for (const pen of [142, 194, 220, 260]) {
        for (const width of WIDTHS) {
          const drawn = drawLetter("a", atPen(face, pen, width), "curled")!;
          const { turn, spread } = shapeOf(counterContour(drawn.contours));
          if (turn < 0.1 || spread < 0.4) {
            wrong.push(`${label} at ${pen}/${width}: turns ${turn.toFixed(3)}, spread ${spread.toFixed(2)}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  /*
   * Turned the whole way over at a Black, the arch's end pointed down and
   * its drop hung on the bowl's shoulder: the opening under the head closed.
   */
  it("hangs the arch's drop clear of the bowl at every weight", () => {
    const wrong: string[] = [];
    for (const [label, face] of faces.slice(0, 2)) {
      for (const pen of [30, 87, 142, 194, 220, 260]) {
        const drawn = drawLetter("a", atPen(face, pen), "curled")!.contours;
        const f = frame(heavier(atPen(face, pen)));
        const counter = counterOf(drawn);
        const middle = {
          x: counter.reduce((sum, p) => sum + p.x, 0) / counter.length,
          y: counter.reduce((sum, p) => sum + p.y, 0) / counter.length,
        };
        const polygons = drawn.map((contour) => polygonOf(contour));
        // The bowl's outside: the smallest outline around the counter.
        const around = polygons
          .filter((points) => points !== counter && Math.sign(areaOf(points)) !== Math.sign(areaOf(counter)))
          .filter((points) => windingAt(flatten([closedOf(points)]), middle) !== 0)
          .sort((one, other) => Math.abs(areaOf(one)) - Math.abs(areaOf(other)));
        expect(around.length, `${label} at ${pen}`).toBeGreaterThan(0);
        const bowl = flatten([closedOf(around[0])]);
        const drops = drawn.filter(
          (contour) => contour.nodes.length === 5 && Math.min(...contour.nodes.map((n) => n.point.y)) > f.x / 3,
        );
        expect(drops.length, `${label} at ${pen}`).toBe(1);
        const touching = polygonOf(drops[0]).filter((point) => windingAt(bowl, point) !== 0);
        if (touching.length > 0) wrong.push(`${label} at ${pen}: ${touching.length} points of the drop on the bowl`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

/** A polygon as a contour of straight edges, for asking what it winds round. */
function closedOf(points: Vec2[]): Contour {
  return {
    closed: true,
    nodes: points.map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" as const })),
  };
}

describe("an inside rounding turned all the way up", () => {
  /*
   * The tuck was laid back along the tangent where the arc touches the
   * arch, which lies outside an arch that bulges into the hollow, so its
   * edge from the arc cut back across the arch short of the stem. A sliver
   * of paper stood between the rounding, the arch and the stem, and the ink
   * beside it read as a horn: at 87 on the h and the n, worse with the
   * shoulder risen.
   */
  it("lays both straight edges of every rounding at an arch's join in ink", () => {
    const wrong: string[] = [];
    const faces: Array<[string, Style]> = [
      ["Soft Serif", SOFT_SERIF],
      ["Serif", SERIF],
    ];
    for (const [label, face] of faces) {
      for (const fillet of [0.35, 1]) {
        for (const rise of [0, 0.8]) {
          const off = withField(withField(face, "shoulder.rise", rise), "corner.fillet", 0);
          const on = withField(off, "corner.fillet", fillet);
          for (const pen of [30, 87, 142, 260]) {
            for (const name of ["n", "h", "m", "r"]) {
              const { fillets, rest } = added(name, atPen(on, pen), atPen(off, pen));
              expect(fillets.length, `${label} ${name} at ${pen}`).toBeGreaterThan(0);
              const ink = flatten(rest, 24);
              for (const contour of fillets) {
                const [a, h, tuck] = contour.nodes.map((node) => node.point);
                for (const [from, to] of [
                  [h, tuck],
                  [tuck, a],
                ]) {
                  for (let k = 1; k < 16; k++) {
                    const p = { x: from.x + ((to.x - from.x) * k) / 16, y: from.y + ((to.y - from.y) * k) / 16 };
                    if (!inked(ink, p)) {
                      wrong.push(`${label} ${name} at ${pen}, rounding ${fillet}, rise ${rise}: ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
                      break;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    expect([...new Set(wrong)]).toEqual([]);
  });
});

describe("a drop on a bowl heavy at its foot", () => {
  /*
   * A plain drop met the inner side where it was before the heft moved it,
   * inside the counter, and climbed back out to the stroke in a cusp; a
   * pear's closing edge was laid from the spine, which a heavy heft's inner
   * side comes up to, and bowed under that side, leaving a sliver of the
   * counter uninked. Both at the c's top, at the heavier weights.
   */
  it("meets the stroke on its moved inner side and closes back through ink", () => {
    const wrong: string[] = [];
    const faces: Array<[string, Style]> = [
      ["Soft Serif", SOFT_SERIF],
      ["Serif", SERIF],
    ];
    for (const [label, face] of faces) {
      for (const heft of [0.08, 0.3, 0.5]) {
        const style = withField(face, "bowl.heft", heft);
        for (const pen of [30, 87, 142, 194, 260]) {
          const drawn = drawLetter("c", atPen(style, pen), style.forms?.c)!.contours;
          const high = frame(heavier(atPen(style, pen))).x * 0.7;
          const drops = drawn.filter(
            (contour) =>
              contour.nodes.length === 5 && Math.max(...contour.nodes.map((n) => n.point.y)) > high,
          );
          expect(drops.length, `${label} c at ${pen}`).toBe(1);
          const [drop] = drops;
          const ink = flatten(
            drawn.filter((contour) => contour !== drop),
            48,
          );
          const at = `${label} c at ${pen}, heft ${heft}`;
          /*
           * Laid out from the end's outer corner as corner, front, top, where
           * the neck meets the stroke, and behind -- or the other way round,
           * where the drop was turned to wind with the ink: the front and the
           * top are the two smooth nodes.
           */
          const [n0, n1, , n3, n4] = drop.nodes;
          const laid = n1.type === "smooth";
          const meets = laid ? n3 : n1;
          /*
           * Within a unit and a half: on the soft pen a neck that meets the
           * stroke at a heavy weight is laid by the pen's reach, a few tenths
           * of a unit off the edge as drawn. Left where the heft moved the
           * side from, it was tens of units off, out in the counter.
           */
          const off = distanceTo(ink, meets.point);
          if (off > 1.5) wrong.push(`${at}: the neck meets ${off.toFixed(1)} off the stroke`);
          // The closing edges, from where the neck meets back to behind, and on toward the corner.
          const back = (t: number) => (laid ? pointAt(n3, n4, t) : pointAt(n0, n1, 1 - t));
          const on = (t: number) => (laid ? pointAt(n4, n0, t) : pointAt(n4, n0, 1 - t));
          /*
           * The last quarter toward the corner is left out: a face that softens
           * its cuts rounds the end's outer corner off the stroke, and the
           * drop's own outer side carries on from there.
           */
          for (const [edge, until] of [
            [back, 16],
            [on, 12],
          ] as const) {
            for (let k = 1; k < until; k++) {
              const p = edge(k / 16);
              if (!inked(ink, p)) {
                wrong.push(`${at}: the closing edge leaves the stroke at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
                break;
              }
            }
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("a shoulder risen as far as it goes", () => {
  /*
   * The turn down gave up all the rise the flat had no room for, down to the
   * pen's least: at a hairline, a fifth of the arch. The m's first arch fell
   * into its middle stem round what read as a corner, beside an n.
   */
  it("never turns down tighter than half the arch's reach", () => {
    const wrong: string[] = [];
    for (const [label, face] of [
      ["Soft Serif", SOFT_SERIF],
      ["Serif", SERIF],
    ] as const) {
      const style0 = withField(face, "shoulder.rise", 0.8);
      for (const pen of [30, 60, 87, 142, 194, 260]) {
        for (const width of WIDTHS) {
          const style = heavier(atPen(style0, pen, width));
          const f = frame(style);
          const least = Math.max(f.least, f.arch * 0.5);
          for (const name of ["m", "n", "h"]) {
            const recipe = (recipeOf(name, style.forms?.[name]) ?? LETTERS[name])(style);
            for (const stroke of recipe.strokes) {
              for (const segment of stroke.spine.segments) {
                if (segment.kind !== "arc") continue;
                const from = Math.round((segment.startAngle * 180) / Math.PI);
                const to = Math.round((segment.endAngle * 180) / Math.PI);
                // The shoulder's turn down, from the crest to the leg.
                if (from !== 90 || to !== 0) continue;
                if (segment.radius < least - 1e-9) {
                  wrong.push(`${label} ${name} at ${pen}/${width}: ${segment.radius.toFixed(1)} < ${least.toFixed(1)}`);
                }
              }
            }
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("still leaves the stem lower than a shoulder that does not rise", () => {
    for (const pen of [30, 87, 260]) {
      const style = heavier(atPen(SOFT_SERIF, pen));
      const lowest = (rise: number) => {
        const risen = heavier(atPen(withField(SOFT_SERIF, "shoulder.rise", rise), pen));
        const [, arch] = (recipeOf("n", risen.forms?.n) ?? LETTERS.n)(risen).strokes;
        const first = arch.spine.segments[0];
        if (first.kind !== "arc") throw new Error("the n's arch starts with its turn up");
        return first.centre.y;
      };
      expect(lowest(0.8), `n at ${pen}`).toBeLessThan(lowest(0) - frame(style).x * 0.1);
    }
  });
});

describe("two inside corners a short run apart", () => {
  const pen = { weight: 80, contrast: 0, angle: 0 };

  /*
   * Each corner's rounding counted its room to its offsets' own ends, which on
   * a short run lie past the next corner's crossing. On a U the first
   * rounding reached past the second corner, which then swallowed itself:
   * its rounding was lost and the right leg's inside skewed seven units. On a
   * closed run the counter crossed itself.
   */
  it("rounds both insides of a short-bottomed U alike, and leaves the legs upright", () => {
    const u = (inside?: number): Stroke => ({
      spine: {
        closed: false,
        segments: [
          { kind: "line", from: { x: 0, y: 500 }, to: { x: 0, y: 0 } },
          { kind: "line", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
          { kind: "line", from: { x: 100, y: 0 }, to: { x: 100, y: 500 } },
        ],
      },
      pen,
      start: BUTT,
      end: BUTT,
      ...(inside === undefined ? {} : { inside }),
    });
    const [pointed] = sweep(u());
    const [rounded] = sweep(u(0.35));
    expect(signatureText([rounded])).toBe(signatureText([pointed]));
    expect(contoursIntersect([rounded])).toBe(false);
    const points = rounded.nodes.map((node) => node.point);
    // Nothing standing out into either leg's ink: the inside of each upright.
    const astray = points.filter(
      (p) => p.y > 0.5 && p.y < 499.5 && ((p.x > 60.5 && p.x < 139.5) || (p.x > -39.5 && p.x < 39.5)),
    );
    expect(astray).toEqual([]);
    // The inside of each leg upright, from the top down to where its rounding begins.
    const inner = points.filter((p) => p.y > 39 && p.x > 39 && p.x < 61);
    const left = inner.filter((p) => p.x < 50);
    const right = inner.filter((p) => p.x > 50);
    for (const p of inner) {
      if (p.y < 60) continue;
      expect(Math.min(Math.abs(p.x - 40), Math.abs(p.x - 60)), `${p.x},${p.y}`).toBeLessThan(1e-6);
    }
    // And the two roundings mirror each other across the middle.
    const mirrored = (points: Vec2[]) =>
      points
        .map((p) => ({ x: Math.round((100 - p.x) * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 }))
        .sort((one, other) => one.y - other.y || one.x - other.x);
    const plain = (points: Vec2[]) =>
      points
        .map((p) => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 }))
        .sort((one, other) => one.y - other.y || one.x - other.x);
    expect(mirrored(right)).toEqual(plain(left));
    // Rounded, not brought to a point: the bottom's inside starts short of each corner.
    expect(inner.some((p) => p.y < 40.001 && p.x > 40.5 && p.x < 49.5)).toBe(true);
    expect(inner.some((p) => p.y < 40.001 && p.x > 50.5 && p.x < 59.5)).toBe(true);
  });

  it("keeps a closed run's short-sided counter from crossing itself", () => {
    const ring = (inside?: number): Stroke => ({
      spine: {
        closed: true,
        segments: [
          { kind: "line", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
          { kind: "line", from: { x: 100, y: 0 }, to: { x: 100, y: 500 } },
          { kind: "line", from: { x: 100, y: 500 }, to: { x: 0, y: 500 } },
          { kind: "line", from: { x: 0, y: 500 }, to: { x: 0, y: 0 } },
        ],
      },
      pen,
      start: BUTT,
      end: BUTT,
      ...(inside === undefined ? {} : { inside }),
    });
    const pointed = sweep(ring());
    const rounded = sweep(ring(0.35));
    expect(signatureText(rounded)).toBe(signatureText(pointed));
    for (const contour of rounded) expect(contoursIntersect([contour])).toBe(false);
    // The counter: rounded inside the 20 by 420 the pen leaves, and no larger than it.
    const counter = rounded
      .map((contour) => polygonOf(contour))
      .reduce((one, other) => (Math.abs(areaOf(other)) < Math.abs(areaOf(one)) ? other : one));
    const area = Math.abs(areaOf(counter)) / 2;
    expect(area).toBeLessThan(20 * 420);
    expect(area).toBeGreaterThan(20 * 420 * 0.97);
    for (const p of counter) {
      expect(p.x).toBeGreaterThan(40 - 1e-6);
      expect(p.x).toBeLessThan(60 + 1e-6);
      expect(p.y).toBeGreaterThan(40 - 1e-6);
      expect(p.y).toBeLessThan(460 + 1e-6);
    }
  });
});
