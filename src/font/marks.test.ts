/**
 * What the marks have to get right.
 *
 * Both of these exist to point at a fault nobody can see by looking, so the
 * test that matters most for each is the negative one: a mark on a drawing
 * that is fine is worse than no mark at all, because a designer who learns to
 * ignore the rings stops seeing the real ones.
 */

import { describe, expect, it } from "vitest";

import { NEARLY_STRAIGHT, extremesMissing, nearlySmooth, offSmooth } from "@/font/marks";
import type { Contour, GlyphNode } from "@/font/types";

const node = (x: number, y: number, into: [number, number] | null, out: [number, number] | null, type: GlyphNode["type"] = "smooth"): GlyphNode => ({
  point: { x, y },
  handleIn: into ? { x: into[0], y: into[1] } : null,
  handleOut: out ? { x: out[0], y: out[1] } : null,
  type,
});

/** A circle of radius 100 with a point at each of the four extremes. */
function circle(): Contour {
  const k = 100 * 0.5523;
  return {
    closed: true,
    nodes: [
      node(100, 0, [100, -k], [100, k]),
      node(0, 100, [k, 100], [-k, 100]),
      node(-100, 0, [-100, k], [-100, -k]),
      node(0, -100, [-k, -100], [k, -100]),
    ],
  };
}

describe("extremes that have no point on them", () => {
  it("says nothing about a circle drawn on its extremes", () => {
    expect(extremesMissing([circle()])).toEqual([]);
  });

  it("says nothing about a straight line, which has no interior turn", () => {
    const line: Contour = {
      closed: false,
      nodes: [node(0, 0, null, null, "corner"), node(100, 100, null, null, "corner")],
    };
    expect(extremesMissing([line])).toEqual([]);
  });

  it("finds the top of a circle drawn on the diagonals", () => {
    /*
     * The same circle turned 45 degrees: the points now sit on the diagonals
     * and the extremes -- top, bottom, left, right -- fall mid-segment, which
     * is exactly the drawing the rule exists to catch. Turned rather than typed
     * out, because a circle written by hand is a circle with a typo in it: the
     * first version of this test had one handle copied from the wrong node and
     * failed for that reason rather than for anything about the code.
     */
    const turn = (v: { x: number; y: number }) => ({
      x: (v.x - v.y) / Math.SQRT2,
      y: (v.x + v.y) / Math.SQRT2,
    });
    const turned: Contour = {
      closed: true,
      nodes: circle().nodes.map((one) => ({
        point: turn(one.point),
        handleIn: one.handleIn ? turn(one.handleIn) : null,
        handleOut: one.handleOut ? turn(one.handleOut) : null,
        type: one.type,
      })),
    };
    const found = extremesMissing([turned]);
    expect(found).toHaveLength(4);
    // One of them is the top of the circle, a hair under the true radius
    // because a cubic quarter-circle is a hair under a circle.
    const top = found.reduce((best, one) => (one.y > best.y ? one : best));
    expect(top.x).toBeCloseTo(0, 6);
    expect(top.y).toBeCloseTo(100, 0);
  });
});

describe("points a hair from smooth", () => {
  it("says nothing about a truly smooth point", () => {
    expect(nearlySmooth([circle()])).toEqual([]);
  });

  it("says nothing about a corner somebody meant", () => {
    // A right angle: forty-five times further off than the threshold.
    const corner: Contour = {
      closed: false,
      nodes: [
        node(0, 0, null, [0, 30], "corner"),
        node(0, 100, [0, 70], [30, 100], "corner"),
        node(100, 100, [70, 100], null, "corner"),
      ],
    };
    expect(nearlySmooth([corner])).toEqual([]);
  });

  it("finds a point two degrees off, and says how far", () => {
    const off = 2;
    const radians = (off * Math.PI) / 180;
    const kink: Contour = {
      // Closed, because the marks now speak only about finished shapes: a
      // point in a drawing still being made is not a fault, it is a point that
      // has not been placed yet.
      closed: true,
      nodes: [
        node(0, 0, null, [0, 30], "corner"),
        // Arriving straight up; leaving two degrees off straight up.
        node(0, 100, [0, 70], [30 * Math.sin(radians), 100 + 30 * Math.cos(radians)], "smooth"),
        node(0, 200, [0, 170], null, "corner"),
      ],
    };
    const found = nearlySmooth([kink]);
    expect(found).toHaveLength(1);
    expect(found[0].node).toBe(1);
    expect(found[0].degrees).toBeCloseTo(off, 3);
  });

  it("asks the geometry, not the label", () => {
    // Typed a corner, drawn smooth-ish: still a hair off, still reported.
    const radians = (1 * Math.PI) / 180;
    const mislabelled: Contour = {
      closed: true,
      nodes: [
        node(0, 0, null, [0, 30], "corner"),
        node(0, 100, [0, 70], [30 * Math.sin(radians), 100 + 30 * Math.cos(radians)], "corner"),
        node(0, 200, [0, 170], null, "corner"),
      ],
    };
    expect(nearlySmooth([mislabelled])).toHaveLength(1);
  });

  it("has nothing to say where there is no angle", () => {
    expect(offSmooth(node(0, 0, null, [0, 30], "corner"))).toBeNull();
    expect(offSmooth(node(0, 0, [0, 0], [0, 30], "corner"))).toBeNull();
  });

  it("keeps the threshold where a deliberate corner is safe", () => {
    expect(NEARLY_STRAIGHT).toBeLessThan(10);
  });
});

describe("a shape still being drawn", () => {
  /*
   * The noise that made the switch useless.
   *
   * Turned on part way through a letter, every unfinished contour was ringed
   * at every place its curve had not reached a point yet -- which is most of
   * them, since it is half a drawing. Twenty rings all saying "you have not
   * finished" is not advice, and a person who learns to ignore the rings has
   * stopped seeing the real ones.
   */
  /*
   * An arch: the first segment bulges upward, so its highest place falls
   * halfway along rather than on either end point. Closed, that is a missing
   * extreme; open, it is a drawing somebody is still making.
   */
  const halfDrawn: Contour = {
    closed: false,
    nodes: [
      node(0, 0, null, [0, 100], "smooth"),
      node(100, 0, [100, 100], null, "smooth"),
      node(50, -50, null, null, "corner"),
    ],
  };

  it("has no missing extremes, because it is not finished", () => {
    expect(extremesMissing([halfDrawn])).toEqual([]);
    // The same run closed does have one, so the silence above is the open
    // contour rule rather than a curve that happens to turn nowhere.
    expect(extremesMissing([{ ...halfDrawn, closed: true }]).length).toBeGreaterThan(0);
  });

  it("has no kinks either", () => {
    const radians = (2 * Math.PI) / 180;
    const kinked: Contour = {
      closed: false,
      nodes: [
        node(0, 0, null, [0, 30], "corner"),
        node(0, 100, [0, 70], [30 * Math.sin(radians), 100 + 30 * Math.cos(radians)], "smooth"),
        node(0, 200, [0, 170], null, "corner"),
      ],
    };
    expect(nearlySmooth([kinked])).toEqual([]);
    expect(nearlySmooth([{ ...kinked, closed: true }])).toHaveLength(1);
  });
});
