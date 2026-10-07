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
import { bowl, bowlBetween, bowlPoint, spineEnd, spineStart } from "../shapes";
import { MITER_LIMIT, penReach, reachAlong, sweep } from "../sweep";
import { contoursBounds, inkRunsAt } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import type { Vec2 } from "@/font/types";
import type { Spine, Stroke, Terminal } from "../types";
import {
  arm,
  bendWidth,
  figureWidth,
  headingAt,
  heavyFigure,
  hookFrom,
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
  pointOn,
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
  bookish,
} from "./common";

/** How much further round the e's tail runs than the construction's, in degrees. */
const E_TAIL = 5;
/**
 * And how much further still at the heaviest, where the bowl starts later
 * and the bar stands higher (`E_LIFT`): cut short of the construction's, a
 * heavy tail ended in a chop standing down on the line.
 */
const E_FURTHER = 2;
/** And how many degrees further round its bowl starts at the heaviest, lifting its bar. */
const E_LIFT = 14;

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
  /*
   * Past a Black, the bar lifted off the tail: held a stem and a half deep,
   * the eye pushed the bar down until the tail's end ran up under it and the
   * aperture was a chink, the tail's end sliced off against the bar. Begun a
   * little further round, the bowl hangs its bar higher and shares the
   * height between the two.
   */
  const f = frame(style);
  const past = textSerif(f) ? Math.min(1, Math.max(0, (heaviness(f) - 1) / 0.5)) : 0;
  if (past > 0) drawn = eyed(style, height, E_LIFT * past);
  return drawn.recipe;
}

/** Whether a face is a text serif's -- wedge serifs on a pen with contrast. */
export function textSerif(f: ReturnType<typeof frame>): boolean {
  return bookish(f) && f.style.parts.slab.shape === "wedge";
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
function eyed(
  style: Style,
  height: number,
  lift = 0,
): { recipe: Recipe; bar: number; asked: number } {
  const raised = {
    ...style,
    parts: { ...style.parts, crossbar: { ...style.parts.crossbar, height } },
  };
  const drawn = swollen(raised, LETTERS.e(raised));
  const [across, given, ...rest] = drawn.strokes;
  if (!given || given.spine.closed) return { recipe: drawn, bar: 0, asked: 0 };
  const belt =
    lift > 0 ? inherit(given, { ...given, spine: startedLater(given.spine, lift) }) : given;
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
    // Cut level only where the bowl rises steeply out of the bar: at the
    // slider's heaviest with the pen at 60 it began nearly level, and its
    // level cut slid a corner out three times the letter's width.
    if (dir.y > 0.5) {
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
  /*
   * And the tail carried on round, as far as Lora's reaches -- out under the
   * side of the bowl and up to a fifth of the x-height -- to a Bold; back to
   * the construction's by a Black; and a little further again past a Black,
   * where the bar is lifted clear of it. Cut short there instead, the tail
   * ended low in a heavy chop reaching down to the line, which read as a
   * flare under the letter.
   */
  const f = frame(style);
  // A text serif's: on a sans drawing this e, past a Black was left as it was.
  const heavy = textSerif(f) ? heaviness(f) : Math.min(1, heaviness(f));
  // Lora's reach is a text serif's: another face choosing this e keeps the
  // construction's tail to a Black.
  const reaches = textSerif(f) ? E_TAIL * Math.min(1, Math.max(0, 1 - (heavy - 0.44) / 0.56)) : 0;
  const more = heavy <= 1 ? reaches : E_FURTHER * Math.min(1, (heavy - 1) / 0.5);
  /*
   * On the last piece that turns: a bend ends on pieces of no length, kept so
   * every weight has the same points, and those are moved to the new end.
   */
  const segments = [...belt.spine.segments];
  let turns = segments.length - 1;
  while (turns >= 0) {
    const one = segments[turns];
    if (one.kind === "arc" && Math.abs(one.endAngle - one.startAngle) > 1e-6) break;
    turns--;
  }
  const lastTurn = segments[turns];
  if (lastTurn?.kind === "arc" && more !== 0) {
    const way = lastTurn.sweepPositive ? 1 : -1;
    const span = Math.abs(lastTurn.endAngle - lastTurn.startAngle);
    const by = Math.max((more * Math.PI) / 180, -span * 0.8);
    // Carried on in the first of the pieces of no length, or cut back on the
    // piece itself: either way the same points at every weight.
    const end = lastTurn.endAngle + way * by;
    if (more > 0 && turns + 1 < segments.length) {
      segments[turns + 1] = { ...lastTurn, startAngle: lastTurn.endAngle, endAngle: end };
      turns++;
    } else {
      segments[turns] = { ...lastTurn, endAngle: end };
    }
    for (let k = turns + 1; k < segments.length; k++) {
      segments[k] = { ...lastTurn, startAngle: end, endAngle: end };
    }
  }
  const tail = { ...belt.spine, segments };
  return {
    recipe: {
      ...drawn,
      strokes: [
        drawnBar,
        inherit(belt, { ...belt, spine: tail, start: bowlStart, end: foot }),
        ...rest,
      ],
    },
    bar: barY,
    asked: askedY,
  };
}

/**
 * A bend begun `degrees` further round its first piece that turns, the
 * pieces of no length before it moved onto its new start so every weight has
 * the same points.
 */
function startedLater(spine: Spine, degrees: number): Spine {
  const segments = [...spine.segments];
  const first = segments.findIndex(
    (one) => one.kind === "arc" && Math.abs(one.endAngle - one.startAngle) > 1e-6,
  );
  const turn = segments[first];
  if (turn?.kind !== "arc") return spine;
  const way = turn.sweepPositive ? 1 : -1;
  const span = Math.abs(turn.endAngle - turn.startAngle);
  const startAngle = turn.startAngle + way * Math.min((degrees * Math.PI) / 180, span * 0.8);
  segments[first] = { ...turn, startAngle };
  for (let k = 0; k < first; k++) segments[k] = { ...turn, startAngle, endAngle: startAngle };
  return { ...spine, segments };
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

/** How far the t's flag sags in toward the stem, against its length. */
const T_FLAG_SAG = 0.12;

/** Lora's t stands this far up the ascender. */
const T_TOP = 640 / 755;

/**
 * The t standing well over the x-height under a flag, as Lora's does: the bar
 * reaching out past the stem on the left, and from its end a flag rising in
 * a concave sweep to the head, which is only the right part of the stem --
 * four tenths of it across at the Regular and half at the Bold, the stem's
 * left corner carved away under the flag.
 */
export function humanistT(style: Style): Recipe {
  const f = frame(style);
  const radius = Math.max(roundHalf(f) * 0.34, f.least, f.half * 1.5);
  const reach = tReach(f);
  const stemHalf = Math.abs(reachAlong(at(1, 0), penReach(f.style.pen)).x);
  /*
   * The bar reaching past the stem on the left by half a stem at least, as
   * Lora's Bold does: held to the construction's reach alone it came in with
   * the heavier stem, and past a Black the flag had nowhere to stand.
   */
  const stem = Math.max(tStem(f), f.edge + stemHalf * (1 + 2 * T_OVERHANG));
  /*
   * As tall at every weight as Lora's, less the little a heavy stem's own
   * ink adds: grown by two half-pens over the x-height, a Black t stood over
   * the ascender.
   */
  const top = Math.max(f.asc * T_TOP + Math.max(0, f.half - 43.5) * 0.3, f.x + f.half);
  const bar = f.hangs(f.x, f.bar);
  const barLeft = stem - Math.max(reach * 0.7, stemHalf * (1 + 2 * T_OVERHANG));
  const stemLeft = stem - stemHalf;
  const stemRight = stem + stemHalf;
  // The flag's pen, and how far across it reaches from its spine along a row.
  const flagOf = (share: number) =>
    lighter(ink(f, straight(at(barLeft, bar), at(stem, top)), LEVEL, LEVEL), share);
  /*
   * The arc leaves the bar flatter than its chord and reaches the head
   * steeper, each by the angle its sag turns it through, and a pen crosses a
   * row wider the flatter it runs: measured along the chord alone, the foot
   * stood out past the bar's end past a Black.
   */
  /*
   * And no deeper than keeps the arc's radius clear of the pen: on a short
   * flag under a heavy monoline pen, a sans drawing this t, the sag bent the
   * arc tighter than the pen and its inner edge folded.
   */
  let sag = T_FLAG_SAG;
  let turned = 2 * Math.atan(2 * sag);
  const chordOf = (pen: Stroke, from: Vec2, to: Vec2, by: number) => {
    const c = towards(from, to);
    const d = at(c.x * Math.cos(by) - c.y * Math.sin(by), c.x * Math.sin(by) + c.y * Math.cos(by));
    const side = reachAlong(at(-d.y, d.x), penReach(pen.pen));
    return Math.abs(side.x - (side.y / d.y) * d.x);
  };
  /*
   * Drawn at the weight that makes its head the share of the stem Lora's
   * is, its right corner on the stem's right edge and its foot on the bar's
   * left end, each found again as the other moves.
   */
  let pen = flagOf(0.75);
  let wedgeTop = at(stemRight, top);
  const crossed = crossbar(f, barLeft, stem + reach);
  const barTop = bar + Math.abs(reachAlong(at(0, 1), penReach(crossed.pen)).y);
  // Its foot cut halfway up the bar, so it sweeps out to meet the bar's end.
  const footY = bar + (barTop - bar) * T_FOOT_RISE;
  let foot = at(barLeft, footY);
  for (let pass = 0; pass < 6; pass++) {
    const chord = chordOf(pen, foot, wedgeTop, turned);
    pen = lighter(pen, Math.min(1.2, (T_HEAD * stemHalf) / chord));
    wedgeTop = at(stemRight - chordOf(pen, foot, wedgeTop, turned), top);
    foot = at(barLeft + chordOf(pen, foot, wedgeTop, -turned) + f.half * 0.15, footY);
    const length = Math.hypot(wedgeTop.x - foot.x, wedgeTop.y - foot.y);
    sag = Math.min(T_FLAG_SAG, length / (8 * 1.4 * (pen.pen.weight / 2)));
    turned = 2 * Math.atan(2 * sag);
  }
  /*
   * Bowed less, down to all but straight, where the bow folds the flag's
   * level ends over themselves: a short, shallow flag on a face with a taller
   * x-height, where each cut slides its corner past the first piece.
   */
  const flagWith = (bow: number) =>
    inherit(pen, { ...pen, spine: inPieces(bowed(f, foot, wedgeTop, -bow), 3) });
  let wedge = flagWith(sag);
  for (let bow = sag / 2; bow > 1e-3 && contoursIntersect(sweep(wedge)); bow /= 2) {
    wedge = flagWith(bow);
  }
  if (contoursIntersect(sweep(wedge))) wedge = flagWith(1e-4);
  /*
   * The stem's head cut to slope down to the left, from its right corner to
   * where its left edge goes in under the flag: as deep as the cut can go
   * while it stays inside the flag's inner edge all the way up, since the
   * flag is concave and a cut carried past it opened a sliver of paper
   * between the two.
   */
  const flagInk = sweep(wedge);
  const width = stemRight - stemLeft;
  const innerAt = (y: number) => {
    const runs = inkRunsAt(flagInk, y, "y", 16);
    return runs.length > 0 ? Math.max(...runs.map((run) => run[1])) : -Infinity;
  };
  const covers = (y: number) =>
    inkRunsAt(flagInk, y, "y", 16).some(([from, to]) => from <= stemLeft + 0.5 && to >= stemLeft);
  let sink = 0;
  let fallback = 0;
  for (let depth = top - barTop; depth > 0; depth -= (top - barTop) / 48) {
    let inside = true;
    for (let k = 1; k < 16 && inside; k++) {
      const y = top - (depth * k) / 16;
      const cut = stemRight - (width * k) / 16;
      inside = cut <= innerAt(y) + 0.5;
    }
    if (!inside) continue;
    fallback ||= depth;
    // And the cut's low corner in under the flag, not standing out past it.
    if (covers(top - depth)) {
      sink = depth;
      break;
    }
  }
  sink ||= fallback;
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, top), at(stem, f.dip(0) + radius)),
        // Round the foot and on up into the tail, as Lora's is.
        inPieces(turn(at(stem + radius, f.dip(0) + radius), radius, 180, 305), 2),
      ),
      { ...LEVEL, sink },
      f.end,
    ),
    wedge,
    crossed,
  ]);
}

/** Lora's t head against its stem: 0.41 at the Regular, 0.53 at the Bold. */
const T_HEAD = 0.47;
/** How far up the bar the t's flag stands, from the bar's middle to its top. */
const T_FOOT_RISE = 0.5;
/** How far the t's bar reaches past its stem on the left, at least, against the stem. */
const T_OVERHANG = 0.45;

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
  const width = Math.max(f.capBowl * 1.7, f.half * 6.3);
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
  /*
   * And never so far that the counter folds: a zero set narrow, its ring
   * tall on a short radius, pinched its inside to a point at the top and the
   * bottom at a Semibold. Eased back toward the pen's own there; the points
   * are the same either way.
   */
  const swelled = (stroke: Stroke): Stroke => {
    let drawn = hairlined(stroke, swell);
    for (let k = 1; k <= 4 && contoursIntersect(sweep(drawn)); k++) {
      drawn = hairlined(stroke, swell - ((swell - 1) * k) / 4);
    }
    return drawn;
  };
  return {
    ...recipe,
    strokes: recipe.strokes.map((stroke) => (isBowl(stroke) ? swelled(stroke) : stroke)),
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
  // A text serif's as narrow as Lora's, whose loop stops 40 units short of
  // the ear on the right, where the construction's ran out under it.
  const loopHalf = Math.max(f.bowl * (textSerif(f) ? G_LOOP : 1), f.least * 1.4);
  const left = f.edge;
  const upperH = Math.max(f.x * 0.33, f.upright + f.half * 0.45, f.least);
  const upperW = Math.max(upperH * f.wide * 1.0, f.least);
  const upper = at(left + loopHalf * 0.12 + upperW, f.crest(f.x) - upperH);
  // On the descender at every weight, as Lora Bold's is: let down under it by
  // a heavy pen, a Black's loop hung a stem below the p and the y.
  // Lighter at a heavy weight (see below), so let down by what that takes off
  // its foot, to stand on the line as the stem's pen would.
  const loopShare = Math.max(0.5, 0.86 - 0.3 * heavy);
  const bottom = f.dip(f.desc) - f.upright * (1 - loopShare);
  const underBowl = upper.y - upperH - f.upright * 2 - Math.max(f.half * 1.2, f.x * 0.06);
  const loopLeast = f.upright + Math.max(f.half * 0.45, f.x * 0.035);
  const top = Math.max(Math.min(f.x * 0.02, underBowl), bottom + loopLeast * 2);
  const loopH = Math.max((top - bottom) / 2, f.least);
  const loop = at(left + loopHalf, bottom + loopH);
  const roundness = 1 - f.square;
  const leaves = bowlPoint(upper, upperW, upperH, roundness, f.half, 260 - 25 * heavy, f.curve);
  const lands = bowlPoint(loop, loopHalf, loopH, roundness, f.half, 140, f.curve);
  // The ear, out of the bowl's top right, up over the x-height and down into its drop.
  const from = bowlPoint(upper, upperW, upperH, roundness, f.half, 22, f.curve);
  // A text serif's reaching as far as Lora's past its narrower loop, as far
  // as the Regular's does; the Bold's already did.
  const earOut = textSerif(f) ? f.bowl * bySize(style, G_EAR, 0) : 0;
  const earEnd = at(
    upper.x + upperW + Math.max(f.bowl * 0.45, f.half * 1.6) + earOut,
    f.x + f.x * 0.1,
  );
  return {
    ...finish(
      f,
      [
        lighter(ink(f, ring(f, upper, upperW, upperH)), 1 - 0.12 * heavy),
        /*
         * Lighter still at a heavy weight, as Lora Bold's loop is -- sides of
         * a hundred on a stem of 142 -- and laid out for the pen it is drawn
         * with: laid out for the stem's, its ends were turned no rounder than
         * the stem's pen needs, and inside the lighter one the counter came to
         * a corner at each end.
         */
        (() => {
          const drawn = lighter(ink(f, ring(f, loop, loopHalf, loopH)), loopShare);
          return inherit(drawn, {
            ...drawn,
            spine: bowl(loop, loopHalf, loopH, roundness, drawn.pen.weight / 2, f.curve),
          });
        })(),
        lighter(
          // In two pieces at every weight, however little a heavy one turns.
          ink(
            f,
            inPieces(bowed(f, leaves, lands, -Math.max(LINK_BOW - 0.12 * heavy, 0.06)), 2),
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
const LINK_BOW = 0.3;
/** How wide a text serif's g's loop is, against a bowl. */
const G_LOOP = 0.91;
/** And how much further its ear reaches, against a bowl. */
const G_EAR = 0.1;
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
  const radius = Math.max(f.arch * 0.5, f.least, f.half * 1.5);
  const stem = f.edge + radius * 1.35;
  const turnAt = f.dip(f.desc) + radius;
  /*
   * Round as far as keeps the tail's end well under the line, where a drop
   * hangs: with the turn widened for a heavy pen held at 30, the end rose
   * over it, the drop was refused and the serif laid across the curve came
   * out as two slivers.
   */
  const under = (f.desc * J_UNDER - turnAt) / radius;
  const end = under < -0.5 ? -180 + (Math.asin(Math.min(1, -under)) * 180) / Math.PI : -150;
  return finish(f, [
    ink(
      f,
      chain(
        straight(at(stem, f.x), at(stem, turnAt)),
        turn(at(stem - radius, turnAt), radius, 0, end),
      ),
      f.end,
      f.end,
    ),
    tittle(f, stem),
  ]);
}

/** How far under the line the j's tail ends at least, against the descender. */
const J_UNDER = 0.45;

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

/**
 * The solidus as Lora draws it: from under the descender to over the
 * ascender, leaning 0.59 across for every unit up, cut square at both ends,
 * and heavy: 68 across the stroke at the Regular and 93 at the Bold. Drawn
 * with the face's pen and lightened, it was a hairline of 57 at the Regular;
 * cut level, it ran 46 units wider than Lora's.
 */
export function humanistSlash(style: Style): Recipe {
  return solidusOf(style, 1);
}

/** The backslash as Lora's: the solidus leaning the other way. */
export function humanistBackslash(style: Style): Recipe {
  return solidusOf(style, -1);
}

function solidusOf(style: Style, way: 1 | -1): Recipe {
  const f = frame(style);
  const foot = f.desc - f.over;
  const head = f.asc + f.over * 0.3;
  if (!textSerif(f)) {
    const lean = (head - foot) * 0.53;
    const from = at(way === 1 ? f.edge : f.edge + lean, foot);
    const to = at(way === 1 ? f.edge + lean : f.edge, head);
    return finish(f, [lighter(ink(f, straight(from, to), LEVEL, LEVEL), 0.72)]);
  }
  const u = loraUnit(f);
  const slope = bySize(style, 0.592, 0.581);
  const across = byPen(style, 68, 93) * u;
  const low = bySize(style, -253, -245.5) * u;
  const high = bySize(style, 739.5, 726) * u;
  const lean = (high - low) * slope;
  const from = at(way === 1 ? f.edge : f.edge + lean, low);
  const to = at(way === 1 ? f.edge + lean : f.edge, high);
  return finish(f, [signStroke(f, straight(from, to), across)]);
}

/**
 * The exclamation mark as Lora's: a wedge, round at its head at 716 and 116
 * across there at the Regular and 144 at the Bold, narrowing to 37 and 68 at
 * its foot 230 and 213 up, over Lora's full stop. The construction's
 * narrowed only to half its head, and its dot stood on the line.
 */
export function humanistExclam(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const stop = stopRadius(f);
  const x = f.edge + f.half * 0.25;
  // Hardly more than the stem at a Black, or the head is a ball over a
  // sliver of a stem.
  const cap = Math.min((byPen(style, 116, 144) * u) / 2, f.half * 1.22);
  const head = 716 * u - cap;
  const footWide = Math.min(Math.max(byPen(style, 37, 68) * u, f.half * 0.6), cap * 2);
  const foot = Math.max(bySize(style, 230, 213) * u, stop * 2 - DIP * u + f.half * 0.9);
  // Three runs: one down the middle as wide as the foot, and one either side
  // from the head's edge in to the foot, each wide enough to meet the middle
  // one under the head.
  const w = Math.max(footWide, (cap * 2) / 3 + 2 * u);
  const side = (dir: number): Stroke =>
    signStroke(
      f,
      straight(at(x + dir * (cap - w / 2), head), at(x + (dir * (footWide - w)) / 2, foot)),
      w,
      BUTT,
      LEVEL,
    );
  return {
    strokes: [
      ...finish(f, [
        side(-1),
        signStroke(f, straight(at(x, head), at(x, foot)), footWide, BUTT, LEVEL),
        side(1),
        dot(f, at(x, head), cap),
      ]).strokes,
      loraDot(f, x, 0),
    ],
  };
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
  if (!textSerif(f)) return doubleVee(f, Math.max(roundHalf(f) * 0.57, f.arch * 0.68), f.x);
  /*
   * A text serif's drawn lighter past the Bold, as a Black's w is, and laid
   * out for the pen it is drawn with: four arms on the stem's pen in an
   * x-height filled the w's two lower counters to half its height at the
   * heaviest, and it read as a band with a zigzag on top.
   */
  const past = Math.min(1, Math.max(0, style.pen.weight - 142) / 118);
  const light = frame({
    ...style,
    pen: { ...style.pen, weight: style.pen.weight * (1 - W_LIGHTER * past) },
  });
  return doubleVee(light, Math.max(roundHalf(f) * 0.57, f.arch * 0.68), f.x);
}

/** How much lighter a text serif's w is drawn at the heaviest than its pen. */
const W_LIGHTER = 0.3;

export function humanistCapitalW(style: Style): Recipe {
  const f = frame(style);
  return doubleVee(f, f.capBowl * 0.66, f.cap);
}

/**
 * The vees drawn in one run -- the construction's v, V and Y, the M's
 * middle, the w's and W's two -- taken apart into one stroke a piece on a
 * text serif whose rising strokes are hairlines (see `inkAll` in
 * `build.ts`), so each rising piece can be drawn light as Lora's are: its
 * v's rising arm is 52 units across against the falling arm's 91, where the
 * one run drew both on the same pen.
 *
 * Each piece keeps the one run's points: at every corner the two outer edges
 * still meet where they met, on the line the vee stands on or hangs from, so
 * each spine is laid again to put its outer edge through its corners at its
 * own weight, and each end is cut along its neighbour's outer edge, the two
 * meeting in the same mitred point. Cut level on the line instead, a flat
 * narrower than the heavy arm left that arm's inside corner standing out
 * past the light one, and past a Black the foot of the v was an X.
 *
 * And a rising arm run on into a tail, as the hooked y's is, drawn light.
 */
/**
 * Whether a straight run rises to the right steeply enough to be drawn as a
 * hairline: not so flat it reads as a bar, not so steep it reads as a stem.
 */
export function risesSteeply(from: Vec2, to: Vec2): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx * dy > 0 && Math.abs(dy) > Math.abs(dx) * 0.4 && Math.abs(dx) > Math.abs(dy) * 0.15;
}

/** The weight a rising stroke is drawn at as a hairline: a pen's thin stroke, and never nothing. */
export function hairlineWeight(pen: Stroke["pen"]): number {
  const own = Math.min(Math.max(pen.own ?? pen.contrast, 0), 0.95);
  return Math.max(pen.weight * (1 - own) * 1.25, 1);
}

export function splitVees(given: Stroke[]): Stroke[] {
  // The y's arms drawn as hairlines, for the full arm meeting one to be cut to.
  const hairlines: Stroke[] = [];
  const split = given.flatMap((stroke) => {
    const segments = stroke.spine.segments;
    const thinWeight = hairlineWeight(stroke.pen);
    if (thinWeight >= stroke.pen.weight) return [stroke];
    const thinPen = { ...stroke.pen, weight: thinWeight, contrast: 0, own: 0 };
    const rises = risesSteeply;
    // Taken apart wherever an arm rises at all, so the points do not change
    // with the weight; drawn light only where it rises as a hairline does.
    const risesAtAll = (from: Vec2, to: Vec2) => (to.x - from.x) * (to.y - from.y) > 0;
    const [first, ...rest] = segments;
    // The y's arm and tail.
    if (
      first?.kind === "line" &&
      rest.length > 0 &&
      rest.every((one) => one.kind === "arc") &&
      rises(first.from, first.to) &&
      // A whole arm, not the few units a stroke is begun back inside another
      // by: the two's S, begun so inside its bowl, was thinned as a y's arm.
      Math.hypot(first.to.x - first.from.x, first.to.y - first.from.y) > stroke.pen.weight
    ) {
      // With as much contrast as keeps the tail's bottom, running level, as
      // deep as the full pen's: on a pen with none it came down fourteen
      // units under the descender at the heaviest, and on the full pen's
      // own it stood twenty-six over it.
      const level = stroke.pen.weight * (1 - stroke.pen.contrast);
      const contrast = Math.min(stroke.pen.contrast, Math.max(0, 1 - level / thinWeight));
      const hairline = inherit(stroke, {
        ...stroke,
        pen: { ...stroke.pen, weight: thinWeight, contrast, own: 0 },
      });
      hairlines.push(hairline);
      return [hairline];
    }
    if (stroke.spine.closed || segments.length < 2) return [stroke];
    if (!segments.every((one) => one.kind === "line")) return [stroke];
    const points = [
      segments[0].kind === "line" ? segments[0].from : at(0, 0),
      ...segments.map((one) => (one.kind === "line" ? one.to : at(0, 0))),
    ];
    const n = segments.length;
    const dirs = segments.map((_, i) => towards(points[i], points[i + 1]));
    // Steep pieces only, and at least one of them rising: not an arm and a
    // bar, as the 4's diagonal and foot are.
    if (dirs.some((d) => Math.abs(d.y) < 0.37)) return [stroke];
    if (!segments.some((_, i) => risesAtAll(points[i], points[i + 1]))) return [stroke];
    const pens = segments.map((_, i) => (rises(points[i], points[i + 1]) ? thinPen : stroke.pen));
    const leftOf = (d: Vec2) => at(-d.y, d.x);
    const cross = (u: Vec2, v: Vec2) => u.x * v.y - u.y * v.x;
    // Which side of the run is outside each corner: the right of the way it
    // travels where it turns left, and the other way about.
    const outside = (k: number) => (cross(dirs[k - 1], dirs[k]) > 0 ? -1 : 1);
    // A piece's edge on one side, as the sweep draws it.
    const edge = (pen: Stroke["pen"], d: Vec2, side: number) => {
      const r = reachAlong(leftOf(d), penReach(pen));
      return at(r.x * side, r.y * side);
    };
    // Two lines' crossing; where they run parallel, where the first starts.
    const meet = (p: Vec2, u: Vec2, q: Vec2, v: Vec2) => {
      const across = cross(u, v);
      if (Math.abs(across) < 1e-9) return p;
      const t = cross(at(q.x - p.x, q.y - p.y), v) / across;
      return at(p.x + u.x * t, p.y + u.y * t);
    };
    // Where the one run's outer edges met at each corner.
    const tips: Vec2[] = [];
    for (let k = 1; k < n; k++) {
      const side = outside(k);
      const a = edge(stroke.pen, dirs[k - 1], side);
      const b = edge(stroke.pen, dirs[k], side);
      tips[k] = meet(
        at(points[k].x + a.x, points[k].y + a.y),
        dirs[k - 1],
        at(points[k].x + b.x, points[k].y + b.y),
        dirs[k],
      );
      /*
       * Or, past the miter limit, where the one run's ink stopped: the sweep
       * gives up carrying a corner that sharp to its point and fills it with
       * the pen, and the recipe stood the corner where that filled ink lands.
       * Carried to where the outer edges meet, a Condensed's v and the middle
       * of its W ran out a hundred and forty units past the line in a needle.
       */
      // As far out as `overhang` told the recipe it would: the arms' own
      // reach off their spines, between the two.
      const off = at(tips[k].x - points[k].x, tips[k].y - points[k].y);
      const far = Math.hypot(off.x, off.y);
      if (far > penReach(stroke.pen).across * MITER_LIMIT) {
        const out = at(off.x / far, off.y / far);
        const across = (e: Vec2, d: Vec2) => Math.abs(e.x * -d.y + e.y * d.x);
        const lands = (across(a, dirs[k - 1]) + across(b, dirs[k])) / 2;
        tips[k] = at(points[k].x + out.x * lands, points[k].y + out.y * lands);
      }
    }
    // Each spine laid again so its outer edge runs through its corners' tips
    // at its own weight; the run's two ends stay where they were.
    const lines = segments.map((_, i) => {
      let d = dirs[i];
      let from = points[i];
      for (let pass = 0; pass < 4; pass++) {
        const start =
          i === 0
            ? points[0]
            : (() => {
                const e = edge(pens[i], d, outside(i));
                return at(tips[i].x - e.x, tips[i].y - e.y);
              })();
        const end =
          i === n - 1
            ? points[n]
            : (() => {
                const e = edge(pens[i], d, outside(i + 1));
                return at(tips[i + 1].x - e.x, tips[i + 1].y - e.y);
              })();
        d = towards(start, end);
        from = start;
      }
      return { from, d };
    });
    // Each end cut along its neighbour's outer edge.
    const outerLine = (i: number, side: number) => {
      const e = edge(pens[i], lines[i].d, side);
      return { p: at(lines[i].from.x + e.x, lines[i].from.y + e.y), u: lines[i].d };
    };
    const cutAt = (i: number, k: number, outward: Vec2) => {
      const other = k === i ? i - 1 : i + 1;
      const along = outerLine(other, outside(k));
      const point = meet(lines[i].from, lines[i].d, along.p, along.u);
      const shift = reachAlong(leftOf(outward), penReach(pens[i]));
      const facing = cross(outward, along.u);
      const slide = Math.abs(facing) < 1e-9 ? 0 : -cross(shift, along.u) / facing;
      const angle = (Math.atan(slide / penReach(pens[i]).across) * 180) / Math.PI;
      return { point, terminal: { kind: "angled", angle } as Terminal };
    };
    return segments.map((_, i) => {
      const d = lines[i].d;
      const start =
        i === 0 ? { point: points[0], terminal: stroke.start } : cutAt(i, i, at(-d.x, -d.y));
      const end = i === n - 1 ? { point: points[n], terminal: stroke.end } : cutAt(i, i + 1, d);
      return inherit(stroke, {
        ...stroke,
        pen: pens[i],
        spine: straight(start.point, end.point),
        start: start.terminal,
        end: end.terminal,
      });
    });
  });
  return hairlines.length === 0 ? split : split.map((stroke) => metHairline(stroke, hairlines));
}

/**
 * A full straight arm ending on a hairline, its end cut along the hairline's
 * spine: the y's falling arm, which ended square on the rising arm's spine
 * and, that arm thinned, stood its corners out past it -- a spur under the
 * crotch that grew with the weight. Along the spine, not the far edge: the
 * two meet at so shallow an angle that a cut along the far edge ran on past
 * where the hairline turns into the tail.
 */
function metHairline(stroke: Stroke, hairlines: Stroke[]): Stroke {
  const [only, ...more] = stroke.spine.segments;
  if (more.length > 0 || only?.kind !== "line" || hairlines.includes(stroke)) return stroke;
  const cross = (u: Vec2, v: Vec2) => u.x * v.y - u.y * v.x;
  const u = towards(only.from, only.to);
  for (const hairline of hairlines) {
    const [first] = hairline.spine.segments;
    if (first?.kind !== "line") continue;
    const v = towards(first.from, first.to);
    const facing = cross(u, v);
    if (Math.abs(facing) < 1e-6) continue;
    // Its end on the hairline's spine, within the hairline's straight run.
    const off = at(only.to.x - first.from.x, only.to.y - first.from.y);
    const along = off.x * v.x + off.y * v.y;
    const length = Math.hypot(first.to.x - first.from.x, first.to.y - first.from.y);
    if (Math.abs(cross(v, off)) > 1 || along < 0 || along > length) continue;
    const pen = penReach(stroke.pen);
    const shift = reachAlong(at(-u.y, u.x), pen);
    const slide = -cross(shift, v) / facing;
    const angle = (Math.atan(slide / pen.across) * 180) / Math.PI;
    return inherit(stroke, {
      ...stroke,
      end: { kind: "angled", angle },
    });
  }
  return stroke;
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
    // Bowed a little and cut level on the line, as Lora's leg flares into
    // its end: on a foot serif, the serif's inside wing stood out as a spur.
    ink(f, bowed(f, leaves, at(foot.x + f.half * 0.4, foot.y), K_LEG_BOW), BUTT, LEVEL),
  ]);
}

/** How far the K's leg bows off its chord: up and to the right. */
const K_LEG_BOW = 0.08;
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
  // How much of the pen's depth its level runs are drawn with: see `bookS`.
  level = 1,
): Spine {
  const top = f.hangs(height, level) + f.over;
  const bottom = f.sits(0, level) - f.over;
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
    const run = fall / Math.tan(rad(60 - second - S_BEND / 2));
    return { r, fall, second, a, b, across: 2 * (off.x + run) };
  };
  /*
   * Each bowl as wide as the letter, a little wider than it is tall, and the
   * spine at thirty degrees -- as far as the pen leaves room for all three:
   * searched for the nearest that keeps the lower bowl's side on the
   * letter's, a spine with some fall to it, and the bowls' sides rounder
   * than the pen, whose inside otherwise folds to a point in the counter.
   */
  /*
   * And on a face with a didone's contrast, rounder still and the spine as
   * steep as it will stand: the pen there is five times as wide as it is
   * deep, a side turned on no more than it lay flat against the counter as a
   * straight wall with a corner either end, and a spine at a text face's
   * slope took so little of the pen across it that the bowls outweighed it.
   * A Bodoni's spine is the heaviest stroke in its S.
   */
  const didone = Math.max(0, f.style.pen.contrast - 0.6) / 0.2;
  const roundest = half * (1.05 + 0.45 * Math.min(1, didone));
  /*
   * A text serif's spine lies flatter, and is held to it: Lora's crosses its
   * s at about twenty-five degrees off level, where the construction's
   * stood at forty and the s read as a slanted stroke between two hooks.
   */
  const text = textSerif(f);
  // Eased back to the didone's as the contrast rises, as the rest is.
  const slope = (text ? S_FLAT : 30 - S_BEND) * (1 - Math.min(1, didone));
  const held = text ? 5 - 4.5 * Math.min(1, didone) : 0.5;
  let shape = laid(width / 2, width / 2.6, 30);
  let best = Infinity;
  /*
   * Narrower than asked, where that is what keeps the bowls round -- and on a
   * text face as far again, where that is what keeps the spine running
   * forward: past a Black the widened s asked for bowls too flat for a spine
   * with so little fall to cross them, and the search took a spine that
   * crossed half of them, the lower bowl standing back under the upper one
   * in an s that leaned like an italic. A didone keeps the old reach, whose
   * counters close before its spine leans.
   */
  // Eased from the one to the other as the contrast rises, so the slider
  // does not jump the s at 0.6.
  const toDidone = Math.min(1, didone);
  const narrowest = Math.round(20 - 10 * toDidone);
  // And a spine allowed to lie flatter, a Black's, where it has little to fall.
  const flatter = Math.round(8 * (1 - toDidone));
  for (let k = 0; k <= narrowest; k++) {
    const a = (width / 2) * (1 - 0.6 * (k / 20));
    const most = Math.min(a * 2, tall / 2);
    for (let i = 0; i <= 40; i++) {
      const b = most - (most - a / 2) * (i / 40);
      for (let degrees = 0; degrees <= 30 - S_BEND / 2 + flatter; degrees += 1) {
        const tried = laid(a, b, degrees);
        if (!(tried.r.side > 0 && tried.r.crown > 0)) continue;
        const cost =
          ((tried.across - 2 * a) / a) ** 2 * 40 +
          (a / b - 1.3) ** 2 +
          ((slope - degrees) / 30) ** 2 * held +
          (k / 20) ** 2 * 12 +
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
  const chord = Math.hypot(middle.x - point.x, middle.y - point.y);
  const spineRadius = chord / (2 * sin(rad(S_BEND / 2)));
  arc(spineRadius, S_BEND);
  arc(spineRadius, -S_BEND);
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
  const swell = sSwell(style);
  return {
    ...recipe,
    strokes: recipe.strokes.map((stroke) =>
      stroke.spine.segments.some((one) => one.kind === "arc") ? hairlined(stroke, swell) : stroke,
    ),
  };
}

/**
 * How many degrees the s's spine turns each side of its middle: it leaves
 * one bowl steeper than it crosses the letter and flattens into the middle,
 * then steepens again into the other, one S-curve with no straight in it.
 */
const S_BEND = 24;

/** How far off level a text serif's s spine is asked to lie, in the terms of `bookSpine`. */
const S_FLAT = 18;

/**
 * How much heavier a text serif's s and S are drawn across than the pen, to
 * the Bold, as Lora's are: at `S_SPINE` their sides stood 110 across where
 * Lora's are 80, and the whole letter read heavy beside the o.
 */
const S_TEXT_SWELL = 1.1;

/**
 * How much heavier across than the pen the s and the S are drawn: as the
 * rounds' sides are, fading out by the Bold as theirs do; on a text serif
 * `S_TEXT_SWELL`, held to the Bold and gone by a Black.
 */
function sSwell(style: Style): number {
  const black = blackness(style);
  if (textSerif(frame(style))) {
    return 1 + (S_TEXT_SWELL - 1) * Math.min(1, Math.max(0, 1 - (black - 0.47) / 0.53));
  }
  return 1 + (S_SPINE - 1) * Math.max(0, 1 - (black / 0.47) * 0.8);
}

/** How much lighter the lowercase s is drawn at a Black than its stem, along its level runs. */
const S_LIGHTER = 0.2;
/**
 * And how much lighter across its uprights: no more than keeps the counters
 * open now the spine runs forward (see `bookSpine`) -- at a half, the Black's
 * s was a hairline letter between an o and an e.
 */
const S_UPRIGHT = 0.35;
/** A didone's, whose bowls turn on a pen five times as wide as it is deep. */
const S_DIDONE_UPRIGHT = 0.5;

/** Lora's s spine against the stem the construction's pen gives it. */
const S_SPINE = 1.25;

/** How much wider the s runs per unit of blackness past a Black. */
const S_WIDEN = 0.5;

/** A text serif's Black, as `heaviness` counts it: a pen of 194. */
const S_BLACK = (194 - 96) / 104;

/*
 * A text serif's s and S past the Bold, as Lora's Bold would be drawn on.
 *
 * The s's skeleton is held by its bowls, which must stay rounder than the
 * pen: on a heavier pen the search took narrower bowls, and by an Ultra the
 * s was a small, narrow letter with slits for counters beside an o half
 * again as wide, wobbling where the turns folded on the pen. So it is asked
 * wider past the Bold (`S_HEAVY_WIDE`), and its uprights lightened a little
 * further (`S_HEAVY_UPRIGHT`), which lets its bowls take the width.
 *
 * The S was never lightened, and at an Ultra its counters were notches with a
 * lump where each end turned in: it is drawn a little wider and lightened as
 * the s is, by `S_HEAVY_CAPITAL` of as much.
 */
const S_HEAVY_WIDE = 0.3;
const S_HEAVY_UPRIGHT = 0.1;
const S_HEAVY_CAPITAL_WIDE = 0.3;
const S_HEAVY_CAPITAL = 0.6;

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
  /*
   * How far past the Bold a text serif's s and S are drawn: nought to the
   * Bold, so the Regular and the Bold are Lora's as they were, and one by
   * an Ultra. See `S_HEAVY_WIDE` and `S_HEAVY_CAPITAL`.
   */
  // And eased out as the contrast rises into a didone's, as the rest of the
  // s is: held on there, the s at 260 jumped wider step by step.
  const toDidone = Math.min(1, Math.max(0, f.style.pen.contrast - 0.6) / 0.2);
  const past = textSerif(f) ? Math.min(1, Math.max(0, heaviness(f) - 0.5)) * (1 - toDidone) : 0;
  // The capital a little narrower on its height, as Lora's S is.
  const width =
    (inked * (capital ? 0.59 : 0.62) * f.wide + (f.gain * f.x) / height) *
    (1 + (capital ? S_HEAVY_CAPITAL_WIDE : S_HEAVY_WIDE) * past);
  /*
   * Drawn lighter at a heavy weight, as a Black's small counters are (the a's
   * bowl, the g's loops): three strokes' worth of the stem's pen stacked in
   * an x-height left the counters slits with a fold at each end.
   */
  // Past the Bold only: Lora's Bold s is as heavy as its n.
  // The capital has the cap height to turn in, and is lightened less, and
  // only on a text serif: see `S_HEAVY_CAPITAL`.
  const heavy = capital ? past * S_HEAVY_CAPITAL : Math.min(1, Math.max(0, heaviness(f) - 0.5));
  /*
   * Past the Black the lowercase s is laid out on the depth its level runs
   * are drawn with rather than the stem's. Laid out on the stem's, a run
   * drawn lighter stopped short of the line and the x-height's overshoot --
   * the s at a pen of 260 stood on -4 where the o dips to -16 -- and the
   * bowls were given that much less height to turn in, so the search
   * narrowed them: the letter shrank as the pen grew, 386 units across
   * against the Black's 420 beside an o grown from 577 to 698. Widened
   * instead, the bowls came out too flat for the pen and the spine crossed
   * half of them, an s that leaned; let lie flatter, it jumped about as the
   * contrast rose. Laid out on the runs it is drawn with, it sits on the
   * o's line and stands 419 across, and as upright as before. Run in from
   * nothing at the Black, so the Black and everything lighter are drawn as
   * they were.
   */
  const beyond =
    !capital && textSerif(f)
      ? Math.min(1, Math.max(0, (heaviness(f) - S_BLACK) / (1.5 - S_BLACK))) * (1 - toDidone)
      : 0;
  const level = 1 - S_LIGHTER * heavy * beyond;
  // A didone's s as it was: see `S_UPRIGHT`.
  const upright =
    S_UPRIGHT +
    (capital ? 0 : past * S_HEAVY_UPRIGHT) +
    (S_DIDONE_UPRIGHT - S_UPRIGHT) * Math.min(1, Math.max(0, f.style.pen.contrast - 0.6) / 0.2);
  return finish(
    f,
    [
      /*
       * Lighter across its uprights than along its level runs past a Bold:
       * lightened evenly, the s of an Ultra was a hairline beside its o,
       * and on the stem's pen the insides of its turns folded to nibs in
       * the counters where the bowls stand upright.
       */
      hairlined(
        lighter(
          ink(
            f,
            bookSpine(f, height, f.edge, width, f.half * (1 - upright * heavy), level),
            f.end,
            f.end,
          ),
          1 - S_LIGHTER * heavy,
        ),
        (1 - upright * heavy) / (1 - S_LIGHTER * heavy),
      ),
    ],
    true,
  );
}

/** The S as the s is drawn: see `bookSpine`. */
export function humanistCapitalS(style: Style): Recipe {
  const recipe = bookS(style, true);
  const swell = sSwell(style);
  return {
    ...recipe,
    strokes: recipe.strokes.map((stroke) => hairlined(stroke, swell)),
  };
}

/**
 * The G as Lora's: the bowl carried round into a short upright on the right
 * that stands to half the cap height under a serif reaching both ways, as a
 * foot does upside down.
 *
 * The spurred G it is drawn from (`alternates.ts`) stood its upright on the
 * bowl at 302 degrees, half a stem left of Lora's, and left its top a plain
 * cut: an upright stopping in mid-air wears no serif.
 */
export function humanistCapitalG(style: Style): Recipe {
  const f = frame(style);
  const centre = at(f.edge + f.capBowl, f.cap / 2);
  const roundness = 1 - f.square;
  const clear = (((f.half * 2.4) / f.capBowlH) * 180) / Math.PI;
  const opens = Math.max(32, clear);
  const joins = G_JOINS;
  const foot = bowlPoint(centre, f.capBowl, f.capBowlH, roundness, f.half, joins, f.curve);
  const bowl = bowlBetween(centre, f.capBowl, f.capBowlH, roundness, f.half, opens, joins, f.curve);
  const end = spineEnd(bowl);
  const heading =
    [...bowl.segments]
      .reverse()
      .map((segment) => headingAt(segment, "end"))
      .find((way) => Math.hypot(way.x, way.y) > 0.5) ?? at(1, 0);
  const pen = penReach(f.style.pen);
  const reach = reachAlong(at(-heading.y, heading.x), pen);
  const outer = heading.x * reach.y - heading.y * reach.x < 0 ? reach : at(-reach.x, -reach.y);
  const corner = at(end.x + outer.x, end.y + outer.y);
  const carry = heading.x > 0.05 ? (2 * outer.x) / heading.x : 0;
  const upright = f.square < 0.01 && carry > 0;
  const cut = upright ? (Math.atan(carry / (2 * pen.across)) * 180) / Math.PI : 0;
  const side = Math.abs(reachAlong(at(1, 0), pen).x);
  const stand = upright ? at(corner.x - side, corner.y + 1) : foot;
  /*
   * The serif: a hairline laid across the upright's head, its top where
   * Lora's is, reaching out each side as far as a foot serif reaches past a
   * stem -- and held off the bowl's inside on the left, so a heavy weight's
   * does not run into the counter's wall.
   */
  const slab = f.end.kind === "slab" ? f.end : null;
  const drawnThin = thin(f, straight(at(0, 0), at(1, 0)), BUTT, BUTT);
  const thinDeep = Math.abs(reachAlong(at(0, 1), penReach(drawnThin.pen)).y);
  // As deep as the face's own serifs, no deeper than its hairline.
  const serif = slab ? lighter(drawnThin, Math.min(1, slab.thickness! / 2 / thinDeep)) : drawnThin;
  const deep = Math.abs(reachAlong(at(0, 1), penReach(serif.pen)).y);
  const top = Math.max(f.cap * G_TOP - deep, foot.y + f.half * 2);
  const wing = slab ? slab.projection! * G_WING : f.half * 0.6;
  return finish(
    f,
    [
      ink(f, bowl, f.end, upright ? { kind: "angled", angle: cut } : BUTT),
      ink(f, straight(stand, at(stand.x, top)), BUTT, LEVEL),
      inherit(serif, {
        ...serif,
        spine: straight(at(stand.x - side - wing, top), at(stand.x + side + wing, top)),
      }),
    ],
    true,
  );
}

/** Where on its bowl the G's upright stands, in degrees round from the right. */
const G_JOINS = 312;
/** The top of the G's serif, against the cap height: Lora's is at 0.49. */
const G_TOP = 0.49;
/** How far the G's serif reaches past its upright each side, against a foot serif's: as far, as Lora's does. */
const G_WING = 1;

/** The least the question mark's neck turns on, against half the pen. */
const Q_TURN = 1.3;

/**
 * The question mark as Lora's: the hook carried round and down, and the neck
 * leaving it down to the left and bending back to stand upright over the dot
 * -- one S from the hook's end to the neck's foot, where the construction's
 * neck was a straight slant ending in mid-air at an angle.
 *
 * Otherwise the construction's (see `punctuation.ts`): the hook no bigger
 * than leaves the neck room to leave it on a tangent, the neck stopping
 * clear of the dot, and the dot under the neck's foot.
 */
export function humanistQuestion(style: Style): Recipe {
  const f = frame(style);
  const radiusDot = stopRadius(f);
  const neck = Math.max(f.cap * 0.3, radiusDot * 2 + f.half * 0.9);
  const crest = f.crest(f.cap);
  const radius = Math.max(Math.min(figureWidth(f) * 0.42, (crest - neck) / 2.2), f.least);
  const centre = at(f.edge + radius, crest - radius);
  let foot = at(centre.x, Math.min(neck, centre.y - radius * 1.15));
  /*
   * The neck as a second circle touching the hook's from outside, turned the
   * other way, whose lowest-left point is the neck's foot, travelling
   * straight down: the circle through the foot with its centre level with it
   * and its edge on the hook's. Where the two touch, the hook hands over.
   */
  const b = centre.y - foot.y;
  let r = (b * b - radius * radius) / (2 * radius);
  /*
   * No tighter than the pen turns cleanly: past a Bold the hook sits so low
   * over the dot that the neck's circle came down to the pen's own half, and
   * held there it no longer touched the hook -- a notch at the hand-over.
   * Held wider, the foot moves out to the right until the two touch again.
   */
  const least = Math.max(f.least, f.half * Q_TURN);
  if (r < least) {
    r = least;
    const reach = Math.sqrt(Math.max(0, (radius + r) ** 2 - b * b));
    foot = at(centre.x - (r - reach), foot.y);
  }
  const other = at(foot.x + r, foot.y);
  const apart = Math.hypot(other.x - centre.x, other.y - centre.y);
  const touch = at(
    centre.x + ((other.x - centre.x) * radius) / apart,
    centre.y + ((other.y - centre.y) * radius) / apart,
  );
  const degrees = (from: Vec2, to: Vec2) =>
    (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  const leaves = degrees(centre, touch);
  const turned = turn(centre, radius, hookFrom(f), leaves);
  const hook = {
    ...turned,
    segments: turned.segments.map((segment) =>
      segment.kind === "arc" ? { ...segment, pieces: 3 } : segment,
    ),
  };
  let enters = degrees(other, touch);
  if (enters < 0) enters += 360;
  // Over Lora's full stop, dipping under the line.
  return {
    strokes: [
      ...finish(f, [ink(f, chain(hook, inPieces(turn(other, r, enters, 180), 2)), f.end, f.end)])
        .strokes,
      loraDot(f, foot.x, 0),
    ],
  };
}

/**
 * The two as Lora's: the diagonal leaving the bowl as the bowl's own curve
 * and easing into an S down to the foot -- steeper than its chord where it
 * leaves the bowl, flatter through the middle and steeper again into the
 * foot -- where the construction's ran as one straight band.
 *
 * Otherwise the construction's two (see `figures.ts`): the bowl carried round
 * exactly as far as leaves it travelling the way the diagonal sets off, the
 * diagonal cut level on the line with its left corner on the foot's end, and
 * the foot from where the diagonal's left edge crosses its top.
 */
export function humanistTwo(style: Style): Recipe {
  const f = frame(style);
  const width = figureWidth(f);
  const left = f.edge;
  const grown = heavyFigure(f) / 2;
  const drawn = width / 2 - grown;
  const low = Math.min(drawn, (f.crest(f.cap) - f.dip(0)) * 0.3);
  const radius = Math.max(drawn + (low - drawn) * Math.min(1, f.gain / (f.x * 0.05)), f.least);
  const wide = bendWidth(f, radius) + grown;
  const centre = at(left + radius + grown, f.crest(f.cap) - radius);
  const pen = penReach(style.pen);
  // How far each end of the S turns off its chord: see `TWO_SAG`.
  const turned = 2 * Math.atan(2 * TWO_SAG);
  const rotate = (v: Vec2, by: number): Vec2 =>
    at(v.x * Math.cos(by) - v.y * Math.sin(by), v.x * Math.sin(by) + v.y * Math.cos(by));
  /*
   * Where on the baseline the run lands so its left corner is on `left`,
   * reckoned along the way the S arrives there, steeper than its chord.
   */
  const toward = (from: Vec2): Vec2 => {
    let lands = at(left, 0);
    for (let pass = 0; pass < 3; pass++) {
      const d = { x: lands.x - from.x, y: lands.y - from.y };
      const length = Math.hypot(d.x, d.y) || 1;
      const u = rotate({ x: d.x / length, y: d.y / length }, turned);
      const shift = reachAlong({ x: -u.y, y: u.x }, pen);
      lands = at(left + Math.abs(shift.x - (u.x * shift.y) / u.y), 0);
    }
    return lands;
  };
  // The bowl leaves travelling the way the S sets off: its chord, turned steeper.
  const miss = (angle: number): number => {
    const run = bend(f, centre, radius, hookFrom(f), angle, wide);
    const from = spineEnd(run);
    const heading = headingAt(run.segments[run.segments.length - 1], "end");
    const to = toward(from);
    const aim = rotate(towards(from, to), turned);
    // Wrapped, so headings either side of straight back do not read a turn apart.
    const apart = Math.atan2(aim.y, aim.x) - Math.atan2(heading.y, heading.x);
    return Math.abs(Math.atan2(Math.sin(apart), Math.cos(apart)));
  };
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
  const joins = spineEnd(over);
  const lands = toward(joins);
  const middle = at((joins.x + lands.x) / 2, (joins.y + lands.y) / 2);
  /*
   * The S as two arcs bowed opposite ways about its middle, which meet there
   * on one tangent; begun a little way back up inside the bowl's end so the
   * two cut ends do not meet edge to edge.
   */
  const leaving = rotate(towards(joins, lands), turned);
  const overlap = at(joins.x - leaving.x * f.half * 0.3, joins.y - leaving.y * f.half * 0.3);
  const diagonal = chain(
    straight(overlap, joins),
    bowed(f, joins, middle, TWO_SAG),
    bowed(f, middle, lands, -TWO_SAG),
  );
  // The way it arrives on the line, for where its edges cross the foot's top.
  const way = rotate(towards(lands, joins), turned);
  const footTop = f.sits(0, f.bar) * 2;
  const edges = (y: number): number[] =>
    [1, -1].map((side) => {
      const across = reachAlong({ x: -way.y * side, y: way.x * side }, pen);
      return lands.x + across.x + ((y - lands.y - across.y) * way.x) / Math.max(way.y, 1e-6);
    });
  const heel = Math.min(...edges(footTop));
  const toe = Math.max(...edges(0));
  const footFrom = heel < toe ? (heel + toe) / 2 : heel + 2;
  return finish(f, [
    ink(f, over, f.end, BUTT),
    ink(f, diagonal, BUTT, { kind: "butt", level: true }),
    arm(f, footFrom, left + width, f.sits(0, f.bar)),
  ]);
}

/** How far each half of the two's S bows off its chord, against its length. */
const TWO_SAG = 0.06;

/**
 * The seven as Lora's: the arm running out to the right from a beak, and the
 * stem leaving its right end falling straight down, turning into its slant
 * within a sixth of the height and then bowing a little more upright as it
 * falls, to end on the line in a round tail rather than on a foot serif.
 *
 * The construction's stem left the arm's end at its slant, so the corner was
 * a point and the stem stood half a stem left of Lora's all the way down; and
 * drawn in one run with the arm, the arm's end took a nick of a beak where
 * Lora's hangs a quarter of the cap height.
 */
export function humanistSeven(style: Style): Recipe {
  const f = frame(style);
  const width = figureWidth(f);
  const left = f.edge;
  const armY = f.hangs(f.cap);
  // The stem's right edge flush with the arm's end.
  const stemHalf = Math.abs(reachAlong(at(1, 0), penReach(f.style.pen)).x);
  const right = left + width;
  const stemX = right - stemHalf;
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  // The turn out of the corner, from straight down into the slant.
  const bendR = Math.max(f.cap * SEVEN_TURN + f.half, f.half * 1.3);
  const centre = at(stemX - bendR, armY);
  const leaves = -SEVEN_SLANT;
  const turned = at(
    centre.x + bendR * Math.cos(rad(leaves)),
    centre.y + bendR * Math.sin(rad(leaves)),
  );
  // And on down to the line, the chord a little steeper than the slant the
  // turn left it on, so the bow brings it more upright as it falls.
  const bowTurn = 2 * Math.atan(2 * SEVEN_BOW);
  const chordFromUpright = rad(SEVEN_SLANT) - bowTurn;
  const floor = f.dip(0) + 5;
  const end = at(turned.x - (turned.y - floor) * Math.tan(chordFromUpright), floor);
  return finish(f, [
    arm(f, right, left, armY),
    ink(
      f,
      chain(inPieces(turn(centre, bendR, 0, leaves), 2), bowed(f, turned, end, -SEVEN_BOW)),
      BUTT,
      { kind: "round" },
    ),
  ]);
}

/** How far the seven's stem bows off its chord, below the turn out of the corner. */
const SEVEN_BOW = 0.012;
/** How far off upright the seven's stem leaves the turn: Lora's is 22 degrees. */
const SEVEN_SLANT = 22;
/** The radius of the seven's turn out of the corner, against the cap height. */
const SEVEN_TURN = 0.36;

/**
 * The ampersand as Lora draws it: a small loop at the cap height and a large
 * bowl on the line, joined by the one run that crosses between them, and a
 * long diagonal leaving the loop's left side and running down to the right
 * into a foot along the line. The bowl comes round and up into a short arm
 * standing under a flat bar, as a text face's does. Every turn is tangent to
 * the runs either side of it, and every one is drawn in fixed pieces.
 *
 * The construction's ampersand crossed a straight arm through its diagonal
 * under a bar that floated free of it, and ran half as wide again as Lora's.
 */
export function humanistAmpersand(style: Style): Recipe {
  const f = frame(style);
  const C = f.cap;
  /*
   * The bowl and the loop drawn lighter past a Bold, as a Black's small
   * counters are, so they can stay their own size: on the stem's pen they had
   * to grow with it, and at an Ultra the two were more than the cap height
   * one over the other and the loop was pushed out to the right, a second
   * blot beside the first.
   */
  const share = 1 - AMP_LIGHTER * Math.min(1, Math.max(0, heaviness(f) - 0.5));
  // And a little smaller past the Bold, so the two still stand one over the
  // other at an Ultra rather than the loop being pushed out beside the bowl.
  const past = Math.min(1, Math.max(0, (heaviness(f) - 0.45) / 1.05));
  const R = Math.max(C * (AMP_BOWL - 0.04 * past), f.half * share * 1.4);
  const r = Math.max(C * (AMP_LOOP - 0.01 * past), f.half * share * 1.3);
  const bowlAt = at(f.edge + R, f.dip(0) + R);
  /*
   * The loop over the bowl, and where a heavy pen leaves the two no room
   * one over the other, out to the right until the run between them has a
   * length to cross on, as a Black's loop sits -- never up past the cap line.
   */
  const rise = f.crest(C) - r - bowlAt.y;
  const clear = (r + R) * 1.02;
  const over = Math.max(C * 0.05, Math.sqrt(Math.max(0, clear * clear - rise * rise)));
  const loopAt = at(bowlAt.x + over, f.crest(C) - r);
  // The run that crosses from the bowl's upper left to the loop's lower
  // right: the tangent common to both, between them.
  const d = at(loopAt.x - bowlAt.x, loopAt.y - bowlAt.y);
  const apart = Math.hypot(d.x, d.y);
  const phi = Math.atan2(d.y, d.x);
  const spread = Math.acos(Math.min(1, (r + R) / apart));
  const theta = phi + spread;
  const n = at(Math.cos(theta), Math.sin(theta));
  const onBowl = at(bowlAt.x + R * n.x, bowlAt.y + R * n.y);
  const onLoop = at(loopAt.x - r * n.x, loopAt.y - r * n.y);
  const degrees = (radians: number) => (radians * 180) / Math.PI;
  const bowlTo = degrees(theta) - 360;
  const loopFrom = degrees(theta) + 180;
  // The arm, standing on the bowl's right a little up from its middle.
  const armFrom = pointOn(bowlAt, R, ARM_LEAVES);
  // The arm up to Lora's serif, 387 on a cap height of 700.
  const head = Math.max(f.hangs(C * 0.553), armFrom.y + f.half);
  const armTop = at(armFrom.x + R * ARM_OUT, head);
  /*
   * The diagonal, laid through the bowl's lower right, where the arm leaves
   * it, and up at DIAGONAL degrees until it meets the loop: so the bowl's
   * counter is closed along its upper right by the diagonal and the arm
   * stands outside it, as Lora's does. Laid off the loop's lower left at a
   * fixed slope, the diagonal passed the bowl by and the arm stood up inside
   * the counter as a stick.
   */
  const up = at(-Math.cos((DIAGONAL * Math.PI) / 180), Math.sin((DIAGONAL * Math.PI) / 180));
  const toLoop = at(armFrom.x - loopAt.x, armFrom.y - loopAt.y);
  const b = toLoop.x * up.x + toLoop.y * up.y;
  const c = toLoop.x * toLoop.x + toLoop.y * toLoop.y - r * r;
  const hits = b * b - c;
  const t = hits > 0 ? -b - Math.sqrt(hits) : -1;
  const met = t > 0 ? at(armFrom.x + up.x * t, armFrom.y + up.y * t) : pointOn(loopAt, r, 220);
  const at360 = (degrees(Math.atan2(met.y - loopAt.y, met.x - loopAt.x)) + 360) % 360;
  const leaves = at360 > 180 && at360 < 330 ? at360 : 220;
  const from = pointOn(loopAt, r, leaves);
  const slope =
    armFrom.x - from.x > 1 && from.y > armFrom.y
      ? (from.y - armFrom.y) / (armFrom.x - from.x)
      : Math.tan((DIAGONAL * Math.PI) / 180);
  const foot = Math.max(C * 0.12, f.half * 1.6);
  const line = f.sits(0);
  const kneeY = line + foot * (1 - Math.sin((40 * Math.PI) / 180));
  const knee = at(from.x + (from.y - kneeY) / slope, kneeY);
  const turnAt = at(knee.x + foot * Math.cos((40 * Math.PI) / 180), line + foot);
  const heel = at(turnAt.x, line);
  const reach = f.half + (f.end.projection ?? f.half * 0.6);
  return finish(f, [
    lighter(
      ink(
        f,
        chain(pinned(turn(bowlAt, R, ARM_LEAVES, bowlTo), 4), straight(onBowl, onLoop)),
        BUTT,
        BUTT,
      ),
      share,
    ),
    // The arm on its own, run on a little way down into the bowl, and as
    // light as the bowl it leaves: on the stem's pen its foot stood out into
    // the bowl's counter as a nib.
    lighter(
      ink(
        f,
        chain(
          pinned(arriving(armTop, armFrom, ARM_LEAVES - 90), 1),
          pinned(turn(bowlAt, R, ARM_LEAVES, ARM_LEAVES - 12), 1),
        ),
        BUTT,
        BUTT,
      ),
      share,
    ),
    // The loop on its own, taken on from a little back along the run into
    // it: in one run with it, the loop's end came round across the run.
    lighter(ink(f, pinned(turn(loopAt, r, loopFrom - 10, leaves + 360), 4), BUTT, BUTT), share),
    // The diagonal as light as the loop it leaves, or its full pen stood out
    // of the loop's edge as a step.
    lighter(
      ink(
        f,
        chain(
          pinned(turn(loopAt, r, leaves - 12, leaves), 1),
          straight(from, knee),
          pinned(turn(turnAt, foot, 220, 270), 1),
          // Out along the line as far as Lora's, 93 past the turn.
          straight(heel, at(heel.x + Math.min(f.half * 2.7, C * 0.165), line)),
        ),
        BUTT,
        BUTT,
      ),
      share,
    ),
    // Reaching back less far at a Black, over a counter that has closed up
    // under it: carried its full length, its end stood into the bowl's.
    ink(
      f,
      straight(
        at(armTop.x - reach * (1 - 1.5 * (1 - share)), head),
        at(armTop.x + reach * 1.1, head),
      ),
      BUTT,
      BUTT,
    ),
  ]);
}

/** Where the ampersand's arm leaves its bowl, in degrees round from the right. */
const ARM_LEAVES = -10;
/** The ampersand's bowl and loop, their radii against the cap height, as Lora's. */
const AMP_BOWL = 0.26;
const AMP_LOOP = 0.19;
/** How much lighter the bowl and the loop are drawn at a Black. */
const AMP_LIGHTER = 0.3;
/** How steeply the ampersand's diagonal falls, in degrees. */
const DIAGONAL = 45;
/** How far right of where it leaves the bowl the arm's head stands, against the bowl's radius. */
const ARM_OUT = 0.1;

/**
 * The circular arc from `from` to `to` that arrives at `to` travelling at
 * `heading` degrees: so a stroke carried on from there by a turn goes on
 * without a corner. Straight where no arc will do.
 */
function arriving(from: Vec2, to: Vec2, heading: number): Spine {
  const way = at(Math.cos((heading * Math.PI) / 180), Math.sin((heading * Math.PI) / 180));
  const left = at(-way.y, way.x);
  const back = at(from.x - to.x, from.y - to.y);
  const across = back.x * left.x + back.y * left.y;
  if (Math.abs(across) < 1e-6) return straight(from, to);
  // Signed: the centre stands to the left of the way it arrives where positive.
  const radius = (back.x * back.x + back.y * back.y) / (2 * across);
  const centre = at(to.x + left.x * radius, to.y + left.y * radius);
  const startAngle = Math.atan2(from.y - centre.y, from.x - centre.x);
  const endAngle = Math.atan2(to.y - centre.y, to.x - centre.x);
  // Turning left (anticlockwise) about a centre on the left.
  const positive = radius > 0;
  let end = endAngle;
  if (positive) while (end < startAngle) end += Math.PI * 2;
  else while (end > startAngle) end -= Math.PI * 2;
  return {
    segments: [
      {
        kind: "arc",
        centre,
        radius: Math.abs(radius),
        startAngle,
        endAngle: end,
        sweepPositive: positive,
      },
    ],
    closed: false,
  };
}

/** A turn drawn in so many pieces at every weight. */
function pinned(spine: Spine, pieces: number): Spine {
  return inPieces(spine, pieces);
}

/**
 * The R whose leg leaves the bowl as Lora's does: straight down at its
 * slant, and in its last few units turning out along the line into a toe
 * cut upright, with no serif -- where the construction's leg was bowed all
 * the way down, leaning out further than Lora's, and a serif at its foot
 * stood its inner wing out to the left as a spur.
 */
export function humanistCapitalR(style: Style): Recipe {
  const f = frame(style);
  const recipe = LETTERS.R(style);
  const [stem, lobe, leg] = recipe.strokes;
  const [run] = leg?.spine.segments ?? [];
  if (!stem || !lobe || run?.kind !== "line") return recipe;
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  // Leaving the bowl's foot a third of a stem further out than the
  // construction's, where Lora's leaves it.
  const from = at(run.from.x + f.half * 2 * R_LEAVES, run.from.y);
  const base = run.to.y;
  const pen = penReach(leg.pen);
  // The toe's spine level, its lower edge on the line.
  const lift = Math.abs(reachAlong(at(0, -1), pen).y);
  const r = Math.max(f.half * R_KICK, lift * 1.3, f.least);
  // Turning left, anticlockwise: each point on the turn stands a right angle
  // clockwise of the way it is travelling.
  const on = (heading: number) => rad(heading - 90);
  const toeY = base + lift;
  const kneeY = toeY + r * (Math.sin(on(-R_SLANT)) - Math.sin(on(0)));
  const knee = at(from.x + (from.y - kneeY) / Math.tan(rad(R_SLANT)), kneeY);
  const centre = at(knee.x - r * Math.cos(on(-R_SLANT)), knee.y - r * Math.sin(on(-R_SLANT)));
  let toe = at(centre.x, toeY);
  /*
   * And out as far as puts its toe past the bowl: past a Bold the bowl widens
   * with the pen, and the leg under it stood back beneath its left half, a
   * P with a stub under it.
   */
  const bowlRight = contoursBounds(sweep(lobe)).xMax;
  // Lora's toe stands past its bowl a quarter of the leg's height at the
  // Regular, and at the Bold (whose bowl here is the wider) a little past it.
  const reach = R_TOE + (R_TOE_BOLD - R_TOE) * Math.min(1, heaviness(f) / 0.44);
  // And never none: on a narrow R the bowl ends short of the turn, and the
  // leg stopped at the foot of its turn with no toe at all.
  toe = at(Math.max(toe.x + r * 0.5, bowlRight + reach * Math.abs(from.y - base)), toeY);
  return {
    ...recipe,
    strokes: [
      stem,
      lobe,
      inherit(leg, {
        ...leg,
        spine: chain(
          straight(from, knee),
          inPieces(turn(centre, r, -R_SLANT - 90, -90), 2),
          straight(at(centre.x, toeY), toe),
        ),
        end: BUTT,
      }),
    ],
  };
}

/** How much further out along the bowl's foot the R's leg leaves it, against the stem. */
const R_LEAVES = 0.32;
/** The R's leg's slant, off level: Lora's is 56 degrees. */
const R_SLANT = 56;
/** The radius of the turn into the R's toe, against half the pen. */
const R_KICK = 1.6;
/** How far the R's toe stands past its bowl at least, against the leg's height. */
const R_TOE = 0.25;
/** And at the Bold, where the bowl drawn here is nearly as wide as Lora's toe reaches. */
const R_TOE_BOLD = 0.04;

// ---------------------------------------------------------------------------
// The Serif's signs, as Lora draws them
// ---------------------------------------------------------------------------

type Framed = ReturnType<typeof frame>;

/**
 * A measure of Lora's taken at its Regular (a pen of 87) and its Bold (142),
 * run on along the same line to either side: a stroke's weight, which goes
 * on growing with the pen past the Bold and thinning under the Regular.
 */
export function byPen(style: Style, regular: number, bold: number): number {
  return regular + ((bold - regular) * (style.pen.weight - 87)) / 55;
}

/**
 * A measure of Lora's at its Regular and its Bold, held at the Regular's
 * under it and past the Bold growing on by `past` units a unit of pen: a
 * sign's size, which follows the weight only as far as its counters need.
 */
export function bySize(style: Style, regular: number, bold: number, past = 0): number {
  const t = Math.min(Math.max((style.pen.weight - 87) / 55, 0), 1);
  return regular + (bold - regular) * t + Math.max(0, style.pen.weight - 142) * past;
}

/** A stroke drawn with an even pen of its own, as a sign's strokes are. */
export function signStroke(
  f: Framed,
  spine: Spine,
  weight: number,
  start: Terminal = BUTT,
  end: Terminal = BUTT,
): Stroke {
  const drawn = ink(f, spine, start, end);
  return inherit(drawn, {
    ...drawn,
    pen: { ...f.style.pen, weight: Math.max(weight, 1), contrast: 0, angle: 0 },
  });
}

/** Lora's units -- a thousand to the em on an x-height of 500 -- in the face's. */
export function loraUnit(f: Framed): number {
  return f.xOwn / 500;
}

/** The middle of the arithmetic signs in Lora: 362 up, on an x-height of 500. */
export const SIGN_MIDDLE = 362;

/** How far Lora's dots dip under the line they stand on, in its units. */
export const DIP = 16;

/**
 * One of Lora's dots: the full stop's width across and a little taller, 117
 * by 129 at the Regular and 145 by 156 at the Bold, dipping `DIP` under
 * `foot` as a round letter does. The construction's was round and stood on
 * the line.
 */
export function loraDot(f: Framed, x: number, foot: number): Stroke {
  const u = loraUnit(f);
  const radius = stopRadius(f);
  const tall = bySize(f.style, 12, 11) * u;
  const low = foot - DIP * u + radius;
  const round: Terminal = { kind: "round" };
  return {
    spine: straight(at(x, low), at(x, low + tall)),
    pen: { ...f.style.pen, contrast: 0, angle: 0, weight: radius * 2 },
    start: round,
    end: round,
  };
}

/**
 * The plus as Lora's: 446 across and as tall, its middle 362 up, the bars
 * 50 deep at the Regular and 78 at the Bold. The construction's was a fifth
 * smaller, hung 130 units lower and drew its bars at the stem's weight.
 * Past the Bold the arms grow as fast as the bars do, or they were stubs.
 */
export function humanistPlus(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const bar = byPen(style, 50, 78) * u;
  const reach = (446 * u + Math.max(0, bar - 78 * u)) / 2;
  const x = f.edge + reach;
  const y = SIGN_MIDDLE * u;
  return finish(f, [
    signStroke(f, straight(at(x - reach, y), at(x + reach, y)), bar),
    signStroke(f, straight(at(x, y - reach), at(x, y + reach)), bar),
  ]);
}

/**
 * The equals sign as Lora's: two bars 446 long, 50 deep at the Regular and
 * 78 at the Bold, 150 apart at the Regular and 178 at the Bold, about 365
 * up. The construction's were 80 units short and stood with their middle at
 * the x-height's.
 */
export function humanistEqual(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const bar = byPen(style, 50, 78) * u;
  const apart = (75 + Math.max(0, byPen(style, 50, 78) - 50) * 0.5) * u;
  const y = 365 * u;
  const long = 446 * u + Math.max(0, bar - 78 * u);
  return finish(
    f,
    [y - apart, y + apart].map((level) =>
      signStroke(f, straight(at(f.edge, level), at(f.edge + long, level)), bar),
    ),
  );
}

/**
 * The division sign as Lora's: the plus's bar with a dot 129 across at the
 * Regular (156 at the Bold) standing 166 over and under its middle.
 */
export function humanistDivide(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const bar = byPen(style, 50, 78) * u;
  const long = 446 * u + Math.max(0, bar - 78 * u);
  const y = SIGN_MIDDLE * u;
  const radius = Math.max(byPen(style, 64.5, 78) * u, stopRadius(f));
  // Held off the bar by at least what Lora's Bold keeps, so a heavy dot
  // stands clear of it.
  const reach = Math.max(166 * u, bar / 2 + radius + 45 * u);
  return finish(f, [
    signStroke(f, straight(at(f.edge, y), at(f.edge + long, y)), bar),
    dot(f, at(f.edge + long / 2, y + reach), radius),
    dot(f, at(f.edge + long / 2, y - reach), radius),
  ]);
}

/**
 * The multiplication sign as Lora's: two bars crossing square at 362 up,
 * 318 from end to end across and as tall, cut square, at the plus's weight.
 */
export function humanistMultiply(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const bar = byPen(style, 50, 78) * u;
  const half = (318 * u + Math.max(0, bar - 78 * u)) / 2;
  const x = f.edge + half;
  const y = SIGN_MIDDLE * u;
  return finish(f, [
    signStroke(f, straight(at(x - half, y - half), at(x + half, y + half)), bar),
    signStroke(f, straight(at(x - half, y + half), at(x + half, y - half)), bar),
  ]);
}

/**
 * The less-than and the greater-than as Lora's: two arms rising 0.44
 * across off level from a point 315 up, their spines meeting there so the
 * point is cut upright as the ends are, 445 across at the Regular and 450
 * at the Bold, the arms 64 deep at the Regular and 101 at the Bold. The
 * construction's were steeper, came down under the line and drew their
 * arms at the stem's weight.
 */
function loraAngle(style: Style, way: 1 | -1): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const slope = 0.44;
  const cos = 1 / Math.hypot(1, slope);
  const deep = byPen(style, 64, 101) * u;
  const middle = 315 * u;
  // Past the Bold reaching further as the arms grow deeper, or the inside
  // closed.
  const wide = bySize(style, 445, 450) * u + Math.max(0, deep - 101 * u) * 1.2;
  const rise = wide * slope;
  const x = (along: number) => (way === 1 ? f.edge + along : f.edge + wide - along);
  const cut: Terminal = { kind: "butt", aligned: true };
  return finish(
    f,
    ([1, -1] as const).map((side) =>
      signStroke(
        f,
        straight(at(x(0), middle), at(x(wide), middle + side * rise)),
        deep * cos,
        cut,
        cut,
      ),
    ),
  );
}

export const humanistLess = (style: Style): Recipe => loraAngle(style, 1);
export const humanistGreater = (style: Style): Recipe => loraAngle(style, -1);

/**
 * The underscore as Lora's: a bar 615 long hanging from 50 under the line,
 * 61 deep at the Regular and 105 at the Bold. The construction's was a
 * quarter of that long.
 */
export function humanistUnderscore(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const deep = byPen(style, 61, 105) * u;
  const y = -50 * u - deep / 2;
  return finish(f, [signStroke(f, straight(at(f.edge, y), at(f.edge + 615 * u, y)), deep)]);
}

/**
 * The number sign as Lora's: two uprights leaning 0.236 across for every
 * unit up, from under the line to the cap line and 280 apart, and two bars
 * reaching 166 past them either side, cut along the uprights' lean. The
 * uprights are 70 across at
 * the Regular and 105 at the Bold, the bars 60 and 89 deep, about 208 and
 * 499 up. The construction's was half as wide and heavier than a stem, and
 * past a Black its bars filled the counter.
 */
export function humanistNumberSign(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const slope = 0.236;
  const cos = 1 / Math.hypot(1, slope);
  const across = byPen(style, 70, 105) * u;
  const deep = byPen(style, 60, 89) * u;
  const apart = bySize(style, 280, 275, 0.45) * u;
  const left = f.edge;
  const foot = -f.over;
  const head = f.cap + f.over;
  const lower = bySize(style, 208, 198.5, -0.1) * u;
  const upper = bySize(style, 499, 484.5, 0.1) * u;
  // How far each bar reaches past the outside of the upright it ends at.
  const past = bySize(style, 166, 165, 0.2) * u;
  const upright = (x: number): Stroke =>
    signStroke(
      f,
      straight(at(x + slope * foot, foot), at(x + slope * head, head)),
      across * cos,
      LEVEL,
      LEVEL,
    );
  /*
   * Each bar a short run up the uprights' lean, as tall as the bar is deep
   * and cut level, drawn with a pen as wide as the bar is long, so its ends
   * lie along the lean as Lora's do.
   */
  const bar = (y: number): Stroke => {
    const from = left + slope * y - across / 2 - past;
    const to = left + apart + slope * y + across / 2 + past;
    const middle = (from + to) / 2;
    const rise = deep / 2;
    return signStroke(
      f,
      straight(at(middle - slope * rise, y - rise), at(middle + slope * rise, y + rise)),
      (to - from) * cos,
      LEVEL,
      LEVEL,
    );
  };
  return finish(f, [upright(left), upright(left + apart), bar(lower), bar(upper)]);
}

/**
 * The percent as Lora's: two ovals drawn with the face's own pen -- heavy
 * at their sides, hairlines at their crowns -- the upper at the left
 * standing on the cap line, the lower at the right on the baseline, and a
 * long slash between them leaning 0.81 across for every unit up. The rings
 * are 365 across and 381 tall at the Regular (376 and 391 at the Bold). The
 * construction's rings were two thirds of that, and past a Black the sign
 * widened round its rings until it was three letters wide.
 */
export function humanistPercent(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  // Lighter than the stem from the Regular on: Lora Bold's sides are 122.
  const w = style.pen.weight;
  const side = Math.min(w, 87 + (w - 87) * (35 / 55), 122 + (w - 142) * 0.4) * u;
  const ringFrame = { ...f, half: side / 2 };
  const crown = side * (1 - Math.min(Math.max(f.style.pen.contrast, 0), 0.9));
  const halfW = bySize(style, 182.5, 188, 0.35) * u;
  const halfH = bySize(style, 190.5, 195.5) * u;
  const across = byPen(style, 74, 120) * u;
  const slope = bySize(style, 0.81, 0.857);
  const cos = 1 / Math.hypot(1, slope);
  // The lower ring's middle from the upper's: past the Bold moving apart as
  // the rings and the slash grow.
  const apart =
    bySize(style, 433.5, 446.5) * u +
    Math.max(0, halfW - 188 * u) * 2 +
    Math.max(0, across - 120 * u) * 0.5;
  const foot = -f.over;
  const head = f.cap + f.over;
  const upper = at(f.edge - f.half + halfW, head - halfH);
  const lower = at(upper.x + apart, foot + halfH);
  const oval = (centre: Vec2): Stroke => {
    const drawn = ink(ringFrame, ring(ringFrame, centre, halfW - side / 2, halfH - crown / 2));
    return inherit(drawn, { ...drawn, pen: { ...f.style.pen, weight: side } });
  };
  const mid = at((upper.x + lower.x) / 2, (upper.y + lower.y) / 2);
  return finish(
    f,
    [
      oval(upper),
      signStroke(
        f,
        straight(
          at(mid.x + slope * (foot - mid.y), foot),
          at(mid.x + slope * (head - mid.y), head),
        ),
        across * cos,
        LEVEL,
        LEVEL,
      ),
      oval(lower),
    ],
    true,
  );
}

/**
 * The square brackets as Lora's: an upright 72 across at the Regular and
 * 127 at the Bold, from the descender to the ascender, and arms 62 and 74
 * deep reaching 268 and 323 from its outside, cut upright. The
 * construction's arms were stubs and its upright heavier than a stem.
 */
function loraBracket(style: Style, facing: 1 | -1): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const across = byPen(style, 72, 127) * u;
  const deep = byPen(style, 62, 74) * u;
  const reach = byPen(style, 268, 323) * u;
  const foot = f.desc;
  const head = f.asc;
  const X = (x: number) => (facing > 0 ? f.edge + x : f.edge + reach - x);
  return finish(f, [
    signStroke(f, straight(at(X(across / 2), foot), at(X(across / 2), head)), across, LEVEL, LEVEL),
    ...[head - deep / 2, foot + deep / 2].map((y) =>
      signStroke(f, straight(at(X(across / 2), y), at(X(reach), y)), deep),
    ),
  ]);
}

export const humanistBracketLeft = (style: Style): Recipe => loraBracket(style, 1);
export const humanistBracketRight = (style: Style): Recipe => loraBracket(style, -1);

/**
 * A run of arcs and straights laid end to end from `from`, setting off at
 * `heading` degrees: each step either runs straight on for `run`, or turns
 * through `turn` degrees (anticlockwise where positive) on `radius`.
 */
function steered(
  from: Vec2,
  heading: number,
  steps: Array<{ run: number } | { radius: number; turn: number }>,
): { spine: Spine; to: Vec2 } {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  let point = from;
  let going = heading;
  const parts: Spine[] = [];
  for (const step of steps) {
    if ("run" in step) {
      const to = at(
        point.x + Math.cos(rad(going)) * step.run,
        point.y + Math.sin(rad(going)) * step.run,
      );
      parts.push(straight(point, to));
      point = to;
      continue;
    }
    const side = step.turn > 0 ? 1 : -1;
    // The centre stands a right angle round from the way it is going, on the
    // side it turns towards.
    const centre = at(
      point.x + step.radius * Math.cos(rad(going + 90 * side)),
      point.y + step.radius * Math.sin(rad(going + 90 * side)),
    );
    const start = going - 90 * side;
    parts.push(turn(centre, step.radius, start, start + step.turn));
    going += step.turn;
    point = at(
      centre.x + step.radius * Math.cos(rad(start + step.turn)),
      centre.y + step.radius * Math.sin(rad(start + step.turn)),
    );
  }
  return { spine: chain(...parts), to: point };
}

/** A spine mirrored across the level `about` (axis "y") or the upright (axis "x"). */
function mirrored(spine: Spine, axis: "x" | "y", about: number): Spine {
  const over = (p: Vec2) => (axis === "y" ? at(p.x, 2 * about - p.y) : at(2 * about - p.x, p.y));
  return {
    closed: spine.closed,
    segments: spine.segments.map((one) =>
      one.kind === "line"
        ? { kind: "line", from: over(one.from), to: over(one.to) }
        : {
            ...one,
            centre: over(one.centre),
            startAngle: axis === "y" ? -one.startAngle : Math.PI - one.startAngle,
            endAngle: axis === "y" ? -one.endAngle : Math.PI - one.endAngle,
            sweepPositive: !one.sweepPositive,
          },
    ),
  };
}

/** How steeply each half of Lora's brace leaves its point, in degrees off level. */
const BRACE_POINT = 8;
/** How far it runs from the point before turning up, in Lora's units. */
const BRACE_NUB = 45;
/** How far past upright its upright leans back in, in degrees. */
const BRACE_BACK = 5;

/**
 * The braces as Lora's: curved, not angled. Each half leaves the point at
 * 263 up heading out at 22 degrees and swells round a wide turn to stand
 * furthest out 137 over it, leans back in a little up the upright, and turns
 * over into a short level end cut upright -- drawn with the face's own pen,
 * so the upright is heavy and the ends and the point light. 315 across at
 * the Regular and 364 at the Bold, from 271 under the line to 760 over it,
 * the lower half the longer. The construction's turned in straight corners,
 * and past a Black came to an arrowhead.
 */
function loraBrace(style: Style, facing: 1 | -1): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const w = style.pen.weight;
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  // Lora's upright is 80 across at the Regular and 138 at the Bold.
  // Past the Bold gaining only half what the stem does, or its point was a
  // block and its inside a slot.
  const share = Math.min(1, 0.92 + Math.max(0, w - 87) * (0.05 / 55));
  const pen =
    f.style.pen.weight * share - Math.max(0, f.style.pen.weight - 142 * (f.xOwn / 500)) * 0.5;
  const half = pen / 2;
  const point = 263 * u;
  // The level end's spine stands half its own depth under the ink's reach.
  const endDepth = pen * (1 - Math.min(Math.max(f.style.pen.contrast, 0), 0.9));
  // Where the half stands out furthest, how far over the point, and the
  // turns into and out of the upright, none tighter than the pen can go
  // round.
  const furthest = byPen(style, 166, 185.5) * u;
  const rise = bySize(style, 137, 157) * u;
  const nub = BRACE_NUB * u;
  const sin = Math.sin(rad(BRACE_POINT));
  const cos = Math.cos(rad(BRACE_POINT));
  const into = Math.max((rise - nub * sin) / cos, half * 1.15);
  const over = Math.max(byPen(style, 152, 129) * u, half * 1.15);
  const right = byPen(style, 322, 364) * u;
  const heading = 90 + BRACE_BACK;
  const halfOf = (reach: number): Spine => {
    const top = point + reach - endDepth / 2;
    const tip = at(f.edge + furthest - into + into * sin - nub * cos, point);
    const round = steered(tip, BRACE_POINT, [
      { run: nub },
      { radius: into, turn: heading - BRACE_POINT },
    ]);
    // Up until the turn over lands the end on `top`.
    const upright = Math.max(
      (top - round.to.y - over * (1 - Math.cos(rad(heading)))) / Math.sin(rad(heading)),
      1,
    );
    const up = steered(round.to, heading, [{ run: upright }, { radius: over, turn: -heading }]);
    return chain(
      round.spine,
      up.spine,
      straight(up.to, at(Math.max(f.edge + right, up.to.x + 1), up.to.y)),
    );
  };
  // From under the descender to over the ascender, as the slash runs.
  const upper = halfOf(f.asc + f.over * 0.3 - point);
  const lower = mirrored(halfOf(point - f.desc + f.over), "y", point);
  const flip = (spine: Spine) => (facing > 0 ? spine : mirrored(spine, "x", f.edge + right / 2));
  // The point cut upright, where the two halves meet; the ends too.
  const cut: Terminal = { kind: "butt", aligned: true };
  const lap = (spine: Spine): Stroke => {
    const drawn = ink(f, flip(spine), cut, cut);
    return inherit(drawn, { ...drawn, pen: { ...drawn.pen, weight: pen } });
  };
  return finish(f, [lap(upper), lap(lower)]);
}
export const humanistBraceLeft = (style: Style): Recipe => loraBrace(style, 1);
export const humanistBraceRight = (style: Style): Recipe => loraBrace(style, -1);
