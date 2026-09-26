/**
 * The weight control, on shapes small enough to know the right answer for.
 *
 * What went wrong with it was evenness. Corners were pushed along the average
 * of their two normals, which moves each side of a right angle by only seventy
 * per cent of the weight, so every letter built of straight runs gained less
 * than every round one. Points that saw little room ahead of them stopped dead
 * while their neighbours moved, which leaned straight edges over and tore the
 * outline at every junction. Handles were carried along with their points, so
 * the middles of curves moved by the wrong amount. And nothing gave the letters
 * room for the ink they gained, so a bold setting ran them into each other.
 *
 * The whole-alphabet versions of these, on real fonts, are in
 * `test/interaction.integration.test.ts`.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { exportFont } from "./export";
import { contoursBounds, cubicAt } from "./geometry";
import { importFont } from "./parse";
import { contoursIntersect } from "./outline";
import { resolveAdvanceWidth, resolveGlyphContours } from "./transform";
import { blankGlyph } from "./library";
import {
  DEFAULT_PARAMS,
  emptyTypeface,
  type Contour,
  type Glyph,
  type GlyphNode,
  type GlyphParams,
  type Typeface,
} from "./types";

const corner = (x: number, y: number): GlyphNode => ({
  point: { x, y },
  handleIn: null,
  handleOut: null,
  type: "corner",
});

const polygon = (points: Array<[number, number]>): Contour => ({
  closed: true,
  nodes: points.map(([x, y]) => corner(x, y)),
});

/** A circle of four cubics, wound one way or the other. */
function circle(cx: number, cy: number, r: number, clockwise = false): Contour {
  const k = r * 0.5523;
  const at = (x: number, y: number, inX: number, inY: number, outX: number, outY: number) => ({
    point: { x: cx + x, y: cy + y },
    handleIn: { x: cx + inX, y: cy + inY },
    handleOut: { x: cx + outX, y: cy + outY },
    type: "smooth" as const,
  });
  const nodes = [
    at(r, 0, r, -k, r, k),
    at(0, r, k, r, -k, r),
    at(-r, 0, -r, k, -r, -k),
    at(0, -r, -k, -r, k, -r),
  ];
  if (!clockwise) return { closed: true, nodes };
  return {
    closed: true,
    nodes: nodes
      .slice()
      .reverse()
      .map((node) => ({ ...node, handleIn: node.handleOut, handleOut: node.handleIn })),
  };
}

function letter(contours: Contour[], advance = 600): { typeface: Typeface; glyph: Glyph } {
  const typeface = emptyTypeface();
  // No parameters of its own, so the family's apply.
  const glyph = { ...blankGlyph("test", []), advanceWidth: advance, contours, params: {} };
  typeface.glyphs = [glyph];
  typeface.glyphIndex = new Map([["test", 0]]);
  return { typeface, glyph };
}

function at(typeface: Typeface, glyph: Glyph, params: Partial<GlyphParams>): Contour[] {
  typeface.params = { ...DEFAULT_PARAMS, ...params };
  return resolveGlyphContours(glyph, typeface);
}

describe("weight", () => {
  it("moves every side of a straight-sided letter the full weight", () => {
    // A stem, wound clockwise as TrueType winds an outside.
    const { typeface, glyph } = letter([
      polygon([
        [100, 0],
        [100, 700],
        [200, 700],
        [200, 0],
      ]),
    ]);
    const bounds = contoursBounds(at(typeface, glyph, { weight: 30 }));
    // Wider and taller by twice the weight: the corners went out on the mitre
    // rather than seventy per cent of the way along it.
    expect(bounds.xMax - bounds.xMin).toBeCloseTo(160, 6);
    expect(bounds.yMax - bounds.yMin).toBeCloseTo(760, 6);
  });

  it("gives a round letter the same weight as a straight one", () => {
    // An o: an outside wound one way and a counter the other.
    const { typeface, glyph } = letter([circle(300, 300, 250, true), circle(300, 300, 150)]);
    const [outside, counter] = at(typeface, glyph, { weight: 30 });
    // Sample the curves, not just the points: the middle of each quarter is
    // where carrying the handles along with their points went wrong.
    const radii = (contour: Contour) => {
      const out: number[] = [];
      contour.nodes.forEach((node, index) => {
        const next = contour.nodes[(index + 1) % contour.nodes.length];
        for (const t of [0, 0.25, 0.5, 0.75]) {
          const point = cubicAt(node.point, node.handleOut!, next.handleIn!, next.point, t);
          out.push(Math.hypot(point.x - 330, point.y - 300));
        }
      });
      return out;
    };
    // The letter moved over by the weight to keep its side bearing.
    // Within a fifth of a unit: four cubics are not quite a circle to begin
    // with, and are out by a fourteenth of one at this size.
    for (const radius of radii(outside)) expect(Math.abs(radius - 280)).toBeLessThan(0.2);
    for (const radius of radii(counter)) expect(Math.abs(radius - 120)).toBeLessThan(0.2);
  });

  it("fills an inside corner to where its sides meet, without a loop", () => {
    // An L. Its inside corner is where the offset outline runs over itself.
    const { typeface, glyph } = letter([
      polygon([
        [0, 0],
        [0, 600],
        [100, 600],
        [100, 100],
        [400, 100],
        [400, 0],
      ]),
    ]);
    const [shape] = at(typeface, glyph, { weight: 25 });
    expect(contoursIntersect([shape])).toBe(false);
    // The inside corner, moved over with the letter: 125 + 25, 125.
    expect(shape.nodes[3].point.x).toBeCloseTo(150, 6);
    expect(shape.nodes[3].point.y).toBeCloseTo(125, 6);
    // And the stem's edge is still upright: its two ends did not move apart.
    expect(shape.nodes[2].point.x).toBeCloseTo(shape.nodes[3].point.x, 6);
  });

  it("collapses a step shorter than the weight instead of looping round it", () => {
    // A notch ten units deep where a serif would meet its stem.
    const { typeface, glyph } = letter([
      polygon([
        [0, 0],
        [0, 600],
        [100, 600],
        [100, 110],
        [110, 110],
        [110, 100],
        [400, 100],
        [400, 0],
      ]),
    ]);
    const [shape] = at(typeface, glyph, { weight: 40 });
    // The same points came back, which a variable font needs...
    expect(shape.nodes).toHaveLength(8);
    // ...and none of them loops.
    expect(contoursIntersect([shape])).toBe(false);
  });

  it("thins without turning anything inside out", () => {
    const { typeface, glyph } = letter([circle(300, 300, 250, true), circle(300, 300, 200)]);
    const contours = at(typeface, glyph, { weight: -40 });
    for (const contour of contours) expect(contoursIntersect([contour])).toBe(false);
  });

  it("widens the letter by the ink it adds and keeps its side bearings", () => {
    const { typeface, glyph } = letter(
      [
        polygon([
          [100, 0],
          [100, 700],
          [200, 700],
          [200, 0],
        ]),
      ],
      300,
    );
    const rest = contoursBounds(at(typeface, glyph, {}));
    const heavy = contoursBounds(at(typeface, glyph, { weight: 30 }));
    expect(resolveAdvanceWidth(glyph, typeface)).toBeCloseTo(360, 6);
    // The same white on the left as before, and on the right.
    expect(heavy.xMin).toBeCloseTo(rest.xMin, 6);
    expect(360 - heavy.xMax).toBeCloseTo(300 - rest.xMax, 6);
  });
});

describe("the advance a font is written with", () => {
  it("is the one the app sets with, width and weight included", async () => {
    const bytes = new Uint8Array(readFileSync("src/assets/typeforge-sample.ttf"));
    const { typeface } = await importFont(bytes, "sample.ttf");
    typeface.params = { ...DEFAULT_PARAMS, width: 0.8, weight: 20, tracking: 10 };
    const H = typeface.glyphs.find((glyph) => glyph.unicodes.includes(72))!;
    const expected = Math.round(resolveAdvanceWidth(H, typeface));
    expect(expected).not.toBe(H.advanceWidth);

    for (const fidelity of ["rebuild", "preserve"] as const) {
      const result = await exportFont(typeface, { format: "ttf", fidelity, now: 0 });
      const { typeface: back } = await importFont(result.bytes, "back.ttf");
      const written = back.glyphs.find((glyph) => glyph.unicodes.includes(72))!;
      expect(written.advanceWidth, fidelity).toBe(expected);
    }
  });
});
