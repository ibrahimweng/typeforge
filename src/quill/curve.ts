/**
 * The curve arithmetic the rest of this engine stands on.
 *
 * Three jobs. Walking a spine at a given distance along it and reporting where
 * it is and which way it is heading; measuring how long it is, because a width
 * profile is written in arc length rather than in parameter and those are not
 * the same thing on a cubic; and fitting cubics back to a run of points within
 * a stated error, which is what makes a sampled offset into an outline.
 *
 * The fitter is the piece that carries the engine's honesty. Everything the
 * forge does is exact and can say so without measuring; everything sampled here
 * is accurate to a number, and that number is returned rather than assumed.
 */

import type { Vec2 } from "@/font/types";
import type { QuillCubic, QuillSegment, QuillSpine } from "./types";

const at = (x: number, y: number): Vec2 => ({ x, y });
const sub = (a: Vec2, b: Vec2): Vec2 => at(a.x - b.x, a.y - b.y);
const add = (a: Vec2, b: Vec2): Vec2 => at(a.x + b.x, a.y + b.y);
const mul = (a: Vec2, k: number): Vec2 => at(a.x * k, a.y * k);
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const len = (a: Vec2): number => Math.hypot(a.x, a.y);

/** The same vector at unit length, or a zero vector if there is nothing to normalise. */
export function unit(a: Vec2): Vec2 {
  const l = len(a);
  return l < 1e-12 ? at(0, 0) : at(a.x / l, a.y / l);
}

/** A quarter turn anticlockwise, which is the left-hand normal. */
export function leftOf(a: Vec2): Vec2 {
  return at(-a.y, a.x);
}

// ---------------------------------------------------------------------------
// One segment
// ---------------------------------------------------------------------------

/** Where a segment is at parameter `t`, which runs nought to one. */
export function pointOn(segment: QuillSegment, t: number): Vec2 {
  if (segment.kind === "line") {
    return at(
      segment.from.x + (segment.to.x - segment.from.x) * t,
      segment.from.y + (segment.to.y - segment.from.y) * t,
    );
  }
  if (segment.kind === "arc") {
    const angle = segment.startAngle + (segment.endAngle - segment.startAngle) * t;
    return at(
      segment.centre.x + Math.cos(angle) * segment.radius,
      segment.centre.y + Math.sin(angle) * segment.radius,
    );
  }
  const s = 1 - t;
  return at(
    s * s * s * segment.from.x + 3 * s * s * t * segment.c1.x + 3 * s * t * t * segment.c2.x + t * t * t * segment.to.x,
    s * s * s * segment.from.y + 3 * s * s * t * segment.c1.y + 3 * s * t * t * segment.c2.y + t * t * t * segment.to.y,
  );
}

/** Which way a segment is heading at `t`, as a unit vector. */
export function headingOn(segment: QuillSegment, t: number): Vec2 {
  if (segment.kind === "line") return unit(sub(segment.to, segment.from));
  if (segment.kind === "arc") {
    const angle = segment.startAngle + (segment.endAngle - segment.startAngle) * t;
    const way = segment.endAngle >= segment.startAngle ? 1 : -1;
    return unit(at(-Math.sin(angle) * way, Math.cos(angle) * way));
  }
  const s = 1 - t;
  /*
   * The derivative, and the degenerate case it has to survive.
   *
   * A cubic whose first control point sits exactly on its start has a zero
   * derivative there, and a zero vector has no direction to offset along. The
   * cure is to step a little way in and ask again: the heading a hair along is
   * the heading at the end for every purpose this engine has.
   */
  const d = at(
    3 * s * s * (segment.c1.x - segment.from.x) +
      6 * s * t * (segment.c2.x - segment.c1.x) +
      3 * t * t * (segment.to.x - segment.c2.x),
    3 * s * s * (segment.c1.y - segment.from.y) +
      6 * s * t * (segment.c2.y - segment.c1.y) +
      3 * t * t * (segment.to.y - segment.c2.y),
  );
  if (len(d) > 1e-9) return unit(d);
  const nudge = t < 0.5 ? Math.min(t + 1e-3, 1) : Math.max(t - 1e-3, 0);
  return unit(sub(pointOn(segment, nudge), pointOn(segment, t < 0.5 ? t : nudge)));
}

/*
 * How finely a segment is measured and walked.
 *
 * Thirty-two steps puts the arc length of a cubic within about a thousandth of
 * its true value, which on a stroke a few hundred units long is a fraction of a
 * unit -- well under anything a drawing can mean, and cheap enough to do for
 * every segment of every stroke on every redraw.
 */
const STEPS = 32;

/** How long a segment is, in font units. */
export function segmentLength(segment: QuillSegment): number {
  if (segment.kind === "line") return len(sub(segment.to, segment.from));
  if (segment.kind === "arc") return Math.abs(segment.endAngle - segment.startAngle) * segment.radius;
  let total = 0;
  let previous = pointOn(segment, 0);
  for (let step = 1; step <= STEPS; step++) {
    const here = pointOn(segment, step / STEPS);
    total += len(sub(here, previous));
    previous = here;
  }
  return total;
}

// ---------------------------------------------------------------------------
// A whole spine
// ---------------------------------------------------------------------------

/** Every segment's length and the total, worked out once and carried about. */
export interface SpineWalk {
  lengths: number[];
  total: number;
}

export function walkOf(spine: QuillSpine): SpineWalk {
  const lengths = spine.segments.map(segmentLength);
  return { lengths, total: lengths.reduce((sum, one) => sum + one, 0) };
}

/**
 * Where the spine is a given fraction of its own length along, and which way it
 * is heading there.
 *
 * By length rather than by parameter, which is the whole reason this exists. A
 * cubic covers wildly different amounts of ground for equal steps of `t`, so a
 * width profile indexed by `t` would put its swelling in a different place than
 * the eye reads it. Indexed by length it goes where it was asked for.
 */
export function alongSpine(
  spine: QuillSpine,
  walk: SpineWalk,
  fraction: number,
): { point: Vec2; heading: Vec2 } {
  const wanted = Math.max(0, Math.min(1, fraction)) * walk.total;
  let covered = 0;
  for (let index = 0; index < spine.segments.length; index++) {
    const length = walk.lengths[index];
    if (length <= 0) continue;
    if (covered + length >= wanted - 1e-9 || index === spine.segments.length - 1) {
      const t = length > 0 ? Math.max(0, Math.min(1, (wanted - covered) / length)) : 0;
      /*
       * The parameter is taken as the fraction of *this* segment's length,
       * which is exact for a line and an arc and very slightly out for a
       * cubic, whose parameter and arc length are not proportional. It is
       * corrected below by walking the samples rather than trusting `t`.
       */
      const segment = spine.segments[index];
      if (segment.kind === "cubic") {
        const target = wanted - covered;
        let run = 0;
        let previous = pointOn(segment, 0);
        for (let step = 1; step <= STEPS; step++) {
          const now = step / STEPS;
          const here = pointOn(segment, now);
          const piece = len(sub(here, previous));
          if (run + piece >= target - 1e-9) {
            const inside = piece > 0 ? (target - run) / piece : 0;
            const exact = (step - 1 + inside) / STEPS;
            return { point: pointOn(segment, exact), heading: headingOn(segment, exact) };
          }
          run += piece;
          previous = here;
        }
      }
      return { point: pointOn(segment, t), heading: headingOn(segment, t) };
    }
    covered += length;
  }
  const last = spine.segments[spine.segments.length - 1];
  return { point: pointOn(last, 1), heading: headingOn(last, 1) };
}

// ---------------------------------------------------------------------------
// Fitting cubics back to a run of points
// ---------------------------------------------------------------------------

/**
 * The cubic through four constraints: two ends and two tangent directions.
 *
 * Least squares on the two handle lengths, with the directions held. Standard,
 * and the reason it is written out rather than iterated: holding the tangents
 * is what makes two fitted pieces meet smoothly instead of kinking, and a
 * general least-squares fit would not.
 */
function fitOne(points: Vec2[], us: number[], leaving: Vec2, arriving: Vec2): QuillCubic {
  const first = points[0];
  const last = points[points.length - 1];
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  let x1 = 0;
  let x2 = 0;
  for (let index = 0; index < points.length; index++) {
    const u = us[index];
    const s = 1 - u;
    const b0 = s * s * s;
    const b1 = 3 * s * s * u;
    const b2 = 3 * s * u * u;
    const b3 = u * u * u;
    const a1 = mul(leaving, b1);
    const a2 = mul(arriving, b2);
    c11 += dot(a1, a1);
    c12 += dot(a1, a2);
    c22 += dot(a2, a2);
    const target = sub(points[index], add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x1 += dot(a1, target);
    x2 += dot(a2, target);
  }
  const determinant = c11 * c22 - c12 * c12;
  let alpha1 = 0;
  let alpha2 = 0;
  if (Math.abs(determinant) > 1e-12) {
    alpha1 = (c22 * x1 - c12 * x2) / determinant;
    alpha2 = (c11 * x2 - c12 * x1) / determinant;
  }
  /*
   * A negative or absurd handle means the fit has been asked for something the
   * held tangents cannot give -- usually a run that doubles back. A third of
   * the chord either side is the standard fallback and is what a hand drawing
   * the same two points with those two tangents would produce.
   */
  const chord = len(sub(last, first));
  if (!(alpha1 > 0) || !(alpha2 > 0) || alpha1 > chord * 3 || alpha2 > chord * 3) {
    alpha1 = chord / 3;
    alpha2 = chord / 3;
  }
  return {
    kind: "cubic",
    from: first,
    c1: add(first, mul(leaving, alpha1)),
    c2: add(last, mul(arriving, alpha2)),
    to: last,
  };
}

/** How far the worst of these points falls from that cubic, and where. */
function worstOff(points: Vec2[], us: number[], curve: QuillCubic): { far: number; at: number } {
  let far = 0;
  let where = Math.floor(points.length / 2);
  for (let index = 1; index < points.length - 1; index++) {
    const off = len(sub(pointOn(curve, us[index]), points[index]));
    if (off > far) {
      far = off;
      where = index;
    }
  }
  return { far, at: where };
}

/** Each point's place along the run, as a share of the run's own length. */
function parametrise(points: Vec2[]): number[] {
  const us = [0];
  let run = 0;
  for (let index = 1; index < points.length; index++) {
    run += len(sub(points[index], points[index - 1]));
    us.push(run);
  }
  return run > 0 ? us.map((one) => one / run) : us.map((_, index) => index / (us.length - 1 || 1));
}

/**
 * Cubics through a run of points, to within `tolerance` units.
 *
 * Schneider's method: fit one curve, find the point furthest from it, and if
 * that is further than allowed, split there and fit the two halves. It
 * terminates because each split strictly shortens the run, and it reports the
 * error it actually achieved rather than the one it was asked for -- which
 * matters, because a run with a corner in it cannot be fitted to any tolerance
 * by a single smooth curve and the caller has to be able to find that out.
 *
 * The recursion is bounded. A pathological run -- one that doubles back on
 * itself inside a fraction of a unit -- would otherwise split forever, and a
 * font drawing has no business hanging the tab it is drawn in.
 */
export function fitCubics(
  points: Vec2[],
  tolerance: number,
  depth = 0,
): { curves: QuillCubic[]; deviation: number } {
  if (points.length < 2) return { curves: [], deviation: 0 };
  if (points.length === 2) {
    const heading = unit(sub(points[1], points[0]));
    const third = len(sub(points[1], points[0])) / 3;
    return {
      curves: [
        {
          kind: "cubic",
          from: points[0],
          c1: add(points[0], mul(heading, third)),
          c2: add(points[1], mul(heading, -third)),
          to: points[1],
        },
      ],
      deviation: 0,
    };
  }

  const leaving = unit(sub(points[1], points[0]));
  const arriving = unit(sub(points[points.length - 2], points[points.length - 1]));
  const us = parametrise(points);
  const curve = fitOne(points, us, leaving, arriving);
  const { far, at: worst } = worstOff(points, us, curve);
  if (far <= tolerance || depth >= 16 || worst <= 0 || worst >= points.length - 1) {
    return { curves: [curve], deviation: far };
  }
  const before = fitCubics(points.slice(0, worst + 1), tolerance, depth + 1);
  const after = fitCubics(points.slice(worst), tolerance, depth + 1);
  return {
    curves: [...before.curves, ...after.curves],
    deviation: Math.max(before.deviation, after.deviation),
  };
}

/** The furthest any of these points sits from the nearest of those. */
export function furthestFrom(points: Vec2[], from: Vec2[]): number {
  let worst = 0;
  for (const one of points) {
    let near = Infinity;
    for (const other of from) {
      const d = (one.x - other.x) ** 2 + (one.y - other.y) ** 2;
      if (d < near) near = d;
    }
    worst = Math.max(worst, Math.sqrt(near));
  }
  return worst;
}
