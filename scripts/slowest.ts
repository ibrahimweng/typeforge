/**
 * Which letters cost the most to cast on, and how much.
 *
 * The draw page spreads its work across frames now, so what is left to feel is
 * not the total but the single worst piece of it: a letter that takes half a
 * second is half a second of a window that cannot be clicked, and no amount of
 * scheduling around it helps, because the work is only ever put down between
 * whole letters. This says which letters those are, and how far off that is.
 *
 * It also counts what it costs to hand those letters to the browser, which is
 * worth knowing precisely because it sounds expensive and is not: a cast fuses
 * a shape with copies of itself, but the result is tidied, so the outlines come
 * back about the size they went in and the path strings are a rounding error
 * against the drawing.
 *
 *   npx vite-node scripts/slowest.ts extrude 3.6
 *   npx vite-node scripts/slowest.ts outline 0.4
 *   npx vite-node scripts/slowest.ts weld 0.6
 *
 * What it says at the time of writing, on the Sans: a shadow is even -- about
 * thirty-six milliseconds a letter with nothing much worse than a hundred and
 * seventy -- and a fillet is not. A fillet is six milliseconds a letter on
 * average and three hundred and forty on `asterisk`, on the Cyrillic `ж` and on
 * its capital, which are the three letters here with the most strokes running
 * into one place. They are the longest single stretch of stillness the draw
 * page has left, and the place to look first if it ever needs to be shorter.
 */
import { ready } from "@/font/boolean";
import { contoursToSvgPath } from "@/font/geometry";
import { letterNames } from "@/forge/build";
import { noCast, type Cast, type CastName } from "@/forge/cast";
import { draw, startFrom } from "@/forge/document";
import { BASES } from "@/forge/style";

await ready();

const which = (process.argv[2] ?? "extrude") as CastName;
const amount = Number(process.argv[3] ?? 1.5);

const cast: Cast = noCast();
cast[which].on = true;
if (which === "extrude") cast.extrude.distance = amount;
if (which === "outline") cast.outline.width = amount;
if (which === "weld") cast.weld.size = amount;
if (which === "spur") cast.spur.size = amount;

const base = BASES.find((one) => one.name === (process.env.BASE ?? "Sans"))!;
const forge = { ...startFrom(base), cast };

const timed: Array<{ letter: string; ms: number }> = [];
for (const letter of letterNames()) {
  const at = performance.now();
  draw(letter, forge);
  timed.push({ letter, ms: performance.now() - at });
}
timed.sort((one, other) => other.ms - one.ms);
const total = timed.reduce((sum, one) => sum + one.ms, 0);
console.log(`${which} ${amount} on ${base.name}: ${timed.length} letters, ${Math.round(total)}ms total, ${Math.round(total / timed.length)}ms each`);
for (const one of timed.slice(0, 15)) console.log(`  ${one.letter.padEnd(14)} ${Math.round(one.ms)}ms`);

/*
 * And what it costs to hand those letters to the browser.
 *
 * Drawn already, so this is the spelling alone. Kept here because the first
 * guess at why the letter strip stalled was that a cast leaves outlines too
 * big to write out, and the measurement says otherwise -- a hundred and
 * twenty-eight of them, thrown three and a half stems, are sixteen points each
 * and a few milliseconds in total. The drawing is the whole of the bill.
 */
const near = letterNames().slice(0, 128);
let points = 0;
const spelling = performance.now();
for (const letter of near) {
  const drawn = draw(letter, forge);
  if (!drawn) continue;
  for (const contour of drawn.contours) points += contour.nodes.length;
  contoursToSvgPath(drawn.contours);
}
console.log(
  `first ${near.length} letters: ${Math.round(points / near.length)} points each, ` +
    `${Math.round(performance.now() - spelling)}ms to spell out as paths`,
);
