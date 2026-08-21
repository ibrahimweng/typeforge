/**
 * A sheet of whatever is being drawn, as a page to look at.
 *
 * The tests say whether a glyph is *built* like one: that no stroke crosses
 * itself, that nothing wanders off the line, that the figures are one width.
 * None of that says whether it looks like an ampersand, and nothing can except
 * an eye -- so this draws whichever glyphs it is given across every base at
 * once and writes a page to look at them on.
 *
 * Every symbol in the font was drawn against this. The three that had to be
 * built a second way -- the brace, the pilcrow and the yen -- looked wrong here
 * long before any test had an opinion about them.
 *
 *   npx vite-node scripts/sheet.ts ampersand at percent
 *   SHEET_BASES=Sans,Display CELL=120 npx vite-node scripts/sheet.ts braceleft
 *
 * Writes to $SHEET_OUT, or /tmp/sheet.html.
 */
import { writeFileSync } from "node:fs";

import { contoursBounds } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";

const cell = Number(process.env.CELL ?? 52);
const want = process.argv.slice(2);
const names = want.length > 0 ? want : [];

function pathOf(contours: ReturnType<typeof drawLetter>): string {
  if (!contours) return "";
  return contours.contours
    .map((contour) => {
      const nodes = contour.nodes;
      if (nodes.length === 0) return "";
      let d = `M ${nodes[0].point.x} ${nodes[0].point.y}`;
      for (let index = 1; index <= nodes.length; index++) {
        const from = nodes[index - 1];
        const to = nodes[index % nodes.length];
        if (index === nodes.length && !contour.closed) break;
        if (from.handleOut || to.handleIn) {
          const c1 = from.handleOut ?? from.point;
          const c2 = to.handleIn ?? to.point;
          d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.point.x} ${to.point.y}`;
        } else {
          d += ` L ${to.point.x} ${to.point.y}`;
        }
      }
      return d + (contour.closed ? " Z" : "");
    })
    .join(" ");
}

const rows: string[] = [];
const only = (process.env.SHEET_BASES ?? "").split(",").filter(Boolean);
for (const style of BASES.filter((b) => only.length === 0 || only.includes(b.name))) {
  const cells: string[] = [];
  for (const name of names) {
    const drawn = drawLetter(name, style);
    const em = style.metrics.unitsPerEm;
    const top = style.metrics.ascender * 1.1;
    const bottom = style.metrics.descender * 1.2;
    const width = drawn?.advanceWidth ?? em * 0.5;
    let note = "";
    if (drawn && drawn.contours.length > 0) {
      const b = contoursBounds(drawn.contours);
      note = `${Math.round(b.xMin)}…${Math.round(b.xMax)} / ${Math.round(width)}`;
    }
    cells.push(`<figure>
      <svg viewBox="0 ${bottom} ${width} ${top - bottom}" width="${cell}" style="transform: scaleY(-1)">
        <line x1="0" y1="0" x2="${width}" y2="0" stroke="#c33" stroke-width="6"/>
        <line x1="0" y1="${style.metrics.capHeight}" x2="${width}" y2="${style.metrics.capHeight}" stroke="#39c" stroke-width="4"/>
        <line x1="0" y1="${style.metrics.xHeight}" x2="${width}" y2="${style.metrics.xHeight}" stroke="#9c3" stroke-width="4"/>
        <path d="${pathOf(drawn)}" fill="#111" fill-rule="nonzero"/>
      </svg>
      <figcaption>${name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}<br><small>${note}</small></figcaption>
    </figure>`);
  }
  rows.push(`<section><h2>${style.name}</h2><div class="row">${cells.join("")}</div></section>`);
}

writeFileSync(
  process.env.SHEET_OUT ?? "/tmp/sheet.html",
  `<!doctype html><meta charset="utf-8"><style>
   body { font: 12px system-ui; background: #fff; margin: 12px; color: #111 }
   h2 { font-size: 13px; margin: 14px 0 4px; color: #666 }
   .row { display: flex; flex-wrap: wrap; gap: 6px }
   figure { margin: 0; text-align: center; border: 1px solid #eee; padding: 2px }
   figcaption { font-size: 9px; color: #888; line-height: 1.15 }
   small { color: #bbb; font-size: 8px }
  </style>${rows.join("")}`,
);
console.log(`wrote ${process.env.SHEET_OUT ?? "/tmp/sheet.html"} — ${names.length} glyphs across ${BASES.length} bases`);
