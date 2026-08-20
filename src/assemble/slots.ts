/**
 * The character a drawing goes into.
 *
 * Assembling starts from an empty set of slots rather than from a pile of
 * files, and the difference matters more than it sounds. A pile has to be
 * interpreted -- which of these is the g? -- and the answer comes from a file
 * name, which is a guess about somebody else's habits. A slot asks nothing:
 * you point at the box marked A and give it the drawing you want there. What
 * the file is called stops being anybody's problem.
 *
 * The set is Latin-1: everything on a keyboard, and the accented letters that
 * most European languages need. That is around a hundred and ninety boxes,
 * which is a lot to fill by hand and exactly the number a font needs to be
 * usable outside English -- so they are grouped, and nothing says you have to
 * fill them all.
 */

/** Which band of the character set a slot belongs to, for grouping the boxes. */
export type SlotGroup =
  | "Capitals"
  | "Lowercase"
  | "Figures"
  | "Punctuation"
  | "Symbols"
  | "Accented capitals"
  | "Accented lowercase";

export interface Slot {
  character: string;
  /** What the character is called in a font file. */
  name: string;
  group: SlotGroup;
  /** Said on hover, for the ones whose shape does not say what they are. */
  label: string;
}

/*
 * Names as the font world gives them, in codepoint order.
 *
 * Written out rather than derived, because these are a convention rather than
 * a rule: a font whose comma is called `comma` is one every other tool
 * understands, and one whose comma is called `uni002C` is legal, works, and
 * makes everybody's life slightly harder for no reason.
 */
const NAMES_20_40 = `space exclam quotedbl numbersign dollar percent ampersand quotesingle
parenleft parenright asterisk plus comma hyphen period slash
zero one two three four five six seven eight nine
colon semicolon less equal greater question at`
  .split(/\s+/)
  .filter(Boolean);

const NAMES_5B_60 = "bracketleft backslash bracketright asciicircum underscore grave".split(" ");
const NAMES_7B_7E = "braceleft bar braceright asciitilde".split(" ");

const NAMES_A1_BF = `exclamdown cent sterling currency yen brokenbar section
dieresis copyright ordfeminine guillemotleft logicalnot hyphensoft registered macron
degree plusminus twosuperior threesuperior acute mu paragraph periodcentered
cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown`
  .split(/\s+/)
  .filter(Boolean);

const NAMES_C0_FF = `Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla
Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis
Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply
Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls
agrave aacute acircumflex atilde adieresis aring ae ccedilla
egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis
eth ntilde ograve oacute ocircumflex otilde odieresis divide
oslash ugrave uacute ucircumflex udieresis yacute thorn ydieresis`
  .split(/\s+/)
  .filter(Boolean);

/** What a character is called in a font file. */
export function glyphNameFor(character: string): string {
  const code = character.codePointAt(0);
  if (code === undefined) return "unknown";
  if (code >= 0x20 && code <= 0x40) return NAMES_20_40[code - 0x20];
  if (code >= 0x41 && code <= 0x5a) return character;
  if (code >= 0x5b && code <= 0x60) return NAMES_5B_60[code - 0x5b];
  if (code >= 0x61 && code <= 0x7a) return character;
  if (code >= 0x7b && code <= 0x7e) return NAMES_7B_7E[code - 0x7b];
  if (code >= 0xa1 && code <= 0xbf) return NAMES_A1_BF[code - 0xa1];
  if (code >= 0xc0 && code <= 0xff) return NAMES_C0_FF[code - 0xc0];
  return `uni${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** The one word that says what a mark is, where its shape does not. */
const LABELS: Record<string, string> = {
  " ": "space",
  "!": "exclamation mark",
  '"': "double quote",
  "#": "number sign",
  $: "dollar",
  "%": "per cent",
  "&": "ampersand",
  "'": "apostrophe",
  "(": "left parenthesis",
  ")": "right parenthesis",
  "*": "asterisk",
  "+": "plus",
  ",": "comma",
  "-": "hyphen",
  ".": "full stop",
  "/": "slash",
  ":": "colon",
  ";": "semicolon",
  "<": "less than",
  "=": "equals",
  ">": "greater than",
  "?": "question mark",
  "@": "at",
  "[": "left bracket",
  "\\": "backslash",
  "]": "right bracket",
  "^": "circumflex",
  _: "underscore",
  "`": "grave",
  "{": "left brace",
  "|": "bar",
  "}": "right brace",
  "~": "tilde",
};

function groupFor(code: number): SlotGroup | null {
  if (code >= 0x41 && code <= 0x5a) return "Capitals";
  if (code >= 0x61 && code <= 0x7a) return "Lowercase";
  if (code >= 0x30 && code <= 0x39) return "Figures";
  if (code >= 0x20 && code <= 0x7e) {
    // Everything else on a keyboard: the marks that punctuate, and the rest.
    return ".,;:!?'\"()[]{}-/\\ ".includes(String.fromCodePoint(code))
      ? "Punctuation"
      : "Symbols";
  }
  if (code >= 0xa1 && code <= 0xbf) return "Symbols";
  if (code >= 0xc0 && code <= 0xff) {
    // The two arithmetic signs sitting in the middle of the accented letters.
    if (code === 0xd7 || code === 0xf7) return "Symbols";
    return code <= 0xde ? "Accented capitals" : "Accented lowercase";
  }
  return null;
}

function build(): Slot[] {
  const slots: Slot[] = [];
  const add = (code: number) => {
    // The two invisible ones. A non-breaking space and a soft hyphen have no
    // shape to draw, so a box for either would be a box nobody can fill.
    if (code === 0xa0 || code === 0xad) return;
    const group = groupFor(code);
    if (!group) return;
    const character = String.fromCodePoint(code);
    slots.push({
      character,
      name: glyphNameFor(character),
      group,
      label: LABELS[character] ?? glyphNameFor(character),
    });
  };
  for (let code = 0x20; code <= 0x7e; code++) add(code);
  for (let code = 0xa1; code <= 0xff; code++) add(code);
  return slots;
}

export const SLOTS: Slot[] = build();

/** The order the groups are shown in, which is the order somebody fills them. */
export const SLOT_GROUPS: SlotGroup[] = [
  "Capitals",
  "Lowercase",
  "Figures",
  "Punctuation",
  "Symbols",
  "Accented capitals",
  "Accented lowercase",
];

export function slotsIn(group: SlotGroup): Slot[] {
  return SLOTS.filter((slot) => slot.group === group);
}

const BY_CHARACTER = new Map(SLOTS.map((slot) => [slot.character, slot]));

export function slotFor(character: string): Slot | undefined {
  return BY_CHARACTER.get(character);
}
