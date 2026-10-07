/**
 * Every letter of a family member takes that member's weight.
 *
 * A family is drawn from the one weight on screen, and every other weight is
 * the same drawing with the pen asked for (see `weightedStyle`). Asked of a
 * whole face rather than of its n, that went wrong a letter at a time: the
 * Sans's Thin switched off the face's own rule for how it thins, and every
 * letter measured off Geist Thin read it -- so the Thin's D, O and Q stayed at
 * the Regular's weight while its H went to a hairline, and the O had exactly
 * as much ink at a hundred as at four hundred. A Condensed Black closed its D
 * to a hairline counter. And from about the Regular up every accent was held
 * at one weight and one size, so a Black's circumflex was its Regular's.
 *
 * So the ink is counted, letter by letter, at the Thin, the Regular and the
 * Black of every base at every width the axis offers, and each has to be
 * heavier than the one before.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { contourArea } from "@/font/geometry";
import { removeOverlaps } from "@/font/overlap";
import { letterNames } from "./build";
import { draw, startFrom, weighted, type Forge } from "./document";
import { readyToShape } from "./layers";
import { BASES } from "./style";

beforeAll(async () => {
  await readyToShape();
});

/** The ink a letter really lays down: its strokes merged, its counters taken out. */
async function inkOf(letter: string, forge: Forge): Promise<number> {
  const drawn = draw(letter, forge);
  if (!drawn || drawn.contours.length === 0) return 0;
  const merged = await removeOverlaps(drawn.contours, "winding");
  return merged.reduce((sum, contour) => sum + contourArea(contour), 0);
}

describe("every letter of every member takes the member's weight", () => {
  const letters = letterNames();
  for (const base of BASES) {
    it(`${base.name}: lighter at a hundred than at four, and at four than at nine`, async () => {
      const drawing = startFrom(base);
      const uneven: string[] = [];
      for (const width of [75, 100, 125]) {
        const [thin, regular, black] = [100, 400, 900].map((weight) =>
          weighted(drawing, weight, width),
        );
        for (const letter of letters) {
          const ink = [
            await inkOf(letter, thin),
            await inkOf(letter, regular),
            await inkOf(letter, black),
          ];
          // A space has no ink at any weight, and that is not uneven.
          if (ink.every((one) => one === 0)) continue;
          if (!(ink[0] < ink[1] && ink[1] < ink[2])) {
            uneven.push(`${letter} at ${width}: ${ink.map((one) => Math.round(one)).join(" / ")}`);
          }
        }
      }
      expect(uneven).toEqual([]);
    });
  }
});
