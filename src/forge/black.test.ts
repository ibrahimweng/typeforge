/**
 * A Black drawn the way a type designer draws one.
 *
 * Past a face's own text weight the pen takes on contrast, the round letters
 * and the figures widen, the bowls hung on a stem run further out and the
 * letters stand further apart -- see `blackness` in `style.ts`. What that is
 * for is counters: a heavy stem left alone closes every one of them, and the
 * Sans at a pen of 200 had an e with no eye, a B whose upper bowl was a chink
 * and an eight that was two slits.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ready, unite } from "@/font/boolean";
import { contourArea, contourContainsPoint, flattenContour } from "@/font/geometry";
import type { Contour, Vec2 } from "@/font/types";
import { drawLetter } from "./build";
import { BASES, blackness, spacingOf, type Style } from "./style";

beforeAll(async () => {
  await ready();
});

const face = (name: string): Style => BASES.find((one) => one.name === name)!;
const at = (base: Style, weight: number): Style => ({
  ...base,
  pen: { ...base.pen, weight },
});

/** The letters with a closed counter, and how many each has. */
const COUNTERS: Record<string, number> = {
  o: 1,
  e: 1,
  a: 1,
  b: 1,
  d: 1,
  p: 1,
  q: 1,
  g: 1,
  B: 2,
  D: 1,
  O: 1,
  P: 1,
  R: 1,
  zero: 1,
  six: 1,
  eight: 2,
  nine: 1,
};

/**
 * The widest circle that fits inside a counter, across.
 *
 * Not the counter's width or height alone: a slit is wide one way and nothing
 * the other, and the eye reads a counter as open by the round thing it could
 * hold. Found on a grid over the hole, which is plenty for a test.
 */
function openness(hole: Contour): number {
  const outline = flattenContour(hole, 16);
  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  const [left, right, bottom, top] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const step = Math.max(2, Math.min(right - left, top - bottom) / 25);
  let best = 0;
  for (let x = left; x <= right; x += step) {
    for (let y = bottom; y <= top; y += step) {
      const point: Vec2 = { x, y };
      if (!contourContainsPoint(hole, point)) continue;
      let nearest = Number.POSITIVE_INFINITY;
      for (let index = 0; index < outline.length; index++) {
        const a = outline[index];
        const b = outline[(index + 1) % outline.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length));
        nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
      }
      best = Math.max(best, nearest);
    }
  }
  return best * 2;
}

/**
 * Every counter of a letter, as a share of the stem: the openness of each.
 *
 * A hole smaller than a quarter of a stem square is left out -- that is a
 * pinhole where two strokes nearly meet, which some faces have at every
 * weight, and not a counter. A counter that has closed is not left out: it
 * is simply not there, and the count says so.
 */
function counters(name: string, style: Style): number[] {
  const drawn = drawLetter(name, style)!;
  const stem = style.pen.weight;
  return unite(drawn.contours, "winding")
    .filter((contour) => contourArea(contour) < -((stem * 0.25) ** 2))
    .map((hole) => openness(hole) / stem);
}

function expectOpen(names: string[], weight: number, least: number): void {
  for (const name of names) {
    const style = at(face(name), weight);
    for (const [letter, count] of Object.entries(COUNTERS)) {
      const found = counters(letter, style);
      const where = `${name} ${letter} at ${weight}`;
      expect(found.length, `${where} has lost a counter`).toBeGreaterThanOrEqual(count);
      for (const one of found) expect(one, `${where}: ${found.join(", ")}`).toBeGreaterThan(least);
    }
  }
}

describe("a Black keeps its counters open", () => {
  it("at a pen of 200 on every face that has a text weight to come from", () => {
    /*
     * A fifth of a stem across and more at the least -- the eye of an e,
     * which is what closes first on every face -- and most counters a stem or
     * more. On the code before, the Sans e had no eye at all.
     *
     * Not the Fairground, whose pen is held on its side: its horizontals are
     * its heavy strokes, and a Black of a reversed face is its own design. Not
     * the Ribbon or the Marker, which start two thirds of the way to a Black
     * and round their corners into the counters. And not the Didone or the
     * Roundhand, whose B carries a pinhole at every weight.
     */
    expectOpen(
      [
        "Sans",
        "Grotesque",
        "Serif",
        "Display",
        "Geometric",
        "Technical",
        "Slab",
        "Typewriter",
        "Wavy",
        "Flared",
        "Psychedelic",
        "Brush",
        "Handwriting",
        "Formal Script",
        "Casual Script",
        "Monoline Script",
      ],
      200,
      0.22,
    );
  }, 300_000);

  it("and at the end of the weight control on the plain faces", () => {
    expectOpen(
      ["Sans", "Grotesque", "Geometric", "Technical", "Slab", "Typewriter", "Wavy", "Brush"],
      260,
      0.25,
    );
  }, 300_000);
});

describe("what a heavy weight changes", () => {
  it("changes nothing at or below a face's own weight", () => {
    for (const base of BASES) {
      expect(blackness(base), base.name).toBe(0);
      expect(blackness(at(base, 30)), base.name).toBe(0);
      expect(spacingOf(base), base.name).toBe(base.metrics.sidebearing);
    }
  });

  it("thins the horizontals and opens the spacing past it", () => {
    const sans = face("Sans");
    const black = at(sans, 200);
    expect(blackness(black)).toBeGreaterThan(0.9);
    expect(spacingOf(black)).toBeGreaterThan(sans.metrics.sidebearing + 20);
    // An o's crown is lighter than its sides.
    const o = drawLetter("o", black)!;
    const hole = unite(o.contours, "winding").find((one) => contourArea(one) < 0)!;
    const outline = flattenContour(hole, 16);
    const ink = unite(o.contours, "winding").find((one) => contourArea(one) > 0)!;
    const outer = flattenContour(ink, 16);
    const side = Math.min(...outline.map((p) => p.x)) - Math.min(...outer.map((p) => p.x));
    const crown = Math.max(...outer.map((p) => p.y)) - Math.max(...outline.map((p) => p.y));
    expect(crown / side).toBeLessThan(0.75);
    // And the o widens with the n, as a Black's does.
    const n = drawLetter("n", black)!;
    expect(o.advanceWidth / n.advanceWidth).toBeGreaterThan(0.85);
  });

  /*
   * A variable font moves every point of a letter between its masters, so the
   * letter has to be drawn with the same points at every weight -- the
   * compensation above changes how far and how heavy, never how many.
   */
  it("draws every letter with the same points at every weight", () => {
    const letters = [
      ...Object.keys(COUNTERS),
      ..."nhmscutAGSKMNWkxy".split(""),
      "two",
      "three",
      "five",
      "ampersand",
    ];
    for (const name of [
      "Sans",
      "Grotesque",
      "Serif",
      "Display",
      "Geometric",
      "Ribbon",
      "Technical",
      "Fairground",
      "Didone",
      "Slab",
      "Typewriter",
      "Marker",
      "Flared",
      "Brush",
    ]) {
      const base = face(name);
      for (const letter of letters) {
        const shape = (weight: number): string =>
          drawLetter(letter, at(base, weight))!
            .contours.map((contour) => contour.nodes.length)
            .join(",");
        const drawn = shape(base.pen.weight);
        for (const weight of [30, 200, 260]) {
          expect(shape(weight), `${name} ${letter} at ${weight}`).toBe(drawn);
        }
      }
    }
  }, 300_000);
});
