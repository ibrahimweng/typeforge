/**
 * Writing a font that varies.
 *
 * A variable font is one set of outlines and, beside them, a description of how
 * every point in them moves as a slider is turned. The outlines go in `glyf` as
 * they always did; the sliders are declared in `fvar` and the movement is
 * stored in `gvar`.
 *
 * This half of the application is already a machine for drawing the same
 * alphabet at any weight, so the masters cost nothing to make -- draw the
 * letters again with the pen set differently and subtract. What it is not, and
 * never had to be, is a machine for drawing the same alphabet with the same
 * points in the same order. That is the whole difficulty, and most of what is
 * in this file exists to establish whether it is true rather than to assume it.
 *
 * Two things had to be measured before any of it could be written.
 *
 * The letters themselves keep their structure: across a fivefold range of
 * weight, a hundred and eighty-nine of a hundred and ninety-seven glyphs come
 * back with the same contours and the same number of nodes in each. The eight
 * that do not are letters that genuinely change as they get heavier -- the bar
 * of a G, the join of an M, the two strokes of a yen sign running together.
 *
 * The conversion to the quadratic curves a font file stores did not, and had to
 * be changed. Splitting each curve until the error is small enough gives a
 * different number of points at every weight, so only seventy-one of the
 * hundred and ninety-six survived it. Splitting each curve a fixed number of
 * ways instead keeps a hundred and eighty-seven. See `cubicInPieces`.
 *
 * What is left over is dealt with honestly rather than hidden: a glyph whose
 * structure changes gets no variation data, so it stands at its default while
 * the rest of the font moves, and it is named in the notes.
 */

import { ByteWriter } from "./sfnt";
import type { GlyfPoint } from "./quadratic";

/**
 * How many quadratics every curve becomes in a varying font.
 *
 * Fixed rather than fitted, because the points have to line up between masters.
 * Measured over the whole character set at three weights, two pieces a curve is
 * out by 1.9 units at worst, three by 0.6 and four by 0.2 -- and a font file
 * stores whole units, so four is already past the point of mattering.
 */
export const PIECES_PER_CURVE = 4;

/** One slider: what it is called, and how far it goes. */
export interface Axis {
  /** The four-letter tag the format uses. `wght`, `slnt`, and so on. */
  tag: string;
  /** What to call it on screen, written into `name`. */
  label: string;
  min: number;
  default: number;
  max: number;
}

/** A named place along the sliders, so a font offers "Bold" and not only 700. */
export interface Instance {
  label: string;
  /** Where it sits, by axis tag. Any axis left out sits at its default. */
  at: Record<string, number>;
}

/**
 * One glyph as one master drew it: its points, and where its advance ends.
 *
 * The advance is here because it varies too, and in this format it varies by
 * the same machinery -- a font file carries four invisible "phantom" points
 * after the real ones, and moving the second of them is what makes a heavy
 * weight wider than a light one.
 */
export interface MasterGlyph {
  points: GlyfPoint[];
  advanceWidth: number;
  /** The left side bearing, which fixes where the first phantom point sits. */
  leftSideBearing: number;
  xMin: number;
}

/** Everything one master says about the whole font. */
export interface Master {
  /** Where this master sits on each axis, by tag. */
  at: Record<string, number>;
  glyphs: MasterGlyph[];
}

// ---------------------------------------------------------------------------
// fvar
// ---------------------------------------------------------------------------

/** Fixed 16.16, which is how the format stores an axis position. */
function fixed(value: number): number {
  return Math.round(value * 65536);
}

/** F2Dot14, which is how it stores a position normalised to -1..1. */
function f2dot14(value: number): number {
  return Math.round(Math.max(-1, Math.min(1, value)) * 16384);
}

/**
 * The sliders themselves.
 *
 * Every axis and every named instance points at a string in `name` rather than
 * carrying its own text, so the ids to use are passed in -- whoever builds
 * `name` owns them, and having two places invent ids independently is how a
 * font ends up with a weight axis called "Regular".
 */
export function buildFvar(
  axes: Axis[],
  instances: Instance[],
  axisNameIds: number[],
  instanceNameIds: number[],
): Uint8Array {
  const w = new ByteWriter();
  const axesOffset = 16;
  const axisSize = 20;
  const instanceSize = 4 + axes.length * 4;

  w.uint16(1).uint16(0);
  w.uint16(axesOffset);
  w.uint16(2); // reserved, and the format asks for 2 rather than 0
  w.uint16(axes.length);
  w.uint16(axisSize);
  w.uint16(instances.length);
  w.uint16(instanceSize);

  for (const [index, axis] of axes.entries()) {
    w.uint32(tag(axis.tag));
    w.int32(fixed(axis.min));
    w.int32(fixed(axis.default));
    w.int32(fixed(axis.max));
    w.uint16(0); // no flags: every axis here is one somebody should see
    w.uint16(axisNameIds[index]);
  }

  for (const [index, instance] of instances.entries()) {
    w.uint16(instanceNameIds[index]);
    w.uint16(0); // flags
    for (const axis of axes) w.int32(fixed(instance.at[axis.tag] ?? axis.default));
  }

  return w.toUint8Array();
}

function tag(text: string): number {
  const four = (text + "    ").slice(0, 4);
  return (
    ((four.charCodeAt(0) << 24) |
      (four.charCodeAt(1) << 16) |
      (four.charCodeAt(2) << 8) |
      four.charCodeAt(3)) >>>
    0
  );
}

// ---------------------------------------------------------------------------
// gvar
// ---------------------------------------------------------------------------

/**
 * Where a master sits, in the -1 to 1 the variation tables work in.
 *
 * Everything in `gvar` is measured from the default, one direction at a time:
 * the default is nought, the far end of an axis is one, the near end is minus
 * one, and anything between is a fraction. So each master has to be told where
 * it stands before its deltas mean anything.
 */
export function normalise(axes: Axis[], at: Record<string, number>): number[] {
  return axes.map((axis) => {
    const value = at[axis.tag] ?? axis.default;
    if (value === axis.default) return 0;
    if (value > axis.default) {
      const span = axis.max - axis.default;
      return span > 0 ? Math.min(1, (value - axis.default) / span) : 0;
    }
    const span = axis.default - axis.min;
    return span > 0 ? Math.max(-1, (value - axis.default) / span) : 0;
  });
}

/**
 * The four invisible points every glyph carries after its real ones.
 *
 * They are where the format keeps the advance and the side bearings, and they
 * are why a heavy weight can be wider than a light one: the second of them is
 * the far edge of the advance, so a delta on it moves the advance.
 */
function withPhantoms(glyph: MasterGlyph): Array<{ x: number; y: number }> {
  const origin = glyph.xMin - glyph.leftSideBearing;
  return [
    ...glyph.points.map((point) => ({ x: point.x, y: point.y })),
    { x: origin, y: 0 },
    { x: origin + glyph.advanceWidth, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
}

/** Whether two masters drew this glyph the same way, so one can vary the other. */
function linesUp(one: MasterGlyph, other: MasterGlyph): boolean {
  if (one.points.length !== other.points.length) return false;
  return one.points.every((point, index) => point.onCurve === other.points[index].onCurve);
}

export interface GvarResult {
  gvar: Uint8Array;
  /** Glyph indices left standing still because their masters disagree. */
  unvarying: number[];
}

/**
 * How every point moves, for every glyph and every master.
 *
 * One tuple per master per glyph, each carrying its own peak and its own delta
 * for every point. There is a shorter way to write this -- tuples that share a
 * peak, deltas that name only the points that moved -- and it is not taken.
 * The saving is real and the encoding is where variable fonts go wrong, so what
 * is here is the form with the fewest ways to be subtly incorrect, and the
 * result is checked against fontTools rather than against my reading of the
 * specification.
 */
export function buildGvar(axes: Axis[], defaults: Master, masters: Master[]): GvarResult {
  const count = defaults.glyphs.length;
  const unvarying: number[] = [];
  const perGlyph: Uint8Array[] = [];

  for (let index = 0; index < count; index++) {
    const base = defaults.glyphs[index];
    const usable = masters.filter((master) => linesUp(base, master.glyphs[index]));
    if (usable.length < masters.length && base.points.length > 0) unvarying.push(index);

    if (usable.length === 0 || base.points.length === 0) {
      perGlyph.push(new Uint8Array(0));
      continue;
    }

    const from = withPhantoms(base);
    const tuples: Tuple[] = [];
    for (const master of usable) {
      const to = withPhantoms(master.glyphs[index]);
      /*
       * The difference between the two rounded points, not the rounded
       * difference between the two.
       *
       * They are not the same number, and the file only ever holds rounded
       * points: a glyph's outline goes into `glyf` as integers, and a delta is
       * added to those. Rounded after subtracting, the sum lands within a unit
       * of the master rather than on it -- which is invisible on a stem and
       * shows up on anything thin, an s at a Thin coming out most of a per
       * cent away from the same s drawn on its own.
       */
      const deltas = from.map((point, at) => ({
        x: Math.round(to[at].x) - Math.round(point.x),
        y: Math.round(to[at].y) - Math.round(point.y),
      }));
      // A master that moves nothing is a tuple that says nothing.
      if (deltas.every((delta) => delta.x === 0 && delta.y === 0)) continue;
      tuples.push({ ...regionOf(axes, master.at, masters), deltas });
    }

    perGlyph.push(tuples.length === 0 ? new Uint8Array(0) : glyphVariations(axes, tuples));
  }

  // Long offsets throughout. Short ones halve the offset array and are stored
  // as half the real value, so they only work while every offset is even --
  // one more thing to get right for a saving measured in bytes.
  const header = new ByteWriter();
  header.uint16(1).uint16(0);
  header.uint16(axes.length);
  header.uint16(0); // no shared tuples: every tuple carries its own peak
  const sharedTuplesOffset = 20 + (count + 1) * 4;
  header.uint32(sharedTuplesOffset);
  header.uint16(count);
  header.uint16(1); // long offsets
  header.uint32(sharedTuplesOffset);

  let running = 0;
  for (const glyph of perGlyph) {
    header.uint32(running);
    running += glyph.length;
  }
  header.uint32(running);

  const out = new ByteWriter();
  out.bytesFrom(header.toUint8Array());
  for (const glyph of perGlyph) out.bytesFrom(glyph);
  return { gvar: out.toUint8Array(), unvarying };
}

/**
 * Where one master's say reaches, and not only where it peaks.
 *
 * A tuple states a peak, and by default the format reads the region either
 * side of it as running all the way back to the middle and out to the end.
 * With one master at each end of an axis that is exactly right. With a master
 * in between it is not: masters at 400, 700 and 900 put the 700 at 0.6 of the
 * way along and the 900 at the end, and the 900's default region covers 0.6 as
 * well -- so at 700 the letter gets its own master plus six tenths of the
 * Black's, and the Bold came out wider than the Black. fontTools reads the
 * font perfectly and draws the wrong letter, which is the kind of wrong worth
 * being careful about.
 *
 * So each master is given the region between its neighbours: from the peak of
 * the master before it to the peak of the one after, or to the middle and the
 * end where there is none. Two neighbouring tents then cross at exactly the
 * height that carries a point from one master to the next in a straight line,
 * which is what interpolating between two drawings means.
 *
 * One axis at a time, which is what a master here is: every one of them is the
 * whole font drawn again with a single setting moved, so it sits at nought on
 * every axis but one.
 */
interface Tuple {
  peak: number[];
  start: number[];
  end: number[];
  deltas: Array<{ x: number; y: number }>;
}

export interface Region {
  peak: number[];
  start: number[];
  end: number[];
}

export function regionOf(
  axes: Axis[],
  at: Record<string, number>,
  all: Array<{ at: Record<string, number> }>,
): Region {
  const peak = normalise(axes, at);
  const start = peak.map(() => 0);
  const end = peak.map(() => 0);

  for (let axis = 0; axis < axes.length; axis++) {
    const here = peak[axis];
    if (here === 0) continue;
    // The other masters that move this same axis the same way, and how far.
    const alongside = all
      .map((master) => normalise(axes, master.at)[axis])
      .filter((value) => value !== 0 && Math.sign(value) === Math.sign(here));
    const nearer = alongside.filter((value) => Math.abs(value) < Math.abs(here));
    const further = alongside.filter((value) => Math.abs(value) > Math.abs(here));
    // The neighbour on the way back to the middle, and the one on the way out.
    const inward =
      nearer.length > 0 ? nearer.reduce((a, b) => (Math.abs(a) > Math.abs(b) ? a : b)) : 0;
    const outward =
      further.length > 0
        ? further.reduce((a, b) => (Math.abs(a) < Math.abs(b) ? a : b))
        : Math.sign(here);
    /*
     * Written low to high rather than inner to outer, which the format
     * requires and which is not the same thing on the light side of an axis:
     * there the middle is the higher of the two. Written the other way round
     * the region reads as impossible, the tuple counts for nothing wherever it
     * is asked, and a Thin comes out the weight of the Regular -- with
     * fontTools reading the file without complaint, because a region that
     * cannot happen is not a malformed one.
     */
    start[axis] = here > 0 ? inward : outward;
    end[axis] = here > 0 ? outward : inward;
  }
  return { peak, start, end };
}

/** One glyph's tuples, headers and data together. */
function glyphVariations(axes: Axis[], tuples: Tuple[]): Uint8Array {
  const EMBEDDED_PEAK = 0x8000;
  const INTERMEDIATE_REGION = 0x4000;
  const PRIVATE_POINTS = 0x2000;

  const bodies = tuples.map((tuple) => {
    const body = new ByteWriter();
    // Nought points means every point, which is what makes this the short way
    // to say "all of them" rather than the long way to list them.
    body.uint8(0);
    body.bytesFrom(packDeltas(tuple.deltas.map((delta) => delta.x)));
    body.bytesFrom(packDeltas(tuple.deltas.map((delta) => delta.y)));
    return body.toUint8Array();
  });

  const headers = new ByteWriter();
  headers.uint16(tuples.length);
  /*
   * Where the data starts, measured from the beginning of this glyph's record:
   * the count, the offset itself, and one header per tuple. Every tuple is
   * written the same length -- peak and region alike -- so that this is one
   * sum rather than a walk, and because a font with one master an axis pays
   * four bytes a tuple for it.
   */
  const headerBytes = 4 + tuples.length * (4 + axes.length * 3 * 2);
  headers.uint16(headerBytes);
  for (const [index, tuple] of tuples.entries()) {
    headers.uint16(bodies[index].length);
    headers.uint16(EMBEDDED_PEAK | INTERMEDIATE_REGION | PRIVATE_POINTS);
    for (const value of tuple.peak) headers.int16(f2dot14(value));
    for (const value of tuple.start) headers.int16(f2dot14(value));
    for (const value of tuple.end) headers.int16(f2dot14(value));
  }

  const out = new ByteWriter();
  out.bytesFrom(headers.toUint8Array());
  for (const body of bodies) out.bytesFrom(body);
  // Every glyph's record starts on an even boundary, which the offsets above
  // assume and nothing else enforces.
  if (out.length % 2 === 1) out.uint8(0);
  return out.toUint8Array();
}

/**
 * Deltas, run-length packed the way the format asks for.
 *
 * Three kinds of run: a run of zeroes, which stores no data at all; a run of
 * small numbers, one byte each; and a run of large ones, two bytes each. A run
 * is at most sixty-four long because the count shares a byte with the two bits
 * that say which kind it is.
 */
function packDeltas(deltas: number[]): Uint8Array {
  const ZEROES = 0x80;
  const WORDS = 0x40;
  const w = new ByteWriter();

  let at = 0;
  while (at < deltas.length) {
    if (deltas[at] === 0) {
      let run = 0;
      while (at + run < deltas.length && deltas[at + run] === 0 && run < 64) run++;
      w.uint8(ZEROES | (run - 1));
      at += run;
      continue;
    }

    const small = (value: number): boolean => value >= -128 && value <= 127;
    if (small(deltas[at])) {
      let run = 0;
      // Stopping at a zero as well as at a large number: a zero is cheaper in a
      // run of its own than as a byte in this one, and a lone zero between two
      // small numbers is not, so it takes two in a row to be worth breaking for.
      while (
        at + run < deltas.length &&
        small(deltas[at + run]) &&
        run < 64 &&
        !(deltas[at + run] === 0 && deltas[at + run + 1] === 0)
      ) {
        run++;
      }
      w.uint8(run - 1);
      for (let index = 0; index < run; index++) w.uint8(deltas[at + index] & 0xff);
      at += run;
      continue;
    }

    let run = 0;
    while (at + run < deltas.length && !small(deltas[at + run]) && run < 64) run++;
    w.uint8(WORDS | (run - 1));
    for (let index = 0; index < run; index++) w.int16(deltas[at + index]);
    at += run;
  }

  return w.toUint8Array();
}

// ---------------------------------------------------------------------------
// STAT
// ---------------------------------------------------------------------------

/**
 * What the axes are called, for the software that arranges families.
 *
 * A variable font is not valid without it, and the smallest thing that counts
 * as one is a list of axis records with no values hung off them: it says what
 * the axes are and in what order to show them, and leaves the rest to `fvar`.
 */
export function buildStat(axes: Axis[], axisNameIds: number[]): Uint8Array {
  const w = new ByteWriter();
  w.uint16(1).uint16(2);
  w.uint16(8); // designAxisSize
  w.uint16(axes.length);
  w.uint32(20); // designAxesOffset
  w.uint16(0); // no axis value tables
  w.uint32(0);
  w.uint16(2); // elidedFallbackNameID: "Regular"

  for (const [index, axis] of axes.entries()) {
    w.uint32(tag(axis.tag));
    w.uint16(axisNameIds[index]);
    w.uint16(index); // ordering: the order they were declared in
  }
  return w.toUint8Array();
}

/**
 * How much of one master's say applies at a place in the design space.
 *
 * This is the reader's own arithmetic, written down here so that the preview on
 * screen and the file on disk cannot disagree about what the font looks like at
 * 550. Everything it needs -- `normalise` and `regionOf` -- is what `gvar` was
 * written from, so the two are the same computation rather than two readings of
 * the same specification.
 *
 * An axis the master does not move contributes one rather than nothing. That is
 * the format's rule and it is the whole reason a design space can be a star
 * rather than a grid: a Condensed drawn at the Regular's weight still applies
 * at every weight, because it says nothing about weight.
 */
export function scalarAt(region: Region, location: number[]): number {
  let scalar = 1;
  for (let axis = 0; axis < region.peak.length; axis += 1) {
    const peak = region.peak[axis];
    // A peak of nought is an axis this master has no opinion about.
    if (peak === 0) continue;
    const here = location[axis] ?? 0;
    if (here === peak) continue;
    const start = region.start[axis];
    const end = region.end[axis];
    if (here <= start || here >= end) return 0;
    scalar *= here < peak ? (here - start) / (peak - start) : (end - here) / (end - peak);
  }
  return scalar;
}
