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

import { contourArea, contoursBounds, inkRunsAt } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { builtFrom, drawLetter, letterNames , reachesOut } from "./build";
import { startFrom, weighted } from "./document";
import { openWaveBook, spineEnd, spineStart, waveBookAt, type WaveBook } from "./shapes";
import { everyFormOf, recipeOf } from "./letters";
import { mostLift, seamsOf } from "./script";
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
          /*
           * A joined face is the exception, and it is the only one.
           *
           * Its lead-in starts a knit to the left of the origin and climbs away
           * from it, so the square cut at that end sits out there -- and the
           * letter before it carries the matching distance past its own
           * advance, which is how the two lap over each other instead of
           * meeting at a point. It may not go further left than the knit plus
           * what that square cut reaches, which is half a pen.
           *
           * The knit is the part that is deliberate and was not always here.
           * Both halves used to stop dead on the boundary, so the ink met along
           * a line and over no area: the letters joined and read as letters
           * pushed together. See `knit` on the Script.
           */
          const reaches = reachesOut(name, style);
          /*
           * Measured against the lean as well as the pen. A shear moves the ink
           * at the seam sideways -- thirty-five units at twenty-two degrees on
           * the formal script -- and it moves the next letter's by exactly the
           * same amount, which is why the joins close anyway. So what is being
           * checked here is that the lead-in reaches no further left than its
           * own square cut can, not that it starts at nought.
           */
          /*
           * And leaned at the height the leftmost ink actually sits at, not at
           * the seam.
           *
           * The seam is where the lead-in is, and for most letters the lead-in
           * is the leftmost thing. A descender is not: it hangs a long way
           * below the seam, and the same shear that moves the seam sideways
           * moves it further -- a Monoline `j`, whose loop drops 0.84 of an
           * x-height under a lean of twenty-one degrees, reaches a third of an
           * x-height left of its origin for it. That is the shear doing what a
           * shear does, not a letter spaced wrong, and the reference does the
           * same and more: its `j` starts 0.58 of an x-height left of the
           * origin, its `p` 0.28 and its `f` 0.20. A descender hangs under the
           * tail of the letter before it, where there is nothing to foul.
           */
          const lowest = drawn.contours
            .flatMap((one) => one.nodes)
            .reduce((left, node) => (node.point.x < left.point.x ? node : left)).point;
          const seam = seamsOf(style.parts.script, style.metrics.xHeight, style.pen.weight / 2).low;
          const leaned = (Math.min(seam, lowest.y) - style.metrics.xHeight / 2)
            * Math.tan((style.metrics.slant * Math.PI) / 180);
          const knit = style.parts.script.on ? style.parts.script.knit * style.pen.weight : 0;
          /*
           * And a descender's loop swings sideways as well as leaning.
           *
           * The shear above accounts for a stroke being carried left by the
           * lean; it does not account for a loop turning left under its own
           * letter. Since a letter is spaced off its body between the lines,
           * that swing is not paid for in the advance and comes out over the
           * origin -- which is what the reference does too, and by about as
           * much: its `j` starts 0.58 of an x-height left of its own origin
           * against our 0.57 and 0.59, its `p` 0.28 and its `f` 0.20.
           *
           * How far a loop may swing is the loop's own arithmetic rather than a
           * figure picked to fit: it is struck no longer than the descender it
           * hangs from and bows `eye` of that.
           */
          const swing = style.parts.script.on && bounds.yMin < 0
            ? style.parts.script.eye * Math.abs(style.metrics.descender)
            : 0;
          expect(bounds.xMin, `${name} starts left of the origin`).toBeGreaterThan(
            reaches ? Math.min(0, leaned) - style.pen.weight * 0.5 - knit - swing - 1 : -1,
          );
          expect(bounds.xMax, `${name} runs off the right`).toBeLessThan(unitsPerEm * 1.6);
        }
      });

      /*
       * White space either side, on the faces whose letters stand apart -- and
       * the exact opposite on the four whose letters do not.
       *
       * This is the same invariant read the right way round for each kind of
       * face rather than two different standards. What both say is that the
       * letter fills the space it was given and no more: a face that spaces
       * with white leaves white at both edges, and a face that spaces with a
       * stroke has to have that stroke reaching both edges, or its letters do
       * not join and the whole point of it is gone.
       */
      it("leaves white space on both sides of every letter", () => {
        for (const name of letterNames()) {
          const drawn = drawLetter(name, style)!;
          if (drawn.contours.length === 0) continue;
          if (reachesOut(name, style)) continue;
          const bounds = contoursBounds(drawn.contours);
          expect(bounds.xMin, `${name} touches its left edge`).toBeGreaterThan(0);
          expect(drawn.advanceWidth - bounds.xMax, `${name} touches its right edge`).toBeGreaterThan(
            0,
          );
        }
      });

      it("reaches both edges of every joined letter", () => {
        if (!style.parts.script.on) return;
        const seam = seamsOf(style.parts.script, style.metrics.xHeight, style.pen.weight / 2).low;
        for (const name of LOWERCASE) {
          const drawn = drawLetter(name, style)!;
          const runs = inkRunsAt(drawn.contours, seam, "y", 48);
          expect(runs.length, `${name} has no ink at the seam`).toBeGreaterThan(0);
          // Measured against the lean, which moves the ink at the seam sideways
          // -- by seven or eight units at six degrees, on both letters of every
          // pair equally, so it opens nothing.
          const shift = (seam - style.metrics.xHeight / 2) * Math.tan((style.metrics.slant * Math.PI) / 180);
          expect(Math.min(...runs.map((run) => run[0])), `${name} does not reach its left edge`)
            .toBeLessThan(shift + 1);
          expect(Math.max(...runs.map((run) => run[1])), `${name} does not reach its right edge`)
            .toBeGreaterThan(drawn.advanceWidth + shift - 1);
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
         *
         * And within the bounce, twice over, on the faces that have one. The
         * two letters are set off the line independently -- that is the point
         * of an unsteady hand -- so the worst case is one of them lifted as far
         * up as the face allows and the other as far down.
         */
        const apart = mostLift(style.parts.script, style.metrics.xHeight) * 2;
        expect(heightOf("o")).toBeGreaterThan(heightOf("n") - 4 - apart);
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

/**
 * Whether a letter is one piece of ink or several.
 *
 * A letter here is drawn as overlapping pieces -- a serif is a bar laid on a
 * stem, the vee of a K is a run laid against one -- and where two of them only
 * touch, along a line and over no area, they are two shapes and not one. On a
 * page that is invisible: abutting shapes leave no seam under a non-zero fill,
 * so eleven faces drew their k with the leg unattached and nobody could see it.
 *
 * It stops being invisible the moment anything asks the letter about its own
 * edge. A break cut takes a piece away, and the piece it takes is one that was
 * never joined on: a Flared L lost its serif, a Fairground k lost its whole
 * leg. So the count is asserted rather than looked at.
 *
 * There were a hundred and forty-four of these, the worst of them in twelve
 * pieces, and this used to carry a written list of the ones still failing. The
 * list is empty now, so the claim is the plain one: every letter of every face
 * is one solid.
 */
describe("letters in one piece", () => {
  // i and j are two pieces because a dot is a piece, and so are the letters
  // that carry one. What is left is every letter that should be one solid.
  const solid = letterNames().filter((name) => /^[A-Za-z]$/.test(name) && name !== "i" && name !== "j");

  it("draws every letter of every face as one solid", async () => {
    const { ready } = await import("@/font/boolean");
    const { piecesOf } = await import("./cut");
    await ready();

    const apart: string[] = [];
    for (const style of STARTING_POINTS) {
      for (const name of solid) {
        /*
         * Every form the letter offers, and not only the one it draws by
         * default.
         *
         * A face chooses its alternates in `forms`, so a broken alternate ships
         * without the default form of that letter ever being wrong. Drawing
         * only the defaults, this passed for as long as the `y` with the
         * straight tail had that tail floating clear of its own vee, on three
         * of the faces that offer it.
         */
        for (const { id } of everyFormOf(name)) {
          const drawn = drawLetter(name, style, id || undefined);
          if (!drawn || drawn.contours.length === 0) continue;
          if (piecesOf(drawn.contours) > 1) {
            apart.push(`${style.name} ${name}${id ? ` (${id})` : ""}`);
          }
        }
      }
    }
    expect(apart).toEqual([]);
  }, 60_000);

  /*
   * And drawn as the face really ships it, with the tool's own marks on.
   *
   * The test above asks `drawLetter`, which draws the letter and stops. Every
   * effect is applied after that and only by `proof`, so nothing here saw them
   * -- and the press does not add ink, it carves it away, which is the one
   * operation in the engine that can take a letter apart.
   *
   * It did. The Formal Script ships with the press on and its `n` had a notch
   * cut through the shoulder, its `i` was bitten into and its `l` was in two
   * pieces at the baseline, in the drawing this application exports. The cut
   * was being placed against whatever a ray fired from the spine found first,
   * and at a junction that ray leaves through the gap between two strokes and
   * comes back with the far side of the letter -- so the wedge was laid across
   * ink belonging to something else.
   *
   * The press is off on both of those faces now, and this is what holds it off:
   * turn it back on and this test says so. Asked of every face that puts a mark
   * on rather than only of the ones that carve, because they all work on the
   * same outline and the cost of asking is one drawing per letter.
   *
   * Except a face that skips. A dry brush leaves the paper bare in places and
   * the letter really is in several pieces afterwards -- that is the whole of
   * what the effect draws, so counting pieces cannot say anything about it.
   */
  it("draws every letter of every marked face as one solid", async () => {
    const { ready } = await import("@/font/boolean");
    const { piecesOf } = await import("./cut");
    const { proof } = await import("./document");
    const { anyEffect } = await import("@/font/effects");
    await ready();

    const marked = STARTING_POINTS.filter(
      (one) => one.effects && anyEffect(one.effects) && !one.effects.skip.on);
    expect(marked.length).toBeGreaterThan(0);

    const apart: string[] = [];
    for (const style of marked) {
      const forge = startFrom(style);
      for (const name of solid) {
        const drawn = proof(name, forge);
        if (!drawn || drawn.contours.length === 0) continue;
        if (piecesOf(drawn.contours) > 1) apart.push(`${style.name} ${name}`);
      }
    }
    expect(apart).toEqual([]);

    /*
     * And the other end of the same rule. What keeps a letter in one piece is a
     * sweep that drops any speck the tools shed, and a sweep is one threshold
     * away from taking the dot off an `i`. The test above cannot see that -- it
     * excludes the two letters that are meant to be in two pieces -- so it is
     * asked here.
     */
    for (const style of marked) {
      const forge = startFrom(style);
      for (const name of ["i", "j"]) {
        const drawn = proof(name, forge)!;
        expect([style.name, name, piecesOf(drawn.contours)]).toEqual([style.name, name, 2]);
      }
    }
  }, 180_000);

  it("keeps the ink it was handed when a drawing is fused", async () => {
    /*
     * The other way a drawing can fail, and the quieter one.
     *
     * Counting pieces cannot see a letter that is not there. A union that came
     * back holding one contour of no area is one piece by any count, and the w
     * of the Brush face was exactly that: blank on the page, blank in the
     * exported file, and reported as being in one piece the whole time. Nor is
     * it always all of the ink -- the A of the Wavy face kept one and a half
     * per cent of its own and read as two crumbs, which counts as one piece
     * just as happily.
     *
     * So what is asserted is the ink, against the ink the fuse was handed.
     * Some loss is honest, because the shapes overlap and the overlaps go in
     * counted twice; across the 3,136 drawings the sixteen faces make, the
     * leanest keeps 55% of what it was given and three quarters keep 89% or
     * more. Two fifths is below every one of those and well above the
     * eighteen that were failing, seventeen of which kept a sixth or less.
     *
     * Every drawing, not only the fifty-two letters. Most of what was being
     * lost was not a letter: Wavy's A, AE, V and x went, and with them every
     * accented A built on them, along with Flared's accented E and Brush's p
     * and accented y.
     */
    const { ready, unite } = await import("@/font/boolean");
    await ready();

    const lost: string[] = [];
    for (const style of STARTING_POINTS) {
      for (const name of letterNames()) {
        const drawn = drawLetter(name, style);
        if (!drawn || drawn.contours.length === 0) continue;
        const handed = Math.abs(drawn.contours.reduce((total, one) => total + contourArea(one), 0));
        if (handed <= 0) continue;
        // Measured after the fuse, which is where it goes missing and is what
        // the cut layer and the export both work from. On the canvas the loose
        // strokes still fill, so the drawing looked right until it was cut.
        const fused = unite(drawn.contours, "winding", "whole");
        const kept = Math.abs(fused.reduce((total, one) => total + contourArea(one), 0));
        if (kept < handed * 0.4) lost.push(`${style.name} ${name}`);
      }
    }
    expect(lost).toEqual([]);
  }, 120_000);
});

describe("a round cap does not eat the run it sits on", () => {
  /*
   * The cap reaches half the pen, and half the pen at the Black is wider than
   * some of the runs it is put on the end of. Pulled back that far the run has
   * no length left, and a run of no length is not a shorter run: its two ends
   * are the same point, so `stitch` welds them into one node and the letter
   * comes back with fewer nodes than the same letter at a lighter weight.
   *
   * The Display bracket is the case it was found on. Its arms are `arch * 0.52`
   * and that grows with the pen -- 133 units at the Thin and 153 at the Black --
   * but after the cap had been taken off them they measured 112, 53, 0 and 0,
   * and the letter had 18 nodes at the Thin and the Regular and 10 at the Bold
   * and the Black. Six of the Display's twenty standing letters were this.
   */
  const WEIGHTS = [100, 400, 700, 900];
  /*
   * Weighted the way the family is weighted, not by scaling the pen here.
   *
   * A first version of this scaled `pen.weight` on its own, and it passed with
   * the fault still in: the arms only vanish once every measurement the arch is
   * built from has moved with the pen, which is what `weighted` does and a
   * scaled pen does not. A test that reproduces most of the setup reproduces
   * none of the bug.
   */
  const styleAt = (base: Style, weight: number): Style =>
    weighted({ ...startFrom(base), family: { drawn: 400, also: WEIGHTS } }, weight).style;

  it("leaves the Display bracket the same letter at every weight", () => {
    const counts = WEIGHTS.map((weight) => {
      const drawn = drawLetter("bracketleft", styleAt(DISPLAY, weight));
      return drawn ? drawn.contours.reduce((sum, one) => sum + one.nodes.length, 0) : 0;
    });
    expect(counts.every((one) => one > 0)).toBe(true);
    expect(new Set(counts).size, `bracketleft has ${counts.join(", ")} nodes across the axis`).toBe(
      1,
    );
  });

  /*
   * And the invariant behind it, asked of every letter on every face rather
   * than of the one that happened to show it: a straight run that a recipe put
   * there still goes somewhere after the caps have been taken off it. Nothing
   * is said about how much is left, only that a run the letter asked for has
   * not been taken away entirely.
   */
  it("never takes a straight run down to nothing, on any face at any weight", () => {
    const gone: string[] = [];
    for (const base of STARTING_POINTS) {
      for (const weight of WEIGHTS) {
        const style = styleAt(base, weight);
        for (const name of letterNames()) {
          const recipe = recipeOf(name);
          if (!recipe) continue;
          for (const stroke of recipe(style).strokes) {
            const lines = stroke.spine.segments.filter((one) => one.kind === "line");
            // A bowl carries pieces its shape does not reach on purpose, and
            // those are meant to stand still. Only a run that is the whole of
            // its stroke is asked about, which is the shape a cap sits on.
            if (stroke.spine.closed || lines.length !== stroke.spine.segments.length) continue;
            for (const line of lines) {
              if (line.kind !== "line") continue;
              const span = Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y);
              if (span < 1e-6) gone.push(`${base.name} ${name} at ${weight}`);
            }
          }
        }
      }
    }
    expect([...new Set(gone)]).toEqual([]);
  }, 120_000);
});

describe("an arc that goes nowhere still lands where its neighbours are", () => {
  /*
   * The line case in `offsetSegment` says it outright -- a run of no length has
   * no tangent of its own and takes its neighbours' -- and the arc case did
   * not. It read its own centre and angles, which for a piece that never
   * travels are arithmetic about a turn that does not happen, and the offset
   * landed wherever that put it rather than on the point its neighbours had
   * arrived at. A piece whose ends do not meet its neighbours' is a piece
   * `stitch` cannot weld, so it keeps both nodes where the same piece at
   * another weight keeps one.
   *
   * The Display figures are the case it was found on. The `two`'s bend is nine
   * pieces at every weight and two of them turn through nothing at the Thin and
   * through five and nineteen degrees everywhere else, so the bend came back
   * with 25 nodes at the Thin and 21 at the other three. Fourteen of the
   * Display's letters were this.
   */
  const WEIGHTS = [100, 400, 700, 900];
  const styleAt = (base: Style, weight: number): Style =>
    weighted({ ...startFrom(base), family: { drawn: 400, also: WEIGHTS } }, weight).style;

  /*
   * The Psychedelic's five, which are the same fault in a shape rather than in
   * a piece: a ball is refused where a run arrives straight and its ink has
   * already reached one of the letter's lines, and both of those move with the
   * pen. The drawn weight decides now and the others follow -- so these have to
   * be asked with the book open, like the figures below.
   */
  it("keeps the Psychedelic's balls on the axis", () => {
    const adrift: string[] = [];
    const book: WaveBook = { lengths: new Map(), bowls: new Map(), balls: new Map(), corners: new Map(), recording: true };
    const was = openWaveBook(book);
    const face = STARTING_POINTS.find((one) => one.name === "Psychedelic")!;
    try {
      // Named by their characters, which is what the engine calls them: there
      // is no `Omega` in `letterNames()` and a list of names that are not names
      // is a test that passes without asking anything.
      for (const name of ["Ω", "Ώ", "δ", "ζ", "Ґ", "C", "S", "s"]) {
        book.recording = true;
        waveBookAt(name);
        drawLetter(name, styleAt(face, 400));
        book.recording = false;
        const counts = WEIGHTS.map((weight) => {
          waveBookAt(name);
          const drawn = drawLetter(name, styleAt(face, weight));
          return drawn ? drawn.contours.reduce((sum, one) => sum + one.nodes.length, 0) : 0;
        });
        book.lengths.clear();
        book.bowls.clear();
        book.balls.clear();
        // Every one of these is drawn on this face, so a zero is a name that
        // is not a name rather than a letter with nothing in it.
        expect(counts.every((one) => one > 0), `${name} draws nothing`).toBe(true);
        if (new Set(counts).size !== 1) adrift.push(`${name}: ${counts.join(", ")}`);
      }
    } finally {
      openWaveBook(was);
    }
    expect(adrift).toEqual([]);
  }, 60_000);

  /*
   * The Technical `section`, which is the bowl book's give-up rather than a
   * shape or a piece: it asks to give up three pens of one run to begin its
   * list where the drawn weight began, and the bound refused it at two.
   *
   * Named rather than counted because it is the only pinning in the font that
   * the bound has ever refused -- 8,924 of them across the sixteen faces and
   * four weights, and this is the one. A ceiling on the Technical would go on
   * passing if the bound were tightened again and something else gave way.
   */
  it("pins the Technical section rather than refusing it", () => {
    const book: WaveBook = { lengths: new Map(), bowls: new Map(), balls: new Map(), corners: new Map(), recording: true };
    const was = openWaveBook(book);
    const face = STARTING_POINTS.find((one) => one.name === "Technical")!;
    try {
      waveBookAt("section");
      drawLetter("section", styleAt(face, 400));
      book.recording = false;
      const flags = WEIGHTS.map((weight) => {
        waveBookAt("section");
        const drawn = drawLetter("section", styleAt(face, weight));
        return (drawn?.contours ?? [])
          .map((one) => one.nodes.map((node) => (node.type === "smooth" ? "s" : "c")).join(""))
          .join("|");
      });
      expect(flags.every((one) => one.length > 0), "section draws nothing").toBe(true);
      expect(new Set(flags).size, `section is drawn ${new Set(flags).size} different ways`).toBe(1);
    } finally {
      openWaveBook(was);
    }
  });

  /*
   * The Marker's `braceright`, which is the corner itself rather than a shape
   * or a piece or a bound: a corner brought to a point ends both offsets on one
   * spot and `stitch` welds them into one node, and a corner filled with a
   * wedge leaves them a pen apart and keeps both. It came to a point at the
   * Regular and was filled at the Black, and came back with 141 nodes at both
   * and the corners in different places.
   */
  it("keeps the Marker braceright's corners in the same places at every weight", () => {
    const book: WaveBook = {
      lengths: new Map(), bowls: new Map(), balls: new Map(), corners: new Map(), recording: true,
    };
    const was = openWaveBook(book);
    const face = STARTING_POINTS.find((one) => one.name === "Marker")!;
    try {
      waveBookAt("braceright");
      drawLetter("braceright", styleAt(face, 400));
      book.recording = false;
      const drawn = WEIGHTS.map((weight) => {
        waveBookAt("braceright");
        const one = drawLetter("braceright", styleAt(face, weight));
        return (one?.contours ?? [])
          .map((c) => c.nodes.map((n) => (n.type === "smooth" ? "s" : "c")).join(""))
          .join("|");
      });
      expect(drawn.every((one) => one.length > 0), "braceright draws nothing").toBe(true);
      expect(new Set(drawn).size, `braceright is drawn ${new Set(drawn).size} different ways`).toBe(1);
    } finally {
      openWaveBook(was);
    }
  });

  it.each(["two", "three", "onehalf", "threequarters", "copyright", "ae", "C"])(
    "leaves the Display %s the same letter at every weight",
    (name) => {
      const counts = WEIGHTS.map((weight) => {
        const drawn = drawLetter(name, styleAt(DISPLAY, weight));
        return drawn ? drawn.contours.reduce((sum, one) => sum + one.nodes.length, 0) : 0;
      });
      expect(counts.every((one) => one > 0)).toBe(true);
      expect(new Set(counts).size, `${name} has ${counts.join(", ")} nodes across the axis`).toBe(1);
    },
  );

  /*
   * And the invariant behind it, asked of every face: a piece that turns
   * through nothing is offset onto the run it sits in, so the two ends it
   * contributes are the ends its neighbours already have. Said as node counts,
   * because that is what the axis actually joins on, and asked of the letters
   * that carry a bend rather than of all of them, which is seconds rather than
   * minutes.
   *
   * With the wave book open and read back, which is the only way to ask it.
   * A first version of this drew the letters bare and the Wavy `at` came back
   * 52, 52, 52, 62 -- a face the delivered font leaves nothing standing on.
   * How many humps a run carries is settled once at the drawn weight and read
   * back by the others, so a letter drawn without the book is a letter nobody
   * ships, and a test that asks about one is asking about nothing.
   */
  it("keeps the figures on the axis on every face", () => {
    const adrift: string[] = [];
    const book: WaveBook = { lengths: new Map(), bowls: new Map(), balls: new Map(), corners: new Map(), recording: true };
    const was = openWaveBook(book);
    try {
      for (const base of STARTING_POINTS) {
        for (const name of ["two", "three", "five", "six", "nine", "copyright", "at"]) {
          // Recorded at the drawn weight first, exactly as `deliver` does it.
          book.recording = true;
          waveBookAt(name);
          drawLetter(name, styleAt(base, 400));
          book.recording = false;
          const counts = WEIGHTS.map((weight) => {
            waveBookAt(name);
            const drawn = drawLetter(name, styleAt(base, weight));
            return drawn ? drawn.contours.reduce((sum, one) => sum + one.nodes.length, 0) : 0;
          });
          book.lengths.clear();
          book.bowls.clear();
          if (new Set(counts).size !== 1) adrift.push(`${base.name} ${name}: ${counts.join(", ")}`);
        }
      }
    } finally {
      openWaveBook(was);
    }
    expect(adrift).toEqual([]);
  }, 120_000);
});

/*
 * The two letters this file's own header records a sheet catching once, and
 * what the sheet was actually looking at both times.
 */
describe("an f is not a t, and a k is not a fan", () => {
  /*
   * Everything that tells an f from a t is above the bar, and it is on the
   * right: the hook is the whole of the difference and there is no Latin face
   * anywhere that puts it on the other side. Curling left, every scrap of ink
   * above the bar sat where a t has nothing and none of it sat where an f is
   * known, and `fox` set as `tox` on all sixteen faces. Narrowing the bar was
   * the answer once; this is the answer.
   */
  it("hooks the f to the right of its own stem, in both forms, on every face", () => {
    const wrongWay: string[] = [];
    for (const style of STARTING_POINTS) {
      for (const form of [undefined, "descending"]) {
        const runs = recipeOf("f", form)!(style).strokes;
        // The run that reaches the ascender is the one with the hook on it.
        const hooked = runs.reduce((best, one) =>
          Math.max(spineStart(one.spine).y, spineEnd(one.spine).y) >
          Math.max(spineStart(best.spine).y, spineEnd(best.spine).y) ? one : best);
        const ends = [spineStart(hooked.spine), spineEnd(hooked.spine)];
        const [low, high] = ends[0].y < ends[1].y ? ends : [ends[1], ends[0]];
        if (high.x - low.x <= style.pen.weight / 2) {
          wrongWay.push(`${style.name} f${form ? ` (${form})` : ""}`);
        }
      }
    }
    expect(wrongWay).toEqual([]);
  });

  /*
   * The lead-out leaves from the letter's rightmost run between half a pen up
   * and the seam, which on a straight-legged k is partway up the leg -- so the
   * rest of the leg carried on past it, out and down, and the letter finished
   * with its arm, its join and the tip of its leg all leaving one corner
   * pointing the same way. A leg that turns upright before it lands is the
   * rightmost thing down there itself, and the join leaves its side the way it
   * leaves an n's.
   */
  it("stands the joined k's leg up, so nothing reaches out past where the join leaves", () => {
    const bare = (one: Style): Style =>
      ({ ...one, parts: { ...one.parts, script: { ...one.parts.script, on: false } } });
    const rightAt = (drawn: NonNullable<ReturnType<typeof drawLetter>>, y: number) =>
      Math.max(...inkRunsAt(drawn.contours, y).map(([, to]) => to));

    const joined = STARTING_POINTS.filter((one) => one.parts.script.on);
    /*
     * A floor rather than a census.
     *
     * What this guards against is the filter quietly coming back empty, which
     * would leave the loop below checking nothing and the test passing anyway.
     * It was written as an exact four and that made every new joined face a
     * failing test in a file about the `k` -- the wrong place to find out, and
     * the wrong thing to have to edit. Each face is checked by the loop, so
     * however many there are is right; that there are none is not.
     */
    expect(joined.length).toBeGreaterThanOrEqual(4);
    for (const style of joined) {
      const half = style.pen.weight / 2;
      const seam = seamsOf(style.parts.script, style.metrics.xHeight, style.pen.weight / 2).low;
      // The band the lead-out searches, and the point in it that it leaves from.
      const bandMax = (drawn: NonNullable<ReturnType<typeof drawLetter>>) =>
        Math.max(...Array.from({ length: 9 }, (_, step) =>
          rightAt(drawn, half + ((seam - half) * step) / 8)));
      // Just off the baseline, which is under the band and is where a straight
      // leg is at its widest.
      const under = half * 0.2;
      const standing = drawLetter("k", bare(style), "standing")!;
      const splayed = drawLetter("k", bare(style))!;
      expect([style.name, rightAt(standing, under) <= bandMax(standing) + half * 0.2])
        .toEqual([style.name, true]);
      // And the straight leg does reach past it, which is why the alternate is
      // here at all: without this the test above would pass on any k.
      expect([style.name, rightAt(splayed, under) > bandMax(splayed) + half * 0.2])
        .toEqual([style.name, true]);
    }
  });

  /*
   * And that the vee actually reaches the stem, at every weight and not only at
   * the one the face is drawn at.
   *
   * `junction` puts the apex inside the stem, and used to check its work on the
   * vertex `through` hands back -- which is the point before the corner is
   * rounded off. On a face that rounds its corners that point is not where the
   * ink goes: the Formal Script's vertex sat 2 units inside its limit while the
   * arc `roundCorners` put in its place was drawn 62 units outside it, and the
   * two strokes were left overlapping by about twenty units of ink and nothing
   * else. That is enough to look like a k, which is why it shipped, and it went
   * the moment the pen went from 96 units to 120.
   *
   * So this asks at seven weights across the axis rather than at the one each
   * face happens to be drawn at. Every other test of the letters draws each
   * face at its own weight, and the fault was invisible to all of them.
   */
  it("meets the k's vee to its stem at every weight, on every face", async () => {
    const { ready } = await import("@/font/boolean");
    const { piecesOf } = await import("./cut");
    await ready();
    const apart: string[] = [];
    for (const base of STARTING_POINTS) {
      for (const weight of [40, 60, 84, 110, 140, 175, 210]) {
        const style: Style = { ...base, pen: { ...base.pen, weight } };
        for (const name of ["k", "K"]) {
          for (const { id } of everyFormOf(name)) {
            const drawn = drawLetter(name, style, id || undefined);
            if (!drawn || drawn.contours.length === 0) continue;
            if (piecesOf(drawn.contours) > 1) {
              apart.push(`${base.name} ${name}${id ? ` (${id})` : ""} at ${weight}`);
            }
          }
        }
      }
    }
    expect(apart).toEqual([]);
  }, 60_000);
});
