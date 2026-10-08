/**
 * Every soft finish at nought is no finish at all.
 *
 * Each of the new fields is left out on every base, and the drawing then goes
 * the old way. Set to its neutral value instead -- nought, or one for the dot's
 * scale -- it must go the old way too: a document that turned a finish up and
 * back down again, or a face that names one at nought, is drawing the face it
 * started from, to the last bit of every coordinate. So this compares the two
 * as JSON, every letter in every form, rather than within a tolerance.
 */

import { describe, expect, it } from "vitest";

import { drawLetter, letterNames } from "./build";
import { everyFormOf } from "./letters";
import { prepared } from "./prepare";
import { recipeOf } from "./letters";
import { SANS, SERIF, type Style } from "./style";
import { foldSweep } from "./testing/fold-sweep";

/** The style with every soft finish named and set to its neutral value. */
function neutral(base: Style): Style {
  const { parts, metrics } = base;
  return {
    ...base,
    metrics: { ...metrics, dotScale: 1 },
    parts: {
      ...parts,
      slab: { ...parts.slab, tip: 0, swell: 0 },
      shoulder: { ...parts.shoulder, rise: 0 },
      bowl: { ...parts.bowl, tail: 0, heft: 0, heftTilt: 0 },
      corner: { ...parts.corner, fillet: 0 },
      terminal: {
        ...parts.terminal,
        soft: 0,
        taper: 0,
        dropSize: 0,
        dropHang: 0,
        dropCurl: 0,
        dropNeck: 0,
      },
    },
  };
}

describe("every soft finish at nought", () => {
  for (const base of [SERIF, SANS]) {
    it(`draws the ${base.name} exactly as it was, every letter in every form`, {
      timeout: 120_000,
    }, () => {
      const style = neutral(base);
      const moved: string[] = [];
      for (const name of letterNames()) {
        for (const { id } of everyFormOf(name)) {
          const was = drawLetter(name, base, id || undefined);
          const now = drawLetter(name, style, id || undefined);
          const one = JSON.stringify(was && { contours: was.contours, advance: was.advanceWidth });
          const other = JSON.stringify(
            now && { contours: now.contours, advance: now.advanceWidth },
          );
          if (one !== other) moved.push(`${name}${id ? `/${id}` : ""}`);
        }
      }
      expect(moved).toEqual([]);
    });
  }

  it("hands every dressed stroke on as the very same stroke", () => {
    for (const base of [SERIF, SANS]) {
      for (const style of [base, neutral(base)]) {
        for (const name of ["o", "c", "e", "n", "E", "v"]) {
          for (const stroke of recipeOf(name)!(style).strokes) {
            expect(prepared(stroke, style)).toBe(stroke);
          }
        }
      }
    }
  });

  it("folds nothing the face did not already fold", () => {
    expect(foldSweep("slab.tip", [0])).toEqual([]);
    expect(foldSweep("metrics.dotScale", [1])).toEqual([]);
  });
});
