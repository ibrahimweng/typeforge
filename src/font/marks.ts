/**
 * The things a drawing gets wrong that nobody sees by looking at it.
 *
 * Two of these are in the validation report already, as counts on a list you
 * have to go and read. A count is the wrong shape for this kind of fault: "3
 * missing extremes" tells a designer that something is wrong somewhere in a
 * letter, which is most of the way to being no help at all. What is wanted is
 * a ring round the place, on the canvas, while the letter is being drawn.
 *
 * So this module answers in positions rather than numbers, and the editor draws
 * them. The report keeps its counts -- they are the right shape for a list of
 * every glyph in the font -- and both read from the same reasoning.
 */

import { cubicAt, cubicExtremeTs, distance } from "@/font/geometry";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";

/**
 * Where a curve turns without a point on it.
 *
 * The rule every type-design course opens with: put a point at the top, bottom,
 * left and right of every curve. It is not decoration -- the hinting and the
 * rasteriser both work from the extremes, and a curve whose widest place has no
 * point on it renders differently from one that does, worse at small sizes.
 *
 * Reported as the point on the curve itself rather than the segment, because
 * the answer to "where" is a place on the drawing, and the editor can put a
 * ring exactly there and offer to add it.
 */
export function extremesMissing(contours: Contour[]): Vec2[] {
  const out: Vec2[] = [];
  for (const contour of contours) {
    const { nodes, closed } = contour;
    if (nodes.length < 2) continue;
    /*
     * Nothing to say about a shape that is not finished.
     *
     * An open contour is half a drawing, and half a drawing is missing most of
     * its extremes by definition -- so turning the marks on part way through
     * covered the letter in rings that all said the same thing: "you have not
     * finished". That is noise, and noise is worse than silence here, because
     * a person who learns to ignore the rings stops seeing the real ones.
     */
    if (!closed) continue;
    const last = closed ? nodes.length : nodes.length - 1;
    for (let at = 0; at < last; at++) {
      const a = nodes[at];
      const b = nodes[(at + 1) % nodes.length];
      if (!a.handleOut && !b.handleIn) continue;
      const c1 = a.handleOut ?? a.point;
      const c2 = b.handleIn ?? b.point;
      for (const t of cubicExtremeTs(a.point, c1, c2, b.point)) {
        // Ends coincide with a node that already exists.
        if (t <= 1e-4 || t >= 1 - 1e-4) continue;
        out.push(cubicAt(a.point, c1, c2, b.point, t));
      }
    }
  }
  return out;
}

/**
 * How far off straight a pair of handles may be before it counts as meant.
 *
 * Three degrees, which is chosen from what the fault actually is. A corner a
 * designer drew on purpose -- a stem meeting a serif, the join in a `v` -- is
 * tens of degrees off straight. A corner nobody meant is one that was smooth
 * and got nudged, and lands a degree or two out: too little to see at editing
 * size, plenty to catch the light along an edge at reading size. Above three
 * degrees the odds tip towards deliberate and a mark would be nagging.
 */
export const NEARLY_STRAIGHT = 3;

/**
 * Points that are a hair from smooth without being smooth.
 *
 * The kink that gets shipped. A curve that runs through a point smoothly has
 * its two handles opposite each other; a point that is two degrees off looks
 * identical on screen at any zoom a person draws at, and puts a visible flat
 * spot on the edge of a letter at text sizes. Nothing in the file marks it, and
 * a designer cannot find it by looking -- which is exactly the case for having
 * the editor point at it.
 *
 * Only points with two handles can be nearly-smooth: with one or none there is
 * no angle to be a hair off.
 */
export function nearlySmooth(
  contours: Contour[],
  within = NEARLY_STRAIGHT,
): { contour: number; node: number; point: Vec2; degrees: number }[] {
  const out: { contour: number; node: number; point: Vec2; degrees: number }[] = [];
  contours.forEach((contour, at) => {
    // Finished shapes only, for the reason above: a kink in a drawing still
    // being made is not yet a fault, it is a point that has not been placed.
    if (!contour.closed) return;
    contour.nodes.forEach((node, index) => {
      const off = offSmooth(node);
      if (off !== null && off > 1e-6 && off <= within) {
        out.push({ contour: at, node: index, point: node.point, degrees: off });
      }
    });
  });
  return out;
}

/**
 * How many degrees a point is from having its handles in line, or null if the
 * question does not apply.
 *
 * Zero means truly smooth, 180 would mean the handles point the same way. A
 * node typed `smooth` can still be off: the type is a label the file carries
 * and nothing keeps it honest once a handle is dragged, so the geometry is
 * asked rather than the label.
 */
export function offSmooth(node: GlyphNode): number | null {
  const { point, handleIn, handleOut } = node;
  if (!handleIn || !handleOut) return null;
  const inLength = distance(point, handleIn);
  const outLength = distance(point, handleOut);
  if (inLength < 1e-9 || outLength < 1e-9) return null;

  // The arriving handle points back at the point; the leaving one points away.
  // Smooth means those two directions are the same.
  const arriving = { x: (point.x - handleIn.x) / inLength, y: (point.y - handleIn.y) / inLength };
  const leaving = {
    x: (handleOut.x - point.x) / outLength,
    y: (handleOut.y - point.y) / outLength,
  };
  const dot = Math.max(-1, Math.min(1, arriving.x * leaving.x + arriving.y * leaving.y));
  return (Math.acos(dot) * 180) / Math.PI;
}
