import type { Vec2 } from "@/font/types";
import { joinWeight, LETTERS, writtenLead } from "../letters";
import { seamsOf } from "../script";
import { bowlBetween, bowlPoint, roundCorners, spineEnd, spineStart } from "../shapes";
import { penReach, reachAlong } from "../sweep";
import type { Style } from "../style";
import type { Spine, Stroke } from "../types";
import {
  grotesqueA,
  grotesqueAt,
  grotesqueC,
  grotesqueBraceLeft,
  grotesqueBraceRight,
  grotesqueBracketLeft,
  grotesqueBracketRight,
  grotesqueAcute,
  grotesqueBackslash,
  grotesqueBar,
  grotesqueCapitalD,
  grotesqueCapitalO,
  grotesqueCaret,
  grotesqueCircumflexAccent,
  grotesqueDieresis,
  grotesqueDollar,
  grotesqueEqual,
  grotesqueGrave,
  grotesqueGreater,
  grotesqueLess,
  grotesquePlus,
  grotesqueTilde,
  grotesqueTildeAccent,
  grotesqueUnderscore,
  grotesqueE,
  grotesqueHyphen,
  grotesqueNumberSign,
  grotesqueParenLeft,
  grotesqueQuoteDouble,
  grotesqueQuoteSingle,
  grotesqueParenRight,
  grotesquePercent,
  grotesqueSection,
  grotesqueSlash,
  grotesqueCapitalA,
  grotesqueCapitalB,
  grotesqueCapitalC,
  grotesqueCapitalE,
  grotesqueCapitalF,
  grotesqueCapitalH,
  grotesqueCapitalL,
  grotesqueCapitalT,
  grotesqueCapitalU,
  grotesqueI,
  grotesqueCapitalV,
  grotesqueCapitalY,
  grotesqueAmpersand,
  grotesqueCapitalG,
  grotesqueCapitalK,
  grotesqueCapitalP,
  grotesqueCapitalQ,
  grotesqueCapitalS,
  grotesqueCapitalZ,
  grotesqueExclam,
  grotesqueEight,
  grotesqueF,
  grotesqueFive,
  grotesqueFour,
  grotesqueG,
  grotesqueJ,
  grotesqueJay,
  grotesqueL,
  grotesqueK,
  grotesqueM,
  grotesqueN,
  grotesqueNine,
  grotesqueOne,
  grotesqueQuestion,
  grotesqueR,
  grotesqueS,
  grotesqueSeven,
  grotesqueSix,
  grotesqueSmallR,
  grotesqueT,
  grotesqueSmallU,
  grotesqueAsterisk,
  grotesqueSmallW,
  grotesqueV,
  grotesqueW,
  grotesqueThree,
  grotesqueTwo,
  grotesqueY,
  grotesqueZ,
  grotesqueZero,
} from "./grotesque";
import {
  humanistA,
  humanistAmpersand,
  humanistAt,
  humanistS,
  humanistK,
  humanistCapitalK,
  humanistW,
  humanistCapitalW,
  humanistC,
  humanistCapitalA,
  humanistExclam,
  humanistHyphen,
  humanistSlash,
  humanistFive,
  humanistJ,
  humanistG,
  humanistCapitalC,
  humanistCapitalN,
  humanistCapitalO,
  humanistO,
  humanistZero,
  humanistCapitalM,
  humanistCapitalQ,
  humanistCapitalR,
  humanistCapitalS,
  humanistSeven,
  humanistCapitalU,
  humanistE,
  humanistT,
  humanistU,
} from "./humanist";
import {
  roundHalf,
  arch,
  at,
  lobe,
  bend,
  bowed,
  BUTT,
  chain,
  corner,
  joinsLevel,
  leaving,
  LEVEL,
  crossbar,
  figureWidth,
  finish,
  type Frame,
  frame,
  headingAt,
  ink,
  junction,
  type LetterName,
  openBowl,
  type Recipe,
  ring,
  straight,
  stub,
  thin,
  through,
  tReach,
  tStem,
  turn,
  eyeOf,
  heaviness,
  lighter,
  shoulderRadius,
} from "./common";

// ---------------------------------------------------------------------------
// Alternates
// ---------------------------------------------------------------------------

/**
 * Other ways of drawing the same letter.
 *
 * Not everything about a typeface is a number. Whether an a has one storey or
 * two, whether an A comes to a point or is cut flat across, whether a Q's tail
 * hangs below the bowl or crosses it -- these are decisions with no in-between,
 * and no slider reaches them. A face that can only be adjusted is a face that
 * can only ever be a variation on the one it started as.
 *
 * A choice here belongs to the letter rather than to the font, which is the one
 * place this half of the application is deliberately not family-wide: choosing
 * a double-storey a says nothing about the g. Everything else still reaches it.
 * The alternate is a different skeleton, and the pen, the proportions and every
 * named part are applied to it exactly as they are to the default -- so a font
 * with a flat-topped A still has one weight, one shoulder and one serif.
 */
export interface Alternate {
  id: string;
  label: string;
  /** What it is, for the button's tooltip. */
  hint: string;
  build: (style: Style) => Recipe;
}

/**
 * The stroke a written letter is entered with: up from the writing line, over
 * the top, and back down to where the letter proper begins.
 *
 * This is the whole of what separates a written script from a drawn one. A
 * drawn `n` is two stems with an arch between them and a separate stroke run in
 * from outside to touch the first of them; a written one is a hand that came
 * off the letter before, climbed to the top of the first stem and turned down,
 * so the connection and the stem are one path. `enters.ts` slices the reference
 * and ours down their length and shows it: the reference's `n` carries one run
 * of ink from a tenth of an x-height before its own origin that is already the
 * letter, and ours carried a run six hundredths tall with the stem arriving
 * three hundredths later.
 *
 * Read off the reference. Its `n`'s up-stroke leaves the writing line 0.11 of
 * an x-height before its origin and reaches the x-height 0.30 after it, which
 * is 68 degrees at the bottom easing to about 64 by the top; its first stem
 * comes back down almost exactly under the apex, so the two close a wedge
 * rather than making an arch.
 *
 * Steeper than the reference here -- 76 rather than 68 -- and the reason is the
 * seam. The reference's up-stroke crosses its own origin at 0.15 of an x-height
 * and ours crosses it at the seam, 0.30, so ours has a shorter climb left to
 * make on the letter's own side of the boundary and has to make it in less
 * room. At 68 the written `n` set at 1.61 of an x-height against the
 * reference's 1.40; at 76 it sets at 1.54.
 *
 * And the leg comes down upright rather than leaning back under the apex, which
 * the reference's very nearly does. Two degrees of lean walks the foot of the
 * leg away from where the arch springs -- `arch` is told an x and starts its
 * turn at that x partway up -- and at a pen of 8 the two were ten units apart
 * and the letter came out in two pieces. Upright, the arch springs on the leg
 * at every weight, which is what the plain `n` has always relied on.
 *
 * Built as a straight run, a turn and a straight run, in that order and with
 * the turn's radius carrying both tangents -- the same construction `archSpine`
 * uses, and for the same reason: a chain whose pieces do not leave where the
 * last one arrived is a spine with a corner in it, and a corner between an arc
 * and a line is not rounded by anything downstream. Swept, that is a stroke
 * that crosses itself.
 */
const UPSTROKE = 76;
const FIRST_LEG = 90;

/** Where a written lead-in crosses the seam, and how it leaves it. */
type Lead = { y: number; way: Vec2; weld: number; high: boolean; low?: Lead };

/**
 * The up-stroke, from the seam to the top of the first stem and back down.
 *
 * It starts on the seam, on the heading the letter before arrives on, and runs
 * straight for the weld either side of it, so the lead-out of that letter lies
 * along it. Then it bends up into the letter's own up-stroke and turns over the
 * apex. It used to be struck from the writing line instead, and everything
 * below the seam then stood inside the letter before: `in` crossed as an X.
 */
function entering(
  apex: Vec2,
  radius: number,
  lead: Lead,
  least: number,
): { lead: Spine; body: Spine } {
  const up = (UPSTROKE * Math.PI) / 180;
  const down = (FIRST_LEG * Math.PI) / 180;
  const centre = at(apex.x, apex.y - radius);
  const on = (angle: number): Vec2 =>
    at(centre.x + radius * Math.cos(angle), centre.y + radius * Math.sin(angle));
  const start = on(Math.PI / 2 + up);
  const end = on(Math.PI / 2 - down);
  const leg = straight(end, at(end.x + end.y / Math.tan(down), 0));
  const over = turn(centre, radius, 90 + UPSTROKE, 90 - FIRST_LEG);
  // Never steeper than the up-stroke: `seamHeading` holds the tilt to seventy.
  let heading = Math.min(Math.atan2(lead.way.y, lead.way.x), up - 0.05);
  /*
   * And no bend tighter than the pen goes round. At a Black the seam is pushed
   * up and the apex turn down, and the room between them will not take the
   * whole turn from the seam's heading to the up-stroke's at a radius the pen
   * can draw -- so the lead-in leaves the seam that much steeper instead, and
   * meets the lead-out before it at a slight angle rather than folding.
   */
  const roomAt = (leaving: number) =>
    Math.max(start.y - (lead.y + lead.weld * Math.max(Math.sin(leaving), 0)), 1);
  const fits = (leaving: number) =>
    (roomAt(leaving) * 0.9) / Math.max(Math.cos(leaving) - Math.cos(up), 1e-6) >= least;
  // Not taken high, where the run in is level along the waist and the bend
  // is buried in the apex it turns up into; it keeps its one advance instead.
  for (let step = 0; step < 40 && !lead.high && !fits(heading); step++) {
    heading = Math.min(heading + (up - 0.05 - heading) * 0.25, up - 0.05);
  }
  const way = at(Math.cos(heading), Math.sin(heading));
  const rising = Math.cos(heading) - Math.cos(up);
  /*
   * Where the straight run past the seam stops and the bend into the
   * up-stroke begins, as a height: the seam and the weld above it -- or, where
   * even the steepest heading leaves no room above the seam at all, low enough
   * that the bend fits, so the lead-in crosses the seam already climbing on
   * the up-stroke's own line.
   */
  const leaves = lead.high
    ? lead.y
    : Math.min(lead.y + lead.weld * Math.max(way.y, 0), start.y - (least * rising) / 0.9);
  const room = Math.max(start.y - leaves, 1);
  /*
   * The bend, as large as the height allows and no larger than half an
   * x-height's worth: its rise is r (cos heading - cos up). The same four
   * pieces at every weight, so the letter interpolates.
   */
  const rise = rising;
  const most = (room * 0.9) / Math.max(rise, 1e-6);
  let bendRadius = lead.high
    ? Math.min(apex.y * 0.5, most)
    : Math.max(Math.min(apex.y * 0.5, most), Math.min(least, most));
  /*
   * Taken high, the lead-in starts as far out from its stem as the plain
   * letter's does, so the two drawings keep one advance: how far out a
   * lead-in runs is `(start.y - leaves) / tan(up) + r (sin up - sin heading
   * - rise / tan up)` past the weld, which is a straight line in the radius.
   */
  /*
   * How far back from the bend the lead-in starts: a weld, which puts its
   * start on the seam. The letter before carries its own weld in along the
   * same line, and the two overlap by that much -- reaching back past the
   * seam as well only laid more of this stroke inside the letter before.
   */
  let back = lead.weld;
  if (lead.high && lead.low) {
    const plain = entering(apex, radius, lead.low, least);
    const target = start.x - spineStart(plain.lead).x;
    const fixed = (start.y - leaves) / Math.tan(up);
    const per = Math.sin(up) - Math.sin(heading) - rise / Math.tan(up);
    if (per > 1e-6) {
      bendRadius = Math.min(bendRadius, Math.max((target - fixed - lead.weld) / per, radius));
    }
    back = Math.max(target - fixed - bendRadius * per, 0);
  }
  // The bend ends on the up-stroke's line, a rise above where it starts.
  const meets = leaves + bendRadius * rise;
  const joins = at(start.x - (start.y - meets) / Math.tan(up), meets);
  const middle = at(joins.x - bendRadius * Math.sin(up), joins.y + bendRadius * Math.cos(up));
  const begins = at(
    middle.x + bendRadius * Math.sin(heading),
    middle.y - bendRadius * Math.cos(heading),
  );
  const from = at(begins.x - way.x * back, begins.y - way.y * back);
  return {
    lead: chain(
      straight(from, begins),
      turn(middle, bendRadius, (heading * 180) / Math.PI - 90, (up * 180) / Math.PI - 90),
    ),
    body: chain(straight(joins, start), over, leg),
  };
}

/**
 * A written letter's own lead-in, drawn as a join is.
 *
 * Square at the seam end, which is buried in the lead-out of the letter
 * before, and as heavy as that lead-out is. There is no such thing on the
 * written `o` and `a`: a bowl is entered on its own left flank, which is where
 * the stroke that draws it begins, and the lead-out of the letter before runs
 * into it. They carried a flick struck up from the writing line to that flank
 * once, and it stood in the letter before and cut across its foot.
 */
/**
 * The flick a written bowl is entered with on a face that does not join.
 *
 * With nothing before it to run in, the letter carries the start of the
 * stroke itself: a short rise from the writing line to a fifth of the way up
 * its own left flank, where a hand starts an `o`. On a joined face the lead-out
 * of the letter before is that stroke, and there is no flick.
 */
function unjoinedFlick(f: Frame, centre: Vec2): Stroke[] {
  if (f.style.parts.script.on) return [];
  const up = (UPSTROKE * Math.PI) / 180;
  const meets = f.x * 0.32;
  const across = f.bowl * Math.sqrt(Math.max(0, 1 - ((meets - centre.y) / f.bowlH) ** 2));
  const to = at(centre.x - across, meets);
  return [ink(f, bowed(f, at(to.x - to.y / Math.tan(up), 0), to, 0.1), f.end, BUTT)];
}

function leadIn(f: Frame, spine: Spine) {
  return [lighter(ink(f, spine, BUTT, BUTT), joinWeight(f.style))];
}

/**
 * The two-storey g: a small bowl sitting on the x-height, a closed loop hung
 * under the baseline, the link between them and an ear off the top right.
 *
 * Built from four strokes rather than one run, and every place two of them meet
 * is a spine ending on another spine: the link starts on the upper bowl's own
 * centre-line and stops on the loop's, and the ear grows out of the bowl's.
 * A butt end laid on a spine is covered by that stroke's ink on either side at
 * any weight, so nothing shows at a joint and nothing comes apart at a hairline.
 *
 * The heights are shared out rather than fixed. The bowl takes a set share of
 * the x-height, the loop takes whatever is left down to the descender, and both
 * give way to the pen: at a black weight the loop is pushed below the line and
 * flattened until there is still daylight inside it and between the two, which
 * is the choice every heavy text face makes with this letter.
 */
function doubleG(f: Frame): Recipe {
  const loopHalf = Math.max(f.bowl * 0.96, f.least * 1.4);
  const left = f.edge;
  // The upper bowl: narrower than the o and set in from the loop's left side.
  const upperH = Math.max(f.x * 0.33, f.upright + f.half * 0.45, f.least);
  const upperW = Math.max(upperH * f.wide * 1.02, f.least);
  const upper = at(left + loopHalf * 0.16 + upperW, f.crest(f.x) - upperH);
  /*
   * The loop, hung from just under the baseline to the descender.
   *
   * Its top is where the link lands, and it is held clear of the bowl's ink by
   * at least a pen: two storeys touching are one blot with two holes in it.
   */
  // Hung a little lower at a black weight, where the loop needs the height to
  // keep a round counter rather than a slot.
  const bottom = f.dip(f.desc) - f.half * 0.45 * heaviness(f);
  const underBowl = upper.y - upperH - f.upright * 2 - Math.max(f.half * 1.2, f.x * 0.06);
  /*
   * But never so low that the loop has no hole left in it. At a black weight
   * there is not the height for two counters, a link and four thicknesses of
   * pen between the x-height and the descender, and of the things that can
   * give it is the daylight between the storeys that goes: the two meet where
   * the link is, which is ink there anyway, and both counters stay open.
   */
  const loopLeast = f.upright + Math.max(f.half * 0.45, f.x * 0.035);
  const top = Math.max(Math.min(f.x * 0.02, underBowl), bottom + loopLeast * 2);
  const loopH = Math.max((top - bottom) / 2, f.least);
  const loop = at(left + loopHalf, bottom + loopH);
  const roundness = 1 - f.square;
  // Where the link leaves the bowl and where it lands on the loop, both on the
  // centre-lines, so both ends are buried whatever the pen.
  /*
   * At a black weight the link leaves further round the bowl's left side,
   * where the bowl is a stem thick and buries its end: off the thin bottom
   * its end stood into the counter as a nick. And the loop and the link are
   * drawn lighter, so the loop keeps a round counter rather than a slot.
   */
  const heavy = heaviness(f);
  const leaves = bowlPoint(upper, upperW, upperH, roundness, f.half, 242 - 22 * heavy, f.curve);
  const lands = bowlPoint(loop, loopHalf, loopH, roundness, f.half, 118, f.curve);
  // The ear: out of the bowl's top right, level and a little proud of it.
  const from = bowlPoint(upper, upperW, upperH, roundness, f.half, 38, f.curve);
  const earEnd = at(upper.x + upperW + Math.max(f.bowl * 0.42, f.half * 1.6), f.hangs(f.x));
  return {
    ...finish(
      f,
      [
        lighter(ink(f, ring(f, upper, upperW, upperH)), 1 - 0.12 * heavy),
        lighter(ink(f, ring(f, loop, loopHalf, loopH)), 1 - 0.22 * heavy),
        lighter(
          ink(f, bowed(f, leaves, lands, Math.max(0.18 - 0.12 * heavy, 0.06)), BUTT, BUTT),
          1 - 0.36 * heavy,
        ),
        ink(f, bowed(f, from, earEnd, -0.12), BUTT, f.plain),
      ],
      true,
    ),
    air: 0.2,
  };
}

/**
 * How wide an elliptical turn `height` tall can be drawn by this pen without
 * its inside folding: the width asked for, held between the two limits a pen
 * with contrast sets. Where the run lies level, the pen is thin across it and
 * the turn has to be flatter than the pen's own long side is round; where it
 * stands upright, the turn has to be rounder than the pen's short side.
 */
function fitTurn(pen: { weight: number; contrast: number }, height: number, asked: number): number {
  const across = pen.weight / 2;
  const thin = Math.max(across * (1 - Math.max(0, Math.min(pen.contrast, 0.95))), 1e-6);
  const least = Math.sqrt((height * across * across) / thin) * 1.03;
  const most = (height * height * across) / (thin * thin) / 1.03;
  return Math.max(Math.min(asked, most), Math.min(least, most), 1);
}

export const ALTERNATES: Record<LetterName, Alternate[]> = {
  o: [
    {
      id: "written",
      label: "Written",
      hint: "The bowl itself starts on the origin, so the letter before it runs into the bowl rather than into a stroke laid against it.",
      build: (style) => {
        const f = frame(style);
        const centre = at(f.edge + f.bowl, f.x / 2);
        /*
         * The same bowl, and no extra stroke at all: what makes it written is
         * where it is put, not what is drawn.
         *
         * `seam.ts` reads the reference's `o` as carrying ink from -0.00 to
         * 0.41 of an x-height on its own origin -- that is the bowl's own left
         * flank standing on the boundary, not a lead-in reaching back over it.
         * Its bowl runs -0.03 to 1.13 inside an advance of 1.10, so the letter
         * before it laps onto the bowl and the letter after laps onto the next.
         * Marked `entered`, the join stops standing this letter a reach out and
         * slides it until its own flank crosses the seam on the origin, which
         * is the same thing.
         */
        return {
          ...finish(
            f,
            [...unjoinedFlick(f, centre), ink(f, ring(f, centre, f.bowl, f.bowlH))],
            true,
          ),
          entered: true,
        };
      },
    },
  ],

  e: [
    {
      id: "written",
      label: "Written",
      hint: "One rising stroke into the loop, at the letter's own weight, instead of a level bar struck through a bowl.",
      build: (style) => {
        const f = frame(style);
        const centre = at(f.edge + f.bowl, f.x / 2);
        const eye = eyeOf(f, centre);
        const rise = Math.max(-0.85, Math.min(0.85, (eye - centre.y) / f.bowlH));
        const opens = (Math.asin(rise) * 180) / Math.PI;
        const belt = bend(f, centre, f.bowlH, opens, opens + 300);
        /*
         * The bar is the entry, and it climbs.
         *
         * A drawn `e` is a bowl with a level bar struck across it, lighter than
         * the bowl because that is what a crossbar is. A written one has no bar
         * at all: the hand comes up off the line, runs across the letter to the
         * far wall, and turns back over the top -- so what looks like a bar is
         * the first part of the loop, at the letter's own weight, and it rises.
         *
         * `over.ts` showed the drawn one plainly: ours put a straight rule
         * through the letter and out both sides, and the reference's `e` has
         * nothing straight in it anywhere.
         *
         * Two strokes rather than one chained run, because the bar meets the
         * loop across the tangent and a chain whose pieces do not leave where
         * the last one arrived is a spine with a corner in it. Two strokes that
         * cross at the same weight read as one; a corner reads as a knot.
         */
        const start = at(
          centre.x - f.bowl - f.half,
          seamsOf(f.style.parts.script, f.x, f.half).low,
        );
        return {
          ...finish(
            f,
            [
              ink(f, bowed(f, start, spineStart(belt), 0.06), f.end, BUTT),
              ink(f, belt, BUTT, f.end),
            ],
            true,
          ),
          entered: true,
        };
      },
    },
  ],

  a: [
    {
      id: "written",
      label: "Written",
      hint: "The bowl starts on the origin, the way a hand arrives at an `a` — round the bowl first and down the stem after.",
      build: (style) => {
        const f = frame(style);
        const centre = at(f.edge + f.bowl, f.x / 2);
        // The same stem the plain `a` stands, air and all: what changes here is
        // where the letter is put, not how it is drawn. See the written `o`.
        const stem = centre.x + f.bowl + f.aside;
        return {
          ...finish(f, [
            ...unjoinedFlick(f, centre),
            ink(f, ring(f, centre, f.bowl, f.bowlH)),
            ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
          ]),
          air: 0.45,
          entered: true,
        };
      },
    },
    {
      id: "double",
      label: "Two storey",
      hint: "A bowl with an arched top over it, which is what most text faces use.",
      build: (style) => {
        const f = frame(style);
        /*
         * A stem arching over into the head, and a bowl run off the stem
         * below it -- each joined to the stem, as every two-storey a is.
         *
         * A ring laid beside a stem with a hook of a circle over it, as it
         * was, stood the bowl nearly as tall as the x-height under a thin
         * head, so the letter read as a d-less delta; and at a black weight
         * the hook shrank to a flag hung over the bowl with a notch where the
         * two met.
         */
        const heavy = heaviness(f);
        const crest = f.crest(f.x);
        const base = f.dip(0);
        // The bowl takes half the height, the head the rest.
        const waist = base + (crest - base) * (0.5 + 0.03 * Math.min(1, heavy));
        const stem = f.edge + (f.bowl + f.half) * 1.72 - f.half + f.gain * 0.6;
        const across = Math.max((stem - f.edge) / 2, f.least);
        /*
         * At a black weight the bowl is lighter than the stem, so its counter
         * is the bowl's own and not what the stem leaves of it.
         */
        const bowlPen = { ...f.style.pen, weight: f.style.pen.weight * (1 - 0.2 * heavy) };
        // Never a turn tighter than its own pen goes round (see `least`), so
        // at an Ultra the bowl pushes the waist up rather than folding.
        const bowlH = Math.max((waist - base) / 2, bowlPen.weight * 0.53, f.least * 0.8);
        const headH = Math.max((crest - Math.max(waist, base + bowlH * 2)) * 0.96, f.least);
        /*
         * Each turn no wider than it is tall, and what the letter is wider
         * than that run level between them: an elliptical turn much wider
         * than tall turns tighter than the pen at its end, and folded there
         * at a heavy weight.
         */
        const turnW = fitTurn(f.style.pen, headH, Math.min(headH, across * 0.96));
        const right = at(stem - turnW, crest - headH);
        const left = at(Math.min(f.edge + across * 0.04 + turnW, right.x), crest - headH);
        const shoulder = bend(f, right, headH, 0, 90, turnW);
        const hook = bend(f, left, headH, 90, 150, turnW);
        const head = chain(shoulder, straight(spineEnd(shoulder), spineStart(hook)), hook);
        const bowlW = fitTurn(bowlPen, bowlH, Math.min(across * 1.04, bowlH * f.wide * 1.3));
        /*
         * The bowl's foot on the line the stem stands on, not in the
         * overshoot under it: it runs level into the foot of the stem, and
         * carried below the line it ended past the stem's edge in a square
         * step under the foot serif beside it -- ten units deep at a Black.
         */
        const sits = Math.abs(reachAlong(at(0, 1), penReach(bowlPen)).y);
        /*
         * Turned as round as its own lighter pen needs and no rounder: held
         * to the stem's (see `holds`), a Black's bowl stood nearly two thirds
         * of the x-height and squeezed the head's counter to a slit.
         */
        const fb: Frame = { ...f, half: bowlPen.weight / 2, least: (bowlPen.weight / 2) * 1.06 };
        const drawnH = Math.max(bowlH, fb.least);
        const round = bend(fb, at(f.edge + bowlW, sits + drawnH), bowlH, 90, 270, bowlW);
        // Level into the stem from where the turn really starts and stops.
        const bowl = chain(
          straight(at(stem, spineStart(round).y), spineStart(round)),
          round,
          straight(spineEnd(round), at(stem, spineEnd(round).y)),
        );
        const headRun = ink(f, chain(straight(at(stem, 0), spineStart(head)), head), f.end, f.end);
        return finish(f, [{ ...ink(f, bowl, BUTT, BUTT), pen: bowlPen }, headRun]);
      },
    },
  ],

  n: [
    {
      id: "written",
      label: "Written",
      hint: "Entered with the up-stroke the letter is written with, rather than standing on the line for a join to be run in to it.",
      build: (style) => {
        const f = frame(style);
        // Tight, because the reference's first stem comes down almost under its
        // own apex: a wide turn there is an arch, and an `n` with two of those
        // is an `m` with a leg missing.
        const radius = Math.max(f.x * 0.045, f.least);
        const { lead, body } = entering(
          at(f.edge, f.crown),
          radius,
          writtenLead("n", style),
          // The tightest the lead-in's own pen goes round.
          f.half * joinWeight(style) * 1.15,
        );
        const stands = spineEnd(body);
        return {
          ...finish(f, [...leadIn(f, lead), ink(f, body, BUTT, BUTT), arch(f, stands.x, f.x)]),
          entered: true,
        };
      },
    },
  ],

  r: [
    {
      id: "written",
      label: "Written",
      hint: "Hands on from the end of its arm, the way a joined hand writes it, rather than from the foot of its stem.",
      build: (style) => {
        const f = frame(style);
        const stem = f.edge;
        /*
         * A joined hand's `r`: up the stem, over a small shoulder, down the far
         * side on a slant and round a valley into the lead-out, which is the
         * last part of this stroke rather than a stroke run out of the stem.
         *
         * The drawn `r` left from the foot of its stem like every other letter,
         * and its lead-out then ran along the writing line under the arm to
         * reach an advance past the end of it: `rn` read as `Lcn`. Left from
         * the end of the arm instead, it had most of an x-height to fall and a
         * turn from falling to climbing too tight for the pen, and it knotted.
         * So the valley is drawn here, where it can be given the room.
         */
        const lead = writtenLead("r", style);
        // A tighter shoulder than the `n`'s, so the letter reads as an `r`
        // with its arm carried down rather than as a narrow `n`.
        const radius = Math.max(shoulderRadius(f, f.x) * 0.6, f.least);
        const crest = Math.max(f.crest(f.x), radius);
        const landing = stem + Math.max(f.arch * 0.45, radius * 2);
        const fall = 52;
        const falls = (-fall * Math.PI) / 180;
        const climbs = Math.max(Math.atan2(lead.way.y, lead.way.x), 0.2);
        const turned = at(
          landing - radius + radius * Math.cos(((90 - fall) * Math.PI) / 180),
          crest - radius + radius * Math.sin(((90 - fall) * Math.PI) / 180),
        );
        // Where the stroke leaves: a weld under the seam, on its heading.
        const leaves = lead.y - lead.weld * Math.sin(climbs);
        // The valley as round as the room under that allows, its ink kept
        // off the writing line.
        const lift = 1 - Math.cos(climbs);
        const valley = Math.max(
          Math.min(f.x * 0.22, (leaves - f.half) / Math.max(lift, 1e-6)),
          f.least,
        );
        const bottom = leaves - valley * lift;
        const starts = bottom + valley * (1 - Math.cos(-falls));
        const run = Math.max((turned.y - starts) / Math.sin(-falls), 1);
        const into = at(turned.x + run * Math.cos(falls), turned.y + run * Math.sin(falls));
        const centre = at(into.x - valley * Math.sin(falls), into.y + valley * Math.cos(falls));
        const toDegrees = (radians: number) => (radians * 180) / Math.PI;
        return {
          ...finish(f, [
            ink(f, straight(at(stem, 0), at(stem, f.x)), f.end, f.end),
            ink(
              f,
              chain(
                turn(at(stem + radius, crest - radius), radius, 180, 90),
                straight(at(stem + radius, crest), at(landing - radius, crest)),
                turn(at(landing - radius, crest - radius), radius, 90, 90 - fall),
                straight(turned, into),
                turn(centre, valley, toDegrees(falls) - 90, toDegrees(climbs) - 90),
              ),
              BUTT,
              BUTT,
            ),
          ]),
          leaves: true,
        };
      },
    },
  ],

  A: [
    {
      id: "flat",
      label: "Flat top",
      hint: "Cut across the apex instead of coming to a point, which is what a heavy face does to keep the top from going black.",
      build: (style) => {
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
        // Wider at a heavy weight, as the pointed A is, or the counter closes.
        const half =
          Math.max(f.capBowl * 0.86, f.least) + f.half * 0.45 * heaviness(f) + f.gain * 0.7;
        const left = f.edge;
        const middle = left + half;
        const cut = f.capBowl * 0.34 + f.gain * 0.4;
        const rise = f.cap;
        /*
         * The legs cut level on the cap line and the top laid between them
         * hanging from it, so the flat top is one edge along the line. Each leg
         * cut square across itself, with the top bar centred on the line, as it
         * was, left a tab standing above the cap line in the middle of the top.
         */
        const slope = Math.hypot(half - cut / 2, rise) / rise;
        // Half a leg's width along a level line: where its inner edge is.
        const across = f.half * slope;
        /*
         * The bar below where the legs' inner edges meet, by more than a
         * fixed share of the height: at a Black they meet low, and a bar at
         * the regular's height closed the counter over it to a sliver.
         */
        const meets =
          across > cut / 2 ? rise * (1 - (across - cut / 2) / Math.max(half - cut / 2, 1)) : rise;
        const barHalf = f.upright * f.bar;
        const bar = Math.max(
          Math.min(f.cap * f.style.parts.crossbar.height * 0.58, (meets - barHalf * 2) * 0.46),
          barHalf * 2 + f.half * 0.6,
        );
        const inset = ((half - cut / 2) * bar) / rise;
        const leftFoot = at(left, 0);
        const rightFoot = at(middle + half, 0);
        const top = f.hangs(rise, f.bar);
        return finish(f, [
          ink(f, straight(leftFoot, at(middle - cut / 2, rise)), f.end, LEVEL),
          ink(f, straight(rightFoot, at(middle + cut / 2, rise)), f.end, LEVEL),
          thin(f, straight(at(middle - cut / 2, top), at(middle + cut / 2, top))),
          thin(f, straight(at(left + inset, bar), at(middle + half - inset, bar))),
        ]);
      },
    },
  ],

  M: [
    {
      id: "deep",
      label: "Vertex down",
      hint: "The middle carried all the way to the baseline, which widens the two counters and squares the letter off.",
      build: (style) => {
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
        // Each diagonal cut level on the cap line inside its stem, as the
        // plain M's are: see `joinsLevel`.
        if (joinsLevel(f)) {
          let topLeft = at(left, f.cap);
          let topRight = at(right, f.cap);
          let vertex = at(middle, 0);
          for (let pass = 0; pass < 3; pass++) {
            topLeft = leaving(f, at(left, f.cap), 1, vertex, 1);
            topRight = leaving(f, at(right, f.cap), -1, vertex, -1);
            vertex = corner(f, topLeft, at(middle, 0), topRight);
          }
          return finish(f, [
            ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
            ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
            ink(f, chain(straight(topLeft, vertex), straight(vertex, topRight)), LEVEL, LEVEL),
          ]);
        }
        const into = stub(f);
        const start = at(left, f.cap - into);
        const end = at(right, f.cap - into);
        const points = through(f, [start, at(left, f.cap), at(middle, 0), at(right, f.cap), end]);
        return finish(f, [
          ink(f, straight(at(left, 0), at(left, f.cap)), f.end, f.end),
          ink(f, straight(at(right, 0), at(right, f.cap)), f.end, f.end),
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
      },
    },
  ],

  R: [
    {
      id: "curved",
      label: "Curved leg",
      hint: "The leg swung out from under the bowl rather than run straight to the corner.",
      build: (style) => {
        const f = frame(style);
        const stem = f.edge;
        const radius = Math.max(f.cap * 0.27, f.least);
        /*
         * The plain R's bowl -- as wide as the P's and the B's, with the same
         * flat top and waist -- and only the leg swung. Drawn on a half circle
         * a radius wide instead, the bowl came out two fifths as wide as the
         * P's beside it: a narrow D stuck to the stem over a long leg, which
         * read as a k or a small capital.
         */
        const junction = f.hangs(f.cap) - radius * 2;
        const bowl = Math.max(f.capBowl * 1.08, radius * f.wide);
        // Sprung from the bowl's underside, further out at a heavy weight so
        // there is a crotch between the leg and the stem.
        const springs = at(stem + bowl * 0.42 + f.gain * 0.6, junction);
        const foot = at(stem + bowl * 1.1, 0);
        return finish(f, [
          ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
          lobe(f, stem, junction, f.hangs(f.cap), bowl),
          // One arc from the junction to the foot, bowed out to the right.
          // Less bowed at a heavy weight, where a full bow closed the lower counter.
          ink(f, bowed(f, springs, foot, 0.1 * (1 - 0.6 * Math.min(1, heaviness(f)))), BUTT, f.end),
        ]);
      },
    },
  ],

  Q: [
    {
      id: "swept",
      label: "Swept tail",
      hint: "The tail leaving the foot of the bowl and sweeping out to the right under the line, as a text serif draws it.",
      build: (style) => {
        const f = frame(style);
        const centre = at(f.edge + f.capBowl, f.cap / 2);
        /*
         * From the bottom of the bowl, a little left of its middle, on the
         * bowl's own centre-line so the start is buried; then down and out,
         * flattening as it goes, to well past the bowl's right side. One arc,
         * bowed below its chord, so it leaves the bowl falling and arrives
         * nearly level -- the long stroke Lora and most old-style faces draw.
         */
        const leaves = bowlPoint(
          centre,
          f.capBowl,
          f.capBowlH,
          1 - f.square,
          f.half,
          -100,
          f.curve,
        );
        const reaches = at(
          centre.x + f.capBowl * 1.3,
          f.dip(0) - Math.max(f.cap * 0.2, f.half * 2.2),
        );
        return finish(
          f,
          [
            ink(f, ring(f, centre, f.capBowl, f.capBowlH)),
            ink(f, bowed(f, leaves, reaches, -0.2), BUTT, f.plain),
          ],
          true,
        );
      },
    },
    {
      id: "under",
      label: "Tail below",
      hint: "The tail hung under the bowl instead of crossing its wall, which is what a geometric face usually does.",
      build: (style) => {
        const f = frame(style);
        const centre = at(f.edge + f.capBowl, f.cap / 2);
        const leaves = bowlPoint(centre, f.capBowl, f.capBowlH, 1 - f.square, f.half, -80, f.curve);
        return finish(
          f,
          [
            ink(f, ring(f, centre, f.capBowl, f.capBowlH)),
            ink(f, straight(leaves, at(leaves.x + f.capBowl * 0.62, -f.cap * 0.16)), BUTT, f.end),
          ],
          true,
        );
      },
    },
  ],

  G: [
    {
      id: "spurred",
      label: "Upright spur",
      hint: "The bowl carried round into a short upright on the right, with no bar turned in: the G of most text serifs.",
      build: (style) => {
        const f = frame(style);
        const centre = at(f.edge + f.capBowl, f.cap / 2);
        const roundness = 1 - f.square;
        // The same aperture the plain G opens to, so the top end clears.
        const clear = (((f.half * 2.4) / f.capBowlH) * 180) / Math.PI;
        const opens = Math.max(32, clear);
        /*
         * The bowl stops a little short of its lowest right-hand point and an
         * upright rises from there to just under the middle of the letter.
         * The upright starts on the bowl's own centre-line, so its square foot
         * is inside the bowl's ink; its top is a stroke end like any other and
         * takes the face's terminal, which on a serif face is the spur.
         */
        const joins = 302;
        const foot = bowlPoint(centre, f.capBowl, f.capBowlH, roundness, f.half, joins, f.curve);
        const top = Math.max(f.cap * 0.47, foot.y + f.half * 2);
        /*
         * And the bowl's end is cut upright, and the upright stands on the
         * cut's outer corner with its outer side along it.
         *
         * Cut square, the bowl's end came up to the upright at a slant: its
         * outer corner stood out beyond the upright as a point, with a notch
         * between the two, and the heavier the pen the bigger both. Carrying the
         * cut's inner corner on round the curve until it stands over the outer
         * one gives the bowl an upright end, and the upright is set on it.
         */
        const bowl = bowlBetween(
          centre,
          f.capBowl,
          f.capBowlH,
          roundness,
          f.half,
          opens,
          joins,
          f.curve,
        );
        const end = spineEnd(bowl);
        // The way the last piece that goes anywhere is travelling: a bowl can
        // finish on a run of no length.
        const heading =
          [...bowl.segments]
            .reverse()
            .map((segment) => headingAt(segment, "end"))
            .find((way) => Math.hypot(way.x, way.y) > 0.5) ?? at(1, 0);
        const pen = penReach(f.style.pen);
        const reach = reachAlong(at(-heading.y, heading.x), pen);
        const outer =
          heading.x * reach.y - heading.y * reach.x < 0 ? reach : at(-reach.x, -reach.y);
        const corner = at(end.x + outer.x, end.y + outer.y);
        const carry = heading.x > 0.05 ? (2 * outer.x) / heading.x : 0;
        const upright = f.square < 0.01 && carry > 0;
        const cut = upright ? (Math.atan(carry / (2 * pen.across)) * 180) / Math.PI : 0;
        const side = Math.abs(reachAlong(at(1, 0), pen).x);
        const stand = upright ? at(corner.x - side, corner.y + 1) : foot;
        return finish(
          f,
          [
            ink(f, bowl, f.end, upright ? { kind: "angled", angle: cut } : BUTT),
            ink(f, straight(stand, at(stand.x, top)), BUTT, f.end),
          ],
          true,
        );
      },
    },
    {
      id: "bare",
      label: "No bar",
      hint: "A G with nothing turned back into it: a C with its end cut level. The cleanest of the geometric Gs.",
      build: (style) => {
        const f = frame(style);
        const centre = at(f.edge + f.capBowl, f.cap / 2);
        const clear = (((f.half * 2.4) / f.capBowlH) * 180) / Math.PI;
        return finish(
          f,
          [openBowl(f, centre, f.capBowl, f.capBowlH, Math.max(32, clear), 360)],
          true,
        );
      },
    },
  ],

  l: [
    {
      id: "tailed",
      label: "With a tail",
      hint: "Turned out at the foot, which stops an l reading as a figure one.",
      build: (style) => {
        const f = frame(style);
        // Never turned so tight that the inside of the turn is a notch.
        const radius = Math.max(f.arch * 0.42, f.least, f.half * 1.5);
        return finish(f, [
          ink(
            f,
            chain(
              straight(at(f.edge, f.asc), at(f.edge, radius)),
              turn(at(f.edge + radius, radius), radius, 180, 270),
              // A little way on along the line, as the t's foot does.
              straight(at(f.edge + radius, 0), at(f.edge + radius + f.half * 0.6, 0)),
            ),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],

  t: [
    {
      id: "straight",
      label: "No foot",
      hint: "Cut off square at the baseline, which is what a squared or technical face wants.",
      build: (style) => {
        const f = frame(style);
        const reach = tReach(f);
        const stem = tStem(f);
        return finish(f, [
          // Capped at the foot, cut at the top, as the plain t is.
          ink(
            f,
            straight(
              at(stem, 0),
              at(stem, Math.min(Math.max(f.asc * 0.78, f.x + f.half * 1.5), f.asc)),
            ),
            f.end,
            f.plain,
          ),
          crossbar(f, stem - reach * 0.7, stem + reach),
        ]);
      },
    },
  ],

  y: [
    {
      id: "hooked",
      label: "Hooked tail",
      hint: "The right arm runs on through the vee and curls round to the left under the line, as a text face's does.",
      build: (style) => {
        const f = frame(style);
        const half = f.arch * 0.92;
        const left = f.edge;
        const middle = left + half;
        const top = at(middle + half, f.x);
        const apex = at(middle, 0);
        // Where the left arm stops: on the tail's own spine, just above the
        // baseline, so both corners of its square end are buried in the tail.
        // Stopped on the line it was cut level along it, and the cut stood out
        // of the tail as a ledge.
        const lift = f.half * 0.5;
        const stop = at(middle + (half * lift) / f.x, lift);
        const heading = {
          x: (apex.x - top.x) / Math.hypot(half, f.x),
          y: -f.x / Math.hypot(half, f.x),
        };
        // To the right of the way the tail is going, which is where it turns.
        const right = { x: heading.y, y: -heading.x };
        const radius = Math.max(f.arch * 0.62, f.half * 1.7);
        const centreY = f.dip(f.desc) + radius;
        const kneeY = centreY - radius * right.y;
        const along = (kneeY - top.y) / heading.y;
        const knee = at(top.x + heading.x * along, kneeY);
        const centre = at(knee.x + radius * right.x, centreY);
        const from = (Math.atan2(knee.y - centre.y, knee.x - centre.x) * 180) / Math.PI;
        const hook = turn(centre, radius, from, -112);
        return finish(f, [
          /*
           * The left arm stops inside the tail, just above where the two
           * spines cross. Carried on past them, its square end stood out of
           * the right side of the tail as a spur at every weight.
           */
          ink(f, straight(at(left, f.x), stop), f.end, BUTT),
          ink(
            f,
            chain(straight(top, knee), {
              ...hook,
              segments: hook.segments.map((one) => ({ ...one, pieces: 2 })),
            }),
            f.end,
            f.end,
          ),
        ]);
      },
    },
    {
      id: "straight",
      label: "Straight tail",
      hint: "A vee with the right arm carried straight down past the baseline, rather than the tail leaving at its own angle.",
      build: (style) => {
        const f = frame(style);
        const half = f.arch * 0.92;
        const left = f.edge;
        const middle = left + half;
        const top = at(left, f.x);
        const other = at(middle + half, f.x);
        const point = corner(f, top, at(middle, 0), other);
        return finish(f, [
          ink(f, chain(straight(top, point), straight(point, other)), f.end, f.end),
          /*
           * The tail leaves the vee's apex, which is not where `corner` put the
           * vee's vertex.
           *
           * `corner` pushes a vertex out along its own bisector by as far as
           * the rounding is going to pull the turn back, so that the *rounded*
           * apex lands where the letter asked for it -- here, on the baseline.
           * Started at that pushed vertex the tail began below the ink instead
           * of inside it: on the Marker it hung ninety units under a vee it had
           * never touched, and on the Casual Script the letter was a `v` with a
           * loose stub floating beneath it. Both faces round their corners. The
           * ones that round nothing were fine, because there the pushed vertex
           * and the apex are the same point, which is why this survived.
           *
           * Half a pen above the apex is inside the ink at any weight and any
           * radius -- the two arms are barely a pen apart by then -- and the cut
           * is square and buried, so none of it shows.
           */
          ink(f, straight(at(middle, f.half), at(middle, f.desc)), BUTT, f.end),
        ]);
      },
    },
  ],

  J: [
    {
      id: "descending",
      label: "Below the line",
      hint: "The hook carried under the baseline, which is what an old-style or a display face does with a J.",
      build: (style) => {
        const f = frame(style);
        const radius = Math.max(f.capBowl * 0.55, f.least);
        const stem = f.edge + radius;
        return finish(f, [
          ink(
            f,
            chain(
              straight(at(stem, f.cap), at(stem, f.dip(f.desc) + radius)),
              turn(at(stem - radius, f.dip(f.desc) + radius), radius, 0, -95),
            ),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],

  k: [
    {
      id: "standing",
      label: "With the leg standing",
      hint: "The leg curving over and coming down onto the baseline instead of running out to a point, which is what a hand does with a k it has to carry on out of.",
      build: (style) => {
        const f = frame(style);
        const stem = f.edge;
        const span = f.arch * 1.7;
        const waist = f.x * 0.42;
        const foot = stem + span;
        /*
         * Where the leg stops falling and starts standing.
         *
         * A straight leg runs out to a point on the baseline, and on a joined
         * face the lead-out cannot leave from that point: it takes the letter's
         * rightmost skeleton between half a pen up and the seam, and the last
         * stretch of a diagonal leg is below that band. So the join left from
         * partway up the leg and the rest of the leg carried on past it, down
         * and to the right -- the arm, the join and the tip of the leg all
         * leaving the same corner pointing the same way.
         *
         * Turned upright, the leg's own foot is the rightmost thing there is
         * and the join leaves from its side, which is what happens on an `n`
         * and is why an `n` never had this. Half a pen up is as high as the
         * turn needs to start: it is exactly what the band excludes. Higher
         * and the fall gets shared with the upright, and at a fifth of the
         * x-height the diagonal is down to seventeen degrees and reads as a
         * bar with a drop on the end rather than as a leg.
         */
        /*
         * And never above the junction the leg falls from.
         *
         * Half a pen is a floor, not a height: on a face whose x-height is
         * small against its pen -- a hairline script wound up to a heavy weight
         * -- a pen and a third is most of the way to the waist, so the leg was
         * asked to fall from the junction to a knee above it and folded back on
         * itself. Kept under half the drop, the leg always falls.
         */
        const knee = at(foot, Math.min(Math.max(f.half * 1.3, f.least), waist * 0.55));
        // The arm stops short of the leg rather than on the same line as it,
        // so the two are not one symmetrical V lying on its side.
        const arm = at(stem + span * 0.84, f.x);
        /*
         * Aimed at the stem's own line rather than at its far edge.
         *
         * `junction` aims a vee at the far edge and leaves the apex's own ink
         * to cover the rest, which holds while the corner is sharp enough to
         * miter out past its vertex. This vee's corner is blunter than a
         * straight-legged k's, because the leg leaves it shallower to have
         * somewhere to turn upright, so the apex reaches less far -- and on the
         * Formal Script the vee and the stem finished two units apart. Half a
         * pen deeper is inside the stem's ink at any weight, and it is where a
         * written k's vee springs from in any case.
         */
        const meet = junction(f, arm, stem - f.half, waist, knee);
        return finish(f, [
          ink(f, straight(at(stem, 0), at(stem, f.asc)), f.end, f.end),
          ink(
            f,
            chain(
              straight(arm, meet),
              roundCorners(
                chain(straight(meet, knee), straight(knee, at(foot, 0))),
                Math.max(f.arch * 0.35, f.least),
                f.half,
              ),
            ),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],

  f: [
    {
      id: "descending",
      label: "With a descender",
      hint: "An f that carries below the baseline, as an italic or a display face does.",
      build: (style) => {
        const f = frame(style);
        const radius = Math.max(roundHalf(f) * 0.6, f.least);
        const left = Math.max(roundHalf(f) * 0.36, f.least);
        const stem = f.edge + left;
        const lower = Math.max(f.arch * 0.5, f.least);
        const top = f.crest(f.asc) - radius;
        const base = f.dip(f.desc) + lower;
        /*
         * Written from the top of the hook downwards, which is the direction
         * the whole run travels.
         *
         * Written the other way up it read as three pieces that happened to be
         * listed together: the first turn ended nowhere near where the straight
         * began, the chain had a jump in it, and the letter folded. A chain is
         * a journey, and every piece has to leave where the last one arrived.
         *
         * The hook is on the right and the tail on the left, which is the way
         * round every descending f is drawn: the run starts out over the letter
         * after this one and finishes under the letter before it.
         */
        return finish(f, [
          ink(
            f,
            chain(
              turn(at(stem + radius, top), radius, 88, 180),
              straight(at(stem, top), at(stem, base)),
              turn(at(stem - lower, base), lower, 0, -95),
            ),
            f.end,
            f.end,
          ),
          crossbar(f, stem - left, stem + roundHalf(f) * 0.57),
        ]);
      },
    },
  ],

  one: [
    {
      id: "footed",
      label: "With a foot",
      hint: "A bar across the base, which stops a one leaning on the letters either side of it.",
      build: (style) => {
        const f = frame(style);
        const width = figureWidth(f);
        const stem = f.edge + width * 0.46;
        const flag = Math.max(width * 0.3, f.least);
        return finish(f, [
          ink(f, straight(at(stem, 0), at(stem, f.cap)), BUTT, f.end),
          ink(f, straight(at(stem - flag, f.cap * 0.8), at(stem, f.hangs(f.cap))), f.end, BUTT),
          thin(
            f,
            straight(at(stem - flag, f.sits(0, f.bar)), at(stem + flag, f.sits(0, f.bar))),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],

  four: [
    {
      id: "open",
      label: "Open",
      hint: "The diagonal stopping at the bar rather than closing the counter, which reads more clearly at a small size.",
      build: (style) => {
        const f = frame(style);
        const width = figureWidth(f);
        const left = f.edge;
        const stem = left + width * 0.72;
        const bar = f.cap * 0.28;
        return finish(f, [
          ink(f, straight(at(stem, 0), at(stem, f.cap)), f.end, f.end),
          ink(f, straight(at(stem, f.hangs(f.cap)), at(left, bar)), BUTT, f.end),
          thin(f, straight(at(left, bar), at(left + width, bar)), BUTT, f.end),
        ]);
      },
    },
  ],

  seven: [
    {
      id: "barred",
      label: "Barred",
      hint: "A bar across the middle, which is how a seven is written where it would otherwise be read as a one.",
      build: (style) => {
        const f = frame(style);
        const width = figureWidth(f);
        const left = f.edge;
        const start = at(left, f.hangs(f.cap));
        const end = at(left + width * 0.28, 0);
        const meet = at(corner(f, start, at(left + width, f.cap), end).x, start.y);
        const bar = f.cap * 0.42;
        return finish(f, [
          ink(f, chain(straight(start, meet), straight(meet, end)), f.end, f.end),
          thin(
            f,
            straight(at(left + width * 0.18, bar), at(left + width * 0.78, bar)),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],

  W: [
    {
      id: "crossed",
      label: "Crossed",
      hint: "The middle carried to the full cap height so the two vees overlap, which is the older way of building a W.",
      build: (style) => {
        const f = frame(style);
        // Never narrower than the pen can hold a vee open, for the same
        // reason the A is not: the round capitals are measured by their ink
        // now, so at a heavy weight everything sized against them comes down.
        const half = Math.max(f.capBowl * 0.62, f.half * 1.6);
        const left = f.edge;
        const first = through(f, [
          at(left, f.cap),
          at(left + half, 0),
          at(left + half * 2.4, f.cap),
        ]);
        const second = through(f, [
          at(left + half * 1.2, f.cap),
          at(left + half * 2.2, 0),
          at(left + half * 3.2, f.cap),
        ]);
        return finish(f, [
          ink(f, chain(straight(first[0], first[1]), straight(first[1], first[2])), f.end, f.end),
          ink(
            f,
            chain(straight(second[0], second[1]), straight(second[1], second[2])),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],

  g: [
    {
      id: "double",
      label: "Two storey",
      hint: "A small bowl over a closed loop, joined by a link, with an ear at the top: the binocular g of most text serifs.",
      build: (style) => doubleG(frame(style)),
    },
    {
      id: "curled",
      label: "Curled tail",
      hint: "The descender carried further round, which is warmer than a straight hook and is what a display face tends to want.",
      build: (style) => {
        const f = frame(style);
        const centre = at(f.edge + f.bowl, f.x / 2);
        const stem = centre.x + f.bowl;
        const radius = Math.max(f.arch * 0.95, f.least);
        return finish(f, [
          ink(f, ring(f, centre, f.bowl, f.bowlH)),
          ink(
            f,
            chain(
              straight(at(stem, f.x), at(stem, f.dip(f.desc) + radius)),
              turn(at(stem - radius, f.dip(f.desc) + radius), radius, 0, -150),
            ),
            f.end,
            f.end,
          ),
        ]);
      },
    },
  ],
};

/*
 * The neo-grotesque's own letters, offered on every face and drawn by default
 * on the Sans: see `grotesque.ts`.
 */
const GROTESQUE: Array<[LetterName, string, (style: Style) => Recipe]> = [
  [
    "a",
    "A spur at the foot of the stem and a terminal cut level, as a neo-grotesque draws it.",
    grotesqueA,
  ],
  [
    "g",
    "Single storey, the tail running down the stem and hooking flat under the bowl.",
    grotesqueG,
  ],
  ["f", "A flat hook cut upright at the ascender, and a bar reaching further right.", grotesqueF],
  ["j", "The tail turning out into a short flat foot under the line.", grotesqueJay],
  [
    "r",
    "The n's own shoulder, running flat along the x-height to an upright cut.",
    grotesqueSmallR,
  ],
  [
    "t",
    "The foot turning out along the baseline, the head cut level above the x-height.",
    grotesqueT,
  ],
  ["y", "The right arm running straight on under the line into a short flat foot.", grotesqueY],
  ["G", "The C's ring run into an upright under a bar, on the baseline.", grotesqueCapitalG],
  ["J", "Wide, with the hook sitting on the baseline and no descender.", grotesqueJ],
  ["R", "The leg leaving the foot of the bowl and coming down nearly upright.", grotesqueR],
  ["one", "A flag curving off the head, and no foot.", grotesqueOne],
  [
    "seven",
    "The stroke falling from the arm and settling upright on the baseline.",
    grotesqueSeven,
  ],
  ["l", "The stem turning out at its foot into a short tail cut upright.", grotesqueL],
  ["k", "The leg leaving the arm rather than the stem, both cut level.", grotesqueK],
  ["K", "The leg leaving the arm rather than the stem, both cut level.", grotesqueCapitalK],
  ["M", "Upright stems and a vertex carried down to the baseline, cut flat.", grotesqueM],
  ["s", "Two superelliptic bowls and a straight spine, both ends cut level.", grotesqueS],
  ["S", "Two superelliptic bowls and a straight spine, both ends cut level.", grotesqueCapitalS],
  ["z", "Bars at the stem's weight and a diagonal run square into their ends.", grotesqueZ],
  ["Z", "Bars at the stem's weight and a diagonal run square into their ends.", grotesqueCapitalZ],
  ["v", "Both strokes cut level, meeting in a flat vertex on the baseline.", grotesqueV],
  [
    "u",
    "The n turned round: a stem down the right, the trough springing into it.",
    grotesqueSmallU,
  ],
  ["w", "A middle apex reaching the x-height, every stroke cut level.", grotesqueSmallW],
  ["V", "Both strokes cut level, meeting in a flat vertex on the baseline.", grotesqueCapitalV],
  ["Q", "A straight tail through the foot of the O, cut level.", grotesqueCapitalQ],
  ["O", "Heavier at its sides than across its crowns, at Geist's width.", grotesqueCapitalO],
  ["D", "A bowl flat along the lines, as heavy at its side as the O.", grotesqueCapitalD],
  ["e", "A level bar and a terminal cut level well up the right.", grotesqueE],
  ["c", "The o's ring cut level at both ends.", grotesqueC],
  ["C", "The O's ring cut level at both ends.", grotesqueCapitalC],
  ["B", "Flat-sided bowls, the lower the wider, meeting below the middle.", grotesqueCapitalB],
  ["P", "A flat-sided bowl, deeper than the B's upper.", grotesqueCapitalP],
  ["Y", "Straight arms cut level, meeting low on the stem.", grotesqueCapitalY],
  ["A", "A flat head cut level on the cap line, and a low bar.", grotesqueCapitalA],
  ["N", "The diagonal cut level on the cap line and the baseline.", grotesqueN],
  ["W", "A middle apex reaching the cap line, every stroke cut level.", grotesqueW],
  ["exclam", "A stem narrowing to its foot over a square dot.", grotesqueExclam],
  ["quotesingle", "Tapered, narrowing to its foot.", grotesqueQuoteSingle],
  ["quotedbl", "Tapered, narrowing to their feet.", grotesqueQuoteDouble],
  ["hyphen", "A third of an em long, at the stem's weight.", grotesqueHyphen],
  ["parenleft", "Tall, from over the ascender to under the line, cut level.", grotesqueParenLeft],
  ["parenright", "Tall, from over the ascender to under the line, cut level.", grotesqueParenRight],
  ["slash", "Long, from under the line to over the ascender, cut level.", grotesqueSlash],
  [
    "numbersign",
    "Slanted uprights and two bars, a little lighter than the stem.",
    grotesqueNumberSign,
  ],
  ["percent", "Narrow ovals and a long diagonal cut level.", grotesquePercent],
  ["asciicircum", "A narrow caret cut level at its head and feet.", grotesqueCaret],
  ["bracketleft", "Tall and wide, the arms long at every weight.", grotesqueBracketLeft],
  ["bracketright", "Tall and wide, the arms long at every weight.", grotesqueBracketRight],
  ["braceleft", "Round turns into a short level nose.", grotesqueBraceLeft],
  ["braceright", "Round turns into a short level nose.", grotesqueBraceRight],
  ["backslash", "Long, from over the ascender to under the line, cut level.", grotesqueBackslash],
  ["plus", "As tall as it is wide, the bars a little lighter than the stem.", grotesquePlus],
  ["less", "Shallow arms cut upright, meeting in a short flat.", grotesqueLess],
  ["greater", "Shallow arms cut upright, meeting in a short flat.", grotesqueGreater],
  ["equal", "Two long bars, well apart.", grotesqueEqual],
  ["underscore", "A long bar hanging from the line.", grotesqueUnderscore],
  ["asciitilde", "A wave of two equal arcs, cut level at both ends.", grotesqueTilde],
  ["grave", "Steep, cut level at both ends.", grotesqueGrave],
  ["acute", "Steep, cut level at both ends.", grotesqueAcute],
  ["circumflex", "The caret's shape, a level head over level feet.", grotesqueCircumflexAccent],
  ["dieresis", "Two dots cut square, well apart.", grotesqueDieresis],
  ["bar", "From under the line to over the ascender, as the brackets run.", grotesqueBar],
  ["dollar", "The S with a light bar straight through it, standing well out.", grotesqueDollar],
  ["tilde", "A wave of two equal arcs, cut level at both ends.", grotesqueTildeAccent],
  [
    "section",
    "An s over its own turned copy, the two sharing one ring in the middle.",
    grotesqueSection,
  ],
  ["asterisk", "Six arms, one bar level and two crossing it, hung high.", grotesqueAsterisk],
  ["at", "A single-storey a whose stem runs on into a wide ring round it.", grotesqueAt],
  ["zero", "A tall superelliptic ring, as a neo-grotesque's is.", grotesqueZero],
  ["eight", "Two rings touching at the waist, the upper smaller and narrower.", grotesqueEight],
  ["two", "A bowl running down in one reverse curve into the foot, cut level.", grotesqueTwo],
  ["three", "Two bowls, the lower the larger, meeting at a short square tongue.", grotesqueThree],
  ["four", "Closed at the head, with a low bar carried a little past the stem.", grotesqueFour],
  ["five", "A short leaning stem cut level, and a round bowl swung out of it.", grotesqueFive],
  ["six", "A tall hood rising out of the bowl to a terminal cut level.", grotesqueSix],
  ["nine", "A tall tail falling from the bowl to a terminal cut level.", grotesqueNine],
  ["ampersand", "A small loop at the head, a round bowl and a straight leg.", grotesqueAmpersand],
  [
    "question",
    "A superelliptic hook, a straight diagonal and a short upright neck.",
    grotesqueQuestion,
  ],
  [
    "E",
    "The lowest arm the longest, the middle a little short and near the middle.",
    grotesqueCapitalE,
  ],
  ["F", "The middle arm a little short and a little below the middle.", grotesqueCapitalF],
  ["H", "The bar a little above the middle, the stems set wide.", grotesqueCapitalH],
  ["L", "A long foot, as a neo-grotesque's is.", grotesqueCapitalL],
  ["T", "A wide bar hung from the cap line.", grotesqueCapitalT],
  ["U", "Set wide, with a round trough.", grotesqueCapitalU],
  ["i", "A square dot, less tall than wide at a heavy weight.", grotesqueI],
];
for (const [name, hint, build] of GROTESQUE) {
  if (!ALTERNATES[name]) ALTERNATES[name] = [];
  /*
   * A joined hand draws its own letters, into and out of the join: a
   * grotesque's square-cut bars and level ends have nowhere for the join to
   * run in, and on a slanted, swelling pen they came apart from it. And a pen
   * held on its side draws its own, whose heavy strokes are the level ones.
   */
  const drawn = (style: Style) =>
    (style.parts.script.on || Math.abs(Math.abs(style.pen.angle) - 90) < 30) && LETTERS[name]
      ? LETTERS[name](style)
      : build(style);
  ALTERNATES[name].push({ id: "grotesque", label: "Grotesque", hint, build: drawn });
}

/*
 * The old-style text face's own letters, offered on every face and drawn by
 * default on the Serif: see `humanist.ts`.
 */
const HUMANIST: Array<[LetterName, string, (style: Style) => Recipe]> = [
  ["e", "The eye set high over a long belly, as an old-style face draws it.", humanistE],
  ["u", "The right stem carried on down to the line on its own serifs.", humanistU],
  ["t", "Standing well over the x-height under a wedge rising from the bar.", humanistT],
  ["U", "The right side a hairline, written on the way back up.", humanistCapitalU],
  ["g", "A link swinging out to the left and an ear rising into a drop.", humanistG],
  ["ampersand", "A loop and a bowl joined across, a long diagonal into a foot.", humanistAmpersand],
  ["at", "A small a whose tail runs out into the ring, on the face's own pen.", humanistAt],
  ["a", "Two storeys, the bowl hung low and light under an arch ending in a drop.", humanistA],
  ["j", "The tail carried round under the line and back up into a drop.", humanistJ],
  ["seven", "The stem bowed as it falls, ending in a round tail.", humanistSeven],
  ["five", "A heavy flag turning up at its end, over a hairline stem.", humanistFive],
  ["hyphen", "Long and deep, a little over the middle of the x-height.", humanistHyphen],
  ["slash", "From the descender to over the ascender, leaning well over.", humanistSlash],
  ["exclam", "A wedge, round at its head, narrowing to its foot.", humanistExclam],
  ["A", "A hairline leg and a full one meeting in a point over the cap line.", humanistCapitalA],
  ["w", "Two vees crossing, the middle running up to a point with no serif.", humanistW],
  ["k", "A hairline arm into the stem and the leg leaving the arm.", humanistK],
  ["s", "Run a little wider past a Black, so both counters stay open.", humanistS],
  ["S", "One S-curve from end to end, its spine on the bowls' own tangents.", humanistCapitalS],
  ["R", "The leg falling from the bowl in a curve into a level end.", humanistCapitalR],
  ["K", "A hairline arm into the stem and the leg leaving the arm.", humanistCapitalK],
  ["W", "Two vees crossing, the middle running up to a point with no serif.", humanistCapitalW],
  [
    "o",
    "The sides heavier than a stem and the crown a hairline, as a broad nib leaves them.",
    humanistO,
  ],
  ["c", "The sides heavier than a stem, as a broad nib leaves them.", humanistC],
  [
    "O",
    "The sides heavier than a stem and the crown a hairline, as a broad nib leaves them.",
    humanistCapitalO,
  ],
  ["C", "The sides heavier than a stem, as a broad nib leaves them.", humanistCapitalC],
  ["zero", "The sides heavier than a stem, as a broad nib leaves them.", humanistZero],
  ["N", "Hairline stems and a heavy diagonal, as a broad nib draws it.", humanistCapitalN],
  ["M", "Splayed stems, the left a hairline, and the vertex on the line.", humanistCapitalM],
  [
    "Q",
    "The tail leaving the foot nearly level and falling away right in a long S.",
    humanistCapitalQ,
  ],
];
for (const [name, hint, build] of HUMANIST) {
  if (!ALTERNATES[name]) ALTERNATES[name] = [];
  const drawn = (style: Style) =>
    (style.parts.script.on || Math.abs(Math.abs(style.pen.angle) - 90) < 30) && LETTERS[name]
      ? LETTERS[name](style)
      : build(style);
  ALTERNATES[name].push({ id: "humanist", label: "Humanist", hint, build: drawn });
}
