/**
 * That a transform moves the whole letter and not most of it.
 *
 * The interesting cases here are the ones where a plausible implementation
 * goes wrong quietly: a handle left behind while its node moves, a mirrored
 * letter whose counters fill in solid, an italic whose feet wander off the
 * line it is supposed to stand on. Each of those produces a letter that is
 * still recognisably a letter, which is exactly why they need a test rather
 * than an eye.
 */

import { describe, expect, it } from "vitest";

import {
  alignedTo,
  apply,
  boundsOfPoints,
  centreOf,
  mirror,
  rotated,
  scaled,
  slanted,
  transformContours,
  transformNode,
  IDENTITY,
} from "./reshape";
import { contourArea } from "./geometry";
import type { Contour, GlyphNode } from "./types";

const node = (x: number, y: number, hi?: [number, number], ho?: [number, number]): GlyphNode => ({
  point: { x, y },
  handleIn: hi ? { x: hi[0], y: hi[1] } : null,
  handleOut: ho ? { x: ho[0], y: ho[1] } : null,
  type: "corner",
});

/** A square from the origin, wound anticlockwise. */
const square = (size: number): Contour => ({
  closed: true,
  nodes: [node(0, 0), node(size, 0), node(size, size), node(0, size)],
});

const close = (value: number, want: number) => expect(value).toBeCloseTo(want, 6);

describe("what a transform does to a node", () => {
  it("moves the handles with the point", () => {
    /*
     * Handles are absolute in this model, not offsets from the node they
     * belong to. A transform that moved only the points would turn every
     * curve's ends and leave its middle where it was.
     */
    const moved = transformNode(node(10, 0, [5, 0], [15, 0]), rotated(90, { x: 0, y: 0 }));
    close(moved.point.x, 0);
    close(moved.point.y, 10);
    close(moved.handleIn!.x, 0);
    close(moved.handleIn!.y, 5);
    close(moved.handleOut!.x, 0);
    close(moved.handleOut!.y, 15);
  });

  it("leaves a node with no handles without any", () => {
    const moved = transformNode(node(1, 2), scaled(2, 2, { x: 0, y: 0 }));
    expect(moved.handleIn).toBeNull();
    expect(moved.handleOut).toBeNull();
    expect(moved.point).toEqual({ x: 2, y: 4 });
  });

  it("does nothing at all when asked to do nothing", () => {
    const one = node(3, 4, [1, 1], [5, 5]);
    expect(transformNode(one, IDENTITY)).toEqual(one);
  });
});

describe("turning and flipping about a point", () => {
  it("leaves the centre of a rotation where it was", () => {
    const centre = { x: 50, y: 50 };
    close(apply(rotated(37, centre), centre).x, 50);
    close(apply(rotated(37, centre), centre).y, 50);
  });

  it("turns anticlockwise, as degrees are counted everywhere else here", () => {
    const turned = apply(rotated(90, { x: 0, y: 0 }), { x: 10, y: 0 });
    close(turned.x, 0);
    close(turned.y, 10);
  });

  it("mirrors left to right about the middle of what was picked", () => {
    const box = square(100);
    const flipped = transformContours([box], mirror("horizontal", centreOf([box])));
    const bounds = boundsOfPoints(flipped);
    // The same box, in the same place: a mirror about a shape's own centre
    // moves the points and not the shape's position.
    expect(bounds).toEqual({ xMin: 0, yMin: 0, xMax: 100, yMax: 100 });
  });

  it("turns a flipped contour back the right way round", () => {
    /*
     * The one that would ship quietly. A mirror reverses the winding of every
     * contour, and winding is what decides whether a contour fills or cuts a
     * hole -- so a flipped letter whose directions were left alone comes back
     * with its counters solid.
     */
    const before = square(100);
    const after = transformContours([before], mirror("horizontal", centreOf([before])))[0];
    expect(Math.sign(contourArea(after))).toBe(Math.sign(contourArea(before)));
  });

  it("keeps the winding when the transform does not flip", () => {
    const before = square(100);
    const turn = rotated(45, centreOf([before]));
    const after = transformContours([before], turn)[0];
    expect(Math.sign(contourArea(after))).toBe(Math.sign(contourArea(before)));
    /*
     * And the points are still in the order they were drawn in: the first node
     * of the result is the first node of the original, moved. A reversal would
     * keep the winding sign wrong and this right, or the other way about, so
     * both are worth asking.
     */
    const expected = apply(turn, before.nodes[0].point);
    close(after.nodes[0].point.x, expected.x);
    close(after.nodes[0].point.y, expected.y);
  });

  it("puts a scaled shape back around the centre it was scaled about", () => {
    const box = square(100);
    const bigger = transformContours([box], scaled(2, 2, centreOf([box])));
    const bounds = boundsOfPoints(bigger);
    expect(bounds).toEqual({ xMin: -50, yMin: -50, xMax: 150, yMax: 150 });
  });
});

describe("slanting, which is how an italic is made", () => {
  it("pivots on the baseline, so the feet stay on the line", () => {
    /*
     * The type-specific decision in this file. A shear about the middle of a
     * letter leaves its top leaning one way and its foot the other, which is
     * not an italic -- it is a letter that has come off its line. An italic
     * leans off the baseline: everything above moves, the feet do not.
     */
    const lean = slanted(12);
    const foot = apply(lean, { x: 100, y: 0 });
    close(foot.x, 100);
    close(foot.y, 0);

    const top = apply(lean, { x: 100, y: 700 });
    close(top.x, 100 + 700 * Math.tan((12 * Math.PI) / 180));
    close(top.y, 700);
  });

  it("leans a descender the other way, because it is below the pivot", () => {
    const under = apply(slanted(12), { x: 100, y: -200 });
    expect(under.x).toBeLessThan(100);
  });

  it("takes another pivot when one is named", () => {
    // An x-height pivot is how a small capital gets a slant without its feet
    // wandering off where the lowercase sits.
    const atX = apply(slanted(12, 500), { x: 100, y: 500 });
    close(atX.x, 100);
  });

  it("leaves the height alone", () => {
    // A slant is a shear, not a rotation: nothing gets taller or shorter.
    const box = square(100);
    const leaned = transformContours([box], slanted(20));
    const bounds = boundsOfPoints(leaned);
    close(bounds.yMax - bounds.yMin, 100);
  });
});

describe("lining points up with each other", () => {
  const bounds = { xMin: 10, yMin: 20, xMax: 110, yMax: 220 };

  it("takes the target from the points, not from the letter around them", () => {
    // Aligning three points to the left means the leftmost of those three,
    // which is what makes it useful for levelling the two feet of an `n`.
    expect(alignedTo("left", bounds)({ x: 90, y: 50 })).toEqual({ x: 10, y: 50 });
    expect(alignedTo("right", bounds)({ x: 90, y: 50 })).toEqual({ x: 110, y: 50 });
    expect(alignedTo("top", bounds)({ x: 90, y: 50 })).toEqual({ x: 90, y: 220 });
    expect(alignedTo("bottom", bounds)({ x: 90, y: 50 })).toEqual({ x: 90, y: 20 });
  });

  it("moves one axis and leaves the other exactly as it was", () => {
    const moved = alignedTo("left", bounds)({ x: 90, y: 57 });
    expect(moved.y).toBe(57);
  });

  it("centres between the two edges", () => {
    expect(alignedTo("centreX", bounds)({ x: 0, y: 5 })).toEqual({ x: 60, y: 5 });
    expect(alignedTo("centreY", bounds)({ x: 5, y: 0 })).toEqual({ x: 5, y: 120 });
  });
});

describe("the box a transform happens about", () => {
  it("is measured off the points rather than off the drawn shape", () => {
    /*
     * A curve bulges past its own control points, so the ink and the points
     * disagree. The points are what somebody has selected and can see, and a
     * rotation about a centre they cannot see is one they cannot predict.
     */
    const bulge: Contour = {
      closed: false,
      nodes: [node(0, 0, undefined, [0, 100]), node(100, 0, [100, 100])],
    };
    expect(boundsOfPoints([bulge])).toEqual({ xMin: 0, yMin: 0, xMax: 100, yMax: 100 });
    expect(centreOf([bulge])).toEqual({ x: 50, y: 50 });
  });

  it("holds an empty set without giving back nonsense", () => {
    const box = boundsOfPoints([]);
    expect(Number.isFinite(box.xMin)).toBe(true);
    expect(Number.isFinite(box.yMax)).toBe(true);
  });
});
