/**
 * A variable font built out of the weights somebody drew.
 *
 * The application could already ship a varying font, from masters it made up:
 * `varyByWeight` moves `params.weight` and `applyWeight` offsets every node
 * along its own normal. That is a machine-made bold -- even where a drawn one
 * is optical, thickening a hairline and a stem by the same amount -- and it is
 * the half this replaces.
 *
 * What is checked is not that the file is well formed. A well-formed variable
 * font can be silently wrong in exactly the way that matters, and has been
 * here before: correct axis, correct instances, `STAT` in order, a hundred
 * glyphs carrying deltas, and both ends drawing the same letters. So it is
 * pinned at each end with fontTools and measured -- and measured as ink rather
 * than as width, because a bold and a light reach the same distance.
 *
 * The axis itself is the tell. Synthesised masters give 100 to 900 because
 * those are the ends of a slider; drawn ones give the places the weights were
 * actually put. A font whose axis runs 400 to 700 could not have come from the
 * other path.
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { exportFont } from "../src/font/export";
import { masterFrom, soleMaster, WGHT } from "../src/font/master";
import { varyByDrawnWeights } from "../src/font/masters";
import { importFont } from "../src/font/parse";
import { FONT_SUITE_TIMEOUT } from "./fixtures";
import { hasFontTools, inspectVariable } from "./fonttools";

const FONT_PATH = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
].find((one) => existsSync(one));

const suite = FONT_PATH && hasFontTools() ? describe : describe.skip;

suite("a font shipped from the weights somebody drew", () => {
  const LETTERS = ["n", "o", "H", "e"];

  /*
   * Trimmed to four letters before anything is built, for the reason the
   * synthesised test is: a variable font is built once per master, and six
   * thousand glyphs drawn twice is ninety seconds locally and a timeout on a
   * slower runner. The claim is about the deltas between two drawings of a
   * letter, and that claim is the same whether the font holds four or six
   * thousand.
   */
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
    regular.at = { [WGHT]: 400 };
    const bold = masterFrom(typeface, "Bold", { [WGHT]: 700 }, "m2");

    /*
     * Drawn, in the only sense a test can draw: every point moved outwards
     * from the origin, which is a bigger letter with the same points in the
     * same order. It is not how a designer makes a bold and it does not have
     * to be -- what has to be true is that the file carries *these* outlines
     * and not ones the exporter worked out for itself.
     */
    for (const glyph of bold.typeface.glyphs) {
      glyph.advanceWidth = Math.round(glyph.advanceWidth * 1.2);
      for (const contour of glyph.contours) {
        for (const node of contour.nodes) {
          node.point = { x: node.point.x * 1.2, y: node.point.y * 1.2 };
          if (node.handleIn) node.handleIn = { x: node.handleIn.x * 1.2, y: node.handleIn.y * 1.2 };
          if (node.handleOut) {
            node.handleOut = { x: node.handleOut.x * 1.2, y: node.handleOut.y * 1.2 };
          }
        }
      }
    }

    const variable = varyByDrawnWeights([regular, bold]);
    expect(variable, "two drawn weights should make an axis").not.toBeNull();
    return await exportFont(typeface, {
      format: "ttf",
      fidelity: "rebuild",
      variable: variable!,
    });
  })();

  it(
    "puts the axis where the weights were drawn, not where a slider ends",
    async () => {
      const report = inspectVariable((await built).bytes, ["n"], [{ wght: 400 }]);
      expect(report.error).toBeUndefined();
      expect(report.recompiles).toBe(true);

      expect(report.axes).toHaveLength(1);
      expect(report.axes[0].tag).toBe("wght");
      /*
       * 400 to 700, because that is where the two weights were put. The
       * synthesised path gives 100 to 900 whatever the font, so this number is
       * the proof that the drawings were used.
       */
      expect(report.axes[0].min).toBe(400);
      expect(report.axes[0].default).toBe(400);
      expect(report.axes[0].max).toBe(700);
      expect(report.statAxes).toEqual(["wght"]);

      /*
       * And the instances are the weights that were drawn, by the names they
       * were given -- not the nine standard ones. A menu entry for a Thin this
       * font does not have lands on whatever the axis reaches at its lightest
       * and calls it a Thin.
       *
       * "Book" rather than "Regular" because that is what DejaVu calls its own
       * upright, and the first weight takes the name the font arrived with. It
       * is the same point twice over: these names come from the document, not
       * from a list.
       */
      expect(report.instances.map((one) => one.name).sort()).toEqual(["Bold", "Book"]);
    },
    FONT_SUITE_TIMEOUT,
  );

  it(
    "carries the drawn outlines, heavier at the drawn end",
    async () => {
      const report = inspectVariable((await built).bytes, LETTERS, [
        { wght: 400 },
        { wght: 550 },
        { wght: 700 },
      ]);
      expect(report.error).toBeUndefined();
      // Every letter in a font trimmed to four, which is a stronger statement
      // than a floor on a font of six thousand.
      expect(report.movingGlyphs).toBeGreaterThanOrEqual(LETTERS.length);

      for (const letter of LETTERS) {
        const light = Math.abs(report.inkAt["wght=400"][letter]);
        const middle = Math.abs(report.inkAt["wght=550"][letter]);
        const heavy = Math.abs(report.inkAt["wght=700"][letter]);
        expect(heavy, `${letter} is no heavier at 700 than at 400`).toBeGreaterThan(light);
        // And the middle is really in the middle rather than all of the
        // movement sitting at one end, which is how a well-formed file has
        // been silently wrong here before.
        expect(middle, `${letter} at 550 is not between its ends`).toBeGreaterThan(light);
        expect(middle, `${letter} at 550 is not between its ends`).toBeLessThan(heavy);
      }
    },
    FONT_SUITE_TIMEOUT,
  );
});
