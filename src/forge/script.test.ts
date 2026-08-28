/**
 * What a joined face promises.
 *
 * One of these is the whole of `script.ts` and the rest are guards around it:
 * a letter's lead-out has to stop exactly where the next letter's lead-in
 * starts, for every pair of the twenty-six, at every setting of every control
 * the face has. Everything else in this file is either that claim under a
 * harder condition or a rule about what the join is not allowed to touch.
 *
 * Measured at the seam and on fused ink, both for reasons that cost time to
 * learn. Bounding boxes are useless here -- a stroke climbing steeply and cut
 * square has a corner well past the point its spine stops at, so two letters
 * that abut perfectly have boxes that overlap by most of a pen. And unfused
 * contours are worse than useless: the run-finder pairs its crossings in order,
 * so two overlapping strokes read as two runs with a hole between them, and an
 * overlap of thirty units is reported as a gap of thirty.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ready, unite } from "@/font/boolean";
import { contoursBounds, inkRunsAt } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { drawLetter } from "./build";
import { recipeOf } from "./letters";
import { BASES, SANS, type Style } from "./style";
import { seamsOf, wobbleOf } from "./script";
import { spineEnd, spineStart } from "./shapes";

const SCRIPTS = BASES.filter((one) => one.parts.script.on);
const LOWER = "abcdefghijklmnopqrstuvwxyz".split("");
const HAND = BASES.find((one) => one.name === "Handwriting")!;

const slid = (contours: Contour[], by: number): Contour[] =>
  contours.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: { x: node.point.x + by, y: node.point.y },
      handleIn: node.handleIn ? { x: node.handleIn.x + by, y: node.handleIn.y } : null,
      handleOut: node.handleOut ? { x: node.handleOut.x + by, y: node.handleOut.y } : null,
    })),
  }));

/**
 * The break in the seam when two letters are set side by side, in units.
 *
 * Nought means the ink runs straight through the boundary, which is what a
 * joined face is for. Null means one of the two had no ink at the seam at all.
 */
function seamGap(style: Style, first: string, second: string): number | null {
  const left = drawLetter(first, style);
  const right = drawLetter(second, style);
  if (!left || !right) return null;
  const seam = seamsOf(style.parts.script, style.metrics.xHeight, style.pen.weight / 2).low;
  const both = unite([...left.contours, ...slid(right.contours, left.advanceWidth)], "winding");
  const runs = inkRunsAt(both, seam, "y", 48);
  const edge = left.advanceWidth;
  if (runs.some((run) => run[0] < edge && run[1] > edge)) return 0;
  const before = runs.filter((run) => run[1] <= edge + 1e-6).map((run) => run[1]);
  const after = runs.filter((run) => run[0] >= edge - 1e-6).map((run) => run[0]);
  if (before.length === 0 || after.length === 0) return null;
  return Math.min(...after) - Math.max(...before);
}

const withScript = (style: Style, patch: Partial<Style["parts"]["script"]>): Style => ({
  ...style,
  parts: { ...style.parts, script: { ...style.parts.script, ...patch } },
});

beforeAll(async () => {
  await ready();
});

describe("the letters reach each other", () => {
  /*
   * Fifty-two surfaces for each face: every letter as the one handing over and
   * every letter as the one being handed to. Anything less than all of them is
   * not the claim -- the three letters this got wrong the first time were g, j
   * and q, and every pair that did not involve one of those was joining.
   */
  it.each(SCRIPTS.map((one) => [one.name, one] as const))("%s joins on both sides of every letter", (_name, style) => {
    const broken: string[] = [];
    for (const letter of LOWER) {
      for (const [first, second] of [[letter, "n"], ["n", letter]] as const) {
        const gap = seamGap(style, first, second);
        if (gap === null || gap > 1) broken.push(`${first}${second}`);
      }
    }
    expect(broken).toEqual([]);
  });

  /*
   * And at the far end of the control that most obviously threatens it. An
   * unsteady hand moves each letter off the line by itself, which would carry
   * that letter's seam with it -- so the lift is applied to the skeleton before
   * the join is planned, and the lean is turned about the seam rather than
   * about the middle of the x-height. Both are invisible until they are wrong.
   */
  it("still joins when the hand is at its unsteadiest", () => {
    const wild = withScript(HAND, { irregularity: 3 });
    for (const pair of ["nn", "on", "no", "ge", "aj", "qu", "vv", "ww", "bb"]) {
      expect([pair, seamGap(wild, pair[0], pair[1])]).toEqual([pair, 0]);
    }
  });

  it("still joins with the loops wide open", () => {
    const looped = withScript(HAND, { loop: 2 });
    for (const pair of ["ll", "bd", "hk", "gy", "jp"]) {
      expect([pair, seamGap(looped, pair[0], pair[1])]).toEqual([pair, 0]);
    }
  });

  /*
   * And at the bottom of the seam control, which is where this came apart
   * quietly rather than loudly.
   *
   * The lead-out searches from half a pen above the baseline up to the seam, so
   * a seam below half a pen leaves that band empty -- and `attach`, which has
   * to return something, falls back to the whole letter and takes its rightmost
   * point wherever it happens to be. On an `n` that is the top of the arch. The
   * letters still met, so nothing here failed: they were threaded together
   * through their own middles instead of written along a line.
   *
   * So the seam is held off the baseline by the pen that has to reach it,
   * rather than taken at its word.
   */
  it("keeps the seam off the baseline when it is asked for under the pen", () => {
    const grazing = withScript(HAND, { height: 0.01 });
    const half = HAND.pen.weight / 2;
    expect(seamsOf(grazing.parts.script, HAND.metrics.xHeight, half).low)
      .toBeGreaterThan(half);
    for (const pair of ["nn", "on", "no", "an", "he"]) {
      expect([pair, seamGap(grazing, pair[0], pair[1])]).toEqual([pair, 0]);
    }
    // Left from the foot of the letter rather than from the top of its arch:
    // an `n` handing over has ink at the seam within a pen of its own right
    // edge, and had it two thirds of the way up the letter before.
    const drawn = drawLetter("n", grazing)!;
    const seam = seamsOf(grazing.parts.script, HAND.metrics.xHeight, half).low;
    const runs = inkRunsAt(drawn.contours, seam);
    expect([runs.length > 0, runs[runs.length - 1][1] >= drawn.advanceWidth - half])
      .toEqual([true, true]);
  });
});

describe("what the join does not touch", () => {
  it("leaves a face that does not join exactly as it was", () => {
    for (const name of ["n", "o", "a", "g"]) {
      const plain = drawLetter(name, SANS)!;
      const same = drawLetter(name, { ...SANS, parts: { ...SANS.parts } })!;
      expect(same.contours).toEqual(plain.contours);
      expect(same.advanceWidth).toBe(plain.advanceWidth);
    }
  });

  /*
   * A cursive capital is a different letter from a cursive lowercase rather
   * than a larger one, and in every hand that has been written it joins on its
   * right at best: the hand sets it down at the start of a word and carries on
   * out of it. So it takes a lead-out and never a lead-in -- one on its left
   * would be a stroke reaching into a letter nothing is ever set before.
   *
   * The `O` is one of the four left out entirely. It closes its bowl at the top
   * and the hand lifts there, which is what every copperplate does with it.
   */
  it("hands a capital on to its right and never reaches out of its left", () => {
    for (const name of ["A", "H", "K"]) {
      const joined = recipeOf(name)!(HAND);
      expect([name, joined.width !== undefined]).toEqual([name, true]);
      // The lead-in is the stroke that would start at the origin. There is none.
      const reaches = joined.strokes.some((stroke) =>
        spineStart(stroke.spine).x < 1 && spineEnd(stroke.spine).x > 1);
      expect([name, reaches]).toEqual([name, false]);
    }
  });

  it("leaves the four that close at the top, the figures and the marks alone", () => {
    for (const name of ["B", "D", "O", "P", "seven", "period", "comma"]) {
      const joined = recipeOf(name)!(HAND);
      expect([name, joined.width]).toEqual([name, undefined]);
    }
  });

  /*
   * And a letter set inside another glyph takes none of it, whatever case it
   * is: the `C` in a copyright sign is a drawing, not a letter in a word.
   */
  it("leaves a letter set inside another glyph alone", () => {
    for (const name of ["copyright", "registered", "ordfeminine"]) {
      const drawn = recipeOf(name)!(HAND);
      expect([name, drawn.width]).toEqual([name, undefined]);
    }
  });
});

describe("the advance", () => {
  /*
   * Every other letter in this engine takes its advance from where its ink
   * happened to stop. A joined one cannot: the lead-out has to finish *on* the
   * advance to the unit, so the recipe states it and the measuring is skipped.
   */
  it("is the one the recipe states, not the one the ink suggests", () => {
    for (const name of ["n", "o", "w", "g"]) {
      const stated = recipeOf(name)!(HAND).width;
      expect(stated).toBeGreaterThan(0);
      expect(drawLetter(name, HAND)!.advanceWidth).toBe(stated);
    }
  });

  /*
   * The lead-out leaves from the letter's right edge at or below the seam,
   * which on a `w` is a long way in from its widest point -- the arms lean out
   * as they rise. Spaced by the attachment rather than by the whole letter,
   * every one of those was given an advance ending inside its own ink.
   */
  it("clears the whole letter, not just the part the join leaves from", () => {
    for (const name of ["v", "w", "x", "y"]) {
      const drawn = drawLetter(name, HAND)!;
      const bounds = contoursBounds(drawn.contours);
      expect([name, bounds.xMax <= drawn.advanceWidth + HAND.pen.weight]).toEqual([name, true]);
    }
  });
});

describe("the loops", () => {
  const looped = withScript(HAND, { loop: 1.6 });

  /*
   * And they reach the letter at every weight, not only at the one the face is
   * drawn at.
   *
   * The eye's width is measured in pen-halves, which is right -- an eye has to
   * be open against the pen or it is a blob on a stem. How far it has to travel
   * to get back onto the letter is not the pen's business at all, and reading
   * that off the pen too is what took the Formal Script's curled `g` apart
   * below pen 60 and its `t` below 70: at pen 84 the eye reached y=164, well up
   * inside the bowl, and at pen 40 it stopped at y=-19, below the bowl and in
   * clear air. The only thing holding the two halves together was the hairline
   * where the eye's turn grazed the tail, this face's nib being 6.6 units
   * across a horizontal at that weight.
   *
   * Every other test of the letters draws each face at its own weight, so all
   * of them passed throughout. This one walks the axis.
   */
  it("still reach the letter at every weight, on every joining face", async () => {
    const { ready: loaded } = await import("@/font/boolean");
    const { piecesOf } = await import("./cut");
    const { letterNames } = await import("./build");
    const { formsOf } = await import("./letters");
    await loaded();
    const solid = letterNames().filter((one) => /^[A-Za-z]$/.test(one) && one !== "i" && one !== "j");
    const apart: string[] = [];
    for (const base of BASES.filter((one) => one.parts.script.on)) {
      for (const weight of [40, 60, 120, 210]) {
        const style: Style = { ...base, pen: { ...base.pen, weight } };
        for (const name of solid) {
          for (const { id } of formsOf(name)) {
            const drawn = drawLetter(name, style, id || undefined);
            if (!drawn || drawn.contours.length === 0) continue;
            if (piecesOf(drawn.contours) > 1) {
              apart.push(`${base.name} ${name}${id ? ` (${id})` : ""} at ${weight}`);
            }
          }
        }
      }
    }
    expect(apart).toEqual([]);
  }, 120_000);

  it("open the ascenders and the descenders", () => {
    for (const name of ["l", "b", "h", "k", "g", "y"]) {
      const plain = recipeOf(name)!(HAND).strokes.length;
      expect([name, recipeOf(name)!(looped).strokes.length]).toEqual([name, plain + 1]);
    }
  });

  /*
   * And nothing else. The dot of an i sits above the x-height and is not an
   * ascender; the rule that keeps it out is that a loop only goes on a run that
   * crossed the line it is reaching past, which a dot never does.
   */
  it("leave the dot of an i and the dot of a j where they are", () => {
    // The j has a descender and so gains exactly one loop; the i has neither an
    // ascender nor a descender and gains none.
    expect(recipeOf("i")!(looped).strokes.length).toBe(recipeOf("i")!(HAND).strokes.length);
    expect(recipeOf("j")!(looped).strokes.length).toBe(recipeOf("j")!(HAND).strokes.length + 1);
  });

  /*
   * And not on a capital, which is not a tall lowercase. The eye is struck
   * straight down from the highest end of the letter and does not ask what
   * that end belongs to, so every capital built on an upright was taking one
   * -- `ITEM LIFT` came out of the Formal Script as `P PEM PPF P`.
   *
   * Asked of all twenty-six because the ones that escaped did so by accident:
   * an `E` was spared only because its crossbar reaches higher than its stem
   * and the eye struck down from there found nothing to stand on, which is not
   * a rule anybody wrote.
   */
  it("leave every capital alone", () => {
    for (const name of "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")) {
      expect([name, recipeOf(name)!(looped).strokes.length]).toEqual([
        name,
        recipeOf(name)!(HAND).strokes.length,
      ]);
    }
  });

  it("are off when the control is at nothing", () => {
    for (const name of ["l", "g"]) {
      expect(recipeOf(name)!(withScript(HAND, { loop: 0 })).strokes.length)
        .toBe(recipeOf(name)!(HAND).strokes.length);
    }
  });
});

describe("an unsteady hand is still a repeatable one", () => {
  /*
   * The same reason the roughening is seeded rather than random: a letter that
   * came out somewhere different each time it was drawn could not be cached,
   * compared with itself, or exported.
   */
  it("puts a letter in the same place every time", () => {
    const wobbly = withScript(HAND, { irregularity: 2 });
    expect(drawLetter("a", wobbly)!.contours).toEqual(drawLetter("a", wobbly)!.contours);
  });

  it("puts different letters in different places", () => {
    const script = withScript(HAND, { irregularity: 1 }).parts.script;
    const lifts = LOWER.map((name) => wobbleOf(name, script, 520).lift);
    expect(new Set(lifts.map((one) => one.toFixed(4))).size).toBeGreaterThan(20);
  });

  it("does nothing at all when it is switched off", () => {
    const still = withScript(HAND, { irregularity: 0 }).parts.script;
    expect(wobbleOf("a", still, 520)).toEqual({ lift: 0, lean: 0 });
    expect(wobbleOf("a", SANS.parts.script, 520)).toEqual({ lift: 0, lean: 0 });
  });
});
