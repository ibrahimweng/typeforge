/**
 * The text bases -- the Grotesque, the Geometric, the Didone, the Slab and the
 * Typewriter -- held to the letters a type designer would ship, at a Light and
 * past a Black as well as at their own weight.
 *
 * Each of these was a letter that came apart on one of them: an S whose spine
 * was a hairline between two blobs, an N whose diagonal vanished into its
 * stems, Greek letters in loose pieces, an eszett whose stem stopped short of
 * its bowl, bars through a stem that were ticks at a Light, a Slab whose
 * extended Latin went without serifs, carons sat on an ascender. Measured on
 * the ink, so a construction may change as long as the letter holds.
 */
import { describe, expect, it } from "vitest";
import { contoursBounds, flattenContour } from "@/font/geometry";
import type { Contour, Vec2 } from "@/font/types";
import { startFrom, draw } from "./document";
import { BASES, type Style } from "./style";

const base = (name: string): Style => BASES.find((one) => one.name === name)!;
const at = (face: string, weight?: number): Style => {
  const style = base(face);
  return weight === undefined ? style : { ...style, pen: { ...style.pen, weight } };
};
/** A letter as the forge draws it, in the face's own forms. */
const ink = (name: string, style: Style): Contour[] => {
  const forge = { ...startFrom(base(style.name)), style };
  return draw(name, forge)!.contours;
};

/** Whether a point is inside the ink, by winding: the strokes overlap unfused. */
function inked(contours: Contour[], point: Vec2): boolean {
  let winding = 0;
  for (const contour of contours) {
    const points = flattenContour(contour, 12);
    for (let index = 0; index < points.length; index++) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if (a.y <= point.y) {
        if (b.y > point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) > 0)
          winding += 1;
      } else if (
        b.y <= point.y &&
        (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) < 0
      )
        winding -= 1;
    }
  }
  return winding !== 0;
}

/** The runs of ink along a line, sampled every two units. */
function runs(contours: Contour[], fixed: number, along: "x" | "y"): Array<[number, number]> {
  const bounds = contoursBounds(contours);
  const [from, to] =
    along === "x" ? [bounds.xMin - 4, bounds.xMax + 4] : [bounds.yMin - 4, bounds.yMax + 4];
  const out: Array<[number, number]> = [];
  let start: number | null = null;
  for (let t = from; t <= to; t += 2) {
    const hit = inked(contours, along === "x" ? { x: t, y: fixed } : { x: fixed, y: t });
    if (hit && start === null) start = t;
    if (!hit && start !== null) {
      out.push([start, t]);
      start = null;
    }
  }
  if (start !== null) out.push([start, to]);
  return out;
}

/** How many separate pieces of ink a letter is, on a grid of `cell` units. */
function pieces(contours: Contour[], cell = 6): number {
  const b = contoursBounds(contours);
  const w = Math.ceil((b.xMax - b.xMin) / cell) + 1;
  const h = Math.ceil((b.yMax - b.yMin) / cell) + 1;
  const grid = new Uint8Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      if (inked(contours, { x: b.xMin + i * cell, y: b.yMin + j * cell })) grid[j * w + i] = 1;
  let count = 0;
  for (let start = 0; start < grid.length; start++) {
    if (grid[start] !== 1) continue;
    count += 1;
    const stack = [start];
    grid[start] = 2;
    while (stack.length) {
      const at = stack.pop()!;
      const i = at % w;
      const j = (at - i) / w;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        if (grid[nj * w + ni] === 1) {
          grid[nj * w + ni] = 2;
          stack.push(nj * w + ni);
        }
      }
    }
  }
  return count;
}

describe("the S on a heavy text base", () => {
  /*
   * The spine the heaviest stroke of the letter and the whole of it one
   * piece, on every text base past a Black: see the forms each base takes.
   */
  it("keeps two open counters and one piece of ink past a Black", () => {
    for (const face of ["Grotesque", "Geometric", "Didone", "Slab", "Typewriter"]) {
      for (const weight of [200, 260]) {
        for (const name of ["S", "s"]) {
          const contours = ink(name, at(face, weight));
          const b = contoursBounds(contours);
          const middle = runs(contours, (b.xMin + b.xMax) / 2, "y");
          expect(
            middle.length,
            `${face} ${name} at ${weight}: top, spine and foot`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});

describe("the N past a Black", () => {
  it("keeps its diagonal apart from both stems", () => {
    for (const face of ["Grotesque", "Geometric", "Slab"]) {
      for (const weight of [200, 260]) {
        const style = at(face, weight);
        const across = runs(ink("N", style), style.metrics.capHeight * 0.5, "x");
        expect(across.length, `${face} N at ${weight}`).toBe(3);
      }
    }
  });
});

describe("the W at a Light", () => {
  it("ends its middle apex in one top, not two stroke ends crossing", () => {
    for (const face of ["Grotesque", "Geometric", "Slab", "Typewriter"]) {
      for (const name of ["W", "w"]) {
        const style = at(face, 30);
        const contours = ink(name, style);
        const b = contoursBounds(contours);
        const top = name === "W" ? style.metrics.capHeight : style.metrics.xHeight;
        const third = (b.xMax - b.xMin) / 3;
        const middle = runs(contours, top - 6, "x").filter(
          ([from, to]) => to > b.xMin + third && from < b.xMax - third,
        );
        expect(middle.length, `${face} ${name}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("the Greek", () => {
  it("draws the lambda as one piece: its short leg leaves the long one", () => {
    for (const face of ["Grotesque", "Slab", "Sans"]) {
      for (const weight of [30, undefined]) {
        expect(pieces(ink("\u03bb", at(face, weight))), face).toBe(1);
      }
    }
  });

  it("draws the beta, zeta, xi, final sigma and omega as one piece each", () => {
    for (const face of ["Grotesque", "Slab", "Sans", "Geometric"]) {
      for (const weight of [30, undefined, 260]) {
        for (const name of ["\u03b2", "\u03b6", "\u03be", "\u03c2", "\u03a9"]) {
          expect(pieces(ink(name, at(face, weight))), `${face} ${name} at ${weight}`).toBe(1);
        }
      }
    }
  });
});

describe("the letters with a stroke through them", () => {
  it("reach across a good share of the letter at a Light", () => {
    for (const face of ["Grotesque", "Slab", "Sans"]) {
      const style = at(face, 30);
      const o = contoursBounds(ink("o", style));
      const l = contoursBounds(ink("lslash", style));
      expect((l.xMax - l.xMin) / (o.xMax - o.xMin), face).toBeGreaterThan(0.35);
    }
  });
});

describe("the extended Latin on a serifed base", () => {
  it("stands on the serifs its base letters stand on", () => {
    for (const face of ["Slab", "Didone", "Typewriter"]) {
      const style = at(face);
      for (const name of ["Hbar", "lslash", "Eng", "Thorn", "germandbls"]) {
        const foot = runs(ink(name, style), 4, "x")[0];
        expect(foot[1] - foot[0], `${face} ${name}`).toBeGreaterThan(style.pen.weight * 1.5);
      }
    }
  });
});

describe("the vertical caron", () => {
  it("sets the caron of a d, an l and an L beside the stem, not over it", () => {
    for (const face of ["Grotesque", "Slab", "Sans", "Serif"]) {
      const style = at(face);
      for (const name of ["dcaron", "lcaron", "Lcaron", "tcaron"]) {
        const b = contoursBounds(ink(name, style));
        const top = name === "Lcaron" ? style.metrics.capHeight : style.metrics.ascender;
        expect(b.yMax, `${face} ${name}`).toBeLessThan(top + style.metrics.overshoot + 2);
      }
    }
  });
});

describe("the Grotesque R", () => {
  it("has a bowl as wide as the P's", () => {
    for (const weight of [30, undefined]) {
      const style = at("Grotesque", weight);
      const height = style.metrics.capHeight * 0.75;
      const reach = (name: string) => {
        const contours = ink(name, style);
        const across = runs(contours, height, "x");
        return across[across.length - 1][1] - contoursBounds(contours).xMin;
      };
      expect(reach("R") / reach("P")).toBeGreaterThan(0.85);
    }
  });
});

describe("the Didone", () => {
  it("draws the y's right arm as a hairline, as it draws the x's", () => {
    const style = at("Didone");
    const across = runs(ink("y", style), style.metrics.xHeight * 0.6, "x");
    expect(across.length).toBe(2);
    const [left, right] = across;
    expect(right[1] - right[0]).toBeLessThan((left[1] - left[0]) * 0.6);
  });
});

describe("the Slab past a Black", () => {
  it("keeps the counter of the ya open", () => {
    for (const weight of [200, 260]) {
      const style = at("Slab", weight);
      expect(runs(ink("\u042f", style), style.metrics.capHeight * 0.72, "x").length).toBe(2);
    }
  });

  it("keeps the colon's two dots apart and the signs on their lines", () => {
    for (const weight of [200, 260]) {
      const style = at("Slab", weight);
      const colon = ink("colon", style);
      const b = contoursBounds(colon);
      const [low, high] = runs(colon, (b.xMin + b.xMax) / 2, "y");
      expect(high[0] - low[1]).toBeGreaterThan((low[1] - low[0]) * 0.4);
      expect(contoursBounds(ink("plusminus", style)).yMin).toBeGreaterThan(-2);
      const divide = contoursBounds(ink("divide", style));
      expect(divide.yMin).toBeGreaterThan(-style.metrics.overshoot - 2);
      expect(divide.yMax).toBeLessThan(style.metrics.capHeight);
    }
  });
});

describe("the dots at a Light", () => {
  it("dots the i with more than a speck", () => {
    for (const face of ["Slab", "Geometric", "Grotesque"]) {
      const style = at(face, 30);
      const contours = ink("i", style);
      const b = contoursBounds(contours);
      const column = runs(contours, (b.xMin + b.xMax) / 2, "y");
      const dot = column[column.length - 1];
      expect(dot[1] - dot[0], face).toBeGreaterThan(style.metrics.xHeight * 0.05);
    }
  });
});

describe("the symbols past a Black", () => {
  it("keeps the at sign the size of the figures", () => {
    for (const face of ["Grotesque", "Geometric", "Didone"]) {
      const style = at(face, 260);
      const b = contoursBounds(ink("at", style));
      expect(b.yMax - b.yMin, face).toBeLessThan(style.metrics.capHeight * 1.35);
    }
  });
});

describe("the Geometric past a Bold", () => {
  it("keeps its o near a circle", () => {
    const b = contoursBounds(ink("o", at("Geometric", 200)));
    expect((b.xMax - b.xMin) / (b.yMax - b.yMin)).toBeLessThan(1.25);
  });
});
