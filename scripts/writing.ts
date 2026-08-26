/**
 * A page of a face set as running text, for the faces that join.
 *
 * Measuring says whether the joins close. Only looking says whether they look
 * like handwriting, and a join is one of the few things in this engine that can
 * be arithmetically perfect and still wrong -- two strokes can meet exactly and
 * meet at an angle nobody's hand has ever made.
 *
 * Set at the letters' own advances rather than laid out by hand, so the page is
 * what the font would print.
 *
 *   npx vite-node scripts/writing.ts             every joined face
 *   npx vite-node scripts/writing.ts Handwriting one of them
 *
 * Writes to $OUT, or /tmp/writing.html.
 */
import { writeFileSync } from "node:fs";

import { ready } from "@/font/boolean";
import { contoursToSvgPath } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
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

const LINES = (process.env.LINES ?? "handwriting|minimum|the quick brown fox|abcdefghijklm|nopqrstuvwxyz").split("|");

/** One line set at its own advances, and how wide it came out. */
function setLine(style: Style, line: string): { path: string; width: number } {
  let x = 0;
  const parts: string[] = [];
  for (const letter of line) {
    if (letter === " ") { x += style.metrics.xHeight * 0.7; continue; }
    const drawn = drawLetter(letter, style);
    if (!drawn) continue;
    parts.push(contoursToSvgPath(slid(drawn.contours, x)));
    x += drawn.advanceWidth;
  }
  return { path: parts.join(" "), width: x };
}

async function main() {
  await ready();
  const wanted = process.argv[2];
  const wobbles = (process.env.WOBBLE ?? "").split(",").filter(Boolean).map(Number);
  const loops = (process.env.LOOP ?? "").split(",").filter(Boolean).map(Number);
  const chosen = BASES.filter((one) => (wanted ? one.name === wanted : one.parts.script.on));
  // A face at several settings of one control, side by side down the page,
  // which is the only way to pick a number for something nobody can state.
  const swept = wobbles.length
    ? chosen.flatMap((one) =>
        wobbles.map((amount) => ({
          ...one,
          name: `${one.name} — irregularity ${amount}`,
          parts: { ...one.parts, script: { ...one.parts.script, irregularity: amount } },
        })))
    : chosen;
  const faces = loops.length
    ? swept.flatMap((one) =>
        loops.map((amount) => ({
          ...one,
          name: `${one.name} — loop ${amount}`,
          parts: { ...one.parts, script: { ...one.parts.script, loop: amount } },
        })))
    : swept;
  const blocks: string[] = [];

  for (const style of faces) {
    const { ascender, descender } = style.metrics;
    const step = ascender - descender + 180;
    const set = LINES.map((line) => setLine(style, line));
    const widest = Math.max(...set.map((one) => one.width), 1);
    const rows = set.map(({ path }, index) =>
      `<g transform="translate(0 ${-index * step})">` +
      `<line x1="0" y1="0" x2="${widest}" y2="0" stroke="#e88" stroke-width="3"/>` +
      `<path d="${path}" fill="#111"/></g>`);

    // The whole block, in font units, with the y axis the right way up.
    const top = ascender + 60;
    const bottom = -(set.length - 1) * step + descender - 60;
    blocks.push(
      `<section><h2>${style.name}</h2>` +
      `<svg viewBox="-60 ${-top} ${widest + 160} ${top - bottom}" width="1160">` +
      `<g transform="scale(1 -1)">${rows.join("")}</g></svg></section>`);
  }

  writeFileSync(
    process.env.OUT ?? "/tmp/writing.html",
    `<!doctype html><meta charset="utf-8"><style>body{background:#fff;font:14px system-ui;margin:20px}` +
    `h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#777;margin:22px 0 4px}` +
    `svg{display:block;max-width:100%}</style>${blocks.join("")}`);
  console.log(`${faces.length} face(s) written`);
}

main().catch((error) => { console.error(error); process.exit(1); });
