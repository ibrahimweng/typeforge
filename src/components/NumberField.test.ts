/**
 * What a typed number settles to when the field is left.
 *
 * The rules, rather than the component: the bug was in them. A cleared field
 * committed a zero because `Number("")` is 0, and that is a sum, not a render.
 */

import { describe, expect, it } from "vitest";

import { settleDraft } from "./NumberField";

describe("settling a number field", () => {
  it("commits a changed number, rounded to a font unit", () => {
    expect(settleDraft("1200", 1000)).toBe(1200);
    expect(settleDraft("-40.6", 0)).toBe(-41);
  });

  it("keeps the decimals it is asked to keep", () => {
    expect(settleDraft("0.55", 0.5, 2)).toBe(0.55);
    expect(settleDraft("0.555", 0.5, 2)).toBe(0.56);
  });

  it("reverts a field left empty rather than committing zero", () => {
    expect(settleDraft("", 120)).toBeNull();
    expect(settleDraft("   ", 120)).toBeNull();
  });

  it("reverts anything that is not a number", () => {
    expect(settleDraft("-", 120)).toBeNull();
    expect(settleDraft("abc", 120)).toBeNull();
    expect(settleDraft("Infinity", 120)).toBeNull();
  });

  it("commits nothing when the number did not change, so the undo stack is left alone", () => {
    expect(settleDraft("120", 120)).toBeNull();
    expect(settleDraft("120.2", 120)).toBeNull();
  });

  it("still commits a zero that was typed", () => {
    expect(settleDraft("0", 120)).toBe(0);
  });
});
