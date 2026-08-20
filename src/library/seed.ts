/**
 * Starting a drawing from a font you liked.
 *
 * Not copying it. Nothing of the font's outlines survives this: what is taken
 * is a description -- how tall the lowercase stands against the capitals, how
 * wide the pen was, how much thinner the horizontals are than the uprights,
 * whether the strokes end in serifs and how far they reach -- and then the
 * letters are drawn from that description by the same machinery that draws
 * every other font here. Feed it Playfair Display and what comes out is a
 * high-contrast serif with a tall x-height, which is a fair account of
 * Playfair and not a single one of its curves.
 *
 * That distinction is the whole point and it is worth being exact about. The
 * proportions of a typeface are not protected and never have been -- they are
 * the reason there are five hundred grotesques and they all look like each
 * other. The outlines are. So the numbers travel and the shapes do not, and
 * what comes out the other end is yours.
 */

import { BASES, type Family, type Style } from "@/forge/style";
import type { Measured } from "./measure";

export interface Seeded {
  style: Style;
  /** Which base was started from, for saying so. */
  base: string;
  /** What was taken and what had to be guessed, in plain words. */
  notes: string[];
}

/**
 * Which base to start from.
 *
 * The measured shape decides, in the order the readings can be trusted. A
 * joining face is a script whatever else it measures, because its entry and
 * exit strokes read as serifs and are not; then a monospaced face, which is a
 * decision about space rather than shape; then the presence of serifs, and
 * within the serifs the contrast, which is most of what separates a slab from
 * a didone.
 */
function baseFor(measured: Measured): string {
  if (measured.joining) return "Brush";
  if (measured.monospaced) return "Typewriter";

  if (measured.serif) {
    const contrast = measured.contrast ?? 0.3;
    if (contrast >= 0.65) return "Didone";
    if (contrast <= 0.25) return "Slab";
    return "Serif";
  }

  const contrast = measured.contrast ?? 0;
  // A sans drawn with almost no modulation at all, and a wide round bowl, is a
  // geometric rather than a grotesque.
  if (contrast <= 0.06) return "Geometric";
  return "Grotesque";
}

/** The family a measured face belongs to, for saying where it landed. */
export function familyOf(measured: Measured): Family {
  if (measured.joining) return "hand";
  if (measured.serif) return "serif";
  return "sans";
}

/**
 * Build a style from a measurement.
 *
 * Everything the measurement is sure of is used; everything it is not sure of
 * is left at whatever the base already said, and both are reported. A seed
 * that quietly guessed at half its numbers would be worse than useless --
 * the point of starting from a font you liked is knowing which parts of it
 * you actually got.
 */
export function seedFrom(measured: Measured, name = "Untitled"): Seeded {
  const baseName = baseFor(measured);
  const base = BASES.find((candidate) => candidate.name === baseName) ?? BASES[0];
  const style: Style = structuredClone(base);
  const notes: string[] = [];

  // Everything is carried across as a fraction of the em, because the two
  // fonts need not agree on how many units an em is -- and most do not.
  const em = measured.unitsPerEm;
  const share = (value: number) => Math.round((value / em) * style.metrics.unitsPerEm);

  style.name = name;
  style.metrics.xHeight = share(measured.xHeight);
  style.metrics.capHeight = share(measured.capHeight);
  style.metrics.ascender = share(measured.ascender);
  style.metrics.descender = share(measured.descender);
  style.metrics.overshoot = share(measured.overshoot);
  notes.push("Proportions taken from the font.");

  if (measured.stem !== null) {
    style.pen.weight = share(measured.stem);
    notes.push(`Pen width measured off an upright: ${style.pen.weight} units.`);
  } else {
    notes.push("No upright plain enough to measure the pen; kept the base's weight.");
  }

  if (measured.contrast !== null) {
    style.pen.contrast = Number(measured.contrast.toFixed(2));
    notes.push(`Contrast measured from the crossbar against the stem: ${style.pen.contrast}.`);
  } else {
    notes.push("Nothing flat enough to measure contrast against; kept the base's.");
  }

  if (measured.counterWidth !== null) {
    style.metrics.counterWidth = share(measured.counterWidth);
    notes.push("Rhythm taken from the inside of the n.");
  }

  if (measured.sidebearing !== null) {
    // Never negative: the drawn letters do not join, so a negative sidebearing
    // would run them into each other rather than joining them up.
    style.metrics.sidebearing = Math.max(0, share(measured.sidebearing));
    if (measured.sidebearing < 0) {
      notes.push("The face joins its letters up; the spacing was set to nothing rather than less.");
    }
  }

  if (measured.slant !== 0) {
    style.metrics.slant = measured.slant;
    notes.push(`Leaning ${measured.slant} degrees, measured off the stems.`);
  }

  if (measured.monospaced) {
    style.metrics.monospaced = true;
    notes.push("Every letter on one width.");
  }

  if (measured.serif === null) {
    notes.push("Could not tell whether the strokes are serifed; kept the base's answer.");
  }

  return { style, base: base.name, notes };
}
