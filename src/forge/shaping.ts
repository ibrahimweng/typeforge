/**
 * The two shaping layers, and which of them goes first.
 *
 * A letter is drawn, then material is taken out of it, then material is put
 * on. Or put on and then taken out -- which is not the same picture, and both
 * are wanted often enough that neither can be the only one.
 *
 * Thrown by the cut letter, a slot through the face shows as a slot through
 * its shadow as well, because the shadow is a picture of the letter as the
 * letter now is. Cut afterwards, the face and its shadow are one block and the
 * slot slices both, which can put a band across the shadow where the face has
 * none. The first reads as an object with a shadow; the second reads as a
 * single graphic thing that has been sliced.
 *
 * Kept here rather than in either layer, because neither of them can be asked
 * to know about the other, and because all three halves of the application
 * have to answer it the same way. A face drawn here, a font somebody opened
 * and a pile of drawings all come through this one function.
 *
 * Nothing calls it directly. `layers.ts` is the door, and it is a separate
 * file because this one reaches the cutting and the casting -- and those reach
 * the sweeper and the spine geometry, which is sixty-nine kilobytes that a
 * screen showing an uncut letter has no use for. That file has the argument.
 */

import type { Contour } from "@/font/types";
import type { Roles } from "@/font/boolean";
import { anyCast, type Cast } from "@/font/cast";
import { anyCut, type Cuts } from "@/font/cuts";
import { castInk } from "./cast";
import { breaksIn, cutInk, type CutScale, type Cutting } from "./cut";
import type { Stroke } from "./types";

export function shaped(
  ink: Contour[],
  strokes: Stroke[],
  scale: CutScale,
  cuts: Cuts | undefined,
  cast: Cast | undefined,
  roles: Roles = "winding",
): Cutting {
  const cutting = anyCut(cuts);
  const casting = anyCast(cast);
  if (!cutting && !casting) return { contours: ink };

  /*
   * Whichever layer runs second is handed an outline that came out of a
   * boolean, and a boolean states which way a counter runs. So only the first
   * of the two is told to read the roles the caller asked for -- which in the
   * imported half is `nesting`, because nothing there has promised anything.
   */
  // Where the split opens a join, the weld leaves it open, in either order.
  const breaks = cutting && casting && cast!.weld.on ? breaksIn(strokes, scale, cuts) : undefined;
  if (casting && cast!.order === "before") {
    const shadowed = castInk(ink, strokes, scale, cast!, roles, breaks);
    if (!cutting) return { contours: shadowed };
    // How far a rim grew the letter, for the breaks, which are found on the
    // skeleton and have to be told the letter is no longer the one it drew.
    return cutInk(shadowed, strokes, scale, cuts!, "winding", {
      grown: cast!.outline.on ? cast!.outline.width * Math.max(scale.stem, 1) : 0,
    });
  }

  const carved = cutting ? cutInk(ink, strokes, scale, cuts!, roles) : { contours: ink };
  if (!casting) return carved;
  return {
    ...carved,
    /*
     * Only if the cut actually ran. The breaks follow a letter's
     * strokes, and a letter brought in from a font has none, so they hand its
     * ink back as it came -- read as wound, the rim lost every letter without
     * a counter and doubled on the rest.
     */
    contours: castInk(
      carved.contours,
      strokes,
      scale,
      cast!,
      carved.contours === ink ? roles : "winding",
      breaks,
      carved.chamfered,
    ),
  };
}
