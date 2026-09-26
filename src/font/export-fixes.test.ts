/**
 * The pieces of a preserving export that answer "is this still the same font",
 * checked one at a time on bytes small enough to reason about.
 *
 * The whole-font versions of these, against a real file and read back by
 * fontTools, are in `test/export-preserve.integration.test.ts`. These are here
 * so a mistake in one piece fails with that piece's name on it.
 */

import { describe, expect, it } from "vitest";

import { exportFont } from "./export";
import { buildGlyfTables, carryGvar, renumberComposite, splitGlyf } from "./glyf";
import { buildGposTable } from "./kern";
import { mergeKerning } from "./gpos-merge";
import { readGposKerning, kernBetween } from "./gpos";
import { readSfnt } from "./sfnt";
import {
  buildCmap,
  buildHead,
  fontRevisionOf,
  nameValues,
  patchName,
  readVariationSequences,
} from "./tables";
import { emptyTypeface, type Contour, type Typeface } from "./types";
import { blankGlyph } from "./library";

const square = (x: number, y: number, size: number): Contour => ({
  closed: true,
  nodes: [
    { point: { x, y }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x, y: y + size }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: x + size, y: y + size }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: x + size, y }, handleIn: null, handleOut: null, type: "corner" },
  ],
});

/** Read a format 4 subtable's end codes and the glyph each BMP codepoint maps to. */
function readFormat4(cmap: Uint8Array): { endCodes: number[]; map: Map<number, number> } {
  const view = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
  const at = view.getUint32(8);
  const segCount = view.getUint16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segCount * 2 + 2;
  const deltas = starts + segCount * 2;
  const ranges = deltas + segCount * 2;
  const endCodes: number[] = [];
  const map = new Map<number, number>();
  for (let index = 0; index < segCount; index++) {
    const end = view.getUint16(ends + index * 2);
    const start = view.getUint16(starts + index * 2);
    const delta = view.getUint16(deltas + index * 2);
    const range = view.getUint16(ranges + index * 2);
    endCodes.push(end);
    if (start === 0xffff) continue;
    for (let code = start; code <= end; code++) {
      const glyph =
        range === 0
          ? (code + delta) & 0xffff
          : view.getUint16(ranges + index * 2 + range + (code - start) * 2);
      map.set(code, glyph);
    }
  }
  return { endCodes, map };
}

describe("cmap with a character claimed twice", () => {
  it("keeps the first glyph listed and writes strictly increasing segments", () => {
    const cmap = buildCmap([
      { codepoint: 0x41, glyphId: 1 },
      { codepoint: 0x42, glyphId: 2 },
      { codepoint: 0x41, glyphId: 3 },
      { codepoint: 0x43, glyphId: 4 },
      { codepoint: 0x42, glyphId: 5 },
    ]);
    const { endCodes, map } = readFormat4(cmap);
    for (let index = 1; index < endCodes.length; index++) {
      expect(endCodes[index]).toBeGreaterThan(endCodes[index - 1]);
    }
    expect(map.get(0x41)).toBe(1);
    expect(map.get(0x42)).toBe(2);
    expect(map.get(0x43)).toBe(4);
  });

  it("writes no overlapping format 12 groups", () => {
    const cmap = buildCmap([
      { codepoint: 0x1f600, glyphId: 1 },
      { codepoint: 0x1f601, glyphId: 2 },
      { codepoint: 0x1f600, glyphId: 7 },
    ]);
    const view = new DataView(cmap.buffer);
    expect(view.getUint16(2)).toBe(2);
    const at = view.getUint32(4 + 8 + 4);
    const count = view.getUint32(at + 12);
    const groups: Array<[number, number, number]> = [];
    for (let index = 0; index < count; index++) {
      const group = at + 16 + index * 12;
      groups.push([view.getUint32(group), view.getUint32(group + 4), view.getUint32(group + 8)]);
    }
    for (let index = 1; index < groups.length; index++) {
      expect(groups[index][0]).toBeGreaterThan(groups[index - 1][1]);
    }
    expect(groups[0]).toEqual([0x1f600, 0x1f601, 1]);
  });
});

describe("the revision in head", () => {
  it("reads the number out of a version string however it is written", () => {
    expect(fontRevisionOf("Version 2.001")).toBe(2.001);
    expect(fontRevisionOf("2.37")).toBe(2.37);
    expect(fontRevisionOf("Version 3.000;hotconv 1.0.109")).toBe(3);
    expect(fontRevisionOf("Version 7")).toBe(7);
    expect(fontRevisionOf("no number here")).toBe(1);
  });

  it("reaches the file on a rebuild", async () => {
    const typeface = emptyTypeface();
    typeface.meta.version = "Version 2.001";
    typeface.glyphs = [blankGlyph(".notdef")];
    typeface.glyphIndex = new Map([[".notdef", 0]]);
    const result = await exportFont(typeface, { format: "ttf", fidelity: "rebuild", now: 0 });
    const head = readSfnt(result.bytes).tables.get("head")!;
    const revision = new DataView(head.buffer, head.byteOffset).getInt32(4) / 65536;
    expect(revision).toBeCloseTo(2.001, 4);
    // And the same writer, called with it directly.
    const direct = buildHead({
      unitsPerEm: 1000,
      bounds: { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
      indexToLocFormat: 0,
      fontRevision: fontRevisionOf("Version 2.001"),
      createdAt: 0,
      modifiedAt: 0,
      isItalic: false,
      isBold: false,
    });
    expect(new DataView(direct.buffer).getInt32(4)).toBe(Math.round(2.001 * 65536));
  });
});

describe("a varying export", () => {
  /*
   * Two squares overlapping. Merged they are one contour, so the count read
   * back out of the file says which happened.
   */
  const overlapping = (): Typeface => {
    const typeface = emptyTypeface();
    const glyph = {
      ...blankGlyph("o", [0x6f]),
      contours: [square(0, 0, 300), square(150, 150, 300)],
    };
    typeface.glyphs = [{ ...blankGlyph(".notdef"), dirty: false }, glyph];
    typeface.glyphIndex = new Map([
      [".notdef", 0],
      ["o", 1],
    ]);
    return typeface;
  };

  it("never merges overlaps, even when asked to", async () => {
    const typeface = overlapping();
    const result = await exportFont(typeface, {
      format: "ttf",
      fidelity: "rebuild",
      now: 0,
      mergeOverlaps: true,
      variable: {
        axes: [{ tag: "wght", label: "Weight", min: 400, default: 400, max: 700 }],
        instances: [{ label: "Regular", at: { wght: 400 } }],
        masters: [{ at: { wght: 700 }, typeface: overlapping() }],
      },
    });
    const { tables } = readSfnt(result.bytes);
    const head = tables.get("head")!;
    const format = new DataView(head.buffer, head.byteOffset).getInt16(50);
    const records = splitGlyf(tables.get("glyf")!, tables.get("loca")!, format, 2);
    const record = records[1];
    expect(new DataView(record.buffer, record.byteOffset).getInt16(0)).toBe(2);
  });
});

describe("a copied composite", () => {
  it("has its parts renumbered to where they now sit", () => {
    const built = buildGlyfTables([
      { contours: [], rebuild: true },
      {
        contours: [square(0, 0, 10)],
        rebuild: true,
        composite: [
          { glyphIndex: 5, transform: { a: 1, b: 0, c: 0, d: 1, dx: 300, dy: 0 } },
          { glyphIndex: 9, transform: { a: 0.5, b: 0, c: 0, d: 0.5, dx: 0, dy: 0 } },
        ],
      },
    ]);
    const record = splitGlyf(built.glyf, built.loca, built.indexToLocFormat, 2)[1];
    const moved = renumberComposite(record, (index) => index - 1)!;
    const view = new DataView(moved.buffer, moved.byteOffset);
    expect(view.getUint16(12)).toBe(4);
    // Flags, index, two word arguments and nothing else: the second record
    // starts at 10 + 4 + 4.
    expect(view.getUint16(20)).toBe(8);
    // The original is left as it was.
    expect(new DataView(record.buffer, record.byteOffset).getUint16(12)).toBe(5);
    expect(renumberComposite(record, (index) => (index === 9 ? undefined : index))).toBeNull();
    expect(renumberComposite(record, (index) => index)).toBe(record);
  });
});

describe("new kerning in an existing GPOS", () => {
  it("replaces the kern feature and keeps the other features and their lookups", () => {
    /*
     * A stand-in for a font's own table: the kerning builder's output with its
     * feature renamed to `mark`. It is not a mark attachment, but the merge
     * does not look inside lookups, only at which feature points where.
     */
    const source = buildGposTable([{ left: 1, right: 2, value: -50 }])!;
    const view = new DataView(source.buffer);
    const featureRecord = view.getUint16(6) + 2;
    source.set([0x6d, 0x61, 0x72, 0x6b], featureRecord);
    // And a kern feature of its own, which is what gets replaced.
    const withKern = mergeKerning(source, buildGposTable([{ left: 3, right: 4, value: -20 }]))!;

    const merged = mergeKerning(withKern, buildGposTable([{ left: 1, right: 2, value: -90 }]))!;
    const kerning = readGposKerning(merged);
    // The old kern pair is gone and the new one is there...
    expect(kernBetween(kerning, 3, 4)).toBe(0);
    expect(kernBetween(kerning, 1, 2)).toBe(-90);
    // ...and `mark` still points at its lookup, which still holds its data.
    const tags = featureTags(merged);
    expect(tags).toEqual(["kern", "mark"]);

    const stripped = mergeKerning(merged, null)!;
    expect(featureTags(stripped)).toEqual(["mark"]);
    expect(readGposKerning(stripped).lookups).toHaveLength(0);
  });
});

function featureTags(gpos: Uint8Array): string[] {
  const view = new DataView(gpos.buffer, gpos.byteOffset);
  const list = view.getUint16(6);
  const tags: string[] = [];
  for (let index = 0; index < view.getUint16(list); index++) {
    tags.push(String.fromCharCode(...gpos.subarray(list + 2 + index * 6, list + 6 + index * 6)));
  }
  return tags;
}

describe("a name table with some names changed", () => {
  it("replaces those ids on every platform and keeps every other record", () => {
    const meta = { ...emptyTypeface().meta, familyName: "Old", designer: "Somebody" };
    const source = patchName(new Uint8Array(6), new Set([0, 1, 2, 4, 5, 6, 9, 3]), [
      ...nameValues(meta),
      { id: 3, value: "unique" },
    ]);
    const renamed = { ...meta, familyName: "New", styleName: "SemiBold" };
    const patched = patchName(source, new Set([1, 2, 4, 6, 16, 17]), nameValues(renamed));
    const names = readNames(patched);
    expect(names.get(1)).toBe("New SemiBold");
    expect(names.get(2)).toBe("Regular");
    expect(names.get(16)).toBe("New");
    expect(names.get(17)).toBe("SemiBold");
    expect(names.get(3)).toBe("unique");
    expect(names.get(9)).toBe("Somebody");
  });
});

function readNames(table: Uint8Array): Map<number, string> {
  const view = new DataView(table.buffer, table.byteOffset);
  const storage = view.getUint16(4);
  const names = new Map<number, string>();
  for (let index = 0; index < view.getUint16(2); index++) {
    const at = 6 + index * 12;
    const length = view.getUint16(at + 8);
    const start = storage + view.getUint16(at + 10);
    let value = "";
    for (let offset = 0; offset < length; offset += 2) {
      value += String.fromCharCode(view.getUint16(start + offset));
    }
    names.set(view.getUint16(at + 6), value);
  }
  return names;
}

describe("variation sequences in a rebuilt cmap", () => {
  it("are written as format 14 and read back as they went in", () => {
    const sequences = [
      {
        selector: 0xfe0f,
        defaults: [[0x2764, 0]] as Array<[number, number]>,
        mappings: [{ codepoint: 0x263a, glyphId: 7 }],
      },
      { selector: 0xe0100, defaults: [], mappings: [{ codepoint: 0x845b, glyphId: 3 }] },
    ];
    const cmap = buildCmap([{ codepoint: 0x41, glyphId: 1 }], sequences);
    expect(readVariationSequences(cmap)).toEqual(sequences);
    // And the ordinary mapping is still found beside it.
    const view = new DataView(cmap.buffer);
    expect(view.getUint16(4)).toBe(0);
    expect(view.getUint16(6)).toBe(5);
    expect(readVariationSequences(buildCmap([{ codepoint: 0x41, glyphId: 1 }]))).toEqual([]);
  });
});

describe("a gvar carried through an edit", () => {
  it("follows each glyph to its new number and stills the rebuilt ones", () => {
    // One axis, no shared tuples, two glyphs with short offsets.
    const bytes = new Uint8Array([
      0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 26, 0, 2, 0, 0, 0, 0, 0, 26, 0, 0, 0, 2, 0, 3,
      // glyph 0: four bytes, glyph 1: two bytes
      1, 2, 3, 4, 9, 9,
    ]);
    const { gvar, stilled } = carryGvar(bytes, [1, undefined, 0], [false, false, true]);
    const view = new DataView(gvar.buffer);
    expect(view.getUint16(12)).toBe(3);
    expect(view.getUint16(14) & 1).toBe(1);
    const dataAt = view.getUint32(16);
    const offsets = [0, 1, 2, 3].map((index) => view.getUint32(20 + index * 4));
    expect([...gvar.subarray(dataAt + offsets[0], dataAt + offsets[1])]).toEqual([9, 9]);
    expect(offsets[2] - offsets[1]).toBe(0);
    expect(offsets[3] - offsets[2]).toBe(0);
    expect(stilled).toEqual([2]);
  });
});
