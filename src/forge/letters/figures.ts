/**
 * The figures, nought to nine.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from, moved
 * here unchanged so the recipes can be read a group at a time. Only that file
 * imports it; see it for what a recipe is and how the table is used.
 */

import { contoursBounds } from "@/font/geometry";
import type { Vec2 } from "@/font/types";
import { spineEnd } from "../shapes";
import { stemBlack, type Style } from "../style";
import { penReach, reachAlong, sweep } from "../sweep";
import type { Stroke } from "../types";
import {
  drops,
  arm,
  at,
  bend,
  bendWidth,
  penHeld,
  widthShare,
  BUTT,
  chain,
  corner,
  figureWidth,
  heavyFigure,
  finish,
  frame,
  ink,
  type LetterName,
  type Recipe,
  ring,
  straight,
  thin,
  turn,
  headingAt,
  hookFrom,
  towards,
} from "./common";

export const FIGURE_RECIPES: Record<LetterName, (style: Style) => Recipe> = {
  // --- figures -----------------------------------------------------------

  zero: (style) => {
    const f = frame(style);
    const half = figureWidth(f) / 2;
    const centre = at(f.edge + half, f.cap / 2);
    return finish(f, [ink(f, ring(f, centre, half, f.capBowlH))], true);
  },

  one: (style) => {
    const f = frame(style);
    /*
     * The flag, which is what stops a one reading as a lowercase l.
     *
     * Measured out from the stem's edge rather than from its spine, and at the
     * same slope: at a black weight the stem swallowed half of a flag laid out
     * from the middle of it, and what was left was a stub.
     */
    const top = f.hangs(f.cap);
    const out = Math.max(figureWidth(f) * 0.42, figureWidth(f) * 0.3 + f.half * 1.1);
    const fall = ((top - f.cap * 0.78) * out) / (figureWidth(f) * 0.42);
    const middle = f.edge + figureWidth(f) * 0.5;
    const strokes = (stem: number) => [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, BUTT),
      ink(f, straight(at(stem - out, top - fall), at(stem, top)), f.end, BUTT),
    ];
    /*
     * The stem on the middle of the column -- or, where the face asks
     * (`metrics.oneCentred`), the ink, on the nought's: from the flag's cut
     * end on the left to the stem's side on the right. Both measured off the
     * swept strokes, since how far the flag's cut end reaches past its spine
     * is the terminal's to say, and a Condensed's nought is let out either
     * side of the column it is drawn in (`penHeld`).
     */
    if (!f.style.metrics.oneCentred) return finish(f, strokes(middle));
    const inked = (made: Stroke[]) => contoursBounds(made.flatMap((stroke) => sweep(stroke)));
    const nought = inked(FIGURE_RECIPES.zero(style).strokes);
    const box = inked(finish(f, strokes(middle)).strokes);
    return finish(f, strokes(middle + (nought.xMin + nought.xMax - box.xMin - box.xMax) / 2));
  },

  two: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    /*
     * As tall as the regular's bowl and only wider at a heavy weight: grown
     * round with the figure's width, the bowl took the whole height and left
     * the diagonal a stub, and the two read as an omega.
     */
    const grown = heavyFigure(f) / 2;
    // And at a heavy weight no more than three tenths of the height, so the
    // diagonal under it has the length to read as one.
    /*
     * And no taller for a wider face: the bowl is already drawn wider by the
     * face's width (see `bendWidth`), and sized off the wider figure as well
     * it grew both ways, stood taller, and left an Expanded's diagonal lying
     * nearly flat across its own foot.
     */
    const drawn = (width / 2 - grown) / Math.max(widthShare(f.style), 1);
    const low = Math.min(drawn, (f.crest(f.cap) - f.dip(0)) * 0.3);
    /*
     * And held there as well on a face whose regular already lays its
     * horizontals on heavy, as a pen turned on its side does: at the
     * Fairground's regular a bowl the whole width round left the diagonal so
     * shallow that it lay on the foot as one black wedge.
     */
    const heavy = Math.max(f.gain / (f.x * 0.05), (f.upright / f.x - 0.105) / 0.02);
    const radius = Math.max(drawn + (low - drawn) * Math.min(1, Math.max(heavy, 0)), f.least);
    const wide = bendWidth(f, radius) + grown;
    const centre = at(left + radius + grown, f.crest(f.cap) - radius);
    /*
     * Over the top, then a straight run down to the baseline, then out along it.
     *
     * The bowl and the diagonal one run, and the foot a stroke of its own.
     * Chaining works where the runs leave in the same direction they arrived,
     * so the bowl is carried round below until it does (see `miss`); the
     * foot meets the diagonal at a real corner and simply overlaps it.
     */
    /*
     * The diagonal runs from where the bowl leaves off down to the baseline,
     * cut level along it with its left corner on the foot's left end, and the
     * bowl is carried round exactly as far as it has to be to leave travelling
     * the diagonal's way.
     *
     * Aimed at the middle of the foot and cut square instead, at a black
     * weight the diagonal's end stood out under the foot's left end as a spur,
     * and the bowl and the diagonal met at an angle with a notch on the
     * outside of it.
     */
    const pen = penReach(style.pen);
    const toward = (from: Vec2): Vec2 => {
      // Where on the baseline the run lands so its left corner is on `left`:
      // half the width a band at this slant covers along the line.
      const d = { x: left - from.x, y: -from.y };
      const length = Math.hypot(d.x, d.y) || 1;
      const u = { x: d.x / length, y: d.y / length };
      const shift = reachAlong({ x: -u.y, y: u.x }, pen);
      return at(left + Math.abs(shift.x - (u.x * shift.y) / u.y), 0);
    };
    const miss = (angle: number): number => {
      const run = bend(f, centre, radius, hookFrom(f), angle, wide);
      const from = spineEnd(run);
      const heading = headingAt(run.segments[run.segments.length - 1], "end");
      const to = toward(from);
      return Math.abs(Math.atan2(to.y - from.y, to.x - from.x) - Math.atan2(heading.y, heading.x));
    };
    // Coarse, then to the degree about the best of it.
    let leaves = -22;
    let best = Infinity;
    const tryAt = (angle: number) => {
      const off = miss(angle);
      if (off < best) {
        best = off;
        leaves = angle;
      }
    };
    for (let angle = 5; angle >= -75; angle -= 5) tryAt(angle);
    const coarse = leaves;
    for (let angle = coarse + 4; angle >= coarse - 4; angle -= 1) tryAt(angle);
    const over = bend(f, centre, radius, hookFrom(f), leaves, wide);
    /*
     * The diagonal carried on out of the bowl as one run: the bowl is taken
     * round until it leaves travelling the diagonal's way, so the two meet
     * with no corner between them. Drawn as two strokes, the bowl's end was
     * cut square to a curve that was still turning and its corners stood
     * out either side of the diagonal as nicks, and on a pen held on its
     * side the seam between them showed as a hairline.
     */
    const joins = spineEnd(over);
    const lands = toward(joins);
    const way = towards(lands, joins);
    // The top of the foot's ink: it sits on the line, a bar thick.
    const footTop = f.sits(0, f.bar) * 2;
    /*
     * Where the diagonal's left edge really is at a height, off the pen's own
     * reach across the run: a pen held on its side reaches up as well as
     * across, and reckoned as a round pen's the foot on the Fairground began
     * left of the diagonal as a square step.
     */
    const edges = (y: number): number[] =>
      [1, -1].map((side) => {
        const across = reachAlong({ x: -way.y * side, y: way.x * side }, pen);
        return lands.x + across.x + ((y - lands.y - across.y) * way.x) / Math.max(way.y, 1e-6);
      });
    /*
     * And no further in than the diagonal's right edge on the baseline, or the
     * two met only at a point there and a notch of paper came between them.
     * Between the two, the foot starts inside the diagonal top and bottom.
     */
    const heel = Math.min(...edges(footTop));
    const toe = Math.max(...edges(0));
    const footFrom = heel < toe ? (heel + toe) / 2 : heel + 2;
    return finish(f, [
      ink(f, chain(over, straight(joins, lands)), f.end, {
        kind: "butt",
        level: true,
      }),
      /*
       * From where the diagonal's left edge crosses the top of the foot, so
       * the two meet with no step: the letter's corner is the diagonal's own,
       * on the baseline. Started half a pen in, the diagonal's corner came out
       * under and left of the foot's end as a barb; started at the corner, the
       * foot's end stood out left of a heavy diagonal as a square step.
       */
      arm(f, footFrom, left + width, f.sits(0, f.bar)),
    ]);
  },

  three: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const top = f.crest(f.cap);
    const base = f.dip(0);
    const radius = Math.max((top - base) / 4, f.least);
    // Wider, not taller, at a heavy weight, or the two counters are slits.
    const grown = heavyFigure(f) / 2;
    const wide = bendWidth(f, radius) + grown;
    const middle = left + width - radius - grown;
    const tongue = radius * 0.3;
    return finish(
      f,
      [
        /*
         * Each bowl carried a little way on to the left along the waist, so
         * the two meet in a short tongue rather than in a point. Meeting where
         * each turned, the two cut ends stood at an angle to each other and
         * left a notch on the left of the waist, a deep one at a black weight.
         */
        ink(
          f,
          chain(
            bend(f, at(middle, top - radius), radius, 160, -90, wide),
            straight(at(middle, top - radius * 2), at(middle - tongue, top - radius * 2)),
          ),
          f.end,
          BUTT,
        ),
        ink(
          f,
          chain(
            straight(at(middle - tongue, base + radius * 2), at(middle, base + radius * 2)),
            bend(f, at(middle, base + radius), radius, 90, -160, wide),
          ),
          BUTT,
          f.end,
        ),
      ],
      true,
    );
  },

  four: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    /*
     * Wide enough at a heavy weight for a counter between the diagonal and
     * the stem, and the bar carried out past the stem by more than a hair:
     * held to the regular's proportions, a black four had its counter closed
     * to a point and its bar ending flush with the stem.
     */
    /*
     * And further out again from a Bold on, on a face that keeps its
     * counters open at a heavy weight (`metrics.heavyOpen`): at four and a
     * fifth half-pens a Black Geometric's counter was a pinhole.
     */
    const open = Math.min(1.5, Math.max(0, (stemBlack(f.style) - 0.5) / 0.4));
    const stem = left + Math.max(width * 0.72, f.half * (4.2 + 1.2 * open));
    const bar = f.cap * 0.28;
    const top = at(stem, f.hangs(f.cap));
    const reach = stem + Math.max(left + width - stem, f.half * 1.7);
    const guess = corner(f, top, at(left, bar), at(reach, bar));
    // The bar level: from wherever the corner came to rest, straight across.
    const meet = corner(f, top, at(left, bar), at(reach, guess.y));
    const end = at(reach, meet.y);
    /*
     * The diagonal starts where its upper edge runs out of the stem's top left
     * corner, so the two meet in a point on the cap line. Started on the stem's
     * middle it left the corner of its own square end standing out beside the
     * top of the stem as a flag, a big one at a black weight.
     */
    const heading = { x: meet.x - top.x, y: meet.y - top.y };
    const length = Math.hypot(heading.x, heading.y);
    const normal = { x: heading.y / length, y: -heading.x / length };
    const pen = penReach(style.pen);
    const edge = reachAlong(normal, pen);
    // The offset to the diagonal's upper edge, and the stem's half width.
    const up = edge.y > 0 ? edge : { x: -edge.x, y: -edge.y };
    const flank = Math.abs(reachAlong(at(1, 0), pen).x);
    const start = at(stem - flank - up.x, f.cap - up.y);
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      ink(f, chain(straight(start, meet), straight(meet, end)), BUTT, f.end),
    ]);
  },

  five: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const shoulder = f.cap * 0.56;
    const bar = thin(
      f,
      straight(at(left, f.hangs(f.cap, f.bar)), at(left + width, f.hangs(f.cap, f.bar))),
      f.end,
      f.end,
    );
    if (f.square < 0.01) {
      /*
       * The bowl leaves the foot of the stem rather than starting beside it.
       *
       * Begun at the top of its own circle a little right of the stem, the bowl
       * rose past where the stem stopped, and at a black weight the two met at
       * a corner with a notch cut into it. So the bowl begins where the stem
       * ends, travelling straight up out of it on a tighter turn that carries
       * it over into the bowl proper: the stem's end and the turn's start are
       * the same cut, level across the same pen, and the join is flush.
       *
       * The bowl is as tall as Lora's -- its top about three fifths of the way
       * up -- and never so tall that no counter is left under the bar.
       */
      const floor = f.dip(0);
      const ceiling = Math.min(
        f.cap * 0.6,
        f.cap - f.upright * f.bar * 2 - f.half * 0.6 - f.upright,
      );
      const radius = Math.max((ceiling - floor) / 2, f.least);
      const tight = Math.min(Math.max(radius * 0.6, f.least), radius);
      const centre = at(left + tight, floor + radius);
      const top = centre.y + radius;
      const joint = top - tight;
      return finish(f, [
        bar,
        ink(f, straight(at(left, f.cap), at(left, joint)), BUTT, BUTT),
        ink(
          f,
          chain(
            turn(at(left + tight, joint), tight, 180, 90),
            // Wider at a heavy weight, or the counter under the bar is a slit.
            bend(f, centre, radius, 90, -150, radius + heavyFigure(f) / 2),
          ),
          BUTT,
          f.end,
        ),
      ]);
    }
    /*
     * A squared bowl joins its stem the way the round one does: out of the
     * stem's own foot, on a tight turn, and along a flat into the bowl. Begun
     * a little left of the top of its own curve instead, the bowl's first cut
     * leaned with the curve: at a black weight it stood in the counter as a
     * notch, and at a text weight the stem stopped above the bowl altogether
     * and the five came in two pieces. The run keeps its flat at every weight,
     * a unit long where the turn takes the whole of it.
     */
    // As tall as the regular's at a heavy weight, and wider: see `heavyFigure`.
    const grown = heavyFigure(f) / 2;
    // And never so tall that it runs into the bar, as the round one is held.
    const under = f.cap - f.upright * f.bar * 2 - f.half * 0.6 - f.upright;
    const drawn = Math.min(shoulder, width / 2 - grown);
    const held = Math.min(drawn, (under - f.dip(0)) / 2);
    /*
     * Eased down to that height as the weight grows, but never past it at any
     * weight: on a pen held on its side the regular's own horizontals are the
     * heavy strokes, and a bowl as tall as the regular's rose into the bar and
     * filled the counter under it.
     */
    const radius = Math.max(
      Math.min(drawn + (held - drawn) * Math.min(1, f.gain / (f.x * 0.05)), held),
      f.least,
    );
    const centre = at(left + radius, f.dip(0) + radius);
    const top = centre.y + radius;
    const tight = Math.min(Math.max(radius * 0.6, f.least), radius * 0.98);
    const joint = top - tight;
    return finish(f, [
      bar,
      ink(f, straight(at(left, f.cap), at(left, joint)), BUTT, BUTT),
      ink(
        f,
        chain(
          turn(at(left + tight, joint), tight, 180, 90),
          straight(at(left + tight, top), at(Math.max(centre.x, left + tight + 1) + grown, top)),
          bend(
            f,
            at(Math.max(centre.x, left + tight + 1) + grown, centre.y),
            radius,
            90,
            -150,
            bendWidth(f, radius) + grown,
          ),
        ),
        BUTT,
        f.end,
      ),
    ]);
  },

  six: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    /*
     * Held so the bowl and the hood over it do not overlap: below that the run
     * joining them is written from a point to one above it and the letter is
     * drawn backwards through itself.
     */
    const grown = heavyFigure(f) / 2;
    /*
     * And short enough to leave a counter between the bowl and the hood that
     * runs over it: the two are the same height, one a span above the other,
     * and at a heavy weight on a face with tall figures the hood lay on the
     * bowl's back with a hairline between.
     */
    const span = f.crest(f.cap) - f.dip(0);
    const round = Math.max(Math.min(width / 2 - grown, span / 2), f.least);
    const room = Math.min(round, (span - f.upright * 2 - f.half * 0.9) / 2);
    // Though never so short that its own counter closes, which on a pen held
    // on its side -- thick across the horizontals -- is the nearer danger.
    const floor = Math.min(round, f.upright + f.half * 0.6);
    /*
     * Eased in with the weight, but held to the room at every weight: on a pen
     * held on its side the regular's own horizontals are the heavy strokes,
     * and at the Fairground's regular the hood lay on the bowl as one wedge.
     */
    const radius = Math.max(
      Math.min(
        round + (Math.max(room, floor) - round) * Math.min(1, f.gain / (f.x * 0.05)),
        Math.max(room, floor),
      ),
      f.least,
    );
    // Wider rather than taller at a heavy weight: see `heavyFigure`.
    const wide = bendWidth(f, round) + grown;
    const centre = at(left + round + grown, f.dip(0) + radius);
    const hood = Math.max(f.crest(f.cap) - radius, centre.y);
    return finish(
      f,
      [
        ink(f, ring(f, centre, wide, radius)),
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
            // Stopped further round on a face that hangs a drop there, so the
            // drop hangs at the top right, not down into the counter.
            bend(f, at(centre.x, hood), radius, drops(f) ? SIX_DROP : 60, 180, wide),
            straight(at(centre.x - wide, hood), at(centre.x - wide, centre.y)),
          ),
          f.end,
          BUTT,
        ),
      ],
      true,
    );
  },

  seven: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const start = at(left, f.hangs(f.cap));
    const end = at(left + width * 0.28, 0);
    const meet = at(corner(f, start, at(left + width, f.cap), end).x, start.y);
    return finish(f, [ink(f, chain(straight(start, meet), straight(meet, end)), f.end, f.end)]);
  },

  eight: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    // Where the two rings meet, with each of them filling what is left between
    // that and the line its own half of the figure has to reach.
    const waist = f.cap * 0.56;
    const upper = Math.max((f.crest(f.cap) - waist) / 2, f.least);
    const lower = Math.max((waist - f.dip(0)) / 2, f.least);
    // Both rings wider at a heavy weight, or their counters are slits; and
    // narrower in their counters only on a Condensed (`penHeld`), where the
    // Ribbon's upper one shut.
    const grown = heavyFigure(f) / 2 + penHeld(f) / 0.9;
    return finish(
      f,
      [
        ink(
          f,
          ring(
            f,
            at(left + width / 2, f.crest(f.cap) - upper),
            bendWidth(f, upper) + grown * 0.9,
            upper,
          ),
        ),
        ink(f, ring(f, at(left + width / 2, f.dip(0) + lower), bendWidth(f, lower) + grown, lower)),
      ],
      true,
    );
  },

  nine: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const grown = heavyFigure(f) / 2;
    /*
     * And short enough to leave a counter between the bowl and the hood that
     * runs over it: the two are the same height, one a span above the other,
     * and at a heavy weight on a face with tall figures the hood lay on the
     * bowl's back with a hairline between.
     */
    const span = f.crest(f.cap) - f.dip(0);
    const round = Math.max(Math.min(width / 2 - grown, span / 2), f.least);
    const room = Math.min(round, (span - f.upright * 2 - f.half * 0.9) / 2);
    // Though never so short that its own counter closes, which on a pen held
    // on its side -- thick across the horizontals -- is the nearer danger.
    const floor = Math.min(round, f.upright + f.half * 0.6);
    /*
     * Eased in with the weight, but held to the room at every weight: on a pen
     * held on its side the regular's own horizontals are the heavy strokes,
     * and at the Fairground's regular the hood lay on the bowl as one wedge.
     */
    const radius = Math.max(
      Math.min(
        round + (Math.max(room, floor) - round) * Math.min(1, f.gain / (f.x * 0.05)),
        Math.max(room, floor),
      ),
      f.least,
    );
    const wide = bendWidth(f, round) + grown;
    const centre = at(left + round + grown, f.crest(f.cap) - radius);
    const foot = Math.min(f.dip(0) + radius, centre.y);
    return finish(
      f,
      [
        ink(f, ring(f, centre, wide, radius)),
        // The mirror of a six: down the right from the bowl, then round the
        // bottom and away.
        ink(
          f,
          chain(
            straight(at(centre.x + wide, centre.y), at(centre.x + wide, foot)),
            // And carried further round where it ends in a drop, which then
            // sits up off the line clear of the bowl, as Lora's does.
            bend(f, at(centre.x, foot), radius, 0, drops(f) ? NINE_DROP : -120, wide),
          ),
          BUTT,
          f.end,
        ),
      ],
      true,
    );
  },
};

/** Where a six's hood starts, and a nine's tail stops, on a face whose figures end in drops. */
const SIX_DROP = 35;
const NINE_DROP = -145;
