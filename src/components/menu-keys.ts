/**
 * What a menu has to do besides listing things, in one place.
 *
 * Saying `role="menu"` is a promise to a screen reader: it will announce a
 * menu and expect the arrows to walk it. There are two of them in this
 * application now -- the one a right click opens over a letter, and the one
 * that offers the three ways to start a font -- and the second was about to be
 * a copy of the first with the same four listeners and the same arithmetic.
 *
 * Two copies of a promise is how one of them comes to be broken quietly. So
 * the behaviour is here and the markup is theirs.
 *
 * Why each of these exists:
 *
 *   - The first item takes the focus as the menu opens, because that is where
 *     the arrows start from and it is what tells a screen reader the menu is
 *     now the subject.
 *   - Escape, a click elsewhere and the window being resized all put it away.
 *     All three are what a person does when they have decided against it, and
 *     a menu that survives any of them has to be dismissed on purpose.
 *   - The arrows walk it, and wrap. Home and End go to the ends.
 *
 * The caller is told why it was closed, because the answer is not the same for
 * each. Escape is a decision to go back to what you were doing, so the focus
 * belongs where it came from; a click elsewhere is a change of subject, and
 * pulling the focus back from whatever was clicked would be taking it away
 * from somebody who has just asked for something else.
 */

import * as React from "react";

export type Dismissal = "escape" | "away" | "resize";

/** The items that can be chosen, in the order they are drawn. */
function itemsIn(within: HTMLElement | null): HTMLButtonElement[] {
  return [...(within?.querySelectorAll<HTMLButtonElement>("[data-menu-item]") ?? [])].filter(
    (item) => !item.disabled,
  );
}

export function useMenuBehaviour(within: {
  /** The element holding the items, which is also what a click is measured against. */
  menu: React.RefObject<HTMLElement | null>;
  onClose: (why: Dismissal) => void;
  /**
   * Whether to take the focus as it opens.
   *
   * True for a menu opened by a pointer at a position, where nothing else has
   * the focus to lose. A menu opened from a button is different: the button
   * keeps the focus, and Escape has somewhere obvious to return to, so pulling
   * the focus into the list would take away the thing that closes it.
   */
  takeFocus?: boolean;
}): { onKeyDown: (event: React.KeyboardEvent) => void } {
  const { menu, onClose, takeFocus = true } = within;

  React.useEffect(() => {
    if (takeFocus) itemsIn(menu.current)[0]?.focus();
  }, [menu, takeFocus]);

  React.useEffect(() => {
    const away = (event: MouseEvent): void => {
      if (!menu.current?.contains(event.target as Node)) onClose("away");
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose("escape");
    };
    const resized = (): void => onClose("resize");
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", resized);
    };
  }, [menu, onClose]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const all = itemsIn(menu.current);
    if (all.length === 0) return;
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const step = (to: number): void => {
      event.preventDefault();
      all[(to + all.length) % all.length].focus();
    };
    if (event.key === "ArrowDown") step(at + 1);
    else if (event.key === "ArrowUp") step(at - 1);
    else if (event.key === "Home") step(0);
    else if (event.key === "End") step(all.length - 1);
  };

  return { onKeyDown };
}
