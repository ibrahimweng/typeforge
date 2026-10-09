/**
 * What a recipe says about an end or a stroke for the soft finishes: an end
 * buried in another stroke whose join is to be rounded, a cut that is seen
 * though it is not open, an open bowl that takes the heft.
 *
 * Each says so only while the style's own field is on. Off -- on every base --
 * each hands back the very object it was given, `BUTT` itself or the
 * terminal or stroke as it was, so a letter is built from exactly what it was
 * built from before these existed.
 *
 * Sides are named against the way the stroke travels, in font units that run
 * up: an arm travelling right has its left side on top; a stem rising into
 * an arm has its left side to the left.
 */

import type { Stroke, Terminal } from "../types";
import { BUTT, type Frame, inherit, uses } from "./common";

/**
 * A butt end buried in another stroke, with the inside of its join rounded on
 * the sides named, each by that share of the style's `corner.fillet`.
 *
 * Called where the stroke is inked, as an argument to `ink` or `thin`, so the
 * corner it notes lands on that stroke's own run.
 */
export function buried(f: Frame, sides: { left?: number; right?: number }): Terminal {
  if (!((f.style.parts.corner.fillet ?? 0) > 0)) return BUTT;
  uses("corner");
  return { ...BUTT, fillet: sides };
}

/** A cut that is seen though nothing marks it open, where the end softening or tapering is on. */
export function seen(f: Frame, terminal: Terminal): Terminal {
  const { soft, taper } = f.style.parts.terminal;
  if (!((soft ?? 0) > 0 || (taper ?? 0) > 0)) return terminal;
  return { ...terminal, seen: true };
}

/** An open bowl that takes the style's `bowl.heft`, where that is on; it keeps its run. */
export function heftable(f: Frame, stroke: Stroke): Stroke {
  if (!((f.style.parts.bowl.heft ?? 0) > 0)) return stroke;
  return inherit(stroke, { ...stroke, heftable: true });
}
