/**
 * The alphabet as the grid makes it, one cell per letter.
 *
 * The sibling of scripts/cuts.ts and scripts/motifs.ts, and it exists for the
 * same reason: a test can say a letter came back as eleven cells and none of
 * them stranded, and no test has an opinion about whether the result is still
 * an M. Every decision in the seeder was settled against this page -- the
 * staircased diagonals, the bar across the apex of the M, the bowls that went
 * square -- and every one of them was invisible in the numbers.
 *
 * The grid is drawn behind each letter, because a port in the wrong cell only
 * looks wrong once you can see where the cells are.
 *
 *   npx vite-node scripts/kit.ts
 *   BASE=Display CELL=120 npx vite-node scripts/kit.ts MWXYmwxy
 *
 * Writes to $SHEET_OUT, or /tmp/kit.html.
 */
import { writeFileSync } from "node:fs";
import { ready } from "@/font/boolean";
import { contoursToSvgPath } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { GRID, assemble, seedTiles, unitOf, cellBox, type Kit } from "@/forge/kit";
import { recipeOf } from "@/forge/letters";
import { BASES } from "@/forge/style";

await ready();
const cell = Number(process.env.CELL ?? 150);
const text = process.argv[2] ?? "MWXYmwxynvzk";
const style = BASES.find((b) => b.name === (process.env.BASE ?? "Sans"))!;
// The grid itself is worth varying: how much of a letter survives is mostly a
// question of how many cells it has to say it in.
const kit: Kit = {
  on: true,
  grid: { ...GRID, rows: Number(process.env.ROWS ?? GRID.rows) },
  roundness: 0.5,
  glyphs: {},
};
const unit = unitOf(style, kit.grid);
const left = style.metrics.sidebearing;

const cells: string[] = [];
for (const name of [...text]) {
  const drawn = drawLetter(name, style);
  const recipe = recipeOf(name as never, undefined);
  const tiles = recipe ? seedTiles(recipe(style).strokes, style, kit) : null;
  const laid = tiles ? assemble(tiles, style, kit) : null;
  const em = style.metrics.unitsPerEm;
  const top = style.metrics.ascender * 1.1;
  const bottom = style.metrics.descender * 1.25;
  const width = laid?.advanceWidth ?? drawn?.advanceWidth ?? em * 0.6;
  // The grid behind, so a port in the wrong cell is visible as such.
  const lines: string[] = [];
  for (let c = 0; c <= (tiles?.columns ?? 4); c++) {
    const x = left + c * unit;
    lines.push(`<line x1="${x}" y1="${bottom}" x2="${x}" y2="${top}" stroke="#ddd" stroke-width="3"/>`);
  }
  for (let r = -kit.grid.below; r <= kit.grid.rows + kit.grid.above; r++) {
    const y = r * unit;
    lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#ddd" stroke-width="3"/>`);
  }
  const made = laid ? drawLetter(name, style, undefined, undefined, { ...kit, glyphs: { [name]: tiles! } }) : null;
  cells.push(`<figure><svg viewBox="0 ${bottom} ${width} ${top - bottom}" width="${cell}" style="transform: scaleY(-1)">
    ${lines.join("")}
    <path d="${made ? contoursToSvgPath(made.contours) : ""}" fill="#111"/>
  </svg><figcaption>${name}${tiles ? ` · ${Object.keys(tiles.cells).length} cells` : " · none"}</figcaption></figure>`);
}
const out = process.env.SHEET_OUT ?? "/tmp/kit.html";
writeFileSync(out, `<!doctype html><meta charset="utf-8"><style>
 body{font:12px system-ui;background:#fff;margin:12px;color:#111}
 .strip{display:flex;flex-wrap:wrap;gap:4px}
 figure{margin:0;text-align:center;border:1px solid #eee;padding:2px}
 figcaption{font-size:9px;color:#888}
</style><div class="strip">${cells.join("")}</div>`);
console.log(`wrote ${out}`);
