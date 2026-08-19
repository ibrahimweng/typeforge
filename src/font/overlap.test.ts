import { describe, expect, it } from "vitest";

import { contourArea, contoursBounds } from "./geometry";
import { contoursIntersect } from "./outline";
import { removeOverlaps } from "./overlap";
import type { Contour } from "./types";

const rect = (x: number, y: number, w: number, h: number): Contour => ({
  closed: true,
  nodes: [
    { point: { x, y }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: x + w, y }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: x + w, y: y + h }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x, y: y + h }, handleIn: null, handleOut: null, type: "corner" },
  ],
});

describe("removeOverlaps", () => {
  it("joins two overlapping shapes into one", async () => {
    const shapes = [rect(0, 0, 100, 100), rect(50, 50, 100, 100)];
    expect(contoursIntersect(shapes)).toBe(true);

    const merged = await removeOverlaps(shapes);
    expect(merged.length).toBe(1);
    expect(contoursIntersect(merged)).toBe(false);
    // Two 100x100 squares meeting over a 50x50 corner.
    expect(Math.abs(contourArea(merged[0]))).toBeCloseTo(17_500, -1);
  });

  it("leaves shapes that do not touch alone", async () => {
    const apart = [rect(0, 0, 50, 50), rect(200, 200, 50, 50)];
    const merged = await removeOverlaps(apart);
    expect(merged.length).toBe(2);
  });

  it("keeps a counter as a hole", async () => {
    // A ring with something overlapping its outside, as a cedilla would be.
    const shapes = [rect(0, 0, 300, 300), rect(100, 100, 100, 100), rect(280, 120, 80, 60)];
    const merged = await removeOverlaps(shapes);

    // The hole survives, so some contour must wind against the others.
    const areas = merged.map(contourArea);
    expect(areas.some((a) => a > 0)).toBe(true);
    expect(areas.some((a) => a < 0)).toBe(true);
  });

  it("does not move the outline", async () => {
    const shapes = [rect(0, 0, 100, 100), rect(50, 50, 100, 100)];
    const before = contoursBounds(shapes);
    const after = contoursBounds(await removeOverlaps(shapes));
    for (const key of ["xMin", "yMin", "xMax", "yMax"] as const) {
      expect(after[key]).toBeCloseTo(before[key], 3);
    }
  });

  it("returns a single contour untouched", async () => {
    const one = [rect(0, 0, 100, 100)];
    expect(await removeOverlaps(one)).toBe(one);
  });
});
