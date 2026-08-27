/**
 * Which second drawings a joined face needs, and the rule that reaches them.
 *
 * The geometry of a join lives in `script.ts` and the bytes of a GSUB table
 * live in `font/gsub.ts`. This is the short piece between them: which letters
 * get an alternate, what it is called, and what the shaper is told about it.
 *
 * There are two kinds and no more. A letter that hands over high needs a
 * drawing whose lead-out leaves at the waist; every letter needs one whose
 * lead-in arrives there. Nothing needs both, and that is worth saying because
 * it looks as though it should: a shaper matching a two-glyph sequence carries
 * on from the end of what it matched, so in `ooo` the first pair is replaced
 * and the third `o` is examined afresh -- the middle letter is the one that
 * received high, and it hands over low to a letter that arrives low.
 */

import { HANDS_OVER_HIGH } from "./script";
import { CAPITALS, JOINS, joinEnds } from "./letters";
import type { Forge } from "./document";
import { styleFor } from "./document";
import type { NamedRule } from "@/font/types";

/** Which half of its join a second drawing takes high. */
export type HighHalf = "entry" | "exit";

/**
 * What the alternate is called in the font.
 *
 * The suffix convention every foundry uses, so a designer opening the file in
 * another editor finds what they expect: `n.init` is a letter drawn to begin
 * after something, `o.medi` one drawn to carry on into what follows.
 */
export function alternateName(letter: string, which: HighHalf): string {
  return `${letter}.${which === "entry" ? "init" : "medi"}`;
}

/**
 * Every second drawing this font needs, or nothing if it is not a joined face.
 *
 * Asked of the style each letter is actually drawn with rather than of the
 * document's base, because a letter can be given its own.
 */
export function joinsUp(forge: Forge): Array<[string, HighHalf]> {
  const wanted: Array<[string, HighHalf]> = [];
  for (const letter of [...JOINS].sort()) {
    if (!styleFor(letter, forge).parts.script.on) continue;
    wanted.push([letter, "entry"]);
    if (HANDS_OVER_HIGH.has(letter)) wanted.push([letter, "exit"]);
  }
  return wanted;
}

/**
 * The rule: where one of the four is followed by any letter, redraw both.
 *
 * One rule with two positions rather than a rule per pair. The four that hand
 * over high are one coverage and the twenty-six that can receive are another,
 * and the format matches them as sets -- spelled out pair by pair it would be a
 * hundred and four rules all saying the same thing.
 */
export function joinRules(wanted: Array<[string, HighHalf]>): NamedRule[] {
  const leaving = wanted.filter(([, which]) => which === "exit").map(([letter]) => letter);
  const arriving = wanted.filter(([, which]) => which === "entry").map(([letter]) => letter);
  if (leaving.length === 0 || arriving.length === 0) return [];
  return [
    {
      input: [leaving, arriving],
      swaps: [
        {
          at: 0,
          swap: leaving.map((letter) => ({
            plain: letter,
            alternate: alternateName(letter, "exit"),
          })),
        },
        {
          at: 1,
          swap: arriving.map((letter) => ({
            plain: letter,
            alternate: alternateName(letter, "entry"),
          })),
        },
      ],
    },
  ];
}

/**
 * What a word-end drawing is called.
 *
 * Not `.init` and `.fina`, which is what a foundry would reach for, because
 * `.init` is already taken here for a different axis entirely: the letter drawn
 * to receive a hand-over at the waist. Two conventions cannot share one suffix,
 * and of the two the one that would have to be explained is this one.
 */
export function boundaryName(letter: string, which: "begin" | "end"): string {
  return `${letter}.${which}`;
}

/**
 * Every letter that needs a drawing for one end of a word.
 *
 * A letter begins a word with no lead-in and finishes one with no lead-out, so
 * the two lists are the letters that have each half to lose. The capitals are
 * in the second and not the first: they have no lead-in to go without.
 */
export function wordEnds(forge: Forge): Array<[string, "begin" | "end"]> {
  const wanted: Array<[string, "begin" | "end"]> = [];
  for (const letter of [...JOINS, ...CAPITALS].sort()) {
    if (!styleFor(letter, forge).parts.script.on) continue;
    const ends = joinEnds(letter);
    if (ends.entry) wanted.push([letter, "begin"]);
    if (ends.exit) wanted.push([letter, "end"]);
  }
  return wanted;
}

/**
 * The two rules: a letter after a space begins a word, one before a space ends
 * it.
 *
 * The space is matched as part of the sequence and nothing is substituted at
 * its position, which is why neither of these needs a backtrack or a lookahead.
 * They are separate rules and so separate lookups, and a lookup makes its own
 * pass -- one rule doing both would consume the space and the word after it
 * would never be looked at.
 *
 * The first word of a run and the last are not caught. Nothing precedes the one
 * or follows the other, so there is no sequence to match, and a font cannot see
 * past its own string.
 */
export function wordEndRules(wanted: Array<[string, "begin" | "end"]>): NamedRule[] {
  const beginning = wanted.filter(([, which]) => which === "begin").map(([letter]) => letter);
  const ending = wanted.filter(([, which]) => which === "end").map(([letter]) => letter);
  const rules: NamedRule[] = [];
  if (beginning.length > 0) {
    rules.push({
      input: [["space"], beginning],
      swaps: [{
        at: 1,
        swap: beginning.map((letter) => ({ plain: letter, alternate: boundaryName(letter, "begin") })),
      }],
    });
  }
  if (ending.length > 0) {
    rules.push({
      input: [ending, ["space"]],
      swaps: [{
        at: 0,
        swap: ending.map((letter) => ({ plain: letter, alternate: boundaryName(letter, "end") })),
      }],
    });
  }
  return rules;
}
