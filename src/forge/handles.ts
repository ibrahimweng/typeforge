/**
 * Dragging the letter instead of hunting for a slider.
 *
 * Every handle here is bound to something the font already has a name for.
 * Pulling the side of a stem is the weight; pulling the top of an arch is where
 * the shoulder springs; pulling the crossbar is its height. The drag is the
 * same edit the panel makes, expressed by hand.
 *
 * That binding is the whole design, and it is worth saying why rather than
 * letting the points move freely.
 *
 * A free point would be a change to one letter, and this half of the
 * application exists so that a change is never to one letter. Drag the shoulder
 * of an n and every arched letter has to follow, or the font stops being one
 * font. A free point would also be a shape nobody checked: the outlines here
 * cannot fold because they are grown from lines and arcs, and a point dropped
 * anywhere would take that away. Bound to a parameter, a drag inherits both --
 * it propagates, and it cannot produce a letter that does not work.
 *
 * What it costs is shapes nobody thought of, and that is a real cost. It is
 * paid back by adding parameters rather than by loosening the points: a control
 * nobody can name is one nobody can reuse.
 */

import { contoursBounds } from "@/font/geometry";
import type { Vec2 } from "@/font/types";
import { drawLetter } from "./build";
import { METRIC_CONTROLS, PART_SPECS, PEN_CONTROLS, partsUsedBy, type FieldControl } from "./parts";
import type { Style } from "./style";

/**
 * The range a handle may be pulled through, taken from the control it drives.
 *
 * Written out here as well, the two drifted: the panel opened the pen's angle
 * to a half turn and the handle for it stayed at forty degrees, so the same
 * decision had two different limits depending on which way you reached it.
 */
function rangeOf(controls: FieldControl[], key: string, em: number): { min: number; max: number } {
  const control = controls.find((candidate) => candidate.key === key);
  if (!control) return { min: -Infinity, max: Infinity };
  const scale = control.emRelative ? em : 1;
  return { min: control.min * scale, max: control.max * scale };
}

function partRange(part: string, key: string, em: number): { min: number; max: number } {
  const spec = PART_SPECS.find((candidate) => candidate.name === part);
  const control = spec?.controls.find((candidate) => candidate.key === key);
  if (!control) return { min: -Infinity, max: Infinity };
  const scale = control.emRelative ? em : 1;
  return { min: control.min * scale, max: control.max * scale };
}

/** What a handle changes when it moves. */
export type Drive =
  | { on: "pen"; key: "weight" }
  | { on: "metrics"; key: "xHeight" | "capHeight" | "counterWidth" | "sidebearing" | "width" | "slant" }
  | { on: "part"; part: "shoulder"; key: "spring" }
  | { on: "part"; part: "crossbar"; key: "height" }
  | { on: "part"; part: "slab"; key: "projection" | "thickness" }
  | { on: "part"; part: "bowl"; key: "squareness" }
  | { on: "part"; part: "corner"; key: "radius" };

export interface Handle {
  id: string;
  /** Where it sits, in font units. */
  at: Vec2;
  /** Which way it may be pulled. */
  axis: "x" | "y";
  label: string;
  /** What it does, said in the terms the panel uses. */
  hint: string;
  drive: Drive;
  /** The value it currently stands for. */
  value: number;
  /** How much the value changes per font unit dragged. */
  perUnit: number;
  min: number;
  max: number;
  /** A line drawn through it, so what is being measured is visible. */
  guide?: { from: Vec2; to: Vec2 };
}

/**
 * The handles for one letter.
 *
 * Only those that mean something here: an o has no shoulder to pull and an l
 * has no crossbar, so neither is offered one. Which parts a letter has is
 * already known, so this asks rather than guesses.
 */
export function handlesFor(letter: string, style: Style, form?: string): Handle[] {
  const drawn = drawLetter(letter, style, form);
  if (!drawn || drawn.contours.length === 0) return [];

  const bounds = contoursBounds(drawn.contours);
  const { metrics, pen, parts } = style;
  const em = metrics.unitsPerEm;
  // Asked of the form actually on the stage: a handle placed for a skeleton
  // that is not the one being looked at would sit somewhere the letter is not.
  const has = new Set(partsUsedBy(letter, style, form));
  const handles: Handle[] = [];

  /*
   * The weight, taken at the left edge of the ink.
   *
   * Put a third of the way up rather than halfway, because halfway up an o is
   * the widest part of the bowl and halfway up an e is the crossbar; a third is
   * a stem on most letters and the flank of a curve on the rest, and both are
   * the thing the weight actually controls.
   */
  handles.push({
    id: "weight",
    at: { x: bounds.xMin + pen.weight, y: bounds.yMin + (bounds.yMax - bounds.yMin) * 0.33 },
    axis: "x",
    label: "Weight",
    hint: "How wide the pen is. Every letter in the font follows.",
    drive: { on: "pen", key: "weight" },
    value: pen.weight,
    perUnit: 1,
    ...rangeOf(PEN_CONTROLS, "weight", em),
    guide: {
      from: { x: bounds.xMin, y: bounds.yMin + (bounds.yMax - bounds.yMin) * 0.33 },
      to: { x: bounds.xMin + pen.weight, y: bounds.yMin + (bounds.yMax - bounds.yMin) * 0.33 },
    },
  });

  // The x-height and the cap height, on the lines themselves.
  const rail = bounds.xMax + em * 0.06;
  handles.push({
    id: "xHeight",
    at: { x: rail, y: metrics.xHeight },
    axis: "y",
    label: "x-height",
    hint: "How tall the lowercase is.",
    drive: { on: "metrics", key: "xHeight" },
    value: metrics.xHeight,
    perUnit: 1,
    ...rangeOf(METRIC_CONTROLS, "xHeight", em),
    guide: { from: { x: 0, y: metrics.xHeight }, to: { x: rail, y: metrics.xHeight } },
  });
  handles.push({
    id: "capHeight",
    at: { x: rail, y: metrics.capHeight },
    axis: "y",
    label: "Cap height",
    hint: "How tall the capitals are.",
    drive: { on: "metrics", key: "capHeight" },
    value: metrics.capHeight,
    perUnit: 1,
    ...rangeOf(METRIC_CONTROLS, "capHeight", em),
    guide: { from: { x: 0, y: metrics.capHeight }, to: { x: rail, y: metrics.capHeight } },
  });

  /*
   * The rhythm, at the letter's right edge.
   *
   * Dragging it wider moves the far stem out, which is the width inside an n --
   * so a unit of drag is a unit of counter, and the handle keeps pace with the
   * pointer. The round letters do not read it and are not offered it.
   */
  const arched = has.has("shoulder");
  if (arched) {
    handles.push({
      id: "counterWidth",
      at: { x: bounds.xMax, y: metrics.xHeight * 0.18 },
      axis: "x",
      label: "Rhythm",
      hint: "The width inside an n, which sets how wide everything with two uprights runs.",
      drive: { on: "metrics", key: "counterWidth" },
      value: metrics.counterWidth,
      perUnit: 1,
      ...rangeOf(METRIC_CONTROLS, "counterWidth", em),
    });

    /*
     * Where the shoulder springs, on the stem it leaves.
     *
     * Held as a fraction of the height, so a unit of drag has to be divided by
     * the height to become a change in the fraction. Without that division the
     * handle would run five hundred times faster than the pointer and the
     * control would be unusable.
     */
    const height = /[A-Z]/.test(letter) ? metrics.capHeight : metrics.xHeight;
    handles.push({
      id: "shoulder",
      at: { x: bounds.xMin + pen.weight / 2, y: height * parts.shoulder.spring },
      axis: "y",
      label: "Shoulder",
      hint: "Where the arch leaves the stem. High squares it off; low rounds the whole arch.",
      drive: { on: "part", part: "shoulder", key: "spring" },
      value: parts.shoulder.spring,
      perUnit: 1 / height,
      ...partRange("shoulder", "spring", em),
    });
  }

  if (has.has("crossbar")) {
    const height = /[A-Z]/.test(letter) ? metrics.capHeight : metrics.xHeight;
    const bar = height * parts.crossbar.height;
    handles.push({
      id: "crossbar",
      at: { x: (bounds.xMin + bounds.xMax) / 2, y: bar },
      axis: "y",
      label: "Crossbar",
      hint: "Where the bar sits, as a fraction of the letter it crosses.",
      drive: { on: "part", part: "crossbar", key: "height" },
      value: parts.crossbar.height,
      perUnit: 1 / height,
      ...partRange("crossbar", "height", em),
      guide: { from: { x: bounds.xMin, y: bar }, to: { x: bounds.xMax, y: bar } },
    });
  }

  /*
   * The serif, at the foot of the letter where one would be.
   *
   * Held in stem widths, so a drag measured in font units has to be divided by
   * the stem to become a change in the value. Without that division a handle
   * on a hairline face would run a hundred times faster than the pointer.
   */
  if (has.has("slab") && parts.slab.on) {
    const stem = Math.max(pen.weight, 1);
    handles.push({
      id: "slabReach",
      at: { x: bounds.xMin, y: metrics.unitsPerEm * 0.02 },
      axis: "x",
      label: "Serif reach",
      hint: "How far the bar sticks out past the stroke, in stem widths.",
      drive: { on: "part", part: "slab", key: "projection" },
      // Pulled left to make it longer, which is the direction the serif itself
      // grows on this side of the letter.
      perUnit: -1 / stem,
      value: parts.slab.projection,
      ...partRange("slab", "projection", em),
    });
    handles.push({
      id: "slabDepth",
      at: { x: bounds.xMin + pen.weight * 0.5, y: parts.slab.thickness * stem },
      axis: "y",
      label: "Serif depth",
      hint: "How far the bar reaches back along the stroke, in stem widths.",
      drive: { on: "part", part: "slab", key: "thickness" },
      value: parts.slab.thickness,
      perUnit: 1 / stem,
      ...partRange("slab", "thickness", em),
    });
  }

  /*
   * How square the bowls are, pulled at the side of one.
   *
   * On the shoulder of the bowl rather than at its widest point: the widest
   * point does not move as a circle squares off, so a handle there would sit
   * still while the letter changed under it.
   */
  if (has.has("bowl")) {
    const top = bounds.yMin + (bounds.yMax - bounds.yMin) * 0.82;
    handles.push({
      id: "squareness",
      at: { x: bounds.xMax, y: top },
      axis: "x",
      label: "Squareness",
      hint: "Nought is a circle; pulled out, the sides straighten into a rounded rectangle.",
      drive: { on: "part", part: "bowl", key: "squareness" },
      value: parts.bowl.squareness,
      // A full pull across the bowl takes it from round to square.
      perUnit: 1 / Math.max(bounds.xMax - bounds.xMin, 1),
      ...partRange("bowl", "squareness", em),
    });
  }

  if (has.has("corner")) {
    handles.push({
      id: "cornerRadius",
      at: { x: bounds.xMin + em * 0.02 + parts.corner.radius, y: bounds.yMax },
      axis: "x",
      label: "Corner",
      hint: "How wide an arc a corner turns through. Far enough and the letter reads as one ribbon bent round.",
      drive: { on: "part", part: "corner", key: "radius" },
      value: parts.corner.radius,
      perUnit: 1,
      ...partRange("corner", "radius", em),
    });
  }

  return handles;
}

/** Where a handle's value lands after dragging by this many font units. */
export function valueAfter(handle: Handle, movedUnits: number): number {
  const next = handle.value + movedUnits * handle.perUnit;
  return Math.min(handle.max, Math.max(handle.min, next));
}
