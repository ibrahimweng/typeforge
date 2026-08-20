/**
 * Spacing and kerning a set of drawings that arrived with neither.
 *
 * This is the part of a font that nobody sees and everybody feels. Twenty-six
 * beautiful letters spaced by their bounding boxes read as a ransom note: an
 * H sits square in its box and an A does not, so giving them the same white
 * either side gives them visibly different white either side. What the eye
 * measures is not the gap to the extreme point, it is roughly the area of
 * white between one letter and the next.
 *
 * So that is what is measured here. The silhouette of each letter is sampled
 * across its height, the distance from a vertical edge to the ink is averaged
 * down the column, and the sidebearing is whatever makes that average come out
 * the same for every letter. A flat-sided H gets the full measure; a round o
 * gets a little less, because its own curve has already given some back; an A
 * gets much less, because it is mostly white on both sides already.
 *
 * One number keeps the whole thing honest, and it is the depth limit. Without
 * it a C is measured as though the inside of its bowl were white beside it,
 * and it gets rammed against its neighbour to compensate. Ink stops counting
 * once it is further in than a letter's neighbour could ever see, which is
 * what the eye does too.
 *
 * What this does not do, and it is worth knowing before wondering why: it
 * under-kerns the pairs where one letter overhangs the other rather than
 * leaning away from it. A T beside an o gets a few units where a designer
 * would give it eighty, because the two do come close where the T's stem
 * passes the o's shoulder and the closest approach is what a kern is measured
 * by here. Widening that measure to an average of the white catches To and
 * then closes oo, which no font on earth does, and being wrong about the
 * commonest pair in the language to be right about a rarer one is a bad trade.
 * So those pairs are left for the hand, which is what the pair editor is for.
 */

import { contoursBounds, flattenContour } from "@/font/geometry";
import type { Contour, KernPair } from "@/font/types";

export interface SpacingMetrics {
  unitsPerEm: number;
  xHeight: number;
  capHeight: number;
  ascender: number;
  descender: number;
}

export interface SpacingSettings {
  /**
   * The white wanted beside every letter, as a fraction of the em.
   *
   * The one control that sets how the whole set reads: turn it up and the font
   * opens out, turn it down and it tightens. Everything else here is measured.
   */
  white: number;
  /**
   * How far into a letter the eye is allowed to look, as a fraction of the em.
   *
   * The number that stops a C being spaced as though its bowl were beside it.
   */
  depth: number;
  /**
   * How much of the measured excess a kern actually takes out.
   *
   * Well under one, and deliberately. Closing an A against a V until the white
   * between them matched two flat stems would run them into each other -- the
   * white in that wedge is real white and the eye wants some of it. A third of
   * the excess is about what a designer takes out by hand, and it is a control
   * because a set of drawings with wild shapes in it can want holding back.
   * Zero turns kerning off.
   */
  kern: number;
}

/*
 * Calibrated against letters whose spacing is already known good, by writing
 * a drawn font out as sheets, assembling it blind, and comparing. The white
 * lands a flat-sided stem where the drawn font puts it, and the depth is what
 * separates an H from an A by about the margin a designer would.
 */
export const DEFAULT_SPACING: SpacingSettings = {
  white: 0.06,
  depth: 0.05,
  kern: 0.35,
};

/** How many rows the silhouette is sampled at. */
const ROWS = 56;

/**
 * One letter's shape, as the two edges a neighbour can see.
 *
 * Both are measured from the drawing's own leftmost point, so a silhouette
 * says nothing about where the letter sits and everything about its shape.
 * That is what makes it reusable: move the letter and the silhouette is still
 * true.
 */
export interface Silhouette {
  /** The row heights, low to high. */
  rows: number[];
  /** Leftmost ink in each row, from the ink's left edge. Infinity where empty. */
  left: number[];
  /** Rightmost ink in each row, from the ink's left edge. -Infinity where empty. */
  right: number[];
  /** Width of the ink itself. */
  width: number;
  /** Whether there is any ink at all. */
  drawn: boolean;
}

/**
 * Measure a letter's two edges.
 *
 * Sampled off flattened outlines rather than solved against the curves. The
 * answer feeds an average over fifty-odd rows, so the error of a polyline is
 * an order of magnitude below anything that could change a sidebearing, and
 * solving cubics for every row of every letter of every pair would cost far
 * more than it could possibly buy.
 */
export function silhouetteOf(contours: Contour[], metrics: SpacingMetrics): Silhouette {
  const bounds = contoursBounds(contours);
  const empty: Silhouette = { rows: [], left: [], right: [], width: 0, drawn: false };
  if (!Number.isFinite(bounds.xMin) || bounds.xMax <= bounds.xMin) return empty;

  // Sampled over the band the font lives in rather than over the letter, so an
  // o and an l are compared on the same rows. Clipped to the letter, because a
  // row above an o has nothing to say about it.
  const low = Math.max(metrics.descender, bounds.yMin);
  const high = Math.min(metrics.ascender, bounds.yMax);
  if (high <= low) return empty;

  const polylines = contours.map((contour) => flattenContour(contour, 16));
  const rows: number[] = [];
  const left: number[] = [];
  const right: number[] = [];

  for (let index = 0; index < ROWS; index++) {
    // Inset half a step at each end: a row exactly on the top of an o crosses
    // it at a single point, and a single point is not an edge.
    const at = low + ((index + 0.5) / ROWS) * (high - low);
    const crossings = crossingsAt(polylines, at);
    rows.push(at);
    if (crossings.length === 0) {
      left.push(Infinity);
      right.push(-Infinity);
    } else {
      left.push(Math.min(...crossings) - bounds.xMin);
      right.push(Math.max(...crossings) - bounds.xMin);
    }
  }

  return { rows, left, right, width: bounds.xMax - bounds.xMin, drawn: true };
}

/** Where a horizontal line at this height meets the outlines. */
function crossingsAt(polylines: Array<Array<{ x: number; y: number }>>, at: number): number[] {
  const hits: number[] = [];
  for (const points of polylines) {
    for (let index = 0; index < points.length; index++) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if (a.y === b.y) continue;
      const low = Math.min(a.y, b.y);
      const high = Math.max(a.y, b.y);
      if (at < low || at >= high) continue;
      hits.push(a.x + ((at - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  return hits;
}

/** What a letter's shape gives back on each side, before any sidebearing. */
export interface Inset {
  left: number;
  right: number;
}

/**
 * How far the ink retreats from its own edges, on average, down the column.
 *
 * Zero for a letter with two flat sides. Positive for everything else, and
 * that positive number is exactly what should come off its sidebearings.
 */
export function insetOf(silhouette: Silhouette, settings: SpacingSettings, em: number): Inset {
  if (!silhouette.drawn) return { left: 0, right: 0 };
  const depth = settings.depth * em;

  let leftSum = 0;
  let rightSum = 0;
  let counted = 0;
  for (let index = 0; index < silhouette.rows.length; index++) {
    const near = silhouette.left[index];
    const far = silhouette.right[index];
    if (!Number.isFinite(near) || !Number.isFinite(far)) continue;
    leftSum += Math.min(near, depth);
    rightSum += Math.min(silhouette.width - far, depth);
    counted++;
  }
  if (counted === 0) return { left: 0, right: 0 };
  return { left: leftSum / counted, right: rightSum / counted };
}

export interface Spaced {
  /** White to the left of the ink. */
  left: number;
  /** White to the right of the ink. */
  right: number;
  advanceWidth: number;
}

/**
 * The sidebearings that give every letter the same white.
 *
 * Never negative: a letter is allowed to be tight against its neighbour but
 * not to reach across into it, because a sidebearing that goes past zero is a
 * kern wearing the wrong hat and it would apply to every pair at once.
 */
export function spaceOne(
  silhouette: Silhouette,
  settings: SpacingSettings,
  metrics: SpacingMetrics,
): Spaced {
  const em = metrics.unitsPerEm;
  const wanted = settings.white * em;
  if (!silhouette.drawn) {
    // A space, or a file with nothing in it. There is no ink to measure, so
    // it gets a plain word space rather than a measurement.
    const blank = Math.round(em * 0.26);
    return { left: 0, right: 0, advanceWidth: blank };
  }
  const inset = insetOf(silhouette, settings, em);
  const left = Math.max(0, wanted - inset.left);
  const right = Math.max(0, wanted - inset.right);
  return { left, right, advanceWidth: left + silhouette.width + right };
}

/** A letter, measured and placed, ready to be asked about its neighbours. */
export interface Placed {
  character: string;
  silhouette: Silhouette;
  spaced: Spaced;
}

/**
 * How much to pull two letters together.
 *
 * Measured at their closest approach, and that choice is the whole design.
 * Averaging the white down the column looks more thorough and gives the wrong
 * answer on the commonest pair in the language: two round letters have more
 * white around them than two flat ones by any area measure, and yet they need
 * no kerning at all, because where they come nearest they come as near as
 * anything else does. Two diagonals leaning apart are the opposite -- the
 * wedge between them is wide at every single row, the nearest point included
 * -- and that is exactly what wants closing.
 *
 * So the measure is the minimum gap, against what two flat stems would leave.
 * Two round letters come out at nothing because their nearest point is already
 * tight. Two flat ones come out at nothing because they are the reference.
 * A and V come out at a great deal.
 *
 * It only ever pulls together. A pair further apart at its nearest point than
 * the reference has too much white; a pair closer than the reference has the
 * spacing it was given, and prising one pair open is a job for the
 * sidebearings that set it, not for a kern that fights them.
 *
 * Only the rows they share are counted. An A beside a T is decided by the arm
 * over the foot; a row below the arm, where the T is a narrow stem and the A
 * is nothing at all, has no opinion about the pair.
 */
export function kernBetween(
  left: Placed,
  right: Placed,
  settings: SpacingSettings,
  em: number,
): number {
  if (!left.silhouette.drawn || !right.silhouette.drawn) return 0;
  const rows = Math.min(left.silhouette.rows.length, right.silhouette.rows.length);

  let closest = Infinity;
  for (let index = 0; index < rows; index++) {
    const leftEdge = left.silhouette.right[index];
    const rightEdge = right.silhouette.left[index];
    if (!Number.isFinite(leftEdge) || !Number.isFinite(rightEdge)) continue;
    // White after the first letter's ink at this row, plus white before the
    // second's.
    const gap =
      left.spaced.right + (left.silhouette.width - leftEdge) + right.spaced.left + rightEdge;
    if (gap < closest) closest = gap;
  }
  if (!Number.isFinite(closest)) return 0;

  // What two flat-sided stems would leave: one sidebearing each and nothing
  // given back.
  const reference = 2 * settings.white * em;
  const excess = closest - reference;
  if (excess <= 0) return 0;
  return -Math.round(settings.kern * excess);
}

/**
 * Every pair worth storing.
 *
 * A font with seventy-five glyphs has five and a half thousand possible pairs
 * and no use for most of them: the overwhelming majority come out at nothing,
 * because two flat-sided letters beside each other are already right. Only
 * the ones that move by more than a rounding are kept, which is what a font
 * does by hand and what keeps the table a sensible size.
 */
export function kernPairs(
  placed: Placed[],
  settings: SpacingSettings,
  metrics: SpacingMetrics,
): KernPair[] {
  if (settings.kern === 0) return [];
  const em = metrics.unitsPerEm;
  // Below a thousandth of the em nothing is visible at any size anybody reads
  // at, and a table full of ones is a table nobody can check.
  const worth = Math.max(1, em / 1000);
  const pairs: KernPair[] = [];

  for (const left of placed) {
    if (!left.silhouette.drawn) continue;
    for (const right of placed) {
      if (!right.silhouette.drawn) continue;
      const value = kernBetween(left, right, settings, em);
      if (Math.abs(value) >= worth) {
        pairs.push({ left: left.character, right: right.character, value });
      }
    }
  }
  return pairs;
}
