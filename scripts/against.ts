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
 * `line`  How much line the word is, in x-heights: half the outline's length,
 *         which is the stroke's own length whatever width it is drawn at. The
 *         one figure here that the pen cannot reach, and the one that says what
 *         `colour` is made of -- colour is this times the stroke's width over
 *         the room the word takes, and two faces can miss it from either side.
 *
 * `wide`  The mean stroke width, as the ink over that length. Measured, not the
 *         pen's setting.
 *
 *         This column used to be `pen/x`, which was `pen.weight / xHeight` --
 *         a number typed into the face, not one read off it. With a contrast of
 *         0.78 most of the pen's own width never reaches the page, so it read
 *         0.235 where the drawn stroke measures 0.118, and it was taken as
 *         evidence that these faces were a quarter too heavy. They are not:
 *         every one of them draws a *thinner* stroke than the reference, and
 *         the colour is high because the line is long. Measured square to its
 *         lean the reference's `n` stem is 0.212 of an x-height and the four
 *         here are 0.147, 0.169, 0.154 and 0.126.
 *
 *         Both figures are read against the x-height the `x` actually reaches,
 *         which is what the eye judges a face by and is not always the one the
 *         face declares: the reference's `x` sits exactly on its 332, and these
 *         four stop about a twentieth short of theirs. Taking the declared
 *         number for ours and the drawn one for the reference makes the line
 *         look 14 per cent long where it is 20.
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
import { ready, unite } from "@/font/boolean";
import { contourArea, contoursBounds } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";

await ready();

/** Measured from the released Dancing Script's ink, at its default weight. */
const REFERENCE = {
  name: "Dancing Script",
  xOverEm: 0.332,
  ascOverX: 2.17,
  descOverX: 0.84,
  line: 44.7,
  wide: 0.126,
  left: 0.07,
  right: 0.09,
};

/** The letters whose tops and tails set the extenders, on any face. */
const RISERS = ["l", "b", "d", "h", "k"];
const FALLERS = ["p", "q", "g", "y", "j"];

const SAMPLE = ["n", "o", "a", "e", "m"];

/** The reference's advance over its x-height, letter by letter, from its ink. */
const FIT: Record<string, number> = {
  n: 1.4,
  m: 1.95,
  o: 1.1,
  e: 1.0,
  a: 1.31,
  c: 0.97,
  u: 1.32,
  r: 1.05,
  s: 1.04,
  t: 0.86,
};
const FIT_MEAN = Object.values(FIT).reduce((sum, one) => sum + one, 0) / Object.keys(FIT).length;

/**
 * The word the colour is read off, and the reference's reading of it.
 *
 * Colour is ink over the area of the line it sits on, which is what an eye
 * judges and what neither the pen's weight nor its contrast can be read off
 * alone: this face's Formal Script carries the heaviest pen of the four and
 * lands within one per cent of the reference, because a contrast of 0.78 makes
 * most of its strokes hairlines.
 *
 * Signed areas, so a counter comes off the ink instead of on. Summed with the
 * absolute area of every contour instead, doubling a pen moved the answer four
 * per cent -- the outer grew and the counter shrank and the two cancelled.
 */
const COLOUR_WORD = "handgloves".split("");
const COLOUR_REF = 0.476;
/**
 * Half an outline's length, which is the length of the stroke that made it: a
 * stroke of length L and width w has a perimeter of about 2L + 2w, and w is
 * small beside L. Sampled on the curves, since a cubic has no closed form.
 */
function halfway(contours: Contour[]): number {
  let sum = 0;
  for (const contour of contours) {
    const nodes = contour.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const from = nodes[i].point;
      const to = nodes[(i + 1) % nodes.length].point;
      const out = nodes[i].handleOut;
      const back = nodes[(i + 1) % nodes.length].handleIn;
      if (!out && !back) {
        sum += Math.hypot(to.x - from.x, to.y - from.y);
        continue;
      }
      const one = out ?? from;
      const two = back ?? to;
      let last = from;
      for (let step = 1; step <= 16; step++) {
        const t = step / 16;
        const u = 1 - t;
        const at = {
          x: u * u * u * from.x + 3 * u * u * t * one.x + 3 * u * t * t * two.x + t * t * t * to.x,
          y: u * u * u * from.y + 3 * u * u * t * one.y + 3 * u * t * t * two.y + t * t * t * to.y,
        };
        sum += Math.hypot(at.x - last.x, at.y - last.y);
        last = at;
      }
    }
  }
  return sum / 2;
}

const row = (
  name: string,
  x: number,
  asc: number,
  desc: number,
  line: number,
  wide: number,
  left: number,
  right: number,
  fit: number,
  colour: number,
) =>
  `${name.padEnd(16)} ${x.toFixed(3)}  ${asc.toFixed(2)}   ${desc.toFixed(2)}   ${line.toFixed(1).padStart(5)}  ${wide.toFixed(3)}` +
  `   ${left >= 0 ? " " : ""}${left.toFixed(2)} / ${right >= 0 ? " " : ""}${right.toFixed(2)}   ${(left + right).toFixed(2)}` +
  `      ${fit.toFixed(2)} (${(fit / FIT_MEAN).toFixed(2)}x)` +
  `   ${colour.toFixed(3)} (${(colour / COLOUR_REF).toFixed(2)}x)`;

console.log(
  "face             x/em   asc/x  desc/x    line    wide    over left/right   pair overlap   adv/x          colour",
);
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
  let ink = 0;
  let along = 0;
  for (const letter of COLOUR_WORD) {
    const drawn = drawLetter(letter, style, style.forms?.[letter]);
    if (!drawn) continue;
    for (const contour of unite(drawn.contours, "winding")) ink += contourArea(contour);
    along += drawn.advanceWidth;
  }
  const colour = Math.abs(ink) / (along * xHeight);
  let line = 0;
  for (const letter of COLOUR_WORD) {
    const drawn = drawLetter(letter, style, style.forms?.[letter]);
    if (drawn) line += halfway(drawn.contours);
  }
  const fit =
    Object.keys(FIT)
      .map((one) => drawLetter(one, style, style.forms?.[one])!.advanceWidth / xHeight)
      .reduce((sum, one) => sum + one, 0) / Object.keys(FIT).length;
  console.log(
    row(
      style.name,
      xHeight / unitsPerEm,
      ascender / xHeight,
      Math.abs(descender) / xHeight,
      line / xHeight,
      Math.abs(ink) / (line * xHeight),
      mean((one) => one.left),
      mean((one) => one.right),
      fit,
      colour,
    ),
  );
}
console.log(
  row(
    REFERENCE.name,
    REFERENCE.xOverEm,
    REFERENCE.ascOverX,
    REFERENCE.descOverX,
    REFERENCE.line,
    REFERENCE.wide,
    REFERENCE.left,
    REFERENCE.right,
    FIT_MEAN,
    COLOUR_REF,
  ),
);
