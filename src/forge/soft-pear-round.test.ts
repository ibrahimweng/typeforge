/**
 * The six's hood and the nine's tail brought back past a Black, on a face
 * whose drops are pears (`pearRound` in `letters/figures.ts`).
 *
 * A pear turns toward plumb and hangs its ball down into the opening. Past the
 * Black the end it hangs from is too wide for the ball to be smaller than the
 * end, and carried as far round as a plain drop's the ball comes down toward
 * the bowl. The clash test in `teardropsFor` keeps it off the bowl -- one
 * counter, never two -- but only just: left to that alone, at 260 and a width
 * of 105 the opening was fourteen units wide, a slit a twentieth of the stem
 * across. Stopped sooner, as `pearRound` stops them, the hood and the tail
 * leave the opening open: never less than a tenth of the stem at any heavy
 * pen and width.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import type { Contour } from "@/font/types";
import { drawLetter } from "./build";
import { formOf, startFrom } from "./document";
import { widthedStyle } from "./family";
import { readyToShape } from "./layers";
import { flatten, windingAt } from "./soft";
import { SOFT_SERIF } from "./starts";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const PENS = [200, 210, 220, 230, 240, 245, 250, 255, 260];
const WIDTHS = [75, 90, 100, 105, 110, 115, 125];

/**
 * How wide the opening between a figure's drop and its bowl is: the least
 * distance from the drop's outline to the bowl's, nought where any of the
 * drop lies in the bowl's ink. The figure is the bowl's ring (its outer and
 * inner edges), the hood or the tail, and the drop, in that order.
 */
function opening(contours: Contour[]): number {
  const [outer, inner, , drop] = contours;
  const bowl = flatten([outer, inner], 48);
  const edge = bowl.polygons.flatMap((polygon) => polygon.points);
  let least = Infinity;
  for (const point of flatten([drop], 48).polygons[0].points) {
    if (windingAt(bowl, point) !== 0) return 0;
    for (const other of edge)
      least = Math.min(least, Math.hypot(point.x - other.x, point.y - other.y));
  }
  return least;
}

describe("the six and the nine past a Black, on a face whose drops are pears", () => {
  const forge = startFrom(SOFT_SERIF);

  it("are drawn as a ring, a hood or a tail, and a pear", () => {
    for (const name of ["six", "nine"]) {
      const style = widthedStyle({ ...SOFT_SERIF, pen: { ...SOFT_SERIF.pen, weight: 260 } }, 100);
      const { contours } = drawLetter(name, style, formOf(forge, name) || undefined)!;
      expect(contours.length, name).toBe(4);
      expect(contours[3].nodes.length, `${name}'s drop`).toBe(5);
    }
  });

  it("leave the opening at least a tenth of the stem wide, at every heavy pen and width", () => {
    const narrow: string[] = [];
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        const style = widthedStyle(
          { ...SOFT_SERIF, pen: { ...SOFT_SERIF.pen, weight: pen } },
          width,
        );
        for (const name of ["six", "nine"]) {
          const { contours } = drawLetter(name, style, formOf(forge, name) || undefined)!;
          const wide = opening(contours);
          if (wide < pen * 0.1) narrow.push(`${name} at ${pen}/${width}: ${wide.toFixed(1)}`);
        }
      }
    }
    expect(narrow).toEqual([]);
  });
});
