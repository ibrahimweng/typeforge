/**
 * The shapes you drag rather than draw: a rectangle and an ellipse.
 *
 * Type is full of both. A stem is a rectangle, a bar is a rectangle, a dot on
 * an `i` is a circle, and the round terminal at the end of an `a` starts as
 * one. Drawing any of them with a pen means placing four points and eight
 * handles by hand, getting the handle length wrong, and then finding out at
 * export that the curve never quite reached its own extremes.
 *
 * Both shapes here are built the way a checker wants to find them: on whole
 * units, with a point at every place the outline reaches its furthest in any
 * direction, and wound the way the rest of the font is wound. That is not
 * tidiness. Those are three of the things the outline checks report, and a
 * tool that produced shapes failing its own checks would be a strange thing to
 * ship.
 */

import { rounded } from "./nodes";
import type { Contour, GlyphNode, Vec2 } from "./types";

/**
 * How long the handles on a circle have to be.
 *
 * Four cubic curves cannot be a circle exactly; this is the length, as a
 * fraction of the radius, that makes them wrong by about one part in two
 * thousand -- which at a thousand units to the em is half a unit at the worst
 * point of a full-height circle, and nothing at the size a dot on an `i` is
 * drawn. The number is the one every drawing program uses for the same reason.
 */
const KAPPA = 0.5522847498;

/** The smallest drag that counts as drawing something rather than clicking. */
export const SMALLEST_SHAPE = 2;

/** A box from two dragged corners, in font units, on whole units. */
export interface Box {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/**
 * The box a drag describes.
 *
 * `square` is what the shift key means in every drawing tool: the shorter side
 * is taken and the longer one cut down to it, growing away from the corner the
 * drag started at rather than about the middle, so the anchored corner stays
 * under the point it was put at. `fromCentre` is what alt means: the start is
 * the middle and the drag is the radius.
 */
export function boxOf(
  start: Vec2,
  end: Vec2,
  options: { square?: boolean; fromCentre?: boolean } = {},
): Box {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (options.square) {
    const side = Math.min(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx) * side;
    dy = Math.sign(dy) * side;
  }
  const [x0, y0, x1, y1] = options.fromCentre
    ? [start.x - dx, start.y - dy, start.x + dx, start.y + dy]
    : [start.x, start.y, start.x + dx, start.y + dy];
  return {
    xMin: Math.round(Math.min(x0, x1)),
    yMin: Math.round(Math.min(y0, y1)),
    xMax: Math.round(Math.max(x0, x1)),
    yMax: Math.round(Math.max(y0, y1)),
  };
}

/** Whether a box is big enough to be worth making a shape out of. */
export function worthDrawing(box: Box): boolean {
  return box.xMax - box.xMin >= SMALLEST_SHAPE && box.yMax - box.yMin >= SMALLEST_SHAPE;
}

const corner = (x: number, y: number): GlyphNode => ({
  point: { x, y },
  handleIn: null,
  handleOut: null,
  type: "corner",
});

/**
 * A rectangle, wound the way the font is wound.
 *
 * Written anticlockwise and reversed when asked, rather than written twice:
 * the two orders are the same four points and a version that listed them both
 * would be a place for them to disagree.
 */
export function rectangle(box: Box, clockwise: boolean): Contour {
  const nodes = [
    corner(box.xMin, box.yMin),
    corner(box.xMax, box.yMin),
    corner(box.xMax, box.yMax),
    corner(box.xMin, box.yMax),
  ];
  return { closed: true, nodes: clockwise ? nodes.reverse() : nodes };
}

/**
 * An ellipse in a box, as four curves between its own extremes.
 *
 * The four points sit at the top, bottom, left and right of the box rather
 * than at its corners, which is the whole reason to have this rather than a
 * rounded rectangle: those are exactly the four places the outline reaches its
 * furthest, and a curve with a point at each of them is one that needs nothing
 * adding at export and reports nothing in the checks.
 */
export function ellipse(box: Box, clockwise: boolean): Contour {
  const midX = (box.xMin + box.xMax) / 2;
  const midY = (box.yMin + box.yMax) / 2;
  const reachX = ((box.xMax - box.xMin) / 2) * KAPPA;
  const reachY = ((box.yMax - box.yMin) / 2) * KAPPA;

  const at = (x: number, y: number, hi: Vec2, ho: Vec2): GlyphNode => ({
    point: { x, y },
    handleIn: hi,
    handleOut: ho,
    // Smooth, because it is: the curve runs through each of these four points
    // without turning, and saying so is what keeps the handles opposite each
    // other when somebody drags one.
    type: "smooth",
  });

  const nodes = [
    at(
      box.xMax,
      midY,
      { x: box.xMax, y: midY - reachY },
      { x: box.xMax, y: midY + reachY },
    ),
    at(
      midX,
      box.yMax,
      { x: midX + reachX, y: box.yMax },
      { x: midX - reachX, y: box.yMax },
    ),
    at(
      box.xMin,
      midY,
      { x: box.xMin, y: midY + reachY },
      { x: box.xMin, y: midY - reachY },
    ),
    at(
      midX,
      box.yMin,
      { x: midX - reachX, y: box.yMin },
      { x: midX + reachX, y: box.yMin },
    ),
  ];

  /*
   * Reversed by turning the list round and swapping each node's handles,
   * because the handle arriving at a node is the one leaving it once the path
   * runs the other way. Rounded last: a box of odd width puts its middle on a
   * half unit, and the handles land on fractions of one.
   */
  const wound = clockwise
    ? nodes.reverse().map<GlyphNode>((node) => ({
        point: node.point,
        handleIn: node.handleOut,
        handleOut: node.handleIn,
        type: node.type,
      }))
    : nodes;
  return { closed: true, nodes: wound.map(rounded) };
}

/** Which shape a tool draws. */
export type ShapeKind = "rectangle" | "ellipse" | "polygon";

/**
 * How many sides a polygon gets unless told otherwise.
 *
 * Six, because the two a type designer actually reaches for are the triangle
 * and the hexagon, and of those the hexagon is the one that is tedious to
 * build by hand. Three is two clicks of the counter away.
 */
export const POLYGON_SIDES = 6;

/**
 * A regular polygon inscribed in the box, first vertex at the top.
 *
 * Corners all the way round with no handles: a polygon is the one shape here
 * whose whole character is that it does not curve, and giving it handles set
 * to its own points would leave a shape that looks right and behaves oddly the
 * first time somebody smooths a point on it.
 *
 * Fitted to the box rather than to a circle, so dragging a wide box gives a
 * wide hexagon. A polygon tool that only made regular ones would be a tool for
 * one shape.
 */
export function polygon(box: Box, clockwise: boolean, sides = POLYGON_SIDES): Contour {
  const count = Math.max(3, Math.round(sides));
  const midX = (box.xMin + box.xMax) / 2;
  const midY = (box.yMin + box.yMax) / 2;
  const reachX = (box.xMax - box.xMin) / 2;
  const reachY = (box.yMax - box.yMin) / 2;

  const nodes: GlyphNode[] = [];
  for (let at = 0; at < count; at++) {
    // From the top, going anticlockwise in font space, which is the winding
    // `rectangle` and `ellipse` both build in before the flip below.
    const angle = Math.PI / 2 + (at / count) * Math.PI * 2;
    nodes.push({
      point: { x: midX + Math.cos(angle) * reachX, y: midY + Math.sin(angle) * reachY },
      handleIn: null,
      handleOut: null,
      type: "corner",
    });
  }

  const wound = clockwise ? nodes.slice().reverse() : nodes;
  return { closed: true, nodes: wound.map(rounded) };
}

/** The contour a shape tool's drag produces, or null when it was a click. */
export function shapeFrom(
  kind: ShapeKind,
  box: Box,
  clockwise: boolean,
  sides = POLYGON_SIDES,
): Contour | null {
  if (!worthDrawing(box)) return null;
  if (kind === "rectangle") return rectangle(box, clockwise);
  if (kind === "polygon") return polygon(box, clockwise, sides);
  return ellipse(box, clockwise);
}
