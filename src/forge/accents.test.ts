/**
 * The accented letters.
 *
 * Two things are being checked and they are different in kind.
 *
 * That the set is complete: every letter Latin-1 has, drawn, named the way the
 * font world names it, and carrying the codepoint it is meant to. Without that
 * a font drawn here sets English and nothing else, and the way that gap hides
 * is that a specimen line of `Handgloves` looks finished.
 *
 * And that they are built rather than drawn. An `á` has to be the `a` that is
 * already there -- so an edit to the a reaches it, an edit to the acute reaches
 * every letter wearing one, and neither needs a list of which letters those
 * are. That is the promise the rest of this half of the application makes, and
 * accents are exactly where a font usually breaks it: a hundred letters drawn
 * once and then left behind by the next change to the base.
 */

import { describe, expect, it } from "vitest";

import { contoursBounds } from "@/font/geometry";
import { builtFrom, canDraw, drawLetter, letterNames, makeLetter } from "./build";
import { accentedNameFor, codepointOfAccented } from "./accents";
import { editPart, editPen, startFrom, draw } from "./document";
import { codepointFor } from "./typeface";
import { BASES, SANS, type Style } from "./style";

/** Every character Latin-1 puts in the accented range, as its font name. */
const LATIN1 = Array.from({ length: 0x40 }, (_, index) => accentedNameFor(0xc0 + index)!)
  // The two arithmetic signs sitting in the middle of the letters.
  .filter((name) => name !== "multiply" && name !== "divide");

describe("the set is complete", () => {
  it("draws every accented letter Latin-1 has", () => {
    const missing = LATIN1.filter((name) => !canDraw(name));
    expect(missing, `not drawn: ${missing.join(" ")}`).toEqual([]);
  });

  it("draws them on every base, with ink in them", () => {
    for (const base of BASES) {
      for (const name of LATIN1) {
        const drawn = drawLetter(name, base);
        expect(drawn, `${name} did not draw on ${base.name}`).not.toBeNull();
        expect(drawn!.contours.length, `${name} is empty on ${base.name}`).toBeGreaterThan(0);
        expect(drawn!.advanceWidth, `${name} has no width on ${base.name}`).toBeGreaterThan(0);
      }
    }
  });

  it("gives each one the codepoint it is meant to have", () => {
    for (let code = 0xc0; code <= 0xff; code++) {
      const name = accentedNameFor(code)!;
      expect(codepointOfAccented(name), `${name}`).toBe(code);
      if (canDraw(name)) expect(codepointFor(name), `${name}`).toBe(code);
    }
  });

  it("leaves every letter of the alphabet with a character of its own", () => {
    const seen = new Map<number, string>();
    for (const name of letterNames()) {
      const code = codepointFor(name);
      expect(code, `${name} has no codepoint`).not.toBeNull();
      expect(seen.has(code!), `${name} and ${seen.get(code!)} both claim U+${code!.toString(16)}`)
        .toBe(false);
      seen.set(code!, name);
    }
  });

  /*
   * The nine that Unicode gives no parts for.
   *
   * These cannot be built from anything, so if they were ever going to be
   * missed it would be silently: the loop over the decompositions simply would
   * not mention them, and Danish, Norwegian, Icelandic and German would be the
   * languages that quietly did not work.
   */
  it("draws the ones that are not a letter with a mark on it", () => {
    for (const name of ["AE", "ae", "Oslash", "oslash", "Eth", "eth", "Thorn", "thorn", "germandbls"]) {
      expect(canDraw(name), `${name}`).toBe(true);
      expect(builtFrom(name), `${name} should be drawn, not built`).toBeNull();
      expect(drawLetter(name, SANS)!.contours.length).toBeGreaterThan(0);
    }
  });
});

describe("they are built, not drawn again", () => {
  it("puts the base's own ink in the accented letter", () => {
    for (const name of ["aacute", "Ntilde", "odieresis", "Ccedilla"]) {
      const parts = builtFrom(name)!;
      expect(parts).not.toBeNull();
      const base = contoursBounds(drawLetter(parts.base, SANS)!.contours);
      const both = contoursBounds(drawLetter(name, SANS)!.contours);
      // The pair is at least as tall as the letter under it and no shorter than
      // it anywhere: a mark adds, it does not replace.
      expect(both.yMax - both.yMin).toBeGreaterThan(base.yMax - base.yMin);
    }
  });

  it("stands the mark clear of the letter", () => {
    for (const name of ["aacute", "Ntilde", "eacute", "Uacute"]) {
      const parts = builtFrom(name)!;
      const base = makeLetter(parts.base, SANS)!;
      const both = makeLetter(name, SANS)!;
      // The runs of the letter come first and the mark's after, so the mark's
      // own ink can be measured on its own.
      const markRuns = both.runs.slice(base.runs.length);
      expect(markRuns.length, `${name} carries no mark`).toBeGreaterThan(0);
      const mark = contoursBounds(markRuns.flatMap((run) => run.contours));
      const letter = contoursBounds(base.contours);
      expect(mark.yMin, `${name}'s mark sits on the letter`).toBeGreaterThan(letter.yMax);
    }
  });

  it("hangs the cedilla under the letter instead", () => {
    const both = makeLetter("Ccedilla", SANS)!;
    const base = makeLetter("C", SANS)!;
    const mark = contoursBounds(both.runs.slice(base.runs.length).flatMap((run) => run.contours));
    expect(mark.yMax).toBeLessThan(contoursBounds(base.contours).yMin);
  });

  /*
   * The reason for building them at all.
   *
   * Change the letter and every accented form of it follows, without a list
   * anywhere saying which those are. A font that drew its accents separately
   * would pass every test above and fail this one, and it would fail it
   * silently -- the accented letters would simply stop matching the alphabet.
   */
  it("carries an edit to the letter into every accented form of it", () => {
    const before = startFrom(SANS);
    const after = editPart(before, "shoulder", { spring: 0.85 });
    const changed = (name: string) =>
      draw(name, before)!.contours.length !== draw(name, after)!.contours.length ||
      JSON.stringify(draw(name, before)!.contours) !== JSON.stringify(draw(name, after)!.contours);

    expect(changed("u"), "the u itself").toBe(true);
    for (const name of ["ugrave", "uacute", "ucircumflex", "udieresis"]) {
      expect(changed(name), `${name} did not follow the u`).toBe(true);
    }
    expect(changed("odieresis"), "the o has no shoulder and should not have moved").toBe(false);
  });

  it("carries an edit to the pen into the marks as well", () => {
    const before = startFrom(SANS);
    const after = editPen(before, { weight: SANS.pen.weight * 1.4 });
    for (const name of ["acute", "tilde", "aacute", "Ntilde"]) {
      expect(
        JSON.stringify(draw(name, before)!.contours),
        `${name} did not follow the pen`,
      ).not.toBe(JSON.stringify(draw(name, after)!.contours));
    }
  });

  /*
   * An accent over an i replaces the dot rather than stacking on it.
   *
   * Unicode's decomposition names the dotted letter, so left alone this builds
   * `í` as an `i` with an acute over its dot -- two marks on one letter, which
   * is not what `í` is and is obvious the moment anybody looks.
   */
  it("takes the dot off an i before putting an accent over it", () => {
    expect(builtFrom("iacute")?.base).toBe("dotlessi");
    const dotted = contoursBounds(drawLetter("i", SANS)!.contours);
    const accented = contoursBounds(drawLetter("iacute", SANS)!.contours);
    // One mark above the stem, not a dot and a mark: the accented letter is
    // taller than the dotted one but not by the whole height of an accent.
    expect(accented.yMax).toBeGreaterThan(dotted.yMax);
    expect(drawLetter("iacute", SANS)!.contours.length).toBe(
      drawLetter("dotlessi", SANS)!.contours.length + 1,
    );
  });
});

describe("what an accented letter is allowed", () => {
  /*
   * Height, which is the measurement that goes wrong quietly.
   *
   * An accented letter stands above the ascender -- that is where the accent
   * is -- so the check every other letter gets does not apply and the mistake
   * has nothing to catch it. Sized off its spine rather than its ink, the
   * accent on a capital stood at half again the cap height and nobody would
   * have noticed until a line of type sat on the one above it.
   */
  it("never stands more than a third again over the capitals", () => {
    for (const base of BASES) {
      for (const name of LATIN1) {
        const drawn = drawLetter(name, base);
        if (!drawn) continue;
        const { yMax } = contoursBounds(drawn.contours);
        expect(
          yMax,
          `${name} on ${base.name} reaches ${yMax.toFixed(0)}`,
        ).toBeLessThanOrEqual(base.metrics.capHeight * 1.4 + base.pen.weight);
      }
    }
  });

  it("keeps its white on both sides, however wide the mark is", () => {
    for (const base of BASES) {
      for (const name of LATIN1) {
        const drawn = drawLetter(name, base);
        if (!drawn) continue;
        const bounds = contoursBounds(drawn.contours);
        expect(bounds.xMin, `${name} on ${base.name} runs off the left`).toBeGreaterThan(0);
        expect(
          drawn.advanceWidth - bounds.xMax,
          `${name} on ${base.name} runs off the right`,
        ).toBeGreaterThan(0);
      }
    }
  });

  /*
   * A narrow letter is the one that has to move, and only a narrow letter.
   *
   * An acute is wider than the stem of an I, so `Í` has to be given room the
   * `I` never needed; an `O` is wider than any accent, so `Ó` must be spaced
   * exactly as `O` is or a word with one accent in it limps.
   */
  it("spaces an accented letter like the letter, unless the mark is wider", () => {
    const wide: Array<[string, string]> = [
      ["Oacute", "O"],
      ["odieresis", "o"],
      ["ntilde", "n"],
    ];
    for (const [accented, plain] of wide) {
      expect(drawLetter(accented, SANS)!.advanceWidth, accented).toBeCloseTo(
        drawLetter(plain, SANS)!.advanceWidth,
        6,
      );
    }
    expect(drawLetter("Iacute", SANS)!.advanceWidth).toBeGreaterThan(
      drawLetter("I", SANS)!.advanceWidth,
    );
  });
});

describe("a slanted face", () => {
  /*
   * Nothing anywhere says that accents lean.
   *
   * The mark is centred on the letter's ink and stood on top of it, and a
   * leaning letter's ink has already leaned -- so the accent follows by
   * measurement rather than by a rule, which is the only version of this that
   * cannot be forgotten when something else changes.
   */
  it("leans the accent with the letter", () => {
    const upright: Style = SANS;
    const leaning: Style = { ...SANS, metrics: { ...SANS.metrics, slant: 14 } };

    const markAndFoot = (style: Style, name: string) => {
      const base = makeLetter(builtFrom(name)!.base, style)!;
      const both = makeLetter(name, style)!;
      const mark = contoursBounds(
        both.runs.slice(base.runs.length).flatMap((run) => run.contours),
      );
      const letter = contoursBounds(both.contours);
      return { mark: (mark.xMin + mark.xMax) / 2, foot: letter.xMin };
    };

    /*
     * The accent has to be further along the leaning letter than the upright
     * one, measured from the letter's own left edge: a face that leans carries
     * the top of every letter to the right, and the accent belongs over the
     * top rather than over the foot.
     */
    const still = markAndFoot(upright, "eacute");
    const leant = markAndFoot(leaning, "eacute");
    expect(leant.mark - leant.foot).toBeGreaterThan(still.mark - still.foot);
  });
});
