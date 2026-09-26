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
 * Read off `code` as well as `key`, because with Shift held `key` is `Z` and
 * on a layout that is not QWERTY the letter under that finger is something
 * else. Either one answering is enough.
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
  const isZ = event.key.toLowerCase() === "z" || event.code === "KeyZ";
  if (!isZ) return null;
  return event.shiftKey ? "redo" : "undo";
}
