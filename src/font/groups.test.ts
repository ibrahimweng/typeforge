/**
 * That the piles are the piles a person would make.
 *
 * The value of a grouping is entirely in whether a glyph turns up where
 * somebody went looking for it, so these are mostly assertions about
 * particular characters rather than about the shape of the code.
 */

import { describe, expect, it } from "vitest";

import { groupGlyphs, groupOf } from "./groups";
import type { Glyph } from "./types";

/** A glyph that is nothing but its name and the character it stands for. */
function at(codepoint: number | null, name = `u${codepoint}`): Glyph {
  return {
    name,
    unicodes: codepoint === null ? [] : [codepoint],
    advanceWidth: 500,
    contours: [],
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

const of = (character: string) => groupOf(at(character.codePointAt(0)!));

describe("which pile a glyph goes in", () => {
  it("puts the Latin alphabet where it is looked for", () => {
    expect(of("A")).toBe("Capitals");
    expect(of("Z")).toBe("Capitals");
    expect(of("a")).toBe("Lowercase");
    expect(of("z")).toBe("Lowercase");
    expect(of("0")).toBe("Figures");
    expect(of("9")).toBe("Figures");
  });

  it("tells an accented capital from an accented lowercase", () => {
    /*
     * The case of these cannot be read off a range: `À` to `Þ` is one run in
     * the file and `Ā ā Ă ă` alternates pair by pair for the length of Latin
     * Extended-A. Asking the character is the only thing that is right for all
     * of them.
     */
    expect(of("À")).toBe("Accented capitals");
    expect(of("Ÿ")).toBe("Accented capitals");
    expect(of("Ā")).toBe("Accented capitals");
    expect(of("à")).toBe("Accented lowercase");
    expect(of("ā")).toBe("Accented lowercase");
    expect(of("ÿ")).toBe("Accented lowercase");
  });

  it("keeps the caseless Latin out of both accented piles", () => {
    // The German sharp s has an uppercase now, but the letter itself is
    // lowercase; the eszett's capital is a separate codepoint.
    expect(of("ß")).toBe("Accented lowercase");
  });

  it("files a dash with the punctuation it is compared against", () => {
    expect(of("-")).toBe("Punctuation");
    expect(of("–")).toBe("Punctuation");
    expect(of("—")).toBe("Punctuation");
    expect(of("’")).toBe("Punctuation");
  });

  it("names the scripts", () => {
    expect(of("Α")).toBe("Greek");
    expect(of("ω")).toBe("Greek");
    expect(of("Ж")).toBe("Cyrillic");
    expect(of("א")).toBe("Hebrew");
  });

  it("takes a combining mark for a mark rather than for a letter", () => {
    // U+0301 reports a case through toUpperCase in some engines, so it has to
    // be claimed before the accented tests run.
    expect(groupOf(at(0x301))).toBe("Marks");
  });

  it("files a glyph no character maps to under its own name", () => {
    expect(groupOf(at(null, ".notdef"))).toBe("Unencoded");
    expect(groupOf(at(null, "f_f_i"))).toBe("Unencoded");
  });

  it("has somewhere for a codepoint nothing claimed", () => {
    // A Yi syllable: real, in some fonts, and not worth a group of its own.
    expect(groupOf(at(0xa000))).toBe("Everything else");
  });
});

describe("the piles of a whole font", () => {
  const font = [
    at(0x41, "A"),
    at(0x42, "B"),
    at(0x61, "a"),
    at(0x30, "zero"),
    at(0x391, "Alpha"),
    at(null, ".notdef"),
  ];

  it("loses nothing and duplicates nothing", () => {
    const groups = groupGlyphs(font);
    const names = groups.flatMap((group) => group.glyphs.map((glyph) => glyph.name));
    expect(names.sort()).toEqual([".notdef", "A", "B", "Alpha", "a", "zero"].sort());
  });

  it("reads in the order somebody works", () => {
    expect(groupGlyphs(font).map((group) => group.name)).toEqual([
      "Capitals",
      "Lowercase",
      "Figures",
      "Greek",
      "Unencoded",
    ]);
  });

  it("shows no group the font has nothing in", () => {
    /*
     * A heading reading "Cyrillic 0" is a line of furniture about something
     * that is not there. It matters most on a filtered list, which is the case
     * where the counts mean anything: search for `o` and an empty-group
     * grouping would be most of the page.
     */
    const groups = groupGlyphs([at(0x41, "A")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({ name: "Capitals", glyphs: [at(0x41, "A")] });
  });

  it("keeps each pile in the order it was given", () => {
    // The grid hands them over already sorted, and re-sorting here would throw
    // that away without saying so.
    const groups = groupGlyphs([at(0x5a, "Z"), at(0x41, "A")]);
    expect(groups[0].glyphs.map((glyph) => glyph.name)).toEqual(["Z", "A"]);
  });

  it("holds an empty font without inventing anything", () => {
    expect(groupGlyphs([])).toEqual([]);
  });
});
