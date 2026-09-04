/**
 * Cutting a letter along a dragged line.
 *
 * The knife is how a shape gets divided when no boolean operation says what
 * you mean: taking the top off a stem to make a flat terminal, splitting a
 * bowl from its stem so the two can be spaced apart, slicing a diagonal to
 * shorten it. Every drawing tool has one and none of them agrees on the
 * details, so the ones chosen here are written down.
 *
 * A cut is a *segment*, not an infinite line. Dragging across half a letter
 * cuts the half you dragged across, which is what somebody dragging expects
 * and what makes it possible to cut one bowl of a `B` and not the other.
 *
 * A closed contour comes back as closed contours. The two ends of each cut are
 * joined by a straight line, which is the only thing they could be joined by:
 * a curve would be a shape nobody drew. Crossings are paired in the order they
 * fall along the cut, which is what separates the pieces correctly when a
 * single stroke crosses one contour four times -- an `S`, a `w`, the two sides
 * of a `V`.
 *
 * A cut that crosses a contour an odd number of times has grazed it rather
 * than gone through it, and that contour is left alone: there is no way to
 * pair an odd number of ends, and a tool that guessed would produce a shape
 * with a piece missing.
 */

import { cubicAt, cubicParametersAtY, splitCubic } from "./geometry";
import type { Contour, GlyphNode, Vec2 } from "./types";

/*
 * Three tolerances, and what each is for.
 *
 * `ON_NODE` is in parameter space: a root this close to either end of a
 * segment is the node at that end, and belongs to the pass that looks at
 * nodes rather than the one that puts new points inside segments.
 *
 * `ON_LINE` is in font units: a node this close to the cut is on it. Half a
 * unit, the same figure `tidy` uses and for the same reason -- a font is drawn
 * on whole units, so anything under one is below what the format can express.
 *
 * `ON_EITHER_SIDE` is how far along the neighbouring segments to look when
 * asking whether the outline crosses the line at a node or merely touches it.
 * Far enough that a curve leaving the line has got away from it, near enough
 * that nothing else has happened in between.
 */
const ON_NODE = 1e-6;
const ON_LINE = 0.5;
const ON_EITHER_SIDE = 1e-3;

/** One crossing: where on the outline, and how far along the cut. */
interface Crossing {
  /** Index of the outline segment crossed. */
  segment: number;
  /** Parameter along that segment, in (0, 1). */
  t: number;
  /** Distance along the cut line, which is what decides the pairing. */
  along: number;
}

/** The four control points of an outline segment, straight ones included. */
function curveOf(from: GlyphNode, to: GlyphNode): [Vec2, Vec2, Vec2, Vec2] {
  return [from.point, from.handleOut ?? from.point, to.handleIn ?? to.point, to.point];
}

/** Whether a segment is a straight run, so its pieces stay straight. */
const isStraight = (from: GlyphNode, to: GlyphNode): boolean => !from.handleOut && !to.handleIn;

/** How many segments a contour has: one per node when closed, one fewer open. */
const segmentCount = (contour: Contour): number =>
  contour.closed ? contour.nodes.length : contour.nodes.length - 1;

/** What a cut found on one contour: nodes it went through, segments it split. */
interface Found {
  /** Existing nodes the cut passes exactly through. */
  onNodes: Array<{ index: number; along: number }>;
  /** Places inside a segment where a point has to be put. */
  onSegments: Crossing[];
}

/**
 * Every place a cut crosses one contour.
 *
 * Worked in the cut's own frame rather than by solving a line against a curve:
 * turn the world so the cut lies along the x-axis, and a crossing is a place
 * the curve reaches y = 0, which is the root-finder this codebase already has
 * and has already had the tolerances argued out of it. The x it lands at says
 * whether the crossing is on the part of the line that was actually dragged.
 *
 * Crossings that land on a node the outline already has are kept apart from
 * the rest, and this is not a nicety. A letter carries a point wherever its
 * outline reaches furthest, so a horizontal cut through the widest part of a
 * bowl -- which is most of what anybody cuts -- lands exactly on two of them.
 * The first version of this dropped those as endpoints and reported that the
 * cut had missed a circle it went straight through.
 */
function crossingsOn(contour: Contour, from: Vec2, to: Vec2): Found {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { onNodes: [], onSegments: [] };
  const ux = dx / length;
  const uy = dy / length;
  // Along the cut, and across it.
  const along = (point: Vec2) => (point.x - from.x) * ux + (point.y - from.y) * uy;
  const across = (point: Vec2) => -(point.x - from.x) * uy + (point.y - from.y) * ux;
  const turned = (point: Vec2): Vec2 => ({ x: along(point), y: across(point) });

  const nodes = contour.nodes;
  const count = segmentCount(contour);
  const curves: Array<[Vec2, Vec2, Vec2, Vec2]> = [];
  for (let segment = 0; segment < count; segment++) {
    curves.push(
      curveOf(nodes[segment], nodes[(segment + 1) % nodes.length]).map(turned) as [
        Vec2,
        Vec2,
        Vec2,
        Vec2,
      ],
    );
  }

  const onSegments: Crossing[] = [];
  for (let segment = 0; segment < count; segment++) {
    const [a, b, c, d] = curves[segment];
    for (const t of cubicParametersAtY(a, b, c, d, 0)) {
      /*
       * Endpoints are handled below, not here. The root-finder hands over a
       * root at nought deliberately -- a ray through a node has to be counted
       * somewhere -- but putting a new point on top of a node that is already
       * there is how a path gets a zero-length segment.
       */
      if (t <= ON_NODE || t >= 1 - ON_NODE) continue;
      const reach = cubicAt(a, b, c, d, t).x;
      // On the piece of line that was dragged, not on its continuation.
      if (reach < 0 || reach > length) continue;
      onSegments.push({ segment, t, along: reach });
    }
  }

  const onNodes: Array<{ index: number; along: number }> = [];
  for (let index = 0; index < nodes.length; index++) {
    // An endpoint of an open path is not a crossing: cutting there would make
    // a piece with nothing in it.
    if (!contour.closed && (index === 0 || index === nodes.length - 1)) continue;
    const here = turned(nodes[index].point);
    if (Math.abs(here.y) > ON_LINE) continue;
    if (here.x < 0 || here.x > length) continue;

    /*
     * On the line is not the same as through it. A cut laid along the top of a
     * bowl touches the node at its highest point without going anywhere, and
     * counting that as a crossing would divide a letter along a line that
     * never entered it. Looked at just either side of the node: opposite sides
     * means through, the same side means a touch.
     */
    const before = curves[(index - 1 + count) % count];
    const after = curves[index % count];
    const leaving = cubicAt(...after, ON_EITHER_SIDE).y;
    const arriving = cubicAt(...before, 1 - ON_EITHER_SIDE).y;
    if (arriving * leaving >= 0) continue;
    onNodes.push({ index, along: here.x });
  }

  return { onNodes, onSegments };
}

/**
 * A contour with a point put in where a cut crosses it.
 *
 * One at a time, highest first, so that inserting one never moves the segment
 * another is waiting on. Two cuts on the same segment need the earlier one's
 * parameter rescaled -- after the segment has been split at the later one, the
 * first piece spans nought to that parameter, and the earlier cut sits at
 * their ratio.
 */
function withCrossings(
  contour: Contour,
  found: Found,
): { nodes: GlyphNode[]; marks: Array<{ index: number; along: number }> } {
  const ordered = [...found.onSegments].sort((one, other) =>
    one.segment === other.segment ? other.t - one.t : other.segment - one.segment,
  );

  const nodes = contour.nodes.slice();
  // The nodes the cut already passes through are marks from the start; the
  // insertions below shift them along as they shift everything else.
  const marks: Array<{ index: number; along: number }> = found.onNodes.map((one) => ({ ...one }));
  let previousOnSegment: Crossing | null = null;

  for (const crossing of ordered) {
    const scale =
      previousOnSegment && previousOnSegment.segment === crossing.segment ? previousOnSegment.t : 1;
    const local = crossing.t / scale;
    previousOnSegment = crossing;

    const first = crossing.segment;
    const second = (first + 1) % nodes.length;
    const straight = isStraight(nodes[first], nodes[second]);
    const [left, right] = splitCubic(...curveOf(nodes[first], nodes[second]), local);

    nodes[first] = { ...nodes[first], handleOut: straight ? null : left[1] };
    nodes[second] = { ...nodes[second], handleIn: straight ? null : right[2] };
    const middle: GlyphNode = {
      point: left[3],
      handleIn: straight ? null : left[2],
      handleOut: straight ? null : right[1],
      type: "corner",
    };
    nodes.splice(first + 1, 0, middle);

    // Everything at or past the new point moved along by one.
    for (const mark of marks) if (mark.index >= first + 1) mark.index += 1;
    marks.push({ index: first + 1, along: crossing.along });
  }

  return { nodes, marks };
}

/**
 * The pieces one closed contour falls into.
 *
 * The traversal is the whole of it. Walk the outline from one crossing to the
 * next, then jump along the cut to the crossing it was paired with and carry
 * on from there. Each jump is a straight line -- so the handles facing it are
 * dropped -- and the walk comes back to where it started, which closes the
 * piece. Repeat until every stretch of outline has been used once.
 */
function splitClosed(
  nodes: GlyphNode[],
  marks: Array<{ index: number; along: number }>,
): Contour[] {
  const ring = [...marks].sort((one, other) => one.index - other.index);
  const count = ring.length;

  // Paired in the order they fall along the cut: first with second, third with
  // fourth. Which is what makes a stroke across four crossings produce the two
  // pieces somebody dragging it meant, rather than a bow tie.
  const byCut = ring.map((mark, position) => ({ position, along: mark.along }));
  byCut.sort((one, other) => one.along - other.along);
  const partner = new Array<number>(count);
  for (let index = 0; index + 1 < count; index += 2) {
    partner[byCut[index].position] = byCut[index + 1].position;
    partner[byCut[index + 1].position] = byCut[index].position;
  }

  const used = new Array<boolean>(count).fill(false);
  const pieces: Contour[] = [];
  for (let start = 0; start < count; start++) {
    if (used[start]) continue;
    const piece: GlyphNode[] = [];
    let arc = start;
    while (!used[arc]) {
      used[arc] = true;
      const openAt = ring[arc].index;
      const closeAt = ring[(arc + 1) % count].index;
      for (let index = openAt; ; index = (index + 1) % nodes.length) {
        const node = nodes[index];
        // The two ends of a stretch face the straight cut, so whichever handle
        // points at it goes.
        if (index === openAt) piece.push({ ...node, handleIn: null });
        else if (index === closeAt) piece.push({ ...node, handleOut: null });
        else piece.push(node);
        if (index === closeAt) break;
      }
      arc = partner[(arc + 1) % count];
    }
    if (piece.length >= 2) pieces.push({ closed: true, nodes: piece });
  }
  return pieces;
}

/** The pieces one open contour falls into: no chords, just shorter paths. */
function splitOpen(nodes: GlyphNode[], marks: Array<{ index: number; along: number }>): Contour[] {
  const at = [...marks].map((mark) => mark.index).sort((one, other) => one - other);
  const edges = [0, ...at, nodes.length - 1];
  const pieces: Contour[] = [];
  for (let index = 0; index + 1 < edges.length; index++) {
    const run = nodes.slice(edges[index], edges[index + 1] + 1);
    if (run.length < 2) continue;
    // The cut ends are plain: nothing carries on past them.
    const trimmed = run.map((node, position) => ({
      ...node,
      handleIn: position === 0 && edges[index] !== 0 ? null : node.handleIn,
      handleOut:
        position === run.length - 1 && edges[index + 1] !== nodes.length - 1
          ? null
          : node.handleOut,
    }));
    pieces.push({ closed: false, nodes: trimmed });
  }
  return pieces;
}

/**
 * Cut a letter along a line, or say that the line missed.
 *
 * Null rather than the contours unchanged, so the caller can tell somebody the
 * cut did nothing instead of pushing an edit that changed nothing. A contour
 * the cut missed, or grazed an odd number of times, comes back whole.
 */
export function slice(contours: Contour[], from: Vec2, to: Vec2): Contour[] | null {
  let cutAny = false;
  const out: Contour[] = [];

  for (const contour of contours) {
    if (contour.nodes.length < 2) {
      out.push(contour);
      continue;
    }
    const found = crossingsOn(contour, from, to);
    const crossings = found.onNodes.length + found.onSegments.length;
    const enough = contour.closed ? crossings >= 2 && crossings % 2 === 0 : crossings >= 1;
    if (!enough) {
      out.push(contour);
      continue;
    }

    const { nodes, marks } = withCrossings(contour, found);
    const pieces = contour.closed ? splitClosed(nodes, marks) : splitOpen(nodes, marks);
    if (pieces.length <= 1) {
      out.push(contour);
      continue;
    }
    cutAny = true;
    out.push(...pieces);
  }

  return cutAny ? out : null;
}
