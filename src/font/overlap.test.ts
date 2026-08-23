import { describe, expect, it } from "vitest";

import { contourArea, contoursBounds } from "./geometry";
import { contoursIntersect } from "./outline";
import { removeOverlaps } from "./overlap";
import type { Contour } from "./types";

const rect = (x: number, y: number, w: number, h: number, back = false): Contour => {
  const corners = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  if (back) corners.reverse();
  return {
    closed: true,
    nodes: corners.map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" })),
  };
};

const inkIn = (contours: Contour[]): number =>
  Math.abs(contours.reduce((total, one) => total + contourArea(one), 0));

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

describe("how the counters are read", () => {
  /*
   * A ring with a bar laid across its outside, which is the single-storey a:
   * a bowl, the counter inside it, and a stem down the right that overlaps the
   * bowl and misses the counter. Sized so the answer is arithmetic.
   */
  const ring = rect(0, 0, 400, 400);
  const counter = rect(100, 100, 150, 200, true);
  const bar = rect(250, 50, 140, 300);
  const shapes = [ring, counter, bar];

  it("reads a stem as a counter when it works it out by nesting", async () => {
    /*
     * Not a claim about what ought to happen -- it is what does, and it is the
     * reason the reading has to be said rather than guessed at.
     *
     * By nesting, a contour is a counter when an odd number of others enclose
     * it. The bar is inside the ring, so it counts as one, so it is taken out
     * of the letter: four hundred by four hundred, less the counter, less the
     * whole bar.
     */
    expect(inkIn(await removeOverlaps(shapes, "nesting"))).toBeCloseTo(
      400 * 400 - 150 * 200 - 140 * 300,
      -1,
    );
  });

  it("believes the drawing when told the winding means something", async () => {
    // The bar is inside the ring and adds nothing to it; the counter is the
    // only thing missing. Which is what the shape looks like.
    const merged = await removeOverlaps(shapes, "winding");
    expect(inkIn(merged)).toBeCloseTo(400 * 400 - 150 * 200, -1);
    expect(merged.filter((one) => contourArea(one) < 0)).toHaveLength(1);
  });
});
