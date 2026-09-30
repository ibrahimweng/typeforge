import { describe, expect, it } from "vitest";

import { keyStep } from "./slider-value";

describe("a key press on a slider", () => {
  it("moves a share of the range, in whole steps", () => {
    // Weight: a range of two, set to the half-thousandth.
    expect(keyStep(2 * 0.01, 0.0005)).toBeCloseTo(0.02);
    expect(keyStep(2 * 0.1, 0.0005)).toBeCloseTo(0.2);
  });

  it("never moves less than one step", () => {
    expect(keyStep(11 * 0.01, 1)).toBe(1);
  });
});
