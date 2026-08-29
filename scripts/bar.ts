/**
 * Whether a word has a rule drawn through it.
 *
 * Set as words, these faces came out with a bar of ink running the whole length
 * of the line at the writing height -- every letter's join tail at the same
 * height, meeting end to end. It is the plainest difference between our page
 * and the reference's and no measure here could see it: `against.ts` counts a
 * face's ink, `letter.ts` counts a letter's, and a bar is neither more ink nor
 * less, only ink in a line.
 *
 * So: cut a word at a height and count the runs. A joined hand crosses that
 * height once per letter and each crossing is short. A bar is one run as long
 * as the word.
 *
 * `longest` is the share of the word the longest single run covers, which is
 * the number that says it. The reference's `handgloves` at the seam is 0.20 --
 * its longest run is a fifth of the word, which is two letters joined. A face
 * whose letters have all fused into one stroke reads 1.00.
 *
 * The reference is Dancing Script (Pablo Impallari, SIL OFL 1.1), fetched from
 * npm as in the note on `beside.ts`. Telma's licence does not permit this, so
 * nothing is ever taken from that file.
 *
 *   REF=package/files/dancing-script-latin-400-normal.woff \
 *     npx vite-node scripts/bar.ts handgloves
 */
import { readFileSync } from "node:fs";
import { ready, unite, intersect } from "@/font/boolean";
import { contoursBounds } from "@/font/geometry";
import { importFont } from "@/font/parse";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";
import type { Contour, Glyph } from "@/font/types";

await ready();

const WORD = process.argv[2] ?? "handgloves";
const REF = process.env.REF;
if (!REF) throw new Error("Set REF to the reference font file. See the note at the top.");

const band = (low: number, high: number): Contour => ({
  closed: true,
  nodes: [[-9000, low], [9000, low], [9000, high], [-9000, high]].map(([x, y]) => ({
    point: { x, y }, type: "line" as const,
  })),
});

const shifted = (contours: Contour[], by: number): Contour[] =>
  contours.map((one) => ({
    ...one,
    nodes: one.nodes.map((node) => ({
      ...node,
      point: { x: node.point.x + by, y: node.point.y },
      handleIn: node.handleIn ? { x: node.handleIn.x + by, y: node.handleIn.y } : null,
      handleOut: node.handleOut ? { x: node.handleOut.x + by, y: node.handleOut.y } : null,
    })),
  }));

/** The word as one set of contours, letters advanced along the line. */
async function setWord(
  glyphs: Array<{ contours: Contour[]; advanceWidth: number }>,
): Promise<Contour[]> {
  const all: Contour[] = [];
  let along = 0;
  for (const glyph of glyphs) {
    all.push(...shifted(glyph.contours, along));
    along += glyph.advanceWidth;
  }
  return unite(all);
}

/**
 * The runs of ink a horizontal line crosses, as [from, to] pairs.
 *
 * The boolean has no scanline, so the word is cut with a thin band and the
 * pieces sorted along the line. A band rather than a line because a cut exactly
 * on a tangent is a numerical coin toss.
 */
async function runsAt(word: Contour[], y: number, thick: number): Promise<Array<[number, number]>> {
  const cut = await intersect(word, [band(y - thick / 2, y + thick / 2)]);
  return cut
    .map((one) => {
      const bounds = contoursBounds([one]);
      return [bounds.xMin, bounds.xMax] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
}

/** Runs that touch or overlap are one run: the eye reads ink, not contours. */
function merged(runs: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [from, to] of runs) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/**
 * How much of the word's length is inked at a height, and at which height most.
 *
 * The bar is not one stroke -- cut at the writing line, our words and the
 * reference's both come to a dozen or two runs. It is every letter's tail
 * sitting at the *same* height with a small gap between each, which the eye
 * joins up into a rule. So the number that says it is not how long one run is,
 * it is how much of the whole line is ink at one height.
 */
async function report(name: string, word: Contour[], x: number) {
  const whole = contoursBounds(word);
  const across = whole.xMax - whole.xMin;
  let worst = { at: 0, share: 0 };
  const profile: string[] = [];
  for (let i = -2; i <= 8; i++) {
    const at = i / 20;
    const runs = merged(await runsAt(word, x * at, x * 0.03));
    const inked = runs.reduce((sum, [from, to]) => sum + (to - from), 0) / across;
    if (inked > worst.share) worst = { at, share: inked };
    if (i % 2 === 0) profile.push(`${at.toFixed(2)}:${inked.toFixed(2)}`);
  }
  console.log(`  ${name.padEnd(17)} most ${worst.share.toFixed(2)} at ${worst.at.toFixed(2)}   ${profile.join(" ")}`);
}

const { typeface } = await importFont(readFileSync(REF));
const refGlyph = (letter: string): Glyph | undefined =>
  typeface.glyphs.find((one) => one.unicodes.includes(letter.codePointAt(0) ?? -1));
const refX = contoursBounds(refGlyph("x")!.contours).yMax;

console.log(`\`${WORD}\`: the share of the line that is ink, at heights in x-heights\n`);
await report("reference", await setWord([...WORD].map(refGlyph).filter((one): one is Glyph => !!one)), refX);
for (const style of BASES.filter((one) => one.parts.script?.on)) {
  const glyphs = [...WORD]
    .map((letter) => drawLetter(letter, style, style.forms?.[letter]))
    .filter((one): one is NonNullable<typeof one> => !!one);
  await report(style.name, await setWord(glyphs), style.metrics.xHeight);
}
