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

import { blackness, type Style } from "../style";
import { LETTERS } from "../letters";
import { bowlPoint } from "../shapes";
import { penReach, reachAlong } from "../sweep";
import type { Spine, Stroke, Terminal } from "../types";
import {
  at,
  bowed,
  BUTT,
  chain,
  crested,
  crossbar,
  finish,
  dot,
  figureWidth,
  LEVEL,
  stopRadius,
  frame,
  heaviness,
  inherit,
  ink,
  lighter,
  openBowl,
  type Recipe,
  ring,
  roundHalf,
  shoulderRadius,
  straight,
  stub,
  sweeps,
  thin,
  through,
  tittle,
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
  /*
   * Raised all the way to a Bold, as Lora's Bold still has it (at 0.6), and
   * back down to the face's own by a Black, whose eye over a bar that high
   * is a chink.
   */
  const black = blackness(style);
  const eye = 1 + (EYE - 1) * (black <= 0.5 ? 1 : Math.max(0, 1 - (black - 0.5) * 2));
  const raised = {
    ...style,
    parts: { ...style.parts, crossbar: { ...bar, height: Math.min(0.72, bar.height * eye) } },
  };
  const drawn = swollen(raised, LETTERS.e(raised));
  const [across, belt, ...rest] = drawn.strokes;
  if (!belt || belt.spine.closed) return drawn;
  /*
   * The bar carried out to the bowl's own widest, cut upright there, so the
   * right side of the letter is one edge down past the bar. Where the bar
   * sits under the bowl's middle -- a Black's does -- the bowl bulged a few
   * units past the bar's end, a step on the letter's outside. (Cutting the
   * bowl's start level instead moved the step along the weight axis and
   * took the e off it.)
   */
  const widest = Math.max(
    ...belt.spine.segments.flatMap((one) =>
      one.kind === "line"
        ? [one.from.x, one.to.x]
        : sweeps(one, 0)
          ? [one.centre.x + one.radius]
          : [],
    ),
  );
  const outside = widest + Math.abs(reachAlong(at(1, 0), penReach(belt.pen)).x);
  const [run] = across.spine.segments;
  const widened =
    run?.kind === "line" && outside > run.to.x && outside - run.to.x < belt.pen.weight * 0.3
      ? inherit(across, {
          ...across,
          spine: { ...across.spine, segments: [{ ...run, to: at(outside, run.to.y) }] },
        })
      : across;
  /*
   * And its foot cut plain across the stroke, as Lora's is -- or at the
   * terminal's angle, where the face asks for angled ends: the serif a curve
   * refuses was drawn there as a sliver, and at a Black it showed.
   */
  const { terminal } = style.parts;
  const foot: Terminal =
    terminal.kind === "angled" ? { kind: "angled", angle: terminal.angle } : BUTT;
  return {
    ...drawn,
    strokes: [widened, inherit(belt, { ...belt, end: foot }), ...rest],
  };
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
const T_TOP = 634 / 755;

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
    // heavy as the stem's across the foot, so the two meet without a step --
    // and laid back along the foot a little way, so they overlap there.
    hairlined(
      ink(
        f,
        chain(
          straight(at(right - radius * 1.3, floor), at(right - radius, floor)),
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
function hairlined(stroke: Stroke, share: number): Stroke {
  if (share === 1) return stroke;
  const pen = stroke.pen;
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
const TAIL_BOW = 0.14;

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
    hairlined(ink(f, straight(at(left, 0), topLeft), f.end, f.end), 0.55),
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
  // Not on a face whose runs undulate: a wave is ridden at the pen's own
  // width, and a heavier pen on it folded the o's inside.
  const { wave } = style.parts;
  if (wave.along !== "off" && wave.depth > 0) return recipe;
  /*
   * Less and less at a heavy weight: Lora's Bold draws its o's sides 147
   * across on a stem of 142, where its Regular's are 102 on 87.
   */
  const swell = 1 + (SWELL - 1) * Math.max(0, 1 - (blackness(style) / 0.47) * 0.8);
  return {
    ...recipe,
    strokes: recipe.strokes.map((stroke) => (isBowl(stroke) ? hairlined(stroke, swell) : stroke)),
  };
}

/** The o, the c, the O and the C, their sides swollen as Lora's are. */
export const humanistO = (style: Style): Recipe => swollen(style, LETTERS.o(style));
/**
 * The c, and at a heavy weight its ends kept round toward each other, as a
 * Black text face keeps its drop over its foot: held apart by the pen's
 * clearance as the plain c is, a Black c opened ninety degrees each side and
 * was a bracket with a ball on it.
 */
export function humanistC(style: Style): Recipe {
  const f = frame(style);
  const centre = at(f.edge + f.bowl, f.x / 2);
  const closer = -C_CLOSE * Math.min(1, heaviness(f));
  return swollen(
    style,
    finish(f, [openBowl(f, centre, f.bowl, f.bowlH, 55, 305, 0, closer)], true),
  );
}

/** How many half-pens nearer the c's two ends stand at a Black than the plain c's. */
const C_CLOSE = 0.9;
export const humanistCapitalO = (style: Style): Recipe => swollen(style, LETTERS.O(style));
export const humanistCapitalC = (style: Style): Recipe => swollen(style, LETTERS.C(style));
export const humanistZero = (style: Style): Recipe => swollen(style, LETTERS.zero(style));

/**
 * The N with hairline stems and a heavy diagonal, as a broad nib draws it:
 * Lora's stems are 50 units across, its diagonal 95.
 */
export function humanistCapitalN(style: Style): Recipe {
  const recipe = LETTERS.N(style);
  return {
    ...recipe,
    strokes: recipe.strokes.map((stroke) => {
      const [only] = stroke.spine.segments;
      const upright =
        stroke.spine.segments.length === 1 &&
        only.kind === "line" &&
        Math.abs(only.to.x - only.from.x) < 1e-6;
      return upright ? hairlined(stroke, 0.58) : stroke;
    }),
  };
}

/**
 * The binocular g as Lora draws it: a small bowl, a link that swings out to
 * the left under it and runs into the loop's top, a loop wider than the
 * bowl and light across its top, and an ear rising out of the bowl's top
 * right over the x-height and turning down into a drop.
 */
export function humanistG(style: Style): Recipe {
  const f = frame(style);
  const heavy = heaviness(f);
  const loopHalf = Math.max(f.bowl * 1.0, f.least * 1.4);
  const left = f.edge;
  const upperH = Math.max(f.x * 0.33, f.upright + f.half * 0.45, f.least);
  const upperW = Math.max(upperH * f.wide * 1.0, f.least);
  const upper = at(left + loopHalf * 0.12 + upperW, f.crest(f.x) - upperH);
  const bottom = f.dip(f.desc) - f.half * 0.45 * heavy;
  const underBowl = upper.y - upperH - f.upright * 2 - Math.max(f.half * 1.2, f.x * 0.06);
  const loopLeast = f.upright + Math.max(f.half * 0.45, f.x * 0.035);
  const top = Math.max(Math.min(f.x * 0.02, underBowl), bottom + loopLeast * 2);
  const loopH = Math.max((top - bottom) / 2, f.least);
  const loop = at(left + loopHalf, bottom + loopH);
  const roundness = 1 - f.square;
  const leaves = bowlPoint(upper, upperW, upperH, roundness, f.half, 250 - 25 * heavy, f.superness);
  const lands = bowlPoint(loop, loopHalf, loopH, roundness, f.half, 140, f.superness);
  // The ear, out of the bowl's top right, up over the x-height and down into its drop.
  const from = bowlPoint(upper, upperW, upperH, roundness, f.half, 22, f.superness);
  const earEnd = at(upper.x + upperW + Math.max(f.bowl * 0.45, f.half * 1.6), f.x + f.x * 0.1);
  return {
    ...finish(
      f,
      [
        lighter(ink(f, ring(f, upper, upperW, upperH)), 1 - 0.12 * heavy),
        lighter(ink(f, ring(f, loop, loopHalf, loopH)), 0.86 - 0.14 * heavy),
        lighter(
          // In two pieces at every weight, however little a heavy one turns.
          ink(
            f,
            inPieces(bowed(f, leaves, lands, Math.max(LINK_BOW - 0.12 * heavy, 0.06)), 2),
            BUTT,
            BUTT,
          ),
          0.45 + 0.15 * heavy,
        ),
        lighter(ink(f, inPieces(bowed(f, from, earEnd, EAR_BOW), 2), BUTT, f.end), 0.72),
      ],
      true,
    ),
    air: 0.2,
  };
}

/** How far the g's link swings out to the left of its chord. */
const LINK_BOW = 0.35;
/** How far the g's ear arches over its chord. */
const EAR_BOW = 0.45;

/**
 * The j with its tail carried round under the line and back up into a drop,
 * well out to the left, as Lora's is.
 */
export function humanistJ(style: Style): Recipe {
  const f = frame(style);
  const radius = Math.max(f.arch * 0.5, f.least);
  const stem = f.edge + radius * 1.35;
  const turnAt = f.dip(f.desc) + radius;
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, f.x), at(stem, turnAt)),
        turn(at(stem - radius, turnAt), radius, 0, -150),
      ),
      f.end,
      f.end,
    ),
    tittle(f, stem),
  ]);
}

/**
 * The five with a heavy flag and a hairline stem, as a broad nib held level
 * draws it: Lora's flag is 70 units deep and turns up at its end over the cap
 * line, and its stem is 45 across.
 */
export function humanistFive(style: Style): Recipe {
  const f = frame(style);
  const recipe = LETTERS.five(style);
  const [, stem, ...rest] = recipe.strokes;
  const width = figureWidth(f);
  const left = f.edge;
  // Lora's 70 on a stem of 87, and gaining only half what the stem does.
  const deep = Math.min(f.style.pen.weight, 87) * 0.8 + Math.max(0, f.style.pen.weight - 87) * 0.5;
  const y = f.cap - deep / 2;
  // Along the cap line and turning up at its end, over the line, in one run.
  const curl = deep * 0.9;
  const right = left + width * 0.8;
  const flag: Stroke = inherit(stem, {
    spine: chain(
      straight(at(left - f.half * 0.5, y), at(right - curl, y)),
      turn(at(right - curl, y + curl), curl, 270, 360),
    ),
    pen: { ...f.style.pen, contrast: 0, weight: deep },
    start: BUTT,
    end: BUTT,
  });
  return { ...recipe, strokes: [...finish(f, [flag]).strokes, hairlined(stem, 0.52), ...rest] };
}

/**
 * The hyphen as Lora sets it: 0.71 of an x-height long, eight tenths of a
 * stem deep, its middle at 0.64 of the x-height.
 */
export function humanistHyphen(style: Style): Recipe {
  const f = frame(style);
  const deep = f.style.pen.weight * 0.78;
  const y = f.x * 0.64;
  return finish(f, [
    {
      spine: straight(at(f.edge - f.half, y), at(f.edge - f.half + f.x * 0.71, y)),
      pen: { ...f.style.pen, contrast: 0, weight: deep },
      start: BUTT,
      end: BUTT,
    },
  ]);
}

/** The solidus as Lora draws it: from the descender to over the ascender, leaning well over. */
export function humanistSlash(style: Style): Recipe {
  const f = frame(style);
  const foot = f.desc - f.over;
  const head = f.asc + f.over * 0.3;
  const lean = (head - foot) * 0.53;
  return finish(f, [
    lighter(ink(f, straight(at(f.edge, foot), at(f.edge + lean, head)), LEVEL, LEVEL), 0.72),
  ]);
}

/**
 * The exclamation mark as a pen draws it: a wedge, round at its head and
 * a stem and a quarter across there, narrowing to half a stem at its foot.
 */
export function humanistExclam(style: Style): Recipe {
  const f = frame(style);
  const stop = stopRadius(f);
  const x = f.edge + f.half * 0.25;
  const head = f.crest(f.cap) + f.upright;
  // A stem and a quarter across at a text weight, and hardly more than the
  // stem at a Black, or the head is a ball over a sliver of a stem.
  const cap = f.half * (1.22 - 0.2 * Math.min(1, heaviness(f)));
  const foot = Math.max(f.cap * 0.33, stop * 2 + f.half * 0.9);
  const side = (dir: number): Stroke => {
    const drawn = ink(
      f,
      straight(at(x + dir * cap * 0.5, head - cap), at(x + dir * f.half * 0.04, foot)),
      BUTT,
      BUTT,
    );
    return inherit(drawn, {
      ...drawn,
      pen: { ...f.style.pen, contrast: 0, weight: cap },
    });
  };
  return finish(f, [side(-1), side(1), dot(f, at(x, head - cap), cap), dot(f, at(x, stop), stop)]);
}

/**
 * The A as a broad nib draws it: a hairline leg up the left and a full one
 * down the right, meeting in a point a little over the cap line, where the
 * construction's one mitred run cut the apex off flat at a heavy weight.
 * The bar is the face's own.
 */
export function humanistCapitalA(style: Style): Recipe {
  const f = frame(style);
  const recipe = LETTERS.A(style);
  const bar = recipe.strokes[1]?.spine.segments[0];
  if (bar?.kind !== "line") return recipe;
  /*
   * Widening at a heavy weight by a third of what the construction's A does:
   * its legs are a hairline and a stem, not two stems, and at a Black the
   * construction's two-stem A stood half as wide again as the H.
   */
  const half = Math.max(f.capBowl * 0.86, f.least) + f.half * 0.15 * heaviness(f) + f.gain * 0.25;
  const foot = at(f.edge, 0);
  const other = at(f.edge + half * 2, 0);
  const apex = at(f.edge + half, f.cap + f.over * 1.2);
  const y = bar.from.y;
  const along = (from: typeof foot) => from.x + ((apex.x - from.x) * y) / apex.y;
  return finish(f, [
    hairlined(ink(f, straight(foot, apex), f.end, BUTT), 0.55),
    ink(f, straight(apex, other), BUTT, f.end),
    thin(f, straight(at(along(foot), y), at(along(other), y))),
  ]);
}

/**
 * The two-storey a as a text face draws it at every weight: the bowl hung
 * low off the stem and lighter than it, and the arch over it turning down
 * into its drop. At a heavy weight the bowl comes down and in rather than
 * filling the x-height, so the arch keeps a counter under it -- held at the
 * regular's height, the bowl's top met the arch and the letter was a blot
 * with a slot in it.
 */
export function humanistA(style: Style): Recipe {
  const f = frame(style);
  const heavy = heaviness(f);
  const bowlHeight = Math.max(f.x * 0.31 - f.gain * A_SINK, f.least);
  const bowlPen = { ...f.style.pen, weight: f.style.pen.weight * (1 - 0.24 * heavy) };
  const bowlWidth = Math.max(bowlHeight * f.wide + f.half * 0.35 * heavy + f.gain * 0.2, f.least);
  const centre = at(f.edge + bowlWidth, f.dip(0) + bowlHeight);
  const stem = centre.x + bowlWidth + (f.style.pen.weight - bowlPen.weight) / 2;
  const over = Math.max(Math.min(bowlWidth, f.x - bowlHeight * 2), f.least);
  return finish(f, [
    inherit(ink(f, ring(f, centre, bowlWidth, bowlHeight)), {
      ...ink(f, ring(f, centre, bowlWidth, bowlHeight)),
      pen: bowlPen,
    }),
    ink(
      f,
      chain(
        straight(at(stem, 0), at(stem, f.crest(f.x) - over)),
        turn(at(stem - over, f.crest(f.x) - over), over, 0, 135 - 25 * Math.min(1, heavy)),
      ),
      f.end,
      f.end,
    ),
  ]);
}

/** How far the a's bowl comes down for the stem a heavy weight gains. */
const A_SINK = 0.5;

/** A run whose turns are each drawn in so many pieces at every weight: see `SpineArc.pieces`. */
function inPieces(spine: Spine, pieces: number): Spine {
  return {
    ...spine,
    segments: spine.segments.map((one) => (one.kind === "arc" ? { ...one, pieces } : one)),
  };
}

/**
 * The w and the W as Lora draws them: two vees crossing in the middle, the
 * outer arms standing on their serifs and the inner two running up past the
 * line to a point with no serif on either -- where the construction's two
 * vees each wore a serif there, and at a Black the two met over the middle.
 */
function doubleVee(f: ReturnType<typeof frame>, half: number, top: number): Recipe {
  const left = f.edge;
  // One run, so each vertex -- the two feet and the apex -- is a mitred point
  // whose ink reaches its line, as the M's is: see `through`.
  const points = through(f, [
    at(left, top),
    at(left + half, 0),
    at(left + half * 1.86, top),
    at(left + half * 2.72, 0),
    at(left + half * 3.72, top),
  ]);
  return finish(f, [
    ink(
      f,
      chain(
        straight(points[0], points[1]),
        straight(points[1], points[2]),
        straight(points[2], points[3]),
        straight(points[3], points[4]),
      ),
      f.end,
      f.end,
    ),
  ]);
}

export function humanistW(style: Style): Recipe {
  const f = frame(style);
  return doubleVee(f, Math.max(roundHalf(f) * 0.57, f.arch * 0.68), f.x);
}

export function humanistCapitalW(style: Style): Recipe {
  const f = frame(style);
  return doubleVee(f, f.capBowl * 0.66, f.cap);
}

/**
 * The K and the k as a broad nib draws them: a hairline arm running down
 * from its serif into the stem, and a full leg leaving the arm a third of
 * the way out from the stem and running down to its own serif, as Lora's
 * do -- where the construction's arm and leg met at a point on the stem.
 */
function kay(
  f: ReturnType<typeof frame>,
  top: number,
  reach: number,
  waist: number,
  rise: number,
): Recipe {
  const stem = f.edge;
  const arm = at(stem + reach, top);
  // Into the stem, and buried there.
  const into = at(stem + f.half * 0.2, waist);
  const leaves = at(into.x + (arm.x - into.x) * K_LEAVES, into.y + (arm.y - into.y) * K_LEAVES);
  const foot = at(stem + reach * K_FOOT, 0);
  return finish(f, [
    ink(f, straight(at(stem, 0), at(stem, rise)), f.end, f.end),
    hairlined(ink(f, straight(arm, into), f.end, BUTT), 0.62),
    ink(f, straight(leaves, foot), BUTT, f.end),
  ]);
}

/** How far out along the arm the leg leaves it, from the stem. */
const K_LEAVES = 0.3;
/** How far out the leg's foot stands against the arm's reach. */
const K_FOOT = 1.04;

export function humanistCapitalK(style: Style): Recipe {
  const f = frame(style);
  return kay(f, f.cap, f.capBowl * 1.15, f.cap * 0.42, f.cap);
}

export function humanistK(style: Style): Recipe {
  const f = frame(style);
  return kay(f, f.x, f.arch * 1.7, f.x * 0.36, f.asc);
}

/**
 * The s with its spine as heavy as Lora's -- 98 units across the middle on a
 * stem of 87, where the construction's pen left 70 -- and its two ends as
 * light as ever; and run a little wider past a Black: its spine and its two
 * bowls share the x-height with three strokes' worth of pen, and on a text
 * x-height of half the em the upper counter closed to a slot.
 */
export function humanistS(style: Style): Recipe {
  const past = Math.max(0, blackness(style) - 1);
  const widened =
    past > 0
      ? {
          ...style,
          metrics: { ...style.metrics, width: style.metrics.width * (1 + S_WIDEN * past) },
        }
      : style;
  const recipe = LETTERS.s(widened);
  // As the rounds' sides are, and fading out by the Bold as theirs do.
  const swell = 1 + (S_SPINE - 1) * Math.max(0, 1 - (blackness(style) / 0.47) * 0.8);
  return {
    ...recipe,
    strokes: recipe.strokes.map((stroke) =>
      stroke.spine.segments.some((one) => one.kind === "arc") ? hairlined(stroke, swell) : stroke,
    ),
  };
}

/** Lora's s spine against the stem the construction's pen gives it. */
const S_SPINE = 1.25;

/** How much wider the s runs per unit of blackness past a Black. */
const S_WIDEN = 0.8;
