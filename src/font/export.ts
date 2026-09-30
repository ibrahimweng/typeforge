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
import {
  buildGlyfTables,
  carryGvar,
  renumberComposite,
  splitGlyf,
  type CompositeRef,
  type GlyfBuildInput,
} from "./glyf";
import { mergeKerning } from "./gpos-merge";
import {
  buildFvar,
  buildGvar,
  buildStat,
  PIECES_PER_CURVE,
  type Axis,
  type Instance,
  type Master,
} from "./variable";
import { buildGposTable, type ResolvedClassKern, type ResolvedPair } from "./kern";
import { featuresMatchSource } from "./features";
import { buildGsubTable, type ChainRule, type GlyphSet, type Ligature } from "./gsub";
import {
  anythingCut,
  effectiveParams,
  isReshaped,
  paramsAreDefault,
  resolveAdvanceWidth,
  resolveGlyphContours,
} from "./transform";
import { type Resolved, resolveAll } from "./resolve-pool";
import { readyToShape } from "@/forge/layers";
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
  changedNameIds,
  familyNames,
  fontRevisionOf,
  nameValues,
  patchName,
  readVariationSequences,
  rebuildPost,
} from "./tables";
import type { Contour, Glyph, Typeface } from "./types";

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
   * The shaping and the library it cuts with, before a single outline is
   * resolved.
   *
   * A cut that is not ready is skipped rather than waited for, which is the
   * right answer for a screen -- an uncut letter for a moment is a letter --
   * and exactly the wrong one for a file, which is written once and kept. So
   * the wait happens here, where there is somewhere to wait.
   *
   * Both, and not just the library. The cutting is fetched on demand as well
   * now, and a file written while it was still coming would have the cuts
   * missing from it in exactly the way this paragraph exists to prevent.
   */
  if (anythingCut(typeface)) await readyToShape();

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
  /*
   * A varying font is never merged, whoever asked.
   *
   * The deltas are the difference between two lists of points, so every master
   * has to arrive with the same points in the same order. A union re-points
   * whatever it is given, and it re-points each master on its own terms: where
   * two strokes meet differently as the pen widens, the Regular and the Black
   * come out with different outlines and the letter is left standing at one
   * weight for the whole axis. The dialog used to send `true` here for a
   * varying font, from a checkbox it had hidden, so the caller cannot be
   * trusted to have thought about it; the overlaps are flagged in the file
   * instead (see `OVERLAP_SIMPLE` in `glyf.ts`), which is what the format asks
   * a varying font to do with them. Only when it really will vary: an OTF
   * asked to vary is refused above and written static, and a static font can
   * be merged like any other.
   */
  const varies = options.variable !== undefined && options.format === "ttf";
  const mergeOverlaps = varies ? false : (options.mergeOverlaps ?? true);
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
  /*
   * A varying font is named for its family and its axes, as Draw names the
   * ones it writes and as every foundry does: `Family[wght].ttf`. Named for
   * its default master instead, it downloaded under exactly the name of the
   * static Regular written a moment before, and the browser either replaced
   * one with the other or tacked a (1) on.
   */
  const varying = options.variable
    ? `${typeface.meta.familyName.replace(/[^A-Za-z0-9]+/g, "") || "Untitled"}[${options.variable.axes
        .map((axis) => axis.tag)
        .join(",")}]`
    : null;
  return {
    bytes,
    format: options.format,
    fidelity,
    fileName: `${varying ?? (base || "Untitled")}.${options.format}`,
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
  /**
   * Whether to put a node at every turn of every curve.
   *
   * Both outline formats want one there, and a static font gets one. A varying
   * font does not, because where a curve turns is a question about the curve
   * and a curve here is drawn by a pen: the same `\u03c2` turns inside its tail at
   * the Regular and not at the Black, so one master comes back with a node the
   * other has not got. A variable font is one set of outlines and a list of how
   * each point moves, so two masters meet only where they are drawn with the
   * same points -- and the letter is then left standing at whichever master it
   * agreed with, which is a Regular `\u03c2` in a Black word.
   *
   * What it costs was measured rather than assumed, because giving up a node
   * the format asks for is not a thing to do on a hunch. A varying font already
   * cuts every curve into a fixed four pieces so that the masters line up, so
   * the outline is carried by four nodes where a static font's tolerance would
   * often use one, and the turn is never far from one of them. Against the
   * drawn outlines, the worst any glyph's bounds came out was 1.49 units on a
   * thousand-unit em -- and that is what it was with the nodes in, because it
   * is the integer grid rather than the missing node. What changed was how many
   * glyphs were out by more than a unit at all: 25 of 304 became 30. The file
   * came down seven kilobytes and four more letters could follow the axis.
   */
  extremes = true,
  /** The outlines worked out already, off the main thread, where they were. */
  pre?: Resolved | null,
) {
  const out: Array<{
    glyph: Typeface["glyphs"][number];
    contours: ReturnType<typeof resolveGlyphContours>;
  }> = [];

  for (const [index, glyph] of typeface.glyphs.entries()) {
    let contours = pre?.contours[index] ?? resolveGlyphContours(glyph, typeface);

    // Merging first, because it introduces points where contours crossed and
    // those new curves need extremes of their own afterwards. The merge sorts
    // out winding internally, so there is no need to set it beforehand.
    let merged = false;
    if (mergeOverlaps && contours.length > 1 && contoursIntersect(contours)) {
      contours = await removeOverlaps(contours, roles);
      merged = true;
    }

    if (extremes) contours = contours.map(insertExtrema);
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

/** One master's outlines, as the file will have them, and its advances. */
async function masterOutlines(
  typeface: Typeface,
  context: { mergeOverlaps: boolean; roles: Roles },
  pre?: Resolved | null,
): Promise<{ resolved: Awaited<ReturnType<typeof resolvedGlyphs>>; advances: number[] }> {
  // A master, so no extremes: see `resolvedGlyphs`. The default master is
  // written without them too, or it would not line up with these.
  const resolved = await resolvedGlyphs(
    typeface,
    "truetype",
    context.mergeOverlaps,
    context.roles,
    false,
    pre,
  );
  // Asked straight after its own outlines, before the next master's: an
  // advance reads what the weight added beside the letter, which is kept
  // against the glyph by whichever master last worked it out.
  const advances = resolved.map(
    (entry, index) => pre?.advances[index] ?? resolveAdvanceWidth(entry.glyph, typeface),
  );
  return { resolved, advances };
}

/**
 * One master, reduced to the points it would have written.
 *
 * Put through the same builder as the default, with the same tolerance and the
 * same fixed splitting, because a delta is the difference between two point
 * lists and the two have to have been made the same way. Everything else the
 * builder produces is thrown away.
 */
function masterOf(
  at: Record<string, number>,
  outlines: Awaited<ReturnType<typeof masterOutlines>>,
  context: { tolerance: number; mergeOverlaps: boolean },
  shape: GlyfBuildInput[],
): Master {
  const { resolved, advances } = outlines;
  const built = buildGlyfTables(
    resolved.map((entry, index) => ({
      contours: entry.contours,
      // Rebuilt without exception: a master copied through from an original
      // file would hand back no points, and a point list that is not there is
      // not the same as one that has not moved.
      rebuild: true,
      composite: shape[index]?.composite,
      still: shape[index]?.still,
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
        advanceWidth: advances[index],
        leftSideBearing: drawn ? Math.round(bounds.xMin) : 0,
        xMin: bounds.xMin,
      };
    }),
  };
}

/**
 * The pieces of each contour of a glyph that are a single point in every
 * master, which a varying font need not write at all.
 *
 * A drawn letter keeps its points the same in number at every weight, and it
 * does that by keeping a piece in place, at no length, where one weight's
 * corner is another's curve -- the join a pen swallows at the Black, the
 * point a round terminal folds to. Where every master has it at no length,
 * it is nothing at any weight, and written out it was eight points a piece at
 * four quadratics a curve, and a delta for each of them in every master: a
 * sixth of the points of a drawn Sans. Left out of every master alike, the
 * masters still line up point for point.
 *
 * At no length as the file has it, on its grid: every point of the piece on
 * the one whole unit, in every master. Only where the glyph has the same
 * contours and points in every master, which is the only time its points can
 * line up at all; and never the piece that closes a contour, whose end the
 * writer compares with the start to decide whether to write it.
 */
function stillPieces(
  masters: Array<Array<{ contours: Contour[] }>>,
): Array<boolean[][] | undefined> {
  return masters[0].map((entry, glyph) => {
    const all = masters.map((master) => master[glyph]?.contours);
    const shape = entry.contours;
    if (
      all.some(
        (contours) =>
          !contours ||
          contours.length !== shape.length ||
          contours.some((contour, index) => contour.nodes.length !== shape[index].nodes.length),
      )
    )
      return undefined;
    let any = false;
    const still = shape.map((contour, index) => {
      const count = contour.nodes.length;
      // The piece into each node but the first, which closes the contour.
      return contour.nodes.map((_, piece) => {
        if (piece + 1 >= count) return false;
        const one = all.every((contours) => {
          const a = contours![index].nodes[piece];
          const b = contours![index].nodes[piece + 1];
          const x = Math.round(a.point.x);
          const y = Math.round(a.point.y);
          return [a.handleOut, b.handleIn, b.point].every(
            (point) => !point || (Math.round(point.x) === x && Math.round(point.y) === y),
          );
        });
        if (one) any = true;
        return one;
      });
    });
    return any ? still : undefined;
  });
}

/**
 * The outlines of the font and of each master, resolved together off the
 * main thread, or null where that is not worth doing: nothing reshaped means
 * nothing to work out but the drawing itself.
 */
async function pooled(
  typeface: Typeface,
  variable: VariableOptions | undefined,
): Promise<Resolved[] | null> {
  const all = [typeface, ...(variable?.masters.map((master) => master.typeface) ?? [])];
  if (!all.some((one) => one.glyphs.some((glyph) => isReshaped(glyph, one)))) return null;
  return resolveAll(all);
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
  /*
   * Every outline the file needs, the masters' too, worked out across the
   * cores the browser has before anything is written -- see `resolve-pool.ts`.
   * Null where there is nothing costly to work out, or nowhere to work it out
   * but here, and then each is resolved as it is reached, as it always was.
   */
  const pool = await pooled(typeface, context.variable);
  const resolved = await resolvedGlyphs(
    typeface,
    "truetype",
    context.mergeOverlaps,
    context.roles,
    !context.variable,
    pool?.[0],
  );
  // After the outlines, which is what leaves each letter's advance known.
  const advances = typeface.glyphs.map(
    (glyph, index) => pool?.[0].advances[index] ?? resolveAdvanceWidth(glyph, typeface),
  );
  const preserving = context.fidelity === "preserve" && typeface.source !== null;

  /*
   * In preserve mode an untouched glyph is copied rather than re-encoded, which
   * is what keeps its hinting intact -- and the copy has to be of *this*
   * glyph's record.
   *
   * It was taken by position, `originalRecords[index]`, which is only the same
   * thing while nobody has added or removed a letter. Remove one and every
   * glyph after it was written with its neighbour's outline: take out the
   * `exclam` and the whole alphabet shifted along by one, each letter drawn as
   * the one before it, with nothing on screen to say so. So the records are
   * looked up by who the glyph was in the file (see `SourceFont.imported`),
   * and a glyph the file never had is built rather than copied.
   *
   * A copied composite names its parts by number too, and those numbers move
   * with the same removal. They are renumbered to where the parts now sit, and
   * a composite whose part is not in the font any more is built afresh from
   * the model instead.
   */
  const identity = preserving ? sourceIdentity(typeface) : null;
  let originalRecords: Uint8Array[] = [];
  if (preserving) {
    const source = typeface.source!;
    const glyf = source.tables.get("glyf");
    const loca = source.tables.get("loca");
    const head = source.tables.get("head");
    const maxp = source.tables.get("maxp");
    if (glyf && loca && head && maxp && maxp.length >= 6) {
      const indexToLocFormat = new DataView(head.buffer, head.byteOffset, head.byteLength).getInt16(
        50,
      );
      const numGlyphs = new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength).getUint16(4);
      originalRecords = splitGlyf(glyf, loca, indexToLocFormat, numGlyphs);
    }
  }
  const renumber = (was: number): number | undefined => identity?.currentOf.get(was);

  /*
   * The masters' outlines, each with its advances, before anything is written:
   * which pieces a varying font can leave out is a question about all of them.
   */
  const varying = context.variable;
  const masterOutlinesList: Array<Awaited<ReturnType<typeof masterOutlines>>> = [];
  if (varying && varying.axes.length > 0) {
    for (const [index, master] of varying.masters.entries()) {
      masterOutlinesList.push(await masterOutlines(master.typeface, context, pool?.[index + 1]));
    }
  }
  const still =
    varying && varying.axes.length > 0
      ? stillPieces([resolved, ...masterOutlinesList.map((one) => one.resolved)])
      : [];

  const familyChanged = hasFamilyEdits(typeface);
  const inputs: GlyfBuildInput[] = resolved.map((entry, index) => {
    const was = identity?.originalOf[index];
    const record = was === undefined ? undefined : originalRecords[was];
    const original = record ? (renumberComposite(record, renumber) ?? undefined) : undefined;
    return {
      contours: entry.contours,
      original,
      rebuild: !preserving || familyChanged || entry.glyph.dirty || !original,
      composite: compositeRefsFor(entry.glyph, typeface),
      still: still[index],
    };
  });

  const invented: Array<{ id: number; value: string }> = [];
  const built = buildGlyfTables(
    inputs,
    context.tolerance,
    varying ? PIECES_PER_CURVE : undefined,
    !context.mergeOverlaps,
  );

  const metrics = resolved.map((entry, index) => {
    const bounds = contoursBounds(entry.contours);
    const hasOutline = entry.contours.some((contour) => contour.nodes.length > 0);
    return {
      advanceWidth: advances[index],
      leftSideBearing: hasOutline ? Math.round(bounds.xMin) : 0,
    };
  });
  const { hmtx, numberOfHMetrics } = buildHmtx(metrics);

  const tables = preserving ? new Map(typeface.source!.tables) : new Map<string, Uint8Array>();
  if (preserving && identity) {
    dropStaleTables(tables, identity, context.notes);
    carryVariations(
      tables,
      typeface,
      identity,
      inputs.map((input) => input.rebuild),
      context.notes,
    );
  }

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

    const others: Master[] = varying.masters.map((master, index) =>
      masterOf(master.at, masterOutlinesList[index], context, inputs),
    );

    const { gvar, unvarying } = buildGvar(varying.axes, mine, others);
    // Two name ids for every axis and instance, taken from 256 upwards, which
    // is where the format says a font may invent its own.
    const axisNameIds = varying.axes.map((_, index) => 256 + index);
    const instanceNameIds = varying.instances.map((_, index) => 256 + varying.axes.length + index);
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
      context.held.push(...unvarying.map((index) => typeface.glyphs[index]?.name ?? String(index)));
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

  if (preserving && identity) {
    patchHead(tables, built.bounds, built.indexToLocFormat);
    patchHhea(tables, numberOfHMetrics);
    patchMaxp(tables, typeface.glyphs.length, built.maxPoints, built.maxContours);
    patchWinMetrics(tables, built.bounds);
    patchIdentityTables(tables, typeface, identity, invented);
  } else {
    buildBaselineTables(tables, typeface, built, numberOfHMetrics, context.now, invented, advances);
  }

  applyKerning(tables, typeface, context.includeKerning, false, context.notes);
  applyAlternates(
    tables,
    typeface,
    false,
    !preserving,
    !featuresMatchSource(typeface),
    context.notes,
  );

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
      advanceWidth: Math.max(0, Math.round(resolveAdvanceWidth(entry.glyph, typeface))),
      path,
    });
  });

  // opentype.js requires .notdef to be the first glyph.
  if (glyphs.length === 0 || (glyphs[0].name ?? "") !== ".notdef") {
    glyphs.unshift(
      new OpenTypeGlyph({ name: ".notdef", advanceWidth: 0, path: new OpenTypePath() }),
    );
    context.notes.push("A .notdef glyph was added, which OpenType requires in first position.");
  }

  /*
   * The same account of the face that the TrueType path gives, in the terms
   * opentype.js takes it in.
   *
   * It was handed the family and the style and nothing else, and filled in the
   * rest itself: a weight class of 500 for every face whatever it weighed, the
   * REGULAR bit on a Black Italic, and the style name straight into name id 2
   * -- so a SemiBold went out as family "Inter", style "SemiBold", which is the
   * one thing that id may not say and which splits the family in every font
   * menu that reads it. Now the old pair and the typographic pair come from
   * `familyNames`, the weight from the document, and the style bits by the
   * same rules `buildOs2` and `buildHead` use.
   */
  const named = familyNames(typeface.meta);
  const isItalic = /italic|oblique/i.test(typeface.meta.styleName);
  const isBold = named.styleName === "Bold" || named.styleName === "Bold Italic";
  let fsSelection = 0x80; // USE_TYPO_METRICS, as the TrueType path sets it
  if (isItalic) fsSelection |= 0x01;
  if (isBold) fsSelection |= 0x20;
  if (!isItalic && !isBold) fsSelection |= 0x40; // REGULAR
  const familyName = named.familyName || "Untitled";
  const styleName = named.styleName || "Regular";

  /*
   * Built apart and then handed over, because the declared type of the
   * constructor's options lists only the handful of fields this used to pass.
   * opentype.js reads every one below (see `Font` in its source).
   */
  const fontOptions = {
    familyName,
    styleName,
    // The full and PostScript names are the face's real ones, as `buildName`
    // writes them, rather than opentype.js's joining of the old pair.
    fullName: `${typeface.meta.familyName} ${typeface.meta.styleName}`.trim() || undefined,
    postScriptName:
      `${typeface.meta.familyName}-${typeface.meta.styleName}`
        .replace(/[^A-Za-z0-9-]/g, "")
        .slice(0, 63) || undefined,
    unitsPerEm: typeface.unitsPerEm,
    ascender: typeface.metrics.ascender,
    descender: typeface.metrics.descender,
    designer: typeface.meta.designer || undefined,
    manufacturer: typeface.meta.manufacturer || undefined,
    copyright: typeface.meta.copyright || undefined,
    license: typeface.meta.license || undefined,
    version: typeface.meta.version || undefined,
    weightClass: typeface.meta.weightClass,
    widthClass: 5,
    fsSelection,
    italicAngle: isItalic ? -12 : 0,
    glyphs,
  };
  const font = new OpenTypeFont(fontOptions);

  /*
   * Name ids 16 and 17 are written by opentype.js whatever happens, copied from
   * ids 1 and 2 when nobody says otherwise. Said here for a face outside the
   * four the old pair can hold, which is when they carry the family and the
   * style a font menu should group it under.
   */
  if (named.typographicFamily) {
    const names = font.names as unknown as Record<string, Record<string, { en: string }>>;
    for (const platform of ["unicode", "macintosh", "windows"]) {
      if (!names[platform]) continue;
      names[platform].preferredFamily = { en: named.typographicFamily };
      names[platform].preferredSubfamily = { en: named.typographicStyle };
    }
  }

  // opentype.js writes no kerning, so reopen its output and add the tables.
  const written = new Uint8Array(font.toArrayBuffer());
  const sfnt = readSfnt(written);
  patchOpenTypeHead(sfnt.tables, typeface.meta.version, isBold, isItalic);
  applyKerning(
    sfnt.tables,
    typeface,
    context.includeKerning,
    glyphs.length !== resolved.length,
    context.notes,
  );
  // OpenType is always a rebuild: the curves are re-encoded, so there is no
  // source table in here to trade against.
  applyAlternates(
    sfnt.tables,
    typeface,
    glyphs.length !== resolved.length,
    true,
    true,
    context.notes,
  );
  return writeSfnt(sfnt);
}

/**
 * The two fields of `head` that opentype.js decides for itself and gets wrong.
 *
 * It sets the bold bit of `macStyle` for any weight from 600 up, so a SemiBold
 * and an ExtraBold both claim to be the family's bold, which is the job of one
 * face only (see `buildBaselineTables`); and it writes no revision at all. Both
 * are set as the TrueType path sets them.
 */
function patchOpenTypeHead(
  tables: Map<string, Uint8Array>,
  version: string,
  isBold: boolean,
  isItalic: boolean,
): void {
  const head = tables.get("head");
  if (!head || head.length < 46) return;
  const copy = new Uint8Array(head);
  const view = new DataView(copy.buffer);
  view.setInt32(4, Math.round(fontRevisionOf(version) * 65536));
  view.setUint16(44, (isBold ? 1 : 0) | (isItalic ? 2 : 0));
  tables.set("head", copy);
}

/**
 * Turn the document's features into a `GSUB` table.
 *
 * Named rules in, glyph ids out. The names are resolved here rather than where
 * the rules are written because nothing knows a glyph's id until the export has
 * settled the order -- and `shifted` covers the case where OpenType export
 * prepended a `.notdef` and moved every id up by one, exactly as the kerning
 * has to.
 *
 * A rule whose glyphs are not all in the font is dropped rather than written
 * with the missing ones left out. A join is a statement about a pair, and half
 * of one is not a smaller truth: it is a rule that fires where it should not.
 */
function applyAlternates(
  tables: Map<string, Uint8Array>,
  typeface: Typeface,
  shifted = false,
  rebuilt = false,
  changed = false,
  notes: string[] = [],
): void {
  const offset = shifted ? 1 : 0;
  const idFor = (name: string): number | null => {
    const index = typeface.glyphIndex.get(name);
    return index === undefined ? null : index + offset;
  };

  const rules: ChainRule[] = [];
  for (const rule of typeface.alternates ?? []) {
    const input: number[][] = [];
    let whole = true;
    for (const position of rule.input) {
      const ids = position.map(idFor);
      if (ids.some((id) => id === null)) whole = false;
      input.push(ids.filter((id): id is number => id !== null));
    }
    const swaps: ChainRule["swaps"] = [];
    for (const position of rule.swaps) {
      const swap: Array<{ plain: number; alternate: number }> = [];
      for (const one of position.swap) {
        const plain = idFor(one.plain);
        const alternate = idFor(one.alternate);
        if (plain === null || alternate === null) {
          whole = false;
          continue;
        }
        swap.push({ plain, alternate });
      }
      swaps.push({ at: position.at, swap });
    }

    /*
     * The two required runs, translated the same way and held to the same bar.
     *
     * A backtrack whose glyphs are not all in this font is not a weaker rule,
     * it is a different one: it would fire where the real rule should not.
     */
    const runOf = (positions: string[][] | undefined): number[][] =>
      (positions ?? []).map((position) => {
        const ids = position.map(idFor);
        if (ids.some((id) => id === null)) whole = false;
        return ids.filter((id): id is number => id !== null);
      });
    const before = runOf(rule.before);
    const after = runOf(rule.after);

    if (whole) rules.push({ input, swaps, before, after });
  }

  /*
   * A ligature goes in whole or not at all, on the same argument as everywhere
   * else here: half of `f f i` is `f f`, which is not a smaller truth but a
   * different rule, and one that fires where the real one should not.
   */
  const ligatures: Ligature[] = [];
  for (const one of typeface.ligatures ?? []) {
    const components = one.components.map(idFor);
    const ligature = idFor(one.ligature);
    if (ligature === null || components.some((id) => id === null)) continue;
    ligatures.push({ components: components as number[], ligature });
  }

  /*
   * A set drops the swaps it cannot write and keeps the rest, because its
   * swaps are independent of each other: a stylistic set missing its `g` is
   * still a stylistic set for every other letter in it.
   */
  const sets: GlyphSet[] = [];
  for (const set of typeface.sets ?? []) {
    const swaps: Array<{ plain: number; alternate: number }> = [];
    for (const one of set.swaps) {
      const plain = idFor(one.plain);
      const alternate = idFor(one.alternate);
      if (plain === null || alternate === null) continue;
      swaps.push({ plain, alternate });
    }
    if (swaps.length > 0) sets.push({ tag: set.tag, swaps });
  }

  /*
   * Written when there is something to write, and otherwise left alone.
   *
   * Not deleted, which is what this did first and which quietly threw away the
   * GSUB of every font somebody imported. A document that has no alternates of
   * its own has said nothing about substitutions; it has not said there are to
   * be none, and the ligatures and alternates the source font came with are
   * part of what an import is promised it will keep.
   */
  const gsub = buildGsubTable({ ligatures, sets, contextual: rules });
  if (!gsub) return;

  /*
   * On a preserve export, a rebuilt table is a trade rather than an addition.
   *
   * The source font's own `GSUB` is in `tables` already and holds everything:
   * positional forms, discretionary ligatures, the contextual rules a script
   * needs -- most of which this document does not model and none of which the
   * writer above can put back. Setting a table built from the model over the
   * top swaps all of that for the handful of rules the document knows about.
   *
   * It could not happen while an import read no features at all. Now that one
   * does, the two are the same shape and the swap would be silent, so it is
   * said out loud instead: a preserve export keeps what the font came with
   * unless somebody has actually changed the features, and says which it did.
   */
  const preserving = tables.has("GSUB") && !rebuilt;
  if (preserving && !changed) {
    notes.push(KEPT_FEATURES);
    return;
  }
  if (preserving) {
    notes.push(
      "The features were rebuilt from what is on screen, so any the source font had that this " +
        "editor does not model — positional forms, discretionary ligatures, contextual rules — " +
        "are not in the file. Export without preserving to avoid the question.",
    );
  }
  tables.set("GSUB", gsub);
}

/**
 * Said of a preserve export that left the source font's features alone.
 *
 * A note rather than a warning: nothing went wrong and nothing needs doing, so
 * the dialog shows it plainly and does not stay open for it. Named so the
 * dialog can tell it from the notes that do ask for something.
 */
export const KEPT_FEATURES =
  "The font's own ligatures and alternates were kept as they arrived. Nothing here changed them.";

/** Notes that report what happened rather than anything to act on. */
export const NEUTRAL_NOTES: ReadonlySet<string> = new Set([KEPT_FEATURES]);

/**
 * Turn the document's kerning into a `GPOS` table.
 *
 * `shifted` covers the case where OpenType export prepended a `.notdef` glyph,
 * moving every glyph id up by one.
 */
function applyKerning(
  tables: Map<string, Uint8Array>,
  typeface: Typeface,
  include: boolean,
  shifted = false,
  notes: string[] = [],
): void {
  if (!include || (typeface.kerning.length === 0 && typeface.kernClasses.length === 0)) {
    tables.delete("kern");
    /*
     * No kerning asked for, or none left in the document, is a statement about
     * the kerning and about nothing else: the file's own GPOS loses its `kern`
     * feature and keeps its marks. Left alone it went out still kerning, with
     * the pairs somebody had deleted or asked to leave out.
     */
    const existing = tables.get("GPOS");
    if (existing) replaceKerning(tables, existing, null, notes);
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
   * No legacy `kern` table. GPOS carries the kerning, and that is what a font
   * compiled this decade ships.
   *
   * This was written both ways before it was written this way. The legacy
   * table cannot express classes, so it has to be handed every pair the classes
   * stand for -- and a format 0 subtable addresses its pairs with sixteen-bit
   * offsets, so it holds 10,920 of them and no more, however many are offered.
   * Both halves of that are bad here. Written up to the cap on a font that
   * offered thirty-three thousand, it came to sixty-four kilobytes holding a
   * third of the kerning, and not the important third: the expansion runs class
   * by class, so 203 letters came out kerned in full and 248 kerned in part,
   * `d` and `l` and `H` and `I` complete, `E` and `F` and `G` and `K` cut off
   * partway. Software old enough to read this table and not GPOS would set `LT`
   * closed and `FT` open in the same word, which looks like a broken font where
   * no kerning at all looks like no kerning. Written instead only when the whole
   * of it fits, it was sixty-three kilobytes of a hundred and fifty-one spent
   * repeating GPOS -- and balanced on a cliff, since the font offered 10,566
   * pairs and three hundred more would have taken all of it away again without
   * a word.
   *
   * The deciding fact is that nobody ships one. Forty fonts people actually set
   * text in, opened with fontTools: thirty-nine carry GPOS, and not one carries
   * a `kern` table. Every shaper in use reads GPOS and ignores `kern` where
   * both are there, so the table is weight in the file and nothing else.
   */
  tables.delete("kern");

  const gpos = buildGposTable(pairs, classKerns);
  /*
   * Into the font's own GPOS when it has one, rather than over the top of it.
   *
   * This used to set the table it had just built in place of whatever was
   * there, which on a preserving export was the imported font's GPOS -- the
   * kerning in it, and with the kerning its mark attachment, its mark-to-mark
   * stacking and its cursive joins, none of which this application models or
   * could put back. Every imported font with kerning came out with its accents
   * sitting on the baseline. The kerning is now traded on its own and the rest
   * of the table kept; see `gpos-merge.ts` for how. A rebuild has no GPOS in
   * `tables` at this point and gets the table as built.
   */
  const existing = tables.get("GPOS");
  if (existing) replaceKerning(tables, existing, gpos, notes);
  else if (gpos) tables.set("GPOS", gpos);
}

/**
 * Swap the kerning in an existing GPOS for `kerning`, keeping everything else.
 *
 * Should the file's table be one that cannot be walked, or the result not fit
 * the format's sixteen-bit lists, the file's own table is kept as it arrived
 * and the note says the kerning on screen did not reach it. That is the
 * lesser loss of the two on offer: a font whose kerning is the imported
 * kerning, rather than one whose accents have all fallen off.
 */
function replaceKerning(
  tables: Map<string, Uint8Array>,
  existing: Uint8Array,
  kerning: Uint8Array | null,
  notes: string[],
): void {
  try {
    const merged = mergeKerning(existing, kerning);
    if (merged) tables.set("GPOS", merged);
    else tables.delete("GPOS");
  } catch {
    notes.push(
      "The source font's positioning table could not be combined with the kerning on screen, " +
        "so it was kept as it arrived: the kerning in the file is the kerning the font came with.",
    );
  }
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

/**
 * How the glyphs being written line up with the glyphs in the imported file.
 *
 * Worked out by name against what the importer recorded (`SourceFont.imported`)
 * rather than by position, because position is exactly what adding, removing
 * and reordering letters changes. Names are unique within a document and a
 * rename marks the glyph as touched, so a glyph that carries a name the file
 * had at some position, and has not been touched, is the glyph that was there.
 *
 * Where the importer recorded nothing -- a source assembled some other way --
 * nothing is known, and everything below errs towards rebuilding: each glyph
 * is encoded afresh and every table that addresses glyphs by number is taken
 * as no longer describing the font.
 */
interface SourceIdentity {
  /** For each glyph being written, its index in the file, if it was there. */
  originalOf: Array<number | undefined>;
  /** For each index in the file, where that glyph is being written now. */
  currentOf: Map<number, number>;
  /**
   * Every glyph of the file is still at its own index, with anything new after
   * them. A table that names glyphs by number -- GSUB, GPOS, GDEF -- still
   * means what it meant, because none of the numbers it uses has moved.
   */
  prefixIntact: boolean;
  /** The same glyphs in the same order and no others: every count still holds. */
  sameGlyphs: boolean;
  /** And every one of them still called what the file called it. */
  sameNames: boolean;
  /** No character has moved to a different glyph, been added or been taken away. */
  sameCharacters: boolean;
}

function sourceIdentity(typeface: Typeface): SourceIdentity {
  const imported = typeface.source?.imported;
  const originalOf: Array<number | undefined> = typeface.glyphs.map(() => undefined);
  const currentOf = new Map<number, number>();
  if (!imported) {
    return {
      originalOf,
      currentOf,
      prefixIntact: false,
      sameGlyphs: false,
      sameNames: false,
      sameCharacters: false,
    };
  }

  const wasAt = new Map(imported.glyphs.map((glyph, index) => [glyph.name, index]));
  typeface.glyphs.forEach((glyph, index) => {
    const was = wasAt.get(glyph.name);
    if (was === undefined) return;
    originalOf[index] = was;
    currentOf.set(was, index);
  });
  /*
   * A glyph renamed where it stands.
   *
   * A name the file never had, sitting at a position whose own name has gone
   * from the font altogether, is that glyph under a new name: removing a
   * letter closes the gap from behind and adding one appends, so nothing else
   * leaves an unknown name exactly where a known one disappeared. Recognising
   * it matters for everything that numbers glyphs -- the `GSUB` that turns
   * `f i` into glyph 212 still means the right thing when glyph 212 has only
   * been renamed -- and changes nothing about its outline, which a rename marks
   * as touched and so is built afresh regardless.
   */
  typeface.glyphs.forEach((_, index) => {
    if (originalOf[index] !== undefined || index >= imported.glyphs.length) return;
    if (currentOf.has(index)) return;
    originalOf[index] = index;
    currentOf.set(index, index);
  });

  const prefixIntact =
    typeface.glyphs.length >= imported.glyphs.length &&
    imported.glyphs.every((_, index) => originalOf[index] === index);
  const sameGlyphs = prefixIntact && typeface.glyphs.length === imported.glyphs.length;
  const sameNames =
    sameGlyphs &&
    imported.glyphs.every((glyph, index) => typeface.glyphs[index].name === glyph.name);
  const sameList = (one: number[], other: number[]) =>
    one.length === other.length && one.every((value, index) => value === other[index]);
  const sameCharacters =
    prefixIntact &&
    typeface.glyphs.every((glyph, index) =>
      index < imported.glyphs.length
        ? sameList(glyph.unicodes, imported.glyphs[index].unicodes)
        : glyph.unicodes.length === 0,
    );
  return { originalOf, currentOf, prefixIntact, sameGlyphs, sameNames, sameCharacters };
}

/**
 * Tables that hold one entry for every glyph, and so stop being valid the
 * moment the count changes -- even if every glyph that was there still is.
 */
const PER_GLYPH_TABLES = ["hdmx", "LTSH", "HVAR", "VVAR", "vmtx", "vhea", "sbix"];

/**
 * Tables that name glyphs by number, and so stop being true the moment a
 * number they use is given to a different glyph.
 */
const GLYPH_NUMBERED_TABLES = [
  "GDEF",
  "GSUB",
  "GPOS",
  "kern",
  "morx",
  "mort",
  "kerx",
  "COLR",
  "SVG ",
  "EBLC",
  "EBDT",
  "EBSC",
  "CBLC",
  "CBDT",
  "MATH",
  "JSTF",
  "VORG",
];

/**
 * The varying font's other tables, which are nothing without `gvar`: a font
 * whose `fvar` offers a weight axis and whose outlines do not move along it is
 * a slider that does nothing.
 */
const VARIATION_TABLES = ["fvar", "avar", "cvar", "MVAR"];

/**
 * Take out the file's tables that no longer describe the font being written.
 *
 * A preserving export copies everything it does not model, and it copied these
 * too, whatever had happened to the glyphs: an `hdmx` with a row for every
 * glyph in a font that now has one more or one less, which fontTools reports
 * and a strict reader refuses; a mark attachment in `GPOS` still pinning an
 * accent to glyph 212 when glyph 212 is now a different letter. Dropped rather
 * than rewritten, because none of them is modelled here and a table that is
 * absent is a feature missing where one that is wrong is a font that renders
 * wrongly. The GSUB and GPOS the document does model are written again from it
 * afterwards, so its ligatures, alternates and kerning go back in.
 */
function dropStaleTables(
  tables: Map<string, Uint8Array>,
  identity: SourceIdentity,
  notes: string[],
): void {
  const dropped: string[] = [];
  const drop = (tag: string) => {
    if (tables.delete(tag)) dropped.push(tag.trim());
  };
  if (!identity.sameGlyphs) for (const tag of PER_GLYPH_TABLES) drop(tag);
  // `gvar` is not dropped with them: it is carried glyph by glyph instead, in
  // `carryVariations`, which is what the slider needs to go on working.
  if (!identity.prefixIntact) for (const tag of GLYPH_NUMBERED_TABLES) drop(tag);
  if (dropped.length === 0) return;
  notes.push(
    `Letters were added, removed or reordered, so the source font's ${dropped.join(", ")} ` +
      `${dropped.length === 1 ? "table, which counts" : "tables, which count"} glyphs by number, ` +
      `could not be carried over. The kerning, ligatures and alternates on screen were written ` +
      `again; anything else in ${dropped.length === 1 ? "it" : "them"} is not in the file.`,
  );
}

/**
 * The file's `gvar`, with each glyph's movement following the glyph.
 *
 * Copied whole, it described the file's glyphs by the file's numbers and the
 * file's points: after a removal every glyph moved with its neighbour's deltas,
 * and an edited glyph moved its new points by the old ones. `carryGvar` in
 * `glyf.ts` does the renumbering and takes the movement off every glyph that
 * was rebuilt, and the note names those, since they now hold one shape along
 * the whole axis. Should the table not be readable, it goes with the rest of
 * the variation tables rather than being left to describe the wrong glyphs.
 */
function carryVariations(
  tables: Map<string, Uint8Array>,
  typeface: Typeface,
  identity: SourceIdentity,
  rebuilt: boolean[],
  notes: string[],
): void {
  const gvar = tables.get("gvar");
  if (!gvar) return;
  try {
    const carried = carryGvar(gvar, identity.originalOf, rebuilt);
    tables.set("gvar", carried.gvar);
    if (carried.stilled.length === 0) return;
    const named = carried.stilled.slice(0, 8).map((index) => typeface.glyphs[index].name);
    notes.push(
      `${carried.stilled.length} edited ${carried.stilled.length === 1 ? "glyph no longer varies" : "glyphs no longer vary"}: ` +
        "the source font's variations described the old outline, and applied to the new one " +
        `would distort it. ${named.join(", ")}${carried.stilled.length > 8 ? ", and others" : ""} ` +
        `${carried.stilled.length === 1 ? "keeps" : "keep"} the shape drawn here at every setting.`,
    );
  } catch {
    for (const tag of ["gvar", ...VARIATION_TABLES]) tables.delete(tag);
    notes.push(
      "The source font's variations could not be carried across the edits, so this is a " +
        "static font at its default setting.",
    );
  }
}

/**
 * Bring the file's own `cmap`, `post`, `name` and the fields beside them up to
 * date with the document.
 *
 * A preserving export copied all three straight through, so an edit to any of
 * the things they record never reached the file: a character given to a new
 * letter still typed the old one, a renamed glyph kept its old name, a family
 * renamed on screen installed under the name it arrived with. Each is left
 * alone while it still says what the document says -- which keeps what is in
 * them that this application does not model, a `cmap`'s variation sequences
 * or a `name` table's localised names -- and rewritten when it does not.
 */
function patchIdentityTables(
  tables: Map<string, Uint8Array>,
  typeface: Typeface,
  identity: SourceIdentity,
  invented: Array<{ id: number; value: string }>,
): void {
  const imported = typeface.source?.imported;

  if (!identity.sameCharacters || !tables.has("cmap")) {
    const mappings: Array<{ codepoint: number; glyphId: number }> = [];
    typeface.glyphs.forEach((glyph, index) => {
      for (const codepoint of glyph.unicodes) mappings.push({ codepoint, glyphId: index });
    });
    /*
     * The variation sequences come along, which the document does not model:
     * each renumbered to where its glyph now is, and dropped with its glyph.
     * The default ones name no glyph and are kept as they were.
     */
    const existing = tables.get("cmap");
    const sequences = (existing ? readVariationSequences(existing) : []).map((one) => ({
      ...one,
      mappings: one.mappings.flatMap((mapping) => {
        const glyphId = identity.currentOf.get(mapping.glyphId);
        return glyphId === undefined ? [] : [{ codepoint: mapping.codepoint, glyphId }];
      }),
    }));
    tables.set("cmap", buildCmap(mappings, sequences));
    const codepoints = mappings.map((entry) => entry.codepoint);
    patchCharacterRange(tables, codepoints);
  }

  /*
   * Names are compared by position as well as by name, because the table is
   * a list against glyph ids: the same names in a different order are wrong
   * names for every glyph that moved.
   */
  if (!identity.sameNames || !tables.has("post")) {
    const isItalic = /italic|oblique/i.test(typeface.meta.styleName);
    tables.set(
      "post",
      rebuildPost(
        tables.get("post"),
        isItalic ? -12 : 0,
        typeface.unitsPerEm,
        typeface.glyphs.map((glyph) => glyph.name),
      ),
    );
  }

  /*
   * The names the metadata changed, and any a varying font invented for its
   * axes and instances -- which `fvar` points at by number, and which a
   * preserving export would otherwise leave pointing at whatever the file
   * happened to keep under those numbers.
   */
  const replace = imported
    ? changedNameIds(imported.meta, typeface.meta)
    : new Set(nameValues(typeface.meta).map((entry) => entry.id));
  for (const entry of invented) replace.add(entry.id);
  const source = tables.get("name");
  if (replace.size > 0 || !source) {
    tables.set(
      "name",
      patchName(source ?? new Uint8Array(6), replace, [...nameValues(typeface.meta), ...invented]),
    );
  }

  if (!imported || imported.meta.version !== typeface.meta.version) {
    const head = tables.get("head");
    if (head && head.length >= 8) {
      const copy = new Uint8Array(head);
      new DataView(copy.buffer).setInt32(
        4,
        Math.round(fontRevisionOf(typeface.meta.version) * 65536),
      );
      tables.set("head", copy);
    }
  }
  if (!imported || imported.meta.weightClass !== typeface.meta.weightClass) {
    const os2 = tables.get("OS/2");
    if (os2 && os2.length >= 6) {
      const copy = new Uint8Array(os2);
      new DataView(copy.buffer).setUint16(4, typeface.meta.weightClass);
      tables.set("OS/2", copy);
    }
  }
  if (
    !imported ||
    imported.meta.styleName !== typeface.meta.styleName ||
    imported.meta.familyName !== typeface.meta.familyName
  ) {
    patchStyleBits(tables, typeface);
  }
}

/**
 * The style as the file's bits state it, brought into line with a new style name.
 *
 * A preserving export rewrote the names and left the bits that say the same
 * thing in another way, so a Regular renamed Bold Italic went out as a family's
 * bold italic by name and its regular by `fsSelection`, `macStyle` and an
 * upright italic angle -- and systems that read the bits, which is most of
 * them when deciding what the bold and italic buttons pick, took it for the
 * regular. The rules are the rebuild's (see `buildBaselineTables`): italic
 * from the style name, bold only for the face whose old-style name is Bold.
 * Every other bit is the file's own and left alone. The italic angle is only
 * invented when the file had none and the face is now italic, and set upright
 * when it is not, so a real italic keeps the angle it was drawn at.
 */
function patchStyleBits(tables: Map<string, Uint8Array>, typeface: Typeface): void {
  const isItalic = /italic|oblique/i.test(typeface.meta.styleName);
  const named = familyNames(typeface.meta);
  const isBold = named.styleName === "Bold" || named.styleName === "Bold Italic";

  const os2 = tables.get("OS/2");
  if (os2 && os2.length >= 64) {
    const copy = new Uint8Array(os2);
    const view = new DataView(copy.buffer);
    // ITALIC, BOLD, REGULAR and OBLIQUE are the style; the rest are the file's.
    let bits = view.getUint16(62) & ~(0x01 | 0x20 | 0x40 | 0x200);
    if (isItalic) bits |= 0x01;
    if (isBold) bits |= 0x20;
    if (!isItalic && !isBold) bits |= 0x40;
    view.setUint16(62, bits);
    tables.set("OS/2", copy);
  }

  const head = tables.get("head");
  if (head && head.length >= 46) {
    const copy = new Uint8Array(head);
    const view = new DataView(copy.buffer);
    view.setUint16(44, (view.getUint16(44) & ~0x03) | (isBold ? 1 : 0) | (isItalic ? 2 : 0));
    tables.set("head", copy);
  }

  const post = tables.get("post");
  if (post && post.length >= 8) {
    const copy = new Uint8Array(post);
    const view = new DataView(copy.buffer);
    const was = view.getInt32(4) / 65536;
    const angle = isItalic ? (was !== 0 ? was : -12) : 0;
    if (angle !== was) {
      view.setInt32(4, Math.round(angle * 65536));
      tables.set("post", copy);
      // And the caret, which leans with the letters or stands upright.
      const hhea = tables.get("hhea");
      if (hhea && hhea.length >= 24) {
        const caret = new Uint8Array(hhea);
        const caretView = new DataView(caret.buffer);
        const rise = angle === 0 ? 1 : typeface.unitsPerEm;
        const run =
          angle === 0 ? 0 : Math.round(-typeface.unitsPerEm * Math.tan((angle * Math.PI) / 180));
        caretView.setInt16(18, rise);
        caretView.setInt16(20, run);
        tables.set("hhea", caret);
      }
    }
  }
}

/** The lowest and highest character in `OS/2`, kept in step with a rewritten `cmap`. */
function patchCharacterRange(tables: Map<string, Uint8Array>, codepoints: number[]): void {
  const os2 = tables.get("OS/2");
  if (!os2 || os2.length < 68) return;
  const copy = new Uint8Array(os2);
  const view = new DataView(copy.buffer);
  const first = codepoints.length ? Math.min(...codepoints) : 0;
  const last = codepoints.length ? Math.max(...codepoints) : 0;
  view.setUint16(64, Math.min(0xffff, first));
  view.setUint16(66, Math.min(0xffff, last));
  tables.set("OS/2", copy);
}

function buildBaselineTables(
  tables: Map<string, Uint8Array>,
  typeface: Typeface,
  built: ReturnType<typeof buildGlyfTables>,
  numberOfHMetrics: number,
  now: number,
  /** Names the font invented for its own axes and instances, if it has any. */
  invented: Array<{ id: number; value: string }> = [],
  /** Every glyph's advance, where the caller has them already. */
  known?: number[],
): void {
  const mappings: Array<{ codepoint: number; glyphId: number }> = [];
  typeface.glyphs.forEach((glyph, index) => {
    for (const codepoint of glyph.unicodes) mappings.push({ codepoint, glyphId: index });
  });
  const codepoints = mappings.map((entry) => entry.codepoint);

  const advances = known ?? typeface.glyphs.map((glyph) => resolveAdvanceWidth(glyph, typeface));
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
      fontRevision: fontRevisionOf(typeface.meta.version),
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
  tables.set(
    "post",
    buildPost(
      isItalic ? -12 : 0,
      typeface.unitsPerEm,
      typeface.glyphs.map((glyph) => glyph.name),
    ),
  );
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
