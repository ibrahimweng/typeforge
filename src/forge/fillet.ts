/**
 * Inside roundings: where a stroke leaves another it is buried in, and on the
 * inside of a corner one stroke turns.
 *
 * Asked for by `parts.corner.fillet`, which no base sets, through the hints a
 * recipe puts on a buried end (`Terminal.fillet`) or a crossing
 * (`Stroke.crossFillets`) only while that field is on. A letter of any
 * existing face never reaches anything here.
 */

import type { Contour } from "@/font/types";
import type { Style } from "./style";
import type { Stroke } from "./types";

/**
 * The rounding contours one stroke adds where its hinted ends leave the
 * strokes around it (`others`, already swept), each its own overlapping
 * contour in the stroke's own run, as a serif is.
 *
 * Not built yet: none.
 */
export function filletsFor(
  _stroke: Stroke,
  _style: Style,
  _swept: Contour[],
  _others: Contour[],
): Contour[] {
  return [];
}

/**
 * A stroke told how far the inside of its own corners is rounded
 * (`Stroke.inside`), where `parts.corner.fillet` is above nought.
 *
 * Not built yet: hands back the stroke it was given.
 */
export function withInside(stroke: Stroke, _style: Style): Stroke {
  return stroke;
}
