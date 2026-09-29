/**
 * The Serif base as a text serif, measured against what one is.
 *
 * Set beside Lora the Serif base read as a geometric sans with serifs put on
 * it: a single-storey g, a J hung under the line, a P half the width of its O,
 * an n a quarter wider than a text face's, an s drawn as two stacked circles.
 * These pin the shapes that were changed, in numbers that do not depend on how
 * the serifs or the terminals are drawn.
 */

import { describe, expect, it } from "vitest";

import { contoursBounds, flattenContour, inkRunsAt } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import type { Contour } from "@/font/types";
import { drawLetter } from "./build";
import { formsOf, recipeOf } from "./letters";
import { BASES, DIDONE, GEOMETRIC, SANS, SERIF, type Style } from "./style";
import type { SpineSegment } from "./types";

function styled(base: Style, weight: number, contrast: number): Style {
  return { ...base, pen: { ...base.pen, weight, contrast } };
}

function draw(name: string, style: Style, form?: string): Contour[] {
  const drawn = drawLetter(name, style, form);
  expect(drawn, `${name} would not draw`).not.toBeNull();
  return drawn!.contours;
}

/**
 * The letter as ink on a grid: nonzero winding over every contour, which is
 * the union the strokes are filled as, since overlapping strokes are left as
 * separate contours. Then the white regions that do not reach the edge are the
 * counters, and the black regions are the pieces.
 */
function regions(contours: Contour[], step = 4): { counters: number; pieces: number } {
  const polys = contours.map((contour) => flattenContour(contour, 16));
  const b = contoursBounds(contours);
  const x0 = b.xMin - step * 2;
  const y0 = b.yMin - step * 2;
  const w = Math.ceil((b.xMax - b.xMin) / step) + 5;
  const h = Math.ceil((b.yMax - b.yMin) / step) + 5;
  const ink = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const y = y0 + j * step + 0.37;
    // Winding along the row, from each edge's crossing of it.
    const crossings: Array<[number, number]> = [];
    for (const poly of polys) {
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k];
        const c = poly[(k + 1) % poly.length];
        if (a.y <= y === c.y <= y) continue;
        const x = a.x + ((y - a.y) / (c.y - a.y)) * (c.x - a.x);
        crossings.push([x, c.y > a.y ? 1 : -1]);
      }
    }
    crossings.sort((p, q) => p[0] - q[0]);
    let winding = 0;
    let at = 0;
    for (let i = 0; i < w; i++) {
      const x = x0 + i * step + 0.29;
      while (at < crossings.length && crossings[at][0] < x) winding += crossings[at++][1];
      ink[j * w + i] = winding !== 0 ? 1 : 0;
    }
  }
  const seen = new Uint8Array(w * h);
  let counters = 0;
  let pieces = 0;
  for (let start = 0; start < w * h; start++) {
    if (seen[start]) continue;
    const colour = ink[start];
    let edge = false;
    const stack = [start];
    seen[start] = 1;
    let size = 0;
    while (stack.length) {
      const cell = stack.pop()!;
      size++;
      const i = cell % w;
      const j = (cell - i) / w;
      if (i === 0 || j === 0 || i === w - 1 || j === h - 1) edge = true;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const next = nj * w + ni;
        if (seen[next] || ink[next] !== colour) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (colour === 1) pieces++;
    else if (!edge && size >= 2) counters++;
  }
  return { counters, pieces };
}

const WEIGHTS = [30, 96, 200];
const CONTRASTS = [0, 0.42, 0.8];

describe("the two-storey g", () => {
  it("is offered as a shape of g", () => {
    expect(formsOf("g").map((form) => form.id)).toContain("double");
  });

  it("is offered beside the Serif base's own, Lora's", () => {
    expect(SERIF.forms?.g).toBe("humanist");
  });

  it("has two counters and never crosses itself, light to black, any contrast", () => {
    for (const weight of WEIGHTS) {
      for (const contrast of CONTRASTS) {
        const where = `weight ${weight}, contrast ${contrast}`;
        for (const terminal of ["butt", "angled"] as const) {
          const style: Style = {
            ...styled(SERIF, weight, contrast),
            parts: { ...SERIF.parts, terminal: { kind: terminal, angle: 12 } },
          };
          const contours = draw("g", style, "double");
          for (const contour of contours) {
            expect(contoursIntersect([contour]), `g folds at ${where}`).toBe(false);
          }
          const { counters, pieces } = regions(contours);
          expect(counters, `g counters at ${where}`).toBe(2);
          expect(pieces, `g pieces at ${where}`).toBe(1);
        }
      }
    }
  });
});

describe("the Serif base's proportions", () => {
  const cap = SERIF.metrics.capHeight;
  const x = SERIF.metrics.xHeight;
  const width = (name: string, style = SERIF, form?: string): number => {
    const b = contoursBounds(draw(name, style, form));
    return b.xMax - b.xMin;
  };

  it("draws its O about as wide as it is tall, as a text face does", () => {
    // Lora's O is 1.01 of its cap height across; the sans's circle was 1.08.
    const ratio = width("O") / cap;
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.04);
  });

  it("runs the D, P, R and B out to a text face's widths", () => {
    // Lora: D 0.92, P 0.75, R 0.82, B 0.75 of the cap height, serifs and all.
    // The half ellipses here were 0.63, 0.44, 0.78 and 0.56.
    expect(width("D") / cap).toBeGreaterThan(0.8);
    expect(width("P") / cap).toBeGreaterThan(0.62);
    expect(width("B") / cap).toBeGreaterThan(0.64);
    expect(width("D")).toBeLessThan(width("O"));
    expect(width("P")).toBeLessThan(width("D"));
  });

  it("sets a text n rather than the sans's", () => {
    // Stem edge to stem edge a third of the way up: Lora 0.83 of an x-height.
    const runs = inkRunsAt(draw("n", SERIF), x * 0.3);
    const span = (runs[runs.length - 1][1] - runs[0][0]) / x;
    expect(span).toBeGreaterThan(0.78);
    expect(span).toBeLessThan(0.95);
  });

  it("keeps its U as wide as its H however tight the n is", () => {
    const u = width("U");
    const h = width("H");
    expect(Math.abs(u - h) / h).toBeLessThan(0.12);
  });

  it("stands its J on the baseline", () => {
    const b = contoursBounds(draw("J", SERIF, SERIF.forms?.J));
    expect(b.yMin).toBeGreaterThan(-SERIF.metrics.overshoot * 3);
  });

  it("draws an s three quarters of an x-height across, not half", () => {
    expect(width("s") / x).toBeGreaterThan(0.68);
  });

  it("reaches its extenders a text face's depth", () => {
    const g = contoursBounds(draw("p", SERIF));
    expect(g.yMin / x).toBeLessThan(-0.46);
  });
});

describe("the shapes changed for the Serif base stay clean on every base", () => {
  const letters = ["B", "D", "P", "R", "U", "G", "Q", "s", "S", "t", "f", "w", "z", "g"];
  for (const base of BASES) {
    it(base.name, () => {
      for (const weight of [30, 200]) {
        const style = { ...base, pen: { ...base.pen, weight } };
        for (const name of letters) {
          for (const form of [
            undefined,
            ...formsOf(name)
              .map((f) => f.id)
              .filter(Boolean),
          ]) {
            const drawn = drawLetter(name, style, form);
            if (!drawn) continue;
            for (const contour of drawn.contours) {
              expect(
                contoursIntersect([contour]),
                `${base.name} ${name}${form ? `.${form}` : ""} folds at weight ${weight}`,
              ).toBe(false);
            }
          }
        }
      }
    });
  }

  it("leaves the sans's capitals where they were", () => {
    // The proportions came in on the Serif base; the plain sans keeps its
    // circle. The Geometric is that sans, where the Sans itself is now drawn
    // after Geist, whose O is narrower than a circle by design.
    const sans = contoursBounds(draw("O", GEOMETRIC));
    const serif = contoursBounds(draw("O", SERIF));
    expect(sans.xMax - sans.xMin).toBeGreaterThan(serif.xMax - serif.xMin);
  });
});

/*
 * Set against Lora at a light, a regular and a black weight, the second round:
 * the ampersand, the y's tail, the beaks on the arms and the curved ends of the
 * capitals, the inner wings that closed counters at a black weight, the drops
 * that hung past the descender, the A, the f and the 4 at a black weight, and
 * the spacing and contrast of the base itself.
 */

/** The ink along a horizontal line, as the union the strokes are filled as. */
function across(contours: Contour[], y: number): Array<[number, number]> {
  const crossings: Array<[number, number]> = [];
  for (const contour of contours) {
    const points = flattenContour(contour, 24);
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      if (a.y <= y === b.y <= y) continue;
      crossings.push([a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x), b.y > a.y ? 1 : -1]);
    }
  }
  crossings.sort((p, q) => p[0] - q[0]);
  const runs: Array<[number, number]> = [];
  let winding = 0;
  let from = 0;
  for (const [x, turn] of crossings) {
    const was = winding;
    winding += turn;
    if (was === 0 && winding !== 0) from = x;
    if (was !== 0 && winding === 0) runs.push([from, x]);
  }
  return runs;
}

/** The same, along a vertical line. */
function down(contours: Contour[], x: number): Array<[number, number]> {
  const turned = contours.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: { x: -node.point.y, y: node.point.x },
      handleIn: node.handleIn && { x: -node.handleIn.y, y: node.handleIn.x },
      handleOut: node.handleOut && { x: -node.handleOut.y, y: node.handleOut.x },
    })),
  }));
  return across(turned, x)
    .map(([a, b]): [number, number] => [-b, -a])
    .reverse();
}

/** The paper between the runs of ink along a line. */
function gaps(runs: Array<[number, number]>): number[] {
  return runs.slice(1).map((run, index) => run[0] - runs[index][1]);
}

function inkAt(contours: Contour[], x: number, y: number): boolean {
  return across(contours, y).some(([a, b]) => a <= x && x <= b);
}

const serifAt = (weight: number, more: Partial<Style["pen"]> = {}): Style => ({
  ...SERIF,
  pen: { ...SERIF.pen, weight, ...more },
});

function serifDraw(name: string, style: Style): Contour[] {
  return draw(name, style, style.forms?.[name]);
}

const cap = SERIF.metrics.capHeight;

describe("the Serif ampersand", () => {
  it("is one clean piece with a loop over a bowl, at every weight", () => {
    for (const weight of WEIGHTS) {
      const amp = serifDraw("ampersand", serifAt(weight));
      for (const contour of amp) expect(contoursIntersect([contour]), `${weight}`).toBe(false);
      const { counters, pieces } = regions(amp);
      expect(pieces, `pieces at ${weight}`).toBe(1);
      expect(counters, `counters at ${weight}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("runs its leg out along the baseline to the right of everything else", () => {
    for (const weight of WEIGHTS) {
      const amp = serifDraw("ampersand", serifAt(weight));
      const b = contoursBounds(amp);
      const foot = Math.max(...across(amp, weight * 0.1).map(([, right]) => right));
      expect(foot, `${weight}`).toBeGreaterThan(b.xMax - weight * 0.15);
    }
  });
});

describe("the Serif y", () => {
  it("hooks its tail round to the left into a drop", () => {
    for (const weight of WEIGHTS) {
      const style = serifAt(weight);
      const y = serifDraw("y", style);
      const low = style.metrics.descender * 0.88;
      const widest = Math.max(...across(y, low).map(([a, b]) => b - a));
      // Wider than the pen, the hook running out level under the arm. Lora's
      // runs 163 there at the Regular and 182 at the Bold; its rising arm a
      // hairline into the tail, ours is 164 and 197, and 294 at the heaviest.
      expect(widest, `${weight}`).toBeGreaterThan(weight * 1.1);
    }
  });

  it("has no spur where the arm meets the tail, serifs or none", () => {
    for (const style of [SERIF, { ...SANS, pen: { ...SANS.pen, weight: 96 } }]) {
      for (const form of [undefined, style.forms?.y]) {
        const y = draw("y", style, form);
        const edge = (at: number) => Math.max(...across(y, at).map(([, right]) => right));
        const [a, b] = [edge(-40), edge(40)];
        for (const at of [-20, -10, -5, 0, 5, 10, 20]) {
          const line = a + ((b - a) * (at + 40)) / 80;
          expect(edge(at), `${style.name} ${form ?? ""} at ${at}`).toBeLessThan(line + 1.5);
        }
      }
    }
  });
});

describe("the beaks on a Serif arm", () => {
  it("run a long way down (or up) off the ends of the E, T, L and Z", () => {
    for (const weight of WEIGHTS) {
      const style = serifAt(weight);
      const depth = cap * 0.14;
      const E = serifDraw("E", style);
      const e = contoursBounds(E);
      expect(inkAt(E, e.xMax - 2, cap - depth), `E top at ${weight}`).toBe(true);
      expect(inkAt(E, e.xMax - 2, depth), `E foot at ${weight}`).toBe(true);
      const T = serifDraw("T", style);
      const t = contoursBounds(T);
      expect(inkAt(T, t.xMax - 2, cap - depth), `T right at ${weight}`).toBe(true);
      expect(inkAt(T, t.xMin + 2, cap - depth), `T left at ${weight}`).toBe(true);
      const L = serifDraw("L", style);
      expect(inkAt(L, contoursBounds(L).xMax - 2, depth), `L at ${weight}`).toBe(true);
      const Z = serifDraw("Z", style);
      const arm = Math.min(...across(Z, cap - 3).map(([a]) => a));
      expect(inkAt(Z, arm + 2, cap - depth), `Z top at ${weight}`).toBe(true);
      const foot = Math.max(...across(Z, 3).map(([, right]) => right));
      expect(inkAt(Z, foot - 2, depth), `Z foot at ${weight}`).toBe(true);
    }
  });

  it("stays off the sans", () => {
    const E = draw("E", SANS);
    expect(inkAt(E, contoursBounds(E).xMax - 2, cap * 0.83)).toBe(false);
  });
});

describe("the beaks on the Serif's curved capitals", () => {
  /** How tall the ink is a couple of units in from the outermost edge. */
  function upright(contours: Contour[], upper: boolean): number {
    const rows: number[] = [];
    for (let y = upper ? cap * 0.55 : 0; y < (upper ? cap + 20 : cap * 0.45); y += 2) rows.push(y);
    const edge = upper
      ? Math.max(...rows.flatMap((y) => across(contours, y).map(([, b]) => b)))
      : Math.min(...rows.flatMap((y) => across(contours, y).map(([a]) => a)));
    const x = upper ? edge - 2 : edge + 2;
    return Math.max(
      0,
      ...down(contours, x)
        .filter(([a, b]) => (upper ? b > cap * 0.5 : a < cap * 0.5))
        .map(([a, b]) => b - a),
    );
  }

  it("hangs an upright beak off the top of the C and the S", () => {
    for (const weight of WEIGHTS) {
      for (const name of ["C", "S"]) {
        const drawn = serifDraw(name, serifAt(weight));
        // Lora's C closes further round than the old one did, so at a
        // hairline the upright a couple of units in is its beak's end alone.
        expect(upright(drawn, true), `${name} at ${weight}`).toBeGreaterThan(cap * 0.085);
      }
    }
  });

  it("stands one on the foot of the S", () => {
    for (const weight of WEIGHTS) {
      const S = serifDraw("S", serifAt(weight));
      expect(upright(S, false), `${weight}`).toBeGreaterThan(cap * 0.1);
    }
  });
});

describe("the Serif at a black weight", () => {
  it("keeps the inner wings of the V, the W and the v from closing on each other", () => {
    const style = serifAt(200);
    for (const name of ["V", "W", "v", "w"]) {
      const drawn = serifDraw(name, style);
      const top = contoursBounds(drawn).yMax;
      for (const y of [top - 4, top - 12]) {
        for (const gap of gaps(across(drawn, y))) {
          expect(gap, `${name} at ${Math.round(y)}`).toBeGreaterThan(200 * 0.4);
        }
      }
    }
  });

  it("leaves the counters of the n family open between their feet", () => {
    // The walkthrough's settings: more contrast and reach than the base.
    const style: Style = {
      ...SERIF,
      pen: { weight: 200, contrast: 0.6, angle: 12 },
      metrics: {
        ...SERIF.metrics,
        xHeight: 500,
        capHeight: 700,
        ascender: 755,
        descender: -255,
        sidebearing: 35,
      },
      parts: { ...SERIF.parts, slab: { ...SERIF.parts.slab, projection: 0.7, bracket: 0.5 } },
    };
    for (const name of ["n", "h", "m", "u", "H", "N", "M"]) {
      const drawn = serifDraw(name, style);
      for (const y of [3, 20, 45]) {
        for (const gap of gaps(across(drawn, y))) {
          expect(gap, `${name} at ${y}`).toBeGreaterThan(100);
        }
      }
    }
  });

  it("keeps a counter over the A's bar", () => {
    const A = serifDraw("A", serifAt(200));
    const b = contoursBounds(A);
    const middle = (b.xMin + b.xMax) / 2;
    const paper = gaps(down(A, middle));
    expect(Math.max(...paper)).toBeGreaterThan(cap * 0.12);
  });

  it("carries the f's bar clear of its stem", () => {
    const f = serifDraw("f", serifAt(200));
    const stem = across(f, SERIF.metrics.xHeight * 0.4)[0][0];
    const bar = Math.min(...across(f, SERIF.metrics.xHeight - 30).map(([a]) => a));
    expect(stem - bar).toBeGreaterThan(200 * 0.25);
  });

  it("draws a 4 with a counter and its bar out past the stem", () => {
    const four = serifDraw("four", serifAt(200));
    expect(regions(four).counters).toBeGreaterThanOrEqual(1);
    const stem = Math.max(...across(four, cap * 0.7).map(([, b]) => b));
    let bar = 0;
    for (let y = cap * 0.12; y < cap * 0.4; y += 4) {
      bar = Math.max(bar, ...across(four, y).map(([, b]) => b));
    }
    expect(bar - stem).toBeGreaterThan(200 * 0.25);
  });

  it("keeps the drops of the zeta, the xi and the final sigma within the descender", () => {
    for (const weight of [150, 200]) {
      for (const name of ["\u03b6", "\u03be", "\u03c2"]) {
        const drawn = serifDraw(name, serifAt(weight));
        const low = contoursBounds(drawn).yMin;
        expect(low, `${name} at ${weight}`).toBeGreaterThanOrEqual(
          SERIF.metrics.descender - SERIF.metrics.overshoot - 1,
        );
      }
    }
  });
});

describe("the Serif base's colour", () => {
  it("is spaced as tightly as Lora, and its capitals a little looser", () => {
    const n = drawLetter("n", SERIF)!;
    const nb = contoursBounds(n.contours);
    expect(n.advanceWidth - (nb.xMax - nb.xMin)).toBeCloseTo(68, -1);
    const H = drawLetter("H", SERIF)!;
    const hb = contoursBounds(H.contours);
    // Lora's H stands 55 units off each side.
    expect(H.advanceWidth - (hb.xMax - hb.xMin)).toBeCloseTo(110, -1);
  });

  it("thins its o's crown to about four tenths of its sides, as Lora's is", () => {
    const o = draw("o", SERIF);
    const b = contoursBounds(o);
    const sides = across(o, (b.yMin + b.yMax) / 2).map(([a, c]) => c - a);
    const crown = down(o, (b.xMin + b.xMax) / 2).map(([a, c]) => c - a);
    const ratio = Math.min(...crown) / Math.max(...sides);
    expect(ratio).toBeGreaterThan(0.33);
    expect(ratio).toBeLessThan(0.47);
  });
});

describe("the Serif at a black weight, joined cleanly", () => {
  /** Which way a piece of spine is travelling at one of its ends, in degrees. */
  function heading(segment: SpineSegment, end: "start" | "end"): number {
    if (segment.kind === "line") {
      return (
        (Math.atan2(segment.to.y - segment.from.y, segment.to.x - segment.from.x) * 180) / Math.PI
      );
    }
    const angle = end === "start" ? segment.startAngle : segment.endAngle;
    const way = segment.sweepPositive ? 1 : -1;
    return (Math.atan2(Math.cos(angle) * way, -Math.sin(angle) * way) * 180) / Math.PI;
  }

  it("falls the s's spine down across the letter at every weight", () => {
    /*
     * Two circles as big as a black pen needs left no height for a spine: the
     * waist lay level, or climbed, and the pen -- thin along a flat -- drew it
     * as a hairline between two slit counters.
     */
    for (const base of [SERIF, SANS]) {
      for (const weight of [30, 96, 200]) {
        const style = { ...base, pen: { ...base.pen, weight } };
        const [stroke] = recipeOf("s")!(style).strokes;
        const lines = stroke.spine.segments.filter((segment) => segment.kind === "line");
        const longest = lines.reduce((a, b) =>
          Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) >
          Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y)
            ? a
            : b,
        );
        const fall = -heading(longest, "start");
        expect(fall, `${base.name} at ${weight}`).toBeGreaterThan(20);
        expect(fall, `${base.name} at ${weight}`).toBeLessThan(60);
      }
    }
  });

  it("wears a beak on both ends of the s, with the same points at every weight", () => {
    const shapes = WEIGHTS.map((weight) =>
      serifDraw("s", serifAt(weight)).map((contour) => contour.nodes.length),
    );
    for (const shape of shapes) {
      expect(shape).toEqual(shapes[0]);
      // The run and two four-point beaks: no drop.
      expect(shape.slice(1)).toEqual([4, 4]);
    }
  });

  it("runs the N's diagonal straight from the cap line to the baseline", () => {
    /*
     * Chained to a stub down each stem, the diagonal's corner was moved into
     * the letter at a black weight and the stub leaned off the stem with it:
     * its edge stood out of the stem's inner side as a step.
     */
    for (const weight of WEIGHTS) {
      const strokes = recipeOf("N")!(serifAt(weight)).strokes;
      const diagonal = strokes.find((stroke) =>
        stroke.spine.segments.some(
          (segment) => segment.kind === "line" && Math.abs(segment.to.x - segment.from.x) > 1,
        ),
      )!;
      expect(diagonal.spine.segments, `${weight}`).toHaveLength(1);
      const [line] = diagonal.spine.segments;
      if (line.kind !== "line") throw new Error("not a line");
      expect(line.from.y).toBeCloseTo(cap, 3);
      expect(line.to.y).toBeCloseTo(0, 3);
      for (const contour of serifDraw("N", serifAt(weight))) {
        expect(contoursIntersect([contour]), `${weight}`).toBe(false);
      }
    }
  });

  it("leaves the 5's bowl from the foot of its stem", () => {
    for (const weight of [...WEIGHTS, 260]) {
      const strokes = recipeOf("five")!(serifAt(weight)).strokes;
      const stem = strokes.find(
        (stroke) =>
          stroke.spine.segments.length === 1 &&
          stroke.spine.segments[0].kind === "line" &&
          Math.abs(stroke.spine.segments[0].to.x - stroke.spine.segments[0].from.x) < 1e-6,
      )!;
      const bowl = strokes.find((stroke) => stroke.spine.segments[0].kind === "arc")!;
      const foot = stem.spine.segments[0].kind === "line" ? stem.spine.segments[0].to : null;
      const first = bowl.spine.segments[0];
      if (first.kind !== "arc" || !foot) throw new Error("not a bowl");
      const leaves = {
        x: first.centre.x + first.radius * Math.cos(first.startAngle),
        y: first.centre.y + first.radius * Math.sin(first.startAngle),
      };
      expect(Math.hypot(leaves.x - foot.x, leaves.y - foot.y), `${weight}`).toBeLessThan(1);
    }
  });

  it("flies the 1's flag as far out past its stem at a black weight as at the regular", () => {
    const reach = (weight: number): number => {
      const one = serifDraw("one", serifAt(weight));
      const stem = across(one, cap * 0.4)[0][0];
      let flag = stem;
      for (let y = cap * 0.6; y < cap; y += 4) {
        flag = Math.min(flag, ...across(one, y).map(([a]) => a));
      }
      return stem - flag;
    };
    expect(reach(200)).toBeGreaterThan(reach(96) * 0.95);
  });

  it("runs the question mark's hook into its neck along one tangent", () => {
    for (const weight of [...WEIGHTS, 260]) {
      const [hook] = recipeOf("question")!(serifAt(weight)).strokes;
      const [arc, neck] = hook.spine.segments;
      expect(neck, `${weight}`).toBeDefined();
      expect(Math.abs(heading(arc, "end") - heading(neck, "start")), `${weight}`).toBeLessThan(1);
    }
  });

  it("buries the serif a curved end refuses inside the stroke, on the Didone's s", () => {
    // Set back only three units, the sliver stood out of an end cut at a
    // slant as a hairline beside the Didone's s at a black weight.
    for (const weight of WEIGHTS) {
      const drawn = draw("s", { ...DIDONE, pen: { ...DIDONE.pen, weight } });
      const [run, ...rest] = drawn;
      // The slivers, not the balls the Didone now finishes its curves with.
      const slivers = rest.filter((piece) => {
        const box = contoursBounds([piece]);
        return Math.min(box.xMax - box.xMin, box.yMax - box.yMin) < 4;
      });
      for (const piece of slivers) {
        for (const node of piece.nodes) {
          expect(inkAt([run], node.point.x, node.point.y), `${weight}`).toBe(true);
        }
      }
    }
  });
});
