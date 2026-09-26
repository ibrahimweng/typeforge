/**
 * Dialogs that mean it when they say they are modal.
 *
 * Six dialogs here are marked `aria-modal`, which is a promise to a screen
 * reader that nothing behind them can be reached until they close. None of
 * them kept it. Opening one left the focus on whatever button opened it --
 * behind the dark -- so Tab walked the page underneath, and every key bound to
 * the window went on acting on the canvas as though the dialog were not there:
 * an arrow typed at the export dialog nudged the points of the letter it was
 * exporting, and a Backspace deleted them.
 *
 * Two halves, and both are needed. The hook below moves the focus in, keeps
 * Tab inside, and hands the focus back on the way out -- which is what a
 * keyboard user needs. `modalOpen` is for the window-wide listeners, which
 * see a key wherever it was pressed: clicking the dark behind a dialog puts
 * the focus on the body, and the body is exactly where the canvas keys are
 * written to answer from, so focus alone could never have been the guard.
 */

import * as React from "react";

/** Whether a modal dialog is on screen, so the keys behind it stand aside. */
export function modalOpen(doc: Pick<Document, "querySelector"> | null = globalDocument()): boolean {
  return doc?.querySelector('[aria-modal="true"]') != null;
}

function globalDocument(): Document | null {
  return typeof document === "undefined" ? null : document;
}

/**
 * Where Tab goes next inside a trap, or `null` to leave it to the browser.
 *
 * Only the two ends are taken: Tab from the last control wraps to the first,
 * and Shift-Tab from the first wraps to the last. Everything between is the
 * browser's ordinary walk, which already knows about the order the controls
 * are in and there is no reason to write a second copy of it. The focus being
 * outside the list altogether -- on the panel itself, which is where it lands
 * when a dialog has nothing to focus first -- is answered as an end too, or
 * Shift-Tab from there would step straight out of the dialog.
 */
export function wrapTab<T>(items: readonly T[], current: T | null, backwards: boolean): T | null {
  if (items.length === 0) return null;
  const first = items[0];
  const last = items[items.length - 1];
  const at = current === null ? -1 : items.indexOf(current);
  if (at === -1) return backwards ? last : first;
  if (backwards && at === 0) return last;
  if (!backwards && at === items.length - 1) return first;
  return null;
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

/** What Tab can land on inside a dialog, in the order it lands on them. */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // Laid out at all -- a control inside a collapsed section is in the
    // document but Tab skips it, so the trap has to skip it too.
    (one) => one.getClientRects().length > 0,
  );
}

/**
 * Take the focus into a dialog, keep it there, and give it back.
 *
 * `active` is for the one dialog that stays mounted while closed (the
 * library); the rest mount when they open and leave it at its default.
 *
 * The first control is focused rather than the panel, because in every dialog
 * here the first control is the one a person came to use -- the name field in
 * the export dialogs, the search box in the library -- and focusing it saves a
 * Tab. Where the focus was is remembered and put back when the dialog goes, if
 * that element is still in the page: a keyboard user who opened Export from a
 * menu should be back where they were, not dropped on the body.
 */
export function useModalFocus(panel: React.RefObject<HTMLElement | null>, active = true): void {
  React.useEffect(() => {
    const root = panel.current;
    if (!active || !root) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!root.contains(document.activeElement)) {
      const first = focusableIn(root)[0];
      if (first) first.focus({ preventScroll: true });
      else {
        // Somewhere to stand even with nothing to press, so keys stop
        // reaching the page behind.
        if (!root.hasAttribute("tabindex")) root.tabIndex = -1;
        root.focus({ preventScroll: true });
      }
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const next = wrapTab(focusableIn(root), focused, event.shiftKey);
      if (!next) return;
      event.preventDefault();
      next.focus();
    };
    root.addEventListener("keydown", onKeyDown);

    return () => {
      root.removeEventListener("keydown", onKeyDown);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [panel, active]);
}
