/**
 * How far the drawn weight moved, glyph by glyph, so the size of a change is a
 * number rather than a shrug.
 *
 *   npx vite-node scripts/moved.ts > /tmp/one.json     (before)
 *   npx vite-node scripts/moved.ts > /tmp/two.json     (after)
 *   COMPARE=/tmp/one.json,/tmp/two.json npx vite-node scripts/moved.ts
 */

import { readFileSync } from "node:fs";

import { startFrom, weighted } from "@/forge/document";
import { BASES } from "@/forge/style";
import { toTypeface } from "@/forge/typeface";

const faceName = process.env.FACE ?? "Display";

if (process.env.COMPARE) {
  const [one, two] = process.env.COMPARE.split(",");
  const a = JSON.parse(readFileSync(one, "utf8")) as Record<string, number[]>;
  const b = JSON.parse(readFileSync(two, "utf8")) as Record<string, number[]>;
  const rows: Array<[string, number]> = [];
  for (const name of Object.keys(a)) {
    const p = a[name], q = b[name] ?? [];
    if (p.length !== q.length) { rows.push([`${name} (NODE COUNT ${p.length / 2} -> ${q.length / 2})`, Infinity]); continue; }
    let worst = 0;
    for (let i = 0; i < p.length; i += 2) worst = Math.max(worst, Math.hypot(p[i] - q[i], p[i + 1] - q[i + 1]));
    if (worst > 0.001) rows.push([name, worst]);
  }
  rows.sort((x, y) => y[1] - x[1]);
  console.log(`${rows.length} of ${Object.keys(a).length} glyphs moved at the drawn weight`);
  for (const [name, worst] of rows.slice(0, 20)) console.log(`  ${name.padEnd(18)} ${worst === Infinity ? "structure" : `${worst.toFixed(1)} units`}`);
} else {
  const face = BASES.find((one) => one.name === faceName)!;
  const forge = { ...startFrom(face), family: { drawn: 400, also: [] } };
  const typeface = await toTypeface(weighted(forge, 400), {
    familyName: "Probe", styleName: "Probe", weightClass: 400, merge: false,
  });
  const out: Record<string, number[]> = {};
  for (const glyph of typeface.glyphs) {
    const flat: number[] = [];
    for (const contour of glyph.contours) for (const node of contour.nodes) flat.push(node.point.x, node.point.y);
    out[glyph.name] = flat;
  }
  console.log(JSON.stringify(out));
}
