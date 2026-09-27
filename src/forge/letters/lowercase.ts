/**
 * The lowercase, a to z, with the dotless i and j.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from, moved
 * here unchanged so the recipes can be read a group at a time. Only that file
 * imports it; see it for what a recipe is and how the table is used.
 */

import { spineStart } from "../shapes";
import { blackness, type Style } from "../style";
import type { Stroke } from "../types";
import {
  roundHalf,
  arch,
  arms,
  at,
  bend,
  BUTT,
  chain,
  corner,
  corners,
  crossbar,
  finish,
  frame,
  ink,
  junction,
  type LetterName,
  openBowl,
  type Recipe,
  ring,
  eyeOf,
  wallAt,
  shoulderRadius,
  spine,
  straight,
  thin,
  trough,
  tReach,
  tStem,
  turn,
  tittle,
  bookish,
  blackGap,
  heaviness,
  lighter,
} from "./common";

export const LOWERCASE_RECIPES: Record<LetterName, (style: Style) => Recipe> = {
  // --- lowercase ---------------------------------------------------------

  a: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl + f.aside;
    /*
     * And set with the room the reference gives it, which is more than it gives
     * an `o`: 0.21 of an x-height either side against 0.155, for a body only
     * 0.10 wider. Half the difference between its `a` and its `o` is the stem
     * standing clear and half is the air around it. See `air`.
     */
    return {
      ...finish(f, [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
      ]),
      air: 0.45,
    };
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
      true,
    );
  },

  c: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    return finish(f, [openBowl(f, centre, f.bowl, f.bowlH, 55, 305, 0, blackGap(f))], true);
  },

  d: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl + f.aside;
    /*
     * Set loose, as the `a` is and for the same reason -- and looser, because
     * this letter is: the reference takes 1.30 of its own `o`'s advance for a
     * `d` and 1.19 for an `a`. Swept at 0.45, 0.75 and 0.95 against that.
     */
    return {
      ...finish(f, [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
      ]),
      air: 0.95,
    };
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
    /*
     * And at a heavy weight the bar comes down until the eye above it is half
     * a stem deep. Two horizontals and a crossbar share the x-height, and at a
     * Black on a text x-height the eye was left a third of a stem -- a chink,
     * beside an o whose counter had widened with the pen. A Black e trades
     * some of its aperture for its eye, which is the counter it is read by.
     *
     * Lowered, not lightened: a bar lighter than the bowl moved where a break
     * laid along it falls, and the break sliced the bowl above it.
     */
    // Not in a joined hand, whose e is a loop written round from its join.
    const opening = f.style.parts.script.on ? 0 : Math.min(1, blackness(f.style) / 0.5);
    const barHalf = f.upright * f.bar;
    const crown = centre.y + f.bowlH - f.upright;
    const deep = f.half * 2 * 0.6 * opening;
    /*
     * But never so low that the tail shuts the aperture under the bar: that
     * keeps a quarter of a stem, and more where the tail ends in a flare,
     * which stands up further into it.
     */
    const below = f.half * 2 * opening * (f.style.parts.flare.spread > 0 ? 0.33 : 0.26);
    const floor = centre.y - f.bowlH + f.upright + barHalf + below;
    const eye = Math.max(Math.min(eyeOf(f, centre), crown - barHalf - deep), floor);
    const rise = Math.max(-0.85, Math.min(0.85, (eye - centre.y) / f.bowlH));
    // Where the bowl is an oval, the ray to the point on it at that height,
    // as it is drawn: a quarter circle's angle landed well under the bar.
    const oval = f.curve > 0 && !(f.superness > 0);
    /*
     * Wider and a little lighter at a black weight, so the eye stays open:
     * see `heaviness`. Lowering the bar instead cut the tail short.
     */
    const heavy = heaviness(f);
    /*
     * On a face whose bar runs flush out of its bowl, only past a Black: to
     * a Black the contrast the pen takes on keeps the eye open by itself, and
     * a bowl changed there moved where a break laid along the bar falls, so
     * that it sliced the bowl. Past it the eye closes without the help.
     */
    const light = bookish(f) ? heavy : Math.max(0, heavy - 1.1) * 2;
    const beltWidth = f.bowl + f.half * 0.3 * light;
    const opens =
      ((oval
        ? Math.atan2(rise * f.bowlH, beltWidth * Math.sqrt(1 - rise * rise))
        : Math.asin(rise)) *
        180) /
      Math.PI;
    const belt = bend(f, centre, f.bowlH, opens, opens + 300, beltWidth);
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
         *
         * And from the middle of the left wall rather than its inside edge,
         * where a square end against the curve folded the union: `wallAt`.
         */
        /*
         * And out to the bowl's outside edge on the right, cut upright there.
         * Stopped at the middle of the wall, the outer half of the wall under
         * the bar was left open and the bar's end stood in the aperture as a
         * spur -- at a black weight half a stem of it. A text e's bar runs
         * flush with the outside of the bowl, and the eye closes square.
         */
        thin(
          f,
          straight(
            // The wall of the bowl as it is drawn, which a heavy weight
            // has widened: at the width the bowl would have had, the bar
            // stopped short of it and left a pinhole under its end.
            at(wallAt(f, centre, opens, blackness(f.style) > 0 ? beltWidth : undefined), eye),
            at(
              spineStart(belt).x +
                // The bowl's own pen, which is lighter than the stem's at a
                // heavy weight: to the stem's reach the bar stood out past it.
                f.reach(at(1, 0)) * (1 - 0.14 * light) * Math.cos((opens * Math.PI) / 180),
              eye,
            ),
          ),
          BUTT,
          { kind: "butt", level: true },
        ),
        lighter(ink(f, belt, BUTT, f.end), 1 - 0.14 * light),
      ],
      true,
    );
  },

  f: (style) => {
    const f = frame(style);
    // Big enough to read as a hook rather than a curl, small enough that the
    // letter does not turn into a walking stick.
    const radius = Math.max(roundHalf(f) * 0.6, f.least);
    // How far left of the stem the bar reaches, which is also how far in from
    // the sidebearing the stem stands: the bar is this letter's left edge.
    // At least half a stem clear of the stem's own edge: at a black weight
    // the bar reached six units past it, and stood out as a notch rather than
    // as a bar.
    const left = Math.max(roundHalf(f) * 0.36, f.least, f.half * 1.5);
    const stem = f.edge + left;
    const top = f.crest(f.asc) - radius;
    return finish(f, [
      /*
       * Straight up, then a quarter turn right into the hook.
       *
       * Right, because that is the only side an f's hook has ever been on.
       * Turned the other way -- which is how this was written -- every scrap
       * of ink above the bar sat to the left of the stem, where a t has
       * nothing and an f has the whole of what tells them apart. `fox` set
       * as `tox` on all sixteen faces.
       */
      ink(
        f,
        chain(
          straight(at(stem, 0), at(stem, top)),
          // Set down by the pen's own reach across a horizontal, so the top
          // of the hook lands on the ascender rather than setting off from it.
          turn(at(stem + radius, top), radius, 180, 88),
        ),
        f.end,
        f.end,
      ),
      // Reaching further right than left, as the t's bar does, so the two are
      // told apart by more than the hook at the sizes text is set at.
      crossbar(f, stem - left, stem + roundHalf(f) * 0.57),
    ]);
  },

  g: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl;
    const radius = Math.max(f.arch * 0.7, f.least);
    /*
     * And set a little loose, like the `a` and the `d`: this letter is a bowl
     * with a tail hanging under the letter beside it rather than beside it, so
     * spacing it off its own width alone leaves it tight. The reference takes
     * 1.07 of its own `o`'s advance for a `g`. See `air`.
     */
    return {
      ...finish(f, [
        ink(f, ring(f, centre, f.bowl, f.bowlH)),
        // Down the right and round into the tail, which is one stroke so the
        // descender cannot part company with the bowl.
        ink(
          f,
          chain(
            straight(at(stem, f.x), at(stem, f.dip(f.desc) + radius)),
            // Set up by the pen's own reach across a horizontal, so the ink
            // stops at the descender rather than starting there.
            turn(at(stem - radius, f.dip(f.desc) + radius), radius, 0, -95),
          ),
          f.end,
          f.end,
        ),
      ]),
      air: 0.2,
    };
  },

  h: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
      arch(f, stem, f.x),
    ]);
  },

  i: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(f, [ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end), tittle(f, stem)]);
  },

  /*
   * The i and j without their dots.
   *
   * An accent over an i does not stack on the dot, it takes the dot's place --
   * two marks above one letter is not what `í` is. So the dotted letter cannot
   * be the base for the accented one, and every font that has an accented i
   * carries these for exactly this reason.
   */
  dotlessi: (style) => {
    const f = frame(style);
    return finish(f, [ink(f, straight(at(f.edge, 0), at(f.edge, f.x)), f.end, f.end)]);
  },

  j: (style) => {
    const f = frame(style);
    const radius = Math.max(f.arch * 0.62, f.least);
    const stem = f.edge + radius;
    return finish(f, [
      ink(
        f,
        chain(
          straight(at(stem, f.x), at(stem, f.dip(f.desc) + radius)),
          // Set up by the pen's own reach across a horizontal, so the ink
          // stops at the descender rather than starting there.
          turn(at(stem - radius, f.dip(f.desc) + radius), radius, 0, -95),
        ),
        f.end,
        f.end,
      ),
      tittle(f, stem),
    ]);
  },

  dotlessj: (style) => {
    const f = frame(style);
    const radius = Math.max(f.arch * 0.62, f.least);
    const stem = f.edge + radius;
    return finish(f, [
      ink(
        f,
        chain(
          straight(at(stem, f.x), at(stem, f.dip(f.desc) + radius)),
          turn(at(stem - radius, f.dip(f.desc) + radius), radius, 0, -95),
        ),
        f.end,
        f.end,
      ),
    ]);
  },

  k: (style) => {
    const f = frame(style);
    const stem = f.edge;
    const reach = stem + f.arch * 1.7;
    const waist = f.x * 0.42;
    const arm = at(reach, f.x);
    const leg = at(reach, 0);
    const meet = junction(f, arm, stem, waist, leg);
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
      ink(f, chain(straight(arm, meet), straight(meet, leg)), f.end, f.end),
    ]);
  },

  l: (style) => {
    const f = frame(style);
    return finish(f, [ink(f, straight(at(f.edge, 0), at(f.edge, f.asc)), f.end, f.end)]);
  },

  m: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.crown)), f.end, f.end),
      arch(f, stem, f.x),
      arch(f, stem + f.arch * 2, f.x),
    ]);
  },

  n: (style) => {
    const f = frame(style);
    const stem = f.edge;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.crown)), f.end, f.end),
      arch(f, stem, f.x),
    ]);
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
      true,
    );
  },

  q: (style) => {
    const f = frame(style);
    const centre = at(f.edge + f.bowl, f.x / 2);
    const stem = centre.x + f.bowl;
    return finish(f, [
      ink(f, ring(f, centre, f.bowl, f.bowlH)),
      ink(f, straight(at(stem, f.desc), at(stem, f.x)), f.end, f.end),
    ]);
  },

  r: (style) => {
    const f = frame(style);
    const stem = f.edge;
    /*
     * The same shoulder an n has, stopped where the n would have come down: an
     * r is an n that gave up.
     *
     * Written as a half circle of the arch's own width it was not the same
     * shoulder at all. A half circle stands as tall as it is half-wide, so on
     * any face whose rhythm is wider than half its x-height the r rose past
     * the n beside it -- seventy units past, on the plainest of the bases --
     * and, being the only curve on a line of its own, it read as a fault in
     * the x-height rather than a fault in the r.
     */
    const reach = f.arch;
    const radius = shoulderRadius(f, f.x);
    const crest = Math.max(f.crest(f.x), radius);
    const landing = stem + Math.max(reach, radius * 2);
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
      ink(
        f,
        chain(
          turn(at(stem + radius, crest - radius), radius, 180, 90),
          straight(at(stem + radius, crest), at(landing - radius, crest)),
          // Carried a little past the top, so the arm droops rather than
          // stopping dead level, which is what tells an r from a bracket.
          turn(at(landing - radius, crest - radius), radius, 90, 55),
        ),
        BUTT,
        f.end,
      ),
    ]);
  },

  s: (style) => {
    const f = frame(style);
    const { stroke } = spine(f, f.x, f.edge);
    /*
     * And set loose. An `s` is built from half a bowl at each end, so it is
     * about seven tenths of an `o` across -- which is what the reference's is
     * too -- and spacing it off that width alone made it seven tenths of an
     * `o`'s advance where the reference gives it ninety-five hundredths. See
     * `air`.
     */
    return { ...finish(f, [stroke], true), air: 1.05 };
  },

  t: (style) => {
    const f = frame(style);
    const radius = Math.max(roundHalf(f) * 0.34, f.least);
    const reach = tReach(f);
    const stem = tStem(f);
    return finish(f, [
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
          straight(at(stem, f.asc * 0.78), at(stem, f.dip(0) + radius)),
          turn(at(stem + radius, f.dip(0) + radius), radius, 180, 270),
        ),
        /*
         * Cut off at the top rather than capped. The top of a t is not the end
         * of a stem that stands on a line, it is the stroke stopping short of
         * the ascender, and no text face puts a serif there: given one, the
         * bar across its top sat just over the crossbar and the t read as a
         * double cross.
         */
        f.plain,
        f.end,
      ),
      crossbar(f, stem - reach * 0.7, stem + reach),
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
    return finish(f, [ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end)]);
  },

  w: (style) => {
    const f = frame(style);
    /*
     * From the round letters (`roundHalf`) rather than the arch. A w is two vees, and a vee's width
     * is not the rhythm of an n: tied to the shoulder's reach it lost a
     * quarter of itself when a text face tightened its n, and set 0.77 of the
     * width of Lora's. Never narrower than it was, though: on a face whose
     * bowls are small against its pen the arch is the wider of the two.
     */
    const half = Math.max(roundHalf(f) * 0.57, f.arch * 0.68);
    const left = f.edge;
    const top = f.x;
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

  x: (style) => {
    const f = frame(style);
    const width = f.arch * 1.7;
    const left = f.edge;
    return finish(f, [
      ink(f, straight(at(left, f.x), at(left + width, 0)), f.end, f.end),
      ink(f, straight(at(left, 0), at(left + width, f.x)), f.end, f.end),
    ]);
  },

  y: (style) => {
    const f = frame(style);
    const half = f.arch * 0.92;
    const left = f.edge;
    const middle = left + half;
    /*
     * The left diagonal stops on the tail's own spine a little above the
     * baseline, so both corners of its square end are buried in the tail.
     * Carried on past the crossing instead, the corner on its right stood out
     * of the tail's right side as a spur; stopped on the line, it would be cut
     * level along it and stand out as a ledge.
     */
    const lift = f.half * 0.5;
    return finish(f, [
      ink(f, straight(at(left, f.x), at(middle + (half * lift) / f.x, lift)), f.end, BUTT),
      /*
       * One straight run: down from the x-height, through the apex the left
       * diagonal ends at, and on into the descender at the angle it arrived
       * on. That is what it always meant to be, and it was not: reckoned
       * from the wrong slope it reached the baseline four tenths of an arm
       * to the right of the apex, so the two diagonals of the vee crossed
       * nowhere near each other.
       *
       * A fat enough pen covered the miss and nothing showed. Measured
       * across the sixteen faces the arms overlapped by four units on
       * Geometric, five on Marker, six on Serif and seven on Sans -- held
       * together by luck -- while Fairground missed by thirty-five and drew
       * a broken vee, and Wavy missed by forty-four and lost its left
       * diagonal altogether when the letter was fused.
       */
      ink(
        f,
        straight(at(middle + half, f.x), at(middle + (half * f.desc) / f.x, f.desc)),
        f.end,
        // The tail is cut, not capped: a slab under a descender is a foot on
        // a stroke that is not standing on anything.
        f.plain,
      ),
    ]);
  },

  z: (style) => {
    const f = frame(style);
    // From the round letters, as the w is and for the same reason.
    const width = Math.max(roundHalf(f) * 1.36, f.arch * 1.6);
    const left = f.edge;
    /*
     * The two arms hang from the x-height and stand on the baseline, and the
     * corners they turn into are given the point the ink should reach.
     *
     * Both halves of that matter. Written with the arms on the lines the z sat
     * half a pen low and half a pen high at once; written with the arms right
     * but the corners still at their own vertices, the far end of each arm
     * would slope away from the line it started level with.
     */
    const [above, below] = arms(f, f.x);
    const start = at(left, above);
    const end = at(left + width, below);
    const [across, back] = corners(f, [start, at(left + width, f.x), at(left, 0), end]);
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
