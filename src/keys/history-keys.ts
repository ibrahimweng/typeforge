/**
 * Which undo chord a key is, if it is one.
 *
 * Kept apart from `useAppKeys` so it can be asked without a page: the hook
 * lives on the window and reaches into the store, and neither is something a
 * test of "is Cmd-Shift-Z redo" should need.
 *
 * Cmd-Z and Ctrl-Z are both taken, for the reason every chord here takes both:
 * `metaKey` is Command on a Mac and the Windows key on a PC, and accepting
 * either works on both without asking which machine this is. Shift makes it
 * redo, which is the pairing every application on both uses. Alt is turned
 * away: Alt belongs to the tab strip in this application, and Cmd-Alt-Z is not
 * a chord anybody means as undo.
 *
 * Read off `key`, which is the letter the layout prints on the key, and not
 * off `code`, which is where the key sits on a QWERTY board. The two disagree
 * on every layout that moves the Z: on QWERTZ the key a German reader knows as
 * Y sits where QWERTY has its Z, so reading `code` made Ctrl-Y -- redo, to
 * anybody used to Windows -- undo instead; and on Dvorak the Z-shaped hole is
 * the semicolon, so Cmd-; undid. A person presses the letter they can see, so
 * the letter is what is asked.
 *
 * `code` comes back only where `key` has no Latin letter to offer at all -- a
 * Russian, Greek or Hebrew layout reports its own alphabet in `key`, and
 * there the application's shortcuts are conventionally the keys at the Latin
 * positions, which is what every operating system's own Cmd-Z does on those
 * layouts. A `key` that is a Latin letter or any other printable ASCII
 * character (the semicolon on Dvorak) is taken at its word.
 */
export function historyChord(event: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): "undo" | "redo" | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const isZ = latinKey(event.key) ? event.key.toLowerCase() === "z" : event.code === "KeyZ";
  if (!isZ) return null;
  return event.shiftKey ? "redo" : "undo";
}

/**
 * Whether `key` is a single character from the ASCII range -- a Latin letter,
 * a digit or punctuation -- and so says for itself which key it is. Named keys
 * ("Enter", "Dead") and letters from other alphabets are not, and for those
 * the physical position is the better answer.
 */
export function latinKey(key: string): boolean {
  return key.length === 1 && key.charCodeAt(0) > 0x20 && key.charCodeAt(0) < 0x7f;
}
