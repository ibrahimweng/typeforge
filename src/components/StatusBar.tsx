/**
 * The strip along the bottom: the zoom, what is open, and what is in hand.
 *
 * The zoom is the reason this exists. It was a number painted in the corner of
 * the canvas, and it was only ever a number: you could read that you were at
 * 340% and there was no way to say 200. The wheel was the whole of the
 * interface to it, so getting back to a round figure meant rolling until it
 * said one. Every drawing program has had a zoom you can type into for thirty
 * years, and this is that, with the way back to the fitted view beside it.
 *
 * A hundred per cent here is the fitted letter, which is where every letter
 * opens. That is what the corner already showed and it is the honest reading
 * for type: a font has no natural size in pixels, so "actual size" would mean
 * whatever the window happens to be tall.
 *
 * The rest of the strip is what a status bar is for. What document is open,
 * and what tool the next click will use. Both were readable already -- the
 * font's name in the toolbar, the tool as a lit button in the rail -- and both
 * are worth saying in words in the one place a person looks to answer "where
 * am I".
 *
 * It is drawn in the shell rather than by a view, so it does not come and go.
 * What it shows changes; that it is there does not.
 */

import type * as React from "react";

import { NumberField } from "@/components/NumberField";
import { toolInfo } from "@/font/toolset";
import { fitCanvas, useFraming, zoomTo } from "@/state/framing";
import { store, useAppState } from "@/state/useStore";

/** The range the wheel already allowed, so typing and rolling agree. */
const LEAST = 10;
const MOST = 2_400;

export function StatusBar(): React.JSX.Element {
  const { zoom } = useFraming();
  const typeface = useAppState((state) => state.typeface);
  const tool = useAppState((state) => state.tool);
  const view = useAppState((state) => state.view);
  const glyphName = useAppState((state) => state.selectedGlyph);

  const letters = typeface?.glyphs.length ?? 0;

  return (
    <footer
      data-status-bar
      className="flex min-h-7 shrink-0 items-center gap-x-4 border-t border-border px-3 py-1 text-2xs text-muted-foreground"
    >
      {zoom === null ? (
        // No canvas on screen, so no zoom. Saying nothing rather than showing
        // the last letter's, which would be a number about a screen you left.
        <span className="w-28" />
      ) : (
        <span className="flex items-center gap-1" data-zoom>
          <NumberField
            label="Zoom"
            value={Math.round(zoom * 100)}
            className="w-14"
            onCommit={(next) => zoomTo(Math.min(MOST, Math.max(LEAST, next)) / 100)}
          />
          <span>%</span>
          <button
            type="button"
            onClick={fitCanvas}
            data-fit-canvas
            title="Put the letter back in the middle at the size it opened"
            className="rounded px-1.5 py-0.5 transition-colors hover:bg-card hover:text-foreground"
          >
            Fit
          </button>
        </span>
      )}

      <span className="h-3 w-px shrink-0 bg-border" />

      <span className="min-w-0 truncate" data-status-document>
        {typeface
          ? `${typeface.meta.familyName} — ${letters.toLocaleString()} ${letters === 1 ? "letter" : "letters"}`
          : "Nothing open"}
      </span>

      <span className="ml-auto flex shrink-0 items-center gap-x-4">
        {typeface && view === "glyph" && store.glyph(glyphName) && (
          <span data-status-glyph>{glyphName}</span>
        )}
        {/*
          The tool, in words, at the end of the strip.

          The rail says which one is in hand by lighting its button, which is
          fourteen pixels of icon and is the only place it is said. Somebody
          who took a tool up with a key rather than by pointing at it has no
          reason to be looking there at all.
        */}
        <span data-status-tool>{toolInfo(tool).name}</span>
      </span>
    </footer>
  );
}
