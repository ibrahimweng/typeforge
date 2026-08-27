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
    "narrows a word-boundary alternate only on the side that lost its stroke",
    async () => {
      const bytes = await exported(SCRIPT.name);
      const report = inspectFont(bytes);
      const widths = report.advanceWidths ?? {};
      const left = report.sidebearings ?? {};
      const right = report.rightEdges ?? {};
      const lowercase = (name: string) => /^[a-z]\./.test(name);

      const begun = Object.keys(widths).filter((n) => n.endsWith(".begin"));
      for (const name of begun) {
        const letter = name.split(".")[0];
        expect([name, widths[name] < widths[letter]]).toEqual([name, true]);
        expect([name, widths[name] - right[name]]).toEqual([
          name,
          widths[letter] - right[letter],
        ]);
      }

      const ended = Object.keys(widths).filter((n) => n.endsWith(".end") && lowercase(n));
      for (const name of ended) {
        const letter = name.split(".")[0];
        expect([name, widths[name] < widths[letter]]).toEqual([name, true]);
        expect([name, left[name]]).toEqual([name, left[letter]]);
      }

      // Every lowercase letter has both, and only lowercase begins a word --
      // nothing ever joins *into* a capital.
      expect(begun).toHaveLength(26);
      expect(ended).toHaveLength(26);
    },
    FONT_SUITE_TIMEOUT,
  );

  /*
   * A capital is the exception, and it is the join layer's own doing: a
   * capital only ever hands on, so taking its exit away leaves it with no
   * join at all, and it falls back to the plain roman spacing on *both*
   * sides. That is safe for exactly one reason -- nothing joins into a
   * capital, so the edge that moved was never a seam. Some come out wider
   * than the joined drawing, which is what a letter reaching out for a
   * neighbour and then not needing to should look like.
   */
  it(
    "spaces a word-final capital as the plain letter it falls back to",
    async () => {
      const bytes = await exported(SCRIPT.name);
      const report = inspectFont(bytes);
      const widths = report.advanceWidths ?? {};
      const left = report.sidebearings ?? {};

      const right = report.rightEdges ?? {};
      const capitals = Object.keys(widths).filter((n) => /^[A-Z]\.end$/.test(n));
      expect(capitals).toHaveLength(22);

      for (const name of capitals) {
        const letter = name.split(".")[0];
        // The reach is gone, so every one of them stands well clear of its
        // advance where the joined drawing ran up close to it.
        const gap = widths[name] - right[name];
        expect([name, gap > widths[letter] - right[letter]]).toEqual([name, true]);
        // And the left edge, which was never a seam, only ever relaxes.
        expect([name, left[name] >= left[letter]]).toEqual([name, true]);
      }

      // Some come out wider than the drawing that was reaching out, which is
      // the whole tell that these are the un-joined letter and not a trim.
      expect(capitals.filter((n) => widths[n] > widths[n.split(".")[0]])).not.toHaveLength(0);
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
