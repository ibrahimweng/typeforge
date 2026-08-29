/**
 * How far each letter's ink rides above and below the two lines it is drawn
 * between.
 *
 * A face whose letters all reach exactly the x-height and stop exactly on the
 * baseline reads as writing on a ruled line, and no measure of ink or of width
 * catches it -- a letter of the right colour and the right advance can still be
 * one of a row of identical soldiers.
 *
 * The reference is not on a rule. Against a declared x-height of 332 its `n`
 * tops out at 292 and its `o` at 352, its `u` at 298 and its `e` at 360; below
 * the line its `n` stops at -20 and its `x` runs to -59. Some of that is
 * overshoot, which every face has, and the rest is the hand: the `n` and the
 * `m` are the same construction 40 units apart.
 *
 * `spread` is the whole of it -- the tallest top less the shortest, and the
 * lowest bottom less the highest, in x-heights. That is the number to match.
 *
 * The reference is Dancing Script (Pablo Impallari, SIL OFL 1.1), fetched from
 * npm as in the note on `beside.ts`. Telma's licence does not permit this, so
 * nothing is ever taken from that file.
 *
 *   REF=package/files/dancing-script-latin-400-normal.woff npx vite-node scripts/ride.ts
 */
import { readFileSync } from "node:fs";
import { ready } from "@/font/boolean";
import { contoursBounds } from "@/font/geometry";
import { importFont } from "@/font/parse";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";
import type { Glyph } from "@/font/types";

await ready();

const REF = process.env.REF;
if (!REF) throw new Error("Set REF to the reference font file. See the note at the top.");

/*
 * The letters that live wholly between the two lines, so a top is a top and not
 * an ascender. The `s` and the `r` are left out on purpose: the reference gives
 * both a flourish well above the waist -- 395 and 409 against an x-height of
 * 332 -- and they would be measuring that rather than where the letter rides.
 */
const LETTERS = [..."acemnouvwxz"];

const { typeface } = await importFont(readFileSync(REF));
const refGlyph = (letter: string): Glyph | undefined =>
  typeface.glyphs.find((one) => one.unicodes.includes(letter.codePointAt(0) ?? -1));
const refX = contoursBounds(refGlyph("x")!.contours).yMax;

type Row = { name: string; tops: number[]; bottoms: number[] };
const rows: Row[] = [];

const theirs: Row = { name: "reference", tops: [], bottoms: [] };
for (const letter of LETTERS) {
  const glyph = refGlyph(letter);
  if (!glyph) continue;
  const bounds = contoursBounds(glyph.contours);
  theirs.tops.push(bounds.yMax / refX);
  theirs.bottoms.push(bounds.yMin / refX);
}
rows.push(theirs);

for (const style of BASES.filter((one) => one.parts.script?.on)) {
  const row: Row = { name: style.name, tops: [], bottoms: [] };
  for (const letter of LETTERS) {
    const drawn = drawLetter(letter, style, style.forms?.[letter]);
    if (!drawn) continue;
    const bounds = contoursBounds(drawn.contours);
    row.tops.push(bounds.yMax / style.metrics.xHeight);
    row.bottoms.push(bounds.yMin / style.metrics.xHeight);
  }
  rows.push(row);
}

const span = (all: number[]) => Math.max(...all) - Math.min(...all);

console.log(`tops and bottoms of \`${LETTERS.join("")}\`, in x-heights\n`);
console.log(`  ${"".padEnd(17)}${"top low..high".padStart(18)}${"spread".padStart(9)}` +
  `${"bottom low..high".padStart(20)}${"spread".padStart(9)}`);
for (const row of rows) {
  console.log(
    `  ${row.name.padEnd(17)}` +
    `${`${Math.min(...row.tops).toFixed(3)}..${Math.max(...row.tops).toFixed(3)}`.padStart(18)}` +
    `${span(row.tops).toFixed(3).padStart(9)}` +
    `${`${Math.min(...row.bottoms).toFixed(3)}..${Math.max(...row.bottoms).toFixed(3)}`.padStart(20)}` +
    `${span(row.bottoms).toFixed(3).padStart(9)}`,
  );
}

console.log(`\nletter by letter -- top / bottom\n`);
console.log(`  ${"".padEnd(4)}${rows.map((one) => one.name.slice(0, 9).padStart(15)).join("")}`);
LETTERS.forEach((letter, i) => {
  console.log(`  ${letter.padEnd(4)}` + rows
    .map((one) => `${one.tops[i]?.toFixed(2)}/${one.bottoms[i]?.toFixed(2)}`.padStart(15))
    .join(""));
});
