/**
 * Putting a pile of drawings onto the same lines.
 *
 * Somebody hands you twenty-six SVG files. Each was drawn on its own canvas,
 * at whatever size the drawing wanted, sitting wherever it happened to sit.
 * None of them knows where the baseline is, because an SVG has no baseline.
 * A font is exactly the opposite: the letters share a baseline, a cap height
 * and an x-height, and nothing else about a set of drawings matters half as
 * much as whether they do.
 *
 * So the job is to work out, from the drawings alone, what the transform is
 * that puts each one where it belongs. The trick is that the letters tell you.
 * An H is as tall as the caps are; an x is as tall as the lowercase is; a p
 * hangs by exactly the descender. Measure the ones whose height is known and
 * the scale falls out; measure where the flat-bottomed ones stop and the
 * baseline falls out with it.
 *
 * Nothing here touches x. Where a letter sits sideways is spacing's business
 * and spacing does it far better than a bounding box could, so a drawing keeps
 * its own horizontal coordinates until it gets there.
 */

import { contoursBounds, type Bounds } from "@/font/geometry";
import type { Contour } from "@/font/types";

/** The lines a set of drawings is being fitted to. */
export interface FitMetrics {
  unitsPerEm: number;
  capHeight: number;
  xHeight: number;
  ascender: number;
  /** Negative. */
  descender: number;
  /** How far a round letter is allowed past a flat one. */
  overshoot: number;
}

/**
 * What a character is expected to measure, and how much that is worth.
 *
 * `top` and `bottom` are in font units against the metrics being fitted to.
 * `sure` marks the letters worth deriving a scale from: an H is flat top and
 * bottom and is exactly the cap height, so it settles the question. A t is
 * somewhere between the x-height and the ascender and settles nothing, so it
 * is placed by what is derived from the others rather than allowed a vote.
 */
export interface Expectation {
  top: number;
  bottom: number;
  sure: boolean;
  /**
   * Which line this letter is evidence about.
   *
   * Needed because the letters that know their own height do not all know the
   * same height, and blending their answers is worse than picking one. An H
   * says how tall the caps are; an x says how tall the lowercase is; the
   * relation between those two is the designer's decision and not something to
   * be averaged out of existence.
   */
  measures: Measured;
}

export type Measured = "cap" | "xheight" | "ascender" | "descender";

/** Letters that are flat top and bottom, so their bounds are their metrics. */
const FLAT_CAPS = "BDEFHIKLMNPRTUVWXYZ";
const FLAT_XHEIGHT = "vwxyz";
const ROUND_CAPS = "COQGS";
const ROUND_XHEIGHT = "aceos";
/** Reaches the ascender rather than the cap height. */
const ASCENDING = "bdhkl";
/** Hangs below the baseline. */
const DESCENDING = "gpqy";

export function expectationFor(character: string, metrics: FitMetrics): Expectation | null {
  const { capHeight, xHeight, ascender, descender, overshoot } = metrics;

  const cap = (top: number, bottom: number, sure: boolean): Expectation => ({
    top,
    bottom,
    sure,
    measures: "cap",
  });

  if (FLAT_CAPS.includes(character)) return cap(capHeight, 0, true);
  if (ROUND_CAPS.includes(character)) {
    // Q's tail goes below the line in most faces and in none of them by a
    // predictable amount, so it is placed but not asked.
    if (character === "Q") return cap(capHeight + overshoot, 0, false);
    return cap(capHeight + overshoot, -overshoot, true);
  }
  if (character === "A") return cap(capHeight, 0, true);
  if (character === "J") return cap(capHeight, 0, false);

  if (FLAT_XHEIGHT.includes(character)) {
    // y descends; the other three do not.
    if (character === "y") {
      return { top: xHeight, bottom: descender, sure: false, measures: "descender" };
    }
    return { top: xHeight, bottom: 0, sure: true, measures: "xheight" };
  }
  if (ROUND_XHEIGHT.includes(character)) {
    return { top: xHeight + overshoot, bottom: -overshoot, sure: true, measures: "xheight" };
  }
  if (character === "m" || character === "n" || character === "r" || character === "u") {
    return { top: xHeight, bottom: 0, sure: true, measures: "xheight" };
  }
  if (ASCENDING.includes(character)) {
    return { top: ascender, bottom: 0, sure: true, measures: "ascender" };
  }
  if (DESCENDING.includes(character)) {
    const round = character === "g" || character === "q";
    return {
      top: xHeight + (round ? overshoot : 0),
      bottom: descender,
      sure: true,
      measures: "descender",
    };
  }

  // The rest are real letters with unreliable extents: an i and a j are their
  // dots, an f and a t stop somewhere between two lines, and where they stop
  // is a decision the drawing has already made.
  if (character === "i" || character === "j") {
    return {
      top: ascender,
      bottom: character === "j" ? descender : 0,
      sure: false,
      measures: character === "j" ? "descender" : "ascender",
    };
  }
  if (character === "f" || character === "t") {
    return { top: ascender, bottom: 0, sure: false, measures: "ascender" };
  }

  if (character >= "0" && character <= "9") return cap(capHeight, 0, false);

  return null;
}

/** One drawing waiting to be fitted. */
export interface Fittable {
  character: string;
  contours: Contour[];
}

/**
 * What to do to a drawing to put it on the lines.
 *
 * `y_font = shift - y_svg * scale`, and the minus sign is the whole of the
 * difference between a drawing and a letter. SVG measures y downwards from the
 * top of a page; a font measures it upwards from a baseline that is not on the
 * page at all. x is left exactly as it was, because where a letter sits
 * sideways is settled later and settled better.
 */
export interface Placement {
  scale: number;
  /** Where the drawing's own zero lands, in font units, after the flip. */
  shift: number;
  /**
   * Whether the letter itself settled this, or it inherited the set's answer.
   *
   * Shown in the panel, because a letter placed by inheritance is the one
   * worth looking at twice.
   */
  measured: boolean;
}

/**
 * How the set is fitted.
 *
 * `together` keeps the sizes the drawings were made at relative to each other
 * and moves the whole set onto the lines as one. Right when the files came out
 * of a single document, which is the usual way an alphabet is drawn, and the
 * only way that keeps a deliberately small letter small.
 *
 * `alone` fits each drawing to what its own character should measure. Right
 * when the files were drawn or exported separately and the relative sizes mean
 * nothing -- and wrong when they mean something, because it will happily make
 * a small-capital as tall as a cap.
 */
export type FitMode = "together" | "alone";

/**
 * Which way a pile of files is asking to be fitted.
 *
 * Drawings laid out against each other share a canvas, and the evidence of
 * that is a shared height. Height and not width, because the fit is a vertical
 * question from end to end: a set of per-letter exports out of one document
 * has one canvas height and as many widths as there are letters, and those
 * letters are every bit as much in proportion as ones on a single sheet.
 * Asking about width would send exactly the case this is for down the wrong
 * road.
 *
 * It is a guess, and it is offered as one: the panel says which was chosen and
 * lets it be changed.
 */
export function detectFit(boxes: Array<{ height: number }>): FitMode {
  if (boxes.length < 2) return "alone";
  const [first] = boxes;
  if (!(first.height > 0)) return "alone";
  return boxes.every((box) => close(box.height, first.height)) ? "together" : "alone";
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-6, Math.abs(a) * 1e-4);
}

/**
 * Work out where every drawing goes.
 *
 * The two modes differ in one thing only: whether the scale and the baseline
 * are settled once for the set or once per letter. Everything else -- which
 * letters are worth asking, what each one should measure -- is shared, which
 * is why they are one function rather than two.
 */
export function placements(
  pieces: Fittable[],
  metrics: FitMetrics,
  mode: FitMode,
): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const measured = pieces
    .map((piece) => ({
      piece,
      bounds: contoursBounds(piece.contours),
      expects: expectationFor(piece.character, metrics),
    }))
    .filter((entry) => usable(entry.bounds));

  // The letters allowed a vote: known extents, and enough drawing to measure.
  const voters = measured.filter((entry) => entry.expects?.sure);

  if (mode === "alone") {
    const fallback = agreedScale(voters) ?? 1;
    for (const entry of measured) {
      const wanted = entry.expects;
      if (wanted && spans(entry.bounds) > 0) {
        const scale = (wanted.top - wanted.bottom) / spans(entry.bounds);
        // The bottom of the drawing is its yMax, since the flip turns the page
        // over. Put that on the line the character says it stops at.
        out.set(entry.piece.character, {
          scale,
          shift: wanted.bottom + entry.bounds.yMax * scale,
          measured: wanted.sure,
        });
      } else {
        // No expectation to fit to, so it keeps the set's scale and sits on
        // the baseline. A drawing this application has never heard of is
        // still a drawing, and putting it on the line is better than dropping
        // it.
        out.set(entry.piece.character, {
          scale: fallback,
          shift: entry.bounds.yMax * fallback,
          measured: false,
        });
      }
    }
    return out;
  }

  // Together: one scale and one baseline for the set, from the letters that
  // know. Everything else keeps the proportion it was drawn at.
  const scale = agreedScale(voters) ?? 1;
  const sitting = voters.filter((entry) => entry.expects && entry.expects.bottom >= 0);
  const shifts = (sitting.length > 0 ? sitting : voters).map(
    (entry) => (entry.expects?.bottom ?? 0) + entry.bounds.yMax * scale,
  );
  const shift = median(shifts) ?? 0;

  for (const entry of measured) {
    out.set(entry.piece.character, {
      scale,
      shift,
      measured: Boolean(entry.expects?.sure),
    });
  }
  return out;
}

/** Apply a placement to a drawing. */
export function fitted(contours: Contour[], placement: Placement): Contour[] {
  const { scale, shift } = placement;
  const move = (point: { x: number; y: number }) => ({
    x: point.x * scale,
    y: shift - point.y * scale,
  });
  return contours.map((contour) => ({
    closed: contour.closed,
    nodes: contour.nodes.map((node) => ({
      point: move(node.point),
      handleIn: node.handleIn ? move(node.handleIn) : null,
      handleOut: node.handleOut ? move(node.handleOut) : null,
      type: node.type,
    })),
  }));
}

function usable(bounds: Bounds): boolean {
  return Number.isFinite(bounds.yMin) && Number.isFinite(bounds.yMax) && spans(bounds) > 0;
}

function spans(bounds: Bounds): number {
  return bounds.yMax - bounds.yMin;
}

/** Which class of letter is asked first when two of them are equally numerous. */
const PREFERENCE: Measured[] = ["cap", "xheight", "ascender", "descender"];

/**
 * The scale the set agrees on.
 *
 * Asked of one class of letter rather than of all of them. The caps say how
 * tall the caps are and the lowercase says how tall the lowercase is, and the
 * ratio between those two is the single most characterful decision in a
 * typeface -- so averaging the two answers does not split the difference, it
 * destroys the thing that made the drawings worth assembling. Whichever class
 * has the most evidence decides, and the rest keep the proportion they were
 * drawn at.
 *
 * Within the class it is a median rather than a mean, because one letter drawn
 * at the wrong size, or one file exported with a stray guide still in it,
 * would drag a mean along with it and leave every other letter wrong.
 */
function agreedScale(
  voters: Array<{ bounds: Bounds; expects: Expectation | null }>,
): number | null {
  const byClass = new Map<Measured, number[]>();
  for (const voter of voters) {
    if (!voter.expects) continue;
    const wanted = voter.expects.top - voter.expects.bottom;
    const has = spans(voter.bounds);
    if (has <= 0 || wanted <= 0) continue;
    const list = byClass.get(voter.expects.measures) ?? [];
    list.push(wanted / has);
    byClass.set(voter.expects.measures, list);
  }
  if (byClass.size === 0) return null;

  let best: Measured = PREFERENCE[0];
  let most = -1;
  for (const measures of PREFERENCE) {
    const count = byClass.get(measures)?.length ?? 0;
    if (count > most) {
      most = count;
      best = measures;
    }
  }
  return median(byClass.get(best) ?? []);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
