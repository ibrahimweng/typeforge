/**
 * A letter's ink read across, at heights given in x-heights.
 *
 * `against.ts` and `letter.ts` both answer with one number per letter, which
 * says a letter is wrong without saying where. This says where: the runs of ink
 * a horizontal line crosses, so a bowl and the stem beside it are two entries
 * rather than one width, and a loop that has opened out too early shows as two
 * runs at a height the reference has one.
 *
 * It is the same reading taken of the released Dancing Script (Pablo Impallari,
 * SIL OFL 1.1), whose figures are quoted in the comments on the letters they
 * settled. Telma's licence does not permit derivative work, so nothing is taken
 * from that file.
 *
 * Every figure is over the x-height, so the four faces and the reference can be
 * held against each other directly.
 *
 *   npx vite-node scripts/scan.ts pgy 0.7,0.3,-0.1,-0.5
 */
import { ready, unite, intersect } from "@/font/boolean";
import { contoursBounds } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { BASES } from "@/forge/style";
import type { Contour } from "@/font/types";

await ready();

/** A rectangle to cut the ink with, since the boolean has no scanline of its own. */
const band = (low: number, high: number): Contour => ({
  closed: true,
  nodes: [
    [-4000, low],
    [5000, low],
    [5000, high],
    [-4000, high],
  ].map(([x, y]) => ({
    point: { x, y },
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  })),
});

const letters = (process.argv[2] ?? "n").split("");
const heights = (process.argv[3] ?? "0.7,0.5,0.3,-0.1,-0.3,-0.5,-0.7").split(",").map(Number);

for (const style of BASES.filter((one) => one.parts.script?.on)) {
  console.log(`\n=== ${style.name} ===`);
  const x = contoursBounds(drawLetter("x", style)!.contours).yMax;
  for (const name of letters) {
    const drawn = drawLetter(name, style, style.forms?.[name]);
    if (!drawn) continue;
    const ink = unite(drawn.contours);
    const whole = contoursBounds(ink);
    console.log(
      `  ${name} (${style.forms?.[name] ?? "default"})  adv ${(drawn.advanceWidth / x).toFixed(2)}` +
        `  ink ${((whole.xMax - whole.xMin) / x).toFixed(2)}` +
        `  over left ${(-whole.xMin / x).toFixed(2)} right ${((whole.xMax - drawn.advanceWidth) / x).toFixed(2)}`,
    );
    for (const height of heights) {
      const cut = intersect(ink, [band(x * height - 0.75, x * height + 0.75)]);
      if (cut.length === 0) continue;
      const runs = cut.map((one) => contoursBounds([one])).sort((a, b) => a.xMin - b.xMin);
      const shown = runs.map(
        (one) => `[${(one.xMin / x).toFixed(2)}..${(one.xMax / x).toFixed(2)}]`,
      );
      const span = (runs[runs.length - 1].xMax - runs[0].xMin) / x;
      console.log(
        `        ${height >= 0 ? "+" : ""}${height.toFixed(1)}x ${shown.join(" ")}   span ${span.toFixed(2)}`,
      );
    }
  }
}
