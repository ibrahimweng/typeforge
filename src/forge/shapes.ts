/**
 * How square a shape is, and how tightly it turns.
 *
 * Two ideas, and they are the same idea seen from two sides.
 *
 * A bowl -- the o, the belly of a b, the ring of a zero -- is drawn here as a
 * rectangle with rounded corners rather than as a circle. A circle is the case
 * where the corners are as round as they can get, and a hard-cornered rectangle
 * is the case where they are as square as they can get, and everything between
 * is one number. That number is what separates a geometric face from a square
 * one, and there is no way to reach the second by adjusting a circle.
 *
 * A corner in a stroke -- the apex of an A, the elbow of a k -- is the same
 * number applied to a place where the skeleton turns. At zero it stays a point.
 * Opened up it becomes an arc, and opened far enough the whole letter reads as
 * a ribbon bent round rather than as strokes joined together.
 *
 * Both are built from straight lines and circular arcs and nothing else, which
 * is the condition the rest of this half of the application rests on: those two
 * are the only curves whose offset is exactly the same kind of curve, so the
 * outline is exact at every weight rather than fitted at one and pushed about
 * at the others.
 *
 * One rule runs through all of it. A stroke cannot turn through a radius
 * tighter than half its own width: at exactly that radius the inside of the
 * turn closes to a point, and past it the inner edge passes through itself.
 * Rather than let that happen and repair it afterwards, every radius here is
 * held at or above that limit. It is the same rule `strokeLimit` states from
 * the other direction, and it is the whole of why a letter here cannot be
 * spoilt by turning a control up.
 */

import type { Vec2 } from "@/font/types";
import type { Spine, SpineArc, SpineLine, SpineSegment } from "./types";

const at = (x: number, y: number): Vec2 => ({ x, y });
const TAU = Math.PI * 2;

/**
 * How much room a turn is given above the absolute limit.
 *
 * A stroke turning through exactly half its own width has an inner edge of no
 * radius at all: the arc collapses to a point, and the outline comes back with
 * two coordinates written twice where a curve should have been. A figure eight
 * squared off at a hairline weight did exactly that, and the checks read the
 * repeated point as the outline crossing itself, which in a sense it was.
 *
 * A few per cent of clearance costs nothing anyone can see -- at a hundredth of
 * an em it is a fraction of a unit -- and it keeps every arc an arc.
 */
const CLEARANCE = 1.06;

// ---------------------------------------------------------------------------
// Bowls
// ---------------------------------------------------------------------------

/**
 * A bowl, as a closed run: a rectangle with rounded corners.
 *
 * `roundness` runs from nought to one. At one the corners are as round as the
 * shape allows and it is a circle, or a stadium if it is taller than it is
 * wide. Below that the sides straighten out, and at nought it is as square as a
 * stroke of this width can be drawn -- which is not perfectly square, because a
 * stroke cannot turn tighter than half its own width, and that is the one thing
 * this refuses to be argued out of.
 *
 * Written anticlockwise from the rightmost point, which is the direction and
 * the starting place the rest of the alphabet already assumes an o has.
 */
export function bowl(
  centre: Vec2,
  halfWidth: number,
  halfHeight: number,
  roundness: number,
  penHalf: number,
): Spine {
  const [width, height] = holds(halfWidth, halfHeight, penHalf);
  const radius = bowlRadius(width, height, roundness, penHalf);
  return { segments: bowlSegments(centre, width, height, radius), closed: true };
}

/**
 * A bowl no smaller than the pen drawing it can go round.
 *
 * A shape narrower than the pen is not a narrow shape, it is a shape whose
 * inner edge has passed through itself. An s at a display weight asked for one:
 * its two turns are a quarter of the x-height each, and at a pen of two hundred
 * and sixty units that is exactly the radius, so the counter closed to nothing
 * and the outline crossed. Narrowed as well, it went past nothing.
 *
 * So the shape stops shrinking and the letter grows a little instead, which is
 * what somebody watching wants: the parts that have reached their limit stay
 * visible rather than turning themselves inside out.
 */
function holds(halfWidth: number, halfHeight: number, penHalf: number): [number, number] {
  const least = penHalf * CLEARANCE;
  return [Math.max(halfWidth, least), Math.max(halfHeight, least)];
}

/**
 * The part of a bowl between two directions, as an open run.
 *
 * A c is an o with its right side missing, and it should be missing the same
 * amount whether the o is round or square. So the cut is made along a ray from
 * the centre at the angle asked for, which on a circle is the angle itself and
 * on a squared bowl is the nearest thing to it that still means the same to the
 * eye.
 *
 * Angles are in degrees, measured the usual way, and the run travels
 * anticlockwise from the first to the second.
 */
export function bowlBetween(
  centre: Vec2,
  halfWidth: number,
  halfHeight: number,
  roundness: number,
  penHalf: number,
  fromDegrees: number,
  toDegrees: number,
): Spine {
  const [width, height] = holds(halfWidth, halfHeight, penHalf);
  const loop = bowlSegments(centre, width, height, bowlRadius(width, height, roundness, penHalf));
  const start = ((fromDegrees % 360) + 360) % 360;
  const span = Math.min(360, Math.max(0, toDegrees - fromDegrees));
  const finish = start + span;

  /*
   * How far round the loop each piece begins, added up as the loop is walked
   * rather than read off each piece's own endpoints.
   *
   * Read off the endpoints, a piece that ends where it began cannot say
   * whether it went nowhere or all the way round -- and the two halves of the
   * right edge, which the loop starts and ends with, sit at exactly the same
   * angle. On a bowl that is a true circle both of them measure nothing, so
   * both landed at the same place in the walk and the closing one came out
   * after the arc that should have followed it. Every B, D, P, R, Eth and
   * Thorn collapsed into a wedge.
   *
   * Added up, there is no wrap to guess: the loop runs anticlockwise from
   * wherever it starts to that same angle three hundred and sixty degrees
   * later, and each piece knows where it is in that whether it travels or not.
   */
  const spans = loop.map((segment) => {
    const one = angleOf(centre, segmentStart(segment));
    const other = angleOf(centre, segmentEnd(segment));
    return hasLength(segment) ? (((other - one) % 360) + 360) % 360 : 0;
  });
  const at: number[] = [angleOf(centre, segmentStart(loop[0]))];
  for (const span of spans) at.push(at[at.length - 1] + span);

  /*
   * Every piece the loop has, at every place the walk could put it.
   *
   * Two laps, so a run that crosses the seam the loop happens to start at is
   * not cut in half by it -- and now also so that a piece the run does not
   * reach has a place on both sides of it to be put back into.
   */
  const walk: Array<{ index: number; piece: SpineSegment | null }> = [];
  for (let lap = 0; lap < 2; lap++) {
    for (let index = 0; index < loop.length; index++) {
      const segment = loop[index];
      const from = at[index] + lap * 360;
      const ends = at[index + 1] + lap * 360;
      /*
       * A piece that goes nowhere is in the run or out of it, and there is
       * nothing to cut. Kept at both ends, because a piece that travels and
       * lands across an end is cut and survives there -- so a run that stops
       * exactly on the end has to survive too, or the same shape comes back
       * with one node fewer whenever a bowl happens to be exactly as wide as
       * it is tall.
       *
       * Both ends except when the run is the whole way round, where they are
       * the same end and keeping both would write the piece twice.
       */
      if (from === ends) {
        const room = span < 360 ? from <= finish : from < finish;
        const inside = from >= start && room;
        walk.push({ index, piece: inside ? segment : null });
        continue;
      }
      if (ends <= start || from >= finish) {
        walk.push({ index, piece: null });
        continue;
      }
      let piece: SpineSegment | null = segment;
      if (from < start) piece = cutBefore(piece, centre, start);
      if (piece && ends > finish) piece = cutAfter(piece, centre, finish);
      walk.push({ index, piece });
    }
  }

  const first = walk.findIndex((slot) => slot.piece);
  if (first < 0) return { segments: [], closed: false };
  let last = first;
  while (last + 1 < walk.length && walk[last + 1].piece) last++;

  /*
   * The pieces the run does not reach, put back with no length in them.
   *
   * A run is cut out of the same nine pieces however far round it goes, and how
   * many of them it lands on is not fixed. An `e` at a hairline starts partway
   * along a side and at a text weight one piece further on, partway through the
   * corner after it -- the same shape, seven pieces instead of eight, and every
   * node in the list one place out from the same node in the other. So the `e`
   * came back sixteen nodes at the Regular and eighteen at the Thin, and a
   * weight axis cannot move between the two: it has to leave the letter
   * standing at whichever weight it was drawn at, which is a Regular `e` in a
   * Thin word and nearly four times the ink it should have.
   *
   * So every piece is emitted, and a piece the run does not reach is emitted
   * where the run stops rather than where it sits. Which end it goes to is the
   * end the walk puts it nearer, which is what keeps a piece in the same place
   * in the list however far the run reaches.
   */
  const head = segmentStart(walk[first].piece!);
  const tail = segmentEnd(walk[last].piece!);

  /*
   * Which way the run faces where it stops.
   *
   * A line of no length has no direction of its own and takes its neighbours',
   * which the sweep already does. An arc of no length does have one -- it is
   * the angle it sits at -- and that angle is what the pen offsets along, so an
   * arc standing in for a corner the run never reached has to be given the
   * angle the run faces rather than the angle that corner faces. Given its own,
   * the pen put its node a whole reach off to one side: the `c` at the Black
   * kept its area to the unit and grew a hundred and three units of bounds and
   * advance out of a node with no ink on it.
   */
  const facing = (piece: SpineSegment, end: "start" | "end"): Vec2 | null => {
    if (piece.kind === "arc") {
      if (piece.radius < 1e-9) return null;
      const angle = end === "start" ? piece.startAngle : piece.endAngle;
      return { x: Math.cos(angle), y: Math.sin(angle) };
    }
    const dx = piece.to.x - piece.from.x;
    const dy = piece.to.y - piece.from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return null;
    // Anticlockwise, the left of travel is the inside of the bowl, so the
    // outward normal -- the one an arc's own angle points along -- is the right.
    return { x: dy / length, y: -dx / length };
  };

  /*
   * Read off the first piece of the run that has any length to be read.
   *
   * The pieces of a bowl that measure nothing are exactly the ones a bowl of
   * this shape does not need -- a side of no length between two corners that
   * meet -- and they are as likely to be at the front of a run as anywhere. A
   * `D` at a hairline starts on one, and a direction read off it is no
   * direction at all: every corner the run had not reached collapsed onto the
   * bowl's own centre and took a tenth of the letter's ink with it.
   */
  const along = (from: number, step: number, end: "start" | "end"): Vec2 => {
    for (let slot = from; slot >= first && slot <= last; slot += step) {
      const found = facing(walk[slot].piece!, end);
      if (found) return found;
    }
    return { x: 1, y: 0 };
  };

  /*
   * A piece of no length, and of its own kind: a corner is an arc and sweeps to
   * a node carrying handles, a side is a line and sweeps to a plain corner, and
   * a list that agrees on how many nodes it has and disagrees on which of them
   * are curves is no more use than one that disagrees on both.
   */
  const stall = (where: Vec2, out: Vec2, like: SpineSegment): SpineSegment => {
    if (like.kind === "line") return { kind: "line", from: where, to: where };
    const angle = Math.atan2(out.y, out.x);
    return {
      kind: "arc",
      centre: { x: where.x - like.radius * out.x, y: where.y - like.radius * out.y },
      radius: like.radius,
      startAngle: angle,
      endAngle: angle,
      sweepPositive: like.sweepPositive,
    };
  };

  const outHead = along(first, 1, "start");
  const outTail = along(last, -1, "end");

  const chosen = new Map<number, SpineSegment>();
  for (let index = 0; index < loop.length; index++) {
    if (walk.slice(first, last + 1).some((slot) => slot.index === index)) continue;
    // Of the two places the walk offers this piece, the one nearer the run.
    let where = -1;
    let nearest = Infinity;
    for (let slot = 0; slot < walk.length; slot++) {
      if (walk[slot].index !== index) continue;
      const gap = slot < first ? first - slot : slot - last;
      if (gap < nearest) {
        nearest = gap;
        where = slot;
      }
    }
    chosen.set(
      where,
      where < first ? stall(head, outHead, loop[index]) : stall(tail, outTail, loop[index]),
    );
  }

  const segments: SpineSegment[] = [];
  for (let slot = 0; slot < walk.length; slot++) {
    if (slot >= first && slot <= last) {
      if (walk[slot].piece) segments.push(walk[slot].piece!);
      continue;
    }
    const stalled = chosen.get(slot);
    if (stalled) segments.push(stalled);
  }
  return { segments, closed: false };
}

/**
 * The radius a bowl's corners actually get.
 *
 * Asked for as a fraction: one is as round as the shape can be, zero is as
 * square as the pen can be asked to turn.
 */
export function bowlRadius(
  halfWidth: number,
  halfHeight: number,
  roundness: number,
  penHalf: number,
): number {
  const roundest = Math.min(halfWidth, halfHeight);
  const squarest = Math.min(penHalf * CLEARANCE, roundest);
  return squarest + (roundest - squarest) * Math.min(Math.max(roundness, 0), 1);
}

function bowlSegments(
  centre: Vec2,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): SpineSegment[] {
  const r = Math.min(radius, halfWidth, halfHeight);
  const right = centre.x + halfWidth;
  const left = centre.x - halfWidth;
  const top = centre.y + halfHeight;
  const bottom = centre.y - halfHeight;
  const insideRight = right - r;
  const insideLeft = left + r;
  const insideTop = top - r;
  const insideBottom = bottom + r;

  const quarter = (cx: number, cy: number, from: number, to: number): SpineArc => ({
    kind: "arc",
    centre: at(cx, cy),
    radius: r,
    startAngle: (from * Math.PI) / 180,
    endAngle: (to * Math.PI) / 180,
    sweepPositive: true,
  });
  const run = (from: Vec2, to: Vec2): SpineSegment => ({ kind: "line", from, to });

  /*
   * All nine, including the ones that measure nothing.
   *
   * A bowl is a rounded rectangle: four corners with a run between each pair.
   * Which of those runs has any length depends on the shape -- taller than it
   * is wide, the sides survive and the top and bottom do not; wider, the other
   * way about; exactly square, it is a circle and none of them do.
   *
   * They used to be dropped here, which kept a circle's spine a clean four arcs
   * with no ghosts in it when the skeleton was drawn. The cost only showed up
   * later: the number of nodes in the swept letter follows the number of
   * segments in its spine, so a Sans o came out seven nodes at a Thin, four at
   * the Regular and six at a Bold, for a shape that is the same shape all the
   * way along. Invisible in one font. Fatal in a varying one, where the
   * movement from one weight to the next is a list of points that moved and
   * both sides have to have the same list.
   *
   * So they are kept, and the sweep is told how to point one that goes
   * nowhere. The skeleton overlay drops them for drawing, which is where that
   * concern belongs.
   */
  const segments: SpineSegment[] = [
    run(at(right, centre.y), at(right, insideTop)),
    quarter(insideRight, insideTop, 0, 90),
    run(at(insideRight, top), at(insideLeft, top)),
    quarter(insideLeft, insideTop, 90, 180),
    run(at(left, insideTop), at(left, insideBottom)),
    quarter(insideLeft, insideBottom, 180, 270),
    run(at(insideLeft, bottom), at(insideRight, bottom)),
    quarter(insideRight, insideBottom, 270, 360),
    run(at(right, insideBottom), at(right, centre.y)),
  ];
  return segments;
}

/**
 * Whether a segment goes anywhere at all.
 *
 * An arc needs both a radius and a turn. Asked only for the radius, an arc that
 * begins and ends at the same angle -- which is how a run carries a corner it
 * does not reach -- answered that it went somewhere, and everything that asks a
 * run which piece it starts on got that one: a Slab `c` at its heaviest read
 * its first piece as a curve, and a curve gets no serif, so it lost both of
 * them.
 */
export function hasLength(segment: SpineSegment): boolean {
  return segment.kind === "line"
    ? Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > 1e-9
    : segment.radius > 1e-9 && Math.abs(segment.endAngle - segment.startAngle) > 1e-9;
}

/**
 * A point on a bowl's own centre-line, in a given direction from its middle.
 *
 * For the things that have to leave a bowl from somewhere on it -- the tail of
 * a Q, the leg of an R -- and have to leave from the same place whether the
 * bowl is round or square. Written in terms of the shape rather than of a
 * radius, because on a squared bowl there is no radius to use.
 */
export function bowlPoint(
  centre: Vec2,
  halfWidth: number,
  halfHeight: number,
  roundness: number,
  penHalf: number,
  degrees: number,
): Vec2 {
  const [width, height] = holds(halfWidth, halfHeight, penHalf);
  const loop = bowlSegments(centre, width, height, bowlRadius(width, height, roundness, penHalf));
  const wanted = ((degrees % 360) + 360) % 360;
  for (const segment of loop) {
    const from = angleOf(centre, segmentStart(segment));
    let to = angleOf(centre, segmentEnd(segment));
    if (to <= from) to += 360;
    const reading = wanted < from ? wanted + 360 : wanted;
    if (reading >= from && reading <= to) {
      const point = hit(segment, centre, degrees);
      if (point) return point;
    }
  }
  return centre;
}

/**
 * Which runs a wave is applied to, read off the direction they travel.
 *
 * Not every one of them, because a wave is a decision about a kind of stroke
 * rather than about a letter: an undulating baseline is a set of flat runs
 * gone wavy while the stems stay straight, and a rippled stem is the other way
 * about. Told to do both, everything in the letter moves at once, which is a
 * different face again.
 */
export type WaveAlong = "off" | "flat" | "upright" | "both";

/**
 * A straight run redrawn as a wave.
 *
 * Built from circular arcs rather than from a sine, and that is the whole
 * reason it can be here at all. A sine offsets to something that is not a
 * sine, so a wavy stroke drawn that way would have to be sampled and refitted
 * and would stop being exact at any weight but the one it was fitted at. A
 * chain of arcs, each turning the same amount and each turning the other way
 * from the one before, is tangent-continuous where they meet, looks like a
 * wave, and offsets to another chain of arcs.
 *
 * Whole periods across the run, always. A wave that stops halfway through its
 * last crest lands its endpoint somewhere other than where the recipe put it,
 * and the letter comes apart at the joins; asked for a wavelength that does not
 * divide the run, the nearest one that does is used instead. So the two ends
 * stay exactly where they were and only the middle moves.
 *
 * The one rule holds here too: the arcs are held at half the pen, which caps
 * how deep a wave of a given length can go. Past that the wave flattens rather
 * than folding, so a heavy weight with a short wavelength quietly stops waving
 * instead of tearing.
 */
export function wavy(
  spine: Spine,
  wavelength: number,
  depth: number,
  penHalf: number,
  along: WaveAlong,
  inward: (from: Vec2, to: Vec2) => number = () => 1,
): Spine {
  if (along === "off" || depth <= 0 || wavelength <= 0) return spine;
  const count = spine.segments.length;
  return {
    closed: spine.closed,
    segments: spine.segments.flatMap((segment, index) => {
      if (segment.kind !== "line" || !rides(segment, along)) return [segment];
      const before = index > 0 ? spine.segments[index - 1] : spine.closed ? spine.segments[count - 1] : null;
      const after =
        index < count - 1 ? spine.segments[index + 1] : spine.closed ? spine.segments[0] : null;
      return ripple(
        segment,
        wavelength,
        depth,
        penHalf,
        keeps(segment, before, penHalf, "start"),
        keeps(segment, after, penHalf, "end"),
        inward(segment.from, segment.to) >= 0 ? 1 : -1,
      );
    }),
  };
}

/**
 * How much of a run has to be left straight at one end for the corner there to
 * survive.
 *
 * The sweep cuts the inside of a corner back to where the two offsets cross,
 * and how far back that is grows without bound as the corner sharpens: half a
 * pen over the tangent of half the angle. If the straight run is shorter than
 * that, the cut cannot be made and the crossing survives as a loop. Waving a z
 * end to end left its arms with nine units of straight where the corner into
 * the diagonal needed ten, and the letter folded at a hairline weight.
 *
 * A run that carries straight on into its neighbour, or into an arc it is
 * tangent to, needs nothing: the angle is a straight line and the cut is zero.
 * A free end needs only enough to sit a terminal or a serif on.
 */
function keeps(
  segment: SpineLine,
  neighbour: SpineSegment | null,
  penHalf: number,
  which: "start" | "end",
): number {
  const least = penHalf * 1.5;
  if (!neighbour) return least;
  const mine = heading(segment, which === "start" ? "into" : "outOf");
  const theirs = heading(neighbour, which === "start" ? "outOf" : "into");
  const between = mine.x * theirs.x + mine.y * theirs.y;
  const sinHalf = Math.sqrt(Math.max(0, (1 - between) / 2));
  const cosHalf = Math.sqrt(Math.max(0, (1 + between) / 2));
  if (sinHalf < 1e-6) return least;
  // A fifth over what the cut needs, and half a pen on top, so the crossing
  // lands inside the straight rather than exactly at the end of it.
  return Math.max(least, (penHalf * cosHalf) / sinHalf + penHalf * 0.5);
}

/**
 * Which way a piece points at one of its ends, taken as leaving that end.
 *
 * Both are measured leaving the corner rather than travelling through it, so
 * two pieces that carry straight on point exactly opposite ways and the angle
 * between them is a straight line.
 */
function heading(segment: SpineSegment, sense: "into" | "outOf"): Vec2 {
  if (segment.kind === "line") {
    const from = sense === "into" ? segment.to : segment.from;
    const to = sense === "into" ? segment.from : segment.to;
    return towards(from, to);
  }
  const angle = sense === "into" ? segment.endAngle : segment.startAngle;
  const way = (segment.endAngle >= segment.startAngle ? 1 : -1) * (sense === "into" ? 1 : -1);
  return at(-Math.sin(angle) * way, Math.cos(angle) * way);
}

/** Whether a run travels the way this wave is meant to be applied. */
function rides(segment: SpineLine, along: WaveAlong): boolean {
  if (along === "both") return true;
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return false;
  /*
   * Within about fifteen degrees of the line it is being called flat or upright
   * against, so a slightly leaning arm still counts as an arm and a diagonal
   * does not.
   *
   * Thirty was the first answer and it cannot be one, because how far a run
   * leans is not fixed: a mark is drawn to the ink it leaves, so as the pen
   * fattens it the mark grows wider and shorter and lies flatter. The acute
   * leans at 0.539 of its own length at the Thin and 0.265 at the Black -- it
   * starts a diagonal and ends an arm -- so it rippled at three weights out of
   * four and the letter could not follow the axis.
   *
   * Fifteen is not a rounder number; it is where the gap is. Of the 980 runs
   * this face waves, the ones that ever lie flat top out at 0.099, 0.122,
   * 0.166 and 0.220, and the next value up is 0.309: a real arm barely leans at
   * any weight, and everything between is a diagonal on its way somewhere.
   * Threshold it anywhere in that gap and one run in 980 still crosses it --
   * against 147 at thirty degrees -- and two runs in the whole font stop
   * waving.
   */
  const steep = Math.abs(dy) / length;
  return along === "flat" ? steep <= 0.25 : steep >= 0.968;
}

/**
 * One straight run, as a chain of arcs that alternate which way they bend.
 *
 * The wave rides on one side of the run rather than swinging either side of
 * it, and that is forced rather than chosen. A chain of arcs meeting
 * tangentially can only leave the line it starts on at a turning point of its
 * own -- an arc that sets off along the line is already at its own crest -- so
 * a wave whose two ends are on the line, and tangent to it, has the line as one
 * of its extremes. Which is what a scalloped bar is, and is what the face this
 * was built for actually does: the foot of its B touches the baseline between
 * each hump rather than crossing it.
 *
 * Leaving tangentially is the part that cannot be given up. The sweep cuts a
 * corner back by crossing the two offsets, and where a straight run meets an
 * arc those are a line and an ellipse -- no closed form, and the letter folds.
 * Meeting the straight stub at the same angle it is travelling means there is
 * no corner there to cut.
 */
function ripple(
  segment: SpineLine,
  wavelength: number,
  depth: number,
  penHalf: number,
  keepStart: number,
  keepEnd: number,
  first: number,
): SpineSegment[] {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const whole = Math.hypot(dx, dy);
  if (whole < 1e-9) return [segment];

  /*
   * A straight stub left at each end, and the wave taken through the middle.
   *
   * Everything a stroke does at its ends is a conversation with a straight
   * run: a serif is a bar across one, a square cut is square to one, and a
   * corner is two of them meeting. Waved end to end, a letter loses all three
   * at once -- switching the wave on took every serif off the serif face,
   * because a serif goes on a straight end and there were none left.
   *
   * How long each stub has to be is the corner's business rather than the
   * wave's, so it is worked out from the neighbour and handed in -- and it is
   * given in full, however little that leaves to wave.
   *
   * It used to be held to two fifths of the run apiece, on the reasoning that
   * there would otherwise be nothing left to wave, and the reasoning is right
   * and the conclusion is backwards: where a corner needs more room than that,
   * what should give way is the wave and not the corner. Held back, the corner
   * does not get the room the sweep needs to cut its inside back into, and the
   * cut fails -- the flag of a Cyrillic `б` at the Black came off the pen as
   * two separate blobs with a gap between them, and fusing the letter left a
   * hole nineteen units by thirty where the gap was. The wave is decoration;
   * the corner is the letter.
   *
   * So the stubs take what they ask for, the wave takes what is left, and where
   * that is nothing the wave is still drawn -- as arcs that go nowhere, sitting
   * where the two stubs meet. Which keeps the count the same at every weight,
   * and is the whole reason for the shape of this function.
   */
  const opening = Math.min(keepStart, whole);
  const closing = Math.min(keepEnd, whole - opening);
  const span = Math.max(0, whole - opening - closing);

  /*
   * The wave is a half arc, some number of whole ones, and a half arc back.
   *
   * The two halves are what let it leave the line along the line and return to
   * it the same way. The whole ones in between each carry the stroke from one
   * side of its own turn to the other, so they alternate, and there has to be
   * an odd number of them for the last half to arrive travelling the right way
   * to come back down. A period is two of them.
   */
  /*
   * How many, and the one number in the wave that still moves with the pen.
   *
   * The count is a rounding of the run's own length, and a run's length is not
   * a fixed thing: the letter is drawn wider at the Black, so a run bounded by
   * the letter's edges grows -- a `T` crossbar runs 754 units at the Thin and
   * 822 at the Black -- while a run bounded by two stems shrinks, a `z` arm
   * going 355 to 299. Different runs move different ways by different amounts,
   * so no correction applied here fixes them together. 35 of the 167 runs that
   * carry more than one hump cross a boundary somewhere on the axis, which is
   * 26 letters of the 115 the face still leaves standing.
   *
   * That it cannot be fixed by counting differently is not a guess. Snapping
   * down to the nearest odd instead of to the nearest fixes the `T`, `z`,
   * `four`, `seven` and `numbersign` families and breaks the `Z`, `OE`, `Ш` and
   * `Θ` families -- 20 letters for 12, a boundary moved rather than removed.
   * Sweeping the rounding's phase gets 35 down to 22 at an offset of 0.13,
   * which is a number fitted to this alphabet and nothing else. Counting off
   * whole wavelengths, or half, or a third, all measure worse.
   *
   * And there is a floor under all of it. For a count to hold still it has to
   * be constant across everything its run's length does, and the median run
   * moves 2.37 steps of the current quantisation. Coarsen the step until that
   * fits -- 2.87 times the wavelength -- and every run in the font gets one
   * hump. Stable and no longer a wave.
   *
   * What would fix it is the run's length at one reference weight, which means
   * drawing the letter twice and matching its runs between the two draws. The
   * recipes branch on the pen in a few places -- `one`, `zero` and `Ґ` come out
   * with a different number of runs at different weights -- so the match needs
   * a fallback, and that is a piece of order-dependent state this file does not
   * have yet. It is the only thing left that would work.
   */
  const wanted = Math.max(1, (2 * whole) / wavelength - 2);
  const wholeArcs = Math.max(1, Math.round((wanted - 1) / 2) * 2 + 1);
  const length = (2 * span) / (wholeArcs + 1);

  /*
   * How far each arc turns, worked out from how deep the wave is asked to be.
   *
   * Depth here is the whole swing, crest to line, which is twice what one arc
   * rises over its own half period. Both that and the half period fall out of
   * the turn, and dividing one by the other loses the radius and leaves the
   * tangent of half of it.
   */
  /*
   * A wave with nothing left to wave in is still a wave, drawn on one spot.
   *
   * The stubs above take what their corners ask for, so on a short run under a
   * heavy pen they can take all of it and leave the wave no room at all. What
   * is drawn then is the same arcs, of no size, sitting where the two stubs
   * meet -- which keeps the letter the same number of nodes at every weight,
   * and is the whole reason for the shape of this function.
   *
   * They still have to turn. A piece that goes nowhere takes its neighbour's
   * heading, so a chain of arcs that neither travels nor turns reads to the
   * sweep as one straight run with no corners in it -- no corners, no wedges,
   * and the node count moves again. Two hundredths of a radian each, on a
   * radius of a millionth of a unit, is a turn to the sweep and nothing at all
   * to look at.
   */
  /*
   * How often the stubs take the whole run is worth writing down, because it is
   * more often than it sounds. The flat top of a Cyrillic `б` is 34 units at
   * the Thin and 135 at the Black, and the two corners either side of it ask
   * for 48 per cent of it at the Thin, 97 at the Regular, and 155 at the Black.
   * From a text weight up there is no wave to be had on that run at all -- and
   * that is 161 runs of the font at the Black against none at the Thin.
   */
  /*
   * Unless the opening stub has taken the run down to nothing, in which case
   * the wave is not drawn at all and the run is handed back as it came.
   *
   * A stub of no length is not a straight end; it is no end at all.
   * `endsStraight` walks back past it, finds the wave's own arcs, and reports
   * the run as finishing on a curve -- so the terminal work goes to the curved
   * case, and the flag of a Cyrillic `б` at a text weight came off the pen with
   * a round hook on it, crossing itself. Sharing the run out between the two
   * corners in proportion fixes that end and breaks the other: the corner then
   * gets less room than its cut needs, the cut fails, and a `bracketright` at
   * the same weight folds instead. The corner has to have what it asks for --
   * that is settled, and it is why the stubs are not capped -- so where there
   * is nothing left over for the far end, there is no wave.
   */
  /*
   * Unless the opening stub has taken the run down to nothing, in which case
   * there is no wave at all and the run is handed back as it came.
   *
   * A stub of no length is not a straight end; it is no end at all.
   * `endsStraight` walks back past it, meets the wave's own arcs, and reports
   * the run as finishing on a curve -- so the terminal work goes to the curved
   * case, and the flag of a Cyrillic `б` at a text weight came off the pen with
   * a round hook on it, crossing itself.
   *
   * Two ways past that were measured and neither survives. Sharing the run
   * between the two corners in proportion gives the far end its stub and takes
   * the near one's room away: the cut it needs then fails and a `bracketright`
   * folds instead. Standing the stall at the near end rather than the far one
   * leaves the whole run as one straight stub and fixes both -- and a corner
   * only asks for a lot of room when it has a neighbour, so that end is one the
   * letter does not finish on -- but where both corners want more than the run
   * has, which is a `Z` at two hundred and sixty units of stem, the extra
   * pieces land inside the corner work and the letter folds there instead.
   *
   * So: this case gives up, and the count moves with the pen here and nowhere
   * else in the wave. It is worth 57 letters -- the Wavy reaches 58 left
   * standing with the stall applied here too, against 115 with this line --
   * and none of the three ways of collecting them keeps every letter whole.
   */
  let turn: number;
  let radius: number;
  if (length < 1e-9 && closing < 1e-9) return [segment];
  if (length < 1e-9) {
    /*
     * A wave with nothing left to wave in is drawn as a wave of nothing.
     *
     * The stubs above take what their corners ask for, so on a short run under
     * a heavy pen they can take all of it. That happens to 161 runs at the
     * Black and to none at all at the Thin, which made it the single biggest
     * reason the face could not follow the axis: the same run came off waved at
     * one weight and straight at the next.
     *
     * What is drawn instead is the same arcs, turning nothing, standing where
     * the two stubs meet -- and the radius is the point. Three earlier attempts
     * all gave the stall a radius of nothing and all measured worse than
     * handing the run back straight: arcs turning two hundredths of a radian on
     * a radius of a millionth, 245 letters standing; a ten-thousandth, 245;
     * neither travelling nor turning, 233; against 208 for giving up. An arc of
     * no radius is not an arc to the sweep, which drops it when it collects the
     * headings a corner is worked out from, so the chevron marks lost their
     * apex and the count moved again by another route.
     *
     * The radius here is the smallest one any arc of this wave is ever allowed
     * -- half a pen and the clearance, which is what the cap just below holds
     * every real arc to. So the stall is an arc the sweep can turn, and it
     * turns nothing.
     */
    turn = 0;
    radius = penHalf * CLEARANCE;
  } else {
    /*
     * How far each arc turns, worked out from how deep the wave is asked to be.
     *
     * Depth here is the whole swing, crest to line, which is twice what one arc
     * rises over its own half period. Both that and the half period fall out of
     * the turn, and dividing one by the other loses the radius and leaves the
     * tangent of half of it.
     */
    turn = 2 * Math.atan((2 * depth) / length);
    /*
     * A quarter turn a side and no more, which is a wave of half circles.
     *
     * Past that the centre of the arc crosses to the other side of its own
     * chord and the arc curls back on itself rather than bulging.
     */
    turn = Math.min(turn, Math.PI / 2);
    // Then held so no arc turns tighter than half the pen, which is the same
    // rule everything else here is held to, and caps the depth rather than the
    // wave.
    const most = length / (4 * penHalf * CLEARANCE);
    if (most < 1) turn = Math.min(turn, Math.asin(most));
    /*
     * And however flat that leaves it, it is still drawn as a wave.
     *
     * Under about a degree there is nothing left to see, and a chain of arcs
     * that flat is a slower way of writing a straight line -- so this used to
     * give up and hand the run back straight. How flat the wave is held to is a
     * question about the pen, though, so giving up was one too: the same run
     * rippled at one weight and came off straight at the next. Drawing it
     * forces nothing, since the limit just above still holds every arc to a
     * radius the pen can turn and a flatter arc is a larger radius.
     */
    if (turn < 0.02) return [segment];
    radius = length / (4 * Math.sin(turn));
  }

  const along = at(dx / whole, dy / whole);
  const opens = at(segment.from.x + along.x * opening, segment.from.y + along.y * opening);

  const out: SpineSegment[] = [{ kind: "line", from: segment.from, to: opens }];
  /*
   * Walked rather than placed: each arc leaves where the last one arrived and
   * turns the other way, which is the whole of what makes it a wave. Only the
   * centre has to be worked out, and it is always a right angle from the way
   * the stroke is travelling.
   */
  let where = opens;
  let heading = along;
  for (let index = 0; index < wholeArcs + 2; index++) {
    // The first and last are halves; everything between is a whole.
    const sweep = index === 0 || index === wholeArcs + 1 ? turn : turn * 2;
    /*
     * The first bends toward the side the wave rides on, and every one after
     * it bends back the other way.
     *
     * Except where the wave turns nothing, where they all take the same side.
     * An arc that turns nothing is a point on a circle, and which way it reads
     * as travelling is decided entirely by where its centre is: on one side the
     * tangent is the way the run goes, on the other it is the way the run came
     * from. Alternating them handed the sweep a chain of hairpins standing on
     * one spot, which is worse than either a wave or a straight line -- 224
     * letters left standing against 196 for giving up.
     */
    const side = turn === 0 ? 1 : (index % 2 === 0 ? 1 : -1) * first;
    /*
     * The centre is a right angle from the way the stroke is travelling now,
     * not from the way the run travels.
     *
     * They are the same only for the first arc. By the second the stroke has
     * already turned, and measuring the centre off the run instead left every
     * junction after the first with a kink in it exactly the size of one turn.
     */
    const normal = at(-heading.y, heading.x);
    const centre = at(where.x + normal.x * side * radius, where.y + normal.y * side * radius);
    const startAngle = Math.atan2(where.y - centre.y, where.x - centre.x);
    const endAngle = startAngle + side * sweep;
    out.push({
      kind: "arc",
      centre,
      radius,
      startAngle,
      endAngle,
      /*
       * Which way it bends, and for a stall that has to be said rather than
       * read off the two angles.
       *
       * They are equal where nothing turns, so the comparison answers no every
       * time -- and the sweep offsets an arc inward or outward by this, so a
       * stall that says no where a real arc bending the same way says yes gets
       * offset the other way round and comes off the pen with four more nodes
       * than the wave it is standing in for. A `u` at the Bold read 26 against
       * the 22 it has at every other weight, which is the whole disagreement
       * this is here to end.
       */
      sweepPositive: turn === 0 ? true : endAngle > startAngle,
      /*
       * A half arc in one piece and a whole one in two, always.
       *
       * How far each arc of a wave turns is worked out from how deep the wave
       * is asked to be and then held back so no arc turns tighter than half the
       * pen -- so the turn moves with the weight, and `ceil(sweep / 90 degrees)`
       * steps up as it passes a right angle. A whole arc turns twice what a half
       * one does and can reach a half turn, so two pieces covers it.
       */
      pieces: index === 0 || index === wholeArcs + 1 ? 1 : 2,
    });
    where = at(
      centre.x + radius * Math.cos(endAngle),
      centre.y + radius * Math.sin(endAngle),
    );
    const turned = side * sweep;
    heading = at(
      heading.x * Math.cos(turned) - heading.y * Math.sin(turned),
      heading.x * Math.sin(turned) + heading.y * Math.cos(turned),
    );
  }
  out.push({ kind: "line", from: where, to: segment.to });
  return out;
}

/**
 * The same run with a little taken off each end.
 *
 * For the terminals that reach past where a run stops rather than closing it
 * off. A round cap is a half-disc drawn about the last point of the spine, so
 * a stroke written to the cap line has its ink half a pen above it -- which on
 * a heavy face is most of a hundred units, and put the stems of an H that far
 * over the bar of the T beside it. Pulling the spine back by exactly what the
 * cap will add puts the far side of the disc on the line instead, which is
 * where a rounded stem is meant to stop.
 *
 * Never more than nine tenths of the run, however wide the pen, or a short
 * stroke would be asked to have negative length and come out inside out.
 */
export function shortened(spine: Spine, fromStart: number, fromEnd: number): Spine {
  if (fromStart <= 0 && fromEnd <= 0) return spine;
  const total = spine.segments.reduce((sum, segment) => sum + lengthOf(segment), 0);
  if (total <= 0) return spine;
  const room = total * 0.9;
  const share = fromStart + fromEnd > room ? room / (fromStart + fromEnd) : 1;
  let segments = spine.segments;
  if (fromStart > 0) segments = trimmed(segments, fromStart * share);
  if (fromEnd > 0) {
    segments = trimmed(segments.slice().reverse().map(backwards), fromEnd * share)
      .reverse()
      .map(backwards);
  }
  return { segments, closed: false };
}

/** One piece walked the other way, so the same trimming does both ends. */
function backwards(segment: SpineSegment): SpineSegment {
  return segment.kind === "line"
    ? { ...segment, from: segment.to, to: segment.from }
    : {
        ...segment,
        startAngle: segment.endAngle,
        endAngle: segment.startAngle,
        sweepPositive: !segment.sweepPositive,
      };
}

/**
 * The pieces left after taking a length off the front of the run.
 *
 * Left, not survived: a piece the trim swallows whole is kept and stood on the
 * point the trim stopped at, rather than dropped. How much comes off is the
 * pen's business -- a round cap is pulled back by exactly what the cap will add
 * -- so dropping them made the number of pieces in a spine a question about the
 * weight. A Display `C` came off the pen with nine pieces at the Thin, the
 * Regular and the Black and three at the Bold, and the whole point of a bowl
 * carrying the sides its shape does not need is undone by anything downstream
 * that throws them away again.
 *
 * They are stood at the new head of the run and not at their own ends, because
 * their own ends are inside the part that has just been trimmed off -- put
 * there they would hand the stroke back the length the cap was pulled out of
 * it. And each keeps its own kind: a side stays a line and a corner stays an
 * arc, since a list that agrees on how many nodes it has and disagrees on which
 * of them are curves is no more use than one that disagrees on both.
 */
function trimmed(segments: SpineSegment[], distance: number): SpineSegment[] {
  let left = distance;
  const kept: SpineSegment[] = [];
  const stalled: number[] = [];
  for (const segment of segments) {
    if (left <= 0) {
      kept.push(segment);
      continue;
    }
    const length = lengthOf(segment);
    if (length <= left) {
      left -= length;
      stalled.push(kept.length);
      kept.push(segment);
      continue;
    }
    const part = left / length;
    left = 0;
    if (segment.kind === "line") {
      kept.push({
        ...segment,
        from: at(
          segment.from.x + (segment.to.x - segment.from.x) * part,
          segment.from.y + (segment.to.y - segment.from.y) * part,
        ),
      });
    } else {
      kept.push({
        ...segment,
        startAngle: segment.startAngle + (segment.endAngle - segment.startAngle) * part,
      });
    }
  }
  if (kept.length === 0) return segments;
  if (stalled.length > 0) {
    /*
     * Where the run now begins, and which way it leaves there.
     *
     * Taken from the first piece that still travels, because a piece of no
     * length has no direction of its own -- and an arc standing in for one has
     * to be given the direction the run faces rather than the one it sat at, or
     * the pen offsets it a whole reach off to one side.
     */
    const ahead = kept.slice(stalled[stalled.length - 1] + 1).find(hasLength);
    const head = ahead ? segmentStart(ahead) : segmentEnd(kept[kept.length - 1]);
    const heading = ahead ? headingOf(ahead) : at(1, 0);
    // Anticlockwise, the outward normal is the right of the way it travels.
    const out = at(heading.y, -heading.x);
    for (const index of stalled) kept[index] = stoodStill(kept[index], head, out);
  }
  return kept;
}

/** Which way a piece is travelling where it begins. */
function headingOf(segment: SpineSegment): Vec2 {
  if (segment.kind === "line") {
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const length = Math.hypot(dx, dy) || 1;
    return at(dx / length, dy / length);
  }
  const way = segment.endAngle >= segment.startAngle ? 1 : -1;
  return at(-Math.sin(segment.startAngle) * way, Math.cos(segment.startAngle) * way);
}

/** The same piece, of the same kind, going nowhere at a given point. */
function stoodStill(like: SpineSegment, where: Vec2, out: Vec2): SpineSegment {
  if (like.kind === "line") return { kind: "line", from: where, to: where };
  const angle = Math.atan2(out.y, out.x);
  return {
    ...like,
    centre: at(where.x - like.radius * out.x, where.y - like.radius * out.y),
    startAngle: angle,
    endAngle: angle,
  };
}

/** Where a run begins and where it ends, whichever kind of piece that is. */
/**
 * The first and last pieces of a run that go anywhere.
 *
 * A spine carries pieces of no length on purpose. A bowl holds the sides its
 * own shape does not need so that the same shape has the same number of nodes
 * however round it is, and a run cut out of a bowl holds the pieces it does not
 * reach for the same reason -- which means a run can begin and end on a piece
 * that is a coordinate written twice.
 *
 * Anything that asks a run which way it starts, or whether it starts straight,
 * has to ask a piece that has a direction to give. Asked of the piece that
 * happens to be first, a Slab `c` sized both its serifs on nothing and came out
 * wearing two specks the size of a point.
 */
export function endPieces(spine: Spine): { first: SpineSegment; last: SpineSegment } | null {
  const segments = spine.segments;
  if (segments.length === 0) return null;
  const going = segments.filter(hasLength);
  return going.length > 0
    ? { first: going[0], last: going[going.length - 1] }
    : { first: segments[0], last: segments[segments.length - 1] };
}

/**
 * Whether each end of a run finishes straight.
 *
 * Not the same question as which piece it finishes on. A run carries pieces of
 * no length -- see `endPieces` -- and a piece the trim has eaten whole is still
 * there, standing still and keeping its own kind, because its kind is the
 * shape it was going to be. So an arc the trim swallowed is still a curve, and
 * a run that ends on one ends curved however little of it is left.
 *
 * Asked instead as "is the last piece that goes anywhere a line", the answer
 * moved with the pen. A Slab C is a bowl whose aperture opens as the pen
 * widens -- it has to, or a heavy c fuses shut -- and at the Black the opening
 * had eaten the terminal arc entirely. The run then came off the flat top of
 * the bowl, reported itself straight, and grew the two slab serifs the same
 * letter has at no other weight.
 */
export function endsStraight(spine: Spine): { start: boolean; end: boolean } {
  const segments = spine.segments;
  const straight = (from: number, step: number): boolean => {
    for (let index = from; index >= 0 && index < segments.length; index += step) {
      if (segments[index].kind !== "line") return false;
      if (hasLength(segments[index])) break;
    }
    return true;
  };
  return { start: straight(0, 1), end: straight(segments.length - 1, -1) };
}

export function spineStart(spine: Spine): Vec2 {
  return segmentStart(spine.segments[0]);
}

export function spineEnd(spine: Spine): Vec2 {
  return segmentEnd(spine.segments[spine.segments.length - 1]);
}

/**
 * The same run, walked the other way.
 *
 * Wanted because a bowl is written anticlockwise and half the alphabet wants to
 * travel round one clockwise -- the right-hand side of a B, the lower half of
 * an S. Which way a run travels is not cosmetic: the terminals sit at its two
 * ends, so a run reversed without reversing its pieces puts them on the wrong
 * ones.
 */
export function reversed(spine: Spine): Spine {
  return {
    closed: spine.closed,
    segments: spine.segments
      .slice()
      .reverse()
      .map((segment) =>
        segment.kind === "line"
          ? { ...segment, from: segment.to, to: segment.from }
          : {
              ...segment,
              startAngle: segment.endAngle,
              endAngle: segment.startAngle,
              sweepPositive: !segment.sweepPositive,
            },
      ),
  };
}

// ---------------------------------------------------------------------------
// Rounding a corner
// ---------------------------------------------------------------------------

/**
 * Round off every corner in a run.
 *
 * A corner between two straight runs is replaced by an arc tangent to both,
 * and the two runs are shortened to meet it. Nothing else changes, so the
 * result is still lines and arcs and still offsets exactly.
 *
 * The radius asked for is honoured where it can be. It is held at or above half
 * the pen, because below that the inside of the turn would pass through itself.
 * It is also held below whatever the shorter of the two runs can spare, or the
 * arc would start before the previous corner had finished and the letter would
 * come apart -- an m at a large radius asks for exactly that.
 */
export function roundCorners(spine: Spine, radius: number, penHalf: number): Spine {
  if (radius <= 0 || spine.segments.length < 2) return spine;
  const wanted = Math.max(radius, penHalf * CLEARANCE);

  const out: SpineSegment[] = [];
  const count = spine.segments.length;
  const last = spine.closed ? count : count - 1;

  // Worked on copies: each corner shortens the run before it and the run after
  // it, and the run after it is the run before the next corner.
  const runs: SpineSegment[] = spine.segments.map((segment) => ({ ...segment }));
  const inserts = new Map<number, SpineArc>();
  /*
   * Measured before anything is shortened.
   *
   * Each corner takes a bite out of the run before it and the run after it, and
   * the run after it is the run before the next corner. Read as it goes, the
   * second corner sees a run that the first has already eaten into, and decides
   * on a smaller radius than whoever placed the letter's vertices was expecting
   * -- which is how a w on a face with wide corners came to have its middle peak
   * four hundred units above the x-height. Half of each original run is the
   * budget, so two neighbouring corners can at worst meet in the middle.
   */
  const room = spine.segments.map(lengthOf);

  for (let index = 0; index < last; index++) {
    const next = (index + 1) % count;
    const before = runs[index];
    const after = runs[next];
    if (before.kind !== "line" || after.kind !== "line") continue;

    const vertex = before.to;
    const a = towards(vertex, before.from);
    const b = towards(vertex, after.to);
    const between = a.x * b.x + a.y * b.y;
    if (between > 0.999 || between < -0.999) continue;

    const sinHalf = Math.sqrt(Math.max(0, (1 - between) / 2));
    const cosHalf = Math.sqrt(Math.max(0, (1 + between) / 2));
    const spare = Math.min(room[index], room[next]) * 0.5;
    // How far back along each run the arc has to start, for the radius wanted.
    const back = Math.min((wanted * cosHalf) / sinHalf, spare);
    const r = (back * sinHalf) / cosHalf;
    if (r < penHalf * CLEARANCE * 0.999) continue;

    const touchBefore = at(vertex.x + a.x * back, vertex.y + a.y * back);
    const touchAfter = at(vertex.x + b.x * back, vertex.y + b.y * back);
    const bisector = towards(at(0, 0), at(a.x + b.x, a.y + b.y));
    const away = r / sinHalf;
    const middle = at(vertex.x + bisector.x * away, vertex.y + bisector.y * away);

    const startAngle = Math.atan2(touchBefore.y - middle.y, touchBefore.x - middle.x);
    let sweep = Math.atan2(touchAfter.y - middle.y, touchAfter.x - middle.x) - startAngle;
    while (sweep > Math.PI) sweep -= TAU;
    while (sweep < -Math.PI) sweep += TAU;

    before.to = touchBefore;
    after.from = touchAfter;
    inserts.set(index, {
      kind: "arc",
      centre: middle,
      radius: r,
      startAngle,
      endAngle: startAngle + sweep,
      sweepPositive: sweep > 0,
      /*
       * Always two pieces, whatever it turns through.
       *
       * An arc becomes quarter turns at most, so how many nodes it comes to
       * steps up as its sweep passes each right angle -- and this sweep is the
       * angle the two arms leave between them, which moves with the pen because
       * where a run's vertex sits does. A Ribbon `circumflex` came off with ten
       * nodes at the Thin and eight at the Regular, its apex cut in two pieces
       * at one and one at the other, and took every letter that wears a
       * circumflex or a caron off the weight axis with it.
       */
      pieces: 2,
    });
  }

  /*
   * A run shortened to nothing by its corners is dropped, and that is where the
   * weight axis is still losing letters on a face with round corners.
   *
   * Whether a run survives is a question about the pen -- the corners either
   * side of it eat back by a radius held at or above half the pen -- so the
   * same letter comes off with one piece more at the Thin than at the Black,
   * and two weights drawn with different points cannot be joined into one
   * variable font. Keeping every run instead, so the count is the same at both,
   * was tried and measured: the Ribbon went from 167 letters left standing to
   * 88 and the Technical from 95 to 77, which is most of the way.
   *
   * It is not here because of what it does to ten of them. A run of no length
   * offsets to a shape of no area, and fusing the strokes afterwards turns that
   * into a contour of its own: two four-by-four slivers on the Ribbon `w` at
   * the Black, which nobody would see, and on the `six` a hole a hundred and
   * ninety units across in the middle of the letter, which everybody would.
   * The point of following the axis is that the letters look right at every
   * weight, so a fix that buys the axis with a hole in a `six` is not a fix.
   * Whoever picks this up: the win is real and the thing in the way is the
   * fusing, not the sweep.
   */
  runs.forEach((segment, index) => {
    out.push(segment);
    const arc = inserts.get(index);
    if (arc) out.push(arc);
  });
  return { segments: out, closed: spine.closed };
}

// ---------------------------------------------------------------------------
// Small geometry
// ---------------------------------------------------------------------------

function towards(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return at(dx / length, dy / length);
}

/**
 * How far a spine runs, end to end.
 *
 * Beside `alongSpine`, which measures the same way, so a point taken at a
 * fraction of this is the point that fraction along.
 */
export function spineLength(spine: Spine): number {
  return spine.segments.reduce((total, segment) => total + lengthOf(segment), 0);
}

function lengthOf(segment: SpineSegment): number {
  return segment.kind === "line"
    ? Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y)
    : segment.radius * Math.abs(segment.endAngle - segment.startAngle);
}

function onArc(arc: SpineArc, angle: number): Vec2 {
  return at(
    arc.centre.x + arc.radius * Math.cos(angle),
    arc.centre.y + arc.radius * Math.sin(angle),
  );
}

function segmentStart(segment: SpineSegment): Vec2 {
  return segment.kind === "line" ? segment.from : onArc(segment, segment.startAngle);
}

function segmentEnd(segment: SpineSegment): Vec2 {
  return segment.kind === "line" ? segment.to : onArc(segment, segment.endAngle);
}

/** Degrees from the centre, in [0, 360). */
function angleOf(centre: Vec2, point: Vec2): number {
  const degrees = (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/**
 * Where a ray from the centre crosses a piece of the boundary.
 *
 * The boundary of a rounded rectangle wraps its centre once, so a ray in any
 * direction crosses it exactly once and the piece it crosses is the one whose
 * ends the direction lies between. Only that piece is ever asked.
 */
function hit(segment: SpineSegment, centre: Vec2, degrees: number): Vec2 | null {
  const radians = (degrees * Math.PI) / 180;
  const direction = at(Math.cos(radians), Math.sin(radians));

  if (segment.kind === "line") {
    const along = at(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
    const denominator = direction.x * along.y - direction.y * along.x;
    if (Math.abs(denominator) < 1e-12) return null;
    const dx = segment.from.x - centre.x;
    const dy = segment.from.y - centre.y;
    const t = (dx * along.y - dy * along.x) / denominator;
    return at(centre.x + direction.x * t, centre.y + direction.y * t);
  }

  // |centre + t.direction - arcCentre| = radius, which is a quadratic in t.
  const ox = centre.x - segment.centre.x;
  const oy = centre.y - segment.centre.y;
  const b = 2 * (ox * direction.x + oy * direction.y);
  const c = ox * ox + oy * oy - segment.radius * segment.radius;
  const discriminant = b * b - 4 * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  // The far crossing: the near one is behind the centre or on the wrong side.
  const t = (-b + root) / 2;
  return at(centre.x + direction.x * t, centre.y + direction.y * t);
}

/** The part of a piece from a given direction onwards. */
function cutBefore(segment: SpineSegment, centre: Vec2, degrees: number): SpineSegment | null {
  const point = hit(segment, centre, degrees);
  if (!point) return segment;
  if (segment.kind === "line") return { ...segment, from: point };
  return { ...segment, startAngle: onArcAngle(segment, point) };
}

/** The part of a piece up to a given direction. */
function cutAfter(segment: SpineSegment, centre: Vec2, degrees: number): SpineSegment | null {
  const point = hit(segment, centre, degrees);
  if (!point) return segment;
  if (segment.kind === "line") return { ...segment, to: point };
  return { ...segment, endAngle: onArcAngle(segment, point) };
}

/**
 * The angle a point sits at on an arc, expressed so it still lies between the
 * arc's own start and end rather than a turn away from them.
 */
function onArcAngle(arc: SpineArc, point: Vec2): number {
  const raw = Math.atan2(point.y - arc.centre.y, point.x - arc.centre.x);
  const way = arc.sweepPositive ? 1 : -1;
  let angle = raw;
  while ((angle - arc.startAngle) * way < 0) angle += TAU * way;
  while ((angle - arc.endAngle) * way > 0) angle -= TAU * way;
  return angle;
}

// ---------------------------------------------------------------------------
// Showing a skeleton
// ---------------------------------------------------------------------------

/**
 * A run written as an SVG path, for drawing the skeleton over the letter.
 *
 * Straight to arc commands rather than through beziers, because this is the one
 * place where what is wanted is the spine exactly as it is described rather
 * than an outline fitted to it. The sweep flag is written for a coordinate
 * system with y running up, which is the one the letters are described in; the
 * view flips it once, for everything at once.
 */
export function spinePath(spine: Spine): string {
  const pieces: string[] = [];
  let last: Vec2 | null = null;
  for (const segment of spine.segments) {
    const from = segmentStart(segment);
    const to = segmentEnd(segment);
    if (!last || Math.hypot(last.x - from.x, last.y - from.y) > 1e-6) {
      pieces.push(`M ${round(from.x)} ${round(from.y)}`);
    }
    if (segment.kind === "line") {
      pieces.push(`L ${round(to.x)} ${round(to.y)}`);
    } else {
      const turned = Math.abs(segment.endAngle - segment.startAngle);
      const long = turned > Math.PI ? 1 : 0;
      const way = segment.endAngle >= segment.startAngle ? 1 : 0;
      // A full turn has nowhere to draw to, so it goes round in two halves.
      if (turned >= Math.PI * 2 - 1e-9) {
        const half = onArc(segment, segment.startAngle + Math.PI);
        pieces.push(`A ${round(segment.radius)} ${round(segment.radius)} 0 0 ${way} ${round(half.x)} ${round(half.y)}`);
        pieces.push(`A ${round(segment.radius)} ${round(segment.radius)} 0 0 ${way} ${round(to.x)} ${round(to.y)}`);
      } else {
        pieces.push(
          `A ${round(segment.radius)} ${round(segment.radius)} 0 ${long} ${way} ${round(to.x)} ${round(to.y)}`,
        );
      }
    }
    last = to;
  }
  if (spine.closed) pieces.push("Z");
  return pieces.join(" ");
}

/** Where the pen sits along a run, for showing what is drawing it. */
export function alongSpine(spine: Spine, count: number): Vec2[] {
  const lengths = spine.segments.map(lengthOf);
  const total = lengths.reduce((sum, one) => sum + one, 0);
  if (total <= 0) return [];
  const out: Vec2[] = [];
  for (let step = 0; step <= count; step++) {
    let want = (total * step) / count;
    for (let index = 0; index < spine.segments.length; index++) {
      if (want > lengths[index] && index < spine.segments.length - 1) {
        want -= lengths[index];
        continue;
      }
      const segment = spine.segments[index];
      const part = lengths[index] > 0 ? Math.min(1, want / lengths[index]) : 0;
      out.push(
        segment.kind === "line"
          ? at(
              segment.from.x + (segment.to.x - segment.from.x) * part,
              segment.from.y + (segment.to.y - segment.from.y) * part,
            )
          : onArc(segment, segment.startAngle + (segment.endAngle - segment.startAngle) * part),
      );
      break;
    }
  }
  return out;
}

const round = (value: number): string => (Math.round(value * 100) / 100).toString();
