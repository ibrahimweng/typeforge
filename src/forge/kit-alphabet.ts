/**
 * The letters a grid starts with, drawn for the grid rather than traced onto it.
 *
 * Laying a font's own skeletons onto the cells was how a kit used to begin,
 * and it can only ever be as good as the skeleton is coarse. The grid is five
 * cells to the cap height, so everything a letter says in less than a cell --
 * the aperture of a c, the spine of an s, the spur of a G, the level vertex
 * of an M -- is either kept as a whole cell or dropped, and whichever it is
 * the letter stops reading. When the Sans was redrawn after Geist every one of
 * those details got finer, and the traced alphabet went with them: the c
 * closed into an o, the s and the S became an 8 and a delta, and the M grew a
 * hook where its vertex had been cut level.
 *
 * So the letters and figures here are drawn once, cell by cell, the way a grid
 * face is designed: each one a few runs from cell to cell in the eight
 * directions the grid has. They are still cells -- ports on edges, joined up
 * and swept by the font's own pen -- so the weight, the terminals and the cuts
 * reach them exactly as before, and every cell is one click to change. Only
 * what the grid starts from is different.
 *
 * Drawn for the grid the kit comes with: five cells to the cap height, four to
 * the x-height, two below the baseline. On any other grid there is nothing
 * here that fits, and the letters are traced from the skeletons as before.
 */

import { cellKey, type Cell, type Grid, type Port, type Tiles } from "./kit";

/**
 * A run, as the cells it passes through.
 *
 * Written `column,row` and separated by spaces; two cells in a line with each
 * other -- level, upright or at forty-five degrees -- stand for every cell
 * between them. A run whose last cell is its first is closed. A cell may name
 * ports of its own after a colon (`0,4:n`), which is how an end is carried on
 * to the edge of a cell something else already runs through, and how a dot is
 * written: one cell, one port.
 *
 * An open end is carried on to the edge of its cell in the direction it was
 * travelling, so that a stem reaches the baseline rather than stopping half a
 * cell short -- unless the end lands on a cell another run passes through,
 * where it is a join and stops in the middle, under that run's ink.
 */
type Run = string;

/*
 * Lowercase stands on rows 0 to 3, capitals and ascenders reach row 4, and
 * descenders take the one row under the line: a face's descender is shallow
 * next to its cap height, and two cells down reached past the Sans's own. The
 * dot of an i or a j is the top half of row 4, level with the ascenders.
 */
const DRAWN: Record<string, Run[]> = {
  a: ["0,3 2,3 2,0:s", "2,1 0,1 0,0 2,0"],
  b: ["0,0:s 0,4", "0,3 2,3 2,0 0,0"],
  c: ["2,3 0,3 0,0 2,0"],
  d: ["2,0:s 2,4", "2,3 0,3 0,0 2,0"],
  e: ["2,0 0,0 0,3 2,3 2,2 0,2"],
  f: ["2,4 1,4 1,0", "0,3 2,3"],
  g: ["2,3 0,3 0,1 2,1", "2,3 2,-1 0,-1"],
  h: ["0,0 0,4", "0,3 2,3 2,0"],
  i: ["0,0 0,3", "0,4:n"],
  dotlessi: ["0,0 0,3"],
  j: ["1,3 1,-1 0,-1", "1,4:n"],
  dotlessj: ["1,3 1,-1 0,-1"],
  k: ["0,0 0,4", "2,3 0,1", "1,2 2,1 2,0"],
  l: ["0,4 0,0 1,0"],
  m: ["0,0 0,3 4,3 4,0", "2,3 2,0"],
  n: ["0,0 0,3 2,3 2,0"],
  o: ["0,0 0,3 2,3 2,0 0,0"],
  p: ["0,3:n 0,-1", "0,3 2,3 2,0 0,0"],
  q: ["2,3:n 2,-1", "2,3 0,3 0,0 2,0"],
  r: ["0,0 0,3 2,3"],
  s: ["2,3 0,3 0,2 1,2 2,1 2,0 0,0"],
  t: ["1,4 1,0 2,0", "0,3 2,3"],
  u: ["0,3 0,0 2,0 2,3"],
  v: ["0,3 0,1 1,0", "3,3 3,1 2,0"],
  w: ["0,3 0,0:s", "3,3 3,0:s", "0,0 1,1", "3,0 2,1"],
  x: ["0,3 3,0", "3,3 0,0"],
  y: ["0,3 0,1 2,1", "2,3 2,-1 0,-1"],
  z: ["0,3 3,3:e", "3,3 0,0", "0,0:w 3,0"],

  A: ["0,0 0,3 1,4 2,4 3,3 3,0", "0,2 3,2"],
  B: ["0,0:s 0,4:n", "0,4 2,4 2,2 0,2", "0,2 3,2 3,0 0,0"],
  C: ["3,4 0,4 0,0 3,0"],
  D: ["0,0 0,4 2,4 3,3 3,1 2,0 0,0"],
  E: ["3,4 0,4 0,0 3,0", "0,2 2,2"],
  F: ["3,4 0,4 0,0", "0,2 2,2"],
  G: ["3,4 0,4 0,0 3,0 3,2 2,2"],
  H: ["0,0 0,4", "3,0 3,4", "0,2 3,2"],
  I: ["1,0 1,4", "0,4 2,4", "0,0 2,0"],
  J: ["3,4 3,0 0,0 0,1"],
  K: ["0,0 0,4", "3,4 0,1", "1,2 3,0"],
  L: ["0,4 0,0 3,0"],
  M: ["0,0 0,4:n", "5,0 5,4:n", "0,4 2,2", "5,4 3,2"],
  N: ["0,0 0,4:n", "0,4 3,1", "3,0 3,4"],
  O: ["0,0 0,4 3,4 3,0 0,0"],
  P: ["0,0 0,4", "0,4 3,4 3,2 0,2"],
  Q: ["0,0 0,4 3,4 3,0 0,0", "2,1 4,-1"],
  R: ["0,0 0,4", "0,4 3,4 3,2 0,2", "1,2 3,0"],
  S: ["3,4 0,4 0,2 3,2 3,0 0,0"],
  T: ["0,4 4,4", "2,4 2,0"],
  U: ["0,4 0,0 3,0 3,4"],
  V: ["0,4 0,1 1,0", "3,4 3,1 2,0"],
  W: ["0,4 0,0:s", "5,4 5,0:s", "0,0 2,2", "5,0 3,2"],
  X: ["0,4 4,0", "4,4 0,0"],
  Y: ["0,4 2,2", "4,4 2,2", "2,2 2,0"],
  Z: ["0,4 4,4:e", "4,4 0,0", "0,0:w 4,0"],

  zero: ["0,0 0,4 2,4 2,0 0,0"],
  one: ["1,0 1,4:n", "0,3 1,4", "0,0 2,0"],
  two: ["0,3 0,4 2,4 2,2 0,0", "0,0:w 2,0"],
  three: ["0,4 2,4 2,0 0,0", "1,2 2,2"],
  four: ["0,4 0,2 2,2", "2,4 2,0"],
  five: ["2,4 0,4:w", "0,4 0,2 2,2 2,0 0,0"],
  six: ["2,4 0,4 0,0 2,0 2,2 0,2"],
  seven: ["0,4 2,4 2,3 1,2 1,0"],
  eight: ["1,2 0,3 0,4 2,4 2,3 1,2", "1,2 0,1 0,0 2,0 2,1 1,2"],
  nine: ["0,0 2,0 2,4 0,4 0,2 2,2"],
};

/** The port a step from one cell to its neighbour leaves by. */
const STEP: Record<string, Port> = {
  "0,1": "n",
  "1,1": "ne",
  "1,0": "e",
  "1,-1": "se",
  "0,-1": "s",
  "-1,-1": "sw",
  "-1,0": "w",
  "-1,1": "nw",
};

interface Point {
  column: number;
  row: number;
  ports: Port[];
}

function parse(run: Run): Point[] {
  return run
    .trim()
    .split(/\s+/)
    .map((token) => {
      const [where, named] = token.split(":");
      const [column, row] = where.split(",").map(Number);
      return { column, row, ports: named ? (named.split("+") as Port[]) : [] };
    });
}

/** Every cell a run passes through, in order, with the in-between ones filled in. */
function cellsOf(points: Point[]): Array<{ column: number; row: number }> {
  const cells = [{ column: points[0].column, row: points[0].row }];
  for (let at = 1; at < points.length; at++) {
    const from = points[at - 1];
    const to = points[at];
    const across = to.column - from.column;
    const up = to.row - from.row;
    if (across !== 0 && up !== 0 && Math.abs(across) !== Math.abs(up)) {
      throw new Error(`not a grid direction: ${from.column},${from.row} to ${to.column},${to.row}`);
    }
    const steps = Math.max(Math.abs(across), Math.abs(up));
    for (let step = 1; step <= steps; step++) {
      cells.push({
        column: from.column + Math.sign(across) * step,
        row: from.row + Math.sign(up) * step,
      });
    }
  }
  return cells;
}

const stepPort = (dx: number, dy: number): Port => STEP[`${Math.sign(dx)},${Math.sign(dy)}`];

/** One of the letters above, as cells. */
function tilesOf(runs: Run[]): Tiles {
  const found = new Map<string, Set<Port>>();
  const add = (column: number, row: number, port: Port): void => {
    const key = cellKey(column, row);
    let ports = found.get(key);
    if (!ports) {
      ports = new Set();
      found.set(key, ports);
    }
    ports.add(port);
  };

  const parsed = runs.map(parse);
  const walked = parsed.map(cellsOf);

  walked.forEach((cells, index) => {
    const points = parsed[index];
    for (const point of points) for (const port of point.ports) add(point.column, point.row, port);
    for (let at = 1; at < cells.length; at++) {
      const from = cells[at - 1];
      const to = cells[at];
      add(from.column, from.row, stepPort(to.column - from.column, to.row - from.row));
      add(to.column, to.row, stepPort(from.column - to.column, from.row - to.row));
    }
    if (cells.length < 2) return;

    const first = cells[0];
    const last = cells[cells.length - 1];
    if (first.column === last.column && first.row === last.row) return;

    /*
     * Whether an end lands on something: another run, or this one passing
     * back through the same cell -- the bar of an e ends on its own stem.
     */
    const meets = (cell: { column: number; row: number }, skip: number): boolean =>
      walked.some((other, which) =>
        other.some(
          (one, at) =>
            one.column === cell.column && one.row === cell.row && (which !== index || at !== skip),
        ),
      );
    if (!meets(first, 0)) {
      add(
        first.column,
        first.row,
        stepPort(first.column - cells[1].column, first.row - cells[1].row),
      );
    }
    const end = cells.length - 1;
    if (!meets(last, end)) {
      const before = cells[end - 1];
      add(last.column, last.row, stepPort(last.column - before.column, last.row - before.row));
    }
  });

  const cells: Record<string, Cell> = {};
  let columns = 1;
  for (const [key, ports] of found) {
    cells[key] = { ports: [...ports] };
    columns = Math.max(columns, Number(key.split(",")[0]) + 1);
  }
  return { columns, cells };
}

/** Whether a grid is the one these letters were drawn on. */
export function fitsDrawn(grid: Grid): boolean {
  return grid.rows === 5 && grid.below >= 2;
}

/** The letters drawn here, by name. */
export const DRAWN_ON_GRID: ReadonlySet<string> = new Set(Object.keys(DRAWN));

/**
 * A letter as it is drawn for the grid, or nothing where there is no drawing
 * of it for this grid and it has to be traced from its skeleton instead.
 */
export function drawnTiles(letter: string, grid: Grid): Tiles | null {
  const runs = DRAWN[letter];
  if (!runs || !fitsDrawn(grid)) return null;
  return tilesOf(runs);
}
