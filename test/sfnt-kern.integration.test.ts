/**
 * End-to-end check that the tables we write are readable by fontTools, the
 * reference implementation. This is the test that stands behind the claim that
 * an exported font really carries its kerning.
 */

import { describe, expect, it } from "vitest";

import { buildGposTable, buildKernTable } from "../src/font/kern";
import { readSfnt, writeSfnt } from "../src/font/sfnt";
import { loadTestFont } from "./fixtures";
import { hasFontTools, inspectFont } from "./fonttools";

const source = loadTestFont();
const canRun = source !== null && hasFontTools();
const suite = canRun ? describe : describe.skip;

suite("sfnt round trip with injected kerning", () => {
  it("rewrites a real font without disturbing it", () => {
    const font = readSfnt(source!);
    const before = inspectFont(source!);
    const after = inspectFont(writeSfnt(font));

    expect(after.error).toBeUndefined();
    expect(after.recompiles).toBe(true);
    expect(after.numGlyphs).toBe(before.numGlyphs);
    expect(after.unitsPerEm).toBe(before.unitsPerEm);
    expect(after.tables).toEqual(before.tables);
  });

  it("carries individual pairs through both kern and GPOS", () => {
    const font = readSfnt(source!);
    // Glyph ids for A, V, W, T, o in DejaVu Sans.
    const pairs = [
      { left: 36, right: 57, value: -120 },
      { left: 36, right: 58, value: -90 },
      { left: 55, right: 82, value: -140 },
    ];
    font.tables.set("kern", buildKernTable(pairs)!);
    font.tables.set("GPOS", buildGposTable(pairs)!);

    const report = inspectFont(writeSfnt(font));
    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    expect(report.tables).toContain("kern");
    expect(report.tables).toContain("GPOS");

    // fontTools reports pairs by glyph name, which is the real check: the ids
    // we wrote have to resolve to the letters we meant.
    expect(report.kernPairs).toMatchObject({ "A,V": -120, "A,W": -90, "T,o": -140 });
    expect(report.gposKernPairs).toMatchObject({ "A,V": -120, "A,W": -90, "T,o": -140 });
  });

  it("expresses class kerning as a GPOS format 2 subtable", () => {
    const font = readSfnt(source!);
    // Every glyph in the left class kerns against every glyph in the right one.
    font.tables.set(
      "GPOS",
      buildGposTable([], [{ left: [55, 56], right: [82, 72], value: -75 }])!,
    );

    const report = inspectFont(writeSfnt(font));
    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    expect(report.gposKernPairs).toMatchObject({
      "T,o": -75,
      "T,e": -75,
      "U,o": -75,
      "U,e": -75,
    });
  });

  it("lets an individual pair override the class value it falls under", () => {
    const font = readSfnt(source!);
    font.tables.set(
      "GPOS",
      buildGposTable(
        [{ left: 55, right: 82, value: -200 }],
        [{ left: [55, 56], right: [82, 72], value: -75 }],
      )!,
    );

    const report = inspectFont(writeSfnt(font));
    expect(report.error).toBeUndefined();
    // The format 1 subtable is listed first, so its value is the one that wins.
    expect(report.gposKernPairs["T,o"]).toBe(-200);
    expect(report.gposKernPairs["U,e"]).toBe(-75);
  });
});
