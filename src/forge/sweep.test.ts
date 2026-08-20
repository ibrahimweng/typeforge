/**
 * The sweep, checked against the geometry it claims to be.
 *
 * These are not "does it draw something" tests. The reason for restricting
 * spines to lines and arcs is that the offsets are then exact, and a claim like
 * that is either true to within floating point or it is marketing. So the
 * outlines are measured against the closed forms they are supposed to be:
 * a stem's sides are checked for being the right distance apart, a ring's are
 * checked for being circles of the right radius at every angle, and a
 * contrasted ring is checked for being an ellipse with the right two axes.
 */

import { describe, expect, it } from "vitest";

import { contourArea, contoursBounds, contourSegments, cubicAt } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import type { Contour, Vec2 } from "@/font/types";
import { strokeLimit, sweep } from "./sweep";
import type { Pen, Spine, Stroke } from "./types";

const MONOLINE: Pen = { weight: 100, contrast: 0, angle: 0 };

const line = (from: Vec2, to: Vec2): Spine => ({
  segments: [{ kind: "line", from, to }],
  closed: false,
});

const ring = (centre: Vec2, radius: number): Spine => ({
  segments: [
    {
      kind: "arc",
      centre,
      radius,
      startAngle: 0,
      endAngle: Math.PI * 2,
      sweepPositive: true,
    },
  ],
  closed: true,
});

const stroke = (spine: Spine, pen: Pen = MONOLINE): Stroke => ({
  spine,
  pen,
  start: { kind: "butt" },
  end: { kind: "butt" },
});

/** Every point the outline actually passes through, curves included. */
function walk(contour: Contour, steps = 64): Vec2[] {
  const points: Vec2[] = [];
  for (const segment of contourSegments(contour)) {
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      points.push(
        segment.kind === "line"
          ? {
              x: segment.from.x + (segment.to.x - segment.from.x) * t,
              y: segment.from.y + (segment.to.y - segment.from.y) * t,
            }
          : cubicAt(segment.from, segment.c1, segment.c2, segment.to, t),
      );
    }
  }
  return points;
}

describe("sweeping a straight stem", () => {
  it("comes out exactly as wide as the pen", () => {
    const [outline] = sweep(stroke(line({ x: 0, y: 0 }, { x: 0, y: 700 })));
    const bounds = contoursBounds([outline]);
    expect(bounds.xMax - bounds.xMin).toBeCloseTo(100, 9);
  });

  it("runs exactly as far as the spine, no further", () => {
    const [outline] = sweep(stroke(line({ x: 0, y: 0 }, { x: 0, y: 700 })));
    const bounds = contoursBounds([outline]);
    expect(bounds.yMin).toBeCloseTo(0, 9);
    expect(bounds.yMax).toBeCloseTo(700, 9);
  });

  it("is a rectangle and nothing more", () => {
    const [outline] = sweep(stroke(line({ x: 0, y: 0 }, { x: 0, y: 700 })));
    expect(outline.nodes).toHaveLength(4);
    expect(Math.abs(contourArea(outline))).toBeCloseTo(100 * 700, 6);
  });

  it("is square to its own direction however it is turned", () => {
    // A diagonal, as in a v or a w: still exactly 100 across the stroke.
    const [outline] = sweep(stroke(line({ x: 0, y: 0 }, { x: 300, y: 400 })));
    expect(Math.abs(contourArea(outline))).toBeCloseTo(100 * 500, 6);
  });
});

describe("sweeping a ring", () => {
  const RADIUS = 250;

  it("gives an outside and a counter, not one shape", () => {
    expect(sweep(stroke(ring({ x: 0, y: 0 }, RADIUS)))).toHaveLength(2);
  });

  /** How far the drawn outline strays from the circle it stands for. */
  const strayFromCircle = (contour: Contour, wanted: number): number =>
    Math.max(...walk(contour).map((point) => Math.abs(Math.hypot(point.x, point.y) - wanted)));

  /*
   * The claim under test: offsetting a circular arc gives a circular arc about
   * the same centre, so every point of the outer edge is radius-plus-half-a-pen
   * from the middle.
   *
   * One approximation remains and it is worth being exact about, because the
   * whole approach is sold on not having any. A circle cannot be written as
   * cubic beziers exactly, and the outline here uses the four-node form every
   * type designer draws an o with -- one node at each extreme. That form is off
   * by about three parts in ten thousand of the radius, which on this 300-unit
   * edge is seven hundredths of a unit.
   *
   * The bar it has to clear is not zero, it is the resolution of a font file:
   * TrueType coordinates are integers, so anything under half a unit disappears
   * when the font is written. Splitting the circle into eight nodes instead of
   * four would shrink the error sixty-fold and buy nothing, while giving every
   * round letter twice the points to edit.
   */
  it("stays within a circle to better than the font format can record", () => {
    const [outside, counter] = sweep(stroke(ring({ x: 0, y: 0 }, RADIUS)));
    // Half a unit is one step of the integer grid a TrueType font is written on.
    expect(strayFromCircle(outside, RADIUS + 50)).toBeLessThan(0.5);
    expect(strayFromCircle(counter, RADIUS - 50)).toBeLessThan(0.5);
  });

  it("is off by no more than the four-node form allows", () => {
    // Three parts in ten thousand, which is the known error of the quarter-turn
    // cubic. Tighter than the check above so that a change in how arcs are
    // written shows up here rather than passing quietly.
    const [outside, counter] = sweep(stroke(ring({ x: 0, y: 0 }, RADIUS)));
    expect(strayFromCircle(outside, RADIUS + 50)).toBeLessThan((RADIUS + 50) * 3e-4);
    expect(strayFromCircle(counter, RADIUS - 50)).toBeLessThan((RADIUS - 50) * 3e-4);
  });

  it("draws a round letter with four nodes to a ring, as one is drawn by hand", () => {
    const [outside, counter] = sweep(stroke(ring({ x: 0, y: 0 }, RADIUS)));
    expect(outside.nodes).toHaveLength(4);
    expect(counter.nodes).toHaveLength(4);
  });

  it("winds the counter against the outside, so it reads as a hole", () => {
    const [outside, counter] = sweep(stroke(ring({ x: 0, y: 0 }, RADIUS)));
    expect(Math.sign(contourArea(outside))).not.toBe(Math.sign(contourArea(counter)));
  });
});

describe("contrast", () => {
  /**
   * A pen with contrast is broad one way and narrow the other, so a ring drawn
   * with it is thick at the sides and thin at the top -- which is what gives a
   * serif face its modulation. With the pen upright the outside should be an
   * ellipse wider than it is tall by exactly the difference between the two
   * reaches, and the counter taller than it is wide by the same.
   */
  it("thickens one axis and thins the other by the amounts asked for", () => {
    const pen: Pen = { weight: 100, contrast: 0.6, angle: 0 };
    const [outside, counter] = sweep(stroke(ring({ x: 0, y: 0 }, 250), pen));

    const out = contoursBounds([outside]);
    // Broad reach 50 each side horizontally, narrow reach 20 vertically.
    expect(out.xMax - out.xMin).toBeCloseTo((250 + 50) * 2, 1);
    expect(out.yMax - out.yMin).toBeCloseTo((250 + 20) * 2, 1);

    const inner = contoursBounds([counter]);
    expect(inner.xMax - inner.xMin).toBeCloseTo((250 - 50) * 2, 1);
    expect(inner.yMax - inner.yMin).toBeCloseTo((250 - 20) * 2, 1);
  });

  it("turns with the pen", () => {
    // Laid on its side, the thick and thin swap over.
    const pen: Pen = { weight: 100, contrast: 0.6, angle: 90 };
    const [outside] = sweep(stroke(ring({ x: 0, y: 0 }, 250), pen));
    const bounds = contoursBounds([outside]);
    expect(bounds.xMax - bounds.xMin).toBeCloseTo((250 + 20) * 2, 1);
    expect(bounds.yMax - bounds.yMin).toBeCloseTo((250 + 50) * 2, 1);
  });

  it("leaves a monolinear pen perfectly round", () => {
    const [outside] = sweep(stroke(ring({ x: 0, y: 0 }, 250)));
    const bounds = contoursBounds([outside]);
    expect(bounds.xMax - bounds.xMin).toBeCloseTo(bounds.yMax - bounds.yMin, 6);
  });
});

describe("terminals", () => {
  it("cuts square across the spine by default", () => {
    const [outline] = sweep(stroke(line({ x: 0, y: 0 }, { x: 0, y: 700 })));
    const top = outline.nodes.filter((node) => Math.abs(node.point.y - 700) < 1e-9);
    expect(top).toHaveLength(2);
  });

  /** A round cap adds half a pen at each end, and nothing to the width. */
  it("caps with a half turn of the pen when asked", () => {
    const rounded: Stroke = {
      spine: line({ x: 0, y: 0 }, { x: 0, y: 700 }),
      pen: MONOLINE,
      start: { kind: "round" },
      end: { kind: "round" },
    };
    const bounds = contoursBounds(sweep(rounded));
    expect(bounds.yMax - bounds.yMin).toBeCloseTo(700 + 100, 1);
    expect(bounds.xMax - bounds.xMin).toBeCloseTo(100, 1);
  });
});

describe("the limit on how wide a stroke may be drawn", () => {
  it("is twice the tightest turn on the spine", () => {
    expect(strokeLimit(ring({ x: 0, y: 0 }, 250))).toBe(500);
  });

  it("is unlimited on a straight run, which cannot turn inside out", () => {
    expect(strokeLimit(line({ x: 0, y: 0 }, { x: 0, y: 700 }))).toBe(Infinity);
  });

  /**
   * The point of stating the limit: right up to it the letter is still sound.
   * A ring of radius 250 takes a pen of 499 units -- a counter one unit
   * across -- and still comes out as two clean contours that do not cross.
   */
  it("holds all the way to the limit", () => {
    const [outside, counter] = sweep(
      stroke(ring({ x: 0, y: 0 }, 250), { weight: 499, contrast: 0, angle: 0 }),
    );
    expect(contoursIntersect([outside])).toBe(false);
    expect(contoursIntersect([counter])).toBe(false);
    const inner = contoursBounds([counter]);
    expect(inner.xMax - inner.xMin).toBeCloseTo(1, 1);
  });
});

/**
 * The property the whole approach exists for.
 *
 * The weight control on an imported font has to check its own work, because it
 * moves points that were drawn by someone else and they can run into each
 * other. Nothing here moves: every weight is a fresh drawing. So sweeping the
 * whole range should produce sound outlines at every step without anything
 * having to defend against anything.
 */
describe("weight, from hairline to the limit", () => {
  it("never produces a crossed or inside-out outline", () => {
    const shapes: Array<[string, Spine]> = [
      ["stem", line({ x: 0, y: 0 }, { x: 0, y: 700 })],
      ["diagonal", line({ x: 0, y: 0 }, { x: 300, y: 700 })],
      ["ring", ring({ x: 0, y: 0 }, 250)],
      [
        "arch",
        {
          segments: [
            { kind: "arc", centre: { x: 0, y: 0 }, radius: 200, startAngle: 0, endAngle: Math.PI, sweepPositive: true },
          ],
          closed: false,
        },
      ],
    ];

    for (const [name, spine] of shapes) {
      const limit = Math.min(strokeLimit(spine), 400);
      for (let step = 1; step <= 40; step++) {
        const weight = (limit * step) / 41;
        for (const contrast of [0, 0.5, 0.85]) {
          const contours = sweep(stroke(spine, { weight, contrast, angle: 15 }));
          expect(contours.length, `${name} at ${Math.round(weight)}`).toBeGreaterThan(0);
          for (const contour of contours) {
            expect(
              contoursIntersect([contour]),
              `${name} crossed itself at weight ${Math.round(weight)}, contrast ${contrast}`,
            ).toBe(false);
            expect(
              Math.abs(contourArea(contour)),
              `${name} vanished at weight ${Math.round(weight)}`,
            ).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("gets steadily heavier, with no step backwards", () => {
    const spine = line({ x: 0, y: 0 }, { x: 0, y: 700 });
    let previous = 0;
    for (let weight = 10; weight <= 400; weight += 10) {
      const area = Math.abs(contourArea(sweep(stroke(spine, { weight, contrast: 0, angle: 0 }))[0]));
      expect(area).toBeGreaterThan(previous);
      previous = area;
    }
  });
});

describe("corners", () => {
  /*
   * A stroke that turns, which is what a diagonal letter is made of.
   *
   * The outside of a turn opens a wedge between the two offsets and the inside
   * makes them cross. Both were unhandled, and the alphabet worked around it by
   * drawing each diagonal separately and cutting both square at the shared
   * point -- which stops the crossing without filling the wedge. At text weight
   * that missing wedge is a fraction of a unit. At a display weight of 190 it
   * was a notch in thirteen letters.
   */
  const bent = (turnTo: Vec2, join?: "miter" | "round" | "bevel"): Stroke => ({
    spine: {
      segments: [
        { kind: "line", from: { x: 0, y: 0 }, to: { x: 200, y: 0 } },
        { kind: "line", from: { x: 200, y: 0 }, to: turnTo },
      ],
      closed: false,
    },
    pen: MONOLINE,
    start: { kind: "butt" },
    end: { kind: "butt" },
    join,
  });

  it("carries the outside of a right angle out to the corner", () => {
    // Two hundred along and two hundred up, mitred: the outer corner is at
    // (250, -50), half a pen beyond the turn in both directions.
    const contour = sweep(bent({ x: 200, y: 200 }))[0];
    const corner = contour.nodes.some(
      (node) => Math.abs(node.point.x - 250) < 1e-6 && Math.abs(node.point.y + 50) < 1e-6,
    );
    expect(corner).toBe(true);
  });

  it("cuts less ink off the corner the sharper the join is", () => {
    // A miter fills the whole wedge, a round join cuts it back to the pen's own
    // arc, and a bevel takes the chord across that arc. Stated as an ordering
    // because it is the one relation between the three that holds at every
    // angle and every weight.
    const ink = (join: "miter" | "round" | "bevel") =>
      Math.abs(contourArea(sweep(bent({ x: 200, y: 200 }, join))[0]));
    expect(ink("bevel")).toBeLessThan(ink("round"));
    expect(ink("round")).toBeLessThan(ink("miter"));
  });

  it("does not leave a loop on the inside of a turn", () => {
    for (const angle of [15, 30, 45, 60, 90, 120, 150]) {
      const radians = (angle * Math.PI) / 180;
      const contour = sweep(
        bent({ x: 200 + 200 * Math.cos(radians), y: 200 * Math.sin(radians) }),
      )[0];
      expect(contoursIntersect([contour]), `a ${angle} degree turn crosses itself`).toBe(false);
    }
  });

  it("falls back from a miter that would run away", () => {
    /*
     * A stroke that nearly doubles back on itself. The exact miter is where two
     * almost-parallel lines meet, which here is twelve hundred units away --
     * twenty-four pen widths of spike hanging off the side of the letter. Past
     * the limit the corner is rounded instead, which is what a punchcutter does
     * with a very acute join anyway.
     */
    const contour = sweep(bent({ x: 20, y: 15 }))[0];
    expect(contoursBounds([contour]).xMax).toBeLessThan(260);
  });

  it("ignores a run that goes nowhere", () => {
    /*
     * A segment of zero length is a coordinate written twice, and its direction
     * of travel is whatever the arithmetic left behind. The U had one -- the
     * flat across its bottom, which is what remains after the two corners take
     * their radius, and on a wide-cornered face nothing remains. It sat there
     * harmlessly for as long as nothing asked which way it pointed, and the
     * moment corners were handled it read as a turn in both directions at once.
     */
    const withNothing: Stroke = {
      spine: {
        segments: [
          { kind: "line", from: { x: 0, y: 0 }, to: { x: 200, y: 0 } },
          { kind: "line", from: { x: 200, y: 0 }, to: { x: 200, y: 0 } },
          { kind: "line", from: { x: 200, y: 0 }, to: { x: 400, y: 0 } },
        ],
        closed: false,
      },
      pen: MONOLINE,
      start: { kind: "butt" },
      end: { kind: "butt" },
    };
    const straightThrough: Stroke = {
      ...withNothing,
      spine: { segments: [{ kind: "line", from: { x: 0, y: 0 }, to: { x: 400, y: 0 } }], closed: false },
    };
    expect(Math.abs(contourArea(sweep(withNothing)[0]))).toBeCloseTo(
      Math.abs(contourArea(sweep(straightThrough)[0])),
      6,
    );
  });
});
