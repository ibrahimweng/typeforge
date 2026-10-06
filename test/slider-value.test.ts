/**
 * The slider's keyboard step, tested from out here rather than beside it.
 *
 * `slider-value.ts` sits in `src/ui/`, the licensed folder, and a test placed
 * next to it was a file under that licence that nothing in the application
 * reaches: `src/licensed.test.ts` holds the folder to what the application
 * uses, and failed on it. Nor can it go elsewhere under `src/`, where an
 * import of `@/ui/` is a door into the library that the same file counts.
 */

import { describe, expect, it } from "vitest";

import { keyStep } from "@/ui/components/controls/slider/slider-value";

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
