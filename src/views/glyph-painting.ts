/**
 * Putting the letter on the canvas, and whatever the gesture is showing.
 *
 * Two things, kept apart: `paintGlyph` is what goes on the canvas and in what
 * order, and the hook under it is when that happens again. Only the second is
 * about React, and joining them made the first unaskable -- an ordering that
 * decides whether a highlight hides the node under it is worth being able to
 * check rather than only to describe.
 *
 * One effect, because a canvas is one surface: everything on it is redrawn
 * together or the half that was not redrawn is a frame out of date. It is
 * written as an effect rather than during a render because a canvas is not a
 * return value.
 *
 * The gesture is read through the refs it hands over rather than through
 * props. A drag moves sixty times a second and this has to draw where it is
 * now, not where it was when React last looked.
 */

import * as React from "react";

import { resolveComponents } from "@/font/composite";
import { isReshaped, resolveGlyphContours } from "@/font/transform";
import type { Glyph, Typeface } from "@/font/types";
import { editsWhatIsThere, writesStrokes } from "@/font/toolset";
import { prepareCanvas, readToken, type GlyphView } from "@/components/glyph-render";
import type { AppState } from "@/state/useStore";
import { drawWritten } from "./write-canvas";

import { catches, type Catching } from "./glyph-catch";
import { segmentUnder, type Drag, type Hover } from "./glyph-pointer";
import { quadForPerspective, quadPulled } from "./transform-box";
import type { Box as BoxOf } from "@/font/warp";
import type { Vec2 } from "@/font/types";
import type { Gestures } from "./glyph-gestures";
import {
  drawAnchors,
  drawContours,
  drawFreehandPreview,
  drawKnifePreview,
  drawCaughtCount,
  drawLasso,
  drawMarks,
  drawMarquee,
  drawTransformBox,
  drawMetrics,
  drawNodes,
  drawPathOutline,
  drawPenReach,
  drawSegmentUnder,
  drawShapePreview,
  withAlpha,
} from "./glyph-canvas";

/** Everything one painting of the letter depends on, and nothing about React. */
export interface Painting {
  typeface: Typeface;
  glyph: Glyph | null;
  state: AppState;
  view: GlyphView;
  size: { width: number; height: number };
  neighbours: {
    before: Array<{ glyph: Glyph; x: number }>;
    after: Array<{ glyph: Glyph; x: number }>;
  };
  /** What the pointer is over, for the node and anchor under it to light up. */
  hover: Hover;
  /** Where the pointer is, for the tools that draw to it. */
  at: Vec2 | null;
  /** The gesture in flight, read live from its ref by the caller. */
  drag: Drag | null;
  /** What a shape being dragged has hold of, for lighting those points up. */
  catching: Catching | null;
  /** The modifiers as of the last move, for a shape being dragged out. */
  modifiers: { square: boolean; fromCentre: boolean };
  /** The box round the selection, when there is one worth drawing. */
  box: BoxOf | null;
  /** Which of its handles the pointer is on, so it lights before it is held. */
  grip: string | null;
}

/**
 * One painting of the letter, start to finish, in the order it goes down.
 *
 * Apart from the hook below, because when to paint and what to paint are two
 * questions and only one of them is about React. Everything here is a function
 * of its arguments and a sequence of calls on the context it is handed, which
 * is what makes the order below something that can be checked rather than
 * merely described -- and the order is most of the argument: the neighbours
 * cannot sit on top of the letter, the highlight cannot hide a node, and the
 * segment about to be cut has to be lit before the nodes go over it.
 */
export function paintGlyph(context: CanvasRenderingContext2D, within: Painting): void {
  const {
    typeface,
    glyph,
    state,
    view,
    size,
    neighbours,
    hover,
    at,
    drag,
    catching,
    modifiers,
    box,
    grip,
  } = within;
  // The element, for the colour tokens: every colour on this canvas is a custom
  // property read off it rather than a value passed in.
  const canvas = context.canvas;

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

  /*
   * Asked rather than inferred, and it used to be inferred wrongly.
   *
   * The test was whether `resolveGlyphContours` handed back the very array it
   * had composed -- true of a letter drawn from its own outlines, and never
   * true of one built from parts, because composing them makes a new array each
   * time it is asked. So every composite in the font read as reshaped with no
   * parameter touched: an accent-coloured ghost of itself behind it, and the
   * letter above dropped to half opacity to let the ghost through. Which is
   * most of the accented alphabet, washed out and haunted, saying the family
   * settings were doing something to it when they were doing nothing at all.
   */
  const reshaped = isReshaped(glyph, typeface);
  if (reshaped) {
    drawContours(context, resolveGlyphContours(glyph, typeface), view, {
      fill: withAlpha(readToken("--accent", "#0c8ce9", canvas), 0.22),
    });
  }
  drawContours(context, glyph.contours, view, {
    fill: withAlpha(readToken("--glyph-fill", "#eeeeee", canvas), reshaped ? 0.5 : 0.92),
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
  /*
   * One clock for the whole frame, so the ants and the flashes agree.
   *
   * Read once rather than per call: two `performance.now()`s in one paint are
   * two moments, and a ring drawn against a later one than the dashes it sits
   * inside would drift by a frame at a time.
   */
  const now = performance.now();

  if (!writing) {
    drawNodes(context, glyph.contours, view, state.selectedNodes, hover, catching, now);
    if (state.marks) drawMarks(context, glyph.contours, view);
    drawAnchors(context, glyph.anchors, view, hover);
  }
  drawWritten(context, glyph, view, {
    handles: writing,
    selected: state.stop,
  });

  if (drag?.kind === "marquee") drawMarquee(context, drag, now);
  if (drag?.kind === "shape") drawShapePreview(context, drag, view, modifiers);
  if (drag?.kind === "knife") drawKnifePreview(context, drag);
  if (drag?.kind === "freehand") drawFreehandPreview(context, drag, view);
  if (drag?.kind === "lasso") drawLasso(context, drag, now);

  /*
   * And how many it has, at the corner being dragged.
   *
   * Drawn after the shape so the label is never behind its own fill, and only
   * while a shape is out: a count of a selection that is no longer being made
   * is a number sitting on a letter for no reason.
   */
  if (catching && catches(drag)) {
    const corner = drag.kind === "marquee" ? drag.to : drag.trail[drag.trail.length - 1];
    if (corner) drawCaughtCount(context, corner, catching.keys.size);
  }

  /*
   * The box round what is selected, over everything else.
   *
   * Last, so its handles are never hidden behind a stem: they are the things
   * being aimed at, and one drawn under the ink is one nobody can see to grab.
   *
   * While a corner is being pulled the box is drawn as the quad it is becoming
   * rather than as the rectangle it was, or a distort would drag the letter
   * and leave its own outline behind -- the one thing on screen saying what is
   * happening would be the one thing not doing it.
   */
  if (box) {
    drawTransformBox(context, box, view, {
      grip,
      quad:
        drag?.kind === "box" && drag.grip.kind === "corner"
          ? quadPoints(
              modifiers.square
                ? quadForPerspective(drag.box, drag.grip.at, drag.to)
                : quadPulled(drag.box, drag.grip.at, drag.to),
            )
          : null,
    });
  }
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
}

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

    paintGlyph(context, {
      typeface,
      glyph,
      state,
      view,
      size,
      neighbours,
      hover,
      at,
      // The three read live rather than depended on -- see above.
      drag: gesture.drag.current,
      catching: gesture.catching.current,
      modifiers: gesture.modifiers.current,
      box: gesture.box,
      grip: gesture.grip,
    });
    /*
     * `state.ground` is in the list below for the reason it is in the proof
     * view: every colour on this canvas comes from `readToken`, which reads a
     * custom property rather than taking a prop, so nothing else in the list
     * changes when the ground does and the canvas would keep its old colours.
     */
  }, [
    /*
     * The beat first, because it is the one that covers the rest.
     *
     * Everything below is a document change, and a drag that draws over the
     * letter without touching it -- a marquee, a lasso, a shape being pulled
     * out, the knife's line -- changes none of them. Those previews were drawn
     * by code a browser never reached: the component re-rendered on every move
     * and this effect, keyed only on the document, did not run again.
     */
    gesture.beat,
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

/** A quad as the four points the box painter walks, in order round it. */
const quadPoints = (quad: ReturnType<typeof quadPulled>): Vec2[] => [
  quad.bottomLeft,
  quad.bottomRight,
  quad.topRight,
  quad.topLeft,
];
