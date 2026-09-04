/**
 * Class kerning, checked against the implementations that decide.
 *
 * The rule this rests on is not one to take on trust. A lookup tries its
 * subtables in turn and stops at the first that matches; a feature names
 * several lookups and applies all of them. Read off the specification that
 * sounds simple, and getting it slightly wrong produces a font that opens
 * fine, recompiles fine, and kerns wrongly -- which is exactly what this
 * application shipped: one subtable per class, so an A kerned against a V and
 * a T kept the first and lost the second.
 *
 * So the tables are handed to fontTools, which is what the industry reads
 * fonts with, and to HarfBuzz, which is what lays out text with them. Neither
 * has any stake in this application being right.
 */

import { describe, expect, it } from "vitest";

import { buildGposTable } from "../src/font/kern";
import { readSfnt, writeSfnt } from "../src/font/sfnt";
import { FONT_SUITE_TIMEOUT, loadTestFont } from "./fixtures";
import { hasFontTools, hasHarfbuzz, inspectFont, shapeKerning } from "./fonttools";

const source = loadTestFont();
const canRun = source !== null && hasFontTools() && hasHarfbuzz();
const suite = canRun ? describe : describe.skip;

/** Glyph ids in DejaVu Sans, which is what the test font is. */
const ID = { A: 36, T: 55, V: 57, W: 58, Y: 60, a: 68, e: 72, o: 82, H: 43 };

/** Put a GPOS table into the test font and hand it back as bytes. */
function fontWith(
  pairs: Array<{ left: number; right: number; value: number; group?: number }>,
  classes: Array<{ left: number[]; right: number[]; value: number; group?: number }>,
): Uint8Array {
  const font = readSfnt(source!);
  const gpos = buildGposTable(pairs, classes);
  expect(gpos).not.toBeNull();
  font.tables.set("GPOS", gpos!);
  return writeSfnt(font);
}

/*
 * Every pair worth asking about, for the round trip below.
 *
 * Built from the letters and marks rather than listed, because the bug being
 * guarded against lost most pairs and kept a few, and a hand-picked list would
 * very likely have been drawn from the few.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,'\"-()";
const EVERY_PAIR: string[] = [];
for (const left of ALPHABET) {
  for (const right of ALPHABET) EVERY_PAIR.push(left + right);
}

suite("a real font's kerning, in and out again", { timeout: FONT_SUITE_TIMEOUT }, () => {
  it("opens a font and finds the kerning it actually has", async () => {
    const { importFont } = await import("../src/font/parse");
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    // The test font stores its kerning as two class grids and nothing else, so
    // this is precisely the case that used to come back empty.
    expect(typeface.kernClasses.length).toBeGreaterThan(100);
    expect(new Set(typeface.kernClasses.map((klass) => klass.group)).size).toBeGreaterThan(1);
  });

  it("writes it back out kerning exactly as it did before", async () => {
    const { importFont } = await import("../src/font/parse");
    const { exportFont } = await import("../src/font/export");

    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const written = await exportFont(typeface, {
      format: "ttf",
      fidelity: "preserve",
      includeKerning: true,
      mergeOverlaps: false,
    });

    const before = shapeKerning(source!, EVERY_PAIR);
    const after = shapeKerning(written.bytes, EVERY_PAIR);

    const kerned = Object.values(before).filter((value) => value !== 0).length;
    expect(kerned, "the test font has kerning to lose").toBeGreaterThan(100);

    const lost = EVERY_PAIR.filter((pair) => before[pair] !== after[pair]).slice(0, 10);
    expect(
      lost,
      `pairs that changed: ${lost.map((p) => `${p} ${before[p]}->${after[p]}`).join(", ")}`,
    ).toEqual([]);
  });

  /*
   * The legacy table cannot hold a real font's class kerning and never could;
   * what it must not do is take a quarter of an hour deciding that. Expanding
   * the classes used to ask a list of every pair already written about each of
   * the hundreds of thousands the classes stand for, which for one font is
   * five billion comparisons.
   */
  it("expands the classes for the legacy table without hanging on it", async () => {
    const { exportFont } = await import("../src/font/export");
    const { importFont } = await import("../src/font/parse");
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");

    // Something the size of a large family's kerning, on top of what is there.
    const names = typeface.glyphs.slice(1, 400).map((glyph) => glyph.name);
    for (let index = 0; index < 600; index++) {
      typeface.kernClasses.push({
        id: `bulk-${index}`,
        name: `bulk ${index}`,
        left: names.slice(index % 40, (index % 40) + 60),
        right: names.slice(200 - (index % 40), 260 - (index % 40)),
        value: -(index % 30) - 1,
      });
    }

    const started = Date.now();
    const written = await exportFont(typeface, {
      format: "ttf",
      fidelity: "preserve",
      includeKerning: true,
      mergeOverlaps: false,
    });
    const took = Date.now() - started;

    expect(written.bytes.length).toBeGreaterThan(0);
    // Generous by a wide margin: the work itself is a second or so, and the
    // shape this guards against was minutes rather than a slow second.
    expect(took, `export took ${took}ms`).toBeLessThan(30_000);
    expect(inspectFont(written.bytes).recompiles).toBe(true);
  });
});

suite("class kerning as a shaper sees it", { timeout: FONT_SUITE_TIMEOUT }, () => {
  it("keeps every class that speaks about the same letter", () => {
    const bytes = fontWith(
      [],
      [
        { left: [ID.A], right: [ID.V], value: -150 },
        { left: [ID.A], right: [ID.T], value: -90 },
        { left: [ID.A], right: [ID.o, ID.a], value: -40 },
      ],
    );
    expect(shapeKerning(bytes, ["AV", "AT", "Ao", "Aa", "AH"])).toEqual({
      AV: -150,
      AT: -90,
      Ao: -40,
      Aa: -40,
      AH: 0,
    });
  });

  it("gives every letter of a class the same value", () => {
    const bytes = fontWith([], [{ left: [ID.W, ID.V], right: [ID.o, ID.a], value: -70 }]);
    expect(shapeKerning(bytes, ["Wo", "Wa", "Vo", "Va", "Ho"])).toEqual({
      Wo: -70,
      Wa: -70,
      Vo: -70,
      Va: -70,
      Ho: 0,
    });
  });

  it("lets a pair of its own override the class it falls into", () => {
    const bytes = fontWith(
      [{ left: ID.T, right: ID.a, value: -200 }],
      [{ left: [ID.T], right: [ID.a, ID.o], value: -60 }],
    );
    expect(shapeKerning(bytes, ["Ta", "To"])).toEqual({ Ta: -200, To: -60 });
  });

  it("adds up what two lookups each contribute", () => {
    const bytes = fontWith(
      [],
      [
        { left: [ID.A], right: [ID.V], value: -150, group: 0 },
        { left: [ID.A], right: [ID.V], value: -20, group: 1 },
      ],
    );
    expect(shapeKerning(bytes, ["AV"])).toEqual({ AV: -170 });
  });

  it("writes a table fontTools can read and rebuild", () => {
    const bytes = fontWith(
      [{ left: ID.T, right: ID.a, value: -200 }],
      [
        { left: [ID.A], right: [ID.V], value: -150 },
        { left: [ID.A], right: [ID.T], value: -90 },
        { left: [ID.Y], right: [ID.e], value: -110 },
      ],
    );
    const report = inspectFont(bytes);
    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    expect(report.tables).toContain("GPOS");
    // Reported by glyph name, and every one of the classes is present.
    expect(Object.values(report.gposKernPairs)).toContain(-150);
    expect(Object.values(report.gposKernPairs)).toContain(-90);
    expect(Object.values(report.gposKernPairs)).toContain(-110);
  });

  /*
   * The size at which sixteen-bit offsets stop reaching, which a real font's
   * kerning is well past. Without extension lookups the table written here
   * pointed into the middle of itself and fontTools would not read it.
   */
  it("writes a table far too big for the offsets a lookup list uses", () => {
    const pairs: Array<{ left: number; right: number; value: number }> = [];
    for (let left = 1; left <= 500; left++) {
      for (let right = 1; right <= 40; right++) {
        pairs.push({ left, right: 600 + right, value: -3 });
      }
    }
    const bytes = fontWith(pairs, [{ left: [ID.A], right: [ID.V], value: -150 }]);
    const report = inspectFont(bytes);
    expect(report.error).toBeUndefined();
    expect(report.recompiles).toBe(true);
    // And the shaper still finds the class hiding behind twenty thousand pairs.
    expect(shapeKerning(bytes, ["AV"])).toEqual({ AV: -150 });
  });
});
