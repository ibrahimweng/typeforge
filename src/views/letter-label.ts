/**
 * How a letter of the drawing is named on a button: by the character itself.
 *
 * The warnings strip used to print glyph names, so a warning about the
 * cedilla read "ccedilla scommaaccent" beside a "δ" that happens to be named
 * after itself. The character is what somebody drawing recognises; the name
 * stays in the tooltip for anybody who wants it. A mark on its own is shown on
 * a dotted circle, the way a character chart shows one, so it is not an accent
 * stacked on the space before it; a name with no character, like a ligature
 * nobody types, is shown as it is.
 */

import { codepointFor } from "@/forge/typeface";

const COMBINING: Array<[number, number]> = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
];

export function letterLabel(name: string): string {
  const codepoint = codepointFor(name);
  if (codepoint === null || codepoint <= 0x20) return name;
  const character = String.fromCodePoint(codepoint);
  const mark = COMBINING.some(([from, to]) => codepoint >= from && codepoint <= to);
  return mark ? `◌${character}` : character;
}
