/**
 * The cap on a staggered entrance, which used to be accepted and ignored.
 */

import { describe, expect, it } from "vitest";

import { staggerStep } from "./motion";

describe("the stagger step", () => {
  it("keeps its own pace with no cap, or under it", () => {
    expect(staggerStep(600, 12)).toBe(12);
    expect(staggerStep(5, 12, 240)).toBe(12);
  });

  it("narrows so the last item starts inside the cap", () => {
    const step = staggerStep(601, 12, 240);
    expect(step).toBeCloseTo(0.4);
    expect(step * 600).toBeCloseTo(240);
  });

  it("does nothing odd with one item or none", () => {
    expect(staggerStep(1, 12, 240)).toBe(12);
    expect(staggerStep(0, 12, 0)).toBe(12);
  });
});
