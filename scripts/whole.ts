/**
 * Every letter of every script face, in one piece or not, across the weight
 * axis rather than at the weight the face happens to be drawn at.
 *
 * The letters test draws each face at its own weight, so a letter that only
 * comes apart somewhere else on the axis passes it. The Formal Script's k did
 * exactly that: whole at 96 and in two pieces from about 110 up, because its
 * vee was meeting its stem on twenty units of ink and the bow -- which is
 * measured in pen-halves -- walked the stem out of them as the pen grew. That
 * one is fixed and has a test of its own now; run this after any change to how
 * strokes meet, which is what it is for.
 *
 * The t and the curled g that this found next are fixed too, and for the same
 * reason underneath: a descender's eye is as long as the pen says, and at a
 * light pen that was not far enough to reach back onto the letter. There is a
 * test on the axis for that one as well; this stays as the wider net.
 *
 *   npx vite-node scripts/whole.ts
 */
import { ready } from "@/font/boolean";
import { piecesOf } from "@/forge/cut";
import { drawLetter, letterNames } from "@/forge/build";
import { BASES, type Style } from "@/forge/style";
import { formsOf } from "@/forge/letters";
await ready();
const solid = letterNames().filter((n) => /^[A-Za-z]$/.test(n) && n !== "i" && n !== "j");
const scripts = BASES.filter((b) => b.parts.script?.on && b.parts.script.bow > 0);
let bad = 0;
for (const base of scripts) {
  const broke: string[] = [];
  for (const weight of [40, 60, 84, 100, 120, 145, 175, 210]) {
    const style: Style = { ...base, pen: { ...base.pen, weight } };
    for (const name of solid) {
      for (const { id } of formsOf(name)) {
        const d = drawLetter(name, style, id || undefined);
        if (!d || d.contours.length === 0) continue;
        if (piecesOf(d.contours) > 1) broke.push(`${name}${id ? `(${id})` : ""}@${weight}`);
      }
    }
  }
  bad += broke.length;
  console.log(`${base.name.padEnd(16)} ${broke.length ? broke.join(" ") : "whole at every weight"}`);
}
console.log(`\n${bad} breaks in all`);
