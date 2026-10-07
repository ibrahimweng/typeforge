/**
 * The letters a grid starts with, checked for reading as the letters they are.
 *
 * Traced from the Sans after it was redrawn after Geist, the grid's c closed
 * into an o, its s and S came back as an 8 and a delta, and the M grew a hook.
 * These hold the drawn alphabet to the few facts that tell those letters apart.
 */

import { describe, expect, it } from "vitest";
import { longEnoughFor } from "../../test/fixtures";

import { ready, unite } from "@/font/boolean";
import { contourArea } from "@/font/geometry";
// Named apart from the hooks: `useKit` switches a document onto its grid.
import { draw, layOut, startFrom, useKit as onGrid } from "./document";
import { cellKey, GRID, type Tiles, unitOf } from "./kit";
import { DRAWN_ON_GRID, drawnTiles } from "./kit-alphabet";
import { BASES, SANS, type Style } from "./style";

/**
 * The budget for the slow tests below.
 *
 * They take under a second and about two seconds on a development machine. Asked of
 * `longEnoughFor`, so a coverage run gets the room instrumenting costs, and
 * kept to this rather than five minutes, so a hang still reads as one.
 */
const SLOW = longEnoughFor(30_000);

/** A document started from a base, its letters laid on the grid. */
const gridded = (base: Style) => onGrid(layOut(startFrom(base)), true);

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

  it("keeps the counters of the round letters through the fuse", { timeout: SLOW }, async () => {
    // A ring of four full-roundness turns came out of the fuse solid.
    await ready();
    const grid = onGrid(layOut(startFrom(SANS)), true);
    for (const letter of ["o", "O", "zero", "b", "e", "Y"]) {
      const fused = unite(draw(letter, grid)!.contours, "winding");
      expect(
        fused.filter((one) => contourArea(one) > 0),
        letter,
      ).toHaveLength(1);
      const holes = fused.filter((one) => contourArea(one) < 0).length;
      expect(holes, letter).toBe(letter === "Y" ? 0 : 1);
    }
  });

  it("stays legible on every base's own pen", { timeout: SLOW }, async () => {
    /*
     * The a's bowl and the e's eye are one row high, and on the Ribbon and
     * the Fairground, whose level runs are a whole cell deep, they closed
     * solid; on the Marker and the Display they were slits; and the Brush's
     * i and j wore their dots on their stems. The pen a grid letter is drawn
     * with is held to what a cell can take (`gridPen` in `kit.ts`).
     */
    await ready();
    const shut: string[] = [];
    for (const base of BASES) {
      const grid = gridded(base);
      const unit = unitOf(base, GRID);
      for (const letter of ["a", "e", "o", "zero", "B"]) {
        const fused = unite(draw(letter, grid)!.contours, "winding");
        const want = letter === "B" ? 2 : 1;
        const open = fused.filter((one) => -contourArea(one) > (unit * 0.25) ** 2).length;
        if (open < want) shut.push(`${base.name} ${letter}`);
      }
      for (const letter of ["i", "j"]) {
        const fused = unite(draw(letter, grid)!.contours, "winding");
        if (fused.filter((one) => contourArea(one) > 0).length !== 2) {
          shut.push(`${base.name} ${letter} dot`);
        }
      }
    }
    expect(shut).toEqual([]);
  });

  it("is what a new grid starts from", () => {
    const kit = layOut(startFrom(SANS)).kit!;
    expect(signature(kit.glyphs.c)).toBe(signature(tiles("c")));
    expect(signature(kit.glyphs.M)).toBe(signature(tiles("M")));
  });
});
