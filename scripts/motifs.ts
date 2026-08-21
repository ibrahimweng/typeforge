/**
 * A sheet of the counter shapes, one row per shape.
 *
 * The sibling of scripts/cuts.ts, and it exists for the same reason: a test
 * can say a hole was cut and that nothing burst out of the letter, and no test
 * has an opinion about whether the hole looks like it belongs in a typeface.
 * Every shape here was settled against this page.
 *
 * Only letters with counters, because the rest have nothing to replace.
 *
 *   npx vite-node scripts/motifs.ts
 *   SHEET_BASES=Display SIZES=0.6,1,1.3 npx vite-node scripts/motifs.ts
 *
 * Writes to $SHEET_OUT, or /tmp/motifs.html.
 */
import { writeFileSync } from "node:fs";

import { ready } from "@/font/boolean";
import { contoursToSvgPath } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { noCuts, piecesOf, type Cuts, type MotifShape } from "@/forge/cut";
import { BASES, type Style } from "@/forge/style";

await ready();

const cell = Number(process.env.CELL ?? 74);
const text = process.argv[2] ?? "ABDOPQRabdegopq";
const letters = [...text];
const sizes = (process.env.SIZES ?? "1").split(",").map(Number);

const SHAPES: MotifShape[] = [
  "diamond",
  "lozenge",
  "nested",
  "triangle",
  "hourglass",
  "chevron",
  "bars",
  "square",
  "slot",
  "dot",
  "ring",
];

const only = (process.env.SHEET_BASES ?? "Sans,Display").split(",").filter(Boolean);
const bases = BASES.filter((base) => only.length === 0 || only.includes(base.name));

function motif(shape: MotifShape, size: number): Cuts {
  const cuts = noCuts();
  cuts.motif = { on: true, shape, size };
  return cuts;
}

function cellFor(style: Style, name: string, cuts: Cuts | undefined): string {
  const drawn = drawLetter(name, style, undefined, cuts);
  const em = style.metrics.unitsPerEm;
  const top = style.metrics.ascender * 1.08;
  const bottom = style.metrics.descender * 1.2;
  const width = drawn?.advanceWidth ?? em * 0.5;
  const parts = drawn ? piecesOf(drawn.contours) : 0;
  const gone = !drawn || drawn.contours.length === 0;
  return `<figure${gone ? ' class="gone"' : ""}>
    <svg viewBox="0 ${bottom} ${width} ${top - bottom}" width="${cell}" style="transform: scaleY(-1)">
      <path d="${drawn ? contoursToSvgPath(drawn.contours) : ""}" fill="#111" fill-rule="nonzero"/>
    </svg>
    <figcaption>${parts > 1 ? `${parts} pieces` : "&nbsp;"}</figcaption>
  </figure>`;
}

const sections: string[] = [];
for (const style of bases) {
  const blocks: string[] = [
    `<div class="row"><h3>uncut</h3><div class="strip">${letters
      .map((name) => cellFor(style, name, undefined))
      .join("")}</div></div>`,
  ];
  for (const shape of SHAPES) {
    for (const size of sizes) {
      const label = sizes.length > 1 ? `${shape} · ${size}` : shape;
      const cells = letters.map((name) => cellFor(style, name, motif(shape, size))).join("");
      blocks.push(`<div class="row"><h3>${label}</h3><div class="strip">${cells}</div></div>`);
    }
  }
  sections.push(`<section><h2>${style.name}</h2>${blocks.join("")}</section>`);
}

const out = process.env.SHEET_OUT ?? "/tmp/motifs.html";
writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><style>
   body { font: 12px system-ui; background: #fff; margin: 12px; color: #111 }
   h2 { font-size: 15px; margin: 16px 0 6px; color: #333 }
   h3 { font-size: 11px; margin: 0 0 2px; color: #888; font-weight: 500 }
   .row { margin-bottom: 8px }
   .strip { display: flex; flex-wrap: wrap; gap: 3px }
   figure { margin: 0; text-align: center; border: 1px solid #eee; padding: 1px }
   figure.gone { background: #fee }
   figcaption { font-size: 8px; color: #c60; line-height: 1 }
  </style>${sections.join("")}`,
);
console.log(
  `wrote ${out} — ${SHAPES.length} shapes x ${sizes.length} sizes x ${letters.length} letters x ${bases.length} bases`,
);
