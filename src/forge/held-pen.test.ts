/**
 * The pen read as held (`metrics.heldPen`), and only where a face says so.
 *
 * How near a didone's the s, the S and the dollar are drawn is read off the
 * pen's contrast. The Soft Serif's broad nib, held at eighteen degrees,
 * carries some of its weight into its level runs, so its letters read the
 * contrast across the pen as held; read that way on every text serif, the
 * Serif's s, S and dollar moved whenever its contrast slider went past 0.6,
 * though nothing about the Serif had asked for it. So the held reading is the
 * Soft Serif's, by a field no base sets, and every base reads its own pen's
 * contrast at every contrast and angle, as it always did.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contoursIntersect } from "@/font/outline";
import { drawLetter } from "./build";
import { formOf, startFrom } from "./document";
import { readyToShape } from "./layers";
import { frame } from "./letters/common";
import { sDidone, textSerif } from "./letters/humanist";
import { SOFT_SERIF } from "./starts";
import { BASES, SERIF, type Style } from "./style";
import { FOLD_WEIGHTS, foldSweep } from "./testing/fold-sweep";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const CONTRASTS = [0, 0.3, 0.55, 0.6, 0.62, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
const ANGLES = [-45, -30, -15, 0, 8, 15, 18, 30, 45];

const onPen = (style: Style, contrast: number, angle: number): Style => ({
  ...style,
  pen: { ...style.pen, contrast, angle },
});

const held = (style: Style): Style => ({ ...style, metrics: { ...style.metrics, heldPen: true } });

describe("the s's share of a didone's", () => {
  it("is read off the pen's own contrast on every base, at every contrast and angle", () => {
    const wrong: string[] = [];
    for (const base of BASES) {
      for (const contrast of CONTRASTS) {
        for (const angle of ANGLES) {
          const style = onPen(base, contrast, angle);
          const share = sDidone(frame(style));
          const own = Math.max(0, contrast - 0.6) / 0.2;
          if (!Object.is(share, own)) wrong.push(`${base.name} ${contrast}/${angle}: ${share}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("is read across the pen as held on a text serif that says so", () => {
    const style = frame(SOFT_SERIF);
    expect(SOFT_SERIF.metrics.heldPen).toBe(true);
    expect(textSerif(style)).toBe(true);
    const thin = 1 - SOFT_SERIF.pen.contrast;
    const turned = (SOFT_SERIF.pen.angle * Math.PI) / 180;
    const sin2 = Math.sin(turned) ** 2;
    const cos2 = Math.cos(turned) ** 2;
    const across = 1 - (sin2 + thin * cos2) / (cos2 + thin * sin2);
    expect(sDidone(style)).toBe(Math.max(0, across - 0.6) / 0.2);
    // Well short of what the pen's own contrast reads, 0.7 against 0.6 and a half.
    expect(sDidone(style)).toBeLessThan(0.1);
    expect(Math.max(0, SOFT_SERIF.pen.contrast - 0.6) / 0.2).toBeCloseTo(0.5, 9);
  });

  it("is the pen's own on a face that is no text serif, whatever it says", () => {
    for (const base of BASES.filter((one) => !textSerif(frame(one)))) {
      for (const contrast of [0.62, 0.75, 0.9]) {
        const style = held(onPen(base, contrast, 18));
        expect(sDidone(frame(style)), base.name).toBe(Math.max(0, contrast - 0.6) / 0.2);
      }
    }
  });
});

describe("the Serif's s, S and dollar", () => {
  it("move with the held reading only where the field is set: the same pen, held and not", () => {
    const moved: string[] = [];
    for (const [contrast, angle] of [
      [0.75, 18],
      [0.7, -15],
      [0.85, 8],
    ]) {
      const plain = onPen(SERIF, contrast, angle);
      for (const name of ["s", "S", "dollar"]) {
        // In the forms the Serif draws them in: see `bookS`.
        const form = formOf(startFrom(SERIF), name) || undefined;
        const one = JSON.stringify(drawLetter(name, plain, form)!.contours);
        const other = JSON.stringify(drawLetter(name, held(plain), form)!.contours);
        if (one !== other) moved.push(`${name} ${contrast}/${angle}`);
      }
    }
    // The field is the one switch: set, the letters are drawn the held way.
    expect(moved.length).toBeGreaterThan(0);
  });
});

describe("the pen read as held, folding nothing", () => {
  it("folds no letter it reaches on the faces the controls are driven on", () => {
    expect(foldSweep("metrics.heldPen", [true], ["s", "S", "dollar", "g"])).toEqual([]);
  });

  it("folds none of them on the Serif at a broad nib's contrasts and angles", () => {
    const folds: string[] = [];
    for (const [contrast, angle] of [
      [0.7, 18],
      [0.75, 18],
      [0.85, 8],
      [0.7, -15],
      [0.65, 30],
    ]) {
      for (const weight of FOLD_WEIGHTS) {
        const style = held(onPen({ ...SERIF, pen: { ...SERIF.pen, weight } }, contrast, angle));
        for (const name of ["s", "S", "dollar", "g"]) {
          const form = formOf(startFrom(SERIF), name) || undefined;
          const drawn = drawLetter(name, style, form)!;
          if (drawn.contours.some((contour) => contoursIntersect([contour])))
            folds.push(`${name} at ${contrast}/${angle}, weight ${weight}`);
        }
      }
    }
    expect(folds).toEqual([]);
  });
});
