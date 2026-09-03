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

import { ready, unite } from "@/font/boolean";

import { contourArea, contoursBounds, flattenContour } from "@/font/geometry";
import {
  PLAIN_HAND,
  QUILL_CONTROLS,
  restyle,
  restyleWidth,
  type QuillStyle,
} from "./controls";
import { furthestFromPath } from "./curve";
import { fitGlyph } from "./fit";
import {
  isConstant,
  isExact,
  isOnePen,
  nibAt,
  reachAcross,
  sweep,
  sweepAll,
  widthAt,
  widthLimit,
} from "./sweep";
import { looksJoined } from "./joined";
import { drawTraced } from "@/state/quill-store";
import type { Traced } from "./tracing";
import { ROUND_NIB, type NibProfile, type QuillStroke } from "./types";
import type { Contour, Glyph, GlyphNode, Typeface } from "@/font/types";

const straight = (from: [number, number], to: [number, number]) => ({
  segments: [
    {
      kind: "line" as const,
      from: { x: from[0], y: from[1] },
      to: { x: to[0], y: to[1] },
    },
  ],
  closed: false,
});

const plainStroke = (width: number): QuillStroke => ({
  spine: straight([0, 0], [0, 500]),
  width: [{ at: 0, width }],
  nib: [{ ...ROUND_NIB, at: 0 }],
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
    expect(sweep(plainStroke(100)).exactness).toEqual({
      exact: true,
      deviation: 0,
    });
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
    expect(
      isExact({
        ...plainStroke(100),
        width: [
          { at: 0, width: 100 },
          { at: 1, width: 20 },
        ],
      }),
    ).toBe(false);
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
    expect(
      isConstant([
        { at: 0, width: 9 },
        { at: 1, width: 9 },
      ]),
    ).toBe(true);
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

  /*
   * And its thicks and thins in between the two axes, which is where it was
   * wrong.
   *
   * The test above checks the pen on its own two axes, and on those the reach
   * this engine computed for a long time and the reach a swept pen actually has
   * are the same number -- which is why the test passed while every diagonal in
   * the alphabet was drawn light. What is wanted is the pen's *support* in the
   * direction of the stroke's normal, meaning how far its furthest point stands
   * out that way, and not its radius in that direction.
   *
   * The numbers below are the true boundary of a swept ellipse, found by
   * walking the pen's outline and taking the furthest projection, at half a
   * unit in ten thousand. A pen a hundred long by twenty across, run at
   * forty-five degrees to its own axis, reaches 72.111 units. The radius there
   * is 27.735, which is two fifths of it.
   */
  it("reaches as far across as a swept pen actually does", () => {
    const nib = { contrast: 0.8, angle: 0 };
    const along = (degrees: number) => ({
      x: Math.cos((degrees * Math.PI) / 180),
      y: Math.sin((degrees * Math.PI) / 180),
    });
    expect(reachAcross(along(0), 100, nib)).toBeCloseTo(20, 3);
    expect(reachAcross(along(15), 100, nib)).toBeCloseTo(32.297, 3);
    expect(reachAcross(along(30), 100, nib)).toBeCloseTo(52.915, 3);
    expect(reachAcross(along(45), 100, nib)).toBeCloseTo(72.111, 3);
    expect(reachAcross(along(60), 100, nib)).toBeCloseTo(87.178, 3);
    expect(reachAcross(along(75), 100, nib)).toBeCloseTo(96.731, 3);
    expect(reachAcross(along(90), 100, nib)).toBeCloseTo(100, 3);
  });

  /*
   * A blade with no thickness, which used to be clamped away from.
   *
   * Contrast was held at 0.95 whatever was asked for, on the reasoning that a
   * pen of no thickness draws nothing. It draws the mark a broad-nib pen leaves
   * when it is set down, and it is the value a calligrapher reaches for -- the
   * blackletter entry stroke and the Ruqaa thin are both this. The reach is
   * nought along the blade and the full half-width across it.
   */
  it("lets the pen be a blade with no thickness across", () => {
    const blade = { contrast: 1, angle: 0 };
    expect(reachAcross({ x: 0, y: 1 }, 50, blade)).toBeCloseTo(50, 6);
    expect(reachAcross({ x: 1, y: 0 }, 50, blade)).toBeCloseTo(0, 6);
  });
});

/*
 * The pen along the stroke, which is Noordzij's third way of making a letter.
 *
 * A hand does three things to a pen: it moves it, it changes its size, and it
 * turns it. This engine could say the first two -- a spine, and a width profile
 * that swells -- and could not say the third, because the nib hung off the
 * whole stroke and was one pen from end to end. So a stroke could be held at
 * forty degrees and could not go from forty to a hundred and ten, which is what
 * a Roundhand or a Ruqaa does and half of what makes either look written.
 */
describe("the pen along the stroke", () => {
  it("holds one pen all the way along when it is given one stop", () => {
    const one: NibProfile = [{ at: 0, contrast: 0.5, angle: 30 }];
    expect(nibAt(one, 0)).toEqual({ contrast: 0.5, angle: 30 });
    expect(nibAt(one, 0.5)).toEqual({ contrast: 0.5, angle: 30 });
    expect(nibAt(one, 1)).toEqual({ contrast: 0.5, angle: 30 });
    expect(isOnePen(one)).toBe(true);
  });

  it("turns the pen and narrows it between two stops", () => {
    const turning: NibProfile = [
      { at: 0, contrast: 0.2, angle: 40 },
      { at: 1, contrast: 0.8, angle: 110 },
    ];
    expect(nibAt(turning, 0).angle).toBeCloseTo(40, 6);
    expect(nibAt(turning, 0.5).angle).toBeCloseTo(75, 6);
    expect(nibAt(turning, 1).angle).toBeCloseTo(110, 6);
    expect(nibAt(turning, 0.5).contrast).toBeCloseTo(0.5, 6);
    expect(isOnePen(turning)).toBe(false);
  });

  it("holds the pen outside the outermost stops rather than running on", () => {
    const middle: NibProfile = [
      { at: 0.25, contrast: 0, angle: 0 },
      { at: 0.75, contrast: 1, angle: 90 },
    ];
    expect(nibAt(middle, 0).contrast).toBeCloseTo(0, 6);
    expect(nibAt(middle, 0.1).angle).toBeCloseTo(0, 6);
    expect(nibAt(middle, 1).contrast).toBeCloseTo(1, 6);
    expect(nibAt(middle, 0.5).angle).toBeCloseTo(45, 6);
  });

  /*
   * The short way round, which is the whole of the difficulty.
   *
   * A pen going from three hundred and fifty degrees to ten has turned twenty,
   * and a blend that reads the numbers as they stand turns it three hundred and
   * forty the other way -- through every angle the letter does not want, so the
   * stroke's thick swings all the way round and back. Invisible in a test of
   * either end and unmistakable in the middle.
   */
  it("turns the pen the short way round", () => {
    const across: NibProfile = [
      { at: 0, contrast: 0.8, angle: 350 },
      { at: 1, contrast: 0.8, angle: 10 },
    ];
    // 360, which is 0: twenty degrees of turn, not three hundred and forty.
    expect(nibAt(across, 0.5).angle).toBeCloseTo(360, 6);
    expect(nibAt(across, 0.25).angle).toBeCloseTo(355, 6);
  });

  /*
   * Unless a whole turn was asked for, in which case it was meant.
   *
   * The short way is right for a pen that drifts and wrong for a pen somebody
   * has deliberately wound round: read the short way, nought to three hundred
   * and sixty is no turn at all, and the stroke a full revolution was asked for
   * comes back monoline.
   */
  it("takes a full turn as written", () => {
    const whole: NibProfile = [
      { at: 0, contrast: 0.8, angle: 0 },
      { at: 1, contrast: 0.8, angle: 360 },
    ];
    expect(nibAt(whole, 0.5).angle).toBeCloseTo(180, 6);
    expect(nibAt(whole, 0.25).angle).toBeCloseTo(90, 6);
  });

  it("is not exact once the pen turns, and says so", () => {
    const turning: QuillStroke = {
      ...plainStroke(100),
      nib: [
        { at: 0, contrast: 0, angle: 0 },
        { at: 1, contrast: 0, angle: 90 },
      ],
    };
    expect(isExact(turning)).toBe(false);
    expect(isExact(plainStroke(100))).toBe(true);
  });

  /*
   * And the ink is different, which is the point of all of it.
   *
   * Noordzij's three modes, swept from one skeleton, measured rather than
   * looked at: each has to differ from the plain pen, and differ from each
   * other. `scripts/arches.ts` draws the same four as a picture.
   */
  it("draws Noordzij's three modes differently from one skeleton", () => {
    const spine = {
      segments: [
        {
          kind: "cubic" as const,
          from: { x: 0, y: 0 },
          c1: { x: 0, y: 400 },
          c2: { x: 200, y: 500 },
          to: { x: 400, y: 500 },
        },
      ],
      closed: false,
    };
    const inkOf = (width: QuillStroke["width"], nib: NibProfile) => {
      const drawn = sweep({
        spine,
        width,
        nib,
        start: { kind: "butt" },
        end: { kind: "butt" },
        join: "round",
      });
      const box = contoursBounds(drawn.contours);
      return {
        wide: box.xMax - box.xMin,
        tall: box.yMax - box.yMin,
        ink: Math.abs(
          drawn.contours.reduce((total, one) => total + contourArea(one), 0),
        ),
      };
    };
    const held = [{ at: 0, width: 200 }];
    const translation = inkOf(held, [{ at: 0, contrast: 0.8, angle: 40 }]);
    const rotation = inkOf(held, [
      { at: 0, contrast: 0.8, angle: 40 },
      { at: 1, contrast: 0.8, angle: 110 },
    ]);
    const expansion = inkOf(
      [
        { at: 0, width: 200 },
        { at: 1, width: 20 },
      ],
      [{ at: 0, contrast: 0.8, angle: 40 }],
    );
    const blade = inkOf(held, [{ at: 0, contrast: 1, angle: 40 }]);

    // Turning the pen moves ink. Nothing else about the stroke changed.
    expect(Math.abs(rotation.tall - translation.tall)).toBeGreaterThan(5);
    expect(Math.abs(rotation.ink - translation.ink)).toBeGreaterThan(100);
    // Shrinking it takes ink away at the end that shrank.
    expect(expansion.ink).toBeLessThan(translation.ink);
    // A blade with no thickness holds less ink than a pen that has some, and
    // is inside it: no part of the letter grew.
    expect(blade.ink).toBeLessThan(translation.ink);
    expect(blade.wide).toBeLessThanOrEqual(translation.wide + 1e-6);
    expect(blade.tall).toBeLessThanOrEqual(translation.tall + 1e-6);
  });
});

/*
 * Corners, which the sweep had no answer for.
 *
 * It walks the spine and offsets point by point, and a corner is a
 * discontinuity in the heading: at one sample the stroke is going one way and
 * at the next it is going another, and no number of samples ever lands on the
 * turn itself. So the outside of every corner came back as the chord between
 * the last offset before it and the first after -- a chamfer. At the apex of a
 * `v` that is nearly two thirds of the ink missing: the two sides meet 2.9
 * half-widths from the centre-line and were being drawn at one.
 */
describe("the sweep at a corner", () => {
  /** Two arms meeting at the origin, forty degrees apart, at one width. */
  const vee = (join?: "miter" | "round" | "bevel"): QuillStroke => {
    const lean = Math.tan((20 * Math.PI) / 180) * 700;
    return {
      spine: {
        segments: [
          { kind: "line", from: { x: -lean, y: 700 }, to: { x: 0, y: 0 } },
          { kind: "line", from: { x: 0, y: 0 }, to: { x: lean, y: 700 } },
        ],
        closed: false,
      },
      width: [{ at: 0, width: 90 }],
      nib: [{ ...ROUND_NIB, at: 0 }],
      start: { kind: "butt" },
      end: { kind: "butt" },
      ...(join ? { join } : {}),
    };
  };

  /** How far below the corner the ink reaches. */
  const reachOf = (stroke: QuillStroke): number =>
    -contoursBounds(sweep(stroke).contours).yMin;

  it("carries a mitred corner out to where its two sides meet", () => {
    /*
     * The arms are forty degrees apart, so the outer sides meet at
     * 45 / sin(20°) = 131.6 units below the corner. Anything appreciably less
     * is a chamfer, which is what this drew before.
     */
    expect(reachOf(vee("miter"))).toBeCloseTo(45 / Math.sin((20 * Math.PI) / 180), 0);
  });

  it("takes the chord across a bevelled one", () => {
    // The chord runs between the two offsets, both of which are 45 out along
    // their own normals: it never goes below where they sit.
    expect(reachOf(vee("bevel"))).toBeLessThan(50);
  });

  it("sits the pen at a rounded one", () => {
    // The pen itself, at the corner: half a width and not a unit more, which
    // is the exact boundary of what a disc sweeps through a corner.
    expect(reachOf(vee("round"))).toBeCloseTo(45, 0);
  });

  it("mitres by default, and gives up on a spike", () => {
    expect(reachOf(vee())).toBeCloseTo(reachOf(vee("miter")), 6);
    /*
     * Two arms four degrees apart meet twenty-eight half-widths out, which is
     * a spike rather than an apex. Past the limit the chord is the better
     * answer, and is what every stroking library falls back to.
     */
    const spike = vee("miter");
    const lean = Math.tan((2 * Math.PI) / 180) * 700;
    spike.spine.segments = [
      { kind: "line", from: { x: -lean, y: 700 }, to: { x: 0, y: 0 } },
      { kind: "line", from: { x: 0, y: 0 }, to: { x: lean, y: 700 } },
    ];
    expect(reachOf(spike)).toBeLessThan(45 * 4);
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
    const before = drawn.contours.map((one) => flattenContour(one, 40));
    const after = again.contours.map((one) => flattenContour(one, 40));
    expect(after.flat().length, "redrew nothing").toBeGreaterThan(0);
    /*
     * Point to *outline*, not point to point.
     *
     * A flattened outline puts samples along a curve and none along a straight
     * run, because a straight run needs none to describe it. Compared cloud to
     * cloud, two drawings that agree on a stem to within a unit report half its
     * length as their difference -- the nearest sampled point to the middle of
     * a stem is the corner at the end of it. That number is the sampling rather
     * than the shape, and it hid the real errors in this engine behind
     * imaginary ones for as long as it was used.
     */
    const off = Math.max(
      furthestFromPath(before.flat(), after),
      furthestFromPath(after.flat(), before),
    );
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
    const round: QuillStroke = {
      ...plainStroke(90),
      start: { kind: "round" },
      end: { kind: "round" },
    };
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

  /*
   * A ring, which is the shape the sweep had no notion of.
   *
   * An `o` drawn in one closed motion has no ends, so it has no caps and its
   * two sides never meet. Swept as though it were open it came back as one
   * contour that ran round the outside, cut across the stroke, ran back round
   * the inside and cut across again -- a blob at the seam where the two caps
   * piled up, and a counter that was not a hole. It was sixty-four units of
   * spilt ink at the bottom of every bowl in a traced font.
   */
  it("sweeps a closed spine as a ring rather than a capped band", () => {
    const ring: QuillStroke = {
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
          {
            kind: "arc",
            centre: { x: 0, y: 0 },
            radius: 200,
            startAngle: Math.PI,
            endAngle: Math.PI * 2,
            sweepPositive: true,
          },
        ],
        closed: true,
      },
      width: [{ at: 0, width: 60 }],
      nib: [{ ...ROUND_NIB, at: 0 }],
      start: { kind: "butt" },
      end: { kind: "butt" },
    };
    const drawn = sweep(ring);
    expect(drawn.contours.length, "a ring is an outside and an inside").toBe(2);
    // Opposite windings, or the counter is filled in rather than a hole.
    const areas = drawn.contours.map(contourArea);
    expect(Math.sign(areas[0]) * Math.sign(areas[1])).toBe(-1);
    const outer = Math.abs(areas[0]) >= Math.abs(areas[1]) ? 0 : 1;
    expect(areas[outer], "the outside of a letter is clockwise").toBeLessThan(
      0,
    );
    // The ring is 230 out and 170 in, all the way round, with nothing sticking
    // out at the seam.
    for (const contour of drawn.contours) {
      for (const node of contour.nodes) {
        const radius = Math.hypot(node.point.x, node.point.y);
        expect(radius).toBeGreaterThan(168);
        expect(radius).toBeLessThan(232);
      }
    }
  });

  it("reads a ring back as a ring", () => {
    const ring: QuillStroke = {
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
          {
            kind: "arc",
            centre: { x: 0, y: 0 },
            radius: 200,
            startAngle: Math.PI,
            endAngle: Math.PI * 2,
            sweepPositive: true,
          },
        ],
        closed: true,
      },
      width: [{ at: 0, width: 60 }],
      nib: [{ ...ROUND_NIB, at: 0 }],
      start: { kind: "butt" },
      end: { kind: "butt" },
    };
    const fit = roundTrip([ring], 12);
    expect(fit.glyph.strokes.length).toBe(1);
    expect(fit.glyph.strokes[0].spine.closed, "an `o` has no ends").toBe(true);
  });

  /*
   * How many nodes it costs, which is the difference between an outline a
   * person can edit and a recording of one.
   *
   * The spine being fitted is a walk over a grid of pixels: a staircase, known
   * to about a pixel wherever it runs diagonally. Fitted five times finer than
   * that, the fitter chases quantisation rather than the letter -- a plain ring
   * came back as a forty-five segment centre-line, which is a circle described
   * eleven times over, and every one of those segments paid for itself twice
   * again in the outline swept from it.
   */
  it("does not fit a spine finer than the grid it was read from", () => {
    const ring: QuillStroke = {
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
          {
            kind: "arc",
            centre: { x: 0, y: 0 },
            radius: 200,
            startAngle: Math.PI,
            endAngle: Math.PI * 2,
            sweepPositive: true,
          },
        ],
        closed: true,
      },
      width: [{ at: 0, width: 60 }],
      nib: [{ ...ROUND_NIB, at: 0 }],
      start: { kind: "butt" },
      end: { kind: "butt" },
    };
    const fit = fitGlyph("o", sweepAll([ring]).contours, 600, {})!;
    expect(
      fit.glyph.strokes[0].spine.segments.length,
      "a circle is not forty-five curves",
    ).toBeLessThan(12);
  });

  /*
   * A stroke that stops inside another one is joined to it, not ended.
   *
   * Thinning stops short of a boundary, and a junction is not a boundary: where
   * the shoulder of an `n` runs into its stem the field does not fall away, it
   * swells. Treated as a terminal, that end was probed for square corners,
   * found ink on both sides because it was standing in the middle of the stem,
   * concluded the stroke was cut square and ran the spine half a width further
   * -- out through the far side of the stem, where it drew a blob.
   */
  it("does not run a stroke out past the one it joins", () => {
    const stem: QuillStroke = {
      spine: straight([0, 0], [0, 700]),
      width: [{ at: 0, width: 80 }],
      nib: [{ ...ROUND_NIB, at: 0 }],
      start: { kind: "butt" },
      end: { kind: "butt" },
    };
    const arm: QuillStroke = {
      spine: straight([0, 350], [400, 350]),
      width: [{ at: 0, width: 80 }],
      nib: [{ ...ROUND_NIB, at: 0 }],
      start: { kind: "butt" },
      end: { kind: "butt" },
    };
    const fit = fitGlyph("T", sweepAll([stem, arm]).contours, 600, {})!;
    const across = fit.glyph.strokes.find((one) => {
      const [first] = one.spine.segments;
      const last = one.spine.segments[one.spine.segments.length - 1];
      if (first.kind !== "cubic" || last.kind !== "cubic") return false;
      return (
        Math.abs(last.to.x - first.from.x) > Math.abs(last.to.y - first.from.y)
      );
    });
    expect(across, "the arm was not found at all").toBeDefined();
    /*
     * Asked of the ink rather than of the spine, because the ink is what went
     * wrong. The arm *is* run out past the junction, on purpose -- two strokes
     * that both stop dead at the point they meet leave the outside of the turn
     * empty -- and how far is the whole question. Half its own width takes it
     * to the far side of the stem and no further, so the union is the stem it
     * already was. Run out by a *terminal's* reach it goes further: that probes
     * for ink, finds the whole stem, and comes out the other side, which is the
     * blob this is here to catch.
     */
    const redrawn = sweepAll(fit.glyph.strokes).contours;
    const leftmost = Math.min(
      ...redrawn.flatMap((one) => one.nodes.map((node) => node.point.x)),
    );
    expect(leftmost, "the arm came out the far side of the stem").toBeGreaterThan(
      -44,
    );
  });

  /*
   * An end cut at an angle, which is most terminals on most faces.
   *
   * Thinning leaves the same skeleton whether an end was cut or rounded, so the
   * difference is entirely in the ink past it -- and no single measurement of
   * that ink separates a square cut, an angled cut and a rounded end. Asked
   * whether both corners of the end rectangle are covered, only a dead-square
   * cut says yes. Asked how far the ink runs past the tip, an arm that reaches
   * the baseline before the thinning gives out says none, exactly as a rounded
   * end does. So the two caps are drawn and compared against the letter
   * instead, and whichever describes it wins.
   */
  it("reads an angled cut as a cut rather than a rounded end", () => {
    const bar: QuillStroke = {
      spine: straight([0, 0], [600, 0]),
      width: [{ at: 0, width: 120 }],
      nib: [{ ...ROUND_NIB, at: 0 }],
      start: { kind: "butt" },
      end: { kind: "butt" },
    };
    const drawn = sweepAll([bar]);
    // Slice the right-hand end off at forty-five degrees, which is what a face
    // does to the terminal of a `c` or a `z` and what used to read as round.
    const angled = drawn.contours.map((one) => ({
      ...one,
      nodes: one.nodes.map((node) =>
        node.point.x > 540
          ? {
              ...node,
              point: { x: 600 - Math.abs(node.point.y), y: node.point.y },
            }
          : node,
      ),
    }));
    const fit = fitGlyph("bar", angled, 700, {})!;
    expect(fit.glyph.strokes[0].end.kind, "an angled cut is a cut").toBe(
      "butt",
    );
  });

  /*
   * A corner in the drawing is a corner in the centre-line read back from it.
   *
   * Schneider's method splits a run where the error is worst and fits the two
   * halves separately, each taking its tangents from its own points, so a
   * corner survives it without being looked for -- which is worth pinning
   * precisely because nothing in the fitter mentions corners, and a change that
   * made the two halves share a tangent would smooth the bottom of every `v`,
   * `w` and `z` in a traced font without failing anything else.
   *
   * Detecting corners explicitly and cutting the fit at them was tried and
   * removed: over an alphabet it moved the mean error by three hundredths of a
   * unit and saved seventeen nodes in fourteen hundred, and no test could tell
   * whether it was there.
   */
  /*
   * Two strokes that meet, and the wedge between them where neither goes.
   *
   * A run is cut at every junction, so where a crossbar meets a stem both of
   * them end at the same point -- and each was finished there with a square cut
   * across its own direction, or with a disc, and neither fills the outside of
   * the turn. On DejaVu that hollow was worth a hundred and eight units on the
   * `m`, seventy on the `f` and seventy-three on the `t`; here it is the corner
   * where the bar crosses the stem, and it is smaller because a synthetic
   * crossing is cleaner than a drawn one. Each stroke now runs on past the
   * junction by its own half width, so the two overlap the way a hand's do.
   */
  it("runs a stroke on past the one it meets, so the corner fills", async () => {
    await ready();
    const bar = (
      from: [number, number],
      to: [number, number],
    ): QuillStroke => ({
      spine: straight(from, to),
      width: [{ at: 0, width: 90 }],
      nib: [{ ...ROUND_NIB, at: 0 }],
      start: { kind: "butt" },
      end: { kind: "butt" },
    });
    const source = sweepAll([bar([0, -300], [0, 500]), bar([-200, 300], [200, 300])])
      .contours;
    const fit = fitGlyph("t", source, 900, {})!;
    const redrawn = sweepAll(fit.glyph.strokes).contours;
    const flat = (contours: Contour[]) =>
      contours.map((one) => flattenContour(one, 40));
    const worst = Math.max(
      furthestFromPath(flat(unite(source)).flat(), flat(unite(redrawn))),
      furthestFromPath(flat(unite(redrawn)).flat(), flat(unite(source))),
    );
    // Twenty-four and four fifths of it before, and six and a third after.
    expect(worst, "the corner where the bar meets the stem is hollow").toBeLessThan(8);
  });

  /*
   * An end cut across the arm it finishes, which is most terminals on a sans.
   *
   * DejaVu's `v` is seven points and its two arms are cut off flat by the
   * x-height, so each terminal is a horizontal edge across an arm climbing at
   * sixty-three degrees. The heading that decides how that end is drawn is read
   * over the last stretch up to the skeleton's tip -- and that stretch is inside
   * the zone where the medial axis is bending towards the corner it is running
   * into, so it read twenty-nine degrees. The tip itself is up in that corner
   * too, eighty-nine units off the centre-line. Together those swung both of the
   * probes that measure the ink past the end clean out of the letter; they read
   * nought, which the code took for "no ink runs past here", and the arm was cut
   * dead square across a heading sixty degrees wrong. Sixty units of ink hung
   * above the letter's own x-height, and the same on the `w` and the `y`.
   *
   * Written out as coordinates rather than swept from strokes, because what
   * makes this case is the flat cut across a diagonal, and a stroke swept from
   * a spine cannot have one.
   */
  it("cuts an angled terminal across the arm, not across the whisker", () => {
    const vee: Contour = {
      nodes: [
        [481, 0],
        [61, 1120],
        [256, 1120],
        [606, 180],
        [956, 1120],
        [1151, 1120],
        [731, 0],
      ].map(
        ([x, y]): GlyphNode => ({
          point: { x, y },
          handleIn: null,
          handleOut: null,
          type: "corner",
        }),
      ),
      closed: true,
    };
    const fit = fitGlyph("v", [vee], 1212, { unitsPerEm: 2048 })!;
    const drawn = sweepAll(fit.glyph.strokes).contours;
    const above = Math.max(
      ...drawn.flatMap((one) => one.nodes.map((node) => node.point.y)),
    );
    // Sixty units of flap before, thirty after, on a letter 1,120 tall.
    expect(above - 1120, "ink above the x-height at the terminal").toBeLessThan(45);
  });

  it("keeps the corner at the bottom of a v", () => {
    const vee: QuillStroke = {
      spine: {
        segments: [
          { kind: "line", from: { x: 0, y: 700 }, to: { x: 250, y: 0 } },
          { kind: "line", from: { x: 250, y: 0 }, to: { x: 500, y: 700 } },
        ],
        closed: false,
      },
      width: [{ at: 0, width: 90 }],
      nib: [{ ...ROUND_NIB, at: 0 }],
      start: { kind: "butt" },
      end: { kind: "butt" },
    };
    const drawn = sweepAll([vee]);
    const fit = fitGlyph("v", drawn.contours, 600, {})!;
    const spine = fit.glyph.strokes.flatMap((one) => one.spine.segments);
    // Somewhere along it the run turns by more than a right angle, which is
    // what a corner is and what a smoothed fit does not have.
    const heading = (index: number) => {
      const one = spine[index];
      const from = one.kind === "cubic" ? one.from : { x: 0, y: 0 };
      const to = one.kind === "cubic" ? one.to : { x: 0, y: 0 };
      return Math.atan2(to.y - from.y, to.x - from.x);
    };
    let sharpest = 0;
    for (let index = 1; index < spine.length; index++) {
      let turn = Math.abs(heading(index) - heading(index - 1));
      if (turn > Math.PI) turn = Math.PI * 2 - turn;
      sharpest = Math.max(sharpest, turn);
    }
    expect(sharpest, "the bottom of the v was rounded off").toBeGreaterThan(
      Math.PI / 2,
    );

    /*
     * What the corner is *not* checked for, and why it is said rather than left
     * to be discovered.
     *
     * The corner now survives the fit -- that is what is pinned above -- but it
     * does not survive the sweep, which walks the spine and offsets point by
     * point. A corner in a centre-line wants a mitre on its outside and a fold
     * on its inside, and a walk produces neither: it rounds the outside and
     * lets the inside cross itself. So the ink redrawn from this `v` is some
     * sixty units out at the vertex, and no tolerance passed to the fitter
     * changes that. Mitreing the sweep is the fix and it is not done here.
     */
  });

  /*
   * A short branch that draws ink of its own is not a whisker.
   *
   * Thinning leaves a branch reaching towards every corner of an outline, and
   * most of them are noise: swept, they add nothing the stroke they hang off
   * does not already cover. What made one a whisker used to be its length
   * against the local width -- and that width is read at the middle of the
   * branch, which on a short branch is the junction, where the field balloons
   * to take in every stroke meeting there. Both feet of a `w` were thrown away
   * that way: twenty-two units long against a floor of a hundred and
   * eighty-seven, and the letter came back resting on nothing, missing
   * ninety-three units of ink along the baseline.
   */
  it("keeps a short branch that reaches ink nothing else covers", () => {
    const stem: QuillStroke = {
      spine: straight([300, 60], [300, 700]),
      width: [{ at: 0, width: 90 }],
      nib: [{ ...ROUND_NIB, at: 0 }],
      start: { kind: "butt" },
      end: { kind: "butt" },
    };
    // A foot, twice the stem's width and much shorter than it: exactly the
    // shape the length rule cannot tell from a whisker.
    const foot: QuillStroke = {
      spine: straight([210, 60], [390, 60]),
      width: [{ at: 0, width: 120 }],
      nib: [{ ...ROUND_NIB, at: 0 }],
      start: { kind: "butt" },
      end: { kind: "butt" },
    };
    const drawn = sweepAll([stem, foot]);
    const fit = fitGlyph("foot", drawn.contours, 600, {})!;
    const again = sweepAll(fit.glyph.strokes);
    const box = contoursBounds(again.contours);
    // The foot spans 180 units; with it thrown away this is the stem alone,
    // ninety wide about x = 300.
    expect(box.xMax - box.xMin, "the foot was pruned as a whisker").toBeGreaterThan(150);
    expect(box.yMin).toBeLessThan(10);
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
      nib: [{ ...ROUND_NIB, at: 0 }],
      start: { kind: "round" },
      end: { kind: "round" },
    };
    const drawn = sweepAll([stem, dot]);
    const fit = fitGlyph("i", drawn.contours, 300, {})!;
    expect(fit).not.toBeNull();
    const high = fit.glyph.strokes.filter((one) =>
      one.spine.segments.some(
        (segment) => segment.kind === "cubic" && segment.from.y > 600,
      ),
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
    const mean = (one: typeof before) =>
      one.reduce((s, x) => s + x.width, 0) / one.length;
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
    const glyph = {
      name: "l",
      advanceWidth: 300,
      strokes: [plainStroke(80)],
      unitsPerEm: 1000,
    };
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
    const glyph = {
      name: "n",
      advanceWidth: 400,
      strokes: [plainStroke(80)],
      unitsPerEm: 1000,
    };
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
    const glyph = {
      name: "l",
      advanceWidth: 400,
      strokes: [plainStroke(80)],
      unitsPerEm: 1000,
    };
    const level = contoursBounds(
      sweepAll(restyle(glyph, PLAIN_HAND).strokes).contours,
    );
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
    expect(
      restyle(glyph, { ...PLAIN_HAND, bounce: 1 }).advanceWidth,
    ).toBeCloseTo(400, 6);
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
      const glyph = {
        name,
        advanceWidth: 400,
        strokes: [plainStroke(80)],
        unitsPerEm: 1000,
      };
      return contoursBounds(
        sweepAll(restyle(glyph, { ...PLAIN_HAND, bounce: 1 }).strokes).contours,
      ).yMin;
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
            {
              name,
              advanceWidth: 400,
              strokes: [plainStroke(80)],
              unitsPerEm: 1000,
            },
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
    const small = {
      name: "q",
      advanceWidth: 400,
      strokes: [plainStroke(80)],
      unitsPerEm: 1000,
    };
    const large = { ...small, unitsPerEm: 2000 };
    const lift = (glyph: typeof small) =>
      contoursBounds(
        sweepAll(restyle(glyph, { ...PLAIN_HAND, bounce: 1 }).strokes).contours,
      ).yMin -
      contoursBounds(sweepAll(restyle(glyph, PLAIN_HAND).strokes).contours)
        .yMin;
    expect(lift(large)).toBeCloseTo(lift(small) * 2, 4);
  });

  it("width stretches the letter and its advance together", () => {
    /*
     * Together is the whole point. A joined face that stretched its letters and
     * left the advance alone would put the exit stroke of one letter somewhere
     * the next letter's entry is not, and come apart at every join.
     */
    const glyph = {
      name: "n",
      advanceWidth: 400,
      strokes: [plainStroke(80)],
      unitsPerEm: 1000,
    };
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
    const glyph = {
      name: "n",
      advanceWidth: 400,
      strokes: [plainStroke(80)],
      unitsPerEm: 1000,
    };
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
        segments: [
          { kind: "line", from: { x: 150, y: 0 }, to: { x: 150, y: 400 } },
        ],
        closed: false,
      },
    };
    const glyph = {
      name: "n",
      advanceWidth: 400,
      strokes: [joining, inside],
      unitsPerEm: 1000,
    };

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
        segments: [
          { kind: "line", from: { x: 100, y: 100 }, to: { x: 399, y: 100 } },
        ],
        closed: false,
      },
    };
    const drawnBackwards: QuillStroke = {
      ...stroke(),
      spine: {
        segments: [
          { kind: "line", from: { x: 399, y: 100 }, to: { x: 100, y: 100 } },
        ],
        closed: false,
      },
    };
    const style = { ...PLAIN_HAND, reach: 1 };
    const segmentsOf = (one: QuillStroke) =>
      restyle(
        { name: "o", advanceWidth: 400, strokes: [one], unitsPerEm: 1000 },
        style,
      ).strokes[0].spine.segments.length;
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
    const glyph = {
      name: "o",
      advanceWidth: 400,
      strokes: [bowl],
      unitsPerEm: 1000,
    };
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
        control.key === "nibAngle"
          ? { ...PLAIN_HAND, contrast: 0.6 }
          : PLAIN_HAND;
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
      for (const value of [
        control.min,
        (control.min + control.max) / 2,
        control.max,
      ]) {
        const style = { ...base, [control.key]: value } as QuillStyle;
        seen.add(
          `${shapeOf(style)}|${restyle(glyph, style).advanceWidth.toFixed(4)}`,
        );
      }
      if (seen.size < 2) dead.push(`${control.key} (${control.label})`);
    }
    expect(dead).toEqual([]);
  });

  it("every control starts inside its own range", () => {
    const outside: string[] = [];
    for (const control of QUILL_CONTROLS) {
      const value = (PLAIN_HAND as unknown as Record<string, number>)[
        control.key
      ];
      expect(typeof value, `${control.key} has no starting value`).toBe(
        "number",
      );
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
function boxGlyph(
  name: string,
  advanceWidth: number,
  from: number,
  to: number,
): Glyph {
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
    contours: [
      {
        nodes: [at(from, 0), at(to, 0), at(to, 500), at(from, 500)],
        closed: true,
      },
    ],
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
    metrics: {
      ascender: 800,
      descender: -200,
      capHeight: 700,
      xHeight: 500,
      lineGap: 0,
    },
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
    const verdict = looksJoined(
      fontOf(LOWERCASE.map((one) => boxGlyph(one, 500, 60, 440))),
    );
    expect(verdict.joined).toBe(false);
    expect(verdict.tested).toBe(LOWERCASE.length);
    expect(verdict.reaching).toBe(0);
    expect(verdict.sidebearing).toBeCloseTo(0.06, 5);
  });

  it("calls a face whose ink overhangs its advance a joined script", () => {
    // Ink from -20 to 520 in an advance of 500: the exit stroke runs past the
    // edge to meet the next letter, which is what joining is.
    const verdict = looksJoined(
      fontOf(LOWERCASE.map((one) => boxGlyph(one, 500, -20, 520))),
    );
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
    const verdict = looksJoined(
      fontOf(["a", "c", "e", "h"].map((one) => boxGlyph(one, 500, -20, 520))),
    );
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

/*
 * A traced letter drawn by hand instead.
 *
 * What comes back from a trace is a guess about how a shape was made rather
 * than a record of it, so there is always a letter that no set of strokes
 * reaches. One can be taken to the point tools and handed back, and from then
 * on the letter is what was drawn -- which is a real loss as well as a gain,
 * and is why the strokes are kept beside the drawing rather than replaced by
 * it: giving the letter back to the hand costs one press.
 */
describe("a traced letter drawn by hand", () => {
  const square: Contour[] = [
    {
      nodes: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 400, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 400, y: 400 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 0, y: 400 }, handleIn: null, handleOut: null, type: "corner" },
      ],
      closed: true,
    },
  ];
  const traced = (byHand?: Traced["byHand"]): Traced => ({
    glyph: { name: "n", advanceWidth: 600, strokes: [plainStroke(90)], unitsPerEm: 1000 },
    deviation: 0,
    source: [],
    ...(byHand ? { byHand } : {}),
  });

  it("draws what was drawn rather than what was read", () => {
    const swept = drawTraced(traced(), PLAIN_HAND);
    const drawn = drawTraced(traced({ contours: square, advanceWidth: 555 }), PLAIN_HAND);
    expect(drawn.advanceWidth).toBe(555);
    expect(contoursBounds(drawn.contours)).toEqual({ xMin: 0, yMin: 0, xMax: 400, yMax: 400 });
    expect(contoursBounds(swept.contours)).not.toEqual(contoursBounds(drawn.contours));
  });

  /*
   * The hand does not reach it, and says so rather than appearing to.
   *
   * A letter that answered the sliders in the specimen strip and not on the
   * canvas would be worse than one that answered them nowhere: the two views
   * are of the same letter and both go through this function, which is why it
   * exists.
   */
  it("stops answering the hand", () => {
    const heavy = { ...PLAIN_HAND, weight: PLAIN_HAND.weight + 0.4 };
    const one = traced({ contours: square, advanceWidth: 555 });
    expect(drawTraced(one, heavy).contours).toEqual(drawTraced(one, PLAIN_HAND).contours);
    // Where the strokes are still the letter, the same change does reach it.
    const plain = traced();
    expect(contoursBounds(drawTraced(plain, heavy).contours)).not.toEqual(
      contoursBounds(drawTraced(plain, PLAIN_HAND).contours),
    );
  });

  it("says it is exact, because a drawing is not a fit", () => {
    expect(drawTraced(traced({ contours: square, advanceWidth: 555 }), PLAIN_HAND).exactness).toEqual(
      { exact: true, deviation: 0 },
    );
  });
});
