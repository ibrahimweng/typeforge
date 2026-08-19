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

import { contourSegments, contoursToPath2D } from "@/font/geometry";
import { classifyNodes } from "@/font/quadratic";
import { resolveGlyphContours } from "@/font/transform";
import type { Contour, Glyph, GlyphNode, Typeface, Vec2 } from "@/font/types";
import { prepareCanvas, readToken, toFontX, toFontY, type GlyphView } from "@/components/glyph-render";
import { nodeKey, store, useAppState, type NodeRef } from "@/state/useStore";

/** How close a click has to land, in screen pixels, to grab a node. */
const HIT_RADIUS = 7;
const NODE_SIZE = 3.5;

type Drag =
  | { kind: "node"; refs: NodeRef[]; start: Vec2; before: Glyph }
  | { kind: "handle"; ref: NodeRef; side: "in" | "out"; before: Glyph }
  | { kind: "marquee"; from: Vec2; to: Vec2; additive: boolean }
  | { kind: "pan"; from: Vec2; startPan: Vec2 };

export function GlyphEditorView(): React.JSX.Element {
  const state = useAppState();
  const typeface = state.typeface;
  const glyph = store.glyph(state.selectedGlyph);

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 800, height: 600 });
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState<Vec2>({ x: 0, y: 0 });
  const dragRef = React.useRef<Drag | null>(null);
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

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

  // --- drawing ----------------------------------------------------------

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !typeface) return;
    const context = prepareCanvas(canvas, size.width, size.height);
    if (!context) return;

    drawMetrics(context, typeface, glyph, view, size);
    if (!glyph) return;

    // Where parameters change the shape, show the result behind the outline
    // being edited so the effect of the family settings stays visible.
    const resolved = resolveGlyphContours(glyph, typeface);
    if (resolved !== glyph.contours) {
      drawContours(context, resolved, view, {
        fill: withAlpha(readToken("--accent", "#0c8ce9"), 0.22),
      });
    }
    drawContours(context, glyph.contours, view, {
      fill: withAlpha(readToken("--glyph-fill", "#eeeeee"), resolved !== glyph.contours ? 0.5 : 0.92),
    });
    drawNodes(context, glyph.contours, view, state.selectedNodes);

    const drag = dragRef.current;
    if (drag?.kind === "marquee") drawMarquee(context, drag);
  }, [typeface, glyph, view, size, state.selectedNodes, state.revision]);

  // --- interaction ------------------------------------------------------

  const pointerPosition = (event: React.PointerEvent): Vec2 => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!glyph || !typeface) return;
    const canvasPoint = pointerPosition(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    // Middle button, or space held, pans the view.
    if (event.button === 1 || event.shiftKey === false && event.altKey) {
      dragRef.current = { kind: "pan", from: canvasPoint, startPan: pan };
      return;
    }

    if (state.tool === "pen") {
      addPoint(glyph, view, canvasPoint);
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

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (!drag || !glyph) return;
    const canvasPoint = pointerPosition(event);

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
      case "marquee": {
        drag.to = canvasPoint;
        forceRender();
        break;
      }
    }
  };

  const handlePointerUp = (): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !glyph) return;

    if (drag.kind === "node") {
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
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden bg-[var(--canvas)]">
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height }}
        className={state.tool === "pen" ? "cursor-crosshair" : "cursor-default"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
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
        <span>{glyph.name}</span>
        <span>{Math.round(zoom * 100)}%</span>
        {state.selectedNodes.size > 0 && <span>{state.selectedNodes.size} points</span>}
      </div>
    </div>
  );
}

// --- drawing ------------------------------------------------------------

function drawMetrics(
  context: CanvasRenderingContext2D,
  typeface: Typeface,
  glyph: Glyph | null,
  view: GlyphView,
  size: { width: number; height: number },
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
  // prepareCanvas already scaled the context for the device pixel ratio, and
  // setTransform replaces rather than composes, so fold that ratio back in here.
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  context.setTransform(
    view.scale * ratio,
    0,
    0,
    -view.scale * ratio,
    view.originX * ratio,
    view.originY * ratio,
  );
  context.fillStyle = options.fill;
  context.fill(contoursToPath2D(contours), "nonzero");
  context.restore();
}

function drawNodes(
  context: CanvasRenderingContext2D,
  contours: Contour[],
  view: GlyphView,
  selected: ReadonlySet<string>,
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
    });
  });
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
