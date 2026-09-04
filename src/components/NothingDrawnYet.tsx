/**
 * What every view says about a font with no letters in it.
 *
 * Five of the six said nothing. The font grid was given an empty state when
 * letters could first be added to a font; the other five were left showing
 * their furniture over nothing at all -- an empty spacing table with its
 * headings, a proof of no text, a kerning list of no pairs -- and the glyph
 * editor said "Choose a glyph in the font view", which sends somebody to the
 * one view that would then tell them to press New letter.
 *
 * One component so the answer is the same wherever you happen to be standing,
 * and so is the way out of it. Which is the whole of the argument: a person
 * who has just started a font has not chosen a view, they have arrived in
 * whichever one was last open.
 */

import type * as React from "react";

import { freeNameNear } from "@/font/library";
import { store, useAppState } from "@/state/useStore";

export function NothingDrawnYet({ what }: { what: string }): React.JSX.Element {
  const typeface = useAppState((state) => state.typeface);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-xs-plus text-muted-foreground">
        This font has no letters yet, so there is nothing to {what}.
      </p>
      <button
        type="button"
        onClick={() => typeface && store.addGlyph(freeNameNear(typeface, "newGlyph"))}
        data-add-first-glyph
        className="rounded border border-border px-2.5 py-1.5 text-2xs text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
      >
        New letter
      </button>
    </div>
  );
}
