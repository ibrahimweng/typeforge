/**
 * That a dragged line becomes a drawing rather than a recording of a hand.
 *
 * A pointer reports every few milliseconds, so a stroke drawn across a letter
 * in a second arrives as two or three hundred positions. A contour with three
 * hundred nodes in it is not an outline anybody can edit, and every test here
 * is about the distance between what the hand did and what ends up in the
 * file.
 */

import { describe, expect, it } from "vitest";

import { strokeToContour, thinned } from "./freehand";
import { contoursBounds } from "./geometry";
import type { Vec2 } from "./types";

/** A run of positions along a line, as a pointer would report it. */
const along = (from: Vec2, to: Vec2, count: number): Vec2[] =>
  Array.from({ length: count }, (_, index) => ({
    x: from.x + ((to.x - from.x) * index) / (count - 1),
    y: from.y + ((to.y - from.y) * index) / (count - 1),
  }));

/** A circle, drawn the way a hand draws one: many positions, roughly round. */
const circled = (radius: number, count: number, closeGap = 0): Vec2[] =>
  Array.from({ length: count }, (_, index) => {
    const turn = ((Math.PI * 2 - closeGap) * index) / (count - 1);
    return { x: Math.cos(turn) * radius, y: Math.sin(turn) * radius };
  });

describe("thinning the trail", () => {
  it("drops the positions too close together to be decisions", () => {
    // Two hundred reports along a line two hundred units long: one every unit,
    // where the threshold is three.
    const trail = along({ x: 0, y: 0 }, { x: 200, y: 0 }, 200);
    const kept = thinned(trail);
    expect(kept.length).toBeLessThan(trail.length / 2);
    expect(kept.length).toBeGreaterThan(2);
  });

  it("keeps the end of the stroke, wherever it landed", () => {
    /*
     * Where the hand stopped is a decision even when it stops a fraction from
     * the position before it. Dropping it would shorten every stroke by up to
     * the threshold.
     */
    const trail = [...along({ x: 0, y: 0 }, { x: 100, y: 0 }, 40), { x: 100.5, y: 0 }];
    const kept = thinned(trail);
    expect(kept[kept.length - 1]).toEqual({ x: 100.5, y: 0 });
  });

  it("holds a stroke that never moved without falling over", () => {
    expect(thinned([{ x: 5, y: 5 }])).toEqual([{ x: 5, y: 5 }]);
    expect(thinned([])).toEqual([]);
  });
});

describe("the outline a stroke becomes", () => {
  it("is a handful of nodes rather than a hundred", () => {
    // The whole point. A straight drag reported two hundred times is one
    // curve, not two hundred.
    const contour = strokeToContour(along({ x: 0, y: 0 }, { x: 400, y: 0 }, 200))!;
    expect(contour.nodes.length).toBeLessThan(6);
    expect(contour.closed).toBe(false);
  });

  it("follows the line that was drawn", () => {
    const contour = strokeToContour(along({ x: 0, y: 0 }, { x: 400, y: 300 }, 120))!;
    const box = contoursBounds([contour]);
    expect(box.xMin).toBeCloseTo(0, 0);
    expect(box.yMin).toBeCloseTo(0, 0);
    expect(box.xMax).toBeCloseTo(400, 0);
    expect(box.yMax).toBeCloseTo(300, 0);
  });

  it("closes a stroke that came back to where it started", () => {
    // How anybody draws a bowl, and how every drawing tool has read one.
    const contour = strokeToContour(circled(200, 120))!;
    expect(contour.closed).toBe(true);
  });

  it("closes it exactly rather than nearly", () => {
    /*
     * A hand coming back to a point it left a second ago lands near it rather
     * than on it. A contour that closed across that gap would carry a straight
     * run nobody drew.
     */
    const contour = strokeToContour(circled(200, 120, 0.08))!;
    expect(contour.closed).toBe(true);
    const first = contour.nodes[0].point;
    const last = contour.nodes[contour.nodes.length - 1].point;
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeGreaterThan(0);
    // Every node carries both handles once it is closed, so the curve runs
    // through the join rather than stopping at it.
    expect(contour.nodes[0].handleIn).not.toBeNull();
    expect(contour.nodes[0].handleOut).not.toBeNull();
  });

  it("leaves a stroke open when it ended somewhere else", () => {
    const contour = strokeToContour(along({ x: 0, y: 0 }, { x: 400, y: 0 }, 90))!;
    expect(contour.closed).toBe(false);
    // An open stroke's ends are ends: nothing arrives at the first node and
    // nothing leaves the last.
    expect(contour.nodes[0].handleIn).toBeNull();
    expect(contour.nodes[contour.nodes.length - 1].handleOut).toBeNull();
  });

  it("gives back nothing for a click", () => {
    expect(strokeToContour([{ x: 10, y: 10 }])).toBeNull();
    expect(strokeToContour([])).toBeNull();
  });

  it("carries the handles between neighbouring curves", () => {
    /*
     * Two curves meeting at a point give that point both handles, which is
     * what makes the result an outline somebody can edit rather than a pile of
     * separate arcs sharing endpoints.
     */
    const wobbly = Array.from({ length: 160 }, (_, index) => ({
      x: index * 4,
      y: Math.sin(index / 8) * 120,
    }));
    const contour = strokeToContour(wobbly)!;
    expect(contour.nodes.length).toBeGreaterThan(2);
    for (const node of contour.nodes.slice(1, -1)) {
      expect(node.handleIn).not.toBeNull();
      expect(node.handleOut).not.toBeNull();
    }
  });
});
