/**
 * What a cast is.
 *
 * The other half of the cut layer, pointed the other way. A cut takes material
 * out of the letter after it is drawn; a cast puts material on. Both are
 * descriptions rather than drawings -- a set of switched-on operations and
 * their sizes, with no geometry in it anywhere -- and both are re-read from
 * scratch every time the letter is drawn, so everything above them still
 * reaches: change the weight and the letter is redrawn thinner and the same
 * shadow is thrown by the thinner letter.
 *
 * The name is the one the trade already uses twice over. Type was cast, and a
 * shadow is cast, and the operation that gives this layer its reason for
 * existing does both at once.
 *
 * Kept beside `cuts.ts` and in the same shape, under all three halves of the
 * application rather than inside one of them, because a font somebody opened
 * and a pile of drawings somebody made elsewhere can be cast on exactly as a
 * face drawn here can.
 */

import type { MotifShape } from "./cuts";

export type { MotifShape };

/**
 * Whether the cast is thrown by the cut letter, or the cut goes through it.
 *
 * Two different pictures, and both are wanted often enough that neither can be
 * the only one. Thrown by the cut letter, a slot through the face shows as a
 * slot through its shadow as well, which is what a shadow does: it is a
 * picture of the letter as the letter now is. Cut through afterwards, the face
 * and its shadow are one block and the slot slices both -- which can put a
 * band across the shadow where the face has none, and is the harder, more
 * graphic of the two.
 *
 * Written as when the cast happens rather than as which picture it makes,
 * because that is the thing the code has to know and the panel can say the
 * rest.
 */
export type CastOrder = "after" | "before";

export interface Cast {
  /**
   * The letter thrown along a line, and the space it passes through filled.
   *
   * A block shadow: the letter, the letter moved, and everything between. What
   * wood type and signwriting have done for as long as either has existed, and
   * the one operation here that turns a face into a different kind of object
   * rather than a variation on itself.
   *
   * Drawn as the letter copied along the line and all the copies fused, which
   * is exactly what the shape is, and which is one boolean however many copies
   * it takes -- they all go into a single union rather than being added one at
   * a time.
   */
  extrude: {
    on: boolean;
    /** How far the shadow reaches, in stem widths. */
    distance: number;
    /** Which way it is thrown, in degrees, anticlockwise from due right. */
    angle: number;
  };
  /**
   * The letter grown outwards all round.
   *
   * The opposite of the groove: the inline runs a thin pen down the middle of
   * every stroke and takes it away, and this lays a rim around the whole
   * outline and keeps it. On its own that is a heavier letter, and it earns
   * its place next to the cut layer rather than inside the pen: grown after a
   * slot has been cut, the slot narrows and its ends round over, which is a
   * thing no weight setting can do.
   */
  outline: {
    on: boolean;
    /** How far out the rim reaches, in stem widths. */
    width: number;
  };
  /**
   * Corners drawn out to a point instead of cut off.
   *
   * The chamfer's opposite, found the same way: a corner is a place where the
   * outline turns sharply, with the ink on the inside of the turn. The chamfer
   * takes a triangle off there and this puts one on, so a face can be given
   * the pulled corners of a blackletter or a spur off every junction without
   * either being drawn by hand on fifty letters.
   */
  spur: {
    on: boolean;
    /** How far past the corner the point reaches, in stem widths. */
    size: number;
  };
  /**
   * Ink piled up where two strokes run into each other.
   *
   * The break's opposite and its mirror in construction too: a join is two
   * spines passing within a stem of each other, which is a fact about how the
   * letter was built. The break cuts a gap there; this fills the corner in,
   * which is what a brush does when it changes direction without lifting.
   *
   * The one here that cannot reach a letter somebody drew elsewhere. Without
   * spines there is nothing to find a join in, and an outline alone does not
   * say which two shapes crossing at a corner were strokes.
   */
  weld: {
    on: boolean;
    /** How far the fill reaches from the join, in stem widths. */
    size: number;
  };
  /** Whether the cast is thrown by the cut letter, or the cut goes through it. */
  order: CastOrder;
}

/** A font that has had nothing put on it. */
export const NO_CAST: Cast = {
  extrude: { on: false, distance: 1.2, angle: -45 },
  outline: { on: false, width: 0.18 },
  spur: { on: false, size: 0.4 },
  weld: { on: false, size: 0.5 },
  order: "after",
};

export function noCast(): Cast {
  return {
    extrude: { ...NO_CAST.extrude },
    outline: { ...NO_CAST.outline },
    spur: { ...NO_CAST.spur },
    weld: { ...NO_CAST.weld },
    order: NO_CAST.order,
  };
}

/**
 * The operations, which is every field except the one that is a setting.
 *
 * The order is not an operation: it has no switch, it draws nothing on its
 * own, and it is a decision about how the two layers meet rather than about
 * what either of them does. So it lives on the same object -- there is nowhere
 * better for it, and a caller that has the cast has the order -- and is kept
 * out of the list everything else walks.
 */
export type CastName = Exclude<keyof Cast, "order">;

export const CAST_NAMES: CastName[] = ["extrude", "outline", "spur", "weld"];

/**
 * The one cast made out of the skeleton rather than out of the outline.
 *
 * A weld is where two spines meet, so it needs to know how the letter was
 * built and cannot reach a letter that arrived as an outline. Named here
 * rather than in the panel that mentions it, because it is a fact about the
 * operation and not about how it is described.
 */
export const FROM_SKELETON = new Set<CastName>(["weld"]);

/**
 * Whether two descriptions say the same thing about one operation.
 *
 * For the badge that marks an operation a letter holds its own version of.
 * Holding an exception is not the same as differing from it: a letter taken
 * out of the font's cast starts as a copy of it, so at the moment it is taken
 * out every operation still agrees.
 */
export function sameCast(one: Cast[CastName], other: Cast[CastName]): boolean {
  const mine = one as Record<string, unknown>;
  const theirs = other as Record<string, unknown>;
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
  return [...keys].every((key) => mine[key] === theirs[key]);
}

/** Whether anything is switched on. */
export function anyCast(cast: Cast | undefined): boolean {
  return cast !== undefined && CAST_NAMES.some((name) => cast[name].on);
}
