/**
 * What the recipes are drawn with.
 *
 * The frame a letter is measured in, the ink a stroke is laid down with, and
 * every shared piece -- the arch, the bowl, the diagonal, the mark box -- that
 * the recipes in this folder are written in terms of. Kept apart from the
 * recipes themselves so that each group of letters can be read on its own
 * without scrolling past seven thousand lines of the others; nothing here
 * changed in the move, and `../letters.ts` is still the only way in.
 *
 * It reaches back into `../letters.ts` for `LETTERS` and `recipeOf`, which the
 * symbols built out of other letters need. That is a cycle, and a harmless one:
 * both are only ever called from inside a recipe, long after every module has
 * finished loading.
 */

import type { Vec2 } from "@/font/types";
import { wrapAngle } from "../angles";
import { LETTERS, recipeOf } from "../letters";
import {
  bowl,
  bowlBetween,
  bowlPoint,
  endPieces,
  reversed,
  roundCorners,
  shortened,
  spineStart,
  wavy,
} from "../shapes";
import { type Style, terminalFor } from "../style";
import { MITER_LIMIT, penReach, reachAlong, sweep } from "../sweep";
import { contoursIntersect } from "@/font/outline";
import type { JoinKind, Spine, SpineArc, SpineSegment, Stroke, Terminal } from "../types";

/**
 * A letter, as strokes plus how it should be spaced.
 *
 * How much room it takes is not stated here. It used to be, worked out from
 * whichever coordinate the recipe thought was furthest right -- and that is a
 * second description of the letter, kept by hand, which drifted from the first
 * the moment a terminal or an overshoot reached past it. A serif G ended up
 * with its bowl six units outside its own advance. The width is measured off
 * the drawing instead.
 */
export interface Recipe {
  strokes: Stroke[];
  /** Round letters are set a little tighter, or they look loose beside flat ones. */
  round?: boolean;
  /**
   * More room than the join gives, at each end, as a share of its reach.
   *
   * A joined face spaces every letter the same way -- the letter's own width
   * plus a reach at each end -- and a written hand does not. The reference sets
   * its `s` with 0.245 of an x-height either side of the body and its `o` with
   * 0.155, so its `s` takes 0.95 of the `o`'s advance for a body that is 0.70
   * of it. Ours took 0.69, which is a letter that has been measured rather than
   * spaced.
   *
   * The roman path has had the same idea for as long as it has had round
   * letters, in the other direction: see `ROUND_TIGHTENING`.
   */
  air?: number;
  /** A width to use instead of measuring, for the space and for the figures. */
  width?: number;
  /**
   * The letter draws its own lead-in, so the join must not add one.
   *
   * The difference between a drawn script and a written one, and the thing
   * `enters.ts` and `scallop.ts` were built to find. A drawn `n` is a complete
   * letter standing on the line with a separate stroke run in from outside to
   * touch it. A written one is a hand that came off the letter before, climbed
   * to the top of the first stem and turned down, so the connection is the
   * first part of the letter's own path -- one stroke, at the letter's own
   * weight, going the way the letter goes.
   *
   * A letter that says so here is spaced by that stroke instead of by the
   * join's reach: `planJoin` slides it until the point where its own lead-in
   * crosses the seam sits on the origin, which is the same contract the join
   * kept, honoured by the letter rather than by a stroke laid against it.
   */
  entered?: boolean;
}

export type LetterName = string;

/** The parts a letter can be built from, which are the things an edit lands on. */
export type PartName =
  | "slab"
  | "shoulder"
  | "bowl"
  | "corner"
  | "terminal"
  | "crossbar"
  | "ball"
  | "flare"
  | "wave";

/*
 * Which parts the letter being drawn has asked for.
 *
 * Kept here, next to the drawing, rather than in a table somewhere saying that
 * an n has a shoulder and an H has a crossbar. A table is a second description
 * of the alphabet and would go out of date the first time a letter changed --
 * which has already happened twice in this file, once to the width of every
 * letter and once to the size of every bowl.
 *
 * Drawing is synchronous and one letter at a time, so a single slot is enough;
 * nothing else can be halfway through a letter while this one is being drawn.
 */
export let recording: Set<PartName> | null = null;

/*
 * The same question asked of one run rather than of the whole letter.
 *
 * Which parts a letter has is enough to decide what the panel offers. It is not
 * enough to say what somebody just pointed at: an n has a shoulder and a
 * terminal, and pressing its stem is about neither. So the parts are also
 * collected per run, drained onto each run as it is inked.
 *
 * That works because of the order things happen in. A recipe builds a spine --
 * calling `arch`, which says it is using the shoulder -- and inks it
 * immediately; nothing else can be halfway through a run in between, for the
 * same reason a single slot is enough above. What is collected when `ink`
 * returns is exactly what that run asked for.
 *
 * Held against the stroke object rather than inside it, so the geometry stays
 * geometry: a stroke is a spine and a pen, and which named decision produced it
 * is a fact about the drawing rather than a property of the shape. Weak, so it
 * goes when the strokes do -- and they are built fresh on every draw.
 */
export let pending: PartName[] = [];
export const STROKE_PARTS = new WeakMap<Stroke, PartName[]>();

/*
 * Which letterform the letter inside a symbol is drawn in.
 *
 * A single slot, for the reason the collected parts above are: drawing is
 * synchronous and one letter at a time, so nothing else can be halfway through
 * a symbol while this one is being built.
 */
export let borrowing: string | undefined;

/**
 * Which letter a symbol is drawn out of, noted as the symbol is declared.
 *
 * Not a table beside the recipes saying that a cent is a c. It is the same
 * fact, read back off the recipe that says it, so the two cannot come apart --
 * which three tables in this file already have.
 *
 * What it is for is ownership of a decision. An ª is the a of this font set
 * small, so which a it is belongs to the a: choosing the single-storey one and
 * finding a two-storey ordinal beside it would be the same letter drawn twice
 * in one font, which is exactly what the accented letters already avoid by
 * reading their base's answer rather than keeping one of their own.
 */
export const BEHIND = new WeakMap<(style: Style) => Recipe, LetterName>();

export function uses(part: PartName): void {
  recording?.add(part);
  pending.push(part);
}

/**
 * A part the letter reads without any one run being about it.
 *
 * The terminal is settled once for the whole letter, before a single run
 * exists. Collected as a run's own part it would land on whichever run happened
 * to be inked first, which is a run picked by the order the recipe was written
 * in rather than by anything to do with terminals.
 */
export function usesThroughout(part: PartName): void {
  recording?.add(part);
}

/** Note what this run turned out to be built from, and start the next one. */
export function remember(stroke: Stroke): Stroke {
  STROKE_PARTS.set(stroke, pending);
  pending = [];
  return stroke;
}

/** Which named parts one run of a letter was built from. */
export function partsOfStroke(stroke: Stroke): PartName[] {
  return STROKE_PARTS.get(stroke) ?? [];
}

/**
 * A stroke rebuilt from another one keeps what the first one said.
 *
 * Anything that adjusts a run after it is inked -- pulling a spine back from a
 * round cap, and whatever comes next -- returns a fresh object, and without
 * this the note made while it was drawn would be dropped on the floor. It is
 * still the same run of the same letter.
 */
export function inherit(from: Stroke, to: Stroke): Stroke {
  if (to !== from) STROKE_PARTS.set(to, partsOfStroke(from));
  return to;
}

/** Draw something and report which parts it turned out to need. */
export function recordPartsWhile(draw: () => unknown): Set<PartName> {
  const found = new Set<PartName>();
  const outer = recording;
  recording = found;
  try {
    draw();
  } finally {
    recording = outer;
  }
  return found;
}

/** The figures, which are spaced as a set rather than one at a time. */
export const FIGURES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];

export const BUTT: Terminal = { kind: "butt" };

/** A plain cut lying along the line the stroke stops on, whatever angle it arrives at. */
export const LEVEL: Terminal = { kind: "butt", level: true };
export const at = (x: number, y: number): Vec2 => ({ x, y });
export const deg = (degrees: number): number => (degrees * Math.PI) / 180;

// ---------------------------------------------------------------------------
// Spines
// ---------------------------------------------------------------------------

export const straight = (from: Vec2, to: Vec2): Spine => ({
  segments: [{ kind: "line", from, to }],
  closed: false,
});

/**
 * A turn, given the way a designer describes one: where the middle of the turn
 * is, how far out, and between which two directions. Degrees rather than
 * radians so a recipe reads as a description rather than as trigonometry.
 */
export function turn(centre: Vec2, radius: number, fromDegrees: number, toDegrees: number): Spine {
  return {
    segments: [
      {
        kind: "arc",
        centre,
        radius,
        startAngle: deg(fromDegrees),
        endAngle: deg(toDegrees),
        sweepPositive: toDegrees > fromDegrees,
      },
    ],
    closed: false,
  };
}

/**
 * Where an arc ends up, so a straight run chained onto it starts exactly there.
 *
 * Writing the join by hand to two decimal places leaves the two ends a fraction
 * of a unit apart, and the sweep then has a kink in it that reads as a crossed
 * stroke. The figure two was drawn that way and folded.
 */
export function pointOn(centre: Vec2, radius: number, degrees: number): Vec2 {
  return at(centre.x + radius * Math.cos(deg(degrees)), centre.y + radius * Math.sin(deg(degrees)));
}

/**
 * A closed bowl: an o, the belly of a b, the ring of a zero.
 *
 * Round or square according to the style, and either way built from straight
 * runs and circular arcs so it offsets exactly. A circle is the case where the
 * corners are as round as the shape allows; pulling them in leaves flats along
 * the sides, which is a different family of letter altogether and is not
 * something a circle can be adjusted into.
 *
 * This is also how a figure zero has always been drawn here -- an o with its
 * sides pulled in rather than a squashed circle -- because a squashed circle is
 * an ellipse and an ellipse offsets to something that is not an ellipse. That
 * construction is now the general case rather than a special one.
 */
export function ring(f: Frame, centre: Vec2, halfWidth: number, halfHeight = halfWidth): Spine {
  return bowl(centre, halfWidth, halfHeight, 1 - f.square, f.half);
}

/**
 * A turn that follows the squareness, for the curves that are really parts of a
 * bowl: the halves of an S, the top of a two, the bowl of a five.
 *
 * `turn` above stays for the curves that are corners rather than bowls -- the
 * shoulder of an arch, the hook of an f -- because those take their radius from
 * a different decision and squaring them would be squaring the wrong thing.
 *
 * Angles read the way a recipe writes them: increasing is anticlockwise, and
 * decreasing runs the other way round, which is drawn and then walked backwards
 * so the ends stay where the recipe expects them.
 */
export function bendWidth(f: Frame, radius: number): number {
  return Math.max(radius * f.wide, f.least);
}

export function bend(
  f: Frame,
  centre: Vec2,
  radius: number,
  fromDegrees: number,
  toDegrees: number,
): Spine {
  const halfWidth = bendWidth(f, radius);
  const roundness = 1 - f.square;
  if (toDegrees >= fromDegrees) {
    return bowlBetween(centre, halfWidth, radius, roundness, f.half, fromDegrees, toDegrees);
  }
  return reversed(
    bowlBetween(centre, halfWidth, radius, roundness, f.half, toDegrees, fromDegrees),
  );
}

/**
 * A single arc from one point to another, bowed out by a fraction of the
 * straight line between them.
 *
 * For the curves a recipe wants to describe by where they start and finish
 * rather than by a centre and two angles -- the swung leg of an R, a tail. It
 * is one arc, so there is no join in it to get wrong: a chain is a journey and
 * every piece has to leave where the last one arrived, which is easy to write
 * incorrectly and produces a stroke with a jump in it rather than a curve.
 *
 * Bowing to the left of the direction travelled when the fraction is positive.
 */
export function bowed(f: Frame, from: Vec2, to: Vec2, amount: number): Spine {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return straight(from, to);
  const side = amount < 0 ? -1 : 1;
  // How far the middle of the arc stands off the straight line, held so the
  // radius it implies is never tighter than the pen will go round.
  const rise = Math.max(Math.abs(amount) * chord, 1e-6);
  const radius = Math.max((chord * chord) / (8 * rise) + rise / 2, f.least);
  const middle = at((from.x + to.x) / 2, (from.y + to.y) / 2);
  const left = at((-dy / chord) * side, (dx / chord) * side);
  const back = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
  const centre = at(middle.x - left.x * back, middle.y - left.y * back);
  const startAngle = Math.atan2(from.y - centre.y, from.x - centre.x);
  const sweep = wrapAngle(Math.atan2(to.y - centre.y, to.x - centre.x) - startAngle);
  return {
    segments: [
      {
        kind: "arc",
        centre,
        radius,
        startAngle,
        endAngle: startAngle + sweep,
        sweepPositive: sweep > 0,
      },
    ],
    closed: false,
  };
}

/** Join spines end to end into one stroke that turns as it goes. */
export function chain(...spines: Spine[]): Spine {
  return { segments: spines.flatMap((spine) => spine.segments), closed: false };
}

// ---------------------------------------------------------------------------
// The measurements every letter is built from
// ---------------------------------------------------------------------------

/**
 * The style, resolved into the handful of numbers a recipe actually needs.
 *
 * Gathered once per letter so the recipes below read as descriptions of shapes
 * rather than as arithmetic on a metrics object.
 */
export interface Frame {
  style: Style;
  /** Half the pen: the distance from a spine to the edge of its own stroke. */
  half: number;
  /** Where ink may start, allowing for the pen's own width. */
  edge: number;
  x: number;
  cap: number;
  asc: number;
  desc: number;
  /** How far a round letter reaches past a flat one so the two look level. */
  over: number;
  /**
   * Half the width of an arch, measured between the stems it joins.
   *
   * Not the same number as the radius of a bowl, which is what this used to be
   * as well. An arch is as wide as the rhythm of the font wants it; a bowl is
   * as tall as the x-height, and therefore -- being round -- as wide. Sharing
   * one number between them made every o, b, d, p, q and a too small to reach
   * its own x-height, so the round letters sat in a hollow between the flat
   * ones.
   */
  arch: number;
  /**
   * Half the width of a lowercase round letter.
   *
   * Width and height are separate numbers because a bowl need not be circular:
   * the width control narrows or widens every enclosed shape without touching
   * how tall it is, which is the difference between a condensed face and a
   * wide one.
   */
  bowl: number;
  /**
   * How high an arch reaches on this face -- the x-height, brought down by the
   * shoulder's crest. A stem that a shoulder springs from stands here, or the
   * stem pokes up past its own arch.
   *
   * Named apart from `crest` below, which is a different question with a
   * similar name: that one is where a round letter's spine goes to reach a
   * line, this one is where an arch stops short of one.
   */
  crown: number;
  /** Half the height of a lowercase round letter, which fills the x-height. */
  bowlH: number;
  /** Half the width of a capital round letter. */
  capBowl: number;
  /** Half the height of one. */
  capBowlH: number;
  /** How square the bowls are: nought round, one as square as the pen allows. */
  square: number;
  /** How wide a bowl is against its height. */
  wide: number;
  /**
   * How far a stem set beside a bowl stands clear of it.
   *
   * Nought on a face that is drawn, which is what a roman `a` and `d` and `g`
   * and `q` are: the bowl is tangent to the stem and the two share an edge.
   *
   * A written one is not. The pen comes round the bowl, back up its right side,
   * and down again beside it rather than on it -- so there is a stem's own
   * width of daylight between the two, and the letter is wider than an `o` by
   * exactly that. The reference's `a` body is 0.89 of an x-height against its
   * `o`'s 0.79; ours were the same width to the unit, on all four faces, which
   * is a roman `a` on a joined face.
   *
   * The `a` and the `d`, and not the `g`, the `q`, the `b` or the `p`. The
   * reference divides them the same way its letterforms do: a stem that comes
   * down beside a bowl and stops on the baseline stands clear of it, and one
   * that carries on past the line into an extender does not. Its `a` takes 1.19
   * of its `o`'s advance and its `d` 1.30, where its `g` takes 1.07, its `q`
   * 1.10, its `b` 1.08 and its `p` 1.07 -- and ours draws its `g` at 1.43
   * already, so widening that one is the wrong direction twice over.
   */
  aside: number;
  /**
   * The smallest half-measure any shape here may have.
   *
   * A shape narrower than the pen drawing it is not a narrow shape, it is one
   * whose inner edge has passed through itself. Held at the frame rather than
   * inside each shape, so that everything measuring itself against a bowl --
   * where the stem of a b goes, where the straight below a six starts -- reads
   * the same number the bowl was actually drawn at.
   */
  least: number;
  /** How far a corner in a stroke is rounded off, in font units. */
  radius: number;
  /**
   * How far the pen reaches sideways from a stroke running in a given
   * direction.
   *
   * Half the pen, for a pen that is round. A pen with contrast is not round: at
   * an angle of ninety degrees it reaches its full width across a horizontal
   * and a third of that across a vertical, so a corner between two steep arms
   * is offset by far less than half a width. Told half a width regardless, the
   * vee of a reverse-contrast w was placed for an overhang three times what it
   * got, and its feet came to rest seventy-nine units above the baseline.
   */
  reach: (direction: Vec2) => number;
  /**
   * Where to put a spine so that the ink lands on a line, rather than
   * straddling it.
   *
   * A recipe wants to say "along the baseline" or "under the cap line", and
   * what it means is the edge of the stroke, not its middle. Written as the
   * middle -- which is what these all were -- every flat foot sat half a pen
   * low and every flat top half a pen high, so an E hung below the line an H
   * stood on and a T rose above the one a Z stopped at. The two are only the
   * same when a stroke *ends* on the line, cut square, which is why the fault
   * was invisible on every stem in the font and glaring on every bar.
   *
   * `sits` is a run resting on the line, `hangs` is one level with it from
   * below. The share is the stroke's own width against the pen's, for the bars
   * drawn lighter than the stems they cross.
   */
  sits: (line: number, share?: number) => number;
  hangs: (line: number, share?: number) => number;
  /**
   * The same for a curve, which is allowed past its line and expected to be.
   *
   * A round shape stopped level with a flat one reads as short, so it is drawn
   * a little over -- that is what the overshoot is for. `crest` is where the
   * middle of a curve runs so its ink tops out an overshoot above a line;
   * `dip` is the same underneath.
   */
  crest: (line: number) => number;
  dip: (line: number) => number;
  /** How wide a bar is against a stem, for the strokes drawn lighter. */
  bar: number;
  /**
   * How far ink stands off a run lying along a line.
   *
   * Half the pen, for a pen that is round, and not otherwise: a nib with
   * contrast held near the upright is narrow across a horizontal, and one held
   * flat is at its widest there. Told half a width regardless, the arms of a Z
   * on the serif face were set twenty units inside the two lines they were
   * meant to touch -- correctly, for a pen the face does not have.
   *
   * The whole offset, not its length: an angled nib pushes a horizontal run
   * sideways as well as up, and it is the up that decides where the line is.
   */
  upright: number;
  /** How the outside of an unrounded corner is finished. */
  join: JoinKind;
  /** The terminal this style puts on a stroke end. */
  end: Terminal;
  /**
   * The same terminal without the serif.
   *
   * For the marks a serif face leaves bare. A hyphen with a serif on each end
   * is a tiny H, and quotes with them are two little I-beams; no serif face
   * puts them there. Not simply a flat cut, though -- on a face whose strokes
   * end round, a hyphen ends round too, so this follows the terminal and
   * declines only the bar.
   */
  plain: Terminal;
}

/**
 * How far a written stem stands clear of the bowl it is set against, in stem
 * widths.
 *
 * In stems and not in bowls, and the difference is a letter that comes apart. A
 * share of the bowl was the first answer -- the bowl is what the stem is set
 * against, so it looked like the bowl's business -- and it does not shrink when
 * the pen does. At the weight that put the reference's gap on the page, a pen
 * of 40 units left the stem standing 64 units clear of a bowl it could reach 20
 * across: the `a` and the `d` came off in two pieces on all four faces, and the
 * Monoline's at 44 as well.
 *
 * What has to hold is that the two strokes still overlap, and that is the pen's
 * question at every weight. The reference's gap is 0.10 of an x-height against
 * a stem of 0.19, which is a little over half a stem.
 */
export const ASIDE = 0.53;

export function frame(style: Style): Frame {
  const { metrics, pen } = style;
  const half = pen.weight / 2;
  const least = half * 1.06;
  const upright = Math.abs(reachAlong(at(0, 1), penReach(pen)).y);
  // The bowl's own proportion and the face's width multiply: one says how a
  // bowl sits against its height, the other how wide the whole face runs.
  const wide = style.parts.bowl.width * metrics.width;
  /*
   * Half the pen taken off, because a bowl is measured by its ink and drawn by
   * its middle. A ring whose spine reaches the x-height is a letter whose ink
   * reaches half a pen past it: at a display weight that put an o eighty-seven
   * units over the line an n stopped at, which is five hundredths of the em
   * where an overshoot of one or two is what the eye wants.
   *
   * What is left is a round letter exactly as tall as the x-height and its
   * overshoot, at every weight -- and, at a width of one, exactly as wide,
   * which is what a circle is.
   */
  const bowlH = Math.max(metrics.xHeight / 2 + metrics.overshoot - upright, least);
  // In stem widths, and that is the whole of it: see `ASIDE`.
  const aside = style.parts.script.on ? pen.weight * ASIDE : 0;
  const capBowlH = Math.max(metrics.capHeight / 2 + metrics.overshoot - upright, least);
  return {
    style,
    half,
    edge: metrics.sidebearing + half,
    x: metrics.xHeight,
    cap: metrics.capHeight,
    asc: metrics.ascender,
    desc: metrics.descender,
    over: metrics.overshoot,
    arch: Math.max(
      ((metrics.counterWidth + pen.weight) / 2) * heldReach(style) * metrics.width,
      least,
    ),
    bowl: Math.max(bowlH * wide, least),
    crown: metrics.xHeight * style.parts.shoulder.crest,
    aside,
    bowlH,
    /*
     * A width floor, which the height does not have.
     *
     * The height of a round capital is settled by the two lines it has to
     * reach, and at a heavy weight that leaves very little between them --
     * which is correct, and is what a heavy face looks like. Its width is not
     * settled by anything, so left to follow the height down it took every
     * letter measured against it with it, and the N, V and W came out with
     * their two strokes closer together than the pen is wide. Below about a
     * pen and three quarters there is no capital left to draw, so that is the
     * floor, and a heavy cut widens rather than closing up.
     */
    capBowl: Math.max(capBowlH * wide, half * 1.7),
    capBowlH,
    square: style.parts.bowl.squareness,
    wide,
    least,
    radius: style.parts.corner.radius,
    join: style.parts.corner.join,
    reach: (direction) => {
      const offset = reachAlong(direction, penReach(pen));
      return Math.hypot(offset.x, offset.y);
    },
    sits: (line, share = 1) => line + upright * share,
    hangs: (line, share = 1) => line - upright * share,
    crest: (line) => line + metrics.overshoot - upright,
    dip: (line) => line - metrics.overshoot + upright,
    bar: barWeight(style),
    upright,
    end: endFor(style),
    plain: { kind: style.parts.terminal.kind, angle: style.parts.terminal.angle },
  };
}

/**
 * The terminal this style puts on a stroke end, noting that the letter asked.
 *
 * Only the terminal is recorded here. Whether the letter can also take a serif
 * is not something the recipe knows -- a serif needs a straight stroke end, and
 * this is called before anything is drawn -- so that is settled afterwards, by
 * looking at what came out. Recording it here on the strength of the serif
 * being switched on made the control appear only once the serifs already
 * existed, which left no way to switch them on in the first place.
 */
export function endFor(style: Style): Terminal {
  usesThroughout("terminal");
  return terminalFor(style);
}

/**
 * Draw a run with the style's own pen.
 *
 * Which parts the letter turns out to need is read off the shape here rather
 * than declared by the recipe. A closed run is a bowl; a run that changes
 * direction between two straight pieces has a corner. Declared instead, the two
 * would drift apart the first time a letter changed, which this file has
 * already been bitten by twice.
 */
export function ink(
  frame: Frame,
  spine: Spine,
  start: Terminal = BUTT,
  end: Terminal = BUTT,
): Stroke {
  if (spine.closed) uses("bowl");
  else {
    if (frame.style.parts.flare.spread > 0) uses("flare");
    if (frame.style.parts.ball.size > 0) uses("ball");
  }
  if (hasCorner(spine)) uses("corner");
  // The style's own terminal, rather than a plain cut buried inside another
  // stroke: a run wearing one is a run the terminal controls are about.
  if (start === frame.end || end === frame.end) uses("terminal");
  return remember({
    /*
     * Waved after the corners are rounded, not before. Rounding a corner is a
     * conversation between two straight runs, and a run that has already gone
     * wavy is no longer straight -- asked in the other order, a face with both
     * turned up quietly lost every corner it had.
     */
    spine: rippled(frame, roundCorners(spine, frame.radius, frame.half)),
    pen: frame.style.pen,
    start,
    end,
    join: frame.style.parts.corner.join,
  });
}

/** Whether anything in this run turns between two straight pieces. */
export function hasCorner(spine: Spine): boolean {
  const { segments } = spine;
  const upTo = spine.closed ? segments.length : segments.length - 1;
  for (let index = 0; index < upTo; index++) {
    const before = segments[index];
    const after = segments[(index + 1) % segments.length];
    if (before.kind !== "line" || after.kind !== "line") continue;
    const a = towards(before.from, before.to);
    const b = towards(after.from, after.to);
    if (Math.abs(a.x * b.y - a.y * b.x) > 1e-9) return true;
  }
  return false;
}

/**
 * How heavy a bar is against the stems, held to what the Crossbar panel
 * offers: 0.5 to 1.3.
 *
 * Every base is inside that, and past the top of it the bars stop being bars.
 * At 1.6 the three arms of an E and the gaps between them are nearly the same
 * size, so wherever the middle one goes it reads as a block; and the eye of an
 * e takes up most of the bowl. A value from outside the range can still
 * arrive -- a saved document, a script -- and is drawn as the end of it.
 */
export function barWeight(style: Style): number {
  return Math.min(1.3, Math.max(0.5, style.parts.crossbar.weight));
}

/**
 * A bar can be lighter than the stems it crosses, which is how a crossbar
 * avoids looking heavier than the letter around it.
 */
export function thin(
  frame: Frame,
  spine: Spine,
  start: Terminal = BUTT,
  end: Terminal = BUTT,
): Stroke {
  uses("crossbar");
  const { pen } = frame.style;
  const weight = pen.weight * barWeight(frame.style);
  if (start === frame.end || end === frame.end) uses("terminal");
  // Waved against its own width rather than the font's stem, or a bar lighter
  // than the stems would be allowed a deeper wave than it can turn through.
  return remember({
    spine: rippled(frame, spine, weight / 2),
    pen: { ...pen, weight },
    start,
    end,
  });
}

/**
 * A run put through the style's wave, if it has one.
 *
 * Here rather than inside every recipe because a wave is a decision about the
 * face and not about the letter: whatever the recipe drew, if this face
 * undulates then that is what undulates, and a letter added tomorrow gets it
 * without being told.
 */
export function rippled(frame: Frame, spine: Spine, half = frame.half): Spine {
  const { length, depth, along } = frame.style.parts.wave;
  if (along === "off" || depth <= 0) return spine;
  const waved = wavy(spine, length, depth, half, along, (from, to) => inward(frame, from, to));
  if (waved.segments !== spine.segments) uses("wave");
  return waved;
}

/**
 * Which side of a run its wave should ride on.
 *
 * A wave built from arcs that meet tangentially rides on one side of the run
 * rather than swinging either side of it, so which side is a decision, and
 * there is only one right answer: the side the letter is on. The top arm of an
 * E is written to the cap line, and a wave riding up off it puts the arm above
 * the line every other letter stops at -- which is the fault the whole
 * alignment pass existed to remove, walking back in through a new door.
 *
 * A run that is not flat keeps the side the wave was built to ride, because
 * there is no line under it to be carried past.
 */
export function inward(f: Frame, from: Vec2, to: Vec2): number {
  const rise = to.y - from.y;
  const run = to.x - from.x;
  if (Math.abs(rise) > Math.abs(run)) return 1;
  // The left of the way a run travels is up when it travels rightwards.
  const leftIsUp = run >= 0;
  const wantsUp = (from.y + to.y) / 2 < f.cap / 2;
  return wantsUp === leftIsUp ? 1 : -1;
}

/**
 * A round letter is set slightly tighter, or it looks loose beside a flat one.
 *
 * This is also where every stroke has its round ends pulled back, so that a
 * recipe can go on writing where the letter stops rather than where its
 * skeleton stops. Done to the whole set at once rather than inside `ink`,
 * because an alternate letterform builds its strokes by hand and would
 * otherwise be the one place the rule did not hold.
 */
export function finish(frame: Frame, strokes: Stroke[], round = false): Recipe {
  return { strokes: strokes.map((stroke) => capped(frame, stroke)), round };
}

/**
 * A stroke with its spine pulled back from any straight end that finishes in a
 * round cap, by exactly as far as that cap is going to reach.
 *
 * Only the round terminal needs it. A square cut stops where the spine stops;
 * a slab draws its bar across the end and reaches sideways, not forwards; an
 * angled cut slides one corner past and the other back, which is what a nib
 * held at an angle does and is not a mistake to be corrected. A half-disc is
 * the one that simply adds length.
 *
 * And only where the run arrives straight, for the same reason a serif only
 * goes on a straight end: a stem stops on a line and its cap is measured
 * against that line, while a curve's end is in mid-air and its cap is the curl
 * the face is drawn with. Taken off a curve as well, the hook of an f lost the
 * top of its own arc and came up short of the ascender the l beside it reached.
 */
export function capped(frame: Frame, stroke: Stroke): Stroke {
  const segments = stroke.spine.segments;
  if (stroke.spine.closed || segments.length === 0) return stroke;
  /*
   * The first and last pieces that go anywhere, rather than the first and last.
   *
   * A run can begin and end on pieces of no length -- a bowl carries the pieces
   * its shape does not need so that the same shape has the same number of nodes
   * at every weight, and a run cut out of one carries the pieces it does not
   * reach for the same reason. Asked which way a run of no length travels, this
   * got no answer and sized the cap on it: a Slab `c` at its heaviest lost both
   * its serifs to a pair of specks the size of a point.
   */
  const { first, last } = endPieces(stroke.spine)!;
  const leaning = (segment: SpineSegment, which: "start" | "end"): number => {
    if (segment.kind !== "line") return 0;
    const point = which === "start" ? segment.from : segment.to;
    if (!stopsOnALine(frame, point)) return 0;
    const heading = headingAt(segment, which);
    /*
     * And only where the run has the length to be slid along.
     *
     * Levelling a cut carries one of its two corners back up the stroke, and
     * how far depends on how much the stroke leans. Carried past the far end of
     * the run it belongs to, the corner lands behind the piece before it and
     * the stroke is drawn through itself -- which the leg of a k at a heavy
     * weight and a wide corner asked for, at a slide of a hundred and four per
     * cent of its own run.
     *
     * Four fifths rather than the whole of it, because the side of a stroke is
     * shorter than its spine wherever a corner has been cut back into it, and
     * it is the side the corner actually slides along. The legitimate cases sit
     * at about six tenths, so there is room between the two.
     */
    const offset = reachAlong(at(-heading.y, heading.x), penReach(frame.style.pen));
    const slide = Math.abs(offset.y / (heading.y || 1e-9));
    const run = Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
    if (slide > run * 0.8) return 0;
    const steep = Math.abs(heading.y);
    /*
     * Neither upright nor flat: an upright is already square to its line and a
     * flat one lies along it, and it is only the ones in between that finish
     * in a corner off the line they were meant to stop on.
     *
     * Upright means upright, not nearly. The arms of a v on a narrow face lean
     * by about a sixth, which is enough to put their corners twenty units over
     * the x-height and not enough to look like a diagonal, so a gate anywhere
     * short of vertical let exactly the wrong ones through.
     */
    return steep > 0.35 && steep < 0.999 ? steep : 0;
  };
  const startLean = leaning(first, "start");
  const endLean = leaning(last, "end");

  const back = (
    terminal: Terminal,
    segment: SpineSegment,
    which: "start" | "end",
    lean: number,
  ): number => {
    if (terminal.kind !== "round" || segment.kind !== "line") return 0;
    // Far enough back that the far side of the cap lands on the line, which on
    // a stroke arriving at an angle is further than the cap is deep.
    const wanted = frame.reach(headingAt(segment, which)) / (lean > 0 ? lean : 1);
    /*
     * And never the whole run, which `leaning` above already refuses for
     * itself and this did not.
     *
     * The cap reaches half the pen, and half the pen at the Black is wider
     * than some of the runs it is put on the end of. Pulled back that far the
     * run has no length left at all, and a run of no length is not a smaller
     * run: its two ends are the same point, so `stitch` welds them into one
     * node and the letter comes back with fewer nodes than the same letter at a
     * lighter weight. The bracket's arms are `arch * 0.52`, which grows with
     * the pen -- 133 units at the Thin and 153 at the Black -- and they came
     * out 112, 53, 0 and 0, so the Display bracket had 18 nodes at the first
     * two weights and 10 at the last two and could not ride the axis.
     *
     * Four fifths is the figure `leaning` uses, for the same reason and against
     * the same measurement: a run keeps enough of itself to still be a run.
     * Where that bites, the cap reaches past the line it was measured against,
     * which is a smaller wrong than an arm that is not there -- a bracket whose
     * arms have gone is not a bracket.
     */
    const run = Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
    return Math.min(wanted, run * 0.8);
  };
  const fromStart = back(stroke.start, first, "start", startLean);
  const fromEnd = back(stroke.end, last, "end", endLean);

  /*
   * A square cut and a serif alike, because both of them are the same promise
   * -- that the letter stops here -- made in two different shapes.
   */
  /*
   * And only where what is left of the run once a round cap at the other end
   * has been pulled back still has the length to slide along -- the tick of a
   * currency sign at a black weight is a short run with a cap on one end and a
   * level cut on the other, and the cut slid past the cap and folded it.
   */
  const left = (segment: SpineSegment): number =>
    segment.kind !== "line"
      ? 0
      : Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) -
        (first === last ? fromStart + fromEnd : 0);
  const slides = (segment: SpineSegment, which: "start" | "end"): boolean => {
    if (segment.kind !== "line") return false;
    const heading = headingAt(segment, which);
    const offset = reachAlong(at(-heading.y, heading.x), penReach(frame.style.pen));
    return Math.abs(offset.y / (heading.y || 1e-9)) <= left(segment) * 0.8;
  };
  const cut = (terminal: Terminal, lean: number, segment: SpineSegment, which: "start" | "end") =>
    lean > 0 &&
    (terminal.kind === "butt" || terminal.kind === "slab" || terminal.kind === "teardrop") &&
    slides(segment, which)
      ? { ...terminal, level: true }
      : terminal;
  const start = cut(stroke.start, startLean, first, "start");
  const end = cut(stroke.end, endLean, last, "end");
  if (fromStart <= 0 && fromEnd <= 0) return inherit(stroke, { ...stroke, start, end });
  const pulled = { ...stroke, start, end, spine: shortened(stroke.spine, fromStart, fromEnd) };
  /*
   * A run too short for its caps is cut square instead, at its full length.
   * The arms of a guillemet at a black weight are pulled back so far to make
   * room for their caps that the two caps meet in the middle and the outline
   * crosses itself; cut square where they were drawn to stop, they are clear.
   * Only where the letter has run out of room for a round end at all.
   */
  if (sweep(pulled).some((contour) => contoursIntersect([contour]))) {
    const square = (terminal: Terminal): Terminal =>
      terminal.kind === "round" ? { ...terminal, kind: "butt" } : terminal;
    return inherit(stroke, { ...stroke, start: square(start), end: square(end) });
  }
  return inherit(stroke, pulled);
}

/**
 * Whether a stroke end was written on one of the lines the letter is drawn
 * between, rather than stopping somewhere of its own.
 *
 * Asked exactly rather than loosely. Every recipe that means a line writes the
 * line, so a rounding error of tolerance is enough -- and anything looser
 * catches ends that did not mean it. Given a fifth of the pen, the question
 * mark's neck, which leaves its bowl at thirty-five degrees below the middle,
 * came out close enough to a low x-height to be cut level with it, and the
 * letter folded where the two pieces no longer met.
 */
export function stopsOnALine(f: Frame, point: Vec2): boolean {
  return [0, f.x, f.cap, f.asc, f.desc].some((line) => Math.abs(point.y - line) < 1);
}

/** Which way a run is travelling where it begins or where it ends. */
export function headingAt(segment: SpineSegment, which: "start" | "end"): Vec2 {
  if (segment.kind === "line") return towards(segment.from, segment.to);
  const angle = which === "start" ? segment.startAngle : segment.endAngle;
  const way = segment.endAngle >= segment.startAngle ? 1 : -1;
  return at(-Math.sin(angle) * way, Math.cos(angle) * way);
}

// ---------------------------------------------------------------------------
// Shapes that more than one letter is made of
// ---------------------------------------------------------------------------

/**
 * How far a chained run carries on into the stem it meets.
 *
 * A letter such as an N is a stem, a diagonal and a stem, and the diagonal has
 * to turn a real corner where it meets each of them: the outside of that corner
 * is a wedge, and nothing else fills it. Turning a corner means the two are one
 * run -- but then the stem's own ends are interior points of that run, and a
 * serif cannot sit on an interior point, so a serifed N would lose two of its
 * four.
 *
 * So the stems stay strokes in their own right and keep their serifs, and the
 * diagonal carries a short way along each stem before it turns. That short run
 * lies exactly on top of the stem it copies, so its square end is buried in ink
 * that is already there and never shows, while the corner it turns is the real
 * one.
 */
export const stub = (f: Frame): number =>
  /*
   * Long, and long for a reason. The inside of a corner is cut back to where
   * the two offsets cross, and how far back that is grows without bound as the
   * corner sharpens: half a pen divided by the tangent of half the angle. If
   * the run is shorter than that the cut cannot be made and the crossing
   * survives as a loop.
   *
   * At five half-pens a narrow M at a hairline weight came up fifteen units
   * short of what its own top-left corner needed. A run along a stem has the
   * whole stem to play with, so it takes a share of the letter's height and the
   * question stops depending on the weight at all.
   */
  Math.max(f.half * 5, f.cap * 0.3);

/**
 * Where a diagonal leaving a stem at a line has to start, for its outer edge
 * to cross that line just outside the stem's inner edge.
 *
 * The other way to join a diagonal to a stem is a stub run down the stem and a
 * corner (see `stub`), which is right while the corner stays where it was put.
 * But `through` moves a sharp corner in along its bisector to keep its point
 * on the line, and at a black weight it moved the N's ninety units into the
 * letter: the stub leaned off the stem, and its edge stood out of the stem's
 * inner side as a step. A diagonal cut level on the line needs no corner at
 * all -- its cut lies inside the stem and along the line the stem stops on --
 * and where its outer edge leaves the stem is decided here, exactly.
 *
 * `from` is the stem's spine on the line, `inward` which way the letter lies
 * from it (1 to the right), `to` where the diagonal is going and `side` which
 * edge of it is the outer one, as the side of travel (1 to the left).
 */
export function leaving(f: Frame, from: Vec2, inward: 1 | -1, to: Vec2, side: 1 | -1): Vec2 {
  const pen = penReach(f.style.pen);
  const stemReach = Math.abs(reachAlong(at(1, 0), pen).x);
  const target = from.x + inward * (stemReach + f.half * 0.1);
  // Where the edge on one side of a diagonal from (x, line) crosses the line.
  const crossing = (x: number, which: 1 | -1): number => {
    const d = towards(at(x, from.y), to);
    const offset = reachAlong(at(-d.y * which, d.x * which), pen);
    return x + offset.x - (offset.y / d.y) * d.x;
  };
  let x = target;
  for (let pass = 0; pass < 12; pass++) x += target - crossing(x, side);
  /*
   * And never so far over that the cut's other corner comes out of the far
   * side of the stem: a diagonal wider along the line than the stem is
   * lets its outer edge leave further into the letter instead.
   */
  const outside = from.x - inward * stemReach;
  for (let pass = 0; pass < 12; pass++) {
    const miss = outside - crossing(x, -side as 1 | -1);
    if (miss * inward <= 0) break;
    x += miss;
  }
  return at(x, from.y);
}

/**
 * Whether a face joins its diagonals to its stems with a level cut rather than
 * a stub and a corner: a serifed face that does not round its corners or its
 * ends, which a cut lying square on the line would leave poking out of the
 * stem. Only the serifed faces, whose stems are strokes that stop on the line
 * anyway: the sans faces are laid on a grid by their spines (see `kit.ts`),
 * and a diagonal that starts beside its stem rather than on it crossed out of
 * the stem's own column.
 */
export function cutsLevel(f: Frame): boolean {
  const { wave } = f.style.parts;
  return (
    f.style.parts.slab.on &&
    f.radius < 1 &&
    f.end.kind !== "round" &&
    (wave.depth <= 0 || wave.along === "off")
  );
}

/**
 * Skeleton vertices for a run that should reach a given set of points.
 *
 * A skeleton says where the middle of a stroke runs, and at a sharp corner the
 * middle is not where the letter ends: the two outer edges carry on past it and
 * meet somewhere further out. How far depends on how sharp the corner is --
 * half the pen divided by the sine of half the angle -- and on a vee of sixty
 * degrees that is a whole pen width.
 *
 * Which is why writing the vertex of a V at the baseline put its point a
 * hundred and twenty units below it, and on the display face two hundred and
 * fifty. The letters were not wrong about where their middles ran; they were
 * being asked the wrong question. A designer does not put the middle of a
 * stroke at the baseline, they put the point of the vee there.
 *
 * So this takes the points the ink should reach and returns the vertices that
 * produce them. It has to be solved rather than calculated, because each vertex
 * changes the angle at its neighbours: a w has four corners and moving the two
 * feet up steepens the middle peak, which moves the peak, which changes the
 * feet again. Worked out in one pass the feet came to rest sixty units above
 * the baseline -- close enough to look almost right, which is the worst place
 * for it to be.
 */
export function through(f: Frame, tips: Vec2[]): Vec2[] {
  const points = tips.map((tip) => at(tip.x, tip.y));
  for (let pass = 0; pass < 40; pass++) {
    for (let index = 1; index < tips.length - 1; index++) {
      const before = points[index - 1];
      const after = points[index + 1];
      const a = towards(points[index], before);
      const b = towards(points[index], after);
      const between = a.x * b.x + a.y * b.y;
      // The true half-angle, not the one held back for the miter limit. A
      // rounded corner has no miter limit, and handing it the clamped angle
      // made it plan a rounding that the rounding itself then refused to do.
      const halfAngle = Math.sqrt(Math.max(0, (1 - between) / 2));
      const bisector = towards(at(0, 0), at(a.x + b.x, a.y + b.y));
      /*
       * Held to the length of the shorter arm, and moved half way each pass.
       *
       * Without both, this does not settle. A corner that has been rounded off
       * reaches a different distance from a corner that has not, and near the
       * radius where one becomes the other a vertex flips between the two
       * answers: it moves out, which shortens its arms, which shortens the
       * radius they can spare, which moves it back. Undamped, a w on a face
       * with wide corners threw a spike four hundred units below the baseline.
       */
      const arm = Math.min(
        Math.hypot(points[index].x - before.x, points[index].y - before.y),
        Math.hypot(points[index].x - after.x, points[index].y - after.y),
      );
      const wanted = Math.max(
        -arm,
        Math.min(arm, overhang(f, halfAngle, points[index], before, after)),
      );
      const target = at(tips[index].x + bisector.x * wanted, tips[index].y + bisector.y * wanted);
      points[index] = at((points[index].x + target.x) / 2, (points[index].y + target.y) / 2);
    }
  }
  return points;
}

/**
 * How far past its own vertex the ink at a corner reaches.
 *
 * A point carries out to where the two outer edges meet. A corner that has been
 * rounded off does not: its outer edge is an arc of the radius plus half the
 * pen, sitting further back, and once the radius is large enough the ink stops
 * short of the vertex rather than passing it. So the two cases have different
 * signs, and a letter drawn for one and displayed with the other is either
 * short of the baseline or through it.
 */
export function overhang(
  f: Frame,
  sinHalf: number,
  vertex: Vec2,
  before: Vec2,
  after: Vec2,
): number {
  // How far the two arms are actually offset, which is half the pen only when
  // the pen is round.
  const arms = [before, after].map((neighbour) => {
    const along = towards(vertex, neighbour);
    return f.reach(at(-along.y, along.x));
  });
  const half = (arms[0] + arms[1]) / 2;
  /*
   * How far the ink reaches past the vertex when the corner is left sharp, and
   * it depends on how the sweep is going to finish it.
   *
   * A point carries out to where the two outer edges meet. A round join reaches
   * only the pen itself, half a width from the vertex however sharp the corner
   * is. A bevel takes the chord across that, which is nearer still. Assuming a
   * point for all three placed the feet of a bevelled v ninety units above the
   * baseline and the feet of a ribbon w a hundred and thirty-five, because the
   * recipe was compensating for an overshoot the sweep was never going to
   * produce.
   *
   * The miter limit is applied here the same way the sweep applies it, so the
   * two agree about when a very sharp corner stops being carried to its point
   * and gets rounded instead.
   */
  const mitred = half / Math.max(sinHalf, 1e-6);
  const point =
    f.join === "bevel"
      ? half * sinHalf
      : f.join === "round" || mitred > f.half * MITER_LIMIT
        ? half
        : mitred;
  if (f.radius <= 0) return point;
  const cosHalf = Math.sqrt(Math.max(0, 1 - sinHalf * sinHalf));
  const spare =
    Math.min(
      Math.hypot(vertex.x - before.x, vertex.y - before.y),
      Math.hypot(vertex.x - after.x, vertex.y - after.y),
    ) * 0.5;
  // The same clamps the rounding itself applies, so the two agree about where
  // the corner ends up rather than each assuming the other gave way.
  const wanted = Math.max(f.radius, f.half * 1.06);
  const radius = Math.min(wanted, (spare * sinHalf) / Math.max(cosHalf, 1e-6));
  if (radius < f.half * 1.06 * 0.999) return point;
  return radius + half - radius / sinHalf;
}

/**
 * The interior vertices of a run meant to reach every one of these points,
 * which is what a chain with more than one corner needs.
 *
 * Solving each corner on its own passes it the *intended* position of its
 * neighbours rather than where they actually ended up, and the two answers are
 * not always close: how far ink reaches past a vertex falls off a cliff at the
 * miter limit, from four half-pens to one. An M whose top corners sat either
 * side of that cliff was told forty-six units and drawn a hundred and sixty,
 * and its apexes stood a hundred and fourteen units above the cap line.
 */
export function corners(f: Frame, tips: Vec2[]): Vec2[] {
  return through(f, tips).slice(1, -1);
}

/** The one-corner case, which is most of them. */
export function corner(f: Frame, from: Vec2, tip: Vec2, to: Vec2): Vec2 {
  return through(f, [from, tip, to])[1];
}

/**
 * Where the vee of a K meets its stem.
 *
 * Aimed at the stem's far edge, which is where a K's junction belongs. The
 * trouble is that the point is then rounded, and `corner` pulls a turn back
 * along its own bisector -- further on a face with a large corner radius --
 * so the rounded apex can land outside the stem altogether. On Fairground the
 * vee finished forty-seven units clear of it, which is exactly what a k with
 * a gap in it looks like, and on Psychedelic six.
 *
 * Even where it landed on the edge the two shapes only touched, along a line
 * and over no area, so the union had nothing to join: eleven of the sixteen
 * faces drew their k and K as two separate solids. That reads as one letter
 * until something asks -- and a break cut took the vee off a k that had never
 * been attached to its stem.
 *
 * So the apex is asked for, and asked for again further in when the first
 * answer came back too far out, correcting by the miss itself. A face that
 * rounds nothing is left where it was; a face that rounds a lot moves exactly
 * as far as it needs. Giving every face the worst face's allowance instead
 * would swing the arms of a Sans k by a tenth of its x-height.
 *
 * What that miss is measured on is the whole of it, and measuring it on the
 * wrong point is what let the Formal Script's k come apart the moment its pen
 * went from 96 units to 120. `through` hands back the vertex before it is
 * rounded, and that vertex was inside the stem quite happily -- 142.9 against a
 * limit of 145, so the guard never fired and no correction was made.
 * `roundCorners` then threw it away: the arc it puts in the corner's place sits
 * back along the bisector by the radius over the sine of the half-angle, which
 * on a sixty-degree vee rounded at 63.6 units is another 64. The apex the guard
 * had approved was drawn 92 units clear of the stem, and the two strokes were
 * held together by nothing but ink -- about twenty units of overlap, which the
 * bow then walked the stem out of.
 *
 * So the vee is rounded here, with the same call the recipe is going to make,
 * and the miss is read off where the ink really ends up. A face that rounds
 * nothing gets its vertex back unchanged and is left exactly where it was:
 * driving the correction home instead, until every face's apex sat on the
 * limit rather than near it, moved the Flared k by seven and a half units and
 * cost it 1,256 points under the rim in place of 355, because eight passes
 * double whatever new corner they are given.
 */
export function junction(f: Frame, arm: Vec2, stem: number, height: number, leg: Vec2): Vec2 {
  // Far enough past the edge to overlap rather than touch. A quarter of the
  // stem is well inside the ink at every weight and hidden by it.
  const inside = stem + f.half - f.half * 0.5;
  const asked = at(stem + f.half, height);
  const meet = corner(f, arm, asked, leg);
  const lands = rounded(f, arm, meet, leg);
  if (lands <= inside) return meet;
  return corner(f, arm, at(asked.x - (lands - inside), height), leg);
}

/**
 * How far into the stem a vee drawn through this vertex really reaches, once
 * the corner has been rounded off the way the recipe is about to round it.
 */
export function rounded(f: Frame, arm: Vec2, meet: Vec2, leg: Vec2): number {
  const spine = roundCorners(chain(straight(arm, meet), straight(meet, leg)), f.radius, f.half);
  let least = Infinity;
  for (const segment of spine.segments) {
    if (segment.kind === "line") {
      least = Math.min(least, segment.from.x, segment.to.x);
      continue;
    }
    least = Math.min(least, ...ends(segment).map((point) => point.x));
    // The leftmost point of the circle, but only where the arc actually goes
    // through it.
    if (sweeps(segment, Math.PI)) least = Math.min(least, segment.centre.x - segment.radius);
  }
  return Number.isFinite(least) ? least : meet.x;
}

/**
 * Where a rounded vee actually bottoms out, in both x and y.
 *
 * The same question `rounded` asks of a K sideways, asked of a Y downwards, and
 * asked because two of the three points that look like the bottom of a vee are
 * not on the ink at all.
 *
 * The recipe names the point the ink should reach. `through` hands back the
 * skeleton vertex that puts the ink there, and for a pen that is rotated -- as
 * every script pen here is -- that vertex is not above the tip but up and to
 * one side of it: thirty-two units to the side on the Formal Script. Then
 * `roundCorners` lifts the spine off that vertex as well.
 *
 * So a stem told to stand at the tip stands beside the vee rather than under
 * it, and the Formal Script Y was two pieces at every weight and every bowl
 * width below 0.95 -- the ink of a vee is wide enough to hide the mistake until
 * something narrows it.
 */
export function dips(f: Frame, arm: Vec2, meet: Vec2, leg: Vec2): Vec2 {
  const spine = roundCorners(chain(straight(arm, meet), straight(meet, leg)), f.radius, f.half);
  const seen: Vec2[] = [];
  for (const segment of spine.segments) {
    if (segment.kind === "line") {
      seen.push(segment.from, segment.to);
      continue;
    }
    seen.push(...ends(segment));
    // The bottom of the circle, but only where the arc actually goes through it.
    if (sweeps(segment, -Math.PI / 2)) {
      seen.push(at(segment.centre.x, segment.centre.y - segment.radius));
    }
  }
  // The lowest point the rounded spine reaches, which is above the vertex it
  // was rounded from -- not the lower of the two, which would be the vertex.
  let low = seen[0] ?? meet;
  for (const point of seen) if (point.y < low.y) low = point;
  return low;
}

/** Whether an arc passes through the given angle on its way from start to end. */
export function sweeps(arc: SpineArc, angle: number): boolean {
  const turn = Math.PI * 2;
  const from = ((arc.startAngle % turn) + turn) % turn;
  const to = ((arc.endAngle % turn) + turn) % turn;
  const want = ((angle % turn) + turn) % turn;
  const along = ((want - from) * (arc.sweepPositive ? 1 : -1) + turn) % turn;
  const whole = ((to - from) * (arc.sweepPositive ? 1 : -1) + turn) % turn;
  return along <= whole;
}

/** An arc's two ends. */
export function ends(arc: SpineArc): Vec2[] {
  return [arc.startAngle, arc.endAngle].map((angle) =>
    at(arc.centre.x + Math.cos(angle) * arc.radius, arc.centre.y + Math.sin(angle) * arc.radius),
  );
}

export function towards(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return at(dx / length, dy / length);
}

/**
 * A dot, as on an i or a full stop.
 *
 * Drawn as a stroke going almost nowhere with round caps on both ends, so the
 * two half-discs meet and make a disc. The obvious alternative -- a ring of no
 * radius swept by a fat pen -- asks the inner offset for a negative radius, and
 * an ellipse with a negative axis turns itself inside out: the dots on i and j
 * came out as nothing at all.
 *
 * The one unit of length left in it is what gives the caps a direction to face;
 * at a thousand units to the em it is a fifth of the rounding.
 */
/**
 * The room a mark is drawn in.
 *
 * One box for all of them, so an acute and a circumflex on the same font are
 * the same size and sit at the same height -- which is what makes a set of
 * accents look like a set rather than like several people's work.
 *
 * Measured off the font rather than fixed. The width comes from the bowl, so a
 * condensed face gets narrow accents and a wide one broad ones; the height
 * comes from the room between the x-height and the ascender, which is exactly
 * the space an accent has to live in before it starts fouling the line above.
 * A gap is left under it: an accent resting directly on the letter reads as
 * part of the letter, and the eye needs the daylight to tell them apart.
 */
export interface MarkBox {
  /** The middle of the mark, across. */
  cx: number;
  /** Half its width. */
  w: number;
  /** Where it stands, and how high it reaches. */
  foot: number;
  top: number;
}

/**
 * The frame a mark is drawn in, which is the font's own unless the font is too
 * heavy for one.
 *
 * A mark cannot be shorter than the pen that draws it. On a display face whose
 * stems are a seventh of the em, and whose tall x-height leaves almost nothing
 * between it and the ascender, that floor is higher than the whole space the
 * accent has -- so the accent stood half an em above the cap line, not because
 * it was drawn large but because it could not be drawn small.
 *
 * Lightening the pen is what a designer does about that, and every heavy face
 * with an accent in it has done it. Text weights are left exactly as they are:
 * the limit only bites where the alternative is an accent that does not fit.
 */
export function markFrame(style: Style): Frame {
  const f = frame(style);
  const room = Math.max(f.asc - f.x, style.metrics.unitsPerEm * 0.1);
  const most = room * 0.42;
  if (style.pen.weight <= most) return f;
  return frame({ ...style, pen: { ...style.pen, weight: most } });
}

/**
 * How a short run ends.
 *
 * The face's own, where a run has the length to carry it. An angled cut slides
 * one corner of the end forward and the other back, by an amount set by the pen
 * rather than by the run -- and on a stroke a hundred units long that is most
 * of the stroke, so the two ends met in the middle and the acute of the serif
 * face folded through itself. The arms of a multiply sign did the same. A round
 * cap is safe at any length, being a half-disc; a square one always is. A serif
 * is not offered at all: the bar of one is wider than an accent is long.
 *
 * For the accents and for the signs, which is every run in the font too short
 * to be cut at an angle.
 */
export function shortEnd(f: Frame): Terminal {
  return f.plain.kind === "round" ? f.plain : BUTT;
}

export function markBox(f: Frame): MarkBox {
  const room = Math.max(f.asc - f.x, f.style.metrics.unitsPerEm * 0.1);
  const w = Math.max(f.bowl * 0.42, f.half * 1.1);
  /*
   * Sized by the ink it leaves, not by where its spine runs.
   *
   * A spine is swept by the pen, so the mark reaches half a pen past each end
   * of it -- and further still at the apex of a circumflex, where the two
   * edges are carried on to meet. Sized by the spine, the accents came out
   * half as tall again as they were meant to be and an accented capital stood
   * at one and a half times the cap height. Taking the pen off first aims at
   * the height that will actually be there, and it adapts: a heavy face has
   * chunky accents, and they are not also tall ones.
   */
  const ink = room * 0.72;
  const height = Math.max(ink - f.half * 2, f.half * 0.55);
  const foot = f.x + room * 0.13;
  return { cx: f.edge + w, w, foot, top: foot + Math.min(height, w * 1.7) };
}

export function dot(frame: Frame, centre: Vec2, radius: number): Stroke {
  const round: Terminal = { kind: "round" };
  return {
    spine: straight(at(centre.x - 0.5, centre.y), at(centre.x + 0.5, centre.y)),
    pen: { ...frame.style.pen, contrast: 0, weight: radius * 2 },
    start: round,
    end: round,
  };
}

/**
 * How big a full stop is: a little under a stem across on a face with no
 * contrast, and larger than the stem as the contrast rises, since the stem
 * is measured at the pen's widest and a dot is round. Lora's full stop is 1.36
 * of its stem. And never a speck at a hairline weight on a face with contrast:
 * a light text face keeps its dots about the size of the regular's.
 */
export function stopRadius(f: Frame): number {
  // A joined hand keeps the pen's own dot: its comma is run into the join.
  if (f.style.parts.script.on) return f.half * 0.95;
  const { contrast } = f.style.pen;
  const c = Math.min(Math.max(contrast, 0), 0.95);
  return Math.max(f.half * (0.95 + 0.6 * c), f.style.metrics.unitsPerEm * 0.045 * c);
}

/**
 * The dot over an i or a j: the same reasoning as `stopRadius`, a little
 * smaller, as Lora's is (108 across against a full stop of 117), and set above
 * the x-height by a stem and a half -- or less, where a black weight would
 * otherwise carry it past the ascender.
 */
export function tittle(f: Frame, x: number): Stroke {
  const { contrast } = f.style.pen;
  const c = Math.min(Math.max(contrast, 0), 0.95);
  const radius = Math.max(f.half * (0.55 + c), f.style.metrics.unitsPerEm * 0.04 * c);
  const y = Math.min(f.x + f.half * 1.5 + radius, f.asc + f.over - radius);
  return dot(f, at(x, Math.max(y, f.x + f.half * 0.6 + radius)), radius);
}

/**
 * The tail of a comma, and the lower half of a semicolon.
 *
 * Drawn with its own round pen rather than the font's. On a face with contrast
 * the round cap on a slanted stroke turned itself inside out, and on a heavy
 * one the cap reached back past the origin, so the comma sat outside its own
 * letter.
 */
export function tail(frame: Frame, radius: number): Stroke {
  const round: Terminal = { kind: "round" };
  const top = at(frame.edge + radius * 0.45, radius * 1.5);
  return {
    spine: straight(top, at(top.x - radius * 0.4, -radius * 1.7)),
    pen: { ...frame.style.pen, contrast: 0, weight: radius * 2 },
    start: round,
    end: round,
  };
}

/**
 * An arch: over the top from one stem to the next, then down.
 *
 * Where it springs from is a style decision rather than a drawing decision,
 * which is why n, m, h and r all move together when it changes.
 */
/**
 * How high an arch really goes, which on a written hand is short of the waist.
 *
 * The reference tops its `n` at 0.88 of an x-height and its `u` at 0.90, where
 * its `m`, `v`, `w` and `x` reach 1.00 and its `o`, `e` and `z` overshoot to
 * 1.06 and beyond. A quarter of an x-height between the lowest letter and the
 * highest is most of what makes a line of it look written; ours were all inside
 * four hundredths of each other, which is a row of soldiers.
 *
 * Only where the arch is reaching for the x-height. A capital is set down
 * deliberately on its two lines and does not sag, which is what every face here
 * promises, so a shoulder drawn to the cap height is left alone.
 */
export function crested(frame: Frame, height: number): number {
  return height === frame.x ? height * frame.style.parts.shoulder.crest : height;
}

/**
 * How far the arch carries over, held to what the Shoulder panel offers.
 *
 * The panel stops at 0.6 and 1.3 (`parts.ts` has the argument for both ends),
 * and every base sits inside that; a value from outside it can still arrive,
 * from a saved document or a script, and nothing about the letters is built
 * for it. The rhythm of an `m` is two arches of this reach side by side, so
 * past the top of the range the arches were wider than anything else in the
 * face was spaced for.
 */
export function heldReach(style: Style): number {
  return Math.min(1.3, Math.max(0.6, style.parts.shoulder.reach));
}

/**
 * The radius the arch turns through at each end of its flat top.
 *
 * The springing sets it: the higher the arch leaves the stem, the less
 * height there is left to turn in, and the squarer the shoulder. That is the
 * control working -- but only down to a point. Taken all the way, a springing
 * of 0.9 left a turn of barely half a pen at each corner of an arch four pens
 * across, and an n, an m and an h came out as boxes: a lid on two posts, with
 * the two arches of the m running together into one bar across the top.
 * Nothing drawn like that reads as an arch.
 *
 * So the turn is never tighter than half the arch's own reach. The squarest
 * shoulder any base draws is the Psychedelic's, at 0.64 of its reach, so none
 * of them is touched; the top of the Springing slider is, and it now squares
 * the shoulder as far as a shoulder goes and stops there. And never tighter
 * than half the pen, below which the inside of the turn would pass through
 * itself.
 *
 * The springing itself is held to the panel's range too, 0.3 to 0.85, for
 * the same reason the reach is.
 */
export function shoulderRadius(frame: Frame, height: number): number {
  const spring = Math.min(0.85, Math.max(0.3, frame.style.parts.shoulder.spring));
  const reach = frame.arch;
  return Math.max(frame.half, reach * 0.5, Math.min(reach, height * (1 - spring)));
}

export function arch(frame: Frame, fromX: number, height: number): Stroke {
  return ink(frame, archSpine(frame, fromX, height), BUTT, frame.end);
}

/**
 * The same, as a run rather than a stroke, and stopping where it is told.
 *
 * An eng is an n whose right leg carries on below the line and hooks back, and
 * that leg is one run from the top of the shoulder to the end of the hook: the
 * arch cannot be drawn and the hook added, or the face's own terminal is drawn
 * across the middle of the leg and a serif eng grows a foot halfway down.
 */
export function archSpine(frame: Frame, fromX: number, height: number, bottom = 0): Spine {
  uses("shoulder");
  height = crested(frame, height);
  /*
   * A quarter turn up, a flat run across the top, a quarter turn down.
   *
   * Not a half circle, which is what this was. A half circle is exactly as tall
   * as half its own width, so an arch wide enough for the rhythm of the font
   * rose 33 units past the x-height and an n came out taller than an H. Nobody
   * noticed by looking; the letters simply seemed a little large.
   *
   * Splitting it lets the two measurements be set separately: how far over the
   * arch reaches is the rhythm, and how round the corner is comes from where
   * the shoulder springs. A high springing leaves a small radius and a long
   * flat, which is a squared, industrial n; a low one rounds the whole thing.
   */
  const reach = frame.arch;
  // Never tighter than half the pen: below that the inside of the turn would
  // pass through itself, which a high springing on a heavy face asks for.
  const radius = shoulderRadius(frame, height);
  const landing = fromX + reach * 2;
  /*
   * The crest is where the spine goes, not where the letter reaches: the flat
   * along the top of an arch is the side of a stroke, so the ink stands half a
   * pen above it. Set half a pen down and the overshoot back up, and the
   * shoulder of an n comes to rest exactly where the shoulder of an o does.
   *
   * Never below the radius, or the run down the far side would be asked to go
   * upwards -- which only a pen wider than the x-height could ask for, but that
   * is a setting the panel offers.
   */
  const crest = Math.max(frame.hangs(height) + frame.over, radius);
  const top = crest - radius;
  return chain(
    turn(at(fromX + radius, top), radius, 180, 90),
    straight(at(fromX + radius, crest), at(landing - radius, crest)),
    turn(at(landing - radius, top), radius, 90, 0),
    // Never above where the corner leaves off, for the same reason the crest is
    // never below the radius: a leg told to run upwards folds the letter.
    straight(at(landing, top), at(landing, Math.min(bottom, top))),
  );
}

/** The other way up: down one side, round the bottom, up the other. */
export function trough(frame: Frame, fromX: number, height: number, reach = frame.arch): Stroke {
  uses("shoulder");
  height = crested(frame, height);
  // Never wider than the trough it turns in, for a reach other than the arch's.
  const radius = Math.min(shoulderRadius(frame, height), Math.max(reach, frame.half));
  const rising = fromX + reach * 2;
  // Half a pen up off the baseline and the overshoot back down, so the round
  // bottom of a u finishes level with the round bottom of an o.
  const floor = Math.min(frame.sits(0) - frame.over, height - radius);
  return ink(
    frame,
    chain(
      straight(at(fromX, height), at(fromX, floor + radius)),
      turn(at(fromX + radius, floor + radius), radius, 180, 270),
      straight(at(fromX + radius, floor), at(rising - radius, floor)),
      turn(at(rising - radius, floor + radius), radius, 270, 360),
      straight(at(rising, floor + radius), at(rising, height)),
    ),
    frame.end,
    frame.end,
  );
}

/**
 * The spine of an s.
 *
 * A round face draws it as two wide bowls with a spine falling between them:
 * see `roundSpine`. A squared face, whose turns are not circles, stacks two
 * bends tangent at the waist.
 */
export function spine(frame: Frame, height: number, left: number): { stroke: Stroke } {
  if (frame.square < 0.01) {
    return { stroke: ink(frame, roundSpine(frame, height, left), frame.end, frame.end) };
  }
  /*
   * Four radii from top to bottom, unless the pen will not go round one that
   * small, in which case the s grows rather than closing up. The height asked
   * for is the height of the ink, so the four radii span the pen's own width
   * less than it.
   */
  const radius = Math.max((height + frame.over * 2 - frame.upright * 2) / 4, frame.least);
  const foot = height / 2 - radius * 2;
  /*
   * And the ends carried less far round the further the pen has to reach:
   * measured in pen widths rather than in degrees, so a hairline keeps its
   * long tight curl and a display weight lets go of it.
   */
  const opening = (r: number): number => ((frame.half * 0.6) / r) * (180 / Math.PI);
  const middle = left + bendWidth(frame, radius);
  const upper = at(middle, foot + radius * 3);
  const lower = at(middle, foot + radius);
  const open = opening(radius);
  return {
    stroke: ink(
      frame,
      chain(
        bend(frame, upper, radius, 25 + open, 270),
        bend(frame, lower, radius, 90, -155 + open),
      ),
      frame.end,
      frame.end,
    ),
  };
}

/**
 * The run of a round s: two bowls wider than they are tall, and a spine that
 * falls across the letter between them.
 *
 * Seven pieces at every weight, so a weight axis can follow it: from the upper
 * terminal a turn up to the top, a flat run left along it, a turn down the left
 * side to where the spine leaves, the spine, a turn down the right side of the
 * lower bowl, a flat run left along the bottom, and a turn up into the lower
 * terminal.
 *
 * Built from circles alone, as it was, the two bowls were as tall as they were
 * wide. A black pen needs a turn at least as big as itself to go round, so the
 * two turns ate the whole height between them: the waist lay level, or even
 * climbed, through the middle of the letter; the spine, drawn nearly flat by a
 * pen that is thin along a flat, came out a hairline; and the counters closed
 * to slits. A bold s is the other way about -- its spine is the steepest and
 * heaviest thing in it and its bowls are wide and open -- and the flat runs
 * along the top and the bottom are where that width comes from without costing
 * any height.
 *
 * So the turns are no bigger than the pen needs, the spine falls at a fixed
 * slope, and the flats take up whatever width is left. Only where the pen
 * leaves no room for a slope that steep -- the heaviest weights -- does the
 * spine lie flatter, and past that the letter grows taller than the line
 * rather than closing up.
 */
function roundSpine(frame: Frame, height: number, left: number): Spine {
  // The height the spine spans: the ink's, less half a pen top and bottom.
  const inked = height + frame.over * 2 - frame.upright * 2;
  // How wide the spine runs from the left of the upper bowl to the right of
  // the lower one: three fifths of its height, as an s has always been.
  const width = inked * 0.62 * frame.wide;
  const least = Math.max(frame.half * 1.08, frame.least);
  /*
   * How far the lower bowl's turn sits right of the upper one's, for a turn of
   * radius r and a spine falling at `slope` across a height h. The spine
   * leaves the upper turn and reaches the lower one square to itself, so the
   * two turns and the spine between them fix it.
   */
  const shift = (r: number, slope: number, h: number): number =>
    -2 * r * Math.sin(slope) + (h - 2 * r * (1 + Math.cos(slope))) / Math.tan(slope);
  // What is left of the height for the spine to fall through.
  const fall = (r: number, slope: number, h: number): number => h - 2 * r * (1 + Math.cos(slope));
  /*
   * The slope a text s's spine falls at, and the radius that gives the letter
   * its width at that slope: the lower bowl's right side lands on the far edge
   * of the letter. Linear in the radius, so written out.
   */
  const steep = (30 * Math.PI) / 180;
  const flattest = (21 * Math.PI) / 180;
  const denominator = 2 * (Math.sin(steep) + (1 + Math.cos(steep)) / Math.tan(steep) - 1);
  const fitted = (inked / Math.tan(steep) - width) / denominator;
  const radius = Math.max(Math.min(fitted, inked * 0.24), least);
  /*
   * A turn held up by the pen leaves the lower bowl short of the far edge, and
   * the spine is laid flatter until it reaches it -- but never flatter than a
   * pen thin along a flat can draw with weight in it. What the letter still
   * lacks after that, it lacks: a black s is narrower than its o.
   */
  let slope = steep;
  if (shift(radius, steep, inked) < width - 2 * radius) {
    let lo = flattest;
    let hi = steep;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (shift(radius, mid, inked) < width - 2 * radius) hi = mid;
      else lo = mid;
    }
    slope = Math.max(flattest, (lo + hi) / 2);
  }
  /*
   * And a spine has to have some length to it, or the two turns cross. Where
   * the height leaves none -- a pen more than a third of the x-height -- the
   * letter grows, evenly above and below, by as much as the spine is short.
   */
  const shortest = (r: number, a: number): number => r * 0.2 * Math.sin(a);
  /*
   * A steep spine takes less height than a flat one, so a letter that has to
   * grow stands its spine up as far as it can while the lower bowl still sits
   * to the right of the upper, and grows by what is left.
   */
  const growth = (a: number): number => Math.max(0, shortest(radius, a) - fall(radius, a, inked));
  if (growth(slope) > 0) {
    let best = slope;
    for (let d = 21; d <= 50; d++) {
      const a = (d * Math.PI) / 180;
      const ok = shift(radius, a, inked + growth(a)) >= radius * 0.15;
      if (ok && growth(a) < growth(best)) best = a;
    }
    slope = best;
  }
  const grow = Math.max(0, shortest(radius, slope) - fall(radius, slope, inked));
  const span = inked + grow;
  const top = frame.hangs(height) + frame.over + grow / 2;
  const bottom = frame.sits(0) - frame.over - grow / 2;
  const across = shift(radius, slope, span);
  const leftSide = left;
  const upper = at(leftSide + radius, top - radius);
  const lower = at(upper.x + across, bottom + radius);
  const rightSide = lower.x + radius;
  const degrees = (slope * 180) / Math.PI;
  const leaves = pointOn(upper, radius, 270 - degrees);
  const lands = pointOn(lower, radius, 90 - degrees);
  /*
   * The terminals turn on a wider circle than the bowls, wide enough to come
   * most of the way across the letter before they end, so the top and the foot
   * are each one long curve into their end rather than a bowl's corner, a flat
   * and a hook. Each ends travelling forty degrees off level, where the cut
   * across it stands nearly upright and a beak can hang straight down from its
   * outside corner, and a little inside the side of the letter it is on.
   */
  const inset = (rightSide - leftSide) * 0.04;
  const room = rightSide - inset - upper.x;
  const fromAngle = 40;
  const toAngle = fromAngle - 180;
  const end = Math.max((room * 0.88) / Math.cos(deg(fromAngle)), least);
  const headX = Math.max(upper.x + 1, rightSide - inset - end * Math.cos(deg(fromAngle)));
  const footX = Math.min(lower.x - 1, leftSide + inset - end * Math.cos(deg(toAngle)));
  const head = at(headX, top - end);
  const foot = at(footX, bottom + end);
  return chain(
    turn(head, end, fromAngle, 90),
    straight(at(headX, top), at(upper.x, top)),
    turn(upper, radius, 90, 270 - degrees),
    straight(leaves, lands),
    turn(lower, radius, 90 - degrees, -90),
    straight(at(lower.x, bottom), at(footX, bottom)),
    turn(foot, end, -90, toAngle),
  );
}

/**
 * Part of a bowl: a c, a C, the belly of an e, the bowl of a G, the right-hand
 * side of a B or a D.
 *
 * Cut along a ray from the centre at the angle asked for, so a c is missing the
 * same share of its ring whether that ring is round or square.
 */
export function openBowl(
  f: Frame,
  centre: Vec2,
  halfWidth: number,
  halfHeight = halfWidth,
  fromDegrees = 55,
  toDegrees = 305,
  /**
   * Carried this much further round, after the aperture has had its say.
   *
   * For a bowl that is meant to end up somewhere in particular rather than
   * merely to end: the G's has to reach the far side of its own bar. Written
   * into `toDegrees` the aperture eats it, because the aperture is applied to
   * the gap and the gap is measured between the two angles it is given -- so
   * asking for a bowl that runs eight degrees past its start opens the gap
   * eight degrees wider and the bowl ends where it always did.
   */
  carry = 0,
): Stroke {
  uses("bowl");
  const [from, to] = opening(f, centre, halfHeight, fromDegrees, toDegrees);
  return ink(
    f,
    bowlBetween(centre, halfWidth, halfHeight, 1 - f.square, f.half, from, to + carry),
    f.end,
    f.end,
  );
}

/**
 * The two angles a part-bowl runs between, with the style's aperture applied.
 *
 * Written in the recipes as the ordinary opening for that letter, because that
 * is what a recipe knows: a c is open about a hundred and ten degrees and a G
 * rather less. How far open the face wants them is a decision about the face,
 * so it is applied here, to the gap rather than to the two angles -- the gap
 * closes and opens about its own middle and the letter stays pointing the way
 * it was drawn to point.
 *
 * Never closed past what the pen can clear. Two ends reaching round toward
 * each other meet before their spines do, and a heavy face asked to close its
 * c would fuse it into an o with a scar -- which is the same fault the G had
 * before its aperture was measured in pen widths rather than in degrees.
 */
export function opening(
  f: Frame,
  centre: Vec2,
  halfHeight: number,
  fromDegrees: number,
  toDegrees: number,
): [number, number] {
  void centre;
  const middle = (fromDegrees + 360 + toDegrees) / 2;
  const half = (fromDegrees + 360 - toDegrees) / 2;
  const clear = ((f.half * 2.4) / Math.max(halfHeight, f.least)) * (180 / Math.PI);
  const wanted = Math.max(half * f.style.parts.bowl.aperture, clear);
  return [middle + wanted - 360, middle - wanted];
}

/**
 * The bar of an f or a t, hung from the x-height rather than centred on it.
 *
 * A bar is the side of a stroke, not the end of one, so the line it is meant
 * to touch is the line its edge lands on. Written as the middle it sat half a
 * bar high and cut the x-height in two.
 */
/**
 * The short bar through the stem of a Polish l, leaning.
 *
 * Leaning rather than level, because a level one is a crossbar and reads as a
 * t: the lean is the whole of what makes it a slash. Sized and angled off the
 * stem so it holds at any weight, and drawn with the same thin pen as every
 * other bar in the font.
 */
export function slash(f: Frame, stem: number, height: number): Stroke {
  const reach = Math.max(f.half * 2.1, f.least);
  const rise = reach * 0.85;
  return thin(
    f,
    straight(at(stem - reach, height - rise), at(stem + reach, height + rise)),
    f.plain,
    f.plain,
  );
}

/**
 * Where a t stands.
 *
 * Placed so the bar's left end lands on the sidebearing rather than through it,
 * and named because the barred t has to stand in exactly the same place: a
 * number written twice is a letter that moves when only one of them is edited.
 */
export function tStem(f: Frame): number {
  return f.edge + tReach(f) * 0.7;
}

/**
 * How far a t's bar reaches right of its stem.
 *
 * From the bowl rather than the arch: a t is a stem and a bar, and how long a
 * bar is has nothing to do with how far an n's shoulder carries. Tied to the
 * arch it lost a quarter of its width when a text face tightened its n, and
 * set at 0.58 of Lora's.
 */
export function tReach(f: Frame): number {
  return roundHalf(f) * 0.64;
}

/**
 * Half an o measured to the outside of its ink, for the letters whose width
 * follows the round ones but is not itself a bowl: the bars of a t and an f,
 * the vees of a w, the z.
 *
 * Not the bowl alone, which is measured to the middle of the stroke and so
 * shrinks as the pen grows -- at a black weight a z sized from it came out
 * narrower than its own pen. The ink holds still across weights, as the arch
 * very nearly does, without following the lowercase rhythm the way the arch
 * does.
 */
export function roundHalf(f: Frame): number {
  return f.bowl + f.half;
}

/** A letter with a bar struck through it, which is how the barred pair is made. */
export function struck(base: Recipe, bar: Stroke): Recipe {
  return { ...base, strokes: [...base.strokes, bar] };
}

/**
 * The tail a zeta, a xi and a final sigma all finish with: down past the
 * baseline and hooked back to the left.
 *
 * The hook takes whatever room is left between where the tail starts and the
 * descender, and none if there is none -- a descender of forty units under a
 * pen of two hundred and sixty leaves nothing to turn in, and asked for a hook
 * anyway the tail was told to run upwards to reach it and the letter folded
 * over itself. A straight tail is a real tail.
 *
 * Its own stroke rather than the end of the run above it, for the same reason:
 * the run arrives going down and left and the hook sets off going down and
 * right, which at a display weight is more turn than one join can carry.
 */
/**
 * A stroke that runs below the line and hooks left at the bottom.
 *
 * The `\u03b6`, the `\u03be` and the final `\u03c2` all end this way, and how much of the
 * hook there is room for is not the letter's decision. The tail takes whatever
 * is left between where it starts and the descender, and a turn tighter than
 * half the pen would fold its inner edge through itself -- so under a heavy pen
 * on a shallow descender there is no hook to be had.
 *
 * What is drawn then is the hook standing still rather than no hook: the run
 * carries on to the floor and the turn sits on the end of it with no radius and
 * no sweep. It adds nothing to the shape and it keeps the letter the same
 * number of nodes at the Black as at the Thin, which is what a variable font
 * needs -- one set of outlines and a list of how each point moves, so two
 * weights meet only where they are drawn with the same points. Left out
 * outright, the three of them were drawn with sixty-four nodes fewer at the
 * Black and stood in a Black word at Bold weight.
 */
export function tailBelow(f: Frame, x: number, from: number): Stroke {
  const floor = f.dip(f.desc);
  const room = Math.min(Math.max(f.arch * 0.36, f.least), (from - floor) * 0.45);
  const hooks = room > f.least;
  // A radius even when nothing is turned through it. The sweep reads an arc of
  // no radius as nothing at all and drops it, where an arc of no sweep is kept
  // and takes its heading from the run before it, which is what is wanted: the
  // piece is here, it is just standing still.
  const radius = hooks ? room : f.least;
  const toe = at(x, hooks ? floor + radius : floor);
  return ink(
    f,
    chain(straight(at(x, from), toe), {
      segments: [
        {
          kind: "arc",
          centre: at(toe.x - radius, toe.y),
          radius,
          startAngle: 0,
          endAngle: deg(hooks ? -105 : 0),
          sweepPositive: false,
          // Always the two pieces a hundred and five degrees needs, so the
          // stalled hook and the drawn one come to the same nodes.
          pieces: 2,
        },
      ],
      closed: false,
    }),
    BUTT,
    f.end,
  );
}

// ---------------------------------------------------------------------------
// Cyrillic shapes
// ---------------------------------------------------------------------------

/*
 * Most of Cyrillic's lowercase is its capitals drawn at the x-height.
 *
 * A Cyrillic `н` is an `Н` the height of an `n`, not an arch; a `т` is a `Т`,
 * not a stem with a foot; a `п`, a `м`, a `ш`, a `ц` and a dozen more are the
 * same. That is a fact about the alphabet, so each shape is written once
 * against a height and asked for twice, and the two cases cannot drift apart.
 *
 * The ones that are genuinely their own shape -- the `б`, which is not a small
 * `Б` at all -- are written on their own below.
 */

/** How wide a letter of this height is, in the terms the Latin already uses. */
export function cyrWide(f: Frame, top: number): number {
  return top > f.x ? f.capBowl : f.bowl;
}

/** How far a Cyrillic tail hangs below the line, on a letter of this height. */
export function cyrDrop(f: Frame, top: number): number {
  return Math.max(top * 0.17, f.half * 1.2);
}

/** Two stems the width of a counter apart, which four of these are built on. */
export function cyrPosts(f: Frame): [number, number] {
  const left = f.edge;
  return [left, left + f.style.metrics.counterWidth + f.style.pen.weight];
}

export function cyrBe(f: Frame, top: number): Stroke[] {
  const wide = cyrWide(f, top);
  const stem = f.edge;
  const bowl = Math.max(top * 0.29, f.least);
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    arm(f, stem, stem + wide * 1.5, f.hangs(top, f.bar)),
    belly(f, at(stem, bowl), bowl * f.wide, bowl, -90, 90),
  ];
}

export function cyrVe(f: Frame, top: number): Stroke[] {
  const stem = f.edge;
  const upper = Math.max(top * 0.26, f.least);
  const lower = Math.max(top * 0.29, f.least);
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    belly(f, at(stem, top - upper), upper * f.wide, upper, -90, 90),
    belly(f, at(stem, lower), lower * f.wide, lower, -90, 90),
  ];
}

export function cyrGe(f: Frame, top: number): Stroke[] {
  const stem = f.edge;
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    arm(f, stem, stem + cyrWide(f, top) * 1.05, f.hangs(top, f.bar)),
  ];
}

/** A roof on a slanted leg, standing on a shelf with two feet under it. */
export function cyrDe(f: Frame, top: number): Stroke[] {
  const wide = cyrWide(f, top);
  const left = f.edge;
  const width = wide * 1.75;
  const shelf = f.sits(0, f.bar);
  const roof = f.hangs(top, f.bar);
  const post = left + width * 0.82;
  const drop = cyrDrop(f, top);
  return [
    ink(f, straight(at(post, shelf), at(post, top)), BUTT, f.end),
    thin(f, straight(at(left + width * 0.26, roof), at(post, roof)), f.end, BUTT),
    ink(f, straight(at(left + width * 0.26, roof), at(left + width * 0.12, shelf)), BUTT, BUTT),
    thin(f, straight(at(left, shelf), at(left + width, shelf)), BUTT, BUTT),
    ink(f, straight(at(left + f.half, shelf), at(left + f.half, -drop)), BUTT, f.end),
    ink(
      f,
      straight(at(left + width - f.half, shelf), at(left + width - f.half, -drop)),
      BUTT,
      f.end,
    ),
  ];
}

/** A stem with two vees leaning on it, one each side. */
export function cyrZhe(f: Frame, top: number): Stroke[] {
  const width = cyrWide(f, top) * 2;
  const left = f.edge;
  const middle = left + width / 2;
  const waist = top * 0.5;
  const arms = ([1, -1] as const).flatMap((way) => {
    const edge = way > 0 ? left + width : left;
    return [
      ink(f, straight(at(edge, top), at(middle, waist)), f.end, BUTT),
      ink(f, straight(at(edge, 0), at(middle, waist)), f.end, BUTT),
    ];
  });
  return [ink(f, straight(at(middle, 0), at(middle, top)), f.end, f.end), ...arms];
}

/** Two arcs bulging right, which is what a ze and a three both are. */
export function cyrZe(f: Frame, top: number): Stroke[] {
  const radius = Math.max(top * 0.27, f.least);
  /*
   * Placed by where the arcs actually reach, not by where the whole bowl would.
   *
   * A ze is the right side of a bowl and nothing else, so its leftmost ink is
   * the end of an arc rather than the side of a circle: measured as a circle it
   * stood eighty-six units inside its own sidebearing and read as a letter that
   * had been pushed.
   */
  const cx = f.edge + bendWidth(f, radius) * 0.643;
  return [
    ink(f, bend(f, at(cx, top - radius), radius, -130, 105), f.end, BUTT),
    ink(f, bend(f, at(cx, radius), radius, -105, 130), BUTT, f.end),
  ];
}

/** The N with its diagonal the other way round. */
export function cyrI(f: Frame, top: number): Stroke[] {
  const [left, right] = cyrPosts(f);
  const into = stub(f);
  const start = at(left, into);
  const end = at(right, top - into);
  const [foot, head] = corners(f, [start, at(left, 0), at(right, top), end]);
  return [
    ink(f, straight(at(left, 0), at(left, top)), f.end, f.end),
    ink(f, straight(at(right, 0), at(right, top)), f.end, f.end),
    ink(f, chain(straight(start, foot), straight(foot, head), straight(head, end))),
  ];
}

/** A stem on the right with a leg that leans away from it. */
export function cyrEl(f: Frame, top: number): Stroke[] {
  const width = cyrWide(f, top) * 1.6;
  const left = f.edge;
  const right = left + width;
  const roof = f.hangs(top, f.bar);
  const knee = at(left + width * 0.3, roof);
  return [
    ink(f, straight(at(right, 0), at(right, top)), f.end, BUTT),
    ink(f, chain(straight(at(right, roof), knee), straight(knee, at(left, 0))), BUTT, f.end),
  ];
}

/** Two stems under one bar. */
export function cyrPe(f: Frame, top: number): Stroke[] {
  const [left, right] = cyrPosts(f);
  return [
    ink(f, straight(at(left, 0), at(left, top)), f.end, BUTT),
    ink(f, straight(at(right, 0), at(right, top)), f.end, BUTT),
    thin(f, straight(at(left, f.hangs(top, f.bar)), at(right, f.hangs(top, f.bar))), BUTT, BUTT),
  ];
}

/** The y's vee, at whatever height it is asked for. */
export function cyrU(f: Frame, top: number): Stroke[] {
  const half = cyrWide(f, top) * 0.9;
  const left = f.edge;
  const middle = left + half;
  const past = f.half * 1.1;
  const drop = past / Math.hypot(1, top / half);
  return [
    ink(f, straight(at(left, top), at(middle + (drop * half) / top, -drop)), f.end, BUTT),
    ink(
      f,
      straight(at(middle + half, top), at(middle + (half * f.desc) / top, f.desc)),
      f.end,
      f.end,
    ),
  ];
}

/** The pe, with a tail hung off the foot of its right stem. */
export function cyrTse(f: Frame, top: number): Stroke[] {
  const [, right] = cyrPosts(f);
  const drop = cyrDrop(f, top);
  return [
    ...cyrPe(f, top),
    ink(
      f,
      straight(at(right + f.half * 1.6, f.sits(0, f.bar)), at(right + f.half * 1.6, -drop)),
      BUTT,
      f.end,
    ),
    thin(
      f,
      straight(at(right - f.half, f.sits(0, f.bar)), at(right + f.half * 1.6, f.sits(0, f.bar))),
      BUTT,
      BUTT,
    ),
  ];
}

/** A stem, and a half-stem meeting it at the waist. */
export function cyrChe(f: Frame, top: number): Stroke[] {
  const [left, right] = cyrPosts(f);
  const waist = top * 0.44;
  return [
    ink(f, straight(at(right, 0), at(right, top)), f.end, f.end),
    ink(f, straight(at(left, waist), at(left, top)), BUTT, f.end),
    thin(f, straight(at(left, f.sits(waist, f.bar)), at(right, f.sits(waist, f.bar))), BUTT, BUTT),
  ];
}

/** Three stems on one shelf. */
export function cyrSha(f: Frame, top: number): Stroke[] {
  const gap = f.style.metrics.counterWidth + f.style.pen.weight;
  const left = f.edge;
  const shelf = f.sits(0, f.bar);
  return [
    ...[0, 1, 2].map((step) =>
      ink(f, straight(at(left + gap * step, shelf), at(left + gap * step, top)), BUTT, f.end),
    ),
    thin(f, straight(at(left, shelf), at(left + gap * 2, shelf)), BUTT, BUTT),
  ];
}

/** The sha with the same tail the tse has. */
export function cyrShcha(f: Frame, top: number): Stroke[] {
  const gap = f.style.metrics.counterWidth + f.style.pen.weight;
  const right = f.edge + gap * 2;
  const drop = cyrDrop(f, top);
  const shelf = f.sits(0, f.bar);
  return [
    ...cyrSha(f, top),
    thin(f, straight(at(right - f.half, shelf), at(right + f.half * 1.6, shelf)), BUTT, BUTT),
    ink(f, straight(at(right + f.half * 1.6, shelf), at(right + f.half * 1.6, -drop)), BUTT, f.end),
  ];
}

/** A stem with a bowl on the bottom half of it, standing where it is told. */
export function cyrSoftAt(f: Frame, top: number, stem: number): Stroke[] {
  const bowl = Math.max(top * 0.29, f.least);
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    belly(f, at(stem, bowl), bowl * f.wide, bowl, -90, 90),
  ];
}

export function cyrSoft(f: Frame, top: number): Stroke[] {
  return cyrSoftAt(f, top, f.edge);
}

/** A bowl open to the right, with a bar reaching in: the Ukrainian ye. */
export function cyrIe(f: Frame, top: number): Stroke[] {
  const radius = Math.max(top / 2, f.least);
  const wide = bendWidth(f, radius);
  const centre = at(f.edge + wide, top / 2);
  return [
    ink(f, bend(f, centre, radius, 55, 305), f.end, f.end),
    thin(
      f,
      straight(at(centre.x - wide, centre.y), at(centre.x + wide * 0.2, centre.y)),
      BUTT,
      f.end,
    ),
  ];
}

/** A bar over a stem, with a shoulder hung off it: the Serbian tshe. */
export function cyrTsheAt(f: Frame, top: number, stem: number, tail: number): Stroke[] {
  const wide = cyrWide(f, top);
  const waist = top * 0.56;
  const right = stem + wide * 1.15;
  const radius = Math.max(Math.min(wide * 0.55, (top - waist) * 0.9), f.least);
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    thin(
      f,
      straight(
        at(stem - wide * 0.5, f.hangs(top, f.bar)),
        at(stem + wide * 0.7, f.hangs(top, f.bar)),
      ),
      f.end,
      f.end,
    ),
    ink(
      f,
      chain(
        straight(at(stem, waist), at(right - radius, waist)),
        turn(at(right - radius, waist - radius), radius, 90, 0),
        straight(at(right, waist - radius), at(right, tail)),
      ),
      BUTT,
      f.end,
    ),
  ];
}

/** The same with a tail below the line, which is the Serbian dje. */
export function cyrDje(f: Frame, top: number): Stroke[] {
  return cyrTsheAt(f, top, f.edge + cyrWide(f, top) * 0.5, f.dip(f.desc));
}

export function cyrTshe(f: Frame, top: number): Stroke[] {
  return cyrTsheAt(f, top, f.edge + cyrWide(f, top) * 0.5, 0);
}

/** An el and a soft sign, tied together at the waist. */
export function cyrLje(f: Frame, top: number): Stroke[] {
  const width = cyrWide(f, top) * 1.6;
  // A counter's worth apart, not a pen's: set at the pen the el's leg and the
  // soft sign's stem sat close enough to read as one crowded letter.
  const stem = f.edge + width + f.style.metrics.counterWidth * 0.5 + f.style.pen.weight;
  const waist = top * f.style.parts.crossbar.height;
  return [
    ...cyrEl(f, top),
    thin(f, straight(at(f.edge + width, waist), at(stem, waist)), BUTT, BUTT),
    ...cyrSoftAt(f, top, stem),
  ];
}

/** A stem and a soft sign, tied together at the waist: the nje. */
export function cyrNje(f: Frame, top: number): Stroke[] {
  const stem = f.edge + f.style.metrics.counterWidth + f.style.pen.weight;
  const waist = top * f.style.parts.crossbar.height;
  return [
    ink(f, straight(at(f.edge, 0), at(f.edge, top)), f.end, f.end),
    thin(f, straight(at(f.edge, waist), at(stem, waist)), BUTT, BUTT),
    ...cyrSoftAt(f, top, stem),
  ];
}

/** The pe with its tail down the middle rather than off the side. */
export function cyrDzhe(f: Frame, top: number): Stroke[] {
  const [left, right] = cyrPosts(f);
  const middle = (left + right) / 2;
  const drop = cyrDrop(f, top);
  const shelf = f.sits(0, f.bar);
  return [
    ink(f, straight(at(left, shelf), at(left, top)), BUTT, f.end),
    ink(f, straight(at(right, shelf), at(right, top)), BUTT, f.end),
    thin(f, straight(at(left, shelf), at(right, shelf)), BUTT, BUTT),
    ink(f, straight(at(middle, shelf), at(middle, -drop)), BUTT, f.end),
  ];
}

/** The ge with a tick turned up at the end of its arm. */
export function cyrGheUpturn(f: Frame, top: number): Stroke[] {
  const stem = f.edge;
  const reach = cyrWide(f, top) * 1.05;
  const tick = Math.max(top * 0.16, f.half * 1.4);
  /*
   * The arm set down by the height of its own tick.
   *
   * The tick is what makes a ghe with an upturn, and it turns up: put on the
   * arm where a plain ghe's arm goes it carries the letter past the line every
   * other capital stops at, which on the undulating face was nineteen units out
   * and is exactly the fault the whole alphabet was measured for once already.
   */
  const bar = f.hangs(top, f.bar) - tick;
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    arm(f, stem, stem + reach, bar),
    ink(f, straight(at(stem + reach, bar), at(stem + reach, f.hangs(top, f.bar))), BUTT, f.end),
  ];
}

/** The soft sign with a shoulder to its left. */
export function cyrHard(f: Frame, top: number): Stroke[] {
  const stem = f.edge + cyrWide(f, top) * 0.5;
  const bowl = Math.max(top * 0.29, f.least);
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    thin(f, straight(at(f.edge, f.hangs(top, f.bar)), at(stem, f.hangs(top, f.bar))), f.end, BUTT),
    belly(f, at(stem, bowl), bowl * f.wide, bowl, -90, 90),
  ];
}

/** The soft sign with a stem set beside it. */
export function cyrYeru(f: Frame, top: number): Stroke[] {
  const bowl = Math.max(top * 0.29, f.least);
  const apart = f.edge + bowl * f.wide + f.style.metrics.counterWidth * 0.55 + f.style.pen.weight;
  return [...cyrSoft(f, top), ink(f, straight(at(apart, 0), at(apart, top)), f.end, f.end)];
}

/** A bowl open to the left, with a bar reaching in from the right. */
export function cyrE(f: Frame, top: number): Stroke[] {
  const radius = Math.max(top / 2, f.least);
  const wide = bendWidth(f, radius);
  // Placed by where the arc reaches, for the reason the ze is.
  const centre = at(f.edge + wide * 0.574, top / 2);
  return [
    ink(f, bend(f, centre, radius, -125, 125), f.end, f.end),
    thin(
      f,
      straight(at(centre.x - wide * 0.2, centre.y), at(centre.x + wide, centre.y)),
      f.end,
      BUTT,
    ),
  ];
}

/** A stem, a bar, and a ring beside it. */
export function cyrYu(f: Frame, top: number): Stroke[] {
  const radius = Math.max(top / 2, f.least);
  const wide = bendWidth(f, radius);
  const stem = f.edge;
  const centre = at(stem + f.half * 2.4 + wide, top / 2);
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    thin(f, straight(at(stem, centre.y), at(centre.x - wide, centre.y)), BUTT, BUTT),
    ink(f, ring(f, centre, wide, radius)),
  ];
}

/** The R the other way round: a bowl on the right and a leg under it. */
export function cyrYa(f: Frame, top: number): Stroke[] {
  const wide = cyrWide(f, top);
  const right = f.edge + wide * 1.4;
  const bowl = Math.max(top * 0.28, f.least);
  const waist = f.sits(top - bowl * 2, f.bar);
  return [
    ink(f, straight(at(right, 0), at(right, top)), f.end, f.end),
    belly(f, at(right, top - bowl), bowl * f.wide, bowl, 90, 270),
    ink(f, straight(at(right, waist), at(f.edge, 0)), BUTT, f.end),
  ];
}

/** Two stems with a vee between them, which is an M at any height. */
export function cyrEm(f: Frame, top: number): Stroke[] {
  const half = Math.max(cyrWide(f, top) * 0.66, f.least);
  const left = f.edge;
  const right = left + half * 2;
  const dip = corner(f, at(left, top), at(left + half, top * 0.18), at(right, top));
  return [
    ink(f, straight(at(left, 0), at(left, top)), f.end, f.end),
    ink(f, straight(at(right, 0), at(right, top)), f.end, f.end),
    ink(f, chain(straight(at(left, top), dip), straight(dip, at(right, top))), BUTT, BUTT),
  ];
}

/** Two stems with a bar between them, which is an H at any height. */
export function cyrEn(f: Frame, top: number): Stroke[] {
  const [left, right] = cyrPosts(f);
  const bar = top * f.style.parts.crossbar.height;
  return [
    ink(f, straight(at(left, 0), at(left, top)), f.end, f.end),
    ink(f, straight(at(right, 0), at(right, top)), f.end, f.end),
    thin(f, straight(at(left, bar), at(right, bar)), BUTT, BUTT),
  ];
}

/** A stem under a bar, which is a T at any height. */
export function cyrTe(f: Frame, top: number): Stroke[] {
  const half = cyrWide(f, top) * 0.95;
  const middle = f.edge + half;
  const bar = f.hangs(top, f.bar);
  return [
    ink(f, straight(at(middle, 0), at(middle, top)), f.end, BUTT),
    thin(f, straight(at(middle - half, bar), at(middle + half, bar)), f.end, f.end),
  ];
}

/**
 * Where a bar can go between the ink below it and the ink above it.
 *
 * The crossbar's height is a share of the letter, and a share knows nothing
 * about how thick anything is. Low and heavy -- a height of 0.3 and a
 * thickness of 1.6 -- put the middle arm of an E on top of the bottom one: the
 * two ran together into a slab at the foot of the letter with the counter
 * gone, and the eye of an e sank into the bottom of its bowl and filled it.
 *
 * So the bar is held clear of both by a third of the white there is to
 * share between them. A third because it is a proportion rather than a
 * size: the counters of a heavy face are small and a light face's are large,
 * and a fixed gap would either stop the light face's bar moving at all or let
 * the heavy face's touch. It lets the bar sit twice as near one side as the
 * other, which is more lopsided than any base draws -- every one of them
 * leaves between 0.41 and 0.48 of the white on the nearer side, in the E and
 * in the e -- so the bases stand exactly where they did and only the ends of
 * the control are held. Where there is no white left to share at all, the bar
 * goes in the middle.
 *
 * `below` and `above` are the edges of the ink either side, and `half` is half
 * the bar's own thickness.
 */
export function clearBetween(want: number, below: number, above: number, half: number): number {
  const white = above - below - half * 2;
  if (white <= 0) return (below + above) / 2;
  const gap = white / 3;
  return Math.min(above - gap - half, Math.max(below + gap + half, want));
}

/**
 * The height of the middle of three stacked bars, in a letter `top` tall:
 * the middle arm of an E, an F, a Xi.
 *
 * The arms above and below are this face's bars at the top and on the line,
 * as `arm` and the letters draw them.
 */
export function middleBar(f: Frame, top: number): number {
  const half = f.upright * f.bar;
  return clearBetween(top * f.style.parts.crossbar.height, half * 2, top - half * 2, half);
}

/**
 * The height of the eye of an e, in a bowl round `centre`.
 *
 * Held clear of the inside of the bowl above and below by the same rule as
 * the middle arm of an E, for the same reason: a low, heavy bar filled the
 * bottom of the bowl in and the e came out as a disc with a notch in it.
 */
export function eyeOf(f: Frame, centre: Vec2): number {
  return clearBetween(
    f.x * f.style.parts.crossbar.height,
    centre.y - f.bowlH + f.upright,
    centre.y + f.bowlH - f.upright,
    f.upright * f.bar,
  );
}

/**
 * Where the centre-line of an e's left wall is, at the height of its eye.
 *
 * The eye opens at `opens` degrees on the right; the same height on the left
 * is the mirror of it, and the bowl drawn from there for a degree starts at
 * that point on whatever shape the bowl has -- round, squared or squat.
 *
 * Where the bar starts, and it starts here rather than on the inside edge of
 * the wall, which is where it used to: half a pen in from the wall's
 * centre-line at its widest. At the ordinary eye that is exactly where the
 * inner edge of the wall is, and exactly where the wall runs upright -- so the
 * bar's square end lay along a curve at the one point it was tangent to it,
 * and whichever way the rounding went the union came back with a hair of the
 * counter folded back over the bar. A Serif `e` crossed itself there under
 * every cut. From the wall's own centre-line the end is buried half a pen
 * deep, with nothing near it to agree with.
 */
export function wallAt(f: Frame, centre: Vec2, opens: number): number {
  return spineStart(bend(f, centre, f.bowlH, 180 - opens, 181 - opens)).x;
}

export function crossbar(f: Frame, from: number, to: number): Stroke {
  const height = f.hangs(f.x, f.bar);
  /*
   * Cut, not capped. The bar of a t or an f is a stroke across a stem, not an
   * arm off one: a text face ends it with the pen's own cut and no serif, and
   * given a serif at each end the pair hung down beside the stem and the t
   * read as a cross with a bracket on it.
   */
  /*
   * Cut upright where the face cuts its ends plain, so a pen held at an angle
   * does not lean the ends of the bar with it: the bar of a t or an f on the
   * serif face ended in two slanting cuts, the left one a notch against the
   * stem at a black weight.
   */
  const end: Terminal =
    f.plain.kind === "angled" || f.plain.kind === "round" ? f.plain : { ...f.plain, level: true };
  return thin(f, straight(at(from, height), at(to, height)), end, end);
}

/**
 * The heights of two arms facing each other, one hanging from a line and one
 * standing on the baseline, as a Z and a z have.
 *
 * Held apart by at least what the pen can turn between, because a heavy enough
 * cut leaves less room between the two lines than the pen is wide.
 */
export function arms(f: Frame, line: number): [number, number] {
  const middle = line / 2;
  const gap = Math.max(f.hangs(line) - f.sits(0), f.least) / 2;
  return [middle + gap, middle - gap];
}

/**
 * An arm off a stem: the three of an E, the two of an F, the foot of an L.
 *
 * Square where it leaves the stem, because it is buried in ink that is already
 * there, and finished with the face's own terminal at the far end.
 */
export function arm(f: Frame, from: number, to: number, height: number): Stroke {
  return thin(f, straight(at(from, height), at(to, height)), BUTT, f.end);
}

/** The same, cut square, for a bowl that runs into a stem rather than stopping. */
export function belly(
  f: Frame,
  centre: Vec2,
  halfWidth: number,
  halfHeight: number,
  fromDegrees: number,
  toDegrees: number,
): Stroke {
  return ink(
    f,
    bowlBetween(centre, halfWidth, halfHeight, 1 - f.square, f.half, fromDegrees, toDegrees),
    BUTT,
    BUTT,
  );
}

/**
 * A bowl off a stem that runs straight before it turns: the D, the P, the R,
 * the two of a B.
 *
 * A half ellipse hung on the stem is as wide as it is half-tall, which is a
 * letter as narrow as its height allows -- a P barely half the width of the O
 * beside it, a D that is a semicircle. Every one of them, sans or serif, runs
 * its top and bottom out level from the stem first and only then comes round,
 * and that run is what gives the letter the width the eye expects of it. Lora's
 * P reaches 0.52 of the cap height past its stem and its D 0.69, where the half
 * ellipses here reached 0.27 and 0.48.
 *
 * `reach` is how far the outermost point of the spine stands from the stem's;
 * the curve takes as much of it as the bowl's height gives a round turn and the
 * rest is the level run. One run, straight into curve into straight, tangent
 * at both joins, and both ends square on the stem's centre-line where the stem
 * covers them.
 */
export function lobe(f: Frame, stem: number, low: number, high: number, reach: number): Stroke {
  const halfHeight = Math.max((high - low) / 2, f.least);
  const middle = (high + low) / 2;
  const curve = Math.max(Math.min(reach, halfHeight * 1.08 * f.wide), f.least);
  const run = reach - curve;
  if (run < 1) return belly(f, at(stem, middle), Math.max(reach, f.least), halfHeight, -90, 90);
  const centre = at(stem + run, middle);
  const roundness = 1 - f.square;
  const below = bowlPoint(centre, curve, halfHeight, roundness, f.half, -90);
  const above = bowlPoint(centre, curve, halfHeight, roundness, f.half, 90);
  return ink(
    f,
    chain(
      straight(at(stem, below.y), below),
      bowlBetween(centre, curve, halfHeight, roundness, f.half, -90, 90),
      straight(above, at(stem, above.y)),
    ),
    BUTT,
    BUTT,
  );
}

/**
 * Down off the letter, then curling away to one side.
 *
 * The cedilla and the ogonek, which are the same run hooking opposite ways.
 * `side` is -1 for the cedilla and 1 for the ogonek.
 *
 * Sized against the x-height and the pen rather than against the descender,
 * which is a number a face is free to set to almost nothing -- and when one
 * did, the hook was asked to turn through a radius larger than the run it was
 * turning in and folded through itself. Both pieces are a whole radius long and
 * the radius is never below what the pen can turn through, so there is no
 * setting at which this can close up.
 */
export function hook(style: Style, side: number): Recipe {
  const f = markFrame(style);
  const m = markBox(f);
  const radius = Math.max(f.x * 0.15, f.least);
  const from = side < 0 ? 0 : 180;
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(m.cx, 0), at(m.cx, -radius)),
        turn(at(m.cx + side * radius, -radius), radius, from, from + side * 95),
      ),
      BUTT,
      shortEnd(f),
    ),
  ]);
}

/**
 * How wide a figure is.
 *
 * Every digit gets the same width, which is what lets a column of numbers line
 * up. It is narrower than a capital, because ten shapes have to stay apart from
 * each other at that one width.
 */
export function figureWidth(frame: Frame): number {
  return Math.max(frame.cap * 0.62 * frame.style.metrics.width, frame.least * 2);
}

// ---------------------------------------------------------------------------
// The signs
// ---------------------------------------------------------------------------

/**
 * The line the arithmetic is built on.
 *
 * One height for all of them, because a plus, an equals and a division sign
 * that do not line up with each other do not read as arithmetic at all. It is
 * the height the hyphen already sat at, which is where a minus belongs and
 * therefore where the rest of them belong too.
 */
export function axis(f: Frame): number {
  return f.x * 0.46;
}

/**
 * How wide a sign is drawn.
 *
 * From the figures, so a column of sums lines up under the numbers it is about.
 * A little inside their width, because a figure fills its advance and a sign
 * wants air around it.
 */
export function signWidth(f: Frame): number {
  return figureWidth(f) * 0.84;
}

/**
 * How far the upright marks run above and below the line.
 *
 * A bar, a broken bar, a bracket and a brace are one family and have to be one
 * height, or a line of code sets four different sizes of the same idea. They
 * take the whole of the ascender and the whole of the descender, which is what
 * a bracket is for -- something has to be tall enough to hold a line of type
 * between two of them.
 */
export function tall(f: Frame): { foot: number; head: number } {
  return { foot: f.desc, head: f.asc };
}

/** Half the width of a bar, which is what the signs drawn as bars turn at. */
export function barHalf(f: Frame): number {
  return (f.style.pen.weight * f.bar) / 2;
}

/**
 * Half the daylight between the two bars of an equals sign.
 *
 * A share of the bar drawing them rather than a fixed distance: at a display
 * weight a gap of a few units is no gap, and the two bars fuse into one.
 */
export function signGap(f: Frame): number {
  return Math.max(f.style.pen.weight * f.bar * 1.15, f.x * 0.075);
}

/**
 * A symbol built out of a letter this font already draws.
 *
 * The borrowed strokes arrive finished -- that letter's own recipe has already
 * pulled its round ends back -- so what the builder adds is what goes through
 * `finish`, and `joined` below is how the two halves are put together.
 */
export function outOf(
  letter: LetterName,
  build: (f: Frame, borrowed: () => Stroke[]) => Recipe,
): (style: Style) => Recipe {
  // Asked for rather than handed over, because half of these want the letter
  // at a size of their own and would otherwise draw it once to throw away and
  // once to use.
  const made = (style: Style): Recipe =>
    build(frame(style), () => recipeOf(letter, borrowing)!(style).strokes);
  BEHIND.set(made, letter);
  return made;
}

/** Which letter a symbol is drawn out of, or nothing if it is its own drawing. */
export function letterBehind(name: LetterName): LetterName | null {
  const build = LETTERS[name];
  return (build && BEHIND.get(build)) ?? null;
}

/** A recipe of strokes already finished and some that are not yet. */
export function joined(f: Frame, done: Stroke[], fresh: Stroke[], round = false): Recipe {
  return { strokes: [...done, ...finish(f, fresh).strokes], round };
}

/**
 * The same face, drawn at a fraction of its size.
 *
 * For the superior figures, the ordinals and the two halves of a fraction,
 * which are not new shapes: they are figures and letters this font already has,
 * set small. Drawn by re-reading the whole style at a smaller size rather than
 * by shrinking a finished outline, because shrinking an outline shrinks its
 * strokes with it -- and a figure at six tenths with strokes at six tenths is
 * not a small figure, it is a light one sitting beside the text it belongs to.
 *
 * The pen comes down by less than the letter does, which is what a designer
 * cutting superiors by hand does and for the same reason.
 *
 * The two measures kept in font units rather than in stem widths -- how far a
 * corner is rounded off, and how long the wave is -- come down as well. Left
 * alone, a superior figure on a rounded face was one corner, and on a wavy one
 * a single crest half its own height.
 */
export function sized(style: Style, fraction: number, penShare = fraction ** 0.62): Style {
  const m = style.metrics;
  const { corner, wave } = style.parts;
  /*
   * And never a pen too wide for the size it is being drawn at.
   *
   * The share above deliberately takes less off the pen than off the letter, so
   * that a superior figure holds its colour beside the text rather than fading
   * into it. Carried far enough that stops being legibility and starts being a
   * blot: on a short cap height at a display weight the small figures of a
   * fraction folded through themselves. A pen under about four tenths of the
   * height it is drawing is the limit, and it only ever binds where the full
   * size letter was already at the edge of what it could carry.
   */
  const weight = Math.min(style.pen.weight * penShare, m.capHeight * fraction * 0.42);
  return {
    ...style,
    metrics: {
      ...m,
      xHeight: m.xHeight * fraction,
      capHeight: m.capHeight * fraction,
      ascender: m.ascender * fraction,
      descender: m.descender * fraction,
      overshoot: m.overshoot * fraction,
      counterWidth: m.counterWidth * fraction,
      sidebearing: m.sidebearing * fraction,
    },
    pen: { ...style.pen, weight },
    parts: {
      ...style.parts,
      corner: { ...corner, radius: corner.radius * fraction },
      wave: { ...wave, length: wave.length * fraction, depth: wave.depth * fraction },
    },
  };
}

/**
 * What a set of runs covers, worked out from the skeleton and the pen.
 *
 * Not from the finished outline: sweeping is what happens to these afterwards,
 * and this file is the description that goes into it. A spine plus the pen's
 * reach is what a recipe can know, and it is enough to stand one piece of a
 * symbol beside another -- how wide the whole thing ends up is measured off the
 * real ink later, by whatever asks for its advance.
 *
 * Placed by a declared width instead, the fractions came apart: a small figure
 * is held to a floor at a heavy weight and grows wider than the width it was
 * asked for, so a display face drew its numerator straight through the stroke
 * that was meant to be beside it.
 */
export function spread(strokes: Stroke[]): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  const see = (point: Vec2, reach: number): void => {
    xMin = Math.min(xMin, point.x - reach);
    xMax = Math.max(xMax, point.x + reach);
    yMin = Math.min(yMin, point.y - reach);
    yMax = Math.max(yMax, point.y + reach);
  };
  const round = (centre: Vec2, radius: number, angle: number): Vec2 =>
    at(centre.x + radius * Math.cos(angle), centre.y + radius * Math.sin(angle));

  for (const stroke of strokes) {
    const reach = stroke.pen.weight / 2;
    for (const segment of stroke.spine.segments) {
      if (segment.kind === "line") {
        see(segment.from, reach);
        see(segment.to, reach);
        continue;
      }
      const { centre, radius, startAngle, endAngle } = segment;
      see(round(centre, radius, startAngle), reach);
      see(round(centre, radius, endAngle), reach);
      // And the four points where a circle is furthest out along an axis, for
      // whichever of them this arc actually passes through.
      for (let quarter = 0; quarter < 4; quarter++) {
        const angle = (quarter * Math.PI) / 2;
        if (passesThrough(angle, startAngle, endAngle)) see(round(centre, radius, angle), reach);
      }
    }
  }
  return { xMin, xMax, yMin, yMax };
}

/** Whether an arc running from one angle to another goes past a third. */
export function passesThrough(angle: number, from: number, to: number): boolean {
  const whole = Math.PI * 2;
  const span = to - from;
  const along = (((angle - from) % whole) + whole) % whole;
  return span >= 0 ? along <= span : along - whole >= span;
}

/** The same run somewhere else on the page. */
export function shoveSpine(spine: Spine, dx: number, dy: number): Spine {
  return {
    closed: spine.closed,
    segments: spine.segments.map((segment) =>
      segment.kind === "line"
        ? {
            kind: "line",
            from: at(segment.from.x + dx, segment.from.y + dy),
            to: at(segment.to.x + dx, segment.to.y + dy),
          }
        : { ...segment, centre: at(segment.centre.x + dx, segment.centre.y + dy) },
    ),
  };
}

/**
 * The same run turned half a turn about a point.
 *
 * Half a turn and no other, which is what an upside-down question mark is and
 * is the only rotation the alphabet has any use for. It is also the only one
 * that is honest about the pen without further thought: a nib is an ellipse,
 * and an ellipse turned half a turn is the same ellipse -- so the mark turns
 * over and the tool that drew it does not have to be turned with it.
 */
export function turnSpine(spine: Spine, about: Vec2): Spine {
  const over = (point: Vec2) => at(about.x * 2 - point.x, about.y * 2 - point.y);
  return {
    closed: spine.closed,
    segments: spine.segments.map((segment) =>
      segment.kind === "line"
        ? { kind: "line", from: over(segment.from), to: over(segment.to) }
        : {
            ...segment,
            centre: over(segment.centre),
            startAngle: segment.startAngle + Math.PI,
            endAngle: segment.endAngle + Math.PI,
          },
    ),
  };
}

/** A stroke moved, keeping its pen, its ends and what it was built from. */
export function shovedStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  return inherit(stroke, { ...stroke, spine: shoveSpine(stroke.spine, dx, dy) });
}

export function turnedStroke(stroke: Stroke, about: Vec2): Stroke {
  return inherit(stroke, { ...stroke, spine: turnSpine(stroke.spine, about) });
}

/**
 * A letter of this font, drawn small and stood where it is wanted.
 *
 * `left` is where its ink begins and `foot` is the line it stands on, so a
 * superior figure is the same figure with a line of its own further up the page.
 */
/**
 * Whether a letter is being drawn inside another glyph rather than as itself.
 *
 * A `C` set small inside a ring is the copyright sign, not a letter in a word,
 * and nothing is ever set after it -- so it takes none of the join. Left to take
 * it, the ring came out with a stroke reaching out of the `C` towards a letter
 * that is not there, and the sign gained and lost nodes along the weight axis
 * because the length of that stroke is a multiple of the pen.
 *
 * True of the lowercase too, and was before the capitals ever reached out: the
 * `a` inside an `ª` is set the same way.
 */
export let enclosing = false;

export function setInside<T>(run: () => T): T {
  const was = enclosing;
  enclosing = true;
  try {
    return run();
  } finally {
    enclosing = was;
  }
}

export function setSmall(
  style: Style,
  name: LetterName,
  fraction: number,
  left: number,
  foot: number,
  penShare?: number,
): Stroke[] {
  const little = sized(style, fraction, penShare);
  const strokes = setInside(() => recipeOf(name, borrowing)!(little).strokes);
  return strokes.map((stroke) => shovedStroke(stroke, left - little.metrics.sidebearing, foot));
}

/**
 * A mark turned over, to open a sentence rather than close one.
 *
 * Drawn again at a height that fits and then turned, rather than turned where
 * it stands. A question mark is as tall as a capital, and a capital's worth of
 * ink hung from the x-height reaches further below the line than any font has
 * room for -- so what is turned is the same mark drawn to the room there is.
 * The pen is not reduced with it: an upside-down question mark that is lighter
 * than the one closing the sentence reads as a different mark.
 */
export function turnedDown(f: Frame, name: LetterName): Recipe {
  const floor = f.desc * 0.82;
  const fits = Math.min(1, (f.x - floor) / f.cap);
  const about = at(f.edge, f.x / 2);
  const strokes = recipeOf(name, borrowing)!(sized(f.style, fits, 1)).strokes;
  return { strokes: strokes.map((stroke) => turnedStroke(stroke, about)) };
}

/**
 * An ordinal: the letter, small, hung from the cap line.
 *
 * Without the rule underneath it that older faces draw. It is a nineteenth
 * century habit that modern text faces have dropped, and a rule under a letter
 * this small closes up at any weight worth the name.
 */
export function ordinal(f: Frame, name: LetterName): Recipe {
  const share = 0.62;
  return { strokes: setSmall(f.style, name, share, f.edge, f.cap - f.x * share) };
}

/** A superior figure: the figure, small, with its head at the cap line. */
export function superior(f: Frame, name: LetterName): Recipe {
  const share = 0.6;
  return { strokes: setSmall(f.style, name, share, f.edge, f.cap * (1 - share)) };
}

/**
 * A fraction: two figures of this font at two heights, and a stroke between.
 *
 * The numerator hangs from the cap line and the denominator stands on the
 * baseline, which is what puts the daylight between them -- a fraction whose
 * halves are level reads as two figures with a slash in the middle.
 */
export function fraction(f: Frame, over: LetterName, under: LetterName): Recipe {
  const share = 0.58;
  const gap = f.style.pen.weight * 0.34;
  const numerator = setSmall(f.style, over, share, f.edge, f.cap * (1 - share));
  const lean = figureWidth(frame(sized(f.style, share))) * 0.72;
  // Each piece stood beside what the last one actually covers, rather than
  // beside the width it was asked for. The two are not the same on a heavy
  // face, where a small figure is held wider than its design width.
  const bar = spread(numerator).xMax + gap;
  const stroke = finish(f, [
    ink(f, straight(at(bar, f.desc * 0.14), at(bar + lean, f.cap)), shortEnd(f), shortEnd(f)),
  ]).strokes;
  return {
    strokes: [
      ...numerator,
      ...stroke,
      ...setSmall(f.style, under, share, spread(stroke).xMax + gap, 0),
    ],
  };
}

/**
 * The same frame with its corners rounded no harder than the runs can give.
 *
 * A corner is rounded by cutting the two runs that meet at it and putting an
 * arc between, so a radius larger than the runs are long has nothing left to
 * cut. Every letter in the alphabet has runs the height of a capital and never
 * meets the limit; a brace has four corners inside two thirds of an em, and on
 * the face whose corners are rounded by two hundred and twenty units it drew
 * itself inside out.
 */
export function gentler(f: Frame, shortest: number): Frame {
  /*
   * And no rounding at all where even the smallest there is would not fit.
   *
   * A corner is never cut smaller than the pen can turn round -- asking for
   * less than that would leave an arc the stroke's own inside could not follow
   * -- so on runs shorter than the pen is wide there is no rounding to be had,
   * only a bite taken further back than the run is long. A corner left sharp is
   * what a face that heavy has anyway.
   */
  const wanted = Math.min(f.radius, shortest * 0.42);
  const radius = wanted >= f.half * 1.06 ? wanted : 0;
  if (radius >= f.radius) return f;
  const { corner } = f.style.parts;
  return frame({ ...f.style, parts: { ...f.style.parts, corner: { ...corner, radius } } });
}

/**
 * A brace, facing whichever way it is asked to.
 *
 * Two quarter turns at the ends, two straight runs, and a spur in the middle
 * that points away from the text. The spur is drawn as a shallow vee rather
 * than as a curve that turns back on itself: a curve arriving horizontally and
 * leaving horizontally the other way is a reversal, and an offset carried round
 * a reversal comes back through the stroke it belongs to -- which is what every
 * base in the file did when it was drawn that way. A vee is a corner, the sweep
 * has always known what to do with corners, and a face that rounds its corners
 * rounds this one into the curve a brace is usually drawn with.
 */
export function brace(f: Frame, facing: 1 | -1): Recipe {
  const w = Math.max(f.arch * 0.62, f.style.pen.weight * 1.5);
  const lines = tall(f);
  // The hooks end with the pen lying along the line, so they are set back from
  // it by what the pen reaches sideways there.
  const foot = f.sits(lines.foot);
  const head = f.hangs(lines.head);
  const middle = (foot + head) / 2;
  const room = head - middle;
  /*
   * The hook's radius is held above what the pen can turn round, and otherwise
   * takes what the height allows.
   *
   * Taken as half the brace's width -- which is what it was, so that the arcs
   * landed exactly on the vertical runs -- a heavy pen made a wide brace, a
   * wide brace made a large radius, and the two hooks between them ate the
   * whole height: the runs came out thirteen units long and the sweep drew the
   * stroke through itself. The radius decides where the runs are instead, which
   * is the same construction with the dependency the other way round.
   */
  const radius = Math.max(Math.min(w * 0.5, room * 0.34), f.half);
  /*
   * The straight runs get what is left, and they get it first.
   *
   * A run between two corners has to be longer than the pen is wide, or the
   * inside of the first turn is still coming back as the second one starts and
   * the stroke crosses itself. Given to the spur first, a display weight left
   * the run at nothing and every brace in the file folded; given to the run
   * first, the spur simply gets shallower as the pen gets heavier, which is
   * what a heavy brace looks like anyway.
   */
  const reach = Math.max(
    Math.min((w - radius) * 0.95, room - radius - f.half * 1.35),
    Math.min(f.half * 0.3, (room - radius) * 0.4),
  );
  /*
   * And the spur reaches out only as far as its own point stays open.
   *
   * How deep it goes and how tall it is are the two sides of the corner at the
   * point, and the inside of that corner needs about a pen's half-width of run
   * on each leg to close: any sharper, or any shorter, and it comes back
   * through the stroke. Written out, that is the depth below -- so a heavy pen
   * flattens the spur toward a bracket rather than folding the brace, and a
   * text weight never comes near the limit.
   */
  const spare = f.half * f.half - 0.64 * reach * reach;
  const deepest = spare <= 0 ? Infinity : (0.8 * reach * reach) / Math.sqrt(spare);
  /*
   * The spur reaches out only as far as the vee can stay open.
   *
   * How deep it goes and how tall it is are the two sides of the corner at the
   * point, and a corner much sharper than a right angle is a reversal by
   * another name: the inside of the turn folds back through the stroke. So the
   * depth follows the height rather than the width, and a brace with no room
   * to be deep is a shallow brace instead of a broken one.
   */
  const depth = Math.min(w - radius, reach * 1.7, deepest);
  // The two ends and the spur, which swap sides with the brace.
  const stem = f.edge + (facing > 0 ? depth : radius);
  const back = stem + (facing > 0 ? radius : -radius);
  const spur = stem - depth * facing;
  // Rounded by no more than the shortest piece here can give up.
  const gentle = gentler(f, Math.min(room - radius - reach, Math.hypot(depth, reach)));
  return finish(f, [
    ink(
      gentle,
      chain(
        turn(at(back, head - radius), radius, 90, facing > 0 ? 180 : 0),
        straight(at(stem, head - radius), at(stem, middle + reach)),
        straight(at(stem, middle + reach), at(spur, middle)),
        straight(at(spur, middle), at(stem, middle - reach)),
        straight(at(stem, middle - reach), at(stem, foot + radius)),
        turn(at(back, foot + radius), radius, facing > 0 ? 180 : 0, facing > 0 ? 270 : -90),
      ),
      shortEnd(f),
      shortEnd(f),
    ),
  ]);
}

/**
 * A letter of this font inside a ring, which is what a copyright mark is.
 *
 * The letter is measured and then centred on what was measured, rather than
 * placed at a fraction of the ring's width: a C on a heavy face is held wider
 * than its design width, and centred on that width it sat against the inside of
 * its own ring.
 */
export function enclosed(f: Frame, name: LetterName): Recipe {
  const radius = Math.max(f.capBowlH * 0.92, f.half * 2.6);
  const centre = at(f.edge + radius, f.cap * 0.48);
  const light = frame({
    ...f.style,
    pen: { ...f.style.pen, weight: f.style.pen.weight * Math.min(1, f.bar * 1.15) },
  });
  const ring = ink(light, bowl(centre, radius, radius, 1 - f.square, light.half));
  // Two thirds of the ring across, which is the room there is once the ring
  // itself and a little daylight are taken off the inside.
  const share = ((radius - light.half) * 1.25) / f.cap;
  const letter = setSmall(f.style, name, share, f.edge, 0, Math.min(1, f.bar * 1.2));
  const box = spread(letter);
  return {
    strokes: [
      ...finish(f, [ring]).strokes,
      ...letter.map((stroke) =>
        shovedStroke(
          stroke,
          centre.x - (box.xMin + box.xMax) / 2,
          centre.y - (box.yMin + box.yMax) / 2,
        ),
      ),
    ],
    round: true,
  };
}

/**
 * A guillemet: two chevrons pointing the same way.
 *
 * Held apart by their own weight rather than by a share of the mark's width,
 * or a heavy face runs the two into a single arrowhead.
 */
export function chevrons(f: Frame, facing: 1 | -1): Recipe {
  const w = signWidth(f) * 0.42;
  const rise = w * 1.05;
  const y = axis(f);
  const step = Math.max(w * 0.92, f.style.pen.weight * f.bar * 2.1);
  const one = (left: number): Stroke => {
    const back = facing > 0 ? left : left + w;
    const tip = facing > 0 ? left + w : left;
    return bent(
      f,
      chain(straight(at(back, y + rise), at(tip, y)), straight(at(tip, y), at(back, y - rise))),
    );
  };
  return finish(f, [one(f.edge), one(f.edge + step)]);
}

/**
 * A sign that turns a corner, drawn at the weight of a bar.
 *
 * `thin` is for a bar that runs straight -- a crossbar, a hyphen -- and does
 * not round its corners, because a straight run has none to round. The signs
 * that bend do have one, and they bend at the weight of a bar rather than of a
 * stem: a less-than drawn with the stem is a wedge of ink sitting beside
 * arithmetic drawn at half its weight.
 */
export function bent(f: Frame, spine: Spine): Stroke {
  if (hasCorner(spine)) uses("corner");
  const half = (f.style.pen.weight * f.bar) / 2;
  // A short end, for the reason every sign has one: these runs are too short
  // to be cut at an angle without the two corners meeting in the middle.
  return thin(f, roundCorners(spine, f.radius, half), shortEnd(f), shortEnd(f));
}

/**
 * Clears what the last letter collected, and says which form this one is.
 *
 * What `recipeOf` does before every letter. It lives here rather than there
 * because the two things it sets live here, and a module can only assign
 * the bindings it declares.
 */
export function beginLetter(form: string | undefined): void {
  pending = [];
  borrowing = form;
}
