/**
 * Working out how a font is built by looking at it.
 *
 * A font file says how tall its capitals are and almost nothing else that
 * matters. It does not say how wide the pen was, whether the pen was held at
 * an angle, whether the strokes end in serifs, or how much white the spacing
 * assumed -- and those are exactly the things you would want to know in order
 * to start drawing something in the same key.
 *
 * All of them are visible in the outlines, and all of them are answered by
 * laying a ruler across a letter and reading off what it meets. A stem is what
 * a horizontal line through an l passes through. A crossbar is what a vertical
 * line through the middle of an H passes through. A serif is an I that is
 * wider at its ends than in its middle. Nothing here is inferred from a name
 * or a table; every number is measured, which is why it works on a font that
 * ships no glyph names at all.
 *
 * The measurements are deliberately conservative. Where a letter is missing or
 * a reading makes no sense, the number is left out rather than guessed, and
 * whatever is built from it falls back on a sensible default and says so.
 */

import { contoursBounds, inkRunsAt } from "@/font/geometry";
import type { Contour, Glyph, Typeface } from "@/font/types";

/** What a font turned out to be made of. Lengths are in the font's own units. */
export interface Measured {
  familyName: string;
  unitsPerEm: number;

  xHeight: number;
  capHeight: number;
  ascender: number;
  descender: number;
  /** How far the round letters pass the flat ones. */
  overshoot: number;

  /** Width of an upright stroke. */
  stem: number | null;
  /** Thickness of a horizontal stroke. */
  crossbar: number | null;
  /** Zero for a monolinear face; towards one as the horizontals thin. */
  contrast: number | null;
  /** Degrees of lean, positive to the right. */
  slant: number;
  /** Whether the stroke ends are barred. */
  serif: boolean | null;
  /** The white inside an n, which is what sets the rhythm. */
  counterWidth: number | null;
  /** Typical white either side of a letter. */
  sidebearing: number | null;
  monospaced: boolean;
  /**
   * A face whose letters run into each other, as a script does.
   *
   * Worth knowing on its own because it is the one kind of face where the
   * serif reading means nothing: a joining script finishes its strokes with
   * entry and exit strokes that measure exactly like serifs and are not
   * serifs. Told apart by the spacing rather than by the shapes. A letter that
   * has to touch the next one has to reach past its own advance to do it, so a
   * joining face carries a negative sidebearing and nothing else does: across
   * the faces this was checked against, the scripts sat at minus three and
   * minus two hundredths of the em, and the tightest thing that was not a
   * script -- an italic serif -- still sat at plus eight thousandths.
   */
  joining: boolean;
}

/**
 * Find the glyph for a character.
 *
 * By codepoint first, because a font is under no obligation to carry glyph
 * names and a good many do not -- Roboto ships none at all, and looking one up
 * by the name "A" finds nothing in it. The name is the fallback for the marks
 * this application names but does not encode.
 */
export function glyphFor(typeface: Typeface, character: string): Glyph | null {
  const code = character.codePointAt(0);
  if (code !== undefined) {
    for (const glyph of typeface.glyphs) {
      if (glyph.unicodes.includes(code)) return glyph;
    }
  }
  const index = typeface.glyphIndex.get(character);
  return index === undefined ? null : (typeface.glyphs[index] ?? null);
}

/** Outlines for a character, or null where the font has none worth measuring. */
function inkFor(typeface: Typeface, character: string): Contour[] | null {
  const glyph = glyphFor(typeface, character);
  if (!glyph || glyph.contours.length === 0) return null;
  return glyph.contours;
}

/**
 * The width of the narrowest thing a ruler meets at this height.
 *
 * The narrowest rather than the first, because the first run through an H at
 * mid-height is a stem but the first run through a b is a stem and the first
 * through a k might be a leg caught at an angle. A stem is the thinnest
 * upright a letter has, and taking the minimum is what makes the reading the
 * same whichever letter is available.
 */
function thinnestRun(contours: Contour[], at: number, along: "x" | "y" = "y"): number | null {
  const runs = inkRunsAt(contours, at, along);
  if (runs.length === 0) return null;
  let least = Infinity;
  for (const [from, to] of runs) least = Math.min(least, to - from);
  return Number.isFinite(least) && least > 0 ? least : null;
}

/**
 * How wide the pen was.
 *
 * Read off an upright with nothing else going on at the height it is read at.
 * The l is first choice because it is a single stroke; the I is next; the H
 * has two stems and a bar, so it is read below the bar where only the stems
 * are in the way.
 */
function measureStem(typeface: Typeface, xHeight: number, capHeight: number): number | null {
  const l = inkFor(typeface, "l");
  if (l) {
    const at = thinnestRun(l, xHeight * 0.5);
    if (at) return at;
  }
  const I = inkFor(typeface, "I");
  if (I) {
    const at = thinnestRun(I, capHeight * 0.5);
    if (at) return at;
  }
  const H = inkFor(typeface, "H");
  if (H) {
    // Below the crossbar, so the ruler meets two stems and nothing else.
    const at = thinnestRun(H, capHeight * 0.2);
    if (at) return at;
  }
  return null;
}

/**
 * How thick a horizontal stroke is.
 *
 * An H read the other way round: a vertical ruler down the middle of it meets
 * the crossbar and nothing else, so the run it returns is the crossbar's own
 * thickness. Which is the measurement that separates a face drawn with a
 * pointed pen from one drawn with a broad one, and there is no other honest
 * way to get it.
 */
function measureCrossbar(typeface: Typeface, capHeight: number): number | null {
  const H = inkFor(typeface, "H");
  if (H) {
    const bounds = contoursBounds(H);
    const middle = (bounds.xMin + bounds.xMax) / 2;
    const run = thinnestRun(H, middle, "x");
    // A crossbar thicker than the cap height is not a crossbar; it is a ruler
    // that missed and met a stem instead.
    if (run && run < capHeight * 0.5) return run;
  }
  const E = inkFor(typeface, "E");
  if (E) {
    const bounds = contoursBounds(E);
    // Three-quarters across, past the stem, where only the arms are left.
    const run = thinnestRun(E, bounds.xMin + (bounds.xMax - bounds.xMin) * 0.75, "x");
    if (run && run < capHeight * 0.5) return run;
  }
  return null;
}

/**
 * Whether the stroke ends are barred.
 *
 * A serifed stem is much wider at its foot than at its waist and a plain one
 * is the same width all the way down, so the reading is a ratio between the
 * two. A third again is well clear of the slight flare a sans puts on a stem
 * and well under what even the lightest serif adds.
 *
 * Read off the left stem of an n on an upright face, and that choice matters
 * more than it looks. The obvious letters to use are the I and the l, and both
 * of them get decorated for reasons that have nothing to do with being a serif
 * face: nearly every monospaced sans bars its I top and bottom so it cannot be
 * read as an l, and reading that as a serif called Roboto Mono a serif face.
 * Nobody puts a spur on an n to tell it from anything.
 *
 * On a leaning face it is the other way about, and for a reason that is about
 * how italics are drawn rather than about this application. An italic
 * lowercase finishes its stems with an entry and an exit stroke where an
 * upright puts a foot serif, so an italic n has no foot to measure and reads
 * as unserifed however serifed the face is -- which called Playfair Display
 * Italic, EB Garamond Italic and Lora Italic all sans. The capitals keep their
 * serifs through the italic, so on anything leaning they are asked instead.
 */
function measureSerif(typeface: Typeface, capHeight: number, xHeight: number): boolean | null {
  /*
   * All the ink a ruler meets, rather than the widest piece of it or the span
   * from the first to the last.
   *
   * Both of those were tried and both are wrong in a way that matters. The
   * span from leftmost to rightmost is nearly the width of the letter at any
   * height, serifs or not. The widest single run assumes a serif arrives as
   * one piece, and a bracketed one does not -- a foot with a deep bracket
   * crosses a low ruler as three separate pieces, and reading the first of
   * them found less ink than the plain stem above it and called a serif face
   * a sans.
   *
   * Total ink is what the question actually is. A serif puts more ink at the
   * foot of a letter than there is at its waist; nothing else does.
   */
  const inkAt = (contours: Contour[], at: number): number => {
    let total = 0;
    for (const [from, to] of inkRunsAt(contours, at)) total += to - from;
    return total;
  };

  const barred = (contours: Contour[], height: number, waistAt: number): boolean | null => {
    const bounds = contoursBounds(contours);
    // Sampled at a few heights near the foot and the most ink taken, since how
    // far up a serif reaches is one of the things that varies most between
    // faces -- a didone's is a hairline and a slab's is a third of the stem.
    let foot = 0;
    for (const share of [0.005, 0.015, 0.03, 0.05]) {
      foot = Math.max(foot, inkAt(contours, bounds.yMin + height * share));
    }
    const waist = inkAt(contours, waistAt);
    if (foot === 0 || waist <= 0) return null;
    return foot / waist > 1.33;
  };

  // Height to measure the letter over, and the height to read the waist at --
  // high on an H so the ruler passes above its crossbar, at the middle on the
  // letters that have nothing in the way there.
  const order = [
    [inkFor(typeface, "H"), capHeight, capHeight * 0.78],
    [inkFor(typeface, "n"), xHeight, xHeight * 0.5],
    [inkFor(typeface, "I"), capHeight, capHeight * 0.5],
    [inkFor(typeface, "l"), xHeight * 1.4, xHeight * 0.7],
  ] as const;

  for (const [contours, height, waistAt] of order) {
    if (!contours) continue;
    const answer = barred(contours, height, waistAt);
    if (answer !== null) return answer;
  }
  return null;
}

/**
 * How far the letter leans.
 *
 * Measured off the stem of an l rather than read from the italic angle the
 * font declares, because the declared angle is metadata and metadata is
 * frequently wrong -- and because a face can lean without ever saying so.
 */
function measureSlant(typeface: Typeface, xHeight: number, capHeight: number): number {
  // The I first, because it is a bare stem from end to end. An italic l often
  // curves into an entry stroke at the foot and out of an exit at the head,
  // and a line drawn between two points that are both on a curve reads a
  // shallower lean than the stem actually has.
  const readings: Array<[Contour[], number, number]> = [];
  const I = inkFor(typeface, "I");
  if (I) readings.push([I, capHeight * 0.25, capHeight * 0.75]);
  const l = inkFor(typeface, "l");
  if (l) readings.push([l, xHeight * 0.45, xHeight * 1.15]);
  const n = inkFor(typeface, "n");
  if (n) readings.push([n, xHeight * 0.2, xHeight * 0.8]);

  for (const [contours, low, high] of readings) {
    const centreAt = (at: number): number | null => {
      const runs = inkRunsAt(contours, at);
      if (runs.length === 0) return null;
      const [from, to] = runs[0];
      return (from + to) / 2;
    };
    const bottom = centreAt(low);
    const top = centreAt(high);
    if (bottom === null || top === null) continue;
    const degrees = (Math.atan2(top - bottom, high - low) * 180) / Math.PI;
    return Math.abs(degrees) < 0.5 ? 0 : Number(degrees.toFixed(1));
  }
  return 0;
}

/** The white inside an n, which is what everything with two uprights is spaced by. */
function measureCounter(typeface: Typeface, xHeight: number): number | null {
  const n = inkFor(typeface, "n");
  if (!n) return null;
  const runs = inkRunsAt(n, xHeight * 0.4);
  if (runs.length < 2) return null;
  const gap = runs[1][0] - runs[0][1];
  return gap > 0 ? gap : null;
}

/** The white a flat-sided letter is given either side. */
function measureSidebearing(typeface: Typeface): number | null {
  const readings: number[] = [];
  for (const character of ["H", "n", "I", "m"]) {
    const glyph = glyphFor(typeface, character);
    if (!glyph || glyph.contours.length === 0) continue;
    const bounds = contoursBounds(glyph.contours);
    if (!Number.isFinite(bounds.xMin)) continue;
    readings.push(bounds.xMin);
    readings.push(glyph.advanceWidth - bounds.xMax);
  }
  if (readings.length === 0) return null;
  readings.sort((a, b) => a - b);
  return readings[Math.floor(readings.length / 2)];
}

/** Every letter the same width, whatever it is. */
function measureMonospaced(typeface: Typeface): boolean {
  const widths: number[] = [];
  for (const character of "iHmoWl.") {
    const glyph = glyphFor(typeface, character);
    if (glyph && glyph.advanceWidth > 0) widths.push(glyph.advanceWidth);
  }
  if (widths.length < 4) return false;
  return widths.every((width) => Math.abs(width - widths[0]) <= widths[0] * 0.01);
}

/** How far a round letter passes a flat one. */
function measureOvershoot(typeface: Typeface, xHeight: number): number {
  const o = inkFor(typeface, "o");
  const x = inkFor(typeface, "x") ?? inkFor(typeface, "n");
  if (!o || !x) return Math.round(xHeight * 0.02);
  const over = contoursBounds(o).yMax - contoursBounds(x).yMax;
  // A negative reading means the two are level, which some faces are.
  return over > 0 ? Math.round(over) : 0;
}

export function measure(typeface: Typeface): Measured {
  const { unitsPerEm, metrics } = typeface;

  // The declared heights, checked against the letters. A font whose cap height
  // field is zero -- and there are plenty -- is better measured than believed.
  const capFromInk = inkFor(typeface, "H");
  const xFromInk = inkFor(typeface, "x");
  const capHeight =
    metrics.capHeight > 0
      ? metrics.capHeight
      : capFromInk
        ? Math.round(contoursBounds(capFromInk).yMax)
        : Math.round(unitsPerEm * 0.7);
  const xHeight =
    metrics.xHeight > 0
      ? metrics.xHeight
      : xFromInk
        ? Math.round(contoursBounds(xFromInk).yMax)
        : Math.round(unitsPerEm * 0.5);

  const slant = measureSlant(typeface, xHeight, capHeight);
  const monospaced = measureMonospaced(typeface);
  const sidebearing = measureSidebearing(typeface);
  const stem = measureStem(typeface, xHeight, capHeight);
  const crossbar = measureCrossbar(typeface, capHeight);
  const contrast =
    stem && crossbar ? Math.max(0, Math.min(0.95, 1 - crossbar / stem)) : null;

  return {
    familyName: typeface.meta.familyName,
    unitsPerEm,
    xHeight,
    capHeight,
    ascender: metrics.ascender,
    descender: metrics.descender,
    overshoot: measureOvershoot(typeface, xHeight),
    stem,
    crossbar,
    contrast,
    slant,
    serif: measureSerif(typeface, capHeight, xHeight),
    counterWidth: measureCounter(typeface, xHeight),
    sidebearing,
    monospaced,
    joining: sidebearing !== null && sidebearing < 0,
  };
}
