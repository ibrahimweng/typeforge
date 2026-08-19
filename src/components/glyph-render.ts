/**
 * Drawing glyphs to a canvas.
 *
 * Font units put the origin on the baseline with y increasing upward, while a
 * canvas puts it top-left with y increasing downward. Every drawing routine
 * here takes the same view description so the grid, the editor and the preview
 * strips all agree on where a glyph sits.
 */

import { contoursToPath2D } from "@/font/geometry";
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
  const originY = height / 2 + (em * 0.35) * scale;
  return { scale, originX: width / 2, originY };
}

export function applyView(context: CanvasRenderingContext2D, view: GlyphView): void {
  context.setTransform(view.scale, 0, 0, -view.scale, view.originX, view.originY);
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
  offsetX?: number;
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

  context.save();
  context.translate((options.offsetX ?? 0) * view.scale, 0);
  applyView(context, {
    ...view,
    originX: view.originX + (options.offsetX ?? 0) * view.scale,
  });
  context.fillStyle = options.fill ?? readToken("--glyph-fill", "#eeeeee");
  // Non-zero winding is what font rasterisers use: it makes counters fall out
  // of the opposing contour directions automatically.
  context.fill(contoursToPath2D(contours), "nonzero");
  context.restore();
}

/** Read a CSS custom property so canvas drawing follows the theme. */
export function readToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Size a canvas for the device pixel ratio so outlines stay crisp. */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
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
