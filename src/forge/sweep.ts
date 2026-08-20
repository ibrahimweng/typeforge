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
function kinksOf(segments: SpineSegment[], closed: boolean): Kink[] {
  const found: Kink[] = [];
  const upTo = closed ? segments.length : segments.length - 1;
  for (let index = 0; index < upTo; index++) {
    const next = (index + 1) % segments.length;
    const leaving = tangents(segments[index]).end;
    const arriving = tangents(segments[next]).start;
    const turn = leaving.x * arriving.y - leaving.y * arriving.x;
    const along = leaving.x * arriving.x + leaving.y * arriving.y;
    if (Math.abs(turn) < 1e-9 && along > 0) continue;
    found.push({ before: index, after: next, at: segmentEnd(segments[index]), turn });
  }
  return found;
}

function offsetStart(segment: OffsetSegment): Vec2 {
  return segment.kind === "line" ? segment.from : ellipseAt(segment, segment.from);
}

function offsetEnd(segment: OffsetSegment): Vec2 {
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
  if (Math.hypot(from.x - to.x, from.y - to.y) < 1e-9) return [];
  if (join === "bevel") return [];

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
  let start = angleOf(from);
  let finish = angleOf(to);
  // The short way round. The long way would sweep the pen back through the
  // stroke it just came out of.
  while (finish - start > Math.PI) finish -= Math.PI * 2;
  while (finish - start < -Math.PI) finish += Math.PI * 2;
  return [
    {
      kind: "ellipse",
      centre: at,
      rx: reach.across,
      ry: reach.along,
      rotation: reach.angle,
      from: start,
      to: finish,
    },
  ];
}

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
 */
function sideRun(
  segments: SpineSegment[],
  side: number,
  reach: PenReach,
  join: JoinKind,
  closed: boolean,
): OffsetSegment[] {
  const offsets = segments.map((segment) => ({ ...offsetSegment(segment, side, reach) }));
  const filling = new Map<number, OffsetSegment[]>();

  for (const kink of kinksOf(segments, closed)) {
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
    if (before.kind === "line" && after.kind === "line") {
      const crossing = crossingOf(before, after);
      if (crossing && crossing.at > 1e-9 && crossing.at < 1 - 1e-9) {
        before.to = crossing.point;
        after.from = crossing.point;
        continue;
      }
      if (
        crossing &&
        crossing.at >= 1 - 1e-9 &&
        join === "miter" &&
        Math.hypot(crossing.point.x - kink.at.x, crossing.point.y - kink.at.y) <=
          reach.across * MITER_LIMIT
      ) {
        before.to = crossing.point;
        after.from = crossing.point;
        continue;
      }
      if (crossing && crossing.at <= 1e-9) {
        // The whole run is swallowed by the corner. Nothing can be cut back to
        // a point behind where the run began, so the two are brought together
        // at that point and the run gives up its length rather than its shape.
        before.to = before.from;
        after.from = before.from;
        continue;
      }
    }

    const wedge = outerJoin(before, after, kink.at, reach, join === "miter" ? "round" : join);
    if (wedge.length > 0) filling.set(kink.before, wedge);
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
 * The segments that actually go somewhere.
 *
 * A run of zero length is not a shape, it is a coordinate written twice, and
 * its direction of travel is whatever the arithmetic happened to leave behind.
 * The U had one: the flat across the bottom is what is left after the two
 * corners have taken their radius, and on a face whose corners are as wide as
 * the letter there is nothing left between them. It measured zero, its tangent
 * came out as neither direction, and the corner test then read it as a turn in
 * both directions at once and filled the wedge for a corner that was not there.
 *
 * It had been sitting in the alphabet all along doing no visible harm, because
 * until there was corner handling nothing ever asked which way it pointed.
 */
function travelled(segments: SpineSegment[]): SpineSegment[] {
  return segments.filter((segment) =>
    segment.kind === "line"
      ? Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > 1e-9
      : segment.radius > 1e-9 && Math.abs(segment.endAngle - segment.startAngle) > 1e-9,
  );
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
  const segments = travelled(spine.segments);
  if (segments.length === 0) return [];
  const reach = penReach(pen);

  const join = stroke.join ?? "miter";
  const left = sideRun(segments, 1, reach, join, spine.closed);
  const right = sideRun(segments, -1, reach, join, spine.closed);

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
    return [facing(outside, 1), facing(inside, -1)];
  }

  const last = segments[segments.length - 1];
  const first = segments[0];
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

  return [facing({ nodes: dropRepeats(nodes), closed: true }, 1)];
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
