/**
 * How thick a face's stems are, measured off its own letters.
 *
 * Every size in a cut is a multiple of the stem. That is what makes one
 * description hold at every weight: a slot a third of a stem wide is a third
 * of a stem wide on the Light and on the Black, and the face reads as the same
 * face cut the same way rather than as two unrelated fonts.
 *
 * A face drawn in Forge knows its stem, because a pen drew it and the pen's
 * weight is an input. A font somebody opened, and a pile of drawings somebody
 * made in another program, do not. So it is measured: rule a line across a
 * letter that is mostly stem and read the runs of ink it crosses.
 */

import { contoursBounds, inkRunsAt } from "./geometry";
import type { Contour } from "./types";

/**
 * Letters worth ruling across, best first.
 *
 * An I and an l are a stem and nothing else, which is the measurement with
 * nothing to go wrong. H and n are two stems. E, o, d and b are further down
 * because each of them crosses something that is not a stem -- the arms of an
 * E, the thin sides of a bowl on a face with any contrast -- and are only
 * reached for when the font has none of the others, which happens with a
 * subset cut down to a handful of glyphs.
 */
export const STEM_LETTERS = ["I", "l", "H", "n", "i", "T", "E", "F", "d", "b", "o", "O"];

/** A letter to rule across, by the name the font knows it by. */
export interface Ruled {
  name: string;
  contours: Contour[];
}

/**
 * The width of one run of ink through the middle of a letter.
 *
 * The median of the runs rather than the mean, and rather than the widest or
 * the first. A ruler across an H crosses two stems and either answer is right;
 * across an E it crosses the stem and three arms, where the mean is dragged
 * down by the arms and the widest is the stem plus an arm on a face where they
 * touch. The middle answer survives all of them.
 *
 * Null when the letter has no ink at that height, which is how a caller knows
 * to try the next one rather than believe a zero.
 */
export function stemFrom(contours: Contour[], at: number): number | null {
  if (contours.length === 0) return null;
  const runs = inkRunsAt(contours, at)
    .map(([from, to]) => to - from)
    .filter((width) => width > 0)
    .sort((first, second) => first - second);
  if (runs.length === 0) return null;
  return runs[Math.floor((runs.length - 1) / 2)];
}

/**
 * The stem of a face, from whichever of its letters can be ruled across.
 *
 * Ruled at a third of the x-height rather than at half of it. Half is inside
 * the eye of an e and the bowl of an a and a b, so on a font whose only
 * ruleable letters are those the measurement came back as the thin side of a
 * bowl. A third is below all of them and still well clear of the baseline,
 * where a serif or the flat of a curve would answer instead.
 *
 * Falls back to a share of the em when there is nothing to measure -- an empty
 * font, or a pile with no letter from the list in it. Nine hundredths is about
 * what a regular weight runs to at a thousand units, and a wrong stem makes
 * the cuts the wrong size rather than making them fail.
 */
export function measuredStem(
  letters: Ruled[],
  metrics: { xHeight: number; unitsPerEm: number },
): number {
  const at = metrics.xHeight > 0 ? metrics.xHeight / 3 : metrics.unitsPerEm * 0.16;
  const byName = new Map(letters.map((letter) => [letter.name, letter.contours]));

  for (const name of STEM_LETTERS) {
    const contours = byName.get(name);
    if (!contours) continue;
    const width = stemFrom(contours, at);
    // A run narrower than a hundredth of the em is a hairline or a mistake,
    // and taking it for the stem would make every cut invisible.
    if (width !== null && width > metrics.unitsPerEm * 0.01) return width;
  }

  // Nothing from the list. Rule across whatever is widest instead, which for a
  // pile of drawings with no I in it is better than a guess off the em.
  let widest: Ruled | null = null;
  let span = 0;
  for (const letter of letters) {
    if (letter.contours.length === 0) continue;
    const box = contoursBounds(letter.contours);
    const width = box.xMax - box.xMin;
    if (width > span) {
      span = width;
      widest = letter;
    }
  }
  if (widest) {
    const width = stemFrom(widest.contours, at);
    if (width !== null && width > metrics.unitsPerEm * 0.01) return width;
  }

  return metrics.unitsPerEm * 0.09;
}
