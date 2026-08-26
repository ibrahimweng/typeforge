/**
 * Writing GSUB: the table that says a letter is drawn differently here.
 *
 * This half of the application could read a GSUB table and carry it through an
 * export untouched, and could not write one. That was enough while every
 * decision about a letter's shape was a decision about *that* letter -- a
 * single-storey `a`, a barred `seven` -- because a choice like that is made
 * once and drawn into the glyph.
 *
 * A joined script is the first thing here that needs a decision about a *pair*.
 * A written `o` hands over to the letter after it high, near the waist, where an
 * `n` hands over low along the baseline; so do a `v`, a `w` and a `b`. That is
 * not a fact about the `o` and it is not a fact about the letter after it --
 * either one drawn alone is unremarkable, and only the two set together is
 * wrong. An `oa` in a script with a single join height has a kink in the middle
 * of it that no amount of redrawing either letter will take out.
 *
 * The format's answer is a contextual substitution: the font carries second
 * drawings and a rule saying when to use them, and the shaper swaps them in as
 * it lays out the line. That is what this writes.
 *
 * Both halves of the pair are swapped rather than only the second, and that is
 * a decision about what happens when nothing applies the rule. Written the
 * other way -- the `o` always high, the letter after it swapped to match -- a
 * shaper that skipped the feature would leave every one of those pairs joining
 * a high exit to a low entry, which is the broken font this exists to avoid. Do
 * both, and the plain glyphs are a face whose letters all meet at one height:
 * plainer than intended, and correct everywhere.
 *
 * Deliberately narrow. GSUB can express ligatures, alternates a user picks
 * between, many-to-one and one-to-many substitutions and reorderings; this
 * writes one shape of rule -- when this sequence of glyphs appears, redraw some
 * of them -- because that is the shape a join needs, and a line of a binary
 * format that nothing exercises is a line that is wrong and nobody knows it.
 * There is no backtrack and no lookahead here for the same reason.
 */

import { ByteWriter } from "./sfnt";

/** A glyph and the glyph it turns into. */
export interface Swap {
  /** The glyph as it is drawn on its own. */
  plain: number;
  /** The glyph drawn for this context. */
  alternate: number;
}

/** What happens at one position of a matched sequence. */
export interface AtPosition {
  /** Which position, counting from the start of the sequence. */
  at: number;
  /** The swaps that may apply there. A glyph not listed is left alone. */
  swap: Swap[];
}

/**
 * One rule: a sequence of glyph sets, and what changes where it matches.
 *
 * `input` is one set per position -- for a script, the letters that hand over
 * high, then every letter that can receive. `swaps` says which positions are
 * redrawn and into what.
 */
export interface ChainRule {
  input: number[][];
  swaps: AtPosition[];
}

/** Lookup type 1: one glyph becomes one other glyph. */
const SINGLE = 1;
/** Lookup type 6: apply lookups where the glyphs around a position match. */
const CHAIN = 6;

/** A coverage table: which glyphs a lookup applies to, in glyph order. */
function coverage(glyphs: number[]): Uint8Array {
  const sorted = [...new Set(glyphs)].sort((one, other) => one - other);
  const out = new ByteWriter();
  out.uint16(1); // coverageFormat 1: a plain list
  out.uint16(sorted.length);
  for (const glyph of sorted) out.uint16(glyph);
  return out.toUint8Array();
}

/**
 * The single substitution, in the format that lists its replacements.
 *
 * Format 2 rather than format 1, which stores one delta added to every glyph id
 * it covers. A delta is smaller and is no use here: the alternates are appended
 * to the font as they are needed, so the distance from a letter to its own
 * alternate is whatever order they happened to be built in, and it is a
 * different number for every letter.
 */
function singleSubst(swaps: Swap[]): Uint8Array {
  const sorted = [...swaps].sort((one, other) => one.plain - other.plain);
  const cover = coverage(sorted.map((swap) => swap.plain));
  const out = new ByteWriter();
  out.uint16(2); // substFormat 2
  out.uint16(6 + sorted.length * 2); // coverageOffset, past the substitute list
  out.uint16(sorted.length);
  for (const swap of sorted) out.uint16(swap.alternate);
  out.bytesFrom(cover);
  return out.toUint8Array();
}

/**
 * The chaining context, in the format that describes itself by coverage.
 *
 * Format 3 says "one glyph of this set, then one of that set" without
 * enumerating the pairs. The other two formats spell out every sequence, which
 * for twenty-six letters after four others is a hundred and four rules all
 * saying the same thing.
 */
function chainContext(input: Uint8Array[], records: Array<[number, number]>): Uint8Array {
  // backtrackCount, inputCount and one offset each, lookaheadCount,
  // recordCount, and two shorts per record.
  const header = 2 + 2 + 2 + input.length * 2 + 2 + 2 + records.length * 4;
  const out = new ByteWriter();
  out.uint16(3); // substFormat 3
  out.uint16(0); // backtrackGlyphCount
  out.uint16(input.length);
  let cursor = header;
  for (const one of input) {
    out.uint16(cursor);
    cursor += one.length;
  }
  out.uint16(0); // lookaheadGlyphCount
  out.uint16(records.length);
  for (const [position, lookupIndex] of records) {
    out.uint16(position).uint16(lookupIndex);
  }
  for (const one of input) out.bytesFrom(one);
  return out.toUint8Array();
}

/** One lookup, holding one subtable. */
function lookup(type: number, subtable: Uint8Array): Uint8Array {
  const out = new ByteWriter();
  out.uint16(type);
  out.uint16(0); // lookupFlag
  out.uint16(1); // subTableCount
  out.uint16(8); // the subtable follows the header
  out.bytesFrom(subtable);
  return out.toUint8Array();
}

function lookupList(lookups: Uint8Array[]): Uint8Array {
  const out = new ByteWriter();
  out.uint16(lookups.length);
  let cursor = 2 + lookups.length * 2;
  for (const one of lookups) {
    out.uint16(cursor);
    cursor += one.length;
  }
  for (const one of lookups) out.bytesFrom(one);
  return out.toUint8Array();
}

/**
 * The table, or nothing if there is nothing to say.
 *
 * Each rule becomes one chain lookup and one substitution lookup per position
 * that changes. Only the chains go in the feature: a substitution reached from
 * a chain is invoked by that chain and must not also fire on its own, or every
 * letter in the font would be replaced by its alternate wherever it stood.
 */
export function buildGsubTable(rules: ChainRule[]): Uint8Array | null {
  const usable = rules.filter(
    (rule) =>
      rule.input.length > 0 &&
      rule.input.every((one) => one.length > 0) &&
      rule.swaps.length > 0 &&
      rule.swaps.every((one) => one.swap.length > 0 && one.at < rule.input.length),
  );
  if (usable.length === 0) return null;

  const lookups: Uint8Array[] = [];
  const chains: number[] = [];
  for (const rule of usable) {
    const records: Array<[number, number]> = [];
    for (const position of rule.swaps) {
      records.push([position.at, lookups.length]);
      lookups.push(lookup(SINGLE, singleSubst(position.swap)));
    }
    chains.push(lookups.length);
    lookups.push(lookup(CHAIN, chainContext(rule.input.map(coverage), records)));
  }
  const lookupBytes = lookupList(lookups);

  /*
   * `calt` -- contextual alternates -- and on by default, which is the point of
   * it. A join is not a flourish somebody opts into: a script whose letters do
   * not meet is a broken script, so the rule has to fire in any shaper laying
   * out a line without being asked.
   */
  const feature = new ByteWriter();
  feature.uint16(1); // featureCount
  feature.uint8(0x63).uint8(0x61).uint8(0x6c).uint8(0x74); // "calt"
  feature.uint16(8); // offset to the feature table
  feature.uint16(0).uint16(chains.length); // no featureParams
  for (const index of chains) feature.uint16(index);
  const featureBytes = feature.toUint8Array();

  // DFLT/dflt, so the feature applies whatever script the text is tagged as.
  const script = new ByteWriter();
  script.uint16(1); // scriptCount
  script.uint8(0x44).uint8(0x46).uint8(0x4c).uint8(0x54); // "DFLT"
  script.uint16(8); // offset to the script table
  script.uint16(4).uint16(0); // defaultLangSys at +4, no other languages
  script.uint16(0).uint16(0xffff).uint16(1).uint16(0); // LangSys -> feature 0
  const scriptBytes = script.toUint8Array();

  const headerSize = 10;
  const scriptListOffset = headerSize;
  const featureListOffset = scriptListOffset + scriptBytes.length;
  const lookupListOffset = featureListOffset + featureBytes.length;

  const gsub = new ByteWriter();
  gsub.uint16(1).uint16(0); // version 1.0
  gsub.uint16(scriptListOffset).uint16(featureListOffset).uint16(lookupListOffset);
  gsub.bytesFrom(scriptBytes).bytesFrom(featureBytes).bytesFrom(lookupBytes);
  return gsub.toUint8Array();
}
