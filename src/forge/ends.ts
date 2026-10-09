/**
 * Ends shaped after the pen has drawn them: an arm swelled toward its beak, a
 * curved end tapered, and the corners of a seen cut rounded.
 *
 * Each is asked for by a field of the terminal (`swell`, `taper`, `soft`)
 * that `dress` sets only where the style's own field is above nought, so a
 * letter of any existing face never reaches anything here.
 */

import type { GlyphNode } from "@/font/types";
import type { Headed, OffsetSegment, PenReach, SeamMark } from "./sweep";
import type { Stroke, Terminal } from "./types";

/** Whether an end asks for its sides to be moved: swelled or tapered. */
function shapes(terminal: Terminal): boolean {
  return terminal.swell !== undefined || terminal.taper !== undefined;
}

/**
 * The two side runs with each end that carries `swell` or `taper` shaped, or
 * nothing where neither end does -- which is the sweep's sign that the sides
 * are where the pen put them. Shaped runs are new runs: the runs given, and
 * their pieces, are left as they were, since the sweep compares the two (see
 * `sidesAt` in sweep.ts).
 *
 * Not built yet: the runs come back as they were given, but the answer is
 * already the one the sweep reads, so an end that asks is drawn on its sides.
 */
export function endsShaped(
  stroke: Stroke,
  _headed: Headed[],
  left: OffsetSegment[],
  right: OffsetSegment[],
  _reach: PenReach,
): { left: OffsetSegment[]; right: OffsetSegment[] } | null {
  if (!shapes(stroke.start) && !shapes(stroke.end)) return null;
  return { left, right };
}

/**
 * The joined outline of a stroke with the corners its ends ask for (`soft`)
 * rounded, found by `marks` -- where `joinedAtSeams` put each of the four
 * runs: the left side, the far end, the right side, the near end.
 *
 * Not built yet: hands back the outline it was given.
 */
export function softCorners(nodes: GlyphNode[], _marks: SeamMark[], _stroke: Stroke): GlyphNode[] {
  return nodes;
}
