import { describe, expect, it } from "vitest";

import { sweep } from "./sweep";
import type { QuillJoinKind, QuillSpine, QuillStroke } from "./types";
import type { Contour, Vec2 } from "@/font/types";

const P = (x: number, y: number): Vec2 => ({ x, y });

/** A stroke sixty units wide with a round nib, cut square at both ends. */
function stroked(spine: QuillSpine, join: QuillJoinKind): QuillStroke {
  return {
    spine,
    width: [{ at: 0, width: 60 }],
    nib: [{ at: 0, contrast: 0, angle: 0 }],
    start: { kind: "butt" },
    end: { kind: "butt" },
    join,
  };
}

/** How far the nearest of a contour's nodes is from a point. */
function nearestNode(contour: Contour, to: Vec2): number {
  return Math.min(
    ...contour.nodes.map((node) => Math.hypot(node.point.x - to.x, node.point.y - to.y)),
  );
}

/** Any two nodes of a contour sitting within half a unit of each other. */
function repeatedNodes(contour: Contour): number {
  let repeats = 0;
  contour.nodes.forEach((one, index) => {
    for (const other of contour.nodes.slice(index + 1)) {
      if (Math.hypot(one.point.x - other.point.x, one.point.y - other.point.y) < 0.5) repeats++;
    }
  });
  return repeats;
}

/** A square of side three hundred, from the origin, anticlockwise. */
const square: QuillSpine = {
  segments: [
    { kind: "line", from: P(0, 0), to: P(300, 0) },
    { kind: "line", from: P(300, 0), to: P(300, 300) },
    { kind: "line", from: P(300, 300), to: P(0, 300) },
    { kind: "line", from: P(0, 300), to: P(0, 0) },
  ],
  closed: true,
};

/*
 * Two lines of three hundred units, turning left at the middle. Six hundred
 * units walked in three hundred steps puts a sample exactly on the corner.
 */
const ell: QuillSpine = {
  segments: [
    { kind: "line", from: P(0, 0), to: P(300, 0) },
    { kind: "line", from: P(300, 0), to: P(300, 300) },
  ],
  closed: false,
};

describe("the corners of a swept stroke", () => {
  /*
   * The seam of a ring is a join like any other. A square ring swept with a
   * mitre used to come out with three mitred corners and the fourth -- the one
   * at its first node -- cut off in a straight line from the last sample to
   * the first.
   */
  it("mitres the seam of a closed spine like its other corners", () => {
    const drawn = sweep(stroked(square, "miter"));
    expect(drawn.contours).toHaveLength(2);
    // The outer side is the one that reaches furthest from the middle.
    const reach = (contour: Contour) =>
      Math.max(...contour.nodes.map((node) => Math.abs(node.point.x - 150)));
    const outer =
      reach(drawn.contours[0]) > reach(drawn.contours[1]) ? drawn.contours[0] : drawn.contours[1];
    for (const apex of [P(-30, -30), P(330, -30), P(330, 330), P(-30, 330)]) {
      expect(nearestNode(outer, apex)).toBeLessThan(0.5);
    }
  });

  it("still passes over a seam that does not turn", () => {
    const circle: QuillSpine = {
      segments: [
        {
          kind: "arc",
          centre: P(0, 0),
          radius: 200,
          startAngle: 0,
          endAngle: Math.PI * 2,
          sweepPositive: true,
        },
      ],
      closed: true,
    };
    const drawn = sweep(stroked(circle, "miter"));
    expect(drawn.contours).toHaveLength(2);
    // Nothing stands out past the pen: a mitre at the seam would reach 30√2.
    for (const contour of drawn.contours) {
      for (const node of contour.nodes) {
        expect(Math.hypot(node.point.x, node.point.y)).toBeLessThan(230.5);
      }
    }
  });

  /*
   * A sample that lands exactly on a corner used to be taken after the join
   * had been put down, from the incoming segment, so each side stepped back to
   * where the join began and forward again -- visible as the same place
   * appearing twice in the outline.
   */
  it.each(["miter", "round", "bevel"] as const)(
    "does not double back when a sample lands on a %s corner",
    (join) => {
      const drawn = sweep(stroked(ell, join));
      expect(drawn.contours).toHaveLength(1);
      expect(repeatedNodes(drawn.contours[0])).toBe(0);
    },
  );

  it.each(["miter", "round", "bevel"] as const)(
    "does not double back on a ring whose corners land on samples (%s)",
    (join) => {
      for (const contour of sweep(stroked(square, join)).contours) {
        expect(repeatedNodes(contour)).toBe(0);
      }
    },
  );
});
