/**
 * The four joining faces held against the references, on the numbers that
 * decide whether a script reads as a written line or as letters in a row.
 *
 * The references are Dancing Script (Pablo Impallari, SIL OFL 1.1) and Telma
 * (Jitka Janečková, Indian Type Foundry, ITF Free Font License). The figures
 * below for Dancing Script were measured from the released font, which its
 * licence allows; Telma's licence does not permit derivative work, so nothing
 * is taken from that file -- it is read as a printed specimen, the way any
 * other type is, and does not appear here.
 *
 * The four columns, and why each is one:
 *
 * `x/em`  How much of the body the x-height takes. A script sets a small
 *         x-height against long extenders, and every one of these faces was
 *         drawn bigger than that -- which is most of what made them read as a
 *         sans on a slant.
 *
 * `asc/x` The ascender against the x-height, which is the same observation
 *         from the other end and the one a reader actually sees.
 *
 *         Read off the ink, not off the vertical metrics, and the difference
 *         matters: Dancing Script's `hhea` ascender is 920, which is 2.77
 *         x-heights and is what this said at first. Its `l` stops at 720. The
 *         other two hundred units are line spacing, and no letter goes there --
 *         so the figure a reader sees is 2.17, and 720 is also exactly where
 *         its `H` stops. Caps and ascenders share a line on that face.
 *
 * `pen/x` The stem against the x-height: the face's colour, in the only unit
 *         that compares across faces of different sizes.
 *
 * `adv/x` The mean advance of ten letters against the x-height -- the face's
 *         fit. Mostly the join's reach, which is added to the advance at both
 *         ends and so is the white between two letters as well as the stroke
 *         that crosses it. The letters with no width of their own show it
 *         first: an `o` and an `e` came out as wide as the `n` where the
 *         reference draws them a fifth narrower.
 *
 * `over`  How far the ink reaches past the origin on the left and past the
 *         advance on the right, as a share of the x-height. This is the one
 *         that was furthest out and the least obvious. A joined letter here
 *         reaches back over its origin and stops *short* of its advance, so a
 *         pair overlaps by whatever is left over -- four hundredths of an
 *         x-height on the Formal Script, which is enough to join and not
 *         enough to look like one stroke. The reference reaches out past
 *         *both*, and its pairs overlap by twenty hundredths: five times as
 *         much, and evenly at each end rather than all at one.
 *
 *   npx vite-node scripts/against.ts
 */
import { ready } from "@/font/boolean";
import { contoursBounds } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";

await ready();

/** Measured from the released Dancing Script's ink, at its default weight. */
const REFERENCE = { name: "Dancing Script", xOverEm: 0.332, ascOverX: 2.17, descOverX: 0.84,
  penOverX: 0.19, left: 0.07, right: 0.09 };

/** The letters whose tops and tails set the extenders, on any face. */
const RISERS = ["l", "b", "d", "h", "k"];
const FALLERS = ["p", "q", "g", "y", "j"];

const SAMPLE = ["n", "o", "a", "e", "m"];

/** The reference's advance over its x-height, letter by letter, from its ink. */
const FIT: Record<string, number> = {
  n: 1.40, m: 1.95, o: 1.10, e: 1.00, a: 1.31, c: 0.97, u: 1.32, r: 1.05, s: 1.04, t: 0.86,
};
const FIT_MEAN = Object.values(FIT).reduce((sum, one) => sum + one, 0) / Object.keys(FIT).length;
const row = (name: string, x: number, asc: number, desc: number, pen: number,
  left: number, right: number, fit: number) =>
  `${name.padEnd(16)} ${x.toFixed(3)}  ${asc.toFixed(2)}   ${desc.toFixed(2)}    ${pen.toFixed(3)}` +
  `   ${left >= 0 ? " " : ""}${left.toFixed(2)} / ${right >= 0 ? " " : ""}${right.toFixed(2)}   ${(left + right).toFixed(2)}` +
  `      ${fit.toFixed(2)} (${(fit / FIT_MEAN).toFixed(2)}x)`;

console.log("face             x/em   asc/x  desc/x  pen/x    over left/right   pair overlap   adv/x");
for (const style of BASES.filter((one) => one.parts.script.on)) {
  const { unitsPerEm } = style.metrics;
  const inkOf = (name: string) => {
    const drawn = drawLetter(name, style, style.forms?.[name]);
    return drawn ? contoursBounds(drawn.contours) : null;
  };
  const xHeight = inkOf("x")!.yMax;
  const ascender = Math.max(...RISERS.map((one) => inkOf(one)!.yMax));
  const descender = Math.min(...FALLERS.map((one) => inkOf(one)!.yMin));
  const reach = SAMPLE.map((name) => {
    const drawn = drawLetter(name, style, style.forms?.[name]);
    if (!drawn) return null;
    const bounds = contoursBounds(drawn.contours);
    return { left: -bounds.xMin / xHeight, right: (bounds.xMax - drawn.advanceWidth) / xHeight };
  }).filter((one): one is { left: number; right: number } => one !== null);
  const mean = (of: (one: { left: number; right: number }) => number) =>
    reach.reduce((sum, one) => sum + of(one), 0) / (reach.length || 1);
  const fit = Object.keys(FIT)
    .map((one) => drawLetter(one, style, style.forms?.[one])!.advanceWidth / xHeight)
    .reduce((sum, one) => sum + one, 0) / Object.keys(FIT).length;
  console.log(row(style.name, xHeight / unitsPerEm, ascender / xHeight, Math.abs(descender) / xHeight,
    style.pen.weight / xHeight, mean((one) => one.left), mean((one) => one.right), fit));
}
console.log(row(REFERENCE.name, REFERENCE.xOverEm, REFERENCE.ascOverX, REFERENCE.descOverX,
  REFERENCE.penOverX, REFERENCE.left, REFERENCE.right, FIT_MEAN));
