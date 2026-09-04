/**
 * Where a traced letter's worst point is, and which way it is wrong.
 *
 * `trace.ts` prints one number per letter and that number is a maximum, which
 * says how bad but not where or what. A hundred units of error is a different
 * defect depending on whether the redraw fell *short* of the letter -- a notch,
 * a missing corner -- or ran *past* it, and depending on whether it is at a
 * terminal, at a junction, or in the middle of a stroke.
 *
 * So both directions are reported separately, each with the place it happens,
 * given as a percentage across and up the letter's own bounding box. That is
 * what turns "the q is 100.6" into "the q is missing ink at 62% across and 34%
 * up", which is a stem, which is a thing to go and look at.
 *
 *   FONT=/path/to/some.ttf npx vite-node scripts/worst.ts
 *   FONT=... LETTERS=qud npx vite-node scripts/worst.ts
 *
 * Point it only at a font you have the right to derive from.
 */
import { readFileSync } from "node:fs";
import { ready, unite } from "@/font/boolean";
import { importFont } from "@/font/parse";
import { flattenContour } from "@/font/geometry";
import { fitGlyph } from "@/quill/fit";
import { sweepAll, toleranceFor } from "@/quill/sweep";
import { nearestOnPaths } from "@/quill/curve";

await ready();
const { typeface } = await importFont(new Uint8Array(readFileSync(process.env.FONT!)), "ref.ttf");
const upm = typeface.unitsPerEm ?? 1000;
const byChar = new Map<string, (typeof typeface.glyphs)[number]>();
for (const glyph of typeface.glyphs)
  for (const code of glyph.unicodes ?? []) byChar.set(String.fromCodePoint(code), glyph);

const paths = (contours: any[]) => contours.map((one) => flattenContour(one, 40));

/** The furthest point of one cloud from the other, and where it stands. */
function furthest(
  from: Array<{ x: number; y: number }>,
  to: ReturnType<typeof paths>,
): { at: { x: number; y: number }; far: number } {
  let far = -1;
  let at = { x: 0, y: 0 };
  for (const point of from) {
    const gap = nearestOnPaths(point, to);
    if (gap > far) {
      far = gap;
      at = point;
    }
  }
  return { at, far };
}

const letters = process.env.LETTERS ?? "abcdefghijklmnopqrstuvwxyz";
console.log("letter   MISSING ink (redraw falls short)     SPILT ink (redraw runs past)");
for (const character of letters) {
  const glyph = byChar.get(character);
  if (!glyph?.contours?.length) continue;

  const fit = fitGlyph(character, glyph.contours, glyph.advanceWidth, { unitsPerEm: upm });
  if (!fit) continue;
  const drawn = sweepAll(fit.glyph.strokes, toleranceFor(upm));
  const source = paths(unite(glyph.contours));
  const redraw = paths(unite(drawn.contours));
  if (redraw.every((one) => one.length === 0)) continue;

  // The letter's own box, so a place can be said in the letter's terms.
  const all = source.flat();
  const minX = Math.min(...all.map((one) => one.x));
  const maxX = Math.max(...all.map((one) => one.x));
  const minY = Math.min(...all.map((one) => one.y));
  const maxY = Math.max(...all.map((one) => one.y));
  const across = (point: { x: number; y: number }) =>
    `${(((point.x - minX) / Math.max(1, maxX - minX)) * 100).toFixed(0)}%`;
  const up = (point: { x: number; y: number }) =>
    `${(((point.y - minY) / Math.max(1, maxY - minY)) * 100).toFixed(0)}%`;

  // Source points the redraw does not reach: ink the letter has and this has not.
  const missing = furthest(all, redraw);
  // Redraw points the source does not reach: ink this has and the letter has not.
  const spilt = furthest(redraw.flat(), source);

  console.log(
    `  ${character}      ${missing.far.toFixed(1).padStart(6)} at ${across(missing.at).padStart(4)} across ${up(missing.at).padStart(4)} up` +
      `        ${spilt.far.toFixed(1).padStart(6)} at ${across(spilt.at).padStart(4)} across ${up(spilt.at).padStart(4)} up`,
  );
}
