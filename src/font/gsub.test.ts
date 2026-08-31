/**
 * What the GSUB writer promises about its own bytes.
 *
 * The claims a table format lets you get wrong quietly. Every one of these is
 * about structure rather than about shape, because a GSUB table that is wrong
 * does not look wrong -- it opens, it recompiles, and it substitutes the wrong
 * glyph or none. The integration test hands the same bytes to fontTools and to
 * HarfBuzz, which is what settles whether they mean anything; this settles that
 * the offsets inside them add up.
 */
import { describe, expect, it } from "vitest";

import { buildGsubTable, readGsubFeatures, type ChainRule, type Ligature } from "./gsub";

const swap = (from: number, to: number) => ({ plain: from, alternate: to });

/** The rule a joined script writes: four letters, then any of six. */
const JOIN: ChainRule = {
  input: [
    [10, 11, 12],
    [20, 21, 22, 23],
  ],
  swaps: [
    { at: 0, swap: [swap(10, 110), swap(11, 111), swap(12, 112)] },
    { at: 1, swap: [swap(20, 120), swap(21, 121), swap(22, 122), swap(23, 123)] },
  ],
};

/** Read a big-endian short, the way every offset in this table is stored. */
const at = (bytes: Uint8Array, index: number): number => (bytes[index] << 8) | bytes[index + 1];

describe("what it writes at all", () => {
  it("says nothing when there is nothing to say", () => {
    expect(buildGsubTable({})).toBeNull();
  });

  /*
   * A rule with an empty position matches nothing and a rule with no swaps
   * changes nothing, and both are cheap to produce by accident -- a face with
   * no letters in one of the two sets makes exactly that shape. Written out,
   * they are a feature the shaper spends time on to no effect.
   */
  it("drops a rule that cannot do anything", () => {
    expect(buildGsubTable({ contextual: [{ input: [[], [1]], swaps: [{ at: 0, swap: [swap(1, 2)] }] }] })).toBeNull();
    expect(buildGsubTable({ contextual: [{ input: [[1]], swaps: [] }] })).toBeNull();
    expect(buildGsubTable({ contextual: [{ input: [[1]], swaps: [{ at: 0, swap: [] }] }] })).toBeNull();
  });

  /*
   * A record pointing past the end of its own sequence is a lookup the shaper
   * is asked to apply to a glyph that is not in the match. The specification
   * calls it undefined; in practice it is a font that crashes something.
   */
  it("drops a rule that changes a position it never matched", () => {
    expect(buildGsubTable({ contextual: [{ input: [[1]], swaps: [{ at: 3, swap: [swap(1, 2)] }] }] })).toBeNull();
  });
});

describe("the shape of the table", () => {
  const table = buildGsubTable({ contextual: [JOIN] })!;

  it("puts the three lists where the header says they are", () => {
    expect(at(table, 0)).toBe(1); // major version
    expect(at(table, 2)).toBe(0); // minor
    const script = at(table, 4);
    const feature = at(table, 6);
    const lookup = at(table, 8);
    expect(script).toBe(10); // straight after the header
    expect(feature).toBeGreaterThan(script);
    expect(lookup).toBeGreaterThan(feature);
    expect(lookup).toBeLessThan(table.length);

    // DFLT at the front of the script list, and calt at the front of the
    // feature list. Both are four bytes of tag before anything else.
    expect(String.fromCharCode(...table.slice(script + 2, script + 6))).toBe("DFLT");
    expect(String.fromCharCode(...table.slice(feature + 2, feature + 6))).toBe("calt");
  });

  /*
   * The one that would be silently wrong. A substitution reached from a chain
   * is invoked by that chain; listed in the feature as well, it would also fire
   * on its own, and every letter in the font would be replaced by its alternate
   * wherever it stood.
   */
  it("names only the chain in the feature, never the substitutions it calls", () => {
    const feature = at(table, 6);
    // featureCount, tag, offset, then the feature table: params, count, list.
    const featureTable = feature + at(table, feature + 6);
    const count = at(table, featureTable + 2);
    const named = Array.from({ length: count }, (_, index) => at(table, featureTable + 4 + index * 2));
    expect(named).toEqual([2]);

    const lookupList = at(table, 8);
    expect(at(table, lookupList)).toBe(3); // two substitutions and one chain
    const kindOf = (index: number): number =>
      at(table, lookupList + at(table, lookupList + 2 + index * 2));
    expect([kindOf(0), kindOf(1), kindOf(2)]).toEqual([1, 1, 6]);
  });

  it("grows a lookup pair for every rule and no more", () => {
    const two = buildGsubTable({ contextual: [JOIN, JOIN] })!;
    const lookupList = at(two, 8);
    expect(at(two, lookupList)).toBe(6);
  });
});

describe("what it costs", () => {
  /*
   * The number the decision to write this at all rests on. A joined face needs
   * one rule over thirty letters, and if that came to kilobytes it would be
   * worth reaching for a smaller format; it does not.
   */
  it("stays inside a few hundred bytes for a whole alphabet", () => {
    const letters = Array.from({ length: 26 }, (_, index) => 100 + index);
    const alternates = letters.map((one) => one + 100);
    const table = buildGsubTable({
      contextual: [
        {
          input: [[100, 101, 102, 103], letters],
          swaps: [
            { at: 0, swap: [100, 101, 102, 103].map((one) => swap(one, one + 200)) },
            { at: 1, swap: letters.map((one, index) => swap(one, alternates[index])) },
          ],
        },
      ],
    })!;
    expect(table.length).toBeLessThan(400);
  });
});

/** `f` `f` `i` and their friends, as glyph ids. */
const F = 10;
const I = 11;
const L = 12;
const FI = 90;
const FF = 91;
const FFI = 92;
const FL = 93;

const liga = (components: number[], ligature: number): Ligature => ({ components, ligature });

describe("a run of glyphs that becomes one", () => {
  it("writes nothing for a ligature with nothing to join", () => {
    // One component is not a ligature -- it is a set, and the format has a
    // cheaper lookup for that.
    expect(buildGsubTable({ ligatures: [liga([F], FI)] })).toBeNull();
    expect(buildGsubTable({ ligatures: [] })).toBeNull();
  });

  it("puts the ligatures in their own feature, tagged liga", () => {
    const table = buildGsubTable({ ligatures: [liga([F, I], FI)] })!;
    const featureList = at(table, 6);
    expect(at(table, featureList)).toBe(1);
    expect(String.fromCharCode(...table.slice(featureList + 2, featureList + 6))).toBe("liga");
  });

  /*
   * The bug this is really about, and it does not look like a bug. A shaper
   * takes the first ligature that matches and carries on from after it, so with
   * `ff` written before `ffi` the `ff` matches, the `i` is left standing, and
   * the font has no `ffi` in it. It opens. It recompiles. fontTools reports
   * both ligatures present. Only shaping the word says otherwise.
   */
  it("writes the longer run first, whatever order it was given in", () => {
    const table = buildGsubTable({
      ligatures: [liga([F, F], FF), liga([F, F, I], FFI)],
    })!;
    const lookupList = at(table, 8);
    // One lookup, of type 4, holding one subtable.
    expect(at(table, lookupList)).toBe(1);
    const lookup = lookupList + at(table, lookupList + 2);
    expect(at(table, lookup)).toBe(4);

    const subtable = lookup + at(table, lookup + 6);
    expect(at(table, subtable)).toBe(1); // substFormat 1
    expect(at(table, subtable + 4)).toBe(1); // one set: both start with f

    const set = subtable + at(table, subtable + 6);
    expect(at(table, set)).toBe(2); // two ligatures in it
    const first = set + at(table, set + 2);
    const second = set + at(table, set + 4);
    // componentCount includes the first glyph, so ffi is 3 and ff is 2.
    expect(at(table, first + 2)).toBe(3);
    expect(at(table, second + 2)).toBe(2);
    expect(at(table, first)).toBe(FFI);
    expect(at(table, second)).toBe(FF);
  });

  it("stores every component but the first, which coverage already found", () => {
    const table = buildGsubTable({ ligatures: [liga([F, F, I], FFI)] })!;
    const lookupList = at(table, 8);
    const lookup = lookupList + at(table, lookupList + 2);
    const subtable = lookup + at(table, lookup + 6);
    const set = subtable + at(table, subtable + 6);
    const record = set + at(table, set + 2);
    expect(at(table, record + 2)).toBe(3);
    // Two shorts follow, not three: the leading f is in the coverage table.
    expect(at(table, record + 4)).toBe(F);
    expect(at(table, record + 6)).toBe(I);

    const cover = subtable + at(table, subtable + 2);
    expect(at(table, cover)).toBe(1); // a plain list
    expect(at(table, cover + 2)).toBe(1);
    expect(at(table, cover + 4)).toBe(F);
  });

  /*
   * A set is found by the index its first glyph has in the coverage table, and
   * coverage is sorted by glyph id. Written in the order the ligatures happened
   * to be given, `fi` made after `li` sends the shaper to the wrong set.
   */
  it("orders the sets by their first glyph, not by when they were made", () => {
    const table = buildGsubTable({
      ligatures: [liga([L, I], FL), liga([F, I], FI)],
    })!;
    const lookupList = at(table, 8);
    const lookup = lookupList + at(table, lookupList + 2);
    const subtable = lookup + at(table, lookup + 6);
    const cover = subtable + at(table, subtable + 2);
    expect([at(table, cover + 4), at(table, cover + 6)]).toEqual([F, L]);

    const forF = subtable + at(table, subtable + 6);
    const forL = subtable + at(table, subtable + 8);
    expect(at(table, forF + at(table, forF + 2))).toBe(FI);
    expect(at(table, forL + at(table, forL + 2))).toBe(FL);
  });
});

describe("more than one feature in a font", () => {
  it("gives each feature its own lookups, and names them all to the language", () => {
    const table = buildGsubTable({
      ligatures: [liga([F, I], FI)],
      contextual: [JOIN],
      sets: [{ tag: "ss01", swaps: [swap(F, FF)] }],
    })!;

    const featureList = at(table, 6);
    expect(at(table, featureList)).toBe(3);
    const tags = [0, 1, 2].map((index) =>
      String.fromCharCode(...table.slice(featureList + 2 + index * 6, featureList + 6 + index * 6)),
    );
    // Sorted alphabetically, which the format requires and nothing enforces.
    expect(tags).toEqual(["calt", "liga", "ss01"]);

    // Every one of them reachable: the language system names all three.
    const scriptList = at(table, 4);
    const script = scriptList + at(table, scriptList + 6);
    const langSys = script + at(table, script);
    expect(at(table, langSys + 4)).toBe(3);
    expect([0, 1, 2].map((index) => at(table, langSys + 6 + index * 2)).sort()).toEqual([0, 1, 2]);
  });

  /*
   * The substitutions a chain reaches are invoked by that chain. Listed in a
   * feature as well, they would also fire on their own -- every letter in the
   * font replaced by its alternate wherever it stood.
   */
  it("keeps the chain's own substitutions out of every feature", () => {
    const table = buildGsubTable({ contextual: [JOIN] })!;
    const featureList = at(table, 6);
    const feature = featureList + at(table, featureList + 6);
    expect(at(table, feature + 2)).toBe(1); // the chain, and not its two singles
    const lookupList = at(table, 8);
    expect(at(table, lookupList)).toBe(3); // which are still in the font
  });

  it("drops a set that swaps a glyph for itself", () => {
    expect(buildGsubTable({ sets: [{ tag: "ss01", swaps: [swap(F, F)] }] })).toBeNull();
  });

  /*
   * A tag is four bytes. A shorter one written as it stands shifts every offset
   * in the table after it, which is a file that opens and is read wrongly.
   */
  it("pads a short tag to four bytes rather than writing a short one", () => {
    const table = buildGsubTable({ sets: [{ tag: "aa", swaps: [swap(F, FI)] }] })!;
    const featureList = at(table, 6);
    expect(String.fromCharCode(...table.slice(featureList + 2, featureList + 6))).toBe("aa  ");
  });
});

describe("reading one back", () => {
  /*
   * The strongest thing a reader can be held to: it agrees with the writer.
   * A font opened here arrived with no features at all, so the panel told a
   * face that plainly draws `fi` that it had none and a rebuild export dropped
   * every one of them.
   */
  it("finds the ligatures that were written, under their own tag", () => {
    const table = buildGsubTable({
      ligatures: [liga([F, I], FI), liga([F, F, I], FFI)],
    })!;
    const read = readGsubFeatures(table);
    expect(read.ligatures.map((one) => ({ ...one }))).toEqual(
      expect.arrayContaining([
        { tag: "liga", components: [F, I], ligature: FI },
        { tag: "liga", components: [F, F, I], ligature: FFI },
      ]),
    );
    expect(read.ligatures).toHaveLength(2);
  });

  it("finds the sets that were written, under their own tag", () => {
    const table = buildGsubTable({
      sets: [
        { tag: "ss01", swaps: [swap(F, FI), swap(I, FF)] },
        { tag: "salt", swaps: [swap(L, FL)] },
      ],
    })!;
    const read = readGsubFeatures(table);
    expect(read.sets.find((one) => one.tag === "ss01")?.swaps).toEqual([
      swap(F, FI),
      swap(I, FF),
    ]);
    expect(read.sets.find((one) => one.tag === "salt")?.swaps).toEqual([swap(L, FL)]);
  });

  /*
   * A lookup no feature reaches is invoked from a chain, and a chain is not
   * something this document can hold. Reported as a set, every letter in a
   * joined script would be listed as a stylistic alternate of itself.
   */
  it("leaves the substitutions a chain reaches alone", () => {
    const read = readGsubFeatures(buildGsubTable({ contextual: [JOIN] })!);
    expect(read.sets).toEqual([]);
    expect(read.ligatures).toEqual([]);
  });

  it("says nothing about bytes that are not a table", () => {
    expect(readGsubFeatures(new Uint8Array())).toEqual({ ligatures: [], sets: [] });
    expect(readGsubFeatures(new Uint8Array(9))).toEqual({ ligatures: [], sets: [] });
    // Offsets pointing past the end read as nothing rather than throwing: this
    // is the one place here that reads a stranger's bytes.
    const nonsense = new Uint8Array(64).fill(0xff);
    expect(() => readGsubFeatures(nonsense)).not.toThrow();
  });
});
