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
 * Cmd-K is read off the key rather than off the platform, which is the part
 * that is easy to get wrong: `metaKey` is Command on a Mac and the Windows key
 * on a PC, and `ctrlKey` is Control on both. Accepting either works on both
 * without asking what the machine is -- and asking is unreliable anyway, since
 * `navigator.platform` has been deprecated for years and lies about iPads on
 * purpose.
 */

import * as React from "react";

/** Somewhere a space is a character, so the palette must not take it. */
function typing(target: HTMLElement): boolean {
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT" || tag === "OPTION") return true;
  if (tag === "INPUT") {
    // A checkbox or a radio is an input the browser presses with space rather
    // than types into, so it belongs with the switches below.
    const kind = (target as HTMLInputElement).type;
    return kind !== "checkbox" && kind !== "radio" && kind !== "button" && kind !== "submit";
  }
  return target.getAttribute("role") === "textbox";
}

/**
 * Somewhere a space is the only way in, so the palette must not take it.
 *
 * Narrower than "anything the browser presses with a space", and the reason is
 * what else the keyboard has. A button, a link and a summary all answer to
 * Enter as well, so a keyboard user who cannot press them with a space is not
 * stranded -- they press Enter, which is what most of them would reach for
 * anyway. A checkbox, a radio and a switch answer to nothing but the space, so
 * taking it would leave them unreachable without a mouse.
 *
 * That line is drawn here rather than at `:focus-visible`, which is the
 * obvious answer and does not work. The idea was to guard a control only when
 * it had been reached by keyboard, since a button clicked with the mouse keeps
 * the focus afterwards and refusing the space there would break the shortcut
 * the moment anybody touched anything. But Chromium turns `:focus-visible` on
 * at the moment a key is pressed, so asked inside a keydown it says "keyboard"
 * however the focus got there -- measured: a button focused by a click reads
 * false a moment before the space and true during it. A test that pressed a
 * button and then a space caught it.
 */
function pressable(target: HTMLElement): boolean {
  if (target.tagName === "INPUT") {
    const kind = (target as HTMLInputElement).type;
    return kind === "checkbox" || kind === "radio";
  }
  const role = target.getAttribute("role");
  return role === "checkbox" || role === "radio" || role === "switch";
}

/** Whether the key belongs to whatever has the focus rather than to us. */
function busy(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return typing(target) || pressable(target);
}

export function useQuickActionShortcut(onOpen: () => void): void {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never on a repeat: holding the key down should open it once, not once
      // per repeat for as long as it is held.
      if (event.repeat) return;

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
      if (busy(event.target)) return;
      // Otherwise the page scrolls under the palette as it opens.
      event.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}
