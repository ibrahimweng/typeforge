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

import { contoursBounds } from "./geometry";
import {
  contoursIntersect,
  correctDirection,
  insertExtrema,
  type OutlineFormat,
  type Roles,
} from "./outline";
import { removeOverlaps } from "./overlap";
import { buildGlyfTables, splitGlyf, type CompositeRef, type GlyfBuildInput } from "./glyf";
import {
  buildFvar,
  buildGvar,
  buildStat,
  PIECES_PER_CURVE,
  type Axis,
  type Instance,
  type Master,
} from "./variable";
import { buildGposTable, buildKernTable, type ResolvedClassKern, type ResolvedPair } from "./kern";
import { anythingCut, effectiveParams, paramsAreDefault, resolveGlyphContours } from "./transform";
import { ready as readyToCut } from "./boolean";
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
  familyNames,
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
  /**
   * Merge contours that overlap. Designers draw overlapping pieces on purpose,
   * but a font file cannot carry them: under the even-odd fill rule some
   * renderers apply, the overlap drops out as a hole.
   */
  mergeOverlaps?: boolean;
  /**
   * How this typeface's contours say which of them are counters.
   *
   * `nesting` by default, because a font that arrived from a file promised
   * nothing. A typeface built by the forge states it by winding and should say
   * so: worked out by nesting instead, a stem lying across a bowl reads as
   * enclosed by it, and the counter -- inside bowl and stem both -- reads as
   * solid and fills in.
   */
  roles?: Roles;
  /** Timestamps written into `head`. Passed in so output is reproducible. */
  now?: number;
  /**
   * Write a font that varies, and the masters to build the variation from.
   *
   * TrueType only: the movement is stored in `gvar`, which describes points in
   * a `glyf` table and has no counterpart for the PostScript outlines an OTF
   * carries. Asked for on an OTF it is refused rather than ignored.
   */
  variable?: VariableOptions;
}

export interface VariableOptions {
  axes: Axis[];
  instances: Instance[];
  /**
   * The font drawn again at each end of each axis, and where each one sits.
   *
   * The typeface being exported is the default master and is not in here; these
   * are the others. Every one of them has to have the same glyphs in the same
   * order, which is true by construction because they are the same font drawn
   * with a different setting.
   */
  masters: Array<{ at: Record<string, number>; typeface: Typeface }>;
}

export interface ExportResult {
  bytes: Uint8Array;
  format: ExportFormat;
  fidelity: ExportFidelity;
  fileName: string;
  /** Notes worth showing the user, such as features that could not be carried over. */
  notes: string[];
  /**
   * Glyphs that follow a variable axis only part of the way.
   *
   * Named rather than counted because the number on its own says nothing about
   * how much it matters: a `c` whose Black is drawn with four nodes fewer than
   * its Bold renders six per cent light at the end of the axis, and a `G` that
   * agrees with no master at all renders at the Regular from one end to the
   * other. Empty on anything but a variable font.
   */
  held: string[];
}

export async function exportFont(
  typeface: Typeface,
  options: ExportOptions,
): Promise<ExportResult> {
  /*
   * The boolean library, before a single outline is resolved.
   *
   * A cut that is not ready is skipped rather than waited for, which is the
   * right answer for a screen -- an uncut letter for a moment is a letter --
   * and exactly the wrong one for a file, which is written once and kept. So
   * the wait happens here, where there is somewhere to wait.
   */
  if (anythingCut(typeface)) await readyToCut();

  const notes: string[] = [];
  const held: string[] = [];
  if (options.variable && options.format === "otf") {
    notes.push(
      "A varying font has to be a TTF. The movement is stored in a table that " +
        "describes points in TrueType outlines, and an OTF does not have them.",
    );
  }
  const tolerance = options.curveTolerance ?? 0.5;
  const includeKerning = options.includeKerning ?? true;
  const mergeOverlaps = options.mergeOverlaps ?? true;
  const roles = options.roles ?? "nesting";
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

  // TrueType export uses only our own table writers. OpenType needs
  // opentype.js for CFF encoding, which is fetched only when asked for.
  const bytes =
    options.format === "otf"
      ? await exportOpenType(typeface, { tolerance, includeKerning, notes, mergeOverlaps, roles })
      : await exportTrueType(typeface, {
          tolerance,
          includeKerning,
          fidelity,
          now,
          notes,
          held,
          mergeOverlaps,
          roles,
          variable: options.variable,
        });

  const base = `${typeface.meta.familyName}-${typeface.meta.styleName}`.replace(/\s+/g, "");
  return {
    bytes,
    format: options.format,
    fidelity,
    fileName: `${base || "Untitled"}.${options.format}`,
    notes,
    held,
  };
}

/**
 * Glyph outlines with the parametric stack applied and corrected for the
 * target format, ready to encode.
 *
 * Corrections run on a copy. What the designer drew is never modified: a point
 * added at a curve's extreme, or a contour wound the other way, is a
 * requirement of the file format rather than a change to the drawing.
 */
async function resolvedGlyphs(
  typeface: Typeface,
  format: OutlineFormat,
  mergeOverlaps: boolean,
  roles: Roles = "nesting",
) {
  const out: Array<{ glyph: Typeface["glyphs"][number]; contours: ReturnType<typeof resolveGlyphContours> }> = [];

  for (const glyph of typeface.glyphs) {
    let contours = resolveGlyphContours(glyph, typeface);

    // Merging first, because it introduces points where contours crossed and
    // those new curves need extremes of their own afterwards. The merge sorts
    // out winding internally, so there is no need to set it beforehand.
    let merged = false;
    if (mergeOverlaps && contours.length > 1 && contoursIntersect(contours)) {
      contours = await removeOverlaps(contours, roles);
      merged = true;
    }

    contours = contours.map(insertExtrema);
    /*
     * A merged glyph states its roles by winding whoever was asked on the way
     * in, because that is what a union answers with. One that was not merged
     * -- because nothing overlapped, or because nothing is being merged at all
     * -- still says whatever the caller said it says.
     */
    out.push({
      glyph,
      contours: correctDirection(contours, format, merged ? "winding" : roles),
    });
  }
  return out;
}

/**
 * One master, reduced to the points it would have written.
 *
 * Put through the same builder as the default, with the same tolerance and the
 * same fixed splitting, because a delta is the difference between two point
 * lists and the two have to have been made the same way. Everything else the
 * builder produces is thrown away.
 */
async function masterOf(
  at: Record<string, number>,
  typeface: Typeface,
  context: { tolerance: number; mergeOverlaps: boolean; roles: Roles },
  shape: GlyfBuildInput[],
): Promise<Master> {
  const resolved = await resolvedGlyphs(typeface, "truetype", context.mergeOverlaps, context.roles);
  const built = buildGlyfTables(
    resolved.map((entry, index) => ({
      contours: entry.contours,
      // Rebuilt without exception: a master copied through from an original
      // file would hand back no points, and a point list that is not there is
      // not the same as one that has not moved.
      rebuild: true,
      composite: shape[index]?.composite,
    })),
    context.tolerance,
    PIECES_PER_CURVE,
    !context.mergeOverlaps,
  );
  return {
    at,
    glyphs: built.points.map((points, index) => {
      const bounds = contoursBounds(resolved[index].contours);
      const drawn = resolved[index].contours.some((contour) => contour.nodes.length > 0);
      return {
        points,
        advanceWidth: resolved[index].glyph.advanceWidth,
        leftSideBearing: drawn ? Math.round(bounds.xMin) : 0,
        xMin: bounds.xMin,
      };
    }),
  };
}

async function exportTrueType(
  typeface: Typeface,
  context: {
    tolerance: number;
    includeKerning: boolean;
    fidelity: ExportFidelity;
    now: number;
    notes: string[];
    held: string[];
    mergeOverlaps: boolean;
    roles: Roles;
    variable?: VariableOptions;
  },
): Promise<Uint8Array> {
  const resolved = await resolvedGlyphs(typeface, "truetype", context.mergeOverlaps, context.roles);
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
    composite: compositeRefsFor(entry.glyph, typeface),
  }));

  const varying = context.variable;
  const invented: Array<{ id: number; value: string }> = [];
  const built = buildGlyfTables(
    inputs,
    context.tolerance,
    varying ? PIECES_PER_CURVE : undefined,
    !context.mergeOverlaps,
  );

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

  /*
   * The sliders, and how every point answers them.
   *
   * The masters are the same font drawn again with one setting moved, so the
   * deltas are a subtraction. What makes it work at all is that the points line
   * up between them, which is not free -- see `variable.ts` for what had to be
   * measured and what had to change before it was true.
   */
  if (varying && varying.axes.length > 0) {
    const mine: Master = {
      at: {},
      glyphs: built.points.map((points, index) => ({
        points,
        advanceWidth: metrics[index].advanceWidth,
        leftSideBearing: metrics[index].leftSideBearing,
        xMin: contoursBounds(resolved[index].contours).xMin,
      })),
    };

    const others: Master[] = [];
    for (const master of varying.masters) {
      others.push(await masterOf(master.at, master.typeface, context, inputs));
    }

    const { gvar, unvarying } = buildGvar(varying.axes, mine, others);
    // Two name ids for every axis and instance, taken from 256 upwards, which
    // is where the format says a font may invent its own.
    const axisNameIds = varying.axes.map((_, index) => 256 + index);
    const instanceNameIds = varying.instances.map(
      (_, index) => 256 + varying.axes.length + index,
    );
    for (const [index, axis] of varying.axes.entries()) {
      invented.push({ id: axisNameIds[index], value: axis.label });
    }
    for (const [index, instance] of varying.instances.entries()) {
      invented.push({ id: instanceNameIds[index], value: instance.label });
    }
    tables.set("fvar", buildFvar(varying.axes, varying.instances, axisNameIds, instanceNameIds));
    tables.set("gvar", gvar);
    tables.set("STAT", buildStat(varying.axes, axisNameIds));

    if (unvarying.length > 0) {
      context.held.push(
        ...unvarying.map((index) => typeface.glyphs[index]?.name ?? String(index)),
      );
      const named = context.held.slice(0, 8);
      /*
       * Said as the weight rather than as the shape, because the weight is what
       * somebody setting a word in this font will see.
       *
       * "Holds its shape" is true and reads as a nicety. What it means is that
       * the letter is drawn at the weight of the nearest master it agrees with
       * and left there: a `G` that agrees with none of them is a Regular `G` in
       * a Black word, which is nearly three times the ink it should have and
       * the first thing anyone notices. Six per cent, which is what the `c`
       * costs at the far end, is a different thing entirely, and a note that
       * describes both the same way is no use for telling them apart.
       */
      context.notes.push(
        `${unvarying.length} ${unvarying.length === 1 ? "glyph follows" : "glyphs follow"} ` +
          `the axis only part of the way and ${unvarying.length === 1 ? "is" : "are"} set at ` +
          `the weight of the nearest one ${unvarying.length === 1 ? "it agrees" : "they agree"} ` +
          `with over the rest of it, because ${unvarying.length === 1 ? "it is" : "they are"} ` +
          `drawn differently at some weights: ${named.join(", ")}` +
          (unvarying.length > 8 ? ", and others" : "") +
          ".",
      );
    }
  }

  if (preserving) {
    patchHead(tables, built.bounds, built.indexToLocFormat);
    patchHhea(tables, numberOfHMetrics);
    patchMaxp(tables, typeface.glyphs.length, built.maxPoints, built.maxContours);
    patchWinMetrics(tables, built.bounds);
    // `post` version 2 lists glyph names against the old glyph order. We keep
    // the glyph order, so it stays valid and is left alone.
  } else {
    buildBaselineTables(tables, typeface, built, numberOfHMetrics, context.now, invented);
  }

  applyKerning(tables, typeface, context.includeKerning, context.notes);

  const font: SfntFont = { sfntVersion: SFNT_TRUETYPE, tables };
  return writeSfnt(font);
}

async function exportOpenType(
  typeface: Typeface,
  context: {
    tolerance: number;
    includeKerning: boolean;
    notes: string[];
    mergeOverlaps: boolean;
    roles: Roles;
  },
): Promise<Uint8Array> {
  const {
    Font: OpenTypeFont,
    Glyph: OpenTypeGlyph,
    Path: OpenTypePath,
  } = await import("opentype.js");
  const resolved = await resolvedGlyphs(typeface, "cff", context.mergeOverlaps, context.roles);

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
    if (left !== null && right !== null) {
      pairs.push({ left, right, value: pair.value, group: pair.group });
    }
  }

  const classKerns: ResolvedClassKern[] = [];
  for (const kernClass of typeface.kernClasses) {
    if (kernClass.value === 0) continue;
    const left = kernClass.left.map(idFor).filter((id): id is number => id !== null);
    const right = kernClass.right.map(idFor).filter((id): id is number => id !== null);
    if (left.length > 0 && right.length > 0) {
      classKerns.push({ left, right, value: kernClass.value, group: kernClass.group });
    }
  }

  /*
   * The legacy table cannot express classes, so class kerning is expanded into
   * individual pairs for it. GPOS keeps the compact form.
   *
   * Two things about how, both of which matter on a real font. The pairs
   * already written out are held in a set rather than scanned for, because a
   * font's classes stand for a few hundred thousand pairs and asking a list of
   * eleven thousand about each of them is five billion comparisons and a
   * browser that stops answering. And the expansion stops at the cap rather
   * than running to the end and throwing the remainder away, since a format 0
   * subtable addresses its pairs with sixteen-bit offsets and cannot hold more
   * than this however many are offered.
   */
  const MOST_LEGACY_PAIRS = 10920;
  const seen = new Set<number>();
  for (const pair of pairs) seen.add(pair.left * 65536 + pair.right);

  const flattened = [...pairs];
  let offered = pairs.length;
  for (const kernClass of classKerns) {
    for (const left of kernClass.left) {
      for (const right of kernClass.right) {
        const key = left * 65536 + right;
        if (seen.has(key)) continue;
        seen.add(key);
        offered++;
        if (flattened.length < MOST_LEGACY_PAIRS) {
          flattened.push({ left, right, value: kernClass.value });
        }
      }
    }
  }

  const kern = buildKernTable(flattened);
  if (kern) tables.set("kern", kern);
  else tables.delete("kern");

  if (offered > MOST_LEGACY_PAIRS) {
    notes.push(
      `The legacy kern table holds ${MOST_LEGACY_PAIRS.toLocaleString()} pairs of ${offered.toLocaleString()}; GPOS carries them all.`,
    );
  }

  const gpos = buildGposTable(pairs, classKerns);
  if (gpos) tables.set("GPOS", gpos);
}

/**
 * Whether a glyph can be written as a reference to others rather than as an
 * outline of its own.
 *
 * Only a glyph that draws nothing itself qualifies, and only while no parameter
 * is reshaping it. Parameters apply to the assembled letter, so a scaled `á`
 * is not a scaled `a` beside a scaled accent at the original spacing; writing
 * it as a reference would move the accent. In that case it is flattened, which
 * is always correct if larger.
 */
function compositeRefsFor(glyph: Glyph, typeface: Typeface): CompositeRef[] | undefined {
  if (glyph.components.length === 0 || glyph.contours.length > 0) return undefined;
  if (!paramsAreDefault(effectiveParams(glyph, typeface))) return undefined;

  const refs: CompositeRef[] = [];
  for (const component of glyph.components) {
    const index = typeface.glyphIndex.get(component.glyphName);
    if (index === undefined) return undefined; // a missing part; flatten instead
    refs.push({ glyphIndex: index, transform: component.transform });
  }
  return refs;
}

/**
 * True when a family-wide parameter is set, which reshapes every glyph.
 *
 * Asks paramsAreDefault rather than listing the parameters again. The list was
 * duplicated here once, and adding the pixel grid to one copy and not the other
 * meant a quantised font exported with most of its letters still curved: the
 * glyphs nobody had touched were judged unchanged and copied across from the
 * original, hinting, curves and all.
 */
function hasFamilyEdits(typeface: Typeface): boolean {
  return !paramsAreDefault(typeface.params);
}

function buildBaselineTables(
  tables: Map<string, Uint8Array>,
  typeface: Typeface,
  built: ReturnType<typeof buildGlyfTables>,
  numberOfHMetrics: number,
  now: number,
  /** Names the font invented for its own axes and instances, if it has any. */
  invented: Array<{ id: number; value: string }> = [],
): void {
  const mappings: Array<{ codepoint: number; glyphId: number }> = [];
  typeface.glyphs.forEach((glyph, index) => {
    for (const codepoint of glyph.unicodes) mappings.push({ codepoint, glyphId: index });
  });
  const codepoints = mappings.map((entry) => entry.codepoint);

  const advances = typeface.glyphs.map((glyph) => glyph.advanceWidth);
  const isItalic = /italic|oblique/i.test(typeface.meta.styleName);
  /*
   * The bold bit means "this is the bold of its family", not "this is heavy".
   *
   * Read off the word in the style name -- which is what it was -- every one of
   * ExtraBold, SemiBold and Bold set it, so a family of nine had three faces
   * all claiming to be the one a word processor should reach for when somebody
   * presses the bold button. It is the face whose old-scheme style name is
   * Bold, and there is exactly one of those per family.
   */
  const named = familyNames(typeface.meta);
  const isBold = named.styleName === "Bold" || named.styleName === "Bold Italic";

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
      maxComponents: built.maxComponents,
    }),
  );
  tables.set("cmap", buildCmap(mappings));
  tables.set("name", buildName(typeface.meta, invented));
  tables.set("post", buildPost(isItalic ? -12 : 0, typeface.unitsPerEm));
  tables.set(
    "OS/2",
    buildOs2({
      metrics: typeface.metrics,
      unitsPerEm: typeface.unitsPerEm,
      outlineYMax: built.bounds.yMax,
      outlineYMin: built.bounds.yMin,
      averageCharWidth: advances.length
        ? advances.reduce((sum, value) => sum + value, 0) / advances.length
        : 0,
      weightClass: typeface.meta.weightClass,
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

/**
 * Widen the Windows clipping boundary if editing has made glyphs taller or
 * deeper than the imported font allowed for. Only ever widened: narrowing it
 * would start clipping glyphs the original font rendered correctly.
 */
function patchWinMetrics(
  tables: Map<string, Uint8Array>,
  bounds: { yMin: number; yMax: number },
): void {
  const os2 = tables.get("OS/2");
  if (!os2 || os2.length < 78) return;
  const copy = new Uint8Array(os2);
  const view = new DataView(copy.buffer);
  view.setUint16(74, Math.max(view.getUint16(74), Math.max(0, bounds.yMax)));
  view.setUint16(76, Math.max(view.getUint16(76), Math.max(0, -bounds.yMin)));
  tables.set("OS/2", copy);
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
