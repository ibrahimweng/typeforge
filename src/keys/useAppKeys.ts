/**
 * The keys for the things done most often, so a practised hand need not aim.
 *
 * The palette already reaches everything -- space, then type what you want --
 * and that is the right answer for the five hundred controls nobody remembers
 * a key for. It is the wrong answer for saving: a person who saves forty times
 * an afternoon should not open a search to do it, and every other application
 * they use has taught their hand Cmd-S already.
 *
 * So this binds only what is done constantly and is named the same everywhere:
 * the three file actions, and the six views by number. Nothing here is a new
 * capability; each one is a second door to a button that is on screen, and each
 * of those buttons now says which key it answers to.
 *
 * Read off the key rather than off the platform, for the reason argued in
 * `useShortcut`: `metaKey` is Command on a Mac and the Windows key on a PC, and
 * accepting either works on both without asking what the machine is.
 */

import * as React from "react";

import { busy } from "@/keys/typing";
import { store, type ViewId } from "@/state/useStore";

/** The views, in the order the tabs show them, so 1 is the first tab. */
const BY_NUMBER: ViewId[] = ["grid", "glyph", "kerning", "metrics", "proof", "report"];

/** What a view's number is, for saying so on the tab. */
export function viewKey(view: ViewId): string | null {
  const at = BY_NUMBER.indexOf(view);
  return at === -1 ? null : String(at + 1);
}

/**
 * How many open fonts answer to a number of their own.
 *
 * Nine because there is no tenth key. A tenth font is still reached with the
 * arrows or by its name in the palette, which is what those are for.
 */
const NUMBERED = 9;

/** What a font's number is, for saying so on its tab. */
export function documentKey(at: number): string | null {
  return at >= 0 && at < NUMBERED ? `⌥${at + 1}` : null;
}

/** Both ways to the font beside this one, for saying so once. */
export const DOCUMENT_KEYS = "⌥← ⌥→";

export function useAppKeys({
  onSave,
  onExport,
  onOpenFile,
  editing,
}: {
  onSave: () => void;
  onExport: () => void;
  onOpenFile: () => void;
  /** Whether the six numbered views are on screen to be gone to. */
  editing: boolean;
}): void {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;

      if (event.metaKey || event.ctrlKey) {
        // Not with Shift or Alt: those are somebody else's chords, and Cmd-Alt-E
        // in particular is a browser one.
        if (event.shiftKey || event.altKey) return;
        /*
         * These three stand through typing, as Cmd-K does. A chord is never
         * mistaken for a character, and somebody halfway through naming a
         * glyph who presses Cmd-S means to save.
         */
        const run =
          event.key === "s" || event.key === "S"
            ? onSave
            : event.key === "e" || event.key === "E"
              ? onExport
              : event.key === "o" || event.key === "O"
                ? onOpenFile
                : null;
        if (!run) return;
        // Cmd-S is the browser's "save this page" and Cmd-O its file picker.
        // Both are worth taking, because both would be the wrong thing.
        event.preventDefault();
        run();
        return;
      }

      /*
       * Which font, on Alt, which is the only modifier left.
       *
       * Every key that means "the next document" in something else is the
       * browser's here and cannot be taken: Cmd-1 through Cmd-9 switch its
       * tabs, so do Ctrl-Tab and Cmd-backtick, and a page cannot refuse them.
       * Alt it can have, and Alt is already this application's modifier for
       * moving something along a strip -- the dock is reordered with Alt and
       * the arrows.
       *
       * So one rule, and it is the whole of it: Alt with the arrows for the
       * font either side, Alt with a number for the one in that place. The
       * bare number goes to a view and Alt with it goes to a font, which is
       * the same number meaning the screen or the document.
       */
      if (event.altKey) {
        if (!editing || busy(event.target)) return;
        const { open, openAt } = store.getSnapshot();
        // One font is not a set to move around, and wrapping from it would
        // land back on itself with the screen flickering to say so.
        if (open.length < 2) return;

        const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
        if (step !== 0) {
          // Round rather than stopping at the ends, as every tab strip does.
          event.preventDefault();
          store.goToDocument((openAt + step + open.length) % open.length);
          return;
        }

        /*
         * Read off `code` rather than `key`, which is the one trap here.
         *
         * Option with a digit does not produce that digit on a Mac: Option-1
         * is `¡`, Option-2 is `™`, and a handler that parsed `key` would work
         * on a PC and silently do nothing on half the machines this runs on.
         * `code` is the key that was pressed rather than the character it
         * made, and a modifier cannot change it.
         */
        const digit = /^Digit([1-9])$/.exec(event.code);
        if (!digit) return;
        const at = Number(digit[1]) - 1;
        if (at >= open.length) return;
        event.preventDefault();
        store.goToDocument(at);
        return;
      }

      /*
       * And the views by number, which is a bare key and so must stand aside
       * for anything being typed into -- a `2` in a sidebearing field is a
       * number, not a request to go to the second tab.
       *
       * Alt is not turned away here any more: the block above answers every
       * Alt press, so a guard for it would be a line that never runs.
       */
      if (!editing) return;
      if (busy(event.target)) return;
      const at = Number.parseInt(event.key, 10);
      if (!Number.isFinite(at) || at < 1 || at > BY_NUMBER.length) return;
      event.preventDefault();
      store.setView(BY_NUMBER[at - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave, onExport, onOpenFile, editing]);
}
