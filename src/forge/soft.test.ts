/**
 * The geometry the soft finishes are built from, held to the numbers it
 * promises: a corner rounded on the circle it says, an edge cut where its
 * length says, and the inside of an outline told from the outside.
 */

import { describe, expect, it } from "vitest";

import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import {
  edgeLength,
  flatten,
  kappa,
  lineIntersection,
  pointAt,
  roundNodeCorner,
  splitEdgeAtLength,
  tangentAt,
  windingAt,
} from "./soft";
import { signatureOf } from "./testing/signature";

const corner = (x: number, y: number): GlyphNode => ({
  point: { x, y },
  handleIn: null,
  handleOut: null,
  type: "corner",
});

const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const unit = (v: Vec2): Vec2 => {
  const length = Math.hypot(v.x, v.y);
  return { x: v.x / length, y: v.y / length };
};
const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/** A dense polyline length, to check the quadrature against. */
function slowLength(from: GlyphNode, to: GlyphNode, steps = 200_000): number {
  let length = 0;
  let before = pointAt(from, to, 0);
  for (let step = 1; step <= steps; step++) {
    const here = pointAt(from, to, step / steps);
    length += Math.hypot(here.x - before.x, here.y - before.y);
    before = here;
  }
  return length;
}

describe("kappa", () => {
  it("is the circle's handle factor per unit of tangent length", () => {
    // At a right angle the tangent length is the radius: the familiar 0.5523.
    expect(kappa(Math.PI / 2)).toBeCloseTo((4 / 3) * Math.tan(Math.PI / 8), 12);
    expect(kappa(Math.PI / 2)).toBeCloseTo(0.5523, 4);
    // A turn of nothing in the limit, and the same either way round.
    expect(kappa(0)).toBe(2 / 3);
    expect(kappa(1e-7)).toBeCloseTo(2 / 3, 9);
    expect(kappa(-Math.PI / 3)).toBe(kappa(Math.PI / 3));
  });
});

describe("roundNodeCorner", () => {
  /*
   * One cubic writing a circular arc strays from it by a share of its radius
   * that grows with the turn: 2.4e-5 at 60 degrees, 2.7e-4 at 90 and 1.5e-3
   * at 120. Held to three parts in ten thousand where the turn is a right
   * angle or less -- every cut corner a stroke has -- and to sixteen at 120.
   */
  const tolerance = (degrees: number): number => (degrees <= 90 ? 3e-4 : 1.6e-3);

  for (const degrees of [60, 90, 120]) {
    it(`turns a ${degrees} degree corner on the circle touching both edges`, () => {
      const theta = (degrees * Math.PI) / 180;
      const rho = 20;
      const far = { x: 100 * Math.cos(theta), y: 100 * Math.sin(theta) };
      const nodes = [corner(-100, 0), corner(0, 0), corner(far.x, far.y)];
      const rounded = roundNodeCorner(nodes, 1, rho, rho);
      expect(rounded).toHaveLength(4);
      const [, a, b] = rounded;

      // A and B a tangent length back along each edge.
      expect(a.point.x).toBeCloseTo(-rho, 12);
      expect(a.point.y).toBeCloseTo(0, 12);
      expect(b.point.x).toBeCloseTo(rho * Math.cos(theta), 12);
      expect(b.point.y).toBeCloseTo(rho * Math.sin(theta), 12);

      // The circle touching both edges there: centre to the left of travel.
      const radius = rho / Math.tan(theta / 2);
      const centre = { x: -rho, y: radius };
      for (let step = 0; step <= 64; step++) {
        const p = pointAt(a, b, step / 64);
        const off = Math.abs(Math.hypot(p.x - centre.x, p.y - centre.y) - radius);
        expect(off).toBeLessThanOrEqual(tolerance(degrees) * radius);
      }

      // Tangent to the edges it leaves and joins.
      const into = unit(minus(a.point, nodes[0].point));
      expect(Math.abs(cross(into, unit(minus(a.handleOut!, a.point))))).toBeLessThan(1e-9);
      const onward = unit(minus(far, b.point));
      expect(Math.abs(cross(unit(minus(b.point, b.handleIn!)), onward))).toBeLessThan(1e-9);

      // The straight edges either side stay straight, and the new edge is a curve.
      expect(signatureOf([{ nodes: rounded, closed: true }])[0].edges).toBe("lcll");
    });
  }

  it("rounds on curved edges, staying tangent to them", () => {
    // A corner between two quarter circles meeting at a right angle.
    const k = 0.5523 * 100;
    const nodes: GlyphNode[] = [
      {
        point: { x: -100, y: 100 },
        handleIn: null,
        handleOut: { x: -100, y: 100 - k },
        type: "corner",
      },
      {
        point: { x: 0, y: 0 },
        handleIn: { x: -k, y: 0 },
        handleOut: { x: 0, y: k },
        type: "corner",
      },
      {
        point: { x: 100, y: 100 },
        handleIn: { x: 100 - k, y: 100 },
        handleOut: null,
        type: "corner",
      },
    ];
    const rounded = roundNodeCorner(nodes, 1, 15, 25);
    const [before, a, b, after] = rounded;
    expect(rounded).toHaveLength(4);
    // Each new node on its edge, as far along it as asked.
    expect(edgeLength(a, b)).toBeGreaterThan(0);
    expect(Math.abs(slowLength(before, a) - (slowLength(nodes[0], nodes[1]) - 15))).toBeLessThan(
      1e-3,
    );
    expect(Math.abs(slowLength(b, after) - (slowLength(nodes[1], nodes[2]) - 25))).toBeLessThan(
      1e-3,
    );
    // G1 at A and at B against the pieces of the edges kept.
    expect(Math.abs(cross(tangentAt(before, a, 1), tangentAt(a, b, 0)))).toBeLessThan(1e-9);
    expect(Math.abs(cross(tangentAt(a, b, 1), tangentAt(b, after, 0)))).toBeLessThan(1e-9);
    // Curves stay curves.
    expect(signatureOf([{ nodes: rounded, closed: true }])[0].edges).toBe("cccl");
  });

  it("adds its node even with no room, as a curve of no length", () => {
    const nodes = [corner(-100, 0), corner(0, 0), corner(0, 100), corner(-100, 100)];
    const rounded = roundNodeCorner(nodes, 1, 0, 0);
    expect(rounded).toHaveLength(5);
    expect(rounded[1].point).toEqual({ x: 0, y: 0 });
    expect(rounded[2].point).toEqual({ x: 0, y: 0 });
    expect(rounded[1].handleOut).not.toBeNull();
    expect(rounded[2].handleIn).not.toBeNull();
    expect(signatureOf([{ nodes: rounded, closed: true }])[0].edges).toBe("lclll");
  });

  it("wraps round the contour's ends", () => {
    const nodes = [corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100)];
    const near = (p: Vec2, x: number, y: number) => {
      expect(p.x).toBeCloseTo(x, 9);
      expect(p.y).toBeCloseTo(y, 9);
    };
    const first = roundNodeCorner(nodes, 0, 10, 10);
    expect(first).toHaveLength(5);
    near(first[0].point, 0, 10);
    near(first[1].point, 10, 0);
    near(first[4].point, 0, 100);
    const last = roundNodeCorner(nodes, 3, 10, 10);
    expect(last).toHaveLength(5);
    near(last[3].point, 10, 100);
    near(last[4].point, 0, 90);
    near(last[0].point, 0, 0);
  });
});

describe("splitEdgeAtLength", () => {
  const from: GlyphNode = {
    point: { x: 0, y: 0 },
    handleIn: null,
    handleOut: { x: 40, y: 120 },
    type: "smooth",
  };
  const to: GlyphNode = {
    point: { x: 300, y: 20 },
    handleIn: { x: 180, y: -90 },
    handleOut: null,
    type: "smooth",
  };

  it("measures a curve's length to a millionth", () => {
    const slow = slowLength(from, to);
    expect(Math.abs(edgeLength(from, to) - slow) / slow).toBeLessThan(1e-6);
  });

  for (const share of [0.1, 1 / 3, 0.5, 0.9]) {
    it(`cuts a curve ${share.toFixed(2)} of the way along, on the curve`, () => {
      const whole = slowLength(from, to);
      const cut = splitEdgeAtLength(from, to, whole * share);
      const first = slowLength(cut.from, cut.at);
      const second = slowLength(cut.at, cut.to);
      expect(Math.abs(first - whole * share) / whole).toBeLessThan(1e-6);
      expect(Math.abs(first + second - whole) / whole).toBeLessThan(1e-6);
      // Both pieces are curves, and the cut is smooth.
      expect(cut.at.handleIn).not.toBeNull();
      expect(cut.at.handleOut).not.toBeNull();
      expect(
        Math.abs(cross(tangentAt(cut.from, cut.at, 1), tangentAt(cut.at, cut.to, 0))),
      ).toBeLessThan(1e-9);
    });
  }

  it("cuts a straight edge into two straight ones", () => {
    const a = corner(0, 0);
    const b = corner(30, 40);
    const cut = splitEdgeAtLength(a, b, 10);
    expect(cut.at.point.x).toBeCloseTo(6, 12);
    expect(cut.at.point.y).toBeCloseTo(8, 12);
    expect(cut.at.handleIn).toBeNull();
    expect(cut.at.handleOut).toBeNull();
    expect(cut.from.handleOut).toBeNull();
    expect(cut.to.handleIn).toBeNull();
  });

  it("holds the length to the edge's own", () => {
    const a = corner(0, 0);
    const b = corner(30, 40);
    expect(splitEdgeAtLength(a, b, -5).at.point).toEqual({ x: 0, y: 0 });
    expect(splitEdgeAtLength(a, b, 500).at.point).toEqual({ x: 30, y: 40 });
  });
});

describe("windingAt", () => {
  const square = (x: number, y: number, size: number, clockwise = false): Contour => {
    const nodes = [
      corner(x, y),
      corner(x + size, y),
      corner(x + size, y + size),
      corner(x, y + size),
    ];
    return { nodes: clockwise ? nodes.reverse() : nodes, closed: true };
  };
  const circle = (cx: number, cy: number, r: number): Contour => {
    const k = 0.5523 * r;
    const node = (x: number, y: number, dx: number, dy: number): GlyphNode => ({
      point: { x: cx + x, y: cy + y },
      handleIn: { x: cx + x - dx * k, y: cy + y - dy * k },
      handleOut: { x: cx + x + dx * k, y: cy + y + dy * k },
      type: "smooth",
    });
    return {
      nodes: [node(r, 0, 0, 1), node(0, r, -1, 0), node(-r, 0, 0, -1), node(0, -r, 1, 0)],
      closed: true,
    };
  };

  it("counts an anticlockwise square once inside and not outside", () => {
    const flat = flatten([square(0, 0, 100)]);
    expect(windingAt(flat, { x: 50, y: 50 })).toBe(1);
    expect(windingAt(flat, { x: 150, y: 50 })).toBe(0);
    expect(windingAt(flat, { x: 50, y: -1 })).toBe(0);
  });

  it("counts a clockwise one the other way", () => {
    expect(windingAt(flatten([square(0, 0, 100, true)]), { x: 50, y: 50 })).toBe(-1);
  });

  it("adds overlapping shapes and cancels a counter", () => {
    const flat = flatten([square(0, 0, 100), square(50, 50, 100)]);
    expect(windingAt(flat, { x: 75, y: 75 })).toBe(2);
    expect(windingAt(flat, { x: 25, y: 25 })).toBe(1);
    expect(windingAt(flat, { x: 125, y: 125 })).toBe(1);
    const ring = flatten([square(0, 0, 100), square(25, 25, 50, true)]);
    expect(windingAt(ring, { x: 50, y: 50 })).toBe(0);
    expect(windingAt(ring, { x: 10, y: 50 })).toBe(1);
  });

  it("follows curves", () => {
    const flat = flatten([circle(0, 0, 100)]);
    expect(windingAt(flat, { x: 0, y: 0 })).toBe(1);
    expect(windingAt(flat, { x: 69, y: 69 })).toBe(1);
    expect(windingAt(flat, { x: 72, y: 72 })).toBe(0);
    expect(windingAt(flat, { x: 1000, y: 0 })).toBe(0);
  });
});

describe("lineIntersection", () => {
  it("finds where two lines cross, and how far along each", () => {
    const hit = lineIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: -5 }, { x: 0, y: 2 });
    expect(hit).not.toBeNull();
    expect(hit!.point.x).toBeCloseTo(5, 12);
    expect(hit!.point.y).toBeCloseTo(0, 12);
    expect(hit!.s).toBeCloseTo(5, 12);
    expect(hit!.t).toBeCloseTo(2.5, 12);
  });

  it("finds nothing between parallel lines", () => {
    expect(
      lineIntersection({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 5 }, { x: 2, y: 2 }),
    ).toBeNull();
  });
});
