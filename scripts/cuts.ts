/**
 * A sheet of the cut layer, one row per operation.
 *
 * The tests can say that a slot removed ink and that the letter is still in
 * one piece. Only an eye can say whether what is left looks like a typeface,
 * and every one of the six operations was settled against this page rather
 * than against a number.
 *
 *   npx vite-node scripts/cuts.ts
 *   SHEET_BASES=Display CELL=110 npx vite-node scripts/cuts.ts HAMBURGefonts
 *
 * Writes to $SHEET_OUT, or /tmp/cuts.html.
 */
import { writeFileSync } from "node:fs";

import { ready } from "@/font/boolean";
import { contoursToSvgPath } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { noCuts, piecesOf, type Cuts } from "@/forge/cut";
import { BASES, type Style } from "@/forge/style";

await ready();

const cell = Number(process.env.CELL ?? 62);
const text = process.argv[2] ?? "ABEHKMOQRSaegnors";
const letters = [...text];

const with_ = (patch: (cuts: Cuts) => void): Cuts => {
  const cuts = noCuts();
  patch(cuts);
  return cuts;
};

const rows: Array<{ label: string; cuts: Cuts | undefined }> = [
  { label: "uncut", cuts: undefined },
  {
    label: "slot · 2 bands",
    cuts: with_((c) => {
      c.slot.on = true;
    }),
  },
  {
    label: "slot · 5 bands at 20°",
    cuts: with_((c) => {
      c.slot = { on: true, count: 5, width: 0.28, angle: 20, inset: 0.08 };
    }),
  },
  {
    label: "tooth · left edge",
    cuts: with_((c) => {
      c.tooth.on = true;
    }),
  },
  {
    label: "tooth · both edges, deep",
    cuts: with_((c) => {
      c.tooth = { on: true, pitch: 0.07, depth: 0.55, edge: "both" };
    }),
  },
  {
    label: "inline",
    cuts: with_((c) => {
      c.inline.on = true;
    }),
  },
  {
    label: "inline · breaking out",
    cuts: with_((c) => {
      c.inline = { on: true, width: 0.34, inset: 0 };
    }),
  },
  {
    label: "motif · diamond",
    cuts: with_((c) => {
      c.motif.on = true;
    }),
  },
  {
    label: "motif · triangle, large",
    cuts: with_((c) => {
      c.motif = { on: true, shape: "triangle", size: 1.3 };
    }),
  },
  {
    label: "split · joins",
    cuts: with_((c) => {
      c.split.on = true;
    }),
  },
  {
    label: "split · wide",
    cuts: with_((c) => {
      c.split = { on: true, size: 0.9 };
    }),
  },
  {
    label: "chamfer",
    cuts: with_((c) => {
      c.chamfer.on = true;
    }),
  },
  {
    label: "chamfer · heavy",
    cuts: with_((c) => {
      c.chamfer = { on: true, size: 1.1 };
    }),
  },
  {
    label: "slot + chamfer + diamond",
    cuts: with_((c) => {
      c.slot = { on: true, count: 3, width: 0.3, angle: 0, inset: 0.12 };
      c.chamfer = { on: true, size: 0.55 };
      c.motif = { on: true, shape: "diamond", size: 1 };
    }),
  },
];

const only = (process.env.SHEET_BASES ?? "Sans,Display").split(",").filter(Boolean);
const bases = BASES.filter((base) => only.length === 0 || only.includes(base.name));

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
      <line x1="0" y1="0" x2="${width}" y2="0" stroke="#e4b4b4" stroke-width="6"/>
      <path d="${drawn ? contoursToSvgPath(drawn.contours) : ""}" fill="#111" fill-rule="nonzero"/>
    </svg>
    <figcaption>${parts > 1 ? `${parts} pieces` : "&nbsp;"}</figcaption>
  </figure>`;
}

const sections: string[] = [];
for (const style of bases) {
  const blocks = rows.map((row) => {
    const started = Date.now();
    const cells = letters.map((name) => cellFor(style, name, row.cuts)).join("");
    return `<div class="row"><h3>${row.label}<small>${Date.now() - started}ms</small></h3><div class="strip">${cells}</div></div>`;
  });
  sections.push(`<section><h2>${style.name}</h2>${blocks.join("")}</section>`);
}

const out = process.env.SHEET_OUT ?? "/tmp/cuts.html";
writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><style>
   body { font: 12px system-ui; background: #fff; margin: 12px; color: #111 }
   h2 { font-size: 15px; margin: 16px 0 6px; color: #333 }
   h3 { font-size: 11px; margin: 0 0 2px; color: #888; font-weight: 500 }
   h3 small { color: #ccc; padding-left: 6px }
   .row { margin-bottom: 8px }
   .strip { display: flex; flex-wrap: wrap; gap: 3px }
   figure { margin: 0; text-align: center; border: 1px solid #eee; padding: 1px }
   figure.gone { background: #fee }
   figcaption { font-size: 8px; color: #c60; line-height: 1 }
  </style>${sections.join("")}`,
);
console.log(
  `wrote ${out} — ${rows.length} rows x ${letters.length} letters x ${bases.length} bases`,
);
