/**
 * Kerning past what any GPOS table can address, and grids with many rows.
 *
 * The writer cuts every subtable to fit its sixteen-bit offsets, but the
 * lookup list above them has sixteen-bit offsets of its own, and no cutting
 * helps a list of thousands of lookups: splitting a lookup would change what
 * the kerning means. The writer refuses such a table rather than write offsets
 * that wrap. Refused, it used to take the whole export down with it -- a font
 * that could not be saved at all because of its kerning. The export now goes
 * out without the kerning and says so, and a preserving export keeps the
 * source font's own table as it arrived.
 *
 * And a grid of thousands of rows, which is cut into subtables row by row,
 * used to take time growing with the square of its rows -- tens of seconds at
 * the largest grid the packer allows -- because every row rebuilt the whole
 * run's coverage to measure it.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { exportFont, KERNING_TOO_LARGE } from "./export";
import { kernBetween, readGposKerning } from "./gpos";
import { buildGposTable, KerningTooLarge, type ResolvedClassKern, type ResolvedPair } from "./kern";
import { blankGlyph } from "./library";
import { importFont } from "./parse";
import { readSfnt } from "./sfnt";
import { emptyTypeface, type KernPair, type Typeface } from "./types";

/** One pair a lookup, each pair its own: `count` lookups in all. */
function lookups(count: number): ResolvedPair[] {
  const pairs: ResolvedPair[] = [];
  for (let group = 0; group < count; group++) {
    pairs.push({
      left: 1 + (group % 60),
      right: 100 + Math.floor(group / 60),
      value: -(1 + (group % 90)),
      group,
    });
  }
  return pairs;
}

/** A, V and `.notdef`, with the same A-V pair once in each of `groups` lookups. */
function typefaceKerning(groups: number): Typeface {
  const typeface = emptyTypeface();
  typeface.glyphs = [
    { ...blankGlyph(".notdef"), dirty: false },
    blankGlyph("A", [0x41]),
    blankGlyph("V", [0x56]),
  ];
  typeface.glyphIndex = new Map([
    [".notdef", 0],
    ["A", 1],
    ["V", 2],
  ]);
  typeface.kerning = Array.from(
    { length: groups },
    (_, group): KernPair => ({ left: "A", right: "V", value: -10, group }),
  );
  return typeface;
}

describe("a lookup list no table can address", () => {
  it("writes three thousand lookups, every one of them reaching its pair", () => {
    const pairs = lookups(3000);
    const table = buildGposTable(pairs);
    expect(table).not.toBeNull();
    const kerning = readGposKerning(table!);
    expect(kerning.lookups).toHaveLength(3000);
    const wrong = pairs.filter(
      (pair) => kernBetween(kerning, pair.left, pair.right) !== pair.value,
    );
    expect(wrong).toEqual([]);
  });

  it("refuses four thousand rather than write offsets that wrap", () => {
    // Four thousand lookups of sixteen bytes each run past the sixty-four
    // kilobytes the lookup list's own offsets reach.
    expect(() => buildGposTable(lookups(4000))).toThrow(KerningTooLarge);
    expect(() => buildGposTable(lookups(4000))).toThrow(/does not fit in sixteen bits/);
  });

  it("still exports the font, without the kerning, and says so", async () => {
    const result = await exportFont(typefaceKerning(4000), {
      format: "ttf",
      fidelity: "rebuild",
      includeKerning: true,
      now: 0,
    });
    const { tables } = readSfnt(result.bytes);
    expect(tables.has("glyf")).toBe(true);
    expect(tables.has("GPOS")).toBe(false);
    expect(result.notes).toContain(`${KERNING_TOO_LARGE} The file was written without kerning.`);
  });

  it("kerns as before when the same kerning fits", async () => {
    const result = await exportFont(typefaceKerning(3), {
      format: "ttf",
      fidelity: "rebuild",
      includeKerning: true,
      now: 0,
    });
    const gpos = readSfnt(result.bytes).tables.get("GPOS");
    expect(gpos).toBeDefined();
    // Three lookups of -10 each, all applied.
    expect(kernBetween(readGposKerning(gpos!), 1, 2)).toBe(-30);
    expect(result.notes.some((note) => note.startsWith(KERNING_TOO_LARGE))).toBe(false);
  });

  it("keeps the source font's own table on a preserving export", async () => {
    const bytes = new Uint8Array(readFileSync("src/assets/typeforge-sample.ttf"));
    const source = readSfnt(bytes).tables.get("GPOS");
    expect(source).toBeDefined();
    const { typeface } = await importFont(bytes, "sample.ttf");
    const [left, right] = typeface.glyphs.filter((glyph) => glyph.unicodes.length > 0);
    typeface.kerning = [
      ...typeface.kerning,
      ...Array.from(
        { length: 4000 },
        (_, index): KernPair => ({
          left: left.name,
          right: right.name,
          value: -5,
          group: 1000 + index,
        }),
      ),
    ];
    const result = await exportFont(typeface, {
      format: "ttf",
      fidelity: "preserve",
      includeKerning: true,
      now: 0,
    });
    const written = readSfnt(result.bytes).tables.get("GPOS");
    expect(written && [...written]).toEqual([...source!]);
    expect(result.notes).toContain(
      `${KERNING_TOO_LARGE} The source font's positioning table was kept as it arrived: ` +
        "the kerning in the file is the kerning the font came with.",
    );
  });
});

describe("a grid of thousands of rows", () => {
  /**
   * The tallest grid the packer allows, near enough: thirteen thousand left
   * classes of two glyphs each against one right class, `step` apart in glyph
   * ids. Its cells and coverage come to well past what one subtable can
   * address, so it is cut by rows.
   */
  function tallGrid(rows: number, step: number) {
    const classes: ResolvedClassKern[] = [];
    for (let row = 1; row <= rows; row++) {
      const first = row * (step + 1);
      classes.push({ left: [first, first + step], right: [2], value: -((row % 50) + 1) });
    }
    return classes;
  }

  /** How many left classes each grid subtable of the table holds, in order. */
  function rowsPerSubtable(table: Uint8Array): number[] {
    return readGposKerning(table).lookups[0].subtables.map((subtable) =>
      subtable.kind === "grid" ? subtable.left.size : 0,
    );
  }

  it("is cut into subtables in a time that grows with its rows, not their square", () => {
    const classes = tallGrid(13_000, 1);
    const started = performance.now();
    const table = buildGposTable([], classes);
    const took = performance.now() - started;
    expect(table).not.toBeNull();
    const kerning = readGposKerning(table!);
    expect(kerning.lookups[0].subtables.length).toBeGreaterThan(1);
    const wrong = classes.filter((klass) =>
      klass.left.some((glyph) => kernBetween(kerning, glyph, 2) !== klass.value),
    );
    expect(wrong).toEqual([]);
    // Over thirty seconds when each row measured the whole run again; well
    // under one now. The bound leaves room for a busy machine.
    expect(took).toBeLessThan(5000);
  });

  it("fills each subtable to the last row that fits, counting ranges as written", () => {
    /*
     * The right-hand class definition starts after a 16-byte header, the
     * cells (rows + 1 by 2 right classes, two bytes each), the coverage (4 +
     * 2 a glyph) and the left class definition (4 + 6 a range). So k rows of
     * two glyphs reach 28 + 4k + 4k + 6r, where r is the number of ranges.
     *
     * Two consecutive ids make one range a class: 28 + 14k <= 65,535 holds
     * up to k = 4,679. Two ids with a gap make two: 28 + 20k, up to 3,275.
     * Counting a range too many would cut early; one too few would write an
     * offset past the limit, which the writer refuses.
     */
    expect(rowsPerSubtable(buildGposTable([], tallGrid(13_000, 1))!)).toEqual([4679, 4679, 3642]);
    expect(rowsPerSubtable(buildGposTable([], tallGrid(13_000, 2))!)).toEqual([
      3275, 3275, 3275, 3175,
    ]);
  });
});
