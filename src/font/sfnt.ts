/**
 * Reading and writing the sfnt container that TrueType and OpenType files share.
 *
 * A font file is a directory of tables. Neither of the font libraries we import
 * with will write a table they do not model, so they quietly drop kerning and
 * layout features on export. Owning the container ourselves is what lets us put
 * those tables back, and it is what "preserve" export is built on: tables the
 * user never touched are copied through byte for byte.
 */

/** `\0\1\0\0` — TrueType outlines in a `glyf` table. */
export const SFNT_TRUETYPE = 0x00010000;
/** `OTTO` — PostScript outlines in a `CFF ` table. */
export const SFNT_CFF = 0x4f54544f;

export interface SfntFont {
  sfntVersion: number;
  tables: Map<string, Uint8Array>;
}

function tagToNumber(tag: string): number {
  return (
    ((tag.charCodeAt(0) << 24) |
      (tag.charCodeAt(1) << 16) |
      (tag.charCodeAt(2) << 8) |
      tag.charCodeAt(3)) >>>
    0
  );
}

/**
 * The sfnt checksum: sum of the table's contents read as big-endian uint32,
 * with the tail zero-padded to a 4-byte boundary.
 */
export function checksum(bytes: Uint8Array): number {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  const view = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) {
    sum = (sum + view.getUint32(i)) >>> 0;
  }
  return sum >>> 0;
}

export function readSfnt(bytes: Uint8Array): SfntFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sfntVersion = view.getUint32(0);

  if (sfntVersion === 0x74746366) {
    throw new Error(
      "This is a TrueType Collection (.ttc) holding several fonts. Extract a single font first.",
    );
  }
  if (sfntVersion !== SFNT_TRUETYPE && sfntVersion !== SFNT_CFF && sfntVersion !== 0x74727565) {
    throw new Error("Not an sfnt font file: unrecognised version tag.");
  }

  const numTables = view.getUint16(4);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    );
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (offset + length > bytes.length) {
      // Some shipping fonts overstate the last table's length. Clamp rather
      // than refuse the file; the trailing bytes are padding in practice.
      tables.set(tag, bytes.subarray(offset, bytes.length));
    } else {
      tables.set(tag, bytes.subarray(offset, offset + length));
    }
  }
  return { sfntVersion, tables };
}

/**
 * Serialise tables back into a font file, recomputing every checksum and the
 * whole-font `head.checkSumAdjustment`.
 */
export function writeSfnt(font: SfntFont): Uint8Array {
  // The spec requires the table directory to be sorted by tag.
  const tags = [...font.tables.keys()].sort();
  const numTables = tags.length;

  let maxPowerOfTwo = 1;
  let entrySelector = 0;
  while (maxPowerOfTwo * 2 <= numTables) {
    maxPowerOfTwo *= 2;
    entrySelector++;
  }
  const searchRange = maxPowerOfTwo * 16;
  const rangeShift = numTables * 16 - searchRange;

  // `head.checkSumAdjustment` must read as zero while checksums are computed,
  // so copy that table and clear the field before measuring anything.
  const tables = new Map(font.tables);
  const head = tables.get("head");
  if (head) {
    const patched = new Uint8Array(head);
    new DataView(patched.buffer).setUint32(8, 0);
    tables.set("head", patched);
  }

  const directorySize = 12 + numTables * 16;
  let cursor = directorySize;
  const layout = tags.map((tag) => {
    const data = tables.get(tag)!;
    const entry = { tag, data, offset: cursor };
    cursor += Math.ceil(data.length / 4) * 4; // tables are 4-byte aligned
    return entry;
  });

  const out = new Uint8Array(cursor);
  const view = new DataView(out.buffer);
  view.setUint32(0, font.sfntVersion);
  view.setUint16(4, numTables);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, rangeShift);

  layout.forEach((entry, i) => {
    const record = 12 + i * 16;
    view.setUint32(record, tagToNumber(entry.tag));
    view.setUint32(record + 4, checksum(entry.data));
    view.setUint32(record + 8, entry.offset);
    view.setUint32(record + 12, entry.data.length);
    out.set(entry.data, entry.offset);
  });

  const headEntry = layout.find((entry) => entry.tag === "head");
  if (headEntry) {
    // Defined by the spec as 0xB1B0AFBA minus the checksum of the whole file.
    view.setUint32(headEntry.offset + 8, (0xb1b0afba - checksum(out)) >>> 0);
  }
  return out;
}

/** Byte writer for building tables, big-endian throughout as sfnt requires. */
export class ByteWriter {
  private bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }
  uint8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }
  uint16(v: number): this {
    this.bytes.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }
  int16(v: number): this {
    return this.uint16(v < 0 ? v + 0x10000 : v);
  }
  uint32(v: number): this {
    this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return this;
  }
  int32(v: number): this {
    return this.uint32(v >>> 0);
  }
  /** 16.16 fixed point, used by `head.fontRevision` among others. */
  fixed(v: number): this {
    return this.int32(Math.round(v * 65536));
  }
  bytesFrom(data: Uint8Array): this {
    for (const b of data) this.bytes.push(b);
    return this;
  }
  /** Zero-pad to the next 4-byte boundary. */
  align(): this {
    while (this.bytes.length % 4 !== 0) this.bytes.push(0);
    return this;
  }
  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}
