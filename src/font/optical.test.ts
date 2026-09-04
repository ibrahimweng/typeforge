/**
 * That the advice is right about a well-drawn font before it is right about a
 * badly drawn one.
 *
 * Which way round these are written matters more here than anywhere else in
 * this codebase. Every rule in `optical.ts` can be deliberately unfollowed --
 * a geometric face may want no overshoot, a modular one may want every stroke
 * identical -- so the failure that costs something is not a missed fault, it
 * is advice offered about work that was already right. That is what teaches
 * somebody to stop reading the report, and after that the checks that catch
 * real faults are gone too.
 *
 * So each of these is asked twice: once of a letter drawn the way the
 * tradition asks, where the answer must be silence, and once of the same
 * letter drawn the other way.
 */

import { describe, expect, it } from "vitest";

import { emptyTypeface, type Contour, type Glyph, type Typeface, type Vec2 } from "./types";
import { ellipse } from "./shapes";
import { opticalAdvice } from "./optical";
import { validateTypeface } from "./validate";

/*
 * Advance widths differ from letter to letter, which matters: a font whose
 * letters are all one width is a monospaced font, and the stem check stands
 * down on one. All the glyphs here carried 500 at first, and every stem test
 * silently passed by being skipped.
 */
let nextWidth = 400;

function glyph(name: string, contours: Contour[]): Glyph {
  return {
    name,
    unicodes: [],
    advanceWidth: (nextWidth += 7),
    contours,
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

const poly = (points: Array<[number, number]>): Contour => ({
  closed: true,
  nodes: points.map(([x, y]) => ({
    point: { x, y } as Vec2,
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  })),
});

/** An upright bar: the shape a stem is, for measuring one. */
const bar = (x: number, width: number, from: number, to: number): Contour =>
  poly([
    [x, from],
    [x + width, from],
    [x + width, to],
    [x, to],
  ]);

/**
 * A leaning bar of constant horizontal width.
 *
 * Not a real `V`, and deliberately: the measurement asks how wide the leftmost
 * run is and how far its middle moves between two heights, and a parallelogram
 * answers both exactly. A drawn `V` would answer them approximately and turn
 * every number below into a tolerance.
 */
const leaning = (bottom: number, top: number, width: number, from: number, to: number): Contour =>
  poly([
    [bottom, from],
    [bottom + width, from],
    [top + width, to],
    [top, to],
  ]);

/** A `V` as two leaning bars, the left one of the given horizontal width. */
const vee = (width: number): Contour[] => [
  leaning(240, 60, width, 0, 700),
  leaning(240, 420, width, 0, 700),
];

function font(glyphs: Glyph[]): Typeface {
  const typeface = emptyTypeface();
  typeface.meta.familyName = "Test";
  typeface.glyphs = glyphs;
  typeface.glyphIndex = new Map(glyphs.map((one, index) => [one.name, index]));
  return typeface;
}

const advice = (typeface: Typeface): string[] => opticalAdvice(typeface).map((one) => one.check);

/*
 * A small alphabet drawn the way the tradition asks, on the default metrics:
 * five hundred to the x-height, seven hundred to the cap.
 *
 * Every letter below is the answer to one of the checks, drawn right. Each
 * test that wants a fault replaces exactly one of them.
 */
const RIGHT = {
  // Eight units past the x-height, which is one and a half per cent of it.
  o: glyph("o", [ellipse({ xMin: 40, yMin: -8, xMax: 440, yMax: 508 }, false)]),
  e: glyph("e", [ellipse({ xMin: 40, yMin: -8, xMax: 420, yMax: 508 }, false)]),
  O: glyph("O", [ellipse({ xMin: 40, yMin: -10, xMax: 520, yMax: 710 }, false)]),
  C: glyph("C", [ellipse({ xMin: 40, yMin: -10, xMax: 500, yMax: 710 }, false)]),
  n: glyph("n", [bar(40, 80, 0, 500), bar(280, 80, 0, 380)]),
  i: glyph("i", [bar(40, 80, 0, 500), bar(30, 100, 560, 660)]),
  H: glyph("H", [bar(40, 80, 0, 700), bar(300, 80, 0, 700), bar(40, 340, 310, 390)]),
  E: glyph("E", [
    bar(40, 80, 0, 700),
    bar(40, 360, 0, 90),
    bar(40, 290, 305, 385),
    bar(40, 360, 610, 700),
  ]),
  F: glyph("F", [bar(40, 80, 0, 700), bar(40, 290, 305, 385), bar(40, 360, 610, 700)]),
  // Ninety across the ruler is about eighty-seven across the stroke, which is
  // heavier than the eighty-unit upright next to it.
  V: glyph("V", vee(90)),
};

/** The alphabet above, with the given letters swapped in or added to it. */
const drawnRight = (...replacing: Glyph[]): Typeface => {
  const swap = new Map(replacing.map((one) => [one.name, one]));
  const kept = Object.values(RIGHT).map((one) => swap.get(one.name) ?? one);
  const names = new Set(kept.map((one) => one.name));
  return font([...kept, ...replacing.filter((one) => !names.has(one.name))]);
};

describe("a font drawn the way the tradition asks", () => {
  it("is offered no advice at all", () => {
    /*
     * The test that matters. Advice about work that was already right is what
     * teaches somebody to stop reading the report, and after that the checks
     * that catch real faults are gone with it.
     */
    expect(advice(drawnRight())).toEqual([]);
  });

  it("says nothing about letters the font does not have", () => {
    // Most of these need a named letter, and a font of forty glyphs has few of
    // them. Standing down silently is the only tolerable answer.
    expect(advice(font([glyph("A", [bar(0, 80, 0, 700)])]))).toEqual([]);
    expect(advice(font([]))).toEqual([]);
  });
});

describe("overshoot", () => {
  it("is asked for when the round letters sit flat on the line", () => {
    const flat = glyph("o", [ellipse({ xMin: 40, yMin: 0, xMax: 440, yMax: 500 }, false)]);
    const flatToo = glyph("e", [ellipse({ xMin: 40, yMin: 0, xMax: 420, yMax: 500 }, false)]);
    expect(advice(drawnRight(flat, flatToo))).toContain("overshoot-missing-lower");
  });

  it("is not asked for when it is there, however small", () => {
    // One and a half per cent is inside the convention. The check is looking
    // for none rather than for less than somebody would choose.
    expect(advice(drawnRight())).not.toContain("overshoot-missing-lower");
  });

  it("is asked about when two round letters disagree", () => {
    // Eight units on the o against thirty on the e is not a decision, it is
    // two letters drawn on different days.
    const wandering = glyph("e", [ellipse({ xMin: 40, yMin: -8, xMax: 420, yMax: 530 }, false)]);
    expect(advice(drawnRight(wandering))).toContain("overshoot-uneven-lower");
  });

  it("keeps the capitals' answer separate from the lowercase one", () => {
    const flat = glyph("O", [ellipse({ xMin: 40, yMin: 0, xMax: 520, yMax: 700 }, false)]);
    const flatToo = glyph("C", [ellipse({ xMin: 40, yMin: 0, xMax: 500, yMax: 700 }, false)]);
    const said = advice(drawnRight(flat, flatToo));
    expect(said).toContain("overshoot-missing-upper");
    expect(said).not.toContain("overshoot-missing-lower");
  });
});

describe("stems", () => {
  it("are asked about when two that should match do not", () => {
    // Measured on `n`, `m` and `u`, whose whole height is the stem's height.
    // An `i` carries a dot above the line and an `l` is an ascender, so a
    // fraction of either's box is a fraction of the wrong thing.
    const thin = glyph("u", [bar(40, 60, 0, 500), bar(280, 60, 0, 500)]);
    expect(advice(drawnRight(thin))).toContain("stems-disagree-lower");
  });

  it("are not judged at all in a monospaced face", () => {
    /*
     * An `m` has to fit three stems into the width a `u` uses for two, so its
     * stems come out thinner and there is nothing else they could have done.
     * Both monospaced faces on this machine were reported for it before this,
     * and both are drawn exactly as a monospaced face has to be.
     */
    const thin = glyph("u", [bar(40, 60, 0, 500), bar(280, 60, 0, 500)]);
    const typeface = drawnRight(thin);
    for (const one of typeface.glyphs) one.advanceWidth = 600;
    expect(advice(typeface)).not.toContain("stems-disagree-lower");
  });

  it("are left alone when the capitals are heavier than the lowercase", () => {
    /*
     * A capital carries a little more weight than a lowercase because it is
     * taller, so the two are asked separately and neither is asked about the
     * other. A check that compared them would fire on almost every text face
     * ever drawn.
     */
    const heavier = glyph("H", [bar(40, 92, 0, 700), bar(300, 92, 0, 700), bar(40, 340, 310, 390)]);
    const heavierE = glyph("E", [
      bar(40, 92, 0, 700),
      bar(40, 360, 0, 90),
      bar(40, 290, 305, 385),
      bar(40, 360, 610, 700),
    ]);
    const heavierF = glyph("F", [
      bar(40, 92, 0, 700),
      bar(40, 290, 305, 385),
      bar(40, 360, 610, 700),
    ]);
    const said = advice(drawnRight(heavier, heavierE, heavierF));
    expect(said).not.toContain("stems-disagree-lower");
    expect(said).not.toContain("stems-disagree-upper");
  });
});

describe("the flat letters", () => {
  const flat = (name: string, top: number): Glyph =>
    glyph(name, [bar(40, 80, 0, top), bar(280, 80, 0, top)]);

  it("are asked about when one does not sit where the rest do", () => {
    const said = advice(drawnRight(flat("x", 500), flat("z", 500), flat("u", 470)));
    expect(said).toContain("height-drift-lower");
  });

  it("are not asked about a rounding", () => {
    const said = advice(drawnRight(flat("x", 500), flat("z", 500), flat("u", 498)));
    expect(said).not.toContain("height-drift-lower");
  });

  it("blame the metric rather than the letters when the letters agree", () => {
    /*
     * A font whose x-height was never set has every flat letter "drifting"
     * from a default nobody chose. Saying that five times, about five letters
     * drawn perfectly consistently, would bury the case where one letter
     * really has moved.
     */
    const said = advice(drawnRight(flat("x", 540), flat("z", 540), flat("u", 540)));
    expect(said).toContain("xheight-declared");
    expect(said).not.toContain("height-drift-lower");
  });

  it("leave out the letters whose top is not the line", () => {
    /*
     * The correction real fonts forced, three times over. The top of an `i`'s
     * box is its dot; the top of an `r`'s is its terminal; and the top of an
     * `n`'s is its shoulder, which is a curve and overshoots exactly as an `o`
     * does. All three are letters drawn right, and all three were reported.
     */
    const shoulderOvershoot = glyph("n", [bar(40, 80, 0, 500), bar(280, 80, 0, 527)]);
    const risingTerminal = glyph("r", [bar(40, 80, 0, 500), bar(160, 80, 400, 530)]);
    expect(advice(drawnRight(shoulderOvershoot, risingTerminal, flat("x", 500)))).not.toContain(
      "height-drift-lower",
    );
  });
});

describe("the arms of E and F", () => {
  it("say nothing when the middle arm is the shortest, and nothing when all three match", () => {
    expect(advice(drawnRight())).not.toContain("e-middle-arm");
    const even = glyph("E", [
      bar(40, 80, 0, 700),
      bar(40, 360, 0, 90),
      bar(40, 360, 305, 385),
      bar(40, 360, 610, 700),
    ]);
    // Equal arms are a decision a geometric face makes on purpose.
    expect(advice(drawnRight(even))).not.toContain("e-middle-arm");
  });

  it("are asked about when the middle arm is the longest", () => {
    // The one nobody draws deliberately.
    const bulging = glyph("E", [
      bar(40, 80, 0, 700),
      bar(40, 360, 0, 90),
      bar(40, 400, 305, 385),
      bar(40, 360, 610, 700),
    ]);
    expect(advice(drawnRight(bulging))).toContain("e-middle-arm");
  });

  it("say nothing about an F drawn narrower than its E", () => {
    /*
     * There was a check for this, on the reasoning that an `F` is an `E`
     * without its foot. Real fonts disagreed: DejaVu draws its `F` a hundred
     * and sixteen units narrower than its `E`, on purpose, and so do plenty of
     * others.
     */
    const narrow = glyph("F", [
      bar(40, 80, 0, 700),
      bar(40, 290, 305, 385),
      bar(40, 320, 610, 700),
    ]);
    expect(advice(drawnRight(narrow))).toEqual([]);
  });
});

describe("the diagonals", () => {
  it("are not judged at all, because there was no rule to judge them by", () => {
    /*
     * A check here asked whether a face had drawn its diagonals lighter than
     * its stems, on the reasoning that nobody compensates in that direction on
     * purpose. Against eight fonts shipping on this machine it fired on five,
     * at between ten and twelve per cent lighter every time -- which is a
     * convention rather than five faults, and the opposite of the one the rule
     * expected. Where two diagonals meet the ink concentrates and reads dark,
     * and thinning them is how that is answered.
     */
    const light = glyph("V", vee(50));
    expect(advice(drawnRight(light))).toEqual([]);
  });
});

describe("the dot on the i", () => {
  it("is asked about when it is narrower than its own stem", () => {
    const mean = glyph("i", [bar(40, 80, 0, 500), bar(50, 60, 560, 660)]);
    expect(advice(drawnRight(mean))).toContain("dot-narrower-than-stem");
  });

  it("says nothing when it is the stem's width or more", () => {
    const exact = glyph("i", [bar(40, 80, 0, 500), bar(40, 80, 560, 660)]);
    expect(advice(drawnRight(exact))).not.toContain("dot-narrower-than-stem");
    expect(advice(drawnRight())).not.toContain("dot-narrower-than-stem");
  });
});

describe("what the report does with it", () => {
  it("arrives as advice rather than as a fault", () => {
    const flat = glyph("o", [ellipse({ xMin: 40, yMin: 0, xMax: 440, yMax: 500 }, false)]);
    const flatToo = glyph("e", [ellipse({ xMin: 40, yMin: 0, xMax: 420, yMax: 500 }, false)]);
    const report = validateTypeface(drawnRight(flat, flatToo));
    const found = report.findings.find((one) => one.check === "overshoot-missing-lower");
    expect(found?.severity).toBe("advice");
    // And is not counted among the things that are wrong.
    expect(report.errors).toBe(report.findings.filter((f) => f.severity === "error").length);
    expect(report.warnings).toBe(report.findings.filter((f) => f.severity === "warning").length);
  });

  it("sorts under the faults and above the notes", () => {
    const report = validateTypeface(drawnRight());
    const ranks = report.findings.map((one) =>
      ["error", "warning", "advice", "info"].indexOf(one.severity),
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});
