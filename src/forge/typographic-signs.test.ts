/**
 * The per mille, the florin, and the spacing circumflex and tilde.
 *
 * Every base drew the typographic punctuation and none of ‰ ƒ ˆ ˜, all four of
 * which are in Windows-1252 and on a Mac keyboard, so a price list or a
 * French text set with holes in it. What is checked here is what
 * `typographic.test.ts` checks of the others: every base draws them, on the
 * same points at every weight, never through themselves, built from the marks
 * they belong with, and under the names and codepoints every other font uses
 * -- and the Sans's per mille and florin where Geist's are.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { glyphNameFor } from "@/assemble/slots";
import { ready } from "@/font/boolean";
import { contoursBounds, crossesItself } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { decidedBy, drawLetter, letterNames } from "./build";
import { formOf, startFrom } from "./document";
import { openWaveBook, waveBookAt, type WaveBook } from "./shapes";
import { BASES, type Style } from "./style";
import { codepointsFor } from "./typeface";

/** The new glyphs, by name, and the character each one is. */
const SIGNS: Record<string, string> = {
  perthousand: "‰",
  florin: "ƒ",
  circumflex: "ˆ",
  tilde: "˜",
};
const NAMES = Object.keys(SIGNS);

const drawIn = (name: string, style: Style) =>
  drawLetter(name, style, formOf(startFrom(style), name) || undefined)!;
const at = (base: Style, weight: number): Style => ({ ...base, pen: { ...base.pen, weight } });
const box = (name: string, style: Style) => contoursBounds(drawIn(name, style).contours);
const face = (name: string): Style => BASES.find((one) => one.name === name)!;

beforeAll(async () => {
  await ready();
});

describe("the per mille, the florin and the spacing accents are in the font", () => {
  it("is drawn by every base, under the names and codepoints fonts use", () => {
    const names = new Set(letterNames());
    for (const [name, character] of Object.entries(SIGNS)) {
      expect(names.has(name), `${name} is not drawn`).toBe(true);
      expect(codepointsFor(name), name).toContain(character.codePointAt(0));
      expect(glyphNameFor(character), name).toBe(name);
    }
    // The accents are the combining ones, which keep their own codepoints.
    expect(codepointsFor("circumflex")).toEqual([0x0302, 0x02c6]);
    expect(codepointsFor("tilde")).toEqual([0x0303, 0x02dc]);
    expect(codepointsFor("perthousand")).toEqual([0x2030]);
    expect(codepointsFor("florin")).toEqual([0x0192]);
    for (const style of BASES) {
      for (const name of NAMES) {
        const drawn = drawIn(name, style);
        expect(drawn?.contours.length ?? 0, `${name} is empty on ${style.name}`).toBeGreaterThan(0);
        expect(drawn.advanceWidth, `${name} on ${style.name}`).toBeGreaterThan(0);
      }
    }
  });

  it("takes its decisions from the mark it is made of", () => {
    expect(decidedBy("perthousand")).toBe("percent");
    expect(decidedBy("florin")).toBe("f");
  });

  it("draws the per mille as the percent with one more ring", () => {
    for (const style of BASES) {
      const percent = drawIn("percent", style);
      const mille = drawIn("perthousand", style);
      expect(mille.contours.length, style.name).toBeGreaterThan(percent.contours.length);
      // Wider, except in a monospaced face's one column.
      if (!style.metrics.monospaced) {
        expect(mille.advanceWidth, style.name).toBeGreaterThan(percent.advanceWidth);
      }
      const one = contoursBounds(percent.contours);
      const two = contoursBounds(mille.contours);
      expect(two.yMin, style.name).toBeCloseTo(one.yMin, 0);
      expect(two.yMax, style.name).toBeCloseTo(one.yMax, 0);
    }
  });

  /*
   * A variable font moves every point of a glyph between its masters, so each
   * has to be drawn with the same points from the Thin to past the Black,
   * with a book opened at the drawn weight as a family is exported.
   */
  it("keeps the same points at every weight, on every base", () => {
    const moved: string[] = [];
    const book: WaveBook = {
      lengths: new Map(),
      bowls: new Map(),
      balls: new Map(),
      corners: new Map(),
      recording: true,
    };
    const was = openWaveBook(book);
    try {
      for (const base of BASES) {
        book.lengths.clear();
        book.bowls.clear();
        book.balls.clear();
        book.corners.clear();
        for (const name of NAMES) {
          book.recording = true;
          waveBookAt(name);
          drawIn(name, base);
          book.recording = false;
          const counts = [0.35, 1, 2, 2.6].map((share) => {
            waveBookAt(name);
            return drawIn(name, at(base, base.pen.weight * share))
              .contours.map((contour) => contour.nodes.length)
              .join("+");
          });
          if (new Set(counts).size > 1) moved.push(`${base.name} ${name}: ${counts.join(" | ")}`);
        }
      }
    } finally {
      openWaveBook(was);
    }
    expect(moved).toEqual([]);
  }, 300_000);

  it("never crosses itself, at any weight, on any base", () => {
    const folded: string[] = [];
    for (const base of BASES) {
      for (const name of NAMES) {
        for (const share of [0.35, 1, 2, 2.6]) {
          const contours = drawIn(name, at(base, base.pen.weight * share)).contours;
          if (contours.some((contour) => crossesItself(contour) || contoursIntersect([contour]))) {
            folded.push(`${base.name} ${name} x${share}`);
          }
        }
      }
    }
    expect(folded).toEqual([]);
  }, 300_000);
});

describe("where they sit", () => {
  it("draws the Sans's per mille to Geist's measures", () => {
    // Geist Thin, Regular and Black: ink 50..955, 44..1126 and 32..1205,
    // advances 1005, 1170 and 1237, from -8 to 718.
    const sans = face("Sans");
    for (const [weight, left, right, advance] of [
      [30, 50, 955, 1005],
      [87, 44, 1126, 1170],
      [194, 32, 1205, 1237],
    ]) {
      const drawn = drawIn("perthousand", at(sans, weight));
      const ink = contoursBounds(drawn.contours);
      expect(Math.abs(ink.xMin - left), `${weight} left`).toBeLessThan(6);
      expect(Math.abs(ink.xMax - right), `${weight} right`).toBeLessThan(12);
      expect(Math.abs(drawn.advanceWidth - advance), `${weight} advance`).toBeLessThan(12);
      expect(Math.abs(ink.yMin + 8), `${weight} foot`).toBeLessThan(4);
      expect(Math.abs(ink.yMax - 718), `${weight} top`).toBeLessThan(4);
    }
  });

  it("stands the Sans's florin on the line to the cap height, leaning, as Geist's does", () => {
    const sans = face("Sans");
    // Geist Regular's: 60..472 across, 0..710 up, its advance 511.
    const drawn = drawIn("florin", sans);
    const ink = contoursBounds(drawn.contours);
    expect(Math.abs(ink.yMin)).toBeLessThan(3);
    expect(Math.abs(ink.yMax - 710)).toBeLessThan(6);
    expect(Math.abs(ink.xMin - 60)).toBeLessThan(10);
    expect(Math.abs(ink.xMax - 472)).toBeLessThan(20);
    expect(Math.abs(drawn.advanceWidth - 511)).toBeLessThan(20);
  });

  it("carries a text face's florin down to the descender, as Lora's is", () => {
    // Lora's (in its extended set): -271 to 760.
    const ink = box("florin", face("Serif"));
    expect(ink.yMin).toBeLessThan(-200);
    expect(ink.yMax).toBeGreaterThan(700);
  });

  it("sets the spacing circumflex and tilde where Geist's are on the Sans", () => {
    // Geist Regular: ˆ 44..318 by 598..731, ˜ 44..359 by 603..730.
    const sans = face("Sans");
    const hat = box("circumflex", sans);
    expect(Math.abs(hat.xMax - hat.xMin - 274)).toBeLessThan(10);
    expect(Math.abs(hat.yMin - 598)).toBeLessThan(6);
    expect(Math.abs(hat.yMax - 731)).toBeLessThan(6);
    const wave = box("tilde", sans);
    expect(Math.abs(wave.xMax - wave.xMin - 315)).toBeLessThan(10);
    expect(Math.abs(wave.yMin - 603)).toBeLessThan(6);
    expect(Math.abs(wave.yMax - 730)).toBeLessThan(6);
  });

  it("leaves a monospaced face's column as wide as it was", () => {
    const typewriter = BASES.find((one) => one.metrics.monospaced)!;
    const column = drawIn("m", typewriter).advanceWidth;
    for (const name of NAMES) {
      expect(drawIn(name, typewriter).advanceWidth, name).toBe(column);
      const ink = box(name, typewriter);
      expect(ink.xMax - ink.xMin, name).toBeLessThan(column);
    }
  });
});
