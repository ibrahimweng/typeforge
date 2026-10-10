/**
 * A dressed stroke made ready for the sweep's soft finishes: told how far the
 * inside of its corners is rounded, and how heavy its bowl's foot is.
 *
 * Applied to every stroke `dress` hands back. Where the style switches none
 * of those on -- every base -- it is the very same stroke, not a copy.
 */

import { withInside } from "./fillet";
import { withHeft } from "./heft";
import type { Style } from "./style";
import type { Stroke } from "./types";

export function prepared(stroke: Stroke, style: Style): Stroke {
  return withHeft(withInside(stroke, style), style);
}
