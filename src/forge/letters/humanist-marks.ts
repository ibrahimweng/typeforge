/**
 * The Serif's punctuation and symbols, as Lora draws them.
 *
 * The same kind of drawing as the signs at the end of `humanist.ts`: each
 * mark measured off Lora Regular (a pen of 87) and Lora Bold (142), in Lora's
 * units -- a thousand to the em on an x-height of 500 -- and run on along the
 * same line to either side, so it follows the weight axis as the letters do.
 * Offered on every face as a Humanist form and drawn by default on the Serif
 * (see `alternates.ts` and `SERIF.forms`). Each is the same strokes at every
 * weight, so a weight axis can run through it.
 */

import type { Vec2 } from "@/font/types";
import type { Pen, Spine, Stroke, Terminal } from "../types";
import type { Style } from "../style";
import { contoursBounds } from "@/font/geometry";
import { LETTERS, recipeOf } from "../letters";
import { spineStart } from "../shapes";
import { sweep } from "../sweep";
import { byPen, bySize, DIP, loraDot, loraUnit, signStroke, textSerif } from "./humanist";
import {
  at,
  BUTT,
  finish,
  frame,
  inherit,
  ink,
  LEVEL,
  type Recipe,
  ring,
  stopRadius,
  straight,
  turn,
  chain,
  pointOn,
  dot,
  sized,
  dressedAs,
  setInside,
  borrowing,
  shovedStroke,
  spread,
  spine,
  bend,
  headingAt,
} from "./common";

type Framed = ReturnType<typeof frame>;

/** A stroke on a pen of its own, whatever the face's pen is. */
function penned(
  f: Framed,
  spine: Spine,
  pen: Pen,
  start: Terminal = BUTT,
  end: Terminal = BUTT,
): Stroke {
  const drawn = ink(f, spine, start, end);
  return inherit(drawn, { ...drawn, pen: { ...pen, weight: Math.max(pen.weight, 1) } });
}

/**
 * The frame a ring drawn with a pen `wide` across is bent in: round, whatever
 * the face's bowls are, and turned for that pen rather than the face's. Bent
 * square for a hairline face's pen, the currency sign's ring on its own heavy
 * pen folded at its corners.
 */
function roundOf(f: Framed, wide: number): Framed {
  return { ...f, square: 0, half: wide / 2 };
}

/** A round disc of its own size, whatever the face does to its full stops. */
function disc(centre: Vec2, radius: number, style: Style): Stroke {
  const round: Terminal = { kind: "round" };
  return {
    spine: straight(at(centre.x - 0.5, centre.y), at(centre.x + 0.5, centre.y)),
    pen: { ...style.pen, contrast: 0, angle: 0, weight: radius * 2 },
    start: round,
    end: round,
  };
}

/**
 * A straight run from `wideFrom` across at its start to `wideTo` at its end,
 * as two even strokes side by side: their outer edges are the sides of the
 * taper, and they overlap along the middle. Each is half the wider end
 * across, and neither end is drawn narrower than about half the other, or
 * the two would part down the middle. `startAlong` is the line the start is
 * cut along (a unit vector); the end is cut square.
 */
function tapered(
  f: Framed,
  from: Vec2,
  to: Vec2,
  wideFrom: number,
  wideTo: number,
  startAlong: Vec2,
  start: Terminal,
  end: Terminal,
): Stroke[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const d = at((to.x - from.x) / length, (to.y - from.y) / length);
  const n = at(-d.y, d.x);
  const widest = Math.max(wideFrom, wideTo);
  const w = widest / 2;
  const wide = Math.max(wideFrom, widest * 0.52);
  const narrow = Math.max(wideTo, widest * 0.52);
  const sin = Math.abs(d.x * startAlong.y - d.y * startAlong.x) || 1;
  // The start's line taken the way that lies on the same side as `n`, or the
  // two halves swap sides along the run and cross.
  const way = startAlong.x * n.x + startAlong.y * n.y < 0 ? -1 : 1;
  const cut = at(startAlong.x * way, startAlong.y * way);
  return ([-1, 1] as const).map((side) => {
    const off = (wide / 2 - w / 2) / sin;
    const a = at(from.x + side * off * cut.x, from.y + side * off * cut.y);
    const b = at(
      to.x + side * (narrow / 2 - w / 2) * n.x,
      to.y + side * (narrow / 2 - w / 2) * n.y,
    );
    const lean = Math.atan2(
      Math.abs((b.x - a.x) * n.x + (b.y - a.y) * n.y),
      Math.abs((b.x - a.x) * d.x + (b.y - a.y) * d.y),
    );
    return signStroke(f, straight(a, b), w * Math.cos(lean), start, end);
  });
}

// ---------------------------------------------------------------------------
// Dots and rings
// ---------------------------------------------------------------------------

/**
 * The middle dot as Lora's: its full stop raised to 328 at the Regular and
 * 342 at the Bold -- two thirds of the x-height, not half of it -- where the
 * construction's was a speck the pen's own size on the middle of the x-height.
 */
export function humanistPeriodCentered(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const radius = stopRadius(f);
  return finish(f, [dot(f, at(f.edge, bySize(style, 328, 342) * u), radius)]);
}

/**
 * The bullet as Lora's: a disc 301 across at the Regular and 320 at the Bold,
 * its middle 374 and 363 up -- three quarters of the x-height, where the
 * construction centred it on the middle.
 */
export function humanistBullet(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const radius = byPen(style, 150.5, 160) * u;
  const y = bySize(style, 374, 363) * u;
  return finish(f, [disc(at(f.edge - f.half + radius, y), radius, f.style)]);
}

/**
 * The degree sign as Lora's: a ring 311 across and 312 tall hung from 716 at
 * the Regular, 326 and 321 at the Bold, its sides 63 and 85 and its crown and
 * foot 52 and 70 -- the construction's was an oval on the letters' pen, and
 * at the Bold a third as big again as Lora's.
 */
export function humanistDegree(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const side = byPen(style, 63, 85) * u;
  const crown = byPen(style, 52, 70) * u;
  const halfW = bySize(style, 155.5, 163, 0.3) * u;
  const halfH = bySize(style, 156, 160.5, 0.3) * u;
  const top = 716 * u;
  const centre = at(f.edge - f.half + halfW, top - halfH);
  const pen: Pen = { weight: side, contrast: Math.min(0.6, 1 - crown / side), angle: 0 };
  return finish(
    f,
    [penned(f, ring(roundOf(f, side), centre, halfW - side / 2, halfH - crown / 2), pen)],
    true,
  );
}

/**
 * The currency sign as Lora's: an oval ring 368 across and 381 tall about
 * 258 up, drawn with a text pen -- its sides 86, its crown 35 -- and four
 * spokes 52 across out to its corners, 414 by 437 over all. The
 * construction's was a round ring on the letters' pen hung 90 units higher,
 * with spokes half as long.
 */
export function humanistCurrency(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  // Past the Bold the ring gains half what Lora's measures run on to and
  // grows to hold it, or its counter closed to a slit.
  const past = Math.max(0, style.pen.weight - 142);
  // And never lighter than a hairline pen draws it, or at the lightest the
  // crown ran out to nothing.
  const side = Math.max(
    (byPen(style, 86, 122) - past * 0.33) * u,
    Math.min(style.pen.weight, 40 * u),
    8,
  );
  const crown = Math.max((byPen(style, 37, 75) - past * 0.35) * u, side * 0.4);
  const halfW = bySize(style, 184, 190, 0.5) * u;
  const halfH = bySize(style, 190.5, 195.5, 0.5) * u;
  const spoke = (byPen(style, 52, 92) - past * 0.36) * u;
  const reach = bySize(style, 207, 207, 0.6) * u;
  const rise = bySize(style, 218.5, 231, 0.6) * u;
  const centre = at(f.edge - f.half + reach, 258 * u);
  const pen: Pen = { weight: side, contrast: Math.min(0.62, 1 - crown / side), angle: 0 };
  const spokes = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ].map(([sx, sy]) => {
    const tip = at(centre.x + sx * (reach - spoke * 0.35), centre.y + sy * (rise - spoke * 0.35));
    const inward = at(centre.x + sx * halfW * 0.62, centre.y + sy * halfH * 0.62);
    return signStroke(f, straight(inward, tip), spoke);
  });
  return finish(
    f,
    [
      penned(f, ring(roundOf(f, side), centre, halfW - side / 2, halfH - crown / 2), pen),
      ...spokes,
    ],
    true,
  );
}

// ---------------------------------------------------------------------------
// The signs
// ---------------------------------------------------------------------------

/**
 * The circumflex as Lora's: a wide roof 703 across from 439 up to a flat top
 * at 716, its arms 85 across level at the Regular and 134 at the Bold. The
 * construction's was a small caret on the letters' pen, half as wide.
 */
export function humanistAsciiCircum(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const wide = 703 * u;
  const level = byPen(style, 85, 134) * u;
  const foot = 439 * u;
  const top = 716 * u;
  const left = f.edge - f.half;
  const apex = at(left + wide / 2, top);
  const lean = Math.atan2(top - foot, wide / 2 - level / 2);
  const weight = level * Math.sin(lean);
  return finish(f, [
    signStroke(f, straight(at(left + level / 2, foot), apex), weight, LEVEL, LEVEL),
    signStroke(f, straight(apex, at(left + wide - level / 2, foot)), weight, LEVEL, LEVEL),
  ]);
}

/**
 * The tilde as Lora's: one wave 444 across, crest at 170 and trough at 368,
 * 75 apart about 302 up, heavier at its crest and trough than down its
 * middle as a broad nib held upright leaves it -- 68 deep at the Regular and
 * 123 at the Bold. The construction's was a pair of round humps hung 60
 * units lower, as heavy on the slope as at the crest.
 */
export function humanistAsciiTilde(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const deep = byPen(style, 68, 123) * u;
  const left = f.edge - f.half;
  const crest = at(left + 127 * u, 339 * u);
  const trough = at(left + 325 * u, 264 * u);
  const halfRun = (trough.x - crest.x) / 2;
  const halfDrop = (crest.y - trough.y) / 2;
  const theta = 2 * Math.atan2(halfDrop, halfRun);
  const radius = halfRun / Math.sin(theta);
  const deg = (theta * 180) / Math.PI;
  const up = at(crest.x, crest.y - radius);
  const down = at(trough.x, trough.y + radius);
  // Led in and out along the wave's own slope to the ends, cut upright.
  const ends = 28 * u;
  const slope = Math.tan(theta);
  const inFrom = pointOn(up, radius, 90 + deg);
  const outTo = pointOn(down, radius, 270 + deg);
  const pen: Pen = { weight: deep, contrast: 0.45, angle: 90 };
  const cut: Terminal = { kind: "butt", aligned: true };
  return finish(f, [
    penned(
      f,
      chain(
        straight(at(inFrom.x - ends, inFrom.y - ends * slope), inFrom),
        turn(up, radius, 90 + deg, 90 - deg),
        turn(down, radius, 270 - deg, 270 + deg),
        straight(outTo, at(outTo.x + ends, outTo.y + ends * slope)),
      ),
      pen,
      cut,
      cut,
    ),
  ]);
}

/**
 * The not sign as Lora's: a bar 446 long, 62 deep at the Regular and 98 at
 * the Bold, about 313 up, and a drop 52 and 88 across at its right end down
 * to 157 and 149. The construction's was the letters' pen, turned at a
 * rounded corner, and a hundred units shorter.
 */
export function humanistLogicalNot(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const bar = byPen(style, 62, 98) * u;
  const drop = byPen(style, 52, 88) * u;
  const long = bySize(style, 446, 450) * u + Math.max(0, bar - 98 * u);
  const y = 313 * u;
  const left = f.edge - f.half;
  const x = left + long - drop / 2;
  const foot = bySize(style, 157, 149) * u;
  return finish(f, [
    signStroke(f, straight(at(left, y), at(left + long, y)), bar),
    signStroke(f, straight(at(x, foot), at(x, y + bar / 2)), drop),
  ]);
}

/**
 * The plus-minus as Lora's: the plus -- 446 across, its bars 50 deep at the
 * Regular and 78 at the Bold -- standing with its bar at 365 and its upright
 * from 137 to 583, over a rule of the same length and weight on the line.
 * The construction's was smaller all round, the rule 23 units up.
 */
export function humanistPlusMinus(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const bar = byPen(style, 50, 78) * u;
  const long = 446 * u + Math.max(0, bar - 78 * u);
  const left = f.edge - f.half;
  const x = left + long / 2;
  const y = 365 * u;
  const rule = Math.min(byPen(style, 25, 20) * u, 25 * u);
  // Past the Bold the upright stands clear of the rule by at least half a bar.
  const low = Math.max(137 * u, rule + bar * 1.1);
  return finish(f, [
    signStroke(f, straight(at(left, y), at(left + long, y)), bar),
    signStroke(f, straight(at(x, low), at(x, 583 * u)), bar),
    signStroke(f, straight(at(left, rule), at(left + long, rule)), bar),
  ]);
}

// ---------------------------------------------------------------------------
// The guillemets
// ---------------------------------------------------------------------------

/**
 * One of Lora's chevrons, pointing left (`facing` -1) or right (1), its tip at
 * `tip` and its two arms reaching `reach` across and `rise` up and down to
 * their ends. Heavy at the point and light at the ends: `tipWide` across the
 * point, level, and `endWide` across each end, square.
 */
function loraChevron(
  f: Framed,
  facing: 1 | -1,
  tip: Vec2,
  reach: number,
  rise: number,
  tipWide: number,
  endWide: number,
): Stroke[] {
  // The arms leave the point from the middle of its level cut.
  const lean = Math.atan2(rise, reach);
  const from = at(tip.x - facing * (tipWide / 2), tip.y);
  const across = tipWide * Math.sin(lean);
  return [1, -1].flatMap((side) =>
    tapered(
      f,
      from,
      at(from.x - facing * reach, tip.y + side * rise),
      across,
      endWide,
      at(1, 0),
      LEVEL,
      BUTT,
    ),
  );
}

/** Lora's single chevron's measures at this weight: see `humanistGuilsingl`. */
function singleChevron(style: Style, u: number) {
  return {
    reach: byPen(style, 233, 225.5) * u,
    rise: byPen(style, 256, 251.5) * u,
    tipWide: byPen(style, 108, 144) * u,
    endWide: byPen(style, 45, 79) * u,
    y: 276 * u,
  };
}

/**
 * The single guillemets as Lora's: a chevron as tall as the x-height and a
 * half, from under the line to 549, 305 across at the Regular, heavy at the
 * point -- 108 across it level -- and light at the ends, 45 across. The
 * construction's were an even pen a third smaller, over the middle of the
 * lowercase.
 */
function humanistGuilsingl(style: Style, facing: 1 | -1): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const c = singleChevron(style, u);
  const left = f.edge - f.half;
  const width = c.reach + c.tipWide / 2 + c.endWide * 0.7;
  const tip = at(facing === -1 ? left : left + width, c.y);
  return finish(f, loraChevron(f, facing, tip, c.reach, c.rise, c.tipWide, c.endWide));
}

export const humanistGuilsinglLeft = (style: Style): Recipe => humanistGuilsingl(style, -1);
export const humanistGuilsinglRight = (style: Style): Recipe => humanistGuilsingl(style, 1);

/**
 * The double guillemets as Lora's: the single chevron, a little lighter at
 * the point, and a second one inside it seven tenths its size, its point 213
 * further on at the Regular and 220 at the Bold.
 */
function humanistGuillemot(style: Style, facing: 1 | -1): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const c = singleChevron(style, u);
  const tipWide = byPen(style, 108, 125) * u;
  const endWide = byPen(style, 45, 64) * u;
  const step = byPen(style, 213, 220) * u + Math.max(0, tipWide - 125 * u) * 0.8;
  const small = { reach: c.reach * byPen(style, 0.676, 0.59), rise: c.rise * 0.7 };
  const left = f.edge - f.half;
  const outer = c.reach + tipWide / 2 + endWide * 0.7;
  const width = Math.max(outer, step + small.reach + tipWide / 2 + endWide * 0.7);
  const first = at(facing === -1 ? left : left + width, c.y);
  const second = at(first.x - facing * step, c.y);
  return finish(f, [
    ...loraChevron(f, facing, first, c.reach, c.rise, tipWide, endWide),
    ...loraChevron(f, facing, second, small.reach, small.rise, tipWide, endWide),
  ]);
}

export const humanistGuillemotLeft = (style: Style): Recipe => humanistGuillemot(style, -1);
export const humanistGuillemotRight = (style: Style): Recipe => humanistGuillemot(style, 1);

// ---------------------------------------------------------------------------
// The full stop and what is made of it
// ---------------------------------------------------------------------------

/**
 * Where a colon's upper dot stands: its foot 387 up at every weight, as
 * Lora's is, a little under the x-height, so a heavier dot rises over it.
 */
function upperFoot(f: Framed): number {
  return (387 + DIP) * loraUnit(f);
}

/** The full stop as Lora's: see `loraDot`. */
export function humanistPeriod(style: Style): Recipe {
  const f = frame(style);
  // Not finished: a round end on a run this short is not pulled back.
  return { strokes: [loraDot(f, f.edge, 0)] };
}

/** The colon as Lora's: two of its full stops, the upper one's foot a little under the x-height. */
export function humanistColon(style: Style): Recipe {
  const f = frame(style);
  return { strokes: [loraDot(f, f.edge, 0), loraDot(f, f.edge, upperFoot(f))] };
}

/**
 * Lora's comma: a round head the full stop's size, dipping under the line as
 * the full stop does, and a tail leaving it down its right side and curling
 * down and to the left to a blunt point 179 under the line at the Regular and
 * 187 at the Bold. Drawn with a broad nib held nearly level, so the tail thins
 * as it turns: 55 across where it leaves the head and 33 at its point at the
 * Regular, 69 and 48 at the Bold.
 */
function loraComma(f: Framed, x: number): Stroke[] {
  const u = loraUnit(f);
  const radius = stopRadius(f);
  // The Bold's head stands a little higher than its full stop, 8 units.
  const head = at(x, radius + (bySize(f.style, 0, 8) - DIP) * u);
  const nib = byPen(f.style, 59, 73) * u;
  const contrast = Math.min(0.9, Math.max(0.3, byPen(f.style, 0.5, 0.9)));
  const angle = Math.min(40, Math.max(-10, byPen(f.style, 21, 7)));
  // Leaving the head's upper right heading straight down, and turning on one
  // arc to the point: the arc is whatever circle runs through both.
  const start = at(head.x + byPen(f.style, 41, 55.5) * u, head.y - byPen(f.style, 12.5, 24.5) * u);
  const tip = at(head.x - byPen(f.style, 19.5, 20) * u, -bySize(f.style, 169, 183) * u);
  const heading = (268 * Math.PI) / 180;
  const n = at(Math.cos(heading - Math.PI / 2), Math.sin(heading - Math.PI / 2));
  const d = at(tip.x - start.x, tip.y - start.y);
  const R = (d.x * d.x + d.y * d.y) / (2 * (d.x * n.x + d.y * n.y));
  const centre = at(start.x + R * n.x, start.y + R * n.y);
  const angleOf = (p: Vec2): number => (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI;
  let from = angleOf(start);
  let to = angleOf(tip);
  if (to > from) to -= 360;
  if (from - to > 180) from -= 360;
  const arc = turn(centre, R, from, to);
  return [
    disc(head, radius, f.style),
    {
      spine: { ...arc, segments: arc.segments.map((one) => ({ ...one, pieces: 2 })) },
      pen: { weight: nib, contrast, angle },
      start: BUTT,
      end: BUTT,
    },
  ];
}

/** The comma as Lora's: see `loraComma`. The quotes are this, raised and turned. */
export function humanistComma(style: Style): Recipe {
  const f = frame(style);
  return finish(f, loraComma(f, f.edge));
}

/** The semicolon as Lora's: its comma under the colon's upper dot. */
export function humanistSemicolon(style: Style): Recipe {
  const f = frame(style);
  return {
    strokes: [...finish(f, loraComma(f, f.edge)).strokes, loraDot(f, f.edge, upperFoot(f))],
  };
}

// ---------------------------------------------------------------------------
// The bars
// ---------------------------------------------------------------------------

/**
 * How wide Lora's upright bar is: 75 at the Regular and 138 at the Bold, and
 * never much lighter than the stem, or a Light's was a hairline.
 */
function barWide(style: Style, regular: number, bold: number): number {
  return Math.max(byPen(style, regular, bold), style.pen.weight * 0.75);
}

/**
 * The vertical bar as Lora's: from 271 under the line to 760, 75 across at
 * the Regular and 138 at the Bold. The construction's was the stem, from the
 * descender to the ascender, and stood a little short at both ends.
 */
export function humanistBar(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const wide = barWide(style, 75, 138) * u;
  const x = f.edge - f.half + wide / 2;
  return finish(f, [
    signStroke(f, straight(at(x, f.desc - f.over), at(x, f.asc + f.over * 0.3)), wide),
  ]);
}

/**
 * The broken bar as Lora's: the bar, 75 across at the Regular and 113 at the
 * Bold, broken from 101 to 385 up at the Regular and 113 to 375 at the Bold.
 * The construction's broke a gap half the size, lower down.
 */
export function humanistBrokenBar(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const wide = barWide(style, 75, 113) * u;
  const x = f.edge - f.half + wide / 2;
  const low = bySize(style, 101, 113) * u;
  const high = bySize(style, 385, 375) * u;
  return finish(f, [
    signStroke(f, straight(at(x, f.desc - f.over), at(x, low)), wide),
    signStroke(f, straight(at(x, high), at(x, f.asc + f.over * 0.3)), wide),
  ]);
}

// ---------------------------------------------------------------------------
// The enclosed letters
// ---------------------------------------------------------------------------

/**
 * A ring's side, lighter under a Regular than Lora's measures run on to: a
 * ring 63 across round a Light's hairline letter was a black hoop.
 */
function ringSide(style: Style, regular: number, bold: number): number {
  return byPen(style, regular, bold) - Math.max(0, 87 - style.pen.weight) * 0.4;
}

/**
 * The copyright and registered signs as Lora's: a ring as wide as a capital
 * O and taller than one, 791 by 800 about 350 up at the Regular and 823 by
 * 826 at the Bold, its sides 67 and 71 and its crown and foot 50 and 58; and
 * the letter inside it set seven tenths of a capital, on nearly the letters'
 * pen, `shift` off the ring's middle. The construction's ring was 70 units
 * smaller and on the letters' own pen, and its letter half the size.
 */
function loraEnclosed(
  style: Style,
  name: "C" | "R",
  share: number,
  penShare: number,
  shift: Vec2,
  wide = 1,
  dressed = false,
): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const side = ringSide(style, 67, 71) * u;
  const crown = ringSide(style, 50, 58) * u;
  const halfW = bySize(style, 395.5, 411.5, 0.3) * u;
  const halfH = bySize(style, 400, 413, 0.3) * u;
  const centre = at(f.edge - f.half + halfW, bySize(style, 350, 342) * u);
  const pen: Pen = { weight: side, contrast: Math.min(0.5, 1 - crown / side), angle: 0 };
  const little = sized(f.style, share, penShare);
  const set = { ...little, metrics: { ...little.metrics, width: little.metrics.width * wide } };
  const drawn = setInside(() => recipeOf(name, borrowing)!(set).strokes);
  const letter = dressed ? dressedAs(drawn, name, set) : drawn;
  const box = spread(letter);
  return {
    strokes: [
      ...finish(f, [
        penned(f, ring(roundOf(f, side), centre, halfW - side / 2, halfH - crown / 2), pen),
      ]).strokes,
      ...letter.map((stroke) =>
        shovedStroke(
          stroke,
          centre.x + shift.x * u - (box.xMin + box.xMax) / 2,
          centre.y + shift.y * u - (box.yMin + box.yMax) / 2,
        ),
      ),
    ],
    round: true,
  };
}

/** The copyright sign as Lora's: see `loraEnclosed`. */
export function humanistCopyright(style: Style): Recipe {
  return loraEnclosed(style, "C", 0.69, 0.92, at(-15, 0));
}

/**
 * The registered sign as Lora's: see `loraEnclosed`. Its R is Lora's, wider
 * than the Serif's set small (1.18) and finished as an R with its serifs
 * (see `dressedAs`), 0.61 of a capital on 0.875 of the pen at the Regular and
 * 0.49 at the Bold, held there past it, and it stands 58 right of the ring's
 * middle and 28 up. The R the sign drew before stood about 40 units left of
 * Lora's and wore no serifs.
 */
export function humanistRegistered(style: Style): Recipe {
  return loraEnclosed(style, "R", 0.61, bySize(style, 0.875, 0.49), at(58, 28), 1.18, true);
}

// ---------------------------------------------------------------------------
// The trade mark
// ---------------------------------------------------------------------------

/**
 * A letter of this face set small with its own width and pen, its foot on
 * `foot` and its ink from `left`.
 */
function smallLetter(
  style: Style,
  name: "T" | "M",
  share: number,
  penShare: number,
  wide: number,
  left: number,
  foot: number,
): Stroke[] {
  const little = sized(style, share, penShare);
  const set = { ...little, metrics: { ...little.metrics, width: little.metrics.width * wide } };
  const drawn = setInside(() => recipeOf(name, style.forms?.[name])!(set).strokes);
  // With the serifs a T and an M wear: see `dressedAs`.
  const strokes = dressedAs(drawn, name, set);
  const box = spread(strokes);
  return strokes.map((stroke) => shovedStroke(stroke, left - box.xMin, foot));
}

/**
 * The trade mark as Lora's: its own T and M hung from the cap line, 401 tall,
 * and wider and heavier than the letters set that small would be -- the T 370
 * across and the M 555, their stems 72 at the Regular and 103 at the Bold --
 * with 17 between them. The construction's were narrower by a third and its
 * M was hardly wider than its T.
 *
 * And serifed, as Lora's are: finished as a symbol's strokes, the two had
 * none and read as a sans's. With their serifs on, the M is drawn 1.33 of
 * its width set small rather than 1.54 and the T 1.06, on 0.93 of the pen at
 * the Regular, and the M is set 32 units past the T's pen rather than 17, so
 * the serifs between them stand apart.
 */
export function humanistTrademark(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const share = bySize(style, 401, 413) / 700;
  const pen = Math.min(1, Math.max(0.6, byPen(style, 0.93, 0.73)));
  const foot = f.cap * (1 - share);
  const left = f.edge - f.half;
  const t = smallLetter(f.style, "T", share, pen, 1.06, left, foot);
  const m = smallLetter(f.style, "M", share, pen, 1.33, spread(t).xMax + 32 * u, foot);
  return { strokes: [...t, ...m] };
}

// ---------------------------------------------------------------------------
// The section and the pilcrow
// ---------------------------------------------------------------------------

/** How tall each of the section mark's two s's is, in Lora's units. */
const SECTION_S = 670;

/**
 * The section mark as Lora's: two tall s's, the upper one hung from 760 and
 * the lower one standing 228 under the line, so they share the middle; 458
 * across at the Regular, the upper one set 46 to the right of the lower.
 * The construction's were two small s's inside the cap height, 330 across.
 *
 * Drawn to Lora's ink rather than to those measures: each s 670 high, the
 * upper set 38.5 right of the lower, their sides 81.5 at the Regular and 123
 * at the Bold, and at the Bold 0.86 of their Regular width -- 700 high on
 * sides of 80 and 115 stood off Lora's by 0.38 at the Regular and 0.30 at the
 * Bold.
 */
export function humanistSection(style: Style): Recipe {
  const f0 = frame(style);
  const u = loraUnit(f0);
  const weight = Math.min(byPen(style, 81.5, 123) * u, SECTION_S * u * 0.24);
  const held = {
    ...style,
    pen: { ...style.pen, weight },
    metrics: {
      ...style.metrics,
      width: style.metrics.width * SECTION_WIDE * bySize(style, 1, 0.86),
    },
  };
  const f = frame(held);
  const height = SECTION_S * u;
  const one = (): Stroke => finish(f, [spine(f, height, f.edge, false).stroke]).strokes[0];
  const upper = one();
  const lower = one();
  const box = contoursBounds(sweep(upper));
  const left = f0.edge - f0.half;
  const over = SECTION_OVER * u;
  return {
    strokes: [
      shovedStroke(upper, left + over - box.xMin, 760 * u - box.yMax),
      shovedStroke(lower, left - box.xMin, -228 * u - box.yMin),
    ],
    round: true,
  };
}

/** How much wider than the face's s the section mark's are drawn. */
const SECTION_WIDE = 0.9;

/** How far right of the lower s the upper one stands, in Lora's units. */
const SECTION_OVER = 38.5;

/**
 * The pilcrow as Lora's: a solid bowl 291 tall hung from the cap line, from
 * the ink's left to the first of two stems that run from 255 under the line
 * to the cap line, joined across the top. The stems are 70 and 72 across at
 * the Regular and 112 and 113 at the Bold, 159 apart at the Regular and 207
 * at the Bold, and the bar across their heads 44 and 70 deep. The
 * construction's stood on round-ended stems a hundred units short of the
 * descender, with no bar, and was a third wider.
 */
export function humanistParagraph(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const left = f.edge - f.half;
  const first = byPen(style, 70, 112) * u;
  const second = byPen(style, 72, 113) * u;
  const a = left + byPen(style, 174, 181) * u;
  const b = left + byPen(style, 333, 387.5) * u;
  const bar = byPen(style, 44, 70) * u;
  const top = 700 * u;
  const foot = f.desc;
  const thick = bySize(style, 291, 299) * u;
  const middle = top - thick / 2;
  const round: Terminal = { kind: "round" };
  // The bowl not finished: its round end is its whole left side, and pulled
  // back by its own radius it ran into the stem.
  const bowl: Stroke = {
    spine: straight(at(left + thick / 2, middle), at(a, middle)),
    pen: { ...f.style.pen, contrast: 0, angle: 0, weight: thick },
    start: round,
    end: BUTT,
  };
  return {
    strokes: [
      bowl,
      ...finish(f, [
        signStroke(f, straight(at(a, foot), at(a, top)), first),
        signStroke(f, straight(at(b, foot), at(b, top)), second),
        signStroke(f, straight(at(a, top - bar / 2), at(b, top - bar / 2)), bar),
      ]).strokes,
    ],
  };
}

// ---------------------------------------------------------------------------
// The pound
// ---------------------------------------------------------------------------

/**
 * The pound as Lora's: a hook over the cap height ending in a drop, a stem
 * leaning a little right as it falls, a bar across it 312 to 360 up, and a
 * foot that is a heavy wave -- up out of the stem's foot, down under the bar's
 * end and up again to 124 at the right. The construction's was an L turned
 * round, a flat foot along the line and a bar 30 units lower.
 */
export function humanistSterling(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const left = f.edge - f.half;
  const X = (x: number): number => left + (x - 47) * u;
  const stem = byPen(style, 84, 129) * u;
  const pen: Pen = { ...f.style.pen, weight: stem };
  // The hook: from the drop on the right, over the top and down the left.
  const r = bySize(style, 132, 128) * u;
  const hookAt = at(X(byPen(style, 287, 300)), 716 * u - r - stem * 0.225);
  const hook = turn(hookAt, r, 10, 180);
  const low = at(X(byPen(style, 192, 205)), 150 * u);
  const hookRun = chain(hook, straight(at(hookAt.x - r, hookAt.y), low));
  // The foot: a wave from under the stem to the right.
  const deep = byPen(style, 80, 117) * u;
  const footFrom = at(X(80), 38 * u);
  const crest = at(X(232), 93 * u);
  const trough = at(X(byPen(style, 432, 445)), 23 * u);
  const footTo = at(X(byPen(style, 504, 516)), 105 * u);
  const bar = byPen(style, 48, 77) * u;
  const cut: Terminal = { kind: "butt", aligned: true };
  return finish(f, [
    penned(f, hookRun, pen, f.end, BUTT),
    penned(
      f,
      levelWave(footFrom, crest, trough, footTo),
      { weight: deep, contrast: 0.45, angle: 90 },
      { kind: "round" },
      cut,
    ),
    signStroke(f, straight(at(X(63), 336 * u), at(X(byPen(style, 366, 408)), 336 * u)), bar),
  ]);
}

/**
 * A wave through four points, level at the second and the third: up over a
 * crest at `crest`, down through an S to a trough at `trough`, and up again
 * to `end`, each turn a circle meeting the next along the same heading so the
 * run has no corner in it.
 */
function levelWave(from: Vec2, crest: Vec2, trough: Vec2, end: Vec2): Spine {
  const deg = (radians: number): number => (radians * 180) / Math.PI;
  // Up to the crest: a circle under it, level there, through `from`.
  const dx0 = from.x - crest.x;
  const dy0 = crest.y - from.y;
  const r0 = (dx0 * dx0 + dy0 * dy0) / (2 * dy0);
  const c0 = at(crest.x, crest.y - r0);
  const a0 = deg(Math.atan2(from.y - c0.y, from.x - c0.x));
  // Down to the trough: two equal circles meeting half-way.
  const halfRun = (trough.x - crest.x) / 2;
  const halfDrop = (crest.y - trough.y) / 2;
  const theta = 2 * Math.atan2(halfDrop, halfRun);
  const r1 = halfRun / Math.sin(theta);
  const t = deg(theta);
  // Up to the end: a circle over the trough, level there, through `end`.
  const dx2 = end.x - trough.x;
  const dy2 = end.y - trough.y;
  const r2 = (dx2 * dx2 + dy2 * dy2) / (2 * dy2);
  const c2 = at(trough.x, trough.y + r2);
  let a2 = deg(Math.atan2(end.y - c2.y, end.x - c2.x));
  while (a2 < 270) a2 += 360;
  return chain(
    turn(c0, r0, a0, 90),
    turn(at(crest.x, crest.y - r1), r1, 90, 90 - t),
    turn(at(trough.x, trough.y + r1), r1, 270 - t, 270),
    turn(c2, r2, 270, a2),
  );
}

/**
 * The symbols drawn out of a letter follow that letter's form on every face
 * (see `outOf`), so these are drawn to Lora's only on a text serif: another
 * face with a humanist S -- the Didone's -- keeps its own dollar.
 */
function onTextSerif(
  name: "cent" | "dollar" | "Euro" | "ordfeminine" | "ordmasculine",
  style: Style,
  build: () => Recipe,
): Recipe {
  return textSerif(frame(style)) ? build() : LETTERS[name](style);
}

// ---------------------------------------------------------------------------
// The cent and the dollar
// ---------------------------------------------------------------------------

/** Where a run of strokes really puts its ink. */
function inkBox(strokes: Stroke[]) {
  return contoursBounds(strokes.flatMap((stroke) => sweep(stroke)));
}

/**
 * A letter with a stub standing out of its top and another out of its foot,
 * `wide` across and `shift` right of the letter's middle, reaching `under`
 * below the line and `over` above it -- which is how Lora crosses its cent
 * and its dollar: the bar does not run through the counters.
 */
function stubbed(
  f: Framed,
  letter: Stroke[],
  wide: number,
  shift: number,
  under: number,
  over: number,
): Recipe {
  const box = inkBox(letter);
  const x = (box.xMin + box.xMax) / 2 + shift;
  const into = (box.yMax - box.yMin) * 0.06;
  return {
    strokes: [
      ...letter,
      ...finish(f, [
        signStroke(f, straight(at(x, -under), at(x, box.yMin + into)), wide),
        signStroke(f, straight(at(x, box.yMax - into), at(x, over)), wide),
      ]).strokes,
    ],
    round: true,
  };
}

/**
 * The cent as Lora's: its c, with a stub 66 across at the Regular and 91 at
 * the Bold standing 134 under the line and 622 over it, a little right of the
 * c's middle. The construction's ran a bar the dollar's weight through the
 * c's counter from top to bottom.
 */
export function humanistCent(style: Style): Recipe {
  return onTextSerif("cent", style, () => loraCent(style));
}

function loraCent(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const c = recipeOf("c", borrowing)!(style).strokes;
  return stubbed(
    f,
    c,
    byPen(style, 66, 91) * u,
    bySize(style, 17.5, 14.5) * u,
    bySize(style, 134, 137) * u,
    bySize(style, 622, 626) * u,
  );
}

/**
 * The dollar as Lora's: its S a twentieth narrower, with a stub 54 across at
 * the Regular and 94 at the Bold standing 153 under the line and 833 over it.
 * The construction's ran a bar through the S from top to bottom, and stood
 * only 56 units out of either end.
 */
export function humanistDollar(style: Style): Recipe {
  return onTextSerif("dollar", style, () => loraDollar(style));
}

function loraDollar(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const narrow = { ...style, metrics: { ...style.metrics, width: style.metrics.width * 0.95 } };
  const s = recipeOf("S", borrowing)!(narrow).strokes;
  return stubbed(
    f,
    s,
    byPen(style, 54, 94) * u,
    bySize(style, -5, -1) * u,
    bySize(style, 153, 154) * u,
    // And shorter under a Regular, where the ascender's slack is less.
    (bySize(style, 833, 837) - Math.max(0, 87 - style.pen.weight) * 1.2) * u,
  );
}

// ---------------------------------------------------------------------------
// The ordinals
// ---------------------------------------------------------------------------

/**
 * An ordinal as Lora's: the letter set small with its top at 716, 0.632 of
 * the lowercase at the Regular and 0.66 at the Bold, on seven tenths of the
 * pen and `wide` of its own width. The construction's stood 6 units lower
 * and at the Bold its o was a hundred units too wide.
 */
function loraOrdinal(style: Style, name: "a" | "o", wide: number): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const share = bySize(style, 0.632, 0.66);
  const little = sized(style, share, 0.7);
  const set = { ...little, metrics: { ...little.metrics, width: little.metrics.width * wide } };
  const drawn = setInside(() => recipeOf(name, borrowing)!(set).strokes);
  // Finished as the letter it is: the a's head ends in its drop.
  const strokes = dressedAs(drawn, name, set);
  const box = inkBox(strokes);
  return {
    strokes: strokes.map((stroke) =>
      shovedStroke(stroke, f.edge - f.half - box.xMin, 716 * u - box.yMax),
    ),
  };
}

export function humanistOrdFeminine(style: Style): Recipe {
  return onTextSerif("ordfeminine", style, () =>
    loraOrdinal(style, "a", bySize(style, 1.003, 0.966, -0.00184)),
  );
}

export function humanistOrdMasculine(style: Style): Recipe {
  return onTextSerif("ordmasculine", style, () =>
    loraOrdinal(style, "o", bySize(style, 1.01, 0.738, -0.00099)),
  );
}

// ---------------------------------------------------------------------------
// The at sign
// ---------------------------------------------------------------------------

/**
 * The at sign as Lora's: an italic a whose stem runs down, curls out to the
 * right and up into the ring, and the ring carried on round over the top,
 * down the left and under the foot to an end cut square at the lower right --
 * one stroke from the a's head to the ring's end. The ring is 704 across and
 * 732 tall, from 95 under the line to 637, its sides about 70 and its crown
 * and foot 43; the a's bowl stands from 70 to 482 beside a stem leaning a
 * little back, and is 70 across its side at the Regular and 99 at the Bold,
 * where the ring hardly changes. The construction's was a ring on the
 * letters' pen round a small upright a, 0.71 off Lora's.
 */
export function humanistAtSign(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const left = f.edge - f.half;
  const X = (x: number): number => left + (x - 50) * u;
  const side = ringSide(style, 68, 72) * u;
  const crown = ringSide(style, 43, 45) * u;
  const pen: Pen = {
    weight: side,
    contrast: Math.min(0.6, Math.max(0, 1 - crown / side)),
    angle: 0,
  };
  // The ring, as the spine through the middle of Lora's.
  const grow = Math.max(0, byPen(style, 70, 99) - 99) * 0.5 * u;
  const halfW = 352 * u - side / 2 + grow;
  const halfH = 366 * u - crown / 2 + grow * 0.6;
  const centre = at(X(402) + grow, 271 * u);
  const ringRun = bend(roundOf(f, side), centre, halfH, -20, 315, halfW);
  // The a's stem, from its head down to where it turns into the tail that
  // meets the ring along the ring's own heading: the tail is the circle
  // tangent to both.
  const top = at(X(514) + grow * 0.6, 478 * u + grow * 0.3);
  const down = (266 * Math.PI) / 180;
  const into = headingAt(ringRun.segments[0], "start");
  const meet = spineStart(ringRun);
  const h0 = down;
  let h1 = Math.atan2(into.y, into.x);
  while (h1 < h0) h1 += Math.PI * 2;
  const turnBy = h1 - h0;
  const chordDir = (h0 + h1) / 2;
  const k = 2 * Math.sin(turnBy / 2);
  // meet - k r dir(chordDir) lies on the stem's line through `top`.
  const c = at(Math.cos(chordDir), Math.sin(chordDir));
  const d = at(Math.cos(down), Math.sin(down));
  // Solve top + t d = meet - k r c for t and r.
  const det = d.x * (k * c.y) - d.y * (k * c.x);
  const rx = meet.x - top.x;
  const ry = meet.y - top.y;
  const t = (rx * (k * c.y) - ry * (k * c.x)) / det;
  const r = (d.x * ry - d.y * rx) / det;
  const foot = at(top.x + t * d.x, top.y + t * d.y);
  const tailAt = at(foot.x - r * d.y, foot.y + r * d.x);
  const fromDeg = (Math.atan2(foot.y - tailAt.y, foot.x - tailAt.x) * 180) / Math.PI;
  const toDeg = fromDeg + (turnBy * 180) / Math.PI;
  const tail = turn(tailAt, r, fromDeg, toDeg);
  const main = penned(
    f,
    chain(
      straight(top, foot),
      { ...tail, segments: tail.segments.map((one) => ({ ...one, pieces: 3 })) },
      ringRun,
    ),
    pen,
    LEVEL,
    BUTT,
  );
  // The a's bowl, against the stem.
  const outerRight = top.x + side * 0.1;
  const outerLeft = X(219) - grow * 0.2;
  // Never more than half the bowl's width, or it has no counter to go round.
  const bowlSide = Math.min(byPen(style, 70, 99) * u, (outerRight - outerLeft) * 0.36);
  const bowlPen: Pen = { weight: bowlSide, contrast: 0.55, angle: 8 };
  const bowlCentre = at((outerLeft + outerRight) / 2, 266 * u);
  const bowlW = (outerRight - outerLeft) / 2 - bowlSide / 2;
  const bowlH = 188 * u - bowlSide * 0.225;
  return finish(
    f,
    [main, penned(f, ring(roundOf(f, bowlSide), bowlCentre, bowlW, bowlH), bowlPen)],
    true,
  );
}

// ---------------------------------------------------------------------------
// The daggers and the asterisk
// ---------------------------------------------------------------------------

/**
 * A petal: a run from `from` to `to`, `wideFrom` across at its start and
 * `wideTo` at its end, finished at its end in a round head as wide as it is.
 */
function petal(f: Framed, from: Vec2, to: Vec2, wideFrom: number, wideTo: number): Stroke[] {
  // Drawn from its wider end, cut square there.
  const w = Math.max(wideFrom, wideTo);
  const narrow = Math.min(wideFrom, wideTo);
  const [a, b] = wideFrom >= wideTo ? [from, to] : [to, from];
  const across = at(-(b.y - a.y), b.x - a.x);
  const run = Math.hypot(across.x, across.y) || 1;
  return [
    ...tapered(f, a, b, w, narrow, at(across.x / run, across.y / run), BUTT, BUTT),
    disc(to, wideTo / 2, f.style),
  ];
}

/** A width of Lora's dagger at this weight, never under a share of the pen. */
function daggerWide(style: Style, regular: number, bold: number): number {
  return Math.max(byPen(style, regular, bold), style.pen.weight * 0.5, 12);
}

/**
 * A run narrowing from `wide` across at `from` to `narrow` across at `to`,
 * cut flat at both ends along the line it stops on, drawn as one clean
 * wedge: two strokes `narrow` across whose outer edges are its sides, meeting
 * at `to`, and one down the middle filling the gap they leave near `from`.
 * The same three strokes at every weight, so the points do not change along
 * the axis.
 *
 * Lora's limbs are each one wedge. Drawn as a run of shorter tapers meeting
 * end to end, each half a stroke leaning its own way, the dagger pinched at
 * every joint, and the fault scan found the little counters there.
 */
function wedge(f: Framed, from: Vec2, to: Vec2, wide: number, narrow: number): Stroke[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const d = at((to.x - from.x) / length, (to.y - from.y) / length);
  const n = at(-d.y, d.x);
  // The edges must cover the middle at the wide end with the filling between
  // them, so the narrow end is never under about a quarter of the wide.
  const thin = Math.max(narrow, wide / 3.6);
  const cut: Terminal = { kind: "butt", aligned: true };
  const edge = (side: 1 | -1): Stroke => {
    const off = (wide - thin) / 2;
    const a = at(from.x + side * off * n.x, from.y + side * off * n.y);
    const lean = Math.atan2(off, length);
    return signStroke(f, straight(a, to), thin * Math.cos(lean), cut, cut);
  };
  /*
   * The filling: from the wide end down the middle to where the gap between
   * the edges has closed, and no further than where it would stand out past
   * them -- halfway between the two.
   */
  const fill = Math.max(wide - 2 * thin, 0) + thin * 0.1;
  const closes = Math.max(0, (wide - 2 * thin) / (wide - thin));
  const proud = (2 * thin - thin * 0.1) / Math.max(wide - thin, 1e-6);
  const s = Math.min(Math.max((closes + Math.min(proud, 1)) / 2, 0.1), 0.9);
  const middle = signStroke(
    f,
    straight(from, at(from.x + d.x * length * s, from.y + d.y * length * s)),
    fill,
    cut,
    BUTT,
  );
  return [edge(-1), edge(1), middle];
}

/**
 * The upper half of Lora's dagger over its cross at `cross`: a head flaring
 * out to a flat top at 760, and the two arms flaring out from the cross to
 * flat ends 230 either side, each one wedge. `down` turns it over for the
 * lower half of the double dagger.
 */
function daggerHead(f: Framed, x: number, cross: number, down: 1 | -1): Stroke[] {
  const u = loraUnit(f);
  const style = f.style;
  const head = daggerWide(style, 90, 130) * u;
  const neck = daggerWide(style, 57, 90) * u;
  const end = daggerWide(style, 72, 114) * u;
  const arm = daggerWide(style, 36, 60) * u;
  const reach = Math.max(230 * u, end * 1.1);
  const top = cross + down * (bySize(style, 760, 754) - 453) * u;
  return [
    ...wedge(f, at(x, top), at(x, cross), head, neck),
    ...wedge(f, at(x - reach, cross), at(x, cross), end, arm),
    ...wedge(f, at(x + reach, cross), at(x, cross), end, arm),
  ];
}

/**
 * The dagger as Lora's: from 271 under the line to 760, a head flaring to a
 * flat top, arms flaring to flat ends 460 across at 453, and a stem as wide
 * as Lora's swell under the cross, narrowing in one run to a flat point 28
 * across at the Regular and 62 at the Bold.
 *
 * It was a ball on every end and a stem in three tapers, which pinched where
 * they met; at a black weight the balls ran together into a blob, and Lora's
 * ends are cut, not balled.
 */
export function humanistDagger(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const x = f.edge - f.half + 230 * u;
  const cross = 453 * u;
  const swell = daggerWide(style, 100, 140) * u;
  const point = daggerWide(style, 28, 62) * u;
  return finish(f, [
    ...daggerHead(f, x, cross, 1),
    ...wedge(f, at(x, cross), at(x, f.desc - f.over), swell, point),
  ]);
}

/**
 * The double dagger to go with it, which Lora does not draw: the dagger's
 * head and arms, and the same turned over under them, 489 apart, joined by
 * one straight stem as wide as the head's neck.
 */
export function humanistDaggerDbl(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const x = f.edge - f.half + 230 * u;
  const upper = 453 * u;
  // The lower head reaching the descender and an overshoot, as the dagger's point does.
  const lower = f.desc - f.over + (bySize(style, 760, 754) - 453) * u;
  const stem = daggerWide(style, 62, 96) * u;
  return finish(f, [
    ...daggerHead(f, x, upper, 1),
    ...daggerHead(f, x, lower, -1),
    signStroke(f, straight(at(x, upper), at(x, lower)), stem),
  ]);
}

/**
 * The asterisk as Lora's: five petals, each a round head narrowing in to the
 * middle at 470, the upper one reaching 716 and the whole 440 across. The
 * construction's were five even bars no heavier than a hairline's worth of
 * the stem.
 */
export function humanistAsterisk(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const middle = at(f.edge - f.half + 221 * u, 470 * u);
  const head = daggerWide(style, 75, 104) * u;
  const heart = daggerWide(style, 30, 50) * u;
  const ends: Array<[number, number]> = [
    [90, 209],
    [157, 192],
    [23, 192],
    [229, 180],
    [311, 180],
  ];
  return finish(
    f,
    ends.flatMap(([degrees, length]) =>
      petal(f, middle, pointOn(middle, length * u - (head - 75 * u) / 2, degrees), heart, head),
    ),
  );
}

// ---------------------------------------------------------------------------
// The euro
// ---------------------------------------------------------------------------

/**
 * The euro as Lora's: its C a little narrower, 92 in from the ink's left,
 * and two bars 60 deep at the Regular and 78 at the Bold reaching out past
 * its back to the ink's left and well into its counter -- the upper one
 * about 424 up and 515 long, the lower one about 279 up and 446 long. The
 * construction's bars were heavier, lower and stopped short of the middle.
 */
export function humanistEuro(style: Style): Recipe {
  return onTextSerif("Euro", style, () => loraEuro(style));
}

function loraEuro(style: Style): Recipe {
  const f = frame(style);
  const u = loraUnit(f);
  const narrow = { ...style, metrics: { ...style.metrics, width: style.metrics.width * 0.94 } };
  const c = setInside(() => recipeOf("C", borrowing)!(narrow).strokes);
  const box = inkBox(c);
  const left = f.edge - f.half;
  const into = bySize(style, 92, 90) * u + Math.max(0, style.pen.weight - 142) * 0.4 * u;
  const letter = c.map((stroke) => shovedStroke(stroke, left + into - box.xMin, 0));
  const deep = Math.min(byPen(style, 60, 78) * u, style.pen.weight * 0.8 + 10 * u);
  const bar = (y: number, long: number): Stroke =>
    signStroke(f, straight(at(left, y), at(left + long, y)), deep);
  return {
    strokes: [
      ...letter,
      ...finish(f, [
        bar(bySize(style, 424, 407) * u, bySize(style, 515, 556) * u),
        bar(bySize(style, 279, 271) * u, bySize(style, 446, 494) * u),
      ]).strokes,
    ],
    round: true,
  };
}
