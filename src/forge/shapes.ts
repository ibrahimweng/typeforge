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

  const kept: SpineSegment[] = [];
  // Two laps, so a run that crosses the rightmost point is not cut in half by
  // the seam that happens to be there.
  for (let lap = 0; lap < 2; lap++) {
    for (const segment of loop) {
      const from = angleOf(centre, segmentStart(segment)) + lap * 360;
      const to = angleOf(centre, segmentEnd(segment)) + lap * 360;
      const ends = to <= from ? to + 360 : to;
      if (ends <= start || from >= finish) continue;
      let piece: SpineSegment | null = segment;
      if (from < start) piece = cutBefore(piece, centre, start);
      if (piece && ends > finish) piece = cutAfter(piece, centre, finish);
      if (piece) kept.push(piece);
    }
  }
  return { segments: kept, closed: false };
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

  // Zero-length runs are dropped by the sweep in any case, but leaving them out
  // here keeps a circle a single arc rather than a circle with four ghosts in
  // it, which matters for how the letter reads when its spine is drawn.
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
  return segments.filter(hasLength);
}

function hasLength(segment: SpineSegment): boolean {
  return segment.kind === "line"
    ? Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > 1e-9
    : segment.radius > 1e-9;
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
  // Within thirty degrees of the line it is being called flat or upright
  // against, so a slightly leaning arm still counts as an arm.
  const steep = Math.abs(dy) / length;
  return along === "flat" ? steep <= 0.5 : steep >= 0.866;
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
   * wave's, so it is worked out from the neighbour and handed in. Never more
   * than two fifths of the run apiece, or there would be nothing left to wave.
   */
  const opening = Math.min(keepStart, whole * 0.4);
  const closing = Math.min(keepEnd, whole * 0.4);
  const span = whole - opening - closing;
  if (span < penHalf * 2) return [segment];

  /*
   * The wave is a half arc, some number of whole ones, and a half arc back.
   *
   * The two halves are what let it leave the line along the line and return to
   * it the same way. The whole ones in between each carry the stroke from one
   * side of its own turn to the other, so they alternate, and there has to be
   * an odd number of them for the last half to arrive travelling the right way
   * to come back down. A period is two of them.
   */
  const wanted = Math.max(1, (2 * span) / wavelength - 1);
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
  let turn = 2 * Math.atan((2 * depth) / length);
  /*
   * A quarter turn a side and no more, which is a wave of half circles.
   *
   * Past that the centre of the arc crosses to the other side of its own chord
   * and the arc curls back on itself rather than bulging.
   */
  turn = Math.min(turn, Math.PI / 2);
  // Then held so no arc turns tighter than half the pen, which is the same
  // rule everything else here is held to, and caps the depth rather than the
  // wave.
  const most = length / (4 * penHalf * CLEARANCE);
  if (most < 1) turn = Math.min(turn, Math.asin(most));
  // Under about a degree there is no wave left to draw, and a chain of arcs
  // that flat is a slower way of writing a straight line.
  if (turn < 0.02) return [segment];

  const radius = length / (4 * Math.sin(turn));
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
    // The first bends toward the side the wave rides on, and every one after
    // it bends back the other way.
    const side = (index % 2 === 0 ? 1 : -1) * first;
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
      sweepPositive: endAngle > startAngle,
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

/** The pieces left after taking a length off the front of the run. */
function trimmed(segments: SpineSegment[], distance: number): SpineSegment[] {
  let left = distance;
  const kept: SpineSegment[] = [];
  for (const segment of segments) {
    if (left <= 0) {
      kept.push(segment);
      continue;
    }
    const length = lengthOf(segment);
    if (length <= left) {
      left -= length;
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
  return kept.length > 0 ? kept : segments;
}

/** Where a run begins and where it ends, whichever kind of piece that is. */
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
    });
  }

  runs.forEach((segment, index) => {
    out.push(segment);
    const arc = inserts.get(index);
    if (arc) out.push(arc);
  });
  return { segments: out.filter(hasLength), closed: spine.closed };
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
