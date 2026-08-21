/**
 * Handing an assembled font to the rest of the application.
 *
 * The same bridge the forge has, for the same reason: everything downstream --
 * the grid, the spacing table, the kerning view, the checks, and the two
 * exporters that write real TrueType and OpenType -- speaks in glyphs with
 * outlines, so a font that was assembled rather than drawn only has to be
 * turned into that shape once and it inherits the lot.
 *
 * Two things happen here that do not happen anywhere else in this half. The
 * strokes are fused, because artwork drawn by hand overlaps constantly and a
 * font file cannot carry an overlap. And the winding is corrected, because
 * nothing about the file a drawing arrived in says which way round its
 * contours run, and a counter that runs the wrong way is a solid blob.
 */

import { correctDirection } from "@/font/outline";
import { removeOverlaps } from "@/font/overlap";
import { DEFAULT_PARAMS, emptyTypeface, type Glyph, type Typeface } from "@/font/types";
import { ready as readyToCut } from "@/font/boolean";
import { anythingCut, build, type Assembly } from "./document";
import { glyphNameFor } from "./slots";

export interface AssembleExportOptions {
  familyName: string;
  styleName: string;
  /** Fuse the overlapping contours. Off is for looking at the pieces. */
  merge: boolean;
}

export async function toTypeface(
  assembly: Assembly,
  options: AssembleExportOptions,
): Promise<Typeface> {
  const { metrics } = assembly;
  // Before build(), which is where the cutting happens and which keeps its
  // answer: a pile built once without the library would stay uncut.
  if (anythingCut(assembly)) await readyToCut();
  const assembled = build(assembly);

  const typeface = emptyTypeface();
  typeface.meta = {
    ...typeface.meta,
    familyName: options.familyName,
    styleName: options.styleName,
    copyright: `${options.familyName}. Assembled from drawings.`,
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

  const glyphs: Glyph[] = [notdef(assembly)];
  const named = new Map<string, string>();

  for (const letter of assembled.letters) {
    let contours = correctDirection(letter.contours, "truetype");
    if (options.merge && contours.length > 1) {
      contours = correctDirection(await removeOverlaps(contours), "truetype");
    }
    const name = glyphNameFor(letter.character);
    named.set(letter.character, name);
    glyphs.push({
      name,
      unicodes: [letter.character.codePointAt(0) ?? 0],
      advanceWidth: Math.round(letter.advanceWidth),
      contours,
      components: [],
      anchors: [],
      params: {},
      dirty: false,
    });
  }

  typeface.glyphs = glyphs;
  typeface.glyphIndex = new Map(glyphs.map((glyph, index) => [glyph.name, index]));
  // Kerning is stored against characters while it is being worked on, because
  // that is what the pairs are shown as, and against glyph names once it
  // leaves, because that is what a font file addresses.
  typeface.kerning = assembled.kerning
    .filter((pair) => named.has(pair.left) && named.has(pair.right))
    .map((pair) => ({
      left: named.get(pair.left)!,
      right: named.get(pair.right)!,
      value: Math.round(pair.value),
    }));
  return typeface;
}

/** The box shown in place of a character the font does not have. */
function notdef(assembly: Assembly): Glyph {
  const { capHeight, unitsPerEm } = assembly.metrics;
  const width = capHeight * 0.52;
  const inset = unitsPerEm * 0.05;
  const side = unitsPerEm * 0.06;
  const box = (x: number, y: number, w: number, h: number) => ({
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
