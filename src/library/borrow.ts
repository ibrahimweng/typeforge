/**
 * Taking a font's rhythm without taking its letters.
 *
 * Spacing is the part of a typeface nobody looks at and everybody feels, and
 * it is also the part that takes longest to get right by hand. A set of
 * drawings can be finished and still read badly for weeks while their spacing
 * is worked out. Meanwhile every text face ever released has had that work
 * done to it by somebody who knew what they were doing.
 *
 * So this reads the rhythm off one and lays it over the other: how much white
 * a well-made face leaves beside each letter, and which pairs it pulls
 * together. Nothing is copied but the measurements, which are numbers about
 * space rather than anything drawn -- the shapes stay entirely your own, and
 * they have to, because they are what the white is being fitted around.
 *
 * Everything travels as a fraction of the em, since the two fonts are under no
 * obligation to agree on how many units an em holds and mostly do not.
 */

import { contoursBounds } from "@/font/geometry";
import { kernBetween, readGposKerning } from "@/font/gpos";
import type { Typeface } from "@/font/types";
import { glyphFor } from "./measure";

/** One letter's white, as fractions of the em. */
export interface BorrowedBearings {
  left: number;
  right: number;
  advance: number;
}

export interface Borrowed {
  familyName: string;
  /** By character. */
  bearings: Map<string, BorrowedBearings>;
  /** By "left right", as a fraction of the em. Negative pulls together. */
  kerns: Map<string, number>;
  /** How many of the characters asked for the font actually had. */
  found: number;
  asked: number;
}

/**
 * Read the spacing and kerning for a set of characters.
 *
 * Only the characters asked for, and that bound is what makes this cheap
 * enough to do on a click: a font's class kerning stands for millions of
 * pairs, and asking about six thousand of them is a few milliseconds where
 * unfolding the table is not something a browser should be asked to do.
 */
export function borrowFrom(typeface: Typeface, characters: string[]): Borrowed {
  const em = typeface.unitsPerEm || 1000;
  const bearings = new Map<string, BorrowedBearings>();
  const kerns = new Map<string, number>();

  const present: Array<{ character: string; id: number }> = [];
  for (const character of characters) {
    const glyph = glyphFor(typeface, character);
    if (!glyph) continue;
    const index = typeface.glyphs.indexOf(glyph);
    if (index < 0) continue;
    present.push({ character, id: index });

    if (glyph.contours.length === 0) {
      // A space has an advance and no ink, so it has no sidebearings to speak
      // of -- but the advance is exactly the thing worth borrowing about it.
      bearings.set(character, { left: 0, right: 0, advance: glyph.advanceWidth / em });
      continue;
    }
    const bounds = contoursBounds(glyph.contours);
    bearings.set(character, {
      left: bounds.xMin / em,
      right: (glyph.advanceWidth - bounds.xMax) / em,
      advance: glyph.advanceWidth / em,
    });
  }

  const gpos = typeface.source?.tables.get("GPOS");
  if (gpos) {
    const kerning = readGposKerning(gpos);
    for (const left of present) {
      for (const right of present) {
        const value = kernBetween(kerning, left.id, right.id);
        if (value !== 0) kerns.set(`${left.character} ${right.character}`, value / em);
      }
    }
  }
  // Anything the font wrote out pair by pair as well, which is rare on its own
  // and common alongside the classes.
  for (const pair of typeface.kerning) {
    const left = characterFor(typeface, pair.left);
    const right = characterFor(typeface, pair.right);
    if (left && right && !kerns.has(`${left} ${right}`)) {
      kerns.set(`${left} ${right}`, pair.value / em);
    }
  }

  return {
    familyName: typeface.meta.familyName,
    bearings,
    kerns,
    found: bearings.size,
    asked: characters.length,
  };
}

/** The character a glyph name stands for, where it stands for one. */
function characterFor(typeface: Typeface, name: string): string | null {
  const index = typeface.glyphIndex.get(name);
  const glyph = index === undefined ? undefined : typeface.glyphs[index];
  const code = glyph?.unicodes[0];
  return code === undefined ? null : String.fromCodePoint(code);
}

/**
 * What to change in an assembly to wear the borrowed rhythm.
 *
 * Given as adjustments rather than as absolute values, because the assembly
 * has already measured its own drawings and those measurements are about the
 * shapes -- a borrowed sidebearing is a target for the *total* white, and how
 * much of it the drawing already supplies is something only the assembly
 * knows. So this hands back the difference and lets the assembly apply it the
 * same way it applies anything a person typed.
 */
export interface Adjustment {
  character: string;
  left: number;
  right: number;
}

/**
 * Work out the adjustment for each letter.
 *
 * `measured` is what the assembly gave the letter on its own; the borrowed
 * value is what the other font gives the same letter. Both in font units of
 * the target.
 */
export function adjustmentsFor(
  borrowed: Borrowed,
  unitsPerEm: number,
  measured: Map<string, { left: number; right: number }>,
): Adjustment[] {
  const out: Adjustment[] = [];
  for (const [character, own] of measured) {
    const theirs = borrowed.bearings.get(character);
    if (!theirs) continue;
    out.push({
      character,
      left: Math.round(theirs.left * unitsPerEm - own.left),
      right: Math.round(theirs.right * unitsPerEm - own.right),
    });
  }
  return out;
}

/** The borrowed kerning, in the target's units. */
export function kernsIn(borrowed: Borrowed, unitsPerEm: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const [pair, share] of borrowed.kerns) {
    const value = Math.round(share * unitsPerEm);
    if (value !== 0) out.set(pair, value);
  }
  return out;
}
