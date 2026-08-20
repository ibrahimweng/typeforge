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
import type { Spine, SpineArc, SpineSegment } from "./types";

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
