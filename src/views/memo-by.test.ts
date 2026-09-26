/**
 * The per-letter cache the proof draws through.
 */

import { describe, expect, it } from "vitest";

import { memoBy } from "./memo-by";

describe("one answer per key", () => {
  it("works each key out once, however often it is asked", () => {
    let calls = 0;
    const lengthOf = memoBy((word: string) => {
      calls += 1;
      return word.length;
    });
    expect([..."abab"].map(lengthOf)).toEqual([1, 1, 1, 1]);
    expect(calls).toBe(2);
  });

  it("keys objects by identity, so an edited object is asked again", () => {
    let calls = 0;
    const idOf = memoBy((glyph: { name: string }) => {
      calls += 1;
      return glyph.name;
    });
    const a = { name: "a" };
    idOf(a);
    idOf(a);
    idOf({ ...a });
    expect(calls).toBe(2);
  });

  it("remembers an empty answer as well as a full one", () => {
    let calls = 0;
    const nothing = memoBy((_: number) => {
      calls += 1;
      return null;
    });
    nothing(1);
    nothing(1);
    expect(calls).toBe(1);
  });
});
