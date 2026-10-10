/**
 * Which side of a bowl is its inside, and how far heft moves it: read off
 * the skeleton and the pen alone.
 */

import { describe, expect, it } from "vitest";

import { heftShift, innerSide } from "./heft";
import { type Headed, penReach, reachAlong } from "./sweep";
import type { Pen, SpineSegment, Stroke } from "./types";

const headed = (...segments: SpineSegment[]): Headed[] =>
  segments.map((segment) => ({ segment, start: { x: 0, y: 1 }, end: { x: 0, y: 1 } }));
const arc = (from: number, to: number, positive: boolean): SpineSegment => ({
  kind: "arc",
  centre: { x: 0, y: 0 },
  radius: 100,
  startAngle: (from * Math.PI) / 180,
  endAngle: (to * Math.PI) / 180,
  sweepPositive: positive,
});
const line: SpineSegment = { kind: "line", from: { x: 0, y: 0 }, to: { x: 0, y: 100 } };

describe("innerSide", () => {
  it("is the left of travel for a turn anticlockwise, the right for one clockwise", () => {
    expect(innerSide(headed(arc(55, 305, true)))).toBe(1);
    expect(innerSide(headed(arc(305, 55, false)))).toBe(-1);
    expect(innerSide(headed(line, arc(0, 90, true), line))).toBe(1);
  });

  it("is nought where nothing turns, or turns as far back again", () => {
    expect(innerSide(headed(line))).toBe(0);
    expect(innerSide(headed())).toBe(0);
    expect(innerSide(headed(arc(0, 90, true), arc(270, 180, false)))).toBe(0);
    // A piece of no sweep turns nowhere.
    expect(innerSide(headed(arc(40, 40, true)))).toBe(0);
  });
});

describe("heftShift", () => {
  const stroke = (pen: Pen, heft?: { share: number; tilt: number }): Stroke => ({
    spine: { segments: [arc(55, 305, true)], closed: false },
    pen,
    start: { kind: "butt" },
    end: { kind: "butt" },
    ...(heft ? { heft } : {}),
  });
  const round: Pen = { weight: 40, contrast: 0, angle: 0 };

  it("moves nothing on a stroke with no heft", () => {
    expect(heftShift(stroke(round), penReach(round))).toEqual({ x: 0, y: 0 });
  });

  it("is the share of the stroke's width straight up", () => {
    const by = heftShift(stroke(round, { share: 0.4, tilt: 0 }), penReach(round));
    expect(by.x).toBeCloseTo(0, 12);
    expect(by.y).toBeCloseTo(0.4 * 40, 12);
  });

  it("leans with the tilt, to the right where positive", () => {
    const by = heftShift(stroke(round, { share: 0.25, tilt: 30 }), penReach(round));
    expect(by.x).toBeCloseTo(10 * Math.sin(Math.PI / 6), 12);
    expect(by.y).toBeCloseTo(10 * Math.cos(Math.PI / 6), 12);
  });

  it("is measured across the pen the way it moves, and never past 1.2 of its narrow reach", () => {
    const pen: Pen = { weight: 87, contrast: 0.55, angle: 8 };
    const reach = penReach(pen);
    const way = { x: Math.sin((-20 * Math.PI) / 180), y: Math.cos((-20 * Math.PI) / 180) };
    const across = reachAlong(way, reach);
    const width = 2 * Math.abs(across.x * way.x + across.y * way.y);
    const small = heftShift(stroke(pen, { share: 0.1, tilt: -20 }), reach);
    expect(Math.hypot(small.x, small.y)).toBeCloseTo(0.1 * width, 9);
    expect(small.x).toBeLessThan(0);
    // Past the panel's half, which this pen would otherwise take further than that.
    expect(0.9 * width).toBeGreaterThan(1.2 * reach.along);
    const large = heftShift(stroke(pen, { share: 0.9, tilt: -20 }), reach);
    expect(Math.hypot(large.x, large.y)).toBeCloseTo(1.2 * reach.along, 9);
  });
});
