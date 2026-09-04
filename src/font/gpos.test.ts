/**
 * Reading kerning out of GPOS, and writing it back.
 *
 * The two halves are tested together because the only thing that makes either
 * of them worth having is that they agree: a font read in and written out
 * should kern the way it did before. The tables here are built by the writer
 * and read by the reader, which on its own would prove nothing at all -- two
 * halves of one misunderstanding agree perfectly -- so the integration suite
 * hands the same tables to fontTools and to HarfBuzz, which have no stake in
 * this application being right.
 *
 * What is checked here is the behaviour that has a rule behind it: which
 * subtable a pair is answered by, and what happens when two of them speak
 * about the same pair.
 */

import { describe, expect, it } from "vitest";

import { buildGposTable } from "./kern";
import { kernBetween, readGposKerning, toKernClasses, writtenPairs } from "./gpos";

/** Build a GPOS table and read it straight back. */
function through(
  pairs: Array<{ left: number; right: number; value: number; group?: number }>,
  classes: Array<{ left: number[]; right: number[]; value: number; group?: number }> = [],
) {
  const table = buildGposTable(pairs, classes);
  expect(table).not.toBeNull();
  return readGposKerning(table!);
}

describe("a grid of classes", () => {
  it("keeps every pair a class stands for", () => {
    const kerning = through([], [{ left: [10, 11], right: [20, 21], value: -40 }]);
    for (const left of [10, 11]) {
      for (const right of [20, 21]) {
        expect(kernBetween(kerning, left, right), `${left},${right}`).toBe(-40);
      }
    }
  });

  it("says nothing about a pair no class covers", () => {
    const kerning = through([], [{ left: [10], right: [20], value: -40 }]);
    expect(kernBetween(kerning, 10, 99)).toBe(0);
    expect(kernBetween(kerning, 99, 20)).toBe(0);
  });

  /*
   * The bug this whole thing exists for.
   *
   * A subtable claims every glyph its coverage names, and once a lookup has
   * matched a glyph it is finished with it. Written one subtable per class,
   * an A kerned against a V and also against a T kept the first and silently
   * lost the second -- and that is every letter in a real font, since none of
   * them kern against only one thing.
   */
  it("keeps a second class about the same left glyph", () => {
    const kerning = through(
      [],
      [
        { left: [10], right: [20], value: -150 },
        { left: [10], right: [21], value: -90 },
        { left: [10], right: [22, 23], value: -40 },
      ],
    );
    expect(kernBetween(kerning, 10, 20)).toBe(-150);
    expect(kernBetween(kerning, 10, 21)).toBe(-90);
    expect(kernBetween(kerning, 10, 22)).toBe(-40);
    expect(kernBetween(kerning, 10, 23)).toBe(-40);
  });

  it("keeps a second class about the same right glyph", () => {
    const kerning = through(
      [],
      [
        { left: [10], right: [20], value: -150 },
        { left: [11], right: [20], value: -90 },
      ],
    );
    expect(kernBetween(kerning, 10, 20)).toBe(-150);
    expect(kernBetween(kerning, 11, 20)).toBe(-90);
  });

  it("holds a grid of many classes against many", () => {
    const classes: Array<{ left: number[]; right: number[]; value: number }> = [];
    for (let first = 0; first < 12; first++) {
      for (let second = 0; second < 12; second++) {
        classes.push({
          left: [100 + first],
          right: [200 + second],
          value: -(first * 12 + second + 1),
        });
      }
    }
    const kerning = through([], classes);
    for (let first = 0; first < 12; first++) {
      for (let second = 0; second < 12; second++) {
        expect(kernBetween(kerning, 100 + first, 200 + second), `${first},${second}`).toBe(
          -(first * 12 + second + 1),
        );
      }
    }
  });
});

describe("what answers a pair first", () => {
  it("lets a pair written on its own override the class it falls into", () => {
    const kerning = through(
      [{ left: 10, right: 20, value: -5 }],
      [{ left: [10, 11], right: [20], value: -100 }],
    );
    expect(kernBetween(kerning, 10, 20)).toBe(-5);
    // And the class still answers for everything the pair says nothing about.
    expect(kernBetween(kerning, 11, 20)).toBe(-100);
  });

  it("adds up what two lookups each contribute", () => {
    // Two lookups are two adjustments, not two opinions: a feature names all
    // of them and every one is applied.
    const kerning = through(
      [],
      [
        { left: [10], right: [20], value: -50, group: 0 },
        { left: [10], right: [20], value: -30, group: 1 },
      ],
    );
    expect(kerning.lookups).toHaveLength(2);
    expect(kernBetween(kerning, 10, 20)).toBe(-80);
  });

  it("keeps a pair in the lookup it was written in", () => {
    // Moved into the same lookup as the class, the pair would override it
    // instead of adding to it, which is a different font.
    const kerning = through(
      [{ left: 10, right: 20, value: -5, group: 1 }],
      [{ left: [10], right: [20], value: -100, group: 0 }],
    );
    expect(kernBetween(kerning, 10, 20)).toBe(-105);
  });
});

describe("reading a table back out", () => {
  it("gives the classes back with their lookups intact", () => {
    const kerning = through(
      [],
      [
        { left: [10], right: [20], value: -50, group: 0 },
        { left: [11], right: [21], value: -30, group: 1 },
      ],
    );
    const names = (glyph: number) => `g${glyph}`;
    const classes = toKernClasses(kerning, names);
    expect(classes).toHaveLength(2);
    expect(classes.map((klass) => klass.group).sort()).toEqual([0, 1]);
    const first = classes.find((klass) => klass.value === -50)!;
    expect(first.left).toEqual(["g10"]);
    expect(first.right).toEqual(["g20"]);
  });

  it("gives the individual pairs back with theirs", () => {
    const kerning = through([
      { left: 10, right: 20, value: -5, group: 0 },
      { left: 11, right: 21, value: -7, group: 1 },
    ]);
    const written = writtenPairs(kerning);
    expect(written).toHaveLength(2);
    expect(written.find((pair) => pair.value === -7)?.group).toBe(1);
  });

  it("leaves out a glyph it has no name for", () => {
    const kerning = through([], [{ left: [10, 11], right: [20], value: -50 }]);
    const classes = toKernClasses(kerning, (glyph) => (glyph === 11 ? undefined : `g${glyph}`));
    expect(classes[0].left).toEqual(["g10"]);
  });
});

describe("a table that makes no sense", () => {
  it("gives up quietly rather than taking the font down with it", () => {
    expect(readGposKerning(new Uint8Array(0)).lookups).toEqual([]);
    expect(readGposKerning(new Uint8Array(4)).lookups).toEqual([]);
    expect(readGposKerning(new Uint8Array(200)).lookups).toEqual([]);
    // A real header with offsets that point nowhere in particular.
    const nonsense = new Uint8Array(64);
    new DataView(nonsense.buffer).setUint16(0, 1);
    new DataView(nonsense.buffer).setUint16(6, 60_000);
    new DataView(nonsense.buffer).setUint16(8, 60_000);
    expect(() => readGposKerning(nonsense)).not.toThrow();
  });

  it("writes nothing when there is nothing to write", () => {
    expect(buildGposTable([], [])).toBeNull();
    expect(buildGposTable([], [{ left: [], right: [10], value: -5 }])).toBeNull();
  });
});

describe("a table too big for sixteen-bit offsets", () => {
  /*
   * A real font's kerning does not fit in the offsets a lookup list uses, and
   * this is the size at which it stops fitting. Inter's is eighty kilobytes;
   * written without extension lookups the offset to its second lookup came out
   * past what the field holds, and the table pointed into the middle of its
   * own data. fontTools refused to read it and no shaper would have either.
   */
  it("still reads back every pair", () => {
    const pairs: Array<{ left: number; right: number; value: number }> = [];
    for (let left = 1; left <= 400; left++) {
      for (let right = 1; right <= 40; right++) {
        pairs.push({ left, right: 1000 + right, value: -(left % 50) - 1 });
      }
    }
    expect(pairs.length).toBeGreaterThan(15_000);

    const kerning = through(pairs, [{ left: [5000], right: [6000], value: -77 }]);
    for (const pair of [pairs[0], pairs[7_000], pairs[pairs.length - 1]]) {
      expect(kernBetween(kerning, pair.left, pair.right), `${pair.left},${pair.right}`).toBe(
        pair.value,
      );
    }
    // And the class behind them survived the split as well.
    expect(kernBetween(kerning, 5000, 6000)).toBe(-77);
  });

  it("splits the pairs across subtables rather than overflowing one", () => {
    const pairs: Array<{ left: number; right: number; value: number }> = [];
    for (let left = 1; left <= 400; left++) {
      for (let right = 1; right <= 40; right++) {
        pairs.push({ left, right: 1000 + right, value: -1 });
      }
    }
    const kerning = through(pairs);
    expect(kerning.lookups).toHaveLength(1);
    expect(kerning.lookups[0].subtables.length).toBeGreaterThan(1);
  });
});
