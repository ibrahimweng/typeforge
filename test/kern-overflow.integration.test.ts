/**
 * Kerning too big for one subtable, as fontTools and HarfBuzz read it.
 *
 * The Soft Serif's class grid came to 183 left classes by 172 right ones,
 * and the offset to its right-hand class definition -- 66,218 bytes into the
 * subtable -- was written into sixteen bits as 682. The file opened, fontTools
 * recompiled it, and nothing failed: fontTools logged a class definition of
 * format 0 and HarfBuzz dropped the lookup, so of the family's twenty-seven
 * members eighteen set `To` and `AV` and `P.` with no kerning at all.
 *
 * The writer's own reader cannot be the witness for that, because a reader
 * written alongside the writer shares its idea of where things are. So the
 * tables go to the two implementations that decide: fontTools, which the
 * type industry reads fonts with, and HarfBuzz, which lays out the text.
 */

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { kernBetween, readGposKerning } from "../src/font/gpos";
import { buildGposTable, type ResolvedClassKern } from "../src/font/kern";
import { readSfnt, writeSfnt } from "../src/font/sfnt";
import { deliver } from "../src/forge/deliver";
import { familyOf, setFamily, startFrom } from "../src/forge/document";
import { SOFT_SERIF } from "../src/forge/starts";
import { FONT_SUITE_TIMEOUT, loadTestFont } from "./fixtures";
import { glyphOrder, hasFontTools, hasHarfbuzz, inspectFont, shapeKerning } from "./fonttools";

const canRun = hasFontTools() && hasHarfbuzz();
const suite = canRun ? describe : describe.skip;
const source = loadTestFont();

/**
 * The pairs the review of the Soft Serif found open at its drawn weight, and a
 * few of their kind. The engine measures every weight for itself, and at the
 * Thin a `W` and an `a` are far enough apart to need nothing, so only the
 * first few -- which every weight kerns -- are asked of every file.
 */
const TELLING = ["To", "AV", "P.", "Te", "VA", "Ty", "Wa", "r.", "Yo", "Av"];
const EVERY_WEIGHT = 5;

/** Letters and the two marks of punctuation that kern hardest, with their glyph names. */
const SETTING: Array<[string, string]> = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    .split("")
    .map((letter) => [letter, letter] as [string, string]),
  [".", "period"],
  [",", "comma"],
];

suite("kerning too big for one subtable", { timeout: FONT_SUITE_TIMEOUT }, () => {
  /*
   * A grid of 191 by 176 cells in a real font, with real letters in some of
   * its classes, so that the shaper can be asked about them -- one of them,
   * the V on the left, in the last class of all, where only a piece after the
   * first can answer for it.
   */
  // The test font is required in CI (see `fixtures.ts`), and only it is skipped without one.
  const withFont = source ? it : it.skip;
  withFont("is written so that fontTools reads every class and HarfBuzz kerns every pair", () => {
    const ID = { A: 36, T: 55, V: 57, W: 58, Y: 60, a: 68, e: 72, o: 82 };
    const leftOf = (klass: number): number[] =>
      klass === 1
        ? [ID.A]
        : klass === 2
          ? [ID.T]
          : klass === 3
            ? [ID.W, ID.Y]
            : klass === 190
              ? [ID.V]
              : [2000 + klass * 2, 2001 + klass * 2];
    const rightOf = (klass: number): number[] =>
      klass === 1
        ? [ID.V]
        : klass === 2
          ? [ID.o, ID.e]
          : klass === 3
            ? [ID.a]
            : klass === 175
              ? [ID.T]
              : [3000 + klass * 2, 3001 + klass * 2];
    const classes: ResolvedClassKern[] = [];
    const cell = new Map<string, number>();
    for (let left = 1; left <= 190; left++) {
      for (let right = 1; right <= 175; right++) {
        const named = left === 1 || right === 1;
        if (!named && ((left * 7 + right * 3) % 4 === 0 || (left + 1) * (right + 1) > 28_000)) {
          continue;
        }
        const value = -(((left * 31 + right * 17) % 120) + 1);
        classes.push({ left: leftOf(left), right: rightOf(right), value });
        cell.set(`${left},${right}`, value);
      }
    }
    const font = readSfnt(source!);
    font.tables.set("GPOS", buildGposTable([], classes)!);
    const bytes = writeSfnt(font);

    // Which class each test letter is in, and so what each pair should kern by.
    const want: Record<string, number> = {
      AV: cell.get("1,1") ?? 0,
      To: cell.get("2,2") ?? 0,
      Te: cell.get("2,2") ?? 0,
      Ta: cell.get("2,3") ?? 0,
      Wa: cell.get("3,3") ?? 0,
      Yo: cell.get("3,2") ?? 0,
      AT: cell.get("1,175") ?? 0,
      Va: cell.get("190,3") ?? 0,
      VV: cell.get("190,1") ?? 0,
    };
    expect(Object.values(want).filter((value) => value !== 0).length).toBeGreaterThanOrEqual(7);

    const report = inspectFont(bytes);
    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    for (const pair of Object.keys(want)) {
      const key = `${pair[0]},${pair[1]}`;
      expect(report.gposKernPairs[key] ?? 0, key).toBe(want[pair]);
    }
    expect(shapeKerning(bytes, Object.keys(want))).toEqual(want);
  });

  /*
   * The family itself: the drawn weight, which is what most people will
   * export, and the Thin and the Bold, which overflowed as well. Each is held
   * to fontTools, to HarfBuzz, and to agreement between HarfBuzz and the
   * application's own reader on every pair of letters.
   */
  it("leaves the Soft Serif family kerned in every file", async () => {
    const start = startFrom(SOFT_SERIF);
    const forge = setFamily(start, { drawn: familyOf(start).drawn, also: [100, 700] });
    const written = await deliver(forge, { familyName: "Soft Kern", format: "ttf" });
    const files = Object.entries(unzipSync(written.bytes)).filter(([name]) =>
      name.endsWith(".ttf"),
    );
    expect(files.map(([name]) => name).sort()).toEqual([
      "SoftKern-Bold.ttf",
      "SoftKern-Regular.ttf",
      "SoftKern-Thin.ttf",
    ]);

    const pairs: string[] = [];
    for (const [left] of SETTING) for (const [right] of SETTING) pairs.push(left + right);

    for (const [name, bytes] of files) {
      const report = inspectFont(bytes);
      expect(report.error, name).toBeUndefined();
      expect(report.recompiles, name).toBe(true);
      expect(Object.keys(report.gposKernPairs).length, name).toBeGreaterThan(1000);

      const shaped = shapeKerning(bytes, pairs);
      const asked = name.endsWith("-Regular.ttf") ? TELLING : TELLING.slice(0, EVERY_WEIGHT);
      for (const pair of asked) {
        expect(shaped[pair], `${name} ${pair}`).toBeLessThan(0);
      }

      // HarfBuzz and the reader this application opens fonts with, on every pair.
      const order = glyphOrder(bytes);
      const id = new Map(order.map((glyph, index) => [glyph, index]));
      const kerning = readGposKerning(readSfnt(bytes).tables.get("GPOS")!);
      const disagree: string[] = [];
      let kerned = 0;
      for (const [left, leftName] of SETTING) {
        for (const [right, rightName] of SETTING) {
          const ours = kernBetween(kerning, id.get(leftName)!, id.get(rightName)!);
          const theirs = shaped[left + right];
          if (theirs !== 0) kerned++;
          if (ours !== theirs) disagree.push(`${left}${right} ${ours} ${theirs}`);
        }
      }
      expect(disagree, name).toEqual([]);
      expect(kerned, name).toBeGreaterThan(100);
    }
  });
});
