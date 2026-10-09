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

/** The length of a cubic from its start to parameter `t`. */
function lengthTo(curve: Cubic, t: number): number {
  if (t <= 0) return 0;
  const half = t / 2;
  let sum = 0;
  for (let k = 0; k < GAUSS_X.length; k++) {
    for (const sign of [-1, 1]) {
      const d = derivative(curve, half + sign * GAUSS_X[k] * half);
      sum += GAUSS_W[k] * Math.hypot(d.x, d.y);
    }
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
  if (isLine(from, to)) return Math.hypot(to.point.x - from.point.x, to.point.y - from.point.y);
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
  if (Math.hypot(d.x, d.y) < 1e-12) {
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
      if (Math.hypot(d.x, d.y) >= 1e-12) break;
    }
  }
  const length = Math.hypot(d.x, d.y);
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
    const whole = Math.hypot(to.point.x - from.point.x, to.point.y - from.point.y);
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

/**
 * Contours as polygons: each straight edge one chord, each curve `chords`
 * chords. An open contour is closed back to its start, as a fill would.
 */
export function flatten(contours: Contour[], chords = 12): Flat {
  const polygons: Flat["polygons"] = [];
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
      const curve = cubicOf(from, to);
      for (let step = 1; step < chords; step++) points.push(bezier(curve, step / chords));
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
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
      if (a.y <= point.y) {
        if (b.y > point.y && side > 0) winding += 1;
      } else if (b.y <= point.y && side < 0) {
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
