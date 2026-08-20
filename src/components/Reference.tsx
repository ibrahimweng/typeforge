/**
 * Somebody else's letter, behind yours.
 *
 * The oldest way of learning to draw type and still the most useful: put a
 * letter you admire underneath the one you are drawing, at the same size, and
 * the differences stop being a matter of opinion. Where your bowl is heavier,
 * where your shoulder springs later, where your x-height is not where you
 * thought it was -- all of it is visible in a second and none of it is visible
 * any other way.
 *
 * Scaled by the em rather than fitted to the letter, because the point is the
 * comparison: a reference stretched to match what you drew would agree with
 * you about everything and teach you nothing. The two fonts are set to the
 * same body size and left to disagree.
 *
 * Nothing is taken. This draws the reference and forgets it; it is a picture,
 * not a source.
 */

import * as React from "react";

import { contoursToSvgPath } from "@/font/geometry";
import { glyphFor } from "@/library/measure";
import type { LoadedFont } from "@/state/useLibrary";

export function Reference({
  loaded,
  character,
  unitsPerEm,
}: {
  loaded: LoadedFont | null;
  character: string;
  /** The em of the font being drawn, which the reference is scaled into. */
  unitsPerEm: number;
}): React.JSX.Element | null {
  const drawn = React.useMemo(() => {
    if (!loaded) return null;
    const glyph = glyphFor(loaded.typeface, character);
    if (!glyph || glyph.contours.length === 0) return null;
    return {
      d: contoursToSvgPath(glyph.contours),
      scale: unitsPerEm / (loaded.typeface.unitsPerEm || unitsPerEm),
    };
  }, [loaded, character, unitsPerEm]);

  if (!drawn) return null;
  return (
    <g transform={`scale(${drawn.scale})`} data-reference={character} aria-hidden>
      <path d={drawn.d} fill="var(--muted-foreground)" fillRule="nonzero" opacity={0.28} />
    </g>
  );
}
