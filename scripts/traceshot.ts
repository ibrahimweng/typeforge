/**
 * A picture of what the tracer did: the source ink in grey, the redraw over it.
 *
 * Written because the error harness next door cannot see what is wrong, only
 * how much. Every defect worth fixing in the tracer was found by looking at
 * this and none of them by reading the numbers: the loop hanging off the tip of
 * an `s`, the blob where the shoulder of an `n` came out the far side of its
 * stem, the semicircle bulging below the baseline at the foot of an `x`, the
 * seam at the bottom of every `o`. Each of those is a handful of units on a
 * mean and unmistakable in a drawing.
 *
 * The nodes are drawn because their number is half of what "clean" means. An
 * `o` recovered as a hundred and sixty-one nodes redraws the letter beautifully
 * and cannot be edited by anybody.
 *
 *   FONT=/path/to/some.ttf LETTERS=aeon OUT=/tmp/trace.svg npx vite-node scripts/traceshot.ts
 *
 * Point it only at a font you have the right to derive from.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ready, unite } from "@/font/boolean";
import { importFont } from "@/font/parse";
import { contourSegments } from "@/font/geometry";
import { fitGlyph } from "@/quill/fit";
import { sweepAll, toleranceFor } from "@/quill/sweep";
import type { Contour } from "@/font/types";

await ready();
const { typeface } = await importFont(new Uint8Array(readFileSync(process.env.FONT!)), "ref.ttf");
const byChar = new Map<string, (typeof typeface.glyphs)[number]>();
for (const g of typeface.glyphs)
  for (const u of g.unicodes ?? []) byChar.set(String.fromCodePoint(u), g);

const d = (cs: Contour[]) =>
  cs
    .map((c) => {
      const segs = contourSegments(c);
      if (!segs.length) return "";
      let out = `M ${segs[0].from.x} ${segs[0].from.y}`;
      for (const s of segs)
        out +=
          s.kind === "line"
            ? ` L ${s.to.x} ${s.to.y}`
            : ` C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.to.x} ${s.to.y}`;
      return out + " Z";
    })
    .join(" ");

const letters = (process.env.LETTERS ?? "aeonvws").split("");
const upm = typeface.unitsPerEm ?? 1000;
const cell = 1.15 * upm;
let body = "";
letters.forEach((ch, i) => {
  const g = byChar.get(ch);
  if (!g?.contours?.length) return;
  const fit = fitGlyph(ch, g.contours, g.advanceWidth, { unitsPerEm: upm });
  if (!fit) return;
  const out = sweepAll(fit.glyph.strokes, toleranceFor(upm));
  const x = i * cell;
  body += `<g transform="translate(${x},0)">
    <path d="${d(unite(g.contours))}" fill="#cfcfcf"/>
    <path d="${d(unite(out.contours))}" fill="none" stroke="#d0021b" stroke-width="${upm / 220}"/>
    <g fill="#0b62d6">${out.contours
      .flatMap((c) => c.nodes)
      .map((n) => `<circle cx="${n.point.x}" cy="${n.point.y}" r="${upm / 130}"/>`)
      .join("")}</g>
  </g>`;
});
const w = letters.length * cell;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round((w / upm) * 260)}" height="330" viewBox="0 ${-0.28 * upm} ${w} ${1.32 * upm}">
<rect x="0" y="${-0.28 * upm}" width="${w}" height="${1.32 * upm}" fill="#fff"/>
<g transform="translate(0,${0.76 * upm}) scale(1,-1)">${body}</g></svg>`;
writeFileSync(
  process.env.OUT ??
    "/tmp/claude-0/-home-user-typeforge/b2cdad0f-67b3-59e3-9c7b-f7d17fda99dc/scratchpad/trace.svg",
  svg,
);
console.log("wrote", process.env.OUT);
