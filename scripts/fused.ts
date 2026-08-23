/**
 * The letter as the pen laid it beside the letter as the file will hold it.
 *
 * `sheet.ts` draws what the pen makes, which is what the application shows.
 * This draws that beside what comes out of the fuse, which is what a font file
 * actually carries -- and those are not always the same picture. A fuse handed
 * shapes with edges lying along one another can answer with a clean outline of
 * a believable size that is a different letter: a bowl filled solid, a serif
 * sheared off, two strokes joined that should not be.
 *
 * `fuse.spec.ts` catches that across every face by counting pixels. This is
 * for when it has caught one and somebody has to see what happened.
 *
 *   npx vite-node scripts/fused.ts Flared:p Slab:b Sans:a
 *   SHEET_OUT=/tmp/x.html npx vite-node scripts/fused.ts Brush:d
 *
 * Writes to $SHEET_OUT, or /tmp/fused.html.
 */
import { writeFileSync } from "node:fs";

import { ready, unite } from "@/font/boolean";
import { contourArea, contoursBounds, contoursToSvgPath } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";

await ready();

const want = process.argv.slice(2).map((one) => one.split(":"));
if (want.length === 0) {
  console.error("give it face:letter pairs, such as  Flared:p  Sans:a");
  process.exit(1);
}

const cell = Number(process.env.CELL ?? 110);
const ink = (contours: Contour[]): number =>
  Math.abs(contours.reduce((total, one) => total + contourArea(one), 0));

const rows: string[] = [];
for (const [face, name] of want) {
  const style = BASES.find((base) => base.name === face);
  if (!style) {
    console.error(`no face called ${face}; there is ${BASES.map((b) => b.name).join(", ")}`);
    continue;
  }
  const pen = drawLetter(name, style)?.contours;
  if (!pen || pen.length === 0) {
    console.error(`${face} has no ${name}`);
    continue;
  }
  const cells: string[] = [];
  /*
   * Both readings, because which one a caller asks for is the difference
   * between a counter kept and a counter filled: a letter out of the pen
   * already says which contour is a counter and should be believed, and one
   * that arrived as an outline has to be guessed at by nesting.
   */
  for (const [tag, contours] of [
    ["pen", pen],
    ["winding", unite(pen, "winding")],
    ["nesting", unite(pen, "nesting")],
  ] as const) {
    const top = style.metrics.ascender * 1.15;
    const bottom = style.metrics.descender * 1.3;
    const box = contoursBounds(contours);
    const width = Math.max(box.xMax + 40, style.metrics.unitsPerEm * 0.4);
    cells.push(
      `<figure><svg viewBox="${Math.min(0, box.xMin) - 20} ${bottom} ${width} ${top - bottom}"` +
        ` width="${cell}" style="transform: scaleY(-1)">` +
        `<path d="${contoursToSvgPath(contours, 3)}" fill="#111" fill-rule="nonzero"/></svg>` +
        `<figcaption>${tag}<br><small>${contours.length}c ${ink(contours).toFixed(0)}</small>` +
        `</figcaption></figure>`,
    );
  }
  rows.push(`<section><h2>${face} ${name}</h2><div>${cells.join("")}</div></section>`);
}

const out = process.env.SHEET_OUT ?? "/tmp/fused.html";
writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>fused</title><style>
   body{background:#fff;font:12px system-ui;margin:14px}
   section{display:inline-block;margin:0 18px 14px 0;vertical-align:top}
   h2{font-size:12px;margin:0 0 4px}div{display:flex;gap:6px}
   figure{margin:0;text-align:center}figcaption{color:#555;font-size:10px}
   </style>${rows.join("")}`,
);
console.log(`wrote ${out}`);
