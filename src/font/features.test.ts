/**
 * What makes a substitution rule mean what it says.
 *
 * Every failure here writes a perfectly valid font file. A ligature onto one of
 * its own parts, a set that swaps a letter for itself, a rule left pointing at
 * a letter somebody deleted -- all of them compile, all of them open, and each
 * one is a face that does something other than what was drawn.
 */

import { describe, expect, it } from "vitest";

import {
  addLigature,
  addToSet,
  canJoin,
  ligatureFor,
  ligatureName,
  removeFromSet,
  removeLigature,
  unreachableGlyphs,
} from "./features";
import { addGlyph, removeGlyph, renameGlyph } from "./library";
import { emptyTypeface, type Typeface } from "./types";

/** A font with the letters a ligature test needs, and nothing else. */
function lettered(names = ["f", "i", "l", "f_i", "f_f_i", "a", "a.ss01"]): Typeface {
  const typeface = emptyTypeface();
  for (const name of names) addGlyph(typeface, name);
  /*
   * A single letter answers to a character; anything with a dot or an
   * underscore in it does not, which is what makes it an alternate or a
   * ligature and is exactly the shape of the problem: those are the glyphs
   * nothing can reach until a rule says so.
   */
  for (const glyph of typeface.glyphs) {
    if (/^[a-z]$/.test(glyph.name)) glyph.unicodes = [glyph.name.charCodeAt(0)];
  }
  return typeface;
}

describe("naming a ligature", () => {
  it("joins the parts with underscores, which is what a font tool reads", () => {
    // `fi` would also be a perfectly good name for a single glyph, and a font
    // with both has two glyphs whose names say the same thing.
    expect(ligatureName(["f", "i"])).toBe("f_i");
    expect(ligatureName(["f", "f", "i"])).toBe("f_f_i");
  });
});

describe("making a ligature", () => {
  it("joins two letters the font has", () => {
    const typeface = lettered();
    expect(canJoin(typeface, ["f", "i"])).toBe(true);
    expect(addLigature(typeface, ["f", "i"], "f_i")).toBe(true);
    expect(typeface.ligatures).toEqual([{ components: ["f", "i"], ligature: "f_i" }]);
  });

  it("refuses a ligature of one letter, which is a set", () => {
    const typeface = lettered();
    expect(canJoin(typeface, ["f"])).toBe(false);
    expect(addLigature(typeface, ["f"], "f_i")).toBe(false);
  });

  it("refuses letters the font has not got", () => {
    const typeface = lettered();
    expect(addLigature(typeface, ["f", "j"], "f_i")).toBe(false);
    expect(addLigature(typeface, ["f", "i"], "f_j")).toBe(false);
  });

  /*
   * The one that writes a valid file and a broken face. `f i` becoming `f` is
   * a font where every `fi` in a line loses its `i` -- and nothing about the
   * bytes is wrong.
   */
  it("refuses a ligature onto one of its own parts", () => {
    const typeface = lettered();
    expect(addLigature(typeface, ["f", "i"], "f")).toBe(false);
    expect(addLigature(typeface, ["f", "i"], "i")).toBe(false);
    expect(typeface.ligatures ?? []).toHaveLength(0);
  });

  it("refuses a second rule for letters that already have one", () => {
    const typeface = lettered();
    expect(addLigature(typeface, ["f", "i"], "f_i")).toBe(true);
    expect(addLigature(typeface, ["f", "i"], "f_f_i")).toBe(false);
    expect(typeface.ligatures).toHaveLength(1);
  });

  it("finds and takes out a ligature by the letters it joins", () => {
    const typeface = lettered();
    addLigature(typeface, ["f", "i"], "f_i");
    addLigature(typeface, ["f", "f", "i"], "f_f_i");
    expect(ligatureFor(typeface, ["f", "i"])?.ligature).toBe("f_i");
    // The longer run is not the shorter one, even though it starts the same.
    expect(ligatureFor(typeface, ["f", "f"])).toBeUndefined();

    expect(removeLigature(typeface, ["f", "i"])).toBe(true);
    expect(typeface.ligatures?.map((one) => one.ligature)).toEqual(["f_f_i"]);
    expect(removeLigature(typeface, ["f", "i"])).toBe(false);
  });
});

describe("a stylistic set", () => {
  it("makes the set on the first swap and adds to it after", () => {
    const typeface = lettered(["a", "a.ss01", "g", "g.ss01"]);
    expect(addToSet(typeface, "ss01", "Single-storey", "a", "a.ss01")).toBe(true);
    expect(addToSet(typeface, "ss01", "Single-storey", "g", "g.ss01")).toBe(true);
    expect(typeface.sets).toHaveLength(1);
    expect(typeface.sets![0].swaps).toHaveLength(2);
  });

  it("refuses a swap of a letter for itself, which fires and changes nothing", () => {
    const typeface = lettered();
    expect(addToSet(typeface, "ss01", "Set", "a", "a")).toBe(false);
    expect(typeface.sets ?? []).toHaveLength(0);
  });

  it("refuses a second swap for a letter the set already covers", () => {
    const typeface = lettered();
    expect(addToSet(typeface, "ss01", "Set", "a", "a.ss01")).toBe(true);
    expect(addToSet(typeface, "ss01", "Set", "a", "f_i")).toBe(false);
  });

  it("refuses a tag the format cannot store", () => {
    const typeface = lettered();
    // Five characters is not four, and a tag is exactly four bytes.
    expect(addToSet(typeface, "ss001", "Set", "a", "a.ss01")).toBe(false);
    expect(addToSet(typeface, "", "Set", "a", "a.ss01")).toBe(false);
  });

  it("takes the set away with its last swap", () => {
    const typeface = lettered();
    addToSet(typeface, "ss01", "Set", "a", "a.ss01");
    expect(removeFromSet(typeface, "ss01", "a")).toBe(true);
    expect(typeface.sets).toHaveLength(0);
    expect(removeFromSet(typeface, "ss01", "a")).toBe(false);
  });
});

describe("a rule and the letters it names", () => {
  /*
   * The seventh and eighth places a glyph's name is written. A rename that
   * reaches the first six leaves a rule pointing at a letter that is not there
   * -- a font that still exports, with a ligature that selects nothing.
   */
  it("follows a rename into the ligature and into the set", () => {
    const typeface = lettered();
    addLigature(typeface, ["f", "i"], "f_i");
    addToSet(typeface, "ss01", "Set", "a", "a.ss01");

    expect(renameGlyph(typeface, "i", "i.new")).toBe(true);
    expect(typeface.ligatures![0].components).toEqual(["f", "i.new"]);

    expect(renameGlyph(typeface, "f_i", "fi.joined")).toBe(true);
    expect(typeface.ligatures![0].ligature).toBe("fi.joined");

    expect(renameGlyph(typeface, "a.ss01", "a.alt")).toBe(true);
    expect(typeface.sets![0].swaps[0].alternate).toBe("a.alt");
  });

  /*
   * A ligature goes whole. Trimming the missing letter out of `f i` leaves `f`
   * becoming `fi`, which is a font that draws a ligature for every `f` in it.
   */
  it("drops a whole ligature when any letter in it goes", () => {
    const typeface = lettered();
    addLigature(typeface, ["f", "i"], "f_i");
    addLigature(typeface, ["f", "f", "i"], "f_f_i");

    expect(removeGlyph(typeface, "i")).toBe(true);
    expect(typeface.ligatures).toHaveLength(0);
  });

  it("drops a ligature whose drawing goes, and keeps the others", () => {
    const typeface = lettered();
    addLigature(typeface, ["f", "i"], "f_i");
    addLigature(typeface, ["f", "f", "i"], "f_f_i");

    expect(removeGlyph(typeface, "f_i")).toBe(true);
    expect(typeface.ligatures?.map((one) => one.ligature)).toEqual(["f_f_i"]);
  });

  /*
   * A set is different: its swaps are independent, so it loses the one and
   * keeps the rest. Taking `a.ss01` out says nothing about `g.ss01`.
   */
  it("takes one swap out of a set and leaves the others standing", () => {
    const typeface = lettered(["a", "a.ss01", "g", "g.ss01"]);
    addToSet(typeface, "ss01", "Set", "a", "a.ss01");
    addToSet(typeface, "ss01", "Set", "g", "g.ss01");

    expect(removeGlyph(typeface, "a.ss01")).toBe(true);
    expect(typeface.sets![0].swaps.map((one) => one.plain)).toEqual(["g"]);

    // And the set itself goes when nothing is left in it.
    expect(removeGlyph(typeface, "g.ss01")).toBe(true);
    expect(typeface.sets).toHaveLength(0);
  });
});

describe("the letters nothing can reach", () => {
  /*
   * The state drawing `f_i` and stopping leaves you in: a glyph in the file
   * that no character maps to and no rule selects, so a reader can never see
   * it. Nothing said so.
   */
  it("names a drawing that no character and no rule arrives at", () => {
    const typeface = lettered();
    expect(unreachableGlyphs(typeface).sort()).toEqual(["a.ss01", "f_f_i", "f_i"]);

    addLigature(typeface, ["f", "i"], "f_i");
    expect(unreachableGlyphs(typeface)).not.toContain("f_i");

    addToSet(typeface, "ss01", "Set", "a", "a.ss01");
    expect(unreachableGlyphs(typeface)).toEqual(["f_f_i"]);
  });

  /*
   * The false positive this check had on every real font. An imported font
   * brings its own GSUB -- DejaVu's Arabic positional forms among it -- which
   * this document does not model and the exporter hands back untouched, so its
   * glyphs are reached through tables nothing here can see. Counting them
   * reported two hundred and sixty-five dead letters in a font that is fine.
   */
  it("asks only about what was drawn here, on a font that came from a file", () => {
    const typeface = lettered();
    typeface.source = {
      bytes: new Uint8Array(),
      sfntVersion: 0x00010000,
      tables: new Map(),
      isCFF: false,
      fileName: "Imported.ttf",
    };
    for (const glyph of typeface.glyphs) glyph.dirty = false;
    expect(unreachableGlyphs(typeface)).toEqual([]);

    // What somebody draws here is this document's business, and is reported.
    typeface.glyphs[typeface.glyphIndex.get("f_i")!].dirty = true;
    expect(unreachableGlyphs(typeface)).toEqual(["f_i"]);
  });

  it("leaves the names that are never a mistake alone", () => {
    // The two the old Macintosh tables required at ids 1 and 2, which plenty of
    // shipped fonts still carry and no rule ever reaches.
    const typeface = lettered([".notdef", ".null", "nonmarkingreturn", "f"]);
    expect(unreachableGlyphs(typeface)).toEqual([]);
  });

  it("counts a letter you can type, and `.notdef`, as reached", () => {
    const typeface = lettered(["f", "i"]);
    addGlyph(typeface, ".notdef");
    expect(unreachableGlyphs(typeface)).toEqual([]);
  });

  /*
   * A letter used to build another is reached through that one. Reporting
   * `acute` as dead because nothing types it would be reporting the composite
   * system itself.
   */
  it("counts a letter another is built from as reached", () => {
    const typeface = lettered(["a", "acute", "aacute"]);
    const built = typeface.glyphs[typeface.glyphIndex.get("aacute")!];
    built.unicodes = [0xe1];
    const placed = (glyphName: string, dx: number, dy: number) => ({
      glyphName,
      transform: { a: 1, b: 0, c: 0, d: 1, dx, dy },
    });
    built.components = [placed("a", 0, 0), placed("acute", 100, 400)];
    expect(unreachableGlyphs(typeface)).toEqual([]);
  });
});
