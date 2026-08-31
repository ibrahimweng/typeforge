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
 * The glyphs a reader can never arrive at.
 *
 * A glyph is reachable if a character maps to it, or if some rule puts it
 * there. Everything else is in the file and cannot be shown -- which is exactly
 * the state that drawing `f_i` and stopping used to leave you in, with nothing
 * anywhere saying so.
 *
 * `.notdef` is reachable by definition: it is what a renderer draws for a
 * character the font has not got, which is the one way in that is not a rule.
 */
export function unreachableGlyphs(typeface: Typeface): string[] {
  const reached = new Set<string>([".notdef"]);
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

  return typeface.glyphs.filter((one) => !reached.has(one.name)).map((one) => one.name);
}
