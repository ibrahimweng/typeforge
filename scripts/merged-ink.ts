/**
 * Every letter's ink after the strokes are fused, at every weight.
 *
 * `scripts/ink.ts` reads the drawings as they come off the pen, which is what a
 * variable font is written from. A static font is written from the fused
 * outlines instead, and fusing can hide a change or invent one -- two strokes
 * laid on top of each other are one shape afterwards and two before. So both
 * are snapshotted, and a change is only clean when neither moves.
 *
 *   npx vite-node scripts/merged-ink.ts > before.txt
 */

import { contourArea, contoursBounds } from "@/font/geometry";
import { startFrom, weighted } from "@/forge/document";
import { BASES } from "@/forge/style";
import { toTypeface } from "@/forge/typeface";

const WEIGHTS = [100, 400, 700, 900];
const faces = (process.env.FACES ?? "Sans,Serif,Brush").split(",").map((one) => one.trim());

for (const faceName of faces) {
  const base = BASES.find((one) => one.name === faceName);
  if (!base) continue;
  for (const weight of WEIGHTS) {
    const forge = { ...startFrom(base), family: { drawn: 400, also: WEIGHTS } };
    const typeface = await toTypeface(weighted(forge, weight), {
      familyName: "Probe",
      styleName: "Probe",
      weightClass: weight,
      merge: true,
    });
    for (const glyph of typeface.glyphs) {
      const box = contoursBounds(glyph.contours);
      const area = glyph.contours.reduce((total, one) => total + Math.abs(contourArea(one)), 0);
      console.log(
        `${faceName} ${String(weight).padStart(3)} ${glyph.name.padEnd(16)} ` +
          `contours ${String(glyph.contours.length).padStart(2)}  ` +
          `area ${area.toFixed(0).padStart(8)}  ` +
          `box ${box.xMin.toFixed(0)},${box.yMin.toFixed(0)},${box.xMax.toFixed(0)},${box.yMax.toFixed(0)}`,
      );
    }
  }
}
