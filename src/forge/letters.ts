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
import {
  bowl,
  bowlBetween,
  bowlPoint,
  reversed,
  roundCorners,
  spineEnd,
  spineStart,
} from "./shapes";
import { MITER_LIMIT } from "./sweep";
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
export type PartName = "slab" | "shoulder" | "bowl" | "corner" | "terminal" | "crossbar";

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
function bow(f: Frame, from: Vec2, to: Vec2, amount: number): Spine {
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
  const least = half * 1.06;
  // The bowl's own proportion and the face's width multiply: one says how a
  // bowl sits against its height, the other how wide the whole face runs.
  const wide = style.parts.bowl.width * metrics.width;
  const bowlH = Math.max(metrics.xHeight / 2 + metrics.overshoot, least);
  const capBowlH = Math.max(metrics.capHeight / 2 + metrics.overshoot, least);
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
    bowlH,
    capBowl: Math.max(capBowlH * wide, least),
    capBowlH,
    square: style.parts.bowl.squareness,
    wide,
    least,
    radius: style.parts.corner.radius,
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
  if (hasCorner(spine)) uses("corner");
  return {
    spine: roundCorners(spine, frame.radius, frame.half),
    pen: frame.style.pen,
    start,
    end,
    join: frame.style.parts.corner.join,
  };
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
  const point = f.half / Math.max(sinHalf, 1 / MITER_LIMIT);
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
  return radius + f.half - radius / sinHalf;
}

/** The one-corner case, which is most of them. */
function corner(f: Frame, from: Vec2, tip: Vec2, to: Vec2): Vec2 {
  return through(f, [from, tip, to])[1];
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
  // Never tighter than half the pen: below that the inside of the turn would
  // pass through itself, which a high springing on a heavy face asks for.
  const radius = Math.max(
    frame.half,
    Math.min(reach, height * (1 - frame.style.parts.shoulder.spring)),
  );
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
  const radius = Math.max(
    frame.half,
    Math.min(reach, height * (1 - frame.style.parts.shoulder.spring)),
  );
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
   */
  const radius = Math.max(height / 4, frame.least);
  const middle = left + bendWidth(frame, radius);
  const foot = height / 2 - radius * 2;
  const upper = at(middle, foot + radius * 3);
  const lower = at(middle, foot + radius);
  return {
    stroke: ink(
      frame,
      chain(bend(frame, upper, radius, 25, 270), bend(frame, lower, radius, 90, -155)),
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
): Stroke {
  return ink(
    f,
    bowlBetween(centre, halfWidth, halfHeight, 1 - f.square, f.half, fromDegrees, toDegrees),
    f.end,
    f.end,
  );
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
    const stem = centre.x + f.bowl;
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
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
    const stem = centre.x + f.bowl;
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
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
    const radius = Math.max(f.arch * 0.7, f.least);
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
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
    const radius = Math.max(f.arch * 0.62, f.least);
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
    const arm = at(reach, f.x);
    const leg = at(reach, 0);
    const meet = corner(f, arm, at(stem + f.half, junction), leg);
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
    const radius = Math.max(f.arch * 0.42, f.least);
    const stem = f.edge + f.arch * 0.35;
    const reach = f.arch * 0.7;
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
            straight(at(stem, f.asc * 0.78), at(stem, radius)),
            turn(at(stem + radius, radius), radius, 180, 270),
          ),
          f.end,
          f.end,
        ),
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
    const top = at(left, f.x);
    const other = at(middle + half, f.x);
    const point = corner(f, top, at(middle, 0), other);
    return finish(
      f,
      [ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end)]);
  },

  w: (style) => {
    const f = frame(style);
    const half = f.arch * 0.72;
    const left = f.edge;
    const top = f.x;
    const points = through(
      f,
      [0, 1, 2, 3, 4].map((step) => at(left + half * step, step % 2 === 0 ? top : 0)),
    );
    return finish(
      f,
      [
        ink(
          f,
          chain(
            straight(points[0], points[1]),
            straight(points[1], points[2]),
            straight(points[2], points[3]),
            straight(points[3], points[4]),
          ),
          f.end,
          f.end,
        ),
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
    const start = at(left, f.x);
    const end = at(left + width, 0);
    const upper = corner(f, start, at(left + width, f.x), at(left, 0));
    const lower = corner(f, at(left + width, f.x), at(left, 0), end);
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
    const half = f.capBowl * 0.86;
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
    const upperR = (f.cap - upper) / 2 + f.half * 0.2;
    const lowerR = upper / 2 + f.half * 0.2;
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
        belly(f, at(stem, f.cap - upperR), reach, upperR, -90, 90),
        belly(f, at(stem, lowerR), reach, lowerR, -90, 90),
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
    const radius = Math.max(f.cap / 2, f.least);
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
        openBowl(f, centre, f.capBowl, f.capBowlH, opens, 360 + past),
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
    const arm = at(reach, f.cap);
    const leg = at(reach, 0);
    // Arm and leg are one run meeting at the stem, so the corner between them
    // is turned rather than left as two square ends. Its point is put on the
    // stem's far edge, which is where a K's junction belongs.
    const meet = corner(f, arm, at(stem + f.half, junction), leg);
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
        thin(f, straight(at(stem, 0), at(stem + reach, 0)), BUTT, f.end),
      ]);
  },

  M: (style) => {
    const f = frame(style);
    const left = f.edge;
    const width = f.capBowl * 1.7;
    const middle = left + width / 2;
    const right = left + width;
    const dip = f.cap * 0.16;
    const into = stub(f);
    const start = at(left, f.cap - into);
    const end = at(right, f.cap - into);
    const topLeft = corner(f, start, at(left, f.cap), at(middle, dip));
    const vertex = corner(f, at(left, f.cap), at(middle, dip), at(right, f.cap));
    const topRight = corner(f, at(middle, dip), at(right, f.cap), end);
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
    const top = corner(f, start, at(left, f.cap), at(right, 0));
    const foot = corner(f, at(left, f.cap), at(right, 0), end);
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
        belly(f, at(stem, f.cap - radius), radius * f.wide, radius, -90, 90),
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
    const junction = f.cap - radius * 2;
    const reach = stem + radius * 1.9;
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        belly(f, at(stem, f.cap - radius), radius * f.wide, radius, -90, 90),
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
    const top = at(left, f.cap);
    const other = at(middle + half, f.cap);
    const point = corner(f, top, at(middle, 0), other);
    return finish(
      f,
      [ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end)]);
  },

  W: (style) => {
    const f = frame(style);
    const half = f.capBowl * 0.7;
    const left = f.edge;
    const top = f.cap;
    const points = through(
      f,
      [0, 1, 2, 3, 4].map((step) => at(left + half * step, step % 2 === 0 ? top : 0)),
    );
    return finish(
      f,
      [
        ink(
          f,
          chain(
            straight(points[0], points[1]),
            straight(points[1], points[2]),
            straight(points[2], points[3]),
            straight(points[3], points[4]),
          ),
          f.end,
          f.end,
        ),
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
    const top = at(left, f.cap);
    const other = at(middle + half, f.cap);
    const point = corner(f, top, at(middle, junction), other);
    return finish(
      f,
      [
        ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end),
        // The stem stops at the vee's own vertex, where the ink is thickest, so
        // its square top is buried rather than showing as a step.
        ink(f, straight(at(middle, 0), point), f.end, BUTT),
      ]);
  },

  Z: (style) => {
    const f = frame(style);
    const width = f.capBowl * 1.4;
    const left = f.edge;
    const start = at(left, f.cap);
    const end = at(left + width, 0);
    /*
     * One run, bar to diagonal to bar, rather than three that meet at points.
     *
     * The bars used to be drawn with the lighter crossbar pen, which is what a
     * serif face wants -- but a Z has no crossbar, it has two arms, and the pen
     * already thins a horizontal on any face with contrast. Two mechanisms were
     * doing the same job and only one of them can also turn a corner.
     */
    const upper = corner(f, start, at(left + width, f.cap), at(left, 0));
    const lower = corner(f, at(left + width, f.cap), at(left, 0), end);
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
    return finish(f, [ink(f, ring(f, centre, half, f.cap / 2))], true);
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
    const radius = Math.max(width / 2, f.least);
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
    const over = bend(f, centre, radius, 190, leaves);
    return finish(f, [
      ink(f, over, f.end, BUTT),
      ink(f, straight(spineEnd(over), at(left, 0)), BUTT, BUTT),
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
        ink(f, bend(f, at(middle, f.cap - radius), radius, 160, -90), f.end, BUTT),
        ink(f, bend(f, at(middle, radius), radius, 90, -160), BUTT, f.end),
      ],
      true);
  },

  four: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const stem = left + width * 0.72;
    const bar = f.cap * 0.28;
    const top = at(stem, f.cap);
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
        thin(f, straight(at(left, f.cap), at(left + width, f.cap)), f.end, f.end),
        ink(f, straight(at(left, f.cap), at(left, shoulder)), BUTT, BUTT),
        ink(f, bend(f, at(left + radius, radius), radius, 100, -150), BUTT, f.end),
      ]);
  },

  six: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const radius = Math.max(width / 2, f.least);
    const centre = at(left + radius, radius);
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
            bend(f, at(centre.x, f.cap - radius), radius, 60, 180),
            straight(
              at(centre.x - bendWidth(f, radius), f.cap - radius),
              at(centre.x - bendWidth(f, radius), radius),
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
    const start = at(left, f.cap);
    const end = at(left + width * 0.28, 0);
    const meet = corner(f, start, at(left + width, f.cap), end);
    return finish(
      f,
      [ink(f, chain(straight(start, meet), straight(meet, end)), f.end, f.end)]);
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
        ink(f, ring(f, at(left + width / 2, upper), bendWidth(f, f.cap * 0.22), Math.max(f.cap * 0.22, f.least))),
        ink(f, ring(f, at(left + width / 2, lower), bendWidth(f, lower), Math.max(lower, f.least))),
      ],
      true);
  },

  nine: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const radius = Math.max(width / 2, f.least);
    const centre = at(left + radius, f.cap - radius);
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
              at(centre.x + bendWidth(f, radius), f.cap - radius),
              at(centre.x + bendWidth(f, radius), radius),
            ),
            bend(f, at(centre.x, radius), radius, 0, -120),
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
};

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
        const half = f.capBowl * 0.86;
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
        const width = f.capBowl * 1.7;
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
          ink(f, bow(f, at(stem, junction), at(stem + legRadius * 1.5, 0), 0.14), BUTT, f.end),
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
        const stem = f.edge + f.arch * 0.35;
        const reach = f.arch * 0.7;
        return finish(f, [
          ink(f, straight(at(stem, 0), at(stem, f.asc * 0.78)), f.end, f.end),
          thin(f, straight(at(stem - reach * 0.7, f.x), at(stem + reach, f.x)), f.end, f.end),
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
          ink(f, straight(point, at(point.x, f.desc)), BUTT, f.end),
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
              straight(at(stem, f.cap), at(stem, f.desc + radius + f.half)),
              turn(at(stem - radius, f.desc + radius + f.half), radius, 0, -95),
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
        const stem = f.edge + radius;
        const lower = Math.max(f.arch * 0.5, f.least);
        const top = f.asc - radius - f.half;
        const base = f.desc + lower + f.half;
        /*
         * Written from the top of the hook downwards, which is the direction
         * the whole run travels.
         *
         * Written the other way up it read as three pieces that happened to be
         * listed together: the first turn ended nowhere near where the straight
         * began, the chain had a jump in it, and the letter folded. A chain is
         * a journey, and every piece has to leave where the last one arrived.
         */
        return finish(f, [
          ink(
            f,
            chain(
              turn(at(stem - radius, top), radius, 92, 0),
              straight(at(stem, top), at(stem, base)),
              turn(at(stem - lower, base), lower, 0, -95),
            ),
            f.end,
            f.end,
          ),
          thin(f, straight(at(stem - f.arch * 0.5, f.x), at(stem + f.arch * 0.5, f.x)), f.end, f.end),
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
          ink(f, straight(at(stem - flag, f.cap * 0.8), at(stem, f.cap)), f.end, BUTT),
          thin(f, straight(at(stem - flag, 0), at(stem + flag, 0)), f.end, f.end),
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
          ink(f, straight(at(stem, f.cap), at(left, bar)), BUTT, f.end),
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
        const start = at(left, f.cap);
        const end = at(left + width * 0.28, 0);
        const meet = corner(f, start, at(left + width, f.cap), end);
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
        const half = f.capBowl * 0.62;
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
              straight(at(stem, f.x), at(stem, f.desc + radius + f.half)),
              turn(at(stem - radius, f.desc + radius + f.half), radius, 0, -150),
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

/** The recipe for a letter, in whichever form has been chosen. */
export function recipeOf(
  name: LetterName,
  form?: string,
): ((style: Style) => Recipe) | undefined {
  if (form) {
    const chosen = ALTERNATES[name]?.find((alternate) => alternate.id === form);
    if (chosen) return chosen.build;
  }
  return LETTERS[name];
}
