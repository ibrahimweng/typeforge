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
        const letter = name.split(".")[0];
        expect([name, widths[name] < widths[letter]]).toEqual([name, true]);
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
         */
        expect([name, Math.abs((widths[name] - right[name]) - (widths[letter] - right[letter])) <= 3])
          .toEqual([name, true]);
      }

      const ended = Object.keys(widths).filter((n) => n.endsWith(".end"));
      for (const name of ended) {
        const letter = name.split(".")[0];
        expect([name, widths[name] < widths[letter]]).toEqual([name, true]);
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
        const want = widths[`${letter}.begin`] + widths[`${letter}.end`] - widths[letter];
        expect([name, Math.abs(widths[name] - want) <= 1]).toEqual([name, true]);
        expect([name, widths[name] < widths[`${letter}.begin`]]).toEqual([name, true]);
      }

      /*
       * Every lowercase letter has all three; only lowercase begins a word or
       * stands as one, because nothing ever joins *into* a capital. The
       * twenty capitals that hand on are in the last drawing only, and by
       * the same rule as the lowercase -- there is no second spacing path for
       * them any more.
       */
      expect(begun).toHaveLength(26);
      expect(ended).toHaveLength(26 + 20);
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

      const ended = Object.keys(widths).filter((n) => n.endsWith(".end"));
      const lost = [...new Set(ended.map((n) => widths[n.split(".")[0]] - widths[n]))];
      // The same width off every one of them, to a unit -- two advances each
      // rounded on the way into the file, so a reach that is not a whole
      // number of units splits the answer between two neighbouring integers.
      expect([lost, Math.max(...lost) - Math.min(...lost) <= 1]).toEqual([lost, true]);
      expect(Math.min(...lost)).toBeGreaterThan(0);

      // Capitals and lowercase alike, and the side that kept its stroke did
      // not move at all.
      expect(ended.filter((n) => /^[A-Z]\./.test(n))).toHaveLength(20);
      for (const name of ended) {
        expect([name, left[name]]).toEqual([name, left[name.split(".")[0]]]);
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
