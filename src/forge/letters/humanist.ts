/**
 * The old-style text face's own letters.
 *
 * Most of the alphabet a text serif shares with every other face here: the n,
 * the o and the H are the same skeletons, with contrast on the pen, serifs on
 * the stems and drops on the curved ends. A handful it draws its own way, and
 * they are much of what makes a face like Lora read as a book face rather than
 * as a sans with serifs put on: the e whose eye sits high with a small counter
 * over a long aperture, the u whose right stem runs on down to the line, the t
 * standing well over the x-height under a wedge, the U whose right side is a
 * hairline, the M whose stems splay and whose vertex reaches the line.
 *
 * Measured off Lora Regular and written in terms of the frame, so each follows
 * the pen, the width and the proportions like every other letter, and each is
 * the same pieces at every weight, so a weight axis can run through it.
 */

import type { Style } from "../style";
import { LETTERS } from "../letters";
import type { Stroke } from "../types";
import {
  at,
  bowed,
  BUTT,
  chain,
  crested,
  crossbar,
  finish,
  frame,
  inherit,
  ink,
  lighter,
  type Recipe,
  ring,
  roundHalf,
  shoulderRadius,
  straight,
  stub,
  through,
  turn,
  tReach,
  tStem,
  uses,
} from "./common";

/** Where Lora's e has its bar, against where its H has its: 0.62 of the x-height to 0.51. */
const EYE = 0.62 / 0.52;

/**
 * The e with its eye high, as an old-style face draws it: the bar at six
 * tenths of the x-height, a small counter over it and a long open belly
 * under it. The crossbar control still moves it, from there.
 */
export function humanistE(style: Style): Recipe {
  const { crossbar: bar } = style.parts;
  const raised = {
    ...style,
    parts: { ...style.parts, crossbar: { ...bar, height: Math.min(0.72, bar.height * EYE) } },
  };
  return swollen(raised, LETTERS.e(raised));
}

/**
 * The u as a turned n with its right stem carried on down to the line: the
 * left stem comes down, turns along the foot and rises into the right stem,
 * which stands from the x-height to the baseline on its own serifs.
 */
export function humanistU(style: Style): Recipe {
  const f = frame(style);
  uses("shoulder");
  const left = f.edge;
  const height = crested(f, f.x);
  const radius = Math.min(shoulderRadius(f, height), Math.max(f.arch, f.half));
  const right = left + f.arch * 2;
  const floor = Math.min(f.sits(0) - f.over, height - radius);
  /*
   * The bowl leaves the right stem well down it, and runs into it rather
   * than up it: carried on up to the x-height beside the stem, it stood
   * proud of the stem's head serif.
   */
  const joins = floor + radius * 1.35;
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(left, height), at(left, floor + radius)),
        turn(at(left + radius, floor + radius), radius, 180, 270),
        straight(at(left + radius, floor), at(right - radius, floor)),
        turn(at(right - radius, floor + radius), radius, 270, 360),
        straight(at(right, floor + radius), at(right, joins)),
      ),
      f.end,
      BUTT,
    ),
    ink(f, straight(at(right, 0), at(right, f.x)), f.end, f.end),
  ]);
}

/** Lora's t stands this far up the ascender. */
const T_TOP = 640 / 755;

/**
 * The t standing well over the x-height, its stem cut off under a wedge that
 * rises from the left end of the bar to the stem's head, as Lora's does.
 */
export function humanistT(style: Style): Recipe {
  const f = frame(style);
  const radius = Math.max(roundHalf(f) * 0.34, f.least);
  const reach = tReach(f);
  const stem = tStem(f);
  const top = Math.max(f.asc * T_TOP, f.x + f.half * 2);
  const bar = f.hangs(f.x, f.bar);
  const wedge: Stroke = lighter(
    ink(f, straight(at(stem - reach * 0.55, bar), at(stem - f.half * 0.2, top)), BUTT, f.plain),
    0.75,
  );
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, top), at(stem, f.dip(0) + radius)),
        turn(at(stem + radius, f.dip(0) + radius), radius, 180, 270),
      ),
      f.plain,
      f.end,
    ),
    wedge,
    crossbar(f, stem - reach * 0.7, stem + reach),
  ]);
}

/**
 * The U whose right side is a hairline: the left stem comes down heavy and
 * turns along the foot, and the right comes down light from its own serif
 * into the turn, as the pen leaves a U written in two strokes.
 */
export function humanistCapitalU(style: Style): Recipe {
  const f = frame(style);
  uses("shoulder");
  const half = (f.style.metrics.counterWidth + f.style.pen.weight) / 2;
  const reach = Math.max(half * f.style.metrics.width, f.least);
  const left = f.edge;
  const height = f.cap;
  const radius = Math.min(shoulderRadius(f, height), Math.max(reach, f.half));
  const right = left + reach * 2;
  const floor = Math.min(f.sits(0) - f.over, height - radius);
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(left, height), at(left, floor + radius)),
        turn(at(left + radius, floor + radius), radius, 180, 270),
        straight(at(left + radius, floor), at(right - radius + 1, floor)),
      ),
      f.end,
      BUTT,
    ),
    // From the foot of the turn, on a pen lighter across its uprights and as
    // heavy as the stem's across the foot, so the two meet without a step.
    hairlined(
      f,
      ink(
        f,
        chain(
          turn(at(right - radius, floor + radius), radius, 270, 360),
          straight(at(right, floor + radius), at(right, height)),
        ),
        BUTT,
        f.end,
      ),
      0.55,
    ),
  ]);
}

/**
 * A stroke whose uprights are this share of the stem's and whose horizontals
 * are as heavy as the stem pen's own: the right side of a U, or of a u's
 * bowl, which the pen draws on its way back up rather than down.
 */
function hairlined(f: ReturnType<typeof frame>, stroke: Stroke, share: number): Stroke {
  const pen = f.style.pen;
  const weight = pen.weight * share;
  const across = pen.weight * (1 - pen.contrast);
  const contrast = Math.max(0, Math.min(0.95, 1 - across / weight));
  return inherit(stroke, { ...stroke, pen: { ...pen, weight, contrast } });
}

/**
 * The Q whose tail leaves the foot of the bowl nearly level and falls away
 * to the right in one long reversed curve, ending level again under the
 * bowl's right side, as Lora's does -- the stroke a pen makes finishing the
 * letter rather than a stick laid across it.
 */
export function humanistCapitalQ(style: Style): Recipe {
  const f = frame(style);
  const centre = at(f.edge + f.capBowl, f.cap / 2);
  const from = at(centre.x - f.capBowl * 0.08, centre.y - f.capBowlH);
  const to = at(centre.x + f.capBowl * 1.12, -f.cap * TAIL_DEPTH);
  const middle = at((from.x + to.x) / 2, (from.y + to.y) / 2);
  return finish(
    f,
    [
      ink(f, ring(f, centre, f.capBowl, f.capBowlH)),
      // Lighter than the stem, as a stroke drawn on the way out is.
      lighter(
        ink(
          f,
          chain(bowed(f, from, middle, TAIL_BOW), bowed(f, middle, to, -TAIL_BOW)),
          BUTT,
          f.plain,
        ),
        0.72,
      ),
    ],
    true,
  );
}

/** How far under the line Lora's Q's tail reaches, against the cap height. */
const TAIL_DEPTH = 0.27;
/** How far each half of the tail bows off its chord. */
const TAIL_BOW = Number(process.env.TAILBOW ?? 0.14);

/**
 * The M with its stems splayed and its vertex on the line: the left stem a
 * hairline leaning out a little at its foot, the right a full stem leaning
 * out further, and the two diagonals meeting in a point on the baseline, as
 * Lora's M is drawn.
 */
export function humanistCapitalM(style: Style): Recipe {
  const f = frame(style);
  const left = f.edge;
  const width = Math.max(f.capBowl * 1.7, f.half * 7);
  const right = left + width;
  const middle = left + width * 0.49;
  const leanLeft = width * 0.018;
  const leanRight = width * 0.045;
  const topLeft = at(left + leanLeft, f.cap);
  const topRight = at(right - leanRight, f.cap);
  const into = stub(f);
  const points = through(f, [
    at(topLeft.x, f.cap - into),
    topLeft,
    at(middle, 0),
    topRight,
    at(topRight.x, f.cap - into),
  ]);
  return finish(f, [
    hairlined(f, ink(f, straight(at(left, 0), topLeft), f.end, f.end), 0.55),
    ink(f, straight(at(right, 0), topRight), f.end, f.end),
    ink(
      f,
      chain(
        straight(points[0], points[1]),
        straight(points[1], points[2]),
        straight(points[2], points[3]),
        straight(points[3], points[4]),
      ),
    ),
  ]);
}

/**
 * How much heavier Lora draws the sides of a round than a straight stem: 102
 * units across the o against 87 down the n, with the crown and the foot as
 * thin as ever.
 */
const SWELL = 102 / 87;

/** Whether a stroke is a bowl: a ring, or a run of curve turning most of the way round. */
function isBowl(stroke: Stroke): boolean {
  if (stroke.spine.closed) return true;
  let turned = 0;
  for (const segment of stroke.spine.segments) {
    if (segment.kind === "arc") turned += Math.abs(segment.endAngle - segment.startAngle);
  }
  return turned > Math.PI * 1.1;
}

/**
 * A letter whose bowls are drawn on a pen heavier across its uprights and as
 * heavy as ever across its horizontals: see `SWELL`.
 */
function swollen(style: Style, recipe: Recipe): Recipe {
  const f = frame(style);
  return {
    ...recipe,
    strokes: recipe.strokes.map((stroke) =>
      isBowl(stroke) ? hairlined(f, stroke, SWELL) : stroke,
    ),
  };
}

/** The o, the c, the O and the C, their sides swollen as Lora's are. */
export const humanistO = (style: Style): Recipe => swollen(style, LETTERS.o(style));
export const humanistC = (style: Style): Recipe => swollen(style, LETTERS.c(style));
export const humanistCapitalO = (style: Style): Recipe => swollen(style, LETTERS.O(style));
export const humanistCapitalC = (style: Style): Recipe => swollen(style, LETTERS.C(style));
export const humanistZero = (style: Style): Recipe => swollen(style, LETTERS.zero(style));

/**
 * The N with hairline stems and a heavy diagonal, as a broad nib draws it:
 * Lora's stems are 50 units across, its diagonal 95.
 */
export function humanistCapitalN(style: Style): Recipe {
  const f = frame(style);
  const recipe = LETTERS.N(style);
  return {
    ...recipe,
    strokes: recipe.strokes.map((stroke) => {
      const [only] = stroke.spine.segments;
      const upright =
        stroke.spine.segments.length === 1 &&
        only.kind === "line" &&
        Math.abs(only.to.x - only.from.x) < 1e-6;
      return upright ? hairlined(f, stroke, 0.58) : stroke;
    }),
  };
}
