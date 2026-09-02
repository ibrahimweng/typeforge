/**
 * Whether a key belongs to whatever has the focus rather than to the
 * application.
 *
 * Every global shortcut has to answer this before it acts, and the answer is
 * not the one question "is this a form control" but two, with two different
 * reasons. Both were worked out for the palette's space bar, and both apply to
 * every bare key bound since -- which is why they are here rather than there.
 */

/** Somewhere a space is a character, so the palette must not take it. */
export function typing(target: HTMLElement): boolean {
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
export function pressable(target: HTMLElement): boolean {
  if (target.tagName === "INPUT") {
    const kind = (target as HTMLInputElement).type;
    return kind === "checkbox" || kind === "radio";
  }
  const role = target.getAttribute("role");
  return role === "checkbox" || role === "radio" || role === "switch";
}

/** Whether the key belongs to whatever has the focus rather than to us. */
export function busy(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return typing(target) || pressable(target);
}
