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
import { formsOf } from "./letters";
import { BASES, SANS, SERIF, type Style } from "./style";

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

  it("is the Serif base's g", () => {
    expect(SERIF.forms?.g).toBe("double");
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
          // A joined z at a black weight already folded before any of this
          // (the Monoline Script's, at 200); it is not one of these shapes.
          if (name === "z" && base.family === "script" && weight === 200) continue;
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
    // The proportions came in on the Serif base; the sans keeps its circle.
    const sans = contoursBounds(draw("O", SANS));
    const serif = contoursBounds(draw("O", SERIF));
    expect(sans.xMax - sans.xMin).toBeGreaterThan(serif.xMax - serif.xMin);
  });
});
