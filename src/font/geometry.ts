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
 * How near a crossing of a reshaped outline must come to one of the
 * drawing's, carried along, to be taken for it, as a share of the size of the
 * outline: for the unit or two by which flattening places a crossing. Where
 * two curves cross at a shallow angle, a nudge of a unit can turn the one
 * crossing of their flattened pieces into three at the same place.
 */
const NEAR = 0.01;

/**
 * And how much further, for each unit the reshaping moved apart the places
 * on the two curves that met. Two curves that move together carry their
 * crossing with them, to the unit; where one moves across the other, the
 * crossing slides along the one that stood by more than it moved -- three
 * times as much where they meet at twenty-five degrees.
 */
const CARRIED = 3;

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
 * that -- is not let off. Each of its crossings is recorded where it is, on
 * which two curves and how far along each, and a reshaping may carry those
 * with the curves but add none: every crossing of the trial must be one of
 * the drawing's carried along, on the same two curves or the next ones and
 * near where the trial's own curves put it. One undone at the top of a
 * letter and another tied at the bottom is a new crossing, not a trade;
 * three where two curves nearly touching made one are still that one.
 *
 * The trial is taken point for point with the drawing, as every reshaping
 * but a corner radius leaves it. Given a `reach` it is not -- a radius merges
 * points and adds others, and the curves no longer line up by their places
 * -- and a crossing need only lie within that of one of the drawing's. The
 * drawn outline is asked once, and only when a trial crosses at all.
 */
export function crossesMoreThan(
  drawn: Contour,
  steps = 8,
): (trial: Contour, reach?: number) => boolean {
  const laid = laidOut(drawn, steps);
  let had: Crossing[] | undefined;
  return (trial, reach) => {
    const lay = laidOut(trial, steps);
    // Where the drawing crosses nowhere, one crossing is all there is to know.
    if (had === undefined || had.length === 0) {
      if (selfCrossings(lay, 1).length === 0) return false;
      had ??= selfCrossings(laid, Infinity);
      if (had.length === 0) return true;
    }
    const matched = reach === undefined && sameShape(drawn, trial);
    const outline = outlineOf(trial, lay);
    const near = nearness(laid.box);
    const carried = had.map((crossing) =>
      matched ? carriedTo(crossing, outline, outline, near) : within(crossing, near + (reach ?? 0)),
    );
    return selfCrossings(lay, Infinity).some((crossing) => !carried.some((is) => is(crossing)));
  };
}

/**
 * The same asked of a letter's contours against each other: a test of
 * whether reshaped contours, each point for point with the drawn one in its
 * place, cross one another anywhere the drawing did not.
 *
 * Contours that overlap as drawn -- an unmerged font -- may carry their
 * overlap along with their walls, as one outline may its crossings; a wall
 * driven through another anywhere else, the far side of the stem it
 * overlapped included, is refused. A pair the trial leaves as drawn, the
 * same two outlines, is not asked again, and each outline is laid out once
 * for every trial and every pair it is in.
 */
export function overlapsMoreThan(drawn: Contour[], steps = 8): (trial: Contour[]) => boolean {
  const laid = new Map<Contour, Laid>();
  const lay = (contour: Contour): Laid => {
    let had = laid.get(contour);
    if (!had) {
      had = laidOut(contour, steps);
      laid.set(contour, had);
    }
    return had;
  };
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
  return (trial) => {
    for (let one = 0; one < trial.length; one++)
      for (let other = one + 1; other < trial.length; other++) {
        if (trial[one] === drawn[one] && trial[other] === drawn[other]) continue;
        const first = lay(trial[one]);
        const second = lay(trial[other]);
        if (misses(first.box, second.box)) continue;
        const known = drawnPairs.get(`${one}:${other}`);
        let found = crossingsBetween(first, second, known?.length ? Infinity : 1);
        if (found.length === 0) continue;
        const had = drawnBetween(one, other);
        if (had.length === 0) return true;
        if (!known?.length) found = crossingsBetween(first, second, Infinity);
        const matched = sameShape(drawn[one], trial[one]) && sameShape(drawn[other], trial[other]);
        const near = nearness(union(lay(drawn[one]).box, lay(drawn[other]).box));
        const oneOutline = outlineOf(trial[one], first);
        const otherOutline = outlineOf(trial[other], second);
        const carried = had.map((crossing) =>
          matched ? carriedTo(crossing, oneOutline, otherOutline, near) : within(crossing, near),
        );
        if (found.some((crossing) => !carried.some((is) => is(crossing)))) return true;
      }
    return false;
  };
}

/** A place on an outline: which of its pieces, as `contourSegments` lists them, and how far along. */
interface Along {
  place: number;
  t: number;
}

/** Where an outline crosses itself, or two cross each other, and on which curves. */
interface Crossing {
  at: Vec2;
  one: Along;
  other: Along;
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
      });
      if (found.length >= limit) return;
    }
  }
}

/** Where two straight pieces properly cross, and how far along each. */
function crossingOf(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { at: Vec2; u: number; v: number } | null {
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const one = side(a, b, c);
  const two = side(a, b, d);
  const three = side(c, d, a);
  const four = side(c, d, b);
  if (!(one * two < 0 && three * four < 0)) return null;
  const u = three / (three - four);
  return { at: lerp(a, b, u), u, v: one / (one - two) };
}

/** A reshaped outline's pieces, whether it closes, and which pieces have length. */
interface Outline {
  segments: Segment[];
  closed: boolean;
  live: Set<number>;
}

function outlineOf(contour: Contour, laid: Laid): Outline {
  return {
    segments: contourSegments(contour),
    closed: contour.closed,
    live: new Set(laid.pieces.map((piece) => piece.place)),
  };
}

/**
 * A test of whether a crossing of the reshaped outlines is `drawn` carried
 * along: between the same two curves, or on the next along either way where
 * it slid past the point at an end -- the next with any length, past those a
 * swallowed corner left on one spot -- and near where the reshaping put the
 * places on each that met, by no more than a few times as far as it moved
 * them apart. Two curves that were pulled off each other and cross somewhere
 * else, the far side of a stem a wall was driven through, have made a new
 * crossing.
 */
function carriedTo(
  drawn: Crossing,
  one: Outline,
  other: Outline,
  near: number,
): (found: Crossing) => boolean {
  const a = pointAlong(one.segments, drawn.one);
  const b = pointAlong(other.segments, drawn.other);
  if (!a || !b) return () => false;
  const at = lerp(a, b, 0.5);
  const slack = near + CARRIED * distance(a, b);
  return (found) =>
    distance(found.at, at) <= slack &&
    ((beside(found.one, drawn.one, one) && beside(found.other, drawn.other, other)) ||
      // One outline's two curves may be found the other way round.
      (one === other &&
        beside(found.one, drawn.other, one) &&
        beside(found.other, drawn.one, other)));
}

/** Whether `found` is on the piece `was` is, or the next with length either way. */
function beside(found: Along, was: Along, outline: Outline): boolean {
  if (found.place === was.place) return true;
  const count = outline.segments.length;
  for (const way of [1, -1]) {
    let place = was.place;
    for (let step = 0; step < count; step++) {
      place += way;
      if (outline.closed) place = (place + count) % count;
      else if (place < 0 || place >= count) break;
      if (place === found.place) return true;
      if (outline.live.has(place)) break;
    }
  }
  return false;
}

/** And where the pieces do not line up, only near where it was. */
function within(drawn: Crossing, slack: number): (found: Crossing) => boolean {
  return (found) => distance(found.at, drawn.at) <= slack;
}

function pointAlong(segments: Segment[], along: Along): Vec2 | null {
  const segment = segments[along.place];
  if (!segment) return null;
  return segment.kind === "line"
    ? lerp(segment.from, segment.to, along.t)
    : cubicAt(segment.from, segment.c1, segment.c2, segment.to, along.t);
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
