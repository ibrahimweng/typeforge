/**
 * The Serif held to Lora across the whole weight axis, round three: the
 * faults a letter-by-letter comparison with Lora Regular and Lora Bold found
 * at a Light, the Regular, the Bold, a Black and the slider's heaviest, each
 * held to what Lora draws or to the plain geometry of a clean letter.
 */

import { describe, expect, it } from "vitest";
import { contoursBounds, flattenContour } from "@/font/geometry";
import { drawLetter } from "./build";
import { formOf, startFrom } from "./document";
import { SERIF, type Style } from "./style";

const forge = startFrom(SERIF);
const at = (weight: number): Style => ({ ...SERIF, pen: { ...SERIF.pen, weight } });
const draw = (name: string, weight: number, style: Style = at(weight)) =>
  drawLetter(name, style, formOf(forge, name))!;
const box = (name: string, weight: number) => contoursBounds(draw(name, weight).contours);
/**
 * The ink along a row, as the union the strokes are filled as: overlapping
 * strokes counted by their winding, not paired crossing by crossing.
 */
function row(name: string, weight: number, y: number, style?: Style): Array<[number, number]> {
  const crossings: Array<[number, number]> = [];
  for (const contour of draw(name, weight, style).contours) {
    const points = flattenContour(contour, 24);
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      if (a.y <= y === b.y <= y) continue;
      crossings.push([a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x), b.y > a.y ? 1 : -1]);
    }
  }
  crossings.sort((p, q) => p[0] - q[0]);
  const runs: Array<[number, number]> = [];
  let winding = 0;
  let from = 0;
  for (const [x, turn] of crossings) {
    const was = winding;
    winding += turn;
    if (was === 0 && winding !== 0) from = x;
    if (was !== 0 && winding === 0) runs.push([from, x]);
  }
  return runs;
}
/** The same, down a column. */
function column(name: string, weight: number, x: number, style?: Style): Array<[number, number]> {
  const drawn = draw(name, weight, style);
  const crossings: Array<[number, number]> = [];
  for (const contour of drawn.contours) {
    const points = flattenContour(contour, 24).map((p) => ({ x: p.y, y: -p.x }));
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      if (a.y <= -x === b.y <= -x) continue;
      crossings.push([a.x + ((-x - a.y) / (b.y - a.y)) * (b.x - a.x), b.y > a.y ? 1 : -1]);
    }
  }
  crossings.sort((p, q) => p[0] - q[0]);
  const runs: Array<[number, number]> = [];
  let winding = 0;
  let from = 0;
  for (const [y, turn] of crossings) {
    const was = winding;
    winding += turn;
    if (was === 0 && winding !== 0) from = y;
    if (was !== 0 && winding === 0) runs.push([from, y]);
  }
  return runs;
}
const WEIGHTS = [30, 87, 142, 200, 260];

describe("the Serif's s", () => {
  it("stands upright at every weight, the upper bowl over the lower one", () => {
    for (const weight of WEIGHTS) {
      const b = box("s", weight);
      const wide = b.xMax - b.xMin;
      const through = (k: number) => row("s", weight, b.yMin + (b.yMax - b.yMin) * k);
      // The upper bowl's side is the letter's left, the lower bowl's its
      // right: past a Black they stood a quarter of the letter in from them,
      // the lower bowl back under the upper one like an italic's.
      expect(through(0.75)[0][0] - b.xMin, `s at ${weight}`).toBeLessThan(wide * 0.05);
      const low = through(0.25);
      expect(b.xMax - low[low.length - 1][1], `s at ${weight}`).toBeLessThan(wide * 0.05);
    }
  });
});

describe("the Serif's t", () => {
  it("carves its head to Lora's share of the stem, under a flag that shows at every weight", () => {
    for (const weight of [87, 142, 200, 260]) {
      const b = box("t", weight);
      const stem = row("t", weight, 250)[0];
      const stemWide = stem[1] - stem[0];
      // Lora's head is 0.41 of its stem at the Regular and 0.53 at the Bold,
      // just under the top; the construction's was the whole stem.
      const head = row("t", weight, b.yMax - 8)[0];
      expect(head[1] - head[0], `t at ${weight}`).toBeLessThan(stemWide * 0.7);
      expect(head[1], `t at ${weight}`).toBeGreaterThan(stem[1] - 3);
      // The flag stands out past the stem's left edge just over the bar, as
      // Lora's sweeps out to meet the bar's end: past a Black it was buried
      // in the stem.
      let barTop = SERIF.metrics.xHeight + weight;
      while (barTop > 300) {
        const runs = row("t", weight, barTop);
        if (runs.length > 0 && runs[0][1] - runs[0][0] > (b.xMax - b.xMin) * 0.7) break;
        barTop -= 2;
      }
      const flag = row("t", weight, barTop + 4)[0];
      expect(stem[0] - flag[0], `t at ${weight}`).toBeGreaterThan(weight * 0.1);
    }
  });
});

describe("the Serif's two and seven", () => {
  const CAP = SERIF.metrics.capHeight;
  /** The middle of the one run of ink a row crosses the diagonal in. */
  const through = (name: string, weight: number, y: number) => {
    const [run] = row(name, weight, y);
    return (run[0] + run[1]) / 2;
  };

  it("runs the two's diagonal in an S, flatter through its middle than out of the bowl", () => {
    for (const weight of [30, 87, 142]) {
      const at = [0.5, 0.4, 0.3, 0.2].map((k) => through("two", weight, CAP * k));
      // Lora's leaves the bowl at 22 degrees steeper than its chord and eases
      // to its flattest through the middle; the construction's was straight.
      const upper = at[0] - at[1];
      const middle = at[1] - at[2];
      expect(middle, `2 at ${weight}`).toBeGreaterThan(upper * 1.12);
    }
  });

  it("stands the two on a foot with Lora's upright serif at its right end", () => {
    for (const weight of [30, 87, 142, 260]) {
      // Over the foot's top, at the foot's right end: the serif.
      const foot = row("two", weight, 4);
      const runs = row("two", weight, weight * 0.35 + 45);
      const end = foot[foot.length - 1][1];
      expect(Math.abs(end - runs[runs.length - 1][1]), `2 at ${weight}`).toBeLessThan(3);
    }
  });

  it("drops the seven's stem straight down out of the corner, under a beak at the arm's end", () => {
    for (const weight of [30, 87, 142, 200, 260]) {
      const b = box("seven", weight);
      const wide = b.xMax - b.xMin;
      // Its right edge a twelfth of the height under the arm still within a
      // few units of the arm's end, as Lora's is (15 on 419): it slanted off
      // from the corner.
      if (weight <= 200) {
        const under = row("seven", weight, CAP - weight * 0.55 - CAP * 0.08);
        expect(b.xMax - under[under.length - 1][1], `7 at ${weight}`).toBeLessThan(wide * 0.065);
      }
      // And the beak hanging under the arm's left end.
      const beak = row("seven", weight, CAP - weight * 0.55 - 20)[0];
      expect(beak[0] - b.xMin, `7 at ${weight}`).toBeLessThan(3);
    }
  });
});

describe("the Serif's G", () => {
  const CAP = SERIF.metrics.capHeight;
  it("stands its upright where Lora's does, under a serif reaching both ways", () => {
    for (const weight of [30, 87, 142, 200, 260]) {
      const b = box("G", weight);
      const upright = row("G", weight, CAP * 0.3);
      const [from, to] = upright[upright.length - 1];
      // Lora's upright's right edge is 0.9 of the way across (668 of 740).
      expect((to - b.xMin) / (b.xMax - b.xMin), `G at ${weight}`).toBeGreaterThan(0.86);
      // Its serif reaching past it each side: the spur's head was a plain cut.
      let reaches = 0;
      for (let y = CAP * 0.62; y > CAP * 0.35; y -= 2) {
        const runs = row("G", weight, y);
        const [left, right] = runs[runs.length - 1];
        if (left > b.xMin + (b.xMax - b.xMin) / 2) {
          reaches = Math.max(reaches, Math.min(from - left, right - to));
        }
      }
      expect(reaches, `G at ${weight}`).toBeGreaterThan(20);
    }
  });
});

describe("the Serif's e", () => {
  it("keeps its aperture open between the tail and the bar past a Black", () => {
    for (const weight of [200, 230, 260]) {
      const b = box("e", weight);
      const across = (k: number) => b.xMin + (b.xMax - b.xMin) * k;
      // The bar's underside, where only the bar and the bowl over it stand.
      const barFoot = column("e", weight, across(0.9))[0][0];
      // And the highest the tail comes under it, across the aperture.
      let tail = -Infinity;
      for (let k = 0.45; k <= 0.9; k += 0.025) {
        for (const [, top] of column("e", weight, across(k))) {
          if (top < barFoot - 0.5) tail = Math.max(tail, top);
        }
      }
      // At an Ultra the tail ran up to within a few units of the bar, and
      // its end was sliced off against it.
      expect(barFoot - tail, `e at ${weight}`).toBeGreaterThan(weight * 0.08);
    }
  });
});
