/** Lora above, a Draw-mode face below, same text, same scale. Scratch. */
import { readFileSync, writeFileSync } from "node:fs";
import { contoursToSvgPath } from "@/font/geometry";
import { importFont } from "@/font/parse";
import { resolveGlyphContours, resolveAdvanceWidth } from "@/font/transform";
import { proof, startFrom, type Forge } from "@/forge/document";
import { readyToShape } from "@/forge/layers";
import { BASES } from "@/forge/style";

await readyToShape();
const text = process.env.TEXT ?? "Handgloves Rabbit Quiz";
const lines = (
  process.env.LINES ?? "abcdefghijklm|nopqrstuvwxyz|ABCDEFGHIJKLM|NOPQRSTUVWXYZ|0123456789&?!"
).split("|");
const bytes = new Uint8Array(readFileSync(process.env.LORA!));
const { typeface } = await importFont(bytes, "lora.ttf");
const base = BASES.find((b) => b.name === (process.env.FACE ?? "Serif"))!;
let forge: Forge = startFrom(base);
if (process.env.STYLE) {
  const patch = JSON.parse(process.env.STYLE);
  const merge = (a: any, b: any): any =>
    b && typeof b === "object" && !Array.isArray(b)
      ? Object.fromEntries(
          [...new Set([...Object.keys(a ?? {}), ...Object.keys(b)])].map((k) => [
            k,
            k in b ? merge(a?.[k], b[k]) : a[k],
          ]),
        )
      : b;
  forge = { ...forge, style: merge(forge.style, patch) };
}
// The forge keys figures and marks by glyph name, as fonts do.
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
  ".": "period",
  ",": "comma",
  ":": "colon",
  ";": "semicolon",
};
let maxX = 0;
const emL = typeface.unitsPerEm;
const emF = base.metrics.unitsPerEm;
function row(s: string, y: number, which: "lora" | "forge"): string {
  let x = 40;
  const out: string[] = [];
  for (const ch of s) {
    if (ch === " ") {
      x += 250;
      continue;
    }
    if (which === "lora") {
      const g = typeface.glyphs.find((g) => g.unicodes.includes(ch.codePointAt(0)!));
      if (!g) continue;
      const k = 1000 / emL;
      out.push(
        `<g transform="translate(${x},${y}) scale(${k},${-k})"><path d="${contoursToSvgPath(resolveGlyphContours(g, typeface))}"/></g>`,
      );
      x += resolveAdvanceWidth(g, typeface) * k;
    } else {
      const r = proof(GLYPH[ch] ?? ch, forge);
      if (!r) {
        x += 300;
        continue;
      }
      const k = 1000 / emF;
      out.push(
        `<g transform="translate(${x},${y}) scale(${k},${-k})"><path d="${contoursToSvgPath(r.contours)}"/></g>`,
      );
      x += r.advanceWidth * k;
    }
  }
  maxX = Math.max(maxX, x);
  return out.join("");
}
const all = [text, ...lines].filter((s) => s.length > 0);
const h = 1250;
let body = "";
all.forEach((s, i) => {
  body +=
    `<text x="10" y="${i * 2 * h + 300}" font-size="90" fill="#c00">Ref</text>` +
    row(s, i * 2 * h + 1000, "lora");
  body +=
    `<text x="10" y="${(i * 2 + 1) * h + 300}" font-size="90" fill="#06c">Draw</text>` +
    row(s, (i * 2 + 1) * h + 1000, "forge");
});
const W = maxX + 100,
  H = all.length * 2 * h;
writeFileSync(
  process.env.OUT!,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / 10}" height="${H / 10}"><rect width="100%" height="100%" fill="white"/>${body}</svg>`,
);
