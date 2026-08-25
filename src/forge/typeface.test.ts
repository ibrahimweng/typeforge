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
  /*
   * And the last eleven came off when a bowl stopped being allowed to begin its
   * list of pieces wherever the aperture happened to fall.
   *
   * A bowl is cut into nine pieces and a run is cut out of those nine. A run
   * that does not cross the seam they are cut at reads round from the first
   * piece however far it reaches, because the pieces it misses stall at the
   * head. A run that does cross it cannot: the list has to begin where the run
   * begins, so a bowl whose aperture moves onto the next piece as the pen
   * widens comes back with the same nine pieces in a different order.
   *
   * The `G` is the plainest of the eleven. Its bowl is carried past its own
   * start so the bar has ink to sit in, and the aperture opens as the pen
   * widens: the run begins on the second piece at the Thin, the Regular and the
   * Bold, and on the third at the Black -- the same twenty nodes rotated by
   * one. So the drawn weight writes down which piece it began on and every
   * other master begins on the same one: `begun` in `shapes.ts`, which is the
   * arrangement `WaveBook` already makes for how many humps a wave has.
   *
   * The `ae`, `ampersand`, `at`, `nine`, `\u0417` and `\u0437` are the same fault in bowls
   * that are not carried past anything -- they cross the seam because their
   * apertures are not near it -- and the five `G`s are one letter drawn five
   * times. Nothing else in this face is left.
   */
  it("leaves no letter standing at all", async () => {
    const forge = { ...startFrom(SANS), family: { drawn: 400, also: [100, 700, 900] } };
    const delivered = await deliver(forge, { familyName: "Probe", format: "ttf", variable: true });

    /*
     * That the whole family was drawn, before anything is read into an empty
     * list: nothing standing and nothing drawn look the same from here.
     */
    expect(delivered.members.map((one) => one.weight)).toEqual([100, 400, 700, 900]);
    expect(delivered.bytes.length).toBeGreaterThan(100_000);

    expect(delivered.held).toEqual([]);
    // And with nothing held there is nothing to say about it.
    expect(delivered.notes.join(" ")).not.toContain("follow the axis only part of the way");
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
   * Every one of them then moved again when bowls stopped beginning their lists
   * wherever the aperture fell -- see the test above, and `begun` in
   * `shapes.ts` -- and again when a refused flare and a refused serif stopped
   * being shapes not drawn and became shapes drawn on one spot. Across the
   * sixteen faces, 294 letter-face pairs to 88 to 52, and seven of the sixteen
   * to none at all.
   *
   * All sixteen are here now rather than the six worst, because ten of them are
   * at nothing or one and a face that has arrived is exactly the one worth
   * watching. A little over each, the same way the cast layer's point budget is
   * set, and nothing like room for one to double.
   *
   * The Display then went 20 to 14 when a round cap stopped being allowed to
   * pull a run back past its own length -- see `back` in `capped`. Six of its
   * twenty were a run the cap had eaten whole, and a run of no length is not a
   * shorter run: its two ends are one point, `stitch` welds them into a single
   * node, and the letter comes back with fewer nodes than the same letter at a
   * lighter weight. The bracket's arms went 112, 53, 0, 0 across the axis and
   * the letter had 18 nodes at the first two weights and 10 at the last two.
   *
   * And went 14 to 0 when an arc that goes nowhere stopped being offset from
   * angles of its own -- see `offsetSegment` in `sweep.ts`. The `two`'s bend is
   * nine pieces at every weight and two of them turn through nothing at the
   * Thin and through five and nineteen degrees everywhere else, and a piece
   * that turns through nothing was landing wherever its own arithmetic put it
   * rather than on the point its neighbours had reached. Forty of the Thin
   * `two`'s points sat on two spots forty-four units apart.
   *
   * And the Psychedelic went 5 to 0 when a ball stopped being refused outright
   * -- see `decided` in `shapes.ts`. Whether a run arrives straight and whether
   * its ink has reached one of the letter's lines are both the pen's business,
   * so a terminal carried a ball at one weight and not at the next, and its
   * `Ω` came back with 220 nodes at three weights and 152 at the Thin. The
   * drawn weight decides now and the rest follow it, which is what the waves
   * and the bowls already do.
   *
   * Measured at 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0 and 0, in the
   * order below. Fourteen of the sixteen carry every letter they draw, and
   * what is left is the Technical's `section` and the Marker's `braceright`.
   */
  it("keeps the faces that round their corners and their ends on the axis too", async () => {
    for (const [name, most] of [
      ["Sans", 1],
      ["Grotesque", 1],
      ["Geometric", 1],
      ["Fairground", 3],
      ["Ribbon", 3],
      ["Technical", 4],
      ["Marker", 4],
      ["Display", 1],
      /*
       * The Slab, 64 to 15, and with it the Typewriter 50 to 13, the Serif 40
       * to 13, the Didone 40 to 11, the Flared 56 to 30 and the Brush 37 to 31:
       * every face that hangs a shape on the end of a straight run. What is
       * left is the Sans's own eleven and four more.
       */
      ["Slab", 3],
      ["Serif", 3],
      ["Didone", 3],
      ["Typewriter", 3],
      /*
       * And the Psychedelic, 74 to 15, which is the ball. Five of the fifteen
       * left are still the ball, refused at one weight and drawn at the next
       * because `onALine` measures the upright share of a slanted pen; see
       * there for the measurement, and for what asking it the other way cost.
       */
      ["Psychedelic", 1],
      /*
       * And the Wavy, still the worst of the sixteen. Its whole idea is that
       * every run lying flat ripples, and both halves of that move with the
       * pen: how far a run leans, and how much of it is left once its two
       * corners have taken what they need.
       *
       * How far it leans is now asked with the answer in mind -- see `rides`,
       * where the band for "flat" is fifteen degrees rather than thirty,
       * because that is where the gap in the measurements is. What is left is
       * drawn as a wave of nothing wherever there is nothing left, which took
       * five attempts: an arc turning nothing has to be told which way it
       * bends, since the two angles it would be read off are equal, and the
       * stall has to stand at the very end of the run, because the sweep cuts a
       * corner against the piece beside it and anything moved inward shortens
       * that piece. All the far stub needs is to be a length at all. See
       * `ripple` for both, and for the three placements that fold a letter.
       *
       * The arc count was not fixed where it is worked out, because it cannot
       * be: the count is a rounding and the run's length moves. It is worked
       * out once instead, at the weight the family was drawn at, and every
       * master counts off that -- see `WaveBook` in `shapes.ts`, and `ripple`
       * for the four ways of rounding differently that only move the boundary.
       *
       * And the last of it was a line that had been argued out of the code in
       * a comment and left in it: a wave held flatter than a degree by the pen
       * used to be handed back as a straight run, which is the same fault as
       * all the others and was worth nineteen letters on its own.
       *
       * 290 to 208 to 196 to 115 to 58 to 32 to 12, which is the eleven every
       * face inherits from the Sans and one more.
       */
      ["Wavy", 4],
      /*
       * And the two that swell their stroke ends rather than rounding a corner
       * or hanging a serif: the Brush at 1 and the Flared at 1, from 23 and 8.
       * A swelling refused -- because it would hang under the line the letter
       * stands on, or because the stroke ends on a curve -- is now drawn a unit
       * deep on the stroke's own end rather than not drawn, so the letter has
       * the same contours at every weight. See `flaresFor` in `build.ts`.
       *
       * The Brush's last seventeen were a quarter turn drawn in two pieces
       * because `3pi/2 - pi` lands four ulps above `pi/2`: see `A_QUARTER` in
       * `sweep.ts`. It is the only face whose bowls have corners at exactly a
       * right angle, which is why it is the only face that had them.
       */
      ["Brush", 3],
      ["Flared", 3],
    ] as const) {
      const base = BASES.find((one) => one.name === name)!;
      const forge = { ...startFrom(base), family: { drawn: 400, also: [100, 700, 900] } };
      const delivered = await deliver(forge, { familyName: name, format: "ttf", variable: true });
      expect(delivered.held.length, `${name} leaves ${delivered.held.length} standing`).toBeLessThan(
        most,
      );

      /*
       * And for the Wavy, the letters the wave book bought, named rather than
       * counted. A ceiling goes on passing if the count is held down by
       * something else giving way, so these are said out loud: every one has a
       * run long enough to carry more than one hump, and every one crossed a
       * hump boundary somewhere on the axis before the count was taken once at
       * the drawn weight. The `T` crossbar goes 754 units at the Thin to 822 at
       * the Black, over the line at 760, and came out with seven humps at one
       * end and nine at the other.
       *
       * Asked of the delivery this test already made, rather than of one of its
       * own: a second pass over the Wavy is twenty seconds, and the file it
       * would slow down has a five-second test in it.
       */
      if (name === "Wavy") {
        const standing = new Set(delivered.held);
        for (const letter of [
          "T", "Tbar", "Tcaron", "z", "zcaron", "four",
          "seven", "numbersign", "yen", "AE", "Hbar", "onequarter",
          // And the ones the flat wave bought, which is the whole `e` family.
          "e", "eacute", "egrave", "ecircumflex", "edieresis", "emacron",
          "ebreve", "edotaccent", "eogonek", "ecaron", "ae", "oe", "five",
          "longs", "b", "ъ",
        ]) {
          expect(standing.has(letter), `${letter} is left standing`).toBe(false);
        }
      }
    }
  }, 900_000);

});
