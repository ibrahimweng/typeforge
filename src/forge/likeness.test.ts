/**
 * That the dial still arrives where it says it does.
 *
 * The settings in `likeness.ts` were fitted against measurements taken off two
 * reference files, and the fitting is only worth anything for as long as the
 * engine draws what it drew when they were fitted. Any change to the sweep, to
 * the join, to a letter's skeleton or to the pen moves the drawn face out from
 * under them -- silently, because a face that is a little further from
 * something it was aimed at still draws, still exports, and still looks like a
 * script.
 *
 * So the arrival is asserted rather than left to be noticed. The tolerances are
 * the same ones `scripts/likeness.ts` prints against, and they are loose on
 * purpose: these are proportions a reader perceives, not a checksum. What the
 * test is for is the case where a measure moves by five times its tolerance
 * because something underneath changed, not the case where it moves in the
 * last decimal place.
 */

import { describe, expect, it } from "vitest";

import { contoursBounds, inkRunsAt } from "@/font/geometry";
import { draw, startFrom } from "./document";
import { dialledTo, LIKENESSES, likenessBy, type Measurements } from "./likeness";
import { NO_SCRIPT } from "./script";
import { BASES, ROUNDHAND, type Style } from "./style";

/*
 * The same letter sets the harness measures over, and for the same reasons.
 *
 * Square top and square foot on `FLAT`, so neither the overshoot of a round
 * letter nor the apex of a pointed one is read as the x-height or as a letter
 * that bounced.
 */
const FLAT = ["n", "m", "u", "r", "i"];
const ASCENDING = ["l", "b", "d", "h", "k"];
const DESCENDING = ["g", "p", "q", "y"];
const CAPITALS = ["H", "E", "I", "T"];

function median(values: number[]): number {
  const sorted = [...values].sort((one, other) => one - other);
  return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
}

/** The face on the ruler, the same ruler the harness uses. */
function measure(style: Style): Measurements {
  const em = style.metrics.unitsPerEm;
  const forge = startFrom(style);
  const box = (name: string) => {
    const drawn = draw(name, forge);
    return drawn && drawn.contours.length > 0 ? contoursBounds(drawn.contours) : null;
  };
  const boxes = (names: string[]) => names.map(box).filter((one) => one !== null);

  const flat = boxes(FLAT);
  const xHeight = median(flat.map((one) => one.yMax));

  // The stem, read with the join off: a ruler laid across a joined `l` cuts the
  // lead-in and the lead-out rather than the stem. Turning the join off removes
  // those two strokes and changes nothing else about the letter.
  const apart = startFrom({
    ...style,
    parts: { ...style.parts, script: { ...style.parts.script, on: false } },
  });
  const ell = draw("l", apart)!;
  const cut = (fraction: number) => inkRunsAt(ell.contours, xHeight * fraction, "y");
  const mid = (run: [number, number]) => (run[0] + run[1]) / 2;
  const low = cut(0.25);
  const high = cut(0.85);
  const slant =
    low.length > 0 && high.length > 0
      ? (Math.atan2(mid(high[0]) - mid(low[0]), xHeight * 0.6) * 180) / Math.PI
      : style.metrics.slant;
  const widths: number[] = [];
  for (const fraction of [0.45, 0.55, 0.65, 0.75]) {
    for (const run of cut(fraction)) widths.push(run[1] - run[0]);
  }

  const sits = flat.map((one) => one.yMin);
  return {
    xHeight: xHeight / em,
    capHeight: Math.max(...boxes(CAPITALS).map((one) => one.yMax)) / em,
    ascender: Math.max(...boxes(ASCENDING).map((one) => one.yMax)) / em,
    descender: Math.min(...boxes(DESCENDING).map((one) => one.yMin)) / em,
    slant,
    stroke: (median(widths) * Math.cos((slant * Math.PI) / 180)) / xHeight,
    bounce: (Math.max(...sits) - Math.min(...sits)) / xHeight,
    // Not asserted: this engine ends the lead-out on the advance rather than
    // overhanging it, so the overlap is a fact about the construction and no
    // setting moves it. `scripts/likeness.ts` says so at more length.
    overlap: 0,
  };
}

const CLOSE: Partial<Record<keyof Measurements, number>> = {
  xHeight: 0.01,
  capHeight: 0.015,
  ascender: 0.02,
  descender: 0.02,
  slant: 1.5,
  stroke: 0.02,
  bounce: 0.02,
};

describe("the dial arrives where it says", () => {
  for (const likeness of LIKENESSES) {
    describe(likeness.label, () => {
      const drawn = measure(dialledTo(likeness));
      for (const key of Object.keys(CLOSE) as Array<keyof Measurements>) {
        it(`${key} is within tolerance`, () => {
          const off = Math.abs(drawn[key] - likeness.measured[key]);
          expect(
            off,
            `${key}: drawn ${drawn[key].toFixed(3)}, aimed at ${likeness.measured[key].toFixed(3)}`,
          ).toBeLessThanOrEqual(CLOSE[key]!);
        });
      }
    });
  }
});

describe("the two ends of the dial are actually apart", () => {
  /*
   * The test that says the dial is a dial.
   *
   * Every measure inside tolerance would also be true of two settings that
   * happened to be the same, and a pair of presets that produce one face is a
   * dial with one position on it. These are the axes the two references
   * genuinely differ on, so they are the ones the settings have to keep apart.
   */
  const flowing = measure(dialledTo(likenessBy("flowing")!));
  const brush = measure(dialledTo(likenessBy("brush")!));

  it("the brush has much the taller lowercase", () => {
    expect(brush.xHeight - flowing.xHeight).toBeGreaterThan(0.1);
  });

  it("the flowing hand bounces and the brush does not", () => {
    expect(flowing.bounce).toBeGreaterThan(brush.bounce);
  });

  it("the brush leans further despite sitting steadier", () => {
    expect(brush.slant).toBeGreaterThan(flowing.slant + 1);
  });
});

describe("the Roundhand sits between the two it was placed between", () => {
  const here = measure(ROUNDHAND);
  const flowing = likenessBy("flowing")!.measured;
  const brush = likenessBy("brush")!.measured;

  /*
   * Stated as an ordering rather than as a midpoint.
   *
   * A face that has to be movable in both directions needs room on both sides
   * of where it starts, and that is an inequality, not an average. Asserting a
   * midpoint would pin the base to a number nobody chose and would fail the
   * first time either reference was re-measured.
   */
  it("its lowercase is between theirs", () => {
    expect(here.xHeight).toBeGreaterThan(flowing.xHeight);
    expect(here.xHeight).toBeLessThan(brush.xHeight);
  });

  it("its lean is between theirs", () => {
    expect(here.slant).toBeGreaterThan(flowing.slant - 1);
    expect(here.slant).toBeLessThan(brush.slant + 1);
  });

  it("its stroke is between theirs", () => {
    expect(here.stroke).toBeGreaterThan(brush.stroke);
    expect(here.stroke).toBeLessThan(flowing.stroke);
  });
});

describe("what the dial leaves alone", () => {
  it("moves only the settings it names", () => {
    /*
     * A patch and not a face of its own.
     *
     * The whole reason the likenesses are settings rather than styles is that
     * everything they do not name stays where the base left it -- so a face
     * dialled to one of them can be dialled on from there rather than being a
     * dead end. If this ever stops holding, the dial has quietly become a
     * fifth and sixth base and the panel is lying about what it does.
     */
    for (const likeness of LIKENESSES) {
      const moved = dialledTo(likeness);
      expect(moved.forms, likeness.id).toEqual(ROUNDHAND.forms);
      expect(moved.parts.bowl, likeness.id).toEqual(ROUNDHAND.parts.bowl);
      expect(moved.parts.shoulder, likeness.id).toEqual(ROUNDHAND.parts.shoulder);
      expect(moved.parts.terminal, likeness.id).toEqual(ROUNDHAND.parts.terminal);
      expect(moved.metrics.unitsPerEm, likeness.id).toBe(ROUNDHAND.metrics.unitsPerEm);
      expect(moved.metrics.counterWidth, likeness.id).toBe(ROUNDHAND.metrics.counterWidth);
    }
  });

  it("leaves the letters joined", () => {
    for (const likeness of LIKENESSES) {
      expect(dialledTo(likeness).parts.script.on, likeness.id).toBe(true);
    }
  });
});

describe("the Roundhand is a face like the others", () => {
  it("is registered where the panel will find it", () => {
    expect(BASES.map((one) => one.name)).toContain("Roundhand");
    expect(BASES.filter((one) => one.name === "Roundhand")).toHaveLength(1);
  });

  it("is filed with the joined faces", () => {
    expect(ROUNDHAND.family).toBe("script");
    expect(ROUNDHAND.parts.script.on).toBe(true);
  });

  /*
   * The settings that were added with it, present on every face rather than on
   * this one.
   *
   * A field that only the newest face carries is a field the older ones fall
   * through, and what they fall through to is whatever the reader defaults it
   * to at the point of use -- which is four opportunities for the four faces
   * that already joined to drift apart from each other.
   */
  it("every face carries the settings the join was given", () => {
    for (const base of BASES) {
      for (const key of Object.keys(NO_SCRIPT) as Array<keyof typeof NO_SCRIPT>) {
        expect(base.parts.script[key], `${base.name} has no script.${key}`).toBeDefined();
      }
    }
  });
});
