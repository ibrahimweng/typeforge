/**
 * What is under the pointer, and what the pointer is doing.
 *
 * Two kinds of thing, and they belong together: the hit tests that answer
 * "what would this press grab", and the `Hover` and `Drag` shapes that say
 * what the answer turned into. Nothing here draws and nothing here edits, so
 * nothing here needs either of those files.
 *
 * It was the bottom of a two thousand eight hundred line view. It is the one
 * part of that file with no dependencies of its own.
 */

import type { ShapeKind } from "@/font/shapes";
import type { Lines } from "@/font/snap";
import type { Anchor, Contour, Glyph, Vec2 } from "@/font/types";
import { slice } from "@/font/knife";
import { segmentAt } from "@/font/pen";
import { toFontX, toFontY, type GlyphView } from "@/components/glyph-render";
import { nodeKey, store, type NodeRef } from "@/state/useStore";
import type { PenHandle } from "./write-canvas";

/** How close a click has to land, in screen pixels, to grab a node. */
export const HIT_RADIUS = 7;

/**
 * How near the first point a click has to land to close the outline.
 *
 * Twice the radius a node answers to, and deliberately. Closing was on the
 * ordinary seven pixels, which is a fine target for "grab this exact point"
 * and a poor one for "finish". The difference is that closing is an intention
 * already declared -- there is one open outline and one point that closes it,
 * and no other point within reach means anything -- so the cost of being
 * generous is nothing and the cost of being strict is a stray point every time
 * a hand is a few pixels out. Missing it silently added a point instead, which
 * is how an attempt at a triangle becomes a four-point blob.
 */
export const CLOSING_RADIUS = 14;

/**
 * What the pointer is currently over.
 *
 * Resolved with the same tests, in the same order, that decide what a click
 * grabs. If the two ever disagreed the highlight would be a lie: it would show
 * one target and hand you another.
 */
export type Hover =
  | { kind: "anchor"; name: string }
  | { kind: "handle"; ref: NodeRef; side: "in" | "out" }
  | { kind: "node"; ref: NodeRef }
  | null;

export function hoverKey(hover: Hover): string {
  if (!hover) return "";
  if (hover.kind === "anchor") return `anchor:${hover.name}`;
  if (hover.kind === "handle") return `handle:${nodeKey(hover.ref)}:${hover.side}`;
  return `node:${nodeKey(hover.ref)}`;
}

export type Drag =
  /*
   * `anchor` is the node actually under the pointer, and `lines` is what it
   * can land on. Both are worked out once when the drag starts rather than on
   * every move: nothing else in the letter moves while a drag is running, so
   * recomputing the lines sixty times a second would be the same answer sixty
   * times.
   */
  | { kind: "node"; refs: NodeRef[]; anchor: NodeRef; lines: Lines; start: Vec2; before: Glyph }
  | { kind: "handle"; ref: NodeRef; side: "in" | "out"; lines: Lines; before: Glyph }
  | { kind: "marquee"; from: Vec2; to: Vec2; additive: boolean }
  | { kind: "anchor"; name: string; before: Anchor[] }
  | { kind: "pan"; from: Vec2; startPan: Vec2 }
  | { kind: "guide"; index: number }
  /*
   * The two that draw rather than move. Both hold canvas coordinates and
   * neither touches the letter until the pointer comes up: a shape half
   * dragged is not a shape, and a knife stroke that has not been let go of is
   * not a cut. Everything they show in the meantime is drawn over the canvas
   * and belongs to nothing.
   */
  | { kind: "shape"; kind2: ShapeKind; from: Vec2; to: Vec2 }
  | { kind: "knife"; from: Vec2; to: Vec2 }
  /*
   * The pencil keeps its trail in *font* units rather than canvas ones, so a
   * stroke that was panned or zoomed halfway through is still the stroke that
   * was drawn. Thinning it is `freehand.ts`'s business, not this one's: what
   * is recorded here is everything the pointer said.
   */
  | { kind: "freehand"; trail: Vec2[] }
  /*
   * The lasso's ring, in canvas units.
   *
   * A box cannot pick the points on one side of a curve without taking the
   * other side too, and on a letter drawn at two hundred points that is the
   * usual case rather than the awkward one.
   */
  | { kind: "lasso"; trail: Vec2[]; additive: boolean }
  /*
   * Writing: the same three gestures the outline tools have, pointed at a
   * spine instead of a contour. `pen` takes hold of the pen itself, which is
   * the one gesture with no outline equivalent -- the ellipse is dragged by
   * its axis ends, and pulling one out widens the pen while pulling it
   * sideways turns it.
   */
  | { kind: "writePull"; from: Vec2; stroke: number; node: number; before: Glyph }
  | { kind: "penHandle"; handle: PenHandle; before: Glyph }
  | { kind: "strokePoint"; stroke: number; node: number; before: Glyph }
  | { kind: "writeTrail"; trail: Vec2[] }
  /*
   * The pen, mid-gesture: a point has been put down and the pointer is pulling
   * its handles out of it. `from` is where it was pressed, in canvas units, so
   * the drag can tell a click from a pull before it commits to either.
   */
  | {
      kind: "pen";
      from: Vec2;
      contour: number;
      node: number;
      keepIn: Vec2 | null;
      pulled: boolean;
      before: Glyph;
    };

export const toScreen = (view: GlyphView, point: Vec2): Vec2 => ({
  x: view.originX + point.x * view.scale,
  y: view.originY - point.y * view.scale,
});

/**
 * Which guide, if any, is under a given height on the canvas.
 *
 * Four pixels either side, which is deliberately tighter than the band a node
 * answers to: a guide runs the whole width of the canvas, so a generous band
 * would take clicks meant for a point anywhere along it. Searched from the last
 * one back, so the guide drawn on top is the one that answers.
 */
export function guideAt(
  guides: ReadonlyArray<{ axis: "x" | "y"; at: number }>,
  view: GlyphView,
  canvasPoint: Vec2,
): number | null {
  // Backwards, so the one drawn last is the one caught first -- which is the
  // one on top, and the one somebody just put there.
  for (let index = guides.length - 1; index >= 0; index--) {
    const guide = guides[index];
    const where =
      guide.axis === "y"
        ? Math.abs(view.originY - guide.at * view.scale - canvasPoint.y)
        : Math.abs(view.originX + guide.at * view.scale - canvasPoint.x);
    if (where <= 4) return index;
  }
  return null;
}

// --- drawing ------------------------------------------------------------

/**
 * The outline the pen is part way through, if there is one.
 *
 * The last contour, and only while it is still open: `addPoint` appends to that
 * one and starts a new one when it is closed, so this is the same contour the
 * next click would extend.
 */
export function openOutline(glyph: Glyph): Contour | null {
  /*
   * Being drawn, not merely open.
   *
   * This used to ask only whether the last contour was closed, which is a fact
   * about the shape rather than about what the hand is doing. An outline
   * finished and left open is a legitimate thing to have, and with one test for
   * both a pen click anywhere on the canvas reached back and extended it: ten
   * abandoned attempts joined into one contour wandering across the letter,
   * whose first point was then so far from its last that the closing ring could
   * never be found.
   */
  if (!store.getSnapshot().drawing) return null;
  const last = glyph.contours[glyph.contours.length - 1];
  return last && !last.closed && last.nodes.length > 0 ? last : null;
}

/**
 * The point under the pointer, if a point is.
 *
 * First rather than nearest, and unlike `segmentUnder` that is the right
 * answer: two nodes within seven pixels of each other are two nodes drawn on
 * top of one another, and picking between them by a distance nobody can see
 * would make which one you got depend on the last decimal place.
 */
export function hitTestNode(glyph: Glyph, view: GlyphView, canvasPoint: Vec2): NodeRef | null {
  for (let contourIndex = 0; contourIndex < glyph.contours.length; contourIndex++) {
    const contour = glyph.contours[contourIndex];
    for (let nodeIndex = 0; nodeIndex < contour.nodes.length; nodeIndex++) {
      const screen = toScreen(view, contour.nodes[nodeIndex].point);
      if (Math.hypot(screen.x - canvasPoint.x, screen.y - canvasPoint.y) <= HIT_RADIUS) {
        return { contour: contourIndex, node: nodeIndex };
      }
    }
  }
  return null;
}

export function hitTestHandle(
  glyph: Glyph,
  view: GlyphView,
  canvasPoint: Vec2,
): { ref: NodeRef; side: "in" | "out" } | null {
  for (let contourIndex = 0; contourIndex < glyph.contours.length; contourIndex++) {
    const contour = glyph.contours[contourIndex];
    for (let nodeIndex = 0; nodeIndex < contour.nodes.length; nodeIndex++) {
      const node = contour.nodes[nodeIndex];
      for (const side of ["out", "in"] as const) {
        const handle = side === "out" ? node.handleOut : node.handleIn;
        if (!handle) continue;
        const screen = toScreen(view, handle);
        if (Math.hypot(screen.x - canvasPoint.x, screen.y - canvasPoint.y) <= HIT_RADIUS) {
          return { ref: { contour: contourIndex, node: nodeIndex }, side };
        }
      }
    }
  }
  return null;
}

export function hitTestAnchor(glyph: Glyph, view: GlyphView, canvasPoint: Vec2): string | null {
  for (const anchor of glyph.anchors) {
    const screen = toScreen(view, { x: anchor.x, y: anchor.y });
    if (Math.hypot(screen.x - canvasPoint.x, screen.y - canvasPoint.y) <= HIT_RADIUS + 2) {
      return anchor.name;
    }
  }
  return null;
}

/**
 * Whether the pointer is on the point that would close the open outline.
 *
 * Under three points there is nothing to close: two points closed is a line
 * drawn twice, with no area to fill.
 */
export function onClosingPoint(glyph: Glyph, view: GlyphView, canvasPoint: Vec2): boolean {
  const open = openOutline(glyph);
  if (!open || open.nodes.length < 3) return false;
  const first = open.nodes[0].point;
  const dx = canvasPoint.x - (view.originX + first.x * view.scale);
  const dy = canvasPoint.y - (view.originY - first.y * view.scale);
  return Math.hypot(dx, dy) <= CLOSING_RADIUS;
}

/**
 * Whether the pointer is on the point the pen last placed, and that point has
 * a handle to take off.
 *
 * Clicking it is how every editor says "the curve ends here": the handle that
 * was pulled stays on the segment arriving and the one leaving goes, so the
 * next click draws a straight line out of a curve.
 *
 * The handle check is the whole of the difference from a plain node hit. A
 * click here retracts the outgoing handle so the next segment leaves straight;
 * on a point that has no handle there is nothing to retract, and reporting it
 * as a thing about to happen puts `Click again to end the curve` over a click
 * that would do nothing at all.
 */
export function onLastPoint(glyph: Glyph, view: GlyphView, canvasPoint: Vec2): boolean {
  const open = openOutline(glyph);
  if (!open || open.nodes.length < 2) return false;
  const last = open.nodes[open.nodes.length - 1];
  if (!last.handleOut) return false;
  const screen = toScreen(view, last.point);
  return Math.hypot(screen.x - canvasPoint.x, screen.y - canvasPoint.y) <= HIT_RADIUS;
}

/**
 * Which contour and segment the pointer is over, across the whole letter.
 *
 * `segmentAt` answers for one contour; a letter is several, so this asks each
 * and keeps the nearest.
 *
 * The nearest, and it used to be the first. `segmentAt` is careful within a
 * contour -- sixty samples a segment, keeping the closest -- and that care was
 * thrown away at the door: the first contour with anything at all in reach
 * answered, and every contour after it went unasked. Contours overlap all the
 * time while a letter is being built, an oval laid over a stem before they are
 * merged being the ordinary case, and the reach is `HIT_RADIUS` divided by the
 * scale, so the further out the view is zoomed the more of the letter is inside
 * it. Pointing at the nearer of two edges and having the other one answer put
 * the point on the wrong contour, and the scissors through it.
 */
export function segmentUnder(
  glyph: Glyph,
  view: GlyphView,
  canvasPoint: Vec2,
): { contour: number; index: number; t: number } | null {
  const at = { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) };
  const within = HIT_RADIUS / view.scale;
  let best: { contour: number; index: number; t: number; distance: number } | null = null;
  for (const [contour, one] of glyph.contours.entries()) {
    const found = segmentAt(one, at, within);
    // Strictly nearer, so a tie goes to the contour drawn first -- which is the
    // one underneath, and the one the old answer would have given.
    if (found && (!best || found.distance < best.distance)) best = { contour, ...found };
  }
  return best && { contour: best.contour, index: best.index, t: best.t };
}

/**
 * Whether the line as drawn would actually cut anything.
 *
 * Asked of `slice` itself rather than guessed at, so what the cursor promises
 * and what letting go does are decided by one piece of code. A knife drawn
 * short, or down beside a stem rather than across it, does nothing at all --
 * and did it silently, so the only way to find out was to let go and watch
 * nothing happen.
 *
 * Cheap enough to ask on every move: it walks one glyph's contours looking for
 * crossings, and it only runs while the knife is actually being dragged.
 */
export function knifeWouldCut(
  glyph: Glyph | null,
  view: GlyphView,
  drag: { from: Vec2; to: Vec2 },
): boolean {
  if (!glyph) return false;
  const from = { x: toFontX(view, drag.from.x), y: toFontY(view, drag.from.y) };
  const to = { x: toFontX(view, drag.to.x), y: toFontY(view, drag.to.y) };
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1) return false;
  return slice(glyph.contours, from, to) !== null;
}

export function parseNodeKey(key: string): NodeRef {
  const [contour, node] = key.split(":");
  return { contour: Number(contour), node: Number(node) };
}

/**
 * Whether a point falls inside a drawn ring.
 *
 * A ray cast to the right, counting crossings: odd is in. The ring is whatever
 * the hand drew and need not be convex or even tidy -- a lasso that only
 * worked on well-behaved rings would be a rectangle with extra steps.
 */
export function inside(ring: Vec2[], point: Vec2): boolean {
  let within = false;
  for (let at = 0, before = ring.length - 1; at < ring.length; before = at++) {
    const a = ring[at];
    const b = ring[before];
    // The half-open rule on y: a vertex exactly level with the ray counts for
    // the edge below it and not the one above, so a ray through a vertex is
    // counted once rather than twice or not at all.
    if (a.y > point.y !== b.y > point.y) {
      const crossing = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (point.x < crossing) within = !within;
    }
  }
  return within;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
