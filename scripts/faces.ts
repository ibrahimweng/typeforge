/**
 * A line of type from each base, so the picker can be judged rather than read.
 *
 *   SHEET_BASES=Sans,Marker,Brush npx vite-node scripts/faces.ts
 */
import { writeFileSync } from "node:fs";

import { ready } from "@/font/boolean";
import { contoursToSvgPath } from "@/font/geometry";
import { draw, startFrom } from "@/forge/document";
import { BASES, type Style } from "@/forge/style";

await ready();
const text = (process.env.SHEET_TEXT ?? "a,g,n,o,t,y,l,e,H,S").split(",");
const only = (process.env.SHEET_BASES ?? "").split(",").filter(Boolean);
const bases = BASES.filter((one) => only.length === 0 || only.includes(one.name));

const rows = bases.map((style: Style) => {
  const forge = startFrom(style);
  const at = Date.now();
  const cells = text
    .map((name) => {
      const drawn = draw(name, forge);
      const top = style.metrics.ascender * 1.08;
      const bottom = style.metrics.descender * 1.2;
      const width = drawn?.advanceWidth ?? 500;
      return `<figure><svg viewBox="0 ${bottom} ${width} ${top - bottom}" width="88" style="transform:scaleY(-1)">
        <line x1="0" y1="0" x2="${width}" y2="0" stroke="#e4b4b4" stroke-width="6"/>
        <path d="${drawn ? contoursToSvgPath(drawn.contours) : ""}" fill="#111" fill-rule="nonzero"/>
      </svg></figure>`;
    })
    .join("");
  return `<div class="row"><h3>${style.name}<small>${style.family} · ${Date.now() - at}ms</small></h3><div class="strip">${cells}</div></div>`;
});

const out = process.env.SHEET_OUT ?? "/tmp/faces.html";
writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>the bases</title>
<style>
  body{background:#fbfaf8;color:#111;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:0;padding:20px 24px 50px}
  .row{margin-bottom:12px}
  h3{font-size:12px;font-weight:600;color:#444;margin:0 0 2px;display:flex;gap:10px;align-items:baseline}
  h3 small{font-weight:400;color:#aaa}
  .strip{display:flex;gap:5px;flex-wrap:wrap;align-items:flex-end}
  figure{margin:0}
  svg{display:block;background:#fff;border:1px solid #eee}
</style>${rows.join("")}`,
);
console.log(`wrote ${out}`);
