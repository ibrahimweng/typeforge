/**
 * A font under each of the effects, one row a setting, for looking at.
 *
 * The parametric controls (crossbar, shoulder, slab, middle space), the cuts
 * (slots, saw, breaks, counters, chamfer, inline) and the cast (shadow, rim,
 * points, fillets), each on its own and a few together. Writes one SVG per
 * row and a line per letter whose outline crosses itself or comes apart.
 *
 *   FONT=path OUT=dir npx vite-node scripts/dev/effects-sheet.ts
 *   FORGE=Sans OUT=dir npx vite-node scripts/dev/effects-sheet.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noCast, type Cast } from "@/font/cast";
import { noCuts, type Cuts } from "@/font/cuts";
import { contoursToSvgPath } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { importFont } from "@/font/parse";
import { resolveAdvanceWidth, resolveGlyphContours } from "@/font/transform";
import { DEFAULT_PARAMS, type GlyphParams, type Typeface } from "@/font/types";
import { readyToShape } from "@/forge/layers";

const out = process.env.OUT ?? ".";
const text = process.env.TEXT ?? "HAEnmhrkaegsRBbo48";
mkdirSync(out, { recursive: true });

async function open(): Promise<Typeface> {
  if (process.env.FONT)
    return (await importFont(readFileSync(process.env.FONT), process.env.FONT)).typeface;
  const { startFrom } = await import("@/forge/document");
  const { BASES } = await import("@/forge/style");
  const { toTypeface } = await import("@/forge/typeface");
  const base = BASES.find((one) => one.name === process.env.FORGE) ?? BASES[0];
  return toTypeface(startFrom(base), {
    familyName: base.name,
    styleName: "Regular",
    weightClass: 400,
    merge: false,
    kern: false,
  });
}

await readyToShape();
const typeface = await open();
const em = typeface.unitsPerEm;
const EM = new Set(["weight", "cornerRadius", "tracking", "slab", "crossbar", "shoulder"]);

type Row = {
  params?: Partial<GlyphParams>;
  cuts?: Partial<{ [K in keyof Cuts]: Partial<Cuts[K]> }>;
  cast?: Partial<{ [K in keyof Cast]: Partial<Cast[K]> }>;
};
const rows: Record<string, Row> = JSON.parse(
  process.env.ROWS ??
    JSON.stringify({
      rest: {},
      "crossbar up": { params: { crossbar: 0.08 } },
      "crossbar down": { params: { crossbar: -0.08 } },
      "shoulder up": { params: { shoulder: 0.06 } },
      "shoulder down": { params: { shoulder: -0.06 } },
      slab: { params: { slab: 0.06 } },
      "slab heavy": { params: { slab: 0.06, weight: 0.04 } },
      "middle open": { params: { counterScale: 1.3 } },
      "middle shut": { params: { counterScale: 0.7 } },
      slots: { cuts: { slot: { on: true } } },
      "slots angled": { cuts: { slot: { on: true, count: 3, angle: 20 } } },
      saw: { cuts: { tooth: { on: true } } },
      "saw both": { cuts: { tooth: { on: true, edge: "both" } } },
      breaks: { cuts: { split: { on: true } } },
      counters: { cuts: { motif: { on: true } } },
      "counters ring": { cuts: { motif: { on: true, shape: "ring" } } },
      chamfer: { cuts: { chamfer: { on: true } } },
      inline: { cuts: { inline: { on: true } } },
      shadow: { cast: { extrude: { on: true } } },
      rim: { cast: { outline: { on: true } } },
      points: { cast: { spur: { on: true } } },
      fillets: { cast: { weld: { on: true } } },
      "mix 1": {
        params: { weight: 0.03, slant: 10, slab: 0.05 },
        cuts: { slot: { on: true } },
        cast: { extrude: { on: true } },
      },
      "mix 2": {
        params: { crossbar: 0.06, shoulder: 0.05, counterScale: 1.2 },
        cuts: { tooth: { on: true }, chamfer: { on: true } },
        cast: { outline: { on: true } },
      },
    }),
);

const glyphs = [...text]
  .map((ch) => typeface.glyphs.find((g) => g.unicodes.includes(ch.codePointAt(0) ?? 0)))
  .filter((g) => g !== undefined);

for (const [name, row] of Object.entries(rows)) {
  const params = Object.fromEntries(
    Object.entries(row.params ?? {}).map(([k, v]) => [k, EM.has(k) ? (v as number) * em : v]),
  );
  typeface.params = { ...DEFAULT_PARAMS, ...params };
  const cuts = noCuts();
  for (const [k, v] of Object.entries(row.cuts ?? {}))
    Object.assign((cuts as unknown as Record<string, object>)[k], v);
  const cast = noCast();
  for (const [k, v] of Object.entries(row.cast ?? {}))
    Object.assign((cast as unknown as Record<string, object>)[k], v);
  typeface.cuts = cuts;
  typeface.cast = cast;
  let x = 0;
  const parts: string[] = [];
  const faults: string[] = [];
  for (const glyph of glyphs) {
    let contours: ReturnType<typeof resolveGlyphContours>;
    try {
      contours = resolveGlyphContours(glyph, typeface);
    } catch (error) {
      faults.push(`${glyph.name}: threw ${(error as Error).message}`);
      continue;
    }
    const bad = contours.filter((c) =>
      c.nodes.some((n) => !Number.isFinite(n.point.x) || !Number.isFinite(n.point.y)),
    );
    if (bad.length) faults.push(`${glyph.name}: NaN`);
    const crossed = contours.filter((c) => contoursIntersect([c])).length;
    if (crossed) faults.push(`${glyph.name}: ${crossed} crossed`);
    parts.push(
      `<g transform="translate(${x + em * 0.1},${em * 0.95}) scale(1,-1)"><path d="${contoursToSvgPath(contours)}" fill="black"/></g>`,
    );
    x += Math.max(resolveAdvanceWidth(glyph, typeface), em * 0.3) + em * 0.1;
  }
  const width = x + em * 0.2;
  writeFileSync(
    join(out, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${em * 1.25}" width="${width / 5}" height="${(em * 1.25) / 5}"><rect width="100%" height="100%" fill="white"/>${parts.join("")}</svg>`,
  );
  console.log(`${name}: ${faults.length ? faults.join("; ") : "ok"}`);
}
