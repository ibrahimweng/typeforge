/**
 * Turning a dragged line into an outline.
 *
 * A pencil is the one tool that produces more points than anybody wants. A
 * pointer reports every few milliseconds, so a stroke drawn across a letter in
 * a second arrives as two or three hundred positions, most of them a fraction
 * of a unit from the one before -- and a contour with three hundred nodes in it
 * is not a drawing, it is a recording of a hand.
 *
 * So there are two steps, and the order matters. First the trail is thinned:
 * points too close together to be decisions are dropped, because feeding them
 * to a curve fitter makes it work hard to reproduce the shake in somebody's
 * hand. Then what is left is fitted with cubics, by the same fitter the quill
 * engine uses to turn a swept stroke into an outline -- writing a second one
 * would be two fitters to keep honest and two sets of tolerances to argue
 * about.
 */

import { fitCubics } from "@/quill/curve";
import type { Contour, GlyphNode, Vec2 } from "./types";

/*
 * The two numbers this rests on.
 *
 * `APART` is how far two reported positions have to be before the second one
 * is worth keeping: three units at a thousand to the em, which is under a
 * third of a per cent of the letter and below anything a hand does on purpose.
 * Measured in font units rather than screen pixels on purpose -- at a high
 * zoom a hand's shake covers many pixels and no units at all, and it is the
 * units that end up in the file.
 *
 * `SLACK` is how far the fitted curve may sit from the thinned trail. Ten
 * units is about a hundredth of an em: close enough that the curve is the line
 * that was drawn, loose enough that it is drawn with a handful of nodes rather
 * than a hundred.
 */
const APART = 3;
const SLACK = 10;

/** The reported trail, with everything too close together to be a decision dropped. */
export function thinned(trail: Vec2[], apart: number = APART): Vec2[] {
  if (trail.length === 0) return [];
  const kept: Vec2[] = [trail[0]];
  for (const point of trail) {
    const last = kept[kept.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) >= apart) kept.push(point);
  }
  // The end of the stroke is where the hand stopped, and is a decision even
  // when it lands a fraction from the point before it.
  const end = trail[trail.length - 1];
  const last = kept[kept.length - 1];
  if (end !== last && (end.x !== last.x || end.y !== last.y)) kept.push(end);
  return kept;
}

/**
 * The contour a freehand stroke becomes, or null when it was a click.
 *
 * Closed when the stroke came back to where it started, which is how anybody
 * draws a bowl and how every drawing tool has read one since the first. The
 * reach is generous -- a hand coming back to a point it left a second ago
 * lands near it rather than on it -- and it has to be, because the alternative
 * is an `o` that is not a shape.
 */
export function strokeToContour(
  trail: Vec2[],
  options: { apart?: number; slack?: number; closeWithin?: number } = {},
): Contour | null {
  const points = thinned(trail, options.apart ?? APART);
  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const closeWithin = options.closeWithin ?? 30;
  const closed = points.length > 3 && Math.hypot(last.x - first.x, last.y - first.y) <= closeWithin;
  // A closed stroke ends exactly where it began rather than nearly: a contour
  // that closes across a gap of nine units has a nine-unit straight in it that
  // nobody drew.
  const run = closed ? [...points.slice(0, -1), first] : points;

  const { curves } = fitCubics(run, options.slack ?? SLACK);
  if (curves.length === 0) return null;

  /*
   * The curves become nodes, each carrying the handle arriving at it and the
   * one leaving it. Two curves meeting at a point give that point both, which
   * is what makes the result editable rather than a pile of separate arcs.
   */
  const nodes: GlyphNode[] = curves.map((curve, index) => ({
    point: { ...curve.from },
    handleIn: index === 0 ? null : { ...curves[index - 1].c2 },
    handleOut: { ...curve.c1 },
    type: "smooth",
  }));

  const tail = curves[curves.length - 1];
  if (closed) {
    // The last curve arrives back at the first node, so its far handle belongs
    // to that node rather than to a node of its own.
    nodes[0].handleIn = { ...tail.c2 };
  } else {
    nodes.push({
      point: { ...tail.to },
      handleIn: { ...tail.c2 },
      handleOut: null,
      type: "smooth",
    });
  }

  return { closed, nodes };
}
