/**
 * The letters a grid starts with, checked for reading as the letters they are.
 *
 * Traced from the Sans after it was redrawn after Geist, the grid's c closed
 * into an o, its s and S came back as an 8 and a delta, and the M grew a hook.
 * These hold the drawn alphabet to the few facts that tell those letters apart.
 */

import { describe, expect, it } from "vitest";

import { ready, unite } from "@/font/boolean";
import { contourArea } from "@/font/geometry";
import { draw, layOut, startFrom, useKit } from "./document";
import { cellKey, GRID, type Tiles } from "./kit";
import { DRAWN_ON_GRID, drawnTiles } from "./kit-alphabet";
import { SANS } from "./style";

const tiles = (letter: string): Tiles => {
  const made = drawnTiles(letter, GRID);
  expect(made, letter).not.toBeNull();
  return made!;
};
const has = (one: Tiles, column: number, row: number): boolean => cellKey(column, row) in one.cells;
const signature = (one: Tiles): string =>
  JSON.stringify(
    Object.entries(one.cells)
      .map(([key, cell]) => [key, [...cell.ports].sort()])
      .sort(),
  );

describe("the alphabet drawn for the grid", () => {
  it("has every letter and figure", () => {
    for (const letter of [
      ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "zero",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
    ]) {
      expect(DRAWN_ON_GRID.has(letter), letter).toBe(true);
    }
  });

  it("keeps the c open where the o is closed", () => {
    const c = tiles("c");
    const o = tiles("o");
    // The right-hand side between the terminals is empty on the c and not on the o.
    expect(has(c, 2, 1) || has(c, 2, 2)).toBe(false);
    expect(has(o, 2, 1) && has(o, 2, 2)).toBe(true);
  });

  it("draws the s, the S, the 8 and the B as four different things", () => {
    const shapes = ["s", "S", "eight", "B", "five"].map((letter) => signature(tiles(letter)));
    expect(new Set(shapes).size).toBe(shapes.length);
    // The S is open on the left below its spine and on the right above it.
    const S = tiles("S");
    expect(has(S, 0, 1)).toBe(false);
    expect(has(S, 3, 3)).toBe(false);
  });

  it("gives the M nothing past its stems", () => {
    const M = tiles("M");
    for (const key of Object.keys(M.cells)) {
      const [, row] = key.split(",").map(Number);
      expect(row, key).toBeLessThanOrEqual(4);
      expect(row, key).toBeGreaterThanOrEqual(0);
    }
  });

  it("stays inside the grid it was drawn for", () => {
    for (const letter of DRAWN_ON_GRID) {
      for (const key of Object.keys(tiles(letter).cells)) {
        const [column, row] = key.split(",").map(Number);
        expect(column, `${letter} ${key}`).toBeGreaterThanOrEqual(0);
        expect(row, `${letter} ${key}`).toBeGreaterThanOrEqual(-GRID.below);
        expect(row, `${letter} ${key}`).toBeLessThan(GRID.rows + GRID.above);
      }
    }
  });

  it("leaves another grid to the skeletons", () => {
    expect(drawnTiles("c", { ...GRID, rows: 7 })).toBeNull();
    expect(drawnTiles("c", { ...GRID, below: 1 })).toBeNull();
  });

  it("keeps the counters of the round letters through the fuse", async () => {
    // A ring of four full-roundness turns came out of the fuse solid.
    await ready();
    const grid = useKit(layOut(startFrom(SANS)), true);
    for (const letter of ["o", "O", "zero", "b", "e", "Y"]) {
      const fused = unite(draw(letter, grid)!.contours, "winding");
      expect(
        fused.filter((one) => contourArea(one) > 0),
        letter,
      ).toHaveLength(1);
      const holes = fused.filter((one) => contourArea(one) < 0).length;
      expect(holes, letter).toBe(letter === "Y" ? 0 : 1);
    }
  }, 60_000);

  it("is what a new grid starts from", () => {
    const kit = layOut(startFrom(SANS)).kit!;
    expect(signature(kit.glyphs.c)).toBe(signature(tiles("c")));
    expect(signature(kit.glyphs.M)).toBe(signature(tiles("M")));
  });
});
