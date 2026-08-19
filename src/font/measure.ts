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

import {
  contourSegments,
  contoursBounds,
  cubicParametersAtY,
  type Segment,
} from "./geometry";
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
  for (const t of cubicParametersAtY(from, c1, c2, to, y)) {
    const u = 1 - t;
    out.push(
      u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
    );
  }
}

/**
 * The runs of ink a horizontal ray passes through.
 *
 * Crossings are paired in order, which is the even-odd reading. Font outlines
 * wind their counters against their outer contours, so for the letters this is
 * used on -- one ray across n, o, H, O -- the two readings agree, and pairing
 * needs no winding information.
 */
/** Narrower than this and a run of ink is rounding rather than a stroke. */
const HAIRLINE = 1e-9;

export function inkSpans(contours: Contour[], y: number): Span[] {
  const crossings = horizontalCrossings(contours, y);
  const spans: Span[] = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const start = crossings[i];
    const end = crossings[i + 1];
    if (end - start > HAIRLINE) spans.push({ start, end, width: end - start });
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
