/**
 * The letters on their way into a file.
 *
 * Everything up to here draws; this is where the drawing is fused into the
 * outline a font file can hold, and the fuse is the one step that can quietly
 * change what the letter says. A counter is a hole because the pen drew it
 * running the other way -- and if that is not believed on the way through, the
 * letter arrives solid, looks like a slightly heavy letter, and nothing else
 * in the application has an opinion about it.
 *
 * That is not hypothetical: it shipped. Twenty-two drawings across the sixteen
 * faces came out of the fuse with a counter filled in, the single-storey Sans a
 * carrying half again its own ink and every accented a built on it with it.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready, unite } from "@/font/boolean";
import { contourArea } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { draw } from "./document";
import { drawLetter, letterNames } from "./build";
import { layOut, startFrom, useKit } from "./document";
import { BASES, SANS } from "./style";
import { toTypeface } from "./typeface";

beforeAll(async () => {
  await ready();
});

/**
 * What these contours add up to, a counter counting against the ink it is in.
 *
 * Signed, because that is what makes the claim below sayable at all: a filled
 * counter is not a shape that looks different, it is a number that went up.
 */
const inkIn = (contours: Contour[]): number =>
  Math.abs(contours.reduce((total, one) => total + contourArea(one), 0));

describe("fusing a letter for the file", () => {
  it("never leaves more ink than the pen laid down", async () => {
    /*
     * A union cannot add ink, and that is arithmetic rather than taste.
     *
     * The pieces going in are counted separately, so wherever two of them
     * overlap the same ground is counted twice; joining them counts it once.
     * The answer can only come out the same or smaller -- unless a counter has
     * been read as solid, in which case its area changes sign and the total
     * goes up, which is exactly what this catches.
     *
     * Over every drawing of every face rather than over a chosen few, because
     * the failure is not in any one letter: it is in a rule for telling a
     * counter from a stem, and which letters that rule gets wrong is not
     * something anybody can list in advance. The twenty-two were found this
     * way and not by looking.
     */
    const gained: string[] = [];
    for (const base of BASES) {
      for (const name of letterNames()) {
        const drawn = drawLetter(name, base)?.contours;
        if (!drawn || drawn.length < 2) continue;
        const laid = inkIn(drawn);
        const fused = inkIn(unite(drawn, "winding"));
        // A hundredth, for the rounding a boolean does on the way through.
        if (laid > 0 && fused > laid * 1.01) {
          gained.push(`${base.name} ${name}: ${((fused / laid - 1) * 100).toFixed(0)}% more`);
        }
      }
    }
    expect(gained).toEqual([]);
  }, 300_000);

  it("keeps the counter of a single-storey a", async () => {
    /*
     * The letter the reading was wrong about, through the whole export path
     * rather than through the fuse alone -- because it was not the fuse that
     * was wrong. The fuse does what it is told; it was being told to work out
     * for itself which contour was a counter, on a letter that already knew.
     *
     * The a is drawn as a ring with a stem laid down its right side. Working
     * it out by nesting, the stem is inside the ring, so the stem counts as
     * one enclosure, and the counter -- inside the ring, and inside the run of
     * the stem -- counts as two. Two is even, so the counter reads as solid.
     */
    const typeface = await toTypeface(startFrom(SANS), {
      familyName: "Test",
      styleName: "Regular",
      merge: true,
    });
    const a = typeface.glyphs[typeface.glyphIndex.get("a")!];
    expect(a.contours.filter((one) => contourArea(one) < 0)).toHaveLength(1);
    expect(a.contours.filter((one) => contourArea(one) > 0)).toHaveLength(1);
  }, 120_000);

  it("joins a letter built out of cells that only touch", () => {
    /*
     * The other half of what a fuse has to survive, and the opposite failure.
     *
     * Everywhere else on a letter the pieces overlap, and the trouble is edges
     * that lie exactly along one another. A glyph laid out on a grid overlaps
     * almost nowhere: it is a heap of cells sharing their edges, and an H is
     * fourteen of them with two overlapping pairs between the lot.
     *
     * So a fuse that breaks the coincidence by sliding each shape a hair apart
     * pulls those cells apart instead of joining them, and the H arrives in
     * six pieces that look like one until something cuts one of them away.
     * Growing each shape outward by a hair breaks the same coincidence and
     * cannot do that: shapes that met still meet.
     */
    const grid = useKit(layOut(startFrom(SANS)), true);
    for (const name of ["H", "n"]) {
      const cells = draw(name, grid)!.contours;
      expect(cells.length, name).toBeGreaterThan(6);
      expect(unite(cells, "winding"), name).toHaveLength(1);
    }
    // The O keeps its counter, so it is one solid and one hole rather than one.
    const o = unite(draw("O", grid)!.contours, "winding");
    expect(o.filter((one) => contourArea(one) < 0)).toHaveLength(1);
    expect(o.filter((one) => contourArea(one) > 0)).toHaveLength(1);
  }, 60_000);
});
