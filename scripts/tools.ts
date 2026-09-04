/**
 * A sheet of the effects layer, one row per setting.
 *
 * The tests can say that an effect changed the outline and by how many points.
 * Only an eye can say whether what came out looks like a marker or like a
 * letter somebody has damaged, and every default in `NO_EFFECTS` was settled
 * against this page rather than against a number.
 *
 *   npx vite-node scripts/tools.ts
 *   SHEET_BASES=Sans,Marker CELL=120 npx vite-node scripts/tools.ts Hamburg
 *
 * Writes to $SHEET_OUT, or /tmp/tools.html.
 */
import { writeFileSync } from "node:fs";

import { ready } from "@/font/boolean";
import { contoursToSvgPath } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { piecesOf } from "@/forge/cut";
import { noEffects, type Effects } from "@/forge/effects";
import { BASES, type Style } from "@/forge/style";

await ready();

const cell = Number(process.env.CELL ?? 96);
/*
 * Named rather than typed, because the engine knows letters by name and a
 * digit typed as "8" is not one of them -- it comes back as an empty box, which
 * looks exactly like an effect that erased the letter.
 */
const letters = (process.env.SHEET_LETTERS ?? "a,e,n,o,R,S,eight,exclam")
  .split(",")
  .filter(Boolean);

const with_ = (patch: (effects: Effects) => void): Effects => {
  const effects = noEffects();
  patch(effects);
  return effects;
};

const rows: Array<{ label: string; effects: Effects | undefined }> = [
  { label: "plain", effects: undefined },
  {
    label: "rough · default",
    effects: with_((e) => {
      e.rough.on = true;
    }),
  },
  {
    label: "rough · fine and shallow",
    effects: with_((e) => {
      e.rough = { ...e.rough, on: true, amplitude: 0.025, wavelength: 0.22 };
    }),
  },
  {
    label: "rough · coarse wobble",
    effects: with_((e) => {
      e.rough = { ...e.rough, on: true, amplitude: 0.09, wavelength: 1.1 };
    }),
  },
  {
    label: "rough · outside only",
    effects: with_((e) => {
      e.rough = { ...e.rough, on: true, reach: "outside" };
    }),
  },
  {
    label: "pool · default",
    effects: with_((e) => {
      e.pool.on = true;
    }),
  },
  {
    label: "pool · joins only",
    effects: with_((e) => {
      e.pool = { on: true, size: 0.7, where: "joins" };
    }),
  },
  {
    label: "pool · ends only",
    effects: with_((e) => {
      e.pool = { on: true, size: 0.7, where: "ends" };
    }),
  },
  {
    label: "skip · default",
    effects: with_((e) => {
      e.skip.on = true;
    }),
  },
  {
    label: "skip · worn",
    effects: with_((e) => {
      e.skip = { ...e.skip, on: true, density: 0.6, length: 1.8 };
    }),
  },
  {
    label: "press · middle",
    effects: with_((e) => {
      e.press.on = true;
    }),
  },
  {
    label: "press · start heavy",
    effects: with_((e) => {
      e.press = { on: true, at: "start", amount: 0.45 };
    }),
  },
  {
    label: "press · end heavy",
    effects: with_((e) => {
      e.press = { on: true, at: "end", amount: 0.45 };
    }),
  },
  {
    label: "MARKER · rough + pool",
    effects: with_((e) => {
      e.rough = { ...e.rough, on: true, amplitude: 0.035, wavelength: 0.3 };
      e.pool = { on: true, size: 0.5, where: "both" };
    }),
  },
  {
    label: "DRY MARKER · + skip",
    effects: with_((e) => {
      e.rough = { ...e.rough, on: true, amplitude: 0.035, wavelength: 0.3 };
      e.pool = { on: true, size: 0.4, where: "both" };
      e.skip = { ...e.skip, on: true, density: 0.35 };
    }),
  },
  {
    label: "BRUSH · press + rough",
    effects: with_((e) => {
      e.press = { on: true, at: "middle", amount: 0.4 };
      e.rough = { ...e.rough, on: true, amplitude: 0.02, wavelength: 0.9 };
    }),
  },
  {
    label: "ALL FOUR at defaults",
    effects: with_((e) => {
      e.rough.on = true;
      e.pool.on = true;
      e.skip.on = true;
      e.press.on = true;
    }),
  },
];

const only = (process.env.SHEET_BASES ?? "Sans,Marker,Brush").split(",").filter(Boolean);
const bases = BASES.filter((base) => only.length === 0 || only.includes(base.name));

function cellFor(style: Style, name: string, effects: Effects | undefined): string {
  const drawn = drawLetter(name, style, undefined, undefined, undefined, undefined, effects);
  const em = style.metrics.unitsPerEm;
  const top = style.metrics.ascender * 1.08;
  const bottom = style.metrics.descender * 1.2;
  const width = drawn?.advanceWidth ?? em * 0.5;
  const parts = drawn ? piecesOf(drawn.contours) : 0;
  const points = drawn ? drawn.contours.reduce((sum, c) => sum + c.nodes.length, 0) : 0;
  const gone = !drawn || drawn.contours.length === 0;
  return `<figure${gone ? ' class="gone"' : ""}>
    <svg viewBox="0 ${bottom} ${width} ${top - bottom}" width="${cell}" style="transform: scaleY(-1)">
      <line x1="0" y1="0" x2="${width}" y2="0" stroke="#e4b4b4" stroke-width="6"/>
      <path d="${drawn ? contoursToSvgPath(drawn.contours) : ""}" fill="#111" fill-rule="nonzero"/>
    </svg>
    <figcaption>${points}p${parts > 1 ? ` · ${parts} pieces` : ""}</figcaption>
  </figure>`;
}

const sections: string[] = [];
for (const style of bases) {
  const blocks = rows.map((row) => {
    const started = Date.now();
    const cells = letters.map((name) => cellFor(style, name, row.effects)).join("");
    return `<div class="row"><h3>${row.label}<small>${Date.now() - started}ms</small></h3><div class="strip">${cells}</div></div>`;
  });
  sections.push(`<section><h2>${style.name}</h2>${blocks.join("")}</section>`);
}

const out = process.env.SHEET_OUT ?? "/tmp/tools.html";
writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>the effects layer</title>
<style>
  body { background:#fbfaf8; color:#111; font:14px/1.5 ui-sans-serif,system-ui,sans-serif; margin:0; padding:24px 28px 60px; }
  h2 { font-size:15px; letter-spacing:.14em; text-transform:uppercase; color:#888; margin:32px 0 10px; border-bottom:1px solid #ddd; padding-bottom:6px; }
  .row { margin-bottom:14px; }
  h3 { font-size:12px; font-weight:600; color:#444; margin:0 0 2px; display:flex; gap:10px; align-items:baseline; }
  h3 small { font-weight:400; color:#aaa; font-variant-numeric:tabular-nums; }
  .strip { display:flex; gap:6px; flex-wrap:wrap; align-items:flex-end; }
  figure { margin:0; }
  figure.gone { outline:2px solid #d33; }
  figcaption { font-size:10px; color:#aaa; text-align:center; font-variant-numeric:tabular-nums; }
  svg { display:block; background:#fff; border:1px solid #eee; }
</style>${sections.join("")}`,
);
console.log(`wrote ${out}`);
