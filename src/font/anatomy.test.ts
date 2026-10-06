import { describe, expect, it } from "vitest";

import { findCrossbar, findShoulders, shiftCrossbar, shiftShoulders } from "./anatomy";
import { contourSegments, contoursBounds, cubicAt } from "./geometry";
import { contoursIntersect } from "./outline";
import type { Contour, Vec2 } from "./types";

function polygon(points: Vec2[]): Contour {
  return {
    closed: true,
    nodes: points.map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" })),
  };
}

function rect(x: number, y: number, width: number, height: number): Contour {
  return polygon([
    { x, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
    { x: x + width, y },
  ]);
}

/** Two uprights with a bar across the middle. */
const H_SHAPE = [rect(0, 0, 200, 1400), rect(800, 0, 200, 1400), rect(200, 600, 600, 200)];

describe("findCrossbar", () => {
  it("finds the bar between two stems", () => {
    const bar = findCrossbar(H_SHAPE)!;
    expect(bar.bottom).toBeCloseTo(600, 6);
    expect(bar.top).toBeCloseTo(800, 6);
  });

  it("finds nothing on a letter with no crossing stroke", () => {
    expect(findCrossbar([rect(0, 0, 200, 1400)])).toBeNull();
  });

  /**
   * A bar at the very top or bottom is the end of the letter, not something
   * crossing it, and moving it would change the letter's height. This is why a
   * T reports no crossbar on the real font while an H reports one.
   */
  it("ignores a bar sitting at the top of the letter", () => {
    const tShape = [rect(400, 0, 200, 1200), rect(0, 1200, 1000, 200)];
    expect(findCrossbar(tShape)).toBeNull();
  });

  it("takes the bar nearest the middle when there are several", () => {
    const eShape = [
      rect(0, 0, 200, 1400),
      rect(200, 0, 700, 200), // foot arm
      rect(200, 600, 600, 200), // middle arm
      rect(200, 1200, 700, 200), // top arm
    ];
    const bar = findCrossbar(eShape)!;
    expect((bar.bottom + bar.top) / 2).toBeCloseTo(700, 6);
  });

  it("has nothing to find in an empty glyph", () => {
    expect(findCrossbar([])).toBeNull();
  });
});

describe("shiftCrossbar", () => {
  it("moves the bar and leaves the stems standing", () => {
    const moved = shiftCrossbar(H_SHAPE, 150);
    const bar = findCrossbar(moved)!;
    expect(bar.bottom).toBeCloseTo(750, 6);
    expect(bar.top).toBeCloseTo(950, 6);
  });

  it("does not change the height of the letter", () => {
    const before = contoursBounds(H_SHAPE);
    const after = contoursBounds(shiftCrossbar(H_SHAPE, 150));
    expect(after.yMin).toBeCloseTo(before.yMin, 6);
    expect(after.yMax).toBeCloseTo(before.yMax, 6);
  });

  it("lowers the bar as readily as it raises it", () => {
    const bar = findCrossbar(shiftCrossbar(H_SHAPE, -200))!;
    expect(bar.bottom).toBeCloseTo(400, 6);
  });

  it("leaves a letter with no bar alone", () => {
    const stem = [rect(0, 0, 200, 1400)];
    expect(shiftCrossbar(stem, 150)).toBe(stem);
  });

  it("does nothing when asked for no shift", () => {
    expect(shiftCrossbar(H_SHAPE, 0)).toBe(H_SHAPE);
  });
});

/**
 * An arch, built the way a real n is.
 *
 * The left stem is a trunk running the full height, interrupted where the arch
 * leaves it: an upright run from 800 to 1000 above the springing and another
 * from 0 to 500 below it. The right stem exists only as the arch coming down,
 * so its runs stop at the junctions. That difference is what separates a
 * shoulder from a landing.
 */
const ARCH: Contour = {
  closed: true,
  nodes: [
    { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 0, y: 1000 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 200, y: 1000 }, handleIn: null, handleOut: null, type: "corner" },
    // Springs from the trunk here.
    { point: { x: 200, y: 800 }, handleIn: null, handleOut: { x: 350, y: 1000 }, type: "corner" },
    // Lands on the right stem, which starts here.
    { point: { x: 600, y: 800 }, handleIn: { x: 450, y: 1000 }, handleOut: null, type: "corner" },
    { point: { x: 600, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 400, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 400, y: 600 }, handleIn: null, handleOut: { x: 350, y: 700 }, type: "corner" },
    // The inner springing, back on the trunk.
    { point: { x: 200, y: 500 }, handleIn: { x: 250, y: 700 }, handleOut: null, type: "corner" },
    { point: { x: 200, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
  ],
};

describe("findShoulders", () => {
  it("finds where the arch springs from the trunk", () => {
    const shoulders = findShoulders([ARCH]);
    expect(shoulders.map((point) => point.x)).toEqual([200, 200]);
    expect(shoulders.map((point) => point.y).sort((a, b) => a - b)).toEqual([500, 800]);
  });

  /**
   * The other two junctions on this shape are where the arch comes down. On a
   * real n those are the right stem, and moving them drags the far side of the
   * letter about rather than changing the shoulder.
   */
  it("leaves out the junctions where the arch lands", () => {
    const shoulders = findShoulders([ARCH]);
    expect(shoulders).toHaveLength(2);
    expect(shoulders.some((point) => point.x === 600)).toBe(false);
    expect(shoulders.some((point) => point.x === 400)).toBe(false);
  });

  it("finds nothing on a letter with no straight stem", () => {
    const k = 0.5522847498 * 400;
    const circle: Contour = {
      closed: true,
      nodes: [
        {
          point: { x: 100, y: 500 },
          handleIn: { x: 100, y: 500 - k },
          handleOut: { x: 100, y: 500 + k },
          type: "smooth",
        },
        {
          point: { x: 500, y: 900 },
          handleIn: { x: 500 - k, y: 900 },
          handleOut: { x: 500 + k, y: 900 },
          type: "smooth",
        },
        {
          point: { x: 900, y: 500 },
          handleIn: { x: 900, y: 500 + k },
          handleOut: { x: 900, y: 500 - k },
          type: "smooth",
        },
        {
          point: { x: 500, y: 100 },
          handleIn: { x: 500 + k, y: 100 },
          handleOut: { x: 500 - k, y: 100 },
          type: "smooth",
        },
      ],
    };
    expect(findShoulders([circle])).toHaveLength(0);
  });

  it("does not mistake the flat end of an arm for a shoulder", () => {
    // A horizontal bar with a curve off its end: the straight edge is not
    // upright, so nothing springs from a stem here.
    const arm: Contour = {
      closed: true,
      nodes: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 0, y: 200 }, handleIn: null, handleOut: null, type: "corner" },
        {
          point: { x: 800, y: 200 },
          handleIn: null,
          handleOut: { x: 900, y: 200 },
          type: "corner",
        },
        { point: { x: 800, y: 0 }, handleIn: { x: 900, y: 0 }, handleOut: null, type: "corner" },
      ],
    };
    expect(findShoulders([arm])).toHaveLength(0);
  });
});

describe("shiftShoulders", () => {
  it("raises where the arch springs", () => {
    const moved = shiftShoulders([ARCH], 100);
    expect(moved[0].nodes[3].point).toEqual({ x: 200, y: 900 });
    expect(moved[0].nodes[8].point).toEqual({ x: 200, y: 600 });
  });

  it("carries the handle with the point so the curve keeps its shape", () => {
    const moved = shiftShoulders([ARCH], -100);
    expect(moved[0].nodes[3].handleOut).toEqual({ x: 350, y: 900 });
  });

  /**
   * Raising the junction carries its handle up too, but not past the top of
   * the arch: the shoulder squares up against it rather than bulging over, and
   * on a real n bulging over would make the letter taller than the x-height.
   */
  it("never lifts the arch above its own top", () => {
    const moved = shiftShoulders([ARCH], 100);
    expect(moved[0].nodes[3].handleOut).toEqual({ x: 350, y: 1000 });
  });

  /**
   * The stem edge the junction ends is stretched to follow, pinned at its far
   * end, rather than the junction alone being dragged: dragged past the next
   * point down, it folds the stem back on itself.
   */
  it("stretches the stem edge after the junction instead of folding it", () => {
    const moved = shiftShoulders([ARCH], -100);
    expect(moved[0].nodes[2].point).toEqual({ x: 200, y: 1000 });
    expect(moved[0].nodes[8].point).toEqual({ x: 200, y: 400 });
    expect(moved[0].nodes[9].point).toEqual({ x: 200, y: 0 });
  });

  /**
   * The move goes only as far as the arch has room: past three quarters of
   * the way to its top the junction would climb the stem above it and drag
   * the arch after it into a hook.
   */
  it("stops short of the top of the arch", () => {
    // The arch tops out at 950, so three quarters of the way there from 800
    // is 912.5 -- where the search for the furthest clean move lands exactly,
    // however far past it the move was asked to go.
    for (const shift of [120, 400]) {
      const moved = shiftShoulders([ARCH], shift);
      expect(moved[0].nodes[3].point).toEqual({ x: 200, y: 800 + 150 * 0.75 });
      expect(moved[0].nodes[8].point).toEqual({ x: 200, y: 500 + 150 * 0.75 });
    }
  });

  it("leaves the far side of the letter where it was", () => {
    const moved = shiftShoulders([ARCH], 120);
    // The right stem is where the arch lands, not where it springs.
    expect(moved[0].nodes[4].point).toEqual({ x: 600, y: 800 });
    expect(moved[0].nodes[7].point).toEqual({ x: 400, y: 600 });
  });

  it("leaves the rest of the trunk where it was", () => {
    const moved = shiftShoulders([ARCH], 120);
    expect(moved[0].nodes[0].point).toEqual({ x: 0, y: 0 });
    expect(moved[0].nodes[1].point).toEqual({ x: 0, y: 1000 });
    expect(moved[0].nodes[2].point).toEqual({ x: 200, y: 1000 });
  });

  it("leaves a letter with no shoulder alone", () => {
    const stem = [rect(0, 0, 200, 1400)];
    expect(shiftShoulders(stem, 120)).toBe(stem);
  });

  it("does nothing when asked for no shift", () => {
    expect(shiftShoulders([ARCH], 0)[0]).toBe(ARCH);
  });
});

describe("a crossbar attached to curves", () => {
  /**
   * A bar whose lower edge meets the letter on curves, as an e's does.
   *
   * The curves either side of that edge run downward from it, so no point on
   * either sits above y=300 and there is nothing to slide along. On a real e
   * the bar ends at (305,516) on a curve dropping to (420,227), which is the
   * same situation.
   */
  const OUTER: Contour = {
    closed: true,
    nodes: [
      { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: 0, y: 300 }, handleIn: { x: 0, y: 150 }, handleOut: null, type: "corner" },
      { point: { x: 900, y: 300 }, handleIn: null, handleOut: { x: 900, y: 150 }, type: "corner" },
      { point: { x: 900, y: 1200 }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: 0, y: 1200 }, handleIn: null, handleOut: null, type: "corner" },
    ],
  };
  const COUNTER = polygon([
    { x: 200, y: 450 },
    { x: 700, y: 450 },
    { x: 700, y: 900 },
    { x: 200, y: 900 },
  ]);
  const SHAPE = [OUTER, COUNTER];

  it("finds the bar between the curved edge and the counter", () => {
    const bar = findCrossbar(SHAPE)!;
    expect(bar.bottom).toBeCloseTo(300, 6);
    expect(bar.top).toBeCloseTo(450, 6);
  });

  it("moves the bar even where no point on the curve sits at that height", () => {
    const moved = shiftCrossbar(SHAPE, 120);
    expect(moved[0].nodes[1].point.y).toBeCloseTo(420, 6);
    expect(moved[0].nodes[2].point.y).toBeCloseTo(420, 6);
  });

  /**
   * The two ends of this bar take different routes, which is the whole point.
   *
   * On the left the curve runs (0,0) to (0,300) and never reaches 420, so the
   * end is moved there and the curve stretches after it, its handle travelling
   * by the same amount. On the right the curve runs (900,300) to (900,1200) and
   * passes through 420 at t=0.29, so that end slides exactly along it and the
   * curve is split rather than reshaped.
   */
  it("stretches the curve that cannot reach, and slides along the one that can", () => {
    const moved = shiftCrossbar(SHAPE, 120);

    // Stretched: the handle moved with the point.
    expect(moved[0].nodes[1].handleIn!.y).toBeCloseTo(270, 6);

    // Slid: the point sits on the curve that was already there, at 420, and the
    // handle is the split's own rather than the old one carried up.
    expect(moved[0].nodes[2].point.y).toBeCloseTo(420, 6);
    expect(moved[0].nodes[2].handleOut!.y).not.toBeCloseTo(270, 6);
    expect(moved[0].nodes[2].handleOut!.y).toBeGreaterThan(420);
  });

  it("leaves the rest of the letter where it was", () => {
    const moved = shiftCrossbar(SHAPE, 120);
    expect(moved[0].nodes[0].point).toEqual({ x: 0, y: 0 });
    expect(moved[0].nodes[3].point).toEqual({ x: 900, y: 1200 });
    expect(moved[0].nodes[4].point).toEqual({ x: 0, y: 1200 });
  });

  it("keeps the letter the same height", () => {
    const before = contoursBounds(SHAPE);
    const after = contoursBounds(shiftCrossbar(SHAPE, 120));
    expect(after.yMin).toBeCloseTo(before.yMin, 6);
    expect(after.yMax).toBeCloseTo(before.yMax, 6);
  });

  it("moves the bar the other way just as readily", () => {
    const moved = shiftCrossbar(SHAPE, -120);
    expect(moved[0].nodes[1].point.y).toBeCloseTo(180, 6);
  });
});

describe("the waist of a P", () => {
  /**
   * A P whose bowl has a flat bottom: a straight piece from the stem that runs
   * on smoothly into the curve of the bowl, as DejaVu and Geist draw P, R and
   * B. It is not a bar crossing anything, but moving it is how the bowl is
   * made bigger or smaller, so it moves as a waist: the flat edges travel and
   * the curves joining them to the bowl stretch after them.
   */
  const P_SHAPE: Contour[] = [
    {
      closed: true,
      nodes: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 0, y: 1400 }, handleIn: null, handleOut: null, type: "corner" },
        {
          point: { x: 500, y: 1400 },
          handleIn: null,
          handleOut: { x: 800, y: 1400 },
          type: "smooth",
        },
        {
          point: { x: 500, y: 600 },
          handleIn: { x: 800, y: 600 },
          handleOut: null,
          type: "smooth",
        },
        { point: { x: 200, y: 600 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 200, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
      ],
    },
    {
      closed: true,
      nodes: [
        { point: { x: 200, y: 800 }, handleIn: null, handleOut: null, type: "corner" },
        {
          point: { x: 500, y: 800 },
          handleIn: null,
          handleOut: { x: 650, y: 800 },
          type: "smooth",
        },
        {
          point: { x: 500, y: 1200 },
          handleIn: { x: 650, y: 1200 },
          handleOut: null,
          type: "smooth",
        },
        { point: { x: 200, y: 1200 }, handleIn: null, handleOut: null, type: "corner" },
      ],
    },
  ];

  it("moves the waist by the amount asked, and keeps the letter's height", () => {
    const moved = shiftCrossbar(P_SHAPE, 100);
    const bar = findCrossbar(moved)!;
    expect(bar.bottom).toBeCloseTo(700, 6);
    expect(bar.top).toBeCloseTo(900, 6);
    expect(contoursBounds(moved).yMax).toBeCloseTo(1400, 6);
  });

  /**
   * The bowl is redrawn around the new waist rather than bent to meet it:
   * everything between the counter's top edge and the baseline is spread up or
   * down, nothing moves sideways, and the top stroke above the counter stays
   * exactly as drawn.
   */
  it("redraws the bowl around the waist without widening it", () => {
    for (const shift of [100, -100]) {
      const moved = shiftCrossbar(P_SHAPE, shift);
      expect(contoursIntersect(moved)).toBe(false);
      expect(moved.map((contour) => contour.nodes.length)).toEqual([6, 4]);
      const was = contoursBounds(P_SHAPE);
      const now = contoursBounds(moved);
      expect(now.xMax).toBeCloseTo(was.xMax, 6);
      expect(now.yMin).toBeCloseTo(was.yMin, 6);
      // The counter's top edge and the stroke above it are where they were.
      expect(moved[1].nodes[2].point.y).toBe(1200);
      expect(moved[1].nodes[3].point.y).toBe(1200);
      expect(moved[0].nodes[2]).toEqual(P_SHAPE[0].nodes[2]);
      // And the bowl's curves stay smooth: a handle that was level still is.
      const join = contourSegments(moved[0])[2];
      if (join.kind !== "cubic") throw new Error("the join should be a curve");
      expect(join.c2.y).toBeCloseTo(join.to.y, 6);
      expect(cubicAt(join.from, join.c1, join.c2, join.to, 0.5).x).toBeLessThanOrEqual(800);
    }
  });
});

describe("things at a bar's height that are not bars", () => {
  /**
   * Two arms either side of a stem whose tops differ by three and a half
   * units, as the two halves of Lora's 4 do. Read as two levels, those tops
   * were a bar three and a half units thick, nearer the middle than the real
   * one, and moving it filled the letter in.
   */
  const FOUR_ISH = [rect(400, 0, 200, 1400), rect(0, 400, 400, 200), rect(600, 400, 300, 203.5)];

  it("reads edges a few units apart as one edge", () => {
    const bar = findCrossbar(FOUR_ISH)!;
    expect(bar.bottom).toBeCloseTo(400, 6);
    expect(bar.top).toBeGreaterThan(600);
    expect(bar.top).toBeLessThan(603.5);
  });

  it("moves both halves of a bar the stem cuts in two", () => {
    const moved = shiftCrossbar(FOUR_ISH, 100);
    expect(contoursBounds([moved[1]]).yMin).toBeCloseTo(500, 6);
    expect(contoursBounds([moved[2]]).yMin).toBeCloseTo(500, 6);
    expect(contoursBounds([moved[2]]).yMax).toBeCloseTo(703.5, 6);
    expect(moved[0]).toBe(FOUR_ISH[0]);
  });
});

describe("things at a stem that are not shoulders", () => {
  /**
   * An I with bracketed serifs lined up down its left edge. The short upright
   * ends of the serifs, 1300 units apart on the same x, counted as one stem
   * carrying on past a junction, so each bracket was a shoulder and the
   * control put spikes on the serifs of every straight-sided letter.
   */
  const I_SHAPE: Contour[] = [
    {
      closed: true,
      nodes: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 0, y: 50 }, handleIn: null, handleOut: { x: 80, y: 50 }, type: "corner" },
        { point: { x: 100, y: 150 }, handleIn: { x: 100, y: 70 }, handleOut: null, type: "corner" },
        {
          point: { x: 100, y: 1250 },
          handleIn: null,
          handleOut: { x: 100, y: 1330 },
          type: "corner",
        },
        { point: { x: 0, y: 1350 }, handleIn: { x: 80, y: 1350 }, handleOut: null, type: "corner" },
        { point: { x: 0, y: 1400 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 400, y: 1400 }, handleIn: null, handleOut: null, type: "corner" },
        {
          point: { x: 400, y: 1350 },
          handleIn: null,
          handleOut: { x: 320, y: 1350 },
          type: "corner",
        },
        {
          point: { x: 300, y: 1250 },
          handleIn: { x: 300, y: 1330 },
          handleOut: null,
          type: "corner",
        },
        { point: { x: 300, y: 150 }, handleIn: null, handleOut: { x: 300, y: 70 }, type: "corner" },
        { point: { x: 400, y: 50 }, handleIn: { x: 320, y: 50 }, handleOut: null, type: "corner" },
        { point: { x: 400, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
      ],
    },
  ];

  it("does not take the bracket under a serif for a shoulder", () => {
    expect(findShoulders(I_SHAPE)).toHaveLength(0);
    expect(shiftShoulders(I_SHAPE, 100)).toBe(I_SHAPE);
  });
});
