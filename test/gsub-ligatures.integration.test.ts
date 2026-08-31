/**
 * The ligatures, checked by the two things that decide.
 *
 * A ligature is the commonest thing a font does and the writer could not make
 * one: `gsub.ts` wrote a chained context and nothing else, because that is what
 * a joined script needed. So an `f` and an `i` drawn as `fi` sat in the file
 * with nothing to select them.
 *
 * Three separate ways for the new lookup to be wrong, and only the last of them
 * looks like anything: the bytes malformed, the bytes well-formed but meaning
 * something other than what was meant, or both right and the rules never
 * firing. So the table goes into a real font and out to fontTools, which is
 * what the industry reads fonts with, and to HarfBuzz, which is what lays out
 * text with them. Neither has a stake in this being right.
 *
 * The table is spliced into a font off the system rather than built around,
 * because what is under test is the table.
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildGsubTable } from "../src/font/gsub";
import { FONT_SUITE_TIMEOUT } from "./fixtures";
import { glyphOrder, hasFontTools, hasHarfbuzz, shapeWords, withTable } from "./fonttools";

const FONT_PATH = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
].find((one) => existsSync(one));

const canRun = FONT_PATH !== undefined && hasFontTools() && hasHarfbuzz();
const suite = canRun ? describe : describe.skip;

suite("a font that joins its letters up", () => {
  const base = canRun ? new Uint8Array(readFileSync(FONT_PATH!)) : new Uint8Array();
  const order = canRun ? glyphOrder(base) : [];
  const id = (name: string): number => {
    const index = order.indexOf(name);
    if (index < 0) throw new Error(`this font has no ${name}`);
    return index;
  };

  /*
   * DejaVu draws `fi` and does not draw `ff` or `ffi`, so those two stand in as
   * `A` and `B`. What is being asked is which substitution fires, not what it
   * lands on, and a stand-in that is obviously not a ligature makes the answer
   * easier to read.
   */
  const ligatured = (): Uint8Array =>
    withTable(
      base,
      "GSUB",
      buildGsubTable({
        ligatures: [
          { components: [id("f"), id("i")], ligature: id("fi") },
          { components: [id("f"), id("f")], ligature: id("A") },
          { components: [id("f"), id("f"), id("i")], ligature: id("B") },
        ],
        sets: [{ tag: "ss01", swaps: [{ plain: id("a"), alternate: id("A") }] }],
      })!,
    );

  it(
    "draws two letters as one, and only where the two occur",
    () => {
      const shaped = shapeWords(ligatured(), ["fi", "fin", "if", "nfi", "ii", "ff"]);
      expect(shaped.fi).toEqual(["fi"]);
      expect(shaped.fin).toEqual(["fi", "n"]);
      expect(shaped.ff).toEqual(["A"]);
      // The pair the other way round is not the pair.
      expect(shaped.if).toEqual(["i", "f"]);
      expect(shaped.ii).toEqual(["i", "i"]);
      expect(shaped.nfi).toEqual(["n", "fi"]);
    },
    FONT_SUITE_TIMEOUT,
  );

  /*
   * The failure this is really about, and it does not look like a failure. A
   * shaper takes the first ligature that matches for a given first glyph and
   * carries on from after it. With `ff` written before `ffi`, the `ff` matches,
   * the `i` is left standing, and the font has no `ffi` in it -- while opening,
   * recompiling, and reporting both ligatures present. Only a shaper laying out
   * the word says otherwise, which is why this test exists.
   */
  it(
    "takes the longest run, so ffi beats ff followed by i",
    () => {
      const shaped = shapeWords(ligatured(), ["ffi", "office", "affix", "offer"]);
      expect(shaped.ffi).toEqual(["B"]);
      expect(shaped.office).toEqual(["o", "B", "c", "e"]);
      expect(shaped.affix).toEqual(["a", "B", "x"]);
      // And the shorter one still fires where the longer cannot.
      expect(shaped.offer).toEqual(["o", "A", "e", "r"]);
    },
    FONT_SUITE_TIMEOUT,
  );

  /*
   * A set is a choice and a ligature is not. Put in one feature -- which is
   * what this wrote while `calt` was the only feature it knew -- every
   * stylistic alternate becomes mandatory and every ligature becomes something
   * a reader has to ask for.
   */
  it(
    "leaves a stylistic set alone until somebody asks for it",
    () => {
      const font = ligatured();
      expect(shapeWords(font, ["a"]).a).toEqual(["a"]);
      // The ligature beside it is on without being asked.
      expect(shapeWords(font, ["fi"]).fi).toEqual(["fi"]);
    },
    FONT_SUITE_TIMEOUT,
  );
});
