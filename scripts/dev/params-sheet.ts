/**
 * A sheet of letters under the family controls, for looking at rather than
 * reasoning about.
 *
 * Renders a font's letters at rest and under each setting given, side by side,
 * as one SVG per setting, and prints how evenly the weight went on: for every
 * letter, the spread between the thinnest and thickest the added ink got, and
 * whether any contour crossed itself.
 *
 *   FONT=path/to/font.ttf OUT=dir npx vite-node scripts/dev/params-sheet.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importFont } from "@/font/parse";
import { resolveGlyphContours } from "@/font/transform";
import { contoursToSvgPath, crossesItself, flattenContour } from "@/font/geometry";
import { DEFAULT_PARAMS, type Contour, type GlyphParams, type Vec2 } from "@/font/types";

const font = process.env.FONT ?? "";
const out = process.env.OUT ?? ".";
const text = process.env.TEXT ?? "HOnoaegsRkyxAEWM25&";
mkdirSync(out, { recursive: true });

const { typeface } = await importFont(readFileSync(font), font);
const em = typeface.unitsPerEm;
const glyphs = [...text].map((ch) =>
  typeface.glyphs.find((one) => one.unicodes.includes(ch.codePointAt(0) ?? 0)),
);

const settings: Record<string, Partial<GlyphParams>> = JSON.parse(
  process.env.SETTINGS ??
    JSON.stringify({
      rest: {},
      bold: { weight: 0.04 },
      black: { weight: 0.06 },
      light: { weight: -0.03 },
      slant: { slant: 12 },
      round: { cornerRadius: 0.05 },
      all: { weight: 0.04, slant: 12, cornerRadius: 0.03, width: 0.85 },
    }),
);

function distanceToPolyline(point: Vec2, lines: Vec2[][]): number {
  let best = Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const a = line[i];
      const b = line[(i + 1) % line.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
      best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)));
    }
  }
  return best;
}

// The em-relative controls are written as a share of the em and stored in
// units, as the inspector does.
const EM_RELATIVE = new Set(["weight", "cornerRadius", "tracking", "slab", "crossbar", "shoulder"]);
for (const [name, given] of Object.entries(settings)) {
  const change: Partial<GlyphParams> = Object.fromEntries(
    Object.entries(given).map(([key, value]) => [
      key,
      EM_RELATIVE.has(key) ? (value as number) * em : value,
    ]),
  );
  typeface.params = { ...DEFAULT_PARAMS, ...change };
  const cell = em * 1.1;
  let x = 0;
  const paths: string[] = [];
  const report: string[] = [];
  for (const glyph of glyphs) {
    if (!glyph) continue;
    const contours: Contour[] = resolveGlyphContours(glyph, typeface);
    const flipped = contoursToSvgPath(contours);
    paths.push(
      `<g transform="translate(${x + em * 0.1},${em * 0.9}) scale(1,-1)"><path d="${flipped}" fill="black" fill-rule="nonzero"/></g>`,
    );
    x += Math.max(glyph.advanceWidth * (change.width ?? 1), em * 0.3) + em * 0.25;

    if (change.weight && Object.keys(change).length === 1) {
      // How far each point of the new outline sits from the old one: even
      // weight means one number, up to the corners.
      typeface.params = { ...DEFAULT_PARAMS };
      const before = resolveGlyphContours(glyph, typeface).map((c) => flattenContour(c, 16));
      typeface.params = { ...DEFAULT_PARAMS, ...change };
      const target = Math.abs(change.weight);
      const samples = contours.flatMap((c) => flattenContour(c, 16));
      const gaps = samples.map((p) => distanceToPolyline(p, before));
      const off = gaps.filter((g) => Math.abs(g - target) > target * 0.25).length;
      const crossed = contours.filter((c) => crossesItself(c)).length;
      report.push(
        `${glyph.name}: target ${target.toFixed(0)} min ${Math.min(...gaps).toFixed(0)} max ${Math.max(...gaps).toFixed(0)} off ${((off / gaps.length) * 100).toFixed(0)}% crossed ${crossed}`,
      );
    }
  }
  const width = x + em * 0.1;
  writeFileSync(
    join(out, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${cell}" width="${width / 4}" height="${cell / 4}"><rect width="100%" height="100%" fill="white"/>${paths.join("")}</svg>`,
  );
  if (report.length) console.log(`--- ${name}\n${report.join("\n")}`);
}
