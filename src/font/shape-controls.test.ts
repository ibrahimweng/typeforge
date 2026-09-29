/**
 * The width and corner radius controls, on shapes whose right answer is known.
 *
 * Width used to scale the letter sideways and nothing else, so a stem got
 * thinner with the letter while a bar across it kept its thickness: condensed,
 * every letter's stems were lighter than its bars. The corner radius rounded a
 * corner only between two straight runs, which left the corners of a serif H
 * and every corner of an e as sharp as they were, and rounded inside corners
 * as far as outside ones, which grew webs under a crossbar.
 */

import { describe, expect, it } from "vitest";

import { contourArea, contoursBounds, flattenContour } from "./geometry";
import { blankGlyph } from "./library";
import { contoursIntersect } from "./outline";
import { resolveAdvanceWidth, resolveGlyphContours } from "./transform";
import {
  drawn,
  GEIST_TCARON,
  gapBetween,
  LORA_BOLD_HBAR,
  loopsAnywhere,
} from "../../test/outlines";
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

/** An H: two stems a hundred wide and a bar sixty thick, wound clockwise. */
const H = polygon([
  [100, 0],
  [100, 700],
  [200, 700],
  [200, 380],
  [400, 380],
  [400, 700],
  [500, 700],
  [500, 0],
  [400, 0],
  [400, 320],
  [200, 320],
  [200, 0],
]);

function font(contours: Contour[]): { typeface: Typeface; glyph: Glyph } {
  const typeface = emptyTypeface();
  // An I to measure the stem from, a hundred wide like the H's.
  const I = {
    ...blankGlyph("I", [73]),
    contours: [
      polygon([
        [100, 0],
        [100, 700],
        [200, 700],
        [200, 0],
      ]),
    ],
    params: {},
  };
  const glyph = { ...blankGlyph("H", [72]), advanceWidth: 600, contours, params: {} };
  typeface.glyphs = [I, glyph];
  typeface.glyphIndex = new Map([
    ["I", 0],
    ["H", 1],
  ]);
  return { typeface, glyph };
}

function at(typeface: Typeface, glyph: Glyph, params: Partial<GlyphParams>): Contour[] {
  typeface.params = { ...DEFAULT_PARAMS, ...params };
  return resolveGlyphContours(glyph, typeface);
}

/** How wide the ink is at a height, left to right, as the runs it crosses. */
function runsAt(contours: Contour[], y: number): number[] {
  const xs: number[] = [];
  for (const contour of contours) {
    const nodes = contour.nodes;
    nodes.forEach((node, index) => {
      const next = nodes[(index + 1) % nodes.length];
      const [a, b] = [node.point, next.point];
      if ((a.y - y) * (b.y - y) < 0) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    });
  }
  xs.sort((p, q) => p - q);
  const runs: number[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) runs.push(xs[i + 1] - xs[i]);
  return runs;
}

/** An ellipse as four smooth cubics, anticlockwise unless asked. */
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

describe("width", () => {
  it("keeps a condensed letter's stems as thick as they were", () => {
    const { typeface, glyph } = font([H]);
    const narrow = at(typeface, glyph, { width: 0.7 });
    for (const run of runsAt(narrow, 150)) expect(run).toBeCloseTo(100, 0);
    // And the bar across them keeps its thickness too.
    const bar = contoursBounds(narrow);
    expect(bar.yMax - bar.yMin).toBeCloseTo(700, 6);
  });

  it("keeps a heavy letter's counter open when it is condensed", () => {
    /*
     * At the heaviest weight and seven tenths of the width, Lora's e is
     * narrower than two of its stems. Putting the stems back whole closed its
     * eye and the bowl of its a to a speck; the counter keeps most of the room
     * it had instead, and the stems give.
     */
    const outer = ellipse(300, 300, 220, 300);
    const inner = ellipse(300, 300, 100, 190, true);
    const { typeface, glyph } = font([outer, inner]);
    const heavy = at(typeface, glyph, { weight: 60 });
    const both = at(typeface, glyph, { weight: 60, width: 0.7 });
    expect(both).toHaveLength(2);
    expect(both.map((c) => c.nodes.length)).toEqual([4, 4]);
    expect(contoursIntersect(both)).toBe(false);
    const hole = (contours: Contour[]) =>
      Math.min(...contours.map((c) => Math.abs(contourArea(c))));
    // Condensed, the counter has seven tenths of the room it had; it keeps
    // most of that, rather than being closed by the stems it is given back.
    expect(hole(both)).toBeGreaterThan(hole(heavy) * 0.7 * 0.7);
    // And the stems still come back heavier than the scaling alone left them.
    const wall = (contours: Contour[]) => {
      const [a, b] = contours.map((c) => contoursBounds([c]));
      return Math.abs(b.xMin - a.xMin);
    };
    expect(wall(both)).toBeGreaterThan(wall(heavy) * 0.7 + 5);
  });

  it("keeps a widened letter's stems from turning into slabs", () => {
    const { typeface, glyph } = font([H]);
    for (const run of runsAt(at(typeface, glyph, { width: 1.4 }), 150)) {
      expect(run).toBeCloseTo(100, 0);
    }
  });

  it("makes room for the stroke it puts back", () => {
    const { typeface, glyph } = font([H]);
    typeface.params = { ...DEFAULT_PARAMS, width: 0.7 };
    const advance = resolveAdvanceWidth(glyph, typeface);
    const ink = contoursBounds(at(typeface, glyph, { width: 0.7 }));
    // The same white either side as the scaled letter had.
    expect(ink.xMin).toBeCloseTo(100 * 0.7, 0);
    expect(advance - ink.xMax).toBeCloseTo((600 - 500) * 0.7, 0);
  });
});

describe("corner radius", () => {
  it("rounds a corner where a curve meets a straight run", () => {
    // A stem whose top leaves in a curve: the corner a bracket makes.
    const bracket: Contour = {
      closed: true,
      nodes: [
        corner(100, 0),
        {
          point: { x: 100, y: 600 },
          handleIn: null,
          handleOut: { x: 100, y: 660 },
          type: "corner",
        },
        {
          point: { x: 160, y: 700 },
          handleIn: { x: 130, y: 670 },
          handleOut: null,
          type: "corner",
        },
        corner(200, 700),
        corner(200, 0),
      ],
    };
    const { typeface, glyph } = font([bracket]);
    const rounded = at(typeface, glyph, { cornerRadius: 20 })[0];
    // The corner at (160, 700), where the bracket's curve arrives at the top
    // edge, is cut back and rounded like any other.
    const sharp = rounded.nodes.filter(
      (node) => Math.hypot(node.point.x - 160, node.point.y - 700) < 1e-6,
    );
    expect(sharp).toHaveLength(0);
    expect(rounded.nodes.length).toBeGreaterThan(bracket.nodes.length);
  });

  it("softens an inside corner less than it rounds an outside one", () => {
    const { typeface, glyph } = font([H]);
    const rounded = at(typeface, glyph, { cornerRadius: 40 })[0];
    // Outside: the top of the left stem, cut back the whole radius.
    expect(rounded.nodes.some((n) => n.point.x === 100 && Math.abs(n.point.y - 660) < 1e-6)).toBe(
      true,
    );
    // Inside: where the bar meets that stem, cut back by far less.
    const inside = rounded.nodes.filter(
      (n) => Math.abs(n.point.x - 200) < 1e-6 && n.point.y > 380 && n.point.y < 400,
    );
    expect(inside.length).toBeGreaterThan(0);
    for (const node of inside) expect(node.point.y - 380).toBeLessThan(20);
  });

  it("never hands back an outline that crosses itself", () => {
    const { typeface, glyph } = font([H]);
    for (const radius of [10, 60, 150]) {
      for (const weight of [0, 60]) {
        for (const contour of at(typeface, glyph, { cornerRadius: radius, weight })) {
          expect(contoursIntersect([contour])).toBe(false);
        }
      }
    }
  });
});

describe("a rounded elbow", () => {
  it("keeps the stroke as thick round the corner as along it", () => {
    // An L forty thick, rounded by a hundred and fifty. The outside of the
    // elbow went round in a wide arc while the inside was only eased, and
    // the corner came out a crescent far heavier than the stroke.
    const L = polygon([
      [0, 0],
      [600, 0],
      [600, 40],
      [40, 40],
      [40, 800],
      [0, 800],
    ]);
    const { typeface, glyph } = font([L]);
    const [rounded] = at(typeface, glyph, { cornerRadius: 150 });
    const centre = { x: 150, y: 150 };
    const distances: number[] = [];
    for (const point of flattenContour(rounded, 64)) {
      const angle = Math.atan2(point.y - centre.y, point.x - centre.x);
      if (Math.abs(angle + (3 * Math.PI) / 4) < 0.08)
        distances.push(Math.hypot(point.x - centre.x, point.y - centre.y));
    }
    expect(distances.length).toBeGreaterThan(1);
    const thickness = Math.max(...distances) - Math.min(...distances);
    expect(thickness).toBeGreaterThan(30);
    expect(thickness).toBeLessThan(50);
  });
});

describe("crossbar", () => {
  /*
   * Regression: lowering the bar of Geist's 4 runs its diagonal on down to
   * meet it, and the corner came out sixty units into the side bearing,
   * where the next letter is.
   */
  it("spaces a letter by the ink a moved bar puts beside it", () => {
    const four = [
      polygon([
        [477, 0],
        [391, 0],
        [391, 154],
        [30, 154],
        [30, 232],
        [385, 710],
        [477, 710],
        [477, 238],
        [565, 238],
        [565, 154],
        [477, 154],
      ]),
      polygon([
        [391, 578],
        [134, 238],
        [391, 238],
      ]),
    ];
    const { typeface, glyph } = font(four);
    glyph.advanceWidth = 615;
    const lowered = contoursBounds(at(typeface, glyph, { crossbar: -80 }));
    const advance = resolveAdvanceWidth(glyph, typeface);
    expect(lowered.xMin).toBeCloseTo(30, 0);
    expect(advance - lowered.xMax).toBeCloseTo(50, 0);
  });

  /*
   * Regression: a raised bar stopped only where it would cross something, so
   * the bar of Geist's t-caron went up until it touched the caron beside the
   * top of the stem, twenty-two units above it as drawn.
   */
  /*
   * Regression: the bar and shoulder moves were judged by a crossing check
   * that samples a curve in six chords, and lowering the arch of Lora
   * Bold's h-bar, drawn in overlapping pieces, ran the join of the arch
   * through the stem without it seeing.
   */
  it("lowers the arch of an h-bar drawn in pieces without running it through the stem", () => {
    const { typeface, glyph } = font(drawn(LORA_BOLD_HBAR));
    glyph.unicodes = [0x127];
    glyph.advanceWidth = 621;
    for (const contour of at(typeface, glyph, { shoulder: -80 }))
      expect(loopsAnywhere(contour)).toBe(false);
  });

  it("stops a raised bar short of a separate piece of ink above it", () => {
    const { typeface, glyph } = font(drawn(GEIST_TCARON));
    glyph.advanceWidth = 399;
    const [caron, t] = at(typeface, glyph, { crossbar: 80 });
    expect(gapBetween(caron, t)).toBeGreaterThan(10);
    // And the bar still went up as far as that leaves it.
    const bar = Math.max(
      ...t.nodes.filter((node) => node.point.x > 300).map((node) => node.point.y),
    );
    expect(bar).toBeGreaterThan(535);
  });
});
