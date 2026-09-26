/**
 * Space to open the palette, and Cmd-K or Ctrl-K as well.
 *
 * Two keys rather than one, because they can do different jobs. Space is the
 * one you reach for without thinking, and it is the one that cannot be allowed
 * to fire while somebody is typing -- a space is a character, and a palette
 * that opens instead of writing one makes every text field in the application
 * unusable. Cmd-K has no such problem, so it stays, and it stays as the way out
 * of a text field: the only shortcut in an editor that should not stand aside
 * for typing is the one that gets you out of wherever you are.
 *
 * And it stands aside once more, over a letter on a canvas. Space is the hand
 * in every drawing program there has ever been, and a designer holds it to
 * move the drawing before they have thought about it -- so on the one screen
 * where that gesture means something, it is the hand's and the palette is
 * Cmd-K. Everywhere else in the application space still opens the palette,
 * because everywhere else there is nothing to pan.
 *
 * Said here rather than settled by which listener the window happens to call
 * first. Both are bound to the window, and `preventDefault` does not stop the
 * other one running -- so a race over registration order would work until
 * somebody moved a component.
 *
 * Cmd-K is read off the key rather than off the platform, which is the part
 * that is easy to get wrong: `metaKey` is Command on a Mac and the Windows key
 * on a PC, and `ctrlKey` is Control on both. Accepting either works on both
 * without asking what the machine is -- and asking is unreliable anyway, since
 * `navigator.platform` has been deprecated for years and lies about iPads on
 * purpose.
 *
 * Neither key opens anything while a modal dialog is up. The palette would
 * open behind it -- or, worse, over it, with the dialog still holding the
 * focus trap -- and a space typed at a focused button in the dialog would be
 * eaten as well. `modalOpen` is asked rather than the focus, for the reason
 * written at it: a click on the dark behind a dialog leaves the focus on the
 * body, and the body is where this listener answers from.
 *
 * And the space stands aside for any control that has the focus, not only
 * the ones typed into: a focused button, link, summary or menu item is
 * pressed with the space bar, and it is the control's key there (see
 * `interactive`). Cmd-K still opens the palette from any of them.
 */

import * as React from "react";

import { modalOpen } from "@/keys/modal";
import { interactive } from "@/keys/typing";

export function useQuickActionShortcut(
  onOpen: () => void,
  /** Whether a letter is open on a canvas, where space is the hand instead. */
  handOnCanvas = false,
): void {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never on a repeat: holding the key down should open it once, not once
      // per repeat for as long as it is held.
      if (event.repeat) return;
      // A dialog has the keyboard until it closes.
      if (modalOpen()) return;

      if (event.key === "k" || event.key === "K") {
        if (!event.metaKey && !event.ctrlKey) return;
        // Not Cmd-Shift-K or Cmd-Alt-K, which are somebody else's.
        if (event.shiftKey || event.altKey) return;
        // Chrome puts the focus in the address bar on Ctrl-K and Firefox opens
        // its search box. This is the one place worth taking that off them.
        event.preventDefault();
        onOpen();
        return;
      }

      // `code` rather than `key`, so a layout that puts something else on the
      // space bar still answers to the bar itself.
      if (event.code !== "Space" && event.key !== " ") return;
      // A modified space is somebody else's: Ctrl-Space is an input method on
      // several platforms and Shift-Space pages back up a document.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (interactive(event.target)) return;
      // The hand's, over a drawing. Cmd-K above still opens the palette there.
      if (handOnCanvas) return;
      // Otherwise the page scrolls under the palette as it opens.
      event.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen, handOnCanvas]);
}
