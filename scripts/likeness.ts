/**
 * Which of eight proportions the drawn face reached, measure by measure.
 *
 * What this is not: evidence that the face looks like the reference. It reads
 * eight numbers off the drawn ink and compares them with eight read off a
 * reference, and eight numbers are a size and a lean and a weight -- never a
 * letterform. A run where every row is green means the face sets to the same
 * rhythm on the same lines in this engine's own letterforms, which is the whole
 * of what the dial does. The report says so itself, in the same block of text
 * as the green rows, because a green report read on its own is how the dial
 * came to be mistaken for a replica in the first place.
 *
 * The dial in `forge/likeness.ts` says where to go. This says where you got to,
 * which is a different question and the only one worth asking after a setting
 * changes: a number written into a face is an intention, and what the engine
 * actually draws from it is a fact. The two came apart three times while these
 * settings were being fitted, and every time it was the intention that was
 * wrong -- an ascender set to 720 draws an `l` that tops out at 748, because
 * the pen standing above the skeleton is part of the letter and the metric is
 * about the skeleton.
 *
 * So every measurement here is taken off the drawn outlines with a ruler, the
 * same way the references were measured, rather than read back out of the style
 * that produced them. A measurement that could be read out of the style would
 * be telling you what you already typed.
 *
 *   npx vite-node scripts/likeness.ts
 *   LIKENESS=flowing npx vite-node scripts/likeness.ts
 *   LIKENESS=all npx vite-node scripts/likeness.ts
 *
 * The target column is the reference measured on this same ruler, taken once
 * and written into `forge/likeness.ts` so it can be read without the file to
 * hand. What is compared is therefore two measurements, not a measurement
 * against somebody's intention.
 */

import { ready } from "@/font/boolean";
import { contoursBounds, inkRunsAt } from "@/font/geometry";
import type { Drawn } from "@/forge/build";
import { draw, startFrom } from "@/forge/document";
import { dialledTo, dialWidth, LIKENESSES, type Measurements } from "@/forge/likeness";
import { ROUNDHAND, type Style } from "@/forge/style";

await ready();

/*
 * The letters each measurement is taken from, and why each list is what it is.
 *
 * `FLAT` is the set with a square top and a square foot: no round overshoot, no
 * pointed apex, nothing but the line at either end. It carries both the
 * x-height and the bounce, and it has to, because both are questions about
 * where a letter's edge sits against a line. Measured over the round letters as
 * well, the x-height comes out inflated by the overshoot and the bounce comes
 * out as the overshoot -- which is how a first pass read a dead-level reference
 * face as bouncing by a twelfth of its x-height.
 *
 * `LINE` is the wider set that sits between baseline and x-height, used for the
 * overlap, where round and pointed letters are as much a part of the rhythm as
 * square ones.
 */
const FLAT = ["n", "m", "u", "r", "i"];
const LINE = ["a", "c", "e", "m", "n", "o", "r", "s", "u", "v", "w", "x"];
const ASCENDING = ["l", "b", "d", "h", "k"];
const DESCENDING = ["g", "p", "q", "y"];
const CAPITALS = ["H", "E", "I", "T"];

/** Every letter this needs, drawn once, kept by name. */
function drawnAlphabet(style: Style): Map<string, Drawn> {
  const forge = startFrom(style);
  const out = new Map<string, Drawn>();
  for (const name of [
    ...new Set([...FLAT, ...LINE, ...ASCENDING, ...DESCENDING, ...CAPITALS, "l"]),
  ]) {
    const drawn = draw(name, forge);
    if (drawn) out.set(name, drawn);
  }
  return out;
}

/** The middle of a sorted list, which is what every spread here reports. */
function median(values: number[]): number {
  const sorted = [...values].sort((one, other) => one - other);
  return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
}

/**
 * The stem of the `l`, and the two things it is asked for.
 *
 * Measured with the join turned off, which is the one place this file departs
 * from measuring what the face actually draws -- so here is the argument for
 * it. A horizontal ruler laid across a joined `l` cuts the lead-in and the
 * lead-out as well as the stem, and at the heights where a stem is worth
 * measuring those two are most of what it finds: on the Roundhand the ruler
 * reported a stroke of sixteen units against a pen of seventy-four, because it
 * was measuring the join climbing past rather than the stem standing still.
 *
 * Turning the join off removes the lead-in and the lead-out and changes nothing
 * else -- not the pen, not the skeleton, not the slant, which is a shear taken
 * on the finished outline. So the stem measured here is the same stem, with the
 * two strokes that were confusing the ruler taken out of its way. Checked
 * against the arithmetic: the sans measures its own pen exactly, and the
 * Roundhand with no contrast measures seventy-four against a pen of
 * seventy-four.
 *
 * The reference faces need no such help. Their joins leave from low and their
 * `l` is a clean upright where the ruler crosses it, which is why the same two
 * cuts work on them unaltered.
 */
function stemOf(style: Style, xHeight: number): { slant: number; stroke: number } {
  const apart: Style = {
    ...style,
    parts: { ...style.parts, script: { ...style.parts.script, on: false } },
  };
  const ell = draw("l", startFrom(apart));
  if (!ell || ell.contours.length === 0) {
    return { slant: style.metrics.slant, stroke: style.pen.weight / xHeight };
  }
  const cut = (fraction: number) => inkRunsAt(ell.contours, xHeight * fraction, "y");
  const middle = (run: [number, number]) => (run[0] + run[1]) / 2;

  /*
   * The lean, between a quarter and six sevenths of the way up.
   *
   * Two rulers far enough apart that the difference between them is the lean
   * rather than the arithmetic, and both inside the x-height where the stem is
   * a stem rather than a loop.
   */
  const low = cut(0.25);
  const high = cut(0.85);
  const slant =
    low.length > 0 && high.length > 0
      ? (Math.atan2(middle(high[0]) - middle(low[0]), xHeight * 0.6) * 180) / Math.PI
      : style.metrics.slant;

  /*
   * The stroke, narrowed back to square.
   *
   * A horizontal ruler across a stem that leans cuts a run wider than the
   * stroke by one over the cosine of the lean. At sixteen degrees that is four
   * percent, which is small and is also most of the difference between the two
   * faces being compared, so it is taken out rather than waved at.
   */
  const widths: number[] = [];
  for (const fraction of [0.45, 0.55, 0.65, 0.75]) {
    for (const run of cut(fraction)) widths.push(run[1] - run[0]);
  }
  const across = widths.length > 0 ? median(widths) : style.pen.weight;
  return { slant, stroke: (across * Math.cos((slant * Math.PI) / 180)) / xHeight };
}

/**
 * The face on the ruler.
 *
 * Every figure is taken off the ink. The metrics are where the letters actually
 * reach rather than where the style said they would, which is the point: a face
 * that declares an ascender of 720 draws an `l` that tops out somewhere else,
 * because the pen standing above the skeleton is part of the letter and the
 * metric is about the skeleton.
 */
function measure(style: Style): Measurements {
  const em = style.metrics.unitsPerEm;
  const alphabet = drawnAlphabet(style);
  const bounds = (name: string) => {
    const drawn = alphabet.get(name);
    return drawn && drawn.contours.length > 0 ? contoursBounds(drawn.contours) : null;
  };
  const boxes = (names: string[]) => names.map(bounds).filter((one) => one !== null);

  const flat = boxes(FLAT);
  const xHeight = flat.length > 0 ? median(flat.map((one) => one.yMax)) : style.metrics.xHeight;

  const tops = boxes(ASCENDING);
  const feet = boxes(DESCENDING);
  const caps = boxes(CAPITALS);

  const { slant, stroke } = stemOf(style, xHeight);

  const sits = flat.map((one) => one.yMin);
  const bounce = sits.length > 0 ? (Math.max(...sits) - Math.min(...sits)) / xHeight : 0;

  /*
   * How far the ink runs past the room the letter is given.
   *
   * The measurement that says whether a face joins at all, and it compares two
   * things the letter already carries rather than looking at its shape: how
   * wide the ink is, against the advance it was given. Where the letters stand
   * apart the ink is narrower than the advance and this is negative; where they
   * join, the stroke that leaves one letter is the stroke that arrives at the
   * next and both letters count it.
   */
  const overlaps: number[] = [];
  for (const name of LINE) {
    const drawn = alphabet.get(name);
    if (!drawn || drawn.contours.length === 0) continue;
    const box = contoursBounds(drawn.contours);
    overlaps.push(box.xMax - box.xMin - drawn.advanceWidth);
  }

  return {
    xHeight: xHeight / em,
    capHeight: caps.length > 0 ? Math.max(...caps.map((one) => one.yMax)) / em : 0,
    ascender: tops.length > 0 ? Math.max(...tops.map((one) => one.yMax)) / em : 0,
    descender: feet.length > 0 ? Math.min(...feet.map((one) => one.yMin)) / em : 0,
    slant,
    stroke,
    bounce,
    overlap: overlaps.length > 0 ? median(overlaps) / xHeight : 0,
  };
}

/** How a difference reads: the figure, and how far off it is. */
const ROWS: Array<[keyof Measurements, string, number]> = [
  ["xHeight", "x-height / em", 3],
  ["capHeight", "cap height / em", 3],
  ["ascender", "ascender / em", 3],
  ["descender", "descender / em", 3],
  ["slant", "slant (deg)", 1],
  ["stroke", "stroke / x-height", 3],
  ["bounce", "bounce / x-height", 3],
  ["overlap", "join past ink / x-h", 3],
];

/*
 * What counts as arrived.
 *
 * Loose on purpose, and the looseness is the honest part of this file. These
 * are proportions a reader perceives, not a checksum: a face whose x-height is
 * within a hundredth of the em of another reads as the same size of lowercase,
 * and one within a degree reads as the same lean. Tightening these would not
 * make the face closer, it would make the report redder about differences
 * nobody can see.
 */
const CLOSE: Record<keyof Measurements, number> = {
  xHeight: 0.01,
  capHeight: 0.015,
  ascender: 0.02,
  descender: 0.02,
  slant: 1.5,
  stroke: 0.02,
  bounce: 0.02,
  overlap: 0.04,
};

/*
 * Nothing here is excused any more, and this note is what that cost.
 *
 * The overlap used to be printed and not counted, with an argument attached:
 * a reference face lets its letters overhang their advances and join where the
 * ink of one runs over the next, while this engine ended the lead-out precisely
 * on the advance and cut it square, so the two halves met by arithmetic with
 * nothing to fuse. Driven across the whole range of the reach and the balance
 * the overlap did not shift by a unit, and a measure no setting can move is a
 * design decision rather than a failure to arrive.
 *
 * That was true when it was written and the join has since been rebuilt. `knit`
 * carries each half on past the seam so the two cross rather than touch --
 * because meeting at a point is meeting over no area, and a word came out
 * reading as letters pushed together. It moves this measure directly, which
 * means the argument for not counting it is gone.
 *
 * So it is counted. The lesson worth keeping is not about joins: an excuse
 * written into a harness outlives the thing it was excusing, and goes on
 * excusing after the reason has been fixed.
 */
const STRUCTURAL = new Set<keyof Measurements>();

function report(label: string, drawn: Measurements, target: Measurements): number {
  console.log(`\n  ${label}`);
  console.log(
    `  ${"".padEnd(21)}${"drawn".padStart(9)}${"target".padStart(9)}${"off by".padStart(9)}`,
  );
  let missed = 0;
  for (const [key, name, places] of ROWS) {
    const got = drawn[key];
    const want = target[key];
    const off = got - want;
    const near = Math.abs(off) <= CLOSE[key];
    if (!near && !STRUCTURAL.has(key)) missed++;
    console.log(
      `  ${name.padEnd(21)}${got.toFixed(places).padStart(9)}${want.toFixed(places).padStart(9)}` +
        `${(off >= 0 ? "+" : "") + off.toFixed(places)}`.padStart(9) +
        (STRUCTURAL.has(key) ? "   (by construction)" : near ? "" : "   <-- off"),
    );
  }
  return missed;
}

const only = (process.env.LIKENESS ?? "all").trim();
const wanted = only === "all" ? LIKENESSES : LIKENESSES.filter((one) => one.id === only);
if (wanted.length === 0) {
  console.log(
    `no likeness called ${only}; there is ${LIKENESSES.map((one) => one.id).join(", ")}, or all`,
  );
  process.exit(1);
}

console.log("The Roundhand, drawn and measured against the proportions it is aimed at.");
console.log("Every figure below is taken off the drawn outlines with a ruler.");
console.log("");
console.log("  These eight numbers are proportions. They are not letterforms, and nothing");
console.log("  in this report is evidence about letterforms. A face that passes every row");
console.log("  below sits on the same lines and sets to the same rhythm as the reference,");
console.log("  in this engine's own letterforms -- which is what the dial is for and the");
console.log("  whole of what it does. For the letterforms themselves see src/quill, which");
console.log("  recovers strokes from the outlines rather than aiming at measurements.");

/*
 * The base first, undialled.
 *
 * Not compared against anything -- it is not aimed at either reference, it sits
 * between them -- but printed because it is the thing being moved, and a report
 * that showed only the destinations would not say how far either journey is.
 */
const base = measure(ROUNDHAND);
console.log(`\n  Roundhand, as it starts`);
for (const [key, name, places] of ROWS) {
  console.log(`  ${name.padEnd(21)}${base[key].toFixed(places).padStart(9)}`);
}

let missed = 0;
for (const likeness of wanted) {
  const drawn = measure(dialledTo(likeness));
  missed += report(`${likeness.label}  (${likeness.source})`, drawn, likeness.measured);
  /*
   * What the dial spends against what the reference spends, printed under every
   * face rather than once at the end.
   *
   * Under the eight rows on purpose. Eight green rows read as "arrived", and
   * the row that stops them reading that way has to be in the same block of
   * text or it will not be read at all -- which is exactly what happened when
   * this report ended on "every measure is inside its tolerance" and nothing
   * else. Both halves are counted rather than asserted: the dial from its own
   * settings, the reference off its own outlines.
   */
  const width = dialWidth(likeness.settings);
  console.log(
    `\n  Reached with ${width} numbers. The reference spends ${likeness.spends.toLocaleString()} ` +
      `on the same 52 letters,\n  so what is matched above is the proportion and not the drawing.`,
  );
}

console.log(
  missed === 0
    ? "\n  Every proportion is inside its tolerance. The letterforms are this engine's" +
        "\n  own and are not compared here, because no setting moves them toward" +
        "\n  anybody else's. These settings are finished; there is nothing to tune.\n"
    : `\n  ${missed} ${missed === 1 ? "proportion is" : "proportions are"} outside tolerance. ` +
        "The settings in forge/likeness.ts are what to move.\n",
);
