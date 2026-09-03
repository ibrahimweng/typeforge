import { describe, expect, it } from "vitest";

import { handOf, withHand } from "./hand";
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
