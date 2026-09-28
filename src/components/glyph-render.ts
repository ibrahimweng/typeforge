/**
 * Drawing glyphs to a canvas.
 *
 * Font units put the origin on the baseline with y increasing upward, while a
 * canvas puts it top-left with y increasing downward. Every drawing routine
 * here takes the same view description so the grid, the editor and the preview
 * strips all agree on where a glyph sits.
 */

import * as React from "react";

import { contoursBounds, contoursToPath2D } from "@/font/geometry";
import { resolveGlyphContours } from "@/font/transform";
import type { Glyph, Typeface } from "@/font/types";

export interface GlyphView {
  /** Canvas pixels per font unit. */
  scale: number;
  /** Where the glyph origin sits in canvas pixels. */
  originX: number;
  originY: number;
}

/**
 * Fit a glyph's em square into a box, leaving room around it.
 * Sizing by the em rather than by the outline keeps every cell in a grid
 * aligned, so letters read as a set instead of jumping around.
 */
export function fitEmSquare(
  typeface: Typeface,
  width: number,
  height: number,
  padding = 0.14,
): GlyphView {
  const em = typeface.unitsPerEm;
  const usable = Math.min(width, height) * (1 - padding * 2);
  const scale = usable / em;
  // Sit the baseline where the descender still fits inside the box.
  const originY = height / 2 + em * 0.35 * scale;
  return { scale, originX: width / 2, originY };
}

/**
 * Canvas backing-store scale. Capped at 2, beyond which the extra pixels cost
 * more than they show.
 */
export function deviceRatio(): number {
  return Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 2);
}

/**
 * Be told when the device pixel ratio changes.
 *
 * It changes more often than it looks: a window dragged from a laptop's
 * screen onto an external monitor, a browser zoom (which is a ratio change as
 * far as a canvas is concerned), a display's scaling changed in the system
 * settings. A canvas sized for the old ratio keeps its backing store until
 * something happens to redraw it, so the letters went soft on the move to a
 * sharper screen -- or were drawn at half size, since `applyView` reads the
 * new ratio while the store was sized for the old one -- until the next edit.
 *
 * There is no event for the ratio itself. The idiom is a media query for the
 * exact resolution in force now, which stops matching the moment it changes;
 * the query is then for a resolution that no longer holds, so it is re-armed
 * at the new one each time it fires. Answers with a subscribe function of
 * the shape `useSyncExternalStore` takes; the window is passed in so the
 * re-arming can be tested without one.
 */
export function watchDeviceRatio(
  win: Pick<Window, "matchMedia" | "devicePixelRatio"> | null,
): (onChange: () => void) => () => void {
  /*
   * One query for however many canvases are listening -- the font grid has a
   * canvas per cell -- armed when the first arrives and dropped when the last
   * goes, rather than a query each.
   */
  const listeners = new Set<() => void>();
  let query: MediaQueryList | null = null;
  const disarm = (): void => {
    query?.removeEventListener("change", fire);
    query = null;
  };
  const arm = (): void => {
    disarm();
    if (!win || typeof win.matchMedia !== "function") return;
    query = win.matchMedia(`(resolution: ${win.devicePixelRatio || 1}dppx)`);
    query.addEventListener("change", fire);
  };
  function fire(): void {
    arm();
    for (const listener of [...listeners]) listener();
  }
  return (onChange) => {
    listeners.add(onChange);
    if (listeners.size === 1) arm();
    return () => {
      listeners.delete(onChange);
      if (listeners.size === 0) disarm();
    };
  };
}

/** The page's own watch, shared by every canvas on it. */
export const subscribeDeviceRatio = watchDeviceRatio(typeof window === "undefined" ? null : window);

/**
 * The capped device pixel ratio, as state: a component that draws to a canvas
 * reads this and names it in its paint effect's dependencies, so the canvas is
 * redrawn at the new ratio when the window moves to another screen.
 */
export function useDeviceRatio(): number {
  return React.useSyncExternalStore(subscribeDeviceRatio, deviceRatio, () => 1);
}

/**
 * Put the context into font-unit space: y increases upward and the origin sits
 * on the baseline.
 *
 * setTransform replaces rather than composes, so the device pixel ratio that
 * prepareCanvas applied has to be folded back in here. Leaving it out draws
 * everything at half size on a high-resolution display.
 */
export function applyView(context: CanvasRenderingContext2D, view: GlyphView): void {
  const ratio = deviceRatio();
  context.setTransform(
    view.scale * ratio,
    0,
    0,
    -view.scale * ratio,
    view.originX * ratio,
    view.originY * ratio,
  );
}

/** Font units to canvas pixels. */
export const toCanvasX = (view: GlyphView, x: number): number => view.originX + x * view.scale;
export const toCanvasY = (view: GlyphView, y: number): number => view.originY - y * view.scale;

/** Canvas pixels back to font units, for hit testing and dragging. */
export const toFontX = (view: GlyphView, x: number): number => (x - view.originX) / view.scale;
export const toFontY = (view: GlyphView, y: number): number => (view.originY - y) / view.scale;

export interface DrawGlyphOptions {
  fill?: string;
  /** Centre the glyph on its own outline rather than on the origin. */
  centreOnOutline?: boolean;
  /**
   * The widest the outline may be drawn, in canvas pixels; wider, it is drawn
   * smaller. A grid cell is sized for the em, and a letter widened by the
   * width control -- Lora's m and w at 1.25 -- ran out of it and was cut off.
   */
  maxWidth?: number;
  offsetX?: number;
}

/**
 * The view that centres an outline spanning `xMin`..`xMax` where the view's
 * origin was, and shrinks it about the baseline to fit `maxWidth` pixels.
 */
export function placeOutline(
  view: GlyphView,
  xMin: number,
  xMax: number,
  options: { centre?: boolean; maxWidth?: number },
): GlyphView {
  let scale = view.scale;
  const span = xMax - xMin;
  if (options.maxWidth !== undefined && span * scale > options.maxWidth && span > 0)
    scale = options.maxWidth / span;
  const originX = options.centre ? view.originX - ((xMin + xMax) / 2) * scale : view.originX;
  return { scale, originX, originY: view.originY };
}

/** Fill a glyph's resolved outline. */
export function drawGlyph(
  context: CanvasRenderingContext2D,
  glyph: Glyph,
  typeface: Typeface,
  view: GlyphView,
  options: DrawGlyphOptions = {},
): void {
  const contours = resolveGlyphContours(glyph, typeface);
  if (contours.length === 0) return;

  let placed = view;
  if (options.centreOnOutline || options.maxWidth !== undefined) {
    const box = contoursBounds(contours);
    if (Number.isFinite(box.xMin) && Number.isFinite(box.xMax))
      placed = placeOutline(view, box.xMin, box.xMax, {
        centre: options.centreOnOutline,
        maxWidth: options.maxWidth,
      });
  }

  context.save();
  applyView(context, {
    ...placed,
    originX: placed.originX + (options.offsetX ?? 0) * placed.scale,
  });
  context.fillStyle = options.fill ?? readToken("--glyph-fill", "#eeeeee");
  // Non-zero winding is what font rasterisers use: it makes counters fall out
  // of the opposing contour directions automatically.
  context.fill(contoursToPath2D(contours), "nonzero");
  context.restore();
}

/**
 * Read a CSS custom property so canvas drawing follows the theme.
 *
 * `from` is what makes the ground work. Custom properties inherit, so a
 * surface that declares its own sits in a subtree where they differ from the
 * root, and a canvas inside it has to ask its own element rather than the
 * document: the glyph stage and the proof page do exactly that, and every
 * other canvas in the application -- the grid cells, the kerning band, the
 * letters in the inspector -- keeps asking the root and keeps its colours
 * whatever the ground is set to. A drawing function that already has a
 * context has the element for free, as `context.canvas`.
 */
export function readToken(name: string, fallback: string, from?: Element | null): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(from ?? document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/** Size a canvas for the device pixel ratio so outlines stay crisp. */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const ratio = deviceRatio();
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

/** A readable label for a glyph cell: the character itself where printable. */
export function glyphLabel(glyph: Glyph): string {
  const codepoint = glyph.unicodes[0];
  if (codepoint === undefined) return glyph.name;
  if (codepoint === 32) return "space";
  if (codepoint < 33) return glyph.name;
  return String.fromCodePoint(codepoint);
}

export function formatCodepoint(codepoint: number | undefined): string {
  if (codepoint === undefined) return "—";
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}
