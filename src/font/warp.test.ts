/**
 * The arithmetic under the transform box, checked without a browser.
 *
 * All of it is geometry, and geometry is the kind of thing that looks right in
 * one direction and is wrong in the other -- which a hand test on a canvas
 * will not find, because a hand reaches for the easy direction first. So the
 * identities are checked in both, and the two rules the whole feature rests on
 * are checked directly: an unpicked point does not move, and a bent segment
 * ends up on the bend rather than beside it.
 */

import { describe, expect, it } from "vitest";

import {
  bilinear,
  fieldMove,
  perspective,
  pointInBox,
  project,
  quadMove,
  unitQuad,
  warpContours,
  warpWithin,
  WARPS,
  withinBox,
  type Box,
  type Quad,
  type WarpName,
} from "./warp";
import type { Contour, GlyphNode, Vec2 } from "./types";

const BOX: Box = { left: 0, right: 100, bottom: 0, top: 100 };

const near = (a: Vec2, b: Vec2, within = 1e-6): void => {
  expect(Math.abs(a.x - b.x), `x: ${a.x} against ${b.x}`).toBeLessThan(within);
  expect(Math.abs(a.y - b.y), `y: ${a.y} against ${b.y}`).toBeLessThan(within);
};

function node(x: number, y: number, handles = false): GlyphNode {
  return {
    point: { x, y },
    handleIn: handles ? { x: x - 10, y } : null,
    handleOut: handles ? { x: x + 10, y } : null,
    type: "corner",
  };
}

const ring = (nodes: GlyphNode[], closed = true): Contour => ({ nodes, closed });

/** Every node of every contour, for counting and comparing. */
const points = (contours: Contour[]): Vec2[] =>
  contours.flatMap((one) => one.nodes.map((n) => n.point));

describe("where a point sits in the box", () => {
  it("goes out and back again", () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 37, y: 82 },
    ]) {
      near(pointInBox(BOX, withinBox(BOX, point)), point);
    }
  });

  it("does not divide by a box with no width", () => {
    // A row of points all on one line is a real selection, and asking where
    // they sit across a box of no width has to answer something finite.
    const flat: Box = { left: 50, right: 50, bottom: 0, top: 100 };
    const at = withinBox(flat, { x: 50, y: 25 });
    expect(Number.isFinite(at.u)).toBe(true);
    expect(at.v).toBeCloseTo(0.25);
  });
});

describe("the quad maps", () => {
  it("leave everything where it is when the corners have not moved", () => {
    const still = unitQuad(BOX);
    for (const kind of ["distort", "perspective"] as const) {
      const move = quadMove(BOX, still, kind);
      for (const point of [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 20, y: 70 },
      ]) {
        near(move(point), point, 1e-6);
      }
    }
  });

  it("put the four corners exactly where they were dragged", () => {
    // The one thing a person can check by eye, so it has to be exact rather
    // than close: the corner ends up under the pointer.
    const pulled: Quad = {
      bottomLeft: { x: 10, y: 5 },
      bottomRight: { x: 130, y: -20 },
      topRight: { x: 90, y: 140 },
      topLeft: { x: -30, y: 110 },
    };
    for (const kind of ["distort", "perspective"] as const) {
      const move = quadMove(BOX, pulled, kind);
      near(move({ x: 0, y: 0 }), pulled.bottomLeft, 1e-6);
      near(move({ x: 100, y: 0 }), pulled.bottomRight, 1e-6);
      near(move({ x: 100, y: 100 }), pulled.topRight, 1e-6);
      near(move({ x: 0, y: 100 }), pulled.topLeft, 1e-6);
    }
  });

  it("agree with each other on a parallelogram, and differ on a trapezoid", () => {
    /*
     * A parallelogram has no perspective in it, so the projective map is the
     * affine one and the two agree everywhere. A trapezoid does, and the whole
     * point of offering both is that they then disagree: the projective one
     * crowds the far end, which is what makes a shape look laid back.
     */
    const sheared: Quad = {
      bottomLeft: { x: 0, y: 0 },
      bottomRight: { x: 100, y: 0 },
      topRight: { x: 140, y: 100 },
      topLeft: { x: 40, y: 100 },
    };
    const middle = { x: 50, y: 50 };
    near(
      quadMove(BOX, sheared, "distort")(middle),
      quadMove(BOX, sheared, "perspective")(middle),
      1e-6,
    );

    const laidBack: Quad = {
      bottomLeft: { x: 0, y: 0 },
      bottomRight: { x: 100, y: 0 },
      topRight: { x: 75, y: 100 },
      topLeft: { x: 25, y: 100 },
    };
    const flat = quadMove(BOX, laidBack, "distort")(middle);
    const deep = quadMove(BOX, laidBack, "perspective")(middle);
    expect(Math.abs(flat.y - deep.y), "perspective should crowd the far end").toBeGreaterThan(1);
    // And crowd it upwards: the middle of the shape sits nearer the far edge.
    expect(deep.y).toBeGreaterThan(flat.y);
  });

  it("holds still rather than flinging a point past the horizon", () => {
    // A corner dragged through the opposite side has no image in front of the
    // viewer. Dividing by that would put the letter on the far side of the
    // canvas, which reads as the tool exploding.
    const inverted: Quad = {
      bottomLeft: { x: 100, y: 0 },
      bottomRight: { x: 0, y: 0 },
      topRight: { x: 0, y: 100 },
      topLeft: { x: 100, y: 100 },
    };
    const move = quadMove(BOX, inverted, "perspective");
    for (const point of [
      { x: 50, y: 50 },
      { x: 10, y: 90 },
    ]) {
      const to = move(point);
      expect(Number.isFinite(to.x) && Number.isFinite(to.y)).toBe(true);
      expect(Math.hypot(to.x, to.y)).toBeLessThan(10_000);
    }
  });

  it("solves the square to a quad, corner for corner", () => {
    const quad: Quad = {
      bottomLeft: { x: 3, y: 7 },
      bottomRight: { x: 90, y: 2 },
      topRight: { x: 70, y: 88 },
      topLeft: { x: 12, y: 95 },
    };
    const map = perspective(quad);
    near(project(map, { u: 0, v: 0 }), quad.bottomLeft, 1e-6);
    near(project(map, { u: 1, v: 0 }), quad.bottomRight, 1e-6);
    near(project(map, { u: 1, v: 1 }), quad.topRight, 1e-6);
    near(project(map, { u: 0, v: 1 }), quad.topLeft, 1e-6);
    // And bilinear agrees on the corners, which is the only place it must.
    near(bilinear(quad, { u: 1, v: 1 }), quad.topRight, 1e-6);
  });
});

describe("the named warps", () => {
  it("do nothing at all when the amount is nought", () => {
    // The identity every one of them has to have, or letting go of a slider at
    // zero would leave the letter somewhere other than where it started.
    for (const warp of WARPS) {
      for (const at of [
        { u: 0, v: 0 },
        { u: 0.5, v: 0.5 },
        { u: 1, v: 1 },
        { u: 0.2, v: 0.9 },
      ]) {
        const bent = warpWithin(warp.id, 0, at);
        expect(Math.abs(bent.u - at.u), `${warp.id} moved u at nought`).toBeLessThan(1e-9);
        expect(Math.abs(bent.v - at.v), `${warp.id} moved v at nought`).toBeLessThan(1e-9);
      }
    }
  });

  it("actually bend something when the amount is not", () => {
    // Guards against a warp that is quietly the identity, which would be a
    // name in a menu that does nothing.
    for (const warp of WARPS) {
      const moved = [
        { u: 0.5, v: 0.5 },
        { u: 0.3, v: 0.7 },
        { u: 0.5, v: 0.2 },
      ].some((at) => {
        const bent = warpWithin(warp.id, 0.4, at);
        return Math.hypot(bent.u - at.u, bent.v - at.v) > 1e-3;
      });
      expect(moved, `${warp.id} does nothing`).toBe(true);
    }
  });

  it("give a finite answer everywhere, at every amount worth asking for", () => {
    for (const warp of WARPS) {
      for (const amount of [-1, -0.5, 0.5, 1]) {
        for (let u = 0; u <= 1; u += 0.25) {
          for (let v = 0; v <= 1; v += 0.25) {
            const bent = warpWithin(warp.id, amount, { u, v });
            expect(
              Number.isFinite(bent.u) && Number.isFinite(bent.v),
              `${warp.id} at ${amount}, ${u}, ${v}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("agree with each other on what the amount means", () => {
    /*
     * Ten names and one slider, so the number under it has to mean the same
     * thing whichever name is picked. Measured rather than declared: the
     * furthest anything in the box is moved, swept across the whole of it,
     * which is the only way to compare a sine against a rotation against a
     * scale about the middle.
     *
     * They did not agree before this was pinned. Rise moved four times as far
     * as Fisheye at the same setting, Twist three, Wave and Inflate a little
     * under the rest -- so somebody who learned what forty felt like on one
     * warp had learned nothing about the next. `LEVEL` in the module is what
     * brings them together, and this is the test that says whether it still
     * does: change a field's arithmetic and its entry goes stale, and the run
     * says so rather than the slider quietly meaning two things again.
     */
    const reach = (name: WarpName, amount: number): number => {
      let most = 0;
      for (let u = 0; u <= 1.0001; u += 0.02) {
        for (let v = 0; v <= 1.0001; v += 0.02) {
          const bent = warpWithin(name, amount, { u, v });
          most = Math.max(most, Math.hypot(bent.u - u, bent.v - v));
        }
      }
      return most;
    };

    for (const amount of [0.12, 0.4, 1]) {
      /*
       * Half the amount, as a fraction of the box: an arc at one bows the
       * middle out by half the box's height, and that is the bow the other
       * nine are levelled against.
       */
      const wanted = amount / 2;
      for (const warp of WARPS) {
        const got = reach(warp.id, amount);
        /*
         * A tenth, which is tight enough to catch the four-fold spread this
         * was written for and loose enough for the one warp that cannot be
         * exact at both ends of the slider: a twist turns, so its reach falls
         * behind its slope as the angle opens, by about four percent at one.
         */
        expect(
          Math.abs(got - wanted) / wanted,
          `${warp.id} at ${amount} reaches ${got}`,
        ).toBeLessThan(0.1);
      }
    }
  });

  it("leaves the bottom standing where an arch is asked for", () => {
    // The difference between Arc and Arch, and the reason both are offered.
    const bottom = { u: 0.5, v: 0 };
    expect(Math.abs(warpWithin("arch", 0.5, bottom).v - 0)).toBeLessThan(1e-9);
    expect(Math.abs(warpWithin("arc", 0.5, bottom).v - 0)).toBeGreaterThan(0.1);
  });
});

describe("warping an outline", () => {
  const square = ring([node(0, 0), node(100, 0), node(100, 100), node(0, 100)]);
  const all = { has: () => true };
  const none = { has: () => false };

  it("leaves a point nobody picked exactly where it was", () => {
    /*
     * The rule the whole feature rests on. A contour can be cut somewhere else
     * entirely and the unpicked node still has to come back with the same
     * coordinates, not merely near them.
     */
    const only = { has: (_c: number, n: number) => n === 0 || n === 1 };
    const { contours } = warpContours([square], only, fieldMove(BOX, "bulge", 0.8));
    const stayed = contours[0].nodes.filter((one) => one.point.y === 100);
    expect(stayed.length, "the two unpicked corners should still be there").toBe(2);
    for (const one of stayed) expect(one.point.x === 0 || one.point.x === 100).toBe(true);
  });

  it("moves nothing when nothing is picked", () => {
    const { contours, cost } = warpContours([square], none, fieldMove(BOX, "twist", 1));
    expect(points(contours)).toEqual(points([square]));
    expect(cost.after).toBe(cost.before);
  });

  it("adds no points for a map that needs none", () => {
    // Every quad map takes a cubic to a cubic closely enough, so cutting is
    // off for them and the letter comes back with the count it went in with.
    const pulled: Quad = {
      bottomLeft: { x: 0, y: 0 },
      bottomRight: { x: 120, y: -10 },
      topRight: { x: 100, y: 90 },
      topLeft: { x: 10, y: 100 },
    };
    const { cost } = warpContours([square], all, quadMove(BOX, pulled, "distort"), { cut: false });
    expect(cost.after).toBe(cost.before);
  });

  it("cuts a straight segment so it can follow a bend", () => {
    /*
     * The fault this is all for. A stem drawn with two points has nothing
     * between them for a bulge to move, so without cutting the line between
     * them stays straight and the warp appears not to have worked.
     */
    const move = fieldMove(BOX, "bulge", 0.6);
    const { contours, cost } = warpContours([square], all, move);
    expect(cost.after, "the segments should have been cut").toBeGreaterThan(cost.before);

    // And the outline now follows the field: the middle of what was the bottom
    // edge sits where the bulge put it rather than on the straight line.
    const wanted = move({ x: 50, y: 0 });
    const nearest = contours[0].nodes.reduce((best, one) =>
      Math.hypot(one.point.x - wanted.x, one.point.y - wanted.y) <
      Math.hypot(best.point.x - wanted.x, best.point.y - wanted.y)
        ? one
        : best,
    );
    expect(
      Math.hypot(nearest.point.x - wanted.x, nearest.point.y - wanted.y),
      "no point landed near where the bulge puts the middle of that edge",
    ).toBeLessThan(4);
  });

  it("keeps a straight segment straight when it was not cut", () => {
    // A segment with a loose end is left whole, and a whole straight segment
    // must not gain two handles sitting on top of its own points -- which
    // reads as a curve to everything downstream.
    const line = ring([node(0, 0), node(100, 0)], false);
    const { contours } = warpContours([line], none, fieldMove(BOX, "arc", 0.5));
    expect(contours[0].nodes[0].handleOut).toBeNull();
    expect(contours[0].nodes[1].handleIn).toBeNull();
  });

  it("carries the handles of a curve through a map", () => {
    const curve = ring([node(10, 10, true), node(90, 10, true)], false);
    const { contours } = warpContours([curve], all, fieldMove(BOX, "rise", 0.3), { cut: false });
    for (const one of contours[0].nodes) {
      expect(one.handleIn, "a handle went missing").not.toBeNull();
      expect(one.handleOut).not.toBeNull();
    }
    // And they moved with their point rather than staying behind.
    expect(contours[0].nodes[0].handleOut!.y).not.toBe(10);
  });

  it("does not cut for ever, whatever it is asked to follow", () => {
    // A warp with a great deal of amount has places no number of cuts would
    // satisfy, and a letter is not improved by two hundred points in a curve.
    const { cost } = warpContours([square], all, fieldMove(BOX, "twist", 1), { within: 0.001 });
    expect(cost.after).toBeLessThan(cost.before * 40);
  });

  it("says what it would cost before anybody agrees to it", () => {
    const { cost } = warpContours([square], all, fieldMove(BOX, "fisheye", 0.7));
    expect(cost.before).toBe(4);
    expect(cost.after).toBeGreaterThan(4);
  });

  it("moves the very points the box was drawn round", () => {
    /*
     * The one that found a warp doing nothing.
     *
     * The box is drawn round what is selected, so the selection's own extremes
     * are on its rim by definition. A radial warp whose falloff reaches zero
     * at the rim therefore moves none of the points somebody actually picked:
     * a stem selected at its four corners came back identical, and the tool
     * looked broken rather than gentle.
     */
    for (const warp of ["fisheye", "inflate", "twist"] as const) {
      const { contours } = warpContours([square], all, fieldMove(BOX, warp, 0.6), { cut: false });
      const moved = contours[0].nodes.filter(
        (one, at) =>
          Math.hypot(
            one.point.x - square.nodes[at].point.x,
            one.point.y - square.nodes[at].point.y,
          ) > 1,
      );
      expect(moved.length, `${warp} left every corner of the box where it was`).toBeGreaterThan(0);
    }
  });
});
