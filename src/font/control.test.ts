import { describe, expect, it } from "vitest";

import { deriveParams, isControlGlyph, readControls, type ControlReadings } from "./control";
import { measureGlyph } from "./measure";
import { resolveGlyphContours } from "./transform";
import { DEFAULT_PARAMS, type Contour, type Glyph, type Typeface, type Vec2 } from "./types";

function polygon(points: Vec2[]): Contour {
  return {
    closed: true,
    nodes: points.map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" })),
  };
}

function rect(x: number, y: number, width: number, height: number): Contour {
  return polygon([
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ]);
}

function glyph(name: string, contours: Contour[], advanceWidth = 1000): Glyph {
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

function typeface(glyphs: Glyph[]): Typeface {
  return {
    glyphs,
    unitsPerEm: 2048,
    kerning: [],
    kernClasses: [],
    params: { ...DEFAULT_PARAMS },
    meta: { familyName: "Test", styleName: "Regular" },
    metrics: { ascender: 1600, descender: -400, lineGap: 0 },
    revision: 0,
    source: null,
  } as unknown as Typeface;
}

function reading(name: string, contours: Contour[], advance = 1000): ControlReadings {
  const map: ControlReadings = new Map();
  const measured = measureGlyph(contours, advance);
  if (measured) map.set(name, measured);
  return map;
}

describe("control glyphs", () => {
  it("knows which letters drive the rest", () => {
    expect(isControlGlyph("n")).toBe(true);
    expect(isControlGlyph("O")).toBe(true);
    expect(isControlGlyph("zero")).toBe(true);
    expect(isControlGlyph("w")).toBe(false);
  });

  it("only reads controls the font actually has", () => {
    const readings = readControls(typeface([glyph("n", [rect(100, 0, 180, 1100)])]));
    expect([...readings.keys()]).toEqual(["n"]);
  });

  it("ignores a control with no outline", () => {
    expect(readControls(typeface([glyph("n", [])])).size).toBe(0);
  });
});

describe("deriving family parameters from a control edit", () => {
  it("reports nothing when nothing moved", () => {
    const before = reading("n", [rect(100, 0, 180, 1100)]);
    const after = reading("n", [rect(100, 0, 180, 1100)]);
    expect(deriveParams(before, after).params).toEqual({});
    expect(deriveParams(before, after).changes).toEqual([]);
  });

  it("ignores a nudge too small to be a decision", () => {
    const before = reading("n", [rect(100, 0, 180, 1100)]);
    const after = reading("n", [rect(100, 0, 182, 1100)]);
    expect(deriveParams(before, after).params.weight).toBeUndefined();
  });

  /**
   * The property the whole feature rests on: parameters derived from an edited
   * control letter, applied to the letter it was edited from, have to land on
   * the measurements that were asked for.
   *
   * Two earlier attempts failed this. Assuming weight was half the stem change
   * overshot fourfold, because emboldening moves points along an averaged
   * normal and at a corner only part of that travel widens the stem. Fitting
   * each quality independently then overshot the other way, because thickening
   * a stem also widens the ink, so weight and width were both charged for the
   * same edit.
   */
  const roundTrip = (from: Contour[], to: Contour[], advance = 1000): void => {
    const derived = deriveParams(reading("n", from, advance), reading("n", to, advance), () => from);

    const target = glyph("subject", from, advance);
    const family = typeface([target]);
    family.params = { ...DEFAULT_PARAMS, ...derived.params };

    const wanted = measureGlyph(to, advance)!;
    const got = measureGlyph(resolveGlyphContours(target, family), advance)!;

    // Within a unit. The fitted parameters are rounded before use -- weight to
    // two decimals, the scales to four -- so landing exactly on the target is
    // not available, and a unit at 2048 to the em is far below anything the eye
    // could find.
    const near = (actual: number, target: number): void => {
      expect(Math.abs(actual - target)).toBeLessThanOrEqual(1);
    };
    if (wanted.stemWidth !== null && got.stemWidth !== null) {
      near(got.stemWidth, wanted.stemWidth);
    }
    near(got.inkTop - got.inkBottom, wanted.inkTop - wanted.inkBottom);
    near(got.inkRight - got.inkLeft, wanted.inkRight - wanted.inkLeft);
  };

  it("reproduces a thickened stem", () => {
    roundTrip([rect(100, 0, 180, 1100)], [rect(90, 0, 200, 1100)]);
  });

  it("reproduces a lighter stem", () => {
    roundTrip([rect(100, 0, 180, 1100)], [rect(110, 0, 160, 1100)]);
  });

  it("reproduces a taller letter", () => {
    roundTrip([rect(100, 0, 180, 1000)], [rect(100, 0, 180, 1200)]);
  });

  it("reproduces a thicker and taller letter at once", () => {
    roundTrip([rect(100, 0, 180, 1000)], [rect(90, 0, 220, 1180)]);
  });

  it("reproduces a ring whose enclosed counter opened up", () => {
    // An o: an outer ring with a real counter inside it, which is the only
    // kind of counter the transform can move.
    roundTrip(
      [rect(0, 0, 800, 800), rect(200, 200, 400, 400)],
      [rect(0, 0, 800, 800), rect(160, 160, 480, 480)],
    );
  });

  /**
   * n, H and u keep their counter as the space between two separate stems
   * rather than inside a contour, so there is nothing for the counter
   * transform to scale. Measuring the two apart keeps a gap read off H from
   * being applied to every o in the font, where it would do real damage.
   */
  it("does not mistake the gap between two stems for an enclosed counter", () => {
    const twoStems = [rect(0, 0, 180, 1400), rect(500, 0, 180, 1400)];
    const measured = measureGlyph(twoStems, 1000)!;
    expect(measured.counterWidth).toBeCloseTo(320, 6);
    expect(measured.closedCounterWidth).toBeNull();
  });

  it("sees the counter inside a ring as enclosed", () => {
    const ring = [rect(0, 0, 800, 800), rect(200, 200, 400, 400)];
    expect(measureGlyph(ring, 1000)!.closedCounterWidth).toBeCloseTo(400, 6);
  });

  it("reads a taller letter as a height change", () => {
    const derived = deriveParams(
      reading("n", [rect(100, 0, 180, 1000)]),
      reading("n", [rect(100, 0, 180, 1100)]),
    );
    expect(derived.changes.some((change) => change.quality === "height")).toBe(true);
  });

  it("takes the middle of several controls rather than letting one dominate", () => {
    const thin = [rect(0, 0, 180, 1100)];
    const outlier = [rect(0, 0, 400, 1100)];
    const before: ControlReadings = new Map([
      ...reading("n", thin),
      ...reading("o", thin),
      ...reading("H", thin),
    ]);
    const after: ControlReadings = new Map([
      ...reading("n", [rect(0, 0, 200, 1100)]),
      ...reading("o", [rect(0, 0, 204, 1100)]),
      ...reading("H", outlier),
    ]);

    const combined = deriveParams(before, after, () => thin).params.weight!;
    const each = [[rect(0, 0, 200, 1100)], [rect(0, 0, 204, 1100)], outlier].map(
      (shape) => deriveParams(reading("n", thin), reading("n", shape), () => thin).params.weight!,
    );
    const middle = [...each].sort((a, b) => a - b)[1];

    // The far-out third letter must not carry the family: the answer is the
    // middle of the three, not anywhere near the extreme one.
    expect(combined).toBeCloseTo(middle, 1);
    expect(Math.abs(combined - each[2])).toBeGreaterThan(Math.abs(combined - each[0]));
  });

  it("names which letter and which quality changed, for showing the user", () => {
    const derived = deriveParams(
      reading("n", [rect(100, 0, 180, 1100)]),
      reading("n", [rect(90, 0, 200, 1100)]),
    );
    const stem = derived.changes.find((change) => change.quality === "stem");
    expect(stem?.glyph).toBe("n");
    expect(stem?.from).toBeCloseTo(180, 6);
    expect(stem?.to).toBeCloseTo(200, 6);
  });
});

describe("opening a counter", () => {
  /**
   * Regression: counterScale used to scale the whole letter.
   *
   * A counter was identified by asking whether a contour's centroid fell inside
   * another contour, which is true of both contours of an o -- they are
   * concentric, so each centre lies within the other. Both were scaled, so
   * "middle space" uniformly enlarged the letter and left the counter the same
   * size relative to it. On a ring of 0..800 with a counter of 200..600, asking
   * for 1.5 gave an outer of -200..1000 and a counter of 100..700.
   */
  it("moves the counter and leaves the outside of the letter where it was", () => {
    const ring = [rect(0, 0, 800, 800), rect(200, 200, 400, 400)];
    const target = glyph("o", ring);
    const family = typeface([target]);
    family.params = { ...DEFAULT_PARAMS, counterScale: 1.5 };

    const resolved = resolveGlyphContours(target, family);
    const outer = measureGlyph([resolved[0]], 1000)!;
    const counter = measureGlyph([resolved[1]], 1000)!;

    expect(outer.inkLeft).toBeCloseTo(0, 6);
    expect(outer.inkRight).toBeCloseTo(800, 6);
    expect(counter.inkRight - counter.inkLeft).toBeCloseTo(600, 6);
  });

  it("closes a counter as well as opening one", () => {
    const ring = [rect(0, 0, 800, 800), rect(200, 200, 400, 400)];
    const target = glyph("o", ring);
    const family = typeface([target]);
    family.params = { ...DEFAULT_PARAMS, counterScale: 0.5 };

    const resolved = resolveGlyphContours(target, family);
    expect(measureGlyph([resolved[0]], 1000)!.inkRight).toBeCloseTo(800, 6);
    const counter = measureGlyph([resolved[1]], 1000)!;
    expect(counter.inkRight - counter.inkLeft).toBeCloseTo(200, 6);
  });
});
