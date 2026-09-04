import { describe, expect, it } from "vitest";

import { emptyTypeface, type Contour, type Glyph, type Typeface } from "./types";
import { faultsOfGlyph, validateTypeface, validateWholeTypeface } from "./validate";
import { masterFrom, soleMaster } from "./master";

function glyph(name: string, contours: Contour[] = [], unicodes: number[] = []): Glyph {
  return {
    name,
    unicodes,
    advanceWidth: 500,
    contours,
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

const square = (size = 100): Contour => ({
  closed: true,
  nodes: [
    { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: size, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: size, y: size }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 0, y: size }, handleIn: null, handleOut: null, type: "corner" },
  ],
});

function font(glyphs: Glyph[]): Typeface {
  const typeface = emptyTypeface();
  typeface.meta.familyName = "Test";
  typeface.glyphs = glyphs;
  typeface.glyphIndex = new Map(glyphs.map((g, i) => [g.name, i]));
  return typeface;
}

const has = (typeface: Typeface, check: string): boolean =>
  validateTypeface(typeface).findings.some((f) => f.check === check);

describe("font structure", () => {
  it("wants a .notdef glyph", () => {
    expect(has(font([glyph("A", [square()])]), "notdef-missing")).toBe(true);
    expect(has(font([glyph(".notdef"), glyph("A", [square()])]), "notdef-missing")).toBe(false);
  });

  it("wants .notdef first", () => {
    expect(has(font([glyph("A", [square()]), glyph(".notdef")]), "notdef-position")).toBe(true);
  });

  it("catches a codepoint claimed by two glyphs", () => {
    const typeface = font([
      glyph(".notdef"),
      glyph("A", [square()], [65]),
      glyph("A.alt", [square()], [65]),
    ]);
    expect(has(typeface, "duplicate-codepoints")).toBe(true);
  });

  it("accepts a sound font quietly", () => {
    const typeface = font([glyph(".notdef"), glyph("A", [square()], [65])]);
    const report = validateTypeface(typeface);
    expect(report.errors).toBe(0);
  });
});

describe("vertical metrics", () => {
  it("catches a positive descender", () => {
    const typeface = font([glyph(".notdef")]);
    typeface.metrics.descender = 200;
    expect(has(typeface, "descender-sign")).toBe(true);
  });

  it("notes a non-zero line gap", () => {
    const typeface = font([glyph(".notdef")]);
    typeface.metrics.lineGap = 120;
    expect(has(typeface, "line-gap")).toBe(true);
  });

  it("notices lowercase taller than capitals", () => {
    const typeface = font([glyph(".notdef")]);
    typeface.metrics.xHeight = 800;
    typeface.metrics.capHeight = 700;
    expect(has(typeface, "x-height-above-cap")).toBe(true);
  });
});

describe("glyph outlines", () => {
  it("catches a contour that encloses nothing", () => {
    const stray: Contour = {
      closed: true,
      nodes: [{ point: { x: 10, y: 10 }, handleIn: null, handleOut: null, type: "corner" }],
    };
    expect(has(font([glyph(".notdef"), glyph("A", [stray])]), "stray-points")).toBe(true);
  });

  it("does not mistake a two-node ellipse for a stray point", () => {
    // A circle drawn as two nodes with handles is a normal, valid contour.
    const ellipse: Contour = {
      closed: true,
      nodes: [
        {
          point: { x: 0, y: 50 },
          handleIn: { x: 0, y: 78 },
          handleOut: { x: 0, y: 22 },
          type: "smooth",
        },
        {
          point: { x: 100, y: 50 },
          handleIn: { x: 100, y: 22 },
          handleOut: { x: 100, y: 78 },
          type: "smooth",
        },
      ],
    };
    expect(has(font([glyph(".notdef"), glyph("o", [ellipse])]), "stray-points")).toBe(false);
  });

  it("catches an unclosed contour", () => {
    const open: Contour = { ...square(), closed: false };
    expect(has(font([glyph(".notdef"), glyph("A", [open])]), "open-contour")).toBe(true);
  });

  it("catches a negative advance width", () => {
    const g = glyph("A", [square()]);
    g.advanceWidth = -10;
    expect(has(font([glyph(".notdef"), g]), "negative-advance")).toBe(true);
  });

  it("catches two points in the same place", () => {
    const doubled: Contour = {
      closed: true,
      nodes: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 100, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 100, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 50, y: 90 }, handleIn: null, handleOut: null, type: "corner" },
      ],
    };
    expect(has(font([glyph(".notdef"), glyph("A", [doubled])]), "duplicate-points")).toBe(true);
  });

  it("counts errors and warnings separately", () => {
    const g = glyph("A", [square()]);
    g.advanceWidth = -10;
    const report = validateTypeface(font([g])); // no .notdef either
    expect(report.errors).toBeGreaterThanOrEqual(2);
    expect(report.findings.every((f) => f.title.length > 0 && f.detail.length > 0)).toBe(true);
  });
});

describe("a font drawn on top of somebody else's", () => {
  /*
   * The one finding here that is about a licence rather than about a file
   * working. An exported font carries the family name, designer, copyright
   * and licence of whatever it was opened from, and until this check existed
   * nothing in the application ever said so.
   */
  const opened = (dirty: boolean): Typeface => {
    const one = glyph("A", [square()]);
    one.dirty = dirty;
    const typeface = font([glyph(".notdef", [square()]), one]);
    typeface.meta.familyName = "Somebody Else Sans";
    // Only its presence matters here: the check asks whether the font came
    // from a file, not what was in it.
    typeface.source = {
      bytes: new Uint8Array(0),
      sfntVersion: 0x00010000,
      tables: new Map(),
      isCFF: false,
      fileName: "SomebodyElseSans.ttf",
    };
    return typeface;
  };

  it("says so once a letter has been changed", () => {
    expect(has(opened(true), "derivative-unnamed")).toBe(true);
  });

  it("says nothing about a font that is only being looked at", () => {
    // Opening somebody's font to read it is not a licensing question.
    expect(has(opened(false), "derivative-unnamed")).toBe(false);
  });

  it("says nothing about a font that came from nowhere", () => {
    const one = glyph("A", [square()]);
    one.dirty = true;
    expect(has(font([glyph(".notdef", [square()]), one]), "derivative-unnamed")).toBe(false);
  });
});

/*
 * Checking a whole font without stopping the page.
 *
 * The check is two seconds of arithmetic on six thousand glyphs and it was all
 * spent in one go on the thread that draws the page. What kept that from
 * freezing the tab was a cap of five thousand -- which is not a fix. It is a
 * decision to check four fifths of somebody's font and print "0 errors"
 * underneath, and nothing on screen could tell that apart from a clean result.
 */
describe("checking the whole font", () => {
  /** A font of `n` glyphs, every one of them with an unclosed contour. */
  const manyBroken = (n: number): Typeface => {
    const open = (name: string) =>
      glyph(name, [
        {
          nodes: [
            { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
            { point: { x: 100, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
            { point: { x: 100, y: 100 }, handleIn: null, handleOut: null, type: "corner" },
          ],
          closed: false,
        },
      ]);
    return font([glyph(".notdef"), ...Array.from({ length: n }, (_, i) => open(`g${i}`))]);
  };

  it("looks at every glyph, past where the cap used to be", async () => {
    /*
     * Five thousand and one, which is the only size that tests this: the cap
     * was five thousand, so a font of six hundred is examined whole either
     * way and a test built on one would pass with the cap still in place.
     * These carry no contours, which is what keeps a font this size cheap
     * enough to check twice in a unit test.
     */
    const typeface = font([
      glyph(".notdef"),
      ...Array.from({ length: 5001 }, (_, i) => glyph(`g${i}`)),
    ]);
    const report = await validateWholeTypeface(typeface, { format: "truetype" }, undefined, () =>
      Promise.resolve(),
    );
    expect(report.examined).toBe(5002);
    expect(report.held).toBe(5002);
    // And the synchronous one no longer stops there either.
    expect(validateTypeface(typeface).examined).toBe(5002);
  });

  /*
   * One finding for the font, not one per batch.
   *
   * The faults are gathered a batch at a time and worded once at the end, and
   * the order matters: worded per batch, a font would report the same fault
   * three times over with a third of its glyphs named in each, and the count
   * beside it would be wrong every time.
   */
  it("rolls a fault up across batches, not within one", async () => {
    const report = await validateWholeTypeface(
      manyBroken(600),
      { format: "truetype" },
      undefined,
      () => Promise.resolve(),
    );
    const open = report.findings.filter((one) => one.check === "open-contour");
    expect(open).toHaveLength(1);
    expect(open[0].count).toBe(600);
  });

  it("says how far through it is, and finishes at the end", async () => {
    const seen: number[] = [];
    const typeface = manyBroken(600);
    await validateWholeTypeface(
      typeface,
      { format: "truetype" },
      (progress) => {
        expect(progress.total).toBe(typeface.glyphs.length);
        seen.push(progress.done);
      },
      () => Promise.resolve(),
    );
    // Rising, starting at nothing, and ending on the whole font: a bar that
    // stops short of its own end is how a finished job looks stuck.
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(typeface.glyphs.length);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(seen.length).toBeGreaterThan(1);
  });

  it("finishes on its own breath, without one being handed in", async () => {
    /*
     * The other tests here drive it with an instant breath so they do not wait
     * on real timers, which means none of them touches the one it uses by
     * itself -- and that is the one that runs in the application.
     */
    const report = await validateWholeTypeface(manyBroken(60), { format: "truetype" });
    expect(report.examined).toBe(61);
    expect(report.findings.some((one) => one.check === "open-contour")).toBe(true);
  });

  it("gives the same answer as doing it in one go", async () => {
    const typeface = manyBroken(600);
    const chunked = await validateWholeTypeface(typeface, { format: "truetype" }, undefined, () =>
      Promise.resolve(),
    );
    const straight = validateTypeface(typeface, { format: "truetype" });
    expect(chunked.findings).toEqual(straight.findings);
    expect(chunked.examined).toBe(straight.examined);
  });
});

describe("one letter, asked about itself", () => {
  /*
   * The same seven checks the whole-font report runs, asked of a single glyph
   * so the answer can be shown over the canvas while the pen is in your hand.
   * What is being pinned is that it says something about *this* letter and
   * nothing about any other, and that a sound letter produces nothing at all.
   */
  /*
   * Wound clockwise, which is what TrueType wants of an outer contour and
   * which the `square` above is not: writing this found that the "clean"
   * letter these tests were built on was tripping the direction check, and a
   * test of "says nothing" has to be handed something there is nothing to say
   * about.
   */
  const sound = (size = 100): Contour => ({
    closed: true,
    nodes: [
      { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: 0, y: size }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: size, y: size }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: size, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    ],
  });

  const open = (): Contour => ({
    closed: false,
    nodes: [
      { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: 100, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: 100, y: 100 }, handleIn: null, handleOut: null, type: "corner" },
    ],
  });

  it("says nothing about a letter with nothing wrong", () => {
    const good = glyph("o", [sound()]);
    expect(faultsOfGlyph(font([good]), good)).toEqual([]);
  });

  it("names the fault, in the second person, about the letter", () => {
    const bad = glyph("e", [open()]);
    const found = faultsOfGlyph(font([bad]), bad);
    expect(found.map((f) => f.check)).toContain("open-contour");
    const contour = found.find((f) => f.check === "open-contour")!;
    expect(contour.severity).toBe("error");
    expect(contour.glyph).toBe("e");
    // The report says "3 glyphs have an unclosed contour. First: a, e, n";
    // in front of one letter the useful sentence counts nothing.
    expect(contour.title).toBe("An outline is not closed");
    expect(contour.count).toBeUndefined();
  });

  it("asks only about the letter it was handed", () => {
    const good = glyph("o", [sound()]);
    const bad = glyph("e", [open()]);
    expect(faultsOfGlyph(font([good, bad]), good)).toEqual([]);
  });

  it("reports a negative width, which is the fault that runs text backwards", () => {
    const bad = { ...glyph("n", [sound()]), advanceWidth: -10 };
    const found = faultsOfGlyph(font([bad]), bad);
    expect(found[0].check).toBe("negative-advance");
    expect(found[0].severity).toBe("error");
  });
});

describe("how much of the font will move", () => {
  /*
   * A weight is stored as the difference from the first one, and there is none
   * to store where two drawings are not the same points in the same order. The
   * exporter copes -- the letter stands at the default and is named in the
   * notes -- but the notes are written after the file is.
   */
  const closed = (nodes: number): Contour => ({
    closed: true,
    nodes: Array.from({ length: nodes }, (_, at) => ({
      point: { x: at * 10, y: 0 },
      handleIn: null,
      handleOut: null,
      type: "corner" as const,
    })),
  });

  it("says nothing at all about a font with one weight", () => {
    const one = font([glyph("a", [closed(4)])]);
    expect(has(one, "will-not-vary")).toBe(false);
  });

  it("counts the letters that will stand still, and names the first", () => {
    const one = font([glyph("a", [closed(4)]), glyph("b", [closed(4)])]);
    const bold = masterFrom(one, "Bold", {}, "m2");
    bold.typeface.glyphs[0].contours = [closed(6)];

    const report = validateTypeface(one, { masters: [soleMaster(one), bold] });
    const finding = report.findings.find((one) => one.check === "will-not-vary")!;
    expect(finding).toBeDefined();
    expect(finding.severity).toBe("warning");
    expect(finding.count).toBe(1);
    expect(finding.glyph).toBe("a");
    expect(finding.detail).toContain("Regular");
  });

  it("says nothing when the weights only moved the points", () => {
    const one = font([glyph("a", [closed(4)])]);
    const bold = masterFrom(one, "Bold", {}, "m2");
    bold.typeface.glyphs[0].contours[0].nodes[1].point.x = 400;
    expect(
      validateTypeface(one, { masters: [soleMaster(one), bold] }).findings.some(
        (finding) => finding.check === "will-not-vary",
      ),
    ).toBe(false);
  });
});
