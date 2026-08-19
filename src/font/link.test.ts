import { describe, expect, it } from "vitest";

import {
  buildLinks,
  findSharedPoints,
  linkKey,
  pointsThatMoved,
  propagateMoves,
  summariseLinks,
} from "./link";
import { emptyTypeface, type Contour, type Glyph, type Typeface, type Vec2 } from "./types";

function polygon(points: Vec2[]): Contour {
  return {
    closed: true,
    nodes: points.map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" })),
  };
}

function glyph(name: string, contours: Contour[]): Glyph {
  return {
    name,
    unicodes: [],
    advanceWidth: 600,
    contours,
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

function typeface(glyphs: Glyph[]): Typeface {
  const base = emptyTypeface();
  base.glyphs = glyphs;
  base.glyphIndex = new Map(glyphs.map((g, index) => [g.name, index]));
  return base;
}

/** Four points; the first three are shared with the shape below. */
const SHARED = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

describe("findSharedPoints", () => {
  it("finds points standing in the same place", () => {
    const a = glyph("a", [polygon([...SHARED, { x: 0, y: 100 }])]);
    const b = glyph("b", [polygon([...SHARED, { x: 0, y: 400 }])]);
    const shared = findSharedPoints(a, b);
    expect(shared).toHaveLength(3);
  });

  it("does not match a point that merely looks close", () => {
    const a = glyph("a", [polygon([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])]);
    const b = glyph("b", [polygon([{ x: 40, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 100 }])]);
    expect(findSharedPoints(a, b)).toHaveLength(0);
  });

  it("absorbs a unit of rounding but no more", () => {
    const a = glyph("a", [polygon([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])]);
    const near = glyph("near", [polygon([{ x: 1, y: 0 }, { x: 100, y: 1 }, { x: 100, y: 100 }])]);
    const far = glyph("far", [polygon([{ x: 3, y: 0 }, { x: 100, y: 3 }, { x: 100, y: 100 }])]);
    expect(findSharedPoints(a, near)).toHaveLength(3);
    expect(findSharedPoints(a, far)).toHaveLength(1);
  });

  it("never claims one target point for two source points", () => {
    const a = glyph("a", [polygon([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 100 }])]);
    const b = glyph("b", [polygon([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 50 }])]);
    const shared = findSharedPoints(a, b);
    const targets = shared.map((match) => linkKey(match.contour, match.node));
    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe("buildLinks", () => {
  it("links a letter that is substantially the control letter", () => {
    const family = typeface([
      glyph("n", [polygon([...SHARED, { x: 0, y: 100 }])]),
      glyph("h", [polygon([...SHARED, { x: 0, y: 400 }])]),
    ]);
    const summary = summariseLinks(buildLinks(family, "n"));
    expect(summary.glyphs).toEqual(["h"]);
    expect(summary.points).toBe(3);
  });

  /**
   * A letter sharing only a foot or two is not the control letter; it is a
   * different letter whose stem happens to stand in the same place. Linking it
   * would move part of it while the parameters moved the rest, so the same edit
   * would land on it twice.
   */
  it("leaves alone a letter that shares only an incidental point", () => {
    const family = typeface([
      glyph("n", [polygon([...SHARED, { x: 0, y: 100 }, { x: 50, y: 200 }, { x: 20, y: 300 }])]),
      glyph("b", [polygon([{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }])]),
    ]);
    expect(summariseLinks(buildLinks(family, "n")).glyphs).toEqual([]);
  });

  it("skips a glyph built from components, which already follows its parts", () => {
    const composite = glyph("ntilde", [polygon([...SHARED, { x: 0, y: 100 }])]);
    composite.components = [
      { glyphName: "n", transform: { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 } },
    ];
    const family = typeface([glyph("n", [polygon([...SHARED, { x: 0, y: 100 }])]), composite]);
    expect(summariseLinks(buildLinks(family, "n")).glyphs).toEqual([]);
  });
});

describe("propagating an edit through the links", () => {
  function family(): Typeface {
    return typeface([
      glyph("n", [polygon([...SHARED, { x: 0, y: 100 }])]),
      glyph("h", [polygon([...SHARED, { x: 0, y: 400 }])]),
    ]);
  }

  it("moves the same point in every letter that follows", () => {
    const document = family();
    const links = buildLinks(document, "n");
    const before = structuredClone(document.glyphs[0]);
    document.glyphs[0].contours[0].nodes[2].point = { x: 160, y: 130 };

    const changed = propagateMoves(document, links, pointsThatMoved(before, document.glyphs[0]));
    expect(changed).toEqual(["h"]);
    expect(document.glyphs[1].contours[0].nodes[2].point).toEqual({ x: 160, y: 130 });
  });

  it("leaves the points that were not shared where they were", () => {
    const document = family();
    const links = buildLinks(document, "n");
    const before = structuredClone(document.glyphs[0]);
    // Point 3 is n's own; h has its own taller point there.
    document.glyphs[0].contours[0].nodes[3].point = { x: 0, y: 250 };

    propagateMoves(document, links, pointsThatMoved(before, document.glyphs[0]));
    expect(document.glyphs[1].contours[0].nodes[3].point).toEqual({ x: 0, y: 400 });
  });

  it("carries the handles along so a curve keeps its shape", () => {
    const document = family();
    document.glyphs[0].contours[0].nodes[1].handleOut = { x: 130, y: 20 };
    document.glyphs[1].contours[0].nodes[1].handleOut = { x: 130, y: 20 };
    const links = buildLinks(document, "n");
    const before = structuredClone(document.glyphs[0]);

    document.glyphs[0].contours[0].nodes[1].point = { x: 110, y: 10 };
    document.glyphs[0].contours[0].nodes[1].handleOut = { x: 140, y: 30 };
    propagateMoves(document, links, pointsThatMoved(before, document.glyphs[0]));

    const moved = document.glyphs[1].contours[0].nodes[1];
    expect(moved.point).toEqual({ x: 110, y: 10 });
    // The handle travelled by the same amount rather than staying behind.
    expect(moved.handleOut).toEqual({ x: 140, y: 30 });
  });

  it("does nothing when the control letter did not move", () => {
    const document = family();
    const links = buildLinks(document, "n");
    const before = structuredClone(document.glyphs[0]);
    expect(propagateMoves(document, links, pointsThatMoved(before, document.glyphs[0]))).toEqual([]);
  });
});
