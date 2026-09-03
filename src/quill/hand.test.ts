import { describe, expect, it } from "vitest";

import { handOf, wanderOf, withHand } from "./hand";
import { ready, unite } from "@/font/boolean";
import { fitGlyph } from "./fit";
import { sweepAll, toleranceFor } from "./sweep";
import { ROUND_NIB } from "./types";
import type { QuillSpine, QuillStroke } from "./types";

/** A straight stroke of one width, running at a given angle. */
const at = (degrees: number, width: number): QuillStroke => {
  const radians = (degrees * Math.PI) / 180;
  const spine: QuillSpine = {
    segments: [
      {
        kind: "line",
        from: { x: 0, y: 0 },
        to: { x: Math.cos(radians) * 500, y: Math.sin(radians) * 500 },
      },
    ],
    closed: false,
  };
  return {
    spine,
    width: [{ at: 0, width }],
    nib: [{ ...ROUND_NIB, at: 0 }],
    start: { kind: "butt" },
    end: { kind: "butt" },
    join: "round",
  };
};

/**
 * Reading the pen out of a traced letter.
 *
 * It looks like it cannot be done: a round pen with a free width profile draws
 * any ink a broad pen can, so nothing in one stroke says which was used. What
 * makes it decidable is that a pen has one angle and a letter's strokes run
 * every way -- so only a real pen explains all of them at once, and the pen
 * wanted is the one that makes the pressure along the strokes flattest.
 */
describe("the pen a traced letter was written with", () => {
  /*
   * Strokes made by an actual broad pen: full width across the pen's own axis
   * and narrowed across the other, so the widths are exactly what a blade of
   * 0.6 held at nought degrees would leave.
   */
  it("finds a pen that explains the widths, and the angle it was held at", () => {
    const blade = 0.6;
    const half = 100;
    const reach = (degrees: number) => {
      // The normal of a stroke at `degrees` stands ninety degrees round.
      const fromAxis = ((degrees + 90) * Math.PI) / 180;
      return (
        half * Math.hypot(Math.cos(fromAxis), (1 - blade) * Math.sin(fromAxis)) * 2
      );
    };
    const strokes = [0, 30, 60, 90, 120, 150].map((degrees) => at(degrees, reach(degrees)));
    const found = handOf(strokes)!;
    expect(found).not.toBeNull();
    expect(found.contrast).toBeCloseTo(blade, 1);
    // The angle is only defined to a half turn: a pen at nought and at a
    // hundred and eighty are the same pen.
    expect(Math.abs(((found.angle % 180) + 180) % 180)).toBeLessThan(4);
    // And it explains nearly all of the variation, which is the claim.
    expect(found.spread).toBeLessThan(found.roundSpread * 0.1);
  });

  /*
   * And strokes of one width running every way were not made by a broad pen at
   * all. Any pen with a blade would have to explain a variation that is not
   * there, so the round pen wins and nothing is rewritten -- which is the case
   * that matters, because it is most text faces.
   */
  it("declines to invent a pen for a monoline", () => {
    const strokes = [0, 30, 60, 90, 120, 150].map((degrees) => at(degrees, 180));
    const found = handOf(strokes)!;
    expect(found.contrast).toBe(0);
    expect(withHand(strokes).hand).toBeNull();
    // The strokes come back untouched, not merely equivalent.
    expect(withHand(strokes).strokes).toBe(strokes);
  });

  /*
   * A letter that runs one way carries no evidence about the pen. Every angle
   * explains it equally, so an answer would be a confident reading of nothing
   * -- which is worse than saying so.
   */
  it("says nothing about a letter that only goes one way", () => {
    expect(handOf([at(90, 100), at(90, 120), at(92, 110)])).toBeNull();
  });

  it("says nothing about too few strokes to read", () => {
    expect(handOf([])).toBeNull();
    expect(handOf([at(0, 100)])).toBeNull();
  });

  /*
   * The rewrite divides the pen out of the width profile so the sweep multiplies
   * it back. Pinned on the stops rather than on the ink, because a profile is a
   * handful of stops with the width interpolated between them and the pen's
   * reach varies continuously -- so the two do not commute, which is measured
   * in `tracing.ts` and is why the reading is reported rather than applied.
   */
  it("takes the pen out of the width where the stops are", () => {
    const blade = 0.6;
    const half = 100;
    const reach = (degrees: number) => {
      const fromAxis = ((degrees + 90) * Math.PI) / 180;
      return half * Math.hypot(Math.cos(fromAxis), (1 - blade) * Math.sin(fromAxis)) * 2;
    };
    const strokes = [0, 45, 90, 135].map((degrees) => at(degrees, reach(degrees)));
    const { strokes: rewritten, hand } = withHand(strokes, { least: 0.5 });
    expect(hand).not.toBeNull();
    // Every stroke now says the same pressure, which is the point: the letter
    // was written with one pen and the difference was its angle.
    const pressures = rewritten.map((one) => one.width[0].width);
    const spread = Math.max(...pressures) - Math.min(...pressures);
    expect(spread).toBeLessThan(half * 2 * 0.06);
    expect(rewritten.every((one) => one.nib[0].contrast > 0.4)).toBe(true);
  });
});

/*
 * The reading checked the other way round: written with a pen whose numbers are
 * known, swept, and read back.
 *
 * Against a real font the only test is whether the answer looks plausible,
 * because nobody knows what pen DejaVu Serif was drawn with -- it was drawn
 * rather than written. Here there is a right answer.
 *
 * `scripts/loop.ts` is the same check over more letters, with the two numbers
 * that say why the pen is reported and not used to re-fit the letters.
 */
describe("a pen written, swept, and read back", () => {
  const upm = 1000;
  const line = (from: [number, number], to: [number, number]): QuillSpine => ({
    segments: [{ kind: "line", from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] } }],
    closed: false,
  });
  const writtenWith = (blade: number, angle: number): QuillStroke[] =>
    [
      line([160, 40], [160, 700]),
      line([120, 700], [520, 60]),
      line([120, 60], [520, 700]),
      line([120, 640], [520, 640]),
    ].map((spine) => ({
      spine,
      width: [{ at: 0, width: 150 }],
      nib: [{ at: 0, contrast: blade, angle }],
      start: { kind: "butt" as const },
      end: { kind: "butt" as const },
      join: "round" as const,
    }));

  it("reads back the angle the letters were written at", async () => {
    await ready();
    const strokes = writtenWith(0.7, 40);
    const contours = unite(sweepAll(strokes, toleranceFor(upm)).contours);
    const fit = fitGlyph("written", contours, 640, { unitsPerEm: upm });
    expect(fit).not.toBeNull();
    const found = handOf(fit!.glyph.strokes);
    expect(found).not.toBeNull();
    /*
     * The angle comes back close. The blade does not, and it under-reads rather
     * than over-reads -- the tracer smooths the width along each stroke, so
     * some of the modulation is gone before it is ever measured. Pinned as it
     * is rather than as it should be, so that a change either way is noticed.
     */
    const turned = Math.abs((((found!.angle - 40) % 180) + 270) % 180) - 90;
    expect(Math.abs(turned)).toBeLessThan(8);
    expect(found!.contrast).toBeGreaterThan(0.2);
    expect(found!.contrast).toBeLessThan(0.7);
  });

  /*
   * And why the pen is not then used to re-fit the letters, in two numbers.
   *
   * A written stroke's own profile is flat, because the pen does all the
   * modulation. Divide that flat profile by the pen it was written with, and
   * variation appears where there was none -- which is what a second pass would
   * be handing the thinner.
   *
   * Only where the stroke curves, which is the sharp version of the claim. A
   * straight stroke has one heading, so the pen's reach along it is one number
   * and dividing by a constant cannot add anything. It is a bend that turns the
   * pen through its own thick and thin, and a written alphabet is mostly bends.
   */
  const bend: QuillSpine = {
    segments: [
      {
        kind: "cubic",
        from: { x: 150, y: 80 },
        c1: { x: 150, y: 500 },
        c2: { x: 450, y: 700 },
        to: { x: 700, y: 700 },
      },
    ],
    closed: false,
  };
  const curved = (blade: number, angle: number): QuillStroke[] => [
    {
      spine: bend,
      width: [{ at: 0, width: 150 }],
      nib: [{ at: 0, contrast: blade, angle }],
      start: { kind: "butt" },
      end: { kind: "butt" },
      join: "round",
    },
  ];

  it("shows that dividing a written curve by its own pen adds variation", () => {
    expect(wanderOf(curved(0.7, 40), 0, 0)).toBeCloseTo(0, 6);
    expect(wanderOf(curved(0.7, 40), 0.7, 40)).toBeGreaterThan(0.2);
  });

  it("and leaves a straight stroke alone, which is why it takes a letter to see", () => {
    const straight = writtenWith(0.7, 40);
    expect(wanderOf(straight, 0, 0)).toBeCloseTo(0, 6);
    expect(wanderOf(straight, 0.7, 40)).toBeCloseTo(0, 6);
  });
});
