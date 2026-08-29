/**
 * That the second engine draws what it says it draws.
 *
 * Three things are worth pinning here and they are different in kind.
 *
 * The sweep has closed-form answers to check against: a straight stroke of one
 * width is a rectangle and its size is arithmetic, an arc of one width has an
 * outer and an inner radius that are the spine's plus and minus a half. Those
 * are checked exactly rather than approximately, because the exact path is the
 * whole of what this engine keeps from the forge and a fitted answer that
 * happens to be close would hide its loss.
 *
 * The fitter has no closed form to check against -- what it recovers is a guess
 * about strokes from a filled shape -- so it is checked the only way that
 * means anything: draw something with known strokes, throw the strokes away,
 * read them back from the ink, and see whether what comes back redraws the same
 * ink. A fitter that returns beautiful strokes which redraw a different letter
 * is worthless, and this is the test that would catch it.
 *
 * The controls are checked for doing anything at all, for the same reason the
 * forge checks its own: a slider that is offered and read by nothing looks
 * exactly like one that works until somebody drags it.
 */

import { describe, expect, it } from "vitest";

import { contoursBounds, flattenContour } from "@/font/geometry";
import { PLAIN_HAND, QUILL_CONTROLS, restyle, restyleWidth, type QuillStyle } from "./controls";
import { furthestFrom } from "./curve";
import { fitGlyph } from "./fit";
import { isConstant, isExact, reachAcross, sweep, sweepAll, widthAt, widthLimit } from "./sweep";
import { looksJoined } from "./joined";
import { ROUND_NIB, type QuillStroke } from "./types";
import type { Glyph, GlyphNode, Typeface } from "@/font/types";

const straight = (from: [number, number], to: [number, number]) => ({
  segments: [{ kind: "line" as const, from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] } }],
  closed: false,
});

const plainStroke = (width: number): QuillStroke => ({
  spine: straight([0, 0], [0, 500]),
  width: [{ at: 0, width }],
  nib: { ...ROUND_NIB },
  start: { kind: "butt" },
  end: { kind: "butt" },
});

describe("the sweep", () => {
  it("draws a straight stroke of one width as its own rectangle", () => {
    const drawn = sweep(plainStroke(100));
    const box = contoursBounds(drawn.contours);
    expect(box.xMax - box.xMin).toBeCloseTo(100, 6);
    expect(box.yMax - box.yMin).toBeCloseTo(500, 6);
  });

  it("says so when it could have been exact", () => {
    expect(sweep(plainStroke(100)).exactness).toEqual({ exact: true, deviation: 0 });
  });

  it("draws an arc of one width between the right two radii", () => {
    const drawn = sweep({
      ...plainStroke(60),
      spine: {
        segments: [
          {
            kind: "arc",
            centre: { x: 0, y: 0 },
            radius: 200,
            startAngle: 0,
            endAngle: Math.PI,
            sweepPositive: true,
          },
        ],
        closed: false,
      },
    });
    const box = contoursBounds(drawn.contours);
    /*
     * Outer radius 230 either side, and 230 tall.
     *
     * To within a hundredth of a unit rather than exactly, and the difference
     * is worth naming because `exact` is claimed a few lines below. What is
     * exact is the *offset*: the outer edge of this stroke is a circle of
     * radius 230 about the same centre, worked out rather than sampled, so it
     * cannot fold and does not drift as the weight changes. Writing that circle
     * down as the cubics a font file holds is a separate approximation that
     * every font makes, and it is the three thousandths of a unit seen here.
     */
    expect(box.xMax - box.xMin).toBeCloseTo(460, 2);
    expect(box.yMax - box.yMin).toBeCloseTo(230, 2);
  });

  it("owns up to being fitted where it cannot be exact", () => {
    const curved: QuillStroke = {
      ...plainStroke(40),
      spine: {
        segments: [
          {
            kind: "cubic",
            from: { x: 0, y: 0 },
            c1: { x: 100, y: 0 },
            c2: { x: 200, y: 100 },
            to: { x: 200, y: 300 },
          },
        ],
        closed: false,
      },
    };
    const drawn = sweep(curved);
    expect(drawn.exactness.exact).toBe(false);
    // Fitted, but fitted well: inside the tolerance it was asked for.
    expect(drawn.exactness.deviation).toBeLessThan(0.5);
  });

  it("a varying width is never exact, however simple the spine", () => {
    expect(isExact({ ...plainStroke(100), width: [{ at: 0, width: 100 }, { at: 1, width: 20 }] })).toBe(
      false,
    );
    expect(isExact(plainStroke(100))).toBe(true);
  });

  /*
   * The one way a stroke can go wrong, reported rather than repaired.
   *
   * A stroke bending through a radius R cannot be wider than 2R without its
   * inner edge passing through itself. The forge checks this on arcs, where the
   * radius is a field; here it has to be found on cubics too, by their
   * curvature, which is one more thing a free-form spine costs.
   */
  it("knows how wide a turn can be drawn before it folds", () => {
    expect(
      widthLimit({
        segments: [
          {
            kind: "arc",
            centre: { x: 0, y: 0 },
            radius: 200,
            startAngle: 0,
            endAngle: Math.PI,
            sweepPositive: true,
          },
        ],
        closed: false,
      }),
    ).toBeCloseTo(400, 6);
    expect(widthLimit(straight([0, 0], [0, 500]))).toBe(Infinity);
  });

  it("reads a width profile as the profile says", () => {
    const profile = [
      { at: 0, width: 100 },
      { at: 1, width: 0 },
    ];
    expect(widthAt(profile, 0)).toBe(100);
    expect(widthAt(profile, 1)).toBe(0);
    expect(widthAt(profile, 0.5)).toBeCloseTo(50, 6);
    // Held rather than extrapolated outside the outermost stops.
    expect(widthAt([{ at: 0.3, width: 42 }], 0)).toBe(42);
    expect(isConstant([{ at: 0, width: 9 }, { at: 1, width: 9 }])).toBe(true);
  });

  /*
   * The nib, which is the part of the width that is *not* pressure.
   *
   * A pen narrowed across one axis reaches its full half-width across a stroke
   * running along that axis and its narrowed one across a stroke running the
   * other way. Both are checked, because a nib that thinned everything equally
   * would pass a test of either one alone and would be a smaller pen rather
   * than a broad-edged one.
   */
  it("gives a broad-edged pen its thick and its thin", () => {
    const nib = { contrast: 0.5, angle: 0 };
    expect(reachAcross({ x: 0, y: 1 }, 50, nib)).toBeCloseTo(50, 6);
    expect(reachAcross({ x: 1, y: 0 }, 50, nib)).toBeCloseTo(25, 6);
    // With no contrast the pen is a circle and the heading cannot matter.
    expect(reachAcross({ x: 1, y: 0 }, 50, ROUND_NIB)).toBeCloseTo(50, 6);
    expect(reachAcross({ x: 0.6, y: 0.8 }, 50, ROUND_NIB)).toBeCloseTo(50, 6);
  });
});

describe("the fitter", () => {
  /*
   * Round-tripping, which is the only honest way to test a guess.
   *
   * A shape is drawn from strokes that are known, the strokes are thrown away,
   * and the fitter is asked to find them again in the ink. What is compared is
   * not the strokes it returns -- more than one set of strokes fills the same
   * area, and there is no single right answer to check against -- but the ink
   * they redraw, which does have a right answer.
   */
  const roundTrip = (strokes: QuillStroke[], tolerance: number) => {
    const drawn = sweepAll(strokes);
    const fit = fitGlyph("test", drawn.contours, 600, {});
    expect(fit, "the fitter found nothing to read").not.toBeNull();
    const again = sweepAll(fit!.glyph.strokes);
    const before = drawn.contours.flatMap((one) => flattenContour(one, 40));
    const after = again.contours.flatMap((one) => flattenContour(one, 40));
    expect(after.length, "redrew nothing").toBeGreaterThan(0);
    const off = Math.max(furthestFrom(before, after), furthestFrom(after, before));
    expect(off, `redrew ${off.toFixed(1)} units off`).toBeLessThan(tolerance);
    return fit!;
  };

  it("reads back a straight stroke cut square at both ends", () => {
    /*
     * Tight, because this is the case the ink can settle completely: the
     * skeleton is a straight line, the width is one number, and both ends are
     * square. Before the caps were read off the ink this redrew forty-four and
     * a half units off -- half the stroke's width, at every corner -- because
     * a square end and a round one leave the same skeleton and it had assumed
     * round.
     */
    const fit = roundTrip([plainStroke(90)], 3);
    expect(fit.glyph.strokes.length).toBe(1);
    expect(fit.glyph.strokes[0].start.kind).toBe("butt");
    expect(fit.glyph.strokes[0].end.kind).toBe("butt");
  });

  it("reads back a stroke rounded off at both ends", () => {
    /*
     * Looser than the square case, and the reason is the thinning rather than
     * the fitting: a rounded end is worn back a few units further than its true
     * medial point, so the redrawn disc sits slightly inside the original. Half
     * a dozen units on a stroke ninety wide.
     */
    const round: QuillStroke = { ...plainStroke(90), start: { kind: "round" }, end: { kind: "round" } };
    const fit = roundTrip([round], 8);
    expect(fit.glyph.strokes[0].start.kind).toBe("round");
  });

  it("reads back the swelling of a stroke that varies", () => {
    const tapered: QuillStroke = {
      ...plainStroke(0),
      width: [
        { at: 0, width: 30 },
        { at: 0.5, width: 110 },
        { at: 1, width: 30 },
      ],
    };
    const fit = roundTrip([tapered], 10);
    const profile = fit.glyph.strokes[0].width;
    // Wider in the middle than at either end, which is the whole point.
    const middle = widthAt(profile, 0.5);
    expect(middle).toBeGreaterThan(widthAt(profile, 0.05) + 20);
    expect(middle).toBeGreaterThan(widthAt(profile, 0.95) + 20);
    expect(middle).toBeGreaterThan(80);
  });

  it("keeps a mark that stands on its own rather than pruning it", () => {
    /*
     * The dot of an `i`, which is short and has two free ends and is therefore
     * exactly what the spur rule was written to throw away. It survives because
     * it is the whole of its own piece of skeleton, and a piece with nothing
     * attached is a mark rather than a whisker. Both dots were being lost
     * before that distinction was drawn.
     */
    const stem = plainStroke(70);
    const dot: QuillStroke = {
      spine: straight([0, 640], [0, 660]),
      width: [{ at: 0, width: 70 }],
      nib: { ...ROUND_NIB },
      start: { kind: "round" },
      end: { kind: "round" },
    };
    const drawn = sweepAll([stem, dot]);
    const fit = fitGlyph("i", drawn.contours, 300, {})!;
    expect(fit).not.toBeNull();
    const high = fit.glyph.strokes.filter((one) =>
      one.spine.segments.some((segment) => segment.kind === "cubic" && segment.from.y > 600),
    );
    expect(high.length, "the dot was pruned away").toBeGreaterThan(0);
  });

  it("does not cut a plain stroke into pieces", () => {
    // The failure this guards against produced six hundred and sixty strokes
    // for one letter, every one of them redrawing correctly.
    const fit = fitGlyph("bar", sweepAll([plainStroke(80)]).contours, 300, {})!;
    expect(fit.glyph.strokes.length).toBeLessThanOrEqual(2);
  });
});

describe("the hand", () => {
  const stroke = (): QuillStroke => ({
    ...plainStroke(0),
    width: [
      { at: 0, width: 40 },
      { at: 0.5, width: 100 },
      { at: 1, width: 40 },
    ],
  });

  it("weight scales the whole profile and leaves its shape", () => {
    const before = stroke().width;
    const after = restyleWidth(before, { ...PLAIN_HAND, weight: 2 });
    expect(widthAt(after, 0.5)).toBeCloseTo(widthAt(before, 0.5) * 2, 6);
    expect(widthAt(after, 0)).toBeCloseTo(widthAt(before, 0) * 2, 6);
  });

  it("pressure changes the swelling without moving the weight", () => {
    const before = stroke().width;
    const flat = restyleWidth(before, { ...PLAIN_HAND, pressure: 0 });
    // Flattened to one width all the way along, which is a monoline.
    expect(widthAt(flat, 0)).toBeCloseTo(widthAt(flat, 0.5), 6);
    expect(widthAt(flat, 0.5)).toBeCloseTo(widthAt(flat, 1), 6);
    // And the average is where it was: pressure is about the variation.
    const mean = (one: typeof before) => one.reduce((s, x) => s + x.width, 0) / one.length;
    expect(mean(flat)).toBeCloseTo(mean(before), 6);

    const more = restyleWidth(before, { ...PLAIN_HAND, pressure: 2 });
    expect(widthAt(more, 0.5)).toBeGreaterThan(widthAt(before, 0.5));
    expect(widthAt(more, 0)).toBeLessThan(widthAt(before, 0));
  });

  it("taper runs the ends out and leaves the middle", () => {
    const after = restyleWidth(stroke().width, { ...PLAIN_HAND, taper: 1 });
    expect(widthAt(after, 0)).toBeCloseTo(0, 6);
    expect(widthAt(after, 1)).toBeCloseTo(0, 6);
    expect(widthAt(after, 0.5)).toBeGreaterThan(90);
  });

  it("slant leans the letter and keeps the baseline where it was", () => {
    const glyph = { name: "l", advanceWidth: 300, strokes: [plainStroke(80)], unitsPerEm: 1000 };
    const leaned = restyle(glyph, { ...PLAIN_HAND, slant: 20 });
    const before = contoursBounds(sweepAll(glyph.strokes).contours);
    const after = contoursBounds(sweepAll(leaned.strokes).contours);
    /*
     * The shear leaves every point's height alone, so the *spine* stays between
     * the same two lines. The ink does not quite: a square cut is square to the
     * stroke, and on a stroke that now leans, its two corners sit a little
     * above and below where they were. Bounded by half the width, which is as
     * far as a corner can be from the end of the spine it belongs to.
     */
    const half = 40;
    expect(Math.abs(after.yMin - before.yMin)).toBeLessThanOrEqual(half);
    expect(Math.abs(after.yMax - before.yMax)).toBeLessThanOrEqual(half);
    // Leaning to the right moves the top of the stroke to the right.
    expect(after.xMax).toBeGreaterThan(before.xMax + 100);
  });

  it("tracking moves the room and not the strokes", () => {
    const glyph = { name: "n", advanceWidth: 400, strokes: [plainStroke(80)], unitsPerEm: 1000 };
    const wider = restyle(glyph, { ...PLAIN_HAND, tracking: 1.5 });
    expect(wider.advanceWidth).toBeCloseTo(600, 6);
    expect(contoursBounds(sweepAll(wider.strokes).contours)).toEqual(
      contoursBounds(sweepAll(glyph.strokes).contours),
    );
  });

  it("bounce lifts a letter off the line without changing its shape", () => {
    /*
     * `l` rather than any letter, because how far a letter moves is its own
     * business: the lift comes from the letter's name and some name has to come
     * out near the middle. `e` does -- it lifts by seven tenths of a unit at
     * full bounce -- which is correct behaviour and useless for asking whether
     * the letter moved at all. `l` sits near the top of the scatter.
     */
    const glyph = { name: "l", advanceWidth: 400, strokes: [plainStroke(80)], unitsPerEm: 1000 };
    const level = contoursBounds(sweepAll(restyle(glyph, PLAIN_HAND).strokes).contours);
    const lifted = contoursBounds(
      sweepAll(restyle(glyph, { ...PLAIN_HAND, bounce: 1 }).strokes).contours,
    );

    // It moved, and only up or down.
    expect(Math.abs(lifted.yMin - level.yMin)).toBeGreaterThan(1);
    expect(lifted.xMin).toBeCloseTo(level.xMin, 6);
    expect(lifted.xMax).toBeCloseTo(level.xMax, 6);
    // The letter is the same letter: it was carried, not stretched.
    expect(lifted.yMax - lifted.yMin).toBeCloseTo(level.yMax - level.yMin, 6);
    // And it takes up no more room across than it did on the line.
    expect(restyle(glyph, { ...PLAIN_HAND, bounce: 1 }).advanceWidth).toBeCloseTo(400, 6);
  });

  it("bounce sends different letters different ways", () => {
    /*
     * The whole of what bounce is for. A control that moved every letter by the
     * same amount would lower the line and leave the *spread* -- which is the
     * only part anybody sees -- exactly where it was, and would look like a
     * control at the end of its range. That is not a hypothetical: it is what
     * the forge's own bounce did for as long as its seed would not scatter.
     */
    const lifts = "abcdefghijklmnop".split("").map((name) => {
      const glyph = { name, advanceWidth: 400, strokes: [plainStroke(80)], unitsPerEm: 1000 };
      return contoursBounds(sweepAll(restyle(glyph, { ...PLAIN_HAND, bounce: 1 }).strokes).contours)
        .yMin;
    });
    const spread = Math.max(...lifts) - Math.min(...lifts);
    expect(spread).toBeGreaterThan(20);
    // As many above the line as below it, give or take one.
    const middle = (Math.max(...lifts) + Math.min(...lifts)) / 2;
    const above = lifts.filter((one) => one > middle).length;
    expect(above).toBeGreaterThan(2);
    expect(above).toBeLessThan(lifts.length - 2);
  });

  it("bounce keeps the same letter in the same place every time", () => {
    // A hand does not, and a font cannot: the same letter twice in a word has
    // to land twice in the same place or it could not be cached, compared with
    // itself, or exported.
    const of = (name: string) =>
      contoursBounds(
        sweepAll(
          restyle(
            { name, advanceWidth: 400, strokes: [plainStroke(80)], unitsPerEm: 1000 },
            { ...PLAIN_HAND, bounce: 1 },
          ).strokes,
        ).contours,
      ).yMin;
    expect(of("g")).toBe(of("g"));
  });

  it("bounce is measured against the em, not against the letter", () => {
    // The same slider on a 2048-unit font has to move a letter twice as far in
    // units and the same distance on the page. The em travels on the glyph for
    // exactly this reason.
    const small = { name: "q", advanceWidth: 400, strokes: [plainStroke(80)], unitsPerEm: 1000 };
    const large = { ...small, unitsPerEm: 2000 };
    const lift = (glyph: typeof small) =>
      contoursBounds(sweepAll(restyle(glyph, { ...PLAIN_HAND, bounce: 1 }).strokes).contours).yMin -
      contoursBounds(sweepAll(restyle(glyph, PLAIN_HAND).strokes).contours).yMin;
    expect(lift(large)).toBeCloseTo(lift(small) * 2, 4);
  });

  it("width stretches the letter and its advance together", () => {
    /*
     * Together is the whole point. A joined face that stretched its letters and
     * left the advance alone would put the exit stroke of one letter somewhere
     * the next letter's entry is not, and come apart at every join.
     */
    const glyph = { name: "n", advanceWidth: 400, strokes: [plainStroke(80)], unitsPerEm: 1000 };
    const wide = restyle(glyph, { ...PLAIN_HAND, width: 1.5 });
    expect(wide.advanceWidth).toBeCloseTo(600, 6);

    const across = (strokes: typeof glyph.strokes) => {
      const box = contoursBounds(sweepAll(strokes).contours);
      return box.xMax - box.xMin;
    };
    /*
     * The spine is stretched and the pen is not, so the ink is wider by the
     * stretch of the *skeleton* rather than by the whole box. On a single
     * upright stroke the skeleton has no width to stretch, so the ink stays
     * exactly as wide -- which is the property worth pinning: a width control
     * that thickened the strokes would be a distortion rather than a width.
     */
    expect(across(wide.strokes)).toBeCloseTo(across(glyph.strokes), 6);
  });

  it("width and tracking are different things and compose", () => {
    const glyph = { name: "n", advanceWidth: 400, strokes: [plainStroke(80)], unitsPerEm: 1000 };
    const both = restyle(glyph, { ...PLAIN_HAND, width: 1.25, tracking: 1.2 });
    expect(both.advanceWidth).toBeCloseTo(400 * 1.25 * 1.2, 6);
  });

  it("reach runs on the ends that join and leaves the rest alone", () => {
    /*
     * Two strokes in one letter: one that reaches the right-hand edge heading
     * out through it, and one wholly inside. Only the first is a join, and a
     * control that lengthened both would grow a spur out of the middle of every
     * letter it touched.
     */
    const joining: QuillStroke = {
      ...stroke(),
      spine: {
        segments: [
          { kind: "line", from: { x: 200, y: 100 }, to: { x: 398, y: 160 } },
        ],
        closed: false,
      },
    };
    const inside: QuillStroke = {
      ...stroke(),
      spine: {
        segments: [{ kind: "line", from: { x: 150, y: 0 }, to: { x: 150, y: 400 } }],
        closed: false,
      },
    };
    const glyph = { name: "n", advanceWidth: 400, strokes: [joining, inside], unitsPerEm: 1000 };

    const reached = restyle(glyph, { ...PLAIN_HAND, reach: 1 });
    // The joining stroke gained a segment; the one inside did not.
    expect(reached.strokes[0].spine.segments.length).toBeGreaterThan(1);
    expect(reached.strokes[1].spine.segments.length).toBe(1);
    // And the letter was given the room the join needed.
    expect(reached.advanceWidth).toBeGreaterThan(400);
    expect(restyle(glyph, PLAIN_HAND).advanceWidth).toBeCloseTo(400, 6);
  });

  it("reach reads a join by where it is going, not by which way it was traced", () => {
    /*
     * The fitter does not orient what it recovers, so the exit stroke of a
     * traced `u` is the one whose *start* sits at the right-hand edge while the
     * exit of a traced `n` is the one whose end does. Both are joins. A rule
     * that checked the start against the left edge and the end against the
     * right would quietly do nothing on half the alphabet -- which is what it
     * did, until the traced letters were printed and read.
     */
    const rightwards: QuillStroke = {
      ...stroke(),
      spine: {
        segments: [{ kind: "line", from: { x: 100, y: 100 }, to: { x: 399, y: 100 } }],
        closed: false,
      },
    };
    const drawnBackwards: QuillStroke = {
      ...stroke(),
      spine: {
        segments: [{ kind: "line", from: { x: 399, y: 100 }, to: { x: 100, y: 100 } }],
        closed: false,
      },
    };
    const style = { ...PLAIN_HAND, reach: 1 };
    const segmentsOf = (one: QuillStroke) =>
      restyle({ name: "o", advanceWidth: 400, strokes: [one], unitsPerEm: 1000 }, style).strokes[0]
        .spine.segments.length;
    expect(segmentsOf(rightwards)).toBe(2);
    expect(segmentsOf(drawnBackwards)).toBe(2);
  });

  it("reach leaves an end that reaches the edge and turns back", () => {
    /*
     * The case the edge test alone gets wrong. This stroke bulges out to the
     * right-hand edge and its end comes back inside -- the side of a bowl on a
     * tightly fitted face, not a join -- so its last stretch is travelling
     * *away* from the edge it is near. Run on regardless, it would grow a spur
     * out of the side of every round letter.
     */
    const bowl: QuillStroke = {
      ...stroke(),
      spine: {
        segments: [
          { kind: "line", from: { x: 300, y: 0 }, to: { x: 398, y: 200 } },
          { kind: "line", from: { x: 398, y: 200 }, to: { x: 382, y: 400 } },
        ],
        closed: false,
      },
    };
    const glyph = { name: "o", advanceWidth: 400, strokes: [bowl], unitsPerEm: 1000 };
    const reached = restyle(glyph, { ...PLAIN_HAND, reach: 1 });
    expect(reached.strokes[0].spine.segments.length).toBe(2);
    expect(reached.advanceWidth).toBeCloseTo(400, 6);
  });

  /*
   * The same rule the forge holds its own panel to: a control that is offered
   * and read by nothing looks exactly like one that works.
   */
  it("no control is decoration", () => {
    const glyph = {
      name: "test",
      advanceWidth: 400,
      unitsPerEm: 1000,
      strokes: [
        {
          ...stroke(),
          spine: {
            segments: [
              {
                kind: "cubic" as const,
                from: { x: 0, y: 0 },
                c1: { x: 120, y: 60 },
                c2: { x: 40, y: 300 },
                to: { x: 200, y: 420 },
              },
            ],
            closed: false,
          },
        },
      ],
    };
    const shapeOf = (style: QuillStyle) => {
      const drawn = sweepAll(restyle(glyph, style).strokes);
      const box = contoursBounds(drawn.contours);
      return `${box.xMin.toFixed(3)},${box.yMin.toFixed(3)},${box.xMax.toFixed(3)},${box.yMax.toFixed(3)}`;
    };
    const dead: string[] = [];
    for (const control of QUILL_CONTROLS) {
      /*
       * The nib angle is asked with contrast turned up, because it is which way
       * a narrowed pen is held and a round pen has no way to be held. Asked
       * against the plain hand it correctly does nothing, which would read as a
       * dead control and is the opposite of one.
       */
      const base =
        control.key === "nibAngle" ? { ...PLAIN_HAND, contrast: 0.6 } : PLAIN_HAND;
      /*
       * Three stops rather than two, because a nib is symmetrical.
       *
       * An ellipse held at minus ninety degrees is the same ellipse held at
       * plus ninety, so the two ends of that control produce identical ink and
       * a test that looked only at the ends would call it dead. It is not: it
       * does a great deal in between. Any two of the three differing is the
       * question worth asking.
       */
      const seen = new Set<string>();
      for (const value of [control.min, (control.min + control.max) / 2, control.max]) {
        const style = { ...base, [control.key]: value } as QuillStyle;
        seen.add(`${shapeOf(style)}|${restyle(glyph, style).advanceWidth.toFixed(4)}`);
      }
      if (seen.size < 2) dead.push(`${control.key} (${control.label})`);
    }
    expect(dead).toEqual([]);
  });

  it("every control starts inside its own range", () => {
    const outside: string[] = [];
    for (const control of QUILL_CONTROLS) {
      const value = (PLAIN_HAND as unknown as Record<string, number>)[control.key];
      expect(typeof value, `${control.key} has no starting value`).toBe("number");
      if (value < control.min || value > control.max) outside.push(control.key);
    }
    expect(outside).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Telling a joined script from a text face
// ---------------------------------------------------------------------------

/**
 * A rectangle of ink, as a glyph.
 *
 * Straight-sided on purpose. What the detector reads is where the ink stops
 * against the advance, so a box says that as plainly as a letter would and says
 * it without a drawing that would have to be trusted.
 */
function boxGlyph(name: string, advanceWidth: number, from: number, to: number): Glyph {
  const at = (x: number, y: number): GlyphNode => ({
    point: { x, y },
    handleIn: null,
    handleOut: null,
    type: "corner",
  });
  return {
    name,
    unicodes: [name.codePointAt(0)!],
    advanceWidth,
    contours: [{ nodes: [at(from, 0), at(to, 0), at(to, 500), at(from, 500)], closed: true }],
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

/** A font of those, with the fields the detector never looks at left empty. */
function fontOf(glyphs: Glyph[]): Typeface {
  return {
    meta: {
      familyName: "Test",
      styleName: "Regular",
      version: "1.000",
      weightClass: 400,
    } as Typeface["meta"],
    unitsPerEm: 1000,
    metrics: { ascender: 800, descender: -200, capHeight: 700, xHeight: 500, lineGap: 0 },
    glyphs,
    glyphIndex: new Map(glyphs.map((one, index) => [one.name, index])),
    kerning: [],
    kernClasses: [],
    alternates: [],
    params: {} as Typeface["params"],
    source: null,
  };
}

const LOWERCASE = "acehimnorsu".split("");

describe("telling a joined script from a text face", () => {
  it("calls a face with clear sidebearings a text face", () => {
    // Ink from 60 to 440 in an advance of 500: a tenth of the em clear on each
    // side, which is an ordinary text fit.
    const verdict = looksJoined(fontOf(LOWERCASE.map((one) => boxGlyph(one, 500, 60, 440))));
    expect(verdict.joined).toBe(false);
    expect(verdict.tested).toBe(LOWERCASE.length);
    expect(verdict.reaching).toBe(0);
    expect(verdict.sidebearing).toBeCloseTo(0.06, 5);
  });

  it("calls a face whose ink overhangs its advance a joined script", () => {
    // Ink from -20 to 520 in an advance of 500: the exit stroke runs past the
    // edge to meet the next letter, which is what joining is.
    const verdict = looksJoined(fontOf(LOWERCASE.map((one) => boxGlyph(one, 500, -20, 520))));
    expect(verdict.joined).toBe(true);
    expect(verdict.reaching).toBe(LOWERCASE.length);
    expect(verdict.sidebearing).toBeCloseTo(-0.02, 5);
  });

  it("is not fooled by one letter that happens to reach the edge", () => {
    /*
     * A text face with a single tight letter in it -- `r`, whose arm routinely
     * runs to the advance -- is still a text face. A detector triggered by any
     * one letter would send it to the tracer, so the rule is most of them.
     */
     const glyphs = LOWERCASE.map((one) =>
      one === "r" ? boxGlyph(one, 500, 60, 500) : boxGlyph(one, 500, 60, 440),
    );
    expect(looksJoined(fontOf(glyphs)).joined).toBe(false);
  });

  it("says no rather than guessing when there is too little to go on", () => {
    // Four letters is not an alphabet, and no is the answer that opens the font
    // where every font can already be opened.
    const verdict = looksJoined(fontOf(["a", "c", "e", "h"].map((one) => boxGlyph(one, 500, -20, 520))));
    expect(verdict.joined).toBe(false);
    expect(verdict.tested).toBe(0);
  });

  it("ignores letters that overhang for their own reasons", () => {
    /*
     * `f` and `j` in an italic, and a swung `y` tail, cross the advance in
     * faces that join nothing. They are not in the tested set, so a font whose
     * only overhangs are those reads as the text face it is.
     */
    const glyphs = [
      ...LOWERCASE.map((one) => boxGlyph(one, 500, 60, 440)),
      boxGlyph("f", 500, -60, 560),
      boxGlyph("j", 500, -60, 560),
      boxGlyph("y", 500, -60, 560),
    ];
    expect(looksJoined(fontOf(glyphs)).joined).toBe(false);
  });
});
