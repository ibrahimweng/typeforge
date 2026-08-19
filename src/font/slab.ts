/**
 * Slab terminals.
 *
 * Turning a sans into a slab serif by finding where each stroke ends and
 * laying a bar across it. This is the change that most obviously makes one
 * design out of another, and it needs no knowledge of which letter it is
 * looking at.
 *
 * A stroke end is a short straight edge whose two neighbouring edges run
 * perpendicular to it and point in opposite directions -- the flat bottom of a
 * stem with its two sides running back up, or the flat end of an arm. That
 * description finds all four ends of an H, both ends of an I, the two feet and
 * the stem top of an n, and the three arm ends of an E.
 *
 * It also finds one thing that is not a stroke end, and the fix is what makes
 * this reliable: the tall inner edge of an E, between the top arm and the
 * middle one, has perpendicular neighbours pointing opposite ways just as a
 * real terminal does. It is told apart by which way the outline turns. A
 * terminal is convex, bulging away from the letter; that notch is concave,
 * cutting into it. Comparing the turn against the contour's own winding
 * settles it without reference to any measurement, so it holds at any size and
 * any weight.
 *
 * The slabs are laid over the letter rather than merged into it, which is how
 * a serif is drawn by hand and what the overlap removal on export already
 * expects.
 */

import { contourSegments, isClockwise, reverseContour, type Segment } from "./geometry";
import type { Contour, GlyphNode, Vec2 } from "./types";

export interface SlabOptions {
  /** How far the slab reaches past the stroke on each side, in font units. */
  projection: number;
  /** How far the slab reaches back along the stroke, in font units. */
  thickness: number;
  /**
   * Longest edge still treated as a stroke end, as a backstop. The length of an
   * edge relative to its neighbours does most of the work; this catches a wide
   * flat area whose neighbours happen to be longer still.
   */
  maxWidth: number;
}

/** A stroke end: where it is, how wide, and which way the stroke runs. */
export interface Terminal {
  /** Middle of the end edge. */
  centre: Vec2;
  /** Unit vector along the end edge. */
  along: Vec2;
  /** Unit vector pointing back into the stroke. */
  inward: Vec2;
  width: number;
  /** Which way the contour this end belongs to is wound. */
  clockwise: boolean;
}

function unit(from: Vec2, to: Vec2): { x: number; y: number; length: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: 0, length: 0 };
  return { x: dx / length, y: dy / length, length };
}

/** Direction a segment sets off in, treating a curve by its chord. */
function chord(segment: Segment): { x: number; y: number; length: number } {
  return unit(segment.from, segment.to);
}

/** How square two directions are: zero when perpendicular. */
const PERPENDICULAR_TOLERANCE = 0.26; // about 15 degrees
/** How opposed the two sides of a stroke have to be. */
const OPPOSITE_TOLERANCE = -0.9;
/** How much longer than its stroke an end may measure and still count. */
const END_SLACK = 1.25;

/**
 * Find the stroke ends of one outline.
 *
 * Only straight edges are considered. A stroke that tapers into a curve has no
 * flat end to sit a slab on, and guessing at one would put a bar across the
 * middle of a curve.
 */
export function findTerminals(contours: Contour[], maxWidth: number): Terminal[] {
  const terminals: Terminal[] = [];

  for (const contour of contours) {
    const segments = contourSegments(contour);
    if (segments.length < 3) continue;
    // Winding says which way a convex corner turns for this contour.
    const convexSign = isClockwise(contour) ? -1 : 1;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.kind !== "line") continue;

      const here = chord(segment);
      if (here.length === 0 || here.length > maxWidth) continue;

      const previous = chord(segments[(i - 1 + segments.length) % segments.length]);
      const next = chord(segments[(i + 1) % segments.length]);
      if (previous.length === 0 || next.length === 0) continue;

      // An end is shorter than the stroke running away from it. Without this a
      // plain rectangle offers four candidates rather than two: it is symmetric,
      // so nothing but relative length says which pair is the end and which is
      // the side. Comparing against the longer neighbour rather than both keeps
      // the top of an n's stem, where the arch springs away after only a short
      // run.
      //
      // The comparison is loose because it has to survive the other controls
      // moving things about. On a real letter an end is a fifth the length of
      // its stroke or less, so a little slack costs nothing -- but exactly at
      // the boundary it decided whether a slab existed. Raising t's crossbar
      // left 168 units of stem above it, just under the 185 the stem is wide,
      // and the slab on the ascender vanished while the others stayed.
      if (here.length > Math.max(previous.length, next.length) * END_SLACK) continue;

      // Both sides square to the end, and running opposite each other.
      if (Math.abs(here.x * previous.x + here.y * previous.y) > PERPENDICULAR_TOLERANCE) continue;
      if (Math.abs(here.x * next.x + here.y * next.y) > PERPENDICULAR_TOLERANCE) continue;
      if (previous.x * next.x + previous.y * next.y > OPPOSITE_TOLERANCE) continue;

      // Convex, so this is the end of a stroke rather than a notch cut into one.
      const turnIn = previous.x * here.y - previous.y * here.x;
      const turnOut = here.x * next.y - here.y * next.x;
      if (Math.sign(turnIn) !== convexSign || Math.sign(turnOut) !== convexSign) continue;

      // The stroke runs back the way the neighbouring edges point.
      const inward = {
        x: (previous.x * -1 + next.x) / 2,
        y: (previous.y * -1 + next.y) / 2,
      };
      const inwardLength = Math.hypot(inward.x, inward.y);
      if (inwardLength === 0) continue;

      terminals.push({
        centre: { x: (segment.from.x + segment.to.x) / 2, y: (segment.from.y + segment.to.y) / 2 },
        along: { x: here.x, y: here.y },
        inward: { x: inward.x / inwardLength, y: inward.y / inwardLength },
        width: here.length,
        clockwise: convexSign === -1,
      });
    }
  }

  return terminals;
}

/**
 * Lay a slab across every stroke end.
 *
 * The bars are returned alongside the original contours rather than merged
 * into them. Overlapping pieces are how a serif is drawn -- a bar laid over a
 * stem -- and the export already knows to fuse them; under the non-zero fill
 * that font rasterisers use, the overlap is invisible in the meantime.
 */
export function addSlabs(contours: Contour[], options: SlabOptions): Contour[] {
  const { projection, thickness, maxWidth } = options;
  if (projection <= 0 && thickness <= 0) return contours;

  const terminals = findTerminals(contours, maxWidth);
  if (terminals.length === 0) return contours;

  const slabs = terminals.map((terminal) => {
    const half = terminal.width / 2 + projection;
    const along = terminal.along;
    const inward = terminal.inward;

    // Start flush with the end of the stroke so the letter keeps its height,
    // and reach back into it.
    const corner = (side: number, depth: number): Vec2 => ({
      x: terminal.centre.x + along.x * half * side + inward.x * depth,
      y: terminal.centre.y + along.y * half * side + inward.y * depth,
    });

    const points = [corner(-1, 0), corner(1, 0), corner(1, thickness), corner(-1, thickness)];
    const nodes: GlyphNode[] = points.map((point) => ({
      point,
      handleIn: null,
      handleOut: null,
      type: "corner",
    }));
    const slab: Contour = { nodes, closed: true };

    /*
     * Wind the bar the same way as the letter it belongs to.
     *
     * Which way round a contour runs decides whether it is ink or a hole, and
     * emboldening reads it to know which way is outward. A bar wound against
     * the letter got thinner as weight was added: an I with serifs measured 382
     * units wide unweighted and 269 at weight 80, shrinking as it was asked to
     * grow. It went unseen while slabs were added after the weight, and
     * appeared the moment they were added before it.
     */
    return isClockwise(slab) === terminal.clockwise ? slab : reverseContour(slab);
  });

  return [...contours, ...slabs];
}
