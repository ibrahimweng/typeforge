import { describe, expect, it } from "vitest";

import { findCrossbar, findShoulders, shiftCrossbar, shiftShoulders } from "./anatomy";
import { contoursBounds } from "./geometry";
import type { Contour, Vec2 } from "./types";

function polygon(points: Vec2[]): Contour {
  return {
    closed: true,
    nodes: points.map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" })),
  };
}

function rect(x: number, y: number, width: number, height: number): Contour {
  return polygon([
    { x, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
    { x: x + width, y },
  ]);
}

/** Two uprights with a bar across the middle. */
const H_SHAPE = [rect(0, 0, 200, 1400), rect(800, 0, 200, 1400), rect(200, 600, 600, 200)];

describe("findCrossbar", () => {
  it("finds the bar between two stems", () => {
    const bar = findCrossbar(H_SHAPE)!;
    expect(bar.bottom).toBeCloseTo(600, 6);
    expect(bar.top).toBeCloseTo(800, 6);
  });

  it("finds nothing on a letter with no crossing stroke", () => {
    expect(findCrossbar([rect(0, 0, 200, 1400)])).toBeNull();
  });

  /**
   * A bar at the very top or bottom is the end of the letter, not something
   * crossing it, and moving it would change the letter's height. This is why a
   * T reports no crossbar on the real font while an H reports one.
   */
  it("ignores a bar sitting at the top of the letter", () => {
    const tShape = [rect(400, 0, 200, 1200), rect(0, 1200, 1000, 200)];
    expect(findCrossbar(tShape)).toBeNull();
  });

  it("takes the bar nearest the middle when there are several", () => {
    const eShape = [
      rect(0, 0, 200, 1400),
      rect(200, 0, 700, 200), // foot arm
      rect(200, 600, 600, 200), // middle arm
      rect(200, 1200, 700, 200), // top arm
    ];
    const bar = findCrossbar(eShape)!;
    expect((bar.bottom + bar.top) / 2).toBeCloseTo(700, 6);
  });

  it("has nothing to find in an empty glyph", () => {
    expect(findCrossbar([])).toBeNull();
  });
});

describe("shiftCrossbar", () => {
  it("moves the bar and leaves the stems standing", () => {
    const moved = shiftCrossbar(H_SHAPE, 150);
    const bar = findCrossbar(moved)!;
    expect(bar.bottom).toBeCloseTo(750, 6);
    expect(bar.top).toBeCloseTo(950, 6);
  });

  it("does not change the height of the letter", () => {
    const before = contoursBounds(H_SHAPE);
    const after = contoursBounds(shiftCrossbar(H_SHAPE, 150));
    expect(after.yMin).toBeCloseTo(before.yMin, 6);
    expect(after.yMax).toBeCloseTo(before.yMax, 6);
  });

  it("lowers the bar as readily as it raises it", () => {
    const bar = findCrossbar(shiftCrossbar(H_SHAPE, -200))!;
    expect(bar.bottom).toBeCloseTo(400, 6);
  });

  it("leaves a letter with no bar alone", () => {
    const stem = [rect(0, 0, 200, 1400)];
    expect(shiftCrossbar(stem, 150)).toBe(stem);
  });

  it("does nothing when asked for no shift", () => {
    expect(shiftCrossbar(H_SHAPE, 0)).toBe(H_SHAPE);
  });
});

/**
 * An arch, built the way a real n is.
 *
 * The left stem is a trunk running the full height, interrupted where the arch
 * leaves it: an upright run from 800 to 1000 above the springing and another
 * from 0 to 500 below it. The right stem exists only as the arch coming down,
 * so its runs stop at the junctions. That difference is what separates a
 * shoulder from a landing.
 */
const ARCH: Contour = {
  closed: true,
  nodes: [
    { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 0, y: 1000 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 200, y: 1000 }, handleIn: null, handleOut: null, type: "corner" },
    // Springs from the trunk here.
    { point: { x: 200, y: 800 }, handleIn: null, handleOut: { x: 350, y: 1000 }, type: "corner" },
    // Lands on the right stem, which starts here.
    { point: { x: 600, y: 800 }, handleIn: { x: 450, y: 1000 }, handleOut: null, type: "corner" },
    { point: { x: 600, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 400, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 400, y: 600 }, handleIn: null, handleOut: { x: 350, y: 700 }, type: "corner" },
    // The inner springing, back on the trunk.
    { point: { x: 200, y: 500 }, handleIn: { x: 250, y: 700 }, handleOut: null, type: "corner" },
    { point: { x: 200, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
  ],
};

describe("findShoulders", () => {
  it("finds where the arch springs from the trunk", () => {
    const shoulders = findShoulders([ARCH]);
    expect(shoulders.map((point) => point.x)).toEqual([200, 200]);
    expect(shoulders.map((point) => point.y).sort((a, b) => a - b)).toEqual([500, 800]);
  });

  /**
   * The other two junctions on this shape are where the arch comes down. On a
   * real n those are the right stem, and moving them drags the far side of the
   * letter about rather than changing the shoulder.
   */
  it("leaves out the junctions where the arch lands", () => {
    const shoulders = findShoulders([ARCH]);
    expect(shoulders).toHaveLength(2);
    expect(shoulders.some((point) => point.x === 600)).toBe(false);
    expect(shoulders.some((point) => point.x === 400)).toBe(false);
  });

  it("finds nothing on a letter with no straight stem", () => {
    const k = 0.5522847498 * 400;
    const circle: Contour = {
      closed: true,
      nodes: [
        { point: { x: 100, y: 500 }, handleIn: { x: 100, y: 500 - k }, handleOut: { x: 100, y: 500 + k }, type: "smooth" },
        { point: { x: 500, y: 900 }, handleIn: { x: 500 - k, y: 900 }, handleOut: { x: 500 + k, y: 900 }, type: "smooth" },
        { point: { x: 900, y: 500 }, handleIn: { x: 900, y: 500 + k }, handleOut: { x: 900, y: 500 - k }, type: "smooth" },
        { point: { x: 500, y: 100 }, handleIn: { x: 500 + k, y: 100 }, handleOut: { x: 500 - k, y: 100 }, type: "smooth" },
      ],
    };
    expect(findShoulders([circle])).toHaveLength(0);
  });

  it("does not mistake the flat end of an arm for a shoulder", () => {
    // A horizontal bar with a curve off its end: the straight edge is not
    // upright, so nothing springs from a stem here.
    const arm: Contour = {
      closed: true,
      nodes: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 0, y: 200 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 800, y: 200 }, handleIn: null, handleOut: { x: 900, y: 200 }, type: "corner" },
        { point: { x: 800, y: 0 }, handleIn: { x: 900, y: 0 }, handleOut: null, type: "corner" },
      ],
    };
    expect(findShoulders([arm])).toHaveLength(0);
  });
});

describe("shiftShoulders", () => {
  it("raises where the arch springs", () => {
    const moved = shiftShoulders([ARCH], 120);
    expect(moved[0].nodes[3].point).toEqual({ x: 200, y: 920 });
    expect(moved[0].nodes[8].point).toEqual({ x: 200, y: 620 });
  });

  it("carries the handle with the point so the curve keeps its shape", () => {
    const moved = shiftShoulders([ARCH], 120);
    expect(moved[0].nodes[3].handleOut).toEqual({ x: 350, y: 1120 });
  });

  it("leaves the far side of the letter where it was", () => {
    const moved = shiftShoulders([ARCH], 120);
    // The right stem is where the arch lands, not where it springs.
    expect(moved[0].nodes[4].point).toEqual({ x: 600, y: 800 });
    expect(moved[0].nodes[7].point).toEqual({ x: 400, y: 600 });
  });

  it("leaves the rest of the trunk where it was", () => {
    const moved = shiftShoulders([ARCH], 120);
    expect(moved[0].nodes[0].point).toEqual({ x: 0, y: 0 });
    expect(moved[0].nodes[1].point).toEqual({ x: 0, y: 1000 });
    expect(moved[0].nodes[2].point).toEqual({ x: 200, y: 1000 });
  });

  it("leaves a letter with no shoulder alone", () => {
    const stem = [rect(0, 0, 200, 1400)];
    expect(shiftShoulders(stem, 120)).toBe(stem);
  });

  it("does nothing when asked for no shift", () => {
    expect(shiftShoulders([ARCH], 0)[0]).toBe(ARCH);
  });
});
