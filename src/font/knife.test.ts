/**
 * That a cut divides a letter and does not lose any of it.
 *
 * The traversal is the part worth testing rather than reading. Walking an
 * outline from crossing to crossing and jumping along the cut between them is
 * easy to write in a way that works for a square cut in half and produces a
 * bow tie the first time a stroke crosses one contour four times -- which is
 * an `S`, a `w`, and both sides of a `V`, so it is not an exotic case.
 *
 * Area is the assertion that catches most of it. Whatever the pieces are, they
 * add up to the shape that was cut, and a traversal that took a stretch twice
 * or missed one does not.
 */

import { describe, expect, it } from "vitest";

import { slice } from "./knife";
import { contourArea, contoursBounds } from "./geometry";
import type { Contour, GlyphNode } from "./types";

const node = (x: number, y: number, hi?: [number, number], ho?: [number, number]): GlyphNode => ({
  point: { x, y },
  handleIn: hi ? { x: hi[0], y: hi[1] } : null,
  handleOut: ho ? { x: ho[0], y: ho[1] } : null,
  type: "corner",
});

const square = (size: number): Contour => ({
  closed: true,
  nodes: [node(0, 0), node(size, 0), node(size, size), node(0, size)],
});

/** A U, which one straight cut crosses four times. */
const uShape = (): Contour => ({
  closed: true,
  nodes: [
    node(0, 0),
    node(300, 0),
    node(300, 400),
    node(200, 400),
    node(200, 100),
    node(100, 100),
    node(100, 400),
    node(0, 400),
  ],
});

/** A circle drawn as four curves, so the cut has to split beziers. */
const circle = (radius: number): Contour => {
  const k = radius * 0.5523;
  const one = (x: number, y: number, hi: [number, number], ho: [number, number]): GlyphNode => ({
    point: { x, y },
    handleIn: { x: hi[0], y: hi[1] },
    handleOut: { x: ho[0], y: ho[1] },
    type: "smooth",
  });
  return {
    closed: true,
    nodes: [
      one(radius, 0, [radius, -k], [radius, k]),
      one(0, radius, [k, radius], [-k, radius]),
      one(-radius, 0, [-radius, k], [-radius, -k]),
      one(0, -radius, [-k, -radius], [k, -radius]),
    ],
  };
};

const totalArea = (contours: Contour[]): number =>
  contours.reduce((sum, one) => sum + Math.abs(contourArea(one)), 0);

describe("a cut straight through", () => {
  it("makes two closed pieces out of one", () => {
    const cut = slice([square(100)], { x: -10, y: 50 }, { x: 110, y: 50 })!;
    expect(cut).toHaveLength(2);
    expect(cut.every((piece) => piece.closed)).toBe(true);
  });

  it("loses none of the letter and takes none of it twice", () => {
    const before = square(100);
    const cut = slice([before], { x: -10, y: 50 }, { x: 110, y: 50 })!;
    expect(totalArea(cut)).toBeCloseTo(Math.abs(contourArea(before)), 6);
  });

  it("keeps every piece running the way the shape ran", () => {
    // Which way a contour runs decides whether it fills or cuts a hole. A cut
    // that reversed one of its pieces would punch a hole in the letter.
    const before = square(100);
    const cut = slice([before], { x: -10, y: 50 }, { x: 110, y: 50 })!;
    for (const piece of cut) {
      expect(Math.sign(contourArea(piece))).toBe(Math.sign(contourArea(before)));
    }
  });

  it("joins the two ends of the cut with a straight line", () => {
    /*
     * The only thing they could be joined by: a curve across the cut would be
     * a shape nobody drew. Every node lying on the cut has a null handle on
     * the side facing it.
     */
    const cut = slice([circle(100)], { x: -200, y: 0 }, { x: 200, y: 0 })!;
    for (const piece of cut) {
      const onCut = piece.nodes.filter((one) => Math.abs(one.point.y) < 1e-6);
      expect(onCut.length).toBe(2);
      // Between the two of them, exactly the two handles facing the cut are
      // gone, and the ones facing the curve are not.
      expect(onCut.some((one) => one.handleIn === null || one.handleOut === null)).toBe(true);
    }
  });

  it("cuts a curve without straightening the rest of it", () => {
    const cut = slice([circle(100)], { x: -200, y: 0 }, { x: 200, y: 0 })!;
    for (const piece of cut) {
      const curved = piece.nodes.filter((one) => one.handleIn || one.handleOut);
      expect(curved.length).toBeGreaterThan(0);
    }
    // And the two halves still reach as far as the circle did.
    const bounds = contoursBounds(cut);
    expect(bounds.xMax).toBeCloseTo(100, 3);
    expect(bounds.xMin).toBeCloseTo(-100, 3);
  });
});

describe("a cut that crosses one contour four times", () => {
  it("takes the top off both prongs of a U and leaves the U", () => {
    /*
     * The case a naive pairing gets wrong. Crossings are paired in the order
     * they fall along the cut -- first with second, third with fourth -- which
     * spans the ink and not the gap between the prongs. Pairing them in the
     * order the outline reaches them instead would join the left prong to the
     * right one straight across the empty middle.
     */
    const before = uShape();
    const cut = slice([before], { x: -50, y: 200 }, { x: 350, y: 200 })!;
    expect(cut).toHaveLength(3);
    expect(totalArea(cut)).toBeCloseTo(Math.abs(contourArea(before)), 6);

    // Two small pieces above the cut and one large one below it.
    const above = cut.filter((piece) => contoursBounds([piece]).yMin >= 199);
    expect(above).toHaveLength(2);
    for (const piece of above) {
      const box = contoursBounds([piece]);
      expect(box.xMax - box.xMin).toBeCloseTo(100, 6);
    }
  });
});

describe("a cut that does not go through", () => {
  it("says so rather than pushing an edit that changed nothing", () => {
    expect(slice([square(100)], { x: -10, y: 200 }, { x: 110, y: 200 })).toBeNull();
  });

  it("is a segment and not an endless line, so a short drag cuts nothing", () => {
    // Dragging across half a letter cuts the half you dragged across. It is
    // what makes it possible to cut one bowl of a B and not the other.
    expect(slice([square(100)], { x: -50, y: 50 }, { x: -10, y: 50 })).toBeNull();
  });

  it("leaves a shape it only grazed alone", () => {
    /*
     * A cut that starts inside the letter and stops halfway out crosses once.
     * There is no second end to join that one to, and a tool that guessed
     * would hand back a shape with a piece missing.
     */
    expect(slice([square(100)], { x: 50, y: 50 }, { x: 200, y: 50 })).toBeNull();
  });

  it("cuts the contour it crossed and leaves the ones it missed whole", () => {
    const small: Contour = {
      closed: true,
      nodes: [node(200, 200), node(260, 200), node(260, 260), node(200, 260)],
    };
    const cut = slice([square(100), small], { x: -10, y: 50 }, { x: 110, y: 50 })!;
    expect(cut).toHaveLength(3);
    expect(cut).toContainEqual(small);
  });
});

describe("a cut that lands on the points a letter already has", () => {
  it("goes through a circle cut at the height of its own extremes", () => {
    /*
     * The case the first version of this got wrong, and the commonest one
     * there is. A letter carries a point wherever its outline reaches
     * furthest, so a horizontal cut through the widest part of a bowl lands
     * exactly on two of them -- and dropping those as endpoints reported that
     * the cut had missed a circle it went straight through.
     */
    const before = circle(100);
    const cut = slice([before], { x: -200, y: 0 }, { x: 200, y: 0 })!;
    expect(cut).toHaveLength(2);
    expect(totalArea(cut)).toBeCloseTo(Math.abs(contourArea(before)), 3);
  });

  it("goes through two corners of a square on the diagonal", () => {
    const before = square(100);
    const cut = slice([before], { x: -10, y: -10 }, { x: 110, y: 110 })!;
    expect(cut).toHaveLength(2);
    expect(totalArea(cut)).toBeCloseTo(10_000, 6);
    // Two triangles of five thousand each, not one of ten thousand and one of
    // nothing.
    for (const piece of cut) expect(Math.abs(contourArea(piece))).toBeCloseTo(5_000, 6);
  });

  it("knows a line laid along a shape from one that goes through it", () => {
    /*
     * A cut along the top of a bowl touches the node at its highest point
     * without going anywhere. Counting that as a crossing would divide a
     * letter along a line that never entered it.
     */
    expect(slice([circle(100)], { x: -200, y: 100 }, { x: 200, y: 100 })).toBeNull();
  });
});

describe("a cut across an open path", () => {
  it("makes shorter paths and does not close them", () => {
    // Nothing carries on past a cut end, and there is no chord: an open path
    // has no inside for one to cross.
    const line: Contour = { closed: false, nodes: [node(0, 0), node(100, 100)] };
    const cut = slice([line], { x: 0, y: 50 }, { x: 100, y: 50 })!;
    expect(cut).toHaveLength(2);
    expect(cut.every((piece) => piece.closed === false)).toBe(true);
    expect(cut[0].nodes[1].point.x).toBeCloseTo(50, 6);
    expect(cut[1].nodes[0].point.x).toBeCloseTo(50, 6);
  });
});
