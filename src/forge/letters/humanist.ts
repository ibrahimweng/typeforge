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
import { bowl, bowlPoint, spineStart } from "../shapes";
import { penReach, reachAlong } from "../sweep";
import type { Vec2 } from "@/font/types";
import type { Spine, Stroke, Terminal } from "../types";
import {
  at,
  barWeight,
  bowed,
  BUTT,
  chain,
  corner,
  crested,
  crossbar,
  cutsLevel,
  finish,
  dot,
  bend,
  LEVEL,
  stopRadius,
  frame,
  heaviness,
  inherit,
  ink,
  leaving,
  lighter,
  openBowl,
  type Recipe,
  ring,
  roundHalf,
  shoulderRadius,
  straight,
  thin,
  through,
  tittle,
  towards,
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
  const asked = Math.min(0.72, bar.height * eye);
  // Drawn again with the bowl started as far higher as the bar has to hang
  // under it, so the bar stands where it was asked for.
  let height = asked;
  let drawn = eyed(style, height);
  const wanted = drawn.asked;
  for (let pass = 0; pass < 2 && Math.abs(wanted - drawn.bar) > 0.5; pass++) {
    height += (wanted - drawn.bar) / style.metrics.xHeight;
    drawn = eyed(style, height);
  }
  return drawn.recipe;
}

/**
 * The humanist e with its bar asked for at `height` of the x-height, where
 * the bar was asked to stand and where it has come out.
 *
 * The bowl's start is cut level at the bar's top, and the bar hangs from the
 * corner that cut makes with the bowl's outside edge and is cut along the
 * same edge, so the right of the letter is one line from the bowl on down
 * past the bar. The bar carried out and cut upright left the bowl's end
 * leaning in over it -- a notch above a flat-ended bar that stood proud of
 * the bowl -- and stopped inside the bowl its lower half stood out as a step.
 */
function eyed(style: Style, height: number): { recipe: Recipe; bar: number; asked: number } {
  const raised = {
    ...style,
    parts: { ...style.parts, crossbar: { ...style.parts.crossbar, height } },
  };
  const drawn = swollen(raised, LETTERS.e(raised));
  const [across, belt, ...rest] = drawn.strokes;
  if (!belt || belt.spine.closed) return { recipe: drawn, bar: 0, asked: 0 };
  const [run] = across.spine.segments;
  const [first] = belt.spine.segments;
  let drawnBar = across;
  let bowlStart: Terminal = BUTT;
  let barY = 0;
  let askedY = 0;
  if (run?.kind === "line" && first?.kind === "arc") {
    const from = spineStart(belt.spine);
    const way = first.endAngle >= first.startAngle ? 1 : -1;
    const dir = at(-Math.sin(first.startAngle) * way, Math.cos(first.startAngle) * way);
    if (dir.y > 0.2) {
      const normal = at(dir.y, -dir.x);
      const out = reachAlong(normal.x >= 0 ? normal : at(-normal.x, -normal.y), penReach(belt.pen));
      const lean = dir.x / dir.y;
      const barPen = penReach(across.pen);
      // The bar's top corner, off its spine, as its pen leaves it.
      const up = reachAlong(at(0, 1), barPen);
      // Where the bowl's level cut meets its outside edge.
      const corner = at(from.x + out.x - out.y * lean, from.y);
      // How far each of the bar's corners slides for its end to lie along
      // the bowl's edge.
      const slide = up.y * lean - up.x;
      const end = at(corner.x - up.x - slide, corner.y - up.y);
      barY = end.y;
      askedY = run.to.y;
      drawnBar = inherit(across, {
        ...across,
        spine: { ...across.spine, segments: [{ ...run, from: at(run.from.x, end.y), to: end }] },
        end: { kind: "angled", angle: (Math.atan(slide / barPen.across) * 180) / Math.PI },
      });
      bowlStart = { kind: "butt", level: true };
    }
  }
  /*
   * And its foot cut plain across the stroke, as Lora's is -- or at the
   * terminal's angle, where the face asks for angled ends: the serif a curve
   * refuses was drawn there as a sliver, and at a Black it showed.
   */
  const { terminal } = style.parts;
  const foot: Terminal =
    terminal.kind === "angled" ? { kind: "angled", angle: terminal.angle } : BUTT;
  return {
    recipe: {
      ...drawn,
      strokes: [drawnBar, inherit(belt, { ...belt, start: bowlStart, end: foot }), ...rest],
    },
    bar: barY,
    asked: askedY,
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
const T_TOP = 640 / 755;

/**
 * The t standing well over the x-height, its stem cut off under a wedge that
 * rises from the left end of the bar to the stem's head, as Lora's does.
 */
export function humanistT(style: Style): Recipe {
  const f = frame(style);
  const radius = Math.max(roundHalf(f) * 0.34, f.least, f.half * 1.25);
  const reach = tReach(f);
  const stem = tStem(f);
  /*
   * As tall at every weight as Lora's, less the little a heavy stem's own
   * ink adds: grown by two half-pens over the x-height, a Black t stood over
   * the ascender.
   */
  const top = Math.max(f.asc * T_TOP + Math.max(0, f.half - 43.5) * 0.3, f.x + f.half);
  const bar = f.hangs(f.x, f.bar);
  const barLeft = stem - reach * 0.7;
  /*
   * The wedge laid from the bar's left end up to the stem's head, and cut
   * level with the stem at the top and with the bar at its foot, so the
   * head is one flat and the wedge's foot lies inside the bar: cut square
   * across themselves, the two ends stood out of the head in steps and the
   * wedge's foot out of the bar.
   */
  const light = lighter(ink(f, straight(at(barLeft, bar), at(stem, top)), LEVEL, LEVEL), 0.75);
  const chordOf = (from: Vec2, to: Vec2) => {
    const d = towards(from, to);
    const side = reachAlong(at(-d.y, d.x), penReach(light.pen));
    return Math.abs(side.x - (side.y / d.y) * d.x);
  };
  // Its head's left corner on the stem's left edge, and its foot's on the
  // bar's left end.
  const stemHalf = Math.abs(reachAlong(at(1, 0), penReach(f.style.pen)).x);
  let wedgeTop = at(stem, top);
  let foot = at(barLeft, bar);
  for (let pass = 0; pass < 6; pass++) {
    const chord = chordOf(foot, wedgeTop);
    wedgeTop = at(stem - stemHalf + chord, top);
    foot = at(barLeft + chord + f.half * 0.15, bar);
  }
  const pen = light;
  const wedge = inherit(pen, { ...pen, spine: straight(foot, wedgeTop) });
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, top), at(stem, f.dip(0) + radius)),
        // Round the foot and on up into the tail, as Lora's is.
        inPieces(turn(at(stem + radius, f.dip(0) + radius), radius, 180, 305), 2),
      ),
      LEVEL,
      f.end,
    ),
    wedge,
    crossbar(f, barLeft, stem + reach),
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
 * The M with its vertex on the line: the left stem a hairline, the right a
 * full stem, and the two diagonals meeting in a point on the baseline, as
 * Lora's M is drawn.
 */
export function humanistCapitalM(style: Style): Recipe {
  const f = frame(style);
  const left = f.edge;
  const width = Math.max(f.capBowl * 1.7, f.half * 7);
  const right = left + width;
  const middle = left + width * 0.49;
  /*
   * The stems upright. Lora's lean out by two and four hundredths of the
   * letter's width, but a stem leaning that little is cut square across
   * itself rather than level with the line, and its serifs stood on it as
   * stepped slivers top and bottom.
   */
  const topLeft = at(left, f.cap);
  const topRight = at(right, f.cap);
  const hair = hairlined(ink(f, straight(at(left, 0), topLeft), f.end, f.end), 0.55);
  const across = (stroke: Stroke) => Math.abs(reachAlong(at(1, 0), penReach(stroke.pen)).x);
  const full = ink(f, straight(at(right, 0), topRight), f.end, f.end);
  /*
   * The two diagonals one run cut level on the cap line inside each stem, as
   * the plain serifed M's are (see `leaving`): a run carried on down each
   * stem and turned there was moved in along its corner's bisector to keep
   * the vertex on the line, leaned off the stem, and stood out of it as a
   * fin under the serif and a doubled stem beside the other.
   */
  let from = topLeft;
  let to = topRight;
  let vertex = at(middle, 0);
  for (let pass = 0; pass < 3; pass++) {
    from = leaving(f, topLeft, 1, vertex, 1, across(hair));
    to = leaving(f, topRight, -1, vertex, -1, across(full));
    vertex = corner(f, from, at(middle, 0), to);
  }
  return finish(f, [
    hair,
    full,
    ink(f, chain(straight(from, vertex), straight(vertex, to)), LEVEL, LEVEL),
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
  const f = frame(style);
  if (!cutsLevel(f)) {
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
  /*
   * The diagonal cut level on the cap line and the baseline inside each
   * hairline stem (see `leaving`), measured against the hairline's own reach:
   * measured against a full stem's, the diagonal's top stood out over the
   * left stem's head, which lost its serif under it, and its foot stood out
   * of the right stem as a wedge.
   */
  const left = f.edge;
  const right = left + f.capBowl * 1.35;
  const stems = [
    hairlined(ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end), 0.58),
    hairlined(ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end), 0.58),
  ];
  const reach = Math.abs(reachAlong(at(1, 0), penReach(stems[0].pen)).x);
  let top = at(left, f.cap);
  let foot = at(right, 0);
  for (let pass = 0; pass < 3; pass++) {
    top = leaving(f, at(left, f.cap), 1, foot, 1, reach);
    foot = leaving(f, at(right, 0), -1, top, 1, reach);
  }
  return finish(f, [...stems, ink(f, straight(top, foot), LEVEL, LEVEL)]);
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
  const leaves = bowlPoint(upper, upperW, upperH, roundness, f.half, 250 - 25 * heavy, f.curve);
  const lands = bowlPoint(loop, loopHalf, loopH, roundness, f.half, 140, f.curve);
  // The ear, out of the bowl's top right, up over the x-height and down into its drop.
  const from = bowlPoint(upper, upperW, upperH, roundness, f.half, 22, f.curve);
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
  /*
   * Never tighter than the pen goes round: turned tighter at a Bold, the
   * inside of the turn folded to a spike hanging between the drop and the
   * stem.
   */
  const radius = Math.max(f.arch * 0.5, f.least, f.half * 1.2);
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
  const [, stem] = recipe.strokes;
  if (f.square >= 0.01 || !stem) return recipe;
  /*
   * The bowl as Lora's: begun at its upper left, where the hairline stem
   * comes down into it at an angle, and carried over the top, down the right
   * and round under to the drop. The construction's bowl left the foot of
   * the stem on a turn of its own pen, and under a hairline stem that turn
   * stood out to the left of it as a shelf.
   */
  const floor = f.dip(0);
  const ceiling = Math.min(f.cap * 0.6, f.cap - f.upright * f.bar * 2 - f.half * 0.6 - f.upright);
  const radius = Math.max((ceiling - floor) / 2, f.least);
  const across = radius * 0.93 * f.style.metrics.width + f.gain * 0.1;
  const centre = at(f.edge + across * 0.86, floor + radius);
  const bowlStroke = ink(f, bend(f, centre, radius, FIVE_FROM, -150, across), BUTT, f.end);
  const hair = hairlined(ink(f, straight(at(0, f.cap), at(0, 0)), BUTT, BUTT), 0.52);
  const first = bowlStroke.spine.segments.find(
    (one) => one.kind === "arc" && Math.abs(one.endAngle - one.startAngle) > 1e-6,
  );
  if (first?.kind !== "arc") return recipe;
  const from = spineStart(bowlStroke.spine);
  const way = first.endAngle >= first.startAngle ? 1 : -1;
  const travel = at(-Math.sin(first.startAngle) * way, Math.cos(first.startAngle) * way);
  const bowlPen = penReach(bowlStroke.pen);
  const reach = reachAlong(at(-travel.y, travel.x), bowlPen);
  // The bowl's first cut, from its outer corner -- the left one, on a bowl
  // begun at its upper left -- to its inner.
  const [outer, inner] = [
    at(from.x + reach.x, from.y + reach.y),
    at(from.x - reach.x, from.y - reach.y),
  ].sort((one, other) => one.x - other.x);
  // The stem's left edge through the bowl's outer corner.
  const stemPen = penReach(hair.pen);
  const side = reachAlong(at(1, 0), stemPen);
  const x = outer.x + Math.abs(side.x);
  /*
   * The stem's foot cut along the bowl's first cut, turned a few degrees into
   * the bowl so it lies inside it rather than along it -- two outlines meeting
   * edge to edge leave a hairline of white where they meet.
   */
  const cut = towards(outer, inner);
  const turned = (by: number) =>
    at(cut.x * Math.cos(by) - cut.y * Math.sin(by), cut.x * Math.sin(by) + cut.y * Math.cos(by));
  // Into the bowl is toward the way it travels.
  const tilt = (4 * Math.PI) / 180;
  const into =
    turned(tilt).x * travel.x + turned(tilt).y * travel.y > 0 ? turned(tilt) : turned(-tilt);
  const down = at(0, -1);
  // The sweep's corners either side of the foot: `shift` is its left of the
  // way down, which is the stem's right, and slides on by the cut's slide.
  const shift = reachAlong(at(-down.y, down.x), stemPen);
  const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
  const slide = -cross(shift, into) / cross(down, into);
  const foot = at(outer.x + shift.x + down.x * slide, outer.y + shift.y + down.y * slide);
  const drawnStem = inherit(hair, {
    ...hair,
    spine: straight(at(x, f.cap - f.half * 0.3), at(x, foot.y)),
    end: { kind: "angled", angle: (Math.atan(slide / stemPen.across) * 180) / Math.PI },
  });
  // Lora's 70 on a stem of 87, and gaining only half what the stem does.
  const deep = Math.min(f.style.pen.weight, 87) * 0.8 + Math.max(0, f.style.pen.weight - 87) * 0.5;
  const y = f.cap - deep / 2;
  // Along the cap line and turning up at its end, over the line, in one run.
  const curl = deep * 0.9;
  const right = centre.x + across * 0.95;
  const flag: Stroke = inherit(stem, {
    spine: chain(
      straight(at(x - Math.abs(side.x), y), at(right - curl, y)),
      turn(at(right - curl, y + curl), curl, 270, 360),
    ),
    pen: { ...f.style.pen, contrast: 0, weight: deep },
    start: BUTT,
    end: BUTT,
  });
  return { ...finish(f, [flag, drawnStem, bowlStroke], true) };
}

/** Where the five's bowl begins, in degrees round from its right. */
const FIVE_FROM = 150;

/**
 * The hyphen as Lora sets it: 0.71 of an x-height long, eight tenths of a
 * stem deep, its middle at 0.64 of the x-height.
 */
export function humanistHyphen(style: Style): Recipe {
  const f = frame(style);
  // Deepening at half the rate the stem does past the Regular, and longer,
  // or a Black's hyphen was nearly a square.
  const w = f.style.pen.weight;
  const deep = Math.min(w, 87) * 0.78 + Math.max(0, w - 87) * 0.45;
  const long = f.x * 0.71 + f.gain * 0.6;
  const y = f.x * 0.64;
  return finish(f, [
    {
      spine: straight(at(f.edge - f.half, y), at(f.edge - f.half + long, y)),
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
 * down the right, meeting a little over the cap line in a narrow flat top,
 * and the bar across them where Lora's is.
 */
export function humanistCapitalA(style: Style): Recipe {
  const f = frame(style);
  const recipe = LETTERS.A(style);
  if (recipe.strokes[1]?.spine.segments[0]?.kind !== "line") return recipe;
  /*
   * Widening at a heavy weight by a third of what the construction's A does:
   * its legs are a hairline and a stem, not two stems, and at a Black the
   * construction's two-stem A stood half as wide again as the H.
   */
  const half = Math.max(f.capBowl * 0.86, f.least) + f.half * 0.9 * heaviness(f) + f.gain * 0.25;
  const foot = at(f.edge, 0);
  const other = at(f.edge + half * 2, 0);
  const top = f.cap + f.over * 1.2;
  const apex = at(f.edge + half, top);
  /*
   * The apex a flat over the cap line, as Lora's is: the hairline cut level
   * there, and the full leg cut along the hairline's own right edge from its
   * top corner, so that cut is buried in the hairline and the leg's outside
   * runs on up to the end of the flat. Two ends meeting on one point, each
   * cut square across itself, stood out of the apex as a flag up and to the
   * left, and both cut level made a flat as wide as the full leg's.
   */
  const leftLeg = hairlined(ink(f, straight(foot, apex), f.end, LEVEL), 0.55);
  const up = towards(foot, apex);
  const leftSide = reachAlong(at(-up.y, up.x), penReach(leftLeg.pen));
  const flat = Math.abs(leftSide.x - (leftSide.y / up.y) * up.x) * 2;
  const corner = at(apex.x + flat / 2, top);
  const right = ink(f, straight(corner, other), BUTT, f.end);
  const pen = penReach(right.pen);
  let start = corner;
  let slide = 0;
  /*
   * Along the hairline's edge turned a few degrees into the hairline, so the
   * cut lies inside it rather than on it: two outlines meeting along a line
   * left a hairline of white up the apex where they met.
   */
  const tilt = (3 * Math.PI) / 180;
  const into = at(
    up.x * Math.cos(tilt) + up.y * Math.sin(tilt),
    up.y * Math.cos(tilt) - up.x * Math.sin(tilt),
  );
  for (let pass = 0; pass < 8; pass++) {
    const down = towards(start, other);
    const outer = reachAlong(at(-down.y, down.x), pen);
    // How far the corners slide along the leg for the cut to lie along `into`.
    slide = -(outer.x * into.y - outer.y * into.x) / (down.x * into.y - down.y * into.x);
    start = at(corner.x - outer.x - down.x * slide, corner.y - outer.y - down.y * slide);
  }
  const rightLeg = inherit(right, {
    ...right,
    spine: straight(start, other),
    start: { kind: "angled", angle: (Math.atan(slide / pen.across) * 180) / Math.PI },
  });
  /*
   * The bar where Lora's is, a third of the way up, and rising at a heavy
   * weight by half what the bar gains so the counter under it stays open.
   */
  const bar = f.style.pen.weight * barWeight(f.style);
  const y = f.cap * A_BAR + Math.max(0, bar - 87 * barWeight(f.style)) * 0.15;
  const along = (from: Vec2, to: Vec2) =>
    from.x + ((to.x - from.x) * (y - from.y)) / (to.y - from.y);
  return finish(f, [
    leftLeg,
    rightLeg,
    thin(f, straight(at(along(foot, apex), y), at(along(other, start), y))),
  ]);
}

/** Where Lora's A has the middle of its bar, against the cap height. */
const A_BAR = 0.34;

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
  const asked = Math.max(f.x * 0.31 - f.gain * A_SINK, f.least);
  const bowlPen = { ...f.style.pen, weight: f.style.pen.weight * (1 - 0.4 * heavy) };
  /*
   * The arch never tighter than the pen goes round with room inside it, so
   * the drop hangs clear of the shoulder -- turned tighter, a Black's drop
   * and shoulder were one mass and the a had no opening under its head --
   * and the bowl kept under the arch's middle, so the arch keeps a counter.
   */
  const wide = Math.max(asked * f.wide + f.half * 0.35 * heavy + f.gain * 0.2, f.least);
  const over = Math.max(Math.min(wide, f.x - asked * 2), f.half * 1.15, f.least);
  const room = (f.crest(f.x) - over - f.dip(0)) / 2;
  const bowlHeight = Math.max(Math.min(asked, room), bowlPen.weight * 0.55);
  /*
   * And no more than so much wider than it is tall, or its counter is a slot
   * with flat sides: an oval's quarter is three arcs only while it is no
   * more than twice as wide as it is tall (see `ovalCorner`).
   */
  const bowlWidth = Math.max(
    Math.min(bowlHeight * f.wide + f.half * 0.35 * heavy + f.gain * 0.2, bowlHeight * 1.5),
    f.least,
  );
  const centre = at(f.edge + bowlWidth, f.dip(0) + bowlHeight);
  const stem = centre.x + bowlWidth + (f.style.pen.weight - bowlPen.weight) / 2;
  return finish(f, [
    // Held open for its own lighter pen, not the stem's: see `bowl`.
    inherit(ink(f, ring(f, centre, bowlWidth, bowlHeight)), {
      ...ink(f, ring(f, centre, bowlWidth, bowlHeight)),
      spine: bowl(centre, bowlWidth, bowlHeight, 1 - f.square, bowlPen.weight / 2, f.curve),
      pen: bowlPen,
    }),
    ink(
      f,
      chain(
        straight(at(stem, 0), at(stem, f.crest(f.x) - over)),
        turn(
          at(stem - over, f.crest(f.x) - over),
          over,
          0,
          135 - 25 * Math.min(1, heavy) - 20 * Math.max(0, heavy - 1),
        ),
      ),
      f.end,
      f.end,
    ),
  ]);
}

/** How far the a's bowl comes down for the stem a heavy weight gains. */
const A_SINK = 0.3;

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
 * The run of an old-style s, as Lora's is: two oval bowls wider than they
 * are tall, and a spine leaving the one and arriving at the other along
 * their own tangents, so the letter is one S-curve from end to end. Each
 * bowl's quarter is the three arcs an oval is drawn with here (see
 * `ovalCorner` in shapes.ts), so the spine leaves where two of those arcs
 * meet and its slope is the tangent there: thirty degrees at a text weight.
 *
 * The construction's s joined circles to a straight spine a few degrees off
 * their tangents, and at a heavy weight well off them -- a corner either
 * side of a straight bar, which past a Black was the whole of the letter.
 * Here the spine only stands steeper at a heavy weight, turning less of the
 * bowl before it leaves, so the two counters keep their height.
 *
 * The same pieces at every weight: the head's turn, the run along the top,
 * five arcs round the upper bowl, the spine, five round the lower one, the
 * run along the foot and the foot's turn.
 */
function bookSpine(
  f: ReturnType<typeof frame>,
  height: number,
  left: number,
  width: number,
  // The half-width of the pen the run is drawn with.
  half: number,
): Spine {
  const top = f.hangs(height) + f.over;
  const bottom = f.sits(0) - f.over;
  const tall = top - bottom;
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const sin = Math.sin;
  const cos = Math.cos;
  // The three radii of an oval's quarter, as the bowls draw them.
  const radii = (a: number, b: number) => {
    const p = 1 - cos(rad(30)) + (cos(rad(30)) - sin(rad(30))) / 2;
    const q = sin(rad(30)) + (cos(rad(30)) - sin(rad(30))) / 2;
    const d = p * p - q * q;
    const side = (a * p - b * q) / d;
    const crown = (b * p - a * q) / d;
    return { side, middle: (side + crown) / 2, crown };
  };
  /*
   * An s whose bowls are `a` by `b` and whose spine leaves the upper one
   * `second` degrees round past the arc down its side: where it leaves, how
   * far it has left to fall to the letter's middle, and how wide that makes
   * the letter from the upper bowl's left to the lower one's right.
   */
  const laid = (a: number, b: number, second: number) => {
    const r = radii(a, b);
    const off = {
      x: r.side * (1 - cos(rad(30))) + r.middle * (cos(rad(30)) - cos(rad(30 + second))),
      y: r.side * sin(rad(30)) + r.middle * (sin(rad(30 + second)) - sin(rad(30))),
    };
    const fall = tall / 2 - b - off.y;
    const run = fall / Math.tan(rad(60 - second));
    return { r, fall, second, a, b, across: 2 * (off.x + run) };
  };
  /*
   * Each bowl as wide as the letter, a little wider than it is tall, and the
   * spine at thirty degrees -- as far as the pen leaves room for all three:
   * searched for the nearest that keeps the lower bowl's side on the
   * letter's, a spine with some fall to it, and the bowls' sides rounder
   * than the pen, whose inside otherwise folds to a point in the counter.
   */
  const roundest = half * 1.05;
  let shape = laid(width / 2, width / 2.6, 30);
  let best = Infinity;
  for (let k = 0; k <= 10; k++) {
    // Narrower than asked, where that is what keeps the bowls round.
    const a = (width / 2) * (1 - 0.3 * (k / 10));
    const most = Math.min(a * 2, tall / 2);
    for (let i = 0; i <= 40; i++) {
      const b = most - (most - a / 2) * (i / 40);
      for (let degrees = 0; degrees <= 30; degrees += 1) {
        const tried = laid(a, b, degrees);
        if (!(tried.r.side > 0 && tried.r.crown > 0)) continue;
        const cost =
          ((tried.across - 2 * a) / a) ** 2 * 40 +
          (a / b - 1.3) ** 2 +
          ((30 - degrees) / 30) ** 2 * 0.5 +
          (k / 10) ** 2 * 3 +
          (Math.max(0, roundest - tried.r.side) / roundest) ** 2 * 200 +
          (Math.max(0, tall * 0.05 - tried.fall) / tall) ** 2 * 400;
        if (cost < best) {
          best = cost;
          shape = { ...tried, a };
        }
      }
    }
  }
  const { second, a, r } = shape;
  const upperX = left + a;
  const rightSide = left + shape.across;
  // Walked piece by piece from the top of the upper bowl, each turn tangent
  // to what came before it.
  const pieces: Spine[] = [];
  let point = at(upperX, top);
  let heading = 180;
  const arc = (radius: number, by: number) => {
    const side = by > 0 ? 90 : -90;
    const centre = at(
      point.x + radius * cos(rad(heading + side)),
      point.y + radius * sin(rad(heading + side)),
    );
    const from = heading - side;
    pieces.push(inPieces(turn(centre, radius, from, from + by), 1));
    point = at(centre.x + radius * cos(rad(from + by)), centre.y + radius * sin(rad(from + by)));
    heading += by;
  };
  arc(r.crown, 30);
  arc(r.middle, 30);
  arc(r.side, 30);
  arc(r.side, 30);
  arc(r.middle, second);
  // The spine, down to where the lower bowl takes it, point for point the
  // upper bowl's leaving turned about the letter's middle.
  const middle = at(left + shape.across / 2, (top + bottom) / 2);
  const arrives = at(middle.x * 2 - point.x, middle.y * 2 - point.y);
  pieces.push(straight(point, arrives));
  point = arrives;
  arc(r.middle, -second);
  arc(r.side, -30);
  arc(r.side, -30);
  arc(r.middle, -30);
  arc(r.crown, -30);
  const lowerX = point.x;
  /*
   * The ends, as the construction's text s has them: each on a wider turn
   * than the bowls, coming most of the way across the letter before it stops
   * travelling forty degrees off level, where the beak hangs from it.
   */
  const inset = (rightSide - left) * 0.04;
  const fromAngle = 40;
  const room = rightSide - inset - upperX;
  const end = Math.max((room * 0.88) / cos(rad(fromAngle)), f.least);
  const headX = Math.max(upperX + 1, rightSide - inset - end * cos(rad(fromAngle)));
  const footX = Math.min(lowerX - 1, left + inset + end * cos(rad(fromAngle)));
  return chain(
    turn(at(headX, top - end), end, fromAngle, 90),
    straight(at(headX, top), at(upperX, top)),
    ...pieces,
    straight(at(lowerX, bottom), at(footX, bottom)),
    turn(at(footX, bottom + end), end, -90, fromAngle - 180),
  );
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
  const recipe = { ...bookS(widened, false), air: 1.05 };
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
const S_WIDEN = 0.5;

/**
 * The at sign as Lora draws it: a small a -- a bowl and a stem -- whose stem
 * turns at its foot into a tail running out and up into the ring, which goes
 * on round over the top, down the left and under the letter to stop short at
 * the lower right, all on the face's own pen, so the ring is thick at its
 * sides and a hairline over the top and under the foot.
 *
 * Sized by the ring, as Lora's is the same size at every weight: where the
 * construction sized its inner bowl first and grew the ring round it, the
 * mark ran twice the height of the capitals at a Black. A heavy weight draws
 * the ring and the bowl lighter than the stem, as a Black's small counters
 * are, and grows the ring only as far as the bowl and the tail need to stay
 * open inside it.
 */
export function humanistAt(style: Style): Recipe {
  const f = frame(style);
  const heavy = Math.min(1, heaviness(f) / 1.5);
  const share = 1 - 0.4 * heavy;
  const weight = f.style.pen.weight * share;
  const side = weight / 2;
  const bowlShare = share * (0.9 - 0.1 * heavy);
  const bowlSide = (f.style.pen.weight * bowlShare) / 2;
  // The least a counter inside it keeps open.
  const least = Math.max(f.half * (0.4 - 0.2 * heavy), 12);
  // How much of the inside the bowl takes across, from the stem's middle.
  const across = 0.5 + 0.08 * heavy;
  const inside = Math.max(
    f.cap * AT_RADIUS - side * 2,
    (least + side / 2) / 0.375,
    (bowlSide * 2 + least) / across,
  );
  const R = inside + side;
  const centre = at(f.edge + R, f.cap * AT_MIDDLE);
  const stem = centre.x + inside * 0.25;
  const bowlW = inside * across - bowlSide;
  const bowlH = inside * 0.74 - bowlSide * (1 - f.style.pen.contrast);
  const bowl = at(stem - bowlW, centre.y + inside * 0.08);
  const tail = (centre.x + R - stem) / 2;
  const turnY = Math.min(bowl.y - bowlH + tail, centre.y - 1);
  const top = bowl.y + bowlH + bowlSide * (1 - f.style.pen.contrast);
  return finish(
    f,
    [
      lighter(ink(f, ring(f, bowl, bowlW, bowlH)), bowlShare),
      lighter(
        ink(
          f,
          inPieces(
            chain(
              straight(at(stem, top), at(stem, turnY)),
              turn(at(stem + tail, turnY), tail, 180, 360),
              straight(at(centre.x + R, turnY), at(centre.x + R, centre.y)),
              turn(centre, R, 0, 312),
            ),
            4,
          ),
          BUTT,
          BUTT,
        ),
        share,
      ),
    ],
    true,
  );
}

/** Lora's at sign's ink reaches this far from its middle, against the cap height. */
const AT_RADIUS = 0.51;
/** And its middle stands this high, against the cap height. */
const AT_MIDDLE = 0.39;

/** The s or the S on `bookSpine`, as wide as the construction's text s. */
function bookS(style: Style, capital: boolean): Recipe {
  // Not on a face whose runs undulate: a wave ridden along these short arcs
  // folded the S of a hairline Wavy.
  const { wave } = style.parts;
  if (wave.along !== "off" && wave.depth > 0) {
    return capital ? LETTERS.S(style) : LETTERS.s(style);
  }
  const f = frame(style);
  const height = capital ? f.cap : f.x;
  const inked = height + f.over * 2 - f.upright * 2;
  // The capital a little narrower on its height, as Lora's S is.
  const width = inked * (capital ? 0.59 : 0.62) * f.wide + (f.gain * f.x) / height;
  /*
   * Drawn lighter at a heavy weight, as a Black's small counters are (the a's
   * bowl, the g's loops): three strokes' worth of the stem's pen stacked in
   * an x-height left the counters slits with a fold at each end.
   */
  // Past the Bold only: Lora's Bold s is as heavy as its n.
  const heavy = Math.min(1, Math.max(0, heaviness(f) - 0.5));
  return finish(
    f,
    [
      lighter(
        ink(f, bookSpine(f, height, f.edge, width, f.half * (1 - 0.45 * heavy)), f.end, f.end),
        1 - 0.45 * heavy,
      ),
    ],
    true,
  );
}

/** The S as the s is drawn: see `bookSpine`. */
export function humanistCapitalS(style: Style): Recipe {
  const recipe = bookS(style, true);
  const swell = 1 + (S_SPINE - 1) * Math.max(0, 1 - (blackness(style) / 0.47) * 0.8);
  return {
    ...recipe,
    strokes: recipe.strokes.map((stroke) => hairlined(stroke, swell)),
  };
}

/**
 * The seven as Lora's: the arm running out to the right and the stem leaving
 * it in one bowed stroke that stands more upright as it falls, ending on the
 * line in a round tail rather than on a foot serif. The construction's
 * straight stem stood on a serif, as an l's does, and read as a letter.
 */
export function humanistSeven(style: Style): Recipe {
  const f = frame(style);
  const recipe = LETTERS.seven(style);
  const [only] = recipe.strokes;
  const [arm, fall] = only?.spine.segments ?? [];
  if (arm?.kind !== "line" || fall?.kind !== "line") return recipe;
  // The round cap on a curved end reaches only a few units on past it.
  const end = at(fall.to.x + f.half * 0.4, f.dip(0) + 5);
  return finish(f, [
    inherit(only, {
      ...only,
      spine: chain(straight(arm.from, arm.to), bowed(f, arm.to, end, SEVEN_BOW)),
      end: { kind: "round" },
    }),
  ]);
}

/** How far the seven's stem bows off its chord, and which way: out to the right. */
const SEVEN_BOW = -0.035;
