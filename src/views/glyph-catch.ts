/**
 * Which points a selection gesture has hold of, asked once and answered once.
 *
 * The box and the lasso each used to work this out inside the pointer-up
 * handler, at the moment the button came up and nowhere else. That was fine
 * while nothing on screen claimed to know the answer early -- and it stops
 * being fine the moment the canvas lights points up *during* the drag, because
 * then there are two answers to the same question and no reason for them to
 * agree. A preview that disagrees with the result is worse than no preview:
 * it is a guide that lies.
 *
 * So the rule lives here, both callers ask it, and the picture on screen is
 * the selection that lands by construction rather than by coincidence.
 *
 * Everything is in canvas units, because that is what both gestures record and
 * what the eye is judging: a lasso is the ring somebody drew on the screen in
 * front of them, not a shape in font space that happens to look like it.
 */

import type { Contour, Vec2 } from "@/font/types";
import { nodeKey } from "@/state/useStore";
import type { GlyphView } from "@/components/glyph-render";
import { inside, toScreen, type Drag } from "./glyph-pointer";

/** The two gestures that pick points by drawing a shape round them. */
export type Catcher = Extract<Drag, { kind: "marquee" } | { kind: "lasso" }>;

/** Whether a drag is one of them, for the places that only care about that. */
export function catches(drag: Drag | null): drag is Catcher {
  return drag?.kind === "marquee" || drag?.kind === "lasso";
}

/**
 * The node keys the shape has hold of, as it stands.
 *
 * Nodes only, not handles: the box round a selection moves points, and a
 * handle caught without its point would be a selection the transform cannot
 * act on.
 */
export function caughtBy(shape: Catcher, contours: Contour[], view: GlyphView): Set<string> {
  const caught = new Set<string>();
  /*
   * The shape as one question to ask of a point, worked out once rather than
   * per node: a letter is two hundred points and this runs on every move.
   */
  const holds =
    shape.kind === "marquee"
      ? (() => {
          const left = Math.min(shape.from.x, shape.to.x);
          const right = Math.max(shape.from.x, shape.to.x);
          const top = Math.min(shape.from.y, shape.to.y);
          const bottom = Math.max(shape.from.y, shape.to.y);
          return (at: Vec2) => at.x >= left && at.x <= right && at.y >= top && at.y <= bottom;
        })()
      : (at: Vec2) => inside(shape.trail, at);

  contours.forEach((contour, contourIndex) => {
    contour.nodes.forEach((node, nodeIndex) => {
      if (holds(toScreen(view, node.point))) {
        caught.add(nodeKey({ contour: contourIndex, node: nodeIndex }));
      }
    });
  });
  return caught;
}

/**
 * What the drag has hold of, and when each point was taken.
 *
 * The times are what let a point flash as it is swept over. Kept per drag and
 * only for the points actually held, so a sweep across a letter of two hundred
 * points carries the handful under the shape rather than a stamp for each.
 *
 * A point let go of and caught again is caught again: its stamp is dropped
 * when it leaves, so sweeping back over it flashes a second time. That is the
 * honest reading -- the hand did take it twice.
 */
export interface Catching {
  keys: Set<string>;
  since: Map<string, number>;
}

/** The same question again, keeping the stamps of everything still held. */
export function keepCatching(
  was: Catching | null,
  shape: Catcher,
  contours: Contour[],
  view: GlyphView,
  now: number,
): Catching {
  const keys = caughtBy(shape, contours, view);
  const since = new Map<string, number>();
  for (const key of keys) since.set(key, was?.since.get(key) ?? now);
  return { keys, since };
}
