import { describe, expect, it } from "vitest";

import { contoursBounds } from "./geometry";
import { pixelate } from "./pixel";
import type { Contour, Vec2 } from "./types";

const EM = 1000;

function polygon(points: Vec2[]): Contour {
  return {
    closed: true,
    nodes: points.map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" })),
  };
}

function rect(x: number, y: number, width: number, height: number): Contour {
  return polygon([
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ]);
}

/** Every x where a vertical edge falls, which is where cell walls end up. */
function verticalEdges(contours: Contour[]): number[] {
  const xs = new Set<number>();
  for (const contour of contours) for (const node of contour.nodes) xs.add(node.point.x);
  return [...xs].sort((a, b) => a - b);
}

const grid = (pixelsPerEm: number, threshold?: number) => ({
  pixelsPerEm,
  unitsPerEm: EM,
  ...(threshold === undefined ? {} : { threshold }),
});

describe("pixelate", () => {
  it("snaps a shape onto the grid", () => {
    // A cell is 100 units at ten to the em. This bar spans two cells exactly.
    const result = pixelate([rect(100, 0, 200, 500)], grid(10));
    const bounds = contoursBounds(result);
    expect(bounds.xMin).toBeCloseTo(100, 6);
    expect(bounds.xMax).toBeCloseTo(300, 6);
    expect(bounds.yMin).toBeCloseTo(0, 6);
    expect(bounds.yMax).toBeCloseTo(500, 6);
  });

  it("rounds a shape that does not sit on the grid out to whole cells", () => {
    const result = pixelate([rect(120, 10, 170, 480)], grid(10));
    for (const x of verticalEdges(result)) {
      expect(x % 100).toBeCloseTo(0, 6);
    }
  });

  it("makes right angles out of a curve", () => {
    const circle: Contour = {
      closed: true,
      nodes: [
        { point: { x: 100, y: 500 }, handleIn: { x: 100, y: 279 }, handleOut: { x: 100, y: 721 }, type: "smooth" },
        { point: { x: 500, y: 900 }, handleIn: { x: 279, y: 900 }, handleOut: { x: 721, y: 900 }, type: "smooth" },
        { point: { x: 900, y: 500 }, handleIn: { x: 900, y: 721 }, handleOut: { x: 900, y: 279 }, type: "smooth" },
        { point: { x: 500, y: 100 }, handleIn: { x: 721, y: 100 }, handleOut: { x: 279, y: 100 }, type: "smooth" },
      ],
    };
    const result = pixelate([circle], grid(10));
    expect(result.length).toBeGreaterThan(0);
    // Nothing curved survives: every node is a corner with no handles.
    for (const contour of result) {
      for (const node of contour.nodes) {
        expect(node.handleIn).toBeNull();
        expect(node.handleOut).toBeNull();
      }
    }
  });

  /**
   * The reason the grid is pinned to the em rather than to each glyph.
   *
   * Two letters whose stems stand at different offsets have to quantise onto
   * the same cell walls. Aligning the grid to each glyph's own bounding box
   * would put them on different sub-pixel offsets, and a word set in the result
   * would come out with stems of visibly different weights.
   */
  it("puts two different letters on the same grid", () => {
    const first = pixelate([rect(100, 0, 200, 500)], grid(10));
    const second = pixelate([rect(420, 0, 200, 500)], grid(10));
    for (const x of [...verticalEdges(first), ...verticalEdges(second)]) {
      expect(x % 100).toBeCloseTo(0, 6);
    }
  });

  /**
   * The reason coverage is measured rather than sampled at the centre.
   *
   * A stem narrower than a cell, falling between two cell centres, is invisible
   * to centre sampling and the letter loses a leg. Measuring how much of the
   * cell is covered keeps it.
   */
  it("keeps a stroke thinner than one cell", () => {
    // 40 units wide, sitting between the centres of two 100-unit cells.
    const thin = rect(180, 0, 40, 500);
    const result = pixelate([thin], grid(10, 0.2));
    expect(result.length).toBeGreaterThan(0);
    expect(contoursBounds(result).xMax).toBeGreaterThan(contoursBounds(result).xMin);
  });

  it("drops a stroke too faint to reach the threshold", () => {
    const hairline = rect(180, 0, 4, 500);
    // At half coverage a sliver this thin should not fill a cell.
    expect(pixelate([hairline], grid(10, 0.5))).toEqual([hairline]);
  });

  it("merges a solid block into one rectangle rather than many cells", () => {
    // Five cells by five: naive output would be 25 squares.
    const result = pixelate([rect(0, 0, 500, 500)], grid(10));
    expect(result).toHaveLength(1);
    expect(result[0].nodes).toHaveLength(4);
  });

  /**
   * The counter survives because no rectangle is emitted for it, not because
   * of winding: the cells inside it are never filled, so the blocks tile around
   * the hole and leave it alone.
   */
  it("keeps a counter open rather than filling it in", () => {
    const ring = [rect(0, 0, 500, 500), rect(200, 200, 100, 100)];
    const result = pixelate(ring, grid(10));
    const bounds = contoursBounds(result);
    expect(bounds.xMin).toBeCloseTo(0, 6);
    expect(bounds.xMax).toBeCloseTo(500, 6);

    const covers = (point: Vec2): boolean =>
      result.some((contour) => {
        const box = contoursBounds([contour]);
        return (
          point.x > box.xMin && point.x < box.xMax && point.y > box.yMin && point.y < box.yMax
        );
      });
    // Inside the counter: nothing may cover it.
    expect(covers({ x: 250, y: 250 })).toBe(false);
    // Inside the ring itself: something must.
    expect(covers({ x: 50, y: 250 })).toBe(true);
    expect(covers({ x: 450, y: 250 })).toBe(true);
  });

  it("reaches below the baseline for a descender", () => {
    const descender = rect(100, -300, 200, 400);
    const bounds = contoursBounds(pixelate([descender], grid(10)));
    expect(bounds.yMin).toBeCloseTo(-300, 6);
  });

  it("leaves the outline alone for a grid too coarse or too fine to mean anything", () => {
    const bar = rect(100, 0, 200, 500);
    expect(pixelate([bar], grid(1))).toEqual([bar]);
    expect(pixelate([bar], grid(4096))).toEqual([bar]);
  });

  it("has nothing to do with an empty glyph", () => {
    expect(pixelate([], grid(16))).toEqual([]);
  });
});
