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

/**
 * Something the focus is on that does a thing of its own when pressed -- a
 * button, a link, a summary, a select, a menu item, anything carrying a
 * tabindex -- so a bare space pressed there is the control's and not the
 * palette's.
 *
 * Wider than `pressable`, and deliberately so for the space bar alone. The
 * argument over `pressable` is that a button still answers to Enter, so a
 * keyboard user is not stranded when the space is taken. That is true, and it
 * is not the whole of it: the space on a focused button is the platform's own
 * promise, screen readers announce it, and a person who tabs to "Export" and
 * presses the space bar -- which is what the operating system taught them --
 * got a palette instead of the export. The palette has Cmd-K for anybody who
 * wants it from a control; the control has nothing else for its space. So the
 * palette's space stands aside for anything focusable that is not the page
 * itself or a canvas, whose space is spoken for elsewhere (see `hand.ts`).
 *
 * The other window-wide bare keys keep asking `busy`, which is narrower on
 * purpose: an arrow or a Delete meant for the drawing should still reach it
 * after a toolbar button was clicked with the mouse.
 */
export function interactive(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (busy(target)) return true;
  const tag = target.tagName;
  if (tag === "BUTTON" || tag === "SELECT" || tag === "SUMMARY" || tag === "INPUT") return true;
  if ((tag === "A" || tag === "AREA") && target.hasAttribute("href")) return true;
  const role = target.getAttribute("role");
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  // A canvas or the page itself takes the focus without being a control, and
  // the palette's space is theirs to have.
  if (tag === "CANVAS" || tag === "BODY" || tag === "HTML") return false;
  const tabindex = target.getAttribute("tabindex");
  return (
    tabindex !== null && Number(tabindex) >= 0 && target.getAttribute("role") !== "application"
  );
}

/** The ARIA roles whose element acts when the space bar is pressed on it. */
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "treeitem",
  "gridcell",
  "combobox",
  "listbox",
  "slider",
  "spinbutton",
  "searchbox",
]);

/** Whether the key belongs to whatever has the focus rather than to us. */
export function busy(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return typing(target) || pressable(target);
}

/** The inputs a person types text into, rather than slides or ticks. */
const TEXT_INPUTS = new Set(["", "text", "search", "email", "url", "tel", "password", "number"]);

/**
 * Somewhere a person is writing text, which keeps its own undo.
 *
 * Narrower than `typing`, and it has to be. `typing` counts a slider as
 * somewhere a key belongs to the control, which is right for the space bar and
 * the arrows a slider moves on -- but a slider has no undo of its own, and a
 * Cmd-Z pressed at one that fell through to nothing would be a key that works
 * or does not depending on which control was touched last. Only a field with
 * text in it has an undo the browser keeps, so only those keep Cmd-Z.
 */
export function editingText(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA") return true;
  if (target.tagName === "INPUT") {
    return TEXT_INPUTS.has((target as HTMLInputElement).type.toLowerCase());
  }
  return target.getAttribute("role") === "textbox";
}
