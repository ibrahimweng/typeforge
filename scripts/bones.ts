/**
 * Whether a letter's spine is built from the same pieces at every weight.
 *
 * The skeleton is the letter's idea of itself and the pen is what draws it, so
 * a spine whose piece list changes shape when the pen changes width is a recipe
 * deciding the node count. What must not move is how many pieces there are and
 * what kind each one is; where they sit is the pen's business.
 *
 * Asked with the bowl book open and read back, which is the only way to ask it
 * honestly. Called on a bare recipe the answer is wrong in a way that looks
 * like a finding: a bowl's piece list begins wherever that weight's arithmetic
 * puts it, so the lists come out rotated against each other, and the rotation
 * is exactly what the book is there to take out. Asking without one measures
 * the problem the book already solved.
 *
 *   FACE=Display npx vite-node scripts/bones.ts
 */

import { drawLetter, letterNames } from "@/forge/build";
import { deliver } from "@/forge/deliver";
import { startFrom, weighted } from "@/forge/document";
import { recipeOf } from "@/forge/letters";
import { openWaveBook, waveBookAt, type WaveBook } from "@/forge/shapes";
import { BASES, SANS } from "@/forge/style";

const WEIGHTS = [100, 400, 700, 900];
const DRAWN = 400;
const face = BASES.find((one) => one.name === (process.env.FACE ?? "Display")) ?? SANS;
const forge = { ...startFrom(face), family: { drawn: DRAWN, also: WEIGHTS } };

const delivered = await deliver(
  { ...startFrom(face), family: { drawn: DRAWN, also: WEIGHTS.filter((w) => w !== DRAWN) } },
  { familyName: "Probe", format: "ttf", variable: true },
);
const held = [...new Set(delivered.held)].sort();

/** One entry per stroke: what kind each spine segment is, in order. */
function shapeOf(name: string, style: ReturnType<typeof weighted>["style"]): string {
  const recipe = recipeOf(name);
  if (!recipe) return "(built from components)";
  return recipe(style)
    .strokes.map((stroke) => {
      const kinds = stroke.spine.segments.map((one) => one.kind[0]).join("");
      return `${stroke.spine.closed ? "[" : "("}${kinds}${stroke.spine.closed ? "]" : ")"}`;
    })
    .join(" ");
}

const book: WaveBook = { lengths: new Map(), bowls: new Map(), recording: true };
const was = openWaveBook(book);

// The drawn weight first, recording, as `deliver` does it. Every letter, not
// just the standing ones: the book's pages are written in the order the letters
// are drawn and a partial pass would leave later letters reading the wrong one.
const drawnStyle = weighted(forge, DRAWN).style;
for (const name of letterNames()) {
  waveBookAt(name);
  drawLetter(name, drawnStyle);
}
book.recording = false;

const shapes = new Map<number, Map<string, string>>();
for (const weight of WEIGHTS) {
  const style = weighted(forge, weight).style;
  const mine = new Map<string, string>();
  for (const name of letterNames()) {
    waveBookAt(name);
    mine.set(name, shapeOf(name, style));
  }
  shapes.set(weight, mine);
}
openWaveBook(was);

let moving = 0;
for (const name of held) {
  const mine = WEIGHTS.map((weight) => shapes.get(weight)!.get(name) ?? "");
  const same = mine.every((one) => one === mine[0]);
  if (!same) moving += 1;
  console.log(`${same ? "  steady " : "  MOVES  "} ${name.padEnd(15)} ${same ? mine[0] : mine.join("   |   ")}`);
}
console.log(
  `\n${face.name}: ${held.length} left standing, ${moving} with a spine that changes shape with the pen`,
);
