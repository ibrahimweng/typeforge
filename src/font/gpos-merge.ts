/**
 * Putting new kerning into a font's own `GPOS` without taking anything else out.
 *
 * GPOS is not a kerning table. Kerning is one feature in it, and a font of any
 * ambition carries several more: `mark` and `mkmk` hang accents and vowel
 * signs on the letters they belong to, `curs` joins a script's letters stroke
 * to stroke, `dist` and `abvm` and the rest do what their scripts need. This
 * application models the kerning and none of the others. A preserving export
 * used to answer that by writing a table from the kerning alone and setting it
 * over the file's own, which deleted every one of those features from every
 * imported font that had kerning -- the accents on a Vietnamese font fell to
 * the baseline, and nothing said so.
 *
 * So the file's table is kept and only its kerning is traded. The other
 * lookups are all kept, in their order. The old kerning's lookups go too
 * unless the table has contextual positioning, which can call any lookup by
 * its index from inside subtables this does not rewrite -- then every lookup
 * keeps its place and the old kerning is simply left unreferenced. The old
 * `kern` features are dropped from
 * the feature list, which is what switches the old kerning off; the new
 * kerning's lookups are appended after the old ones and a single `kern`
 * feature pointing at them is added to every script and language that is
 * there, because the kerning in the document belongs to no script in
 * particular.
 *
 * The lookups themselves are not re-encoded, because nothing here could
 * re-encode a mark attachment table correctly. Both tables are copied whole to
 * the end of the new one and every lookup is rewritten as a small extension
 * lookup whose 32-bit offsets point into the copies. Offsets inside a subtable
 * are measured from the subtable, so a subtable copied whole still finds its
 * coverage and anchors wherever it lands; only the lists at the top have to be
 * written afresh, and they are the part this understands.
 *
 * A version 1.1 table's feature variations -- other lookups for a feature at
 * places along a varying font's axes -- point into the feature and lookup
 * lists by number, so they are rewritten with the new numbers rather than
 * copied; their conditions, which say nothing about either list, are reached
 * in the copy like the subtables are. A variation of the old kerning goes with
 * it, since the new kerning does not vary.
 */

import { ByteWriter } from "./sfnt";

const EXTENSION = 9;
const USE_MARK_FILTERING_SET = 0x0010;

interface Lookup {
  flag: number;
  markFilteringSet: number | null;
  /** The type of the subtables, looking through an extension. */
  type: number;
  /** Where each real subtable starts, measured from the start of its table. */
  subtables: number[];
}

interface Feature {
  tag: string;
  lookups: number[];
  /** Where the feature's parameters are, from the start of its table, if it has any. */
  params: number | null;
}

interface LangSys {
  tag: string;
  required: number;
  features: number[];
}

interface Script {
  tag: string;
  defaultLangSys: LangSys | null;
  langSys: LangSys[];
}

/** One feature's lookups swapped for others while a variation condition holds. */
interface Substitution {
  feature: number;
  lookups: number[];
}

/**
 * A record of a version 1.1 table's feature variations: the conditions, left
 * where they are in the copy, and what to swap while they hold.
 */
interface Variation {
  /** Where the condition set is, from the start of its table, or null for none. */
  conditions: number | null;
  substitutions: Substitution[];
}

interface Parsed {
  scripts: Script[];
  features: Feature[];
  lookups: Lookup[];
  variations: Variation[];
}

function tagAt(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}

function readLangSys(view: DataView, at: number, tag: string): LangSys {
  const required = view.getUint16(at + 2);
  const count = view.getUint16(at + 4);
  const features: number[] = [];
  for (let index = 0; index < count; index++) features.push(view.getUint16(at + 6 + index * 2));
  return { tag, required, features };
}

/** Read the three lists at the top of a GPOS table. Throws on anything it cannot walk. */
function parse(table: Uint8Array): Parsed {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  if (view.getUint16(0) !== 1) throw new Error("Unknown GPOS version");
  const scriptListAt = view.getUint16(4);
  const featureListAt = view.getUint16(6);
  const lookupListAt = view.getUint16(8);

  const scripts: Script[] = [];
  if (scriptListAt !== 0) {
    const count = view.getUint16(scriptListAt);
    for (let index = 0; index < count; index++) {
      const record = scriptListAt + 2 + index * 6;
      const scriptAt = scriptListAt + view.getUint16(record + 4);
      const defaultAt = view.getUint16(scriptAt);
      const langCount = view.getUint16(scriptAt + 2);
      const langSys: LangSys[] = [];
      for (let slot = 0; slot < langCount; slot++) {
        const langRecord = scriptAt + 4 + slot * 6;
        langSys.push(
          readLangSys(view, scriptAt + view.getUint16(langRecord + 4), tagAt(view, langRecord)),
        );
      }
      scripts.push({
        tag: tagAt(view, record),
        defaultLangSys: defaultAt === 0 ? null : readLangSys(view, scriptAt + defaultAt, ""),
        langSys,
      });
    }
  }

  const features: Feature[] = [];
  if (featureListAt !== 0) {
    const count = view.getUint16(featureListAt);
    for (let index = 0; index < count; index++) {
      const record = featureListAt + 2 + index * 6;
      const featureAt = featureListAt + view.getUint16(record + 4);
      const paramsOffset = view.getUint16(featureAt);
      const lookupCount = view.getUint16(featureAt + 2);
      const lookups: number[] = [];
      for (let slot = 0; slot < lookupCount; slot++) {
        lookups.push(view.getUint16(featureAt + 4 + slot * 2));
      }
      features.push({
        tag: tagAt(view, record),
        lookups,
        params: paramsOffset === 0 ? null : featureAt + paramsOffset,
      });
    }
  }

  const lookups: Lookup[] = [];
  if (lookupListAt !== 0) {
    const count = view.getUint16(lookupListAt);
    for (let index = 0; index < count; index++) {
      const lookupAt = lookupListAt + view.getUint16(lookupListAt + 2 + index * 2);
      const wrapped = view.getUint16(lookupAt) === EXTENSION;
      let type = view.getUint16(lookupAt);
      const flag = view.getUint16(lookupAt + 2);
      const subCount = view.getUint16(lookupAt + 4);
      const subtables: number[] = [];
      for (let slot = 0; slot < subCount; slot++) {
        const subAt = lookupAt + view.getUint16(lookupAt + 6 + slot * 2);
        if (wrapped) {
          // Looked through, so the new extension points at the real subtable
          // rather than at an extension of an extension, which is not allowed.
          type = view.getUint16(subAt + 2);
          subtables.push(subAt + view.getUint32(subAt + 4));
        } else {
          subtables.push(subAt);
        }
      }
      const markFilteringSet =
        flag & USE_MARK_FILTERING_SET ? view.getUint16(lookupAt + 6 + subCount * 2) : null;
      lookups.push({ flag, markFilteringSet, type, subtables });
    }
  }
  /*
   * Feature variations, in a version 1.1 table: which features are swapped for
   * which alternates at which places along a varying font's axes. `rvrn` in
   * GSUB is the famous one; in GPOS it is kerning or mark positions that change
   * with the weight.
   */
  const variations: Variation[] = [];
  const minor = view.getUint16(2);
  const variationsAt = minor >= 1 && table.length >= 14 ? view.getUint32(10) : 0;
  if (variationsAt !== 0) {
    const count = view.getUint32(variationsAt + 4);
    for (let index = 0; index < count; index++) {
      const record = variationsAt + 8 + index * 8;
      const conditionsOffset = view.getUint32(record);
      const substitutionAt = variationsAt + view.getUint32(record + 4);
      const substitutions: Substitution[] = [];
      const substitutionCount = view.getUint16(substitutionAt + 4);
      for (let slot = 0; slot < substitutionCount; slot++) {
        const entry = substitutionAt + 6 + slot * 6;
        const alternateAt = substitutionAt + view.getUint32(entry + 2);
        const lookupCount = view.getUint16(alternateAt + 2);
        const lookups: number[] = [];
        for (let one = 0; one < lookupCount; one++) {
          lookups.push(view.getUint16(alternateAt + 4 + one * 2));
        }
        substitutions.push({ feature: view.getUint16(entry), lookups });
      }
      variations.push({
        conditions: conditionsOffset === 0 ? null : variationsAt + conditionsOffset,
        substitutions,
      });
    }
  }
  return { scripts, features, lookups, variations };
}

function writeLangSys(writer: ByteWriter, langSys: LangSys): void {
  writer.uint16(0); // lookupOrderOffset, reserved
  writer.uint16(langSys.required);
  writer.uint16(langSys.features.length);
  for (const index of langSys.features) writer.uint16(index);
}

function langSysSize(langSys: LangSys): number {
  return 6 + langSys.features.length * 2;
}

function tagBytes(writer: ByteWriter, tag: string): void {
  for (let index = 0; index < 4; index++) writer.uint8(tag.charCodeAt(index) || 0x20);
}

/**
 * The font's `GPOS` with its kerning replaced by `kerning`'s.
 *
 * `kerning` is a table from `buildGposTable`, or null to take the kerning out
 * and leave everything else. Returns null when nothing would be left in the
 * table at all -- no features, so nothing a shaper would ever apply -- and
 * throws when the source table cannot be read or the result would not fit the
 * format, which the caller has to decide what to do about.
 */
export function mergeKerning(source: Uint8Array, kerning: Uint8Array | null): Uint8Array | null {
  const old = parse(source);
  const added: Parsed = kerning
    ? parse(kerning)
    : { scripts: [], features: [], lookups: [], variations: [] };

  /*
   * The lookups: the file's, then the new kerning's. Each remembers which
   * copied table its subtables live in.
   *
   * The old kerning's own lookups are taken out when nothing else can reach
   * them, which is when the table has no contextual positioning: a lookup of
   * type 7 or 8 calls others by their index, from inside subtables this does
   * not rewrite, so in a table that has any, every lookup keeps its index and
   * the old kerning stays in the file unreferenced -- never applied, since no
   * feature points at it any more, but still there. Without them, leaving it
   * would be dead weight and a second, stale set of pairs for any tool that
   * reads lookups rather than features to find.
   */
  const contextual = old.lookups.some((lookup) => lookup.type === 7 || lookup.type === 8);
  const wanted = new Set<number>();
  const isKern = (feature: number) => old.features[feature]?.tag === "kern";
  for (const [index, feature] of old.features.entries()) {
    if (!isKern(index)) for (const lookup of feature.lookups) wanted.add(lookup);
  }
  // An alternate a variation swaps in is as much in use as the feature it
  // stands in for, even when no feature in the list points at it by default.
  for (const variation of old.variations) {
    for (const substitution of variation.substitutions) {
      if (!isKern(substitution.feature)) {
        for (const lookup of substitution.lookups) wanted.add(lookup);
      }
    }
  }
  const keptOld = old.lookups
    .map((lookup, index) => ({ lookup, index }))
    .filter(({ index }) => contextual || wanted.has(index));
  const lookupNow = new Map(keptOld.map(({ index }, now) => [index, now]));
  const lookups = [
    ...keptOld.map(({ lookup }) => ({ ...lookup, from: 0 })),
    ...added.lookups.map((lookup) => ({ ...lookup, from: 1 })),
  ];
  const kernLookups = added.features
    .filter((feature) => feature.tag === "kern")
    .flatMap((feature) => feature.lookups.map((index) => index + keptOld.length));

  /*
   * The features: the file's own less its kerning, and one new `kern`. Sorted
   * by tag, as the format asks, which renumbers them -- so every language's
   * list of features is renumbered to match.
   */
  const pending: Array<Feature & { was: number | null; from: number }> = old.features
    .map((feature, index) => ({
      ...feature,
      lookups: feature.lookups
        .map((lookup) => lookupNow.get(lookup))
        .filter((lookup): lookup is number => lookup !== undefined),
      was: index as number | null,
      from: 0,
    }))
    .filter((feature) => feature.tag !== "kern");
  if (kernLookups.length > 0) {
    pending.push({
      tag: "kern",
      lookups: [...new Set(kernLookups)],
      params: null,
      was: null,
      from: 1,
    });
  }
  const features = pending
    .map((feature, order) => ({ feature, order }))
    .sort((one, other) =>
      one.feature.tag < other.feature.tag
        ? -1
        : one.feature.tag > other.feature.tag
          ? 1
          : one.order - other.order,
    )
    .map(({ feature }) => feature);
  if (features.length === 0) return null;

  const renumbered = new Map<number, number>();
  let kernIndex: number | null = null;
  features.forEach((feature, index) => {
    if (feature.was === null) kernIndex = index;
    else renumbered.set(feature.was, index);
  });

  const relist = (langSys: LangSys): LangSys => {
    const list = new Set<number>();
    for (const index of langSys.features) {
      const now = renumbered.get(index);
      if (now !== undefined) list.add(now);
    }
    if (kernIndex !== null) list.add(kernIndex);
    return {
      tag: langSys.tag,
      required: renumbered.get(langSys.required) ?? 0xffff,
      features: [...list].sort((a, b) => a - b),
    };
  };
  let scripts: Script[] = old.scripts.map((script) => ({
    tag: script.tag,
    defaultLangSys: script.defaultLangSys ? relist(script.defaultLangSys) : null,
    langSys: script.langSys.map(relist),
  }));
  if (scripts.length === 0 && kernIndex !== null) {
    scripts = [
      {
        tag: "DFLT",
        defaultLangSys: { tag: "", required: 0xffff, features: [kernIndex] },
        langSys: [],
      },
    ];
  }

  /*
   * The feature variations, carried across with their numbers brought up to
   * date. A swap for the old `kern` goes, since the feature it swapped is gone
   * and the new kerning does not vary; every other swap is renumbered to the
   * feature's new place and its lookups to theirs. A record left with nothing
   * to swap is kept rather than dropped, because the first record whose
   * conditions hold is the only one applied: taking one out would let a later
   * record apply where it never did.
   */
  const variations = old.variations.map((variation) => ({
    conditions: variation.conditions,
    substitutions: variation.substitutions
      .filter((substitution) => renumbered.has(substitution.feature))
      .map((substitution) => ({
        feature: renumbered.get(substitution.feature)!,
        lookups: substitution.lookups
          .map((lookup) => lookupNow.get(lookup))
          .filter((lookup): lookup is number => lookup !== undefined),
      }))
      .sort((one, other) => one.feature - other.feature),
  }));
  const substitutionSize = (variation: (typeof variations)[number]) =>
    6 + variation.substitutions.reduce((sum, one) => sum + 6 + 4 + one.lookups.length * 2, 0);
  const variationsSize =
    variations.length === 0
      ? 0
      : 8 + variations.reduce((sum, one) => sum + 8 + substitutionSize(one), 0);

  // ScriptList, written at once: nothing in it points outside it.
  const scriptList = new ByteWriter();
  scriptList.uint16(scripts.length);
  const scriptSizes = scripts.map(
    (script) =>
      4 +
      script.langSys.length * 6 +
      (script.defaultLangSys ? langSysSize(script.defaultLangSys) : 0) +
      script.langSys.reduce((sum, one) => sum + langSysSize(one), 0),
  );
  let scriptAt = 2 + scripts.length * 6;
  for (const [index, script] of scripts.entries()) {
    tagBytes(scriptList, script.tag);
    scriptList.uint16(scriptAt);
    scriptAt += scriptSizes[index];
  }
  for (const script of scripts) {
    const headerSize = 4 + script.langSys.length * 6;
    let langAt = headerSize + (script.defaultLangSys ? langSysSize(script.defaultLangSys) : 0);
    scriptList.uint16(script.defaultLangSys ? headerSize : 0);
    scriptList.uint16(script.langSys.length);
    for (const langSys of script.langSys) {
      tagBytes(scriptList, langSys.tag);
      scriptList.uint16(langAt);
      langAt += langSysSize(langSys);
    }
    if (script.defaultLangSys) writeLangSys(scriptList, script.defaultLangSys);
    for (const langSys of script.langSys) writeLangSys(scriptList, langSys);
  }
  const scriptBytes = scriptList.toUint8Array();

  // Sizes first, so the absolute position of everything is known before any
  // offset that crosses into the copies has to be written.
  const featureListSize =
    2 + features.length * 6 + features.reduce((sum, one) => sum + 4 + one.lookups.length * 2, 0);
  const lookupSizes = lookups.map(
    (lookup) =>
      6 +
      lookup.subtables.length * 2 +
      (lookup.markFilteringSet !== null ? 2 : 0) +
      lookup.subtables.length * 8,
  );
  const lookupListSize = 2 + lookups.length * 2 + lookupSizes.reduce((sum, one) => sum + one, 0);

  const scriptListAt = variations.length > 0 ? 14 : 10;
  const featureListAt = scriptListAt + scriptBytes.length;
  const lookupListAt = featureListAt + featureListSize;
  const variationsAt = lookupListAt + lookupListSize;
  const headEnd = variationsAt + variationsSize;
  const copyAt = [headEnd + ((4 - (headEnd % 4)) % 4), 0];
  copyAt[1] = copyAt[0] + source.length + ((4 - (source.length % 4)) % 4);

  if (lookupListAt > 0xffff || lookupListSize > 0xffff || featureListSize > 0xffff) {
    throw new Error("The merged GPOS lists do not fit sixteen-bit offsets");
  }

  const out = new ByteWriter();
  // Version 1.1 only when there are variations to point at.
  out.uint16(1).uint16(variations.length > 0 ? 1 : 0);
  out.uint16(scriptListAt).uint16(featureListAt).uint16(lookupListAt);
  if (variations.length > 0) out.uint32(variationsAt);
  out.bytesFrom(scriptBytes);

  // FeatureList.
  out.uint16(features.length);
  let featureAt = 2 + features.length * 6;
  const featureStarts: number[] = [];
  for (const feature of features) {
    tagBytes(out, feature.tag);
    out.uint16(featureAt);
    featureStarts.push(featureListAt + featureAt);
    featureAt += 4 + feature.lookups.length * 2;
  }
  for (const [index, feature] of features.entries()) {
    /*
     * A feature's parameters -- `size` has them -- stay where they are in the
     * copy, reached by a sixteen-bit offset from the new feature table. When
     * the copy is too far away for that the parameters are left off, which
     * costs a design-size hint and nothing a shaper applies.
     */
    let params = 0;
    if (feature.params !== null) {
      const distance = copyAt[feature.from] + feature.params - featureStarts[index];
      if (distance > 0 && distance <= 0xffff) params = distance;
    }
    out.uint16(params);
    out.uint16(feature.lookups.length);
    for (const lookup of feature.lookups) out.uint16(lookup);
  }

  // LookupList, every lookup as an extension reaching into the copies.
  out.uint16(lookups.length);
  let lookupAt = 2 + lookups.length * 2;
  const lookupStarts: number[] = [];
  for (const size of lookupSizes) {
    out.uint16(lookupAt);
    lookupStarts.push(lookupListAt + lookupAt);
    lookupAt += size;
  }
  for (const [index, lookup] of lookups.entries()) {
    const count = lookup.subtables.length;
    // A lookup with no subtables has nothing to wrap and keeps its own type.
    out.uint16(count === 0 ? lookup.type : EXTENSION);
    out.uint16(lookup.flag);
    out.uint16(count);
    const recordsAt = 6 + count * 2 + (lookup.markFilteringSet !== null ? 2 : 0);
    for (let slot = 0; slot < count; slot++) out.uint16(recordsAt + slot * 8);
    if (lookup.markFilteringSet !== null) out.uint16(lookup.markFilteringSet);
    for (const [slot, subtable] of lookup.subtables.entries()) {
      const recordAt = lookupStarts[index] + recordsAt + slot * 8;
      out.uint16(1); // ExtensionPos format 1
      out.uint16(lookup.type);
      out.uint32(copyAt[lookup.from] + subtable - recordAt);
    }
  }

  // FeatureVariations: the condition sets stay in the copy, reached by 32-bit
  // offsets; the substitutions are written here with their new numbers.
  if (variations.length > 0) {
    out.uint16(1).uint16(0);
    out.uint32(variations.length);
    let substitutionAt = 8 + variations.length * 8;
    for (const variation of variations) {
      out.uint32(
        variation.conditions === null ? 0 : copyAt[0] + variation.conditions - variationsAt,
      );
      out.uint32(substitutionAt);
      substitutionAt += substitutionSize(variation);
    }
    for (const variation of variations) {
      out.uint16(1).uint16(0);
      out.uint16(variation.substitutions.length);
      let alternateAt = 6 + variation.substitutions.length * 6;
      for (const substitution of variation.substitutions) {
        out.uint16(substitution.feature);
        out.uint32(alternateAt);
        alternateAt += 4 + substitution.lookups.length * 2;
      }
      for (const substitution of variation.substitutions) {
        out.uint16(0); // featureParamsOffset
        out.uint16(substitution.lookups.length);
        for (const lookup of substitution.lookups) out.uint16(lookup);
      }
    }
  }

  while (out.length < copyAt[0]) out.uint8(0);
  out.bytesFrom(source);
  if (kerning) {
    while (out.length < copyAt[1]) out.uint8(0);
    out.bytesFrom(kerning);
  }
  return out.toUint8Array();
}
