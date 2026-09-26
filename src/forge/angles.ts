/**
 * Angles brought back within half a turn, in one place.
 *
 * Every arc the forge and the quill build is worked out the same way: take the
 * angle to where it starts and the angle to where it ends, subtract, and bring
 * the difference back within half a turn so the arc goes the short way round.
 * That last step was written out by hand at every one of those places -- eight
 * of them in radians and two more in degrees -- and not all the same way.
 * Most let the answer land on either end of the range; two did not, and those
 * two are not a slip. When the two ends of an arc are exactly opposite each
 * other there is no short way round, and which way it goes is then the whole
 * answer: the script's joins read the sign of the result to decide which way
 * to bend, and a half turn that came out as either sign depending on which
 * side of it the arithmetic landed would bend either way. The places that care
 * about that say so by asking for `halfOpen`; the others keep what they always
 * had, which is not worth changing under outlines that are compared exactly.
 *
 * The loops are kept as loops rather than replaced by a remainder, because a
 * remainder rounds differently in the last place and every outline in the
 * suite is compared exactly. What this module changes is where the loop is
 * written, not what it does.
 *
 * It imports nothing, on purpose. The quill and the forge both reach for it,
 * and a leaf with no imports cannot drag anything into a first load that was
 * not already there -- see the notes on `src/forge` in vite.config.ts.
 */

/** A whole turn, in radians. */
export const TAU = Math.PI * 2;

/**
 * An angle in radians brought within half a turn of nought.
 *
 * By default the result lies in `[-π, π]`, and an angle already on either end
 * is left there. With `halfOpen` it lies in `(-π, π]`, so exactly half a turn
 * either way always comes out positive -- which is the answer for any caller
 * that goes on to ask which *way* the angle turns.
 */
export function wrapAngle(angle: number, halfOpen = false): number {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= TAU;
  if (halfOpen) {
    while (wrapped <= -Math.PI) wrapped += TAU;
  } else {
    while (wrapped < -Math.PI) wrapped += TAU;
  }
  return wrapped;
}

/**
 * The angle `finish` moved by whole turns until it is within half a turn of
 * `start`, so that an arc from one to the other goes the short way round.
 *
 * Not the same as `start + wrapAngle(finish - start)`, though it means the
 * same thing: this moves `finish` itself, which is what the joins and the pen
 * drawn at a corner always did, and so it rounds exactly as they did.
 */
export function nearestTurn(start: number, finish: number): number {
  let moved = finish;
  while (moved - start > Math.PI) moved -= TAU;
  while (moved - start < -Math.PI) moved += TAU;
  return moved;
}

/**
 * A turn in degrees brought within half a turn, `[-180, 180]` -- unless it is
 * a whole turn or more already, which is taken as written.
 *
 * That exception is what the pen angle means by a turn. Blending a pen from
 * 350 degrees to 10 turns it twenty degrees and not three hundred and forty,
 * but somebody who typed a difference of a full circle or more meant the pen to
 * go all the way round, and wrapping it would give them nothing.
 */
export function wrapDegrees(turn: number): number {
  if (Math.abs(turn) >= 360) return turn;
  let wrapped = turn;
  while (wrapped > 180) wrapped -= 360;
  while (wrapped < -180) wrapped += 360;
  return wrapped;
}
