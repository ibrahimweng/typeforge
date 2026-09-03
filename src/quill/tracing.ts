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
   * And the pen the whole font was written with, read out of all of it at once
   * -- **reported, not applied**. Both halves of that are measured, and the
   * second half is the interesting one.
   *
   * One pen for the alphabet rather than one per letter, which is both the
   * principled answer and much the more robust one: a hand holds one pen, and
   * that is what makes an alphabet look like an alphabet. Asked letter by
   * letter, DejaVu Serif's `o` gives a blade of 0.17 at five degrees -- exactly
   * its horizontal modulation -- while its `x`, two crossing diagonals and a
   * junction, gives 0.93, which is nonsense from too little evidence.
   *
   * What it reads, on the five faces to hand:
   *
   *   DejaVu Serif        blade 0.38 at 10 degrees   35% flatter between strokes
   *   DejaVu Serif Bold   blade 0.53 at  7 degrees   29%
   *   DejaVu Sans Bold    blade 0.20 at 10 degrees    9%
   *   DejaVu Sans         blade 0.15 at 19 degrees    7%
   *   DejaVu Sans Mono    blade 0.11 at 11 degrees    5%
   *
   * Which is right: it separates the serifs from the sanses, puts the pen
   * nearly horizontal on both serifs -- where a transitional serif's thins
   * are -- and finds more of a blade in the Bold than the Regular, which is
   * also true of the drawing. `scripts/loop.ts` checks it the other way, by
   * writing an alphabet with a known pen and reading it back: the angle comes
   * back within two degrees.
   *
   * ## Why the pen is not then used to re-fit the letters
   *
   * The obvious next move is a second pass: trace once to find the pen, then
   * again with the pen divided out of every width reading before the profile is
   * thinned, so that what is stored is the pressure and the description comes
   * out shorter. It was built and it does not work, and the reason is worth the
   * paragraph because it is not a bug.
   *
   * Two different questions were being confused. Whether a pen explains why one
   * stroke is heavier than *another* is what makes it worth reading, and on the
   * Serif that improves from 0.267 to 0.173. Whether it explains how a single
   * stroke changes down its *own length* is what would make it worth re-fitting
   * against -- because a width profile describes one stroke, and the thinner
   * that decides how many numbers it costs only ever looks at one. That second
   * number goes the other way: 0.592 to 0.664.
   *
   * Written out with a pen known exactly and traced back, it is starker. A
   * written stroke's own profile is flat by construction -- the pen does all the
   * modulation -- and dividing a flat profile by that pen puts 0.481 of wander
   * into it. The traced strokes carry 0.421 of wander, so the tracer *does*
   * recover the pen's modulation. Dividing it out should cancel it and instead
   * takes it to 0.929: the two are out of phase. The recovered spine sits close
   * to the pen's path in position -- five or six units on average -- but its
   * heading at a given fraction along does not match, because a broad pen's ink
   * is not symmetric about its path and the medial axis of it turns at a
   * different rate.
   *
   * So the second pass cannot work while the tracer recovers the medial axis,
   * which is what thinning gives and what everything downstream is built on.
   * Making it work means recovering the *pen's* path instead, which is a
   * different and much deeper piece of work than a rule about a profile. Run
   * anyway, it took the Serif's width stops from 517 to 565 and its mean error
   * from 14.31 to 13.32: more numbers describing the letters no better.
   */
  const hand = handOf(letters.flatMap((one) => one.glyph.strokes));
  const reads = hand !== null && hand.contrast > 0 && hand.spread < hand.roundSpread * 0.85;

  /*
   * And where a pen explains the face, every letter is read again against it.
   *
   * The second pass is the whole reason this is worth doing. Told the pen,
   * `widthProfile` divides every reading by how far that pen reaches across a
   * stroke going that way *before* it thins them -- so what the thinner sees is
   * the pressure, which on a face written with a pen is nearly flat, and it
   * keeps two stops where it kept nine.
   *
   * Applying the pen to the finished profiles instead was tried and does not
   * work, for a reason worth keeping: a profile is stops with the width
   * interpolated between them, the pen's reach varies continuously, and the two
   * do not commute. Same stops in the same places, ink slightly moved, nothing
   * simpler. Every measurement of it is in `docs/write.md`.
   *
   * A second whole trace, which is the cost: a minute becomes two on a large
   * font. Paid only where the first pass found a pen, so it costs nothing on
   * the text faces that make up most of what is opened.
   */
  if (!reads) return { letters, unitsPerEm, hand: null };

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
