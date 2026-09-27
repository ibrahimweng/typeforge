/**
 * The figures, nought to nine.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from, moved
 * here unchanged so the recipes can be read a group at a time. Only that file
 * imports it; see it for what a recipe is and how the table is used.
 */

import type { Vec2 } from "@/font/types";
import { spineEnd } from "../shapes";
import type { Style } from "../style";
import { penReach, reachAlong } from "../sweep";
import {
  arm,
  at,
  bend,
  bendWidth,
  BUTT,
  chain,
  corner,
  figureWidth,
  finish,
  frame,
  ink,
  type LetterName,
  type Recipe,
  ring,
  straight,
  thin,
  headingAt,
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
    const stem = f.edge + figureWidth(f) * 0.5;
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, BUTT),
      // The flag, which is what stops a one reading as a lowercase l.
      ink(
        f,
        straight(at(stem - figureWidth(f) * 0.42, f.cap * 0.78), at(stem, f.hangs(f.cap))),
        f.end,
        BUTT,
      ),
    ]);
  },

  two: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const radius = Math.max(width / 2, f.least);
    const centre = at(left + radius, f.crest(f.cap) - radius);
    /*
     * Over the top, then a straight run down to the baseline, then out along it.
     *
     * Three strokes rather than one chain. Chaining works where the runs leave
     * in the same direction they arrived -- an f's hook, a u's bowl -- because
     * then the two offsets meet. Here the arc comes down to the right and the
     * diagonal sets off down to the left, and offsetting round a corner that
     * sharp sends the inner side through itself. Left as separate strokes they
     * simply overlap, which the letter is full of anyway.
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
      const run = bend(f, centre, radius, 190, angle);
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
    const over = bend(f, centre, radius, 190, leaves);
    return finish(f, [
      ink(f, over, f.end, BUTT),
      ink(f, straight(spineEnd(over), toward(spineEnd(over))), BUTT, {
        kind: "butt",
        level: true,
      }),
      // Started inside the diagonal's foot, so its own cut end is buried.
      arm(f, left + f.half, left + width, f.sits(0, f.bar)),
    ]);
  },

  three: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const top = f.crest(f.cap);
    const base = f.dip(0);
    const radius = Math.max((top - base) / 4, f.least);
    const middle = left + width - radius;
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
            bend(f, at(middle, top - radius), radius, 160, -90),
            straight(at(middle, top - radius * 2), at(middle - tongue, top - radius * 2)),
          ),
          f.end,
          BUTT,
        ),
        ink(
          f,
          chain(
            straight(at(middle - tongue, base + radius * 2), at(middle, base + radius * 2)),
            bend(f, at(middle, base + radius), radius, 90, -160),
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
    const stem = left + Math.max(width * 0.72, f.half * 4.2);
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
    const radius = Math.max(Math.min(shoulder, width / 2), f.least);
    return finish(f, [
      thin(
        f,
        straight(at(left, f.hangs(f.cap, f.bar)), at(left + width, f.hangs(f.cap, f.bar))),
        f.end,
        f.end,
      ),
      ink(f, straight(at(left, f.cap), at(left, shoulder)), BUTT, BUTT),
      ink(f, bend(f, at(left + radius, f.dip(0) + radius), radius, 100, -150), BUTT, f.end),
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
    const radius = Math.max(Math.min(width / 2, (f.crest(f.cap) - f.dip(0)) / 2), f.least);
    const centre = at(left + radius, f.dip(0) + radius);
    const hood = Math.max(f.crest(f.cap) - radius, centre.y);
    return finish(
      f,
      [
        ink(f, ring(f, centre, bendWidth(f, radius), radius)),
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
            bend(f, at(centre.x, hood), radius, 60, 180),
            straight(
              at(centre.x - bendWidth(f, radius), hood),
              at(centre.x - bendWidth(f, radius), centre.y),
            ),
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
    return finish(
      f,
      [
        ink(f, ring(f, at(left + width / 2, f.crest(f.cap) - upper), bendWidth(f, upper), upper)),
        ink(f, ring(f, at(left + width / 2, f.dip(0) + lower), bendWidth(f, lower), lower)),
      ],
      true,
    );
  },

  nine: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const radius = Math.max(Math.min(width / 2, (f.crest(f.cap) - f.dip(0)) / 2), f.least);
    const centre = at(left + radius, f.crest(f.cap) - radius);
    const foot = Math.min(f.dip(0) + radius, centre.y);
    return finish(
      f,
      [
        ink(f, ring(f, centre, bendWidth(f, radius), radius)),
        // The mirror of a six: down the right from the bowl, then round the
        // bottom and away.
        ink(
          f,
          chain(
            straight(
              at(centre.x + bendWidth(f, radius), centre.y),
              at(centre.x + bendWidth(f, radius), foot),
            ),
            bend(f, at(centre.x, foot), radius, 0, -120),
          ),
          BUTT,
          f.end,
        ),
      ],
      true,
    );
  },
};
