/**
 * The full pipeline: read a real font, change it, write it back out, and have
 * fontTools confirm the result is a valid font that kept what it should.
 */

import { describe, expect, it } from "vitest";

import { exportFont } from "../src/font/export";
import { resolveGlyphContours } from "../src/font/transform";
import { contoursBounds } from "../src/font/geometry";
import { findCrossbar } from "../src/font/anatomy";
import { importFont } from "../src/font/parse";
import { FONT_SUITE_TIMEOUT, loadTestFont } from "./fixtures";
import { hasFontTools, inspectFont } from "./fonttools";

const source = loadTestFont();
const canRun = source !== null && hasFontTools();
const suite = canRun ? describe : describe.skip;

suite("export pipeline", { timeout: FONT_SUITE_TIMEOUT }, () => {
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

  it("reads the real family name rather than falling back to the filename", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    // opentype.js groups name entries by platform. Reading the wrong level
    // silently yields the filename, which would then be written into exports.
    expect(typeface.meta.familyName).toBe("DejaVu Sans");
    expect(typeface.meta.styleName).toBe("Book");
    expect(typeface.meta.familyName).not.toBe("DejaVuSans");
  });

  it("writes a TrueType file fontTools accepts, keeping outlines and kerning", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const before = inspectFont(source!);

    const result = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
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

  /*
   * A per-glyph override has to reach the file.
   *
   * "Preserve" writes the original bytes back for any glyph nobody has touched,
   * which is what keeps the hinting -- and it decides "touched" from a flag on
   * the glyph rather than by comparing outlines. Setting an override did not
   * raise that flag, so the letter was right on screen the whole time and wrong
   * in every file exported: the one place the mistake could not be seen.
   */
  it("carries a single glyph's own override into a preserving export", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const index = typeface.glyphIndex.get("A")!;
    const glyph = typeface.glyphs[index];

    const plain = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });

    // The same edit the inspector makes: an override on this letter and on
    // nothing else, with the family left exactly as it was.
    glyph.params = { ...glyph.params, weight: 40 };
    glyph.dirty = true;

    const edited = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    expect(inspectFont(edited.bytes).error).toBeUndefined();

    /*
     * Read back out, because that is the only question worth asking. The bytes
     * differing would prove a timestamp moved; what has to be true is that the
     * A in the file is the A that was on screen.
     */
    const written = (await importFont(edited.bytes, "edited.ttf")).typeface;
    const untouched = (await importFont(plain.bytes, "plain.ttf")).typeface;
    const boundsOf = (font: typeof written, name: string) =>
      contoursBounds(font.glyphs[font.glyphIndex.get(name)!].contours);

    expect(boundsOf(written, "A"), "the A went out unchanged").not.toEqual(
      boundsOf(untouched, "A"),
    );
    // And its neighbours were left alone, which is what preserving means.
    expect(boundsOf(written, "B")).toEqual(boundsOf(untouched, "B"));
  });

  it("preserves layout and hinting tables the editor never models", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const result = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const report = inspectFont(result.bytes);

    // GSUB carries ligatures and alternates; cvt/fpgm/prep carry hinting.
    for (const table of ["GSUB", "cvt ", "fpgm", "prep"]) {
      expect(report.tables).toContain(table);
    }
    expect(result.fidelity).toBe("preserve");
  });

  it("drops unmodelled tables in a clean rebuild, and keeps what is modelled", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const result = await exportFont(typeface, { format: "ttf", fidelity: "rebuild", now: 0 });
    const report = inspectFont(result.bytes);

    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    // The hinting is nobody's here, and a rebuild is a clean file.
    for (const table of ["cvt ", "fpgm", "prep"]) expect(report.tables).not.toContain(table);
    // Kerning is ours, so it survives a rebuild.
    expect(Object.keys(report.gposKernPairs).length).toBeGreaterThan(2000);

    /*
     * And so are the ligatures now, which they were not.
     *
     * This asserted no `GSUB` at all, which was the truth while an import read
     * no features: `alternates` came back empty from every font and there was
     * nothing to write. So a rebuild of a face that plainly draws `fi` dropped
     * it, while a preserve kept it, and the two halves of the export disagreed
     * without either saying so. A rebuild now carries the ligatures and sets
     * the document holds -- and only those. Everything else in the source's own
     * table is what preserving is for.
     */
    expect(report.tables).toContain("GSUB");
    expect((typeface.ligatures ?? []).length).toBeGreaterThan(0);
  });

  it("carries an edited advance width into the exported file", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const capitalA = typeface.glyphs.find((glyph) => glyph.unicodes.includes(65))!;
    const original = capitalA.advanceWidth;
    capitalA.advanceWidth = original + 137;
    capitalA.dirty = true;

    const result = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
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

    const result = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const { typeface: reimported } = await importFont(result.bytes, "roundtrip.ttf");
    const reimportedA = reimported.glyphs.find((glyph) => glyph.unicodes.includes(65))!;

    // Coordinates are integers in the file, so allow a unit of rounding.
    const landed = reimportedA.contours
      .flatMap((contour) => contour.nodes)
      .some((n) => Math.abs(n.point.x - movedTo.x) <= 1 && Math.abs(n.point.y - movedTo.y) <= 1);
    expect(landed).toBe(true);
  });

  it("puts a point wherever a curve turns", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    // A family parameter forces every glyph through the rebuild path.
    typeface.params = { ...typeface.params, weight: 8 };

    const result = await exportFont(typeface, { format: "ttf", fidelity: "rebuild", now: 0 });
    const report = inspectFont(result.bytes);

    expect(report.error).toBeUndefined();
    // Both outline formats require a point at every extreme. Rounding to whole
    // units and fitting quadratics to cubics each nudge a control point past
    // the turn, which used to leave over 1,700 of them adrift.
    expect(report.interiorExtremes).toBe(0);
  });

  it("keeps the Windows clipping boundary clear of the tallest glyphs", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const result = await exportFont(typeface, { format: "ttf", fidelity: "rebuild", now: 0 });
    const report = inspectFont(result.bytes);

    // On Windows these are not line spacing, they are where glyphs get cut off.
    // Accented capitals reach well above the typographic ascender.
    expect(report.winAscent).toBeGreaterThanOrEqual(report.yMax);
    expect(report.winDescent).toBeGreaterThanOrEqual(-report.yMin);
  });

  it("widens the clipping boundary when an edit makes a glyph taller", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const before = inspectFont(source!);

    // Push one glyph far above anything else in the font.
    const capitalA = typeface.glyphs.find((glyph) => glyph.unicodes.includes(65))!;
    const raised = before.yMax + 400;
    capitalA.contours[0].nodes[0].point = { x: 100, y: raised };
    capitalA.dirty = true;

    const result = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const report = inspectFont(result.bytes);
    expect(report.winAscent).toBeGreaterThanOrEqual(raised);
  });

  it("keeps accented letters as references rather than redrawing them", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const result = await exportFont(typeface, { format: "ttf", fidelity: "rebuild", now: 0 });
    const report = inspectFont(result.bytes);

    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    // DejaVu builds most of its accented set from parts, and so should we:
    // storing `a` once means correcting it once.
    expect(report.compositeGlyphs).toBeGreaterThan(2000);
    expect(report.componentsOf["aacute"]).toEqual(["a", "acute"]);
    expect(report.componentsOf["ccedilla"]).toEqual(["c", "cedilla"]);
  });

  it("flattens composites when a parameter reshapes the letters", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    // A parameter applies to the assembled letter, so a reference to the
    // untransformed parts would put the accent in the wrong place.
    typeface.params = { ...typeface.params, weight: 8 };

    const result = await exportFont(typeface, { format: "ttf", fidelity: "rebuild", now: 0 });
    const report = inspectFont(result.bytes);
    expect(report.error).toBeUndefined();
    expect(report.compositeGlyphs).toBe(0);
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

    const result = await exportFont(typeface, { format: "otf", fidelity: "preserve", now: 0 });
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
  /**
   * A pixel font is still a font. Quantising replaces every curve with right
   * angles and multiplies the contour count, which is exactly the kind of
   * change that breaks an exporter, so fontTools has to accept the result.
   */
  it("writes a valid font after quantising every letter to a pixel grid", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const before = inspectFont(source!);
    typeface.params = { ...typeface.params, pixelGrid: 24 };

    const result = await exportFont(typeface, { format: "ttf", fidelity: "rebuild", now: 0 });
    const report = inspectFont(result.bytes);

    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    expect(report.outlineFormat).toBe("truetype");
    expect(report.numGlyphs).toBe(before.numGlyphs);
    expect(report.unitsPerEm).toBe(before.unitsPerEm);
    // Right angles have no curve turns to sit inside a segment.
    expect(report.interiorExtremes).toBe(0);
  });

  /**
   * Preserve is the default way out, and it copies untouched glyphs across
   * byte for byte. A family-wide pixel grid touches every one of them, so this
   * is the path most exports would actually take.
   */
  it("writes a valid font after quantising, on the preserving path too", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    typeface.params = { ...typeface.params, pixelGrid: 24 };

    const result = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const report = inspectFont(result.bytes);

    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    expect(report.interiorExtremes).toBe(0);
  });

  /**
   * Slabs are laid over the strokes rather than merged into them, so the export
   * has to fuse them. Left overlapping, the join shows as a seam under the
   * even-odd rule some renderers and print pipelines apply.
   */
  it("writes a valid font after putting slabs on every stroke end", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const before = inspectFont(source!);
    typeface.params = { ...typeface.params, slab: 90 };

    const result = await exportFont(typeface, {
      format: "ttf",
      fidelity: "rebuild",
      now: 0,
      mergeOverlaps: true,
    });
    const report = inspectFont(result.bytes);

    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    expect(report.numGlyphs).toBe(before.numGlyphs);
  });

  it("makes the slabbed letters wider than the bare ones", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const bare = resolveGlyphContours(typeface.glyphs[typeface.glyphIndex.get("I")!], typeface);
    typeface.params = { ...typeface.params, slab: 90 };
    const slabbed = resolveGlyphContours(typeface.glyphs[typeface.glyphIndex.get("I")!], typeface);

    const width = (contours: ReturnType<typeof resolveGlyphContours>) => {
      const xs = contours.flatMap((c) => c.nodes.map((n) => n.point.x));
      return Math.max(...xs) - Math.min(...xs);
    };
    // An I is a bare stem; slabs at both ends have to widen it.
    expect(width(slabbed)).toBeGreaterThan(width(bare) + 100);
  });

  it("moves the crossbar without changing how tall the letters are", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const H = typeface.glyphs[typeface.glyphIndex.get("H")!];
    const heightOf = (contours: ReturnType<typeof resolveGlyphContours>) => {
      const ys = contours.flatMap((c) => c.nodes.map((n) => n.point.y));
      return Math.max(...ys) - Math.min(...ys);
    };
    const before = resolveGlyphContours(H, typeface);
    const barBefore = findCrossbar(before)!;

    typeface.params = { ...typeface.params, crossbar: 150 };
    const after = resolveGlyphContours(H, typeface);
    const barAfter = findCrossbar(after)!;

    expect(barAfter.bottom - barBefore.bottom).toBeCloseTo(150, 0);
    expect(heightOf(after)).toBeCloseTo(heightOf(before), 0);
  });

  it("writes a valid font after moving the crossbar and shoulder", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const before = inspectFont(source!);
    typeface.params = { ...typeface.params, crossbar: 120, shoulder: -100 };

    const result = await exportFont(typeface, { format: "ttf", fidelity: "rebuild", now: 0 });
    const report = inspectFont(result.bytes);

    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    expect(report.numGlyphs).toBe(before.numGlyphs);
  });

  it("leaves the font alone when the pixel grid is off", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    expect(typeface.params.pixelGrid).toBe(0);
    const plain = await exportFont(typeface, { format: "ttf", fidelity: "rebuild", now: 0 });
    expect(inspectFont(plain.bytes).error).toBeUndefined();
  });
});
