/**
 * Letters built out of others, in a font that varies.
 *
 * An imported font stores most of its accented letters as references: `é` is
 * "the e, and the acute above it", and a fraction is its figures and a slash.
 * Written into a variable font that way, a reference has no points of its own
 * for `gvar` to move, so the letter kept its Regular advance and its parts'
 * Regular places at every weight. Lora's Bold `é` came out 542 units wide
 * beside an `e` of 629, and its circumflex sat a dozen units off centre --
 * with nothing in the export saying so, because a glyph with no points is not
 * counted as one that cannot vary.
 *
 * And a space, which has no outline at all and still has a width: as wide in
 * the Bold as in the Regular, every word at every weight but one was set too
 * tight.
 *
 * So both are measured here with fontTools, at both ends of the axis, against
 * the letters they are built from.
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { exportFont } from "../src/font/export";
import { masterFrom, soleMaster, WGHT } from "../src/font/master";
import { varyByDrawnVersions, weightParamFor } from "../src/font/masters";
import { importFont } from "../src/font/parse";
import { FONT_SUITE_TIMEOUT } from "./fixtures";
import { hasFontTools, inspectFont, inspectVariable } from "./fonttools";

const FONT_PATH = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
].find((one) => existsSync(one));

const suite = FONT_PATH && hasFontTools() ? describe : describe.skip;

suite("letters built from others, in a font that varies", () => {
  const LETTERS = ["space", "e", "acute", "eacute", "o", "circumflex", "ocircumflex"];

  const built = (async () => {
    const { typeface } = await importFont(
      new Uint8Array(readFileSync(FONT_PATH!)),
      "DejaVuSans.ttf",
    );
    // Trimmed to what is measured, for the reason the other variable suites are.
    const keep = new Set([".notdef", ...LETTERS]);
    typeface.glyphs = typeface.glyphs.filter((one) => keep.has(one.name));
    typeface.glyphIndex = new Map(typeface.glyphs.map((one, at) => [one.name, at]));
    typeface.kerning = [];
    typeface.kernClasses = [];
    typeface.ligatures = [];
    typeface.sets = [];

    // The Bold a person makes on the Font screen: the same letters, with the
    // version's own Weight setting moved.
    const regular = soleMaster(typeface);
    regular.at = { [WGHT]: 400 };
    const bold = masterFrom(typeface, "Bold", { [WGHT]: 700 }, "m2");
    bold.typeface.params = {
      ...bold.typeface.params,
      weight: weightParamFor(0, 400, 700, typeface.unitsPerEm),
    };

    const result = await exportFont(typeface, {
      format: "ttf",
      fidelity: "rebuild",
      includeKerning: false,
      mergeOverlaps: false,
      variable: varyByDrawnVersions([regular, bold])!,
    });
    // And the Bold on its own, as a static font: what the screen draws for it.
    const alone = await exportFont(bold.typeface, {
      format: "ttf",
      fidelity: "rebuild",
      includeKerning: false,
      mergeOverlaps: false,
    });
    return {
      ...inspectVariable(result.bytes, LETTERS, [{ wght: 400 }, { wght: 700 }]),
      bold: inspectFont(alone.bytes),
    };
  })();

  it(
    "widens an accented letter as much as the letter it is built on",
    async () => {
      const report = await built;
      expect(report.error).toBeUndefined();
      const light = report.advanceAt["wght=400"];
      const heavy = report.advanceAt["wght=700"];

      for (const [built, base] of [
        ["eacute", "e"],
        ["ocircumflex", "o"],
      ]) {
        expect(heavy[base]).toBeGreaterThan(light[base]);
        // The same advance as its letter at both ends, which is what it had in
        // the font it came from.
        expect(light[built]).toBe(light[base]);
        expect(heavy[built], `${built} at the Bold`).toBe(heavy[base]);
      }
    },
    FONT_SUITE_TIMEOUT,
  );

  it(
    "draws the accented letter at the Bold as the Bold on its own draws it",
    async () => {
      const report = await built;
      // Signed areas, whose sign is only the way the outlines wind.
      const varying = Math.abs(report.inkAt["wght=700"].eacute);
      const alone = Math.abs(report.bold.inkOf.eacute);
      expect(Math.abs(varying - alone) / alone).toBeLessThan(0.01);
      expect(varying).toBeGreaterThan(Math.abs(report.inkAt["wght=400"].eacute) * 1.2);
    },
    FONT_SUITE_TIMEOUT,
  );

  it(
    "widens the space as the letters around it widen",
    async () => {
      const report = await built;
      expect(report.advanceAt["wght=700"].space).toBeGreaterThan(
        report.advanceAt["wght=400"].space,
      );
    },
    FONT_SUITE_TIMEOUT,
  );
});
