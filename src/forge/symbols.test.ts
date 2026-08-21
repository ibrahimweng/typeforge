/**
 * The symbols: the rest of what a font needs.
 *
 * Draw could draw every letter and every figure and none of the marks between
 * them -- no ampersand, no at sign, no brackets, no currency, no arithmetic.
 * That is the half of a character set nobody notices until they set a line of
 * real text in the font they just made.
 *
 * What is checked here is not that a bracket looks like a bracket; only an eye
 * says that, and the sheet of them is what it says it to. It is that the
 * symbols are part of the same font: that there is one of them for every
 * character the application offers a box for, that they answer to the names the
 * rest of the world uses, and that the ones drawn out of a letter really are
 * that letter rather than a second drawing of it that will drift.
 */

import { describe, expect, it } from "vitest";

import { SLOTS } from "@/assemble/slots";
import { contoursBounds } from "@/font/geometry";
import { canDraw, decidedBy, drawLetter, letterBehind, letterNames } from "./build";
import { chooseForm, draw, editPart, formOf, startFrom } from "./document";
import { BASES, SANS } from "./style";
import { codepointsFor } from "./typeface";

/** Which drawn glyph answers to a character, by the codepoints it carries. */
const BY_CHARACTER = new Map<string, string>();
for (const name of letterNames()) {
  for (const codepoint of codepointsFor(name)) {
    const character = String.fromCodePoint(codepoint);
    if (!BY_CHARACTER.has(character)) BY_CHARACTER.set(character, name);
  }
}

describe("the character set is complete", () => {
  /*
   * The claim the whole task was about, said against the one place in this
   * application that lists what a font needs.
   *
   * Assemble opens on a box for every character, so that list is already
   * written down and already maintained. Checking against it rather than
   * against a copy means the day somebody adds a box, this says so.
   */
  it("draws every character the application offers a box for", () => {
    const missing = SLOTS.filter((slot) => !BY_CHARACTER.has(slot.character));
    expect(missing.map((slot) => slot.character).join(" ")).toBe("");
  });

  /*
   * And calls them what the other half calls them.
   *
   * A project can be drawn in one half and assembled in the other, and both
   * write a font file. Two names for one character is two glyphs in that file
   * -- or one glyph that a shaper looking for the other cannot find.
   */
  it("gives a character the same name in both halves", () => {
    const wrong: string[] = [];
    for (const slot of SLOTS) {
      const drawn = BY_CHARACTER.get(slot.character);
      if (drawn && drawn !== slot.name) wrong.push(`${slot.character}: draw ${drawn}, assemble ${slot.name}`);
    }
    expect(wrong.join("; ")).toBe("");
  });

  it("draws the symbols from every base", () => {
    const symbols = SLOTS.filter((slot) => slot.group === "Symbols");
    expect(symbols.length).toBeGreaterThan(30);
    for (const style of BASES) {
      for (const slot of symbols) {
        const drawn = drawLetter(BY_CHARACTER.get(slot.character)!, style);
        expect(drawn, `${slot.character} did not draw on ${style.name}`).not.toBeNull();
        expect(drawn!.contours.length, `${slot.character} is empty on ${style.name}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("the symbols drawn out of a letter", () => {
  it("says which letter is behind each of them", () => {
    expect(letterBehind("cent")).toBe("c");
    expect(letterBehind("dollar")).toBe("S");
    expect(letterBehind("yen")).toBe("Y");
    expect(letterBehind("mu")).toBe("u");
    expect(letterBehind("ordfeminine")).toBe("a");
    expect(letterBehind("ordmasculine")).toBe("o");
    expect(letterBehind("twosuperior")).toBe("two");
    expect(letterBehind("questiondown")).toBe("question");
    // And nothing for the ones that are their own drawing.
    expect(letterBehind("ampersand")).toBeNull();
    expect(letterBehind("n")).toBeNull();
  });

  /*
   * The reason for borrowing rather than drawing again.
   *
   * An edit to the u has to reach the mu, exactly as it reaches the ú, or the
   * font has two u's in it and one of them is a copy somebody forgot about.
   */
  it("carries an edit from the letter into the symbol", () => {
    const before = startFrom(SANS);
    const after = editPart(before, "shoulder", { spring: 0.85 });
    const shapeOf = (name: string, forge: typeof before): string =>
      JSON.stringify(draw(name, forge)?.contours ?? null);

    expect(shapeOf("u", after), "the u did not follow the shoulder").not.toBe(shapeOf("u", before));
    expect(shapeOf("mu", after), "the mu did not follow the u").not.toBe(shapeOf("mu", before));
    // And a symbol with no arch behind it is left alone.
    expect(shapeOf("dollar", after)).toBe(shapeOf("dollar", before));
  });

  /*
   * Which letterform is a decision about the letter, not about the symbol.
   *
   * Choosing the two-storey a and finding a single-storey ordinal beside it
   * would be the same letter drawn twice in one font -- which is the fault the
   * accented letters already avoid by reading their base's answer.
   */
  it("draws the ordinal in the same a the font is using", () => {
    const before = startFrom(SANS);
    const after = chooseForm(before, "ordfeminine", "double");
    // The choice lands on the a, wherever it was asked.
    expect(after.alternates.a).toBe("double");
    expect(formOf(after, "ordfeminine")).toBe("double");
    expect(formOf(after, "a")).toBe("double");

    const shapeOf = (name: string, forge: typeof before): string =>
      JSON.stringify(draw(name, forge)?.contours ?? null);
    expect(shapeOf("ordfeminine", after)).not.toBe(shapeOf("ordfeminine", before));
    expect(shapeOf("a", after)).not.toBe(shapeOf("a", before));
  });

  it("puts every symbol's decisions on some letter or on itself", () => {
    for (const name of letterNames()) {
      const owner = decidedBy(name);
      expect(canDraw(owner), `${name} is decided by ${owner}, which is not drawn`).toBe(true);
    }
  });
});

describe("where the symbols sit", () => {
  const bounds = (name: string, style = SANS) =>
    contoursBounds(drawLetter(name, style)!.contours);

  /*
   * A plus, an equals, a multiply and a division sign that do not share a line
   * do not read as arithmetic. They are built on one height for that reason, so
   * this is the check that the one height is really one.
   */
  it("builds the arithmetic on one line", () => {
    const middles = ["plus", "equal", "multiply", "divide", "hyphen"].map((name) => {
      const box = bounds(name);
      return (box.yMin + box.yMax) / 2;
    });
    for (const middle of middles) {
      expect(Math.abs(middle - middles[0])).toBeLessThan(SANS.metrics.unitsPerEm * 0.02);
    }
  });

  /** A bracket, a brace and a bar are one family and have to be one height. */
  it("gives the upright marks one height", () => {
    const uprights = ["bar", "brokenbar", "bracketleft", "bracketright", "braceleft", "braceright"];
    for (const name of uprights) {
      const box = bounds(name);
      expect(Math.abs(box.yMax - bounds("bar").yMax), `${name} is a different height`).toBeLessThan(2);
      expect(Math.abs(box.yMin - bounds("bar").yMin), `${name} sits differently`).toBeLessThan(2);
    }
  });

  /*
   * The Spanish opening marks hang from the x-height rather than standing on
   * the baseline, which is the whole of what turning them over is for.
   */
  it("hangs the opening marks under the x-height", () => {
    for (const [turned, upright] of [
      ["exclamdown", "exclam"],
      ["questiondown", "question"],
    ]) {
      const over = bounds(turned);
      const under = bounds(upright);
      expect(over.yMax, `${turned} does not reach the x-height`).toBeGreaterThan(
        SANS.metrics.xHeight * 0.9,
      );
      expect(over.yMax, `${turned} stands as tall as ${upright}`).toBeLessThan(under.yMax * 0.85);
      expect(over.yMin, `${turned} does not drop below the line`).toBeLessThan(0);
    }
  });

  /** A superior figure hangs from the cap line, well clear of the x-height. */
  it("hangs the superior figures and the ordinals from the cap line", () => {
    for (const name of ["onesuperior", "twosuperior", "threesuperior", "ordfeminine", "ordmasculine"]) {
      const box = bounds(name);
      expect(box.yMax, `${name} is not at the cap line`).toBeGreaterThan(SANS.metrics.capHeight * 0.9);
      expect(box.yMin, `${name} hangs too low`).toBeGreaterThan(SANS.metrics.xHeight * 0.4);
    }
  });

  /*
   * A fraction is wider than a figure and shorter than nothing: both halves
   * have to be inside it, which is what catches a numerator drawn through the
   * stroke it was meant to stand beside.
   */
  it("sets a fraction wider than the figures it is made of", () => {
    for (const name of ["onequarter", "onehalf", "threequarters"]) {
      const fraction = drawLetter(name, SANS)!;
      const figure = drawLetter("one", SANS)!;
      expect(fraction.advanceWidth, `${name} is no wider than a figure`).toBeGreaterThan(
        figure.advanceWidth * 1.3,
      );
      const box = bounds(name);
      expect(box.yMax).toBeGreaterThan(SANS.metrics.capHeight * 0.9);
      expect(box.yMin).toBeLessThan(SANS.metrics.xHeight * 0.3);
    }
  });
});
