/**
 * Where a dragged point wants to land.
 *
 * Nothing snapped. A point dragged in this editor landed wherever the pointer
 * was let go of, with no pull towards a whole unit, a metric line, a guide, or
 * another point -- and every coordinate the application shows is shown
 * rounded, so a letter drawn by dragging was off the grid in every coordinate
 * and looked perfectly right until something measured it. That is the worst
 * kind of fault: invisible in the tool that made it, obvious in the file.
 *
 * Two ideas, and the second is the one that matters.
 *
 * A *line* is something worth landing on: the baseline, the x-height, a guide,
 * the left sidebearing, the far side of the advance -- and the x or y of any
 * other point in the letter, because two stems the same width and two feet on
 * one line are most of what makes an alphabet look drawn by one hand.
 *
 * And a named line always beats the grid. Within reach of the x-height you
 * land on the x-height, not on the nearest whole unit half a unit away from
 * it. Getting that the wrong way round gives a tool that snaps enthusiastically
 * to nothing in particular.
 */

import type { Contour, Glyph, Typeface, Vec2 } from "./types";

/** Something a dragged point can land on, and what to call it. */
export interface Line {
  at: number;
  /** Shown while it is being snapped to, so the pull is never a mystery. */
  label: string;
}

export interface Lines {
  x: Line[];
  y: Line[];
}

/** What a snap did, so the caller can draw it. */
export interface Snapped {
  point: Vec2;
  x: Line | null;
  y: Line | null;
}

/** The nearest line within reach, or nothing. */
function nearest(value: number, lines: Line[], within: number): Line | null {
  let best: Line | null = null;
  let closest = within;
  for (const line of lines) {
    const gap = Math.abs(line.at - value);
    if (gap <= closest) {
      closest = gap;
      best = line;
    }
  }
  return best;
}

/**
 * A coordinate pulled onto whatever is nearest.
 *
 * The grid is the fallback and never competes: a whole unit is always within
 * half a unit, so a grid that took part in the comparison would win every
 * time and no named line would ever be reached.
 */
export function snapValue(
  value: number,
  lines: Line[],
  within: number,
): { at: number; line: Line | null } {
  const line = nearest(value, lines, within);
  if (line) return { at: line.at, line };
  return { at: Math.round(value), line: null };
}

/** A point pulled onto whatever is nearest, each axis on its own. */
export function snapPoint(point: Vec2, lines: Lines, within: number): Snapped {
  const x = snapValue(point.x, lines.x, within);
  const y = snapValue(point.y, lines.y, within);
  return { point: { x: x.at, y: y.at }, x: x.line, y: y.line };
}

/**
 * Everything in a letter worth landing on.
 *
 * The points of the letter itself are in here, which is what makes this worth
 * having rather than a grid: two stems drawn the same width and two feet
 * standing on one line are most of what makes an alphabet look as though one
 * hand drew it, and neither is something a grid can help with.
 *
 * The points being dragged are left out. A point that snapped to itself would
 * never move at all, and one that snapped to the point beside it in the same
 * drag would collapse the two together.
 */
export function linesFor(
  typeface: Typeface,
  glyph: Glyph,
  guides: ReadonlyArray<{ axis: "x" | "y"; at: number }>,
  moving: ReadonlySet<string> = new Set(),
): Lines {
  const { metrics } = typeface;
  const y: Line[] = [
    { at: 0, label: "baseline" },
    { at: metrics.xHeight, label: "x-height" },
    { at: metrics.capHeight, label: "cap height" },
    { at: metrics.ascender, label: "ascender" },
    { at: metrics.descender, label: "descender" },
  ];
  const x: Line[] = [
    { at: 0, label: "origin" },
    { at: glyph.advanceWidth, label: "advance" },
  ];

  for (const guide of guides) {
    (guide.axis === "y" ? y : x).push({ at: guide.at, label: "guide" });
  }

  /*
   * The letter's own points, deduplicated: an `n` has four points on the
   * baseline and there is nothing to gain from four lines in the same place,
   * except a comparison run four times.
   */
  const seenX = new Set(x.map((one) => one.at));
  const seenY = new Set(y.map((one) => one.at));
  glyph.contours.forEach((contour: Contour, contourIndex) => {
    contour.nodes.forEach((node, nodeIndex) => {
      if (moving.has(`${contourIndex}:${nodeIndex}`)) return;
      if (!seenX.has(node.point.x)) {
        seenX.add(node.point.x);
        x.push({ at: node.point.x, label: "a point" });
      }
      if (!seenY.has(node.point.y)) {
        seenY.add(node.point.y);
        y.push({ at: node.point.y, label: "a point" });
      }
    });
  });

  return { x, y };
}
