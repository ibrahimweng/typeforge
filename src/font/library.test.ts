/**
 * That a letter can be made and unmade without taking the font with it.
 *
 * A glyph's name is written down in six places, and the interesting failures
 * are all the same shape: an operation that reaches five of them leaves a font
 * that still exports and has quietly lost a kern pair, an accent, or a
 * ligature. Nothing on screen says so. Somebody finds out when they set the
 * font in a word.
 *
 * So every test here checks the references rather than the glyph list.
 */

import { describe, expect, it } from "vitest";

import {
  addGlyph,
  blankGlyph,
  claimedBy,
  duplicateGlyph,
  freeNameNear,
  hasLetters,
  nameIsFree,
  NOTDEF,
  notdefGlyph,
  removeGlyph,
  renameGlyph,
} from "./library";
import { contourArea, contoursBounds } from "./geometry";
import { emptyTypeface, type Contour, type Typeface } from "./types";

const square = (size = 100): Contour => ({
  closed: true,
  nodes: [
    { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: size, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: size, y: size }, handleIn: null, handleOut: null, type: "corner" },
  ],
});

/**
 * A font with a letter referred to from all six places at once.
 *
 * `a` is kerned, in a class, in a ligature rule, and carried as a component of
 * `aacute`. Every test below does something to `a` and then asks what happened
 * to the other five.
 */
function crowded(): Typeface {
  const typeface = emptyTypeface();
  typeface.glyphs = [
    { ...blankGlyph("a", [97]), contours: [square()], advanceWidth: 520 },
    blankGlyph("v", [118]),
    {
      ...blankGlyph("aacute", [225]),
      components: [
        { glyphName: "a", transform: { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 } },
        { glyphName: "acute", transform: { a: 1, b: 0, c: 0, d: 1, dx: 40, dy: 300 } },
      ],
    },
    blankGlyph("acute"),
  ];
  typeface.glyphIndex = new Map(typeface.glyphs.map((one, at) => [one.name, at]));
  typeface.kerning = [
    { left: "v", right: "a", value: -30 },
    { left: "a", right: "v", value: -20 },
    { left: "v", right: "acute", value: -5 },
  ];
  typeface.kernClasses = [
    { id: "k1", name: "round left", left: ["a", "acute"], right: ["v"], value: -12 },
  ];
  typeface.alternates = [
    {
      input: [["a"], ["v"]],
      swaps: [{ at: 0, swap: [{ plain: "a", alternate: "aacute" }] }],
    },
  ];
  return typeface;
}

describe("putting a letter in", () => {
  it("adds one to a font that had none, which was a dead end", () => {
    /*
     * `startBlank()` handed back a typeface whose glyph list was empty, and
     * until this existed there was no way to put anything into it. The New
     * action led to a font that could never contain a letter.
     */
    const typeface = emptyTypeface();
    expect(typeface.glyphs).toHaveLength(0);
    const made = addGlyph(typeface, "A", [65]);
    expect(made).not.toBeNull();
    expect(typeface.glyphs).toHaveLength(1);
    expect(typeface.glyphIndex.get("A")).toBe(0);
    expect(made!.unicodes).toEqual([65]);
    // Marked as changed, because it is: a letter that did not exist does now.
    expect(made!.dirty).toBe(true);
  });

  it("refuses a name that is taken, because the name is the identity", () => {
    const typeface = crowded();
    expect(addGlyph(typeface, "a")).toBeNull();
    expect(typeface.glyphs).toHaveLength(4);
  });

  it("does not count `.notdef` as a letter, because nobody drew it", () => {
    /*
     * The question five views ask before they show anything. `.notdef` is the
     * box a renderer draws for a character the font has not got and the format
     * requires it in position zero, so a font that has just been started
     * carries one -- and `glyphs.length` says 1 about a font with nothing in
     * it, which is how the empty states came to stop appearing exactly when
     * they were needed.
     */
    const typeface = emptyTypeface();
    expect(hasLetters(typeface)).toBe(false);

    addGlyph(typeface, NOTDEF);
    expect(typeface.glyphs).toHaveLength(1);
    expect(hasLetters(typeface)).toBe(false);

    addGlyph(typeface, "A");
    expect(hasLetters(typeface)).toBe(true);
  });

  it("draws the `.notdef` box rather than leaving it blank", () => {
    /*
     * The point of `.notdef` is that a character the font has not got shows as
     * something. An empty one renders as blank space, which is exactly what it
     * exists to prevent -- and in the grid it showed as an empty cell,
     * indistinguishable from a letter nobody had drawn, when it was finished.
     */
    const glyph = notdefGlyph({
      ascender: 800,
      descender: -200,
      capHeight: 700,
      xHeight: 500,
      lineGap: 0,
    });
    expect(glyph.name).toBe(NOTDEF);
    // A box with a hole in it: two rectangles, and the inner one winding the
    // other way so it cuts rather than fills.
    expect(glyph.contours).toHaveLength(2);
    expect(glyph.contours.map((one) => one.nodes.length)).toEqual([4, 4]);
    expect(Math.sign(contourArea(glyph.contours[0]))).toBe(
      -Math.sign(contourArea(glyph.contours[1])),
    );
    // The hole sits inside the box rather than over it.
    const outer = contoursBounds([glyph.contours[0]]);
    const inner = contoursBounds([glyph.contours[1]]);
    expect(inner.xMin).toBeGreaterThan(outer.xMin);
    expect(inner.xMax).toBeLessThan(outer.xMax);
    expect(inner.yMin).toBeGreaterThan(outer.yMin);
    expect(inner.yMax).toBeLessThan(outer.yMax);
    // And it is not somebody's unsaved work.
    expect(glyph.dirty).toBe(false);
    expect(glyph.unicodes).toEqual([]);
  });

  it("finds a free name near the one asked for", () => {
    const typeface = crowded();
    expect(nameIsFree(typeface, "a")).toBe(false);
    expect(freeNameNear(typeface, "a")).toBe("a.001");
    addGlyph(typeface, "a.001");
    expect(freeNameNear(typeface, "a")).toBe("a.002");
    // The suffix a font tool already expects on a variant of a letter.
    expect(freeNameNear(typeface, "b")).toBe("b");
  });
});

describe("taking a letter out", () => {
  it("takes every reference to it out too", () => {
    /*
     * The failure this is really about. A pair kerned against a letter that is
     * gone is a pair the exporter cannot write; a class listing it has a hole
     * in it; a letter built on it is missing a piece.
     */
    const typeface = crowded();
    expect(removeGlyph(typeface, "a")).toBe(true);

    expect(typeface.glyphIndex.has("a")).toBe(false);
    expect(typeface.kerning.map((one) => `${one.left}/${one.right}`)).toEqual(["v/acute"]);
    expect(typeface.kernClasses[0].left).toEqual(["acute"]);
    // The accent keeps the piece that is still there and loses the one that
    // is not.
    const aacute = typeface.glyphs.find((one) => one.name === "aacute")!;
    expect(aacute.components.map((one) => one.glyphName)).toEqual(["acute"]);
    // And the rule that can no longer match is gone rather than left broken.
    expect(typeface.alternates).toHaveLength(0);
  });

  it("keeps the positions in the index right afterwards", () => {
    // Everything after the hole moved up by one, and the index is what every
    // lookup in the application goes through.
    const typeface = crowded();
    removeGlyph(typeface, "v");
    for (const [name, at] of typeface.glyphIndex) {
      expect(typeface.glyphs[at].name).toBe(name);
    }
  });

  it("says so when there was nothing to remove", () => {
    expect(removeGlyph(crowded(), "zzz")).toBe(false);
  });
});

describe("renaming a letter", () => {
  it("writes the new name in all six places", () => {
    const typeface = crowded();
    expect(renameGlyph(typeface, "a", "alpha")).toBe(true);

    expect(typeface.glyphIndex.has("a")).toBe(false);
    expect(typeface.glyphIndex.has("alpha")).toBe(true);
    expect(typeface.glyphs.find((one) => one.name === "alpha")).toBeDefined();
    expect(typeface.kerning.map((one) => `${one.left}/${one.right}`)).toEqual([
      "v/alpha",
      "alpha/v",
      "v/acute",
    ]);
    expect(typeface.kernClasses[0].left).toEqual(["alpha", "acute"]);
    expect(typeface.glyphs.find((one) => one.name === "aacute")!.components[0].glyphName).toBe(
      "alpha",
    );
    expect(typeface.alternates[0].input[0]).toEqual(["alpha"]);
    expect(typeface.alternates[0].swaps[0].swap[0].plain).toBe("alpha");
  });

  it("follows the name into the far side of a swap as well", () => {
    // `aacute` is what `a` turns into, so a rename of the *result* has to be
    // written down too. It is the reference easiest to forget.
    const typeface = crowded();
    renameGlyph(typeface, "aacute", "aacute.alt");
    expect(typeface.alternates[0].swaps[0].swap[0].alternate).toBe("aacute.alt");
  });

  it("refuses a name that is taken, and refuses to rename nothing", () => {
    const typeface = crowded();
    expect(renameGlyph(typeface, "a", "v")).toBe(false);
    expect(renameGlyph(typeface, "zzz", "q")).toBe(false);
    expect(renameGlyph(typeface, "a", "a")).toBe(false);
    expect(typeface.glyphIndex.has("a")).toBe(true);
  });
});

describe("duplicating a letter", () => {
  it("copies the drawing and not the character it is", () => {
    /*
     * The whole difference between a duplicate and a second original. Two
     * glyphs claiming the same codepoint is a font where one of them can never
     * be typed, and which one wins is decided by the order they happen to sit
     * in.
     */
    const typeface = crowded();
    const copy = duplicateGlyph(typeface, "a", "a.alt")!;
    expect(copy.unicodes).toEqual([]);
    expect(copy.advanceWidth).toBe(520);
    expect(copy.contours[0].nodes).toHaveLength(3);
  });

  it("copies the drawing rather than sharing it", () => {
    // A shallow copy would make an edit to one letter show up in the other,
    // which is the kind of fault that looks like the canvas is haunted.
    const typeface = crowded();
    const copy = duplicateGlyph(typeface, "a", "a.alt")!;
    copy.contours[0].nodes[0].point.x = 999;
    const original = typeface.glyphs.find((one) => one.name === "a")!;
    expect(original.contours[0].nodes[0].point.x).toBe(0);
  });

  it("brings the components across without pointing at the copy", () => {
    const typeface = crowded();
    const copy = duplicateGlyph(typeface, "aacute", "aacute.alt")!;
    expect(copy.components.map((one) => one.glyphName)).toEqual(["a", "acute"]);
    // A separate transform object, so moving the accent on one does not move
    // it on the other.
    copy.components[1].transform.dx = 0;
    const original = typeface.glyphs.find((one) => one.name === "aacute")!;
    expect(original.components[1].transform.dx).toBe(40);
  });
});

describe("who owns a character", () => {
  it("names the glyph already claiming it", () => {
    const typeface = crowded();
    expect(claimedBy(typeface, 97, "v")).toBe("a");
    expect(claimedBy(typeface, 97, "a")).toBeNull();
    expect(claimedBy(typeface, 0x2603, "a")).toBeNull();
  });
});
