import { contourSegments, contoursToPath2D } from "@/font/geometry";
import { boxOf, shapeFrom } from "@/font/shapes";
import type { Anchor, Contour, Glyph, Typeface, Vec2 } from "@/font/types";
import { extremesMissing, nearlySmooth } from "@/font/marks";
import { applyView, readToken, toFontX, toFontY, type GlyphView } from "@/components/glyph-render";
import { nodeKey } from "@/state/useStore";

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
/**
 * What a browser makes of a colour string, as `r, g, b`, or null if it will
 * not take it at all.
 *
 * Asked of a canvas rather than worked out here, because the colours in this
 * application arrive as whatever the stylesheet says -- `oklch` for most of
 * them, hex for a few -- and writing a converter for each syntax is writing a
 * colour library nobody asked for. Painting one pixel and reading it back is
 * the browser's own answer.
 *
 * The two sentinels are how a refusal is told from a colour. Assigning a
 * `fillStyle` a canvas cannot parse is ignored in silence: no throw, no
 * warning, the old value simply stays. So the colour is set over two different
 * sentinels, and only a colour that leaves both of them standing was refused
 * -- one that happens to equal a sentinel cannot equal the other.
 *
 * Cached because this runs inside a paint. The answer for a given string never
 * changes, and `getImageData` is far too expensive to ask sixty times a second
 * for a colour that has not moved.
 */
const RESOLVED = new Map<string, string | null>();

function rgbOf(colour: string): string | null {
  const known = RESOLVED.get(colour);
  if (known !== undefined) return known;
  /*
   * Nothing is remembered until a canvas has actually answered.
   *
   * Caching "could not" from a call made before there is a document -- an
   * early paint, a worker, a test -- would settle that colour on the fallback
   * for the life of the page, and it would never be asked again once a browser
   * was there to answer. Only a real refusal by a real canvas is worth
   * remembering.
   */
  // `typeof` first and separately: `document?.x` still evaluates `document`,
  // which throws outright where the name was never declared at all.
  if (typeof document === "undefined") return null;
  if (typeof document.createElement !== "function") return null;
  /*
   * Wrapped, because this is called from inside a paint and the alternative to
   * a null is a frame that does not happen. Everything in here is capable of
   * throwing somewhere -- a canvas the browser will not give a context for,
   * a `getImageData` refused on a tainted or zero-sized surface, a stripped
   * down `document` in a test -- and none of that is worth a blank letter when
   * the honest answer is "ask for the mix instead".
   */
  try {
    const scratch = document.createElement("canvas");
    scratch.width = 1;
    scratch.height = 1;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = "#ff00ff";
    context.fillStyle = colour;
    const first = context.fillStyle;
    context.fillStyle = "#00ff00";
    context.fillStyle = colour;
    if (first === "#ff00ff" && context.fillStyle === "#00ff00") {
      // A refusal by a real canvas is stable, so this one is worth keeping.
      RESOLVED.set(colour, null);
      return null;
    }
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    const answer = `${r}, ${g}, ${b}`;
    RESOLVED.set(colour, answer);
    return answer;
  } catch {
    return null;
  }
}

/**
 * A colour with an alpha on it, in a form a canvas will actually take.
 *
 * `rgba` wherever it can be reached, and that preference is the whole point.
 * CSS and canvas do not parse the same set of colours: a stylesheet has taken
 * `color-mix` for years, and a canvas is a narrower surface that has taken it
 * for rather less time. Handing a canvas a colour it does not know is not an
 * error -- the assignment is dropped without a word and the last colour keeps
 * being used -- so the failure arrives as a shape drawn in the wrong colour,
 * or in no visible colour at all, with nothing anywhere saying why.
 *
 * Nothing here has been seen to fail. It is written this way because the way
 * it would fail is silent, and a silent failure on the one surface this
 * application is made of is worth spending a cached pixel to rule out.
 *
 * `color-mix` is still the last resort rather than being removed. Where there
 * is no document to ask -- a unit test, a worker -- it is what this always
 * did, so this can only widen what works and never narrow it.
 */
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
  const rgb = rgbOf(colour);
  if (rgb) return `rgba(${rgb}, ${alpha})`;
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

/** How long a point flashes for after a shape sweeps over it, in ms. */
const A_FLASH = 260;

export function drawNodes(
  context: CanvasRenderingContext2D,
  contours: Contour[],
  view: GlyphView,
  selected: ReadonlySet<string>,
  hover: Hover,
  /*
   * What a shape being dragged has hold of right now, or nothing when no
   * shape is being dragged.
   *
   * These are drawn as selected, because that is what they are about to be,
   * and each flashes once as it is taken. The flash is what makes a fast sweep
   * legible: a point that changes colour between two frames is a point nobody
   * saw change, and the whole complaint this answers is not being able to tell
   * what a drag is picking up while it is picking it up.
   */
  catching?: { keys: ReadonlySet<string>; since: ReadonlyMap<string, number> } | null,
  now = 0,
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
      const caught = catching?.keys.has(key) ?? false;
      // Held by the shape counts as selected: the drag is a preview of the
      // selection it is about to make, so it shows the selection it will make.
      const isSelected = caught || selected.has(key);
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

      /*
       * And the flash, over the point rather than instead of it: a ring that
       * grows out and fades, so the eye catches the moment even if it was not
       * looking there. Drawn from when the point was taken rather than from a
       * frame count, so a sweep that pauses does not leave a ring hanging.
       */
      if (caught) {
        const age = now - (catching?.since.get(key) ?? now);
        if (age >= 0 && age < A_FLASH) {
          const along = age / A_FLASH;
          context.save();
          context.strokeStyle = withAlpha(selectedColour, 0.9 * (1 - along));
          context.lineWidth = 1.5;
          context.beginPath();
          context.arc(point.x, point.y, NODE_SIZE + 2 + along * 9, 0, Math.PI * 2);
          context.stroke();
          context.restore();
        }
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

/**
 * How far along the dashes have crawled, from the clock.
 *
 * Marching ants: the dashes travel round the shape while it is being dragged.
 * A still outline is a picture of a selection, and a crawling one is a
 * selection being made -- which is the difference somebody is looking for when
 * they are halfway through a sweep and unsure whether the tool heard them.
 *
 * Off the wall clock rather than a frame counter, so every repaint draws the
 * phase the moment deserves however it came to be repainted -- a pointer move,
 * an edit, or the loop that keeps this going while a hand is still.
 *
 * Negative, because a dash offset counted up runs the ants backwards.
 */
const ANTS = [4, 3];
function antsAt(now: number): number {
  const period = ANTS[0] + ANTS[1];
  return -((now / 60) % period);
}

export function drawMarquee(
  context: CanvasRenderingContext2D,
  drag: Extract<Drag, { kind: "marquee" }>,
  now: number,
): void {
  const accent = readToken("--accent", "#0c8ce9", context.canvas);
  context.save();
  context.fillStyle = withAlpha(accent, 0.12);
  const x = Math.min(drag.from.x, drag.to.x);
  const y = Math.min(drag.from.y, drag.to.y);
  const width = Math.abs(drag.to.x - drag.from.x);
  const height = Math.abs(drag.to.y - drag.from.y);
  context.fillRect(x, y, width, height);

  /*
   * Two strokes, dark under light, so the ants read on a black letter and on
   * a white ground alike. One colour cannot: a dashed accent line over a
   * filled stem is accent on near-accent, and the marching is what gets lost
   * first.
   */
  context.lineWidth = 1;
  context.strokeStyle = withAlpha(readToken("--background", "#000", context.canvas), 0.7);
  context.strokeRect(x + 0.5, y + 0.5, width, height);
  context.setLineDash(ANTS);
  context.lineDashOffset = antsAt(now);
  context.strokeStyle = accent;
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
  /*
   * Off the canvas, like every other colour here, and it was not.
   *
   * `readToken` reads a custom property off whatever element it is handed, and
   * the ground is set on an ancestor of the canvas rather than on the document.
   * This one call was handed nothing, so it read the root's value while the two
   * marks drawn beside it -- the closing ring below, and the segment highlight
   * in `drawSegmentUnder` -- read the canvas's. On the light ground that is the
   * chrome purple over a near-white canvas, which is the pale wash `styles.css`
   * darkens `--inspect` to avoid: a mark you have to hunt for, and the only one
   * of the pen's three you had to.
   *
   * Its fallback disagreed too -- a blue where the other two are purple -- so
   * with the property missing the three would have been two colours as well.
   */
  context.strokeStyle = readToken("--inspect", "#9149f5", context.canvas);
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
  now: number,
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
  // Dark under light, and marching, on the same terms as the box above.
  context.lineWidth = 1;
  context.strokeStyle = withAlpha(readToken("--background", "#000", context.canvas), 0.7);
  context.stroke();
  context.setLineDash(ANTS);
  context.lineDashOffset = antsAt(now);
  context.strokeStyle = colour;
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

/**
 * The box round what is selected, with the handles that reshape it.
 *
 * Drawn in screen pixels rather than font units, for the reason the hit test
 * is: a handle is something a pointer lands on, and a pointer is the same size
 * whatever the zoom. Sized in font units these would be specks at 100% and
 * would cover the letter at 800%.
 *
 * The box is dashed and the handles are solid. That is not decoration: the
 * outline of the box is a thing to look through, since the letter is behind
 * it, and the handles are things to aim at.
 */
export function drawTransformBox(
  context: CanvasRenderingContext2D,
  box: { left: number; right: number; bottom: number; top: number },
  view: GlyphView,
  within: { grip: string | null; quad: Vec2[] | null },
): void {
  const accent = readToken("--accent", "#0c8ce9", context.canvas);
  const corners = [
    { x: box.left, y: box.bottom },
    { x: box.right, y: box.bottom },
    { x: box.right, y: box.top },
    { x: box.left, y: box.top },
  ];
  /*
   * The quad, when a corner is being pulled: the box as it will be rather than
   * as it was. Without it a distort would drag the letter and leave the box
   * behind, so the one thing on screen saying what is happening would be the
   * one thing not doing it.
   */
  const outline = (within.quad ?? corners).map((point) => toScreen(view, point));

  context.save();
  context.strokeStyle = withAlpha(accent, 0.9);
  context.lineWidth = 1;
  context.setLineDash([4, 3]);
  context.beginPath();
  for (const [at, point] of outline.entries()) {
    if (at === 0) context.moveTo(point.x + 0.5, point.y + 0.5);
    else context.lineTo(point.x + 0.5, point.y + 0.5);
  }
  context.closePath();
  context.stroke();
  context.setLineDash([]);

  const middles = [
    { x: (box.left + box.right) / 2, y: box.bottom, name: "bottom" },
    { x: box.right, y: (box.bottom + box.top) / 2, name: "right" },
    { x: (box.left + box.right) / 2, y: box.top, name: "top" },
    { x: box.left, y: (box.bottom + box.top) / 2, name: "left" },
  ];
  const named = ["bottomLeft", "bottomRight", "topRight", "topLeft"];

  context.lineWidth = 1;
  for (const [at, point] of corners.entries()) {
    handle(context, toScreen(view, point), accent, within.grip === named[at]);
  }
  for (const point of middles) {
    handle(context, toScreen(view, point), accent, within.grip === point.name);
  }
  context.restore();
}

/** One handle: a small square, filled when the pointer is on it. */
function handle(context: CanvasRenderingContext2D, at: Vec2, colour: string, lit: boolean): void {
  const size = lit ? 8 : 6;
  context.beginPath();
  context.rect(Math.round(at.x) - size / 2 + 0.5, Math.round(at.y) - size / 2 + 0.5, size, size);
  // Filled with the ground rather than left transparent, so a handle sitting
  // over a black stem is still a square rather than a smudge.
  context.fillStyle = lit ? colour : readToken("--canvas", "#000", context.canvas);
  context.fill();
  context.strokeStyle = colour;
  context.stroke();
}

/**
 * How many points the shape has hold of, beside the pointer.
 *
 * The highlights say which; this says how many, which is the question a dense
 * outline cannot answer by eye -- at two hundred points the lit ones overlap
 * and counting them is not something anybody does mid-drag.
 *
 * It follows the corner being dragged rather than sitting somewhere fixed,
 * because that is where the eye already is. Offset up and left of the pointer
 * so the cursor never covers it, and flipped back over the shape when the drag
 * has run out to the edge of the canvas.
 */
export function drawCaughtCount(context: CanvasRenderingContext2D, at: Vec2, many: number): void {
  const label = `${many} ${many === 1 ? "point" : "points"}`;
  context.save();
  context.font = "11px ui-monospace, monospace";
  context.textBaseline = "middle";
  const width = context.measureText(label).width + 10;
  const height = 18;
  // Away from the pointer, and back the other way when there is no room.
  let x = at.x + 14;
  let y = at.y - 22;
  if (x + width > context.canvas.width) x = at.x - 14 - width;
  if (y < height) y = at.y + 22;

  context.fillStyle = withAlpha(readToken("--background", "#000", context.canvas), 0.85);
  context.strokeStyle = withAlpha(readToken("--accent", "#0c8ce9", context.canvas), 0.6);
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(x, y - height / 2, width, height, 4);
  context.fill();
  context.stroke();

  context.fillStyle = readToken("--foreground", "#fff", context.canvas);
  context.fillText(label, x + 5, y);
  context.restore();
}
