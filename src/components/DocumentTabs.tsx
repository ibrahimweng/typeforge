/**
 * The fonts that are open, as a strip you can move between.
 *
 * Under the toolbar and above everything else, which is where every
 * application that holds more than one document at a time puts them. The row
 * of view tabs a few pixels above says which screen you are looking at *this*
 * font through; this one says which font. They are two different questions and
 * the order they are asked in matters -- a document contains its views, so the
 * document comes first.
 *
 * Shown only when there is more than one. A lone tab is a label that answers a
 * question nobody asked, above the one screen a beginner sees first, and the
 * last font never closes so it would also carry a cross that does nothing.
 * What the strip is for is the moment there are two.
 */

import type * as React from "react";

import { store, useAppState } from "@/state/useStore";
import { DOCUMENT_KEYS, documentKey } from "@/keys/useAppKeys";
import { cn } from "@/cn";

export function DocumentTabs(): React.JSX.Element | null {
  const state = useAppState();
  if (state.open.length < 2) return null;

  return (
    /*
      `role="group"` and `aria-pressed`, not `role="tablist"`.

      A tab role is a promise about the keyboard: arrow keys move between the
      tabs, one tab stop holds the set, Home and End go to the ends. Making the
      promise and not keeping it leaves somebody on a screen reader being told
      to press keys that do nothing, which is worse than the plain buttons
      these are. The view strip above settled this the same way for the same
      reason, and two strips in one toolbar answering to different keys would
      be its own problem.
    */
    <div
      role="group"
      aria-label="Open fonts"
      data-document-tabs
      className="flex h-8 shrink-0 items-stretch gap-px overflow-x-auto border-b border-border bg-card/40 px-2"
    >
      {state.open.map((one, at) => {
        const inFront = at === state.openAt;
        return (
          /*
            Two buttons side by side rather than a cross inside the tab. A
            button inside a button is not something a browser will build, and
            every way round it -- a div with a click handler, a nested span
            that stops the event -- is a thing the keyboard cannot reach.
          */
          <div
            key={one.id}
            className={cn(
              "group flex min-w-0 items-center self-end rounded-t-md border border-b-0 px-1",
              inFront ? "border-border bg-background" : "border-transparent hover:bg-background/60",
            )}
          >
            <button
              type="button"
              aria-pressed={inFront}
              data-document-tab={one.name}
              onClick={() => store.goToDocument(at)}
              /*
                And the key it answers to, on the tab itself.

                This is the moment a shortcut is learnt: somebody is reaching
                for the slow way to the thing it is for. A list of keys in the
                help drawer is a list somebody has to decide to go and study.
              */
              title={`${one.name} — ${documentKey(at) ?? DOCUMENT_KEYS}`}
              className={cn(
                "min-w-0 max-w-40 truncate px-1.5 py-1 text-2xs transition-colors",
                inFront ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {one.name}
            </button>
            {/*
              Always drawn rather than appearing on hover.

              A cross that is only there under the pointer is not there at all
              for a finger or for the Tab key, and "close this" is not a
              control worth hiding to save eleven pixels. It is quiet until it
              is aimed at instead, which is the same thing to look at and a
              different thing to use.
            */}
            <button
              type="button"
              aria-label={`Close ${one.name}`}
              data-close-document={one.name}
              onClick={() => store.closeDocument(at)}
              title={`Close ${one.name}`}
              className={cn(
                "shrink-0 rounded px-1 py-0.5 text-2xs leading-none transition-colors",
                "text-muted-foreground/50 hover:bg-destructive/15 hover:text-destructive",
              )}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
