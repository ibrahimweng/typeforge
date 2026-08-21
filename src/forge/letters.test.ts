/**
 * The character set, checked for the things a drawing cannot be trusted about.
 *
 * Looking at a sheet catches shapes that read wrongly, and it caught several:
 * an f that looked like a t, a six whose tail stopped in mid-air, bowls too
 * small to reach their own x-height. It does not catch a stroke that crosses
 * itself somewhere the fill hides, a letter drawn a thousand units above the
 * baseline, or a figure a few units wider than its neighbours -- all of which
 * survive a glance and none of which survive a font.
 *
 * So the eye is for whether it looks like the letter, and this is for whether
 * it is built like one.
 */

import { describe, expect, it } from "vitest";

import { contourArea, contoursBounds } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { builtFrom, drawLetter, letterNames } from "./build";
import { BASES as STARTING_POINTS, DISPLAY, SANS, SERIF, type Style } from "./style";

/*
 * Every place somebody can start, not only the three the alphabet was drawn
 * against.
 *
 * A starting point is a set of decisions over these same skeletons, so if one
 * of them can produce a letter that crosses itself then so can a person turning
 * the controls to the same place -- and it is offered as a button, which makes
 * it the likeliest place anybody will land.
 */
const BASES: Array<[string, Style]> = STARTING_POINTS.map((style) => [
  style.name.toLowerCase(),
  style,
]);

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz".split("");
const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const FIGURES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

describe("the character set", () => {
  it("has every letter, figure and the marks that go with them", () => {
    const drawn = new Set(letterNames());
    for (const name of [...LOWERCASE, ...CAPITALS, ...FIGURES]) {
      expect(drawn.has(name), `${name} is missing`).toBe(true);
    }
    for (const mark of ["space", "period", "comma", "colon", "hyphen", "parenleft"]) {
      expect(drawn.has(mark), `${mark} is missing`).toBe(true);
    }
  });

  for (const [label, style] of BASES) {
    describe(label, () => {
      it("draws every glyph", () => {
        for (const name of letterNames()) {
          const drawn = drawLetter(name, style);
          expect(drawn, `${name} did not draw`).not.toBeNull();
          // A space has no ink, and is the only thing allowed not to.
          if (name !== "space") expect(drawn!.contours.length, `${name} is empty`).toBeGreaterThan(0);
        }
      });

      it("puts every coordinate on the page", () => {
        for (const name of letterNames()) {
          for (const contour of drawLetter(name, style)!.contours) {
            for (const node of contour.nodes) {
              for (const point of [node.point, node.handleIn, node.handleOut]) {
                if (!point) continue;
                expect(Number.isFinite(point.x) && Number.isFinite(point.y), name).toBe(true);
              }
            }
          }
        }
      });

      /**
       * Every stroke is swept from its own spine, so a stroke that crosses
       * itself means the spine turns tighter than the pen is wide. Two strokes
       * crossing is not a fault -- that is a serif on a stem, or an arch
       * meeting the stem it springs from -- so each contour is checked alone.
       */
      it("never draws a stroke that crosses itself", () => {
        for (const name of letterNames()) {
          for (const contour of drawLetter(name, style)!.contours) {
            expect(contoursIntersect([contour]), `${name} has a stroke that folds`).toBe(false);
          }
        }
      });

      it("never draws a stroke with no area", () => {
        for (const name of letterNames()) {
          for (const contour of drawLetter(name, style)!.contours) {
            expect(Math.abs(contourArea(contour)), `${name} has an empty stroke`).toBeGreaterThan(1);
          }
        }
      });

      /**
       * Nothing may wander outside the space a line of type occupies. A letter
       * drawn from the wrong end of a coordinate, or one whose arc sweeps the
       * long way round by mistake, shows up here as ink where a font has none.
       */
      it("keeps every letter inside the line", () => {
        const { ascender, descender, unitsPerEm, capHeight } = style.metrics;
        for (const name of letterNames()) {
          const drawn = drawLetter(name, style)!;
          if (drawn.contours.length === 0) continue;
          const bounds = contoursBounds(drawn.contours);
          /*
           * An accented letter stands taller than the ascender, and is meant
           * to: that is where the accent goes, and every text face in the world
           * puts it there. What it may not do is stand so far above the line
           * that it fouls the one before it, so it is held to a ceiling of its
           * own rather than let off entirely -- a third again over the capitals
           * is about where a text face keeps its own.
           */
          const ceiling = builtFrom(name)
            ? capHeight * 1.4 + style.pen.weight
            : ascender + style.pen.weight;
          expect(bounds.yMax, `${name} rises too far above the line`).toBeLessThanOrEqual(
            ceiling,
          );
          expect(bounds.yMin, `${name} falls below the descender`).toBeGreaterThanOrEqual(
            descender - style.pen.weight,
          );
          expect(bounds.xMin, `${name} starts left of the origin`).toBeGreaterThan(-1);
          expect(bounds.xMax, `${name} runs off the right`).toBeLessThan(unitsPerEm * 1.6);
        }
      });

      it("leaves white space on both sides of every letter", () => {
        for (const name of letterNames()) {
          const drawn = drawLetter(name, style)!;
          if (drawn.contours.length === 0) continue;
          const bounds = contoursBounds(drawn.contours);
          expect(bounds.xMin, `${name} touches its left edge`).toBeGreaterThan(0);
          expect(drawn.advanceWidth - bounds.xMax, `${name} touches its right edge`).toBeGreaterThan(
            0,
          );
        }
      });

      /** A column of figures only lines up if the figures are all one width. */
      it("gives every figure the same width", () => {
        const widths = FIGURES.map((name) => Math.round(drawLetter(name, style)!.advanceWidth));
        expect(new Set(widths).size, `figure widths: ${widths.join(", ")}`).toBe(1);
      });

      it("stands the lowercase on the baseline and the capitals with it", () => {
        for (const name of [...LOWERCASE, ...CAPITALS]) {
          const bounds = contoursBounds(drawLetter(name, style)!.contours);
          // Q's tail drops below the line as surely as a g's does.
          const hasDescender = "gjpqyQ".includes(name);
          if (hasDescender) {
            expect(bounds.yMin, `${name} should descend`).toBeLessThan(0);
          } else {
            // On the line, allowing for the overshoot a round letter is given
            // so that it looks level with the flat ones rather than measuring
            // level with them.
            /*
             * Allowing a full pen below the line, not half of one. A round
             * letter overshoots on purpose, and on a face whose terminals are
             * cut at an angle the corner of that cut reaches further down still
             * -- an e ends 77 units under the baseline on a 1000-unit em, which
             * is the terminal doing its job rather than the letter sinking.
             */
            expect(bounds.yMin, `${name} floats or sinks`).toBeGreaterThan(
              -style.metrics.overshoot - style.pen.weight,
            );
            expect(bounds.yMin, `${name} floats above the line`).toBeLessThan(
              style.pen.weight * 0.6,
            );
          }
        }
      });

      it("makes the capitals taller than the lowercase and shorter than the ascenders", () => {
        const heightOf = (name: string): number => contoursBounds(drawLetter(name, style)!.contours).yMax;
        expect(heightOf("H")).toBeGreaterThan(heightOf("n"));
        expect(heightOf("l")).toBeGreaterThan(heightOf("H"));
        /*
         * Within a few units, because a nib held at an angle puts a slight
         * bulge on the outside of a turn: the offset of a circle swept by an
         * ellipse is an ellipse, and a rotated one does not have its highest
         * point where the circle does. It is two or three units on the marker
         * face and nothing at all on a round pen.
         */
        expect(heightOf("o")).toBeGreaterThan(heightOf("n") - 4);
      });
    });
  }
});

/**
 * The claim the three bases rest on: they are the same skeletons, so the
 * relationships between letters survive changing every drawing decision.
 */
describe("one skeleton, three faces", () => {
  it("keeps the same letters in the same order of width whichever base is used", () => {
    const widthsFor = (style: Style): string[] =>
      ["i", "n", "o", "m"]
        .map((name) => [name, drawLetter(name, style)!.advanceWidth] as const)
        .sort((a, b) => a[1] - b[1])
        .map(([name]) => name);

    const sans = widthsFor(SANS);
    expect(widthsFor(SERIF)).toEqual(sans);
    expect(widthsFor(DISPLAY)).toEqual(sans);
  });

  it("puts serifs on the serif and on neither of the others", () => {
    const pieces = (style: Style): number => drawLetter("H", style)!.contours.length;
    expect(pieces(SERIF)).toBeGreaterThan(pieces(SANS));
    expect(pieces(DISPLAY)).toBe(pieces(SANS));
  });
});
