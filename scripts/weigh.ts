/**
 * Where a delivered font's bytes actually go.
 *
 * Written because a guess about this was wrong twice running. The kerning
 * looked like it was priced per pair, so the obvious lever was to mark fewer
 * pairs -- and raising the threshold by half took the pair count from fifteen
 * thousand to nine and moved the file by five kilobytes, because class kerning
 * is a rectangle of left classes against right ones and every cell is two bytes
 * whether anything is in it or not. What it is priced by is rows and columns.
 * The second wrong guess was that the outlines were the bulk of the file; they
 * were a quarter of it.
 *
 * So: run it, and read the table list rather than reasoning about it.
 *
 *   npx vite-node scripts/weigh.ts
 *   FACES="Sans,Serif,Brush" npx vite-node scripts/weigh.ts
 */

import { exportFont } from "@/font/export";
import { readSfnt } from "@/font/sfnt";
import { startFrom } from "@/forge/document";
import { BASES } from "@/forge/style";
import { toTypeface } from "@/forge/typeface";

const wanted = (process.env.FACES ?? "Sans").split(",").map((one) => one.trim());
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)}KB`;

for (const name of wanted) {
  const base = BASES.find((one) => one.name === name);
  if (!base) {
    console.log(`no face named ${name}; there is ${BASES.map((one) => one.name).join(", ")}`);
    continue;
  }

  const began = Date.now();
  const typeface = await toTypeface(startFrom(base), {
    familyName: name,
    styleName: "Regular",
    weightClass: 400,
    merge: true,
    kern: true,
  });
  const drew = Date.now() - began;

  const result = await exportFont(typeface, {
    format: "ttf",
    fidelity: "rebuild",
    includeKerning: true,
    mergeOverlaps: true,
  });

  // The grid the kerning is written as, which is what it is priced by.
  const lefts = new Set(typeface.kernClasses.map((one) => one.left.join(",")));
  const rights = new Set(typeface.kernClasses.map((one) => one.right.join(",")));

  const tables = [...readSfnt(result.bytes).tables]
    .map(([tag, bytes]) => [tag, bytes.length] as const)
    .sort((one, other) => other[1] - one[1]);

  console.log(
    `${name}: ${kb(result.bytes.length)}, ${typeface.glyphs.length} glyphs, ` +
      `kerning ${lefts.size}x${rights.size} grid with ${typeface.kernClasses.length} filled, ` +
      `${drew}ms to draw`,
  );
  for (const [tag, size] of tables.slice(0, 6)) console.log(`    ${tag} ${kb(size)}`);
  for (const note of result.notes ?? []) console.log(`    note: ${note}`);
}
