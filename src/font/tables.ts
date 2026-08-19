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
  writer.uint16(0); // maxComponentElements
  writer.uint16(0); // maxComponentDepth
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
export function buildCmap(mappings: Array<{ codepoint: number; glyphId: number }>): Uint8Array {
  const sorted = [...mappings]
    .filter((entry) => entry.codepoint >= 0 && entry.codepoint <= 0x10ffff)
    .sort((a, b) => a.codepoint - b.codepoint);

  const bmp = sorted.filter((entry) => entry.codepoint <= 0xffff);
  const needsFormat12 = sorted.some((entry) => entry.codepoint > 0xffff);

  const format4 = buildCmapFormat4(bmp);
  const subtables: Array<{ platformId: number; encodingId: number; data: Uint8Array }> = [
    { platformId: 3, encodingId: 1, data: format4 },
  ];
  if (needsFormat12) {
    subtables.push({ platformId: 3, encodingId: 10, data: buildCmapFormat12(sorted) });
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
const NAME_IDS: Array<[number, keyof FontMeta | "fullName" | "postScriptName"]> = [
  [0, "copyright"],
  [1, "familyName"],
  [2, "styleName"],
  [4, "fullName"],
  [5, "version"],
  [6, "postScriptName"],
  [8, "manufacturer"],
  [9, "designer"],
  [13, "license"],
];

export function buildName(meta: FontMeta): Uint8Array {
  const fullName = `${meta.familyName} ${meta.styleName}`.trim();
  const postScriptName = sanitisePostScriptName(`${meta.familyName}-${meta.styleName}`);

  const values: Record<string, string> = {
    copyright: meta.copyright,
    familyName: meta.familyName,
    styleName: meta.styleName,
    fullName,
    version: meta.version.startsWith("Version") ? meta.version : `Version ${meta.version}`,
    postScriptName,
    manufacturer: meta.manufacturer,
    designer: meta.designer,
    license: meta.license,
  };

  const entries = NAME_IDS.map(([id, key]) => ({ id, value: values[key] ?? "" })).filter(
    (entry) => entry.value.length > 0,
  );

  // Windows platform, Unicode BMP encoding, US English: the combination every
  // system reads.
  const strings = entries.map((entry) => encodeUtf16Be(entry.value));
  const writer = new ByteWriter();
  writer.uint16(0); // format
  writer.uint16(entries.length);
  writer.uint16(6 + entries.length * 12); // offset to the string storage

  let stringOffset = 0;
  entries.forEach((entry, index) => {
    writer.uint16(3); // platformID: Windows
    writer.uint16(1); // encodingID: Unicode BMP
    writer.uint16(0x0409); // languageID: en-US
    writer.uint16(entry.id);
    writer.uint16(strings[index].length);
    writer.uint16(stringOffset);
    stringOffset += strings[index].length;
  });
  for (const string of strings) writer.bytesFrom(string);
  return writer.toUint8Array();
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
export function buildPost(italicAngle: number, unitsPerEm: number): Uint8Array {
  const writer = new ByteWriter();
  writer.fixed(3);
  writer.fixed(italicAngle);
  writer.int16(Math.round(-unitsPerEm * 0.075)); // underlinePosition
  writer.int16(Math.round(unitsPerEm * 0.05)); // underlineThickness
  writer.uint32(0); // isFixedPitch
  for (let i = 0; i < 4; i++) writer.uint32(0); // memory usage hints, unused
  return writer.toUint8Array();
}

export interface Os2Input {
  metrics: VerticalMetrics;
  unitsPerEm: number;
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
  writer.uint16(Math.max(0, metrics.ascender));
  writer.uint16(Math.max(0, -metrics.descender));
  writer.uint32(1); // ulCodePageRange1: Latin 1
  writer.uint32(0);
  writer.int16(metrics.xHeight);
  writer.int16(metrics.capHeight);
  writer.uint16(0); // usDefaultChar
  writer.uint16(32); // usBreakChar: space
  writer.uint16(2); // usMaxContext
  return writer.toUint8Array();
}
