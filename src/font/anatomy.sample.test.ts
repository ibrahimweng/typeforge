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
   * G has a bar that is not held by anything on one side, and i, j and 3
   * straight pieces that happen to face each other across the middle. (The
   * top of the bowl of a meets its stem the way the waist of a P does, a flat
   * edge flowing into the bowl, and moves as one.)
   */
  it("is not found where there is none, and those letters are left alone", () => {
    for (const letter of "Gijs3kKoOnmS") {
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
   * The waist of B, P and R moves by the amount asked with only the bar's own
   * four points, the joins to the bowls stretching after them.
   */
  it("moves the waist of B, P and R and nothing else", () => {
    for (const letter of "BPR") {
      const before = outline(letter);
      const bar = findCrossbar(before)!;
      for (const shift of [-100, 100]) {
        const after = shiftCrossbar(before, shift);
        const moved = before.flatMap((contour, ci) =>
          contour.nodes.filter((node, ni) => {
            const now = after[ci].nodes[ni].point;
            return now.x !== node.point.x || now.y !== node.point.y;
          }),
        );
        expect(moved, `${letter} ${shift}`).toHaveLength(4);
        expect(findCrossbar(after)!.bottom - bar.bottom, `${letter} ${shift}`).toBeCloseTo(
          shift,
          6,
        );
        expect(contoursIntersect(after), `${letter} ${shift}`).toBe(false);
      }
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
