/**
 * The Serif held to Lora across the whole weight axis, round three: the
 * faults a letter-by-letter comparison with Lora Regular and Lora Bold found
 * at a Light, the Regular, the Bold, a Black and the slider's heaviest, each
 * held to what Lora draws or to the plain geometry of a clean letter.
 */

import { describe, expect, it } from "vitest";
import { contoursBounds, inkRunsAt } from "@/font/geometry";
import { drawLetter } from "./build";
import { formOf, startFrom } from "./document";
import { SERIF, type Style } from "./style";

const forge = startFrom(SERIF);
const at = (weight: number): Style => ({ ...SERIF, pen: { ...SERIF.pen, weight } });
const draw = (name: string, weight: number, style: Style = at(weight)) =>
  drawLetter(name, style, formOf(forge, name))!;
const box = (name: string, weight: number) => contoursBounds(draw(name, weight).contours);
/** The runs of ink along a row, overlapping strokes merged. */
function row(name: string, weight: number, y: number, style?: Style): Array<[number, number]> {
  const runs = inkRunsAt(draw(name, weight, style).contours, y, "y", 64);
  return runs.reduce<Array<[number, number]>>((all, run) => {
    const last = all[all.length - 1];
    if (last && run[0] <= last[1] + 0.5) last[1] = Math.max(last[1], run[1]);
    else all.push([run[0], run[1]]);
    return all;
  }, []);
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
