/**
 * A few letters large, the reshaped outline filled and the drawn one traced
 * over it with its points, for seeing where a control goes wrong.
 *
 *   FONT=path TEXT=nas SETTING='{"weight":0.06}' OUT=file.svg npx vite-node scripts/dev/params-zoom.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { importFont } from "@/font/parse";
import { resolveGlyphContours } from "@/font/transform";
import { contoursToSvgPath } from "@/font/geometry";
import { DEFAULT_PARAMS, type GlyphParams } from "@/font/types";

const { typeface } = await importFont(readFileSync(process.env.FONT ?? ""), "font");
const em = typeface.unitsPerEm;
const EM_RELATIVE = new Set(["weight", "cornerRadius", "tracking", "slab", "crossbar", "shoulder"]);
const given = JSON.parse(process.env.SETTING ?? '{"weight":0.06}') as Record<string, number>;
const change = Object.fromEntries(
  Object.entries(given).map(([key, value]) => [key, EM_RELATIVE.has(key) ? value * em : value]),
) as Partial<GlyphParams>;
let x = 0;
const parts: string[] = [];
for (const ch of process.env.TEXT ?? "nas") {
  const glyph = typeface.glyphs.find((one) => one.unicodes.includes(ch.codePointAt(0) ?? 0));
  if (!glyph) continue;
  typeface.params = { ...DEFAULT_PARAMS };
  const before = resolveGlyphContours(glyph, typeface);
  typeface.params = { ...DEFAULT_PARAMS, ...change };
  const after = resolveGlyphContours(glyph, typeface);
  const dots = after
    .flatMap((c) => c.nodes)
    .map((n) => `<circle cx="${n.point.x}" cy="${n.point.y}" r="6" fill="#0a0"/>`)
    .join("");
  parts.push(
    `<g transform="translate(${x + 150},${em}) scale(1,-1)"><path d="${contoursToSvgPath(after)}" fill="#bbb" fill-rule="nonzero"/><path d="${contoursToSvgPath(after)}" fill="none" stroke="#070" stroke-width="3"/><path d="${contoursToSvgPath(before)}" fill="none" stroke="red" stroke-width="3"/>${dots}</g>`,
  );
  x += glyph.advanceWidth + 300;
}
writeFileSync(
  process.env.OUT ?? "zoom.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 150} ${em * 1.3}" width="${(x + 150) / 2}" height="${(em * 1.3) / 2}"><rect width="100%" height="100%" fill="white"/>${parts.join("")}</svg>`,
);
