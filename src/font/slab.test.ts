import { describe, expect, it } from "vitest";

import { contoursBounds } from "./geometry";
import { addSlabs, findTerminals } from "./slab";
import type { Contour, Vec2 } from "./types";

/** Wound clockwise, as a filled outer contour is in a font. */
function polygon(points: Vec2[]): Contour {
  return {
    closed: true,
    nodes: points.map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" })),
  };
}

/** An upright stem: up the left side, across the top, down the right. */
function stem(x: number, y: number, width: number, height: number): Contour {
  return polygon([
    { x, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
    { x: x + width, y },
  ]);
}

const WIDE = 10_000;

describe("findTerminals", () => {
  it("finds both ends of a stem", () => {
    const terminals = findTerminals([stem(100, 0, 200, 1000)], WIDE);
    expect(terminals).toHaveLength(2);
    const heights = terminals.map((terminal) => Math.round(terminal.centre.y)).sort((a, b) => a - b);
    expect(heights).toEqual([0, 1000]);
  });

  it("measures the end across the stroke", () => {
    const [terminal] = findTerminals([stem(100, 0, 200, 1000)], WIDE);
    expect(terminal.width).toBeCloseTo(200, 6);
  });

  it("points back into the stroke rather than out of it", () => {
    const terminals = findTerminals([stem(100, 0, 200, 1000)], WIDE);
    const foot = terminals.find((terminal) => terminal.centre.y === 0)!;
    const top = terminals.find((terminal) => terminal.centre.y === 1000)!;
    expect(foot.inward.y).toBeCloseTo(1, 6);
    expect(top.inward.y).toBeCloseTo(-1, 6);
  });

  /**
   * The distinction that makes this reliable on real letters.
   *
   * The tall inner edge of an E, between the top arm and the middle one, has
   * perpendicular neighbours pointing opposite ways exactly as a stroke end
   * does. It is told apart by which way the outline turns: a terminal bulges
   * away from the letter, a notch cuts into it. On DejaVu's E this is the
   * difference between finding three arm ends and finding four.
   */
  it("ignores a notch cut into the letter", () => {
    // A C-shape: two arms with a deep notch between them.
    const cShape = polygon([
      { x: 0, y: 0 },
      { x: 0, y: 900 },
      { x: 700, y: 900 },
      { x: 700, y: 700 },
      { x: 200, y: 700 }, // inner corner
      { x: 200, y: 200 }, // the notch edge runs down here
      { x: 700, y: 200 },
      { x: 700, y: 0 },
    ]);
    const terminals = findTerminals([cShape], WIDE);
    const widths = terminals.map((terminal) => Math.round(terminal.width));
    // The two arm ends are 200 deep; the 500-unit notch edge is not an end.
    expect(widths).not.toContain(500);
    expect(terminals.length).toBeGreaterThan(0);
  });

  it("leaves a round letter alone, having no flat end to sit on", () => {
    const k = 0.5522847498 * 400;
    const circle: Contour = {
      closed: true,
      nodes: [
        { point: { x: 100, y: 500 }, handleIn: { x: 100, y: 500 - k }, handleOut: { x: 100, y: 500 + k }, type: "smooth" },
        { point: { x: 500, y: 900 }, handleIn: { x: 500 - k, y: 900 }, handleOut: { x: 500 + k, y: 900 }, type: "smooth" },
        { point: { x: 900, y: 500 }, handleIn: { x: 900, y: 500 + k }, handleOut: { x: 900, y: 500 - k }, type: "smooth" },
        { point: { x: 500, y: 100 }, handleIn: { x: 500 + k, y: 100 }, handleOut: { x: 500 - k, y: 100 }, type: "smooth" },
      ],
    };
    expect(findTerminals([circle], WIDE)).toHaveLength(0);
  });

  it("treats a horizontal bar as a stroke with two ends, not four", () => {
    // A bar lying on its side is still a stroke: its ends are the short edges
    // at either end, which is what gets slabbed on the arm of an E or a T.
    const terminals = findTerminals([stem(0, 0, 1000, 200)], 10_000);
    expect(terminals).toHaveLength(2);
    for (const terminal of terminals) expect(terminal.width).toBeCloseTo(200, 6);
    const xs = terminals.map((terminal) => Math.round(terminal.centre.x)).sort((a, b) => a - b);
    expect(xs).toEqual([0, 1000]);
  });

  it("respects the backstop on how wide an end may be", () => {
    // The ends are 200 across, so a cap below that rules them out.
    expect(findTerminals([stem(0, 0, 1000, 200)], 100)).toHaveLength(0);
  });
});

describe("addSlabs", () => {
  it("puts a bar on each end of a stem", () => {
    const result = addSlabs([stem(100, 0, 200, 1000)], {
      projection: 60,
      thickness: 40,
      maxWidth: WIDE,
    });
    // The stem, plus a slab at each end.
    expect(result).toHaveLength(3);
  });

  it("reaches past the stroke on both sides", () => {
    const result = addSlabs([stem(100, 0, 200, 1000)], {
      projection: 60,
      thickness: 40,
      maxWidth: WIDE,
    });
    const bounds = contoursBounds(result);
    expect(bounds.xMin).toBeCloseTo(40, 6);
    expect(bounds.xMax).toBeCloseTo(360, 6);
  });

  /**
   * The slab sits flush with the end of the stroke and reaches back into it,
   * so adding serifs does not make the letters taller than the font says they
   * are.
   */
  it("does not make the letter any taller", () => {
    const bare = contoursBounds([stem(100, 0, 200, 1000)]);
    const slabbed = contoursBounds(
      addSlabs([stem(100, 0, 200, 1000)], { projection: 60, thickness: 40, maxWidth: WIDE }),
    );
    expect(slabbed.yMin).toBeCloseTo(bare.yMin, 6);
    expect(slabbed.yMax).toBeCloseTo(bare.yMax, 6);
  });

  it("lays the bar over the stroke rather than merging into it", () => {
    const original = stem(100, 0, 200, 1000);
    const result = addSlabs([original], { projection: 60, thickness: 40, maxWidth: WIDE });
    // The stroke is handed back untouched; the bars are extra.
    expect(result[0]).toBe(original);
  });

  it("has nothing to add when the size is zero", () => {
    const contours = [stem(100, 0, 200, 1000)];
    expect(addSlabs(contours, { projection: 0, thickness: 0, maxWidth: WIDE })).toBe(contours);
  });

  it("has nothing to add to a letter with no flat stroke ends", () => {
    const contours: Contour[] = [];
    expect(addSlabs(contours, { projection: 60, thickness: 40, maxWidth: WIDE })).toBe(contours);
  });
});
