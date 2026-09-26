import { describe, expect, it } from "vitest";

import {
  capAgreement,
  carryTrend,
  fewestStops,
  inkRun,
  medianOver,
  straightTo,
  terminalGuard,
} from "./fit";
import { rasterise } from "./raster";
import type { Contour } from "@/font/types";
import type { QuillCubic } from "./types";

/** A straight run of pixels along the x axis, one per unit. */
const along = (count: number): Array<[number, number]> =>
  Array.from({ length: count }, (_, index) => [index, 0] as [number, number]);

/** A filled rectangle, as one contour. */
function box(x0: number, y0: number, x1: number, y1: number): Contour {
  const corner = (x: number, y: number) => ({
    point: { x, y },
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  });
  return {
    nodes: [corner(x0, y0), corner(x1, y0), corner(x1, y1), corner(x0, y1)],
    closed: true,
  };
}

describe("the width along a traced path", () => {
  /*
   * A stroke ninety wide cut square: the reading climbs two units of width per
   * unit along until the sides are nearer than the end, forty-five in, and is
   * steady after. The guard is where the climb stops, from either end.
   */
  it("guards the stretch where the field is measuring the end", () => {
    const widths = Array.from({ length: 200 }, (_, index) =>
      Math.min(90, 2 * Math.min(index, 199 - index)),
    );
    const path = along(200);
    const head = terminalGuard(widths, path, 1, true);
    const foot = terminalGuard(widths, path, 1, false);
    expect(head).toBeGreaterThanOrEqual(38);
    expect(head).toBeLessThanOrEqual(45);
    expect(foot).toBe(head);
  });

  it("does not guard a stroke that is only widening slowly", () => {
    const widths = Array.from({ length: 200 }, (_, index) => 30 + index * 0.4);
    expect(terminalGuard(widths, along(200), 1, true)).toBe(0);
  });

  it("carries a steady stroke's width flat out to its tip", () => {
    const widths = [0, 10, 20, 30, 90, 90, 90, 90, 90, 90];
    carryTrend(widths, along(widths.length), 1, true, 4);
    expect(widths).toEqual(new Array(10).fill(90));
  });

  it("rejects a bump with stroke either side of it and leaves the ends", () => {
    const widths = [30, 100, 100, 100, 100, 250, 100, 100, 100, 100, 30];
    medianOver(widths, 2);
    expect(widths[5]).toBe(100);
    expect(widths[0]).toBe(30);
    expect(widths[10]).toBe(30);
  });

  it("keeps the ends and the one stop a swelling needs", () => {
    const widths = Array.from({ length: 21 }, (_, index) => 100 - Math.abs(index - 10) * 5);
    const places = widths.map((_, index) => index / 20);
    const kept = fewestStops(widths, places, 6);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(20);
    expect(kept).toContain(10);
    // A steady run needs nothing but its ends.
    expect(fewestStops(new Array(21).fill(80), places, 6)).toEqual([0, 20]);
  });
});

describe("the ends of a traced stroke", () => {
  const grid = rasterise([box(0, 0, 200, 100)], 1)!;

  it("measures how far the ink runs, and nought from outside it", () => {
    expect(inkRun(grid, 150, 50, 1, 0, 200, 1)).toBeGreaterThan(45);
    expect(inkRun(grid, 150, 50, 1, 0, 200, 1)).toBeLessThanOrEqual(50);
    // Capped at what it was asked to look for.
    expect(inkRun(grid, 50, 50, 1, 0, 20, 1)).toBe(20);
    expect(inkRun(grid, 250, 50, 1, 0, 200, 1)).toBe(0);
  });

  /*
   * The end of the box is cut square, a hundred wide: a rectangle describes it
   * better than a disc, which leaves both corners empty.
   */
  it("prefers a square cap on an end cut square", () => {
    const seat = { x: 180, y: 50 };
    const out = { x: 1, y: 0 };
    const across = { x: 0, y: 1 };
    const square = capAgreement(grid, seat, out, across, 50, 20, false);
    const round = capAgreement(grid, seat, out, across, 50, 20, true);
    expect(square).toBeGreaterThan(round);
  });

  it("lays the last stretch straight to a new end", () => {
    const edge: QuillCubic = {
      kind: "cubic",
      from: { x: 0, y: 0 },
      c1: { x: 50, y: 80 },
      c2: { x: 90, y: -40 },
      to: { x: 100, y: 0 },
    };
    const laid = straightTo(edge, { x: 90, y: 30 });
    expect(laid.from).toBe(edge.from);
    expect(laid.to).toEqual({ x: 90, y: 30 });
    expect(laid.c1.x).toBeCloseTo(30, 9);
    expect(laid.c1.y).toBeCloseTo(10, 9);
    expect(laid.c2.x).toBeCloseTo(60, 9);
    expect(laid.c2.y).toBeCloseTo(20, 9);
  });
});
