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

import { ALSO_DRAWS, codepointOfAccented } from "./accents";
import { readyToShape } from "./layers";
import { correctDirection } from "@/font/outline";
import { removeOverlaps } from "@/font/overlap";
import { DEFAULT_PARAMS, emptyTypeface, type Glyph, type Typeface } from "@/font/types";
import { builtFrom, letterNames } from "./build";
import { openWaveBook, type WaveBook } from "./shapes";
import { kernsFor } from "./kern";
import { anythingCut, draw, drawnEnds, drawnHigh, proof, type Forge } from "./document";
import {
  alternateName,
  boundaryEnds,
  boundaryName,
  boundaryRules,
  joinRules,
  joinsUp,
} from "./joins";

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
  ...Object.fromEntries(
    Object.entries(ALSO_DRAWS).map(([name, characters]) => [
      name,
      [...characters].map((one) => one.codePointAt(0)!),
    ]),
  ),
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

/**
 * Every character this glyph is the drawing of.
 *
 * A letter named after itself is that character. Anything else is looked up,
 * and either way the glyph may answer to more characters than one -- which
 * used to be true only of the letters that are not named after themselves,
 * because this returned as soon as it had recognised a one-character name. An
 * `A` is also a Greek capital alpha and a Cyrillic capital a, and it said it
 * was neither.
 */
export function codepointsFor(name: string): number[] {
  const also = ALSO[name] ?? [];
  if (name.length === 1) {
    const one = name.codePointAt(0);
    return one === undefined ? also : [one, ...also];
  }
  const first = CODEPOINTS[name] ?? MARK_CODEPOINTS[name] ?? codepointOfAccented(name) ?? null;
  return first === null ? also : [first, ...also];
}

export function codepointFor(name: string): number | null {
  return codepointsFor(name)[0] ?? null;
}

export interface ForgeExportOptions {
  familyName: string;
  styleName: string;
  /**
   * The run lengths this family's waves are counted off: see `WaveBook`.
   *
   * Passed by the family builder, which fills it from the drawn weight and
   * hands the same book to every other master. Left out everywhere else -- a
   * letter drawn on its own is drawn at its own weight, which is what the
   * editor is showing.
   */
  waves?: WaveBook;
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
  /**
   * Work the kerning out from the letters.
   *
   * Off by default and on for anything leaving the application, because it is a
   * quarter of a second's measuring on a font of five hundred characters -- fine
   * once, when a file is written, and not fine on every touch of a slider.
   */
  kern?: boolean;
  /**
   * Bake in what the tool left.
   *
   * On for anything leaving the application and off everywhere else, which is
   * the same bargain `merge` and `kern` already make and for a sharper version
   * of the same reason. The roughening touches every point of every outline and
   * then resolves the result with a boolean; across four hundred and fifty-two
   * letters that is the better part of half a minute, which is fine once when a
   * file is written and impossible on every touch of a slider.
   *
   * While the font is being worked on it is shown on one letter, in the
   * proofing panel, and on nothing else. This is where it reaches the rest.
   */
  effects?: boolean;
}

/**
 * Turn a forged font into a typeface the rest of the application understands.
 *
 * Slow enough to be worth doing on request rather than on every keystroke: the
 * boolean fuse is the expensive part, and it is only needed on the way out.
 */
export async function toTypeface(forge: Forge, options: ForgeExportOptions): Promise<Typeface> {
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
  if (anythingCut(forge)) await readyToShape();

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

  // Opened for the drawing and put back after it, because it is module state
  // and whoever was using it is owed it back: see `WaveBook`.
  const hadWaves = openWaveBook(options.waves ?? null);
  try {
    const names = letterNames();
    for (let at = 0; at < names.length; at++) {
      const name = names[at];
      /*
       * Handed back to the browser every so often, so a textured export does not
       * look like a hung page.
       *
       * A plain font is drawn in a couple of seconds and would not need this. One
       * with a rough edge on it is twenty times that, and twenty-five seconds of
       * one unbroken task is a window that answers nothing -- no spinner turns,
       * no button can be pressed, and some browsers offer to kill the tab. The
       * work is not made any shorter by breaking it up; it is made survivable.
       */
      if (options.effects && at % 12 === 0) await Promise.resolve();
      const drawn = options.effects ? proof(name, forge) : draw(name, forge);
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
  } finally {
    openWaveBook(hadWaves);
  }

  /*
   * Noted before any alternate is added, because these are the names a shaper
   * can be looking at when it decides whether a join has anything to meet, and
   * an alternate is not one of them: `joinEnds` answers for letters, and asked
   * about `v.init` it would say a letter that hands on does not.
   */
  const plain = glyphs.map((glyph) => glyph.name);

  /*
   * And the second drawings, for the faces whose letters reach each other.
   *
   * A written `o`, `v`, `w` and `b` hand over at the waist where every other
   * letter hands over at the baseline. That is a fact about the pair, so it
   * cannot live in either letter: the glyphs above all meet at the low seam,
   * which is what makes the font right in a renderer that never applies a
   * feature, and the high hand-over is carried here as alternates a shaper
   * swaps in when the pair actually occurs.
   *
   * Both halves are swapped, never only the second. Swapping only the letter
   * that follows would need the `o` above to be drawn high already, and then a
   * renderer that skipped the feature would join every one of those pairs high
   * to low -- which is the broken font this exists to avoid.
   */
  const joined = joinsUp(forge);
  if (joined.length > 0) {
    const before = glyphs.length;
    for (const [name, which] of joined) {
      const drawn = drawnHigh(name, which, forge);
      if (!drawn) continue;
      glyphs.push({
        name: alternateName(name, which),
        // No codepoint. These are reached only through the feature, and a
        // second glyph mapped to the same character is a font that renders
        // differently depending on which one a tool happens to pick.
        unicodes: [],
        advanceWidth: drawn.advanceWidth,
        contours: drawn.contours,
        components: [],
        anchors: [],
        params: {},
        dirty: false,
      });
    }
    if (glyphs.length > before) typeface.alternates = joinRules(joined);
  }

  /*
   * And the two ends of a word, which is the other thing a shaper has to be
   * told about a joined face.
   *
   * The letter as `cmap` maps it reaches out on both sides, because that is
   * what makes the font right in a renderer that applies nothing. A word set
   * from those alone begins and ends with a stroke reaching towards a letter
   * that is not there, so the first letter of one and the last are drawn again
   * without the half that has nothing to meet.
   */
  const edges = boundaryEnds(forge);
  if (edges.length > 0) {
    const before = glyphs.length;
    for (const [name, which] of edges) {
      const drawn = drawnEnds(name, which, forge);
      if (!drawn) continue;
      glyphs.push({
        name: boundaryName(name, which),
        unicodes: [],
        advanceWidth: drawn.advanceWidth,
        contours: drawn.contours,
        components: [],
        anchors: [],
        params: {},
        dirty: false,
      });
    }
    /*
     * Ahead of the hand-over rules, and the order is the whole of why it
     * works. A lookup matches the letter `cmap` maps, so once a letter has
     * been swapped no later lookup recognises it -- and of the two, the one
     * that has to win is this. Run second, a word ending `on` would already
     * be `o.medi n.init` and the `n` would keep a lead-out into the space,
     * which no reordering can take back. Run first, that pair simply does not
     * get the hand-over at the waist and joins at the baseline instead, which
     * is what the letters do anyway with no feature applied at all.
     */
    if (glyphs.length > before) {
      typeface.alternates = [...boundaryRules(edges, plain), ...typeface.alternates];
    }
  }

  typeface.glyphs = glyphs;
  typeface.glyphIndex = new Map(glyphs.map((glyph, index) => [glyph.name, index]));

  /*
   * And the kerning, measured off the letters that were just drawn.
   *
   * It has to be here rather than in a table somebody keeps up to date, because
   * there is no drawing to keep it up to date against: turn the weight up and
   * every edge in the alphabet moves, and a pair measured at one weight is
   * wrong at the next.
   */
  if (options.kern) {
    // Which glyphs are marks is not something the kerning can work out by
    // looking: it is whether some letter here is built by stacking it on
    // another, which is written down where the accented letters are.
    const marks = new Set<string>();
    for (const name of letterNames()) {
      for (const mark of builtFrom(name)?.marks ?? []) marks.add(mark);
    }
    typeface.kernClasses = kernsFor(
      glyphs.map((glyph) => ({
        name: glyph.name,
        contours: glyph.contours,
        advanceWidth: glyph.advanceWidth,
        sameAs: builtFrom(glyph.name)?.base,
        mark: marks.has(glyph.name),
      })),
      typeface.unitsPerEm,
    ).classes;
  }
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
  const inner = box(metrics.sidebearing + inset, inset, width - inset * 2, height - inset * 2);
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
