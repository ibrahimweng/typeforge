/**
 * What governs this spot.
 *
 * Double-click the shoulder of an n and you should get the shoulder; the side
 * of a stem and you should get the weight; the foot of an l and you should get
 * the serif. The question is which control is behind a particular place on a
 * particular letter, and it is answered in two steps, neither of which is a
 * table of the alphabet.
 *
 * First, which run of the letter was pressed. Not guessed from the shape -- an
 * arch is not recognised by being curved -- but read off what the drawing
 * recorded while it was being made. A run built by `arch` said it was using the
 * shoulder at the moment it was built, and that note travels with it. This is
 * the same source the panel already uses to decide which parts a letter has,
 * asked one run at a time instead of once for the whole letter.
 *
 * Second, which of that run's controls is about the side that was pressed. The
 * shoulder has a spring and a reach, a bowl has three, and only one of them
 * moves the piece of edge under the pointer. So each is nudged, the letter is
 * drawn again, and the one that moves that edge most wins. Measured rather than
 * reasoned about, which matters twice over: it cannot go stale, and the same
 * measurement gives the drag speed. How far the edge moved for a known nudge is
 * how much value one font unit of dragging is worth, so a handle made this way
 * tracks the pointer by construction. Every handle written by hand carries a
 * divisor worked out on paper -- over the height for a fraction, over the stem
 * for a serif -- and getting one of those wrong is a control that runs five
 * hundred times too fast.
 *
 * The measurement is taken in the run's own frame rather than on the page.
 * A letter is slid sideways after it is drawn, to keep it inside its own left
 * edge, so making a stem heavier pushes its left flank out and then slides the
 * whole letter back by the same amount. On the page that flank never moves, and
 * a measurement taken there would conclude that nothing governs it. Taking the
 * slide off first asks what the shape did, which is the question.
 *
 * Deliberately not offered: the controls that move the letter rather than shape
 * it -- the spacing, the width, the slant. They move every spot on the letter,
 * so they are behind every spot and therefore behind none, and an early version
 * that scored them alongside the rest answered "slant" for the top of an H.
 * They have their own handles, out on the rail where the lines are.
 */

import { distance, flattenContour } from "@/font/geometry";
import type { Contour, Vec2 } from "@/font/types";
import { makeLetter, type Run } from "./build";
import type { AnyDrive, Handle } from "./handles";
import { PEN_CONTROLS, specFor, type PartControl, type PartName } from "./parts";
import type { Style } from "./style";

/** How far a candidate is nudged, as a share of its own range. */
const NUDGE = 0.05;

/** How close to the press still counts as here, as a share of the em. */
const HERE = 0.06;

/** How far from the ink a press may land and still be about the letter. */
const REACH = 0.045;

/** Points per curve when an outline is turned into something measurable. */
const STEPS = 8;

/**
 * The longest gap allowed between two of those points, as a share of the em.
 *
 * Flattening a contour puts points along its curves and leaves its straight
 * runs as the two ends of a line, which is right for drawing and useless for
 * measuring: the left flank of a stem is one straight run, so the nearest point
 * on it to somewhere halfway up is a corner five hundred units away. Every gap
 * is filled in to this spacing, and a press lands on the edge it looks like it
 * landed on.
 */
const SPACING = 0.012;

/**
 * How far the edge must move under a nudge before a control counts.
 *
 * In font units at a thousand to the em. It is a floor on the measurement
 * rather than on the control: below this the movement is the difference between
 * two flattenings of nearly the same curve, and dividing a nudge by it would
 * give a drag speed made of noise.
 */
const LEAST_MOVEMENT = 0.35;

/** One point in this many, for the second look over a whole run. */
const WIDE_STRIDE = 3;

/**
 * How much of the largest movement a piece of edge must show to count as having
 * moved with it, rather than as an edge that stayed put nearby.
 */
const SHARE = 0.6;

export interface Governing {
  handle: Handle;
  /** Which named decisions the run that was pressed was built from. */
  parts: PartName[];
}

interface Candidate {
  drive: AnyDrive;
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
}

/**
 * What could be behind a spot on this run.
 *
 * The pen's weight always, because every run is drawn with the pen. The
 * controls of the parts this run was built from, because those are the named
 * decisions that shaped it. And the serif, wherever the run wears the style's
 * own terminal -- a serif is a thing that happens at the end of a stroke, and
 * the end of a stroke is exactly what a terminal is.
 */
function candidatesFor(run: Run, style: Style): Candidate[] {
  const em = style.metrics.unitsPerEm;
  const found: Candidate[] = [];
  const seen = new Set<string>();

  const add = (drive: AnyDrive, control: PartControl, from: Record<string, unknown>) => {
    if (control.toggle || control.options) return;
    const value = from[control.key];
    if (typeof value !== "number") return;
    const id = driveId(drive);
    if (seen.has(id)) return;
    seen.add(id);
    const scale = control.emRelative ? em : 1;
    found.push({
      drive,
      label: control.label,
      hint: control.hint,
      min: control.min * scale,
      max: control.max * scale,
      value,
    });
  };

  const weight = PEN_CONTROLS.find((control) => control.key === "weight");
  if (weight) {
    add({ on: "pen", key: "weight" }, weight as PartControl, style.pen as unknown as Record<string, unknown>);
  }

  const wanted: PartName[] = [...run.parts];
  if (wanted.includes("terminal")) wanted.push("slab");

  for (const part of wanted) {
    const spec = specFor(part);
    if (!spec) continue;
    const values = (style.parts as unknown as Record<string, Record<string, unknown>>)[part];
    if (!values) continue;
    for (const control of spec.controls) add({ on: "part", part, key: control.key }, control, values);
  }

  return found;
}

/** The same style with one control moved. */
export function withValue(style: Style, drive: AnyDrive, value: number): Style {
  if (drive.on === "pen") {
    return { ...style, pen: { ...style.pen, [drive.key]: value } as Style["pen"] };
  }
  if (drive.on === "metrics") {
    return { ...style, metrics: { ...style.metrics, [drive.key]: value } as Style["metrics"] };
  }
  const parts = style.parts as unknown as Record<string, Record<string, unknown>>;
  return {
    ...style,
    parts: {
      ...style.parts,
      [drive.part]: { ...parts[drive.part], [drive.key]: value },
    } as Style["parts"],
  };
}

function outlineOf(contours: Contour[], em: number, slide = 0): Vec2[] {
  const most = em * SPACING;
  const points: Vec2[] = [];
  for (const contour of contours) {
    const walk = flattenContour(contour, STEPS);
    for (let index = 0; index < walk.length; index++) {
      const from = walk[index];
      const to = walk[(index + 1) % walk.length];
      const gap = distance(from, to);
      const steps = Math.max(1, Math.ceil(gap / most));
      for (let step = 0; step < steps; step++) {
        const t = step / steps;
        points.push({
          x: from.x + (to.x - from.x) * t - slide,
          y: from.y + (to.y - from.y) * t,
        });
      }
    }
  }
  return points;
}

/** The nearest of a set of points, and how far away it is. */
function nearest(points: Vec2[], to: Vec2): { point: Vec2; away: number } | null {
  let best: Vec2 | null = null;
  let away = Infinity;
  for (const point of points) {
    const gap = distance(point, to);
    if (gap < away) {
      away = gap;
      best = point;
    }
  }
  return best ? { point: best, away } : null;
}

/** What one control did to one place on the edge. */
interface Reading {
  /** Where on the old outline, so a handle can be put there. */
  point: Vec2;
  moved: number;
  shift: Vec2;
}

/**
 * How far the edge near a spot moved, and which way.
 *
 * Movement is the distance from a point on the old outline to the nearest point
 * on the new one, which is displacement across the edge rather than along it.
 * That distinction is why this reads the way a person would: an edge that slid
 * along itself has not moved, and nobody looking at the two drawings would say
 * it had.
 */
function around(before: Vec2[], after: Vec2[], at: Vec2, here: number): Reading | null {
  const seen: Array<{ moved: number; shift: Vec2 }> = [];
  let most = 0;
  for (const point of before) {
    if (distance(point, at) > here) continue;
    const found = nearest(after, point);
    if (!found) continue;
    seen.push({
      moved: found.away,
      shift: { x: found.point.x - point.x, y: found.point.y - point.y },
    });
    if (found.away > most) most = found.away;
  }
  if (most <= 0) return null;

  /*
   * Averaged over the parts that moved, not over everything nearby.
   *
   * A neighbourhood is not all one edge. At the tip of a serif it is the tip,
   * which travels the whole way when the serif lengthens, and the two long
   * sides of the bar, which get longer without going anywhere: every point on
   * them lands on the new bar at no distance at all. Averaged flat, the sides
   * outnumber the tip and the answer comes out two or three times too slow --
   * a handle that lags the pointer by a factor nobody would guess at.
   */
  const moving = seen.filter((one) => one.moved >= most * SHARE);
  let shiftX = 0;
  let shiftY = 0;
  let total = 0;
  for (const one of moving) {
    shiftX += one.shift.x;
    shiftY += one.shift.y;
    total += one.moved;
  }
  return {
    point: at,
    moved: total / moving.length,
    shift: { x: shiftX / moving.length, y: shiftY / moving.length },
  };
}

/**
 * The same question asked of the whole run, for an edge that cannot move.
 *
 * Some edges are pinned. The left flank of a stem sits on the sidebearing at
 * every weight -- the stroke grows to the right and the left side stays exactly
 * where it was -- so nothing moves the place that was pressed and the first
 * reading finds nothing at all. That is true and unhelpful: somebody pressing
 * the side of a stem means the stem's thickness whichever side they pressed.
 *
 * So the run is asked again without the neighbourhood, and the answer is put on
 * the nearest piece of that run which does move. The handle lands a stem's
 * width from the pointer instead of under it, which is the honest place for it:
 * it is where the edge that follows the drag actually is.
 */
function anywhere(before: Vec2[], after: Vec2[], from: Vec2): Reading | null {
  const seen: Reading[] = [];
  let most = 0;
  for (let index = 0; index < before.length; index += WIDE_STRIDE) {
    const point = before[index];
    const found = nearest(after, point);
    if (!found) continue;
    seen.push({
      point,
      moved: found.away,
      shift: { x: found.point.x - point.x, y: found.point.y - point.y },
    });
    if (found.away > most) most = found.away;
  }
  if (most <= 0) return null;

  // The nearest place that moved most of what anything moved. Nearest, so the
  // handle stays as close to the press as the drawing allows.
  let best: Reading | null = null;
  let closest = Infinity;
  for (const reading of seen) {
    if (reading.moved < most * SHARE) continue;
    const away = distance(reading.point, from);
    if (away < closest) {
      closest = away;
      best = reading;
    }
  }
  return best;
}

/**
 * The control behind a spot on a letter, as a handle sitting on the edge that
 * was pressed.
 *
 * Nothing comes back when the press missed the letter, or when nothing the run
 * is made of moves anything at all -- which is a real answer and better than a
 * handle that cannot be pulled anywhere.
 */
export function whatGoverns(
  letter: string,
  style: Style,
  press: Vec2,
  form?: string,
): Governing | null {
  const made = makeLetter(letter, style, form);
  if (!made || made.runs.length === 0) return null;

  const em = style.metrics.unitsPerEm;
  const here = em * HERE;

  // Which run was pressed: the one whose edge comes nearest the pointer.
  let pressed: { run: Run; index: number; at: Vec2; away: number } | null = null;
  made.runs.forEach((run, index) => {
    const found = nearest(outlineOf(run.contours, em), press);
    if (!found) return;
    if (!pressed || found.away < pressed.away) {
      pressed = { run, index, at: found.point, away: found.away };
    }
  });
  if (!pressed) return null;
  const hit: { run: Run; index: number; at: Vec2; away: number } = pressed;
  if (hit.away > em * REACH) return null;

  // Taken off both drawings, so what is compared is the shape rather than
  // where the letter came to rest.
  const local = { x: hit.at.x - made.slide, y: hit.at.y };
  const before = outlineOf(hit.run.contours, em, made.slide);

  /*
   * Every candidate drawn once, and both readings taken off the same drawing.
   *
   * The near reading is the one that matters and is the one used wherever it
   * finds anything. The wide one is only consulted when no control moves the
   * edge that was pressed, and taking it here costs one pass over a run that
   * has already been drawn rather than a second round of drawing.
   */
  const measured: Array<{ candidate: Candidate; nudge: number; span: number; near: Reading | null; wide: Reading | null }> = [];

  for (const candidate of candidatesFor(hit.run, style)) {
    const span = candidate.max - candidate.min;
    if (span <= 0) continue;
    /*
     * Nudged away from whichever end it is nearer, so a control already at its
     * limit is still measured. Held at the top, a nudge upwards is no nudge at
     * all and the control would read as governing nothing.
     */
    const step = span * NUDGE;
    const room = candidate.max - candidate.value >= step ? step : -step;
    const to = Math.min(candidate.max, Math.max(candidate.min, candidate.value + room));
    const nudge = to - candidate.value;
    if (nudge === 0) continue;

    const other = makeLetter(letter, withValue(style, candidate.drive, to), form);
    const run = other?.runs[hit.index];
    if (!other || !run) continue;

    const after = outlineOf(run.contours, em, other.slide);
    measured.push({
      candidate,
      nudge,
      span,
      near: around(before, after, local, here),
      wide: anywhere(before, after, local),
    });
  }

  /*
   * The best of them, per unit of dial.
   *
   * Divided by how far each was nudged as a share of its own range, or a
   * control with a wide range would win on nothing more than having been pushed
   * further. Anything whose movement is too small to divide by is passed over
   * rather than allowed to win with a drag speed made of rounding, so a reading
   * that would be thrown away later cannot crowd out a usable one here.
   */
  const pick = (which: "near" | "wide"): { candidate: Candidate; reading: Reading; nudge: number } | null => {
    let best: { candidate: Candidate; reading: Reading; nudge: number; score: number } | null = null;
    for (const entry of measured) {
      const reading = entry[which];
      if (!reading) continue;
      const { shift } = reading;
      if (Math.max(Math.abs(shift.x), Math.abs(shift.y)) < LEAST_MOVEMENT) continue;
      const score = reading.moved / Math.abs(entry.nudge / entry.span);
      if (!best || score > best.score) {
        best = { candidate: entry.candidate, reading, nudge: entry.nudge, score };
      }
    }
    return best;
  };

  const found = pick("near") ?? pick("wide");
  if (!found) return null;

  const { candidate, reading } = found;
  const alongX = Math.abs(reading.shift.x) >= Math.abs(reading.shift.y);
  const travel = alongX ? reading.shift.x : reading.shift.y;

  return {
    parts: hit.run.parts,
    handle: {
      id: driveId(candidate.drive),
      // Back on the page, where the letter is actually drawn.
      at: { x: reading.point.x + made.slide, y: reading.point.y },
      axis: alongX ? "x" : "y",
      label: candidate.label,
      hint: candidate.hint,
      drive: candidate.drive,
      value: candidate.value,
      // Measured rather than reasoned about: this much value for each font unit
      // the edge moved when it was nudged.
      perUnit: found.nudge / travel,
      min: candidate.min,
      max: candidate.max,
    },
  };
}

/** What a control is set to now, whichever half of the style it lives in. */
export function valueOf(style: Style, drive: AnyDrive): number {
  const from =
    drive.on === "pen"
      ? (style.pen as unknown as Record<string, unknown>)
      : drive.on === "metrics"
        ? (style.metrics as unknown as Record<string, unknown>)
        : ((style.parts as unknown as Record<string, Record<string, unknown>>)[drive.part] ?? {});
  const value = from[drive.key];
  return typeof value === "number" ? value : 0;
}

/** A name for a drive, which is also how the panel finds the control again. */
export function driveId(drive: AnyDrive): string {
  return drive.on === "part" ? `part:${drive.part}:${drive.key}` : `${drive.on}:${drive.key}`;
}
