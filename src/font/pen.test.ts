/**
 * The gesture that makes a curve, and the two edits a curve has to survive.
 *
 * Every claim here is about numbers, which is why they are asked of the
 * arithmetic rather than of the canvas. "The curve did not move when a point
 * was added to it" is either true to several decimal places or false, and a
 * screenshot cannot tell you which.
 */

import { describe, expect, it } from "vitest";

import { cubicAt } from "./geometry";
import {
  A_DRAG,
  draggedPoint,
  heldToAngle,
  retracted,
  segmentAt,
  simplified,
  simplifyWouldRemove,
  withPointOn,
  withoutPoint,
} from "./pen";
import type { Contour, GlyphNode, Vec2 } from "./types";

const node = (x: number, y: number, over: Partial<GlyphNode> = {}): GlyphNode => ({
  point: { x, y },
  handleIn: null,
  handleOut: null,
  type: "corner",
  ...over,
});

/** A circle in four cubics, which is the shape every letter is mostly made of. */
function circle(radius = 100): Contour {
  const k = radius * 0.5522847498;
  return {
    closed: true,
    nodes: [
      { point: { x: 0, y: radius }, handleIn: { x: -k, y: radius }, handleOut: { x: k, y: radius }, type: "smooth" },
      { point: { x: radius, y: 0 }, handleIn: { x: radius, y: k }, handleOut: { x: radius, y: -k }, type: "smooth" },
      { point: { x: 0, y: -radius }, handleIn: { x: k, y: -radius }, handleOut: { x: -k, y: -radius }, type: "smooth" },
      { point: { x: -radius, y: 0 }, handleIn: { x: -radius, y: -k }, handleOut: { x: -radius, y: k }, type: "smooth" },
    ],
  };
}

/** Where a contour actually runs, for holding two versions of it up together. */
function walk(contour: Contour, per = 24): Vec2[] {
  const out: Vec2[] = [];
  const nodes = contour.nodes;
  const last = contour.closed ? nodes.length : nodes.length - 1;
  for (let index = 0; index < last; index++) {
    const a = nodes[index];
    const b = nodes[(index + 1) % nodes.length];
    for (let step = 0; step < per; step++) {
      out.push(cubicAt(a.point, a.handleOut ?? a.point, b.handleIn ?? b.point, b.point, step / per));
    }
  }
  return out;
}

/** How far a point lies from a line between two others. */
function toSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

/**
 * The furthest either outline strays from the other.
 *
 * Measured to the other's *segments* rather than to its sampled points. Point
 * to point put a floor under the answer of half the sample spacing -- on a
 * hundred-unit circle sampled forty-eight times a segment, one and a half
 * units of nothing -- which is more than some of the things worth asserting
 * here are allowed to differ by.
 */
function apart(one: Contour, other: Contour): number {
  const theirs = walk(other, 64);
  let worst = 0;
  for (const mine of walk(one, 64)) {
    let nearest = Infinity;
    for (let at = 0; at < theirs.length; at++) {
      nearest = Math.min(nearest, toSegment(mine, theirs[at], theirs[(at + 1) % theirs.length]));
    }
    worst = Math.max(worst, nearest);
  }
  return worst;
}

describe("pulling a handle out of the point being placed", () => {
  /*
   * The pen gesture, which this pen did not have: every point it made was a
   * corner with no handles, so it drew polygons and a curve had to be pressed
   * in afterwards from the panel.
   */
  it("makes a smooth point whose handles mirror through it", () => {
    const made = draggedPoint({ x: 100, y: 100 }, { x: 160, y: 100 });
    expect(made.type).toBe("smooth");
    expect(made.handleOut).toEqual({ x: 160, y: 100 });
    // The mirror is what makes it smooth: the curve arrives and leaves along
    // one line, so there is no corner in it.
    expect(made.handleIn).toEqual({ x: 40, y: 100 });
  });

  it("breaks the handle when alt is held, leaving the arriving side alone", () => {
    const kept = { x: 20, y: 20 };
    const made = draggedPoint({ x: 100, y: 100 }, { x: 160, y: 100 }, { alt: true, keepIn: kept });
    expect(made.type).toBe("corner");
    expect(made.handleIn).toBe(kept);
    expect(made.handleOut).toEqual({ x: 160, y: 100 });
  });

  it("holds the handle to an eighth turn under shift", () => {
    // Twenty degrees up from flat snaps back to flat; fifty snaps to forty-five.
    const flat = heldToAngle({ x: 0, y: 0 }, { x: 100, y: 36 });
    expect(flat.y).toBeCloseTo(0, 6);
    expect(Math.hypot(flat.x, flat.y)).toBeCloseTo(Math.hypot(100, 36), 6);

    const corner = heldToAngle({ x: 0, y: 0 }, { x: 100, y: 119 });
    expect(corner.x).toBeCloseTo(corner.y, 6);
  });

  it("keeps the handle's length when it holds its angle", () => {
    const held = heldToAngle({ x: 10, y: 10 }, { x: 90, y: 15 });
    expect(Math.hypot(held.x - 10, held.y - 10)).toBeCloseTo(Math.hypot(80, 5), 6);
  });

  it("counts a press that barely moves as a click, not a drag", () => {
    // The canvas decides with this, and a hand that shifts two pixels while
    // clicking meant to click.
    expect(A_DRAG).toBeGreaterThan(1);
    expect(A_DRAG).toBeLessThan(8);
  });
});

describe("ending a curve", () => {
  it("takes the outgoing handle off and leaves the arriving one", () => {
    const curved = node(100, 100, { handleIn: { x: 40, y: 100 }, handleOut: { x: 160, y: 100 }, type: "smooth" });
    const done = retracted(curved);
    expect(done.handleOut).toBeNull();
    expect(done.handleIn).toEqual({ x: 40, y: 100 });
    // No longer smooth: a point with a curve on one side and a straight on the
    // other is a corner, whatever it was called before.
    expect(done.type).toBe("corner");
  });
});

describe("putting a point on a segment", () => {
  /*
   * The claim that matters. Anything that adds a point and re-guesses the
   * handles moves the outline while saying it is adding to it -- which on a
   * letter somebody has already spaced is a change they did not ask for.
   */
  it("leaves the curve exactly where it was", () => {
    const before = circle();
    const after = withPointOn(before, 0, 0.5);
    expect(after.nodes).toHaveLength(5);
    // Not zero because the comparison walks both as polylines, and a polyline
    // through a curve is a hundredth of a unit off it at this sampling. The
    // split itself is exact: de Casteljau, not a re-guess.
    expect(apart(after, before)).toBeLessThan(0.05);
  });

  it("keeps a straight segment straight", () => {
    const line: Contour = { closed: false, nodes: [node(0, 0), node(100, 0)] };
    const after = withPointOn(line, 0, 0.5);
    expect(after.nodes).toHaveLength(3);
    expect(after.nodes[1].point).toEqual({ x: 50, y: 0 });
    // No handles invented: a straight run stays straight.
    expect(after.nodes[1].handleIn).toBeNull();
    expect(after.nodes[1].handleOut).toBeNull();
    expect(after.nodes[1].type).toBe("corner");
  });

  it("finds the segment under a pointer, and says no when there is none", () => {
    const found = segmentAt(circle(), { x: 0, y: 101 }, 8);
    expect(found).not.toBeNull();
    expect(segmentAt(circle(), { x: 500, y: 500 }, 8)).toBeNull();
  });
});

describe("taking a point out", () => {
  /*
   * Removing the node and leaving the rest alone is what this did, and the
   * shape jumps: the two segments the point joined become one straight line
   * between their far ends. Re-fitting is what makes losing a point cost a
   * little accuracy rather than the whole curve.
   */
  it("keeps the curve through the point that went", () => {
    const before = circle();
    const after = withoutPoint(before, 1);
    expect(after.nodes).toHaveLength(3);
    // A quarter of a circle described by one cubic instead of two is a real
    // approximation, but it is still a circle rather than a wedge.
    expect(apart(after, before)).toBeLessThan(12);
  });

  it("is far better than dropping the node and leaving the rest", () => {
    const before = circle();
    const refitted = withoutPoint(before, 1);
    const dropped: Contour = { ...before, nodes: before.nodes.filter((_, at) => at !== 1) };
    expect(apart(refitted, before)).toBeLessThan(apart(dropped, before) / 3);
  });

  it("leaves a contour with nothing to re-fit through alone", () => {
    const pair: Contour = { closed: false, nodes: [node(0, 0), node(10, 0)] };
    expect(withoutPoint(pair, 0).nodes).toHaveLength(2);
  });
});

describe("describing the same outline in fewer points", () => {
  /** A circle carried by far more points than it needs, as a trace produces. */
  const overloaded = (): Contour => {
    const nodes: GlyphNode[] = [];
    const count = 40;
    for (let at = 0; at < count; at++) {
      const angle = (at / count) * Math.PI * 2;
      const point = { x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 };
      // Handles along the tangent, which is what a dense sampling produces.
      const step = ((Math.PI * 2) / count) * 100 * 0.34;
      const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
      nodes.push({
        point,
        handleIn: { x: point.x - tangent.x * step, y: point.y - tangent.y * step },
        handleOut: { x: point.x + tangent.x * step, y: point.y + tangent.y * step },
        type: "smooth",
      });
    }
    return { closed: true, nodes };
  };

  it("takes most of the points out and keeps the shape", () => {
    const before = overloaded();
    const after = simplified(before, 4);
    expect(after.nodes.length).toBeLessThan(before.nodes.length / 2);
    expect(apart(after, before)).toBeLessThan(6);
  });

  it("says how many it would take before it runs", () => {
    const before = overloaded();
    expect(simplifyWouldRemove([before], 4)).toBe(
      before.nodes.length - simplified(before, 4).nodes.length,
    );
  });

  it("follows more closely when asked to", () => {
    const before = overloaded();
    expect(apart(simplified(before, 1), before)).toBeLessThanOrEqual(
      apart(simplified(before, 12), before),
    );
  });

  it("leaves a shape with too few points to spare alone", () => {
    const three: Contour = { closed: true, nodes: [node(0, 0), node(10, 0), node(5, 9)] };
    expect(simplified(three).nodes).toHaveLength(3);
  });

  /*
   * The one the first rebuild got wrong and no round shape could show.
   *
   * A fitted cubic's second handle belongs to the point after it, which at the
   * end of a run is the first point of the next run. Reset to null at every
   * boundary -- as it was -- one handle per corner is thrown away, and on a
   * shape that is all curve or all straight the loss is invisible.
   */
  it("keeps the handle that crosses from one run of curve to the next", () => {
    // A stadium: two straight sides and two half-round ends, so the fit has
    // four runs and real curvature either side of every corner.
    const r = 60;
    const k = r * 0.5522847498;
    const stadium: Contour = {
      closed: true,
      nodes: [
        node(0, r, { handleOut: { x: k, y: r }, type: "corner" }),
        node(r, 0, { handleIn: { x: r, y: k }, handleOut: { x: r, y: -k }, type: "smooth" }),
        node(0, -r, { handleIn: { x: k, y: -r }, type: "corner" }),
        node(-200, -r, { type: "corner" }),
        node(-200 - r, 0, { handleIn: { x: -200 - r, y: -k }, handleOut: { x: -200 - r, y: k }, type: "smooth" }),
        node(-200, r, { handleOut: { x: -200 + k, y: r }, type: "corner" }),
      ],
    };
    const after = simplified(stadium, 4);
    expect(apart(after, stadium)).toBeLessThan(5);
  });

  /*
   * A fit allowed to round off a stem end has redrawn the letter. Corners are
   * boundaries the fit is not permitted to cross.
   */
  it("keeps the corners, so a stem end does not become a curve", () => {
    const box: Contour = {
      closed: true,
      nodes: [node(0, 0), node(100, 0), node(100, 200), node(0, 200)],
    };
    const after = simplified(box, 4);
    expect(after.nodes.every((one) => one.type === "corner")).toBe(true);
    expect(apart(after, box)).toBeLessThan(1);
  });
});
