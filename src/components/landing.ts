/**
 * Where a dragged thing lands in the list it was dragged out of.
 *
 * Counted among the *other* items rather than among all of them, which is the
 * detail that makes it right in both directions. Asked as "which item would it
 * sit before", something dragged forwards lands one place short, because
 * taking it out of the list shifts everything after it back by one. Asked as
 * "how many of the others are before the pointer", the answer is the index it
 * should occupy once it has been taken out, and the same arithmetic works
 * whichever way it is being dragged.
 *
 * Separated from reading the page so it can be tested without one. The rule is
 * four lines and it was wrong the first time, in the direction that is harder
 * to notice: dragging upwards looked right, so a hand test would have passed.
 *
 * It has no axis. The dock hands it the middles of its panel headers down the
 * column and the pointer's `y`; the tab strip hands it the middles of its tabs
 * across the row and the pointer's `x`. One rule, tested once -- because the
 * alternative is a second copy of the sum that was already got wrong, and no
 * reason to expect the copy to be got right.
 */
export function landingAmong(
  middles: ReadonlyArray<{ id: string; middle: number }>,
  carried: string,
  along: number,
): number {
  let before = 0;
  for (const one of middles) {
    if (one.id !== carried && along > one.middle) before++;
  }
  return before;
}
