/**
 * The box round what is selected, and what each part of it does.
 *
 * Every drawing program puts a rectangle with handles round a selection, and
 * this one did not: what it had was a Transform panel of numbers and buttons
 * on the far right of the window. Numbers are better than dragging for saying
 * exactly forty degrees, and they are worse than dragging for everything else,
 * because the thing being rotated is on the canvas and the control was not.
 *
 * ## Where the handles are
 *
 * Eight round the edge -- four corners and four middles -- and a rotation zone
 * just outside each corner. The zone is outside rather than on the corner
 * because the corner already means scale, and a program that made you hold a
 * modifier to rotate would be asking you to learn something every other
 * program taught you not to need.
 *
 * ## Why this is in screen pixels
 *
 * The box is worked out in font units, because that is what the selection is
 * measured in and what the transform has to be applied in. The handles are hit
 * in screen pixels, because a handle is something a pointer has to land on and
 * a pointer is a fixed size whatever the zoom. A handle sized in font units
 * would be a postage stamp at 100% and cover the letter at 800%.
 */

import { toScreen } from "./glyph-pointer";
import type { Box, Quad } from "@/font/warp";
import type { GlyphView } from "@/components/glyph-render";
import type { Vec2 } from "@/font/types";

/** How near, in screen pixels, the pointer has to be to take a handle. */
export const HANDLE_REACH = 7;

/** How far outside a corner the rotation zone reaches, in screen pixels. */
export const TURN_REACH = 22;

/** The eight handles, named for where they are rather than for what they do. */
export type Corner = "bottomLeft" | "bottomRight" | "topRight" | "topLeft";
export type Edge = "bottom" | "right" | "top" | "left";

export type Grip =
  | { kind: "corner"; at: Corner }
  | { kind: "edge"; at: Edge }
  | { kind: "turn"; at: Corner }
  | { kind: "inside" };

/** Where each corner of a box is, in font units. */
export function cornersOf(box: Box): Record<Corner, Vec2> {
  return {
    bottomLeft: { x: box.left, y: box.bottom },
    bottomRight: { x: box.right, y: box.bottom },
    topRight: { x: box.right, y: box.top },
    topLeft: { x: box.left, y: box.top },
  };
}

/** Where each edge handle sits, which is the middle of that edge. */
export function edgesOf(box: Box): Record<Edge, Vec2> {
  const middleX = (box.left + box.right) / 2;
  const middleY = (box.bottom + box.top) / 2;
  return {
    bottom: { x: middleX, y: box.bottom },
    right: { x: box.right, y: middleY },
    top: { x: middleX, y: box.top },
    left: { x: box.left, y: middleY },
  };
}

/** The corner opposite a given one, which is what a scale holds still. */
export const oppositeOf: Record<Corner, Corner> = {
  bottomLeft: "topRight",
  bottomRight: "topLeft",
  topRight: "bottomLeft",
  topLeft: "bottomRight",
};

/**
 * What is under the pointer, or nothing.
 *
 * Corners are tested before edges, because at a small selection the two
 * overlap and the corner is the one somebody is aiming at: an edge handle can
 * always be reached by making the selection bigger, and a corner that answered
 * second would be unreachable at exactly the sizes where it is most wanted.
 *
 * The rotation zone is tested last of the three, so it never takes a press
 * meant for the corner it surrounds.
 */
export function gripAt(box: Box, view: GlyphView, canvasPoint: Vec2): Grip | null {
  const near = (at: Vec2, within: number): boolean => {
    const on = toScreen(view, at);
    return Math.hypot(on.x - canvasPoint.x, on.y - canvasPoint.y) <= within;
  };

  const corners = cornersOf(box);
  for (const at of Object.keys(corners) as Corner[]) {
    if (near(corners[at], HANDLE_REACH)) return { kind: "corner", at };
  }

  const edges = edgesOf(box);
  for (const at of Object.keys(edges) as Edge[]) {
    if (near(edges[at], HANDLE_REACH)) return { kind: "edge", at };
  }

  for (const at of Object.keys(corners) as Corner[]) {
    if (near(corners[at], TURN_REACH)) return { kind: "turn", at };
  }

  /*
   * Inside the box is a grip too, and it moves what is selected.
   *
   * Only when the box is worth having -- a selection of one point has a box of
   * no size, and treating the whole canvas as its inside would take every
   * press meant for a tool.
   */
  const on = { min: toScreen(view, corners.bottomLeft), max: toScreen(view, corners.topRight) };
  const withinX =
    canvasPoint.x >= Math.min(on.min.x, on.max.x) && canvasPoint.x <= Math.max(on.min.x, on.max.x);
  const withinY =
    canvasPoint.y >= Math.min(on.min.y, on.max.y) && canvasPoint.y <= Math.max(on.min.y, on.max.y);
  return withinX && withinY ? { kind: "inside" } : null;
}

/** Whether a box has enough size in it to be worth putting handles on. */
export function worthABox(box: Box, view: GlyphView): boolean {
  // Measured on screen rather than in font units, because what makes a box
  // usable is whether its handles are far enough apart for a pointer to tell
  // them apart -- which is a question about pixels.
  const wide = (box.right - box.left) * view.scale;
  const tall = (box.top - box.bottom) * view.scale;
  return Math.max(wide, tall) >= HANDLE_REACH * 3;
}

/** The box round a set of points, in font units. */
export function boxRound(points: readonly Vec2[]): Box | null {
  if (points.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    bottom = Math.min(bottom, point.y);
    top = Math.max(top, point.y);
  }
  return { left, right, bottom, top };
}

// ---------------------------------------------------------------------------
// What a drag on each handle does
// ---------------------------------------------------------------------------

/** What a scale drag works out to, before it is turned into a transform. */
export interface Scaling {
  x: number;
  y: number;
  about: Vec2;
}

/**
 * How far a handle has been pulled, as a pair of factors.
 *
 * About the opposite corner, so the side you are not holding stays where it
 * is. Alt scales about the middle instead, which is the other thing every
 * program does and the one you want when the shape is meant to stay centred.
 *
 * A factor is clamped away from nought rather than allowed through it. A
 * selection scaled to exactly nothing has no box left to grab, so the drag
 * that did it cannot be undone by dragging back -- and every point in it has
 * become the same point, which no amount of undo inside the gesture recovers.
 */
export function scalingFor(
  box: Box,
  at: Corner | Edge,
  to: Vec2,
  held: { fromCentre: boolean; square: boolean },
): Scaling {
  const corners = cornersOf(box);
  const middle = { x: (box.left + box.right) / 2, y: (box.bottom + box.top) / 2 };
  const isCorner = at in corners;
  const anchor = held.fromCentre
    ? middle
    : isCorner
      ? corners[oppositeOf[at as Corner]]
      : oppositeEdgePoint(box, at as Edge);

  const wide = box.right - box.left;
  const tall = box.top - box.bottom;
  const grabbed = isCorner ? corners[at as Corner] : edgesOf(box)[at as Edge];

  const wants = (from: number, now: number, anchorAt: number, span: number): number => {
    if (span === 0 || Math.abs(from - anchorAt) < 1e-9) return 1;
    return (now - anchorAt) / (from - anchorAt);
  };

  let x = 1;
  let y = 1;
  if (isCorner || at === "left" || at === "right") {
    x = wants(grabbed.x, to.x, anchor.x, wide);
  }
  if (isCorner || at === "top" || at === "bottom") {
    y = wants(grabbed.y, to.y, anchor.y, tall);
  }

  if (held.square && isCorner) {
    // The larger of the two, so holding shift grows to fit the pointer rather
    // than shrinking to it, which is what every program does.
    const both = Math.abs(x) > Math.abs(y) ? Math.abs(x) : Math.abs(y);
    x = both * Math.sign(x || 1);
    y = both * Math.sign(y || 1);
  }

  const keep = (factor: number): number =>
    Math.abs(factor) < 0.01 ? 0.01 * Math.sign(factor || 1) : factor;
  return { x: keep(x), y: keep(y), about: anchor };
}

/** The point a scale on an edge handle holds still: the middle of the far edge. */
function oppositeEdgePoint(box: Box, edge: Edge): Vec2 {
  const middleX = (box.left + box.right) / 2;
  const middleY = (box.bottom + box.top) / 2;
  switch (edge) {
    case "bottom":
      return { x: middleX, y: box.top };
    case "top":
      return { x: middleX, y: box.bottom };
    case "left":
      return { x: box.right, y: middleY };
    case "right":
      return { x: box.left, y: middleY };
  }
}

/** The angle a rotation drag has turned through, in degrees. */
export function turnFor(box: Box, from: Vec2, to: Vec2, held: { square: boolean }): number {
  const middle = { x: (box.left + box.right) / 2, y: (box.bottom + box.top) / 2 };
  const was = Math.atan2(from.y - middle.y, from.x - middle.x);
  const now = Math.atan2(to.y - middle.y, to.x - middle.x);
  const degrees = ((now - was) * 180) / Math.PI;
  // Fifteen degree steps under shift, which is the step every program uses and
  // the one that lands on the angles anybody actually asks for.
  return held.square ? Math.round(degrees / 15) * 15 : degrees;
}

/** The quad a corner drag makes, with the other three left where they were. */
export function quadPulled(box: Box, at: Corner, to: Vec2): Quad {
  return { ...cornersOf(box), [at]: to } as Quad;
}

/**
 * The quad a perspective drag makes.
 *
 * The corner goes where the pointer is and the one beside it on the same edge
 * moves the opposite way by the same amount, which is what keeps the shape a
 * trapezoid and is the whole difference between this and a free distort. Drag
 * the top right out and the top left goes out too: the top edge grows, the
 * bottom does not, and the shape lies back.
 */
export function quadForPerspective(box: Box, at: Corner, to: Vec2): Quad {
  const corners = cornersOf(box);
  const beside: Record<Corner, Corner> = {
    bottomLeft: "bottomRight",
    bottomRight: "bottomLeft",
    topRight: "topLeft",
    topLeft: "topRight",
  };
  const other = beside[at];
  const shift = { x: to.x - corners[at].x, y: to.y - corners[at].y };
  return {
    ...corners,
    [at]: to,
    [other]: { x: corners[other].x - shift.x, y: corners[other].y + shift.y },
  } as Quad;
}
