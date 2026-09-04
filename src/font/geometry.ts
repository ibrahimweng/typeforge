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
 * almost every pair misses. Only the survivors are flattened and tested, so an
 * outline that does not double back pays a few hundred rectangle comparisons.
 *
 * Segments that share an end are skipped. Every contour touches itself there,
 * and a touch is not a crossing.
 */
export function crossesItself(contour: Contour): boolean {
  const segments = contourSegments(contour);
  if (segments.length < 4) return false;

  /* The control polygon bounds the curve, which is all a rejection needs. */
  const boxes = segments.map((segment) => {
    const points =
      segment.kind === "line"
        ? [segment.from, segment.to]
        : [segment.from, segment.c1, segment.c2, segment.to];
    return {
      xMin: Math.min(...points.map((one) => one.x)),
      xMax: Math.max(...points.map((one) => one.x)),
      yMin: Math.min(...points.map((one) => one.y)),
      yMax: Math.max(...points.map((one) => one.y)),
    };
  });

  const STEPS = 8;
  const flattened = new Map<number, Vec2[]>();
  const flatOf = (index: number): Vec2[] => {
    const had = flattened.get(index);
    if (had) return had;
    const segment = segments[index];
    const points: Vec2[] = [segment.from];
    if (segment.kind === "line") points.push(segment.to);
    else
      for (let step = 1; step <= STEPS; step++)
        points.push(cubicAt(segment.from, segment.c1, segment.c2, segment.to, step / STEPS));
    flattened.set(index, points);
    return points;
  };

  const count = segments.length;
  for (let one = 0; one < count; one++) {
    for (let other = one + 1; other < count; other++) {
      // Neighbours share an end, and on a closed contour so do the two ends.
      if (other === one + 1) continue;
      if (contour.closed && one === 0 && other === count - 1) continue;
      const a = boxes[one];
      const b = boxes[other];
      if (a.xMax < b.xMin || b.xMax < a.xMin || a.yMax < b.yMin || b.yMax < a.yMin) continue;
      if (meets(flatOf(one), flatOf(other))) return true;
    }
  }
  return false;
}

/** Whether two polylines properly cross, ends touching not counted. */
function meets(one: Vec2[], other: Vec2[]): boolean {
  for (let i = 0; i + 1 < one.length; i++) {
    for (let j = 0; j + 1 < other.length; j++) {
      if (crossing(one[i], one[i + 1], other[j], other[j + 1])) return true;
    }
  }
  return false;
}

function crossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const one = side(a, b, c);
  const two = side(a, b, d);
  const three = side(c, d, a);
  const four = side(c, d, b);
  return one * two < 0 && three * four < 0;
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
