/**
 * Moving what is already drawn: mirror, scale, rotate, slant, align.
 *
 * These are the operations every drawing tool has and this one did not, and
 * they are here rather than in the store because none of them needs to know
 * anything about a document. A transform takes points and gives back points.
 *
 * Two decisions run through all of it.
 *
 * The first is that a handle is a point. This model keeps handles in absolute
 * coordinates rather than as offsets from the node they belong to, so every
 * transform applies to a node's point and to both of its handles in exactly
 * the same way -- and any that did not would rotate a curve's ends while
 * leaving its middle behind.
 *
 * The second is what each operation happens *about*. A rotation needs a
 * centre, a mirror needs an axis, and picking the wrong one is the difference
 * between an operation somebody meant and one that flings the letter off the
 * canvas. The centre is the middle of what is selected, because that is what
 * somebody watching the selection expects to stay still -- except for slant,
 * which is about the baseline, because slanting is how an italic is made and
 * an italic pivots on the line it stands on.
 */

import { contoursBounds, type Bounds } from "./geometry";
import type { Contour, GlyphNode, Vec2 } from "./types";

/** A 2x3 affine, in the same order the font formats write one. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  dx: number;
  dy: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 };

/** One point through a transform. */
export function apply(transform: Affine, point: Vec2): Vec2 {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.dx,
    y: transform.b * point.x + transform.d * point.y + transform.dy,
  };
}

/**
 * A transform, moved so it happens about a point rather than about the origin.
 *
 * Every operation below is written as though the letter sat on the origin,
 * because that is the form the arithmetic is simple in. This is what makes it
 * happen where somebody is looking instead.
 */
function about(transform: Affine, centre: Vec2): Affine {
  const moved = apply(transform, centre);
  return {
    ...transform,
    dx: transform.dx + centre.x - moved.x,
    dy: transform.dy + centre.y - moved.y,
  };
}

/** Flip across a vertical or horizontal line through a point. */
export function mirror(axis: "horizontal" | "vertical", centre: Vec2): Affine {
  // "Horizontal" is the direction the letter moves in, which is the flip most
  // people mean by it: left becomes right.
  const flip: Affine =
    axis === "horizontal"
      ? { a: -1, b: 0, c: 0, d: 1, dx: 0, dy: 0 }
      : { a: 1, b: 0, c: 0, d: -1, dx: 0, dy: 0 };
  return about(flip, centre);
}

/** Grow or shrink about a point, by a factor on each axis. */
export function scaled(x: number, y: number, centre: Vec2): Affine {
  return about({ a: x, b: 0, c: 0, d: y, dx: 0, dy: 0 }, centre);
}

/** Turn about a point, anticlockwise, in degrees. */
export function rotated(degrees: number, centre: Vec2): Affine {
  const turn = (degrees * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return about({ a: cos, b: sin, c: -sin, d: cos, dx: 0, dy: 0 }, centre);
}

/**
 * Lean the letter over, pivoting on a height rather than on a centre.
 *
 * The height is what makes this the operation type designers mean by it. A
 * shear about the middle of a letter leaves its top leaning one way and its
 * foot the other; an italic leans off the line it stands on, so its feet stay
 * where they were and everything above moves. The baseline is therefore the
 * default and the caller may name another -- an x-height pivot is how a
 * small-capital gets its slant without its feet wandering.
 */
export function slanted(degrees: number, pivotY = 0): Affine {
  const lean = Math.tan((degrees * Math.PI) / 180);
  return { a: 1, b: 0, c: lean, d: 1, dx: -lean * pivotY, dy: 0 };
}

/** One node through a transform, handles and all. */
export function transformNode(node: GlyphNode, transform: Affine): GlyphNode {
  return {
    point: apply(transform, node.point),
    handleIn: node.handleIn ? apply(transform, node.handleIn) : null,
    handleOut: node.handleOut ? apply(transform, node.handleOut) : null,
    type: node.type,
  };
}

/**
 * A transform over a whole set of contours.
 *
 * A mirror or a negative scale turns every contour inside out, which matters:
 * a contour's direction is what decides whether it fills or cuts a hole, so a
 * flipped letter whose windings were left alone comes back with its counters
 * solid. The order is reversed here rather than left for somebody to notice
 * later.
 */
export function transformContours(contours: Contour[], transform: Affine): Contour[] {
  const flips = transform.a * transform.d - transform.b * transform.c < 0;
  return contours.map((contour) => {
    const nodes = contour.nodes.map((node) => transformNode(node, transform));
    if (!flips) return { ...contour, nodes };
    /*
     * Reversed the same way `outline.ts` reverses: the handles swap sides
     * along with the order, because the handle that was arriving at a node is
     * the one leaving it once the path runs the other way.
     */
    const back = [...nodes].reverse().map<GlyphNode>((node) => ({
      point: node.point,
      handleIn: node.handleOut,
      handleOut: node.handleIn,
      type: node.type,
    }));
    return { ...contour, nodes: back };
  });
}

/** Which way a set of points is being pushed. */
export type Edge = "left" | "right" | "top" | "bottom" | "centreX" | "centreY";

/**
 * Line points up with each other.
 *
 * The target is taken from the points themselves rather than from the glyph:
 * aligning three points to the left means the leftmost of those three, not the
 * left side of the letter they are in. That is what makes it useful for
 * levelling the two feet of an `n` against each other.
 */
export function alignedTo(edge: Edge, bounds: Bounds): (point: Vec2) => Vec2 {
  switch (edge) {
    case "left":
      return (point) => ({ x: bounds.xMin, y: point.y });
    case "right":
      return (point) => ({ x: bounds.xMax, y: point.y });
    case "top":
      return (point) => ({ x: point.x, y: bounds.yMax });
    case "bottom":
      return (point) => ({ x: point.x, y: bounds.yMin });
    case "centreX": {
      const middle = (bounds.xMin + bounds.xMax) / 2;
      return (point) => ({ x: middle, y: point.y });
    }
    case "centreY": {
      const middle = (bounds.yMin + bounds.yMax) / 2;
      return (point) => ({ x: point.x, y: middle });
    }
  }
}

/**
 * The middle of a set of contours, which is what a transform happens about.
 *
 * Measured off the points and their handles rather than off the drawn shape.
 * A curve does not reach its own control points, so the two differ -- but the
 * points and handles are what somebody has selected and can see on screen,
 * and a rotation about a centre they cannot see is one they cannot predict.
 */
export function centreOf(contours: Contour[]): Vec2 {
  const box = boundsOfPoints(contours);
  return { x: (box.xMin + box.xMax) / 2, y: (box.yMin + box.yMax) / 2 };
}

/**
 * The box around every point and handle: the control box, not the ink.
 *
 * `contoursBounds` next door measures the drawn shape, which is what a letter
 * looks like. This measures what is on screen when the letter is selected,
 * which is what a transform is being applied to.
 */
export function boundsOfPoints(contours: Contour[]): Bounds {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  const see = (point: Vec2) => {
    xMin = Math.min(xMin, point.x);
    yMin = Math.min(yMin, point.y);
    xMax = Math.max(xMax, point.x);
    yMax = Math.max(yMax, point.y);
  };
  for (const contour of contours) {
    for (const node of contour.nodes) {
      see(node.point);
      // The handles too, which is what makes this the control box rather than
      // a box round the on-curve points. They are drawn when the node is
      // selected and they move with it, so they are part of what is in hand.
      if (node.handleIn) see(node.handleIn);
      if (node.handleOut) see(node.handleOut);
    }
  }
  if (!Number.isFinite(xMin)) return contoursBounds(contours);
  return { xMin, yMin, xMax, yMax };
}
