/**
 * The weight while a hand is still on its slider.
 *
 * Weighing a letter is a true offset of its outline (`embolden.ts`), and on an
 * opened font that is a few milliseconds a letter: a screenful of them is a
 * third of a second, which is fine once and no good at all for every step of
 * a drag or every press of an arrow key. What the page needs between those
 * steps is the letter at about the weight asked for, now, and the exact one
 * when the hand comes off.
 *
 * So each letter keeps the last few weights it was exactly drawn at, and a
 * weight in the middle of a gesture is drawn between the two nearest of them.
 * Weighing moves every point of a letter and adds none -- the same points come
 * out as went in, which is what a variable font is built on -- so the letter
 * between two weights is every point part of the way from one to the other,
 * the way a variable font draws its in-between weights. A weight past the
 * furthest one known is carried on from the two nearest, but not far: past
 * twice as far out as that one, the letter is weighed exactly again and that
 * becomes the furthest.
 *
 * Only ever for the parameters the store has marked as a draft, and only ever
 * for the family weight. Everything else -- an export, a check, the letters
 * once the gesture is over -- is drawn exactly, and what a draft draws is
 * never kept as if it were.
 */

import type { Contour, GlyphNode, GlyphParams, Vec2 } from "./types";

const drafts = new WeakSet<GlyphParams>();

/** Say that these family parameters are a step in a gesture, not where it ends. */
export function markDraft(params: GlyphParams): void {
  drafts.add(params);
}

/** Whether these parameters were marked as a step in a gesture. */
export function isDraft(params: GlyphParams): boolean {
  return drafts.has(params);
}

/** A letter as it was exactly drawn at one weight. */
export interface Anchor {
  weight: number;
  contours: Contour[];
  advance: number;
}

/**
 * How many weights a letter remembers. Two either side of a gesture and one to
 * spare; each is only a reference to an outline already drawn.
 */
const KEPT = 4;

/** How far past the furthest weight known a draft may carry on. */
const REACH = 2;

/** The weights one letter was exactly drawn at, with everything else the same. */
export interface Anchors {
  key: string;
  list: Anchor[];
}

/** Remember a letter exactly drawn at a weight, forgetting the oldest past a few. */
export function remember(anchors: Anchors, anchor: Anchor): void {
  const at = anchors.list.findIndex((one) => one.weight === anchor.weight);
  if (at >= 0) anchors.list.splice(at, 1);
  anchors.list.push(anchor);
  if (anchors.list.length > KEPT) anchors.list.shift();
}

/** Whether two drawings have the same contours, points and handles, in order. */
function alike(one: Contour[], other: Contour[]): boolean {
  if (one.length !== other.length) return false;
  for (let c = 0; c < one.length; c++) {
    const a = one[c].nodes;
    const b = other[c].nodes;
    if (a.length !== b.length || one[c].closed !== other[c].closed) return false;
    for (let n = 0; n < a.length; n++) {
      if (!a[n].handleIn !== !b[n].handleIn || !a[n].handleOut !== !b[n].handleOut) return false;
    }
  }
  return true;
}

function mix(a: Vec2, b: Vec2, share: number): Vec2 {
  return { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share };
}

/** Every point `share` of the way from one drawing to the other; past 1 carries on. */
function between(one: Contour[], other: Contour[], share: number): Contour[] {
  return one.map((contour, c) => ({
    closed: contour.closed,
    nodes: contour.nodes.map((node, n): GlyphNode => {
      const far = other[c].nodes[n];
      return {
        ...node,
        point: mix(node.point, far.point, share),
        handleIn: node.handleIn && far.handleIn ? mix(node.handleIn, far.handleIn, share) : null,
        handleOut:
          node.handleOut && far.handleOut ? mix(node.handleOut, far.handleOut, share) : null,
      };
    }),
  }));
}

/**
 * The letter at `weight` from what is remembered, or null where it has to be
 * weighed exactly: nothing known on that side of the unweighted letter, a
 * weight too far past what is, or drawings that do not line up point for point.
 * `plain` is the letter with no weight at all, asked for only if it is needed.
 */
export function drafted(
  anchors: Anchors,
  weight: number,
  plain: () => Anchor,
): { contours: Contour[]; advance: number } | null {
  const exact = anchors.list.find((one) => one.weight === weight);
  if (exact) return exact;
  // Only weights on the same side of nought, and nought itself: a letter made
  // lighter and one made bolder are not two ends of one straight line.
  const side = anchors.list
    .filter((one) => Math.sign(one.weight) === Math.sign(weight))
    .sort((a, b) => Math.abs(a.weight) - Math.abs(b.weight));
  if (side.length === 0) return null;
  const far = Math.abs(weight);
  let low: Anchor | null = null;
  let high: Anchor | null = null;
  for (const one of side) {
    if (Math.abs(one.weight) <= far) low = one;
    else if (!high) high = one;
  }
  let from: Anchor;
  let to: Anchor;
  if (high) {
    to = high;
    from = low ?? plain();
  } else {
    // Past the furthest known: carried on from the two nearest, not far.
    to = side[side.length - 1];
    if (far > Math.abs(to.weight) * REACH) return null;
    from = side.length > 1 ? side[side.length - 2] : plain();
  }
  if (from.weight === to.weight || !alike(from.contours, to.contours)) return null;
  const share = (weight - from.weight) / (to.weight - from.weight);
  return {
    contours: between(from.contours, to.contours, share),
    advance: from.advance + (to.advance - from.advance) * share,
  };
}
