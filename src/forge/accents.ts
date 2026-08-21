/**
 * The accented letters, built from the letters and marks already drawn.
 *
 * Most of a usable character set is accented. Without these a font drawn here
 * sets English and nothing else -- not French, not Spanish, not German, not
 * Portuguese, not one of the Nordic languages -- and the gap is easy to miss,
 * because a specimen line of `Handgloves` looks finished.
 *
 * Nothing here is a second drawing of anything. An `á` is the `a` that is
 * already drawn with the `acute` that is already drawn, put where it goes; so
 * an edit to the a is an edit to every letter built on it, exactly as an edit
 * to the shoulder reaches every arch. That is the same promise the rest of this
 * half of the application makes, and accents are where a font usually breaks
 * it -- a hundred letters drawn once and then left behind by the next change to
 * the base.
 *
 * Which letter is made of which parts is not written down here either. Unicode
 * defines it, in the canonical decomposition of every precomposed character, so
 * the recipes are read off `String.normalize` rather than typed out. A table of
 * a hundred entries would be a second description of the alphabet, and this
 * file has watched three of those go stale.
 */

import { MARK_NAMES, decomposeCodepoint } from "@/font/accents";

/** What an accented letter is made of, in the names the recipes use. */
export interface Parts {
  base: string;
  /** Marks in the order they apply, outward from the base. */
  marks: string[];
}

/**
 * How far the mark stands off the letter, as a share of the em.
 *
 * Nought would rest the accent on the letter, which is what lining the two
 * anchors up does on its own, and at that distance the eye reads one shape
 * rather than a letter with a mark on it. This is the daylight that keeps them
 * apart, and it is the smallest measurement in the file that anybody would
 * notice being wrong.
 */
const GAP = 0.028;

/**
 * How much of that gap a capital gets.
 *
 * A capital already reaches most of the way to the ascender, so an accent set
 * the same distance above one lands outside the line and collides with whatever
 * is above it. Every text face cuts the gap down over capitals; some cut the
 * accent itself down too, which is a second decision and not one this makes.
 */
const CAPITAL_SHARE = 0.45;

/** The letters that lose a dot when something is put over them. */
const DOTLESS: Record<string, string> = { i: "dotlessi", j: "dotlessj" };

/** The marks that hang under the letter rather than sitting over it. */
const BELOW = new Set([0x0327, 0x0328, 0x0323, 0x0326]);

/**
 * Which forge letter draws a given character, if any does.
 *
 * Everything a Latin-1 letter decomposes into is either an ASCII letter, which
 * is named after itself, or a combining mark, which has the name the font world
 * uses for it. Nothing else has to be looked up, which is what keeps this from
 * needing to know how the exporter numbers its glyphs.
 */
function nameForCodepoint(codepoint: number, drawable: ReadonlySet<string>): string | null {
  const character = String.fromCodePoint(codepoint);
  // Letters and figures are named after themselves; everything else has the
  // name the font world already uses, which is the name the recipe has.
  if (drawable.has(character)) return character;
  for (const candidate of MARK_NAMES[codepoint] ?? []) {
    if (drawable.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Every accented letter that can be built from what is drawn, and what each is
 * made of.
 *
 * Worked out once for a given set of drawn letters. Which letters those are
 * changes only when the alphabet does, so this is keyed on the set itself.
 */
const found = new WeakMap<ReadonlySet<string>, Map<string, Parts>>();

export function accentsFor(drawable: ReadonlySet<string>): Map<string, Parts> {
  const kept = found.get(drawable);
  if (kept) return kept;

  const recipes = new Map<string, Parts>();
  // Latin-1, which is the set a font needs to leave English behind. Everything
  // past it decomposes the same way and would be built the same way; what
  // stops it is having the marks drawn, not anything here.
  for (let code = 0xc0; code <= 0xff; code++) {
    const decomposed = decomposeCodepoint(code);
    if (!decomposed) continue;

    const found = nameForCodepoint(decomposed.base, drawable);
    if (!found) continue;
    const marks = decomposed.marks.map((mark) => nameForCodepoint(mark, drawable));
    if (marks.some((mark) => mark === null)) continue;

    /*
     * An accent over an i takes the dot's place rather than sitting on it.
     *
     * Unicode's decomposition names the dotted letter, because that is what the
     * character is; it has nothing to say about how a font should draw it. Left
     * alone this builds `í` as an `i` with an acute above its dot, which is two
     * marks on one letter and is not what an `í` is. Every font that has an
     * accented i carries a dotless one for exactly this reason.
     */
    const above = (marks as string[]).some((mark) => !hangsBelow(mark));
    const dotless = above ? DOTLESS[found] : undefined;
    const base = dotless && drawable.has(dotless) ? dotless : found;

    const name = accentedNameFor(code);
    if (!name || drawable.has(name)) continue;
    recipes.set(name, { base, marks: marks as string[] });
  }

  found.set(drawable, recipes);
  return recipes;
}

/*
 * What the font world calls each of them.
 *
 * These are a convention rather than a rule, and the convention is worth
 * following exactly: a font whose `é` is called `eacute` is one every other
 * tool understands, and one whose `é` is called `uni00E9` is legal, works, and
 * makes everybody's life slightly harder for no reason.
 */
const LATIN1_NAMES = `Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla
Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis
Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply
Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls
agrave aacute acircumflex atilde adieresis aring ae ccedilla
egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis
eth ntilde ograve oacute ocircumflex otilde odieresis divide
oslash ugrave uacute ucircumflex udieresis yacute thorn ydieresis`
  .split(/\s+/)
  .filter(Boolean);

export function accentedNameFor(codepoint: number): string | null {
  if (codepoint < 0xc0 || codepoint > 0xff) return null;
  return LATIN1_NAMES[codepoint - 0xc0] ?? null;
}

/** The codepoint an accented letter is drawn for. */
const BY_NAME = new Map(LATIN1_NAMES.map((name, index) => [name, 0xc0 + index]));

export function codepointOfAccented(name: string): number | null {
  return BY_NAME.get(name) ?? null;
}

/** Whether a mark hangs below the letter it belongs to. */
export function hangsBelow(markName: string): boolean {
  for (const [codepoint, names] of Object.entries(MARK_NAMES)) {
    if (names.includes(markName)) return BELOW.has(Number(codepoint));
  }
  return false;
}

/** How far above the letter a mark should stand, in font units. */
export function gapFor(unitsPerEm: number, capital: boolean): number {
  return unitsPerEm * GAP * (capital ? CAPITAL_SHARE : 1);
}

/** Whether this letter is a capital, which is asked only about the gap. */
export function isCapital(base: string): boolean {
  return /^[A-Z]$/.test(base);
}
