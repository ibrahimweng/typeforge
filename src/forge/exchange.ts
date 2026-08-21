/**
 * One letter out to SVG and back.
 *
 * The escape hatch. Everything else in this half of the application draws
 * letters from a description, which is what makes a change to the serif reach
 * the whole font -- and also what makes the one letter you want to draw
 * yourself impossible. A skeleton and a pen will not give you the ampersand
 * you have in mind, and no amount of sliders will either.
 *
 * So a letter can leave as a drawing, be worked on anywhere, and come back
 * into the slot it left. It stops being drawn at that point -- it has to, since
 * there is no longer a description to draw it from -- and the font says so,
 * and it can be put back under the family's control whenever you want it back.
 *
 * The metrics travel with it as guides. A letter drawn without knowing where
 * the baseline is is a drawing, not a letter, and the whole point of the trip
 * is that what comes back is still a letter.
 */

import { glyphSvg, readSvg, svgToFontUnits, type SvgGuide, type SvgNote } from "@/font/svg";
import type { Contour } from "@/font/types";
import { solid, type Forge } from "./document";

/** A letter that came in from outside and is no longer drawn from a skeleton. */
export interface Imported {
  contours: Contour[];
  advanceWidth: number;
  /** The file it arrived in, so the panel can say where it came from. */
  from: string;
}

/**
 * The horizontal lines worth seeing while drawing.
 *
 * Overshoot is left off deliberately. It is a correction of a few units either
 * side of a line that is already drawn, and a sheet with eight lines on it is
 * harder to read than one with five.
 */
export function guidesFor(forge: Forge): SvgGuide[] {
  const { metrics } = forge.style;
  return [
    { label: "descender", height: metrics.descender },
    { label: "baseline", height: 0 },
    { label: "x-height", height: metrics.xHeight },
    { label: "cap height", height: metrics.capHeight },
    { label: "ascender", height: metrics.ascender },
  ];
}

/**
 * One letter as an SVG sheet, ready to be opened anywhere.
 *
 * The solid letter, with whatever the font cuts out of it left in. What leaves
 * has to be the letter the cuts are applied to rather than the letter after
 * them: export a slotted n and the slots arrive in the file as part of the
 * outline, and the font then cuts fresh slots through the ones already there.
 * Sending the solid letter keeps the cut a description, so it goes on applying
 * to whatever comes back.
 */
export function letterSvg(letter: string, forge: Forge): string | null {
  const drawn = solid(letter, forge);
  if (!drawn) return null;
  const { metrics } = forge.style;
  return glyphSvg({
    name: letter,
    contours: drawn.contours,
    advanceWidth: drawn.advanceWidth,
    unitsPerEm: metrics.unitsPerEm,
    top: metrics.ascender,
    bottom: metrics.descender,
    guides: guidesFor(forge),
    sidebearings: { left: metrics.sidebearing, right: metrics.sidebearing },
  });
}

/** What a file names itself, and what it will become if it is taken. */
export interface Arrival {
  /** The letter the file says it is for, if it says. */
  note: SvgNote | null;
  /** Which letter this is going into. */
  letter: string;
  contours: Contour[];
  advanceWidth: number;
  /** Set when the file was for a different letter than the one being filled. */
  mismatched: boolean;
}

/**
 * Read a sheet back.
 *
 * The letter it goes into is the one named, unless the caller names a
 * different one -- dropping the file onto a particular slot is a decision, and
 * a decision beats a note. Where the two differ, the difference is reported
 * rather than resolved silently, because a file landing in the wrong slot is
 * the one mistake here that is easy to make and hard to notice.
 */
export function readLetterSvg(text: string, forge: Forge, into?: string): Arrival | null {
  const drawing = readSvg(text);
  const letter = into ?? drawing.note?.name;
  if (!letter) return null;

  const { metrics } = forge.style;
  const existing = solid(letter, forge);
  const { contours, advanceWidth } = svgToFontUnits(drawing, {
    top: metrics.ascender,
    bottom: metrics.descender,
    advanceWidth: existing?.advanceWidth ?? metrics.unitsPerEm / 2,
  });
  if (contours.length === 0) return null;

  return {
    note: drawing.note,
    letter,
    contours,
    // A letter coming back into its own slot keeps the advance it left with,
    // whatever the note says: the rhythm of the font is the font's business,
    // and a drawing program has no opinion worth taking about it.
    advanceWidth: existing ? existing.advanceWidth : advanceWidth,
    mismatched: drawing.note !== null && drawing.note.name !== letter,
  };
}
