/**
 * Bottom-heavy bowls: a bowl's inner side moved off its centre-line, so the
 * stroke is thinner across its top and heavier across its foot.
 *
 * A pen of one shape draws a bowl as heavy at the crown as at the foot,
 * whatever its angle, because its width across a stroke depends only on which
 * way the stroke runs and a bowl runs both ways. Moving the whole inner side
 * by one vector keeps everything exact -- a line stays a line and an ellipse
 * keeps its radii about a moved centre -- and keeps every weld, since the side
 * moves together; and the width it changes goes with the direction of travel,
 * which is the cos-shaped swell a written bowl has.
 *
 * Switched on by `parts.bowl.heft`, which no base sets: a stroke without
 * `Stroke.heft` never reaches anything here.
 */

import type { Vec2 } from "@/font/types";
import type { Style } from "./style";
import { type Headed, type OffsetSegment, type PenReach, reachAlong } from "./sweep";
import type { Stroke } from "./types";

/**
 * Which side of a stroke is the inside of its turning: one for the left of
 * its direction of travel, minus one for the right, nought where it does not
 * turn -- no arcs, or arcs that turn as far one way as the other.
 *
 * Read off the skeleton, by the sign of the arcs' signed sweeps added up, so it
 * is the same at every weight.
 */
export function innerSide(headed: Headed[]): -1 | 0 | 1 {
  let turned = 0;
  for (const { segment } of headed) {
    if (segment.kind !== "arc") continue;
    const sweep = Math.abs(segment.endAngle - segment.startAngle);
    turned += segment.sweepPositive ? sweep : -sweep;
  }
  return turned > 0 ? 1 : turned < 0 ? -1 : 0;
}

/**
 * How far the inner side moves: `heft.share` of the stroke's width in the
 * direction `heft.tilt` degrees off straight up (positive to the right), and
 * never more than 1.2 times the pen's narrow reach, so the inner side cannot
 * reach the outer one. Nothing for a stroke with no heft.
 */
export function heftShift(stroke: Stroke, reach: PenReach): Vec2 {
  const heft = stroke.heft;
  if (!heft) return { x: 0, y: 0 };
  const tilt = (heft.tilt * Math.PI) / 180;
  const way = { x: Math.sin(tilt), y: Math.cos(tilt) };
  const pen = reachAlong(way, reach);
  const width = 2 * Math.abs(pen.x * way.x + pen.y * way.y);
  const by = Math.min(heft.share * width, 1.2 * reach.along);
  return { x: way.x * by, y: way.y * by };
}

/**
 * The two side runs of a stroke with its inner side moved by `heftShift`, as
 * new runs: the runs given, and their pieces, are left as they were, since
 * the sweep compares the two (see `sidesAt` in sweep.ts).
 *
 * Not built yet: hands back the runs it was given.
 */
export function hefted(
  _stroke: Stroke,
  _headed: Headed[],
  left: OffsetSegment[],
  right: OffsetSegment[],
  _reach: PenReach,
): [OffsetSegment[], OffsetSegment[]] {
  return [left, right];
}

/**
 * A stroke given the style's heft, where it takes one: every closed spine,
 * and every stroke its recipe marked `heftable`, while `parts.bowl.heft` is
 * above nought.
 *
 * Not built yet: hands back the stroke it was given.
 */
export function withHeft(stroke: Stroke, _style: Style): Stroke {
  return stroke;
}
