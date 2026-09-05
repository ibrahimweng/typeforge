/**
 * The keys this view answers, which are the ones about a letter.
 *
 * Nudging a selection, deleting points, closing an outline, copying a drawing
 * from one letter into another, and undo. Bound to the window rather than to
 * the canvas, because a person who has just clicked a point and then pressed
 * an arrow has not necessarily left focus where the canvas can see it -- and
 * because the fields that should swallow a keystroke are checked for by name
 * at the top instead.
 *
 * Two things are handed in rather than done here. Redrawing, because these
 * edits mutate the letter where React cannot see them; and saying what the
 * tool would do now, because finishing an outline with Escape changes what the
 * next click does and the sentence under the canvas has to catch up. Both come
 * off the gesture, which is where the pointer's version of each already lives.
 */

import * as React from "react";

import type { Glyph, Vec2 } from "@/font/types";
import { store, type AppState } from "@/state/useStore";

import { deleteSelectedNodes } from "./glyph-edits";
import { parseNodeKey } from "./glyph-pointer";
import type { Gestures } from "./glyph-gestures";

export function useGlyphKeys(within: {
  glyph: Glyph | null;
  state: AppState;
  gesture: Gestures;
}): void {
  const { glyph, state, gesture } = within;
  /*
   * Pulled out by name so the effect can list them.
   *
   * Both are stable -- `redraw` is a `useReducer` dispatch and `refreshPhase`
   * is a `useCallback` with no dependencies -- so naming them costs no extra
   * binding of the listener. Reading them off `gesture` inside the effect
   * instead would leave the effect depending on something it does not say.
   */
  const { redraw, refreshPhase } = gesture;

  // Keyboard: nudge the selection, delete points, undo and redo.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!glyph) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      /*
       * Carrying a drawing from one letter to another, on the keys everything
       * else uses for it. Before these two there was no way at all: an `m`
       * could not be started from an `n`, which is how an `m` is started.
       *
       * Above the selection guard below, because copying the whole letter is
       * what happens when nothing is picked and pasting needs nothing picked
       * at all.
       */
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        store.copyOutlines(glyph.name);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        store.pasteOutlines(glyph.name);
        return;
      }
      /*
       * The two keys that finish an outline, and the reason a session used to
       * end with a list full of two-point stubs.
       *
       * There was no way to stop drawing. Not Escape, not Enter, not picking up
       * another tool -- the only exit was a click inside seven pixels of the
       * first point, and every attempt that missed or was thought better of
       * stayed in the letter for ever. Escape finishes and leaves it open;
       * Enter finishes by closing it. Both drop an outline too short to be one.
       */
      if (event.key === "Escape" || event.key === "Enter") {
        /*
         * A stroke being written finishes on the same two keys, for the same
         * reason and with the same difference between them: Escape leaves the
         * ends loose and Enter closes the stroke into a ring. Taken first,
         * because while a stroke is being written there is no open outline for
         * `finishOutline` to find and the key would do nothing at all.
         */
        if (store.writing) {
          if (event.key === "Enter") store.closeStroke(glyph.name);
          else store.finishStroke();
          event.preventDefault();
          redraw();
          refreshPhase();
          return;
        }
        if (store.finishOutline(glyph.name, event.key === "Enter")) {
          event.preventDefault();
          redraw();
          // The line has to catch up here too: finishing changes what the next
          // click does, and a person who has just pressed Escape is looking
          // straight at it.
          refreshPhase();
        }
        return;
      }

      /*
       * Select-all and Tab, which have to come before the guard below: both are
       * ways of picking points when none are picked, and the guard exists for
       * the operations that need something to work on.
       */
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        store.selectAllNodes(glyph.name);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        store.stepSelection(glyph.name, event.shiftKey ? -1 : 1);
        return;
      }

      if (state.selectedNodes.size === 0) return;

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteSelectedNodes(glyph, state.selectedNodes);
        return;
      }
      const nudge: Record<string, Vec2> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: 1 },
        ArrowDown: { x: 0, y: -1 },
      };
      const step = nudge[event.key];
      if (!step) return;
      event.preventDefault();
      // Shift nudges in larger jumps, the usual convention.
      const amount = event.shiftKey ? 10 : 1;
      const refs = [...state.selectedNodes].map(parseNodeKey);
      store.editGlyph(glyph.name, "Nudge points", (editing) => {
        for (const ref of refs) {
          const node = editing.contours[ref.contour]?.nodes[ref.node];
          if (!node) continue;
          const dx = step.x * amount;
          const dy = step.y * amount;
          node.point = { x: node.point.x + dx, y: node.point.y + dy };
          if (node.handleIn) node.handleIn = { x: node.handleIn.x + dx, y: node.handleIn.y + dy };
          if (node.handleOut)
            node.handleOut = { x: node.handleOut.x + dx, y: node.handleOut.y + dy };
        }
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [glyph, state.selectedNodes, redraw, refreshPhase]);
}
