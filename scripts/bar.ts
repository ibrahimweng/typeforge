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
 * The number that says it is the longest single run, as a share of the word,
 * taken over every height and allowing runs the eye closes up -- a rule made of
 * separate tails a tenth of an x-height apart is still a rule. The reference's
 * `handgloves` reads 0.06. Ours read 0.18, 0.20, 0.17 and 0.14.
 *
 * How much of the word is ink at one height was tried first and does not work.
 * It reads 0.49 on the reference and 0.64 to 0.74 on ours, which looks like a
 * difference until it is swept: it barely moves for the unsteadiness, the level
 * run, the knit or the seam height, because most of what it counts is the
 * letters themselves rather than what joins them.
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

/**
 * Runs that touch are one run: the eye reads ink, not contours. `bridge` closes
 * gaps narrower than itself as well, for the reading where a line of separate
 * tails still reads as a line.
 */
function merged(runs: Array<[number, number]>, bridge = 0): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [from, to] of runs) {
    const last = out[out.length - 1];
    if (last && from <= last[1] + bridge) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/**
 * The longest unbroken run of ink at any height, and where it is.
 *
 * Reported twice: touching, and again allowing the runs either side of a gap a
 * tenth of an x-height wide to count as one, because that is a gap the eye
 * closes and a rule made of separate tails is still a rule.
 *
 * Also the share of the line that is ink at the worst height, which is the
 * measure that was tried first and did not work -- kept because a number that
 * does not move is worth being able to show does not move.
 */
async function report(name: string, word: Contour[], x: number) {
  const whole = contoursBounds(word);
  const across = whole.xMax - whole.xMin;
  let longest = { at: 0, run: 0 };
  let bridged = 0;
  let share = 0;
  for (let i = -4; i <= 24; i++) {
    const at = i / 20;
    const runs = await runsAt(word, x * at, x * 0.03);
    const touching = merged(runs);
    const most = touching.reduce((top, [from, to]) => Math.max(top, to - from), 0) / across;
    if (most > longest.run) longest = { at, run: most };
    share = Math.max(share, touching.reduce((sum, [from, to]) => sum + (to - from), 0) / across);
    bridged = Math.max(bridged, merged(runs, x * 0.1)
      .reduce((top, [from, to]) => Math.max(top, to - from), 0) / across);
  }
  console.log(
    `  ${name.padEnd(17)} longest ${longest.run.toFixed(2)} at ${longest.at.toFixed(2)}` +
    `   bridging tenth-gaps ${bridged.toFixed(2)}   most ink at one height ${share.toFixed(2)}`,
  );
}

const { typeface } = await importFont(readFileSync(REF));
const refGlyph = (letter: string): Glyph | undefined =>
  typeface.glyphs.find((one) => one.unicodes.includes(letter.codePointAt(0) ?? -1));
const refX = contoursBounds(refGlyph("x")!.contours).yMax;

console.log(`\`${WORD}\`, every figure a share of the word's length\n`);
await report("reference", await setWord([...WORD].map(refGlyph).filter((one): one is Glyph => !!one)), refX);
for (const style of BASES.filter((one) => one.parts.script?.on)) {
  const glyphs = [...WORD]
    .map((letter) => drawLetter(letter, style, style.forms?.[letter]))
    .filter((one): one is NonNullable<typeof one> => !!one);
  await report(style.name, await setWord(glyphs), style.metrics.xHeight);
}
