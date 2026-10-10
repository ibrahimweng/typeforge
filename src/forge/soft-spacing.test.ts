/**
 * The Soft Serif spaced as one system, not a side at a time.
 *
 * Its spacing was first fitted letter by letter to the pairs in the text it
 * was drawn to match, and that left two stems that are the same shape spaced
 * differently: the n stood 28 units off the letter after it while the h, the
 * m and the i stood 15 to 18, and the p 14 off the letter before it and 52
 * off the one after, so "input", "happy", "nap" and "hn" set unevenly. Letters
 * that were not in that text kept the Serif's sides, which no longer agreed
 * with the ones beside them that were.
 *
 * So the sides are set by shape (see `SIDES` in `starts.ts`), and here that is
 * held: every side of one shape has one value; in common words set as the
 * font sets them -- each letter's own advance and the face's measured kerning
 * -- the gaps between two stems differ by no more than four units, and so do
 * those between a bowl and a stem, a stem and a bowl, and two bowls, a bowl
 * and a stem either way round among them; that holds at every weight and width
 * the family is drawn through; and no two lowercase letters touch.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contoursBounds } from "@/font/geometry";
import { drawLetter } from "./build";
import { formOf, startFrom } from "./document";
import { widthedStyle } from "./family";
import { nearestBetween, profileOf } from "./kern";
import { readyToShape } from "./layers";
import { SOFT_SERIF } from "./starts";
import type { Style } from "./style";
import { toTypeface } from "./typeface";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

/** The sides of one shape: the letters whose left (0) or right (1) side it is. */
const SHAPES: Array<{
  shape: string;
  kind: "stem" | "bowl" | "slant";
  side: 0 | 1;
  letters: string;
}> = [
  { shape: "stem, left", kind: "stem", side: 0, letters: "bfhiklmnpru" },
  { shape: "stem, right", kind: "stem", side: 1, letters: "dhilmnqu" },
  { shape: "bowl, left", kind: "bowl", side: 0, letters: "acdeoq" },
  { shape: "bowl, right", kind: "bowl", side: 1, letters: "bceop" },
  { shape: "slant, left", kind: "slant", side: 0, letters: "vwy" },
  { shape: "slant, right", kind: "slant", side: 1, letters: "vwy" },
  { shape: "capital stem, left", kind: "stem", side: 0, letters: "BDEFHIKLNPR" },
  { shape: "capital stem, right", kind: "stem", side: 1, letters: "HI" },
  { shape: "capital bowl, left", kind: "bowl", side: 0, letters: "CGOQ" },
  { shape: "capital bowl, right", kind: "bowl", side: 1, letters: "DO" },
];

/** The words the review found set unevenly, and a few more of their kind. */
const WORDS = [
  "minimum",
  "input",
  "happy",
  "nap",
  "hnmnin",
  "lollipop",
  "abcdefghijklmnopqrstuvwxyz",
  "Hamburgefonstiv",
  "HIHOHODODH",
  "NOON",
];

/** How far apart two gaps of one kind may be, in font units. */
const EVEN = 4;

/** What a side is: "S" a stem, "R" a bowl, or nothing this measures. */
function kindOf(letter: string, side: 0 | 1): "S" | "R" | null {
  for (const one of SHAPES) {
    if (one.side === side && one.letters.includes(letter)) {
      return one.kind === "stem" ? "S" : one.kind === "bowl" ? "R" : null;
    }
  }
  return null;
}

/**
 * Every pair in the words whose two facing sides are a stem or a bowl, by kind
 * ("SS", "RS", "SR", "RR", the capitals' with a "C" before), with the white
 * between the two letters' ink.
 */
function gapsByKind(
  gapOf: (left: string, right: string) => number,
): Map<string, Map<string, number>> {
  const kinds = new Map<string, Map<string, number>>();
  for (const word of WORDS) {
    for (let index = 0; index + 1 < word.length; index++) {
      const left = word[index];
      const right = word[index + 1];
      const a = kindOf(left, 1);
      const b = kindOf(right, 0);
      const capital = left === left.toUpperCase();
      if (!a || !b || capital !== (right === right.toUpperCase())) continue;
      const kind = `${capital ? "C" : ""}${a}${b}`;
      const found = kinds.get(kind) ?? new Map<string, number>();
      found.set(left + right, gapOf(left, right));
      kinds.set(kind, found);
    }
  }
  return kinds;
}

/** Where the gaps of one kind (or of several taken together) spread wider than `EVEN`. */
function uneven(kinds: Map<string, Map<string, number>>, label: string): string[] {
  const out: string[] = [];
  const check = (name: string, gaps: Map<string, number>) => {
    const values = [...gaps.values()];
    const spread = Math.max(...values) - Math.min(...values);
    if (spread > EVEN) {
      const listed = [...gaps].map(([pair, gap]) => `${pair} ${gap.toFixed(1)}`).join(", ");
      out.push(`${label} ${name}: ${spread.toFixed(2)} (${listed})`);
    }
  };
  for (const [kind, gaps] of kinds) check(kind, gaps);
  for (const prefix of ["", "C"]) {
    const either = new Map([
      ...(kinds.get(`${prefix}RS`) ?? []),
      ...(kinds.get(`${prefix}SR`) ?? []),
    ]);
    if (either.size > 0) check(`${prefix}RS+${prefix}SR`, either);
  }
  return out;
}

describe("the Soft Serif's spacing", () => {
  it("gives every side of one shape one value", () => {
    const sides = SOFT_SERIF.metrics.sides!;
    const split: string[] = [];
    for (const { shape, side, letters } of SHAPES) {
      const values = new Set<number | undefined>(
        [...letters].map((letter) => sides[letter]?.[side]),
      );
      if (values.size !== 1 || values.has(undefined)) {
        split.push(
          `${shape}: ${[...letters].map((letter) => `${letter} ${sides[letter]?.[side]}`).join(", ")}`,
        );
      }
    }
    expect(split).toEqual([]);
  });

  it("sets the words evenly as the font sets them, with its kerning", async () => {
    const face = await toTypeface(startFrom(SOFT_SERIF), {
      familyName: "Soft",
      styleName: "Regular",
      merge: true,
      kern: true,
    });
    const glyphOf = (letter: string) => {
      const glyph = face.glyphs.find((one) => one.unicodes.includes(letter.codePointAt(0)!));
      if (!glyph) throw new Error(`no ${letter}`);
      return glyph;
    };
    const kern = (left: string, right: string) =>
      face.kernClasses
        .filter((one) => one.left.includes(left) && one.right.includes(right))
        .reduce((total, one) => total + one.value, 0);
    const kinds = gapsByKind((left, right) => {
      const a = glyphOf(left);
      const b = glyphOf(right);
      return (
        a.advanceWidth -
        contoursBounds(a.contours).xMax +
        contoursBounds(b.contours).xMin +
        kern(a.name, b.name)
      );
    });
    // The four lowercase kinds and the capitals' are all there to be measured.
    expect([...kinds.keys()].sort()).toEqual(["CRR", "CRS", "CSR", "CSS", "RR", "RS", "SR", "SS"]);
    expect(uneven(kinds, "Regular")).toEqual([]);

    // And no two lowercase letters set into each other.
    const lower = "abcdefghijklmnopqrstuvwxyz".split("").map(glyphOf);
    const box = contoursBounds(lower.flatMap((glyph) => glyph.contours));
    const heights = Array.from(
      { length: 120 },
      (_, row) => box.yMin + ((box.yMax - box.yMin) * row) / 119,
    );
    const profiles = lower.map((glyph) => profileOf(glyph.contours, glyph.advanceWidth, heights));
    const touching: string[] = [];
    for (const [i, a] of lower.entries()) {
      for (const [j, b] of lower.entries()) {
        const nearest = nearestBetween(profiles[i], profiles[j]);
        if (nearest !== null && nearest + kern(a.name, b.name) <= 0) touching.push(a.name + b.name);
      }
    }
    expect(touching).toEqual([]);
  });

  it("keeps the rhythm at every weight and width the family is drawn through", () => {
    const forge = startFrom(SOFT_SERIF);
    const form = (name: string) => formOf(forge, name) || undefined;
    const found: string[] = [];
    for (const pen of [30, 87, 142, 194, 260]) {
      for (const width of [75, 100, 125]) {
        const style: Style = widthedStyle(
          { ...SOFT_SERIF, pen: { ...SOFT_SERIF.pen, weight: pen } },
          width,
        );
        const drawn = new Map<string, { advance: number; xMin: number; xMax: number }>();
        const of = (letter: string) => {
          let one = drawn.get(letter);
          if (!one) {
            const letterDrawn = drawLetter(letter, style, form(letter))!;
            const bounds = contoursBounds(letterDrawn.contours);
            one = { advance: letterDrawn.advanceWidth, xMin: bounds.xMin, xMax: bounds.xMax };
            drawn.set(letter, one);
          }
          return one;
        };
        const kinds = gapsByKind(
          (left, right) => of(left).advance - of(left).xMax + of(right).xMin,
        );
        found.push(...uneven(kinds, `${pen}/${width}`));
      }
    }
    expect(found).toEqual([]);
  });
});
