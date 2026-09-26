/**
 * The capitals, A to Z.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from, moved
 * here unchanged so the recipes can be read a group at a time. Only that file
 * imports it; see it for what a recipe is and how the table is used.
 */

import { bowlPoint } from "../shapes";
import type { Style } from "../style";
import type { Stroke } from "../types";
import {
  arm,
  arms,
  at,
  belly,
  BUTT,
  chain,
  corner,
  corners,
  dips,
  finish,
  frame,
  ink,
  junction,
  type LetterName,
  openBowl,
  type Recipe,
  ring,
  spine,
  straight,
  stub,
  thin,
  trough,
  turn,
  middleBar,
} from "./common";

export const CAPITAL_RECIPES: Record<LetterName, (style: Style) => Recipe> = {
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
    /*
     * Where the diagonals actually are at that height, so the bar meets them
     * rather than poking out either side -- or, as it did, stopping short.
     *
     * Measured to the apex the skeleton really reaches, which is not the cap
     * line: `corner` returns the vertex the two spines meet at, and that sits
     * below the line by however far the point of the angle carries. Divided by
     * the cap the bar was cut for a taller A than the one drawn, so both ends
     * landed inside the letter and short of the diagonals. Thick ink hid it;
     * at a pen of 8 the bar came away as a piece of its own on all four faces.
     */
    const inset = (half * bar) / Math.max(peak.y, f.least);
    return finish(f, [
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
    return finish(f, [
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
      true,
    );
  },

  E: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = f.capBowl * 1.15;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      arm(f, stem, stem + reach, f.hangs(f.cap, f.bar)),
      arm(f, stem, stem + reach * 0.86, middleBar(f, f.cap)),
      arm(f, stem, stem + reach, f.sits(0, f.bar)),
    ]);
  },

  F: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = f.capBowl * 1.15;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      arm(f, stem, stem + reach, f.hangs(f.cap, f.bar)),
      arm(f, stem, stem + reach * 0.86, middleBar(f, f.cap)),
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
      true,
    );
  },

  H: (style) => {
    const f = frame(style);
    const left = f.edge;
    const right = left + f.style.metrics.counterWidth + f.style.pen.weight;
    return finish(f, [
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
    return finish(f, [
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
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      ink(f, chain(straight(arm, meet), straight(meet, leg)), f.end, f.end),
    ]);
  },

  L: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = f.capBowl * 1.05;
    return finish(f, [
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
    return finish(f, [
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
    return finish(f, [
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
    return finish(f, [
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
        ink(f, straight(leaves, at(centre.x + f.capBowl * 1.02, -f.cap * 0.15)), BUTT, f.end),
      ],
      true,
    );
  },

  R: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = Math.max(f.cap * 0.27, f.least);
    const eye = f.crest(f.cap) - radius;
    const junction = eye - radius;
    const reach = stem + radius * 1.9;
    return finish(f, [
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
    return finish(f, [
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
    return finish(f, [ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end)]);
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
    return finish(f, [
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
    return finish(f, [
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
    return finish(f, [
      ink(
        f,
        chain(straight(start, upper), straight(upper, lower), straight(lower, end)),
        f.end,
        f.end,
      ),
    ]);
  },
};
