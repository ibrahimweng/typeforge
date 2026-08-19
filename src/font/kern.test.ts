import { describe, expect, it } from "vitest";

import { buildGposTable, buildKernTable } from "./kern";

describe("buildKernTable", () => {
  it("returns null when there is nothing to kern", () => {
    expect(buildKernTable([])).toBeNull();
  });

  it("writes a version 0 table with one horizontal format 0 subtable", () => {
    const table = buildKernTable([{ left: 36, right: 57, value: -120 }])!;
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    expect(view.getUint16(0)).toBe(0); // table version
    expect(view.getUint16(2)).toBe(1); // subtable count
    expect(view.getUint16(4)).toBe(0); // subtable version
    expect(view.getUint16(6)).toBe(table.length - 4); // subtable length
    expect(view.getUint16(8)).toBe(0x0001); // horizontal, format 0
    expect(view.getUint16(10)).toBe(1); // pair count
  });

  it("sorts pairs by left glyph then right glyph, as the format requires", () => {
    const table = buildKernTable([
      { left: 9, right: 2, value: -10 },
      { left: 3, right: 8, value: -20 },
      { left: 3, right: 1, value: -30 },
    ])!;
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    const pairAt = (i: number) => {
      const base = 18 + i * 6;
      return [view.getUint16(base), view.getUint16(base + 2), view.getInt16(base + 4)];
    };
    expect(pairAt(0)).toEqual([3, 1, -30]);
    expect(pairAt(1)).toEqual([3, 8, -20]);
    expect(pairAt(2)).toEqual([9, 2, -10]);
  });

  it("clamps values that would overflow the int16 the format stores", () => {
    const table = buildKernTable([{ left: 1, right: 2, value: -99999 }])!;
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    expect(view.getInt16(22)).toBe(-32768);
  });
});

describe("buildGposTable", () => {
  it("returns null when there is no kerning at all", () => {
    expect(buildGposTable([], [])).toBeNull();
  });

  it("writes a 1.0 header whose offsets land inside the table", () => {
    const table = buildGposTable([{ left: 36, right: 57, value: -120 }])!;
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    expect(view.getUint16(0)).toBe(1); // major version
    expect(view.getUint16(2)).toBe(0); // minor version
    for (const offset of [view.getUint16(4), view.getUint16(6), view.getUint16(8)]) {
      expect(offset).toBeGreaterThanOrEqual(10);
      expect(offset).toBeLessThan(table.length);
    }
  });

  it("builds a table when only class kerning is present", () => {
    const table = buildGposTable([], [{ left: [36, 37], right: [57], value: -80 }]);
    expect(table).not.toBeNull();
    expect(table!.length).toBeGreaterThan(10);
  });
});
