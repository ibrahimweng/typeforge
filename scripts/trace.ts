/**
 * How much of a drawn font the fitter gets back, letter by letter.
 *
 * The number this prints is the whole argument for the quill engine. It reads a
 * font, recovers strokes from every lowercase letter, redraws them from those
 * strokes alone, and measures how far the redrawing strays from what it was
 * reading -- in font units, on the outline itself, and both ways round, so
 * neither a redraw that falls short nor one that spills over can hide.
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
import { flattenContour } from "@/font/geometry";
import { fitGlyph } from "@/quill/fit";
import { sweepAll } from "@/quill/sweep";
import { furthestFrom } from "@/quill/curve";

await ready();
const { typeface } = await importFont(new Uint8Array(readFileSync(process.env.FONT!)), "ref.ttf");
const byChar = new Map<string, (typeof typeface.glyphs)[number]>();
for (const g of typeface.glyphs) for (const u of g.unicodes ?? []) byChar.set(String.fromCodePoint(u), g);

const dense = (cs: any[]) => cs.flatMap((c) => flattenContour(c, 40));
console.log("letter  strokes  found/kept   spine dev   OUTLINE ERROR (max, mean)  units");
let worst = 0, sum = 0, n = 0;
for (const ch of "abcdefghijklmnopqrstuvwxyz") {
  const g = byChar.get(ch);
  if (!g || !g.contours?.length) { console.log(`  ${ch}     -- missing`); continue; }
  const t0 = Date.now();
  const fit = fitGlyph(ch, g.contours, g.advanceWidth, {});
  if (!fit) { console.log(`  ${ch}     -- no fit`); continue; }
  const drawn = sweepAll(fit.glyph.strokes);
  const src = dense(g.contours);
  const out = dense(drawn.contours);
  if (out.length === 0) { console.log(`  ${ch}     -- drew nothing (${fit.found} paths)`); continue; }
  // symmetric: how far each outline strays from the other
  const a = furthestFrom(src, out), b = furthestFrom(out, src);
  const max = Math.max(a, b);
  // mean deviation of source points from the redrawn outline
  let acc = 0;
  for (const p of src) { let near = Infinity; for (const q of out) { const d=(p.x-q.x)**2+(p.y-q.y)**2; if(d<near) near=d; } acc += Math.sqrt(near); }
  const mean = acc / src.length;
  worst = Math.max(worst, max); sum += mean; n++;
  console.log(`  ${ch}     ${String(fit.glyph.strokes.length).padStart(3)}    ${String(fit.found).padStart(3)}/${String(fit.kept).padStart(3)}     ${fit.spineDeviation.toFixed(2).padStart(6)}      ${max.toFixed(1).padStart(6)}   ${mean.toFixed(2).padStart(6)}   ${Date.now()-t0}ms`);
}
console.log(`\nworst max deviation ${worst.toFixed(1)} units;  mean of means ${(sum/Math.max(1,n)).toFixed(2)} units`);
