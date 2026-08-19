/**
 * The full pipeline: read a real font, change it, write it back out, and have
 * fontTools confirm the result is a valid font that kept what it should.
 */

import { describe, expect, it } from "vitest";

import { exportFont } from "../src/font/export";
import { importFont } from "../src/font/parse";
import { loadTestFont } from "./fixtures";
import { hasFontTools, inspectFont } from "./fonttools";

const source = loadTestFont();
const canRun = source !== null && hasFontTools();
const suite = canRun ? describe : describe.skip;

suite("export pipeline", () => {
  it("imports a real font into the document model", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    expect(typeface.glyphs.length).toBeGreaterThan(1000);
    expect(typeface.unitsPerEm).toBe(2048);
    expect(typeface.kerning.length).toBeGreaterThan(2000);

    const capitalA = typeface.glyphs.find((glyph) => glyph.unicodes.includes(65));
    expect(capitalA).toBeDefined();
    expect(capitalA!.contours.length).toBeGreaterThan(0);
    expect(capitalA!.advanceWidth).toBeGreaterThan(0);
  });

  it("writes a TrueType file fontTools accepts, keeping outlines and kerning", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const before = inspectFont(source!);

    const result = exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const report = inspectFont(result.bytes);

    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    expect(report.outlineFormat).toBe("truetype");
    expect(report.numGlyphs).toBe(before.numGlyphs);
    expect(report.unitsPerEm).toBe(before.unitsPerEm);
    expect(report.tables).toContain("glyf");
    expect(report.tables).toContain("loca");

    // The kerning the source font carried has to survive the round trip. This
    // is exactly what both font libraries lose on their own.
    expect(Object.keys(report.gposKernPairs).length).toBeGreaterThan(2000);
    expect(report.gposKernPairs["A,V"]).toBe(-131);
  });

  it("preserves layout and hinting tables the editor never models", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const result = exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const report = inspectFont(result.bytes);

    // GSUB carries ligatures and alternates; cvt/fpgm/prep carry hinting.
    for (const table of ["GSUB", "cvt ", "fpgm", "prep"]) {
      expect(report.tables).toContain(table);
    }
    expect(result.fidelity).toBe("preserve");
  });

  it("drops unmodelled tables in a clean rebuild, as documented", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const result = exportFont(typeface, { format: "ttf", fidelity: "rebuild", now: 0 });
    const report = inspectFont(result.bytes);

    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    expect(report.tables).not.toContain("GSUB");
    // Kerning is ours, so it survives a rebuild even though GSUB does not.
    expect(Object.keys(report.gposKernPairs).length).toBeGreaterThan(2000);
  });

  it("carries an edited advance width into the exported file", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const capitalA = typeface.glyphs.find((glyph) => glyph.unicodes.includes(65))!;
    const original = capitalA.advanceWidth;
    capitalA.advanceWidth = original + 137;
    capitalA.dirty = true;

    const result = exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const { typeface: reimported } = await importFont(result.bytes, "roundtrip.ttf");
    const reimportedA = reimported.glyphs.find((glyph) => glyph.unicodes.includes(65))!;
    expect(reimportedA.advanceWidth).toBe(original + 137);
  });

  it("survives a moved outline point through the quadratic conversion", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const capitalA = typeface.glyphs.find((glyph) => glyph.unicodes.includes(65))!;
    const node = capitalA.contours[0].nodes[0];
    const movedTo = { x: node.point.x + 200, y: node.point.y + 150 };
    node.point = { ...movedTo };
    capitalA.dirty = true;

    const result = exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const { typeface: reimported } = await importFont(result.bytes, "roundtrip.ttf");
    const reimportedA = reimported.glyphs.find((glyph) => glyph.unicodes.includes(65))!;

    // Coordinates are integers in the file, so allow a unit of rounding.
    const landed = reimportedA.contours
      .flatMap((contour) => contour.nodes)
      .some((n) => Math.abs(n.point.x - movedTo.x) <= 1 && Math.abs(n.point.y - movedTo.y) <= 1);
    expect(landed).toBe(true);
  });

  it("writes an OpenType file with PostScript curves and kerning intact", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    // Keep the export quick: CFF encoding of 6000 glyphs is not what is under test.
    typeface.glyphs = typeface.glyphs.slice(0, 300);
    typeface.glyphIndex = new Map(typeface.glyphs.map((glyph, index) => [glyph.name, index]));
    const names = new Set(typeface.glyphs.map((glyph) => glyph.name));
    typeface.kerning = typeface.kerning.filter(
      (pair) => names.has(pair.left) && names.has(pair.right),
    );

    const result = exportFont(typeface, { format: "otf", fidelity: "preserve", now: 0 });
    const report = inspectFont(result.bytes);

    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    expect(report.outlineFormat).toBe("cff");
    expect(report.tables).toContain("CFF ");
    expect(Object.keys(report.gposKernPairs).length).toBeGreaterThan(0);
    // Asking for OpenType always rebuilds, and the result says so.
    expect(result.fidelity).toBe("rebuild");
    expect(result.fileName.endsWith(".otf")).toBe(true);
  });
});
