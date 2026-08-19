import { beforeEach, describe, expect, it } from "vitest";

import { emptyTypeface, type Glyph } from "@/font/types";
import { store } from "./store";

function glyph(name: string): Glyph {
  return {
    name,
    unicodes: [],
    advanceWidth: 500,
    contours: [],
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

/** Put a small typeface into the store without going through file parsing. */
function seed(names: string[]): void {
  const typeface = emptyTypeface();
  typeface.glyphs = names.map(glyph);
  typeface.glyphIndex = new Map(typeface.glyphs.map((g, index) => [g.name, index]));
  store.startBlank();
  Object.assign(store.getSnapshot().typeface!, typeface);
}

describe("kerning resolution", () => {
  beforeEach(() => seed(["T", "U", "o", "e"]));

  it("reports nothing for a pair with no kerning", () => {
    expect(store.resolvedKerning("T", "o")).toEqual({ value: 0, source: "none" });
  });

  it("reports an individual pair", () => {
    store.setKerning("T", "o", -140);
    expect(store.resolvedKerning("T", "o")).toEqual({ value: -140, source: "pair" });
  });

  it("applies a class to every combination it covers", () => {
    store.addKernClass("T", "o", -75);
    store.updateKernClass(store.getSnapshot().typeface!.kernClasses[0].id, {
      left: ["T", "U"],
      right: ["o", "e"],
    });
    for (const [left, right] of [
      ["T", "o"],
      ["T", "e"],
      ["U", "o"],
      ["U", "e"],
    ]) {
      expect(store.resolvedKerning(left, right)).toEqual({ value: -75, source: "class" });
    }
  });

  it("lets an individual pair override the class it falls under", () => {
    store.addKernClass("T", "o", -75);
    store.updateKernClass(store.getSnapshot().typeface!.kernClasses[0].id, {
      left: ["T", "U"],
      right: ["o", "e"],
    });
    store.setKerning("T", "o", -200);

    // This mirrors GPOS, where the individual subtable is listed first.
    expect(store.resolvedKerning("T", "o")).toEqual({ value: -200, source: "pair" });
    expect(store.resolvedKerning("U", "e")).toEqual({ value: -75, source: "class" });
  });

  it("undoes a class back out again", () => {
    store.addKernClass("T", "o", -75);
    expect(store.getSnapshot().typeface!.kernClasses).toHaveLength(1);
    store.undo();
    expect(store.getSnapshot().typeface!.kernClasses).toHaveLength(0);
    store.redo();
    expect(store.getSnapshot().typeface!.kernClasses).toHaveLength(1);
  });
});

describe("glyph editing", () => {
  beforeEach(() => seed(["A", "B"]));

  it("records an edit and takes it back", () => {
    store.editGlyph("A", "Set advance width", (target) => {
      target.advanceWidth = 720;
    });
    expect(store.glyph("A")!.advanceWidth).toBe(720);
    expect(store.glyph("A")!.dirty).toBe(true);

    store.undo();
    expect(store.glyph("A")!.advanceWidth).toBe(500);
    store.redo();
    expect(store.glyph("A")!.advanceWidth).toBe(720);
  });

  it("commits a whole drag as one step rather than one per frame", () => {
    const before = store.snapshotGlyph("A")!;
    for (const width of [520, 540, 560, 580]) {
      store.editGlyphLive("A", (target) => {
        target.advanceWidth = width;
      });
    }
    store.commitGlyphEdit("A", "Move points", before);

    // One undo returns to the start, not to the last intermediate value.
    store.undo();
    expect(store.glyph("A")!.advanceWidth).toBe(500);
  });
});

describe("editing a control letter carries the family", () => {
  /** A closed rectangle, wound clockwise as a real font outline is. */
  function bar(x: number, y: number, width: number, height: number) {
    const points = [
      { x, y },
      { x, y: y + height },
      { x: x + width, y: y + height },
      { x: x + width, y },
    ];
    return {
      closed: true,
      nodes: points.map((point) => ({
        point,
        handleIn: null,
        handleOut: null,
        type: "corner" as const,
      })),
    };
  }

  function seedWithOutlines(): void {
    seed(["n", "o", "p", "H"]);
    const typeface = store.getSnapshot().typeface!;
    // Each letter stands in its own place. Giving them identical outlines would
    // make every one of them a point-for-point copy of n, and so a shape
    // follower, which is not what these tests are about.
    const at: Record<string, number> = { n: 100, o: 400, p: 700, H: 1000 };
    for (const name of ["n", "o", "p", "H"]) {
      const index = typeface.glyphIndex.get(name)!;
      typeface.glyphs[index].contours = [bar(at[name], 0, 180, 1100)];
      typeface.glyphs[index].advanceWidth = 600;
    }
    store.captureControlBaseline();
  }

  beforeEach(seedWithOutlines);

  it("thickens every other letter when n is thickened", () => {
    const typeface = store.getSnapshot().typeface!;
    const before = store.paramsFor("p").weight;

    const snapshot = store.snapshotGlyph("n")!;
    const index = typeface.glyphIndex.get("n")!;
    typeface.glyphs[index].contours = [bar(90, 0, 220, 1100)];
    store.commitGlyphEdit("n", "Thicken n", snapshot);

    // p was never touched, but it has to follow the letter that sets the stem.
    expect(store.paramsFor("p").weight).not.toBe(before);
    expect(store.getSnapshot().lastDerivation.some((c) => c.quality === "stem")).toBe(true);
  });

  it("leaves the edited letter exactly as drawn rather than weighting it twice", () => {
    const typeface = store.getSnapshot().typeface!;
    const snapshot = store.snapshotGlyph("n")!;
    const index = typeface.glyphIndex.get("n")!;
    typeface.glyphs[index].contours = [bar(90, 0, 220, 1100)];
    store.commitGlyphEdit("n", "Thicken n", snapshot);

    expect(store.paramsFor("n").weight).toBe(0);
  });

  it("puts the font back where it was on undo", () => {
    const typeface = store.getSnapshot().typeface!;
    const before = store.paramsFor("p").weight;

    const snapshot = store.snapshotGlyph("n")!;
    const index = typeface.glyphIndex.get("n")!;
    typeface.glyphs[index].contours = [bar(90, 0, 220, 1100)];
    store.commitGlyphEdit("n", "Thicken n", snapshot);
    expect(store.paramsFor("p").weight).not.toBe(before);

    store.undo();
    expect(store.paramsFor("p").weight).toBe(before);
  });

  it("does not move the family when an ordinary letter is edited", () => {
    const typeface = store.getSnapshot().typeface!;
    const before = store.paramsFor("H").weight;

    const snapshot = store.snapshotGlyph("p")!;
    const index = typeface.glyphIndex.get("p")!;
    typeface.glyphs[index].contours = [bar(90, 0, 220, 1100)];
    store.commitGlyphEdit("p", "Thicken p", snapshot);

    expect(store.paramsFor("H").weight).toBe(before);
    expect(store.getSnapshot().lastDerivation).toEqual([]);
  });
});

describe("letters built on a control letter follow its shape", () => {
  function poly(points: Array<{ x: number; y: number }>) {
    return {
      closed: true,
      nodes: points.map((point) => ({
        point,
        handleIn: null,
        handleOut: null,
        type: "corner" as const,
      })),
    };
  }

  /** n and h share three points; h's fourth is its own taller stem. */
  const SHARED = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 1100 },
  ];

  function seedLinked(): void {
    seed(["n", "h", "z"]);
    const typeface = store.getSnapshot().typeface!;
    typeface.glyphs[typeface.glyphIndex.get("n")!].contours = [
      poly([...SHARED, { x: 0, y: 1100 }]),
    ];
    typeface.glyphs[typeface.glyphIndex.get("h")!].contours = [
      poly([...SHARED, { x: 0, y: 1550 }]),
    ];
    // Unrelated letter, standing nowhere near the others.
    typeface.glyphs[typeface.glyphIndex.get("z")!].contours = [
      poly([
        { x: 800, y: 0 },
        { x: 980, y: 0 },
        { x: 980, y: 900 },
        { x: 800, y: 900 },
      ]),
    ];
    store.captureControlBaseline();
  }

  beforeEach(seedLinked);

  it("knows which letters are built on n", () => {
    expect(store.followersOf("n")).toEqual(["h"]);
  });

  it("moves h's point when the point it shares with n moves", () => {
    const typeface = store.getSnapshot().typeface!;
    const snapshot = store.snapshotGlyph("n")!;
    const n = typeface.glyphs[typeface.glyphIndex.get("n")!];
    n.contours[0].nodes[2].point = { x: 260, y: 1180 };
    store.commitGlyphEdit("n", "Reshape n", snapshot);

    const h = typeface.glyphs[typeface.glyphIndex.get("h")!];
    expect(h.contours[0].nodes[2].point).toEqual({ x: 260, y: 1180 });
  });

  it("leaves h's own taller stem alone", () => {
    const typeface = store.getSnapshot().typeface!;
    const snapshot = store.snapshotGlyph("n")!;
    const n = typeface.glyphs[typeface.glyphIndex.get("n")!];
    n.contours[0].nodes[3].point = { x: 0, y: 1300 };
    store.commitGlyphEdit("n", "Raise n's stem", snapshot);

    const h = typeface.glyphs[typeface.glyphIndex.get("h")!];
    expect(h.contours[0].nodes[3].point).toEqual({ x: 0, y: 1550 });
  });

  /**
   * A letter that took the edit point for point must not then take the
   * parametric version of the same edit on top of it.
   */
  it("holds a shape follower at neutral parameters so the edit lands once", () => {
    const typeface = store.getSnapshot().typeface!;
    const snapshot = store.snapshotGlyph("n")!;
    const n = typeface.glyphs[typeface.glyphIndex.get("n")!];
    n.contours[0].nodes[1].point = { x: 240, y: 0 };
    n.contours[0].nodes[2].point = { x: 240, y: 1100 };
    store.commitGlyphEdit("n", "Thicken n", snapshot);

    expect(store.paramsFor("h").weight).toBe(0);
    // z shares nothing, so it follows the family instead.
    expect(store.paramsFor("z").weight).not.toBe(0);
  });

  it("puts the followers back on undo", () => {
    const typeface = store.getSnapshot().typeface!;
    const snapshot = store.snapshotGlyph("n")!;
    const n = typeface.glyphs[typeface.glyphIndex.get("n")!];
    n.contours[0].nodes[2].point = { x: 260, y: 1180 };
    store.commitGlyphEdit("n", "Reshape n", snapshot);

    store.undo();
    const h = typeface.glyphs[typeface.glyphIndex.get("h")!];
    expect(h.contours[0].nodes[2].point).toEqual({ x: 200, y: 1100 });
  });
});
