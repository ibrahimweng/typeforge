/**
 * How the panels down the right are arranged, and where that is remembered.
 *
 * The column was a fixed width with a fixed set of panels in a fixed order.
 * Three hundred pixels on a laptop and three hundred pixels on a thirty-inch
 * monitor; the paths list squeezed into a hundred and forty of them whether or
 * not it was the thing being worked on; and six panels open at once whether or
 * not five of them had anything to do with what was in hand. A designer's
 * layout is part of how they work, and none of it could be changed.
 *
 * So this holds the four things a person can now decide -- how wide, in what
 * order, which are furled, and which are put away -- and keeps them in this
 * browser between sessions. That last part is what makes the rest worth
 * having: a layout you have to set up again every morning is one nobody sets
 * up at all.
 *
 * It is deliberately not in the document store. None of it is a fact about the
 * font: opening somebody else's project must not rearrange your panels, and
 * saving yours must not carry your window across to them. It is also written
 * on every frame of a drag on the resize handle, which is the other reason it
 * is kept away from the state that letters live in.
 */

import { useSyncExternalStore } from "react";

/** What the person has decided about the column of panels. */
export interface Layout {
  /** How wide the whole dock is, in pixels. */
  readonly width: number;
  /**
   * The panels in the order they are drawn.
   *
   * Only the ones whose place has been decided. A panel not listed here is
   * drawn after those that are, in the order the code declares it -- so adding
   * a panel puts it in a sensible place rather than at the mercy of a record
   * written before it existed.
   */
  readonly order: readonly string[];
  /** Furled: the header is there, the body is not. */
  readonly collapsed: readonly string[];
  /** Put away entirely, and got back from the panels menu. */
  readonly hidden: readonly string[];
}

/**
 * The narrowest and widest the dock may be.
 *
 * A floor because a dock narrower than this shows a column of clipped labels
 * rather than controls, and somebody who drags past it has almost certainly
 * meant to put the panels away instead. A ceiling because the canvas is the
 * point of the application and a dock that can eat it is a way to lose the
 * letter with no obvious way back.
 */
export const LEAST_WIDTH = 180;
export const MOST_WIDTH = 560;

const BY_DEFAULT: Layout = { width: 288, order: [], collapsed: [], hidden: [] };

const KEPT = "typeforge.layout";

/**
 * What was remembered, or the default when there is nothing to remember.
 *
 * Every field is checked rather than trusted. This is the one piece of state
 * that arrives from outside the running program, and a record written by an
 * older version -- or by hand, or half-written when a tab was closed -- must
 * give back a usable layout rather than a column of undefined. A dock that
 * fails to draw because of what is in local storage is a dock nobody can
 * clear, since the way to clear it is a button inside it.
 */
function remembered(): Layout {
  try {
    const raw = globalThis.localStorage?.getItem(KEPT);
    if (!raw) return BY_DEFAULT;
    const held = JSON.parse(raw) as Partial<Layout>;
    const ids = (list: unknown): string[] =>
      Array.isArray(list) ? list.filter((one): one is string => typeof one === "string") : [];
    return {
      width:
        typeof held.width === "number" && Number.isFinite(held.width)
          ? Math.min(MOST_WIDTH, Math.max(LEAST_WIDTH, held.width))
          : BY_DEFAULT.width,
      order: ids(held.order),
      collapsed: ids(held.collapsed),
      hidden: ids(held.hidden),
    };
  } catch {
    // A browser with storage blocked, or a record that is not JSON. Either way
    // the answer is a working dock.
    return BY_DEFAULT;
  }
}

let layout: Layout = remembered();
const listeners = new Set<() => void>();

function publish(next: Layout): void {
  layout = next;
  for (const listener of listeners) listener();
  try {
    globalThis.localStorage?.setItem(KEPT, JSON.stringify(next));
  } catch {
    // Storage blocked. The layout still works for this session, which is the
    // part that matters while somebody is using it.
  }
}

/** Set the dock's width, held between the two ends above. */
export function resizeDock(width: number): void {
  const held = Math.min(MOST_WIDTH, Math.max(LEAST_WIDTH, Math.round(width)));
  if (held === layout.width) return;
  publish({ ...layout, width: held });
}

/** Furl a panel, or unfurl it. */
export function togglePanel(id: string): void {
  const collapsed = layout.collapsed.includes(id)
    ? layout.collapsed.filter((one) => one !== id)
    : [...layout.collapsed, id];
  publish({ ...layout, collapsed });
}

/** Put a panel away, or get it back. */
export function showPanel(id: string, shown: boolean): void {
  const hidden = shown ? layout.hidden.filter((one) => one !== id) : [...layout.hidden, id];
  if (hidden.length === layout.hidden.length && shown) return;
  publish({ ...layout, hidden });
}

/**
 * Say what the arrangement now is, for the panels that were on screen.
 *
 * The panels that were not keep their places after them, in the order they
 * already had. They are the ones belonging to another scope, and the two sets
 * never appear together -- so what matters is that each set keeps its own
 * order, not where the other one sits in the record.
 */
export function arrangePanels(ids: readonly string[]): void {
  const rest = layout.order.filter((one) => !ids.includes(one));
  publish({ ...layout, order: [...ids, ...rest] });
}

/** Back to the layout the application ships with. */
export function resetLayout(): void {
  publish(BY_DEFAULT);
}

/**
 * The declared panels, put in the order this layout says.
 *
 * A panel whose place has never been decided sorts after every panel whose
 * place has, keeping the order the code declared it in. That is what makes a
 * panel added next year appear where its author put it rather than at the top
 * of somebody's year-old record.
 */
export function inOrder<T extends { id: string }>(
  panels: readonly T[],
  order: readonly string[],
): T[] {
  const placed = (panel: T): number => {
    const at = order.indexOf(panel.id);
    return at === -1 ? order.length + panels.indexOf(panel) : at;
  };
  return [...panels].sort((one, other) => placed(one) - placed(other));
}

export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const read = (): Layout => layout;

/** Follow the arrangement of the panels. */
export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, read, read);
}
