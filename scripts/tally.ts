/**
 * How many letters each face leaves standing, over all sixteen.
 *
 * The one number that says whether a change to the sweep was worth making. Four
 * attempts at the corners bought one face and lost two, and each of them looked
 * right until this was run.
 *
 *   npx vite-node scripts/tally.ts
 */

import { deliver } from "@/forge/deliver";
import { startFrom } from "@/forge/document";
import { BASES } from "@/forge/style";

const WEIGHTS = [100, 700, 900];
let total = 0;
const rows: Array<[string, number, string]> = [];
for (const face of BASES) {
  const delivered = await deliver(
    { ...startFrom(face), family: { drawn: 400, also: WEIGHTS } },
    { familyName: "Probe", format: "ttf", variable: true },
  );
  const held = [...new Set(delivered.held)];
  total += held.length;
  rows.push([face.name, held.length, held.slice(0, 8).join(" ")]);
}
for (const [name, count, some] of rows) {
  console.log(`  ${name.padEnd(13)} ${String(count).padStart(4)}   ${some}`);
}
console.log(`\n  ${"TOTAL".padEnd(13)} ${String(total).padStart(4)}`);
