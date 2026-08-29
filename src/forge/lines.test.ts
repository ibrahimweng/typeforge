/**
 * Every letter measured against the lines it is drawn between.
 *
 * A font is a set of shapes that agree about where the top and the bottom are.
 * Nothing else in this half of the application checks that: the fold tests ask
 * whether a letter is a letter, the control tests ask whether it survives being
 * pulled about, and both were entirely happy with an E that hung half a stem
 * below the baseline its H stood on -- which is what they were happy with, on
 * every one of the eight faces, for as long as the recipes wrote the middle of
 * a stroke where they meant its edge.
 *
 * So it is measured off the drawn outline, on all eight, and the numbers are
 * the ones a designer would give: a flat stroke stops on its line, a curve goes
 * an overshoot past it, and neither is out by a share of the pen.
 */

import { describe, expect, it } from "vitest";

import { contoursBounds } from "@/font/geometry";
import { drawLetter } from "./build";
import { JOINS } from "./letters";
import { mostLift, wobbleOf } from "./script";
import { BASES, type Style } from "./style";
import { penReach, reachAlong } from "./sweep";

/**
 * How far a square cut across an upright reaches past where the stroke stops.
 *
 * Nothing, for a pen that is round -- but a nib held at an angle leaves an
 * angled cut, and one corner of it lands past the line while the other lands
 * short. That is the face's own character rather than a fault, so it is what
 * the measurements here are allowed to be out by.
 */
function nib(style: Style): number {
  return Math.abs(reachAlong({ x: 1, y: 0 }, penReach(style.pen)).y);
}

const topOf = (name: string, style: Style): number =>
  contoursBounds(drawLetter(name, style)!.contours).yMax;
const footOf = (name: string, style: Style): number =>
  contoursBounds(drawLetter(name, style)!.contours).yMin;

describe("the letters stand on their lines", () => {
  for (const style of BASES) {
    describe(style.name.toLowerCase(), () => {
      const slack = nib(style) + 1;
      /*
       * How far this face's own hand wanders off the line, for the letters it
       * wanders with.
       *
       * Nought on nineteen of the twenty faces. On the four that join, each
       * lowercase letter is deliberately set a little above or below its line --
       * a hand that puts every letter at exactly the same height is not a hand,
       * and that is the whole of what the irregularity control does. So a
       * script's letters are still held to their lines, but to within what the
       * face says it wanders by rather than to within a nib's width.
       *
       * The capitals get none of it, and must not: they do not join, so they do
       * not bounce, and letting them off here would stop this noticing if they
       * ever did.
       */
      const bounce = (name: string): number =>
        name.length === 1 && name >= "a" && name <= "z"
          ? mostLift(style.parts.script, style.metrics.xHeight)
          : 0;
      const { xHeight, capHeight, ascender, overshoot } = style.metrics;

      it("stops a flat stroke on the line it was written to", () => {
        // Uprights and the bars that hang off them: the letters with no curve
        // and no diagonal at either extreme, so there is nothing else in them
        // that could be what is being measured.
        for (const name of ["E", "F", "H", "I", "L", "T", "one", "four", "exclam"]) {
          expect(Math.abs(topOf(name, style) - capHeight), `${name} misses the cap line`)
            .toBeLessThan(slack + bounce(name));
          expect(Math.abs(footOf(name, style)), `${name} misses the baseline`)
            .toBeLessThan(slack + bounce(name));
        }
        for (const name of ["b", "d", "h", "k", "l"]) {
          expect(Math.abs(topOf(name, style) - ascender), `${name} misses the ascender`)
            .toBeLessThan(slack + bounce(name));
        }
        for (const name of ["m", "n", "r", "i"]) {
          expect(Math.abs(footOf(name, style)), `${name} misses the baseline`)
            .toBeLessThan(slack + bounce(name));
        }
      });

      it("takes a curve an overshoot past it, and no further", () => {
        /*
         * A few units of slack over the nib, because the outside of a turn
         * swept by an angled nib is an ellipse arc and a rotated ellipse does
         * not have its highest point where the circle it came from does. It is
         * two or three units on the faces that have one and nothing at all on
         * the rest.
         */
        const room = nib(style) + 4;
        for (const [name, line] of [
          ["o", xHeight], ["c", xHeight], ["e", xHeight], ["s", xHeight], ["a", xHeight],
          ["O", capHeight], ["C", capHeight], ["S", capHeight], ["G", capHeight],
          ["D", capHeight], ["B", capHeight], ["P", capHeight],
          ["zero", capHeight], ["three", capHeight], ["six", capHeight],
          ["eight", capHeight], ["nine", capHeight],
        ] as Array<[string, number]>) {
          expect(
            Math.abs(topOf(name, style) - line - overshoot),
            `${name} does not crest on its line`,
          ).toBeLessThan(room + bounce(name));
        }
        for (const name of ["o", "c", "e", "s", "a", "u", "O", "C", "S", "G", "U", "J", "zero", "eight"]) {
          expect(
            Math.abs(footOf(name, style) + overshoot),
            `${name} does not dip to the baseline`,
          ).toBeLessThan(room + bounce(name));
        }
      });

      it("stops a diagonal on its line as squarely as an upright", () => {
        /*
         * The ends of the arms and legs, which are terminals like any other and
         * were the last thing in the alphabet not to know it.
         *
         * A square cut is square to the stroke, so on a leaning one it finishes
         * in a corner off the line; a serif is a bar across the end, so on a
         * leaning one it leans off with it. Both are cut along the line now, and
         * both had to be: on the serif face the wings alone put the feet of the
         * A, K, R, V, W, X and Y between forty and seventy units under the
         * baseline the H stood on.
         *
         * The points -- an A's apex, a v's vee -- are not measured here. Those
         * are corners rather than terminals, placed by solving where the ink
         * will reach, and what is left in them is the solver's own residue.
         */
        for (const name of ["V", "W", "X", "Y", "v", "w", "x", "y"]) {
          expect(
            Math.abs(topOf(name, style) - (name === name.toUpperCase() ? capHeight : xHeight)),
            `${name} does not stop its arms on the line`,
          ).toBeLessThan(slack + bounce(name));
        }
        for (const name of ["K", "R", "X", "Z", "k", "x", "z"]) {
          expect(Math.abs(footOf(name, style)), `${name} does not stand on the baseline`)
            .toBeLessThan(slack + bounce(name));
        }
      });

      it("never puts a share of the pen between a letter and its line", () => {
        /*
         * The fault this whole file exists for, stated at its widest: whatever
         * a letter does at the top and the bottom, it is not out by an amount
         * that scales with the weight. Half a stem is the signature of a recipe
         * that wrote a spine where it meant an edge.
         */
        const half = style.pen.weight / 2;
        /*
         * Each letter's own bounce taken back off before the two are compared.
         *
         * On a joined face an `n` and an `o` are *meant* to sit at different
         * heights -- that is what the unsteadiness is -- so comparing them raw
         * measures the bounce rather than the recipe. Widening the tolerance to
         * let it through would have worked and would have cost the test its
         * point: two lifts of slack on the Casual Script is a hundred and seven
         * units, and half a stem there is fifty-six, so the fault this file
         * exists to catch would have fitted inside the allowance twice over.
         *
         * The lift is worked out from the letter's name and is the same every
         * time it is asked, so it can simply be subtracted. What is left is
         * where the recipe put the letter, which is what is being asked about.
         */
        const settled = (name: string, at: (name: string, style: Style) => number): number =>
          at(name, style) -
          // Only the letters that actually receive a lift. `wobbleOf` will
          // hand one back for any name it is given, including a capital, and
          // a capital does not join and is never moved by it -- so taking one
          // off a `C` subtracts a displacement that was never applied. `JOINS`
          // is the same set the drawing consults, so the two cannot drift.
          (JOINS.has(name) ? wobbleOf(name, style.parts.script, style.metrics.xHeight).lift : 0);
        for (const [flat, round] of [
          ["H", "O"],
          ["n", "o"],
          ["I", "C"],
        ]) {
          expect(
            Math.abs(settled(round, topOf) - settled(flat, topOf)),
            `${round} and ${flat} do not line up`,
          ).toBeLessThan(Math.max(overshoot * 2, half * 0.3));
          expect(
            Math.abs(settled(round, footOf) - settled(flat, footOf)),
            `${round} and ${flat} do not sit together`,
          ).toBeLessThan(Math.max(overshoot * 2, half * 0.3));
        }
      });
    });
  }
});
