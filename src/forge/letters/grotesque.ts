/**
 * The neo-grotesque's own letters.
 *
 * Most of the alphabet a neo-grotesque shares with every other sans here: the
 * n, the o and the H are the same skeletons at its own proportions. A handful
 * it draws differently, and they are most of what makes one look like one --
 * the two-storey a with a spur at its foot, the single-storey g whose tail
 * runs down the stem and hooks flat under the bowl, the y whose right arm runs
 * straight on into a short flat foot, the G with its bar and its upright, the
 * R whose leg comes down out of the bowl, the wide J with no descender, the t
 * whose foot turns out along the line, the one with a curved flag, the seven
 * whose stroke settles upright, and the ampersand and question mark as Geist
 * draws them.
 *
 * Each is measured off Geist Regular and written in terms of the frame, so it
 * follows the pen, the width and the proportions like every other letter:
 * horizontal measures in units of the o's own half-width (the capital O's for
 * the capitals), heights against the lines they are drawn to, and every turn
 * held to what the pen can go round. And each is the same pieces at every
 * weight, so a weight axis can run through it.
 */

import type { Vec2 } from "@/font/types";
import type { Style } from "../style";
import { LETTERS } from "../letters";
import { bowlPoint, spineEnd } from "../shapes";
import type { Spine } from "../types";
import {
  at,
  bend,
  BUTT,
  chain,
  dot,
  headingAt,
  finish,
  type Frame,
  frame,
  heaviness,
  ink,
  pointOn,
  type Recipe,
  ring,
  stopRadius,
  straight,
  thin,
  tittle,
  turn,
  uses,
} from "./common";

/** How wide a lowercase letter is against Geist's, per unit of its o. */
const small = (f: Frame): number => f.bowl / 199;
/** The same for a capital, per unit of its O. */
const large = (f: Frame): number => f.capBowl / 280;

/** A turn, never tighter than the pen will go round. */
const held = (f: Frame, radius: number): number => Math.max(radius, f.least);

/** A turn drawn in so many pieces at every weight: see `SpineArc.pieces`. */
function pinned(spine: Spine, pieces: number): Spine {
  return { ...spine, segments: spine.segments.map((one) => ({ ...one, pieces })) };
}

/**
 * The two-storey a: a flat-topped bowl hung off the stem, an arch over it from
 * a terminal cut level, and the stem turning out along the baseline into a
 * short spur.
 *
 * The bowl is a whole ring whose right side runs down the middle of the stem,
 * so where it meets the stem at its top and its foot the ink thins by itself
 * -- the notch every grotesque cuts there -- and nothing has to be drawn to
 * make it.
 */
export function grotesqueA(style: Style): Recipe {
  // A joined hand draws its own a, whose bowl is what the join runs into.
  if (style.parts.script.on) return LETTERS.a(style);
  const f = frame(style);
  const u = small(f);
  const left = f.edge;
  const stem = left + 353 * u;
  const crest = f.crest(f.x);
  const foot = f.sits(0);
  const bottom = f.dip(0);
  /*
   * At a heavy weight the bowl is drawn with a lighter pen than the stem and
   * the arch, as a Black's is: two counters stacked in one x-height leave the
   * bowl's the smaller, and at the stem's weight it closed to a slit.
   */
  const heavy = Math.min(1, heaviness(f));
  const bowlPen = { ...f.style.pen, weight: f.style.pen.weight * (1 - 0.22 * heavy) };
  const bowlLeast = (bowlPen.weight / 2) * 1.06;
  // The arch: from a terminal on its left, over a flat crest into the stem.
  const room = crest - bottom;
  const archHalf = held(f, Math.min((101 / 530) * f.x, room * 0.3));
  const archCentre = at((left + 9 * u + stem) / 2, crest - archHalf);
  const archWide = (stem - left - 9 * u) / 2;
  // The bowl: its top well under the arch's terminal, its foot on the line.
  const top = Math.min(
    bottom + (244 / 530) * f.x,
    Math.max(archCentre.y - f.half * 1.3 - f.upright, bottom + room * 0.44),
  );
  const bowlHalf = Math.max((top - bottom) / 2, bowlLeast);
  const bowlCentre = at((left + stem) / 2, bottom + bowlHalf);
  const spur = held(f, 50 * u);
  const reach = Math.max(stem + spur + f.half * 0.7, stem + 96 * u);
  return finish(f, [
    { ...ink(f, ring(f, bowlCentre, (stem - left) / 2, bowlHalf)), pen: bowlPen },
    ink(
      f,
      chain(
        bend(f, archCentre, archHalf, 180, 90, archWide),
        bend(f, archCentre, archHalf, 90, 0, archWide),
        straight(at(stem, archCentre.y), at(stem, foot + spur)),
        pinned(turn(at(stem + spur, foot + spur), spur, 180, 270), 1),
        straight(at(stem + spur, foot), at(reach, foot)),
      ),
      f.end,
      f.end,
    ),
  ]);
}

/**
 * The single-storey g: a bowl whose right side is the stem, and the stem
 * carried on under the line and round in a flat hook to a terminal cut level
 * under the bowl's left side.
 */
export function grotesqueG(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  const left = f.edge;
  const stem = left + 385 * u;
  const top = f.crest(f.x);
  // The bowl stands a little off the baseline: its foot is at 28, not -12.
  const bottom = Math.min(f.dip(0) + (40 / 530) * f.x, top - f.least * 2);
  const bowlHalf = (top - bottom) / 2;
  const floor = f.dip(f.desc);
  // The hook: down the stem, round a flat foot, and up to a terminal.
  const tailHalf = held(f, (81 / 530) * f.x - f.gain * 0.3);
  const hookCentreX = left + 191 * u;
  const turnRight = at(hookCentreX, floor + tailHalf);
  const rise = held(f, (116 / 530) * f.x - f.gain * 0.3);
  const turnLeft = at(hookCentreX, floor + rise);
  return {
    ...finish(f, [
      ink(f, ring(f, at((left + stem) / 2, bottom + bowlHalf), (stem - left) / 2, bowlHalf)),
      ink(
        f,
        chain(
          straight(at(stem, f.x), at(stem, turnRight.y)),
          bend(f, turnRight, tailHalf, 0, -90, stem - hookCentreX),
          bend(f, turnLeft, rise, -90, -180, hookCentreX - (left + 14 * u)),
        ),
        f.end,
        f.end,
      ),
    ]),
    air: 0.2,
  };
}

/**
 * The y: a vee whose right arm carries straight on under the line and turns
 * out into a short flat foot, cut upright.
 */
export function grotesqueY(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  const left = f.edge;
  // Geist's arms meet at 229 across a letter 494 wide: the vee is even.
  const leftTop = at(left + 23 * u, f.x);
  const rightTop = at(left + 425 * u, f.x);
  const apex = at(left + 212 * u, f.half * 0.2);
  const heading = {
    x: apex.x - rightTop.x,
    y: apex.y - rightTop.y,
  };
  const length = Math.hypot(heading.x, heading.y);
  const dir = { x: heading.x / length, y: heading.y / length };
  const floor = f.sits(f.desc);
  const radius = held(f, 58 * u);
  // Where the arm turns: the knee, whose turn lands its foot on the floor.
  // Turning right, from the arm's heading round to due left.
  const centreY = floor + radius;
  const normal = { x: -dir.y, y: dir.x };
  // The centre lies to the right of the arm's direction of travel.
  const side = { x: dir.y, y: -dir.x };
  const kneeY = centreY - radius * side.y;
  const along = (kneeY - rightTop.y) / dir.y;
  const knee = at(rightTop.x + dir.x * along, kneeY);
  const centre = at(knee.x + radius * side.x, centreY);
  void normal;
  const from = (Math.atan2(knee.y - centre.y, knee.x - centre.x) * 180) / Math.PI;
  const toe = Math.min(left + 70 * u, centre.x - 1);
  return finish(f, [
    ink(
      f,
      straight(leftTop, at(apex.x + dir.x * -f.half * 0.4, apex.y + dir.y * -f.half * 0.4)),
      f.end,
      BUTT,
    ),
    ink(
      f,
      chain(
        straight(rightTop, knee),
        pinned(turn(centre, radius, from, -90), 1),
        straight(at(centre.x, floor), at(toe, floor)),
      ),
      f.end,
      // The face's own cut and never a serif: a beak on a foot this short
      // stands out past the turn it hangs from.
      f.plain,
    ),
  ]);
}

/**
 * The G: a C carried round and up its right side to the bar, and the bar
 * turning square down into an upright that stands on the baseline.
 */
export function grotesqueCapitalG(style: Style): Recipe {
  const f = frame(style);
  const centre = at(f.edge + f.capBowl, f.cap / 2);
  const bar = f.hangs(f.cap * 0.507, f.bar);
  const upright = centre.x + f.capBowl;
  // The bowl's end is where its right side comes up to the bar.
  const half = f.capBowlH;
  const endAngle =
    (Math.asin(Math.max(-0.95, Math.min(0.95, (bar - centre.y) / half))) * 180) / Math.PI;
  return finish(f, [
    ink(f, bend(f, centre, half, 38, 360 + Math.min(endAngle, -2), f.capBowl), f.end, BUTT),
    ink(
      f,
      chain(
        straight(at(centre.x, bar), at(upright, bar)),
        straight(at(upright, bar), at(upright, 0)),
      ),
      BUTT,
      f.end,
    ),
  ]);
}

/**
 * The R: the P's bowl, and a leg that leaves the foot of the bowl running on
 * to the right, turns down, and comes to the baseline nearly upright.
 */
export function grotesqueR(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const stem = f.edge;
  const top = f.hangs(f.cap);
  const waist = f.sits((285 / 710) * f.cap);
  const lobeHalf = (top - waist) / 2;
  const reach = stem + 378 * u;
  const lobeRadius = held(f, Math.min(lobeHalf, 150 * u));
  const lobeCentre = at(reach - lobeRadius, waist + lobeHalf);
  const legTurn = held(f, 90 * u);
  const legFrom = at(stem + 290 * u, waist);
  const legFoot = at(stem + 474 * u, 0);
  const turnCentre = at(legFrom.x, waist - legTurn);
  // From heading right, round to the leg's own heading down to its foot.
  const lean = Math.atan2(legFoot.x - (legFrom.x + legTurn), turnCentre.y) * (180 / Math.PI);
  const leaves = pointOn(turnCentre, legTurn, lean);
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ink(
      f,
      chain(
        straight(at(stem, top), at(lobeCentre.x, top)),
        bend(f, lobeCentre, lobeHalf, 90, -90, lobeRadius),
        straight(at(lobeCentre.x, waist), at(stem, waist)),
      ),
    ),
    ink(
      f,
      chain(
        straight(at(stem + 200 * u, waist), legFrom),
        pinned(turn(turnCentre, legTurn, 90, lean), 1),
        straight(leaves, legFoot),
      ),
      BUTT,
      f.end,
    ),
  ]);
}

/**
 * The J: an upright down the right, turning under in a wide flat hook that
 * comes back up to a terminal cut level. No descender.
 */
export function grotesqueJ(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const left = f.edge;
  const stem = left + 409 * u;
  const bottom = f.dip(0);
  const centreX = left + 226 * u;
  const hookHalf = held(f, (221 / 710) * f.cap - f.gain * 0.3);
  const centre = at(centreX, bottom + hookHalf);
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, f.cap), at(stem, centre.y)),
        bend(f, centre, hookHalf, 0, -90, stem - centreX),
        bend(f, centre, hookHalf, -90, -180, stem - centreX),
      ),
      f.end,
      f.end,
    ),
  ]);
}

/**
 * The t: a stem cut level above the x-height, a bar across it, and the foot
 * turning out along the baseline to an upright cut.
 */
export function grotesqueT(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  const stem = f.edge + 77 * u;
  const foot = f.sits(0);
  const radius = held(f, 104 * u);
  const toe = Math.max(stem + 183 * u, stem + radius + f.half * 0.2);
  const bar = f.hangs(f.x, f.bar);
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, (650 / 530) * f.x), at(stem, foot + radius)),
        pinned(turn(at(stem + radius, foot + radius), radius, 180, 270), 1),
        straight(at(stem + radius, foot), at(toe, foot)),
      ),
      f.end,
      f.end,
    ),
    thin(f, straight(at(f.edge - f.half, bar), at(stem + 185 * u, bar)), f.end, f.end),
  ]);
}

/** The one: an upright with a flag that curves off its head. */
export function grotesqueOne(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const stem = f.edge + 191 * u;
  const flag = f.hangs((600 / 710) * f.cap, f.bar);
  const radius = held(f, Math.min(110 * u, f.cap - flag));
  const bend = at(stem - radius, flag + radius);
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ink(
      f,
      chain(
        straight(at(f.edge - f.half * 0.1, flag), at(bend.x, flag)),
        pinned(turn(bend, radius, 270, 360), 1),
        straight(at(stem, bend.y), at(stem, Math.max(bend.y, f.cap - f.half))),
      ),
      f.end,
      BUTT,
    ),
  ]);
}

/**
 * The seven: an arm along the cap line, and a stroke that falls from its end
 * as a diagonal and settles into an upright on the baseline.
 */
export function grotesqueSeven(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const arm = f.hangs(f.cap);
  const right = f.edge + 455 * u;
  const foot = f.edge + 217 * u;
  const radius = held(f, 300 * u);
  const lean = (38 * Math.PI) / 180;
  const across = radius * (1 - Math.cos(lean));
  const down = radius * Math.sin(lean);
  // The diagonal runs from the arm's end to where the turn takes over.
  const run = Math.max(right - foot - across, 1);
  const knee = at(right - run, arm - run / Math.tan(lean));
  const settle = at(foot, knee.y - down);
  const centre = at(foot + radius, settle.y);
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(f.edge, arm), at(right, arm)),
        straight(at(right, arm), knee),
        pinned(turn(centre, radius, 180 - (lean * 180) / Math.PI, 180), 1),
        straight(settle, at(foot, Math.min(0, settle.y))),
      ),
      f.end,
      f.end,
    ),
  ]);
}

/**
 * The ampersand: a small loop at the head, a diagonal from under it to the
 * baseline at the right, a round lower bowl swung off the loop, and a short
 * arm curving down from a terminal on the right into the diagonal.
 */
export function grotesqueAmpersand(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const left = f.edge;
  const top = f.crest(f.cap);
  const bottom = f.dip(0);
  // The loop, a small bowl at the head.
  const loopHalfW = held(f, 124 * u);
  const loopHalfH = held(f, (130 / 710) * f.cap - f.gain * 0.35);
  const loop = at(left + 186 * u, top - loopHalfH);
  const on = (centre: Vec2, halfW: number, halfH: number, degrees: number): Vec2 =>
    bowlPoint(centre, halfW, halfH, 1 - f.square, f.half, degrees, f.superness);
  // The diagonal leaves the loop's foot on the right and runs to the baseline.
  const loopFoot = on(loop, loopHalfW, loopHalfH, -62);
  const leg = at(left + 505 * u, 0);
  /*
   * The lower bowl, swung round from under the loop on the left: its upper
   * end starts on the loop's own spine, so the two strokes meet in a crotch
   * rather than a lap.
   */
  const bowlHalfW = held(f, 186 * u);
  const reachUp = on(loop, loopHalfW, loopHalfH, -118);
  const bowlHalfH = Math.max((reachUp.y - bottom) / 1.86, f.least);
  const start = 116;
  let bowl = at(left + bowlHalfW, bottom + bowlHalfH);
  const first = on(bowl, bowlHalfW, bowlHalfH, start);
  bowl = at(bowl.x + (reachUp.x - first.x) * 0.5, bowl.y + (reachUp.y - first.y));
  // The arm: from a terminal right of the diagonal, curving down into it.
  const armTop = at(left + 490 * u, Math.max((316 / 710) * f.cap, bottom + f.least * 2.6));
  const t = 0.66;
  const armFoot = at(loopFoot.x + (leg.x - loopFoot.x) * t, loopFoot.y + (leg.y - loopFoot.y) * t);
  return finish(f, [
    ink(f, ring(f, loop, loopHalfW, loopHalfH)),
    ink(f, straight(loopFoot, leg), BUTT, f.end),
    ink(f, bend(f, bowl, bowlHalfH, start, 332, bowlHalfW), BUTT, BUTT),
    ink(f, bowedTo(f, armTop, armFoot), f.end, BUTT),
  ]);
}

/** A gentle curve from one point to another, turning right as it goes. */
function bowedTo(f: Frame, from: Vec2, to: Vec2): Spine {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  const radius = Math.max(chord * 0.9, f.least);
  const middle = at((from.x + to.x) / 2, (from.y + to.y) / 2);
  const back = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
  // Centre to the right of travel, so the curve bows out to the right.
  const centre = at(middle.x + (dy / chord) * back, middle.y - (dx / chord) * back);
  const a0 = (Math.atan2(from.y - centre.y, from.x - centre.x) * 180) / Math.PI;
  let a1 = (Math.atan2(to.y - centre.y, to.x - centre.x) * 180) / Math.PI;
  while (a1 > a0) a1 -= 360;
  return turn(centre, radius, a0, a1);
}

/**
 * The j: the i's stem carried under the line and turned out into a short flat
 * foot reaching back under the letter before it, cut upright.
 */
export function grotesqueJay(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  const stem = f.edge;
  const floor = f.sits(f.desc);
  const radius = held(f, 50 * u);
  const toe = Math.min(stem - 128 * u, stem - radius - 1);
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, f.x), at(stem, floor + radius)),
        pinned(turn(at(stem - radius, floor + radius), radius, 0, -90), 1),
        straight(at(stem - radius, floor), at(toe, floor)),
      ),
      f.end,
      f.end,
    ),
    tittle(f, stem),
  ]);
}

/**
 * The r: the stem, and an arm that leaves it on the same superelliptic
 * shoulder the n has, runs flat along the x-height and is cut upright.
 */
export function grotesqueSmallR(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  const stem = f.edge;
  const top = f.hangs(f.x);
  const wide = held(f, 130 * u);
  // Where the arm leaves the stem follows the shoulder's springing, as the
  // n's arch does: Geist's r and n spring from the same height.
  uses("shoulder");
  const spring = Math.min(0.85, Math.max(0.3, f.style.parts.shoulder.spring));
  const fall = held(f, (162 / 530) * f.x * ((1 - spring) / 0.38) - f.gain * 0.4);
  const corner = at(stem + wide, top - fall);
  const end = Math.max(stem + 213 * u, corner.x + f.half * 0.3);
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
    ink(
      f,
      chain(bend(f, corner, fall, 180, 90, wide), straight(at(corner.x, top), at(end, top))),
      BUTT,
      f.end,
    ),
  ]);
}

/**
 * The f: a stem turning over at the ascender into a flat hook cut upright,
 * and a bar across at the x-height reaching further right than left.
 */
export function grotesqueF(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  const stem = f.edge + 114 * u;
  const top = f.hangs(f.asc);
  const wide = held(f, 101 * u);
  const fall = held(f, (109 / 530) * f.x - f.gain * 0.3);
  const corner = at(stem + wide, top - fall);
  const end = Math.max(stem + 183 * u, corner.x + f.half * 0.3);
  const bar = f.hangs(f.x, f.bar);
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, 0), at(stem, corner.y)),
        bend(f, corner, fall, 180, 90, wide),
        straight(at(corner.x, top), at(end, top)),
      ),
      f.end,
      f.end,
    ),
    thin(f, straight(at(stem - 114 * u, bar), at(stem + 176 * u, bar)), f.end, f.end),
  ]);
}

/**
 * The question mark: a superelliptic hook from a terminal on the left, over
 * and down the right, then a straight diagonal that turns into a short
 * upright neck, cut level over a square dot.
 */
export function grotesqueQuestion(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const side = stopRadius(f);
  const dotTop = side * 2;
  const neckFoot = dotTop + Math.max(f.half * 2.2, f.cap * 0.06);
  const crest = f.crest(f.cap);
  const halfW = held(f, 191 * u);
  const halfH = held(f, Math.min((156 / 710) * f.cap, (crest - neckFoot) / 2.6));
  const centre = at(f.edge + halfW, crest - halfH);
  const stem = f.edge + 189 * u;
  const hook = bend(f, centre, halfH, 190, -50, halfW);
  const last = hook.segments[hook.segments.length - 1];
  const from = spineEnd(hook);
  const h = headingAt(last, "end");
  const radius = held(f, 70 * u);
  // Along the diagonal until a left turn of this radius lands upright on the
  // neck's line.
  const along = Math.max((stem + radius + radius * h.y - from.x) / h.x, 1);
  const bendAt = at(from.x + h.x * along, from.y + h.y * along);
  const centre2 = at(bendAt.x - h.y * radius, bendAt.y + h.x * radius);
  const startAngle = (Math.atan2(bendAt.y - centre2.y, bendAt.x - centre2.x) * 180) / Math.PI;
  const upright = at(centre2.x - radius, centre2.y);
  return finish(f, [
    ink(
      f,
      chain(
        hook,
        straight(from, bendAt),
        pinned(turn(centre2, radius, startAngle, 180), 1),
        straight(upright, at(upright.x, Math.min(neckFoot, upright.y - 1))),
      ),
      f.end,
      f.end,
    ),
    dot(f, at(upright.x, side), side),
  ]);
}
