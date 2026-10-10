/**
 * The later soft fields drawn faster, and drawn the same.
 *
 * `soft-speed.test.ts` asks, of the first soft finishes at their extremes,
 * that a stroke's outline handed on to its own ink draws what sweeping it
 * again draws. This asks the same of the fields that came after them at
 * theirs -- the heads (`slab.headKeep`, `headDepth`), the arches' pen and the
 * r's arm (`shoulder.angle`, `armRise`), the middle arm, the heft's fade and
 * the blunt bowl ends, a stroke thinned into its drop (`terminal.dropTaper`)
 * and the pen read as held -- on the Soft Serif, every letter in every form.
 *
 * And it asks of the sorted ink the drops are measured against (`banded`)
 * that it winds round every point exactly as the ink it was sorted from:
 * the drops are only as fast as that, and only the same if it is exact.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import type { Contour } from "@/font/types";
import { drawLetter, letterNames } from "./build";
import { widthedStyle } from "./family";
import { readyToShape } from "./layers";
import { everyFormOf, recipeOf } from "./letters";
import { openWaveBook, type WaveBook } from "./shapes";
import {
  banded,
  type Flat,
  flatten,
  flattenedArea,
  flattenRows,
  type Rows,
  windingAt,
  windingIn,
} from "./soft";
import { SOFT_SERIF } from "./starts";
import type { Style } from "./style";
import { sweep } from "./sweep";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

/** The drawing as it would be stored, to the last bit. */
function drawn(name: string, style: Style, form: string): string {
  const letter = drawLetter(name, style, form || undefined);
  return JSON.stringify(
    letter ? { contours: letter.contours, advance: letter.advanceWidth } : null,
  );
}

/** The same, drawn against a wave book being taken down: by two sweeps of every stroke. */
function drawnTwice(name: string, style: Style, form: string): string {
  const book: WaveBook = {
    lengths: new Map(),
    bowls: new Map(),
    balls: new Map(),
    corners: new Map(),
    recording: true,
  };
  const was = openWaveBook(book);
  try {
    return drawn(name, style, form);
  } finally {
    openWaveBook(was);
  }
}

/** Every letter in every form at these pens, at the regular width, where the two ways disagree. */
function disagreements(face: Style, pens: number[]): string[] {
  const differ: string[] = [];
  for (const pen of pens) {
    const style = widthedStyle({ ...face, pen: { ...face.pen, weight: pen } }, 100);
    for (const name of letterNames()) {
      for (const { id } of everyFormOf(name)) {
        if (drawn(name, style, id) !== drawnTwice(name, style, id)) {
          differ.push(`${name}${id ? `/${id}` : ""} at ${pen}`);
        }
      }
    }
  }
  return differ;
}

/** The Soft Serif with the later fields at their most, the arches' pen turned `angle`. */
function most(angle: number): Style {
  const { metrics, parts } = SOFT_SERIF;
  return {
    ...SOFT_SERIF,
    metrics: { ...metrics, middleArm: 0.5, heldPen: true },
    parts: {
      ...parts,
      slab: { ...parts.slab, headKeep: true, headDepth: 1, swell: 0.6 },
      shoulder: { ...parts.shoulder, angle, armRise: 0.1 },
      bowl: { ...parts.bowl, heft: 0.5, heftFade: 1, blunt: 1 },
      terminal: {
        ...parts.terminal,
        dropTaper: 0.85,
        dropSize: 0.6,
        dropHang: 1.5,
        dropCurl: 1,
      },
    },
  };
}

/** And at their least above nought. */
function least(): Style {
  const { metrics, parts } = SOFT_SERIF;
  return {
    ...SOFT_SERIF,
    metrics: { ...metrics, middleArm: 1 },
    parts: {
      ...parts,
      slab: { ...parts.slab, headDepth: 0.05 },
      shoulder: { ...parts.shoulder, angle: 1, armRise: 0.005 },
      bowl: { ...parts.bowl, heftFade: 0.05, blunt: 0.05 },
      terminal: { ...parts.terminal, dropTaper: 0.05 },
    },
  };
}

describe("a stroke's outline handed on to its own ink, with the later soft fields", () => {
  it("draws every Soft Serif letter at their most, the arches turned one way, as sweeping it again does", {
    timeout: 300_000,
  }, () => {
    expect(disagreements(most(45), [30, 142, 260])).toEqual([]);
  });

  it("and the arches turned the other way", { timeout: 300_000 }, () => {
    expect(disagreements(most(-45), [30, 142, 260])).toEqual([]);
  });

  it("and at their least above nought", { timeout: 300_000 }, () => {
    expect(disagreements(least(), [30, 142, 260])).toEqual([]);
  });
});

describe("the sorted ink a thinned drop is measured against", () => {
  /** A flattened outline's points as rows of numbers, its boxes as they were. */
  function rowsOf(flat: Flat): Rows {
    return {
      polygons: flat.polygons.map(({ points, xMin, yMin, xMax, yMax }) => ({
        xs: Float64Array.from(points, (point) => point.x),
        ys: Float64Array.from(points, (point) => point.y),
        xMin,
        yMin,
        xMax,
        yMax,
      })),
    };
  }

  /** The strokes of the letters that hang drops, swept, at a light, a regular and a black pen. */
  function strokes(): Array<[string, Contour[]]> {
    const out: Array<[string, Contour[]]> = [];
    for (const pen of [30, 84, 260]) {
      const style: Style = { ...SOFT_SERIF, pen: { ...SOFT_SERIF.pen, weight: pen } };
      for (const name of ["a", "c", "f", "g", "j", "r", "y", "s", "S", "six", "nine", "o", "O"]) {
        const recipe = recipeOf(name, SOFT_SERIF.forms?.[name] ?? "")!(style);
        recipe.strokes.forEach((stroke, index) => {
          const swept = sweep(stroke);
          if (swept.length > 0) out.push([`${name} stroke ${index} at ${pen}`, swept]);
        });
      }
    }
    return out;
  }

  it("measures the area of the polygon flatten makes, to the last bit, without making it", () => {
    const wrong: string[] = [];
    for (const [label, swept] of strokes()) {
      for (const contour of swept) {
        // As softCorners summed it, over the polygon of the contour closed.
        const closed = { nodes: contour.nodes, closed: true };
        const [ring] = flatten([closed]).polygons;
        let area = 0;
        for (let k = 0; k < ring.points.length; k++) {
          const p = ring.points[k];
          const q = ring.points[(k + 1) % ring.points.length];
          area += p.x * q.y - q.x * p.y;
        }
        if (!Object.is(flattenedArea(closed), area)) wrong.push(label);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("is flattened into rows as flatten flattens it, every number and box the same", () => {
    const wrong: string[] = [];
    for (const [label, swept] of strokes()) {
      for (const chords of [12, 48]) {
        const flat = flatten(swept, chords);
        const rows = flattenRows(swept, chords);
        if (rows.polygons.length !== flat.polygons.length) wrong.push(`${label}: polygons`);
        flat.polygons.forEach((polygon, index) => {
          const row = rows.polygons[index];
          const same =
            row !== undefined &&
            row.xs.length === polygon.points.length &&
            polygon.points.every(
              (point, k) => Object.is(point.x, row.xs[k]) && Object.is(point.y, row.ys[k]),
            ) &&
            Object.is(row.xMin, polygon.xMin) &&
            Object.is(row.yMin, polygon.yMin) &&
            Object.is(row.xMax, polygon.xMax) &&
            Object.is(row.yMax, polygon.yMax);
          if (!same) wrong.push(`${label} (${chords}): polygon ${index}`);
        });
      }
    }
    expect(wrong).toEqual([]);
  });
  /** Points over and round an outline's box: a grid, every point of it, and each a hair off. */
  function probes(contours: Contour[]): Array<{ x: number; y: number }> {
    const flat = flatten(contours, 48);
    const out: Array<{ x: number; y: number }> = [];
    for (const polygon of flat.polygons) {
      const { xMin, yMin, xMax, yMax } = polygon;
      for (let i = -2; i <= 42; i++) {
        for (let j = -2; j <= 42; j++) {
          out.push({ x: xMin + ((xMax - xMin) * i) / 40, y: yMin + ((yMax - yMin) * j) / 40 });
        }
      }
      for (const point of polygon.points) {
        out.push(point, { x: point.x + 1e-9, y: point.y }, { x: point.x, y: point.y - 1e-9 });
      }
    }
    return out;
  }

  it("winds round every point as the ink it was sorted from, on the strokes of the drop letters", () => {
    const wrong: string[] = [];
    for (const [label, swept] of strokes()) {
      for (const chords of [12, 48]) {
        const flat = flatten(swept, chords);
        const sorted = banded(flattenRows(swept, chords));
        for (const point of probes(swept)) {
          if (windingIn(sorted, point) !== windingAt(flat, point))
            wrong.push(`${label} (${chords}): ${point.x},${point.y}`);
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
  });

  it("winds as it does where an outline is level, folds back, repeats a point or is not a number", () => {
    // A polygon as `flatten` lays one out, its box taken as `flatten` takes it.
    const polygon = (points: Array<[number, number]>) => {
      const ring = points.map(([x, y]) => ({ x, y }));
      return {
        points: ring,
        xMin: Math.min(...ring.map((one) => one.x)),
        yMin: Math.min(...ring.map((one) => one.y)),
        xMax: Math.max(...ring.map((one) => one.x)),
        yMax: Math.max(...ring.map((one) => one.y)),
      };
    };
    const shapes = [
      // A square, its edges level and upright.
      [
        polygon([
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ]),
      ],
      // Two squares, one inside the other the other way round, and one over it the same way.
      [
        polygon([
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ]),
        polygon([
          [2, 2],
          [2, 8],
          [8, 8],
          [8, 2],
        ]),
        polygon([
          [5, 5],
          [15, 5],
          [15, 15],
          [5, 15],
        ]),
      ],
      // A bow tie, crossing itself, with a repeated point and a spike.
      [
        polygon([
          [0, 0],
          [10, 10],
          [10, 10],
          [10, 0],
          [0, 10],
          [5, 30],
          [5, 5],
        ]),
      ],
      // Level all round: a line on its side.
      [
        polygon([
          [0, 3],
          [10, 3],
          [4, 3],
        ]),
      ],
      // A point that is not a number, and one at no distance at all.
      [
        polygon([
          [0, 0],
          [10, 0],
          [Number.NaN, 5],
          [10, 10],
          [0, 10],
        ]),
      ],
      [
        polygon([
          [0, 0],
          [10, 0],
          [10, Number.POSITIVE_INFINITY],
          [0, 10],
        ]),
      ],
      [
        polygon([
          [-0, -0],
          [0, 0],
          [0, 0],
        ]),
      ],
      // Edges ending exactly on the band boundaries of a tall thin polygon.
      [polygon(Array.from({ length: 64 }, (_, k) => [k % 2 ? 1 : 0, k] as [number, number]))],
    ];
    const wrong: string[] = [];
    shapes.forEach((polygons, index) => {
      const flat = { polygons };
      const sorted = banded(rowsOf(flat));
      const points: Array<{ x: number; y: number }> = [];
      for (let x = -3; x <= 18; x += 0.5) for (let y = -3; y <= 66; y += 0.5) points.push({ x, y });
      for (const one of polygons.flatMap((p) => p.points)) points.push(one);
      points.push({ x: Number.NaN, y: 1 }, { x: 1, y: Number.NaN }, { x: -0, y: 0 });
      for (const point of points) {
        if (windingIn(sorted, point) !== windingAt(flat, point))
          wrong.push(`shape ${index} at ${point.x},${point.y}`);
      }
    });
    expect(wrong).toEqual([]);
  });
});
