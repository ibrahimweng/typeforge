import * as React from "react";
import { useSyncExternalStore } from "react";

import { store, type AppState } from "./store";

/**
 * A reader that gives the same answer until the answer changes.
 *
 * useSyncExternalStore calls its reader more than once per render and compares
 * what comes back, so a reader that computes afresh every time never settles
 * and React warns about it. This holds the last value against the state it was
 * taken from: the same state gives back the very same value, and a new state
 * only replaces it when `same` says the selection actually moved.
 *
 * Separate from the hook so it can be tested without a browser.
 */
export function readerFor<T>(
  snapshot: () => AppState,
  select: () => (state: AppState) => T,
  same: () => (before: T, after: T) => boolean,
): () => T {
  let held: { from: AppState; value: T } | null = null;
  return () => {
    const state = snapshot();
    if (held && held.from === state) return held.value;
    const found = select()(state);
    // Keep the old value when the new one means the same thing, so a change to
    // another part of the document does not re-render whoever is reading.
    const value = held && same()(held.value, found) ? held.value : found;
    held = { from: state, value };
    return value;
  };
}

/**
 * Subscribe to the application state, whole or in part.
 *
 * Called with nothing, a component follows the whole document and re-renders
 * whenever any of it changes. That is the honest default and it is what most
 * of the panels want -- but `set` builds a new state object for every change,
 * so "any of it" means every one of them re-renders on every drag frame, the
 * kerning table included, while a point is being pulled about in the editor.
 *
 * Called with a selector, a component follows only what it asked for:
 *
 *     const typeface = useAppState((state) => state.typeface);
 *
 * A field off the state is the ideal selector: the store copies the state
 * object but not the fields under it, so anything an edit did not touch comes
 * back identical. A selector that builds something -- an object, an array, a
 * mapped list -- returns a fresh value every time, so pass `same` to say what
 * counts as unchanged, or select the pieces one at a time.
 *
 * Note what narrowing costs. A component that reads a glyph through
 * `store.glyph(name)` is reading the live document, which the store edits in
 * place; it re-renders because `revision` moved under the whole-state
 * subscription. Narrow that one to the fields it names and it goes stale.
 */
export function useAppState(): AppState;
export function useAppState<T>(
  select: (state: AppState) => T,
  same?: (before: T, after: T) => boolean,
): T;
export function useAppState<T>(
  select?: (state: AppState) => T,
  same: (before: T, after: T) => boolean = Object.is,
): AppState | T {
  /*
   * The current selector, reached through a ref so the reader never changes.
   *
   * A selector written inline is a new function on every render. A reader that
   * closed over it would be new every render too, and useSyncExternalStore
   * drops its subscription and takes out another whenever the reader changes
   * -- a resubscribe per render, for something meant to save work.
   */
  const latest = React.useRef({ select, same });
  latest.current = { select, same };

  const read = React.useMemo(
    () =>
      readerFor<AppState | T>(
        store.getSnapshot,
        () => (state) => {
          const pick = latest.current.select;
          return pick ? pick(state) : state;
        },
        () => (before, after) => {
          if (!latest.current.select) return Object.is(before, after);
          return latest.current.same(before as T, after as T);
        },
      ),
    [],
  );

  return useSyncExternalStore(store.subscribe, read, read);
}

export { store, nodeKey } from "./store";
export type { AppState, NodeRef, ToolId, ToolPhase, ToolState, ViewId } from "./store";
