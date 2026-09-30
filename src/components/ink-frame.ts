/**
 * The box a line of type is shown in.
 *
 * A proof or a picker that crops the letters it shows is lying about them: the
 * tail of a y is the whole difference between its forms, and the ring of an Å
 * is the part most likely to collide with the line above. So the frame is the
 * ascender to the descender, which keeps the size of a line steady while the
 * text changes, grown to take in any ink that reaches past those lines, with a
 * little air around it so nothing sits flush against the edge.
 */

import { contoursBounds } from "@/font/geometry";
import type { Contour } from "@/font/types";

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placed {
  contours: Contour[];
  x: number;
}

/**
 * The frame, in the flipped space an SVG draws type in (y down, so the top of
 * the frame is minus the highest point).
 */
export function inkFrame(
  metrics: { ascender: number; descender: number; unitsPerEm: number },
  pieces: Placed[],
  advance: number,
): Frame {
  let top = metrics.ascender;
  let bottom = metrics.descender;
  let left = 0;
  let right = Math.max(advance, 1);
  let spills = false;
  for (const piece of pieces) {
    if (piece.contours.length === 0) continue;
    const bounds = contoursBounds(piece.contours);
    if (bounds.yMax > top) {
      top = bounds.yMax;
      spills = true;
    }
    if (bounds.yMin < bottom) {
      bottom = bounds.yMin;
      spills = true;
    }
    left = Math.min(left, bounds.xMin + piece.x);
    right = Math.max(right, bounds.xMax + piece.x);
  }
  // Air above and below: always a little, so a descender never sits on the
  // edge, and a little more once something has spilled past the lines.
  const air = metrics.unitsPerEm * (spills ? 0.04 : 0.02);
  top += air;
  bottom -= air;
  return { x: left, y: -top, width: right - left, height: top - bottom };
}

export function viewBoxOf(frame: Frame): string {
  const round = (value: number) => Math.round(value * 100) / 100;
  return `${round(frame.x)} ${round(frame.y)} ${round(frame.width)} ${round(frame.height)}`;
}
