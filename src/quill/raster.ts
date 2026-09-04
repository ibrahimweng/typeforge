/**
 * The pixel side of the fitter: fill, measure, thin.
 *
 * Finding the centre-line of a drawn letter is a question about the *area* the
 * ink covers rather than about the curves that bound it, and the honest way to
 * ask a question about an area is to fill it in and look. So a glyph is
 * rasterised once, at about a pixel to the font unit, and three things are read
 * off that grid: how far every inside pixel is from the nearest edge, which
 * pixels lie along the middle, and how those join up.
 *
 * The distance is exact rather than approximate -- Felzenszwalb and
 * Huttenlocher's transform, which is the one that gives true euclidean
 * distances in two linear passes rather than the chamfer approximations that
 * are out by a few percent on diagonals. A few percent matters here: the
 * distance *is* the stroke's half-width, so an error in it is an error in the
 * weight of the letter that comes back.
 */

import type { Contour, Vec2 } from "@/font/types";
import { flattenContour } from "@/font/geometry";

export interface Grid {
  /** One byte per pixel: 1 inside the letter, 0 outside. */
  cells: Uint8Array;
  width: number;
  height: number;
  /** Font units per pixel. */
  scale: number;
  /** Where pixel (0,0) sits in font units. */
  originX: number;
  originY: number;
}

export const inside = (grid: Grid, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < grid.width && y < grid.height && grid.cells[y * grid.width + x] === 1;

/** Pixel coordinates back to font units, at the middle of the pixel. */
export function toUnits(grid: Grid, x: number, y: number): Vec2 {
  return {
    x: grid.originX + (x + 0.5) * grid.scale,
    y: grid.originY + (y + 0.5) * grid.scale,
  };
}

// ---------------------------------------------------------------------------
// Filling
// ---------------------------------------------------------------------------

/**
 * The glyph, filled, by the nonzero rule.
 *
 * Nonzero rather than even-odd because that is what a font means: a counter is
 * cut out by being wound the other way round, and under even-odd two strokes
 * that merely overlap would leave a hole where they crossed. On a script, where
 * strokes overlap constantly, that distinction is the difference between a
 * letter and a lace doily.
 */
export function rasterise(contours: Contour[], scale = 1, margin = 3): Grid | null {
  const loops = contours
    .map((contour) => flattenContour(contour, 24))
    .filter((points) => points.length >= 3);
  if (loops.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const loop of loops) {
    for (const point of loop) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  const originX = minX - margin * scale;
  const originY = minY - margin * scale;
  const width = Math.ceil((maxX - minX) / scale) + margin * 2;
  const height = Math.ceil((maxY - minY) / scale) + margin * 2;
  if (width <= 0 || height <= 0 || width * height > 12_000_000) return null;

  const cells = new Uint8Array(width * height);
  // A scanline down the middle of each row, counting winding at each crossing.
  for (let row = 0; row < height; row++) {
    const y = originY + (row + 0.5) * scale;
    const crossings: Array<{ x: number; way: number }> = [];
    for (const loop of loops) {
      for (let index = 0; index < loop.length; index++) {
        const a = loop[index];
        const b = loop[(index + 1) % loop.length];
        if (a.y === b.y) continue;
        if (y >= Math.min(a.y, b.y) && y < Math.max(a.y, b.y)) {
          const t = (y - a.y) / (b.y - a.y);
          crossings.push({ x: a.x + t * (b.x - a.x), way: b.y > a.y ? 1 : -1 });
        }
      }
    }
    if (crossings.length === 0) continue;
    crossings.sort((one, other) => one.x - other.x);
    let winding = 0;
    for (let index = 0; index < crossings.length - 1; index++) {
      winding += crossings[index].way;
      if (winding === 0) continue;
      const from = Math.ceil((crossings[index].x - originX) / scale - 0.5);
      const to = Math.floor((crossings[index + 1].x - originX) / scale - 0.5);
      for (let column = Math.max(0, from); column <= Math.min(width - 1, to); column++) {
        cells[row * width + column] = 1;
      }
    }
  }
  return { cells, width, height, scale, originX, originY };
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

const FAR = 1e20;

/** The squared distance transform of one row of costs, in linear time. */
function transform1d(f: Float64Array, n: number, out: Float64Array): void {
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (k > 0 && s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * How far every inside pixel is from the nearest outside one, in pixels.
 *
 * Which is the stroke's half-width at that point, and is therefore where the
 * width profile of every fitted stroke comes from.
 */
export function distances(grid: Grid): Float64Array {
  const { width, height, cells } = grid;
  const field = new Float64Array(width * height);
  for (let index = 0; index < cells.length; index++) field[index] = cells[index] === 1 ? FAR : 0;

  const column = new Float64Array(height);
  const columnOut = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) column[y] = field[y * width + x];
    transform1d(column, height, columnOut);
    for (let y = 0; y < height; y++) field[y * width + x] = columnOut[y];
  }
  const row = new Float64Array(width);
  const rowOut = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) row[x] = field[y * width + x];
    transform1d(row, width, rowOut);
    for (let x = 0; x < width; x++) field[y * width + x] = Math.sqrt(rowOut[x]);
  }
  return field;
}

/** The distance at a fractional pixel position, interpolated. */
export function distanceAt(grid: Grid, field: Float64Array, x: number, y: number): number {
  const cx = Math.max(0, Math.min(grid.width - 1.001, x));
  const cy = Math.max(0, Math.min(grid.height - 1.001, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const get = (px: number, py: number) =>
    field[Math.min(grid.height - 1, py) * grid.width + Math.min(grid.width - 1, px)];
  return (
    get(x0, y0) * (1 - fx) * (1 - fy) +
    get(x0 + 1, y0) * fx * (1 - fy) +
    get(x0, y0 + 1) * (1 - fx) * fy +
    get(x0 + 1, y0 + 1) * fx * fy
  );
}

// ---------------------------------------------------------------------------
// Thinning
// ---------------------------------------------------------------------------

/**
 * The letter worn down to a line one pixel wide.
 *
 * Zhang and Suen's thinning, which removes boundary pixels in two alternating
 * passes and stops when a pass removes nothing. It is chosen over reading the
 * ridge straight off the distance field for one practical reason: a ridge is
 * where the distance stops rising, and on a stroke of even width that is a
 * broad flat plateau rather than a line, so ridge-finding gives a band several
 * pixels across that then has to be thinned anyway. This arrives at a
 * one-pixel, connected result directly, and the distance field is still what
 * says how wide the stroke there was.
 *
 * What it costs is a little accuracy in *where* the line runs -- a thinned
 * skeleton sits within a pixel or so of the true medial axis -- and some spurs
 * at the ends, which are pruned when the paths are traced.
 */
export function thin(grid: Grid): Uint8Array {
  const { width, height } = grid;
  const cells = new Uint8Array(grid.cells);
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : cells[y * width + x];

  const doomed: number[] = [];
  for (let pass = 0; pass < 200; pass++) {
    let removed = 0;
    for (const step of [0, 1]) {
      doomed.length = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (at(x, y) !== 1) continue;
          // The eight neighbours, clockwise from north.
          const p = [
            at(x, y + 1),
            at(x + 1, y + 1),
            at(x + 1, y),
            at(x + 1, y - 1),
            at(x, y - 1),
            at(x - 1, y - 1),
            at(x - 1, y),
            at(x - 1, y + 1),
          ];
          const filled = p.reduce((sum, one) => sum + one, 0);
          if (filled < 2 || filled > 6) continue;
          // How many times the ring goes from empty to filled: exactly one
          // means removing this pixel cannot break the shape in two.
          let turns = 0;
          for (let index = 0; index < 8; index++) {
            if (p[index] === 0 && p[(index + 1) % 8] === 1) turns++;
          }
          if (turns !== 1) continue;
          if (step === 0) {
            if (p[0] * p[2] * p[4] !== 0) continue;
            if (p[2] * p[4] * p[6] !== 0) continue;
          } else {
            if (p[0] * p[2] * p[6] !== 0) continue;
            if (p[0] * p[4] * p[6] !== 0) continue;
          }
          doomed.push(y * width + x);
        }
      }
      for (const index of doomed) cells[index] = 0;
      removed += doomed.length;
    }
    if (removed === 0) break;
  }
  return tidy(cells, width, height);
}

/**
 * The staircases taken out of a thinned line.
 *
 * Thinning leaves a skeleton one pixel wide but not one pixel *thin*: where a
 * near-vertical line steps sideways it leaves two pixels side by side, and
 * under eight-way adjacency each of those sees three neighbours. Nothing is
 * wrong with the shape -- it is still a line, and it still runs down the middle
 * of the stroke -- but anything that reads the skeleton as a graph counts every
 * one of those as a junction.
 *
 * That is not a cosmetic problem. Tracing an `n` before this ran found four
 * hundred and fourteen junctions against three genuine endpoints, and cut the
 * letter into six hundred and sixty pieces. The ink was right and the
 * description was useless: six hundred strokes is a recording of a letter, not
 * a letter anybody can edit.
 *
 * A pixel goes if one of its neighbours already reaches everything it reaches.
 * On a straight diagonal the two neighbours are two apart and neither covers
 * the other, so nothing is removed; on a staircase they are adjacent, one
 * covers the other, and the redundant pixel goes. Repeated until a pass changes
 * nothing, because removing one can expose the next.
 */
function tidy(cells: Uint8Array, width: number, height: number): Uint8Array {
  const around = (x: number, y: number): Array<[number, number]> => {
    const found: Array<[number, number]> = [];
    for (const [dx, dy] of [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ] as Array<[number, number]>) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (cells[ny * width + nx] === 1) found.push([nx, ny]);
    }
    return found;
  };
  const touching = (a: [number, number], b: [number, number]): boolean =>
    Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1 && !(a[0] === b[0] && a[1] === b[1]);

  for (let pass = 0; pass < 12; pass++) {
    let removed = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (cells[y * width + x] !== 1) continue;
        const mine = around(x, y);
        // An endpoint is where a stroke stops and must never be worn away.
        if (mine.length < 2) continue;
        for (const covering of mine) {
          const covers = mine.every(
            (one) => (one[0] === covering[0] && one[1] === covering[1]) || touching(one, covering),
          );
          if (covers) {
            cells[y * width + x] = 0;
            removed++;
            break;
          }
        }
      }
    }
    if (removed === 0) break;
  }
  return cells;
}
