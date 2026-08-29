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
 *
 * Three more are about a script in particular rather than about a pen, and they
 * are here rather than only in the forge because this is the side where they
 * show. The forge can bounce a line and open a join too, and does -- on its own
 * letterforms, which is the whole of what it can offer. Applied to strokes
 * recovered from a real script they act on that script's letters, so the same
 * idea that produces a genre next door produces a variation of an actual face
 * here:
 *
 *   `bounce` lifts each letter off the common line by its own amount, which is
 *   what separates a written line from a typeset one.
 *
 *   `width` stretches the letters across, taking the advance with them so a
 *   joined face stays joined.
 *
 *   `reach` runs the entry and exit strokes on. It is the only control here
 *   that picks its strokes rather than acting on all of them, and what it picks
 *   is the ends that reach the edge of the letter's own advance travelling
 *   outwards -- which is what a join is.
 */

import type { Vec2 } from "@/font/types";
import type { FieldControl } from "@/forge/parts";
import { scatterOf } from "@/forge/script";
import { alongSpine, walkOf } from "./curve";
import type { QuillGlyph, QuillSegment, QuillSpine, QuillStroke, WidthProfile } from "./types";

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
  /**
   * How far the letters refuse to sit on one line, as a share of the em.
   *
   * The measure that separates a written line from a typeset one, and the
   * reason it is here rather than only next door in the forge: a script that
   * sits dead level reads as a font imitating handwriting, and one that lifts
   * and drops by a fortieth of the em reads as a hand. Nought is level.
   *
   * Every letter's own lift is worked out from its name, so it is the same
   * every time the letter is drawn -- the same letter twice in a word sits at
   * the same height, which is what a font can do and a hand cannot, and is
   * the honest limit of doing this with a slider.
   */
  bounce: number;
  /**
   * The letters stretched or squeezed across, as a multiple of their own width.
   *
   * Taken about the letter's left edge and applied to the advance as well, so
   * a stroke that left the previous letter at its advance still arrives where
   * the next one starts: a joined face that stretched its letters and not its
   * spacing would come apart at every join. The stroke widths are left alone,
   * which is what makes this a width rather than a distortion -- the letter
   * gets wider and the pen that drew it does not.
   */
  width: number;
  /**
   * How far the joining strokes run on past the letter, as a share of the em.
   *
   * The control that decides whether a script is tightly written or thrown
   * across the page, and the only one here that acts on some strokes and not
   * others: what it lengthens is the ends that already reach the edge of the
   * letter's own advance, which are the entry and the exit, and it leaves
   * everything inside the letter alone. The advance grows with them, so
   * lengthening the joins opens the writing rather than piling the letters
   * into each other.
   */
  reach: number;
}

export const PLAIN_HAND: QuillStyle = {
  weight: 1,
  pressure: 1,
  slant: 0,
  contrast: 0,
  nibAngle: 0,
  taper: 0,
  tracking: 1,
  bounce: 0,
  width: 1,
  reach: 0,
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
    key: "bounce",
    label: "Bounce",
    hint: "How far the letters refuse to sit on one line. Nought is level, which reads as a font imitating a hand; turned up, each letter lifts or drops by its own amount and the line reads as written. The same letter always lands in the same place, which is the honest limit of doing this with a slider.",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "width",
    label: "Width",
    hint: "The letters stretched or squeezed across, taken about the left edge with the advance stretched to match, so the joins still meet. The stroke widths are left alone: the letter gets wider and the pen that drew it does not.",
    min: 0.7,
    max: 1.4,
    step: 0.005,
  },
  {
    key: "reach",
    label: "Join reach",
    hint: "How far the entry and exit strokes run on past the letter. The one control here that picks its strokes: it lengthens only the ends that already reach the edge of the letter's own advance, and leaves everything inside alone. The advance grows with them, so this opens the writing rather than piling the letters together.",
    min: 0,
    max: 1.5,
    step: 0.01,
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

/**
 * A flat map of the plane: `x' = a x + c y + e`, `y' = b x + d y + f`.
 *
 * One of these rather than three passes, and the reason is exactness. An affine
 * map takes a cubic to a cubic by mapping its four control points, so a spine
 * put through one map is still the same kind of spine and nothing is refitted.
 * Put through three in turn it is still exact, but each pass has to decide
 * again whether an arc survives -- and an arc survives a translation and not a
 * shear, so the passes would have to agree with each other about a question
 * only the combination can answer.
 */
interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const applied = (map: Affine, point: Vec2): Vec2 => ({
  x: map.a * point.x + map.c * point.y + map.e,
  y: map.b * point.x + map.d * point.y + map.f,
});

/** Whether a map only moves things, which is the one case an arc survives. */
const onlyMoves = (map: Affine): boolean =>
  map.a === 1 && map.b === 0 && map.c === 0 && map.d === 1;

/** Whether a map does nothing at all, so a spine can be handed back untouched. */
const doesNothing = (map: Affine): boolean => onlyMoves(map) && map.e === 0 && map.f === 0;

/** The cubic through the same places as an arc, to within a fraction of a unit. */
function arcAsCubic(segment: Extract<QuillSegment, { kind: "arc" }>): QuillSegment {
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
    from,
    c1: { x: from.x + leaving.x * k, y: from.y + leaving.y * k },
    c2: { x: to.x - arriving.x * k, y: to.y - arriving.y * k },
    to,
  };
}

/**
 * One segment put through the map.
 *
 * The arc is the only interesting case. Moved, it is still a circle about a
 * moved centre and stays an arc, which is worth keeping because an arc offsets
 * in closed form and a cubic does not -- so a face that is only bounced keeps
 * every promise it had. Sheared or stretched it becomes an ellipse, which this
 * model has no way to hold, so it is promoted to the cubic through the same
 * places. That is the one point where asking for a lean or a width costs a
 * stroke its exactness, and it costs it honestly: the segment changes kind, so
 * `isExact` reports the truth afterwards.
 */
function mapSegment(segment: QuillSegment, map: Affine): QuillSegment {
  if (doesNothing(map)) return segment;
  if (segment.kind === "line") {
    return { kind: "line", from: applied(map, segment.from), to: applied(map, segment.to) };
  }
  if (segment.kind === "cubic") {
    return {
      kind: "cubic",
      from: applied(map, segment.from),
      c1: applied(map, segment.c1),
      c2: applied(map, segment.c2),
      to: applied(map, segment.to),
    };
  }
  if (onlyMoves(map)) {
    return { ...segment, centre: applied(map, segment.centre) };
  }
  return mapSegment(arcAsCubic(segment), map);
}

/**
 * The map that carries width, bounce and slant, in that order.
 *
 * Order matters and this is the one the eye expects. The letter is stretched
 * first, so the stretch is across the letter rather than across the leaned
 * letter; then lifted, so the lift is straight up; then leaned, so a letter
 * sitting higher on a leaning line is also carried sideways -- which is what
 * happens on paper and what makes a bounced slanted script look written rather
 * than nudged.
 */
function handMap(style: QuillStyle, lift: number): Affine {
  const tangent = Math.tan((style.slant * Math.PI) / 180);
  const width = style.width > 0 ? style.width : 1;
  if (width === 1 && lift === 0 && tangent === 0) return IDENTITY;
  return {
    a: width,
    b: 0,
    c: tangent,
    d: 1,
    e: tangent * lift,
    f: lift,
  };
}

/**
 * How far this letter sits off the common line.
 *
 * Worked out from the letter's own name through the forge's scatter, which is
 * imported rather than copied. The two engines are deliberately separate and
 * this is the one thing they should not disagree about: an `e` that bounced one
 * way in a drawn face and the other way in a traced one would look like a bug
 * in whichever the reader saw second. It is a hash function rather than a piece
 * of the forge, and the arguments for its exact shape -- why a single round of
 * FNV-1a will not do on a one-character key -- are written where it lives.
 */
function liftOf(glyph: QuillGlyph, style: QuillStyle): number {
  if (style.bounce <= 0) return 0;
  // Five hundredths of the em end to end at full bounce, which is about a
  // seventh of a script x-height: plainly unsteady and still a line of type.
  return scatterOf(glyph.name).first * style.bounce * glyph.unitsPerEm * 0.05;
}

// ---------------------------------------------------------------------------
// The joins
// ---------------------------------------------------------------------------

/** Where a segment starts and ends, without walking anything. */
function segmentEnds(segment: QuillSegment): { from: Vec2; to: Vec2 } {
  if (segment.kind === "line" || segment.kind === "cubic") {
    return { from: segment.from, to: segment.to };
  }
  const on = (angle: number): Vec2 => ({
    x: segment.centre.x + Math.cos(angle) * segment.radius,
    y: segment.centre.y + Math.sin(angle) * segment.radius,
  });
  return { from: on(segment.startAngle), to: on(segment.endAngle) };
}

/**
 * A spine with its joining ends run on, and how much wider that made the letter.
 *
 * What counts as a joining end is an end that reaches the edge of the letter's
 * own advance *and* is travelling outwards when it gets there -- which is what
 * a join is, and is the same measurement that decides whether a whole font is a
 * script. Both tests are needed. Reaching the edge alone catches the side of a
 * bowl on a tightly fitted face; travelling outwards alone catches nothing at
 * all, since every stroke leaves somewhere.
 *
 * Both ends are checked against both edges rather than the start against the
 * left and the end against the right, because the fitter does not orient what
 * it recovers: on a traced `u` and a traced `a` the exit stroke is the one whose
 * *start* sits at the right-hand edge, and a rule that only looked forwards
 * would silently do nothing on half the alphabet.
 *
 * Which way an end is going is read from a chord back along the stroke rather
 * than from the tangent at the tip, and the difference is not academic. The
 * tangent at a fitted endpoint is wherever the last control point happened to
 * land, and on a tapered script exit it routinely curls: the exit of a traced
 * `n` ends heading up and to the *left*, because its final handle sits three
 * units past the tip. Extended along that, a join grows backwards into the
 * letter as a spike -- which is what it did before this was measured rather
 * than assumed. Over a chord the curl averages out.
 *
 * The run-on itself is a straight segment along that direction, so it leaves
 * smoothly and the fitted curvature is not disturbed. A curve continued by a
 * straight line is what a written join is at this length -- the pen is running
 * out of the letter rather than turning.
 */
function reachOut(
  spine: QuillSpine,
  advanceWidth: number,
  extend: number,
  slack: number,
): { spine: QuillSpine; grew: number } {
  if (extend <= 0 || spine.closed || spine.segments.length === 0) return { spine, grew: 0 };

  const first = segmentEnds(spine.segments[0]).from;
  const last = segmentEnds(spine.segments[spine.segments.length - 1]).to;
  const atLeft = (point: Vec2) => point.x <= slack;
  const atRight = (point: Vec2) => point.x >= advanceWidth - slack;
  // Nothing near either edge: the common case, and it costs two comparisons
  // rather than a walk of the whole spine.
  if (!atLeft(first) && !atRight(first) && !atLeft(last) && !atRight(last)) {
    return { spine, grew: 0 };
  }

  const walk = walkOf(spine);
  if (walk.total <= 0) return { spine, grew: 0 };
  // The chord is a fixed distance rather than a fixed fraction, so a long
  // stroke and a short one are read the same way.
  const back = Math.min(0.4, Math.max(0.02, extend / walk.total));

  /** Which way the stroke is travelling as it arrives at one of its tips. */
  const leaving = (atStart: boolean): Vec2 | null => {
    const tip = alongSpine(spine, walk, atStart ? 0 : 1).point;
    const inward = alongSpine(spine, walk, atStart ? back : 1 - back).point;
    const away = { x: tip.x - inward.x, y: tip.y - inward.y };
    const size = Math.hypot(away.x, away.y);
    return size > 1e-6 ? { x: away.x / size, y: away.y / size } : null;
  };

  /** Whether a tip is at an edge and heading out through it. */
  const joins = (point: Vec2, away: Vec2 | null): boolean => {
    if (!away) return false;
    if (atLeft(point)) return away.x < 0;
    if (atRight(point)) return away.x > 0;
    return false;
  };

  const segments = [...spine.segments];
  let grew = 0;

  const fromAway = leaving(true);
  if (joins(first, fromAway)) {
    const out = { x: first.x + fromAway!.x * extend, y: first.y + fromAway!.y * extend };
    segments.unshift({ kind: "line", from: out, to: first });
    grew += Math.abs(out.x - first.x);
  }

  const toAway = leaving(false);
  if (joins(last, toAway)) {
    const out = { x: last.x + toAway!.x * extend, y: last.y + toAway!.y * extend };
    segments.push({ kind: "line", from: last, to: out });
    grew += Math.abs(out.x - last.x);
  }

  return { spine: { ...spine, segments }, grew };
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

/**
 * What a stroke needs to know about the letter it is part of.
 *
 * Two of the controls are not properties of a stroke at all -- where the
 * letter's edges are, and how far this particular letter sits off the line --
 * and a stroke restyled without them would have to guess at both. Passed in
 * rather than looked up, so `restyleStroke` stays a function of its arguments
 * and can be tested on a stroke that belongs to no letter.
 */
export interface StrokeContext {
  /** The letter's advance before anything here widened it. */
  advanceWidth: number;
  /** How far the whole letter is lifted off its line. */
  lift: number;
  /** How far a joining end is run on, in font units. Nought leaves ends alone. */
  extend: number;
  /** How close to an edge still counts as reaching it. */
  slack: number;
}

const NO_CONTEXT: StrokeContext = { advanceWidth: 0, lift: 0, extend: 0, slack: 0 };

/**
 * One stroke drawn with a different hand.
 *
 * The order is: run the joining ends on, then map the whole thing. Reversed,
 * the run-on would be measured against a letter that had already been stretched
 * and leaned, so the same slider would add a different amount of join at every
 * slant -- and the edges it looks for would have moved out from under it.
 */
export function restyleStroke(
  stroke: QuillStroke,
  style: QuillStyle,
  context: StrokeContext = NO_CONTEXT,
): QuillStroke {
  const map = handMap(style, context.lift);
  const reached = reachOut(stroke.spine, context.advanceWidth, context.extend, context.slack);
  return {
    spine: {
      ...reached.spine,
      segments: reached.spine.segments.map((segment) => mapSegment(segment, map)),
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
 * The advance is the one number here that four controls all reach, and they
 * reach it for different reasons, so it is worked out in one place:
 *
 *   `reach` grows it by what the joins actually ran on, measured off the
 *   strokes rather than assumed, because a join that leaves at forty degrees
 *   adds less width than one that leaves flat.
 *   `width` scales it with the letter, so a stretched letter keeps its joins.
 *   `tracking` scales it and leaves the letter alone, which is the difference
 *   between the two and the reason both exist.
 *
 * `bounce` is the one that does not: a letter lifted off the line takes up no
 * more room across than it did sitting on it.
 */
export function restyle(glyph: QuillGlyph, style: QuillStyle): QuillGlyph {
  const em = glyph.unitsPerEm || 1000;
  const lift = liftOf(glyph, style);
  /*
   * Six hundredths of the em at full reach, which roughly doubles the join on
   * a tightly written face and is where a flowing script sits.
   */
  const extend = Math.max(0, style.reach) * em * 0.06;
  const context: StrokeContext = {
    advanceWidth: glyph.advanceWidth,
    lift,
    extend,
    // A twentieth of the advance. Wide enough that a join drawn a few units
    // short of the edge is still a join, narrow enough that the side of a bowl
    // is not.
    slack: glyph.advanceWidth * 0.05,
  };

  /*
   * The joins are run on here rather than inside `restyleStroke`, once per
   * stroke, because how far they ran is needed to work out the advance and
   * doing it in both places would do the work twice and risk the two answers
   * disagreeing. The stroke below is handed its already-reached spine and told
   * there is no reach left to add.
   */
  const strokes: QuillStroke[] = [];
  let grew = 0;
  for (const stroke of glyph.strokes) {
    const reached = reachOut(stroke.spine, glyph.advanceWidth, extend, context.slack);
    grew = Math.max(grew, reached.grew);
    strokes.push(restyleStroke({ ...stroke, spine: reached.spine }, style, { ...context, extend: 0 }));
  }

  const width = style.width > 0 ? style.width : 1;
  return {
    ...glyph,
    advanceWidth: (glyph.advanceWidth + grew) * width * style.tracking,
    strokes,
  };
}
