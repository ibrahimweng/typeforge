/**
 * Building the `glyf` and `loca` tables that hold TrueType outlines.
 *
 * Glyphs the user never touched are copied out of the original table byte for
 * byte. That keeps their hinting instructions, which live inside each glyph
 * record and would otherwise be lost the moment we re-encoded them. Only
 * modified glyphs are rebuilt, which is both the faithful choice and the fast
 * one: a typical edit touches a handful of glyphs out of thousands.
 */

import { contoursBounds } from "./geometry";
import { contourToGlyfPoints, type GlyfPoint } from "./quadratic";
import { ByteWriter } from "./sfnt";
import type { Contour } from "./types";

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;

export interface GlyfBuildInput {
  contours: Contour[];
  /** Original bytes for this glyph, reused when `rebuild` is false. */
  original?: Uint8Array;
  rebuild: boolean;
}

export interface GlyfTables {
  glyf: Uint8Array;
  loca: Uint8Array;
  /** 0 for the short `loca` format, 1 for long. Goes into `head.indexToLocFormat`. */
  indexToLocFormat: 0 | 1;
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number };
  /** Largest point and contour counts, needed by `maxp`. */
  maxPoints: number;
  maxContours: number;
}

export function buildGlyfTables(glyphs: GlyfBuildInput[], tolerance = 0.5): GlyfTables {
  const records: Uint8Array[] = [];
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  let maxPoints = 0;
  let maxContours = 0;

  for (const glyph of glyphs) {
    if (!glyph.rebuild && glyph.original) {
      records.push(glyph.original);
      if (glyph.original.length >= 10) {
        const view = new DataView(
          glyph.original.buffer,
          glyph.original.byteOffset,
          glyph.original.byteLength,
        );
        const contourCount = view.getInt16(0);
        xMin = Math.min(xMin, view.getInt16(2));
        yMin = Math.min(yMin, view.getInt16(4));
        xMax = Math.max(xMax, view.getInt16(6));
        yMax = Math.max(yMax, view.getInt16(8));
        if (contourCount > 0) maxContours = Math.max(maxContours, contourCount);
      }
      continue;
    }

    const drawable = glyph.contours.filter((contour) => contour.nodes.length > 0);
    if (drawable.length === 0) {
      // A glyph with no outline, such as a space, is stored as zero bytes.
      records.push(new Uint8Array(0));
      continue;
    }

    const pointsPerContour = drawable.map((contour) => contourToGlyfPoints(contour, tolerance));
    const total = pointsPerContour.reduce((sum, points) => sum + points.length, 0);
    if (total === 0) {
      records.push(new Uint8Array(0));
      continue;
    }
    maxPoints = Math.max(maxPoints, total);
    maxContours = Math.max(maxContours, drawable.length);

    const bounds = contoursBounds(drawable);
    xMin = Math.min(xMin, bounds.xMin);
    yMin = Math.min(yMin, bounds.yMin);
    xMax = Math.max(xMax, bounds.xMax);
    yMax = Math.max(yMax, bounds.yMax);

    records.push(encodeSimpleGlyph(pointsPerContour, bounds));
  }

  // Records must start on even offsets for the short `loca` format to address them.
  const padded = records.map((record) => {
    if (record.length % 2 === 0) return record;
    const out = new Uint8Array(record.length + 1);
    out.set(record);
    return out;
  });

  const total = padded.reduce((sum, record) => sum + record.length, 0);
  const useLongLoca = total > 0x1fffe;

  const glyf = new Uint8Array(total);
  const offsets: number[] = [];
  let cursor = 0;
  for (const record of padded) {
    offsets.push(cursor);
    glyf.set(record, cursor);
    cursor += record.length;
  }
  offsets.push(cursor); // `loca` holds one extra entry marking the end

  const loca = new ByteWriter();
  for (const offset of offsets) {
    if (useLongLoca) loca.uint32(offset);
    else loca.uint16(offset / 2);
  }

  return {
    glyf,
    loca: loca.toUint8Array(),
    indexToLocFormat: useLongLoca ? 1 : 0,
    bounds: Number.isFinite(xMin)
      ? { xMin: Math.floor(xMin), yMin: Math.floor(yMin), xMax: Math.ceil(xMax), yMax: Math.ceil(yMax) }
      : { xMin: 0, yMin: 0, xMax: 0, yMax: 0 },
    maxPoints,
    maxContours,
  };
}

/** Encode one simple (non-composite) glyph record. */
function encodeSimpleGlyph(
  pointsPerContour: GlyfPoint[][],
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number },
): Uint8Array {
  const writer = new ByteWriter();
  writer.int16(pointsPerContour.length);
  writer.int16(Math.floor(bounds.xMin));
  writer.int16(Math.floor(bounds.yMin));
  writer.int16(Math.ceil(bounds.xMax));
  writer.int16(Math.ceil(bounds.yMax));

  let index = -1;
  for (const points of pointsPerContour) {
    index += points.length;
    writer.uint16(index); // index of this contour's last point
  }
  writer.uint16(0); // no hinting instructions on rebuilt glyphs

  const all = pointsPerContour.flat();

  // Coordinates are stored as deltas, each in the smallest form that fits.
  const flags: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  let previousX = 0;
  let previousY = 0;

  for (const point of all) {
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    const dx = x - previousX;
    const dy = y - previousY;
    previousX = x;
    previousY = y;

    let flag = point.onCurve ? ON_CURVE : 0;

    if (dx === 0) {
      flag |= X_SAME_OR_POSITIVE; // repeats the previous x
    } else if (dx >= -255 && dx <= 255) {
      flag |= X_SHORT;
      if (dx > 0) flag |= X_SAME_OR_POSITIVE;
      xs.push(Math.abs(dx));
    } else {
      xs.push(dx);
    }

    if (dy === 0) {
      flag |= Y_SAME_OR_POSITIVE;
    } else if (dy >= -255 && dy <= 255) {
      flag |= Y_SHORT;
      if (dy > 0) flag |= Y_SAME_OR_POSITIVE;
      ys.push(Math.abs(dy));
    } else {
      ys.push(dy);
    }
    flags.push(flag);
  }

  // Runs of identical flags collapse into one flag plus a repeat count.
  for (let i = 0; i < flags.length; ) {
    const flag = flags[i];
    let run = 1;
    while (i + run < flags.length && flags[i + run] === flag && run < 256) run++;
    if (run > 1) {
      writer.uint8(flag | REPEAT);
      writer.uint8(run - 1);
    } else {
      writer.uint8(flag);
    }
    i += run;
  }

  let xIndex = 0;
  for (const flag of flags) {
    if (flag & X_SHORT) writer.uint8(xs[xIndex++]);
    else if (!(flag & X_SAME_OR_POSITIVE)) writer.int16(xs[xIndex++]);
  }
  let yIndex = 0;
  for (const flag of flags) {
    if (flag & Y_SHORT) writer.uint8(ys[yIndex++]);
    else if (!(flag & Y_SAME_OR_POSITIVE)) writer.int16(ys[yIndex++]);
  }

  return writer.toUint8Array();
}

/** Split an existing `glyf` table into per-glyph records using its `loca`. */
export function splitGlyf(
  glyf: Uint8Array,
  loca: Uint8Array,
  indexToLocFormat: number,
  numGlyphs: number,
): Uint8Array[] {
  const view = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
  const offsetAt = (index: number): number =>
    indexToLocFormat === 0 ? view.getUint16(index * 2) * 2 : view.getUint32(index * 4);

  const records: Uint8Array[] = [];
  for (let i = 0; i < numGlyphs; i++) {
    const start = offsetAt(i);
    const end = offsetAt(i + 1);
    records.push(end > start ? glyf.subarray(start, Math.min(end, glyf.length)) : new Uint8Array(0));
  }
  return records;
}
