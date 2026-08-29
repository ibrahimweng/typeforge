/**
 * The line between two letters, drawn big with the seam marked.
 *
 * `seam.ts` says where the reference's ink stands on the origin and on the
 * advance; this shows what shape it is when it gets there. A word is drawn at
 * four times the usual size with a rule down every advance and a rule across
 * the height the hand hands over at, so the join between each pair is a shape
 * with two marks on it rather than a pair of numbers.
 *
 * The reference is Dancing Script (Pablo Impallari, SIL OFL 1.1), fetched from
 * npm as in the note on `beside.ts`.
 *
 *   REF=package/files/dancing-script-latin-400-normal.woff \
 *     npx vite-node scripts/scallop.ts out.svg onnoae
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ready } from "@/font/boolean";
import { contoursToSvgPath, contoursBounds } from "@/font/geometry";
import { importFont } from "@/font/parse";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";
import type { Contour } from "@/font/types";

await ready();

const OUT = process.argv[2] ?? "scallop.svg";
const WORD = [...(process.argv[3] ?? "onnoae")];
const SEAM = Number(process.env.SEAM ?? 0.32);
const REF = process.env.REF;
if (!REF) throw new Error("Set REF to the reference font file. See the note at the top.");

const { typeface } = await importFont(readFileSync(REF));
const refGlyph = (letter: string) =>
  typeface.glyphs.find((one) => one.unicodes.includes(letter.codePointAt(0) ?? -1));
const refX = contoursBounds(refGlyph("x")!.contours).yMax;

const X_ON_PAGE = 260;
const rows: string[] = [];
let top = 40;

function row(name: string, glyphs: Array<{ contours: Contour[]; advanceWidth: number }>, x: number) {
  const scale = X_ON_PAGE / x;
  const line = top + X_ON_PAGE * 2.2;
  const parts = [
    `<text x="40" y="${top + 16}" font-family="ui-sans-serif,system-ui" font-size="15" fill="#8a8578">${name}</text>`,
    `<line x1="30" y1="${line}" x2="4000" y2="${line}" stroke="#d8d0be" stroke-width="1.5"/>`,
    `<line x1="30" y1="${line - X_ON_PAGE}" x2="4000" y2="${line - X_ON_PAGE}" stroke="#e8e2d2" stroke-width="1.5"/>`,
    // The height the hand is at when it crosses from one letter to the next.
    `<line x1="30" y1="${line - X_ON_PAGE * SEAM}" x2="4000" y2="${line - X_ON_PAGE * SEAM}"` +
    ` stroke="#c9a227" stroke-width="1" stroke-dasharray="6 5"/>`,
  ];
  let pen = 60;
  for (const glyph of glyphs) {
    parts.push(
      `<line x1="${pen}" y1="${line - X_ON_PAGE * 1.5}" x2="${pen}" y2="${line + X_ON_PAGE * 0.7}"` +
      ` stroke="#b9c7d8" stroke-width="1"/>`,
      `<g transform="translate(${pen} ${line}) scale(${scale} ${-scale})" fill="#1b1917">` +
      `<path d="${contoursToSvgPath(glyph.contours)}"/></g>`,
    );
    pen += glyph.advanceWidth * scale;
  }
  parts.push(`<line x1="${pen}" y1="${line - X_ON_PAGE * 1.5}" x2="${pen}" y2="${line + X_ON_PAGE * 0.7}"` +
    ` stroke="#b9c7d8" stroke-width="1"/>`);
  rows.push(parts.join(""));
  top = line + X_ON_PAGE * 1.1;
  return pen;
}

let wide = 0;
wide = Math.max(wide, row("Dancing Script -- the reference",
  WORD.map((one) => refGlyph(one)!), refX));
for (const style of BASES.filter((one) => one.parts.script?.on)) {
  const drawn = WORD.map((one) => drawLetter(one, style, style.forms?.[one])!).filter(Boolean);
  wide = Math.max(wide, row(style.name, drawn, style.metrics.xHeight));
}

writeFileSync(OUT,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(wide + 60)}" height="${Math.round(top)}"` +
  ` viewBox="0 0 ${Math.round(wide + 60)} ${Math.round(top)}">` +
  `<rect width="100%" height="100%" fill="#faf8f3"/>${rows.join("\n")}</svg>`);
console.log(`${OUT} written  ${Math.round(wide + 60)}x${Math.round(top)}`);
