import { describe, expect, it } from "vitest";

import type { Glyph, GlyphNode, NodeType } from "@/font/types";

import { describeSelection } from "./glyph-keys";

function node(x: number, y: number, type: NodeType = "corner"): GlyphNode {
  return { point: { x, y }, handleIn: null, handleOut: null, type };
}

function letter(nodes: GlyphNode[][]): Glyph {
  return {
    name: "a",
    unicodes: [],
    advanceWidth: 500,
    contours: nodes.map((list) => ({ nodes: list, closed: true })),
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

/**
 * What a screen reader is told as somebody walks an outline.
 *
 * The canvas is a picture, and `role="application"` means the keys go straight
 * through it, so this sentence is the whole of what a person who cannot see the
 * drawing gets back from pressing Tab. It is worth testing on its own: the
 * browser suite proves it reaches the page, and this proves it says the right
 * thing about each kind of point without one.
 */
describe("saying what is picked", () => {
  const glyph = letter([[node(10, 20), node(30, 40, "smooth"), node(50, 60, "tangent")]]);

  it("says so when nothing is picked, rather than saying nothing", () => {
    expect(describeSelection(glyph, new Set())).toBe("No points picked.");
    expect(describeSelection(null, new Set(["0:0"]))).toBe("No points picked.");
  });

  it("names the point by where it is, because a point has no other name", () => {
    // The number alone says nothing about the shape being walked. The
    // coordinates do, and they are the ones the panel shows.
    expect(describeSelection(glyph, new Set(["0:0"]))).toBe(
      "Corner point 1 of 3, path 1, at 10, 20.",
    );
  });

  it("uses the point's own word for what kind it is", () => {
    expect(describeSelection(glyph, new Set(["0:1"]))).toContain("Smooth point 2 of 3");
    expect(describeSelection(glyph, new Set(["0:2"]))).toContain("Tangent point 3 of 3");
  });

  it("counts rather than lists when a run of them is picked", () => {
    // Reading out sixteen coordinates is not an announcement anybody can use.
    expect(describeSelection(glyph, new Set(["0:0", "0:1"]))).toBe("2 points picked.");
  });

  it("rounds, because a screen reader saying 10.000001 is worse than useless", () => {
    expect(describeSelection(letter([[node(10.4, -20.6)]]), new Set(["0:0"]))).toBe(
      "Corner point 1 of 1, path 1, at 10, -21.",
    );
  });

  it("says which path, since a letter has more than one", () => {
    const twoPaths = letter([[node(0, 0)], [node(5, 5)]]);
    expect(describeSelection(twoPaths, new Set(["1:0"]))).toContain("path 2");
  });

  it("does not fall over on a key pointing at a point that is gone", () => {
    // A selection outlives the edit that removed what it pointed at, and an
    // announcement is not the place to find that out.
    expect(describeSelection(glyph, new Set(["9:9"]))).toBe("1 point picked.");
  });
});
