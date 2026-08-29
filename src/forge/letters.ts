/**
 * Where the strokes of each letter run.
 *
 * A recipe here says nothing about weight, contrast, serifs or terminals. It
 * says only that an n is a stem on the left, an arch springing off it, and a
 * second stem coming down on the right -- the skeleton, which is what a letter
 * is underneath. Everything else arrives from the style when it is drawn.
 *
 * Splitting it that way is what lets one edit reach the whole font. The arch of
 * an n, the arch of an m and the arch of an h are not three drawings that
 * resemble each other; they are three uses of one description, so moving where
 * the arch springs from moves all three, and there is no fourth copy somewhere
 * that got missed. The same goes for every bowl, every bar and every diagonal.
 *
 * The proportions are the ordinary ones of Latin writing -- an x-height a
 * little over half the cap height, round letters overshooting the flat ones so
 * they look level, an s narrower than an o. Those are properties of the
 * alphabet rather than of anyone's typeface. None of these shapes is traced
 * from or fitted to an existing font: each is constructed from the metrics and
 * the parts, which is what makes what comes out yours.
 */

import type { Vec2 } from "@/font/types";
import type { Style } from "./style";
import {
  BOTH_ENDS,
  HANDS_OVER_HIGH,
  type Ends,
  movedSpine,
  planJoin,
  planLoops,
  seamsOf,
  wobbleOf,
} from "./script";
import { terminalFor } from "./style";
import {
  bowl,
  bowRuns,
  bowlBetween,
  bowlPoint,
  reversed,
  roundCorners,
  shortened,
  endPieces,
  spineEnd,
  spineStart,
  wavy,
} from "./shapes";
import { MITER_LIMIT, penReach, reachAlong } from "./sweep";
import type { JoinKind, Spine, SpineArc, SpineSegment, Stroke, Terminal } from "./types";

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
let recording: Set<PartName> | null = null;

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
let pending: PartName[] = [];
const STROKE_PARTS = new WeakMap<Stroke, PartName[]>();

/*
 * Which letterform the letter inside a symbol is drawn in.
 *
 * A single slot, for the reason the collected parts above are: drawing is
 * synchronous and one letter at a time, so nothing else can be halfway through
 * a symbol while this one is being built.
 */
let borrowing: string | undefined;

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
const BEHIND = new WeakMap<(style: Style) => Recipe, LetterName>();


function uses(part: PartName): void {
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
function usesThroughout(part: PartName): void {
  recording?.add(part);
}

/** Note what this run turned out to be built from, and start the next one. */
function remember(stroke: Stroke): Stroke {
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
function inherit(from: Stroke, to: Stroke): Stroke {
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

const BUTT: Terminal = { kind: "butt" };
const at = (x: number, y: number): Vec2 => ({ x, y });
const deg = (degrees: number): number => (degrees * Math.PI) / 180;

// ---------------------------------------------------------------------------
// Spines
// ---------------------------------------------------------------------------

const straight = (from: Vec2, to: Vec2): Spine => ({
  segments: [{ kind: "line", from, to }],
  closed: false,
});

/**
 * A turn, given the way a designer describes one: where the middle of the turn
 * is, how far out, and between which two directions. Degrees rather than
 * radians so a recipe reads as a description rather than as trigonometry.
 */
function turn(centre: Vec2, radius: number, fromDegrees: number, toDegrees: number): Spine {
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
function pointOn(centre: Vec2, radius: number, degrees: number): Vec2 {
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
function ring(f: Frame, centre: Vec2, halfWidth: number, halfHeight = halfWidth): Spine {
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
function bendWidth(f: Frame, radius: number): number {
  return Math.max(radius * f.wide, f.least);
}

function bend(f: Frame, centre: Vec2, radius: number, fromDegrees: number, toDegrees: number): Spine {
  const halfWidth = bendWidth(f, radius);
  const roundness = 1 - f.square;
  if (toDegrees >= fromDegrees) {
    return bowlBetween(centre, halfWidth, radius, roundness, f.half, fromDegrees, toDegrees);
  }
  return reversed(bowlBetween(centre, halfWidth, radius, roundness, f.half, toDegrees, fromDegrees));
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
function bowed(f: Frame, from: Vec2, to: Vec2, amount: number): Spine {
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
  let sweep = Math.atan2(to.y - centre.y, to.x - centre.x) - startAngle;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  return {
    segments: [
      { kind: "arc", centre, radius, startAngle, endAngle: startAngle + sweep, sweepPositive: sweep > 0 },
    ],
    closed: false,
  };
}

/** Join spines end to end into one stroke that turns as it goes. */
function chain(...spines: Spine[]): Spine {
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
interface Frame {
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
const ASIDE = 0.53;

function frame(style: Style): Frame {
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
      ((metrics.counterWidth + pen.weight) / 2) * style.parts.shoulder.reach * metrics.width,
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
    bar: style.parts.crossbar.weight,
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
function endFor(style: Style): Terminal {
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
function ink(frame: Frame, spine: Spine, start: Terminal = BUTT, end: Terminal = BUTT): Stroke {
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
function hasCorner(spine: Spine): boolean {
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
 * A bar can be lighter than the stems it crosses, which is how a crossbar
 * avoids looking heavier than the letter around it.
 */
function thin(frame: Frame, spine: Spine, start: Terminal = BUTT, end: Terminal = BUTT): Stroke {
  uses("crossbar");
  const { pen, parts } = frame.style;
  const weight = pen.weight * parts.crossbar.weight;
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
function rippled(frame: Frame, spine: Spine, half = frame.half): Spine {
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
function inward(f: Frame, from: Vec2, to: Vec2): number {
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
function finish(frame: Frame, strokes: Stroke[], round = false): Recipe {
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
function capped(frame: Frame, stroke: Stroke): Stroke {
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

  const back = (terminal: Terminal, segment: SpineSegment, which: "start" | "end", lean: number): number => {
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
  const cut = (terminal: Terminal, lean: number): Terminal =>
    lean > 0 && (terminal.kind === "butt" || terminal.kind === "slab")
      ? { ...terminal, level: true }
      : terminal;
  const start = cut(stroke.start, startLean);
  const end = cut(stroke.end, endLean);
  if (fromStart <= 0 && fromEnd <= 0) return inherit(stroke, { ...stroke, start, end });
  return inherit(stroke, {
    ...stroke,
    start,
    end,
    spine: shortened(stroke.spine, fromStart, fromEnd),
  });
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
function stopsOnALine(f: Frame, point: Vec2): boolean {
  return [0, f.x, f.cap, f.asc, f.desc].some((line) => Math.abs(point.y - line) < 1);
}

/** Which way a run is travelling where it begins or where it ends. */
function headingAt(segment: SpineSegment, which: "start" | "end"): Vec2 {
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
const stub = (f: Frame): number =>
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
function through(f: Frame, tips: Vec2[]): Vec2[] {
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
      const wanted = Math.max(-arm, Math.min(arm, overhang(f, halfAngle, points[index], before, after)));
      const target = at(
        tips[index].x + bisector.x * wanted,
        tips[index].y + bisector.y * wanted,
      );
      points[index] = at(
        (points[index].x + target.x) / 2,
        (points[index].y + target.y) / 2,
      );
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
function overhang(f: Frame, sinHalf: number, vertex: Vec2, before: Vec2, after: Vec2): number {
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
function corners(f: Frame, tips: Vec2[]): Vec2[] {
  return through(f, tips).slice(1, -1);
}

/** The one-corner case, which is most of them. */
function corner(f: Frame, from: Vec2, tip: Vec2, to: Vec2): Vec2 {
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
function junction(f: Frame, arm: Vec2, stem: number, height: number, leg: Vec2): Vec2 {
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
function rounded(f: Frame, arm: Vec2, meet: Vec2, leg: Vec2): number {
  const spine = roundCorners(
    chain(straight(arm, meet), straight(meet, leg)),
    f.radius,
    f.half,
  );
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
function dips(f: Frame, arm: Vec2, meet: Vec2, leg: Vec2): Vec2 {
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
function sweeps(arc: SpineArc, angle: number): boolean {
  const turn = Math.PI * 2;
  const from = ((arc.startAngle % turn) + turn) % turn;
  const to = ((arc.endAngle % turn) + turn) % turn;
  const want = ((angle % turn) + turn) % turn;
  const along = ((want - from) * (arc.sweepPositive ? 1 : -1) + turn) % turn;
  const whole = ((to - from) * (arc.sweepPositive ? 1 : -1) + turn) % turn;
  return along <= whole;
}

/** An arc's two ends. */
function ends(arc: SpineArc): Vec2[] {
  return [arc.startAngle, arc.endAngle].map((angle) =>
    at(arc.centre.x + Math.cos(angle) * arc.radius, arc.centre.y + Math.sin(angle) * arc.radius),
  );
}

function towards(from: Vec2, to: Vec2): Vec2 {
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
interface MarkBox {
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
function markFrame(style: Style): Frame {
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
function shortEnd(f: Frame): Terminal {
  return f.plain.kind === "round" ? f.plain : BUTT;
}

function markBox(f: Frame): MarkBox {
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

function dot(frame: Frame, centre: Vec2, radius: number): Stroke {
  const round: Terminal = { kind: "round" };
  return {
    spine: straight(at(centre.x - 0.5, centre.y), at(centre.x + 0.5, centre.y)),
    pen: { ...frame.style.pen, contrast: 0, weight: radius * 2 },
    start: round,
    end: round,
  };
}

/**
 * The tail of a comma, and the lower half of a semicolon.
 *
 * Drawn with its own round pen rather than the font's. On a face with contrast
 * the round cap on a slanted stroke turned itself inside out, and on a heavy
 * one the cap reached back past the origin, so the comma sat outside its own
 * letter.
 */
function tail(frame: Frame, radius: number): Stroke {
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
function crested(frame: Frame, height: number): number {
  return height === frame.x ? height * frame.style.parts.shoulder.crest : height;
}

function arch(frame: Frame, fromX: number, height: number): Stroke {
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
function archSpine(frame: Frame, fromX: number, height: number, bottom = 0): Spine {
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
  const radius = Math.max(
    frame.half,
    Math.min(reach, height * (1 - frame.style.parts.shoulder.spring)),
  );
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
function trough(frame: Frame, fromX: number, height: number): Stroke {
  uses("shoulder");
  height = crested(frame, height);
  const reach = frame.arch;
  const radius = Math.max(
    frame.half,
    Math.min(reach, height * (1 - frame.style.parts.shoulder.spring)),
  );
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
 * The spine of an s, as two turns tangent to each other at the waist.
 *
 * Two circles of equal radius stacked so they touch: at the point they meet,
 * both are travelling horizontally, so the stroke passes through the middle of
 * the letter flat and changes which way it is bending without a kink. The
 * radius is fixed by the height -- four radii from top to bottom -- which is
 * also why an s comes out narrower than an o without anyone deciding that it
 * should.
 */
function spine(frame: Frame, height: number, left: number): { stroke: Stroke } {
  /*
   * Four radii from top to bottom, unless the pen will not go round one that
   * small, in which case the s grows rather than closing up.
   *
   * The two turns have to stay tangent -- that is the whole construction -- so
   * the radius cannot be raised on its own. Raising it and putting both centres
   * back the same distance from a common middle keeps them touching and lets
   * the letter reach a little past its x-height, which is what a display weight
   * asks for anyway. At a pen of two hundred and sixty units the old radius was
   * exactly half the pen, and the counter closed to nothing.
   *
   * The height asked for is the height of the ink, so the four radii span the
   * pen's own width less than it: the two turns are the top and bottom of the
   * letter and each of them carries half a pen past its own centre line. Both
   * centres stay where they were -- the pair is symmetric about the middle of
   * the letter, so taking the same off each end moves neither.
   */
  const radius = Math.max((height + frame.over * 2 - frame.upright * 2) / 4, frame.least);
  const middle = left + bendWidth(frame, radius);
  const foot = height / 2 - radius * 2;
  const upper = at(middle, foot + radius * 3);
  const lower = at(middle, foot + radius);
  /*
   * And the two ends carried less far round the further the pen has to reach.
   *
   * Each half of an s is most of a circle -- two hundred and forty-five degrees
   * of one -- and what is left inside it is a counter that closes as the pen
   * widens. Measuring the letter by its ink rather than by its spine made the
   * radius smaller by half a pen at each end, which was enough to take the
   * heaviest of the bases under: the two ends met round the back and the s
   * folded into itself.
   *
   * Opening the ends instead is what a heavy face does anyway, and it is the
   * same fix the G already has. Measured in pen widths rather than in degrees,
   * so a hairline keeps its long tight curl and a display weight lets go of it.
   */
  const open = ((frame.half * 0.6) / radius) * (180 / Math.PI);
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
 * Part of a bowl: a c, a C, the belly of an e, the bowl of a G, the right-hand
 * side of a B or a D.
 *
 * Cut along a ray from the centre at the angle asked for, so a c is missing the
 * same share of its ring whether that ring is round or square.
 */
function openBowl(
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
function opening(
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
function slash(f: Frame, stem: number, height: number): Stroke {
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
function tStem(f: Frame): number {
  return f.edge + f.arch * 0.7 * 0.7;
}

/** A letter with a bar struck through it, which is how the barred pair is made. */
function struck(base: Recipe, bar: Stroke): Recipe {
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
function tailBelow(f: Frame, x: number, from: number): Stroke {
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
function cyrWide(f: Frame, top: number): number {
  return top > f.x ? f.capBowl : f.bowl;
}

/** How far a Cyrillic tail hangs below the line, on a letter of this height. */
function cyrDrop(f: Frame, top: number): number {
  return Math.max(top * 0.17, f.half * 1.2);
}

/** Two stems the width of a counter apart, which four of these are built on. */
function cyrPosts(f: Frame): [number, number] {
  const left = f.edge;
  return [left, left + f.style.metrics.counterWidth + f.style.pen.weight];
}

function cyrBe(f: Frame, top: number): Stroke[] {
  const wide = cyrWide(f, top);
  const stem = f.edge;
  const bowl = Math.max(top * 0.29, f.least);
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    arm(f, stem, stem + wide * 1.5, f.hangs(top, f.bar)),
    belly(f, at(stem, bowl), bowl * f.wide, bowl, -90, 90),
  ];
}

function cyrVe(f: Frame, top: number): Stroke[] {
  const stem = f.edge;
  const upper = Math.max(top * 0.26, f.least);
  const lower = Math.max(top * 0.29, f.least);
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    belly(f, at(stem, top - upper), upper * f.wide, upper, -90, 90),
    belly(f, at(stem, lower), lower * f.wide, lower, -90, 90),
  ];
}

function cyrGe(f: Frame, top: number): Stroke[] {
  const stem = f.edge;
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    arm(f, stem, stem + cyrWide(f, top) * 1.05, f.hangs(top, f.bar)),
  ];
}

/** A roof on a slanted leg, standing on a shelf with two feet under it. */
function cyrDe(f: Frame, top: number): Stroke[] {
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
    ink(f, straight(at(left + width - f.half, shelf), at(left + width - f.half, -drop)), BUTT, f.end),
  ];
}

/** A stem with two vees leaning on it, one each side. */
function cyrZhe(f: Frame, top: number): Stroke[] {
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
function cyrZe(f: Frame, top: number): Stroke[] {
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
function cyrI(f: Frame, top: number): Stroke[] {
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
function cyrEl(f: Frame, top: number): Stroke[] {
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
function cyrPe(f: Frame, top: number): Stroke[] {
  const [left, right] = cyrPosts(f);
  return [
    ink(f, straight(at(left, 0), at(left, top)), f.end, BUTT),
    ink(f, straight(at(right, 0), at(right, top)), f.end, BUTT),
    thin(f, straight(at(left, f.hangs(top, f.bar)), at(right, f.hangs(top, f.bar))), BUTT, BUTT),
  ];
}

/** The y's vee, at whatever height it is asked for. */
function cyrU(f: Frame, top: number): Stroke[] {
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
function cyrTse(f: Frame, top: number): Stroke[] {
  const [, right] = cyrPosts(f);
  const drop = cyrDrop(f, top);
  return [
    ...cyrPe(f, top),
    ink(f, straight(at(right + f.half * 1.6, f.sits(0, f.bar)), at(right + f.half * 1.6, -drop)), BUTT, f.end),
    thin(f, straight(at(right - f.half, f.sits(0, f.bar)), at(right + f.half * 1.6, f.sits(0, f.bar))), BUTT, BUTT),
  ];
}

/** A stem, and a half-stem meeting it at the waist. */
function cyrChe(f: Frame, top: number): Stroke[] {
  const [left, right] = cyrPosts(f);
  const waist = top * 0.44;
  return [
    ink(f, straight(at(right, 0), at(right, top)), f.end, f.end),
    ink(f, straight(at(left, waist), at(left, top)), BUTT, f.end),
    thin(f, straight(at(left, f.sits(waist, f.bar)), at(right, f.sits(waist, f.bar))), BUTT, BUTT),
  ];
}

/** Three stems on one shelf. */
function cyrSha(f: Frame, top: number): Stroke[] {
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
function cyrShcha(f: Frame, top: number): Stroke[] {
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
function cyrSoftAt(f: Frame, top: number, stem: number): Stroke[] {
  const bowl = Math.max(top * 0.29, f.least);
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    belly(f, at(stem, bowl), bowl * f.wide, bowl, -90, 90),
  ];
}

function cyrSoft(f: Frame, top: number): Stroke[] {
  return cyrSoftAt(f, top, f.edge);
}


/** A bowl open to the right, with a bar reaching in: the Ukrainian ye. */
function cyrIe(f: Frame, top: number): Stroke[] {
  const radius = Math.max(top / 2, f.least);
  const wide = bendWidth(f, radius);
  const centre = at(f.edge + wide, top / 2);
  return [
    ink(f, bend(f, centre, radius, 55, 305), f.end, f.end),
    thin(f, straight(at(centre.x - wide, centre.y), at(centre.x + wide * 0.2, centre.y)), BUTT, f.end),
  ];
}

/** A bar over a stem, with a shoulder hung off it: the Serbian tshe. */
function cyrTsheAt(f: Frame, top: number, stem: number, tail: number): Stroke[] {
  const wide = cyrWide(f, top);
  const waist = top * 0.56;
  const right = stem + wide * 1.15;
  const radius = Math.max(Math.min(wide * 0.55, (top - waist) * 0.9), f.least);
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    thin(f, straight(at(stem - wide * 0.5, f.hangs(top, f.bar)), at(stem + wide * 0.7, f.hangs(top, f.bar))), f.end, f.end),
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
function cyrDje(f: Frame, top: number): Stroke[] {
  return cyrTsheAt(f, top, f.edge + cyrWide(f, top) * 0.5, f.dip(f.desc));
}

function cyrTshe(f: Frame, top: number): Stroke[] {
  return cyrTsheAt(f, top, f.edge + cyrWide(f, top) * 0.5, 0);
}

/** An el and a soft sign, tied together at the waist. */
function cyrLje(f: Frame, top: number): Stroke[] {
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
function cyrNje(f: Frame, top: number): Stroke[] {
  const stem = f.edge + f.style.metrics.counterWidth + f.style.pen.weight;
  const waist = top * f.style.parts.crossbar.height;
  return [
    ink(f, straight(at(f.edge, 0), at(f.edge, top)), f.end, f.end),
    thin(f, straight(at(f.edge, waist), at(stem, waist)), BUTT, BUTT),
    ...cyrSoftAt(f, top, stem),
  ];
}

/** The pe with its tail down the middle rather than off the side. */
function cyrDzhe(f: Frame, top: number): Stroke[] {
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
function cyrGheUpturn(f: Frame, top: number): Stroke[] {
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
function cyrHard(f: Frame, top: number): Stroke[] {
  const stem = f.edge + cyrWide(f, top) * 0.5;
  const bowl = Math.max(top * 0.29, f.least);
  return [
    ink(f, straight(at(stem, 0), at(stem, top)), f.end, f.end),
    thin(f, straight(at(f.edge, f.hangs(top, f.bar)), at(stem, f.hangs(top, f.bar))), f.end, BUTT),
    belly(f, at(stem, bowl), bowl * f.wide, bowl, -90, 90),
  ];
}

/** The soft sign with a stem set beside it. */
function cyrYeru(f: Frame, top: number): Stroke[] {
  const bowl = Math.max(top * 0.29, f.least);
  const apart = f.edge + bowl * f.wide + f.style.metrics.counterWidth * 0.55 + f.style.pen.weight;
  return [
    ...cyrSoft(f, top),
    ink(f, straight(at(apart, 0), at(apart, top)), f.end, f.end),
  ];
}

/** A bowl open to the left, with a bar reaching in from the right. */
function cyrE(f: Frame, top: number): Stroke[] {
  const radius = Math.max(top / 2, f.least);
  const wide = bendWidth(f, radius);
  // Placed by where the arc reaches, for the reason the ze is.
  const centre = at(f.edge + wide * 0.574, top / 2);
  return [
    ink(f, bend(f, centre, radius, -125, 125), f.end, f.end),
    thin(f, straight(at(centre.x - wide * 0.2, centre.y), at(centre.x + wide, centre.y)), f.end, BUTT),
  ];
}

/** A stem, a bar, and a ring beside it. */
function cyrYu(f: Frame, top: number): Stroke[] {
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
function cyrYa(f: Frame, top: number): Stroke[] {
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
function cyrEm(f: Frame, top: number): Stroke[] {
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
function cyrEn(f: Frame, top: number): Stroke[] {
  const [left, right] = cyrPosts(f);
  const bar = top * f.style.parts.crossbar.height;
  return [
    ink(f, straight(at(left, 0), at(left, top)), f.end, f.end),
    ink(f, straight(at(right, 0), at(right, top)), f.end, f.end),
    thin(f, straight(at(left, bar), at(right, bar)), BUTT, BUTT),
  ];
}

/** A stem under a bar, which is a T at any height. */
function cyrTe(f: Frame, top: number): Stroke[] {
  const half = cyrWide(f, top) * 0.95;
  const middle = f.edge + half;
  const bar = f.hangs(top, f.bar);
  return [
    ink(f, straight(at(middle, 0), at(middle, top)), f.end, BUTT),
    thin(f, straight(at(middle - half, bar), at(middle + half, bar)), f.end, f.end),
  ];
}

function crossbar(f: Frame, from: number, to: number): Stroke {
  const height = f.hangs(f.x, f.bar);
  return thin(f, straight(at(from, height), at(to, height)), f.end, f.end);
}

/**
 * The heights of two arms facing each other, one hanging from a line and one
 * standing on the baseline, as a Z and a z have.
 *
 * Held apart by at least what the pen can turn between, because a heavy enough
 * cut leaves less room between the two lines than the pen is wide.
 */
function arms(f: Frame, line: number): [number, number] {
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
function arm(f: Frame, from: number, to: number, height: number): Stroke {
  return thin(f, straight(at(from, height), at(to, height)), BUTT, f.end);
}

/** The same, cut square, for a bowl that runs into a stem rather than stopping. */
function belly(
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

// ---------------------------------------------------------------------------
// The recipes
// ---------------------------------------------------------------------------

/**
 * Each is a function of the style rather than a fixed set of coordinates, so
 * changing the x-height or the width of a counter redraws every letter at the
 * new proportions instead of scaling a drawing made for the old ones.
 */
export const LETTERS: Record<LetterName, (style: Style) => Recipe> = {
  // --- lowercase ---------------------------------------------------------

  a: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl + f.aside;
    /*
     * And set with the room the reference gives it, which is more than it gives
     * an `o`: 0.21 of an x-height either side against 0.155, for a body only
     * 0.10 wider. Half the difference between its `a` and its `o` is the stem
     * standing clear and half is the air around it. See `air`.
     */
    return {
      ...finish(
        f,
        [
          ink(f, ring(f, centre, f.bowl, f.bowlH)),
          ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
        ]),
      air: 0.45,
    };
  },

  b: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
        ink(f, ring(f, at(stem + f.bowl, f.x / 2), f.bowl, f.bowlH)),
      ],
      true);
  },

  c: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    return finish(f, [openBowl(f, centre, f.bowl, f.bowlH)], true);
  },

  d: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl + f.aside;
    /*
     * Set loose, as the `a` is and for the same reason -- and looser, because
     * this letter is: the reference takes 1.30 of its own `o`'s advance for a
     * `d` and 1.19 for an `a`. Swept at 0.45, 0.75 and 0.95 against that.
     */
    return {
      ...finish(
        f,
        [
          ink(f, ring(f, centre, f.bowl, f.bowlH)),
          ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
        ]),
      air: 0.95,
    };
  },

  e: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    /*
     * The eye, at whatever height the crossbar control says.
     *
     * The bowl then has to begin where the circle actually reaches that height
     * rather than at its own middle, or the bar and the bowl part company. Set
     * at half the x-height and nowhere else, an e was the second letter that
     * looked like it had a crossbar and did not listen to the crossbar.
     */
    const eye = f.x * f.style.parts.crossbar.height;
    const rise = Math.max(-0.85, Math.min(0.85, (eye - centre.y) / f.bowlH));
    const opens = (Math.asin(rise) * 180) / Math.PI;
    const belt = bend(f, centre, f.bowlH, opens, opens + 300);
    return finish(
      f,
      [
        /*
         * The bar runs from inside the bowl's left wall to where the bowl
         * itself starts, rather than to a width of its own.
         *
         * Taken to the centre-line it poked out through the left of the letter
         * and the e read as a struck-through o. Taken to a fixed distance right
         * it poked out of the other side the moment the bowl was squared, since
         * a squared bowl at that height is not where a round one is. Measured
         * off the bowl, it meets it whatever shape the bowl has been given.
         */
        thin(f, straight(at(centre.x - f.bowl + f.half, eye), spineStart(belt))),
        ink(f, belt, BUTT, f.end),
      ],
      true,
    );
  },

  f: (style) => {
    const f = frame(style);
    // Big enough to read as a hook rather than a curl, small enough that the
    // letter does not turn into a walking stick.
    const radius = Math.max(f.arch * 0.66, f.least);
    // How far left of the stem the bar reaches, which is also how far in from
    // the sidebearing the stem stands: the bar is this letter's left edge.
    const left = Math.max(f.arch * 0.42, f.least);
    const stem = f.edge + left;
    const top = f.crest(f.asc) - radius;
    return finish(
      f,
      [
        /*
         * Straight up, then a quarter turn right into the hook.
         *
         * Right, because that is the only side an f's hook has ever been on.
         * Turned the other way -- which is how this was written -- every scrap
         * of ink above the bar sat to the left of the stem, where a t has
         * nothing and an f has the whole of what tells them apart. `fox` set
         * as `tox` on all sixteen faces.
         */
        ink(
          f,
          chain(
            straight(at(stem, 0), at(stem, top)),
            // Set down by the pen's own reach across a horizontal, so the top
            // of the hook lands on the ascender rather than setting off from it.
            turn(at(stem + radius, top), radius, 180, 88),
          ),
          f.end,
          f.end,
        ),
        // Reaching further right than left, as the t's bar does, so the two are
        // told apart by more than the hook at the sizes text is set at.
        crossbar(f, stem - left, stem + f.arch * 0.62),
      ]);
  },

  g: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl;
    const radius = Math.max(f.arch * 0.7, f.least);
    /*
     * And set a little loose, like the `a` and the `d`: this letter is a bowl
     * with a tail hanging under the letter beside it rather than beside it, so
     * spacing it off its own width alone leaves it tight. The reference takes
     * 1.07 of its own `o`'s advance for a `g`. See `air`.
     */
    return {
      ...finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        // Down the right and round into the tail, which is one stroke so the
        // descender cannot part company with the bowl.
        ink(
          f,
          chain(
            straight(at(stem, f.x), at(stem, f.dip(f.desc) + radius)),
            // Set up by the pen's own reach across a horizontal, so the ink
            // stops at the descender rather than starting there.
            turn(at(stem - radius, f.dip(f.desc) + radius), radius, 0, -95),
          ),
          f.end,
          f.end,
        ),
      ]),
      air: 0.2,
    };
  },

  h: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(
      f,
      [ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end), arch(f, stem, f.x)]);
  },

  i: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
        dot(f, at(stem, f.x + f.half * 1.5 + f.half * 0.55), f.half * 0.55),
      ]);
  },

  /*
   * The i and j without their dots.
   *
   * An accent over an i does not stack on the dot, it takes the dot's place --
   * two marks above one letter is not what `í` is. So the dotted letter cannot
   * be the base for the accented one, and every font that has an accented i
   * carries these for exactly this reason.
   */
  dotlessi: (style) => {
    const f = frame(style);
    return finish(f, [ink(f, straight(at(f.edge, 0), at(f.edge, f.x)), f.end, f.end)]);
  },

  j: (style) => {
    const f = frame(style);
    const radius = Math.max(f.arch * 0.62, f.least);
    const stem = f.edge + radius;
    return finish(
      f,
      [
        ink(
          f,
          chain(
            straight(at(stem, f.x), at(stem, f.dip(f.desc) + radius)),
            // Set up by the pen's own reach across a horizontal, so the ink
            // stops at the descender rather than starting there.
            turn(at(stem - radius, f.dip(f.desc) + radius), radius, 0, -95),
          ),
          f.end,
          f.end,
        ),
        dot(f, at(stem, f.x + f.half * 1.5 + f.half * 0.55), f.half * 0.55),
      ]);
  },

  dotlessj: (style) => {
    const f = frame(style);
    const radius = Math.max(f.arch * 0.62, f.least);
    const stem = f.edge + radius;
    return finish(f, [
      ink(
        f,
        chain(
          straight(at(stem, f.x), at(stem, f.dip(f.desc) + radius)),
          turn(at(stem - radius, f.dip(f.desc) + radius), radius, 0, -95),
        ),
        f.end,
        f.end,
      ),
    ]);
  },

  k: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = stem + f.arch * 1.7;
    const waist = f.x * 0.42;
    const arm = at(reach, f.x);
    const leg = at(reach, 0);
    const meet = junction(f, arm, stem, waist, leg);
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
        ink(f, chain(straight(arm, meet), straight(meet, leg)), f.end, f.end),
      ]);
  },

  l: (style) => {
    const f = frame(style);
    return finish(
      f,
      [ink(f, straight(at(f.edge, 0), at(f.edge, f.asc)), f.end, f.end)]);
  },

  m: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.crown)), f.end, f.end),
        arch(f, stem, f.x),
        arch(f, stem + f.arch * 2, f.x),
      ]);
  },

  n: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(
      f,
      [ink(f, straight(at(stem, 0), at(stem, f.crown)), f.end, f.end), arch(f, stem, f.x)]);
  },

  o: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    return finish(f, [ink(f, ring(f, centre, f.bowl, f.bowlH))], true);
  },

  p: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(
      f,
      [
        ink(f, straight(at(stem, f.desc), at(stem, f.x)), f.end, f.end),
        ink(f, ring(f, at(stem + f.bowl, f.x / 2), f.bowl, f.bowlH)),
      ],
      true);
  },

  q: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl;
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        ink(f, straight(at(stem, f.desc), at(stem, f.x)), f.end, f.end),
      ]);
  },

  r: (style) => {
    const f = frame(style);
    const stem = f.edge;
    /*
     * The same shoulder an n has, stopped where the n would have come down: an
     * r is an n that gave up.
     *
     * Written as a half circle of the arch's own width it was not the same
     * shoulder at all. A half circle stands as tall as it is half-wide, so on
     * any face whose rhythm is wider than half its x-height the r rose past
     * the n beside it -- seventy units past, on the plainest of the bases --
     * and, being the only curve on a line of its own, it read as a fault in
     * the x-height rather than a fault in the r.
     */
    const reach = f.arch;
    const radius = Math.max(
      f.half,
      Math.min(reach, f.x * (1 - f.style.parts.shoulder.spring)),
    );
    const crest = Math.max(f.crest(f.x), radius);
    const landing = stem + Math.max(reach, radius * 2);
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
        ink(
          f,
          chain(
            turn(at(stem + radius, crest - radius), radius, 180, 90),
            straight(at(stem + radius, crest), at(landing - radius, crest)),
            // Carried a little past the top, so the arm droops rather than
            // stopping dead level, which is what tells an r from a bracket.
            turn(at(landing - radius, crest - radius), radius, 90, 55),
          ),
          BUTT,
          f.end,
        ),
      ]);
  },

  s: (style) => {
    const f = frame(style);
    const { stroke } = spine(f, f.x, f.edge);
    /*
     * And set loose. An `s` is built from half a bowl at each end, so it is
     * about seven tenths of an `o` across -- which is what the reference's is
     * too -- and spacing it off that width alone made it seven tenths of an
     * `o`'s advance where the reference gives it ninety-five hundredths. See
     * `air`.
     */
    return { ...finish(f, [stroke], true), air: 1.05 };
  },

  t: (style) => {
    const f = frame(style);
    const radius = Math.max(f.arch * 0.42, f.least);
    const reach = f.arch * 0.7;
    const stem = tStem(f);
    return finish(
      f,
      [
        /*
         * Down the stem and out along the baseline, as one run.
         *
         * Without the foot a t is a cross: a vertical and a bar, identical to
         * an f with the hook taken off, and at a heavy weight the two were
         * telling themselves apart by the width of the bar alone.
         */
        ink(
          f,
          chain(
            straight(at(stem, f.asc * 0.78), at(stem, f.dip(0) + radius)),
            turn(at(stem + radius, f.dip(0) + radius), radius, 180, 270),
          ),
          f.end,
          f.end,
        ),
        crossbar(f, stem - reach * 0.7, stem + reach),
      ]);
  },

  u: (style) => {
    const f = frame(style);
    return finish(f, [trough(f, f.edge, f.x)]);
  },

  v: (style) => {
    const f = frame(style);
    const half = f.arch * 0.92;
    const left = f.edge;
    const middle = left + half;
    const top = at(left, f.x);
    const other = at(middle + half, f.x);
    const point = corner(f, top, at(middle, 0), other);
    return finish(
      f,
      [ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end)]);
  },

  w: (style) => {
    const f = frame(style);
    const half = f.arch * 0.68;
    const left = f.edge;
    const top = f.x;
    /*
     * Two vees, overlapping, rather than one run zigzagging four times.
     *
     * A single run has to satisfy three corners at once, and they pull against
     * each other: the middle peak drops to put its ink on the x-height, which
     * shortens the arms either side of it, which shrinks the rounding the two
     * feet can take, which lifts them off the baseline. On a face with wide
     * corners the feet came to rest ninety-nine units up, and no radius above a
     * quarter of that ever brought them down again -- while a v, which has one
     * corner and nothing to argue with, landed exactly on the line at every
     * radius there is.
     *
     * Two vees is what a w is anyway, and each of them lands the way a v does.
     */
    const vee = (from: number): Stroke => {
      const start = at(left + half * from, top);
      const end = at(left + half * (from + 2), top);
      const point = corner(f, start, at(left + half * (from + 1), 0), end);
      return ink(f, chain(straight(start, point), straight(point, end)), f.end, f.end);
    };
    return finish(f, [vee(0), vee(1.72)]);
  },

  x: (style) => {
    const f = frame(style);
    const width = f.arch * 1.7;
    const left = f.edge;
    return finish(
      f,
      [
        ink(f, straight(at(left, f.x), at(left + width, 0)), f.end, f.end),
        ink(f, straight(at(left, 0), at(left + width, f.x)), f.end, f.end),
      ]);
  },

  y: (style) => {
    const f = frame(style);
    const half = f.arch * 0.92;
    const left = f.edge;
    const middle = left + half;
    // The left diagonal carries a little past where the two cross, so its
    // square end is inside the other stroke rather than standing out of it.
    const past = f.half * 1.1;
    const drop = past / Math.hypot(1, f.x / half);
    return finish(
      f,
      [
        ink(
          f,
          straight(at(left, f.x), at(middle + (drop * half) / f.x, -drop)),
          f.end,
          BUTT,
        ),
        /*
         * One straight run: down from the x-height, through the apex the left
         * diagonal ends at, and on into the descender at the angle it arrived
         * on. That is what it always meant to be, and it was not: reckoned
         * from the wrong slope it reached the baseline four tenths of an arm
         * to the right of the apex, so the two diagonals of the vee crossed
         * nowhere near each other.
         *
         * A fat enough pen covered the miss and nothing showed. Measured
         * across the sixteen faces the arms overlapped by four units on
         * Geometric, five on Marker, six on Serif and seven on Sans -- held
         * together by luck -- while Fairground missed by thirty-five and drew
         * a broken vee, and Wavy missed by forty-four and lost its left
         * diagonal altogether when the letter was fused.
         */
        ink(
          f,
          straight(at(middle + half, f.x), at(middle + (half * f.desc) / f.x, f.desc)),
          f.end,
          f.end,
        ),
      ]);
  },

  z: (style) => {
    const f = frame(style);
    const width = f.arch * 1.6;
    const left = f.edge;
    /*
     * The two arms hang from the x-height and stand on the baseline, and the
     * corners they turn into are given the point the ink should reach.
     *
     * Both halves of that matter. Written with the arms on the lines the z sat
     * half a pen low and half a pen high at once; written with the arms right
     * but the corners still at their own vertices, the far end of each arm
     * would slope away from the line it started level with.
     */
    const [above, below] = arms(f, f.x);
    const start = at(left, above);
    const end = at(left + width, below);
    const [across, back] = corners(f, [start, at(left + width, f.x), at(left, 0), end]);
    const upper = at(across.x, start.y);
    const lower = at(back.x, end.y);
    return finish(
      f,
      [
        ink(
          f,
          chain(straight(start, upper), straight(upper, lower), straight(lower, end)),
          f.end,
          f.end,
        ),
      ]);
  },

  // --- capitals ----------------------------------------------------------

  A: (style) => {
    const f = frame(style);
    /*
     * Never narrower than the pen, however narrow the face is set.
     *
     * A bowl is measured by its ink now, so at a heavy weight the round
     * capitals are drawn much smaller than they used to be -- correctly, since
     * their ink has to fit between the same two lines -- and everything sized
     * against them came down with them. An A of a hundred and eighteen units
     * either side of its apex, drawn with a pen of two hundred and sixty, has
     * its two legs closer together than the pen is wide.
     */
    const half = Math.max(f.capBowl * 0.86, f.least);
    const left = f.edge;
    const middle = left + half;
    const foot = at(left, 0);
    const other = at(middle + half, 0);
    // The apex is where the ink should reach; the skeleton's own vertex sits
    // below it by however far the point of that angle carries.
    const peak = corner(f, foot, at(middle, f.cap), other);
    /*
     * The waist sits lower than a crossbar does on an H, but it is the same
     * decision and has to move with it. Written as a fixed fraction it did not:
     * the A quietly ignored the crossbar control, which is the one thing this
     * whole idea cannot afford.
     */
    const bar = f.cap * f.style.parts.crossbar.height * 0.58;
    // Where the diagonals actually are at that height, so the bar meets them
    // rather than poking out either side.
    const inset = (half * bar) / f.cap;
    return finish(
      f,
      [
        ink(f, chain(straight(foot, peak), straight(peak, other)), f.end, f.end),
        thin(f, straight(at(left + inset, bar), at(middle + half - inset, bar))),
      ]);
  },

  B: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const upper = f.cap * 0.56;
    // Measured between where the ink has to reach rather than between the
    // lines themselves, so the two bowls fill the capital exactly and the
    // slight extra keeps them overlapping where they meet.
    const top = f.crest(f.cap);
    const base = f.dip(0);
    const upperR = Math.max((top - upper) / 2 + f.half * 0.2, f.least);
    const lowerR = Math.max((upper - base) / 2 + f.half * 0.2, f.least);
    /*
     * How far the bowls reach out, which is not the same as how tall they are.
     *
     * Tied to their own height they came out barely wider than the stem, since
     * a B's two bowls are each less than half the height of a D's one. A B is
     * narrower than a D but nothing like half of it, so the reach is measured
     * against the round capitals instead and both bowls share it, which is also
     * what stops the upper one looking like a mistake beside the lower.
     */
    const reach = f.capBowl * 0.84;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        belly(f, at(stem, top - upperR), reach, upperR, -90, 90),
        belly(f, at(stem, base + lowerR), reach, lowerR, -90, 90),
      ]);
  },

  C: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.capBowl, f.cap / 2);
    return finish(f, [openBowl(f, centre, f.capBowl, f.capBowlH)], true);
  },

  D: (style) => {
    const f = frame(style);
    const stem = f.edge;
    /*
     * And the belly never reaches past the stem it hangs on.
     *
     * Its two ends sit on the stem's own line at the top and the bottom of the
     * bowl, so a bowl taller than the stem puts them past the end of it -- and
     * a light pen has too little ink up there to close the gap. At an overshoot
     * of 30 and a pen of 40 the `D` came apart into two pieces on three faces,
     * with the stem's tip standing clear of the bowl beside it.
     *
     * The stem's ink stops half a pen past each line, so that is how far the
     * belly may go.
     */
    const asked = (f.crest(f.cap) - f.dip(0)) / 2;
    const radius = Math.max(Math.min(asked, f.cap / 2 + f.half * 0.5), f.least);
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        belly(f, at(stem, f.cap / 2), radius * f.wide, radius, -90, 90),
      ],
      true);
  },

  E: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = f.capBowl * 1.15;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        arm(f, stem, stem + reach, f.hangs(f.cap, f.bar)),
        arm(
          f,
          stem,
          stem + reach * 0.86,
          f.cap * f.style.parts.crossbar.height,
        ),
        arm(f, stem, stem + reach, f.sits(0, f.bar)),
      ]);
  },

  F: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = f.capBowl * 1.15;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        arm(f, stem, stem + reach, f.hangs(f.cap, f.bar)),
        arm(
          f,
          stem,
          stem + reach * 0.86,
          f.cap * f.style.parts.crossbar.height,
        ),
      ]);
  },

  G: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.capBowl, f.cap / 2);
    const right = centre.x + f.capBowl;
    /*
     * A G is a C carried round almost the whole way and then turned back into
     * itself, and how far past the turn it goes depends on the weight.
     *
     * Ending the bowl level with its own centre put its square end exactly
     * where the bar's top edge is, so the bar stood half a pen proud of it and
     * the step read as a chip out of the letter. Carried on until the bowl is
     * half a pen above its centre, the bar's whole width is inside ink that is
     * already there. Chaining the two instead would be neater still, but the
     * corner between an arc and a straight run has no closed form to cut it
     * back to, and the letter folded.
     */
    const past = (Math.asin(Math.min(1, f.half / f.capBowlH)) * 180) / Math.PI;
    /*
     * And the aperture is opened far enough for the two ends to clear.
     *
     * A gap of thirty-two degrees is a gap of a hundred and seventy units on a
     * bowl this size, and the display weight's pen is a hundred and seventy-
     * five: the two ends of the stroke ran into each other and the G closed
     * itself into an O with a scar. A heavy face opens its apertures for
     * exactly this reason, so the opening is measured in pen widths rather than
     * in degrees.
     */
    const clear = (((f.half * 2.4) / f.capBowlH) * 180) / Math.PI;
    const opens = Math.max(32, past + clear);
    return finish(
      f,
      [
        openBowl(f, centre, f.capBowl, f.capBowlH, opens, 360, past),
        ink(f, straight(at(right, centre.y), at(right - f.capBowl * 0.55, centre.y)), BUTT, f.end),
      ],
      true);
  },

  H: (style) => {
    const f = frame(style);
    const left = f.edge;
    const right = left + f.style.metrics.counterWidth + f.style.pen.weight;
    return finish(
      f,
      [
        ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
        ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
        thin(
          f,
          straight(
            at(left, f.cap * f.style.parts.crossbar.height),
            at(right, f.cap * f.style.parts.crossbar.height),
          ),
        ),
      ]);
  },

  I: (style) => {
    const f = frame(style);
    return finish(f, [ink(f, straight(at(f.edge, 0), at(f.edge, f.cap)), f.end, f.end)]);
  },

  J: (style) => {
    const f = frame(style);
    const radius = Math.max(f.capBowl * 0.55, f.least);
    const stem = f.edge + radius;
    return finish(
      f,
      [
        ink(
          f,
          chain(
            straight(at(stem, f.cap), at(stem, f.dip(0) + radius)),
            turn(at(stem - radius, f.dip(0) + radius), radius, 0, -90),
          ),
          f.end,
          f.end,
        ),
      ]);
  },

  K: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = stem + f.capBowl * 1.15;
    const waist = f.cap * 0.44;
    const arm = at(reach, f.cap);
    const leg = at(reach, 0);
    // Arm and leg are one run meeting at the stem, so the corner between them
    // is turned rather than left as two square ends.
    const meet = junction(f, arm, stem, waist, leg);
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        ink(f, chain(straight(arm, meet), straight(meet, leg)), f.end, f.end),
      ]);
  },

  L: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = f.capBowl * 1.05;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        arm(f, stem, stem + reach, f.sits(0, f.bar)),
      ]);
  },

  M: (style) => {
    const f = frame(style);
    const left = f.edge;
    /*
     * And wide enough that the vee is a vee.
     *
     * Every other letter narrows gracefully; an M does not, because its two
     * diagonals meet the stems at a corner that sharpens as the letter closes
     * up, and past a point the inside of that corner cannot be cut back inside
     * the run it has to be cut back into.
     */
    const width = Math.max(f.capBowl * 1.7, f.half * 7);
    const middle = left + width / 2;
    const right = left + width;
    const dip = f.cap * 0.16;
    const into = stub(f);
    const start = at(left, f.cap - into);
    const end = at(right, f.cap - into);
    const [topLeft, vertex, topRight] = corners(f, [
      start,
      at(left, f.cap),
      at(middle, dip),
      at(right, f.cap),
      end,
    ]);
    return finish(
      f,
      [
        ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
        ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
        ink(
          f,
          chain(
            straight(start, topLeft),
            straight(topLeft, vertex),
            straight(vertex, topRight),
            straight(topRight, end),
          ),
        ),
      ]);
  },

  N: (style) => {
    const f = frame(style);
    const left = f.edge;
    const right = left + f.capBowl * 1.35;
    const into = stub(f);
    const start = at(left, f.cap - into);
    const end = at(right, into);
    const [top, foot] = corners(f, [start, at(left, f.cap), at(right, 0), end]);
    return finish(
      f,
      [
        ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
        ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
        ink(f, chain(straight(start, top), straight(top, foot), straight(foot, end))),
      ]);
  },

  O: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.capBowl, f.cap / 2);
    return finish(f, [ink(f, ring(f, centre, f.capBowl, f.capBowlH))], true);
  },

  P: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = Math.max(f.cap * 0.27, f.least);
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        belly(f, at(stem, f.crest(f.cap) - radius), radius * f.wide, radius, -90, 90),
      ]);
  },

  Q: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.capBowl, f.cap / 2);
    /*
     * The tail leaves the bowl's own centre-line and carries on outwards.
     *
     * Started inside the bowl it crossed the counter, and a stroke laid across
     * a counter is filled in: the Q came out with a bar through its hole. Begun
     * on the wall itself there is nothing to cross -- it grows out of the
     * stroke, which is what a tail does.
     */
    const leaves = bowlPoint(centre, f.capBowl, f.capBowlH, 1 - f.square, f.half, -52);
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.capBowl, f.capBowlH)),
        ink(
          f,
          straight(leaves, at(centre.x + f.capBowl * 1.02, -f.cap * 0.15)),
          BUTT,
          f.end,
        ),
      ],
      true);
  },

  R: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = Math.max(f.cap * 0.27, f.least);
    const eye = f.crest(f.cap) - radius;
    const junction = eye - radius;
    const reach = stem + radius * 1.9;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        belly(f, at(stem, eye), radius * f.wide, radius, -90, 90),
        // From the stem's own centre-line, where the bowl lands, so the leg
        // grows out of the junction rather than starting beside it.
        ink(f, straight(at(stem, junction), at(reach, 0)), BUTT, f.end),
      ]);
  },

  S: (style) => {
    const f = frame(style);
    const { stroke } = spine(f, f.cap, f.edge);
    return finish(f, [stroke], true);
  },

  T: (style) => {
    const f = frame(style);
    const half = f.capBowl * 0.95;
    const middle = f.edge + half;
    return finish(
      f,
      [
        ink(f, straight(at(middle, 0), at(middle, f.cap)), f.end, BUTT),
        thin(
          f,
          straight(
            at(middle - half, f.hangs(f.cap, f.bar)),
            at(middle + half, f.hangs(f.cap, f.bar)),
          ),
          f.end,
          f.end,
        ),
      ]);
  },

  U: (style) => {
    const f = frame(style);
    return finish(f, [trough(f, f.edge, f.cap)]);
  },

  V: (style) => {
    const f = frame(style);
    const half = f.capBowl * 0.9;
    const left = f.edge;
    const middle = left + half;
    const top = at(left, f.cap);
    const other = at(middle + half, f.cap);
    const point = corner(f, top, at(middle, 0), other);
    return finish(
      f,
      [ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end)]);
  },

  W: (style) => {
    const f = frame(style);
    const half = f.capBowl * 0.66;
    const left = f.edge;
    const top = f.cap;
    /*
     * Two vees, overlapping, rather than one run zigzagging four times.
     *
     * A single run has to satisfy three corners at once, and they pull against
     * each other: the middle peak drops to put its ink on the x-height, which
     * shortens the arms either side of it, which shrinks the rounding the two
     * feet can take, which lifts them off the baseline. On a face with wide
     * corners the feet came to rest ninety-nine units up, and no radius above a
     * quarter of that ever brought them down again -- while a v, which has one
     * corner and nothing to argue with, landed exactly on the line at every
     * radius there is.
     *
     * Two vees is what a w is anyway, and each of them lands the way a v does.
     */
    const vee = (from: number): Stroke => {
      const start = at(left + half * from, top);
      const end = at(left + half * (from + 2), top);
      const point = corner(f, start, at(left + half * (from + 1), 0), end);
      return ink(f, chain(straight(start, point), straight(point, end)), f.end, f.end);
    };
    return finish(f, [vee(0), vee(1.72)]);
  },

  X: (style) => {
    const f = frame(style);
    const width = f.capBowl * 1.55;
    const left = f.edge;
    return finish(
      f,
      [
        ink(f, straight(at(left, f.cap), at(left + width, 0)), f.end, f.end),
        ink(f, straight(at(left, 0), at(left + width, f.cap)), f.end, f.end),
      ]);
  },

  Y: (style) => {
    const f = frame(style);
    const half = f.capBowl * 0.82;
    const left = f.edge;
    const middle = left + half;
    const junction = f.cap * 0.46;
    const top = at(left, f.cap);
    const other = at(middle + half, f.cap);
    const point = corner(f, top, at(middle, junction), other);
    const low = dips(f, top, point, other);
    return finish(
      f,
      [
        ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end),
        /*
         * The stem stands under the vee and runs up past where it bottoms out,
         * so its square top is buried rather than showing as a step.
         *
         * Under where the vee really bottoms out, which is not under the tip
         * the recipe named: `dips` explains the two places that only look like
         * it. Standing at the tip put this stem thirty-two units to one side of
         * its own vee on the Formal Script, and only the width of the vee's ink
         * was holding the letter together -- thirty-six square units of overlap
         * at the bowl width it used to ship, none at all at the one it ships
         * now.
         *
         * Half a pen-half past the meeting point, so the two are overlapping
         * over an area rather than touching along a line. Measured from a point
         * both strokes' spines pass through, that is a full pen's footprint of
         * shared ink on every face here.
         */
        ink(f, straight(at(low.x, 0), at(low.x, low.y + f.half * 0.5)), f.end, BUTT),
      ]);
  },

  Z: (style) => {
    const f = frame(style);
    const width = f.capBowl * 1.4;
    const left = f.edge;
    // Where the arms start is where their own edges lie, so the top one hangs
    // from the cap line and the bottom one stands on the baseline; where they
    // finish is a corner, and a corner is given the point the ink reaches.
    const [above, below] = arms(f, f.cap);
    const start = at(left, above);
    const end = at(left + width, below);
    /*
     * One run, bar to diagonal to bar, rather than three that meet at points.
     *
     * The bars used to be drawn with the lighter crossbar pen, which is what a
     * serif face wants -- but a Z has no crossbar, it has two arms, and the pen
     * already thins a horizontal on any face with contrast. Two mechanisms were
     * doing the same job and only one of them can also turn a corner.
     */
    /*
     * Solved sideways only: how far in from the letter's edge the corner has to
     * sit for its point to land there, but at the arm's own height rather than
     * at whatever height the solver would have chosen.
     *
     * For an arm lying along a line the two are the same thing -- the outside
     * of a mitred corner between a horizontal run and anything else is exactly
     * the pen's own reach from the horizontal, which is the line -- so nothing
     * is given up. What is avoided is a face where they are not the same: with
     * the corners rounded off, solving for height as well lifted the far end of
     * the top arm seventy units above the end it started level with.
     */
    const [across, back] = corners(f, [start, at(left + width, f.cap), at(left, 0), end]);
    const upper = at(across.x, start.y);
    const lower = at(back.x, end.y);
    return finish(
      f,
      [
        ink(
          f,
          chain(straight(start, upper), straight(upper, lower), straight(lower, end)),
          f.end,
          f.end,
        ),
      ]);
  },

  // --- figures -----------------------------------------------------------

  zero: (style) => {
    const f = frame(style);
    const half = figureWidth(f) / 2;
    const centre = at(f.edge + half, f.cap / 2);
    return finish(f, [ink(f, ring(f, centre, half, f.capBowlH))], true);
  },

  one: (style) => {
    const f = frame(style);
    const stem = f.edge + figureWidth(f) * 0.5;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, BUTT),
        // The flag, which is what stops a one reading as a lowercase l.
        ink(
          f,
          straight(at(stem - figureWidth(f) * 0.42, f.cap * 0.78), at(stem, f.hangs(f.cap))),
          f.end,
          BUTT,
        ),
      ]);
  },

  two: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const radius = Math.max(width / 2, f.least);
    const centre = at(left + radius, f.crest(f.cap) - radius);
    /*
     * Over the top, then a straight run down to the baseline, then out along it.
     *
     * Three strokes rather than one chain. Chaining works where the runs leave
     * in the same direction they arrived -- an f's hook, a u's bowl -- because
     * then the two offsets meet. Here the arc comes down to the right and the
     * diagonal sets off down to the left, and offsetting round a corner that
     * sharp sends the inner side through itself. Left as separate strokes they
     * simply overlap, which the letter is full of anyway.
     */
    const leaves = -22;
    const over = bend(f, centre, radius, 190, leaves);
    return finish(f, [
      ink(f, over, f.end, BUTT),
      ink(f, straight(spineEnd(over), at(left, f.sits(0))), BUTT, BUTT),
      arm(f, left, left + width, f.sits(0, f.bar)),
    ]);
  },

  three: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const top = f.crest(f.cap);
    const base = f.dip(0);
    const radius = Math.max((top - base) / 4, f.least);
    const middle = left + width - radius;
    return finish(
      f,
      [
        ink(f, bend(f, at(middle, top - radius), radius, 160, -90), f.end, BUTT),
        ink(f, bend(f, at(middle, base + radius), radius, 90, -160), BUTT, f.end),
      ],
      true);
  },

  four: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const stem = left + width * 0.72;
    const bar = f.cap * 0.28;
    const top = at(stem, f.hangs(f.cap));
    const end = at(left + width, bar);
    const meet = corner(f, top, at(left, bar), end);
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        ink(f, chain(straight(top, meet), straight(meet, end)), BUTT, f.end),
      ]);
  },

  five: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const shoulder = f.cap * 0.56;
    const radius = Math.max(Math.min(shoulder, width / 2), f.least);
    return finish(
      f,
      [
        thin(
          f,
          straight(at(left, f.hangs(f.cap, f.bar)), at(left + width, f.hangs(f.cap, f.bar))),
          f.end,
          f.end,
        ),
        ink(f, straight(at(left, f.cap), at(left, shoulder)), BUTT, BUTT),
        ink(f, bend(f, at(left + radius, f.dip(0) + radius), radius, 100, -150), BUTT, f.end),
      ]);
  },

  six: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    /*
     * Held so the bowl and the hood over it do not overlap: below that the run
     * joining them is written from a point to one above it and the letter is
     * drawn backwards through itself.
     */
    const radius = Math.max(Math.min(width / 2, (f.crest(f.cap) - f.dip(0)) / 2), f.least);
    const centre = at(left + radius, f.dip(0) + radius);
    const hood = Math.max(f.crest(f.cap) - radius, centre.y);
    return finish(
      f,
      [
        ink(f, ring(f, centre, bendWidth(f, radius), radius)),
        /*
         * The stroke that arrives at the bowl from the upper right, as one run:
         * over the top, then straight down the left to meet the ring.
         *
         * Drawn as the turn alone it stopped level with the top of the bowl and
         * left the rest to the imagination, which at this size looked less like
         * a six than like a c with a hat.
         */
        ink(
          f,
          chain(
            bend(f, at(centre.x, hood), radius, 60, 180),
            straight(
              at(centre.x - bendWidth(f, radius), hood),
              at(centre.x - bendWidth(f, radius), centre.y),
            ),
          ),
          f.end,
          BUTT,
        ),
      ],
      true);
  },

  seven: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const start = at(left, f.hangs(f.cap));
    const end = at(left + width * 0.28, 0);
    const meet = at(corner(f, start, at(left + width, f.cap), end).x, start.y);
    return finish(
      f,
      [ink(f, chain(straight(start, meet), straight(meet, end)), f.end, f.end)]);
  },

  eight: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    // Where the two rings meet, with each of them filling what is left between
    // that and the line its own half of the figure has to reach.
    const waist = f.cap * 0.56;
    const upper = Math.max((f.crest(f.cap) - waist) / 2, f.least);
    const lower = Math.max((waist - f.dip(0)) / 2, f.least);
    return finish(
      f,
      [
        ink(f, ring(f, at(left + width / 2, f.crest(f.cap) - upper), bendWidth(f, upper), upper)),
        ink(f, ring(f, at(left + width / 2, f.dip(0) + lower), bendWidth(f, lower), lower)),
      ],
      true);
  },

  nine: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const radius = Math.max(Math.min(width / 2, (f.crest(f.cap) - f.dip(0)) / 2), f.least);
    const centre = at(left + radius, f.crest(f.cap) - radius);
    const foot = Math.min(f.dip(0) + radius, centre.y);
    return finish(
      f,
      [
        ink(f, ring(f, centre, bendWidth(f, radius), radius)),
        // The mirror of a six: down the right from the bowl, then round the
        // bottom and away.
        ink(
          f,
          chain(
            straight(
              at(centre.x + bendWidth(f, radius), centre.y),
              at(centre.x + bendWidth(f, radius), foot),
            ),
            bend(f, at(centre.x, foot), radius, 0, -120),
          ),
          BUTT,
          f.end,
        ),
      ],
      true);
  },

  // --- punctuation -------------------------------------------------------

  space: (style) => {
    const f = frame(style);
    return { strokes: [], width: f.arch * 1.1 };
  },

  period: (style) => {
    const f = frame(style);
    const radius = f.half * 0.95;
    return finish(f, [dot(f, at(f.edge, radius), radius)]);
  },

  comma: (style) => {
    const f = frame(style);
    const radius = f.half * 0.95;
    return finish(
      f,
      [
        tail(f, radius),
      ]);
  },

  colon: (style) => {
    const f = frame(style);
    const radius = f.half * 0.95;
    return finish(
      f,
      [dot(f, at(f.edge, radius), radius), dot(f, at(f.edge, f.x - radius), radius)]);
  },

  semicolon: (style) => {
    const f = frame(style);
    const radius = f.half * 0.95;
    return finish(
      f,
      [
        tail(f, radius),
        dot(f, at(f.edge, f.x - radius), radius),
      ]);
  },

  exclam: (style) => {
    const f = frame(style);
    const radius = f.half * 0.95;
    return finish(
      f,
      [
        ink(f, straight(at(f.edge, radius * 3), at(f.edge, f.cap)), f.end, f.end),
        dot(f, at(f.edge, radius), radius),
      ]);
  },

  question: (style) => {
    const f = frame(style);
    const radius = Math.max(figureWidth(f) * 0.42, f.least);
    const centre = at(f.edge + radius, f.crest(f.cap) - radius);
    const radiusDot = f.half * 0.95;
    return finish(
      f,
      [
        ink(f, turn(centre, radius, 190, -35), f.end, BUTT),
        ink(f, straight(pointOn(centre, radius, -35), at(centre.x, f.cap * 0.3)), BUTT, f.end),
        dot(f, at(centre.x, radiusDot), radiusDot),
      ]);
  },

  hyphen: (style) => {
    const f = frame(style);
    const width = f.arch * 0.7;
    return finish(
      f,
      [thin(f, straight(at(f.edge, axis(f)), at(f.edge + width, axis(f))), f.plain, f.plain)]);
  },

  parenleft: (style) => {
    const f = frame(style);
    const radius = Math.max(f.cap * 0.72, f.least);
    const centre = at(f.edge + radius, f.cap * 0.4);
    return finish(
      f,
      [ink(f, turn(centre, radius, 145, 215), f.end, f.end)]);
  },

  parenright: (style) => {
    const f = frame(style);
    const radius = Math.max(f.cap * 0.72, f.least);
    const centre = at(f.edge - radius + f.arch * 0.32, f.cap * 0.4);
    return finish(
      f,
      [ink(f, turn(centre, radius, 35, -35), f.end, f.end)]);
  },

  slash: (style) => {
    const f = frame(style);
    const lean = f.arch * 0.75;
    return finish(
      f,
      [ink(f, straight(at(f.edge, f.desc * 0.6), at(f.edge + lean, f.cap)), f.plain, f.plain)]);
  },

  quotesingle: (style) => {
    const f = frame(style);
    return finish(
      f,
      [ink(f, straight(at(f.edge, f.cap * 0.72), at(f.edge, f.cap)), f.plain, f.plain)]);
  },

  quotedbl: (style) => {
    const f = frame(style);
    const gap = f.style.pen.weight * 1.6;
    return finish(
      f,
      [
        ink(f, straight(at(f.edge, f.cap * 0.72), at(f.edge, f.cap)), f.plain, f.plain),
        ink(f, straight(at(f.edge + gap, f.cap * 0.72), at(f.edge + gap, f.cap)), f.plain, f.plain),
      ]);
  },

  // --- symbols -----------------------------------------------------------
  //
  // The rest of what a font needs, and the part that is usually a second
  // typeface hiding inside the first: symbols get drawn once, by hand, at one
  // weight, and then the letters move on without them. Everything below is
  // built out of the same pen and the same frame as the alphabet, so weight,
  // width, slant, corner rounding, squareness and the wave reach all of it --
  // and several of them are not drawn at all, but are a letter this font
  // already has, turned over or set small.

  /*
   * The arithmetic, on one line and at one width.
   *
   * A plus, a minus, an equals and a division sign that do not sit on the same
   * line do not read as arithmetic, and ones of different widths will not stack
   * into a column. Both are settled here rather than glyph by glyph: `axis` is
   * the height, and it is the height the hyphen already used, and the width
   * comes from the figures so a sum lines up under the numbers it is about.
   */

  plus: (style) => {
    const f = frame(style);
    const w = signWidth(f);
    const y = axis(f);
    const half = w / 2;
    return finish(
      f,
      [
        thin(f, straight(at(f.edge, y), at(f.edge + w, y)), f.plain, f.plain),
        thin(f, straight(at(f.edge + half, y - half), at(f.edge + half, y + half)), shortEnd(f), shortEnd(f)),
      ]);
  },

  equal: (style) => {
    const f = frame(style);
    const w = signWidth(f);
    const gap = signGap(f);
    return finish(
      f,
      [
        thin(f, straight(at(f.edge, axis(f) - gap), at(f.edge + w, axis(f) - gap)), f.plain, f.plain),
        thin(f, straight(at(f.edge, axis(f) + gap), at(f.edge + w, axis(f) + gap)), f.plain, f.plain),
      ]);
  },

  multiply: (style) => {
    const f = frame(style);
    const w = signWidth(f) * 0.82;
    const y = axis(f);
    const half = w / 2;
    return finish(
      f,
      [
        thin(f, straight(at(f.edge, y - half), at(f.edge + w, y + half)), shortEnd(f), shortEnd(f)),
        thin(f, straight(at(f.edge, y + half), at(f.edge + w, y - half)), shortEnd(f), shortEnd(f)),
      ]);
  },

  /*
   * The two dots stand off the bar by their own daylight, not by a fraction of
   * the sign's width. Set at a fixed share of it, a heavy face put both dots
   * inside the bar and the whole mark came out as one thick plus.
   */
  divide: (style) => {
    const f = frame(style);
    const w = signWidth(f);
    const y = axis(f);
    const radius = f.half * 0.85;
    const reach = (f.style.pen.weight * f.bar) / 2 + signGap(f) * 0.85 + radius;
    return finish(
      f,
      [
        thin(f, straight(at(f.edge, y), at(f.edge + w, y)), f.plain, f.plain),
        dot(f, at(f.edge + w / 2, y + reach), radius),
        dot(f, at(f.edge + w / 2, y - reach), radius),
      ]);
  },

  /*
   * Set the two apart by their own bars rather than by half a pen.
   *
   * A plus over a rule is only a plus-or-minus if the two are read as separate
   * marks, and on a heavy face half a pen of daylight between them is none at
   * all: the two fuse into one block. The gap is a share of the bar drawing
   * them, which holds at every weight.
   */
  plusminus: (style) => {
    const f = frame(style);
    const w = signWidth(f);
    const bar = f.style.pen.weight * f.bar;
    const under = axis(f) - signWidth(f) * 0.5 - bar * 1.15;
    const y = axis(f) + bar * 0.35;
    const half = w / 2;
    return finish(
      f,
      [
        thin(f, straight(at(f.edge, y), at(f.edge + w, y)), f.plain, f.plain),
        thin(f, straight(at(f.edge + half, y - half * 0.86), at(f.edge + half, y + half * 0.86)), shortEnd(f), shortEnd(f)),
        thin(f, straight(at(f.edge, under), at(f.edge + w, under)), f.plain, f.plain),
      ]);
  },

  less: (style) => {
    const f = frame(style);
    const w = signWidth(f) * 0.9;
    const y = axis(f);
    const rise = w * 0.78;
    return finish(
      f,
      [
        bent(
          f,
          chain(
            straight(at(f.edge + w, y + rise), at(f.edge, y)),
            straight(at(f.edge, y), at(f.edge + w, y - rise)),
          ),
        ),
      ]);
  },

  greater: (style) => {
    const f = frame(style);
    const w = signWidth(f) * 0.9;
    const y = axis(f);
    const rise = w * 0.78;
    return finish(
      f,
      [
        bent(
          f,
          chain(
            straight(at(f.edge, y + rise), at(f.edge + w, y)),
            straight(at(f.edge + w, y), at(f.edge, y - rise)),
          ),
        ),
      ]);
  },

  logicalnot: (style) => {
    const f = frame(style);
    const w = signWidth(f);
    const y = axis(f) + signWidth(f) * 0.32;
    return finish(
      f,
      [
        bent(
          f,
          chain(
            straight(at(f.edge, y), at(f.edge + w, y)),
            straight(at(f.edge + w, y), at(f.edge + w, y - w * 0.36)),
          ),
        ),
      ]);
  },

  underscore: (style) => {
    const f = frame(style);
    const w = f.arch * 1.45;
    const y = f.desc * 0.42;
    return finish(f, [thin(f, straight(at(f.edge, y), at(f.edge + w, y)), f.plain, f.plain)]);
  },

  bar: (style) => {
    const f = frame(style);
    const { foot, head } = tall(f);
    // Straight to the line, not half a pen short of it: a run cut square across
    // its own direction stops where its spine stops, and only the runs that lie
    // along a line have to be set back from it.
    return finish(f, [ink(f, straight(at(f.edge, foot), at(f.edge, head)), f.plain, f.plain)]);
  },

  /*
   * A broken bar is one bar with a piece taken out of the middle, and the piece
   * is as wide as the bar: any narrower and it fills in at a display weight,
   * any wider and it reads as two marks rather than one interrupted.
   */
  brokenbar: (style) => {
    const f = frame(style);
    const { foot, head } = tall(f);
    const middle = (foot + head) / 2;
    const gap = Math.max(f.style.pen.weight, (head - foot) * 0.11);
    return finish(
      f,
      [
        ink(f, straight(at(f.edge, foot), at(f.edge, middle - gap / 2)), f.plain, f.plain),
        ink(f, straight(at(f.edge, middle + gap / 2), at(f.edge, head)), f.plain, f.plain),
      ]);
  },

  bracketleft: (style) => {
    const f = frame(style);
    const w = f.arch * 0.52;
    const { foot, head } = tall(f);
    return finish(
      f,
      [
        ink(
          f,
          chain(
            straight(at(f.edge + w, f.hangs(head)), at(f.edge, f.hangs(head))),
            straight(at(f.edge, f.hangs(head)), at(f.edge, f.sits(foot))),
            straight(at(f.edge, f.sits(foot)), at(f.edge + w, f.sits(foot))),
          ),
          shortEnd(f),
          shortEnd(f),
        ),
      ]);
  },

  bracketright: (style) => {
    const f = frame(style);
    const w = f.arch * 0.52;
    const { foot, head } = tall(f);
    return finish(
      f,
      [
        ink(
          f,
          chain(
            straight(at(f.edge, f.hangs(head)), at(f.edge + w, f.hangs(head))),
            straight(at(f.edge + w, f.hangs(head)), at(f.edge + w, f.sits(foot))),
            straight(at(f.edge + w, f.sits(foot)), at(f.edge, f.sits(foot))),
          ),
          shortEnd(f),
          shortEnd(f),
        ),
      ]);
  },

  backslash: (style) => {
    const f = frame(style);
    const lean = f.arch * 0.75;
    return finish(
      f,
      [ink(f, straight(at(f.edge, f.cap), at(f.edge + lean, f.desc * 0.6)), f.plain, f.plain)]);
  },

  /*
   * A caret is wide against its height, and it has to be: the point is a corner
   * between two runs, and the taller and narrower it gets the sharper that
   * corner is, until the inside of the turn comes back through the stroke. On a
   * condensed face at a display weight it did exactly that.
   */
  asciicircum: (style) => {
    const f = frame(style);
    const rise = f.cap * 0.32;
    const w = Math.max(signWidth(f), rise * 1.55, barHalf(f) * 5);
    const foot = f.cap * 0.56;
    // Short of the cap line, because a corner carried out to a miter reaches
    // past both the runs that make it -- and a flared face reaches further.
    const head = Math.min(foot + rise, f.cap * 0.92);
    return finish(
      f,
      [
        bent(
          f,
          chain(
            straight(at(f.edge, foot), at(f.edge + w / 2, f.hangs(head))),
            straight(at(f.edge + w / 2, f.hangs(head)), at(f.edge + w, foot)),
          ),
        ),
      ]);
  },

  /*
   * The two bars of a hash lean, because upright ones read as a window frame
   * rather than as a mark -- and they lean by the same amount whatever the face
   * is doing, since a slanted face slants the whole thing again on top.
   */
  numbersign: (style) => {
    const f = frame(style);
    const foot = f.x * -0.06;
    const head = f.cap * 0.92;
    const lean = (head - foot) * 0.14;
    /*
     * Four runs held apart by their own width rather than by a share of the
     * sign's, and the sign as wide as that spacing turns out to need.
     *
     * Set at a fraction of a fixed width, a hash on a display face was four
     * bars with less than a bar between them: they fused, and what came out was
     * a single lozenge of ink. Spacing first and width second means a heavy
     * face draws a wide hash, which is what a heavy face does.
     */
    const down = Math.max(f.style.pen.weight * f.bar * 1.85, signWidth(f) * 0.36);
    const across = Math.max(f.style.pen.weight * f.bar * 1.7, f.x * 0.3);
    const w = down + Math.max(down * 0.62, lean + f.style.pen.weight * f.bar);
    const middle = axis(f) + f.x * 0.04;
    return finish(
      f,
      [
        ...[middle - across / 2, middle + across / 2].map((y) =>
          thin(f, straight(at(f.edge, y), at(f.edge + w, y)), f.plain, f.plain),
        ),
        ...[(w - down) / 2, (w + down) / 2].map((x) =>
          thin(f, straight(at(f.edge + x - lean / 2, foot), at(f.edge + x + lean / 2, head)), shortEnd(f), shortEnd(f)),
        ),
      ]);
  },

  /*
   * The symbols that are a letter this font already draws.
   *
   * A cent is a c with a bar through it, an ordinal is a small a, a superior
   * figure is a small figure, and a Spanish opening mark is the closing one
   * turned over. Drawn again here rather than borrowed, each would be a second
   * a and a second c inside the same font -- and the day somebody chose the
   * single-storey a, one of the two would quietly stay behind.
   */

  cent: outOf("c", (f, c) => {
    const centre = f.edge + f.bowl;
    const over = f.x * 0.22;
    return joined(
      f,
      c(),
      [ink(f, straight(at(centre, -over), at(centre, f.x + over)), shortEnd(f), shortEnd(f))],
      true,
    );
  }),

  dollar: outOf("S", (f, s) => {
    // Where the s runs, worked out the way the s works it out, so the bar goes
    // through the middle of the letter rather than near it.
    const radius = Math.max((f.cap + f.over * 2 - f.upright * 2) / 4, f.least);
    const centre = f.edge + bendWidth(f, radius);
    // How far the bar stands out past the letter, kept modest: a wavy face
    // adds its own swing on top and the two together reached over the line.
    const over = f.cap * 0.075;
    return joined(
      f,
      s(),
      [ink(f, straight(at(centre, -over), at(centre, f.cap + over)), shortEnd(f), shortEnd(f))],
      true,
    );
  }),

  /*
   * A yen is a Y with its stem crossed. The bars reach the full width of the
   * letter, sit below where the vee closes, and stand apart by their own
   * weight rather than by a share of the cap height -- which on a display face
   * put them within a bar of each other, where they fused into one.
   *
   * And there are two of them only where two will fit. A heavy face carries
   * its vee most of the way down to the junction and leaves barely a stem
   * below it; asked for two bars anyway, the upper one landed in the vee and
   * the lower one under the baseline. One bar is a yen as surely as two are,
   * and it is what a heavy face has room to draw.
   */
  yen: outOf("Y", (f, y) => {
    const drawn = y();
    const across = spread(drawn);
    const bar = f.style.pen.weight * f.bar;
    const junction = f.cap * 0.46;
    const top = junction - f.style.pen.weight * 0.85 - bar / 2;
    const step = Math.max(bar * 2.3, f.cap * 0.12);
    /*
     * Two bars where they fit and two bars where they do not.
     *
     * A yen carries two strokes across its stem, and how much room there is for
     * them is a question about the pen: at a hairline the two sit clear of each
     * other and of the vee above, and by a text weight they have eaten the gap
     * and one bar is all that will go. Drawing one bar in that case is right on
     * the page and wrong in the file -- it is a whole stroke fewer, four nodes,
     * and two weights drawn with different nodes cannot be joined into one
     * variable font, so a yen sat in a Black word at Thin weight.
     *
     * So the second bar is drawn on top of the first rather than dropped. Two
     * strokes on one line are one line to look at, and they are two strokes to
     * count -- and as the weight comes off they slide apart into the pair the
     * letter is supposed to have.
     */
    const room = top - step > f.cap * 0.11;
    const rows = room ? [top, top - step] : [top * 0.62, top * 0.62];
    return joined(
      f,
      drawn,
      rows.map((row) =>
        thin(f, straight(at(across.xMin, row), at(across.xMax, row)), f.plain, f.plain),
      ),
    );
  }),

  /** A u whose first stem carries on below the line, which is what a mu is. */
  mu: outOf("u", (f, u) =>
    joined(f, u(), [
      ink(f, straight(at(f.edge, f.desc * 0.86), at(f.edge, f.x * 0.5)), f.end, BUTT),
    ]),
  ),

  exclamdown: outOf("exclam", (f) => turnedDown(f, "exclam")),
  questiondown: outOf("question", (f) => turnedDown(f, "question")),

  ordfeminine: outOf("a", (f) => ordinal(f, "a")),
  ordmasculine: outOf("o", (f) => ordinal(f, "o")),

  onesuperior: outOf("one", (f) => superior(f, "one")),
  twosuperior: outOf("two", (f) => superior(f, "two")),
  threesuperior: outOf("three", (f) => superior(f, "three")),

  /*
   * The fractions, which are the figures again at two heights with a stroke
   * between them.
   *
   * Two letters go into each of these and `outOf` names one, so the numerator
   * is the one whose letterform they follow. It is the half a reader looks at.
   */
  onequarter: outOf("one", (f) => fraction(f, "one", "four")),
  onehalf: outOf("one", (f) => fraction(f, "one", "two")),
  threequarters: outOf("three", (f) => fraction(f, "three", "four")),

  /*
   * A tilde as wide as a sign, built the way the accent above a letter is: two
   * half turns, one over and one under. The same shape at a different size and
   * on a different line, which is why it is not drawn again from scratch.
   */
  asciitilde: (style) => {
    const f = frame(style);
    // Held above what the bar drawing it can turn round, which is not the same
    // number as what the stem can: a face whose bars are heavier than its stems
    // asked this arc for a radius narrower than its own pen.
    const radius = Math.max((signWidth(f) * 1.06) / 4, barHalf(f) * 1.12);
    const y = axis(f);
    return finish(f, [
      thin(
        f,
        chain(
          turn(at(f.edge + radius, y), radius, 180, 0),
          turn(at(f.edge + radius * 3, y), radius, 180, 360),
        ),
        shortEnd(f),
        shortEnd(f),
      ),
    ]);
  },

  /** Five spokes from one middle, which is what keeps it from reading as a star. */
  asterisk: (style) => {
    const f = frame(style);
    const reach = Math.max(f.cap * 0.2, f.style.pen.weight * f.bar * 1.3);
    const centre = at(f.edge + reach, f.cap - reach * 1.05);
    return finish(
      f,
      [90, 162, 234, 306, 18].map((degrees) =>
        thin(f, straight(centre, pointOn(centre, reach, degrees)), BUTT, shortEnd(f)),
      ),
    );
  },

  /*
   * Two rings and the stroke between them. The rings are held to a size the pen
   * can keep a counter at, and the sign widens to suit rather than closing up.
   */
  percent: (style) => {
    const f = frame(style);
    const radius = Math.max(f.cap * 0.155, f.half * 2.05);
    const w = Math.max(f.cap * 0.86 * f.style.metrics.width, radius * 4.3);
    const lean = w * 0.62;
    const bar = f.edge + (w - lean) / 2;
    return finish(
      f,
      [
        ink(f, ring(f, at(f.edge + radius, f.cap - radius), radius, radius)),
        ink(
          f,
          straight(at(bar, f.dip(0)), at(bar + lean, f.crest(f.cap))),
          shortEnd(f),
          shortEnd(f),
        ),
        ink(f, ring(f, at(f.edge + w - radius, radius), radius, radius)),
      ],
      true,
    );
  },

  /*
   * A brace: two long curves either side of a spur that points away from the
   * text. Four arcs bowed off their chords rather than one chain of turns,
   * because a brace changes direction three times and an offset carried round
   * a turn that sharp goes through itself.
   */
  braceleft: (style) => brace(frame(style), 1),
  braceright: (style) => brace(frame(style), -1),

  /*
   * A pound is an L drawn the wrong way round with a bar through it: a hooked
   * head, a stem down to the line, a foot along it, and the crossbar that says
   * which currency it is.
   */
  sterling: (style) => {
    const f = frame(style);
    const w = figureWidth(f) * 1.05;
    const hook = Math.max(w * 0.29, f.least);
    const stem = f.edge + hook * 1.5;
    const head = f.crest(f.cap) - hook;
    /*
     * The hook and the stem are two runs that overlap rather than one chain.
     * Chained, the arc comes down the left and the stem sets off from where the
     * recipe thought the arc ended -- and half a unit of daylight between them
     * is a kink the sweep turns into a crossed stroke. The figure two learned
     * the same thing.
     */
    const over = bend(f, at(stem, head), hook, 20, 180);
    return finish(f, [
      ink(f, over, f.end, BUTT),
      ink(f, straight(spineEnd(over), at(spineEnd(over).x, f.sits(0))), BUTT, BUTT),
      arm(f, f.edge, f.edge + w, f.sits(0, f.bar)),
      thin(
        f,
        straight(at(f.edge + w * 0.03, f.x * 0.62), at(f.edge + w * 0.72, f.x * 0.62)),
        f.plain,
        f.plain,
      ),
    ]);
  },

  /** A ring with four spokes off its corners, which is the old currency mark. */
  currency: (style) => {
    const f = frame(style);
    const radius = Math.max(f.cap * 0.2, f.half * 2.1);
    const centre = at(f.edge + radius, axis(f) + f.cap * 0.16);
    const spoke = radius * 0.62;
    return finish(
      f,
      [
        ink(f, ring(f, centre, radius, radius)),
        ...[45, 135, 225, 315].map((degrees) =>
          thin(
            f,
            straight(pointOn(centre, radius * 0.86, degrees), pointOn(centre, radius + spoke, degrees)),
            BUTT,
            shortEnd(f),
          ),
        ),
      ],
      true,
    );
  },

  /*
   * A section mark is an s over an s, offset by half and sharing the middle.
   * Drawn out of the same construction the letter uses, so it thickens, leans,
   * squares and waves with the rest of the font rather than beside it.
   */
  section: (style) => {
    const f = frame(style);
    const height = f.cap * 0.62;
    const step = height * 0.53;
    const upper = spine(f, height, f.edge).stroke;
    const lower = spine(f, height, f.edge).stroke;
    return {
      strokes: [
        shovedStroke(finish(f, [upper]).strokes[0], 0, f.cap - height + f.desc * 0.06),
        shovedStroke(finish(f, [lower]).strokes[0], 0, f.cap - height - step + f.desc * 0.06),
      ],
      round: true,
    };
  },

  copyright: (style) => enclosed(frame(style), "C"),
  registered: (style) => enclosed(frame(style), "R"),

  /*
   * A pilcrow: a filled bowl with two stems hanging off it. The bowl is solid
   * rather than a counter, so it is drawn as what it is -- one run of a pen
   * wide enough to fill it -- rather than as a ring somebody then has to fill.
   */
  paragraph: (style) => {
    const f = frame(style);
    const thick = f.cap * 0.5;
    const middle = f.cap - thick / 2;
    const round: Terminal = { kind: "round" };
    // The bowl hangs off the first stem and the second stands clear of it by
    // its own width, so a heavy face reads as two stems rather than as one.
    const bowl = Math.max(thick * 0.82, f.style.pen.weight * 1.7);
    const first = f.edge + bowl;
    const second = first + Math.max(f.style.pen.weight * 2.3, f.cap * 0.16);
    const foot = f.desc * 0.62;
    return finish(f, [
      {
        spine: straight(at(f.edge + thick / 2, middle), at(first, middle)),
        pen: { ...f.style.pen, contrast: 0, weight: thick },
        start: round,
        end: BUTT,
      },
      ink(f, straight(at(first, foot), at(first, f.hangs(f.cap))), f.end, BUTT),
      ink(f, straight(at(second, foot), at(second, f.hangs(f.cap))), f.end, BUTT),
    ]);
  },

  /*
   * An at sign: the ring somebody already knows, with a small bowl and its stem
   * inside. The inner pair is the a of this font in miniature in everything but
   * name -- a bowl and an upright beside it -- and it is drawn at the same
   * weight as the ring around it, which is what keeps the mark even in colour.
   */
  at: (style) => {
    const f = frame(style);
    /*
     * The inner bowl is sized first and the ring is grown to hold it.
     *
     * Sized as a share of the ring instead, a display weight left it a hair
     * over the pen drawing it and the little a inside came out as a disc with a
     * dimple. The bowl is the part that has to stay open, so it is the part
     * that sets the size, and the mark gets larger rather than filling in.
     */
    const inner = Math.max(f.capBowlH * 0.38, f.half * 2.35);
    const outer = Math.max(f.capBowlH * 0.94, inner + f.style.pen.weight * 1.55);
    const centre = at(f.edge + outer, f.cap * 0.46);
    const stem = centre.x + bendWidth(f, inner);
    return finish(
      f,
      [
        ink(f, bend(f, centre, outer, -38, 252), shortEnd(f), shortEnd(f)),
        ink(f, ring(f, centre, inner, inner)),
        ink(
          f,
          straight(at(stem, centre.y - inner), at(stem, centre.y + inner * 0.15)),
          BUTT,
          shortEnd(f),
        ),
      ],
      true,
    );
  },

  /*
   * The ampersand, which is the one mark in a font that is not a shape anybody
   * can name. It is drawn here as what it came from: a small loop above a
   * larger one, joined down the left, with the leg crossing out to the right.
   */
  ampersand: (style) => {
    const f = frame(style);
    const topR = Math.max(f.cap * 0.155, f.least);
    const botR = Math.max(f.cap * 0.245, f.least);
    const top = at(f.edge + bendWidth(f, topR) + f.cap * 0.06, f.crest(f.cap) - topR);
    const bottom = at(f.edge + bendWidth(f, botR), f.dip(0) + botR);
    const loop = bend(f, top, topR, -34, 250);
    const belly = bend(f, bottom, botR, 108, 336);
    const leg = at(bottom.x + botR * 2.1, f.cap * 0.5);
    return finish(
      f,
      [
        ink(f, loop, f.end, BUTT),
        ink(f, straight(spineEnd(loop), spineStart(belly)), BUTT, BUTT),
        ink(f, belly, BUTT, BUTT),
        ink(f, straight(spineEnd(belly), leg), BUTT, f.end),
        ink(f, straight(spineStart(loop), at(leg.x * 0.88, f.dip(0) + botR * 0.55)), BUTT, BUTT),
      ],
      true,
    );
  },

  periodcentered: (style) => {
    const f = frame(style);
    const radius = f.half * 0.95;
    return finish(f, [dot(f, at(f.edge, axis(f)), radius)]);
  },

  degree: (style) => {
    const f = frame(style);
    // Wide enough to keep a counter at any weight: a ring less than about two
    // pens across is a disc with a dimple in it.
    const radius = Math.max(f.cap * 0.15, f.half * 2);
    const centre = at(f.edge + radius, f.cap - radius);
    return finish(f, [ink(f, ring(f, centre, radius, radius))], true);
  },

  /*
   * The guillemets: two chevrons each, held apart by their own weight so a
   * heavy face does not run them into one arrowhead.
   */
  guillemotleft: (style) => chevrons(frame(style), -1),
  guillemotright: (style) => chevrons(frame(style), 1),

  // -------------------------------------------------------------------------
  // The letters that are not a letter with a mark on it
  // -------------------------------------------------------------------------
  //
  // Nine of the Latin-1 set do not decompose into anything: Unicode has no
  // parts to offer for an ash, a slashed o, an eth, a thorn or an eszett, so
  // they are drawn like any other letter. Without them a font cannot set
  // Danish, Norwegian, Icelandic or German, which is most of the point of
  // having the accented set at all.

  /** An A and an E sharing a stroke, which is what an ash is. */
  AE: (style) => {
    const f = frame(style);
    const apex = f.edge + f.capBowl * 0.62;
    const stem = apex;
    const reach = f.capBowl * 1.1;
    const [, low] = arms(f, f.cap);
    return finish(f, [
      // The A's one diagonal, from the foot out to the shared upright.
      ink(f, straight(at(f.edge, 0), at(apex, f.cap)), f.end, BUTT),
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      arm(f, stem, stem + reach, f.hangs(f.cap, f.bar)),
      arm(f, stem, stem + reach * 0.86, f.cap * f.style.parts.crossbar.height),
      arm(f, stem, stem + reach, f.sits(0, f.bar)),
      // The crossbar of the A half, which meets the diagonal partway down.
      thin(f, straight(at(f.edge + f.capBowl * 0.22, low), at(stem, low)), BUTT, BUTT),
    ]);
  },

  ae: (style) => {
    const f = frame(style);
    // Two bowls side by side in the room one and a bit would take, so the pair
    // reads as one letter rather than as an a that has run into an e.
    const bowl = Math.max(f.bowl * 0.68, f.least);
    const first = at(f.edge + bowl, f.x / 2);
    const second = at(first.x + bowl * 2, f.x / 2);

    // The e half, drawn the way the e itself is: the eye at whatever height the
    // crossbar says, and the bowl opened from where the circle reaches it.
    const eye = f.x * f.style.parts.crossbar.height;
    const rise = Math.max(-0.85, Math.min(0.85, (eye - second.y) / f.bowlH));
    const opens = (Math.asin(rise) * 180) / Math.PI;
    const belt = bend(f, second, f.bowlH, opens, opens + 300);

    return finish(
      f,
      [
        // Open at the top, where the a half runs into the e half. Closed, the
        // two read as an o and an e rather than as one letter.
        openBowl(f, first, bowl, f.bowlH, -80, 150),
        thin(f, straight(at(second.x - bowl + f.half, eye), spineStart(belt))),
        ink(f, belt, BUTT, f.end),
      ],
      true);
  },

  /** An O with a stroke through it, which is a letter in its own right. */
  Oslash: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.capBowl, f.cap / 2);
    const outX = f.capBowl + f.half * 1.1;
    const outY = f.capBowlH + f.half * 1.1;
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.capBowl, f.capBowlH)),
        ink(
          f,
          straight(at(centre.x - outX, centre.y - outY), at(centre.x + outX, centre.y + outY)),
          f.plain,
          f.plain,
        ),
      ],
      true);
  },

  oslash: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const outX = f.bowl + f.half * 1.1;
    const outY = f.bowlH + f.half * 1.1;
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        ink(
          f,
          straight(at(centre.x - outX, centre.y - outY), at(centre.x + outX, centre.y + outY)),
          f.plain,
          f.plain,
        ),
      ],
      true);
  },

  /** A D with a bar laid across its stem. */
  /*
   * The letters with a stroke through them, which is one idea six times over.
   *
   * A Polish l, a Croatian d, a Maltese h: the letter as it is already drawn,
   * with a short bar laid across its stem. Nothing about the letter changes, so
   * a face that squares its stems or leans them squares and leans these too,
   * and the bar is drawn with the same thin pen the crossbar of an H uses --
   * it is the same thing, in the same font, and should not be a second decision.
   *
   * Unicode gives none of them a decomposition, so unlike the hundred accented
   * letters these cannot be built out of parts and have to be drawn. They are
   * here rather than left out because a Polish that cannot set l is not Polish.
   */
  Lslash: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = f.capBowl * 1.05;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      arm(f, stem, stem + reach, f.sits(0, f.bar)),
      slash(f, stem, f.cap * 0.5),
    ]);
  },

  lslash: (style) => {
    const f = frame(style);
    return finish(f, [
      ink(f, straight(at(f.edge, 0), at(f.edge, f.asc)), f.end, f.end),
      slash(f, f.edge, f.asc * 0.55),
    ]);
  },

  /*
   * The same drawing as the Eth, which is what it is: two characters that
   * Unicode keeps apart because they are different letters in different
   * languages, and every font draws with one shape.
   */
  Dcroat: (style) => LETTERS.Eth(style),

  dcroat: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl + f.aside;
    const bar = f.x + (f.asc - f.x) * 0.55;
    return finish(f, [
      ink(f, ring(f, centre, f.bowl, f.bowlH)),
      ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
      thin(f, straight(at(stem - f.half * 2.2, bar), at(stem + f.half * 2.2, bar)), f.plain, f.plain),
    ]);
  },

  Hbar: (style) => {
    const f = frame(style);
    const left = f.edge;
    const right = left + f.style.metrics.counterWidth + f.style.pen.weight;
    const bar = f.cap * f.style.parts.crossbar.height;
    // Across both stems and out past the left of them, which is what tells an
    // H-bar from an H at a glance.
    const high = f.cap - (f.cap - bar) * 0.35;
    return finish(f, [
      ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
      ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
      thin(f, straight(at(left, bar), at(right, bar)), BUTT, BUTT),
      thin(
        f,
        straight(at(left - f.half * 2, high), at(right + f.half * 2, high)),
        f.plain,
        f.plain,
      ),
    ]);
  },

  hbar: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const bar = f.x + (f.asc - f.x) * 0.55;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
      arch(f, stem, f.x),
      thin(f, straight(at(stem - f.half * 2.2, bar), at(stem + f.half * 2.2, bar)), f.plain, f.plain),
    ]);
  },

  /*
   * The rest of Latin Extended-A: the thirteen characters with no decomposition
   * to build them from.
   *
   * Every one of these is a letter somebody's language needs and none of them
   * is a letter under a mark, so the loop that reads Unicode's decompositions
   * cannot reach any of them. French cannot set `coeur` without the first pair,
   * Catalan cannot set `paral*lel` without the third, and Northern Sami needs
   * the eng and the barred t as much as it needs the eth it already has.
   */

  /**
   * The French ligature, drawn as a bowl with a flat right side and an E hung
   * off it.
   *
   * Not an O and an E set close together: the two share one stroke, which is
   * the difference between a ligature and a pair. Built the way the Eth is and
   * facing the other way -- a straight upright with the bowl bulging left off
   * it -- so the arms of the E have something straight to leave from at all
   * three heights, which a round O does not offer.
   */
  OE: (style) => {
    const f = frame(style);
    const radius = Math.max((f.crest(f.cap) - f.dip(0)) / 2, f.least);
    const wide = Math.max(radius * f.wide * 0.88, f.least);
    const stem = f.edge + wide;
    const reach = f.capBowl * 1.05;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        belly(f, at(stem, f.cap / 2), wide, radius, 90, 270),
        arm(f, stem, stem + reach, f.hangs(f.cap, f.bar)),
        arm(f, stem, stem + reach * 0.86, f.cap * f.style.parts.crossbar.height),
        arm(f, stem, stem + reach, f.sits(0, f.bar)),
      ],
      true);
  },

  /**
   * The same ligature in lowercase, which is the ae with an o where the a is.
   *
   * Narrowed the same way and for the same reason: two bowls at their full
   * width read as two letters that have collided, and the pair has to read as
   * one letter with two counters.
   */
  oe: (style) => {
    const f = frame(style);
    const bowl = Math.max(f.bowl * 0.68, f.least);
    const first = at(f.edge + bowl, f.x / 2);
    const second = at(first.x + bowl * 2, f.x / 2);

    const eye = f.x * f.style.parts.crossbar.height;
    const rise = Math.max(-0.85, Math.min(0.85, (eye - second.y) / f.bowlH));
    const opens = (Math.asin(rise) * 180) / Math.PI;
    const belt = bend(f, second, f.bowlH, opens, opens + 300);

    return finish(
      f,
      [
        ink(f, ring(f, first, bowl, f.bowlH)),
        thin(f, straight(at(second.x - bowl + f.half, eye), spineStart(belt))),
        ink(f, belt, BUTT, f.end),
      ],
      true);
  },

  /**
   * The Dutch digraph, which is one character and two letters.
   *
   * Set tighter than two letters and looser than two stems, because it is
   * neither. A whole counter between them and the pair reads as an I and a J
   * that happen to be adjacent -- which is what it looked like set into a word,
   * where `Ĳsvogel` came out as `I Jsvogel`. The gap is measured off the
   * counter rather than off the pen, so it survives a display weight without
   * the J's hook ever reaching the I.
   */
  IJ: (style) => {
    const f = frame(style);
    const radius = Math.max(f.capBowl * 0.55, f.least);
    const apart = f.style.metrics.counterWidth * 0.55 + f.style.pen.weight;
    const first = f.edge;
    const stem = first + apart + radius;
    return finish(
      f,
      [
        ink(f, straight(at(first, 0), at(first, f.cap)), f.end, f.end),
        ink(
          f,
          chain(
            straight(at(stem, f.cap), at(stem, f.dip(0) + radius)),
            turn(at(stem - radius, f.dip(0) + radius), radius, 0, -90),
          ),
          f.end,
          f.end,
        ),
      ]);
  },

  ij: (style) => {
    const f = frame(style);
    const radius = Math.max(f.arch * 0.62, f.least);
    const apart = f.style.metrics.counterWidth * 0.55 + f.style.pen.weight;
    const first = f.edge;
    const stem = first + apart + radius;
    const dotUp = f.x + f.half * 1.5 + f.half * 0.55;
    return finish(
      f,
      [
        ink(f, straight(at(first, 0), at(first, f.x)), f.end, f.end),
        dot(f, at(first, dotUp), f.half * 0.55),
        ink(
          f,
          chain(
            straight(at(stem, f.x), at(stem, f.dip(f.desc) + radius)),
            turn(at(stem - radius, f.dip(f.desc) + radius), radius, 0, -95),
          ),
          f.end,
          f.end,
        ),
        dot(f, at(stem, dotUp), f.half * 0.55),
      ]);
  },

  /**
   * The eng, which Northern Sami and the phonetic alphabet both need.
   *
   * An n whose right leg carries on below the line and hooks back, drawn as one
   * run from the top of the shoulder so that the leg has no terminal in the
   * middle of it.
   */
  eng: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const landing = stem + f.arch * 2;
    const floor = f.dip(f.desc);
    /*
     * The hook takes whatever room is left under the shoulder, and none if
     * there is none.
     *
     * How far down the arch's own leg begins is not a number this letter knows:
     * a high springing leaves a large corner radius and starts the leg most of
     * the way down the x-height, and on a shallow descender with a heavy pen
     * there is then nothing below it to turn in. Asked for a fixed hook anyway,
     * the leg was told to run upwards to reach it and the letter folded over
     * itself. So the leg is drawn first, and the hook is the distance between
     * where it actually stopped and the descender -- which on a face with no
     * room is nothing, and a straight-legged eng is a real eng.
     */
    const leg = archSpine(f, stem, f.x, floor + Math.max(f.arch * 0.62, f.least));
    const room = spineEnd(leg).y - floor;
    /*
     * And where there is none, the hook is drawn standing still rather than not
     * drawn -- the same arrangement `tailBelow` makes for the tails of the
     * greek, and for the same reason. How much room is left under the leg is
     * the pen's business, so a hook left out outright is a letter drawn with
     * four nodes fewer at the weights that have no room for one: the Brush's
     * `eng` came back with fourteen pieces of outline at the Thin, the Regular
     * and the Bold and ten at the Black.
     *
     * A radius even when nothing is turned through it, because the sweep reads
     * an arc of no radius as nothing at all and drops it, where an arc of no
     * sweep is kept and takes its heading from the run before it. And the two
     * pieces ninety-five degrees needs, said rather than worked out, so the
     * stalled hook and the drawn one come to the same nodes.
     */
    const hooks = room > f.least;
    const radius = hooks ? room : f.least;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
        ink(
          f,
          chain(leg, {
            segments: [
              {
                kind: "arc",
                centre: at(landing - radius, spineEnd(leg).y),
                radius,
                startAngle: deg(0),
                endAngle: deg(hooks ? -95 : 0),
                sweepPositive: false,
                pieces: 2,
              },
            ],
            closed: false,
          }),
          BUTT,
          f.end,
        ),
      ]);
  },

  /** The capital, which is an N with the same leg on it. */
  Eng: (style) => {
    const f = frame(style);
    const left = f.edge;
    const right = left + f.capBowl * 1.35;
    const radius = Math.max(f.capBowl * 0.5, f.least);
    const into = stub(f);
    const start = at(left, f.cap - into);
    const end = at(right, into);
    const [top, foot] = corners(f, [start, at(left, f.cap), at(right, 0), end]);
    return finish(
      f,
      [
        ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
        ink(
          f,
          chain(
            straight(at(right, f.cap), at(right, f.dip(f.desc) + radius)),
            turn(at(right - radius, f.dip(f.desc) + radius), radius, 0, -95),
          ),
          f.end,
          f.end,
        ),
        ink(f, chain(straight(start, top), straight(top, foot), straight(foot, end))),
      ]);
  },

  /**
   * The Catalan geminated l: two of them with a dot between, which Unicode
   * gives one character apiece for the left half.
   *
   * The dot sits clear of the stem by a whole pen rather than by a hair, or a
   * heavy weight closes the gap and the pair reads as a thicker l.
   */
  Ldot: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = f.capBowl * 1.05;
    const radius = f.half * 0.62;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        arm(f, stem, stem + reach, f.sits(0, f.bar)),
        dot(f, at(stem + f.half * 2.8, f.cap * 0.45), radius),
      ]);
  },

  ldot: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = f.half * 0.62;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
        dot(f, at(stem + f.half * 2.8, f.x * 0.5), radius),
      ]);
  },

  /** The barred T, which Northern Sami needs beside the eth and the eng. */
  Tbar: (style) => {
    const f = frame(style);
    const half = f.capBowl * 0.95;
    const middle = f.edge + half;
    const bar = f.cap * 0.42;
    return finish(
      f,
      [
        ink(f, straight(at(middle, 0), at(middle, f.cap)), f.end, BUTT),
        thin(
          f,
          straight(
            at(middle - half, f.hangs(f.cap, f.bar)),
            at(middle + half, f.hangs(f.cap, f.bar)),
          ),
          f.end,
          f.end,
        ),
        thin(
          f,
          straight(at(middle - f.half * 2.4, bar), at(middle + f.half * 2.4, bar)),
          f.plain,
          f.plain,
        ),
      ]);
  },

  /*
   * And the lowercase, which is the t itself with a second bar low on the stem.
   *
   * Below the foot's turn rather than through it, or the bar and the foot are
   * one shape at a heavy weight and the letter reads as a t standing in a
   * puddle.
   */
  tbar: (style) => {
    const f = frame(style);
    const stem = tStem(f);
    const height = f.x * 0.38;
    return struck(
      LETTERS.t(style),
      thin(
        f,
        straight(at(stem - f.half * 2.2, height), at(stem + f.half * 2.2, height)),
        f.plain,
        f.plain,
      ),
    );
  },

  /**
   * The Greenlandic kra, which is a k with no ascender.
   *
   * Deprecated in 1973 and still in the block, so it is drawn: a character that
   * renders as an empty box is worse than one nobody types.
   */
  kgreenlandic: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = stem + f.arch * 1.7;
    const waist = f.x * 0.42;
    const arm = at(reach, f.x);
    const leg = at(reach, 0);
    const meet = junction(f, arm, stem, waist, leg);
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
        ink(f, chain(straight(arm, meet), straight(meet, leg)), f.end, f.end),
      ]);
  },

  /** An apostrophe and an n, which Afrikaans used to set as one character. */
  napostrophe: (style) => {
    const f = frame(style);
    const tick = f.edge;
    const stem = tick + f.half * 2 + f.arch * 0.5;
    return finish(
      f,
      [
        ink(f, straight(at(tick, f.asc * 0.72), at(tick, f.asc)), f.plain, f.plain),
        ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
        arch(f, stem, f.x),
      ]);
  },

  /**
   * The long s, which is an f with the right half of its bar taken off.
   *
   * The nub is what tells it from an l and from an integral sign both, so it
   * stays even on a face whose f has hardly any bar at all.
   */
  longs: (style) => {
    const f = frame(style);
    const radius = Math.max(f.arch * 0.66, f.least);
    const stem = f.edge + radius;
    return finish(
      f,
      [
        ink(
          f,
          chain(
            straight(at(stem, 0), at(stem, f.crest(f.asc) - radius)),
            turn(at(stem - radius, f.crest(f.asc) - radius), radius, 0, 92),
          ),
          f.end,
          f.end,
        ),
        thin(
          f,
          straight(at(stem - f.arch * 0.5, f.hangs(f.x, f.bar)), at(stem, f.hangs(f.x, f.bar))),
          f.end,
          BUTT,
        ),
      ]);
  },

  Eth: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = Math.max((f.crest(f.cap) - f.dip(0)) / 2, f.least);
    const bar = f.cap * f.style.parts.crossbar.height;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        belly(f, at(stem, f.cap / 2), radius * f.wide, radius, -90, 90),
        thin(f, straight(at(stem - f.half * 1.6, bar), at(stem + f.half * 2.2, bar)), f.plain, BUTT),
      ],
      true);
  },

  /** A bowl with a stroke rising off it, crossed by a bar. */
  eth: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const top = f.crest(f.asc);
    // Up and to the left, off the bowl's right shoulder.
    const from = at(centre.x + f.bowl * 0.8, f.x * 0.62);
    const to = at(centre.x - f.bowl * 0.35, top);
    // The bar lies across that stroke rather than flat, which is what tells an
    // eth from a d with something above it.
    const along = { x: to.x - from.x, y: to.y - from.y };
    const length = Math.max(Math.hypot(along.x, along.y), 1);
    const across = { x: -along.y / length, y: along.x / length };
    const middle = at(from.x + along.x * 0.5, from.y + along.y * 0.5);
    const reach = Math.max(f.bowl * 0.46, f.half * 1.4);
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        ink(f, straight(from, to), BUTT, f.plain),
        thin(
          f,
          straight(
            at(middle.x - across.x * reach, middle.y - across.y * reach),
            at(middle.x + across.x * reach, middle.y + across.y * reach),
          ),
          f.plain,
          f.plain,
        ),
      ],
      true);
  },

  /** A stem with the bowl in the middle rather than at the top. */
  Thorn: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = Math.max(f.cap * 0.22, f.least);
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        belly(f, at(stem, f.cap * 0.54), radius * f.wide, radius, -90, 90),
      ]);
  },

  thorn: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(
      f,
      [
        ink(f, straight(at(stem, f.dip(f.desc)), at(stem, f.asc)), f.end, f.end),
        ink(f, ring(f, at(stem + f.bowl, f.x / 2), f.bowl, f.bowlH)),
      ],
      true);
  },

  /**
   * The eszett: a tall stroke with a bowl over it and a second one below, the
   * lower of the two left open at its foot the way an eszett always is.
   */
  germandbls: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const top = f.crest(f.asc);
    const base = f.dip(0);
    const waist = base + (top - base) * 0.44;
    const upperR = Math.max((top - waist) / 2 + f.half * 0.2, f.least);
    const lowerR = Math.max((waist - base) / 2 + f.half * 0.2, f.least);
    const reach = Math.max(f.bowl * 0.86, f.least);
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, top - upperR)), f.end, BUTT),
        belly(f, at(stem, top - upperR), reach, upperR, -90, 90),
        // Opened at the bottom left rather than closed back onto the stem.
        belly(f, at(stem, base + lowerR), reach, lowerR, -35, 90),
      ]);
  },

  // -------------------------------------------------------------------------
  // The marks
  // -------------------------------------------------------------------------
  //
  // Drawn with the font's own pen, so an accent on a heavy face is heavy and an
  // accent on a slanted one leans with the letters. That is the whole reason
  // for drawing them here rather than shipping a set of fixed shapes: a tilde
  // that stayed the same while the face around it changed would look borrowed
  // from another font, which is exactly what it would be.
  //
  // Each one stands on its own above the x-height. Where it ends up on a letter
  // is settled later, by lining its foot up with the top of the letter it goes
  // on -- so these only have to be the right shape, not in the right place.

  grave: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    return finish(f, [
      ink(f, straight(at(m.cx - m.w, m.top), at(m.cx + m.w, m.foot)), shortEnd(f), shortEnd(f)),
    ]);
  },

  acute: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    return finish(f, [
      ink(f, straight(at(m.cx - m.w, m.foot), at(m.cx + m.w, m.top)), shortEnd(f), shortEnd(f)),
    ]);
  },

  circumflex: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    // One run with a corner in it rather than two strokes meeting, so the apex
    // is joined the way every other corner in the font is -- and rounds off
    // with them when the face asks for that.
    return finish(f, [
      ink(
        f,
        chain(
          straight(at(m.cx - m.w, m.foot), at(m.cx, m.top)),
          straight(at(m.cx, m.top), at(m.cx + m.w, m.foot)),
        ),
        shortEnd(f),
        shortEnd(f),
      ),
    ]);
  },

  caron: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    // The circumflex the other way up, which is what a caron is.
    return finish(f, [
      ink(
        f,
        chain(
          straight(at(m.cx - m.w, m.top), at(m.cx, m.foot)),
          straight(at(m.cx, m.foot), at(m.cx + m.w, m.top)),
        ),
        shortEnd(f),
        shortEnd(f),
      ),
    ]);
  },

  /*
   * A tilde: over a hump and down into a dip.
   *
   * Two half-turns that meet where both are heading straight down, so the wave
   * is tangent-continuous and the sweep has no kink in it. Circular, like
   * everything else here, which fixes the proportion: the run is four radii
   * across and two tall. That is a fair tilde and not an accident -- a flatter
   * one would have to be elliptical, and an ellipse does not offset to an
   * ellipse, so it would be the one shape in the font whose weight was
   * approximate.
   */
  tilde: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    const radius = Math.max(m.w / 2, f.least);
    const middle = (m.foot + m.top) / 2;
    return finish(f, [
      ink(
        f,
        chain(
          turn(at(m.cx - radius, middle), radius, 180, 0),
          turn(at(m.cx + radius, middle), radius, 180, 360),
        ),
        shortEnd(f),
        shortEnd(f),
      ),
    ]);
  },

  dieresis: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    const radius = f.half * 0.95;
    const height = m.foot + (m.top - m.foot) * 0.5;
    // Set apart by the width of the mark, so the pair reads as two dots rather
    // than as a smudge at a heavy weight or as two separate marks at a light one.
    return finish(f, [
      dot(f, at(m.cx - m.w * 0.5, height), radius),
      dot(f, at(m.cx + m.w * 0.5, height), radius),
    ]);
  },

  dotaccent: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    const radius = f.half * 0.95;
    return finish(f, [dot(f, at(m.cx, m.foot + (m.top - m.foot) * 0.5), radius)]);
  },

  macron: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    const height = m.foot + (m.top - m.foot) * 0.45;
    return finish(f, [
      ink(f, straight(at(m.cx - m.w, height), at(m.cx + m.w, height)), shortEnd(f), shortEnd(f)),
    ]);
  },

  ring: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    /*
     * Drawn lighter than the stems, and wide enough to have a hole in it.
     *
     * A ring is the one mark whose whole job is the white inside it, and a
     * small shape drawn with the font's full pen has almost none: at a text
     * weight it came out a disc with a pinhole. Lightening the pen is what a
     * designer does here, and it is what every face with an angstrom in it
     * does.
     *
     * As round as the face is, though. A technical font squares its bowls, and
     * the ring on an angstrom is a bowl like any other.
     */
    const pen = { ...f.style.pen, weight: f.style.pen.weight * 0.62 };
    /*
     * Held inside the mark box like every other mark, but never turned tighter
     * than the pen drawing it. Taken from the width alone it outgrew the box on
     * a wide face and put the ring of an Aring half an em over the cap line;
     * held to the box alone it closed up, because what a ring is is the white
     * inside it and there was almost none left.
     */
    const radius = Math.max(
      Math.min(m.w * 0.82, (m.top - m.foot) / 2),
      pen.weight,
    );
    const centre = at(m.cx, m.foot + radius + pen.weight / 2);
    return finish(f, [{ spine: ring(f, centre, radius), pen, start: BUTT, end: BUTT }], true);
  },

  breve: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    // A cup: the bottom half of a turn, opening upwards. Lighter than the
    // stems for the same reason the ring is -- what it is is the curve, and a
    // full-weight pen on a shape this small fills the curve in.
    const pen = { ...f.style.pen, weight: f.style.pen.weight * 0.82 };
    const radius = Math.max(Math.min(m.w * 0.9, m.top - m.foot), pen.weight * 0.7);
    return finish(f, [
      { spine: turn(at(m.cx, m.top), radius, 180, 360), pen, start: BUTT, end: BUTT },
    ]);
  },

  /*
   * Two acutes side by side, which is what a double acute is.
   *
   * Hungarian's own accent, and Unicode calls it by that name. Drawn as two
   * of the acute already here rather than as its own shape, at the same slope,
   * so a face that gives its accents a flatter angle gives this one the same
   * flatter angle. Narrower than one acute each, or the pair reaches half again
   * as wide as every other mark in the font and an o with one on stops looking
   * like the o beside it.
   */
  hungarumlaut: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    const wide = m.w * 0.44;
    const apart = m.w * 0.62;
    return finish(
      f,
      [-1, 1].map((side) =>
        ink(
          f,
          straight(
            at(m.cx + side * apart - wide, m.foot),
            at(m.cx + side * apart + wide, m.top),
          ),
          shortEnd(f),
          shortEnd(f),
        ),
      ),
    );
  },

  /*
   * An ogonek: the little tail under a Polish a.
   *
   * The cedilla pointed the other way, and that is not a shortcut -- it is
   * what the two are. One hooks away from the letter to the left and the other
   * to the right, and everything else about them is the same decision: how far
   * below the foot they hang, how tight the turn is, how the end is cut. Built
   * from the same run so a face that squares its cedilla squares this too.
   */
  ogonek: (style) => hook(style, 1),

  /*
   * A comma below, which is not a cedilla however often it is set as one.
   *
   * Latvian and Romanian want a comma under the letter, and Unicode gives
   * those letters the cedilla in their decomposition anyway -- which is a
   * fact about the encoding rather than about the shape, and is why the glyphs
   * are named `commaaccent` and not `cedilla`. Set with a cedilla they are
   * wrong in the way that a reader of the language notices and nobody else
   * does.
   *
   * The comma already drawn, turned upside down and hung under the letter,
   * because that is what a comma below is.
   */
  commaaccent: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    /*
     * Hung as deep as the cedilla and no deeper. Sized against the x-height
     * and the pen, as the cedilla is, rather than against the descender, which
     * a face may set to almost nothing -- and reaching a fixed number of its
     * own widths below the line put a Sans gcommaaccent eighty units under the
     * descender, which is a letter that hangs out of its own line.
     */
    const drop = Math.max(f.x * 0.15, f.least) * 2;
    const radius = Math.max(f.half * 0.8, f.least * 0.5);
    const top = at(m.cx + radius * 0.4, -radius * 0.2);
    return finish(f, [
      {
        spine: straight(top, at(top.x - radius * 0.5, -drop)),
        pen: { ...f.style.pen, contrast: 0, weight: radius * 1.7 },
        start: { kind: "round" },
        end: { kind: "round" },
      },
    ]);
  },

  /*
   * The comma the other way up, sitting over the letter.
   *
   * For the g and nothing else. A comma below goes below, except on a letter
   * that is already using the room below -- and the only one of those that
   * takes the mark is the g, whose descender reaches the bottom of the line
   * before the mark has started. Every font that has a ģ puts the comma over
   * it instead, turned, and this is that.
   */
  commaturnedabove: (style) => {
    const f = markFrame(style);
    const m = markBox(f);
    const radius = Math.max(f.half * 0.8, f.least * 0.5);
    const foot = at(m.cx - radius * 0.4, m.foot + radius * 0.2);
    return finish(f, [
      {
        spine: straight(foot, at(foot.x + radius * 0.5, m.foot + (m.top - m.foot) * 0.9)),
        pen: { ...f.style.pen, contrast: 0, weight: radius * 1.7 },
        start: { kind: "round" },
        end: { kind: "round" },
      },
    ]);
  },

  /*
   * A cedilla, which hangs under the letter rather than sitting over it.
   *
   * Drawn below the baseline for the same reason the others are drawn above the
   * x-height: it is put where it belongs afterwards, by lining its head up with
   * the foot of the letter, so what matters here is only its shape.
   */
  cedilla: (style) => hook(style, -1),

  // --- Cyrillic ----------------------------------------------------------

  /*
   * The third alphabet, and the one where the lowercase is the capitals again.
   *
   * A Cyrillic `н` is an `Н` the height of an `n`; a `т` is a `Т`; a `п`, a
   * `м`, a `ш`, a `ц`, a `ь` and a dozen more are the same letter twice at two
   * sizes. So each shape is written once against a height, up in the helpers,
   * and asked for at the cap height and at the x-height -- which is not a
   * saving, it is the alphabet: drawn separately the two cases would drift
   * apart, and in Cyrillic that is a fault a reader sees at once.
   *
   * Twenty-four characters are drawings this font already had. Eleven capitals
   * are Latin capitals, three are Greek ones, and ten lowercase are Latin
   * lowercase -- and the `к`, which is the k with no ascender that Greenlandic
   * asked for and Greek asked for again.
   */

  "\u0411": (style) => finish(frame(style), cyrBe(frame(style), frame(style).cap)),
  "\u0414": (style) => finish(frame(style), cyrDe(frame(style), frame(style).cap)),
  "\u0416": (style) => finish(frame(style), cyrZhe(frame(style), frame(style).cap)),
  "\u0417": (style) => finish(frame(style), cyrZe(frame(style), frame(style).cap), true),
  "\u0418": (style) => finish(frame(style), cyrI(frame(style), frame(style).cap)),
  "\u041b": (style) => finish(frame(style), cyrEl(frame(style), frame(style).cap)),
  "\u0423": (style) => finish(frame(style), cyrU(frame(style), frame(style).cap)),
  "\u0426": (style) => finish(frame(style), cyrTse(frame(style), frame(style).cap)),
  "\u0427": (style) => finish(frame(style), cyrChe(frame(style), frame(style).cap)),
  "\u0428": (style) => finish(frame(style), cyrSha(frame(style), frame(style).cap)),
  "\u0429": (style) => finish(frame(style), cyrShcha(frame(style), frame(style).cap)),
  "\u042a": (style) => finish(frame(style), cyrHard(frame(style), frame(style).cap), true),
  "\u042b": (style) => finish(frame(style), cyrYeru(frame(style), frame(style).cap), true),
  "\u042c": (style) => finish(frame(style), cyrSoft(frame(style), frame(style).cap), true),
  "\u042d": (style) => finish(frame(style), cyrE(frame(style), frame(style).cap), true),
  "\u042e": (style) => finish(frame(style), cyrYu(frame(style), frame(style).cap), true),
  "\u042f": (style) => finish(frame(style), cyrYa(frame(style), frame(style).cap), true),

  /** A bowl with a curl over the top of it, which is not a small hard sign. */
  "\u0431": (style) => {
    const f = frame(style);
    const radius = Math.max(f.x * 0.37, f.least);
    const wide = bendWidth(f, radius);
    const centre = at(f.edge + wide, radius);
    return finish(
      f,
      [
        ink(f, ring(f, centre, wide, radius)),
        ink(
          f,
          chain(
            straight(at(centre.x - wide * 0.15, f.crest(f.asc)), at(centre.x + wide * 0.3, f.crest(f.asc))),
            straight(at(centre.x + wide * 0.3, f.crest(f.asc)), at(centre.x - wide * 0.55, radius * 1.5)),
          ),
          f.end,
          BUTT,
        ),
      ],
      true);
  },

  "\u0432": (style) => finish(frame(style), cyrVe(frame(style), frame(style).x), true),
  "\u0433": (style) => finish(frame(style), cyrGe(frame(style), frame(style).x)),
  "\u0434": (style) => finish(frame(style), cyrDe(frame(style), frame(style).x)),
  "\u0436": (style) => finish(frame(style), cyrZhe(frame(style), frame(style).x)),
  "\u0437": (style) => finish(frame(style), cyrZe(frame(style), frame(style).x), true),
  "\u0438": (style) => finish(frame(style), cyrI(frame(style), frame(style).x)),
  "\u043b": (style) => finish(frame(style), cyrEl(frame(style), frame(style).x)),
  "\u043c": (style) => finish(frame(style), cyrEm(frame(style), frame(style).x)),
  "\u043d": (style) => finish(frame(style), cyrEn(frame(style), frame(style).x)),
  "\u043f": (style) => finish(frame(style), cyrPe(frame(style), frame(style).x)),
  "\u0442": (style) => finish(frame(style), cyrTe(frame(style), frame(style).x)),
  "\u0446": (style) => finish(frame(style), cyrTse(frame(style), frame(style).x)),
  "\u0447": (style) => finish(frame(style), cyrChe(frame(style), frame(style).x)),
  "\u0448": (style) => finish(frame(style), cyrSha(frame(style), frame(style).x)),
  "\u0449": (style) => finish(frame(style), cyrShcha(frame(style), frame(style).x)),
  "\u044a": (style) => finish(frame(style), cyrHard(frame(style), frame(style).x), true),
  "\u044b": (style) => finish(frame(style), cyrYeru(frame(style), frame(style).x), true),
  "\u044c": (style) => finish(frame(style), cyrSoft(frame(style), frame(style).x), true),
  "\u044d": (style) => finish(frame(style), cyrE(frame(style), frame(style).x), true),
  "\u044e": (style) => finish(frame(style), cyrYu(frame(style), frame(style).x), true),
  "\u044f": (style) => finish(frame(style), cyrYa(frame(style), frame(style).x), true),

  /*
   * And the twelve the other Cyrillic languages want.
   *
   * Serbian and Macedonian write letters Russian does not, and two of them --
   * the lje and the nje -- are a letter tied to a soft sign, which is exactly
   * how they are built here: the shapes are already written down, so the
   * letters are a bar between two of them.
   */
  "\u0402": (style) => finish(frame(style), cyrDje(frame(style), frame(style).cap), true),
  "\u0404": (style) => finish(frame(style), cyrIe(frame(style), frame(style).cap), true),
  "\u0409": (style) => finish(frame(style), cyrLje(frame(style), frame(style).cap), true),
  "\u040a": (style) => finish(frame(style), cyrNje(frame(style), frame(style).cap), true),
  "\u040b": (style) => finish(frame(style), cyrTshe(frame(style), frame(style).cap), true),
  "\u040f": (style) => finish(frame(style), cyrDzhe(frame(style), frame(style).cap)),
  "\u0452": (style) => finish(frame(style), cyrDje(frame(style), frame(style).x), true),
  "\u0454": (style) => finish(frame(style), cyrIe(frame(style), frame(style).x), true),
  "\u0459": (style) => finish(frame(style), cyrLje(frame(style), frame(style).x), true),
  "\u045a": (style) => finish(frame(style), cyrNje(frame(style), frame(style).x), true),
  "\u045b": (style) => finish(frame(style), cyrTshe(frame(style), frame(style).x), true),
  "\u045f": (style) => finish(frame(style), cyrDzhe(frame(style), frame(style).x)),

  /** Ukrainian's ghe, which Unicode keeps out on its own two blocks later. */
  "\u0490": (style) => finish(frame(style), cyrGheUpturn(frame(style), frame(style).cap)),
  "\u0491": (style) => finish(frame(style), cyrGheUpturn(frame(style), frame(style).x)),

  // --- Greek capitals ----------------------------------------------------

  /*
   * The ten that are not already here.
   *
   * Fourteen of the twenty-four Greek capitals are Latin capitals -- an alpha
   * is an A, a beta is a B -- and they are pointed at the drawings that already
   * exist rather than drawn again. What is below is the rest, and every one of
   * them is built out of the same parts the Latin capitals are: the stem, the
   * arm, the bowl, the diagonal, the vee. That is the whole claim of this half
   * of the application, and a second alphabet is where it is either true or
   * obviously not.
   */

  /** A stem with one arm, which is an F that stopped after the first. */
  "\u0393": (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      arm(f, stem, stem + f.capBowl * 1.05, f.hangs(f.cap, f.bar)),
    ]);
  },

  /** A triangle: the A's two diagonals, closed along the baseline. */
  "\u0394": (style) => {
    const f = frame(style);
    const half = Math.max(f.capBowl * 0.95, f.least);
    const left = f.edge;
    const middle = left + half;
    const foot = at(left, 0);
    const other = at(middle + half, 0);
    const peak = corner(f, foot, at(middle, f.cap), other);
    return finish(f, [
      ink(f, chain(straight(foot, peak), straight(peak, other)), BUTT, BUTT),
      ink(f, straight(at(left, f.sits(0)), at(middle + half, f.sits(0))), f.end, f.end),
    ]);
  },

  /** An O with a bar across the middle of it. */
  "\u0398": (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.capBowl, f.cap / 2);
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.capBowl, f.capBowlH)),
        thin(
          f,
          straight(at(centre.x - f.capBowl, centre.y), at(centre.x + f.capBowl, centre.y)),
          BUTT,
          BUTT,
        ),
      ],
      true);
  },

  /** The A without its crossbar, which is what a lambda is. */
  "\u039b": (style) => {
    const f = frame(style);
    const half = Math.max(f.capBowl * 0.86, f.least);
    const left = f.edge;
    const middle = left + half;
    const foot = at(left, 0);
    const other = at(middle + half, 0);
    const peak = corner(f, foot, at(middle, f.cap), other);
    return finish(f, [
      ink(f, chain(straight(foot, peak), straight(peak, other)), f.end, f.end),
    ]);
  },

  /** Three bars and no stem, the middle one held in at both ends. */
  "\u039e": (style) => {
    const f = frame(style);
    const left = f.edge;
    const reach = f.capBowl * 1.6;
    const inset = reach * 0.13;
    const middle = f.cap * f.style.parts.crossbar.height;
    return finish(f, [
      thin(f, straight(at(left, f.hangs(f.cap, f.bar)), at(left + reach, f.hangs(f.cap, f.bar))), f.end, f.end),
      thin(f, straight(at(left + inset, middle), at(left + reach - inset, middle)), f.end, f.end),
      thin(f, straight(at(left, f.sits(0, f.bar)), at(left + reach, f.sits(0, f.bar))), f.end, f.end),
    ]);
  },

  /** Two stems under one bar: an n at cap height with nothing rounded. */
  "\u03a0": (style) => {
    const f = frame(style);
    const left = f.edge;
    const right = left + f.style.metrics.counterWidth + f.style.pen.weight;
    return finish(f, [
      ink(f, straight(at(left, 0), at(left, f.cap)), f.end, BUTT),
      ink(f, straight(at(right, 0), at(right, f.cap)), f.end, BUTT),
      thin(f, straight(at(left, f.hangs(f.cap, f.bar)), at(right, f.hangs(f.cap, f.bar))), BUTT, BUTT),
    ]);
  },

  /*
   * One run, folded twice.
   *
   * Along the top, back down to the waist, out again to the foot, and along the
   * bottom -- four straights and three corners, which is what the N already
   * does with three and two. Drawn as separate strokes the two folds would each
   * need their own end and the wedges between them would be left open, which is
   * the fault the diagonals of the alphabet had before they were chained.
   */
  "\u03a3": (style) => {
    const f = frame(style);
    const left = f.edge;
    /*
     * Two bars and a chevron, rather than one run folded three times.
     *
     * A sigma has three corners where a Z has one, and they pull against each
     * other: opening the waist steepens the diagonals, which closes the two
     * corners the bars make with them, and there is a setting -- five hundred
     * units of cap height under a pen of two hundred and sixty, which the
     * panel offers -- where no waist satisfies all three and the run doubles
     * back through itself. Split, the chevron has one corner to satisfy, which
     * is what a V has, and the bars lie over its ends.
     */
    const reach = Math.max(f.capBowl * 1.5, f.half * 4);
    const right = left + reach;
    const top = f.hangs(f.cap, f.bar);
    const bottom = f.sits(0, f.bar);
    const inset = Math.min(Math.max(reach * 0.42, f.half * 2.4), reach * 0.72);
    const head = at(left, top);
    const heel = at(left, bottom);
    const waist = corner(f, head, at(left + inset, f.cap / 2), heel);
    return finish(f, [
      thin(f, straight(at(right, top), head), f.end, BUTT),
      ink(f, chain(straight(head, waist), straight(waist, heel)), BUTT, BUTT),
      thin(f, straight(heel, at(right, bottom)), BUTT, f.end),
    ]);
  },

  /** A stem straight through a bowl, out at the top and out at the bottom. */
  "\u03a6": (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.capBowl, f.cap / 2);
    const height = Math.max(f.capBowlH * 0.76, f.least);
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.capBowl, height)),
        ink(f, straight(at(centre.x, 0), at(centre.x, f.cap)), f.end, f.end),
      ],
      true);
  },

  /** A stem with a trough sitting on it, which is a u drawn at cap height. */
  "\u03a8": (style) => {
    const f = frame(style);
    const half = Math.max(f.capBowl * 0.92, f.least);
    const left = f.edge;
    const right = left + half * 2;
    const middle = left + half;
    const floor = f.cap * 0.34;
    const radius = Math.max(Math.min(half, (f.cap - floor) * 0.55), f.least);
    return finish(f, [
      ink(
        f,
        chain(
          straight(at(left, f.cap), at(left, floor + radius)),
          turn(at(left + radius, floor + radius), radius, 180, 270),
          straight(at(left + radius, floor), at(right - radius, floor)),
          turn(at(right - radius, floor + radius), radius, 270, 360),
          straight(at(right, floor + radius), at(right, f.cap)),
        ),
        f.end,
        f.end,
      ),
      ink(f, straight(at(middle, 0), at(middle, f.cap)), f.end, BUTT),
    ]);
  },

  // --- Greek lowercase ---------------------------------------------------

  /*
   * The other alphabet, and the one that is really a second alphabet.
   *
   * The capitals are Latin capitals with ten additions. The lowercase is not:
   * only the omicron is a Latin letter, and the rho and the kappa are shapes
   * this font already had under other names. Everything else is drawn, out of
   * the same bowls, arches, troughs and diagonals -- which is the test. A part
   * system that only reaches the alphabet it was designed against is a set of
   * twenty-six special cases wearing a coat.
   */

  /** A bowl with a straight on its right: the single-storey a, which is what an alpha is. */
  "\u03b1": (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl + f.aside;
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
      ],
      true);
  },

  /** A stem from the descender to the ascender with two bowls hung off it. */
  "\u03b2": (style) => {
    const f = frame(style);
    const stem = f.edge;
    // Both bowls inside the x-height, the lower a little larger than the upper,
    // with only the stem reaching the ascender above and the descender below.
    const upper = Math.max(f.x * 0.26, f.least);
    const lower = Math.max(f.x * 0.3, f.least);
    return finish(
      f,
      [
        ink(f, straight(at(stem, f.desc), at(stem, f.asc)), f.end, f.end),
        belly(f, at(stem, f.x - upper), upper * f.wide, upper, -90, 90),
        belly(f, at(stem, lower), lower * f.wide, lower, -90, 90),
      ],
      true);
  },

  /** The y's vee, with the tail run straight rather than curled. */
  "\u03b3": (style) => {
    const f = frame(style);
    const half = f.arch * 0.86;
    const left = f.edge;
    const middle = left + half;
    const past = f.half * 1.1;
    const drop = past / Math.hypot(1, f.x / half);
    return finish(f, [
      ink(f, straight(at(left, f.x), at(middle + (drop * half) / f.x, -drop)), f.end, BUTT),
      ink(
        f,
        straight(at(middle + half, f.x), at(middle + (half * f.desc) / f.x, f.desc)),
        f.end,
        f.end,
      ),
    ]);
  },

  /** A bowl with a curl rising off the top of it and leaning back. */
  "\u03b4": (style) => {
    const f = frame(style);
    const radius = Math.max(f.x * 0.37, f.least);
    const wide = bendWidth(f, radius);
    const centre = at(f.edge + wide, radius);
    /*
     * The curl laid over the bowl rather than run into it.
     *
     * Chained, the two have to agree about direction where they meet, and a
     * curl coming down into the top of a bowl meets a bowl setting off back up
     * the way the curl came: a hundred and seventy-five degrees of turn in one
     * join, which is a stroke doubled over itself, and the delta folded at
     * every squareness there is. Two strokes that overlap cannot do that, and
     * where they overlap is inside the ink of both.
     */
    const tip = at(f.edge + wide * 0.2, f.x * 1.26);
    const into = at(centre.x + wide * 0.66, centre.y + radius * 0.58);
    return finish(
      f,
      [ink(f, ring(f, centre, wide, radius)), ink(f, straight(tip, into), f.end, BUTT)],
      true);
  },

  /*
   * Two arcs bulging left, joined where they meet.
   *
   * Joined outright rather than left to overlap, because how far they overlap
   * depends on the pen: at a display weight they fuse into a shape with no
   * waist and at a hairline they do not touch at all, and an epsilon in two
   * pieces is not an epsilon.
   */
  "\u03b5": (style) => {
    const f = frame(style);
    const radius = Math.max(f.x * 0.26, f.least);
    const wide = bendWidth(f, radius);
    const cx = f.edge + wide;
    const top = bend(f, at(cx, f.x - radius), radius, 55, 300);
    const bottom = bend(f, at(cx, radius), radius, 60, 305);
    return finish(f, [ink(f, top, f.end, BUTT), ink(f, bottom, BUTT, f.end)], true);
  },

  /** A bar, a diagonal back under it, and a tail into the descender. */
  "\u03b6": (style) => {
    const f = frame(style);
    const left = f.edge;
    const reach = f.arch * 1.25;
    const top = f.hangs(f.x, f.bar);
    const heel = at(left + reach * 0.32, f.sits(0, f.bar));
    const [fold] = corners(f, [at(left, top), at(left + reach, top), heel]);
    /*
     * The tail is its own stroke, not the end of the run above it.
     *
     * Chained on, the diagonal arrives at the baseline going down and left and
     * the hook sets off going down and right, and on a shallow descender with a
     * hairline pen the turn between them closes far enough to double the stroke
     * back through itself. Two strokes that overlap cannot do that, and where
     * they overlap is inside the ink of both.
     */
    return finish(f, [
      ink(f, chain(straight(at(left, top), fold), straight(fold, heel)), f.end, BUTT),
      tailBelow(f, heel.x, f.x * 0.34),
    ]);
  },

  /** An n whose right leg carries straight on below the line. */
  "\u03b7": (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
      ink(f, archSpine(f, stem, f.x, f.dip(f.desc)), BUTT, f.end),
    ]);
  },

  /** A tall narrow oval with a bar across it. */
  "\u03b8": (style) => {
    const f = frame(style);
    const height = Math.max(f.asc / 2, f.least);
    const wide = Math.max(f.bowl * 0.78, f.least);
    const centre = at(f.edge + wide, height);
    return finish(
      f,
      [
        ink(f, ring(f, centre, wide, height)),
        thin(f, straight(at(centre.x - wide, height), at(centre.x + wide, height)), BUTT, BUTT),
      ],
      true);
  },

  /** A stroke of its own height and nothing else. */
  "\u03b9": (style) => {
    const f = frame(style);
    return finish(f, [ink(f, straight(at(f.edge, 0), at(f.edge, f.x)), f.end, f.end)]);
  },

  /** An apex near the top, a long leg down one way and a short one the other. */
  "\u03bb": (style) => {
    const f = frame(style);
    const half = f.arch * 0.92;
    const left = f.edge;
    const peak = at(left + half * 0.72, f.asc);
    const foot = at(left + half * 2, 0);
    const branch = at(left + half * 0.34, f.x * 0.46);
    return finish(f, [
      ink(f, straight(peak, foot), f.end, f.end),
      ink(f, straight(branch, at(left, 0)), BUTT, f.end),
    ]);
  },

  /** A u with its left stem carried down into the descender. */
  "\u03bc": (style) => {
    const f = frame(style);
    return finish(f, [
      trough(f, f.edge, f.x),
      ink(f, straight(at(f.edge, f.desc), at(f.edge, f.x)), f.end, f.end),
    ]);
  },

  /** The v, drawn a little narrower and standing a little straighter. */
  "\u03bd": (style) => {
    const f = frame(style);
    const half = f.arch * 0.82;
    const left = f.edge;
    const middle = left + half;
    const top = at(left, f.x);
    const other = at(middle + half, f.x);
    const point = corner(f, top, at(middle + half * 0.18, 0), other);
    return finish(f, [
      ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end),
    ]);
  },

  /** The zeta with a curl over the top of it. */
  "\u03be": (style) => {
    const f = frame(style);
    const left = f.edge;
    const reach = f.arch * 1.25;
    const cap = Math.max(f.arch * 0.3, f.least);
    const bar = f.x * 0.56;
    const heel = at(left + reach * 0.34, f.sits(0, f.bar));
    /*
     * Five strokes and not one chain.
     *
     * A xi is a curl, a bar and a tail, and every join between them is close to
     * a doubling-back: the bar runs right and the diagonal under it runs down
     * and left at sixty degrees, which at a display weight is past what a mitre
     * can be carried to. Chained, it folded. Laid over each other they cannot,
     * and each overlap is well inside the ink of both.
     */
    const curl = bend(f, at(left + bendWidth(f, cap) * 1.2, f.crest(f.asc) - cap), cap, -25, 195);
    return finish(f, [
      ink(f, curl, f.end, BUTT),
      ink(f, straight(spineEnd(curl), at(left + reach * 0.26, bar)), BUTT, BUTT),
      thin(f, straight(at(left + reach * 0.16, bar), at(left + reach * 0.94, bar)), BUTT, f.end),
      ink(f, straight(at(left + reach * 0.9, bar), heel), BUTT, BUTT),
      tailBelow(f, heel.x, f.x * 0.34),
    ]);
  },

  /** Two legs under one bar, and the bar reaches past both of them. */
  "\u03c0": (style) => {
    const f = frame(style);
    const left = f.edge;
    const right = left + f.arch * 1.5;
    const over = f.half * 0.9;
    const bar = f.hangs(f.x, f.bar);
    return finish(f, [
      ink(f, straight(at(left, 0), at(left, f.x)), f.end, BUTT),
      ink(f, straight(at(right, 0), at(right, f.x)), f.end, BUTT),
      thin(f, straight(at(left - over, bar), at(right + over, bar)), f.plain, f.plain),
    ]);
  },

  /** A c with its tail run on down into the descender. */
  "\u03c2": (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    // Open at the top right rather than at the side, because the tail leaves
    // from the bottom right and the two cannot be the same corner.
    const loop = openBowl(f, centre, f.bowl, f.bowlH, 60, 335);
    const from = spineEnd(loop.spine);
    // The tail is its own stroke, for the reason the zeta's is.
    return finish(
      f,
      [
        loop,
        tailBelow(f, from.x, from.y + f.bowlH * 0.3),
      ],
      true);
  },

  /** A bowl with a bar running off the top of it to the right. */
  "\u03c3": (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const bar = f.hangs(f.x, f.bar);
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        thin(f, straight(at(centre.x, bar), at(centre.x + f.bowl + f.arch * 0.5, bar)), BUTT, f.end),
      ],
      true);
  },

  /** A small t with no ascender and no foot: a stem under a bar. */
  "\u03c4": (style) => {
    const f = frame(style);
    const reach = f.arch * 0.72;
    const middle = f.edge + reach;
    const bar = f.hangs(f.x, f.bar);
    return finish(f, [
      ink(f, straight(at(middle, 0), at(middle, f.x)), f.end, BUTT),
      thin(f, straight(at(middle - reach, bar), at(middle + reach, bar)), f.end, f.end),
    ]);
  },

  /** The u, which is what an upsilon is. */
  "\u03c5": (style) => {
    const f = frame(style);
    return finish(f, [trough(f, f.edge, f.x)]);
  },

  /** A bowl with a stroke straight through it, out at both ends. */
  "\u03c6": (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        ink(f, straight(at(centre.x, f.desc), at(centre.x, f.asc)), f.end, f.end),
      ],
      true);
  },

  /** The x, with both strokes carried on below the line. */
  "\u03c7": (style) => {
    const f = frame(style);
    const width = f.arch * 1.7;
    const left = f.edge;
    const lean = (width * -f.desc) / f.x;
    return finish(f, [
      ink(f, straight(at(left, f.x), at(left + width + lean, f.desc)), f.end, f.end),
      ink(f, straight(at(left, f.desc), at(left + width + lean, f.x)), f.end, f.end),
    ]);
  },

  /** The trough of a psi, with its stem carried into the descender. */
  "\u03c8": (style) => {
    const f = frame(style);
    const half = Math.max(f.arch * 0.86, f.least);
    const left = f.edge;
    const right = left + half * 2;
    const middle = left + half;
    const floor = f.x * 0.3;
    const radius = Math.max(Math.min(half, (f.x - floor) * 0.55), f.least);
    return finish(f, [
      ink(
        f,
        chain(
          straight(at(left, f.x), at(left, floor + radius)),
          turn(at(left + radius, floor + radius), radius, 180, 270),
          straight(at(left + radius, floor), at(right - radius, floor)),
          turn(at(right - radius, floor + radius), radius, 270, 360),
          straight(at(right, floor + radius), at(right, f.x)),
        ),
        f.end,
        f.end,
      ),
      ink(f, straight(at(middle, f.desc), at(middle, f.x)), f.end, BUTT),
    ]);
  },

  /** Two troughs side by side, which is what an omega is. */
  "\u03c9": (style) => {
    const f = frame(style);
    const wide = f.arch * 0.82;
    const left = f.edge;
    return finish(f, [
      trough(f, left, f.x),
      trough(f, left + wide, f.x),
    ]);
  },

  /*
   * A bowl standing on two feet, open between them.
   *
   * The feet are taken off the bowl's own ends rather than measured from the
   * baseline, so a squared face squares the omega with everything else and the
   * feet still start where the curve stops.
   *
   * The bowl is open a third of the way round. Drawn open only eighty degrees
   * the two ends came within a pen of each other and the letter read as a
   * lollipop -- the gap between the feet is what says omega, and it has to be
   * wide enough to be a gap rather than a join that did not quite happen.
   */
  "\u03a9": (style) => {
    const f = frame(style);
    const radius = Math.max(f.capBowlH * 0.84, f.least);
    const wide = bendWidth(f, radius);
    const centre = at(f.edge + wide, f.cap - radius);
    const loop = bend(f, centre, radius, -30, 210);
    const toe = wide * 0.62;
    const foot = (from: Vec2, way: number): Stroke => {
      const tip = at(from.x + way * toe, f.sits(0, f.bar));
      const knee = corner(f, from, at(from.x, tip.y), tip);
      return ink(f, chain(straight(from, knee), straight(knee, tip)), BUTT, f.end);
    };
    return finish(
      f,
      [
        ink(f, loop, BUTT, BUTT),
        foot(spineStart(loop), 1),
        foot(spineEnd(loop), -1),
      ],
      true);
  },
};

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
function hook(style: Style, side: number): Recipe {
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
function figureWidth(frame: Frame): number {
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
function axis(f: Frame): number {
  return f.x * 0.46;
}

/**
 * How wide a sign is drawn.
 *
 * From the figures, so a column of sums lines up under the numbers it is about.
 * A little inside their width, because a figure fills its advance and a sign
 * wants air around it.
 */
function signWidth(f: Frame): number {
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
function tall(f: Frame): { foot: number; head: number } {
  return { foot: f.desc, head: f.asc };
}

/** Half the width of a bar, which is what the signs drawn as bars turn at. */
function barHalf(f: Frame): number {
  return (f.style.pen.weight * f.bar) / 2;
}

/**
 * Half the daylight between the two bars of an equals sign.
 *
 * A share of the bar drawing them rather than a fixed distance: at a display
 * weight a gap of a few units is no gap, and the two bars fuse into one.
 */
function signGap(f: Frame): number {
  return Math.max(f.style.pen.weight * f.bar * 1.15, f.x * 0.075);
}

/**
 * A symbol built out of a letter this font already draws.
 *
 * The borrowed strokes arrive finished -- that letter's own recipe has already
 * pulled its round ends back -- so what the builder adds is what goes through
 * `finish`, and `joined` below is how the two halves are put together.
 */
function outOf(
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
function joined(f: Frame, done: Stroke[], fresh: Stroke[], round = false): Recipe {
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
function sized(style: Style, fraction: number, penShare = fraction ** 0.62): Style {
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
function spread(strokes: Stroke[]): { xMin: number; xMax: number; yMin: number; yMax: number } {
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
function passesThrough(angle: number, from: number, to: number): boolean {
  const whole = Math.PI * 2;
  const span = to - from;
  const along = (((angle - from) % whole) + whole) % whole;
  return span >= 0 ? along <= span : along - whole >= span;
}

/** The same run somewhere else on the page. */
function shoveSpine(spine: Spine, dx: number, dy: number): Spine {
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
function turnSpine(spine: Spine, about: Vec2): Spine {
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
function shovedStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  return inherit(stroke, { ...stroke, spine: shoveSpine(stroke.spine, dx, dy) });
}

function turnedStroke(stroke: Stroke, about: Vec2): Stroke {
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
let enclosing = false;

function setInside<T>(run: () => T): T {
  const was = enclosing;
  enclosing = true;
  try {
    return run();
  } finally {
    enclosing = was;
  }
}

function setSmall(
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
function turnedDown(f: Frame, name: LetterName): Recipe {
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
function ordinal(f: Frame, name: LetterName): Recipe {
  const share = 0.62;
  return { strokes: setSmall(f.style, name, share, f.edge, f.cap - f.x * share) };
}

/** A superior figure: the figure, small, with its head at the cap line. */
function superior(f: Frame, name: LetterName): Recipe {
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
function fraction(f: Frame, over: LetterName, under: LetterName): Recipe {
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
function gentler(f: Frame, shortest: number): Frame {
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
function brace(f: Frame, facing: 1 | -1): Recipe {
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
function enclosed(f: Frame, name: LetterName): Recipe {
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
function chevrons(f: Frame, facing: 1 | -1): Recipe {
  const w = signWidth(f) * 0.42;
  const rise = w * 1.05;
  const y = axis(f);
  const step = Math.max(w * 0.92, f.style.pen.weight * f.bar * 2.1);
  const one = (left: number): Stroke => {
    const back = facing > 0 ? left : left + w;
    const tip = facing > 0 ? left + w : left;
    return bent(
      f,
      chain(
        straight(at(back, y + rise), at(tip, y)),
        straight(at(tip, y), at(back, y - rise)),
      ),
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
function bent(f: Frame, spine: Spine): Stroke {
  if (hasCorner(spine)) uses("corner");
  const half = (f.style.pen.weight * f.bar) / 2;
  // A short end, for the reason every sign has one: these runs are too short
  // to be cut at an angle without the two corners meeting in the middle.
  return thin(f, roundCorners(spine, f.radius, half), shortEnd(f), shortEnd(f));
}

// ---------------------------------------------------------------------------
// Alternates
// ---------------------------------------------------------------------------

/**
 * Other ways of drawing the same letter.
 *
 * Not everything about a typeface is a number. Whether an a has one storey or
 * two, whether an A comes to a point or is cut flat across, whether a Q's tail
 * hangs below the bowl or crosses it -- these are decisions with no in-between,
 * and no slider reaches them. A face that can only be adjusted is a face that
 * can only ever be a variation on the one it started as.
 *
 * A choice here belongs to the letter rather than to the font, which is the one
 * place this half of the application is deliberately not family-wide: choosing
 * a double-storey a says nothing about the g. Everything else still reaches it.
 * The alternate is a different skeleton, and the pen, the proportions and every
 * named part are applied to it exactly as they are to the default -- so a font
 * with a flat-topped A still has one weight, one shoulder and one serif.
 */
export interface Alternate {
  id: string;
  label: string;
  /** What it is, for the button's tooltip. */
  hint: string;
  build: (style: Style) => Recipe;
}

export const ALTERNATES: Record<LetterName, Alternate[]> = {
  a: [
    {
      id: "double",
      label: "Two storey",
      hint: "A bowl with an arched top over it, which is what most text faces use.",
      build: (style) => {
        const f = frame(style);
        const bowlHeight = Math.max(f.x * 0.31, f.least);
        const bowlWidth = Math.max(bowlHeight * f.wide, f.least);
        const centre = at(f.edge + bowlWidth, bowlHeight);
        const stem = centre.x + bowlWidth;
        // How far over the top reaches before it turns down, held so it can
        // never ask the pen to turn tighter than it goes round.
        const over = Math.max(Math.min(bowlWidth, f.x - bowlHeight * 2), f.least);
        return finish(f, [
          ink(f, ring(f, centre, bowlWidth, bowlHeight)),
          // Stem and arch as one run, so the turn at the top is a turn rather
          // than two square ends meeting.
          ink(
            f,
            chain(
              straight(at(stem, 0), at(stem, f.x - over)),
              turn(at(stem - over, f.x - over), over, 0, 135),
            ),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],

  A: [
    {
      id: "flat",
      label: "Flat top",
      hint: "Cut across the apex instead of coming to a point, which is what a heavy face does to keep the top from going black.",
      build: (style) => {
        const f = frame(style);
        /*
     * Never narrower than the pen, however narrow the face is set.
     *
     * A bowl is measured by its ink now, so at a heavy weight the round
     * capitals are drawn much smaller than they used to be -- correctly, since
     * their ink has to fit between the same two lines -- and everything sized
     * against them came down with them. An A of a hundred and eighteen units
     * either side of its apex, drawn with a pen of two hundred and sixty, has
     * its two legs closer together than the pen is wide.
     */
    const half = Math.max(f.capBowl * 0.86, f.least);
        const left = f.edge;
        const middle = left + half;
        const cut = f.capBowl * 0.34;
        const bar = f.cap * f.style.parts.crossbar.height * 0.58;
        const inset = (half * bar) / f.cap;
        // Where the two diagonals would be at the height the top is cut.
        const rise = f.cap;
        const leftFoot = at(left, 0);
        const rightFoot = at(middle + half, 0);
        return finish(f, [
          ink(f, straight(leftFoot, at(middle - cut / 2, rise)), f.end, f.end),
          ink(f, straight(rightFoot, at(middle + cut / 2, rise)), f.end, f.end),
          thin(f, straight(at(middle - cut / 2, rise), at(middle + cut / 2, rise))),
          thin(f, straight(at(left + inset, bar), at(middle + half - inset, bar))),
        ]);
      },
    },
  ],

  M: [
    {
      id: "deep",
      label: "Vertex down",
      hint: "The middle carried all the way to the baseline, which widens the two counters and squares the letter off.",
      build: (style) => {
        const f = frame(style);
        const left = f.edge;
        /*
     * And wide enough that the vee is a vee.
     *
     * Every other letter narrows gracefully; an M does not, because its two
     * diagonals meet the stems at a corner that sharpens as the letter closes
     * up, and past a point the inside of that corner cannot be cut back inside
     * the run it has to be cut back into.
     */
    const width = Math.max(f.capBowl * 1.7, f.half * 7);
        const middle = left + width / 2;
        const right = left + width;
        const into = stub(f);
        const start = at(left, f.cap - into);
        const end = at(right, f.cap - into);
        const points = through(f, [
          start,
          at(left, f.cap),
          at(middle, 0),
          at(right, f.cap),
          end,
        ]);
        return finish(f, [
          ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
          ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
          ink(
            f,
            chain(
              straight(points[0], points[1]),
              straight(points[1], points[2]),
              straight(points[2], points[3]),
              straight(points[3], points[4]),
            ),
          ),
        ]);
      },
    },
  ],

  R: [
    {
      id: "curved",
      label: "Curved leg",
      hint: "The leg swung out from under the bowl rather than run straight to the corner.",
      build: (style) => {
        const f = frame(style);
        const stem = f.edge;
        const radius = Math.max(f.cap * 0.27, f.least);
        const junction = f.cap - radius * 2;
        const legRadius = Math.max(junction * 0.62, f.least);
        return finish(f, [
          ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
          belly(f, at(stem, f.cap - radius), radius * f.wide, radius, -90, 90),
          // One arc from the junction to the foot, bowed out to the right.
          ink(f, bowed(f, at(stem, junction), at(stem + legRadius * 1.5, 0), 0.14), BUTT, f.end),
        ]);
      },
    },
  ],

  Q: [
    {
      id: "under",
      label: "Tail below",
      hint: "The tail hung under the bowl instead of crossing its wall, which is what a geometric face usually does.",
      build: (style) => {
        const f = frame(style);
        const centre = at(f.edge + f.capBowl, f.cap / 2);
        const leaves = bowlPoint(centre, f.capBowl, f.capBowlH, 1 - f.square, f.half, -80);
        return finish(
          f,
          [
            ink(f, ring(f, centre, f.capBowl, f.capBowlH)),
            ink(
              f,
              straight(leaves, at(leaves.x + f.capBowl * 0.62, -f.cap * 0.16)),
              BUTT,
              f.end,
            ),
          ],
          true,
        );
      },
    },
  ],

  G: [
    {
      id: "bare",
      label: "No bar",
      hint: "A G with nothing turned back into it: a C with its end cut level. The cleanest of the geometric Gs.",
      build: (style) => {
        const f = frame(style);
        const centre = at(f.edge + f.capBowl, f.cap / 2);
        const clear = (((f.half * 2.4) / f.capBowlH) * 180) / Math.PI;
        return finish(
          f,
          [openBowl(f, centre, f.capBowl, f.capBowlH, Math.max(32, clear), 360)],
          true,
        );
      },
    },
  ],

  l: [
    {
      id: "tailed",
      label: "With a tail",
      hint: "Turned out at the foot, which stops an l reading as a figure one.",
      build: (style) => {
        const f = frame(style);
        const radius = Math.max(f.arch * 0.42, f.least);
        return finish(f, [
          ink(
            f,
            chain(
              straight(at(f.edge, f.asc), at(f.edge, radius)),
              turn(at(f.edge + radius, radius), radius, 180, 270),
            ),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],

  t: [
    {
      id: "straight",
      label: "No foot",
      hint: "Cut off square at the baseline, which is what a squared or technical face wants.",
      build: (style) => {
        const f = frame(style);
        const reach = f.arch * 0.7;
        const stem = f.edge + reach * 0.7;
        return finish(f, [
          ink(f, straight(at(stem, 0), at(stem, f.asc * 0.78)), f.end, f.end),
          crossbar(f, stem - reach * 0.7, stem + reach),
        ]);
      },
    },
  ],

  y: [
    {
      id: "straight",
      label: "Straight tail",
      hint: "A vee with the right arm carried straight down past the baseline, rather than the tail leaving at its own angle.",
      build: (style) => {
        const f = frame(style);
        const half = f.arch * 0.92;
        const left = f.edge;
        const middle = left + half;
        const top = at(left, f.x);
        const other = at(middle + half, f.x);
        const point = corner(f, top, at(middle, 0), other);
        return finish(f, [
          ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end),
          /*
           * The tail leaves the vee's apex, which is not where `corner` put the
           * vee's vertex.
           *
           * `corner` pushes a vertex out along its own bisector by as far as
           * the rounding is going to pull the turn back, so that the *rounded*
           * apex lands where the letter asked for it -- here, on the baseline.
           * Started at that pushed vertex the tail began below the ink instead
           * of inside it: on the Marker it hung ninety units under a vee it had
           * never touched, and on the Casual Script the letter was a `v` with a
           * loose stub floating beneath it. Both faces round their corners. The
           * ones that round nothing were fine, because there the pushed vertex
           * and the apex are the same point, which is why this survived.
           *
           * Half a pen above the apex is inside the ink at any weight and any
           * radius -- the two arms are barely a pen apart by then -- and the cut
           * is square and buried, so none of it shows.
           */
          ink(f, straight(at(middle, f.half), at(middle, f.desc)), BUTT, f.end),
        ]);
      },
    },
  ],

  J: [
    {
      id: "descending",
      label: "Below the line",
      hint: "The hook carried under the baseline, which is what an old-style or a display face does with a J.",
      build: (style) => {
        const f = frame(style);
        const radius = Math.max(f.capBowl * 0.55, f.least);
        const stem = f.edge + radius;
        return finish(f, [
          ink(
            f,
            chain(
              straight(at(stem, f.cap), at(stem, f.dip(f.desc) + radius)),
              turn(at(stem - radius, f.dip(f.desc) + radius), radius, 0, -95),
            ),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],

  k: [
    {
      id: "standing",
      label: "With the leg standing",
      hint: "The leg curving over and coming down onto the baseline instead of running out to a point, which is what a hand does with a k it has to carry on out of.",
      build: (style) => {
        const f = frame(style);
        const stem = f.edge;
        const span = f.arch * 1.7;
        const waist = f.x * 0.42;
        const foot = stem + span;
        /*
         * Where the leg stops falling and starts standing.
         *
         * A straight leg runs out to a point on the baseline, and on a joined
         * face the lead-out cannot leave from that point: it takes the letter's
         * rightmost skeleton between half a pen up and the seam, and the last
         * stretch of a diagonal leg is below that band. So the join left from
         * partway up the leg and the rest of the leg carried on past it, down
         * and to the right -- the arm, the join and the tip of the leg all
         * leaving the same corner pointing the same way.
         *
         * Turned upright, the leg's own foot is the rightmost thing there is
         * and the join leaves from its side, which is what happens on an `n`
         * and is why an `n` never had this. Half a pen up is as high as the
         * turn needs to start: it is exactly what the band excludes. Higher
         * and the fall gets shared with the upright, and at a fifth of the
         * x-height the diagonal is down to seventeen degrees and reads as a
         * bar with a drop on the end rather than as a leg.
         */
        /*
         * And never above the junction the leg falls from.
         *
         * Half a pen is a floor, not a height: on a face whose x-height is
         * small against its pen -- a hairline script wound up to a heavy weight
         * -- a pen and a third is most of the way to the waist, so the leg was
         * asked to fall from the junction to a knee above it and folded back on
         * itself. Kept under half the drop, the leg always falls.
         */
        const knee = at(foot, Math.min(Math.max(f.half * 1.3, f.least), waist * 0.55));
        // The arm stops short of the leg rather than on the same line as it,
        // so the two are not one symmetrical V lying on its side.
        const arm = at(stem + span * 0.84, f.x);
        /*
         * Aimed at the stem's own line rather than at its far edge.
         *
         * `junction` aims a vee at the far edge and leaves the apex's own ink
         * to cover the rest, which holds while the corner is sharp enough to
         * miter out past its vertex. This vee's corner is blunter than a
         * straight-legged k's, because the leg leaves it shallower to have
         * somewhere to turn upright, so the apex reaches less far -- and on the
         * Formal Script the vee and the stem finished two units apart. Half a
         * pen deeper is inside the stem's ink at any weight, and it is where a
         * written k's vee springs from in any case.
         */
        const meet = junction(f, arm, stem - f.half, waist, knee);
        return finish(f, [
          ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
          ink(
            f,
            chain(
              straight(arm, meet),
              roundCorners(
                chain(straight(meet, knee), straight(knee, at(foot, 0))),
                Math.max(f.arch * 0.35, f.least),
                f.half,
              ),
            ),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],

  f: [
    {
      id: "descending",
      label: "With a descender",
      hint: "An f that carries below the baseline, as an italic or a display face does.",
      build: (style) => {
        const f = frame(style);
        const radius = Math.max(f.arch * 0.66, f.least);
        const left = Math.max(f.arch * 0.42, f.least);
        const stem = f.edge + left;
        const lower = Math.max(f.arch * 0.5, f.least);
        const top = f.crest(f.asc) - radius;
        const base = f.dip(f.desc) + lower;
        /*
         * Written from the top of the hook downwards, which is the direction
         * the whole run travels.
         *
         * Written the other way up it read as three pieces that happened to be
         * listed together: the first turn ended nowhere near where the straight
         * began, the chain had a jump in it, and the letter folded. A chain is
         * a journey, and every piece has to leave where the last one arrived.
         *
         * The hook is on the right and the tail on the left, which is the way
         * round every descending f is drawn: the run starts out over the letter
         * after this one and finishes under the letter before it.
         */
        return finish(f, [
          ink(
            f,
            chain(
              turn(at(stem + radius, top), radius, 88, 180),
              straight(at(stem, top), at(stem, base)),
              turn(at(stem - lower, base), lower, 0, -95),
            ),
            f.end,
            f.end,
          ),
          crossbar(f, stem - left, stem + f.arch * 0.62),
        ]);
      },
    },
  ],

  one: [
    {
      id: "footed",
      label: "With a foot",
      hint: "A bar across the base, which stops a one leaning on the letters either side of it.",
      build: (style) => {
        const f = frame(style);
        const width = figureWidth(f);
        const stem = f.edge + width * 0.46;
        const flag = Math.max(width * 0.3, f.least);
        return finish(f, [
          ink(f, straight(at(stem, 0), at(stem, f.cap)), BUTT, f.end),
          ink(f, straight(at(stem - flag, f.cap * 0.8), at(stem, f.hangs(f.cap))), f.end, BUTT),
          thin(
            f,
            straight(at(stem - flag, f.sits(0, f.bar)), at(stem + flag, f.sits(0, f.bar))),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],

  four: [
    {
      id: "open",
      label: "Open",
      hint: "The diagonal stopping at the bar rather than closing the counter, which reads more clearly at a small size.",
      build: (style) => {
        const f = frame(style);
        const width = figureWidth(f);
        const left = f.edge;
        const stem = left + width * 0.72;
        const bar = f.cap * 0.28;
        return finish(f, [
          ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
          ink(f, straight(at(stem, f.hangs(f.cap)), at(left, bar)), BUTT, f.end),
          thin(f, straight(at(left, bar), at(left + width, bar)), BUTT, f.end),
        ]);
      },
    },
  ],

  seven: [
    {
      id: "barred",
      label: "Barred",
      hint: "A bar across the middle, which is how a seven is written where it would otherwise be read as a one.",
      build: (style) => {
        const f = frame(style);
        const width = figureWidth(f);
        const left = f.edge;
        const start = at(left, f.hangs(f.cap));
        const end = at(left + width * 0.28, 0);
        const meet = at(corner(f, start, at(left + width, f.cap), end).x, start.y);
        const bar = f.cap * 0.42;
        return finish(f, [
          ink(f, chain(straight(start, meet), straight(meet, end)), f.end, f.end),
          thin(
            f,
            straight(at(left + width * 0.18, bar), at(left + width * 0.78, bar)),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],

  W: [
    {
      id: "crossed",
      label: "Crossed",
      hint: "The middle carried to the full cap height so the two vees overlap, which is the older way of building a W.",
      build: (style) => {
        const f = frame(style);
        // Never narrower than the pen can hold a vee open, for the same
        // reason the A is not: the round capitals are measured by their ink
        // now, so at a heavy weight everything sized against them comes down.
        const half = Math.max(f.capBowl * 0.62, f.half * 1.6);
        const left = f.edge;
        const first = through(f, [
          at(left, f.cap),
          at(left + half, 0),
          at(left + half * 2.4, f.cap),
        ]);
        const second = through(f, [
          at(left + half * 1.2, f.cap),
          at(left + half * 2.2, 0),
          at(left + half * 3.2, f.cap),
        ]);
        return finish(f, [
          ink(f, chain(straight(first[0], first[1]), straight(first[1], first[2])), f.end, f.end),
          ink(f, chain(straight(second[0], second[1]), straight(second[1], second[2])), f.end, f.end),
        ]);
      },
    },
  ],

  g: [
    {
      id: "curled",
      label: "Curled tail",
      hint: "The descender carried further round, which is warmer than a straight hook and is what a display face tends to want.",
      build: (style) => {
        const f = frame(style);
        const centre = at(f.edge + f.bowl, f.x / 2);
        const stem = centre.x + f.bowl;
        const radius = Math.max(f.arch * 0.95, f.least);
        return finish(f, [
          ink(f, ring(f, centre, f.bowl, f.bowlH)),
          ink(
            f,
            chain(
              straight(at(stem, f.x), at(stem, f.dip(f.desc) + radius)),
              turn(at(stem - radius, f.dip(f.desc) + radius), radius, 0, -150),
            ),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],
};

/**
 * Every way this letter can be drawn, the default one first.
 *
 * The default has no identifier of its own: a letter that has never been given
 * an alternate is not carrying a choice, it is simply itself.
 */
export function formsOf(name: LetterName): Array<{ id: string; label: string; hint: string }> {
  const others = ALTERNATES[name] ?? [];
  if (others.length === 0) return [];
  return [
    { id: "", label: "Default", hint: "The letter as this face draws it." },
    ...others.map(({ id, label, hint }) => ({ id, label, hint })),
  ];
}

/**
 * Every form of a letter that can be drawn, which is not the same list.
 *
 * `formsOf` answers a picker's question -- what is there to choose between --
 * and a letter carrying no alternate is not a choice, so it answers with
 * nothing. Seven loops across the tests and the scripts read that list to
 * decide what to draw, and so drew nothing: thirty-six of the fifty letters,
 * every capital but seven, the whole of the round letters. A Formal Script `Y`
 * in two pieces sat in front of all of them and none of them saw it, and the
 * one test that did catch it was the one that had never been given the forms
 * loop at all.
 *
 * So: the ids to draw, always at least the default.
 */
export function everyFormOf(name: LetterName): Array<{ id: string; label: string; hint: string }> {
  const forms = formsOf(name);
  if (forms.length > 0) return forms;
  return [{ id: "", label: "Default", hint: "The letter as this face draws it." }];
}

/** The recipe for a letter, in whichever form has been chosen. */
export function recipeOf(
  name: LetterName,
  form?: string,
): ((style: Style) => Recipe) | undefined {
  const build = form
    ? (ALTERNATES[name]?.find((alternate) => alternate.id === form)?.build ?? LETTERS[name])
    : LETTERS[name];
  if (!build) return undefined;
  /*
   * Every letter starts with nothing collected.
   *
   * A recipe that builds a spine and thinks better of it leaves what that spine
   * said behind, and without this it would be handed to the next run inked --
   * which might be the next run of the next letter. One line, and the run-level
   * collection cannot leak across a boundary it was never meant to cross.
   */
  return (style: Style) => {
    pending = [];
    // Carried so that a symbol built out of a letter draws the same letter the
    // font does: an ordinal on a font with the single-storey a is that a.
    borrowing = form;
    return connected(name, build(style), style);
  };
}

/**
 * The letters a joined face reaches out of, which is the lowercase and nothing
 * else.
 *
 * Not an oversight about the capitals. A cursive capital is a different letter
 * from a cursive lowercase rather than a larger one -- it is swashed, it is
 * built from a flourish rather than from a stem, and in every hand that has
 * ever been written it joins on its right at best and usually on neither side.
 * Reaching a lead-in out of the left of a script `A` would draw a stroke into a
 * letter nothing is ever set before.
 *
 * The figures and the punctuation are out for the plainer reason that nothing
 * joins to them either.
 */
export const JOINS = new Set<string>("abcdefghijklmnopqrstuvwxyz".split(""));

/**
 * The capitals, which reach out on their right and never on their left.
 *
 * Which is the whole of what makes a written capital a written capital rather
 * than a roman one leaning over. A hand sets a capital at the start of a word
 * and carries straight on out of it into the lowercase; nothing is ever set
 * before it, so a lead-in out of its left would be a stroke reaching into an
 * empty page.
 *
 * Four are left out because in a written hand they are the ones a pen finishes
 * on the wrong side of. An `O`, a `D`, a `P` and a `B` all close their bowl at
 * the top, and the hand lifts there rather than carrying on -- so the letter
 * after one of them starts a fresh stroke, which is what the reader sees in
 * every copperplate ever cut.
 *
 * And two more for a harder reason: the hand-over draws them into a different
 * letter. Every lead-out leaves along the baseline, and on an `F` the baseline
 * is exactly where an `E` keeps its bottom arm -- so an `F` that hands on *is*
 * an `E`, and `Fox` sets as `Eox`. An `I` with a foot going right is an `L`.
 * Neither is a matter of taste or of how far the stroke reaches: it is the
 * letter as `cmap` maps it, which is what a reader gets in any renderer that
 * applies no features at all.
 *
 * Nothing else in the alphabet does it. Drawn with and without their lead-outs
 * side by side, the other twenty carry a tail off a terminal that was already
 * pointing that way -- the `E` and the `L` simply grow a longer bottom arm, and
 * the rest end in clear air.
 */
const NEVER_HANDS_ON = new Set(["B", "D", "F", "I", "O", "P"]);
export const CAPITALS = new Set<string>("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));

/** Which halves of the join this letter has, if any. */
export function joinEnds(name: string): Ends {
  if (JOINS.has(name)) return BOTH_ENDS;
  if (CAPITALS.has(name) && !NEVER_HANDS_ON.has(name)) return { entry: false, exit: true };
  return { entry: false, exit: false };
}

/**
 * Whether the cursive loop belongs on this letter.
 *
 * It is an ascender's loop and a descender's, and a capital has neither -- it
 * is a capital, not a tall lowercase. The eye is struck straight down from the
 * highest end of the letter and it does not ask what that end belongs to, so
 * every capital built on an upright was taking one: `ITEM LIFT` came out of
 * the Formal Script as `P PEM PPF P`, the `I` and the `T` both reading as a
 * `P` because on both of them the loop is the only thing the eye finds first.
 *
 * Not that a written capital never has a loop -- half of them do, in a formal
 * hand. But the loop on a capital is part of how that capital is drawn, sized
 * and placed by whoever drew it, and this one is a semicircle of so many pen
 * widths struck on whatever stem stands highest. That is the right construction
 * for the ascender it was written for and no construction at all for a `T`.
 *
 * And the `p` has neither, which is a fact about the order the strokes are
 * made in rather than about the letter's shape. A loop is what a pen leaves
 * when it turns round at the end of a stroke and carries on. On a `g`, a `y`,
 * a `j` and an `f` the descender is the last thing drawn, so it turns; on a
 * `p` it is the first, and the pen lifts at the bottom of it and comes back up
 * to start the bowl. The reference draws it exactly so -- its `p` is a single
 * stroke 0.18 of an x-height wide at every depth below the line, where its `q`,
 * `g`, `y`, `j` and `f` all read as two.
 *
 * It cost the `p` a fifth of its width. The loop swung out to the left of the
 * stem and the spacing counted that swing as part of the letter, so the `p`
 * came out at 1.19 to 1.34 of its own face's `o` against the reference's 1.07,
 * and at 1.01 to 1.07 with the loop turned off.
 */
/*
 * And the `d`, which the reference draws with no loop at all.
 *
 * It is the one ascender in the font that does not take one. Read across the
 * ascender the reference's `l`, `h`, `b`, `k` and `f` all come to two runs of
 * ink -- a loop and the stem beside it -- and every one of them spans 0.39 to
 * 0.54 of an x-height. Its `d` is a single run of 0.24 to 0.27 at every height,
 * which is one stroke and its lean and nothing else: the ascender goes up,
 * curves over to the right, and comes back down into the bowl.
 *
 * Ours gave it the loop the others have, two runs and 0.37 to 0.52 wide, so the
 * `d` carried an ornament no `d` in the reference has.
 */
const NO_LOOP = new Set(["p", "thorn", "d", "dcroat"]);

export function takesLoop(name: string): boolean {
  return !CAPITALS.has(name) && !NO_LOOP.has(name);
}

/** Whether the join reaches out of this letter at all, on either side. */
export function reachesEither(name: string): boolean {
  const ends = joinEnds(name);
  return ends.entry || ends.exit;
}

/**
 * Which half of the join, if either, this drawing of a letter takes high.
 *
 * Module state with a scoped setter, which is how everything else here that has
 * to reach a recipe without threading a parameter through it is done: the wave
 * book does it, and so does the alternate a symbol borrows. The alternative was
 * an eighth positional argument on `drawLetter`, which already has seven.
 *
 * It cannot be the `form` argument, which is the other obvious place. A face
 * that draws the two-storey `a` needs the alternate of its `a` to be the
 * two-storey one *and* to come in high, and `form` can only say one of those.
 */
let takingHigh: { entry?: boolean; exit?: boolean } = {};

/**
 * Draw whatever this does with one half of every join taken high.
 *
 * For building the contextual alternates, and nothing else calls it: the plain
 * glyphs of a joined face all meet each other at the low seam, which is what
 * makes the font correct in a renderer that never applies the feature. The flag
 * is put back afterwards whatever happens, because a letter drawn high by
 * accident is a letter that does not meet the one before it.
 */
/**
 * Which half of its join this drawing of a letter goes without.
 *
 * The same module-scoped, scoped-setter arrangement as `takingHigh` above, and
 * for the same reason: a second drawing of a letter that a shaper swaps in.
 *
 * A word does not begin with a stroke reaching out of its first letter towards
 * nothing, or end with one reaching out of its last. The letter as `cmap` maps
 * it has both halves, so a renderer that never applies a feature still gets a
 * face whose letters meet; these are the drawings for the two ends of a word.
 */
let endsWithout: Partial<Ends> | null = null;

export function joiningWithout<T>(which: Partial<Ends>, run: () => T): T {
  const was = endsWithout;
  endsWithout = which;
  try {
    return run();
  } finally {
    endsWithout = was;
  }
}

export function joiningHigh<T>(which: { entry?: boolean; exit?: boolean }, run: () => T): T {
  const was = takingHigh;
  takingHigh = which;
  try {
    return run();
  } finally {
    takingHigh = was;
  }
}

/**
 * The letter with its lead-in and lead-out, for a face that connects.
 *
 * Done here rather than in `finish` because `finish` does not know which letter
 * it is finishing, and the answer for a capital is different from the answer
 * for an n. Done after the recipe rather than inside it so that every one of
 * the ninety-odd recipes below stays a description of a letter and none of them
 * has to know this exists.
 *
 * The width comes back stated rather than measured. Every other letter in this
 * engine takes its advance from where its ink happened to stop, which is right
 * when the gap either side is empty space and wrong when the gap is a stroke:
 * the exit has to stop *on* the advance, to the unit, or the next letter's
 * entry starts somewhere the last one did not finish.
 */
function connected(name: LetterName, recipe: Recipe, style: Style): Recipe {
  const script = style.parts.script;
  /*
   * The bow first, and before anything asks whether this letter joins.
   *
   * A written line is bowed whether or not it reaches a neighbour, so a digit,
   * a comma and the four capitals that hand on to nothing all take it -- and
   * the letters that do join are bowed before their loops are found and their
   * joins are planned, so both are struck against the letter as it really ends
   * up rather than against a straight one it never was.
   */
  if (script.on && script.bow > 0) {
    const half = style.pen.weight / 2;
    recipe = {
      ...recipe,
      strokes: recipe.strokes.map((stroke) => ({
        ...stroke,
        spine: bowRuns(stroke.spine, script.bow, half),
      })),
    };
  }
  /*
   * What the letter has, less whatever this drawing is doing without.
   *
   * The override can only take a half away, never hand one over: a capital that
   * gained a lead-in because something asked for one would be reaching into a
   * letter nothing is ever set before, which is the thing `joinEnds` exists to
   * prevent.
   */
  const has = joinEnds(name);
  const without = endsWithout ?? {};
  const ends: Ends = {
    entry: has.entry && without.entry !== false,
    exit: has.exit && without.exit !== false,
  };
  /*
   * Asked on what the letter *has*, not on what this drawing kept. A letter
   * that never joins -- a capital that hands on to nothing, a digit, a comma --
   * has no business in the join layer and is spaced as the roman letter it is.
   * A letter that joins and has been asked to give up both halves is still a
   * letter of a joined face, and has to be spaced like one: it goes through,
   * and comes out with the room either side and no strokes in it.
   */
  if (!script.on || enclosing || (!has.entry && !has.exit)) return recipe;
  const f = frame(style);
  /*
   * Off its line first, then the join, then over into its room.
   *
   * The order is the whole of why an unsteady hand does not open the joins. The
   * letter is lifted before the join is planned, so the join is drawn to where
   * the letter actually ended up rather than to where it would have been -- the
   * lead-in climbs a little further on a letter that bounced up and a little
   * less on one that dropped, and both still leave the seam at exactly the
   * height everything else leaves it at.
   */
  const room = {
    half: f.half,
    upright: f.upright,
    // What the pen is certain to reach, which is what it is at its narrowest.
    narrow: f.half * Math.max(0, 1 - Math.abs(style.pen.contrast)),
    x: f.x,
    sidebearing: f.edge - f.half,
  };
  /*
   * Loops first, then the lift, then the join. The order is the whole of why
   * this works, and each step of it was wrong once.
   *
   * The loops are found on the letter as its recipe drew it, before the hand
   * has moved it anywhere. Found afterwards instead, a letter the hand happened
   * to drop had stroke ends below the baseline that its recipe never put there
   * -- so an `m` grew a descender loop, and hung ninety-five units under a line
   * it is supposed to stand on.
   *
   * The lift then moves the letter and its loops together, before the join is
   * planned, so the join is drawn to where the letter actually ended up rather
   * than to where it would have been. The seam never moves; the lead-in simply
   * climbs a little further or a little less.
   *
   * And the join is planned last of all, with the loops already part of the
   * letter it is measuring -- a loop reaches left of the stem it is on, and a
   * lead-in drawn to the stem instead would cross it.
   */
  /*
   * Which height each half of this letter's join crosses at, and the plain
   * answer is: both low.
   *
   * A written `o`, `v`, `w` and `b` hand over at the waist where everything
   * else hands over at the baseline -- but that is a fact about the *pair*, and
   * drawing it into the letter is what would make this font wrong wherever the
   * feature is not applied. So the letter as it is mapped in `cmap` joins low at
   * both ends like every other, and the high hand-over lives in a second
   * drawing that a shaper swaps in when the pair actually occurs. `o` and the
   * letter after it are both replaced, so the two that meet always agree.
   */
  const seams = seamsOf(script, f.x, f.half);
  const crossing = {
    entry: takingHigh.entry ? seams.high : seams.low,
    exit: takingHigh.exit && HANDS_OVER_HIGH.has(name) ? seams.high : seams.low,
  };
  const loops = planLoops(
    recipe.strokes.map((stroke) => stroke.spine), room, script, takesLoop(name));
  /*
   * And the hand is only unsteady in the middle of a word.
   *
   * A capital is set down deliberately at the start of one, on the line, and
   * the bounce is a property of a running hand rather than of every letter that
   * hand ever writes. Lifted with the rest, the capitals came off their lines by
   * thirty units on the Handwriting and fifty on the Casual Script -- which is
   * the one thing every face here promises not to do.
   */
  const lift = ends.entry ? wobbleOf(name, script, f.x).lift : 0;
  const body = [...recipe.strokes, ...loops.map((loop) => ink(f, loop, BUTT, BUTT))].map((stroke) => ({
    ...stroke,
    spine: movedSpine(stroke.spine, 0, lift),
  }));
  const plan = planJoin(
    body.map((stroke) => stroke.spine), room, script, crossing, ends, recipe.round,
    // Where this letter's waist has ended up, so what rises above it can hang
    // over the letter beside it -- and `null` for a capital, which has no
    // letter set before it and is spaced off the whole of its own ink.
    has.entry ? f.x + lift : null,
    recipe.air);
  if (!plan) return recipe;
  /*
   * The letter moves over; the join does not.
   *
   * The lead-in needs a run of its own to climb along, and on a joined face
   * there is no sidebearing for it to borrow -- the space either side of a
   * letter here is the join itself. So the letter is given that room by being
   * slid into it, and the join is drawn where it already belongs.
   */
  const strokes = body.map((stroke) => ({ ...stroke, spine: movedSpine(stroke.spine, plan.inset, 0) }));
  /*
   * Cut square at both ends, whatever the face's terminal is.
   *
   * The seam end has to be: two square cuts along the same line meet exactly,
   * and a round cap would add half a pen of length to each half of the join and
   * push the two ends through each other. The buried end is square because
   * nothing can see it.
   */
  if (plan.entry) strokes.push(ink(f, plan.entry, BUTT, BUTT));
  if (plan.exit) strokes.push(ink(f, plan.exit, BUTT, BUTT));
  return { ...recipe, strokes, width: plan.width };
}
