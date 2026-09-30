import { describe, expect, it } from "vitest";

import { loopsAnywhere } from "./outlines";

const corners = (points: Array<[number, number]>, closed: boolean) => ({
  closed,
  nodes: points.map(([x, y]) => ({
    point: { x, y },
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  })),
});

describe("loopsAnywhere, the tests' own crossing check", () => {
  it("finds the last piece of an open outline crossing its first", () => {
    const hook = corners(
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [50, -50],
      ],
      false,
    );
    expect(loopsAnywhere(hook)).toBe(true);
  });

  it("does not close an open outline to find a crossing", () => {
    const zigzag: Array<[number, number]> = [
      [0, 0],
      [100, 0],
      [0, 100],
      [100, 100],
    ];
    expect(loopsAnywhere(corners(zigzag, false))).toBe(false);
    expect(loopsAnywhere(corners(zigzag, true))).toBe(true);
  });
});
