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
import { terminalFor } from "./style";
import type { Spine, Stroke, Terminal } from "./types";

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
  /** A width to use instead of measuring, for the space and for the figures. */
  width?: number;
}

export type LetterName = string;

/** The parts a letter can be built from, which are the things an edit lands on. */
export type PartName = "slab" | "shoulder" | "bowl" | "terminal" | "crossbar";

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

function uses(part: PartName): void {
  recording?.add(part);
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

function ring(centre: Vec2, radius: number): Spine {
  return {
    segments: [
      { kind: "arc", centre, radius, startAngle: 0, endAngle: Math.PI * 2, sweepPositive: true },
    ],
    closed: true,
  };
}

/**
 * A closed oval, taller than it is wide: two half turns joined by two straight
 * runs.
 *
 * A circle cannot be squashed here, because a squashed circle is an ellipse and
 * an ellipse offsets to something that is not an ellipse. Built this way the
 * shape is still only lines and arcs, so it offsets exactly like everything
 * else -- and it is how a figure zero is drawn anyway, which is as an o with
 * its sides pulled in rather than as a circle.
 */
function oval(centre: Vec2, halfWidth: number, halfHeight: number): Spine {
  const straightRun = Math.max(0, halfHeight - halfWidth);
  const top = centre.y + straightRun;
  const bottom = centre.y - straightRun;
  const left = centre.x - halfWidth;
  const right = centre.x + halfWidth;
  return {
    segments: [
      { kind: "line", from: at(right, bottom), to: at(right, top) },
      { kind: "arc", centre: at(centre.x, top), radius: halfWidth, startAngle: 0, endAngle: Math.PI, sweepPositive: true },
      { kind: "line", from: at(left, top), to: at(left, bottom) },
      { kind: "arc", centre: at(centre.x, bottom), radius: halfWidth, startAngle: Math.PI, endAngle: Math.PI * 2, sweepPositive: true },
    ],
    closed: true,
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
  /** Radius of a lowercase round letter, which fills the x-height. */
  bowl: number;
  /** Radius of a capital round letter. */
  capBowl: number;
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

function frame(style: Style): Frame {
  const { metrics, pen } = style;
  const half = pen.weight / 2;
  return {
    style,
    half,
    edge: metrics.sidebearing + half,
    x: metrics.xHeight,
    cap: metrics.capHeight,
    asc: metrics.ascender,
    desc: metrics.descender,
    over: metrics.overshoot,
    arch: (metrics.counterWidth + pen.weight) / 2,
    bowl: metrics.xHeight / 2 + metrics.overshoot,
    capBowl: metrics.capHeight / 2 + metrics.overshoot,
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
  uses("terminal");
  return terminalFor(style);
}

/** Draw a run with the style's own pen. */
function ink(frame: Frame, spine: Spine, start: Terminal = BUTT, end: Terminal = BUTT): Stroke {
  // A closed run is a bowl: an o, the belly of a b, the ring of a zero. Read off
  // the shape rather than declared, so a letter that gains one is noticed.
  if (spine.closed) uses("bowl");
  return { spine, pen: frame.style.pen, start, end };
}

/**
 * A bar can be lighter than the stems it crosses, which is how a crossbar
 * avoids looking heavier than the letter around it.
 */
function thin(frame: Frame, spine: Spine, start: Terminal = BUTT, end: Terminal = BUTT): Stroke {
  uses("crossbar");
  const { pen, parts } = frame.style;
  return { spine, pen: { ...pen, weight: pen.weight * parts.crossbar.weight }, start, end };
}

/** A round letter is set slightly tighter, or it looks loose beside a flat one. */
function finish(frame: Frame, strokes: Stroke[], round = false): Recipe {
  void frame;
  return { strokes, round };
}

// ---------------------------------------------------------------------------
// Shapes that more than one letter is made of
// ---------------------------------------------------------------------------

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
function arch(frame: Frame, fromX: number, height: number): Stroke {
  uses("shoulder");
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
  const radius = Math.min(reach, height * (1 - frame.style.parts.shoulder.spring));
  const landing = fromX + reach * 2;
  const top = height - radius;
  return ink(
    frame,
    chain(
      turn(at(fromX + radius, top), radius, 180, 90),
      straight(at(fromX + radius, height), at(landing - radius, height)),
      turn(at(landing - radius, top), radius, 90, 0),
      straight(at(landing, top), at(landing, 0)),
    ),
    BUTT,
    frame.end,
  );
}

/** The other way up: down one side, round the bottom, up the other. */
function trough(frame: Frame, fromX: number, height: number): Stroke {
  uses("shoulder");
  const reach = frame.arch;
  const radius = Math.min(reach, height * (1 - frame.style.parts.shoulder.spring));
  const rising = fromX + reach * 2;
  return ink(
    frame,
    chain(
      straight(at(fromX, height), at(fromX, radius)),
      turn(at(fromX + radius, radius), radius, 180, 270),
      straight(at(fromX + radius, 0), at(rising - radius, 0)),
      turn(at(rising - radius, radius), radius, 270, 360),
      straight(at(rising, radius), at(rising, height)),
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
  const radius = height / 4;
  const middle = left + radius;
  const upper = at(middle, height - radius);
  const lower = at(middle, radius);
  return {
    stroke: ink(
      frame,
      chain(turn(upper, radius, 25, 270), turn(lower, radius, 90, -155)),
      frame.end,
      frame.end,
    ),
  };
}

/** A c, a C, and the bowl of an e and a G: a ring with its right side open. */
function openBowl(
  frame: Frame,
  centre: Vec2,
  radius: number,
  fromDegrees = 55,
  toDegrees = 305,
): Stroke {
  return ink(frame, turn(centre, radius, fromDegrees, toDegrees), frame.end, frame.end);
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
    const stem = centre.x + f.bowl;
    return finish(
      f,
      [
        ink(f, ring(centre, f.bowl)),
        ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
      ]);
  },

  b: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
        ink(f, ring(at(stem + f.bowl, f.x / 2), f.bowl)),
      ],
      true);
  },

  c: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    return finish(f, [openBowl(f, centre, f.bowl)], true);
  },

  d: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl;
    return finish(
      f,
      [
        ink(f, ring(centre, f.bowl)),
        ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
      ]);
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
    const rise = Math.max(-0.85, Math.min(0.85, (eye - centre.y) / f.bowl));
    const opens = (Math.asin(rise) * 180) / Math.PI;
    return finish(
      f,
      [
        // The bar begins at the inside of the bowl's left wall. Run to the
        // centre-line it pokes out through the left of the letter and the e
        // reads as a struck-through o.
        thin(f, straight(at(centre.x - f.bowl + f.half, eye), at(centre.x + f.bowl, eye))),
        ink(f, turn(centre, f.bowl, opens, opens + 300), BUTT, f.end),
      ],
      true,
    );
  },

  f: (style) => {
    const f = frame(style);
    // Big enough to read as a hook rather than a curl, small enough that the
    // letter does not turn into a walking stick.
    const radius = f.arch * 0.55;
    const stem = f.edge + radius;
    return finish(
      f,
      [
        // Straight up, then a quarter turn left into the hook.
        ink(
          f,
          chain(
            straight(at(stem, 0), at(stem, f.asc - radius - f.half)),
            // Set down by half a pen so the ink stops at the ascender rather
            // than starting there.
            turn(at(stem - radius, f.asc - radius - f.half), radius, 0, 92),
          ),
          f.end,
          f.end,
        ),
        // Narrow enough to tell an f from a t, which is the only thing keeping
        // them apart once both have a bar at the x-height.
        thin(f, straight(at(stem - f.arch * 0.5, f.x), at(stem + f.arch * 0.5, f.x)), f.end, f.end),
      ]);
  },

  g: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl;
    const radius = f.arch * 0.7;
    return finish(
      f,
      [
        ink(f, ring(centre, f.bowl)),
        // Down the right and round into the tail, which is one stroke so the
        // descender cannot part company with the bowl.
        ink(
          f,
          chain(
            straight(at(stem, f.x), at(stem, f.desc + radius + f.half)),
            // Set up by half a pen, so the ink stops at the descender rather
            // than starting there.
            turn(at(stem - radius, f.desc + radius + f.half), radius, 0, -95),
          ),
          f.end,
          f.end,
        ),
      ]);
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

  j: (style) => {
    const f = frame(style);
    const radius = f.arch * 0.62;
    const stem = f.edge + radius;
    return finish(
      f,
      [
        ink(
          f,
          chain(
            straight(at(stem, f.x), at(stem, f.desc + radius + f.half)),
            // Set up by half a pen, so the ink stops at the descender rather
            // than starting there.
            turn(at(stem - radius, f.desc + radius + f.half), radius, 0, -95),
          ),
          f.end,
          f.end,
        ),
        dot(f, at(stem, f.x + f.half * 1.5 + f.half * 0.55), f.half * 0.55),
      ]);
  },

  k: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = stem + f.arch * 1.7;
    const junction = f.x * 0.42;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
        ink(f, straight(at(reach, f.x), at(stem, junction)), f.end, BUTT),
        ink(f, straight(at(stem + f.half, junction + f.half), at(reach, 0)), BUTT, f.end),
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
        ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
        arch(f, stem, f.x),
        arch(f, stem + f.arch * 2, f.x),
      ]);
  },

  n: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(
      f,
      [ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end), arch(f, stem, f.x)]);
  },

  o: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    return finish(f, [ink(f, ring(centre, f.bowl))], true);
  },

  p: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(
      f,
      [
        ink(f, straight(at(stem, f.desc), at(stem, f.x)), f.end, f.end),
        ink(f, ring(at(stem + f.bowl, f.x / 2), f.bowl)),
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
        ink(f, ring(centre, f.bowl)),
        ink(f, straight(at(stem, f.desc), at(stem, f.x)), f.end, f.end),
      ]);
  },

  r: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const springAt = f.x * f.style.parts.shoulder.spring;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
        // The same arch as an n, stopped partway: an r is an n that gave up.
        ink(f, turn(at(stem + f.arch, springAt), f.arch, 180, 60), BUTT, f.end),
      ]);
  },

  s: (style) => {
    const f = frame(style);
    const { stroke } = spine(f, f.x, f.edge);
    return finish(f, [stroke], true);
  },

  t: (style) => {
    const f = frame(style);
    const stem = f.edge + f.arch * 0.35;
    const reach = f.arch * 0.7;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.asc * 0.78)), f.end, f.end),
        thin(f, straight(at(stem - reach * 0.7, f.x), at(stem + reach, f.x)), f.end, f.end),
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
    return finish(
      f,
      [
        ink(f, straight(at(left, f.x), at(middle, 0)), f.end, BUTT),
        ink(f, straight(at(middle, 0), at(middle + half, f.x)), BUTT, f.end),
      ]);
  },

  w: (style) => {
    const f = frame(style);
    const half = f.arch * 0.72;
    const left = f.edge;
    return finish(
      f,
      [
        ink(f, straight(at(left, f.x), at(left + half, 0)), f.end, BUTT),
        ink(f, straight(at(left + half, 0), at(left + half * 2, f.x)), BUTT, f.end),
        ink(f, straight(at(left + half * 2, f.x), at(left + half * 3, 0)), f.end, BUTT),
        ink(f, straight(at(left + half * 3, 0), at(left + half * 4, f.x)), BUTT, f.end),
      ]);
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
    // How far down the right-hand diagonal has already come by the baseline,
    // so the tail leaves at the same angle it arrived on.
    const slope = (half * 2) / f.x;
    return finish(
      f,
      [
        ink(f, straight(at(left, f.x), at(middle, 0)), f.end, BUTT),
        ink(
          f,
          straight(at(middle + half, f.x), at(middle + half + slope * f.desc, f.desc)),
          f.end,
          f.end,
        ),
      ]);
  },

  z: (style) => {
    const f = frame(style);
    const width = f.arch * 1.6;
    const left = f.edge;
    return finish(
      f,
      [
        thin(f, straight(at(left, f.x), at(left + width, f.x)), f.end, f.end),
        ink(f, straight(at(left + width, f.x), at(left, 0)), BUTT, BUTT),
        thin(f, straight(at(left, 0), at(left + width, 0)), f.end, f.end),
      ]);
  },

  // --- capitals ----------------------------------------------------------

  A: (style) => {
    const f = frame(style);
    const half = f.capBowl * 0.86;
    const left = f.edge;
    const apex = left + half;
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
        ink(f, straight(at(left, 0), at(apex, f.cap)), f.end, BUTT),
        ink(f, straight(at(apex, f.cap), at(apex + half, 0)), BUTT, f.end),
        thin(f, straight(at(left + inset, bar), at(apex + half - inset, bar))),
      ]);
  },

  B: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const upper = f.cap * 0.56;
    const upperR = (f.cap - upper) / 2 + f.half * 0.2;
    const lowerR = upper / 2 + f.half * 0.2;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        ink(f, turn(at(stem, f.cap - upperR), upperR, 90, -90), BUTT, BUTT),
        ink(f, turn(at(stem, lowerR), lowerR, 90, -90), BUTT, BUTT),
      ]);
  },

  C: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.capBowl, f.cap / 2);
    return finish(f, [openBowl(f, centre, f.capBowl)], true);
  },

  D: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = f.cap / 2;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        ink(f, turn(at(stem, f.cap / 2), radius, 90, -90), BUTT, BUTT),
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
        thin(f, straight(at(stem, f.cap), at(stem + reach, f.cap)), BUTT, f.end),
        thin(
          f,
          straight(
            at(stem, f.cap * f.style.parts.crossbar.height),
            at(stem + reach * 0.86, f.cap * f.style.parts.crossbar.height),
          ),
          BUTT,
          f.end,
        ),
        thin(f, straight(at(stem, 0), at(stem + reach, 0)), BUTT, f.end),
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
        thin(f, straight(at(stem, f.cap), at(stem + reach, f.cap)), BUTT, f.end),
        thin(
          f,
          straight(
            at(stem, f.cap * f.style.parts.crossbar.height),
            at(stem + reach * 0.86, f.cap * f.style.parts.crossbar.height),
          ),
          BUTT,
          f.end,
        ),
      ]);
  },

  G: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.capBowl, f.cap / 2);
    const right = centre.x + f.capBowl;
    return finish(
      f,
      [
        /*
         * A G is a C carried round almost the whole way and then turned back
         * into itself. Ending the bowl level with its own centre puts the bar
         * where the eye expects it and leaves the aperture above, which is what
         * tells a G from a C at small sizes.
         */
        openBowl(f, centre, f.capBowl, 32, 360),
        thin(f, straight(at(right, centre.y), at(right - f.capBowl * 0.55, centre.y)), BUTT, f.end),
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
    const radius = f.capBowl * 0.55;
    const stem = f.edge + radius;
    return finish(
      f,
      [
        ink(
          f,
          chain(
            straight(at(stem, f.cap), at(stem, radius)),
            turn(at(stem - radius, radius), radius, 0, -90),
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
    const junction = f.cap * 0.44;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        ink(f, straight(at(reach, f.cap), at(stem, junction)), f.end, BUTT),
        ink(f, straight(at(stem + f.half, junction + f.half), at(reach, 0)), BUTT, f.end),
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
        thin(f, straight(at(stem, 0), at(stem + reach, 0)), BUTT, f.end),
      ]);
  },

  M: (style) => {
    const f = frame(style);
    const left = f.edge;
    const width = f.capBowl * 1.7;
    const middle = left + width / 2;
    const right = left + width;
    return finish(
      f,
      [
        ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
        ink(f, straight(at(left, f.cap), at(middle, f.cap * 0.16)), BUTT, BUTT),
        ink(f, straight(at(middle, f.cap * 0.16), at(right, f.cap)), BUTT, BUTT),
        ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
      ]);
  },

  N: (style) => {
    const f = frame(style);
    const left = f.edge;
    const right = left + f.capBowl * 1.35;
    return finish(
      f,
      [
        ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
        ink(f, straight(at(left, f.cap), at(right, 0)), BUTT, BUTT),
        ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
      ]);
  },

  O: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.capBowl, f.cap / 2);
    return finish(f, [ink(f, ring(centre, f.capBowl))], true);
  },

  P: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = f.cap * 0.27;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        ink(f, turn(at(stem, f.cap - radius), radius, 90, -90), BUTT, BUTT),
      ]);
  },

  Q: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.capBowl, f.cap / 2);
    const tail = f.capBowl * 0.55;
    return finish(
      f,
      [
        ink(f, ring(centre, f.capBowl)),
        // The tail leaves from inside the bowl and crosses its wall, which is
        // what makes it look attached rather than propped against the letter.
        ink(
          f,
          straight(at(centre.x + tail * 0.35, f.cap * 0.3), at(centre.x + f.capBowl * 0.95, -f.cap * 0.13)),
          BUTT,
          f.end,
        ),
      ],
      true);
  },

  R: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = f.cap * 0.27;
    const junction = f.cap - radius * 2;
    const reach = stem + radius * 1.5;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        ink(f, turn(at(stem, f.cap - radius), radius, 90, -90), BUTT, BUTT),
        ink(f, straight(at(stem + f.half, junction), at(reach, 0)), BUTT, f.end),
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
        thin(f, straight(at(middle - half, f.cap), at(middle + half, f.cap)), f.end, f.end),
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
    return finish(
      f,
      [
        ink(f, straight(at(left, f.cap), at(middle, 0)), f.end, BUTT),
        ink(f, straight(at(middle, 0), at(middle + half, f.cap)), BUTT, f.end),
      ]);
  },

  W: (style) => {
    const f = frame(style);
    const half = f.capBowl * 0.7;
    const left = f.edge;
    return finish(
      f,
      [
        ink(f, straight(at(left, f.cap), at(left + half, 0)), f.end, BUTT),
        ink(f, straight(at(left + half, 0), at(left + half * 2, f.cap)), BUTT, f.end),
        ink(f, straight(at(left + half * 2, f.cap), at(left + half * 3, 0)), f.end, BUTT),
        ink(f, straight(at(left + half * 3, 0), at(left + half * 4, f.cap)), BUTT, f.end),
      ]);
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
    return finish(
      f,
      [
        ink(f, straight(at(left, f.cap), at(middle, junction)), f.end, BUTT),
        ink(f, straight(at(middle + half, f.cap), at(middle, junction)), f.end, BUTT),
        ink(f, straight(at(middle, junction), at(middle, 0)), BUTT, f.end),
      ]);
  },

  Z: (style) => {
    const f = frame(style);
    const width = f.capBowl * 1.4;
    const left = f.edge;
    return finish(
      f,
      [
        thin(f, straight(at(left, f.cap), at(left + width, f.cap)), f.end, f.end),
        ink(f, straight(at(left + width, f.cap), at(left, 0)), BUTT, BUTT),
        thin(f, straight(at(left, 0), at(left + width, 0)), f.end, f.end),
      ]);
  },

  // --- figures -----------------------------------------------------------

  zero: (style) => {
    const f = frame(style);
    const half = figureWidth(f) / 2;
    const centre = at(f.edge + half, f.cap / 2);
    return finish(f, [ink(f, oval(centre, half, f.cap / 2))], true);
  },

  one: (style) => {
    const f = frame(style);
    const stem = f.edge + figureWidth(f) * 0.5;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, BUTT),
        // The flag, which is what stops a one reading as a lowercase l.
        ink(f, straight(at(stem - figureWidth(f) * 0.42, f.cap * 0.78), at(stem, f.cap)), f.end, BUTT),
      ]);
  },

  two: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const radius = width / 2;
    const centre = at(left + radius, f.cap - radius);
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
    return finish(f, [
      ink(f, turn(centre, radius, 190, leaves), f.end, BUTT),
      ink(f, straight(pointOn(centre, radius, leaves), at(left, 0)), BUTT, BUTT),
      thin(f, straight(at(left, 0), at(left + width, 0)), BUTT, f.end),
    ]);
  },

  three: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const radius = f.cap / 4;
    const middle = left + width - radius;
    return finish(
      f,
      [
        ink(f, turn(at(middle, f.cap - radius), radius, 160, -90), f.end, BUTT),
        ink(f, turn(at(middle, radius), radius, 90, -160), BUTT, f.end),
      ],
      true);
  },

  four: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const stem = left + width * 0.72;
    const bar = f.cap * 0.28;
    return finish(
      f,
      [
        ink(f, straight(at(stem, f.cap), at(left, bar)), BUTT, BUTT),
        thin(f, straight(at(left, bar), at(left + width, bar)), f.end, f.end),
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      ]);
  },

  five: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const shoulder = f.cap * 0.56;
    const radius = Math.min(shoulder, width / 2);
    return finish(
      f,
      [
        thin(f, straight(at(left, f.cap), at(left + width, f.cap)), f.end, f.end),
        ink(f, straight(at(left, f.cap), at(left, shoulder)), BUTT, BUTT),
        ink(f, turn(at(left + radius, radius), radius, 100, -150), BUTT, f.end),
      ]);
  },

  six: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const radius = width / 2;
    const centre = at(left + radius, radius);
    return finish(
      f,
      [
        ink(f, ring(centre, radius)),
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
            turn(at(centre.x, f.cap - radius), radius, 60, 180),
            straight(at(centre.x - radius, f.cap - radius), at(centre.x - radius, radius)),
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
    return finish(
      f,
      [
        thin(f, straight(at(left, f.cap), at(left + width, f.cap)), f.end, BUTT),
        ink(f, straight(at(left + width, f.cap), at(left + width * 0.28, 0)), BUTT, f.end),
      ]);
  },

  eight: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const lower = f.cap * 0.28;
    const upper = f.cap - f.cap * 0.22;
    return finish(
      f,
      [
        ink(f, ring(at(left + width / 2, upper), f.cap * 0.22)),
        ink(f, ring(at(left + width / 2, lower), lower)),
      ],
      true);
  },

  nine: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const radius = width / 2;
    const centre = at(left + radius, f.cap - radius);
    return finish(
      f,
      [
        ink(f, ring(centre, radius)),
        // The mirror of a six: down the right from the bowl, then round the
        // bottom and away.
        ink(
          f,
          chain(
            straight(at(centre.x + radius, f.cap - radius), at(centre.x + radius, radius)),
            turn(at(centre.x, radius), radius, 0, -120),
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
    const radius = figureWidth(f) * 0.42;
    const centre = at(f.edge + radius, f.cap - radius);
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
      [thin(f, straight(at(f.edge, f.x * 0.46), at(f.edge + width, f.x * 0.46)), f.plain, f.plain)]);
  },

  parenleft: (style) => {
    const f = frame(style);
    const radius = f.cap * 0.72;
    const centre = at(f.edge + radius, f.cap * 0.4);
    return finish(
      f,
      [ink(f, turn(centre, radius, 145, 215), f.end, f.end)]);
  },

  parenright: (style) => {
    const f = frame(style);
    const radius = f.cap * 0.72;
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
};

/**
 * How wide a figure is.
 *
 * Every digit gets the same width, which is what lets a column of numbers line
 * up. It is narrower than a capital, because ten shapes have to stay apart from
 * each other at that one width.
 */
function figureWidth(frame: Frame): number {
  return frame.cap * 0.62;
}
