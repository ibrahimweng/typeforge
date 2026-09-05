/**
 * What the pointer is doing to a letter.
 *
 * Three questions with three different answers, and the file used to interleave
 * them with the painting, the framing and the markup of the view they belong
 * to. Pressing down asks which tool is in hand -- fourteen of them, each
 * starting something different. Moving and letting go ask what kind of drag is
 * running, which is not the same question: half a dozen tools begin a `shape`
 * and one `case "shape"` finishes all of them. `Drag` in `glyph-pointer.ts` is
 * where the two meet, and its comments are the argument for each kind.
 *
 * Almost everything here is private to the gesture. The view needs the five
 * handlers to wire up, and the painter needs to know what is hovered and what
 * is being dragged so it can draw it; the hit tests, the phase reporting and
 * the modifier tracking are nobody else's business and used to be in scope for
 * the whole component.
 *
 * Three staleness bugs have been fixed in this code and all three had the same
 * shape: a handler built on one render reading state from that render, and
 * running after it. That is what the refs are for, and why the ones that pair a
 * ref with state are written through `noteAt` rather than separately.
 */

import * as React from "react";

import { boxOf } from "@/font/shapes";
import { linesFor, snapPoint } from "@/font/snap";
import type { AppState } from "@/state/useStore";
import type { Glyph, Typeface, Vec2 } from "@/font/types";
import { A_DRAG, draggedPoint } from "@/font/pen";
import { CLOSES_WITHIN, NOTHING_UNDER, toolStateFor, type Doing, type Under } from "@/font/tools";
import { toCanvasX, toCanvasY, toFontX, toFontY, type GlyphView } from "@/components/glyph-render";
import { nodeKey, store } from "@/state/useStore";
import { hitTestPen, hitTestStrokePoint, penDrag } from "./write-canvas";
import { addPoint, mirrorHandle } from "./glyph-edits";
import {
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

/**
 * How near a line has to be, in screen pixels, before a drag lands on it.
 *
 * In pixels rather than in font units so it feels the same at every zoom:
 * six units is a strong pull at a hundred per cent and nothing at all at
 * eight hundred, which is exactly where somebody is placing a point by eye
 * and least wants to be argued with.
 */
const SNAP_REACH = 6;

/** Everything the gesture hands back, and nothing it keeps to itself. */
export interface Gestures {
  /** What is under the pointer, for the painter to light up. */
  hover: Hover;
  /** Where the pointer is, for the tools that draw to it from their last point. */
  at: Vec2 | null;
  /** The gesture in flight, read live by the painter rather than per render. */
  drag: React.RefObject<Drag | null>;
  /** The modifiers as of the last move, which a pointer-up cannot be asked for. */
  modifiers: React.RefObject<{ square: boolean; fromCentre: boolean }>;
  /** Repaint after an edit React cannot see, for whoever else makes one. */
  redraw: () => void;
  /** Say what the tool would do now, after a change this file did not make. */
  refreshPhase: () => void;
  on: {
    pointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    pointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    pointerUp: () => void;
    pointerLeave: () => void;
    doubleClick: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  };
}

export function useGlyphGestures(within: {
  typeface: Typeface | null;
  glyph: Glyph | null;
  state: AppState;
  view: GlyphView;
  pan: Vec2;
  setPan: React.Dispatch<React.SetStateAction<Vec2>>;
}): Gestures {
  const { typeface, glyph, state, view, pan, setPan } = within;

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

    /*
     * A switch rather than a chain of `else if`, so a sixteenth kind of drag is
     * a compile error here rather than a gesture that quietly never commits.
     */
    switch (drag.kind) {
      case "anchor": {
        const moved = glyph.anchors.find((anchor) => anchor.name === drag.name);
        if (moved) {
          const settled = { ...moved };
          glyph.anchors = drag.before.map((anchor) => ({ ...anchor }));
          store.setAnchor(glyph.name, drag.name, settled.x, settled.y);
        }
        break;
      }
      case "node": {
        store.commitGlyphEdit(glyph.name, "Move points", drag.before);
        break;
      }
      case "handle": {
        store.commitGlyphEdit(glyph.name, "Shape curve", drag.before);
        break;
      }
      case "pen": {
        // Only if it was actually a pull: a plain click placed its point through
        // `addPoint`, which recorded itself, and a second entry for a gesture
        // that changed nothing more is an undo press that appears to do nothing.
        if (drag.pulled) store.commitGlyphEdit(glyph.name, "Draw a curve", drag.before);
        break;
      }
      case "writePull": {
        // Only if it was a pull. A plain click already recorded its own point,
        // and a second entry for a gesture that added nothing is an undo press
        // that appears to do nothing.
        if (drag.node > 0) store.commitGlyphEdit(glyph.name, "Write a curve", drag.before);
        break;
      }
      case "penHandle": {
        store.commitGlyphEdit(glyph.name, "Change the pen", drag.before);
        break;
      }
      case "strokePoint": {
        store.commitGlyphEdit(glyph.name, "Move the stroke", drag.before);
        break;
      }
      case "writeTrail": {
        store.writeTrail(glyph.name, drag.trail);
        break;
      }
      case "marquee": {
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
        break;
      }
      case "shape": {
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
        break;
      }
      case "freehand": {
        if (!store.addStroke(glyph.name, drag.trail)) {
          store.say("That was a click rather than a stroke. Drag to draw.", "error");
        }
        forceRender();
        break;
      }
      case "knife": {
        store.cutGlyph(
          glyph.name,
          { x: toFontX(view, drag.from.x), y: toFontY(view, drag.from.y) },
          { x: toFontX(view, drag.to.x), y: toFontY(view, drag.to.y) },
        );
        forceRender();
        break;
      }
      case "lasso": {
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
        break;
      }
      /*
       * The two that change nothing about the letter, and so have nothing to
       * put in the history. Said rather than left out: an absence here reads
       * the same whether it is a decision or an oversight, and an oversight is
       * an edit that is silently never committed.
       */
      case "pan":
      case "guide":
        break;
      /*
       * And the guard that makes the switch worth having.
       *
       * With every kind named above, `drag` is `never` here. Add a sixteenth
       * and this stops compiling, which is the whole point: the failure it
       * replaces is a drag that runs, changes the letter, and is never written
       * to the history -- so the edit is on screen, undo does not know about
       * it, and the next save writes it down as though it had always been
       * there.
       */
      default: {
        const unhandled: never = drag;
        throw new Error(`a drag nobody releases: ${JSON.stringify(unhandled)}`);
      }
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

  /*
   * The pointer has left the canvas, so nothing is under it any more.
   *
   * The tool is still in hand, so it still has something to say. This blanked
   * the sentence outright, which meant that reaching for a tool -- a move that
   * necessarily leaves the canvas -- left the line empty, and it only came back
   * when the pointer returned. The state to report is "this tool, with nothing
   * under it", which is exactly what the tool would do the moment you came
   * back.
   */
  const handlePointerLeave = (): void => {
    setHover(null);
    noteAt(null);
    reportPhase(null);
  };

  /*
   * Stable, so the keyboard effect can be bound once and still report the phase
   * of the tool that is in hand rather than the one that was in hand when it
   * was bound. `reportPhaseRef` above is the whole of why.
   *
   * Declared here rather than inside the object below: a hook call buried in a
   * return literal is one conditional return away from being a hook that does
   * not always run, and nothing about reading it says so.
   */
  const refreshPhase = React.useCallback(() => reportPhaseRef.current(atRef.current), []);

  return {
    hover,
    at,
    drag: dragRef,
    modifiers: modifiersRef,
    redraw: forceRender,
    refreshPhase,
    on: {
      pointerDown: handlePointerDown,
      pointerMove: handlePointerMove,
      pointerUp: handlePointerUp,
      pointerLeave: handlePointerLeave,
      doubleClick: handleDoubleClick,
    },
  };
}
