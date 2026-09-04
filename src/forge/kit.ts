/**
 * Letters built on a grid, out of a small alphabet of parts.
 *
 * The third way to make a letter here, and it exists because the other two
 * cannot reach a whole family of type. A skeleton and a pen give you a letter
 * whose strokes go where a hand would take them; cutting takes material out of
 * one. Neither describes a face whose letters are assembled out of a handful of
 * shapes repeated on a grid -- the kind that is designed as a system first and
 * an alphabet second, where what makes it a typeface is that every letter is
 * made of the same six pieces.
 *
 * The trick is that it is not a second geometry engine. A cell holds a set of
 * places on its own boundary that ink runs to, and those are joined up into
 * spines -- so a letter built here is a skeleton like any other, swept by the
 * same pen, wearing the same terminals, and cut by the same cuts. Everything
 * downstream of the sweep never learns that this letter was assembled rather
 * than drawn.
 *
 * Which is also what makes it worth having rather than a picture editor: turn
 * the weight up on a font built from tiles and it gets heavier, because the
 * tiles were never the ink. They are where the ink runs.
 */

import { contourArea, contoursBounds, type Bounds } from "@/font/geometry";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { alongSpine, spineLength } from "./shapes";
import type { Style } from "./style";
import type { Spine, SpineSegment, Stroke, Terminal } from "./types";

// ---------------------------------------------------------------------------
// What a kit is
// ---------------------------------------------------------------------------

/**
 * The eight places on a cell's boundary that ink can run to.
 *
 * Four edge middles and four corners, which between them cover every direction
 * a stroke leaves a square in: up, along, and at forty-five degrees. A ninth
 * would be a place no neighbouring cell could meet, and a stroke that stops in
 * mid-air at the edge of a cell is a stroke that stops in mid-air.
 */
export type Port = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export const PORTS: Port[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

const OPPOSITE: Record<Port, Port> = {
  n: "s",
  s: "n",
  e: "w",
  w: "e",
  ne: "sw",
  sw: "ne",
  nw: "se",
  se: "nw",
};

/**
 * Every other cell that touches the same point, and what that cell calls it.
 *
 * What tells a stroke whether it is stopping or carrying on. A port something
 * else also has is a join in the middle of a letter and is cut square; a port
 * nothing else has is the end of the letter and wears whatever the font's
 * terminals are.
 *
 * A port on an edge is shared with one cell. A port on a corner is shared with
 * three, and that is the fact worth writing down: taken as one, a stroke
 * leaving through a corner into the cell beside it looked to every check like
 * a stroke leaving the letter -- so the diagonals of an alphabet came back
 * with their halves pulled apart and a terminal on each cut end.
 */
const MEETS: Record<Port, Array<{ column: number; row: number; port: Port }>> = {
  n: [{ column: 0, row: 1, port: "s" }],
  s: [{ column: 0, row: -1, port: "n" }],
  e: [{ column: 1, row: 0, port: "w" }],
  w: [{ column: -1, row: 0, port: "e" }],
  ne: [
    { column: 1, row: 0, port: "nw" },
    { column: 0, row: 1, port: "se" },
    { column: 1, row: 1, port: "sw" },
  ],
  nw: [
    { column: -1, row: 0, port: "ne" },
    { column: 0, row: 1, port: "sw" },
    { column: -1, row: 1, port: "se" },
  ],
  se: [
    { column: 1, row: 0, port: "sw" },
    { column: 0, row: -1, port: "ne" },
    { column: 1, row: -1, port: "nw" },
  ],
  sw: [
    { column: -1, row: 0, port: "se" },
    { column: 0, row: -1, port: "nw" },
    { column: -1, row: -1, port: "ne" },
  ],
};

/**
 * A shape that fills part of a cell, rather than a stroke running across it.
 *
 * The other half of what a grid alphabet is made of, and the half a set of
 * ports cannot say. A stroke has a width and two ends; the quarter disc that
 * makes the shoulder of a heavy grid letter has neither -- it is a piece of
 * ink shaped like a quarter of a circle, and four of them are a full round
 * counter with nothing swept anywhere.
 *
 * - `full` fills the cell.
 * - `pie` is a quarter disc about one corner, of the cell's own radius. Four
 *   of them about a shared corner make a circle.
 * - `bite` is the cell with that quarter taken out, which is the shape that
 *   turns a square block into the inside of a C.
 * - `half` is the cell cut across the middle.
 * - `wedge` is the cell cut corner to corner.
 *
 * `turn` is quarter turns anticlockwise, so one shape and a number stand in
 * for four tiles -- and a row of four in a palette is a row nobody has to
 * learn.
 */
export type FillKind = "full" | "pie" | "bite" | "half" | "wedge";

export interface Fill {
  kind: FillKind;
  /** Quarter turns anticlockwise, 0 to 3. */
  turn: number;
}

export const FILL_KINDS: FillKind[] = ["full", "pie", "bite", "half", "wedge"];

export interface Cell {
  /** Which places on the boundary ink runs to. Nothing here is an empty cell. */
  ports: Port[];
  /** A shape filling part of the cell, alongside whatever its ports say. */
  fill?: Fill;
}

/** One letter, as cells. */
export interface Tiles {
  /** How many cells wide this letter is, which is what sets its width. */
  columns: number;
  /**
   * The cells that have anything in them, keyed by column and row.
   *
   * Sparse, because most cells in most letters are empty and a full rectangle
   * of nothing is a great deal of nothing to keep, to save and to compare.
   */
  cells: Record<string, Cell>;
}

/**
 * The grid every letter in the font is built on.
 *
 * Counted in cells rather than measured in units, so the cell is square and
 * stays square: a quarter turn has to be a quarter of a circle and a diagonal
 * has to be at forty-five degrees, or the alphabet stops looking like one set
 * of parts used repeatedly.
 */
export interface Grid {
  /** Cells from the baseline to the cap height. This is what sets the cell size. */
  rows: number;
  /** How many cells the grid reaches below the baseline. */
  below: number;
  /** How many cells it reaches above the cap height. */
  above: number;
}

export interface Kit {
  /** Whether the letters are built from cells instead of drawn from skeletons. */
  on: boolean;
  grid: Grid;
  /**
   * How a turn inside a cell is taken: nought is a square corner, one is a
   * quarter of a circle touching both ports.
   *
   * The single control that decides most of what a kit looks like, and the
   * reason there is no separate corner tile and elbow tile. Two shapes that
   * differ by a number are a number.
   */
  roundness: number;
  /** The letters that have been laid out. Anything not here is not drawn. */
  glyphs: Record<string, Tiles>;
}

export const GRID: Grid = { rows: 5, below: 2, above: 1 };

export function emptyKit(): Kit {
  return { on: false, grid: { ...GRID }, roundness: 1, glyphs: {} };
}

export const cellKey = (column: number, row: number): string => `${column},${row}`;

/** The rows the grid has, from the lowest to the highest. */
export function rowsOf(grid: Grid): number[] {
  const rows: number[] = [];
  for (let row = -grid.below; row < grid.rows + grid.above; row++) rows.push(row);
  return rows;
}

/**
 * How large one cell is.
 *
 * Read off the cap height, so the grid is a description of the font's
 * proportions rather than a number in units that stops meaning anything the
 * moment somebody changes the x-height.
 */
export function unitOf(style: Style, grid: Grid): number {
  return style.metrics.capHeight / Math.max(1, grid.rows);
}

/** Where a cell sits, in font units. */
export function cellBox(column: number, row: number, unit: number, left: number): Bounds {
  return {
    xMin: left + column * unit,
    xMax: left + (column + 1) * unit,
    yMin: row * unit,
    yMax: (row + 1) * unit,
  };
}

/** Where a port sits on a cell's boundary. */
export function portAt(port: Port, box: Bounds): Vec2 {
  const midX = (box.xMin + box.xMax) / 2;
  const midY = (box.yMin + box.yMax) / 2;
  switch (port) {
    case "n":
      return { x: midX, y: box.yMax };
    case "ne":
      return { x: box.xMax, y: box.yMax };
    case "e":
      return { x: box.xMax, y: midY };
    case "se":
      return { x: box.xMax, y: box.yMin };
    case "s":
      return { x: midX, y: box.yMin };
    case "sw":
      return { x: box.xMin, y: box.yMin };
    case "w":
      return { x: box.xMin, y: midY };
    case "nw":
      return { x: box.xMin, y: box.yMax };
  }
}

// ---------------------------------------------------------------------------
// Building a letter out of them
// ---------------------------------------------------------------------------

/** A letter assembled from cells: spines to sweep, and any cells filled solid. */
export interface Assembled {
  strokes: Stroke[];
  /** Cells filled in outright, which are ink rather than a path for it. */
  blocks: Contour[];
  advanceWidth: number;
}

/**
 * Turn a letter's cells into strokes the sweep can draw.
 *
 * Every port is joined to the middle of its cell, and the middle is where the
 * decisions are. Two ports facing each other are one run straight through, not
 * two meeting in the middle -- otherwise every stem in the font would have a
 * seam across it at every cell boundary. Two ports at an angle turn, by
 * whatever the roundness says. Anything else is a spoke each, which is how a
 * letter gets a junction.
 */
export function assemble(tiles: Tiles, style: Style, kit: Kit): Assembled {
  const unit = unitOf(style, kit.grid);
  const left = style.metrics.sidebearing;
  const half = style.pen.weight / 2;
  const radius = Math.min(Math.max(kit.roundness, 0), 1) * (unit / 2);

  const strokes: Stroke[] = [];
  const blocks: Contour[] = [];

  for (const [where, cell] of Object.entries(tiles.cells)) {
    const [column, row] = where.split(",").map(Number);
    if (!Number.isFinite(column) || !Number.isFinite(row)) continue;
    const box = cellBox(column, row, unit, left);

    if (cell.fill) blocks.push(...filled(cell.fill, box));
    if (cell.ports.length === 0) continue;

    const open = (port: Port): boolean => !continues(tiles, column, row, port);
    const middle = { x: (box.xMin + box.xMax) / 2, y: (box.yMin + box.yMax) / 2 };
    const at = (port: Port): Vec2 => portAt(port, box);
    const straight = (one: Port, other: Port, buried?: Port): void => {
      strokes.push(
        stroke(
          { segments: [line(at(one), at(other))], closed: false },
          style,
          endFor(style, buried !== one && open(one)),
          endFor(style, buried !== other && open(other)),
        ),
      );
    };

    const spare = [...cell.ports];
    const take = (...ports: Port[]): void => {
      for (const port of ports) {
        const at_ = spare.indexOf(port);
        if (at_ >= 0) spare.splice(at_, 1);
      }
    };

    /*
     * Facing each other: one run straight through.
     *
     * Taken first and taken apart from everything else, because otherwise
     * every stem in the font would have a seam across it at every cell
     * boundary -- two stubs meeting in the middle rather than one stroke
     * passing through.
     */
    for (const port of [...spare]) {
      if (spare.includes(port) && spare.includes(OPPOSITE[port])) {
        straight(port, OPPOSITE[port]);
        take(port, OPPOSITE[port]);
      }
    }

    /*
     * Both on the same edge: one run along it.
     *
     * The case that is easy to miss and ruins the alphabet when it is missed.
     * The two ends of a cell's bottom edge are not two directions meeting in
     * the middle, they are a straight line -- and drawn as a turn instead,
     * every horizontal arm in the font came back as a row of V's.
     */
    for (const port of [...spare]) {
      const along = spare.find((other) => other !== port && sameEdge(port, other));
      if (spare.includes(port) && along) {
        straight(port, along);
        take(port, along);
      }
    }

    /*
     * A single turn, drawn as one stroke through the middle rather than two
     * spokes, so that the corner can be rounded off. Two spokes meeting would
     * always be a hard angle however round the rest of the font is.
     */
    if (spare.length === 2) {
      const [one, other] = spare;
      strokes.push(
        stroke(
          bend(at(one), middle, at(other), radius, half),
          style,
          endFor(style, open(one)),
          endFor(style, open(other)),
          "round",
        ),
      );
      take(one, other);
    }

    for (const port of spare) {
      /*
       * Whatever is left over joins the nearest thing in the cell it can reach
       * without cutting across the middle. A stem running down a cell and an
       * arm leaving along the same edge share that edge; joined through the
       * middle instead, the arm grows a diagonal spur into the counter.
       */
      const along = cell.ports.find((other) => other !== port && sameEdge(port, other));
      if (along) straight(port, along, along);
      else
        strokes.push(
          stroke(
            { segments: [line(at(port), middle)], closed: false },
            style,
            endFor(style, open(port)),
            // The end inside the cell is buried under whatever it meets there.
            { kind: "butt" },
          ),
        );
    }
  }

  return {
    strokes,
    blocks,
    advanceWidth: Math.max(1, tiles.columns) * unit + left * 2,
  };
}

/**
 * Which of a cell's four edges a port sits on. A corner sits on two.
 *
 * What tells a straight run along an edge apart from a turn through the
 * middle, which is the difference between an arm and a row of V's.
 */
const EDGES: Record<Port, string[]> = {
  n: ["top"],
  ne: ["top", "right"],
  e: ["right"],
  se: ["right", "bottom"],
  s: ["bottom"],
  sw: ["bottom", "left"],
  w: ["left"],
  nw: ["left", "top"],
};

function sameEdge(one: Port, other: Port): boolean {
  return EDGES[one].some((edge) => EDGES[other].includes(edge));
}

/** Whether anything on the other side of this port carries the stroke on. */
function continues(tiles: Tiles, column: number, row: number, port: Port): boolean {
  return MEETS[port].some((step) =>
    tiles.cells[cellKey(column + step.column, row + step.row)]?.ports.includes(step.port),
  );
}

/**
 * How a stroke finishes at a port.
 *
 * A port the neighbouring cell also has is a join in the middle of the letter
 * and is cut square, because nothing there is ever seen. A port nothing meets
 * is the end of the letter and wears whatever the font puts on an end -- which
 * is what keeps a kit reading as part of the same typeface as the letters
 * drawn from skeletons beside it.
 */
function endFor(style: Style, open: boolean): Terminal {
  if (!open) return { kind: "butt" };
  const { kind, angle } = style.parts.terminal;
  return { kind, angle, open: true };
}

function stroke(
  spine: Spine,
  style: Style,
  start: Terminal,
  end: Terminal,
  join: Stroke["join"] = "miter",
): Stroke {
  return { spine, pen: { ...style.pen }, start, end, join };
}

const line = (from: Vec2, to: Vec2): SpineSegment => ({ kind: "line", from, to });

/**
 * A turn through the middle of a cell, rounded off by as much as will fit.
 *
 * Built here rather than handed to the general corner-rounder, which measures
 * a corner's budget as half of each run either side of it -- the right rule
 * when corners come one after another along a letter's spine, and half the
 * available room when there is only one corner and both arms belong to it.
 * Inside a cell there is always exactly one, so the whole arm is the budget.
 *
 * Below the radius a pen of this width can turn through, the corner is left
 * square. A stroke bending through a radius smaller than its own half-width
 * turns itself inside out, and a square corner is what somebody asking for a
 * rounder one than the pen allows actually wants to see.
 */
function bend(from: Vec2, corner: Vec2, to: Vec2, radius: number, penHalf: number): Spine {
  const square: Spine = { segments: [line(from, corner), line(corner, to)], closed: false };
  const one = towards(corner, from);
  const other = towards(corner, to);
  if (!one || !other) return square;

  const between = Math.acos(Math.min(1, Math.max(-1, one.x * other.x + one.y * other.y)));
  // Straight through, or doubled back: neither is a corner.
  if (between < 1e-6 || Math.PI - between < 1e-6) return square;

  const halfTurn = between / 2;
  const arm = Math.min(distanceBetween(corner, from), distanceBetween(corner, to));
  const fits = Math.min(radius, arm * Math.tan(halfTurn));
  if (fits <= penHalf * 1.02) return square;

  const back = fits / Math.tan(halfTurn);
  const touchOne = { x: corner.x + one.x * back, y: corner.y + one.y * back };
  const touchOther = { x: corner.x + other.x * back, y: corner.y + other.y * back };
  const bisector = towards({ x: 0, y: 0 }, { x: one.x + other.x, y: one.y + other.y });
  if (!bisector) return square;

  const away = fits / Math.sin(halfTurn);
  const centre = { x: corner.x + bisector.x * away, y: corner.y + bisector.y * away };
  const startAngle = Math.atan2(touchOne.y - centre.y, touchOne.x - centre.x);
  let turn = Math.atan2(touchOther.y - centre.y, touchOther.x - centre.x) - startAngle;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;

  return {
    segments: [
      line(from, touchOne),
      {
        kind: "arc",
        centre,
        radius: fits,
        startAngle,
        endAngle: startAngle + turn,
        sweepPositive: turn > 0,
      },
      line(touchOther, to),
    ],
    closed: false,
  };
}

const distanceBetween = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The unit direction from one point to another, or nothing if they coincide. */
function towards(from: Vec2, to: Vec2): Vec2 | null {
  const away = distanceBetween(from, to);
  return away < 1e-9 ? null : { x: (to.x - from.x) / away, y: (to.y - from.y) / away };
}

/**
 * The ink a filled cell puts down.
 *
 * Drawn as an outline rather than swept, because it is not a stroke: it has no
 * width to be given and no ends to finish. Which is the whole reason the fills
 * exist beside the ports rather than instead of them -- a grid alphabet is
 * usually some of each, and a face made only of strokes cannot be heavy the
 * way a face made of blocks is.
 */
export function filled(fill: Fill, box: Bounds): Contour[] {
  const turn = ((Math.round(fill.turn) % 4) + 4) % 4;
  // The four corners, anticlockwise from the bottom left, rotated so that one
  // description serves all four turns.
  const corners: Vec2[] = [
    { x: box.xMin, y: box.yMin },
    { x: box.xMax, y: box.yMin },
    { x: box.xMax, y: box.yMax },
    { x: box.xMin, y: box.yMax },
  ];
  const at = (index: number): Vec2 => corners[(index + turn) % 4];
  const middle = (one: Vec2, other: Vec2): Vec2 => ({
    x: (one.x + other.x) / 2,
    y: (one.y + other.y) / 2,
  });
  const radius = box.xMax - box.xMin;

  switch (fill.kind) {
    case "full":
      return [poly([at(0), at(1), at(2), at(3)])];
    case "wedge":
      // The corner it turns about, and the two beside it.
      return [poly([at(0), at(1), at(3)])];
    case "half":
      return [poly([at(0), at(1), middle(at(1), at(2)), middle(at(0), at(3))])];
    case "pie":
      // A quarter disc about corner 0, bulging out to the two corners beside
      // it. The arc is the second of the three sides.
      return [arced([at(0), at(1), at(3)], 1, at(0), radius)];
    case "bite":
      // The same quarter taken out instead of put in: the three other corners,
      // and the arc coming back round the missing one.
      return [arced([at(1), at(2), at(3)], 2, at(0), radius)];
  }
}

/**
 * A polygon with one of its sides bent into a quarter arc.
 *
 * `bendAt` is the side that curves, named by the node it leaves. Both of that
 * side's handles are set, which is the part that is easy to get wrong and
 * invisible until it is drawn: give a cubic only the handle it arrives by and
 * it is not a flatter arc, it is very nearly the straight line between the two
 * points. Four quarter discs meant to be a circle came out a diamond with the
 * corners knocked off, which looked enough like a decision to survive a while.
 */
function arced(points: Vec2[], bendAt: number, centre: Vec2, radius: number): Contour {
  const flat = poly(points);
  // `poly` may have reversed the winding, so the side is found by its points
  // rather than by its index.
  const from = points[bendAt];
  const to = points[(bendAt + 1) % points.length];
  const start = flat.nodes.findIndex((one) => one.point === from);
  const finish = flat.nodes.findIndex((one) => one.point === to);
  if (start < 0 || finish < 0) return flat;

  const reach = KAPPA * radius;
  const spin = (point: Vec2, way: number): Vec2 => {
    const out = { x: point.x - centre.x, y: point.y - centre.y };
    return { x: (-out.y / radius) * way, y: (out.x / radius) * way };
  };
  const one = { x: (from.x - centre.x) / radius, y: (from.y - centre.y) / radius };
  const other = { x: (to.x - centre.x) / radius, y: (to.y - centre.y) / radius };
  // Which way round the short way is.
  const way = one.x * other.y - one.y * other.x >= 0 ? 1 : -1;
  const leaving = spin(from, way);
  const arriving = spin(to, way);

  const nodes = flat.nodes.map((one_, index) => {
    if (index === start) {
      return {
        ...one_,
        handleOut: { x: from.x + leaving.x * reach, y: from.y + leaving.y * reach },
      };
    }
    if (index === finish) {
      return {
        ...one_,
        handleIn: { x: to.x - arriving.x * reach, y: to.y - arriving.y * reach },
      };
    }
    return one_;
  });
  return { ...flat, nodes };
}

/**
 * A quarter of a circle as one cubic is off by about a part in a thousand of
 * the radius, which at a cell of a hundred and forty units is a fifth of a
 * unit and below anything a font file records.
 */
const KAPPA = 0.5522847498;

const node = (point: Vec2): GlyphNode => ({
  point,
  handleIn: null,
  handleOut: null,
  type: "corner",
});

/** A polygon, wound as ink so everything downstream reads it as solid. */
function poly(points: Vec2[]): Contour {
  const contour: Contour = { nodes: points.map(node), closed: true };
  return contourArea(contour) >= 0 ? contour : { ...contour, nodes: [...contour.nodes].reverse() };
}

function square(box: Bounds): Contour {
  return poly([
    { x: box.xMin, y: box.yMin },
    { x: box.xMax, y: box.yMin },
    { x: box.xMax, y: box.yMax },
    { x: box.xMin, y: box.yMax },
  ]);
}

/** Whether a letter has been laid out at all. */
export function hasTiles(kit: Kit | undefined, letter: string): boolean {
  const tiles = kit?.glyphs[letter];
  return tiles !== undefined && Object.keys(tiles.cells).length > 0;
}

/** How far across a letter's cells reach, for drawing the grid around them. */
export function spanOf(tiles: Tiles): { columns: number; rows: number[] } {
  const rows = new Set<number>();
  for (const where of Object.keys(tiles.cells)) {
    const [, row] = where.split(",").map(Number);
    if (Number.isFinite(row)) rows.add(row);
  }
  return { columns: tiles.columns, rows: [...rows].sort((one, other) => one - other) };
}

/** The box a letter's cells occupy, for placing the editor over the drawing. */
export function tilesBounds(tiles: Tiles, style: Style, kit: Kit): Bounds {
  const unit = unitOf(style, kit.grid);
  const left = style.metrics.sidebearing;
  const rows = rowsOf(kit.grid);
  return contoursBounds([
    square(cellBox(0, rows[0], unit, left)),
    square(cellBox(Math.max(0, tiles.columns - 1), rows[rows.length - 1], unit, left)),
  ]);
}

// ---------------------------------------------------------------------------
// Laying an alphabet out on the grid
// ---------------------------------------------------------------------------

/**
 * Where a letter's skeleton runs, read as cells.
 *
 * The step that makes a kit usable rather than a promise. A hundred and ninety
 * glyphs placed cell by cell is not a workflow anybody would finish, and a kit
 * with twenty letters in it is not a typeface -- so the alphabet this
 * application already knows how to draw is laid onto the grid, and what
 * arrives is a whole font to argue with rather than an empty sheet.
 *
 * The rule is one sentence: walk each spine, and wherever it crosses out of a
 * cell, note the nearest place on that boundary a stroke is allowed to leave
 * from. The two ends of a spine are noted the same way, snapped to the nearest
 * port of whichever cell they stop in.
 *
 * What comes out is an approximation and is meant to be. A stem lands on the
 * grid exactly; the shoulder of an n lands on the eight ports nearest the arc
 * it was drawn as, which is a rounder or a squarer shoulder than the one that
 * went in. That is the point of the mode -- and every cell of it is one click
 * to change.
 */
export function seedTiles(strokes: Stroke[], style: Style, kit: Kit): Tiles | null {
  if (strokes.length === 0) return null;

  const unit = unitOf(style, kit.grid);
  const left = style.metrics.sidebearing;
  const rows = rowsOf(kit.grid);
  const lowest = rows[0];
  const highest = rows[rows.length - 1];

  /*
   * Every port found, and whether it is a real end of a stroke.
   *
   * The distinction is the difference between an alphabet and an alphabet with
   * crumbs beside it. A port is normally half of a pair: the cell on the other
   * side has the matching one, and the two are one stroke crossing a boundary.
   * A port with nothing on the other side is either the end of the letter --
   * the tip of an arm, which is exactly right -- or the ghost of a stroke that
   * grazed a corner and was dropped, which is a speck. Only the stroke itself
   * knows which, so it says at the time.
   */
  const found = new Map<string, Map<Port, boolean>>();
  let widest = 0;

  /** Which cell a point falls in, held inside the grid the font has. */
  const cellOf = (point: Vec2): Where => ({
    // Nudged, so a stroke running exactly along a grid line settles on one
    // side of it rather than flickering between the two as it is walked.
    column: Math.max(0, Math.floor((point.x - left) / unit + 1e-6)),
    row: Math.min(highest, Math.max(lowest, Math.floor(point.y / unit + 1e-6))),
  });

  const add = (where: Where, port: Port, end: boolean): void => {
    const key = cellKey(where.column, where.row);
    let ports = found.get(key);
    if (!ports) {
      ports = new Map();
      found.set(key, ports);
    }
    ports.set(port, (ports.get(port) ?? false) || end);
    widest = Math.max(widest, where.column + 1);
  };

  for (const stroke of strokes) {
    const total = spineLength(stroke.spine);
    if (total <= 0) continue;
    // Fine enough that no cell is stepped over, whatever the grid is.
    const steps = Math.max(8, Math.ceil((total * 12) / unit));
    const walk = laidOut(stroke.spine, steps, unit, left);
    if (walk.length < 2) continue;

    /*
     * Which cells this stroke runs through, and where it came in and went out
     * of each.
     *
     * Two ports per cell per stroke and no more, which is the whole of what
     * makes this read as a grid rather than as a rasterised photograph. Noting
     * every crossing instead gave a cell four and five ports where one stroke
     * had wandered across a corner, and every one of them was drawn as a spoke
     * to the middle -- so a shoulder came back as a burst of splinters.
     */
    const visits: Array<{ cell: Where; at: Vec2 }> = [];
    /*
     * The ends belong to the cell the stroke runs through, not to the one it
     * stops on the edge of. A stem finishing exactly on the cap height sits on
     * a row line; taken at face value it lands in the row above and is drawn
     * from there to the middle of it, and the letter grows half a cell of
     * horn.
     */
    let where = cellOf(walk[1]);
    let entered = walk[0];

    for (let step = 2; step < walk.length; step++) {
      const next = cellOf(walk[step === walk.length - 1 ? step - 1 : step]);
      if (next.column === where.column && next.row === where.row) continue;
      const crossing = {
        x: (walk[step - 1].x + walk[step].x) / 2,
        y: (walk[step - 1].y + walk[step].y) / 2,
      };
      visits.push({ cell: where, at: entered });
      where = next;
      entered = crossing;
    }
    visits.push({ cell: where, at: entered });

    /*
     * Which door the stroke came in by, and which it went out by.
     *
     * Read off the cells themselves rather than off the crossing point, and
     * that is the whole of what was wrong with the diagonals. It used to take
     * the crossing and ask which of the eight ports it lay nearest, which is a
     * different question and quietly the wrong one: the right stem of an M
     * runs a fifth of a cell in from that cell's west edge, so both its ends
     * came out nearer the western corners than the middle of the edge it
     * actually crossed, and a plain vertical stem was recorded as sw-to-nw.
     * Both of those sit on the same edge, so it was drawn as a line along the
     * edge -- and where the same thing happened at the apex of the M's vee the
     * two ports came back n and nw, which is a bar straight across the top of
     * the cell where the point of the letter should be.
     *
     * A port is where a stroke crosses a boundary, so the boundary it crossed
     * is what decides it. Stepping to the next cell east leaves by the east
     * door however close to a corner the crossing happened to fall, and only a
     * step that changes both column and row -- a real diagonal -- is a corner.
     */
    const first = heading(walk[0], walk[1]);
    const last = heading(walk[walk.length - 2], walk[walk.length - 1]);

    visits.forEach((visit, at) => {
      const cell = visit.cell;
      const box = cellBox(cell.column, cell.row, unit, left);
      // The two genuine ends have no neighbour to face, so they take the
      // direction the stroke itself is travelling: a stem's foot points down
      // because that is the way the stroke leaves it.
      const from =
        at === 0
          ? compass(-first.x, -first.y)
          : portCrossing(cell, visits[at - 1].cell, visit.at, box);
      const to =
        at === visits.length - 1
          ? compass(last.x, last.y)
          : portCrossing(cell, visits[at + 1].cell, visits[at + 1].at, box);
      // In and out by the same door is a stroke dipping into the cell and
      // coming back rather than running through it. Drawn, it is a speck
      // beside the letter.
      if (from === to) return;
      add(cell, from, at === 0);
      add(cell, to, at === visits.length - 1);
    });
  }

  if (found.size === 0) return null;

  /*
   * Ports pointing at a neighbour that is not there.
   *
   * Left in, each is drawn as a stub reaching for a cell that was dropped, and
   * the letter arrives with crumbs around it. The ends of strokes are mostly
   * spared, because the tip of an arm points at nothing on purpose.
   *
   * Mostly, because a stroke does not only end at the edge of a letter. Both
   * bowls of a B begin on its stem and set off east, and a start faces back
   * the way the stroke came -- so each of them asked for a west port in a cell
   * that is already the stem, and the B grew three stubs down its left side
   * reaching for nothing. The bowl is joined to the stem by being in the same
   * cell as it; there is nothing out there to reach for.
   *
   * A tip and a junction are told apart by what else is in the cell. Where a
   * stroke ends on its own -- the tip of an arm, the foot of a stem -- the
   * cell holds that stroke and nothing else, so there is at most one other
   * port. Where it ends on another stroke, that stroke is passing through, and
   * a stroke passing through leaves two.
   */
  const has = (column: number, row: number, port: Port): boolean =>
    found.get(cellKey(column, row))?.has(port) ?? false;

  const cells: Record<string, Cell> = {};
  for (const [key, ports] of found) {
    const [column, row] = key.split(",").map(Number);
    const kept = PORTS.filter((port) => {
      if (!ports.has(port)) return false;
      const reaches = MEETS[port].some((step) =>
        has(column + step.column, row + step.row, step.port),
      );
      if (reaches) return true;
      // An end, pointing at nothing: kept only where it is the letter's own
      // tip rather than the place one stroke runs into another.
      return ports.get(port) === true && ports.size <= 2;
    });
    if (kept.length > 0) cells[key] = { ports: kept };
  }
  if (Object.keys(cells).length === 0) return null;
  return { columns: Math.max(1, widest), cells };
}

interface Where {
  column: number;
  row: number;
}

/**
 * The path a spine takes once it has agreed to live on the grid.
 *
 * A curve is followed as drawn, because a curve on a grid is whatever the grid
 * can make of it and following it is the only honest answer. A straight run is
 * not: it is replaced by a route between the same two points made only of the
 * eight directions a grid has.
 *
 * Which matters more than it sounds. Traced as drawn, the leg of an A -- some
 * seventy degrees, which is not a direction this grid has -- crosses each cell
 * by a slightly different pair of doors, and the stroke comes out as a row of
 * elbows pointing different ways: a serrated edge that reads as a mistake
 * rather than as a decision. Routed, it is two cells of diagonal and two of
 * upright, which is what a letter built out of parts actually looks like, and
 * which every kit alphabet ever cut does with its A.
 */
function laidOut(spine: Spine, steps: number, unit: number, left: number): Vec2[] {
  const straight = spine.segments.every((segment) => segment.kind === "line");
  if (!straight) return alongSpine(spine, steps);

  const points: Vec2[] = [];
  for (const segment of spine.segments) {
    if (segment.kind !== "line") continue;
    const route = octilinear(segment.from, segment.to, unit, left);
    for (let at = 1; at < route.length; at++) {
      // Six a step is finer than a cell, so no cell is jumped over.
      const from = route[at - 1];
      const to = route[at];
      if (points.length === 0) points.push(from);
      for (let part = 1; part <= 6; part++) {
        points.push({
          x: from.x + ((to.x - from.x) * part) / 6,
          y: from.y + ((to.y - from.y) * part) / 6,
        });
      }
    }
  }
  return points.length >= 2 ? points : alongSpine(spine, steps);
}

/**
 * A route between two points using only the eight directions of the grid.
 *
 * Both ends are pulled onto the half-cell lattice first -- which is exactly the
 * set of places a port can be -- and then the difference is spent as far as it
 * will go diagonally and the rest of the way square. Diagonally first, because
 * the corner that leaves belongs at the end of a stroke rather than the start
 * of it: the leg of an A wants to arrive at its foot upright.
 */
function octilinear(from: Vec2, to: Vec2, unit: number, left: number): Vec2[] {
  const step = unit / 2;
  const along = { x: to.x - from.x, y: to.y - from.y };
  const start = onLattice(from, step, left, along);
  const finish = onLattice(to, step, left, along);
  const across = finish.i - start.i;
  const up = finish.j - start.j;
  if (across === 0 && up === 0) return [pointOf(start, step, left), pointOf(finish, step, left)];

  /*
   * A diagonal has to cross both boundaries at once, or it is not a diagonal.
   *
   * The lattice is half a cell, so a diagonal step is half a cell too -- and
   * half the time that lands the run on the middles of the edges rather than
   * on the corners. From there the cells are entered one boundary at a time,
   * across and then up and then across, and what was drawn as a clean diagonal
   * comes back as a staircase of elbows: it is what took the crossing out of
   * an X and left the two halves of a w unjoined.
   *
   * Whether it happens depends on where the run began and which way it leans,
   * which is a parity argument that is easy to get backwards. So it is asked
   * rather than worked out: take the first step and see whether the cell
   * changed in both axes. If it did not, the run starts half a cell along its
   * shorter side instead, which puts it back on the corners -- and half a cell
   * is inside the rounding the route has already done to both its ends.
   */
  let from_ = start;
  let across_ = across;
  let up_ = up;
  if (across !== 0 && up !== 0) {
    const stepped = { i: from_.i + Math.sign(across_), j: from_.j + Math.sign(up_) };
    if (!crossesBoth(from_, stepped)) {
      from_ =
        Math.abs(across_) <= Math.abs(up_)
          ? { i: from_.i + Math.sign(across_), j: from_.j }
          : { i: from_.i, j: from_.j + Math.sign(up_) };
      across_ = finish.i - from_.i;
      up_ = finish.j - from_.j;
    }
  }

  /*
   * And it has to be a whole number of cells, for the same reason.
   *
   * Seven half-steps of diagonal is three cells and a half, and the half at
   * the end crosses one boundary on its own -- one elbow, at the point of the
   * letter where it shows most. What is left over is spent square, which is
   * what the rest of the route does with it anyway.
   */
  const reach = Math.min(Math.abs(across_), Math.abs(up_));
  const slant = reach - (reach % 2);

  /*
   * What is left over is spent half before the diagonal and half after it.
   *
   * All of it used to go after, so that a stroke arrived at its foot upright.
   * It does -- and it also made every diagonal in the alphabet lopsided,
   * because two strokes that mirror each other are drawn from opposite ends:
   * the tail landed at the top of one and the bottom of the other, and an X
   * came back with one arm longer than the other and no crossing in the
   * middle. Split, a stroke and its mirror come back as mirrors, and both
   * still arrive upright at both ends.
   */
  /*
   * What is left over is spent half before the diagonal and half after it.
   *
   * All of it used to go after, so that a stroke arrived at its foot upright.
   * It does -- and it also made every diagonal in the alphabet lopsided,
   * because two strokes that mirror each other are drawn from opposite ends:
   * the tail landed at the top of one and the bottom of the other, and an X
   * came back with one arm longer than the other and no crossing in the
   * middle. Split, a stroke and its mirror come back as mirrors, and both
   * still arrive upright at both ends.
   */
  const leftX = Math.abs(across_) - slant;
  const leftY = Math.abs(up_) - slant;
  const opening = {
    i: from_.i + Math.sign(across_) * Math.floor(leftX / 2),
    j: from_.j + Math.sign(up_) * Math.floor(leftY / 2),
  };
  const corner = {
    i: opening.i + Math.sign(across_) * slant,
    j: opening.j + Math.sign(up_) * slant,
  };
  const route = [start, from_, opening, corner, finish].map((one) => pointOf(one, step, left));
  // Two of the three coincide whenever the run is purely square or purely
  // diagonal, which is most of an alphabet.
  return route.filter(
    (one, at) => at === 0 || Math.hypot(one.x - route[at - 1].x, one.y - route[at - 1].y) > 1e-6,
  );
}

/** Whether a step between two lattice points leaves one cell for its diagonal neighbour. */
function crossesBoth(from: { i: number; j: number }, to: { i: number; j: number }): boolean {
  return (
    Math.floor(from.i / 2) !== Math.floor(to.i / 2) &&
    Math.floor(from.j / 2) !== Math.floor(to.j / 2)
  );
}

/**
 * The nearest place on the half-cell lattice a stroke is allowed to be.
 *
 * Every port of every cell is a point on this lattice, and the only points on
 * it that are not ports are the cell middles -- both coordinates odd -- which
 * is why one of them gives way when a point lands there.
 */
function onLattice(point: Vec2, step: number, left: number, along: Vec2): { i: number; j: number } {
  const overX = (point.x - left) / step;
  const overY = point.y / step;
  const i = Math.round(overX);
  const j = Math.round(overY);
  if (Math.abs(i % 2) !== 1 || Math.abs(j % 2) !== 1) return { i, j };

  /*
   * A cell's middle, so one of the two has to give. It has to be the one along
   * the stroke, not the one across it.
   *
   * Moving whichever was rounded furthest is the obvious rule and it is wrong
   * in the way that matters: the nearest escape from the middle of a cell is
   * usually sideways, so the top of a stem was quietly slid into the next
   * column, and the stem was then routed diagonally to reach it. Lengthening a
   * stroke by half a cell is a decision anybody can see; moving it sideways
   * off its own column is a letter falling apart for no visible reason.
   */
  const sideways = Math.abs(along.x) > Math.abs(along.y);
  return sideways ? { i: i + (overX >= i ? 1 : -1), j } : { i, j: j + (overY >= j ? 1 : -1) };
}

const pointOf = (lattice: { i: number; j: number }, step: number, left: number): Vec2 => ({
  x: left + lattice.i * step,
  y: lattice.j * step,
});

/** The eight directions a grid has, by the octant they fall in. */
const COMPASS: Port[] = ["e", "ne", "n", "nw", "w", "sw", "s", "se"];

/** Which way a direction points, snapped to the eight a grid has. */
function compass(x: number, y: number): Port {
  if (x === 0 && y === 0) return "n";
  const octant = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  return COMPASS[((octant % 8) + 8) % 8];
}

/**
 * Which door of `cell` a stroke used on its way to or from `neighbour`.
 *
 * The side is decided by the neighbour and nothing else, which is the half
 * that has to be exact: a step east leaves by an eastern door however close to
 * a corner the crossing fell, and a stroke that never crosses the west
 * boundary never gets a western door.
 *
 * Which of the three doors on that side is decided by where along it the
 * stroke actually went through, and that is the half that makes a curve look
 * like one. A bowl crosses the top of a cell's east edge rather than the
 * middle of it, and drawn from the corner it keeps turning; drawn from the
 * middle of the edge it comes back a flat side, which is what turned every O
 * and G and g in the alphabet into a box.
 *
 * Signed rather than subtracted, so a walk that somehow skipped a cell still
 * names a door this cell actually has rather than a direction two cells away.
 */
function portCrossing(cell: Where, neighbour: Where, at: Vec2, box: Bounds): Port {
  const across = Math.sign(neighbour.column - cell.column);
  const up = Math.sign(neighbour.row - cell.row);
  // A step that changes both is a corner, and there is nothing to choose.
  if (across !== 0 && up !== 0) return compass(across, up);

  // How far along the side the stroke went through, from its low end.
  const along =
    across !== 0
      ? (at.y - box.yMin) / (box.yMax - box.yMin)
      : (at.x - box.xMin) / (box.xMax - box.xMin);
  const lean = along < CORNER ? -1 : along > 1 - CORNER ? 1 : 0;
  return across !== 0 ? compass(across, lean) : compass(lean, up);
}

/**
 * How near a corner a crossing has to be to count as one.
 *
 * A third leaves the middle third of every side to the middle door, which is
 * where anything running straight through goes. Wider and a stem a little off
 * centre starts leaving by a corner; narrower and the bowls stop turning.
 */
const CORNER = 1 / 3;

const heading = (from: Vec2, to: Vec2): Vec2 => ({ x: to.x - from.x, y: to.y - from.y });
