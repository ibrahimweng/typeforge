/**
 * The Serif base's punctuation, and its small counters at Black.
 *
 * Drawn with the letters' pen the Serif face's comma was a round-ended stick,
 * its quotes two posts, its parentheses as short as a capital and as heavy at
 * their ends as in the middle, and its hyphen the size of a full stop. At Black
 * the lower counter of its a was a slit, its e's eye a chink and its A's a
 * pinhole. These pin the shapes a text face gives them, measured as ink.
 */

import { describe, expect, it } from "vitest";

import { contoursBounds, flattenContour } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { drawLetter } from "./build";
import { SANS, SERIF, SLAB, type Style } from "./style";

const STEP = 3;

function at(base: Style, weight: number): Style {
  return { ...base, pen: { ...base.pen, weight } };
}

function draw(name: string, style: Style, form?: string): Contour[] {
  const drawn = drawLetter(name, style, form);
  expect(drawn, `${name} would not draw`).not.toBeNull();
  return drawn!.contours;
}

/** The letter as ink on a grid, filled nonzero over every contour. */
function raster(contours: Contour[]) {
  const polys = contours.map((contour) => flattenContour(contour, 16));
  const b = contoursBounds(contours);
  const x0 = b.xMin - STEP * 2;
  const y0 = b.yMin - STEP * 2;
  const w = Math.ceil((b.xMax - b.xMin) / STEP) + 5;
  const h = Math.ceil((b.yMax - b.yMin) / STEP) + 5;
  const ink = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const y = y0 + j * STEP + 0.37;
    const crossings: Array<[number, number]> = [];
    for (const poly of polys) {
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k];
        const c = poly[(k + 1) % poly.length];
        if (a.y <= y === c.y <= y) continue;
        crossings.push([a.x + ((y - a.y) / (c.y - a.y)) * (c.x - a.x), c.y > a.y ? 1 : -1]);
      }
    }
    crossings.sort((p, q) => p[0] - q[0]);
    let winding = 0;
    let next = 0;
    for (let i = 0; i < w; i++) {
      const x = x0 + i * STEP + 0.29;
      while (next < crossings.length && crossings[next][0] < x) winding += crossings[next++][1];
      ink[j * w + i] = winding !== 0 ? 1 : 0;
    }
  }
  /** How much ink a row at height y carries, in units. */
  const across = (y: number): number => {
    const j = Math.round((y - y0) / STEP);
    if (j < 0 || j >= h) return 0;
    let count = 0;
    for (let i = 0; i < w; i++) count += ink[j * w + i];
    return count * STEP;
  };
  /** The pieces of ink, and the area of every counter, largest first. */
  const regions = (): { pieces: number; counters: number[] } => {
    const seen = new Uint8Array(w * h);
    let pieces = 0;
    const counters: number[] = [];
    for (let start = 0; start < w * h; start++) {
      if (seen[start]) continue;
      const colour = ink[start];
      let edge = false;
      let size = 0;
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const cell = stack.pop()!;
        size++;
        const i = cell % w;
        const j = (cell - i) / w;
        if (i === 0 || j === 0 || i === w - 1 || j === h - 1) edge = true;
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
          const n = nj * w + ni;
          if (seen[n] || ink[n] !== colour) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (colour === 1) pieces++;
      else if (!edge && size > 2) counters.push(size * STEP * STEP);
    }
    return { pieces, counters: counters.sort((p, q) => q - p) };
  };
  return { bounds: b, across, regions };
}

const WEIGHTS = [30, 96, 200];

describe("the Serif face's punctuation", () => {
  it("draws a comma as a drop whose tail thins to a point", () => {
    for (const weight of WEIGHTS) {
      const { bounds, across, regions } = raster(draw("comma", at(SERIF, weight)));
      const head = Math.max(...[0.1, 0.2, 0.3].map((k) => across(k * bounds.yMax)));
      const tip = across(bounds.yMin + (bounds.yMax - bounds.yMin) * 0.06);
      expect(tip / head, `comma tail at ${weight}`).toBeLessThan(0.45);
      // And the tail hangs a good way under the line, down and to the left.
      expect(-bounds.yMin, `comma depth at ${weight}`).toBeGreaterThan(bounds.yMax * 0.9);
      expect(regions().pieces).toBe(1);
    }
  });

  it("draws the straight quotes as wedges", () => {
    for (const weight of WEIGHTS) {
      const style = at(SERIF, weight);
      const { bounds, across } = raster(draw("quotesingle", style));
      const top = across(bounds.yMax - (bounds.yMax - bounds.yMin) * 0.08);
      const foot = across(bounds.yMin + (bounds.yMax - bounds.yMin) * 0.08);
      expect(foot / top, `quote at ${weight}`).toBeLessThan(0.7);
      expect(raster(draw("quotedbl", style)).regions().pieces).toBe(2);
    }
  });

  it("draws parentheses tall, heavy in the middle and a hairline at the tips", () => {
    for (const weight of WEIGHTS) {
      const style = at(SERIF, weight);
      for (const name of ["parenleft", "parenright"]) {
        const { bounds, across, regions } = raster(draw(name, style));
        expect(bounds.yMax, `${name} top at ${weight}`).toBeGreaterThan(
          SERIF.metrics.ascender * 0.95,
        );
        expect(bounds.yMin, `${name} foot at ${weight}`).toBeLessThan(
          SERIF.metrics.descender * 0.95,
        );
        const middle = across((bounds.yMin + bounds.yMax) / 2);
        const tip = across(bounds.yMax - (bounds.yMax - bounds.yMin) * 0.03);
        expect(middle / tip, `${name} contrast at ${weight}`).toBeGreaterThan(1.5);
        expect(regions().pieces).toBe(1);
      }
    }
  });

  it("draws a hyphen as a short heavy bar, not a speck", () => {
    for (const weight of WEIGHTS) {
      const { bounds } = raster(draw("hyphen", at(SERIF, weight)));
      expect(bounds.xMax - bounds.xMin, `hyphen length at ${weight}`).toBeGreaterThan(
        SERIF.metrics.xHeight * 0.55,
      );
      expect(bounds.yMax - bounds.yMin, `hyphen weight at ${weight}`).toBeGreaterThan(weight * 0.6);
    }
  });

  it("keeps the colon's and the semicolon's two marks apart at Black", () => {
    const style = at(SERIF, 200);
    expect(raster(draw("colon", style)).regions().pieces).toBe(2);
    expect(raster(draw("semicolon", style)).regions().pieces).toBe(2);
  });

  it("leaves the sans's marks as they were", () => {
    const { bounds } = raster(draw("parenleft", SANS));
    expect(bounds.yMax).toBeLessThan(SANS.metrics.ascender * 0.9);
  });

  it("draws every mark with the same nodes at every weight", () => {
    const names = [
      "comma",
      "semicolon",
      "quotesingle",
      "quotedbl",
      "parenleft",
      "parenright",
      "hyphen",
      "slash",
      "backslash",
      "bracketleft",
      "asterisk",
    ];
    for (const name of names) {
      const shape = (weight: number) =>
        drawLetter(name, at(SERIF, weight))!.contours.map((contour) => contour.nodes.length);
      expect(shape(30), name).toEqual(shape(96));
      expect(shape(200), name).toEqual(shape(96));
    }
  });
});

describe("the Serif face's small counters at Black", () => {
  const black = at(SERIF, 200);

  it("keeps the two-storey a's lower counter open", () => {
    const { counters } = raster(draw("a", black, "double")).regions();
    expect(counters[0]).toBeGreaterThan(32000);
  });

  it("keeps the e's eye open", () => {
    // Lora's e, and so the Serif's, is 0.83 of the old one's width, and its
    // Black eye is smaller by about as much: still more than a stem across.
    const { counters } = raster(draw("e", black, SERIF.forms?.e)).regions();
    expect(counters[0]).toBeGreaterThan(18000);
  });

  it("keeps the A's counter open", () => {
    const { counters } = raster(draw("A", black)).regions();
    expect(counters[0]).toBeGreaterThan(18000);
  });

  it("keeps the g's link out of its upper counter and both counters open", () => {
    // The Serif's own g, Lora's, whose loop is lighter and a little narrower.
    const { counters, pieces } = raster(draw("g", black, SERIF.forms?.g)).regions();
    expect(pieces).toBe(1);
    expect(counters.length).toBe(2);
    expect(counters[1]).toBeGreaterThan(25000);
  });

  it("draws them with the same nodes at every weight", () => {
    for (const [name, form] of [
      ["a", "double"],
      ["g", "double"],
      ["e", undefined],
      ["A", undefined],
    ] as const) {
      const shape = (weight: number) =>
        drawLetter(name, at(SERIF, weight), form)!.contours.map((c) => c.nodes.length);
      expect(shape(30), name).toEqual(shape(96));
      expect(shape(200), name).toEqual(shape(96));
    }
  });
});

describe("the Slab five", () => {
  it("joins its stem to its bowl in one piece, with no notch, light to black", () => {
    for (const weight of WEIGHTS) {
      const { regions } = raster(draw("five", at(SLAB, weight)));
      const { pieces, counters } = regions();
      expect(pieces, `five at ${weight}`).toBe(1);
      expect(counters, `five at ${weight}`).toEqual([]);
    }
  });
});
