/**
 * Whether a font is a joined script, judged by what its letters do.
 *
 * Worth saying why this is measured rather than read. A font can declare
 * itself a script in two places -- the `OS/2` family class, and the first byte
 * of PANOSE -- and both of the script faces this engine was built against
 * declare nothing at all: family class nought, PANOSE ten zeroes. That is not
 * unusual. Those fields are filled in by hand at the end of a project and are
 * routinely left at their defaults, so a detector that trusted them would send
 * exactly the fonts this is for to the wrong half of the application.
 *
 * So the evidence is the letters. A joined script is joined: the exit stroke of
 * one letter has to arrive at the entry of the next, which means the ink runs
 * to the edge of the advance and usually past it. A text face does the
 * opposite and keeps a clear sidebearing on both sides, because letters that
 * touch are a fault there. Measured across the round and straight lowercase,
 * the two are far apart -- the references overhang their advance on every
 * letter tried, where a text face crosses on none or one.
 *
 * What this is *for*: routing. A script that arrives in the outline editor
 * lands in front of controls that cannot reach what it is made of, and the
 * engine that can read it back into strokes sits one mode away, unvisited. The
 * question here is only which of the two to open, and it is always reversible
 * by hand, so a wrong answer costs a click rather than any work.
 */

import { contoursBounds } from "@/font/geometry";
import type { Glyph, Typeface } from "@/font/types";

/*
 * The round and straight lowercase, and nothing else.
 *
 * These are the letters whose ink stops at their sidebearings in a text face,
 * so they are the ones where reaching the edge means something. Left out are
 * every letter that overhangs for its own reasons -- `f` and `j` in an italic,
 * `y` and `g` with a swung tail, `w` and `v` with splayed diagonals -- which
 * would each read as a join in a face that has none.
 */
const TESTED = "acehimnorsu".split("");

/** How many of those letters a font has to have before the answer means anything. */
const ENOUGH = 5;

/**
 * How close to the edge counts as touching it.
 *
 * Not zero, because a script drawn to meet its neighbour exactly lands on the
 * advance rather than past it, and rounding to integer units puts a stroke that
 * was meant to touch a couple of units clear.
 */
const SLACK = 0.004;

/** How much of the tested lowercase has to reach the edge. */
const MOST = 0.6;

export interface JoinedVerdict {
  /** Whether this reads as a joined script. */
  joined: boolean;
  /** How many of the tested letters reach or cross their own advance. */
  reaching: number;
  /** How many were found to test. */
  tested: number;
  /**
   * The middling letter's tighter sidebearing, as a fraction of the em.
   *
   * Negative where the ink overhangs. Reported alongside the verdict because
   * it is the number the verdict is made of, and a caller showing somebody why
   * their font went where it did has something to show them.
   */
  sidebearing: number;
}

const NOTHING: JoinedVerdict = { joined: false, reaching: 0, tested: 0, sidebearing: 0 };

/** Look a font's letters up by the character they are typed with. */
function byCharacter(typeface: Typeface): Map<string, Glyph> {
  const found = new Map<string, Glyph>();
  for (const glyph of typeface.glyphs) {
    for (const code of glyph.unicodes ?? []) found.set(String.fromCodePoint(code), glyph);
  }
  return found;
}

/**
 * Whether this font's letters join, and the evidence for it.
 *
 * Answers no for anything it cannot see enough of: a font with three lowercase
 * letters, or one whose letters have no contours because they are all
 * components. No is the safe answer here -- it opens the font in the editor,
 * which is where every font could already be opened.
 */
export function looksJoined(typeface: Typeface): JoinedVerdict {
  const em = typeface.unitsPerEm || 1000;
  const found = byCharacter(typeface);

  let reaching = 0;
  const gaps: number[] = [];
  for (const letter of TESTED) {
    const glyph = found.get(letter);
    if (!glyph?.contours?.length || !glyph.advanceWidth) continue;
    const bounds = contoursBounds(glyph.contours);
    if (!Number.isFinite(bounds.xMin) || !Number.isFinite(bounds.xMax)) continue;
    const slack = em * SLACK;
    if (bounds.xMin < slack || bounds.xMax > glyph.advanceWidth - slack) reaching++;
    // The tighter of the two sides: a script joins on both, and one tight side
    // on its own is an italic's overhang or a tight fit rather than a join.
    gaps.push(Math.min(bounds.xMin, glyph.advanceWidth - bounds.xMax) / em);
  }

  if (gaps.length < ENOUGH) return NOTHING;
  gaps.sort((one, other) => one - other);
  return {
    joined: reaching / gaps.length >= MOST,
    reaching,
    tested: gaps.length,
    sidebearing: gaps[Math.floor(gaps.length / 2)],
  };
}
