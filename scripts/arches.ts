/**
 * Noordzij's three ways of making a letter, drawn from one skeleton.
 *
 * A picture rather than a number, because what this proves is not a magnitude.
 * The same arch is swept four times and the only thing that differs is the pen:
 *
 *   translation   the pen is held at one angle and one size the whole way
 *   rotation      the pen turns in the hand as the stroke travels
 *   expansion     the pen changes size
 *   no thickness  the pen is a blade, so the thins come to nothing
 *
 * The second of those is what this engine could not say until the nib became a
 * profile along the spine. Before, one nib hung off the whole stroke, so a
 * stroke could swell and could be held at an angle and could not turn.
 *
 *   OUT=/tmp/arches.svg npx vite-node scripts/arches.ts
 */
import { writeFileSync } from "node:fs";
import { ready, unite } from "@/font/boolean";
import { contourSegments } from "@/font/geometry";
import { sweepAll, toleranceFor } from "@/quill/sweep";
import type { Contour } from "@/font/types";
import type { NibProfile, QuillStroke, WidthProfile } from "@/quill/types";

await ready();
const upm = 1000;

/** The arch every panel is drawn from: up the left, over, down the right. */
const spine = {
  segments: [
    {
      kind: "cubic" as const,
      from: { x: 60, y: 60 },
      c1: { x: 60, y: 700 },
      c2: { x: 260, y: 860 },
      to: { x: 460, y: 860 },
    },
    {
      kind: "cubic" as const,
      from: { x: 460, y: 860 },
      c1: { x: 660, y: 860 },
      c2: { x: 780, y: 660 },
      to: { x: 780, y: 60 },
    },
  ],
  closed: false,
};

const strokeWith = (width: WidthProfile, nib: NibProfile): QuillStroke => ({
  spine,
  width,
  nib,
  start: { kind: "butt" },
  end: { kind: "butt" },
  join: "round",
});

const one = (width: number): WidthProfile => [{ at: 0, width }];

const panels: Array<{ label: string; stroke: QuillStroke }> = [
  {
    label: "translation (const 40deg)",
    stroke: strokeWith(one(200), [{ at: 0, contrast: 0.8, angle: 40 }]),
  },
  {
    label: "rotation contrast 40->110",
    stroke: strokeWith(one(200), [
      { at: 0, contrast: 0.8, angle: 40 },
      { at: 1, contrast: 0.8, angle: 110 },
    ]),
  },
  {
    label: "expansion 200->20 (sharp end)",
    stroke: strokeWith(
      [
        { at: 0, width: 200 },
        { at: 1, width: 20 },
      ],
      [{ at: 0, contrast: 0.8, angle: 40 }],
    ),
  },
  {
    label: "zero thickness h=0",
    stroke: strokeWith(one(200), [{ at: 0, contrast: 1, angle: 40 }]),
  },
];

const d = (contours: Contour[]) =>
  contours
    .map((contour) => {
      const segments = contourSegments(contour);
      if (!segments.length) return "";
      let out = `M ${segments[0].from.x} ${segments[0].from.y}`;
      for (const segment of segments)
        out +=
          segment.kind === "line"
            ? ` L ${segment.to.x} ${segment.to.y}`
            : ` C ${segment.c1.x} ${segment.c1.y} ${segment.c2.x} ${segment.c2.y} ${segment.to.x} ${segment.to.y}`;
      return `${out} Z`;
    })
    .join(" ");

const skeleton = spine.segments
  .map(
    (segment, index) =>
      `${index === 0 ? `M ${segment.from.x} ${segment.from.y}` : ""} C ${segment.c1.x} ${segment.c1.y} ${segment.c2.x} ${segment.c2.y} ${segment.to.x} ${segment.to.y}`,
  )
  .join(" ");

const cell = 1000;
let body = "";
panels.forEach((panel, index) => {
  const drawn = sweepAll([panel.stroke], toleranceFor(upm));
  body += `<g transform="translate(${index * cell},0)">
    <path d="${d(unite(drawn.contours))}" fill="#111"/>
    <path d="${skeleton}" fill="none" stroke="#e5484d" stroke-width="4"/>
  </g>`;
});
let labels = "";
panels.forEach((panel, index) => {
  labels += `<text x="${index * cell + 20}" y="30" font-family="monospace" font-size="26" fill="#e5484d">${panel.label}</text>`;
});

const width = panels.length * cell;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width / 2}" height="560" viewBox="0 0 ${width} 1120">
<rect width="${width}" height="1120" fill="#fff"/>
<g transform="translate(0,1000) scale(1,-1)">${body}</g>
<g transform="translate(0,1060)">${labels}</g></svg>`;

const out = process.env.OUT ?? "arches.svg";
writeFileSync(out, svg);
console.log("wrote", out);
