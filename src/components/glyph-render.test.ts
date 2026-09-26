/**
 * Being told when the device pixel ratio changes, without a window: the
 * window is a stand-in whose media queries can be made to fire.
 */

import { describe, expect, it } from "vitest";

import { watchDeviceRatio } from "./glyph-render";

function fakeWindow(ratio: number) {
  const queries: Array<{ media: string; listeners: Set<() => void> }> = [];
  const win = {
    devicePixelRatio: ratio,
    matchMedia(media: string) {
      const listeners = new Set<() => void>();
      queries.push({ media, listeners });
      return {
        media,
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      } as unknown as MediaQueryList;
    },
  };
  const live = () => queries.filter((query) => query.listeners.size > 0);
  const change = (next: number) => {
    win.devicePixelRatio = next;
    for (const query of live()) for (const listener of [...query.listeners]) listener();
  };
  return { win, queries, live, change };
}

describe("watching the device pixel ratio", () => {
  it("asks for the resolution in force, and re-arms at the new one", () => {
    const page = fakeWindow(1);
    let told = 0;
    const off = watchDeviceRatio(page.win)(() => told++);
    expect(page.live().map((query) => query.media)).toEqual(["(resolution: 1dppx)"]);

    page.change(2);
    expect(told).toBe(1);
    expect(page.live().map((query) => query.media)).toEqual(["(resolution: 2dppx)"]);

    page.change(1.5);
    expect(told).toBe(2);
    off();
    expect(page.live()).toEqual([]);
  });

  it("shares one query between every listener", () => {
    const page = fakeWindow(2);
    const subscribe = watchDeviceRatio(page.win);
    const told: string[] = [];
    const offA = subscribe(() => told.push("a"));
    const offB = subscribe(() => told.push("b"));
    expect(page.queries).toHaveLength(1);
    page.change(1);
    expect(told).toEqual(["a", "b"]);
    offA();
    expect(page.live()).toHaveLength(1);
    offB();
    expect(page.live()).toHaveLength(0);
  });

  it("does nothing without a window", () => {
    const off = watchDeviceRatio(null)(() => {});
    expect(off).toBeTypeOf("function");
    off();
  });
});
