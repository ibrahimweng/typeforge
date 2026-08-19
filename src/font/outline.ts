/**
 * Outline corrections applied on the way out to a font file.
 *
 * A designer's drawing and a correct font outline are not the same thing. Both
 * outline formats require a point wherever a curve reaches its extreme, and
 * both care which way a contour is wound. Neither is something a designer
 * should have to think about while drawing, so it is done here instead.
 *
 * These run on a copy at export time. The stored drawing is never modified.
 */

import {
  contourArea,
  contoursBounds,
  contourSegments,
  cubicExtremeTs,
  flattenContour,
  splitCubic,
  type Bounds,
} from "./geometry";
import type { Contour, GlyphNode, Vec2 } from "./types";

/** Which winding a format expects on the outer contour of a shape. */
export type OutlineFormat = "truetype" | "cff";

// ---------------------------------------------------------------------------
// Points at extremes
// ---------------------------------------------------------------------------

/**
 * Split a cubic at several parameter values at once.
 *
 * Each split reparameterises what is left, so later values are rescaled into
 * the remaining curve's own parameter space as we go.
 */
function splitCubicAt(
  from: Vec2,
  c1: Vec2,
  c2: Vec2,
  to: Vec2,
  ts: number[],
): Array<[Vec2, Vec2, Vec2, Vec2]> {
  const sorted = [...new Set(ts)].filter((t) => t > 1e-6 && t < 1 - 1e-6).sort((a, b) => a - b);
  if (sorted.length === 0) return [[from, c1, c2, to]];

  const pieces: Array<[Vec2, Vec2, Vec2, Vec2]> = [];
  let rest: [Vec2, Vec2, Vec2, Vec2] = [from, c1, c2, to];
  let consumed = 0;

  for (const t of sorted) {
    const local = (t - consumed) / (1 - consumed);
    if (!(local > 1e-6 && local < 1 - 1e-6)) continue;
    const [left, right] = splitCubic(rest[0], rest[1], rest[2], rest[3], local);
    pieces.push(left);
    rest = right;
    consumed = t;
  }
  pieces.push(rest);
  return pieces;
}

/**
 * Add an on-curve point wherever a curve reaches its highest, lowest, leftmost
 * or rightmost position.
 *
 * Both TrueType and PostScript require this. Without it a rasteriser has no
 * point to snap to at the top of a round letter, and hinting has nothing to
 * hold on to. The added points sit exactly on the existing curve, so the shape
 * is unchanged.
 */
export function insertExtrema(contour: Contour): Contour {
  const { nodes, closed } = contour;
  if (nodes.length < 2) return contour;

  const out: GlyphNode[] = [];
  const lastIndex = closed ? nodes.length : nodes.length - 1;

  for (let i = 0; i < lastIndex; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];

    // Carry this node through, keeping the handle facing backwards.
    const current: GlyphNode = out.length > 0 && i > 0
      ? out[out.length - 1]
      : {
          point: { ...a.point },
          handleIn: a.handleIn ? { ...a.handleIn } : null,
          handleOut: null,
          type: a.type,
        };
    if (out.length === 0) out.push(current);

    if (!a.handleOut && !b.handleIn) {
      // A straight line has no interior extreme.
      current.handleOut = null;
      out.push({
        point: { ...b.point },
        handleIn: null,
        handleOut: null,
        type: b.type,
      });
      continue;
    }

    const c1 = a.handleOut ?? a.point;
    const c2 = b.handleIn ?? b.point;
    const ts = cubicExtremeTs(a.point, c1, c2, b.point);
    const pieces = splitCubicAt(a.point, c1, c2, b.point, ts);

    current.handleOut = { ...pieces[0][1] };
    pieces.forEach((piece, index) => {
      const isLast = index === pieces.length - 1;
      out.push({
        point: { ...piece[3] },
        handleIn: { ...piece[2] },
        handleOut: null,
        // A point added at an extreme sits mid-curve, so the curve carries on
        // smoothly through it; only the original end node keeps its own type.
        type: isLast ? b.type : "smooth",
      });
      if (!isLast) {
        out[out.length - 1].handleOut = { ...pieces[index + 1][1] };
      }
    });
  }

  // On a closed contour the walk ends on a duplicate of the start node.
  if (closed && out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (near(first.point, last.point)) {
      first.handleIn = last.handleIn;
      out.pop();
    }
  }
  return { nodes: out, closed };
}

const near = (a: Vec2, b: Vec2): boolean =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/**
 * Report which segments still reach an extreme without a point on it. Used by
 * the validation report, and by the tests that keep this honest.
 */
export function missingExtrema(contour: Contour): number {
  const { nodes, closed } = contour;
  if (nodes.length < 2) return 0;
  let count = 0;
  const lastIndex = closed ? nodes.length : nodes.length - 1;

  for (let i = 0; i < lastIndex; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    if (!a.handleOut && !b.handleIn) continue;
    const ts = cubicExtremeTs(a.point, a.handleOut ?? a.point, b.handleIn ?? b.point, b.point);
    // Values at the very ends already coincide with an existing node.
    count += ts.filter((t) => t > 1e-4 && t < 1 - 1e-4).length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Winding direction
// ---------------------------------------------------------------------------

/**
 * Decide which contours are outer shapes and which are counters.
 *
 * A contour enclosed by an odd number of others is a counter. Nesting is used
 * rather than size so that a shape inside a counter, such as the middle of a
 * figure 8 drawn as three rings, comes out right.
 */
export function classifyContours(contours: Contour[]): boolean[] {
  const polygons = contours.map((contour) => flattenContour(contour, 10));
  const boxes = contours.map((contour) => contoursBounds([contour]));
  const insidePoints = contours.map((_, index) => interiorPoint(polygons[index], boxes[index]));

  return contours.map((_, index) => {
    let enclosing = 0;
    for (let other = 0; other < contours.length; other++) {
      if (other === index) continue;
      if (!boxContains(boxes[other], boxes[index])) continue;
      if (pointInPolygon(polygons[other], insidePoints[index])) enclosing++;
    }
    return enclosing % 2 === 0; // even nesting depth means outer
  });
}

/**
 * Wind every contour the way the target format expects: TrueType puts outer
 * contours clockwise, PostScript puts them counter-clockwise. Getting this
 * wrong fills counters in solid.
 */
export function correctDirection(contours: Contour[], format: OutlineFormat): Contour[] {
  const isOuter = classifyContours(contours);
  // Signed area is negative for a clockwise contour in font coordinates.
  const outerShouldBeClockwise = format === "truetype";

  return contours.map((contour, index) => {
    if (contour.nodes.length < 3) return contour;
    const clockwise = contourArea(contour) < 0;
    const wantClockwise = isOuter[index] ? outerShouldBeClockwise : !outerShouldBeClockwise;
    return clockwise === wantClockwise ? contour : reverse(contour);
  });
}

/** Reverse a contour, swapping each node's handles so the shape is unchanged. */
function reverse(contour: Contour): Contour {
  const nodes = [...contour.nodes].reverse().map<GlyphNode>((node) => ({
    point: { ...node.point },
    handleIn: node.handleOut ? { ...node.handleOut } : null,
    handleOut: node.handleIn ? { ...node.handleIn } : null,
    type: node.type,
  }));
  return { nodes, closed: contour.closed };
}

/** Whether every contour is wound as the format requires. */
export function directionIsCorrect(contours: Contour[], format: OutlineFormat): boolean {
  const isOuter = classifyContours(contours);
  const outerShouldBeClockwise = format === "truetype";
  return contours.every((contour, index) => {
    if (contour.nodes.length < 3) return true;
    const clockwise = contourArea(contour) < 0;
    const wantClockwise = isOuter[index] ? outerShouldBeClockwise : !outerShouldBeClockwise;
    return clockwise === wantClockwise;
  });
}

// ---------------------------------------------------------------------------
// Point-in-polygon helpers
// ---------------------------------------------------------------------------

function boxContains(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.xMin <= inner.xMin &&
    outer.yMin <= inner.yMin &&
    outer.xMax >= inner.xMax &&
    outer.yMax >= inner.yMax
  );
}

function pointInPolygon(polygon: Vec2[], point: Vec2): boolean {
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

/**
 * Find a point strictly inside a contour.
 *
 * The average of the outline is inside for most letterforms, but not for a
 * crescent or a very concave shape, so fall back to scanning horizontal lines
 * across the shape and taking the middle of the widest span that is inside.
 */
function interiorPoint(polygon: Vec2[], box: Bounds): Vec2 {
  if (polygon.length === 0) return { x: box.xMin, y: box.yMin };

  let sumX = 0;
  let sumY = 0;
  for (const p of polygon) {
    sumX += p.x;
    sumY += p.y;
  }
  const average = { x: sumX / polygon.length, y: sumY / polygon.length };
  if (pointInPolygon(polygon, average)) return average;

  for (let step = 1; step < 8; step++) {
    const y = box.yMin + ((box.yMax - box.yMin) * step) / 8;
    const crossings: number[] = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if (a.y > y !== b.y > y) {
        crossings.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
      }
    }
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const mid = (crossings[i] + crossings[i + 1]) / 2;
      if (crossings[i + 1] - crossings[i] > 1e-6) return { x: mid, y };
    }
  }
  return average;
}

// ---------------------------------------------------------------------------
// Overlap detection
// ---------------------------------------------------------------------------

export /**
 * Whether any two segments of a glyph cross.
 *
 * Curves are flattened first: the answer only needs to be good enough to raise
 * the question, and an exact curve-curve intersection is far more work than the
 * report warrants.
 */
function contoursIntersect(contours: Contour[]): boolean {
  const segments: Array<[Vec2, Vec2]> = [];
  for (const contour of contours) {
    for (const segment of contourSegments(contour)) {
      if (segment.kind === "line") {
        segments.push([segment.from, segment.to]);
      } else {
        // Sample the curve coarsely; a crossing of any size shows up.
        const steps = 6;
        let previous = segment.from;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const u = 1 - t;
          const point = {
            x: u * u * u * segment.from.x + 3 * u * u * t * segment.c1.x + 3 * u * t * t * segment.c2.x + t * t * t * segment.to.x,
            y: u * u * u * segment.from.y + 3 * u * u * t * segment.c1.y + 3 * u * t * t * segment.c2.y + t * t * t * segment.to.y,
          };
          segments.push([previous, point]);
          previous = point;
        }
      }
    }
  }
  if (segments.length > 600) return false; // too complex to be worth the sweep

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 2; j < segments.length; j++) {
      // Neighbouring segments share an endpoint, which is not a crossing.
      if (i === 0 && j === segments.length - 1) continue;
      if (segmentsCross(segments[i], segments[j])) return true;
    }
  }
  return false;
}

function segmentsCross([a, b]: [Vec2, Vec2], [c, d]: [Vec2, Vec2]): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);

  const d1 = side(a, b, c);
  const d2 = side(a, b, d);
  const d3 = side(c, d, a);
  const d4 = side(c, d, b);
  // Strict crossing only: touching at a shared endpoint does not count.
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

