/**
 * Builders for the tables every sfnt font must carry.
 *
 * These are used by clean-rebuild export. Preserve export patches the original
 * tables instead (see `patch.ts`), so that anything we do not model here
 * survives untouched.
 */

import { ByteWriter } from "./sfnt";
import type { FontMeta, VerticalMetrics } from "./types";

/** Seconds between the Macintosh epoch (1904) and the Unix epoch, used by `head`. */
const MAC_EPOCH_OFFSET = 2082844800;

export interface HeadInput {
  unitsPerEm: number;
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number };
  indexToLocFormat: 0 | 1;
  fontRevision: number;
  /** Milliseconds since the Unix epoch. Passed in so output stays reproducible. */
  createdAt: number;
  modifiedAt: number;
  isItalic: boolean;
  isBold: boolean;
}

export function buildHead(input: HeadInput): Uint8Array {
  const writer = new ByteWriter();
  writer.fixed(1); // table version 1.0
  writer.fixed(input.fontRevision);
  writer.uint32(0); // checkSumAdjustment, computed when the file is assembled
  writer.uint32(0x5f0f3cf5); // magic number required by the spec
  writer.uint16(0b0000_0000_0000_0011); // baseline at y=0, left sidebearing at x=0
  writer.uint16(input.unitsPerEm);
  writeLongDateTime(writer, input.createdAt);
  writeLongDateTime(writer, input.modifiedAt);
  writer.int16(input.bounds.xMin);
  writer.int16(input.bounds.yMin);
  writer.int16(input.bounds.xMax);
  writer.int16(input.bounds.yMax);
  writer.uint16((input.isBold ? 1 : 0) | (input.isItalic ? 2 : 0));
  writer.uint16(8); // lowestRecPPEM
  writer.int16(2); // fontDirectionHint, deprecated but conventionally 2
  writer.int16(input.indexToLocFormat);
  writer.int16(0); // glyphDataFormat
  return writer.toUint8Array();
}

function writeLongDateTime(writer: ByteWriter, epochMilliseconds: number): void {
  const seconds = Math.floor(epochMilliseconds / 1000) + MAC_EPOCH_OFFSET;
  // 64-bit value written as two 32-bit halves.
  writer.uint32(Math.floor(seconds / 0x100000000));
  writer.uint32(seconds >>> 0);
}

export interface HheaInput {
  metrics: VerticalMetrics;
  advanceWidthMax: number;
  minLeftSideBearing: number;
  minRightSideBearing: number;
  xMaxExtent: number;
  numberOfHMetrics: number;
}

export function buildHhea(input: HheaInput): Uint8Array {
  const writer = new ByteWriter();
  writer.fixed(1);
  writer.int16(input.metrics.ascender);
  writer.int16(input.metrics.descender);
  writer.int16(input.metrics.lineGap);
  writer.uint16(input.advanceWidthMax);
  writer.int16(input.minLeftSideBearing);
  writer.int16(input.minRightSideBearing);
  writer.int16(input.xMaxExtent);
  writer.int16(1); // caretSlopeRise, 1/0 means an upright caret
  writer.int16(0); // caretSlopeRun
  writer.int16(0); // caretOffset
  for (let i = 0; i < 4; i++) writer.int16(0); // reserved
  writer.int16(0); // metricDataFormat
  writer.uint16(input.numberOfHMetrics);
  return writer.toUint8Array();
}

export interface MaxpInput {
  numGlyphs: number;
  maxPoints: number;
  maxContours: number;
  /** Largest number of references in any composite glyph. */
  maxComponents?: number;
}

export function buildMaxp(input: MaxpInput): Uint8Array {
  const writer = new ByteWriter();
  writer.fixed(1); // version 1.0, the form TrueType outlines use
  writer.uint16(input.numGlyphs);
  writer.uint16(input.maxPoints);
  writer.uint16(input.maxContours);
  writer.uint16(0); // maxCompositePoints
  writer.uint16(0); // maxCompositeContours
  writer.uint16(2); // maxZones
  writer.uint16(0); // maxTwilightPoints
  writer.uint16(0); // maxStorage
  writer.uint16(0); // maxFunctionDefs
  writer.uint16(0); // maxInstructionDefs
  writer.uint16(0); // maxStackElements
  writer.uint16(0); // maxSizeOfInstructions
  writer.uint16(input.maxComponents ?? 0);
  // One level of nesting is enough for an accent on a letter; deeper is rare
  // and the value is advisory rather than a limit.
  writer.uint16(input.maxComponents ? 2 : 0);
  return writer.toUint8Array();
}

/**
 * `hmtx` holds an advance width and left sidebearing per glyph. Trailing glyphs
 * that share the last advance width store only their sidebearing, which is why
 * `numberOfHMetrics` can be smaller than the glyph count.
 */
export function buildHmtx(metrics: Array<{ advanceWidth: number; leftSideBearing: number }>): {
  hmtx: Uint8Array;
  numberOfHMetrics: number;
} {
  let numberOfHMetrics = metrics.length;
  while (
    numberOfHMetrics > 1 &&
    metrics[numberOfHMetrics - 1].advanceWidth === metrics[numberOfHMetrics - 2].advanceWidth
  ) {
    numberOfHMetrics--;
  }

  const writer = new ByteWriter();
  for (let i = 0; i < numberOfHMetrics; i++) {
    writer.uint16(Math.max(0, Math.round(metrics[i].advanceWidth)));
    writer.int16(Math.round(metrics[i].leftSideBearing));
  }
  for (let i = numberOfHMetrics; i < metrics.length; i++) {
    writer.int16(Math.round(metrics[i].leftSideBearing));
  }
  return { hmtx: writer.toUint8Array(), numberOfHMetrics };
}

/**
 * `cmap` maps codepoints to glyphs.
 *
 * A format 4 subtable covers the Basic Multilingual Plane and is what every
 * consumer reads. A format 12 subtable is added only when the font actually has
 * codepoints above U+FFFF, since format 4 cannot reach them.
 */
export function buildCmap(
  mappings: Array<{ codepoint: number; glyphId: number }>,
  /**
   * Variation sequences to write as a format 14 subtable, already in this
   * font's glyph ids. See `readVariationSequences`.
   */
  sequences: VariationSelector[] = [],
): Uint8Array {
  /*
   * One glyph per character, and the first one listed gets it.
   *
   * Two glyphs claiming the same codepoint is something the editor tries to
   * stop (`claimedBy` in `library.ts`) and cannot always: an imported font can
   * arrive that way, and a letter pasted or duplicated in can land on a
   * character that is already taken. Written through as it was, the codepoint
   * came out twice in a row. Format 4 then has a segment ending where the next
   * one starts, and the endCodes are required to strictly increase, because a
   * reader finds a character by binary search over them; format 12 has two
   * groups covering the same character, which the specification forbids for
   * the same reason. fontTools refuses the one and shapers answer the other
   * with whichever group the search happens to land on.
   *
   * The first rather than the last because the list arrives in glyph order,
   * which is the order a font menu, the glyph grid and every earlier export
   * have shown them in, so the glyph that already answered to the character
   * keeps it. Decided before the sort rather than after it so that the answer
   * does not depend on how the sort treats ties.
   */
  const claimed = new Set<number>();
  const unique: Array<{ codepoint: number; glyphId: number }> = [];
  for (const entry of mappings) {
    if (entry.codepoint < 0 || entry.codepoint > 0x10ffff) continue;
    if (claimed.has(entry.codepoint)) continue;
    claimed.add(entry.codepoint);
    unique.push(entry);
  }
  const sorted = unique.sort((a, b) => a.codepoint - b.codepoint);

  const bmp = sorted.filter((entry) => entry.codepoint <= 0xffff);
  const needsFormat12 = sorted.some((entry) => entry.codepoint > 0xffff);

  const format4 = buildCmapFormat4(bmp);
  const subtables: Array<{ platformId: number; encodingId: number; data: Uint8Array }> = [
    { platformId: 3, encodingId: 1, data: format4 },
  ];
  if (needsFormat12) {
    subtables.push({ platformId: 3, encodingId: 10, data: buildCmapFormat12(sorted) });
  }
  const withSequences = sequences.filter(
    (one) => one.defaults.length > 0 || one.mappings.length > 0,
  );
  if (withSequences.length > 0) {
    // Unicode platform, encoding 5, which is the only place format 14 lives --
    // and first in the list, which is sorted by platform and then encoding.
    subtables.unshift({ platformId: 0, encodingId: 5, data: buildCmapFormat14(withSequences) });
  }

  const writer = new ByteWriter();
  writer.uint16(0); // table version
  writer.uint16(subtables.length);
  let offset = 4 + subtables.length * 8;
  for (const subtable of subtables) {
    writer.uint16(subtable.platformId);
    writer.uint16(subtable.encodingId);
    writer.uint32(offset);
    offset += subtable.data.length;
  }
  for (const subtable of subtables) writer.bytesFrom(subtable.data);
  return writer.toUint8Array();
}

function buildCmapFormat4(mappings: Array<{ codepoint: number; glyphId: number }>): Uint8Array {
  // Group consecutive codepoints into segments. A segment can use the compact
  // `idDelta` form only when its glyph ids run consecutively too; otherwise the
  // ids are listed individually in `glyphIdArray`.
  interface Segment {
    start: number;
    end: number;
    ids: number[];
  }
  const segments: Segment[] = [];
  for (const entry of mappings) {
    const last = segments[segments.length - 1];
    if (last && entry.codepoint === last.end + 1) {
      last.end = entry.codepoint;
      last.ids.push(entry.glyphId);
    } else {
      segments.push({ start: entry.codepoint, end: entry.codepoint, ids: [entry.glyphId] });
    }
  }
  // The spec requires a final segment terminating at 0xFFFF.
  segments.push({ start: 0xffff, end: 0xffff, ids: [0] });

  const segCount = segments.length;
  const endCodes: number[] = [];
  const startCodes: number[] = [];
  const idDeltas: number[] = [];
  const idRangeOffsets: number[] = [];
  const glyphIdArray: number[] = [];

  segments.forEach((segment, index) => {
    endCodes.push(segment.end);
    startCodes.push(segment.start);

    const consecutive = segment.ids.every((id, i) => id === segment.ids[0] + i);
    if (consecutive) {
      idDeltas.push((segment.ids[0] - segment.start) & 0xffff);
      idRangeOffsets.push(0);
    } else {
      idDeltas.push(0);
      // Offset is measured in bytes from this slot in the idRangeOffset array
      // to the glyph's slot in glyphIdArray.
      const remainingSlots = segCount - index;
      idRangeOffsets.push((remainingSlots + glyphIdArray.length) * 2);
      glyphIdArray.push(...segment.ids);
    }
  });

  let maxPowerOfTwo = 1;
  let entrySelector = 0;
  while (maxPowerOfTwo * 2 <= segCount) {
    maxPowerOfTwo *= 2;
    entrySelector++;
  }
  const searchRange = maxPowerOfTwo * 2;

  const writer = new ByteWriter();
  const length = 16 + segCount * 8 + glyphIdArray.length * 2;
  writer.uint16(4);
  writer.uint16(length);
  writer.uint16(0); // language
  writer.uint16(segCount * 2);
  writer.uint16(searchRange);
  writer.uint16(entrySelector);
  writer.uint16(segCount * 2 - searchRange);
  for (const value of endCodes) writer.uint16(value);
  writer.uint16(0); // reservedPad
  for (const value of startCodes) writer.uint16(value);
  for (const value of idDeltas) writer.uint16(value);
  for (const value of idRangeOffsets) writer.uint16(value);
  for (const value of glyphIdArray) writer.uint16(value);
  return writer.toUint8Array();
}

function buildCmapFormat12(mappings: Array<{ codepoint: number; glyphId: number }>): Uint8Array {
  interface Group {
    start: number;
    end: number;
    startGlyphId: number;
  }
  const groups: Group[] = [];
  for (const entry of mappings) {
    const last = groups[groups.length - 1];
    if (
      last &&
      entry.codepoint === last.end + 1 &&
      entry.glyphId === last.startGlyphId + (last.end - last.start) + 1
    ) {
      last.end = entry.codepoint;
    } else {
      groups.push({ start: entry.codepoint, end: entry.codepoint, startGlyphId: entry.glyphId });
    }
  }

  const writer = new ByteWriter();
  writer.uint16(12);
  writer.uint16(0); // reserved
  writer.uint32(16 + groups.length * 12);
  writer.uint32(0); // language
  writer.uint32(groups.length);
  for (const group of groups) {
    writer.uint32(group.start);
    writer.uint32(group.end);
    writer.uint32(group.startGlyphId);
  }
  return writer.toUint8Array();
}

/** Name IDs from the OpenType specification. */
const NAME_IDS: Array<[number, string]> = [
  [0, "copyright"],
  [1, "familyName"],
  [2, "styleName"],
  [4, "fullName"],
  [5, "version"],
  [6, "postScriptName"],
  [8, "manufacturer"],
  [9, "designer"],
  [13, "license"],
  [16, "typographicFamily"],
  [17, "typographicStyle"],
];

/*
 * The four style names a family may put in name ID 2, and no others.
 *
 * This is not a stylistic preference, it is what the operating systems will
 * accept. Name IDs 1 and 2 date from a time when a family had at most four
 * members, and every system still reads them that way: a family whose ID 2
 * says "SemiBold" is a family the font menu will not group, or will group and
 * then be unable to choose bold within.
 */
const RIBBI = new Set(["Regular", "Italic", "Bold", "Bold Italic"]);

/**
 * What a font calls itself, in both the old scheme and the new one.
 *
 * A family of nine weights cannot be described by name IDs 1 and 2 alone --
 * they only hold four styles between them -- so anything outside those four
 * says its real name in IDs 16 and 17 and gives the old pair something they can
 * hold: a family of its own, with "Regular" as its style. That is how Light,
 * Medium and Black have been shipped since the nineties, and it is why a font
 * menu can show one family with nine weights under it rather than nine
 * families with one weight each.
 */
export function familyNames(meta: FontMeta): {
  familyName: string;
  styleName: string;
  typographicFamily: string;
  typographicStyle: string;
} {
  const style = meta.styleName.trim() || "Regular";
  if (RIBBI.has(style)) {
    return {
      familyName: meta.familyName,
      styleName: style,
      typographicFamily: "",
      typographicStyle: "",
    };
  }
  /*
   * The italic of an outlying weight keeps its slope in the old pair.
   *
   * "SemiBold Italic" has to become a family called "Family SemiBold" whose
   * style is "Italic", not one whose style is "Regular" -- or the system has
   * no way to know the face is slanted and will synthesise a second slant on
   * top of the one that is already drawn.
   */
  const italic = /\bitalic\b|\boblique\b/i.test(style);
  const stem = style.replace(/\s*\b(italic|oblique)\b\s*/gi, " ").trim();
  return {
    familyName: `${meta.familyName} ${stem}`.trim(),
    styleName: italic ? "Italic" : "Regular",
    typographicFamily: meta.familyName,
    typographicStyle: style,
  };
}

export function buildName(
  meta: FontMeta,
  /**
   * Names the font invents for itself, by the id it gave them.
   *
   * A varying font names its axes and its named places along them, and the
   * format has nowhere to put those except here, under ids from 256 upwards --
   * which is where it says a font may invent its own. Without them a font
   * manager offers a slider with no label and a list of instances with no
   * names, which is what it did.
   */
  invented: Array<{ id: number; value: string }> = [],
): Uint8Array {
  const entries = [...nameValues(meta), ...invented]
    .filter((entry) => entry.value.length > 0)
    // In order of id, which the format requires of the records and which the
    // list above is only in by luck once anything is added to it.
    .sort((one, other) => one.id - other.id);

  // Windows platform, Unicode BMP encoding, US English: the combination every
  // system reads.
  return writeNameRecords(
    entries.map((entry) => ({
      platformId: 3,
      encodingId: 1,
      languageId: 0x0409,
      nameId: entry.id,
      bytes: encodeUtf16Be(entry.value),
    })),
  );
}

/**
 * Every name id this application writes, with what it writes there.
 *
 * Empty strings included, because the caller that patches an existing table
 * needs to know that an id is ours to say even when what we say is nothing:
 * a family renamed from "Inter Display" to plain "Inter" has no typographic
 * family any more, and the old one has to come out rather than be left behind.
 */
export function nameValues(meta: FontMeta): Array<{ id: number; value: string }> {
  const named = familyNames(meta);
  const fullName = `${meta.familyName} ${meta.styleName}`.trim();
  const postScriptName = sanitisePostScriptName(`${meta.familyName}-${meta.styleName}`);

  const values: Record<string, string> = {
    copyright: meta.copyright,
    familyName: named.familyName,
    styleName: named.styleName,
    fullName,
    version: meta.version.startsWith("Version") ? meta.version : `Version ${meta.version}`,
    postScriptName,
    manufacturer: meta.manufacturer,
    designer: meta.designer,
    license: meta.license,
    typographicFamily: named.typographicFamily,
    typographicStyle: named.typographicStyle,
  };
  return NAME_IDS.map(([id, key]) => ({ id, value: values[key] ?? "" }));
}

/**
 * Which name ids each field of the metadata is written into.
 *
 * The family and the style between them decide six: the old pair, the full
 * name, the PostScript name and the typographic pair, since `familyNames`
 * moves a SemiBold between the old pair and the new one depending on both.
 */
const NAME_IDS_OF: Record<keyof FontMeta, number[]> = {
  familyName: [1, 2, 4, 6, 16, 17],
  styleName: [1, 2, 4, 6, 16, 17],
  version: [5],
  copyright: [0],
  manufacturer: [8],
  designer: [9],
  license: [13],
  weightClass: [],
};

/**
 * The name ids that have to be rewritten because the metadata changed.
 *
 * Compared field by field against what the file said, so that correcting the
 * designer's name rewrites name id 9 and leaves the family exactly as the
 * type designer wrote it -- typographic names, Macintosh records, localised
 * names and all -- rather than replacing everything with the handful of
 * records this application knows how to write.
 */
export function changedNameIds(before: FontMeta, after: FontMeta): Set<number> {
  const ids = new Set<number>();
  for (const key of Object.keys(NAME_IDS_OF) as Array<keyof FontMeta>) {
    if (before[key] !== after[key]) for (const id of NAME_IDS_OF[key]) ids.add(id);
  }
  return ids;
}

interface NameRecord {
  platformId: number;
  encodingId: number;
  languageId: number;
  nameId: number;
  bytes: Uint8Array;
}

function writeNameRecords(records: NameRecord[]): Uint8Array {
  const writer = new ByteWriter();
  writer.uint16(0); // format
  writer.uint16(records.length);
  writer.uint16(6 + records.length * 12); // offset to the string storage

  let stringOffset = 0;
  for (const record of records) {
    writer.uint16(record.platformId);
    writer.uint16(record.encodingId);
    writer.uint16(record.languageId);
    writer.uint16(record.nameId);
    writer.uint16(record.bytes.length);
    writer.uint16(stringOffset);
    stringOffset += record.bytes.length;
  }
  for (const record of records) writer.bytesFrom(record.bytes);
  return writer.toUint8Array();
}

/**
 * An imported font's `name` table with some of its names replaced.
 *
 * A preserving export used to hand the file's own table back untouched, so a
 * family renamed on screen went out under its old name: a font menu would list
 * the edited font beside the original under one name, and the operating system
 * would take one for the other. Rebuilding the table from scratch is no better
 * the other way round, because it holds far more than this application models
 * -- the unique id, the trademark, the URLs, sample text, names in other
 * languages, and the names of a varying font's axes and instances that `fvar`
 * and `STAT` point at by number.
 *
 * So every record for an id in `replace` goes, on every platform and in every
 * language, because a Macintosh record still holding the old family is a
 * second answer to the same question. The new value goes in once, as the
 * Windows English record every system reads, and only if it is not empty.
 * Everything else is copied as it was. Records that name their language by tag
 * rather than by number (format 1) are dropped with the tags, since this writes
 * format 0; they are rare, and the Windows English record says the same thing.
 */
export function patchName(
  source: Uint8Array,
  replace: ReadonlySet<number>,
  values: Array<{ id: number; value: string }>,
): Uint8Array {
  const kept: NameRecord[] = [];
  try {
    const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
    const count = view.getUint16(2);
    const storage = view.getUint16(4);
    for (let index = 0; index < count; index++) {
      const at = 6 + index * 12;
      const record = {
        platformId: view.getUint16(at),
        encodingId: view.getUint16(at + 2),
        languageId: view.getUint16(at + 4),
        nameId: view.getUint16(at + 6),
      };
      if (replace.has(record.nameId) || record.languageId >= 0x8000) continue;
      const length = view.getUint16(at + 8);
      const start = storage + view.getUint16(at + 10);
      if (start + length > source.length) continue;
      kept.push({ ...record, bytes: source.slice(start, start + length) });
    }
  } catch {
    // A table too damaged to walk keeps nothing, and the names below stand
    // on their own.
  }

  for (const { id, value } of values) {
    if (!replace.has(id) || value.length === 0) continue;
    kept.push({
      platformId: 3,
      encodingId: 1,
      languageId: 0x0409,
      nameId: id,
      bytes: encodeUtf16Be(value),
    });
  }

  // In the order the format requires: platform, encoding, language, then id.
  kept.sort(
    (one, other) =>
      one.platformId - other.platformId ||
      one.encodingId - other.encodingId ||
      one.languageId - other.languageId ||
      one.nameId - other.nameId,
  );
  return writeNameRecords(kept);
}

/**
 * The number in a version string, for `head.fontRevision`.
 *
 * The version is kept as the name table writes it, which is "Version 2.001"
 * as often as it is "2.001", and `parseFloat` reads the first of those as not
 * a number at all -- so every imported font went out claiming revision 1.0,
 * which is the field installers compare to decide whether a font is newer
 * than the one already installed. The first number in the string is the
 * revision whichever way it is written; a string with none in it is 1.0.
 */
export function fontRevisionOf(version: string): number {
  const found = /(\d+(?:\.\d+)?)/.exec(version);
  const value = found ? Number.parseFloat(found[1]) : Number.NaN;
  return Number.isFinite(value) ? value : 1;
}

function encodeUtf16Be(value: string): Uint8Array {
  const out = new Uint8Array(value.length * 2);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    out[i * 2] = (code >> 8) & 0xff;
    out[i * 2 + 1] = code & 0xff;
  }
  return out;
}

function sanitisePostScriptName(value: string): string {
  // PostScript names allow a restricted ASCII set and top out at 63 characters.
  return value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 63) || "Untitled-Regular";
}

/** `post` version 3.0: the form that stores no glyph names, which keeps it small. */
/**
 * The `post` table, carrying the glyph names when it is given any.
 *
 * Version three when it is not, which stores no names at all and is what a
 * screen font ships -- a name costs bytes and nothing reading a font to set
 * text with ever asks for one.
 *
 * Version two when it is, and the reason is the contextual alternates. Every
 * other glyph in this font can be identified from the outside by the character
 * it is mapped to; an alternate is mapped to nothing, because it is reached
 * only through a feature, so with no name it is a glyph nobody opening the file
 * can tell from any other. `o.medi` says what it is and `glyph00468` does not.
 *
 * Every name is written out rather than indexed into the standard Macintosh
 * set of 258 that the format also allows. The set would save about half the
 * table -- two kilobytes on a font of a hundred and sixty -- at the cost of
 * carrying 258 strings in this file to be looked up in, and half of them name
 * glyphs nothing here draws. A name written out is right whether or not anyone
 * has agreed on a number for it.
 */
export function buildPost(
  italicAngle: number,
  unitsPerEm: number,
  glyphNames?: string[],
): Uint8Array {
  const writer = new ByteWriter();
  writer.fixed(glyphNames && glyphNames.length > 0 ? 2 : 3);
  writer.fixed(italicAngle);
  writer.int16(Math.round(-unitsPerEm * 0.075)); // underlinePosition
  writer.int16(Math.round(unitsPerEm * 0.05)); // underlineThickness
  writer.uint32(0); // isFixedPitch
  for (let i = 0; i < 4; i++) writer.uint32(0); // memory usage hints, unused
  if (!glyphNames || glyphNames.length === 0) return writer.toUint8Array();

  /*
   * The indices first and the strings after them, which is the shape of the
   * table: an index of 258 or more points at the nth string in the list that
   * follows, in the order they are written.
   */
  writer.uint16(glyphNames.length);
  for (let index = 0; index < glyphNames.length; index++) writer.uint16(258 + index);
  for (const name of glyphNames) {
    // A Pascal string: one byte of length, then the bytes. Names are ASCII by
    // the specification, and anything else is cut back to it rather than
    // written as something no reader will agree about.
    const bytes = [...name]
      .map((one) => one.charCodeAt(0))
      .filter((code) => code > 0x20 && code < 0x7f);
    writer.uint8(Math.min(bytes.length, 63));
    for (const code of bytes.slice(0, 63)) writer.uint8(code);
  }
  return writer.toUint8Array();
}

export interface Os2Input {
  metrics: VerticalMetrics;
  unitsPerEm: number;
  /**
   * The real vertical extent of the drawn outlines. On Windows the `usWin`
   * fields are a clipping boundary rather than line spacing, so they have to
   * enclose the tallest accented capital and the deepest descender or those
   * glyphs are cut off.
   */
  outlineYMax: number;
  outlineYMin: number;
  averageCharWidth: number;
  weightClass: number;
  widthClass: number;
  isItalic: boolean;
  isBold: boolean;
  firstCharIndex: number;
  lastCharIndex: number;
  vendorId: string;
}

export function buildOs2(input: Os2Input): Uint8Array {
  const { metrics, unitsPerEm } = input;
  const writer = new ByteWriter();
  writer.uint16(4); // version 4, widely supported and enough for our needs
  writer.int16(Math.round(input.averageCharWidth));
  writer.uint16(input.weightClass);
  writer.uint16(input.widthClass);
  writer.uint16(0); // fsType: installable embedding
  writer.int16(Math.round(unitsPerEm * 0.65)); // ySubscriptXSize
  writer.int16(Math.round(unitsPerEm * 0.6)); // ySubscriptYSize
  writer.int16(0); // ySubscriptXOffset
  writer.int16(Math.round(unitsPerEm * 0.075)); // ySubscriptYOffset
  writer.int16(Math.round(unitsPerEm * 0.65)); // ySuperscriptXSize
  writer.int16(Math.round(unitsPerEm * 0.6)); // ySuperscriptYSize
  writer.int16(0); // ySuperscriptXOffset
  writer.int16(Math.round(unitsPerEm * 0.35)); // ySuperscriptYOffset
  writer.int16(Math.round(unitsPerEm * 0.05)); // yStrikeoutSize
  writer.int16(Math.round(metrics.xHeight * 0.5)); // yStrikeoutPosition
  writer.int16(0); // sFamilyClass: no classification
  for (let i = 0; i < 10; i++) writer.uint8(0); // PANOSE: unset
  for (let i = 0; i < 4; i++) writer.uint32(0); // ulUnicodeRange, left unset
  for (const char of input.vendorId.padEnd(4).slice(0, 4)) writer.uint8(char.charCodeAt(0));

  let fsSelection = 0;
  if (input.isItalic) fsSelection |= 0x01;
  if (input.isBold) fsSelection |= 0x20;
  if (!input.isItalic && !input.isBold) fsSelection |= 0x40; // REGULAR
  fsSelection |= 0x80; // USE_TYPO_METRICS
  writer.uint16(fsSelection);

  writer.uint16(Math.min(0xffff, Math.max(0, input.firstCharIndex)));
  writer.uint16(Math.min(0xffff, Math.max(0, input.lastCharIndex)));
  writer.int16(metrics.ascender);
  writer.int16(metrics.descender);
  writer.int16(metrics.lineGap);
  // Clipping boundary: take whichever is taller, the typographic ascender or
  // the tallest thing actually drawn. Same below the baseline.
  writer.uint16(Math.max(0, metrics.ascender, input.outlineYMax));
  writer.uint16(Math.max(0, -metrics.descender, -input.outlineYMin));
  writer.uint32(1); // ulCodePageRange1: Latin 1
  writer.uint32(0);
  writer.int16(metrics.xHeight);
  writer.int16(metrics.capHeight);
  writer.uint16(0); // usDefaultChar
  writer.uint16(32); // usBreakChar: space
  writer.uint16(2); // usMaxContext
  return writer.toUint8Array();
}

/**
 * A new `post` for an imported font whose glyphs have changed.
 *
 * The names are this font's, because a `post` table lists them against glyph
 * ids and the file's own list describes the glyph order it arrived with: after
 * a letter is removed every name past it belongs to its neighbour, and after
 * one is added the list is a name short, which fontTools reports and some
 * readers refuse. The rest -- the italic angle, where the underline goes and
 * how thick it is, whether the face is monospaced -- is the file's own, carried
 * across from its table rather than replaced with defaults, since nothing that
 * happened to the glyph set changed any of it.
 */
export function rebuildPost(
  source: Uint8Array | undefined,
  italicAngle: number,
  unitsPerEm: number,
  glyphNames: string[],
): Uint8Array {
  const post = buildPost(italicAngle, unitsPerEm, glyphNames);
  // italicAngle, underlinePosition, underlineThickness and isFixedPitch, which
  // sit between the version and the memory hints in every version of the table.
  if (source && source.length >= 16) post.set(source.subarray(4, 16), 4);
  return post;
}

/**
 * One variation selector's sequences, from a `cmap` format 14 subtable.
 *
 * A variation sequence is a character followed by a selector -- U+845B U+E0100
 * for the one form of a kanji a Japanese place name needs, U+2764 U+FE0F for
 * the heart drawn as an emoji rather than as text. `defaults` are the ranges of
 * base characters for which the sequence means the glyph the character already
 * maps to, so they name no glyph; `mappings` are the ones that mean a glyph of
 * their own, named by id.
 */
export interface VariationSelector {
  selector: number;
  /** Ranges of base characters, as a first character and how many follow it. */
  defaults: Array<[number, number]>;
  mappings: Array<{ codepoint: number; glyphId: number }>;
}

/**
 * The variation sequences in an existing `cmap`, if it has any.
 *
 * Read so that a `cmap` rebuilt for a preserving export can carry them: the
 * rest of the table is written from the document, which does not model these,
 * and dropping them loses every alternate form the font offered through them.
 * A table with none, or one too damaged to read, gives an empty list.
 */
export function readVariationSequences(cmap: Uint8Array): VariationSelector[] {
  try {
    const view = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
    const count = view.getUint16(2);
    for (let index = 0; index < count; index++) {
      const record = 4 + index * 8;
      const at = view.getUint32(record + 4);
      if (view.getUint16(record) !== 0 || view.getUint16(record + 2) !== 5) continue;
      if (view.getUint16(at) !== 14) continue;
      const uint24 = (offset: number) =>
        (view.getUint8(offset) << 16) |
        (view.getUint8(offset + 1) << 8) |
        view.getUint8(offset + 2);
      const selectors: VariationSelector[] = [];
      const selectorCount = view.getUint32(at + 6);
      for (let slot = 0; slot < selectorCount; slot++) {
        const entry = at + 10 + slot * 11;
        const defaultsAt = view.getUint32(entry + 3);
        const mappingsAt = view.getUint32(entry + 7);
        const selector: VariationSelector = { selector: uint24(entry), defaults: [], mappings: [] };
        if (defaultsAt !== 0) {
          const ranges = view.getUint32(at + defaultsAt);
          for (let one = 0; one < ranges; one++) {
            const range = at + defaultsAt + 4 + one * 4;
            selector.defaults.push([uint24(range), view.getUint8(range + 3)]);
          }
        }
        if (mappingsAt !== 0) {
          const mappings = view.getUint32(at + mappingsAt);
          for (let one = 0; one < mappings; one++) {
            const mapping = at + mappingsAt + 4 + one * 5;
            selector.mappings.push({
              codepoint: uint24(mapping),
              glyphId: view.getUint16(mapping + 3),
            });
          }
        }
        selectors.push(selector);
      }
      return selectors;
    }
  } catch {
    // Nothing worth keeping from a table that cannot be walked.
  }
  return [];
}

function buildCmapFormat14(selectors: VariationSelector[]): Uint8Array {
  const sorted = [...selectors].sort((one, other) => one.selector - other.selector);
  const uint24 = (writer: ByteWriter, value: number) =>
    writer
      .uint8(value >> 16)
      .uint8(value >> 8)
      .uint8(value);

  const header = 10 + sorted.length * 11;
  let cursor = header;
  const offsets = sorted.map((one) => {
    const defaults = one.defaults.length > 0 ? cursor : 0;
    cursor += one.defaults.length > 0 ? 4 + one.defaults.length * 4 : 0;
    const mappings = one.mappings.length > 0 ? cursor : 0;
    cursor += one.mappings.length > 0 ? 4 + one.mappings.length * 5 : 0;
    return { defaults, mappings };
  });

  const writer = new ByteWriter();
  writer.uint16(14);
  writer.uint32(cursor);
  writer.uint32(sorted.length);
  sorted.forEach((one, index) => {
    uint24(writer, one.selector);
    writer.uint32(offsets[index].defaults);
    writer.uint32(offsets[index].mappings);
  });
  for (const one of sorted) {
    if (one.defaults.length > 0) {
      writer.uint32(one.defaults.length);
      for (const [start, more] of [...one.defaults].sort((a, b) => a[0] - b[0])) {
        uint24(writer, start);
        writer.uint8(more);
      }
    }
    if (one.mappings.length > 0) {
      writer.uint32(one.mappings.length);
      for (const mapping of [...one.mappings].sort((a, b) => a.codepoint - b.codepoint)) {
        uint24(writer, mapping.codepoint);
        writer.uint16(mapping.glyphId);
      }
    }
  }
  return writer.toUint8Array();
}
