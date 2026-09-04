/**
 * Blending the pen against blending the outline, measured.
 *
 * Two versions of one letter written with the same pen held at forty degrees
 * and at a hundred and ten. Halfway between them, three ways:
 *
 *   the pen blended, which is the letter a hand at seventy-five would write
 *   the outlines blended, node by node, which is what masters used to do
 *   and the letter actually written at seventy-five, which is the truth
 *
 * The claim is that the first lands on the third and the second does not.
 *
 *   npx vite-node scripts/blend.ts
 */
import { ready, unite } from "@/font/boolean";
import { contourArea, flattenContour } from "@/font/geometry";
import { blendStrokes } from "@/quill/written";
import { sweepAll, toleranceFor } from "@/quill/sweep";
import { nearestOnPaths } from "@/quill/curve";
import type { QuillStroke } from "@/quill/types";

await ready();
const upm = 1000;

/** An `n`: a stem, and a shoulder over to a second stem. */
const written = (angle: number): QuillStroke[] => {
  const pen = [{ at: 0, contrast: 0.75, angle }];
  return [
    {
      spine: {
        segments: [
          {
            kind: "cubic" as const,
            from: { x: 120, y: 0 },
            c1: { x: 120, y: 200 },
            c2: { x: 120, y: 500 },
            to: { x: 120, y: 700 },
          },
        ],
        closed: false,
      },
      width: [{ at: 0, width: 150 }],
      nib: [{ ...pen[0] }],
      start: { kind: "butt" as const },
      end: { kind: "butt" as const },
      join: "round" as const,
    },
    {
      spine: {
        segments: [
          {
            kind: "cubic" as const,
            from: { x: 120, y: 480 },
            c1: { x: 200, y: 700 },
            c2: { x: 480, y: 700 },
            to: { x: 540, y: 480 },
          },
          {
            kind: "cubic" as const,
            from: { x: 540, y: 480 },
            c1: { x: 540, y: 320 },
            c2: { x: 540, y: 160 },
            to: { x: 540, y: 0 },
          },
        ],
        closed: false,
      },
      width: [{ at: 0, width: 150 }],
      nib: [
        { ...pen[0], at: 0 },
        { ...pen[0], at: 0.5 },
        { ...pen[0], at: 1 },
      ],
      start: { kind: "butt" as const },
      end: { kind: "butt" as const },
      join: "round" as const,
    },
  ];
};

const inkOf = (strokes: QuillStroke[]) => unite(sweepAll(strokes, toleranceFor(upm)).contours);
const paths = (cs: ReturnType<typeof inkOf>) => cs.map((c) => flattenContour(c, 40));
const areaOf = (cs: ReturnType<typeof inkOf>) =>
  Math.abs(cs.reduce((total, one) => total + contourArea(one), 0));

/** How far one drawing strays from another, both ways round. */
const strays = (one: ReturnType<typeof inkOf>, other: ReturnType<typeof inkOf>) => {
  const a = paths(one);
  const b = paths(other);
  let most = 0;
  for (const point of a.flat()) most = Math.max(most, nearestOnPaths(point, b));
  for (const point of b.flat()) most = Math.max(most, nearestOnPaths(point, a));
  return most;
};

const light = written(40);
const heavy = written(110);
const truth = inkOf(written(75));

// The pen blended: halfway between the two versions' pens.
const byPen = inkOf(blendStrokes(light, [{ strokes: heavy, scalar: 0.5 }]));

/*
 * And the outlines blended node by node, which is what a variable font does
 * and what masters here did before this. Only possible at all when the two
 * outlines have the same points in the same order -- which these do not, so
 * the honest comparison is the closest thing that exists: the two swept
 * outlines averaged where they line up, and the whole thing declared
 * incompatible where they do not.
 */
const lightInk = inkOf(light);
const heavyInk = inkOf(heavy);
const sameShape =
  lightInk.length === heavyInk.length &&
  lightInk.every((one, at) => one.nodes.length === heavyInk[at].nodes.length);

console.log(`the pen at 40 degrees:   ${lightInk.reduce((t, c) => t + c.nodes.length, 0)} nodes`);
console.log(`the pen at 110 degrees:  ${heavyInk.reduce((t, c) => t + c.nodes.length, 0)} nodes`);
console.log(`same points in the same order? ${sameShape ? "yes" : "NO"}`);
console.log("");
console.log(`written at 75 degrees, which is the truth:  ${areaOf(truth).toFixed(0)} units of ink`);
console.log(
  `the pen blended halfway:                    ${areaOf(byPen).toFixed(0)} units, ` +
    `straying ${strays(byPen, truth).toFixed(1)} units from it`,
);
if (sameShape) {
  const outlineBlend = lightInk.map((one, at) => ({
    ...one,
    nodes: one.nodes.map((node, index) => ({
      ...node,
      point: {
        x: (node.point.x + heavyInk[at].nodes[index].point.x) / 2,
        y: (node.point.y + heavyInk[at].nodes[index].point.y) / 2,
      },
    })),
  }));
  console.log(
    `the outlines blended halfway:               ${areaOf(outlineBlend).toFixed(0)} units, ` +
      `straying ${strays(outlineBlend, truth).toFixed(1)} units from it`,
  );
} else {
  console.log("the outlines blended halfway:               impossible. The two versions do not");
  console.log(
    "                                            have the same points in the same order,",
  );
  console.log("                                            so a variable font cannot store the");
  console.log("                                            difference at all and the letter would");
  console.log("                                            be left standing still.");
}
