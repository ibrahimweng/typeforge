/**
 * Every letter's ink, at every weight, as one line each.
 *
 * A change to the sweep can fix the letter it was aimed at and quietly ruin
 * another -- a Slab `c` once kept its area exactly and grew a hundred units of
 * bounds, which no test asked about and no eye was on. So: take the whole
 * alphabet's area and bounds before a change and again after, and diff.
 *
 *   npx vite-node scripts/ink.ts > before.txt
 *   ...make the change...
 *   npx vite-node scripts/ink.ts > after.txt
 *   diff before.txt after.txt
 */

import { contourArea, contoursBounds } from "@/font/geometry";
import { drawLetter, letterNames } from "@/forge/build";
import { BASES, type Style } from "@/forge/style";
import { weightedStyle } from "@/forge/family";

const WEIGHTS = [100, 400, 700, 900];
const faces = (process.env.FACES ?? "Sans,Serif,Slab,Brush").split(",").map((one) => one.trim());

for (const faceName of faces) {
  const base = BASES.find((one) => one.name === faceName);
  if (!base) continue;
  for (const weight of WEIGHTS) {
    const style: Style = weightedStyle(base, 400, weight);
    for (const name of letterNames()) {
      const drawn = drawLetter(name, style);
      if (!drawn) continue;
      const box = contoursBounds(drawn.contours);
      const area = drawn.contours.reduce((total, one) => total + Math.abs(contourArea(one)), 0);
      console.log(
        `${faceName} ${String(weight).padStart(3)} ${name.padEnd(16)} ` +
          `contours ${String(drawn.contours.length).padStart(2)}  ` +
          `area ${area.toFixed(0).padStart(8)}  ` +
          `box ${box.xMin.toFixed(0)},${box.yMin.toFixed(0)},${box.xMax.toFixed(0)},${box.yMax.toFixed(0)}  ` +
          `width ${drawn.advanceWidth.toFixed(0)}`,
      );
    }
  }
}
