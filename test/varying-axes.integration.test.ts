/**
 * Two axes, out of three drawings.
 *
 * A design space here is a star rather than a grid: every version is the whole
 * font drawn again with a single setting moved, so it stands in the middle of
 * every axis but its own. That is not a simplification, it is the arrangement
 * `gvar` is written for -- and its payoff is that a Bold and a Condensed
 * between them describe a Bold Condensed nobody drew.
 *
 * What is checked is that the corner is really there in the file. A font can
 * declare two axes, carry deltas for both, satisfy fontTools completely, and
 * still draw the Regular at the corner because the regions were written so that
 * the two masters cancel or one of them never applies. So the file is pinned at
 * each corner and measured, in ink rather than in width, because a bold and a
 * light reach the same distance.
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { exportFont } from "../src/font/export";
import { masterFrom, soleMaster } from "../src/font/master";
import { varyByDrawnVersions } from "../src/font/masters";
import { importFont } from "../src/font/parse";
import type { Glyph } from "../src/font/types";
import { FONT_SUITE_TIMEOUT } from "./fixtures";
import { hasFontTools, inspectVariable } from "./fonttools";

const FONT_PATH = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
].find((one) => existsSync(one));

const suite = FONT_PATH && hasFontTools() ? describe : describe.skip;

suite("a font that varies in two directions", () => {
  const LETTERS = ["n", "o", "H", "e"];

  /** Every point moved, which is a different drawing with the same points. */
  function scale(glyph: Glyph, x: number, y: number): void {
    glyph.advanceWidth = Math.round(glyph.advanceWidth * x);
    for (const contour of glyph.contours) {
      for (const node of contour.nodes) {
        node.point = { x: node.point.x * x, y: node.point.y * y };
        if (node.handleIn) node.handleIn = { x: node.handleIn.x * x, y: node.handleIn.y * y };
        if (node.handleOut) node.handleOut = { x: node.handleOut.x * x, y: node.handleOut.y * y };
      }
    }
  }

  const built = (async () => {
    const { typeface } = await importFont(
      new Uint8Array(readFileSync(FONT_PATH!)),
      "DejaVuSans.ttf",
    );
    const keep = new Set([".notdef", ...LETTERS]);
    typeface.glyphs = typeface.glyphs.filter((one) => keep.has(one.name));
    typeface.glyphIndex = new Map(typeface.glyphs.map((one, at) => [one.name, at]));
    typeface.kerning = [];
    typeface.kernClasses = [];
    typeface.ligatures = [];
    typeface.sets = [];
    typeface.meta.weightClass = 400;

    const regular = soleMaster(typeface);
    regular.at = { wght: 400, wdth: 100 };

    // Taller and wider: more ink, in the way a bold has more ink.
    const bold = masterFrom(typeface, "Bold", { wght: 700, wdth: 100 }, "m2");
    for (const glyph of bold.typeface.glyphs) scale(glyph, 1.2, 1.2);

    // Narrower and no heavier: less ink, in the way a condensed has less.
    const condensed = masterFrom(typeface, "Condensed", { wght: 400, wdth: 50 }, "m3");
    for (const glyph of condensed.typeface.glyphs) scale(glyph, 0.6, 1);

    const variable = varyByDrawnVersions([regular, bold, condensed]);
    expect(variable, "three drawings on two axes should make two axes").not.toBeNull();
    expect(variable!.axes).toHaveLength(2);
    return await exportFont(typeface, {
      format: "ttf",
      fidelity: "rebuild",
      variable: variable!,
    });
  })();

  it(
    "declares both axes, where the versions were drawn",
    async () => {
      const report = inspectVariable((await built).bytes, ["n"], [{ wght: 400, wdth: 100 }]);
      expect(report.error).toBeUndefined();
      expect(report.recompiles).toBe(true);

      const byTag = Object.fromEntries(report.axes.map((one) => [one.tag, one]));
      expect(Object.keys(byTag).sort()).toEqual(["wdth", "wght"]);
      expect(byTag.wght).toMatchObject({ name: "Weight", min: 400, default: 400, max: 700 });
      // The width runs down from the default rather than up, which is what
      // "condensed" means and what the numbers have to say.
      expect(byTag.wdth).toMatchObject({ name: "Width", min: 50, default: 100, max: 100 });
      expect(report.statAxes.slice().sort()).toEqual(["wdth", "wght"]);

      expect(report.instances.map((one) => one.name).sort()).toEqual([
        "Bold",
        "Book",
        "Condensed",
      ]);
    },
    FONT_SUITE_TIMEOUT,
  );

  it(
    "draws the corner nobody drew, out of the two that were",
    async () => {
      const report = inspectVariable((await built).bytes, LETTERS, [
        { wght: 400, wdth: 100 },
        { wght: 700, wdth: 100 },
        { wght: 400, wdth: 50 },
        { wght: 700, wdth: 50 },
      ]);
      expect(report.error).toBeUndefined();
      expect(report.movingGlyphs).toBeGreaterThanOrEqual(LETTERS.length);

      for (const letter of LETTERS) {
        const regular = Math.abs(report.inkAt["wdth=100,wght=400"][letter]);
        const bold = Math.abs(report.inkAt["wdth=100,wght=700"][letter]);
        const condensed = Math.abs(report.inkAt["wdth=50,wght=400"][letter]);
        const corner = Math.abs(report.inkAt["wdth=50,wght=700"][letter]);

        expect(bold, `${letter} is no heavier at 700`).toBeGreaterThan(regular);
        expect(condensed, `${letter} is no narrower at 50`).toBeLessThan(regular);

        /*
         * And the corner is both. It is narrower than the Bold because the
         * Condensed applies at every weight, and it holds more ink than the
         * Condensed because the Bold applies at every width -- which is the
         * claim a font can get silently wrong by writing regions that let one
         * master cancel the other.
         */
        expect(corner, `${letter} at the corner is not narrower than the Bold`).toBeLessThan(bold);
        expect(corner, `${letter} at the corner is no heavier than the Condensed`).toBeGreaterThan(
          condensed,
        );
      }
    },
    FONT_SUITE_TIMEOUT,
  );
});
