/**
 * What pen a font was written with, read back out of its own letters.
 *
 *   FONT=/path/to/some.ttf npx vite-node scripts/hand.ts
 *
 * Point it only at a font you have the right to derive from.
 */
import { readFileSync } from "node:fs";
import { ready } from "@/font/boolean";
import { importFont } from "@/font/parse";
import { fitGlyph } from "@/quill/fit";
import { handOf, withHand } from "@/quill/hand";

await ready();
const { typeface } = await importFont(
  new Uint8Array(readFileSync(process.env.FONT!)),
  "ref.ttf",
);
const upm = typeface.unitsPerEm ?? 1000;
const byChar = new Map<string, (typeof typeface.glyphs)[number]>();
for (const glyph of typeface.glyphs)
  for (const code of glyph.unicodes ?? []) byChar.set(String.fromCodePoint(code), glyph);

console.log("letter   pen found                     pressure spread   flatter by");
const all: Array<{ contrast: number; angle: number }> = [];
const everything: Parameters<typeof handOf>[0] = [];
for (const character of process.env.LETTERS ?? "abcdefghijklmnopqrstuvwxyz") {
  const glyph = byChar.get(character);
  if (!glyph?.contours?.length) continue;
  const fit = fitGlyph(character, glyph.contours, glyph.advanceWidth, { unitsPerEm: upm });
  if (!fit) continue;
  const found = handOf(fit.glyph.strokes);
  if (!found) {
    console.log(`  ${character}      too few directions to say`);
    continue;
  }
  const flatter = ((1 - found.spread / found.roundSpread) * 100).toFixed(0);
  const kept = withHand(fit.glyph.strokes).hand;
  all.push({ contrast: found.contrast, angle: found.angle });
  everything.push(...fit.glyph.strokes);
  console.log(
    `  ${character}      blade ${found.contrast.toFixed(2)} at ${found.angle.toFixed(0).padStart(4)}°` +
      `   ${found.roundSpread.toFixed(3)} -> ${found.spread.toFixed(3)}` +
      `   ${flatter.padStart(3)}%   ${kept ? "kept" : "rejected"}`,
  );
}
if (all.length > 0) {
  const mid = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
  console.log(
    `\nmedian of the per-letter fits: blade ${mid(all.map((one) => one.contrast)).toFixed(2)}` +
      ` at ${mid(all.map((one) => one.angle)).toFixed(0)}°`,
  );
}

/*
 * And the answer that is actually used: one pen read out of the whole alphabet
 * at once, which is both the principled reading -- a hand holds one pen -- and
 * the robust one, since no single letter is then thin enough evidence to be
 * fitted by itself.
 */
const pooled = handOf(everything);
if (pooled) {
  console.log(
    `pooled over the alphabet:      blade ${pooled.contrast.toFixed(2)} at ${pooled.angle.toFixed(0)}°` +
      `   ${pooled.roundSpread.toFixed(3)} -> ${pooled.spread.toFixed(3)}` +
      `   ${((1 - pooled.spread / pooled.roundSpread) * 100).toFixed(0)}% flatter`,
  );
}
