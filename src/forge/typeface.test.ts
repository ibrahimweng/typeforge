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
   * Seven letters and their accented forms, at the last count.
   *
   * The `G` changes construction across the axis and agrees with no master at
   * all. `nine`, `ae`, `at` and `ampersand` come off the pen with the same
   * nodes at every weight and the curves in different places among them: the
   * run cut out of a bowl lands on different pieces of it as the corners grow
   * with the pen, and a variable font compares two masters node by node, so the
   * same count in a different order is no better than a different count. The
   * Cyrillic `\u0417` and `\u0437` are two arcs meeting in the middle: how far they
   * overlap is the pen's business, and so is how many nodes that leaves.
   *
   * Five names came off this list when the pen stopped deciding how many pieces
   * a corner and a tail are drawn in. The `M` crossed the miter limit at its
   * apex between the Thin and the Regular, so a vertex carried out to a point
   * at one weight was rounded at the other -- eighteen nodes against
   * eighty-two; now every corner leaves a wedge behind, empty where the corner
   * needed none. The `yen` drew two bars at a hairline and one at a text
   * weight; now it draws two either way, the second laid on the first where
   * there is no room for it. And `\u03b6`, `\u03be` and `\u03c2` finish with a tail that
   * hooks only where there is room to hook, which a heavy pen on a shallow
   * descender leaves none of; now the hook is always drawn, standing still
   * where it cannot turn.
   *
   * Twenty-two names came off before that, when a bowl run started carrying the
   * pieces it does not reach: the whole `c`, `e` and `two` families, `five`,
   * `cent` and `copyright`.
   *
   * This is the Sans, which is the face that fares best. The same measurement
   * on the Ribbon names 167 letters and on the Technical 95, because both round
   * their corners and a rounded corner eats back into the runs either side of
   * it by a radius the pen sets. `roundCorners` in `shapes.ts` carries the
   * measurement and what stands in the way of collecting it.
   */
  const KNOWN = [
    "G",
    "Gbreve",
    "Gcircumflex",
    "Gcommaaccent",
    "Gdotaccent",
    "ae",
    "ampersand",
    "at",
    "nine",
    "\u0417",
    "\u0437",
  ];

  it("names every letter that is left standing, and no others", async () => {
    const forge = { ...startFrom(SANS), family: { drawn: 400, also: [100, 700, 900] } };
    const delivered = await deliver(forge, { familyName: "Probe", format: "ttf", variable: true });

    expect([...delivered.held].sort()).toEqual([...KNOWN].sort());
    // And the note the export shows says so rather than saying nothing.
    expect(delivered.notes.join(" ")).toContain("follow the axis only part of the way");
  }, 300_000);

  /*
   * And a ceiling for the faces this went wrong worst on.
   *
   * The Sans is named letter by letter because eleven is short enough to read.
   * These are not: the Ribbon left 166 letters standing, the Display 137, the
   * Psychedelic 74 and the Slab 64, and a list that long is a list nobody
   * reads. Held to a number instead, because what matters is the direction --
   * a name coming off is progress, and this is here so that a name going back
   * on is noticed.
   *
   * They are different faults with the same shape, and every one of them is the
   * pen deciding how many nodes a letter is drawn with. The Ribbon and the
   * Technical round their corners, and a rounded corner eats back into the runs
   * either side of it by a radius the pen sets. The Display caps its strokes
   * with a half disc, and a half turn is two quarter-turn pieces except when
   * the arithmetic that says so lands a hair over and makes it three. The Slab
   * hangs a serif on every straight end, and both of the questions it asked
   * about one -- does this run end straight, and is it standing on a line --
   * were answered by measuring against the pen. The Psychedelic puts a ball on
   * every open end, and dropped it wherever the room for it ran out.
   *
   * Measured at 28, 30, 30, 15, 15 and 196. A little over each, the same way
   * the cast layer's point budget is set, and nothing like room for one to
   * double.
   */
  it("keeps the faces that round their corners and their ends on the axis too", async () => {
    for (const [name, most] of [
      ["Ribbon", 33],
      ["Technical", 35],
      ["Display", 35],
      /*
       * The Slab, 64 to 15, and with it the Typewriter 50 to 13, the Serif 40
       * to 13, the Didone 40 to 11, the Flared 56 to 30 and the Brush 37 to 31:
       * every face that hangs a shape on the end of a straight run. What is
       * left is the Sans's own eleven and four more.
       */
      ["Slab", 19],
      /*
       * And the Psychedelic, 74 to 15, which is the ball. Five of the fifteen
       * left are still the ball, refused at one weight and drawn at the next
       * because `onALine` measures the upright share of a slanted pen; see
       * there for the measurement, and for what asking it the other way cost.
       */
      ["Psychedelic", 19],
      /*
       * And the Wavy, still the worst of the sixteen. Its whole idea is that
       * every run lying flat ripples, and both halves of that move with the
       * pen: how far a run leans, and how much of it is left once its two
       * corners have taken what they need.
       *
       * How far it leans is now asked with the answer in mind -- see `rides`,
       * where the band for "flat" is fifteen degrees rather than thirty,
       * because that is where the gap in the measurements is. What is left is
       * now drawn as a wave of nothing where there is nothing left, which took
       * four attempts to get right: the trick is that an arc turning nothing
       * has to be told which way it bends, since the two angles it would be
       * read off are equal. See `ripple` for both, and for the one case that
       * still gives up and why every way of not giving up folds a letter.
       *
       * 290 to 208 to 196 to 115.
       */
      ["Wavy", 122],
    ] as const) {
      const base = BASES.find((one) => one.name === name)!;
      const forge = { ...startFrom(base), family: { drawn: 400, also: [100, 700, 900] } };
      const delivered = await deliver(forge, { familyName: name, format: "ttf", variable: true });
      expect(delivered.held.length, `${name} leaves ${delivered.held.length} standing`).toBeLessThan(
        most,
      );
    }
  }, 900_000);
});
