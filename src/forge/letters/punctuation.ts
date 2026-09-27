/**
 * The punctuation and the symbols: everything a font needs that is not a letter or a figure.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from, moved
 * here unchanged so the recipes can be read a group at a time. Only that file
 * imports it; see it for what a recipe is and how the table is used.
 */

import { spineEnd } from "../shapes";
import { penReach, reachAlong } from "../sweep";
import type { Style } from "../style";
import type { Vec2 } from "@/font/types";
import type { Spine, Stroke, Terminal } from "../types";
import {
  arm,
  at,
  axis,
  barHalf,
  bend,
  bendWidth,
  bent,
  bookish,
  brace,
  BUTT,
  chain,
  chevrons,
  deg,
  dot,
  enclosed,
  figureWidth,
  finish,
  fraction,
  type Frame,
  frame,
  ink,
  joined,
  LEVEL,
  type LetterName,
  ordinal,
  outOf,
  pointOn,
  type Recipe,
  ring,
  shortEnd,
  shovedStroke,
  signGap,
  signWidth,
  spine,
  spread,
  stopRadius,
  straight,
  superior,
  tail,
  tall,
  thin,
  turn,
  turnedDown,
} from "./common";

/** The hairline of a text face's marks: the thin of its own pen, with a floor. */
function hairline(f: Frame): number {
  const { weight, contrast } = f.style.pen;
  return Math.max(
    weight * (1 - Math.min(Math.max(contrast, 0), 0.9)) * 0.9,
    f.style.metrics.unitsPerEm * 0.012,
  );
}

/**
 * An upright wedge, wide at the top and narrow at the foot, cut level at both.
 *
 * Drawn as two leaning strokes side by side, each a parallelogram half the
 * width of the top: together their outer edges are the two sides of the
 * wedge, and between them there is no gap as long as the foot is at least half
 * as wide as the top, which it is held to.
 */
function wedge(
  f: Frame,
  x: number,
  top: number,
  bottom: number,
  topWide: number,
  footWide: number,
): Stroke[] {
  const a = topWide;
  const b = Math.max(footWide, a * 0.52);
  const w = a / 2;
  const h = Math.max(top - bottom, 1);
  return [-1, 1].map((side) => {
    const from = at(x + side * (a / 2 - w / 2), top);
    const to = at(x + side * (b / 2 - w / 2), bottom);
    const lean = Math.atan2(Math.abs(to.x - from.x), h);
    return {
      spine: straight(from, to),
      pen: { ...f.style.pen, contrast: 0, weight: w * Math.cos(lean) },
      start: LEVEL,
      end: LEVEL,
    };
  });
}

/** How wide a text face's straight quote is across its top: Lora's is 0.72 of its full stop. */
function quoteWidth(f: Frame): number {
  return stopRadius(f) * 1.44;
}

/** One straight quote: a wedge from the cap height down about a third of it. */
function quote(f: Frame, x: number): Stroke[] {
  const wide = quoteWidth(f);
  const depth = Math.max(f.cap * 0.31, wide * 1.7);
  return wedge(f, x, f.cap, f.cap - depth, wide, wide * 0.55);
}

/**
 * A text face's slash and backslash: from below the descender to the
 * ascender, as its parentheses are, leaning well over, and cut level at both
 * ends. Drawn from the cap height to six tenths of the descender it stood
 * shorter than the parentheses either side of it and nearly upright.
 */
function solidus(f: Frame, side: 1 | -1): Stroke {
  const foot = f.desc * 0.92;
  const head = f.asc;
  const lean = (head - foot) * 0.36;
  const from = at(side === 1 ? f.edge : f.edge + lean, foot);
  const to = at(side === 1 ? f.edge + lean : f.edge, head);
  return { ...ink(f, straight(from, to), LEVEL, LEVEL) };
}

/**
 * How far a bracket's arms reach from its upright. On a text face, past the
 * upright by at least most of a stem: at Black the arms were otherwise stubs
 * and the bracket read as a bar.
 */
function bracketReach(f: Frame): number {
  const w = f.arch * 0.52;
  return bookish(f) ? Math.max(w, f.half + f.arch * 0.36) : w;
}

/**
 * A comma's drop: a round head and a tail drawn down and to the left out of
 * its right side, thinning to a point.
 *
 * The tail is drawn with a broad nib held so that it is at its widest where
 * the tail leaves the head, travelling straight down, and at its thinnest
 * where the tail finishes, travelling down and away to the left -- which is
 * how a pen draws a comma, and what makes the tail taper without anything
 * having to be tapered. `centre` is the middle of the head.
 */
function drop(f: Frame, centre: Vec2, radius: number): Stroke[] {
  const reach = radius * 3.4;
  const bend = 42;
  const R = reach / Math.sin(deg(bend));
  const pen = { weight: radius * 2.55, contrast: 0.9, angle: 90 - bend + 8 };
  /*
   * The tail starts where the right corner of its first cut sits just inside
   * the head's right side, so its right edge leaves the head running straight
   * down, as a tangent to it: started further in, the head met the tail in a
   * notch, and further out the corner stood proud of the head as a spur. The
   * cut's other corner then lies inside the head as well.
   */
  const corner = reachAlong(at(1, 0), penReach(pen));
  const from = at(centre.x + radius * 0.96 - corner.x, centre.y + radius * 0.22 - corner.y);
  const pivot = at(from.x - R, from.y);
  const arc = turn(pivot, R, 0, -bend);
  return [
    dot(f, centre, radius),
    {
      spine: { ...arc, segments: arc.segments.map((one) => ({ ...one, pieces: 2 })) },
      pen,
      start: BUTT,
      end: BUTT,
    },
  ];
}

/**
 * A text face's parenthesis: a crescent from the ascender to below the
 * descender, as thick as a stem in the middle and a hairline at each end.
 *
 * A pen that does not change its width cannot draw one, and a broad nib thins
 * it far too little round a curve this shallow. So it is three runs that share
 * their tips: each leaves a tip along the same line, turns down onto the
 * upright and comes back to the other tip the same way. The outer one runs
 * straight a little way before it turns, which carries it further out; the
 * inner one turns on a tighter curve and stands upright for a stretch through
 * the middle, which keeps it further in; and the third lies between them. So
 * the three lie side by side through the middle and close up to one hairline
 * at the tips, which is what a crescent is -- with the difference shared
 * between a lead on the outside and a flat on the inside, neither is long
 * enough to see. Only the outer run reaches the tips; the others stop a unit
 * inside them, a hair narrower, so no two edges lie on top of each other.
 *
 * Each run is drawn with a broad nib held level, at its widest upright in the
 * middle and a little lighter at the leaning tips, and cut level there.
 *
 * `side` is 1 for the opening one and -1 for the closing one.
 */
function crescent(f: Frame, side: 1 | -1): Stroke[] {
  const t = hairline(f);
  const thick = Math.max(f.style.pen.weight * 0.84, t * 1.6);
  const tip = deg(42);
  const pen = { weight: 0, contrast: 0.9, angle: 0 };
  const nib = t / Math.hypot(Math.cos(tip), 0.1 * Math.sin(tip));
  const top = f.asc - t * 0.1;
  const bottom = f.desc + t * 0.1;
  const middle = (top + bottom) / 2;
  const d = at(-Math.sin(tip), -Math.cos(tip));
  // How far a run's middle stands out from its tip, for a lead of a given
  // length and a turn of a given share of the radius that would reach the
  // middle with no flat at all.
  const full = (lead: number): number => (top + lead * d.y - middle) / Math.sin(tip);
  const out = (lead: number, share: number): number =>
    -lead * d.x + full(lead) * share * (1 - Math.cos(tip));
  const apart = Math.max(thick - nib, nib * 0.2);
  // Half the difference from the outer run's lead, half from the inner's flat.
  const lead = apart / 2 / Math.tan(tip / 2);
  const share = 1 - apart / 2 / (full(0) * (1 - Math.cos(tip)));
  const runs = [
    { lead, share: 1 },
    { lead: lead / 2, share: (1 + share) / 2 },
    { lead: 0, share },
  ];
  const reach = out(lead, 1);
  // The tips stand at the right of the opening one and the left of the closing
  // one, far enough in that the crescent's outer side sits on the edge.
  const left = f.style.metrics.sidebearing;
  const tipX = side === 1 ? left + nib * 0.5 + reach : left + t * 0.5;
  const place = (p: Vec2): Vec2 => at(tipX + side * p.x, p.y);
  const turnsAt = 180 - (tip * 180) / Math.PI;
  const arc = (centre: Vec2, radius: number, from: number, to: number): Spine => {
    const drawn =
      side === 1
        ? turn(place(centre), radius, from, to)
        : turn(place(centre), radius, 180 - from, 180 - to);
    return { ...drawn, segments: drawn.segments.map((one) => ({ ...one, pieces: 2 })) };
  };
  return runs.map((run, index) => {
    const inset = index === 0 ? 0 : 1;
    const from = at(d.x * inset, top + d.y * inset);
    const high = at(d.x * (run.lead + inset), top + d.y * (run.lead + inset));
    const radius = full(run.lead + inset) * run.share;
    const centre = at(high.x + radius * Math.cos(tip), high.y - radius * Math.sin(tip));
    const upright = centre.x - radius;
    const low = (p: Vec2): Vec2 => at(p.x, 2 * middle - p.y);
    const pieces: Spine[] = [straight(place(from), place(high)), arc(centre, radius, turnsAt, 180)];
    if (index > 0) {
      pieces.push(
        straight(place(at(upright, centre.y)), place(at(upright, 2 * middle - centre.y))),
      );
    }
    pieces.push(
      arc(low(centre), radius, 180, 360 - turnsAt),
      straight(place(low(high)), place(low(from))),
    );
    return {
      spine: chain(...pieces),
      pen: { ...pen, weight: index === 0 ? nib : nib * 0.96 },
      start: BUTT,
      end: BUTT,
    };
  });
}

export const PUNCTUATION_RECIPES: Record<LetterName, (style: Style) => Recipe> = {
  // --- punctuation -------------------------------------------------------

  space: (style) => {
    const f = frame(style);
    return { strokes: [], width: f.arch * 1.1 };
  },

  period: (style) => {
    const f = frame(style);
    const radius = stopRadius(f);
    return finish(f, [dot(f, at(f.edge, radius), radius)]);
  },

  comma: (style) => {
    const f = frame(style);
    const radius = stopRadius(f);
    if (bookish(f)) return finish(f, drop(f, at(f.edge, radius), radius));
    return finish(f, [tail(f, radius)]);
  },

  colon: (style) => {
    const f = frame(style);
    const radius = stopRadius(f);
    return finish(f, [
      dot(f, at(f.edge, radius), radius),
      dot(f, at(f.edge, f.x - radius), radius),
    ]);
  },

  semicolon: (style) => {
    const f = frame(style);
    const radius = stopRadius(f);
    if (bookish(f)) {
      return finish(f, [
        ...drop(f, at(f.edge, radius), radius),
        dot(f, at(f.edge, f.x - radius), radius),
      ]);
    }
    return finish(f, [tail(f, radius), dot(f, at(f.edge, f.x - radius), radius)]);
  },

  exclam: (style) => {
    const f = frame(style);
    const radius = stopRadius(f);
    return finish(f, [
      ink(f, straight(at(f.edge, radius * 3), at(f.edge, f.cap)), f.end, f.end),
      dot(f, at(f.edge, radius), radius),
    ]);
  },

  question: (style) => {
    const f = frame(style);
    const radiusDot = stopRadius(f);
    // The neck stops clear of the dot under it, which at a black weight is
    // higher than three tenths of the cap height.
    const neck = Math.max(f.cap * 0.3, radiusDot * 2 + f.half * 0.9);
    /*
     * The hook and the neck are one run, the neck leaving the hook along its
     * own tangent, so there is no join to see.
     *
     * Drawn as two strokes butted together at a fixed point on the hook, they
     * met at whatever angle the neck happened to leave at, and at a black
     * weight -- where the neck has to stop high, clear of a big dot -- it left
     * nearly level and the join was a notch. So the hook is made no bigger than
     * leaves the neck room to leave it on a tangent, and where even that is
     * not enough the neck stops a little nearer the dot.
     */
    const crest = f.crest(f.cap);
    const radius = Math.max(Math.min(figureWidth(f) * 0.42, (crest - neck) / 2.2), f.least);
    const centre = at(f.edge + radius, crest - radius);
    // Past what the hook can give, the neck stops closer to the dot instead.
    const foot = at(centre.x, Math.min(neck, centre.y - radius * 1.15));
    const leaves = -90 + (Math.acos(radius / (centre.y - foot.y)) * 180) / Math.PI;
    /*
     * Always in three pieces, which is what a turn of two hundred and thirty
     * degrees or so takes anyway: pinned, so a hook that turns a little less
     * at some weight is still drawn with the points of the others.
     */
    const turned = turn(centre, radius, 190, leaves);
    const hook = {
      ...turned,
      segments: turned.segments.map((segment) =>
        segment.kind === "arc" ? { ...segment, pieces: 3 } : segment,
      ),
    };
    return finish(f, [
      ink(f, chain(hook, straight(pointOn(centre, radius, leaves), foot)), f.end, f.end),
      dot(f, at(foot.x, radiusDot), radiusDot),
    ]);
  },

  hyphen: (style) => {
    const f = frame(style);
    /*
     * A text face's hyphen is a short heavy bar a little above the middle of
     * the x-height: Lora's is two thirds of an x-height long and three
     * quarters of a stem thick. Drawn as a crossbar it was a hairline, since
     * a pen with contrast is at its thinnest going across.
     */
    if (bookish(f)) {
      const width = f.x * 0.62 + f.half * 0.4;
      const thick = Math.max(f.style.pen.weight * 0.74, hairline(f) * 1.5);
      const y = f.x * 0.6;
      const round: Terminal = { kind: "butt" };
      return finish(f, [
        {
          spine: straight(at(f.edge - f.half + (thick / 2) * 0, y), at(f.edge - f.half + width, y)),
          pen: { ...f.style.pen, contrast: 0, weight: thick },
          start: round,
          end: round,
        },
      ]);
    }
    const width = f.arch * 0.7;
    return finish(f, [
      thin(f, straight(at(f.edge, axis(f)), at(f.edge + width, axis(f))), f.plain, f.plain),
    ]);
  },

  parenleft: (style) => {
    const f = frame(style);
    if (bookish(f)) return finish(f, crescent(f, 1));
    const radius = Math.max(f.cap * 0.72, f.least);
    const centre = at(f.edge + radius, f.cap * 0.4);
    return finish(f, [ink(f, turn(centre, radius, 145, 215), f.end, f.end)]);
  },

  parenright: (style) => {
    const f = frame(style);
    if (bookish(f)) return finish(f, crescent(f, -1));
    const radius = Math.max(f.cap * 0.72, f.least);
    const centre = at(f.edge - radius + f.arch * 0.32, f.cap * 0.4);
    return finish(f, [ink(f, turn(centre, radius, 35, -35), f.end, f.end)]);
  },

  slash: (style) => {
    const f = frame(style);
    if (bookish(f)) return finish(f, [solidus(f, 1)]);
    const lean = f.arch * 0.75;
    return finish(f, [
      ink(f, straight(at(f.edge, f.desc * 0.6), at(f.edge + lean, f.cap)), f.plain, f.plain),
    ]);
  },

  quotesingle: (style) => {
    const f = frame(style);
    if (bookish(f)) return finish(f, quote(f, f.edge));
    return finish(f, [
      ink(f, straight(at(f.edge, f.cap * 0.72), at(f.edge, f.cap)), f.plain, f.plain),
    ]);
  },

  quotedbl: (style) => {
    const f = frame(style);
    if (bookish(f)) {
      const one = quoteWidth(f);
      return finish(f, [...quote(f, f.edge), ...quote(f, f.edge + one * 1.65)]);
    }
    const gap = f.style.pen.weight * 1.6;
    return finish(f, [
      ink(f, straight(at(f.edge, f.cap * 0.72), at(f.edge, f.cap)), f.plain, f.plain),
      ink(f, straight(at(f.edge + gap, f.cap * 0.72), at(f.edge + gap, f.cap)), f.plain, f.plain),
    ]);
  },

  // --- symbols -----------------------------------------------------------
  //
  // The rest of what a font needs, and the part that is usually a second
  // typeface hiding inside the first: symbols get drawn once, by hand, at one
  // weight, and then the letters move on without them. Everything below is
  // built out of the same pen and the same frame as the alphabet, so weight,
  // width, slant, corner rounding, squareness and the wave reach all of it --
  // and several of them are not drawn at all, but are a letter this font
  // already has, turned over or set small.

  /*
   * The arithmetic, on one line and at one width.
   *
   * A plus, a minus, an equals and a division sign that do not sit on the same
   * line do not read as arithmetic, and ones of different widths will not stack
   * into a column. Both are settled here rather than glyph by glyph: `axis` is
   * the height, and it is the height the hyphen already used, and the width
   * comes from the figures so a sum lines up under the numbers it is about.
   */

  plus: (style) => {
    const f = frame(style);
    const w = signWidth(f);
    const y = axis(f);
    const half = w / 2;
    return finish(f, [
      thin(f, straight(at(f.edge, y), at(f.edge + w, y)), f.plain, f.plain),
      thin(
        f,
        straight(at(f.edge + half, y - half), at(f.edge + half, y + half)),
        shortEnd(f),
        shortEnd(f),
      ),
    ]);
  },

  equal: (style) => {
    const f = frame(style);
    const w = signWidth(f);
    const gap = signGap(f);
    return finish(f, [
      thin(f, straight(at(f.edge, axis(f) - gap), at(f.edge + w, axis(f) - gap)), f.plain, f.plain),
      thin(f, straight(at(f.edge, axis(f) + gap), at(f.edge + w, axis(f) + gap)), f.plain, f.plain),
    ]);
  },

  multiply: (style) => {
    const f = frame(style);
    const w = signWidth(f) * 0.82;
    const y = axis(f);
    const half = w / 2;
    return finish(f, [
      thin(f, straight(at(f.edge, y - half), at(f.edge + w, y + half)), shortEnd(f), shortEnd(f)),
      thin(f, straight(at(f.edge, y + half), at(f.edge + w, y - half)), shortEnd(f), shortEnd(f)),
    ]);
  },

  /*
   * The two dots stand off the bar by their own daylight, not by a fraction of
   * the sign's width. Set at a fixed share of it, a heavy face put both dots
   * inside the bar and the whole mark came out as one thick plus.
   */
  divide: (style) => {
    const f = frame(style);
    const w = signWidth(f);
    const y = axis(f);
    const radius = f.half * 0.85;
    const reach = (f.style.pen.weight * f.bar) / 2 + signGap(f) * 0.85 + radius;
    return finish(f, [
      thin(f, straight(at(f.edge, y), at(f.edge + w, y)), f.plain, f.plain),
      dot(f, at(f.edge + w / 2, y + reach), radius),
      dot(f, at(f.edge + w / 2, y - reach), radius),
    ]);
  },

  /*
   * Set the two apart by their own bars rather than by half a pen.
   *
   * A plus over a rule is only a plus-or-minus if the two are read as separate
   * marks, and on a heavy face half a pen of daylight between them is none at
   * all: the two fuse into one block. The gap is a share of the bar drawing
   * them, which holds at every weight.
   */
  plusminus: (style) => {
    const f = frame(style);
    const w = signWidth(f);
    const bar = f.style.pen.weight * f.bar;
    const under = axis(f) - signWidth(f) * 0.5 - bar * 1.15;
    const y = axis(f) + bar * 0.35;
    const half = w / 2;
    return finish(f, [
      thin(f, straight(at(f.edge, y), at(f.edge + w, y)), f.plain, f.plain),
      thin(
        f,
        straight(at(f.edge + half, y - half * 0.86), at(f.edge + half, y + half * 0.86)),
        shortEnd(f),
        shortEnd(f),
      ),
      thin(f, straight(at(f.edge, under), at(f.edge + w, under)), f.plain, f.plain),
    ]);
  },

  less: (style) => {
    const f = frame(style);
    const w = signWidth(f) * 0.9;
    const y = axis(f);
    const rise = w * 0.78;
    return finish(f, [
      bent(
        f,
        chain(
          straight(at(f.edge + w, y + rise), at(f.edge, y)),
          straight(at(f.edge, y), at(f.edge + w, y - rise)),
        ),
      ),
    ]);
  },

  greater: (style) => {
    const f = frame(style);
    const w = signWidth(f) * 0.9;
    const y = axis(f);
    const rise = w * 0.78;
    return finish(f, [
      bent(
        f,
        chain(
          straight(at(f.edge, y + rise), at(f.edge + w, y)),
          straight(at(f.edge + w, y), at(f.edge, y - rise)),
        ),
      ),
    ]);
  },

  logicalnot: (style) => {
    const f = frame(style);
    const w = signWidth(f);
    const y = axis(f) + signWidth(f) * 0.32;
    return finish(f, [
      bent(
        f,
        chain(
          straight(at(f.edge, y), at(f.edge + w, y)),
          straight(at(f.edge + w, y), at(f.edge + w, y - w * 0.36)),
        ),
      ),
    ]);
  },

  underscore: (style) => {
    const f = frame(style);
    const w = f.arch * 1.45;
    const y = f.desc * 0.42;
    return finish(f, [thin(f, straight(at(f.edge, y), at(f.edge + w, y)), f.plain, f.plain)]);
  },

  bar: (style) => {
    const f = frame(style);
    const { foot, head } = tall(f);
    // Straight to the line, not half a pen short of it: a run cut square across
    // its own direction stops where its spine stops, and only the runs that lie
    // along a line have to be set back from it.
    return finish(f, [ink(f, straight(at(f.edge, foot), at(f.edge, head)), f.plain, f.plain)]);
  },

  /*
   * A broken bar is one bar with a piece taken out of the middle, and the piece
   * is as wide as the bar: any narrower and it fills in at a display weight,
   * any wider and it reads as two marks rather than one interrupted.
   */
  brokenbar: (style) => {
    const f = frame(style);
    const { foot, head } = tall(f);
    const middle = (foot + head) / 2;
    const gap = Math.max(f.style.pen.weight, (head - foot) * 0.11);
    return finish(f, [
      ink(f, straight(at(f.edge, foot), at(f.edge, middle - gap / 2)), f.plain, f.plain),
      ink(f, straight(at(f.edge, middle + gap / 2), at(f.edge, head)), f.plain, f.plain),
    ]);
  },

  bracketleft: (style) => {
    const f = frame(style);
    const w = bracketReach(f);
    const { foot, head } = tall(f);
    return finish(f, [
      ink(
        f,
        chain(
          straight(at(f.edge + w, f.hangs(head)), at(f.edge, f.hangs(head))),
          straight(at(f.edge, f.hangs(head)), at(f.edge, f.sits(foot))),
          straight(at(f.edge, f.sits(foot)), at(f.edge + w, f.sits(foot))),
        ),
        shortEnd(f),
        shortEnd(f),
      ),
    ]);
  },

  bracketright: (style) => {
    const f = frame(style);
    const w = bracketReach(f);
    const { foot, head } = tall(f);
    return finish(f, [
      ink(
        f,
        chain(
          straight(at(f.edge, f.hangs(head)), at(f.edge + w, f.hangs(head))),
          straight(at(f.edge + w, f.hangs(head)), at(f.edge + w, f.sits(foot))),
          straight(at(f.edge + w, f.sits(foot)), at(f.edge, f.sits(foot))),
        ),
        shortEnd(f),
        shortEnd(f),
      ),
    ]);
  },

  backslash: (style) => {
    const f = frame(style);
    if (bookish(f)) return finish(f, [solidus(f, -1)]);
    const lean = f.arch * 0.75;
    return finish(f, [
      ink(f, straight(at(f.edge, f.cap), at(f.edge + lean, f.desc * 0.6)), f.plain, f.plain),
    ]);
  },

  /*
   * A caret is wide against its height, and it has to be: the point is a corner
   * between two runs, and the taller and narrower it gets the sharper that
   * corner is, until the inside of the turn comes back through the stroke. On a
   * condensed face at a display weight it did exactly that.
   */
  asciicircum: (style) => {
    const f = frame(style);
    const rise = f.cap * 0.32;
    const w = Math.max(signWidth(f), rise * 1.55, barHalf(f) * 5);
    const foot = f.cap * 0.56;
    // Short of the cap line, because a corner carried out to a miter reaches
    // past both the runs that make it -- and a flared face reaches further.
    const head = Math.min(foot + rise, f.cap * 0.92);
    return finish(f, [
      bent(
        f,
        chain(
          straight(at(f.edge, foot), at(f.edge + w / 2, f.hangs(head))),
          straight(at(f.edge + w / 2, f.hangs(head)), at(f.edge + w, foot)),
        ),
      ),
    ]);
  },

  /*
   * The two bars of a hash lean, because upright ones read as a window frame
   * rather than as a mark -- and they lean by the same amount whatever the face
   * is doing, since a slanted face slants the whole thing again on top.
   */
  numbersign: (style) => {
    const f = frame(style);
    const foot = f.x * -0.06;
    const head = f.cap * 0.92;
    const lean = (head - foot) * 0.14;
    /*
     * Four runs held apart by their own width rather than by a share of the
     * sign's, and the sign as wide as that spacing turns out to need.
     *
     * Set at a fraction of a fixed width, a hash on a display face was four
     * bars with less than a bar between them: they fused, and what came out was
     * a single lozenge of ink. Spacing first and width second means a heavy
     * face draws a wide hash, which is what a heavy face does.
     */
    const down = Math.max(f.style.pen.weight * f.bar * 1.85, signWidth(f) * 0.36);
    const across = Math.max(f.style.pen.weight * f.bar * 1.7, f.x * 0.3);
    const w = down + Math.max(down * 0.62, lean + f.style.pen.weight * f.bar);
    const middle = axis(f) + f.x * 0.04;
    return finish(f, [
      ...[middle - across / 2, middle + across / 2].map((y) =>
        thin(f, straight(at(f.edge, y), at(f.edge + w, y)), f.plain, f.plain),
      ),
      ...[(w - down) / 2, (w + down) / 2].map((x) =>
        thin(
          f,
          straight(at(f.edge + x - lean / 2, foot), at(f.edge + x + lean / 2, head)),
          shortEnd(f),
          shortEnd(f),
        ),
      ),
    ]);
  },

  /*
   * The symbols that are a letter this font already draws.
   *
   * A cent is a c with a bar through it, an ordinal is a small a, a superior
   * figure is a small figure, and a Spanish opening mark is the closing one
   * turned over. Drawn again here rather than borrowed, each would be a second
   * a and a second c inside the same font -- and the day somebody chose the
   * single-storey a, one of the two would quietly stay behind.
   */

  cent: outOf("c", (f, c) => {
    const centre = f.edge + f.bowl;
    const over = f.x * 0.22;
    return joined(
      f,
      c(),
      [ink(f, straight(at(centre, -over), at(centre, f.x + over)), shortEnd(f), shortEnd(f))],
      true,
    );
  }),

  dollar: outOf("S", (f, s) => {
    // Where the s runs, worked out the way the s works it out, so the bar goes
    // through the middle of the letter rather than near it.
    const radius = Math.max((f.cap + f.over * 2 - f.upright * 2) / 4, f.least);
    const centre = f.edge + bendWidth(f, radius);
    // How far the bar stands out past the letter, kept modest: a wavy face
    // adds its own swing on top and the two together reached over the line.
    const over = f.cap * 0.075;
    return joined(
      f,
      s(),
      [ink(f, straight(at(centre, -over), at(centre, f.cap + over)), shortEnd(f), shortEnd(f))],
      true,
    );
  }),

  /*
   * A yen is a Y with its stem crossed. The bars reach the full width of the
   * letter, sit below where the vee closes, and stand apart by their own
   * weight rather than by a share of the cap height -- which on a display face
   * put them within a bar of each other, where they fused into one.
   *
   * And there are two of them only where two will fit. A heavy face carries
   * its vee most of the way down to the junction and leaves barely a stem
   * below it; asked for two bars anyway, the upper one landed in the vee and
   * the lower one under the baseline. One bar is a yen as surely as two are,
   * and it is what a heavy face has room to draw.
   */
  yen: outOf("Y", (f, y) => {
    const drawn = y();
    const across = spread(drawn);
    const bar = f.style.pen.weight * f.bar;
    const junction = f.cap * 0.46;
    const top = junction - f.style.pen.weight * 0.85 - bar / 2;
    const step = Math.max(bar * 2.3, f.cap * 0.12);
    /*
     * Two bars where they fit and two bars where they do not.
     *
     * A yen carries two strokes across its stem, and how much room there is for
     * them is a question about the pen: at a hairline the two sit clear of each
     * other and of the vee above, and by a text weight they have eaten the gap
     * and one bar is all that will go. Drawing one bar in that case is right on
     * the page and wrong in the file -- it is a whole stroke fewer, four nodes,
     * and two weights drawn with different nodes cannot be joined into one
     * variable font, so a yen sat in a Black word at Thin weight.
     *
     * So the second bar is drawn on top of the first rather than dropped. Two
     * strokes on one line are one line to look at, and they are two strokes to
     * count -- and as the weight comes off they slide apart into the pair the
     * letter is supposed to have.
     */
    const room = top - step > f.cap * 0.11;
    const rows = room ? [top, top - step] : [top * 0.62, top * 0.62];
    return joined(
      f,
      drawn,
      rows.map((row) =>
        thin(f, straight(at(across.xMin, row), at(across.xMax, row)), f.plain, f.plain),
      ),
    );
  }),

  /** A u whose first stem carries on below the line, which is what a mu is. */
  mu: outOf("u", (f, u) =>
    joined(f, u(), [
      ink(f, straight(at(f.edge, f.desc * 0.86), at(f.edge, f.x * 0.5)), f.end, BUTT),
    ]),
  ),

  exclamdown: outOf("exclam", (f) => turnedDown(f, "exclam")),
  questiondown: outOf("question", (f) => turnedDown(f, "question")),

  ordfeminine: outOf("a", (f) => ordinal(f, "a")),
  ordmasculine: outOf("o", (f) => ordinal(f, "o")),

  onesuperior: outOf("one", (f) => superior(f, "one")),
  twosuperior: outOf("two", (f) => superior(f, "two")),
  threesuperior: outOf("three", (f) => superior(f, "three")),

  /*
   * The fractions, which are the figures again at two heights with a stroke
   * between them.
   *
   * Two letters go into each of these and `outOf` names one, so the numerator
   * is the one whose letterform they follow. It is the half a reader looks at.
   */
  onequarter: outOf("one", (f) => fraction(f, "one", "four")),
  onehalf: outOf("one", (f) => fraction(f, "one", "two")),
  threequarters: outOf("three", (f) => fraction(f, "three", "four")),

  /*
   * A tilde as wide as a sign, built the way the accent above a letter is: two
   * half turns, one over and one under. The same shape at a different size and
   * on a different line, which is why it is not drawn again from scratch.
   */
  asciitilde: (style) => {
    const f = frame(style);
    // Held above what the bar drawing it can turn round, which is not the same
    // number as what the stem can: a face whose bars are heavier than its stems
    // asked this arc for a radius narrower than its own pen.
    const radius = Math.max((signWidth(f) * 1.06) / 4, barHalf(f) * 1.12);
    const y = axis(f);
    return finish(f, [
      thin(
        f,
        chain(
          turn(at(f.edge + radius, y), radius, 180, 0),
          turn(at(f.edge + radius * 3, y), radius, 180, 360),
        ),
        shortEnd(f),
        shortEnd(f),
      ),
    ]);
  },

  /** Five spokes from one middle, which is what keeps it from reading as a star. */
  asterisk: (style) => {
    const f = frame(style);
    // A text face's asterisk is a large mark hung from the cap height: Lora's
    // is three fifths of it across.
    const reach = Math.max(f.cap * (bookish(f) ? 0.3 : 0.2), f.style.pen.weight * f.bar * 1.3);
    const centre = at(f.edge + reach, f.cap - reach * 1.05);
    return finish(
      f,
      [90, 162, 234, 306, 18].map((degrees) =>
        thin(f, straight(centre, pointOn(centre, reach, degrees)), BUTT, shortEnd(f)),
      ),
    );
  },

  /*
   * Two rings and the stroke between them. The rings are held to a size the pen
   * can keep a counter at, and the sign widens to suit rather than closing up.
   */
  percent: (style) => {
    const f = frame(style);
    const radius = Math.max(f.cap * 0.155, f.half * 2.05);
    const w = Math.max(f.cap * 0.86 * f.style.metrics.width, radius * 4.3);
    const lean = w * 0.62;
    const bar = f.edge + (w - lean) / 2;
    return finish(
      f,
      [
        ink(f, ring(f, at(f.edge + radius, f.cap - radius), radius, radius)),
        ink(
          f,
          straight(at(bar, f.dip(0)), at(bar + lean, f.crest(f.cap))),
          shortEnd(f),
          shortEnd(f),
        ),
        ink(f, ring(f, at(f.edge + w - radius, radius), radius, radius)),
      ],
      true,
    );
  },

  /*
   * A brace: two long curves either side of a spur that points away from the
   * text. Four arcs bowed off their chords rather than one chain of turns,
   * because a brace changes direction three times and an offset carried round
   * a turn that sharp goes through itself.
   */
  braceleft: (style) => brace(frame(style), 1),
  braceright: (style) => brace(frame(style), -1),

  /*
   * A pound is an L drawn the wrong way round with a bar through it: a hooked
   * head, a stem down to the line, a foot along it, and the crossbar that says
   * which currency it is.
   */
  sterling: (style) => {
    const f = frame(style);
    const w = figureWidth(f) * 1.05;
    const hook = Math.max(w * 0.29, f.least);
    const stem = f.edge + hook * 1.5;
    const head = f.crest(f.cap) - hook;
    /*
     * The hook and the stem are two runs that overlap rather than one chain.
     * Chained, the arc comes down the left and the stem sets off from where the
     * recipe thought the arc ended -- and half a unit of daylight between them
     * is a kink the sweep turns into a crossed stroke. The figure two learned
     * the same thing.
     */
    const over = bend(f, at(stem, head), hook, 20, 180);
    return finish(f, [
      ink(f, over, f.end, BUTT),
      ink(f, straight(spineEnd(over), at(spineEnd(over).x, f.sits(0))), BUTT, BUTT),
      arm(f, f.edge, f.edge + w, f.sits(0, f.bar)),
      thin(
        f,
        straight(at(f.edge + w * 0.03, f.x * 0.62), at(f.edge + w * 0.72, f.x * 0.62)),
        f.plain,
        f.plain,
      ),
    ]);
  },

  /** A ring with four spokes off its corners, which is the old currency mark. */
  currency: (style) => {
    const f = frame(style);
    const radius = Math.max(f.cap * 0.2, f.half * 2.1);
    const centre = at(f.edge + radius, axis(f) + f.cap * 0.16);
    const spoke = radius * 0.62;
    return finish(
      f,
      [
        ink(f, ring(f, centre, radius, radius)),
        ...[45, 135, 225, 315].map((degrees) =>
          thin(
            f,
            straight(
              pointOn(centre, radius * 0.86, degrees),
              pointOn(centre, radius + spoke, degrees),
            ),
            BUTT,
            shortEnd(f),
          ),
        ),
      ],
      true,
    );
  },

  /*
   * A section mark is an s over an s, offset by half and sharing the middle.
   * Drawn out of the same construction the letter uses, so it thickens, leans,
   * squares and waves with the rest of the font rather than beside it.
   */
  section: (style) => {
    const f = frame(style);
    const height = f.cap * 0.62;
    const step = height * 0.53;
    const upper = spine(f, height, f.edge).stroke;
    const lower = spine(f, height, f.edge).stroke;
    return {
      strokes: [
        shovedStroke(finish(f, [upper]).strokes[0], 0, f.cap - height + f.desc * 0.06),
        shovedStroke(finish(f, [lower]).strokes[0], 0, f.cap - height - step + f.desc * 0.06),
      ],
      round: true,
    };
  },

  copyright: (style) => enclosed(frame(style), "C"),
  registered: (style) => enclosed(frame(style), "R"),

  /*
   * A pilcrow: a filled bowl with two stems hanging off it. The bowl is solid
   * rather than a counter, so it is drawn as what it is -- one run of a pen
   * wide enough to fill it -- rather than as a ring somebody then has to fill.
   */
  paragraph: (style) => {
    const f = frame(style);
    const thick = f.cap * 0.5;
    const middle = f.cap - thick / 2;
    const round: Terminal = { kind: "round" };
    // The bowl hangs off the first stem and the second stands clear of it by
    // its own width, so a heavy face reads as two stems rather than as one.
    const bowl = Math.max(thick * 0.82, f.style.pen.weight * 1.7);
    const first = f.edge + bowl;
    const second = first + Math.max(f.style.pen.weight * 2.3, f.cap * 0.16);
    const foot = f.desc * 0.62;
    return finish(f, [
      {
        spine: straight(at(f.edge + thick / 2, middle), at(first, middle)),
        pen: { ...f.style.pen, contrast: 0, weight: thick },
        start: round,
        end: BUTT,
      },
      ink(f, straight(at(first, foot), at(first, f.hangs(f.cap))), f.end, BUTT),
      ink(f, straight(at(second, foot), at(second, f.hangs(f.cap))), f.end, BUTT),
    ]);
  },

  /*
   * An at sign: the ring somebody already knows, with a small bowl and its stem
   * inside. The inner pair is the a of this font in miniature in everything but
   * name -- a bowl and an upright beside it -- and it is drawn at the same
   * weight as the ring around it, which is what keeps the mark even in colour.
   */
  at: (style) => {
    const f = frame(style);
    /*
     * The inner bowl is sized first and the ring is grown to hold it.
     *
     * Sized as a share of the ring instead, a display weight left it a hair
     * over the pen drawing it and the little a inside came out as a disc with a
     * dimple. The bowl is the part that has to stay open, so it is the part
     * that sets the size, and the mark gets larger rather than filling in.
     */
    const inner = Math.max(f.capBowlH * 0.38, f.half * 2.35);
    // A text face's is larger, from below the line to the cap height, as Lora's is.
    const outer = Math.max(
      f.capBowlH * (bookish(f) ? 1.08 : 0.94),
      inner + f.style.pen.weight * 1.55,
    );
    const centre = at(f.edge + outer, f.cap * (bookish(f) ? 0.4 : 0.46));
    const stem = centre.x + bendWidth(f, inner);
    return finish(
      f,
      [
        ink(f, bend(f, centre, outer, -38, 252), shortEnd(f), shortEnd(f)),
        ink(f, ring(f, centre, inner, inner)),
        ink(
          f,
          straight(at(stem, centre.y - inner), at(stem, centre.y + inner * 0.15)),
          BUTT,
          shortEnd(f),
        ),
      ],
      true,
    );
  },

  /*
   * The ampersand, drawn the way a text face draws it: a small loop at the
   * cap height, whose right side runs down and across into a larger bowl on
   * the baseline, and a long diagonal leaving the loop's left side and
   * crossing everything on its way down to a foot that turns out along the
   * line. The bowl comes round and up into an arm on the right, finished with
   * a flat bar where the face has serifs.
   *
   * The loop and the bowl are joined by the one straight run that is tangent
   * to both, so the stroke passes from one into the other the way an S does.
   * That needs the two circles clear of each other, and at a heavy weight
   * they are not -- stacked straight up they overlap -- so the loop moves over
   * to the right until they are, which is where a black ampersand's loop sits
   * anyway. Every turn is drawn in a fixed number of pieces, so the letter has
   * the same nodes at every weight.
   */
  ampersand: (style) => {
    const f = frame(style);
    const C = f.cap;
    const pinned = (run: Spine, pieces: number): Spine => ({
      ...run,
      segments: run.segments.map((one) => (one.kind === "arc" ? { ...one, pieces } : one)),
    });
    /*
     * The bowl and the loop, as large as the face asks and no tighter than
     * the pen goes round -- and, between those, small enough to stand one
     * above the other with the spine running down between them. Where even
     * the tightest pair cannot, at the limit of the weight axis, the loop
     * rises past the cap height rather than sliding round beside the bowl,
     * where the spine between them turned uphill and the letter folded.
     */
    const span = f.crest(C) - f.dip(0);
    const wantR = Math.max(C * 0.24, f.half * 1.75);
    const wantr = Math.max(C * 0.14, f.half * 1.45);
    const fits = Math.min(1, span / 2.05 / (wantR + wantr));
    const R = Math.max(wantR * fits, f.half * 1.5, f.least);
    const r = Math.max(wantr * fits, f.half * 1.15, f.least);
    const bowlAt = at(f.edge + R, f.dip(0) + R);
    const loopY = Math.max(f.crest(C) - r, bowlAt.y + (r + R) * 1.02);
    const rise = loopY - bowlAt.y;
    const clear = (r + R) * 1.08;
    const over = Math.max(C * 0.05, Math.sqrt(Math.max(0, clear * clear - rise * rise)));
    const loopAt = at(bowlAt.x + over, loopY);
    // Where the tangent common to both circles, crossing between them, meets
    // each: on the loop's lower right and the bowl's upper left.
    const apart = Math.hypot(over, rise);
    const joinAt =
      ((Math.atan2(rise, over) + Math.PI + Math.acos(Math.min(1, (r + R) / apart))) * 180) /
        Math.PI -
      360;
    const leave = pointOn(loopAt, r, joinAt);
    const arrive = pointOn(bowlAt, R, joinAt + 180);
    // The diagonal leaves the loop at forty-five degrees and turns out along
    // the baseline into its foot.
    const from = pointOn(loopAt, r, 225);
    const foot = Math.max(C * 0.14, f.half * 1.9);
    const line = f.sits(0);
    const kneeY = line + foot * (1 - Math.SQRT1_2);
    const knee = at(from.x + (from.y - kneeY), kneeY);
    const heel = at(knee.x + foot * Math.SQRT1_2, line);
    // The arm: up and a little to the right out of the bowl, to about half
    // the cap height.
    const armFrom = pointOn(bowlAt, R, 345);
    const top = C * 0.52;
    // Never below where the arm leaves the bowl, which at the limit of the
    // weight axis is higher than half the cap height.
    const head = Math.max(f.hangs(top), armFrom.y + f.half * 0.6);
    // Leaving the bowl along its own tangent there, exactly: a heading a hair
    // off it puts a join into the run, and the join folds.
    const armTo = at(armFrom.x + (head - armFrom.y) * Math.tan((15 * Math.PI) / 180), head);
    const serifed = style.parts.slab.on;
    const reach = f.half + (f.end.projection ?? f.half * 0.6);
    return finish(f, [
      ink(f, pinned(turn(loopAt, r, 218, joinAt + 8), 4), BUTT, BUTT),
      ink(
        f,
        chain(
          pinned(turn(loopAt, r, 208, 225), 1),
          straight(from, knee),
          pinned(turn(at(heel.x, line + foot), foot, 225, 270), 1),
          straight(heel, at(heel.x + f.half * 1.2, line)),
        ),
        BUTT,
        BUTT,
      ),
      ink(
        f,
        chain(
          pinned(turn(loopAt, r, joinAt + 18, joinAt), 1),
          straight(leave, arrive),
          pinned(turn(bowlAt, R, joinAt + 180, 345), 3),
        ),
        BUTT,
        BUTT,
      ),
      // The arm on its own, run in from a little way back round the bowl: at
      // a black weight its top comes up under the spine, and in one run with
      // it the two edges met and the outline folded.
      ink(
        f,
        chain(pinned(turn(bowlAt, R, 330, 345), 1), straight(armFrom, armTo)),
        BUTT,
        serifed ? BUTT : f.end,
      ),
      ...(serifed
        ? [
            ink(
              f,
              straight(at(armTo.x - reach, head), at(armTo.x + reach * 1.15, head)),
              BUTT,
              BUTT,
            ),
          ]
        : []),
    ]);
  },

  periodcentered: (style) => {
    const f = frame(style);
    const radius = f.half * 0.95;
    return finish(f, [dot(f, at(f.edge, axis(f)), radius)]);
  },

  degree: (style) => {
    const f = frame(style);
    // Wide enough to keep a counter at any weight: a ring less than about two
    // pens across is a disc with a dimple in it.
    const radius = Math.max(f.cap * 0.15, f.half * 2);
    const centre = at(f.edge + radius, f.cap - radius);
    return finish(f, [ink(f, ring(f, centre, radius, radius))], true);
  },

  /*
   * The guillemets: two chevrons each, held apart by their own weight so a
   * heavy face does not run them into one arrowhead.
   */
  guillemotleft: (style) => chevrons(frame(style), -1),
  guillemotright: (style) => chevrons(frame(style), 1),
};
