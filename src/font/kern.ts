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
  /** Which lookup this belongs to. See `ResolvedClassKern`. */
  group?: number;
}

export interface ResolvedClassKern {
  left: number[];
  right: number[];
  value: number;
  /**
   * Which lookup this belongs to. Classes sharing one are written together.
   *
   * A font's kerning is several lookups, all of them applied, so two classes
   * in different lookups that both speak about a pair are two adjustments that
   * add up. Two in the same lookup are not: only the first subtable a glyph is
   * covered by is ever consulted. Keeping the grouping is what lets a font
   * that was read in be written back out meaning what it meant.
   */
  group?: number;
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
  /*
   * One lookup per group, and the subtables inside each in a deliberate order.
   *
   * The individual pairs go first because a list of pairs only matches when it
   * holds the exact pair, so anything it says nothing about falls through to
   * the grids behind it. Put the grids first and every pair they cover would
   * be answered by the class default and the specific pairs would never be
   * reached -- which is how a real font arranges it, and for this reason.
   */
  const groups = new Map<number, { pairs: ResolvedPair[]; classes: ResolvedClassKern[] }>();
  const groupFor = (key: number) => {
    const existing = groups.get(key);
    if (existing) return existing;
    const made = { pairs: [] as ResolvedPair[], classes: [] as ResolvedClassKern[] };
    groups.set(key, made);
    return made;
  };
  for (const pair of pairs) groupFor(pair.group ?? 0).pairs.push(pair);
  for (const classKern of classKerns) {
    if (classKern.left.length === 0 || classKern.right.length === 0) continue;
    groupFor(classKern.group ?? 0).classes.push(classKern);
  }

  const lookups: Uint8Array[][] = [];
  for (const [, group] of [...groups].sort((a, b) => a[0] - b[0])) {
    const subtables = [
      ...splitPairs(group.pairs).map(buildPairPosFormat1),
      ...assembleGrids(group.classes).map(buildPairPosFormat2),
    ];
    if (subtables.length > 0) lookups.push(subtables);
  }
  if (lookups.length === 0) return null;

  const lookupListBytes = buildLookupList(lookups);

  // FeatureList with a single `kern` feature referencing every lookup.
  const featureList = new ByteWriter();
  featureList.uint16(1); // featureCount
  featureList.uint8(0x6b).uint8(0x65).uint8(0x72).uint8(0x6e); // "kern"
  featureList.uint16(8); // offset to the feature table
  featureList.uint16(0).uint16(lookups.length);
  for (let index = 0; index < lookups.length; index++) featureList.uint16(index);
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

/**
 * The lookup list, with every subtable reached through an extension.
 *
 * The offsets inside a lookup list are sixteen bits, and a real font's kerning
 * does not fit in sixteen bits: Inter's is eighty kilobytes, so the offset to
 * its second lookup came out past what the field can hold and the table it
 * wrote pointed into the middle of its own data. fontTools would not read it
 * and no shaper would either.
 *
 * The answer the format provides, and the one every font of any size uses, is
 * lookup type 9. Each subtable is replaced by a small record holding a
 * thirty-two bit offset to the real one, so the lookups themselves stay a few
 * bytes each and the sixteen-bit offsets between them never have far to
 * reach, while the subtables sit at the end where a wide offset can find them.
 */
function buildLookupList(lookups: Uint8Array[][]): Uint8Array {
  const EXTENSION_RECORD = 8; // posFormat, extensionLookupType, extensionOffset

  const lookupBytes = lookups.map((subtables) => {
    const lookup = new ByteWriter();
    lookup.uint16(EXTENSION).uint16(0).uint16(subtables.length);
    let cursor = 6 + subtables.length * 2;
    for (let index = 0; index < subtables.length; index++) {
      lookup.uint16(cursor);
      cursor += EXTENSION_RECORD;
    }
    return { header: lookup.toUint8Array(), subtables, recordsAt: 6 + subtables.length * 2 };
  });

  // Where each lookup starts, and where the payload begins after all of them.
  const headerSize = 2 + lookupBytes.length * 2;
  const lookupSizes = lookupBytes.map(
    (lookup) => lookup.recordsAt + lookup.subtables.length * EXTENSION_RECORD,
  );
  const lookupOffsets: number[] = [];
  let cursor = headerSize;
  for (const size of lookupSizes) {
    lookupOffsets.push(cursor);
    cursor += size;
  }
  let payloadCursor = cursor;

  const out = new ByteWriter();
  out.uint16(lookupBytes.length);
  for (const offset of lookupOffsets) out.uint16(offset);

  const payloads: Uint8Array[] = [];
  for (const [index, lookup] of lookupBytes.entries()) {
    out.bytesFrom(lookup.header);
    let recordAt = lookupOffsets[index] + lookup.recordsAt;
    for (const subtable of lookup.subtables) {
      out.uint16(1); // ExtensionPos format 1
      out.uint16(PAIR_POS);
      // Measured from the start of the extension record that holds it.
      out.uint32(payloadCursor - recordAt);
      payloads.push(subtable);
      payloadCursor += subtable.length;
      recordAt += EXTENSION_RECORD;
    }
  }
  for (const payload of payloads) out.bytesFrom(payload);
  return out.toUint8Array();
}

/** Lookup types: 2 positions a pair, 9 wraps another type behind a wide offset. */
const PAIR_POS = 2;
const EXTENSION = 9;

/**
 * How much one PairPos format 1 subtable may hold.
 *
 * Its offsets to the pair sets and to the coverage are sixteen bits and are
 * measured from the start of the subtable, so a list long enough runs past
 * what they can address. Split rather than truncated, and a real font splits
 * for the same reason -- Inter writes its individual pairs as two subtables
 * where one would have been over the limit.
 */
const MOST_PAIR_BYTES = 60_000;

function splitPairs(pairs: ResolvedPair[]): ResolvedPair[][] {
  if (pairs.length === 0) return [];
  const byFirst = new Map<number, ResolvedPair[]>();
  for (const pair of pairs) {
    const list = byFirst.get(pair.left);
    if (list) list.push(pair);
    else byFirst.set(pair.left, [pair]);
  }

  const chunks: ResolvedPair[][] = [];
  let chunk: ResolvedPair[] = [];
  // Header and coverage grow with the number of distinct first glyphs; the
  // pair sets grow with the pairs themselves.
  let size = 10;
  for (const [, list] of [...byFirst].sort((a, b) => a[0] - b[0])) {
    const cost = 6 + list.length * 4;
    if (chunk.length > 0 && size + cost > MOST_PAIR_BYTES) {
      chunks.push(chunk);
      chunk = [];
      size = 10;
    }
    chunk.push(...list);
    size += cost;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
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

/** A grid of left classes against right classes, ready to be written. */
interface Grid {
  /** Glyph ids in each left class, in class order starting at 1. */
  left: number[][];
  right: number[][];
  /** Value at `${leftClass},${rightClass}`, both one-based. */
  cells: Map<string, number>;
}

/**
 * How many cells one subtable may hold.
 *
 * The offsets to the coverage and the two class definitions are sixteen bits
 * and they are measured from the start of the subtable, which the value array
 * sits at the front of. Two bytes a cell, so a grid past about thirty-two
 * thousand cells would push those offsets past what they can hold and write a
 * table that points at nothing. Well under it, and a grid that reaches it is
 * split rather than truncated.
 */
const MOST_CELLS = 28_000;

/**
 * Gather a lookup's class kerns into as few grids as they will go into.
 *
 * The reason this is not simply one subtable per class kern -- which is what it
 * used to be -- is that a subtable claims every glyph its coverage names.
 * Once a lookup has matched a left glyph it is finished with it, so a second
 * subtable covering the same glyph is never reached. Written one per class,
 * an A kerned against a V and also against a T kept the first and silently
 * lost the second, and the same held for every letter that kerns against more
 * than one thing, which is all of them.
 *
 * A grid has no such problem: one subtable, one coverage, and a value for
 * every combination of left class and right class. So the classes are packed
 * back into grids, which is the shape they had in the font they came from.
 * Two classes can share a grid when their left sets are the same set or have
 * no glyph in common, and likewise on the right. Anything that conflicts
 * starts another grid -- and a conflict is real, not a limitation here: two
 * classes in one lookup disagreeing about one pair is a font saying two things
 * at once.
 */
function assembleGrids(classKerns: ResolvedClassKern[]): Grid[] {
  interface Building {
    left: Map<string, number>;
    right: Map<string, number>;
    leftClaimed: Set<number>;
    rightClaimed: Set<number>;
    leftSets: number[][];
    rightSets: number[][];
    cells: Map<string, number>;
  }

  const building: Building[] = [];
  const keyOf = (glyphs: number[]): string => glyphs.join(",");

  for (const classKern of classKerns) {
    const left = [...new Set(classKern.left)].sort((a, b) => a - b);
    const right = [...new Set(classKern.right)].sort((a, b) => a - b);
    const leftKey = keyOf(left);
    const rightKey = keyOf(right);

    let placed = false;
    for (const grid of building) {
      const leftClass = grid.left.get(leftKey);
      const rightClass = grid.right.get(rightKey);
      // A set already here can be reused. A new one may only join if no glyph
      // of it is spoken for, or the classes would overlap and a glyph would
      // have to be in two at once.
      if (leftClass === undefined && left.some((glyph) => grid.leftClaimed.has(glyph))) continue;
      if (rightClass === undefined && right.some((glyph) => grid.rightClaimed.has(glyph))) continue;

      const nextLeft = leftClass ?? grid.leftSets.length + 1;
      const nextRight = rightClass ?? grid.rightSets.length + 1;
      if ((nextLeft + 1) * (nextRight + 1) > MOST_CELLS) continue;
      if (grid.cells.has(`${nextLeft},${nextRight}`)) continue;

      if (leftClass === undefined) {
        grid.left.set(leftKey, nextLeft);
        grid.leftSets.push(left);
        for (const glyph of left) grid.leftClaimed.add(glyph);
      }
      if (rightClass === undefined) {
        grid.right.set(rightKey, nextRight);
        grid.rightSets.push(right);
        for (const glyph of right) grid.rightClaimed.add(glyph);
      }
      grid.cells.set(`${nextLeft},${nextRight}`, classKern.value);
      placed = true;
      break;
    }

    if (!placed) {
      building.push({
        left: new Map([[leftKey, 1]]),
        right: new Map([[rightKey, 1]]),
        leftClaimed: new Set(left),
        rightClaimed: new Set(right),
        leftSets: [left],
        rightSets: [right],
        cells: new Map([["1,1", classKern.value]]),
      });
    }
  }

  return building.map((grid) => ({
    left: grid.leftSets,
    right: grid.rightSets,
    cells: grid.cells,
  }));
}

/**
 * PairPos format 2: a value per (left class, right class) cell.
 *
 * Class 0 means "everything not otherwise listed", so the grid is one row and
 * one column bigger than the class lists and those extra cells hold zero.
 */
function buildPairPosFormat2(grid: Grid): Uint8Array {
  const class1Count = grid.left.length + 1;
  const class2Count = grid.right.length + 1;

  const coverage = buildCoverage([...new Set(grid.left.flat())].sort((a, b) => a - b));
  const classDef1 = buildClassDef(grid.left);
  const classDef2 = buildClassDef(grid.right);

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
  for (let first = 0; first < class1Count; first++) {
    for (let second = 0; second < class2Count; second++) {
      out.int16(clampInt16(grid.cells.get(`${first},${second}`) ?? 0));
    }
  }
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

/**
 * ClassDef format 2: ranges of glyph ids that share a class value.
 *
 * Ranges have to be written in glyph order across all the classes, not class
 * by class, because a reader walks them expecting that -- so every glyph is
 * paired with its class first and the whole lot sorted before any range is
 * closed.
 */
function buildClassDef(classes: number[][]): Uint8Array {
  const assigned: Array<[number, number]> = [];
  for (const [index, glyphs] of classes.entries()) {
    for (const glyph of glyphs) assigned.push([glyph, index + 1]);
  }
  assigned.sort((a, b) => a[0] - b[0]);

  const ranges: Array<{ start: number; end: number; value: number }> = [];
  for (const [glyph, value] of assigned) {
    const last = ranges[ranges.length - 1];
    if (last && last.value === value && glyph === last.end + 1) last.end = glyph;
    else if (!last || glyph !== last.end) ranges.push({ start: glyph, end: glyph, value });
  }

  const writer = new ByteWriter();
  writer.uint16(2).uint16(ranges.length);
  for (const range of ranges) {
    writer.uint16(range.start).uint16(range.end).uint16(range.value);
  }
  return writer.toUint8Array();
}

function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}
