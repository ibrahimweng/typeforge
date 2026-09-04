/**
 * The pairs a joined script gets wrong, set both ways.
 *
 * A written `o`, `v`, `w` and `b` hand over at the waist where every other
 * letter hands over at the baseline, and that is a fact about the pair rather
 * than about either letter. This sets the awkward pairs with the plain letter
 * after them and with the alternate that comes in high, so the two can be
 * compared on the page -- which is the only way to tell whether the second one
 * is worth a GSUB table.
 *
 *   npx vite-node scripts/pairs.ts             every joined face
 *   npx vite-node scripts/pairs.ts Handwriting one of them
 *
 * Writes to $OUT, or /tmp/pairs.html.
 */
import { writeFileSync } from "node:fs";

import { ready } from "@/font/boolean";
import { contoursToSvgPath } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { joiningHigh } from "@/forge/letters";
import { BASES, type Style } from "@/forge/style";
import type { Contour } from "@/font/types";

const slid = (contours: Contour[], by: number): Contour[] =>
  contours.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: { x: node.point.x + by, y: node.point.y },
      handleIn: node.handleIn ? { x: node.handleIn.x + by, y: node.handleIn.y } : null,
      handleOut: node.handleOut ? { x: node.handleOut.x + by, y: node.handleOut.y } : null,
    })),
  }));

const PAIRS = ["on", "oa", "ou", "ve", "wa", "br", "oo", "ow", "no", "an"];

/** A word set with every letter after a high hand-over drawn high, or not. */
function setWord(style: Style, word: string, contextual: boolean): { path: string; width: number } {
  const high = new Set(["o", "v", "w", "b"]);
  let x = 0;
  const parts: string[] = [];
  for (let at = 0; at < word.length; at++) {
    const letter = word[at];
    const leaves = contextual && high.has(letter) && at + 1 < word.length;
    const arrives = contextual && at > 0 && high.has(word[at - 1]);
    const drawn =
      leaves || arrives
        ? joiningHigh({ entry: arrives, exit: leaves }, () => drawLetter(letter, style))
        : drawLetter(letter, style);
    if (!drawn) continue;
    parts.push(contoursToSvgPath(slid(drawn.contours, x)));
    x += drawn.advanceWidth;
  }
  return { path: parts.join(" "), width: x };
}

async function main() {
  await ready();
  const wanted = process.argv[2];
  const faces = BASES.filter((one) => (wanted ? one.name === wanted : one.parts.script.on));
  const blocks: string[] = [];

  for (const style of faces) {
    const { ascender, descender } = style.metrics;
    const step = ascender - descender + 120;
    const rows: string[] = [];
    let y = 0;
    for (const pair of PAIRS) {
      const plain = setWord(style, pair, false);
      const swapped = setWord(style, pair, true);
      const gap = Math.max(plain.width, swapped.width) + 140;
      rows.push(
        `<g transform="translate(0 ${y})">` +
          `<line x1="0" y1="0" x2="${gap * 2}" y2="0" stroke="#e88" stroke-width="3"/>` +
          `<path d="${plain.path}" fill="#111"/>` +
          `<g transform="translate(${gap} 0)"><path d="${swapped.path}" fill="#a11"/></g>` +
          `</g>`,
      );
      y -= step;
    }
    const widest = Math.max(...PAIRS.map((one) => setWord(style, one, false).width)) * 2 + 320;
    blocks.push(
      `<section><h2>${style.name} <span>plain / contextual</span></h2>` +
        `<svg viewBox="-60 ${-(ascender + 60)} ${widest} ${PAIRS.length * step + 200}" width="900">` +
        `<g transform="scale(1 -1)">${rows.join("")}</g></svg></section>`,
    );
  }

  writeFileSync(
    process.env.OUT ?? "/tmp/pairs.html",
    `<!doctype html><meta charset="utf-8"><style>body{background:#fff;font:14px system-ui;margin:20px}` +
      `h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#777;margin:22px 0 4px}` +
      `h2 span{color:#a11;letter-spacing:0;text-transform:none}svg{display:block;max-width:100%}</style>` +
      blocks.join(""),
  );
  console.log(`${faces.length} face(s) written`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
