/**
 * What pen a font was written with, read back out of its own letters.
 *
 *   FONT=/path/to/some.ttf npx vite-node scripts/hand.ts
 *
 * Point it only at a font you have the right to derive from.
 */
import { readFileSync } from "node:fs";
import { ready } from "@/font/boolean";
import { importFont } from "@/font/parse";
import { fitGlyph } from "@/quill/fit";
import { handOf } from "@/quill/hand";
import { unite } from "@/font/boolean";
import { flattenContour } from "@/font/geometry";
import { sweepAll, toleranceFor } from "@/quill/sweep";
import { nearestOnPaths } from "@/quill/curve";
import type { Contour } from "@/font/types";
import type { QuillStroke } from "@/quill/types";

await ready();
const { typeface } = await importFont(new Uint8Array(readFileSync(process.env.FONT!)), "ref.ttf");
const upm = typeface.unitsPerEm ?? 1000;
const byChar = new Map<string, (typeof typeface.glyphs)[number]>();
for (const glyph of typeface.glyphs)
  for (const code of glyph.unicodes ?? []) byChar.set(String.fromCodePoint(code), glyph);

console.log("letter   pen found                     pressure spread   flatter by");
const all: Array<{ contrast: number; angle: number }> = [];
const everything: Parameters<typeof handOf>[0] = [];
for (const character of process.env.LETTERS ?? "abcdefghijklmnopqrstuvwxyz") {
  const glyph = byChar.get(character);
  if (!glyph?.contours?.length) continue;
  const fit = fitGlyph(character, glyph.contours, glyph.advanceWidth, { unitsPerEm: upm });
  if (!fit) continue;
  const found = handOf(fit.glyph.strokes);
  if (!found) {
    console.log(`  ${character}      too few directions to say`);
    continue;
  }
  const flatter = ((1 - found.spread / found.roundSpread) * 100).toFixed(0);
  all.push({ contrast: found.contrast, angle: found.angle });
  everything.push(...fit.glyph.strokes);
  console.log(
    `  ${character}      blade ${found.contrast.toFixed(2)} at ${found.angle.toFixed(0).padStart(4)}°` +
      `   ${found.roundSpread.toFixed(3)} -> ${found.spread.toFixed(3)}` +
      `   ${flatter.padStart(3)}%`,
  );
}
if (all.length > 0) {
  const mid = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
  console.log(
    `\nmedian of the per-letter fits: blade ${mid(all.map((one) => one.contrast)).toFixed(2)}` +
      ` at ${mid(all.map((one) => one.angle)).toFixed(0)}°`,
  );
}

/*
 * And the answer that is actually used: one pen read out of the whole alphabet
 * at once, which is both the principled reading -- a hand holds one pen -- and
 * the robust one, since no single letter is then thin enough evidence to be
 * fitted by itself.
 */
const pooled = handOf(everything);
if (!pooled) process.exit(0);
console.log(
  `pooled over the alphabet:      blade ${pooled.contrast.toFixed(2)} at ${pooled.angle.toFixed(0)}°`,
);
console.log(
  `  between strokes:             ${pooled.roundSpread.toFixed(3)} -> ${pooled.spread.toFixed(3)}` +
    `   ${((1 - pooled.spread / pooled.roundSpread) * 100).toFixed(0)}% flatter` +
    `   (so the pen is worth reading)`,
);
console.log(
  `  along each stroke:           ${pooled.roundWander.toFixed(3)} -> ${pooled.wander.toFixed(3)}` +
    `   ${((1 - pooled.wander / pooled.roundWander) * 100).toFixed(0)}% flatter` +
    `   (so the second pass ${pooled.wander < pooled.roundWander ? "runs" : "does not run"})`,
);

/*
 * The second pass, measured against the first: the same letters read again
 * with the pen divided out of every width reading before the profile is
 * thinned. What is wanted is the same ink from fewer numbers.
 */
const pen = { contrast: pooled.contrast, angle: pooled.angle };
const paths = (cs: Contour[]) => cs.map((one) => flattenContour(one, 40));
const strayOf = (strokes: QuillStroke[], source: Contour[]) => {
  const drawn = paths(unite(sweepAll(strokes, toleranceFor(upm)).contours));
  const was = paths(unite(source));
  if (drawn.every((one) => one.length === 0)) return { max: Infinity, mean: Infinity };
  let max = 0;
  let sum = 0;
  let count = 0;
  for (const point of was.flat()) {
    const gap = nearestOnPaths(point, drawn);
    max = Math.max(max, gap);
    sum += gap;
    count++;
  }
  for (const point of drawn.flat()) {
    const gap = nearestOnPaths(point, was);
    max = Math.max(max, gap);
    sum += gap;
    count++;
  }
  return { max, mean: sum / Math.max(1, count) };
};

console.log("\nletter    one pass                    two passes");
let oneMax = 0,
  twoMax = 0,
  oneMean = 0,
  twoMean = 0,
  oneStops = 0,
  twoStops = 0,
  n = 0;
for (const character of process.env.LETTERS ?? "abcdefghijklmnopqrstuvwxyz") {
  const glyph = byChar.get(character);
  if (!glyph?.contours?.length) continue;
  const once = fitGlyph(character, glyph.contours, glyph.advanceWidth, { unitsPerEm: upm });
  const twice = fitGlyph(character, glyph.contours, glyph.advanceWidth, {
    unitsPerEm: upm,
    pen,
  });
  if (!once || !twice) continue;
  const a = strayOf(once.glyph.strokes, glyph.contours);
  const b = strayOf(twice.glyph.strokes, glyph.contours);
  const stopsOf = (strokes: QuillStroke[]) =>
    strokes.reduce((total, one) => total + one.width.length, 0);
  const sa = stopsOf(once.glyph.strokes);
  const sb = stopsOf(twice.glyph.strokes);
  oneMax = Math.max(oneMax, a.max);
  twoMax = Math.max(twoMax, b.max);
  oneMean += a.mean;
  twoMean += b.mean;
  oneStops += sa;
  twoStops += sb;
  n++;
  console.log(
    `  ${character}      ${a.max.toFixed(1).padStart(6)} ${a.mean.toFixed(2).padStart(5)} ${String(sa).padStart(3)} stops` +
      `     ${b.max.toFixed(1).padStart(6)} ${b.mean.toFixed(2).padStart(5)} ${String(sb).padStart(3)} stops`,
  );
}
console.log(
  `\nworst ${oneMax.toFixed(1)} -> ${twoMax.toFixed(1)};  mean of means ${(oneMean / n).toFixed(2)} -> ${(twoMean / n).toFixed(2)};` +
    `  width stops ${oneStops} -> ${twoStops}`,
);
