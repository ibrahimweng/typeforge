/**
 * Putting the letter on the canvas, and whatever the gesture is showing.
 *
 * One effect, because a canvas is one surface: everything on it is redrawn
 * together or the half that was not redrawn is a frame out of date. What it
 * draws is a function of what is being edited and what the hand is doing, and
 * it is written as an effect rather than during a render because a canvas is
 * not a return value.
 *
 * The gesture is read through the refs it hands over rather than through
 * props. A drag moves sixty times a second and this has to draw where it is
 * now, not where it was when React last looked.
 */

import * as React from "react";

import { resolveComponents } from "@/font/composite";
import { resolveGlyphContours } from "@/font/transform";
import type { Glyph, Typeface } from "@/font/types";
import { editsWhatIsThere, writesStrokes } from "@/font/toolset";
import { prepareCanvas, readToken, type GlyphView } from "@/components/glyph-render";
import type { AppState } from "@/state/useStore";
import { drawWritten } from "./write-canvas";

import { segmentUnder } from "./glyph-pointer";
import type { Gestures } from "./glyph-gestures";
import {
  drawAnchors,
  drawContours,
  drawFreehandPreview,
  drawKnifePreview,
  drawLasso,
  drawMarks,
  drawMarquee,
  drawMetrics,
  drawNodes,
  drawPathOutline,
  drawPenReach,
  drawSegmentUnder,
  drawShapePreview,
  withAlpha,
} from "./glyph-canvas";

export function useGlyphPainting(within: {
  canvas: React.RefObject<HTMLCanvasElement | null>;
  typeface: Typeface | null;
  glyph: Glyph | null;
  state: AppState;
  view: GlyphView;
  size: { width: number; height: number };
  neighbours: {
    before: Array<{ glyph: Glyph; x: number }>;
    after: Array<{ glyph: Glyph; x: number }>;
  };
  gesture: Gestures;
}): void {
  const { typeface, glyph, state, view, size, neighbours, gesture } = within;
  const canvasRef = within.canvas;
  const { hover, at } = gesture;

  /*
   * The three refs are left out of the list below on purpose.
   *
   * A ref's `.current` is not something to re-run on: the whole reason the
   * gesture hands over refs rather than state is that a drag moves sixty times
   * a second and this has to draw where it is now. What brings the paint back
   * round is the state beside them -- the revision, the hover, the pointer --
   * and by the time it does, the ref holds the current answer.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are read live -- see above.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !typeface) return;
    const context = prepareCanvas(canvas, size.width, size.height);
    if (!context) return;

    drawMetrics(context, typeface, glyph, view, size, state.guides);
    if (!glyph) return;

    /*
     * The neighbours first, and flat.
     *
     * Drawn before the letter under the cursor so they can never sit on top of
     * it, and in one muted tone with no nodes and no handles: they are there to
     * be measured against, not edited. Anything that made them look editable
     * would be a promise this view does not keep -- clicking one selects
     * nothing, because the thing being edited is the glyph in the middle.
     */
    const asideFill = withAlpha(readToken("--glyph-fill", "#eeeeee", canvas), 0.28);
    for (const one of [...neighbours.before, ...neighbours.after]) {
      const shifted: GlyphView = { ...view, originX: view.originX + one.x * view.scale };
      drawContours(context, resolveGlyphContours(one.glyph, typeface), shifted, {
        fill: asideFill,
      });
    }

    // Where parameters change the shape, show the result behind the outline
    // being edited so the effect of the family settings stays visible.
    // What the components contribute is drawn but not offered for editing:
    // those outlines belong to another glyph, and changing them there is what
    // makes building letters from parts worth doing.
    const composed = resolveComponents(glyph, typeface);
    const fromComponents = composed.slice(glyph.contours.length);
    if (fromComponents.length > 0) {
      drawContours(context, fromComponents, view, {
        fill: withAlpha(readToken("--inspect", "#9149f5", canvas), 0.4),
      });
    }

    const resolved = resolveGlyphContours(glyph, typeface);
    if (resolved !== composed) {
      drawContours(context, resolved, view, {
        fill: withAlpha(readToken("--accent", "#0c8ce9", canvas), 0.22),
      });
    }
    drawContours(context, glyph.contours, view, {
      fill: withAlpha(
        readToken("--glyph-fill", "#eeeeee", canvas),
        resolved !== composed ? 0.5 : 0.92,
      ),
    });
    /*
     * The segment the pen would open, lit before the nodes are drawn.
     *
     * Adding a point to an existing curve is a click in the middle of nowhere
     * unless the thing about to be cut is shown: there is no node there to aim
     * at, so without this a person has to click and look at what happened.
     */
    if (at && editsWhatIsThere(state.tool)) {
      const on = segmentUnder(glyph, view, at);
      if (on) drawSegmentUnder(context, glyph.contours[on.contour], on.index, view);
    }
    /*
     * The path the Paths list is pointing at, drawn over the letter.
     *
     * Under the nodes so it never hides one, and as the outline rather than a
     * box: which of two nested contours an `o` row means is the whole question,
     * and a box round either covers both.
     */
    if (state.highlightPath !== null) {
      drawPathOutline(context, glyph.contours[state.highlightPath], view);
    }
    /*
     * A written letter's nodes are the sweep's, not anybody's.
     *
     * The contours of a written letter are what the pen swept, so their points
     * were placed by the fitter and mean nothing to the person who wrote it.
     * Shown while a write tool is in hand they are two hundred dots over the
     * three handles that actually do something. So the letter shows one set or
     * the other: the pen's while writing, the outline's the rest of the time.
     */
    const writing = writesStrokes(state.tool);
    if (!writing) {
      drawNodes(context, glyph.contours, view, state.selectedNodes, hover);
      if (state.marks) drawMarks(context, glyph.contours, view);
      drawAnchors(context, glyph.anchors, view, hover);
    }
    drawWritten(context, glyph, view, {
      handles: writing,
      selected: state.stop,
    });

    const drag = gesture.drag.current;
    if (drag?.kind === "marquee") drawMarquee(context, drag);
    if (drag?.kind === "shape") drawShapePreview(context, drag, view, gesture.modifiers.current);
    if (drag?.kind === "knife") drawKnifePreview(context, drag);
    if (drag?.kind === "freehand") drawFreehandPreview(context, drag, view);
    if (drag?.kind === "lasso") drawLasso(context, drag);
    /*
     * The pen's line to wherever the pointer is, and the point that would close
     * the outline marked when it is worth closing.
     *
     * Every other tool drew a live preview and this one did not: the pen
     * committed a point per click with nothing at all between the last one and
     * the pointer, so the only way to see where a segment would land was to
     * place it and undo.
     */
    if (state.tool === "pen" && at && !drag) drawPenReach(context, glyph, view, at);
    /*
     * `state.ground` is in here for the reason it is in the proof view: every
     * colour on this canvas comes from `readToken`, which reads a custom
     * property rather than taking a prop, so nothing else in this list changes
     * when the ground does and the canvas would keep its old colours.
     */
  }, [
    typeface,
    glyph,
    view,
    size,
    state.selectedNodes,
    state.revision,
    hover,
    neighbours,
    state.guides,
    state.ground,
    state.marks,
    state.tool,
    at,
    state.highlightPath,
    /*
     * The lit stop, which picking one does not otherwise announce: pickStop
     * only sets it, and setting is not a document change, so the revision
     * below does not move. Grab a handle and drag and the edit redraws the
     * canvas anyway; click one and let go, and without this the ellipse never
     * lights.
     */
    state.stop,
  ]);
}
