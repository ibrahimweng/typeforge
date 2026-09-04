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
 *
 * The context now carries backtrack and lookahead, which is the difference
 * between matching a glyph and requiring one. A rule that consumes the space
 * before a word has spent it, and the next rule looking for a space finds none
 * -- so a run of one-letter words came out with only every other one drawn as
 * a word of one.
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
  /**
   * What must stand before the sequence, and after it, without being part of it.
   *
   * The difference between matching a glyph and requiring one. A rule that
   * *consumes* the space before a word has spent it, so the next rule looking
   * for a space finds none -- which is why a run of one-letter words came out
   * with only every other one drawn as a word of one. Required rather than
   * matched, the space is still there for the rule after.
   *
   * Backtrack is written in the order the format wants it, which is *away* from
   * the sequence: the position nearest the input comes first. That is the
   * opposite of how anybody writes it down, so this takes it in reading order
   * and reverses it on the way out -- the one thing about this format that is
   * a genuine trap rather than merely fiddly.
   */
  before?: number[][];
  after?: number[][];
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
function chainContext(
  input: Uint8Array[],
  records: Array<[number, number]>,
  before: Uint8Array[] = [],
  after: Uint8Array[] = [],
): Uint8Array {
  /*
   * The order the three runs are written in is not the order they are read in.
   *
   * The format puts backtrack first, then input, then lookahead -- and the
   * backtrack coverages count *backwards* from the sequence, so the glyph
   * immediately before the match is offset zero. Everything else here counts
   * forwards. Reversing on the way out rather than asking callers to do it
   * keeps the one confusing thing about this format in one place.
   */
  const backtrack = [...before].reverse();
  const all = [...backtrack, ...input, ...after];
  // backtrackCount and one offset each, inputCount and one offset each,
  // lookaheadCount and one offset each, recordCount, two shorts per record.
  const header =
    2 +
    2 +
    backtrack.length * 2 +
    2 +
    input.length * 2 +
    2 +
    after.length * 2 +
    2 +
    records.length * 4;

  const out = new ByteWriter();
  out.uint16(3); // substFormat 3

  let cursor = header;
  const offsets = all.map((one) => {
    const here = cursor;
    cursor += one.length;
    return here;
  });
  let at = 0;

  out.uint16(backtrack.length);
  for (const _ of backtrack) out.uint16(offsets[at++]);
  out.uint16(input.length);
  for (const _ of input) out.uint16(offsets[at++]);
  out.uint16(after.length);
  for (const _ of after) out.uint16(offsets[at++]);

  out.uint16(records.length);
  for (const [position, lookupIndex] of records) {
    out.uint16(position).uint16(lookupIndex);
  }
  for (const one of all) out.bytesFrom(one);
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
  // An empty set in a required run is a run nothing can satisfy, which makes
  // the whole rule dead -- and dead silently, which is worse than absent.
  (rule.before ?? []).every((one) => one.length > 0) &&
  (rule.after ?? []).every((one) => one.length > 0) &&
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
    lookups.push(
      lookup(
        CHAIN,
        chainContext(
          rule.input.map(coverage),
          records,
          (rule.before ?? []).map(coverage),
          (rule.after ?? []).map(coverage),
        ),
      ),
    );
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

// ---------------------------------------------------------------------------
// Reading one back
// ---------------------------------------------------------------------------

/**
 * The ligatures and the sets a font already carries.
 *
 * A font opened here arrived with `alternates: []` and nothing else, so the
 * features panel told a face that plainly draws `fi` that it had no ligatures,
 * and a rebuild export dropped every one of them. Preserve kept them, which is
 * what made it survivable and also what made it invisible: the two halves of
 * the export disagreed and neither said so.
 *
 * Deliberately partial, and it is worth being plain about which part. This
 * reads the two lookup types the document can hold -- 4, a run of glyphs
 * becoming one, and 1, a glyph becoming another -- and ignores the rest.
 * Everything else stays in the source tables and goes back out untouched on a
 * preserve export, which is what that mode is for.
 *
 * Written by hand rather than taken from a library for the same reason the
 * writer was: what it has to agree with is the writer, and a reader that
 * reads back exactly what was written is a claim the tests can hold both ends
 * of. Every offset is bounds-checked, because this is the one place in the
 * application that reads a stranger's bytes.
 */
export interface ReadFeatures {
  /** Ligatures, by the tag they were found under. */
  ligatures: Array<{ tag: string; components: number[]; ligature: number }>;
  /** Single substitutions, by tag. */
  sets: Array<{ tag: string; swaps: Swap[] }>;
}

/** A bounds-checked big-endian reader. Out of range reads as nothing. */
class Bytes {
  constructor(private readonly data: Uint8Array) {}
  u16(at: number): number {
    if (at < 0 || at + 1 >= this.data.length) return -1;
    return (this.data[at] << 8) | this.data[at + 1];
  }
  tag(at: number): string {
    if (at < 0 || at + 3 >= this.data.length) return "";
    return String.fromCharCode(...this.data.subarray(at, at + 4));
  }
  get length(): number {
    return this.data.length;
  }
}

/** Which glyphs a coverage table covers, in the order the format lists them. */
function coveredBy(bytes: Bytes, at: number): number[] {
  const format = bytes.u16(at);
  const out: number[] = [];
  if (format === 1) {
    const count = bytes.u16(at + 2);
    if (count < 0) return out;
    for (let index = 0; index < count; index++) {
      const glyph = bytes.u16(at + 4 + index * 2);
      if (glyph < 0) return out;
      out.push(glyph);
    }
    return out;
  }
  if (format === 2) {
    const count = bytes.u16(at + 2);
    if (count < 0) return out;
    for (let index = 0; index < count; index++) {
      const record = at + 4 + index * 6;
      const first = bytes.u16(record);
      const last = bytes.u16(record + 2);
      if (first < 0 || last < 0 || last < first) return out;
      // A range covering the whole id space is a corrupt table, not a font.
      if (last - first > 0xffff) return out;
      for (let glyph = first; glyph <= last; glyph++) out.push(glyph);
    }
  }
  return out;
}

export function readGsubFeatures(raw: Uint8Array): ReadFeatures {
  const found: ReadFeatures = { ligatures: [], sets: [] };
  const bytes = new Bytes(raw);
  if (raw.length < 10) return found;

  const featureListAt = bytes.u16(6);
  const lookupListAt = bytes.u16(8);
  if (featureListAt < 0 || lookupListAt < 0) return found;

  /*
   * Which lookups each feature fires, so a ligature can be reported under the
   * tag it actually belongs to. A `liga` and a `dlig` are different promises --
   * one is on by default and one is not -- and reading both as the same thing
   * would turn every discretionary ligature in a font into a mandatory one.
   */
  const byLookup = new Map<number, string>();
  const featureCount = bytes.u16(featureListAt);
  for (let index = 0; index < featureCount; index++) {
    const record = featureListAt + 2 + index * 6;
    const tag = bytes.tag(record);
    const featureAt = featureListAt + bytes.u16(record + 4);
    const indexCount = bytes.u16(featureAt + 2);
    if (!tag || indexCount < 0) continue;
    for (let one = 0; one < indexCount; one++) {
      const lookup = bytes.u16(featureAt + 4 + one * 2);
      // First tag wins: a lookup shared between features is reported under the
      // one that reached it first, which beats reporting it twice.
      if (lookup >= 0 && !byLookup.has(lookup)) byLookup.set(lookup, tag.trimEnd());
    }
  }

  const lookupCount = bytes.u16(lookupListAt);
  for (let index = 0; index < lookupCount; index++) {
    const tag = byLookup.get(index);
    // A lookup no feature reaches is invoked from a chain, and a chain is not
    // something this document can hold.
    if (!tag) continue;
    const lookupAt = lookupListAt + bytes.u16(lookupListAt + 2 + index * 2);
    const type = bytes.u16(lookupAt);
    const subtableCount = bytes.u16(lookupAt + 4);
    if (type !== SINGLE && type !== LIGATURE) continue;

    for (let sub = 0; sub < subtableCount; sub++) {
      const subAt = lookupAt + bytes.u16(lookupAt + 6 + sub * 2);
      if (subAt <= lookupAt || subAt >= bytes.length) continue;
      if (type === SINGLE) readSingle(bytes, subAt, tag, found);
      else readLigatures(bytes, subAt, tag, found);
    }
  }
  return found;
}

function readSingle(bytes: Bytes, at: number, tag: string, into: ReadFeatures): void {
  const format = bytes.u16(at);
  const covered = coveredBy(bytes, at + bytes.u16(at + 2));
  const swaps: Swap[] = [];
  if (format === 1) {
    // Format 1 stores one delta added to every glyph it covers, which is a
    // sixteen-bit signed number and wraps.
    const raw = bytes.u16(at + 4);
    const delta = raw > 0x7fff ? raw - 0x10000 : raw;
    for (const plain of covered) swaps.push({ plain, alternate: (plain + delta) & 0xffff });
  } else if (format === 2) {
    const count = bytes.u16(at + 4);
    for (let index = 0; index < count && index < covered.length; index++) {
      const alternate = bytes.u16(at + 6 + index * 2);
      if (alternate >= 0) swaps.push({ plain: covered[index], alternate });
    }
  }
  if (swaps.length > 0) into.sets.push({ tag, swaps });
}

function readLigatures(bytes: Bytes, at: number, tag: string, into: ReadFeatures): void {
  if (bytes.u16(at) !== 1) return;
  const covered = coveredBy(bytes, at + bytes.u16(at + 2));
  const setCount = bytes.u16(at + 4);

  for (let index = 0; index < setCount && index < covered.length; index++) {
    const setAt = at + bytes.u16(at + 6 + index * 2);
    const count = bytes.u16(setAt);
    if (count < 0) continue;
    for (let one = 0; one < count; one++) {
      const recordAt = setAt + bytes.u16(setAt + 2 + one * 2);
      const ligature = bytes.u16(recordAt);
      const componentCount = bytes.u16(recordAt + 2);
      // The count includes the first glyph, which coverage supplied and the
      // record does not repeat. One component is not a ligature.
      if (ligature < 0 || componentCount < 2) continue;
      const components = [covered[index]];
      let whole = true;
      for (let part = 1; part < componentCount; part++) {
        const glyph = bytes.u16(recordAt + 2 + part * 2);
        if (glyph < 0) {
          whole = false;
          break;
        }
        components.push(glyph);
      }
      if (whole) into.ligatures.push({ tag, components, ligature });
    }
  }
}
