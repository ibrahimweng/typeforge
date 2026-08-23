/**
 * Kerning worked out by looking at the letters.
 *
 * Every other font carries a list of pairs somebody typed in. A font drawn here
 * cannot: the letters are not fixed drawings, they are a skeleton and a pen, and
 * turning the weight up moves every edge in the alphabet. A list written against
 * one weight is wrong at the next, and a list written against sixteen faces is
 * sixteen lists.
 *
 * So it is measured, with the same ruler everything else here is measured with.
 * Set two letters side by side and ask how close they ever come: down a pair of
 * stems that is the sidebearings and nothing else, and between an `A` and a `V`
 * it is a great deal more, because at no height is either of them near its own
 * edge -- the A is wide at the foot where the V is narrow, and narrow at the top
 * where the V is wide. That distance, against the distance the font's own
 * plainest pairs leave, is the kern.
 *
 * Two things it is deliberately not.
 *
 * It is not the area of white between them. Area is the sum of how open each
 * letter is on its own side, so a pair's area is exactly what its two letters
 * predict and there is no pair in it at all -- `AV` has more white than `AH`
 * only because a `V` is more open than an `H`, which the sidebearings already
 * knew. Measured that way `nn` asked to be pushed apart by thirty-nine units
 * and `HH` by seventy-four, which is a measurement arguing with the spacing.
 *
 * And it is not a norm the shapes are held to. The sidebearings are the spacing
 * system; a round letter is already set tighter than a flat one because that is
 * what makes them look even. Kerning here only corrects the pairs whose shapes
 * the sidebearings could not see coming, which is what a closest approach is.
 */

import { contoursBounds, inkRunsAt } from "@/font/geometry";
import type { Contour, KernClass, KernPair } from "@/font/types";

/** How many heights the letters are measured at. */
const ROWS = 40;

/**
 * How much of the extra room a pair is actually closed by.
 *
 * Not all of it. Closing a pair until it is as tight as two stems is what the
 * measurement literally says, and it is more than a punchcutter would do: it
 * makes every pair in the font equally tight, which is the one thing a font's
 * rhythm is not. Rather more than half of the excess is what a hand does, and
 * it leaves the pairs that need no help alone, because a share of nothing is
 * nothing.
 */
const SHARE = 0.55;

/**
 * Below this a pair is not worth a line in the file.
 *
 * Set where it is because of what it costs rather than because of what it
 * corrects. Every pair the measurement marks is a cell in the font's kerning
 * grid, and at a fortieth of an em it marked a quarter of every pair there is
 * -- fifteen thousand of them, seventy-three kilobytes of GPOS on a font whose
 * outlines are fifty-two. Held here it keeps the pairs that visibly need it and
 * drops the ones that were being corrected by a hair.
 */
const WORTH = 0.055;

/** And no pair is moved further than this, whatever the measurement says. */
const LIMIT = 0.1;

/**
 * The plainest pairs in the font, which are what everything else is measured
 * against.
 *
 * Two stems, two bowls, and one of each, in both cases. Between them they are
 * what the sidebearings were set to make look even, so how close they come is
 * this font's own idea of close -- whatever the weight, the width or the face.
 */
const PLAIN_SMALL: Array<[string, string]> = [
  ["n", "n"],
  ["n", "o"],
  ["o", "n"],
  ["o", "o"],
];

const PLAIN_TALL: Array<[string, string]> = [
  ["H", "H"],
  ["H", "O"],
  ["O", "H"],
  ["O", "O"],
];

/** One letter's two edges, read off at a row of heights. */
export interface Profile {
  /** How far the ink stops short of the advance, at each height. */
  right: number[];
  /** How far in from nothing the ink starts, at each height. */
  left: number[];
  /** Whether there is any ink at all at each height. */
  ink: boolean[];
}

/**
 * A letter's edges, height by height.
 *
 * Not its bounding box: a box says an `A` reaches a certain width and says
 * nothing about only reaching it at the bottom, which is the whole of what
 * makes an `A` kern.
 */
export function profileOf(contours: Contour[], advance: number, heights: number[]): Profile {
  const right: number[] = [];
  const left: number[] = [];
  const ink: boolean[] = [];
  for (const height of heights) {
    const runs = inkRunsAt(contours, height);
    if (runs.length === 0) {
      right.push(0);
      left.push(0);
      ink.push(false);
      continue;
    }
    let near = Infinity;
    let far = -Infinity;
    for (const [from, to] of runs) {
      near = Math.min(near, from);
      far = Math.max(far, to);
    }
    right.push(advance - far);
    left.push(near);
    ink.push(true);
  }
  return { right, left, ink };
}

/**
 * How close two letters ever come, set side by side.
 *
 * Only at the heights both of them use. An `o` has no ink above the x-height
 * and an `H` has, and the air over the `o` is not a gap between them -- counted
 * as one it would say every capital-and-lowercase pair was wide open.
 */
export function nearestBetween(left: Profile, right: Profile): number | null {
  let nearest = Infinity;
  for (let row = 0; row < left.ink.length; row++) {
    if (!left.ink[row] || !right.ink[row]) continue;
    nearest = Math.min(nearest, left.right[row] + right.left[row]);
  }
  return Number.isFinite(nearest) ? nearest : null;
}

export interface KernInput {
  name: string;
  contours: Contour[];
  advanceWidth: number;
  /**
   * The letter this one is built from, if it is built from one.
   *
   * An `Á` kerns exactly as an `A` does -- the accent is above everything it
   * will ever stand beside -- so it is not measured, it is put in the same
   * class. That is what every font does with its accented letters, and here it
   * takes four hundred and fifty-one letters down to two hundred and fifty-one
   * that have to be measured against each other at all.
   */
  sameAs?: string;
}

export interface Kerning {
  pairs: KernPair[];
  classes: KernClass[];
}

/**
 * Every pair worth writing down, for a set of drawn letters.
 *
 * One pass over the alphabet to measure it, then a table of it against itself.
 * What comes out is only the pairs that stand further apart than the font's own
 * plainest ones, which is a small share of them.
 */
export function kernsFor(glyphs: KernInput[], unitsPerEm: number): Kerning {
  const none: Kerning = { pairs: [], classes: [] };
  const inked = glyphs.filter((one) => one.contours.some((c) => c.nodes.length > 1));
  const drawn = inked.filter((one) => !one.sameAs);
  if (drawn.length === 0) return none;

  // Every letter that rides on each drawn one, itself included.
  const family = new Map<string, string[]>(drawn.map((one) => [one.name, [one.name]]));
  for (const one of inked) {
    if (!one.sameAs) continue;
    family.get(one.sameAs)?.push(one.name);
  }

  const bounds = contoursBounds(drawn.flatMap((one) => one.contours));
  const step = (bounds.yMax - bounds.yMin) / (ROWS - 1);
  if (!(step > 0)) return none;
  const heights = Array.from({ length: ROWS }, (_, row) => bounds.yMin + step * row);

  const profiles = new Map<string, Profile>();
  for (const one of drawn) {
    profiles.set(one.name, profileOf(one.contours, one.advanceWidth, heights));
  }

  /*
   * Two norms, not one: capitals are spaced differently from lowercase.
   *
   * Every font spaces its capitals more openly than its lowercase, and here
   * that is a parametric fact rather than a decision -- the sidebearing is one
   * number and a capital is taller, so the same sidebearing reads as more air.
   * Held to a single norm, the Brush face's `HH` came out wanting sixty units
   * of pull while its `nn` wanted none, which is the measurement noticing the
   * difference between the two cases and calling it a fault.
   */
  const normOf = (plainPairs: Array<[string, string]>): number | null => {
    const found: number[] = [];
    for (const [left, right] of plainPairs) {
      const one = profiles.get(left);
      const other = profiles.get(right);
      if (!one || !other) continue;
      const nearest = nearestBetween(one, other);
      if (nearest !== null) found.push(nearest);
    }
    return found.length === 0
      ? null
      : found.reduce((total, one) => total + one, 0) / found.length;
  };
  const small = normOf(PLAIN_SMALL);
  const tall = normOf(PLAIN_TALL);
  if (small === null && tall === null) return none;
  const lower = small ?? tall!;
  const upper = tall ?? small!;

  /*
   * Which of the two a letter belongs to, taken off the letters themselves: a
   * letter that reaches above halfway between the top of an `o` and the top of
   * an `O` is being spaced as a capital, whatever else it is.
   */
  const topOf = (name: string) => {
    const one = drawn.find((letter) => letter.name === name);
    return one ? contoursBounds(one.contours).yMax : null;
  };
  const xTop = topOf("o") ?? topOf("n");
  const capTop = topOf("O") ?? topOf("H");
  const line = xTop !== null && capTop !== null ? (xTop + capTop) / 2 : Infinity;
  const isTall = new Map(
    drawn.map((one) => [one.name, contoursBounds(one.contours).yMax > line] as const),
  );
  const usualFor = (left: string, right: string): number => {
    const one = isTall.get(left) ?? false;
    const other = isTall.get(right) ?? false;
    if (one && other) return upper;
    if (!one && !other) return lower;
    return (upper + lower) / 2;
  };

  const worth = unitsPerEm * WORTH;
  const limit = unitsPerEm * LIMIT;
  /*
   * Rounded before anything is grouped, and grouped after.
   *
   * The measurement gives every letter its own number against every other, and
   * written out that way it is two hundred and fifty-one squared lines -- which
   * came to 274KB of kerning on 52KB of outlines, a font five sixths of which
   * is a table. But most of those numbers are the same number: everything that
   * ends in a stem behaves alike on its right, everything that begins with one
   * behaves alike on its left, and a font says so by putting them in a class.
   *
   * So the letters are grouped by how they behave rather than by how they look.
   * Two letters share a right class when they kern the same against every
   * letter there is, to the nearest step -- which is a stricter test than any
   * measurement of their shapes, and needs no opinion about which shapes are
   * alike.
   */
  const STEP = unitsPerEm * 0.03;
  const rows = drawn.map((left) => {
    const one = profiles.get(left.name)!;
    return drawn.map((right) => {
      const nearest = nearestBetween(one, profiles.get(right.name)!);
      if (nearest === null) return 0;
      const move = (nearest - usualFor(left.name, right.name)) * SHARE;
      if (Math.abs(move) < worth) return 0;
      return -Math.round(Math.max(-limit, Math.min(limit, move)) / STEP) * STEP;
    });
  });

  const group = (vectorOf: (index: number) => number[]): Map<string, number[]> => {
    const found = new Map<string, number[]>();
    for (let index = 0; index < drawn.length; index++) {
      const key = vectorOf(index).join(",");
      const kept = found.get(key);
      if (kept) kept.push(index);
      else found.set(key, [index]);
    }
    return found;
  };
  const lefts = [...group((index) => rows[index]).values()];
  const rights = [...group((index) => rows.map((row) => row[index])).values()];

  const members = (indexes: number[]) => indexes.flatMap((at) => family.get(drawn[at].name)!);
  const classes: KernClass[] = [];
  for (const left of lefts) {
    for (const right of rights) {
      const value = Math.round(rows[left[0]][right[0]]);
      if (value === 0) continue;
      classes.push({
        id: `k${classes.length}`,
        name: `${drawn[left[0]].name} ${drawn[right[0]].name}`,
        left: members(left),
        right: members(right),
        value,
      });
    }
  }
  return { pairs: [], classes };
}
