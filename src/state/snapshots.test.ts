import { beforeEach, describe, expect, it } from "vitest";

import { emptyTypeface, type Contour, type Glyph } from "@/font/types";
import { readPlist, writePlist } from "@/ufo/plist";
import { textOf } from "@/ufo/font";
import { store } from "./store";

/*
 * Two faults about what an edit leaves behind it, rather than about the edit
 * itself: a structural undo that brought back glyph edits already taken back,
 * and anchor work that never marked its letter as touched and so was dropped
 * from a saved session.
 */

const box = (x: number, y: number, w: number, h: number): Contour => ({
  closed: true,
  nodes: [
    { point: { x, y }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: x + w, y }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: x + w, y: y + h }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x, y: y + h }, handleIn: null, handleOut: null, type: "corner" },
  ],
});

function glyph(name: string, extra: Partial<Glyph> = {}): Glyph {
  return {
    name,
    unicodes: [],
    advanceWidth: 500,
    contours: [],
    components: [],
    anchors: [],
    params: {},
    dirty: false,
    ...extra,
  };
}

/** The same seeding `store.test.ts` does: one fresh document, empty history. */
function seed(glyphs: Glyph[]): void {
  const typeface = emptyTypeface();
  typeface.glyphs = glyphs;
  typeface.glyphIndex = new Map(glyphs.map((g, index) => [g.name, index]));
  for (let at = store.getSnapshot().open.length - 1; at > 0; at--) store.closeDocument(at);
  store.startBlank();
  store.closeDocument(0);
  Object.assign(store.getSnapshot().typeface!, typeface);
}

describe("a structural undo does not bring back glyph edits already undone", () => {
  beforeEach(() => seed(["a", "b", "c", "d"].map((name) => glyph(name))));

  it("remove, edit, undo, undo leaves the edit undone", () => {
    expect(store.removeGlyph("b")).toBe(true);
    store.editGlyph("c", "Set advance width", (one) => {
      one.advanceWidth = 900;
    });
    store.undo(); // the width
    store.undo(); // the removal

    expect(store.getSnapshot().typeface!.glyphs.map((one) => one.name)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(store.glyph("c")!.advanceWidth).toBe(500);

    // And forward again lands both, in order.
    store.redo();
    expect(store.glyph("c")!.advanceWidth).toBe(500);
    store.redo();
    expect(store.glyph("c")!.advanceWidth).toBe(900);
  });

  it("holds for a drag and an anchor move, which edit the letter in place", () => {
    store.renameGlyph("a", "alpha");
    const before = store.snapshotGlyph("d")!;
    store.editGlyphLive("d", (one) => {
      one.advanceWidth = 640;
    });
    store.commitGlyphEdit("d", "Move points", before);
    store.setAnchor("c", "top", 10, 20);

    store.undo(); // the anchor
    store.undo(); // the drag
    store.undo(); // the rename

    expect(store.glyph("a")).toBeTruthy();
    expect(store.glyph("d")!.advanceWidth).toBe(500);
    expect(store.glyph("c")!.anchors).toEqual([]);
  });
});

describe("anchor edits mark their letter as touched", () => {
  beforeEach(() =>
    seed([
      glyph("a", { contours: [box(50, 0, 400, 500)] }),
      glyph("acutecomb", { unicodes: [0x301], advanceWidth: 0, contours: [box(-50, 0, 100, 100)] }),
      glyph("aacute", {
        components: [
          { glyphName: "a", transform: { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 } },
          { glyphName: "acutecomb", transform: { a: 1, b: 0, c: 0, d: 1, dx: 250, dy: 520 } },
        ],
      }),
      glyph("z", { contours: [box(0, 0, 300, 500)] }),
    ]),
  );

  it("setAnchor", () => {
    store.setAnchor("a", "top", 250, 600);
    expect(store.glyph("a")!.dirty).toBe(true);
  });

  it("setAnchorLive", () => {
    store.setAnchorLive("a", "top", 250, 600);
    expect(store.glyph("a")!.dirty).toBe(true);
  });

  it("removeAnchor", () => {
    store.glyph("a")!.anchors = [{ name: "top", x: 1, y: 2 }];
    store.removeAnchor("a", "top");
    expect(store.glyph("a")!.dirty).toBe(true);
  });

  it("suggestAnchorsFor", () => {
    store.suggestAnchorsFor("z");
    expect(store.glyph("z")!.anchors.length).toBeGreaterThan(0);
    expect(store.glyph("z")!.dirty).toBe(true);
  });

  it("deriveAnchorsFromFont, on the letters it changed and no others", () => {
    const found = store.deriveAnchorsFromFont();
    expect(found.bases + found.marks).toBeGreaterThan(0);
    expect(store.glyph("a")!.dirty).toBe(true);
    expect(store.glyph("acutecomb")!.dirty).toBe(true);
    expect(store.glyph("z")!.dirty).toBe(false);
  });
});

/*
 * A rename reaches the groups a UFO carried, which the model does not hold:
 * otherwise the writer finds the old name in a mark group, no glyph by it, and
 * takes the letter out as though it had been deleted. And the undo takes the
 * rename back out of them too.
 */
describe("renaming a letter of a UFO", () => {
  const folder = () =>
    new Map<string, string>([
      ["metainfo.plist", writePlist({ formatVersion: 3 })],
      ["fontinfo.plist", writePlist({ familyName: "Folder" })],
      ["glyphs/contents.plist", writePlist({ a: "a.glif", b: "b.glif" })],
      ["glyphs/a.glif", '<glyph name="a" format="2"><advance width="500"/><outline/></glyph>'],
      ["glyphs/b.glif", '<glyph name="b" format="2"><advance width="500"/><outline/></glyph>'],
      ["groups.plist", writePlist({ round: ["a", "b"] })],
    ]);
  const groups = async () =>
    readPlist(textOf((await store.ufoFiles())!.get("groups.plist")))!.round;

  it("follows the rename into the carried groups, and back out on undo", async () => {
    seed([]);
    await store.loadUfo(folder(), "Folder.ufo");
    expect(store.renameGlyph("a", "a.alt")).toBe(true);
    expect(await groups()).toEqual(["a.alt", "b"]);
    store.undo();
    expect(await groups()).toEqual(["a", "b"]);
    store.redo();
    expect(await groups()).toEqual(["a.alt", "b"]);
  });
});
