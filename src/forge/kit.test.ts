import { describe, expect, it } from "vitest";

import { contourArea, contoursBounds } from "@/font/geometry";
import {
  assemble,
  cellBox,
  cellKey,
  emptyKit,
  filled,
  FILL_KINDS,
  portAt,
  PORTS,
  rowsOf,
  seedTiles,
  unitOf,
  type Kit,
  type Fill,
  type Port,
  type Tiles,
} from "./kit";
import { recipeOf } from "./letters";
import { SANS } from "./style";
import { sweep } from "./sweep";

const kitWith = (patch: Partial<Kit> = {}): Kit => ({ ...emptyKit(), ...patch });

const oneCell = (ports: Port[], fill?: Fill): Tiles => ({
  columns: 1,
  cells: { [cellKey(0, 0)]: { ports, ...(fill ? { fill } : {}) } },
});

describe("the grid", () => {
  it("takes its size from the cap height, so it is a proportion and not a number", () => {
    const kit = kitWith({ grid: { rows: 5, below: 2, above: 1 } });
    expect(unitOf(SANS, kit.grid)).toBeCloseTo(SANS.metrics.capHeight / 5, 6);

    const taller = kitWith({ grid: { rows: 10, below: 2, above: 1 } });
    expect(unitOf(SANS, taller.grid)).toBeCloseTo(unitOf(SANS, kit.grid) / 2, 6);
  });

  it("reaches below the baseline and above the cap", () => {
    const rows = rowsOf({ rows: 5, below: 2, above: 1 });
    expect(rows[0]).toBe(-2);
    expect(rows[rows.length - 1]).toBe(5);
    expect(rows).toHaveLength(8);
  });

  it("puts the eight ports where a stroke can leave a square", () => {
    const box = cellBox(0, 0, 100, 0);
    expect(portAt("n", box)).toEqual({ x: 50, y: 100 });
    expect(portAt("e", box)).toEqual({ x: 100, y: 50 });
    expect(portAt("sw", box)).toEqual({ x: 0, y: 0 });
    // Every one of them is on the boundary, and none is in the middle.
    for (const port of PORTS) {
      const at = portAt(port, box);
      expect(at.x === 0 || at.x === 100 || at.y === 0 || at.y === 100).toBe(true);
      expect(at.x === 50 && at.y === 50).toBe(false);
    }
  });
});

describe("drawing a cell", () => {
  const kit = kitWith();

  it("runs straight through between ports that face each other", () => {
    const made = assemble(oneCell(["n", "s"]), SANS, kit);
    expect(made.strokes).toHaveLength(1);
    expect(made.strokes[0].spine.segments).toHaveLength(1);
    const [segment] = made.strokes[0].spine.segments;
    expect(segment.kind).toBe("line");
    if (segment.kind === "line") {
      // Dead vertical: the two ends share an x.
      expect(segment.from.x).toBeCloseTo(segment.to.x, 6);
    }
  });

  it("runs along an edge between two ports that share one", () => {
    // The case that ruins an alphabet when it is missed: the two ends of a
    // cell's bottom edge are a straight line, not a turn through the middle.
    const made = assemble(oneCell(["sw", "se"]), SANS, kit);
    expect(made.strokes).toHaveLength(1);
    const [segment] = made.strokes[0].spine.segments;
    expect(segment.kind).toBe("line");
    if (segment.kind === "line") {
      expect(segment.from.y).toBeCloseTo(segment.to.y, 6);
      expect(segment.from.y).toBeCloseTo(0, 6);
    }
  });

  it("turns through the middle between ports at an angle", () => {
    const made = assemble(oneCell(["n", "e"]), SANS, kit);
    expect(made.strokes).toHaveLength(1);
    // Rounded off, so a line and an arc and a line rather than two lines.
    expect(made.strokes[0].spine.segments.some((one) => one.kind === "arc")).toBe(true);
  });

  it("takes the turn square when the roundness is off", () => {
    const made = assemble(oneCell(["n", "e"]), SANS, kitWith({ roundness: 0 }));
    expect(made.strokes[0].spine.segments.every((one) => one.kind === "line")).toBe(true);
  });

  it("crosses two runs through a cell with four ports", () => {
    const made = assemble(oneCell(["n", "e", "s", "w"]), SANS, kit);
    expect(made.strokes).toHaveLength(2);
    for (const one of made.strokes) expect(one.spine.segments).toHaveLength(1);
  });

  it("fills a cell told to be solid", () => {
    const made = assemble(oneCell([], { kind: "full", turn: 0 }), SANS, kit);
    expect(made.blocks).toHaveLength(1);
    const unit = unitOf(SANS, kit.grid);
    const box = contoursBounds(made.blocks);
    expect(box.xMax - box.xMin).toBeCloseTo(unit, 6);
    expect(box.yMax - box.yMin).toBeCloseTo(unit, 6);
  });

  it("gives a letter the width of its cells", () => {
    const unit = unitOf(SANS, kit.grid);
    const made = assemble({ columns: 4, cells: {} }, SANS, kit);
    expect(made.advanceWidth).toBeCloseTo(4 * unit + SANS.metrics.sidebearing * 2, 6);
  });
});

describe("filling a cell", () => {
  const kit = kitWith();
  const unit = unitOf(SANS, kit.grid);
  const box = { xMin: 0, yMin: 0, xMax: unit, yMax: unit };
  const area = (contours: ReturnType<typeof filled>): number =>
    Math.abs(contours.reduce((total, one) => total + contourArea(one), 0));

  /*
   * How far off a true circle a quarter arc written as one cubic is.
   *
   * A known and constant error, and small: a fifth of a percent of the area,
   * which on a cell of a hundred and forty units is a fifth of a unit at the
   * widest point of the arc -- below anything a font file records. Stated as a
   * share rather than as a number of decimal places, because the number of
   * decimal places that happens to pass depends on how big the cell is.
   */
  const NEARLY = 0.002;
  const near = (measured: number, exact: number, what: string): void => {
    expect(Math.abs(measured - exact) / exact, what).toBeLessThan(NEARLY);
  };

  it("puts down the shape it says, at the size of the cell", () => {
    expect(area(filled({ kind: "full", turn: 0 }, box))).toBeCloseTo(unit * unit, 3);
    expect(area(filled({ kind: "half", turn: 0 }, box))).toBeCloseTo((unit * unit) / 2, 3);
    expect(area(filled({ kind: "wedge", turn: 0 }, box))).toBeCloseTo((unit * unit) / 2, 3);
    // A quarter disc of the cell's own radius.
    near(area(filled({ kind: "pie", turn: 0 }, box)), (Math.PI * unit * unit) / 4, "pie");
  });

  it("takes out exactly what it puts in", () => {
    // The bite is the cell without the pie, so the two are the whole cell.
    for (const turn of [0, 1, 2, 3]) {
      const both =
        area(filled({ kind: "pie", turn }, box)) + area(filled({ kind: "bite", turn }, box));
      near(both, unit * unit, `turn ${turn}`);
    }
  });

  it("makes a circle out of four quarters about a shared corner", () => {
    /*
     * The reason the quarter disc is a tile at all. Four cells meeting at a
     * corner, each holding the quarter nearest it, are one disc of the block's
     * own width -- which is how a grid alphabet gets a round letter without
     * anything being swept anywhere.
     */
    const round: Tiles = {
      columns: 2,
      cells: {
        [cellKey(0, 0)]: { ports: [], fill: { kind: "pie", turn: 2 } },
        [cellKey(1, 0)]: { ports: [], fill: { kind: "pie", turn: 3 } },
        [cellKey(0, 1)]: { ports: [], fill: { kind: "pie", turn: 1 } },
        [cellKey(1, 1)]: { ports: [], fill: { kind: "pie", turn: 0 } },
      },
    };
    const made = assemble(round, SANS, kit);
    expect(made.blocks).toHaveLength(4);
    near(area(made.blocks), Math.PI * unit * unit, "circle");

    // And it is round: as wide as it is tall, and both are the block's width.
    const bounds = contoursBounds(made.blocks);
    expect(bounds.xMax - bounds.xMin).toBeCloseTo(unit * 2, 3);
    expect(bounds.yMax - bounds.yMin).toBeCloseTo(unit * 2, 3);
  });

  it("turns a shape without changing how much of it there is", () => {
    for (const kind of FILL_KINDS) {
      const upright = filled({ kind, turn: 0 }, box);
      for (const turn of [1, 2, 3]) near(area(filled({ kind, turn }, box)), area(upright), `${kind} ${turn}`);
    }
  });

  it("fills and strokes the same cell at once", () => {
    // A block with a stroke leaving it is one cell, not a choice between two.
    const tiles: Tiles = {
      columns: 1,
      cells: { [cellKey(0, 0)]: { ports: ["n", "s"], fill: { kind: "full", turn: 0 } } },
    };
    const made = assemble(tiles, SANS, kit);
    expect(made.blocks).toHaveLength(1);
    expect(made.strokes).toHaveLength(1);
  });
});

describe("where a stroke stops", () => {
  const kit = kitWith();

  it("cuts square where the next cell carries it on", () => {
    const tiles: Tiles = {
      columns: 1,
      cells: {
        [cellKey(0, 0)]: { ports: ["n", "s"] },
        [cellKey(0, 1)]: { ports: ["n", "s"] },
      },
    };
    const made = assemble(tiles, SANS, kit);
    const shared = made.strokes.flatMap((one) => [one.start, one.end]).filter((one) => !one.open);
    // The two ends that meet at the shared boundary are buried.
    expect(shared.length).toBeGreaterThanOrEqual(2);
  });

  it("knows a corner is shared with three cells and not one", () => {
    /*
     * The fact that decides whether a diagonal holds together. A stroke
     * leaving through a corner into the cell beside it is carrying on; read as
     * though only the cell diagonally across could catch it, every diagonal in
     * an alphabet is cut in half and given terminals on both cut ends.
     */
    const tiles: Tiles = {
      columns: 2,
      cells: {
        [cellKey(0, 0)]: { ports: ["sw", "ne"] },
        [cellKey(1, 0)]: { ports: ["nw", "se"] },
      },
    };
    const made = assemble(tiles, SANS, kit);
    const ends = made.strokes.flatMap((one) => [one.start, one.end]);
    // Four ends: two out at the far corners, two meeting in the middle.
    expect(ends.filter((one) => one.open).length).toBe(2);
  });
});

describe("laying an alphabet on the grid", () => {
  const kit = kitWith();
  const seed = (letter: string): Tiles => {
    const recipe = recipeOf(letter);
    expect(recipe, letter).toBeDefined();
    const tiles = seedTiles(recipe!(SANS).strokes, SANS, kit);
    expect(tiles, letter).not.toBeNull();
    return tiles!;
  };

  it("puts an H on the grid as two stems and a bar", () => {
    const tiles = seed("H");
    const cells = Object.entries(tiles.cells);
    // Two columns of cells that run straight up, and one row joining them.
    const upright = cells.filter(([, cell]) => cell.ports.includes("n") && cell.ports.includes("s"));
    expect(upright.length).toBeGreaterThanOrEqual(8);
    const columns = new Set(upright.map(([key]) => key.split(",")[0]));
    expect(columns.size).toBe(2);

    // And a row that crosses between them, in cells that have no upright at all.
    const across = cells.filter(([, cell]) => !cell.ports.includes("n") && !cell.ports.includes("s"));
    expect(across.length).toBeGreaterThan(0);
    for (const [, cell] of across) {
      expect(cell.ports.some((port) => port.includes("e") || port.includes("w"))).toBe(true);
    }
  });

  it("leaves no cell stranded on its own", () => {
    /*
     * A cell whose ink touches nothing else is a speck beside the letter, and
     * it is what a grid full of half-recorded crossings produces. Checked
     * across the alphabet rather than on one letter, because the ones it
     * happened to were never the ones being looked at.
     */
    for (const letter of "ABCDEFGHIKLMNOPRSTUabcdeghnoprstu") {
      const tiles = seed(letter);
      const keys = Object.keys(tiles.cells);
      if (keys.length < 2) continue;
      for (const key of keys) {
        const [column, row] = key.split(",").map(Number);
        const touching = keys.some((other) => {
          if (other === key) return false;
          const [otherColumn, otherRow] = other.split(",").map(Number);
          return Math.abs(otherColumn - column) <= 1 && Math.abs(otherRow - row) <= 1;
        });
        expect(touching, `${letter} ${key}`).toBe(true);
      }
    }
  });

  it("draws something for every letter it lays out", () => {
    for (const letter of "ABEHKMNORSTaegnorstuvxyz") {
      const tiles = seed(letter);
      const made = assemble(tiles, SANS, kit);
      const ink = [...made.strokes.flatMap((one) => sweep(one)), ...made.blocks];
      expect(ink.length, letter).toBeGreaterThan(0);
      const box = contoursBounds(ink);
      expect(box.xMax - box.xMin, letter).toBeGreaterThan(0);
      expect(box.yMax - box.yMin, letter).toBeGreaterThan(0);
    }
  });

  it("keeps the letters inside the grid it was given", () => {
    const rows = rowsOf(kit.grid);
    const unit = unitOf(SANS, kit.grid);
    for (const letter of "ABEHKgjpqy") {
      const tiles = seed(letter);
      for (const key of Object.keys(tiles.cells)) {
        const [column, row] = key.split(",").map(Number);
        expect(column, `${letter} ${key}`).toBeGreaterThanOrEqual(0);
        expect(row, `${letter} ${key}`).toBeGreaterThanOrEqual(rows[0]);
        expect(row, `${letter} ${key}`).toBeLessThanOrEqual(rows[rows.length - 1]);
      }
      const made = assemble(tiles, SANS, kit);
      expect(made.advanceWidth).toBeGreaterThan(unit);
    }
  });
});
