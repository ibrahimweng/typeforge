import { describe, expect, it } from "vitest";

import { arcAsCubics, PLAIN_HAND, restyleStroke } from "./controls";
import { pointOn } from "./curve";
import type { QuillArc, QuillStroke } from "./types";

/** An arc about the origin of radius two hundred, anticlockwise when positive. */
function arc(startAngle: number, endAngle: number): QuillArc {
  return {
    kind: "arc",
    centre: { x: 0, y: 0 },
    radius: 200,
    startAngle,
    endAngle,
    sweepPositive: endAngle >= startAngle,
  };
}

/** The furthest any of these cubics strays from the circle, in units. */
function strayFromCircle(segment: QuillArc): number {
  let worst = 0;
  for (const cubic of arcAsCubics(segment)) {
    for (let step = 0; step <= 64; step++) {
      const point = pointOn(cubic, step / 64);
      worst = Math.max(worst, Math.abs(Math.hypot(point.x, point.y) - segment.radius));
    }
  }
  return worst;
}

describe("an arc turned into cubics", () => {
  /*
   * One cubic for any sweep, as this used to make, is out by nearly two
   * percent of the radius at a half turn and has infinite handles at a whole
   * one. Cut into quarters or less it stays inside a tenth of a unit of the
   * circle on a bowl two hundred units across, whatever the sweep.
   */
  it.each([
    ["a quarter turn", Math.PI / 2],
    ["a half turn", Math.PI],
    ["three quarters", (3 * Math.PI) / 2],
    ["a whole turn", Math.PI * 2],
    ["a whole turn backwards", -Math.PI * 2],
  ])("keeps %s on the circle", (_, sweep) => {
    const segment = arc(0.3, 0.3 + sweep);
    expect(strayFromCircle(segment)).toBeLessThan(0.1);
  });

  it("cuts it into pieces of no more than a quarter turn, end to end", () => {
    const cubics = arcAsCubics(arc(0, Math.PI * 2));
    expect(cubics).toHaveLength(4);
    expect(arcAsCubics(arc(0, Math.PI / 2))).toHaveLength(1);
    expect(arcAsCubics(arc(0, Math.PI / 2 + 0.01))).toHaveLength(2);
    for (let index = 1; index < cubics.length; index++) {
      expect(cubics[index].from).toBe(cubics[index - 1].to);
    }
    expect(cubics[0].from.x).toBeCloseTo(200, 9);
    expect(cubics[3].to.x).toBeCloseTo(200, 9);
    expect(cubics[3].to.y).toBeCloseTo(0, 9);
  });

  it("leans a whole circle without throwing its handles off the canvas", () => {
    const stroke: QuillStroke = {
      spine: { segments: [arc(0, Math.PI * 2)], closed: true },
      width: [{ at: 0, width: 40 }],
      nib: [{ at: 0, contrast: 0, angle: 0 }],
      start: { kind: "butt" },
      end: { kind: "butt" },
    };
    const leaned = restyleStroke(stroke, { ...PLAIN_HAND, slant: 12 });
    expect(leaned.spine.segments.length).toBe(4);
    for (const segment of leaned.spine.segments) {
      expect(segment.kind).toBe("cubic");
      if (segment.kind !== "cubic") continue;
      for (const point of [segment.from, segment.c1, segment.c2, segment.to]) {
        expect(Math.hypot(point.x, point.y)).toBeLessThan(300);
      }
    }
  });
});
