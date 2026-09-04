/**
 * The reader behind useAppState.
 *
 * What is worth checking is not that a selector picks the right field -- that
 * is one call -- but that reading twice off the same state gives back the very
 * same value. useSyncExternalStore compares what its reader returns, so a
 * reader that builds a fresh answer each time renders forever.
 */

import { describe, expect, it } from "vitest";

import { readerFor } from "./useStore";
import type { AppState } from "./store";

/** Enough of a state to be a state, since the reader only holds references. */
const stateWith = (tool: string, revision: number): AppState =>
  ({ tool, revision }) as unknown as AppState;

describe("the reader behind useAppState", () => {
  it("gives back the very same value while the state stands still", () => {
    const state = stateWith("pen", 1);
    const read = readerFor<unknown>(
      () => state,
      () => (one) => one.tool,
      () => Object.is,
    );
    expect(read()).toBe("pen");
    expect(read()).toBe(read());
  });

  it("holds its answer when a different part of the state changes", () => {
    let state = stateWith("pen", 1);
    const read = readerFor<unknown>(
      () => state,
      () => (one) => one.tool,
      () => Object.is,
    );
    const before = read();
    // A new state object, as every edit makes, with the selected field the same.
    state = stateWith("pen", 2);
    expect(read()).toBe(before);
  });

  it("follows the selected field when that is what moved", () => {
    let state = stateWith("pen", 1);
    const read = readerFor<unknown>(
      () => state,
      () => (one) => one.tool,
      () => Object.is,
    );
    expect(read()).toBe("pen");
    state = stateWith("knife", 2);
    expect(read()).toBe("knife");
  });

  it("keeps the old value when `same` says the new one means no more", () => {
    let state = stateWith("pen", 1);
    // A selector that builds a fresh object every time, which is exactly the
    // shape that cannot be compared by identity.
    const read = readerFor<{ tool: string }>(
      () => state,
      () => (one) => ({ tool: one.tool }),
      () => (before, after) => before.tool === after.tool,
    );
    const before = read();
    state = stateWith("pen", 2);
    expect(read()).toBe(before);

    state = stateWith("knife", 3);
    const after = read();
    expect(after).not.toBe(before);
    expect(after.tool).toBe("knife");
  });

  it("asks the selector again only when the state is a new one", () => {
    let asked = 0;
    let state = stateWith("pen", 1);
    const read = readerFor<unknown>(
      () => state,
      () => (one) => {
        asked += 1;
        return one.tool;
      },
      () => Object.is,
    );
    read();
    read();
    read();
    expect(asked).toBe(1);

    state = stateWith("pen", 2);
    read();
    read();
    expect(asked).toBe(2);
  });
});
