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
  /*
   * Latin-1 and Latin Extended-A: English, then the rest of Europe.
   *
   * Everything in both decomposes the same way and is built the same way. What
   * stops a character being built is not having the base drawn or not having
   * the mark drawn, and anything that runs out is simply skipped -- so a mark
   * drawn tomorrow adds every letter that uses it without a line being changed
   * here.
   */
  const wanted = [
    ...Array.from({ length: 0x17f - 0xc0 + 1 }, (_, index) => 0xc0 + index),
    0x0218,
    0x0219,
    0x021a,
    0x021b,
  ];
  for (const code of wanted) {
    const decomposed = decomposeCodepoint(code);
    if (!decomposed) continue;

    const found = nameForCodepoint(decomposed.base, drawable);
    if (!found) continue;
    const marks = decomposed.marks
      .map((mark) => nameForCodepoint(mark, drawable))
      .map((mark, index) => below(code, decomposed.marks[index], mark, drawable));
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

/**
 * A comma under the letter where the name says there is one.
 *
 * Unicode decomposes the Latvian and Romanian letters with the cedilla, which
 * is a fact about the encoding rather than about the shape: the glyphs are
 * named `commaaccent` because a comma is what belongs there, and set with a
 * cedilla they are wrong in the way a reader of the language notices at once.
 *
 * Asked of the name rather than of a list of letters, so it is the same
 * decision the naming already made.
 */
function below(
  code: number,
  mark: number,
  found: string | null,
  drawable: ReadonlySet<string>,
): string | null {
  if (mark !== 0x0327 || found === null) return found;
  const name = accentedNameFor(code);
  if (!name?.toLowerCase().includes("commaaccent")) return found;
  /*
   * Over the g rather than under it, turned, which is what every font with a
   * ģ does. The room below a g is where its descender already is, so a mark
   * hung from the foot of one starts at the bottom of the line and goes on
   * from there.
   */
  const wanted = name === "gcommaaccent" ? "commaturnedabove" : "commaaccent";
  return drawable.has(wanted) ? wanted : null;
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

/*
 * And Latin Extended-A, which is where the rest of Europe is.
 *
 * Latin-1 sets the languages of the western edge and stops: no Polish, no
 * Czech, no Hungarian, no Turkish, no Latvian, no Lithuanian, no Croatian, no
 * Romanian, no Welsh, no Maltese. Ninety-six of these hundred and twenty-eight
 * are the letters already drawn under the marks already drawn, so what was
 * keeping them out was the number this list used to stop at.
 *
 * Written out in Unicode's order, one name per character, so the index into it
 * is the codepoint. Nineteen of them have no decomposition and are not built
 * here -- the crossed d and h, the Polish l, the ligatures, the eng -- but they
 * are named anyway, because the name is the same fact whoever draws it.
 */
const LATIN_A_NAMES = `Amacron amacron Abreve abreve Aogonek aogonek
Cacute cacute Ccircumflex ccircumflex Cdotaccent cdotaccent Ccaron ccaron
Dcaron dcaron Dcroat dcroat
Emacron emacron Ebreve ebreve Edotaccent edotaccent Eogonek eogonek Ecaron ecaron
Gcircumflex gcircumflex Gbreve gbreve Gdotaccent gdotaccent Gcommaaccent gcommaaccent
Hcircumflex hcircumflex Hbar hbar
Itilde itilde Imacron imacron Ibreve ibreve Iogonek iogonek Idotaccent dotlessi
IJ ij Jcircumflex jcircumflex
Kcommaaccent kcommaaccent kgreenlandic
Lacute lacute Lcommaaccent lcommaaccent Lcaron lcaron Ldot ldot Lslash lslash
Nacute nacute Ncommaaccent ncommaaccent Ncaron ncaron napostrophe Eng eng
Omacron omacron Obreve obreve Ohungarumlaut ohungarumlaut OE oe
Racute racute Rcommaaccent rcommaaccent Rcaron rcaron
Sacute sacute Scircumflex scircumflex Scedilla scedilla Scaron scaron
Tcommaaccent tcommaaccent Tcaron tcaron Tbar tbar
Utilde utilde Umacron umacron Ubreve ubreve Uring uring Uhungarumlaut uhungarumlaut
Uogonek uogonek
Wcircumflex wcircumflex Ycircumflex ycircumflex Ydieresis
Zacute zacute Zdotaccent zdotaccent Zcaron zcaron longs`
  .split(/\s+/)
  .filter(Boolean);

/*
 * And four out of Latin Extended-B, for Romanian.
 *
 * Romanian's s and t take a comma below, and Unicode gives them characters of
 * their own out here because the ones back in Extended-A take a cedilla and
 * are Turkish. The two pairs are genuinely different letters in different
 * languages, and a font that has only the cedilla pair sets Romanian the way
 * everybody's did for twenty years and nobody in Romania liked.
 *
 * The T is the same drawing either way -- Extended-A's is named for the comma
 * and drawn with one -- so it takes the second codepoint rather than a second
 * glyph. The S is not: the cedilla one is Turkish and stays as it is.
 */
const EXTENDED_B_NAMES: Record<number, string> = {
  0x0218: "Scommaaccent",
  0x0219: "scommaaccent",
  0x021a: "Tcommaaccent",
  0x021b: "tcommaaccent",
};

export function accentedNameFor(codepoint: number): string | null {
  if (codepoint >= 0xc0 && codepoint <= 0xff) return LATIN1_NAMES[codepoint - 0xc0] ?? null;
  if (codepoint >= 0x100 && codepoint <= 0x17f) return LATIN_A_NAMES[codepoint - 0x100] ?? null;
  return EXTENDED_B_NAMES[codepoint] ?? null;
}

/** The codepoint an accented letter is drawn for. */
const BY_NAME = new Map<string, number>([
  // Extended-B first, so the two names that appear in both keep the codepoint
  // Extended-A gave them: a T named for a comma is the Extended-A character
  // and carries the Extended-B one as a second, which is what `ALSO` says.
  ...Object.entries(EXTENDED_B_NAMES).map(
    ([code, name]) => [name, Number(code)] as [string, number],
  ),
  ...LATIN1_NAMES.map((name, index) => [name, 0xc0 + index] as [string, number]),
  ...LATIN_A_NAMES.map((name, index) => [name, 0x100 + index] as [string, number]),
]);

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
