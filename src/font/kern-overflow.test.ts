/**
 * Kerning too big for one subtable, written so that every offset still fits.
 *
 * A PairPos subtable reaches its coverage and class definitions through
 * sixteen-bit offsets measured from its own start, and the writer stores the
 * low sixteen bits of whatever it is handed. A class grid of 183 left classes
 * by 172 right ones -- the Soft Serif's -- is 62,952 bytes of cells before
 * those tables even start, so the offset to the right-hand class definition
 * came out at 66,218 and was written as 682. fontTools read a class definition
 * of format 0 there, HarfBuzz threw the lookup away, and every one of the
 * family's kerning pairs was gone from the file while nothing said so.
 *
 * So each table here is walked byte by byte, recomputing where every part
 * must start from the lengths of the parts before it and holding the stored
 * offset to that -- an offset that wrapped can never agree -- and then read
 * back with the application's own reader and asked about every pair, against
 * what the kerning handed in says.
 */

import { describe, expect, it } from "vitest";

import { kernBetween, readGposKerning } from "./gpos";
import { buildGposTable, type ResolvedClassKern, type ResolvedPair } from "./kern";

interface Walked {
  format: number;
  /** Absolute position of the subtable in the table. */
  at: number;
  class1Count?: number;
  class2Count?: number;
  coverage: number[];
}

/**
 * Every PairPos subtable of a table this application wrote, with each of its
 * offsets checked against where the part it names actually has to begin.
 */
function walk(table: Uint8Array): Walked[] {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const u16 = (at: number) => view.getUint16(at);
  const inside = (at: number, what: string) => {
    expect(at, what).toBeGreaterThanOrEqual(0);
    expect(at, what).toBeLessThanOrEqual(table.length);
  };
  const coverageAt = (at: number) => {
    expect(u16(at), "coverage format").toBe(1);
    const count = u16(at + 2);
    const glyphs: number[] = [];
    for (let index = 0; index < count; index++) glyphs.push(u16(at + 4 + index * 2));
    inside(at + 4 + count * 2, "coverage end");
    return { glyphs, length: 4 + count * 2 };
  };
  const classDefAt = (at: number, classes: number) => {
    expect(u16(at), "class definition format").toBe(2);
    const count = u16(at + 2);
    inside(at + 4 + count * 6, "class definition end");
    let last = -1;
    const wrong: string[] = [];
    for (let index = 0; index < count; index++) {
      const record = at + 4 + index * 6;
      const start = u16(record);
      const end = u16(record + 2);
      const klass = u16(record + 4);
      if (start <= last || end < start) wrong.push(`range ${index} out of order`);
      if (klass < 1 || klass >= classes) wrong.push(`range ${index} names class ${klass}`);
      last = end;
    }
    expect(wrong).toEqual([]);
    return 4 + count * 6;
  };

  const lookupList = u16(8);
  const out: Walked[] = [];
  for (let lookup = 0; lookup < u16(lookupList); lookup++) {
    const lookupAt = lookupList + u16(lookupList + 2 + lookup * 2);
    expect(u16(lookupAt), "an extension lookup").toBe(9);
    const count = u16(lookupAt + 4);
    for (let slot = 0; slot < count; slot++) {
      const recordAt = lookupAt + u16(lookupAt + 6 + slot * 2);
      expect(recordAt, "records follow the offsets").toBe(lookupAt + 6 + count * 2 + slot * 8);
      expect(u16(recordAt + 2), "wraps pair positioning").toBe(2);
      const at = recordAt + view.getUint32(recordAt + 4);
      inside(at, "subtable");
      const format = u16(at);
      if (format === 1) {
        const sets = u16(at + 8);
        let expected = 10 + sets * 2;
        for (let index = 0; index < sets; index++) {
          const pairSet = u16(at + 10 + index * 2);
          expect(pairSet, `pair set ${index} where it must be`).toBe(expected);
          expected += 2 + u16(at + pairSet) * 4;
        }
        expect(u16(at + 2), "coverage where it must be").toBe(expected);
        const coverage = coverageAt(at + expected);
        expect(coverage.glyphs).toHaveLength(sets);
        out.push({ format, at, coverage: coverage.glyphs });
      } else {
        expect(format).toBe(2);
        const class1Count = u16(at + 12);
        const class2Count = u16(at + 14);
        const coverageOffset = 16 + class1Count * class2Count * 2;
        expect(u16(at + 2), "coverage right after the cells").toBe(coverageOffset);
        const coverage = coverageAt(at + coverageOffset);
        const classDef1 = coverageOffset + coverage.length;
        expect(u16(at + 8), "left classes right after the coverage").toBe(classDef1);
        const classDef2 = classDef1 + classDefAt(at + classDef1, class1Count);
        expect(u16(at + 10), "right classes right after the left").toBe(classDef2);
        classDefAt(at + classDef2, class2Count);
        out.push({ format, at, class1Count, class2Count, coverage: coverage.glyphs });
      }
    }
  }
  return out;
}

/**
 * A grid the shape of the Soft Serif's, a little bigger: every left class
 * meets every right class it can without either index passing the packer's
 * ceiling, so the whole lot lands in one grid, and that grid is far past what
 * one subtable can address.
 */
function bigGrid(lefts: number, rights: number) {
  // Two glyphs a class, the left ones from 1 and the right ones from 1000.
  const leftOf = (klass: number) => [klass * 2 - 1, klass * 2];
  const rightOf = (klass: number) => [998 + klass * 2, 999 + klass * 2];
  const classes: ResolvedClassKern[] = [];
  const value = new Map<string, number>();
  for (let left = 1; left <= lefts; left++) {
    for (let right = 1; right <= rights; right++) {
      // Row one and column one name every class, so the classes are numbered
      // in order; the rest is a pattern with holes in it.
      const named = left === 1 || right === 1;
      if (!named && ((left * 7 + right * 3) % 4 === 0 || (left + 1) * (right + 1) > 28_000)) {
        continue;
      }
      const amount = -(((left * 31 + right * 17) % 120) + 1);
      classes.push({ left: leftOf(left), right: rightOf(right), value: amount });
      for (const one of leftOf(left)) {
        for (const other of rightOf(right)) value.set(`${one},${other}`, amount);
      }
    }
  }
  return { classes, value, glyphs: { left: lefts * 2 + 2, right: 1000 + rights * 2 + 2 } };
}

describe("kerning too big for one subtable", () => {
  it("splits an overflowing grid into subtables whose offsets all fit, and keeps every pair", () => {
    const { classes, value, glyphs } = bigGrid(190, 175);
    const table = buildGposTable([], classes)!;

    const subtables = walk(table);
    // One grid of 191 by 176 cells would be 67,232 bytes of cells alone.
    expect(subtables.length).toBeGreaterThan(1);
    expect(subtables.every((one) => one.format === 2)).toBe(true);
    // No left glyph is covered twice, or the second would never be reached.
    const covered = subtables.flatMap((one) => one.coverage);
    expect(new Set(covered).size).toBe(covered.length);
    expect(covered).toHaveLength(380);

    const kerning = readGposKerning(table);
    let checked = 0;
    let kerned = 0;
    for (let left = 0; left <= glyphs.left; left++) {
      for (let right = 990; right <= glyphs.right; right++) {
        const want = value.get(`${left},${right}`) ?? 0;
        const got = kernBetween(kerning, left, right);
        if (got !== want) expect(got, `${left},${right}`).toBe(want);
        checked++;
        if (want !== 0) kerned++;
      }
    }
    expect(checked).toBeGreaterThan(100_000);
    expect(kerned).toBeGreaterThan(50_000);
  });

  it("writes a grid that fits as the one subtable it always was", () => {
    // 181 by 171 cells is 61,902 bytes, and the coverage and the left classes
    // still land inside the sixteen bits -- the plain Serif's grid is this size.
    const { classes, value } = bigGrid(180, 170);
    const table = buildGposTable([], classes)!;
    const subtables = walk(table);
    expect(subtables).toHaveLength(1);
    expect([subtables[0].class1Count, subtables[0].class2Count]).toEqual([181, 171]);

    const kerning = readGposKerning(table);
    for (const [key, want] of value) {
      const [left, right] = key.split(",").map(Number);
      if (kernBetween(kerning, left, right) !== want) {
        expect(kernBetween(kerning, left, right), key).toBe(want);
      }
    }
  });

  it("still lets a single pair win over the split grid, and a second lookup add to it", () => {
    const { classes, value } = bigGrid(190, 175);
    const pairs: ResolvedPair[] = [
      { left: 1, right: 1000, value: 15 },
      { left: 379, right: 1349, value: -7 },
      { left: 200, right: 1100, value: -3 },
    ];
    const second: ResolvedClassKern[] = [
      { left: [1, 379], right: [1000, 1349], value: -100, group: 1 },
    ];
    const table = buildGposTable(pairs, [...classes, ...second])!;
    walk(table);

    const kerning = readGposKerning(table);
    expect(kerning.lookups).toHaveLength(2);
    // The pair, not the grid, then the second lookup on top where it covers.
    expect(kernBetween(kerning, 1, 1000)).toBe(15 - 100);
    expect(kernBetween(kerning, 379, 1349)).toBe(-7 - 100);
    expect(kernBetween(kerning, 200, 1100)).toBe(-3);
    // Where no pair speaks, the grid does -- in whichever piece holds the row.
    expect(kernBetween(kerning, 379, 1000)).toBe(value.get("379,1000")! - 100);
    expect(kernBetween(kerning, 1, 1349)).toBe(value.get("1,1349")! - 100);
    expect(kernBetween(kerning, 2, 1000)).toBe(value.get("2,1000")!);
    expect(kernBetween(kerning, 200, 1101)).toBe(value.get("200,1101") ?? 0);
    expect(kernBetween(kerning, 380, 1349)).toBe(value.get("380,1349") ?? 0);
  });

  it("shares a left class too big for one subtable between several, each glyph kerning the same", () => {
    // One class of eight thousand glyphs that are never neighbours, so its
    // coverage and its class definition run to sixty-four kilobytes between
    // them, against six hundred right classes of one glyph each.
    const left = Array.from({ length: 8000 }, (_, index) => 2 + index * 2);
    const amount = (right: number) => -((right % 200) + 1);
    const classes: ResolvedClassKern[] = [];
    for (let index = 0; index < 600; index++) {
      const right = 1 + index * 2;
      classes.push({ left, right: [right], value: amount(right) });
    }
    const table = buildGposTable([], classes)!;

    const subtables = walk(table);
    expect(subtables.length).toBeGreaterThan(1);
    const covered = subtables.flatMap((one) => one.coverage);
    expect(new Set(covered).size).toBe(8000);
    expect(covered).toHaveLength(8000);

    const kerning = readGposKerning(table);
    const someRights = [1, 3, 199, 401, 999, 1199];
    for (const glyph of left) {
      for (const right of someRights) {
        if (kernBetween(kerning, glyph, right) !== amount(right)) {
          expect(kernBetween(kerning, glyph, right), `${glyph},${right}`).toBe(amount(right));
        }
      }
    }
    for (const glyph of [2, 8000, 16_000]) {
      for (let right = 1; right < 1200; right += 2) {
        if (kernBetween(kerning, glyph, right) !== amount(right)) {
          expect(kernBetween(kerning, glyph, right), `${glyph},${right}`).toBe(amount(right));
        }
      }
    }
    // An odd glyph is in no class on the left, and an even one in none on the right.
    expect(kernBetween(kerning, 3, 1)).toBe(0);
    expect(kernBetween(kerning, 2, 2)).toBe(0);
  });

  it("splits one glyph's pairs over several subtables when they will not go in one", () => {
    // Twenty thousand pairs for one glyph is eighty kilobytes of pair set.
    const pairs: ResolvedPair[] = [];
    for (let right = 1; right <= 20_000; right++) {
      pairs.push({ left: 5, right, value: -((right % 90) + 1) });
    }
    pairs.push({ left: 6, right: 7, value: -11 }, { left: 4, right: 9, value: -12 });
    // A grid behind them, which only the pairs that are not there fall through to.
    const classes: ResolvedClassKern[] = [{ left: [5], right: [20_001, 30], value: -500 }];
    const table = buildGposTable(pairs, classes)!;

    const subtables = walk(table);
    expect(subtables.filter((one) => one.format === 1).length).toBeGreaterThan(1);
    // The pairs come first and the grid after them, as before.
    expect(subtables.at(-1)!.format).toBe(2);

    const kerning = readGposKerning(table);
    for (let right = 1; right <= 20_000; right++) {
      const want = -((right % 90) + 1);
      if (kernBetween(kerning, 5, right) !== want) {
        expect(kernBetween(kerning, 5, right), `5,${right}`).toBe(want);
      }
    }
    expect(kernBetween(kerning, 5, 20_001)).toBe(-500);
    expect(kernBetween(kerning, 6, 7)).toBe(-11);
    expect(kernBetween(kerning, 4, 9)).toBe(-12);
    expect(kernBetween(kerning, 4, 7)).toBe(0);
  });
});
