/**
 * Handing a forged font to the rest of the application.
 *
 * Everything downstream of this point already exists and already works: the
 * grid, the spacing table, the kerning view, the checks, and the two exporters
 * that write real TrueType and OpenType files. All of it speaks in glyphs with
 * outlines, so a font that was drawn rather than opened only has to be turned
 * into that shape once and it inherits the lot.
 *
 * The strokes are fused here rather than left overlapping. Overlap is fine to
 * look at and fine to edit -- it is how a serif is drawn -- but a font file
 * cannot carry it: under the even-odd rule some renderers and most print
 * pipelines apply, the overlapping region drops out and leaves a hole where the
 * ink should be. So this is the one place the boolean geometry has to run, and
 * it is the last thing that happens before the letters leave.
 */

import { codepointOfAccented } from "./accents";
import { ready as readyToCut } from "@/font/boolean";
import { correctDirection } from "@/font/outline";
import { removeOverlaps } from "@/font/overlap";
import {
  DEFAULT_PARAMS,
  emptyTypeface,
  type Glyph,
  type Typeface,
} from "@/font/types";
import { letterNames } from "./build";
import { anythingCut, draw, type Forge } from "./document";

/**
 * What each drawn glyph is called in Unicode.
 *
 * Letters and figures are named after themselves, which is what the recipes use
 * as keys; the marks have the names the font world already uses for them, so a
 * file written from here has a `period` where every other font has one.
 */
const CODEPOINTS: Record<string, number> = {
  space: 0x20,
  exclam: 0x21,
  quotedbl: 0x22,
  quotesingle: 0x27,
  parenleft: 0x28,
  parenright: 0x29,
  comma: 0x2c,
  hyphen: 0x2d,
  period: 0x2e,
  slash: 0x2f,
  zero: 0x30,
  one: 0x31,
  two: 0x32,
  three: 0x33,
  four: 0x34,
  five: 0x35,
  six: 0x36,
  seven: 0x37,
  eight: 0x38,
  nine: 0x39,
  colon: 0x3a,
  semicolon: 0x3b,
  question: 0x3f,

  // The symbols. Named as the type world names them, so a file written here
  // has a `sterling` and an `asciitilde` where every other font has one.
  numbersign: 0x23,
  dollar: 0x24,
  percent: 0x25,
  ampersand: 0x26,
  asterisk: 0x2a,
  plus: 0x2b,
  less: 0x3c,
  equal: 0x3d,
  greater: 0x3e,
  at: 0x40,
  bracketleft: 0x5b,
  backslash: 0x5c,
  bracketright: 0x5d,
  asciicircum: 0x5e,
  underscore: 0x5f,
  braceleft: 0x7b,
  bar: 0x7c,
  braceright: 0x7d,
  asciitilde: 0x7e,
  exclamdown: 0xa1,
  cent: 0xa2,
  sterling: 0xa3,
  currency: 0xa4,
  yen: 0xa5,
  brokenbar: 0xa6,
  section: 0xa7,
  copyright: 0xa9,
  ordfeminine: 0xaa,
  guillemotleft: 0xab,
  logicalnot: 0xac,
  registered: 0xae,
  degree: 0xb0,
  plusminus: 0xb1,
  twosuperior: 0xb2,
  threesuperior: 0xb3,
  mu: 0xb5,
  paragraph: 0xb6,
  periodcentered: 0xb7,
  onesuperior: 0xb9,
  ordmasculine: 0xba,
  guillemotright: 0xbb,
  onequarter: 0xbc,
  onehalf: 0xbd,
  threequarters: 0xbe,
  questiondown: 0xbf,
  multiply: 0xd7,
  divide: 0xf7,
};

/**
 * The glyphs that answer to more than one character.
 *
 * A spacing grave and a combining one are the same tick at the same height, and
 * every font that carries both draws it once. Drawn twice here it would be two
 * glyphs to keep in step, and the day the accent changed one of them would not.
 */
const ALSO: Record<string, number[]> = {
  grave: [0x0060],
  // Romanian's comma-below T, which is the same drawing as the one Extended-A
  // names for a comma and draws with one. Two characters, one glyph.
  Tcommaaccent: [0x021a],
  tcommaaccent: [0x021b],
};

/*
 * The rest of them, worked out rather than listed.
 *
 * Latin-1 is a run of consecutive codepoints and the names for it are already
 * written down, in the file that builds the accented letters. Copying them here
 * would be the same hundred names twice, and the second copy is the one that
 * goes wrong.
 */
const MARK_CODEPOINTS: Record<string, number> = {
  // The marks that Latin-1 also carries as characters in their own right.
  dieresis: 0xa8,
  macron: 0xaf,
  acute: 0xb4,
  cedilla: 0xb8,
  // The rest are combining, and are given the combining codepoints so a shaper
  // can use them on letters this font never precomposed.
  grave: 0x0300,
  circumflex: 0x0302,
  tilde: 0x0303,
  breve: 0x0306,
  dotaccent: 0x0307,
  ring: 0x030a,
  caron: 0x030c,
  /*
   * The three that Latin Extended-A brought with it. Two have a character of
   * their own in the spacing-modifier block and are given it, the same way the
   * Latin-1 marks above are; the comma below has none, so it takes the
   * combining codepoint and nothing else.
   */
  ogonek: 0x02db,
  hungarumlaut: 0x02dd,
  commaaccent: 0x0326,
  commaturnedabove: 0x0312,
  // Dotless forms, which an accented i is built on and which text can use.
  dotlessi: 0x0131,
  dotlessj: 0x0237,
};

/** Every character this glyph is the drawing of. */
export function codepointsFor(name: string): number[] {
  if (name.length === 1) {
    const one = name.codePointAt(0);
    return one === undefined ? [] : [one];
  }
  const first = CODEPOINTS[name] ?? MARK_CODEPOINTS[name] ?? codepointOfAccented(name) ?? null;
  return first === null ? (ALSO[name] ?? []) : [first, ...(ALSO[name] ?? [])];
}

export function codepointFor(name: string): number | null {
  return codepointsFor(name)[0] ?? null;
}

export interface ForgeExportOptions {
  familyName: string;
  styleName: string;
  /**
   * How heavy this member of the family is, from 100 to 900.
   *
   * Said rather than guessed from the style name, because the file has to
   * carry it and a name is not a number: a font menu sorts a family by this
   * and by nothing else.
   */
  weightClass?: number;
  /**
   * Fuse the overlapping strokes.
   *
   * On for anything leaving the application. Off is for looking at the pieces,
   * and for tests that want to count strokes rather than letters.
   */
  merge: boolean;
}

/**
 * Turn a forged font into a typeface the rest of the application understands.
 *
 * Slow enough to be worth doing on request rather than on every keystroke: the
 * boolean fuse is the expensive part, and it is only needed on the way out.
 */
export async function toTypeface(
  forge: Forge,
  options: ForgeExportOptions,
): Promise<Typeface> {
  /*
   * The library the cuts are made of, before a single letter is drawn.
   *
   * Everywhere else a letter that arrives uncut for one frame is nothing worth
   * mentioning. Here it would be a font file with the cuts missing from it,
   * which is the one place this cannot be allowed to happen quietly.
   *
   * The letters that hold their own cutting count, which is why the question
   * is asked of the document rather than of its settings.
   */
  if (anythingCut(forge)) await readyToCut();

  const { metrics } = forge.style;
  const typeface = emptyTypeface();
  typeface.meta = {
    ...typeface.meta,
    familyName: options.familyName,
    styleName: options.styleName,
    weightClass: options.weightClass ?? 400,
    // Said plainly in the file itself, because it is the reason this half of
    // the application exists.
    copyright: `${options.familyName}. Drawn from a skeleton; not derived from any existing typeface.`,
  };
  typeface.unitsPerEm = metrics.unitsPerEm;
  typeface.metrics = {
    ascender: metrics.ascender,
    descender: metrics.descender,
    capHeight: metrics.capHeight,
    xHeight: metrics.xHeight,
    lineGap: 0,
  };
  typeface.params = { ...DEFAULT_PARAMS };

  const glyphs: Glyph[] = [];
  // .notdef first, as every font must: the box a renderer shows when it has
  // nothing else to show.
  glyphs.push(notdef(forge));

  for (const name of letterNames()) {
    const drawn = draw(name, forge);
    if (!drawn) continue;
    let contours = drawn.contours;
    if (options.merge && contours.length > 1) {
      /*
       * Believed rather than guessed at, and set afterwards rather than
       * before. A letter out of the pen already says which of its contours is
       * a counter, by which way round the sweep drew it -- so the fuse is told
       * `winding` and reads it. Told to work it out by nesting instead it
       * filled the counter of the single-storey a, because that counter sits
       * inside the ring and inside the stem laid across it, and two is even.
       *
       * Nothing sets the direction on the way in any more either. Nesting is
       * exactly as unreliable there, and on overlapping strokes it is worse
       * than unreliable: with no counter to be inside anything, an x is two
       * bars crossing and which of them counts as enclosed by the other moves
       * about with the weight.
       */
      contours = correctDirection(await removeOverlaps(contours, "winding"), "truetype");
    }
    glyphs.push({
      name,
      unicodes: codepointsFor(name),
      advanceWidth: drawn.advanceWidth,
      contours,
      components: [],
      anchors: [],
      params: {},
      dirty: false,
    });
  }

  typeface.glyphs = glyphs;
  typeface.glyphIndex = new Map(glyphs.map((glyph, index) => [glyph.name, index]));
  return typeface;
}

/** The box shown in place of a character the font does not have. */
function notdef(forge: Forge): Glyph {
  const { metrics, pen } = forge.style;
  const width = metrics.capHeight * 0.52;
  const height = metrics.capHeight;
  const inset = pen.weight * 0.6;
  const box = (x: number, y: number, w: number, h: number) => ({
    closed: true,
    nodes: [
      { point: { x, y }, handleIn: null, handleOut: null, type: "corner" as const },
      { point: { x: x + w, y }, handleIn: null, handleOut: null, type: "corner" as const },
      { point: { x: x + w, y: y + h }, handleIn: null, handleOut: null, type: "corner" as const },
      { point: { x, y: y + h }, handleIn: null, handleOut: null, type: "corner" as const },
    ],
  });
  const outer = box(metrics.sidebearing, 0, width, height);
  const inner = box(
    metrics.sidebearing + inset,
    inset,
    width - inset * 2,
    height - inset * 2,
  );
  inner.nodes.reverse();
  return {
    name: ".notdef",
    unicodes: [],
    advanceWidth: width + metrics.sidebearing * 2,
    contours: [outer, inner],
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}
