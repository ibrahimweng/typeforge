/**
 * Making and unmaking the rules that substitute one drawing for another.
 *
 * Three shapes of rule, and only one of them could be made before this: the
 * contextual alternates a joined script needs, written by the forge and by
 * nothing else. So a person could draw `f_i`, name it, see it in the grid and
 * export it, and no shaper would ever show it -- the glyph was in the file and
 * nothing selected it.
 *
 * What is checked here is what makes a rule mean what it says, rather than what
 * makes it parse. A ligature of one letter is not a ligature; a ligature onto a
 * letter that is one of its own parts is a loop; a set that swaps a letter for
 * itself is a tag a reader can switch on to no effect. Every one of those
 * writes a valid file.
 *
 * Names rather than glyph ids, everywhere, because ids are not settled until
 * the export orders them -- and because a rule that survives a rename is a rule
 * that has to be written in the thing a rename rewrites.
 */

import type { NamedLigature, Typeface } from "./types";

/** The standard ligatures, in the order a font usually gets them. */
export const COMMON_LIGATURES: ReadonlyArray<readonly string[]> = [
  ["f", "i"],
  ["f", "l"],
  ["f", "f"],
  ["f", "f", "i"],
  ["f", "f", "l"],
];

/**
 * What a ligature of these letters is called.
 *
 * `f_i` rather than `fi`, which is the convention every tool that reads a font
 * follows and the only one that is unambiguous: `fi` is also a perfectly good
 * name for a single glyph, and a font with both in it has two glyphs whose
 * names say the same thing.
 */
export const ligatureName = (components: readonly string[]): string => components.join("_");

/** Whether these letters could be joined at all. */
export function canJoin(typeface: Typeface, components: readonly string[]): boolean {
  return (
    components.length >= 2 &&
    components.every((one) => typeface.glyphIndex.has(one)) &&
    new Set(components).size >= 1
  );
}

/** The ligature this font already has for these letters, if it has one. */
export const ligatureFor = (
  typeface: Typeface,
  components: readonly string[],
): NamedLigature | undefined =>
  typeface.ligatures?.find(
    (one) =>
      one.components.length === components.length &&
      one.components.every((part, at) => part === components[at]),
  );

/**
 * Add a ligature rule, and say whether it took.
 *
 * The glyph it becomes has to exist and has to not be one of its own parts: a
 * rule turning `f i` into `f` is a font where every `fi` loses its `i`, which
 * is a valid file and a broken one.
 */
export function addLigature(
  typeface: Typeface,
  components: string[],
  ligature: string,
): boolean {
  if (!canJoin(typeface, components)) return false;
  if (!typeface.glyphIndex.has(ligature)) return false;
  if (components.includes(ligature)) return false;
  if (ligatureFor(typeface, components)) return false;

  typeface.ligatures = [...(typeface.ligatures ?? []), { components, ligature }];
  return true;
}

/** Take a ligature out, by the letters it joins. */
export function removeLigature(typeface: Typeface, components: readonly string[]): boolean {
  const before = typeface.ligatures?.length ?? 0;
  if (before === 0) return false;
  typeface.ligatures = typeface.ligatures!.filter(
    (one) =>
      one.components.length !== components.length ||
      one.components.some((part, at) => part !== components[at]),
  );
  return typeface.ligatures.length !== before;
}

/**
 * The tags a stylistic set can go under, and what they mean.
 *
 * `ss01`..`ss20` are the numbered sets, which mean whatever a font says they
 * mean and so need a name of their own. The rest are registered: a reader's
 * software knows what `smcp` is for and offers it under its own name.
 */
export const SET_TAGS: ReadonlyArray<{ tag: string; label: string }> = [
  { tag: "salt", label: "Stylistic alternates" },
  { tag: "smcp", label: "Small capitals" },
  { tag: "onum", label: "Old-style figures" },
  { tag: "ss01", label: "Stylistic set 1" },
  { tag: "ss02", label: "Stylistic set 2" },
  { tag: "ss03", label: "Stylistic set 3" },
];

/** A four-character tag, which is what the format stores and nothing less. */
export const tagIsWellFormed = (tag: string): boolean => /^[\x20-\x7e]{1,4}$/.test(tag);

/**
 * Put one swap into a set, making the set if this is the first.
 *
 * A swap of a letter for itself is refused rather than stored: it is a rule
 * that fires and changes nothing, which costs a reader's shaper time and tells
 * whoever reads the panel that something is set up when nothing is.
 */
export function addToSet(
  typeface: Typeface,
  tag: string,
  label: string,
  plain: string,
  alternate: string,
): boolean {
  if (!tagIsWellFormed(tag)) return false;
  if (plain === alternate) return false;
  if (!typeface.glyphIndex.has(plain) || !typeface.glyphIndex.has(alternate)) return false;

  const sets = [...(typeface.sets ?? [])];
  const at = sets.findIndex((one) => one.tag === tag);
  if (at < 0) {
    sets.push({ tag, label, swaps: [{ plain, alternate }] });
  } else {
    if (sets[at].swaps.some((one) => one.plain === plain)) return false;
    sets[at] = { ...sets[at], swaps: [...sets[at].swaps, { plain, alternate }] };
  }
  typeface.sets = sets;
  return true;
}

/** Take one swap out of a set, and the set with it if that was the last. */
export function removeFromSet(typeface: Typeface, tag: string, plain: string): boolean {
  const sets = typeface.sets;
  if (!sets) return false;
  const at = sets.findIndex((one) => one.tag === tag);
  if (at < 0) return false;
  const swaps = sets[at].swaps.filter((one) => one.plain !== plain);
  if (swaps.length === sets[at].swaps.length) return false;

  typeface.sets =
    swaps.length === 0
      ? sets.filter((_, index) => index !== at)
      : sets.map((one, index) => (index === at ? { ...one, swaps } : one));
  return true;
}

/**
 * The ligatures this font could have and has not made yet.
 *
 * Only the ones whose letters are all drawn, because offering `ffl` to a font
 * with no `l` in it is offering work that cannot be done. `drawing` is the
 * glyph that would be used, and whether it is already there: a person who has
 * drawn `f_i` wants the rule, and a person who has not wants both.
 */
export interface Suggestion {
  components: string[];
  drawing: string;
  drawn: boolean;
}

export function suggestedLigatures(typeface: Typeface): Suggestion[] {
  const out: Suggestion[] = [];
  for (const components of COMMON_LIGATURES) {
    if (!canJoin(typeface, components)) continue;
    if (ligatureFor(typeface, components)) continue;
    const drawing = drawingFor(typeface, components);
    out.push({
      components: [...components],
      drawing,
      drawn: typeface.glyphIndex.has(drawing),
    });
  }
  return out;
}

/**
 * The glyph a ligature of these letters would use, whatever it is called here.
 *
 * Two conventions are in use and both are correct. `f_i` is what a tool writes
 * when it makes one; `fi` is what a great many shipped fonts call it, DejaVu
 * among them. Looking only for the first offers to *make* a ligature to a font
 * that already draws it -- and making it adds a second, empty glyph beside the
 * real one and wires the rule to the blank.
 *
 * Found by asking rather than assumed, so an existing drawing is used and a
 * missing one is made under the name a tool would give it.
 */
export function drawingFor(typeface: Typeface, components: readonly string[]): string {
  const underscored = ligatureName(components);
  if (typeface.glyphIndex.has(underscored)) return underscored;
  const joined = components.join("");
  if (typeface.glyphIndex.has(joined)) return joined;
  return underscored;
}

/**
 * The stylistic sets a font's own glyph names are already asking for.
 *
 * `a.ss01` says what it is: the `a` of stylistic set one. The convention is
 * how every tool that reads a font finds them, and following it is how a person
 * ends up with twenty drawings and no way to switch them on -- so this reads
 * the names back and offers to wire up what it finds.
 *
 * The suffix has to be a tag this font does not already cover for that letter,
 * and the plain letter has to exist: `a.ss01` with no `a` is a drawing of
 * something else that happens to be named like a set.
 */
export function suggestedSets(typeface: Typeface): Map<string, Array<{ plain: string; alternate: string }>> {
  const found = new Map<string, Array<{ plain: string; alternate: string }>>();
  for (const glyph of typeface.glyphs) {
    const dot = glyph.name.lastIndexOf(".");
    if (dot <= 0) continue;
    const plain = glyph.name.slice(0, dot);
    const tag = glyph.name.slice(dot + 1);
    if (!tagIsWellFormed(tag)) continue;
    if (!SET_TAGS.some((one) => one.tag === tag)) continue;
    if (!typeface.glyphIndex.has(plain)) continue;
    if (typeface.sets?.some((set) => set.tag === tag && set.swaps.some((one) => one.plain === plain)))
      continue;

    const list = found.get(tag);
    if (list) list.push({ plain, alternate: glyph.name });
    else found.set(tag, [{ plain, alternate: glyph.name }]);
  }
  return found;
}

/** What a registered tag is called, or the tag itself for one nobody named. */
export const labelFor = (tag: string): string =>
  SET_TAGS.find((one) => one.tag === tag)?.label ?? tag;

/**
 * A run of letters with the ligatures applied, as a shaper would.
 *
 * The same rule the format makes a shaper follow, and the same one the writer
 * sorts for: at each position take the longest ligature that matches and carry
 * on from after it. Take the shortest and `office` comes out as `o ff i c e`
 * with the `ffi` in the font and never used.
 *
 * Here so the proof can show the face as it will actually be read. Laying out
 * character by character -- which is what the proof did -- shows a font nobody
 * will ever see: every ligature in it sitting unused while the letters it
 * replaces are set side by side.
 */
export function applyLigatures(typeface: Typeface, run: readonly string[]): string[] {
  const rules = typeface.ligatures;
  if (!rules || rules.length === 0) return [...run];

  const byFirst = new Map<string, NamedLigature[]>();
  for (const one of rules) {
    const list = byFirst.get(one.components[0]);
    if (list) list.push(one);
    else byFirst.set(one.components[0], [one]);
  }
  for (const list of byFirst.values()) {
    list.sort((one, other) => other.components.length - one.components.length);
  }

  const out: string[] = [];
  let at = 0;
  while (at < run.length) {
    const candidates = byFirst.get(run[at]);
    const hit = candidates?.find((one) =>
      one.components.every((part, index) => run[at + index] === part),
    );
    if (hit) {
      out.push(hit.ligature);
      at += hit.components.length;
    } else {
      out.push(run[at]);
      at += 1;
    }
  }
  return out;
}

/**
 * The names a font carries that no character has ever mapped to.
 *
 * `.notdef` is what a renderer draws for a character the font has not got.
 * `.null` and `nonmarkingreturn` are the two glyphs the old Macintosh tables
 * required at ids 1 and 2, and plenty of shipped fonts still carry them. None
 * of the three is reachable by a rule and none of them is a mistake.
 */
const NOT_A_MISTAKE = new Set([".notdef", ".null", "nonmarkingreturn"]);

/**
 * The glyphs a reader can never arrive at.
 *
 * A glyph is reachable if a character maps to it, if some rule puts it there,
 * or if another letter is built out of it. Everything else is in the file and
 * cannot be shown -- which is exactly the state that drawing `f_i` and stopping
 * used to leave you in, with nothing anywhere saying so.
 *
 * **Only what was drawn here, on a font that came from a file.** An imported
 * font brings its own `GSUB` -- ligatures, positional forms, the lot -- which
 * this document does not model and the exporter hands back untouched. So its
 * glyphs are reachable through tables nothing here can see, and counting them
 * reported two hundred and sixty-five dead letters in DejaVu Sans: Arabic
 * initial and final forms, every one of them reached by the font's own rules.
 *
 * A check that is wrong about a correct font is worse than no check. So on a
 * font with a source, this asks only about the letters somebody has drawn or
 * changed here, which is the only part this document actually knows about.
 */
export function unreachableGlyphs(typeface: Typeface): string[] {
  const reached = new Set<string>(NOT_A_MISTAKE);
  for (const glyph of typeface.glyphs) {
    if (glyph.unicodes.length > 0) reached.add(glyph.name);
  }
  for (const one of typeface.ligatures ?? []) reached.add(one.ligature);
  for (const set of typeface.sets ?? []) {
    for (const swap of set.swaps) reached.add(swap.alternate);
  }
  for (const rule of typeface.alternates ?? []) {
    for (const position of rule.swaps) {
      for (const swap of position.swap) reached.add(swap.alternate);
    }
  }
  /*
   * A letter used to build another one is reached through that one, so it is
   * not unreachable even where nothing types it: `acute` is how `aacute` gets
   * its accent, and reporting it as dead would be reporting the composite
   * system itself.
   */
  for (const glyph of typeface.glyphs) {
    for (const component of glyph.components) reached.add(component.glyphName);
  }

  const mine = typeface.source === null ? typeface.glyphs : typeface.glyphs.filter((one) => one.dirty);
  return mine.filter((one) => !reached.has(one.name)).map((one) => one.name);
}
