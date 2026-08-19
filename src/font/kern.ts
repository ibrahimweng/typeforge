/**
 * Kerning table writers.
 *
 * Neither font library we import with will write kerning back out, so we build
 * these tables ourselves. Two formats go into every export:
 *
 * - `kern`, the original TrueType table. Simple, and still what some older
 *   software and design apps read.
 * - `GPOS`, the OpenType table. This is what browsers and modern text engines
 *   actually use, and the only one of the two that can express class kerning.
 */

import { ByteWriter } from "./sfnt";

export interface ResolvedPair {
  left: number;
  right: number;
  value: number;
}

export interface ResolvedClassKern {
  left: number[];
  right: number[];
  value: number;
}

/**
 * Legacy `kern` table, version 0 with a single format 0 subtable.
 *
 * Format 0 is a flat sorted list of glyph pairs. It cannot express classes, so
 * class kerning is expanded into individual pairs by the caller before it gets
 * here.
 */
export function buildKernTable(pairs: ResolvedPair[]): Uint8Array | null {
  if (pairs.length === 0) return null;

  // A format 0 subtable addresses pairs with 16-bit offsets, so it cannot hold
  // more than this. Anything beyond lives in GPOS only.
  const capped = pairs.slice(0, 10920);
  const sorted = [...capped].sort((a, b) => a.left - b.left || a.right - b.right);

  const count = sorted.length;
  let maxPowerOfTwo = 1;
  let entrySelector = 0;
  while (maxPowerOfTwo * 2 <= count) {
    maxPowerOfTwo *= 2;
    entrySelector++;
  }
  const searchRange = maxPowerOfTwo * 6;
  const rangeShift = count * 6 - searchRange;

  const subtable = new ByteWriter();
  subtable.uint16(count).uint16(searchRange).uint16(entrySelector).uint16(rangeShift);
  for (const pair of sorted) {
    subtable.uint16(pair.left).uint16(pair.right).int16(clampInt16(pair.value));
  }

  const out = new ByteWriter();
  out.uint16(0).uint16(1); // table version 0, one subtable
  out.uint16(0); // subtable version 0
  out.uint16(6 + subtable.length); // subtable length including its header
  out.uint16(0x0001); // coverage: horizontal, format 0
  out.bytesFrom(subtable.toUint8Array());
  return out.toUint8Array();
}

/**
 * OpenType `GPOS` carrying a single `kern` feature.
 *
 * Individual pairs go in a PairPos format 1 subtable and class kerning in a
 * PairPos format 2 subtable. A lookup may hold both, and the shaper takes the
 * first subtable that covers a given pair, so format 1 is listed first and
 * individual pairs win over the class default. That ordering is what lets a
 * designer override one awkward pair without breaking the class it belongs to.
 */
export function buildGposTable(
  pairs: ResolvedPair[],
  classKerns: ResolvedClassKern[] = [],
): Uint8Array | null {
  const subtables: Uint8Array[] = [];
  if (pairs.length > 0) subtables.push(buildPairPosFormat1(pairs));
  for (const classKern of classKerns) {
    if (classKern.left.length > 0 && classKern.right.length > 0) {
      subtables.push(buildPairPosFormat2(classKern));
    }
  }
  if (subtables.length === 0) return null;

  // Lookup table: type 2 (pair adjustment), pointing at each subtable.
  const lookup = new ByteWriter();
  lookup.uint16(2).uint16(0).uint16(subtables.length);
  let subtableCursor = 6 + subtables.length * 2;
  for (const subtable of subtables) {
    lookup.uint16(subtableCursor);
    subtableCursor += subtable.length;
  }
  for (const subtable of subtables) lookup.bytesFrom(subtable);
  const lookupBytes = lookup.toUint8Array();

  // LookupList holding that one lookup.
  const lookupList = new ByteWriter();
  lookupList.uint16(1).uint16(4).bytesFrom(lookupBytes);
  const lookupListBytes = lookupList.toUint8Array();

  // FeatureList with a single `kern` feature referencing lookup 0.
  const featureList = new ByteWriter();
  featureList.uint16(1); // featureCount
  featureList.uint8(0x6b).uint8(0x65).uint8(0x72).uint8(0x6e); // "kern"
  featureList.uint16(8); // offset to the feature table
  featureList.uint16(0).uint16(1).uint16(0); // no params, one lookup, index 0
  const featureListBytes = featureList.toUint8Array();

  // ScriptList with DFLT/dflt so the feature applies to any script.
  const scriptList = new ByteWriter();
  scriptList.uint16(1); // scriptCount
  scriptList.uint8(0x44).uint8(0x46).uint8(0x4c).uint8(0x54); // "DFLT"
  scriptList.uint16(8); // offset to the script table
  scriptList.uint16(4).uint16(0); // defaultLangSys at +4, no extra languages
  scriptList.uint16(0).uint16(0xffff).uint16(1).uint16(0); // LangSys -> feature 0
  const scriptListBytes = scriptList.toUint8Array();

  const headerSize = 10;
  const scriptListOffset = headerSize;
  const featureListOffset = scriptListOffset + scriptListBytes.length;
  const lookupListOffset = featureListOffset + featureListBytes.length;

  const gpos = new ByteWriter();
  gpos.uint16(1).uint16(0); // version 1.0
  gpos.uint16(scriptListOffset).uint16(featureListOffset).uint16(lookupListOffset);
  gpos.bytesFrom(scriptListBytes).bytesFrom(featureListBytes).bytesFrom(lookupListBytes);
  return gpos.toUint8Array();
}

/** PairPos format 1: an explicit list of second glyphs per first glyph. */
function buildPairPosFormat1(pairs: ResolvedPair[]): Uint8Array {
  const byFirst = new Map<number, ResolvedPair[]>();
  for (const pair of pairs) {
    const list = byFirst.get(pair.left);
    if (list) list.push(pair);
    else byFirst.set(pair.left, [pair]);
  }
  const firstGlyphs = [...byFirst.keys()].sort((a, b) => a - b);

  const pairSets = firstGlyphs.map((glyph) => {
    const list = byFirst.get(glyph)!.sort((a, b) => a.right - b.right);
    const writer = new ByteWriter();
    writer.uint16(list.length);
    for (const pair of list) writer.uint16(pair.right).int16(clampInt16(pair.value));
    return writer.toUint8Array();
  });

  const coverage = buildCoverage(firstGlyphs);
  const headerSize = 10 + firstGlyphs.length * 2;
  let cursor = headerSize;
  const pairSetOffsets = pairSets.map((set) => {
    const offset = cursor;
    cursor += set.length;
    return offset;
  });
  const coverageOffset = cursor;

  const out = new ByteWriter();
  out.uint16(1); // posFormat
  out.uint16(coverageOffset);
  out.uint16(0x0004); // valueFormat1: XAdvance only
  out.uint16(0); // valueFormat2: nothing on the second glyph
  out.uint16(firstGlyphs.length);
  for (const offset of pairSetOffsets) out.uint16(offset);
  for (const set of pairSets) out.bytesFrom(set);
  out.bytesFrom(coverage);
  return out.toUint8Array();
}

/**
 * PairPos format 2: a value per (left class, right class) cell.
 *
 * Class 0 means "everything not otherwise listed", so the grid is one row and
 * one column bigger than the class lists and those extra cells hold zero.
 */
function buildPairPosFormat2(classKern: ResolvedClassKern): Uint8Array {
  const leftGlyphs = [...new Set(classKern.left)].sort((a, b) => a - b);
  const rightGlyphs = [...new Set(classKern.right)].sort((a, b) => a - b);

  const class1Count = 2; // class 0 (unlisted) and class 1 (our left set)
  const class2Count = 2;

  const coverage = buildCoverage(leftGlyphs);
  const classDef1 = buildClassDef(leftGlyphs, 1);
  const classDef2 = buildClassDef(rightGlyphs, 1);

  // Each cell holds one int16 because valueFormat1 is XAdvance and
  // valueFormat2 is empty.
  const gridSize = class1Count * class2Count * 2;
  const headerSize = 16;
  const coverageOffset = headerSize + gridSize;
  const classDef1Offset = coverageOffset + coverage.length;
  const classDef2Offset = classDef1Offset + classDef1.length;

  const out = new ByteWriter();
  out.uint16(2); // posFormat
  out.uint16(coverageOffset);
  out.uint16(0x0004); // valueFormat1: XAdvance
  out.uint16(0); // valueFormat2
  out.uint16(classDef1Offset);
  out.uint16(classDef2Offset);
  out.uint16(class1Count);
  out.uint16(class2Count);
  // Grid rows: class 0 kerns with nothing, class 1 kerns with class 1.
  out.int16(0).int16(0);
  out.int16(0).int16(clampInt16(classKern.value));
  out.bytesFrom(coverage).bytesFrom(classDef1).bytesFrom(classDef2);
  return out.toUint8Array();
}

/** Coverage format 1: a sorted list of the glyphs a subtable applies to. */
function buildCoverage(glyphs: number[]): Uint8Array {
  const writer = new ByteWriter();
  writer.uint16(1).uint16(glyphs.length);
  for (const glyph of glyphs) writer.uint16(glyph);
  return writer.toUint8Array();
}

/** ClassDef format 2: ranges of glyph ids that share a class value. */
function buildClassDef(glyphs: number[], classValue: number): Uint8Array {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const glyph of glyphs) {
    const last = ranges[ranges.length - 1];
    if (last && glyph === last.end + 1) last.end = glyph;
    else ranges.push({ start: glyph, end: glyph });
  }
  const writer = new ByteWriter();
  writer.uint16(2).uint16(ranges.length);
  for (const range of ranges) {
    writer.uint16(range.start).uint16(range.end).uint16(classValue);
  }
  return writer.toUint8Array();
}

function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}
