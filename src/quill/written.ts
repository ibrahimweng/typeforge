/**
 * A letter written with a pen, rather than drawn as an outline.
 *
 * The application had three ways to arrive at a letterform and each asked for
 * something the person in front of it may not have. The forge asks for nothing
 * and gives no way back to your own letter, because you never touched it. Trace
 * asks you to already own the font you are trying to make. The outline tools
 * ask for the one skill the whole product exists to make unnecessary: drawing
 * two nearly parallel curves and nudging the space between them until it reads
 * as a stem.
 *
 * This is the fourth way, and it is the one anybody who has held a broad-nib
 * pen already knows. Draw the line the pen travels, once, down the middle. Say
 * how wide the pen is, how much of a blade it is, and which way it is held. The
 * ink follows.
 *
 * Nothing here is new geometry. `sweep.ts` has swept a spine with a nib and a
 * width profile since the quill engine was built, and `fit.ts` has been
 * recovering exactly this description out of other people's fonts. What was
 * missing was a way for a person to write one down.
 *
 * ## Where the ink lives
 *
 * The strokes are the source and the outlines are kept in step with them. A
 * written glyph carries both: `written.strokes` is what the person drew, and
 * `glyph.contours` is that swept, rewritten on every edit. That is deliberate
 * and it is the cheap half of the design -- every reader downstream, the proof
 * page and the exporter and the masters and the boolean tools, goes on reading
 * `contours` and never learns that a pen was involved.
 *
 * The alternative was to derive the contours on demand and teach every reader
 * to ask. That is one source of truth instead of two, and it would mean
 * touching every one of them.
 */

import { sweepAll, toleranceFor } from "./sweep";
import { walkOf } from "./curve";
import type { Contour, Glyph } from "@/font/types";
import type { NibProfile, QuillSpine, QuillStroke } from "./types";

/**
 * A glyph's strokes, and whether the ink still follows them.
 *
 * `expanded` is the whole of `Expand`: the strokes stay, and the outlines stop
 * being rewritten from them. So the letter can be taken back to strokes for as
 * long as nobody has edited the outlines by hand, which is the thing the
 * reference product warns its users about and tells them to keep a copy first.
 */
export interface Written {
  strokes: QuillStroke[];
  /** Set by Expand. The outlines are the letter now, and the strokes are a way back. */
  expanded?: boolean;
}

/** The default pen: a broad nib at thirty degrees, which is a usable hand. */
export const STARTING_PEN: NibProfile = [{ at: 0, contrast: 0.55, angle: 30 }];

/**
 * A pen with a name, kept by the font rather than by the letter.
 *
 * The answer to the complaint that started all of this. Forty letters look like
 * one family because they share three pens, and not because somebody kept forty
 * sets of numbers in line by hand -- which is the work that needs the expertise,
 * and which nobody should have to do.
 *
 * A stop that names a pen takes its values from that pen and cannot hold its
 * own: `penOf` below resolves it. So changing the thick pen changes every stem
 * in the alphabet, and a stop that has to be its own is detached rather than
 * overridden. Overriding was the alternative and it is the trap -- a stop that
 * quietly holds different numbers from the pen it claims to use is a pen the
 * font is lying about.
 */
export interface SavedPen {
  /** Stable across renames, because a stop refers to it. */
  id: string;
  name: string;
  width: number;
  contrast: number;
  angle: number;
}

/**
 * The pens a written alphabet starts with.
 *
 * Real values from real hands rather than invented ones, so that somebody who
 * picks "Textura" gets a Textura and not an approximation of the idea of one.
 * The thickness of nought on three of the four is not a rounding -- a blade
 * with no thickness is what those hands are written with, and it is what gives
 * them their hairlines.
 */
export const STARTING_PENS: SavedPen[] = [
  { id: "textura", name: "Textura", width: 60, contrast: 1, angle: 40 },
  { id: "ruqaa", name: "Ruqaa", width: 100, contrast: 1, angle: 55 },
  { id: "ruqaa-soft", name: "Ruqaa, soft", width: 100, contrast: 0.8, angle: 55 },
  { id: "round-thick", name: "Roundhand thick", width: 90, contrast: 0.75, angle: 35 },
  { id: "round-thin", name: "Roundhand thin", width: 30, contrast: 0.4, angle: 35 },
];

/** The default pen width, in units of a thousand-unit em. */
export const STARTING_WIDTH = 90;

/**
 * The pen a stop is actually written with, following its name if it has one.
 *
 * Called wherever a stop's values are read, and it is the one rule that keeps a
 * named pen honest: the saved pen wins, always, and a stop that names one holds
 * nothing of its own worth reading. Storing the resolved values on the stop as
 * well was the alternative -- it saves a lookup and it is how caches drift, so
 * that a font ends up with stops claiming a pen whose numbers they no longer
 * have.
 *
 * A name that no longer exists falls back to the stop, so deleting a pen leaves
 * the letters looking as they did rather than resetting them.
 */
export function penOf(
  stop: { contrast: number; angle: number; pen?: string },
  pens: SavedPen[],
): { contrast: number; angle: number } {
  if (!stop.pen) return { contrast: stop.contrast, angle: stop.angle };
  const saved = pens.find((one) => one.id === stop.pen);
  return saved
    ? { contrast: saved.contrast, angle: saved.angle }
    : { contrast: stop.contrast, angle: stop.angle };
}

/**
 * Every stop that names a pen brought back into line with it.
 *
 * Run after a saved pen is edited, which is how one edit reaches the whole
 * alphabet. The stroke's width comes from the pen too, because width is the
 * pen's own axis and a "thick" that is thick only in its blade ratio is not
 * what anybody means by the word.
 */
export function followPens(strokes: QuillStroke[], pens: SavedPen[]): QuillStroke[] {
  return strokes.map((stroke) => {
    const named = stroke.nib.find((stop) => stop.pen);
    const saved = named ? pens.find((one) => one.id === named.pen) : undefined;
    return {
      ...stroke,
      width: saved ? [{ at: 0, width: saved.width }] : stroke.width,
      nib: stroke.nib.map((stop) => ({ ...stop, ...penOf(stop, pens) })),
    };
  });
}

/**
 * The ink a set of strokes makes.
 *
 * Left overlapping rather than united, which is what Trace does with the same
 * data and for the same two reasons. A non-zero fill draws overlapping strokes
 * correctly, so there is nothing to see; and uniting needs the boolean engine
 * loaded, which would make writing a letter asynchronous for no gain. The
 * export unites, once, on the way to a font file.
 */
export function inkOf(strokes: QuillStroke[], unitsPerEm: number): Contour[] {
  if (strokes.length === 0) return [];
  return sweepAll(strokes, toleranceFor(unitsPerEm)).contours;
}

/**
 * The same glyph with its outlines brought back into step with its strokes.
 *
 * A no-op on a glyph nobody wrote, and on one that has been expanded -- there
 * the outlines are the letter and the strokes are only kept so it can be taken
 * back.
 */
export function reswept(glyph: Glyph, unitsPerEm: number): Glyph {
  const written = glyph.written;
  if (!written || written.expanded) return glyph;
  return { ...glyph, contours: inkOf(written.strokes, unitsPerEm) };
}

/**
 * Where each of a spine's nodes falls along it, as a fraction of its length.
 *
 * The pen's stops are positioned by arc length, and the places a person wants
 * to set the pen are the nodes they drew. This is the bridge: the fractions a
 * fresh stroke's stops are put at, and the fractions the nib tool draws its
 * handles at.
 *
 * Positioned this way rather than held on the nodes themselves so that a stop
 * survives what a node does not. Dragging a handle changes a segment's length
 * and so moves every later node's fraction, which would drag the pen along the
 * stroke if the pen were pinned to the node; positioned by length it stays
 * where it was put, which is what a hand means by "the pen turns here". It also
 * lets the pen change somewhere the spine has no node at all.
 */
export function nodeFractions(spine: QuillSpine): number[] {
  const walk = walkOf(spine);
  if (walk.total <= 0) return spine.segments.map(() => 0);
  const fractions = [0];
  let covered = 0;
  for (const length of walk.lengths) {
    covered += length;
    fractions.push(Math.min(1, covered / walk.total));
  }
  return fractions;
}

/**
 * The stop of a pen profile nearest a fraction along the spine, by index.
 *
 * What the nib tool needs when somebody clicks one of the ellipses it drew.
 */
export function nearestStop(pen: NibProfile, fraction: number): number {
  let best = 0;
  let closest = Infinity;
  pen.forEach((stop, index) => {
    const gap = Math.abs(stop.at - fraction);
    if (gap < closest) {
      closest = gap;
      best = index;
    }
  });
  return best;
}

/**
 * A pen profile with a stop at each of a spine's nodes.
 *
 * What a freshly drawn stroke gets, so that the nib tool has a handle at every
 * point the person put down and turning the pen at one of them is a drag rather
 * than a decision about where stops go. A stroke of one segment gets two, at
 * each end.
 */
export function penAtNodes(spine: QuillSpine, pen: NibProfile): NibProfile {
  const held = pen[0] ?? { at: 0, contrast: 0, angle: 0 };
  return nodeFractions(spine).map((at) => ({
    at,
    contrast: held.contrast,
    angle: held.angle,
    ...(held.pen ? { pen: held.pen } : {}),
  }));
}
