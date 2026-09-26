/**
 * Resizing the dock on a window too small for the width that was chosen.
 */

import { describe, expect, it } from "vitest";

import { widthWithin } from "@/state/layout";

import { widthToRemember } from "./dock-width";

describe("the width a resize remembers", () => {
  // A 900 pixel window puts the ceiling at 270.
  const small = 900;
  const ceiling = widthWithin(Number.POSITIVE_INFINITY, small);

  it("keeps the chosen width when pushed at the ceiling", () => {
    expect(ceiling).toBe(270);
    expect(widthToRemember(400, small, ceiling + 16)).toBe(400);
    expect(widthToRemember(400, small, ceiling)).toBe(400);
  });

  it("takes a width under the ceiling as the new choice", () => {
    expect(widthToRemember(400, small, ceiling - 16)).toBe(ceiling - 16);
  });

  it("widens past the old choice when there is room to", () => {
    expect(widthToRemember(400, small, 480)).toBe(480);
    expect(widthToRemember(240, 1600, 300)).toBe(300);
  });

  it("narrows as asked on a window big enough to show it", () => {
    expect(widthToRemember(400, 1600, 384)).toBe(384);
  });
});
