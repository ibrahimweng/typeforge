/**
 * The joined faces set as words, so they can be looked at rather than measured.
 *
 * Every other instrument here answers with a number: `against.ts` for the face,
 * `letter.ts` for the letter, `scan.ts` for the run of ink at a height. None of
 * them shows a line of type, and some faults only exist as one -- a join that
 * measures right and reads wrong, or a line that is the correct colour and the
 * wrong texture, which is what sent the pens from monoline to pointed.
 *
 * Writes an SVG; rasterise it with the Chromium that is already here:
 *
 *   npx vite-node scripts/specimen.ts out.svg
 *   /opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless --disable-gpu \
 *     --no-sandbox --screenshot=out.png --window-size=1320,2400 out.svg
 */
import { writeFileSync } from "node:fs";
import { ready } from "@/font/boolean";
import { contoursToSvgPath } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";

await ready();

const OUT = process.argv[2] ?? "specimen.svg";
const WORDS = (process.argv[3] ?? "handgloves,typeforge,abcdefghijklm,nopqrstuvwxyz").split(",");
/** Enough to read the joins at, on a page a screen wide. Raise it to look at one. */
const SCALE = Number(process.env.SCALE ?? 0.11);
const LINE = 150 * (SCALE / 0.11);
const EDGE = 60;
const WIDE = Number(process.env.WIDE ?? 1320);

const rows: string[] = [];
let down = EDGE;
for (const style of BASES.filter((one) => one.parts.script?.on)) {
  const { unitsPerEm } = style.metrics;
  rows.push(
    `<text x="${EDGE}" y="${down - 14}" font-family="ui-sans-serif,system-ui" font-size="13"` +
    ` fill="#8a8578">${style.name}</text>`,
  );
  for (const word of WORDS) {
    let along = 0;
    const glyphs: string[] = [];
    for (const letter of word) {
      const drawn = drawLetter(letter, style, style.forms?.[letter]);
      if (!drawn) continue;
      glyphs.push(`<path d="${contoursToSvgPath(drawn.contours)}" transform="translate(${along} 0)"/>`);
      along += drawn.advanceWidth;
    }
    // The baseline the letters stand on, drawn, because a script that wanders
    // off its line is the one thing these faces promise not to do.
    const line = down + unitsPerEm * SCALE * 0.78;
    rows.push(
      `<g transform="translate(${EDGE} ${line}) scale(${SCALE} ${-SCALE})" fill="#1b1917">` +
      `${glyphs.join("")}</g>`,
      `<line x1="${EDGE}" y1="${line}" x2="${WIDE - EDGE}" y2="${line}" stroke="#d9d2c4" stroke-width="1"/>`,
    );
    down += LINE;
  }
  down += 40;
}

writeFileSync(
  OUT,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDE}" height="${down + EDGE}"` +
  ` viewBox="0 0 ${WIDE} ${down + EDGE}"><rect width="100%" height="100%" fill="#faf8f3"/>` +
  `${rows.join("\n")}</svg>`,
);
console.log(`${OUT} written`);
