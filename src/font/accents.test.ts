import { describe, expect, it } from "vitest";

import { buildAccents, decomposeCodepoint, deriveAnchors, findRecipes, looksLikeMark } from "./accents";
import { dependentsOf, resolveComponents } from "./composite";
import { contoursBounds } from "./geometry";
import { emptyTypeface, type Contour, type Glyph, type Typeface } from "./types";

function glyph(name: string, unicodes: number[], contours: Contour[] = []): Glyph {
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

const box = (x: number, y: number, w: number, h: number): Contour => ({
  closed: true,
  nodes: [
    { point: { x, y }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: x + w, y }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: x + w, y: y + h }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x, y: y + h }, handleIn: null, handleOut: null, type: "corner" },
  ],
});

function font(glyphs: Glyph[]): Typeface {
  const typeface = emptyTypeface();
  typeface.glyphs = glyphs;
  typeface.glyphIndex = new Map(glyphs.map((g, i) => [g.name, i]));
  return typeface;
}

describe("decomposeCodepoint", () => {
  it("reads Unicode's own decomposition rather than a hand-written table", () => {
    expect(decomposeCodepoint(0x00e1)).toEqual({ base: 0x61, marks: [0x0301] }); // á
    expect(decomposeCodepoint(0x00f1)).toEqual({ base: 0x6e, marks: [0x0303] }); // ñ
    expect(decomposeCodepoint(0x00e7)).toEqual({ base: 0x63, marks: [0x0327] }); // ç
  });

  it("returns nothing for a letter that is not composed", () => {
    expect(decomposeCodepoint(0x61)).toBeNull();
  });

  it("handles a letter built from two marks", () => {
    // ế is e + circumflex + acute.
    expect(decomposeCodepoint(0x1ebf)).toEqual({ base: 0x65, marks: [0x0302, 0x0301] });
  });
});

describe("findRecipes", () => {
  it("finds what a font has the parts for", () => {
    const typeface = font([
      glyph("a", [0x61], [box(0, 0, 400, 500)]),
      glyph("acute", [0x0301], [box(0, 600, 120, 150)]),
      glyph("aacute", [0x00e1]),
    ]);
    expect(findRecipes(typeface)).toEqual([{ target: "aacute", base: "a", marks: ["acute"] }]);
  });

  it("skips a letter whose parts are missing", () => {
    const typeface = font([glyph("a", [0x61], [box(0, 0, 400, 500)]), glyph("aacute", [0x00e1])]);
    expect(findRecipes(typeface)).toEqual([]);
  });
});

describe("buildAccents", () => {
  const composed = () =>
    font([
      glyph("a", [0x61], [box(0, 0, 400, 500)]),
      glyph("acute", [0x0301], [box(0, 600, 100, 150)]),
      glyph("aacute", [0x00e1]),
    ]);

  it("builds the accented letter from its parts", () => {
    const typeface = composed();
    const result = buildAccents(typeface);

    expect(result.built).toEqual(["aacute"]);
    const built = typeface.glyphs.find((g) => g.name === "aacute")!;
    expect(built.components.map((c) => c.glyphName)).toEqual(["a", "acute"]);
    expect(built.contours).toEqual([]);
    expect(built.advanceWidth).toBe(500);
  });

  it("centres the mark over the letter", () => {
    const typeface = composed();
    buildAccents(typeface);
    const built = typeface.glyphs.find((g) => g.name === "aacute")!;
    const bounds = contoursBounds(resolveComponents(built, typeface));
    // The letter spans 0..400, so its middle is 200; a 100-wide mark centres there.
    expect((bounds.xMin + bounds.xMax) / 2).toBeCloseTo(200, 0);
  });

  it("leaves a letter that was drawn by hand", () => {
    const typeface = composed();
    const target = typeface.glyphs.find((g) => g.name === "aacute")!;
    target.contours = [box(0, 0, 10, 10)];

    const result = buildAccents(typeface);
    expect(result.built).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ target: "aacute", reason: "drawn by hand" });
  });

  it("leaves a letter that is already composed", () => {
    const typeface = composed();
    buildAccents(typeface);
    const again = buildAccents(typeface);
    expect(again.built).toEqual([]);
    expect(again.skipped[0]).toMatchObject({ reason: "already built" });
  });

  it("puts a mark that hangs below beneath the letter", () => {
    const typeface = font([
      glyph("c", [0x63], [box(0, 0, 400, 500)]),
      glyph("cedilla", [0x0327], [box(0, -200, 100, 200)]),
      glyph("ccedilla", [0x00e7]),
    ]);
    typeface.glyphs[1].anchors = [{ name: "_bottom", x: 50, y: 0 }];
    typeface.glyphs[0].anchors = [{ name: "bottom", x: 200, y: 0 }];

    buildAccents(typeface);
    const built = typeface.glyphs.find((g) => g.name === "ccedilla")!;
    const bounds = contoursBounds(resolveComponents(built, typeface));
    // The cedilla has to end up below the baseline, not above the letter.
    expect(bounds.yMin).toBeLessThan(0);
    expect(bounds.yMax).toBe(500);
  });

  it("uses the dotless form when a mark goes above an i", () => {
    const typeface = font([
      glyph("i", [0x69], [box(0, 0, 100, 500)]),
      glyph("dotlessi", [0x0131], [box(0, 0, 100, 400)]),
      glyph("acute", [0x0301], [box(0, 600, 100, 150)]),
      glyph("iacute", [0x00ed]),
    ]);
    typeface.glyphs[2].anchors = [{ name: "_top", x: 50, y: 600 }];

    buildAccents(typeface);
    const built = typeface.glyphs.find((g) => g.name === "iacute")!;
    expect(built.components[0].glyphName).toBe("dotlessi");
  });
});

describe("anchors", () => {
  it("lines a mark's entry anchor up with the base's", () => {
    const typeface = font([
      glyph("a", [0x61], [box(0, 0, 400, 500)]),
      glyph("acute", [0x0301], [box(0, 600, 100, 150)]),
      glyph("aacute", [0x00e1]),
    ]);
    typeface.glyphs[0].anchors = [{ name: "top", x: 200, y: 520 }];
    typeface.glyphs[1].anchors = [{ name: "_top", x: 50, y: 600 }];

    buildAccents(typeface);
    const mark = typeface.glyphs.find((g) => g.name === "aacute")!.components[1];
    // The mark moves so its own anchor lands on the letter's.
    expect(mark.transform.dx).toBe(150);
    expect(mark.transform.dy).toBe(-80);
  });

  it("reads anchor positions back out of composites a font already has", () => {
    const typeface = font([
      glyph("a", [0x61], [box(0, 0, 400, 500)]),
      glyph("acute", [0x0301], [box(0, 600, 100, 150)]),
      glyph("aacute", [0x00e1]),
    ]);
    typeface.glyphs[2].components = [
      { glyphName: "a", transform: { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 } },
      { glyphName: "acute", transform: { a: 1, b: 0, c: 0, d: 1, dx: 150, dy: -80 } },
    ];

    const derived = deriveAnchors(typeface);
    expect(derived.bases).toBe(1);
    expect(derived.marks).toBe(1);
    expect(typeface.glyphs[0].anchors).toContainEqual({ name: "top", x: 200, y: 520 });
    expect(typeface.glyphs[1].anchors).toContainEqual({ name: "_top", x: 50, y: 600 });
  });
});

describe("looksLikeMark", () => {
  it("recognises a combining codepoint", () => {
    expect(looksLikeMark(glyph("acutecomb", [0x0301]))).toBe(true);
  });
  it("recognises the older spacing forms by name", () => {
    expect(looksLikeMark(glyph("cedilla", [0x00b8]))).toBe(true);
  });
  it("does not mistake a letter for a mark", () => {
    expect(looksLikeMark(glyph("a", [0x61]))).toBe(false);
  });
});

describe("dependents", () => {
  it("names every glyph that would change if a letter were edited", () => {
    const typeface = font([
      glyph("a", [0x61], [box(0, 0, 400, 500)]),
      glyph("acute", [0x0301], [box(0, 600, 100, 150)]),
      glyph("aacute", [0x00e1]),
      glyph("agrave", [0x00e0]),
    ]);
    for (const name of ["aacute", "agrave"]) {
      typeface.glyphs.find((g) => g.name === name)!.components = [
        { glyphName: "a", transform: { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 } },
      ];
    }
    expect(dependentsOf(typeface, "a").sort()).toEqual(["aacute", "agrave"]);
  });
});
