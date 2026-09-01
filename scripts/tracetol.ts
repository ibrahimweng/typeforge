/**
 * Nodes and error against the two tolerances, so the trade can be chosen rather
 * than guessed at.
 *
 * There are two, they are independent, and neither is obvious from the other.
 * The spine tolerance decides how closely the recovered centre-line follows the
 * walk over the pixel grid; the sweep tolerance decides how closely the outline
 * follows the true offset of that spine. Both are read off this table rather
 * than picked: fitting the spine five times finer than the grid it came from
 * costs three quarters of the nodes in the alphabet and buys a tenth of a unit.
 *
 *   FONT=/path/to/some.ttf npx vite-node scripts/tracetol.ts
 *   FONT=... SPINE=0 SWEEP=0.4,1,2,4 LETTERS=aeoc npx vite-node scripts/tracetol.ts
 *
 * SPINE=0 leaves the fitter to choose its own, which is what the application
 * does. Point it only at a font you have the right to derive from.
 */
import { readFileSync } from "node:fs";
import { ready, unite } from "@/font/boolean";
import { importFont } from "@/font/parse";
import { flattenContour } from "@/font/geometry";
import { fitGlyph } from "@/quill/fit";
import { sweepAll } from "@/quill/sweep";
import { furthestFromPath, nearestOnPaths } from "@/quill/curve";

await ready();
const { typeface } = await importFont(
  new Uint8Array(readFileSync(process.env.FONT!)),
  "ref.ttf",
);
const upm = typeface.unitsPerEm ?? 1000;
const byChar = new Map<string, (typeof typeface.glyphs)[number]>();
for (const g of typeface.glyphs)
  for (const u of g.unicodes ?? []) byChar.set(String.fromCodePoint(u), g);
const paths = (cs: any[]) => cs.map((c) => flattenContour(c, 24));
const letters = (process.env.LETTERS ?? "aeonvswhx").split("");
const spines = (process.env.SPINE ?? "1.2,3,6,10").split(",").map(Number);
const sweeps = (process.env.SWEEP ?? "0.4,2,5").split(",").map(Number);

console.log(
  `upm ${upm}, ${letters.length} letters   spine/sweep   nodes  segs  meanErr  maxErr`,
);
for (const spine of spines) {
  for (const swept of sweeps) {
    let nodes = 0,
      segs = 0,
      sum = 0,
      n = 0,
      max = 0;
    for (const ch of letters) {
      const g = byChar.get(ch);
      if (!g?.contours?.length) continue;
      const fit = fitGlyph(
        ch,
        g.contours,
        g.advanceWidth,
        spine > 0 ? { unitsPerEm: upm, tolerance: spine } : { unitsPerEm: upm },
      );
      if (!fit) continue;
      const drawn = sweepAll(fit.glyph.strokes, swept);
      const src = paths(unite(g.contours)),
        out = paths(unite(drawn.contours));
      if (!out.some((o) => o.length)) continue;
      nodes += drawn.contours.reduce((s, c) => s + c.nodes.length, 0);
      segs += fit.glyph.strokes.reduce(
        (s, one) => s + one.spine.segments.length,
        0,
      );
      const flat = src.flat();
      let acc = 0;
      for (const p of flat) acc += nearestOnPaths(p, out);
      sum += acc / flat.length;
      n++;
      max = Math.max(
        max,
        furthestFromPath(src.flat(), out),
        furthestFromPath(out.flat(), src),
      );
    }
    console.log(
      `      ${String(spine).padStart(4)} / ${String(swept).padStart(3)}      ${String(nodes).padStart(5)} ${String(segs).padStart(5)}   ${(sum / n).toFixed(2).padStart(6)}  ${max.toFixed(1).padStart(6)}`,
    );
  }
}
