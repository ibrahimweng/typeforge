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

import { ready, unite } from "./boolean";
import type { Contour } from "./types";

/**
 * Merge overlapping contours in one glyph, keeping counters as holes.
 *
 * Winding has to be right on the way in: paper reads a contour that runs
 * against its surroundings as a hole, and one that runs with them as solid. Run
 * `correctDirection` first.
 */
export async function removeOverlaps(contours: Contour[]): Promise<Contour[]> {
  if (contours.filter((contour) => contour.nodes.length >= 2).length < 2) return contours;
  await ready();
  return unite(contours);
}
