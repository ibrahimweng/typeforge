/**
 * The glyph editor: direct manipulation of one letter's outline.
 *
 * The canvas shows the outline as the font will draw it, with the metric lines
 * a type designer works against and the bezier nodes on top. Nodes and handles
 * are dragged directly; the pen tool adds points.
 *
 * Editing works on the glyph's stored outline, not on the parametric result, so
 * family-wide parameters stay live on top of whatever is drawn here. The
 * parametric outline is shown behind as a guide when the two differ.
 */

import * as React from "react";

import { contoursBounds } from "@/font/geometry";
import { boxOf } from "@/font/shapes";
import { linesFor, snapPoint } from "@/font/snap";
import { resolveComponents } from "@/font/composite";
import { resolveAdvanceWidth, resolveGlyphContours } from "@/font/transform";
import type { Glyph, Typeface, Vec2 } from "@/font/types";
import { A_DRAG, draggedPoint } from "@/font/pen";
import {
  CLOSES_WITHIN,
  NOTHING_UNDER,
  cursorFor as cursorClass,
  toolStateFor,
  type Doing,
  type Under,
} from "@/font/tools";
import { editsWhatIsThere } from "@/font/toolset";
import {
  prepareCanvas,
  readToken,
  toCanvasX,
  toCanvasY,
  toFontX,
  toFontY,
  type GlyphView,
} from "@/components/glyph-render";
import { nodeKey, store, useAppState, type ToolState } from "@/state/useStore";
import { CoachMark } from "@/components/CoachMark";
import { GlyphFaults } from "@/components/GlyphFaults";
import { Versions } from "@/components/Versions";
import { GroundToggle } from "@/components/GroundToggle";
import { NumberField } from "@/components/NumberField";
import { NothingDrawnYet } from "@/components/NothingDrawnYet";
import { hasLetters } from "@/font/library";
import { ToolPalette } from "@/components/ToolPalette";
import { cn } from "@/ui/lib/utils";
import { writesStrokes } from "@/font/toolset";
import { drawWritten, hitTestPen, hitTestStrokePoint, penDrag } from "./write-canvas";

/** How close a click has to land, in screen pixels, to grab a node. */
import { addPoint, deleteSelectedNodes, mirrorHandle } from "./glyph-edits";
import {
  clamp,
  guideAt,
  hitTestAnchor,
  hitTestHandle,
  hitTestNode,
  hoverKey,
  inside,
  knifeWouldCut,
  onClosingPoint,
  onLastPoint,
  openOutline,
  parseNodeKey,
  segmentUnder,
  toScreen,
  type Drag,
  type Hover,
} from "./glyph-pointer";
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

/**
 * How near a line has to be, in screen pixels, before a drag lands on it.
 *
 * In pixels rather than in font units so it feels the same at every zoom:
 * six units is a strong pull at a hundred per cent and nothing at all at
 * eight hundred, which is exactly where somebody is placing a point by eye
 * and least wants to be argued with.
 */
const SNAP_REACH = 6;

export function GlyphEditorView(): React.JSX.Element {
  const state = useAppState();
  const typeface = state.typeface;
  const glyph = store.glyph(state.selectedGlyph);

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ width: 800, height: 600 });
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState<Vec2>({ x: 0, y: 0 });
  const dragRef = React.useRef<Drag | null>(null);
  /*
   * The modifiers as of the last pointer move, because a pointer-up event
   * carries none that can be trusted: letting go of shift a moment before the
   * button is a thing hands do and is not a change of mind about wanting a
   * square.
   */
  const modifiersRef = React.useRef<{ square: boolean; fromCentre: boolean }>({
    square: false,
    fromCentre: false,
  });
  const [hover, setHover] = React.useState<Hover>(null);
  /*
   * Where the pointer is, for the tools that draw from the last thing they did
   * to wherever it now is. Only the pen needs it and only while an outline is
   * open, so it is set on move and cleared on leave rather than kept live.
   */
  const [at, setAt] = React.useState<Vec2 | null>(null);
  /*
   * The same position in a ref, for the handlers that run without an event.
   *
   * `handlePointerUp` takes no pointer position and `at` is state, so reading
   * it there gives whatever the last render saw -- which is the staleness that
   * has now bitten this file three times. The ref is written wherever the state
   * is, and is the one of the pair that is safe to read inside a handler.
   */
  const atRef = React.useRef<Vec2 | null>(null);
  const noteAt = (where: Vec2 | null): void => {
    atRef.current = where;
    setAt(where);
  };
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);

  /*
   * Measured through a callback ref, for the reason the font grid is.
   *
   * This view returns an empty state before the canvas exists, and the observer
   * used to be set up in an effect with no dependencies -- so on a render with
   * no font the ref was null, the effect took its early exit, and it never ran
   * again. Here that is latent rather than visible: the view is mounted and
   * unmounted by the switch above it, so by the time anybody can reach it there
   * is always a font and the ref is always there.
   *
   * It is fixed anyway, and not for tidiness. The identical shape in the font
   * grid was not latent: it left that grid at eight columns on every window
   * size, for ever, with the letters spilling out of their cells on a narrow
   * one. A fault that is currently invisible because of how a sibling component
   * happens to be rendered is a fault waiting for that to change.
   */
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const measure = React.useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    observerRef.current?.disconnect();
    if (!element) return;
    const read = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    observerRef.current = observer;
  }, []);
  React.useEffect(() => () => observerRef.current?.disconnect(), []);

  // Reset the framing whenever a different glyph is opened.
  React.useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [state.selectedGlyph]);

  const view = React.useMemo<GlyphView>(() => {
    if (!typeface) return { scale: 1, originX: 0, originY: 0 };
    // Fit the full vertical range of the font, then apply the user's zoom.
    const span = typeface.metrics.ascender - typeface.metrics.descender;
    const base = (size.height * 0.72) / Math.max(1, span);
    const scale = base * zoom;
    return {
      scale,
      originX: size.width / 2 - (glyph ? (glyph.advanceWidth / 2) * scale : 0) + pan.x,
      originY: size.height / 2 + (span / 2 + typeface.metrics.descender) * scale + pan.y,
    };
  }, [typeface, size, zoom, pan, glyph]);

  /*
   * The letters standing either side, and where each of them sits.
   *
   * A sidebearing cannot be judged on a letter by itself. The gap on the left
   * of an `n` means nothing until there is something to its left; every editor
   * since the 1990s draws the neighbours for that reason, and this one did not,
   * which made the one thing the glyph view is for -- deciding whether a letter
   * is spaced right -- impossible without leaving it.
   *
   * Laid out with the real advances and the real kerning, because a neighbour
   * drawn at the wrong distance is worse than no neighbour: it answers the
   * question confidently and wrongly.
   */
  const neighbours = React.useMemo(() => {
    if (!typeface || !glyph) return { before: [], after: [] };
    const byCodepoint = new Map<number, Glyph>();
    for (const one of typeface.glyphs) {
      for (const codepoint of one.unicodes) {
        if (!byCodepoint.has(codepoint)) byCodepoint.set(codepoint, one);
      }
    }
    const found = (text: string): Glyph[] =>
      [...text]
        .map((character) => byCodepoint.get(character.codePointAt(0)!))
        .filter((one) => one !== undefined);

    /*
     * Walked outwards from the glyph in both directions, so the pen starts at
     * the edited letter rather than at the start of a line. The left side is
     * built backwards -- each letter placed by its own width plus whatever it
     * kerns against what follows it -- which is the only way to keep the letter
     * under the cursor where it already is.
     */
    const placed: Array<{ glyph: Glyph; x: number }> = [];
    let pen = 0;
    let next = glyph;
    for (const one of found(state.context.before).reverse()) {
      pen -= resolveAdvanceWidth(one, typeface) + store.resolvedKerning(one.name, next.name).value;
      placed.push({ glyph: one, x: pen });
      next = one;
    }
    const before = placed;

    const after: Array<{ glyph: Glyph; x: number }> = [];
    let forward = resolveAdvanceWidth(glyph, typeface);
    let previous = glyph;
    for (const one of found(state.context.after)) {
      forward += store.resolvedKerning(previous.name, one.name).value;
      after.push({ glyph: one, x: forward });
      forward += resolveAdvanceWidth(one, typeface);
      previous = one;
    }
    return { before, after };
  }, [typeface, glyph, state.context, state.revision]);

  // --- drawing ----------------------------------------------------------

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

    const drag = dragRef.current;
    if (drag?.kind === "marquee") drawMarquee(context, drag);
    if (drag?.kind === "shape") drawShapePreview(context, drag, view, modifiersRef.current);
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

  // --- interaction ------------------------------------------------------

  const pointerPosition = (event: React.PointerEvent): Vec2 => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!glyph || !typeface) return;
    const canvasPoint = pointerPosition(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    // Middle button or alt-drag pans the view.
    if (event.button === 1 || event.altKey) {
      dragRef.current = { kind: "pan", from: canvasPoint, startPan: pan };
      return;
    }

    /*
     * A guide under the pointer is grabbed before anything else is considered.
     *
     * It is a full-width line, so it crosses points and outlines all the way
     * across the canvas -- and a guide that could only be caught where the
     * letter is not would be uncatchable on a wide letter. Tested first and
     * within a few pixels, so it never steals a click meant for a node: the
     * band is thinner than the one a node answers to.
     */
    const onGuide = guideAt(state.guides, view, canvasPoint);
    if (onGuide !== null) {
      dragRef.current = { kind: "guide", index: onGuide };
      return;
    }

    /*
     * The four tools that work on something already drawn.
     *
     * Each was a modifier on the pen or nothing at all: adding a point was a
     * plain click that also had to mean "start a new outline here", which is
     * two jobs on one gesture and the reason the pen kept editing a letter
     * when it was asked to draw beside one. As their own tools each click
     * means one thing, and the pen's click is free to always start an outline.
     */
    if (state.tool === "addPoint") {
      const on = segmentUnder(glyph, view, canvasPoint);
      if (on) store.addPointOn(glyph.name, on.contour, on.index, on.t);
      else store.say("Nothing there to add a point to. Point at an edge.", "info");
      reportPhase(canvasPoint);
      return;
    }
    if (state.tool === "deletePoint") {
      const hit = hitTestNode(glyph, view, canvasPoint);
      if (hit) store.removePoints(glyph.name, [hit]);
      else store.say("Nothing there to take out. Point at a point.", "info");
      reportPhase(canvasPoint);
      return;
    }
    if (state.tool === "convertPoint") {
      const hit = hitTestNode(glyph, view, canvasPoint);
      if (!hit) {
        store.say("Nothing there to change. Point at a point.", "info");
        reportPhase(canvasPoint);
        return;
      }
      /*
       * Held rather than acted on, because this tool has two gestures: a click
       * switches the point between a curve and a corner, and a pull brings a
       * handle out of it. Which one it was is not known until the pointer
       * either moves or does not, so the click is settled on release.
       */
      dragRef.current = {
        kind: "pen",
        from: canvasPoint,
        contour: hit.contour,
        node: hit.node,
        keepIn: glyph.contours[hit.contour]?.nodes[hit.node]?.handleIn ?? null,
        pulled: false,
        before: store.snapshotGlyph(glyph.name) ?? glyph,
      };
      return;
    }
    if (state.tool === "scissors") {
      const hit = hitTestNode(glyph, view, canvasPoint);
      const on = hit ? null : segmentUnder(glyph, view, canvasPoint);
      if (hit) store.openContourAt(glyph.name, hit.contour, hit.node);
      else if (on) {
        // On an edge rather than a point: put a point in first, then open at
        // it, so a cut can land anywhere rather than only where a point is.
        store.addPointOn(glyph.name, on.contour, on.index, on.t);
        store.openContourAt(glyph.name, on.contour, on.index + 1);
      } else store.say("Nothing there to open. Point at a point or an edge.", "info");
      reportPhase(canvasPoint);
      return;
    }
    if (state.tool === "selectPath") {
      const hit = hitTestNode(glyph, view, canvasPoint) ?? segmentUnder(glyph, view, canvasPoint);
      if (hit) store.selectAllNodes(glyph.name, hit.contour);
      else store.setSelectedNodes([]);
      reportPhase(canvasPoint);
      return;
    }
    if (state.tool === "lasso") {
      dragRef.current = {
        kind: "lasso",
        trail: [canvasPoint],
        additive: event.shiftKey,
      };
      return;
    }

    if (state.tool === "pen") {
      /*
       * Clicking the point it started from closes the outline, which is the
       * pen's second action and did not exist. Without it every outline drawn
       * here stayed open, and an open contour does not fill -- somebody could
       * draw a perfectly good `o` and watch it stay a wire.
       */
      if (onClosingPoint(glyph, view, canvasPoint)) {
        store.closeOutline(glyph.name);
        reportPhase(canvasPoint);
        return;
      }

      /*
       * Clicking the point just placed takes its outgoing handle off, so the
       * next segment runs straight out of a curve. Without it a curve can only
       * ever be followed by another curve.
       */
      const open = openOutline(glyph);
      if (open && open.nodes.length > 0 && onLastPoint(glyph, view, canvasPoint)) {
        store.retractLast(glyph.name);
        reportPhase(canvasPoint);
        return;
      }

      /*
       * On a segment, the pen puts a point there instead of starting a new
       * outline somewhere. Split with de Casteljau, so the curve either side
       * comes out where it already was -- anything that re-guesses the handles
       * moves the letter while claiming to add to it.
       *
       * Only when nothing is being drawn: mid-outline the pen is placing
       * points, and a click that landed on an existing edge would silently
       * stop drawing and edit something else.
       */
      if (!open) {
        const on = segmentUnder(glyph, view, canvasPoint);
        if (on) {
          store.addPointOn(glyph.name, on.contour, on.index, on.t);
          reportPhase(canvasPoint);
          return;
        }
      }

      /*
       * A point, and then a hold: whether this was a click or a pull is not
       * known until the pointer either moves or does not. Every editor decides
       * it this way, and it is why the point appears under the press rather
       * than on release.
       */
      addPoint(glyph, view, canvasPoint);
      const after = store.glyph(glyph.name);
      const contourIndex = after ? after.contours.length - 1 : 0;
      const nodeIndex = after ? (after.contours[contourIndex]?.nodes.length ?? 1) - 1 : 0;
      dragRef.current = {
        kind: "pen",
        from: canvasPoint,
        contour: contourIndex,
        node: nodeIndex,
        /*
         * Nothing to keep, because a point placed by the pen arrives with no
         * handles at all. `keepIn` is what alt puts back on the arriving side
         * when it breaks the pair, and on a fresh point there is nothing on
         * that side yet -- so alt on the first pull makes a corner rather than
         * restoring a handle, which is what it should do.
         */
        keepIn: null,
        pulled: false,
        // Captured after the point goes down, so undoing the pull leaves the
        // point where it was placed rather than taking both back at once.
        before: store.snapshotGlyph(glyph.name) ?? glyph,
      };
      reportPhase(canvasPoint);
      return;
    }

    /*
     * A drawing tool takes the whole canvas. There is nothing under the
     * pointer to grab while a rectangle is being dragged out, and a knife that
     * picked up a node the moment it started on one would be a knife that
     * could not cut through a corner.
     */
    if (state.tool === "rectangle" || state.tool === "ellipse" || state.tool === "polygon") {
      dragRef.current = { kind: "shape", kind2: state.tool, from: canvasPoint, to: canvasPoint };
      return;
    }
    if (state.tool === "knife") {
      dragRef.current = { kind: "knife", from: canvasPoint, to: canvasPoint };
      return;
    }
    if (state.tool === "freehand") {
      dragRef.current = {
        kind: "freehand",
        trail: [{ x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) }],
      };
      return;
    }

    /*
     * Writing, which draws the line the pen travels rather than the edge of the
     * letter.
     *
     * Deliberately the pen's own gesture -- click for a corner, hold and pull
     * for a curve, click the first point to close -- because the thing that is
     * new here is what the line means and not how it is drawn, and making the
     * drawing unfamiliar too would put two new ideas in front of somebody at
     * once.
     */
    if (state.tool === "skeleton") {
      const at = { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) };
      const strokes = store.strokesOf(glyph.name);
      const open = strokes[strokes.length - 1];
      const writing = store.writing;
      /*
       * Back on the first point closes the stroke, which is how an `o` is
       * written: one movement all the way round with no ends to cap.
       */
      if (writing && open && open.spine.segments.length >= 2) {
        const first = open.spine.segments[0];
        const start = first.kind === "arc" ? null : first.from;
        if (start) {
          const screen = {
            x: toCanvasX(view, start.x),
            y: toCanvasY(view, start.y),
          };
          if (Math.hypot(screen.x - canvasPoint.x, screen.y - canvasPoint.y) <= 10) {
            store.closeStroke(glyph.name);
            reportPhase(canvasPoint);
            return;
          }
        }
      }
      store.writePoint(glyph.name, at);
      const after = store.glyph(glyph.name);
      const written = after?.written?.strokes ?? [];
      const which = Math.max(0, written.length - 1);
      dragRef.current = {
        kind: "writePull",
        from: canvasPoint,
        stroke: which,
        node: Math.max(0, written[which]?.spine.segments.length ?? 0),
        before: store.snapshotGlyph(glyph.name) ?? glyph,
      };
      reportPhase(canvasPoint);
      return;
    }

    if (state.tool === "skeletonFreehand") {
      dragRef.current = {
        kind: "writeTrail",
        trail: [{ x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) }],
      };
      return;
    }

    /*
     * The pen tool: take hold of the ellipse, not of the letter.
     *
     * A handle first, because that is the finer target and the one somebody
     * aiming at it means; the spine point second, so the stroke can be moved
     * without changing tools.
     */
    if (state.tool === "nib") {
      const handle = hitTestPen(glyph, view, canvasPoint);
      if (handle) {
        store.pickStop(handle.stroke, handle.stop);
        dragRef.current = {
          kind: "penHandle",
          handle,
          before: store.snapshotGlyph(glyph.name) ?? glyph,
        };
        return;
      }
      const point = hitTestStrokePoint(glyph, view, canvasPoint);
      if (point) {
        dragRef.current = {
          kind: "strokePoint",
          stroke: point.stroke,
          node: point.node,
          before: store.snapshotGlyph(glyph.name) ?? glyph,
        };
        return;
      }
      return;
    }

    const anchorHit = hitTestAnchor(glyph, view, canvasPoint);
    if (anchorHit) {
      dragRef.current = {
        kind: "anchor",
        name: anchorHit,
        before: glyph.anchors.map((anchor) => ({ ...anchor })),
      };
      return;
    }

    const handleHit = hitTestHandle(glyph, view, canvasPoint);
    if (handleHit) {
      const before = store.snapshotGlyph(glyph.name);
      if (before) {
        dragRef.current = {
          kind: "handle",
          ref: handleHit.ref,
          side: handleHit.side,
          lines: linesFor(typeface, glyph, state.guides, new Set([nodeKey(handleHit.ref)])),
          before,
        };
      }
      return;
    }

    const nodeHit = hitTestNode(glyph, view, canvasPoint);
    if (nodeHit) {
      const key = nodeKey(nodeHit);
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      let selection: Set<string>;
      if (additive) {
        selection = new Set(state.selectedNodes);
        if (selection.has(key)) selection.delete(key);
        else selection.add(key);
      } else {
        selection = state.selectedNodes.has(key) ? new Set(state.selectedNodes) : new Set([key]);
      }
      store.setSelectedNodes(selection);

      const before = store.snapshotGlyph(glyph.name);
      if (before) {
        dragRef.current = {
          kind: "node",
          refs: [...selection].map(parseNodeKey),
          anchor: nodeHit,
          // Everything in the letter worth landing on, minus the points that
          // are about to move: a point that snapped to itself would never move
          // at all.
          lines: linesFor(typeface, glyph, state.guides, selection),
          start: { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) },
          before,
        };
      }
      return;
    }

    dragRef.current = {
      kind: "marquee",
      from: canvasPoint,
      to: canvasPoint,
      additive: event.shiftKey,
    };
  };

  /**
   * Resolve what is under the pointer, in the priority a click uses.
   *
   * Only committed when the target actually changes. A pointer move fires
   * dozens of times a second and every state change here repaints the whole
   * canvas, so comparing first is what keeps hovering free.
   */
  /*
   * What the tool in hand is doing, said once and read by three things.
   *
   * The palette, the cursor and the status line all have to agree, and three
   * readings of the same gesture is three chances to disagree -- a cursor
   * saying "this will cut" over a line that will not is worse than a cursor
   * saying nothing. `toolStateFor` decides; this only gathers what it needs.
   */
  const reportPhase = (canvasPoint: Vec2 | null, found: Hover = hover): void => {
    const drag = dragRef.current;
    const held = { shift: modifiersRef.current.square, alt: modifiersRef.current.fromCentre };
    const doing: Doing | null = drag
      ? {
          /*
           * Named rather than cast.
           *
           * This was `drag.kind as Doing["kind"]`, and the cast is what let the
           * pen's own drag kind through without a case to answer it: the
           * compiler had been told to stop checking exactly where checking was
           * the point. `Drag` and `Doing` share their names on purpose, so the
           * assignment needs no cast at all once the two lists agree.
           */
          kind: drag.kind,
          wouldCut: drag.kind === "knife" ? knifeWouldCut(glyph, view, drag) : undefined,
          pulling: drag.kind === "pen" ? drag.pulled : undefined,
          wouldClose:
            drag.kind === "freehand"
              ? drag.trail.length > 8 &&
                Math.hypot(
                  drag.trail[drag.trail.length - 1].x - drag.trail[0].x,
                  drag.trail[drag.trail.length - 1].y - drag.trail[0].y,
                ) <= CLOSES_WITHIN
              : undefined,
        }
      : null;

    store.setToolState(toolStateFor(state.tool, whatIsUnder(canvasPoint, found), doing, held));
  };

  /**
   * Everything the tools ask about the place under the pointer.
   *
   * One function because the sentence, the cursor and the highlight all have to
   * agree about what is there, and three readings of the same pixel is three
   * chances to disagree. It costs a hit test or two per pointer move, which is
   * nothing beside the repaint that follows.
   */
  const whatIsUnder = (canvasPoint: Vec2 | null, found: Hover = hover): Under => {
    /*
     * With no pointer on the canvas there is nothing under it -- except the two
     * facts that are about the letter rather than about the place. Whether this
     * letter was written at all is one of them, and leaving it out of this case
     * made the pen tool say "nothing written here yet" about a letter with two
     * strokes in it, for as long as the pointer was off the canvas.
     */
    if (!glyph || !canvasPoint)
      return {
        ...NOTHING_UNDER,
        grabbable: found !== null,
        written: (glyph?.written?.strokes.length ?? 0) > 0,
        strokeOpen: store.writing !== null && store.writing.name === glyph?.name,
      };
    const open = openOutline(glyph);
    /*
     * The node and edge tests run for every tool rather than only the select
     * tool's hover, because five of the thirteen work on a point or an edge and
     * each has to know whether there is one before the click, not after.
     */
    const node = hitTestNode(glyph, view, canvasPoint);
    const writing = store.writing;
    return {
      grabbable: found !== null,
      closingPoint: onClosingPoint(glyph, view, canvasPoint),
      pathOpen: Boolean(open),
      openPoints: open?.nodes.length ?? 0,
      node: node !== null,
      /*
       * The three the write tools ask about. Asked here with everything else
       * rather than in the tools, so the sentence, the cursor and the handles
       * cannot disagree about whether there is a pen to take hold of.
       */
      penHandle: hitTestPen(glyph, view, canvasPoint) !== null,
      written: (glyph.written?.strokes.length ?? 0) > 0,
      strokeOpen: writing !== null && writing.name === glyph.name,
      /*
       * Asked without regard to whether a point is here too.
       *
       * It used to be `no node and an edge`, which reads sensibly and is wrong
       * for the tool it matters most to: on a curve every point sits on an edge,
       * so Add point went blank at exactly the places a person aims -- while its
       * click, which asks the edge directly, went ahead and added one. The words
       * and the deed disagreed. Which of the two wins where both are present is
       * each tool's business, and each one says so.
       */
      edge: segmentUnder(glyph, view, canvasPoint) !== null,
      shape: glyph.contours.some((one) => one.closed && one.nodes.length >= 3),
      lastPoint: onLastPoint(glyph, view, canvasPoint),
    };
  };

  /*
   * The latest `reportPhase`, for the handlers that outlive the render.
   *
   * The keyboard effect is bound once per glyph and re-uses whatever closure it
   * captured, so calling `reportPhase` from inside it reported the phase of the
   * tool that was in hand when the effect last ran -- pressing Escape with the
   * pen put the *select* tool's sentence under the canvas. This is the third
   * staleness bug in this file and they all have the same shape: state read
   * inside a handler that was built on an earlier render. A ref is the version
   * of the pair that is always current.
   */
  const reportPhaseRef = React.useRef(reportPhase);
  reportPhaseRef.current = reportPhase;

  const updateHover = (canvasPoint: Vec2): Hover => {
    noteAt(canvasPoint);
    if (!glyph || state.tool !== "select") {
      setHover((current) => (current === null ? current : null));
      return null;
    }

    const anchorHit = hitTestAnchor(glyph, view, canvasPoint);
    const handleHit = anchorHit ? null : hitTestHandle(glyph, view, canvasPoint);
    const nodeHit = anchorHit || handleHit ? null : hitTestNode(glyph, view, canvasPoint);

    const next: Hover = anchorHit
      ? { kind: "anchor", name: anchorHit }
      : handleHit
        ? { kind: "handle", ref: handleHit.ref, side: handleHit.side }
        : nodeHit
          ? { kind: "node", ref: nodeHit }
          : null;

    setHover((current) => (hoverKey(current) === hoverKey(next) ? current : next));
    /*
     * Handed back rather than left to be read off state.
     *
     * `setHover` does not change `hover` until the next render, so a phase read
     * from it was always one move behind -- the select tool never reported
     * anything grabbable, because by the time `hover` held a node the pointer
     * had already been asked about somewhere else.
     */
    return next;
  };

  /*
   * A tool says what it is for the moment it is picked up.
   *
   * `setTool` clears the phase, and nothing reported a new one until the
   * pointer next moved -- so choosing the knife left the status line still
   * offering to type a point's position, and the palette showing a tool doing
   * nothing. Somebody who picks a tool and reads the line before moving is
   * exactly the person the line is for.
   */
  /*
   * Picking up another tool finishes whatever the pen was drawing.
   *
   * Reaching for the knife mid-outline is a person saying they are done with
   * that outline, and leaving it open meant the next pen click carried on a
   * shape they had walked away from -- or, more often, left a two-point stub
   * that drew as nothing and stayed in the list.
   */
  const wasTool = React.useRef(state.tool);
  React.useEffect(() => {
    if (wasTool.current !== state.tool && glyph) store.finishOutline(glyph.name);
    wasTool.current = state.tool;
  }, [state.tool, glyph]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: narrowed to the letter's name on purpose -- see the note above the closing brace.
  React.useEffect(() => {
    store.setToolState(
      toolStateFor(
        state.tool,
        {
          ...NOTHING_UNDER,
          pathOpen: Boolean(glyph && openOutline(glyph)),
          openPoints: glyph ? (openOutline(glyph)?.nodes.length ?? 0) : 0,
          shape: Boolean(glyph?.contours.some((one) => one.closed && one.nodes.length >= 3)),
          /*
           * The two that are about the letter rather than about the pointer,
           * which is the whole rule for what belongs in this list.
           *
           * Left out, picking up the pen tool on a letter with two strokes in
           * it said "nothing written here yet, write a stroke first" -- which
           * is the sentence for an empty letter, over a letter that is not.
           * `penHandle` is a pointer fact and stays false: nothing is under a
           * pointer that has not moved yet.
           */
          written: (glyph?.written?.strokes.length ?? 0) > 0,
          strokeOpen: store.writing !== null && store.writing.name === glyph?.name,
        },
        null,
        { shift: false, alt: false },
      ),
    );
    // Only on a change of tool or of letter: within one tool the pointer
    // handlers below own the phase, and running this on every glyph edit would
    // stamp on a gesture in progress.
  }, [state.tool, glyph?.name]);

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (!drag) {
      const where = pointerPosition(event);
      reportPhase(where, updateHover(where));
      // The pen draws from its last point to wherever the pointer is, so an
      // open outline has to repaint as the pointer moves rather than only when
      // something is pressed.
      if (state.tool === "pen" && glyph && openOutline(glyph)) forceRender();
      return;
    }
    const canvasPoint = pointerPosition(event);
    modifiersRef.current = { square: event.shiftKey, fromCentre: event.altKey };

    /*
     * A guide moves without a glyph, and before the glyph guard below.
     *
     * Guides belong to the font rather than to a letter, so dragging one has to
     * work on a glyph with no outlines at all -- which is where somebody
     * setting up their lines before drawing anything would be standing.
     */
    if (drag.kind === "guide") {
      const guide = state.guides[drag.index];
      store.moveGuide(
        drag.index,
        guide?.axis === "x"
          ? (canvasPoint.x - view.originX) / view.scale
          : (view.originY - canvasPoint.y) / view.scale,
      );
      return;
    }

    if (!glyph) return;

    switch (drag.kind) {
      case "pan": {
        setPan({
          x: drag.startPan.x + (canvasPoint.x - drag.from.x),
          y: drag.startPan.y + (canvasPoint.y - drag.from.y),
        });
        break;
      }
      case "node": {
        const current = { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) };
        let dx = current.x - drag.start.x;
        let dy = current.y - drag.start.y;
        // Shift constrains the drag to one axis, as it does in every drawing tool.
        const held = event.shiftKey;
        if (held) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }

        /*
         * The snap is worked out on the node that is actually under the
         * pointer and then applied to everything moving with it. Snapping each
         * picked point on its own would pull them onto different lines and
         * distort the shape somebody is dragging.
         *
         * After the shift constraint rather than before, so a drag held to one
         * axis is not given movement back on the other.
         */
        if (state.snapping) {
          const anchor = drag.before.contours[drag.anchor.contour]?.nodes[drag.anchor.node];
          if (anchor) {
            const reach = SNAP_REACH / view.scale;
            const wanted = { x: anchor.point.x + dx, y: anchor.point.y + dy };
            const landed = snapPoint(wanted, drag.lines, reach);
            if (!held || dx !== 0) dx = landed.point.x - anchor.point.x;
            if (!held || dy !== 0) dy = landed.point.y - anchor.point.y;
          }
        }
        store.editGlyphLive(glyph.name, (target) => {
          for (const ref of drag.refs) {
            const original = drag.before.contours[ref.contour]?.nodes[ref.node];
            const node = target.contours[ref.contour]?.nodes[ref.node];
            if (!original || !node) continue;
            node.point = { x: original.point.x + dx, y: original.point.y + dy };
            node.handleIn = original.handleIn
              ? { x: original.handleIn.x + dx, y: original.handleIn.y + dy }
              : null;
            node.handleOut = original.handleOut
              ? { x: original.handleOut.x + dx, y: original.handleOut.y + dy }
              : null;
          }
        });
        break;
      }
      case "handle": {
        const loose = { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) };
        const target = state.snapping
          ? snapPoint(loose, drag.lines, SNAP_REACH / view.scale).point
          : loose;
        store.editGlyphLive(glyph.name, (editing) => {
          const node = editing.contours[drag.ref.contour]?.nodes[drag.ref.node];
          if (!node) return;
          if (drag.side === "out") node.handleOut = target;
          else node.handleIn = target;
          // A smooth node keeps its handles in line, so moving one swings the other.
          if (node.type === "smooth") mirrorHandle(node, drag.side);
        });
        break;
      }
      case "anchor": {
        store.setAnchorLive(
          glyph.name,
          drag.name,
          toFontX(view, canvasPoint.x),
          toFontY(view, canvasPoint.y),
        );
        break;
      }
      case "marquee":
      case "shape":
      case "knife": {
        drag.to = canvasPoint;
        forceRender();
        break;
      }
      case "freehand": {
        drag.trail.push({ x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) });
        forceRender();
        break;
      }
      case "writeTrail": {
        drag.trail.push({ x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) });
        forceRender();
        break;
      }
      /*
       * The pen, taken hold of by one of its axis ends.
       *
       * Written live and recorded once on release, as every other drag here
       * is: the whole point of dragging an ellipse rather than typing a number
       * is watching the letter change while you do it.
       */
      case "penHandle": {
        const to = { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) };
        const stroke = store.strokesOf(glyph.name)[drag.handle.stroke];
        const stop = stroke?.nib[drag.handle.stop];
        if (!stroke || !stop) break;
        const held = {
          width: stroke.width[0]?.width ?? 0,
          contrast: stop.contrast,
          angle: stop.angle,
        };
        const next = penDrag(drag.handle, to, held, { shift: event.shiftKey });
        store.setStrokePen(glyph.name, drag.handle.stroke, drag.handle.stop, next, true);
        forceRender();
        break;
      }
      case "strokePoint": {
        const to = { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) };
        store.moveStrokePoint(glyph.name, drag.stroke, drag.node, to, true);
        forceRender();
        break;
      }
      /*
       * Writing's own pull, which shapes the segment just laid down.
       *
       * The spine is a list of cubics, so the handle being pulled is the one
       * *leaving* the point just placed -- which is `c1` of the segment that
       * will follow it, and `c2` of the one that arrived, mirrored, so the
       * stroke runs through smoothly. A pull that moved only one of them would
       * put a corner where the person asked for a curve.
       */
      case "writePull": {
        const moved = Math.hypot(canvasPoint.x - drag.from.x, canvasPoint.y - drag.from.y);
        if (moved < A_DRAG) break;
        const to = { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) };
        store.pullStroke(glyph.name, drag.stroke, drag.node, to);
        forceRender();
        break;
      }
      /*
       * The pen's handles, pulled out of the point just placed.
       *
       * Written live and recorded once on release, the way every other drag in
       * this file works. The curve has to be visible as it is being shaped -- a
       * handle you cannot see until you let go is a handle you are guessing at
       * -- but `editGlyph` records history, and calling it per pointer move
       * puts thirty entries on the undo stack for one pull. `editGlyphLive`
       * exists for exactly this, and `commitGlyphEdit` closes it on release so
       * the whole gesture is one thing to take back.
       */
      case "lasso":
        drag.trail.push(canvasPoint);
        forceRender();
        break;

      case "pen": {
        const moved = Math.hypot(canvasPoint.x - drag.from.x, canvasPoint.y - drag.from.y);
        if (!drag.pulled && moved < A_DRAG) break;
        drag.pulled = true;
        const at = { x: toFontX(view, drag.from.x), y: toFontY(view, drag.from.y) };
        const to = { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) };
        const made = draggedPoint(at, to, {
          alt: event.altKey,
          shift: event.shiftKey,
          keepIn: drag.keepIn,
        });
        store.editGlyphLive(glyph.name, (one) => {
          const node = one.contours[drag.contour]?.nodes[drag.node];
          if (!node) return;
          node.handleIn = made.handleIn;
          node.handleOut = made.handleOut;
          node.type = made.type;
        });
        forceRender();
        break;
      }
    }

    /*
     * After the gesture has taken the move in, not before.
     *
     * Reported first, the phase was always one move behind what the drag
     * actually held -- which for most tools is invisible and for the pencil is
     * the whole thing: the trail's last point is what decides whether letting
     * go closes the loop, and asking before it was pushed meant the answer
     * never arrived for the move that mattered.
     */
    reportPhase(canvasPoint);
  };

  /*
   * A double click on a guide takes it away.
   *
   * The other candidates were a button per guide, which needs somewhere on the
   * canvas to put it, and dragging one off the edge, which is a gesture with no
   * edge on an infinite canvas. Double-clicking the thing you want rid of needs
   * neither, and `Clear` in the toolbar covers the case where there are five
   * and you want none.
   */
  const handleDoubleClick = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvasPoint = pointerPosition(event);
    const index = guideAt(state.guides, view, canvasPoint);
    if (index !== null) {
      store.removeGuide(index);
      return;
    }
    /*
     * Double-click a shape to pick the whole of it.
     *
     * The way every drawing program says "this one, not the one behind it", and
     * the only reliable way to pick a counter without the outline round it: a
     * marquee big enough to catch the inner circle of an `o` catches the outer
     * one too, and there is no rubber band you can draw that does not.
     */
    if (!glyph || state.tool !== "select") return;
    const found = hitTestNode(glyph, view, canvasPoint) ?? segmentUnder(glyph, view, canvasPoint);
    if (found) store.selectAllNodes(glyph.name, found.contour);
  };

  const handlePointerUp = (): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !glyph) return;

    if (drag.kind === "anchor") {
      const moved = glyph.anchors.find((anchor) => anchor.name === drag.name);
      if (moved) {
        const settled = { ...moved };
        glyph.anchors = drag.before.map((anchor) => ({ ...anchor }));
        store.setAnchor(glyph.name, drag.name, settled.x, settled.y);
      }
    } else if (drag.kind === "node") {
      store.commitGlyphEdit(glyph.name, "Move points", drag.before);
    } else if (drag.kind === "handle") {
      store.commitGlyphEdit(glyph.name, "Shape curve", drag.before);
    } else if (drag.kind === "pen") {
      // Only if it was actually a pull: a plain click placed its point through
      // `addPoint`, which recorded itself, and a second entry for a gesture
      // that changed nothing more is an undo press that appears to do nothing.
      if (drag.pulled) store.commitGlyphEdit(glyph.name, "Draw a curve", drag.before);
    } else if (drag.kind === "writePull") {
      // Only if it was a pull. A plain click already recorded its own point,
      // and a second entry for a gesture that added nothing is an undo press
      // that appears to do nothing.
      if (drag.node > 0) store.commitGlyphEdit(glyph.name, "Write a curve", drag.before);
    } else if (drag.kind === "penHandle") {
      store.commitGlyphEdit(glyph.name, "Change the pen", drag.before);
    } else if (drag.kind === "strokePoint") {
      store.commitGlyphEdit(glyph.name, "Move the stroke", drag.before);
    } else if (drag.kind === "writeTrail") {
      store.writeTrail(glyph.name, drag.trail);
    } else if (drag.kind === "marquee") {
      const selection = new Set(drag.additive ? state.selectedNodes : []);
      const left = Math.min(drag.from.x, drag.to.x);
      const right = Math.max(drag.from.x, drag.to.x);
      const top = Math.min(drag.from.y, drag.to.y);
      const bottom = Math.max(drag.from.y, drag.to.y);
      glyph.contours.forEach((contour, contourIndex) => {
        contour.nodes.forEach((node, nodeIndex) => {
          const x = view.originX + node.point.x * view.scale;
          const y = view.originY - node.point.y * view.scale;
          if (x >= left && x <= right && y >= top && y <= bottom) {
            selection.add(nodeKey({ contour: contourIndex, node: nodeIndex }));
          }
        });
      });
      store.setSelectedNodes(selection);
      forceRender();
    } else if (drag.kind === "shape") {
      /*
       * Shift squares it off and alt draws from the middle, as in every
       * drawing tool. Read off the last move rather than off the pointer-up,
       * because letting go of the modifier a moment before the button is a
       * thing hands do and is not a change of mind.
       */
      store.addShape(
        glyph.name,
        drag.kind2,
        boxOf(
          { x: toFontX(view, drag.from.x), y: toFontY(view, drag.from.y) },
          { x: toFontX(view, drag.to.x), y: toFontY(view, drag.to.y) },
          modifiersRef.current,
        ),
      );
      forceRender();
    } else if (drag.kind === "freehand") {
      if (!store.addStroke(glyph.name, drag.trail)) {
        store.say("That was a click rather than a stroke. Drag to draw.", "error");
      }
      forceRender();
    } else if (drag.kind === "knife") {
      store.cutGlyph(
        glyph.name,
        { x: toFontX(view, drag.from.x), y: toFontY(view, drag.from.y) },
        { x: toFontX(view, drag.to.x), y: toFontY(view, drag.to.y) },
      );
      forceRender();
    } else if (drag.kind === "lasso") {
      const picked = new Set(drag.additive ? state.selectedNodes : []);
      glyph.contours.forEach((contour, contourIndex) => {
        contour.nodes.forEach((node, nodeIndex) => {
          if (inside(drag.trail, toScreen(view, node.point))) {
            picked.add(nodeKey({ contour: contourIndex, node: nodeIndex }));
          }
        });
      });
      store.setSelectedNodes(picked);
      forceRender();
    }

    /*
     * The sentence, refreshed now the gesture is over.
     *
     * It never was, so the line kept whatever the drag had been saying until
     * the pointer next moved: let go of a pen pull and it went on reading
     * `Let go for a corner, or pull to curve out of it` over a point that had
     * already been placed. The one moment a person is most likely to look at
     * the line is the moment they finish something.
     */
    reportPhase(atRef.current);
  };

  // Keyboard: nudge the selection, delete points, undo and redo.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!glyph) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      /*
       * Carrying a drawing from one letter to another, on the keys everything
       * else uses for it. Before these two there was no way at all: an `m`
       * could not be started from an `n`, which is how an `m` is started.
       *
       * Above the selection guard below, because copying the whole letter is
       * what happens when nothing is picked and pasting needs nothing picked
       * at all.
       */
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        store.copyOutlines(glyph.name);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        store.pasteOutlines(glyph.name);
        return;
      }
      /*
       * The two keys that finish an outline, and the reason a session used to
       * end with a list full of two-point stubs.
       *
       * There was no way to stop drawing. Not Escape, not Enter, not picking up
       * another tool -- the only exit was a click inside seven pixels of the
       * first point, and every attempt that missed or was thought better of
       * stayed in the letter for ever. Escape finishes and leaves it open;
       * Enter finishes by closing it. Both drop an outline too short to be one.
       */
      if (event.key === "Escape" || event.key === "Enter") {
        /*
         * A stroke being written finishes on the same two keys, for the same
         * reason and with the same difference between them: Escape leaves the
         * ends loose and Enter closes the stroke into a ring. Taken first,
         * because while a stroke is being written there is no open outline for
         * `finishOutline` to find and the key would do nothing at all.
         */
        if (store.writing) {
          if (event.key === "Enter") store.closeStroke(glyph.name);
          else store.finishStroke();
          event.preventDefault();
          forceRender();
          reportPhaseRef.current(atRef.current);
          return;
        }
        if (store.finishOutline(glyph.name, event.key === "Enter")) {
          event.preventDefault();
          forceRender();
          // The line has to catch up here too: finishing changes what the next
          // click does, and a person who has just pressed Escape is looking
          // straight at it.
          reportPhaseRef.current(atRef.current);
        }
        return;
      }

      /*
       * Select-all and Tab, which have to come before the guard below: both are
       * ways of picking points when none are picked, and the guard exists for
       * the operations that need something to work on.
       */
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        store.selectAllNodes(glyph.name);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        store.stepSelection(glyph.name, event.shiftKey ? -1 : 1);
        return;
      }

      if (state.selectedNodes.size === 0) return;

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteSelectedNodes(glyph, state.selectedNodes);
        return;
      }
      const nudge: Record<string, Vec2> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: 1 },
        ArrowDown: { x: 0, y: -1 },
      };
      const step = nudge[event.key];
      if (!step) return;
      event.preventDefault();
      // Shift nudges in larger jumps, the usual convention.
      const amount = event.shiftKey ? 10 : 1;
      const refs = [...state.selectedNodes].map(parseNodeKey);
      store.editGlyph(glyph.name, "Nudge points", (editing) => {
        for (const ref of refs) {
          const node = editing.contours[ref.contour]?.nodes[ref.node];
          if (!node) continue;
          const dx = step.x * amount;
          const dy = step.y * amount;
          node.point = { x: node.point.x + dx, y: node.point.y + dy };
          if (node.handleIn) node.handleIn = { x: node.handleIn.x + dx, y: node.handleIn.y + dy };
          if (node.handleOut)
            node.handleOut = { x: node.handleOut.x + dx, y: node.handleOut.y + dy };
        }
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [glyph, state.selectedNodes]);

  if (!typeface) {
    return <Centered>Open a font to start editing.</Centered>;
  }
  if (!glyph) {
    /*
     * A font with letters in it and none of them open is a different thing
     * from a font with no letters at all, and this used to say the same about
     * both -- sending somebody with an empty font to the one view that would
     * then tell them to press New letter.
     */
    if (!hasLetters(typeface)) return <NothingDrawnYet what="draw" />;
    return <Centered>Choose a glyph in the font view.</Centered>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CoachMark id="glyph" />
      {/*
        Which weight this letter is being drawn in, above the letter.

        The same argument the sidebearings below make: it is a decision about
        what you are looking at, taken while looking at it, and a control for
        that on the far side of the window is one somebody has to go and find.
        Nothing at all until there is a second weight to switch to.
      */}
      <Versions compact />
      {/*
        What stands either side, above the canvas rather than in the panel.

        It belongs with the letter it changes: this is a decision about what you
        are looking at, taken while looking at it, and a control for that on the
        far side of the window is a control somebody has to go and find.
      */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-2xs">
        <span className="text-muted-foreground">Between</span>
        <input
          value={state.context.before}
          onChange={(event) => store.setContext({ before: event.target.value })}
          aria-label="Letters before"
          data-context-before
          maxLength={8}
          className="h-7 w-16 rounded-md border border-input bg-card px-2 text-center text-xs-plus text-foreground outline-none focus-visible:border-accent"
        />
        <span className="rounded bg-card px-2 py-1 font-medium text-foreground">{glyph.name}</span>
        <input
          value={state.context.after}
          onChange={(event) => store.setContext({ after: event.target.value })}
          aria-label="Letters after"
          data-context-after
          maxLength={8}
          className="h-7 w-16 rounded-md border border-input bg-card px-2 text-center text-xs-plus text-foreground outline-none focus-visible:border-accent"
        />
        {/*
          The one thing in this row that can afford to give way.

          Everything else here is a control with a name on it, and a control
          whose name has wrapped -- `On` over `black` -- reads as broken. This
          is a sentence, so it can lose its last words to an ellipsis and still
          do its job, and the hover carries the whole of it. It only comes up on
          a narrow window or a long glyph name, but `newGlyph` is a long glyph
          name and it is the one every new letter starts with.
        */}
        {/*
          Gone rather than clipped, once there is no room to say anything.

          Truncation is fine while a few words survive; it is not fine at two.
          In a nine-hundred-pixel window this row is a label, three letter
          boxes, six controls and then whatever is left, and what was left was
          "Dr…" -- which says nothing and reads as a rendering fault rather than
          as a sentence that did not fit. The whole of it is still on the hover,
          where it was already, and the three letter boxes beside it are the
          thing the sentence is about.
        */}
        <span
          className="hidden min-w-0 flex-1 truncate pl-1 text-muted-foreground lg:block"
          title="Drawn flat and not editable — they are what this letter is spaced against, at their real advances and kerning."
        >
          Drawn flat and not editable — they are what this letter is spaced against, at their real
          advances and kerning.
        </span>

        {/*
          The guides, at the other end of the same row.

          A guide is placed at the height the view is looking at rather than at
          a number typed into a box, because the reason to want one is almost
          always "here, level with this" -- and it is then dragged, which is the
          part that makes it useful. They belong to the font, so one placed
          while drawing an `n` is still there on the `o` you are lining up
          against it.
        */}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <GroundToggle />
          {/*
            Two of them, because a guide was only ever horizontal and half of
            what anybody draws one for is vertical: where a stem should stand,
            where a sidebearing should fall.
          */}
          <button
            type="button"
            onClick={() => store.addGuide(typeface.metrics.xHeight, "y")}
            data-add-guide
            title="Put a guide across the canvas, then drag it where you want it"
            className="rounded border border-border px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            Guide ―
          </button>
          <button
            type="button"
            onClick={() => store.addGuide(Math.round((glyph?.advanceWidth ?? 500) / 2), "x")}
            data-add-guide-vertical
            title="Put a guide down the canvas, then drag it where you want it"
            className="rounded border border-border px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            Guide │
          </button>
          {/*
            Snapping is a switch rather than a modifier, because the two a drag
            already uses are taken: shift holds it to one axis and alt pans the
            canvas. A third would be a chord nobody would find.
          */}
          <button
            type="button"
            onClick={() => store.setSnapping(!state.snapping)}
            aria-pressed={state.snapping}
            data-snap-toggle
            title={
              state.snapping
                ? "A dragged point lands on whole units, the metric lines, the guides, and the letter's own points. Press to let it land anywhere."
                : "A dragged point lands wherever you let go of it. Press to pull it onto the lines worth landing on."
            }
            className={cn(
              "rounded border px-2 py-1 text-2xs transition-colors",
              state.snapping
                ? "border-accent bg-accent/15 text-accent"
                : "border-border text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            Snap
          </button>
          {/*
            The faults, on a switch beside snapping because it is the same kind
            of thing: a way of drawing that is on or off, rather than something
            done once. Off by default -- a letter halfway through being drawn is
            covered in missing extremes and does not need telling.
          */}
          <button
            type="button"
            onClick={() => store.setMarks(!state.marks)}
            aria-pressed={state.marks}
            data-marks-toggle
            title={
              state.marks
                ? "Rings mark where a curve turns without a point on it, and crosses mark points a hair off smooth. Press to stop showing them."
                : "Ring the two faults you cannot see by looking: curves that turn with no point at the turn, and points a degree or two off smooth."
            }
            className={cn(
              "rounded border px-2 py-1 text-2xs transition-colors",
              state.marks
                ? "border-[color:var(--attention)] bg-[color:var(--attention)]/15 text-[color:var(--attention)]"
                : "border-border text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            Faults
          </button>
          {/*
            The polygon's side count, shown only while the polygon is in hand.

            A control for a tool nobody has picked up is a control in the way,
            and this row is already the tightest in the view. Beside the tool
            rather than in the Inspector because it changes what the very next
            drag produces, and a person setting it is looking at the canvas.
          */}
          {state.tool === "polygon" && (
            <span className="flex items-center gap-1" data-polygon-sides>
              <span className="text-2xs text-muted-foreground">Sides</span>
              <button
                type="button"
                onClick={() => store.setPolygonSides(state.polygonSides - 1)}
                disabled={state.polygonSides <= 3}
                aria-label="One side fewer"
                className="rounded border border-border px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-40"
              >
                −
              </button>
              <span className="w-4 text-center text-2xs tabular-nums text-foreground">
                {state.polygonSides}
              </span>
              <button
                type="button"
                onClick={() => store.setPolygonSides(state.polygonSides + 1)}
                disabled={state.polygonSides >= 24}
                aria-label="One side more"
                className="rounded border border-border px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-40"
              >
                +
              </button>
            </span>
          )}
          {state.guides.length > 0 && (
            <button
              type="button"
              onClick={() => store.clearGuides()}
              data-clear-guides
              className="rounded px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear {state.guides.length}
            </button>
          )}
        </span>
      </div>
      {/*
        The ground, declared here rather than on the document.

        Custom properties inherit, so putting it on this element redefines the
        canvas colours for this subtree and for nothing else: the letters in
        the inspector a few pixels to the right, and the grid one tab over,
        keep the colours they were designed with. That is the whole scope of
        this -- the surface a letter is judged on, not a theme.
      */}
      <div className="flex min-h-0 flex-1">
        <ToolPalette />
        <div
          ref={measure}
          data-ground={state.ground}
          className="relative min-h-0 flex-1 overflow-hidden bg-[var(--canvas)]"
        >
          <canvas
            ref={canvasRef}
            style={{ width: size.width, height: size.height }}
            className={cursorClass(state.tool, state.toolState, dragRef.current !== null)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            onPointerLeave={() => {
              setHover(null);
              noteAt(null);
              /*
               * The tool is still in hand, so it still has something to say.
               *
               * This blanked the sentence outright, which meant that reaching
               * for a tool -- a move that necessarily leaves the canvas -- left
               * the line empty, and it only came back when the pointer returned.
               * The state to report is "this tool, with nothing under it", which
               * is exactly what the tool would do the moment you came back.
               */
              reportPhase(null);
            }}
            onWheel={(event) => {
              // Ctrl or command with the wheel zooms, matching every design tool.
              if (event.ctrlKey || event.metaKey) {
                setZoom((current) => clamp(current * (event.deltaY < 0 ? 1.1 : 0.9), 0.1, 24));
              } else {
                setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
              }
            }}
          />
          {/*
          And what is wrong with this letter, over the letter.

          Every one of these faults was already found by the checker and only
          ever said on a separate page, which is a page somebody has to know to
          go and visit. An unclosed outline is a thing to fix while the pen is
          still in your hand. Nothing is drawn when there is nothing wrong.
        */}
          {typeface && glyph && (
            <GlyphFaults
              typeface={typeface}
              glyph={glyph}
              revision={state.revision}
              masters={state.masters}
            />
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 flex gap-3 text-2xs text-muted-foreground tabular-nums">
            <span>{Math.round(zoom * 100)}%</span>
            {state.selectedNodes.size > 1 && <span>{state.selectedNodes.size} points</span>}
          </div>
        </div>
      </div>
      <Numbers
        glyph={glyph}
        typeface={typeface}
        selected={state.selectedNodes}
        toolState={state.toolState}
      />
    </div>
  );
}

/**
 * The numbers, under the letter.
 *
 * A point could be dragged and nothing else. Moving a stem three units sideways
 * was therefore not possible: you could get close by eye at a high zoom and
 * never land on a number, which is most of the difference between a tool a
 * designer will use and one they will admire and then go back to their own.
 *
 * Under the canvas rather than in the panel on the far right, because these are
 * about the letter and the letter is here. What is offered depends on what is
 * selected -- the point when there is exactly one, the letter's own spacing
 * otherwise -- so the row answers the question in front of you rather than
 * showing eight fields of which six are always dimmed.
 */
function Numbers({
  glyph,
  typeface,
  selected,
  toolState,
}: {
  glyph: Glyph;
  typeface: Typeface;
  selected: ReadonlySet<string>;
  /** What the tool in hand would do now, which takes this row when it has something to say. */
  toolState: ToolState;
}): React.JSX.Element {
  const one = selected.size === 1 ? parseNodeKey([...selected][0]) : null;
  const node = one ? glyph.contours[one.contour]?.nodes[one.node] : null;

  /*
   * The sidebearings, measured off the ink rather than stored.
   *
   * A sidebearing is not a field on a glyph: it is where the ink starts against
   * where the advance does, so it moves whenever the outline does. Measured
   * here for the same reason the Spacing table measures it -- a number kept
   * beside the outline is a number that goes stale the first time a point moves.
   */
  const box = glyph.contours.length > 0 ? contoursBounds(glyph.contours) : null;
  const advance = resolveAdvanceWidth(glyph, typeface);
  const left = box && Number.isFinite(box.xMin) ? Math.round(box.xMin) : 0;
  const right = box && Number.isFinite(box.xMax) ? Math.round(advance - box.xMax) : 0;

  const move = (axis: "x" | "y", next: number) => {
    if (!one) return;
    store.editGlyph(glyph.name, "Move point", (editing) => {
      const target = editing.contours[one.contour]?.nodes[one.node];
      if (!target) return;
      const delta = next - target.point[axis];
      target.point = { ...target.point, [axis]: next };
      // The handles travel with the point they belong to, exactly as they do
      // under a drag. Left behind, typing a coordinate would straighten the
      // curve either side of it.
      if (target.handleIn) {
        target.handleIn = { ...target.handleIn, [axis]: target.handleIn[axis] + delta };
      }
      if (target.handleOut) {
        target.handleOut = { ...target.handleOut, [axis]: target.handleOut[axis] + delta };
      }
    });
  };

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-border px-4 py-1.5 text-2xs text-muted-foreground"
      data-glyph-numbers
    >
      <span className="font-medium text-foreground">{glyph.name}</span>

      {node ? (
        <>
          <span className="flex items-center gap-1">
            X
            <NumberField
              label="Point x"
              value={Math.round(node.point.x)}
              onCommit={(next) => move("x", next)}
            />
          </span>
          <span className="flex items-center gap-1">
            Y
            <NumberField
              label="Point y"
              value={Math.round(node.point.y)}
              onCommit={(next) => move("y", next)}
            />
          </span>
        </>
      ) : (
        /*
          What the tool in hand would do if you acted now, in its own words, and
          the point-typing hint only when there is no tool with anything to say.
          A line that changes as the gesture changes is worth more than a
          standing instruction: the knife saying "not across anything yet" is
          the difference between letting go and finding out, and finding out
          before you let go.
        */
        <span
          className={cn(
            "opacity-70",
            toolState.phase === "willDo" && "text-[color:var(--attention)] opacity-100",
          )}
          data-tool-says
        >
          {toolState.says ||
            (selected.size === 0
              ? "Select one point to type its position."
              : `${selected.size} points selected — one at a time can be typed.`)}
        </span>
      )}

      <span className="ml-auto flex items-center gap-x-5">
        <span className="flex items-center gap-1">
          Left
          <NumberField
            label="Left sidebearing"
            value={left}
            disabled={!box}
            onCommit={(next) => store.shiftSidebearing(glyph.name, next - left, "left")}
          />
        </span>
        <span className="flex items-center gap-1">
          Width
          <NumberField
            label="Advance width"
            value={Math.round(advance)}
            onCommit={(next) =>
              store.editGlyph(glyph.name, "Set advance width", (editing) => {
                editing.advanceWidth = Math.max(0, next);
              })
            }
          />
        </span>
        <span className="flex items-center gap-1">
          Right
          <NumberField
            label="Right sidebearing"
            value={right}
            disabled={!box}
            onCommit={(next) => store.shiftSidebearing(glyph.name, next - right, "right")}
          />
        </span>
      </span>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center text-xs-plus text-muted-foreground">
      {children}
    </div>
  );
}
