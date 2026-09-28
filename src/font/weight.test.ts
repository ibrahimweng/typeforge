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
import { contourSegments, contoursBounds, cubicAt, flattenContour } from "./geometry";
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
    // Wider by twice the weight: the corners went out on the mitre rather
    // than seventy per cent of the way along it.
    expect(bounds.xMax - bounds.xMin).toBeCloseTo(160, 6);
    // And still standing on the baseline and reaching the cap height, as a
    // bold is drawn, rather than grown past both by the weight.
    expect(bounds.yMin).toBeCloseTo(0, 6);
    expect(bounds.yMax).toBeCloseTo(700, 6);
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
    // The inside corner, moved over with the letter and back up onto the
    // baseline with it: 125 + 25, 125 + 25.
    expect(shape.nodes[3].point.x).toBeCloseTo(150, 6);
    expect(shape.nodes[3].point.y).toBeCloseTo(150, 6);
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

  it("keeps the dot of an i apart from its stem", () => {
    // A stem to the x-height and a dot a stem's width above it, both wound
    // clockwise; the heaviest weight is more than the gap between them.
    const stem = polygon([
      [100, 0],
      [100, 500],
      [200, 500],
      [200, 0],
    ]);
    const dot = polygon([
      [100, 600],
      [100, 700],
      [200, 700],
      [200, 600],
    ]);
    const { typeface, glyph } = letter([stem, dot]);
    const [heavyStem, heavyDot] = at(typeface, glyph, { weight: 60 });
    expect(heavyStem.nodes).toHaveLength(4);
    expect(heavyDot.nodes).toHaveLength(4);
    const top = Math.max(...heavyStem.nodes.map((node) => node.point.y));
    const bottom = Math.min(...heavyDot.nodes.map((node) => node.point.y));
    // Some of the hundred units of paper between them is still there, less
    // what bringing the letter back to its height takes off everything...
    expect(bottom - top).toBeGreaterThan(100 * 0.35);
    // ...and both still grew, sideways by the whole weight.
    const wide = (contour: Contour) =>
      Math.max(...contour.nodes.map((node) => node.point.x)) -
      Math.min(...contour.nodes.map((node) => node.point.x));
    expect(wide(heavyStem)).toBeCloseTo(220, 0);
    expect(wide(heavyDot)).toBeCloseTo(220, 0);
  });

  it("keeps the dot of an i full when the letter is made lighter", () => {
    const stem = polygon([
      [100, 0],
      [100, 500],
      [200, 500],
      [200, 0],
    ]);
    const dot = polygon([
      [100, 600],
      [100, 700],
      [200, 700],
      [200, 600],
    ]);
    const { typeface, glyph } = letter([stem, dot]);
    const [lightStem, lightDot] = at(typeface, glyph, { weight: -40 });
    const wide = (contour: Contour) =>
      Math.max(...contour.nodes.map((node) => node.point.x)) -
      Math.min(...contour.nodes.map((node) => node.point.x));
    // The stem thins as far as it may; the dot, drawn as wide as the stem,
    // gives up only part of that, as the dot of a light cut does.
    expect(wide(lightStem)).toBeLessThan(40);
    expect(wide(lightDot)).toBeGreaterThan(wide(lightStem) * 1.5);
    expect(wide(lightDot)).toBeLessThan(100);
  });

  it("thins a ball less than a stroke, and a ring as a stroke", () => {
    // A solid disc, too big to be a dot, is a ball: a light cut keeps it
    // fuller than its strokes. The wall of a ring is a stroke, and thins as
    // far as any other.
    const disc = letter([circle(300, 300, 150, true)]);
    const [lightDisc] = at(disc.typeface, disc.glyph, { weight: -40 });
    const ring = letter([circle(300, 300, 150, true), circle(300, 300, 100)]);
    const [outside, inside] = at(ring.typeface, ring.glyph, { weight: -40 });
    const size = (contour: Contour) =>
      contoursBounds([contour]).xMax - contoursBounds([contour]).xMin;
    // Plain offsetting would take the disc to 220.
    expect(size(lightDisc)).toBeGreaterThan(250);
    expect(contoursIntersect([lightDisc])).toBe(false);
    // The ring's wall of fifty goes below twenty, as a stem's would.
    expect((size(outside) - size(inside)) / 2).toBeLessThan(20);
  });

  it("keeps the side bearings of a letter whose feet run out on the mitre", () => {
    // A v: two diagonals cut off level at the top, meeting at a flat foot.
    const v = polygon([
      [50, 500],
      [150, 500],
      [300, 100],
      [450, 500],
      [550, 500],
      [350, 0],
      [250, 0],
    ]);
    const { typeface, glyph } = letter([v], 600);
    const heavy = at(typeface, glyph, { weight: 60 });
    const box = contoursBounds(heavy);
    const advance = resolveAdvanceWidth(glyph, typeface);
    // Fifty either side, as drawn: the tips of the arms went out by more than
    // the weight, and the advance grew by what they took.
    expect(box.xMin).toBeCloseTo(50, 0);
    expect(advance - box.xMax).toBeCloseTo(50, 0);
  });

  it("keeps a dotless j to its x-height and its tail where it was drawn", () => {
    // A stem from the x-height down past the baseline into a flat tail, with
    // no point on the baseline. The dotless j has no capital, was taken for
    // one, and at the heaviest weight rose twice the weight past its x-height.
    const { typeface, glyph } = letter(
      [
        polygon([
          [0, -150],
          [0, -80],
          [100, -80],
          [100, 500],
          [180, 500],
          [180, -150],
        ]),
      ],
      260,
    );
    glyph.unicodes = [0x237];
    const heavy = contoursBounds(at(typeface, glyph, { weight: 60 }));
    expect(heavy.yMax).toBeCloseTo(500, 0);
    expect(heavy.yMin).toBeCloseTo(-150, 0);
  });

  it("keeps those side bearings when the heavy letter is also condensed", () => {
    // Putting back the strokes the condensing took runs the arms out on the
    // mitre again, and the advance grew by the give alone: Geist's v and w
    // at the heaviest, condensed to 0.6, ran into the letters beside them.
    const v = polygon([
      [50, 500],
      [150, 500],
      [300, 100],
      [450, 500],
      [550, 500],
      [350, 0],
      [250, 0],
    ]);
    const { typeface, glyph } = letter([v], 600);
    const narrow = at(typeface, glyph, { weight: 60, width: 0.6 });
    const box = contoursBounds(narrow);
    const advance = resolveAdvanceWidth(glyph, typeface);
    // The fifty either side, condensed with the letter.
    expect(box.xMin).toBeCloseTo(30, 0);
    expect(advance - box.xMax).toBeCloseTo(30, 0);
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

/** An ellipse of four cubics, anticlockwise unless asked otherwise. */
function ellipse(cx: number, cy: number, rx: number, ry: number, clockwise = false): Contour {
  const kx = rx * 0.5523;
  const ky = ry * 0.5523;
  const at = (x: number, y: number, inX: number, inY: number, outX: number, outY: number) => ({
    point: { x: cx + x, y: cy + y },
    handleIn: { x: cx + inX, y: cy + inY },
    handleOut: { x: cx + outX, y: cy + outY },
    type: "smooth" as const,
  });
  const nodes = [
    at(rx, 0, rx, -ky, rx, ky),
    at(0, ry, kx, ry, -kx, ry),
    at(-rx, 0, -rx, ky, -rx, -ky),
    at(0, -ry, -kx, -ry, kx, -ry),
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

/**
 * A serif I: a stem a hundred wide, and serifs thirty thick reaching seventy
 * either side of it, joined to the stem by brackets of radius thirty.
 */
function serifI(): Contour {
  const node = (
    x: number,
    y: number,
    handleIn: [number, number] | null = null,
    handleOut: [number, number] | null = null,
  ): GlyphNode => ({
    point: { x, y },
    handleIn: handleIn && { x: handleIn[0], y: handleIn[1] },
    handleOut: handleOut && { x: handleOut[0], y: handleOut[1] },
    type: handleIn || handleOut ? "smooth" : "corner",
  });
  return {
    closed: true,
    nodes: [
      node(130, 0),
      node(370, 0),
      node(370, 30),
      node(330, 30, null, [313, 30]),
      node(300, 60, [300, 47]),
      node(300, 640, null, [300, 653]),
      node(330, 670, [313, 670]),
      node(370, 670),
      node(370, 700),
      node(130, 700),
      node(130, 670),
      node(170, 670, null, [187, 670]),
      node(200, 640, [200, 653]),
      node(200, 60, null, [200, 47]),
      node(170, 30, [187, 30]),
      node(130, 30),
    ],
  };
}

/** Where a line crosses the outlines, in order along it. */
function crossings(contours: Contour[], at: number, vertical: boolean): number[] {
  const out: number[] = [];
  for (const contour of contours) {
    const points = flattenContour(contour, 64);
    points.forEach((a, index) => {
      const b = points[(index + 1) % points.length];
      const [pa, pb] = vertical ? [a.x, b.x] : [a.y, b.y];
      if ((pa - at) * (pb - at) >= 0) return;
      const f = (at - pa) / (pb - pa);
      out.push(vertical ? a.y + (b.y - a.y) * f : a.x + (b.x - a.x) * f);
    });
  }
  return out.sort((p, q) => p - q);
}

describe("a lighter or bolder cut", () => {
  /*
   * What the slider made of a real serif face at its ends was not a lighter
   * or bolder cut of it. Every point moved by the weight until it ran out of
   * room, so a stem ninety units wide lost eighty of them while its hairlines,
   * stopped at a floor, lost almost nothing, and where the two met the outline
   * tore: serif feet came away in drips, stems bowed, bowls went polygonal.
   * A light cut thins a stroke in proportion to it -- never below a third of
   * what it was -- and keeps straight things straight and round things round.
   */
  it("thins a thick stroke by more than a hairline, and neither to nothing", () => {
    // An o with sides ninety units thick and a top and bottom thirty thick.
    const { typeface, glyph } = letter([
      ellipse(300, 300, 250, 250, true),
      ellipse(300, 300, 160, 220),
    ]);
    const light = at(typeface, glyph, { weight: -40 });
    const middle = 300 - 40;
    const across = crossings(light, 301, false);
    const down = crossings(light, middle + 1, true);
    expect(across).toHaveLength(4);
    expect(down).toHaveLength(4);
    const side = across[1] - across[0];
    const top = down[3] - down[2];
    // Both got lighter...
    expect(side).toBeLessThan(90 - 40);
    expect(top).toBeLessThan(30);
    // ...and neither went below a third of itself.
    expect(side).toBeGreaterThanOrEqual(90 * 0.3);
    expect(top).toBeGreaterThanOrEqual(30 * 0.3);
  });

  it("keeps a round letter round, lighter and bolder", () => {
    const { typeface, glyph } = letter([
      ellipse(300, 300, 250, 250, true),
      ellipse(300, 300, 160, 220),
    ]);
    for (const weight of [-40, -20, 30, 60]) {
      for (const contour of at(typeface, glyph, { weight })) {
        // Every contour of an o turns one way all the way round: a dent or a
        // flat facet between two points is a turn the other way, or none.
        const points = flattenContour(contour, 48);
        let turning = 0;
        points.forEach((point, index) => {
          const next = points[(index + 1) % points.length];
          const after = points[(index + 2) % points.length];
          const turn =
            (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
          const size =
            Math.hypot(next.x - point.x, next.y - point.y) *
            Math.hypot(after.x - next.x, after.y - next.y);
          const angle = size > 0 ? turn / size : 0;
          if (turning === 0 && Math.abs(angle) > 1e-3) turning = Math.sign(angle);
          expect(angle * turning, `weight ${weight}`).toBeGreaterThan(-1e-3);
        });
      }
    }
  });

  it("keeps a serif letter's stem straight and upright, lighter and bolder", () => {
    const { typeface, glyph } = letter([serifI()]);
    for (const weight of [-40, -20, 30, 60]) {
      const [shape] = at(typeface, glyph, { weight });
      expect(shape.nodes).toHaveLength(16);
      expect(contoursIntersect([shape])).toBe(false);
      // The stem's two sides are the segments from point 4 to 5 and 12 to 13.
      for (const [a, b] of [
        [4, 5],
        [12, 13],
      ]) {
        const segment = contourSegments(shape)[a];
        expect(segment.kind, `weight ${weight}`).toBe("line");
        expect(shape.nodes[a].point.x).toBeCloseTo(shape.nodes[b].point.x, 3);
      }
      const stem = shape.nodes[4].point.x - shape.nodes[12].point.x;
      if (weight < 0) {
        expect(stem).toBeLessThan(100);
        expect(stem).toBeGreaterThanOrEqual(100 / 3 - 0.5);
      } else expect(stem).toBeCloseTo(100 + 2 * weight, 0);
    }
  });

  it("keeps a serif letter on its baseline and at its height, lighter and bolder", () => {
    // The serifs are thirty thick: made lighter they keep a third of
    // themselves and move less than the weight, which the letter's return to
    // its height has to follow rather than assume.
    const { typeface, glyph } = letter([serifI()]);
    for (const weight of [-40, 60]) {
      const box = contoursBounds(at(typeface, glyph, { weight }));
      expect(box.yMin, `weight ${weight}`).toBeCloseTo(0, 0);
      expect(box.yMax, `weight ${weight}`).toBeCloseTo(700, 0);
    }
  });

  it("rounds the end of an aperture the weight swallows, rather than leaving a step", () => {
    // A slot into the side of a letter whose end is three short curves --
    // shorter than the weight, as at the inner end of the aperture of a.
    const node = (
      x: number,
      y: number,
      handleIn: [number, number] | null = null,
      handleOut: [number, number] | null = null,
    ): GlyphNode => ({
      point: { x, y },
      handleIn: handleIn && { x: handleIn[0], y: handleIn[1] },
      handleOut: handleOut && { x: handleOut[0], y: handleOut[1] },
      type: handleIn || handleOut ? "smooth" : "corner",
    });
    const slot: Contour = {
      closed: true,
      nodes: [
        node(0, 0),
        node(0, 600),
        node(600, 600),
        node(600, 330, null, [450, 330]),
        node(320, 322, [360, 326], [300, 320]),
        node(292, 305, [296, 316], [290, 298]),
        node(300, 286, [292, 290], [310, 282]),
        node(330, 280, [318, 280], [450, 280]),
        node(600, 270, [450, 270], null),
        node(600, 0),
      ],
    };
    const { typeface, glyph } = letter([slot]);
    const [heavy] = at(typeface, glyph, { weight: 40 });
    expect(heavy.nodes).toHaveLength(10);
    expect(contoursIntersect([heavy])).toBe(false);
    // The points of the end are spread round it, none left on another...
    for (let index = 3; index <= 8; index++) {
      const here = heavy.nodes[index].point;
      const next = heavy.nodes[index + 1].point;
      expect(Math.hypot(next.x - here.x, next.y - here.y), `after ${index}`).toBeGreaterThan(2);
    }
    // ...and the curves through them meet smoothly.
    for (let index = 4; index <= 7; index++) {
      const { point, handleIn, handleOut } = heavy.nodes[index];
      const a = { x: point.x - handleIn!.x, y: point.y - handleIn!.y };
      const b = { x: handleOut!.x - point.x, y: handleOut!.y - point.y };
      const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
      expect(cos, `at ${index}`).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
    }
  });

  it("keeps a thin bowl at its overshoot beside a stem on the same baseline", () => {
    // A b's parts: a stem a hundred thick, and a bowl forty thick that dips
    // twelve below the baseline. Made lighter the stem's foot rises by the
    // weight, the bowl's thin bottom by a third of itself.
    const stem = polygon([
      [100, 0],
      [100, 700],
      [200, 700],
      [200, 0],
    ]);
    const { typeface, glyph } = letter([stem, circle(360, 250, 262, true), circle(360, 250, 222)]);
    const [, bowl] = at(typeface, glyph, { weight: -40 });
    expect(contoursBounds([bowl]).yMin).toBeCloseTo(-12, -0.5);
    expect(contoursBounds([at(typeface, glyph, { weight: -40 })[0]]).yMin).toBeCloseTo(0, 0);
  });

  it("thins a serif without tearing it", () => {
    const { typeface, glyph } = letter([serifI()]);
    const [shape] = at(typeface, glyph, { weight: -40 });
    // Down through each serif's overhang, top and bottom, beside the stem --
    // which after the letter has moved over by the weight is here.
    for (const x of [140, 280]) {
      const runs = crossings([shape], x, true);
      expect(runs).toHaveLength(4);
      for (const [low, high] of [
        [runs[0], runs[1]],
        [runs[2], runs[3]],
      ]) {
        expect(high - low).toBeLessThan(30);
        expect(high - low).toBeGreaterThanOrEqual(30 / 3 - 0.5);
      }
    }
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

describe("an even colour across the alphabet", () => {
  /*
   * Ink gained or lost per unit of outline: a stroke moved square by the
   * weight gains the weight times its length, whatever way it runs. Diagonal
   * letters used to be held still -- the notch between two strokes of a W
   * read as an opening about to close, and the corner of a V as a mitre too
   * long -- so a bolder W, M, N or z kept the weight it was drawn at while the
   * H beside it went to Black, and a lighter one stayed Regular in a Thin line.
   */
  async function sample(): Promise<Typeface> {
    const bytes = new Uint8Array(readFileSync("src/assets/typeforge-sample.ttf"));
    return (await importFont(bytes, "sample.ttf")).typeface;
  }
  const ink = (contours: Contour[]) =>
    contours.reduce((sum, contour) => {
      const points = flattenContour(contour, 16);
      let area = 0;
      points.forEach((point, k) => {
        const next = points[(k + 1) % points.length];
        area += point.x * next.y - next.x * point.y;
      });
      return sum + area / 2;
    }, 0);
  const perimeter = (contours: Contour[]) =>
    contours.reduce((sum, contour) => {
      const points = flattenContour(contour, 16);
      return (
        sum +
        points.reduce(
          (length, point, k) =>
            length +
            Math.hypot(
              points[(k + 1) % points.length].x - point.x,
              points[(k + 1) % points.length].y - point.y,
            ),
          0,
        )
      );
    }, 0);
  const gained = (typeface: Typeface, char: string, weight: number) => {
    const glyph = typeface.glyphs.find((one) => one.unicodes.includes(char.codePointAt(0) ?? 0));
    if (!glyph) throw new Error(char);
    const before = resolveGlyphContours(glyph, typeface);
    const after = resolveGlyphContours(
      { ...glyph, params: { weight: weight * typeface.unitsPerEm } },
      typeface,
    );
    return Math.abs(ink(after) - ink(before)) / perimeter(before);
  };

  it("makes the diagonal letters as much bolder as the straight ones", async () => {
    const typeface = await sample();
    const reference = gained(typeface, "H", 0.06);
    for (const char of "MNWwzvkA") {
      const ratio = gained(typeface, char, 0.06) / reference;
      expect(ratio, char).toBeGreaterThan(0.8);
    }
  });

  it("makes the diagonal letters as much lighter as the straight ones", async () => {
    const typeface = await sample();
    const reference = gained(typeface, "H", -0.04);
    for (const char of "MNWvxkK") {
      const ratio = gained(typeface, char, -0.04) / reference;
      expect(ratio, char).toBeGreaterThan(0.8);
      expect(ratio, char).toBeLessThan(1.25);
    }
  });
});
