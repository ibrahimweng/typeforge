/**
 * How far each starting point stands from the plain one.
 *
 * A face is a set of numbers, so "are these too similar" has an answer rather
 * than an opinion: count how many of them each face moves away from the Sans,
 * and how many letters it draws differently. Both were embarrassing the first
 * time this was run -- the Marker moved eight numbers of thirty-six and drew
 * the same letters as everything else, which is why it read as a slanted sans.
 *
 *   npx vite-node scripts/apart.ts
 */
import { BASES, SANS, type Style } from "@/forge/style";

const flat = (o: unknown, prefix = ""): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (k === "name" || k === "blurb" || k === "family" || k === "forms" || k === "effects") continue;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flat(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = v;
  }
  return out;
};

const base = flat(SANS);
const keys = Object.keys(base);
const rows = (BASES as Style[]).map((style) => {
  const here = flat(style);
  return {
    name: style.name,
    family: style.family,
    moved: keys.filter((k) => here[k] !== base[k]).length,
    forms: Object.keys(style.forms ?? {}).length,
    tool: style.effects ? "its own tool" : "",
  };
});
rows.sort((one, other) => one.moved - other.moved);

console.log(`${keys.length} numbers describe a face.\n`);
for (const row of rows) {
  console.log(
    `${row.name.padEnd(13)} ${row.family.padEnd(8)} ${String(row.moved).padStart(2)}/${keys.length}  ` +
      `${String(row.forms).padStart(2)} own letters  ${row.tool}`,
  );
}
const moved = rows.reduce((sum, row) => sum + row.moved, 0) / rows.length;
const forms = rows.reduce((sum, row) => sum + row.forms, 0);
console.log(`\naverage ${moved.toFixed(1)} numbers moved; ${forms} letterform choices across the sixteen.`);
