/**
 * The geometry the soft finishes are built from: a corner turned on a radius,
 * an edge cut at a length along it, and a question about which side of an
 * outline a point is on.
 *
 * Nothing here is called on the way an existing face is drawn. Each finish
 * that uses these is switched on by a field of the style that no base sets,
 * and a letter drawn without one never reaches this file.
 *
 * Every search is a fixed number of steps, so the same question asked at two
 * weights does the same work and cannot come out with a different number of
 * anything. An edge here is the cubic between two nodes, read the way the rest
 * of the application reads one: from a node's point by its `handleOut`, to the
 * next node's point by its `handleIn`, and a straight line where both handles
 * are missing.
 */

import type { Contour, GlyphNode, Vec2 } from "@/font/types";

/** The four points of the edge from one node to the next. */
type Cubic = [Vec2, Vec2, Vec2, Vec2];

function cubicOf(from: GlyphNode, to: GlyphNode): Cubic {
  return [from.point, from.handleOut ?? from.point, to.handleIn ?? to.point, to.point];
}

/** Whether the edge between two nodes is a straight line: neither handle there. */
function isLine(from: GlyphNode, to: GlyphNode): boolean {
  return from.handleOut === null && to.handleIn === null;
}

/**
 * The length of the vector (x, y): the very number `Math.hypot(x, y)` gives,
 * worked out step for step as V8 works it out -- the larger magnitude taken
 * out, the two squares summed with Kahan's compensation, the root of the sum
 * scaled back -- so to the last bit the same, infinite where either is,
 * otherwise not a number where either is not, and nought for two noughts.
 *
 * Written out because `Math.hypot` takes any number of arguments and gathers
 * them into a new array on every call, which made it the dearest step of the
 * soft finishes' searches: an edge's length alone asks it sixteen times, and
 * a cut at a length along an edge asks for thirty-three lengths. Only the
 * finishes here and in the files that draw them use it; everything an
 * existing face draws still asks `Math.hypot` itself.
 */
export function hypot(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let max = 0;
  let nan = false;
  if (Number.isNaN(x)) nan = true;
  else if (ax > max) max = ax;
  if (Number.isNaN(y)) nan = true;
  else if (ay > max) max = ay;
  if (max === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (nan) return Number.NaN;
  if (max === 0) return 0;
  let sum = 0;
  let compensation = 0;
  let n = ax / max;
  let summand = n * n - compensation;
  let preliminary = sum + summand;
  compensation = preliminary - sum - summand;
  sum = preliminary;
  n = ay / max;
  summand = n * n - compensation;
  preliminary = sum + summand;
  compensation = preliminary - sum - summand;
  sum = preliminary;
  return Math.sqrt(sum) * max;
}

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

function bezier([p0, p1, p2, p3]: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function derivative([p0, p1, p2, p3]: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return {
    x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
    y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y),
  };
}

/**
 * How long a handle is for every unit of tangent length, on a circular arc
 * turning through `theta` radians.
 *
 * A corner turned on a radius r touches its two edges a tangent length
 * r·tan(θ/2) back from the point, and the cubic that best writes that arc has
 * handles (4/3)·tan(θ/4)·r long -- the same factor `ellipseNodes` in sweep.ts
 * uses. Divided through, the radius drops out: at a right angle this is 0.5523
 * of the tangent length, and it runs from two thirds for a turn of nothing to
 * nought for a turn right back on itself.
 */
export function kappa(theta: number): number {
  const turn = Math.abs(theta);
  if (turn < 1e-9) return 2 / 3;
  if (turn >= Math.PI) return 0;
  return ((4 / 3) * Math.tan(turn / 4)) / Math.tan(turn / 2);
}

/*
 * Sixteen-point Gauss-Legendre: the abscissae on one side of the middle of
 * [-1, 1] and their weights. A cubic's speed is the square root of a quartic,
 * and sixteen points integrate it to far below a millionth of a unit for any
 * edge a letter draws.
 */
const GAUSS_X = [
  0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.755404408355003,
  0.8656312023878318, 0.9445750230732326, 0.9894009349916499,
];
const GAUSS_W = [
  0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767,
  0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541,
];

/**
 * The length of a cubic from its start to parameter `t`.
 *
 * Each point is `derivative` at the node below the middle and then above it,
 * written out here so that the search in `parameterAt`, which asks this 32
 * times an edge, makes no objects: the same sums in the same order.
 */
function lengthTo([p0, p1, p2, p3]: Cubic, t: number): number {
  if (t <= 0) return 0;
  const half = t / 2;
  const x1 = p1.x - p0.x;
  const y1 = p1.y - p0.y;
  const x2 = p2.x - p1.x;
  const y2 = p2.y - p1.y;
  const x3 = p3.x - p2.x;
  const y3 = p3.y - p2.y;
  const speed = (at: number): number => {
    const u = 1 - at;
    const a = 3 * u * u;
    const b = 6 * u * at;
    const c = 3 * at * at;
    return hypot(a * x1 + b * x2 + c * x3, a * y1 + b * y2 + c * y3);
  };
  let sum = 0;
  for (let k = 0; k < GAUSS_X.length; k++) {
    sum += GAUSS_W[k] * speed(half + -1 * GAUSS_X[k] * half);
    sum += GAUSS_W[k] * speed(half + 1 * GAUSS_X[k] * half);
  }
  return sum * half;
}

/** How far along a cubic `length` falls, by 32 halvings of [0, 1]. */
function parameterAt(curve: Cubic, length: number): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 32; step++) {
    const middle = (low + high) / 2;
    if (lengthTo(curve, middle) < length) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** The length of the edge from one node to the next. */
export function edgeLength(from: GlyphNode, to: GlyphNode): number {
  if (isLine(from, to)) return hypot(to.point.x - from.point.x, to.point.y - from.point.y);
  return lengthTo(cubicOf(from, to), 1);
}

/** The point at parameter `t` on the edge from one node to the next. */
export function pointAt(from: GlyphNode, to: GlyphNode, t: number): Vec2 {
  if (isLine(from, to)) return lerp(from.point, to.point, t);
  return bezier(cubicOf(from, to), t);
}

/**
 * The unit direction of travel at parameter `t` on the edge from one node to
 * the next.
 *
 * Where a handle of no length leaves the derivative at nought -- at an end of
 * an edge whose handle there sits on its own point -- the direction is the
 * curve's limiting one, toward the next control point that is not on the
 * same spot. An edge whose four points are all one point has none, and
 * answers with nought.
 */
export function tangentAt(from: GlyphNode, to: GlyphNode, t: number): Vec2 {
  const curve = cubicOf(from, to);
  let d = derivative(curve, t);
  if (hypot(d.x, d.y) < 1e-12) {
    const [p0, p1, p2, p3] = curve;
    const pairs: Array<[Vec2, Vec2]> =
      t < 0.5
        ? [
            [p0, p1],
            [p0, p2],
            [p0, p3],
          ]
        : [
            [p2, p3],
            [p1, p3],
            [p0, p3],
          ];
    for (const [a, b] of pairs) {
      d = { x: b.x - a.x, y: b.y - a.y };
      if (hypot(d.x, d.y) >= 1e-12) break;
    }
  }
  const length = hypot(d.x, d.y);
  return length < 1e-12 ? { x: 0, y: 0 } : { x: d.x / length, y: d.y / length };
}

/**
 * The edge from one node to the next cut in two where it has run `length`
 * along itself.
 *
 * Handed back as three nodes: the first with its leaving handle shortened, the
 * new node, and the last with its arriving handle shortened. A straight edge
 * cuts into two straight ones and a curve into two curves -- the new node has
 * both handles on a curve and neither on a line -- so cutting never changes
 * what kind of edge anything is. A handle that was missing stays missing. The
 * length is held to the edge's own; the search is a fixed 32 halvings over a
 * 16-point length, so it costs the same however it is asked.
 */
export function splitEdgeAtLength(
  from: GlyphNode,
  to: GlyphNode,
  length: number,
): { from: GlyphNode; at: GlyphNode; to: GlyphNode } {
  if (isLine(from, to)) {
    const whole = hypot(to.point.x - from.point.x, to.point.y - from.point.y);
    const t = whole > 0 ? Math.min(1, Math.max(0, length / whole)) : 0;
    return {
      from: { ...from },
      at: { point: lerp(from.point, to.point, t), handleIn: null, handleOut: null, type: "corner" },
      to: { ...to },
    };
  }
  const curve = cubicOf(from, to);
  const whole = lengthTo(curve, 1);
  const t = length <= 0 ? 0 : length >= whole ? 1 : parameterAt(curve, length);
  // De Casteljau at t.
  const [p0, p1, p2, p3] = curve;
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  const ab = lerp(a, b, t);
  const bc = lerp(b, c, t);
  const point = lerp(ab, bc, t);
  return {
    from: { ...from, handleOut: from.handleOut === null ? null : a },
    at: { point, handleIn: ab, handleOut: bc, type: "smooth" },
    to: { ...to, handleIn: to.handleIn === null ? null : c },
  };
}

/**
 * A closed contour's node turned into a rounded corner.
 *
 * Node `index` is replaced by two: A, `inLength` back along the edge arriving
 * at it, and B, `outLength` on along the edge leaving it, measured along those
 * edges. The edge from A to B is always a curve whose handles lie along the
 * two edges' own directions at A and B, `kappa(θ)` times the length each side
 * gave, where θ is the turn between those directions. Given the same length
 * both sides of a corner between straight edges, that is a circular arc
 * touching both, to the error of writing an arc as one cubic: three parts in
 * ten thousand of its radius at a right angle, fifteen at 120 degrees.
 *
 * Always one node more, with both new handles present even where a length is
 * nought, so a corner rounded on no room is the same points as one rounded on
 * plenty. The two edges that were cut keep their kinds. The lengths are held
 * to the edges they are measured along.
 */
export function roundNodeCorner(
  nodes: GlyphNode[],
  index: number,
  inLength: number,
  outLength: number,
): GlyphNode[] {
  const count = nodes.length;
  const before = (index - 1 + count) % count;
  const after = (index + 1) % count;
  const corner = nodes[index];

  const arriving = edgeLength(nodes[before], corner);
  const leaving = edgeLength(corner, nodes[after]);
  const back = Math.min(Math.max(0, inLength), arriving);
  const on = Math.min(Math.max(0, outLength), leaving);

  const into = splitEdgeAtLength(nodes[before], corner, arriving - back);
  const outOf = splitEdgeAtLength(corner, nodes[after], on);
  /*
   * The directions of travel at A and at B, on the edges they were cut from:
   * asked of the piece either side of the cut, and of the whole edge at the
   * corner where both pieces have no length to have a direction with.
   */
  const first = (...ways: Vec2[]): Vec2 =>
    ways.find((one) => one.x !== 0 || one.y !== 0) ?? ways[0];
  const tA = first(
    tangentAt(into.from, into.at, 1),
    tangentAt(into.at, into.to, 0),
    tangentAt(nodes[before], corner, 1),
  );
  const tB = first(
    tangentAt(outOf.at, outOf.to, 0),
    tangentAt(outOf.from, outOf.at, 1),
    tangentAt(corner, nodes[after], 0),
  );
  const theta = Math.atan2(tA.x * tB.y - tA.y * tB.x, tA.x * tB.x + tA.y * tB.y);
  const k = kappa(theta);

  const a: GlyphNode = {
    point: into.at.point,
    handleIn: into.at.handleIn,
    handleOut: { x: into.at.point.x + tA.x * k * back, y: into.at.point.y + tA.y * k * back },
    type: "smooth",
  };
  const b: GlyphNode = {
    point: outOf.at.point,
    handleIn: { x: outOf.at.point.x - tB.x * k * on, y: outOf.at.point.y - tB.y * k * on },
    handleOut: outOf.at.handleOut,
    type: "smooth",
  };

  const out = nodes.map((node) => node);
  out[before] = { ...nodes[before], handleOut: into.from.handleOut };
  out[after] = { ...out[after], handleIn: outOf.to.handleIn };
  out.splice(index, 1, a, b);
  return out;
}

/** An outline flattened to polygons, each with its box, for asking what is inside. */
export interface Flat {
  polygons: Array<{
    points: Vec2[];
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  }>;
}

/** The weights `bezier` gives a cubic's four points at each step of so many chords, by count. */
const WEIGHTS = new Map<number, Float64Array>();

/**
 * The four weights `bezier` works out at `step / chords` for every step of
 * `chords`, worked out once for each count the very way `bezier` does.
 */
function weightsOf(chords: number): Float64Array {
  let weights = WEIGHTS.get(chords);
  if (weights === undefined) {
    weights = new Float64Array(Math.max(0, Math.ceil(chords)) * 4);
    for (let step = 1; step < chords; step++) {
      const t = step / chords;
      const u = 1 - t;
      weights[step * 4] = u * u * u;
      weights[step * 4 + 1] = 3 * u * u * t;
      weights[step * 4 + 2] = 3 * u * t * t;
      weights[step * 4 + 3] = t * t * t;
    }
    WEIGHTS.set(chords, weights);
  }
  return weights;
}

/**
 * Contours as polygons: each straight edge one chord, each curve `chords`
 * chords. An open contour is closed back to its start, as a fill would.
 */
export function flatten(contours: Contour[], chords = 12): Flat {
  const polygons: Flat["polygons"] = [];
  const weights = weightsOf(chords);
  for (const contour of contours) {
    const { nodes } = contour;
    if (nodes.length === 0) continue;
    const points: Vec2[] = [];
    const edges = contour.closed ? nodes.length : nodes.length - 1;
    for (let edge = 0; edge < edges; edge++) {
      const from = nodes[edge];
      const to = nodes[(edge + 1) % nodes.length];
      points.push(from.point);
      if (isLine(from, to)) continue;
      const [p0, p1, p2, p3] = cubicOf(from, to);
      // `bezier` at each step, its four weights made once for the count.
      for (let step = 1; step < chords; step++) {
        const a = weights[step * 4];
        const b = weights[step * 4 + 1];
        const c = weights[step * 4 + 2];
        const d = weights[step * 4 + 3];
        points.push({
          x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
          y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
        });
      }
    }
    if (!contour.closed) points.push(nodes[nodes.length - 1].point);
    let xMin = Infinity;
    let yMin = Infinity;
    let xMax = -Infinity;
    let yMax = -Infinity;
    for (const point of points) {
      xMin = Math.min(xMin, point.x);
      yMin = Math.min(yMin, point.y);
      xMax = Math.max(xMax, point.x);
      yMax = Math.max(yMax, point.y);
    }
    polygons.push({ points, xMin, yMin, xMax, yMax });
  }
  return { polygons };
}

/**
 * How many times the flattened outline winds round a point, anticlockwise
 * counted up: nought outside under the non-zero rule, anything else inside.
 * A polygon whose box does not hold the point is passed over without being
 * walked.
 */
export function windingAt(flat: Flat, point: Vec2): number {
  let winding = 0;
  for (const polygon of flat.polygons) {
    if (
      point.x < polygon.xMin ||
      point.x > polygon.xMax ||
      point.y < polygon.yMin ||
      point.y > polygon.yMax
    ) {
      continue;
    }
    const { points } = polygon;
    // Which side of an edge the point is on, asked only of an edge that crosses its level.
    const side = (a: Vec2, b: Vec2) =>
      (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      if (a.y <= point.y) {
        if (b.y > point.y && side(a, b) > 0) winding += 1;
      } else if (b.y <= point.y && side(a, b) < 0) {
        winding -= 1;
      }
    }
  }
  return winding;
}

/**
 * Twice the signed area of the polygon `flatten` makes of one closed contour,
 * summed over its edges in the order it lays its points, the edge back from
 * the last to the first coming last, without making the polygon: the same
 * sum, to the last bit, of the same numbers.
 */
export function flattenedArea(contour: Contour, chords = 12): number {
  const { nodes } = contour;
  if (nodes.length === 0) return 0;
  const weights = weightsOf(chords);
  let area = 0;
  let firstX = 0;
  let firstY = 0;
  let lastX = 0;
  let lastY = 0;
  let any = false;
  const add = (x: number, y: number) => {
    if (any) area += lastX * y - x * lastY;
    else {
      firstX = x;
      firstY = y;
      any = true;
    }
    lastX = x;
    lastY = y;
  };
  const edges = contour.closed ? nodes.length : nodes.length - 1;
  for (let edge = 0; edge < edges; edge++) {
    const from = nodes[edge];
    const to = nodes[(edge + 1) % nodes.length];
    add(from.point.x, from.point.y);
    if (isLine(from, to)) continue;
    const [p0, p1, p2, p3] = cubicOf(from, to);
    for (let step = 1; step < chords; step++) {
      const a = weights[step * 4];
      const b = weights[step * 4 + 1];
      const c = weights[step * 4 + 2];
      const d = weights[step * 4 + 3];
      add(a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y);
    }
  }
  if (!contour.closed) add(nodes[nodes.length - 1].point.x, nodes[nodes.length - 1].point.y);
  // And back round to the first, as the polygon closes.
  if (any) area += lastX * firstY - firstX * lastY;
  return area;
}

/**
 * An outline flattened as `flatten` flattens it, each polygon's points kept
 * as two rows of numbers rather than as points: the same numbers in the same
 * order, and the same box, for asking many questions of one outline without
 * making an object of every point.
 */
export interface Rows {
  polygons: Array<{
    xs: Numbers;
    ys: Numbers;
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  }>;
}

/**
 * A row of numbers: kept as a plain array where it is made here, which costs
 * far less to make than a typed one, or as a typed one where it is handed in.
 */
export type Numbers = Float64Array | number[];

/** `flatten`, into rows: see `Rows`. */
export function flattenRows(contours: Contour[], chords = 12): Rows {
  const polygons: Rows["polygons"] = [];
  const weights = weightsOf(chords);
  for (const contour of contours) {
    const { nodes } = contour;
    if (nodes.length === 0) continue;
    const edges = contour.closed ? nodes.length : nodes.length - 1;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let edge = 0; edge < edges; edge++) {
      const from = nodes[edge];
      const to = nodes[(edge + 1) % nodes.length];
      xs.push(from.point.x);
      ys.push(from.point.y);
      if (isLine(from, to)) continue;
      const [p0, p1, p2, p3] = cubicOf(from, to);
      for (let step = 1; step < chords; step++) {
        const a = weights[step * 4];
        const b = weights[step * 4 + 1];
        const c = weights[step * 4 + 2];
        const d = weights[step * 4 + 3];
        xs.push(a * p0.x + b * p1.x + c * p2.x + d * p3.x);
        ys.push(a * p0.y + b * p1.y + c * p2.y + d * p3.y);
      }
    }
    if (!contour.closed) {
      xs.push(nodes[nodes.length - 1].point.x);
      ys.push(nodes[nodes.length - 1].point.y);
    }
    const count = xs.length;
    let xMin = Infinity;
    let yMin = Infinity;
    let xMax = -Infinity;
    let yMax = -Infinity;
    for (let k = 0; k < count; k++) {
      xMin = Math.min(xMin, xs[k]);
      yMin = Math.min(yMin, ys[k]);
      xMax = Math.max(xMax, xs[k]);
      yMax = Math.max(yMax, ys[k]);
    }
    polygons.push({ xs, ys, xMin, yMin, xMax, yMax });
  }
  return { polygons };
}

/**
 * A flattened outline made ready to be asked many questions about where it
 * is (see `banded`): each polygon's edges filed into bands by height, so a
 * question about a point is asked only of the edges at that height.
 */
export interface Banded {
  polygons: Array<{
    /** The polygon's box, as `windingAt` reads it. */
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
    /** Its points, as `flattenRows` laid them: edge `k` runs from point `k` to the next. */
    xs: Numbers;
    ys: Numbers;
    /** Each edge's four numbers in a row, from x and y then to x and y: edge `k` from `4k` on. */
    ends: number[];
    /**
     * Whether any of its numbers is not finite. Such a polygon is not filed:
     * every question walks it whole, as `windingAt` walks it.
     */
    whole: boolean;
    /** How many bands from the bottom of its box to the top, and how tall each is. */
    count: number;
    step: number;
    /**
     * Where each band's edges start in `edges`, and where the last ends: band
     * `k` runs from `starts[k]` up to `starts[k + 1]`.
     */
    starts: number[];
    /** Every band's edges in turn, each by where its numbers start in `ends`, filed under every band its height spans. */
    edges: number[];
  }>;
}

/** About how many edges a band holds, before the edges that cross several. */
const BAND_EDGES = 8;

/** The band a height falls in, which is never less where the height is more. */
export function bandAt(y: number, low: number, step: number, count: number): number {
  return count === 1 ? 0 : Math.min(count - 1, Math.max(0, Math.floor((y - low) / step)));
}

/** Each point's band, for `banded`: kept between calls, and grown as it must be. */
let BANDS_OF = new Int32Array(0);

/**
 * An outline flattened by `flattenRows`, filed for `windingIn` and for the
 * questions `teardropsFor` asks of a stroke's ink: every edge filed under each
 * band of height it spans, from its lower end's band to its upper end's, so a
 * point is asked only of the edges in its own band. An edge winds round a
 * point only where the point's height lies from its lower end up to (not
 * including) its upper one, and the band a height falls in never decreases as
 * the height rises, so every edge that could count for a point is in that
 * point's band, and each is counted there with the very numbers `windingAt`
 * counts it with: the same winding, to the last bit, for many fewer edges
 * walked. Each edge is filed by its index, so however many bands it spans its
 * numbers are the polygon's own.
 */
export function banded(flat: Rows): Banded {
  const polygons: Banded["polygons"] = [];
  for (const polygon of flat.polygons) {
    const { xs, ys, xMin, yMin, xMax, yMax } = polygon;
    const length = xs.length;
    let finite = true;
    for (let k = 0; k < length; k++) {
      if (!Number.isFinite(xs[k]) || !Number.isFinite(ys[k])) {
        finite = false;
        break;
      }
    }
    if (!finite || length === 0) {
      polygons.push({
        xMin,
        yMin,
        xMax,
        yMax,
        xs,
        ys,
        ends: [],
        whole: true,
        count: 0,
        step: 0,
        starts: [0],
        edges: [],
      });
      continue;
    }
    let count = Math.max(1, Math.ceil(length / BAND_EDGES));
    let step = (yMax - yMin) / count;
    if (!(step > 0) || !Number.isFinite(step)) {
      count = 1;
      step = 0;
    }
    /*
     * Each point's band, once: as the band never decreases with the height,
     * the band of an edge's lower end is the lesser of its two ends' bands,
     * and of its upper end the greater.
     */
    if (BANDS_OF.length < length) BANDS_OF = new Int32Array(length * 2);
    const bandOf = BANDS_OF;
    for (let k = 0; k < length; k++) bandOf[k] = bandAt(ys[k], yMin, step, count);
    // How many edges each band holds, then where each band starts.
    const starts: number[] = new Array(count + 1).fill(0);
    for (let k = 0; k < length; k++) {
      const after = k + 1 === length ? 0 : k + 1;
      const last = Math.max(bandOf[k], bandOf[after]);
      for (let band = Math.min(bandOf[k], bandOf[after]); band <= last; band++) {
        starts[band + 1] += 1;
      }
    }
    for (let band = 0; band < count; band++) starts[band + 1] += starts[band];
    const next = starts.slice(0, count);
    const edges: number[] = new Array(starts[count]).fill(0);
    const ends: number[] = [];
    for (let k = 0; k < length; k++) {
      const after = k + 1 === length ? 0 : k + 1;
      ends.push(xs[k], ys[k], xs[after], ys[after]);
    }
    for (let k = 0; k < length; k++) {
      const after = k + 1 === length ? 0 : k + 1;
      const last = Math.max(bandOf[k], bandOf[after]);
      for (let band = Math.min(bandOf[k], bandOf[after]); band <= last; band++) {
        edges[next[band]] = k * 4;
        next[band] += 1;
      }
    }
    polygons.push({
      xMin,
      yMin,
      xMax,
      yMax,
      xs,
      ys,
      ends,
      whole: false,
      count,
      step,
      starts,
      edges,
    });
  }
  return { polygons };
}

/**
 * How many times a banded outline winds round a point: `windingAt`, edge for
 * edge, of the edges in the point's band (see `banded`), each polygon passed
 * over where its box does not hold the point.
 */
export function windingIn(flat: Banded, point: Vec2): number {
  let winding = 0;
  const { x, y } = point;
  for (const polygon of flat.polygons) {
    if (x < polygon.xMin || x > polygon.xMax || y < polygon.yMin || y > polygon.yMax) continue;
    const { xs, ys } = polygon;
    const length = xs.length;
    if (polygon.whole) {
      // Every edge, as `windingAt` walks them.
      for (let k = 0; k < length; k++) {
        const after = (k + 1) % length;
        const ax = xs[k];
        const ay = ys[k];
        const bx = xs[after];
        const by = ys[after];
        if (ay <= y) {
          if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) winding += 1;
        } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) {
          winding -= 1;
        }
      }
      continue;
    }
    // A height that is no number crosses no edge, as `windingAt` counts.
    if (!(y >= polygon.yMin)) continue;
    const band = bandAt(y, polygon.yMin, polygon.step, polygon.count);
    const { edges, starts, ends } = polygon;
    const end = starts[band + 1];
    for (let at = starts[band]; at < end; at++) {
      const e = edges[at];
      const ax = ends[e];
      const ay = ends[e + 1];
      const bx = ends[e + 2];
      const by = ends[e + 3];
      if (ay <= y) {
        if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) winding += 1;
      } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) {
        winding -= 1;
      }
    }
  }
  return winding;
}

/**
 * Where the line through `p` along `d` crosses the line through `q` along `e`:
 * the point, and how many of `d` and of `e` it lies from `p` and from `q`.
 * Nothing where the two are parallel.
 */
export function lineIntersection(
  p: Vec2,
  d: Vec2,
  q: Vec2,
  e: Vec2,
): { point: Vec2; s: number; t: number } | null {
  const denominator = d.x * e.y - d.y * e.x;
  if (Math.abs(denominator) < 1e-12) return null;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const s = (dx * e.y - dy * e.x) / denominator;
  const t = (dx * d.y - dy * d.x) / denominator;
  return { point: { x: p.x + d.x * s, y: p.y + d.y * s }, s, t };
}
