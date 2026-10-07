/**
 * The Greek letters that are not already drawings the font has.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from, moved
 * here unchanged so the recipes can be read a group at a time. Only that file
 * imports it; see it for what a recipe is and how the table is used.
 */

import type { Vec2 } from "@/font/types";
import { bowlPoint, spineEnd, spineStart } from "../shapes";
import type { Style } from "../style";
import type { Spine, Stroke } from "../types";
import {
  apexRounded,
  archSpine,
  arm,
  at,
  belly,
  bend,
  bendWidth,
  BUTT,
  chain,
  corner,
  corners,
  crested,
  cup,
  deg,
  type Frame,
  finish,
  frame,
  headingAt,
  heaviness,
  LEVEL,
  ink,
  type LetterName,
  type Recipe,
  ring,
  stemSide,
  straight,
  thin,
  trough,
  turn,
  middleBar,
} from "./common";

/**
 * The beta of a joined hand: a stem with two bowls hung off it, as a pen
 * writes one, kept apart so the hand's own unsteadiness moves each piece
 * whole.
 */
function writtenBeta(f: Frame): Recipe {
  const stem = f.edge;
  const upper = Math.max(f.x * 0.26, f.least);
  const lower = Math.max(f.x * 0.3, f.least);
  return finish(
    f,
    [
      ink(f, straight(at(stem, f.desc), at(stem, f.asc)), f.end, f.end),
      belly(f, at(stem, f.x - upper), upper * f.wide, upper, -90, 90),
      belly(f, at(stem, lower), lower * f.wide, lower, -90, 90),
    ],
    true,
  );
}

/** A run whose arcs are drawn in so many pieces at every weight: see `SpineArc.pieces`. */
function inPieces(spine: Spine, pieces: number): Spine {
  return {
    ...spine,
    segments: spine.segments.map((one) => (one.kind === "arc" ? { ...one, pieces } : one)),
  };
}

/**
 * From a run arriving level along the foot of a letter, heading right: a turn
 * down into the descender, and a hook back to the left at the bottom -- the
 * swash the zeta, the xi and the final sigma all end in.
 *
 * The two turns take what room there is between the foot and the descender
 * and never less than the pen goes round; the same three pieces at every
 * weight.
 */
function swash(f: Frame, from: Vec2): Spine {
  const floor = f.dip(f.desc);
  const room = Math.max(from.y - floor, f.least * 2 + 1);
  const upper = Math.max(f.least, Math.min(room * 0.46, f.bowl * 0.5));
  const lower = Math.max(f.least, Math.min(room - upper - 1, f.bowl * 0.42));
  const side = from.x + upper;
  const low = Math.min(from.y - upper - 1, floor + lower);
  return chain(
    inPieces(turn(at(from.x, from.y - upper), upper, 90, 0), 1),
    straight(at(side, from.y - upper), at(side, low)),
    inPieces(turn(at(side - lower, low), lower, 0, -115), 2),
  );
}

/**
 * A bar from `start` to `end`, a diagonal from its right end down to the
 * left that turns round into a foot along the baseline, and the swash: the
 * zeta. The bar and the diagonal are one run with a corner; the curve, the
 * foot and the swash are a second, begun a little way back up the diagonal
 * so the two overlap rather than meet edge to edge.
 */
function swept(f: Frame, start: Vec2, end: Vec2, left: number, tailX: number): Stroke[] {
  const base = f.dip(0);
  const bottom = Math.max(f.x * 0.26, f.least);
  const aim = at(left + f.half * 0.2, f.x * 0.34);
  let fold = end;
  let meet = aim;
  let centre = aim;
  const tangent = () => {
    const length = Math.hypot(aim.x - fold.x, aim.y - fold.y) || 1;
    const u = at((aim.x - fold.x) / length, (aim.y - fold.y) / length);
    // The circle the diagonal turns round: on its left, tangent to it and
    // to the foot's line.
    const normal = at(-u.y, u.x);
    const along = (base + bottom - bottom * normal.y - fold.y) / u.y;
    meet = at(fold.x + u.x * along, fold.y + u.y * along);
    centre = at(meet.x + normal.x * bottom, meet.y + normal.y * bottom);
  };
  for (let pass = 0; pass < 3; pass++) {
    tangent();
    [fold] = corners(f, [start, end, meet]);
  }
  // And laid once more off where the corner came to rest, so the diagonal
  // runs into the turn on its tangent at every weight.
  tangent();
  const from = (Math.atan2(meet.y - centre.y, meet.x - centre.x) * 180) / Math.PI;
  const length = Math.hypot(meet.x - fold.x, meet.y - fold.y) || 1;
  const back = at(
    meet.x - ((meet.x - fold.x) / length) * f.half,
    meet.y - ((meet.y - fold.y) / length) * f.half,
  );
  const foot = at(centre.x, base);
  const run = Math.max(tailX, foot.x + 1);
  return [
    ink(f, chain(straight(start, fold), straight(fold, meet)), f.end, BUTT),
    ink(
      f,
      chain(
        straight(back, meet),
        inPieces(turn(centre, bottom, from < 0 ? from + 360 : from, 270), 2),
        straight(foot, at(run, base)),
        swash(f, at(run, base)),
      ),
      BUTT,
      f.end,
    ),
  ];
}

/** Where a beta's and an eszett's bowls meet, and where the upper one tops out. */
function upright(f: Frame): { top: number; waist: number; base: number } {
  const top = f.crest(f.asc);
  const base = f.dip(0);
  return { top, base, waist: base + (top - base) * 0.52 };
}

/**
 * A stem from `foot` that arches over into an upper bowl and comes down its
 * right side into the waist, and on in to the stem: the beta's and the
 * eszett's first run. The lower bowl (`lowerLobe`) hangs from the waist.
 */
export function stemArchedInto(
  f: Frame,
  foot: number,
  halfWidth: number,
  /** How far short of the stem the waist stops, as a share of the bowl: an eszett's tongue. */
  short = 0,
): Stroke[] {
  const stem = f.edge;
  const { top, waist } = upright(f);
  const upperH = Math.max((top - waist) / 2, f.least);
  const width = Math.max(halfWidth, f.least);
  const centre = at(stem + width, top - upperH);
  const over = bend(f, centre, upperH, 180, -90, width);
  const end = spineEnd(over);
  /*
   * The stem a stroke of its own, carried a hair into the arch so the two
   * overlap rather than meet edge to edge: drawn as one run from the foot to
   * the waist, the run came back into the stem it began on, and a stroke that
   * runs over itself folds.
   */
  const rise = spineStart(over);
  return [
    ink(f, straight(at(stem, foot), at(rise.x, rise.y + 2)), f.end, BUTT),
    ink(f, chain(over, straight(end, at(stem + width * short, end.y))), BUTT, BUTT),
  ];
}

/**
 * The lower bowl of a beta, closed back onto the stem at the foot, or an
 * eszett's, left open at the bottom left.
 */
export function lowerLobe(f: Frame, closed: boolean, short = 0): Stroke {
  const stem = f.edge;
  const { waist, base } = upright(f);
  const lowerH = Math.max((waist - base) / 2, f.least);
  // Off the o's ink rather than its spine, which closes in as the pen grows.
  const o = f.bowl + f.half;
  /*
   * Never so narrow, nor so near the stem, that a fat face's counter is a
   * slit: at the display weight the eszett's lower bowl had forty units of
   * paper in it and its foot stopped a hair from the stem, a step rather than
   * an opening.
   */
  const side = stemSide(f);
  const width = Math.max(o * 0.68 + f.gain * 0.3, f.least, side * 1.7);
  const centre = at(stem + Math.max(o * 1.3 - width, side * 1.3) + f.gain * 0.6, waist - lowerH);
  const round = bend(f, centre, lowerH, 90, -90, width);
  const foot = spineEnd(round);
  const stop = closed
    ? stem
    : Math.min(
        foot.x - f.half * 0.3,
        Math.max(stem + Math.max(f.half * 2.4, o * 0.4), stem + side + f.half * 1.3),
      );
  return ink(
    f,
    chain(
      straight(at(Math.min(stem + short, spineStart(round).x - 1), waist), spineStart(round)),
      round,
      straight(foot, at(stop, foot.y)),
    ),
    BUTT,
    closed ? BUTT : f.end,
  );
}

export const GREEK_RECIPES: Record<LetterName, (style: Style) => Recipe> = {
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
    // Its apex rounded as the A's is: see `apexRounded`.
    const legs = apexRounded(f, half, f.cap);
    const peak = corner(legs, foot, at(middle, f.cap), other);
    return finish(f, [
      ink(legs, chain(straight(foot, peak), straight(peak, other)), BUTT, BUTT),
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
      true,
    );
  },

  /** The A without its crossbar, which is what a lambda is. */
  "\u039b": (style) => {
    const f = frame(style);
    const half = Math.max(f.capBowl * 0.86, f.least);
    const left = f.edge;
    const middle = left + half;
    const foot = at(left, 0);
    const other = at(middle + half, 0);
    // Its apex rounded as the A's is: see `apexRounded`.
    const legs = apexRounded(f, half, f.cap);
    const peak = corner(legs, foot, at(middle, f.cap), other);
    return finish(f, [ink(legs, chain(straight(foot, peak), straight(peak, other)), f.end, f.end)]);
  },

  /** Three bars and no stem, the middle one held in at both ends. */
  "\u039e": (style) => {
    const f = frame(style);
    const left = f.edge;
    const reach = f.capBowl * 1.6;
    const inset = reach * 0.13;
    const middle = middleBar(f, f.cap);
    return finish(f, [
      thin(
        f,
        straight(at(left, f.hangs(f.cap, f.bar)), at(left + reach, f.hangs(f.cap, f.bar))),
        f.end,
        f.end,
      ),
      thin(f, straight(at(left + inset, middle), at(left + reach - inset, middle)), f.end, f.end),
      thin(
        f,
        straight(at(left, f.sits(0, f.bar)), at(left + reach, f.sits(0, f.bar))),
        f.end,
        f.end,
      ),
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
      thin(
        f,
        straight(at(left, f.hangs(f.cap, f.bar)), at(right, f.hangs(f.cap, f.bar))),
        BUTT,
        BUTT,
      ),
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
      true,
    );
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
      true,
    );
  },

  /**
   * A stem from the descender that arches over into the upper bowl, and a
   * larger bowl below it: one run from the foot of the stem over the top and
   * down into the waist, and the lower bowl off the stem as a B's is.
   *
   * Two bumps hung on a straight stem, as it was, read as a barred I with a 3
   * on it: the stem has to turn over into the first bowl, as every beta's does.
   */
  "\u03b2": (style) => {
    const f = frame(style);
    if (f.style.parts.script.on) return writtenBeta(f);
    return finish(
      f,
      [...stemArchedInto(f, f.dip(f.desc), f.bowl * 0.74), lowerLobe(f, true)],
      true,
    );
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
    const wide = bendWidth(f, radius) + f.gain * 0.5 + f.half * 0.15 * heaviness(f);
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
    /*
     * The neck leaves the bowl on its own top, on the stroke rather than
     * inside it, and rises back to the left into a curl that turns over to
     * the right, as Geist's does. Aimed at a point inside the bowl, it cut
     * through the counter.
     */
    const leaves = bowlPoint(centre, wide, radius, 1 - f.square, f.half, 90, f.curve);
    // Never tighter than the pen turns cleanly: at a fat face's weight a curl
    // turned on the least radius left a sliver spiking out of its inside.
    const curl = Math.max(wide * 0.36, f.least * 1.35);
    const knee = at(f.edge + wide * 0.34 + curl, f.x + (f.asc - f.x) * 0.45);
    const heading = Math.atan2(knee.y - leaves.y, knee.x - leaves.x);
    const from = (heading * 180) / Math.PI + 90;
    const hub = at(knee.x - curl * Math.cos(deg(from)), knee.y - curl * Math.sin(deg(from)));
    // In two pieces at every weight, however far round the curl turns.
    const neck = chain(straight(leaves, knee), inPieces(turn(hub, curl, from, 20), 2));
    return finish(f, [ink(f, ring(f, centre, wide, radius)), ink(f, neck, BUTT, f.end)], true);
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
    /*
     * Two arcs bulging left, each stopping square where it turns level at the
     * waist, and a short tongue run out to the right along that line -- a
     * three turned round, as the ze is. Joined end to end at the waist, as
     * they were, the two cut ends met at an angle and left a notch either
     * side of it at every weight.
     */
    const f = frame(style);
    const crest = f.crest(f.x);
    const base = f.dip(0);
    const radius = Math.max((crest - base) / 4, f.least);
    const wide = Math.max(
      bendWidth(f, radius) + f.gain * 0.5 + f.half * 0.15 * heaviness(f),
      stemSide(f) * 1.75,
    );
    const cx = f.edge + wide * 0.62;
    const waist = (crest + base) / 2;
    return finish(
      f,
      [
        ink(f, bend(f, at(cx, crest - radius), radius, 40, 270, wide * 0.92), f.end, BUTT),
        ink(f, bend(f, at(cx, base + radius), radius, 90, 320, wide), BUTT, f.end),
        ink(f, straight(at(cx - 1, waist), at(cx + wide * 0.3, waist)), BUTT, BUTT),
      ],
      true,
    );
  },

  /**
   * A bar at the ascender, a diagonal back under it that curves round into
   * the foot, and the foot run on down into the descender and hooked back.
   *
   * A 7 standing on a block, as it was: the diagonal met a straight tail
   * dropped from its heel. The curve at the bottom left and the swash below
   * the line are what make the letter.
   */
  "\u03b6": (style) => {
    const f = frame(style);
    const left = f.edge;
    const reach = f.arch * 1.25 + f.gain * 0.3;
    const top = f.hangs(f.asc, f.bar);
    const start = at(left + reach * 0.08, top);
    return finish(f, swept(f, start, at(left + reach, top), left, left + reach * 0.78));
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
      true,
    );
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
    /*
     * The short leg leaves the long one partway down, from a point on the
     * long one's own spine so the two are one piece. Started beside it, as it
     * was, it floated as a parallelogram of its own.
     */
    const share = (peak.y - f.x * 0.6) / (peak.y - foot.y);
    const branch = at(peak.x + (foot.x - peak.x) * share, peak.y + (foot.y - peak.y) * share);
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
    return finish(f, [ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end)]);
  },

  /**
   * A bar at the ascender, a small bowl under it and a larger one below
   * that, both bulging left and meeting in a tongue at the waist, and the
   * foot run on down into the descender and hooked back, as the zeta's is.
   *
   * Laid as five loose strokes -- a curl, a stem, a bar, a diagonal and a
   * tail -- it read as fragments rather than a letter.
   */
  "\u03be": (style) => {
    const f = frame(style);
    const left = f.edge;
    const top = f.hangs(f.asc);
    const base = f.dip(0);
    const waist = f.x * 0.6;
    const upperH = Math.max((top - waist) / 2, f.least);
    const lowerH = Math.max((waist - base) / 2, f.least);
    const upperW = Math.max(f.bowl * 0.62, f.least);
    const lowerW = Math.max(f.bowl * 0.8 + f.gain * 0.3, f.least);
    const upper = at(left + upperW, top - upperH);
    const lower = at(left + lowerW, waist - lowerH);
    const first = bend(f, upper, upperH, 90, 270, upperW);
    const second = bend(f, lower, lowerH, 90, 270, lowerW);
    // Out past where both bowls leave the waist, or the lower one's run
    // would double back on itself.
    const tongue = Math.max(upper.x + upperW * 0.55, spineStart(second).x + f.half * 0.6);
    const foot = spineEnd(second);
    const tailX = left + lowerW * 1.55;
    return finish(
      f,
      [
        ink(
          f,
          chain(
            straight(at(upper.x + upperW * 0.9, top), spineStart(first)),
            first,
            straight(spineEnd(first), at(tongue, spineEnd(first).y)),
          ),
          f.end,
          BUTT,
        ),
        ink(
          f,
          chain(
            straight(at(tongue, spineStart(second).y), spineStart(second)),
            second,
            straight(foot, at(tailX, foot.y)),
            swash(f, at(tailX, foot.y)),
          ),
          BUTT,
          f.end,
        ),
      ],
      true,
    );
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

  /**
   * A c whose foot runs on to the right and down into the descender, hooked
   * back under itself: one run, so the tail grows out of the bowl. A straight
   * tail dropped from the bowl's end, as it was, ended in a block.
   */
  "\u03c2": (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const loop = bend(f, centre, f.bowlH, 58, 270, f.bowl);
    const foot = spineEnd(loop);
    const tailX = centre.x + f.bowl * 0.42;
    return finish(
      f,
      [
        ink(
          f,
          chain(loop, straight(foot, at(tailX, foot.y)), swash(f, at(tailX, foot.y))),
          f.end,
          f.end,
        ),
      ],
      true,
    );
  },

  /** A bowl with a bar running off the top of it to the right. */
  "\u03c3": (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    // Level with the top of the bowl's ink, overshoot and all: hung from the
    // x-height it stood a step below the round top it runs out of.
    const bar = f.hangs(f.x + f.over, f.bar);
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        thin(
          f,
          straight(at(centre.x, bar), at(centre.x + f.bowl + f.arch * 0.5, bar)),
          BUTT,
          f.end,
        ),
      ],
      true,
    );
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
      true,
    );
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

  /**
   * Two cups side by side sharing a middle stroke that stops short of the
   * x-height, which is what an omega is.
   *
   * Two whole u's overlapped, as it was, stood the middle up to the x-height
   * as a doubled stem and closed both counters to slits at a display weight.
   */
  "\u03c9": (style) => {
    const f = frame(style);
    const top = crested(f, f.x);
    const middle = Math.max(f.x * 0.62, f.sits(0) + f.half * 3);
    const reach = Math.max(f.arch * 0.8, stemSide(f) * 1.9);
    const left = f.edge;
    return finish(
      f,
      [cup(f, left, reach, top, middle), cup(f, left + reach * 2, reach, middle, top)],
      true,
    );
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
    const radius = Math.max(f.capBowlH * 0.8, f.least);
    // Wider at a heavy weight, so the legs keep their lean and the feet
    // their gap.
    const wide = bendWidth(f, radius) + f.gain * 0.5 + f.half * 0.15 * heaviness(f);
    const centre = at(f.edge + wide, f.cap - radius);
    /*
     * One run: up the right leg, round the bowl, and down the left, each leg
     * carrying on the way the bowl was going when it let go, inward, to a
     * level cut on the baseline -- and a foot laid out along the line from
     * each. The legs and the bowl as separate strokes, as they were, met in
     * white seams and bent outward at odd angles.
     */
    const line = f.sits(0, f.bar);
    // Each leg stands on the baseline itself, and its foot lies along it.
    const legTo = (end: Vec2, heading: Vec2): Vec2 => {
      const down = Math.max(end.y, 0);
      return at(end.x + (heading.x / Math.max(-heading.y, 1e-6)) * down, 0);
    };
    /*
     * The legs carry on the way the bowl was going when it let go -- inward --
     * but never so far in that the feet close on each other: a heavy omega's
     * legs met in the middle. Each is its own stroke, begun back inside the
     * bowl's end so the two overlap rather than meet edge to edge; chained on,
     * the join between them came and went with the weight, and a variable font
     * cannot follow a letter whose points do.
     */
    /*
     * In two runs meeting at the bowl's right-hand side, so neither crosses
     * the seam a bowl's pieces are counted from: one that does is begun on
     * whichever piece its start falls in, which moved with the weight, and
     * the heavy masters came back with pieces the light ones had not got.
     */
    const loop = chain(
      bend(f, centre, radius, -22, 0, wide),
      bend(f, centre, radius, 0, 202, wide),
    );
    const leftTop = spineEnd(loop);
    // The last piece that goes anywhere: a bowl carries pieces of no length.
    const moving = loop.segments.filter((one) =>
      one.kind === "arc"
        ? Math.abs(one.endAngle - one.startAngle) > 1e-9
        : Math.hypot(one.to.x - one.from.x, one.to.y - one.from.y) > 1e-6,
    );
    const last = headingAt(moving[moving.length - 1], "end");
    const natural = Math.max(last.x / Math.max(-last.y, 1e-6), 0);
    const most = Math.max(0, (centre.x - f.half * 1.7 - leftTop.x) / Math.max(leftTop.y, 1e-6));
    const lean = Math.min(natural, most);
    const leftFoot = legTo(leftTop, at(lean, -1));
    const rightFoot = at(centre.x * 2 - leftFoot.x, leftFoot.y);
    /*
     * The bowl carried on a little past its end along its own tangent, and
     * each leg begun where the bowl ended, so the two overlap: begun further
     * back up the curve, a straight leg stood out of it as a spur, and begun
     * edge to edge it left a slit of white where a heavy leg leans less than
     * the bowl.
     */
    // Shorter where the leg is held straighter than the bowl, where the lap
    // runs on inward of it.
    const lap = f.half * (natural > most + 1e-6 ? 0.3 : 0.6);
    const leftLap = at(leftTop.x + last.x * lap, leftTop.y + last.y * lap);
    const rightLap = at(centre.x * 2 - leftLap.x, leftLap.y);
    const rightTop = at(centre.x * 2 - leftTop.x, leftTop.y);
    const leftFrom = leftTop;
    const rightFrom = rightTop;
    const toe = Math.max(wide * 0.62, f.half * 2.4);
    return finish(
      f,
      [
        ink(f, chain(straight(rightLap, rightTop), loop, straight(leftTop, leftLap)), BUTT, BUTT),
        ink(f, straight(rightFoot, rightFrom), LEVEL, BUTT),
        ink(f, straight(leftFrom, leftFoot), BUTT, LEVEL),
        arm(f, rightFoot.x, rightFoot.x + toe, line),
        thin(f, straight(at(leftFoot.x, line), at(leftFoot.x - toe, line)), BUTT, f.end),
      ],
      true,
    );
  },
};
