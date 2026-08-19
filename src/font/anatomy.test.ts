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

/** A stem with a curve springing from it partway up, as an arch does. */
const ARCH: Contour = {
  closed: true,
  nodes: [
    { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 0, y: 1000 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 200, y: 1000 }, handleIn: null, handleOut: null, type: "corner" },
    // Springs from the stem here and curves away.
    { point: { x: 200, y: 700 }, handleIn: null, handleOut: { x: 300, y: 900 }, type: "corner" },
    { point: { x: 600, y: 900 }, handleIn: { x: 500, y: 950 }, handleOut: null, type: "corner" },
    { point: { x: 600, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
  ],
};

describe("findShoulders", () => {
  it("finds where a curve springs from an upright", () => {
    const shoulders = findShoulders([ARCH]);
    expect(shoulders.length).toBeGreaterThan(0);
    expect(shoulders.some((point) => Math.abs(point.y - 700) < 1)).toBe(true);
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
    const springing = moved[0].nodes.find((node) => Math.abs(node.point.x - 200) < 1 && node.point.y < 900);
    expect(springing!.point.y).toBeCloseTo(820, 6);
  });

  it("carries the handle with the point so the curve keeps its shape", () => {
    const moved = shiftShoulders([ARCH], 120);
    const springing = moved[0].nodes.find((node) => node.handleOut !== null)!;
    expect(springing.handleOut!.y).toBeCloseTo(1020, 6);
  });

  it("leaves the rest of the stem where it was", () => {
    const moved = shiftShoulders([ARCH], 120);
    expect(moved[0].nodes[0].point).toEqual({ x: 0, y: 0 });
    expect(moved[0].nodes[1].point).toEqual({ x: 0, y: 1000 });
  });

  it("leaves a letter with no shoulder alone", () => {
    const stem = [rect(0, 0, 200, 1400)];
    expect(shiftShoulders(stem, 120)).toBe(stem);
  });

  it("does nothing when asked for no shift", () => {
    expect(shiftShoulders([ARCH], 0)[0]).toBe(ARCH);
  });
});
