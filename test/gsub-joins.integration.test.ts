/**
 * The contextual joins, checked by the two things that decide.
 *
 * A joined script is the first thing this application draws where the right
 * shape depends on a *pair* of letters: a written `o`, `v`, `w` and `b` hand
 * over at the waist where every other letter hands over at the baseline. The
 * font carries a second drawing of each letter and a GSUB rule that swaps them
 * in, and there are three separate ways for that to be wrong -- the drawings
 * missing, the table malformed, or the table well-formed and saying something
 * other than what was meant.
 *
 * So the exported file is handed to fontTools, which is what the industry reads
 * fonts with, and to HarfBuzz, which is what lays out text with them. Neither
 * has any stake in this being right, and between them they answer all three.
 */

import { describe, expect, it } from "vitest";

import { deliver } from "../src/forge/deliver";
import { startFrom } from "../src/forge/document";
import { BASES } from "../src/forge/style";
import { FONT_SUITE_TIMEOUT } from "./fixtures";
import { hasFontTools, hasHarfbuzz, inspectFont, shapeWords } from "./fonttools";

const canRun = hasFontTools() && hasHarfbuzz();
const suite = canRun ? describe : describe.skip;

const SCRIPT = BASES.find((one) => one.name === "Handwriting")!;
const PLAIN = BASES.find((one) => one.name === "Sans")!;

/** The drawing a word-edge alternate is swapped in for: its name less the last suffix. */
const standsFor = (name: string): string => name.slice(0, name.lastIndexOf("."));

/** Letters whose lead-out is the end of their own last stroke: see `Recipe.leaves`. */
const WRITTEN_OUT = new Set(["r"]);

/** Draw a face and hand back the file, as a download would. */
async function exported(name: string): Promise<Uint8Array> {
  const base = BASES.find((one) => one.name === name)!;
  const made = await deliver(startFrom(base), {
    familyName: name.replace(/\s+/g, ""),
    format: "ttf",
  });
  return made.bytes;
}

suite("a joined face carries its joins into the file", () => {
  it(
    "puts a second drawing of every letter in the font, and names them",
    async () => {
      const bytes = await exported(SCRIPT.name);
      const report = inspectFont(bytes);
      expect(report.tables).toContain("GSUB");
      expect(report.recompiles).toBe(true);

      /*
       * Twenty-six letters that can be arrived at high, and four that can be
       * left high. Nothing needs both: a shaper matching a two-glyph sequence
       * carries on from the end of what it matched, so in `ooo` the middle
       * letter is the one that received high and it hands over low to a letter
       * that arrives low.
       */
      const names = report.glyphNames ?? [];
      const arriving = names.filter((one) => one.endsWith(".init"));
      const leaving = names.filter((one) => one.endsWith(".medi"));
      expect(arriving).toHaveLength(26);
      expect(leaving.sort()).toEqual(["b.medi", "o.medi", "v.medi", "w.medi"]);
    },
    FONT_SUITE_TIMEOUT,
  );

  it(
    "swaps both halves of the pair, and only where the pair occurs",
    async () => {
      const bytes = await exported(SCRIPT.name);
      const shaped = shapeWords(bytes, ["oa", "on", "oo", "br", "ve", "no", "an", "minimum"]);

      // Both letters are replaced, never only the second. Swapping only the
      // follower would mean drawing the high hand-over into the `o` itself, and
      // then a renderer that skipped the feature would join every one of these
      // pairs high to low.
      expect(shaped.oa).toEqual(["o.medi", "a.init"]);
      expect(shaped.on).toEqual(["o.medi", "n.init"]);
      expect(shaped.br).toEqual(["b.medi", "r.init"]);
      expect(shaped.ve).toEqual(["v.medi", "e.init"]);

      // `oo` is the case that looks as though it needs a third drawing and does
      // not: the second `o` arrives high and leaves low.
      expect(shaped.oo).toEqual(["o.medi", "o.init"]);

      // And nothing happens where nothing hands over high.
      expect(shaped.no).toEqual(["n", "o"]);
      expect(shaped.an).toEqual(["a", "n"]);
      expect(shaped.minimum).toEqual([..."minimum"]);
    },
    FONT_SUITE_TIMEOUT,
  );

  /*
   * A mid-word alternate is the same letter, not a different one. An advance
   * that moved would put the letter after it somewhere the letter before it
   * did not finish, which is the one thing a joined face cannot survive -- and
   * it would only show on the pairs the feature fires on.
   */
  it(
    "gives every mid-word alternate the advance of the letter it stands in for",
    async () => {
      const bytes = await exported(SCRIPT.name);
      const widths = inspectFont(bytes).advanceWidths ?? {};
      const checked: string[] = [];
      for (const [name, width] of Object.entries(widths)) {
        if (!/\.(init|medi)$/.test(name)) continue;
        const letter = name.split(".")[0];
        expect([name, width]).toEqual([name, widths[letter]]);
        checked.push(name);
      }
      expect(checked).toHaveLength(30);
    },
    FONT_SUITE_TIMEOUT,
  );

  /*
   * The word-boundary alternates are the one place an advance is *meant* to
   * move: the letter is missing a stroke that reached out to a neighbour that
   * is not there, so it is narrower by what the stroke cost. What must not
   * move is the end that is still joining, because that end is a seam -- so
   * each of these is checked from the side it keeps.
   *
   * `.begin` drops the entry, so its distance from the rightmost ink to the
   * advance is the one the base has: the exit still lands where the next
   * letter starts looking for it. `.end` drops the exit, so its sidebearing is
   * the base's: the letter before it still hands over onto the same x.
   *
   * The base being the drawing it is swapped in for, which is not always the
   * plain letter: a hand-over at the waist that ends or begins a word is
   * `n.init.end` or `o.medi.begin`, and it stands in for `n.init` or `o.medi`.
   */
  it(
    "narrows a boundary alternate only on the side that lost its stroke",
    async () => {
      const bytes = await exported(SCRIPT.name);
      const report = inspectFont(bytes);
      const widths = report.advanceWidths ?? {};
      const left = report.sidebearings ?? {};
      const right = report.rightEdges ?? {};

      const begun = Object.keys(widths).filter((n) => n.endsWith(".begin"));
      for (const name of begun) {
        const letter = standsFor(name);
        /*
         * Not the written `r`, which does not only lose its entry at the start
         * of a word: its lead-in lands on a stub at the waist and hangs over the
         * letter before, costing its advance next to nothing, and with no
         * lead-in the up-stroke is a flick of its own off the line into the
         * nub, which the letter is spaced by. Carried down to the line as a
         * stem instead, `ro` read `no`. Its seam end is held below all the same.
         */
        if (!WRITTEN_OUT.has(letter)) {
          expect([name, widths[name] < widths[letter]]).toEqual([name, true]);
        }
        /*
         * To within three units, and the first of those is the reason set out
         * below on the lone letters: this is four numbers that were each
         * rounded to a whole unit on the way into the file, and roundings do
         * not compose. Written exact, it held only while the join's reach
         * happened to land on a whole number of units, and read -21 against
         * -20 the first time the reach moved.
         *
         * The other two are the bounce, and they arrived with the loops being
         * allowed to hang over the letter beside them. A letter is now spaced
         * off its body at the line and not off its loop, so the rightmost ink
         * and the advance are no longer found on the same part of the letter --
         * and a hand that bounces tilts each letter a little, which moves a
         * loop two units against a stem it used to move with. `.begin` does not
         * bounce, because it is not in the middle of a word, so it does not
         * tilt either and the two differ by that much. Turn the irregularity
         * off and this reads 0.00 on the `d` and the `l` alike.
         *
         * What the seam does is unchanged, which is what this is guarding: the
         * lead-out still stops on the advance to the unit, and the pairs still
         * join at nothing on all four faces.
         *
         * Two more on the written `r`. Its joins are hairlines now, and the
         * end of a hairline lead-out stands no further right than the tip of
         * the r's own arm, so the rightmost ink is the arm on one drawing and
         * the lead-out on the other -- and the arm, standing well above the
         * seam, is the part the mid-word tilt moves furthest.
         */
        const slack = WRITTEN_OUT.has(letter) ? 5 : 3;
        expect([
          name,
          Math.abs(widths[name] - right[name] - (widths[letter] - right[letter])) <= slack,
        ]).toEqual([name, true]);
      }

      const ended = Object.keys(widths).filter((n) => n.endsWith(".end"));
      for (const name of ended) {
        const letter = standsFor(name);
        /*
         * Not the written `r` either, whose word-final drawing is the drawn
         * `r`: see the lead-outs below. Mid-word its lead-out is the tight
         * foot of its own stem and its arm hangs out over the letter after,
         * so the `r` that ends a word, with its arm inside its own advance,
         * is the wider of the two.
         */
        if (!WRITTEN_OUT.has(letter.split(".")[0])) {
          expect([name, widths[name] < widths[letter]]).toEqual([name, true]);
        }
        expect([name, left[name]]).toEqual([name, left[letter]]);
      }

      /*
       * A word of one letter gave up both halves, and it gave up exactly what
       * the two half-drawings gave up between them. The arithmetic is exact
       * because all three are spaced by the same join layer, standing in the
       * sidebearing on whichever side has no stroke on it -- which is the
       * point, and was not free: a letter with neither end used to fall
       * through to the plain roman path and be spaced off its own raw ink, and
       * a lone Monoline `f` came out at 809 units against the 460 the same
       * letter takes everywhere else in the face.
       *
       * Checked on the advance and not on the ink, which was the first way
       * this was written and says nothing here: these faces have letters whose
       * ink legitimately hangs outside their advance on either side -- a
       * looped ascender, a crossbar, the tail under that same Monoline `f`,
       * which sits 127 units past its own advance before anything is taken off
       * it. Ink outside the box is what a joined face looks like; the advance
       * is what has to be right.
       *
       * To within a unit, and only because of where it is being read: the
       * engine's own arithmetic is exact, as the unit tests hold it to, and
       * this is four advances that were each rounded to a whole unit on the way
       * into the file. Three roundings do not compose.
       */
      const lone = Object.keys(widths).filter((n) => n.endsWith(".alone"));
      for (const name of lone) {
        const letter = name.split(".")[0];
        /*
         * Not a letter whose lead-out is its own stroke (see the lead-outs
         * below): its word-final drawing is a different letter, the drawn one,
         * and alone it is that letter without its entry -- wider than the
         * written one that begins a word, whose arm hangs over the next letter.
         */
        if (WRITTEN_OUT.has(letter)) {
          expect([name, widths[name] < widths[`${letter}.end`]]).toEqual([name, true]);
          continue;
        }
        expect([name, widths[name] < widths[`${letter}.begin`]]).toEqual([name, true]);
        const want = widths[`${letter}.begin`] + widths[`${letter}.end`] - widths[letter];
        expect([name, Math.abs(widths[name] - want) <= 1]).toEqual([name, true]);
      }

      /*
       * Every lowercase letter has all three; only lowercase begins a word or
       * stands as one, because nothing ever joins *into* a capital. The
       * eighteen capitals that hand on are in the last drawing only, and by
       * the same rule as the lowercase -- there is no second spacing path for
       * them any more. And the hand-overs at the waist again at a word's
       * edge: every lowercase letter arriving high and ending a word, and the
       * four that leave high beginning one.
       */
      expect(begun).toHaveLength(26 + 4);
      expect(ended).toHaveLength(26 + 18 + 26);
      expect(lone).toHaveLength(26);
    },
    FONT_SUITE_TIMEOUT,
  );

  /*
   * The capitals used to be the exception here, and it was the join layer's
   * own doing: a capital only ever hands on, so taking its exit away left it
   * with no join at all, it fell through to the plain roman spacing, and it
   * came out somewhere else -- six of the twenty-two *wider* than the drawing
   * that had been reaching out, and every sidebearing moved.
   *
   * They are on the same rule as the lowercase now, which is what this says.
   * The letter that has been asked to give up a join is still a letter of a
   * joined face and is spaced by the join layer standing in the sidebearing;
   * only a letter that never had one is spaced as the roman letter it is.
   */
  it(
    "takes the same width off every letter that gives up its lead-out",
    async () => {
      const bytes = await exported(SCRIPT.name);
      const report = inspectFont(bytes);
      const widths = report.advanceWidths ?? {};
      const left = report.sidebearings ?? {};
      const right = report.rightEdges ?? {};

      /*
       * Every letter that hands on through a join of its own. A written `r`
       * hands on from the foot of its stem, turned tight into the lead-out as
       * the last of its own stroke rather than a join run out of it, so what
       * it gives up at a word's end is that stroke: it ends as the drawn `r`
       * does, on its own terminal.
       */
      const ended = Object.keys(widths).filter(
        (n) => n.endsWith(".end") && !WRITTEN_OUT.has(n.split(".")[0]),
      );
      const lost = [...new Set(ended.map((n) => widths[standsFor(n)] - widths[n]))];
      // The same width off every one of them, to a unit -- two advances each
      // rounded on the way into the file, so a reach that is not a whole
      // number of units splits the answer between two neighbouring integers.
      expect([lost, Math.max(...lost) - Math.min(...lost) <= 1]).toEqual([lost, true]);
      expect(Math.min(...lost)).toBeGreaterThan(0);

      // Capitals and lowercase alike, and the side that kept its stroke did
      // not move at all. Eighteen capitals: the B D F I O P, and the T and
      // the Y, whose foot going right off a lone stem read `The` as `Lhe`,
      // never hand on.
      expect(ended.filter((n) => /^[A-Z]\./.test(n))).toHaveLength(18);
      for (const name of ended) {
        expect([name, left[name]]).toEqual([name, left[standsFor(name)]]);
      }
      /*
       * The written `r` at a word's end keeps the side it enters by, and ends
       * on its own terminal: mid-word its arm hangs past its advance over the
       * letter after, and at the end of a word nothing comes after, so the
       * arm is held inside the advance there.
       */
      for (const letter of WRITTEN_OUT) {
        expect(right[letter]).toBeGreaterThan(widths[letter]);
        expect(right[`${letter}.end`]).toBeLessThanOrEqual(widths[`${letter}.end`]);
        expect(left[`${letter}.end`]).toBe(left[letter]);
      }
    },
    FONT_SUITE_TIMEOUT,
  );
});

suite("a face whose letters stand apart carries none of it", () => {
  it(
    "writes no GSUB and shapes every word unchanged",
    async () => {
      const bytes = await exported(PLAIN.name);
      expect(inspectFont(bytes).tables).not.toContain("GSUB");
      const shaped = shapeWords(bytes, ["oa", "on", "br"]);
      expect(shaped.oa).toEqual(["o", "a"]);
      expect(shaped.on).toEqual(["o", "n"]);
      expect(shaped.br).toEqual(["b", "r"]);
    },
    FONT_SUITE_TIMEOUT,
  );
});
