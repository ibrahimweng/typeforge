/**
 * The fonts that are open, as a strip you can move between and rearrange.
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

import * as React from "react";

import { store, useAppState } from "@/state/useStore";
import { DOCUMENT_KEYS, documentKey, MOVE_KEYS } from "@/keys/useAppKeys";
import { landingAmong } from "@/components/landing";
import { cn } from "@/cn";

/** How far the pointer has to travel before a press becomes a drag. */
const A_DRAG = 4;

export function DocumentTabs(): React.JSX.Element | null {
  const state = useAppState();
  const strip = React.useRef<HTMLDivElement>(null);
  /** The tab under the pointer and where it would land, while one is carried. */
  const [carrying, setCarrying] = React.useState<{ id: string; to: number } | null>(null);

  /**
   * Where the carried tab would land, asked of the tabs actually on screen.
   *
   * The same rule the dock uses down its column, handed the middles across the
   * row instead. It is in `landing.ts` rather than copied here because it is
   * the sum that was already got wrong once, in the direction that looks right
   * by hand -- and a second copy is a second chance to get it wrong.
   */
  const landingAt = React.useCallback(
    (x: number, carried: string): number => {
      const middles = state.open.flatMap((one) => {
        const tab = strip.current?.querySelector<HTMLElement>(`[data-document-slot="${one.id}"]`);
        if (!tab) return [];
        const box = tab.getBoundingClientRect();
        return [{ id: one.id, middle: box.left + box.width / 2 }];
      });
      return landingAmong(middles, carried, x);
    },
    [state.open],
  );

  if (state.open.length < 2) return null;

  const others = state.open.filter((one) => one.id !== carrying?.id);

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
      ref={strip}
      role="group"
      aria-label="Open fonts"
      data-document-tabs
      className="flex h-8 shrink-0 items-stretch gap-px overflow-x-auto border-b border-border bg-card/40 px-2"
    >
      {state.open.map((one, at) => {
        const inFront = at === state.openAt;
        /*
          The line goes down the left of whichever tab the carried one would
          displace, which is the `to`th of the tabs that are not it. Drawn on
          the tab rather than between them because there is nothing between
          them to draw on, and a gap of one pixel is not somewhere a line can
          be seen.
        */
        const wouldLandHere =
          carrying !== null && carrying.id !== one.id && others[carrying.to]?.id === one.id;
        return (
          /*
            Two buttons side by side rather than a cross inside the tab. A
            button inside a button is not something a browser will build, and
            every way round it -- a div with a click handler, a nested span
            that stops the event -- is a thing the keyboard cannot reach.
          */
          // biome-ignore lint/a11y/noStaticElementInteractions: the middle button is a pointer convenience over the cross beside it, which is a real button and the keyboard path.
          <div
            key={one.id}
            data-document-slot={one.id}
            data-document-carried={carrying?.id === one.id ? "true" : undefined}
            /*
              The middle button closes the tab, as it does in every browser
              anybody has this strip open in.
            */
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              store.closeDocument(at);
            }}
            /*
              And the press is refused, which is the half that is easy to miss.

              A middle press is what opens the scroll-anywhere widget on
              Windows and Linux, and the browser decides that on `mousedown` --
              `auxclick` comes afterwards and is far too late to stop it. So
              without this the tab closes *and* the page is left in autoscroll,
              with a compass stuck under the pointer. Refused on `mousedown`
              rather than on `pointerdown`, because preventing a pointer event
              does not prevent the mouse event that follows it.
            */
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault();
            }}
            className={cn(
              "group flex min-w-0 items-center self-end rounded-t-md border border-b-0 px-1",
              inFront ? "border-border bg-background" : "border-transparent hover:bg-background/60",
              carrying?.id === one.id && "opacity-50",
              wouldLandHere && "border-l-2 border-l-accent",
            )}
          >
            <button
              type="button"
              aria-pressed={inFront}
              data-document-tab={one.name}
              onClick={() => store.goToDocument(at)}
              onPointerDown={(event) => {
                /*
                  A drag that does not start until the pointer has moved, which
                  is what keeps the same press able to be a click.

                  The name is both the handle and the button that goes to the
                  font, so a press that goes nowhere has to reach the click
                  handler untouched -- and a drag that began on the first pixel
                  of jitter would flicker a tab to half opacity every time
                  somebody switched font.
                */
                if (event.button !== 0) return;
                const from = event.clientX;
                let carried = false;
                /*
                  Where it would land, kept here rather than read back out of
                  the state on the way down.

                  The obvious way to write the drop is to reach into
                  `setCarrying` for the last landing and move the tab from
                  inside the updater. React calls an updater twice under
                  StrictMode, on purpose, to catch exactly this -- and moving a
                  tab is a relative operation, so twice put it back where it
                  started. The tab was carried, the line was drawn, the drop
                  did nothing, and it would have done nothing only in
                  development: a production build calls the updater once and
                  the bug disappears. The state here is for drawing; the
                  decision is a plain local.
                */
                let to = at;
                const carry = (moving: PointerEvent): void => {
                  if (!carried && Math.abs(moving.clientX - from) < A_DRAG) return;
                  carried = true;
                  to = landingAt(moving.clientX, one.id);
                  setCarrying({ id: one.id, to });
                };
                const drop = (): void => {
                  window.removeEventListener("pointermove", carry);
                  window.removeEventListener("pointerup", drop);
                  setCarrying(null);
                  if (carried) store.moveDocument(at, to);
                };
                window.addEventListener("pointermove", carry);
                window.addEventListener("pointerup", drop);
              }}
              /*
                And the keys it answers to, on the tab itself.

                This is the moment a shortcut is learnt: somebody is reaching
                for the slow way to the thing it is for. A list of keys in the
                help drawer is a list somebody has to decide to go and study.
              */
              title={`${one.name} — ${documentKey(at) ?? DOCUMENT_KEYS}. Drag to reorder, or ${MOVE_KEYS}.`}
              className={cn(
                "min-w-0 max-w-40 cursor-grab truncate px-1.5 py-1 text-2xs transition-colors active:cursor-grabbing",
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
              /*
                The other way to do the same thing, said on the control that
                does it. A middle click is a habit somebody either has or does
                not, and this is where they would find out they have it.
              */
              title={`Close ${one.name} — or middle-click the tab`}
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
