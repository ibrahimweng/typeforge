/**
 * A reference font above, a Draw-mode face below, same text, same scale: an
 * SVG sheet for checking a forged face against the face it is modelled on.
 *
 *   LORA=ref.ttf [OUT=compare-sheet.svg] [FACE=Serif] [STYLE=json] [TEXT=...] [LINES=a|b|c]
 *     npx vite-node scripts/dev/compare-sheet.ts
 *
 * LORA is the reference font (any TTF/OTF/WOFF/WOFF2) and is required, OUT
 * where the sheet goes (compare-sheet.svg if unset), FACE the Draw base by
 * name, STYLE a JSON patch merged into that base's style (a weight, say),
 * TEXT the first row and LINES the further rows, split on "|".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { contoursToSvgPath } from "@/font/geometry";
import { glyphNameFor } from "@/assemble/slots";
import { importFont } from "@/font/parse";
import { resolveGlyphContours, resolveAdvanceWidth } from "@/font/transform";
import { proof, startFrom, type Forge } from "@/forge/document";
import { readyToShape } from "@/forge/layers";
import { BASES } from "@/forge/style";

const reference = process.env.LORA;
if (!reference) {
  console.error(
    "LORA is not set: name the reference font to compare against, e.g.\n" +
      "  LORA=Lora-Regular.ttf OUT=sheet.svg npx vite-node scripts/dev/compare-sheet.ts",
  );
  process.exit(1);
}
const out = process.env.OUT ?? "compare-sheet.svg";

await readyToShape();
const text = process.env.TEXT ?? "Handgloves Rabbit Quiz";
const lines = (
  process.env.LINES ?? "abcdefghijklm|nopqrstuvwxyz|ABCDEFGHIJKLM|NOPQRSTUVWXYZ|0123456789&?!"
).split("|");
const bytes = new Uint8Array(readFileSync(reference));
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
      // The forge keys figures and marks by glyph name, as fonts do.
      const r = proof(glyphNameFor(ch), forge);
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
  out,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / 10}" height="${H / 10}"><rect width="100%" height="100%" fill="white"/>${body}</svg>`,
);
