import { describe, expect, it } from "vitest";

import {
  followPens,
  inkOf,
  nearestStop,
  nodeFractions,
  penAtNodes,
  penOf,
  reswept,
  STARTING_PENS,
  type SavedPen,
} from "./written";
import { nibAt } from "./sweep";
import { DEFAULT_PARAMS, type Glyph } from "@/font/types";
import type { QuillSpine, QuillStroke } from "./types";

/** A spine of two straight cubics, the second twice the length of the first. */
const bent = (): QuillSpine => ({
  segments: [
    {
      kind: "cubic",
      from: { x: 0, y: 0 },
      c1: { x: 0, y: 0 },
      c2: { x: 100, y: 0 },
      to: { x: 100, y: 0 },
    },
    {
      kind: "cubic",
      from: { x: 100, y: 0 },
      c1: { x: 100, y: 0 },
      c2: { x: 300, y: 0 },
      to: { x: 300, y: 0 },
    },
  ],
  closed: false,
});

const written = (spine: QuillSpine): QuillStroke => ({
  spine,
  width: [{ at: 0, width: 90 }],
  nib: penAtNodes(spine, [{ at: 0, contrast: 0.5, angle: 30 }]),
  start: { kind: "butt" },
  end: { kind: "butt" },
  join: "round",
});

const glyphWith = (strokes: QuillStroke[]): Glyph => ({
  name: "test",
  unicodes: [],
  advanceWidth: 500,
  contours: [],
  components: [],
  anchors: [],
  params: { ...DEFAULT_PARAMS },
  dirty: false,
  written: { strokes },
});

describe("a letter written with a pen", () => {
  /*
   * The pen's stops sit by arc length, and a node's own fraction is where it
   * falls along the whole spine rather than which segment it ends.
   *
   * Worth pinning because the alternative -- one stop per node, indexed by node
   * -- is what every other engine with this feature does, and it is wrong for
   * the reason the second and third numbers below show: two segments of
   * different lengths do not put their meeting halfway.
   */
  it("puts a stop at every node, by length along the spine", () => {
    const fractions = nodeFractions(bent());
    expect(fractions).toHaveLength(3);
    expect(fractions[0]).toBeCloseTo(0, 6);
    expect(fractions[1]).toBeCloseTo(1 / 3, 6);
    expect(fractions[2]).toBeCloseTo(1, 6);
  });

  it("gives a fresh stroke the same pen at every stop", () => {
    const pen = penAtNodes(bent(), [{ at: 0, contrast: 0.5, angle: 30 }]);
    expect(pen).toHaveLength(3);
    expect(pen.every((stop) => stop.contrast === 0.5 && stop.angle === 30)).toBe(true);
  });

  /*
   * And turning it at one stop turns it only from there, which is the whole
   * point of stops rather than one pen per stroke.
   */
  it("turns the pen from the stop that was changed", () => {
    const stroke = written(bent());
    stroke.nib[2] = { ...stroke.nib[2], angle: 110 };
    expect(nibAt(stroke.nib, 0).angle).toBeCloseTo(30, 6);
    expect(nibAt(stroke.nib, 1 / 3).angle).toBeCloseTo(30, 6);
    // Two thirds of the way from the middle stop to the end.
    expect(nibAt(stroke.nib, 2 / 3).angle).toBeCloseTo(70, 6);
    expect(nibAt(stroke.nib, 1).angle).toBeCloseTo(110, 6);
  });

  it("finds the stop nearest a place along the spine", () => {
    const pen = penAtNodes(bent(), [{ at: 0, contrast: 0, angle: 0 }]);
    expect(nearestStop(pen, 0)).toBe(0);
    expect(nearestStop(pen, 0.3)).toBe(1);
    expect(nearestStop(pen, 0.9)).toBe(2);
  });

  /*
   * The ink is kept in step with the strokes, which is what lets the rest of
   * the application go on reading contours and never learn that a pen was
   * involved.
   */
  it("sweeps the strokes into the letter's own outlines", () => {
    const glyph = glyphWith([written(bent())]);
    expect(glyph.contours).toHaveLength(0);
    const after = reswept(glyph, 1000);
    expect(after.contours.length).toBeGreaterThan(0);
    expect(inkOf(glyph.written!.strokes, 1000).length).toBe(after.contours.length);
  });

  /*
   * Except once the ink has been taken. There the outlines are the letter and
   * the strokes are only a way back, so re-sweeping would throw away whatever
   * was done to them -- which is the whole reason Expand is a thing to warn
   * people about in every other tool that has it.
   */
  it("leaves an expanded letter's outlines alone", () => {
    const glyph = glyphWith([written(bent())]);
    const baked = reswept(glyph, 1000);
    baked.written!.expanded = true;
    const edited = { ...baked, contours: [] };
    expect(reswept(edited, 1000).contours).toHaveLength(0);
  });

  it("draws nothing at all from no strokes", () => {
    expect(inkOf([], 1000)).toEqual([]);
    const glyph = glyphWith([]);
    expect(reswept(glyph, 1000).contours).toHaveLength(0);
  });
});

/*
 * Saved pens, which are the answer to the complaint that started all of this.
 *
 * Forty letters look like one family because they share three pens, and not
 * because somebody kept forty sets of numbers in line by hand -- which is the
 * work that needs the expertise nobody should have to have.
 */
describe("a pen with a name", () => {
  const thick: SavedPen = {
    id: "thick",
    name: "Thick",
    width: 120,
    contrast: 0.8,
    angle: 40,
  };

  it("gives a stop that names it its own values", () => {
    const stop = { at: 0, contrast: 0, angle: 0, pen: "thick" };
    expect(penOf(stop, [thick])).toEqual({ contrast: 0.8, angle: 40 });
  });

  /*
   * The saved pen wins, always. A stop that named a pen and also held its own
   * numbers would be a font quietly lying about which pen it uses, which is how
   * these caches drift in every tool that has them.
   */
  it("ignores what the stop holds of its own", () => {
    const stale = { at: 0, contrast: 0.1, angle: 90, pen: "thick" };
    expect(penOf(stale, [thick])).toEqual({ contrast: 0.8, angle: 40 });
  });

  it("leaves a stop that names nothing alone", () => {
    const own = { at: 0, contrast: 0.3, angle: 15 };
    expect(penOf(own, [thick])).toEqual({ contrast: 0.3, angle: 15 });
  });

  /*
   * And a name that no longer exists falls back to the stop, so deleting a pen
   * leaves the letters looking as they did rather than resetting them all to
   * round.
   */
  it("falls back to the stop for a pen that is gone", () => {
    const orphan = { at: 0, contrast: 0.6, angle: 22, pen: "deleted" };
    expect(penOf(orphan, [thick])).toEqual({ contrast: 0.6, angle: 22 });
  });

  it("brings every stroke that follows a pen back into line with it", () => {
    const spine = bent();
    const stroke: QuillStroke = {
      spine,
      width: [{ at: 0, width: 20 }],
      nib: penAtNodes(spine, [{ at: 0, contrast: 0, angle: 0, pen: "thick" }]),
      start: { kind: "butt" },
      end: { kind: "butt" },
      join: "round",
    };
    const [followed] = followPens([stroke], [thick]);
    // The width comes from the pen too: a "thick" that is thick only in its
    // blade ratio is not what anybody means by the word.
    expect(followed.width[0].width).toBe(120);
    expect(followed.nib.every((stop) => stop.contrast === 0.8 && stop.angle === 40)).toBe(true);
  });

  it("leaves a stroke that follows nothing where it is", () => {
    const spine = bent();
    const stroke = written(spine);
    const [same] = followPens([stroke], [thick]);
    expect(same.width[0].width).toBe(90);
    expect(same.nib[0].angle).toBe(30);
  });

  it("ships pens from real hands rather than invented ones", () => {
    const textura = STARTING_PENS.find((one) => one.name === "Textura")!;
    // The blackletter tutorial's own numbers: forty degrees, sixty wide, and a
    // thickness of nought, which is what gives the hand its hairlines.
    expect(textura.angle).toBe(40);
    expect(textura.width).toBe(60);
    expect(textura.contrast).toBe(1);
  });
});
