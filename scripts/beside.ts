/**
 * The reference's letters drawn beside ours, at the same x-height.
 *
 * Every other instrument here reduces the reference to a number -- `against.ts`
 * one per face, `letter.ts` one per letter, `scan.ts` a run of ink at a height.
 * All of them agreed the faces were within a tenth of the reference while the
 * page still read as a different typeface, because the thing that was wrong was
 * the shape of the curves and none of those numbers asks about shape.
 *
 * So: put the outlines side by side and look.
 *
 * The reference is Dancing Script (Pablo Impallari, SIL OFL 1.1), which permits
 * this. Telma's licence does not, so nothing is ever taken from that file.
 *
 * The font is not in the repository -- it is fetched from npm, which is the one
 * host reachable from here:
 *
 *   npm pack @fontsource/dancing-script
 *   tar xzf fontsource-dancing-script-*.tgz
 *   REF=package/files/dancing-script-latin-400-normal.woff \
 *     npx vite-node scripts/beside.ts out.svg handgloves
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ready } from "@/font/boolean";
import { contoursToSvgPath, contoursBounds } from "@/font/geometry";
import { importFont } from "@/font/parse";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";
import type { Contour, Glyph } from "@/font/types";

await ready();

const OUT = process.argv[2] ?? "beside.svg";
const WORD = process.argv[3] ?? "handgloves";
const REF = process.env.REF;
if (!REF) throw new Error("Set REF to the reference font file. See the note at the top.");

const { typeface } = await importFont(readFileSync(REF));

/** The reference's glyph for a letter, by its codepoint rather than its name. */
const refGlyph = (letter: string): Glyph | undefined => {
  const code = letter.codePointAt(0);
  return typeface.glyphs.find((one) => one.unicodes.includes(code ?? -1));
};

/**
 * The x-height each face is drawn at, so the two sit at the same size on the
 * page. Comparing at the em would compare the em, and the em is already right.
 */
const refX = (() => {
  const x = refGlyph("x");
  if (!x) throw new Error("The reference has no `x` to measure its x-height by.");
  return contoursBounds(x.contours).yMax;
})();

/** Drawn at a common x-height of this many page units. */
const X_ON_PAGE = 96;

/** One row: a label, then the word, drawn at `scale` and standing on `line`. */
const row = (
  label: string,
  glyphs: Array<{ contours: Contour[]; advanceWidth: number }>,
  scale: number,
  top: number,
): { svg: string[]; height: number } => {
  // The reference stands 2.17 x-heights above its line and 0.84 below, so a row
  // is four of them and a little, or the ascenders land in the row above.
  const HEIGHT = X_ON_PAGE * 3.6;
  const line = top + X_ON_PAGE * 2.5;
  let along = 0;
  const drawn: string[] = [];
  for (const glyph of glyphs) {
    drawn.push(
      `<path d="${contoursToSvgPath(glyph.contours)}" transform="translate(${along} 0)"/>`,
    );
    along += glyph.advanceWidth;
  }
  return {
    svg: [
      `<text x="40" y="${top + 16}" font-family="ui-sans-serif,system-ui" font-size="13"` +
        ` fill="#8a8578">${label}</text>`,
      `<line x1="40" y1="${line}" x2="2360" y2="${line}" stroke="#ded7c9" stroke-width="1"/>`,
      `<g transform="translate(60 ${line}) scale(${scale} ${-scale})" fill="#1b1917">` +
        `${drawn.join("")}</g>`,
    ],
    height: HEIGHT,
  };
};

const rows: string[] = [];
let down = 50;

{
  const glyphs = [...WORD].map(refGlyph).filter((one): one is Glyph => !!one);
  const made = row("Dancing Script -- the reference", glyphs, X_ON_PAGE / refX, down);
  rows.push(...made.svg);
  down += made.height;
}

for (const style of BASES.filter((one) => one.parts.script?.on)) {
  const glyphs = [...WORD]
    .map((letter) => drawLetter(letter, style, style.forms?.[letter]))
    .filter((one): one is NonNullable<typeof one> => !!one);
  const made = row(style.name, glyphs, X_ON_PAGE / style.metrics.xHeight, down);
  rows.push(...made.svg);
  down += made.height;
}

writeFileSync(
  OUT,
  `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="${down + 40}"` +
    ` viewBox="0 0 2400 ${down + 40}"><rect width="100%" height="100%" fill="#faf8f3"/>` +
    `${rows.join("\n")}</svg>`,
);
console.log(`${OUT} written`);
