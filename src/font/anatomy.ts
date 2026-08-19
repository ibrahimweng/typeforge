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

import {
  contourSegments,
  contoursBounds,
  cubicParametersAtY,
  splitCubic,
  type Segment,
} from "./geometry";
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

/** What one point of a bar's edge becomes after the move. */
interface NodeEdit {
  point: Vec2;
  handleIn?: Vec2 | null;
  handleOut?: Vec2 | null;
}

/**
 * Where a bar's end lands after moving, and what it does to what it is
 * attached to.
 *
 * A straight attachment is easy: slide along it, which on a vertical stem is
 * straight up and on the diagonal of an A is along the diagonal.
 *
 * A curved attachment is the interesting one, and translating the point was
 * never going to work: it drags the end of the curve while the far end and the
 * handles stay put, which is what tore the bowl of an e. Instead the curve is
 * solved for the height wanted and split there. The point lands exactly on the
 * curve, and the piece that remains is the original curve's own tail rather
 * than an approximation of it, so nothing outside the join is disturbed. The
 * bar naturally becomes shorter or longer as the bowl narrows or widens, which
 * is what the letter should do.
 *
 * When the curve does not reach that height, the end is moved to it anyway and
 * the curve stretches to follow, carrying its own handle with it and leaving
 * the far end alone. That is the ordinary result of dragging a point in any
 * editor. It is needed because an exact slide is often not available: the bar
 * of an e ends at (305,516) on a curve running down to (420,227), so raising it
 * has nowhere on that curve to land -- the corner is the highest the aperture
 * reaches. The two joining curves are reshaped rather than reproduced, which is
 * visible only at large moves; the bowl's outer shape is untouched either way.
 */
function slideAlong(
  attachment: Segment,
  end: "from" | "to",
  point: Vec2,
  shift: number,
): { here: NodeEdit; far: Partial<NodeEdit> } | null {
  const wanted = point.y + shift;

  if (attachment.kind === "line") {
    const dx = attachment.to.x - attachment.from.x;
    const dy = attachment.to.y - attachment.from.y;
    // A vertical edge gives no sideways travel; a diagonal gives exactly
    // enough to stay on it.
    const alongX = Math.abs(dy) < 1e-6 ? 0 : (dx / dy) * shift;
    return { here: { point: { x: point.x + alongX, y: wanted } }, far: {} };
  }

  const { from, c1, c2, to } = attachment;
  const parameters = cubicParametersAtY(from, c1, c2, to, wanted).filter((t) => t > 0 && t < 1);
  if (parameters.length === 0) {
    // No point on this curve sits at the height wanted, so stretch it instead.
    const moved = { x: point.x, y: wanted };
    return end === "from"
      ? { here: { point: moved, handleOut: { x: c1.x, y: c1.y + shift } }, far: {} }
      : { here: { point: moved, handleIn: { x: c2.x, y: c2.y + shift } }, far: {} };
  }
  // Nearest to the end being moved, so a curve doubling back cannot send the
  // bar to the far side of it.
  const t = parameters.reduce((best, candidate) =>
    Math.abs(candidate - (end === "from" ? 0 : 1)) < Math.abs(best - (end === "from" ? 0 : 1))
      ? candidate
      : best,
  );

  const [left, right] = splitCubic(from, c1, c2, to, t);
  if (end === "from") {
    // The bar's end starts this curve, so keep the far portion.
    return {
      here: { point: right[0], handleOut: right[1] },
      far: { handleIn: right[2] },
    };
  }
  // The curve arrives at the bar's end, so keep the near portion.
  return {
    here: { point: left[3], handleIn: left[2] },
    far: { handleOut: left[1] },
  };
}

/**
 * Move the crossbar up or down.
 *
 * Only the bar's own two edges move, and each end follows whatever it is
 * attached to -- along a stem, down the diagonal of an A, or around the bowl of
 * an e. Selecting points by height alone was the first version of this, and it
 * dragged whatever else happened to lie at that height: the bowl of an e lost
 * three curve points to it, and B, P and R one each.
 *
 * Nothing moves unless every end can be placed, so a bar is never left
 * half-attached.
 */
export function shiftCrossbar(contours: Contour[], shift: number): Contour[] {
  if (shift === 0) return contours;
  const bar = findCrossbar(contours);
  if (!bar) return contours;

  const edits = new Map<string, NodeEdit>();
  const merge = (ci: number, ni: number, edit: Partial<NodeEdit>, fallback: Vec2): void => {
    const key = `${ci}:${ni}`;
    const existing = edits.get(key);
    edits.set(key, { point: fallback, ...existing, ...edit } as NodeEdit);
  };

  for (let ci = 0; ci < contours.length; ci++) {
    const contour = contours[ci];
    const segments = contourSegments(contour);
    const count = contour.nodes.length;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.kind !== "line") continue;
      if (!isHorizontal(segment.from, segment.to)) continue;
      const y = (segment.from.y + segment.to.y) / 2;
      if (Math.abs(y - bar.bottom) > SAME_LEVEL && Math.abs(y - bar.top) > SAME_LEVEL) continue;

      const startIndex = i;
      const endIndex = (i + 1) % count;
      const before = segments[(i - 1 + segments.length) % segments.length];
      const after = segments[(i + 1) % segments.length];

      // The edge's own two points, each following the segment beyond it.
      const startSlide = slideAlong(before, "to", contour.nodes[startIndex].point, shift);
      const endSlide = slideAlong(after, "from", contour.nodes[endIndex].point, shift);
      if (!startSlide || !endSlide) continue;

      merge(ci, startIndex, startSlide.here, contour.nodes[startIndex].point);
      merge(ci, (startIndex - 1 + count) % count, startSlide.far, contour.nodes[(startIndex - 1 + count) % count].point);
      merge(ci, endIndex, endSlide.here, contour.nodes[endIndex].point);
      merge(ci, (endIndex + 1) % count, endSlide.far, contour.nodes[(endIndex + 1) % count].point);
    }
  }

  if (edits.size === 0) return contours;

  return contours.map((contour, ci) => ({
    closed: contour.closed,
    nodes: contour.nodes.map((node, ni) => {
      const edit = edits.get(`${ci}:${ni}`);
      if (!edit) return node;
      return {
        ...node,
        point: edit.point,
        handleIn: edit.handleIn !== undefined ? edit.handleIn : node.handleIn,
        handleOut: edit.handleOut !== undefined ? edit.handleOut : node.handleOut,
      };
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
