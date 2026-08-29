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
import { NO_SCRIPT, scatterOf } from "./script";
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

/*
 * The seed the bounce is drawn from, checked for actually scattering.
 *
 * This is here because it did not, and nothing noticed. One round of FNV-1a
 * over a one-character name does not diffuse, so the ten bits taken out of it
 * varied almost linearly with the character code: across the lowercase the
 * bounce seed spanned five hundredths of its range and every value was
 * negative. The control that reads it was therefore not a bounce at all -- it
 * moved the whole alphabet down together, and turning it up moved the whole
 * alphabet down further while the spread, which is the part anybody sees,
 * stayed where it was.
 *
 * What makes that worth a test rather than a fix and a shrug is how it hid. A
 * broken hash draws letters, exports fonts, passes every invariant about ink
 * and folding, and produces a face that looks like a script. It was found only
 * by asking why a control would not move a measurement, which is not a
 * question anybody asks on purpose.
 */
describe("the seed behind the bounce scatters", () => {
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");
  const seeds = (which: "first" | "second") => letters.map((one) => scatterOf(one)[which]);

  for (const which of ["first", "second"] as const) {
    describe(which, () => {
      it("covers most of its range", () => {
        const values = seeds(which);
        const spread = Math.max(...values) - Math.min(...values);
        // The range is a whole unit. Anything under half of it across
        // twenty-six samples is a hash that is not mixing.
        expect(spread, `only ${spread.toFixed(3)} of a possible 1.0`).toBeGreaterThan(0.6);
      });

      it("goes both ways", () => {
        // The old one was negative for all twenty-six, which is what turned a
        // bounce into a uniform drop.
        const values = seeds(which);
        expect(values.filter((one) => one < 0).length).toBeGreaterThan(5);
        expect(values.filter((one) => one > 0).length).toBeGreaterThan(5);
      });

      it("cannot be sorted back into the alphabet", () => {
        /*
         * The tell that found it. If the seeds come out in the order the
         * letters went in, the hash is a rearrangement of its input rather
         * than a mix of it, and neighbouring letters get neighbouring values
         * -- which is the one thing a bounce must not do, because the letters
         * that end up beside each other in a word are the ones that must not
         * agree.
         */
        const values = seeds(which);
        const rising = values.every((one, at) => at === 0 || one >= values[at - 1]);
        const falling = values.every((one, at) => at === 0 || one <= values[at - 1]);
        expect(rising || falling, "the seeds are in alphabetical order").toBe(false);
      });

      it("keeps neighbouring letters apart", () => {
        // Averaged over the alphabet, two letters next to each other should
        // differ by about a third of the range. The old seed managed 0.002.
        const values = seeds(which);
        const steps = values.slice(1).map((one, at) => Math.abs(one - values[at]));
        const mean = steps.reduce((sum, one) => sum + one, 0) / steps.length;
        expect(mean, `neighbours differ by ${mean.toFixed(4)} on average`).toBeGreaterThan(0.15);
      });
    });
  }

  it("gives the same answer every time it is asked", () => {
    // Deterministic, or a letter could not be cached, compared with itself, or
    // exported. This is the property the fix had to keep.
    for (const one of letters) {
      expect(scatterOf(one)).toEqual(scatterOf(one));
    }
    expect(scatterOf("n")).not.toEqual(scatterOf("m"));
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
