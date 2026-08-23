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
import { deliver } from "./deliver";
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

/**
 * A letter that cannot follow the weight axis is set at the wrong weight.
 *
 * A variable font holds one set of outlines and a list of how every point
 * moves, so two weights can only be joined where they are drawn with the same
 * points. Where they are not, the letter follows the masters it does agree with
 * and is left at the nearest of them for the rest of the axis -- and "left at
 * the nearest" is not a nicety about shape. It is a Regular `G` sitting in a
 * Black word with a third of the ink of the letters either side of it.
 *
 * The list is what this pins, not the count. Every name on it is a letter that
 * is drawn with a different number of nodes at some weight, and that is a fact
 * about the drawing which can be fixed one letter at a time -- so a name coming
 * off it is progress and a name going on it is a letter that quietly stopped
 * working, and only naming them tells the two apart.
 */
describe("the weight axis, and the letters that cannot follow it", () => {
  /*
   * Nine letters and their accented forms, at the last count.
   *
   * The `G` changes construction across the axis and agrees with no master at
   * all. The `M` crosses the miter limit at its vertex between the Thin and the
   * Regular, so the joins that are cut square at one weight are rounded at the
   * other. The `yen` draws two bars at a hairline and one at a text weight.
   * `nine`, `ae`, `at` and `ampersand` are each a piece of a bowl that the run
   * reaches at one weight and not another, in a shape the bowl's own pieces
   * cannot stand in for.
   *
   * Twenty-two names came off this list when a bowl run started carrying the
   * pieces it does not reach: the whole `c`, `e` and `two` families, `five`,
   * `cent` and `copyright`.
   */
  const KNOWN = [
    "G",
    "Gbreve",
    "Gcircumflex",
    "Gcommaaccent",
    "Gdotaccent",
    "M",
    "ae",
    "ampersand",
    "at",
    "nine",
    "yen",
  ];

  it("names every letter that is left standing, and no others", async () => {
    const forge = { ...startFrom(SANS), family: { drawn: 400, also: [100, 700, 900] } };
    const delivered = await deliver(forge, { familyName: "Probe", format: "ttf", variable: true });

    expect([...delivered.held].sort()).toEqual([...KNOWN].sort());
    // And the note the export shows says so rather than saying nothing.
    expect(delivered.notes.join(" ")).toContain("follow the axis only part of the way");
  }, 300_000);
});
