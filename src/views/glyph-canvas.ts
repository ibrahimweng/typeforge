import { contourSegments, contoursToPath2D } from "@/font/geometry";
import { boxOf, shapeFrom } from "@/font/shapes";
import type { Anchor, Contour, Glyph, Typeface, Vec2 } from "@/font/types";
import { extremesMissing, nearlySmooth } from "@/font/marks";
import { applyView, readToken, toFontX, toFontY, type GlyphView } from "@/components/glyph-render";
import { nodeKey } from "@/state/useStore";

/** How close a click has to land, in screen pixels, to grab a node. */
import {
  CLOSING_RADIUS,
  HIT_RADIUS,
  openOutline,
  toScreen,
  type Drag,
  type Hover,
} from "./glyph-pointer";

export const NODE_SIZE = 3.5;

/** Apply an alpha to a token colour, which may be hex or a colour function. */
export function withAlpha(colour: string, alpha: number): string {
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

export function drawMetrics(
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

export function drawContours(
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

export function drawNodes(
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
export function drawAnchors(
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

/**
 * The ring that marks what a click would grab.
 *
 * Drawn, not animated: this follows the pointer, so any easing would leave it
 * trailing behind the thing it is meant to be pointing at.
 */
export function drawHoverRing(
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

export function drawMarquee(
  context: CanvasRenderingContext2D,
  drag: Extract<Drag, { kind: "marquee" }>,
): void {
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
export function drawShapePreview(
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
export function drawPenReach(
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
export function drawPathOutline(
  context: CanvasRenderingContext2D,
  contour: Contour | undefined,
  view: GlyphView,
): void {
  if (!contour || contour.nodes.length < 2) return;
  const to = (v: Vec2) => ({
    x: view.originX + v.x * view.scale,
    y: view.originY - v.y * view.scale,
  });

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

export function drawSegmentUnder(
  context: CanvasRenderingContext2D,
  contour: Contour | undefined,
  index: number,
  view: GlyphView,
): void {
  const a = contour?.nodes[index];
  const b = contour?.nodes[(index + 1) % contour.nodes.length];
  if (!a || !b) return;

  const to = (v: Vec2) => ({
    x: view.originX + v.x * view.scale,
    y: view.originY - v.y * view.scale,
  });
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
export function drawMarks(
  context: CanvasRenderingContext2D,
  contours: Contour[],
  view: GlyphView,
): void {
  const colour = readToken("--attention", "#ea733a", context.canvas);
  const to = (v: Vec2) => ({
    x: view.originX + v.x * view.scale,
    y: view.originY - v.y * view.scale,
  });

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
export function drawLasso(
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

export function drawFreehandPreview(
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
export function drawKnifePreview(
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
