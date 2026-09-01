/**
 * Where a traced letter goes wrong, rather than by how much.
 *
 * The harness beside this reports one number for a letter and cannot say
 * whether it came from a terminal, a join or the whole of one side. This says
 * which way the error goes -- ink the redraw misses, or ink it invents -- and
 * where on the letter to look for it.
 *
 *   FONT=/path/to/some.ttf LETTERS=vwy npx vite-node scripts/where.ts
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
for (const g of typeface.glyphs) for (const u of g.unicodes ?? []) byChar.set(String.fromCodePoint(u), g);
const paths = (cs: any[]) => cs.map((c) => flattenContour(c, 40));

for (const ch of process.env.LETTERS ?? "vwy") {
  const g = byChar.get(ch);
  if (!g?.contours?.length) continue;
  const fit = fitGlyph(ch, g.contours, g.advanceWidth, { unitsPerEm: upm })!;
  const drawn = sweepAll(fit.glyph.strokes, toleranceFor(upm));
  const src = paths(unite(g.contours));
  const out = paths(unite(drawn.contours));
  const pick = (from: typeof src, to: typeof src) => {
    let far = 0;
    let at = { x: 0, y: 0 };
    for (const p of from.flat()) {
      const d = nearestOnPaths(p, to);
      if (d > far) { far = d; at = p; }
    }
    return `${far.toFixed(0)} at (${at.x.toFixed(0)},${at.y.toFixed(0)})`;
  };
  console.log(`${ch}: missing ${pick(src, out)}   spilt ${pick(out, src)}`);
  for (const [i, s] of fit.glyph.strokes.entries()) {
    const seg = s.spine.segments;
    const a = seg[0];
    const z = seg[seg.length - 1];
    const p0 = a.kind === "cubic" ? `${a.from.x.toFixed(0)},${a.from.y.toFixed(0)}` : "?";
    const p1 = z.kind === "cubic" ? `${z.to.x.toFixed(0)},${z.to.y.toFixed(0)}` : "?";
    console.log(
      `   ${i}: ${seg.length} seg  ${p0} -> ${p1}  caps ${s.start.kind}(${(s.start.lead ?? 0).toFixed(0)})/${s.end.kind}(${(s.end.lead ?? 0).toFixed(0)})  widths ${s.width.map((w) => w.width.toFixed(0)).join(",")}`,
    );
  }
}
