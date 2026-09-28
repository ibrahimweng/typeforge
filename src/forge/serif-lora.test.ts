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
