/**
 * The operations that act on one or two points rather than on a whole path.
 *
 * `reshape.ts` next door moves things: a transform applies the same movement
 * to everything it touches. These change what a point *is* -- whether a curve
 * runs smoothly through it, whether it is on the grid, whether it needs to be
 * there at all -- and each of them therefore has to look at the points either
 * side to know what to do.
 *
 * The list is what Glyphs puts under its Path menu, because somebody arriving
 * from there has these in their fingers and there is nothing to be gained by
 * inventing different names for the same handful of things.
 *
 * What is not here is anything that guesses. Every operation below is
 * reversible in the sense that matters -- you can see what it did and undo it
 * -- and none of them redraws a letter in a way its designer would have to go
 * back and check. `tidy` is the one with any judgement in it at all, and the
 * two numbers that judgement rests on are argued for where they are declared.
 */

import { distance } from "./geometry";
import type { Contour, GlyphNode, NodeType, Vec2 } from "./types";

/**
 * Put a point and its handles on whole units.
 *
 * A font is drawn on a grid of units per em, and a coordinate between two of
 * them is a coordinate the exported file has to round anyway. Doing it here
 * rather than at export means the drawing on screen is the drawing that
 * ships -- and means two points that were a thousandth of a unit apart, which
 * no one can see and every checker reports, become the same point.
 */
export function rounded(node: GlyphNode): GlyphNode {
  const snap = (point: Vec2): Vec2 => ({ x: Math.round(point.x), y: Math.round(point.y) });
  return {
    point: snap(node.point),
    handleIn: node.handleIn ? snap(node.handleIn) : null,
    handleOut: node.handleOut ? snap(node.handleOut) : null,
    type: node.type,
  };
}

/**
 * Whether a point and its handles are already on whole units.
 *
 * For saying "there is nothing to round here" rather than pushing an edit that
 * changes nothing. A button that marks a font as modified without altering it
 * is a button that makes the unsaved-changes warning lie, and the warning is
 * only worth having if it is true.
 */
export function isOnGrid(node: GlyphNode): boolean {
  const whole = (point: Vec2 | null): boolean =>
    point === null || (Number.isInteger(point.x) && Number.isInteger(point.y));
  return whole(node.point) && whole(node.handleIn) && whole(node.handleOut);
}

/**
 * Make a curve run smoothly through a point, or let it turn.
 *
 * Smoothing is not a label: it moves the handles so the curve really is
 * smooth. The two have to be opposite each other through the point, and the
 * one that moves is the shorter of the two -- so a long, considered handle
 * stays where the designer put it and the stub opposite swings into line with
 * it. Moving the longer one instead would take the bigger of two decisions and
 * throw it away.
 *
 * A node with only one handle cannot be made smooth by moving anything, since
 * there is nothing on the other side to line up with; it is left alone and
 * reported as the tangent it is.
 */
export function smoothed(node: GlyphNode): GlyphNode {
  const { handleIn, handleOut, point } = node;
  if (!handleIn || !handleOut) return { ...node, type: handleIn || handleOut ? "tangent" : "corner" };

  const inLength = distance(point, handleIn);
  const outLength = distance(point, handleOut);
  if (inLength < 1e-9 || outLength < 1e-9) return { ...node, type: "corner" };

  // The longer handle sets the direction; the shorter swings round to face it.
  const keepIn = inLength >= outLength;
  const anchor = keepIn ? handleIn : handleOut;
  const span = distance(point, anchor);
  const away = { x: (point.x - anchor.x) / span, y: (point.y - anchor.y) / span };
  const reach = keepIn ? outLength : inLength;
  const moved = { x: point.x + away.x * reach, y: point.y + away.y * reach };

  return {
    point,
    handleIn: keepIn ? handleIn : moved,
    handleOut: keepIn ? moved : handleOut,
    type: "smooth",
  };
}

/** Let a curve turn at a point again, without moving anything. */
export function cornered(node: GlyphNode): GlyphNode {
  return { ...node, type: "corner" };
}

/*
 * The two numbers `tidy` rests on, and what each is for.
 *
 * A point within half a unit of another is the same point: a font is drawn on
 * whole units, so anything under one of them is below the resolution the
 * format can even express. This is deliberately not a "close enough" figure
 * that would merge points somebody put a unit apart on purpose -- a unit apart
 * is a decision, and half a unit is a rounding error.
 *
 * A handle within a fiftieth of a degree of horizontal or vertical was meant
 * to be horizontal or vertical. Both outline formats want a point where a
 * curve turns, and a stem that is a hundredth of a degree off vertical is a
 * stem that will be reported by every checker and rendered with a hint that
 * cannot help it. The tolerance is small on purpose: a genuinely angled handle
 * is angled by degrees, not by hundredths of one.
 */
const SAME_POINT = 0.5;
const STRAIGHT_ENOUGH = Math.tan((0.02 * Math.PI) / 180);

/** Whether two points are, for a font's purposes, the same point. */
function samePlace(one: Vec2, other: Vec2): boolean {
  return distance(one, other) < SAME_POINT;
}

/**
 * What a node's handles say its type is, without moving either of them.
 *
 * `smoothed` above makes a node smooth by moving a handle. This only reads:
 * it is for the places where a node has been assembled out of two others and
 * needs a type that matches the handles it has ended up with, rather than one
 * inherited from a node that no longer exists.
 */
function typeFor(node: GlyphNode): NodeType {
  const { handleIn, handleOut, point } = node;
  if (!handleIn && !handleOut) return "corner";
  if (!handleIn || !handleOut) return "tangent";
  const inSpan = distance(point, handleIn);
  const outSpan = distance(point, handleOut);
  if (inSpan < 1e-9 || outSpan < 1e-9) return "corner";
  // Opposite each other through the point: the cross product of the two
  // directions is zero and they point opposite ways.
  const ax = (point.x - handleIn.x) / inSpan;
  const ay = (point.y - handleIn.y) / inSpan;
  const bx = (handleOut.x - point.x) / outSpan;
  const by = (handleOut.y - point.y) / outSpan;
  return Math.abs(ax * by - ay * bx) < STRAIGHT_ENOUGH && ax * bx + ay * by > 0
    ? "smooth"
    : "corner";
}

/**
 * A handle that was nearly upright, stood up.
 *
 * Snapped rather than reported, because there is exactly one thing anybody
 * wants done about a handle a hundredth of a degree off vertical. Which axis
 * it is closest to decides which coordinate is copied from the node.
 */
function straightened(point: Vec2, handle: Vec2): Vec2 {
  const dx = handle.x - point.x;
  const dy = handle.y - point.y;
  if (dx !== 0 && Math.abs(dy / dx) < STRAIGHT_ENOUGH) return { x: handle.x, y: point.y };
  if (dy !== 0 && Math.abs(dx / dy) < STRAIGHT_ENOUGH) return { x: point.x, y: handle.y };
  return handle;
}

/**
 * Take out what should not be there and straighten what nearly is.
 *
 * Three things, in the order that makes each safe for the next. Duplicate
 * points go first, because a point sitting on its neighbour makes every
 * question about direction meaningless. Then the on-curve points that sit in
 * the middle of a straight run and do nothing -- a point added by a stray
 * click, which every checker reports and nobody can see. Then the handles that
 * were nearly upright.
 *
 * Nothing here loses a handle. Two points in the same place are merged rather
 * than dropped, so the handle on the far side of the pair survives on the one
 * point that is left; and a point in a straight run is removed only when it
 * carries no handle and neither of its neighbours reaches towards it. A handle
 * is a statement about the curve either side of it, and a point that has one
 * is a point somebody put there.
 */
export function tidy(contour: Contour): Contour {
  let nodes = contour.nodes;
  if (nodes.length === 0) return contour;

  /*
   * Duplicates. Two nodes in the same place with no handle on the segment
   * between them are one node written twice: that segment has no length and
   * no shape. The survivor keeps the handle arriving at the first and the
   * handle leaving the second, which is every handle the pair had, and takes
   * a type read off those handles rather than from either original -- neither
   * node's own type described a pair that did not exist until now.
   */
  const merge = (first: GlyphNode, second: GlyphNode): GlyphNode => {
    const joined: GlyphNode = {
      point: first.point,
      handleIn: first.handleIn,
      handleOut: second.handleOut,
      type: "corner",
    };
    return { ...joined, type: typeFor(joined) };
  };

  const kept: GlyphNode[] = [];
  for (const node of nodes) {
    const previous = kept[kept.length - 1];
    if (previous && samePlace(previous.point, node.point) && !previous.handleOut && !node.handleIn) {
      kept[kept.length - 1] = merge(previous, node);
      continue;
    }
    kept.push(node);
  }
  // The wrap, which is the commonest way a closed path gets a duplicate: a
  // last point sitting on the first, left behind by a pen that closed the path
  // by clicking the start rather than by closing it.
  if (contour.closed && kept.length > 1) {
    const last = kept[kept.length - 1];
    if (samePlace(kept[0].point, last.point) && !last.handleOut && !kept[0].handleIn) {
      kept.pop();
      // The path now arrives at the first point along the handle that used to
      // arrive at the last one, which is the same segment.
      const rejoined: GlyphNode = { ...kept[0], handleIn: last.handleIn };
      kept[0] = { ...rejoined, type: typeFor(rejoined) };
    }
  }
  nodes = kept;

  // Points that sit on the straight line between their neighbours and carry no
  // handles of their own. A point that carries one is left alone.
  const count = nodes.length;
  const needed = nodes.filter((node, index) => {
    if (node.handleIn || node.handleOut) return true;
    if (!contour.closed && (index === 0 || index === count - 1)) return true;
    const before = nodes[(index - 1 + count) % count];
    const after = nodes[(index + 1) % count];
    if (before.handleOut || after.handleIn) return true;
    // Twice the area of the triangle the three make: zero when they are in a
    // line. Divided by the length between the outer two, so the test is a
    // distance from the line rather than an area and does not grow stricter as
    // the segment gets shorter.
    const cross =
      (after.point.x - before.point.x) * (node.point.y - before.point.y) -
      (after.point.y - before.point.y) * (node.point.x - before.point.x);
    const span = distance(before.point, after.point);
    return span < 1e-9 || Math.abs(cross) / span >= SAME_POINT;
  });
  nodes = needed.length >= 2 ? needed : nodes;

  return {
    ...contour,
    nodes: nodes.map((node) => ({
      ...node,
      handleIn: node.handleIn ? straightened(node.point, node.handleIn) : null,
      handleOut: node.handleOut ? straightened(node.point, node.handleOut) : null,
    })),
  };
}

/**
 * How many points `tidy` would take out, without taking any out.
 *
 * For saying what a command is about to do before somebody presses it, which
 * matters more here than for the others: this is the one operation in the set
 * that removes something.
 */
export function tidyWouldRemove(contours: Contour[]): number {
  let before = 0;
  let after = 0;
  for (const contour of contours) {
    before += contour.nodes.length;
    after += tidy(contour).nodes.length;
  }
  return before - after;
}

/*
 * Opening and reconnecting a corner.
 *
 * This is the pair that looks strangest to anyone who has not drawn type, and
 * it exists for one specific job. Where a stem meets a shoulder, the two are
 * usually drawn as overlapping shapes and merged; the corner where they meet
 * is a sharp inside angle, and a sharp inside angle in a merged outline is
 * where the ink pools and the rasteriser puts a black pixel at small sizes.
 * Opening the corner replaces that point with two points and a short flat
 * between them, so the join has a real, controllable width. Reconnecting is
 * the way back.
 */

/** How far along each side an opened corner reaches, in font units. */
export const OPEN_BY = 20;

/**
 * The parameter at which a cubic is `want` units away from one of its ends.
 *
 * De Casteljau gives points by parameter, not by distance, and the two are not
 * proportional on a curve. Bisection rather than arithmetic because the
 * distance from an endpoint climbs steadily as the parameter leaves it, which
 * is all bisection needs, and because thirty halvings of an interval cost
 * nothing at the scale this runs at.
 *
 * Never returns past the middle of the segment: opening a corner should eat
 * into the sides next to it, never past the points at their far ends.
 */
function parameterAt(
  curve: [Vec2, Vec2, Vec2, Vec2],
  want: number,
  fromEnd: "start" | "end",
): number {
  const at = (t: number): Vec2 => {
    const u = 1 - t;
    return {
      x:
        u * u * u * curve[0].x +
        3 * u * u * t * curve[1].x +
        3 * u * t * t * curve[2].x +
        t * t * t * curve[3].x,
      y:
        u * u * u * curve[0].y +
        3 * u * u * t * curve[1].y +
        3 * u * t * t * curve[2].y +
        t * t * t * curve[3].y,
    };
  };
  const anchor = fromEnd === "start" ? curve[0] : curve[3];
  // Asked for more than half the segment, stop at the middle exactly rather
  // than converging on it: half a segment is the answer, not an approximation
  // of one.
  if (distance(anchor, at(0.5)) <= want) return 0.5;
  let low = 0;
  let high = 0.5;
  for (let step = 0; step < 30; step++) {
    const mid = (low + high) / 2;
    const reach = distance(anchor, at(fromEnd === "start" ? mid : 1 - mid));
    if (reach < want) low = mid;
    else high = mid;
  }
  const found = (low + high) / 2;
  return fromEnd === "start" ? found : 1 - found;
}

/** Split a cubic in two at a parameter, in the four-point form used here. */
function splitAt(
  curve: [Vec2, Vec2, Vec2, Vec2],
  t: number,
): [[Vec2, Vec2, Vec2, Vec2], [Vec2, Vec2, Vec2, Vec2]] {
  const mix = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const p01 = mix(curve[0], curve[1]);
  const p12 = mix(curve[1], curve[2]);
  const p23 = mix(curve[2], curve[3]);
  const p012 = mix(p01, p12);
  const p123 = mix(p12, p23);
  const middle = mix(p012, p123);
  return [
    [curve[0], p01, p012, middle],
    [middle, p123, p23, curve[3]],
  ];
}

/** The segment between two nodes as four points, and whether it was straight. */
function segmentOf(from: GlyphNode, to: GlyphNode): {
  curve: [Vec2, Vec2, Vec2, Vec2];
  straight: boolean;
} {
  const straight = !from.handleOut && !to.handleIn;
  return {
    curve: [from.point, from.handleOut ?? from.point, to.handleIn ?? to.point, to.point],
    straight,
  };
}

/**
 * Replace a corner with two points and a flat between them.
 *
 * Both sides are cut by the same distance, measured along the outline rather
 * than straight across, so an opened corner on a curve stays where the curve
 * is. The two new points are plain corners joined by a straight line, which is
 * the thing that gets dragged afterwards -- the whole point of the operation
 * is that the width of that flat is now a decision somebody can make.
 *
 * Returns the contour unchanged where there is no corner to open: an endpoint
 * of an open path has only one side, and a path of fewer than three points has
 * no corner at all.
 */
export function openCorner(contour: Contour, index: number, by: number = OPEN_BY): Contour {
  const { nodes, closed } = contour;
  if (nodes.length < 3) return contour;
  if (!closed && (index === 0 || index === nodes.length - 1)) return contour;
  if (index < 0 || index >= nodes.length) return contour;

  const here = nodes[index];
  const before = nodes[(index - 1 + nodes.length) % nodes.length];
  const after = nodes[(index + 1) % nodes.length];

  const arriving = segmentOf(before, here);
  const leaving = segmentOf(here, after);
  if (distance(before.point, here.point) < 1e-9) return contour;
  if (distance(here.point, after.point) < 1e-9) return contour;

  const [backHalf] = splitAt(arriving.curve, parameterAt(arriving.curve, by, "end"));
  const [, frontHalf] = splitAt(leaving.curve, parameterAt(leaving.curve, by, "start"));

  const first: GlyphNode = {
    point: backHalf[3],
    handleIn: arriving.straight ? null : backHalf[2],
    handleOut: null,
    type: "corner",
  };
  const second: GlyphNode = {
    point: frontHalf[0],
    handleIn: null,
    handleOut: leaving.straight ? null : frontHalf[1],
    type: "corner",
  };

  const next = nodes.slice();
  next[(index - 1 + nodes.length) % nodes.length] = {
    ...before,
    handleOut: arriving.straight ? null : backHalf[1],
  };
  next[(index + 1) % nodes.length] = {
    ...after,
    handleIn: leaving.straight ? null : frontHalf[2],
  };
  next.splice(index, 1, first, second);
  return { ...contour, nodes: next };
}

/** Where two lines cross, or null when they never do. */
function crossing(a: Vec2, alongA: Vec2, b: Vec2, alongB: Vec2): Vec2 | null {
  const denominator = alongA.x * alongB.y - alongA.y * alongB.x;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((b.x - a.x) * alongB.y - (b.y - a.y) * alongB.x) / denominator;
  return { x: a.x + alongA.x * t, y: a.y + alongA.y * t };
}

/**
 * A curve stretched to end somewhere further on, keeping its shape.
 *
 * Both handles are scaled by the same factor the chord grew by. For a straight
 * segment -- where both handles sit on their own nodes -- this is exact, and a
 * straight side extends to a straight side. For a curved one it is the usual
 * approximation, and it is right where it matters here: the sides of a stem,
 * which are straight or very nearly.
 */
function stretched(
  curve: [Vec2, Vec2, Vec2, Vec2],
  target: Vec2,
): [Vec2, Vec2, Vec2, Vec2] {
  const was = distance(curve[0], curve[3]);
  const now = distance(curve[0], target);
  const factor = was < 1e-9 ? 1 : now / was;
  return [
    curve[0],
    { x: curve[0].x + (curve[1].x - curve[0].x) * factor, y: curve[0].y + (curve[1].y - curve[0].y) * factor },
    { x: target.x + (curve[2].x - curve[3].x) * factor, y: target.y + (curve[2].y - curve[3].y) * factor },
    target,
  ];
}

/** The direction the outline is travelling as it arrives at a node. */
function arrivalOf(node: GlyphNode, previous: GlyphNode): Vec2 {
  const from = node.handleIn ?? previous.point;
  const away = { x: node.point.x - from.x, y: node.point.y - from.y };
  if (Math.hypot(away.x, away.y) > 1e-9) return away;
  return { x: node.point.x - previous.point.x, y: node.point.y - previous.point.y };
}

/** The direction the outline is travelling as it leaves a node. */
function departureOf(node: GlyphNode, next: GlyphNode): Vec2 {
  const to = node.handleOut ?? next.point;
  const away = { x: to.x - node.point.x, y: to.y - node.point.y };
  if (Math.hypot(away.x, away.y) > 1e-9) return away;
  return { x: next.point.x - node.point.x, y: next.point.y - node.point.y };
}

/**
 * Where an opened corner would close back up, or null if it never would.
 *
 * The point is where the two outer sides, carried on past the pair, cross each
 * other. Sides that are parallel never cross and there is no corner to make:
 * the answer is null and the command says so rather than putting a point in an
 * arbitrary place between them.
 */
export function reconnectionPoint(contour: Contour, index: number): Vec2 | null {
  const { nodes, closed } = contour;
  if (nodes.length < 4) return null;
  const nextIndex = (index + 1) % nodes.length;
  if (!closed && (index === 0 || nextIndex === 0 || nextIndex === nodes.length - 1)) return null;

  const first = nodes[index];
  const second = nodes[nextIndex];
  const before = nodes[(index - 1 + nodes.length) % nodes.length];
  const after = nodes[(nextIndex + 1) % nodes.length];

  return crossing(
    first.point,
    arrivalOf(first, before),
    second.point,
    departureOf(second, after),
  );
}

/**
 * Close an opened corner: two points and the flat between them become one.
 *
 * The sides either side are carried on until they meet, which is the way back
 * from `openCorner` and lands exactly where the corner was when both sides are
 * straight. Where the sides are parallel there is nothing to meet at, and the
 * contour comes back untouched.
 */
export function reconnect(contour: Contour, index: number): Contour {
  const meeting = reconnectionPoint(contour, index);
  if (!meeting) return contour;

  const { nodes } = contour;
  const nextIndex = (index + 1) % nodes.length;
  const beforeIndex = (index - 1 + nodes.length) % nodes.length;
  const afterIndex = (nextIndex + 1) % nodes.length;
  const first = nodes[index];
  const second = nodes[nextIndex];
  const before = nodes[beforeIndex];
  const after = nodes[afterIndex];

  const arriving = segmentOf(before, first);
  const leaving = segmentOf(second, after);
  const grownIn = stretched(arriving.curve, meeting);
  // The far side is stretched backwards, so it is measured from `after` and
  // reversed: the same arithmetic, run the way the segment is not drawn.
  const grownOut = stretched(
    [leaving.curve[3], leaving.curve[2], leaving.curve[1], leaving.curve[0]],
    meeting,
  );

  const joined: GlyphNode = {
    point: meeting,
    handleIn: arriving.straight ? null : grownIn[2],
    handleOut: leaving.straight ? null : grownOut[2],
    type: "corner",
  };

  const next = nodes.slice();
  next[beforeIndex] = { ...before, handleOut: arriving.straight ? null : grownIn[1] };
  next[afterIndex] = { ...after, handleIn: leaving.straight ? null : grownOut[1] };
  const merged: GlyphNode = { ...joined, type: typeFor(joined) };

  // The pair may wrap the end of the list, in which case the survivor takes
  // the place of the second and the first falls off the end.
  if (nextIndex > index) {
    next.splice(index, 2, merged);
  } else {
    next[nextIndex] = merged;
    next.splice(index, 1);
  }
  return { ...contour, nodes: next };
}
