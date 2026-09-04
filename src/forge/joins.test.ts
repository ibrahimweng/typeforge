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
import { drawLetter, letterNames } from "./build";
import { drawnEnds, drawnHigh, startFrom } from "./document";
import { alternateName, boundaryEnds, boundaryRules, joinRules, joinsUp, joinSides } from "./joins";
import { joiningWithout } from "./letters";
import { wobbleOf } from "./script";
import { BASES, SANS } from "./style";
import { seamsOf } from "./script";

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

describe("the two sides of a join that is not there", () => {
  const forge = startFrom(BASES.find((one) => one.name === "Handwriting")!);

  /*
   * A word does not begin with a stroke reaching out of its first letter
   * towards nothing, or end with one reaching out of its last.
   */
  it("draws the first letter of a word without its lead-in", () => {
    for (const letter of ["a", "n", "e", "h"]) {
      const plain = drawLetter(letter, HAND, HAND.forms?.[letter])!;
      const begin = drawnEnds(letter, "begin", forge)!;
      expect([letter, begin.advanceWidth < plain.advanceWidth]).toEqual([letter, true]);
      // And it starts on its own ink rather than reaching back past the origin.
      expect([letter, contoursBounds(begin.contours).xMin > 0]).toEqual([letter, true]);
      expect([letter, contoursBounds(plain.contours).xMin < 0]).toEqual([letter, true]);
    }
  });

  it("draws the last letter of a word without its lead-out", () => {
    for (const letter of ["a", "n", "e", "h"]) {
      const plain = drawLetter(letter, HAND, HAND.forms?.[letter])!;
      const end = drawnEnds(letter, "end", forge)!;
      expect([letter, end.advanceWidth < plain.advanceWidth]).toEqual([letter, true]);
    }
  });

  /*
   * The neighbour is matched as part of the sequence and nothing is
   * substituted at its position, which is what lets these be written without a
   * backtrack or a lookahead. Two rules and so two lookups: one that consumed
   * the space would leave the word after it unlooked at.
   */
  it("requires the neighbour rather than consuming it", () => {
    /*
     * The distinction the whole thing turns on. Matched, the space is part of
     * the sequence and is spent on it, so the one space between two words can
     * only serve the rule that gets there first -- and `a bat` had either the
     * `b` drawn as a beginning or the `a` drawn as an ending, never both.
     * Required, it is a condition on the match and is still there afterwards.
     */
    const rules = boundaryRules(boundaryEnds(forge), letterNames());
    expect(rules.length).toBe(3);
    const [, begins, ends] = rules;

    expect(begins.before?.[0]).toContain("space");
    expect(begins.input).toHaveLength(1);
    expect(begins.swaps.map((one) => one.at)).toEqual([0]);

    expect(ends.after?.[0]).toContain("space");
    expect(ends.input).toHaveLength(1);
    expect(ends.swaps.map((one) => one.at)).toEqual([0]);

    // Nothing in either rule redraws the glyph that provided the context, and
    // now it could not: the swaps can only reach the input, and the space is
    // not in it.
    expect(begins.swaps.flatMap((one) => one.swap).some((one) => one.plain === "space")).toBe(
      false,
    );
    expect(ends.swaps.flatMap((one) => one.swap).some((one) => one.plain === "space")).toBe(false);
  });

  /*
   * The space is not a case of its own. Whatever cannot take a lead-out is on
   * the left of the first rule and whatever cannot take a lead-in is on the
   * right of the second, and the classes come off `joinEnds` -- so the four
   * capitals that never hand on are in the first, every capital is in the
   * second, and the digits and punctuation are in both.
   */
  it("counts everything a letter can fail to join to, not only the space", () => {
    const { noExit, noEntry } = joinSides(letterNames());
    for (const shut of ["B", "D", "O", "P", "space", "period", "one", "parenleft"]) {
      expect([shut, noExit.includes(shut)]).toEqual([shut, true]);
    }
    // Every capital can be handed on *to* by nothing, and the handing-on ones
    // are still on the left of the second rule.
    for (const cap of ["A", "B", "K", "Z"]) {
      expect([cap, noEntry.includes(cap)]).toEqual([cap, true]);
    }
    // A lowercase letter joins on both sides, so it is in neither class.
    for (const letter of ["a", "n", "e", "h"]) {
      expect([letter, noExit.includes(letter), noEntry.includes(letter)]).toEqual([
        letter,
        false,
        false,
      ]);
    }
    // And a capital that hands on is not something a lead-out has to give up for.
    expect(noExit.includes("A")).toBe(false);
  });

  /*
   * `a` is a word. Both halves have to go, and neither of the two rules above
   * can do it alone -- whichever ran first would leave a glyph the other no
   * longer recognises -- so the case is its own rule and it is asked first.
   */
  it("draws a one-letter word with neither half, and asks for it first", () => {
    for (const letter of ["a", "n", "e", "h", "f", "x", "y"]) {
      // The face's own form of the letter, which for the `f` is not the
      // default one -- `drawLetter` asks for that only when told.
      const plain = drawLetter(letter, HAND, HAND.forms?.[letter])!;
      const alone = drawnEnds(letter, "alone", forge)!;
      const begin = drawnEnds(letter, "begin", forge)!;
      const end = drawnEnds(letter, "end", forge)!;
      /*
       * It gave up exactly what the two half-drawings gave up between them,
       * because all three are spaced by the join layer standing in the
       * sidebearing on the side it has nothing on. The letter that has been
       * asked to give up both its joins is still a letter of a joined face;
       * sent down the plain roman path it would be spaced off its own raw ink,
       * which on an `f` with a loop under it is half a letter wider than the
       * face it belongs to.
       *
       * To a unit, not to the bit. The identity is exact in the arithmetic and
       * not in the floating point that carries it: the two sides are summed in
       * a different order and came apart in the last place -- 481.59999999999997
       * against 481.5999999999999 -- the first time the face's metrics moved
       * under it. A twentieth of a unit is far below anything that could be a
       * spacing fault and far above the noise.
       */
      expect(alone.advanceWidth, `${letter} alone`).toBeCloseTo(
        begin.advanceWidth + end.advanceWidth - plain.advanceWidth,
        1,
      );
      expect([letter, alone.advanceWidth < begin.advanceWidth]).toEqual([letter, true]);
      /*
       * And it starts on its own ink, like the letter that begins a word --
       * asked of the letter at the line, which is where a neighbour would be.
       *
       * A descender's loop turns left under the letter before it, and a letter
       * is spaced off its body between the lines rather than off that turn. So
       * the loop comes out over the origin, which is what the reference does
       * too: its `f` starts 0.20 of an x-height left of its own origin and its
       * `j` 0.58. Below the baseline there is nothing to start on top of.
       */
      const atTheLine = alone.contours
        .flatMap((one) => one.nodes)
        .filter((node) => node.point.y >= 0);
      const starts = Math.min(...atTheLine.map((node) => node.point.x));
      expect([letter, starts > 0]).toEqual([letter, true]);
    }

    const rules = boundaryRules(boundaryEnds(forge), letterNames());
    expect(rules).toHaveLength(3);
    const [lone] = rules;
    // One glyph in the sequence -- the letter -- with a space required either
    // side. Both spaces used to be in the input, which is why a run of
    // one-letter words came out with only every other one caught.
    expect(lone.input).toHaveLength(1);
    expect(lone.before?.[0]).toContain("space");
    expect(lone.after?.[0]).toContain("space");
    expect(lone.swaps.map((one) => one.at)).toEqual([0]);
    expect(lone.swaps[0].swap).toContainEqual({ plain: "a", alternate: "a.alone" });
    // A capital is not in it: with no lead-in to lose, alone and last are the
    // same drawing and it already has one.
    expect(lone.swaps[0].swap.some((one) => /[A-Z]/.test(one.plain))).toBe(false);
  });

  /*
   * A capital has no lead-in to go without, so it is in the second list and not
   * the first. The four that hand over to nothing are in neither.
   */
  it("asks for a trailing capital and never a leading one", () => {
    const wanted = boundaryEnds(forge);
    const named = (which: "begin" | "end") =>
      wanted.filter(([, one]) => one === which).map(([letter]) => letter);
    expect(named("begin").some((letter) => /[A-Z]/.test(letter))).toBe(false);
    expect(named("end")).toContain("A");
    for (const shut of ["B", "D", "F", "I", "O", "P"]) {
      expect([shut, named("end").includes(shut)]).toEqual([shut, false]);
    }
  });

  /*
   * And the two that are shut for a different reason from the other four.
   *
   * A lead-out leaves along the baseline, and on an `F` the baseline is where
   * an `E` keeps its bottom arm: an `F` that hands on is an `E`, and `Fox` sets
   * as `Eox`. An `I` with a foot going right is an `L`. That is the letter as
   * `cmap` maps it, so it is what a reader gets from any renderer that applies
   * no features -- which is the case the whole of this design is built to be
   * right in.
   *
   * Measured rather than asserted: the joined drawing of a letter that hands on
   * has to reach further right than the drawing without it, and for these two
   * that reach is what makes the wrong letter. So the test is that they do not
   * reach at all, while a letter that is allowed to hand on does.
   */
  it("keeps the lead-out off the letters it would turn into another letter", () => {
    const reach = (letter: string) => {
      const joined = drawLetter(letter, HAND, HAND.forms?.[letter])!;
      const shut = joiningWithout(
        { exit: false },
        () => drawLetter(letter, HAND, HAND.forms?.[letter])!,
      );
      return contoursBounds(joined.contours).xMax - contoursBounds(shut.contours).xMax;
    };
    for (const letter of ["F", "I", "B", "D", "O", "P"]) {
      expect([letter, reach(letter)]).toEqual([letter, 0]);
    }
    for (const letter of ["E", "L", "A", "H", "T"]) {
      expect([letter, reach(letter) > 0]).toEqual([letter, true]);
    }
  });
});

describe("the second drawing is the same letter", () => {
  const forge = startFrom(HAND);

  /*
   * The same letter on both sides of the comparison, which means the face's own
   * form of it.
   *
   * `drawnHigh` goes through the forge and so draws whichever form the face
   * chose; written as a bare `drawLetter` the other side drew the default one,
   * and for a `g` on this face those are two different letters. It passed for
   * as long as the two happened to come out the same width, and stopped the
   * day the loops were opened -- 559 units against 726, which reads as the
   * high-entry drawing moving its advance when nothing of the sort happened.
   */
  const plainly = (letter: string) => drawLetter(letter, HAND, HAND.forms?.[letter])!;

  /*
   * The advance may not move. A letter set after an `o` that was a few units
   * wider would put the letter after *it* somewhere the one before did not
   * finish, and it would only show on the pairs the feature fires on.
   */
  it("keeps the letter's own advance", () => {
    for (const letter of ["a", "n", "o", "w", "g"]) {
      const plain = plainly(letter);
      expect([letter, drawnHigh(letter, "entry", forge)!.advanceWidth]).toEqual([
        letter,
        plain.advanceWidth,
      ]);
    }
  });

  it("is a different drawing all the same", () => {
    for (const letter of ["a", "n", "o"]) {
      const plain = plainly(letter);
      expect(drawnHigh(letter, "entry", forge)!.contours).not.toEqual(plain.contours);
    }
    // And the high hand-over only exists on the four that have one.
    expect(drawnHigh("n", "exit", forge)!.contours).toEqual(plainly("n").contours);
    expect(drawnHigh("o", "exit", forge)!.contours).not.toEqual(plainly("o").contours);
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
    /*
     * And the letter's own lean on top of the face's.
     *
     * A joined face leans each letter a little further than its neighbour, and
     * that shear is taken about the seam rather than about the middle of the
     * x-height -- which is what lets a letter lean and still hand over in the
     * same place. So at the seam it moves nothing, and at the high seam two
     * hundred units above it, it moves the ink by as much as ten: on this face
     * the `e` leans 2.8 degrees of its own and its ink at the high seam stands
     * ten units right of where the face's slant alone would put it.
     *
     * That is the join arriving exactly where it should, not missing. The
     * tolerance above is for the run-finder walking a flattened outline and is
     * a tenth of the pen; widening it to swallow a real displacement would
     * stop this noticing a join that had actually missed. So the displacement
     * is worked out instead -- it is deterministic, from the letter's name --
     * and the tolerance stays where it was.
     */
    const ownLean = (letter: string, y: number): number =>
      (y - HAND.parts.script.height * HAND.metrics.xHeight) *
      Math.tan((wobbleOf(letter, HAND.parts.script, HAND.metrics.xHeight).lean * Math.PI) / 180);

    for (const letter of ["a", "n", "e", "u"]) {
      const drawn = drawnHigh(letter, "entry", forge)!;
      const runs = inkRunsAt(drawn.contours, high, "y", 48);
      expect([letter, runs.length > 0]).toEqual([letter, true]);
      expect([
        letter,
        Math.min(...runs.map((run) => run[0])) < shiftAt(high) + ownLean(letter, high) + close,
      ]).toEqual([letter, true]);
    }
    for (const letter of ["o", "v", "w", "b"]) {
      const drawn = drawnHigh(letter, "exit", forge)!;
      const runs = inkRunsAt(drawn.contours, high, "y", 48);
      expect([letter, runs.length > 0]).toEqual([letter, true]);
      expect([
        letter,
        Math.max(...runs.map((run) => run[1])) >
          drawn.advanceWidth + shiftAt(high) + ownLean(letter, high) - close,
      ]).toEqual([letter, true]);
    }
    // The plain letters still meet each other at the low seam, which is what
    // makes the font right where the feature is never applied.
    const low = seamsOf(script, HAND.metrics.xHeight, HAND.pen.weight / 2).low;
    for (const letter of ["o", "n"]) {
      const runs = inkRunsAt(plainly(letter).contours, low, "y", 48);
      expect([letter, runs.length > 0]).toEqual([letter, true]);
    }
  });

  it("stands where the letter stands", () => {
    for (const letter of ["a", "n", "o"]) {
      const plain = contoursBounds(plainly(letter).contours);
      const high = contoursBounds(drawnHigh(letter, "entry", forge)!.contours);
      // The body has not moved: only the lead-in was drawn somewhere else.
      expect(Math.abs(high.yMax - plain.yMax)).toBeLessThan(HAND.pen.weight);
      expect(Math.abs(high.xMax - plain.xMax)).toBeLessThan(HAND.pen.weight);
    }
  });
});
