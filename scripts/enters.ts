/**
 * Where a join begins and ends, read off the letter rather than inferred.
 *
 * The line these faces draw is a fifth more than the reference's, and the joins
 * carry it -- but every attempt to shorten them by turning a number in
 * `script.ts` moved the total by a hundredth or by nothing, and the note on
 * `attach` lists six of them. The reason is in here, and it is not a number.
 *
 * Slice a letter down its length and print the runs of ink each slice crosses.
 * A join that is a stroke of its own shows as a thin run beside the letter,
 * living for a while before the body appears; a join that is the letter's own
 * first stroke shows as one run that is the body from the moment it exists.
 *
 * The reference's `n`, from a tenth of an x-height left of its origin:
 *
 *   -0.10  -0.00..0.09      one run, and it is already the letter
 *    0.00  -0.04..0.35
 *    0.10   0.03..0.77      still one run, climbing steeply
 *    0.25   0.27..0.40  0.41..0.83
 *
 * The Handwriting's, at the same places:
 *
 *   -0.05   0.26..0.32      a run six hundredths tall, and nothing else
 *    0.00   0.28..0.34      still only the join
 *    0.10   0.32..0.37      still only the join
 *    0.15  -0.08..0.45      the stem finally arrives
 *
 * So the reference has no join stroke at all. What connects its letters is the
 * up-stroke its `n` is written with -- the hand comes off the previous letter,
 * rises to the top of the first stem and turns down, and the connection is the
 * first part of the letter's own path. Ours draws a complete letter, standing
 * on the line, and then runs a separate stroke in from outside to touch it.
 *
 * That stroke cannot be short. `inset` stands the letter's ink one reach from
 * the origin, so its spine is half a pen further in again, and the join has to
 * span both: on the `n` that is 0.23 of an x-height across before any climb,
 * and the arc that gets there draws 0.37. Two of those a letter is most of the
 * difference, and no setting reaches it, because what is wrong is that the
 * stroke exists.
 *
 * The reference is Dancing Script (Pablo Impallari, SIL OFL 1.1), fetched from
 * npm as in the note on `beside.ts`.
 *
 *   REF=package/files/dancing-script-latin-400-normal.woff \
 *     npx vite-node scripts/enters.ts n
 */
import { readFileSync } from "node:fs";
import { ready, intersect } from "@/font/boolean";
import { contoursBounds } from "@/font/geometry";
import { importFont } from "@/font/parse";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";
import type { Contour } from "@/font/types";

await ready();

const LETTER = process.argv[2] ?? "n";
const REF = process.env.REF;
if (!REF) throw new Error("Set REF to the reference font file. See the note at the top.");

/** A thin upright slice, to see what a vertical line through the letter crosses. */
const slice = (from: number, to: number): Contour => ({
  closed: true,
  nodes: [
    [from, -4000],
    [to, -4000],
    [to, 4000],
    [from, 4000],
  ].map(([x, y]) => ({
    point: { x, y },
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  })),
});

async function across(name: string, contours: Contour[], x: number) {
  console.log(`\n  ${name}`);
  for (let at = -0.15; at <= 0.5 + 1e-9; at += 0.05) {
    const cut = await intersect(contours, [slice(x * at - x * 0.006, x * at + x * 0.006)]);
    const runs = cut
      .map((one) => {
        const bounds = contoursBounds([one]);
        return [bounds.yMin / x, bounds.yMax / x] as [number, number];
      })
      .sort((a, b) => a[0] - b[0]);
    console.log(
      `    x ${at.toFixed(2).padStart(5)}   ` +
        (runs.map(([low, high]) => `${low.toFixed(2)}..${high.toFixed(2)}`).join("  ") || "-"),
    );
  }
}

const { typeface } = await importFont(readFileSync(REF));
const refGlyph = (letter: string) =>
  typeface.glyphs.find((one) => one.unicodes.includes(letter.codePointAt(0) ?? -1));
const refX = contoursBounds(refGlyph("x")!.contours).yMax;

console.log(`\`${LETTER}\` sliced down its length -- the runs of ink each slice crosses`);
await across("Dancing Script -- the reference", refGlyph(LETTER)!.contours, refX);
for (const style of BASES.filter((one) => one.parts.script?.on)) {
  const drawn = drawLetter(LETTER, style, style.forms?.[LETTER]);
  if (drawn) await across(style.name, drawn.contours, style.metrics.xHeight);
}
