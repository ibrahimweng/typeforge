import { describe, expect, it } from "vitest";

import {
  agrees,
  alignMasters,
  freeMasterId,
  freeMasterName,
  glyphAcross,
  lettersThatCannotVary,
  masterFrom,
  mastersFrom,
  shareAcross,
  soleMaster,
  WGHT,
  whyItCannotVary,
} from "./master";
import { addGlyph } from "./library";
import { emptyTypeface, type Contour, type Glyph, type Typeface } from "./types";
import type { Master } from "./master";

const box = (nodes = 4): Contour => ({
  closed: true,
  nodes: Array.from({ length: nodes }, (_, at) => ({
    point: { x: at * 10, y: at * 10 },
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  })),
});

function glyph(name: string, contours: Contour[] = [box()]): Glyph {
  return {
    name,
    unicodes: [],
    advanceWidth: 500,
    contours,
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

function font(names: string[]): Typeface {
  const typeface = emptyTypeface();
  typeface.meta.familyName = "Test";
  typeface.meta.styleName = "Regular";
  typeface.glyphs = names.map((name) => glyph(name));
  typeface.glyphIndex = new Map(typeface.glyphs.map((one, at) => [one.name, at]));
  return typeface;
}

describe("a second weight of the same typeface", () => {
  it("copies the drawing and shares everything the format writes once", () => {
    const base = font(["a", "b"]);
    const bold = masterFrom(base, "Bold", { [WGHT]: 700 }, "m2");

    /*
     * The line between copied and shared is drawn by what the format can
     * express: one `name`, one set of vertical metrics and one `GPOS` for the
     * whole variable font, so a document that let those drift would be
     * describing a font that cannot exist.
     */
    expect(bold.typeface.meta).toBe(base.meta);
    expect(bold.typeface.metrics).toBe(base.metrics);
    expect(bold.typeface.kerning).toBe(base.kerning);

    // And the drawing is the point of a second master, so it is its own.
    expect(bold.typeface.glyphs).not.toBe(base.glyphs);
    expect(bold.typeface.glyphs[0]).not.toBe(base.glyphs[0]);
    expect(bold.typeface.glyphs[0].contours[0].nodes[1].point).toEqual({ x: 10, y: 10 });
  });

  it("a drawing changed in one weight leaves the other alone", () => {
    const base = font(["a"]);
    const bold = masterFrom(base, "Bold", { [WGHT]: 700 }, "m2");

    bold.typeface.glyphs[0].contours[0].nodes[1].point.x = 999;
    expect(base.glyphs[0].contours[0].nodes[1].point.x).toBe(10);
  });

  it("a font that never asks for a second weight still has one", () => {
    const base = font(["a"]);
    base.meta.weightClass = 400;
    const only = soleMaster(base);
    expect(only.typeface).toBe(base);
    expect(only.name).toBe("Regular");
    expect(only.at[WGHT]).toBe(400);
  });

  it("will not hand out an id or a name another master is using", () => {
    const base = font(["a"]);
    const masters = [soleMaster(base), masterFrom(base, "Bold", {}, "m2")];
    expect(freeMasterId(masters)).not.toBe("m1");
    expect(freeMasterId(masters)).not.toBe("m2");
    // Two weights called Bold are two instances of the same name in the file,
    // which a reader resolves by picking one and dropping the other.
    expect(freeMasterName(masters, "Bold")).toBe("Bold 2");
    expect(freeMasterName(masters, "Light")).toBe("Light");
  });
});

describe("every weight holds the same letters", () => {
  it("a letter added in one arrives in the others, drawn as it was there", () => {
    const base = font(["a"]);
    const bold = masterFrom(base, "Bold", {}, "m2");
    // Something to tell the two drawings of `a` apart afterwards.
    bold.typeface.glyphs[0].advanceWidth = 700;

    addGlyph(base, "b");
    alignMasters(base, [bold]);

    expect(bold.typeface.glyphs.map((one) => one.name)).toEqual(["a", "b"]);
    expect(bold.typeface.glyphIndex.get("b")).toBe(1);
    // The letter it already had is the letter it already had.
    expect(bold.typeface.glyphs[0].advanceWidth).toBe(700);
    // And the new one is a copy rather than the same object, or editing it in
    // one weight would edit it in both.
    expect(bold.typeface.glyphs[1]).not.toBe(base.glyphs[1]);
  });

  it("a letter taken out of one goes from the others", () => {
    const base = font(["a", "b"]);
    const bold = masterFrom(base, "Bold", {}, "m2");

    base.glyphs = base.glyphs.filter((one) => one.name !== "a");
    base.glyphIndex = new Map(base.glyphs.map((one, at) => [one.name, at]));
    alignMasters(base, [bold]);

    expect(bold.typeface.glyphs.map((one) => one.name)).toEqual(["b"]);
    expect(bold.typeface.glyphIndex.get("a")).toBeUndefined();
  });

  it("leaves the master it was changed in alone", () => {
    const base = font(["a"]);
    const only = soleMaster(base);
    alignMasters(base, [only]);
    expect(only.typeface.glyphs[0]).toBe(base.glyphs[0]);
  });
});

describe("weights put back from what was written down", () => {
  it("copies the first weight and lays the drawn letters over it", () => {
    const base = font(["a", "b"]);
    const drawn: Glyph = { ...glyph("b"), advanceWidth: 800 };

    const [first, bold] = mastersFrom(
      base,
      { name: "Text", at: { [WGHT]: 350 } },
      [{ id: "m2", name: "Bold", at: { [WGHT]: 700 }, glyphs: [drawn] }],
    );

    // The first weight keeps its own name, which is why it is written down at
    // all: "Text" is something the style name does not say.
    expect(first.name).toBe("Text");
    expect(first.at[WGHT]).toBe(350);
    expect(first.typeface).toBe(base);

    expect(bold.name).toBe("Bold");
    expect(bold.typeface.glyphs[1].advanceWidth).toBe(800);
    // And the letter it says nothing about follows the first weight.
    expect(bold.typeface.glyphs[0].advanceWidth).toBe(500);
  });

  it("ignores a weight naming a letter the font does not have", () => {
    const base = font(["a"]);
    const [, bold] = mastersFrom(base, undefined, [
      { id: "m2", name: "Bold", at: {}, glyphs: [glyph("zzz")] },
    ]);
    expect(bold.typeface.glyphs.map((one) => one.name)).toEqual(["a"]);
  });

  it("refuses two weights claiming one id", () => {
    const base = font(["a"]);
    const masters = mastersFrom(base, undefined, [
      { id: "m2", name: "Bold", at: {}, glyphs: [] },
      { id: "m2", name: "Black", at: {}, glyphs: [] },
    ]);
    expect(masters.map((one) => one.id)).toEqual(["m1", "m2"]);
  });
});

describe("a master owns its drawing and shares the rest", () => {
  it("hands over a replaced field without touching the glyphs", () => {
    const base = font(["a"]);
    const bold = masterFrom(base, "Bold", {}, "m2");
    bold.typeface.glyphs[0].advanceWidth = 700;

    // Kerning a pair replaces the array rather than pushing onto it, which is
    // how sharing the object at creation stopped being enough.
    base.kerning = [{ left: "a", right: "a", value: -40 }];
    base.meta.familyName = "Renamed";
    shareAcross(base, [bold]);

    expect(bold.typeface.kerning).toBe(base.kerning);
    expect(bold.typeface.meta.familyName).toBe("Renamed");
    expect(bold.typeface.glyphs).not.toBe(base.glyphs);
    expect(bold.typeface.glyphs[0].advanceWidth).toBe(700);
  });
});

describe("whether two drawings of a letter can be blended", () => {
  it("agrees when the contours and the points line up", () => {
    expect(agrees(glyph("a"), glyph("a"))).toBe(true);
  });

  it("refuses a different number of points", () => {
    expect(agrees(glyph("a", [box(4)]), glyph("a", [box(5)]))).toBe(false);
  });

  it("refuses a different number of contours", () => {
    expect(agrees(glyph("a", [box()]), glyph("a", [box(), box()]))).toBe(false);
  });

  it("refuses an open path against a closed one", () => {
    const open = glyph("a", [{ ...box(), closed: false }]);
    expect(agrees(open, glyph("a"))).toBe(false);
  });

  it("refuses composites built out of different pieces", () => {
    const piece = (name: string): Glyph => ({
      ...glyph("aacute", []),
      components: [
        { glyphName: name, transform: { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 } },
      ],
    });
    expect(agrees(piece("a"), piece("a"))).toBe(true);
    expect(agrees(piece("a"), piece("e"))).toBe(false);
  });
});

describe("saying which letters will not vary, and why", () => {
  it("says nothing about a font with one weight", () => {
    const base = font(["a"]);
    expect(lettersThatCannotVary([soleMaster(base)]).size).toBe(0);
    expect(whyItCannotVary("a", [soleMaster(base)])).toBeNull();
  });

  it("names the weight and counts the points that do not line up", () => {
    const base = font(["a", "b"]);
    const bold = masterFrom(base, "Bold", {}, "m2");
    bold.typeface.glyphs[0].contours = [box(6)];
    const masters = [soleMaster(base), bold];

    expect([...lettersThatCannotVary(masters)]).toEqual(["a"]);
    const why = whyItCannotVary("a", masters);
    expect(why?.weight).toBe("Bold");
    // The sentence is about the letter, not about the font: which path, how
    // many points, and in which weight.
    expect(why?.said).toBe("path 1 has 4 points in Regular and 6 in Bold");
  });

  it("says which weight has more paths when the count itself differs", () => {
    const base = font(["a"]);
    const bold = masterFrom(base, "Bold", {}, "m2");
    bold.typeface.glyphs[0].contours = [box(), box()];
    const why = whyItCannotVary("a", [soleMaster(base), bold]);
    expect(why?.said).toBe("1 path in Regular and 2 in Bold");
  });

  it("compares against the first weight, because that is what the file does", () => {
    /*
     * `gvar` stores every other master as a difference from the default, so a
     * letter that disagrees with the default has no difference to store however
     * well the others agree with each other.
     */
    const base = font(["a"]);
    const bold = masterFrom(base, "Bold", {}, "m2");
    const black = masterFrom(base, "Black", {}, "m3");
    bold.typeface.glyphs[0].contours = [box(6)];
    black.typeface.glyphs[0].contours = [box(6)];

    expect([...lettersThatCannotVary([soleMaster(base), bold, black])]).toEqual(["a"]);
  });

  it("leaves a letter alone when every weight agrees", () => {
    const base = font(["a"]);
    const bold = masterFrom(base, "Bold", {}, "m2");
    // Moved, not restructured: the whole point of a second weight.
    bold.typeface.glyphs[0].contours[0].nodes[1].point.x = 400;
    expect(lettersThatCannotVary([soleMaster(base), bold]).size).toBe(0);
  });
});

describe("looking between the weights", () => {
  const at = (x: number, y: number) => ({
    point: { x, y },
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  });

  /** Two weights of one letter, a hundred units apart at one point. */
  function pair(): Master[] {
    const base = font(["a"]);
    base.glyphs[0].contours = [{ closed: true, nodes: [at(0, 0), at(100, 0), at(0, 100)] }];
    base.glyphs[0].advanceWidth = 500;
    const first = soleMaster(base);
    first.at = { [WGHT]: 400 };

    const bold = masterFrom(base, "Bold", { [WGHT]: 900 }, "m2");
    bold.typeface.glyphs[0].contours[0].nodes[1].point.x = 200;
    bold.typeface.glyphs[0].advanceWidth = 700;
    return [first, bold];
  }

  it("says nothing to look at in a font with one weight", () => {
    expect(glyphAcross("a", [soleMaster(font(["a"]))], 500)).toBeNull();
  });

  it("draws the halfway letter halfway between them", () => {
    const halfway = glyphAcross("a", pair(), 650)!;
    expect(halfway.contours[0].nodes[1].point.x).toBe(150);
    // The advance blends too, because a bold letter is a wider letter and the
    // format varies it by the same machinery: a phantom point in `gvar`.
    expect(halfway.advanceWidth).toBe(600);
  });

  it("draws a quarter of the way a quarter of the way", () => {
    expect(glyphAcross("a", pair(), 525)!.contours[0].nodes[1].point.x).toBe(125);
  });

  it("stands at the nearest end rather than extrapolating past it", () => {
    /*
     * Past the last weight drawn there is no drawing, and inventing one would
     * be showing somebody a letter nobody made and no reader will produce --
     * the format clamps to the axis, so this does.
     */
    expect(glyphAcross("a", pair(), 100)!.contours[0].nodes[1].point.x).toBe(100);
    expect(glyphAcross("a", pair(), 900)!.contours[0].nodes[1].point.x).toBe(200);
  });

  it("has nothing to draw between two drawings that do not line up", () => {
    const masters = pair();
    masters[1].typeface.glyphs[0].contours = [box(6)];
    expect(glyphAcross("a", masters, 650)).toBeNull();
  });

  it("uses the pair either side, and not the ones beyond them", () => {
    const masters = pair();
    const middle = masterFrom(masters[0].typeface, "Medium", { [WGHT]: 500 }, "m3");
    // Drawn deliberately off the straight line between the other two, so a
    // reading that ignored it would give a different answer.
    middle.typeface.glyphs[0].contours[0].nodes[1].point.x = 180;

    const between = glyphAcross("a", [...masters, middle], 450)!;
    // Halfway from 400 to 500 is halfway from 100 to 180, not from 100 to 200.
    expect(between.contours[0].nodes[1].point.x).toBe(140);
  });
});
