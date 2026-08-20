/**
 * Reading kerning out of GPOS.
 *
 * The library we import outlines with surfaces kerning only where a font
 * stores it pair by pair, and no font made this century does. Every one of
 * them uses class kerning -- PairPos format 2, a grid of left classes against
 * right classes -- because a face with a thousand glyphs has far too many
 * useful pairs to write out one at a time. Which meant that until this
 * existed, opening a real font read every outline correctly and quietly
 * dropped all of its kerning: Inter, Roboto, Lora and Playfair between them
 * carry two hundred kilobytes of GPOS and gave up nought pairs.
 *
 * So this reads the table. Only the kerning out of it -- GPOS also carries
 * mark attachment, cursive joining and a good deal else, none of which this
 * application has anywhere to put -- and it reads it as classes rather than
 * expanding them, because expanding is what makes it impossible: a hundred
 * left classes against a hundred right ones is ten thousand cells, and the
 * cells stand for millions of pairs.
 *
 * The whole thing is offsets into a byte array, and every offset is relative
 * to a different place. That is not a criticism of the format, it is how it
 * stays compact, but it is the reason every function here takes the base it
 * counts from as an argument rather than assuming one.
 */

import type { KernClass, KernPair } from "./types";

// ---------------------------------------------------------------------------
// What comes out
// ---------------------------------------------------------------------------

/**
 * Kerning as the font stores it, in glyph ids.
 *
 * The nesting is the format's and it carries meaning, so it is kept rather
 * than flattened. A feature names several lookups and every one of them is
 * applied, so their adjustments add up. A lookup holds several subtables and
 * only the first that matches is used, so their order decides which value a
 * pair gets. Flattening either of those loses kerning: a real font puts its
 * individual pairs in one subtable and its class grid in the next, precisely
 * so the specific pair wins over the class default.
 */
export interface GposKerning {
  /** In order. Every one is applied, and their adjustments add up. */
  lookups: KernLookup[];
}

export interface KernLookup {
  /** In order. The first that matches decides, and the rest are not consulted. */
  subtables: KernSubtable[];
}

/**
 * A subtable, and what it takes for one to match.
 *
 * The two kinds differ in that, and the difference is the whole reason the
 * order works. A list of pairs matches only when it holds the exact pair, so a
 * left glyph it knows nothing useful about falls through to the next subtable.
 * A grid matches on the left glyph alone, so once a glyph is covered the
 * lookup is finished with it whether the cell holds a value or a zero.
 */
export type KernSubtable =
  | { kind: "pairs"; values: Map<number, Map<number, number>> }
  | ({ kind: "grid" } & KernGrid);

export interface KernGrid {
  /** Glyph ids in each left class, by class number. */
  left: Map<number, number[]>;
  /** Glyph ids in each right class, by class number. */
  right: Map<number, number[]>;
  /** The value at (leftClass, rightClass), where it is not zero. */
  cells: Map<string, number>;
  /** Which left class a glyph is in. For asking about one pair. */
  leftOf: Map<number, number>;
  rightOf: Map<number, number>;
  /**
   * Which glyphs the subtable covers at all.
   *
   * Class zero means "everything not in another class", so without this a
   * grid would claim to know about every glyph in the font. Coverage is what
   * says which ones it was actually written for.
   */
  covered: Set<number>;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Every kerning value the table holds.
 *
 * Returns nothing rather than throwing on a table that does not make sense.
 * A font with a damaged GPOS is still a font worth opening, and losing its
 * kerning is a far better outcome than refusing the file.
 */
export function readGposKerning(table: Uint8Array): GposKerning {
  const empty: GposKerning = { lookups: [] };
  try {
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    if (table.byteLength < 10) return empty;

    const featureListOffset = view.getUint16(6);
    const lookupListOffset = view.getUint16(8);

    const wanted = kerningLookups(view, featureListOffset);
    if (wanted.size === 0) return empty;

    const lookups: KernLookup[] = [];
    const lookupCount = view.getUint16(lookupListOffset);
    // In index order, because that is the order they are applied in and the
    // order decides what a pair ends up with.
    for (const index of [...wanted].sort((a, b) => a - b)) {
      if (index >= lookupCount) continue;
      const lookupOffset = lookupListOffset + view.getUint16(lookupListOffset + 2 + index * 2);
      const subtables: KernSubtable[] = [];
      readLookup(view, lookupOffset, subtables);
      if (subtables.length > 0) lookups.push({ subtables });
    }
    return { lookups };
  } catch {
    return empty;
  }
}

/**
 * Which lookups the `kern` feature points at.
 *
 * Going through the feature list rather than taking every pair-positioning
 * lookup in the file. They are not the same thing: a font can position pairs
 * for reasons that are not kerning, and applying those as kerning would move
 * letters for reasons nobody asked about.
 */
function kerningLookups(view: DataView, featureListOffset: number): Set<number> {
  const wanted = new Set<number>();
  const count = view.getUint16(featureListOffset);
  for (let index = 0; index < count; index++) {
    const record = featureListOffset + 2 + index * 6;
    const tag = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    );
    if (tag !== "kern") continue;
    const feature = featureListOffset + view.getUint16(record + 4);
    const lookupCount = view.getUint16(feature + 2);
    for (let slot = 0; slot < lookupCount; slot++) {
      wanted.add(view.getUint16(feature + 4 + slot * 2));
    }
  }
  return wanted;
}

/** Lookup types this cares about. 2 is pair positioning; 9 wraps another type. */
const PAIR_POS = 2;
const EXTENSION = 9;

function readLookup(view: DataView, offset: number, into: KernSubtable[]): void {
  const type = view.getUint16(offset);
  const subtableCount = view.getUint16(offset + 4);

  for (let index = 0; index < subtableCount; index++) {
    const subtable = offset + view.getUint16(offset + 6 + index * 2);
    if (type === PAIR_POS) {
      readPairPos(view, subtable, into);
    } else if (type === EXTENSION) {
      // An extension wraps one real lookup so a large table can use 32-bit
      // offsets. Only a pair-positioning one is of any interest here; the
      // chained contextual kerning some faces also carry has nowhere to go in
      // this application and is passed over.
      const wrappedType = view.getUint16(subtable + 2);
      const wrapped = subtable + view.getUint32(subtable + 4);
      if (wrappedType === PAIR_POS) readPairPos(view, wrapped, into);
    }
  }
}

/** How many bytes a value record takes: two for each bit set in its format. */
function valueSize(format: number): number {
  let bytes = 0;
  for (let bit = 0; bit < 8; bit++) if (format & (1 << bit)) bytes += 2;
  return bytes;
}

/**
 * The horizontal advance out of a value record.
 *
 * Bit 0x0004 is X_ADVANCE and the fields appear in bit order, so its position
 * is decided by how many lower bits are set. Everything else in the record --
 * placement, and the device tables that adjust it at particular pixel sizes --
 * has nowhere to go in this application and is skipped.
 */
function xAdvance(view: DataView, at: number, format: number): number {
  if (!(format & 0x0004)) return 0;
  let ahead = 0;
  if (format & 0x0001) ahead += 2;
  if (format & 0x0002) ahead += 2;
  return view.getInt16(at + ahead);
}

function readPairPos(view: DataView, offset: number, into: KernSubtable[]): void {
  const format = view.getUint16(offset);
  const coverageOffset = offset + view.getUint16(offset + 2);
  const valueFormat1 = view.getUint16(offset + 4);
  const valueFormat2 = view.getUint16(offset + 6);
  const size1 = valueSize(valueFormat1);
  const size2 = valueSize(valueFormat2);

  if (format === 1) {
    const covered = readCoverage(view, coverageOffset);
    const pairSetCount = view.getUint16(offset + 8);
    const values = new Map<number, Map<number, number>>();
    for (let index = 0; index < pairSetCount && index < covered.length; index++) {
      const left = covered[index];
      const pairSet = offset + view.getUint16(offset + 10 + index * 2);
      const pairCount = view.getUint16(pairSet);
      const stride = 2 + size1 + size2;
      const row = new Map<number, number>();
      for (let slot = 0; slot < pairCount; slot++) {
        const record = pairSet + 2 + slot * stride;
        row.set(view.getUint16(record), xAdvance(view, record + 2, valueFormat1));
      }
      if (row.size > 0) values.set(left, row);
    }
    if (values.size > 0) into.push({ kind: "pairs", values });
    return;
  }

  if (format !== 2) return;

  const classDef1 = offset + view.getUint16(offset + 8);
  const classDef2 = offset + view.getUint16(offset + 10);
  const class1Count = view.getUint16(offset + 12);
  const class2Count = view.getUint16(offset + 14);

  const covered = new Set(readCoverage(view, coverageOffset));
  const leftOf = readClassDef(view, classDef1);
  const rightOf = readClassDef(view, classDef2);

  const cells = new Map<string, number>();
  const stride = size1 + size2;
  const base = offset + 16;
  for (let first = 0; first < class1Count; first++) {
    for (let second = 0; second < class2Count; second++) {
      const record = base + (first * class2Count + second) * stride;
      const value = xAdvance(view, record, valueFormat1);
      if (value !== 0) cells.set(`${first},${second}`, value);
    }
  }
  if (cells.size === 0) return;

  into.push({
    kind: "grid",
    left: byClass(leftOf),
    right: byClass(rightOf),
    cells,
    leftOf,
    rightOf,
    covered,
  });
}

function byClass(of: Map<number, number>): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  for (const [glyph, klass] of of) {
    const list = groups.get(klass);
    if (list) list.push(glyph);
    else groups.set(klass, [glyph]);
  }
  return groups;
}

/** The glyph ids a subtable applies to, in coverage order. */
function readCoverage(view: DataView, offset: number): number[] {
  const format = view.getUint16(offset);
  const glyphs: number[] = [];
  if (format === 1) {
    const count = view.getUint16(offset + 2);
    for (let index = 0; index < count; index++) glyphs.push(view.getUint16(offset + 4 + index * 2));
  } else if (format === 2) {
    const count = view.getUint16(offset + 2);
    for (let index = 0; index < count; index++) {
      const record = offset + 4 + index * 6;
      const start = view.getUint16(record);
      const end = view.getUint16(record + 2);
      for (let glyph = start; glyph <= end; glyph++) glyphs.push(glyph);
    }
  }
  return glyphs;
}

/**
 * Which class each glyph belongs to.
 *
 * Only the glyphs a class definition names. Everything else is class zero by
 * definition, and writing out an entry for every glyph in the font to say so
 * would be a map the size of the font for no information at all.
 */
function readClassDef(view: DataView, offset: number): Map<number, number> {
  const of = new Map<number, number>();
  const format = view.getUint16(offset);
  if (format === 1) {
    const start = view.getUint16(offset + 2);
    const count = view.getUint16(offset + 4);
    for (let index = 0; index < count; index++) {
      const klass = view.getUint16(offset + 6 + index * 2);
      if (klass !== 0) of.set(start + index, klass);
    }
  } else if (format === 2) {
    const count = view.getUint16(offset + 2);
    for (let index = 0; index < count; index++) {
      const record = offset + 4 + index * 6;
      const start = view.getUint16(record);
      const end = view.getUint16(record + 2);
      const klass = view.getUint16(record + 4);
      if (klass === 0) continue;
      for (let glyph = start; glyph <= end; glyph++) of.set(glyph, klass);
    }
  }
  return of;
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

/**
 * What the font kerns this one pair by.
 *
 * The cheap way to use a grid, and the one the library wants: borrowing the
 * rhythm of a face for an alphabet means asking about a few thousand pairs,
 * not unfolding a table that stands for millions.
 *
 * The two loops are the format's own rule and not an implementation detail.
 * Every lookup gets a say and their answers add up; inside a lookup the first
 * subtable that matches is the only one consulted. Checked against HarfBuzz on
 * four faces and eighty pairs, which is the only way to be sure of a rule of
 * this kind.
 */
export function kernBetween(kerning: GposKerning, left: number, right: number): number {
  let total = 0;
  for (const lookup of kerning.lookups) {
    for (const subtable of lookup.subtables) {
      if (subtable.kind === "pairs") {
        // A list of pairs only matches when it holds this exact pair. A left
        // glyph it has nothing to say about falls through to the next
        // subtable, which is what lets a class grid stand behind it.
        const value = subtable.values.get(left)?.get(right);
        if (value === undefined) continue;
        total += value;
        break;
      }
      // A grid matches on the left glyph alone. Class zero is "anything
      // else", so a glyph with no class of its own still kerns -- but only if
      // this subtable was written for it, which is what coverage says.
      if (!subtable.covered.has(left)) continue;
      total +=
        subtable.cells.get(
          `${subtable.leftOf.get(left) ?? 0},${subtable.rightOf.get(right) ?? 0}`,
        ) ?? 0;
      break;
    }
  }
  return total;
}

/**
 * Every individual pair the font wrote out, with the lookup it was written in.
 *
 * The lookup matters as much as the value. A pair in one lookup and a class
 * covering the same pair in another are two adjustments that add up; put the
 * pair in the same lookup as the class and it overrides it instead. Writing
 * them all back into one lookup applied a font's kerning twice over.
 */
export function writtenPairs(
  kerning: GposKerning,
): Array<{ left: number; right: number; value: number; group: number }> {
  const out: Array<{ left: number; right: number; value: number; group: number }> = [];
  for (const [group, lookup] of kerning.lookups.entries()) {
    for (const subtable of lookup.subtables) {
      if (subtable.kind !== "pairs") continue;
      for (const [left, row] of subtable.values) {
        for (const [right, value] of row) {
          if (value !== 0) out.push({ left, right, value, group });
        }
      }
    }
  }
  return out;
}

/** Every non-zero pair among a limited set of glyphs. */
export function kernPairsAmong(
  kerning: GposKerning,
  glyphs: Array<{ id: number; name: string }>,
): KernPair[] {
  const pairs: KernPair[] = [];
  for (const left of glyphs) {
    for (const right of glyphs) {
      const value = kernBetween(kerning, left.id, right.id);
      if (value !== 0) pairs.push({ left: left.name, right: right.name, value });
    }
  }
  return pairs;
}

/**
 * The grids as the application's own class kerning.
 *
 * For a font on its way into the editor, where the point is to carry the
 * kerning through an edit and back out again rather than to read any
 * particular pair. Kept as classes, because that is the only form that fits.
 *
 * Classes are built once per grid and shared by every cell that names them, so
 * a grid with ten thousand cells holds two hundred arrays rather than twenty
 * thousand.
 */
export function toKernClasses(
  kerning: GposKerning,
  nameOf: (glyph: number) => string | undefined,
): KernClass[] {
  const classes: KernClass[] = [];
  let serial = 0;

  for (const [index, lookup] of kerning.lookups.entries()) {
  for (const grid of lookup.subtables.filter((s) => s.kind === "grid")) {
    const named = new Map<number, string[]>();
    const namesFor = (side: "left" | "right", klass: number): string[] => {
      const key = side === "left" ? klass : klass + 0x10000;
      const kept = named.get(key);
      if (kept) return kept;
      const ids =
        klass === 0
          ? // Class zero is everything the subtable covers that no other class
            // claimed, which is only knowable from the coverage.
            [...grid.covered].filter((glyph) => (side === "left" ? grid.leftOf : grid.rightOf).get(glyph) === undefined)
          : ((side === "left" ? grid.left : grid.right).get(klass) ?? []);
      const list = ids.map(nameOf).filter((name): name is string => Boolean(name));
      named.set(key, list);
      return list;
    };

    for (const [cell, value] of grid.cells) {
      const [first, second] = cell.split(",").map(Number);
      // A right class of zero is every glyph the font has that no class
      // claimed, which is not something coverage can answer -- coverage is
      // about the left side only. Those cells are dropped rather than guessed
      // at, since a wrong answer here moves letters.
      if (second === 0) continue;
      const left = namesFor("left", first);
      const right = namesFor("right", second);
      if (left.length === 0 || right.length === 0) continue;
      classes.push({
        id: `gpos-${serial++}`,
        name: `${first}/${second}`,
        left,
        right,
        value,
        group: index,
      });
    }
  }
  }
  return classes;
}
