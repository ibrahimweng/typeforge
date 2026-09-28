/**
 * The capitals, A to Z.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from, moved
 * here unchanged so the recipes can be read a group at a time. Only that file
 * imports it; see it for what a recipe is and how the table is used.
 */

import { bowlPoint, spineEnd } from "../shapes";
import { blackness, type Style } from "../style";
import {
  barWeight,
  joinsLevel,
  leaving,
  arm,
  arms,
  at,
  BUTT,
  LEVEL,
  chain,
  corner,
  doubleVee,
  corners,
  dips,
  finish,
  frame,
  ink,
  type LetterName,
  lobe,
  openBowl,
  type Recipe,
  ring,
  spine,
  straight,
  stub,
  thin,
  trough,
  turn,
  twoBowls,
  inherit,
  kArms,
  emAt,
  middleBar,
  bookish,
  heaviness,
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
    // And wider at a black weight, or its counter is a pinhole -- one a rim
    // closes to a speck rather than a counter.
    const half = Math.max(f.capBowl * 0.86, f.least) + f.half * 0.45 * heaviness(f) + f.gain * 0.7;
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
    /*
     * And never so high that the counter over it closes. The legs' inside
     * edges meet well below the apex at a heavy weight -- by half a stem over
     * the sine of the legs' lean -- and a bar at the regular's height left a
     * notch of paper above it the size of a serif. Held to the lower two fifths
     * of what is left under that point, as the regular's bar is.
     */
    const lean = Math.hypot(half, f.cap) / half;
    const inside = f.cap - f.half * lean;
    /*
     * But not so low that there is no paper under it: at a Black, taken down
     * by a further third of a stem, the bar sat on the baseline and the A was
     * a solid triangle with a hole in it. Below the Black the bar comes down
     * as it did; past it, it holds three quarters of a stem of clear space
     * between the feet.
     */
    const heavy = heaviness(f);
    // Not on a text serif, whose feet already stand apart on their serifs.
    const under = bookish(f) ? 0 : f.half * 1.5 * Math.min(1, blackness(f.style));
    const bar = Math.max(
      Math.min(
        f.cap * f.style.parts.crossbar.height * 0.58,
        inside * 0.42 - (f.half * barWeight(f.style)) / 2,
      ) -
        f.half * 0.3 * heavy,
      Math.min(
        under + f.upright * barWeight(f.style),
        inside * 0.42 - (f.half * barWeight(f.style)) / 2,
      ),
    );
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
    /*
     * Two bowls run level off the stem, the lower reaching further than the
     * upper, and lighter than the stem at a heavy weight so the waist does not
     * close: see `twoBowls`, which the Cyrillic ve is drawn with too.
     */
    return finish(f, twoBowls(f, f.cap, f.capBowl));
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
    const low = f.sits(0);
    const high = f.hangs(f.cap);
    const radius = Math.max((high - low) / 2, f.least);
    return finish(
      f,
      [
        ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
        /*
         * Run out level before it turns, so a D is nearly as wide as an O
         * rather than half of one: see `lobe`. And the runs lie on the two
         * lines rather than over them, as a flat stroke does -- the overshoot
         * is for the curve, and the curve here is only the right-hand side.
         */
        lobe(f, stem, low, high, Math.max(f.capBowl * 1.52, radius * f.wide)),
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
    /*
     * And at a heavy weight the bar hangs from the end of the bowl rather than
     * straddling it. The bowl is cut out of the same pieces at every weight and
     * cannot carry on past its own seam, which is the centre line, so at a
     * Black the bowl stopped there and the top half of the bar stood out on a
     * step beside it. Hung so its top edge is the bowl's cut, the two are one
     * flush corner.
     */
    // Its lower end runs into the bar and is not a terminal: a ball or a
    // swelling put on it there crashed into the one on the G's head.
    const open = openBowl(f, centre, f.capBowl, f.capBowlH, opens, 360, past);
    const bowl = inherit(open, { ...open, end: BUTT });
    const cut = spineEnd(bowl.spine).y;
    /*
     * And at every weight, not only past the Black: the bowl comes up its
     * right side and stops square, and a bar straddling the centre stood
     * above that end as a second, higher block -- the bar in two steps on the
     * Technical, the Ribbon and the Flared alike.
     */
    const hung = cut - f.upright * f.bar;
    return finish(
      f,
      /*
       * The bar's inner end cut plain: a G's bar is not an arm, and a beak on
       * it stood up inside the counter as a tick on every slabbed face, and a
       * ball on it crashed into the ball on the G's head.
       */
      [bowl, ink(f, straight(at(right, hung), at(right - f.capBowl * 0.55, hung)), BUTT, BUTT)],
      true,
    );
  },

  H: (style) => {
    const f = frame(style);
    const left = f.edge;
    const right =
      left + f.style.metrics.counterWidth * (f.style.metrics.stretch ?? 1) + f.style.pen.weight;
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
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      ...kArms(f, arm, stem, waist, leg),
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
    /*
     * And wide enough that the vee is a vee.
     *
     * Every other letter narrows gracefully; an M does not, because its two
     * diagonals meet the stems at a corner that sharpens as the letter closes
     * up, and past a point the inside of that corner cannot be cut back inside
     * the run it has to be cut back into.
     */
    const width = Math.max(f.capBowl * 1.7, f.half * 7);
    return finish(f, emAt(f, f.cap, width));
  },

  N: (style) => {
    const f = frame(style);
    const left = f.edge;
    // And wider at a heavy weight, as the A and the H are, or the diagonal
    // has no room between the stems and the letter reads as an H.
    const right = left + f.capBowl * 1.35 + f.half * 0.35 * heaviness(f) + f.gain * 0.6;
    const stems = [
      ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
      ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
    ];
    if (joinsLevel(f)) {
      let top = at(left, f.cap);
      let foot = at(right, 0);
      for (let pass = 0; pass < 3; pass++) {
        top = leaving(f, at(left, f.cap), 1, foot, 1);
        foot = leaving(f, at(right, 0), -1, top, 1);
      }
      return finish(f, [...stems, ink(f, straight(top, foot), LEVEL, LEVEL)]);
    }
    const into = stub(f);
    const start = at(left, f.cap - into);
    const end = at(right, into);
    const [top, foot] = corners(f, [start, at(left, f.cap), at(right, 0), end]);
    return finish(f, [
      ...stems,
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
      lobe(
        f,
        stem,
        f.hangs(f.cap) - radius * 2,
        f.hangs(f.cap),
        Math.max(f.capBowl * 1.14, radius * f.wide),
      ),
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
    const leaves = bowlPoint(centre, f.capBowl, f.capBowlH, 1 - f.square, f.half, -52, f.curve);
    return finish(
      f,
      [
        ink(f, ring(f, centre, f.capBowl, f.capBowlH)),
        // Cut rather than capped: a tail is a stroke running out, not a stem
        // standing on a line, and a serif across it read as a second foot.
        ink(f, straight(leaves, at(centre.x + f.capBowl * 1.02, -f.cap * 0.15)), BUTT, f.plain),
      ],
      true,
    );
  },

  R: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const radius = Math.max(f.cap * 0.27, f.least);
    const junction = f.hangs(f.cap) - radius * 2;
    const bowl = Math.max(f.capBowl * 1.08, radius * f.wide);
    /*
     * The leg leaves the underside of the bowl, not the stem.
     *
     * Out of the stem it was a K's leg with a bowl above it. A text R -- and
     * most sans ones -- springs the leg from partway along the bowl's lower
     * run, about two fifths of the way out, and takes it straight down to a
     * foot a little past where the bowl reaches. Started on the bowl's own
     * centre-line, so its square end is inside that stroke at any weight.
     */
    const springs = at(stem + bowl * 0.4, junction);
    const foot = at(stem + bowl * 1.06, 0);
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      lobe(f, stem, junction, f.hangs(f.cap), bowl),
      ink(f, straight(springs, foot), BUTT, f.end),
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
    /*
     * As wide as an H, whatever the lowercase rhythm is set to.
     *
     * The trough is the u's, and the u's width is the shoulder's reach -- a
     * decision about the lowercase. Handed that, the U narrowed every time the
     * n did: a text face with a tight n had a U a fifth narrower than its H.
     */
    const half = (f.style.metrics.counterWidth + f.style.pen.weight) / 2;
    return finish(f, [trough(f, f.edge, f.cap, Math.max(half * f.style.metrics.width, f.least))]);
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
    // And wider at a heavy weight, as the A is, or its four counters close to
    // slits and a Black W is a black wedge.
    const half = f.capBowl * 0.66 + f.half * 0.15 * heaviness(f) + f.gain * 0.3;
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
    return finish(f, doubleVee(f, left, half, top));
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
