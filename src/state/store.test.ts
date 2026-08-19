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
