/**
 * Reading design qualities back out of a drawn letter.
 *
 * The parametric layer has always worked the other way round: you move a
 * "weight" slider and the outlines follow. That is backwards from how a
 * typeface is actually made. A designer draws n and o until they look right,
 * and those two letters then set the stem width, the x-height, the roundness
 * and the counter that the rest of the alphabet has to match.
 *
 * This module measures those qualities off the outline so the drawing can be
 * the input. Everything here works by casting rays across the glyph and
 * measuring the runs of ink they cross, which needs no knowledge of how the
 * letter was constructed and so works the same on an imported font as on
 * something drawn here.
 */

import { contourSegments, contoursBounds, type Segment } from "./geometry";
import { classifyContours } from "./outline";
import type { Contour } from "./types";

/** A run of ink along a ray, in font units. */
export interface Span {
  start: number;
  end: number;
  width: number;
}

/**
 * Where a horizontal line crosses the outline.
 *
 * Roots are found analytically rather than by walking the curve, because a
 * stem measured from sampled points is only ever as accurate as the sampling,
 * and stem widths are the number everything else is judged against.
 */
export function horizontalCrossings(contours: Contour[], y: number): number[] {
  const crossings: number[] = [];
  for (const contour of contours) {
    for (const segment of contourSegments(contour)) {
      collectCrossings(segment, y, crossings);
    }
  }
  return crossings.sort((a, b) => a - b);
}

function collectCrossings(segment: Segment, y: number, out: number[]): void {
  if (segment.kind === "line") {
    const { from, to } = segment;
    // A horizontal edge lying exactly on the ray has no single crossing point;
    // skipping it keeps the crossing count even.
    if (from.y === to.y) return;
    const t = (y - from.y) / (to.y - from.y);
    if (t >= 0 && t < 1) out.push(from.x + (to.x - from.x) * t);
    return;
  }

  const { from, c1, c2, to } = segment;
  for (const raw of cubicRootsForY(from.y, c1.y, c2.y, to.y, y)) {
    const t = clampParameter(raw);
    if (t === null) continue;
    const u = 1 - t;
    out.push(
      u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
    );
  }
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

/**
 * The runs of ink a horizontal ray passes through.
 *
 * Crossings are paired in order, which is the even-odd reading. Font outlines
 * wind their counters against their outer contours, so for the letters this is
 * used on -- one ray across n, o, H, O -- the two readings agree, and pairing
 * needs no winding information.
 */
export function inkSpans(contours: Contour[], y: number): Span[] {
  const crossings = horizontalCrossings(contours, y);
  const spans: Span[] = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const start = crossings[i];
    const end = crossings[i + 1];
    if (end - start > EPSILON) spans.push({ start, end, width: end - start });
  }
  return spans;
}

/** What a control letter says about the design. */
export interface GlyphMeasurements {
  /** Narrowest upright stroke crossed at mid-height. Null when nothing was crossed. */
  stemWidth: number | null;
  /**
   * The widest gap between strokes along a ray. This is the counter of n, H
   * and u, which is open to the outside rather than enclosed by the letter.
   */
  counterWidth: number | null;
  /**
   * The width of a counter that is actually enclosed by an outline, as in o,
   * e, a and 0.
   *
   * Kept apart from the open counter above because only this one can be acted
   * on. Opening a counter works by scaling the contour that encloses it, so a
   * letter whose counter is merely the space between two separate stems has
   * nothing to scale. Deriving a family-wide counter setting from H's gap and
   * then applying it would leave H untouched while squeezing every o in the
   * font.
   */
  closedCounterWidth: number | null;
  /** Top and bottom of the ink itself, rather than the nominal metric. */
  inkTop: number;
  inkBottom: number;
  /** Left and right of the ink. */
  inkLeft: number;
  inkRight: number;
  /** How much of the advance sits either side of the ink. */
  leftSidebearing: number;
  rightSidebearing: number;
  advanceWidth: number;
}

/**
 * The width of the widest contour that sits inside another one.
 *
 * "Inside" is decided the same way the counter transform decides it, so what
 * is measured here is exactly what that transform is able to move.
 */
function closedCounterWidth(contours: Contour[]): number | null {
  if (contours.length < 2) return null;
  const outer = classifyContours(contours);
  let widest: number | null = null;
  contours.forEach((contour, index) => {
    if (outer[index]) return;
    const bounds = contoursBounds([contour]);
    const width = bounds.xMax - bounds.xMin;
    if (width > 0 && (widest === null || width > widest)) widest = width;
  });
  return widest;
}

/** Middle value of a set, which ignores outliers the way a mean cannot. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** How many rays to cast, and how far from the ink edges to stay. */
const RAY_COUNT = 25;
const RAY_INSET = 0.08;

/**
 * Measure a letter by casting a fan of rays across it.
 *
 * A single ray at mid-height is not enough, and fails in a way that looks like
 * a plausible number rather than an error: on H the middle of the letter is
 * exactly where the crossbar is, so the ray reads left stem, bar and right stem
 * as one run and reports a stem of 1138 units where the truth is about 200. The
 * digit 3 fails the same way on its middle join.
 *
 * Taking the median across many heights fixes it without needing to know which
 * letter is being measured. A crossbar occupies a small band of the height, so
 * the rays that cross it are outvoted by the ones that do not. The median also
 * leaves a single-stemmed letter like 1 alone, which a rule such as "ignore
 * rays that find only one stroke" would have broken.
 */
export function measureGlyph(contours: Contour[], advanceWidth: number): GlyphMeasurements | null {
  if (contours.length === 0) return null;
  const bounds = contoursBounds(contours);
  if (!Number.isFinite(bounds.yMin) || bounds.yMax <= bounds.yMin) return null;

  const height = bounds.yMax - bounds.yMin;
  const stemCandidates: number[] = [];
  const counterCandidates: number[] = [];

  for (let i = 0; i < RAY_COUNT; i++) {
    const fraction = RAY_INSET + ((1 - 2 * RAY_INSET) * i) / (RAY_COUNT - 1);
    const spans = inkSpans(contours, bounds.yMin + height * fraction);
    if (spans.length === 0) continue;

    stemCandidates.push(Math.min(...spans.map((span) => span.width)));

    let widestGap = 0;
    for (let j = 0; j + 1 < spans.length; j++) {
      widestGap = Math.max(widestGap, spans[j + 1].start - spans[j].end);
    }
    if (widestGap > 0) counterCandidates.push(widestGap);
  }

  return {
    stemWidth: median(stemCandidates),
    counterWidth: median(counterCandidates),
    closedCounterWidth: closedCounterWidth(contours),
    inkTop: bounds.yMax,
    inkBottom: bounds.yMin,
    inkLeft: bounds.xMin,
    inkRight: bounds.xMax,
    leftSidebearing: bounds.xMin,
    rightSidebearing: advanceWidth - bounds.xMax,
    advanceWidth,
  };
}
