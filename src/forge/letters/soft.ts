/**
 * The soft text serif's own letters: the a whose bowl leans and whose foot
 * curls up instead of standing on a serif, the y whose tail swings out wide
 * and level under the line into a long pear, and the f whose bar barely
 * reaches back past its stem.
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
import { bowl } from "../shapes";
import { piecesFor } from "../sweep";
import type { Style } from "../style";
import type { Spine, Stroke, Terminal } from "../types";
import { buried, seen } from "./hints";
import {
  at,
  BUTT,
  chain,
  deg,
  finish,
  frame,
  heaviness,
  inherit,
  ink,
  type Recipe,
  remember,
  ring,
  rippled,
  roundHalf,
  straight,
  thin,
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
 * Where on its circle the foot's curl starts, in degrees: thirty degrees
 * under the level on the right, so the end points up and out at sixty.
 */
export const CURLED_FOOT_FROM = 330;

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

/** How far the tucked f's bar reaches back past its stem, against the plain f's. */
export const TUCKED_LEFT = 0.95;

/** How far the tucked f's bar reaches out to the right of its stem, against the plain f's. */
export const TUCKED_RIGHT = 1;

/** How much heavier the tucked f's bar is than the face's crossbars. */
export const TUCKED_BAR = 1;

/**
 * How far under the x-height the tucked f's bar hangs, in its own weights:
 * none hangs its top on the line, as the plain f's does.
 */
export const TUCKED_SINK = 0;

/**
 * The f of a soft text face: the plain f's stem and hook, and its bar in two
 * pieces leaving the stem's middle -- a stub tucked back to the left, its
 * join with the stem rounded above it, and the full bar out to the right.
 *
 * Two strokes and not one, so the short side can say how its join is
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
  const weight = f.bar * TUCKED_BAR;
  const height = f.hangs(f.x, weight * (1 + 2 * TUCKED_SINK));
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
      weight,
      straight(at(stem, height), at(stem - left * TUCKED_LEFT, height)),
      buried(f, { right: 1 }),
      seen(f, cut),
    ),
    bar(
      f,
      weight,
      straight(at(stem, height), at(stem + roundHalf(f) * 0.57 * TUCKED_RIGHT, height)),
      BUTT,
      seen(f, cut),
    ),
  ]);
}

/**
 * A bar drawn as `thin` draws one, `share` of the face's stem heavy rather
 * than the crossbar's own share: the same pen, waved against its own width.
 */
function bar(
  f: ReturnType<typeof frame>,
  share: number,
  spine: Spine,
  start: Terminal,
  end: Terminal,
): Stroke {
  if (share === f.bar) return thin(f, spine, start, end);
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
