/**
 * A family with widths as well as weights, in one file and in many.
 *
 * The weight slider is checked in `variable.integration.test.ts` by pinning the
 * font and comparing what comes out against the same drawing written alone.
 * Two sliders need one thing more: the corners. A Condensed Bold is drawn, not
 * worked out, and the file stores only what is left of it once the Bold's and
 * the Condensed's differences are added -- so a corner written as its whole
 * difference from the Regular comes out with the Bold counted twice, and every
 * tool reads the file without complaint. Pinned at the corner, the letters
 * have to be the Condensed Bold's own.
 */

import { describe, expect, it } from "vitest";

import { ready } from "../src/font/boolean";
import { exportFont } from "../src/font/export";
import { unzipSync } from "fflate";
import { deliver } from "../src/forge/deliver";
import { startFrom, weighted } from "../src/forge/document";
import type { WaveBook } from "../src/forge/shapes";
import { SANS } from "../src/forge/style";
import { toTypeface } from "../src/forge/typeface";
import { FONT_SUITE_TIMEOUT } from "./fixtures";
import { hasFontTools, inspectFont, inspectVariable } from "./fonttools";

const suite = hasFontTools() ? describe : describe.skip;

/** Two weights at two widths: the four corners and nothing between. */
const family = () => ({
  ...startFrom(SANS),
  family: { drawn: 400, also: [700], widths: [75] },
});

const LETTERS = ["o", "H", "n", "a", "s", "B"];

/** The files of an archive, in the order they were written. */
const unzip = (bytes: Uint8Array) =>
  Object.entries(unzipSync(bytes)).map(([name, inside]) => ({ name, bytes: inside }));
const CORNERS = [
  { wght: 400, wdth: 100 },
  { wght: 700, wdth: 100 },
  { wght: 400, wdth: 75 },
  { wght: 700, wdth: 75 },
];
const key = (at: { wght: number; wdth: number }) => `wdth=${at.wdth},wght=${at.wght}`;

suite("a font with a width slider beside the weight", { timeout: FONT_SUITE_TIMEOUT * 6 }, () => {
  it("names both axes, in the file and in its name", async () => {
    await ready();
    const written = await deliver(family(), {
      familyName: "Widened",
      format: "ttf",
      variable: true,
    });
    // The Google Fonts convention: the axes in the order of the alphabet.
    expect(written.fileName).toBe("Widened[wdth,wght].ttf");

    const read = inspectVariable(written.bytes, LETTERS, [{ wght: 400, wdth: 100 }]);
    expect(read.error).toBeUndefined();
    expect(read.recompiles).toBe(true);
    expect(read.axes).toEqual([
      { tag: "wght", name: "Weight", min: 400, default: 400, max: 700 },
      { tag: "wdth", name: "Width", min: 75, default: 100, max: 100 },
    ]);
    expect(read.statAxes).toEqual(["wght", "wdth"]);
    expect(read.instances.map((one) => one.name)).toEqual([
      "Condensed",
      "Condensed Bold",
      "Regular",
      "Bold",
    ]);
    expect(read.instances.map((one) => one.at)).toEqual([
      { wght: 400, wdth: 75 },
      { wght: 700, wdth: 75 },
      { wght: 400, wdth: 100 },
      { wght: 700, wdth: 100 },
    ]);
    expect(read.movingGlyphs).toBeGreaterThan(150);
    expect(written.members.map((one) => one.styleName)).toEqual([
      "Condensed",
      "Condensed Bold",
      "Regular",
      "Bold",
    ]);
  });

  it("draws at every corner what that member drawn alone draws", async () => {
    await ready();
    const forge = family();
    const written = await deliver(forge, { familyName: "Widened", format: "ttf", variable: true });
    const read = inspectVariable(written.bytes, LETTERS, CORNERS);
    expect(read.error).toBeUndefined();

    // With the book the family keeps, written from the Regular first, as the
    // varying file draws its masters: see `WaveBook`.
    const waves: WaveBook = {
      lengths: new Map(),
      bowls: new Map(),
      balls: new Map(),
      corners: new Map(),
      recording: true,
    };
    for (const at of CORNERS) {
      const typeface = await toTypeface(weighted(forge, at.wght, at.wdth), {
        familyName: "Widened",
        styleName: "X",
        weightClass: at.wght,
        merge: false,
        waves,
      });
      waves.recording = false;
      // Written as the varying file writes its masters: see the weight test.
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
        const pinned = Math.abs(read.inkAt[key(at)][letter]);
        const apart = Math.abs(alone.inkOf[letter]);
        expect(apart).toBeGreaterThan(0);
        // Within a per cent, as the weight test holds it. A corner written as
        // its whole difference counts the Bold twice and is out by a third.
        expect(Math.abs(pinned - apart) / apart, `${letter} at ${key(at)}`).toBeLessThan(0.01);
        /*
         * And as wide, to within two units. The advance varies by a phantom
         * point that stands where the outline's own left edge does, which is
         * a fraction of a unit off the whole number the file keeps -- so the
         * default and the master can each round a unit away from the advance
         * that was fitted. A corner counting the Bold twice is out by tens.
         */
        expect(
          Math.abs(read.advanceAt[key(at)][letter] - alone.advanceWidths[letter]),
          `${letter} at ${key(at)}`,
        ).toBeLessThanOrEqual(2);
      }
    }
  });

  it("is narrower condensed, at every weight and everywhere between", async () => {
    await ready();
    const written = await deliver(family(), {
      familyName: "Widened",
      format: "ttf",
      variable: true,
    });
    const along = [75, 81, 87.5, 94, 100];
    const read = inspectVariable(
      written.bytes,
      LETTERS,
      [400, 550, 700].flatMap((wght) => along.map((wdth) => ({ wght, wdth }))),
    );
    expect(read.error).toBeUndefined();
    for (const wght of [400, 550, 700]) {
      let sum = { condensed: 0, normal: 0 };
      for (const letter of LETTERS) {
        const widths = along.map((wdth) => read.advanceAt[key({ wght, wdth })][letter]);
        for (let step = 1; step < widths.length; step++) {
          expect(widths[step], `${letter} at ${wght} from ${along[step - 1]}`).toBeGreaterThan(
            widths[step - 1],
          );
        }
        sum = { condensed: sum.condensed + widths[0], normal: sum.normal + widths.at(-1)! };
        // Narrower bowls and closer counters, not only tighter spacing: the
        // ink itself is narrower, so it is less ink at the same pen.
        expect(
          Math.abs(read.inkAt[key({ wght, wdth: 75 })][letter]),
          `${letter} ink at ${wght}`,
        ).toBeLessThan(Math.abs(read.inkAt[key({ wght, wdth: 100 })][letter]));
      }
      // About four fifths of the Normal, which is what a Condensed sets.
      expect(sum.condensed / sum.normal).toBeGreaterThan(0.7);
      expect(sum.condensed / sum.normal).toBeLessThan(0.88);
    }
  });

  it("keeps every letter's points at every corner of an ordinary family", async () => {
    await ready();
    /*
     * The width moves the same strokes the weight does, so a Regular and a
     * Bold at a Condensed and a Normal line up letter for letter. The tilde
     * did not until its two arcs were made to meet at every width: drawn
     * narrower it gained a step, and two points, where they joined.
     */
    for (const widths of [[75], [87.5, 112.5]]) {
      const written = await deliver(
        { ...startFrom(SANS), family: { drawn: 400, also: [700], widths } },
        { familyName: "Widened", format: "ttf", variable: true },
      );
      expect(written.held, widths.join(", ")).toEqual([]);
    }
  });

  it("holds back and names whatever cannot vary, as the weights do", async () => {
    await ready();
    const written = await deliver(
      { ...startFrom(SANS), family: { drawn: 400, also: [100, 900], widths: [75, 125] } },
      { familyName: "Widened", format: "ttf", variable: true },
    );
    /*
     * At the far corners a few letters are drawn another way -- an l's tail at
     * a Thin Expanded, the inside of an @ at a Black one -- and those cannot be
     * slid between. They are held to the masters they agree with, and said, in
     * the notes and by name, rather than torn apart halfway along a slider.
     */
    expect(written.held.length, written.held.join(" ")).toBeGreaterThan(0);
    expect(written.held.length, written.held.join(" ")).toBeLessThan(10);
    const said = written.notes.join(" ");
    expect(said).toContain(`${written.held.length} glyphs follow the axis only part of the way`);
    for (const name of written.held.slice(0, 8)) expect(said).toContain(name);
    expect(written.fileName).toBe("Widened[wdth,wght].ttf");
  });

  it("writes one static file per weight at each width, named and classed", async () => {
    await ready();
    const written = await deliver(family(), { familyName: "Widened", format: "ttf" });
    expect(written.fileName).toBe("Widened.zip");
    const files = unzip(written.bytes);
    expect(files.map((one) => one.name)).toEqual([
      "Widened-Condensed.ttf",
      "Widened-CondensedBold.ttf",
      "Widened-Regular.ttf",
      "Widened-Bold.ttf",
    ]);
    const read = Object.fromEntries(files.map((one) => [one.name, inspectFont(one.bytes)]));

    const condensedBold = read["Widened-CondensedBold.ttf"];
    expect(condensedBold.widthClass).toBe(3);
    expect(condensedBold.weightClass).toBe(700);
    expect(condensedBold.isBold).toBe(true);
    // The width in the old pair's family, the weight in its style, and the
    // whole of it in the typographic pair, which groups the four as one.
    expect(condensedBold.names["1"]).toBe("Widened Condensed");
    expect(condensedBold.names["2"]).toBe("Bold");
    expect(condensedBold.names["16"]).toBe("Widened");
    expect(condensedBold.names["17"]).toBe("Condensed Bold");

    const condensed = read["Widened-Condensed.ttf"];
    expect(condensed.widthClass).toBe(3);
    expect(condensed.weightClass).toBe(400);
    expect(condensed.names["1"]).toBe("Widened Condensed");
    expect(condensed.names["2"]).toBe("Regular");
    expect(condensed.names["17"]).toBe("Condensed");

    // The Normal members are what they were before there were widths.
    const bold = read["Widened-Bold.ttf"];
    expect(bold.widthClass).toBe(5);
    expect(bold.names["1"]).toBe("Widened");
    expect(bold.names["2"]).toBe("Bold");
    expect(bold.names["16"]).toBeUndefined();

    expect(condensed.advanceWidths.n).toBeLessThan(read["Widened-Regular.ttf"].advanceWidths.n);
  });

  it("writes an OpenType family as separate files, a width to each", async () => {
    await ready();
    const written = await deliver(family(), { familyName: "Widened", format: "otf" });
    expect(unzip(written.bytes).map((one) => one.name)).toEqual([
      "Widened-Condensed.otf",
      "Widened-CondensedBold.otf",
      "Widened-Regular.otf",
      "Widened-Bold.otf",
    ]);
    const condensed = inspectFont(unzip(written.bytes)[1].bytes);
    expect(condensed.outlineFormat).toBe("cff");
    expect(condensed.widthClass).toBe(3);
    expect(condensed.names["17"]).toBe("Condensed Bold");
  });
});
