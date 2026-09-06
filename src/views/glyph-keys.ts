/**
 * The keys this view answers, which are the ones about a letter.
 *
 * Nudging a selection, deleting points, closing an outline, copying a drawing
 * from one letter into another, and undo.
 *
 * Listened for on the window, and answered only when the canvas has the focus
 * or nothing does. The listener is on the window because a key pressed at a
 * canvas has to reach a handler that also knows about the store, and moving it
 * onto the element would not change which keys are answered. What changed is
 * the answering.
 *
 * It used to answer wherever the focus was, and the cost of that was not a
 * detail. `Tab` is bound here to walk the points of an outline, it called
 * `preventDefault`, and the only focus it checked for was an `input` or a
 * `textarea` -- so with a letter open, a person on a keyboard who had focused
 * the Open button and pressed Tab did not move to the next control. They did
 * not move at all. Tab is the one key a keyboard user cannot do without, and
 * every control on the page was behind it. That is a keyboard trap, in the
 * sense the accessibility guidelines use the phrase, and it applied to the
 * whole application whenever this view was on screen.
 *
 * Tab was the whole of it, and that is worth writing down because the guard
 * looks far leakier than it was. A slider is a `div` with a role, so it reads
 * as something the old check would miss -- and it was not missed, because what
 * actually takes the focus is the hidden `input type=range` inside it. Arrows
 * pressed at a focused button did not move a picked point either, when that
 * was measured. Every other key here was already going where it should.
 *
 * So this is one fix rather than a sweep. The rule is now that these keys
 * belong to the canvas, which fixes Tab and states the rest in terms of focus
 * rather than of tag names -- and that is what makes it hold for the next
 * control somebody adds rather than for the two that were listed.
 *
 * `document.body` counts as the canvas here, because that is where the focus
 * sits before anything has been clicked and a fresh page should still answer a
 * key. And the canvas takes focus when it is pointed at, so clicking a point
 * and then pressing an arrow -- which is the reason this was ever bound to the
 * window -- works as it did.
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

/**
 * What is picked, as a sentence rather than as a highlight on a drawing.
 *
 * A point is announced by where it is, because that is what identifies it: a
 * letter has no names for its points and "point 4 of 16" tells somebody
 * walking an outline nothing about the shape they are walking. Coordinates
 * do, and they are the same numbers the panel shows.
 */
export function describeSelection(glyph: Glyph | null, selected: ReadonlySet<string>): string {
  if (!glyph || selected.size === 0) return "No points picked.";
  if (selected.size > 1) return `${selected.size} points picked.`;
  const [key] = selected;
  const ref = parseNodeKey(key);
  const node = glyph.contours[ref.contour]?.nodes[ref.node];
  if (!node) return "1 point picked.";
  // The node's own word for what it is: corner, smooth or tangent.
  const kind = node.type.charAt(0).toUpperCase() + node.type.slice(1);
  const of = glyph.contours[ref.contour].nodes.length;
  return (
    `${kind} point ${ref.node + 1} of ${of}, path ${ref.contour + 1}` +
    `, at ${Math.round(node.point.x)}, ${Math.round(node.point.y)}.`
  );
}

/**
 * Whether a key pressed now was meant for the letter.
 *
 * True at the canvas itself, and true when the focus is nowhere in
 * particular -- `document.body`, which is where it sits until something is
 * clicked. False at every button, slider, link and field, which are all
 * things with their own idea of what an arrow or a Tab does.
 */
function meantForTheCanvas(canvas: HTMLCanvasElement | null): boolean {
  const focused = document.activeElement;
  if (focused === null || focused === document.body) return true;
  return focused === canvas;
}

export function useGlyphKeys(within: {
  glyph: Glyph | null;
  state: AppState;
  gesture: Gestures;
  /** The drawing surface, so a key can ask whether it was meant for it. */
  canvas: React.RefObject<HTMLCanvasElement | null>;
}): void {
  const { glyph, state, gesture, canvas } = within;
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
      if (!meantForTheCanvas(canvas.current)) return;

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
  }, [glyph, state.selectedNodes, redraw, refreshPhase, canvas]);
}
