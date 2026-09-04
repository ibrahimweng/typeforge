/**
 * The curve of each letter, ours against the reference's.
 *
 * `against.ts` and `letter.ts` measure how much ink a letter has and how much
 * room it takes. Both agreed the four faces were within a tenth of the
 * reference while the page still read as a slanted roman with script ornaments
 * bolted on, because neither of them asks what shape the strokes are.
 *
 * Two numbers say it, and they are the two faults:
 *
 * `round`  A bowl's width at its waist over its full height. One is a circle.
 *          Taken at the waist because the joins leave at about a fifth of the
 *          x-height and would otherwise be measured as part of the bowl.
 *
 *          On a band a tenth of an x-height deep this read the reference's `o`
 *          as 1.006 -- a circle -- and that was wrong, and the four faces were
 *          widened on it. The band was deep enough to catch the `o`'s exit,
 *          which climbs through 0.3 to 0.4 of an x-height and reaches half an
 *          x-height outside the bowl, so what was measured was the letter plus
 *          its join. On a band three hundredths deep the bowl is 0.799: an
 *          upright oval, not a circle. The band is thin here for that reason
 *          and must stay thin.
 *
 * `bow`    How far the letter's left edge stands off the straight line joining
 *          its ends, in x-heights, signed: positive bulges left. Measured on
 *          the left edge rather than the middle, because below the x-height an
 *          `h` has the arch beside the stem and a middle would average the two.
 *          Shear-proof: a shear moves every point at a given height by the same
 *          amount, so a horizontal distance from a line at that height survives
 *          it. A straight stem is 0.
 *
 *          The left edge, not the stem's left edge, and the difference is the
 *          lead-in: it climbs from the seam into the letter and is left of the
 *          stem for part of the way up. That is the honest comparison rather
 *          than a flaw, because the reference's lead-in is not a separate
 *          stroke either -- it is the up-stroke the letter is written with.
 *          What it cannot survive is a loop, which is a stroke bowed hard to
 *          the left of the ascender it stands on and swamps everything else, so
 *          every letter is now read between 0.3 and 0.9 of an x-height, under
 *          every loop this family draws. Read to 1.9 the `l`, `h`, `b` and `k`
 *          came out between -0.16 and -0.46 against the reference's +0.09, and
 *          all of that was the eye.
 *
 * The reference is Dancing Script (Pablo Impallari, SIL OFL 1.1), fetched from
 * npm as in the note on `beside.ts`. Telma's licence does not permit this, so
 * nothing is ever taken from that file.
 *
 *   REF=package/files/dancing-script-latin-400-normal.woff npx vite-node scripts/bends.ts
 */
import { readFileSync } from "node:fs";
import { ready, intersect } from "@/font/boolean";
import { contoursBounds } from "@/font/geometry";
import { importFont } from "@/font/parse";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";
import type { Contour } from "@/font/types";

await ready();

const REF = process.env.REF;
if (!REF) throw new Error("Set REF to the reference font file. See the note at the top.");

const band = (low: number, high: number): Contour => ({
  closed: true,
  nodes: [
    [-4000, low],
    [4000, low],
    [4000, high],
    [-4000, high],
  ].map(([x, y]) => ({
    point: { x, y },
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  })),
});

const { typeface } = await importFont(readFileSync(REF));
const refGlyph = (letter: string) =>
  typeface.glyphs.find((one) => one.unicodes.includes(letter.codePointAt(0) ?? -1));
const refX = contoursBounds(refGlyph("x")!.contours).yMax;

async function round(contours: Contour[], x: number): Promise<number | null> {
  const all = contoursBounds(contours);
  const cut = await intersect(contours, [band(x * 0.485, x * 0.515)]);
  if (!cut.length) return null;
  const waist = contoursBounds(cut);
  return (waist.xMax - waist.xMin) / (all.yMax - all.yMin);
}

/** `low` and `high` are in x-heights above the baseline. */
async function bow(
  contours: Contour[],
  x: number,
  low: number,
  high: number,
): Promise<number | null> {
  const edges: Array<{ y: number; edge: number }> = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const y = x * (low + ((high - low) * i) / steps);
    const half = (x * (high - low)) / steps / 2;
    const cut = await intersect(contours, [band(y - half, y + half)]);
    if (!cut.length) continue;
    edges.push({ y, edge: contoursBounds(cut).xMin });
  }
  if (edges.length < 3) return null;
  const first = edges[0];
  const last = edges[edges.length - 1];
  let worst = 0;
  for (const one of edges) {
    const along = (one.y - first.y) / (last.y - first.y || 1);
    const straight = first.edge + (last.edge - first.edge) * along;
    // Left is negative in the outline's own terms, so flip it: a stem that
    // bulges left should read positive.
    const off = straight - one.edge;
    if (Math.abs(off) > Math.abs(worst)) worst = off;
  }
  return worst / x;
}

/** Where to look on each letter, in x-heights above the baseline. */
const STEMS: Record<string, [number, number]> = {
  l: [0.3, 0.9],
  h: [0.3, 0.9],
  b: [0.3, 0.9],
  k: [0.3, 0.9],
  d: [0.3, 0.9],
  n: [0.3, 0.9],
  m: [0.3, 0.9],
  i: [0.3, 0.9],
  u: [0.3, 0.9],
  r: [0.3, 0.9],
};
const BOWLS = ["o", "e", "c", "a", "g", "q", "p", "b", "d"];

const faces = BASES.filter((one) => one.parts.script?.on);
const head =
  `${"".padEnd(5)}${"reference".padStart(10)}` +
  faces.map((one) => one.name.slice(0, 9).padStart(10)).join("");

const show = (n: number | null) => (n === null ? "     --   " : n.toFixed(3).padStart(10));

console.log("round -- a bowl's waist over its height. 1.000 is a circle.\n");
console.log(head);
for (const letter of BOWLS) {
  const theirs = refGlyph(letter);
  const cells = [show(theirs ? await round(theirs.contours, refX) : null)];
  for (const style of faces) {
    const ours = drawLetter(letter, style, style.forms?.[letter]);
    cells.push(show(ours ? await round(ours.contours, style.metrics.xHeight) : null));
  }
  console.log(`${letter.padEnd(5)}${cells.join("")}`);
}

console.log("\nbow -- how far a stem stands off straight, in x-heights. 0 is a ruled line.\n");
console.log(head);
for (const [letter, [low, high]] of Object.entries(STEMS)) {
  const theirs = refGlyph(letter);
  const cells = [show(theirs ? await bow(theirs.contours, refX, low, high) : null)];
  for (const style of faces) {
    const ours = drawLetter(letter, style, style.forms?.[letter]);
    cells.push(show(ours ? await bow(ours.contours, style.metrics.xHeight, low, high) : null));
  }
  console.log(`${letter.padEnd(5)}${cells.join("")}`);
}
