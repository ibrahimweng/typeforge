/**
 * Handing a traced font to the rest of the application.
 *
 * The same job `forge/typeface.ts` does next door, and it exists for the same
 * reason: everything downstream -- the grid, the checks, and the two exporters
 * that write real TrueType and OpenType -- speaks in glyphs with outlines, so a
 * font recovered as strokes only has to be turned into that shape once and it
 * inherits the lot.
 *
 * Two things here are not in the forge's version, and both come from what a
 * traced font *is*.
 *
 * The metrics are measured rather than declared. A forged font knows its own
 * x-height because somebody typed it; a traced one has only letters, so the
 * lines are read off the drawn ink -- the flat-topped lowercase for the
 * x-height, `H` for the capitals, the tallest ascender and the deepest
 * descender for the rest. That is the same ruler `scripts/likeness.ts` uses,
 * and for the same reason: a measurement off the drawing is a fact, and a
 * number carried over from the source file would be a claim about a font this
 * one is no longer identical to.
 *
 * And the copyright says what this is. The forge writes "not derived from any
 * existing typeface" because that is true there and it is the reason that half
 * of the application exists. It is not true here: recovering the strokes of a
 * typeface and redrawing them makes a derivative work of it, whatever the
 * representation in between. So the file says so, and names the font it came
 * from, because the one thing worse than a derivative work is one that has lost
 * track of what it derives from.
 */

import { ready as readyToCut } from "@/font/boolean";
import { contoursBounds } from "@/font/geometry";
import { correctDirection } from "@/font/outline";
import { removeOverlaps } from "@/font/overlap";
import { DEFAULT_PARAMS, emptyTypeface, type Glyph, type Typeface } from "@/font/types";
import type { Contour } from "@/font/types";
import { restyle, type QuillStyle } from "./controls";
import { sweepAll, toleranceFor } from "./sweep";
import type { Traced } from "./tracing";

/**
 * What the font world calls the characters that are not letters or figures.
 *
 * Letters keep their own name, as they do in every font. Everything else has a
 * name the rest of the world already agreed on, so a file written from here has
 * a `period` where every other font has one rather than a glyph called `.`
 * that no tool will recognise.
 */
const NAMES: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
  ".": "period",
  ",": "comma",
  ";": "semicolon",
  ":": "colon",
  "!": "exclam",
  "?": "question",
  "'": "quotesingle",
  '"': "quotedbl",
  "-": "hyphen",
};

/** The name a traced character takes in the exported file. */
export function nameOf(character: string): string {
  return NAMES[character] ?? character;
}

export interface QuillExportOptions {
  familyName: string;
  styleName: string;
  /** The file the strokes were read from, named in the copyright. */
  from: string;
  weightClass?: number;
}

/*
 * The letters each line is read from, and why each list is what it is.
 *
 * `FLAT` has a square top and a square foot, so neither the overshoot of a
 * round letter nor the apex of a pointed one is mistaken for the x-height.
 * The `i` is not in it, and its absence cost a test: its dot sits most of the
 * way to the ascender, so a set including it reports an x-height taller than
 * the capitals -- which is what this did on the first font it was pointed at.
 * The likeness harness keeps the `i` and survives it by taking a median; this
 * takes the median too, and leaves the letter out as well, because a rule that
 * needs two defences against the same letter is better off without it.
 */
const FLAT = ["n", "m", "u", "r", "x", "z"];
const CAPS = ["H", "E", "I", "T", "X"];
const ASCENDING = ["l", "b", "d", "h", "k"];
const DESCENDING = ["g", "p", "q", "y", "j"];

/** The middle of a sorted list, which is what a line off many letters is. */
function median(values: number[]): number {
  const sorted = [...values].sort((one, other) => one - other);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The lines of a font, read off its own ink.
 *
 * Every figure falls back to a fraction of the em, because a font missing its
 * whole lowercase is a font this cannot measure and a plausible number beats
 * nothing at all in a file that has to declare one.
 */
export function linesOf(drawn: Map<string, { contours: Contour[] }>, em: number) {
  const topsOf = (names: string[]): number[] =>
    names
      .map((name) => drawn.get(name))
      .filter((one) => one && one.contours.length > 0)
      .map((one) => contoursBounds(one!.contours).yMax)
      .filter((value) => Number.isFinite(value));

  /*
   * The x-height and the cap height are the middle of their set; the ascender
   * and the descender are its far end. That is not an inconsistency -- it is
   * what the four words mean. An x-height is where the lowercase sits, which a
   * median answers and one tall letter should not; an ascender is how far the
   * tallest letter reaches, which is a maximum by definition.
   */
  const flats = topsOf(FLAT);
  const caps = topsOf(CAPS);
  const tops = topsOf(ASCENDING);
  const feet = DESCENDING.map((name) => drawn.get(name))
    .filter((one) => one && one.contours.length > 0)
    .map((one) => contoursBounds(one!.contours).yMin)
    .filter((value) => Number.isFinite(value));

  const xHeight = flats.length > 0 ? median(flats) : Math.round(em * 0.5);
  const capHeight = caps.length > 0 ? median(caps) : Math.round(em * 0.7);
  const ascender =
    tops.length > 0 ? Math.max(...tops) : Math.max(capHeight, Math.round(em * 0.75));
  const descender = feet.length > 0 ? Math.min(...feet) : -Math.round(em * 0.2);
  return {
    xHeight: Math.round(xHeight),
    // Never above the capitals. On a face whose lowercase really does reach
    // higher -- some scripts do -- the two are reported as equal rather than
    // inverted, because a font declaring an x-height over its cap height is
    // read as broken by tools that check.
    capHeight: Math.round(Math.max(capHeight, xHeight)),
    ascender: Math.round(Math.max(ascender, capHeight)),
    // Never positive: a font declaring a descender above the baseline clips
    // its own tails in half the renderers that read it.
    descender: Math.round(Math.min(descender, 0)),
  };
}

/** The box shown in place of a character the font does not have. */
function notdef(capHeight: number, stroke: number): Glyph {
  const width = capHeight * 0.52;
  const side = Math.round(capHeight * 0.08);
  const inset = Math.max(8, stroke);
  const box = (x: number, y: number, w: number, h: number): Contour => ({
    closed: true,
    nodes: [
      { point: { x, y }, handleIn: null, handleOut: null, type: "corner" as const },
      { point: { x: x + w, y }, handleIn: null, handleOut: null, type: "corner" as const },
      { point: { x: x + w, y: y + h }, handleIn: null, handleOut: null, type: "corner" as const },
      { point: { x, y: y + h }, handleIn: null, handleOut: null, type: "corner" as const },
    ],
  });
  const outer = box(side, 0, width, capHeight);
  const inner = box(side + inset, inset, width - inset * 2, capHeight - inset * 2);
  inner.nodes.reverse();
  return {
    name: ".notdef",
    unicodes: [],
    advanceWidth: Math.round(width + side * 2),
    contours: [outer, inner],
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

/**
 * A traced font, drawn with the hand currently set, as a typeface.
 *
 * The overlaps are fused here rather than left alone, and on a traced font that
 * is not an optimisation but the whole difference between a file that works and
 * one that does not. A letter here is several strokes swept over each other --
 * an `a` is a bowl, a stem and an entry, and every one of them crosses its
 * neighbour. Left overlapping, the crossings drop out as holes under the
 * even-odd rule that some renderers and most print pipelines apply, and the
 * letter arrives with bites taken out of it.
 */
export async function toTypeface(
  letters: Traced[],
  style: QuillStyle,
  unitsPerEm: number,
  options: QuillExportOptions,
): Promise<Typeface> {
  await readyToCut();

  const em = unitsPerEm || 1000;

  /*
   * Every letter drawn once, before anything is measured.
   *
   * The hand is applied here and not later: the lines below are read off the
   * ink that will actually be written, so a face slanted twenty degrees or
   * bounced off its line declares the ascender it really has rather than the
   * one it had before the sliders moved.
   */
  const drawn = new Map<string, { contours: Contour[]; advanceWidth: number }>();
  for (const one of letters) {
    const moved = restyle(one.glyph, style);
    const swept = sweepAll(moved.strokes, toleranceFor(moved.unitsPerEm));
    if (swept.contours.length === 0) continue;
    drawn.set(one.glyph.name, {
      contours: swept.contours,
      advanceWidth: Math.round(moved.advanceWidth),
    });
  }

  const lines = linesOf(drawn, em);

  const typeface = emptyTypeface();
  typeface.meta = {
    ...typeface.meta,
    familyName: options.familyName,
    styleName: options.styleName,
    weightClass: options.weightClass ?? 400,
    copyright:
      `${options.familyName}. The strokes of ${options.from} recovered and redrawn: ` +
      `a derivative work of that font, and subject to its licence.`,
  };
  typeface.unitsPerEm = em;
  typeface.metrics = { ...lines, lineGap: 0 };
  typeface.params = { ...DEFAULT_PARAMS };

  // A stroke width to size the .notdef box's rule against, taken from the
  // narrowest letter rather than guessed.
  const stroke = Math.max(
    8,
    Math.round(
      Math.min(...[...drawn.values()].map((one) => {
        const box = contoursBounds(one.contours);
        return Number.isFinite(box.xMax - box.xMin) ? (box.xMax - box.xMin) * 0.12 : em * 0.05;
      }), em * 0.08),
    ),
  );

  const glyphs: Glyph[] = [notdef(lines.capHeight, stroke)];

  for (const [character, ink] of drawn) {
    /*
     * Read by nesting rather than by winding, which is the one place this
     * departs from the forge next door.
     *
     * The forge states which of its contours are counters by the direction it
     * draws them in, and can, because it drew them. A swept stroke does not:
     * the sweep walks one side out and the other back, and where two strokes
     * of a letter cross, the winding of the crossing is an accident of which
     * stroke the fitter happened to recover first. Nesting asks the question
     * the shape can actually answer -- which contour lies inside which.
     *
     * It has to be asked properly. Nesting used to be settled by one interior
     * point, and one point cannot tell a counter from an overlap: a traced `u`
     * comes back as the bowl and both stems, the foot of the right stem, and
     * the knot where they meet, and a point inside that foot lands in the
     * bowl's piece. The foot was read as a counter, punched out of its own
     * letter, and the union handed back four pieces with a seam across the
     * stem. `classifyContours` now asks whether the whole contour is inside.
     */
    const merged = await removeOverlaps(ink.contours, "nesting");
    const contours = correctDirection(merged.length > 0 ? merged : ink.contours, "truetype", "nesting");
    if (contours.length === 0) continue;
    glyphs.push({
      name: nameOf(character),
      unicodes: [character.codePointAt(0)!],
      advanceWidth: ink.advanceWidth,
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
