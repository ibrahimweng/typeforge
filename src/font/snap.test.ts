/**
 * That a dragged point lands where it was aiming.
 *
 * The decision every one of these turns on is that a *named* line beats the
 * grid. A whole unit is always within half a unit of anywhere, so a grid that
 * competed on distance would win every comparison and no metric line, guide or
 * neighbouring point would ever be reached -- giving a tool that snaps
 * enthusiastically to nothing in particular.
 */

import { describe, expect, it } from "vitest";

import { linesFor, snapPoint, snapValue } from "./snap";
import { emptyTypeface, type Glyph, type Typeface } from "./types";

const glyph = (name: string, points: Array<[number, number]>, width = 500): Glyph => ({
  name,
  unicodes: [],
  advanceWidth: width,
  contours: [
    {
      closed: true,
      nodes: points.map(([x, y]) => ({
        point: { x, y },
        handleIn: null,
        handleOut: null,
        type: "corner" as const,
      })),
    },
  ],
  components: [],
  anchors: [],
  params: {},
  dirty: false,
});

const font = (glyphs: Glyph[]): Typeface => {
  const typeface = emptyTypeface();
  typeface.glyphs = glyphs;
  typeface.glyphIndex = new Map(glyphs.map((one, at) => [one.name, at]));
  return typeface;
};

describe("pulling one coordinate", () => {
  const lines = [
    { at: 0, label: "baseline" },
    { at: 500, label: "x-height" },
  ];

  it("lands on a named line when one is within reach", () => {
    expect(snapValue(496, lines, 8)).toEqual({ at: 500, line: lines[1] });
  });

  it("lands on a whole unit when none is", () => {
    // The grid is the fallback and never competes.
    expect(snapValue(312.4, lines, 8)).toEqual({ at: 312, line: null });
  });

  it("takes the nearer of two lines", () => {
    const three = [...lines, { at: 490, label: "guide" }];
    expect(snapValue(492, three, 8).at).toBe(490);
    expect(snapValue(497, three, 8).at).toBe(500);
  });

  it("reaches exactly as far as it is told and no further", () => {
    expect(snapValue(492, lines, 8).at).toBe(500);
    expect(snapValue(491, lines, 8).at).toBe(491);
  });
});

describe("pulling a point", () => {
  it("snaps each axis on its own", () => {
    /*
     * A point can be on the x-height and nowhere in particular sideways, and
     * that is the ordinary case rather than the odd one -- it is what happens
     * every time somebody drags the top of a stem.
     */
    const lines = {
      x: [{ at: 100, label: "a point" }],
      y: [{ at: 500, label: "x-height" }],
    };
    const snapped = snapPoint({ x: 340.2, y: 497 }, lines, 6);
    expect(snapped.point).toEqual({ x: 340, y: 500 });
    expect(snapped.x).toBeNull();
    expect(snapped.y?.label).toBe("x-height");
  });
});

describe("what a letter offers to land on", () => {
  const typeface = font([glyph("n", [[40, 0], [120, 0], [120, 500]], 600)]);

  it("offers the lines the font is drawn between", () => {
    const lines = linesFor(typeface, typeface.glyphs[0], []);
    expect(lines.y.map((one) => one.label)).toContain("baseline");
    expect(lines.y.map((one) => one.label)).toContain("cap height");
    // And the two sides of the letter's own width, which is where its
    // sidebearings are measured from.
    expect(lines.x.filter((one) => one.at === 0 || one.at === 600)).toHaveLength(2);
  });

  it("offers the letter's own points, which is the part a grid cannot do", () => {
    /*
     * Two stems drawn the same width and two feet standing on one line are
     * most of what makes an alphabet look as though one hand drew it, and
     * neither is something a grid helps with.
     */
    const lines = linesFor(typeface, typeface.glyphs[0], []);
    expect(lines.x.map((one) => one.at)).toContain(40);
    expect(lines.x.map((one) => one.at)).toContain(120);
  });

  it("offers each place once, however many points are standing there", () => {
    // An `n` has four points on the baseline, and four lines in the same place
    // buy nothing but a comparison run four times.
    const lines = linesFor(typeface, typeface.glyphs[0], []);
    expect(lines.y.filter((one) => one.at === 0)).toHaveLength(1);
  });

  it("leaves out the points being dragged", () => {
    /*
     * A point that snapped to itself would never move at all, and one that
     * snapped to its neighbour in the same drag would collapse the two
     * together.
     */
    const lines = linesFor(typeface, typeface.glyphs[0], [], new Set(["0:0", "0:1"]));
    expect(lines.x.map((one) => one.at)).not.toContain(40);
    // The one that is not moving is still there to land on.
    expect(lines.x.map((one) => one.at)).toContain(120);
  });

  it("offers guides on the axis they were drawn on", () => {
    const lines = linesFor(typeface, typeface.glyphs[0], [
      { axis: "y", at: 320 },
      { axis: "x", at: 80 },
    ]);
    expect(lines.y.map((one) => one.at)).toContain(320);
    expect(lines.x.map((one) => one.at)).toContain(80);
    // And not on the other one, which would be a horizontal guide catching a
    // sideways drag.
    expect(lines.x.map((one) => one.at)).not.toContain(320);
  });
});
