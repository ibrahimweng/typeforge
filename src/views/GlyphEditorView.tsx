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
import { resolveComponents } from "@/font/composite";
import { resolveAdvanceWidth, resolveGlyphContours } from "@/font/transform";
import type { Anchor, Contour, Glyph, GlyphNode, Typeface, Vec2 } from "@/font/types";
import {
  applyView,
  prepareCanvas,
  readToken,
  toFontX,
  toFontY,
  type GlyphView,
} from "@/components/glyph-render";
import { nodeKey, store, useAppState, type NodeRef } from "@/state/useStore";
import { CoachMark } from "@/components/CoachMark";
import { NumberField } from "@/components/NumberField";

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

type Drag =
  | { kind: "node"; refs: NodeRef[]; start: Vec2; before: Glyph }
  | { kind: "handle"; ref: NodeRef; side: "in" | "out"; before: Glyph }
  | { kind: "marquee"; from: Vec2; to: Vec2; additive: boolean }
  | { kind: "anchor"; name: string; before: Anchor[] }
  | { kind: "pan"; from: Vec2; startPan: Vec2 }
  | { kind: "guide"; index: number };

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
  const [hover, setHover] = React.useState<Hover>(null);
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
    const asideFill = withAlpha(readToken("--glyph-fill", "#eeeeee"), 0.28);
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
        fill: withAlpha(readToken("--inspect", "#9149f5"), 0.4),
      });
    }

    const resolved = resolveGlyphContours(glyph, typeface);
    if (resolved !== composed) {
      drawContours(context, resolved, view, {
        fill: withAlpha(readToken("--accent", "#0c8ce9"), 0.22),
      });
    }
    drawContours(context, glyph.contours, view, {
      fill: withAlpha(readToken("--glyph-fill", "#eeeeee"), resolved !== composed ? 0.5 : 0.92),
    });
    drawNodes(context, glyph.contours, view, state.selectedNodes, hover);
    drawAnchors(context, glyph.anchors, view, hover);

    const drag = dragRef.current;
    if (drag?.kind === "marquee") drawMarquee(context, drag);
  }, [typeface, glyph, view, size, state.selectedNodes, state.revision, hover, neighbours, state.guides]);


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
    const onGuide = guideAt(state.guides, view, canvasPoint.y);
    if (onGuide !== null) {
      dragRef.current = { kind: "guide", index: onGuide };
      return;
    }

    if (state.tool === "pen") {
      addPoint(glyph, view, canvasPoint);
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
      if (before) dragRef.current = { kind: "handle", ref: handleHit.ref, side: handleHit.side, before };
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
  const updateHover = (canvasPoint: Vec2): void => {
    if (!glyph || state.tool === "pen") {
      setHover((current) => (current === null ? current : null));
      return;
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
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (!drag) {
      updateHover(pointerPosition(event));
      return;
    }
    const canvasPoint = pointerPosition(event);

    /*
     * A guide moves without a glyph, and before the glyph guard below.
     *
     * Guides belong to the font rather than to a letter, so dragging one has to
     * work on a glyph with no outlines at all -- which is where somebody
     * setting up their lines before drawing anything would be standing.
     */
    if (drag.kind === "guide") {
      store.moveGuide(drag.index, (view.originY - canvasPoint.y) / view.scale);
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
        if (event.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
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
        const target = { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) };
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
      case "marquee": {
        drag.to = canvasPoint;
        forceRender();
        break;
      }
    }
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
    const index = guideAt(state.guides, view, pointerPosition(event).y);
    if (index !== null) store.removeGuide(index);
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
    }
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
        <span className="pl-1 text-muted-foreground">
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
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => store.addGuide(typeface.metrics.xHeight)}
            data-add-guide
            title="Put a guide across the canvas, then drag it where you want it"
            className="rounded border border-border px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            Add a guide
          </button>
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
      <div ref={measure} className="relative min-h-0 flex-1 overflow-hidden bg-[var(--canvas)]">
        <canvas
          ref={canvasRef}
          style={{ width: size.width, height: size.height }}
          className={cursorFor(state.tool, hover)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          onPointerLeave={() => setHover(null)}
          onWheel={(event) => {
            // Ctrl or command with the wheel zooms, matching every design tool.
            if (event.ctrlKey || event.metaKey) {
              setZoom((current) => clamp(current * (event.deltaY < 0 ? 1.1 : 0.9), 0.1, 24));
            } else {
              setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
            }
          }}
        />
        <div className="pointer-events-none absolute bottom-3 left-3 flex gap-3 text-2xs text-muted-foreground tabular-nums">
          <span>{Math.round(zoom * 100)}%</span>
          {state.selectedNodes.size > 1 && <span>{state.selectedNodes.size} points</span>}
        </div>
      </div>
      <Numbers glyph={glyph} typeface={typeface} selected={state.selectedNodes} />
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
}: {
  glyph: Glyph;
  typeface: Typeface;
  selected: ReadonlySet<string>;
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
        <span className="opacity-70">
          {selected.size === 0
            ? "Select one point to type its position."
            : `${selected.size} points selected — one at a time can be typed.`}
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
  guides: ReadonlyArray<{ y: number }>,
  view: GlyphView,
  canvasY: number,
): number | null {
  for (let index = guides.length - 1; index >= 0; index--) {
    const y = view.originY - guides[index].y * view.scale;
    if (Math.abs(y - canvasY) <= 4) return index;
  }
  return null;
}

/**
 * The cursor says whether there is something to grab before you press.
 *
 * Without this the canvas looks identical whether the pointer is over a point
 * or over empty space, so the only way to find out is to click and see.
 */
function cursorFor(tool: string, hover: Hover): string {
  if (tool === "pen") return "cursor-crosshair";
  return hover ? "cursor-grab" : "cursor-default";
}

// --- drawing ------------------------------------------------------------

function drawMetrics(
  context: CanvasRenderingContext2D,
  typeface: Typeface,
  glyph: Glyph | null,
  view: GlyphView,
  size: { width: number; height: number },
  guides: ReadonlyArray<{ y: number }> = [],
): void {
  const metricColour = readToken("--guide-metric", "#5a6070");
  const baselineColour = readToken("--guide-baseline", "#d24b3a");
  const sidebearingColour = readToken("--guide-sidebearing", "#3f8fa8");

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
  const guideColour = readToken("--accent", "#0c8ce9");
  context.setLineDash([5, 4]);
  for (const guide of guides) {
    const y = Math.round(view.originY - guide.y * view.scale) + 0.5;
    if (y < -2 || y > size.height + 2) continue;
    context.strokeStyle = withAlpha(guideColour, 0.75);
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(size.width, y);
    context.stroke();
    context.fillStyle = withAlpha(guideColour, 0.9);
    context.fillText(String(guide.y), size.width - 46, y - 4);
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
  const onCurve = readToken("--node-on-curve", "#0c8ce9");
  const offCurve = readToken("--node-off-curve", "#9aa0ad");
  const selectedColour = readToken("--node-selected", "#f5a524");

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
  const colour = readToken("--inspect", "#9149f5");

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
  const accent = readToken("--accent", "#0c8ce9");
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

// --- geometry helpers ---------------------------------------------------

const toScreen = (view: GlyphView, point: Vec2): Vec2 => ({
  x: view.originX + point.x * view.scale,
  y: view.originY - point.y * view.scale,
});

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
  store.editGlyph(glyph.name, "Add point", (editing) => {
    const contour = editing.contours[editing.contours.length - 1];
    const node: GlyphNode = { point, handleIn: null, handleOut: null, type: "corner" };
    if (!contour || contour.closed) {
      editing.contours.push({ nodes: [node], closed: false });
    } else {
      contour.nodes.push(node);
      classifyNodes(contour.nodes);
    }
  });
}

function deleteSelectedNodes(glyph: Glyph, selected: ReadonlySet<string>): void {
  const refs = [...selected].map(parseNodeKey);
  store.editGlyph(glyph.name, "Delete points", (editing) => {
    // Remove from the end of each contour so earlier indices stay valid.
    const byContour = new Map<number, number[]>();
    for (const ref of refs) {
      const list = byContour.get(ref.contour) ?? [];
      list.push(ref.node);
      byContour.set(ref.contour, list);
    }
    for (const [contourIndex, nodeIndices] of byContour) {
      const contour = editing.contours[contourIndex];
      if (!contour) continue;
      for (const nodeIndex of nodeIndices.sort((a, b) => b - a)) {
        contour.nodes.splice(nodeIndex, 1);
      }
    }
    editing.contours = editing.contours.filter((contour) => contour.nodes.length > 1);
  });
  store.setSelectedNodes([]);
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
