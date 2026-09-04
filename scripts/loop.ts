/**
 * An alphabet written with a known pen, swept, and read back.
 *
 * The pen reading in `hand.ts` is checked against real fonts by whether its
 * answer is plausible, which is a weak test: nobody knows what pen DejaVu Serif
 * was drawn with, because it was drawn rather than written. This is the strong
 * one. Letters are written here with a pen whose numbers are known exactly,
 * swept to outlines, and handed to the tracer as though they had come out of a
 * file -- so there is a right answer to compare against.
 *
 * It also shows, in the two numbers at the end, why the pen is reported and not
 * used to re-fit the letters. A written stroke's own profile is flat, because
 * the pen does all the modulation; the traced one carries that modulation but
 * out of phase with the heading the traced spine reports, so dividing it out
 * adds variation rather than removing it. `tracing.ts` has the whole account.
 *
 *   npx vite-node scripts/loop.ts
 */
import { ready, unite } from "@/font/boolean";
import { fitGlyph } from "@/quill/fit";
import { handOf } from "@/quill/hand";
import { sweepAll, toleranceFor } from "@/quill/sweep";
import type { QuillSpine, QuillStroke } from "@/quill/types";

await ready();
const upm = 1000;
const BLADE = 0.7;
const ANGLE = 40;

const stroke = (spine: QuillSpine): QuillStroke => ({
  spine,
  width: [{ at: 0, width: 150 }],
  nib: [{ at: 0, contrast: BLADE, angle: ANGLE }],
  start: { kind: "butt" },
  end: { kind: "butt" },
  join: "round",
});
const line = (from: [number, number], to: [number, number]): QuillSpine => ({
  segments: [{ kind: "line", from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] } }],
  closed: false,
});
const bend = (
  from: [number, number],
  c1: [number, number],
  c2: [number, number],
  to: [number, number],
): QuillSpine => ({
  segments: [
    {
      kind: "cubic",
      from: { x: from[0], y: from[1] },
      c1: { x: c1[0], y: c1[1] },
      c2: { x: c2[0], y: c2[1] },
      to: { x: to[0], y: to[1] },
    },
  ],
  closed: false,
});

/* Six letters, running every way, as a written alphabet does. */
const written: Record<string, QuillStroke[]> = {
  l: [stroke(line([160, 0], [160, 700]))],
  v: [stroke(line([120, 700], [320, 60])), stroke(line([320, 60], [520, 700]))],
  n: [
    stroke(line([120, 0], [120, 640])),
    stroke(bend([120, 460], [220, 700], [460, 700], [540, 460])),
    stroke(line([540, 460], [540, 0])),
  ],
  o: [
    stroke(bend([320, 700], [120, 700], [80, 380], [320, 40])),
    stroke(bend([320, 40], [560, 380], [520, 700], [320, 700])),
  ],
  z: [
    stroke(line([120, 640], [520, 640])),
    stroke(line([520, 640], [120, 60])),
    stroke(line([120, 60], [520, 60])),
  ],
  x: [stroke(line([120, 640], [520, 60])), stroke(line([120, 60], [520, 640]))],
};

const traced: Array<{ ch: string; once: QuillStroke[]; contours: any[] }> = [];
for (const [ch, strokes] of Object.entries(written)) {
  const contours = unite(sweepAll(strokes, toleranceFor(upm)).contours);
  const fit = fitGlyph(ch, contours, 640, { unitsPerEm: upm });
  if (!fit) {
    console.log(`  ${ch}: did not trace`);
    continue;
  }
  traced.push({ ch, once: fit.glyph.strokes, contours });
}

const found = handOf(traced.flatMap((one) => one.once))!;
console.log(`written with:  blade ${BLADE.toFixed(2)} at ${ANGLE}°`);
console.log(`read back as:  blade ${found.contrast.toFixed(2)} at ${found.angle.toFixed(1)}°`);
console.log(
  `  between strokes:   ${found.roundSpread.toFixed(3)} -> ${found.spread.toFixed(3)}` +
    `   ${((1 - found.spread / found.roundSpread) * 100).toFixed(0)}% flatter`,
);
console.log(
  `  along each stroke: ${found.roundWander.toFixed(3)} -> ${found.wander.toFixed(3)}` +
    `   ${((1 - found.wander / found.roundWander) * 100).toFixed(0)}% flatter` +
    `   (so the pen is not worth re-fitting against)`,
);

/*
 * And what the pen that actually wrote them does, which separates a bad fit
 * from a dead idea.
 */
import { wanderOf } from "@/quill/hand";
const truth = wanderOf(
  traced.flatMap((one) => one.once),
  BLADE,
  ANGLE,
);
const none = wanderOf(
  traced.flatMap((one) => one.once),
  0,
  0,
);
console.log(
  `  under the TRUE pen: ${none.toFixed(3)} -> ${truth.toFixed(3)}` +
    `   ${((1 - truth / none) * 100).toFixed(0)}% flatter`,
);

/*
 * And the same question asked of the strokes as they were *written*, whose
 * profile is flat by construction because the pen did all the modulation.
 */
const wroteFlat = Object.values(written).flat();
console.log(
  `  the written strokes, whose profile is flat: ` +
    `${wanderOf(wroteFlat, 0, 0).toFixed(3)} -> ${wanderOf(wroteFlat, BLADE, ANGLE).toFixed(3)}`,
);
