/**
 * Which second drawings a joined face asks for, and what it says about them.
 *
 * The arithmetic between the geometry and the table. Small, and worth having
 * because both of the things it decides are easy to get subtly wrong: which
 * letters need an alternate at all, and whether the rule names both halves of
 * the pair or only one.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contoursBounds, inkRunsAt } from "@/font/geometry";
import { drawLetter } from "./build";
import { drawnHigh, startFrom } from "./document";
import { alternateName, joinRules, joinsUp } from "./joins";
import { BASES, SANS } from "./style";

const HAND = BASES.find((one) => one.name === "Handwriting")!;

beforeAll(async () => {
  await ready();
});

describe("which letters get a second drawing", () => {
  it("asks for none at all on a face whose letters stand apart", () => {
    expect(joinsUp(startFrom(SANS))).toEqual([]);
    expect(joinRules([])).toEqual([]);
  });

  /*
   * Twenty-six that can be arrived at high, and the four a written hand
   * finishes at the top of. Nothing needs both, and that is worth a test
   * because it looks as though it should: a shaper matching a two-glyph
   * sequence carries on from the end of what it matched, so in `ooo` the middle
   * letter is the one that received high and it hands over low.
   */
  it("asks for one per letter, and a second for the four that hand over high", () => {
    const wanted = joinsUp(startFrom(HAND));
    const arriving = wanted.filter(([, which]) => which === "entry").map(([one]) => one);
    const leaving = wanted.filter(([, which]) => which === "exit").map(([one]) => one);
    expect(arriving).toHaveLength(26);
    expect(leaving).toEqual(["b", "o", "v", "w"]);
    expect(wanted).toHaveLength(30);
  });

  it("names them the way a foundry does", () => {
    expect(alternateName("o", "exit")).toBe("o.medi");
    expect(alternateName("n", "entry")).toBe("n.init");
  });
});

describe("what the rule says", () => {
  const rules = joinRules(joinsUp(startFrom(HAND)));

  it("is one rule matching two positions, not a rule per pair", () => {
    expect(rules).toHaveLength(1);
    expect(rules[0].input).toHaveLength(2);
    expect(rules[0].input[0]).toEqual(["b", "o", "v", "w"]);
    expect(rules[0].input[1]).toHaveLength(26);
  });

  /*
   * Both positions, never only the second. Swapping only the follower would
   * mean drawing the high hand-over into the `o` itself, and a renderer that
   * skipped the feature would then join every one of those pairs high to low --
   * which is the broken font the alternates exist to avoid.
   */
  it("redraws both halves of the pair", () => {
    expect(rules[0].swaps.map((one) => one.at)).toEqual([0, 1]);
    expect(rules[0].swaps[0].swap).toContainEqual({ plain: "o", alternate: "o.medi" });
    expect(rules[0].swaps[1].swap).toContainEqual({ plain: "n", alternate: "n.init" });
  });
});

describe("the second drawing is the same letter", () => {
  const forge = startFrom(HAND);

  /*
   * The advance may not move. A letter set after an `o` that was a few units
   * wider would put the letter after *it* somewhere the one before did not
   * finish, and it would only show on the pairs the feature fires on.
   */
  it("keeps the letter's own advance", () => {
    for (const letter of ["a", "n", "o", "w", "g"]) {
      const plain = drawLetter(letter, HAND)!;
      expect([letter, drawnHigh(letter, "entry", forge)!.advanceWidth]).toEqual([
        letter,
        plain.advanceWidth,
      ]);
    }
  });

  it("is a different drawing all the same", () => {
    for (const letter of ["a", "n", "o"]) {
      const plain = drawLetter(letter, HAND)!;
      expect(drawnHigh(letter, "entry", forge)!.contours).not.toEqual(plain.contours);
    }
    // And the high hand-over only exists on the four that have one.
    expect(drawnHigh("n", "exit", forge)!.contours).toEqual(drawLetter("n", HAND)!.contours);
    expect(drawnHigh("o", "exit", forge)!.contours).not.toEqual(drawLetter("o", HAND)!.contours);
  });

  /*
   * And it reaches the edge it was drawn to reach. A lead-in that arrives high
   * has to have ink at the high seam on the left, or the `o` before it hands
   * over to nothing.
   */
  it("has ink at the seam it hands over at", () => {
    const script = HAND.parts.script;
    const high = 0.76 * HAND.metrics.xHeight;
    const lean = Math.tan((HAND.metrics.slant * Math.PI) / 180);
    /*
     * Where the seam sits after the lean, and how close is close enough.
     *
     * A shear moves the ink at any height sideways -- fourteen units at the
     * high seam on this face -- and it moves the next letter's by the same, so
     * it opens nothing. The tolerance is for the measuring rather than for the
     * drawing: the run-finder walks a flattened outline, and forty-eight
     * segments around a whole letter cuts a corner by a few units. A tenth of
     * the pen covers that and is far short of a join that has actually missed.
     */
    const shiftAt = (y: number): number => (y - HAND.metrics.xHeight / 2) * lean;
    const close = HAND.pen.weight * 0.1;

    for (const letter of ["a", "n", "e", "u"]) {
      const drawn = drawnHigh(letter, "entry", forge)!;
      const runs = inkRunsAt(drawn.contours, high, "y", 48);
      expect([letter, runs.length > 0]).toEqual([letter, true]);
      expect([letter, Math.min(...runs.map((run) => run[0])) < shiftAt(high) + close]).toEqual([
        letter,
        true,
      ]);
    }
    for (const letter of ["o", "v", "w", "b"]) {
      const drawn = drawnHigh(letter, "exit", forge)!;
      const runs = inkRunsAt(drawn.contours, high, "y", 48);
      expect([letter, runs.length > 0]).toEqual([letter, true]);
      expect([
        letter,
        Math.max(...runs.map((run) => run[1])) > drawn.advanceWidth + shiftAt(high) - close,
      ]).toEqual([letter, true]);
    }
    // The plain letters still meet each other at the low seam, which is what
    // makes the font right where the feature is never applied.
    const low = script.height * HAND.metrics.xHeight;
    for (const letter of ["o", "n"]) {
      const runs = inkRunsAt(drawLetter(letter, HAND)!.contours, low, "y", 48);
      expect([letter, runs.length > 0]).toEqual([letter, true]);
    }
  });

  it("stands where the letter stands", () => {
    for (const letter of ["a", "n", "o"]) {
      const plain = contoursBounds(drawLetter(letter, HAND)!.contours);
      const high = contoursBounds(drawnHigh(letter, "entry", forge)!.contours);
      // The body has not moved: only the lead-in was drawn somewhere else.
      expect(Math.abs(high.yMax - plain.yMax)).toBeLessThan(HAND.pen.weight);
      expect(Math.abs(high.xMax - plain.xMax)).toBeLessThan(HAND.pen.weight);
    }
  });
});
