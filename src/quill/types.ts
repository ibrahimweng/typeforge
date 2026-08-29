/**
 * The second engine: a stroke that can change its curvature and its width.
 *
 * The forge next door draws a letter by sweeping a fixed pen along a skeleton
 * made of straight runs and circular arcs. That restriction is not an oversight
 * -- it is what makes the offset exact, which is what makes weight an input
 * rather than a distortion, and it is why a forge letter cannot fold at any
 * setting. Nothing here is meant to replace it.
 *
 * What it cannot do is arrive at somebody else's letterforms, and the arithmetic
 * of why is short. A circular arc has one curvature for its whole length and a
 * fixed pen has one width; a hand drawing a script varies both continuously,
 * and the swelling in a pointed-pen stroke comes from *pressure*, which is
 * independent of the direction the stroke happens to be travelling. Measured
 * against a real script face, the forge describes a whole typeface in 46
 * numbers where the reference spends 27,510. Forty-six numbers cannot land on
 * a point in a 27,510-dimensional space, and no amount of tuning changes that.
 *
 * So this engine gives the skeleton two things the forge withholds:
 *
 *   a spine segment may be a cubic, so curvature varies along a stroke;
 *   a stroke carries a width profile, so it swells and tapers along its length.
 *
 * Both are optional. A stroke built from lines and arcs at one width is offset
 * in closed form exactly as the forge does it, keeps the no-fold guarantee, and
 * says so. A stroke that reaches for a cubic or a varying width is offset by
 * sampling and fitting, is accurate to a stated tolerance rather than exactly,
 * and says that instead. The trade is made per stroke and is never hidden:
 * `exactness` on the drawn result reports which kind was actually used.
 *
 * The name is the tool rather than the technique. A quill is the pen that does
 * what a nib cannot -- press harder and the stroke widens without the hand
 * turning.
 */

import type { Vec2 } from "@/font/types";

// ---------------------------------------------------------------------------
// Spines
// ---------------------------------------------------------------------------

/** A straight run of a stroke's centre-line. Offsets exactly. */
export interface QuillLine {
  kind: "line";
  from: Vec2;
  to: Vec2;
}

/**
 * A circular run. Offsets exactly, to another circular arc about the same
 * centre -- which is the property the forge is built on and this keeps.
 */
export interface QuillArc {
  kind: "arc";
  centre: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
  sweepPositive: boolean;
}

/**
 * A free-form run, where curvature changes along the segment.
 *
 * The addition that makes this engine able to follow a drawn letter, and the
 * one that costs the exactness. There is no cubic whose offset is another
 * cubic, so the offset of one of these is sampled and refitted to within a
 * tolerance. That is a real cost and it is why this is a third kind rather
 * than the only kind: a stroke that does not need it does not pay it.
 */
export interface QuillCubic {
  kind: "cubic";
  from: Vec2;
  c1: Vec2;
  c2: Vec2;
  to: Vec2;
}

export type QuillSegment = QuillLine | QuillArc | QuillCubic;

/** A stroke's centre-line, in order. */
export interface QuillSpine {
  segments: QuillSegment[];
  /** A ring, such as an `o` drawn in one closed motion: no ends, no terminals. */
  closed: boolean;
}

// ---------------------------------------------------------------------------
// Width
// ---------------------------------------------------------------------------

/**
 * How wide the stroke is at one place along itself.
 *
 * `at` runs from nought at the start of the whole spine to one at its end,
 * measured by arc length rather than by parameter, so a stop halfway along is
 * halfway along the ink and not halfway through the arithmetic. Between stops
 * the width is interpolated smoothly; outside the outermost stops it is held.
 */
export interface WidthStop {
  at: number;
  width: number;
}

/**
 * The width along a stroke.
 *
 * One stop is a stroke of one width, which offsets in closed form and is the
 * forge's pen. Two or more make it swell or taper, which is what a hand does
 * and what a nib cannot fake: a nib is wide across one direction and narrow
 * across the other, so its thick and thin follow the *heading* of the stroke.
 * Pressure follows the hand instead, and a downstroke that thickens in its
 * middle while running dead straight is the shape that proves the difference.
 */
export type WidthProfile = WidthStop[];

/**
 * The nib, kept alongside the profile rather than instead of it.
 *
 * Real script hands use both: a broad-edged pen held at an angle *and* a change
 * of pressure. `contrast` narrows the pen across one axis and `angle` says
 * which axis, exactly as the forge's pen does; the profile then scales what
 * that pen is doing at each point along the stroke. With no contrast the nib is
 * a circle and the profile is the whole story.
 */
export interface Nib {
  /** Nought is a round pen. Up to one narrows it to a line across one axis. */
  contrast: number;
  /** Degrees. Zero is broadest vertically, thinning the horizontals. */
  angle: number;
}

export const ROUND_NIB: Nib = { contrast: 0, angle: 0 };

// ---------------------------------------------------------------------------
// Strokes
// ---------------------------------------------------------------------------

/** How a stroke ends. Kept deliberately smaller than the forge's set. */
export type QuillCapKind = "butt" | "round" | "pointed";

export interface QuillCap {
  kind: QuillCapKind;
  /**
   * How far a pointed cap runs past the end, in widths at that end.
   *
   * The entry and exit strokes of a written script taper to nothing rather than
   * stopping, and a square or round cap on one of those reads as a blunt end
   * where the reference has a hairline.
   */
  extend?: number;
}

export const BUTT_CAP: QuillCap = { kind: "butt" };

export interface QuillStroke {
  spine: QuillSpine;
  /** At least one stop. One stop is a stroke of constant width. */
  width: WidthProfile;
  nib: Nib;
  start: QuillCap;
  end: QuillCap;
}

/**
 * Everything one glyph is made of.
 *
 * A list of strokes and nothing else: no recipe, no shared parts, no
 * inheritance. That is the other half of what separates this engine from the
 * forge, and it is a deliberate loss as much as a gain. The forge's letters
 * come from shared skeletons, which is why one edit there reaches four hundred
 * and fifty glyphs and why nine weights fall out of one drawing. Here each
 * glyph owns its own strokes, so an edit reaches exactly one letter -- which is
 * what it takes to hold an idiosyncrasy that belongs to a single letter, and is
 * exactly what a reproduction of somebody else's face is made of.
 */
export interface QuillGlyph {
  name: string;
  advanceWidth: number;
  strokes: QuillStroke[];
}

// ---------------------------------------------------------------------------
// What the drawing promises
// ---------------------------------------------------------------------------

/**
 * Whether a drawn stroke's outline is exact or fitted, and by how much.
 *
 * Reported rather than assumed, because the whole arrangement here is that the
 * trade is made per stroke. A face built entirely of lines and arcs at one
 * width has every stroke `exact` and keeps every promise the forge makes; one
 * that reaches for a cubic knows what it gave up and how much.
 */
export interface Exactness {
  /** True only where every segment offset was computed in closed form. */
  exact: boolean;
  /**
   * The largest distance, in font units, between the fitted outline and the
   * true offset of the spine. Nought where the offset was exact.
   */
  deviation: number;
}

/** A stroke turned into ink, with the promise it was drawn under. */
export interface DrawnStroke {
  contours: import("@/font/types").Contour[];
  exactness: Exactness;
}
