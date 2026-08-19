/**
 * Named parts of a letter.
 *
 * The parameters so far reshape a letter as a whole -- heavier, wider, more
 * slanted. These reach into it and move one named part, which is how a type
 * designer talks about the work: raise the crossbar, square up the shoulder.
 *
 * Both parts are found from the drawing rather than from a list of which
 * letters have them, so they hold for glyphs nobody thought about.
 *
 * The crossbar is the horizontal stroke nearest the middle of the letter --
 * the bar of an H or an A, the middle arm of an E, the eye of an e, the bar of
 * a t. Bars sitting at the very top or bottom are left out: they are the ends
 * of the letter rather than something crossing it, and moving them would
 * change its height.
 *
 * The shoulder is where an arch springs from a stem, found as the junction
 * between a straight upright edge and the curve leaving it. On DejaVu that
 * finds four such junctions on n, six on m, four on u, two on b, and none at
 * all on o, which has no straight stem for a curve to spring from.
 */

import { contourSegments, contoursBounds } from "./geometry";
import type { Contour, GlyphNode, Vec2 } from "./types";

/** How far from horizontal a segment may run and still count as one. */
const HORIZONTAL_TOLERANCE = 0.12;
/** How close two edges have to be in height to be the same edge of a bar. */
const SAME_LEVEL = 2;
/** How near the top or bottom of a letter a bar stops being a crossbar. */
const EXTREME_MARGIN = 0.06;
/** Thickest band still read as one bar, as a fraction of the letter's height. */
const MAX_BAR_DEPTH = 0.4;

/** The band a crossbar occupies. */
export interface Crossbar {
  bottom: number;
  top: number;
}

function isHorizontal(from: Vec2, to: Vec2): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dx > 0 && dy <= dx * HORIZONTAL_TOLERANCE;
}

/**
 * Find the horizontal stroke crossing the middle of a letter.
 *
 * Every straight horizontal edge is collected, those at the extremes are
 * dropped, and the two remaining levels closest together around the middle are
 * taken as the top and bottom of the bar. Returns null when a letter has no
 * such stroke, which is most of them.
 */
export function findCrossbar(contours: Contour[]): Crossbar | null {
  if (contours.length === 0) return null;
  const bounds = contoursBounds(contours);
  const height = bounds.yMax - bounds.yMin;
  if (height <= 0) return null;

  const margin = height * EXTREME_MARGIN;
  const levels: number[] = [];
  for (const contour of contours) {
    for (const segment of contourSegments(contour)) {
      if (segment.kind !== "line") continue;
      if (!isHorizontal(segment.from, segment.to)) continue;
      const y = (segment.from.y + segment.to.y) / 2;
      // The ends of the letter are not something crossing it.
      if (y <= bounds.yMin + margin || y >= bounds.yMax - margin) continue;
      if (!levels.some((existing) => Math.abs(existing - y) <= SAME_LEVEL)) levels.push(y);
    }
  }
  if (levels.length < 2) return null;

  levels.sort((a, b) => a - b);
  const middle = (bounds.yMin + bounds.yMax) / 2;

  // The pair of adjacent levels straddling, or nearest to, the middle.
  let best: Crossbar | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i + 1 < levels.length; i++) {
    const bottom = levels[i];
    const top = levels[i + 1];
    if (top - bottom > height * MAX_BAR_DEPTH) continue;
    const distance = Math.abs((bottom + top) / 2 - middle);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { bottom, top };
    }
  }
  return best;
}

/**
 * Move the crossbar up or down.
 *
 * Only the points inside the bar's own band move, so the stems it crosses stay
 * where they are and the letter keeps its height.
 */
export function shiftCrossbar(contours: Contour[], shift: number): Contour[] {
  if (shift === 0) return contours;
  const bar = findCrossbar(contours);
  if (!bar) return contours;

  return contours.map((contour) => ({
    closed: contour.closed,
    nodes: contour.nodes.map((node) =>
      node.point.y >= bar.bottom - SAME_LEVEL && node.point.y <= bar.top + SAME_LEVEL
        ? moveNode(node, 0, shift)
        : node,
    ),
  }));
}

/**
 * Where arches spring from their stems.
 *
 * A shoulder shows up as a junction between a straight, near-upright edge and
 * a curve leaving it. Nothing has to know which letters have one.
 */
export function findShoulders(contours: Contour[]): Vec2[] {
  const junctions: Vec2[] = [];

  for (const contour of contours) {
    const segments = contourSegments(contour);
    if (segments.length < 2) continue;

    for (let i = 0; i < segments.length; i++) {
      const here = segments[i];
      const next = segments[(i + 1) % segments.length];
      const straightThenCurved = here.kind === "line" && next.kind === "cubic";
      const curvedThenStraight = here.kind === "cubic" && next.kind === "line";
      if (!straightThenCurved && !curvedThenStraight) continue;

      const line = here.kind === "line" ? here : next;
      const dx = Math.abs(line.to.x - line.from.x);
      const dy = Math.abs(line.to.y - line.from.y);
      // Upright, so this is a stem rather than the flat end of an arm.
      if (dy <= dx * 2) continue;

      junctions.push({ ...here.to });
    }
  }

  return junctions;
}

/**
 * Raise or lower where the arches spring.
 *
 * Moving the junction up carries the arch with it and squares the shoulder;
 * moving it down opens the letter out. The stems above and below stay put, so
 * only the height at which the curve leaves the stem changes.
 */
export function shiftShoulders(contours: Contour[], shift: number): Contour[] {
  if (shift === 0) return contours;
  const junctions = findShoulders(contours);
  if (junctions.length === 0) return contours;

  const near = (point: Vec2): boolean =>
    junctions.some(
      (junction) =>
        Math.abs(junction.x - point.x) <= SAME_LEVEL && Math.abs(junction.y - point.y) <= SAME_LEVEL,
    );

  return contours.map((contour) => ({
    closed: contour.closed,
    nodes: contour.nodes.map((node) => (near(node.point) ? moveNode(node, 0, shift) : node)),
  }));
}

/** Move a point and the handles that belong to it. */
function moveNode(node: GlyphNode, dx: number, dy: number): GlyphNode {
  const move = (point: Vec2 | null): Vec2 | null =>
    point ? { x: point.x + dx, y: point.y + dy } : null;
  return {
    ...node,
    point: { x: node.point.x + dx, y: node.point.y + dy },
    handleIn: move(node.handleIn),
    handleOut: move(node.handleOut),
  };
}
