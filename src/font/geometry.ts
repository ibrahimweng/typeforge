/** Vector and bezier maths shared by the editor, the renderer and the exporters. */

import type { Contour, GlyphNode, Vec2 } from "./types";

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  return len === 0 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

/** A segment of an outline, resolved from the node pair that bounds it. */
export type Segment =
  | { kind: "line"; from: Vec2; to: Vec2 }
  | { kind: "cubic"; from: Vec2; c1: Vec2; c2: Vec2; to: Vec2 };

/**
 * Walk a contour as drawable segments. A segment is a straight line only when
 * neither of the handles facing it is set; otherwise a missing handle collapses
 * onto its own node, which is the cubic form of a straight run.
 */
export function contourSegments(contour: Contour): Segment[] {
  const { nodes, closed } = contour;
  if (nodes.length < 2) return [];
  const segments: Segment[] = [];
  const last = closed ? nodes.length : nodes.length - 1;

  for (let i = 0; i < last; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    if (!a.handleOut && !b.handleIn) {
      segments.push({ kind: "line", from: a.point, to: b.point });
    } else {
      segments.push({
        kind: "cubic",
        from: a.point,
        c1: a.handleOut ?? a.point,
        c2: b.handleIn ?? b.point,
        to: b.point,
      });
    }
  }
  return segments;
}

export function cubicAt(from: Vec2, c1: Vec2, c2: Vec2, to: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * from.x + b * c1.x + c * c2.x + d * to.x,
    y: a * from.y + b * c1.y + c * c2.y + d * to.y,
  };
}

export function cubicDerivativeAt(from: Vec2, c1: Vec2, c2: Vec2, to: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: 3 * u * u * (c1.x - from.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (to.x - c2.x),
    y: 3 * u * u * (c1.y - from.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (to.y - c2.y),
  };
}

/** Split a cubic at `t`, returning the two halves (de Casteljau). */
export function splitCubic(
  from: Vec2,
  c1: Vec2,
  c2: Vec2,
  to: Vec2,
  t: number,
): [[Vec2, Vec2, Vec2, Vec2], [Vec2, Vec2, Vec2, Vec2]] {
  const p01 = lerp(from, c1, t);
  const p12 = lerp(c1, c2, t);
  const p23 = lerp(c2, to, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const mid = lerp(p012, p123, t);
  return [
    [from, p01, p012, mid],
    [mid, p123, p23, to],
  ];
}

export interface Bounds {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export const EMPTY_BOUNDS: Bounds = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };

/**
 * Tight bounds of a set of contours. Curve extremes are found by solving the
 * derivative rather than by sampling, so the box is exact.
 */
export function contoursBounds(contours: Contour[]): Bounds {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;

  const include = (p: Vec2) => {
    if (p.x < xMin) xMin = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.x > xMax) xMax = p.x;
    if (p.y > yMax) yMax = p.y;
  };

  for (const contour of contours) {
    for (const segment of contourSegments(contour)) {
      include(segment.from);
      include(segment.to);
      if (segment.kind === "cubic") {
        for (const t of cubicExtremeTs(segment.from, segment.c1, segment.c2, segment.to)) {
          include(cubicAt(segment.from, segment.c1, segment.c2, segment.to, t));
        }
      }
    }
  }
  if (!Number.isFinite(xMin)) return { ...EMPTY_BOUNDS };
  return { xMin, yMin, xMax, yMax };
}

/**
 * Where along a cubic it passes through a given height.
 *
 * Solved rather than sampled: this decides where a ray crosses an outline and
 * where a stroke meets a curve, and both are judged against stem widths of a
 * couple of hundred units, so an approximation would show.
 *
 * Roots are fitted into the half-open interval a segment owns, so a crossing
 * exactly through a node is counted once by the segment starting there rather
 * than twice or not at all. A root that is mathematically zero can arrive as
 * -1e-9, and flat-topped letters put nodes on round numbers, so rays land on
 * them often.
 */
export function cubicParametersAtY(from: Vec2, c1: Vec2, c2: Vec2, to: Vec2, y: number): number[] {
  const out: number[] = [];
  for (const raw of cubicRootsForY(from.y, c1.y, c2.y, to.y, y)) {
    const t = clampParameter(raw);
    if (t !== null) out.push(t);
  }
  return out;
}

/** Solve the cubic for the parameters where the curve reaches y. */
function cubicRootsForY(p0: number, p1: number, p2: number, p3: number, y: number): number[] {
  // Bezier basis rearranged into at^3 + bt^2 + ct + d.
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 3 * p0 - 6 * p1 + 3 * p2;
  const c = -3 * p0 + 3 * p1;
  const d = p0 - y;
  return solveCubic(a, b, c, d);
}

const EPSILON = 1e-9;

/**
 * How close to an endpoint a root has to be to count as sitting on it.
 *
 * A ray cast at exactly the height of an on-curve point should cross there, but
 * solving the cubic for that point can land a hair either side of the interval:
 * a root that is mathematically zero arrives as -1e-9 and a strict t >= 0 drops
 * it, losing a crossing and leaving an odd number behind, which then pairs the
 * remaining ones wrongly and reports nonsense widths. Flat-topped letters put
 * nodes on round numbers, so rays land on them often.
 */
const PARAMETER_TOLERANCE = 1e-7;

/**
 * Fit a root into the half-open interval a segment owns.
 *
 * Each shared endpoint belongs to exactly one of the two segments that meet
 * there -- the one starting at it -- so that a crossing through a node is
 * counted once rather than twice or not at all.
 */
function clampParameter(t: number): number | null {
  if (t > -PARAMETER_TOLERANCE && t < PARAMETER_TOLERANCE) return 0;
  if (Math.abs(t - 1) < PARAMETER_TOLERANCE) return null;
  if (t < 0 || t > 1) return null;
  return t;
}

function solveCubic(a: number, b: number, c: number, d: number): number[] {
  if (Math.abs(a) < EPSILON) return solveQuadratic(b, c, d);

  // Depressed cubic t^3 + pt + q, via the standard substitution.
  const bn = b / a;
  const cn = c / a;
  const dn = d / a;
  const shift = bn / 3;
  const p = cn - (bn * bn) / 3;
  const q = (2 * bn * bn * bn) / 27 - (bn * cn) / 3 + dn;
  const discriminant = (q * q) / 4 + (p * p * p) / 27;

  if (discriminant > EPSILON) {
    const root = Math.sqrt(discriminant);
    return [Math.cbrt(-q / 2 + root) + Math.cbrt(-q / 2 - root) - shift];
  }
  if (Math.abs(discriminant) <= EPSILON) {
    const u = Math.cbrt(-q / 2);
    return [2 * u - shift, -u - shift];
  }
  // Three real roots: the trigonometric form avoids complex arithmetic.
  const r = Math.sqrt(-(p * p * p) / 27);
  const phi = Math.acos(Math.min(1, Math.max(-1, -q / (2 * r))));
  const m = 2 * Math.cbrt(r);
  return [0, 1, 2].map((k) => m * Math.cos((phi + 2 * Math.PI * k) / 3) - shift);
}

function solveQuadratic(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) < EPSILON) return [];
    return [-c / b];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
}

/** Parameter values where a cubic reaches a horizontal or vertical extreme. */
export function cubicExtremeTs(from: Vec2, c1: Vec2, c2: Vec2, to: Vec2): number[] {
  const ts: number[] = [];
  for (const axis of ["x", "y"] as const) {
    // Derivative of a cubic is a quadratic: at^2 + bt + c
    const a = 3 * (-from[axis] + 3 * c1[axis] - 3 * c2[axis] + to[axis]);
    const b = 6 * (from[axis] - 2 * c1[axis] + c2[axis]);
    const c = 3 * (c1[axis] - from[axis]);

    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) {
        const t = -c / b;
        if (t > 0 && t < 1) ts.push(t);
      }
      continue;
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    for (const t of [(-b + root) / (2 * a), (-b - root) / (2 * a)]) {
      if (t > 0 && t < 1) ts.push(t);
    }
  }
  return ts;
}

/**
 * Signed area of a closed contour. The sign gives winding direction, which
 * decides whether a contour is an outer shape or a counter (a hole).
 */
export function contourArea(contour: Contour): number {
  const segments = contourSegments(contour);
  let area = 0;
  // Sample curves finely enough that the sign is reliable for any real outline.
  for (const segment of segments) {
    if (segment.kind === "line") {
      area += segment.from.x * segment.to.y - segment.to.x * segment.from.y;
    } else {
      const steps = 16;
      let prev = segment.from;
      for (let i = 1; i <= steps; i++) {
        const p = cubicAt(segment.from, segment.c1, segment.c2, segment.to, i / steps);
        area += prev.x * p.y - p.x * prev.y;
        prev = p;
      }
    }
  }
  return area / 2;
}

export const isClockwise = (contour: Contour): boolean => contourArea(contour) < 0;

export function reverseContour(contour: Contour): Contour {
  const nodes = [...contour.nodes].reverse().map<GlyphNode>((node) => ({
    point: { ...node.point },
    handleIn: node.handleOut ? { ...node.handleOut } : null,
    handleOut: node.handleIn ? { ...node.handleIn } : null,
    type: node.type,
  }));
  return { nodes, closed: contour.closed };
}

/**
 * How finely to flatten a curve to ask whether a reshaped outline crosses
 * itself. The fold at the join of the arch of Geist's r to its stem, a light
 * letter widened, showed only from twenty-four pieces a curve.
 */
export const FINE_STEPS = 32;

/**
 * How near a crossing must stay to where it was, from one step of a
 * reshaping to the next, to be the same crossing, as a share of the size of
 * the outline: about ten units on a letter a thousand tall. One that moves
 * further in a step is looked for again in two half steps. The three
 * crossings the flattened pieces of two curves meeting at a shallow angle can
 * make, where the curves cross once, lie well within it.
 */
const NEAR = 0.01;

/**
 * The finest step a reshaping is followed in, as a share of the whole, and
 * the most it may be asked in. A crossing that cannot be followed at the
 * finest step is one the reshaping tied rather than carried, and a reshaping
 * that cannot be followed in that many is taken to have tied one.
 */
const LEAST_STEP = 1 / 256;
const MOST_STEPS = 512;

/**
 * Where a corner radius changes an outline -- it merges points and adds
 * others, so it cannot be followed point by point -- a crossing it carries
 * moves by no more than the radius across the curves, and along them by that
 * over the sine of the angle they meet at, which is taken as at least this:
 * about six degrees.
 */
const LEAST_SINE = 0.1;

/**
 * Whether a contour runs back over its own ink.
 *
 * A shape is its own boundary, so an outline that crosses itself is not one:
 * the region it encloses depends on a fill rule rather than on the drawing, and
 * where the two passes run opposite ways round the fill rule takes the ink out.
 * That is not a hypothetical -- it is how the `e` of a traced font came back
 * with a slit through the left side of its bowl, because the crossbar and the
 * bowl are one swept stroke there and the crossbar's pass runs the other way.
 *
 * Asked of the curves rather than of a polyline, and asked cheaply: two
 * segments whose control boxes miss each other cannot meet, and on a letter
 * almost every pair misses. Only the survivors are flattened, and of those
 * only the pieces that reach the other's span are compared.
 *
 * Each curve is asked of itself too, unless its control points make a convex
 * outline, which cannot loop: the offset of a curve tighter than the weight
 * ties a loop inside one piece. And neighbours are compared like any others
 * but for the two pieces that meet at their shared end -- every contour
 * touches itself there, and a touch is not a crossing -- since a fold at a
 * corner crosses the curve beside it away from where they meet.
 *
 * Curves are flattened in `steps` pieces each. Eight is enough for a letter a
 * person drew; the loop a fold or a boolean ties where two curves nearly
 * touch can be a unit across on a long curve, and needs `FINE_STEPS`.
 */
export function crossesItself(contour: Contour, steps = 8): boolean {
  return selfCrossings(laidOut(contour, steps), 1).length > 0;
}

/**
 * How many times an outline crosses itself, as pieces of its flattened curves
 * crossing, up to `limit`.
 */
export function crossingsOf(contour: Contour, steps = 8, limit = Infinity): number {
  return selfCrossings(laidOut(contour, steps), limit).length;
}

/**
 * A test of whether a reshaped outline crosses itself anywhere `drawn` did
 * not.
 *
 * A letter that comes in crossing itself -- some fonts ship outlines like
 * that -- is not let off: a reshaping may carry its crossings along with its
 * curves, or lose them, but tie none. That is asked by following the
 * reshaping. The drawn outline is eased into the trial, every point and
 * handle along a straight line, and each crossing at every step must be one
 * of the step before: near where that one was, on the same two curves or the
 * next ones along, past the point where they join. A step a crossing cannot
 * be followed across is halved, however far the reshaping moves the curves
 * and however shallow the angle it slides along them at; one that cannot be
 * followed at the finest step was tied there. So one crossing undone at the
 * top of a letter and another tied at the bottom is not a trade, and a wall
 * bulged through a curve it crossed once, in and out and in again, crosses
 * more.
 *
 * The trial is taken point for point with the drawing, as every reshaping
 * but a corner radius leaves it. Given a `reach` it is not -- a radius merges
 * points and adds others -- and a crossing need only lie within that of one
 * of the drawing's, and further along the curves where they meet at a
 * shallow angle. Only a letter drawn crossing, and a trial that crosses, is
 * followed; the drawn outline is asked once, and only when a trial crosses.
 * Outlines are laid out in `layouts`, which the checks of one reshaping can
 * share.
 */
export function crossesMoreThan(
  drawn: Contour,
  steps = 8,
  layouts: Layouts = new WeakMap(),
): (trial: Contour, reach?: number) => boolean {
  let had: Stage | undefined;
  return (trial, reach) => {
    const lay = layOf(trial, steps, layouts);
    // Where the drawing crosses nowhere, one crossing is all there is to know.
    if (!had?.found.length) {
      if (selfCrossings(lay, 1).length === 0) return false;
      if (!had) {
        const laid = layOf(drawn, steps, layouts);
        had = stageOf(drawn, laid, selfCrossings(laid, Infinity));
      }
      if (had.found.length === 0) return true;
    }
    const found = selfCrossings(lay, Infinity);
    const near = nearness(layOf(drawn, steps, layouts).box);
    if (reach !== undefined || !sameShape(drawn, trial))
      return !found.every((crossing) => lies(crossing, had?.found ?? [], near, reach ?? 0));
    return !followed(had, stageOf(trial, lay, found), near, (share) => {
      const between = eased(drawn, trial, share);
      const laid = laidOut(between, steps);
      return stageOf(between, laid, selfCrossings(laid, Infinity));
    });
  };
}

/**
 * The same asked of a letter's contours against each other: a test of
 * whether reshaped contours, each point for point with the drawn one in its
 * place, cross one another anywhere the drawing did not.
 *
 * Contours that overlap as drawn -- an unmerged font -- may carry their
 * overlap along with their walls, followed as one outline's crossings are; a
 * wall driven through another anywhere else, the far side of the stem it
 * overlapped included, is refused. A pair the trial leaves as drawn, the
 * same two outlines, is not asked again, and each drawn pair is asked once.
 * Given a list, every pair that crosses more is put in it, rather than only
 * the first being looked for.
 */
export function overlapsMoreThan(
  drawn: Contour[],
  steps = 8,
  layouts: Layouts = new WeakMap(),
): (trial: Contour[], pairs?: Array<[number, number]>) => boolean {
  const lay = (contour: Contour) => layOf(contour, steps, layouts);
  const drawnPairs = new Map<string, Crossing[]>();
  const drawnBetween = (one: number, other: number): Crossing[] => {
    const key = `${one}:${other}`;
    let had = drawnPairs.get(key);
    if (!had) {
      had = crossingsBetween(lay(drawn[one]), lay(drawn[other]), Infinity);
      drawnPairs.set(key, had);
    }
    return had;
  };
  const crossesMore = (trial: Contour[], one: number, other: number): boolean => {
    const first = lay(trial[one]);
    const second = lay(trial[other]);
    if (misses(first.box, second.box)) return false;
    const had = drawnBetween(one, other);
    const found = crossingsBetween(first, second, had.length > 0 ? Infinity : 1);
    if (found.length === 0) return false;
    if (had.length === 0) return true;
    const near = nearness(union(lay(drawn[one]).box, lay(drawn[other]).box));
    if (!sameShape(drawn[one], trial[one]) || !sameShape(drawn[other], trial[other]))
      return !found.every((crossing) => lies(crossing, had, near, 0));
    const start: Stage = {
      found: had,
      one: outlineOf(drawn[one], lay(drawn[one])),
      other: outlineOf(drawn[other], lay(drawn[other])),
    };
    const end: Stage = {
      found,
      one: outlineOf(trial[one], first),
      other: outlineOf(trial[other], second),
    };
    const between = (share: number): Stage => {
      const a = eased(drawn[one], trial[one], share);
      const b = eased(drawn[other], trial[other], share);
      const laidA = laidOut(a, steps);
      const laidB = laidOut(b, steps);
      return {
        found: crossingsBetween(laidA, laidB, Infinity),
        one: outlineOf(a, laidA),
        other: outlineOf(b, laidB),
      };
    };
    return !followed(start, end, near, between);
  };
  return (trial, pairs) => {
    let any = false;
    for (let one = 0; one < trial.length; one++)
      for (let other = one + 1; other < trial.length; other++) {
        if (trial[one] === drawn[one] && trial[other] === drawn[other]) continue;
        if (!crossesMore(trial, one, other)) continue;
        if (!pairs) return true;
        pairs.push([one, other]);
        any = true;
      }
    return any;
  };
}

/**
 * Outlines laid out for the crossing checks, which the checks of one
 * reshaping can share, so that each is flattened once however many ask. Kept
 * by the outline itself, and for one number of steps.
 */
export type Layouts = WeakMap<Contour, Laid>;

function layOf(contour: Contour, steps: number, layouts: Layouts): Laid {
  let laid = layouts.get(contour);
  if (!laid) {
    laid = laidOut(contour, steps);
    layouts.set(contour, laid);
  }
  return laid;
}

/** A place on an outline: which of its pieces, as `contourSegments` lists them, and how far along. */
interface Along {
  place: number;
  t: number;
}

/**
 * Where an outline crosses itself, or two cross each other: on which curves,
 * and the sine of the angle they cross at.
 */
interface Crossing {
  at: Vec2;
  one: Along;
  other: Along;
  sine: number;
}

/** An outline laid out to be asked where it crosses: its pieces, boxed, flattened when first asked. */
interface Laid {
  closed: boolean;
  pieces: Array<{ segment: Segment; place: number; box: Bounds }>;
  box: Bounds;
  flat: (index: number) => Flat;
}

type Flat = { points: Vec2[]; span: Bounds };

function laidOut(contour: Contour, steps: number): Laid {
  /*
   * Without the pieces that go nowhere. A corner the weight swallows leaves
   * its points on one spot, and a piece of no length between two others made
   * them look like strangers rather than neighbours: they meet at a point
   * that agrees to fifteen digits and not to all of them, and the collapsed
   * apex of the counter of Lora's heavy A was reported crossed.
   */
  const pieces = contourSegments(contour).flatMap((segment, place) => {
    const corners =
      segment.kind === "line"
        ? [segment.from, segment.to]
        : [segment.from, segment.c1, segment.c2, segment.to];
    if (corners.every((point) => distance(point, segment.from) <= 1e-9)) return [];
    // The control polygon bounds the curve, which is all a rejection needs.
    return [{ segment, place, box: boundsOf(corners) }];
  });
  const box = pieces.reduce((all, piece) => union(all, piece.box), NO_BOUNDS);
  const flattened = new Map<number, Flat>();
  return {
    closed: contour.closed,
    pieces,
    box,
    flat: (index) => {
      const had = flattened.get(index);
      if (had) return had;
      const { segment } = pieces[index];
      const points: Vec2[] = [segment.from];
      if (segment.kind === "line") points.push(segment.to);
      else
        for (let step = 1; step <= steps; step++)
          points.push(cubicAt(segment.from, segment.c1, segment.c2, segment.to, step / steps));
      const flat = { points, span: boundsOf(points) };
      flattened.set(index, flat);
      return flat;
    },
  };
}

/** The crossings of one outline, up to `limit` of them. */
function selfCrossings(laid: Laid, limit: number): Crossing[] {
  const found: Crossing[] = [];
  const { pieces } = laid;
  const total = pieces.length;
  /*
   * A curve against itself: the offset of a curve tighter than the weight
   * ties a loop inside the one piece, which nothing else touches.
   */
  for (let one = 0; one < total && found.length < limit; one++) {
    const { segment, place } = pieces[one];
    if (segment.kind === "line") continue;
    // A curve whose control points make a convex outline cannot loop.
    const corners = [segment.from, segment.c1, segment.c2, segment.to];
    const turns = corners.map((point, k) => {
      const next = corners[(k + 1) % 4];
      const after = corners[(k + 2) % 4];
      return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
    });
    if (turns.every((turn) => turn >= 0) || turns.every((turn) => turn <= 0)) continue;
    const { points } = laid.flat(one);
    const pieceCount = points.length - 1;
    for (let i = 0; i + 1 < points.length && found.length < limit; i++)
      for (let j = i + 2; j + 1 < points.length && found.length < limit; j++) {
        const hit = crossingOf(points[i], points[i + 1], points[j], points[j + 1]);
        if (hit)
          found.push({
            at: hit.at,
            one: { place, t: (i + hit.u) / pieceCount },
            other: { place, t: (j + hit.v) / pieceCount },
            sine: hit.sine,
          });
      }
  }
  for (let one = 0; one < total && found.length < limit; one++)
    for (let other = one + 1; other < total && found.length < limit; other++) {
      if (misses(pieces[one].box, pieces[other].box)) continue;
      /*
       * Neighbours share an end, and on a closed contour so do the last and
       * the first; only the two pieces that meet there are let off. The
       * rest of them are compared like any others: two curves either side
       * of a corner can cross away from it, as a fold at a corner does.
       */
      const after = other === one + 1;
      const around = laid.closed && one === 0 && other === total - 1;
      meets(laid, one, laid, other, after, around, limit, found);
    }
  return found;
}

/** Where two outlines cross each other, up to `limit` of them. */
function crossingsBetween(one: Laid, other: Laid, limit: number): Crossing[] {
  const found: Crossing[] = [];
  if (misses(one.box, other.box)) return found;
  for (let first = 0; first < one.pieces.length && found.length < limit; first++)
    for (let second = 0; second < other.pieces.length && found.length < limit; second++) {
      if (misses(one.pieces[first].box, other.pieces[second].box)) continue;
      meets(one, first, other, second, false, false, limit, found);
    }
  return found;
}

/**
 * Where two pieces of outline, flattened, properly cross, ends touching not
 * counted, added to `found` up to `limit`. `after` when the second begins
 * where the first ends, `around` when the first begins where the second
 * ends; the two flattened pieces that meet there are not compared. Only the
 * pieces of each that reach the other's span can cross it: by a shared end,
 * the few nearest it.
 */
function meets(
  oneLaid: Laid,
  oneIndex: number,
  otherLaid: Laid,
  otherIndex: number,
  after: boolean,
  around: boolean,
  limit: number,
  found: Crossing[],
): void {
  const one = oneLaid.flat(oneIndex);
  const other = otherLaid.flat(otherIndex);
  const onePlace = oneLaid.pieces[oneIndex].place;
  const otherPlace = otherLaid.pieces[otherIndex].place;
  const a = one.points;
  const b = other.points;
  const last = a.length - 2;
  const end = b.length - 2;
  const within = (p: Vec2, q: Vec2, span: Bounds) =>
    Math.max(p.x, q.x) >= span.xMin &&
    Math.min(p.x, q.x) <= span.xMax &&
    Math.max(p.y, q.y) >= span.yMin &&
    Math.min(p.y, q.y) <= span.yMax;
  for (let i = 0; i + 1 < a.length; i++) {
    if (!within(a[i], a[i + 1], other.span)) continue;
    for (let j = 0; j + 1 < b.length; j++) {
      if (after && i === last && j === 0) continue;
      if (around && i === 0 && j === end) continue;
      if (!within(b[j], b[j + 1], one.span)) continue;
      const hit = crossingOf(a[i], a[i + 1], b[j], b[j + 1]);
      if (!hit) continue;
      found.push({
        at: hit.at,
        one: { place: onePlace, t: (i + hit.u) / (a.length - 1) },
        other: { place: otherPlace, t: (j + hit.v) / (b.length - 1) },
        sine: hit.sine,
      });
      if (found.length >= limit) return;
    }
  }
}

/** Where two straight pieces properly cross, how far along each, and at what angle. */
function crossingOf(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
): { at: Vec2; u: number; v: number; sine: number } | null {
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const one = side(a, b, c);
  const two = side(a, b, d);
  const three = side(c, d, a);
  const four = side(c, d, b);
  if (!(one * two < 0 && three * four < 0)) return null;
  const u = three / (three - four);
  const turn = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  const sine = Math.abs(turn) / (distance(a, b) * distance(c, d));
  return { at: lerp(a, b, u), u, v: one / (one - two), sine };
}

/** Where one outline, or two, cross at one step of a reshaping, and the outlines themselves. */
interface Stage {
  found: Crossing[];
  one: Outline;
  other: Outline;
}

/** An outline's points, whether it closes, and which of its pieces have any length. */
interface Outline {
  nodes: GlyphNode[];
  closed: boolean;
  live: Set<number>;
}

function outlineOf(contour: Contour, laid: Laid): Outline {
  return {
    nodes: contour.nodes,
    closed: contour.closed,
    live: new Set(laid.pieces.map((piece) => piece.place)),
  };
}

function stageOf(contour: Contour, laid: Laid, found: Crossing[]): Stage {
  const outline = outlineOf(contour, laid);
  return { found, one: outline, other: outline };
}

/**
 * A drawn outline `share` of the way to a reshaped one, point for point:
 * every point and handle along the straight line between them. A handle
 * either leaves out starts or ends on its own point, which is what a missing
 * handle is.
 */
function eased(from: Contour, to: Contour, share: number): Contour {
  const handle = (was: Vec2 | null, wasAt: Vec2, now: Vec2 | null, nowAt: Vec2) =>
    was === null && now === null ? null : lerp(was ?? wasAt, now ?? nowAt, share);
  return {
    closed: to.closed,
    nodes: to.nodes.map((node, index) => {
      const was = from.nodes[index];
      return {
        ...node,
        point: lerp(was.point, node.point, share),
        handleIn: handle(was.handleIn, was.point, node.handleIn, node.point),
        handleOut: handle(was.handleOut, was.point, node.handleOut, node.point),
      };
    }),
  };
}

/**
 * Whether every crossing at the end of a reshaping follows from one at its
 * start. The reshaping is taken whole first, then in steps that halve
 * wherever a crossing cannot be followed across one and double again after,
 * down to `LEAST_STEP` and for at most `MOST_STEPS` tries.
 */
function followed(first: Stage, last: Stage, near: number, at: (share: number) => Stage): boolean {
  let here = first;
  let done = 0;
  let step = 1;
  for (let tries = 0; done < 1; tries++) {
    if (tries >= MOST_STEPS) return false;
    const to = Math.min(1, done + step);
    const there = to === 1 ? last : at(to);
    const carried = there.found.every((crossing) =>
      here.found.some((was) => follows(crossing, was, there, near)),
    );
    if (carried) {
      here = there;
      done = to;
      step *= 2;
    } else if (step <= LEAST_STEP) return false;
    else step /= 2;
  }
  return true;
}

/**
 * Whether `crossing` is `was` a step on: near it, on the same two curves or
 * the next along either way past the point that joins them, which it must
 * then be beside, having slid past it. One outline's two curves may be found
 * the other way round.
 */
function follows(crossing: Crossing, was: Crossing, there: Stage, near: number): boolean {
  if (distance(crossing.at, was.at) > near) return false;
  const on = (now: Along, then: Along, outline: Outline) =>
    slid(now, then, outline, crossing.at, near);
  return (
    (on(crossing.one, was.one, there.one) && on(crossing.other, was.other, there.other)) ||
    (there.one === there.other &&
      on(crossing.one, was.other, there.one) &&
      on(crossing.other, was.one, there.one))
  );
}

/**
 * Whether a crossing at `at`, on the piece `now` names, was on the piece
 * `then` names: the same one, or the next with any length either way -- past
 * any a swallowed corner left on one spot -- with the point that joins them
 * near it.
 */
function slid(now: Along, then: Along, outline: Outline, at: Vec2, near: number): boolean {
  if (now.place === then.place) return true;
  const { nodes, closed, live } = outline;
  const count = closed ? nodes.length : nodes.length - 1;
  for (const way of [1, -1]) {
    let place = then.place;
    for (let step = 0; step < count; step++) {
      const joint = (way > 0 ? place + 1 : place) % nodes.length;
      place += way;
      if (closed) place = (place + count) % count;
      else if (place < 0 || place >= count) break;
      if (place === now.place) return distance(nodes[joint].point, at) <= near;
      if (live.has(place)) break;
    }
  }
  return false;
}

/**
 * And where the pieces do not line up, whether a crossing lies near one of
 * those `had`: within `reach` across the curves, and along them by that over
 * the sine of the angle they met at.
 */
function lies(crossing: Crossing, had: Crossing[], near: number, reach: number): boolean {
  return had.some(
    (was) => distance(crossing.at, was.at) <= near + reach / Math.max(was.sine, LEAST_SINE),
  );
}

/** Whether a reshaped outline still lines up with the drawn one point for point. */
function sameShape(drawn: Contour, trial: Contour): boolean {
  return drawn.closed === trial.closed && drawn.nodes.length === trial.nodes.length;
}

function nearness(box: Bounds): number {
  const size = Math.hypot(box.xMax - box.xMin, box.yMax - box.yMin);
  return Number.isFinite(size) ? Math.max(1, NEAR * size) : 1;
}

const NO_BOUNDS: Bounds = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };

function boundsOf(points: Vec2[]): Bounds {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const point of points) {
    if (point.x < xMin) xMin = point.x;
    if (point.x > xMax) xMax = point.x;
    if (point.y < yMin) yMin = point.y;
    if (point.y > yMax) yMax = point.y;
  }
  return { xMin, xMax, yMin, yMax };
}

function union(a: Bounds, b: Bounds): Bounds {
  return {
    xMin: Math.min(a.xMin, b.xMin),
    yMin: Math.min(a.yMin, b.yMin),
    xMax: Math.max(a.xMax, b.xMax),
    yMax: Math.max(a.yMax, b.yMax),
  };
}

/** Whether two boxes are apart, which two things inside them then are too. */
function misses(a: Bounds, b: Bounds): boolean {
  return a.xMax < b.xMin || b.xMax < a.xMin || a.yMax < b.yMin || b.yMax < a.yMin;
}

/**
 * How close two outlines come: the least distance between them, flattened in
 * `steps` pieces a curve, and nothing if they cross. Every piece of one is
 * measured against every piece of the other that could be nearer than the
 * best found so far.
 */
export function clearance(one: Contour, other: Contour, steps = 12): number {
  const a = flattenedLoop(one, steps);
  const b = flattenedLoop(other, steps);
  if (a.length < 2 || b.length < 2) return Infinity;
  const apart = (p: Bounds, q: Bounds) =>
    Math.max(p.xMin - q.xMax, q.xMin - p.xMax, p.yMin - q.yMax, q.yMin - p.yMax, 0);
  const boxesA = a.slice(1).map((point, index) => boundsOf([a[index], point]));
  const boxesB = b.slice(1).map((point, index) => boundsOf([b[index], point]));
  let best = Infinity;
  for (let i = 0; i + 1 < a.length; i++)
    for (let j = 0; j + 1 < b.length; j++) {
      if (apart(boxesA[i], boxesB[j]) >= best) continue;
      if (crossingOf(a[i], a[i + 1], b[j], b[j + 1])) return 0;
      best = Math.min(
        best,
        towards(a[i], b[j], b[j + 1]),
        towards(a[i + 1], b[j], b[j + 1]),
        towards(b[j], a[i], a[i + 1]),
        towards(b[j + 1], a[i], a[i + 1]),
      );
    }
  return best;
}

/** An outline flattened, back to its first point if it closes. */
function flattenedLoop(contour: Contour, steps: number): Vec2[] {
  const points = flattenContour(contour, steps);
  return contour.closed && points.length > 0 ? [...points, points[0]] : points;
}

/** How far a point is from a straight piece. */
function towards(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const t =
    length > 0
      ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length))
      : 0;
  return Math.hypot(from.x + t * dx - point.x, from.y + t * dy - point.y);
}

/** Even-odd containment test, used to tell counters from outer shapes. */
export function contourContainsPoint(contour: Contour, point: Vec2): boolean {
  const polygon = flattenContour(contour, 8);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

/** Approximate a contour as a polyline. `steps` is samples per curve segment. */
export function flattenContour(contour: Contour, steps = 12): Vec2[] {
  const points: Vec2[] = [];
  for (const segment of contourSegments(contour)) {
    points.push(segment.from);
    if (segment.kind === "cubic") {
      for (let i = 1; i < steps; i++) {
        points.push(cubicAt(segment.from, segment.c1, segment.c2, segment.to, i / steps));
      }
    }
  }
  return points;
}

/**
 * How far a point can travel in one direction before it meets the outline.
 *
 * Used to know how much room a stroke has before its two sides run into each
 * other. Measured against flattened contours rather than the curves themselves:
 * this only has to bound a movement, and a polyline is exact enough for that
 * while being cheap enough to do for every point of a glyph.
 *
 * Returns Infinity when nothing is in the way.
 */
export function rayHitDistance(polylines: Vec2[][], from: Vec2, direction: Vec2): number {
  // Ignore hits on top of the starting point, which is the outline it sits on.
  const MINIMUM = 1e-6;
  let nearest = Infinity;

  for (const points of polylines) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denominator = direction.x * ey - direction.y * ex;
      if (Math.abs(denominator) < 1e-12) continue; // parallel

      const dx = a.x - from.x;
      const dy = a.y - from.y;
      const t = (dx * ey - dy * ex) / denominator;
      // How far along the edge the crossing falls. Dividing by the negated
      // denominator here put this the wrong way round, which accepted crossings
      // with the line behind each edge instead of with the edge itself: a point
      // in clear air read as blocked four units away, and the counter of an o
      // was refused permission to open at all.
      const u = (dx * direction.y - dy * direction.x) / denominator;
      if (t > MINIMUM && u >= 0 && u <= 1 && t < nearest) nearest = t;
    }
  }

  return nearest;
}

export function centroid(contour: Contour): Vec2 {
  const points = flattenContour(contour, 8);
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Render contours into a Path2D for canvas drawing. */
/**
 * Where a straight line across a glyph passes through ink.
 *
 * The primitive behind every measurement made by looking at a letter rather
 * than by being told about it: how thick a stem is, how wide a counter is,
 * whether a stroke has a serif on the end of it. All of those are a question
 * about what a ruler laid across the letter would meet, and this is the ruler.
 *
 * Runs come back in order and in pairs of edges, so a stem is one run and an
 * n at mid-height is two with the counter between them. An odd number of
 * crossings means the line grazed a tangent or clipped a corner exactly, and
 * the last one is dropped rather than paired with nothing.
 *
 * Measured against flattened outlines. The answer feeds a width in font units
 * where a unit is a thousandth of the type size, and solving cubics for a line
 * that only has to be right to within a unit is work for nothing.
 */
export function inkRunsAt(
  contours: Contour[],
  at: number,
  along: "x" | "y" = "y",
  steps = 24,
): Array<[number, number]> {
  const crossings: number[] = [];
  for (const contour of contours) {
    const points = flattenContour(contour, steps);
    for (let index = 0; index < points.length; index++) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      // Scanning along y means a horizontal ruler and a crossing wherever the
      // edge changes its y; along x it is the other way about.
      const from = along === "y" ? a.y : a.x;
      const to = along === "y" ? b.y : b.x;
      if (from === to) continue;
      if (at < Math.min(from, to) || at >= Math.max(from, to)) continue;
      const t = (at - from) / (to - from);
      crossings.push(along === "y" ? a.x + t * (b.x - a.x) : a.y + t * (b.y - a.y));
    }
  }
  crossings.sort((first, second) => first - second);

  const runs: Array<[number, number]> = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    runs.push([crossings[index], crossings[index + 1]]);
  }
  return runs;
}

export function contoursToPath2D(contours: Contour[]): Path2D {
  const path = new Path2D();
  for (const contour of contours) {
    if (contour.nodes.length === 0) continue;
    const start = contour.nodes[0].point;
    path.moveTo(start.x, start.y);
    for (const segment of contourSegments(contour)) {
      if (segment.kind === "line") path.lineTo(segment.to.x, segment.to.y);
      else
        path.bezierCurveTo(
          segment.c1.x,
          segment.c1.y,
          segment.c2.x,
          segment.c2.y,
          segment.to.x,
          segment.to.y,
        );
    }
    if (contour.closed) path.closePath();
  }
  return path;
}

/** Render contours as an SVG path string, for previews and SVG export. */
export function contoursToSvgPath(contours: Contour[], round = 2): string {
  const n = (v: number) => Number(v.toFixed(round));
  const parts: string[] = [];
  for (const contour of contours) {
    if (contour.nodes.length === 0) continue;
    const start = contour.nodes[0].point;
    parts.push(`M${n(start.x)} ${n(start.y)}`);
    for (const segment of contourSegments(contour)) {
      if (segment.kind === "line") parts.push(`L${n(segment.to.x)} ${n(segment.to.y)}`);
      else
        parts.push(
          `C${n(segment.c1.x)} ${n(segment.c1.y)} ${n(segment.c2.x)} ${n(segment.c2.y)} ${n(segment.to.x)} ${n(segment.to.y)}`,
        );
    }
    if (contour.closed) parts.push("Z");
  }
  return parts.join("");
}
