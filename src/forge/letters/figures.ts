/**
 * The figures, nought to nine.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from, moved
 * here unchanged so the recipes can be read a group at a time. Only that file
 * imports it; see it for what a recipe is and how the table is used.
 */

import { spineEnd } from "../shapes";
import type { Style } from "../style";
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
    const leaves = -22;
    const over = bend(f, centre, radius, 190, leaves);
    return finish(f, [
      ink(f, over, f.end, BUTT),
      ink(f, straight(spineEnd(over), at(left, f.sits(0))), BUTT, BUTT),
      arm(f, left, left + width, f.sits(0, f.bar)),
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
    return finish(
      f,
      [
        ink(f, bend(f, at(middle, top - radius), radius, 160, -90), f.end, BUTT),
        ink(f, bend(f, at(middle, base + radius), radius, 90, -160), BUTT, f.end),
      ],
      true,
    );
  },

  four: (style) => {
    const f = frame(style);
    const width = figureWidth(f);
    const left = f.edge;
    const stem = left + width * 0.72;
    const bar = f.cap * 0.28;
    const top = at(stem, f.hangs(f.cap));
    const end = at(left + width, bar);
    const meet = corner(f, top, at(left, bar), end);
    return finish(f, [
      ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
      ink(f, chain(straight(top, meet), straight(meet, end)), BUTT, f.end),
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
