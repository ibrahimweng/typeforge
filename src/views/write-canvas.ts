/**
 * Drawing and taking hold of a written letter's strokes.
 *
 * A written letter carries two things: the line the pen travelled and the ink
 * it left. The ink is the letter's contours and the canvas already draws those.
 * This draws the other half -- the spine, and the pen itself at every place the
 * pen is set -- and answers which part of it is under the pointer.
 *
 * The pen is drawn as the ellipse it is, sitting on the spine, with a handle at
 * each end of its two axes. That is the whole of the interface and it is
 * deliberately the same gesture as a Bezier handle: pull the end out and the
 * pen gets wider, pull it sideways and the pen turns. Numbers in a panel cannot
 * teach somebody what holding a pen at forty degrees does to a letter, and an
 * ellipse they can turn with the pointer can.
 */

import { nibAt, reachAcross, widthAt } from "@/quill/sweep";
import { alongSpine, walkOf } from "@/quill/curve";
import { nodeFractions } from "@/quill/written";
import {
  readToken,
  toCanvasX,
  toCanvasY,
  type GlyphView,
} from "@/components/glyph-render";
import type { Glyph, Vec2 } from "@/font/types";
import type { QuillSpine, QuillStroke } from "@/quill/types";

/** Font units to canvas pixels, as a point. */
const toScreen = (view: GlyphView, point: Vec2): Vec2 => ({
  x: toCanvasX(view, point.x),
  y: toCanvasY(view, point.y),
});

/** How close a pointer has to be to a handle to take hold of it, in pixels. */
const GRAB = 9;

/** One end of one of the pen's two axes, at one stop of one stroke. */
export interface PenHandle {
  stroke: number;
  stop: number;
  /** `wide` is the axis the pen is held along; `thin` is the one across it. */
  axis: "wide" | "thin";
  /** Which end of that axis, so dragging either one works. */
  side: 1 | -1;
  /** Where it sits, in font units. */
  at: Vec2;
  /** The centre of the pen it belongs to, in font units. */
  centre: Vec2;
}

/** One point of one stroke's spine. */
export interface StrokePoint {
  stroke: number;
  node: number;
  at: Vec2;
}

/** Where a stroke's spine is at a fraction along, and its two axis directions. */
function penFrameAt(
  stroke: QuillStroke,
  fraction: number,
): { centre: Vec2; wide: Vec2; thin: Vec2; along: number; across: number } {
  const walk = walkOf(stroke.spine);
  const { point } = alongSpine(stroke.spine, walk, fraction);
  const nib = nibAt(stroke.nib, fraction);
  const half = widthAt(stroke.width, fraction) / 2;
  const radians = (nib.angle * Math.PI) / 180;
  return {
    centre: point,
    wide: { x: Math.cos(radians), y: Math.sin(radians) },
    thin: { x: -Math.sin(radians), y: Math.cos(radians) },
    along: half,
    across: half * (1 - Math.min(Math.max(nib.contrast, 0), 1)),
  };
}

/** Every pen handle of every stroke, in font units. */
export function penHandles(glyph: Glyph): PenHandle[] {
  const strokes = glyph.written?.strokes ?? [];
  const handles: PenHandle[] = [];
  strokes.forEach((stroke, index) => {
    if (stroke.spine.segments.length === 0) return;
    stroke.nib.forEach((stop, at) => {
      const frame = penFrameAt(stroke, stop.at);
      for (const side of [1, -1] as const) {
        handles.push({
          stroke: index,
          stop: at,
          axis: "wide",
          side,
          centre: frame.centre,
          at: {
            x: frame.centre.x + frame.wide.x * frame.along * side,
            y: frame.centre.y + frame.wide.y * frame.along * side,
          },
        });
        /*
         * The thin axis gets handles too, and needs them even when it is
         * nought long. A pen set to a blade has both its thin handles sitting
         * exactly on the spine, which is the one place somebody has to be able
         * to grab to get the thickness back -- a control that disappears at
         * one end of its own range is a control that cannot be undone.
         */
        handles.push({
          stroke: index,
          stop: at,
          axis: "thin",
          side,
          centre: frame.centre,
          at: {
            x: frame.centre.x + frame.thin.x * frame.across * side,
            y: frame.centre.y + frame.thin.y * frame.across * side,
          },
        });
      }
    });
  });
  return handles;
}

/** The pen handle under a canvas point, if there is one. */
export function hitTestPen(
  glyph: Glyph,
  view: GlyphView,
  canvasPoint: Vec2,
): PenHandle | null {
  let best: PenHandle | null = null;
  let closest = GRAB;
  for (const handle of penHandles(glyph)) {
    const screen = toScreen(view, handle.at);
    const gap = Math.hypot(screen.x - canvasPoint.x, screen.y - canvasPoint.y);
    /*
     * The wide axis wins a tie, because at a blade the four handles of a stop
     * sit at three places and two of them coincide on the spine. Preferring
     * the wide one there means a grab on the middle of a blade changes its
     * width, and the thickness is reached by grabbing along the blade itself.
     */
    if (gap < closest || (gap === closest && handle.axis === "wide")) {
      closest = gap;
      best = handle;
    }
  }
  return best;
}

/** The point of a stroke's spine under a canvas point, if there is one. */
export function hitTestStrokePoint(
  glyph: Glyph,
  view: GlyphView,
  canvasPoint: Vec2,
): StrokePoint | null {
  const strokes = glyph.written?.strokes ?? [];
  let best: StrokePoint | null = null;
  let closest = GRAB;
  strokes.forEach((stroke, index) => {
    nodeFractions(stroke.spine).forEach((fraction, node) => {
      const walk = walkOf(stroke.spine);
      const { point } = alongSpine(stroke.spine, walk, fraction);
      const screen = toScreen(view, point);
      const gap = Math.hypot(screen.x - canvasPoint.x, screen.y - canvasPoint.y);
      if (gap < closest) {
        closest = gap;
        best = { stroke: index, node, at: point };
      }
    });
  });
  return best;
}

/**
 * What a drag of one pen handle means, in the pen's own frame.
 *
 * Dragging along the axis changes that axis's length. Dragging across it turns
 * the pen. Both at once does both, which is what makes it feel like taking hold
 * of the pen rather than operating two controls -- and it is why this is one
 * function rather than a resize handle and a rotate handle.
 *
 * `width` comes back as the whole axis rather than the half, because that is
 * what the stroke's width profile holds and what the panel shows.
 */
export function penDrag(
  handle: PenHandle,
  to: Vec2,
  held: { width: number; contrast: number; angle: number },
  options: { shift?: boolean } = {},
): { width: number; contrast: number; angle: number } {
  const from = { x: to.x - handle.centre.x, y: to.y - handle.centre.y };
  const reach = Math.hypot(from.x, from.y);
  if (reach < 1e-6) return held;

  /*
   * The angle the pointer stands at, turned back into the pen's own angle.
   *
   * A handle on the wide axis reports the pen's angle directly. One on the thin
   * axis stands ninety degrees round from it, and one on the far side of either
   * stands a hundred and eighty round -- so the pen's angle is the pointer's
   * angle less whichever of those this handle is, and every one of the four
   * handles turns the pen the same way.
   */
  const pointed = (Math.atan2(from.y, from.x) * 180) / Math.PI;
  const offset = (handle.axis === "thin" ? 90 : 0) + (handle.side === -1 ? 180 : 0);
  let angle = pointed - offset;
  if (options.shift) angle = Math.round(angle / 15) * 15;

  if (handle.axis === "wide") {
    const width = Math.max(1, reach * 2);
    /*
     * Held at the same shape rather than the same thickness, which is the
     * choice worth stating. Widening a pen and keeping its thin axis in units
     * turns a broad nib into a round one on the way; keeping the ratio means
     * the pen the person set stays the pen they set and only gets bigger.
     */
    return { width, contrast: held.contrast, angle };
  }
  const half = Math.max(1, held.width) / 2;
  const contrast = Math.min(1, Math.max(0, 1 - reach / half));
  return { width: held.width, contrast, angle };
}

/**
 * The spine and the pen, drawn over the ink.
 *
 * The spine in the accent colour because it is the thing being edited, and the
 * pen ellipses lighter, because there is one at every stop and four handles on
 * each -- drawn at full strength they read as the letter rather than as the
 * controls on it.
 */
export function drawWritten(
  context: CanvasRenderingContext2D,
  glyph: Glyph,
  view: GlyphView,
  options: { handles: boolean; selected?: { stroke: number; stop: number } | null },
): void {
  const strokes = glyph.written?.strokes ?? [];
  if (strokes.length === 0) return;
  const accent = readToken("--accent", "#0c8ce9", context.canvas);
  const quiet = readToken("--muted-foreground", "#8a8f98", context.canvas);

  context.save();
  for (const stroke of strokes) {
    if (stroke.spine.segments.length === 0) continue;
    context.strokeStyle = accent;
    context.lineWidth = 1.5;
    context.beginPath();
    drawSpine(context, stroke.spine, view);
    context.stroke();
  }

  if (!options.handles) {
    context.restore();
    return;
  }

  // The pen at each stop: the ellipse, its two axes, and a dot on each end.
  strokes.forEach((stroke, index) => {
    if (stroke.spine.segments.length === 0) return;
    stroke.nib.forEach((stop, at) => {
      const frame = penFrameAt(stroke, stop.at);
      const centre = toScreen(view, frame.centre);
      const chosen =
        options.selected?.stroke === index && options.selected?.stop === at;
      const radians = (nibAt(stroke.nib, stop.at).angle * Math.PI) / 180;
      const scale = Math.hypot(
        toScreen(view, { x: frame.centre.x + 1, y: frame.centre.y }).x - centre.x,
        toScreen(view, { x: frame.centre.x + 1, y: frame.centre.y }).y - centre.y,
      );

      context.strokeStyle = chosen ? accent : quiet;
      context.lineWidth = chosen ? 1.75 : 1;
      context.beginPath();
      context.ellipse(
        centre.x,
        centre.y,
        Math.max(1, frame.along * scale),
        Math.max(0.5, frame.across * scale),
        -radians,
        0,
        Math.PI * 2,
      );
      context.stroke();

      context.fillStyle = chosen ? accent : quiet;
      for (const handle of penHandles(glyph)) {
        if (handle.stroke !== index || handle.stop !== at) continue;
        const screen = toScreen(view, handle.at);
        context.beginPath();
        context.arc(screen.x, screen.y, handle.axis === "wide" ? 3.5 : 2.5, 0, Math.PI * 2);
        context.fill();
      }
    });
  });
  context.restore();
}

/** The spine as a canvas path, in screen coordinates. */
function drawSpine(
  context: CanvasRenderingContext2D,
  spine: QuillSpine,
  view: GlyphView,
): void {
  spine.segments.forEach((segment, index) => {
    if (segment.kind === "arc") return;
    const from = toScreen(view, segment.from);
    if (index === 0) context.moveTo(from.x, from.y);
    if (segment.kind === "line") {
      const to = toScreen(view, segment.to);
      context.lineTo(to.x, to.y);
      return;
    }
    const c1 = toScreen(view, segment.c1);
    const c2 = toScreen(view, segment.c2);
    const to = toScreen(view, segment.to);
    context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
  });
}

/** Kept so the pen's reach can be shown while a stroke is being written. */
export { reachAcross };
