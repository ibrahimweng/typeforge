/**
 * Cutting a font somebody opened.
 *
 * The drawn side has its own suite; this is the half where the outlines came
 * out of a file rather than off a pen, which is a different set of things that
 * can go wrong. Nothing here knows how thick a stem is until it is measured,
 * nothing has promised which way a counter is wound, and two of the six cuts
 * have no skeleton to be made out of.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { readyToShape } from "@/forge/layers";
import { noCuts, type Cuts } from "./cuts";
import { contourArea, contoursBounds } from "./geometry";
import { measuredStem, stemFrom } from "./stem";
import { cutScaleOf, effectiveCuts, resolveGlyphContours } from "./transform";
import { DEFAULT_PARAMS, emptyTypeface, type Contour, type Glyph, type Typeface } from "./types";

beforeAll(async () => {
  await readyToShape();
});

/** A rectangle, as a closed contour wound whichever way is asked for. */
function rect(x: number, y: number, width: number, height: number, clockwise = false): Contour {
  const corners = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  const nodes = (clockwise ? [...corners].reverse() : corners).map((point) => ({
    point,
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  }));
  return { nodes, closed: true };
}

function glyph(name: string, contours: Contour[], advanceWidth = 600): Glyph {
  return {
    name,
    unicodes: [],
    advanceWidth,
    contours,
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

/**
 * A font of plain shapes: an I that is one stem, an H that is two and a bar,
 * and an O that is a ring. Enough to measure and enough to cut.
 */
function font(): Typeface {
  const face = emptyTypeface();
  face.unitsPerEm = 1000;
  face.metrics = { ascender: 750, descender: -250, capHeight: 700, xHeight: 500, lineGap: 0 };
  face.params = { ...DEFAULT_PARAMS };
  face.glyphs = [
    glyph("I", [rect(100, 0, 90, 700)]),
    glyph("H", [rect(100, 0, 90, 700), rect(190, 300, 220, 90), rect(410, 0, 90, 700)]),
    // A ring: the hole is wound the other way, as a hole is.
    glyph("O", [rect(100, 0, 400, 700), rect(190, 90, 220, 520, true)]),
  ];
  face.glyphIndex = new Map(face.glyphs.map((one, at) => [one.name, at]));
  return face;
}

const named = (face: Typeface, name: string): Glyph => face.glyphs[face.glyphIndex.get(name)!];

const ink = (contours: Contour[]): number =>
  Math.abs(contours.reduce((total, one) => total + contourArea(one), 0));

const cutWith = (patch: (cuts: Cuts) => void): Cuts => {
  const cuts = noCuts();
  patch(cuts);
  return cuts;
};

describe("measuring a stem off outlines", () => {
  it("reads a bare stem straight off", () => {
    expect(stemFrom([rect(100, 0, 90, 700)], 200)).toBeCloseTo(90, 6);
  });

  it("takes the middle run rather than the average", () => {
    /*
     * An E ruled across at the height of an arm crosses the stem and the arm,
     * and the two are not the same width. The mean would land between them and
     * be neither; the middle answer is one of the two things actually there.
     */
    const arm = [rect(100, 0, 90, 700), rect(190, 300, 300, 40)];
    expect(stemFrom(arm, 320)).toBeCloseTo(90, 6);
  });

  it("says nothing rather than zero where there is no ink", () => {
    expect(stemFrom([rect(100, 0, 90, 100)], 400)).toBeNull();
  });

  it("prefers the letter that is only a stem", () => {
    const face = font();
    // Ruled at a third of the x-height, the I is 90 units of ink and nothing
    // else, which is the answer for the whole font.
    expect(cutScaleOf(face).stem).toBeCloseTo(90, 6);
  });

  it("falls back to a share of the em when there is nothing to rule across", () => {
    expect(measuredStem([], { xHeight: 500, unitsPerEm: 1000 })).toBeCloseTo(90, 6);
  });

  it("measures the widest drawing when the font has none of the usual letters", () => {
    const odd = [{ name: "uni4E00", contours: [rect(0, 0, 500, 700)] }];
    expect(measuredStem(odd, { xHeight: 500, unitsPerEm: 1000 })).toBeCloseTo(500, 6);
  });
});

describe("cuts in the parameter stack", () => {
  it("takes ink out of a letter and leaves its advance alone", () => {
    const face = font();
    const before = resolveGlyphContours(named(face, "H"), face);
    face.cuts = cutWith((one) => {
      one.slot.on = true;
    });
    const after = resolveGlyphContours(named(face, "H"), face);

    expect(ink(after)).toBeLessThan(ink(before));
    // Cutting is a decision about how a letter looks, not about how much room
    // it takes. A slot that respaced the font would reflow every word.
    expect(named(face, "H").advanceWidth).toBe(600);
  });

  it("cuts a letter whose single contour is wound the way a hole would be", () => {
    /*
     * DejaVu winds the outer contour of H clockwise, and plenty of fonts do.
     * Read by its winding alone that is a hole, and a letter that is all hole
     * has no ink to keep -- which is exactly how the counter motif used to
     * subtract an H down to nothing.
     */
    const face = font();
    face.glyphs[face.glyphIndex.get("I")!] = glyph("I", [rect(100, 0, 90, 700, true)]);
    face.cuts = cutWith((one) => {
      one.motif.on = true;
    });
    const after = resolveGlyphContours(named(face, "I"), face);
    expect(ink(after)).toBeGreaterThan(0);
  });

  it("replaces a counter, and leaves a letter that has none alone", () => {
    const face = font();
    face.cuts = cutWith((one) => {
      one.motif.on = true;
    });
    // The O's counter becomes a diamond, which is smaller than the square hole
    // it stands in, so the letter gains ink.
    const ring = resolveGlyphContours(named(face, "O"), face);
    expect(ink(ring)).toBeGreaterThan(ink(resolveGlyphContours(named(face, "O"), font())));
    // The I has no counter to replace.
    const stem = resolveGlyphContours(named(face, "I"), face);
    expect(ink(stem)).toBeCloseTo(90 * 700, 6);
  });

  it("does nothing with the two that are made out of a skeleton", () => {
    const face = font();
    face.cuts = cutWith((one) => {
      one.inline.on = true;
      one.split.on = true;
    });
    // Not an approximation: a letter out of a file has no spine to sweep again
    // and no join to find, so the honest answer is the letter unchanged.
    expect(ink(resolveGlyphContours(named(face, "H"), face))).toBeCloseTo(
      ink(resolveGlyphContours(named(face, "H"), font())),
      6,
    );
  });

  it("cuts before the letter is sheared, so the bands lean with it", () => {
    /*
     * A band cut square and then sheared leans with the letter, which is what
     * a cut through a leaning letter looks like. Cut after the shear it would
     * stand upright in a face that does not, and the giveaway is the width:
     * an upright band leaves the sheared letter's box alone, a leaning one
     * does not reach further than the letter it is cut from either -- so what
     * is measured here is that the two orders disagree at all.
     */
    const upright = font();
    upright.cuts = cutWith((one) => {
      one.slot = { on: true, count: 2, width: 0.34, angle: 30, inset: 0.14 };
    });
    const straight = resolveGlyphContours(named(upright, "H"), upright);

    const leaning = font();
    leaning.params = { ...DEFAULT_PARAMS, slant: 12 };
    leaning.cuts = upright.cuts;
    const sheared = resolveGlyphContours(named(leaning, "H"), leaning);

    // The sheared letter is wider, as a sheared letter is -- which is only
    // true if the shear happened after the cut, on the whole cut shape.
    const flat = contoursBounds(straight);
    const leant = contoursBounds(sheared);
    expect(leant.xMax - leant.xMin).toBeGreaterThan(flat.xMax - flat.xMin);
  });

  it("lets a letter be cut its own way instead of the font's", () => {
    const face = font();
    face.cuts = cutWith((one) => {
      one.slot.on = true;
    });
    named(face, "H").cuts = noCuts();

    expect(effectiveCuts(named(face, "H"), face)).toEqual(noCuts());
    expect(effectiveCuts(named(face, "I"), face)).toBe(face.cuts);

    // An exception standing in for the font's cuts rather than adding to them:
    // the H comes back whole while the I is cut.
    expect(ink(resolveGlyphContours(named(face, "H"), face))).toBeCloseTo(
      ink(resolveGlyphContours(named(face, "H"), font())),
      6,
    );
    expect(ink(resolveGlyphContours(named(face, "I"), face))).toBeLessThan(90 * 700);
  });

  it("leaves a font with nothing switched on exactly as it was", () => {
    const face = font();
    face.cuts = noCuts();
    const contours = resolveGlyphContours(named(face, "H"), face);
    // The same objects, not merely the same shape: an untouched letter should
    // not be rebuilt, which is what keeps a whole font's grid cheap to draw.
    expect(contours).toBe(named(face, "H").contours);
  });
});
