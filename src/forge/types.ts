/**
 * Drawing letters instead of editing them.
 *
 * The other half of this application takes a font someone else drew and
 * reshapes it. This half has no font to start from: a letter is described by
 * where its strokes run and how they are drawn, and the outline is worked out
 * from that description every time it is needed.
 *
 * That difference is the whole point. Reshaping a finished outline means
 * pushing points about and hoping they do not run into each other, which is why
 * the weight control on an imported font has to spend so much effort defending
 * itself. Here, weight is an input to the drawing rather than a shove applied
 * afterwards, so there is nothing to defend against: ask for a lighter cut and
 * the letter is drawn again, thinner. It cannot fold, because nothing moved.
 *
 * The other consequence is ownership. Nothing here is traced from or derived
 * from any existing typeface; the shapes are constructed from a skeleton and a
 * pen. What comes out is yours to use without crediting anyone.
 */

import type { Vec2 } from "@/font/types";

// ---------------------------------------------------------------------------
// Spines
// ---------------------------------------------------------------------------

/**
 * A straight run of a stroke's centre-line.
 *
 * Kept apart from curves rather than treated as a degenerate one, because the
 * two offset differently and both offsets are exact only if the distinction
 * survives.
 */
export interface SpineLine {
  kind: "line";
  from: Vec2;
  to: Vec2;
}

/**
 * A circular run of a stroke's centre-line.
 *
 * Circular rather than free-form on purpose, and this is the decision the
 * promise about weight rests on. Offsetting a straight line gives a straight
 * line; offsetting a circular arc gives a circular arc about the same centre
 * with the radius grown or shrunk. Both are exact -- no sampling, no curve
 * fitting, no error to accumulate -- so the outline at any weight is as
 * accurate as the outline at any other, and a heavy cut is not a light one that
 * has been pushed around until it broke.
 *
 * Angles are in radians, measured the usual way: zero along +x, increasing
 * anticlockwise.
 */
export interface SpineArc {
  kind: "arc";
  centre: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
  /** Anticlockwise from start to end when true. */
  sweepPositive: boolean;
}

export type SpineSegment = SpineLine | SpineArc;

/** A stroke's centre-line, in order. */
export interface Spine {
  segments: SpineSegment[];
  /** A ring, such as the o, which has no ends and therefore no terminals. */
  closed: boolean;
}

// ---------------------------------------------------------------------------
// The pen
// ---------------------------------------------------------------------------

/**
 * How a stroke ends.
 *
 * - `butt` cuts square across the spine, which is what a sans does.
 * - `round` caps with a half-disc, for a soft display face.
 * - `angled` cuts across at an angle, as a broad nib leaves.
 * - `slab` squares off and then lays a bar across, which is a serif.
 */
export type TerminalKind = "butt" | "round" | "angled" | "slab";

export interface Terminal {
  kind: TerminalKind;
  /** For `angled`, degrees away from square. Ignored otherwise. */
  angle?: number;
  /** For `slab`: how far the bar reaches past the stroke on each side. */
  projection?: number;
  /** For `slab`: how far the bar reaches back along the stroke. */
  thickness?: number;
  /**
   * For `slab`: how much the join between bar and stroke is filleted. Zero is
   * a hard corner, which reads as a slab serif; more than zero brackets it,
   * which is what a text serif has.
   */
  bracket?: number;
}

/**
 * The tool the spine is drawn with.
 *
 * `weight` is the stroke's width where the pen is at its broadest. `contrast`
 * is how much narrower it gets at the other extreme: zero is monolinear, which
 * is a sans, and higher values thin the strokes running across the pen, which
 * is what gives a serif its thick and thin. `angle` says which direction the
 * pen is broadest in, as a real nib's angle does.
 *
 * With contrast the offset of a circular arc is an ellipse arc rather than a
 * circular one -- still exact geometry, still closed-form, and still nothing
 * that can be off by more than the fixed error of writing an ellipse quadrant
 * as a cubic, which at a thousand units to the em is a small fraction of one
 * unit.
 */
export interface Pen {
  weight: number;
  contrast: number;
  /** Degrees. Zero means the pen is broadest vertically, thinning horizontals. */
  angle: number;
}

export interface Stroke {
  spine: Spine;
  pen: Pen;
  start: Terminal;
  end: Terminal;
}

export const BUTT: Terminal = { kind: "butt" };
