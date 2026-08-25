/**
 * Cmd-K on a Mac, Ctrl-K everywhere else.
 *
 * Read off the key rather than off the platform, which is the part that is
 * easy to get wrong: `metaKey` is Command on a Mac and the Windows key on a
 * PC, and `ctrlKey` is Control on both. Accepting either means the shortcut
 * works on both without asking what the machine is -- and asking is unreliable
 * anyway, since `navigator.platform` has been deprecated for years and lies
 * about iPads on purpose.
 *
 * Deliberately still fires while a text field has the focus. Every other
 * shortcut in an editor has to stand aside for typing; this one is how you get
 * out of wherever you are, so it is the one that should not.
 */

import * as React from "react";

export function useQuickActionShortcut(onOpen: () => void): void {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "k" && event.key !== "K") return;
      if (!event.metaKey && !event.ctrlKey) return;
      // Not Cmd-Shift-K or Cmd-Alt-K, which are somebody else's.
      if (event.shiftKey || event.altKey) return;
      // Chrome puts the focus in the address bar on Ctrl-K, and Firefox opens
      // its search box. This is the one place worth taking that off them.
      event.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}
