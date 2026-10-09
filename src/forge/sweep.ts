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

import { nearestTurn } from "./angles";
import { contourArea, reverseContour } from "@/font/geometry";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { endsShaped, softCorners } from "./ends";
import { hefted } from "./heft";
import { folded } from "./shapes";
import type { JoinKind, Pen, Spine, SpineArc, SpineSegment, Stroke, Terminal } from "./types";

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

export interface OffsetLine {
  kind: "line";
  from: Vec2;
  to: Vec2;
}

/** An ellipse arc, which a circular arc is the special case of. */
export interface OffsetEllipse {
  kind: "ellipse";
  centre: Vec2;
  rx: number;
  ry: number;
  /** Radians the ellipse's own axes are turned by, which is the pen's angle. */
  rotation: number;
  from: number;
  to: number;
  /**
   * Split into this many pieces rather than as few as the sweep needs.
   *
   * An arc is cut into quarter turns at most, so how many pieces it becomes --
   * and so how many nodes -- is `ceil(sweep / 90 degrees)`, which steps up as
   * the sweep passes each right angle. That is exactly right for a shape whose
   * sweep is a fact about the letter, and wrong for one whose sweep is a fact
   * about the pen: the wedge filling a corner turns through whatever angle the
   * two offsets leave between them, and that angle moves with the weight. An
   * `M` drawn at the Thin turned far enough at its apex for a second piece and
   * at the Regular did not, so the two came off the pen with different points
   * and could not be joined into one variable font.
   *
   * The body of a stroke needs no such help. An offset arc keeps the parametric
   * angles of the spine arc it came from, so its sweep is the skeleton's and
   * the skeleton is the same at every weight.
   */
  pieces?: number;
}

export type OffsetSegment = OffsetLine | OffsetEllipse;

const rotate = (point: Vec2, angle: number): Vec2 => ({
  x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
  y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
});

/** The pen's reach in a given direction, resolved into the pen's own frame. */
export function reachAlong(direction: Vec2, reach: PenReach): Vec2 {
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
export const leftOf = (direction: Vec2): Vec2 => ({ x: -direction.y, y: direction.x });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

function pointOnArc(arc: SpineArc, angle: number): Vec2 {
  return {
    x: arc.centre.x + arc.radius * Math.cos(angle),
    y: arc.centre.y + arc.radius * Math.sin(angle),
  };
}

export function segmentStart(segment: SpineSegment): Vec2 {
  return segment.kind === "line" ? segment.from : pointOnArc(segment, segment.startAngle);
}

export function segmentEnd(segment: SpineSegment): Vec2 {
  return segment.kind === "line" ? segment.to : pointOnArc(segment, segment.endAngle);
}

/**
 * Offset one spine segment to one side.
 *
 * `side` is +1 for the left of the direction travelled and -1 for the right.
 */
function offsetSegment(one: Headed, side: number, reach: PenReach): OffsetSegment {
  const segment = one.segment;
  if (segment.kind === "line") {
    // The heading rather than the segment's own tangent, because a run of no
    // length has none of its own and takes its neighbours'.
    const normal = leftOf(one.start);
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
  /*
   * An arc that goes nowhere is offset the way a line that goes nowhere is.
   *
   * The line case above says it outright: a run of no length has no tangent of
   * its own and takes its neighbours'. The arc case did not, and read its own
   * centre and angles instead -- which for a piece that never travels are
   * arithmetic about a turn that does not happen. The offset landed wherever
   * that put it rather than on the point its neighbours had arrived at, and a
   * piece whose ends do not meet its neighbours' is a piece `stitch` cannot
   * weld: it keeps both nodes where the same piece at another weight keeps one.
   *
   * That is the whole of the Display's Thin figures. The `two`'s bend is nine
   * pieces at every weight and two of them are arcs of no sweep at the Thin and
   * of five and nineteen degrees everywhere else, so the bend came back with 25
   * nodes at the Thin and 21 at the other three -- and with forty of its points
   * piled on two spots forty-four units apart, which is where the offsets of
   * those two pieces had gone.
   *
   * Placed as a point, it stands still exactly where the run is, keeping its
   * own kind and its own piece count so the node it contributes is the node the
   * travelling version of it contributes.
   */
  const turns = Math.abs(segment.endAngle - segment.startAngle) > 1e-9 && segment.radius > 1e-9;
  if (!turns) {
    const shift = reachAlong(leftOf(one.start), reach);
    const here = segmentStart(segment);
    return {
      kind: "ellipse",
      centre: { x: here.x + shift.x * side, y: here.y + shift.y * side },
      rx: 0,
      ry: 0,
      rotation: reach.angle,
      from: 0,
      to: 0,
      pieces: segment.pieces,
    };
  }

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
    // An arc that pinned its own pieces keeps them on both of its offsets, or
    // the two sides of the same stroke would disagree about how many nodes it
    // has.
    pieces: segment.pieces,
  };
}

// ---------------------------------------------------------------------------
// Writing offsets as bezier nodes
// ---------------------------------------------------------------------------

/** Where an ellipse arc's parametric angle puts a point, in world coordinates. */
export function ellipseAt(arc: OffsetEllipse, t: number): Vec2 {
  const local = { x: arc.rx * Math.cos(t), y: arc.ry * Math.sin(t) };
  const turned = rotate(local, arc.rotation);
  return { x: arc.centre.x + turned.x, y: arc.centre.y + turned.y };
}

/** The derivative there, which the handle lengths are built from. */
export function ellipseSlope(arc: OffsetEllipse, t: number): Vec2 {
  const local = { x: -arc.rx * Math.sin(t), y: arc.ry * Math.cos(t) };
  return rotate(local, arc.rotation);
}

/**
 * The hair of slack in "how many quarter turns is this".
 *
 * An arc is cut into `ceil(sweep / 90 degrees)` pieces, and a right angle is
 * meant to be one of them. Whether it is comes down to the last bit or two of a
 * subtraction: a bowl's corners are cut at nought, a right angle, a half turn
 * and three quarters, and `pi - pi/2` comes out at exactly `pi/2` while
 * `3pi/2 - pi` comes out four ulps above it. So one corner of a bowl was drawn
 * in one piece and the corner opposite it in two.
 *
 * That is invisible on the page -- the second piece is a node on a curve that
 * was already there -- and fatal to the axis, because it only happens while the
 * corner is a true quarter turn. A Brush bowl wide enough to have flat sides
 * between its corners has them at exactly ninety degrees and comes back with 22
 * nodes; the same bowl at the Black is drawn rounder, its corners turn 88.1
 * degrees, and it comes back with 20. Fourteen of the Brush's eighteen letters
 * left standing were this, and the other four are the same bowl in `three` and
 * `ae`.
 *
 * A billionth, because the error is at the sixteenth digit and the smallest
 * thing anybody would mean by it is a millionth of a degree.
 */
const A_QUARTER = 1e-9;

/**
 * How many quarter-turn pieces an arc sweeping `sweep` radians is cut into
 * when nothing pins its count: the one expression `ellipseNodes` and
 * `cutAlong` both use, so that anything pinning an arc it has made or moved
 * can pin it to exactly what the sweep would have given it.
 */
export function piecesFor(sweep: number): number {
  return Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - A_QUARTER));
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
  const pieces = arc.pieces ?? piecesFor(sweep);
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
        piece === 0 ? null : { x: point.x - slope.x * factor, y: point.y - slope.y * factor },
      handleOut:
        piece === pieces ? null : { x: point.x + slope.x * factor, y: point.y + slope.y * factor },
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
function stitch(segments: OffsetSegment[], reach?: PenReach): GlyphNode[] {
  const nodes: GlyphNode[] = [];
  let before: OffsetSegment | null = null;
  for (const segment of segments) {
    const piece = offsetNodes(segment);
    if (nodes.length > 0) {
      const previous = nodes[nodes.length - 1];
      const joining = piece[0];
      // Same point from both sides of a join: keep one node carrying both
      // handles, so a smooth join stays smooth.
      const together = Math.hypot(
        previous.point.x - joining.point.x,
        previous.point.y - joining.point.y,
      );
      if (together < 1e-6) {
        previous.handleOut = joining.handleOut;
        previous.type = previous.handleIn && joining.handleOut ? "smooth" : previous.type;
        if (moving(before) && moving(segment)) alignAt(previous, before, segment, reach);
        nodes.push(...piece.slice(1));
        before = segment;
        continue;
      }
      // A genuine corner between two runs: both points stay.
    }
    nodes.push(...piece);
    before = segment;
  }
  return nodes;
}

/**
 * Whether an offset piece travels: not a corner's stall, a wedge of no size,
 * nor a straight run of no length.
 */
export function moving(segment: OffsetSegment | null): segment is OffsetSegment {
  if (!segment) return false;
  if (segment.kind === "line") {
    return Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > 1e-6;
  }
  return (
    Math.abs(segment.to - segment.from) > 1e-9 &&
    (Math.abs(segment.rx) > 1e-9 || Math.abs(segment.ry) > 1e-9)
  );
}

/** The unit direction an offset piece leaves its start or arrives at its end. */
export function offsetHeading(segment: OffsetSegment, atEnd: boolean): Vec2 | null {
  let d: Vec2;
  if (segment.kind === "line") {
    d = { x: segment.to.x - segment.from.x, y: segment.to.y - segment.from.y };
  } else {
    const slope = ellipseSlope(segment, atEnd ? segment.to : segment.from);
    const way = segment.to >= segment.from ? 1 : -1;
    d = { x: slope.x * way, y: slope.y * way };
  }
  const length = Math.hypot(d.x, d.y);
  return length > 1e-9 ? { x: d.x / length, y: d.y / length } : null;
}

/**
 * The most two pieces of one side may disagree about their direction where
 * they meet and still be one smooth run: see `alignAt`.
 */
const SMOOTH_UP_TO = (30 * Math.PI) / 180;

/** How round an ellipse offset must stay, its lesser radius against its greater, to be smoothed. */
const ROUND_ENOUGH = 0.3;

/**
 * Where two offset pieces meet on a run the spine takes without a corner,
 * one direction on both sides of the node.
 *
 * The offset of an arc drawn with contrast is an ellipse about the arc's own
 * centre, and it meets the next piece on the right spot but not in the right
 * direction: the ellipse's slope there leans off the spine's by more the
 * tighter the arc turns against the pen, and a straight run's offset keeps the
 * spine's exactly. Anywhere the join is not level or upright the two differ --
 * by six degrees down the outside of an s where its bowl gives on to the
 * spine, and by nineteen round the inside -- and the outline turned a corner
 * there that nothing in the letter asked for: a spine drawn as a straight band
 * with a facet at each end, the same at the join of a 2's bowl and its
 * diagonal, and at every change of radius round a Serif oval.
 *
 * A pen's true edge runs parallel to the spine, so the node is turned to the
 * straight piece's direction where one of the two is straight, and to the
 * middle of the two where both are curves. Only the handles turn: the points
 * stay, the pieces stay, and so do the nodes at every weight.
 */
function alignAt(
  node: GlyphNode,
  before: OffsetSegment,
  after: OffsetSegment,
  reach?: PenReach,
): void {
  if (!reach) return;
  // Never on an offset that has nearly closed on its own centre, or turned
  // through it: the inside of a turn as tight as the pen. Its slope there is
  // the fold's, and turning a handle into it drew a loop.
  for (const one of [before, after]) {
    if (one.kind !== "ellipse") continue;
    const least = Math.min(Math.abs(one.rx), Math.abs(one.ry));
    const most = Math.max(Math.abs(one.rx), Math.abs(one.ry));
    if (one.rx * one.ry <= 0 || least < most * ROUND_ENOUGH) return;
  }
  const arriving = offsetHeading(before, true);
  const leaving = offsetHeading(after, false);
  if (!arriving || !leaving) return;
  const cross = arriving.x * leaving.y - arriving.y * leaving.x;
  const along = arriving.x * leaving.x + arriving.y * leaving.y;
  if (along <= 0 || Math.abs(Math.atan2(cross, along)) > SMOOTH_UP_TO) return;
  if (Math.abs(cross) < 1e-9) return;
  let way: Vec2;
  if (before.kind === "line" && after.kind === "line") return;
  if (before.kind === "line") way = arriving;
  else if (after.kind === "line") way = leaving;
  else {
    const sum = { x: arriving.x + leaving.x, y: arriving.y + leaving.y };
    const length = Math.hypot(sum.x, sum.y);
    way = { x: sum.x / length, y: sum.y / length };
  }
  const point = node.point;
  /*
   * Turned no further than moves the piece a fifth of the pen's narrow
   * reach: a handle turned moves the curve behind it by at most four ninths
   * of how far its tip moved, and on a hairline a long handle turned its
   * whole way carried the curve across the other side of the stroke.
   */
  const room = reach.along * 0.2;
  const turned = (handle: Vec2, sign: number): Vec2 => {
    const d = { x: (handle.x - point.x) * sign, y: (handle.y - point.y) * sign };
    const length = Math.hypot(d.x, d.y);
    if (length < 1e-9) return handle;
    const now = Math.atan2(d.y, d.x);
    let by = Math.atan2(way.y, way.x) - now;
    while (by > Math.PI) by -= Math.PI * 2;
    while (by < -Math.PI) by += Math.PI * 2;
    const most = 2 * Math.asin(Math.min(1, room / ((8 / 9) * length)));
    by = Math.max(-most, Math.min(most, by));
    const angle = now + by;
    return {
      x: point.x + Math.cos(angle) * length * sign,
      y: point.y + Math.sin(angle) * length * sign,
    };
  };
  if (node.handleIn) node.handleIn = turned(node.handleIn, -1);
  if (node.handleOut) node.handleOut = turned(node.handleOut, 1);
  if (node.handleIn && node.handleOut) node.type = "smooth";
}

// ---------------------------------------------------------------------------
// Corners
// ---------------------------------------------------------------------------

/*
 * What happens where a stroke changes direction.
 *
 * Everything above assumes the spine runs smoothly, and for a bowl or an arch
 * it does. A diagonal letter does not: an A turns through a hundred and twenty
 * degrees at its apex, and at that turn the two offsets do two different
 * things. On the outside of the turn they pull apart and leave a wedge of
 * nothing; on the inside they cross each other and leave a loop.
 *
 * Neither was handled. The alphabet worked around it by drawing each diagonal
 * as its own stroke, ending both square at the shared point -- which does not
 * fill the wedge, it only stops the loop. At text weight the missing wedge is
 * a fraction of a unit and nobody sees it. At a display weight of 190 units it
 * is a notch you can put your thumb in, and it was in A, M, N, V, W, Y, Z, k,
 * v, w, x, y and z: thirteen letters, every one of them visibly chipped.
 *
 * So the wedge is filled and the loop is cut, and the letters that used to be
 * two strokes meeting at a point become one stroke that turns.
 */

/** Which way a corner turns, and where. */
interface Kink {
  /** The offset run before the corner. */
  before: number;
  /** The offset run after it. */
  after: number;
  at: Vec2;
  /** Positive when the spine turns anticlockwise. */
  turn: number;
}

/**
 * Every place the spine changes direction.
 *
 * A join whose tangents agree is not a corner and is left alone -- which is
 * most of them, since an arch and a bowl are built to run smoothly from one
 * piece to the next.
 */
function kinksOf(headed: Headed[], closed: boolean): Kink[] {
  const found: Kink[] = [];
  const segments = headed.map((one) => one.segment);
  const upTo = closed ? segments.length : segments.length - 1;
  for (let index = 0; index < upTo; index++) {
    const next = (index + 1) % segments.length;
    const leaving = headed[index].end;
    const arriving = headed[next].start;
    const turn = leaving.x * arriving.y - leaving.y * arriving.x;
    const along = leaving.x * arriving.x + leaving.y * arriving.y;
    /*
     * Two pieces heading the same way need nothing between them.
     *
     * Tried the other way twice, and it is written down here because it keeps
     * looking like the fix for the letters that cannot follow the weight axis
     * and keeps not being one. Whether a junction turns depends on which of its
     * pieces travelled, and that is a question about the pen -- so leaving a
     * wedge at every junction, turning or not, ought to steady the node lists.
     *
     * It steadies some and unsteadies others, and the second measurement says
     * so more sharply than the first: the Display comes down from 119 letters
     * left standing to 107, and the Ribbon goes up from 28 to 100 and the
     * Technical from 30 to 64. It is not a fix, it is a face traded for two.
     *
     * Measured a third time once the bowls and the flares had stopped moving,
     * it says the same thing louder: the Display 21 to 5, the Ribbon 1 to 74,
     * the Technical 1 to 36, and the sixteen faces together 76 to 168.
     *
     * And there is a reason it cannot be right, which is worth writing down
     * because it also says what is really going on. A corner that is rounded is
     * three pieces with two junctions and neither of them turns; the same
     * corner left sharp is two pieces with one junction and it does turn. As
     * things are those come to the same three pieces of offset either way,
     * which is why a face that rounds its corners only where the pen leaves
     * room can round some of them and not others and still be drawn with the
     * same nodes at every weight. A wedge at every junction breaks that balance
     * -- five against three -- and the balance is worth more than the corners
     * it leaves ragged.
     *
     * The ragged ones are real, though. A corner whose shorter leg the trim
     * eats whole stops turning, because a piece standing still reports its
     * neighbour's heading, and the Display's brackets and its `\u00ac` lose four
     * nodes at the weights where that happens. Two ways of telling the junction
     * what the leg used to be were built and thrown away: a hair of length put
     * back on the swallowed piece takes the Display 21 to 61, because length is
     * the answer to "does this piece go anywhere" and a great deal downstream
     * asks that and means it; the direction remembered on the piece instead
     * takes it 21 to 58, and restricting that to corners between two lines
     * takes the whole sixteen faces from 76 to 76 -- the brackets, the `\u00ac`, the
     * `\u0431` and the two omegas come off the Display's list and its G family, `\u00e6`,
     * `\u03c2` and `onehalf` go on. Neither is here.
     *
     * A fourth was tried from the other end, at the nodes rather than at the
     * pieces, and it measures the same way. Every corner leaves exactly one
     * piece whichever way it resolves, which is steady; what is not is the
     * nodes either side of that piece. A corner cut back to where its offsets
     * cross has its two neighbours meeting on one point, and `stitch` welds
     * those into a single node; a corner filled with a wedge leaves them a gap
     * apart and keeps both. Which of the two happens is the pen's business.
     * Refusing to weld a corner shut -- so that every corner carries the same
     * nodes however it resolves -- takes the Marker to nothing and the sixteen
     * faces together from 27 to 134, the Ribbon going 0 to 73 and the
     * Technical 1 to 36. The same trade as the first three, and it goes the
     * same way.
     *
     * The gaps are worth knowing about even so, because they say where this
     * lives. Over the whole font 268 joins have one, they run from 6 units to
     * 306, and they are on two faces only: the Marker, whose corners are
     * bevelled, and the Display, whose are round. Every other face welds every
     * corner it has, which is why every other face is off this list.
     *
     * What all four have in common is that each of them picked one answer and
     * made every corner in the font give it, and there is no such answer: a
     * corner cut back and a corner filled are both right, and which is right
     * here depends on the pen. So the fifth does not pick one. The drawn weight
     * picks, per corner, and the other masters read it back -- `folded` in
     * `shapes.ts`, beside the pages the waves and the bowls already keep. That
     * takes the sixteen faces from 1 letter standing to none, and it moves no
     * face at the drawn weight and nothing visible anywhere else, because a
     * master only departs from its own arithmetic at the corners where the two
     * disagree, and on the Marker that was one corner of one letter.
     *
     * Which also says why this list is worth keeping now that it is finished.
     * Three of the four are still true as measurements -- a wedge everywhere
     * does cost 76 to 168, and a hair of length does cost 21 to 61 -- and all
     * of them were the right shape of idea aimed at the wrong half of the
     * problem.
     */
    if (Math.abs(turn) < 1e-9 && along > 0) continue;
    found.push({ before: index, after: next, at: segmentEnd(segments[index]), turn });
  }
  return found;
}

/**
 * Where a curve's offset and a straight one's cross on the inside of a corner
 * between them, and the curve's own parameter there: the crossing nearest the
 * corner that lies on both pieces. Null on the outside, where they part.
 */
function curveCrossing(
  before: OffsetSegment,
  after: OffsetSegment,
): { point: Vec2; t: number } | null {
  const curveFirst = before.kind === "ellipse";
  const arc = (curveFirst ? before : after) as OffsetEllipse;
  const line = (curveFirst ? after : before) as OffsetSegment;
  if (arc.kind !== "ellipse" || line.kind !== "line") return null;
  if (arc.rx <= 1e-9 || arc.ry <= 1e-9) return null;
  const local = (point: Vec2): Vec2 => {
    const turned = rotate({ x: point.x - arc.centre.x, y: point.y - arc.centre.y }, -arc.rotation);
    return { x: turned.x / arc.rx, y: turned.y / arc.ry };
  };
  const a = local(line.from);
  const b = local(line.to);
  const d = { x: b.x - a.x, y: b.y - a.y };
  const qa = d.x * d.x + d.y * d.y;
  const qb = 2 * (a.x * d.x + a.y * d.y);
  const qc = a.x * a.x + a.y * a.y - 1;
  const disc = qb * qb - 4 * qa * qc;
  if (qa < 1e-18 || disc < 0) return null;
  const sweep = arc.to - arc.from;
  const way = sweep >= 0 ? 1 : -1;
  const span = Math.abs(sweep);
  let best: { point: Vec2; t: number; s: number } | null = null;
  for (const sign of [-1, 1]) {
    const s = (-qb + sign * Math.sqrt(disc)) / (2 * qa);
    if (s <= 1e-9 || s >= 1 - 1e-9) continue;
    const t0 = Math.atan2(a.y + d.y * s, a.x + d.x * s);
    let u = ((t0 - arc.from) * way) % (2 * Math.PI);
    if (u < 0) u += 2 * Math.PI;
    if (u <= 1e-9 || u >= span - 1e-9) continue;
    const t = arc.from + u * way;
    // Nearest the corner: the end of the line before it, the start after.
    const near = curveFirst ? s : 1 - s;
    if (!best || near < best.s) best = { point: ellipseAt(arc, t), t, s: near };
  }
  return best ? { point: best.point, t: best.t } : null;
}

export function offsetStart(segment: OffsetSegment): Vec2 {
  return segment.kind === "line" ? segment.from : ellipseAt(segment, segment.from);
}

export function offsetEnd(segment: OffsetSegment): Vec2 {
  return segment.kind === "line" ? segment.to : ellipseAt(segment, segment.to);
}

/**
 * Where two lines cross, and how far along the first that is.
 *
 * `at` is nought at the first line's start and one at its end, so it says which
 * side of a corner this is without anything having to be assumed. Both lines
 * are treated as infinite: at the outside of a corner the crossing is past the
 * end of one and before the start of the other, which is the whole reason it is
 * wanted.
 */
function crossingOf(a: OffsetLine, b: OffsetLine): { point: Vec2; at: number } | null {
  const da = { x: a.to.x - a.from.x, y: a.to.y - a.from.y };
  const db = { x: b.to.x - b.from.x, y: b.to.y - b.from.y };
  const denominator = da.x * db.y - da.y * db.x;
  if (Math.abs(denominator) < 1e-12) return null;
  const dx = b.from.x - a.from.x;
  const dy = b.from.y - a.from.y;
  const t = (dx * db.y - dy * db.x) / denominator;
  return { point: { x: a.from.x + da.x * t, y: a.from.y + da.y * t }, at: t };
}

/**
 * The inside of a corner between two straight offsets turned on a circle
 * rather than brought to a point: `before` and `after` are cut back from
 * where they cross, `at`, by the circle's tangent length, and the arc that
 * touches both there is handed back to stand between them.
 *
 * The radius asked for is `radius`, and the tangent length that takes is
 * radius·tan(τ/2) for a corner turning τ. It is held to under half of either
 * offset's run up to the crossing, so a short leg is never eaten past its
 * start, and the radius comes down with it: a smaller circle, never a
 * different shape. Two pieces whatever the radius, as the stall it stands in
 * for is, so the corner has the same nodes with the same handles at every
 * weight; a circle of no radius is the stall again.
 *
 * Where an offset is the first or last of an open stroke and its end is cut
 * by sliding the corner along the side (a level, plumb or angled cut, see
 * `slides`), `starts` and `stops` are where that corner will stand, and the
 * room is counted from there rather than from where the offset starts or
 * stops: a heavy pen on a narrow vee crosses its inner offsets beyond a level
 * cut, the corner then slides past the crossing, and a circle laid on the
 * offsets as they were had both its ends in what the cut removes -- the two
 * short pieces left crossed each other where the point they stand in for
 * left a spike. Counted from the slid corner the room is nothing there, and
 * the circle is the stall again.
 */
function roundedInside(
  before: OffsetLine,
  after: OffsetLine,
  at: Vec2,
  radius: number,
  starts: Vec2 = before.from,
  stops: Vec2 = after.to,
): OffsetEllipse {
  const unit = (line: OffsetLine): Vec2 => {
    const d = { x: line.to.x - line.from.x, y: line.to.y - line.from.y };
    const length = Math.hypot(d.x, d.y) || 1;
    return { x: d.x / length, y: d.y / length };
  };
  const into = unit(before);
  const outOf = unit(after);
  const cross = into.x * outOf.y - into.y * outOf.x;
  const turn = Math.atan2(Math.abs(cross), dot(into, outOf));
  const way = cross >= 0 ? 1 : -1;
  const slope = Math.tan(turn / 2);
  // How far each offset runs up to the crossing, along itself: none where it starts past it.
  const room =
    0.45 *
    Math.min(
      Math.max(0, (at.x - starts.x) * into.x + (at.y - starts.y) * into.y),
      Math.max(0, (stops.x - at.x) * outOf.x + (stops.y - at.y) * outOf.y),
    );
  const tangent = Math.max(0, Math.min(radius * slope, room));
  const r = slope > 1e-12 ? tangent / slope : 0;
  before.to = { x: at.x - into.x * tangent, y: at.y - into.y * tangent };
  after.from = { x: at.x + outOf.x * tangent, y: at.y + outOf.y * tangent };
  // On the inside of the turn, a radius off the cut-back end of `before`.
  const inward = leftOf(into);
  const centre = { x: before.to.x + inward.x * way * r, y: before.to.y + inward.y * way * r };
  const from = Math.atan2(before.to.y - centre.y, before.to.x - centre.x);
  return {
    kind: "ellipse",
    centre,
    rx: r,
    ry: r,
    rotation: 0,
    from,
    to: from + way * turn,
    pieces: WEDGE_PIECES,
  };
}

/**
 * Where a straight end's cut will leave one side's corner, where that cut is
 * the side's own end node slid along it (see `slides`): the corner
 * `terminalNodes` puts there, asked before the sides are stitched, for
 * `roundedInside` to count its room from. Nothing for an end that does not
 * slide, whose corner is where its side stops.
 */
function slidCorner(
  terminal: Terminal,
  headed: Headed[],
  atEnd: boolean,
  side: number,
  reach: PenReach,
): Vec2 | null {
  if (!slides(terminal, true)) return null;
  const one = atEnd ? headed[headed.length - 1] : headed[0];
  const at = atEnd ? segmentEnd(one.segment) : segmentStart(one.segment);
  const outward = atEnd ? one.end : { x: -one.start.x, y: -one.start.y };
  const corners = terminalNodes(terminal, at, outward, reach, true);
  if (corners.length === 0) return null;
  // The end's left is the stroke's left at its far end and its right at its near end.
  const leftOfEnd = atEnd ? side > 0 : side < 0;
  return (leftOfEnd ? corners[0] : corners[corners.length - 1]).point;
}

/**
 * The outside of a corner: the wedge the two offsets left between them.
 *
 * A round join needs no limit and cannot overshoot, because it is the pen
 * itself sitting at the corner: it is not an approximation of the swept
 * region's boundary, it is that boundary exactly. A bevel takes the chord
 * across it. The miter is handled where the crossing is known, since that is
 * the same crossing that cuts the inside of a corner.
 */
function outerJoin(
  before: OffsetSegment,
  after: OffsetSegment,
  at: Vec2,
  reach: PenReach,
  join: JoinKind,
): OffsetSegment[] {
  const from = offsetEnd(before);
  const to = offsetStart(after);
  /*
   * A corner that needs no wedge still gets one, with nothing in it.
   *
   * Whether a corner is filled is not a property of the letter, it is a
   * property of the pen: a bevel fills none, a round join fills every one, and
   * a miter fills only the ones too sharp to carry to a point. So the same
   * vertex is one piece at one weight and two at the next -- which a variable
   * font cannot join, since it holds one set of outlines and a list of how each
   * point moves, and two weights meet only where they are drawn with the same
   * points. An `M` came off the pen with eighty-two points at the Thin and
   * eighteen at the Regular, its apexes rounded on one side of the miter limit
   * and cut square on the other, and stood in a Thin word at Regular weight.
   *
   * So the wedge is always here and sometimes empty: no width, no sweep, both
   * ends on the same point, adding nothing to the outline and one piece to the
   * count at every weight alike.
   */
  const empty = (at: Vec2): OffsetSegment[] => [
    {
      kind: "ellipse",
      centre: at,
      rx: 0,
      ry: 0,
      rotation: 0,
      from: 0,
      to: 0,
      pieces: WEDGE_PIECES,
    },
  ];
  if (Math.hypot(from.x - to.x, from.y - to.y) < 1e-9) return empty(from);
  if (join === "bevel") return empty(from);

  /*
   * The pen, turned about the corner from one offset to the other.
   *
   * Read in the pen's own frame, because with contrast the pen is an ellipse
   * and the angle that puts a point on it is not the angle that points at it.
   * Dividing each coordinate by its own axis before taking the angle is what
   * turns the second into the first.
   */
  const angleOf = (point: Vec2): number => {
    const local = rotate({ x: point.x - at.x, y: point.y - at.y }, -reach.angle);
    return Math.atan2(local.y / (reach.along || 1e-9), local.x / (reach.across || 1e-9));
  };
  const start = angleOf(from);
  // The short way round. The long way would sweep the pen back through the
  // stroke it just came out of.
  const finish = nearestTurn(start, angleOf(to));
  return [
    {
      kind: "ellipse",
      centre: at,
      rx: reach.across,
      ry: reach.along,
      rotation: reach.angle,
      from: start,
      to: finish,
      pieces: WEDGE_PIECES,
    },
  ];
}

/** A round cap is a half turn, and a half turn is two quarter-turn pieces. */
const CAP_PIECES = 2;

/**
 * How many pieces a corner's wedge is cut into, whatever it turns through.
 *
 * Two, because the short way round between two offsets is at most a half turn
 * and a half turn wants two quarter-turn pieces. Fixed rather than measured so
 * that a wedge turning eighty degrees and one turning a hundred come off the
 * pen with the same nodes -- and so does one turning none at all.
 */
const WEDGE_PIECES = 2;

/**
 * How far a miter may be carried before it is given up on.
 *
 * A stroke that nearly doubles back on itself meets its own other side a very
 * long way off -- half a pen divided by the sine of half the angle, which grows
 * without bound. Past this it is rounded instead, which is what a punchcutter
 * does with a very acute join anyway.
 */
export const MITER_LIMIT = 4;

/**
 * One side of the whole spine, with its corners resolved.
 *
 * Which side of a corner is the outside depends on which way the spine turns:
 * travelling and turning anticlockwise, the left of the direction of travel is
 * the inside of the turn. So one call handles both sides and neither has to
 * know which one it is.
 *
 * `inside` is the radius the inside of a corner is to be rounded by, in font
 * units (`Stroke.inside` times the pen's weight), or nothing. Given, the
 * inside of a corner between two straight pieces is turned on a circle of
 * that radius instead of being cut back to a point: see `roundedInside`.
 * Left out, every corner resolves as it always has. `ends`, given with it on
 * an open stroke, are the stroke's two terminals, for where a slid cut will
 * leave the first and last offsets' corners (see `slidCorner`).
 */
function sideRun(
  headed: Headed[],
  side: number,
  reach: PenReach,
  join: JoinKind,
  closed: boolean,
  inside?: number,
  ends?: { start: Terminal; end: Terminal },
): OffsetSegment[] {
  const offsets = headed.map((one) => ({ ...offsetSegment(one, side, reach) }));
  const filling = new Map<number, OffsetSegment[]>();
  // The first and last pieces that go anywhere, whose far corners an end's cut may move.
  const goes = (one: Headed): boolean =>
    one.segment.kind === "line"
      ? Math.hypot(one.segment.to.x - one.segment.from.x, one.segment.to.y - one.segment.from.y) >
        1e-9
      : Math.abs(one.segment.endAngle - one.segment.startAngle) > 1e-9;
  const cutEnds = ends !== undefined && !closed;
  const firstGoing = cutEnds ? headed.findIndex(goes) : -1;
  const lastGoing = cutEnds ? headed.length - 1 - [...headed].reverse().findIndex(goes) : -1;
  const kinks = kinksOf(headed, closed);
  /*
   * Where rounding the insides, where each inside corner between two straight
   * offsets crosses, asked of the offsets as they come off the pen before any
   * corner has cut them back: by the offset that runs into it and the one
   * that runs out of it, so a rounding can keep short of the corners either
   * side of its own (see `roundedInside`). Nothing asked where the insides
   * are not rounded.
   */
  const crossesAtEnd = new Map<number, Vec2>();
  const crossesAtStart = new Map<number, Vec2>();
  if (inside !== undefined) {
    for (const kink of kinks) {
      const one = offsets[kink.before];
      const other = offsets[kink.after];
      if (one.kind !== "line" || other.kind !== "line") continue;
      const crossing = crossingOf(one, other);
      if (crossing === null || !(crossing.at > 1e-9 && crossing.at < 1 - 1e-9)) continue;
      crossesAtEnd.set(kink.before, crossing.point);
      crossesAtStart.set(kink.after, crossing.point);
    }
  }

  for (const kink of kinks) {
    const before = offsets[kink.before];
    const after = offsets[kink.after];

    /*
     * Which side of the corner this is, decided by where the two offsets cross
     * rather than by which way the spine turned.
     *
     * The turn tells you which side is the outside for a round pen, and for a
     * round pen that is enough. A pen with contrast reaches different distances
     * in different directions, so the two offsets leaving one corner can sit
     * five units and eighteen units away from it, and which of them is the one
     * that overlaps stops following from the turn alone. A k drawn with a
     * narrow pen held at an angle came out with a straight cut clean across it
     * because the wrong side was chosen and then cut back.
     *
     * The crossing answers it directly. Before the end of the run: the two are
     * overlapping and this is the inside, so cut both back to it. Past the end:
     * they are pulling apart and this is the outside, so either carry them out
     * to meet or fill the wedge some other way.
     */
    /*
     * Every corner leaves exactly one piece behind, whichever way it is
     * resolved -- cut back to where the offsets cross, carried out to a point,
     * swallowed whole, or filled with a wedge of pen. Which of those happens is
     * decided by the pen rather than by the letter, so a corner that resolves
     * one way at the Thin resolves another at the Black, and a run that leaves
     * a piece on one path and none on another is a different number of points
     * at the two ends of the axis. See `outerJoin` for what an empty one is.
     */
    const stall = (at: Vec2): OffsetSegment[] => [
      {
        kind: "ellipse",
        centre: at,
        rx: 0,
        ry: 0,
        rotation: 0,
        from: 0,
        to: 0,
        pieces: WEDGE_PIECES,
      },
    ];

    const straight = before.kind === "line" && after.kind === "line";
    const crossing = straight ? crossingOf(before, after) : null;
    // Overlapping: the two offsets cross before either ends, so this is the
    // inside of the turn and both are cut back to where they meet.
    const overlapping = crossing !== null && crossing.at > 1e-9 && crossing.at < 1 - 1e-9;
    // Swallowed whole: nothing can be cut back to a point behind where the run
    // began, so the two come together there and the run gives up its length
    // rather than its shape.
    const swallowed = crossing !== null && crossing.at <= 1e-9;
    const within =
      crossing !== null &&
      Math.hypot(crossing.point.x - kink.at.x, crossing.point.y - kink.at.y) <=
        reach.across * MITER_LIMIT;
    const carried = crossing !== null && crossing.at >= 1 - 1e-9 && join === "miter" && within;

    /*
     * Whether this corner comes to a point, asked of the drawn weight.
     *
     * A corner leaves one piece behind whichever way it resolves, and that has
     * been steady since the corners were built. What is not steady is the nodes
     * either side of it: brought to a point the two offsets end on one spot,
     * which `stitch` welds into a single node, and filled with a wedge they end
     * a pen apart and both stay. Which of those happens follows from where the
     * two offsets cross, and where they cross moves with the pen -- so the
     * Marker's `braceright` had a corner that came to a point at the Regular
     * and was filled at the Black, and 141 nodes at both weights with the
     * corners in different places.
     *
     * Four attempts at this are written into `kinksOf` with what each cost, and
     * every one of them argued about which answer was right everywhere. The
     * answer is that neither is: the drawn weight's is, and the others follow
     * it. Where a master would have filled a corner the drawn weight brought to
     * a point, it carries out to the crossing instead -- which is what a mitred
     * join does, and is held to the same limit, so nothing grows a spike. Where
     * the crossing is past that limit there is nothing to carry out to and the
     * corner is filled, which leaves the letter standing at that weight and is
     * the honest answer.
     */
    const folds = folded(overlapping || swallowed || carried);

    if (folds) {
      // Both are lines wherever a crossing was found, which is the only way
      // any of these are true.
      const point = swallowed && before.kind === "line" ? before.from : crossing?.point;
      if (point && (overlapping || swallowed || within)) {
        /*
         * The inside of the turn rounded, where the stroke asks for it: the
         * two offsets cut back short of where they cross and a circle run
         * between them in place of the stall -- the same two pieces, so the
         * same nodes with the same handles, wherever the pen puts them.
         */
        if (
          inside !== undefined &&
          overlapping &&
          before.kind === "line" &&
          after.kind === "line"
        ) {
          const from =
            ends && kink.before === firstGoing
              ? slidCorner(ends.start, headed, false, side, reach)
              : null;
          const to =
            ends && kink.after === lastGoing
              ? slidCorner(ends.end, headed, true, side, reach)
              : null;
          /*
           * And no further than the corner either side of this one, where that
           * is the inside of a turn too: the offset between the two is cut back
           * to where it crosses there. Counted to the offset's own end instead
           * -- which on a short run lies past that crossing -- a circle laid
           * here reached past it, and the next corner, finding its offsets no
           * longer crossing ahead of their start, swallowed itself, losing its
           * rounding and skewing its edge; on a closed run the inner outline
           * crossed itself. Counted from the crossing rather than from where
           * the corner before cut the offset back, so each of two such corners
           * has the same share of the run between them.
           */
          filling.set(kink.before, [
            roundedInside(
              before,
              after,
              point,
              inside,
              from ?? crossesAtStart.get(kink.before) ?? before.from,
              to ?? crossesAtEnd.get(kink.after) ?? after.to,
            ),
          ]);
          continue;
        }
        before.to = point;
        after.from = point;
        filling.set(kink.before, stall(point));
        continue;
      }
    }

    /*
     * A curve running into a straight piece at a corner: on the inside, cut
     * both back to where their offsets cross, as two straight pieces are. A
     * wedge there is a loop of outline turned back on itself. Where the corner
     * is too slight for the two to cross at all -- the offset of a curve drawn
     * with contrast is not quite the pen's reach -- the straight piece is run
     * from where the curve's offset ends, which is a step of a hair.
     */
    if (!straight && kink.turn * side > 0 && (before.kind === "line" || after.kind === "line")) {
      const cut = curveCrossing(before, after);
      let point: Vec2;
      if (cut) {
        point = cut.point;
        if (before.kind === "line") before.to = point;
        else before.to = cut.t;
        if (after.kind === "line") after.from = point;
        else after.from = cut.t;
      } else if (after.kind === "line") {
        point = offsetEnd(before);
        after.from = point;
      } else {
        point = offsetStart(after);
        (before as OffsetLine).to = point;
      }
      filling.set(kink.before, stall(point));
      continue;
    }

    const wedge = outerJoin(before, after, kink.at, reach, join === "miter" ? "round" : join);
    filling.set(kink.before, wedge);
  }

  const run: OffsetSegment[] = [];
  offsets.forEach((offset, index) => {
    run.push(offset);
    const wedge = filling.get(index);
    if (wedge) run.push(...wedge);
  });
  return run;
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

/** The sine of the steepest a curved end may arrive and still be cut upright. */
const CUT_LEVEL_FROM = 0.4;

/**
 * The line a curved end is cut along when its terminal is `aligned`: level
 * through the end of the spine where the stroke arrives more up and down than
 * across, and plumb where it arrives more across. Nothing for a straight end,
 * which `terminalNodes` slides exactly as it does a level cut.
 */
function alignedCut(headed: Headed[], atEnd: boolean): { axis: "x" | "y"; value: number } | null {
  const order = atEnd ? [...headed].reverse() : headed;
  const last = order.find((one) =>
    one.segment.kind === "line"
      ? Math.hypot(one.segment.to.x - one.segment.from.x, one.segment.to.y - one.segment.from.y) >
        1e-9
      : Math.abs(one.segment.endAngle - one.segment.startAngle) > 1e-9,
  );
  if (last?.segment.kind !== "arc") return null;
  const tip = atEnd ? segmentEnd(last.segment) : segmentStart(last.segment);
  const heading = atEnd ? last.end : last.start;
  // Level unless the curve is nearly running across when it stops: a c whose
  // hook has turned only a little past its crown is still cut level, as every
  // grotesque cuts it, where an f's hook that runs out flat is cut upright.
  return Math.abs(heading.y) >= CUT_LEVEL_FROM * Math.hypot(heading.x, heading.y)
    ? { axis: "y", value: tip.y }
    : { axis: "x", value: tip.x };
}

/**
 * One side of a curved end carried on, or brought back, along its own curve
 * until it meets the line the end is cut along.
 *
 * The side is an offset of the spine's arc -- a circle, or an ellipse under a
 * pen with contrast -- and it is moved along that same curve, so the letter's
 * outline is exactly what it was up to the new end and the cut is a straight
 * line between two points that both lie on it. The outside of a turn reaches
 * further than the spine before it meets the line and the inside stops short,
 * which is what a cut level across a curve is.
 *
 * Drawn in the pieces the side had before it moved, so a side carried past a
 * right angle is not a node more at one weight than at another.
 *
 * The line is level or upright (`axis`), or any line at all given as the
 * points whose `normal` component is `value`: the end of a bowl whose inner
 * side a heft has moved, squared again (see `hefted` in heft.ts).
 */
export function cutAlong(
  run: OffsetSegment[],
  atEnd: boolean,
  cut: { axis: "x" | "y"; value: number } | { normal: Vec2; value: number },
  furthest: number,
): (() => void) | null {
  const order = atEnd ? [...run.keys()].reverse() : [...run.keys()];
  const travels = (one: OffsetSegment): boolean =>
    one.kind === "ellipse"
      ? Math.abs(one.to - one.from) > 1e-9 && (one.rx > 1e-9 || one.ry > 1e-9)
      : Math.hypot(one.to.x - one.from.x, one.to.y - one.from.y) > 1e-9;
  const found = order.findIndex((index) => travels(run[index]));
  if (found < 0) return null;
  const outermost = run[order[found]];
  if (outermost.kind !== "ellipse") return null;
  const off =
    "normal" in cut
      ? (point: Vec2): number => cut.normal.x * point.x + cut.normal.y * point.y - cut.value
      : (point: Vec2): number => (cut.axis === "y" ? point.y : point.x) - cut.value;
  /*
   * Where along a piece the side meets the line, nearest its outer end: `t`
   * is the ellipse's own angle, or the share of the way along a straight.
   */
  const rootIn = (one: OffsetSegment, from: number, to: number, near: number): number | null => {
    const value = (t: number): number =>
      off(
        one.kind === "ellipse"
          ? ellipseAt(one, t)
          : {
              x: one.from.x + (one.to.x - one.from.x) * t,
              y: one.from.y + (one.to.y - one.from.y) * t,
            },
      );
    const steps = 96;
    let best: number | null = null;
    let previous = value(from);
    for (let step = 1; step <= steps; step++) {
      const t0 = from + ((to - from) * (step - 1)) / steps;
      const t1 = from + ((to - from) * step) / steps;
      const here = value(t1);
      if (previous === 0 || previous * here < 0) {
        let a = t0;
        let b = t1;
        let fa = previous;
        for (let pass = 0; pass < 60; pass++) {
          const middle = (a + b) / 2;
          const fm = value(middle);
          if (fa * fm <= 0) b = middle;
          else {
            a = middle;
            fa = fm;
          }
        }
        const root = (a + b) / 2;
        if (best === null || Math.abs(root - near) < Math.abs(best - near)) best = root;
      }
      previous = here;
    }
    return best;
  };
  /*
   * First on the outermost piece itself, carried on past its end or brought
   * back along it; then, where the line lies further back than that piece
   * reaches, on the pieces before it -- the ones the cut passes are left
   * standing where it falls, at no length, so the side keeps its points.
   */
  const sweep = outermost.to - outermost.from;
  const way = Math.sign(sweep);
  const end = atEnd ? outermost.to : outermost.from;
  const start = atEnd ? outermost.from : outermost.to;
  let hit: { at: number; root: number } | null = null;
  const onward = rootIn(outermost, end, end + way * (atEnd ? 1 : -1) * (Math.PI / 3), end);
  const within = rootIn(outermost, start, end, end);
  const pick = [onward, within].filter((one): one is number => one !== null);
  if (pick.length > 0) {
    const root = pick.reduce((a, b) => (Math.abs(a - end) <= Math.abs(b - end) ? a : b));
    hit = { at: found, root };
  } else {
    // Back along the side no further than about a pen: a cut that has to go
    // further than that is not the end of this stroke being squared off.
    let travelled = lengthOf(outermost);
    for (let step = found + 1; step < order.length && !hit && travelled < furthest; step++) {
      const one = run[order[step]];
      if (!travels(one)) continue;
      travelled += lengthOf(one);
      const [from, to] = one.kind === "ellipse" ? [one.from, one.to] : [0, 1];
      const [outer, inner] = atEnd ? [to, from] : [from, to];
      const root = rootIn(one, inner, outer, outer);
      if (root !== null) hit = { at: step, root };
    }
  }
  if (!hit) return null;
  const { at: position, root } = hit;
  return () => {
    const index = order[position];
    const one = run[index];
    let tip: Vec2;
    if (one.kind === "ellipse") {
      const pieces = one.pieces ?? piecesFor(one.to - one.from);
      const moved: OffsetEllipse = atEnd
        ? { ...one, to: root, pieces }
        : { ...one, from: root, pieces };
      run[index] = moved;
      tip = ellipseAt(moved, root);
    } else {
      tip = {
        x: one.from.x + (one.to.x - one.from.x) * root,
        y: one.from.y + (one.to.y - one.from.y) * root,
      };
      run[index] = atEnd
        ? { kind: "line", from: one.from, to: tip }
        : { kind: "line", from: tip, to: one.to };
    }
    // Whatever lay past the cut is left standing on it, at no length.
    for (const other of order.slice(0, position)) {
      const piece = run[other];
      if (piece.kind === "line") run[other] = { kind: "line", from: tip, to: tip };
      else run[other] = { ...piece, centre: tip, rx: 0, ry: 0 };
    }
  };
}

/** How long one side piece is, near enough: an ellipse's by its mean radius. */
export function lengthOf(one: OffsetSegment): number {
  if (one.kind === "line") return Math.hypot(one.to.x - one.from.x, one.to.y - one.from.y);
  return ((one.rx + one.ry) / 2) * Math.abs(one.to - one.from);
}

/** Where one side of a stroke stops, and the unit direction it is travelling there, outward. */
export interface SideEnd {
  at: Vec2;
  dir: Vec2;
}

/**
 * Both sides of a stroke at one of its ends, named in that end's own frame:
 * `left` is the left of the outward heading `terminalNodes` is given -- at
 * the far end the stroke's own left side, at the near end its right.
 */
export interface EndSides {
  left: SideEnd;
  right: SideEnd;
}

/**
 * The pen's round cap on a straight end, carried onto corners that are not
 * where the pen put them.
 *
 * The one affine map that takes the end's middle to the middle of the corners
 * given, the pen's reach across the end (`shift`) to the half of it from
 * there to the left corner, and the pen's reach along the heading (`outward`)
 * to that grown as the end has grown. An affine map takes a cubic to a cubic
 * exactly, so the cap is the same half ellipse on conjugate diameters, in the
 * same pieces with the same handles present -- and on the corners the pen
 * puts there the map is the identity, and the cap is the pen's own.
 */
function carriedCap(
  nodes: GlyphNode[],
  at: Vec2,
  shift: Vec2,
  outward: Vec2,
  left: Vec2,
  right: Vec2,
  scale: number,
): GlyphNode[] {
  const centre = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const half = { x: left.x - centre.x, y: left.y - centre.y };
  const out = { x: outward.x * scale, y: outward.y * scale };
  const det = shift.x * outward.y - shift.y * outward.x;
  const map = (point: Vec2): Vec2 => {
    const d = { x: point.x - at.x, y: point.y - at.y };
    if (Math.abs(det) < 1e-12) return { x: centre.x + d.x, y: centre.y + d.y };
    // How much of `shift` and how much of `outward` make up d, laid on the new pair.
    const across = (d.x * outward.y - d.y * outward.x) / det;
    const along = (shift.x * d.y - shift.y * d.x) / det;
    return {
      x: centre.x + half.x * across + out.x * along,
      y: centre.y + half.y * across + out.y * along,
    };
  };
  return nodes.map((node) => ({
    ...node,
    point: map(node.point),
    handleIn: node.handleIn && map(node.handleIn),
    handleOut: node.handleOut && map(node.handleOut),
  }));
}

/**
 * The nodes that close one end of a stroke, running from the left side across
 * to the right.
 *
 * A slab is not drawn here. A serif is a bar laid over the end of a stroke, and
 * that is how it is made: a separate shape, unioned in afterwards, exactly as
 * one is drawn by hand. Trying to work it into the sweep would mean the sweep
 * had to know about brackets, and the join between bar and stem would have to
 * be solved twice.
 *
 * `sides`, where it is given, is where the two sides actually stop and which
 * way each is going there -- for an end whose sides are not where the pen
 * alone puts them: a bowl's inner side moved by its heft, an arm swelled
 * toward its beak, a curved end tapered. Every branch then takes its corners
 * from there, a slid corner slides the way its side's `dir` says (see
 * `sidesAt`), and what the pen's reach sets -- a round cap's depth, an angled
 * cut's slide -- grows with the end's width. Which branch is taken is still
 * decided by the terminal and the heading alone, so the end has the same
 * nodes either way. Left out, nothing here is drawn any differently from how
 * it always was.
 */
export function terminalNodes(
  terminal: Terminal,
  at: Vec2,
  direction: Vec2,
  reach: PenReach,
  straight = true,
  sides?: EndSides,
): GlyphNode[] {
  const normal = leftOf(direction);
  const shift = reachAlong(normal, reach);
  const left = sides ? sides.left.at : { x: at.x + shift.x, y: at.y + shift.y };
  const right = sides ? sides.right.at : { x: at.x - shift.x, y: at.y - shift.y };
  // Which way each corner slides: its own side's way where the sides are given.
  const leftWay = sides ? sides.left.dir : direction;
  const rightWay = sides ? sides.right.dir : direction;
  // And how much wider the end is than the pen alone makes it.
  const wide = sides ? Math.hypot(shift.x, shift.y) * 2 : 0;
  const scale = wide > 1e-12 ? Math.hypot(left.x - right.x, left.y - right.y) / wide : 1;

  if (terminal.kind === "round" && straight && sides) {
    // The pen's own half turn, drawn below, carried onto the corners given.
    return carriedCap(
      terminalNodes(terminal, at, direction, reach, true),
      at,
      shift,
      reachAlong(direction, reach),
      left,
      right,
      scale,
    );
  }

  if (terminal.kind === "round" && straight) {
    /*
     * A half turn of the pen itself, which with contrast is a half ellipse.
     *
     * The starting angle has to be read in the pen's own frame, which means
     * turning the offset back by the pen's angle -- back, not forward. Turned
     * the wrong way the cap starts somewhere else on the ellipse and does not
     * meet the sides it is supposed to join, and the stroke crosses itself. It
     * showed up only on a face whose pen is held at an angle, because at zero
     * the two are the same.
     */
    const dx = left.x - at.x;
    const dy = left.y - at.y;
    const fromAngle = Math.atan2(
      -dx * Math.sin(reach.angle) + dy * Math.cos(reach.angle),
      dx * Math.cos(reach.angle) + dy * Math.sin(reach.angle),
    );
    return ellipseNodes({
      kind: "ellipse",
      centre: at,
      rx: reach.across,
      ry: reach.along,
      rotation: reach.angle,
      from: fromAngle,
      // Half a turn, taken the way that leaves the stroke rather than re-enters
      // it, which is decided by which side of the direction of travel we are on.
      to: fromAngle - Math.PI,
      /*
       * And two pieces, said rather than worked out: a half turn is exactly
       * two quarter turns, and subtracting pi from a large angle can land a
       * hair over and make `ceil` say three -- a node the next weight along
       * does not have, which a variable font cannot join.
       */
      pieces: CAP_PIECES,
    });
  }

  if (terminal.aligned && !straight && terminal.kind !== "round") {
    // Cut along a line by moving the two sides: see `cutAlong`. The cut is the
    // straight run between where they now stop, and needs no nodes of its own.
    return [];
  }

  if (terminal.kind === "round") {
    /*
     * On a curved end, half an ellipse laid square on the end of the stroke:
     * across from one corner to the other, and out along the way the stroke
     * was going by as far as the pen reaches that way.
     *
     * Not the pen's own half turn, which is right on a straight end and wrong
     * here: held at an angle with contrast, it leaves the corners heading
     * somewhere other than along the sides, and on the hook of a c or the tail
     * of a y the cap folded back over the side it started from. This one
     * leaves both corners running straight on along the stroke, so it meets
     * the sides without a kink -- and on a round pen it is the same half
     * circle the pen's was.
     */
    const k = 0.5523;
    // Laid on the middle of the two corners where the sides are given: see `sides`.
    const centre = sides ? { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } : at;
    const half = sides ? { x: left.x - centre.x, y: left.y - centre.y } : shift;
    const across = {
      x: half.x - direction.x * dot(half, direction),
      y: half.y - direction.y * dot(half, direction),
    };
    const lean = Math.abs(dot(half, direction));
    const outward = reachAlong(direction, reach);
    const depth = Math.max(
      Math.hypot(outward.x, outward.y) * scale,
      lean + Math.hypot(across.x, across.y) * 0.25,
    );
    const tip = { x: centre.x + direction.x * depth, y: centre.y + direction.y * depth };
    const outFrom = (point: Vec2): number =>
      depth - dot({ x: point.x - centre.x, y: point.y - centre.y }, direction);
    return [
      {
        point: left,
        handleIn: null,
        handleOut: {
          x: left.x + direction.x * outFrom(left) * k,
          y: left.y + direction.y * outFrom(left) * k,
        },
        type: "smooth",
      },
      {
        point: tip,
        handleIn: { x: tip.x + across.x * k, y: tip.y + across.y * k },
        handleOut: { x: tip.x - across.x * k, y: tip.y - across.y * k },
        type: "smooth",
      },
      {
        point: right,
        handleIn: {
          x: right.x + direction.x * outFrom(right) * k,
          y: right.y + direction.y * outFrom(right) * k,
        },
        handleOut: null,
        type: "smooth",
      },
    ];
  }

  const flat = Math.abs(direction.y) >= Math.abs(direction.x);
  if ((terminal.level || (terminal.aligned && flat)) && Math.abs(direction.y) > 1e-3) {
    /*
     * Both corners of the cut slid along the stroke until they are level with
     * where it was meant to stop.
     *
     * The two are slid in opposite directions -- one back, one on -- which is
     * why the sweep drops the side node each of them replaces rather than
     * adding them to it. Added, the corner that slid back would be reached and
     * then retraced, and a stroke that doubles over itself is a stroke that
     * has crossed itself as far as anything measuring it can tell.
     */
    const onLine = (point: Vec2, along: Vec2): Vec2 => {
      const way = Math.abs(along.y) > 1e-9 ? along : direction;
      const back = (point.y - at.y) / way.y;
      return { x: point.x - way.x * back, y: at.y };
    };
    /*
     * And the left corner carried on back down the stroke where the cut is to
     * slope: the top of a lowercase stem under a sloped head serif, which falls
     * away to the left along the same line as the flag laid there.
     */
    const sink = terminal.sink ?? 0;
    const sunk = (point: Vec2): Vec2 => ({
      x: point.x - leftWay.x * sink,
      y: point.y - leftWay.y * sink,
    });
    return [
      { point: sunk(onLine(left, leftWay)), handleIn: null, handleOut: null, type: "corner" },
      { point: onLine(right, rightWay), handleIn: null, handleOut: null, type: "corner" },
    ];
  }

  if ((terminal.level || (terminal.aligned && !flat)) && Math.abs(direction.x) > 1e-3) {
    /*
     * A level cut on an arm lying along a line: the corners slid until they
     * stand one above the other, square across the arm. A pen held at an
     * angle otherwise leans the end of every arm with it, and the beak serif
     * laid there -- whose outside is upright -- stood a step proud of one
     * corner of it.
     */
    const plumb = (point: Vec2, along: Vec2): Vec2 => {
      const way = Math.abs(along.x) > 1e-9 ? along : direction;
      const back = (point.x - at.x) / way.x;
      return { x: at.x, y: point.y - way.y * back };
    };
    return [
      { point: plumb(left, leftWay), handleIn: null, handleOut: null, type: "corner" },
      { point: plumb(right, rightWay), handleIn: null, handleOut: null, type: "corner" },
    ];
  }

  if (terminal.kind === "angled" && terminal.angle) {
    /*
     * The cut a nib held at an angle leaves: the two corners slid along the
     * stroke in opposite directions.
     *
     * On a straight end, that is the side's last node moved on or back along
     * the same line. On a curved one it is not: a corner slid back up the
     * tangent lands off the side, with the side's own curve still aimed at
     * where it was, and the hook of a c folded over itself. So a curved end
     * carries one corner on by the whole slide and leaves the other where the
     * side stops -- the same angle, and nothing the side drew is moved.
     */
    const slide = Math.tan((terminal.angle * Math.PI) / 180) * reach.across * scale;
    const move = (point: Vec2, by: number, way: Vec2): Vec2 => ({
      x: point.x + way.x * by,
      y: point.y + way.y * by,
    });
    const [on, back] = straight
      ? [slide, -slide]
      : [Math.max(0, 2 * slide), Math.max(0, -2 * slide)];
    return [
      { point: move(left, on, leftWay), handleIn: null, handleOut: null, type: "corner" },
      { point: move(right, back, rightWay), handleIn: null, handleOut: null, type: "corner" },
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
 * Every segment, and the way it travels.
 *
 * A run of zero length cannot say for itself which way it points -- it is a
 * coordinate written twice, and its tangent is whatever the arithmetic left
 * behind. The U had one: the flat across the bottom is what is left after the
 * two corners have taken their radius, and on a face whose corners are as wide
 * as the letter there is nothing left between them. Its tangent came out as
 * neither direction, the corner test read it as a turn in both directions at
 * once, and it filled the wedge for a corner that was not there.
 *
 * It used to be dropped for that, which fixed the wedge and cost something
 * that only showed up much later: the number of nodes in a letter then depends
 * on which of its runs happen to measure zero, and that moves. A bowl is a
 * rounded rectangle, so a bowl taller than it is wide keeps its side runs and
 * loses its top and bottom; wider, the other way about; exactly square, it is
 * a circle and keeps none of them. Sans o is seven nodes at a Thin, four at
 * the Regular and six at a Bold, for a shape that is the same shape throughout
 * -- which is invisible in a single font and fatal in a varying one, where the
 * movement between two weights is a list of points that moved and there has to
 * be the same list on both sides.
 *
 * So a run of no length is kept and told which way it goes, which is what its
 * neighbours already know: on a rounded rectangle the flat between two corners
 * runs tangent to both, so either of them answers it. Told that, the corner
 * test sees no turn and the wedge does not come back -- and the letter has the
 * same nodes at every weight, a few of them in the same place as each other.
 *
 * Only a segment with no neighbour to ask is dropped, which leaves a spine
 * that goes nowhere at all as nothing, which is what it is.
 */
export interface Headed {
  segment: SpineSegment;
  start: Vec2;
  end: Vec2;
}

function headings(segments: SpineSegment[], closed: boolean): Headed[] {
  const real = segments.filter((segment) => segment.kind !== "arc" || segment.radius > 1e-9);
  const goes = real.map((segment) =>
    segment.kind === "line"
      ? Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > 1e-9
      : Math.abs(segment.endAngle - segment.startAngle) > 1e-9,
  );
  // A spine where nothing travels is not a stroke, however many coordinates it
  // was written with.
  if (!goes.some(Boolean)) return [];

  const headed: Headed[] = real.map((segment) => {
    const { start, end } = tangents(segment);
    return { segment, start, end };
  });
  const settled = [...goes];

  /*
   * Answered from the neighbour before where there is one, because a run of no
   * length is a stroke that arrived and did not leave, and the way it arrived
   * is the way it was going. Walked forwards so a chain of them all take the
   * answer from the last segment that actually travelled.
   */
  const take = (index: number, from: number, at: "start" | "end") => {
    headed[index].start = headed[from][at];
    headed[index].end = headed[from][at];
    settled[index] = true;
  };
  for (let index = 0; index < headed.length; index++) {
    if (settled[index]) continue;
    const before = index === 0 ? (closed ? headed.length - 1 : -1) : index - 1;
    if (before >= 0 && settled[before]) take(index, before, "end");
  }
  // Then backwards, for the ones at the very start of an open spine, which
  // have nothing before them to ask.
  for (let index = headed.length - 1; index >= 0; index--) {
    if (settled[index]) continue;
    const after = index === headed.length - 1 ? (closed ? 0 : -1) : index + 1;
    if (after >= 0 && settled[after]) take(index, after, "start");
  }

  // Nothing should be left -- something travelled, and both walks reach every
  // segment from it -- but a segment with no direction would sweep to a shape
  // with no direction, so it goes rather than being taken on trust.
  return headed.filter((_, index) => settled[index]);
}

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
  const headed = headings(spine.segments, spine.closed);
  if (headed.length === 0) return [];
  const reach = penReach(pen);

  const join = stroke.join ?? "miter";
  const inside = stroke.inside ? stroke.inside * pen.weight : undefined;
  const ends = inside === undefined ? undefined : { start: stroke.start, end: stroke.end };
  let left = sideRun(headed, 1, reach, join, spine.closed, inside, ends);
  let right = sideRun(headed, -1, reach, join, spine.closed, inside, ends);
  /*
   * The soft finishes that move a side, each only where its field asked for
   * it and nothing at all otherwise: a bowl's inner side first, then an end
   * swelled or tapered. In that order, so an end is shaped on the side as it
   * finally lies. Each hands back new runs and leaves the ones it was given
   * as they were, which are kept to say how far a side's end was turned.
   */
  const plainLeft = left;
  const plainRight = right;
  if (stroke.heft) [left, right] = hefted(stroke, headed, left, right, reach);
  const shaped = endsShaped(stroke, headed, left, right, reach);
  if (shaped) ({ left, right } = shaped);
  if (!spine.closed) {
    for (const [terminal, atEnd] of [
      [stroke.start, false],
      [stroke.end, true],
    ] as const) {
      if (!terminal.aligned) continue;
      const cut = alignedCut(headed, atEnd);
      if (!cut) continue;
      /*
       * Both sides or neither: one side carried to the line and the other left
       * where it stopped is a cut slanting across the stroke, and on a short
       * hook it ran across the counter.
       */
      const leftCut = cutAlong(left, atEnd, cut, reach.across * 2.5);
      const rightCut = cutAlong(right, atEnd, cut, reach.across * 2.5);
      if (leftCut && rightCut) {
        leftCut();
        rightCut();
      }
    }
  }

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
    const one: Contour = { nodes: closeRing(stitch(left, reach)), closed: true };
    const other: Contour = { nodes: closeRing(stitch(right, reach)), closed: true };
    const [outside, inside] =
      Math.abs(contourArea(one)) >= Math.abs(contourArea(other)) ? [one, other] : [other, one];
    return [facing(outside, 1), facing(inside, -1)];
  }

  const last = headed[headed.length - 1];
  const first = headed[0];
  /*
   * Whether each end arrives straight, asked the way `endsStraight` asks it:
   * the first piece back from the end that is not a line of no length. A run
   * carries pieces of no length on purpose, and the hook of a c ends on one.
   */
  const arrives = (from: number, step: number): boolean => {
    for (let index = from; index >= 0 && index < headed.length; index += step) {
      const segment = headed[index].segment;
      if (segment.kind !== "line") return false;
      if (Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > 1e-9) break;
    }
    return true;
  };
  const endStraight = arrives(headed.length - 1, -1);
  const startStraight = arrives(0, 1);
  // The ends built on where the sides really stop, where something moved them.
  const sided = stroke.heft !== undefined || shaped !== null;
  const endNodes = terminalNodes(
    stroke.end,
    segmentEnd(last.segment),
    last.end,
    reach,
    endStraight,
    sided ? sidesAt(plainLeft, plainRight, left, right, true, last.end) : undefined,
  );
  const startNodes = terminalNodes(
    stroke.start,
    segmentStart(first.segment),
    { x: -first.start.x, y: -first.start.y },
    reach,
    startStraight,
    sided
      ? sidesAt(plainLeft, plainRight, left, right, false, { x: -first.start.x, y: -first.start.y })
      : undefined,
  );

  /*
   * A slid cut replaces the last node of each side rather than following it,
   * because it is that node moved along the stroke rather than a shape added
   * to the end of it.
   *
   * Two cuts slide, and for a long time only one of them said so. A nib held
   * at an angle slides its corners exactly as a level cut does -- the same two
   * lines of arithmetic, in opposite directions -- and the corner that slides
   * backwards was being added after the side node it stands in for. The
   * outline then ran up the flank, back down the slide, and away across the
   * cut: the retrace this comment warns about, drawn.
   *
   * It showed on the one face that holds its nib at an angle, and on the
   * steepest strokes it draws: a Serif slash with a ten-unit spur off its tip,
   * and the backslash, both Lslashes, the eth and both Oslashes with it. At
   * nineteen of sixty-six weights, which is what made it look like noise in the
   * measurement rather than a shape -- a fold that comes and goes with the
   * weight is a fold whose size is a fraction of a slide that is itself a
   * fraction of the pen.
   */
  let leftNodes = stitch(left, reach);
  let rightNodes = stitch([...right].reverse().map(reverseOffset), reach);
  const levelStart = slides(stroke.start, startStraight);
  const levelEnd = slides(stroke.end, endStraight);
  // Counted against what the sides started with, not against what is left of
  // them: a stroke of one straight run has two nodes a side and both of them
  // are replaced, which is right, and a rule applied one end at a time would
  // have refused the second.
  const replaced = (levelStart ? 1 : 0) + (levelEnd ? 1 : 0);
  if (leftNodes.length >= replaced && rightNodes.length >= replaced) {
    if (levelEnd) {
      leftNodes = leftNodes.slice(0, -1);
      rightNodes = rightNodes.slice(1);
    }
    if (levelStart) {
      leftNodes = leftNodes.slice(1);
      rightNodes = rightNodes.slice(0, -1);
    }
    /*
     * And a corner that slid on past the next node of its side takes that node
     * with it. A curve can begin on a sliver of a piece, kept so every weight
     * has the same points, and a cut across a tilted pen slides its outer
     * corner further than the sliver runs: the edge went out to the corner,
     * back down to the sliver's end and up again across the cut -- an e's
     * bowl, under its bar, with the pen held at -20. Moved, not dropped, so
     * the points stay the same in number; set a hair on from the corner, so
     * the seams do not merge the two.
     */
    if (levelEnd && endNodes.length > 0) {
      const [one, other] = [endNodes[0], endNodes[endNodes.length - 1]];
      overtaken(leftNodes, one, other, last.end, -1);
      overtaken(rightNodes, other, one, last.end, 1);
    }
    if (levelStart && startNodes.length > 0) {
      const on = { x: -first.start.x, y: -first.start.y };
      const [one, other] = [startNodes[0], startNodes[startNodes.length - 1]];
      overtaken(rightNodes, one, other, on, -1);
      overtaken(leftNodes, other, one, on, 1);
    }
  }

  const runs = [leftNodes, endNodes, rightNodes, startNodes];
  /*
   * An end with softened corners has them rounded once the four runs are one
   * outline, found by where each run landed rather than by looking for them.
   */
  let nodes: GlyphNode[];
  if (stroke.start.soft !== undefined || stroke.end.soft !== undefined) {
    const marks: SeamMark[] = [];
    nodes = softCorners(joinedAtSeams(runs, marks), marks, stroke);
  } else {
    nodes = joinedAtSeams(runs);
  }
  /*
   * A level start that keeps a square cut's points begins where a square cut
   * does: on its left corner, which a level cut leaves at the end of the
   * outline. See `Terminal.keepsPoints`.
   */
  const startLeft = startNodes[startNodes.length - 1];
  if (
    levelStart &&
    stroke.start.keepsPoints &&
    stroke.start.soft === undefined &&
    nodes.length > 1 &&
    startLeft !== undefined &&
    nodes[nodes.length - 1] === startLeft
  ) {
    nodes = [startLeft, ...nodes.slice(0, -1)];
  }
  const outline = facing({ nodes, closed: true }, 1);
  return [crowded(spine, pen) ? withoutBackLoops(outline, pen.weight) : outline];
}

/**
 * Where the two sides stop at one end, for `terminalNodes`.
 *
 * Each side's own end point, and the way a corner there slides: the stroke's
 * heading at the end, turned as far as whatever moved the side turned its
 * last travelling piece -- the side as the pen drew it against the side as it
 * now lies. A straight side swelled toward its end slides along itself; a side
 * only moved, as heft moves one, is not turned at all and slides as the plain
 * end does, so a corner does not jump the moment a finish is switched on.
 *
 * At the far end, the stroke's left side is the end's left; at the near end,
 * walked the other way, its right side is.
 */
function sidesAt(
  plainLeft: OffsetSegment[],
  plainRight: OffsetSegment[],
  left: OffsetSegment[],
  right: OffsetSegment[],
  atEnd: boolean,
  outward: Vec2,
): EndSides {
  // The way a side travels as it reaches this end, from its last piece that goes anywhere.
  const travel = (run: OffsetSegment[]): Vec2 | null => {
    for (const one of atEnd ? [...run].reverse() : run) {
      if (moving(one)) return offsetHeading(one, atEnd);
    }
    return null;
  };
  const sideOf = (plain: OffsetSegment[], run: OffsetSegment[]): SideEnd => {
    const point = atEnd ? offsetEnd(run[run.length - 1]) : offsetStart(run[0]);
    const was = travel(plain);
    const now = travel(run);
    if (!was || !now) return { at: { x: point.x, y: point.y }, dir: outward };
    const cos = was.x * now.x + was.y * now.y;
    const sin = was.x * now.y - was.y * now.x;
    const length = Math.hypot(cos, sin) || 1;
    return {
      at: { x: point.x, y: point.y },
      dir: {
        x: (outward.x * cos - outward.y * sin) / length,
        y: (outward.x * sin + outward.y * cos) / length,
      },
    };
  };
  return atEnd
    ? { left: sideOf(plainLeft, left), right: sideOf(plainRight, right) }
    : { left: sideOf(plainRight, right), right: sideOf(plainLeft, left) };
}

/**
 * Whether a spine has a run between two turns shorter than the pen is wide.
 *
 * Every inside corner is trimmed where the two sides meeting at it cross --
 * but only against its own two neighbours. When a run is shorter than the pen,
 * the inside of the corner before it and the corner after it overlap, and the
 * crossing lies past the end of the run: the z of a Black joining script, whose
 * diagonal is shorter than its own stroke is thick, came out with a small loop
 * wound backwards inside it. Asked first because it is cheap and rare; the
 * search for the loop is neither.
 */
function crowded(spine: Spine, pen: Pen): boolean {
  const segments = spine.segments;
  if (segments.length < 3) return false;
  return segments.some((segment, index) => {
    if (index === 0 || index === segments.length - 1 || segment.kind !== "line") return false;
    const length = Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
    return length > 1e-6 && length < pen.weight * 1.5;
  });
}

/** A point along a contour's edge: which edge, and how far along it. */
interface EdgeAt {
  edge: number;
  t: number;
}

/**
 * The outline with the small loops that wind backwards cut out of it.
 *
 * A loop like that is where one side of the stroke has run back over itself;
 * under a non-zero fill it draws nothing the rest of the outline does not
 * already draw, and it is not a shape to anything that reads the outline. Cut
 * at the crossing, with the curves on either side split there so the outline
 * keeps its shape exactly up to the point.
 *
 * Only small ones, and only backwards ones. A stroke that crosses itself on
 * purpose -- the loop of a script l -- winds its loop the same way as the rest
 * of the letter and encloses a real piece of it.
 */
function withoutBackLoops(contour: Contour, weight: number): Contour {
  let nodes = contour.nodes;
  for (let pass = 0; pass < 4 && nodes.length > 3; pass++) {
    const whole = contourArea({ nodes, closed: true });
    const loop = backLoop(nodes, Math.sign(whole), weight * weight * 0.05);
    if (!loop) break;
    nodes = cutLoop(nodes, loop.from, loop.to, loop.at);
  }
  return nodes === contour.nodes ? contour : { ...contour, nodes };
}

const LOOP_STEPS = 12;

function edgeCurve(nodes: GlyphNode[], edge: number): [Vec2, Vec2, Vec2, Vec2] {
  const a = nodes[edge];
  const b = nodes[(edge + 1) % nodes.length];
  return [a.point, a.handleOut ?? a.point, b.handleIn ?? b.point, b.point];
}

function bezierAt([p0, p1, p2, p3]: [Vec2, Vec2, Vec2, Vec2], t: number): Vec2 {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** The first small loop wound against the contour, if there is one. */
function backLoop(
  nodes: GlyphNode[],
  winding: number,
  smallest: number,
): { from: EdgeAt; to: EdgeAt; at: Vec2 } | null {
  const count = nodes.length;
  const points: Vec2[] = [];
  const where: EdgeAt[] = [];
  for (let edge = 0; edge < count; edge++) {
    const curve = edgeCurve(nodes, edge);
    const straight = !nodes[edge].handleOut && !nodes[(edge + 1) % count].handleIn;
    const steps = straight ? 1 : LOOP_STEPS;
    for (let step = 0; step < steps; step++) {
      points.push(bezierAt(curve, step / steps));
      where.push({ edge, t: step / steps });
    }
  }
  const total = points.length;
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  /*
   * The box round each piece, so that two pieces nowhere near each other are
   * passed over with four comparisons instead of four cross products. Two
   * pieces that cross properly each reach into the other's box, so nothing
   * this skips could have been a crossing; the pairs are still asked in the
   * same order, so the first loop found is the same one.
   */
  const boxes = new Float64Array(total * 4);
  for (let k = 0; k < total; k++) {
    const p = points[k];
    const q = points[(k + 1) % total];
    boxes[k * 4] = Math.min(p.x, q.x) - 1e-9;
    boxes[k * 4 + 1] = Math.max(p.x, q.x) + 1e-9;
    boxes[k * 4 + 2] = Math.min(p.y, q.y) - 1e-9;
    boxes[k * 4 + 3] = Math.max(p.y, q.y) + 1e-9;
  }
  /*
   * And the pieces filed in a grid by those boxes, so that each piece is only
   * put beside the few whose boxes can meet its own rather than beside every
   * piece after it: a crowded outline is a few hundred pieces, and asking
   * every pair of them was the most a heavy script letter cost to draw. The
   * ones that can meet are still asked from the nearest on, so the first loop
   * found is the same one.
   */
  let gridX = Infinity;
  let gridY = Infinity;
  let gridRight = -Infinity;
  let gridTop = -Infinity;
  let spans = 0;
  for (let k = 0; k < total; k++) {
    gridX = Math.min(gridX, boxes[k * 4]);
    gridRight = Math.max(gridRight, boxes[k * 4 + 1]);
    gridY = Math.min(gridY, boxes[k * 4 + 2]);
    gridTop = Math.max(gridTop, boxes[k * 4 + 3]);
    spans += boxes[k * 4 + 1] - boxes[k * 4] + (boxes[k * 4 + 3] - boxes[k * 4 + 2]);
  }
  const cell = Math.max(
    (spans / Math.max(total, 1)) * 2,
    Math.max(gridRight - gridX, gridTop - gridY) / 64,
    1e-6,
  );
  const cellOf = (value: number, from: number) => Math.floor((value - from) / cell);
  const columns = total > 0 ? cellOf(gridRight, gridX) + 1 : 0;
  const rows = total > 0 ? cellOf(gridTop, gridY) + 1 : 0;
  const squares = columns * rows;
  const firstIn = new Int32Array(squares + 1);
  for (let k = 0; k < total; k++)
    for (
      let column = cellOf(boxes[k * 4], gridX);
      column <= cellOf(boxes[k * 4 + 1], gridX);
      column++
    )
      for (let row = cellOf(boxes[k * 4 + 2], gridY); row <= cellOf(boxes[k * 4 + 3], gridY); row++)
        firstIn[row * columns + column + 1]++;
  for (let square = 0; square < squares; square++) firstIn[square + 1] += firstIn[square];
  const filed = new Int32Array(squares > 0 ? firstIn[squares] : 0);
  const filling = firstIn.slice(0, squares);
  for (let k = 0; k < total; k++)
    for (
      let column = cellOf(boxes[k * 4], gridX);
      column <= cellOf(boxes[k * 4 + 1], gridX);
      column++
    )
      for (let row = cellOf(boxes[k * 4 + 2], gridY); row <= cellOf(boxes[k * 4 + 3], gridY); row++)
        filed[filling[row * columns + column]++] = k;
  const stamp = new Int32Array(total).fill(-1);
  const near: number[] = [];
  // The area each piece adds round the origin, summed round the outline, and
  // how big those are all together: see where a crossing's areas are had.
  const running = new Float64Array(total + 1);
  let runningSize = 0;
  for (let k = 0; k < total; k++) {
    const p = points[k];
    const q = points[(k + 1) % total];
    const piece = (p.x * q.y - q.x * p.y) / 2;
    running[k + 1] = running[k] + piece;
    runningSize += Math.abs(piece);
  }
  for (let i = 0; i < total; i++) {
    const a = points[i];
    const b = points[(i + 1) % total];
    const left = boxes[i * 4];
    const right = boxes[i * 4 + 1];
    const bottom = boxes[i * 4 + 2];
    const top = boxes[i * 4 + 3];
    near.length = 0;
    for (let column = cellOf(left, gridX); column <= cellOf(right, gridX); column++)
      for (let row = cellOf(bottom, gridY); row <= cellOf(top, gridY); row++) {
        const square = row * columns + column;
        for (let slot = firstIn[square]; slot < firstIn[square + 1]; slot++) {
          const j = filed[slot];
          if (j < i + 2 || stamp[j] === i) continue;
          stamp[j] = i;
          near.push(j);
        }
      }
    near.sort((one, other) => one - other);
    for (const j of near) {
      if (i === 0 && j === total - 1) continue;
      if (
        boxes[j * 4] > right ||
        boxes[j * 4 + 1] < left ||
        boxes[j * 4 + 2] > top ||
        boxes[j * 4 + 3] < bottom
      )
        continue;
      const c = points[j];
      const d = points[(j + 1) % total];
      const d1 = side(a, b, c);
      const d2 = side(a, b, d);
      const d3 = side(c, d, a);
      const d4 = side(c, d, b);
      if (!(d1 * d2 < 0 && d3 * d4 < 0)) continue;
      const s = d3 / (d3 - d4);
      const at = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
      const u = d1 / (d1 - d2);
      // The two ways round from one crossing to the other; the loop is the
      // smaller of them.
      /*
       * Most crossings a crowded outline makes are the loops it means, and are
       * passed over on their area alone, as are the touches where a round join
       * stacks its points. So both areas are first had roughly, from running
       * sums round the outline, with a bound on how far that can be from
       * adding them up in order; where the smaller is plainly too big to be a
       * loop to take out, or plainly nothing, that is the answer adding them
       * up would give.
       */
      const headIn = (at.x * points[(i + 1) % total].y - points[(i + 1) % total].x * at.y) / 2;
      const tailIn = (points[j].x * at.y - at.x * points[j].y) / 2;
      const headOut = (at.x * points[(j + 1) % total].y - points[(j + 1) % total].x * at.y) / 2;
      const tailOut = (points[i].x * at.y - at.x * points[i].y) / 2;
      const roughIn = headIn + (running[j] - running[i + 1]) + tailIn;
      const roughOut = headOut + (running[total] - running[j + 1]) + running[i] + tailOut;
      const slack =
        8 *
          (total + 4) *
          Number.EPSILON *
          (runningSize +
            Math.abs(headIn) +
            Math.abs(tailIn) +
            Math.abs(headOut) +
            Math.abs(tailOut)) +
        1e-9;
      const rough = Math.min(Math.abs(roughIn), Math.abs(roughOut));
      if (rough > smallest + slack || rough + slack < 0.01) continue;
      /*
       * Each way round is the crossing and then the points from one piece
       * to the other, and its area is added up in that order. Added up where
       * the points lie rather than copied into a list first.
       */
      const area = (from: number, count: number): number => {
        let sum = 0;
        let p = at;
        for (let k = 0; k < count; k++) {
          const q = points[(from + k) % total];
          sum += (p.x * q.y - q.x * p.y) / 2;
          p = q;
        }
        return sum + (p.x * at.y - at.x * p.y) / 2;
      };
      const inside = area(i + 1, j - i);
      const outside = area(j + 1, total - j + i);
      const smaller = Math.abs(inside) <= Math.abs(outside);
      const [loop, first, second] = smaller ? [inside, i, j] : [outside, j, i];
      // Nothing enclosed is nothing to take out: the points a round join
      // stacks on one spot touch rather than loop.
      if (Math.abs(loop) >= smallest || Math.abs(loop) < 0.01) continue;
      // Wound with the letter, it is only dead weight if the rest of the
      // outline covers it anyway -- a twist in the side, not a loop of ink.
      if (Math.sign(loop) === winding) {
        const inner = [at, ...points.slice(i + 1, j + 1)];
        const outer = [at, ...points.slice(j + 1), ...points.slice(0, i + 1)];
        const [ring, rest] = smaller ? [inner, outer] : [outer, inner];
        if (!within(rest, middleOf(ring))) continue;
      }
      const fractionOf = (index: number, share: number): EdgeAt => {
        const here = where[index];
        const next = where[(index + 1) % total];
        const end = next.edge === here.edge ? next.t : 1;
        return { edge: here.edge, t: here.t + (end - here.t) * share };
      };
      const shares = first === i ? [s, u] : [u, s];
      return { from: fractionOf(first, shares[0]), to: fractionOf(second, shares[1]), at };
    }
  }
  return null;
}

function middleOf(ring: Vec2[]): Vec2 {
  const sum = ring.reduce((total, p) => ({ x: total.x + p.x, y: total.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / ring.length, y: sum.y / ring.length };
}

function within(ring: Vec2[], point: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

/** Split a cubic at t: the curve before and the curve after. */
function split(
  [p0, p1, p2, p3]: [Vec2, Vec2, Vec2, Vec2],
  t: number,
): [[Vec2, Vec2, Vec2, Vec2], [Vec2, Vec2, Vec2, Vec2]] {
  const lerp = (p: Vec2, q: Vec2) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const a = lerp(p0, p1);
  const b = lerp(p1, p2);
  const c = lerp(p2, p3);
  const d = lerp(a, b);
  const e = lerp(b, c);
  const f = lerp(d, e);
  return [
    [p0, a, d, f],
    [f, e, c, p3],
  ];
}

/**
 * The nodes with everything between two crossing points taken out, going
 * forwards from the first to the second, and the outline pinched to the point
 * where they cross.
 *
 * The nodes inside the loop are not dropped but gathered onto that point, so
 * the outline keeps as many nodes as it had, each with the handles it had.
 * The loop only opens at some weights: the z of a Ribbon has it at the Black
 * and not at the Regular, and a variable font can only carry a letter across
 * the axis when every master has the same nodes -- dropped, the z stood still.
 */
function cutLoop(nodes: GlyphNode[], from: EdgeAt, to: EdgeAt, at: Vec2): GlyphNode[] {
  const count = nodes.length;
  const straight = (edge: number) => !nodes[edge].handleOut && !nodes[(edge + 1) % count].handleIn;
  const [before] = split(edgeCurve(nodes, from.edge), from.t);
  const [, after] = split(edgeCurve(nodes, to.edge), to.t);
  const inside = (to.edge - from.edge + count) % count;
  if (inside === 0) return nodes;
  const kept = nodes.map((node) => ({ ...node }));
  const first = (from.edge + 1) % count;
  const last = to.edge;
  const onto = (handle: Vec2 | null): Vec2 | null => (handle ? { ...at } : null);
  for (let step = 0; step < inside; step++) {
    const index = (first + step) % count;
    const node = kept[index];
    node.point = { ...at };
    node.handleIn =
      index === first ? (straight(from.edge) ? null : before[2]) : onto(node.handleIn);
    node.handleOut = index === last ? (straight(to.edge) ? null : after[1]) : onto(node.handleOut);
  }
  kept[from.edge].handleOut = straight(from.edge) ? null : before[1];
  kept[(to.edge + 1) % count].handleIn = straight(to.edge) ? null : after[2];
  return kept;
}

/**
 * Moves each node of a side that a slid corner has passed -- lying further out
 * past the end than the corner -- to just inside the corner, as a corner.
 * Only where the side, carrying on from those nodes, crosses back over the cut
 * between `corner` and `across`: a node a hair past the corner whose edge
 * meets the cut at the corner itself is no fold, and is left where it is.
 * `step` walks the side from the node next to the corner: -1 from its last,
 * 1 from its first.
 */
function overtaken(
  side: GlyphNode[],
  corner: GlyphNode,
  across: GlyphNode,
  outward: Vec2,
  step: 1 | -1,
): void {
  const length = Math.hypot(outward.x, outward.y);
  if (length < 1e-9) return;
  const out = { x: outward.x / length, y: outward.y / length };
  const beyondOf = (point: Vec2): number =>
    (point.x - corner.point.x) * out.x + (point.y - corner.point.y) * out.y;
  // How many nodes, counted from the corner, lie past it.
  let passed = 0;
  while (passed < side.length - 1) {
    const index = step === 1 ? passed : side.length - 1 - passed;
    if (beyondOf(side[index].point) <= 0) break;
    passed++;
  }
  if (passed >= side.length - 1) return;
  const from = (count: number): number => (step === 1 ? count : side.length - 1 - count);
  if (passed > 0) {
    if (
      !crosses(side[from(passed - 1)].point, side[from(passed)].point, corner.point, across.point)
    )
      return;
    const HAIR = 0.01;
    for (let count = 0; count < passed; count++) {
      const index = from(count);
      const node = side[index];
      const beyond = beyondOf(node.point);
      const shift = {
        x: -out.x * (beyond + HAIR * (count + 1)),
        y: -out.y * (beyond + HAIR * (count + 1)),
      };
      const toCorner = { x: corner.point.x - node.point.x, y: corner.point.y - node.point.y };
      const along = toCorner.x * out.y - toCorner.y * out.x;
      // Across as well as back: onto the corner's line along the stroke.
      const place = (p: Vec2): Vec2 => ({
        x: p.x + shift.x + out.y * along,
        y: p.y + shift.y - out.x * along,
      });
      // A corner, as the cut's own are: carried with it, its handles loop.
      side[index] = {
        ...node,
        point: place(node.point),
        handleIn: null,
        handleOut: null,
        type: "corner",
      };
    }
  }
  /*
   * And a curve between the corner and the first node inside it that dips
   * back out past the cut before it turns up the side: the edge of a tilted
   * pen can run backwards for a moment as a curve begins, and a handle drawn
   * along it points out past the cut. Such handles are laid no further out
   * than their own nodes.
   */
  const levelled = (point: Vec2, handle: Vec2 | null): Vec2 | null => {
    if (!handle) return handle;
    const further = beyondOf(handle) - Math.min(0, beyondOf(point));
    return further > 0 ? { x: handle.x - out.x * further, y: handle.y - out.y * further } : handle;
  };
  for (let count = 0; count <= passed; count++) {
    const index = from(count);
    const near = count === 0 ? corner : side[from(count - 1)];
    const node = side[index];
    const leaving = count === 0 ? null : step === 1 ? near.handleOut : near.handleIn;
    const arriving = step === 1 ? node.handleIn : node.handleOut;
    if (!dipsPast(near.point, leaving, arriving, node.point, corner.point, across.point)) continue;
    const arrived = levelled(node.point, arriving);
    side[index] = step === 1 ? { ...node, handleIn: arrived } : { ...node, handleOut: arrived };
    if (count > 0) {
      const left = levelled(near.point, leaving);
      side[from(count - 1)] =
        step === 1 ? { ...near, handleOut: left } : { ...near, handleIn: left };
    }
  }
}

/** Whether a curve, flattened, crosses the segment from `c` to `d`. */
function dipsPast(
  from: Vec2,
  leaving: Vec2 | null,
  arriving: Vec2 | null,
  to: Vec2,
  c: Vec2,
  d: Vec2,
): boolean {
  const one = leaving ?? from;
  const two = arriving ?? to;
  let before = from;
  for (let k = 1; k <= 16; k++) {
    const t = k / 16;
    const u = 1 - t;
    const point = {
      x: u * u * u * from.x + 3 * u * u * t * one.x + 3 * u * t * t * two.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * one.y + 3 * u * t * t * two.y + t * t * t * to.y,
    };
    if (crosses(before, point, c, d)) return true;
    before = point;
  }
  return false;
}

/** Whether the segment from `a` to `b` crosses the one from `c` to `d`, strictly. */
function crosses(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const turn = (p: Vec2, q: Vec2, r: Vec2): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
}

/**
 * Whether a terminal's cut is the side's own end node moved, rather than a
 * shape added on after it.
 *
 * The two that move are a level cut and an angled one on a straight end, and
 * they are never the same terminal: `level` is only ever put on a butt or a
 * slab, and an angled nib is neither. An angled cut on a curve adds its moved
 * corner after the side instead -- see `terminalNodes`.
 */
function slides(terminal: Terminal, straight: boolean): boolean {
  if (terminal.kind === "round") return false;
  if (terminal.level === true) return true;
  if (terminal.aligned === true) return straight;
  return straight && terminal.kind === "angled" && Boolean(terminal.angle);
}

/**
 * A contour wound the way the rest of the letter is wound.
 *
 * This matters more than it sounds. A letter is drawn as overlapping strokes --
 * the stem of a b and the bowl of a b are two of them, and they are meant to
 * overlap -- and overlapping shapes are filled by the nonzero rule, which adds
 * up how many times the outline wraps a point. Two shapes wound the same way
 * add. Two wound opposite ways cancel, and where they overlap a hole opens.
 *
 * Which way a swept stroke came out wound was whichever way its spine happened
 * to be written: a stem drawn upwards and a bowl drawn anticlockwise wound
 * against each other. On a face with round bowls the stem meets the bowl at a
 * single point and there is no overlap to cancel, so nothing showed for as long
 * as every bowl was a circle. Squared or narrowed, the bowl gains a flat side
 * that lies along the stem, the overlap becomes an area, and a black slot opens
 * straight down the middle of the letter.
 *
 * The export never saw it, because it fuses everything before writing a file.
 * Only the thing on the screen was wrong, which is the half a designer looks at.
 */
function facing(contour: Contour, want: number): Contour {
  const area = contourArea(contour);
  if (area === 0) return contour;
  return Math.sign(area) === want ? contour : reverseContour(contour);
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
 * The four runs of a stroke's outline, joined where they meet.
 *
 * A stroke is a side, an end, the other side and the other end, and each of
 * the four ends where the next begins: a butt terminal puts its two corners
 * exactly where the offset sides already stop. Without this every stroke would
 * carry four duplicate nodes, harmless to look at but written into the file
 * and reported by the checks as points that go nowhere.
 *
 * Only where they meet, and that is the point. This used to walk the whole
 * outline dropping any point that landed on the one before it, which took the
 * seams and also took something else: a run of no length in the spine sweeps
 * to a node exactly on its neighbour, and dropping that makes the number of
 * nodes in a letter depend on which of its runs happen to measure zero. A bowl
 * exactly as wide as it is tall is a circle and has none, so a D came back with
 * six nodes at the weight where its bowl is round and ten either side of it --
 * for a shape that is the same shape all the way along. That is invisible in
 * one font and fatal in a varying one, where the movement between two weights
 * is a list of points that moved and both sides have to have the same list.
 *
 * Handed `marks`, it also says where each run landed: for every run, in order,
 * the index in the joined outline of the node its first node became -- itself,
 * or the node it was welded into -- and of its last. A run with no nodes is
 * marked -1 at both. Nothing else about the joining changes.
 */
export function joinedAtSeams(runs: GlyphNode[][], marks?: SeamMark[]): GlyphNode[] {
  const nodes: GlyphNode[] = [];
  for (const run of runs) {
    if (run.length === 0) {
      marks?.push({ first: -1, last: -1 });
      continue;
    }
    const previous = nodes[nodes.length - 1];
    const joining = run[0];
    if (
      previous &&
      Math.hypot(previous.point.x - joining.point.x, previous.point.y - joining.point.y) < 1e-6
    ) {
      previous.handleOut = joining.handleOut ?? previous.handleOut;
      const first = nodes.length - 1;
      nodes.push(...run.slice(1));
      marks?.push({ first, last: nodes.length - 1 });
      continue;
    }
    const first = nodes.length;
    nodes.push(...run);
    marks?.push({ first, last: nodes.length - 1 });
  }
  // And where the last run meets the first, which is the same seam once round.
  if (nodes.length > 1) {
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (Math.hypot(first.point.x - last.point.x, first.point.y - last.point.y) < 1e-6) {
      first.handleIn = last.handleIn ?? first.handleIn;
      nodes.pop();
      // The node that went is the first one now.
      if (marks) {
        const gone = nodes.length;
        for (const mark of marks) {
          if (mark.first === gone) mark.first = 0;
          if (mark.last === gone) mark.last = 0;
        }
      }
    }
  }
  return nodes;
}

/** Where one run landed in a joined outline: see `joinedAtSeams`. */
export interface SeamMark {
  first: number;
  last: number;
}
