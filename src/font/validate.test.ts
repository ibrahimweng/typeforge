import { describe, expect, it } from "vitest";

import { emptyTypeface, type Contour, type Glyph, type Typeface } from "./types";
import { validateTypeface } from "./validate";

function glyph(name: string, contours: Contour[] = [], unicodes: number[] = []): Glyph {
  return {
    name,
    unicodes,
    advanceWidth: 500,
    contours,
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

const square = (size = 100): Contour => ({
  closed: true,
  nodes: [
    { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: size, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: size, y: size }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 0, y: size }, handleIn: null, handleOut: null, type: "corner" },
  ],
});

function font(glyphs: Glyph[]): Typeface {
  const typeface = emptyTypeface();
  typeface.meta.familyName = "Test";
  typeface.glyphs = glyphs;
  typeface.glyphIndex = new Map(glyphs.map((g, i) => [g.name, i]));
  return typeface;
}

const has = (typeface: Typeface, check: string): boolean =>
  validateTypeface(typeface).findings.some((f) => f.check === check);

describe("font structure", () => {
  it("wants a .notdef glyph", () => {
    expect(has(font([glyph("A", [square()])]), "notdef-missing")).toBe(true);
    expect(has(font([glyph(".notdef"), glyph("A", [square()])]), "notdef-missing")).toBe(false);
  });

  it("wants .notdef first", () => {
    expect(has(font([glyph("A", [square()]), glyph(".notdef")]), "notdef-position")).toBe(true);
  });

  it("catches a codepoint claimed by two glyphs", () => {
    const typeface = font([glyph(".notdef"), glyph("A", [square()], [65]), glyph("A.alt", [square()], [65])]);
    expect(has(typeface, "duplicate-codepoints")).toBe(true);
  });

  it("accepts a sound font quietly", () => {
    const typeface = font([glyph(".notdef"), glyph("A", [square()], [65])]);
    const report = validateTypeface(typeface);
    expect(report.errors).toBe(0);
  });
});

describe("vertical metrics", () => {
  it("catches a positive descender", () => {
    const typeface = font([glyph(".notdef")]);
    typeface.metrics.descender = 200;
    expect(has(typeface, "descender-sign")).toBe(true);
  });

  it("notes a non-zero line gap", () => {
    const typeface = font([glyph(".notdef")]);
    typeface.metrics.lineGap = 120;
    expect(has(typeface, "line-gap")).toBe(true);
  });

  it("notices lowercase taller than capitals", () => {
    const typeface = font([glyph(".notdef")]);
    typeface.metrics.xHeight = 800;
    typeface.metrics.capHeight = 700;
    expect(has(typeface, "x-height-above-cap")).toBe(true);
  });
});

describe("glyph outlines", () => {
  it("catches a contour that encloses nothing", () => {
    const stray: Contour = {
      closed: true,
      nodes: [{ point: { x: 10, y: 10 }, handleIn: null, handleOut: null, type: "corner" }],
    };
    expect(has(font([glyph(".notdef"), glyph("A", [stray])]), "stray-points")).toBe(true);
  });

  it("does not mistake a two-node ellipse for a stray point", () => {
    // A circle drawn as two nodes with handles is a normal, valid contour.
    const ellipse: Contour = {
      closed: true,
      nodes: [
        { point: { x: 0, y: 50 }, handleIn: { x: 0, y: 78 }, handleOut: { x: 0, y: 22 }, type: "smooth" },
        { point: { x: 100, y: 50 }, handleIn: { x: 100, y: 22 }, handleOut: { x: 100, y: 78 }, type: "smooth" },
      ],
    };
    expect(has(font([glyph(".notdef"), glyph("o", [ellipse])]), "stray-points")).toBe(false);
  });

  it("catches an unclosed contour", () => {
    const open: Contour = { ...square(), closed: false };
    expect(has(font([glyph(".notdef"), glyph("A", [open])]), "open-contour")).toBe(true);
  });

  it("catches a negative advance width", () => {
    const g = glyph("A", [square()]);
    g.advanceWidth = -10;
    expect(has(font([glyph(".notdef"), g]), "negative-advance")).toBe(true);
  });

  it("catches two points in the same place", () => {
    const doubled: Contour = {
      closed: true,
      nodes: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 100, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 100, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 50, y: 90 }, handleIn: null, handleOut: null, type: "corner" },
      ],
    };
    expect(has(font([glyph(".notdef"), glyph("A", [doubled])]), "duplicate-points")).toBe(true);
  });

  it("counts errors and warnings separately", () => {
    const g = glyph("A", [square()]);
    g.advanceWidth = -10;
    const report = validateTypeface(font([g])); // no .notdef either
    expect(report.errors).toBeGreaterThanOrEqual(2);
    expect(report.findings.every((f) => f.title.length > 0 && f.detail.length > 0)).toBe(true);
  });
});

describe("a font drawn on top of somebody else's", () => {
  /*
   * The one finding here that is about a licence rather than about a file
   * working. An exported font carries the family name, designer, copyright
   * and licence of whatever it was opened from, and until this check existed
   * nothing in the application ever said so.
   */
  const opened = (dirty: boolean): Typeface => {
    const one = glyph("A", [square()]);
    one.dirty = dirty;
    const typeface = font([glyph(".notdef", [square()]), one]);
    typeface.meta.familyName = "Somebody Else Sans";
    // Only its presence matters here: the check asks whether the font came
    // from a file, not what was in it.
    typeface.source = {
      bytes: new Uint8Array(0),
      sfntVersion: 0x00010000,
      tables: new Map(),
      isCFF: false,
      fileName: "SomebodyElseSans.ttf",
    };
    return typeface;
  };

  it("says so once a letter has been changed", () => {
    expect(has(opened(true), "derivative-unnamed")).toBe(true);
  });

  it("says nothing about a font that is only being looked at", () => {
    // Opening somebody's font to read it is not a licensing question.
    expect(has(opened(false), "derivative-unnamed")).toBe(false);
  });

  it("says nothing about a font that came from nowhere", () => {
    const one = glyph("A", [square()]);
    one.dirty = true;
    expect(has(font([glyph(".notdef", [square()]), one]), "derivative-unnamed")).toBe(false);
  });
});
