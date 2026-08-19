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
 * The shoulder is where an arch springs from a stem. That is a junction
 * between a straight upright edge and the curve leaving it, but only half of
 * those are shoulders: an n has four such junctions, two where the arch leaves
 * the left stem and two where it comes down into the right one. Only the first
 * pair is the shoulder, and moving the other pair drags the far side of the
 * letter about instead.
 *
 * They are told apart by what the stem does past the junction. A shoulder sits
 * partway up a stem that carries on above and below it -- on DejaVu's n the
 * left stem runs from the baseline to 633, the arch leaves, and the stem
 * resumes from 946 to the x-height. Where the arch lands, the stem simply
 * stops: at x=1124 the only upright run is 0 to 676 and there is nothing above
 * it, because that stem exists only as the arch coming down.
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
 * Only the bar's own two edges move, and each end slides along whatever it is
 * attached to, so the bar stays joined to the strokes it crosses. On an A,
 * whose sides are diagonal, the ends travel along the diagonals rather than
 * straight up, which is the difference between moving the bar and detaching
 * it.
 *
 * Nothing moves at all unless every end sits on a straight segment. Selecting
 * points by height alone was the first version of this, and it dragged
 * whatever else happened to lie at that height: the bowl of an e lost three
 * curve points to it, and B, P and R one each. A bar whose ends meet a curve
 * is left alone rather than torn away from it.
 */
export function shiftCrossbar(contours: Contour[], shift: number): Contour[] {
  if (shift === 0) return contours;
  const bar = findCrossbar(contours);
  if (!bar) return contours;

  // Where each node has to go. Empty means there was nothing safe to move.
  const moves = new Map<string, Vec2>();

  for (let ci = 0; ci < contours.length; ci++) {
    const contour = contours[ci];
    const segments = contourSegments(contour);
    const count = contour.nodes.length;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.kind !== "line") continue;
      if (!isHorizontal(segment.from, segment.to)) continue;
      const y = (segment.from.y + segment.to.y) / 2;
      const onBar =
        Math.abs(y - bar.bottom) <= SAME_LEVEL || Math.abs(y - bar.top) <= SAME_LEVEL;
      if (!onBar) continue;

      // The two nodes this edge runs between, and the segment beyond each.
      for (const [nodeIndex, neighbour] of [
        [i, segments[(i - 1 + segments.length) % segments.length]],
        [(i + 1) % count, segments[(i + 1) % segments.length]],
      ] as const) {
        // A bar whose end meets a curve cannot be slid without deforming it.
        if (neighbour.kind !== "line") return contours;

        const dx = neighbour.to.x - neighbour.from.x;
        const dy = neighbour.to.y - neighbour.from.y;
        // Slide along the attachment. A vertical edge gives no sideways travel;
        // a diagonal one gives exactly enough to stay on it.
        const alongX = Math.abs(dy) < 1e-6 ? 0 : (dx / dy) * shift;
        const node = contour.nodes[nodeIndex];
        moves.set(`${ci}:${nodeIndex}`, {
          x: node.point.x + alongX,
          y: node.point.y + shift,
        });
      }
    }
  }

  if (moves.size === 0) return contours;

  return contours.map((contour, ci) => ({
    closed: contour.closed,
    nodes: contour.nodes.map((node, ni) => {
      const to = moves.get(`${ci}:${ni}`);
      if (!to) return node;
      return moveNode(node, to.x - node.point.x, to.y - node.point.y);
    }),
  }));
}

/** An upright run of a stem's edge. */
interface UprightRun {
  x: number;
  low: number;
  high: number;
}

/** How far apart in x two runs may be and still be the same stem edge. */
const SAME_EDGE = 3;
/** How far past a junction a stem has to carry on to count as carrying on. */
const CARRIES_ON = 2;

function uprightRuns(contours: Contour[]): UprightRun[] {
  const runs: UprightRun[] = [];
  for (const contour of contours) {
    for (const segment of contourSegments(contour)) {
      if (segment.kind !== "line") continue;
      const dx = Math.abs(segment.to.x - segment.from.x);
      const dy = Math.abs(segment.to.y - segment.from.y);
      if (dy <= dx * 2 || dy === 0) continue;
      runs.push({
        x: (segment.from.x + segment.to.x) / 2,
        low: Math.min(segment.from.y, segment.to.y),
        high: Math.max(segment.from.y, segment.to.y),
      });
    }
  }
  return runs;
}

/**
 * Where arches spring from their stems.
 *
 * Only the junctions the arch leaves from, not the ones it lands on: a stem
 * that carries on above and below the junction is a trunk the arch departs,
 * while a stem that stops at the junction is one the arch created on its way
 * down. Nothing has to know which letters have an arch.
 */
export function findShoulders(contours: Contour[]): Vec2[] {
  const runs = uprightRuns(contours);
  if (runs.length === 0) return [];
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

      const point = here.to;
      const onThisEdge = runs.filter((run) => Math.abs(run.x - point.x) <= SAME_EDGE);
      const above = onThisEdge.some((run) => run.high > point.y + CARRIES_ON);
      const below = onThisEdge.some((run) => run.low < point.y - CARRIES_ON);
      // The stem carries on past the junction in both directions, so the arch
      // is leaving it rather than arriving on it.
      if (!above || !below) continue;

      junctions.push({ ...point });
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
