/**
 * The library, without a network.
 *
 * Everything here is checked against fonts this application drew itself, which
 * is the only way to have a right answer to check against: the forge knows how
 * wide its pen was and how much contrast it asked for, so measuring one of its
 * fonts back has something to be measured against. A font off the internet has
 * no such thing -- you can look at the answer and nod, which is not a test.
 *
 * What that cannot cover is whether the two services are reachable and what
 * shape they answer in. Those are checked by hand against the live APIs, and
 * the readers here are written to survive being wrong about them: an entry
 * that does not make sense is dropped, and a source that fails is replaced by
 * the next one.
 */

import { describe, expect, it } from "vitest";

import { toTypeface } from "@/forge/typeface";
import { startFrom } from "@/forge/document";
import { drawLetter } from "@/forge/build";
import { troubles } from "@/forge/health";
import {
  BASES,
  DIDONE,
  GEOMETRIC,
  SANS,
  SERIF,
  TYPEWRITER,
  type Style,
} from "@/forge/style";
import type { Typeface } from "@/font/types";
import { idFor, search, type LibraryFont } from "./catalogue";
import { nearestWeight } from "./download";
import { measure } from "./measure";
import { seedFrom } from "./seed";
import { borrowFrom, adjustmentsFor, kernsIn } from "./borrow";

/** A font drawn from a style, so its real numbers are known. */
async function fontFrom(style: Style): Promise<Typeface> {
  const forge = { ...startFrom(style), style };
  return toTypeface(forge, { familyName: style.name, styleName: "Regular", merge: true });
}

describe("measuring a font by looking at it", () => {
  it("recovers the pen the font was drawn with", async () => {
    const measured = measure(await fontFrom(SANS));
    expect(measured.stem).not.toBeNull();
    // Within a twentieth. The stem is read off a rendered outline that has
    // been through a boolean fuse and a rounding to integer units, so it is
    // not going to come back to the unit -- and it does not need to.
    expect(Math.abs(measured.stem! - SANS.pen.weight)).toBeLessThan(SANS.pen.weight * 0.05);
  });

  it("recovers a heavier pen as heavier", async () => {
    const heavy = { ...SANS, pen: { ...SANS.pen, weight: SANS.pen.weight * 1.8 } };
    const light = measure(await fontFrom(SANS));
    const dark = measure(await fontFrom(heavy));
    expect(dark.stem!).toBeGreaterThan(light.stem! * 1.5);
  });

  it("reads a monolinear face as having no contrast", async () => {
    const measured = measure(await fontFrom({ ...SANS, pen: { ...SANS.pen, contrast: 0 } }));
    expect(measured.contrast).not.toBeNull();
    expect(measured.contrast!).toBeLessThan(0.12);
  });

  it("reads a high-contrast face as having it", async () => {
    const measured = measure(await fontFrom(DIDONE));
    expect(measured.contrast!).toBeGreaterThan(0.5);
  });

  it("tells a serif from a sans", async () => {
    expect(measure(await fontFrom(SERIF)).serif, "serif").toBe(true);
    expect(measure(await fontFrom(SANS)).serif, "sans").toBe(false);
    expect(measure(await fontFrom(GEOMETRIC)).serif, "geometric").toBe(false);
  });

  it("reads the lines the font was drawn against", async () => {
    const measured = measure(await fontFrom(SANS));
    expect(measured.xHeight).toBeCloseTo(SANS.metrics.xHeight, -1);
    expect(measured.capHeight).toBeCloseTo(SANS.metrics.capHeight, -1);
  });

  it("reads a lean, and reads none where there is none", async () => {
    const upright = measure(await fontFrom(SANS));
    expect(upright.slant).toBe(0);
    const leaning = measure(
      await fontFrom({ ...SANS, metrics: { ...SANS.metrics, slant: 12 } }),
    );
    expect(leaning.slant).toBeGreaterThan(9);
    expect(leaning.slant).toBeLessThan(15);
  });

  it("spots a face where every letter is one width", async () => {
    expect(measure(await fontFrom(TYPEWRITER)).monospaced, "typewriter").toBe(true);
    expect(measure(await fontFrom(SANS)).monospaced, "sans").toBe(false);
  });

  it("finds a letter in a font that carries no glyph names", async () => {
    const typeface = await fontFrom(SANS);
    // Strip the names, as a font with a version 3 post table does.
    const anonymous: Typeface = {
      ...typeface,
      glyphs: typeface.glyphs.map((glyph, index) => ({ ...glyph, name: `glyph${index}` })),
      glyphIndex: new Map(),
    };
    const measured = measure(anonymous);
    expect(measured.stem).not.toBeNull();
    expect(measured.xHeight).toBeGreaterThan(0);
  });

  it("says nothing rather than guessing when the letters are missing", () => {
    const bare: Typeface = {
      ...({} as Typeface),
      meta: { familyName: "Bare", styleName: "", version: "", designer: "", manufacturer: "", copyright: "", license: "", weightClass: 400 },
      unitsPerEm: 1000,
      metrics: { ascender: 750, descender: -250, capHeight: 700, xHeight: 500, lineGap: 0 },
      glyphs: [],
      glyphIndex: new Map(),
      kerning: [],
      kernClasses: [],
      source: null,
    } as Typeface;
    const measured = measure(bare);
    expect(measured.stem).toBeNull();
    expect(measured.contrast).toBeNull();
    expect(measured.serif).toBeNull();
    expect(measured.slant).toBe(0);
  });
});

describe("seeding a drawing from a measurement", () => {
  it("starts a serif from a serif base and a sans from a sans one", async () => {
    expect(seedFrom(measure(await fontFrom(SERIF))).base).toBe("Serif");
    expect(["Grotesque", "Geometric"]).toContain(seedFrom(measure(await fontFrom(SANS))).base);
  });

  it("starts a high-contrast serif from the didone", async () => {
    expect(seedFrom(measure(await fontFrom(DIDONE))).base).toBe("Didone");
  });

  it("starts a one-width face from the typewriter", async () => {
    expect(seedFrom(measure(await fontFrom(TYPEWRITER))).base).toBe("Typewriter");
  });

  it("carries the proportions across, whatever the two fonts call an em", async () => {
    const source = { ...SANS, metrics: { ...SANS.metrics, unitsPerEm: 2048, xHeight: 1100, capHeight: 1450, ascender: 1600, descender: -500 } };
    const seeded = seedFrom(measure(await fontFrom(source)));
    const em = seeded.style.metrics.unitsPerEm;
    // A ratio in, the same ratio out.
    expect(seeded.style.metrics.xHeight / em).toBeCloseTo(1100 / 2048, 1);
    expect(seeded.style.metrics.capHeight / em).toBeCloseTo(1450 / 2048, 1);
  });

  it("draws every letter, from every base it might land on", async () => {
    for (const base of BASES) {
      const seeded = seedFrom(measure(await fontFrom(base)), "Seeded");
      for (const letter of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        const drawn = drawLetter(letter, seeded.style, "");
        expect(drawn, `${base.name} -> ${seeded.base}: ${letter}`).not.toBeNull();
        expect(drawn!.contours.length, `${base.name} -> ${seeded.base}: ${letter}`).toBeGreaterThan(0);
      }
    }
  }, 120_000);

  it("does not seed a font that the checks then complain about", async () => {
    for (const base of [SANS, SERIF, DIDONE, GEOMETRIC]) {
      const seeded = seedFrom(measure(await fontFrom(base)), "Seeded");
      const forge = { ...startFrom(seeded.style), style: seeded.style };
      expect(troubles(forge).map((trouble) => trouble.what), base.name).toEqual([]);
    }
  }, 60_000);

  it("says what it took and what it could not", async () => {
    const seeded = seedFrom(measure(await fontFrom(SANS)));
    expect(seeded.notes.length).toBeGreaterThan(2);
    expect(seeded.notes.join(" ")).toContain("Pen width");
  });

  it("never asks for a sidebearing that reaches backwards", async () => {
    // A joining face measures negative. The drawn letters do not join, so a
    // negative sidebearing there would only run them into each other.
    const seeded = seedFrom({
      ...measure(await fontFrom(SANS)),
      sidebearing: -40,
      joining: true,
    });
    expect(seeded.style.metrics.sidebearing).toBeGreaterThanOrEqual(0);
    expect(seeded.notes.join(" ")).toContain("joins its letters up");
  });
});

describe("borrowing a font's rhythm", () => {
  const LETTERS = "HnoxAVTLmi".split("");

  it("reads the white each letter is given, as a share of the em", async () => {
    const typeface = await fontFrom(SANS);
    const borrowed = borrowFrom(typeface, LETTERS);
    expect(borrowed.found).toBe(LETTERS.length);
    const H = borrowed.bearings.get("H")!;
    // The drawn font spaces everything the same, so this is its sidebearing
    // over its em, whatever those two numbers happen to be.
    expect(H.left).toBeCloseTo(SANS.metrics.sidebearing / SANS.metrics.unitsPerEm, 2);
  });

  it("scales into the target's units rather than the source's", async () => {
    const wide = { ...SANS, metrics: { ...SANS.metrics, unitsPerEm: 2048, sidebearing: 200 } };
    const borrowed = borrowFrom(await fontFrom(wide), LETTERS);
    const H = borrowed.bearings.get("H")!;
    expect(H.left * 1000).toBeCloseTo((200 / 2048) * 1000, 0);
  });

  it("hands back the difference from what the drawings already have", async () => {
    const borrowed = borrowFrom(await fontFrom(SANS), LETTERS);
    const own = new Map([["H", { left: 10, right: 10 }]]);
    const [adjustment] = adjustmentsFor(borrowed, 1000, own);
    expect(adjustment.character).toBe("H");
    const wanted = borrowed.bearings.get("H")!.left * 1000;
    expect(adjustment.left).toBe(Math.round(wanted - 10));
  });

  it("ignores a letter the other font does not have", async () => {
    /*
     * Something the font really has not got.
     *
     * This asked for a `Ж`, which was a letter no font this application drew
     * had -- until it drew Cyrillic, and then the test was asserting that a
     * letter the font has is a letter the font has not, and failed. A CJK
     * character is a safer example: nothing here is ever going to draw one.
     */
    const borrowed = borrowFrom(await fontFrom(SANS), ["H", "\u6f22"]);
    expect(borrowed.found).toBe(1);
    expect(borrowed.asked).toBe(2);
    expect(borrowed.bearings.has("\u6f22")).toBe(false);
  });

  it("gives a space its advance even though it has no ink", async () => {
    const borrowed = borrowFrom(await fontFrom(SANS), [" "]);
    const space = borrowed.bearings.get(" ");
    expect(space).toBeDefined();
    expect(space!.advance).toBeGreaterThan(0);
  });

  it("rounds the kerning into whole units of the target", async () => {
    const borrowed = borrowFrom(await fontFrom(SANS), LETTERS);
    for (const value of kernsIn(borrowed, 1000).values()) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).not.toBe(0);
    }
  });
});

describe("the catalogue", () => {
  const fonts: LibraryFont[] = [
    { id: "roboto", family: "Roboto", category: "sans-serif", weights: [400], styles: ["normal"], variable: false },
    { id: "roboto-slab", family: "Roboto Slab", category: "serif", weights: [400], styles: ["normal"], variable: false },
    { id: "lora", family: "Lora", category: "serif", weights: [400, 700], styles: ["normal"], variable: false },
    { id: "arvo", family: "Arvo", category: "serif", weights: [400], styles: ["normal"], variable: false },
  ];

  it("puts what you typed first, not merely somewhere", () => {
    const found = search(fonts, "roboto");
    expect(found[0].family).toBe("Roboto");
    expect(found[1].family).toBe("Roboto Slab");
  });

  it("finds a family by a word from the middle of its name", () => {
    expect(search(fonts, "slab").map((font) => font.family)).toEqual(["Roboto Slab"]);
  });

  it("narrows by kind", () => {
    expect(search(fonts, "", "serif")).toHaveLength(3);
    expect(search(fonts, "", "sans-serif")).toHaveLength(1);
  });

  it("gives everything back when nothing is asked", () => {
    expect(search(fonts, "  ")).toHaveLength(4);
  });

  it("names a family the way the services do", () => {
    expect(idFor("Playfair Display")).toBe("playfair-display");
    expect(idFor("Source Serif 4")).toBe("source-serif-4");
    expect(idFor("Inter")).toBe("inter");
  });

  it("asks for a weight the family actually publishes", () => {
    const lora = fonts[2];
    expect(nearestWeight(lora, 400)).toBe(400);
    expect(nearestWeight(lora, 500)).toBe(400);
    expect(nearestWeight(lora, 900)).toBe(700);
    expect(nearestWeight({ ...lora, weights: [] }, 400)).toBe(400);
  });
});
