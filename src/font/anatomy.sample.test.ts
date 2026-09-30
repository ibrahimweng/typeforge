/**
 * The named parts on a real font.
 *
 * The synthetic shapes in anatomy.test.ts pin down the rules one at a time;
 * this runs them over every letter and figure of the bundled sample font,
 * which is where the first version went wrong. It found crossbars in B, P, R,
 * G, a, i, j and 3, shoulders in c, u, g, q and C, and left a, e, f and g
 * crossing themselves at ordinary settings.
 */

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import { findCrossbar, findShoulders, shiftCrossbar, shiftShoulders } from "./anatomy";
import { contourSegments, cubicAt, inkRunsAt } from "./geometry";
import { contoursIntersect } from "./outline";
import { importFont } from "./parse";
import { resolveGlyphContours } from "./transform";
import { type Contour, DEFAULT_PARAMS, type Typeface } from "./types";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

let typeface: Typeface;
const outlines = new Map<string, Contour[]>();

beforeAll(async () => {
  const bytes = new Uint8Array(readFileSync("src/assets/typeforge-sample.ttf"));
  typeface = (await importFont(bytes, "sample.ttf")).typeface;
  typeface.params = { ...DEFAULT_PARAMS };
  for (const letter of LETTERS) {
    const glyph = typeface.glyphs.find((one) => one.unicodes.includes(letter.codePointAt(0) ?? 0));
    if (glyph) outlines.set(letter, resolveGlyphContours(glyph, typeface));
  }
});

/** How far the outline actually reaches, curves included, by sampling them. */
function inkExtent(contours: Contour[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const contour of contours) {
    for (const segment of contourSegments(contour)) {
      for (let i = 0; i <= 32; i++) {
        const point =
          segment.kind === "line"
            ? segment.from
            : cubicAt(segment.from, segment.c1, segment.c2, segment.to, i / 32);
        xs.push(point.x);
        ys.push(point.y);
      }
    }
  }
  return {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
}

const outline = (letter: string): Contour[] => {
  const found = outlines.get(letter);
  if (!found) throw new Error(`no ${letter} in the sample font`);
  return found;
};

describe("the crossbar on the sample font", () => {
  it("is found on the letters that have one", () => {
    for (const letter of "AEFHe4BPR") expect(findCrossbar(outline(letter)), letter).not.toBeNull();
  });

  /**
   * G has a bar that is not held by anything on one side, and a, i, j and 3
   * straight pieces that happen to face each other across the middle.
   */
  it("is not found where there is none, and those letters are left alone", () => {
    for (const letter of "Gaijs3kKoOnmS") {
      const contours = outline(letter);
      expect(findCrossbar(contours), letter).toBeNull();
      expect(shiftCrossbar(contours, 0.08 * typeface.unitsPerEm), letter).toBe(contours);
    }
  });

  it("moves the bar of an H by the amount asked, and nothing else", () => {
    const H = outline("H");
    const before = findCrossbar(H)!;
    const after = findCrossbar(shiftCrossbar(H, 100))!;
    expect(after.bottom).toBeCloseTo(before.bottom + 100, 6);
    expect(after.top).toBeCloseTo(before.top + 100, 6);
  });

  /**
   * The waist of B, P and R moves by the amount asked, the bowls redrawn
   * around it: the letter keeps its height and every node, nothing crosses,
   * and no curve bulges out past the bowl as drawn.
   */
  it("moves the waist of B, P and R and redraws the bowls cleanly", () => {
    for (const letter of "BPR") {
      const before = outline(letter);
      const bar = findCrossbar(before)!;
      const was = inkExtent(before);
      for (const shift of [-100, 100, -164, 164]) {
        const label = `${letter} ${shift}`;
        const after = shiftCrossbar(before, shift);
        expect(
          after.map((contour) => contour.nodes.length),
          label,
        ).toEqual(before.map((contour) => contour.nodes.length));
        expect(findCrossbar(after)!.bottom - bar.bottom, label).toBeCloseTo(shift, 6);
        expect(contoursIntersect(after), label).toBe(false);
        const now = inkExtent(after);
        const give = (was.xMax - was.xMin) * 0.01;
        expect(now.yMin, label).toBeCloseTo(was.yMin, 3);
        expect(now.yMax, label).toBeCloseTo(was.yMax, 3);
        expect(now.xMin, label).toBeGreaterThanOrEqual(was.xMin - give);
        expect(now.xMax, label).toBeLessThanOrEqual(was.xMax + give);
      }
    }
  });

  it("moves the bar of an e and keeps its bowl the weight it was", () => {
    /*
     * Sliding the bar's ends round the bowl alone bent the curves either side
     * to meet them: the bowl swelled into a blob on one side and the eye came
     * to a point, and the letter changed weight. Moved by spreading the eye,
     * the bar moves and the ink stays what it was.
     */
    const before = outline("e");
    const area = (contours: Contour[]) =>
      Math.abs(
        contours.reduce((sum, contour) => {
          let twice = 0;
          for (const segment of contourSegments(contour))
            for (let i = 0; i < 16; i++) {
              const at = (t: number) =>
                segment.kind === "line"
                  ? {
                      x: segment.from.x + (segment.to.x - segment.from.x) * t,
                      y: segment.from.y + (segment.to.y - segment.from.y) * t,
                    }
                  : cubicAt(segment.from, segment.c1, segment.c2, segment.to, t);
              const a = at(i / 16);
              const b = at((i + 1) / 16);
              twice += a.x * b.y - b.x * a.y;
            }
          return sum + twice / 2;
        }, 0),
      );
    const bar = findCrossbar(before)!;
    for (const shift of [-164, 164]) {
      const after = shiftCrossbar(before, shift);
      expect(contoursIntersect(after), `${shift}`).toBe(false);
      const moved = findCrossbar(after)!.bottom - bar.bottom;
      expect(Math.sign(moved), `${shift}`).toBe(Math.sign(shift));
      expect(Math.abs(moved), `${shift}`).toBeGreaterThan(Math.abs(shift) * 0.4);
      expect(area(after) / area(before), `${shift}`).toBeGreaterThan(0.95);
      expect(area(after) / area(before), `${shift}`).toBeLessThan(1.05);
    }
  });

  it("never leaves a letter crossing itself", () => {
    const em = typeface.unitsPerEm;
    for (const letter of LETTERS) {
      const contours = outline(letter);
      if (contoursIntersect(contours)) continue;
      for (const amount of [0.08, -0.08, 0.2, -0.2]) {
        expect(contoursIntersect(shiftCrossbar(contours, amount * em)), `${letter} ${amount}`).toBe(
          false,
        );
      }
    }
  });
});

describe("the shoulder on the sample font", () => {
  it("is found on the arch letters", () => {
    for (const letter of "nmhr")
      expect(findShoulders(outline(letter)).length, letter).toBeGreaterThan(0);
  });

  /** Both arches of the m, the second springing from a stem that stops under it. */
  it("is found on both arches of an m", () => {
    const xs = findShoulders(outline("m")).map((point) => point.x);
    const n = findShoulders(outline("n")).map((point) => point.x);
    expect(Math.max(...xs)).toBeGreaterThan(Math.max(...n) + 100);
  });

  it("is not found on letters with no arch, and those letters are left alone", () => {
    for (const letter of "HEBRPIcCugqdaos") {
      const contours = outline(letter);
      expect(findShoulders(contours), letter).toHaveLength(0);
      expect(shiftShoulders(contours, 0.06 * typeface.unitsPerEm), letter).toBe(contours);
    }
  });

  it("never leaves a letter crossing itself", () => {
    const em = typeface.unitsPerEm;
    for (const letter of LETTERS) {
      const contours = outline(letter);
      if (contoursIntersect(contours)) continue;
      for (const amount of [0.06, -0.06, 0.2, -0.2]) {
        expect(
          contoursIntersect(shiftShoulders(contours, amount * em)),
          `${letter} ${amount}`,
        ).toBe(false);
      }
    }
  });
});

describe("the x-height on the sample font", () => {
  const at = (letter: string, xHeightScale: number): Contour[] => {
    const glyph = typeface.glyphs.find((one) => one.unicodes.includes(letter.codePointAt(0) ?? 0))!;
    return resolveGlyphContours({ ...glyph, params: { xHeightScale } }, typeface);
  };
  /*
   * It was a plain vertical scale of everything above the baseline: capitals
   * and ascenders grew with it, and the top and bottom of an o thickened with
   * the scale while its sides kept their width.
   */
  it("moves the top of the lowercase and nothing else", () => {
    const xHeight = typeface.metrics.xHeight;
    for (const factor of [0.8, 1.25]) {
      expect(inkExtent(at("H", factor)).yMax, `H ${factor}`).toBeCloseTo(
        inkExtent(outline("H")).yMax,
        3,
      );
      // An ascender keeps most of its height: squeezed
      // hard, the hook of an f gives some of the change back.
      expect(
        Math.abs(inkExtent(at("b", factor)).yMax - inkExtent(outline("b")).yMax),
        `b ${factor}`,
      ).toBeLessThan(Math.abs(factor - 1) * xHeight * 0.4);
      const o = inkExtent(at("o", factor));
      expect(o.yMax - inkExtent(outline("o")).yMax, `o ${factor}`).toBeCloseTo(
        (factor - 1) * xHeight,
        0,
      );
    }
  });

  it("keeps the top and bottom of an o as thick as they were", () => {
    const middle = (inkExtent(outline("o")).xMin + inkExtent(outline("o")).xMax) / 2;
    const [bottom, top] = inkRunsAt(outline("o"), middle, "x").map(([from, to]) => to - from);
    for (const factor of [0.8, 1.25]) {
      const runs = inkRunsAt(at("o", factor), middle, "x").map(([from, to]) => to - from);
      expect(runs[0] / bottom, `bottom ${factor}`).toBeGreaterThan(0.93);
      expect(runs[0] / bottom, `bottom ${factor}`).toBeLessThan(1.07);
      expect(runs[runs.length - 1] / top, `top ${factor}`).toBeGreaterThan(0.93);
      expect(runs[runs.length - 1] / top, `top ${factor}`).toBeLessThan(1.07);
    }
  });
});
