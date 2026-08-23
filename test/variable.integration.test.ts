/**
 * The whole family in one file, and whether it draws what it promises.
 *
 * A variable font is the one thing this application writes that cannot be
 * checked by looking at what came out. The file holds one set of outlines and
 * a pile of differences, and every weight but the default is a sum somebody
 * else works out -- so a file can be perfectly formed, read without complaint
 * by every tool there is, and draw the wrong letters.
 *
 * Two of those got as far as a rendered specimen here. Written without regions,
 * the Black's differences still counted for six tenths at the Bold, and the
 * Bold came out wider than the Black. Written with the region the wrong way
 * round on the light side of the axis, the Thin's differences described a
 * stretch of the axis that cannot exist, counted for nothing anywhere, and the
 * Thin came out the weight of the Regular. Both files recompiled cleanly.
 *
 * So the test is not that the file parses. It is that fontTools, asked to pin
 * the font at each weight, produces the same letters as the separate files the
 * same drawings make -- which is a claim about arithmetic nobody here did.
 */

import { describe, expect, it } from "vitest";

import { ready } from "../src/font/boolean";
import { deliver } from "../src/forge/deliver";
import { startFrom, weighted } from "../src/forge/document";
import { SANS } from "../src/forge/style";
import { toTypeface } from "../src/forge/typeface";
import { exportFont } from "../src/font/export";
import { FONT_SUITE_TIMEOUT } from "./fixtures";
import { hasFontTools, inspectFont, inspectVariable } from "./fonttools";

const suite = hasFontTools() ? describe : describe.skip;

/** A family of four, which is enough to have masters at the ends and between. */
const family = () => ({
  ...startFrom(SANS),
  family: { drawn: 400, also: [100, 700, 900] },
});

const LETTERS = ["o", "H", "n", "a", "s", "B"];

suite("a font with a weight slider", { timeout: FONT_SUITE_TIMEOUT * 6 }, () => {
  it("names its axis and every weight along it", async () => {
    await ready();
    const written = await deliver(family(), {
      familyName: "Varied",
      format: "ttf",
      variable: true,
    });
    expect(written.fileName).toBe("Varied[wght].ttf");

    const read = inspectVariable(written.bytes, LETTERS, [{ wght: 400 }]);
    expect(read.error).toBeUndefined();
    expect(read.recompiles).toBe(true);
    expect(read.axes).toEqual([
      { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 },
    ]);
    // Named, because an axis and four instances with no names is a slider with
    // no label and a menu with four blanks in it, which is what it was.
    expect(read.instances.map((one) => one.name)).toEqual(["Thin", "Regular", "Bold", "Black"]);
    expect(read.instances.map((one) => one.at.wght)).toEqual([100, 400, 700, 900]);
    expect(read.statAxes).toEqual(["wght"]);
    // Most of the alphabet, rather than a few letters that happened to work.
    expect(read.movingGlyphs).toBeGreaterThan(150);
  });

  it("draws at each weight what the separate file at that weight draws", async () => {
    await ready();
    const forge = family();
    const written = await deliver(forge, { familyName: "Varied", format: "ttf", variable: true });
    const weights = [100, 400, 700, 900];
    const read = inspectVariable(
      written.bytes,
      LETTERS,
      weights.map((wght) => ({ wght })),
    );
    expect(read.error).toBeUndefined();

    for (const weight of weights) {
      const typeface = await toTypeface(weighted(forge, weight), {
        familyName: "Varied",
        styleName: "X",
        weightClass: weight,
        merge: false,
      });
      /*
       * Written the way the varying file writes its masters -- strokes left
       * overlapping, roles read off the winding -- because that is what is
       * being compared. Fused, the same drawing holds less ink, since the
       * ground where two strokes cross is counted twice before the fuse and
       * once after; measured against a fused file the Thin H is out by more
       * than a per cent for no other reason.
       */
      const alone = inspectFont(
        (
          await exportFont(typeface, {
            format: "ttf",
            fidelity: "rebuild",
            includeKerning: false,
            mergeOverlaps: false,
            roles: "winding",
          })
        ).bytes,
      );
      for (const letter of LETTERS) {
        const pinned = Math.abs(read.inkAt[`wght=${weight}`][letter]);
        const apart = Math.abs(alone.inkOf[letter]);
        expect(apart).toBeGreaterThan(0);
        /*
         * Within a per cent, which is as sharp as this comparison can honestly
         * be made: the two files approximate the same curves differently. A
         * varying font splits every curve into a fixed four, because the
         * masters have to arrive with the same points in the same order and a
         * tolerance does not promise that; a font on its own splits as few
         * ways as the tolerance allows. Both are the same drawing to well
         * under a unit, and on a Thin s -- a thin stroke with a long boundary
         * -- under a unit of boundary is most of a per cent of the ink.
         *
         * Both failures this was written for are out by ten per cent and more.
         */
        expect(Math.abs(pinned - apart) / apart, `${letter} at ${weight}`).toBeLessThan(0.01);
      }
    }
  });

  it("gets heavier the further along the axis it is asked", async () => {
    /*
     * The claim that needs no tolerance at all, and the one that catches the
     * way a variable font goes wrong.
     *
     * A weight axis holds more ink the further along it you go. That is true
     * of every letter that follows the whole axis, it is true of positions
     * between the masters as well as at them, and it does not depend on any
     * comparison with another file. Written without regions, the Bold held
     * more ink than the Black; written with a region the wrong way round, the
     * Thin held exactly as much as the Regular. Neither survives this.
     */
    await ready();
    const written = await deliver(family(), {
      familyName: "Varied",
      format: "ttf",
      variable: true,
    });
    const along = [100, 250, 400, 550, 700, 800, 900];
    const read = inspectVariable(
      written.bytes,
      LETTERS,
      along.map((wght) => ({ wght })),
    );
    expect(read.error).toBeUndefined();

    for (const letter of LETTERS) {
      const ink = along.map((weight) => Math.abs(read.inkAt[`wght=${weight}`][letter]));
      for (let step = 1; step < ink.length; step++) {
        expect(ink[step], `${letter} from ${along[step - 1]} to ${along[step]}`).toBeGreaterThan(
          ink[step - 1],
        );
      }
    }
  });

  it("is refused on the format that cannot carry it", async () => {
    await ready();
    // OpenType stores PostScript outlines, and the movement is described in
    // terms of the points of a `glyf` table, which an OTF has not got.
    const written = await deliver(family(), { familyName: "Varied", format: "otf" });
    expect(written.fileName.endsWith(".zip")).toBe(true);
  });
});
