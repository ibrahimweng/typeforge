import { describe, expect, it } from "vitest";

import { rayHitDistance } from "./geometry";
import type { Vec2 } from "./types";

/** A square, wound however; only its edges matter here. */
const square = (x: number, y: number, size: number): Vec2[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

describe("rayHitDistance", () => {
  it("measures the distance to the first edge in the way", () => {
    expect(rayHitDistance([square(0, 0, 100)], { x: 50, y: 50 }, { x: 1, y: 0 })).toBeCloseTo(50, 6);
  });

  it("says nothing is in the way when nothing is", () => {
    expect(rayHitDistance([square(0, 0, 100)], { x: 200, y: 50 }, { x: 1, y: 0 })).toBe(Infinity);
  });

  it("ignores what is behind it", () => {
    // Facing away from the square entirely.
    expect(rayHitDistance([square(0, 0, 100)], { x: 200, y: 50 }, { x: -1, y: 0 })).toBeCloseTo(
      100,
      6,
    );
    expect(rayHitDistance([square(0, 0, 100)], { x: 150, y: 150 }, { x: 1, y: 1 })).toBe(Infinity);
  });

  /**
   * The crossing has to fall on the edge itself, not on the line the edge would
   * make if it ran on forever. Testing that the wrong way round meant a ray in
   * clear air read as blocked a few units away, because it caught the line
   * behind some edge nearby: every point on the outside of an a's bowl was told
   * it had nowhere to go, and the counter of an o could not open at all.
   */
  it("does not catch the line an edge sits on beyond its ends", () => {
    // A short edge well off to the right, whose line passes straight through
    // the ray's path.
    const stub: Vec2[] = [
      { x: 100, y: 400 },
      { x: 100, y: 300 },
    ];
    expect(rayHitDistance([stub], { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(Infinity);
    // The same edge, extended down to where the ray actually runs.
    const reaching: Vec2[] = [
      { x: 100, y: 400 },
      { x: 100, y: -400 },
    ];
    expect(rayHitDistance([reaching], { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(100, 6);
  });

  it("ignores the outline it is standing on", () => {
    // Starting on the left edge, facing across: the far edge answers, not the
    // one underfoot.
    expect(rayHitDistance([square(0, 0, 100)], { x: 0, y: 50 }, { x: 1, y: 0 })).toBeCloseTo(
      100,
      6,
    );
  });

  it("takes the nearest of several things in the way", () => {
    const near = square(200, 0, 100);
    const far = square(400, 0, 100);
    expect(rayHitDistance([far, near], { x: 0, y: 50 }, { x: 1, y: 0 })).toBeCloseTo(200, 6);
  });
});
