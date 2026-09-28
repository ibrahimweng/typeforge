/**
 * The display bases -- the fat face, the Ribbon, the Technical, the
 * Fairground, the Wavy, the Flared and the Psychedelic -- held to what a
 * foundry would ship, on the letters a review found broken: Cyrillic built
 * with notched corners and slit bowls on every base, Greek and the ash with
 * no counters, a fat face whose symbols and marks fell apart at its own
 * weight, and swellings, slabs and waves that filled their letters in once
 * the pen grew. Measured on the ink, so a construction may change as long as
 * the letter holds.
 */
import { describe, expect, it } from "vitest";
import { contoursBounds, flattenContour } from "@/font/geometry";
import type { Contour, Vec2 } from "@/font/types";
import { draw, startFrom } from "./document";
import { BASES, type Style } from "./style";

const base = (name: string): Style => BASES.find((one) => one.name === name)!;
const at = (face: string, weight?: number): Style => {
  const style = base(face);
  return weight === undefined ? style : { ...style, pen: { ...style.pen, weight } };
};
const ink = (name: string, style: Style): Contour[] => {
  const forge = { ...startFrom(base(style.name)), style };
  return draw(name, forge)!.contours;
};

/** Whether a point is inside the ink, by winding. */
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

/** The runs of ink along a level line, sampled every two units. */
function across(contours: Contour[], y: number): Array<[number, number]> {
  const bounds = contoursBounds(contours);
  const out: Array<[number, number]> = [];
  let start: number | null = null;
  for (let x = bounds.xMin - 4; x <= bounds.xMax + 4; x += 2) {
    const hit = inked(contours, { x, y });
    if (hit && start === null) start = x;
    if (!hit && start !== null) {
      out.push([start, x]);
      start = null;
    }
  }
  if (start !== null) out.push([start, bounds.xMax + 4]);
  return out;
}

/** The widest white between two runs of ink along a level line. */
function widestGap(runs: Array<[number, number]>): number {
  let most = 0;
  for (let index = 1; index < runs.length; index++) {
    most = Math.max(most, runs[index][0] - runs[index - 1][1]);
  }
  return most;
}

describe("Cyrillic on every base", () => {
  const faces = ["Sans", "Technical", "Display", "Ribbon", "Serif"];

  it("stands the stems of a sha, a tse and a dzhe on the line with the shelf, square at both corners", () => {
    /*
     * The stems stopped at the middle of the shelf and the shelf stopped at
     * the middle of the stems, so the outer half of each foot was paper: a
     * stepped notch at both bottom corners of every one of these.
     */
    for (const face of faces) {
      const style = at(face);
      for (const name of ["Ш", "ш", "Щ", "Ц", "ц", "Џ"]) {
        const contours = ink(name, style);
        const left = across(contours, style.metrics.xHeight * 0.4)[0][0];
        expect(inked(contours, { x: left + 4, y: 3 }), `${face} ${name}`).toBe(true);
      }
    }
  });

  it("leaves the top of a tse open, where it once carried a pe's bar", () => {
    for (const face of faces) {
      const style = at(face);
      const contours = ink("Ц", style);
      expect(across(contours, style.metrics.capHeight - 6).length, face).toBe(2);
    }
  });

  it("gives the soft signs, the ya and the ve a counter at a fat face's own weight", () => {
    const style = at("Display");
    const pen = style.pen.weight;
    for (const [name, y] of [
      ["Ь", style.metrics.capHeight * 0.28],
      ["ь", style.metrics.xHeight * 0.3],
      ["ы", style.metrics.xHeight * 0.3],
      ["ъ", style.metrics.xHeight * 0.3],
      ["я", style.metrics.xHeight * 0.72],
    ] as const) {
      const gap = widestGap(across(ink(name, style), y));
      expect(gap, name).toBeGreaterThan(pen * 0.35);
    }
  });
});

describe("Greek on the display bases", () => {
  it("opens both counters of an omega at a fat face's weight", () => {
    const style = at("Display");
    const runs = across(ink("ω", style), style.metrics.xHeight * 0.4);
    expect(runs.length).toBe(3);
    expect(runs[1][0] - runs[0][1]).toBeGreaterThan(style.pen.weight * 0.35);
    expect(runs[2][0] - runs[1][1]).toBeGreaterThan(style.pen.weight * 0.35);
  });

  it("runs the sigma's bar out level with the top of its bowl", () => {
    for (const face of ["Technical", "Ribbon", "Display"]) {
      const contours = ink("σ", at(face));
      const b = contoursBounds(contours);
      // The ink's top at the tip of the bar, and over the middle of the bowl.
      const top = (x: number): number => {
        for (let y = b.yMax + 2; y > 0; y -= 1) if (inked(contours, { x, y })) return y;
        return 0;
      };
      expect(Math.abs(top(b.xMax - 4) - top((b.xMin + b.xMax) * 0.4)), face).toBeLessThan(5);
    }
  });
});

describe("the ash", () => {
  it("keeps a counter in its A half, on a fat face and a light one alike", () => {
    for (const face of ["Display", "Technical", "Ribbon", "Sans"]) {
      const style = at(face);
      const runs = across(ink("AE", style), style.metrics.capHeight * 0.66);
      expect(runs.length, face).toBeGreaterThanOrEqual(2);
      expect(runs[1][0] - runs[0][1], face).toBeGreaterThan(style.pen.weight * 0.3);
    }
  });
});

describe("the fat face at its own weight and past it", () => {
  it("cuts the flat-topped A level on the cap line, with nothing standing over it", () => {
    for (const weight of [30, undefined, 260]) {
      const style = at("Display", weight);
      const b = contoursBounds(ink("A", style));
      expect(b.yMax, `${weight}`).toBeLessThan(style.metrics.capHeight + 1);
    }
  });

  it("sets the percent's slash clear of both rings", () => {
    const style = at("Display");
    const runs = across(ink("percent", style), style.metrics.capHeight * 0.72);
    // The upper ring's two walls, and the slash apart from them.
    expect(runs.length).toBeGreaterThanOrEqual(3);
  });

  it("sets the two strokes of a double quote apart by more than a stroke at a hairline", () => {
    const style = at("Display", 30);
    const runs = across(ink("quotedbl", style), style.metrics.capHeight - 20);
    expect(runs.length).toBe(2);
    expect(runs[1][0] - runs[0][1]).toBeGreaterThan(runs[0][1] - runs[0][0]);
  });
});

describe("the heavier display bases", () => {
  it("keeps the Flared N's diagonal clear of its stems past a Bold", () => {
    const bold = at("Flared", 200);
    expect(across(ink("N", bold), bold.metrics.capHeight * 0.5).length).toBe(3);
    // At the heaviest the diagonal fills the middle, and each counter is left.
    const black = at("Flared", 260);
    const N = ink("N", black);
    expect(across(N, black.metrics.capHeight * 0.8).length).toBe(2);
    expect(across(N, black.metrics.capHeight * 0.2).length).toBe(2);
  });

  it("does not box the Wavy z in its own serifs at the heaviest pen", () => {
    const style = at("Wavy", 260);
    expect(across(ink("z", style), style.metrics.xHeight * 0.5).length).toBe(1);
  });

  it("keeps the eye of a Fairground e open at the heaviest pen", () => {
    const style = at("Fairground", 260);
    const contours = ink("e", style);
    const b = contoursBounds(contours);
    const middle = (b.xMin + b.xMax) / 2;
    let runs = 0;
    let inside = false;
    for (let y = b.yMin - 2; y <= b.yMax + 2; y += 2) {
      const hit = inked(contours, { x: middle, y });
      if (hit && !inside) runs += 1;
      inside = hit;
    }
    // Crown, bar and foot, with paper between each.
    expect(runs).toBe(3);
  });
});

describe("the details a review found on the display bases", () => {
  it("dots an i and a j with a dot at least as wide as the stem", () => {
    for (const face of ["Technical", "Ribbon", "Wavy"]) {
      const style = at(face);
      for (const name of ["i", "j"]) {
        const contours = ink(name, style);
        const b = contoursBounds(contours);
        const dotRuns = across(contours, b.yMax - style.pen.weight * 0.5);
        const dot = dotRuns[dotRuns.length - 1];
        expect(dot[1] - dot[0], `${face} ${name}`).toBeGreaterThanOrEqual(style.pen.weight * 0.95);
      }
    }
  });

  it("gives the dotless j the serif its dotted one wears", () => {
    for (const face of ["Wavy", "Fairground"]) {
      const style = at(face);
      const width = (name: string) => {
        const runs = across(ink(name, style), style.metrics.xHeight - 3);
        return runs[runs.length - 1][1] - runs[0][0];
      };
      expect(width("dotlessj"), face).toBeCloseTo(width("j"), -1);
    }
  });

  it("stands the Fairground k's vee inside its stem, with no spur out of the far side", () => {
    const style = at("Fairground");
    const contours = ink("k", style);
    const stem = across(contours, style.metrics.xHeight * 0.8)[0][0];
    const waist = across(contours, style.metrics.xHeight * 0.42)[0][0];
    expect(waist).toBeGreaterThanOrEqual(stem - 2);
  });
});
