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
 * It wrote that one shape of rule and nothing else, because that is the shape a
 * join needs and a line of a binary format that nothing exercises is a line
 * that is wrong and nobody knows it. Which left the commonest thing a font does
 * out: an `f` and an `i` that become `fi`. That is a different lookup -- many
 * glyphs into one, rather than one redrawn where its neighbours match -- and it
 * belongs to a different feature, so the writer had to learn both.
 *
 * Three shapes now, and still no backtrack and no lookahead:
 *
 *   - a **ligature**: this run of glyphs becomes this one glyph (`liga`)
 *   - a **set**: this glyph becomes that one, wherever it stands (`ss01`…)
 *   - a **context**: this sequence, with some positions redrawn (`calt`)
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

/**
 * A run of glyphs that is drawn as one.
 *
 * `components` is what has to appear, in order, and `ligature` is what they
 * become. Two components at least: a "ligature" of one glyph is a set, and the
 * format has a cheaper lookup for that.
 */
export interface Ligature {
  components: number[];
  ligature: number;
}

/** One glyph for another, wherever it stands, under a tag somebody switches on. */
export interface GlyphSet {
  /** The four-character feature tag: `ss01`, `salt`, `smcp`. */
  tag: string;
  swaps: Swap[];
}

/**
 * Everything the font has to say about substitution, by the feature it goes in.
 *
 * Kept apart rather than in one list because a feature is not decoration: it is
 * which lookups fire and when. `liga` and `calt` are both on by default and a
 * shaper applies them in order; `ss01` fires only where a person asked for it.
 * Putting them in one feature -- which is what this did while `calt` was the
 * only one -- makes every stylistic alternate mandatory and every ligature
 * conditional, either of which is a broken font.
 */
export interface Features {
  ligatures?: Ligature[];
  contextual?: ChainRule[];
  sets?: GlyphSet[];
}

/** Lookup type 1: one glyph becomes one other glyph. */
const SINGLE = 1;
/** Lookup type 4: a run of glyphs becomes one. */
const LIGATURE = 4;
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
 * The ligature substitution: a run of glyphs becomes one.
 *
 * Two things here are easy to get wrong and neither shows as a broken file.
 *
 * **Longest first.** A shaper walks the ligatures for a first glyph in the
 * order they are written and takes the first that matches. Write `ff` before
 * `ffi` and `ffi` can never fire: the `ff` matches, the shaper carries on from
 * after it, and the `i` is left standing. The font opens, recompiles, and
 * quietly has no `ffi` in it. So they are sorted by length, longest first,
 * here rather than asked for in that order.
 *
 * **The first glyph is counted but not stored.** `componentCount` includes it;
 * `componentGlyphIDs` starts at the second. Store all of them and every
 * ligature swallows one glyph too many.
 *
 * The sets are written in coverage order, which is glyph id order, because the
 * shaper finds a set by the index its first glyph has in the coverage table.
 * Insertion order works right up until the first time somebody makes `fi`
 * after `ti`.
 */
function ligatureSubst(ligatures: Ligature[]): Uint8Array {
  const byFirst = new Map<number, Ligature[]>();
  for (const one of ligatures) {
    const first = one.components[0];
    const set = byFirst.get(first);
    if (set) set.push(one);
    else byFirst.set(first, [one]);
  }
  const firsts = [...byFirst.keys()].sort((one, other) => one - other);

  const sets: Uint8Array[] = firsts.map((first) => {
    const sorted = [...byFirst.get(first)!].sort(
      (one, other) => other.components.length - one.components.length,
    );
    const records = sorted.map((one) => {
      const record = new ByteWriter();
      record.uint16(one.ligature);
      record.uint16(one.components.length);
      for (const component of one.components.slice(1)) record.uint16(component);
      return record.toUint8Array();
    });
    const out = new ByteWriter();
    out.uint16(records.length);
    let cursor = 2 + records.length * 2;
    for (const record of records) {
      out.uint16(cursor);
      cursor += record.length;
    }
    for (const record of records) out.bytesFrom(record);
    return out.toUint8Array();
  });

  const cover = coverage(firsts);
  const header = 2 + 2 + 2 + sets.length * 2;
  const out = new ByteWriter();
  out.uint16(1); // substFormat 1
  out.uint16(header + sets.reduce((total, one) => total + one.length, 0)); // coverageOffset
  out.uint16(sets.length);
  let cursor = header;
  for (const one of sets) {
    out.uint16(cursor);
    cursor += one.length;
  }
  for (const one of sets) out.bytesFrom(one);
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
 * A feature's four bytes, checked rather than trusted.
 *
 * A tag is exactly four characters of ASCII and shorter ones are padded with
 * spaces -- `kern` and `aalt` are four, `salt` is four, and a two-letter tag
 * somebody typed would otherwise write two bytes and shift every offset in the
 * table after it.
 */
function tagBytes(tag: string): number[] {
  const padded = `${tag}    `.slice(0, 4);
  return [...padded].map((one) => one.charCodeAt(0) & 0x7f);
}

/** One feature: its tag and the lookups it fires, in the order they were built. */
interface Feature {
  tag: string;
  lookups: number[];
}

/**
 * The feature list, in the order the format insists on.
 *
 * Records are sorted alphabetically by tag. The specification requires it and
 * nothing enforces it: a list written in the order the features happened to be
 * built opens, recompiles, and is read wrongly by anything that binary-searches
 * it -- which is what a shaper does, because it is what it is allowed to do.
 */
function featureList(features: Feature[]): Uint8Array {
  const sorted = [...features].sort((one, other) => (one.tag < other.tag ? -1 : 1));
  const tables = sorted.map((feature) => {
    const out = new ByteWriter();
    out.uint16(0); // featureParamsOffset: none
    out.uint16(feature.lookups.length);
    for (const index of feature.lookups) out.uint16(index);
    return out.toUint8Array();
  });

  const out = new ByteWriter();
  out.uint16(sorted.length);
  let cursor = 2 + sorted.length * 6;
  for (let index = 0; index < sorted.length; index++) {
    for (const byte of tagBytes(sorted[index].tag)) out.uint8(byte);
    out.uint16(cursor);
    cursor += tables[index].length;
  }
  for (const table of tables) out.bytesFrom(table);
  return out.toUint8Array();
}

/**
 * The script list: DFLT/dflt, so every feature applies whatever the text is
 * tagged as.
 *
 * The language system names every feature by index. It named one while there
 * was one, which is the kind of constant that goes wrong the moment a second
 * arrives: the extra features would be in the file, correct, and unreachable.
 */
function scriptList(count: number): Uint8Array {
  const out = new ByteWriter();
  out.uint16(1); // scriptCount
  for (const byte of tagBytes("DFLT")) out.uint8(byte);
  out.uint16(8); // offset to the script table
  out.uint16(4).uint16(0); // defaultLangSys at +4, no other languages
  out.uint16(0).uint16(0xffff); // no lookupOrder, no required feature
  out.uint16(count);
  for (let index = 0; index < count; index++) out.uint16(index);
  return out.toUint8Array();
}

/** A ligature has to have something to join: two glyphs at least, all real. */
const usableLigature = (one: Ligature): boolean =>
  one.components.length >= 2 && one.components.every((id) => Number.isInteger(id) && id >= 0);

/**
 * A context rule that can match and can do something where it does.
 *
 * A rule with an empty position matches nothing; one with no swaps changes
 * nothing; one pointing past its own sequence asks a shaper to substitute a
 * glyph it never matched, which the specification calls undefined and which in
 * practice is a font that crashes something.
 */
const usableChain = (rule: ChainRule): boolean =>
  rule.input.length > 0 &&
  rule.input.every((one) => one.length > 0) &&
  rule.swaps.length > 0 &&
  rule.swaps.every((one) => one.swap.length > 0 && one.at < rule.input.length);

/**
 * The table, or nothing if there is nothing to say.
 *
 * Every feature gets its own lookups and its own entry, and the substitutions a
 * chain reaches are deliberately left out of every feature: a lookup invoked
 * from a chain must not also fire on its own, or every letter in the font is
 * replaced by its alternate wherever it stands.
 *
 * `liga` and `calt` are on by default -- a ligature nobody asked for is the
 * point of a ligature, and a join is not a flourish: a script whose letters do
 * not meet is a broken script. A set is not on by default and has to be asked
 * for by tag, which is what makes it a choice rather than the face.
 */
export function buildGsubTable(features: Features): Uint8Array | null {
  const lookups: Uint8Array[] = [];
  const built: Feature[] = [];

  const ligatures = (features.ligatures ?? []).filter(usableLigature);
  if (ligatures.length > 0) {
    built.push({ tag: "liga", lookups: [lookups.length] });
    lookups.push(lookup(LIGATURE, ligatureSubst(ligatures)));
  }

  for (const set of features.sets ?? []) {
    const swaps = set.swaps.filter((one) => one.plain !== one.alternate);
    if (swaps.length === 0) continue;
    built.push({ tag: set.tag, lookups: [lookups.length] });
    lookups.push(lookup(SINGLE, singleSubst(swaps)));
  }

  const chains: number[] = [];
  for (const rule of (features.contextual ?? []).filter(usableChain)) {
    const records: Array<[number, number]> = [];
    for (const position of rule.swaps) {
      records.push([position.at, lookups.length]);
      lookups.push(lookup(SINGLE, singleSubst(position.swap)));
    }
    chains.push(lookups.length);
    lookups.push(lookup(CHAIN, chainContext(rule.input.map(coverage), records)));
  }
  if (chains.length > 0) built.push({ tag: "calt", lookups: chains });

  if (built.length === 0) return null;

  const scriptBytes = scriptList(built.length);
  const featureBytes = featureList(built);
  const lookupBytes = lookupList(lookups);

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
