import { describe, expect, it } from "vitest";

import { contourToGlyfPoints } from "./quadratic";
import type { Contour } from "./types";

describe("contourToGlyfPoints", () => {
  it("does not turn a curve that leaves its extreme level into one that turns inside", () => {
    // The tail of a curly c at a heavy weight: it leaves the stem heading
    // straight down, so its start is its leftmost point. The best single
    // quadratic is within tolerance but puts its control three units left of
    // that start, which a file checker reports as a turn with no point on it.
    const contour: Contour = {
      closed: false,
      nodes: [
        {
          point: { x: 322.678, y: 554.029 },
          handleIn: null,
          handleOut: { x: 322.678, y: 421.315 },
          type: "smooth",
        },
        {
          point: { x: 414.257, y: 240.225 },
          handleIn: { x: 349.993, y: 316.588 },
          handleOut: null,
          type: "smooth",
        },
      ],
    };
    const points = contourToGlyfPoints(contour);
    const start = points[0];
    for (const point of points) expect(point.x).toBeGreaterThanOrEqual(start.x);
  });
});
