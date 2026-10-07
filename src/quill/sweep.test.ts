import { describe, expect, it } from "vitest";

import { reachAcross, sweep } from "./sweep";
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

/** The winding number of a contour around a point, its cubics flattened finely. */
function windingAt(contour: Contour, point: Vec2): number {
  const flat: Vec2[] = [];
  const { nodes } = contour;
  nodes.forEach((a, index) => {
    const b = nodes[(index + 1) % nodes.length];
    const c1 = a.handleOut ?? a.point;
    const c2 = b.handleIn ?? b.point;
    for (let step = 0; step < 32; step++) {
      const t = step / 32;
      const u = 1 - t;
      const mix = (p: number, q: number, r: number, s: number) =>
        u * u * u * p + 3 * u * u * t * q + 3 * u * t * t * r + t * t * t * s;
      flat.push(P(mix(a.point.x, c1.x, c2.x, b.point.x), mix(a.point.y, c1.y, c2.y, b.point.y)));
    }
  });
  let winding = 0;
  flat.forEach((a, index) => {
    const b = flat[(index + 1) % flat.length];
    const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    if (a.y <= point.y && b.y > point.y && side > 0) winding++;
    else if (a.y > point.y && b.y <= point.y && side < 0) winding--;
  });
  return winding;
}

describe("a corner written with a contrasting nib", () => {
  /*
   * Two lines, the second turning away at about forty degrees, written with a
   * broad nib held at an angle -- what the writing tool gives for three
   * clicks. The pen reaches further across the steep line than across the
   * shallow one, and the outline used to fold back on itself at the turn: the
   * mitre ran behind the offsets on the outside and the chord ran back across
   * the turn on the inside, and both loops wound the other way, which under
   * the non-zero rule is a dark wedge in the ink.
   *
   * The writing tool's clicks are straight cubics with their handles on their
   * ends rather than lines, and those had a second fault of their own: no
   * heading at the far end of a segment, so the corner had no offsets at all.
   * Both shapes of spine are checked.
   *
   * Checked against the ink the pen lays along each line on its own: every
   * point inside either band is inside the outline.
   */
  const corners = [P(0, 0), P(60, 250), P(300, 420)];
  const spines: Record<"lines" | "clicks", QuillSpine> = {
    lines: {
      segments: [
        { kind: "line", from: corners[0], to: corners[1] },
        { kind: "line", from: corners[1], to: corners[2] },
      ],
      closed: false,
    },
    clicks: {
      segments: [
        { kind: "cubic", from: corners[0], c1: corners[0], c2: corners[1], to: corners[1] },
        { kind: "cubic", from: corners[1], c1: corners[1], c2: corners[2], to: corners[2] },
      ],
      closed: false,
    },
  };
  const lines = [
    { from: corners[0], to: corners[1] },
    { from: corners[1], to: corners[2] },
  ];
  const nibs = [
    { contrast: 0.55, angle: 30 },
    { contrast: 0.8, angle: 80 },
    { contrast: 0.7, angle: 100 },
  ];

  it.each(
    (["lines", "clicks"] as const).flatMap((shape) =>
      (["miter", "round", "bevel"] as const).flatMap((join) =>
        nibs.map((nib) => [shape, join, nib] as const),
      ),
    ),
  )("leaves no hole where %s turn at a %s corner (%o)", (shape, join, nib) => {
    const stroke: QuillStroke = {
      ...stroked(spines[shape], join),
      width: [{ at: 0, width: 90 }],
      nib: [{ at: 0, ...nib }],
    };
    const [contour] = sweep(stroke).contours;
    const inInk = (point: Vec2): boolean =>
      lines.some(({ from, to }) => {
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const heading = P((to.x - from.x) / length, (to.y - from.y) / length);
        const along = (point.x - from.x) * heading.x + (point.y - from.y) * heading.y;
        const across = Math.abs((point.x - from.x) * heading.y - (point.y - from.y) * heading.x);
        // A unit inside the edge, so a fitted curve a hair off it is not a hole.
        return along >= 0 && along <= length && across <= reachAcross(heading, 45, nib) - 1;
      });
    const holes: string[] = [];
    for (let x = -60; x <= 140; x += 2) {
      for (let y = 190; y <= 320; y += 2) {
        if (inInk(P(x, y)) && windingAt(contour, P(x, y)) === 0) holes.push(`${x},${y}`);
      }
    }
    expect(holes).toEqual([]);
  });
});
