/**
 * Our letter laid over the reference's, one cell per letter.
 *
 * `beside.ts` puts a word of ours under a word of the reference's, which shows
 * that a face is wrong. This shows *where*: the reference filled pale and ours
 * drawn on top as an outline, both at the same x-height and both standing on
 * the same line, so a stem that should bow and does not, or a terminal that
 * should taper and comes to a point, is the gap between the two.
 *
 * The reference is Dancing Script (Pablo Impallari, SIL OFL 1.1), fetched from
 * npm as in the note on `beside.ts`. Telma's licence does not permit this, so
 * nothing is ever taken from that file.
 *
 *   REF=package/files/dancing-script-latin-400-normal.woff \
 *     npx vite-node scripts/over.ts out.svg "Handwriting" hnaodgvesl
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ready } from "@/font/boolean";
import { contoursToSvgPath, contoursBounds } from "@/font/geometry";
import { importFont } from "@/font/parse";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";
import type { Glyph } from "@/font/types";

await ready();

const OUT = process.argv[2] ?? "over.svg";
const FACE = process.argv[3] ?? "Handwriting";
const LETTERS = [...(process.argv[4] ?? "hnaodgvesl")];
const REF = process.env.REF;
if (!REF) throw new Error("Set REF to the reference font file. See the note at the top.");

const style = BASES.find((one) => one.name === FACE);
if (!style) throw new Error(`No face called ${FACE}.`);

const { typeface } = await importFont(readFileSync(REF));
const refGlyph = (letter: string): Glyph | undefined =>
  typeface.glyphs.find((one) => one.unicodes.includes(letter.codePointAt(0) ?? -1));

const refX = contoursBounds(refGlyph("x")!.contours).yMax;

/** A cell is four x-heights tall, which is what the reference spans. */
const X_ON_PAGE = 150;
const CELL_W = X_ON_PAGE * 2.6;
const CELL_H = X_ON_PAGE * 4.0;
const COLS = 5;

const cells: string[] = [];
LETTERS.forEach((letter, i) => {
  const col = i % COLS;
  const rowAt = Math.floor(i / COLS);
  const left = 40 + col * CELL_W;
  const top = 60 + rowAt * CELL_H;
  const line = top + X_ON_PAGE * 2.6;

  const theirs = refGlyph(letter);
  const ours = drawLetter(letter, style, style.forms?.[letter]);

  const parts = [
    `<line x1="${left}" y1="${line}" x2="${left + CELL_W - 20}" y2="${line}"` +
    ` stroke="#ded7c9" stroke-width="1"/>`,
    // The waist, because half the faults are a curve turning at the wrong height.
    `<line x1="${left}" y1="${line - X_ON_PAGE}" x2="${left + CELL_W - 20}" y2="${line - X_ON_PAGE}"` +
    ` stroke="#ece6d8" stroke-width="1"/>`,
    `<text x="${left}" y="${top + 14}" font-family="ui-sans-serif,system-ui" font-size="12"` +
    ` fill="#a09a8c">${letter}</text>`,
  ];

  if (theirs) {
    parts.push(
      `<g transform="translate(${left + 20} ${line}) scale(${X_ON_PAGE / refX} ${-X_ON_PAGE / refX})"` +
      ` fill="#cfc7b6"><path d="${contoursToSvgPath(theirs.contours)}"/></g>`,
    );
  }
  if (ours) {
    const scale = X_ON_PAGE / style.metrics.xHeight;
    parts.push(
      `<g transform="translate(${left + 20} ${line}) scale(${scale} ${-scale})"` +
      ` fill="none" stroke="#1b1917" stroke-width="${6 / scale}">` +
      `<path d="${contoursToSvgPath(ours.contours)}"/></g>`,
    );
  }
  cells.push(parts.join(""));
});

const rows = Math.ceil(LETTERS.length / COLS);
const width = 80 + COLS * CELL_W;
const height = 100 + rows * CELL_H;
writeFileSync(
  OUT,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}"` +
  ` viewBox="0 0 ${Math.round(width)} ${Math.round(height)}">` +
  `<rect width="100%" height="100%" fill="#faf8f3"/>` +
  `<text x="40" y="34" font-family="ui-sans-serif,system-ui" font-size="14" fill="#8a8578">` +
  `${style.name} (outline) over Dancing Script (solid)</text>${cells.join("\n")}</svg>`,
);
console.log(`${OUT} written`);
