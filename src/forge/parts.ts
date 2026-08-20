/**
 * The named parts, and who uses them.
 *
 * A part is a decision that more than one letter reads: how far a serif
 * projects, where an arch springs, how a stroke ends. There is one copy of each
 * decision, so changing it changes every letter that consults it -- which is
 * the whole point. Draw the slab you want on a p and what you have actually
 * edited is the slab, so the b, the d, the h, the i, the k, the l, the m and
 * the rest all wear it the next time they are drawn.
 *
 * Two things have to be known for that to be usable rather than merely true.
 * Which parts a letter has, so the editor can offer them; and which letters a
 * part reaches, so it can say what an edit is about to do before it does it.
 * Both are found by drawing the letter and watching what it asks for, rather
 * than from a table kept by hand -- a table would be a second description of
 * the alphabet, and this file has already been bitten twice by keeping one of
 * those.
 */

import { LETTERS, recordPartsWhile, type PartName } from "./letters";
import type { Parts, Style } from "./style";

export type { PartName };

/** One editable number on a part. */
export interface PartControl {
  /** The field inside the part, such as `projection` on the slab. */
  key: string;
  label: string;
  /** What moving it does, in the terms a designer would use. */
  hint: string;
  min: number;
  max: number;
  step: number;
  /** True when the range is in font units and should scale with the em. */
  emRelative?: boolean;
  /** True for an on-or-off switch rather than a slider. */
  toggle?: boolean;
}

export interface PartSpec {
  name: PartName;
  label: string;
  /** What the part is, for the panel and for the help drawer. */
  hint: string;
  controls: PartControl[];
}

/**
 * Every part and everything about it that can be changed.
 *
 * The editor draws itself from this, and so does the help, so neither can come
 * to describe a control the tool does not have.
 */
export const PART_SPECS: PartSpec[] = [
  {
    name: "slab",
    label: "Serif",
    hint: "The bar laid across the end of a straight stroke. Turning it on is most of what separates a serif face from a sans; a curved terminal never takes one.",
    controls: [
      { key: "on", label: "Serifs", hint: "Off for a sans.", min: 0, max: 1, step: 1, toggle: true },
      {
        key: "projection",
        label: "Reach",
        hint: "How far the bar sticks out past the stroke on each side.",
        min: 0,
        max: 0.12,
        step: 0.001,
        emRelative: true,
      },
      {
        key: "thickness",
        label: "Depth",
        hint: "How far the bar reaches back along the stroke.",
        min: 0.005,
        max: 0.1,
        step: 0.001,
        emRelative: true,
      },
      {
        key: "bracket",
        label: "Bracket",
        hint: "How much the inside corner is hollowed out. Zero is a slab serif; opening it makes the serif look grown from the stem rather than stuck on it.",
        min: 0,
        max: 0.08,
        step: 0.001,
        emRelative: true,
      },
    ],
  },
  {
    name: "shoulder",
    label: "Shoulder",
    hint: "Where an arch leaves its stem, and therefore how square the top of an n is. The single decision that most changes how a lowercase reads.",
    controls: [
      {
        key: "spring",
        label: "Springing",
        hint: "High squares the shoulder off; low rounds the whole arch.",
        min: 0.3,
        max: 0.85,
        step: 0.005,
      },
      {
        key: "reach",
        label: "Reach",
        hint: "How far the arch carries over before it turns down.",
        min: 0.7,
        max: 1.3,
        step: 0.005,
      },
    ],
  },
  {
    name: "bowl",
    label: "Bowl",
    hint: "The enclosed round shapes: o, the belly of a b, the ring of a zero.",
    controls: [
      {
        key: "roundness",
        label: "Roundness",
        hint: "One is a circle; less pulls the sides in towards an oval.",
        min: 0.7,
        max: 1.15,
        step: 0.005,
      },
    ],
  },
  {
    name: "terminal",
    label: "Terminal",
    hint: "How a stroke stops when it is not wearing a serif. Flat, rounded off, or cut at an angle as a broad nib leaves it.",
    controls: [
      {
        key: "angle",
        label: "Cut",
        hint: "Degrees away from square. Only an angled terminal reads it.",
        min: -30,
        max: 30,
        step: 0.5,
      },
    ],
  },
  {
    name: "crossbar",
    label: "Crossbar",
    hint: "The stroke that crosses the middle: the bar of an H, the arms of an E, the eye of an e, the waist of an A.",
    controls: [
      {
        key: "height",
        label: "Height",
        hint: "Where it sits, as a fraction of the letter it crosses.",
        min: 0.3,
        max: 0.72,
        step: 0.005,
      },
      {
        key: "weight",
        label: "Weight",
        hint: "How heavy it is against the stems. Below one it stays lighter, which stops a bar looking heavier than the letter around it.",
        min: 0.5,
        max: 1.3,
        step: 0.005,
      },
    ],
  },
];

export function specFor(part: PartName): PartSpec | undefined {
  return PART_SPECS.find((spec) => spec.name === part);
}

/**
 * Which parts a letter is built from.
 *
 * Found by drawing it and noting what it asked for. An o has a bowl and a
 * terminal; an n has a shoulder; an H has a crossbar. Nothing here is written
 * down twice, so a letter that gains a crossbar tomorrow starts offering the
 * crossbar controls without anyone remembering to say so.
 */
export function partsUsedBy(letter: string, style: Style): PartName[] {
  const recipe = LETTERS[letter];
  if (!recipe) return [];
  return [...recordPartsWhile(() => recipe(style))].sort(
    (a, b) => order(a) - order(b),
  );
}

/** Which letters an edit to this part will reach. */
export function lettersUsing(part: PartName, style: Style): string[] {
  return Object.keys(LETTERS).filter((letter) => partsUsedBy(letter, style).includes(part));
}

/** How many letters an edit reaches, which is what the panel says out loud. */
export function reachOf(part: PartName, style: Style): number {
  return lettersUsing(part, style).length;
}

function order(part: PartName): number {
  const index = PART_SPECS.findIndex((spec) => spec.name === part);
  return index === -1 ? PART_SPECS.length : index;
}

/** A part's current value as a plain record, for reading a control out of it. */
export function valuesOf(part: PartName, parts: Parts): Record<string, number | boolean> {
  return parts[part] as unknown as Record<string, number | boolean>;
}
