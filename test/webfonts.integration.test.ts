/**
 * WOFF and WOFF2 import.
 *
 * These are the formats a font arrives in when it comes off a website, so they
 * are worth accepting. Both are containers around the same sfnt tables, and
 * WOFF2 needs a WebAssembly decoder that has to be initialised before use.
 */

import { describe, expect, it } from "vitest";

import { detectFormat, importFont } from "../src/font/parse";
import { FONT_SUITE_TIMEOUT, loadWebFontFixtures } from "./fixtures";

const fixtures = loadWebFontFixtures();
const suite = fixtures ? describe : describe.skip;

describe("detectFormat", () => {
  it("identifies formats from the leading bytes, not the file name", () => {
    expect(detectFormat(new Uint8Array([0x77, 0x4f, 0x46, 0x46]))).toBe("woff");
    expect(detectFormat(new Uint8Array([0x77, 0x4f, 0x46, 0x32]))).toBe("woff2");
    expect(detectFormat(new Uint8Array([0x4f, 0x54, 0x54, 0x4f]))).toBe("opentype");
    expect(detectFormat(new Uint8Array([0x00, 0x01, 0x00, 0x00]))).toBe("truetype");
    expect(detectFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe("unknown");
  });

  it("treats a file too short to identify as unknown", () => {
    expect(detectFormat(new Uint8Array([0x00, 0x01]))).toBe("unknown");
  });
});

suite("web font import", { timeout: FONT_SUITE_TIMEOUT }, () => {
  it("reads a WOFF file", async () => {
    const { typeface } = await importFont(fixtures!.woff, "DejaVuSans.woff");
    expect(typeface.glyphs.length).toBeGreaterThan(1000);
    expect(typeface.meta.familyName).toBe("DejaVu Sans");
    const capitalA = typeface.glyphs.find((glyph) => glyph.unicodes.includes(65));
    expect(capitalA?.contours.length).toBeGreaterThan(0);
  });

  it("reads a WOFF2 file, which needs its WebAssembly decoder", async () => {
    const { typeface } = await importFont(fixtures!.woff2, "DejaVuSans.woff2");
    expect(typeface.glyphs.length).toBeGreaterThan(1000);
    expect(typeface.meta.familyName).toBe("DejaVu Sans");
    const capitalA = typeface.glyphs.find((glyph) => glyph.unicodes.includes(65));
    expect(capitalA?.contours.length).toBeGreaterThan(0);
  });

  it("refuses a file that is not a font, with a message naming what it takes", async () => {
    await expect(
      importFont(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "archive.zip"),
    ).rejects.toThrow(/TrueType/);
  });
});
