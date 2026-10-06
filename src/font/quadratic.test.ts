import { describe, expect, it } from "vitest";

import { contourToGlyfPoints, cubicToQuadratics, quadraticToCubic } from "./quadratic";
import type { Contour } from "./types";

describe("contourToGlyfPoints", () => {
  it("does not turn a curve that leaves its extreme level into one that turns inside", () => {
    // The tail of a curly c at a heavy weight: it leaves the stem heading
    // straight down, so its start is its leftmost point. The best single
    // quadratic is within tolerance but puts its control three units left of
    // that start, which a file checker reports as a turn with no point on it.
    const contour: Contour = {
      closed: false,
      nodes: [
        {
          point: { x: 322.678, y: 554.029 },
          handleIn: null,
          handleOut: { x: 322.678, y: 421.315 },
          type: "smooth",
        },
        {
          point: { x: 414.257, y: 240.225 },
          handleIn: { x: 349.993, y: 316.588 },
          handleOut: null,
          type: "smooth",
        },
      ],
    };
    const points = contourToGlyfPoints(contour);
    const start = points[0];
    for (const point of points) expect(point.x).toBeGreaterThanOrEqual(start.x);
  });
});

/** A closed contour of level ends and one quadratic between them, raised to a cubic. */
const bump = (height: number): Contour => {
  const { c1, c2 } = quadraticToCubic(
    { x: 0, y: 100 },
    { x: 20, y: 100 + height },
    { x: 40, y: 100 },
  );
  return {
    closed: true,
    nodes: [
      { point: { x: 0, y: 100 }, handleIn: null, handleOut: c1, type: "corner" },
      { point: { x: 40, y: 100 }, handleIn: c2, handleOut: null, type: "corner" },
      { point: { x: 40, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    ],
  };
};

const controlsOf = (contour: Contour) =>
  contourToGlyfPoints(contour).filter((point) => !point.onCurve);

describe("contourToGlyfPoints, a control between two level ends", () => {
  /*
   * A real bulge, a unit high: the quadratic's control two units above its
   * level ends. It is exactly a quadratic, so fitting it costs nothing and
   * the control arrives on the grid already -- nothing here is error, and
   * pulling it level would draw a flat top that was never drawn.
   */
  it("keeps a genuine small bulge", () => {
    expect(controlsOf(bump(2))).toEqual([{ x: 20, y: 102, onCurve: false }]);
  });

  it("keeps a genuine small dip", () => {
    expect(controlsOf(bump(-2))).toEqual([{ x: 20, y: 98, onCurve: false }]);
  });

  /*
   * A unit off is noise: it moves the outline half a unit, the tolerance the
   * fit works to, and a checker would report the turn halfway along with no
   * point on it.
   */
  it("pulls a control a single unit off its level ends back level", () => {
    expect(controlsOf(bump(1))).toEqual([{ x: 20, y: 100, onCurve: false }]);
    expect(controlsOf(bump(-1))).toEqual([{ x: 20, y: 100, onCurve: false }]);
  });

  it("still pulls a control two units past an end that is not level with the other", () => {
    // Ends at 0 and 60 across; the control two units left of the left one.
    const { c1, c2 } = quadraticToCubic({ x: 0, y: 0 }, { x: -2, y: 50 }, { x: 60, y: 100 });
    const contour: Contour = {
      closed: false,
      nodes: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: c1, type: "corner" },
        { point: { x: 60, y: 100 }, handleIn: c2, handleOut: null, type: "corner" },
      ],
    };
    expect(controlsOf(contour)).toEqual([{ x: 0, y: 50, onCurve: false }]);
  });
});

/*
 * `overshootsTurn`, through the one function that asks it: a fit that is close
 * enough is still refused when it turns where the cubic does not.
 */
describe("cubicToQuadratics, a fit that turns where the cubic does not", () => {
  // The curly c's tail from above: leaves its start dead level, going down.
  const from = { x: 322.678, y: 554.029 };
  const c1 = { x: 322.678, y: 421.315 };
  const c2 = { x: 349.993, y: 316.588 };
  const to = { x: 414.257, y: 240.225 };

  it("splits it rather than keep a control past the start", () => {
    // Loose enough that the error alone would settle for a single quadratic.
    expect(cubicToQuadratics(from, c1, c2, to, 1000)).not.toHaveLength(1);
    const quads = cubicToQuadratics(from, c1, c2, to, 10);
    expect(quads.length).toBeGreaterThan(1);
    // No control more than the allowed unit left of the start.
    for (const quad of quads) expect(quad.control.x).toBeGreaterThanOrEqual(from.x - 1);
    expect(quads[quads.length - 1].to).toEqual(to);
  });

  it("takes a single quadratic for a cubic that really does turn inside", () => {
    // An arch: turns at the top, so a control above both ends is right.
    const quads = cubicToQuadratics(
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      1000,
    );
    expect(quads).toHaveLength(1);
    expect(quads[0].control.y).toBeGreaterThan(100);
  });

  it("takes a single quadratic that stays level with its start", () => {
    // Exactly a quadratic, its control straight above its start.
    const q = quadraticToCubic({ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 50, y: 100 });
    const quads = cubicToQuadratics({ x: 0, y: 0 }, q.c1, q.c2, { x: 50, y: 100 }, 0.5);
    expect(quads).toHaveLength(1);
    expect(quads[0].control.x).toBeCloseTo(0, 9);
    expect(quads[0].control.y).toBeCloseTo(50, 9);
  });
});
