import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Anchors, drafted, isDraft, markDraft } from "./draft";
import { importFont } from "./parse";
import { resolveAdvanceWidth, resolveGlyphContours } from "./transform";
import { type Contour, DEFAULT_PARAMS, type Typeface } from "./types";

const square = (size: number): Contour[] => [
  {
    closed: true,
    nodes: [
      { point: { x: -size, y: -size }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: size, y: -size }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: size, y: size }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: -size, y: size }, handleIn: null, handleOut: null, type: "corner" },
    ],
  },
];

describe("a draft between two weights", () => {
  const plain = { weight: 0, contours: square(100), advance: 200 };

  it("is every point part of the way from one to the other", () => {
    const anchors: Anchors = {
      key: "k",
      list: [{ weight: 20, contours: square(120), advance: 240 }],
    };
    const half = drafted(anchors, 10, () => plain);
    expect(half?.contours[0].nodes[2].point).toEqual({ x: 110, y: 110 });
    expect(half?.advance).toBe(220);
  });

  it("is the letter itself at a weight it was drawn at", () => {
    const exact = { weight: 20, contours: square(120), advance: 240 };
    const anchors: Anchors = { key: "k", list: [exact] };
    expect(drafted(anchors, 20, () => plain)).toBe(exact);
  });

  it("carries on a little past the furthest weight known, and no further", () => {
    const anchors: Anchors = {
      key: "k",
      list: [{ weight: 20, contours: square(120), advance: 240 }],
    };
    expect(drafted(anchors, 40, () => plain)?.contours[0].nodes[2].point).toEqual({
      x: 140,
      y: 140,
    });
    expect(drafted(anchors, 41, () => plain)).toBeNull();
  });

  it("does not draw a lighter letter from a bolder one", () => {
    const anchors: Anchors = {
      key: "k",
      list: [{ weight: 20, contours: square(120), advance: 240 }],
    };
    expect(drafted(anchors, -5, () => plain)).toBeNull();
  });

  it("is not drawn between two drawings that do not line up", () => {
    const other = square(120);
    other[0].nodes.push({ point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" });
    const anchors: Anchors = { key: "k", list: [{ weight: 20, contours: other, advance: 240 }] };
    expect(drafted(anchors, 10, () => plain)).toBeNull();
  });
});

describe("the weight slider's drafts on a real font", () => {
  async function sample(): Promise<Typeface> {
    const bytes = new Uint8Array(readFileSync("src/assets/typeforge-sample.ttf"));
    return (await importFont(bytes, "sample.ttf")).typeface;
  }
  const at = (typeface: Typeface, weight: number, draft: boolean): Typeface => {
    const params = { ...DEFAULT_PARAMS, ...typeface.params, weight };
    if (draft) markDraft(params);
    return { ...typeface, params };
  };
  const furthest = (one: Contour[], other: Contour[]): number => {
    let worst = 0;
    one.forEach((contour, c) => {
      contour.nodes.forEach((node, n) => {
        const far = other[c].nodes[n].point;
        worst = Math.max(worst, Math.hypot(node.point.x - far.x, node.point.y - far.y));
      });
    });
    return worst;
  };

  it("are close to the exact letters, and never stand in for them", async () => {
    const typeface = await sample();
    const letters = ["H", "o", "n", "a", "e", "s", "g", "W"].map(
      (name) => typeface.glyphs[typeface.glyphIndex.get(name)!],
    );
    const em = typeface.unitsPerEm;
    // Weighed exactly once, at the start of a gesture.
    for (const glyph of letters) resolveGlyphContours(glyph, at(typeface, 10, false));

    for (const weight of [4, 12, 20, 26]) {
      const draft = at(typeface, weight, true);
      expect(isDraft(draft.params)).toBe(true);
      const exact = at(typeface, weight, false);
      for (const glyph of letters) {
        const drawn = resolveGlyphContours(glyph, draft);
        const truth = resolveGlyphContours(glyph, exact);
        expect(drawn.length, glyph.name).toBe(truth.length);
        // Near enough to stand in for the letter while the hand is moving.
        expect(furthest(drawn, truth), `${glyph.name} at ${weight}`).toBeLessThan(em * 0.01);
        expect(
          Math.abs(resolveAdvanceWidth(glyph, draft) - resolveAdvanceWidth(glyph, exact)),
        ).toBeLessThan(em * 0.01);
      }
    }

    // And whatever the drafts remembered, an exact letter is the one a fresh
    // font draws, to the last digit.
    const fresh = await sample();
    for (const weight of [4, 12, 20, 26]) {
      for (const glyph of letters) {
        const again = fresh.glyphs[fresh.glyphIndex.get(glyph.name)!];
        expect(resolveGlyphContours(glyph, at(typeface, weight, false))).toEqual(
          resolveGlyphContours(again, at(fresh, weight, false)),
        );
      }
    }
  });
});
