/**
 * A font somebody opened, shipped as one file that varies.
 *
 * The `fvar`/`gvar`/`STAT` writer has been here since the forge learned to put
 * a family in one file, and it takes masters as whole typefaces -- so nothing
 * about it was ever particular to a drawn-from-nothing face. Only the forge
 * could reach it. An imported or hand-drawn font could not be shipped as a
 * variable one at all.
 *
 * What makes it work is a fact about `applyWeight`: it walks the nodes a
 * contour already has and offsets each one along its own normal, so two weights
 * of a letter come out with the same points in the same order. That is the one
 * thing a variable font cannot do without, and it is a claim about code rather
 * than a wish -- so it is checked here by asking fontTools to pin the font at
 * each end and measuring what it draws.
 *
 * Measured as ink rather than as width. A width says only how far a letter
 * reaches, and a bold and a light reach the same distance; signed area answers
 * the question actually being asked, which is whether the strokes got heavier.
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { exportFont } from "../src/font/export";
import { varyByWeight, axisPositionOf } from "../src/font/masters";
import { importFont } from "../src/font/parse";
import { FONT_SUITE_TIMEOUT } from "./fixtures";
import { hasFontTools, inspectVariable } from "./fonttools";

const FONT_PATH = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
].find((one) => existsSync(one));

const suite = FONT_PATH && hasFontTools() ? describe : describe.skip;

suite("an opened font shipped as one that varies", () => {
  const varied = async () => {
    const { typeface } = await importFont(
      new Uint8Array(readFileSync(FONT_PATH!)),
      "DejaVuSans.ttf",
    );
    const variable = varyByWeight(typeface);
    expect(variable, "a font at rest should have room to vary").not.toBeNull();
    return await exportFont(typeface, {
      format: "ttf",
      fidelity: "rebuild",
      variable: variable!,
    });
  };

  it(
    "declares the axis a reader's software looks for",
    async () => {
      const built = await varied();
      const report = inspectVariable(built.bytes, ["n"], [{ wght: 400 }]);
      expect(report.error).toBeUndefined();
      expect(report.recompiles).toBe(true);

      expect(report.axes).toHaveLength(1);
      expect(report.axes[0].tag).toBe("wght");
      expect(report.axes[0].name).toBe("Weight");
      // The numbering every font menu is drawn from, rather than the
      // em-relative fraction the slider actually moves.
      expect(report.axes[0].min).toBe(100);
      expect(report.axes[0].max).toBe(900);
      // STAT says the same, which is what a menu reads to place the font.
      expect(report.statAxes).toEqual(["wght"]);

      // Named, because an axis with no instances is a slider and not a family.
      expect(report.instances.map((one) => one.name)).toContain("Bold");
      expect(report.instances.map((one) => one.name)).toContain("Light");
    },
    FONT_SUITE_TIMEOUT,
  );

  /*
   * The claim that matters, and the one a well-formed file can get wrong
   * silently: pinned at 900 the letters have to be heavier than at 100. Two
   * variable fonts got as far as a rendered specimen here with the arithmetic
   * wrong and every tool reading them without complaint.
   */
  it(
    "draws heavier at the bold end than at the light one",
    async () => {
      const built = await varied();
      const letters = ["n", "o", "H", "e"];
      const report = inspectVariable(built.bytes, letters, [
        { wght: 100 },
        { wght: 400 },
        { wght: 900 },
      ]);
      expect(report.error).toBeUndefined();
      expect(report.movingGlyphs).toBeGreaterThan(100);

      for (const letter of letters) {
        const light = Math.abs(report.inkAt["wght=100"][letter]);
        const middle = Math.abs(report.inkAt["wght=400"][letter]);
        const bold = Math.abs(report.inkAt["wght=900"][letter]);
        expect(bold, `${letter} is no heavier at 900 than at 100`).toBeGreaterThan(light);
        // And the middle really is in the middle, rather than the whole of the
        // movement sitting at one end.
        expect(middle, `${letter} at 400 is not between its ends`).toBeGreaterThan(light);
        expect(middle, `${letter} at 400 is not between its ends`).toBeLessThan(bold);
      }
    },
    FONT_SUITE_TIMEOUT,
  );

  it("puts the default where the drawing actually sits", () => {
    /*
     * In font units, which is what `params.weight` holds -- the slider is drawn
     * in fractions of the em and the inspector multiplies on the way in. Both
     * halves of that are in the code and neither is in the type, and building
     * masters at the raw fraction produced a variable font whose bold and light
     * were the same letters to four decimal places.
     */
    const em = 2048;
    expect(axisPositionOf(-0.04 * em, em)).toBe(100);
    expect(axisPositionOf(0.06 * em, em)).toBe(900);
    // The slider runs further up than down, so a font at rest sits four tenths
    // along rather than in the middle.
    expect(axisPositionOf(0, em)).toBe(420);
    // And the same fraction lands in the same place whatever the em is.
    expect(axisPositionOf(0, 1000)).toBe(420);
  });
});
