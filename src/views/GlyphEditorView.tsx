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

import { contourSegments, contoursBounds, contoursToPath2D } from "@/font/geometry";
import { classifyNodes } from "@/font/quadratic";
import { boxOf, shapeFrom, type ShapeKind } from "@/font/shapes";
import { linesFor, snapPoint, type Lines } from "@/font/snap";
import { resolveComponents } from "@/font/composite";
import { resolveAdvanceWidth, resolveGlyphContours } from "@/font/transform";
import type { Anchor, Contour, Glyph, GlyphNode, Typeface, Vec2 } from "@/font/types";
import { slice } from "@/font/knife";
import { extremesMissing, nearlySmooth } from "@/font/marks";
import { A_DRAG, draggedPoint, segmentAt } from "@/font/pen";
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
  applyView,
  prepareCanvas,
  readToken,
  toFontX,
  toFontY,
  type GlyphView,
} from "@/components/glyph-render";
import { nodeKey, store, useAppState, type NodeRef, type ToolState } from "@/state/useStore";
import { CoachMark } from "@/components/CoachMark";
import { GlyphFaults } from "@/components/GlyphFaults";
import { GroundToggle } from "@/components/GroundToggle";
import { NumberField } from "@/components/NumberField";
import { NothingDrawnYet } from "@/components/NothingDrawnYet";
import { hasLetters } from "@/font/library";
import { ToolPalette } from "@/components/ToolPalette";
import { cn } from "@/ui/lib/utils";

/** How close a click has to land, in screen pixels, to grab a node. */
const HIT_RADIUS = 7;
const NODE_SIZE = 3.5;

/**
 * What the pointer is currently over.
 *
 * Resolved with the same tests, in the same order, that decide what a click
 * grabs. If the two ever disagreed the highlight would be a lie: it would show
 * one target and hand you another.
 */
type Hover =
  | { kind: "anchor"; name: string }
  | { kind: "handle"; ref: NodeRef; side: "in" | "out" }
  | { kind: "node"; ref: NodeRef }
  | null;

function hoverKey(hover: Hover): string {
  if (!hover) return "";
  if (hover.kind === "anchor") return `anchor:${hover.name}`;
  if (hover.kind === "handle") return `handle:${nodeKey(hover.ref)}:${hover.side}`;
  return `node:${nodeKey(hover.ref)}`;
}

/**
 * How near a line has to be, in screen pixels, before a drag lands on it.
 *
 * In pixels rather than in font units so it feels the same at every zoom:
 * six units is a strong pull at a hundred per cent and nothing at all at
 * eight hundred, which is exactly where somebody is placing a point by eye
 * and least wants to be argued with.
 */
const SNAP_REACH = 6;

type Drag =
  /*
   * `anchor` is the node actually under the pointer, and `lines` is what it
   * can land on. Both are worked out once when the drag starts rather than on
   * every move: nothing else in the letter moves while a drag is running, so
   * recomputing the lines sixty times a second would be the same answer sixty
   * times.
   */
  | { kind: "node"; refs: NodeRef[]; anchor: NodeRef; lines: Lines; start: Vec2; before: Glyph }
  | { kind: "handle"; ref: NodeRef; side: "in" | "out"; lines: Lines; before: Glyph }
  | { kind: "marquee"; from: Vec2; to: Vec2; additive: boolean }
  | { kind: "anchor"; name: string; before: Anchor[] }
  | { kind: "pan"; from: Vec2; startPan: Vec2 }
  | { kind: "guide"; index: number }
  /*
   * The two that draw rather than move. Both hold canvas coordinates and
   * neither touches the letter until the pointer comes up: a shape half
   * dragged is not a shape, and a knife stroke that has not been let go of is
   * not a cut. Everything they show in the meantime is drawn over the canvas
   * and belongs to nothing.
   */
  | { kind: "shape"; kind2: ShapeKind; from: Vec2; to: Vec2 }
  | { kind: "knife"; from: Vec2; to: Vec2 }
  /*
   * The pencil keeps its trail in *font* units rather than canvas ones, so a
   * stroke that was panned or zoomed halfway through is still the stroke that
   * was drawn. Thinning it is `freehand.ts`'s business, not this one's: what
   * is recorded here is everything the pointer said.
   */
  | { kind: "freehand"; trail: Vec2[] }
  /*
   * The lasso's ring, in canvas units.
   *
   * A box cannot pick the points on one side of a curve without taking the
   * other side too, and on a letter drawn at two hundred points that is the
   * usual case rather than the awkward one.
   */
  | { kind: "lasso"; trail: Vec2[]; additive: boolean }
  /*
   * The pen, mid-gesture: a point has been put down and the pointer is pulling
   * its handles out of it. `from` is where it was pressed, in canvas units, so
   * the drag can tell a click from a pull before it commits to either.
   */
  | {
      kind: "pen";
      from: Vec2;
      contour: number;
      node: number;
      keepIn: Vec2 | null;
      pulled: boolean;
      before: Glyph;
    };

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
      [...text].map((character) => byCodepoint.get(character.codePointAt(0)!)).filter((one) => one !== undefined);

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
      drawContours(context, resolveGlyphContours(one.glyph, typeface), shifted, { fill: asideFill });
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
      fill: withAlpha(readToken("--glyph-fill", "#eeeeee", canvas), resolved !== composed ? 0.5 : 0.92),
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
    drawNodes(context, glyph.contours, view, state.selectedNodes, hover);
    if (state.marks) drawMarks(context, glyph.contours, view);
    drawAnchors(context, glyph.anchors, view, hover);

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
  }, [typeface, glyph, view, size, state.selectedNodes, state.revision, hover, neighbours, state.guides, state.ground, state.marks, state.tool, at, state.highlightPath]);


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
    if (!glyph || !canvasPoint) return { ...NOTHING_UNDER, grabbable: found !== null };
    const open = openOutline(glyph);
    /*
     * The node and edge tests run for every tool rather than only the select
     * tool's hover, because five of the thirteen work on a point or an edge and
     * each has to know whether there is one before the click, not after.
     */
    const node = hitTestNode(glyph, view, canvasPoint);
    return {
      grabbable: found !== null,
      closingPoint: onClosingPoint(glyph, view, canvasPoint),
      pathOpen: Boolean(open),
      openPoints: open?.nodes.length ?? 0,
      node: node !== null,
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

  React.useEffect(() => {
    store.setToolState(
      toolStateFor(
        state.tool,
        {
          ...NOTHING_UNDER,
          pathOpen: Boolean(glyph && openOutline(glyph)),
          openPoints: glyph ? (openOutline(glyph)?.nodes.length ?? 0) : 0,
          shape: Boolean(glyph?.contours.some((one) => one.closed && one.nodes.length >= 3)),
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
          if (node.handleOut) node.handleOut = { x: node.handleOut.x + dx, y: node.handleOut.y + dy };
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
          <GlyphFaults typeface={typeface} glyph={glyph} revision={state.revision} />
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
          <label className="flex items-center gap-1">
            X
            <NumberField
              label="Point x"
              value={Math.round(node.point.x)}
              onCommit={(next) => move("x", next)}
            />
          </label>
          <label className="flex items-center gap-1">
            Y
            <NumberField
              label="Point y"
              value={Math.round(node.point.y)}
              onCommit={(next) => move("y", next)}
            />
          </label>
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
        <label className="flex items-center gap-1">
          Left
          <NumberField
            label="Left sidebearing"
            value={left}
            disabled={!box}
            onCommit={(next) => store.shiftSidebearing(glyph.name, next - left, "left")}
          />
        </label>
        <label className="flex items-center gap-1">
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
        </label>
        <label className="flex items-center gap-1">
          Right
          <NumberField
            label="Right sidebearing"
            value={right}
            disabled={!box}
            onCommit={(next) => store.shiftSidebearing(glyph.name, next - right, "right")}
          />
        </label>
      </span>
    </div>
  );
}

/**
 * Which guide, if any, is under a given height on the canvas.
 *
 * Four pixels either side, which is deliberately tighter than the band a node
 * answers to: a guide runs the whole width of the canvas, so a generous band
 * would take clicks meant for a point anywhere along it. Searched from the last
 * one back, so the guide drawn on top is the one that answers.
 */
function guideAt(
  guides: ReadonlyArray<{ axis: "x" | "y"; at: number }>,
  view: GlyphView,
  canvasPoint: Vec2,
): number | null {
  // Backwards, so the one drawn last is the one caught first -- which is the
  // one on top, and the one somebody just put there.
  for (let index = guides.length - 1; index >= 0; index--) {
    const guide = guides[index];
    const where =
      guide.axis === "y"
        ? Math.abs(view.originY - guide.at * view.scale - canvasPoint.y)
        : Math.abs(view.originX + guide.at * view.scale - canvasPoint.x);
    if (where <= 4) return index;
  }
  return null;
}


// --- drawing ------------------------------------------------------------

function drawMetrics(
  context: CanvasRenderingContext2D,
  typeface: Typeface,
  glyph: Glyph | null,
  view: GlyphView,
  size: { width: number; height: number },
  guides: ReadonlyArray<{ axis: "x" | "y"; at: number }> = [],
): void {
  const metricColour = readToken("--guide-metric", "#5a6070", context.canvas);
  const baselineColour = readToken("--guide-baseline", "#d24b3a", context.canvas);
  const sidebearingColour = readToken("--guide-sidebearing", "#3f8fa8", context.canvas);

  const lines: Array<{ y: number; label: string; colour: string }> = [
    { y: 0, label: "baseline", colour: baselineColour },
    { y: typeface.metrics.xHeight, label: "x-height", colour: metricColour },
    { y: typeface.metrics.capHeight, label: "cap height", colour: metricColour },
    { y: typeface.metrics.ascender, label: "ascender", colour: metricColour },
    { y: typeface.metrics.descender, label: "descender", colour: metricColour },
  ];

  context.save();
  context.lineWidth = 1;
  context.font = "10px ui-monospace, monospace";
  for (const line of lines) {
    const y = Math.round(view.originY - line.y * view.scale) + 0.5;
    if (y < 0 || y > size.height) continue;
    context.strokeStyle = withAlpha(line.colour, 0.55);
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(size.width, y);
    context.stroke();
    context.fillStyle = withAlpha(line.colour, 0.8);
    context.fillText(line.label, 6, y - 4);
  }

  /*
   * The guides somebody put there, over the metric lines and told apart from
   * them.
   *
   * A different colour and a dashed line, because the two kinds mean opposite
   * things: a metric line is a fact about the font and cannot be moved, and a
   * guide is a decision somebody made and can be dragged or thrown away. Drawn
   * with their height beside them, since a guide whose position you cannot read
   * is a guide you cannot put back.
   */
  const guideColour = readToken("--accent", "#0c8ce9", context.canvas);
  context.setLineDash([5, 4]);
  for (const guide of guides) {
    context.strokeStyle = withAlpha(guideColour, 0.75);
    context.fillStyle = withAlpha(guideColour, 0.9);
    context.beginPath();
    if (guide.axis === "y") {
      const y = Math.round(view.originY - guide.at * view.scale) + 0.5;
      if (y < -2 || y > size.height + 2) continue;
      context.moveTo(0, y);
      context.lineTo(size.width, y);
      context.stroke();
      context.fillText(String(guide.at), size.width - 46, y - 4);
    } else {
      const x = Math.round(view.originX + guide.at * view.scale) + 0.5;
      if (x < -2 || x > size.width + 2) continue;
      context.moveTo(x, 0);
      context.lineTo(x, size.height);
      context.stroke();
      context.fillText(String(guide.at), x + 4, 12);
    }
  }
  context.setLineDash([]);

  // Sidebearings: the origin and the advance width bracket the glyph.
  if (glyph) {
    context.strokeStyle = withAlpha(sidebearingColour, 0.7);
    context.setLineDash([3, 3]);
    for (const x of [0, glyph.advanceWidth]) {
      const canvasX = Math.round(view.originX + x * view.scale) + 0.5;
      context.beginPath();
      context.moveTo(canvasX, 0);
      context.lineTo(canvasX, size.height);
      context.stroke();
    }
    context.setLineDash([]);
  }
  context.restore();
}

function drawContours(
  context: CanvasRenderingContext2D,
  contours: Contour[],
  view: GlyphView,
  options: { fill: string },
): void {
  context.save();
  applyView(context, view);
  context.fillStyle = options.fill;
  context.fill(contoursToPath2D(contours), "nonzero");
  context.restore();
}

function drawNodes(
  context: CanvasRenderingContext2D,
  contours: Contour[],
  view: GlyphView,
  selected: ReadonlySet<string>,
  hover: Hover,
): void {
  const onCurve = readToken("--node-on-curve", "#0c8ce9", context.canvas);
  const offCurve = readToken("--node-off-curve", "#9aa0ad", context.canvas);
  const selectedColour = readToken("--node-selected", "#f5a524", context.canvas);

  context.save();
  contours.forEach((contour, contourIndex) => {
    // Outline path, so the shape is legible while dragging.
    context.strokeStyle = withAlpha(onCurve, 0.45);
    context.lineWidth = 1;
    context.beginPath();
    for (const segment of contourSegments(contour)) {
      const from = toScreen(view, segment.from);
      context.moveTo(from.x, from.y);
      if (segment.kind === "line") {
        const to = toScreen(view, segment.to);
        context.lineTo(to.x, to.y);
      } else {
        const c1 = toScreen(view, segment.c1);
        const c2 = toScreen(view, segment.c2);
        const to = toScreen(view, segment.to);
        context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
      }
    }
    context.stroke();

    contour.nodes.forEach((node, nodeIndex) => {
      const key = nodeKey({ contour: contourIndex, node: nodeIndex });
      const isSelected = selected.has(key);
      const point = toScreen(view, node.point);

      // Handle arms and their control points.
      for (const [handle, _side] of [
        [node.handleIn, "in"],
        [node.handleOut, "out"],
      ] as const) {
        if (!handle) continue;
        const handlePoint = toScreen(view, handle);
        context.strokeStyle = withAlpha(offCurve, 0.5);
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(handlePoint.x, handlePoint.y);
        context.stroke();
        context.fillStyle = offCurve;
        context.beginPath();
        context.arc(handlePoint.x, handlePoint.y, NODE_SIZE - 0.5, 0, Math.PI * 2);
        context.fill();

        const handleHovered =
          hover?.kind === "handle" &&
          hover.ref.contour === contourIndex &&
          hover.ref.node === nodeIndex &&
          hover.side === _side;
        if (handleHovered) drawHoverRing(context, handlePoint, NODE_SIZE + 2.5, offCurve);
      }

      // A smooth node is drawn round and a corner square, so the kind of point
      // is readable without selecting it.
      context.fillStyle = isSelected ? selectedColour : onCurve;
      if (node.type === "smooth") {
        context.beginPath();
        context.arc(point.x, point.y, NODE_SIZE + 0.5, 0, Math.PI * 2);
        context.fill();
      } else {
        const s = NODE_SIZE + 0.5;
        context.fillRect(point.x - s, point.y - s, s * 2, s * 2);
      }

      const nodeHovered =
        hover?.kind === "node" &&
        hover.ref.contour === contourIndex &&
        hover.ref.node === nodeIndex;
      if (nodeHovered) {
        drawHoverRing(context, point, NODE_SIZE + 4, isSelected ? selectedColour : onCurve);
      }
    });
  });
  context.restore();
}

/**
 * Anchors, drawn as a cross with its name beside it.
 *
 * They are deliberately not the same shape as an outline point: an anchor is
 * not part of the letter, it is where another glyph attaches to it.
 */
function drawAnchors(
  context: CanvasRenderingContext2D,
  anchors: Anchor[],
  view: GlyphView,
  hover: Hover,
): void {
  if (anchors.length === 0) return;
  const colour = readToken("--inspect", "#9149f5", context.canvas);

  context.save();
  context.font = "10px ui-monospace, monospace";
  context.textBaseline = "middle";
  for (const anchor of anchors) {
    const point = toScreen(view, { x: anchor.x, y: anchor.y });
    const arm = 6;

    context.strokeStyle = colour;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(point.x - arm, point.y);
    context.lineTo(point.x + arm, point.y);
    context.moveTo(point.x, point.y - arm);
    context.lineTo(point.x, point.y + arm);
    context.stroke();

    context.beginPath();
    context.arc(point.x, point.y, 3, 0, Math.PI * 2);
    context.strokeStyle = colour;
    context.lineWidth = 1;
    context.stroke();

    context.fillStyle = colour;
    context.fillText(anchor.name, point.x + arm + 3, point.y);

    if (hover?.kind === "anchor" && hover.name === anchor.name) {
      drawHoverRing(context, point, arm + 2, colour);
    }
  }
  context.restore();
}

function hitTestAnchor(glyph: Glyph, view: GlyphView, canvasPoint: Vec2): string | null {
  for (const anchor of glyph.anchors) {
    const screen = toScreen(view, { x: anchor.x, y: anchor.y });
    if (Math.hypot(screen.x - canvasPoint.x, screen.y - canvasPoint.y) <= HIT_RADIUS + 2) {
      return anchor.name;
    }
  }
  return null;
}

/**
 * The ring that marks what a click would grab.
 *
 * Drawn, not animated: this follows the pointer, so any easing would leave it
 * trailing behind the thing it is meant to be pointing at.
 */
function drawHoverRing(
  context: CanvasRenderingContext2D,
  point: Vec2,
  radius: number,
  colour: string,
): void {
  context.save();
  context.strokeStyle = withAlpha(colour, 0.9);
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawMarquee(context: CanvasRenderingContext2D, drag: Extract<Drag, { kind: "marquee" }>): void {
  const accent = readToken("--accent", "#0c8ce9", context.canvas);
  context.save();
  context.strokeStyle = accent;
  context.fillStyle = withAlpha(accent, 0.12);
  context.lineWidth = 1;
  const x = Math.min(drag.from.x, drag.to.x);
  const y = Math.min(drag.from.y, drag.to.y);
  const width = Math.abs(drag.to.x - drag.from.x);
  const height = Math.abs(drag.to.y - drag.from.y);
  context.fillRect(x, y, width, height);
  context.strokeRect(x + 0.5, y + 0.5, width, height);
  context.restore();
}

/**
 * The shape as it is being dragged out.
 *
 * Drawn from the same box the shape will be built from rather than from the
 * raw drag, so what is on screen while the pointer is down is the shape that
 * lands when it comes up -- squared off if shift is held, rounded onto whole
 * units, and grown from the middle under alt. A preview that showed the raw
 * drag would jump the moment the button was let go.
 */
function drawShapePreview(
  context: CanvasRenderingContext2D,
  drag: Extract<Drag, { kind: "shape" }>,
  view: GlyphView,
  modifiers: { square: boolean; fromCentre: boolean },
): void {
  const box = boxOf(
    { x: toFontX(view, drag.from.x), y: toFontY(view, drag.from.y) },
    { x: toFontX(view, drag.to.x), y: toFontY(view, drag.to.y) },
    modifiers,
  );
  const shape = shapeFrom(drag.kind2, box, false);
  if (!shape) return;
  const accent = readToken("--accent", "#0c8ce9", context.canvas);
  drawContours(context, [shape], view, { fill: withAlpha(accent, 0.18) });
}

/**
 * The stroke as the hand is making it, before anything is fitted.
 *
 * Every recorded position, joined up, which is deliberately not what will be
 * added: the fitted curve has a handful of nodes and this has hundreds. What
 * is wanted while a hand is moving is to see where it has been, and the
 * difference between the two only shows up when the fitting is wrong -- which
 * is exactly when it is worth seeing.
 */
/**
 * Where the pen's next segment would land, and the point that would close it.
 *
 * Dashed, because it is not there yet -- the same language the marquee and the
 * knife line already use for a thing that is being decided rather than drawn.
 * The closing point gets a ring rather than a colour so it reads at any zoom
 * and on either ground.
 */
function drawPenReach(
  context: CanvasRenderingContext2D,
  glyph: Glyph | null,
  view: GlyphView,
  at: Vec2,
): void {
  const open = glyph ? openOutline(glyph) : null;
  if (!open) return;

  const last = open.nodes[open.nodes.length - 1].point;
  const from = { x: view.originX + last.x * view.scale, y: view.originY - last.y * view.scale };

  context.save();
  context.strokeStyle = readToken("--inspect", "#7aa2f7");
  context.lineWidth = 1;
  context.setLineDash([4, 3]);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(at.x, at.y);
  context.stroke();
  context.setLineDash([]);

  if (open.nodes.length >= 3) {
    const first = open.nodes[0].point;
    const ring = { x: view.originX + first.x * view.scale, y: view.originY - first.y * view.scale };
    /*
     * Filled once a click would close, rather than merely thicker.
     *
     * The ring used to grow by two pixels inside a seven-pixel window, which
     * is a signal you can only read if you already know to look for it. It is
     * now the same radius as the click that closes, and it fills -- so "this
     * will close" is a shape change you cannot miss, and the target and the
     * mark are the same size, which is the part that was actually wrong.
     */
    const colour = readToken("--inspect", "#9149f5", context.canvas);
    const near = Math.hypot(at.x - ring.x, at.y - ring.y) <= CLOSING_RADIUS;
    context.beginPath();
    context.arc(ring.x, ring.y, near ? CLOSING_RADIUS : HIT_RADIUS - 1, 0, Math.PI * 2);
    if (near) {
      context.fillStyle = withAlpha(colour, 0.3);
      context.fill();
    }
    context.strokeStyle = colour;
    context.lineWidth = near ? 2 : 1;
    context.stroke();
  }
  context.restore();
}

/**
 * The segment under the pointer, drawn as itself.
 *
 * A thicker line along the actual curve rather than a box round it, because the
 * question a person is asking is "which piece of this letter", and on a tight
 * counter two segments run within a few units of each other -- a box round
 * either would cover both.
 */
/** One contour, traced in the colour the interface uses for "this one". */
function drawPathOutline(
  context: CanvasRenderingContext2D,
  contour: Contour | undefined,
  view: GlyphView,
): void {
  if (!contour || contour.nodes.length < 2) return;
  const to = (v: Vec2) => ({ x: view.originX + v.x * view.scale, y: view.originY - v.y * view.scale });

  context.save();
  context.beginPath();
  const first = to(contour.nodes[0].point);
  context.moveTo(first.x, first.y);
  const last = contour.closed ? contour.nodes.length : contour.nodes.length - 1;
  for (let at = 0; at < last; at++) {
    const a = contour.nodes[at];
    const b = contour.nodes[(at + 1) % contour.nodes.length];
    const c1 = to(a.handleOut ?? a.point);
    const c2 = to(b.handleIn ?? b.point);
    const end = to(b.point);
    context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
  }
  if (contour.closed) context.closePath();

  const colour = readToken("--accent", "#0c8ce9", context.canvas);
  context.strokeStyle = withAlpha(readToken("--canvas", "#111111", context.canvas), 0.6);
  context.lineWidth = 6;
  context.stroke();
  context.strokeStyle = colour;
  context.lineWidth = 2.5;
  context.stroke();
  context.restore();
}

function drawSegmentUnder(
  context: CanvasRenderingContext2D,
  contour: Contour | undefined,
  index: number,
  view: GlyphView,
): void {
  const a = contour?.nodes[index];
  const b = contour?.nodes[(index + 1) % contour.nodes.length];
  if (!a || !b) return;

  const to = (v: Vec2) => ({ x: view.originX + v.x * view.scale, y: view.originY - v.y * view.scale });
  const from = to(a.point);
  const c1 = to(a.handleOut ?? a.point);
  const c2 = to(b.handleIn ?? b.point);
  const end = to(b.point);

  context.save();
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);

  /*
   * Cased, because half of this line runs along the edge of the letter.
   *
   * A single stroke is drawn half over the fill and half over the ground, and
   * on a white letter against a dark canvas that means half of it disappears
   * whichever colour it is. A casing in the ground's own colour under a bright
   * core shows against either -- the same trick a map uses to run a road over a
   * coastline. `--canvas` rather than `--background`: the two are the same
   * colour on the dark ground and opposite on the light one, and this is a mark
   * on the canvas.
   */
  context.strokeStyle = readToken("--canvas", "#111111", context.canvas);
  context.lineWidth = 7;
  context.globalAlpha = 0.55;
  context.stroke();

  /*
   * `--inspect` rather than the accent, because the accent is the colour of a
   * node and a highlight in it reads as more nodes. This is the colour the
   * pen's other two previews already use -- the rubber band and the closing
   * ring -- so all three of the pen's "here is what would happen" marks are one
   * colour and nothing the person drew is that colour at all.
   */
  context.strokeStyle = readToken("--inspect", "#9149f5", context.canvas);
  context.lineWidth = 4;
  context.globalAlpha = 1;
  context.stroke();
  context.restore();
}

/**
 * The faults, ringed where they are.
 *
 * Two shapes, deliberately unlike each other and unlike a node: a hollow ring
 * where a curve turns with no point on it, and a short bar across the direction
 * of travel where a point is a hair off smooth. Same colour, because they are
 * the same kind of thing -- advice, not selection -- and a person should be
 * able to tell at a glance that neither is something they drew.
 */
function drawMarks(
  context: CanvasRenderingContext2D,
  contours: Contour[],
  view: GlyphView,
): void {
  const colour = readToken("--attention", "#ea733a", context.canvas);
  const to = (v: Vec2) => ({ x: view.originX + v.x * view.scale, y: view.originY - v.y * view.scale });

  context.save();
  context.strokeStyle = colour;
  context.lineWidth = 1.5;

  for (const where of extremesMissing(contours)) {
    const at = to(where);
    context.beginPath();
    context.arc(at.x, at.y, 5, 0, Math.PI * 2);
    context.stroke();
  }

  for (const one of nearlySmooth(contours)) {
    const at = to(one.point);
    context.beginPath();
    context.arc(at.x, at.y, 7, 0, Math.PI * 2);
    context.stroke();
    // A tick through it, so a kink never reads as a missing extreme.
    context.beginPath();
    context.moveTo(at.x - 7, at.y - 7);
    context.lineTo(at.x + 7, at.y + 7);
    context.stroke();
  }
  context.restore();
}

/**
 * The lasso's ring as it is drawn, closed back to where it started.
 *
 * Closed while still being drawn because that is what will be tested when the
 * button comes up -- an open ring would be a picture of something the tool
 * does not do, and the points near the closing line are exactly the ones a
 * person is unsure about.
 */
function drawLasso(
  context: CanvasRenderingContext2D,
  drag: Extract<Drag, { kind: "lasso" }>,
): void {
  if (drag.trail.length < 2) return;
  const colour = readToken("--accent", "#0c8ce9", context.canvas);
  context.save();
  context.beginPath();
  context.moveTo(drag.trail[0].x, drag.trail[0].y);
  for (const point of drag.trail.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  context.fillStyle = withAlpha(colour, 0.12);
  context.fill();
  context.strokeStyle = colour;
  context.lineWidth = 1;
  context.setLineDash([4, 3]);
  context.stroke();
  context.restore();
}

function drawFreehandPreview(
  context: CanvasRenderingContext2D,
  drag: Extract<Drag, { kind: "freehand" }>,
  view: GlyphView,
): void {
  if (drag.trail.length < 2) return;
  context.save();
  context.strokeStyle = readToken("--accent", "#0c8ce9", context.canvas);
  context.lineWidth = 1.5;
  context.lineJoin = "round";
  context.beginPath();
  drag.trail.forEach((point, index) => {
    const at = toScreen(view, point);
    if (index === 0) context.moveTo(at.x, at.y);
    else context.lineTo(at.x, at.y);
  });
  context.stroke();
  context.restore();
}

/** The knife stroke, as a dashed line: a cut is a line and not a shape. */
function drawKnifePreview(
  context: CanvasRenderingContext2D,
  drag: Extract<Drag, { kind: "knife" }>,
): void {
  context.save();
  context.strokeStyle = readToken("--destructive", "#e5484d", context.canvas);
  context.lineWidth = 1;
  context.setLineDash([4, 3]);
  context.beginPath();
  context.moveTo(drag.from.x + 0.5, drag.from.y + 0.5);
  context.lineTo(drag.to.x + 0.5, drag.to.y + 0.5);
  context.stroke();
  context.restore();
}

// --- geometry helpers ---------------------------------------------------

const toScreen = (view: GlyphView, point: Vec2): Vec2 => ({
  x: view.originX + point.x * view.scale,
  y: view.originY - point.y * view.scale,
});

/**
 * Whether the line as drawn would actually cut anything.
 *
 * Asked of `slice` itself rather than guessed at, so what the cursor promises
 * and what letting go does are decided by one piece of code. A knife drawn
 * short, or down beside a stem rather than across it, does nothing at all --
 * and did it silently, so the only way to find out was to let go and watch
 * nothing happen.
 *
 * Cheap enough to ask on every move: it walks one glyph's contours looking for
 * crossings, and it only runs while the knife is actually being dragged.
 */
function knifeWouldCut(
  glyph: Glyph | null,
  view: GlyphView,
  drag: { from: Vec2; to: Vec2 },
): boolean {
  if (!glyph) return false;
  const from = { x: toFontX(view, drag.from.x), y: toFontY(view, drag.from.y) };
  const to = { x: toFontX(view, drag.to.x), y: toFontY(view, drag.to.y) };
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1) return false;
  return slice(glyph.contours, from, to) !== null;
}

/**
 * The outline the pen is part way through, if there is one.
 *
 * The last contour, and only while it is still open: `addPoint` appends to that
 * one and starts a new one when it is closed, so this is the same contour the
 * next click would extend.
 */
function openOutline(glyph: Glyph): Contour | null {
  /*
   * Being drawn, not merely open.
   *
   * This used to ask only whether the last contour was closed, which is a fact
   * about the shape rather than about what the hand is doing. An outline
   * finished and left open is a legitimate thing to have, and with one test for
   * both a pen click anywhere on the canvas reached back and extended it: ten
   * abandoned attempts joined into one contour wandering across the letter,
   * whose first point was then so far from its last that the closing ring could
   * never be found.
   */
  if (!store.getSnapshot().drawing) return null;
  const last = glyph.contours[glyph.contours.length - 1];
  return last && !last.closed && last.nodes.length > 0 ? last : null;
}

/**
 * Whether the pointer is on the point that would close the open outline.
 *
 * The same reach a node answers to, so the point that looks catchable is the
 * one that is. Under three points there is nothing to close: two points closed
 * is a line drawn twice, with no area to fill.
 */
/**
 * Whether the pointer is on the point the pen has just placed.
 *
 * Clicking it is how every editor says "the curve ends here": the handle you
 * pulled stays on the segment arriving and the one leaving goes, so the next
 * click draws a straight line out of a curve.
 */
/**
 * How near the first point a click has to land to close the outline.
 *
 * Twice the radius a node answers to, and deliberately. Closing was on the
 * ordinary seven pixels, which is a fine target for "grab this exact point"
 * and a poor one for "finish". The difference is that closing is an intention
 * already declared -- there is one open outline and one point that closes it,
 * and no other point within reach means anything -- so the cost of being
 * generous is nothing and the cost of being strict is a stray point every time
 * a hand is a few pixels out. Missing it silently added a point instead, which
 * is how an attempt at a triangle becomes a four-point blob.
 */
const CLOSING_RADIUS = 14;

function onClosingPoint(glyph: Glyph, view: GlyphView, canvasPoint: Vec2): boolean {
  const open = openOutline(glyph);
  if (!open || open.nodes.length < 3) return false;
  const first = open.nodes[0].point;
  const dx = canvasPoint.x - (view.originX + first.x * view.scale);
  const dy = canvasPoint.y - (view.originY - first.y * view.scale);
  return Math.hypot(dx, dy) <= CLOSING_RADIUS;
}

/**
 * Whether the pointer is on the point the pen last placed, and that point has
 * a handle to take off.
 *
 * The handle check is the whole of the difference from a plain node hit. A
 * click here retracts the outgoing handle so the next segment leaves straight;
 * on a point that has no handle there is nothing to retract, and reporting it
 * as a thing about to happen puts `Click again to end the curve` over a click
 * that would do nothing at all.
 */
function onLastPoint(glyph: Glyph, view: GlyphView, canvasPoint: Vec2): boolean {
  const open = openOutline(glyph);
  if (!open || open.nodes.length < 2) return false;
  const last = open.nodes[open.nodes.length - 1];
  if (!last.handleOut) return false;
  const screen = toScreen(view, last.point);
  return Math.hypot(screen.x - canvasPoint.x, screen.y - canvasPoint.y) <= HIT_RADIUS;
}

function hitTestNode(glyph: Glyph, view: GlyphView, canvasPoint: Vec2): NodeRef | null {
  for (let contourIndex = 0; contourIndex < glyph.contours.length; contourIndex++) {
    const contour = glyph.contours[contourIndex];
    for (let nodeIndex = 0; nodeIndex < contour.nodes.length; nodeIndex++) {
      const screen = toScreen(view, contour.nodes[nodeIndex].point);
      if (Math.hypot(screen.x - canvasPoint.x, screen.y - canvasPoint.y) <= HIT_RADIUS) {
        return { contour: contourIndex, node: nodeIndex };
      }
    }
  }
  return null;
}

function hitTestHandle(
  glyph: Glyph,
  view: GlyphView,
  canvasPoint: Vec2,
): { ref: NodeRef; side: "in" | "out" } | null {
  for (let contourIndex = 0; contourIndex < glyph.contours.length; contourIndex++) {
    const contour = glyph.contours[contourIndex];
    for (let nodeIndex = 0; nodeIndex < contour.nodes.length; nodeIndex++) {
      const node = contour.nodes[nodeIndex];
      for (const side of ["out", "in"] as const) {
        const handle = side === "out" ? node.handleOut : node.handleIn;
        if (!handle) continue;
        const screen = toScreen(view, handle);
        if (Math.hypot(screen.x - canvasPoint.x, screen.y - canvasPoint.y) <= HIT_RADIUS) {
          return { ref: { contour: contourIndex, node: nodeIndex }, side };
        }
      }
    }
  }
  return null;
}

/** Swing the opposite handle so a smooth node stays smooth. */
function mirrorHandle(node: GlyphNode, moved: "in" | "out"): void {
  const source = moved === "out" ? node.handleOut : node.handleIn;
  const otherKey = moved === "out" ? "handleIn" : "handleOut";
  const other = node[otherKey];
  if (!source || !other) return;
  const dx = source.x - node.point.x;
  const dy = source.y - node.point.y;
  const sourceLength = Math.hypot(dx, dy);
  if (sourceLength < 1e-6) return;
  // Keep the other handle's own length, only realign its direction.
  const otherLength = Math.hypot(other.x - node.point.x, other.y - node.point.y);
  node[otherKey] = {
    x: node.point.x - (dx / sourceLength) * otherLength,
    y: node.point.y - (dy / sourceLength) * otherLength,
  };
}

function parseNodeKey(key: string): NodeRef {
  const [contour, node] = key.split(":");
  return { contour: Number(contour), node: Number(node) };
}

/** Pen tool: append a point to the last contour, or start a new one. */
function addPoint(glyph: Glyph, view: GlyphView, canvasPoint: Vec2): void {
  const point = { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) };
  const carryOn = openOutline(glyph) !== null;
  store.startDrawing();
  store.editGlyph(glyph.name, "Add point", (editing) => {
    const contour = carryOn ? editing.contours[editing.contours.length - 1] : null;
    const node: GlyphNode = { point, handleIn: null, handleOut: null, type: "corner" };
    if (!contour || contour.closed) {
      editing.contours.push({ nodes: [node], closed: false });
    } else {
      contour.nodes.push(node);
      classifyNodes(contour.nodes);
    }
  });
}

/**
 * Which contour and segment the pointer is over, across the whole letter.
 *
 * `segmentAt` answers for one contour; a letter is several, so this asks each
 * and keeps the nearest.
 */
function segmentUnder(
  glyph: Glyph,
  view: GlyphView,
  canvasPoint: Vec2,
): { contour: number; index: number; t: number } | null {
  const at = { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) };
  const within = HIT_RADIUS / view.scale;
  for (const [contour, one] of glyph.contours.entries()) {
    const found = segmentAt(one, at, within);
    if (found) return { contour, index: found.index, t: found.t };
  }
  return null;
}

function deleteSelectedNodes(glyph: Glyph, selected: ReadonlySet<string>): void {
  /*
   * Re-fitting rather than dropping.
   *
   * Removing the nodes and leaving the rest alone is what this did, and the
   * shape jumps: the two segments each point joined become one straight line
   * between their far ends. Every editor a type designer has used re-fits, so
   * losing a point costs a little accuracy rather than the whole curve -- which
   * is the difference between an outline you can thin out and one you cannot.
   */
  store.removePoints(glyph.name, [...selected].map(parseNodeKey));
}

/**
 * Whether a point falls inside a drawn ring.
 *
 * A ray cast to the right, counting crossings: odd is in. The ring is whatever
 * the hand drew and need not be convex or even tidy -- a lasso that only
 * worked on well-behaved rings would be a rectangle with extra steps.
 */
function inside(ring: Vec2[], point: Vec2): boolean {
  let within = false;
  for (let at = 0, before = ring.length - 1; at < ring.length; before = at++) {
    const a = ring[at];
    const b = ring[before];
    // The half-open rule on y: a vertex exactly level with the ray counts for
    // the edge below it and not the one above, so a ray through a vertex is
    // counted once rather than twice or not at all.
    if (a.y > point.y !== b.y > point.y) {
      const crossing = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (point.x < crossing) within = !within;
    }
  }
  return within;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Apply an alpha to a token colour, which may be hex or a colour function. */
function withAlpha(colour: string, alpha: number): string {
  if (colour.startsWith("#")) {
    const hex = colour.slice(1);
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const value = Number.parseInt(full.slice(0, 6), 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `color-mix(in oklab, ${colour} ${Math.round(alpha * 100)}%, transparent)`;
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center text-xs-plus text-muted-foreground">
      {children}
    </div>
  );
}
