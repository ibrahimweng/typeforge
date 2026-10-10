/**
 * The soft finishes made faster again, and still drawing the same.
 *
 * The finishes measure lengths by `hypot`, a copy of `Math.hypot` for two
 * numbers written out step for step: asked here of every kind of number --
 * noughts of either sign, the least and the greatest there are, infinities,
 * numbers that are not, and many thousands of every size between -- it gives
 * the very number `Math.hypot` gives, to the last bit.
 *
 * And the filed ink the drops, the pears' necks and the inside roundings are
 * measured against (`banded`) is asked, of polygons drawn at random with
 * level runs, repeated points, spikes and numbers that are not finite, to
 * wind round every point exactly as the ink it was filed from does.
 */

import { describe, expect, it } from "vitest";

import { banded, type Flat, hypot, type Rows, windingAt, windingIn } from "./soft";

/** A little generator of the same numbers every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("hypot", () => {
  const special = [
    0,
    -0,
    1,
    -1,
    0.1,
    0.2,
    1 / 3,
    3,
    4,
    5e-324,
    -5e-324,
    2.2250738585072014e-308,
    1e-320,
    1e-160,
    1e-154,
    1e154,
    1e160,
    1e300,
    1.7976931348623157e308,
    -1.7976931348623157e308,
    2 ** 1023,
    2 ** -1074,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NaN,
  ];

  it("is Math.hypot for every pair of the numbers at the edges", () => {
    const wrong: string[] = [];
    for (const x of special) {
      for (const y of special) {
        if (!Object.is(hypot(x, y), Math.hypot(x, y))) wrong.push(`${x}, ${y}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("is Math.hypot for numbers of every size, of the sizes a letter's are, and nearly equal", () => {
    const next = random(20261010);
    const wrong: string[] = [];
    for (let k = 0; k < 200_000; k++) {
      let x: number;
      let y: number;
      switch (k % 5) {
        case 0:
          x = (next() - 0.5) * 2000;
          y = (next() - 0.5) * 2000;
          break;
        case 1:
          x = (next() - 0.5) * 10 ** (next() * 600 - 300);
          y = (next() - 0.5) * 10 ** (next() * 600 - 300);
          break;
        case 2:
          x = (next() - 0.5) * 1000;
          y = x * (1 + (next() - 0.5) * 1e-12);
          break;
        case 3:
          x = Math.round((next() - 0.5) * 2e6) / 1024;
          y = (next() - 0.5) * 1e-6;
          break;
        default:
          x = (next() - 0.5) * 1e-3;
          y = (next() - 0.5) * 1e5;
      }
      if (!Object.is(hypot(x, y), Math.hypot(x, y))) wrong.push(`${x}, ${y}`);
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });
});

describe("the filed ink", () => {
  /** A flattened outline as `flatten` lays one out, and the same as rows. */
  function both(polygons: Array<Array<[number, number]>>): { flat: Flat; rows: Rows } {
    const flat: Flat = {
      polygons: polygons.map((ring) => {
        const points = ring.map(([x, y]) => ({ x, y }));
        let xMin = Infinity;
        let yMin = Infinity;
        let xMax = -Infinity;
        let yMax = -Infinity;
        for (const point of points) {
          xMin = Math.min(xMin, point.x);
          yMin = Math.min(yMin, point.y);
          xMax = Math.max(xMax, point.x);
          yMax = Math.max(yMax, point.y);
        }
        return { points, xMin, yMin, xMax, yMax };
      }),
    };
    const rows: Rows = {
      polygons: flat.polygons.map(({ points, xMin, yMin, xMax, yMax }) => ({
        xs: points.map((point) => point.x),
        ys: points.map((point) => point.y),
        xMin,
        yMin,
        xMax,
        yMax,
      })),
    };
    return { flat, rows };
  }

  it("winds round every point as the ink it was filed from, on polygons drawn at random", () => {
    const next = random(1010);
    const wrong: string[] = [];
    for (let shape = 0; shape < 400; shape++) {
      const polygons: Array<Array<[number, number]>> = [];
      const count = 1 + Math.floor(next() * 3);
      for (let p = 0; p < count; p++) {
        const length = 1 + Math.floor(next() * (shape % 4 === 0 ? 400 : 40));
        const ring: Array<[number, number]> = [];
        for (let k = 0; k < length; k++) {
          const kind = next();
          // Points on a small grid, so that level edges, repeated points and points
          // exactly on an edge's height are common; now and then not a number.
          let x = Math.round(next() * 20);
          let y = Math.round(next() * 20);
          if (kind < 0.02) y = Number.NaN;
          else if (kind < 0.03) x = Number.POSITIVE_INFINITY;
          else if (kind < 0.3 && ring.length > 0) y = ring[ring.length - 1][1];
          ring.push([x, y]);
        }
        polygons.push(ring);
      }
      const { flat, rows } = both(polygons);
      const filed = banded(rows);
      for (let i = 0; i < 60; i++) {
        const point = {
          x: Math.round(next() * 44 - 2) / 2,
          y: i % 3 === 0 ? Math.round(next() * 22) : next() * 22 - 1,
        };
        if (windingIn(filed, point) !== windingAt(flat, point)) {
          wrong.push(`shape ${shape} at ${point.x},${point.y}`);
        }
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });
});
