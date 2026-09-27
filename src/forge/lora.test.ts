/**
 * The Serif, set against Lora.
 *
 * The Serif is modelled on Lora, an old-style text face, and these hold it to
 * what was measured there: the lines, the stems and hairlines, the heavier
 * sides of the rounds, the width of every letter, the sidebearings, the forms
 * Lora draws its own way (`letters/humanist.ts`) and how its Bold closes its
 * counters. Lora itself is not in the repository; what is here is a handful
 * of numbers measured off Lora Regular and Lora Bold, which is all a test
 * needs.
 *
 * And the things the construction has to keep while it does it: nothing
 * crossing itself from a hairline to past a Black, the same points at every
 * weight, and the other bases drawn as they were.
 */

import { describe, expect, it } from "vitest";
import { contoursBounds, inkRunsAt } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { drawLetter } from "./build";
import { formOf, startFrom } from "./document";
import { BASES, SERIF, type Style } from "./style";

const forge = startFrom(SERIF);
const draw = (name: string, style: Style = SERIF) => drawLetter(name, style, formOf(forge, name))!;
const at = (weight: number): Style => ({ ...SERIF, pen: { ...SERIF.pen, weight } });
const box = (name: string, style: Style = SERIF) => contoursBounds(draw(name, style).contours);
const sides = (name: string, style: Style = SERIF) => {
  const drawn = draw(name, style);
  const b = contoursBounds(drawn.contours);
  return [b.xMin, drawn.advanceWidth - b.xMax];
};
/** The runs of ink along a row, overlapping strokes merged. */
function row(name: string, y: number, style: Style = SERIF): Array<[number, number]> {
  const runs = inkRunsAt(draw(name, style).contours, y, "y", 64);
  return runs.reduce<Array<[number, number]>>((all, run) => {
    const last = all[all.length - 1];
    if (last && run[0] <= last[1] + 0.5) last[1] = Math.max(last[1], run[1]);
    else all.push([run[0], run[1]]);
    return all;
  }, []);
}

/** Lora Regular's ink widths, in units of a thousand to the em. */
const LORA_WIDTH: Record<string, number> = {
  a: 457,
  b: 532,
  c: 457,
  d: 526,
  e: 461,
  f: 369,
  g: 534,
  h: 543,
  k: 504,
  m: 826,
  n: 540,
  o: 503,
  p: 526,
  q: 519,
  r: 390,
  s: 370,
  t: 362,
  u: 542,
  v: 496,
  w: 794,
  x: 497,
  y: 520,
  z: 427,
  A: 644,
  B: 528,
  C: 623,
  D: 644,
  E: 522,
  F: 469,
  G: 693,
  H: 670,
  J: 345,
  K: 623,
  L: 502,
  M: 840,
  N: 662,
  O: 704,
  P: 525,
  Q: 740,
  R: 573,
  S: 465,
  T: 595,
  U: 691,
  V: 675,
  W: 1003,
  X: 647,
  Y: 650,
  Z: 519,
};

/** Lora Bold's, for the letters a Bold draws most differently from its Regular. */
const LORA_BOLD_WIDTH: Record<string, number> = {
  a: 478,
  e: 480,
  n: 583,
  o: 504,
  s: 414,
  v: 529,
  A: 660,
  B: 583,
  H: 707,
  O: 699,
  V: 700,
};

describe("the Serif measured against Lora", () => {
  it("stands on Lora's lines", () => {
    expect(box("x").yMax).toBeCloseTo(500, 0);
    expect(box("H").yMax).toBeCloseTo(700, 0);
    expect(box("l").yMax).toBeCloseTo(755, 0);
    expect(box("p").yMin).toBeCloseTo(-255, 0);
    // Round letters over by Lora's sixteen units, and the g's tail to -271.
    expect(box("o").yMax - 500).toBeCloseTo(16, 0);
    expect(-box("o").yMin).toBeCloseTo(16, 0);
    expect(box("g").yMin).toBeCloseTo(-271, -1);
  });

  it("draws its stems at Lora's 87, its rounds' sides at 102 and its hairlines at 40", () => {
    const n = row("n", 250);
    expect(n[0][1] - n[0][0]).toBeCloseTo(87, -1);
    const o = row("o", 250);
    expect(o[0][1] - o[0][0]).toBeGreaterThan(96);
    expect(o[0][1] - o[0][0]).toBeLessThan(108);
    const b = box("o");
    const crown = inkRunsAt(draw("o").contours, (b.xMin + b.xMax) / 2, "x", 64);
    expect(crown[crown.length - 1][1] - crown[crown.length - 1][0]).toBeCloseTo(40, -1);
    // The capitals' stems are the lowercase's, as Lora's are.
    const H = row("H", 200);
    expect(H[0][1] - H[0][0]).toBeCloseTo(87, -1);
  });

  it("draws every letter within a few percent of Lora's width", () => {
    const off: string[] = [];
    for (const [name, width] of Object.entries(LORA_WIDTH)) {
      const b = box(name);
      const drawn = b.xMax - b.xMin;
      if (Math.abs(drawn - width) > width * 0.03 + 6)
        off.push(`${name} ${Math.round(drawn)}/${width}`);
    }
    expect(off).toEqual([]);
  });

  it("sets each letter at Lora's sidebearings", () => {
    // Lora Regular: n 37 and 30, o 41 a side, H 55 a side, T 22 and 23, v 6 and 3.
    const n = sides("n");
    expect(n[0]).toBeCloseTo(37, -1);
    expect(n[1]).toBeCloseTo(30, -1);
    const o = sides("o");
    expect(o[0]).toBeCloseTo(41, -1);
    expect(o[1]).toBeCloseTo(41, -1);
    const H = sides("H");
    expect(H[0]).toBeCloseTo(55, -1);
    expect(sides("T")[0]).toBeCloseTo(22, -1);
    expect(sides("v")[0]).toBeLessThan(10);
  });

  it("sets its figures proportional, as Lora does", () => {
    expect(draw("one").advanceWidth).toBeLessThan(draw("zero").advanceWidth * 0.65);
    expect(box("zero").yMax).toBeCloseTo(716, 0);
  });
});

describe("the letters Lora draws its own way", () => {
  it("sets the e's eye high: the bar at six tenths of the x-height", () => {
    const b = box("e");
    const middle = (b.xMin + b.xMax) / 2;
    const column = inkRunsAt(draw("e").contours, middle, "x", 64);
    // The bar is the run of ink between the crown and the foot.
    const bar = column.find(([from, to]) => from > 150 && to < 450)!;
    expect((bar[0] + bar[1]) / 2 / 500).toBeGreaterThan(0.57);
    expect((bar[0] + bar[1]) / 2 / 500).toBeLessThan(0.67);
  });

  it("runs the u's right stem down to the line and stands the t well over the x-height", () => {
    const u = draw("u");
    const b = contoursBounds(u.contours);
    // Down the right stem, ink from the baseline to the x-height.
    const stem = inkRunsAt(u.contours, b.xMax - 80, "x", 64);
    expect(Math.min(...stem.map(([from]) => from))).toBeLessThan(2);
    expect(box("t").yMax).toBeCloseTo(640, -1);
  });

  it("draws the N and the U with hairline stems, as a broad nib does", () => {
    const N = row("N", 300);
    expect(N[0][1] - N[0][0]).toBeLessThan(SERIF.pen.weight * 0.7);
    const U = row("U", 450);
    const right = U[U.length - 1];
    expect(right[1] - right[0]).toBeLessThan(SERIF.pen.weight * 0.7);
  });

  it("hangs the Q's tail under the line and out under the bowl's right side", () => {
    const Q = box("Q");
    expect(Q.yMin).toBeLessThan(-150);
    expect(Q.xMax).toBeGreaterThan(box("O").xMax);
  });

  it("finishes the 2, the 3 and the question mark in drops", () => {
    for (const name of ["two", "three", "question"]) {
      // A drop is wider than the stroke it finishes: somewhere in the upper
      // left the ink runs wider than the hairline.
      const b = box(name);
      let widest = 0;
      for (let y = b.yMax * 0.6; y < b.yMax * 0.85; y += 4) {
        const runs = row(name, y);
        widest = Math.max(widest, runs[0][1] - runs[0][0]);
      }
      expect(widest, name).toBeGreaterThan(SERIF.pen.weight * 0.8);
    }
  });
});

describe("the Serif's Bold against Lora Bold", () => {
  it("closes its counters rather than running wide", () => {
    const off: string[] = [];
    for (const [name, width] of Object.entries(LORA_BOLD_WIDTH)) {
      const b = box(name, at(142));
      const drawn = b.xMax - b.xMin;
      if (Math.abs(drawn - width) > width * 0.04 + 6)
        off.push(`${name} ${Math.round(drawn)}/${width}`);
    }
    expect(off).toEqual([]);
    // Lora Bold's n has 172 units of counter on a stem of 142.
    const n = row("n", 250, at(142));
    expect(Math.abs(n[1][0] - n[0][1] - 172)).toBeLessThan(12);
  });

  it("keeps its serifs about as long as the Regular's", () => {
    const regular = row("n", 5);
    const bold = row("n", 5, at(142));
    const reach = (runs: Array<[number, number]>, stem: Array<[number, number]>) =>
      stem[0][0] - runs[0][0];
    const stemRegular = row("n", 250);
    const stemBold = row("n", 250, at(142));
    expect(reach(bold, stemBold)).toBeLessThan(reach(regular, stemRegular) * 1.25);
  });
});

describe("the Serif stays clean from a hairline to past a Black", () => {
  const letters = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"].concat([
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ampersand",
    "question",
    "exclam",
    "period",
    "comma",
    "colon",
    "semicolon",
    "quotesingle",
    "quotedbl",
    "parenleft",
    "parenright",
    "hyphen",
    "slash",
  ]);
  const weights = [30, 87, 142, 200, 260];

  it("never crosses itself", () => {
    const folded: string[] = [];
    for (const weight of weights) {
      for (const name of letters) {
        for (const contour of draw(name, at(weight)).contours) {
          if (contoursIntersect([contour])) folded.push(`${name}@${weight}`);
        }
      }
    }
    expect([...new Set(folded)]).toEqual([]);
  });

  it("keeps the same points at every weight, so a weight axis can run through it", () => {
    const moved: string[] = [];
    for (const name of letters) {
      const counts = weights.map((weight) =>
        draw(name, at(weight))
          .contours.map((contour) => contour.nodes.length)
          .join("+"),
      );
      if (new Set(counts).size > 1) moved.push(`${name}: ${counts.join(" | ")}`);
    }
    expect(moved).toEqual([]);
  });
});

describe("the other bases", () => {
  it("keep their serifs' growth, their widths at a Black and their own forms", () => {
    for (const base of BASES) {
      if (base.name === "Serif") continue;
      expect(base.parts.slab.hold, base.name).toBeUndefined();
      expect(base.metrics.bold, base.name).toBeUndefined();
      for (const form of Object.values(base.forms ?? {})) {
        expect(form, base.name).not.toBe("humanist");
      }
    }
  });
});
