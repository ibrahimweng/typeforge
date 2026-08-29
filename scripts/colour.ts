/**
 * A face set at several pen weights, so its colour can be chosen by looking.
 *
 * Weight is the one number that cannot be judged from a letter on its own --
 * what it sets is how dark a line of text comes out, and that only shows in a
 * line of text. This sets one, at each weight asked for, and prints the weight
 * as a share of the x-height and the line's width in units beside it.
 *
 * The width matters because two of a script face's numbers are measured in
 * stems and so move with the pen: `script.reach` and `ball.size`. Change the
 * weight alone and the face gets wider and its terminals grow, and what was
 * meant as a change of colour is also a change of fit. Sweep `REACHES` at the
 * new weight and pick the one that puts the line back where it was.
 *
 *   FACE="Formal Script" TEXT="Garamond aoegs" WEIGHTS=96,120,145 \
 *     npx vite-node scripts/colour.ts
 */
import { writeFileSync } from "node:fs";
import { ready } from "@/font/boolean";
import { contoursToSvgPath } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { BASES, type Style } from "@/forge/style";
await ready();
const base = BASES.find((b) => b.name === (process.env.FACE ?? "Formal Script"))!;
const TEXT = (process.env.TEXT ?? "Garamond Italic").split("");
const weights = (process.env.WEIGHTS ?? "96,120,145,175").split(",").map(Number);
const reaches = (process.env.REACHES ?? "").split(",").filter(Boolean).map(Number);
const blocks: string[] = [];
for (const weight of weights) {
 for (const reach of reaches.length ? reaches : [base.parts.script.reach]) {
  const style: Style = { ...base, pen: { ...base.pen, weight },
    parts: { ...base.parts, script: { ...base.parts.script, reach } } };
  let x = 0;
  const parts: string[] = [];
  for (const ch of TEXT) {
    if (ch === " ") { x += style.metrics.xHeight * 0.7; continue; }
    const d = drawLetter(ch, style, style.forms?.[ch]);
    if (!d) continue;
    parts.push(`<g transform="translate(${x} 0)"><path d="${contoursToSvgPath(d.contours)}" fill="#111"/></g>`);
    x += d.advanceWidth;
  }
  const { ascender, descender, xHeight } = style.metrics;
  blocks.push(
    `<div style="font:600 12px system-ui;color:#666;margin-top:8px">pen ${weight}` +
    ` (${((weight / xHeight) * 100).toFixed(0)}% of x), reach ${reach} — line ${x.toFixed(0)} units</div>` +
    `<svg viewBox="-40 ${-ascender - 20} ${x + 90} ${ascender - descender + 50}" width="1080">` +
    `<g transform="scale(1 -1)"><line x1="-40" y1="0" x2="${x + 40}" y2="0" stroke="#e88" stroke-width="3"/>` +
    parts.join("") + `</g></svg>`);
 }
}
writeFileSync(process.env.OUT ?? "/tmp/wt.html", `<body style="margin:18px;background:#fff">${blocks.join("")}</body>`);
console.log(`${blocks.length} rows`);
