/**
 * A family, drawn from the one weight on screen.
 *
 * Until this existed the application drew a font. A typeface is a family: a
 * text face with no bold cannot set a heading, cannot emphasise a word, and
 * cannot be used for anything longer than a logo -- so what came out of here
 * was a specimen rather than something anybody could typeset with.
 *
 * The whole family comes from the drawing rather than being drawn nine times.
 * That is the same promise the rest of this half makes and for the same reason:
 * nine drawings are nine things to keep in step, and the day somebody moves the
 * shoulder of the Regular, eight other faces quietly do not follow.
 *
 * What changes between weights, and by how much, is not invented here. Six
 * families that ship with this machine -- DejaVu Sans and Serif, Liberation Sans
 * and Serif, FreeSans and FreeSerif -- each carry a Regular and a Bold drawn by
 * somebody who knew what they were doing, so the answer is measured off them
 * rather than guessed at. All six agree, and `family.test.ts` re-measures them.
 */

import { penReach, reachAlong } from "./sweep";
import type { Style } from "./style";

/**
 * The nine weights, as the world names and numbers them.
 *
 * A convention rather than a rule, so it is written down rather than derived --
 * the same call `slots.ts` makes about glyph names. There is no measurement
 * that says a 600 is called SemiBold; it is called SemiBold because everybody
 * calls it SemiBold, and a file that calls it something else is a file whose
 * font menu reads wrongly.
 */
/**
 * A set of weights, said as a number apiece.
 *
 * `drawn` is the one the style describes, and it is not always four hundred: a
 * face can be drawn as its Black and have the rest of the family worked out
 * downwards, which is how a display family usually starts.
 */
export interface Family {
  drawn: number;
  /** The others, which may or may not repeat `drawn`. */
  also: number[];
  /**
   * The widths beside the one on screen, as `wdth` numbers: 75 for a
   * Condensed, 125 for an Expanded.
   *
   * The drawing is always the Normal, a hundred, the same way it is always one
   * of the weights. Left out -- which every document saved before there were
   * widths is -- the family has that one width and nothing else, and is
   * written exactly as it always was.
   */
  widths?: number[];
}

export const WEIGHTS: Array<{ weight: number; name: string }> = [
  { weight: 100, name: "Thin" },
  { weight: 200, name: "ExtraLight" },
  { weight: 300, name: "Light" },
  { weight: 400, name: "Regular" },
  { weight: 500, name: "Medium" },
  { weight: 600, name: "SemiBold" },
  { weight: 700, name: "Bold" },
  { weight: 800, name: "ExtraBold" },
  { weight: 900, name: "Black" },
];

export function nameOfWeight(weight: number): string {
  return WEIGHTS.find((one) => one.weight === weight)?.name ?? `${weight}`;
}

/**
 * What a Regular's stem is, against its own x-height.
 *
 * The one number that says which weight a face already is. All six families on
 * this machine put their Regular between 0.160 and 0.187 of the x-height, and
 * their Bold between 0.259 and 0.350 -- and the middle of the second is very
 * nearly the middle of the first times seven hundred over four hundred, which
 * is the same rule the family below is built on arriving from the other
 * direction. So a face can be asked what weight it is rather than assumed to be
 * a Regular, which matters most for the faces that plainly are not: the display
 * base here is a 700 and the hairline one is a 200, and either of them, called
 * a Regular and given a Bold, would be asked for a weight that cannot exist.
 */
const REGULAR_STEM = 0.175;

/**
 * Which of the nine weights a face already is, read off its own stem.
 *
 * Rounded to the nearest hundred and held inside the nine, because what this
 * answers is "which of these is it", and there is no name for a 437.
 */
export function weightClassOf(style: Style): number {
  const x = style.metrics.xHeight || style.metrics.unitsPerEm * 0.5;
  const asked = Math.round((400 * (style.pen.weight / x)) / REGULAR_STEM / 100) * 100;
  return Math.min(900, Math.max(100, asked));
}

/**
 * How much of what a stem gains the counter gives back.
 *
 * Measured, one number, and the one that decides whether a family reads as a
 * family. A bold whose counters are the regular's is not a bold, it is a
 * regular that has been fattened until the letters ran into each other; a bold
 * whose counters shrink by everything the stems gained is the same width as the
 * regular and reads as a condensed face.
 *
 * The six families on this machine give -0.93, -0.69, -0.82, -0.80, -0.84 and
 * -0.69 counter units per stem unit. Four fifths is the middle of that, and
 * every one of them is within two tenths of it.
 */
const COUNTER_GIVES_BACK = 0.8;

/**
 * The style one member of the family is drawn with.
 *
 * Three changes and no others. The pen widens in proportion to the weight it is
 * being asked for -- a seven hundred is seven hundred, which is what the number
 * has always meant. The counter gives back four fifths of what the stem gained,
 * so the letter grows in width by about a fifth of the stem rather than by
 * twice it. And the spacing does not move at all, which is the finding that
 * most surprised me: all six families space their bold within a tenth of a stem
 * unit of their regular, and two of them space it identically.
 *
 * Everything else -- the x-height, the cap height, the serifs, the shoulder,
 * the squareness, the slant -- is the same face. That is what makes it a
 * family rather than nine fonts with one name.
 */
export function weightedStyle(style: Style, drawnAt: number, wanted: number): Style {
  if (wanted === drawnAt) return style;
  const was = style.pen.weight;
  const weight = (was * wanted) / drawnAt;
  /*
   * Lighter than the drawing, on a face that says how it thins
   * (`metrics.lightHeld`), the face's own rule is the family's: its bowls and
   * arches held about as wide as the Regular's, and every letter measured off
   * a reference face's Thin taking that Thin's measures. So the pen is all
   * that changes. The rule below on top of it would widen the counters twice,
   * and the rule below instead of it -- the face's own switched off -- left
   * the letters drawn to the reference at the Regular's measures: a Thin
   * whose H was a hairline beside a D, an O and a Q still at the Regular's
   * weight, and a 1 with the Regular's flag.
   */
  if (weight < was && style.metrics.lightHeld) return { ...style, pen: { ...style.pen, weight } };
  const gained = weight - was;
  /*
   * The counter is not allowed below what the pen can hold open.
   *
   * At the heavy end four fifths of a large gain is more counter than there is,
   * and a counter of nothing is a letter with no inside. Held at a third of the
   * stem, which is about where a Black stops being readable and is where the
   * heaviest of the six sits.
   */
  const counter = Math.max(style.metrics.counterWidth - gained * COUNTER_GIVES_BACK, weight * 0.34);
  return {
    ...style,
    pen: { ...style.pen, weight },
    // The counter given back here, and the bowls widened here, so neither
    // again as the pen is drawn: see `metrics.heavyCounter` and
    // `metrics.lightHeld`.
    metrics: {
      ...style.metrics,
      counterWidth: counter,
      heavyCounter: undefined,
      lightHeld: undefined,
    },
    parts: { ...style.parts, bowl: { ...style.parts.bowl, width: bowlWidth(style, weight) } },
  };
}

/**
 * How wide the round letters are at another weight.
 *
 * The fourth thing that changes, and the one that was missed first time: an o
 * left alone does not widen at all. Its height is the x-height, which does not
 * move, and a round letter as tall as the x-height and no wider is the same
 * width at every weight -- so a Black came out with an o the width of its Thin
 * standing beside an n half again as wide, which reads as two different fonts
 * in one word.
 *
 * Four of the six families widen the o by about what they widen the n by, and
 * the two that do not are the two that barely widen the n either. So rather
 * than a fifth measured number, the bowls are given the rate the arches
 * already have: what an arch gains per unit of stem falls out of the counter
 * rule above, and this asks the bowls for the same. Beside each other at any
 * weight, an o and an n gain the same width.
 */
function bowlWidth(style: Style, weight: number): number {
  const { metrics, parts } = style;
  const was = style.pen.weight;
  const wide = parts.bowl.width * metrics.width;
  const room = (pen: number): number => {
    const upright = Math.abs(reachAlong(UP, penReach({ ...style.pen, weight: pen })).y);
    return Math.max(metrics.xHeight / 2 + metrics.overshoot - upright, pen * 0.53);
  };
  // What an arch gains for every unit the stem gains, which is the counter
  // rule and the rhythm of the face and nothing else.
  const perStem = 1 + (1 - COUNTER_GIVES_BACK) * parts.shoulder.reach * metrics.width;
  const ink = (room(was) * wide + was / 2) * 2 + perStem * (weight - was);
  const now = room(weight);
  if (now <= 0) return parts.bowl.width;
  const wanted = (ink / 2 - weight / 2) / now;
  /*
   * Held either side of where it started. At the ends of a long family the
   * height a bowl has left is nearly nothing, and solving for a width against
   * nearly nothing asks for a letter three times as wide as the face it
   * belongs to.
   */
  const held = Math.min(Math.max(wanted, wide * 0.55), wide * 2.1);
  return (parts.bowl.width * held) / wide;
}

const UP = { x: 0, y: 1 };

/**
 * The widths, as the world names and numbers them.
 *
 * The `wdth` value is the registered one -- a percentage of the Normal -- and
 * the name and class are the OS/2 table's `usWidthClass`, one to nine. Five of
 * the nine are offered: past three quarters, or a quarter again, the letters
 * are no longer this face drawn narrower or wider but another face, and the
 * bowls run out of room before the stems do.
 */
export const WIDTHS: Array<{ width: number; name: string; widthClass: number }> = [
  { width: 75, name: "Condensed", widthClass: 3 },
  { width: 87.5, name: "SemiCondensed", widthClass: 4 },
  { width: 100, name: "Normal", widthClass: 5 },
  { width: 112.5, name: "SemiExpanded", widthClass: 6 },
  { width: 125, name: "Expanded", widthClass: 7 },
];

/** The width every drawing is: the one on screen. */
export const NORMAL_WIDTH = 100;

export function nameOfWidth(width: number): string {
  return WIDTHS.find((one) => one.width === width)?.name ?? `${width}`;
}

/** The OS/2 `usWidthClass` for a `wdth` value: the nearest of the nine. */
export function widthClassOf(width: number): number {
  const classes = [50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200];
  let best = 0;
  for (let index = 1; index < classes.length; index++) {
    if (Math.abs(classes[index] - width) < Math.abs(classes[best] - width)) best = index;
  }
  return best + 1;
}

/** The widths of a family, in order, always including the Normal. */
export function widthsOf(family: Family): number[] {
  // Read with care, since it comes out of a saved file: anything that is not
  // a width a letter can be drawn at is not a width.
  const asked = Array.isArray(family.widths) ? family.widths : [];
  const usable = asked.filter((width) => typeof width === "number" && width >= 25 && width <= 200);
  return [...new Set([NORMAL_WIDTH, ...usable])].sort((one, other) => one - other);
}

/**
 * The style one width of the family is drawn with.
 *
 * Draw's own width -- `metrics.width`, the multiple every horizontal measure
 * of a letter is built from -- taken as the share of the drawing's the `wdth`
 * number asks for. So a Condensed is drawn condensed rather than squeezed: the
 * bowls are narrower ovals and the counters closer, while the stems keep the
 * pen they were drawn with, which is what separates a condensed face from a
 * narrow picture of a normal one.
 *
 * The spacing closes too, by the square root of that share rather than by all
 * of it. Narrow letters spaced as loosely as wide ones stand apart, and spaced
 * as tightly as their counters they run together; the root keeps the white
 * beside a letter in about the proportion to the white inside it that the
 * Normal has.
 *
 * Over the Sans a Condensed drawn this way sets about four fifths the width of
 * the Normal and an Expanded about six fifths, which is where the condensed
 * and extended cuts of the grotesques sit against their normals. Nothing else
 * moves: the heights, the pen, the serifs and the slant are the face's own,
 * and the weights are worked out from the width afterwards exactly as they are
 * from the Normal -- so a Condensed Bold is a Condensed made bold.
 */
export function widthedStyle(style: Style, width: number): Style {
  if (width === NORMAL_WIDTH) return style;
  const share = width / NORMAL_WIDTH;
  return {
    ...style,
    metrics: {
      ...style.metrics,
      width: style.metrics.width * share,
      widthAxis: (style.metrics.widthAxis ?? 1) * share,
      sidebearing: style.metrics.sidebearing * Math.sqrt(share),
    },
  };
}

/** What a weight at a width is called: "Bold", "Condensed", "Condensed Bold". */
export function styleNameOf(weight: number, width: number = NORMAL_WIDTH): string {
  const heavy = nameOfWeight(weight);
  if (width === NORMAL_WIDTH) return heavy;
  const wide = nameOfWidth(width);
  return heavy === "Regular" ? wide : `${wide} ${heavy}`;
}

/** The weights of a family, in order, always including the one being drawn. */
export function weightsOf(family: Family): number[] {
  return [...new Set([family.drawn, ...family.also])].sort((one, other) => one - other);
}

/**
 * What one member of the family is called, and what file it goes in.
 *
 * The style name is the one the world uses for that number, and the file is
 * named the way every foundry names them: family and style run together, which
 * is what a font manager sorts by.
 *
 * A width other than the Normal comes first, as every family with widths
 * names them -- "Condensed Bold" -- and a Regular at another width is just the
 * width: "Condensed", not "Condensed Regular".
 */
export function memberOf(
  familyName: string,
  weight: number,
  width: number = NORMAL_WIDTH,
): { styleName: string; fileName: string } {
  const styleName = styleNameOf(weight, width);
  const tidy = (text: string): string => text.replace(/[^A-Za-z0-9]+/g, "");
  return { styleName, fileName: `${tidy(familyName) || "Untitled"}-${tidy(styleName)}` };
}
