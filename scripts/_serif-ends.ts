/**
 * Lora above, the Draw Serif at a light, the regular and a black weight below.
 * Prints every contour that crosses itself. Scratch.
 *
 *   LORA=lora.ttf OUT=x.svg TEXT=HIT [PENS='[{"weight":30},{}]'] [STYLE=json] npx vite-node scripts/_serif-ends.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { contoursToSvgPath } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { importFont } from "@/font/parse";
import { resolveAdvanceWidth, resolveGlyphContours } from "@/font/transform";
import { type Forge, proof, startFrom } from "@/forge/document";
import { readyToShape } from "@/forge/layers";
import { BASES } from "@/forge/style";

await readyToShape();
const text = process.env.TEXT ?? "HITnilx";
const pens: Array<Record<string, number>> = JSON.parse(
  process.env.PENS ?? '[{"weight":30},{},{"weight":200}]',
);
const typeface = process.env.LORA
  ? (await importFont(new Uint8Array(readFileSync(process.env.LORA)), "lora.ttf")).typeface
  : null;
const base = BASES.find((b) => b.name === (process.env.FACE ?? "Serif"))!;
const merge = (a: any, b: any): any =>
  b && typeof b === "object" && !Array.isArray(b)
    ? Object.fromEntries(
        [...new Set([...Object.keys(a ?? {}), ...Object.keys(b)])].map((k) => [
          k,
          k in b ? merge(a?.[k], b[k]) : a[k],
        ]),
      )
    : b;
const GLYPH: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
  "&": "ampersand",
  "?": "question",
  "!": "exclam",
};
const h = 1150;
let body = "";
let maxX = 0;
let row = 0;
if (typeface) {
  let x = 300;
  const k = 1000 / typeface.unitsPerEm;
  for (const ch of text) {
    const g = typeface.glyphs.find((g) => g.unicodes.includes(ch.codePointAt(0)!));
    if (!g) continue;
    body += `<g transform="translate(${x},${950}) scale(${k},${-k})"><path d="${contoursToSvgPath(resolveGlyphContours(g, typeface))}"/></g>`;
    x += resolveAdvanceWidth(g, typeface) * k;
  }
  body += `<text x="10" y="500" font-size="90" fill="#c00">Lora</text>`;
  maxX = x;
  row = 1;
}
for (const pen of pens) {
  let forge: Forge = startFrom(base);
  if (process.env.STYLE)
    forge = { ...forge, style: merge(forge.style, JSON.parse(process.env.STYLE)) };
  forge = { ...forge, style: merge(forge.style, { pen }) };
  const y = row * h + 950;
  const label = `${forge.style.pen.weight}/${forge.style.pen.contrast}/${forge.style.pen.angle}`;
  body += `<text x="10" y="${y - 450}" font-size="70" fill="#06c">${label}</text>`;
  let x = 300;
  const faults: string[] = [];
  for (const ch of text) {
    if (ch === " ") {
      x += 250;
      continue;
    }
    const r = proof(GLYPH[ch] ?? ch, forge);
    if (!r) {
      x += 300;
      continue;
    }
    const crossed = r.contours.filter((c) => contoursIntersect([c])).length;
    if (crossed) faults.push(`${ch}:${crossed}`);
    body += `<g transform="translate(${x},${y}) scale(1,-1)"><path d="${contoursToSvgPath(r.contours)}"/></g>`;
    x += r.advanceWidth;
  }
  maxX = Math.max(maxX, x);
  console.log(`${label}: ${faults.length ? `crossed ${faults.join(" ")}` : "clean"}`);
  row++;
}
const W = maxX + 100;
const H = row * h;
writeFileSync(
  process.env.OUT!,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / 10}" height="${H / 10}"><rect width="100%" height="100%" fill="white"/>${body}</svg>`,
);
