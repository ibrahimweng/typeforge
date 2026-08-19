/**
 * Control letters.
 *
 * A typeface is not designed by moving every letter at once. A designer draws
 * n and o until they are right, then H and O, and those few letters fix the
 * stem width, the x-height, the counter and the roundness that everything else
 * has to agree with. The rest of the alphabet is made to match them.
 *
 * This module makes that the actual mechanism: edit a control letter, and the
 * qualities that changed are measured off it and applied to the whole font. The
 * parameters were always there; what was missing was any way to set them by
 * drawing rather than by guessing at a slider.
 *
 * n and o for the lowercase, H and O for the capitals, and 0 1 3 for the
 * figures -- round, single-stem and double-bowl, which is enough to pin the
 * numerals.
 */

import { measureGlyph, type GlyphMeasurements } from "./measure";
import { resolveGlyphContours } from "./transform";
import {
  DEFAULT_PARAMS,
  type Contour,
  type Glyph,
  type GlyphParams,
  type Typeface,
} from "./types";

/** The letters that drive the rest, in the order they are worth drawing. */
export const CONTROL_GLYPHS = ["n", "o", "H", "O", "zero", "one", "three"] as const;

export type ControlName = (typeof CONTROL_GLYPHS)[number];

/** Which control letters speak for the lowercase, the capitals and the figures. */
export const CONTROL_GROUPS: Record<string, readonly string[]> = {
  lowercase: ["n", "o"],
  capitals: ["H", "O"],
  figures: ["zero", "one", "three"],
};

export function isControlGlyph(name: string): boolean {
  return (CONTROL_GLYPHS as readonly string[]).includes(name);
}

export type ControlReadings = Map<string, GlyphMeasurements>;

/**
 * Measure every control letter a font actually has.
 *
 * Read from the drawn contours rather than the resolved ones, so what is
 * measured is what the designer put there and not the result of a parameter
 * that this measurement is about to help decide.
 */
export function readControls(typeface: Typeface): ControlReadings {
  const readings: ControlReadings = new Map();
  for (const name of CONTROL_GLYPHS) {
    const glyph = typeface.glyphs.find((candidate) => candidate.name === name);
    if (!glyph || glyph.contours.length === 0) continue;
    const measured = measureGlyph(glyph.contours, glyph.advanceWidth);
    if (measured) readings.set(name, measured);
  }
  return readings;
}

/**
 * How much a quality has to move before it counts as an edit.
 *
 * Dragging a point by a unit or two is noise from rounding and from the
 * designer's hand, and should not push the whole font around. At 2048 units to
 * the em these are roughly a quarter of a percent.
 */
const STEM_THRESHOLD = 4;
const HEIGHT_RATIO_THRESHOLD = 0.005;
const COUNTER_RATIO_THRESHOLD = 0.01;

/** A quality that changed on a control letter, and by how much. */
export interface ControlChange {
  glyph: string;
  quality: "stem" | "height" | "counter" | "width";
  from: number;
  to: number;
}

export interface Derivation {
  params: Partial<GlyphParams>;
  changes: ControlChange[];
}

/**
 * How much stem a unit of weight actually buys, for this particular outline.
 *
 * Emboldening moves each point along the normal of its averaged tangent, so
 * how much of that movement ends up widening the stem depends on the shape:
 * at the corner of a straight-sided letter the point travels diagonally and
 * only part of the movement is horizontal, while on the flank of a round one
 * almost all of it is. Assuming a fixed factor of two -- both sides of the
 * stem moving out by the full amount -- overshot by roughly four times on a
 * rectangle, which would have made every derived font far bolder than asked.
 *
 * So the rate is measured rather than assumed: embolden by a probe amount,
 * measure what the stem did, and scale. The offset is linear in the amount, so
 * one probe describes the whole range, and running it through the same
 * resolve path the export uses means the answer stays true even if the
 * emboldening itself is changed later.
 */
const WEIGHT_PROBE = 10;

function stemPerWeightUnit(contours: Contour[]): number | null {
  const before = measureGlyph(contours, 0)?.stemWidth;
  if (before == null) return null;

  const probe: Glyph = {
    name: "probe",
    unicodes: [],
    advanceWidth: 0,
    contours,
    components: [],
    anchors: [],
    params: { ...DEFAULT_PARAMS, weight: WEIGHT_PROBE },
    dirty: false,
  };
  const host = {
    glyphs: [probe],
    params: { ...DEFAULT_PARAMS },
  } as unknown as Typeface;

  const after = measureGlyph(resolveGlyphContours(probe, host), 0)?.stemWidth;
  if (after == null) return null;

  const rate = (after - before) / WEIGHT_PROBE;
  return Math.abs(rate) < 1e-6 ? null : rate;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Run contours through the real parameter pipeline. */
function applyParams(contours: Contour[], params: GlyphParams, advance: number): Contour[] {
  const probe: Glyph = {
    name: "probe",
    unicodes: [],
    advanceWidth: advance,
    contours,
    components: [],
    anchors: [],
    params,
    dirty: false,
  };
  const host = { glyphs: [probe], params: { ...DEFAULT_PARAMS } } as unknown as Typeface;
  return resolveGlyphContours(probe, host);
}

/** How many refinement passes to run, and how close counts as arrived. */
const FIT_PASSES = 6;
const FIT_TOLERANCE = 0.0005;

/**
 * Fit parameters that turn one outline into another's measurements.
 *
 * The parameters are circularly coupled, which is what makes this iterative
 * rather than a formula. Weight thickens a stem but also widens the ink and
 * lifts the top of a curve; width is a horizontal scale, so it widens the very
 * stems weight was just set to control. Two earlier attempts failed on exactly
 * this. Assuming weight was half the stem change overshot fourfold, because
 * emboldening travels along an averaged normal and at a corner only part of
 * that widens the stem. Fitting each quality once, independently, overshot the
 * other way: a rectangle asked to go from 180 to 200 units came out at 222,
 * charged once by weight and again by width for the same edit.
 *
 * So each pass measures what the parameters so far actually produce and
 * corrects towards the target, through the same resolve path the export uses.
 * A handful of passes settles it, and the loop stops early once nothing is
 * moving.
 */
function fitParams(
  baseline: Contour[],
  target: GlyphMeasurements,
  advance: number,
): Partial<GlyphParams> {
  const fitted: GlyphParams = { ...DEFAULT_PARAMS };
  const rate = stemPerWeightUnit(baseline);
  const targetHeight = target.inkTop - target.inkBottom;

  for (let pass = 0; pass < FIT_PASSES; pass++) {
    const current = measureGlyph(applyParams(baseline, fitted, advance), advance);
    if (!current) break;
    let moved = 0;

    if (rate !== null && current.stemWidth !== null && target.stemWidth !== null) {
      const correction = (target.stemWidth - current.stemWidth) / rate;
      fitted.weight += correction;
      moved = Math.max(moved, Math.abs(correction) / Math.max(1, Math.abs(fitted.weight)));
    }

    const currentHeight = current.inkTop - current.inkBottom;
    if (currentHeight > 0 && targetHeight > 0) {
      const factor = targetHeight / currentHeight;
      fitted.xHeightScale *= factor;
      moved = Math.max(moved, Math.abs(factor - 1));
    }

    // Only a counter the transform can actually reach: see closedCounterWidth.
    if (
      current.closedCounterWidth !== null &&
      current.closedCounterWidth > 0 &&
      target.closedCounterWidth !== null
    ) {
      const factor = target.closedCounterWidth / current.closedCounterWidth;
      fitted.counterScale *= factor;
      moved = Math.max(moved, Math.abs(factor - 1));
    }

    // Width is deliberately not fitted here. How wide the ink runs is already
    // decided by the stem and the counter -- on a single-stroke letter like l
    // or 1 the ink width IS the stem width -- so a width knob fitted from the
    // same measurement gives the solve two controls for one observable and no
    // reason to prefer either. Left in, it pulled a stem asked to reach 200
    // units to 171, and a stem asked for 220 to 132. It stays a manual control.

    if (moved < FIT_TOLERANCE) break;
  }

  const result: Partial<GlyphParams> = {};
  const weight = round(fitted.weight);
  const height = round(fitted.xHeightScale, 4);
  const counter = round(fitted.counterScale, 4);
  if (weight !== DEFAULT_PARAMS.weight) result.weight = weight;
  if (height !== DEFAULT_PARAMS.xHeightScale) result.xHeightScale = height;
  if (counter !== DEFAULT_PARAMS.counterScale) result.counterScale = counter;
  return result;
}

/**
 * Turn edits to the control letters into family parameters.
 *
 * Only the letters that actually moved contribute. Editing n alone should push
 * the font from n, not average n's change against four letters that were left
 * as they were and so would dilute it towards nothing.
 *
 * Where several controls moved, the median of each parameter is taken rather
 * than the mean, so one letter dragged much further than the others does not
 * carry the whole font with it.
 */
export function deriveParams(
  baseline: ControlReadings,
  current: ControlReadings,
  /**
   * The control letter's outline **as it was when the baseline was taken**, not
   * as it is now. The fit works by applying candidate parameters to the old
   * shape and comparing against the new measurements, so handing it the edited
   * outline asks it to fit the target to itself and it derives nothing at all.
   */
  outlineFor: (name: string) => Contour[] | null = () => null,
): Derivation {
  const changes: ControlChange[] = [];
  const fits: Partial<GlyphParams>[] = [];

  for (const [name, before] of baseline) {
    const after = current.get(name);
    if (!after) continue;

    let moved = false;
    if (
      before.stemWidth !== null &&
      after.stemWidth !== null &&
      Math.abs(after.stemWidth - before.stemWidth) >= STEM_THRESHOLD
    ) {
      changes.push({ glyph: name, quality: "stem", from: before.stemWidth, to: after.stemWidth });
      moved = true;
    }

    const beforeHeight = before.inkTop - before.inkBottom;
    const afterHeight = after.inkTop - after.inkBottom;
    if (beforeHeight > 0 && Math.abs(afterHeight / beforeHeight - 1) >= HEIGHT_RATIO_THRESHOLD) {
      changes.push({ glyph: name, quality: "height", from: beforeHeight, to: afterHeight });
      moved = true;
    }

    if (
      before.counterWidth !== null &&
      after.counterWidth !== null &&
      before.counterWidth > 0 &&
      Math.abs(after.counterWidth / before.counterWidth - 1) >= COUNTER_RATIO_THRESHOLD
    ) {
      changes.push({
        glyph: name,
        quality: "counter",
        from: before.counterWidth,
        to: after.counterWidth,
      });
      moved = true;
    }

    const beforeWidth = before.inkRight - before.inkLeft;
    const afterWidth = after.inkRight - after.inkLeft;
    if (beforeWidth > 0 && Math.abs(afterWidth / beforeWidth - 1) >= HEIGHT_RATIO_THRESHOLD) {
      changes.push({ glyph: name, quality: "width", from: beforeWidth, to: afterWidth });
      moved = true;
    }

    if (!moved) continue;
    const outline = outlineFor(name);
    if (outline) fits.push(fitParams(outline, after, before.advanceWidth));
  }

  const params: Partial<GlyphParams> = {};
  const pick = (key: "weight" | "xHeightScale" | "counterScale"): void => {
    const values = fits.map((fit) => fit[key]).filter((value): value is number => value != null);
    const middle = median(values);
    if (middle !== null) params[key] = middle;
  };
  pick("weight");
  pick("xHeightScale");
  pick("counterScale");

  return { params, changes };
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Parameters that leave a glyph exactly as drawn.
 *
 * A control letter has to be pinned to these once its edit has been turned into
 * family parameters. Without it the letter is hit twice: once by the designer
 * moving its points, and again by the family weight that those very points
 * produced, so thickening n by 30 units would leave n 60 units thicker than the
 * rest of the alphabet it was meant to be setting the standard for.
 */
export function neutralParams(): GlyphParams {
  return { ...DEFAULT_PARAMS };
}
