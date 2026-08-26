/**
 * Do the letters of a joined face actually reach each other?
 *
 * The claim the whole of `script.ts` rests on is that a letter's exit stops
 * exactly on its advance and the next letter's entry starts exactly on its
 * origin, both at the same height and both cut square to the same heading -- so
 * that two letters set side by side make one unbroken stroke.
 *
 * Measured at the seam rather than on the bounding boxes, which was the first
 * way this was written and is useless: a stroke climbing at sixty degrees and
 * cut square has a corner well past the point its spine stops at, so two
 * letters that abut perfectly have boxes that overlap by most of a pen and two
 * that do not touch at all can have boxes that meet. What matters is whether
 * there is ink all the way across the boundary at the height the join is at.
 */
import { ready, unite } from "@/font/boolean";
import { inkRunsAt } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { noEffects } from "@/font/effects";
import { proof, startFrom } from "@/forge/document";
import { BASES, type Style } from "@/forge/style";
import type { Contour } from "@/font/types";

const LOWER = "abcdefghijklmnopqrstuvwxyz".split("");
const PAIRS = ["nn", "no", "on", "ll", "ie", "an", "ou", "st", "he", "mm"];

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

/** The widest stretch of the seam with no ink on it, across the boundary. */
/*
 * Drawn through the tool layer when asked, because the roughening is the one
 * thing here that could open a join without anybody noticing: it pushes every
 * point of the outline off its own line, and two letters that met exactly are
 * two letters whose edges were perturbed by different amounts.
 */
const TEXTURED = process.env.EFFECTS ?? "";

function drawn(letter: string, style: Style) {
  if (!TEXTURED) return drawLetter(letter, style);
  // "own" runs the face through whatever texture it ships with, which is the
  // combination anybody exporting it will actually get.
  if (TEXTURED === "own") return proof(letter, startFrom(style));
  const effects = noEffects();
  for (const name of TEXTURED.split(",")) {
    if (name === "rough") effects.rough.on = true;
    if (name === "pool") effects.pool.on = true;
    if (name === "skip") effects.skip.on = true;
    if (name === "press") effects.press.on = true;
  }
  return proof(letter, { ...startFrom(style), effects });
}

function seamGap(style: Style, pair: string): number | null {
  const first = drawn(pair[0], style);
  const second = drawn(pair[1], style);
  if (!first || !second) return null;
  const seam = style.parts.script.height * style.metrics.xHeight;
  /*
   * Fused before measuring, and this is not a nicety.
   *
   * `inkRunsAt` pairs its crossings in order, which is right for shapes that do
   * not overlap and wrong for two that do: four crossings from a pair of
   * overlapping strokes pair up as two runs with a hole between them, so an
   * overlap of thirty units reads as a gap of thirty. Three letters were
   * reported as not joining on exactly that, and they were joining.
   */
  const both = unite([...first.contours, ...slid(second.contours, first.advanceWidth)], "winding");
  const runs = inkRunsAt(both, seam, "y", 48);
  // Only the runs that bracket the boundary matter: ink to the left of it and
  // ink to the right of it, and whether anything joins them.
  const edge = first.advanceWidth;
  const before = runs.filter((run) => run[1] <= edge + 1e-6);
  const after = runs.filter((run) => run[0] >= edge - 1e-6);
  const spans = runs.some((run) => run[0] < edge && run[1] > edge);
  if (spans) return 0;
  if (before.length === 0 || after.length === 0) return null;
  const left = Math.max(...before.map((run) => run[1]));
  const right = Math.min(...after.map((run) => run[0]));
  return right - left;
}

async function main() {
  await ready();
  const extra = Number(process.env.WOBBLE ?? 0);
  // The invariant has to hold at the far end of every control, not only at the
  // setting a face happens to ship with.
  const faces = BASES.filter((one) => one.parts.script.on).map((one) =>
    extra ? { ...one, parts: { ...one.parts, script: { ...one.parts.script, irregularity: extra } } } : one);
  for (const style of faces) {
    const script = style.parts.script;
    const seam = script.height * style.metrics.xHeight;
    console.log(`\n${style.name}  seam y=${Math.round(seam)}  pen=${style.pen.weight}`);

    /*
     * Every letter has to hand over on both sides, so every letter is set
     * against an `n` both ways round. Fifty-two surfaces, which is all of them.
     *
     * Measured as a pair rather than against the letter's own advance, because
     * a lean moves the ink at the seam sideways -- by seven or eight units at
     * six degrees -- and a letter whose exit looked eight units short of its
     * advance is not short at all: the letter after it starts eight units
     * early by exactly the same lean.
     */
    const broken: string[] = [];
    for (const name of LOWER) {
      for (const pair of [`${name}n`, `n${name}`]) {
        const gap = seamGap(style, pair);
        if (gap === null) broken.push(`${pair}(nothing)`);
        else if (gap > 1) broken.push(`${pair}(${gap.toFixed(0)})`);
      }
    }
    console.log(`  pairs that do not join, of 52: ${broken.length ? broken.join(" ") : "none"}`);

    let worst = 0;
    for (const pair of PAIRS) {
      const gap = seamGap(style, pair);
      const shown = gap === null ? "no ink one side" : gap === 0 ? "joined" : `${gap.toFixed(1)} apart`;
      if (gap !== null && gap > worst) worst = gap;
      console.log(`  ${pair}: ${shown}`);
    }
    console.log(`  widest break: ${worst.toFixed(1)} units`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
