/**
 * The Greek letters that are not already drawings the font has.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from, moved
 * here unchanged so the recipes can be read a group at a time. Only that file
 * imports it; see it for what a recipe is and how the table is used.
 */

import type { Vec2 } from "@/font/types";
import { spineEnd, spineStart } from "../shapes";
import type { Style } from "../style";
import type { Stroke } from "../types";
import {
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
  finish,
  frame,
  ink,
  type LetterName,
  openBowl,
  type Recipe,
  ring,
  straight,
  tailBelow,
  thin,
  trough,
  turn,
} from "./common";

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
    const peak = corner(f, foot, at(middle, f.cap), other);
    return finish(f, [ink(f, chain(straight(foot, peak), straight(peak, other)), f.end, f.end)]);
  },

  /** Three bars and no stem, the middle one held in at both ends. */
  "\u039e": (style) => {
    const f = frame(style);
    const left = f.edge;
    const reach = f.capBowl * 1.6;
    const inset = reach * 0.13;
    const middle = f.cap * f.style.parts.crossbar.height;
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
      true,
    );
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
    return finish(f, [ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end)]);
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
    return finish(f, [loop, tailBelow(f, from.x, from.y + f.bowlH * 0.3)], true);
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

  /** Two troughs side by side, which is what an omega is. */
  "\u03c9": (style) => {
    const f = frame(style);
    const wide = f.arch * 0.82;
    const left = f.edge;
    return finish(f, [trough(f, left, f.x), trough(f, left + wide, f.x)]);
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
      [ink(f, loop, BUTT, BUTT), foot(spineStart(loop), 1), foot(spineEnd(loop), -1)],
      true,
    );
  },
};
