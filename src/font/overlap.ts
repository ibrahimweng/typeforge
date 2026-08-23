/**
 * Merging overlapping contours.
 *
 * Drawing a letter as overlapping pieces is normal practice: a cedilla is drawn
 * against the C rather than fitted to it, a serif is a shape laid over a stem.
 * A font file cannot carry that. With the usual non-zero fill an overlap is
 * harmless, but under the even-odd rule some renderers apply, and in print
 * pipelines, the overlapping region drops out and leaves a hole.
 *
 * The geometry itself lives in `boolean.ts`, which the cut layer shares. This
 * is the one call the export needs and the one shape it needs it in: hand it
 * contours, wait for the library, get contours back.
 */

import { ready, unite, type Roles } from "./boolean";
import type { Contour } from "./types";

/**
 * Merge overlapping contours in one glyph, keeping counters as holes.
 *
 * How the contours state which of them is a counter has to be said, because
 * the two readings disagree on real letters and the wrong one fills a counter
 * in silently.
 *
 * By nesting, a contour is a counter if it sits inside another -- which is all
 * an outline out of a file can offer, since nothing there promised anything.
 * It is also a rule that counts, and counting goes wrong the moment a counter
 * falls inside two solids at once. The single-storey a is drawn as a ring with
 * a stem laid across it, and its counter is inside both the ring and the span
 * of the stem: two, an even number, so the counter reads as solid and the a
 * comes out a blob. Twenty-two drawings across the sixteen faces did that --
 * the Sans a and every accented one built on it, a Brush Oslash that gained
 * three fifths of its own area, a Flared D, a Typewriter registered.
 *
 * By winding, a contour is a counter if it runs against the ink, which is
 * exactly what a letter drawn by the pen already says: the sweep knows which
 * way round it laid the counter of an o because it drew it. Anything built
 * here should say `winding` and be believed; anything that arrived as an
 * outline has to be guessed at, so that is the default.
 */
export async function removeOverlaps(
  contours: Contour[],
  roles: Roles = "nesting",
): Promise<Contour[]> {
  if (contours.filter((contour) => contour.nodes.length >= 2).length < 2) return contours;
  await ready();
  return unite(contours, roles);
}
