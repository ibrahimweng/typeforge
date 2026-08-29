/**
 * How close a drawn face is to one somebody else drew, and how to get closer.
 *
 * A face that is meant to travel needs somewhere to travel to. This file holds
 * the two ends of the dial: what a reference face measures, and the settings
 * that put the Roundhand where those measurements are.
 *
 * What is here is a description and not a drawing. A measurement -- an
 * x-height, a slant, how far a join runs past the ink -- is a fact about a
 * shape rather than the shape itself, and eight numbers cannot be assembled
 * back into anybody's letters. Nothing is traced, no outline is read, and the
 * settings below are the same controls the panel offers: what they produce is
 * this engine's own skeletons, drawn with its own pen, standing where the
 * measurements say. Two faces built to the same x-height and the same slant are
 * as related as two buildings built to the same ceiling height.
 *
 * Which is also the honest limit, and it is worth saying plainly because the
 * request that produced this file asked for something else. Parameters reach a
 * *likeness* -- the proportions, the rhythm, the weight, the way the letters
 * hand over -- and they do not reach a replica. The letterforms underneath are
 * this engine's, and a skeleton swept by a pen cannot be made to arrive at
 * outlines drawn freehand by somebody else, at any setting. What the dial buys
 * is a face that reads as belonging to the same genre and sits on the same
 * lines. What it cannot buy is the other font.
 *
 * The measurements were taken by scanline off the reference files at a named
 * weight, by `scripts/likeness.ts`, which measures a drawn face the same way
 * and prints the difference. So the targets and the check read one set of
 * numbers rather than two that drift.
 */

import { ROUNDHAND } from "./style";
import type { Style } from "./style";

/**
 * The measurements that separate one joined face from another.
 *
 * Ratios rather than units wherever a ratio is what the eye reads. An x-height
 * of 332 means nothing on its own; a third of the em means a face with a small
 * lowercase and long extenders, and it means that at any size the font is set
 * at. The two that are not ratios are the slant, which is already scale-free,
 * and the bounce, which is measured against the x-height because that is what
 * a letter sitting off its line is judged against.
 */
export interface Measurements {
  /** Lowercase height over the em. */
  xHeight: number;
  /** Capital height over the em, from the drawn capitals. */
  capHeight: number;
  /** How high the drawn ascenders actually reach, over the em. */
  ascender: number;
  /** How far the drawn descenders actually reach, over the em. Negative. */
  descender: number;
  /** Degrees the lowercase leans. */
  slant: number;
  /** Stroke width over the x-height, which is what makes a face look heavy. */
  stroke: number;
  /**
   * How far the letters sit off their common line, over the x-height.
   *
   * The spread across the twelve lowercase letters that have neither an
   * ascender nor a descender, so a `g` reaching down cannot be mistaken for a
   * letter that bounced.
   */
  bounce: number;
  /**
   * How far a letter's ink runs past the room it is given, over the x-height.
   *
   * What makes a joined face joined, measured rather than assumed: the ink of
   * a script letter is wider than its advance, because the stroke that leaves
   * it is the stroke that arrives at the next one and the two share it. A face
   * where this is nought is a face whose letters stand apart.
   */
  overlap: number;
}

/** A face worth aiming at, what it measures, and the way there. */
export interface Likeness {
  id: string;
  label: string;
  /** What kind of hand it is, in the terms the panel uses. */
  blurb: string;
  /** Where the measurements came from, so a number can be traced to a file. */
  source: string;
  measured: Measurements;
  /** What to change on the Roundhand to arrive at them. */
  settings: Settings;
}

/** The controls the dial moves, which are the controls the panel offers. */
export interface Settings {
  metrics: { xHeight: number; capHeight: number; ascender: number; descender: number; slant: number };
  pen: { weight: number; contrast: number; angle: number };
  script: {
    height: number;
    reach: number;
    flat: number;
    loop: number;
    loopDepth: number;
    highSeam: number;
    balance: number;
    irregularity: number;
    bounce: number;
    lean: number;
  };
}

/**
 * A flowing connected script: small lowercase, long extenders, a line that
 * bounces.
 *
 * The far end of the dial in one direction, and the one that asks the most of
 * the engine. Its x-height is a third of the em -- lower than anything the
 * other faces here start at -- so the extenders are long, the loops have room
 * to open, and the join runs a long way past the ink. It bounces by about a
 * thirtieth of its x-height -- measured across the five square-footed letters,
 * where a descender cannot be mistaken for a letter that dropped -- while
 * holding a steady thirteen degrees. The other face measured bounces by nothing
 * at all and leans further, which is the split that made `bounce` and `lean`
 * separate controls: one number asked for both cannot draw either face.
 */
export const FLOWING: Likeness = {
  id: "flowing",
  label: "Flowing script",
  blurb: "Small lowercase, long looped extenders, a line that will not sit still. A pen moving quickly.",
  source: "measured at weight 400",
  measured: {
    xHeight: 0.332,
    capHeight: 0.72,
    ascender: 0.72,
    descender: -0.28,
    slant: 13.1,
    stroke: 0.179,
    bounce: 0.033,
    overlap: 0.123,
  },
  settings: {
    metrics: { xHeight: 317, capHeight: 716, ascender: 709, descender: -270, slant: 13 },
    /*
     * The pen against the measured stroke, which are not the same number.
     *
     * 0.179 of an x-height of 332 is 59 units of *ink*, and the engine's weight
     * is the pen's full width before the contrast thins what a ruler then
     * finds. So the weight is set above the target and the harness says where
     * it landed -- which is the arrangement the whole file is for. Contrast
     * itself is a reading rather than a measurement: a scanline across a joined
     * `o` catches the join crossing it as well as the bowl, so the thick against
     * the thin could not be taken cleanly. It is the first thing to tune by eye.
     */
    pen: { weight: 61, contrast: 0.3, angle: 30 },
    script: {
      height: 0.3,
      reach: 1.9,
      flat: 0.06,
      loop: 1.7,
      loopDepth: 2.4,
      highSeam: 0.78,
      // Short in, long out: the measured lead-out runs about three times the
      // lead-in past the ink, which is a quarter and three quarters.
      balance: 0.25,
      /*
       * Four tenths against the nine tenths of the base, and both were nearly
       * five times this until the seed behind them was fixed. A control
       * compensating for a hash that would not scatter is a control fitted to
       * a bug, and the numbers it was fitted to were meaningless -- which is
       * the argument for the harness rather than the eye.
       */
      irregularity: 0.4,
      bounce: 1,
      lean: 0.5,
    },
  },
};

/**
 * An upright brush hand: tall lowercase, short extenders, dead level.
 *
 * The other end, and it is not the same face turned down -- it is a different
 * decision in nearly every place. The lowercase is half the em, which leaves
 * the extenders almost nothing and the loops nowhere to go, so the loop comes
 * most of the way off. It leans further than the flowing one and does not
 * bounce at all: across the five square-footed letters its feet sit on exactly
 * the same unit. A brush is held at an angle and moved steadily, and steadiness
 * is most of its character.
 */
export const BRUSH_HAND: Likeness = {
  id: "brush",
  label: "Upright brush",
  blurb: "Tall lowercase, short extenders, a steady line and a heavy stroke. A brush held at an angle.",
  source: "measured at weight 300",
  measured: {
    xHeight: 0.495,
    capHeight: 0.696,
    ascender: 0.751,
    descender: -0.25,
    slant: 16.1,
    stroke: 0.125,
    bounce: 0,
    overlap: 0.087,
  },
  settings: {
    metrics: { xHeight: 485, capHeight: 691, ascender: 747, descender: -239, slant: 16 },
    // 0.125 of an x-height of 495 is 62 units, and the contrast thins what the
    // ruler then finds, so the pen is set above it and checked by the harness.
    pen: { weight: 70, contrast: 0.42, angle: 22 },
    script: {
      height: 0.42,
      reach: 1.35,
      flat: 0.22,
      /*
       * Nearly no loop, and it is the x-height that decides that rather than
       * taste. A lowercase half the em high leaves a quarter of the em for the
       * ascender, and an eye struck in that is a bead rather than a loop --
       * the engine declines to draw one that tight and is right to.
       */
      loop: 0.35,
      loopDepth: 1.5,
      highSeam: 0.72,
      balance: 0.3,
      /*
       * Steady. Not nought, because a brush hand is still a hand and the
       * roughening reads as one, but the bounce is turned nearly off while the
       * lean is left alone -- which is the whole reason the two are separate.
       */
      irregularity: 0.25,
      bounce: 0.02,
      lean: 1,
    },
  },
};

export const LIKENESSES: Likeness[] = [FLOWING, BRUSH_HAND];

/** One of them by name, for the panel and the harness. */
export function likenessBy(id: string): Likeness | undefined {
  return LIKENESSES.find((one) => one.id === id);
}

/**
 * The Roundhand moved to one of them.
 *
 * A patch over the face rather than a face of its own, so the letters, the
 * parts and everything else the dial does not name stay exactly where the base
 * left them. That is the point of doing this with settings: what arrives is the
 * same typeface at a different setting, and it can be moved on from there.
 */
export function dialledTo(likeness: Likeness, from: Style = ROUNDHAND): Style {
  return {
    ...from,
    name: `${from.name} · ${likeness.label}`,
    metrics: { ...from.metrics, ...likeness.settings.metrics },
    pen: { ...from.pen, ...likeness.settings.pen },
    parts: {
      ...from.parts,
      script: { ...from.parts.script, on: true, ...likeness.settings.script },
    },
  };
}

/**
 * How far a drawn face is from a reference, measure by measure.
 *
 * Signed, and in the reference's own units: positive means the drawn face is
 * over. Ratios are reported as ratios because that is how the targets are
 * written, and the harness turns them into units where units read better.
 */
export function differenceBetween(drawn: Measurements, target: Measurements): Measurements {
  return {
    xHeight: drawn.xHeight - target.xHeight,
    capHeight: drawn.capHeight - target.capHeight,
    ascender: drawn.ascender - target.ascender,
    descender: drawn.descender - target.descender,
    slant: drawn.slant - target.slant,
    stroke: drawn.stroke - target.stroke,
    bounce: drawn.bounce - target.bounce,
    overlap: drawn.overlap - target.overlap,
  };
}
