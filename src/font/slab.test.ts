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
    const heights = terminals
      .map((terminal) => Math.round(terminal.centre.y))
      .sort((a, b) => a - b);
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

describe("what is not a stroke end", () => {
  /**
   * Regression: slabs stood up inside Geist's B, b and 4.
   *
   * The convexity test reads the turn against the contour's own winding, and a
   * counter is wound against the letter, so the flat inside edges of a hole
   * read as stroke ends -- the back of B's bowl was one 232 units across, and
   * a bar was laid across the middle of the letter. A stroke never ends on the
   * edge of a hole.
   */
  it("finds no ends on the edge of a counter", () => {
    // A ring whose hole is as wide as its walls, so nothing but being a hole
    // tells its edges from the end of a stroke. The outside edges are ruled
    // out by the width backstop.
    const ring = [stem(0, 0, 600, 600), stem(200, 200, 200, 200)];
    expect(findTerminals(ring, 300)).toHaveLength(0);
  });

  /**
   * Regression: a second serif piled on the first.
   *
   * On Lora nearly every flat end the shape test found was the tip of a serif
   * or of a beak -- short, square, flanked by parallel sides, and less than
   * half a stem across. Each got a slab, crosswise, on top of the serif that
   * was already there: the crosses along the arms of E and the doubled feet.
   */
  it("leaves the tips of an existing serif alone", () => {
    // An I with slab serifs already on it: a 200-wide stem, and serifs 360
    // wide and 60 thick at head and foot.
    const serifed = polygon([
      { x: 20, y: 0 },
      { x: 20, y: 60 },
      { x: 100, y: 60 },
      { x: 100, y: 940 },
      { x: 20, y: 940 },
      { x: 20, y: 1000 },
      { x: 380, y: 1000 },
      { x: 380, y: 940 },
      { x: 300, y: 940 },
      { x: 300, y: 60 },
      { x: 380, y: 60 },
      { x: 380, y: 0 },
    ]);
    expect(findTerminals([serifed], WIDE)).toHaveLength(0);
    const contours = [serifed];
    expect(addSlabs(contours, { projection: 60, thickness: 33, maxWidth: WIDE })).toBe(contours);
  });
});

describe("slabs on arms", () => {
  /** An E: a stem with three arms, all 200 thick, drawn as one outline. */
  const e = polygon([
    { x: 0, y: 0 },
    { x: 0, y: 1000 },
    { x: 700, y: 1000 },
    { x: 700, y: 800 },
    { x: 200, y: 800 },
    { x: 200, y: 600 },
    { x: 600, y: 600 },
    { x: 600, y: 400 },
    { x: 200, y: 400 },
    { x: 200, y: 200 },
    { x: 700, y: 200 },
    { x: 700, y: 0 },
  ]);
  const options = { projection: 60, thickness: 33, maxWidth: WIDE };

  /**
   * Regression: posts through the ends of Geist's E.
   *
   * An arm's end was given the same bar as a stem's, reaching across the
   * stroke both ways -- which on an arm is up and down, so the top arm grew a
   * post above the cap height and the bottom one below the baseline. A slab
   * serif's E has beaks: hanging into the letter from the top arm, standing up
   * from the bottom one, flush with the outside.
   */
  it("gives the top and bottom arms a beak into the letter", () => {
    const result = addSlabs([e], options);
    const bounds = contoursBounds(result);
    expect(bounds.yMin).toBeCloseTo(0, 6);
    expect(bounds.yMax).toBeCloseTo(1000, 6);
    const beaks = result.slice(1).map((slab) => contoursBounds([slab]));
    expect(beaks).toHaveLength(2);
    const top = beaks.find((beak) => beak.yMax > 900)!;
    const bottom = beaks.find((beak) => beak.yMin < 100)!;
    // Down from the top arm and up from the bottom one, by the projection.
    expect(top.yMin).toBeCloseTo(800 - 60, 6);
    expect(bottom.yMax).toBeCloseTo(200 + 60, 6);
  });

  it("gives the middle arm nothing, having no outside to be flush with", () => {
    const result = addSlabs([e], options);
    for (const slab of result.slice(1)) {
      const box = contoursBounds([slab]);
      expect(box.yMax <= 400 || box.yMin >= 600).toBe(true);
    }
  });

  /**
   * Regression: a slab reaching into the next stroke.
   *
   * The foot of Geist's k stands right beside the foot of its leg, and the slab
   * ran across the white between them into the leg. A slab now takes at most
   * a share of the white beside it, so two feet close together keep a gap.
   */
  it("stops short of a stroke close beside it", () => {
    const left = stem(0, 0, 200, 1000);
    const right = stem(260, 0, 200, 1000);
    const result = addSlabs([left, right], options);
    const slabs = result.slice(2).map((slab) => contoursBounds([slab]));
    expect(slabs).toHaveLength(4);
    const fromLeft = slabs.filter((box) => box.xMin < 100);
    const fromRight = slabs.filter((box) => box.xMin >= 100);
    for (const box of fromLeft) expect(box.xMax).toBeLessThan(260);
    for (const box of fromRight) expect(box.xMin).toBeGreaterThan(200);
    // And still the full projection on the open side.
    for (const box of fromLeft) expect(box.xMin).toBeCloseTo(-60, 6);
  });
});
