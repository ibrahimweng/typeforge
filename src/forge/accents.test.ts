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
import { builtFrom, canDraw, drawLetter, letterNames, makeLetter, reachesOut } from "./build";
import { accentedNameFor, drawnAs, codepointOfAccented } from "./accents";
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
      expect(
        seen.has(code!),
        `${name} and ${seen.get(code!)} both claim U+${code!.toString(16)}`,
      ).toBe(false);
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
    for (const name of [
      "AE",
      "ae",
      "Oslash",
      "oslash",
      "Eth",
      "eth",
      "Thorn",
      "thorn",
      "germandbls",
    ]) {
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
        expect(yMax, `${name} on ${base.name} reaches ${yMax.toFixed(0)}`).toBeLessThanOrEqual(
          base.metrics.capHeight * 1.4 + base.pen.weight,
        );
      }
    }
  });

  /*
   * White on both sides, except where the face spaces with a stroke instead.
   *
   * A joined letter's advance is where its lead-out stops, to the unit, and the
   * letter after it starts there -- so an accent on one may not widen it, and a
   * mark that reaches past the letter under it has to overhang instead. Which
   * is what a written accent does anyway: nobody moves a word along to make
   * room for a grave.
   */
  it("keeps its white on both sides, however wide the mark is", () => {
    for (const base of BASES) {
      for (const name of LATIN1) {
        const drawn = drawLetter(name, base);
        if (!drawn) continue;
        if (reachesOut(name, base)) continue;
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
   * And on a joined face the accented letter keeps the exact advance of the
   * letter under the mark, which is the thing that lets it join at all.
   */
  it("gives an accented letter of a joined face the advance of its own base", () => {
    for (const base of BASES.filter((one) => one.parts.script.on)) {
      for (const [name, under] of [
        ["agrave", "a"],
        ["eacute", "e"],
        ["ntilde", "n"],
        ["ocircumflex", "o"],
      ]) {
        const drawn = drawLetter(name, base);
        if (!drawn) continue;
        expect([base.name, name, drawn.advanceWidth]).toEqual([
          base.name,
          name,
          drawLetter(under, base)!.advanceWidth,
        ]);
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
      const mark = contoursBounds(both.runs.slice(base.runs.length).flatMap((run) => run.contours));
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

/**
 * What the font can actually set.
 *
 * A count of glyphs says nothing -- what somebody wants to know is whether it
 * sets their language, and the answer to that is a sentence of their language
 * with every character in it. So each of these is a pangram or near enough,
 * and the claim is that not one letter of it is missing.
 *
 * They are the languages Latin Extended-A is for, and until it was reached
 * this font set none of them. The list is deliberately not a list of
 * codepoints: a codepoint that draws a blank box passes a codepoint test.
 */
describe("the languages it sets", () => {
  const sentences: Array<[string, string]> = [
    ["Polish", "Zażółć gęślą jaźń ŁÓDŹ Władysław"],
    ["Czech", "Příliš žluťoučký kůň úpěl ďábelské ódy"],
    ["Slovak", "Kŕdeľ ďatľov učí koňa žrať kôru"],
    ["Hungarian", "Árvíztűrő tükörfúrógép ŐSZ ÜDVÖZÖLJÜK"],
    ["Turkish", "Pijamalı hasta yağız şoföre çabucak güvendi İĞÜŞÖÇ"],
    ["Latvian", "Ģērbies ķepuraini šķērsām nūjā ĀĒĪŪŅĻŖ"],
    ["Lithuanian", "Įlinkdama fechtuotojo špaga sublykčiojusi"],
    ["Romanian", "Șoseaua Țăndărei ăîâșț"],
    ["Croatian", "Gojazni đačić s biciklom drži ĐAKOVO"],
    ["Maltese", "Ħobż Ħamrun ħabib ĊĠŻ"],
    ["Welsh", "Ŵy â bŷs Sŵn Ŷd"],
    ["Esperanto", "Eĥoŝanĝo ĉiuĵaŭde ĈĜĤĴŜŬ"],
    ["Māori", "Whakatōhea ā ē ī ō ū"],
    /*
     * And the four that wanted a letter with no decomposition to build it from.
     *
     * French is the one that matters most and was the one most obviously
     * missing: `cœur`, `sœur`, `œuvre`, `bœuf` are ordinary words, and a font
     * that cannot set them cannot set French. Catalan needs the geminated l,
     * Dutch the IJ, and Northern Sámi the eng and the barred t beside the eth
     * it already had.
     */
    ["French", "Le cœur de la sœur ŒUVRE ÇÀÉÈÊËÎÏÔÙÛÜŸ"],
    ["Catalan", "Paraŀlel coŀlegi ĿL àèéíòóúüç"],
    ["Dutch", "Ĳsvogel ĳsbeer ĲSSELMEER"],
    ["Northern Sámi", "Buorre beaivi ÁČĐŊŠŦŽ áčđŋšŧž"],
    /*
     * And the second alphabet, which is a different claim from all of those.
     *
     * Every sentence above is a Latin sentence: the letters were drawn, and
     * what was being tested is that the marks reach them. This one is the whole
     * of Greek, and fourteen of its capitals are Latin capitals pointed at
     * twice while the rest of it -- ten capitals and twenty-four lowercase --
     * is drawn out of the same bowls, arches and diagonals the Latin is.
     */
    ["Greek", "Ξεσκεπάζω την ψυχοφθόρα βδελυγμία ΓΔΘΛΞΠΣΦΨΩ ςϊϋΐΰ"],
    /*
     * And the third alphabet, in the four languages that disagree about it.
     *
     * Russian is the bulk of it. Ukrainian wants a ghe with a tick on it that
     * Unicode keeps two blocks further out, and three letters Russian dropped.
     * Serbian writes six of its own, two of which are a letter tied to a soft
     * sign. Bulgarian shares Russian's alphabet and is here because it uses the
     * two signs and the yery far more than Russian does, and a font that draws
     * them badly is a font Bulgarian reads badly.
     */
    ["Russian", "Съешь же ещё этих мягких французских булок да выпей чаю ЁЙЪЫЬЭЮЯ"],
    ["Ukrainian", "Ґазда їв єнота ІЇЄҐ ґєії"],
    ["Serbian", "Ђаво љуби њиву ћуп џеп ЂЉЊЋЏ"],
    ["Bulgarian", "Жълт щъркел ЪЬЮЯ ъьюя"],
  ];

  for (const [language, sentence] of sentences) {
    it(`sets ${language}`, () => {
      const missing = [...sentence]
        .filter((character) => character !== " ")
        .filter((character) => {
          const code = character.codePointAt(0)!;
          const called = code < 0x80 ? character : (accentedNameFor(code) ?? character);
          // A letter drawn under another letter's name still sets the language:
          // a Greek omicron is an `o` and there is nothing named `ο`.
          const name = canDraw(called) ? called : (drawnAs(character) ?? called);
          if (!canDraw(name)) return true;
          // Drawn is not the same as drawn with something in it: a name that
          // resolves to a recipe returning nothing would pass the line above.
          const drawn = drawLetter(name, SANS);
          return !drawn || drawn.contours.length === 0;
        });
      expect(missing).toEqual([]);
    });
  }

  /**
   * And the whole block, which is a different claim from any sentence.
   *
   * A sentence says the font sets a language. This says there is no character
   * in Latin Extended-A left that draws an empty box -- including the ones
   * nobody types any more, the Greenlandic kra and the long s, because a
   * character that renders as a box is worse than one nobody uses.
   */
  it("leaves nothing in Latin Extended-A undrawn", () => {
    const missing: string[] = [];
    for (let code = 0x0100; code <= 0x017f; code++) {
      const name = accentedNameFor(code);
      const drawn = name ? drawLetter(name, SANS) : null;
      if (!name || !canDraw(name) || !drawn || drawn.contours.length === 0) {
        missing.push(
          `U+${code.toString(16).toUpperCase().padStart(4, "0")} ${String.fromCodePoint(code)}`,
        );
      }
    }
    expect(missing).toEqual([]);
  });
});
