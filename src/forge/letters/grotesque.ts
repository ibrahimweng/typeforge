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
 * And, measured the same way, the rest of what a neo-grotesque draws its own
 * way: the figures, proportional and each on Geist's skeleton; every diagonal
 * cut level with flat vertices (v w A V W Y M N K k z Z); the flat-sided bowls
 * of the B, the P and the R; the ring cut level at Geist's heights (c e C G);
 * the s and the S on a straight spine; and the marks (! ' " ( ) - / # % @).
 * Where a heavy weight goes past Geist Black (a stem of 172), each is held
 * open by what the pen needs rather than by the measurement.
 *
 * Each is measured off Geist Regular and written in terms of the frame, so it
 * follows the pen, the width and the proportions like every other letter:
 * horizontal measures in units of the o's own half-width (the capital O's for
 * the capitals), heights against the lines they are drawn to, and every turn
 * held to what the pen can go round. And each is the same pieces at every
 * weight, so a weight axis can run through it.
 */

import type { Vec2 } from "@/font/types";
import { BASES, blackness, type Style, weightAtBlackness } from "../style";
import { LETTERS } from "../letters";
import { bowlPoint, spineEnd, spineStart, superQuarter } from "../shapes";
import { penReach, reachAlong } from "../sweep";
import type { Spine, SpineArc, Stroke, Terminal } from "../types";
import {
  arm,
  at,
  bend,
  BUTT,
  chain,
  crested,
  dot,
  headingAt,
  finish,
  type Frame,
  frame,
  OVAL_CURVE,
  heaviness,
  inherit,
  ink,
  LEVEL,
  openVee,
  pointOn,
  type Recipe,
  ring,
  shoulderRadius,
  stopRadius,
  straight,
  thin,
  trough,
  turn,
  turnedStroke,
  uses,
} from "./common";

/*
 * A letter here is drawn in Geist's own units, so the width the face fits its
 * plain forms to (`metrics.proportions`, which arrives as `stretch`) is taken
 * back out: it is already in the drawing.
 */
const unstretched = (f: Frame): number => f.style.metrics.stretch ?? 1;
/**
 * The o's half-width a letter here is measured in: the bowl as the pen grows
 * it (`grownBowl`), or, by `held`, as far as the width the face holds its
 * bowls to at a heavy weight (`bowl`; see `metrics.lightHeld`). A letter whose
 * Geist Regular and Black measures already carry the Black's width takes the
 * first; one whose measures came out narrow at the Black against Geist's (its
 * diagonals, the figures) takes some or all of the second.
 */
const mixed = (grown: number, heldTo: number, share: number): number =>
  grown + (heldTo - grown) * share;
/** How wide a lowercase letter is against Geist's, per unit of its o. */
const small = (f: Frame, share = 0): number =>
  mixed(f.grownBowl, f.bowl, share) / 199 / unstretched(f);
/** The same for a capital, per unit of its O. */
const large = (f: Frame, share = 0): number =>
  mixed(f.grownCapBowl, f.capBowl, share) / 280 / unstretched(f);

/** Where the Sans sets its crossbar control: a bar drawn at Geist's height sits here. */
const SANS_CROSSBAR = 0.52;

/**
 * Narrower towards the Thin by this share: the face widens its light letters
 * as Geist Thin's o and n are widened (`metrics.lightHeld`), and Geist Thin's
 * diagonals, its G and its figures do not widen with them.
 */
const thinned = (f: Frame, share: number): number => 1 - share * thinness(f);

/** A turn, never tighter than the pen will go round. */
const held = (f: Frame, radius: number): number => Math.max(radius, f.least);

/**
 * How much further out the right of a round capital stands than its older
 * measures put it: `regular` units at the Regular, `heavy` from a SemiBold
 * on, `thin` at the Thin. Measured off the current Geist, whose B, C, G, P
 * and R stand about 7 units wider at the Regular than the measures they were
 * drawn from, and 20 from the SemiBold to the Black.
 */
function roundGain(f: Frame, regular: number, heavy: number, thin = 0): number {
  const light = thinness(f);
  if (light > 0) return regular + (thin - regular) * light;
  const t = Math.max(0, heaviness(f) / 0.67);
  return regular + (heavy - regular) * Math.min(1, t / 0.41);
}

/**
 * How much wider (a share) a letter measured off an older Geist is drawn to
 * stand where the current Geist's does: `regular` at the Regular, `black` at
 * the Sans's own Black (UltraBlack, a stem of 172), running on the same way
 * past it, and `thin` at the Thin.
 */
function refit(f: Frame, regular: number, black: number, thin = regular): number {
  const light = thinness(f);
  if (light > 0) return 1 + regular + (thin - regular) * light;
  const t = Math.min(Math.max(0, heaviness(f) / 0.67), 2.24);
  return 1 + regular + (black - regular) * t;
}

/**
 * A figure's widths, corrected as `refit` corrects a letter's, and by `past`
 * more for each unit of weight between the UltraBlack and the current Black:
 * Geist's figures grow less from its UltraBlack to its Black than the
 * capitals' bowls they are measured on, which left its 2 29 units wide and
 * its 6 22 at the Black.
 */
function figureFit(f: Frame, regular: number, black: number, thin: number, past: number): number {
  return refit(f, regular, black, thin) + past * Math.max(0, Math.min(heavyT(f), nowBlack()) - 1);
}

/**
 * A measure taken off Geist at its five weights -- Thin, Regular, SemiBold,
 * UltraBlack and Black -- and run straight between them, and on past the
 * Black as it ran from the UltraBlack.
 */
function atWeights(
  f: Frame,
  thin: number,
  regular: number,
  semi: number,
  ultra: number,
  black: number,
): number {
  const light = thinness(f);
  if (light > 0) return regular + (thin - regular) * light;
  const t = Math.min(heavyT(f), 2.24);
  const knots: Array<[number, number]> = [
    [0, regular],
    [T_SEMIBOLD, semi],
    [T_ULTRABLACK, ultra],
    [nowBlack(), black],
  ];
  for (let i = 1; i < knots.length; i++) {
    const [t0, v0] = knots[i - 1];
    const [t1, v1] = knots[i];
    if (t <= t1 || i === knots.length - 1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return black;
}

/** Where Geist's SemiBold (a stem of 130) and UltraBlack (172) fall, as `heavyT` counts. */
const T_SEMIBOLD = 0.413;
const T_ULTRABLACK = 1.004;

/** How far past the Regular a heavy weight is, as `squared` counts it: nought at and below the Regular. */
function heavyT(f: Frame): number {
  return thinness(f) > 0 ? 0 : Math.min(Math.max(0, heaviness(f) / 0.67), 2.24);
}

/** A turn drawn in so many pieces at every weight: see `SpineArc.pieces`. */
function pinned(spine: Spine, pieces: number): Spine {
  return { ...spine, segments: spine.segments.map((one) => ({ ...one, pieces })) };
}

/**
 * The two-storey a, as Geist draws it: an arch from a terminal cut level on
 * the left, over a flat crest and down into the stem, which turns out at its
 * foot on a wide round into a short spur; and a bowl hung off the stem.
 *
 * Every measure is Geist's own, at the Thin, the Regular and the Black, from
 * the left of the ink. The bowl leaves the stem on a straight diagonal onto
 * its round left side and comes back round its foot into the stem's inside,
 * so its counter is a teardrop whose right side is the stem, as Geist's is.
 * Geist Black's bowl is heavier down its left side than the stem (199 on a
 * stem of 194) and lighter along its foot (122): it is drawn with a pen of
 * its own, and its last quarter, which runs up into the stem, with one as
 * heavy along the foot and only a stem wide, so the counter meets the stem
 * edge on a tangent and the bowl's outside comes up into the stem's round
 * foot in the notch Geist cuts there.
 */
export function grotesqueA(style: Style): Recipe {
  // A joined hand draws its own a, whose bowl is what the join runs into.
  if (style.parts.script.on) return LETTERS.a(style);
  const f = frame(lighterAcross(style));
  const [across0, lerp] = squaredNow(f);
  /*
   * Drawn small -- as the ordinal -- it is narrowed with its x-height, as
   * everything else drawn small is: Geist's measures are for an a at the
   * face's own size.
   */
  const base = BASES.find((one) => one.name === style.name);
  const size = base ? f.xOwn / base.metrics.xHeight : 1;
  const X = (x: number) => across0(0) + (across0(x) - across0(0)) * size;
  const k = X(1) - X(0);
  const H = (y: number) => (y / 530) * f.x;
  const { pen } = f.style;
  const t = Math.min(heaviness(f) / 0.67, 2.24);
  // How far past the Black: where the bowl stops getting heavier than the stem.
  const past = Math.min(1, Math.max(0, t - 1));

  // The stem, and its foot turning out into the spur.
  const stem = X(lerp(397, 437, 389));
  const foot = f.sits(0);
  const crest = f.crest(f.x);
  // Its turn no taller than leaves the arch its own round above it.
  const spur = held(
    f,
    Math.min(Math.max(lerp(72, 126, 60) * k, f.half + 12 * k), crest - 2 * f.least - foot),
  );
  const reach = Math.max(X(lerp(488, 582, 460)), stem + spur + f.half * 0.2);

  // The arch: its terminal cut level at 0.7 of the x-height, as Geist's is,
  // its crest left of the middle, and its right side coming upright low, at
  // 324 on every weight.
  // Never nearer the stem than its turn will go round.
  const crestX = Math.min(X(lerp(229, 277, 214)), stem - f.least);
  const tip = Math.min(X(9) + f.half, crestX - f.least);
  const cutY = Math.min(H(lerp(370, 362, 371)), crest - f.least);
  // And never below where the stem starts to turn out into its spur.
  const rightY = Math.max(Math.min(H(324), cutY), foot + spur + 1);
  const leftArch = at(crestX, cutY);
  const rightArch = at(crestX, rightY);

  // The bowl's pen: Geist's is 1.01 of the stem across at the Regular and
  // 1.16 at the Black, 0.84 and 0.61 of that along its foot.
  const across = pen.weight * (lerp(1.01, 1.157, 1.07) - (0.147 + 0.43) * past);
  const contrast = Math.max(pen.own ?? pen.contrast, lerp(0.16, 0.39, 0.06) - 0.23 * past);
  const bowlPen = { ...pen, weight: across, contrast };
  const along = across * (1 - contrast);
  /*
   * The last quarter's: as heavy as the bowl along its foot, and narrowing
   * as it turns up into the stem, to a third of that where it runs upright
   * -- a pen held on its side. Geist's bowl thins so into the stem: its
   * counter comes up onto the stem's edge on a tangent, and its outside
   * meets the stem's round foot low down, in a notch.
   */
  const taper = Math.max(
    along * (lerp(0.35, 0.37, 0.5) + 0.5 * past),
    Math.min(along, f.half * 0.5),
  );
  const lastPen = { ...pen, weight: along, contrast: 1 - taper / along, angle: pen.angle + 90 };
  // Their turns held to what their own pens go round: see `holds` in `shapes.ts`.
  const penned = (weight: number, one: Style["pen"]): Frame => ({
    ...f,
    half: weight / 2,
    least: (weight / 2) * 1.06,
    style: { ...f.style, pen: one },
    // Oval rather than superelliptic: the heavy pen round a squarish turn
    // cut its counter's corners square.
    curve: 0,
    superness: 0,
  });
  // Held by the lesser of its reaches: see `holds` in `shapes.ts`.
  const bf = penned(along, bowlPen);
  const lf = penned(taper, lastPen);

  const left = X(0) + across / 2;
  const bottom = -f.over + along / 2;
  const middle = Math.max(X(lerp(183, 240, 171)), left + f.least);
  const right = stem - f.half + taper / 2;
  /*
   * The bowl leaves the stem at 0.56 of the x-height, and its counter meets
   * the stem low on its left and high on its right, as Geist's does: round
   * the left at 140 and upright into the stem at 218. Past the Black, where
   * Geist has nothing more to say, the bowl's top is set where it shares
   * what the pens leave of the x-height between the two counters as the
   * Black does, and the counter's sides keep their share of the bowl.
   */
  const lip = f.upright;
  const room = crest - lip - 2 * along + f.over;
  const onward = Math.min(1, Math.max(0, (t - 1) * 2));
  const shared = (geist: number, share: number): number => geist + (share - geist) * onward;
  const joinY = shared(H(lerp(300, 296, 304)), crest - lip - along / 2 - room * 0.38);
  const leftY = Math.max(
    shared(H(lerp(140, 160, 132)), bottom + (joinY - bottom) * 0.5),
    bottom + across * 0.53 + across * 0.02 * onward,
  );
  const rightY2 = Math.max(
    shared(H(lerp(218, 212, 204)), bottom + (joinY - bottom) * 0.66),
    bottom + along * 0.53,
    leftY,
  );
  const leftC = at(middle, leftY);
  const rightC = at(middle, rightY2);
  /*
   * Its upper quarter a little flatter than its lower, so the diagonal comes
   * onto the round low, as Geist's does. Past the Black never so flat that
   * the pen's reach across is more than its round, which cut the counter's
   * corner square, and no wider than it is tall: a long flat top carried the
   * bowl up under the arch's terminal until the two ran together.
   */
  const topH = Math.max(
    Math.min((leftY - bottom) * 0.85, joinY - leftY - (leftY - bottom) * 0.35 * onward),
    across * 0.53 + across * 0.03 * onward,
  );
  const topW = middle - left - Math.max(0, middle - left - topH) * onward;
  const quarter = bend(bf, at(left + topW, leftY), topH, 90, 180, topW);
  /*
   * Out of the stem on a straight line down onto the bowl's round left
   * side; where the pen has brought the bowl's top up to where it leaves the
   * stem, all but level onto the round's crown -- still found as a tangent,
   * so the run is in the same pieces at every weight.
   */
  const crown = spineStart(quarter);
  const from = at(stem, Math.max(joinY, crown.y + 1));
  const onto = tangentFrom(from, quarter, 1);
  const bowl = ink(
    bf,
    chain(
      straight(from, onto ? spineStart(onto.run) : spineStart(quarter)),
      onto ? onto.run : quarter,
      bend(bf, leftC, leftY - bottom, 180, 270, middle - left),
    ),
  );
  const last = ink(lf, bend(lf, rightC, rightY2 - bottom, 270, 360, right - middle));
  return finish(f, [
    inherit(bowl, { ...bowl, pen: bowlPen }),
    inherit(last, { ...last, pen: lastPen }),
    ink(
      f,
      chain(
        bend(f, leftArch, crest - cutY, 180, 90, crestX - tip),
        bend(f, rightArch, crest - rightY, 90, 0, stem - crestX),
        straight(at(stem, rightY), at(stem, foot + spur)),
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
  const f = frame(lighterAcross(style));
  const u = small(f, 1);
  // The bowl's left drawn in as the weight grows, to the current Geist's.
  const left = f.edge + 4 * heavyT(f);
  const stem = f.edge + 385 * u;
  const top = f.crest(f.x);
  // The bowl stands a little off the baseline: its foot is at 28, not -12.
  const bottom = Math.min(f.dip(0) + (40 / 530) * f.x, top - f.least * 2);
  const bowlHalf = (top - bottom) / 2;
  const floor = f.dip(f.desc);
  /*
   * The hook: down the stem and round under the bowl in one superelliptic
   * turn, deeper on the stem's side than on the terminal's, to an end cut
   * level just under the baseline -- Geist's, which is round rather than a
   * flat foot, and stays round at a Black instead of closing to a slab.
   */
  const H = (y: number) => (y / 530) * f.x;
  const hookX = f.edge + 204 * u;
  const hookW = held(f, 181 * u);
  const rightY = Math.max(H(40), floor + f.least);
  /*
   * At a Black the terminal's side turns on a taller quarter, so the inside
   * of the tail is one curve from the stem down under the bowl and back up
   * to the level cut, as Geist Black's is (its inside 48 under the line, its
   * cut at the line). On a quarter only as tall as the pen goes round, the
   * inside ran flat and the cut's corner stood a step above it -- at an
   * Ultra a square notch under the bowl.
   */
  const t = Math.min(heaviness(f) / 0.67, 1.5);
  const leftY = Math.max(H(-25 + 45 * t), floor + f.least);
  const rightC = at(hookX, rightY);
  const leftC = at(hookX, leftY);
  const cut = Math.min(
    Math.max(H(-20 + 14 * Math.min(t, 1)), leftY - (leftY - floor) * 0.2),
    leftY - (leftY - floor - f.upright) * 0.5,
  );
  const end = angleAt(f, leftC, hookW, leftY - floor, cut, true) - 360;
  return {
    ...finish(f, [
      ink(f, ring(f, at((left + stem) / 2, bottom + bowlHalf), (stem - left) / 2, bowlHalf)),
      ink(
        f,
        chain(
          straight(at(stem, f.x), at(stem, rightY)),
          bend(f, rightC, rightY - floor, 0, -90, stem - hookX),
          bend(f, leftC, leftY - floor, -90, end, hookW),
        ),
        f.end,
        f.end,
      ),
    ]),
    air: 0.2,
  };
}

/**
 * The y, as Geist draws it: a left arm falling to a level cut just over the
 * line, and a right arm running straight on past it under the line, where
 * it turns on a short round into a flat foot cut upright.
 *
 * Every measure is Geist's own, from the left of the ink, at the Thin, the
 * Regular and the Black: the arms lean less as the pen grows (Geist Black's
 * right arm falls 0.32 across for every unit down, the Thin's 0.37), so the
 * vee closes high over the line at a Black rather than deep in its crotch,
 * and the tail keeps a straight run into its foot.
 */
export function grotesqueY(style: Style): Recipe {
  const f = frame(style);
  const [X, lerpOn] = squared(f);
  // Geist's measures run no further than its Black: past it, the letter
  // widens by what the pen gains instead, so the vee keeps its shape.
  const lerp = (a: number, b: number, thin: number) =>
    lerpOn(a, a + (b - a) * Math.min(1, heaviness(f) / 0.67), thin);
  // Past the current Geist's Black, a stem of 194 (see `squaredNow`).
  const grow = Math.max(0, f.style.pen.weight - weightAtBlackness(f.style, 0.67 * nowBlack()));
  const k = X(1) - X(0);
  const H = (y: number) => (y / 530) * f.x;
  const top = f.x;
  // The left arm: from the x-height down to a level cut just over the line,
  // where it runs into the right one.
  const leftTop = at(X(lerp(46, 97, 16)) + grow / 2, top);
  const cut = H(lerp(10, 38, 10));
  const leftFoot0 = at(X(lerp(240, 282, 225)) + grow / 2, cut);
  // The right arm, straight down to where it turns into the foot.
  const rightTop = at(X(lerp(447, 482, 433)) + grow * 1.5, top);
  const lean = lerp(0.351, 0.316, 0.374);
  const dir = { x: -lean / Math.hypot(lean, 1), y: -1 / Math.hypot(lean, 1) };
  const floor = f.sits(f.desc);
  const radius = held(f, lerp(70, 95, 50) * k);
  // Turning right, from the arm's heading round to due left: the centre lies
  // to the right of the way the arm travels, a radius above the foot.
  const side = { x: -dir.y, y: dir.x };
  const centreY = floor + radius;
  const kneeY = centreY + radius * side.y;
  const knee = at(rightTop.x + (dir.x * (kneeY - top)) / dir.y, kneeY);
  const centre = at(knee.x - radius * side.x, centreY);
  const from = (Math.atan2(knee.y - centre.y, knee.x - centre.x) * 180) / Math.PI;
  // The foot reaches back under the letter to an upright cut, Geist's 81 in
  // from the ink at the Regular and 95 at the Black; never shorter than a
  // little past its turn.
  const toe = Math.min(X(lerp(81, 95, 64)) + grow / 2, centre.x - f.half * 0.3);
  /*
   * The left arm's cut stops inside the right arm: its corner a share of the
   * pen short of the right arm's far edge, or it stood out past it as a nick,
   * and far enough over the near one that the two arms are one piece of ink
   * on a face drawn to other proportions than Geist's.
   */
  const across = (lean2: number) => f.half * Math.hypot(1, lean2);
  const leftLean = (leftFoot0.x - leftTop.x) / (top - cut);
  const rightAtCut = rightTop.x + (dir.x * (cut - top)) / dir.y;
  const leftFoot = at(
    Math.max(
      Math.min(leftFoot0.x, rightAtCut + across(lean) - across(leftLean) - f.half * 0.35),
      rightAtCut - across(lean) - across(leftLean) + f.half * 0.8,
      // Nor standing out past the right arm's inside as more than Geist's
      // step there (29 at the Regular, 49 at the Black): past the Black a
      // wider pen made it a ledge.
      rightAtCut - across(lean) + across(leftLean) - lerp(29, 49, 16) * k * 1.2,
    ),
    cut,
  );
  return finish(f, [
    ink(f, straight(leftTop, leftFoot), f.end, LEVEL),
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
 * The G: the C's ring, carried round its foot into an upright that stands
 * on the baseline under a bar at the stem's weight, as Geist's is.
 */
export function grotesqueCapitalG(style: Style): Recipe {
  const f = frame(style);
  const [wide, t] = spread(f);
  const u = wide * thinned(f, 0.049);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const X = (x: number) => f.edge - f.half + x * u;
  const middle = (f.crest(f.cap) + f.dip(0)) / 2;
  const halfH = held(f, f.crest(f.cap) - middle);
  const gain = roundGain(f, 0, 11);
  const halfW = held(f, lerp(273, 253) * u + gain);
  const centre = at(f.edge + halfW, middle);
  const head = angleAt(f, centre, halfW, halfH, up(f, lerp(500, 470)), false);
  // The upright stands inside the ring's own right side, and the ring's
  // lower right is drawn in to run into it.
  const upright = Math.max(X(lerp(563, 578)) + gain * 2, centre.x + f.least);
  const drawnIn = upright - centre.x;
  const bar = up(f, 318);
  // Carried up into the bar, so its square end lies inside it: stopped
  // under the bar, the end's corner stood into the counter as a tooth.
  const foot = angleAt(f, centre, drawnIn, halfH, Math.min(bar, centre.y + halfH * 0.5), false);
  /*
   * The Sans's bowl keeps its own round and runs into the upright's side
   * low down, leaving a notch under it, where the upright drops straight to
   * the line as Geist's does. Drawn in to run up into the upright, it filled
   * that notch and the spur read as a curve.
   */
  const notched = f.style.metrics.xGrows !== undefined && halfW > drawnIn;
  /*
   * And its spur lighter than the stem, as Geist's is (0.75 of it at the
   * Regular, 0.6 at the Black), its right side where Geist's stands.
   */
  const spurW = notched ? f.half * 2 * atWeights(f, 0.93, 0.75, 0.65, 0.62, 0.6) : f.half * 2;
  const spurX = notched ? upright + f.half + atWeights(f, -2, 7, 5, 5, 1) - spurW / 2 : upright;
  /*
   * The bowl's lower right drawn in so its outside runs flush with the
   * spur's right side, and falls away from the spur's left side below the
   * bar into the notch.
   */
  const reach = notched ? Math.max(spurX + spurW / 2 - f.half - centre.x, f.least) : drawnIn;
  const into = notched
    ? angleAt(f, centre, reach, halfH, Math.min(bar, centre.y + halfH * 0.5), false)
    : foot;
  const bowl = chain(
    bend(f, centre, halfH, head, 270, halfW),
    bend(f, centre, halfH, 270, 360 + into, reach),
  );
  return finish(f, [
    ink(f, bowl, f.end, BUTT),
    notched
      ? // Its bar starts 4 to 17 units further in than its measures give, as Geist's.
        gBar(f, X(lerp(322, 344)) + atWeights(f, 0, 4, 17, 16, 13), spurX)
      : ink(f, straight(at(X(lerp(322, 344)), bar), at(spurX, bar)), BUTT, BUTT),
    /*
     * On a slab face the upright stands on the line bare: a slab on its foot
     * stepped out past the upright as the upright stepped out past the bar,
     * and at a Black the bar, the upright and the foot read as a staircase of
     * blocks beside the bowl -- a C with something stood next to it. A
     * Rockwell G has its spur, and no foot on it.
     */
    ((spur: Stroke) =>
      notched ? inherit(spur, { ...spur, pen: { ...spur.pen, weight: spurW } }) : spur)(
      ink(
        f,
        straight(
          at(spurX, notched ? gBarAt(f).y + gBarAt(f).deep / 2 : bar + f.upright),
          at(spurX, 0),
        ),
        BUTT,
        heavySlab(f) ? BUTT : f.end,
      ),
    ),
  ]);
}

/**
 * The Sans's G's bar, as Geist's: lighter than the stem as the weight grows
 * (0.94 of it at the Regular, 0.67 at the Black: 130 on 194) and a little
 * lower. On the stem's pen it stood 149 deep at the Black.
 */
function gBarAt(f: Frame): { y: number; deep: number } {
  return {
    deep: 2 * f.half * atWeights(f, 0.93, 0.94, 0.78, 0.7, 0.67),
    y: up(f, atWeights(f, 316, 318, 315.5, 312.5, 311)),
  };
}

function gBar(f: Frame, from: number, to: number): Stroke {
  const { y, deep } = gBarAt(f);
  const g = sidedFrame(f, 2 * f.half, deep);
  const one = ink(g, straight(at(from, y), at(to, y)), BUTT, BUTT);
  return inherit(one, { ...one, pen: g.style.pen });
}

/** Whether this face's serifs are slabs as heavy as a stem's end, as an Egyptian's are. */
function heavySlab(f: Frame): boolean {
  const { slab } = f.style.parts;
  return slab.on && slab.shape !== "wedge" && slab.thickness >= 0.4;
}

/**
 * The Q: the O, and a straight tail from inside the bowl out through its
 * foot, cut level at both ends, as Geist's is.
 */
export function grotesqueCapitalQ(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const X = (x: number) => f.edge - f.half + x * u;
  const ring = [capitalRing(f)];
  return finish(
    f,
    [
      ...ring,
      ink(
        f,
        straight(
          // Past the Black the tail starts lower, under a counter that has shut down onto it.
          at(X(lerp(339.5, 350)), up(f, lerp(200, 260) - 90 * Math.max(0, t - 1))),
          at(X(lerp(548, 598.7)), up(f, lerp(-69, -59))),
        ),
        LEVEL,
        LEVEL,
      ),
    ],
    true,
  );
}

/**
 * A frame drawing with a pen as heavy as Geist's sides and as light as its
 * crowns: Geist's round capitals are heavier at their sides than their stem
 * and lighter across their crowns -- the O 179 at its sides on UltraBlack's
 * stem of 172, 142 at its crowns.
 */
function sidedFrame(f: Frame, side: number, crown: number): Frame {
  const pen = { ...f.style.pen, weight: side, contrast: Math.max(0, 1 - crown / side), angle: 0 };
  return { ...f, half: side / 2, least: (side / 2) * 1.06, style: { ...f.style, pen } };
}

/**
 * The O, as Geist's: 649 across on the Regular (614 on the Thin, 720 on
 * the Black), its sides 90 (34, 201) and its crowns 84 (32, 157), from 16
 * under the line to 16 over the cap line. The plain O's bowl grew with the
 * weight past Geist's, 21 units too wide at UltraBlack and 33 at the Black.
 */
export function grotesqueCapitalO(style: Style): Recipe {
  const f = frame(style);
  return finish(f, [capitalRing(f)], true);
}

/** The O's ring, for the O and the Q. */
function capitalRing(f: Frame): Stroke {
  const [X, lerp] = squaredNow(f);
  const k = X(1) - X(0);
  const wide = lerp(649, 720, 614) * k;
  const side = lerp(90, 201, 34) * k;
  const crown = lerp(84, 157, 32) * k;
  const over = f.style.metrics.overshoot;
  const top = f.cap + over - crown / 2;
  const bottom = -over + crown / 2;
  const g = sidedFrame(f, side, crown);
  const one = ink(
    g,
    ring(
      g,
      at(X(0) + wide / 2, (top + bottom) / 2),
      held(g, (wide - side) / 2),
      held(g, (top - bottom) / 2),
    ),
  );
  return inherit(one, { ...one, pen: g.style.pen });
}

/**
 * The D, as Geist's: a stem, and a bowl flat along the lines and round at
 * the right, as heavy at its side as the O's and 89 at its crowns on the
 * Regular (32 on the Thin, 170 on the Black), 561 across (530, 632). The
 * plain D's bowl grew past Geist's with the weight, 34 units too wide at
 * UltraBlack and 66 at the Black.
 */
export function grotesqueCapitalD(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squaredNow(f);
  const k = X(1) - X(0);
  const wide = lerp(561, 632, 530) * k;
  const side = lerp(90, 201, 34) * k;
  const crown = lerp(89, 170, 32) * k;
  const g = sidedFrame(f, side, crown);
  const top = f.cap - crown / 2;
  const bottom = crown / 2;
  const right = X(wide) - side / 2;
  const bowl = ink(
    g,
    lobeRun(g, f.edge, top, bottom, right, ((top - bottom) / 2) * 1.05),
    BUTT,
    BUTT,
  );
  return finish(f, [
    ink(f, straight(at(f.edge, 0), at(f.edge, f.cap)), f.end, f.end),
    inherit(bowl, { ...bowl, pen: g.style.pen }),
  ]);
}

/**
 * A bowl hung on a stem: flat along its top from the stem, round at the
 * right, and flat back to the stem along its foot -- the bowls of the B, the
 * P and the R, which Geist draws flat-sided and superelliptic.
 */
function lobeRun(
  f: Frame,
  stem: number,
  top: number,
  bottom: number,
  right: number,
  flat: number,
): Spine {
  const half = held(f, (top - bottom) / 2);
  const wide = held(f, Math.min(flat, right - stem - f.half));
  // Level with its top line always: where the pen leaves the bowl less room
  // than it will go round, the foot runs on down into the ink below it.
  const centre = at(right - wide, top - half);
  return chain(
    straight(at(stem, top), at(centre.x, top)),
    bend(f, centre, half, 90, -90, wide),
    straight(at(centre.x, centre.y - half), at(stem, centre.y - half)),
  );
}

/** The B: two such bowls, the lower the wider, meeting at a waist below the middle. */
export function grotesqueCapitalB(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const stem = f.edge;
  const X = (x: number) => stem + x * u;
  const waist = up(f, lerp(360, 380));
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ink(
      f,
      lobeRun(f, stem, f.hangs(f.cap), waist, X(lerp(409, 392)) + roundGain(f, 7, 21), 150 * u),
    ),
    /*
     * Its top half a unit under the upper's foot: drawn on exactly the same
     * line, the two bars' edges coincided and a union of the letter -- which
     * is how its counters are counted, and how it is exported -- lost the
     * lower counter at some weights.
     */
    ink(
      f,
      lobeRun(f, stem, waist - 0.5, f.sits(0), X(lerp(439, 423)) + roundGain(f, 8, 23), 160 * u),
    ),
  ]);
}

/** The P: the R's bowl, a little deeper, on its stem. */
export function grotesqueCapitalP(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const stem = f.edge;
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ink(
      f,
      lobeRun(
        f,
        stem,
        f.hangs(f.cap),
        up(f, lerp(330, 305)),
        stem + lerp(419, 401) * u + roundGain(f, 7, 20, 12),
        160 * u,
      ),
    ),
  ]);
}

/**
 * The R: the P's bowl, flat along the top and the waist and round at the
 * right, and a leg that leaves the waist inside the bowl, turns down and runs
 * nearly upright to a foot cut level on the baseline, as Geist's does.
 */
export function grotesqueR(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const stem = f.edge;
  const X = (x: number) => stem + x * u;
  const top = f.hangs(f.cap);
  const waist = up(f, lerp(343, 330));
  const lobeHalf = held(f, (top - waist) / 2);
  const gain = roundGain(f, 8, 22, 2);
  const right = X(lerp(423, 411)) + gain;
  const lobeWide = held(f, Math.min(160 * u, right - stem - f.half));
  const lobe = at(right - lobeWide, waist + lobeHalf);
  // The leg: out of the waist, round a turn, and down to its foot.
  const foot = at(X(lerp(430.5, 415)) + gain, 0);
  const radius = held(f, Math.min(150 * u, (waist - f.half) * 0.7));
  // Its turn set so the leg comes down leaning a little out, as Geist's does.
  const centre = at(foot.x - radius - 0.09 * (waist - radius), waist - radius);
  const from = centre.x;
  const base = Math.atan2(foot.y - centre.y, foot.x - centre.x);
  const apart = Math.acos(Math.min(1, radius / Math.hypot(foot.x - centre.x, foot.y - centre.y)));
  // Of the two tangents from the foot, the one on the outside of the turn.
  const turnTo =
    ((Math.cos(base + apart) > Math.cos(base - apart) ? base + apart : base - apart) * 180) /
    Math.PI;
  const off = pointOn(centre, radius, turnTo);
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ink(
      f,
      chain(
        straight(at(stem, top), at(lobe.x, top)),
        bend(f, lobe, lobeHalf, 90, -90, lobeWide),
        straight(at(lobe.x, waist), at(stem, waist)),
      ),
    ),
    ink(
      f,
      chain(
        straight(at(Math.min(from, lobe.x) - radius * 0.2, waist), at(from, waist)),
        pinned(turn(centre, radius, 90, turnTo), 1),
        straight(off, foot),
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
  // From the left of the ink: the stem's middle 410 in on the Regular and 454
  // on the Black, the hook's 228 and 271, run on past the Black as the pen
  // grows so the hook keeps its counter.
  const [X, lerp] = squared(f);
  const stem = X(lerp(410, 454, 402));
  const bottom = f.dip(0);
  const centreX = X(lerp(227.5, 270.5, 208));
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
  const [X, lerp] = squared(f);
  // On the face's own x-height: Geist's t does not grow with its x-height.
  const H = (y: number) => (y / 530) * f.xOwn;
  // Measured from the left of the bar: Geist's stem stands 120 in on the
  // Regular and 175 on the Black, and the bar and the foot run to 305 and 303
  // there, 402 and 402 here.
  // Geist Thin's: 108, a turn of 88, and 252 to both ends.
  const stem = X(lerp(120, 175, 108));
  const foot = f.sits(0);
  const radius = held(f, lerp(106, 150, 88) * (X(1) - X(0)));
  const toe = Math.max(X(lerp(303, 402, 252)), stem + radius + f.half * 0.2);
  // Its top edge a little over the x-height at a Black, as Geist's is.
  const bar = f.hangs(H(Math.min(lerp(530, 538), 538)), f.bar);
  const head = H(Math.min(lerp(650, 664, 654), 664));
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, head), at(stem, foot + radius)),
        pinned(turn(at(stem + radius, foot + radius), radius, 180, 270), 1),
        straight(at(stem + radius, foot), at(toe, foot)),
      ),
      f.end,
      f.end,
    ),
    thin(f, straight(at(X(0), bar), at(X(lerp(305, 402, 252)), bar)), f.end, f.end),
  ]);
}

/**
 * The l: a stem from the ascender turning out at its foot along the baseline
 * into a short tail cut upright, as Geist's l does.
 */
export function grotesqueL(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  if (f.style.metrics.xGrows !== undefined) return finish(f, sansEll(f, u));
  const stem = f.edge;
  const foot = f.sits(0);
  const radius = held(f, 50 * u);
  // Its tail reaches the same way past the stem at every weight: Geist's
  // stands 78 units out on the Regular and 88 on the Thin.
  const toe = Math.max(stem + f.half + 80 * u, stem + radius + f.half * 0.2);
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, f.asc), at(stem, foot + radius)),
        pinned(turn(at(stem + radius, foot + radius), radius, 180, 270), 1),
        straight(at(stem + radius, foot), at(toe, foot)),
      ),
      f.end,
      f.end,
    ),
  ]);
}

/**
 * The Sans's l, as Geist's: its tail lighter than its stem as the weight
 * grows (0.88 of it at the Regular, 0.71 at the Black), reaching 79 units
 * past the stem (88 at the Thin), and turning out of the stem's foot in a
 * corner smaller than the stem is wide at the Black (164 against 194).
 * Drawn as one run on the stem's pen, the Black's tail stood 57 units too
 * deep and its corner cut 30 units further in.
 *
 * Three strokes: the stem down to where the corner starts; the corner and
 * the tail on a round pen as heavy as the tail; and the stem's right side
 * carried on down into the tail beside the corner.
 */
function sansEll(f: Frame, u: number): Stroke[] {
  const wide = f.half * 2;
  const left = f.edge - f.half;
  const tail = wide * atWeights(f, 0.93, 0.88, 0.77, 0.72, 0.71);
  const out = atWeights(f, 83, 104, 128, 152, 164) * u;
  const up_ = Math.max(atWeights(f, 80, 100, 126, 153, 166) * u, tail * 1.1);
  // A round turn, as near round as Geist's is (95 across and 97 up at the
  // Black), in one piece at every weight.
  const across = Math.max((out - tail / 2 + up_ - tail / 2) / 2, tail * 0.55);
  const tall = across;
  const foot = tail / 2;
  const toe = left + wide + atWeights(f, 88, 79, 79, 79, 79);
  const round = { ...f.style.pen, weight: tail, contrast: 0, angle: 0 };
  // The corner's own frame: its curve is drawn for the tail's pen.
  const g: Frame = {
    ...f,
    half: tail / 2,
    least: (tail / 2) * 1.06,
    style: { ...f.style, pen: round },
  };
  const turned = ink(
    g,
    chain(
      straight(at(left + foot, Math.max(up_, foot + tall) + 1), at(left + foot, foot + tall)),
      pinned(turn(at(left + foot + across, foot + tall), across, 180, 270), 1),
      straight(at(left + foot + across, foot), at(toe, foot)),
    ),
    BUTT,
    f.end,
  );
  const side = wide - tail + 2;
  const beside = ink(
    f,
    straight(at(left + wide - side / 2, up_ + 1), at(left + wide - side / 2, foot)),
    BUTT,
    BUTT,
  );
  /*
   * And the inside corner filled round, as Geist's is: 33 units at the
   * Regular, 50 at the Black. The fill is a quarter turn lying between that
   * round and the square corner it rounds off.
   */
  const fillet = atWeights(f, 52, 33, 40, 47, 50) * u;
  const corner = at(left + wide + fillet, tail + fillet);
  const reach = fillet * ((1 + Math.SQRT2) / 2);
  const band = fillet * (Math.SQRT2 - 1) + 2;
  const filled = ink(f, turn(corner, reach, 180, 270), BUTT, BUTT);
  return [
    ink(f, straight(at(f.edge, f.asc), at(f.edge, up_)), f.end, BUTT),
    inherit(turned, { ...turned, pen: round }),
    inherit(beside, { ...beside, pen: { ...round, weight: side } }),
    inherit(filled, { ...filled, pen: { ...round, weight: band } }),
  ];
}

/** The one: an upright with a flag that curves off its head. */
export function grotesqueOne(style: Style): Recipe {
  const f = frame(style);
  if (f.style.metrics.xGrows !== undefined) return finish(f, sansOne(f));
  const u = large(f, 1);
  const [, lerp] = squared(f);
  /*
   * Geist's flag sweeps up out of the stem's head in one turn that lands on
   * the cap line -- a turn as tall as the flag hangs below it, at every
   * weight -- and at the Black the flag hangs lower and the stem stands
   * further in (from the ink's left, 165 at the Thin, 191 at the Regular and
   * 243 at the Black; the flag's top at 590, 600 and 571). A smaller turn
   * standing up the stem's side left a Black's flag a slab glued onto it.
   */
  // And a little further out from a SemiBold on, as the current Geist's is.
  const stem = f.edge - f.half * 0.1 + lerp(191, 243, 165) * u + roundGain(f, 3, 8, -5);
  const flag = f.hangs((lerp(600, 571, 590) / 710) * f.cap);
  /*
   * Never so wide that the outside of the turn rises clear of the flag
   * before it reaches the stem, which at a light weight left a hole in the
   * corner: Geist fills that corner solid, and a stroke can only fill it
   * where its turn is tight enough for its own pen.
   */
  const across = 4 * f.half + 2 * f.upright;
  const widest = ((across + Math.sqrt(across * across - 4 * f.upright * f.upright)) / 2) * 0.95;
  // Nor wider than the flag is long, or the flag would run backwards.
  const start = f.edge - f.half * 0.1;
  const radius = held(f, Math.min(f.cap - flag, widest, stem - start - 1));
  const bend = at(stem - radius, flag + radius);
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ink(
      f,
      chain(
        straight(at(start, flag), at(Math.max(bend.x, start), flag)),
        pinned(turn(bend, radius, 270, 360), 1),
        straight(at(stem, bend.y), at(stem, Math.max(bend.y, f.cap - f.half))),
      ),
      f.end,
      BUTT,
    ),
    // And the flag's underside runs straight on into the stem, square in
    // the corner as Geist's is, under the outside of the turn.
    ink(f, straight(at(start, flag), at(stem, flag)), f.end, BUTT),
  ]);
}

/**
 * The Sans's one, as Geist's, measured from its ink's left at its five
 * weights: the flag lighter than the stem as the weight grows (74 deep at
 * the Regular, 136 at the Black on a stem of 196), and over it a cove as
 * wide as the flag is long past its first sixty units, carved into the stem's
 * head (ending 18 units in from its left at the Regular, 40 at the Black).
 * Turned up out of the flag on the stem's pen, the cove was half the size and
 * the Black's flag stood 60 units too deep.
 *
 * Drawn as the stem up to the flag; the flag; a turn from the flag up to the
 * cap line on a pen lighter across, its inside the cove; the stem's head
 * beside it, narrowed to the cove; and at a light weight a fill in the corner
 * under the cove, which a thin turn leaves open.
 */
function sansOne(f: Frame): Stroke[] {
  const k = f.cap / 710;
  const left = f.edge - f.half;
  const X = (x: number) => left + x * k;
  const right = X(atWeights(f, 181, 234, 282, 330, 354));
  const stem = right - f.half;
  const coveStart = X(atWeights(f, 48, 60, 61, 61, 62));
  const coveTop = X(atWeights(f, 155, 166, 179, 191, 198));
  const flagTop = up(f, atWeights(f, 590, 600, 586, 571, 564));
  const flagFoot = up(f, atWeights(f, 564, 526, 487, 448, 428));
  const deep = flagTop - flagFoot;
  const head = right - coveTop;
  const even = (weight: number) => ({ ...f.style.pen, weight, contrast: 0, angle: 0 });
  const penned = (stroke: Stroke, pen: Stroke["pen"]): Stroke =>
    inherit(stroke, { ...stroke, pen });
  const flagPen = sidedFrame(f, f.half * 2, deep);
  const turnPen = sidedFrame(f, head, deep);
  const centre = at(coveStart, f.cap);
  const across = coveTop - coveStart + head / 2;
  const tall = f.cap - flagTop + deep / 2;
  const middle = (flagTop + flagFoot) / 2;
  // The corner under the cove, filled along its diagonal as far as the
  // turn's spine and no further, where the turn's own ink takes over.
  const toward = at(centre.x - coveTop, centre.y - flagTop);
  const length = Math.hypot(toward.x, toward.y) || 1;
  const d = at(toward.x / length, toward.y / length);
  const o = at((coveTop - centre.x) / across, (flagTop - centre.y) / tall);
  const e = at(d.x / across, d.y / tall);
  const qa = e.x * e.x + e.y * e.y;
  const qb = 2 * (o.x * e.x + o.y * e.y);
  const qc = o.x * o.x + o.y * o.y - 1;
  const root = qb * qb - 4 * qa * qc;
  const along = Math.max(qc > 0 && root > 0 ? (-qb - Math.sqrt(root)) / (2 * qa) : 1, 1);
  const tip = at(coveTop + d.x * along, flagTop + d.y * along);
  const fill = Math.min(deep, head) * 1.4 + 8;
  return [
    ink(f, straight(at(stem, 0), at(stem, flagTop)), f.end, BUTT),
    penned(
      ink(flagPen, straight(at(left, middle), at(stem, middle)), BUTT, BUTT),
      flagPen.style.pen,
    ),
    penned(
      ink(turnPen, bend(turnPen, centre, tall, 270, 360, across), BUTT, f.end),
      turnPen.style.pen,
    ),
    penned(
      ink(
        f,
        straight(at(coveTop + head / 2, flagTop - 1), at(coveTop + head / 2, f.cap)),
        BUTT,
        f.end,
      ),
      even(head),
    ),
    penned(ink(f, straight(at(coveTop, flagTop), tip), BUTT, BUTT), even(fill)),
  ];
}

/**
 * The seven: an arm along the cap line cut square at its end, and a stroke
 * falling from under that end in one long curve that stands upright on the
 * baseline, as Geist's does.
 *
 * The curve starts where its outer edge meets the foot of the arm's square
 * end, so the corner is the arm's own cut carried on down the curve with no
 * spur and no notch; and it is a single arc, upright where it lands, whose
 * radius and lean are whatever carry it from there to the foot.
 */
export function grotesqueSeven(style: Style): Recipe {
  const f = frame(style);
  const X = across(f, 40, -0.068, figureFit(f, 0.0144, -0.0083, 0.016, -0.043));
  const pen = penReach(style.pen);
  const line = f.hangs(f.cap);
  const end = X(545);
  const foot = X(257);
  const corner = at(end, f.cap - f.upright * 2);
  let lean = (40 * Math.PI) / 180;
  let from = corner;
  let radius = 0;
  for (let step = 0; step < 8; step++) {
    const side = reachAlong(at(Math.cos(lean), -Math.sin(lean)), pen);
    from = at(corner.x - side.x, corner.y - side.y);
    lean = 2 * Math.atan(Math.max(from.x - foot, 1) / Math.max(from.y, 1));
    radius = Math.max((from.x - foot) / (1 - Math.cos(lean)), f.least);
  }
  const centre = at(from.x + radius * Math.cos(lean), from.y - radius * Math.sin(lean));
  return finish(f, [
    ink(f, straight(at(f.edge - f.half, line), at(end, line)), f.end, BUTT),
    ink(f, turn(centre, radius, 180 - (lean * 180) / Math.PI, 180), BUTT, f.end),
  ]);
}

/**
 * The ampersand, as Geist draws it: one run from the foot of the leg up the
 * diagonal into the left of the loop, over its top and down its right, and
 * back across the diagonal into the lower bowl, which comes round the bottom
 * to meet the leg; and a short arm curving down into that meeting from a
 * terminal cut level on the right.
 *
 * The loop closes where the run crosses itself, so its counter is a
 * teardrop pointing down into the crossing and the lower counter a rounded
 * triangle, as Geist's are. Every joint is found on the curves as drawn --
 * the diagonal tangent to the loop, the crossing tangent to both the loop and
 * the bowl -- so the run is smooth at every weight and has the same pieces.
 */
export function grotesqueAmpersand(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const [wide, t] = spread(f);
  // At Geist's widths: it stood 14 wide at the Thin, 15 narrow at the
  // SemiBold and 11 wide at the Black.
  const u = wide * (1 + atWeights(f, -0.03, 0.0085, 0.03, 0.002, -0.021));
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const X = (x: number) => f.edge - f.half + x * u;
  const H = (y: number) => up(f, y);
  // The loop.
  // Past Geist Black the loop widens with the pen, or its counter is a slit.
  const beyond = Math.max(0, heaviness(f) - 0.67) * f.x * 0.2 * 0.35;
  const loopW = held(f, lerp(119, 144) * u + beyond);
  /*
   * And never much less tall than it is wide: a heavy pen took the loop's
   * crown down onto a loop still sat where the Regular's is, and it came out
   * a flat-sided slot with nothing round on it for the crossing to leave.
   */
  const loopH = held(f, Math.max(f.crest(f.cap) - H(lerp(551, 540)), loopW * 0.85));
  const loopY = f.crest(f.cap) - loopH;
  const loop = at(X(lerp(236, 307)), loopY);
  // The lower bowl.
  const bowlY = H(180);
  const bowlH = held(f, bowlY - f.dip(0));
  const bowlW = held(f, lerp(193, 204) * u);
  const bowl = at(X(lerp(237, 290)), bowlY);
  // The leg, from its foot up to where it runs tangent into the loop's left.
  const foot = at(X(lerp(510, 600)), 0);
  const split = -40;
  const entered = tangentFrom(foot, bend(f, loop, loopH, 270, 180, loopW));
  /*
   * Across from the loop to the bowl on a line tangent to both; where a heavy
   * pen leaves the two too close for one, the bowl's upper quarter is made
   * shallower until there is. A fixed number of tries, for the reason `ess`
   * gives.
   */
  let crossing: Spine | null = null;
  let shallow = bowlH;
  for (let pass = 0; pass < 12; pass++) {
    const run = crossTangent(
      bend(f, loop, loopH, split, -180, loopW),
      bend(f, bowl, shallow, 90, 180, bowlW),
      -1,
    );
    if (crossing) continue;
    if (run) crossing = run;
    else shallow = Math.max(f.least, shallow * 0.85);
  }
  const into = entered ? spineStart(entered.run) : pointOn(loop, loopW, 180);
  const leg = at(into.x - foot.x, into.y - foot.y);
  const armFoot = at(foot.x + (leg.x * H(150)) / leg.y, H(150));
  // The bowl comes round until its spine meets the leg's.
  const across = (p: Vec2) => (p.x - foot.x) * leg.y - (p.y - foot.y) * leg.x;
  let meet = 400;
  for (let d = 290; d <= 420; d += 0.5) {
    const p = bowlPoint(bowl, bowlW, bowlH, 1 - f.square, f.half, d, f.curve);
    if (across(p) > 0) {
      meet = d;
      break;
    }
  }
  // Geist's arm stands lower on its lighter weights: 255 on the Thin.
  const light = Math.min(1, Math.max(0, (87 - f.style.pen.weight) / 57));
  const armTop = at(X(lerp(496, 598)), H(lerp(318, 335) - 63 * light));
  return finish(f, [
    /*
     * Two runs, split on the loop's right side, so that neither crosses
     * itself: a swept run that does is an outline that does, and the
     * crossing is two strokes over each other as it is when drawn.
     */
    ink(
      f,
      chain(
        straight(foot, into),
        entered ? entered.run : straight(into, into),
        bend(f, loop, loopH, 180, split, loopW),
      ),
      f.end,
      BUTT,
    ),
    ink(
      f,
      chain(
        crossing ??
          crossAt(
            bend(f, loop, loopH, split, -180, loopW),
            bend(f, bowl, bowlH, 90, 180, bowlW),
            -110,
            130,
          ),
        bend(f, bowl, bowlH, 180, 270, bowlW),
        bend(f, bowl, bowlH, 270, meet, bowlW),
      ),
      BUTT,
      BUTT,
    ),
    ink(f, bowedTo(f, armTop, armFoot), f.end, BUTT),
  ]);
}

/**
 * Where a straight run from a point meets a run of arcs on a tangent, the
 * arcs travelled clockwise from there: the part of the arcs after that point,
 * with the pieces before it stood on it, so the run keeps its pieces.
 */
function tangentFrom(from: Vec2, arcs: Spine, way = -1): { run: Spine } | null {
  for (let index = 0; index < arcs.segments.length; index++) {
    const one = arcs.segments[index];
    if (one.kind !== "arc" || Math.abs(one.endAngle - one.startAngle) < 1e-9) continue;
    const v = at(one.centre.x - from.x, one.centre.y - from.y);
    const length = Math.hypot(v.x, v.y);
    if (length <= one.radius) continue;
    // The centre on the right of the way the line runs when turning
    // clockwise, on its left when turning anticlockwise.
    const lean = Math.asin(one.radius / length);
    const base = Math.atan2(v.y, v.x) - way * lean;
    const reach = Math.sqrt(length * length - one.radius * one.radius);
    const touch = at(from.x + Math.cos(base) * reach, from.y + Math.sin(base) * reach);
    const angle = Math.atan2(touch.y - one.centre.y, touch.x - one.centre.x);
    const along = alongArc(one, angle);
    if (along === null) continue;
    const at0 = one.startAngle + along;
    return {
      run: {
        closed: false,
        segments: arcs.segments.map((other, where) =>
          where < index
            ? { ...one, startAngle: at0, endAngle: at0 }
            : where === index
              ? { ...one, startAngle: at0 }
              : other,
        ),
      },
    };
  }
  return null;
}

/** How far along an arc an angle lies, in its own direction, or nothing if it is off it. */
function alongArc(one: SpineArc, angle: number): number | null {
  const span = one.endAngle - one.startAngle;
  const whole = Math.PI * 2;
  let along = (angle - one.startAngle) % whole;
  if (span >= 0) {
    if (along < 0) along += whole;
    return along <= span + 1e-9 ? along : null;
  }
  if (along > 0) along -= whole;
  return along >= span - 1e-9 ? along : null;
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
  /*
   * Geist's foot reaches the same way past the stem's left edge at every
   * weight -- 120 at the Thin, 100 at the Regular, 124 at the Black -- on a
   * turn of about 100 down its middle, 124 at the Black. Measured from the
   * stem's middle, a Black's foot was a stub a quarter of a stem long, glued
   * square onto the turn.
   */
  const t = Math.min(heaviness(f) / 0.67, 1.5);
  const l = thinness(f);
  const radius = held(f, (100 + 24 * t + 5 * l) * u);
  // The foot reaching as far as the current Geist's: 12 units further by its
  // UltraBlack than the older measures.
  const toe = Math.min(
    stem - f.half - (100 + 36 * t + 20 * l) * u,
    stem - radius - 1 - f.half * 0.5 * Math.max(0, heaviness(f) - 0.67),
  );
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
    grotesqueTittle(f, stem),
  ]);
}

/**
 * The u: the n turned round. A stem runs the whole x-height down the right,
 * and the trough comes down the left and round the bottom to spring into it
 * at the n's own springing, turned over -- so it meets the stem thinned, at
 * the notch every grotesque cuts there. Drawn as a U, with the trough rising
 * into both sides, it read as a small capital.
 */
export function grotesqueSmallU(style: Style): Recipe {
  const f = frame(style);
  if (!(f.superness > 0)) return LETTERS.u(style);
  uses("shoulder");
  const height = crested(f, f.x);
  const radius = shoulderRadius(f, height);
  const left = f.edge;
  // At Geist's width: it stood 9 narrow at the Thin, whose u is wider than
  // its n.
  const right = left + f.arch * 2 + atWeights(f, 9, -1, 1, 3, 1);
  // Half a pen up off the baseline and the overshoot back down: the arch's
  // crest, turned over (see `archSpine`).
  const floor = Math.min(f.sits(0) - f.over, height - radius);
  const middle = at((left + right) / 2, floor + radius);
  const half = (right - left) / 2;
  return finish(f, [
    ink(f, straight(at(right, f.x), at(right, f.x - f.crown)), f.end, f.end),
    ink(
      f,
      chain(
        straight(at(left, height), at(left, floor + radius)),
        bend(f, middle, radius, 180, 270, half),
        bend(f, middle, radius, 270, 360, half),
      ),
      f.end,
      BUTT,
    ),
  ]);
}

/**
 * The r: the stem, and an arm that leaves it on the same superelliptic
 * shoulder the n has, runs flat along the x-height and is cut upright.
 */
export function grotesqueSmallR(style: Style): Recipe {
  const f = frame(style);
  const u = small(f);
  const [X, lerp] = squared(f);
  const stem = f.edge;
  const wide = held(f, 130 * u);
  // Where the arm leaves the stem follows the shoulder's springing, as the
  // n's arch does: Geist's r and n spring from the same height.
  uses("shoulder");
  const spring = Math.min(0.85, Math.max(0.3, f.style.parts.shoulder.spring));
  const fall = held(f, (162 / 530) * f.x * ((1 - spring) / 0.38) - f.gain * 0.4);
  /*
   * The arm is drawn with a pen a quarter narrower across the stem, its
   * inside flush with the stem's and its outside buried in it, so it leaves
   * the stem thinned: the notch Geist cuts where the arm meets the stem --
   * ninety-five units deep on the Regular, a hundred and ten on the Black.
   */
  const { pen } = f.style;
  const narrow = pen.weight * (0.85 - 0.1 * Math.min(heaviness(f) / 0.67, 1));
  const across = pen.weight * (1 - pen.contrast);
  const armPen = { ...pen, weight: narrow, contrast: Math.max(0, 1 - across / narrow) };
  // Hung from the x-height by its own thickness, which a lighter pen may make less.
  const top = f.x - (narrow * (1 - armPen.contrast)) / 2;
  const from = stem + f.half - narrow / 2;
  /*
   * The turn measured on its inside, as Geist's is: 118 across and 138 down
   * on the Regular, 124 and 104 on the Black -- a heavy r's arm still curves
   * out of the stem rather than sitting on it as a block.
   */
  const thick = narrow * (1 - armPen.contrast);
  // Held at the Black's past it, where the turn is all an Ultra's arm has left.
  const tb = Math.min(heaviness(f) / 0.67, 1);
  const across2 = Math.max((118 + 6 * tb) * (X(1) - X(0)) + narrow / 2, narrow * 0.54);
  const down = Math.max(
    ((138 - 34 * tb) / 530) * f.x * ((1 - spring) / 0.38) + thick / 2,
    narrow * 0.54,
  );
  void wide;
  void fall;
  const corner = at(from + across2, top - down);
  // 208 across on the Thin, where the arm is short.
  const end = Math.max(X(lerp(256, 344, 209)), corner.x + f.half * 0.3);
  // Its turns held to what its own pen goes round: see `holds` in `shapes.ts`.
  const af: Frame = { ...f, half: narrow / 2, style: { ...f.style, pen: armPen } };
  const arm = ink(
    af,
    chain(
      bend(af, corner, down, 180, 90, corner.x - from),
      straight(at(corner.x, top), at(end, top)),
    ),
    BUTT,
    f.end,
  );
  /*
   * And at a heavy weight the arm's top carried level back over its turn to
   * where it leaves the stem: the turn's outside rises off the stem's corner,
   * and past the Black the dip between the two -- a notch on top of the
   * letter where Geist Black has one clean shoulder -- was plain. Nothing of
   * it up to the Black, where that dip is Geist's own shoulder.
   */
  const lift = Math.min(1, Math.max(0, (heaviness(f) / 0.67 - 1) / 0.5));
  const cover = inherit(arm, {
    ...ink(
      af,
      straight(at(corner.x - 1 - (corner.x - from) * lift, top), at(corner.x, top)),
      BUTT,
      BUTT,
    ),
    pen: armPen,
  });
  return finish(f, [ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end), arm, cover]);
}

/**
 * The f: a stem turning over at the ascender into a flat hook cut upright,
 * and a bar across at the x-height reaching further right than left.
 */
export function grotesqueF(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  uses("crossbar");
  const u = small(f);
  const stem = f.edge + 114 * u;
  const top = f.hangs(f.asc);
  /*
   * Geist's hook and bar reach the same distance past the stem at every
   * weight, Thin to Black (the hook 141 past its right edge, the bar 135
   * right and 76 left): measured off the stem's edges, not its middle, or a
   * heavy stem swallows them into stubs and a light one leaves them long.
   */
  const past = f.half - 43.5 * u;
  const wide = held(f, 101 * u + past * 0.6);
  const fall = held(f, (109 / 530) * f.x - f.gain * 0.3);
  const corner = at(stem + wide, top - fall);
  // And further as the weight grows, as the current Geist's does: 12 units
  // on the bar's left and 14 on the right by its UltraBlack.
  const more = heavyT(f);
  const end = Math.max(stem + f.half + 136 * u + 17 * more, corner.x + f.half * 0.3);
  // Geist's bar is as heavy as the hook's crown (Black 125, Regular 76) and
  // hangs a little under the x-height at a Black (top 511).
  const bar = f.hangs(f.x - 19 * u * Math.min(1, heaviness(f) / 0.67));
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
    thin(
      f,
      straight(
        at(stem - f.half - 76 * u - 12 * more, bar),
        at(stem + f.half + 130 * u + 17 * more, bar),
      ),
      f.end,
      f.end,
    ),
  ]);
}

/**
 * The question mark: a superelliptic hook from a terminal on the left, over
 * and down the right, then a straight diagonal that turns into a short
 * upright neck, cut level over a square dot.
 */
export function grotesqueQuestion(style: Style): Recipe {
  const f = frame(style);
  // At Geist's widths: it stood 11 wide at the Thin and 16 narrow at the
  // SemiBold.
  const u = large(f) * (1 + atWeights(f, -0.028, 0.021, 0.043, 0.036, 0.023));
  const side = stopRadius(f);
  // The dot's own top: a square dot is less tall than wide at a heavy weight.
  const dotTop = spineEnd(dot(f, at(0, side), side).spine).y;
  /*
   * The white between the neck and the dot closes as the pen grows: Geist's
   * is 151 at the Thin, 88 at the Regular, 77 at the SemiBold, 65 at the
   * UltraBlack and 60 at the Black. Held to two stems, a Thin's neck ran
   * down nearly onto its dot and a Black's stopped far above it.
   */
  const gap = Math.max(atWeights(f, 157, 88, 77, 65, 60), 50);
  const neckFoot = dotTop + (gap / 710) * f.cap;
  const crest = f.crest(f.cap);
  const halfW = held(f, 191 * u);
  /*
   * From the SemiBold on the hook is a tenth shallower, as Geist's is: at
   * the full depth its lower right stood 48 units out past Geist's 350 up at
   * the UltraBlack and the neck ran on round it.
   */
  const halfH = held(
    f,
    Math.min((156 / 710) * f.cap, (crest - neckFoot) / 2.6) * atWeights(f, 1.05, 1, 0.9, 0.9, 0.9),
  );
  const centre = at(f.edge + halfW, crest - halfH);
  const neckX = f.edge + 189 * u;
  // Left where Geist's hook leaves its bowl for the neck, at each weight.
  const hook = bend(f, centre, halfH, 190, atWeights(f, -40, -45, -40, -50, -50), halfW);
  const last = hook.segments[hook.segments.length - 1];
  const from = spineEnd(hook);
  const h = headingAt(last, "end");
  /*
   * Geist's neck rounds into its diagonal on a wide turn, its left side
   * leaning from well above the dot: on a turn half as wide, the Regular's
   * neck stood upright, 15 to 30 units left of Geist's from 300 to 400 up.
   * A little tighter at the heavy weights, where the turn is short.
   */
  const radius = held(f, atWeights(f, 150, 150, 150, 110, 100) * u);
  // Along the diagonal until a left turn of this radius lands upright on the
  // neck's line.
  const along = Math.max((neckX + radius + radius * h.y - from.x) / h.x, 1);
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

/*
 * The figures.
 *
 * Proportional, as Geist's are, and each drawn off Geist Regular's own
 * skeleton: horizontal measures in units of the capital O (so a Black's
 * figures narrow their spines as its stems widen, the way Geist's do and the
 * ink still grows), measured from where the figure's ink starts; heights as
 * shares of the cap height, with the curves carried to the overshoot.
 */

/** Where Geist's `x` falls on this figure's spine, for a figure whose ink starts at `ink`. */
function across(f: Frame, ink: number, thin = 0, fit = 1): (x: number) => number {
  // `thin`: how much wider a light weight runs than the Regular's measures
  // give, where Geist Thin's figure is wider (its 6 and 9 by six per cent);
  // `fit`, the figure's own correction (`figureFit`).
  const u = large(f, 1) * (1 + thin * thinness(f)) * fit;
  return (x) => f.edge + (x - ink - 43) * u;
}

/** A height on Geist's figures, as a share of the cap height. */
const up = (f: Frame, y: number): number => (y / 710) * f.cap;

/**
 * The angle on a bowl at which its spine comes to a height, on the side of it
 * asked for: found on the bowl as drawn, superelliptic corners and all, so a
 * terminal cut level there is cut at that height.
 */
function angleAt(
  f: Frame,
  centre: Vec2,
  halfW: number,
  halfH: number,
  y: number,
  left: boolean,
): number {
  const height = (degrees: number): number =>
    bowlPoint(centre, halfW, halfH, 1 - f.square, f.half, degrees, f.curve).y;
  // Along the side from its lowest point to its highest, where it only climbs.
  let low = left ? 270 : -90;
  let high = 90;
  for (let step = 0; step < 40; step++) {
    const mid = (low + high) / 2;
    if (height(mid) < y) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** How long the two's reverse turn is at most, on Geist's measures. */
const REVERSE = 330;
/**
 * How deep the two's bowl's lower right is against its top, and how far from
 * upright its reverse turn runs before it rounds into the foot, in degrees,
 * at Geist's Thin, Regular, SemiBold, UltraBlack and Black: fitted to Geist's
 * stroke across the letter at each. Landed upright off a quarter a fifth
 * deeper, it stood 26 to 39 units right of Geist's above the middle and 16 to
 * 41 left of it below, an S where Geist's is nearly a diagonal; at one lean
 * for every weight the Thin's stood 50 units right and the Black's 40 left.
 */
const TWO_DEEP: [number, number, number, number, number] = [0.95, 0.95, 0.95, 1, 1.05];
const TWO_LEAN: [number, number, number, number, number] = [12, 18, 26, 34, 38];

/**
 * The two: a bowl from a terminal cut level on the left, over and down the
 * right, then a reverse curve that comes down into the left end of the foot
 * travelling upright, as Geist's does -- no straight diagonal, and no corner
 * where the bowl ends.
 */
export function grotesqueTwo(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const fit = figureFit(f, 0.017, -0.042, 0.016, -0.056);
  const X = across(f, 60, -0.04, fit);
  const top = f.crest(f.cap);
  const cy = up(f, 510);
  const halfH = held(f, top - cy);
  // And at the Thin as wide as Geist Thin's bowl, which reaches the foot's
  // end: narrowed with the face's light letters it stood 45 units narrow.
  const halfW = held(f, 195 * large(f, 1) * thinned(f, 0.055) * fit + atWeights(f, 24, 0, 0, 0, 0));
  const centre = at(X(315) + atWeights(f, 12, 0, 0, 0, 0), cy);
  const foot = f.sits(0, f.bar);
  /*
   * The reverse turn comes down leaning and rounds upright on a short arc
   * as it meets the foot, then runs straight down into it: still leaning
   * where it crossed the foot's top, the foot's corner stood out past it.
   */
  const leanDegrees = atWeights(f, ...TWO_LEAN);
  const lean = (leanDegrees * Math.PI) / 180;
  const upright = at(f.edge, foot * 1.5);
  // No tighter than the pen, or its inner side folds.
  const soft = f.half * 1.4;
  const land = at(upright.x + soft * (1 - Math.cos(lean)), upright.y + soft * Math.sin(lean));
  const from = angleAt(f, centre, halfW, halfH, up(f, 495), true);
  /*
   * Round the right, straight down across the letter, and a reverse turn
   * that lands upright on the foot: the straight tangent to both, found
   * exactly among the arcs the bowl's right side is drawn in, so the run has
   * no corner at any weight.
   */
  // As long a reverse turn as the bowl leaves room for.
  let falling: Spine | null = null;
  for (let reverse = REVERSE * large(f, 1) * fit; !falling && reverse > f.least; reverse *= 0.9) {
    const landing = at(land.x + reverse * Math.cos(lean), land.y - reverse * Math.sin(lean));
    /*
     * The bowl's lower right a deeper quarter than its top, left as late as
     * a tangent allows, as Geist's is: the stroke comes on round the bowl
     * well below its middle and turns over into the foot in one S. Left
     * high off a shallow quarter, it fell across the letter as a straight
     * band, bulkier and up and left of Geist's curve.
     */
    falling = crossTangent(
      bend(f, centre, held(f, halfH * atWeights(f, ...TWO_DEEP)), 0, -90, halfW),
      pinned(turn(landing, reverse, 90, 180 - leanDegrees), 1),
      -1,
      true,
    );
  }
  let over: Spine | null = falling
    ? chain(
        bend(f, centre, halfH, from, 0, halfW),
        falling,
        turn(
          at(land.x + soft * Math.cos(lean), land.y - soft * Math.sin(lean)),
          soft,
          180 - leanDegrees,
          180,
        ),
        straight(upright, at(upright.x, foot)),
      )
    : null;
  if (!over)
    over = chain(
      bend(f, centre, halfH, from, -45, halfW),
      straight(pointOn(centre, halfW, -45), upright),
      straight(upright, at(upright.x, foot)),
    );
  // The foot runs out as far as the bowl's right side, as Geist's does at
  // every weight: held to the Regular's measure it stood 57 units short at
  // the Black.
  const footEnd = Math.max(X(559), centre.x + halfW + f.half);
  /*
   * And the Sans's diagonal as heavy as Geist's at a heavy weight (184 across
   * at the Black on a stem of 194): a pen lighter across left it 166. Laid
   * again along the diagonal alone on a pen half as light across; both its
   * ends lie where the run stands near upright, inside it.
   */
  const heavier =
    falling && f.style.metrics.xGrows !== undefined
      ? [
          inherit(ink(f, falling, BUTT, BUTT), {
            ...ink(f, falling, BUTT, BUTT),
            pen: { ...f.style.pen, contrast: f.style.pen.contrast * 0.5 },
          }),
        ]
      : [];
  return finish(f, [ink(f, over, f.end, BUTT), ...heavier, arm(f, f.edge - f.half, footEnd, foot)]);
}

/**
 * The three: two bowls, the lower the larger, meeting at a short tongue cut
 * square on the left, and both ends cut level.
 */
export function grotesqueThree(style: Style): Recipe {
  return threeOf(style, false);
}

/**
 * The Sans's three, as Geist's: its waist lighter than its top and foot (132
 * against 159 and 161 at the Black) and coming down as the weight grows (378
 * at the Regular, 363 at the Black). On the stem's pen the waist was 149 at
 * the Black, and the counters under it the shorter for it.
 */
export function grotesqueThreeSided(style: Style): Recipe {
  return threeOf(style, true);
}

function threeOf(style: Style, sans: boolean): Recipe {
  const f = frame(lighterAcross(style));
  const fit = figureFit(f, 0.016, -0.012, 0.013, -0.069);
  const X = across(f, 50, 0.024, fit);
  const u = large(f, 1) * (1 + 0.024 * thinness(f)) * fit;
  const top = f.crest(f.cap);
  const bottom = f.dip(0);
  const [, now] = squaredNow(f);
  const waist = up(f, sans ? now(378, 363, 382) : 378);
  const upperH = held(f, (top - waist) / 2);
  const lowerH = held(f, (waist - bottom) / 2);
  // Geist's upper bowl reaches further left as the weight grows (6 units at
  // the Regular, 15 at the Black) and 5 further right at the Black.
  const upper = at(X(307) - (sans ? now(3, 5, 0) : 0), waist + upperH);
  const lower = at(X(308), waist - lowerH);
  const upperW = held(f, 188 * u + (sans ? now(3, 10, 0) : 0));
  const lowerW = held(f, 213 * u);
  /*
   * Geist cuts its top terminal lower as the weight grows: its end comes
   * down to 545 at the Regular and 508 at the Black, where cut at a fixed
   * height it stood at 555.
   */
  const drop = sans
    ? roundGain(f, 17, 35, 0) + (15 * Math.max(0, Math.min(heavyT(f), nowBlack()) - 0.41)) / 0.9
    : 0;
  const upperBowl = (g: Frame, centre: Vec2, halfH: number): Stroke =>
    ink(
      g,
      chain(
        bend(
          g,
          centre,
          halfH,
          angleAt(g, centre, upperW, halfH, up(f, 560 - drop), true),
          -90,
          upperW,
        ),
        straight(at(centre.x, waist), at(X(247), waist)),
      ),
      f.end,
      BUTT,
    );
  const lowerBowl = (g: Frame, centre: Vec2, halfH: number): Stroke =>
    ink(
      g,
      bend(g, centre, halfH, 90, angleAt(g, centre, lowerW, halfH, up(f, 188), true) - 360, lowerW),
      BUTT,
      f.end,
    );
  if (!sans) return finish(f, [upperBowl(f, upper, upperH), lowerBowl(f, lower, lowerH)], true);
  /*
   * Each bowl a pair on a pen as light across as the waist, sharing the
   * waist: one reaching the bowl's outside and one its inside, so the top
   * and the foot keep their weight. The waist never as heavy as the top and
   * foot, or a pair would be one bowl drawn twice and be drawn as one.
   */
  const band = 2 * f.upright;
  const light = band * roundGain(f, 0.97, 0.87, 0.97);
  // Geist's top and foot: 1.02 of the stem's crown at the Regular, 0.94 at
  // the SemiBold, as heavy again at the UltraBlack and 1.03 at the Black.
  const outside =
    band *
    (roundGain(f, 1.02, 0.94, 1.05) + 0.1 * Math.max(0, Math.min(heavyT(f), nowBlack()) - 0.41));
  const g = sidedFrame(f, 2 * f.half, light);
  const topOut = top + f.upright;
  const footOut = bottom - f.upright;
  const sided = (one: Stroke): Stroke => inherit(one, { ...one, pen: g.style.pen });
  const strokes: Stroke[] = [];
  for (const spine of [topOut - light / 2, topOut - outside + light / 2]) {
    const halfH = held(g, (spine - waist) / 2);
    strokes.push(sided(upperBowl(g, at(upper.x, waist + halfH), halfH)));
  }
  for (const spine of [footOut + light / 2, footOut + outside - light / 2]) {
    const halfH = held(g, (waist - spine) / 2);
    strokes.push(sided(lowerBowl(g, at(lower.x, waist - halfH), halfH)));
  }
  return finish(f, strokes, true);
}

/**
 * The four: a diagonal whose outer edge runs from the head of the stem to the
 * left end of the bar, closed at the top, the bar low and carried a little
 * past the stem.
 */
export function grotesqueFour(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const fit = figureFit(f, 0.0134, -0.0023, 0.0085, -0.0586);
  const X = across(f, 50, 0, fit);
  const [, lerp] = squared(f);
  // Geist Black's bar sits a little higher.
  const stem = X(461);
  const bar = up(f, lerp(188, 200.5));
  const pen = penReach(f.style.pen);
  const flank = Math.abs(reachAlong(at(1, 0), pen).x);
  const barEdge = bar + f.upright;
  const inkLeft = f.edge - f.half;
  // The diagonal's outer edge, from the bar's left end to the stem's head.
  const low = at(inkLeft, barEdge);
  const high = at(stem - flank, f.cap);
  const length = Math.hypot(high.x - low.x, high.y - low.y);
  const d = at((high.x - low.x) / length, (high.y - low.y) / length);
  const shift = reachAlong(at(d.y, -d.x), pen);
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ink(f, straight(at(low.x + shift.x, low.y + shift.y), at(high.x + shift.x, high.y + shift.y))),
    /*
     * The bar runs 81 past the stem's outside at every weight, as Geist's
     * does; measured from the stem's middle, a Black's bar was nearly flush
     * with it and the 4 lost its crossbar.
     */
    ink(f, straight(at(inkLeft, bar), at(stem + flank + 81 * large(f, 1) * fit, bar)), BUTT, f.end),
  ]);
}

/**
 * The five: a flag along the cap line, a short stem leaning back a little and
 * cut level, and a round bowl swung out of it to a terminal cut level on the
 * left.
 */
export function grotesqueFive(style: Style): Recipe {
  return fiveOf(style, false);
}

/**
 * The Sans's five: its bowl as Geist's, lighter at its crown than at its
 * foot (see `sidedPair`), and its top coming down as the weight grows.
 */
export function grotesqueFiveSided(style: Style): Recipe {
  return fiveOf(style, true);
}

function fiveOf(style: Style, sans: boolean): Recipe {
  const f = frame(lighterAcross(style));
  const fit = figureFit(f, 0.0144, 0, 0.009, -0.065);
  const X = across(f, 60, 0.009, fit);
  const u = large(f, 1) * (1 + 0.009 * thinness(f)) * fit;
  const flag = f.hangs(f.cap);
  /*
   * The Sans's stem as light as Geist's, which is lighter than its pen from
   * the SemiBold on (162 across at the UltraBlack on a stem of 172), and its
   * left side where Geist's is: it stood 5 to 13 units right of it.
   */
  const stemPen = sans ? Math.max(atWeights(f, 1, 1, 0.97, 0.94, 0.93), 0.93) : 1;
  const stemShift = sans ? atWeights(f, -13, -5, -7, -8, -7) - f.half * (1 - stemPen) : 0;
  const stemTop = at(X(168) + stemShift, f.cap);
  const [, lerp] = squared(f);
  // Geist Black cuts its stem's foot a little lower (289 against 310).
  // And Geist Thin's higher, at 327, where the Sans's stood 17 low.
  const stemFoot = at(
    X(120) + stemShift,
    up(f, lerp(310, 289)) + (sans ? atWeights(f, 17, 0, 0, 0, 0) : 0),
  );
  // The Sans's bowl as deep under the line as Geist's, 16.
  const bottom = f.dip(0) - (sans ? 4 : 0);
  // Geist's bowl tops out at 472 at the Regular and 452 at the Black; the
  // current Geist's stays up at 469 to 473 at every weight, though falling
  // away to the stem faster than a superellipse's: raised all the way, the
  // bowl's upper left stood 26 units over Geist's at the UltraBlack.
  const [, now] = squaredNow(f);
  const crown = up(f, sans ? now(472, 452, 471) + atWeights(f, 1, 2, 4, 11, 16) : 473) - f.upright;
  const halfH = held(f, (crown - bottom) / 2);
  const centre = at(X(311), bottom + halfH);
  const halfW = held(f, 211 * u);
  // Where the bowl leaves the stem: inside it, a stem's width under its head.
  // Held on the bowl's upper left, where the stem is, at every weight.
  /*
   * The bowl leaves the stem so that its inside starts exactly at the
   * corner of the stem's level foot, as Geist's does: its square start then
   * lies inside the stem. Left from a fixed height, a heavy pen's start
   * stood out under the foot as a beak.
   */
  const reach = penReach(f.style.pen);
  const insideAt = (degrees: number): Vec2 => {
    const p = bowlPoint(centre, halfW, halfH, 1 - f.square, f.half, degrees, f.curve);
    const nx = (p.x - centre.x) / (halfW * halfW);
    const ny = (p.y - centre.y) / (halfH * halfH);
    const length = Math.hypot(nx, ny) || 1;
    const out = reachAlong(at(nx / length, ny / length), reach);
    return at(p.x - out.x, p.y - out.y);
  };
  const fixed = angleAt(
    f,
    centre,
    halfW,
    halfH,
    Math.min(stemFoot.y + f.half * 1.1, centre.y + halfH * 0.55),
    true,
  );
  // On the left side, higher up it the larger the angle is below 180.
  let low = 100;
  let high = 179;
  for (let pass = 0; pass < 40; pass++) {
    const mid = (low + high) / 2;
    if (insideAt(mid).y > stemFoot.y) low = mid;
    else high = mid;
  }
  let found = (low + high) / 2;
  if (!(insideAt(found).y >= stemFoot.y - 1 && found < 178)) found = fixed;
  // And never so far round that its outside corner stands out past the
  // stem's left edge, as a light pen's did.
  const outsideAt = (degrees: number): Vec2 => {
    const inside = insideAt(degrees);
    const p = bowlPoint(centre, halfW, halfH, 1 - f.square, f.half, degrees, f.curve);
    return at(p.x * 2 - inside.x, p.y * 2 - inside.y);
  };
  const lean = (stemTop.x - stemFoot.x) / (stemTop.y - stemFoot.y);
  const clear = (degrees: number): boolean => {
    const o = outsideAt(degrees);
    return o.x >= stemFoot.x - f.half + lean * (o.y - stemFoot.y) - 0.5;
  };
  if (!clear(found)) {
    let a = 100;
    let b = found;
    for (let pass = 0; pass < 40; pass++) {
      const mid = (a + b) / 2;
      if (clear(mid)) a = mid;
      else b = mid;
    }
    found = a;
  }
  const leaves = found;
  /*
   * Geist's flag reaches further with the weight than the bowl under it
   * does: 428 units from the ink's left at the Thin, 457 at the Regular and
   * 546 at the Black, where on the figure's own measures it stood 26 long
   * at the Thin and 52 short at the Black.
   */
  /*
   * And the Sans's flag as deep as Geist's: 30 at the Thin, 84 at the
   * Regular, 113 at the SemiBold and 157 at the Black, where on the face's
   * horizontals it stood 28, 81, 118 and 149.
   */
  const flagDeep = sans ? Math.min(atWeights(f, 1.07, 1.037, 0.958, 1, 1.054), 1.054) : 1;
  const flagAt = f.cap - (f.cap - flag) * flagDeep;
  const flagEnd = X(518) + 36 * Math.min(heavyT(f), nowBlack()) + roundGain(f, -1, 6, -26);
  return finish(
    f,
    [
      ((bar: Stroke) =>
        inherit(bar, { ...bar, pen: { ...bar.pen, weight: bar.pen.weight * flagDeep } }))(
        ink(f, straight(at(stemTop.x - f.half * 0.2, flagAt), at(flagEnd, flagAt)), BUTT, f.end),
      ),
      ((stem: Stroke) =>
        inherit(stem, { ...stem, pen: { ...stem.pen, weight: stem.pen.weight * stemPen } }))(
        ink(f, straight(stemTop, stemFoot), BUTT, f.end),
      ),
      ...fiveBowl(f, sans, centre, halfW, halfH, Math.min(leaves, 175)),
    ],
    true,
  );
}

/** The five's bowl, from the stem round to its terminal: one, or a sided pair. */
function fiveBowl(
  f: Frame,
  sans: boolean,
  centre: Vec2,
  halfW: number,
  halfH: number,
  leaves: number,
): Stroke[] {
  // Cut higher as the weight grows: 205 at Geist's Black.
  // And Geist Thin's lower, where the Sans's terminal stood 12 high.
  const cut =
    up(f, 187 + (18 * Math.min(heavyT(f), nowBlack())) / nowBlack()) -
    (sans ? atWeights(f, 12, 0, 0, 0, 0) : 0);
  if (!sans)
    return [
      ink(
        f,
        bend(f, centre, halfH, leaves, angleAt(f, centre, halfW, halfH, cut, true) - 360, halfW),
        BUTT,
        f.end,
      ),
    ];
  const { g, bowls } = sidedPair(f, centre, halfH, figureCrown(f));
  return bowls.map(([middle, half]) => {
    const one = ink(
      g,
      bend(g, middle, half, leaves, angleAt(g, middle, halfW, half, cut, true) - 360, halfW),
      BUTT,
      f.end,
    );
    return inherit(one, { ...one, pen: g.style.pen });
  });
}

/**
 * The six: a round bowl, and a tall hood rising out of its left side, over the
 * top and down to a terminal cut level on the right.
 */
export function grotesqueSix(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  return finish(f, sixStrokes(f, false), true);
}

/**
 * The x and the X, as the plain ones are drawn, at Geist's widths: its x
 * grows with the pen by as much as the pen at every weight, where the plain
 * x grew 56 units from the Regular to the SemiBold and 43 on to the Black
 * (13 wide at the SemiBold, 11 narrow at the Black), and its X stood 19
 * wide at the Regular and 17 narrow at the Black.
 */
export function grotesqueSmallX(style: Style): Recipe {
  const f = frame(style);
  const width = f.arch * 1.7 + openVee(f) * 2 + atWeights(f, -8, -2, 0, 9, 11);
  const left = f.edge;
  return finish(f, [
    ink(f, straight(at(left, f.x), at(left + width, 0)), f.end, f.end),
    ink(f, straight(at(left, 0), at(left + width, f.x)), f.end, f.end),
  ]);
}

export function grotesqueCapitalX(style: Style): Recipe {
  const f = frame(style);
  const width = f.capBowl * 1.55 + openVee(f) * 2 + atWeights(f, 3, -19, -6, 13, 17);
  const left = f.edge;
  return finish(f, [
    ink(f, straight(at(left, f.cap), at(left + width, 0)), f.end, f.end),
    ink(f, straight(at(left, 0), at(left + width, f.cap)), f.end, f.end),
  ]);
}

/**
 * The m, as the plain one is drawn, with its counters at Geist's: the plain
 * m's two counters were each the n's, and it stood 20 units wide at the
 * Thin, where Geist Thin's m narrows further than its n does, and 9 wide at
 * the Black.
 */
export function grotesqueSmallM(style: Style): Recipe {
  const f = frame(style);
  const give = atWeights(f, M_THIN, M_REGULAR, M_REGULAR, M_ULTRA, M_BLACK);
  // The counter as drawn before a heavy weight narrows it, where the style
  // has been through `heavier` already: see `narrowed`.
  const { counterWidth, drawnCounter } = style.metrics;
  return LETTERS.m({
    ...style,
    metrics: {
      ...style.metrics,
      counterWidth: counterWidth - give,
      drawnCounter: drawnCounter === undefined ? undefined : drawnCounter - give,
    },
  });
}

/** How much narrower the m's counters are drawn than the n's, at the Thin, Regular, UltraBlack and Black. */
const M_THIN = 10;
const M_REGULAR = 1;
const M_ULTRA = 1.5;
const M_BLACK = 8.5;

/** The Sans's six: its bowl as Geist's, lighter at its crown (see `sixBowl`). */
export function grotesqueSixSided(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  // Geist cuts the hood lower at the Black: 520 against 552.
  const [, now] = squaredNow(f);
  return finish(f, sixStrokes(f, true, now(552, 520, 552)), true);
}

/** The six's and the nine's correction: see `figureFit`. */
const sixFit = (f: Frame): number => figureFit(f, 0, -0.024, 0, -0.053);
/** The Sans's nine's: Geist's nine stands 6 units wider than its six. */
const nineFit = (f: Frame): number => figureFit(f, 0.015, -0.009, 0.016, -0.053);

/**
 * The six's strokes, its hood cut level at `cut` on Geist's measures (552,
 * as the plain six's is), or the nine's tail, turned.
 */
function sixStrokes(f: Frame, sans: boolean, cut = 552, fit = sixFit(f)): Stroke[] {
  const X = across(f, 60, 0.025, fit);
  const u = large(f, 1) * (1 + 0.025 * thinness(f)) * fit;
  const bottom = f.dip(0);
  const top = f.crest(f.cap);
  /*
   * The Sans's bowl is Geist's: its top comes down as the weight grows (477
   * at the Regular, 448 at the Black) and its crown is lighter than its
   * foot (120 against 149 at the Black). Drawn as one ring on the stem's
   * pen, its crown was 152 at the Black and stood 35 units high, closing the
   * counter under the hood to half of Geist's.
   */
  const [, now] = squaredNow(f);
  const bowlTop = up(f, sans ? now(477, 448, 472) : 484) - f.upright;
  const radius = held(f, (bowlTop - bottom) / 2);
  const centre = at(X(313), bottom + radius);
  const wide = held(f, 207 * u);
  /*
   * The hood is a little wider than the bowl, its left side on the bowl's,
   * so it curves all the way down into it and its terminal reaches out over
   * the bowl's right side as Geist's does: drawn on the bowl's own width it
   * stopped thirty units short, over a long straight left side.
   */
  const hoodY = Math.max(up(f, 260), centre.y);
  const hoodH = held(f, top - hoodY);
  // Held in at the heavy weights, where cut lower the hood's end reached
  // past the bowl's side; Geist keeps it inside.
  const out = 25 * u - (sans ? now(0, 9, 0) + 4 : 0);
  const hood = at(centre.x + out, hoodY);
  const hoodW = wide + out;
  /*
   * The Sans's hood fuller than the face's round, and fuller over its crown
   * to the right than down its left, as Geist's is from the Regular on: at
   * the face's fullness Geist's stood 9 to 23 units out past it either side
   * 700 up and the hood's left side 5 to 10 units in from Geist's. Split at
   * its crown at every weight, so the hood has as many points at each.
   */
  const overRight = sans ? { ...f, curve: atWeights(f, 0.15, 0.25, 0.25, 0.35, 0.35) } : f;
  const downLeft = sans ? { ...f, curve: atWeights(f, 0.15, 0.2, 0.25, 0.25, 0.2) } : f;
  const end = angleAt(overRight, hood, hoodW, hoodH, Math.max(up(f, cut), hoodY + f.half), false);
  return [
    ...sixBowl(f, sans, centre, wide, radius, figureCrown(f)),
    ink(
      f,
      chain(
        bend(overRight, hood, hoodH, end, 90, hoodW),
        bend(downLeft, hood, hoodH, 90, 180, hoodW),
        straight(at(hood.x - hoodW, hoodY), at(hood.x - hoodW, centre.y)),
      ),
      f.end,
      BUTT,
    ),
  ];
}

/**
 * The six's bowl. The Sans draws it as two rings on a pen lighter across,
 * `share` of the stem's pen at its crown. Both rings share the top, and the
 * foot keeps the stem's pen: one ring's counter is the bowl's counter and
 * the other's outside is the bowl's outside. Other faces draw one ring on
 * their own pen.
 */
function sixBowl(
  f: Frame,
  sans: boolean,
  centre: Vec2,
  wide: number,
  radius: number,
  share: number,
): Stroke[] {
  if (!sans) return [ink(f, ring(f, centre, wide, radius))];
  const { g, bowls } = sidedPair(f, centre, radius, share);
  return bowls.map(([middle, half]) => {
    const one = ink(g, lopsidedRing(g, middle, wide, half, SIX_BOWL));
    return inherit(one, { ...one, pen: g.style.pen });
  });
}

/**
 * How full each quarter of the Sans's six's bowl is, anticlockwise from its
 * upper right, fitted to Geist's six and nine from the Thin to the Black: its
 * left, where the hood rises out of it, is rounder than a superellipse and
 * its right fuller. As one superellipse at the face's fullness the bowl stood
 * 10 to 16 units out past Geist's at its lower left and 6 short at its right.
 */
const SIX_BOWL: [number, number, number, number] = [0.25, 0.03, 0.03, 0.2];

/**
 * A ring whose quarters are each as full as asked, anticlockwise from the
 * upper right: Geist's figure bowls are rounder on the side their stroke
 * leaves by than on the other. Every quarter meets the next level or upright,
 * whatever its fullness, so the ring has no corner.
 */
function lopsidedRing(
  f: Frame,
  centre: Vec2,
  wide: number,
  half: number,
  fullness: [number, number, number, number],
): Spine {
  const segments = fullness.flatMap(
    (curve, quarter) =>
      superQuarter(centre, wide, half, 1 - f.square, f.half, curve, quarter) ??
      bend(f, centre, half, quarter * 90, quarter * 90 + 90, wide).segments,
  );
  return { segments, closed: true };
}

/**
 * A bowl lighter at its crown than at its foot, as Geist's figures' are:
 * two bowls on a pen `share` of the stem's across, sharing the crown drawn
 * on the stem's pen round `centre` and `radius`. One's inside is the bowl's
 * inside and the other's outside its outside, so the foot keeps the stem's
 * pen. Never the whole share: two bowls the same would be drawn as one, and
 * the figure would have fewer points at its Thin than at its Black.
 */
function sidedPair(
  f: Frame,
  centre: Vec2,
  radius: number,
  share: number,
): { g: Frame; bowls: Array<[Vec2, number]> } {
  const crown = 2 * f.upright * Math.min(0.95, share);
  const g = sidedFrame(f, 2 * f.half, crown);
  const spineTop = centre.y + radius + f.upright - crown / 2;
  const footIn = centre.y - radius + f.upright - crown / 2;
  const footOut = centre.y - radius - f.upright + crown / 2;
  return {
    g,
    bowls: [footIn, footOut].map((foot) => [
      at(centre.x, (spineTop + foot) / 2),
      held(g, (spineTop - foot) / 2),
    ]),
  };
}

/** How much of the stem's pen a figure's bowl has across its crown, as Geist's. */
const figureCrown = (f: Frame): number => roundGain(f, 0.95, 0.79, 0.95);

/** The nine: the six turned over, as Geist's is. */
export function grotesqueNine(style: Style): Recipe {
  return nineOf(style, false);
}

/** The Sans's nine: the sided six turned over. */
export function grotesqueNineSided(style: Style): Recipe {
  return nineOf(style, true);
}

function nineOf(style: Style, sans: boolean): Recipe {
  const f = frame(lighterAcross(style));
  const [, now] = squaredNow(f);
  const fit = sans ? nineFit(f) : sixFit(f);
  const X = across(f, 60, 0.025, fit);
  const about = at(X(313), (f.crest(f.cap) + f.dip(0)) / 2);
  return finish(
    f,
    /*
     * Geist's nine is not quite its six turned: its tail is cut lower at the
     * Thin and the Regular (124 and 140, where the six turned cuts it at
     * 158) and higher at the Black (180).
     */
    sixStrokes(f, sans, sans ? now(570, 530, 586) : 552, fit).map((stroke) =>
      turnedStroke(stroke, about),
    ),
    true,
  );
}

/** The zero: a tall superelliptic ring, its sides a little heavier than its crown. */
export function grotesqueZero(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const X = across(f, 54, 0.015);
  const middle = (f.crest(f.cap) + f.dip(0)) / 2;
  return finish(
    f,
    [
      ink(
        f,
        ring(
          f,
          at(X(336), middle),
          held(f, 236 * large(f, 0.5) * figureFit(f, 0.02, 0.012, 0.015, -0.035)),
          held(f, f.crest(f.cap) - middle),
        ),
      ),
    ],
    true,
  );
}

/**
 * The eight: two rings touching at the waist, the upper the smaller and
 * narrower, as Geist's are -- the same waist as the three's.
 */
export function grotesqueEight(style: Style): Recipe {
  const f = frame(lighterAcross(style));
  const fit = figureFit(f, 0.018, 0.0022, 0.0128, -0.012);
  const X = across(f, 40, 0.025, fit);
  const u = large(f, 1) * (1 + 0.025 * thinness(f)) * fit;
  const waist = up(f, 378);
  const upperH = held(f, (f.crest(f.cap) - waist) / 2);
  const lowerH = held(f, (waist - f.dip(0)) / 2);
  return finish(
    f,
    [
      ...swollenRing(f, at(X(302), waist + upperH), held(f, 184 * u), upperH),
      ...swollenRing(f, at(X(302), waist - lowerH), held(f, 218 * u), lowerH),
    ],
    true,
  );
}

/**
 * A ring heavier on its outside than its inside, as a heavy grotesque's
 * small bowls are: drawn with a pen lighter across, and again a little wider
 * round the same centre with the same pen, so its sides keep the stem's
 * weight and its crowns their own while the inside of every turn is round.
 * With the stem's own pen across, the eight's upper counter past the Black
 * was a slot with square ends; the lighter pen leaves it an oval. Two rings
 * at every weight, the second no wider below a Bold, so the eight has the
 * same points at every weight.
 */
function swollenRing(f: Frame, centre: Vec2, halfW: number, halfH: number): Stroke[] {
  const t = heaviness(f) / 0.67;
  const share = SPLIT_SIDES * Math.min(1, Math.max(0, (t - 0.3) / 0.7));
  const { pen } = f.style;
  const along = pen.weight * (1 - Math.min(Math.max(pen.contrast, 0), 0.95));
  const lighter = pen.weight * (1 - share);
  const light = { ...pen, weight: lighter, contrast: Math.max(0, 1 - along / lighter) };
  // And carried out further again as the pen grows, to the weight Geist's
  // sides have: 200 at its Black, heavier than its stem, where the pen alone
  // left the eight 49 units narrow with counters 30 too wide a side.
  const out = (pen.weight - lighter) / 2 + EIGHT_SWELL * Math.min(1, Math.max(0, t));
  return [ink(f, ring(f, centre, halfW, halfH)), ink(f, ring(f, centre, halfW + out, halfH))].map(
    (one) => inherit(one, { ...one, pen: light }),
  );
}

/** How much further out a heavy eight's rings swell, by the Black. */
const EIGHT_SWELL = 12;

/** A point part of the way along a straight run, found by its height. */
function alongTo(from: Vec2, to: Vec2, y: number): Vec2 {
  const t = (y - from.y) / (to.y - from.y);
  return at(from.x + (to.x - from.x) * t, y);
}

/**
 * The K and the k: an arm from inside the stem out to a cut level on the
 * upper line, and the leg leaving the arm -- not the stem -- a third of the
 * way along it and running down to a cut level on the baseline, as Geist's
 * do. Both ends of each diagonal are cut level, the arm's foot and the leg's
 * head buried in the ink they leave.
 */
function kay(
  f: Frame,
  u: number,
  top: number,
  spine: number,
  arm: [number, number, number],
  leg: [number, number, number],
): Stroke[] {
  const X = (x: number) => f.edge + (x - spine) * u;
  const H = (y: number) => (y / arm[2]) * top;
  const from = at(f.edge, H(arm[0]));
  const to = at(X(arm[1]), top);
  const junction = alongTo(from, to, H(leg[0]));
  return [
    ink(f, straight(from, to), BUTT, f.end),
    ink(f, straight(junction, at(X(leg[1]), 0)), BUTT, f.end),
  ];
}

export function grotesqueCapitalK(style: Style): Recipe {
  const f = frame(style);
  return finish(f, [
    ink(f, straight(at(f.edge, 0), at(f.edge, f.cap)), f.end, f.end),
    ...kay(f, large(f, 1) * refit(f, 0.015, 0.03), f.cap, 136, [234, 550, 710], [397, 572, 710]),
  ]);
}

export function grotesqueK(style: Style): Recipe {
  const f = frame(style);
  return finish(f, [
    ink(f, straight(at(f.edge, 0), at(f.edge, f.asc)), f.end, f.end),
    // A little wider towards the Thin, as Geist Thin's k is, and at the
    // heavy weights, where it stood 13 narrow at UltraBlack and 17 at the
    // Black.
    ...kay(
      f,
      small(f, 1) * thinned(f, -0.035) * refit(f, -0.005, 0.034, -0.002),
      f.x,
      123,
      [133, 476, 530],
      [305, 491, 530],
    ),
  ]);
}

/**
 * The M: upright stems, and two diagonals from the heads of the stems down
 * to the baseline, each cut level at both ends, meeting in a flat-bottomed
 * vertex on the line -- Geist's M, whose vertex goes all the way down.
 */
export function grotesqueM(style: Style): Recipe {
  const f = frame(style);
  const [wide, t] = spread(f, 0.5);
  const u = wide * refit(f, 0.017, 0.006, 0);
  const X = (x: number) => f.edge + x * u;
  const right = X(606 + 11 * t);
  const middle = (f.edge + right) / 2;
  /*
   * Geist Black starts its diagonals further in and crosses them a little
   * above the line, so a stem's width of white stays under each side. In
   * pens rather than units, so a hairline's diagonals still meet its stems
   * and each other.
   */
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const top = f.half * lerp(0.63, 0.74);
  /*
   * Past the Black the diagonals stop crossing at their foot and grow
   * lighter than the stems, as an Ultra's must to keep white between them
   * and the stems: crossed on, the one diagonal's foot stood out past the
   * other's edge as a step at the vertex, and the counters were slits.
   */
  const past = Math.min(1, Math.max(0, t - 1) / 1.24);
  const foot = f.half * (-0.28 + 0.28 * Math.min(t, 1) - 0.2 * past);
  const lighter = (stroke: Stroke): Stroke =>
    inherit(stroke, {
      ...stroke,
      pen: { ...stroke.pen, weight: stroke.pen.weight * (1 - 0.3 * past) },
    });
  return finish(f, [
    ink(f, straight(at(f.edge, 0), at(f.edge, f.cap)), f.end, f.end),
    ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
    lighter(ink(f, straight(at(f.edge + top, f.cap), at(middle + foot, 0)), LEVEL, LEVEL)),
    lighter(ink(f, straight(at(right - top, f.cap), at(middle - foot, 0)), LEVEL, LEVEL)),
  ]);
}

/**
 * The unit of a capital that keeps its width at a Black, as Geist's M and W
 * do, and how far along the way from Geist Regular to Geist Black this weight
 * is (one at Black, past it beyond).
 */
function spread(f: Frame, share = 0): [number, number] {
  const h = heaviness(f);
  return [large(f, share) * (1 + 0.1 * h), h / 0.67];
}

/**
 * The exclamation mark: a stem cut level at the cap line that runs straight
 * for its upper half and then narrows to two thirds of itself at its foot, as
 * Geist's does, over a square dot.
 *
 * The narrowing is two lighter strokes side by side: together as wide as the
 * stem while they run parallel, then leaning in to meet over the dot, so the
 * stem is one outline at every weight with the same points.
 */
export function grotesqueExclam(style: Style): Recipe {
  const f = frame(style);
  const side = stopRadius(f);
  const foot = Math.max(up(f, 225), side * 2 + f.half * 0.8);
  const knee = Math.max(up(f, 470), foot + f.half);
  return finish(f, [
    ...tapered(f, f.edge, f.cap, knee, foot, 0.69),
    dot(f, at(f.edge, side), side),
  ]);
}

/**
 * A stroke cut level at its head that runs straight and then narrows to its
 * foot -- the stem of the exclamation mark, a quote -- drawn as two lighter
 * strokes side by side: together as wide as the stem while they run
 * parallel, then leaning in to meet, so it is one outline at every weight
 * with the same points.
 */
function tapered(
  f: Frame,
  x: number,
  top: number,
  knee: number,
  foot: number,
  narrow: number,
  heavy = 1,
): Stroke[] {
  const pen = { ...f.style.pen, weight: f.style.pen.weight * narrow * heavy };
  const shift = f.half * heavy * (1 - narrow);
  const half = (dir: number): Stroke => {
    const drawn = ink(
      f,
      chain(
        straight(at(x + dir * shift, top), at(x + dir * shift, knee)),
        straight(at(x + dir * shift, knee), at(x, foot)),
      ),
      f.end,
      f.end,
    );
    return inherit(drawn, { ...drawn, pen });
  };
  return [half(-1), half(1)];
}

/** The quotes: short tapered strokes, as Geist's are, a stem's width at the head. */
function quoteMarks(f: Frame, count: number): Stroke[] {
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  /*
   * Lighter than the stem as the weight grows, as Geist's are: 1.27 of it
   * at the Thin, 1.01 at the Regular, 0.84 at the SemiBold and 0.72 at the
   * Black (140 on a stem of 194) -- and apart by their own width and a gap
   * that closes a little as they grow. Lightened in a straight line, they
   * stood 17 units light at the Black and 9 heavy at the SemiBold.
   */
  const heavy =
    roundGain(f, 1.01, 0.84, 1.27) - 0.13 * Math.max(0, Math.min(heavyT(f), nowBlack()) - 0.41);
  const apart = lerp(82.5, 68) * u + f.style.pen.weight * heavy;
  const strokes: Stroke[] = [];
  for (let one = 0; one < count; one++) {
    strokes.push(
      ...tapered(
        f,
        f.edge + one * apart,
        f.cap,
        up(f, 640),
        // And shorter at the Thin, as Geist Thin's (467).
        up(f, lerp(447, 430) + 20 * thinness(f)),
        lerp(0.73, 0.83),
        heavy,
      ),
    );
  }
  return strokes;
}

export function grotesqueQuoteSingle(style: Style): Recipe {
  const f = frame(style);
  return finish(f, quoteMarks(f, 1));
}

export function grotesqueQuoteDouble(style: Style): Recipe {
  const f = frame(style);
  return finish(f, quoteMarks(f, 2));
}

/**
 * The W: four straight strokes, each cut level at both ends -- the outer two
 * from the cap line down to the vertices, the inner two from a middle apex
 * that reaches the cap line, as Geist's does, and each pair meeting on the
 * baseline in a flat-bottomed vertex.
 */
export function grotesqueW(style: Style): Recipe {
  const f = frame(style);
  const [wide, t] = spread(f, 1);
  const u = wide * refit(f, 0.022, -0.03, 0);
  const X = (x: number) => f.edge + x * u;
  const apex = 386.5 + 6.5 * t;
  const outer = 179 + 4.4 * t;
  // The two feet of each vertex apart by a share of the pen, so they meet at
  // every weight: Geist's are 26 apart on a stem of 86, 33 on one of 172.
  const inner = outer + (f.half * (0.6 - 0.22 * Math.min(t, 1.5))) / u;
  const stroke = (top: number, foot: number) =>
    ink(f, straight(at(X(top), f.cap), at(X(foot), 0)), LEVEL, LEVEL);
  return finish(f, [
    stroke(0, outer),
    stroke(apex, inner),
    stroke(apex, apex * 2 - inner),
    stroke(apex * 2, apex * 2 - outer),
  ]);
}

/** How much of the way in the quarters the spine leaves stop short past the Black: see `ess`. */
const INNER_REACH = 0.4;

/** How much narrower an Ultra's bowls are drawn, in half-pens: see `ess`. */
const ESS_NARROW = 0.3;

/** How much of the stem an s gains past the Black it keeps: see `stackedPen`. */
const SMALL_ESS_GAIN = 0.3;

/** The same for the S, which has a cap height of room to turn in. */
const CAPITAL_ESS_GAIN = 0.5;

/**
 * The pen an s or an S is drawn with: the face's own up to a little past the
 * Black, and past that only a share of what the stem gains.
 *
 * An S stacks three horizontals and two counters in its height and turns
 * round each counter twice; every one of those turns has to be at least as
 * round as the pen is wide, or its inside folds over (see `ess`). At an
 * Ultra's pen that is more room than the letter has, and what came out was
 * a flat bar of a spine between two slots with hooked ends. So past the
 * Black the s and the S go on getting heavier, but more slowly than the
 * stems, as a Black's S is drawn a little lighter than its O in any case.
 */
export function stackedPen(style: Style, gain: number): Style {
  const from = weightAtBlackness(style, ESS_HELD_FROM);
  const { weight } = style.pen;
  if (!(weight > from)) return style;
  return { ...style, pen: { ...style.pen, weight: from + (weight - from) * gain } };
}

/** The blackness past which the s and the S gain weight more slowly: see `stackedPen`. */
const ESS_HELD_FROM = 0.87;

/** How far over the pen a heavy s turns round its counters, in half-pens: see `ess`. */
const SOFT_COUNTER = 0.5;

/** Geist's s or S, as the numbers it is laid out from. */
interface Ess {
  /** The height it is drawn to: the x-height or the cap height. */
  height: number;
  /** The same height in Geist's own units. */
  geist: number;
  unit: number;
  /** The left of the upper bowl's spine, in Geist's units. */
  left: number;
  upper: { x: number; y: [number, number]; w: number };
  lower: { x: number; y: [number, number]; w: number };
  /** The heights the head and the foot are cut level at, Regular and Black. */
  head: [number, number];
  foot: [number, number];
  /** How tall the quarters the spine leaves are, against the drop between the bowls. */
  inner: number;
  /**
   * The same at Geist Black, where it is given (the s): Geist's Black s lays
   * its spine nearly flat between two bowls stacked one on the other, each
   * turning on a quarter as tall as its own half, where the Regular's falls
   * steeply between shallow ones. Without it the quarters grow shallower
   * with the weight (the S).
   */
  innerBlack?: number;
  /** How much wider each bowl is at Geist Black, in Geist's units (the s). */
  blackWiden?: number;
  /**
   * And more past the Black, where a heavier face (the Display) drawn from
   * these letters needs the room for its counters; nothing up to the Black.
   */
  blackPast?: number;
  /** Whether the pen is tilted at a heavy weight to weight the spine (the S). */
  tilted?: boolean;
}

/**
 * An s as Geist draws one: two superelliptic bowls, the lower the wider, and
 * a straight spine falling between them tangent to both, the head and the
 * foot cut level on the right and the left.
 *
 * Where each bowl meets the spine is found on the bowls as drawn, so the run
 * is smooth at every weight; and each is the same seven pieces at every
 * weight. Past Geist Black the bowls widen with the pen, or two stacked
 * counters close from the sides.
 */
function ess(given: Frame, e: Ess): Stroke[] {
  /*
   * On a face whose bowls are circles, drawn as ellipses: an S's bowls are
   * wider than they are tall, and a circle's quarter in a box like that is a
   * quarter circle stood on a straight run -- a stadium, with a flat bar
   * across the top and bottom of the letter and its turns all at its ends.
   */
  const f: Frame = given.curve > 0 ? given : { ...given, curve: OVAL_CURVE, square: 0 };
  const t = heaviness(f) / 0.67;
  const lerp = (pair: [number, number]) => pair[0] + (pair[1] - pair[0]) * Math.min(t, 1.5);
  const H = (y: number) => (y / e.geist) * e.height;
  const lightShare = 0.02 + (SPLIT_SIDES - 0.02) * Math.min(1, Math.max(0, (t - 0.3) / 0.7));
  const lift =
    (f.style.pen.weight *
      (1 - Math.min(Math.max(f.style.pen.contrast, 0), 0.95)) *
      lightShare *
      crownsGive(t)) /
    2;
  const beyond =
    // Past the current Geist's Black, a stem of 194 (see `squaredNow`).
    Math.max(0, heaviness(f) - 0.67 * nowBlack()) * f.x * 0.2 * 0.3 +
    (e.blackWiden ?? 0) * e.unit * Math.min(1, t * 2) +
    (e.blackPast ?? 0) * e.unit * Math.min(1, Math.max(0, t - 1) * 2);
  const X = (x: number) => f.edge + (x - e.left) * e.unit;
  // How far past the Black: nought at it, one at an Ultra.
  const past = Math.min(1, Math.max(0, t - 1) / 0.6);
  /*
   * And past the Black the quarters the spine leaves are drawn narrower than
   * their bowls, reaching only part of the way in towards the middle, so the
   * spine leaves each of them sooner and falls further across the letter.
   * Left the whole width of the bowl, a pen already as round as a turn can
   * go laid them one on top of the other, and the spine between them came
   * out a flat bar: a thin level parallelogram across a Black S.
   */
  const reachIn = 1 - INNER_REACH * past;
  // And the bowls a little narrower, which steepens the spine the same way.
  // The capital only: the s is already as narrow as its counters allow.
  const narrower = e.height > f.x * 1.1 ? past * f.half * ESS_NARROW : 0;
  /*
   * The quarter the spine leaves, under the upper bowl (`way` 1) or over the
   * lower (-1): its outer end where the bowl's is, its inner end short of
   * the middle.
   */
  const innerOf = (frame: Frame, centre: Vec2, width: number, way: 1 | -1): Spine => {
    // Never narrower than the pen goes round (see `holds` in `shapes.ts`),
    // or the quarter is widened about its centre and no longer starts where
    // the bowl's side ends.
    const short = Math.min(width, Math.max(width * reachIn, frame.half * 1.06));
    const shift = (width - short) * way;
    return way === 1
      ? bend(frame, at(centre.x - shift, centre.y), inner, 180, 270, short)
      : bend(frame, at(centre.x - shift, centre.y), inner, 90, 0, short);
  };
  /*
   * Every turn held at least as round as the pen is wide across -- not the
   * lighter measure up and down, which is what a turn lying on its side
   * would seem to need. The sweep offsets an arc by the pen's two reaches
   * (`offsetSegment` in `sweep.ts`), and an arc tighter than the reach
   * across turns its inside out: past the Black every counter of the s and
   * the S ended in a hook or a notch, and the counters read as I-beams. A
   * heavy s is drawn with a lighter pen instead (`stackedPen`), so the turns fit.
   */
  const least = f.least;
  const crownLeast = f.least;
  const heldAcross = (radius: number): number => Math.max(radius, crownLeast);
  // The bowls are drawn to those measures too: see `holds` in `shapes.ts`.
  const g: Frame = { ...f, half: least / 1.06 };
  const gc: Frame = { ...f, half: crownLeast / 1.06 };
  /*
   * Under the upper bowl's widest point and over the lower's, each bowl turns
   * on a shallower quarter than it does at its end: that is where the spine
   * leaves it, and Geist's spine leaves each bowl on a long gentle turn and
   * falls straight across the letter between them, tangent to both --
   * shallower at a heavy weight, so the spine falls steeper and keeps its
   * weight.
   *
   * Where the quarters stand so far into each other's height that no line
   * is tangent to both, they are made shallower until one is; and past what
   * the pen will go round -- a pen near half the x-height -- the letter
   * widens a little and then grows past its lines, evenly above and below,
   * as a Black s of the plain sans does, rather than closing up or folding.
   */
  let grow = 0;
  let widen = 0;
  const spread = [0, 0];
  let inner = 0;
  let found: {
    top: number;
    bottom: number;
    upper: Vec2;
    lower: Vec2;
    upperH: number;
    lowerH: number;
    upperW: number;
    lowerW: number;
    run: Spine;
  } | null = null;
  /*
   * Always the same number of tries, each drawing its two quarters, whether
   * or not an earlier one found the spine: a bowl drawn here is asked where
   * its pieces begin (`begun` in `shapes.ts`), and a weight that tried fewer
   * times would read the next bowl's answer.
   */
  for (let pass = 0; pass < 48; pass++) {
    const top = f.crest(e.height) + grow + lift;
    const bottom = f.dip(0) - grow - lift;
    const upperY = H(lerp(e.upper.y)) + grow + spread[0];
    const lowerY = H(lerp(e.lower.y)) - grow - spread[1];
    if (pass === 0)
      inner =
        (upperY - lowerY) *
        (e.innerBlack === undefined
          ? e.inner * (1 - 0.25 * Math.min(1.5, heaviness(f)))
          : e.inner + (e.innerBlack - e.inner) * Math.min(1, t));
    const upperW = held(f, e.upper.w * e.unit + beyond + widen - narrower);
    const lowerW = held(f, e.lower.w * e.unit + beyond + widen - narrower);
    const upper = at(X(e.upper.x) + beyond - narrower, upperY);
    const lower = at(X(e.lower.x) + beyond - narrower, lowerY);
    const run = crossTangent(innerOf(g, upper, upperW, 1), innerOf(g, lower, lowerW, -1));
    if (found) continue;
    if (run) {
      const upperH = heldAcross(top - upperY);
      const lowerH = heldAcross(lowerY - bottom);
      found = { top, bottom, upper, lower, upperH, lowerH, upperW, lowerW, run };
      continue;
    }
    if (inner > least * 1.01) inner = Math.max(least, inner * 0.85);
    else if (
      top - upperY > crownLeast + f.half * 0.05 ||
      lowerY - bottom > crownLeast + f.half * 0.05
    ) {
      /*
       * Then the bowls stand further apart, their crowns turning tighter,
       * before the letter grows: an Ultra's s keeps to its lines.
       */
      if (top - upperY > crownLeast + f.half * 0.05) spread[0] += f.half * 0.05;
      if (lowerY - bottom > crownLeast + f.half * 0.05) spread[1] += f.half * 0.05;
    } else {
      widen += f.half * 0.05;
      grow += f.half * 0.05;
    }
  }
  const { upper, lower, upperH, lowerH, upperW, lowerW } = found!;
  /*
   * And a heavy s turns round its counters, not only round its pen. Held at
   * just what the pen goes round, the tightest arc of each turn left the
   * inside of the stroke a point, and from a Bold on both counters were
   * slots with square ends. Geist Black's counters are round-ended, so once
   * the letter is laid out each turn is drawn with its tightest arc held
   * further over the pen -- never so far that a turn is made any larger,
   * which would move the spine the search has just found.
   */
  const soft = f.half * SOFT_COUNTER * Math.min(1, Math.max(0, (t - 0.25) / 0.75));
  const softer = (frame: Frame, radius: number): Frame => ({
    ...frame,
    half: Math.max(frame.half, Math.min(frame.half * 1.06 + soft, radius) / 1.06),
  });
  const ga = softer(gc, Math.min(upperH, upperW));
  const gb = softer(gc, Math.min(lowerH, lowerW));
  const gi = softer(g, Math.min(inner, upperW, lowerW));
  // Drawn at every weight, soft or not: each bowl drawn is asked where its
  // pieces begin (see `begun` in `shapes.ts`), and a weight that drew two
  // fewer would read the next bowls' answers and come out in other pieces.
  const softRun = crossTangent(innerOf(gi, upper, upperW, 1), innerOf(gi, lower, lowerW, -1));
  const bent = curvedSpine((soft > 0 ? softRun : null) ?? found!.run, SPINE_BEND);
  const spineRun = bent.run;
  /*
   * The ends are cut level, and a level cut has to reach across the stroke:
   * carried too far round, the inside of the turn never comes back up to the
   * line and the end is cut square instead. So neither end is carried past a
   * third of the way from its bowl's widest point to its crown.
   */
  /*
   * And the inside of the turn has to come back up to the cut: a bowl held
   * near the pen's own measure leaves little room inside it, so a heavier s
   * is cut nearer its widest point (a Bold's foot was cut square, slanted).
   */
  const reach = 0.6;
  const head = angleAt(
    gc,
    upper,
    upperW,
    upperH,
    Math.max(
      H(lerp(e.head)) + grow,
      upper.y - upperH * 0.35,
      upper.y - Math.max(0, upperH - f.upright) * reach,
    ),
    false,
  );
  const foot =
    angleAt(
      gc,
      lower,
      lowerW,
      lowerH,
      Math.min(
        H(lerp(e.foot)) - grow,
        lower.y + lowerH * 0.35,
        lower.y + Math.max(0, lowerH - f.upright) * reach,
      ),
      true,
    ) - 360;
  /*
   * And at a heavy weight the pen held a little off upright, as `blackPen`
   * does for the plain s: the broad of it across the spine, so the spine is
   * the heaviest thing in the letter as it is in every Black.
   */
  const drawn = ink(
    f,
    chain(
      bend(ga, upper, upperH, head, 180, upperW),
      /*
       * Past even that -- a pen near half the x-height -- the spine leaves
       * each quarter at a fixed point, in the same pieces.
       */
      spineRun,
      bend(gb, lower, lowerH, 0, foot, lowerW),
    ),
    f.end,
    f.end,
  );
  // Let go again past the Black, where the pen is already light across and a
  // tilted one leaves its heel standing into the counters, one side only.
  const tilt =
    e.tilted !== false && Math.abs(drawn.pen.angle) < 15
      ? 12 * Math.min(1, heaviness(f)) * (1 - past)
      : 0;
  const tilted = tilt > 0 ? { ...drawn.pen, angle: drawn.pen.angle + tilt } : drawn.pen;
  /*
   * And from a Bold on, heavier on the outside of its turns than on the
   * inside, as Geist's is: drawn with a pen lighter across, and each side
   * carried out again by a run that leaves the letter's outline at a crown,
   * swells past the bowl to the weight Geist's sides have, and comes back
   * onto it where the spine leaves. The inside of every turn is then the
   * lighter pen's, round enough to leave the counters round-ended, where a
   * pen this wide across makes slots with square ends of any turn the
   * x-height has room for, and a notch where each meets the spine.
   */
  const share = 0.02 + (SPLIT_SIDES - 0.02) * Math.min(1, Math.max(0, (t - 0.3) / 0.7));
  const along = tilted.weight * (1 - Math.min(Math.max(tilted.contrast, 0), 0.95));
  const lighter = tilted.weight * (1 - share * (1 - crownsGive(t)));
  const alongNow = along * (1 - share * crownsGive(t));
  const pen = { ...tilted, weight: lighter, contrast: Math.max(0, 1 - alongNow / lighter) };
  const out = (tilted.weight - lighter) * SIDE_OUT + 0.01;
  /*
   * The swells drawn with half that pen, their spines carried out by the
   * difference, so each swell's outside is where it was and its inside lies
   * buried in the letter's own ink: at the full pen the inside of a swell
   * turning onto the spine stood into the counter as a corner.
   */
  // Only as far as the swells swell: below a Bold they lie on the bowl itself.
  const swellPen = { ...pen, weight: pen.weight * (1 - 0.5 * (share / SPLIT_SIDES)) };
  const inset = (pen.weight - swellPen.weight) / 2;
  /*
   * And by what the two pens reach square off the spine, which lies nearer
   * level than upright: with contrast, less than across a side.
   */
  const normal = at(-bent.heading.y, bent.heading.x);
  const reachOf = (one: Stroke["pen"]) => {
    const offset = reachAlong(normal, penReach(one));
    return Math.hypot(offset.x, offset.y);
  };
  const across = reachOf(pen) - reachOf(swellPen);
  const degreesOf = (centre: Vec2, point: Vec2) =>
    (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI;
  /*
   * A circle upright at the bowl's side, carried out, that runs round to
   * touch the spine's first turn (`way` 1, on the left) or its last (-1, on
   * the right) from inside, so the swell comes back onto the spine on its
   * own curve; and the run then follows the spine a little way, under its
   * ink. Where no such circle touches the spine where it should -- a spine
   * lying all but level, where the bowls are stacked -- no swell on that
   * side: the run stops at the bowl's side, buried in it, in the same pieces.
   */
  const spineLength = Math.hypot(bent.to.x - bent.from.x, bent.to.y - bent.from.y);
  const swell = (edge: number, y: number, way: 1 | -1, reach: number) => {
    // The spine's turn carried out by as much as the swell's pen is lighter,
    // so the swell's outside comes onto the spine's outside.
    const turning = way === 1 ? bent.first : bent.last;
    const spine = { ...turning, radius: turning.radius + across };
    const side = at(edge - way * (out + inset), y);
    const dx = side.x - spine.centre.x;
    const dy = side.y - spine.centre.y;
    const radius = (spine.radius ** 2 - dx * dx - dy * dy) / (2 * (way * dx + spine.radius));
    if (radius > f.half * 0.5 && radius < reach * 3) {
      const centre = at(side.x + way * radius, side.y);
      const apart = at(centre.x - spine.centre.x, centre.y - spine.centre.y);
      const distance = Math.hypot(apart.x, apart.y) || 1;
      const touch = [1, -1]
        .map((sign) =>
          at(
            spine.centre.x + (sign * spine.radius * apart.x) / distance,
            spine.centre.y + (sign * spine.radius * apart.y) / distance,
          ),
        )
        .sort(
          (one, other) =>
            Math.abs(Math.hypot(one.x - centre.x, one.y - centre.y) - radius) -
            Math.abs(Math.hypot(other.x - centre.x, other.y - centre.y) - radius),
        )[0];
      const onSpine = Math.atan2(touch.y - spine.centre.y, touch.x - spine.centre.x);
      /*
       * On the spine's turn, or on that circle carried a little way beyond
       * it, where the spine is still leaving or already reaching the bowl:
       * the swell may close onto the spine's line outside its curve.
       */
      const onward = spine.endAngle >= spine.startAngle ? 1 : -1;
      const span = Math.abs(spine.endAngle - spine.startAngle);
      let rel = (onSpine - spine.startAngle) * onward;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel <= -Math.PI) rel += Math.PI * 2;
      // Measured along the spine, not round it: a spine lying nearly level
      // turns on circles so wide that an angle says nothing.
      const reachOn = Math.max(span * 3, (spineLength * 0.75 + reach) / spine.radius);
      const [least, most] = way === 1 ? [-reachOn, span] : [0, span + reachOn];
      const along = rel >= least && rel <= most ? rel * onward : null;
      const round =
        way === 1 ? ((degreesOf(centre, touch) + 360) % 360) - 180 : degreesOf(centre, touch);
      if (along !== null && round > 10 && round < 120) {
        const step = Math.min((f.half * 0.6) / spine.radius, 0.3);
        const at0 = spine.startAngle + along;
        const deg = (angle: number) => (angle * 180) / Math.PI;
        const lead =
          way === 1
            ? turn(spine.centre, spine.radius, deg(at0), deg(at0 + onward * step))
            : turn(spine.centre, spine.radius, deg(at0 - onward * step), deg(at0));
        return { centre, radius, touch, out, lead };
      }
    }
    const centre = at(edge - way * inset + way * f.half, y);
    const touch = pointOn(centre, f.half, way === 1 ? 181 : 1);
    const lead = way === 1 ? turn(centre, f.half, 181, 182) : turn(centre, f.half, 2, 1);
    return { centre, radius: f.half, touch, out: 0, lead };
  };
  const left = swell(upper.x - upperW, upper.y, 1, upperW);
  const right = swell(lower.x + lowerW, lower.y, -1, lowerW);
  const headY = pointOnBowl(ga, upper, upperW, upperH, head).y;
  const footY = pointOnBowl(gb, lower, lowerW, lowerH, foot).y;
  /*
   * Each side in two runs meeting upright at the bowl's side: round the
   * bowl with the lighter pen, and the swell onto the spine with half of
   * it, their outsides one line where they meet.
   */
  const round = [
    ink(
      f,
      bend(
        ga,
        upper,
        upperH,
        angleAt(ga, upper, upperW + left.out, upperH, headY, false),
        180,
        upperW + left.out,
      ),
      f.end,
      BUTT,
    ),
    ink(
      f,
      bend(
        gb,
        lower,
        lowerH,
        0,
        angleAt(gb, lower, lowerW + right.out, lowerH, footY, true) - 360,
        lowerW + right.out,
      ),
      BUTT,
      f.end,
    ),
  ];
  const swells = [
    ink(
      f,
      chain(
        turn(left.centre, left.radius, 180, (degreesOf(left.centre, left.touch) + 360) % 360),
        // On a little way down the spine, under the spine's own ink, so the
        // run's end is buried there rather than standing out as a step.
        left.lead,
      ),
    ),
    ink(
      f,
      chain(right.lead, turn(right.centre, right.radius, degreesOf(right.centre, right.touch), 0)),
    ),
  ];
  return [
    inherit(drawn, { ...drawn, pen }),
    ...round.map((one) => inherit(one, { ...one, pen })),
    ...swells.map((one) => inherit(one, { ...one, pen: swellPen })),
  ];
}

/** How much lighter across a heavy s is drawn inside its turns: see `ess`. */
const SPLIT_SIDES = 0.26;
/** How far out its sides are carried again, against what the pen gave up. */
const SIDE_OUT = 0.5;
/**
 * How that lightness is shared between the sides and the crowns and spine.
 * Geist's heavy s is heavier in its sides than across its crowns and spine,
 * so its counters are narrow and tall; lightened in the sides alone, they
 * came out wide, low slots with the weight in the spine.
 */
const CROWNS_GIVE = 0.6;
/**
 * Given back to the sides past the Black, all of it by pen 215 or so: there the
 * crowns and spine have no height to spare, and a counter left tall in the
 * middle ends square.
 */
const crownsGive = (t: number): number =>
  CROWNS_GIVE * (1 - Math.min(1, Math.max(0, t - 1) / 0.25));

/** A point on a bowl as drawn, at an angle. */
function pointOnBowl(f: Frame, centre: Vec2, halfW: number, halfH: number, degrees: number): Vec2 {
  return bowlPoint(centre, halfW, halfH, 1 - f.square, f.half, degrees, f.curve);
}

/**
 * The caret, as Geist draws it: two strokes leaning in to a head cut level
 * on the cap line and feet cut level at 383, narrow and upright, lighter than
 * the stem at a Black. The plain one was a wide chevron set low, a sign.
 */
export function grotesqueCaret(style: Style): Recipe {
  // Geist's measures, from the left of the ink: the feet 82 across on the
  // Regular (34 on the Thin, 127 on the Black), the head 106 (48, 165) from
  // 120 in, and the whole 346 (288, 405) wide.
  return chevron(style, {
    foot: [82, 127, 34],
    wide: [346, 405, 288],
    headLeft: [120, 120, 120],
    headRight: [226, 285, 168],
    bottom: [383, 383, 383],
    top: [673, 673, 673],
  });
}

/**
 * The circumflex accent, as Geist's: the caret's shape, lower and wider --
 * the feet 70 across on the Regular (28 on the Thin, 128 on the Black), the
 * whole 274 (198, 378), the head from 90 to 184 (88 to 110, 100 to 278),
 * from 598 (610, 587) up to 731 (734, 753). The plain one came to a point.
 */
export function grotesqueCircumflexAccent(style: Style): Recipe {
  return chevron(style, {
    foot: [70, 128, 28],
    wide: [274, 378, 198],
    headLeft: [90, 100, 88],
    headRight: [184, 278, 110],
    bottom: [598, 587, 610],
    top: [731, 753, 734],
  });
}

/** Two strokes leaning in to a level head, cut level at their feet too. */
function chevron(
  style: Style,
  m: {
    foot: Measure;
    wide: Measure;
    headLeft: Measure;
    headRight: Measure;
    bottom: Measure;
    top: Measure;
  },
): Recipe {
  const f = frame(style);
  const [X, lerp] = squaredNow(f);
  const k = X(1) - X(0);
  const top = up(f, lerp(...m.top));
  const bottom = up(f, lerp(...m.bottom));
  const foot = lerp(...m.foot) * k;
  const wide = lerp(...m.wide) * k;
  const headLeft = lerp(...m.headLeft) * k;
  const headRight = lerp(...m.headRight) * k;
  const x0 = X(0);
  const leftFoot = at(x0 + foot / 2, bottom);
  const leftHead = at(x0 + headLeft + foot / 2, top);
  const rightFoot = at(x0 + wide - foot / 2, bottom);
  const rightHead = at(x0 + headRight - foot / 2, top);
  // Each stroke as heavy across as its feet are wide, square to its lean.
  const lean = Math.atan2(leftHead.x - leftFoot.x, top - bottom);
  const pen = { ...f.style.pen, weight: Math.max(foot * Math.cos(lean), 1), contrast: 0 };
  return finish(
    f,
    [straight(leftFoot, leftHead), straight(rightFoot, rightHead)].map((spine) => {
      const one = ink(f, spine, LEVEL, LEVEL);
      return inherit(one, { ...one, pen });
    }),
  );
}

/**
 * The dieresis, as Geist's: two dots cut square, 88 across and 98 high on
 * the Regular (34 by 70 on the Thin, 180 by 136 on the Black), 86 (94, 62)
 * apart, their feet at 613 (628, 594). The plain ones were smaller and
 * closer.
 */
export function grotesqueDieresis(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squaredNow(f);
  const k = X(1) - X(0);
  const across = lerp(88, 180, 34);
  const high = lerp(98, 136, 70);
  const apart = lerp(86, 62, 94);
  const foot = up(f, lerp(613, 594, 628));
  const dot = (left: number): Stroke =>
    measured(
      f,
      straight(at(X(left + across / 2), foot), at(X(left + across / 2), foot + high * k)),
      across * k,
    );
  return finish(f, [dot(0), dot(across + apart)]);
}

/**
 * The Sans's square brackets, measured off Geist: from 750 down to -110 at
 * every weight, and wide -- 240 across on the Regular (172 on the Thin, 346
 * on the Black) -- so the arms stay long past the Black. The plain bracket's
 * arms reach a fixed share of an arch, and from a Black on the stem swallowed
 * them and the bracket set as a solid bar.
 */
function grotesqueBracket(style: Style, way: 1 | -1): Recipe {
  const f = frame(style);
  const [X, lerp] = squaredNow(f);
  const wide = lerp(240, 346, 172);
  const x = (u: number) => (way === 1 ? X(u) : X(wide) + X(0) - X(u));
  const stem = x(0) + way * f.half;
  const top = f.hangs(up(f, 750));
  const bottom = f.sits(up(f, -110));
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(x(wide), top), at(stem, top)),
        straight(at(stem, top), at(stem, bottom)),
        straight(at(stem, bottom), at(x(wide), bottom)),
      ),
      BUTT,
      BUTT,
    ),
  ]);
}

export const grotesqueBracketLeft = (style: Style): Recipe => grotesqueBracket(style, 1);
export const grotesqueBracketRight = (style: Style): Recipe => grotesqueBracket(style, -1);

/**
 * The Sans's braces, as Geist draws them: each half an arm cut upright that
 * turns into the stem, and the stem turning out again into a short nose cut
 * upright at the middle, so the point is a level stub between two round
 * turns rather than the plain brace's sharp beak. Geist's measures, from the
 * nose: the stem's middle 143 in on the Regular (126 on the Thin, 175 on the
 * Black), the arms' ends 329 (288, 370), from 750 (750, 764) down to -115
 * (-113, -132).
 */
function grotesqueBrace(style: Style, way: 1 | -1): Recipe {
  const f = frame(style);
  const [X, lerp] = squaredNow(f);
  const wide = lerp(329, 370, 288);
  const middle = lerp(143, 175, 126);
  const x = (u: number) => (way === 1 ? X(u) : X(wide) + X(0) - X(u));
  const angle = (degrees: number) => (way === 1 ? degrees : 180 - degrees);
  const k = X(1) - X(0);
  const top = f.hangs(up(f, lerp(750, 764, 750)));
  const bottom = f.sits(up(f, lerp(-115, -132, -113)));
  const centre = (top + bottom) / 2;
  const stem = x(middle);
  // The turn into each arm, as round as Geist's, and short of the arm's end.
  const outer = Math.max(Math.min(lerp(131, 118, 150) * k, (wide - middle) * k - 1), 1);
  // The turn out into the nose, as wide as the nose is long, and leaving a
  // piece of the stem standing between it and the turn into the arm.
  const nose = Math.max(Math.min(middle * k, (top - centre - outer) * 0.7), 1);
  const half = (end: number, up: 1 | -1): Stroke => {
    const arm = at(stem + way * outer, end);
    const knee = end - up * outer;
    const heel = centre + up * nose;
    return ink(
      f,
      chain(
        straight(at(x(wide), end), arm),
        turn(at(stem + way * outer, knee), outer, angle(90 * up), angle(180 * up)),
        straight(at(stem, knee), at(stem, heel)),
        turn(at(stem - way * nose, heel), nose, angle(0), angle(-90 * up)),
        straight(at(stem - way * nose, centre), at(x(0), centre)),
      ),
      BUTT,
      BUTT,
    );
  };
  return finish(f, [half(top, 1), half(bottom, -1)]);
}

export const grotesqueBraceLeft = (style: Style): Recipe => grotesqueBrace(style, 1);
export const grotesqueBraceRight = (style: Style): Recipe => grotesqueBrace(style, -1);

/** The backslash: the Sans's slash turned the other way, as Geist's is. */
export function grotesqueBackslash(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const run = 295.8 * u + slashGain(f);
  return finish(f, [
    ink(f, straight(at(f.edge, up(f, 750)), at(f.edge + run, up(f, -110))), LEVEL, LEVEL),
  ]);
}

/** The bar, as Geist's: from 110 under the line to 750, as its brackets run. */
export function grotesqueBar(style: Style): Recipe {
  const f = frame(style);
  return finish(f, [ink(f, straight(at(f.edge, up(f, -110)), at(f.edge, up(f, 750))), BUTT, BUTT)]);
}

/** A pen as heavy across in every direction, for the marks drawn to a measured weight. */
const even = (f: Frame, weight: number) => ({
  ...f.style.pen,
  weight: Math.max(weight, 1),
  contrast: 0,
  angle: 0,
});

/** A stroke drawn with its own pen rather than the letter's. */
const measured = (f: Frame, spine: Spine, weight: number, start = BUTT, end = BUTT): Stroke => {
  const one = ink(f, spine, start, end);
  return inherit(one, { ...one, pen: even(f, weight) });
};

/**
 * The plus, as Geist's: as tall as it is wide -- 478 on the Thin and the
 * Regular, 498 on the Black -- centred at 295 (285, 281), each bar 78 (28,
 * 150) thick. The plain one was a third smaller and hung low. Past the
 * Black it grows as fast as its bars grow heavier, or the arms were stubs.
 */
export function grotesquePlus(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squaredNow(f);
  const k = X(1) - X(0);
  const bar = lerp(78, 150, 28);
  const wide = lerp(478, 498, 478) + Math.max(0, bar - 150);
  const y = up(f, lerp(295, 281, 285));
  const reach = (wide / 2) * k;
  return finish(f, [
    measured(f, straight(at(X(0), y), at(X(wide), y)), bar * k),
    measured(f, straight(at(X(wide / 2), y - reach), at(X(wide / 2), y + reach)), bar * k),
  ]);
}

/**
 * The less-than and greater-than, as Geist's: two arms meeting in a short
 * upright flat at the point, each cut upright at its end. From the point,
 * the ends stand 454 across on the Regular (444 on the Thin, 464 on the
 * Black), 215 (222, 198) above and below its middle at 289 (292, 294), the
 * arms 84 (30, 160) deep where they are cut, and the flat 106 (34, 180)
 * tall. The plain ones were steeper and taller, and came to a sharp point.
 */
function angle(style: Style, way: 1 | -1): Recipe {
  const f = frame(style);
  const [X, lerp] = squaredNow(f);
  const k = X(1) - X(0);
  // Past the Black the arms reach further as they grow heavier, or the
  // inside closed to a slit.
  const grown = Math.max(0, lerp(84, 160, 30) - 160);
  const wide = lerp(454, 464, 444) + grown;
  const x = (u: number) => (way === 1 ? X(u) : X(wide) + X(0) - X(u));
  const middle = up(f, lerp(289, 294, 292));
  const spread = (lerp(215, 198, 222) + grown * 0.5) * k;
  const deep = lerp(84, 160, 30) * k;
  // Where the arms' spines reach the point: apart by as much as the flat is
  // taller than one arm is deep, or together where it is not.
  const apart = Math.max((lerp(106, 180, 34) * k - deep) / 2, 0.5);
  const slope = Math.atan2(spread - apart, wide * k);
  const cut: Terminal = { kind: "butt", aligned: true };
  return finish(
    f,
    ([1, -1] as const).map((side) =>
      measured(
        f,
        straight(at(x(wide), middle + side * spread), at(x(0), middle + side * apart)),
        deep * Math.cos(slope),
        cut,
        cut,
      ),
    ),
  );
}

export const grotesqueLess = (style: Style): Recipe => angle(style, 1);
export const grotesqueGreater = (style: Style): Recipe => angle(style, -1);

/**
 * The equals sign, as Geist's: two bars 460 long on the Regular (440 on the
 * Thin, 480 on the Black), centred at 402 and 196 (392 and 186, 412 and
 * 165), each 78 (30, 150) thick. The plain one was shorter and its bars
 * closer together.
 */
export function grotesqueEqual(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squaredNow(f);
  const k = X(1) - X(0);
  const wide = lerp(460, 480, 440);
  const bar = lerp(78, 150, 30) * k;
  return finish(
    f,
    [lerp(402, 412, 392), lerp(196, 165, 186)].map((y) =>
      measured(f, straight(at(X(0), up(f, y)), at(X(wide), up(f, y))), bar),
    ),
  );
}

/**
 * The underscore, as Geist's: a bar hanging from the line, 469 long on the
 * Regular (434 on the Thin, 500 on the Black) and 78 (30, 150) deep. The
 * plain one was less than half as long.
 */
export function grotesqueUnderscore(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squaredNow(f);
  const k = X(1) - X(0);
  const wide = lerp(469, 500, 434);
  const bar = lerp(78, 150, 30) * k;
  return finish(f, [measured(f, straight(at(X(0), -bar / 2), at(X(wide), -bar / 2)), bar)]);
}

/**
 * The tilde, as Geist's: a wave of two equal arcs, one over and one under,
 * cut level at both ends -- the left end low, at 246 on the Regular (268 on
 * the Thin, 245 on the Black), the right end high, at 420 (398, 421) -- its
 * crest reaching 430 (404, 424) and its trough 236 (263, 242), 443 (402,
 * 443) across and 79 (32, 126) thick. The plain one was wider and hung low.
 * Past the Black the wave grows taller and wider as fast as it grows
 * heavier, or its hollows filled in.
 */
export function grotesqueTilde(style: Style): Recipe {
  return wave(style, {
    thick: [79, 126, 32],
    wide: [443, 443, 402],
    low: [246, 245, 268],
    high: [420, 421, 398],
    crest: [430, 424, 404],
  });
}

/**
 * The tilde accent, as Geist's: the same wave, smaller -- 315 across on the
 * Regular (264 on the Thin, 361 on the Black) and 54 (26, 90) thick, from
 * 603 (625, 589) at its left end to 730 (723, 754) at its right, its crest
 * at 720 (714, 748). The plain one was a heavier, rounder swash.
 */
export function grotesqueTildeAccent(style: Style): Recipe {
  return wave(style, {
    thick: [54, 90, 26],
    wide: [315, 361, 264],
    low: [603, 589, 625],
    high: [730, 754, 723],
    crest: [720, 748, 714],
  });
}

/** Geist's measures at its Regular, Black and Thin. */
type Measure = [number, number, number];

/**
 * A wave of two equal arcs, one over and one under, cut level at both ends,
 * from a low left end to a high right one, on Geist's measures. Past the
 * Black it grows taller and wider rather than heavier, or its hollows
 * pinched to spurs.
 */
function wave(
  style: Style,
  m: { thick: Measure; wide: Measure; low: Measure; high: Measure; crest: Measure },
): Recipe {
  const f = frame(style);
  const [X, lerp] = squaredNow(f);
  const k = X(1) - X(0);
  // Past the Black the stroke grows at part of the pen's pace and the wave
  // spreads with the rest, or the hollows closed to spurs.
  const pace = 0.4;
  const drawn = lerp(...m.thick);
  const thick = drawn > m.thick[1] ? m.thick[1] + (drawn - m.thick[1]) * pace : drawn;
  const grown = Math.max(0, drawn - m.thick[1]) * 0.8;
  const wide = lerp(...m.wide) + grown * 2;
  const half = thick / 2;
  // The ends held near their Black heights, so the stroke still arrives
  // at each upright, and a level cut across it leaves no wedge.
  const low = lerp(...m.low) - grown * 0.3;
  const high = lerp(...m.high) + grown * 0.3;
  const crest = lerp(...m.crest) + grown - half;
  const middle = { x: wide / 2, y: (low + high) / 2 };
  // From the middle, where the two arcs meet, to the left end, and how far
  // the crest's spine stands over the middle.
  const reach = { x: middle.x - half, y: middle.y - low };
  const rise = Math.max(crest - middle.y, 1);
  // The radius at which the crest's circle passes through the left end.
  const miss = (radius: number) => {
    const across = Math.sqrt(Math.max(2 * rise * radius - rise * rise, 0));
    return (across - reach.x) ** 2 + (reach.y + rise - radius) ** 2 - radius * radius;
  };
  let [least, most] = [rise / 2 + 0.01, Math.max(reach.x, reach.y) * 4];
  for (let step = 0; step < 60; step++) {
    const radius = (least + most) / 2;
    if (miss(radius) > 0) least = radius;
    else most = radius;
  }
  const radius = (least + most) / 2;
  const across = Math.sqrt(Math.max(2 * rise * radius - rise * rise, 0));
  const lift = rise - radius;
  const point = (u: number, v: number) => at(X(u), up(f, v));
  const over = point(middle.x - across, middle.y + lift);
  const under = point(middle.x + across, middle.y - lift);
  const r = radius * k;
  const degrees = (from: Vec2, to: Vec2) =>
    (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  const left = point(half, low);
  const right = point(wide - half, high);
  const meet = degrees(over, under);
  const start = degrees(over, left);
  const end = degrees(under, right);
  const wave = chain(
    turn(over, r, start < meet ? start + 360 : start, meet),
    turn(under, r, meet + 180, end < meet + 180 ? end + 360 : end),
  );
  return finish(f, [
    measured(
      f,
      // In three pieces an arc at every weight: the sweep passes half a turn
      // at some weights and not at others, and a family's weights have to be
      // drawn in the same points.
      { ...wave, segments: wave.segments.map((one) => ({ ...one, pieces: 3 })) },
      thick * k,
      LEVEL,
      LEVEL,
    ),
  ]);
}

/**
 * The grave and the acute, as Geist's: steep strokes cut level at both ends,
 * from 726 down to 598 on the Regular (726 to 610 on the Thin, 747 to 587
 * on the Black), falling 78 across (76, 72) and about 82 (30, 162) across
 * where they are cut. The plain ones lay nearer level and sat lower.
 */
function accent(style: Style, way: 1 | -1): Recipe {
  const f = frame(style);
  const [X, lerp] = squaredNow(f);
  const k = X(1) - X(0);
  const cut = lerp(82, 162, 30);
  const fall = lerp(78, 72, 76);
  const top = up(f, lerp(726, 747, 726));
  const foot = up(f, lerp(598, 587, 610));
  const wide = cut + fall;
  const x = (u: number) => (way === 1 ? X(u) : X(wide) + X(0) - X(u));
  const slope = Math.atan2(fall * k, top - foot);
  return finish(f, [
    measured(
      f,
      straight(at(x(cut / 2), top), at(x(cut / 2 + fall), foot)),
      cut * k * Math.cos(slope),
      LEVEL,
      LEVEL,
    ),
  ]);
}

export const grotesqueGrave = (style: Style): Recipe => accent(style, 1);
export const grotesqueAcute = (style: Style): Recipe => accent(style, -1);

/**
 * How far the s's spine turns from straight, in radians: see `curvedSpine`.
 * Geist's leaves each bowl this much steeper than a straight tangent would
 * and lies this much flatter through its middle.
 */
const SPINE_BEND = 0.2;

/**
 * A spine found as a straight tangent between two bowls, drawn instead as
 * Geist draws it: leaving each bowl a little sooner, steeper, and turning
 * through its middle in two arcs -- the way the bowl it leaves was turning,
 * then back the other way into the next -- that meet halfway, so it is one
 * smooth reverse curve, flatter in the middle than at its ends. Drawn
 * straight, the spine met each bowl at a visible change of curve and read
 * as a bar laid between two hooks.
 *
 * The same pieces as the straight run: the line becomes two arcs, and the
 * turns it leaves and arrives on are shortened, never lengthened.
 */
function curvedSpine(run: Spine, bend: number): Bent {
  const segments = [...run.segments];
  const line = segments.findIndex((one) => one.kind === "line");
  const straight = segments[line];
  const unbent = (): Bent => {
    const a = straight?.kind === "line" ? straight.from : at(0, 0);
    const b = straight?.kind === "line" ? straight.to : at(0, -1);
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const heading = at((b.x - a.x) / length, (b.y - a.y) / length);
    // A straight spine, as turns so wide they are straight to within a hair.
    const far = 1e5;
    const flat = (point: Vec2, reach: number): SpineArc => {
      const centre = at(point.x - heading.y * far, point.y + heading.x * far);
      const angle = Math.atan2(point.y - centre.y, point.x - centre.x);
      return {
        kind: "arc",
        centre,
        radius: far,
        startAngle: angle - reach / far,
        endAngle: angle + reach / far,
        sweepPositive: true,
      };
    };
    const middle = at((a.x + b.x) / 2, (a.y + b.y) / 2);
    /*
     * Still two turns through the middle, as the curve has, each so wide it
     * is straight to within a hair: the same points, and curves where the
     * curve has curves, so a master drawn straight lines up with one drawn
     * bent.
     */
    const span = (start: Vec2, end: Vec2): SpineArc => {
      // A turn twenty times the spine's length: straight to within a unit.
      const wide = Math.max(length, 1) * 20;
      const centre = at(
        (start.x + end.x) / 2 - heading.y * wide,
        (start.y + end.y) / 2 + heading.x * wide,
      );
      const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
      let sweep = Math.atan2(end.y - centre.y, end.x - centre.x) - startAngle;
      while (sweep > Math.PI) sweep -= Math.PI * 2;
      while (sweep <= -Math.PI) sweep += Math.PI * 2;
      return {
        kind: "arc",
        centre,
        radius: Math.hypot(start.x - centre.x, start.y - centre.y),
        startAngle,
        endAngle: startAngle + sweep,
        sweepPositive: sweep > 0,
        pieces: 1,
      };
    };
    const halved: Spine =
      straight?.kind === "line"
        ? {
            closed: false,
            segments: segments.flatMap((one, index): Spine["segments"] =>
              index === line ? [span(a, middle), span(middle, b)] : [one],
            ),
          }
        : run;
    return {
      run: halved,
      from: a,
      to: b,
      heading,
      first: flat(middle, length),
      last: flat(middle, length),
    };
  };
  if (line < 1 || line >= segments.length - 1) return unbent();
  // The last turn before the line that goes anywhere, and the first after.
  let before = line - 1;
  while (before > 0 && !turnsAtAll(segments[before])) before--;
  let after = line + 1;
  while (after < segments.length - 1 && !turnsAtAll(segments[after])) after++;
  const leaving = segments[before];
  const arriving = segments[after];
  if (leaving.kind !== "arc" || arriving.kind !== "arc") return unbent();
  /*
   * Back along the turns it leaves and arrives on by the same angle, as far
   * as they have to give: through as many of their pieces as it takes, the
   * pieces it passes left standing on the point it now leaves from.
   */
  const sweep = (one: Spine["segments"][number]) =>
    one.kind === "arc" ? Math.abs(one.endAngle - one.startAngle) : 0;
  const give = (from: number, step: -1 | 1) => {
    let total = 0;
    for (let index = from; index >= 0 && index < segments.length; index += step) {
      if (segments[index].kind !== "arc") break;
      total += sweep(segments[index]);
    }
    return total;
  };
  /*
   * And less the more nearly level the spine lies: a heavy s stacks its
   * bowls and lays its spine almost flat between them, as Geist Black's is,
   * and bent as much as a Regular's it came out a wave.
   */
  const chord = straight.kind === "line" ? straight : null;
  const fall = chord
    ? Math.atan2(chord.from.y - chord.to.y, Math.abs(chord.to.x - chord.from.x) || 1e-9)
    : 0;
  const by = Math.min(
    // Never quite straight, so a spine lying level is drawn in the same way.
    Math.max(bend * Math.min(1, Math.max(0, fall / 0.6)), 0.01),
    give(before, -1) * 0.6,
    give(after, 1) * 0.6,
  );
  const changed = new Map<number, Spine["segments"][number]>();
  const standOn = (one: SpineArc, point: Vec2): SpineArc => ({
    ...one,
    centre: at(
      point.x - one.radius * Math.cos(one.startAngle),
      point.y - one.radius * Math.sin(one.startAngle),
    ),
    endAngle: one.startAngle,
  });
  // Walks `by` along the run from `start` in `step`, cutting the piece it stops in.
  const walk = (start: number, step: -1 | 1): { point: Vec2; angle: number } => {
    let left = by;
    let index = start;
    for (;;) {
      const one = segments[index] as SpineArc;
      const span = sweep(one);
      const next = index + step;
      if (left <= span || next < 0 || next >= segments.length || segments[next].kind !== "arc") {
        const sign = one.endAngle >= one.startAngle ? 1 : -1;
        const cut = Math.min(left, span);
        const angle = step < 0 ? one.endAngle - sign * cut : one.startAngle + sign * cut;
        changed.set(index, step < 0 ? { ...one, endAngle: angle } : { ...one, startAngle: angle });
        const point = pointOn(one.centre, one.radius, (angle * 180) / Math.PI);
        // Everything it walked past, stood on that point.
        for (let passed = index - step; passed !== start - step; passed -= step) {
          const was = segments[passed];
          if (was.kind === "arc") changed.set(passed, standOn(was, point));
        }
        return { point, angle };
      }
      left -= span;
      index = next;
    }
  };
  const leftAt = walk(before, -1);
  const rightAt = walk(after, 1);
  // And the stood pieces between the turn and the line, on the new ends.
  for (let index = before + 1; index < line; index++) {
    const was = segments[index];
    if (was.kind === "arc") changed.set(index, standOn(was, leftAt.point));
  }
  for (let index = line + 1; index < after; index++) {
    const was = segments[index];
    if (was.kind === "arc") changed.set(index, standOn(was, rightAt.point));
  }
  const leaveAt = leftAt.angle;
  const from = leftAt.point;
  const to = rightAt.point;
  // The heading where it leaves, on the piece it now leaves from.
  const leavingNow = [...changed.entries()]
    .filter(([index]) => index <= before)
    .map(([, one]) => one)
    .find((one) => one.kind === "arc" && Math.abs(one.endAngle - one.startAngle) > 1e-9) as
    | SpineArc
    | undefined;
  void leaving;
  void arriving;
  // Its heading where it leaves, which is where it arrives too.
  const on = leavingNow ?? leaving;
  const way = on.endAngle >= on.startAngle ? 1 : -1;
  const heading = at(-Math.sin(leaveAt) * way, Math.cos(leaveAt) * way);
  const middle = at((from.x + to.x) / 2, (from.y + to.y) / 2);
  const arc = (start: Vec2, end: Vec2, tangent: Vec2): SpineArc | null => {
    const chord = at(end.x - start.x, end.y - start.y);
    const length = Math.hypot(chord.x, chord.y);
    const cross = tangent.x * chord.y - tangent.y * chord.x;
    if (length < 1e-6 || Math.abs(cross) < 1e-6 * length) return null;
    // The centre on the side the chord turns to, square off the tangent.
    const side = Math.sign(cross);
    const radius = (length * length) / (2 * Math.abs(cross));
    const centre = at(start.x - tangent.y * side * radius, start.y + tangent.x * side * radius);
    const a0 = Math.atan2(start.y - centre.y, start.x - centre.x);
    let a1 = Math.atan2(end.y - centre.y, end.x - centre.x);
    if (side > 0) while (a1 < a0) a1 += Math.PI * 2;
    else while (a1 > a0) a1 -= Math.PI * 2;
    return {
      kind: "arc",
      centre,
      radius,
      startAngle: a0,
      endAngle: a1,
      sweepPositive: side > 0,
      pieces: 1,
    };
  };
  const first = arc(from, middle, heading);
  if (!first) return unbent();
  const turned = first.endAngle - first.startAngle;
  const midHeading = at(
    heading.x * Math.cos(turned) - heading.y * Math.sin(turned),
    heading.x * Math.sin(turned) + heading.y * Math.cos(turned),
  );
  const second = arc(middle, to, midHeading);
  if (!second) return unbent();
  return {
    from,
    to,
    heading,
    first,
    last: second,
    run: {
      closed: false,
      segments: segments.flatMap((one, index): Spine["segments"] => {
        if (index === line) return [first, second];
        return [changed.get(index) ?? one];
      }),
    },
  };
}

/** A spine drawn by `curvedSpine`: where it leaves and arrives, and its heading at both. */
interface Bent {
  run: Spine;
  from: Vec2;
  to: Vec2;
  heading: Vec2;
  /** The spine's first turn and its last, which a swell touches. */
  first: SpineArc;
  last: SpineArc;
}

/** Whether a piece of a run goes anywhere. */
function turnsAtAll(one: Spine["segments"][number]): boolean {
  return one.kind === "arc"
    ? Math.abs(one.endAngle - one.startAngle) > 1e-9
    : Math.hypot(one.to.x - one.from.x, one.to.y - one.from.y) > 1e-9;
}

/**
 * The line tangent to two runs of arcs, leaving the first -- travelled
 * anticlockwise -- and arriving on the second, travelled clockwise, so the
 * whole is one smooth reverse curve: the first run up to where the line
 * leaves it, the line, and the second run on from where the line meets it.
 *
 * Found exactly, circle to circle, among the arcs the two runs are made of.
 * The pieces the line cuts off are kept, stood on the point where it
 * leaves or arrives, so the run is drawn in the same pieces at every weight.
 */
function crossTangent(first: Spine, second: Spine, way = 1, latest = false): Spine | null {
  const arcs = (spine: Spine) =>
    spine.segments.flatMap((one, index) =>
      one.kind === "arc" && one.radius > 1e-6 && Math.abs(one.endAngle - one.startAngle) > 1e-9
        ? [{ one, index }]
        : [],
    );
  const within = alongArc;
  // `latest`: leave the first run as late along it as a tangent can.
  const firsts = latest ? arcs(first).reverse() : arcs(first);
  for (const a of firsts) {
    for (const b of arcs(second)) {
      const dx = a.one.centre.x - b.one.centre.x;
      const dy = a.one.centre.y - b.one.centre.y;
      const length = Math.hypot(dx, dy);
      const sum = a.one.radius + b.one.radius;
      if (length <= sum) continue;
      const base = Math.atan2(dy, dx);
      const spread = Math.acos(sum / length);
      for (const turnBy of [spread, -spread]) {
        // The left of the line: towards the first circle, away from the second.
        const n = at(Math.cos(base + turnBy) * way, Math.sin(base + turnBy) * way);
        const d = at(n.y, -n.x);
        // Falling across the letter: to the right when the first run turns
        // anticlockwise, as an s's does, and to the left when it turns the
        // other way, as the ampersand's loop does.
        if (!(d.x * way > 0 && d.y < 0)) continue;
        const leave = Math.atan2(-n.y * way, -n.x * way);
        const arrive = Math.atan2(n.y * way, n.x * way);
        const alongA = within(a.one, leave);
        const alongB = within(b.one, arrive);
        if (alongA === null || alongB === null) continue;
        const endA = a.one.startAngle + alongA;
        const startB = b.one.startAngle + alongB;
        const from = pointOn(a.one.centre, a.one.radius, (endA * 180) / Math.PI);
        const to = pointOn(b.one.centre, b.one.radius, (startB * 180) / Math.PI);
        const stood = (one: SpineArc, angle: number): SpineArc => ({
          ...one,
          startAngle: angle,
          endAngle: angle,
        });
        const head = first.segments.map((one, index) =>
          index < a.index
            ? one
            : index === a.index
              ? { ...a.one, endAngle: endA }
              : stood(a.one, endA),
        );
        const tail = second.segments.map((one, index) =>
          index > b.index
            ? one
            : index === b.index
              ? { ...b.one, startAngle: startB }
              : stood(b.one, startB),
        );
        return { segments: [...head, ...straight(from, to).segments, ...tail], closed: false };
      }
    }
  }
  return null;
}

/**
 * Two runs of arcs joined by a straight from a point on the first to a point
 * on the second, at the angles given, in the same pieces `crossTangent` uses:
 * for where the two stand too close for a tangent, so the letter keeps its
 * points at every weight and only its smoothness gives way.
 */
function crossAt(first: Spine, second: Spine, leave: number, arrive: number): Spine {
  const cut = (spine: Spine, degrees: number, keepBefore: boolean): [Spine, Vec2] => {
    const angle = (degrees * Math.PI) / 180;
    let index = spine.segments.findIndex(
      (one) =>
        one.kind === "arc" &&
        Math.abs(one.endAngle - one.startAngle) > 1e-9 &&
        alongArc(one, angle) !== null,
    );
    if (index < 0) index = spine.segments.findIndex((one) => one.kind === "arc");
    const one = spine.segments[index] as SpineArc;
    const along = alongArc(one, angle) ?? 0;
    const at0 = one.startAngle + along;
    const point = pointOn(one.centre, one.radius, (at0 * 180) / Math.PI);
    const segments = spine.segments.map((other, where) =>
      keepBefore
        ? where < index
          ? other
          : where === index
            ? { ...one, endAngle: at0 }
            : { ...one, startAngle: at0, endAngle: at0 }
        : where > index
          ? other
          : where === index
            ? { ...one, startAngle: at0 }
            : { ...one, startAngle: at0, endAngle: at0 },
    );
    return [{ closed: false, segments }, point];
  };
  const [head, from] = cut(first, leave, true);
  const [tail, to] = cut(second, arrive, false);
  return {
    closed: false,
    segments: [...head.segments, ...straight(from, to).segments, ...tail.segments],
  };
}

/**
 * The style an s is drawn with past Geist Black: its horizontals held near
 * the Black's own while its stems go on growing.
 *
 * An s stacks three horizontals and two counters in the x-height, where an o
 * has two and one. At an Ultra's pen, half the x-height, three of the o's
 * crowns left two slits between them, the spine could no longer fall
 * between its bowls, and the letter grew past both its lines. An Ultra's s
 * is drawn lighter across: its terminals and its spine stay about as heavy
 * as the Black's, and the weight goes into its sides. So do the other
 * letters that stack their horizontals: the a (arch over bowl), the g (bowl
 * over hook) and the f (hook over bar), whose counters were slits.
 */
function lighterAcross(style: Style): Style {
  const f = frame(style);
  /*
   * From the current Black on: Geist's Black is heavier across than its
   * UltraBlack (its 3's foot 168 against 148), and lightened from 172 the
   * figures' horizontals stood 15 to 25 units light at the Black. It is as
   * light as ever by the same weight.
   */
  const t = heaviness(f) / 0.67 - nowBlack();
  if (t <= 0) return style;
  const k = Math.min(1, t / (2.2 - nowBlack()));
  const { pen } = f.style;
  const contrast = pen.contrast + (0.56 - pen.contrast) * k * k * (3 - 2 * k);
  return {
    ...f.style,
    pen: { ...pen, contrast, own: pen.own ?? pen.contrast },
    metrics: { ...f.style.metrics, lighterAcross: true },
  };
}

/**
 * The style the s is drawn with: lighter across than the other letters from
 * a Bold on, as well as past the Black. Geist Black's s has crowns and a
 * spine about two thirds of its stem (115 on 172), where the stems' pen left
 * them at three quarters; stacked three deep in the x-height, that extra
 * weight came out of the counters, which closed to slots with square ends.
 */
export function essAcross(style: Style): Style {
  const lighter = lighterAcross(style);
  const f = frame(lighter);
  const t = heaviness(f) / 0.67;
  const ramp = Math.min(1, Math.max(0, (t - 0.3) / 0.7));
  if (ramp <= 0) return lighter;
  const { pen } = f.style;
  const own = pen.own ?? pen.contrast;
  // And on past the Black towards what an Ultra's s is drawn with, sooner
  // than the other letters, since it stacks the most in its x-height.
  const on = Math.min(1, Math.max(0, (t - 1) / 0.6));
  const wanted =
    own +
    (ESS_CONTRAST - own) * ramp * ramp * (3 - 2 * ramp) +
    (0.56 - ESS_CONTRAST) * on * (2 - on);
  if (wanted <= pen.contrast) return lighter;
  return { ...f.style, pen: { ...pen, contrast: wanted, own } };
}

/** How light across the s is drawn at Geist Black: see `essAcross`. */
const ESS_CONTRAST = 0.34;

/** The s: see `ess`. Measured off Geist Regular and Black. */
export function grotesqueS(style: Style): Recipe {
  /*
   * At Geist's widths at its Thin and its Black, where it stood 10 narrow
   * and 14 wide: a Thin's s a fortieth wider and its upper bowl's left side
   * 5 units further in, and the width a heavy s gains held back from the
   * UltraBlack on.
   */
  const f = frame(essAcross(stackedPen(style, SMALL_ESS_GAIN)));
  return {
    ...finish(
      f,
      [
        ...ess(f, {
          height: f.x,
          geist: 530,
          unit: small(f) * (1 + 0.025 * thinness(f)),
          left: 104,
          upper: { x: 263 + 5 * thinness(f), y: [385, 378], w: 159 - 5 * thinness(f) },
          lower: { x: 266, y: [125, 155], w: 174 },
          head: [385, 358],
          foot: [175, 172],
          inner: 0.42,
          innerBlack: 0.5,
          blackWiden:
            11 -
            7 * Math.min(1, Math.max(0, (heavyT(f) - T_ULTRABLACK) / (nowBlack() - T_ULTRABLACK))),
          tilted: false,
        }),
      ],
      true,
    ),
  };
}

/** The S: see `ess`. */
export function grotesqueCapitalS(style: Style): Recipe {
  const f = frame(stackedPen(style, CAPITAL_ESS_GAIN));
  // At Geist's widths: it stood 16 narrow at the Thin and 10 at the Regular.
  return finish(f, capitalEss(f, atWeights(f, 0.034, 0.023, 0.007, -0.012, 0.002)), true);
}

/**
 * The S's strokes, for the S and for the dollar, `fit` wider (a share) than
 * their measures give.
 */
function capitalEss(f: Frame, fit: number): Stroke[] {
  return ess(f, {
    height: f.cap,
    geist: 710,
    unit: large(f, 1) * (1 + fit),
    left: 118,
    upper: { x: 322, y: [540, 510], w: 204 },
    lower: { x: 326, y: [180, 200], w: 220 },
    head: [505, 465],
    foot: [225, 250],
    blackWiden: 0,
    blackPast: 12,
    inner: 0.42,
  });
}

/**
 * The dollar, as Geist's: the S, and a bar straight through it from 90 under
 * the line to 800, a light one at every weight -- 74 across on the Regular,
 * 30 on the Thin, 86 on the Black. The plain dollar's bar stood out only a
 * little past the S, and was nearly as heavy as its stem.
 */
export function grotesqueDollar(style: Style): Recipe {
  const f = frame(stackedPen(style, CAPITAL_ESS_GAIN));
  const [X, lerp] = squaredNow(f);
  // Geist's dollar's S is 11 units narrower than its S at every weight: 17
  // wide at UltraBlack here, drawn as the S.
  const strokes = capitalEss(f, atWeights(f, 0.013, -0.002, -0.021, -0.042, -0.027));
  // Through the middle of the S as it is drawn: halfway across its spines.
  let lo = Infinity;
  let hi = -Infinity;
  for (const stroke of strokes) {
    for (const one of stroke.spine.segments) {
      const xs =
        one.kind === "line"
          ? [one.from.x, one.to.x]
          : [one.startAngle, (one.startAngle + one.endAngle) / 2, one.endAngle].map(
              (angle) => one.centre.x + one.radius * Math.cos(angle),
            );
      lo = Math.min(lo, ...xs);
      hi = Math.max(hi, ...xs);
    }
  }
  const centre = (lo + hi) / 2;
  // Held inside what the health check lets a letter reach past its lines:
  // at a Light that is a little short of Geist's 800.
  const { metrics, pen } = f.style;
  const top = Math.min(
    up(f, 800),
    metrics.ascender + Math.max(pen.weight, metrics.unitsPerEm * 0.06) - 3,
  );
  const bar = measured(
    f,
    straight(at(centre, up(f, -90)), at(centre, top)),
    lerp(74, 86, 30) * (X(1) - X(0)),
  );
  return finish(f, [...strokes, bar], true);
}

/**
 * The section mark as Geist draws it: an s whose lower bowl is a whole ring,
 * and the same s turned half round about the ring's centre, so the two share
 * the ring -- each running round the half of it the other leaves open -- and
 * their spines fall onto it from either side rather than crossing inside it.
 *
 * Built from two copies of one s offset by half, as it was, the lower bowl of
 * the upper and the upper bowl of the lower were two different ovals, and
 * their two spines crossed inside the middle: a knot of blobs from a Bold on,
 * and never a clean ring even at a Regular.
 */
export function grotesqueSection(style: Style): Recipe {
  /*
   * Never a pen heavier than a stacked mark can turn round (see `stackedPen`),
   * and never heavier than a quarter of each half's height: five strokes
   * stand one over another down the middle of it, where a letter has three,
   * and drawn lighter across as the s is (`essAcross`).
   */
  const room = style.metrics.capHeight * SECTION_HALF * 0.24;
  const eased = stackedPen(style, SMALL_ESS_GAIN);
  const held = eased.pen.weight > room ? { ...eased, pen: { ...eased.pen, weight: room } } : eased;
  const f = frame(essAcross(held));
  const g: Frame = f.curve > 0 ? f : { ...f, curve: OVAL_CURVE, square: 0 };
  const top = f.crest(f.cap) - f.upright;
  const bottom = f.cap * (1 - SECTION_HALF * 1.53) + f.desc * 0.06 + f.upright;
  const span = top - bottom;
  const middle = at(f.edge + f.half + span * 0.3, (top + bottom) / 2);
  /*
   * Each half as wide as the ring; the hooks a little taller than the ring,
   * and the quarter each spine leaves its hook on short and shallow, so the
   * spine falls steeply onto the ring rather than lying along it.
   */
  const w = Math.max(span * 0.3, f.least * 1.5);
  const ringH = Math.max(span * 0.13, f.least);
  const hookH = Math.max(span * 0.18, f.least);
  const hook = at(middle.x, top - hookH);
  const inner = Math.max(hookH * 0.4, f.least);
  const iw = Math.max(w * 0.8, f.least);
  const innerQ = bend(g, at(hook.x - w + iw, hook.y), inner, 180, 270, iw);
  const ringQ = bend(g, middle, ringH, 90, 0, w);
  const run = crossTangent(innerQ, ringQ);
  const head = angleAt(g, hook, w, hookH, hook.y - hookH * 0.1, false);
  const upper = ink(
    f,
    chain(
      bend(g, hook, hookH, head, 180, w),
      run ?? crossAt(innerQ, ringQ, 250, 70),
      // On round the ring's right and its foot, past its lowest point to
      // where the other half has already been.
      bend(g, middle, ringH, 0, -150, w),
    ),
    f.end,
    BUTT,
  );
  return finish(f, [upper, turnedStroke(upper, middle)], true);
}

/** How tall each half of a section mark is, against the cap height. */
const SECTION_HALF = 0.62;

/**
 * The z and the Z: two bars at the stem's weight, and a diagonal whose edges
 * run exactly from the foot of the upper bar's right end to the head of the
 * lower bar's left end, as Geist's do -- so each corner is the bar's own
 * square end carried on down the diagonal, with no point standing out past
 * the bar and no notch cut into it.
 */
function zed(f: Frame, u: number, t: number, top: number, bars: number[][]): Stroke[] {
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const X = (x: number) => f.edge - f.half + x * u;
  const [upperFrom, upperTo, lowerTo] = bars.map(([a, b]) => X(lerp(a, b)));
  const pen = penReach(f.style.pen);
  const upperLine = f.hangs(top);
  const lowerLine = f.sits(0);
  const high = at(upperTo, top - f.upright * 2);
  const low = at(X(0), f.upright * 2);
  let from = high;
  let to = low;
  for (let pass = 0; pass < 8; pass++) {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const d = at((to.x - from.x) / length, (to.y - from.y) / length);
    // The side of the run the upper corner is on: left of its way down.
    const side = reachAlong(at(-d.y, d.x), pen);
    from = at(high.x - side.x, high.y - side.y);
    to = at(low.x + side.x, low.y + side.y);
  }
  return [
    ink(f, straight(at(upperFrom, upperLine), at(upperTo, upperLine))),
    ink(f, straight(from, to)),
    ink(f, straight(at(X(0), lowerLine), at(lowerTo, lowerLine))),
  ];
}

/**
 * A unit for a letter laid out by its ink rather than its spine, as the zed
 * is: Geist's own units at every weight, so a Thin is as wide as Geist
 * Thin's, and a little narrower still on the lightest weights, as Geist's is.
 */
function inked(f: Frame, line: number, geist: number): number {
  const light = Math.min(1, Math.max(0, (87 - f.style.pen.weight) / 57));
  return ((line / geist) * f.style.metrics.width * (1 - 0.04 * light)) / unstretched(f);
}

export function grotesqueZ(style: Style): Recipe {
  const f = frame(style);
  const [, t] = spread(f);
  return finish(
    f,
    zed(f, inked(f, f.xOwn, 530), t, f.x, [
      [10, 13],
      [428, 492],
      [436, 499],
    ]),
  );
}

export function grotesqueCapitalZ(style: Style): Recipe {
  const f = frame(style);
  const [, t] = spread(f);
  return finish(
    f,
    zed(f, inked(f, f.cap, 710), t, f.cap, [
      [17, 17],
      [481, 543],
      [489, 557],
    ]),
  );
}

/**
 * Two straight strokes, each cut level at both ends, meeting at a vertex that
 * is flat where the two feet (or heads) stand a little apart, as all of
 * Geist's diagonals do: the v, the V, the A and the w.
 *
 * Measured on Geist Regular and Black, relative to where the ink starts:
 * where the two free ends are, where the vertex is, and how far apart the two
 * ends at the vertex stand, in pens, so a hairline's still meet.
 */
interface Vee {
  /** The two free ends, Regular then Black. */
  ends: [[number, number], [number, number]];
  /** The middle of the vertex, Regular then Black. */
  vertex: [number, number];
  /** The two ends at the vertex apart, in half-pens, Regular then Black. */
  gap: [number, number];
}

function vee(f: Frame, u: number, t: number, v: Vee, free: number, meet: number): Stroke[] {
  const lerp = (pair: [number, number]) => pair[0] + (pair[1] - pair[0]) * Math.min(t, 1.5);
  // From the ink to the spine by Geist's own half-pen, so a lighter weight
  // keeps Geist's skeleton rather than its ink.
  const X = (x: number) => f.edge + (x - lerp([43, 86])) * u;
  const middle = X(lerp(v.vertex));
  const apart = (f.half * lerp(v.gap)) / 2;
  return [
    ink(f, straight(at(X(lerp(v.ends[0])), free), at(middle - apart, meet)), LEVEL, LEVEL),
    ink(f, straight(at(X(lerp(v.ends[1])), free), at(middle + apart, meet)), LEVEL, LEVEL),
  ];
}

/** The unit a lowercase letter keeps at a Black, as Geist's v and w do. */
function smallSpread(f: Frame, share = 0): [number, number] {
  const h = heaviness(f);
  return [small(f, share) * (1 + 0.1 * h), h / 0.67];
}

export function grotesqueV(style: Style): Recipe {
  const f = frame(style);
  const [wide, t] = smallSpread(f, 0.5);
  const u = wide * thinned(f, 0.048);
  return finish(
    f,
    vee(
      f,
      u,
      t,
      {
        ends: [
          [45.6, 92.4],
          [448.4, 500.6],
        ],
        vertex: [247, 296.7],
        gap: [0.54, 0.51],
      },
      f.x,
      0,
    ),
  );
}

export function grotesqueCapitalV(style: Style): Recipe {
  const f = frame(style);
  const [wide, t] = spread(f, 1);
  const u = wide * refit(f, 0.02, -0.031);
  return finish(
    f,
    vee(
      f,
      u,
      t,
      {
        ends: [
          [48, 89.3],
          [579.4, 624.7],
        ],
        vertex: [314, 356.9],
        gap: [0.53, 0.37],
      },
      f.cap,
      0,
    ),
  );
}

/** The A: a vee turned over, flat at its head, and a bar low across it. */
export function grotesqueCapitalA(style: Style): Recipe {
  const f = frame(style);
  const [wide, t] = spread(f, 1);
  const u = wide * thinned(f, 0.04) * refit(f, 0.018, -0.03, 0);
  const legs = vee(
    f,
    u,
    t,
    {
      ends: [
        [48, 89.5],
        [581.7, 623.5],
      ],
      vertex: [315, 350],
      gap: [0.73, 0.58],
    },
    0,
    f.cap,
  );
  // Geist's height, moved with the crossbar control from where the face has it.
  uses("crossbar");
  const bar =
    up(f, 245 + (215 - 245) * Math.min(t, 1.5)) +
    (f.style.parts.crossbar.height - SANS_CROSSBAR) * f.cap;
  // Across the legs at that height, and buried in each.
  const across = (stroke: Stroke) => {
    const one = stroke.spine.segments[0];
    if (one.kind !== "line") return 0;
    return one.from.x + ((one.to.x - one.from.x) * (bar - one.from.y)) / (one.to.y - one.from.y);
  };
  return finish(f, [
    ...legs,
    thin(f, straight(at(across(legs[0]), bar), at(across(legs[1]), bar))),
  ]);
}

/** The w: two vees side by side, the middle apex reaching the x-height. */
export function grotesqueSmallW(style: Style): Recipe {
  const f = frame(style);
  const [wide, t] = smallSpread(f, 0.35);
  const u = wide * thinned(f, 0.034);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const X = (x: number) => f.edge + (x - lerp(43, 86)) * u;
  const outer = lerp(45.7, 87.5);
  const apex = lerp(388, 409);
  const vertex = lerp(217.25, 243.5);
  const apart = (f.half * lerp(0.66, 0.31)) / 2 / u;
  const stroke = (top: number, foot: number) =>
    ink(f, straight(at(X(top), f.x), at(X(foot), 0)), LEVEL, LEVEL);
  /*
   * Past the Black the two inner strokes are drawn lighter than the outer
   * ones, as an Ultra's w must be to keep its three counters: at the full
   * pen they closed to notches and the w read as a black trapezoid.
   */
  const past = Math.min(1, Math.max(0, t - 1) / 1.24);
  const inner = (drawn: Stroke): Stroke =>
    inherit(drawn, {
      ...drawn,
      pen: { ...drawn.pen, weight: drawn.pen.weight * (1 - 0.35 * past) },
    });
  // Their feet moved out by what they lose, so the vertex keeps its edge.
  const lost = (f.half * 0.35 * past) / u;
  return finish(f, [
    stroke(outer, vertex - apart),
    inner(stroke(apex, vertex + apart + lost)),
    inner(stroke(apex, apex * 2 - vertex - apart - lost)),
    stroke(apex * 2 - outer, apex * 2 - vertex + apart),
  ]);
}

/**
 * The Y: two straight arms from heads cut level on the cap line down into the
 * head of the stem, which they meet low -- under the middle of the letter, as
 * Geist's do -- and a stem from there to the baseline.
 */
export function grotesqueCapitalY(style: Style): Recipe {
  const f = frame(style);
  const [wide, t] = spread(f, 1);
  const u = wide * refit(f, 0.019, -0.027, 0.011);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const X = (x: number) => f.edge + (x - lerp(43, 86)) * u;
  const stem = X(lerp(295, 332.5));
  const junction = at(stem, up(f, lerp(297, 271)));
  return finish(f, [
    ink(f, straight(at(X(lerp(52.1, 94.9)), f.cap), junction), LEVEL, BUTT),
    ink(f, straight(at(X(lerp(537.4, 570.1)), f.cap), junction), LEVEL, BUTT),
    ink(f, straight(junction, at(stem, 0)), BUTT, f.end),
  ]);
}

/**
 * The N: upright stems and a diagonal from the head of the left to the foot
 * of the right, cut level on the cap line and on the baseline, as Geist's is
 * -- the diagonal's ends flush with the lines rather than hung inside the
 * stems.
 */
export function grotesqueN(style: Style): Recipe {
  const f = frame(style);
  const [wide, t] = spread(f, 0.5);
  const u = wide * refit(f, 0.022, 0.003, 0.007);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const right = f.edge + lerp(467, 443) * u;
  return finish(f, [
    ink(f, straight(at(f.edge, 0), at(f.edge, f.cap)), f.end, f.end),
    ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
    ink(
      f,
      straight(
        // Held at the Black's past it: carried on, the diagonal stood out past both stems.
        at(f.edge + f.half * (0.65 - 0.57 * Math.min(t, 1)), f.cap),
        at(right - f.half * (0.8 - 0.6 * Math.min(t, 1)), 0),
      ),
      LEVEL,
      LEVEL,
    ),
  ]);
}

/**
 * The C: the O's own ring, cut level on the right at Geist's two heights --
 * the upper a little higher than the middle of the letter is from its lower.
 */
export function grotesqueCapitalC(style: Style): Recipe {
  const f = frame(style);
  const [u, t] = spread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const middle = (f.crest(f.cap) + f.dip(0)) / 2;
  const halfH = held(f, f.crest(f.cap) - middle);
  const halfW = held(f, lerp(273, 253) * u + roundGain(f, 4, 10.5));
  const centre = at(f.edge + halfW, middle);
  const head = angleAt(f, centre, halfW, halfH, up(f, lerp(500, 455)), false);
  const foot = angleAt(f, centre, halfW, halfH, up(f, lerp(225, 265)), false);
  return finish(f, [ink(f, bend(f, centre, halfH, head, 360 + foot, halfW), f.end, f.end)], true);
}

/*
 * The marks Geist draws its own way: a long hyphen, tall parentheses cut
 * level, a long slash, a slanted number sign, a percent with narrow ovals and
 * an at sign built round a single-storey a.
 */

/** The hyphen: a third of an em long, at the stem's weight, level with the x-height's middle. */
export function grotesqueHyphen(style: Style): Recipe {
  const f = frame(style);
  // Geist's: 296 long at the Thin, 332 at the Regular, 348 at the Black.
  const [X, lerp] = squared(f);
  const y = (lerp(292, 292, 281) / 530) * f.xOwn;
  /*
   * As deep as Geist's: the stem's own depth at the Thin, 0.91 of it at the
   * Regular and 0.78 at the Black (152 on a stem of 194). On the stem's pen
   * it stopped growing past the UltraBlack and stood 20 units shallow at the
   * Black.
   */
  const deep =
    2 *
    f.half *
    (roundGain(f, 0.91, 0.83, 1) -
      (0.05 * Math.max(0, Math.min(heavyT(f), nowBlack()) - 0.41)) / 0.9);
  const g = sidedFrame(f, 2 * f.half, deep);
  const one = ink(g, straight(at(X(0), y), at(X(Math.min(lerp(332, 348, 296), 360)), y)));
  return finish(f, [inherit(one, { ...one, pen: g.style.pen })]);
}

/** A parenthesis: one long arc from above the ascender to below the baseline, cut level. */
function paren(f: Frame, facing: 1 | -1): Stroke {
  const u = large(f);
  const top = up(f, 750);
  const bottom = up(f, -110);
  const half = (top - bottom) / 2;
  // At Geist's widths (139, 214 and 305 at the Thin, Regular and Black),
  // where the Thin's stood 14 wide.
  const reach = Math.max(116.5 * u + atWeights(f, -14, 6, 4, 2, 0), f.half);
  const radius = (half * half + reach * reach) / (2 * reach);
  const sweep = (Math.asin(Math.min(1, half / radius)) * 180) / Math.PI;
  const middle = (top + bottom) / 2;
  if (facing === 1) {
    const centre = at(f.edge + radius, middle);
    return ink(f, turn(centre, radius, 180 - sweep, 180 + sweep), f.end, f.end);
  }
  const centre = at(f.edge + reach - radius, middle);
  return ink(f, turn(centre, radius, sweep, -sweep), f.end, f.end);
}

export function grotesqueParenLeft(style: Style): Recipe {
  const f = frame(style);
  return finish(f, [paren(f, 1)]);
}

export function grotesqueParenRight(style: Style): Recipe {
  const f = frame(style);
  return finish(f, [paren(f, -1)]);
}

/**
 * How much further the slash runs across than its measures give: Geist's
 * widens with the pen faster than a level cut on the Sans's pen does (327
 * at the Thin, 375 at the Regular, 491 at the Black), where ours stood 12
 * wide at the Thin and 25 narrow at the Black.
 */
function slashGain(f: Frame): number {
  return (
    roundGain(f, -7, 11, -12) + (14 * Math.max(0, Math.min(heavyT(f), nowBlack()) - 0.41)) / 0.9
  );
}

/** The slash: from below the baseline to above the ascender, cut level at both. */
export function grotesqueSlash(style: Style): Recipe {
  const f = frame(style);
  const u = large(f);
  const run = 295.8 * u + slashGain(f);
  return finish(f, [
    ink(f, straight(at(f.edge, up(f, -110)), at(f.edge + run, up(f, 750))), LEVEL, LEVEL),
  ]);
}

/** The number sign: two slanted uprights and two bars, a little lighter than the stem. */
export function grotesqueNumberSign(style: Style): Recipe {
  const f = frame(style);
  // Geist Thin's is as wide as its Regular's, where the o is wider.
  const u = large(f, 1) / (1 + (f.style.metrics.lightHeld?.grow ?? 0) * thinness(f));
  const X = (x: number) => f.edge - f.half + x * u;
  /*
   * Measured off Geist Thin, Regular and Black: the uprights lean less and
   * stand further apart as the pen grows, and each bar reaches the same
   * seventy to ninety units past the uprights' outsides at every weight.
   * Past the Black the uprights go on moving apart, or the bars' ends
   * vanished into the leaning uprights and the counter closed to a slot.
   */
  const [, lerp] = squared(f);
  const t = Math.min(heaviness(f) / 0.67, 2.24);
  const along = (a: number, b: number, thin: number) =>
    thinness(f) > 0 ? lerp(a, b, thin) : a + (b - a) * t;
  const held = (a: number, b: number, thin: number) =>
    thinness(f) > 0 ? lerp(a, b, thin) : a + (b - a) * Math.min(t, 1);
  const stem = f.half * 2;
  const pen = (weight: number) => ({ ...f.style.pen, weight, contrast: 0, angle: 0 });
  const slope = held(0.183, 0.144, 0.186);
  const uprightW = stem * held(0.84, 0.91, 1);
  const barW = stem * held(0.84, 0.79, 1);
  const lean = (x: number, y: number) => X(x) + slope * y;
  const left = along(72.5, 134.5, 72);
  const right = along(278.5, 387.5, 269);
  // Each bar's end at Geist's width: the sign stood 13 narrow at the Thin,
  // 14 wide at the Regular and 10 narrow at UltraBlack.
  const over = held(88, 70, 110) * u + uprightW / 2 + atWeights(f, 6.5, -7, 0.5, 5, -0.5);
  const upright = (x: number): Stroke => {
    const drawn = ink(f, straight(at(X(x), 0), at(X(x) + slope * f.cap, f.cap)), LEVEL, LEVEL);
    return inherit(drawn, { ...drawn, pen: pen(uprightW) });
  };
  /*
   * Each bar cut at its ends along the uprights' lean, as Geist's are: drawn
   * as a short run up that lean, as tall as the bar is thick and cut level,
   * with a pen as wide as the bar is long. Cut upright, a light bar's ends
   * stood out square past the leaning uprights.
   */
  const bar = (y: number): Stroke => {
    const from = lean(left, y) - over;
    const to = lean(right, y) + over;
    const middle = (from + to) / 2;
    const rise = barW / 2;
    const drawn = ink(
      f,
      straight(at(middle - slope * rise, y - rise), at(middle + slope * rise, y + rise)),
      LEVEL,
      LEVEL,
    );
    return inherit(drawn, { ...drawn, pen: pen((to - from) / Math.hypot(1, slope)) });
  };
  return finish(f, [
    upright(left),
    upright(right),
    bar(up(f, held(232, 220, 231))),
    bar(up(f, held(475, 482, 476))),
  ]);
}

/**
 * The asterisk: three bars crossing at its middle -- one level, two at sixty
 * degrees -- so six arms, as Geist's is, each cut square. The same size at
 * every weight (171 from the middle, a little more at the Black), hung high
 * in the cap height; only the bars grow heavier, and more slowly than the
 * stem. Drawn as the plain five-spoke star grown with the pen, a Black's
 * reached down to the x-height's middle and an Ultra's nearly to the line.
 */
/** How much longer the asterisk's diagonal arms are than its level ones. */
const ASTERISK_LONGER = 1.045;

export function grotesqueAsterisk(style: Style): Recipe {
  const f = frame(style);
  const [, lerp] = squared(f);
  const t = Math.min(heaviness(f) / 0.67, 1);
  const held3 = (a: number, b: number, thin: number) =>
    thinness(f) > 0 ? lerp(a, b, thin) : a + (b - a) * t;
  // Not widened at the Thin with the letters: Geist Thin's is as wide as its
  // Regular's, where it stood 13 units wider.
  const u = large(f, 1) * thinned(f, 0.038);
  // Past the Black the arms grow a little longer and no heavier against the
  // stem, or an Ultra's closed into a hexagon: past the current Black, where
  // grown from the UltraBlack on it stood 22 units wide at the Black.
  const past = Math.min(1, Math.max(0, heaviness(f) / 0.67 - nowBlack()) / (2.24 - nowBlack()));
  const reach = (held3(171, 179, 171) + 40 * past) * u;
  const weight = f.half * 2 * (held3(0.69, 0.59, 0.87) - 0.1 * past);
  const centre = at(f.edge - f.half + reach, up(f, held3(547, 541, 554)));
  const pen = { ...f.style.pen, weight, contrast: 0, angle: 0 };
  return finish(
    f,
    // Its diagonals a little longer than its level arms, as Geist's are
    // (177 against 171 at the Regular): as long, it stood 14 units short.
    [0, 60, 120].map((degrees) => {
      const arm = degrees === 0 ? reach : reach * ASTERISK_LONGER;
      const drawn = ink(
        f,
        straight(pointOn(centre, arm, degrees + 180), pointOn(centre, arm, degrees)),
      );
      return inherit(drawn, { ...drawn, pen });
    }),
  );
}

/** The percent: two narrow ovals and a long diagonal cut level at both ends. */
export function grotesquePercent(style: Style): Recipe {
  const f = frame(style);
  // Geist Thin's is narrower against its o than the Regular's; and at
  // Geist's widths, where it stood 13 narrow at the Thin, 10 at the Regular
  // and 8 wide at the Black.
  const u =
    large(f, 1) * (1 - 0.06 * thinness(f)) * (1 + atWeights(f, 0.024, 0.016, 0.008, 0.003, -0.014));
  const X = (x: number) => f.edge - f.half + x * u;
  /*
   * Measured off Geist Thin, Regular and Black, from the left of the ink.
   * Its ovals are tall -- 352 of the cap height at the Regular and the
   * Black, 320 at the Thin -- and drawn lighter than the stem as the pen
   * grows (Geist Black's are 122 across on a stem of 172, 86 at their
   * crowns), and the slash stands up a little as it grows heavier. Past the
   * Black the ovals move apart with the slash between them, so each keeps an
   * open counter well clear of the diagonal.
   */
  const [, lerp] = squared(f);
  const t = Math.min(heaviness(f) / 0.67, 2.24);
  const light = thinness(f) > 0;
  const held3 = (a: number, b: number, thin: number) =>
    light ? lerp(a, b, thin) : a + (b - a) * Math.min(t, 1);
  const stem = f.half * 2;
  // Past the current Geist's Black, a stem of 194: its UltraBlack (172, this
  // Black's measures) and its Black differ by a dozen units across.
  const past = Math.max(0, stem - NOW_BLACK * (f.x / 530));
  // Past the Black no heavier at the crowns than the Black's, or the rings
  // stood past both lines and their counters closed to slits.
  const ringWeight = stem * held3(0.83, 0.71, 1);
  const crowns = 172 * (f.x / 530) * 0.71 * 0.7;
  const ringPen = {
    ...f.style.pen,
    weight: ringWeight,
    contrast: past > 0 ? Math.max(0.3, 1 - crowns / ringWeight) : held3(0.14, 0.3, 0.07),
    angle: 0,
  };
  const halfW = held3(118, 112.5, 109) * u + past * 0.35;
  const halfH = up(f, held3(145, 133, 146));
  const oval = (x: number, y: number): Stroke => {
    const drawn = ink(f, ring({ ...f, half: ringPen.weight / 2 }, at(x, up(f, y)), halfW, halfH));
    return inherit(drawn, { ...drawn, pen: ringPen });
  };
  const slash = at(X(held3(112, 159, 34)) + past * 0.8, 0);
  const slope = held3(0.69, 0.648, 0.717);
  const slashPen = {
    ...f.style.pen,
    weight: stem * held3(0.76, 0.49, 0.81),
    contrast: 0,
    angle: 0,
  };
  const diagonal = ink(f, straight(slash, at(slash.x + slope * f.cap, f.cap)), LEVEL, LEVEL);
  return finish(
    f,
    [
      oval(X(held3(154, 174, 124)) + past * 0.35, held3(542, 542, 558)),
      oval(X(held3(560, 604, 453)) + past * 1.6, held3(168, 168, 152)),
      inherit(diagonal, { ...diagonal, pen: slashPen }),
    ],
    true,
  );
}

/**
 * The at sign: a single-storey a -- a bowl and a stem -- whose stem turns
 * out at its foot and runs up into a wide ring round the whole, which comes
 * over the top and round to an end under the a, as Geist's does.
 */
export function grotesqueAt(style: Style): Recipe {
  const f = frame(style);
  const u = large(f, 1);
  const X = (x: number) => f.edge + (x - 86.5) * u;
  /*
   * Measured off Geist Regular and Black. At the Black the a moves right
   * and shrinks inside a ring that grows a little, and each part is drawn
   * lighter than the stem -- the ring and the a's stem at three quarters of
   * it, lighter at the ring's crowns, the a's bowl at 0.8 -- so the a keeps clear of the
   * ring all round. Drawn at nine tenths of the stem throughout, a Black's a
   * ran into its ring and an Ultra's was a black disc.
   */
  const t = Math.min(heaviness(f) / 0.67, 1);
  // Past the current Geist's Black, a stem of 194 (see `squaredNow`).
  const past = Math.min(1, Math.max(0, heaviness(f) / 0.67 - nowBlack()) / (2.24 - nowBlack()));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const stemW = f.half * 2;
  const pen = (share: number, contrast: number) => ({
    ...f.style.pen,
    weight: stemW * share,
    contrast,
    angle: 0,
  });
  const bowlPen = pen(lerp(0.87, 0.81) - 0.2 * past, lerp(0, 0.25));
  const stemPen = pen(lerp(0.87, 0.76) - 0.16 * past, lerp(0, 0.15));
  /*
   * The ring lighter than the stem from a SemiBold on, as Geist 1.7.2's is:
   * its sides 0.83 of the stem at the Regular, 0.67 at the SemiBold and 0.57
   * at the Black (110 on 194). On the stem's pen they stood 148 at the Black.
   * The stem's hook is the ring's own start: never lighter than the ring, or
   * the ring's square start stood past it.
   */
  const ringShare =
    roundGain(f, 0.83, 0.67, 0.87) -
    (0.1 * Math.max(0, Math.min(heavyT(f), nowBlack()) - 0.41)) / 0.9;
  const ringPen = pen(Math.min(stemPen.weight / stemW, ringShare - 0.16 * past), lerp(0.03, 0.09));
  const drawnWith = (stroke: Stroke, with_: Stroke["pen"]): Stroke =>
    inherit(stroke, { ...stroke, pen: with_ });
  const grow = past * stemW * 0.35;
  // And wider again towards the Thin, whose ring stands 398 out from its
  // middle against the Regular's 372: half of that is already in the face's
  // own widening of its light letters.
  const light = thinness(f);
  // And from under the line to 710 at every weight, lower at the Black:
  // Geist's ring stands round 302 on the Thin and 291 on the Black, 816
  // tall on the Thin -- grown upward here, where the tail's end stays put.
  // The ring and its tail measured off the current Geist, whose Black is a
  // stem of 194: reached at pen 194, and UltraBlack's at 172 (see `squaredNow`).
  const [, now] = squaredNow(f);
  const outer = at(X(now(457, 500) + 3 * light) + grow * 0.3, up(f, now(304, 291) + 7 * light));
  // Carried out by as much as the lighter ring gives back, to Geist's ring:
  // its spine 369 from its middle at the Regular and 402 at the Black.
  const lighter =
    roundGain(f, 7, 15, 0) - (5 * Math.max(0, Math.min(heavyT(f), nowBlack()) - 0.41)) / 0.9;
  const outerW = held(f, (now(370, 400) + 14 * light + lighter) * u + grow);
  const outerH = held(f, up(f, now(366, 363) + 22 * light + roundGain(f, 5, 5.5, 0)) + grow * 0.3);
  const rf: Frame = { ...f, half: ringPen.weight / 2 };
  /*
   * The stem's turn lands on the ring's right side low down, where Geist's
   * does (its turn bottoms out at 115 on the Regular and 130 on the Black), and
   * leaves along the ring's own heading there, so the two are one smooth
   * run; the turn is never tighter than the pen will go round -- past that
   * the stem stands further in. Landed at the ring's widest, the hook turned
   * at the letter's middle, 80 units above Geist's.
   */
  const joins = angleAt(rf, outer, outerW, outerH, up(f, now(197, 223, 190)), false);
  const landing = bowlPoint(outer, outerW, outerH, 1 - f.square, rf.half, joins, f.curve);
  const ahead = bowlPoint(outer, outerW, outerH, 1 - f.square, rf.half, joins + 0.5, f.curve);
  const heading = Math.atan2(ahead.y - landing.y, ahead.x - landing.x);
  const lean = Math.PI / 2 - heading;
  // The hook on the stem's pen, heavier than the ring's, lands in by half
  // the difference so its outside runs on flush with the ring's: landed on
  // the ring's own spine, a Black's hook stood 18 units past the ring.
  const inset = (stemPen.weight - ringPen.weight) / 2;
  const end = at(landing.x - inset * Math.sin(heading), landing.y + inset * Math.cos(heading));
  const hookIn = Math.max(
    (end.x - X(lerp(608, 654)) - grow * 0.3) / (1 + Math.cos(lean)),
    (stemPen.weight / 2) * 1.2,
  );
  const stem = end.x - hookIn * (1 + Math.cos(lean));
  const turnY = end.y + hookIn * Math.sin(lean);
  /*
   * The tail runs round under the ring to where Geist's ends: its middle 623
   * in on the Regular and 700 on the Black, a little under the line. Cut
   * where the ring came down to 40 under the line, a Black's tail stopped 35
   * short of Geist's.
   */
  const tailX = X(now(623, 700)) + grow * 0.3;
  let [low, high] = [-90, 0];
  for (let step = 0; step < 40; step++) {
    const mid = (low + high) / 2;
    const point = bowlPoint(outer, outerW, outerH, 1 - f.square, rf.half, mid, f.curve);
    if (point.x < tailX) low = mid;
    else high = mid;
  }
  const ends = (low + high) / 2;
  const bf: Frame = { ...f, half: bowlPen.weight / 2 };
  return finish(
    f,
    [
      drawnWith(
        ink(
          bf,
          ring(
            bf,
            at(X(lerp(442, 490)) - grow * 0.2, up(f, lerp(291, 295))),
            held(bf, lerp(165, 154) * u),
            held(bf, up(f, lerp(178, 158))),
          ),
        ),
        bowlPen,
      ),
      /*
       * Two runs meeting where the turn lands on the ring, so that a heavy
       * pen, which brings the ring down over the head of the stem, laps two
       * strokes rather than folding one.
       */
      drawnWith(
        ink(
          f,
          chain(
            straight(at(stem, up(f, 500)), at(stem, turnY)),
            pinned(turn(at(stem + hookIn, turnY), hookIn, 180, 360 - (lean * 180) / Math.PI), 2),
          ),
          f.end,
          BUTT,
        ),
        stemPen,
      ),
      // Its tail cut square across, as Geist's is, not upright.
      drawnWith(
        ink(
          rf,
          bend(
            rf,
            outer,
            outerH,
            joins,
            360 + Math.min(ends, joins - 20) - 360 * (ends > joins ? 1 : 0),
            outerW,
          ),
          BUTT,
          BUTT,
        ),
        ringPen,
      ),
    ],
    true,
  );
}

/** The c: the o's own ring, cut level on the right at Geist's two heights. */
export function grotesqueC(style: Style): Recipe {
  const f = frame(style);
  const [, t] = smallSpread(f, 0.5);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const H = (y: number) => (y / 530) * f.x;
  // Widened from the SemiBold on and narrowed a little at the Regular, to
  // the current Geist's.
  const halfW = held(
    f,
    (mixed(f.grownBowl, f.bowl, 0.5) / unstretched(f)) * 0.985 + roundGain(f, -2.5, 8.5),
  );
  const centre = at(f.edge + halfW, f.x / 2);
  const head = angleAt(f, centre, halfW, f.bowlH, H(lerp(352, 325)), false);
  const foot = angleAt(f, centre, halfW, f.bowlH, H(lerp(188, 215)), false);
  return finish(f, [ink(f, bend(f, centre, f.bowlH, head, 360 + foot, halfW), f.end, f.end)], true);
}

/**
 * The e: the o's ring from its bar round over the top and the foot to a
 * terminal cut level well up the right side, and the bar straight across, as
 * Geist's is.
 */
export function grotesqueE(style: Style): Recipe {
  const f = frame(style);
  const [, t] = smallSpread(f);
  const lerp = (a: number, b: number) => a + (b - a) * Math.min(t, 1.5);
  const H = (y: number) => (y / 530) * f.x;
  // A little narrower than the o's, to the current Geist's: 6 units.
  const halfW = held(f, (f.bowl / unstretched(f)) * 0.99 - 3 * (1 - thinness(f)));
  const centre = at(f.edge + halfW, f.x / 2);
  // Geist's height, moved with the crossbar control from where the face has it.
  // Past the Black the bar comes down a little, so the eye over it stays open.
  const past = Math.min(1, Math.max(0, t - 1) / 1.24);
  const bar = H(272 - 15 * past) + (f.style.parts.crossbar.height - SANS_CROSSBAR) * f.x;
  // And past the Black the foot is cut lower too, or the aperture between
  // it and the bar closed to a crack across the letter.
  const foot = angleAt(f, centre, halfW, f.bowlH, H(lerp(158, 168) - 28 * past), false);
  uses("crossbar");
  /*
   * And lighter than the bowl's crown, as Geist's is: 76 on the Regular's 82,
   * 98 on the Black's 127. An e stacks its crown, its bar and its foot in the
   * x-height, and at the bowl's own weight the eye of a Black was a slit.
   */
  const light = 1 - 0.24 * Math.min(t, 1) - 0.12 * Math.min(Math.max(t - 1, 0), 1.24);
  const drawnBar = thin(f, straight(at(f.edge, bar), at(f.edge + 1, bar)));
  const pen = drawnBar.pen;
  const thick = pen.weight * (1 - pen.contrast) * light;
  /*
   * The ring leaves the bar at the bar's top edge, running upright there,
   * and the bar runs out square under it to the ring's outside, so the right
   * side drops straight from the ring's round into the bar's end, as Geist's
   * does. The ring's upper half is drawn round a centre on the bar's top for
   * that, its lower half round the bowl's own, with the left side carried
   * straight between the two. Left leaving the bar partway round the bowl's
   * one curve, the ring came in above the bar's end and the bar stood out
   * past it as a square step.
   */
  const top = bar + thick / 2 - 0.5;
  const crown = centre.y + f.bowlH;
  const upper = at(centre.x, Math.min(top, crown - f.least));
  const lower = at(centre.x, Math.min(centre.y, upper.y));
  const base = centre.y - f.bowlH;
  const side = reachAlong(at(1, 0), penReach(f.style.pen)).x;
  // The right half no wider than the bowl's one curve is at the bar's top,
  // which is as wide as Geist's e reaches there.
  const onTop = bowlPoint(
    centre,
    halfW,
    f.bowlH,
    1 - f.square,
    f.half,
    angleAt(f, centre, halfW, f.bowlH, Math.min(top, crown - 1), false),
    f.curve,
  );
  const rightW = held(f, Math.min(halfW, onTop.x - centre.x));
  const across = thin(f, straight(at(f.edge, bar), at(centre.x + rightW + side, bar)));
  return finish(
    f,
    [
      ink(
        f,
        chain(
          bend(f, upper, crown - upper.y, 0, 90, rightW),
          bend(f, upper, crown - upper.y, 90, 180, halfW),
          straight(at(centre.x - halfW, upper.y), at(centre.x - halfW, lower.y)),
          bend(f, lower, lower.y - base, 180, 270, halfW),
          bend(f, lower, lower.y - base, 270, 360 + foot, halfW),
        ),
        BUTT,
        f.end,
      ),
      inherit(across, { ...across, pen: { ...pen, contrast: 1 - thick / pen.weight } }),
    ],
    true,
  );
}

/*
 * The square capitals -- E F H L T U -- as Geist draws them, Regular to Black
 * and on past it: measured from the left of the ink in Geist's units, each
 * measure run on along the line from the Regular through the Black as the
 * pen grows (so an Ultra's E reaches as much further again as its stem has
 * grown, and its H's counter closes by as much again). The plain forms were
 * fitted at the Regular alone, and at the Black their arms stopped fifty
 * units short and their bars sat a dozen high.
 */

/** Where Geist's ink at `x` (from the left of the ink) falls, and how far along the Regular-to-Black line this weight is. */
function squared(
  f: Frame,
): [(x: number) => number, (a: number, b: number, thin?: number) => number] {
  const k = f.style.metrics.width / unstretched(f);
  const t = Math.min(heaviness(f) / 0.67, 2.24);
  const l = thinness(f);
  return [
    (x) => f.edge - f.half + x * k,
    (a, b, thin) => (l > 0 && thin !== undefined ? a + (thin - a) * l : a + (b - a) * t),
  ];
}

/**
 * `squared`, for the measures taken off the current Geist, whose Black has a
 * stem of 194. The rest of the Sans was measured off an older Geist whose
 * Black had a stem of 172 -- the one the current Geist ships as UltraBlack --
 * and reaches its Black at pen 172; these reach the current Black at pen
 * 194, and at pen 172 come out where UltraBlack is, which lies between Geist's
 * Regular and Black as its stem does.
 */
function squaredNow(
  f: Frame,
): [(x: number) => number, (a: number, b: number, thin?: number) => number] {
  const [X] = squared(f);
  const t = Math.min(heaviness(f) / 0.67, 2.24) / nowBlack();
  const l = thinness(f);
  return [X, (a, b, thin) => (l > 0 && thin !== undefined ? a + (thin - a) * l : a + (b - a) * t)];
}

/** The stem of the current Geist's Black. */
const NOW_BLACK = 194;

/**
 * How far past the Sans's own Black that is, as `squared` counts weight:
 * worked out once on the Sans as it is drawn full size, since a letter drawn
 * small -- the a of the ordinal -- is drawn from a style whose pen is scaled.
 */
let nowBlackCache = 0;
function nowBlack(): number {
  if (nowBlackCache > 0) return nowBlackCache;
  const sans = BASES.find((base) => base.name === "Sans");
  const black = sans ? blackness({ ...sans, pen: { ...sans.pen, weight: NOW_BLACK } }) / 0.67 : 0;
  nowBlackCache = black > 1 ? black : 1;
  return nowBlackCache;
}

/**
 * How far from the face's own pen towards Geist Thin's (a stem of 30) a light
 * weight is, nought to one, on a face that holds its widths below its own pen
 * (`metrics.lightHeld`): a letter measured off Geist Regular and Black takes
 * Geist Thin's measures as it thins, where one is given.
 */
function thinness(f: Frame): number {
  const held = f.style.metrics.lightHeld;
  if (!held) return 0;
  return Math.min(1, Math.max(0, (held.from - f.style.pen.weight) / (held.from - 30)));
}

/** The height of a bar centred on Geist's `y`, moved with the crossbar control. */
function barAt(f: Frame, y: number): number {
  return f.cap * (y / 710 + f.style.parts.crossbar.height - SANS_CROSSBAR);
}

function eff(f: Frame, arms: number[][], middle: number): Stroke[] {
  const [X, lerp] = squared(f);
  const stem = f.edge;
  const heights = [f.hangs(f.cap, f.bar), barAt(f, middle), f.sits(0, f.bar)];
  return [
    ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
    ...arms.map(([a, b, thin], index) => arm(f, stem, X(lerp(a, b, thin)), heights[index])),
  ];
}

/** The E: three arms off the stem, the lowest the longest, the middle a little short. */
export function grotesqueCapitalE(style: Style): Recipe {
  const f = frame(style);
  uses("crossbar");
  return finish(
    f,
    eff(
      f,
      [
        [447, 510, 419],
        [435, 498, 407],
        [455, 518, 427],
      ],
      356,
    ),
  );
}

/** The F: the E's upper arms, the middle one a little lower. */
export function grotesqueCapitalF(style: Style): Recipe {
  const f = frame(style);
  uses("crossbar");
  return finish(
    f,
    eff(
      f,
      [
        [447, 504, 419],
        [429, 486, 401],
      ],
      347,
    ),
  );
}

/** The L: the E's foot alone. */
export function grotesqueCapitalL(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squared(f);
  return finish(f, [
    ink(f, straight(at(f.edge, 0), at(f.edge, f.cap)), f.end, f.end),
    arm(f, f.edge, X(lerp(442, 492, 414)), f.sits(0, f.bar)),
  ]);
}

/** The H: two stems and a bar a little above the middle. */
export function grotesqueCapitalH(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squared(f);
  const left = f.edge;
  const right = Math.max(X(lerp(529, 588, 484)) - f.half, left + f.half * 2 + f.least);
  const bar = barAt(f, 357);
  return finish(f, [
    ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
    ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
    thin(f, straight(at(left, bar), at(right, bar))),
  ]);
}

/** The T: a bar hung from the cap line, the stem under its middle. */
export function grotesqueCapitalT(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squared(f);
  const half = (X(lerp(528, 595, 516)) - X(0)) / 2;
  const middle = X(0) + half;
  const top = f.hangs(f.cap, f.bar);
  return finish(f, [
    ink(f, straight(at(middle, 0), at(middle, f.cap)), f.end, BUTT),
    thin(f, straight(at(middle - half, top), at(middle + half, top)), f.end, f.end),
  ]);
}

/** The U: two stems and the trough between them, on Geist's widths. */
export function grotesqueCapitalU(style: Style): Recipe {
  const f = frame(style);
  const [X, lerp] = squared(f);
  const half = Math.max((X(lerp(536, 602, 500)) - X(0)) / 2 - f.half, f.least);
  return finish(f, [trough(f, f.edge, f.cap, half)]);
}

/**
 * The dot of an i or a j: a little wider than the stem and, past the Regular,
 * less tall than wide -- Geist Black's is 177 by 128 on a stem of 172, its top
 * 16 over the ascender. Past the Black it keeps that top and flattens a little
 * further, so an Ultra's dot stays clear of its stem and under its line.
 */
function grotesqueTittle(f: Frame, x: number): Stroke {
  const t = heaviness(f) / 0.67;
  // And lighter than the Regular, taller than wide: Geist Thin's is 34 by 70,
  // its top 12 under the ascender.
  const l = thinness(f);
  const side = f.half * (1.03 + 0.1 * l);
  const tall =
    side *
    2 *
    (1 + 1.06 * l - 0.28 * Math.min(t, 1) - 0.14 * Math.min(Math.max(t - 1, 0) / 1.24, 1));
  const top = f.asc + (16 / 530) * f.xOwn * Math.min(t, 1) - (12 / 530) * f.xOwn * l;
  // Clear of the stem's top, by a little less where the stem is drawn taller
  // (`metrics.xGrows`), or an Ultra's dot rose past the ascender's overshoot.
  const clear = f.half * 0.3 - (f.x - f.xOwn) * 0.5;
  const y = Math.max(top - tall / 2, f.x + clear + tall / 2);
  const pen = { ...f.style.pen, weight: tall, contrast: 0, angle: 0 };
  return ink({ ...f, style: { ...f.style, pen } }, straight(at(x - side, y), at(x + side, y)));
}

/** The i: the stem and its dot. */
export function grotesqueI(style: Style): Recipe {
  const f = frame(style);
  const stem = f.edge;
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
    grotesqueTittle(f, stem),
  ]);
}
