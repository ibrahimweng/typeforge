import { beforeEach, describe, expect, it } from "vitest";

import { contourArea, contoursBounds } from "@/font/geometry";
import { directionIsCorrect } from "@/font/outline";
import { mirror, slanted } from "@/font/reshape";
import { emptyTypeface, type Contour, type Glyph } from "@/font/types";
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

/*
 * The four operations that were in the engine and not in anybody's hands.
 *
 * Every one of these has been in the tree since the exporter needed it, and
 * ran once, silently, on the way to a file. What is new is that they are
 * edits: they go on the undo stack, they mark the letter as changed, and they
 * can be asked for while drawing rather than only at the end.
 */

/** A square, wound whichever way is asked for. */
function square(size: number, clockwise: boolean, at = 0): Contour {
  const corner = (x: number, y: number) => ({
    point: { x: at + x, y: at + y },
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  });
  const nodes = [corner(0, 0), corner(size, 0), corner(size, size), corner(0, size)];
  return { closed: true, nodes: clockwise ? nodes.reverse() : nodes };
}

/** A circle drawn as four curves, which is a shape with extremes to find. */
function circle(radius: number, at = { x: 0, y: 0 }): Contour {
  const k = radius * 0.5523;
  const node = (x: number, y: number, hi: [number, number], ho: [number, number]) => ({
    point: { x: at.x + x, y: at.y + y },
    handleIn: { x: at.x + hi[0], y: at.y + hi[1] },
    handleOut: { x: at.x + ho[0], y: at.y + ho[1] },
    type: "smooth" as const,
  });
  return {
    closed: true,
    nodes: [
      node(radius, 0, [radius, -k], [radius, k]),
      node(0, radius, [k, radius], [-k, radius]),
      node(-radius, 0, [-radius, k], [-radius, -k]),
      node(0, -radius, [-k, -radius], [k, -radius]),
    ],
  };
}

function setContours(name: string, contours: Contour[]): void {
  store.editGlyph(name, "seed", (one) => {
    one.contours = contours;
  });
}

describe("the path operations, as edits", () => {
  beforeEach(() => seed(["a", "b"]));

  it("puts a point where a curve turns, and can be taken back", () => {
    // A circle drawn as four curves between its own extremes already has
    // them; one rotated off its extremes does not.
    const rotated: Contour = {
      closed: true,
      nodes: circle(100).nodes.map((node) => ({
        point: { x: node.point.x + node.point.y, y: node.point.y - node.point.x },
        handleIn: node.handleIn
          ? { x: node.handleIn.x + node.handleIn.y, y: node.handleIn.y - node.handleIn.x }
          : null,
        handleOut: node.handleOut
          ? { x: node.handleOut.x + node.handleOut.y, y: node.handleOut.y - node.handleOut.x }
          : null,
        type: node.type,
      })),
    };
    setContours("a", [rotated]);
    const before = store.glyph("a")!.contours[0].nodes.length;

    store.addExtremes("a");
    const after = store.glyph("a")!.contours[0].nodes.length;
    expect(after).toBeGreaterThan(before);

    store.undo();
    expect(store.glyph("a")!.contours[0].nodes).toHaveLength(before);
  });

  it("winds a stray contour the way the rest of the font is wound", () => {
    /*
     * The convention is read off the font rather than imposed on it. Here the
     * font is counter-clockwise -- which is what a UFO is -- so the clockwise
     * one is the odd one out and the one that moves.
     */
    // A clear majority rather than one each: with a font split down the
    // middle the answer is a tie, and a tie keeps to TrueType.
    seed(["a", "b", "c", "d"]);
    setContours("a", [square(100, false)]);
    setContours("c", [square(90, false)]);
    setContours("d", [square(80, false)]);
    setContours("b", [square(100, true)]);

    store.correctPathDirection("b");
    expect(directionIsCorrect(store.glyph("b")!.contours, "cff")).toBe(true);
    // And the one that already agreed with the font is left alone.
    const before = JSON.stringify(store.glyph("a")!.contours);
    store.correctPathDirection("a");
    expect(JSON.stringify(store.glyph("a")!.contours)).toBe(before);
  });

  it("cuts one path out of another, and leaves neither behind", async () => {
    setContours("a", [square(100, false), square(40, false, 30)]);
    await store.combineContours("a", [0, 1], "subtract");
    const contours = store.glyph("a")!.contours;
    // A square with a square hole in it: two contours, not the four a naive
    // append would leave.
    expect(contours.length).toBeGreaterThan(0);
    expect(contours.length).toBeLessThanOrEqual(2);
    store.undo();
    expect(store.glyph("a")!.contours).toHaveLength(2);
  });

  it("does nothing when there are not two paths to combine", async () => {
    setContours("a", [square(100, false)]);
    const before = JSON.stringify(store.glyph("a")!.contours);
    await store.combineContours("a", [0], "unite");
    expect(JSON.stringify(store.glyph("a")!.contours)).toBe(before);
  });

  it("marks the letter as changed, because it is", () => {
    setContours("a", [square(100, true)]);
    store.editGlyph("a", "settle", (one) => {
      one.dirty = false;
    });
    store.correctPathDirection("a");
    expect(store.glyph("a")!.dirty).toBe(true);
  });
});

describe("moving what is drawn", () => {
  beforeEach(() => seed(["a"]));

  it("leans the whole letter when nothing is picked", () => {
    setContours("a", [square(100, false)]);
    store.setSelectedNodes([]);
    store.reshapeGlyph("a", "Slant", () => slanted(12));

    const box = contoursBounds(store.glyph("a")!.contours);
    // A square leaned twelve degrees off the baseline is wider by its own
    // height times the tangent of the angle, and no taller.
    expect(box.xMax - box.xMin).toBeCloseTo(100 + 100 * Math.tan((12 * Math.PI) / 180), 6);
    expect(box.yMax - box.yMin).toBeCloseTo(100, 6);
  });

  it("leans only the points that are picked", () => {
    setContours("a", [square(100, false)]);
    // The two top corners of the square, which is index 2 and 3.
    store.setSelectedNodes(["0:2", "0:3"]);
    store.reshapeGlyph("a", "Slant", () => slanted(12));

    const nodes = store.glyph("a")!.contours[0].nodes;
    // The feet have not moved.
    expect(nodes[0].point).toEqual({ x: 0, y: 0 });
    expect(nodes[1].point).toEqual({ x: 100, y: 0 });
    // The top has.
    expect(nodes[2].point.x).toBeGreaterThan(100);
  });

  it("puts the winding back after a flip of the whole letter", () => {
    setContours("a", [square(100, false)]);
    store.setSelectedNodes([]);
    const before = Math.sign(contourArea(store.glyph("a")!.contours[0]));
    store.reshapeGlyph("a", "Mirror", (centre) => mirror("horizontal", centre));
    expect(Math.sign(contourArea(store.glyph("a")!.contours[0]))).toBe(before);
  });

  it("lines the picked points up with each other", () => {
    setContours("a", [square(100, false)]);
    store.setSelectedNodes(["0:0", "0:1"]);
    store.alignSelection("a", "left");
    const nodes = store.glyph("a")!.contours[0].nodes;
    expect(nodes[0].point.x).toBe(0);
    expect(nodes[1].point.x).toBe(0);
    // And the ones that were not picked stay exactly where they were.
    expect(nodes[2].point).toEqual({ x: 100, y: 100 });
  });

  it("will not align fewer than two points", () => {
    setContours("a", [square(100, false)]);
    store.setSelectedNodes(["0:0"]);
    const before = JSON.stringify(store.glyph("a")!.contours);
    store.alignSelection("a", "left");
    expect(JSON.stringify(store.glyph("a")!.contours)).toBe(before);
  });
});

describe("changing what a point is", () => {
  beforeEach(() => seed(["a"]));

  /** A square with a fifth point sitting exactly on the first. */
  const doubled = (): Contour => {
    const one = square(100, false);
    return { ...one, nodes: [...one.nodes, { ...one.nodes[0] }] };
  };

  it("will not smooth without being told which points, and says so", () => {
    /*
     * The one operation here that does not fall back to the whole letter.
     * Smoothing every point in an `A` would move handles all over a letter
     * with no curves in it, which is not what pressing a button once means.
     */
    setContours("a", [circle(100)]);
    store.setSelectedNodes([]);
    const before = JSON.stringify(store.glyph("a")!.contours);
    store.retypeSelection("a", "smooth");
    expect(JSON.stringify(store.glyph("a")!.contours)).toBe(before);
    expect(store.getSnapshot().status?.tone).toBe("error");
  });

  it("lines a picked point's handles up through it", () => {
    const kinked: Contour = {
      closed: true,
      nodes: [
        { point: { x: 0, y: 0 }, handleIn: { x: -100, y: 10 }, handleOut: { x: 10, y: 0 }, type: "corner" },
        { point: { x: 200, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 200, y: 200 }, handleIn: null, handleOut: null, type: "corner" },
      ],
    };
    setContours("a", [kinked]);
    store.setSelectedNodes(["0:0"]);
    store.retypeSelection("a", "smooth");

    const node = store.glyph("a")!.contours[0].nodes[0];
    expect(node.type).toBe("smooth");
    // The longer handle stayed where it was put; the stub swung round to face
    // it, and is still its own length.
    expect(node.handleIn).toEqual({ x: -100, y: 10 });
    expect(Math.hypot(node.handleOut!.x, node.handleOut!.y)).toBeCloseTo(10, 6);
  });

  it("lets a point turn again without moving a coordinate", () => {
    setContours("a", [circle(100)]);
    const before = store.glyph("a")!.contours[0].nodes[0];
    store.setSelectedNodes(["0:0"]);
    store.retypeSelection("a", "corner");
    const after = store.glyph("a")!.contours[0].nodes[0];
    expect(after.type).toBe("corner");
    expect(after.point).toEqual(before.point);
    expect(after.handleIn).toEqual(before.handleIn);
  });

  it("rounds the whole letter when nothing is picked", () => {
    setContours("a", [
      {
        closed: true,
        nodes: [
          { point: { x: 0.4, y: 0.6 }, handleIn: null, handleOut: { x: 10.5, y: 0.2 }, type: "corner" },
          { point: { x: 99.5, y: 0.4 }, handleIn: null, handleOut: null, type: "corner" },
          { point: { x: 50.2, y: 80.7 }, handleIn: null, handleOut: null, type: "corner" },
        ],
      },
    ]);
    store.setSelectedNodes([]);
    store.roundSelection("a");
    const nodes = store.glyph("a")!.contours[0].nodes;
    expect(nodes.map((one) => one.point)).toEqual([
      { x: 0, y: 1 },
      { x: 100, y: 0 },
      { x: 50, y: 81 },
    ]);
    // The handle too: one left on a fraction is a control point the exported
    // file rounds anyway, which is how a rounded outline comes back different.
    expect(nodes[0].handleOut).toEqual({ x: 11, y: 0 });
  });

  it("says nothing moved rather than marking the font changed for no reason", () => {
    // A button that marks a font as modified without altering it is a button
    // that makes the unsaved-changes warning lie.
    setContours("a", [square(100, false)]);
    const before = JSON.stringify(store.glyph("a")!.contours);
    store.setSelectedNodes([]);
    store.roundSelection("a");
    expect(store.getSnapshot().status?.message).toContain("already on a whole unit");

    // No edit was pushed at all, which is the part that matters: one undo goes
    // straight back past the seeding, because rounding put nothing on the
    // stack to undo first.
    store.undo();
    expect(JSON.stringify(store.glyph("a")!.contours)).not.toBe(before);
  });

  it("says how many points it put back on the grid", () => {
    setContours("a", [
      {
        closed: true,
        nodes: [
          { point: { x: 0.4, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
          { point: { x: 100, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
          { point: { x: 50, y: 80.7 }, handleIn: null, handleOut: null, type: "corner" },
        ],
      },
    ]);
    store.setSelectedNodes([]);
    store.roundSelection("a");
    expect(store.getSnapshot().status?.message).toContain("2 points");
  });

  it("rounds only the picked points when there are some", () => {
    setContours("a", [
      {
        closed: true,
        nodes: [
          { point: { x: 0.4, y: 0.6 }, handleIn: null, handleOut: null, type: "corner" },
          { point: { x: 99.5, y: 0.4 }, handleIn: null, handleOut: null, type: "corner" },
          { point: { x: 50.2, y: 80.7 }, handleIn: null, handleOut: null, type: "corner" },
        ],
      },
    ]);
    store.setSelectedNodes(["0:1"]);
    store.roundSelection("a");
    const nodes = store.glyph("a")!.contours[0].nodes;
    expect(nodes[1].point).toEqual({ x: 100, y: 0 });
    expect(nodes[0].point).toEqual({ x: 0.4, y: 0.6 });
  });

  it("tidies away a doubled point, says how many, and can be taken back", () => {
    setContours("a", [doubled()]);
    store.setSelectedNodes(["0:4"]);
    store.tidyGlyph("a");

    expect(store.glyph("a")!.contours[0].nodes).toHaveLength(4);
    expect(store.getSnapshot().status?.message).toContain("1 point");
    // The selection goes: every index after a removed point has moved, and a
    // selection pointing at the wrong points is worse than none.
    expect(store.getSnapshot().selectedNodes.size).toBe(0);

    store.undo();
    expect(store.glyph("a")!.contours[0].nodes).toHaveLength(5);
  });

  it("says there was nothing to tidy rather than pretending it did something", () => {
    setContours("a", [square(100, false)]);
    store.tidyGlyph("a");
    expect(store.glyph("a")!.contours[0].nodes).toHaveLength(4);
    expect(store.getSnapshot().status?.message).toContain("Nothing to tidy");
  });

  it("opens one corner and leaves the two new points in hand", () => {
    setContours("a", [square(100, false)]);
    store.setSelectedNodes(["0:1"]);
    store.openSelectedCorner("a");

    const nodes = store.glyph("a")!.contours[0].nodes;
    expect(nodes).toHaveLength(5);
    expect(nodes[1].point.x).toBeCloseTo(80, 6);
    expect(nodes[2].point.y).toBeCloseTo(20, 6);
    // Dragging them apart is the entire reason for opening a corner, so they
    // are what is selected afterwards.
    expect([...store.getSnapshot().selectedNodes].sort()).toEqual(["0:1", "0:2"]);
  });

  it("will not open a corner without exactly one point picked", () => {
    setContours("a", [square(100, false)]);
    store.setSelectedNodes(["0:1", "0:2"]);
    store.openSelectedCorner("a");
    expect(store.glyph("a")!.contours[0].nodes).toHaveLength(4);
    expect(store.getSnapshot().status?.tone).toBe("error");
  });

  it("puts an opened corner back where it was", () => {
    setContours("a", [square(100, false)]);
    store.setSelectedNodes(["0:1"]);
    store.openSelectedCorner("a");
    store.reconnectSelection("a");

    const nodes = store.glyph("a")!.contours[0].nodes;
    expect(nodes).toHaveLength(4);
    expect(nodes[1].point.x).toBeCloseTo(100, 6);
    expect(nodes[1].point.y).toBeCloseTo(0, 6);
    expect([...store.getSnapshot().selectedNodes]).toEqual(["0:1"]);
  });

  it("refuses to join two points that are not next to each other", () => {
    setContours("a", [square(100, false)]);
    store.setSelectedNodes(["0:0", "0:2"]);
    store.reconnectSelection("a");
    expect(store.glyph("a")!.contours[0].nodes).toHaveLength(4);
    expect(store.getSnapshot().status?.message).toContain("not next to each other");
  });

  it("refuses to join two points on different paths", () => {
    setContours("a", [square(100, false), square(40, false, 30)]);
    store.setSelectedNodes(["0:0", "1:0"]);
    store.reconnectSelection("a");
    expect(store.getSnapshot().status?.message).toContain("different paths");
  });

  it("says there is no corner to make when the two sides run parallel", () => {
    // Sides that never meet have no corner to put back, and a point somewhere
    // between them would be a guess.
    setContours("a", [
      {
        closed: true,
        nodes: [
          { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
          { point: { x: 50, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
          { point: { x: 50, y: 10 }, handleIn: null, handleOut: null, type: "corner" },
          { point: { x: 100, y: 10 }, handleIn: null, handleOut: null, type: "corner" },
        ],
      },
    ]);
    store.setSelectedNodes(["0:1", "0:2"]);
    store.reconnectSelection("a");
    expect(store.glyph("a")!.contours[0].nodes).toHaveLength(4);
    expect(store.getSnapshot().status?.message).toContain("parallel");
  });
});

describe("the tools that make and unmake whole shapes", () => {
  beforeEach(() => seed(["a", "b"]));

  it("drops a rectangle into the letter and leaves it selected", () => {
    setContours("a", []);
    store.addShape("a", "rectangle", { xMin: 0, yMin: 0, xMax: 100, yMax: 200 });

    const contours = store.glyph("a")!.contours;
    expect(contours).toHaveLength(1);
    // The four corners of the box, in whichever order the font's own winding
    // asks for -- which is the next test's business, not this one's.
    expect(contours[0].nodes.map((one) => `${one.point.x},${one.point.y}`).sort()).toEqual([
      "0,0",
      "0,200",
      "100,0",
      "100,200",
    ]);
    // The next thing anybody does with a shape they just drew is move it or
    // scale it, and both need it picked.
    expect([...store.getSnapshot().selectedNodes].sort()).toEqual(["0:0", "0:1", "0:2", "0:3"]);
  });

  it("winds a new shape the way the rest of the font is wound", () => {
    /*
     * Which way a contour runs decides whether it fills or cuts a hole, so a
     * rectangle added to a counter-clockwise font with a clockwise winding is
     * a rectangle that punches a hole in the letter it was added to.
     */
    seed(["a", "b", "c", "d"]);
    setContours("a", [square(100, false)]);
    setContours("b", [square(90, false)]);
    setContours("c", [square(80, false)]);
    setContours("d", []);
    store.addShape("d", "rectangle", { xMin: 0, yMin: 0, xMax: 100, yMax: 100 });
    expect(Math.sign(contourArea(store.glyph("d")!.contours[0]))).toBe(
      Math.sign(contourArea(store.glyph("a")!.contours[0])),
    );
  });

  it("keeps a click from adding a shape with no size", () => {
    setContours("a", []);
    store.addShape("a", "ellipse", { xMin: 10, yMin: 10, xMax: 11, yMax: 11 });
    expect(store.glyph("a")!.contours).toHaveLength(0);
  });

  it("cuts a shape in two and says so", () => {
    setContours("a", [square(100, false)]);
    store.setSelectedNodes(["0:0"]);
    store.cutGlyph("a", { x: -10, y: 50 }, { x: 110, y: 50 });

    expect(store.glyph("a")!.contours).toHaveLength(2);
    expect(store.getSnapshot().status?.message).toContain("2 pieces");
    // Every index has moved, so a selection kept from before would be pointing
    // at whatever now happens to sit at those numbers.
    expect(store.getSnapshot().selectedNodes.size).toBe(0);

    store.undo();
    expect(store.glyph("a")!.contours).toHaveLength(1);
  });

  it("says a cut missed rather than pushing an edit that changed nothing", () => {
    setContours("a", [square(100, false)]);
    const before = JSON.stringify(store.glyph("a")!.contours);
    store.cutGlyph("a", { x: -10, y: 300 }, { x: 110, y: 300 });
    expect(store.getSnapshot().status?.tone).toBe("error");
    expect(JSON.stringify(store.glyph("a")!.contours)).toBe(before);
  });
});

describe("the font's own identity", () => {
  beforeEach(() => seed(["a", "b"]));

  it("can be renamed, which it could not be at all", () => {
    /*
     * `setMeta` sat in this store with nothing calling it for a long time, so
     * a font opened here kept the identity of the file it came from whatever
     * was done to it: redraw every letter of DejaVu Sans, export, and the file
     * is still called DejaVu Sans and still carries DejaVu's copyright.
     */
    store.setMeta({ familyName: "Ours", copyright: "© us", license: "OFL" });
    const meta = store.getSnapshot().typeface!.meta;
    expect(meta.familyName).toBe("Ours");
    expect(meta.copyright).toBe("© us");
    expect(meta.license).toBe("OFL");
    // And the style, which was not asked about, is untouched.
    expect(meta.styleName).toBe("Regular");
  });

  it("puts a rename on the undo stack, because a name is an edit", () => {
    const was = store.getSnapshot().typeface!.meta.familyName;
    store.setMeta({ familyName: "Ours" });
    expect(store.getSnapshot().canUndo).toBe(true);
    store.undo();
    expect(store.getSnapshot().typeface!.meta.familyName).toBe(was);
    store.redo();
    expect(store.getSnapshot().typeface!.meta.familyName).toBe("Ours");
  });

  it("does not push an edit when nothing changed", () => {
    // A field commits on the way out whether or not it was typed in, so this
    // is the ordinary case rather than the odd one.
    const was = store.getSnapshot().typeface!.meta.familyName;
    store.setMeta({ familyName: was });
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("lets the lines be moved, which were equally frozen", () => {
    store.setMetrics({ xHeight: 520, capHeight: 720 });
    const metrics = store.getSnapshot().typeface!.metrics;
    expect(metrics.xHeight).toBe(520);
    expect(metrics.capHeight).toBe(720);
    expect(metrics.ascender).toBe(800);

    store.undo();
    expect(store.getSnapshot().typeface!.metrics.xHeight).toBe(500);
  });
});

describe("making and unmaking letters", () => {
  beforeEach(() => seed(["a", "v"]));

  it("puts a letter into a font that had none, which was a dead end", () => {
    /*
     * `startBlank()` hands back a typeface with an empty glyph list, and until
     * this existed there was no way to put anything into it. The New action
     * led to a font that could never contain a letter.
     */
    store.startBlank();
    expect(store.getSnapshot().typeface!.glyphs).toHaveLength(0);
    expect(store.addGlyph("A", [65])).toBe(true);

    const typeface = store.getSnapshot().typeface!;
    expect(typeface.glyphs.map((one) => one.name)).toEqual(["A"]);
    // Opened, because the reason to make a letter is to draw in it.
    expect(store.getSnapshot().selectedGlyph).toBe("A");
    expect(store.getSnapshot().view).toBe("glyph");
  });

  it("refuses a name that is taken and a character that is claimed", () => {
    expect(store.addGlyph("a")).toBe(false);
    expect(store.getSnapshot().status?.message).toContain("already a letter called a");

    store.setCodepoints("a", [97]);
    expect(store.addGlyph("alpha", [97])).toBe(false);
    expect(store.getSnapshot().status?.message).toContain("already answers");
  });

  it("takes a letter out and can be told to put it back", () => {
    expect(store.removeGlyph("v")).toBe(true);
    expect(store.getSnapshot().typeface!.glyphs.map((one) => one.name)).toEqual(["a"]);
    store.undo();
    expect(store.getSnapshot().typeface!.glyphs.map((one) => one.name)).toEqual(["a", "v"]);
  });

  it("says what a removal took with it", () => {
    // Deleting an `a` takes the `a` out of every accented letter built from
    // it, and those letters stay in the font looking like the accent alone.
    const typeface = store.getSnapshot().typeface!;
    typeface.glyphs[1].components = [
      { glyphName: "a", transform: { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 } },
    ];
    store.removeGlyph("a");
    expect(store.getSnapshot().status?.message).toContain("1 letter built on it: v");
  });

  it("renames a letter and follows the name into the kerning", () => {
    store.setKerning("v", "a", -30);
    store.selectGlyph("a");
    expect(store.renameGlyph("a", "alpha")).toBe(true);

    const typeface = store.getSnapshot().typeface!;
    expect(typeface.glyphIndex.has("alpha")).toBe(true);
    expect(typeface.kerning[0].right).toBe("alpha");
    // The letter that was open stays open under its new name.
    expect(store.getSnapshot().selectedGlyph).toBe("alpha");

    store.undo();
    expect(store.getSnapshot().typeface!.kerning[0].right).toBe("a");
  });

  it("copies a letter without copying the character it answers to", () => {
    store.setCodepoints("a", [97]);
    setContours("a", [square(100, false)]);
    const into = store.duplicateGlyph("a");
    expect(into).toBe("a.001");

    const copy = store.glyph("a.001")!;
    expect(copy.contours[0].nodes).toHaveLength(4);
    // Two glyphs on one codepoint is a font where one of them can never be
    // typed, and the copy is the one that loses.
    expect(copy.unicodes).toEqual([]);
  });

  it("will not give a character to two letters", () => {
    store.setCodepoints("a", [97]);
    expect(store.setCodepoints("v", [97])).toBe(false);
    expect(store.glyph("v")!.unicodes).toEqual([]);
    expect(store.getSnapshot().status?.message).toContain("a already answers");
  });
});

describe("carrying a drawing to another letter", () => {
  beforeEach(() => seed(["n", "m"]));

  it("copies a letter and adds it to another, which is how an m is started", () => {
    /*
     * There was no clipboard of any kind, so every shared part of a family had
     * to be drawn again by hand -- which is the opposite of what a family is.
     */
    setContours("n", [square(100, false)]);
    setContours("m", []);
    store.setSelectedNodes([]);
    expect(store.copyOutlines("n")).toBe(1);
    expect(store.pasteOutlines("m")).toBe(true);
    expect(store.glyph("m")!.contours).toHaveLength(1);
  });

  it("adds alongside what is there rather than replacing it", () => {
    // The shoulder arrives beside the stems rather than instead of them.
    setContours("n", [square(100, false)]);
    setContours("m", [square(40, false)]);
    store.setSelectedNodes([]);
    store.copyOutlines("n");
    store.pasteOutlines("m");
    expect(store.glyph("m")!.contours).toHaveLength(2);
  });

  it("carries a copy, so editing the source does not follow it", () => {
    // A shared node would make an edit to one letter show up in the other,
    // which is the kind of fault that looks like the canvas is haunted.
    setContours("n", [square(100, false)]);
    setContours("m", []);
    store.setSelectedNodes([]);
    store.copyOutlines("n");
    store.pasteOutlines("m");
    store.editGlyph("n", "move", (one) => {
      one.contours[0].nodes[0].point = { x: 999, y: 999 };
    });
    expect(store.glyph("m")!.contours[0].nodes[0].point).toEqual({ x: 0, y: 0 });
  });

  it("copies only the paths that are wholly picked", () => {
    setContours("n", [square(100, false), square(40, false, 200)]);
    store.setSelectedNodes(["1:0", "1:1", "1:2", "1:3"]);
    expect(store.copyOutlines("n")).toBe(1);
  });

  it("says so rather than copying nothing when a part path is picked", () => {
    setContours("n", [square(100, false)]);
    store.setSelectedNodes(["0:0"]);
    expect(store.copyOutlines("n")).toBe(0);
    expect(store.getSnapshot().status?.tone).toBe("error");
  });

  it("pastes nothing into a letter that is not there", () => {
    setContours("n", [square(100, false)]);
    store.setSelectedNodes([]);
    store.copyOutlines("n");
    expect(store.pasteOutlines("zzz")).toBe(false);
  });

  it("keeps what it is carrying when the letter changes under it", () => {
    /*
     * The property that makes it worth having: copy from one letter, go to
     * another, paste. A clipboard emptied by moving away from the letter it
     * came from would be a clipboard for nothing.
     */
    setContours("n", [square(100, false)]);
    setContours("m", []);
    store.setSelectedNodes([]);
    store.copyOutlines("n");
    expect(store.carrying).toBe(1);

    store.selectGlyph("m");
    expect(store.carrying).toBe(1);
    expect(store.pasteOutlines("m")).toBe(true);
  });
});

describe("guides, which now run both ways", () => {
  beforeEach(() => seed(["a"]));

  it("puts one down the canvas as well as across it", () => {
    /*
     * The type was `{ y: number }`, so every guide was horizontal and there
     * was no way to mark where a stem should stand or where a sidebearing
     * should fall -- half of what anybody draws a guide for.
     */
    store.addGuide(500, "y");
    store.addGuide(80, "x");
    expect(store.getSnapshot().guides).toEqual([
      { axis: "y", at: 500 },
      { axis: "x", at: 80 },
    ]);
  });

  it("keeps a guide on the axis it was made on when it moves", () => {
    store.addGuide(80, "x");
    store.moveGuide(0, 120.4);
    expect(store.getSnapshot().guides[0]).toEqual({ axis: "x", at: 120 });
  });

  it("goes across the canvas when nothing says otherwise", () => {
    // Which is what it always did, and what most guides are.
    store.addGuide(300);
    expect(store.getSnapshot().guides[0].axis).toBe("y");
  });

  it("leaves its guides behind when a different font is opened", () => {
    /*
     * A guide is kept in font units, and font units are not the same size from
     * one font to the next: 500 is the x-height of a thousand-unit font and a
     * quarter of the way up a two-thousand-unit one.
     */
    store.addGuide(500, "y");
    expect(store.getSnapshot().guides).toHaveLength(1);
    store.startBlank();
    expect(store.getSnapshot().guides).toHaveLength(0);
  });

  it("has snapping on to begin with, and lets it be turned off", () => {
    expect(store.getSnapshot().snapping).toBe(true);
    store.setSnapping(false);
    expect(store.getSnapshot().snapping).toBe(false);
  });
});

describe("the last three things the audit found", () => {
  beforeEach(() => seed(["a", "acute", "aacute"]));

  it("draws a freehand stroke into the letter", () => {
    setContours("a", []);
    const trail = Array.from({ length: 60 }, (_, index) => ({ x: index * 6, y: index * 3 }));
    expect(store.addStroke("a", trail)).toBe(true);
    const contours = store.glyph("a")!.contours;
    expect(contours).toHaveLength(1);
    // A handful of nodes, not sixty: a contour with the whole trail in it is
    // a recording of a hand rather than a drawing.
    expect(contours[0].nodes.length).toBeLessThan(8);
  });

  it("says a click was a click rather than drawing nothing", () => {
    setContours("a", []);
    expect(store.addStroke("a", [{ x: 5, y: 5 }])).toBe(false);
    expect(store.glyph("a")!.contours).toHaveLength(0);
  });

  it("builds a letter out of another by hand", () => {
    /*
     * `removeComponent` has always been here and nothing ever added one except
     * the accent builder, which runs on its own -- so a letter could be taken
     * apart and never put together on purpose.
     */
    expect(store.addComponent("aacute", "a")).toBe(true);
    expect(store.glyph("aacute")!.components.map((one) => one.glyphName)).toEqual(["a"]);
    store.undo();
    expect(store.glyph("aacute")!.components).toHaveLength(0);
  });

  it("refuses to build a letter out of itself", () => {
    expect(store.addComponent("a", "a")).toBe(false);
    expect(store.glyph("a")!.components).toHaveLength(0);
  });

  it("refuses a loop that goes the long way round", () => {
    /*
     * The one worth checking for. `aacute` built from `a`, `a` given `acute`,
     * and `acute` then given `aacute` -- three reasonable-looking steps making
     * a drawing with no bottom to it, which every renderer either gives up on
     * or hangs in.
     */
    store.addComponent("aacute", "a");
    store.addComponent("a", "acute");
    expect(store.addComponent("acute", "aacute")).toBe(false);
    expect(store.getSnapshot().status?.message).toContain("no bottom to it");
  });

  it("refuses a part the font does not have", () => {
    expect(store.addComponent("a", "zzz")).toBe(false);
  });
});
