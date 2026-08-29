/**
 * The height the reference hands over at, read off each letter's own edges.
 *
 * `enters.ts` showed that the reference has no join stroke -- what connects its
 * letters is the up-stroke each letter is written with. This asks the next
 * question: where does that up-stroke start, and where does the one before it
 * finish?
 *
 * A letter's origin is where the letter before it stopped advancing, and its
 * advance is where the next one starts. So the ink standing on the origin is
 * the join arriving, and the ink standing on the advance is the join leaving --
 * and the two have to be at the same height or the word comes apart.
 *
 * Printed for each letter: the runs of ink a hairline slice crosses at the
 * origin and at the advance, in x-heights above the writing line.
 *
 *   REF=package/files/dancing-script-latin-400-normal.woff \
 *     npx vite-node scripts/seam.ts abcdefghijklmnopqrstuvwxyz
 */
import { readFileSync } from "node:fs";
import { ready, intersect } from "@/font/boolean";
import { contoursBounds } from "@/font/geometry";
import { importFont } from "@/font/parse";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";
import type { Contour } from "@/font/types";

await ready();

const LETTERS = [...(process.argv[2] ?? "onaehdguvwbrsmcltifkpxyzjq")];
const FACE = process.argv[3];
const REF = process.env.REF;
if (!REF) throw new Error("Set REF to the reference font file. See the note at the top.");

const slice = (from: number, to: number): Contour => ({
  closed: true,
  nodes: [[from, -4000], [to, -4000], [to, 4000], [from, 4000]].map(([x, y]) => ({
    point: { x, y }, type: "line" as const,
  })),
});

/** The ink a hairline slice at `x` crosses, in x-heights above the line. */
async function runs(contours: Contour[], at: number, x: number) {
  const cut = await intersect(contours, [slice(at - x * 0.004, at + x * 0.004)]);
  return cut
    .map((one) => {
      const bounds = contoursBounds([one]);
      return [bounds.yMin / x, bounds.yMax / x] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
}

const show = (found: Array<[number, number]>) =>
  (found.map(([low, high]) => `${low.toFixed(2)}..${high.toFixed(2)}`).join(" ") || "-").padEnd(26);

async function report(
  name: string,
  glyph: (letter: string) => { contours: Contour[]; advanceWidth: number } | undefined,
  x: number,
) {
  console.log(`\n  ${name}`);
  console.log("    letter   at the origin               at the advance");
  const lows: number[] = [];
  const highs: number[] = [];
  for (const letter of LETTERS) {
    const drawn = glyph(letter);
    if (!drawn) continue;
    const entry = await runs(drawn.contours, 0, x);
    const exit = await runs(drawn.contours, drawn.advanceWidth, x);
    console.log(`    ${letter}        ${show(entry)}  ${show(exit)}`);
    // The middle of the lowest run at each edge, which is the stroke the hand
    // is on when it crosses -- an `f` or a `j` also crosses with its descender.
    if (entry.length > 0) lows.push((entry[0][0] + entry[0][1]) / 2);
    if (exit.length > 0) highs.push((exit[0][0] + exit[0][1]) / 2);
  }
  const mid = (all: number[]) => all.reduce((sum, one) => sum + one, 0) / Math.max(1, all.length);
  console.log(`    average  arrives at ${mid(lows).toFixed(2)}              leaves at ${mid(highs).toFixed(2)}`);
}

const { typeface } = await importFont(readFileSync(REF));
const refGlyph = (letter: string) =>
  typeface.glyphs.find((one) => one.unicodes.includes(letter.codePointAt(0) ?? -1));
const refX = contoursBounds(refGlyph("x")!.contours).yMax;

console.log("\nWhere the join arrives and leaves, in x-heights above the writing line");
await report("Dancing Script -- the reference", refGlyph, refX);
for (const style of BASES.filter((one) => one.parts.script?.on)) {
  if (FACE && style.name !== FACE) continue;
  await report(style.name, (letter) => drawLetter(letter, style, style.forms?.[letter]) ?? undefined,
    style.metrics.xHeight);
}
