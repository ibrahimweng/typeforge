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

/**
 * The way back from a cross, and why it is not the key everybody knows.
 *
 * Reopening a closed tab is Cmd-Shift-T everywhere, and Cmd-Shift-T is the
 * browser's own -- it reopens the browser's tab, and a page cannot refuse it
 * or even hear it. So the same shape on the modifier this application has: the
 * hand does what it already knows and one finger lands somewhere else.
 */
export const REOPEN_KEY = "⌥⇧T";

/** Moving the tab rather than moving to it, for saying so on the tab. */
export const MOVE_KEYS = "⌥⇧← ⌥⇧→";

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
       * font either side, Alt and Shift with them to move the tab rather than
       * move to it, Alt with a number for the one in that place, and Alt and
       * Shift with T for the one you just closed. The bare number goes to a
       * view and Alt with it goes to a font, which is the same number meaning
       * the screen or the document.
       */
      if (event.altKey) {
        if (!editing || busy(event.target)) return;

        /*
         * The way back from a cross, and it comes before the guard below
         * rather than after it.
         *
         * One font open is not a reason to refuse this -- it is the commonest
         * moment for it. Somebody has just closed the other one, which is
         * exactly why there is one left and exactly why they are reaching for
         * this key.
         *
         * `code` again, and for a sharper version of the same reason: Option
         * and Shift with T on a Mac is a dead accent, not a `T`.
         */
        if (event.shiftKey && event.code === "KeyT") {
          event.preventDefault();
          store.reopenDocument();
          return;
        }
        const { open, openAt } = store.getSnapshot();
        // One font is not a set to move around, and wrapping from it would
        // land back on itself with the screen flickering to say so.
        if (open.length < 2) return;

        const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
        if (step !== 0) {
          event.preventDefault();
          /*
             Shift moves the tab rather than moving to it, which is the pairing
             every application with a strip of tabs uses and the same one a
             hand already knows from a browser.

             This chord used to be turned away on purpose, because leaving it
             unhandled had made it a second name for Alt and an arrow -- a
             chord bound by omission. It has a job now, and the guard that said
             so has become the job.

             It stops at the ends rather than wrapping, unlike moving between
             them. Going past the last tab wraps you round to the first because
             a strip has no edge to walk off; dragging a tab past the last one
             puts it last, and a tab that leapt to the other end instead would
             be a hand that overshot losing its place entirely.
          */
          if (event.shiftKey) {
            store.moveDocument(openAt, Math.min(open.length - 1, Math.max(0, openAt + step)));
            return;
          }
          // Round rather than stopping at the ends, as every tab strip does.
          store.goToDocument((openAt + step + open.length) % open.length);
          return;
        }
        // Nothing else on Alt wants Shift.
        if (event.shiftKey) return;

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
