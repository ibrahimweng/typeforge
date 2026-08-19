/**
 * Conversion between the cubic curves we edit and the quadratic curves
 * TrueType stores.
 *
 * Going up (quadratic to cubic) on import is exact. Going back down on export
 * is an approximation, so a cubic is split until each piece is within
 * `tolerance` font units of a quadratic. At the default of half a unit the
 * difference is far below what any rasteriser can show.
 */

import { splitCubic } from "./geometry";
import type { Contour, GlyphNode, Vec2 } from "./types";

/** A single quadratic: one off-curve control point and the on-curve point it ends at. */
export interface QuadSegment {
  control: Vec2;
  to: Vec2;
}

/** Raise a quadratic to the cubic that draws exactly the same curve. */
export function quadraticToCubic(from: Vec2, control: Vec2, to: Vec2): { c1: Vec2; c2: Vec2 } {
  return {
    c1: { x: from.x + (2 / 3) * (control.x - from.x), y: from.y + (2 / 3) * (control.y - from.y) },
    c2: { x: to.x + (2 / 3) * (control.x - to.x), y: to.y + (2 / 3) * (control.y - to.y) },
  };
}

/**
 * How far a single quadratic would stray from this cubic.
 *
 * For the best-fit quadratic the deviation has a closed form, so no sampling is
 * needed: it is |P0 - 3·C1 + 3·C2 - P3| scaled by sqrt(3)/36.
 */
function approximationError(from: Vec2, c1: Vec2, c2: Vec2, to: Vec2): number {
  const dx = from.x - 3 * c1.x + 3 * c2.x - to.x;
  const dy = from.y - 3 * c1.y + 3 * c2.y - to.y;
  return (Math.sqrt(3) / 36) * Math.hypot(dx, dy);
}

/** Control point of the quadratic that best fits this cubic. */
function bestFitControl(from: Vec2, c1: Vec2, c2: Vec2, to: Vec2): Vec2 {
  return {
    x: (3 * c1.x - from.x + 3 * c2.x - to.x) / 4,
    y: (3 * c1.y - from.y + 3 * c2.y - to.y) / 4,
  };
}

/**
 * Approximate one cubic with a chain of quadratics, splitting where needed.
 * `depth` caps recursion so a degenerate curve cannot spin.
 */
export function cubicToQuadratics(
  from: Vec2,
  c1: Vec2,
  c2: Vec2,
  to: Vec2,
  tolerance = 0.5,
  depth = 0,
): QuadSegment[] {
  if (depth >= 10 || approximationError(from, c1, c2, to) <= tolerance) {
    return [{ control: bestFitControl(from, c1, c2, to), to }];
  }
  const [left, right] = splitCubic(from, c1, c2, to, 0.5);
  return [
    ...cubicToQuadratics(left[0], left[1], left[2], left[3], tolerance, depth + 1),
    ...cubicToQuadratics(right[0], right[1], right[2], right[3], tolerance, depth + 1),
  ];
}

/** A point as `glyf` stores it: a coordinate plus whether the outline touches it. */
export interface GlyfPoint {
  x: number;
  y: number;
  onCurve: boolean;
}

/**
 * Flatten a contour into the point list `glyf` expects.
 *
 * TrueType lets two off-curve points sit next to each other and implies an
 * on-curve point halfway between them. We drop the explicit point whenever it
 * really is the midpoint, which is what shipping fonts do and costs nothing to
 * read back.
 */
export function contourToGlyfPoints(contour: Contour, tolerance = 0.5): GlyfPoint[] {
  const { nodes, closed } = contour;
  if (nodes.length === 0) return [];

  const points: GlyfPoint[] = [{ x: nodes[0].point.x, y: nodes[0].point.y, onCurve: true }];
  const lastIndex = closed ? nodes.length : nodes.length - 1;

  for (let i = 0; i < lastIndex; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];

    if (!a.handleOut && !b.handleIn) {
      points.push({ x: b.point.x, y: b.point.y, onCurve: true });
      continue;
    }
    const quads = cubicToQuadratics(
      a.point,
      a.handleOut ?? a.point,
      b.handleIn ?? b.point,
      b.point,
      tolerance,
    );
    for (const quad of quads) {
      points.push({ x: quad.control.x, y: quad.control.y, onCurve: false });
      points.push({ x: quad.to.x, y: quad.to.y, onCurve: true });
    }
  }

  // The closing on-curve point repeats the start, which `glyf` does not store.
  if (closed && points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (last.onCurve && Math.abs(last.x - first.x) < 1e-6 && Math.abs(last.y - first.y) < 1e-6) {
      points.pop();
    }
  }
  return dropImpliedOnCurvePoints(points);
}

/** Remove on-curve points that sit exactly between their two off-curve neighbours. */
function dropImpliedOnCurvePoints(points: GlyfPoint[]): GlyfPoint[] {
  if (points.length < 3) return points;
  const out: GlyfPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const cur = points[i];
    const next = points[(i + 1) % points.length];
    const isImplied =
      cur.onCurve &&
      !prev.onCurve &&
      !next.onCurve &&
      Math.abs(cur.x - (prev.x + next.x) / 2) < 1e-6 &&
      Math.abs(cur.y - (prev.y + next.y) / 2) < 1e-6;
    if (!isImplied) out.push(cur);
  }
  return out;
}

/**
 * Rebuild editable nodes from a `glyf` point list, restoring any on-curve
 * points the font left implied.
 */
export function glyfPointsToContour(points: GlyfPoint[]): Contour {
  if (points.length === 0) return { nodes: [], closed: true };

  // Reinstate implied on-curve points so every curve has explicit endpoints.
  const expanded: GlyfPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    const next = points[(i + 1) % points.length];
    expanded.push(cur);
    if (!cur.onCurve && !next.onCurve) {
      expanded.push({ x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2, onCurve: true });
    }
  }

  // Rotate so the list starts on an on-curve point.
  const startIndex = expanded.findIndex((p) => p.onCurve);
  if (startIndex === -1) {
    // An all-off-curve contour: every on-curve point is implied. Synthesise them.
    const synthesized: GlyfPoint[] = [];
    for (let i = 0; i < expanded.length; i++) {
      const cur = expanded[i];
      const next = expanded[(i + 1) % expanded.length];
      synthesized.push(cur, {
        x: (cur.x + next.x) / 2,
        y: (cur.y + next.y) / 2,
        onCurve: true,
      });
    }
    return glyfPointsToContour(synthesized);
  }
  const ordered = [...expanded.slice(startIndex), ...expanded.slice(0, startIndex)];

  const nodes: GlyphNode[] = [];
  let i = 0;
  while (i < ordered.length) {
    const anchor = ordered[i];
    const control = ordered[(i + 1) % ordered.length];
    const end = ordered[(i + 2) % ordered.length];

    const node: GlyphNode =
      nodes.length > 0
        ? nodes[nodes.length - 1]
        : (() => {
            const first: GlyphNode = {
              point: { x: anchor.x, y: anchor.y },
              handleIn: null,
              handleOut: null,
              type: "corner",
            };
            nodes.push(first);
            return first;
          })();

    if (!control.onCurve) {
      // Quadratic from `anchor` through `control` to `end`.
      const cubic = quadraticToCubic(
        { x: anchor.x, y: anchor.y },
        { x: control.x, y: control.y },
        { x: end.x, y: end.y },
      );
      node.handleOut = cubic.c1;
      nodes.push({
        point: { x: end.x, y: end.y },
        handleIn: cubic.c2,
        handleOut: null,
        type: "corner",
      });
      i += 2;
    } else {
      // Straight line from `anchor` to `control`.
      nodes.push({
        point: { x: control.x, y: control.y },
        handleIn: null,
        handleOut: null,
        type: "corner",
      });
      i += 1;
    }
  }

  // The walk above appends a node duplicating the start; fold it back in.
  if (nodes.length > 1) {
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (Math.abs(first.point.x - last.point.x) < 1e-6 && Math.abs(first.point.y - last.point.y) < 1e-6) {
      first.handleIn = last.handleIn;
      nodes.pop();
    }
  }

  classifyNodes(nodes);
  return { nodes, closed: true };
}

/**
 * Mark nodes whose handles are collinear as smooth, so dragging one handle
 * keeps the curve smooth the way the original designer drew it.
 */
export function classifyNodes(nodes: GlyphNode[]): void {
  for (const node of nodes) {
    if (!node.handleIn || !node.handleOut) {
      node.type = node.handleIn || node.handleOut ? "tangent" : "corner";
      continue;
    }
    const inVec = { x: node.point.x - node.handleIn.x, y: node.point.y - node.handleIn.y };
    const outVec = { x: node.handleOut.x - node.point.x, y: node.handleOut.y - node.point.y };
    const inLen = Math.hypot(inVec.x, inVec.y);
    const outLen = Math.hypot(outVec.x, outVec.y);
    if (inLen < 1e-6 || outLen < 1e-6) {
      node.type = "corner";
      continue;
    }
    const cross = (inVec.x * outVec.y - inVec.y * outVec.x) / (inLen * outLen);
    const dot = (inVec.x * outVec.x + inVec.y * outVec.y) / (inLen * outLen);
    node.type = Math.abs(cross) < 0.02 && dot > 0 ? "smooth" : "corner";
  }
}
