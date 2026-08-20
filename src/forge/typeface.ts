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

import { correctDirection } from "@/font/outline";
import { removeOverlaps } from "@/font/overlap";
import {
  DEFAULT_PARAMS,
  emptyTypeface,
  type Glyph,
  type Typeface,
} from "@/font/types";
import { letterNames } from "./build";
import { draw, type Forge } from "./document";

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
};

export function codepointFor(name: string): number | null {
  if (name.length === 1) return name.codePointAt(0) ?? null;
  return CODEPOINTS[name] ?? null;
}

export interface ForgeExportOptions {
  familyName: string;
  styleName: string;
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
  const { metrics } = forge.style;
  const typeface = emptyTypeface();
  typeface.meta = {
    ...typeface.meta,
    familyName: options.familyName,
    styleName: options.styleName,
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
      contours = correctDirection(await removeOverlaps(correctDirection(contours, "truetype")), "truetype");
    }
    const codepoint = codepointFor(name);
    glyphs.push({
      name,
      unicodes: codepoint === null ? [] : [codepoint],
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
