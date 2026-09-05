/**
 * Damaged fonts, which is the input this application was built to take.
 *
 * `SECURITY.md` says it plainly: Typeforge parses untrusted binary files, the
 * whole point is that you point it at a font somebody else made, and a parser
 * is where the interesting bugs live -- a length field that is trusted, an
 * offset that runs off the end of a table, a loop whose bound comes from the
 * file. It then said the realistic damage is a hung tab or a crash.
 *
 * None of that was tested. `readSfnt` had no test at all, `importFont` had no
 * test at all, and the only font binary in the repository was a valid one. So
 * the claim that a bad file is survivable was a claim, and this is the file
 * that checks it.
 *
 * What the fuzzing below found, when it was first run:
 *
 *   - No hang. Nothing took longer than three seconds, on any input.
 *   - No unbounded allocation. The largest output from a 48KB input was 221
 *     glyphs and 24,453 nodes, which is the size of the font it was made from.
 *   - No bad geometry. Not one coordinate arrived as NaN or Infinity.
 *   - And a hundred and twelve failures out of a hundred and fifty-two whose
 *     message named nothing: "Offset is outside the bounds of the DataView",
 *     "Cannot read properties of undefined (reading 'compression')", "Invalid
 *     array length". Seventy-four per cent.
 *
 * The last one is the fault this file exists to hold shut, because it is the
 * one somebody meets. `store.loadFont` puts `error.message` in the status line
 * and nothing else, so a download that stopped early -- the commonest damage
 * there is -- read as the application breaking rather than the file being
 * short. `damaged.ts` has the fix and the argument for it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { FontFileError } from "./damaged";
import { importFont } from "./parse";
import { readSfnt } from "./sfnt";

const SAMPLE = new Uint8Array(readFileSync("src/assets/typeforge-sample.ttf"));

/**
 * The messages that used to come out, and must not come out again.
 *
 * Matched as text on purpose. These are not this application's sentences and
 * never were: they fall out of a `DataView`, out of a property read on
 * `undefined`, out of an array allocated with a length from the file. Any one
 * of them appearing in the status line means something reached a person that
 * was never written for one.
 */
const NOT_FOR_A_PERSON = [
  "outside the bounds of the DataView",
  "Cannot read properties of undefined",
  "Cannot read property",
  "Invalid array length",
  "is not a function",
  "undefined is not an object",
];

function saysSomethingUseful(message: string): boolean {
  return !NOT_FOR_A_PERSON.some((leak) => message.includes(leak));
}

/** A seeded generator, so any failure below can be reproduced from its number. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * The sample with a few bytes changed.
 *
 * Half the changes land in the first 512 bytes and half anywhere, because that
 * is where the numbers that drive every loop are: the table count, the table
 * offsets, the table lengths. A byte changed in the middle of a glyph outline
 * makes a strange letter; a byte changed in the directory makes a reader walk
 * off the end, and that is the one worth aiming at.
 */
function mutated(seed: number): Uint8Array {
  const random = rng(seed);
  const copy = SAMPLE.slice();
  const changes = 1 + Math.floor(random() * 12);
  for (let i = 0; i < changes; i++) {
    const at = random() < 0.5 ? Math.floor(random() * 512) : Math.floor(random() * copy.length);
    copy[at] = Math.floor(random() * 256);
  }
  return copy;
}

describe("the sfnt header, read from a file that may be lying about it", () => {
  it("turns away a file too short to hold a header", () => {
    for (const length of [0, 1, 3, 4, 11]) {
      expect(() => readSfnt(SAMPLE.subarray(0, length)), `${length} bytes`).toThrow(FontFileError);
    }
    expect(() => readSfnt(SAMPLE.subarray(0, 3))).toThrow(/too short/i);
  });

  it("turns away a directory that runs past the end of the file", () => {
    /*
     * The count is two bytes and can say 65,535 whatever the file's size, so
     * the loop that reads the directory is bounded by the file rather than by
     * anything true. Unchecked this walked off the end and threw about a
     * DataView; the sizes are in the message now because "damaged" is not
     * something anybody can check and "lists 65535 tables in 48524 bytes" is.
     */
    const lying = SAMPLE.slice();
    new DataView(lying.buffer).setUint16(4, 0xffff);
    expect(() => readSfnt(lying)).toThrow(FontFileError);
    expect(() => readSfnt(lying)).toThrow(/65535 tables/);
  });

  it("says which kind of file a collection is, rather than refusing it flatly", () => {
    const collection = SAMPLE.slice();
    new DataView(collection.buffer).setUint32(0, 0x74746366);
    expect(() => readSfnt(collection)).toThrow(/TrueType Collection/);
  });

  it("turns away a version tag that is not one", () => {
    const wrong = SAMPLE.slice();
    new DataView(wrong.buffer).setUint32(0, 0xdeadbeef);
    expect(() => readSfnt(wrong)).toThrow(FontFileError);
  });

  it("still reads the font it was given", () => {
    const sfnt = readSfnt(SAMPLE);
    expect(sfnt.tables.has("head")).toBe(true);
    expect(sfnt.tables.size).toBeGreaterThan(4);
  });
});

describe("a font that stops early", () => {
  /*
   * The commonest damage there is, and the one that used to read worst. Every
   * one of these produced "Offset is outside the bounds of the DataView" --
   * every length except zero, which was caught by the format check and got the
   * only decent sentence in the set.
   */
  const lengths = [0, 4, 12, 13, 50, 100, 500, 2_000, 10_000, 20_000, 40_000, SAMPLE.length - 1];

  /*
   * Not every truncation is fatal, and the last one in that list is the reason
   * this test asks what it asks. Cutting a single byte off the end still
   * imports, because `readSfnt` clamps a table whose length overruns the file
   * rather than refusing it -- shipping fonts overstate the last table and the
   * trailing bytes are padding. That is deliberate and it is right.
   *
   * So the rule is not "a short file is refused". It is that a short file is
   * either read or refused in words, and never refused in somebody else's.
   */

  /** Whatever the import threw, or null if it somehow succeeded. */
  async function refusalFor(bytes: Uint8Array): Promise<unknown> {
    try {
      await importFont(bytes, "Cut.ttf");
      return null;
    } catch (error) {
      return error;
    }
  }

  it.each(lengths)("says something a person can act on when cut to %i bytes", async (length) => {
    const refused = await refusalFor(SAMPLE.slice(0, length));
    if (refused === null) return; // Read it anyway, which is a fine answer.
    expect(refused, `${length} bytes`).toBeInstanceOf(FontFileError);
    const { message } = refused as FontFileError;
    expect(saysSomethingUseful(message), `at ${length} bytes: ${message}`).toBe(true);
  });

  it("does refuse the lengths that cannot be a font at all", async () => {
    // The check above tolerates a truncation being readable, so this says that
    // some of them are not -- otherwise a parser that accepted anything would
    // pass it.
    for (const length of [0, 4, 12, 13, 50]) {
      expect(await refusalFor(SAMPLE.slice(0, length)), `${length} bytes`).toBeInstanceOf(
        FontFileError,
      );
    }
  });

  it("keeps the original fault, for whoever has to diagnose it", async () => {
    /*
     * Wrapped rather than swallowed, and kept out of the message rather than
     * bracketed onto the end of it. What a person reads is a sentence. What a
     * bug report needs is the thing that actually threw, and it is one
     * property away.
     */
    const refused = (await refusalFor(SAMPLE.slice(0, 20_000))) as FontFileError;
    expect(refused.message).toContain("Cut.ttf");
    expect(refused.cause).toBeInstanceOf(Error);
    expect((refused.cause as Error).message).toContain("DataView");
  });
});

describe("fonts with bytes changed in them", () => {
  /*
   * Four hundred seeded mutations, which take about six seconds. Seeded so a
   * failure names a number that reproduces it, rather than a shape of input
   * nobody can get back.
   *
   * The assertions are the four things `SECURITY.md` cares about, and they are
   * deliberately about behaviour rather than about which mutation does what: a
   * change here that makes a hundred more of them import is not a regression,
   * and a change that makes one of them hang is.
   */
  const SEEDS = 400;

  it("never hangs, never leaks an internal fault, and never invents a coordinate", async () => {
    const hangs: string[] = [];
    const leaked: string[] = [];
    const notErrors: string[] = [];
    const nonsense: string[] = [];
    const oversized: string[] = [];
    let imported = 0;

    for (let seed = 1; seed <= SEEDS; seed++) {
      const started = Date.now();
      try {
        const { typeface } = await importFont(mutated(seed), `seed-${seed}.ttf`);
        imported += 1;

        let nodes = 0;
        for (const glyph of typeface.glyphs) {
          if (!Number.isFinite(glyph.advanceWidth)) {
            nonsense.push(`seed ${seed}: ${glyph.name} has advanceWidth ${glyph.advanceWidth}`);
          }
          for (const contour of glyph.contours) {
            for (const node of contour.nodes) {
              nodes += 1;
              if (!Number.isFinite(node.point.x) || !Number.isFinite(node.point.y)) {
                nonsense.push(
                  `seed ${seed}: ${glyph.name} has a node at ${node.point.x},${node.point.y}`,
                );
              }
            }
          }
        }
        /*
         * And no size explosion. A count read from the file could ask for
         * millions of anything; the font this was made from has 221 glyphs and
         * 24,453 nodes, so ten times that is far past anything a mutation of
         * it should produce and far short of a number that would matter.
         */
        if (typeface.glyphs.length > 5_000 || nodes > 250_000) {
          oversized.push(`seed ${seed}: ${typeface.glyphs.length} glyphs, ${nodes} nodes`);
        }
      } catch (error) {
        if (!(error instanceof Error)) {
          notErrors.push(`seed ${seed}: threw a ${typeof error}`);
          continue;
        }
        // Every refusal is one this application meant, which is what makes the
        // message below worth trusting.
        if (!(error instanceof FontFileError)) {
          leaked.push(`seed ${seed}: ${error.constructor.name}: ${error.message}`);
        } else if (!saysSomethingUseful(error.message)) {
          leaked.push(`seed ${seed}: ${error.message}`);
        }
      }

      const took = Date.now() - started;
      if (took > 5_000) hangs.push(`seed ${seed}: ${took}ms`);
    }

    expect(hangs, "a damaged font should fail quickly, not sit there").toEqual([]);
    expect(notErrors, "a throw has to be an Error for the status line to read").toEqual([]);
    expect(leaked, "the status line shows error.message and nothing else").toEqual([]);
    expect(nonsense, "a coordinate read from a damaged file must still be a number").toEqual([]);
    expect(oversized, "a small file must not turn into a huge document").toEqual([]);

    /*
     * And most of them still import, which is the other half of the point. A
     * parser that answered "damaged" to everything would pass every assertion
     * above and be useless: real fonts are full of small wrongness, and this
     * one reads them. The number is a floor rather than the figure measured --
     * 248 of 400 when this was written -- so that making the reader more
     * forgiving is not a test failure.
     */
    expect(imported).toBeGreaterThan(SEEDS / 2);
  }, 120_000);
});
