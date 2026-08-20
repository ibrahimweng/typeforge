/**
 * Turning a centre-line into an outline.
 *
 * This is the piece everything else stands on, so it is worth saying exactly
 * what it does and why it cannot go wrong.
 *
 * A stroke is a spine plus a pen. To draw it, the spine is offset to the left
 * by half the pen's width and to the right by the same, and the two sides are
 * joined at the ends by terminals. The offsets are not sampled or fitted --
 * they are worked out in closed form:
 *
 *   - offsetting a straight line moves it sideways, and it is still a line;
 *   - offsetting a circular arc keeps the centre and changes the radius, and it
 *     is still a circular arc;
 *   - with contrast, the offset is scaled differently along the pen's two axes,
 *     which turns that circular arc into an ellipse arc -- still exact, still
 *     one curve, still no error that grows with weight.
 *
 * That last point is the whole reason for the restriction to lines and arcs.
 * Free-form spines would need the offset to be sampled and refitted, and the
 * fit would be a little different at every weight; two cuts of the same
 * typeface would then disagree in ways nobody chose. Here the heavy cut is not
 * the light one pushed outwards -- it is the same construction, drawn again
 * with a wider pen.
 *
 * The one way a stroke can fail is asking for a pen wider than twice the
 * tightest radius its spine turns through, which would offset the inner side
 * past its own centre. That is checked before anything is drawn rather than
 * repaired afterwards: see `strokeLimit`.
 */

import { contourArea, reverseContour } from "@/font/geometry";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import type { Pen, Spine, SpineArc, SpineSegment, Stroke, Terminal } from "./types";

// ---------------------------------------------------------------------------
// The pen's two half-widths
// ---------------------------------------------------------------------------

/**
 * How far the pen reaches along each of its own axes.
 *
 * `across` is the broad direction and `along` the narrow one; with no contrast
 * they are equal and the pen is a circle, which is what makes a sans
 * monolinear.
 */
export interface PenReach {
  across: number;
  along: number;
  /** The pen's angle in radians. */
  angle: number;
}

export function penReach(pen: Pen): PenReach {
  const half = pen.weight / 2;
  const contrast = Math.min(Math.max(pen.contrast, 0), 0.95);
  return {
    across: half,
    along: half * (1 - contrast),
    angle: (pen.angle * Math.PI) / 180,
  };
}

/**
 * The widest pen this spine can take before its inner side turns inside out.
 *
 * A stroke bending through a radius R can be at most 2R wide: at exactly that
 * width the inner offset collapses to the centre of the turn, and beyond it the
 * inner side passes through itself. Straight runs have no such limit.
 *
 * Reported rather than silently clamped, so a letter that cannot take the
 * weight being asked for says so while the skeleton is being designed, instead
 * of quietly deforming when someone drags a slider.
 */
export function strokeLimit(spine: Spine): number {
  let tightest = Infinity;
  for (const segment of spine.segments) {
    if (segment.kind === "arc") tightest = Math.min(tightest, segment.radius);
  }
  return tightest === Infinity ? Infinity : tightest * 2;
}

// ---------------------------------------------------------------------------
// Offset curves
// ---------------------------------------------------------------------------

interface OffsetLine {
  kind: "line";
  from: Vec2;
  to: Vec2;
}

/** An ellipse arc, which a circular arc is the special case of. */
interface OffsetEllipse {
  kind: "ellipse";
  centre: Vec2;
  rx: number;
  ry: number;
  /** Radians the ellipse's own axes are turned by, which is the pen's angle. */
  rotation: number;
  from: number;
  to: number;
}

type OffsetSegment = OffsetLine | OffsetEllipse;

const rotate = (point: Vec2, angle: number): Vec2 => ({
  x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
  y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
});

/** The pen's reach in a given direction, resolved into the pen's own frame. */
function reachAlong(direction: Vec2, reach: PenReach): Vec2 {
  const local = rotate(direction, -reach.angle);
  return rotate({ x: local.x * reach.across, y: local.y * reach.along }, reach.angle);
}

/** Direction of travel at the start and end of a segment. */
function tangents(segment: SpineSegment): { start: Vec2; end: Vec2 } {
  if (segment.kind === "line") {
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const length = Math.hypot(dx, dy) || 1;
    const unit = { x: dx / length, y: dy / length };
    return { start: unit, end: unit };
  }
  const way = segment.sweepPositive ? 1 : -1;
  const at = (angle: number): Vec2 => ({
    x: -Math.sin(angle) * way,
    y: Math.cos(angle) * way,
  });
  return { start: at(segment.startAngle), end: at(segment.endAngle) };
}

/** A quarter turn anticlockwise: the left of the direction travelled. */
const leftOf = (direction: Vec2): Vec2 => ({ x: -direction.y, y: direction.x });

function pointOnArc(arc: SpineArc, angle: number): Vec2 {
  return {
    x: arc.centre.x + arc.radius * Math.cos(angle),
    y: arc.centre.y + arc.radius * Math.sin(angle),
  };
}

function segmentStart(segment: SpineSegment): Vec2 {
  return segment.kind === "line" ? segment.from : pointOnArc(segment, segment.startAngle);
}

function segmentEnd(segment: SpineSegment): Vec2 {
  return segment.kind === "line" ? segment.to : pointOnArc(segment, segment.endAngle);
}

/**
 * Offset one spine segment to one side.
 *
 * `side` is +1 for the left of the direction travelled and -1 for the right.
 */
function offsetSegment(segment: SpineSegment, side: number, reach: PenReach): OffsetSegment {
  if (segment.kind === "line") {
    const { start } = tangents(segment);
    const normal = leftOf(start);
    const shift = reachAlong(normal, reach);
    const move = (point: Vec2): Vec2 => ({
      x: point.x + shift.x * side,
      y: point.y + shift.y * side,
    });
    return { kind: "line", from: move(segment.from), to: move(segment.to) };
  }

  /*
   * The arc case, which is where the exactness comes from.
   *
   * Walking anticlockwise, the left of the direction travelled points at the
   * centre of the turn, so the left side is the inner one and its radius
   * shrinks. Writing that as a sign lets both sides share one expression.
   *
   * With contrast the two axes shrink by different amounts, and the result is
   * an ellipse with the same centre and the same parametric angles -- which is
   * why nothing here has to be sampled.
   */
  const inward = segment.sweepPositive ? side : -side;
  const rx = segment.radius - inward * reach.across;
  const ry = segment.radius - inward * reach.along;
  return {
    kind: "ellipse",
    centre: segment.centre,
    rx,
    ry,
    rotation: reach.angle,
    from: segment.startAngle - reach.angle,
    to: segment.endAngle - reach.angle,
  };
}

// ---------------------------------------------------------------------------
// Writing offsets as bezier nodes
// ---------------------------------------------------------------------------

/** Where an ellipse arc's parametric angle puts a point, in world coordinates. */
function ellipseAt(arc: OffsetEllipse, t: number): Vec2 {
  const local = { x: arc.rx * Math.cos(t), y: arc.ry * Math.sin(t) };
  const turned = rotate(local, arc.rotation);
  return { x: arc.centre.x + turned.x, y: arc.centre.y + turned.y };
}

/** The derivative there, which the handle lengths are built from. */
function ellipseSlope(arc: OffsetEllipse, t: number): Vec2 {
  const local = { x: -arc.rx * Math.sin(t), y: arc.ry * Math.cos(t) };
  return rotate(local, arc.rotation);
}

/**
 * Split an ellipse arc into cubic pieces.
 *
 * Quarter turns at most, with the handles set to the length that best fits an
 * arc of that width: four thirds of the tangent of a quarter of the turn. For a
 * ninety degree piece that is 0.5523 of the radius, the number every drawing
 * program uses for a circle, and its error is three parts in ten thousand.
 *
 * Worth stating because a plausible-looking alternative is out by seven times
 * as much. Written as sin(x)(sqrt(4 + 3tan(x/2)^2) - 1)/3 the factor comes out
 * at 0.5486 for a quarter turn, and a 300-unit ring drawn with it strays 0.59
 * units from round -- past the half-unit grid a TrueType font is written on,
 * so it would have survived into the file.
 */
function ellipseNodes(arc: OffsetEllipse): GlyphNode[] {
  const sweep = arc.to - arc.from;
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const step = sweep / pieces;
  const factor = (4 / 3) * Math.tan(step / 4);

  const nodes: GlyphNode[] = [];
  for (let piece = 0; piece <= pieces; piece++) {
    const t = arc.from + step * piece;
    const point = ellipseAt(arc, t);
    const slope = ellipseSlope(arc, t);
    nodes.push({
      point,
      handleIn:
        piece === 0
          ? null
          : { x: point.x - slope.x * factor, y: point.y - slope.y * factor },
      handleOut:
        piece === pieces
          ? null
          : { x: point.x + slope.x * factor, y: point.y + slope.y * factor },
      type: "smooth",
    });
  }
  return nodes;
}

function offsetNodes(segment: OffsetSegment): GlyphNode[] {
  if (segment.kind === "line") {
    return [
      { point: segment.from, handleIn: null, handleOut: null, type: "corner" },
      { point: segment.to, handleIn: null, handleOut: null, type: "corner" },
    ];
  }
  return ellipseNodes(segment);
}

/** Reverse an offset run so it can be walked back down the other side. */
function reverseOffset(segment: OffsetSegment): OffsetSegment {
  return segment.kind === "line"
    ? { kind: "line", from: segment.to, to: segment.from }
    : { ...segment, from: segment.to, to: segment.from };
}

/**
 * Stitch a run of offset segments into nodes, dropping the duplicate point
 * where one ends and the next begins and keeping whichever handles exist.
 */
function stitch(segments: OffsetSegment[]): GlyphNode[] {
  const nodes: GlyphNode[] = [];
  for (const segment of segments) {
    const piece = offsetNodes(segment);
    if (nodes.length > 0) {
      const previous = nodes[nodes.length - 1];
      const joining = piece[0];
      // Same point from both sides of a join: keep one node carrying both
      // handles, so a smooth join stays smooth.
      const together = Math.hypot(previous.point.x - joining.point.x, previous.point.y - joining.point.y);
      if (together < 1e-6) {
        previous.handleOut = joining.handleOut;
        previous.type = previous.handleIn && joining.handleOut ? "smooth" : previous.type;
        nodes.push(...piece.slice(1));
        continue;
      }
      // A genuine corner between two runs: both points stay.
    }
    nodes.push(...piece);
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

/**
 * The nodes that close one end of a stroke, running from the left side across
 * to the right.
 *
 * A slab is not drawn here. A serif is a bar laid over the end of a stroke, and
 * that is how it is made: a separate shape, unioned in afterwards, exactly as
 * one is drawn by hand. Trying to work it into the sweep would mean the sweep
 * had to know about brackets, and the join between bar and stem would have to
 * be solved twice.
 */
function terminalNodes(
  terminal: Terminal,
  at: Vec2,
  direction: Vec2,
  reach: PenReach,
): GlyphNode[] {
  const normal = leftOf(direction);
  const shift = reachAlong(normal, reach);
  const left = { x: at.x + shift.x, y: at.y + shift.y };
  const right = { x: at.x - shift.x, y: at.y - shift.y };

  if (terminal.kind === "round") {
    // A half turn of the pen itself, which with contrast is a half ellipse.
    const fromAngle = Math.atan2(
      (left.y - at.y) * Math.cos(reach.angle) - (left.x - at.x) * -Math.sin(reach.angle),
      (left.x - at.x) * Math.cos(reach.angle) + (left.y - at.y) * Math.sin(reach.angle),
    );
    const arc: OffsetEllipse = {
      kind: "ellipse",
      centre: at,
      rx: reach.across,
      ry: reach.along,
      rotation: reach.angle,
      from: fromAngle,
      // Half a turn, taken the way that leaves the stroke rather than re-enters
      // it, which is decided by which side of the direction of travel we are on.
      to: fromAngle - Math.PI,
    };
    return ellipseNodes(arc);
  }

  if (terminal.kind === "angled" && terminal.angle) {
    // Slide the two corners in opposite directions along the stroke, which is
    // the cut a nib held at an angle leaves.
    const slide = Math.tan((terminal.angle * Math.PI) / 180) * reach.across;
    const move = (point: Vec2, way: number): Vec2 => ({
      x: point.x + direction.x * slide * way,
      y: point.y + direction.y * slide * way,
    });
    return [
      { point: move(left, 1), handleIn: null, handleOut: null, type: "corner" },
      { point: move(right, -1), handleIn: null, handleOut: null, type: "corner" },
    ];
  }

  return [
    { point: left, handleIn: null, handleOut: null, type: "corner" },
    { point: right, handleIn: null, handleOut: null, type: "corner" },
  ];
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * Draw a stroke.
 *
 * An open stroke comes back as one contour: up the left side, across the far
 * end, back down the right, across the near end. A closed one -- a ring, such
 * as the o -- comes back as two, the outside and the counter, because a ring
 * has no ends to join.
 */
export function sweep(stroke: Stroke): Contour[] {
  const { spine, pen } = stroke;
  if (spine.segments.length === 0) return [];
  const reach = penReach(pen);

  const left = spine.segments.map((segment) => offsetSegment(segment, 1, reach));
  const right = spine.segments.map((segment) => offsetSegment(segment, -1, reach));

  if (spine.closed) {
    /*
     * Two rings, and which side is which is decided by measuring rather than
     * by assuming.
     *
     * Travelling anticlockwise the left of the direction of travel points at
     * the centre, so the left offset is the counter -- but a spine drawn the
     * other way round swaps them, and a skeleton is allowed to be drawn either
     * way. Taking the larger of the two as the outside is true whichever way it
     * was drawn. Assuming instead cost an o its counter: at a pen of 499 units
     * on a radius of 250 the hole came out 999 units across, larger than the
     * letter containing it.
     */
    const one: Contour = { nodes: closeRing(stitch(left)), closed: true };
    const other: Contour = { nodes: closeRing(stitch(right)), closed: true };
    const [outside, inside] =
      Math.abs(contourArea(one)) >= Math.abs(contourArea(other)) ? [one, other] : [other, one];
    // The counter has to run against the outside, or it reads as a second piece
    // of ink rather than as a hole.
    return [
      outside,
      Math.sign(contourArea(inside)) === Math.sign(contourArea(outside))
        ? reverseContour(inside)
        : inside,
    ];
  }

  const last = spine.segments[spine.segments.length - 1];
  const first = spine.segments[0];
  const endNodes = terminalNodes(
    stroke.end,
    segmentEnd(last),
    tangents(last).end,
    reach,
  );
  const startNodes = terminalNodes(
    stroke.start,
    segmentStart(first),
    { x: -tangents(first).start.x, y: -tangents(first).start.y },
    reach,
  );

  const nodes: GlyphNode[] = [
    ...stitch(left),
    ...endNodes,
    ...stitch([...right].reverse().map(reverseOffset)),
    ...startNodes,
  ];

  return [{ nodes: dropRepeats(nodes), closed: true }];
}

/** A ring's first and last node are the same point; keep one. */
function closeRing(nodes: GlyphNode[]): GlyphNode[] {
  if (nodes.length < 2) return nodes;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (Math.hypot(first.point.x - last.point.x, first.point.y - last.point.y) > 1e-6) return nodes;
  first.handleIn = last.handleIn;
  return nodes.slice(0, -1);
}

/**
 * Drop points that landed on top of each other.
 *
 * A butt terminal puts its two corners exactly where the two offset sides
 * already end, so without this every stroke would carry four duplicate nodes --
 * harmless to look at, but they would survive into the exported font and show
 * up in the checks as points that go nowhere.
 */
function dropRepeats(nodes: GlyphNode[]): GlyphNode[] {
  const kept: GlyphNode[] = [];
  for (const node of nodes) {
    const previous = kept[kept.length - 1];
    if (
      previous &&
      Math.hypot(previous.point.x - node.point.x, previous.point.y - node.point.y) < 1e-6
    ) {
      // Keep whichever handles the pair had between them.
      previous.handleOut = node.handleOut ?? previous.handleOut;
      continue;
    }
    kept.push(node);
  }
  if (kept.length > 1) {
    const first = kept[0];
    const last = kept[kept.length - 1];
    if (Math.hypot(first.point.x - last.point.x, first.point.y - last.point.y) < 1e-6) {
      first.handleIn = last.handleIn ?? first.handleIn;
      kept.pop();
    }
  }
  return kept;
}
