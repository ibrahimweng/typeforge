import { describe, expect, it } from "vitest";

import { contoursBounds, inkRunsAt } from "./geometry";
import { contoursIntersect } from "./outline";
import { resolveGlyphContours } from "./transform";
import { DEFAULT_PARAMS, type Contour, type Glyph, type Typeface, type Vec2 } from "./types";

/*
 * The middle-space control, on letters simple enough to measure by hand.
 *
 * Every letter here is a rectangle with rectangular counters cut out of it, so
 * the walls are known exactly and a ruler across the middle reads them back.
 */

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

function glyph(contours: Contour[]): Glyph {
  return {
    name: "o",
    unicodes: [],
    advanceWidth: 1200,
    contours,
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

const EM = 1000;

function resolve(contours: Contour[], counterScale: number): Contour[] {
  const target = glyph(contours);
  const family = {
    glyphs: [target],
    unitsPerEm: EM,
    kerning: [],
    kernClasses: [],
    params: { ...DEFAULT_PARAMS, counterScale },
    meta: { familyName: "Test", styleName: "Regular" },
    metrics: { ascender: 800, descender: -200, lineGap: 0 },
    revision: 0,
    source: null,
  } as unknown as Typeface;
  return resolveGlyphContours(target, family);
}

/** The runs of ink a horizontal ruler at `y` crosses, as widths. */
function across(contours: Contour[], y: number): number[] {
  return inkRunsAt(contours, y).map(([from, to]) => to - from);
}

/** And a vertical ruler at `x`. */
function down(contours: Contour[], x: number): number[] {
  return inkRunsAt(contours, x, "x").map(([from, to]) => to - from);
}

/** A ring: an outside `size` square with walls `wall` thick all round. */
function ring(size: number, wall: number): Contour[] {
  return [rect(0, 0, size, size), rect(wall, wall, size - wall * 2, size - wall * 2)];
}

describe("middle space", () => {
  /**
   * Regression: a big counter opened straight through its own wall.
   *
   * The counter was scaled about its centre, so each side moved by its
   * distance from the centre whatever lay beyond it. A counter 800 across in
   * walls 100 thick moved each side 160 units at 1.4 -- out through the wall
   * and past the outside of the letter, which on Lora's o, b, B, g and 8 was a
   * white gap cut through the stroke.
   */
  it("never opens a counter through its wall", () => {
    const resolved = resolve(ring(1000, 100), 1.4);
    expect(contoursIntersect(resolved)).toBe(false);
    // Still inside the letter. Scaled plainly it came out 1120 across and
    // swallowed the outside whole, which crosses nothing and is no letter.
    const counter = contoursBounds([resolved[1]]);
    const letter = contoursBounds([resolved[0]]);
    expect(counter.xMin).toBeGreaterThan(letter.xMin + 12);
    expect(counter.xMax).toBeLessThan(letter.xMax - 12);
    // The walls went with it, and kept their weight.
    const walls = across(resolved, 500);
    expect(walls).toHaveLength(2);
    for (const wall of walls) expect(wall).toBeCloseTo(100, 0);
  });

  /**
   * Regression: how much a letter lightened depended on the size of its
   * counter rather than the weight of its strokes.
   *
   * Two rings with the same walls, one with a counter 800 across and one 300.
   * Scaling moved the big counter's sides 120 units at 1.3 and the small one's
   * 45, so the big one lost more than all of its wall and the small one less
   * than half -- which across a font is Geist's o and B going to hairlines
   * beside an e that barely changed. Held to a share of the wall, both lose
   * about the same.
   */
  it("thins the walls of big and small counters alike", () => {
    const big = across(resolve(ring(1000, 100), 1.3), 500)[0];
    const small = across(resolve(ring(500, 100), 1.3), 250)[0];
    expect(big).toBeGreaterThan(55);
    expect(small).toBeGreaterThan(55);
    expect(Math.abs(big - small)).toBeLessThan(15);
  });

  /**
   * And the other way. At 0.7 the big counter's sides came in 120 units, more
   * than doubling a wall of 100, and the round letters of a font turned bold
   * beside straight ones that had no counter to close.
   */
  /*
   * Closing a counter used to thicken every wall round it by what the counter
   * lost, and at 0.6 the letters with counters set as a bold beside those
   * without. The walls follow the counter across instead: they keep their
   * weight, and the letter narrows. Up and down there is nowhere for a wall to
   * go, and a closing counter keeps its height rather than thicken them.
   */
  it("keeps the walls of a closing counter their weight, and narrows the letter", () => {
    const resolved = resolve(ring(1000, 100), 0.7);
    const counter = contoursBounds([resolved[1]]);
    const box = contoursBounds([resolved[0]]);
    const closed = (800 - (counter.xMax - counter.xMin)) / 2;
    expect(closed).toBeGreaterThan(20);
    for (const wall of across(resolved, 500)) expect(wall).toBeCloseTo(100, 0);
    expect(box.xMax - box.xMin).toBeCloseTo(1000 - closed * 2, 0);
    expect(box.yMax - box.yMin).toBeCloseTo(1000, 6);
    expect(counter.yMax - counter.yMin).toBeCloseTo(800, 6);
  });

  /**
   * Regression: the bar between two counters vanished.
   *
   * The middle of a B, the waist of an 8. Both counters move into the bar at
   * once, and each used to be free to take all of it, so the two of them met
   * and crossed. Each now counts only its own half of a wall it shares.
   */
  it("leaves the bar between two counters standing", () => {
    const letter = [rect(0, 0, 600, 1000), rect(100, 100, 400, 360), rect(120, 540, 360, 360)];
    const resolved = resolve(letter, 1.4);
    expect(contoursIntersect(resolved)).toBe(false);
    const below = contoursBounds([resolved[1]]);
    const above = contoursBounds([resolved[2]]);
    expect(above.yMin - below.yMax).toBeGreaterThan(40);
    // Down the middle: bottom wall, the bar, top wall.
    const runs = down(resolved, 300);
    expect(runs).toHaveLength(3);
    expect(runs[1]).toBeLessThan(80);
    expect(runs[1]).toBeGreaterThan(40);
  });

  /**
   * A flat edge stays flat and square.
   *
   * The counter below sits off to one side, so its left wall is thin and its
   * right wall thick, and the two sides may open by different amounts. They
   * are moved separately and each along its own axis, so the edges stay
   * upright and level rather than leaning over from a thin corner to a thick
   * one -- which is what the straight edges of B, R and 4 did when every point
   * was given its own allowance.
   */
  it("keeps the straight edges of a counter straight", () => {
    const letter = [rect(0, 0, 800, 800), rect(60, 200, 400, 400)];
    const [, counter] = resolve(letter, 1.3);
    const xs = counter.nodes.map((node) => Math.round(node.point.x * 1000) / 1000);
    const ys = counter.nodes.map((node) => Math.round(node.point.y * 1000) / 1000);
    expect(new Set(xs).size).toBe(2);
    expect(new Set(ys).size).toBe(2);
    const box = contoursBounds([counter]);
    // The thin side gave less than the thick one.
    expect(60 - box.xMin).toBeLessThan(box.xMax - 460);
    // And the counter still opened.
    expect(box.xMax - box.xMin).toBeGreaterThan(400);
  });

  /*
   * Regression: the stem of a B leaned at 1.4. Its two bowls were followed
   * one after the other, and the first moved only the top of the stem, a
   * single straight line; halfway, it crossed the lower bowl, and the upper
   * bowl was put back as drawn while the lower one opened.
   */
  it("keeps a stem upright that two counters above each other share", () => {
    const letter = [rect(0, 0, 600, 1000), rect(100, 100, 400, 360), rect(100, 540, 300, 360)];
    const [outside, below, above] = resolve(letter, 1.4);
    const stem = outside.nodes.filter((node) => node.point.x < 300).map((node) => node.point.x);
    expect(Math.max(...stem) - Math.min(...stem)).toBeLessThan(0.5);
    const lower = contoursBounds([below]);
    const upper = contoursBounds([above]);
    expect(upper.xMin).toBeCloseTo(lower.xMin, 0);
    expect(lower.xMax - lower.xMin).toBeGreaterThan(420);
    expect(upper.xMax - upper.xMin).toBeGreaterThan(320);
  });

  /*
   * Regression: between two counters one above the other, each eased its
   * map to nothing halfway to the other, so the ink in the gap stayed where
   * it was while the ink above and below it moved: the wall there dented,
   * and the serif on the arm of Lora's &, which stands in that gap, sheared.
   */
  it("moves the wall between two stacked counters with the rest of it", () => {
    const outside = polygon([
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 500 },
      { x: 600, y: 1000 },
      { x: 0, y: 1000 },
    ]);
    const letter = [outside, rect(100, 100, 400, 300), rect(100, 600, 300, 300)];
    const [moved] = resolve(letter, 1.4);
    const right = moved.nodes.filter((node) => node.point.x > 300).map((node) => node.point);
    const ends = right.filter((point) => point.y !== 500).map((point) => point.x);
    const middle = right.find((point) => point.y === 500)!.x;
    expect(Math.min(...ends)).toBeGreaterThan(600);
    expect(middle).toBeGreaterThanOrEqual(Math.min(...ends) - 0.5);
    expect(middle).toBeLessThanOrEqual(Math.max(...ends) + 0.5);
  });

  it("moves the outside of the letter across with the counter, never up or down", () => {
    const resolved = resolve(ring(1000, 100), 1.4);
    const box = contoursBounds([resolved[0]]);
    expect(box.xMin).toBeCloseTo(0, 6);
    expect(box.xMax).toBeGreaterThan(1000 + 100);
    expect(box.yMin).toBeCloseTo(0, 6);
    expect(box.yMax).toBeCloseTo(1000, 6);
  });

  it("changes nothing on a letter without a counter", () => {
    const bar = [rect(0, 0, 200, 1000)];
    expect(resolve(bar, 1.4)[0].nodes.map((node) => node.point)).toEqual(
      bar[0].nodes.map((node) => node.point),
    );
  });
});
