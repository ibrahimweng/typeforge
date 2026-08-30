/**
 * That a character written the way people write one is read the way they meant.
 *
 * `U+0041` is how a font's documentation writes a codepoint and how somebody
 * looking one up will have it on the clipboard. Bare hex is taken too. Decimal
 * is not, and that is the decision worth a test: `41` is ambiguous between the
 * two, and guessing wrong puts a letter on a different character entirely --
 * hex 41 is `A`, decimal 41 is `)`.
 */

import { describe, expect, it } from "vitest";

import { parseCodepoints } from "./LetterPanel";

describe("reading a character", () => {
  it("takes the form a font's documentation uses", () => {
    expect(parseCodepoints("U+0041")).toEqual([0x41]);
    expect(parseCodepoints("u+0041")).toEqual([0x41]);
  });

  it("takes the character itself, which is what people type", () => {
    /*
     * The decision this rests on. Bare hex was accepted at first and had to
     * go, because `A` is valid hex: a person typing `A` into a field labelled
     * Character means the letter A, and read as hex it is U+000A, a line feed.
     * That is a letter put on a different character entirely, silently, by the
     * one input most likely to be typed.
     */
    expect(parseCodepoints("A")).toEqual([0x41]);
    expect(parseCodepoints("a")).toEqual([0x61]);
    expect(parseCodepoints("é")).toEqual([0xe9]);
  });

  it("takes several, in either form, however they are separated", () => {
    expect(parseCodepoints("U+0041 U+0042")).toEqual([0x41, 0x42]);
    expect(parseCodepoints("U+0041, U+0042")).toEqual([0x41, 0x42]);
    expect(parseCodepoints("A B")).toEqual([0x41, 0x42]);
    expect(parseCodepoints("U+0041 B")).toEqual([0x41, 0x42]);
  });

  it("reads an empty field as answering to nothing, which is allowed", () => {
    // An unencoded glyph is a real thing: every `.alt` and `.sc` in a font is
    // one, reached through a feature rather than by being typed.
    expect(parseCodepoints("")).toEqual([]);
    expect(parseCodepoints("   ")).toEqual([]);
  });

  it("refuses what it cannot read rather than guessing", () => {
    expect(parseCodepoints("U+00GG")).toBeNull();
    expect(parseCodepoints("U+0041 nonsense")).toBeNull();
    // Two digits are two characters, not a hex number: `41` would have been
    // U+0041 under the old reading and is refused under this one.
    expect(parseCodepoints("41")).toBeNull();
    // Past the end of Unicode.
    expect(parseCodepoints("U+110000")).toBeNull();
  });

  it("reaches the astral planes, where the emoji live", () => {
    expect(parseCodepoints("U+1F600")).toEqual([0x1f600]);
    // Counted in code points rather than in units, so one written as a
    // surrogate pair is the one character it looks like.
    expect(parseCodepoints("😀")).toEqual([0x1f600]);
  });
});
