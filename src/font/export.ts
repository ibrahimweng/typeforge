/**
 * Producing a font file from the document model.
 *
 * Two formats and two fidelity modes:
 *
 * - **TrueType** builds `glyf` and `loca` directly. In preserve mode, glyphs the
 *   user never touched keep their original bytes, hinting instructions and all,
 *   and every table we do not model is copied straight through.
 * - **OpenType** hands the outlines to opentype.js, which owns CFF charstring
 *   encoding. That writer emits no kerning at all, so the kerning tables are
 *   injected into its output afterwards.
 *
 * Either way the kerning tables are ours, because nothing else available writes
 * them.
 */

import { Font as OpenTypeFont, Glyph as OpenTypeGlyph, Path as OpenTypePath } from "opentype.js";

import { contoursBounds } from "./geometry";
import { buildGlyfTables, splitGlyf, type GlyfBuildInput } from "./glyf";
import { buildGposTable, buildKernTable, type ResolvedClassKern, type ResolvedPair } from "./kern";
import { resolveGlyphContours } from "./transform";
import { readSfnt, writeSfnt, SFNT_TRUETYPE, type SfntFont } from "./sfnt";
import {
  buildCmap,
  buildHead,
  buildHhea,
  buildHmtx,
  buildMaxp,
  buildName,
  buildOs2,
  buildPost,
} from "./tables";
import type { Glyph, Typeface } from "./types";

export type ExportFormat = "ttf" | "otf";

/**
 * How much of the imported font to carry forward.
 *
 * - `preserve` keeps every table we did not modify, so ligatures, contextual
 *   alternates, hinting, colour layers and variation data survive.
 * - `rebuild` writes a font from only what the editor models. Smaller and
 *   entirely predictable, at the cost of dropping those features.
 */
export type ExportFidelity = "preserve" | "rebuild";

export interface ExportOptions {
  format: ExportFormat;
  fidelity: ExportFidelity;
  /**
   * Maximum error, in font units, when curves are converted to the quadratic
   * form TrueType stores. Half a unit is far below anything visible.
   */
  curveTolerance?: number;
  includeKerning?: boolean;
  /** Timestamps written into `head`. Passed in so output is reproducible. */
  now?: number;
}

export interface ExportResult {
  bytes: Uint8Array;
  format: ExportFormat;
  fidelity: ExportFidelity;
  fileName: string;
  /** Notes worth showing the user, such as features that could not be carried over. */
  notes: string[];
}

export function exportFont(typeface: Typeface, options: ExportOptions): ExportResult {
  const notes: string[] = [];
  const tolerance = options.curveTolerance ?? 0.5;
  const includeKerning = options.includeKerning ?? true;
  const now = options.now ?? Date.now();

  // A preserve export needs the original tables in the matching outline
  // flavour. Asking for TrueType from a PostScript source, or the reverse,
  // means there is nothing to preserve.
  let fidelity = options.fidelity;
  if (fidelity === "preserve") {
    if (!typeface.source) {
      fidelity = "rebuild";
      notes.push("No imported font to preserve from, so this was built from scratch.");
    } else if (options.format === "ttf" && typeface.source.isCFF) {
      fidelity = "rebuild";
      notes.push(
        "The imported font uses PostScript curves and you asked for TrueType, so it was rebuilt rather than preserved.",
      );
    } else if (options.format === "otf") {
      fidelity = "rebuild";
      notes.push(
        "OpenType export always rebuilds the font, because the curves have to be re-encoded.",
      );
    }
  }

  const bytes =
    options.format === "otf"
      ? exportOpenType(typeface, { tolerance, includeKerning, notes })
      : exportTrueType(typeface, { tolerance, includeKerning, fidelity, now, notes });

  const base = `${typeface.meta.familyName}-${typeface.meta.styleName}`.replace(/\s+/g, "");
  return {
    bytes,
    format: options.format,
    fidelity,
    fileName: `${base || "Untitled"}.${options.format}`,
    notes,
  };
}

/** Glyph outlines with the parametric stack applied, ready to encode. */
function resolvedGlyphs(typeface: Typeface) {
  return typeface.glyphs.map((glyph) => ({
    glyph,
    contours: resolveGlyphContours(glyph, typeface),
  }));
}

function exportTrueType(
  typeface: Typeface,
  context: {
    tolerance: number;
    includeKerning: boolean;
    fidelity: ExportFidelity;
    now: number;
    notes: string[];
  },
): Uint8Array {
  const resolved = resolvedGlyphs(typeface);
  const preserving = context.fidelity === "preserve" && typeface.source !== null;

  // In preserve mode an untouched glyph is copied rather than re-encoded, which
  // is what keeps its hinting intact.
  let originalRecords: Uint8Array[] = [];
  if (preserving) {
    const source = typeface.source!;
    const glyf = source.tables.get("glyf");
    const loca = source.tables.get("loca");
    const head = source.tables.get("head");
    if (glyf && loca && head) {
      const indexToLocFormat = new DataView(head.buffer, head.byteOffset, head.byteLength).getInt16(50);
      originalRecords = splitGlyf(glyf, loca, indexToLocFormat, typeface.glyphs.length);
    }
  }

  const familyChanged = hasFamilyEdits(typeface);
  const inputs: GlyfBuildInput[] = resolved.map((entry, index) => ({
    contours: entry.contours,
    original: originalRecords[index],
    rebuild: !preserving || familyChanged || entry.glyph.dirty || !originalRecords[index],
  }));

  const built = buildGlyfTables(inputs, context.tolerance);

  const metrics = resolved.map((entry) => {
    const bounds = contoursBounds(entry.contours);
    const hasOutline = entry.contours.some((contour) => contour.nodes.length > 0);
    return {
      advanceWidth: entry.glyph.advanceWidth,
      leftSideBearing: hasOutline ? Math.round(bounds.xMin) : 0,
    };
  });
  const { hmtx, numberOfHMetrics } = buildHmtx(metrics);

  const tables = preserving
    ? new Map(typeface.source!.tables)
    : new Map<string, Uint8Array>();

  tables.set("glyf", built.glyf);
  tables.set("loca", built.loca);
  tables.set("hmtx", hmtx);

  if (preserving) {
    patchHead(tables, built.bounds, built.indexToLocFormat);
    patchHhea(tables, numberOfHMetrics);
    patchMaxp(tables, typeface.glyphs.length, built.maxPoints, built.maxContours);
    // `post` version 2 lists glyph names against the old glyph order. We keep
    // the glyph order, so it stays valid and is left alone.
  } else {
    buildBaselineTables(tables, typeface, built, numberOfHMetrics, context.now);
  }

  applyKerning(tables, typeface, context.includeKerning, context.notes);

  const font: SfntFont = { sfntVersion: SFNT_TRUETYPE, tables };
  return writeSfnt(font);
}

function exportOpenType(
  typeface: Typeface,
  context: { tolerance: number; includeKerning: boolean; notes: string[] },
): Uint8Array {
  const resolved = resolvedGlyphs(typeface);

  const glyphs = resolved.map((entry) => {
    const path = new OpenTypePath();
    for (const contour of entry.contours) {
      if (contour.nodes.length === 0) continue;
      const start = contour.nodes[0].point;
      path.moveTo(start.x, start.y);
      const lastIndex = contour.closed ? contour.nodes.length : contour.nodes.length - 1;
      for (let i = 0; i < lastIndex; i++) {
        const a = contour.nodes[i];
        const b = contour.nodes[(i + 1) % contour.nodes.length];
        if (!a.handleOut && !b.handleIn) {
          path.lineTo(b.point.x, b.point.y);
        } else {
          const c1 = a.handleOut ?? a.point;
          const c2 = b.handleIn ?? b.point;
          path.curveTo(c1.x, c1.y, c2.x, c2.y, b.point.x, b.point.y);
        }
      }
      if (contour.closed) path.close();
    }
    return new OpenTypeGlyph({
      name: entry.glyph.name,
      unicode: entry.glyph.unicodes[0],
      unicodes: entry.glyph.unicodes,
      advanceWidth: Math.max(0, Math.round(entry.glyph.advanceWidth)),
      path,
    });
  });

  // opentype.js requires .notdef to be the first glyph.
  if (glyphs.length === 0 || (glyphs[0].name ?? "") !== ".notdef") {
    glyphs.unshift(new OpenTypeGlyph({ name: ".notdef", advanceWidth: 0, path: new OpenTypePath() }));
    context.notes.push("A .notdef glyph was added, which OpenType requires in first position.");
  }

  const font = new OpenTypeFont({
    familyName: typeface.meta.familyName || "Untitled",
    styleName: typeface.meta.styleName || "Regular",
    unitsPerEm: typeface.unitsPerEm,
    ascender: typeface.metrics.ascender,
    descender: typeface.metrics.descender,
    designer: typeface.meta.designer || undefined,
    manufacturer: typeface.meta.manufacturer || undefined,
    copyright: typeface.meta.copyright || undefined,
    license: typeface.meta.license || undefined,
    version: typeface.meta.version || undefined,
    glyphs,
  });

  // opentype.js writes no kerning, so reopen its output and add the tables.
  const written = new Uint8Array(font.toArrayBuffer());
  const sfnt = readSfnt(written);
  applyKerning(sfnt.tables, typeface, context.includeKerning, context.notes, glyphs.length !== resolved.length);
  return writeSfnt(sfnt);
}

/**
 * Turn the document's kerning into `kern` and `GPOS` tables.
 *
 * `shifted` covers the case where OpenType export prepended a `.notdef` glyph,
 * moving every glyph id up by one.
 */
function applyKerning(
  tables: Map<string, Uint8Array>,
  typeface: Typeface,
  include: boolean,
  notes: string[],
  shifted = false,
): void {
  if (!include || (typeface.kerning.length === 0 && typeface.kernClasses.length === 0)) {
    tables.delete("kern");
    return;
  }

  const offset = shifted ? 1 : 0;
  const idFor = (name: string): number | null => {
    const index = typeface.glyphIndex.get(name);
    return index === undefined ? null : index + offset;
  };

  const pairs: ResolvedPair[] = [];
  for (const pair of typeface.kerning) {
    if (pair.value === 0) continue;
    const left = idFor(pair.left);
    const right = idFor(pair.right);
    if (left !== null && right !== null) pairs.push({ left, right, value: pair.value });
  }

  const classKerns: ResolvedClassKern[] = [];
  for (const kernClass of typeface.kernClasses) {
    if (kernClass.value === 0) continue;
    const left = kernClass.left.map(idFor).filter((id): id is number => id !== null);
    const right = kernClass.right.map(idFor).filter((id): id is number => id !== null);
    if (left.length > 0 && right.length > 0) {
      classKerns.push({ left, right, value: kernClass.value });
    }
  }

  // The legacy table cannot express classes, so class kerning is expanded into
  // individual pairs for it. GPOS keeps the compact form.
  const flattened = [...pairs];
  for (const kernClass of classKerns) {
    for (const left of kernClass.left) {
      for (const right of kernClass.right) {
        if (!pairs.some((pair) => pair.left === left && pair.right === right)) {
          flattened.push({ left, right, value: kernClass.value });
        }
      }
    }
  }

  const kern = buildKernTable(flattened);
  if (kern) tables.set("kern", kern);
  else tables.delete("kern");

  if (flattened.length > 10920) {
    notes.push(
      `The legacy kern table holds the first 10,920 pairs of ${flattened.length.toLocaleString()}; GPOS carries them all.`,
    );
  }

  const gpos = buildGposTable(pairs, classKerns);
  if (gpos) tables.set("GPOS", gpos);
}

/** True when a family-wide parameter is set, which reshapes every glyph. */
function hasFamilyEdits(typeface: Typeface): boolean {
  const p = typeface.params;
  return (
    p.cornerRadius !== 0 ||
    p.weight !== 0 ||
    p.width !== 1 ||
    p.slant !== 0 ||
    p.xHeightScale !== 1 ||
    p.counterScale !== 1 ||
    p.tracking !== 0
  );
}

function buildBaselineTables(
  tables: Map<string, Uint8Array>,
  typeface: Typeface,
  built: ReturnType<typeof buildGlyfTables>,
  numberOfHMetrics: number,
  now: number,
): void {
  const mappings: Array<{ codepoint: number; glyphId: number }> = [];
  typeface.glyphs.forEach((glyph, index) => {
    for (const codepoint of glyph.unicodes) mappings.push({ codepoint, glyphId: index });
  });
  const codepoints = mappings.map((entry) => entry.codepoint);

  const advances = typeface.glyphs.map((glyph) => glyph.advanceWidth);
  const isItalic = /italic|oblique/i.test(typeface.meta.styleName);
  const isBold = /bold/i.test(typeface.meta.styleName);

  tables.set(
    "head",
    buildHead({
      unitsPerEm: typeface.unitsPerEm,
      bounds: built.bounds,
      indexToLocFormat: built.indexToLocFormat,
      fontRevision: Number.parseFloat(typeface.meta.version) || 1,
      createdAt: now,
      modifiedAt: now,
      isItalic,
      isBold,
    }),
  );
  tables.set(
    "hhea",
    buildHhea({
      metrics: typeface.metrics,
      advanceWidthMax: Math.max(0, ...advances),
      minLeftSideBearing: built.bounds.xMin,
      minRightSideBearing: 0,
      xMaxExtent: built.bounds.xMax,
      numberOfHMetrics,
    }),
  );
  tables.set(
    "maxp",
    buildMaxp({
      numGlyphs: typeface.glyphs.length,
      maxPoints: built.maxPoints,
      maxContours: built.maxContours,
    }),
  );
  tables.set("cmap", buildCmap(mappings));
  tables.set("name", buildName(typeface.meta));
  tables.set("post", buildPost(isItalic ? -12 : 0, typeface.unitsPerEm));
  tables.set(
    "OS/2",
    buildOs2({
      metrics: typeface.metrics,
      unitsPerEm: typeface.unitsPerEm,
      averageCharWidth: advances.length
        ? advances.reduce((sum, value) => sum + value, 0) / advances.length
        : 0,
      weightClass: isBold ? 700 : 400,
      widthClass: 5,
      isItalic,
      isBold,
      firstCharIndex: codepoints.length ? Math.min(...codepoints) : 0,
      lastCharIndex: codepoints.length ? Math.max(...codepoints) : 0,
      vendorId: "TYPF",
    }),
  );
}

function patchHead(
  tables: Map<string, Uint8Array>,
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number },
  indexToLocFormat: 0 | 1,
): void {
  const head = tables.get("head");
  if (!head || head.length < 54) return;
  const copy = new Uint8Array(head);
  const view = new DataView(copy.buffer);
  view.setInt16(36, bounds.xMin);
  view.setInt16(38, bounds.yMin);
  view.setInt16(40, bounds.xMax);
  view.setInt16(42, bounds.yMax);
  view.setInt16(50, indexToLocFormat);
  tables.set("head", copy);
}

function patchHhea(tables: Map<string, Uint8Array>, numberOfHMetrics: number): void {
  const hhea = tables.get("hhea");
  if (!hhea || hhea.length < 36) return;
  const copy = new Uint8Array(hhea);
  new DataView(copy.buffer).setUint16(34, numberOfHMetrics);
  tables.set("hhea", copy);
}

function patchMaxp(
  tables: Map<string, Uint8Array>,
  numGlyphs: number,
  maxPoints: number,
  maxContours: number,
): void {
  const maxp = tables.get("maxp");
  if (!maxp || maxp.length < 32) return;
  const copy = new Uint8Array(maxp);
  const view = new DataView(copy.buffer);
  view.setUint16(4, numGlyphs);
  // Keep the larger of the original and rebuilt figures: untouched glyphs still
  // count toward what a rasteriser has to allocate.
  view.setUint16(6, Math.max(view.getUint16(6), maxPoints));
  view.setUint16(8, Math.max(view.getUint16(8), maxContours));
  tables.set("maxp", copy);
}

/** Package export output for the browser to download. */
export function toDownloadBlob(result: ExportResult): Blob {
  const type = result.format === "otf" ? "font/otf" : "font/ttf";
  return new Blob([result.bytes as BlobPart], { type });
}

export type { Glyph };
