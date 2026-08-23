/**
 * Building the `glyf` and `loca` tables that hold TrueType outlines.
 *
 * Glyphs the user never touched are copied out of the original table byte for
 * byte. That keeps their hinting instructions, which live inside each glyph
 * record and would otherwise be lost the moment we re-encoded them. Only
 * modified glyphs are rebuilt, which is both the faithful choice and the fast
 * one: a typical edit touches a handful of glyphs out of thousands.
 */

import { contoursBounds, type Bounds } from "./geometry";
import { contourToGlyfPoints, type GlyfPoint } from "./quadratic";
import { ByteWriter } from "./sfnt";
import type { Contour } from "./types";

// Composite record flags, from the OpenType specification.
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;
const ROUND_XY_TO_GRID = 0x0004;
/**
 * This glyph's pieces overlap, and the renderer should fill them as one shape.
 *
 * The one thing a font file can say instead of merging. A variable font cannot
 * merge: the movement between masters is stored as a difference between two
 * lists of points, so the two lists have to hold the same points in the same
 * order, and a union re-points whatever it is given. Drawn as separate strokes
 * the letters line up at every weight; fused they stop lining up wherever the
 * strokes meet differently as the pen widens, which on a text face is most of
 * the lower case.
 *
 * So the strokes are left overlapping and this says so. Under a non-zero fill
 * that changes nothing, and it tells a rasteriser doing coverage antialiasing
 * not to darken the seams where they overlap.
 */
const OVERLAP_COMPOUND = 0x0400;

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;
/** The simple-glyph counterpart of `OVERLAP_COMPOUND`, on the first point. */
const OVERLAP_SIMPLE = 0x40;

export interface GlyfBuildInput {
  contours: Contour[];
  /** Original bytes for this glyph, reused when `rebuild` is false. */
  original?: Uint8Array;
  rebuild: boolean;
  /**
   * Write this glyph as a reference to others rather than as an outline.
   *
   * Keeping a composite whole is what makes `á` stay a copy of `a` in the file:
   * the outline is stored once, and a correction to the letter reaches every
   * accented form of it. Flattening works too, and is the fallback wherever the
   * arrangement cannot be expressed as a plain reference.
   */
  composite?: CompositeRef[];
}

export interface CompositeRef {
  /** Index of the referenced glyph in the font. */
  glyphIndex: number;
  transform: { a: number; b: number; c: number; d: number; dx: number; dy: number };
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
  /** Largest number of references in any one composite, also needed by `maxp`. */
  maxComponents: number;
  /**
   * The points that went into each glyph, flattened across its contours.
   *
   * Handed back because a varying font has to say how every one of them moves,
   * and the deltas are only meaningful against exactly the points that were
   * written. Reading the table back to find them out would work and would be
   * one more place for the two to disagree.
   */
  points: GlyfPoint[][];
}

export function buildGlyfTables(
  glyphs: GlyfBuildInput[],
  tolerance = 0.5,
  /**
   * Split every curve this many ways instead of as few as the tolerance allows.
   *
   * Only a varying font asks for it, and it asks because the same letter drawn
   * at two ends of an axis has to arrive with the same points in the same
   * order, which a tolerance does not promise.
   */
  pieces?: number,
  /**
   * Mark every glyph as holding overlapping pieces.
   *
   * For a font whose outlines were never merged, which is what a varying font
   * has to be. Said once for the whole font rather than worked out per glyph,
   * because it is a fact about how the font was written.
   */
  overlapping = false,
): GlyfTables {
  const records: Uint8Array[] = [];
  const points: GlyfPoint[][] = [];
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  let maxPoints = 0;
  let maxContours = 0;
  let maxComponents = 0;

  for (const glyph of glyphs) {
    if (!glyph.rebuild && glyph.original) {
      records.push(glyph.original);
      points.push([]);
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

    if (glyph.composite && glyph.composite.length > 0) {
      const bounds = contoursBounds(glyph.contours);
      records.push(encodeCompositeGlyph(glyph.composite, bounds, overlapping));
      // A composite has no points of its own: it varies through the glyphs it
      // refers to, which carry their own deltas.
      points.push([]);
      xMin = Math.min(xMin, bounds.xMin);
      yMin = Math.min(yMin, bounds.yMin);
      xMax = Math.max(xMax, bounds.xMax);
      yMax = Math.max(yMax, bounds.yMax);
      maxComponents = Math.max(maxComponents, glyph.composite.length);
      continue;
    }

    const drawable = glyph.contours.filter((contour) => contour.nodes.length > 0);
    if (drawable.length === 0) {
      // A glyph with no outline, such as a space, is stored as zero bytes.
      records.push(new Uint8Array(0));
      points.push([]);
      continue;
    }

    const pointsPerContour = drawable.map((contour) =>
      contourToGlyfPoints(contour, tolerance, pieces ? { pieces } : {}),
    );
    const total = pointsPerContour.reduce((sum, points) => sum + points.length, 0);
    if (total === 0) {
      records.push(new Uint8Array(0));
      points.push([]);
      continue;
    }
    maxPoints = Math.max(maxPoints, total);
    maxContours = Math.max(maxContours, drawable.length);

    const bounds = contoursBounds(drawable);
    xMin = Math.min(xMin, bounds.xMin);
    yMin = Math.min(yMin, bounds.yMin);
    xMax = Math.max(xMax, bounds.xMax);
    yMax = Math.max(yMax, bounds.yMax);

    records.push(encodeSimpleGlyph(pointsPerContour, bounds, overlapping));
    points.push(pointsPerContour.flat());
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
    maxComponents,
    points,
  };
}

/**
 * Encode a composite glyph record: a list of references, each with where the
 * referenced outline goes.
 *
 * Offsets are written as words whenever they will not fit in a byte, and a
 * transform is only written when there is one, so a plainly placed accent costs
 * eight bytes rather than an outline.
 */
function encodeCompositeGlyph(
  components: CompositeRef[],
  bounds: Bounds,
  overlapping = false,
): Uint8Array {
  const writer = new ByteWriter();
  writer.int16(-1); // negative contour count marks a composite
  writer.int16(Math.floor(bounds.xMin));
  writer.int16(Math.floor(bounds.yMin));
  writer.int16(Math.ceil(bounds.xMax));
  writer.int16(Math.ceil(bounds.yMax));

  components.forEach((component, index) => {
    const { a, b, c, d, dx, dy } = component.transform;
    const roundedX = Math.round(dx);
    const roundedY = Math.round(dy);

    const identity = a === 1 && b === 0 && c === 0 && d === 1;
    const evenScale = !identity && b === 0 && c === 0 && a === d;
    const axisScale = !identity && !evenScale && b === 0 && c === 0;

    let flags = ARGS_ARE_XY_VALUES | ROUND_XY_TO_GRID;
    if (overlapping && index === 0) flags |= OVERLAP_COMPOUND;
    const needsWords = roundedX < -128 || roundedX > 127 || roundedY < -128 || roundedY > 127;
    if (needsWords) flags |= ARG_1_AND_2_ARE_WORDS;
    if (evenScale) flags |= WE_HAVE_A_SCALE;
    else if (axisScale) flags |= WE_HAVE_AN_X_AND_Y_SCALE;
    else if (!identity) flags |= WE_HAVE_A_TWO_BY_TWO;
    if (index < components.length - 1) flags |= MORE_COMPONENTS;

    writer.uint16(flags);
    writer.uint16(component.glyphIndex);
    if (needsWords) {
      writer.int16(roundedX);
      writer.int16(roundedY);
    } else {
      writer.uint8(roundedX & 0xff);
      writer.uint8(roundedY & 0xff);
    }

    if (evenScale) {
      writer.int16(toF2Dot14(a));
    } else if (axisScale) {
      writer.int16(toF2Dot14(a));
      writer.int16(toF2Dot14(d));
    } else if (!identity) {
      writer.int16(toF2Dot14(a));
      writer.int16(toF2Dot14(b));
      writer.int16(toF2Dot14(c));
      writer.int16(toF2Dot14(d));
    }
  });

  return writer.toUint8Array();
}

/** Signed fixed point with 14 bits of fraction, clamped to what it can hold. */
function toF2Dot14(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value * 16384)));
}

/** Encode one simple (non-composite) glyph record. */
function encodeSimpleGlyph(
  pointsPerContour: GlyfPoint[][],
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number },
  overlapping = false,
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

  /*
   * On the first point and nowhere else, which is where the format looks for
   * it. Set before the runs are collapsed rather than after, or a first point
   * that happened to match its neighbours would be folded into a repeat and
   * the bit would be lost -- or worse, repeated onto points that never had it.
   */
  if (overlapping && flags.length > 0) flags[0] |= OVERLAP_SIMPLE;

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
