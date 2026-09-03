import { describe, expect, it } from "vitest";

import { contourArea, contoursBounds } from "./geometry";
import {
  classifyContours,
  correctDirection,
  directionIsCorrect,
  insertExtrema,
  missingExtrema,
} from "./outline";
import type { Contour } from "./types";

/** An arc that peaks between its two nodes, so the top has no point on it. */
const arch = (): Contour => ({
  closed: true,
  nodes: [
    { point: { x: 0, y: 0 }, handleIn: null, handleOut: { x: 0, y: 110 }, type: "corner" },
    { point: { x: 200, y: 0 }, handleIn: { x: 200, y: 110 }, handleOut: null, type: "corner" },
  ],
});

/** A square, drawn counter-clockwise (positive area). */
const square = (size = 100, offset = 0): Contour => ({
  closed: true,
  nodes: [
    { point: { x: offset, y: offset }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: offset + size, y: offset }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: offset + size, y: offset + size }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: offset, y: offset + size }, handleIn: null, handleOut: null, type: "corner" },
  ],
});

describe("insertExtrema", () => {
  it("adds a point where a curve turns", () => {
    const before = arch();
    expect(missingExtrema(before)).toBe(1);

    const after = insertExtrema(before);
    expect(missingExtrema(after)).toBe(0);
    expect(after.nodes.length).toBe(before.nodes.length + 1);
  });

  it("puts the new point exactly on the curve, at the top", () => {
    const after = insertExtrema(arch());
    const top = after.nodes.reduce((a, b) => (a.point.y > b.point.y ? a : b));
    // The arch peaks halfway across, at three quarters of the handle height.
    expect(top.point.x).toBeCloseTo(100, 6);
    expect(top.point.y).toBeCloseTo(82.5, 6);
  });

  it("leaves the outline where it was", () => {
    const before = contoursBounds([arch()]);
    const after = contoursBounds([insertExtrema(arch())]);
    for (const key of ["xMin", "yMin", "xMax", "yMax"] as const) {
      expect(after[key]).toBeCloseTo(before[key], 6);
    }
  });

  it("leaves straight lines alone", () => {
    const before = square();
    const after = insertExtrema(before);
    expect(after.nodes.length).toBe(before.nodes.length);
  });
});

describe("classifyContours", () => {
  it("treats a lone contour as outer", () => {
    expect(classifyContours([square()])).toEqual([true]);
  });

  it("recognises a counter inside a shape", () => {
    // A big square with a smaller one inside it, as in an O.
    expect(classifyContours([square(300), square(100, 100)])).toEqual([true, false]);
  });

  it("recognises a shape inside a counter", () => {
    // Three nested rings: outer, counter, and an island in the middle.
    expect(classifyContours([square(500), square(300, 100), square(100, 200)])).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("does not call an overlapping piece a counter", () => {
    /*
     * A `C` and a bar laid across its mouth, which is the shape of a traced
     * letter: strokes that overlap without either being inside the other. The
     * bar's box fits inside the `C`'s and the middle of the bar stands on the
     * `C`'s ink, so on one interior point it read as a counter -- and the foot
     * of a traced `u` was punched out of its own letter, which handed the
     * union back four pieces with a seam across the stem.
     */
    const at = (x: number, y: number) => ({
      point: { x, y },
      handleIn: null,
      handleOut: null,
      type: "corner" as const,
    });
    const cee: Contour = {
      closed: true,
      nodes: [
        at(0, 0),
        at(1000, 0),
        at(1000, 300),
        at(300, 300),
        at(300, 700),
        at(1000, 700),
        at(1000, 1000),
        at(0, 1000),
      ],
    };
    const bar: Contour = {
      closed: true,
      nodes: [at(50, 400), at(500, 400), at(500, 600), at(50, 600)],
    };
    expect(classifyContours([cee, bar])).toEqual([true, true]);
  });
});

describe("correctDirection", () => {
  it("winds outer contours clockwise for TrueType", () => {
    const fixed = correctDirection([square()], "truetype");
    expect(contourArea(fixed[0])).toBeLessThan(0); // negative area is clockwise
    expect(directionIsCorrect(fixed, "truetype")).toBe(true);
  });

  it("winds outer contours the other way for PostScript curves", () => {
    const fixed = correctDirection([square()], "cff");
    expect(contourArea(fixed[0])).toBeGreaterThan(0);
    expect(directionIsCorrect(fixed, "cff")).toBe(true);
  });

  it("winds a counter against its surrounding shape", () => {
    const fixed = correctDirection([square(300), square(100, 100)], "truetype");
    expect(contourArea(fixed[0])).toBeLessThan(0); // outer clockwise
    expect(contourArea(fixed[1])).toBeGreaterThan(0); // counter anticlockwise
  });

  it("does not move any points, only the order they are visited in", () => {
    const before = square(300);
    const after = correctDirection([before], "truetype")[0];
    const key = (c: Contour) =>
      c.nodes
        .map((n) => `${n.point.x},${n.point.y}`)
        .sort()
        .join(" ");
    expect(key(after)).toBe(key(before));
  });
});
