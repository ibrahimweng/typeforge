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

/** Parameter values where a cubic reaches a horizontal or vertical extreme. */
function cubicExtremeTs(from: Vec2, c1: Vec2, c2: Vec2, to: Vec2): number[] {
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
export function contoursToPath2D(contours: Contour[]): Path2D {
  const path = new Path2D();
  for (const contour of contours) {
    if (contour.nodes.length === 0) continue;
    const start = contour.nodes[0].point;
    path.moveTo(start.x, start.y);
    for (const segment of contourSegments(contour)) {
      if (segment.kind === "line") path.lineTo(segment.to.x, segment.to.y);
      else path.bezierCurveTo(segment.c1.x, segment.c1.y, segment.c2.x, segment.c2.y, segment.to.x, segment.to.y);
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
