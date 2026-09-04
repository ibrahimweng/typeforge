import { describe, expect, it } from "vitest";

import { inkSpans, measureGlyph } from "./measure";
import type { Contour, Vec2 } from "./types";

/** A closed polygon with straight sides, as a contour. */
function polygon(points: Vec2[]): Contour {
  return {
    closed: true,
    nodes: points.map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" })),
  };
}

function rect(x: number, y: number, width: number, height: number): Contour {
  return polygon([
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ]);
}

describe("inkSpans", () => {
  it("measures a bar as one run the width of the bar", () => {
    const spans = inkSpans([rect(100, 0, 200, 1000)], 500);
    expect(spans).toHaveLength(1);
    expect(spans[0].width).toBeCloseTo(200, 6);
  });

  it("separates two bars and leaves the gap between them", () => {
    const spans = inkSpans([rect(0, 0, 100, 1000), rect(400, 0, 100, 1000)], 500);
    expect(spans).toHaveLength(2);
    expect(spans[0].width).toBeCloseTo(100, 6);
    expect(spans[1].start - spans[0].end).toBeCloseTo(300, 6);
  });

  it("finds nothing above the top of the shape", () => {
    expect(inkSpans([rect(0, 0, 100, 500)], 900)).toHaveLength(0);
  });

  it("crosses a curve where the curve actually is", () => {
    // A circle of radius 500 centred at (500, 500), as four cubic quarters.
    const k = 0.5522847498 * 500;
    const circle: Contour = {
      closed: true,
      nodes: [
        {
          point: { x: 0, y: 500 },
          handleIn: { x: 0, y: 500 - k },
          handleOut: { x: 0, y: 500 + k },
          type: "smooth",
        },
        {
          point: { x: 500, y: 1000 },
          handleIn: { x: 500 - k, y: 1000 },
          handleOut: { x: 500 + k, y: 1000 },
          type: "smooth",
        },
        {
          point: { x: 1000, y: 500 },
          handleIn: { x: 1000, y: 500 + k },
          handleOut: { x: 1000, y: 500 - k },
          type: "smooth",
        },
        {
          point: { x: 500, y: 0 },
          handleIn: { x: 500 + k, y: 0 },
          handleOut: { x: 500 - k, y: 0 },
          type: "smooth",
        },
      ],
    };
    // Across the middle the circle is its full diameter wide.
    const spans = inkSpans([circle], 500);
    expect(spans).toHaveLength(1);
    expect(spans[0].width).toBeCloseTo(1000, 3);
  });
});

describe("measureGlyph", () => {
  it("reads the stem width off a single upright", () => {
    const measured = measureGlyph([rect(100, 0, 180, 1400)], 500);
    expect(measured?.stemWidth).toBeCloseTo(180, 6);
  });

  it("reads the counter between two uprights", () => {
    const glyph = [rect(100, 0, 180, 1400), rect(600, 0, 180, 1400)];
    const measured = measureGlyph(glyph, 900);
    expect(measured?.stemWidth).toBeCloseTo(180, 6);
    expect(measured?.counterWidth).toBeCloseTo(320, 6);
  });

  /**
   * The bug that made a fan of rays necessary.
   *
   * An H has its crossbar at exactly the height a single mid-height ray would
   * use, so that ray reads left stem, bar and right stem as one continuous run.
   * Measured that way a real H reported a stem of 1138 units where the truth is
   * about 200 -- wrong, but plausible enough to go unnoticed.
   */
  it("is not fooled by a crossbar sitting where the ray would fall", () => {
    const h = [
      rect(100, 0, 200, 1400),
      rect(700, 0, 200, 1400),
      rect(300, 600, 400, 200), // the bar, spanning the gap at mid height
    ];
    const measured = measureGlyph(h, 1000);
    expect(measured?.stemWidth).toBeCloseTo(200, 6);
    expect(measured?.stemWidth).toBeLessThan(400);
  });

  it("reports the ink extent rather than the nominal metrics", () => {
    const measured = measureGlyph([rect(120, -30, 200, 1200)], 600);
    expect(measured?.inkBottom).toBeCloseTo(-30, 6);
    expect(measured?.inkTop).toBeCloseTo(1170, 6);
    expect(measured?.leftSidebearing).toBeCloseTo(120, 6);
    expect(measured?.rightSidebearing).toBeCloseTo(280, 6);
  });

  it("returns nothing for a glyph with no outline, such as a space", () => {
    expect(measureGlyph([], 600)).toBeNull();
  });
});
