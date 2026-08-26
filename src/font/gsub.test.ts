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

import { buildGsubTable, type ChainRule } from "./gsub";

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
    expect(buildGsubTable([])).toBeNull();
  });

  /*
   * A rule with an empty position matches nothing and a rule with no swaps
   * changes nothing, and both are cheap to produce by accident -- a face with
   * no letters in one of the two sets makes exactly that shape. Written out,
   * they are a feature the shaper spends time on to no effect.
   */
  it("drops a rule that cannot do anything", () => {
    expect(buildGsubTable([{ input: [[], [1]], swaps: [{ at: 0, swap: [swap(1, 2)] }] }])).toBeNull();
    expect(buildGsubTable([{ input: [[1]], swaps: [] }])).toBeNull();
    expect(buildGsubTable([{ input: [[1]], swaps: [{ at: 0, swap: [] }] }])).toBeNull();
  });

  /*
   * A record pointing past the end of its own sequence is a lookup the shaper
   * is asked to apply to a glyph that is not in the match. The specification
   * calls it undefined; in practice it is a font that crashes something.
   */
  it("drops a rule that changes a position it never matched", () => {
    expect(buildGsubTable([{ input: [[1]], swaps: [{ at: 3, swap: [swap(1, 2)] }] }])).toBeNull();
  });
});

describe("the shape of the table", () => {
  const table = buildGsubTable([JOIN])!;

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
    const two = buildGsubTable([JOIN, JOIN])!;
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
    const table = buildGsubTable([
      {
        input: [[100, 101, 102, 103], letters],
        swaps: [
          { at: 0, swap: [100, 101, 102, 103].map((one) => swap(one, one + 200)) },
          { at: 1, swap: letters.map((one, index) => swap(one, alternates[index])) },
        ],
      },
    ])!;
    expect(table.length).toBeLessThan(400);
  });
});
