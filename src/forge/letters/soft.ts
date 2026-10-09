/**
 * The soft text serif's own letters: the a whose bowl leans and whose foot
 * curls up instead of standing on a serif, the y whose tail swings out wide
 * and level under the line into a long pear, and the f whose bar is a little
 * heavier than the face's crossbars and hangs a little under the line.
 *
 * Offered on every face, like the humanist forms, and drawn there with the
 * face's own pen, parts and finishes: the curl and the swing are skeletons,
 * and the pear, the taper and the rounding they are drawn with belong to the
 * face. A face with none of those finishes draws these with plain ends.
 *
 * Every number a tuning pass might move is a named export here, so it can be
 * moved without reading the construction. Each is written in the terms the
 * construction uses -- degrees, stems, shares of the x-height -- and only
 * ever sizes a piece: which pieces a letter has, and which of them are
 * straight and which turn, is fixed by the recipe and never by the pen, so
 * each of these letters keeps its points at every weight and width.
 */

import type { Vec2 } from "@/font/types";
import { bowl, bowlBetween, spineEnd, spineStart } from "../shapes";
import { penReach, piecesFor, reachAlong } from "../sweep";
import type { Style } from "../style";
import type { Spine, SpineSegment, Stroke, Terminal } from "../types";
import { buried, heftable, seen } from "./hints";
import {
  at,
  BUTT,
  chain,
  deg,
  finish,
  frame,
  headingAt,
  heaviness,
  inherit,
  ink,
  LEVEL,
  type Recipe,
  remember,
  ring,
  rippled,
  roundHalf,
  straight,
  turn,
  uses,
} from "./common";

// ---------------------------------------------------------------------------
// The curled a
// ---------------------------------------------------------------------------

/** How far the a's bowl is turned anticlockwise about its centre, in degrees, at a text weight. */
export const CURLED_TILT = 20;

/**
 * How much of that turn a heavy weight gives up, by a heaviness of one: a
 * bowl leaning a full twenty degrees at a Black pushes its upper left into
 * the arch's drop.
 */
export const CURLED_TILT_EASE = 0.5;

/** Where the top of the bowl's spine stands, in x-heights, before it is turned. */
export const CURLED_BOWL_TOP = 0.42;

/** How much wider than tall the bowl is drawn, before it is turned. */
export const CURLED_BOWL_WIDE = 1.45;

/** How much lighter than the stem the bowl's pen is, by a heaviness of one: as the humanist a's. */
export const CURLED_BOWL_LIGHT = 0.4;

/**
 * How far the stem stands into the turned bowl's right side, in half pens.
 *
 * None: the stem's outer edge on the bowl's, as the humanist a's is. Set a
 * third of a half pen further in, the bowl's turned side stood out past the
 * stem as a knob just above the foot.
 */
export const CURLED_TUCK = 0;

/** The radius the foot curls up through, in stems, at a text weight. */
export const CURLED_FOOT = 0.7;

/**
 * How much of that radius a heavy weight gives up, by a heaviness of one,
 * never below the least the pen goes round: held at seven tenths of a
 * Black's stem, the foot's curl ran out a whole stem past the letter.
 */
export const CURLED_FOOT_EASE = 0.2;

/**
 * Where on its circle the foot's curl starts, in degrees: ten degrees under
 * the level on the right, so the end points up at eighty, nearly upright.
 * Tuned against the reference: started thirty under, pointing up and out at
 * sixty, every a in it matched less well.
 */
export const CURLED_FOOT_FROM = 350;

/**
 * How many degrees of that curl a heavy weight gives up, by a heaviness of
 * one, so its end points out rather than up. Turned the whole way round on
 * a radius barely wider than the pen, a Black's foot came back up beside its
 * own stem and left a slit between the two.
 */
export const CURLED_FOOT_FLATTEN = 30;

/** How far round the arch turns into its drop, in degrees from the stem, at a text weight. */
export const CURLED_END = 165;

/**
 * How many degrees of that turn a heavy weight gives up, by a heaviness of
 * one, and half as many again for the next half (as the humanist a's arch
 * gives up its own). Turned the whole way over at a Black, the arch's end
 * pointed straight down and its drop hung on the bowl's shoulder, closing
 * the opening under the head.
 */
export const CURLED_END_EASE = 30;

/** How far the a's bowl comes down for the stem a heavy weight gains: as the humanist a's. */
const CURLED_SINK = 0.3;

/**
 * The least the bowl's counter is rounded at its ends, in its own pens: how
 * far the bowl's spine stands outside the pen's half at its tightest turn,
 * wherever the arch leaves the room for it.
 *
 * The bowl is a ring whose turns are as round as its height allows, so its
 * tightest turn is its height, and the counter's ends are that turn less the
 * pen's half. Held only to the least the pen goes round (the `CLEARANCE` a
 * bowl is never drawn under), a heavy weight's sink brought the bowl down to
 * exactly that: the counter's ends had nothing left to turn on and came out
 * as corners, and with its long sides still straight the counter was a
 * sharp-cornered slot, and leaning, a parallelogram. A third of a pen keeps
 * them turning, so the counter stays an oval to the Black, as the humanist
 * a's does, and at a text weight the bowl is taller than this anyway.
 */
export const CURLED_COUNTER = 0.35;

/**
 * The two-storey a of a soft text face: the bowl a lighter oval leaning back
 * into the stem, the arch turning well over into its drop, and the stem's
 * foot curling up to the right into a plain end where a serif would stand.
 *
 * The bowl is the humanist a's ring, made wider than it is tall and turned
 * about its own centre -- exactly, by turning each piece's centre and adding
 * the angle to its ends, so a turn stays a turn and a straight stays straight
 * -- and then set down so its turned spine's own extremes, measured piece by
 * piece, sit on the letter's edge and on the baseline's dip. The stem stands
 * on the bowl's right side, so the two are always one piece.
 *
 * Every piece is pinned to the number of pieces its own sweep asks for before
 * anything moves it: two turns that differ by a hair across a quarter would
 * otherwise be drawn in different numbers of pieces at different weights.
 *
 * Only ever eased by the weight, never switched: the tilt, the bowl's height
 * and the foot's curl each shrink continuously toward a Black, and nothing
 * the pen decides changes which pieces the letter is drawn with.
 */
export function curledA(style: Style): Recipe {
  const f = frame(style);
  const heavy = heaviness(f);
  const weight = f.style.pen.weight;
  const bowlPen = { ...f.style.pen, weight: weight * (1 - CURLED_BOWL_LIGHT * heavy) };
  // The arch as the humanist a draws it.
  const asked = Math.max(f.x * 0.31 - f.gain * CURLED_SINK, f.least);
  const wide = Math.max(asked * f.wide + f.half * 0.35 * heavy + f.gain * 0.2, f.least);
  const over = Math.max(Math.min(wide, f.x - asked * 2), f.half * 1.15, f.least);
  const top = f.crest(f.x) - over;
  /*
   * The bowl as tall as asked, coming down as a heavy weight gains stem as
   * the humanist a's does, and never taller than leaves the arch its
   * counter: held at a text weight's height, a Black's bowl met the drop.
   */
  const room = (top - f.dip(0)) / 2;
  /*
   * And never so low that its counter's ends stop turning (see
   * `CURLED_COUNTER`), where the arch leaves the room: past that the room
   * wins, and past that again the least the pen goes round.
   */
  const rounded = Math.min(bowlPen.weight * (0.5 + CURLED_COUNTER), room);
  const bh = Math.max(
    Math.min((CURLED_BOWL_TOP * f.x - f.dip(0)) / 2 - f.gain * CURLED_SINK, room),
    rounded,
    bowlPen.weight * 0.55,
  );
  const bw = Math.max(bh * CURLED_BOWL_WIDE, f.least);
  const tilt = deg(CURLED_TILT * (1 - CURLED_TILT_EASE * Math.min(1, heavy)));
  // Drawn about the origin and turned there, then set down on its extremes.
  const ringed = ink(f, ring(f, at(0, 0), bw, bh));
  const turned = turnedAbout(
    inherit(ringed, {
      ...ringed,
      // Held open for its own lighter pen, not the stem's: see `bowl`.
      spine: bowl(at(0, 0), bw, bh, 1 - f.square, bowlPen.weight / 2, f.curve),
      pen: bowlPen,
    }),
    at(0, 0),
    tilt,
  );
  const box = extentOf(turned.spine);
  const bowlStroke = movedBy(turned, f.edge - box.xMin, f.dip(0) - box.yMin);
  const stem = f.edge - box.xMin + box.xMax + (weight - bowlPen.weight) / 2 - f.half * CURLED_TUCK;
  /*
   * The foot's curl, never tighter than the pen goes round with room inside
   * it, and never so large that the stem it rises into runs backwards: at
   * the heaviest weights the arch comes down to meet it, and the straight
   * between them is held at a little of the pen rather than turned over.
   */
  const rise = Math.max(0, top - f.dip(0) - f.half * 0.1);
  const curl = CURLED_FOOT * weight * (1 - CURLED_FOOT_EASE * Math.min(1, heavy));
  const rf = Math.max(f.least, Math.min(curl, rise));
  const foot = f.dip(0) + rf;
  const from = CURLED_FOOT_FROM - CURLED_FOOT_FLATTEN * Math.min(1, heavy);
  const crown = Math.max(top, foot);
  const end =
    CURLED_END -
    CURLED_END_EASE * Math.min(1, heavy) -
    CURLED_END_EASE * 0.5 * Math.min(1, Math.max(0, heavy - 1) * 2);
  return finish(f, [
    bowlStroke,
    ink(
      f,
      chain(
        inPieces(turn(at(stem + rf, foot), rf, from, 180), 2),
        straight(at(stem, foot), at(stem, crown)),
        inPieces(turn(at(stem - over, crown), over, 0, end), 2),
      ),
      f.end,
      f.end,
    ),
  ]);
}

// ---------------------------------------------------------------------------
// The swung y
// ---------------------------------------------------------------------------

/**
 * How much larger the swung tail's turn is than the hooked y's: a little,
 * so it runs out lower and longer under the line. At half as large again
 * the knee rose and the tail bent through a wide, shallow curve with none
 * of the reference's run along the bottom.
 */
export const SWUNG_HOOK = 1.1;

/**
 * The least radius the swung tail is asked to turn through, in half pens,
 * where the knee has the room for it (see `swungY`).
 */
export const SWUNG_LEAST = 1.9;

/**
 * Where the tail stops turning, in degrees on its circle: past the bottom,
 * rising a little to the left.
 *
 * Past it rather than on it, for the pear. A drop is pulled back along the
 * stroke to make room for itself, and a pear by what its ball is carried on
 * besides -- about fifteen degrees of this turn at a text weight -- and a
 * tail stopped at the bottom was cut back to where it still ran down to
 * the left. Hung from there the ball fell below the stroke's own band and
 * was shrunk to the least that covers the end.
 */
export const SWUNG_END = -108;

/**
 * How far round the crotch side of the left arm's buried end the join is
 * rounded, against the face's own `corner.fillet`: less than the hooked y's,
 * so the vee keeps the reference's narrow crotch.
 */
export const SWUNG_CROTCH = 0.5;

/** How many of its radii the tail's pear is carried on, against the face's own hang. */
export const SWUNG_HANG = 2.5;

/** How much bigger the tail's pear is asked to be, against the face's own drop size. */
export const SWUNG_SIZE = 1.1;

/**
 * The y of a soft text face: the hooked y's vee, with its tail turning
 * through a wider curve, running out along the bottom and stopping heading
 * left, where a pear on a face that hangs them is carried on out level
 * under the letter before.
 *
 * The tail keeps the hooked y's construction -- one straight run and then
 * only turns -- so a face that thins its rising arms still finds it (see
 * `splitVees`). Its turn is never so wide that the place it leaves the
 * straight rises past where the left arm stops: the left arm ends buried in
 * the tail's straight run, and stopping on the curve its square end stood
 * out of the tail.
 */
export function swungY(style: Style): Recipe {
  const f = frame(style);
  const half = f.arch * 0.92;
  const left = f.edge;
  const middle = left + half;
  const top = at(middle + half, f.x);
  const apex = at(middle, 0);
  // Where the left arm stops: on the tail's own spine, just above the baseline.
  const lift = f.half * 0.5;
  const stop = at(middle + (half * lift) / f.x, lift);
  const heading = {
    x: (apex.x - top.x) / Math.hypot(half, f.x),
    y: -f.x / Math.hypot(half, f.x),
  };
  // To the right of the way the tail is going, which is where it turns.
  const right = { x: heading.y, y: -heading.x };
  const hooked = Math.max(f.arch * 0.62, f.half * 1.7);
  /*
   * And no wider than the turn whose knee is level with the left arm's stop,
   * though never tighter than the pen goes round: at the Sans's heaviest the
   * hooked y's own turn already lifted its knee past the stop.
   */
  const room = (lift - f.dip(f.desc)) / (1 - right.y);
  const radius = Math.max(
    f.least,
    Math.min(Math.max(hooked * SWUNG_HOOK, f.half * SWUNG_LEAST), room),
  );
  const centreY = f.dip(f.desc) + radius;
  const kneeY = centreY - radius * right.y;
  const along = (kneeY - top.y) / heading.y;
  const knee = at(top.x + heading.x * along, kneeY);
  const centre = at(knee.x + radius * right.x, centreY);
  const from = (Math.atan2(knee.y - centre.y, knee.x - centre.x) * 180) / Math.PI;
  /*
   * The tail's end asks for a long, slightly larger pear. Spread, it is no
   * longer the face's own terminal, so the terminal part is noted here.
   */
  uses("terminal");
  const tail: Terminal = { ...f.end, pear: { hang: SWUNG_HANG, size: SWUNG_SIZE } };
  return finish(f, [
    // Its join with the tail rounded on the crotch side: see `buried`.
    ink(f, straight(at(left, f.x), stop), f.end, buried(f, { left: SWUNG_CROTCH })),
    ink(
      f,
      chain(straight(top, knee), inPieces(turn(centre, radius, from, SWUNG_END), 2)),
      f.end,
      tail,
    ),
  ]);
}

// ---------------------------------------------------------------------------
// The tucked f
// ---------------------------------------------------------------------------

/*
 * The tucked f's bar, set against the reference's f: its bar reaches back
 * past the stem about as far as a plain f's does and a little further out
 * to the right, is a quarter heavier than the face's other crossbars, and
 * hangs its top a third of its own weight under the x-height. Drawn as first
 * planned -- a stub half as long on the left, as light as a crossbar, its
 * top on the line -- it matched the reference worse than the plain f it was
 * meant to improve on: the stub left the bar's left half missing, and the
 * whole bar stood half its weight too high and was a fifth too thin.
 */

/**
 * How far the tucked f's bar reaches back past its stem, against the plain
 * f's: a little short of it, so the side that stops in the stem's ink, its
 * join rounded, is still the shorter one.
 */
export const TUCKED_LEFT = 0.95;

/** How far the tucked f's bar reaches out to the right of its stem, against the plain f's. */
export const TUCKED_RIGHT = 1.1;

/** How much heavier the tucked f's bar is than the face's crossbars. */
export const TUCKED_BAR = 1.25;

/**
 * How far under the x-height the tucked f's bar hangs its top, in its own
 * weights: none would hang it on the line, as the plain f's is.
 */
export const TUCKED_SINK = 0.3;

/**
 * The f of a soft text face: the plain f's stem and hook, and its bar in two
 * pieces leaving the stem's middle -- the left one stopping in the stem with
 * its join rounded above it, the right one running out from inside it --
 * a little heavier than the face's crossbars and hung a little under the line.
 *
 * Two strokes and not one, so the left side can say how its join is
 * rounded; both far ends are the crossbar's own seen cuts. The hook is the
 * plain f's, so the letter still reads as an f and not a t.
 */
export function tuckedF(style: Style): Recipe {
  const f = frame(style);
  // The plain f's, to the unit: see `LETTERS.f`.
  const radius = Math.max(roundHalf(f) * 0.6, f.least);
  const left = Math.max(roundHalf(f) * 0.36, f.least, f.half * 1.5);
  const stem = f.edge + left;
  const top = f.crest(f.asc) - radius;
  const share = f.bar * TUCKED_BAR;
  const height = f.hangs(f.x, share * (1 + 2 * TUCKED_SINK));
  // The crossbar's cut: see `crossbar`.
  const cut: Terminal =
    f.plain.kind === "angled" || f.plain.kind === "round" ? f.plain : { ...f.plain, level: true };
  return finish(f, [
    ink(
      f,
      chain(straight(at(stem, 0), at(stem, top)), turn(at(stem + radius, top), radius, 180, 88)),
      f.end,
      f.end,
    ),
    // Travelling left, so its top is on its right.
    bar(
      f,
      share,
      straight(at(stem, height), at(stem - left * TUCKED_LEFT, height)),
      buried(f, { right: 1 }),
      seen(f, cut),
    ),
    bar(
      f,
      share,
      straight(at(stem, height), at(stem + roundHalf(f) * 0.57 * TUCKED_RIGHT, height)),
      BUTT,
      seen(f, cut),
    ),
  ]);
}

/**
 * A bar drawn as `thin` draws one, but `share` of the face's stem heavy
 * rather than the crossbar's own share: the same pen, waved against its own
 * width.
 */
function bar(
  f: ReturnType<typeof frame>,
  share: number,
  spine: Spine,
  start: Terminal,
  end: Terminal,
): Stroke {
  uses("crossbar");
  const { pen } = f.style;
  const weight = pen.weight * share;
  return remember({ spine: rippled(f, spine, weight / 2), pen: { ...pen, weight }, start, end });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** How far a spine reaches each way: its straights' ends, and each turn's own extremes where it passes them. */
function extentOf(spine: Spine): { xMin: number; xMax: number; yMin: number; yMax: number } {
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  const take = (point: Vec2) => {
    xMin = Math.min(xMin, point.x);
    xMax = Math.max(xMax, point.x);
    yMin = Math.min(yMin, point.y);
    yMax = Math.max(yMax, point.y);
  };
  for (const segment of spine.segments) {
    if (segment.kind === "line") {
      take(segment.from);
      take(segment.to);
      continue;
    }
    const { centre, radius, startAngle, endAngle, sweepPositive } = segment;
    const on = (angle: number) =>
      at(centre.x + radius * Math.cos(angle), centre.y + radius * Math.sin(angle));
    take(on(startAngle));
    take(on(endAngle));
    const span = Math.abs(endAngle - startAngle);
    const way = sweepPositive ? 1 : -1;
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      // How far round from the start, the way the turn goes, the extreme is.
      const round = ((((angle - startAngle) * way) % TAU) + TAU) % TAU;
      if (round <= span) take(on(angle));
    }
  }
  return { xMin, xMax, yMin, yMax };
}

/** A whole turn. */
const TAU = 2 * Math.PI;

/** A stroke moved bodily by so much across and up. */
function movedBy(stroke: Stroke, dx: number, dy: number): Stroke {
  const to = (point: Vec2): Vec2 => at(point.x + dx, point.y + dy);
  const spine: Spine = {
    closed: stroke.spine.closed,
    segments: stroke.spine.segments.map((segment) =>
      segment.kind === "line"
        ? { ...segment, from: to(segment.from), to: to(segment.to) }
        : { ...segment, centre: to(segment.centre) },
    ),
  };
  return inherit(stroke, { ...stroke, spine });
}

/** A run whose turns are each drawn in so many pieces at every weight: see `SpineArc.pieces`. */
function inPieces(spine: Spine, pieces: number): Spine {
  return {
    ...spine,
    segments: spine.segments.map((one) => (one.kind === "arc" ? { ...one, pieces } : one)),
  };
}

/**
 * A stroke turned anticlockwise about a point by `radians`: each straight's
 * ends and each turn's centre turned, and each turn's angles carried round
 * by the same amount, so the run is the same run, leaning.
 *
 * Each turn is first pinned to the pieces its own sweep asks for (`piecesFor`),
 * so carrying its angles round cannot change that count by a rounding error.
 */
function turnedAbout(stroke: Stroke, about: Vec2, radians: number): Stroke {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const to = (point: Vec2): Vec2 =>
    at(
      about.x + (point.x - about.x) * cos - (point.y - about.y) * sin,
      about.y + (point.x - about.x) * sin + (point.y - about.y) * cos,
    );
  const spine: Spine = {
    closed: stroke.spine.closed,
    segments: stroke.spine.segments.map((segment) =>
      segment.kind === "line"
        ? { ...segment, from: to(segment.from), to: to(segment.to) }
        : {
            ...segment,
            centre: to(segment.centre),
            startAngle: segment.startAngle + radians,
            endAngle: segment.endAngle + radians,
            pieces: segment.pieces ?? piecesFor(segment.endAngle - segment.startAngle),
          },
    ),
  };
  return inherit(stroke, { ...stroke, spine });
}

// ---------------------------------------------------------------------------
// The belted a
// ---------------------------------------------------------------------------

/** How far the belted a's bowl is turned anticlockwise about its centre, in degrees, at a text weight. */
export const BELTED_TILT = 25;

/** How much of that turn a heavy weight gives up, by a heaviness of one: as the curled a's. */
export const BELTED_TILT_EASE = 0.5;

/** Where the top of the belted a's bowl stands, in x-heights, before it is turned. */
export const BELTED_BOWL_TOP = 0.415;

/** How much wider than tall the belted a's bowl is drawn, before it is turned. */
export const BELTED_BOWL_WIDE = 1.4875;

/**
 * Where on its bowl the belt leaves the stem, in degrees round the bowl
 * before it is turned: short of its top, so turned it leaves the stem running
 * nearly level, the pen's thin way, as a hairline.
 */
export const BELTED_LEAVES = 55;

/**
 * Where on its bowl the belt comes back into the stem, in degrees round the
 * bowl before it is turned: well past its foot, so it rises into the stem low
 * and the stem's foot curls away under it.
 */
export const BELTED_JOINS = 330;

/**
 * The most the belt's ends are carried on along their own headings into the
 * stem, in the bowl's half-widths: where a heading runs nearly upright the
 * run to the stem would go on for ever.
 */
export const BELTED_REACH = 1.5;

/**
 * How much heavier the belt is drawn than the curled a's bowl at a text
 * weight, easing to as heavy by a Bold: drawn as one stroke the bowl's heavy
 * side is its own, where the curled a's ring shares the stem's.
 */
export const BELTED_HEAVIER = 1.12;

/**
 * The two-storey a of a soft text face with its bowl drawn as one open
 * stroke, as an e's belt is drawn: leaving the stem high as a hairline,
 * turning down round the bowl's heavy side and along its foot, and rising
 * back into the stem low, where the stem's foot curls away under it. The
 * curled a's arch, stem and foot (see `curledA`), and its bowl's lean and
 * placing; what the stem stands in is the bowl's right side.
 *
 * The bowl is the part of a ring between `BELTED_LEAVES` and `BELTED_JOINS`,
 * turned about its centre exactly and set down by the whole ring's extremes,
 * as the curled a's is; each end is then carried on straight along its own
 * heading until it is buried in the stem. Those two runs are kept at every
 * weight, of no length where the bowl already reaches into the stem, so the
 * letter keeps its points.
 */
export function beltedA(style: Style): Recipe {
  const f = frame(style);
  const heavy = heaviness(f);
  const weight = f.style.pen.weight;
  const heavier = 1 + (BELTED_HEAVIER - 1) * Math.max(0, 1 - heavy);
  const bowlPen = { ...f.style.pen, weight: weight * (1 - CURLED_BOWL_LIGHT * heavy) * heavier };
  // The curled a's arch, foot and bowl, to the unit: see `curledA`.
  const asked = Math.max(f.x * 0.31 - f.gain * CURLED_SINK, f.least);
  const wide = Math.max(asked * f.wide + f.half * 0.35 * heavy + f.gain * 0.2, f.least);
  const over = Math.max(Math.min(wide, f.x - asked * 2), f.half * 1.15, f.least);
  const top = f.crest(f.x) - over;
  const room = (top - f.dip(0)) / 2;
  const rounded = Math.min(bowlPen.weight * (0.5 + CURLED_COUNTER), room);
  const bh = Math.max(
    Math.min((BELTED_BOWL_TOP * f.x - f.dip(0)) / 2 - f.gain * CURLED_SINK, room),
    rounded,
    bowlPen.weight * 0.55,
  );
  const bw = Math.max(bh * BELTED_BOWL_WIDE, f.least);
  const tilt = deg(BELTED_TILT * (1 - BELTED_TILT_EASE * Math.min(1, heavy)));
  const roundness = 1 - f.square;
  const half = bowlPen.weight / 2;
  // Set down by the whole ring's extremes, as the curled a's bowl is.
  const whole = turnedRun(bowl(at(0, 0), bw, bh, roundness, half, f.curve), at(0, 0), tilt);
  const box = extentOf(whole);
  const dx = f.edge - box.xMin;
  const dy = f.dip(0) - box.yMin;
  const stem = dx + box.xMax + (weight - bowlPen.weight) / 2;
  const run = movedRun(
    turnedRun(
      bowlBetween(at(0, 0), bw, bh, roundness, half, BELTED_LEAVES, BELTED_JOINS, f.curve),
      at(0, 0),
      tilt,
    ),
    dx,
    dy,
  );
  /*
   * Each end carried on along the way it was going -- back from the start,
   * on from the end -- until both corners of its cut stand inside the stem,
   * and no further than the stem's middle: carried on to the middle at
   * every weight, a Black's bowl, which already sits well inside its stem,
   * ran both ends up the stem into each other and the belt crossed itself.
   */
  const most = bw * BELTED_REACH;
  const stemHalf = Math.abs(reachAlong(at(1, 0), penReach(f.style.pen)).x);
  const stemLeft = stem - stemHalf;
  const from = spineStart(run);
  const leaves = headingOf(run.segments, "start");
  const to = spineEnd(run);
  const joins = headingOf(run.segments, "end");
  // How far each corner of an end's cut stands to either side of its middle.
  const aside = (heading: Vec2, pen: typeof bowlPen): number =>
    Math.abs(reachAlong(at(-heading.y, heading.x), penReach(pen)).x);
  /*
   * And the belt drawn no wider across either end than the stem it is buried
   * in: on a pen with no contrast the belt rises into the stem nearly
   * upright, and a little heavier than the stem its cut stood out either side.
   */
  const margin = f.half * 0.1;
  const fits = Math.min(
    1,
    (stemHalf - margin) / Math.max(aside(leaves, bowlPen), 1e-9),
    (stemHalf - margin) / Math.max(aside(joins, bowlPen), 1e-9),
  );
  const beltPen = { ...bowlPen, weight: bowlPen.weight * Math.max(fits, 0.5) };
  const inside = (heading: Vec2): number =>
    Math.min(stem, stemLeft + aside(heading, beltPen) + margin);
  const back =
    leaves.x < -1e-6 ? Math.min(most, Math.max(0, (from.x - inside(leaves)) / leaves.x)) : 0;
  const on = joins.x > 1e-6 ? Math.min(most, Math.max(0, (inside(joins) - to.x) / joins.x)) : 0;
  const belt = chain(
    straight(at(from.x - leaves.x * back, from.y - leaves.y * back), from),
    run,
    straight(to, at(to.x + joins.x * on, to.y + joins.y * on)),
  );
  // Where the hairline leaves the stem, the join above it rounded: see `buried`.
  const inked = ink(f, belt, buried(f, { right: 1 }), BUTT);
  const bowlStroke = heftable(f, inherit(inked, { ...inked, pen: beltPen }));
  // The curled a's stem: its foot curl, its straight and its arch.
  const rise = Math.max(0, top - f.dip(0) - f.half * 0.1);
  const curl = CURLED_FOOT * weight * (1 - CURLED_FOOT_EASE * Math.min(1, heavy));
  const rf = Math.max(f.least, Math.min(curl, rise));
  const foot = f.dip(0) + rf;
  const footFrom = CURLED_FOOT_FROM - CURLED_FOOT_FLATTEN * Math.min(1, heavy);
  const crown = Math.max(top, foot);
  const end =
    CURLED_END -
    CURLED_END_EASE * Math.min(1, heavy) -
    CURLED_END_EASE * 0.5 * Math.min(1, Math.max(0, heavy - 1) * 2);
  return finish(f, [
    bowlStroke,
    ink(
      f,
      chain(
        inPieces(turn(at(stem + rf, foot), rf, footFrom, 180), 2),
        straight(at(stem, foot), at(stem, crown)),
        inPieces(turn(at(stem - over, crown), over, 0, end), 2),
      ),
      f.end,
      f.end,
    ),
  ]);
}

/**
 * Which way a run is going at its start or its end, read off the first (or
 * last) of its pieces that has any length: a bowl's run keeps pieces of no
 * length, which point nowhere.
 */
function headingOf(segments: SpineSegment[], which: "start" | "end"): Vec2 {
  const order = which === "start" ? segments : [...segments].reverse();
  for (const one of order) {
    const length =
      one.kind === "line"
        ? Math.hypot(one.to.x - one.from.x, one.to.y - one.from.y)
        : one.radius * Math.abs(one.endAngle - one.startAngle);
    if (length > 1e-9) return headingAt(one, which);
  }
  return headingAt(order[0], which);
}

/** A run turned anticlockwise about a point, exactly, each turn pinned first: see `turnedAbout`. */
function turnedRun(spine: Spine, about: Vec2, radians: number): Spine {
  const stroke: Stroke = {
    spine,
    pen: { weight: 1, contrast: 0, angle: 0 },
    start: BUTT,
    end: BUTT,
  };
  return turnedAbout(stroke, about, radians).spine;
}

/** A run moved bodily: see `movedBy`. */
function movedRun(spine: Spine, dx: number, dy: number): Spine {
  const stroke: Stroke = {
    spine,
    pen: { weight: 1, contrast: 0, angle: 0 },
    start: BUTT,
    end: BUTT,
  };
  return movedBy(stroke, dx, dy).spine;
}

// ---------------------------------------------------------------------------
// The wide-eyed e
// ---------------------------------------------------------------------------

/**
 * How much of the pen's lean the e gives up, nought to one: the e is written
 * with the nib held this much nearer the upright than the face's own, so its
 * stress stands nearer the upright and its eye's right side, which the face's
 * own lean makes the heaviest part of the letter, comes down to the bar no
 * heavier than a stem.
 */
export const WIDE_UPRIGHT = 0.25;

/** How heavy the wide-eyed e's bar is against the face's crossbars. */
export const WIDE_BAR = 0.8;

/** How heavy the wide-eyed e's pen is against the face's. */
export const WIDE_WEIGHT = 0.96;

/** How much wider the wide-eyed e is drawn than the face's own e. */
export const WIDE_WIDTH = 1.03;

/**
 * The e of a soft text face: the old-style e (`humanistE`, handed in as
 * `drawE`) written with its pen held nearer the upright, a little lighter and
 * a little wider, and with a lighter bar, so its eye opens wider -- light
 * along the bar and over the top, its right side no heavier than a stem --
 * and its weight sits in its sides.
 *
 * The whole letter is drawn with that pen and that bar, not changed after,
 * so the bar still meets the bowl along the bowl's own edge and the bowl's
 * start is still cut level at the bar's top.
 */
export function wideE(style: Style, drawE: (style: Style) => Recipe): Recipe {
  const { pen, parts, metrics } = style;
  return drawE({
    ...style,
    pen: { ...pen, weight: pen.weight * WIDE_WEIGHT, angle: pen.angle * (1 - WIDE_UPRIGHT) },
    metrics: { ...metrics, width: metrics.width * WIDE_WIDTH },
    parts: {
      ...parts,
      crossbar: { ...parts.crossbar, weight: parts.crossbar.weight * WIDE_BAR },
    },
  });
}

// ---------------------------------------------------------------------------
// The beaked s
// ---------------------------------------------------------------------------

/**
 * How many degrees each of the s's beaks turns through, tighter, after the
 * head (or the foot) stops: forty brings the old-style s's ends round to the
 * upright.
 */
export const BEAKED_TURN = 40;

/** How tight the turn of each beak is, in half pens: never tighter than the pen goes round. */
export const BEAKED_HOOK = 1.5;

/**
 * The s of a soft text face: the old-style s (`humanistS`, handed in as
 * `drawS`) with its head and foot each running on over a short, tighter turn
 * into a short beak of its own, cut plain and softened -- and on a face that
 * tapers its curved ends, tapered -- as the face finishes a seen end, where
 * the old-style s stands an upright serif's beak off each.
 *
 * Each beak's turn is laid inside the head's (or the foot's) own, on a circle
 * through the point where that stops whose centre lies on its radius, so the
 * run turns on without a corner; both turns are kept at every weight, so the
 * letter keeps its points.
 */
export function beakedS(style: Style, drawS: (style: Style) => Recipe): Recipe {
  const f = frame(style);
  const drawn = drawS(style);
  const [stroke, ...rest] = drawn.strokes;
  const segments = stroke?.spine.segments ?? [];
  const head = segments[0];
  const foot = segments[segments.length - 1];
  /*
   * Only on the old-style s's own run, its head turning up into it and its
   * foot out of it. A face whose runs undulate draws the plain s there (see
   * `bookS`), and keeps it: a wave ridden through a turn this tight folded
   * the Wavy's s at its heaviest.
   */
  const { wave } = style.parts;
  if (
    (wave.along !== "off" && wave.depth > 0) ||
    !stroke ||
    stroke.spine.closed ||
    segments.length < 3 ||
    head?.kind !== "arc" ||
    foot?.kind !== "arc" ||
    !head.sweepPositive ||
    foot.sweepPositive
  ) {
    return drawn;
  }
  const down = deg(BEAKED_TURN);
  const hook = Math.max(f.least, f.half * BEAKED_HOOK);
  // The head turns anticlockwise from its start, so its beak runs backwards from there.
  const headHook = Math.min(hook, head.radius);
  const c0 = at(
    head.centre.x + (head.radius - headHook) * Math.cos(head.startAngle),
    head.centre.y + (head.radius - headHook) * Math.sin(head.startAngle),
  );
  // The foot turns clockwise to its end, and its beak runs on clockwise.
  const footHook = Math.min(hook, foot.radius);
  const c1 = at(
    foot.centre.x + (foot.radius - footHook) * Math.cos(foot.endAngle),
    foot.centre.y + (foot.radius - footHook) * Math.sin(foot.endAngle),
  );
  const beaked: Spine = {
    ...stroke.spine,
    segments: [
      {
        kind: "arc",
        centre: c0,
        radius: headHook,
        startAngle: head.startAngle - down,
        endAngle: head.startAngle,
        sweepPositive: true,
        pieces: piecesFor(down),
      },
      ...segments,
      {
        kind: "arc",
        centre: c1,
        radius: footHook,
        startAngle: foot.endAngle,
        endAngle: foot.endAngle - down,
        sweepPositive: false,
        pieces: piecesFor(down),
      },
    ],
  };
  // Cut plain where the face would stand a serif's beak or hang a drop off them.
  const own = f.end.kind === "slab" || f.end.kind === "teardrop";
  const cut = own ? seen(f, BUTT) : f.end;
  return {
    ...drawn,
    strokes: [inherit(stroke, { ...stroke, spine: beaked, start: cut, end: cut }), ...rest],
  };
}

// ---------------------------------------------------------------------------
// The wedged t
// ---------------------------------------------------------------------------

/**
 * How far up the ascender the wedged t stands: the old-style t's (`humanistT`,
 * 640 of 755) less three hundredths of it.
 */
export const WEDGED_TOP = (640 / 755) * 0.97;

/** How far the wedged t's bar reaches past its stem on the left, at least, in stems. */
export const WEDGED_OVERHANG = 0.45;

/**
 * How far round the tail turns, in degrees on its circle from the foot of
 * the stem: on up past the old-style t's 305, so it flicks up and, turning
 * across the pen's thin way, flares as it goes.
 */
export const WEDGED_TAIL = 345;

/** The tail's radius, against the old-style t's. */
export const WEDGED_TAIL_WIDE = 0.9;

/** How much heavier the wedged t's bar is than the face's crossbars. */
export const WEDGED_BAR = 1.35;

/**
 * The t of a soft text face, under one solid wedge: the old-style t's stem
 * and bar, a little shorter, its tail flicking up further, and its flag a
 * straight stroke from the bar's left tip to the stem's top whose outside is
 * the one line the head is cut along -- the stem's own top sloping down the
 * same line -- and which is heavy enough to fill the corner between the bar
 * and the stem, so the head is solid where the old-style flag, bowed over
 * that corner, left a triangle of paper in it.
 *
 * The flag is laid off that line by half its own width, so its outside edge
 * runs through the bar's tip and the stem's top right corner exactly. It is
 * cut level along the bar's foot, and upright just inside the stem's right
 * side, where its corners stand one over the other in the stem's ink however
 * wide it has to be -- a Thin's stem is far narrower than the corner it
 * fills -- so neither of its ends is seen. The bar starts under the flag,
 * where the line crosses its top. Every size here is arithmetic on the
 * frame, so the letter keeps its points at every weight.
 */
export function wedgedT(style: Style): Recipe {
  const f = frame(style);
  const pen = f.style.pen;
  const radius = Math.max(roundHalf(f) * 0.34, f.least, f.half * 1.5) * WEDGED_TAIL_WIDE;
  const reach = roundHalf(f) * 0.64;
  const stemHalf = Math.abs(reachAlong(at(1, 0), penReach(pen)).x);
  const overhang = stemHalf * (1 + 2 * WEDGED_OVERHANG);
  const stem = Math.max(f.edge + reach * 0.7, f.edge + overhang);
  // As tall as the old-style t's at every weight, less a little: see `humanistT`.
  const top = Math.max(f.asc * WEDGED_TOP + Math.max(0, f.half - 43.5) * 0.3, f.x + f.half);
  const stemLeft = stem - stemHalf;
  const stemRight = stem + stemHalf;
  const barLeft = stem - Math.max(reach * 0.7, overhang);
  // A little heavier than the face's crossbars, still hung from the x-height.
  const barShare = f.bar * WEDGED_BAR;
  const barY = f.hangs(f.x, barShare);
  const barHalf = Math.abs(
    reachAlong(at(0, 1), penReach({ ...pen, weight: pen.weight * barShare })).y,
  );
  const foot = barY - barHalf;
  const barTop = barY + barHalf;
  /*
   * The line the head is cut along: from the bar's foot at its left tip to
   * the stem's top right corner. `along` runs up it, `inward` off it into
   * the letter.
   */
  const rise = Math.max(top - foot, f.least);
  const run = Math.max(stemRight - barLeft, f.least);
  const length = Math.hypot(run, rise);
  const along = at(run / length, rise / length);
  const inward = at(along.y, -along.x);
  const tan = rise / run;
  // The stem's top falls along it, from its right corner to its left side.
  const sink = (stemRight - stemLeft) * tan;
  /*
   * The flag as wide across as it takes to cover the corner where the bar's
   * top meets the stem's left side, and to stand over the bar's end under
   * the line.
   */
  const margin = f.half * 0.15;
  const corner = (stemLeft - barLeft) * inward.x + (barTop - foot) * inward.y;
  const wide = Math.max(corner, (barTop - foot) * along.x) + margin;
  /*
   * Drawn with a round nib that wide, since it is a wedge filled in rather
   * than a stroke of the pen. That also keeps it whole on a face that draws
   * its strokes rising to the right as hairlines (`metrics.risingHairline`):
   * a nib with no thin way has nothing to be thinned to.
   */
  const flagPen = { weight: wide, contrast: 0, angle: pen.angle };
  // Its spine, half its width in off the line, from the bar's foot to just
  // inside the stem's right side.
  const off = at(barLeft + (inward.x * wide) / 2, foot + (inward.y * wide) / 2);
  const start = at(off.x + ((foot - off.y) / along.y) * along.x, foot);
  const stop = stemRight - margin;
  const end = at(stop, off.y + ((stop - off.x) / along.x) * along.y);
  /*
   * Cut upright there: on a round nib that is the square cut turned by the
   * flag's own slope, each corner slid along it until the two stand one over
   * the other in the stem's ink -- the e's bar meets its bowl the same way
   * (see `eyed`). The slope is never level, so the cut always slides its
   * corners and the flag keeps its points.
   */
  const upright: Terminal = { kind: "angled", angle: (Math.atan2(rise, run) * 180) / Math.PI };
  const inked = ink(f, straight(start, end), LEVEL, upright);
  const flag = inherit(inked, { ...inked, pen: flagPen });
  // The bar, from under the flag where the line crosses its top, out past the stem.
  const under = barLeft + (barTop - foot) / tan + margin;
  const cut: Terminal =
    f.plain.kind === "angled" || f.plain.kind === "round" ? f.plain : { ...f.plain, level: true };
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, top), at(stem, f.dip(0) + radius)),
        inPieces(turn(at(stem + radius, f.dip(0) + radius), radius, 180, WEDGED_TAIL), 2),
      ),
      seen(f, { ...LEVEL, sink }),
      f.end,
    ),
    flag,
    bar(f, barShare, straight(at(under, barY), at(stem + reach, barY)), BUTT, seen(f, cut)),
  ]);
}
