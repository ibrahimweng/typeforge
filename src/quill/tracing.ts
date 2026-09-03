/**
 * Reading a whole font into strokes, and saying how far along it is.
 *
 * The fitting itself is in `fit.ts` and knows about one glyph. This is the
 * pass over a font: which characters are worth asking for, in what order, and
 * what a caller is told while it happens.
 *
 * It is written as one function taking a progress callback rather than as
 * something the worker owns, because it has to run in two places. In a browser
 * it runs inside a worker, so that filling and thinning seventy letters does
 * not freeze the tab for most of a minute. Everywhere else -- a test, a script,
 * a browser too old for module workers -- it runs where it was called from. One
 * function means those two cannot come to disagree about what tracing a font
 * produces, which they certainly would if the worker held its own copy.
 */

import { importFont } from "@/font/parse";
import { fitGlyph } from "./fit";
import { handOf, type HandFound } from "./hand";
import type { QuillGlyph } from "./types";
import type { Contour } from "@/font/types";

/** One traced letter: the strokes as read, and what they cost to read. */
export interface Traced {
  glyph: QuillGlyph;
  /** How far the fitted centre-line strayed from the thinned one. */
  deviation: number;
  /** The outline it was read from, kept so the two can be compared on screen. */
  source: Contour[];
  /**
   * An outline somebody drew, standing where the strokes would be.
   *
   * The one thing a recovered stroke cannot do is the letter you have in your
   * head that no set of strokes reaches -- and there is always one, because
   * what came back is a guess about how a shape was made rather than a record
   * of it. So a letter can be taken to the point tools and handed back, and
   * from then on it is what was drawn.
   *
   * Kept beside the strokes rather than replacing them, so it is one call to
   * put the letter back under the hand: the strokes never went anywhere.
   * Absent on almost every letter, which is why it is optional and why a
   * document saved before there was one reads correctly without it.
   */
  byHand?: { contours: Contour[]; advanceWidth: number };
}

/** How far through the font the tracing is. */
export interface TraceProgress {
  done: number;
  total: number;
  /** The character being read as this was reported. */
  letter: string;
}

export interface TraceResult {
  letters: Traced[];
  unitsPerEm: number;
  /**
   * The pen the font was written with, if one explains it.
   *
   * Null on a face with no modulation, which is most text faces: there the
   * letters keep a round pen and their width profiles, because inventing an
   * angle to explain a difference that is not there puts a number in the font
   * that means nothing.
   */
  hand: HandFound | null;
}

/*
 * The characters worth asking a font for, and why it is only these.
 *
 * The lowercase is where a script lives and where the fitter has been measured;
 * the capitals and the figures follow because a font that gives back twenty-six
 * letters is a demonstration rather than a font. What is left out is everything
 * built from a base and a mark -- an accented letter is its base moved, so
 * tracing it separately would trace the same strokes twice and leave two copies
 * to drift apart the first time one of them is edited.
 */
export const WANTED =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?'\"-".split("");

/**
 * Read a font and recover the strokes of every character it has.
 *
 * `onProgress` is called once per character actually attempted rather than once
 * per character asked for, so a font missing half the list does not appear to
 * stall halfway. It is called *before* the letter is fitted, so what it names is
 * the letter being worked on rather than the one just finished -- which is what
 * a person reading a progress line expects it to mean.
 */
export async function traceFont(
  bytes: Uint8Array,
  name: string,
  onProgress?: (progress: TraceProgress) => void,
): Promise<TraceResult> {
  const { typeface } = await importFont(bytes, name);
  const unitsPerEm = typeface.unitsPerEm ?? 1000;

  const byCharacter = new Map<string, (typeof typeface.glyphs)[number]>();
  for (const glyph of typeface.glyphs) {
    for (const code of glyph.unicodes ?? []) byCharacter.set(String.fromCodePoint(code), glyph);
  }

  /*
   * Only the characters this font actually has, counted before any work starts.
   *
   * The total has to be the number that will be attempted rather than the
   * number wanted, or a bar drawn against it stops short of its own end on
   * every font that is not complete -- which is most of them.
   */
  const present = WANTED.filter((character) => {
    const glyph = byCharacter.get(character);
    return Boolean(glyph?.contours?.length);
  });

  const letters: Traced[] = [];
  for (const [index, character] of present.entries()) {
    onProgress?.({ done: index, total: present.length, letter: character });
    const found = byCharacter.get(character)!;
    const fitted = fitGlyph(character, found.contours, found.advanceWidth, { unitsPerEm });
    if (!fitted || fitted.glyph.strokes.length === 0) continue;
    letters.push({
      glyph: fitted.glyph,
      deviation: fitted.spineDeviation,
      source: found.contours,
    });
  }
  onProgress?.({ done: present.length, total: present.length, letter: "" });

  /*
   * And the pen the whole font was written with, read out of all of it at once,
   * **reported and not applied**. The measurements are below and they are the
   * reason.
   *
   * One pen for the alphabet rather than one per letter, which is both the
   * principled answer and much the more robust one: a hand holds one pen, and
   * that is what makes an alphabet look like an alphabet. Asked letter by
   * letter, DejaVu Serif's `o` gives a blade of 0.17 at five degrees -- exactly
   * its horizontal modulation, and a 72 per cent flatter pressure -- while its
   * `x`, two crossing diagonals and a junction, gives 0.93, which is nonsense
   * from too little evidence. Pooled over the alphabet no letter is thin
   * enough to be fitted by itself.
   *
   * What it reads, on the five faces to hand:
   *
   *   DejaVu Serif        blade 0.38 at 10 degrees   pressure 35% flatter
   *   DejaVu Serif Bold   blade 0.53 at  7 degrees            29% flatter
   *   DejaVu Sans Bold    blade 0.20 at 10 degrees             9% flatter
   *   DejaVu Sans         blade 0.15 at 19 degrees             7% flatter
   *   DejaVu Sans Mono    blade 0.11 at 11 degrees             5% flatter
   *
   * Which is right: it separates the serifs from the sanses, puts the pen
   * nearly horizontal on both serifs -- where a transitional serif's thins
   * are -- and finds more of a blade in the Bold than the Regular, which is
   * also true of the drawing.
   *
   * Rewriting the strokes with it was measured on the Serif and is not worth
   * doing. Dividing the pen out of the width profile and letting the sweep
   * multiply it back should be the same ink and is not: a profile is a handful
   * of stops with the width interpolated between them, and the pen's reach
   * varies continuously with the heading, so the two do not commute. The mean
   * error came down from 14.31 to 13.03 and the worst stayed at 446, but the
   * `z`'s mean went from 6.93 to 12.63 and the `v`, `w`, `x` and `y` all got
   * worse -- and the stop count did not move at all, which was the whole point.
   * A simpler description needs the pen divided out *before* the profile is
   * thinned, which means tracing the font twice: once to find the pen, once to
   * fit against it. That is the work, and it is more than a rule about a
   * profile.
   */
  const hand = handOf(letters.flatMap((one) => one.glyph.strokes));
  const reads = hand !== null && hand.contrast > 0 && hand.spread < hand.roundSpread * 0.85;

  return { letters, unitsPerEm, hand: reads ? hand : null };
}

// ---------------------------------------------------------------------------
// What the worker and its caller say to each other
// ---------------------------------------------------------------------------

/** What the worker is asked to do. */
export interface TraceRequest {
  bytes: ArrayBuffer;
  name: string;
}

/** What it says back, in the order it says it. */
export type TraceMessage =
  | { kind: "progress"; progress: TraceProgress }
  | { kind: "done"; result: TraceResult }
  | { kind: "failed"; why: string };
