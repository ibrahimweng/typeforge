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
      ...assembleGrids(group.classes).flatMap(fitGrid).map(buildPairPosFormat2),
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
      lookup.uint16(offset16(cursor));
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
  for (const offset of lookupOffsets) out.uint16(offset16(offset));

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

/** The furthest a sixteen-bit offset can reach. */
const MOST_OFFSET = 0xffff;

/**
 * An offset that is about to be written into sixteen bits, checked first.
 *
 * The writer stores the low sixteen bits of whatever it is handed, so an
 * offset one past the limit does not fail: it wraps, and the table points
 * into the middle of its own data. That is how the Soft Serif shipped with no
 * kerning at all -- its class grid put the right-hand class definition at
 * 66,218 bytes, the field held 682, fontTools read a class definition of
 * format 0 there and HarfBuzz threw the whole lookup away. Everything above
 * is laid out so no offset comes near the limit, and this makes sure of it:
 * a table that cannot be written correctly is refused rather than written
 * wrong.
 */
function offset16(value: number): number {
  if (value > MOST_OFFSET) {
    throw new RangeError(`A kerning offset of ${value} bytes does not fit in sixteen bits`);
  }
  return value;
}

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
    if (!fitsAlone(list.length)) {
      // Closes what came before, and each piece is a subtable of its own: two
      // pieces of one glyph in one subtable would be one pair set again.
      if (chunk.length > 0) chunks.push(chunk);
      chunks.push(...piecesOf(list));
      chunk = [];
      size = 10;
      continue;
    }
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

/**
 * Whether one glyph's pairs fit a subtable of their own.
 *
 * Alone, the coverage sits after a ten-byte header, one pair set offset and a
 * pair set of two bytes and four a pair, and its offset is the field that
 * runs out first. Sixteen thousand three hundred and eighty pairs for one
 * glyph is far past anything a font kerns, but a list that long cannot be
 * cut short, so it is checked rather than assumed.
 */
function fitsAlone(pairs: number): boolean {
  return 10 + 2 + 2 + pairs * 4 <= MOST_OFFSET;
}

/**
 * One glyph's pairs, cut into lists that each fit a subtable alone.
 *
 * A list of pairs that does not hold a pair lets it fall through to the next
 * subtable, so one glyph's pairs spread over several subtables in a row kern
 * exactly as they would in one. Cut in second-glyph order, and never between
 * two entries for the same second glyph, so whichever of them answered in one
 * list still answers.
 */
function piecesOf(list: ResolvedPair[]): ResolvedPair[][] {
  const sorted = [...list].sort((a, b) => a.right - b.right);
  const pieces: ResolvedPair[][] = [];
  let start = 0;
  while (start < sorted.length) {
    let end = start;
    while (end < sorted.length && fitsAlone(end - start + 1)) end++;
    if (end < sorted.length) {
      let cut = end;
      while (cut > start && sorted[cut].right === sorted[cut - 1].right) cut--;
      // A run of one second glyph longer than a subtable can hold has nowhere
      // to be cut, and is cut where it must be.
      if (cut > start) end = cut;
    }
    pieces.push(sorted.slice(start, end));
    start = end;
  }
  return pieces;
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
  out.uint16(offset16(coverageOffset));
  out.uint16(0x0004); // valueFormat1: XAdvance only
  out.uint16(0); // valueFormat2: nothing on the second glyph
  out.uint16(firstGlyphs.length);
  for (const offset of pairSetOffsets) out.uint16(offset16(offset));
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
 * A ceiling on the cell a class kern lands in while the grids are packed.
 *
 * It was meant to keep a grid inside what its subtable can address, and it
 * does not: it is tested against the classes of the kern being placed, not
 * against the size the grid has grown to, so a grid of 183 left classes by
 * 172 right ones -- 31,476 cells -- passed it one placement at a time. It is
 * kept because it decides how grids are packed, and changing it would change
 * the bytes of every font whose kerning already fits. What actually keeps a
 * subtable inside its offsets is `fitGrid`, which measures the grid as it will
 * be written.
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
 * A grid as one or more grids that each fit a subtable, kerning the same.
 *
 * A grid that fits is handed back untouched, so a font whose kerning already
 * fitted writes exactly the bytes it did. One that does not is cut by rows:
 * runs of left classes, in order, each run its own subtable with only the
 * right classes its rows kern against. This is what fontTools does with a
 * grid too big for its offsets, and the reason it is safe is the rule
 * `assembleGrids` is built around: a grid answers for every left glyph its
 * coverage names, and only those. Every left glyph is in exactly one row, so
 * it is covered by exactly one of the pieces, which stand where the grid stood
 * -- whatever came before the grid in its lookup still comes first, whatever
 * came after is still reached only by glyphs the grid did not cover, and a
 * row's own cells are all still there. The right classes a run leaves out are
 * the ones all its cells hold zero for, and a glyph in no class of the piece
 * reads class zero, which holds zero too.
 *
 * A run is closed when one more row would push the furthest offset past what
 * sixteen bits hold. A row too big to fit even on its own is shared out by its
 * glyphs instead, in `splitRow`.
 */
function fitGrid(grid: Grid): Grid[] {
  if (fitsFormat2(grid.left, grid.right.length)) return [grid];

  // The right classes each row kerns against, by what is actually written.
  const used = grid.left.map((_, index) => {
    const row = index + 1;
    const columns: number[] = [];
    for (let column = 1; column <= grid.right.length; column++) {
      if (clampInt16(grid.cells.get(`${row},${column}`) ?? 0) !== 0) columns.push(column);
    }
    return columns;
  });
  const leftOf = (rows: number[]) => rows.map((row) => grid.left[row - 1]);

  const pieces: Grid[] = [];
  let rows: number[] = [];
  let columns = new Set<number>();
  for (let row = 1; row <= grid.left.length; row++) {
    // A row that kerns against nothing is kept all the same: its glyphs are
    // still covered, and being covered is what stops the lookup at them.
    const wider = new Set([...columns, ...used[row - 1]]);
    if (rows.length > 0 && !fitsFormat2(leftOf([...rows, row]), wider.size)) {
      pieces.push(piece(grid, rows, columns));
      rows = [];
      columns = new Set();
    }
    rows.push(row);
    for (const column of used[row - 1]) columns.add(column);
  }
  if (rows.length > 0) pieces.push(piece(grid, rows, columns));

  // Every piece of more than one row fits, or its last row would have started
  // another. Only a row on its own can still be too big.
  return pieces.flatMap((one) => (fitsFormat2(one.left, one.right.length) ? [one] : splitRow(one)));
}

/**
 * A single row too big for a subtable, as the same row over fewer glyphs.
 *
 * What makes one row too big is a left class of thousands of glyphs, whose
 * coverage and class definition grow with it -- the cells cannot, since
 * `MOST_CELLS` holds a grid to fourteen thousand right classes, and a row of
 * that many cells fits with room to spare. So the class's glyphs are shared
 * out between pieces that each hold the whole row of values: each glyph is
 * still covered once and still reads the same cells. The count per piece
 * assumes the worst class definition, a range for every glyph, so every
 * piece fits whatever ids it is given.
 */
function splitRow(grid: Grid): Grid[] {
  if (grid.left.length !== 1) throw new Error("Only a grid of one row is split by its glyphs");
  const glyphs = grid.left[0];
  // The header and cells, then two bytes a glyph of coverage and six of class
  // definition after their own four-byte headers.
  const room = MOST_OFFSET - 16 - 2 * (grid.right.length + 1) * 2 - 4 - 4;
  const most = Math.floor(room / 8);
  if (most < 1) {
    throw new RangeError(
      `A kerning class against ${grid.right.length} right classes does not fit one subtable`,
    );
  }
  const pieces: Grid[] = [];
  for (let start = 0; start < glyphs.length; start += most) {
    pieces.push({
      left: [glyphs.slice(start, start + most)],
      right: grid.right,
      cells: grid.cells,
    });
  }
  return pieces;
}

/** Some rows of a grid and some of its right classes, renumbered from one. */
function piece(grid: Grid, rows: number[], columns: Set<number>): Grid {
  const kept = [...columns].sort((a, b) => a - b);
  const cells = new Map<string, number>();
  for (const [at, row] of rows.entries()) {
    for (const [now, column] of kept.entries()) {
      const value = grid.cells.get(`${row},${column}`);
      if (value !== undefined) cells.set(`${at + 1},${now + 1}`, value);
    }
  }
  return {
    left: rows.map((row) => grid.left[row - 1]),
    right: kept.map((column) => grid.right[column - 1]),
    cells,
  };
}

/**
 * Where a format 2 subtable's parts go, and the parts themselves.
 *
 * From the left classes and the number of right ones, which is all the layout
 * depends on: the right-hand class definition goes last, so nothing is
 * measured past it.
 */
function layoutFormat2(left: number[][], rightClasses: number) {
  const class1Count = left.length + 1;
  const class2Count = rightClasses + 1;

  const coverage = buildCoverage([...new Set(left.flat())].sort((a, b) => a - b));
  const classDef1 = buildClassDef(left);

  // Each cell holds one int16 because valueFormat1 is XAdvance and
  // valueFormat2 is empty.
  const gridSize = class1Count * class2Count * 2;
  const headerSize = 16;
  const coverageOffset = headerSize + gridSize;
  const classDef1Offset = coverageOffset + coverage.length;
  const classDef2Offset = classDef1Offset + classDef1.length;
  return {
    class1Count,
    class2Count,
    coverage,
    classDef1,
    coverageOffset,
    classDef1Offset,
    classDef2Offset,
  };
}

/**
 * Whether every offset a grid's subtable needs fits sixteen bits.
 *
 * The right-hand class definition is written last, so its offset is the
 * furthest and the only one that needs asking about; the definition itself
 * may run on past the limit, since nothing points past its start.
 */
function fitsFormat2(left: number[][], rightClasses: number): boolean {
  return layoutFormat2(left, rightClasses).classDef2Offset <= MOST_OFFSET;
}

/**
 * PairPos format 2: a value per (left class, right class) cell.
 *
 * Class 0 means "everything not otherwise listed", so the grid is one row and
 * one column bigger than the class lists and those extra cells hold zero.
 */
function buildPairPosFormat2(grid: Grid): Uint8Array {
  const {
    class1Count,
    class2Count,
    coverage,
    classDef1,
    coverageOffset,
    classDef1Offset,
    classDef2Offset,
  } = layoutFormat2(grid.left, grid.right.length);
  const classDef2 = buildClassDef(grid.right);

  const out = new ByteWriter();
  out.uint16(2); // posFormat
  out.uint16(offset16(coverageOffset));
  out.uint16(0x0004); // valueFormat1: XAdvance
  out.uint16(0); // valueFormat2
  out.uint16(offset16(classDef1Offset));
  out.uint16(offset16(classDef2Offset));
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
