/**
 * How much of a drawn font the fitter gets back, letter by letter.
 *
 * The number this prints is the whole argument for the quill engine. It reads a
 * font, recovers strokes from every lowercase letter, redraws them from those
 * strokes alone, and measures how far the redrawing strays from what it was
 * reading -- in font units, on the outline itself, and both ways round, so
 * neither a redraw that falls short nor one that spills over can hide.
 *
 * The measurement is point-to-*outline* rather than point-to-point, and the
 * distinction is not a nicety. A flattened outline puts samples along a curve
 * and none along a straight run; compared cloud to cloud, an `l` that both
 * drawings agree on to within one unit reports seven hundred and seventy-eight
 * units of error, because the nearest source *point* to the middle of a stem is
 * the corner at the end of it. That number is the sampling, not the letter.
 *
 * The stroke count beside it matters as much as the error, and is easy to
 * overlook. A fit can be arithmetically excellent and useless: cut at every
 * junction in the skeleton, an `a` came back as six hundred and sixty strokes
 * that redrew the letter to within two units and that nobody could have edited.
 * What is wanted is the handful a hand would have used.
 *
 *   FONT=/path/to/some.ttf npx vite-node scripts/trace.ts
 *
 * Point it only at a font you have the right to derive from. Recovering the
 * strokes of a typeface and redrawing them makes a derivative work of it,
 * whatever the representation in between.
 */

import { readFileSync } from "node:fs";
import { ready } from "@/font/boolean";
import { importFont } from "@/font/parse";
import { flattenContour, contourArea } from "@/font/geometry";
import { fitGlyph } from "@/quill/fit";
import { sweepAll, toleranceFor } from "@/quill/sweep";
import { unite } from "@/font/boolean";
import { furthestFromPath, nearestOnPaths } from "@/quill/curve";

await ready();
const { typeface } = await importFont(new Uint8Array(readFileSync(process.env.FONT!)), "ref.ttf");
const upm = typeface.unitsPerEm ?? 1000;
const byChar = new Map<string, (typeof typeface.glyphs)[number]>();
for (const g of typeface.glyphs)
  for (const u of g.unicodes ?? []) byChar.set(String.fromCodePoint(u), g);

const paths = (cs: any[]) => cs.map((c) => flattenContour(c, 40));
const letters = process.env.LETTERS ?? "abcdefghijklmnopqrstuvwxyz";
const area = (cs: any[]) => Math.abs(cs.reduce((sum, c) => sum + contourArea(c), 0));
console.log("letter  strokes  found/kept   spine dev   OUTLINE ERROR (max, mean)   ink%  units");
let worst = 0,
  sum = 0,
  n = 0,
  nodes = 0;
for (const ch of letters) {
  const g = byChar.get(ch);
  if (!g?.contours?.length) {
    console.log(`  ${ch}     -- missing`);
    continue;
  }
  const t0 = Date.now();
  /*
   * Told how big the em is, because that is what decides everything.
   *
   * The fitter sizes its raster against the em, and the em is how it knows how
   * finely to fit the spine and how loosely to sweep the outline. Left to
   * default, this measured a two-thousand-unit font at one pixel per unit --
   * twice the resolution the application uses -- so every number it printed was
   * for a configuration nothing runs, and it disagreed with the pictures beside
   * it for a whole afternoon.
   */
  const fit = fitGlyph(ch, g.contours, g.advanceWidth, { unitsPerEm: upm });
  if (!fit) {
    console.log(`  ${ch}     -- no fit`);
    continue;
  }
  const drawn = sweepAll(fit.glyph.strokes, toleranceFor(typeface.unitsPerEm ?? 1000));
  // United, because the source is one outline and the redraw is a pile of
  // overlapping strokes. Measured un-united, every seam buried inside another
  // stroke's ink reads as half a stem of error on a letter that is in fact right.
  const src = paths(unite(g.contours));
  const out = paths(unite(drawn.contours));
  if (out.every((one) => one.length === 0)) {
    console.log(`  ${ch}     -- drew nothing (${fit.found} paths)`);
    continue;
  }
  // symmetric: how far each outline strays from the other, point to edge
  const max = Math.max(furthestFromPath(src.flat(), out), furthestFromPath(out.flat(), src));
  // mean deviation of source points from the redrawn outline
  const flat = src.flat();
  let acc = 0;
  for (const p of flat) acc += nearestOnPaths(p, out);
  const mean = acc / flat.length;
  worst = Math.max(worst, max);
  sum += mean;
  n++;
  nodes += drawn.contours.reduce((sum, c) => sum + c.nodes.length, 0);
  const ink = (area(unite(drawn.contours)) / Math.max(1, area(unite(g.contours)))) * 100;
  console.log(
    `  ${ch}     ${String(fit.glyph.strokes.length).padStart(3)}    ${String(fit.found).padStart(3)}/${String(fit.kept).padStart(3)}     ${fit.spineDeviation.toFixed(2).padStart(6)}      ${max.toFixed(1).padStart(6)}   ${mean.toFixed(2).padStart(6)}  ${ink.toFixed(0).padStart(4)}%   ${Date.now() - t0}ms`,
  );
}
console.log(
  `\nworst max deviation ${worst.toFixed(1)} units;  mean of means ${(sum / Math.max(1, n)).toFixed(2)} units;  ${nodes} nodes`,
);
