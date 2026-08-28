/**
 * The same comparison `against.ts` makes, letter by letter.
 *
 * `against.ts` reports one number for a face and that number is a mean, which
 * hides what it is made of. The four faces read between 1.01 and 1.32 times the
 * reference's colour, and none of that was a face uniformly too heavy: it was
 * an `l` far too light on all four and a `v` too dark on three, which are two
 * different faults that happen to average to one.
 *
 * The reference figures below were measured from the released Dancing Script
 * (Pablo Impallari, SIL OFL 1.1), which its licence allows. Telma's does not
 * permit derivative work, so nothing is taken from that file.
 *
 * `colour`  The letter's ink over its advance times the x-height. A letter that
 *           reads too dark either has too much ink or too little room.
 *
 * `adv/x`   Which of those it is. The reference spreads its narrow letters --
 *           `l` 0.71, `e` 1.00, `s` 1.04, `o` 1.10, `a` 1.31 -- where a face
 *           spaced off the join's reach alone gives all of them the same
 *           number, and reads as letters in a row for it.
 *
 *   npx vite-node scripts/letter.ts
 */
import { ready, unite } from "@/font/boolean";
import { contourArea } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";

await ready();

/** Measured from the released Dancing Script, at its default weight. */
const REFERENCE: Record<string, { colour: number; fit: number }> = {
  h: { colour: 0.616, fit: 1.43 },
  a: { colour: 0.396, fit: 1.31 },
  n: { colour: 0.348, fit: 1.40 },
  d: { colour: 0.570, fit: 1.42 },
  g: { colour: 0.590, fit: 1.17 },
  l: { colour: 0.834, fit: 0.71 },
  o: { colour: 0.391, fit: 1.10 },
  v: { colour: 0.289, fit: 1.23 },
  e: { colour: 0.430, fit: 1.00 },
  s: { colour: 0.410, fit: 1.04 },
};
const WORD = "handgloves";

const faces = BASES.filter((one) => one.parts.script?.on);
const head = (what: string) =>
  `${what.padEnd(8)}${"ref".padStart(6)}` + faces.map((one) => one.name.slice(0, 8).padStart(11)).join("");

/** Off by more than this and the letter is named rather than merely listed. */
const NOTICEABLE = 0.15;

for (const [what, of] of [["colour", "colour"], ["adv/x", "fit"]] as const) {
  console.log(`\n${head(what)}`);
  const ink = new Map<string, [number, number]>();
  for (const letter of WORD) {
    const want = REFERENCE[letter][of];
    let row = `  ${letter}     ${want.toFixed(3)}`;
    for (const face of faces) {
      const x = face.metrics.xHeight;
      // The face's own form of the letter, not the default one: three of the
      // four draw a tailed `l` and a curled `g`, and comparing those against
      // the reference's while measuring the plain ones is comparing nothing.
      const drawn = drawLetter(letter, face, face.forms?.[letter])!;
      const area = unite(drawn.contours).reduce((all, one) => all + contourArea(one), 0);
      const got = of === "colour" ? area / (drawn.advanceWidth * x) : drawn.advanceWidth / x;
      const [was, wide] = ink.get(face.name) ?? [0, 0];
      ink.set(face.name, [was + area, wide + drawn.advanceWidth]);
      const off = got / want;
      row += `  ${got.toFixed(3)} ${off > 1 + NOTICEABLE || off < 1 - NOTICEABLE ? "*" : " "}`;
    }
    console.log(row);
  }
  if (of !== "colour") continue;
  let all = `  ALL   0.476`;
  for (const face of faces) {
    const [area, wide] = ink.get(face.name)!;
    all += `  ${(area / (wide * face.metrics.xHeight)).toFixed(3)}  `;
  }
  console.log(all);
}
console.log(`\n* = more than ${(NOTICEABLE * 100).toFixed(0)}% off the reference for that letter`);
