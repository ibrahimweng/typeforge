/**
 * Reading the pen out of a traced letter, rather than assuming it was round.
 *
 * The tracer recovers a spine and a width profile and hands back a round pen,
 * so every bit of a letter's modulation ends up in the profile -- and a profile
 * is pressure. That is a true description of the ink and the wrong description
 * of the letter: a broad-nibbed hand is thick when it runs one way and thin when
 * it runs another, and calling that "the stroke happens to swell here" loses the
 * one fact a person editing it needs.
 *
 * ## Why this is decidable at all
 *
 * It looks like it should not be. A round pen with a free width profile can
 * draw any ink a broad pen can, so the two descriptions fit equally well and
 * nothing in the outline says which was used. That is true of *one* stroke and
 * false of a letter, and the difference is the whole method here.
 *
 * A pen has one angle and the strokes of a letter run in every direction. So if
 * the letter was written with a broad pen, there is a single angle at which
 * dividing out the pen leaves every stroke's remaining profile nearly flat --
 * and if it was drawn with pressure, no angle does, because the swelling has
 * nothing to do with which way the stroke was going.
 *
 * So the pen is the one that **makes the pressure flattest**. Written out:
 *
 *   the reach across a stroke  r = half * f(u),  f(u) = hypot(cos u, (1-c) sin u)
 *   where u is the angle from the pen's own axis to the stroke's normal
 *   so the pressure it implies  half = r / f(u)
 *
 * and the pen wanted is the (c, angle) minimising how much `half` varies over
 * the letter. A sans with no modulation finds c near nought and nothing changes.
 *
 * ## What it is worth
 *
 * Not accuracy. Dividing the pen out of the profile and multiplying it back in
 * the sweep is the same ink to the unit, and the harness says so. What it buys
 * is the description: the same letter as a pen held at an angle plus a flatter
 * profile, which is fewer numbers, and the numbers are ones a person can act on.
 */

import { alongSpine, walkOf } from "./curve";
import { widthAt } from "./sweep";
import type { NibProfile, QuillStroke } from "./types";

/** One reading of a traced letter: how wide it is, and which way it was going. */
interface Reading {
  /** Half the width there, in units. */
  half: number;
  /** The direction of the stroke's normal, in radians. */
  normal: number;
}

/** How far the pen reaches across a stroke, for a half-width of one. */
const reachFor = (fromAxis: number, contrast: number): number =>
  Math.hypot(Math.cos(fromAxis), (1 - contrast) * Math.sin(fromAxis));

/**
 * How much the implied pressure varies, for one candidate pen.
 *
 * Relative rather than absolute, because a light face and a heavy one should be
 * judged the same way: what is being asked is whether the pressure is *flat*,
 * not whether it is small. Returned as the spread over the mean, so nought is a
 * perfectly steady hand.
 */
function spreadUnder(readings: Reading[], contrast: number, angle: number): number {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (const reading of readings) {
    const reach = reachFor(reading.normal - angle, contrast);
    /*
     * A pen nearly edge-on to the stroke explains almost no width, so the
     * pressure it implies runs away. Skipped rather than clamped: clamping
     * folds a runaway back to a plausible number and hides the very case that
     * should rule this pen out.
     */
    if (reach < 0.08) return Infinity;
    const implied = reading.half / reach;
    sum += implied;
    sumSquares += implied * implied;
    count += 1;
  }
  if (count === 0) return Infinity;
  const mean = sum / count;
  if (mean <= 1e-9) return Infinity;
  const variance = Math.max(0, sumSquares / count - mean * mean);
  return Math.sqrt(variance) / mean;
}

/** Every reading a set of strokes offers, sampled along their spines. */
function readingsOf(strokes: QuillStroke[], perStroke = 24): Reading[] {
  const readings: Reading[] = [];
  for (const stroke of strokes) {
    if (stroke.spine.segments.length === 0) continue;
    const walk = walkOf(stroke.spine);
    if (walk.total <= 0) continue;
    for (let step = 0; step <= perStroke; step++) {
      const fraction = step / perStroke;
      const { heading } = alongSpine(stroke.spine, walk, fraction);
      const half = widthAt(stroke.width, fraction) / 2;
      if (half <= 0) continue;
      readings.push({
        half,
        // The normal is the heading turned a quarter turn, which is the
        // direction the reach is measured along.
        normal: Math.atan2(heading.x, -heading.y),
      });
    }
  }
  return readings;
}

export interface HandFound {
  contrast: number;
  /** Degrees, as a nib angle is written everywhere else. */
  angle: number;
  /** How flat the pressure is under this pen, and under a round one. */
  spread: number;
  roundSpread: number;
}

/**
 * The pen a set of traced strokes was most likely written with.
 *
 * Searched rather than solved. The objective is smooth in the angle and not in
 * the contrast -- a pen close to edge-on rules itself out sharply -- so a grid
 * with a refinement pass is both simpler than a solver and easier to be sure
 * of. Two hundred and forty candidates, which costs nothing beside the trace
 * that produced the strokes.
 */
export function handOf(strokes: QuillStroke[]): HandFound | null {
  const readings = readingsOf(strokes);
  if (readings.length < 8) return null;

  /*
   * Only where the strokes actually go in different directions.
   *
   * The method rests on a letter running several ways at once. An `l` runs one
   * way, so every pen angle explains it equally well and the search would
   * return whichever the grid happened to try first -- a confident answer from
   * no evidence, which is worse than none.
   */
  const spread = readings.map((one) => one.normal);
  const spanOf = (angles: number[]): number => {
    let widest = 0;
    for (const one of angles)
      for (const other of angles) {
        let gap = Math.abs(one - other) % Math.PI;
        if (gap > Math.PI / 2) gap = Math.PI - gap;
        widest = Math.max(widest, gap);
      }
    return widest;
  };
  if (spanOf(spread) < (30 * Math.PI) / 180) return null;

  const roundSpread = spreadUnder(readings, 0, 0);
  let best: HandFound = {
    contrast: 0,
    angle: 0,
    spread: roundSpread,
    roundSpread,
  };
  const tryPen = (contrast: number, radians: number): void => {
    const found = spreadUnder(readings, contrast, radians);
    if (found < best.spread) {
      best = {
        contrast,
        angle: (radians * 180) / Math.PI,
        spread: found,
        roundSpread,
      };
    }
  };
  for (let step = 0; step < 24; step++) {
    const radians = (step * Math.PI) / 24;
    for (let level = 1; level <= 10; level++) tryPen(level / 10 - 0.005, radians);
  }
  // And a finer pass around whatever the grid liked, which is what makes the
  // answer worth writing into a font rather than only worth believing.
  if (best.contrast > 0) {
    const around = (best.angle * Math.PI) / 180;
    for (let step = -5; step <= 5; step++) {
      const radians = around + (step * Math.PI) / 240;
      for (let level = -4; level <= 4; level++) {
        const contrast = Math.min(0.98, Math.max(0.02, best.contrast + level / 100));
        tryPen(contrast, radians);
      }
    }
  }
  return best;
}

/**
 * The same strokes described as a pen held at an angle, plus what is left over.
 *
 * The profile is divided by the pen's reach at each sample, so the sweep
 * multiplies back exactly what was taken out and the ink is unchanged. Every
 * stroke of the letter gets the same pen, because a hand holds one.
 *
 * `least` is how much flatter the pressure has to come out before this is worth
 * doing. Below it the letter is better described as a round pen and a profile,
 * which is what a sans is: its stems and its bars are the same width, and
 * inventing a pen angle to explain a difference that is not there would put a
 * number in the font that means nothing.
 */
export function withHand(
  strokes: QuillStroke[],
  options: { least?: number; pen?: HandFound | null } = {},
): { strokes: QuillStroke[]; hand: HandFound | null } {
  /*
   * A pen may be handed in rather than found here, and for a whole font it
   * should be: one pen read out of the alphabet at once is both the principled
   * answer -- a hand holds one pen -- and much the more robust one, since no
   * single letter is then thin enough evidence to be fitted by itself.
   */
  const hand = options.pen ?? handOf(strokes);
  const least = options.least ?? 0.15;
  /*
   * `hand` on the way out is the pen that was *applied*, so it is null whenever
   * nothing was rewritten. Handing back the pen that was found while leaving
   * the strokes alone was the first version and it is a trap: the caller has no
   * way to tell "here is the pen I used" from "here is what I considered and
   * rejected", and the two mean opposite things. What was found is `handOf`'s
   * to report.
   */
  if (!hand || hand.contrast <= 0) return { strokes, hand: null };
  /*
   * And nothing at all on strokes that barely vary. There the round pen's
   * spread is near nought, so any threshold measured as a fraction of it is
   * met by a rounding error, and a monoline would be handed a pen angle that
   * explains a difference of half a unit.
   */
  if (hand.roundSpread < 0.02) return { strokes, hand: null };
  if (hand.spread > hand.roundSpread * (1 - least)) return { strokes, hand: null };

  const radians = (hand.angle * Math.PI) / 180;
  const nib: NibProfile = [{ at: 0, contrast: hand.contrast, angle: hand.angle }];
  const rewritten = strokes.map((stroke) => {
    if (stroke.spine.segments.length === 0) return { ...stroke, nib };
    const walk = walkOf(stroke.spine);
    if (walk.total <= 0) return { ...stroke, nib };
    return {
      ...stroke,
      nib,
      width: stroke.width.map((stop) => {
        const { heading } = alongSpine(stroke.spine, walk, stop.at);
        const normal = Math.atan2(heading.x, -heading.y);
        const reach = reachFor(normal - radians, hand.contrast);
        return { ...stop, width: stop.width / Math.max(0.08, reach) };
      }),
    };
  });
  return { strokes: rewritten, hand };
}
