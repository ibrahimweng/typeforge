/**
 * Sorting a font's glyphs into the piles a person thinks in.
 *
 * The grid used to be one flat run of every glyph in codepoint order, which is
 * the order the file stores them in and nobody's order for looking at them. On
 * a text face of two hundred glyphs that is survivable. On a face like DejaVu
 * it is six thousand two hundred and fifty-three cells with the lowercase
 * somewhere near the top and the Cyrillic somewhere past the middle, and the
 * only way to find anything is the search box -- which requires already knowing
 * what you are looking for.
 *
 * The Assemble view next door had this right from the start: seven named
 * groups, each with a count, each a section you can scan or skip. This is that,
 * widened to cope with a whole font rather than a set of slots somebody is
 * filling. The first seven names are deliberately the same words, because the
 * two views are doing the same job and a product that calls the same pile two
 * different things in two places is a product that was not thought about.
 *
 * Past the Latin the groups are scripts and blocks, which is what every font
 * tool uses and what the glyphs themselves are organised by. The line between
 * "a group worth naming" and "everything else" is drawn by what somebody would
 * plausibly go looking for as a set.
 */

import type { Glyph } from "./types";

export interface GlyphGroup {
  name: string;
  glyphs: Glyph[];
}

/**
 * Whether a codepoint is a capital or a small letter.
 *
 * Asked of the character rather than of a range, because the Latin blocks
 * interleave the two: `À` through `Þ` and `ß` through `ÿ` are one run in the
 * file, and Latin Extended-A alternates case pair by pair for a hundred and
 * twenty-eight codepoints. A range table would have to list them individually
 * and would be wrong the first time a font contained one it had missed.
 */
function caseOf(codepoint: number): "upper" | "lower" | "neither" {
  const character = String.fromCodePoint(codepoint);
  const upper = character.toUpperCase();
  const lower = character.toLowerCase();
  if (upper === lower) return "neither";
  return character === lower ? "lower" : "upper";
}

/**
 * The groups, in the order they are shown, and the test each one applies.
 *
 * First match wins, so the order is also the precedence: the basic Latin tests
 * come before the wider Latin ones, and `Everything else` is not in the list at
 * all -- it is what is left when nothing here claimed a glyph.
 */
const GROUPS: Array<{ name: string; holds: (codepoint: number) => boolean }> = [
  { name: "Capitals", holds: (c) => c >= 0x41 && c <= 0x5a },
  { name: "Lowercase", holds: (c) => c >= 0x61 && c <= 0x7a },
  { name: "Figures", holds: (c) => c >= 0x30 && c <= 0x39 },
  {
    name: "Punctuation",
    holds: (c) =>
      (c >= 0x21 && c <= 0x2f) ||
      (c >= 0x3a && c <= 0x40) ||
      (c >= 0x5b && c <= 0x60) ||
      (c >= 0x7b && c <= 0x7e) ||
      // The general punctuation block: the dashes, the real quotes, the
      // ellipsis. Sitting with their ASCII stand-ins is where somebody
      // comparing a hyphen against an en dash would look for them.
      (c >= 0x2010 && c <= 0x203a),
  },
  { name: "Space", holds: (c) => c === 0x20 || c === 0xa0 || (c >= 0x2000 && c <= 0x200b) },
  {
    // Before the accented groups, because these are unmistakably marks rather
    // than letters and half of them report a case they do not have.
    name: "Marks",
    holds: (c) => (c >= 0x300 && c <= 0x36f) || (c >= 0x2b0 && c <= 0x2ff),
  },
  {
    name: "Accented capitals",
    holds: (c) => c >= 0xc0 && c <= 0x24f && caseOf(c) === "upper",
  },
  {
    name: "Accented lowercase",
    holds: (c) => c >= 0xc0 && c <= 0x24f && caseOf(c) === "lower",
  },
  { name: "Greek", holds: (c) => (c >= 0x370 && c <= 0x3ff) || (c >= 0x1f00 && c <= 0x1fff) },
  { name: "Cyrillic", holds: (c) => (c >= 0x400 && c <= 0x52f) || (c >= 0x2de0 && c <= 0x2dff) },
  { name: "Hebrew", holds: (c) => c >= 0x590 && c <= 0x5ff },
  { name: "Arabic", holds: (c) => (c >= 0x600 && c <= 0x6ff) || (c >= 0xfb50 && c <= 0xfeff) },
  {
    name: "Currency and maths",
    holds: (c) =>
      (c >= 0x20a0 && c <= 0x20cf) ||
      (c >= 0x2190 && c <= 0x22ff) ||
      (c >= 0x2a00 && c <= 0x2aff) ||
      (c >= 0xa2 && c <= 0xa5),
  },
  { name: "Symbols", holds: (c) => (c >= 0xa1 && c <= 0xbf) || (c >= 0x2600 && c <= 0x27bf) },
  { name: "Boxes and blocks", holds: (c) => c >= 0x2500 && c <= 0x259f },
];

/** What a glyph with no codepoint of its own is filed under. */
const UNENCODED = "Unencoded";
/** What a glyph that matched nothing is filed under. */
const REST = "Everything else";

/** Which pile one glyph belongs in. */
export function groupOf(glyph: Glyph): string {
  const codepoint = glyph.unicodes[0];
  // A ligature, an alternate, `.notdef` -- real glyphs that no character maps
  // to. They are reached from a feature or from this grid and nowhere else,
  // which is a reason to keep them rather than a reason to hide them.
  if (codepoint === undefined) return UNENCODED;
  for (const group of GROUPS) {
    if (group.holds(codepoint)) return group.name;
  }
  return REST;
}

/**
 * A font's glyphs as named piles, in the order somebody reads them.
 *
 * Empty groups are dropped rather than shown at zero. A section header that
 * says "Cyrillic 0" is a line of furniture about something the font does not
 * have, and on a filtered list -- which is the case that matters, because
 * filtering is when the count means something -- it would be most of the page.
 */
export function groupGlyphs(glyphs: readonly Glyph[]): GlyphGroup[] {
  const piles = new Map<string, Glyph[]>();
  for (const glyph of glyphs) {
    const name = groupOf(glyph);
    const pile = piles.get(name);
    if (pile) pile.push(glyph);
    else piles.set(name, [glyph]);
  }

  const order = [...GROUPS.map((group) => group.name), REST, UNENCODED];
  const found: GlyphGroup[] = [];
  for (const name of order) {
    const glyphsInGroup = piles.get(name);
    if (glyphsInGroup && glyphsInGroup.length > 0) found.push({ name, glyphs: glyphsInGroup });
  }
  return found;
}
