/**
 * Pixel fonts.
 *
 * Quantising a letter to a grid: work out which cells the outline covers, then
 * redraw the letter as those cells. The result is still an ordinary outline
 * font, made of right angles.
 *
 * Two decisions carry most of the quality.
 *
 * The grid is pinned to the em square rather than to each glyph's own bounding
 * box. Letters have to sit on the same grid as each other or their stems land
 * on different sub-pixel offsets, and a word set in the result comes out with
 * stems of visibly different weights. Aligning per glyph looks better one
 * letter at a time and is wrong for every line of text.
 *
 * A cell is filled by how much of it the outline covers rather than by whether
 * the outline passes through its centre. Centre sampling is what a naive
 * rasteriser does, and at the sizes a pixel font is drawn for it drops thin
 * strokes entirely: a stem narrower than a cell that happens to fall between
 * two centres disappears, so the letter loses a leg.
 */

import { inkSpans } from "./measure";
import type { Contour, GlyphNode, Vec2 } from "./types";

/** A filled cell region, in grid coordinates. */
interface Rect {
  column: number;
  row: number;
  columns: number;
  rows: number;
}

export interface PixelOptions {
  /** Cells across the em square. */
  pixelsPerEm: number;
  /** Units per em, which fixes the size of a cell. */
  unitsPerEm: number;
  /** Fraction of a cell that has to be covered before it fills. */
  threshold?: number;
}

/** Scanlines sampled per row of cells when measuring coverage. */
const SAMPLES_PER_ROW = 4;

/**
 * How far outside the em square to look for ink.
 *
 * Descenders, and the overshoot on round letters, both fall outside it, and a
 * grid that stopped at the em would clip them.
 */
const OVERSCAN = 1.5;

/**
 * Redraw an outline as filled cells on a grid.
 *
 * Returns the outline unchanged when the grid would be too coarse or too fine
 * to mean anything, rather than emitting a single block or thousands of them.
 */
export function pixelate(contours: Contour[], options: PixelOptions): Contour[] {
  const { pixelsPerEm, unitsPerEm } = options;
  if (pixelsPerEm < 2 || pixelsPerEm > 512) return contours;
  if (contours.length === 0) return contours;

  const cell = unitsPerEm / pixelsPerEm;
  const threshold = options.threshold ?? 0.5;

  // The grid is anchored at the origin -- x = 0 and the baseline -- so every
  // glyph in the font lands on the same one.
  const lowRow = Math.floor((-unitsPerEm * (OVERSCAN - 1)) / cell);
  const highRow = Math.ceil((unitsPerEm * OVERSCAN) / cell);
  const lowColumn = Math.floor((-unitsPerEm * (OVERSCAN - 1)) / cell);
  const highColumn = Math.ceil((unitsPerEm * OVERSCAN) / cell);

  const columns = highColumn - lowColumn;
  const rows = highRow - lowRow;
  if (columns <= 0 || rows <= 0) return contours;

  const filled = new Uint8Array(columns * rows);
  const coverage = new Float64Array(columns);

  for (let row = 0; row < rows; row++) {
    coverage.fill(0);
    const bottom = (lowRow + row) * cell;

    for (let sample = 0; sample < SAMPLES_PER_ROW; sample++) {
      const y = bottom + (cell * (sample + 0.5)) / SAMPLES_PER_ROW;
      for (const span of inkSpans(contours, y)) {
        // Spread this run of ink over the columns it crosses.
        const first = Math.max(0, Math.floor(span.start / cell) - lowColumn);
        const last = Math.min(columns - 1, Math.floor(span.end / cell) - lowColumn);
        for (let column = first; column <= last; column++) {
          const left = (lowColumn + column) * cell;
          const overlap = Math.min(span.end, left + cell) - Math.max(span.start, left);
          if (overlap > 0) coverage[column] += overlap;
        }
      }
    }

    const full = cell * SAMPLES_PER_ROW;
    for (let column = 0; column < columns; column++) {
      if (coverage[column] / full >= threshold) filled[row * columns + column] = 1;
    }
  }

  const rects = mergeRectangles(filled, columns, rows);
  if (rects.length === 0) return contours;

  return rects.map((rect) =>
    box(
      (lowColumn + rect.column) * cell,
      (lowRow + rect.row) * cell,
      rect.columns * cell,
      rect.rows * cell,
    ),
  );
}

/**
 * Cover the filled cells with as few rectangles as possible.
 *
 * One square per cell would be correct and unusable: a letter on a sixteen
 * cell grid runs to eighty or so squares, which is three hundred points where
 * a dozen would do, and every shared edge is a seam for a rasteriser to find.
 * Greedy blocks are not always the theoretical minimum but they tile without
 * overlapping, which is what matters here.
 */
function mergeRectangles(filled: Uint8Array, columns: number, rows: number): Rect[] {
  const used = new Uint8Array(filled.length);
  const rects: Rect[] = [];

  const isFree = (column: number, row: number): boolean =>
    filled[row * columns + column] === 1 && used[row * columns + column] === 0;

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (!isFree(column, row)) continue;

      // Widest run starting here.
      let width = 1;
      while (column + width < columns && isFree(column + width, row)) width++;

      // Then as far down as the whole run stays free.
      let height = 1;
      grow: while (row + height < rows) {
        for (let offset = 0; offset < width; offset++) {
          if (!isFree(column + offset, row + height)) break grow;
        }
        height++;
      }

      for (let r = row; r < row + height; r++) {
        for (let c = column; c < column + width; c++) used[r * columns + c] = 1;
      }
      rects.push({ column, row, columns: width, rows: height });
    }
  }

  return rects;
}

/** A rectangle wound the way a filled outer contour is wound here. */
function box(x: number, y: number, width: number, height: number): Contour {
  const corners: Vec2[] = [
    { x, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
    { x: x + width, y },
  ];
  const nodes: GlyphNode[] = corners.map((point) => ({
    point,
    handleIn: null,
    handleOut: null,
    type: "corner",
  }));
  return { nodes, closed: true };
}
