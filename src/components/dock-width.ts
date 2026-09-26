/**
 * What a resize of the dock should remember, given what it was shown at.
 *
 * The dock is drawn at the width somebody chose or at a ceiling taken from the
 * window, whichever is less -- and `layout.ts` is firm that the ceiling is a
 * limit on what is drawn, not a correction to what was chosen, so a width set
 * on a big screen comes back when the window is big enough again. The edge
 * broke that. A drag or an arrow key started from the width on screen, which
 * on a small window is the ceiling, and wrote the result back as the chosen
 * width: one nudge on a laptop and the four hundred pixels set on the desk
 * monitor were gone for good.
 *
 * So the proposal -- what is on screen plus however far the edge moved -- is
 * only taken as the new choice when it is under the ceiling, which is when it
 * is a width that will actually be seen. At or over it, the person is pushing
 * against the ceiling rather than choosing something new, and whichever is
 * larger of the remembered width and the proposal is kept. Narrowing still
 * answers from the first pixel, because it starts from what is on screen and
 * not from a remembered width a hundred pixels off the edge of it.
 */

import { widthWithin } from "@/state/layout";

export function widthToRemember(remembered: number, windowWidth: number, proposed: number): number {
  const ceiling = widthWithin(Number.POSITIVE_INFINITY, windowWidth);
  return proposed >= ceiling ? Math.max(remembered, proposed) : proposed;
}
