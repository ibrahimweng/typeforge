/**
 * Kerning that is measured rather than typed in.
 *
 * The claims are different in kind, and the first is the one that makes the
 * rest safe. A font's sidebearings are its spacing system, and they are already
 * a good one here -- so a measurement that wants to move the plainest pairs is
 * a measurement arguing with the spacing rather than correcting it. Two earlier
 * versions of this did: measured as a plain distance `nn` asked to be pushed
 * apart by thirty-three units, and measured as area `HH` asked for
 * seventy-four. Both would have taken the rhythm out of the font.
 */

import { describe, expect, it } from "vitest";

import { drawnAs } from "./accents";
import { builtFrom, drawLetter, letterNames } from "./build";
import { kernsFor, type KernInput } from "./kern";
import { BASES, SANS, type Style } from "./style";
import type { KernClass } from "@/font/types";

function lettersOf(style: Style): KernInput[] {
  const found: KernInput[] = [];
  for (const name of letterNames()) {
    const drawn = drawLetter(name, style);
    if (!drawn) continue;
    found.push({
      name,
      contours: drawn.contours,
      advanceWidth: drawn.advanceWidth,
      sameAs: builtFrom(name)?.base,
    });
  }
  return found;
}

/*
 * A character that has no drawing of its own is kerned under the name of the
 * letter that draws it: a Cyrillic `Г` is a Greek `Γ`, and the classes are
 * lists of glyphs rather than of characters.
 */
const under = (character: string) => drawnAs(character) ?? character;

/** What a pair is actually moved by, looked up the way a shaper would. */
function kernOf(classes: KernClass[], leftName: string, rightName: string): number {
  const left = under(leftName);
  const right = under(rightName);
  let total = 0;
  for (const one of classes) {
    if (one.left.includes(left) && one.right.includes(right)) total += one.value;
  }
  return total;
}

describe("kerning worked out from the letters", () => {
  const classes = kernsFor(lettersOf(SANS), SANS.metrics.unitsPerEm).classes;

  /**
   * The one that matters most: the spacing system is left alone.
   *
   * These are the pairs the sidebearings were set against, so whatever the
   * measurement says about them it must say nothing. Anything else is the
   * kerning re-spacing the font behind the spacing's back.
   */
  it("leaves the pairs the font was spaced on exactly where they were", () => {
    for (const [left, right] of [
      ["n", "n"],
      ["n", "o"],
      ["o", "n"],
      ["o", "o"],
      ["H", "H"],
      ["H", "O"],
      ["O", "H"],
      ["O", "O"],
    ]) {
      expect(kernOf(classes, left, right), `${left}${right} moved`).toBe(0);
    }
  });

  /**
   * And the pairs that are visibly open are closed, in all three alphabets.
   *
   * Named rather than counted, because a count says nothing: a measurement that
   * closed every pair in the font by a hair would pass a count and ruin the
   * type. These are the pairs a reader notices when a font has not been kerned.
   */
  it("closes the pairs that stand open, in every alphabet it draws", () => {
    const open: Array<[string, string]> = [
      ["A", "V"],
      ["A", "T"],
      ["T", "o"],
      ["T", "a"],
      ["L", "T"],
      ["P", "comma"],
      ["F", "period"],
      ["Г", "А"],
      ["У", "Д"],
      ["Т", "а"],
      ["Γ", "Α"],
      ["Τ", "α"],
    ];
    for (const [left, right] of open) {
      expect(kernOf(classes, left, right), `${left}${right} was left open`).toBeLessThan(0);
    }
  });

  /**
   * An accented letter kerns as the letter it is drawn from.
   *
   * Not measured again: the accent is above everything it will ever stand
   * beside, and putting the whole family in one class is both what every font
   * does and what keeps this from being four hundred and fifty-one squared.
   */
  it("kerns an accented letter as the letter under it", () => {
    for (const [accented, base] of [
      ["Aacute", "A"],
      ["Agrave", "A"],
      ["Ά", "Α"],
    ]) {
      for (const right of ["V", "T", "o"]) {
        expect(
          kernOf(classes, accented, right),
          `${accented}${right} against ${base}${right}`,
        ).toBe(kernOf(classes, base, right));
      }
    }
  });

  /**
   * And it is measured, which is the whole reason it is here.
   *
   * A list of pairs is written against one drawing. These letters are not a
   * drawing -- turn the weight up and every edge moves -- so the same pair has
   * to come out differently at a different weight, and on a different face.
   * A table could not do that, and this is the test that this is not a table.
   */
  it("gives a different answer at a different weight", () => {
    const thin = kernsFor(
      lettersOf({ ...SANS, pen: { ...SANS.pen, weight: 30 } }),
      SANS.metrics.unitsPerEm,
    ).classes;
    const black = kernsFor(
      lettersOf({ ...SANS, pen: { ...SANS.pen, weight: 220 } }),
      SANS.metrics.unitsPerEm,
    ).classes;
    const differ = ["A", "T", "L", "P", "F", "o", "a", "y"].flatMap((left) =>
      ["V", "T", "o", "a", "period", "comma"].map(
        (right) => kernOf(thin, left, right) !== kernOf(black, left, right),
      ),
    );
    expect(differ.filter(Boolean).length).toBeGreaterThan(4);
    // And both are still corrections rather than re-spacings.
    for (const one of [thin, black]) expect(kernOf(one, "n", "n")).toBe(0);
  });

  /** Every face, because a rule that holds on one of them is a coincidence. */
  it("leaves the plain pairs alone on every face there is", () => {
    for (const base of BASES) {
      const found = kernsFor(lettersOf(base), base.metrics.unitsPerEm).classes;
      for (const [left, right] of [
        ["n", "n"],
        ["o", "o"],
        ["H", "H"],
      ]) {
        expect(kernOf(found, left, right), `${left}${right} moved on ${base.name}`).toBe(0);
      }
    }
  }, 300_000);
});
