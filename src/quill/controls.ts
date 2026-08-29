/**
 * What can be turned on a quill face, and what turning it does.
 *
 * The forge's controls describe a typeface: change the bowl width and every
 * bowled letter in the alphabet is redrawn. These describe a *hand* instead,
 * and are applied to whatever strokes a glyph happens to have -- drawn from
 * scratch or recovered from a font. That is the trade the whole engine is: an
 * edit here reaches one letter unless it is asked to reach more, where an edit
 * in the forge cannot help reaching four hundred and fifty.
 *
 * Three of these do things the forge has no way to express, and they are the
 * reason this file exists rather than a copy of `parts.ts`:
 *
 *   `pressure` scales how much the stroke swells along its own length,
 *   independently of which way it is travelling. A nib cannot do this: a nib is
 *   wide across one axis and narrow across the other, so its thicks and thins
 *   follow the *heading* of the stroke. A hand pressing harder in the middle of
 *   a straight downstroke is a shape no nib angle produces.
 *
 *   `taper` runs the ends of a stroke out to a point. A written entry stroke
 *   arrives from nothing; a cap of any width, however small, reads as a blunt
 *   end at the size a script is set at.
 *
 *   `slant` shears the skeleton rather than the finished outline, which it can
 *   afford to do because a shear is affine and an affine map takes a cubic to a
 *   cubic exactly. The forge slants the outline instead, and has to, because
 *   shearing a circular arc gives an ellipse and its offsets would stop being
 *   exact. Here the spine is already free-form, so there is nothing to protect.
 */

import type { Vec2 } from "@/font/types";
import type { FieldControl } from "@/forge/parts";
import type { QuillGlyph, QuillSegment, QuillStroke, WidthProfile } from "./types";

/**
 * The hand a set of strokes is drawn with.
 *
 * Every one of these is a multiplier or an angle rather than a measurement, so
 * the same hand can be laid over any strokes -- a letter drawn here or a letter
 * read back out of somebody's font -- without knowing anything about how big
 * they are.
 */
export interface QuillStyle {
  /** Everything wider or narrower, as a multiple of the width it was drawn at. */
  weight: number;
  /**
   * How much the stroke swells along its own length.
   *
   * One leaves the swelling as it was drawn. Nought flattens every stroke to
   * its own average, which is a monoline. Above one exaggerates what is already
   * there, which is what turns a hand into a copperplate.
   */
  pressure: number;
  /** Degrees the whole letter leans, to the right when positive. */
  slant: number;
  /** How narrow the nib is across its own axis. Nought is a round pen. */
  contrast: number;
  /** Which way the nib is broadest, in degrees. */
  nibAngle: number;
  /**
   * How far the ends of a stroke run out to a point.
   *
   * Nought leaves them the width they were drawn at. One takes them to nothing,
   * which is the hairline a written entry and exit have.
   */
  taper: number;
  /** Every letter given more or less room, as a multiple of its own advance. */
  tracking: number;
}

export const PLAIN_HAND: QuillStyle = {
  weight: 1,
  pressure: 1,
  slant: 0,
  contrast: 0,
  nibAngle: 0,
  taper: 0,
  tracking: 1,
};

export const QUILL_CONTROLS: FieldControl[] = [
  {
    key: "weight",
    label: "Weight",
    hint: "Every stroke wider or narrower, as a multiple of what it was drawn at. The whole width profile is scaled, so a stroke that swelled in its middle still swells in its middle.",
    min: 0.2,
    max: 3,
    step: 0.01,
  },
  {
    key: "pressure",
    label: "Pressure",
    hint: "How much the stroke swells along its own length. Nought flattens every stroke to one width, which is a monoline; above one exaggerates the swelling that is already there. This is what a nib cannot do -- a nib's thick and thin follow the direction the stroke is travelling, and pressure does not.",
    min: 0,
    max: 2.5,
    step: 0.01,
  },
  {
    key: "taper",
    label: "Taper",
    hint: "How far the two ends of a stroke run out to a point. Nought leaves them the width they were drawn at; one takes them to nothing, which is the hairline a written entry stroke arrives on.",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "slant",
    label: "Slant",
    hint: "Degrees the letter leans. Taken on the skeleton rather than on the finished outline, which is exact here because a shear maps a cubic to a cubic.",
    min: -30,
    max: 45,
    step: 0.5,
  },
  {
    key: "contrast",
    label: "Nib contrast",
    hint: "How narrow the pen is across its own axis. Nought is round, and then the pressure profile is the whole story. Turned up, the strokes running one way thin and the strokes running the other stay full, which is a broad-edged pen.",
    min: 0,
    max: 0.9,
    step: 0.01,
  },
  {
    key: "nibAngle",
    label: "Nib angle",
    hint: "Which way that pen is held. Only does anything once there is contrast to hold at an angle.",
    min: -90,
    max: 90,
    step: 1,
  },
  {
    key: "tracking",
    label: "Tracking",
    hint: "Every letter given more or less room, as a multiple of its own advance. The strokes are left where they are: this is the space around the letter and not the letter.",
    min: 0.7,
    max: 1.6,
    step: 0.005,
  },
];

// ---------------------------------------------------------------------------
// Applying a hand to strokes
// ---------------------------------------------------------------------------

const sheared = (point: Vec2, tangent: number): Vec2 => ({
  x: point.x + point.y * tangent,
  y: point.y,
});

/**
 * One segment leaned over.
 *
 * A shear is affine, and an affine map takes a cubic to a cubic exactly by
 * mapping its four control points -- so a leaned cubic is still one cubic and
 * nothing is refitted. An arc is the exception: sheared it becomes an ellipse,
 * which this model has no way to hold, so it is promoted to the cubic that goes
 * through the same places. That is the one point in this engine where asking
 * for a lean costs a stroke its exactness, and it costs it honestly: the
 * segment changes kind, so `isExact` reports the truth afterwards.
 */
function leanSegment(segment: QuillSegment, tangent: number): QuillSegment {
  if (tangent === 0) return segment;
  if (segment.kind === "line") {
    return { kind: "line", from: sheared(segment.from, tangent), to: sheared(segment.to, tangent) };
  }
  if (segment.kind === "cubic") {
    return {
      kind: "cubic",
      from: sheared(segment.from, tangent),
      c1: sheared(segment.c1, tangent),
      c2: sheared(segment.c2, tangent),
      to: sheared(segment.to, tangent),
    };
  }
  const on = (angle: number): Vec2 => ({
    x: segment.centre.x + Math.cos(angle) * segment.radius,
    y: segment.centre.y + Math.sin(angle) * segment.radius,
  });
  const sweep = segment.endAngle - segment.startAngle;
  const from = on(segment.startAngle);
  const to = on(segment.endAngle);
  // The standard handle length for a circular arc of this sweep, which puts the
  // cubic within a fraction of a unit of the arc for any sweep up to a quarter
  // turn and well inside a unit for a half.
  const k = (4 / 3) * Math.tan(sweep / 4) * segment.radius;
  const leaving = { x: -Math.sin(segment.startAngle), y: Math.cos(segment.startAngle) };
  const arriving = { x: -Math.sin(segment.endAngle), y: Math.cos(segment.endAngle) };
  return {
    kind: "cubic",
    from: sheared(from, tangent),
    c1: sheared({ x: from.x + leaving.x * k, y: from.y + leaving.y * k }, tangent),
    c2: sheared({ x: to.x - arriving.x * k, y: to.y - arriving.y * k }, tangent),
    to: sheared(to, tangent),
  };
}

/** A width profile with the hand's weight, pressure and taper in it. */
export function restyleWidth(profile: WidthProfile, style: QuillStyle): WidthProfile {
  if (profile.length === 0) return profile;
  const mean = profile.reduce((sum, stop) => sum + stop.width, 0) / profile.length;
  const pressed = profile.map((stop) => ({
    at: stop.at,
    // Around the stroke's own average, so pressure changes the *variation* and
    // leaves the weight where the weight control put it.
    width: Math.max(0, (mean + (stop.width - mean) * style.pressure) * style.weight),
  }));
  if (style.taper <= 0) return pressed;
  /*
   * The taper is strongest at the ends and gone by a quarter of the way in,
   * because a written stroke arrives thin and is at full width almost at once.
   * Applied after the pressure so the two compose rather than fight: a stroke
   * flattened to a monoline can still be tapered, which is a felt tip, and one
   * left at full pressure and tapered is a pointed pen.
   */
  const stops = [...pressed].sort((one, other) => one.at - other.at);
  const withEnds: WidthProfile = [];
  if (stops[0].at > 0) withEnds.push({ at: 0, width: stops[0].width });
  withEnds.push(...stops);
  if (stops[stops.length - 1].at < 1) {
    withEnds.push({ at: 1, width: stops[stops.length - 1].width });
  }
  return withEnds.map((stop) => {
    const fromEnd = Math.min(stop.at, 1 - stop.at);
    const reach = Math.min(1, fromEnd / 0.25);
    const keep = reach + (1 - reach) * (1 - style.taper);
    return { at: stop.at, width: Math.max(0, stop.width * keep) };
  });
}

/** One stroke drawn with a different hand. */
export function restyleStroke(stroke: QuillStroke, style: QuillStyle): QuillStroke {
  const tangent = Math.tan((style.slant * Math.PI) / 180);
  return {
    spine: {
      ...stroke.spine,
      segments: stroke.spine.segments.map((segment) => leanSegment(segment, tangent)),
    },
    width: restyleWidth(stroke.width, style),
    nib: { contrast: style.contrast, angle: style.nibAngle },
    start: style.taper > 0.5 ? { kind: "pointed", extend: 0.5 } : stroke.start,
    end: style.taper > 0.5 ? { kind: "pointed", extend: 0.5 } : stroke.end,
  };
}

/**
 * A whole glyph drawn with a different hand.
 *
 * The strokes are left where they are and the advance is scaled around them, so
 * tracking opens the space between letters rather than stretching the letters
 * into it.
 */
export function restyle(glyph: QuillGlyph, style: QuillStyle): QuillGlyph {
  return {
    ...glyph,
    advanceWidth: glyph.advanceWidth * style.tracking,
    strokes: glyph.strokes.map((stroke) => restyleStroke(stroke, style)),
  };
}
