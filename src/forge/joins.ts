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
import type { Forge, Without } from "./document";
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
export function boundaryName(letter: string, which: Without): string {
  return `${letter}.${which}`;
}

/**
 * Every letter that needs a drawing for one side of a join that is not there.
 *
 * A letter with nothing before it has no lead-in and one with nothing after it
 * has no lead-out, so the two lists are the letters that have each half to
 * lose. The capitals are in the second and not the first: they have no lead-in
 * to go without.
 */
export function boundaryEnds(forge: Forge): Array<[string, Without]> {
  const wanted: Array<[string, Without]> = [];
  for (const letter of [...JOINS, ...CAPITALS].sort()) {
    if (!styleFor(letter, forge).parts.script.on) continue;
    const ends = joinEnds(letter);
    if (ends.entry) wanted.push([letter, "begin"]);
    if (ends.exit) wanted.push([letter, "end"]);
    // A word of one letter has neither half. Only the letters that have both
    // to lose need the drawing: a capital alone is already its `end`, having
    // had no lead-in to begin with.
    if (ends.entry && ends.exit) wanted.push([letter, "alone"]);
  }
  return wanted;
}

/**
 * The glyphs on the far side of a join that was never going to happen.
 *
 * The join is a pair contract -- a letter's lead-out and the next letter's
 * lead-in are one stroke, drawn from both ends -- but `joinEnds` answers for
 * one letter at a time. Everywhere the two answers disagree there is half a
 * stroke reaching for something nothing drew: the `e` after a `B` running into
 * its bowl, the `d` before a comma trailing off into it.
 *
 * So the two classes are read straight off `joinEnds`, over whatever glyphs the
 * font turned out to have. The space needs no case of its own -- it is in both
 * of them, and so are the digits, the punctuation, the accented letters the
 * join layer does not reach, and the four capitals that never hand on.
 */
export function joinSides(names: string[]): { noExit: string[]; noEntry: string[] } {
  const noExit: string[] = [];
  const noEntry: string[] = [];
  for (const name of names) {
    const ends = joinEnds(name);
    if (!ends.exit) noExit.push(name);
    if (!ends.entry) noEntry.push(name);
  }
  return { noExit, noEntry };
}

/**
 * The two rules: a letter with nothing to take its lead-in loses it, and a
 * letter with nothing to take its lead-out loses that.
 *
 * The neighbour is matched as part of the sequence and nothing is substituted
 * at its position, which is why neither of these needs a backtrack or a
 * lookahead -- which this font writer has no way to emit. They are separate
 * rules and so separate lookups, and a lookup makes its own pass, so one
 * consuming a space does not stop the other from seeing it.
 *
 * Two things are still not caught, both of them for the same reason -- a font
 * cannot see past the string it was handed, and a rule needs something to
 * match:
 *
 *   - The very first glyph of a run and the very last. Nothing precedes the one
 *     or follows the other, and no rule can require what is not there: GSUB has
 *     no way to say "the start of the string". This is the one case that stays,
 *     and it is the shaper's to solve rather than the font's.
 *
 * A third used to be listed here and was never true: a run of one-letter words,
 * said to catch only every other one because the rules matched the spaces
 * either side and so spent them. They are separate rules and so separate
 * lookups, and a lookup makes its own pass over the string -- `a a a a a` was
 * already coming out with every interior word drawn as one. The rules require
 * their spaces now rather than consuming them, which changes no output and is
 * worth having anyway: it says what they mean, instead of leaning on a subtle
 * property of how lookups are applied.
 */
export function boundaryRules(
  wanted: Array<[string, Without]>,
  names: string[],
): NamedRule[] {
  const { noExit, noEntry } = joinSides(names);
  const named = (which: Without) =>
    wanted.filter(([, one]) => one === which).map(([letter]) => letter);
  const beginning = named("begin");
  const ending = named("end");
  const alone = named("alone");
  const rules: NamedRule[] = [];

  /*
   * A word of one letter, and it has to be asked first.
   *
   * `a` between two spaces needs both halves gone, and the two rules below
   * each take one -- but a lookup matches the letter `cmap` maps, so whichever
   * ran first would leave a glyph the other no longer recognises and the `a`
   * would keep the half it was not asked about. So the case is its own rule,
   * and it goes ahead of them: once the letter is `a.alone` neither of them
   * sees it, which is exactly what is wanted.
   *
   * The spaces are required rather than matched, and the sequence is one glyph
   * long: the letter itself.
   *
   * This changes no output. Matched, the two spaces were part of the sequence
   * and were spent on it, which looks as though it should leave the next word
   * short of the space it needs -- and the comment above this function said so
   * for a long time. It does not, because these are separate lookups and each
   * makes its own pass over the string. The rule is written this way because it
   * is what the rule means, not because the other one was broken: leaning on
   * the pass order is a thing that is true until somebody merges two lookups.
   */
  if (alone.length > 0 && noExit.length > 0 && noEntry.length > 0) {
    rules.push({
      before: [noExit],
      input: [alone],
      after: [noEntry],
      swaps: [{
        at: 0,
        swap: alone.map((letter) => ({ plain: letter, alternate: boundaryName(letter, "alone") })),
      }],
    });
  }

  /*
   * The same for the two halves, and for the same reason: the space between two
   * words is a condition on both rules rather than a glyph either of them owns.
   */
  if (beginning.length > 0 && noExit.length > 0) {
    rules.push({
      before: [noExit],
      input: [beginning],
      swaps: [{
        at: 0,
        swap: beginning.map((letter) => ({ plain: letter, alternate: boundaryName(letter, "begin") })),
      }],
    });
  }
  if (ending.length > 0 && noEntry.length > 0) {
    rules.push({
      input: [ending],
      after: [noEntry],
      swaps: [{
        at: 0,
        swap: ending.map((letter) => ({ plain: letter, alternate: boundaryName(letter, "end") })),
      }],
    });
  }
  return rules;
}
