/**
 * Several files as one download.
 *
 * A family is nine fonts, and nine downloads is nine trips through whatever the
 * browser does about downloads -- nine permission prompts on some, nine files
 * landing in an order nobody chose on the rest. One archive is what everybody
 * expects and what every foundry ships.
 *
 * Written here rather than taken from a library, and stored rather than
 * deflated. A zip with no compression is a zip: the format has said so since
 * 1989, every unarchiver reads it, and the operating systems' built-in ones
 * make no distinction. What it costs is size, and it costs nothing here --
 * fonts are mostly outlines, which is coordinates, which deflate by about a
 * fifth. What it saves is a compression library in the bundle and a class of
 * bug nobody wants: an archive that opens on the machine that wrote it and not
 * on the one it was sent to.
 */

const encoder = new TextEncoder();

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

/*
 * The table the checksum is read out of.
 *
 * Built once on first use rather than written out: two hundred and fifty-six
 * constants in a source file is two hundred and fifty-six chances to mistype
 * one, and the polynomial that generates them is a single line.
 */
let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table) return table;
  const built = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    built[index] = value >>> 0;
  }
  table = built;
  return built;
}

export function crc32(bytes: Uint8Array): number {
  const lookup = crcTable();
  let crc = 0xffffffff;
  for (let at = 0; at < bytes.length; at++) {
    crc = lookup[(crc ^ bytes[at]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * The date every entry is stamped with.
 *
 * A fixed one, and not the clock. Two archives written from the same fonts
 * should be the same bytes -- which is how anybody checks that a download was
 * not tampered with on the way, and is the same reason the font exporter takes
 * its timestamp as an argument rather than reading the clock itself.
 */
const STAMP = { time: 0, date: 0x21 };

/** A store-only zip archive of these files, in the order given. */
export function zip(entries: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const sum = crc32(entry.bytes);

    const local = new Uint8Array(30 + name.length + entry.bytes.length);
    const head = new DataView(local.buffer);
    head.setUint32(0, 0x04034b50, true); // local file header
    head.setUint16(4, 20, true); // version needed: 2.0
    head.setUint16(6, 0, true); // flags
    head.setUint16(8, 0, true); // method: stored
    head.setUint16(10, STAMP.time, true);
    head.setUint16(12, STAMP.date, true);
    head.setUint32(14, sum, true);
    head.setUint32(18, entry.bytes.length, true); // compressed size
    head.setUint32(22, entry.bytes.length, true); // uncompressed size
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true); // extra field length
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.length);
    locals.push(local);

    const record = new Uint8Array(46 + name.length);
    const listing = new DataView(record.buffer);
    listing.setUint32(0, 0x02014b50, true); // central directory header
    listing.setUint16(4, 20, true); // version made by
    listing.setUint16(6, 20, true); // version needed
    listing.setUint16(8, 0, true);
    listing.setUint16(10, 0, true); // method: stored
    listing.setUint16(12, STAMP.time, true);
    listing.setUint16(14, STAMP.date, true);
    listing.setUint32(16, sum, true);
    listing.setUint32(20, entry.bytes.length, true);
    listing.setUint32(24, entry.bytes.length, true);
    listing.setUint16(28, name.length, true);
    listing.setUint16(30, 0, true); // extra
    listing.setUint16(32, 0, true); // comment
    listing.setUint16(34, 0, true); // disk number
    listing.setUint16(36, 0, true); // internal attributes
    listing.setUint32(38, 0, true); // external attributes
    listing.setUint32(42, offset, true); // where the local header is
    record.set(name, 46);
    central.push(record);

    offset += local.length;
  }

  const directory = central.reduce((sum, record) => sum + record.length, 0);
  const end = new Uint8Array(22);
  const tail = new DataView(end.buffer);
  tail.setUint32(0, 0x06054b50, true); // end of central directory
  tail.setUint16(4, 0, true); // this disk
  tail.setUint16(6, 0, true); // the disk the directory starts on
  tail.setUint16(8, entries.length, true);
  tail.setUint16(10, entries.length, true);
  tail.setUint32(12, directory, true);
  tail.setUint32(16, offset, true);
  tail.setUint16(20, 0, true); // comment length

  const total = offset + directory + end.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const piece of [...locals, ...central, end]) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}
