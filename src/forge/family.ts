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
    metrics: { ...style.metrics, counterWidth: counter },
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

/** The weights of a family, in order, always including the one being drawn. */
export function weightsOf(family: Family): number[] {
  return [...new Set([family.drawn, ...family.also])].sort((one, other) => one - other);
}

/** Whether a set of weights is more than the one on screen. */
export function isFamily(family: Family): boolean {
  return weightsOf(family).length > 1;
}

/**
 * What one member of the family is called, and what file it goes in.
 *
 * The style name is the one the world uses for that number, and the file is
 * named the way every foundry names them: family and style run together, which
 * is what a font manager sorts by.
 */
export function memberOf(
  familyName: string,
  weight: number,
): { styleName: string; fileName: string } {
  const styleName = nameOfWeight(weight);
  const tidy = (text: string): string => text.replace(/[^A-Za-z0-9]+/g, "");
  return { styleName, fileName: `${tidy(familyName) || "Untitled"}-${tidy(styleName)}` };
}
