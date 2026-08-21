import { beforeAll, describe, expect, it } from "vitest";

import { intersect, pieces, ready, subtract, unite } from "./boolean";
import { contourArea, contoursBounds } from "./geometry";
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

/** Ink, counting a hole as the ink it takes away. */
const ink = (contours: Contour[]): number =>
  contours.reduce((total, contour) => total + contourArea(contour), 0);

beforeAll(async () => {
  await ready();
});

describe("subtract", () => {
  it("cuts a hole through the middle", () => {
    const cut = subtract([rect(0, 0, 100, 100)], [rect(40, 40, 20, 20)]);
    expect(cut.length).toBe(2);
    expect(Math.abs(ink(cut))).toBeCloseTo(100 * 100 - 20 * 20, 3);
    // One piece, with a hole in it rather than a second piece.
    expect(pieces(cut)).toBe(1);
  });

  it("cuts a letter in two when the slot goes all the way through", () => {
    // A band the full width of the shape, which is what a slot cut too wide is.
    const cut = subtract([rect(0, 0, 100, 100)], [rect(-10, 45, 120, 10)]);
    expect(pieces(cut)).toBe(2);
    expect(Math.abs(ink(cut))).toBeCloseTo(100 * 90, 3);
  });

  it("takes the whole shape when the tool covers it", () => {
    expect(subtract([rect(0, 0, 100, 100)], [rect(-10, -10, 120, 120)])).toEqual([]);
  });

  it("leaves a shape alone when the tool misses it", () => {
    const cut = subtract([rect(0, 0, 100, 100)], [rect(500, 500, 20, 20)]);
    expect(Math.abs(ink(cut))).toBeCloseTo(100 * 100, 3);
    const bounds = contoursBounds(cut);
    expect(bounds.xMax).toBeCloseTo(100, 3);
  });

  it("cuts every piece of a tool made of several", () => {
    // A comb: three teeth into the same edge.
    const teeth = [rect(-5, 10, 20, 10), rect(-5, 40, 20, 10), rect(-5, 70, 20, 10)];
    const cut = subtract([rect(0, 0, 100, 100)], teeth);
    expect(Math.abs(ink(cut))).toBeCloseTo(100 * 100 - 3 * (15 * 10), 3);
  });

  it("takes the same ink away whether the shape was fused first or not", () => {
    // Worth stating, because it is the reason fusing first is not about
    // correctness: subtraction distributes over a union.
    const stem = rect(40, 0, 20, 100);
    const serif = rect(20, 0, 60, 12);
    const slot = rect(30, 4, 40, 4);

    const cut = [...subtract([stem], [slot]), ...subtract([serif], [slot])];
    const apart = unite(cut, "winding");
    const together = subtract(unite([stem, serif], "winding"), [slot]);
    expect(Math.abs(ink(apart))).toBeCloseTo(Math.abs(ink(together)), 3);
  });
});

describe("intersect", () => {
  it("keeps only what both shapes cover", () => {
    const both = intersect([rect(0, 0, 100, 100)], [rect(50, 50, 100, 100)]);
    expect(Math.abs(ink(both))).toBeCloseTo(50 * 50, 3);
  });

  it("is empty when they do not meet", () => {
    expect(intersect([rect(0, 0, 10, 10)], [rect(90, 90, 10, 10)])).toEqual([]);
  });
});

describe("pieces", () => {
  it("only means anything once the shape has been fused", () => {
    // Why every cut runs on a fused outline. A stem with a serif laid over it
    // is one letter drawn as two overlapping pieces, and counted before they
    // are fused it reads as two -- which would make the check for a letter cut
    // in half report every serifed letter in the font.
    const overlapping = [rect(40, 0, 20, 100), rect(20, 0, 60, 12)];
    expect(pieces(overlapping)).toBe(2);
    expect(pieces(unite(overlapping))).toBe(1);
  });

  it("counts shapes, not contours", () => {
    // A ring is one piece: an outer contour and a hole.
    expect(pieces(subtract([rect(0, 0, 100, 100)], [rect(25, 25, 50, 50)]))).toBe(1);
    expect(pieces([rect(0, 0, 10, 10), rect(50, 50, 10, 10)])).toBe(2);
    expect(pieces([])).toBe(0);
  });
});

describe("unite", () => {
  it("is the same fuse the export has always used", () => {
    const merged = unite([rect(0, 0, 100, 100), rect(50, 50, 100, 100)]);
    expect(merged.length).toBe(1);
    expect(Math.abs(contourArea(merged[0]))).toBeCloseTo(17_500, -1);
  });

  it("keeps a piece that sits inside another piece, when told to read the winding", () => {
    // The foot of a stem, inside the serif laid across it. Counted by nesting
    // the foot is enclosed once and reads as a hole, so it is punched out of
    // its own serif and the letter loses ink it was drawn with.
    const foot = rect(40, 2, 20, 8);
    const serif = rect(20, 0, 60, 12);

    expect(Math.abs(ink(unite([serif, foot])))).toBeCloseTo(60 * 12 - 20 * 8, 3);
    expect(Math.abs(ink(unite([serif, foot], "winding")))).toBeCloseTo(60 * 12, 3);
  });

  it("still keeps a real counter as a hole when reading the winding", () => {
    const ring = rect(0, 0, 100, 100);
    const hole = { ...rect(25, 25, 50, 50), nodes: [...rect(25, 25, 50, 50).nodes].reverse() };
    const merged = unite([ring, hole, rect(90, 40, 40, 20)], "winding");
    const areas = merged.map(contourArea);
    expect(areas.some((area) => area > 0)).toBe(true);
    expect(areas.some((area) => area < 0)).toBe(true);
  });
});
