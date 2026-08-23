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
  /**
   * Cut into this many pieces rather than as few as the sweep needs.
   *
   * An arc becomes quarter turns at most, so how many nodes it comes to is
   * `ceil(sweep / 90 degrees)` -- right for a turn the letter decides on, and
   * wrong for one the pen decides on. A tail that hooks only where there is
   * room to hook is the second kind: it turns a hundred and five degrees at the
   * Regular and not at all at the Black, which is three nodes against two, and
   * two weights drawn with different nodes cannot be joined into one variable
   * font. Pinning it says the turn is always drawn in the same pieces, and a
   * turn of nothing is drawn in those same pieces stood on one spot.
   */
  pieces?: number;
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
  /**
   * Cut flat along a line rather than square to the stroke, and -- where the
   * terminal is a slab -- lay its bar along that line too.
   *
   * Not a style anybody picks. It is what a square cut and a serif both mean
   * on a stroke that is meant to stop on a line and does not arrive square to
   * it: the arms of a v, an x and a w all end at the x-height, and finished
   * square to their own direction they end in a corner well above it and wear
   * a serif that leans off with them. A designer cutting those by hand cuts
   * them along the line and sets the serif along it, so that is what is drawn.
   *
   * Only meaningful on the terminals that draw a square cut -- `butt` and
   * `slab`. A round cap is dealt with by pulling the spine back instead.
   */
  level?: boolean;
  /**
   * Whether this is a real end of the letter rather than one buried inside
   * another stroke.
   *
   * Half the stroke ends in the alphabet are not ends at all: the arm of an E
   * starts inside the stem, the crossbar of an A starts and finishes inside
   * its two diagonals, and the eye of an e runs into the bowl at both ends.
   * They are cut square because nothing there is ever seen. Anything that adds
   * shape to an end -- a flare, a ball -- has to know the difference, or it
   * puts that shape inside the counter.
   *
   * A serif does not need to ask, because it only goes on the slab terminal
   * the style names and the buried ends are plain cuts. Everything since has
   * needed to.
   */
  open?: boolean;
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

/**
 * How the outside of a corner is finished where a stroke changes direction.
 *
 * - `miter` carries both edges on until they meet, which keeps an apex sharp.
 * - `round` turns the pen about the corner, which is exactly the boundary of
 *   the swept region and can never overshoot.
 * - `bevel` cuts straight across, which is what a very sharp miter falls back
 *   to rather than growing a spike several stem-widths long.
 */
export type JoinKind = "miter" | "round" | "bevel";

export interface Stroke {
  spine: Spine;
  pen: Pen;
  start: Terminal;
  end: Terminal;
  /** How the outside of a corner is finished. Miter unless said otherwise. */
  join?: JoinKind;
}

export const BUTT: Terminal = { kind: "butt" };
