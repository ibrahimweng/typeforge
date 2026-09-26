/**
 * WOFF 1.0, and the one number in it that nothing used to check.
 *
 * Every table in a WOFF is zlib-compressed and says in the directory how long
 * it is once inflated. The inflate ignored that and took whatever the stream
 * produced, so a table declared at a few hundred bytes could inflate to
 * gigabytes and take the tab with it. These build WOFFs from the bundled sample
 * -- the repository has no WOFF of its own -- and then lie in them.
 */

import { readFileSync } from "node:fs";
import { Unzlib, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";

import { FontFileError } from "./damaged";
import { importFont, inflateTable, MAX_WOFF_SFNT_BYTES, woffInflater } from "./parse";
import { readSfnt } from "./sfnt";

const SAMPLE = new Uint8Array(readFileSync("src/assets/typeforge-sample.ttf"));

interface Table {
  tag: string;
  data: Uint8Array;
  /** What the directory will claim, when a test wants it to lie. */
  origLength?: number;
  /** The bytes actually stored, when a test wants those to lie instead. */
  stored?: Uint8Array;
}

function tablesOf(sfnt: Uint8Array): Table[] {
  return [...readSfnt(sfnt).tables].map(([tag, data]) => ({ tag, data }));
}

/**
 * A WOFF of the given tables, compressed where that helps.
 *
 * Only where it helps, because that is how a reader tells the two apart: a
 * table whose stored length is not less than its declared one is taken to be
 * stored raw, so a tiny table zlibbed to something longer would be copied into
 * the font as zlib.
 */
function woffOf(tables: Table[], totalSfntSize?: number): Uint8Array {
  const stored = tables.map((t) => {
    if (t.stored) return t.stored;
    const packed = zlibSync(t.data);
    return packed.length < t.data.length ? packed : t.data;
  });
  const pad = (n: number) => (n + 3) & ~3;
  let offset = 44 + tables.length * 20;
  const offsets = stored.map((s) => {
    const at = offset;
    offset += pad(s.length);
    return at;
  });

  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4646); // wOFF
  view.setUint32(4, 0x00010000);
  view.setUint32(8, offset);
  view.setUint16(12, tables.length);
  view.setUint32(
    16,
    totalSfntSize ?? 12 + 16 * tables.length + tables.reduce((n, t) => n + pad(t.data.length), 0),
  );
  tables.forEach((t, i) => {
    const entry = 44 + i * 20;
    for (let c = 0; c < 4; c++) out[entry + c] = t.tag.charCodeAt(c);
    view.setUint32(entry + 4, offsets[i]);
    view.setUint32(entry + 8, stored[i].length);
    view.setUint32(entry + 12, t.origLength ?? t.data.length);
    out.set(stored[i], offsets[i]);
  });
  return out;
}

describe("a WOFF, inflated", () => {
  it("opens one made from the sample, with the sample's glyphs", async () => {
    // fonteditor-core rewrites the font it unwraps -- its `post` even renames a
    // couple of glyphs -- so neither tables nor names are compared; the same
    // glyphs at the same widths is what says every table inflated whole.
    const direct = await importFont(SAMPLE, "sample.ttf");
    const { typeface } = await importFont(woffOf(tablesOf(SAMPLE)), "sample.woff");
    expect(typeface.glyphs.length).toBe(direct.typeface.glyphs.length);
    expect(typeface.glyphs.map((g) => g.advanceWidth)).toEqual(
      direct.typeface.glyphs.map((g) => g.advanceWidth),
    );
  });

  it("refuses a table that inflates past its declared length, without inflating it all", async () => {
    // Sixty-four megabytes of zeros compress to about sixty-four kilobytes.
    const bomb = zlibSync(new Uint8Array(64 * 1024 * 1024));
    const tables = tablesOf(SAMPLE);
    tables[0] = { ...tables[0], stored: bomb, origLength: 70_000 };
    const promise = importFont(woffOf(tables), "bomb.woff");
    await expect(promise).rejects.toThrow(FontFileError);
    await expect(promise).rejects.toThrow(/damaged or incomplete/);
  });

  it("refuses a table that inflates short of its declared length", async () => {
    const tables = tablesOf(SAMPLE);
    const glyf = tables.findIndex((t) => t.tag === "glyf");
    tables[glyf] = { ...tables[glyf], origLength: tables[glyf].data.length + 100 };
    await expect(importFont(woffOf(tables), "short.woff")).rejects.toThrow(FontFileError);
  });

  it("refuses a header that asks for more than any real font needs", () => {
    const woff = woffOf(tablesOf(SAMPLE), MAX_WOFF_SFNT_BYTES + 1);
    expect(() => woffInflater(woff, Unzlib)).toThrow(/unpack to/);
  });
});

describe("inflateTable", () => {
  const data = new TextEncoder().encode("the quick brown fox ".repeat(5000));
  const packed = zlibSync(data);

  it("gives back exactly the declared bytes, as a typed array", () => {
    const out = inflateTable(packed, data.length, Unzlib);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out).toEqual(data);
  });

  it("stops at the declared length rather than finishing the stream", () => {
    let seen = 0;
    class Counting extends Unzlib {
      constructor() {
        super();
        const push = this.push.bind(this);
        this.push = (chunk, final) => {
          seen += chunk.length;
          push(chunk, final);
        };
      }
    }
    const bomb = zlibSync(new Uint8Array(16 * 1024 * 1024));
    expect(() => inflateTable(bomb, 100, Counting)).toThrow(/past its declared 100/);
    expect(seen).toBeLessThan(bomb.length);
  });

  it("refuses a stream that is cut off", () => {
    expect(() =>
      inflateTable(packed.subarray(0, packed.length >> 1), data.length, Unzlib),
    ).toThrow();
  });

  it("refuses a stream that ends short of the declared length", () => {
    expect(() => inflateTable(packed, data.length + 1, Unzlib)).toThrow(/not the declared/);
  });
});
