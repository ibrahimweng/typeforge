/**
 * Putting material on.
 *
 * Three claims, and they are different in kind.
 *
 * That the shadow is the ground the letter covers, which is arithmetic: a
 * letter thrown along a line covers its own area plus the area it sweeps, and
 * both of those can be worked out without drawing anything.
 *
 * That a counter survives a shadow. That one is not arithmetic and is the
 * thing two earlier versions of the shadow got wrong -- an O came back solid
 * at a throw of half a stem, twice, for two different reasons.
 *
 * And that a letter cast on is still one piece of ink. Adding material cannot
 * break a letter apart, so if the count goes up something has gone wrong in
 * the geometry rather than in the design.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contourArea, contoursBounds } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { drawLetter, letterNames } from "./build";
import { castInk, noCast, type Cast } from "./cast";
import { piecesOf, scaleOf } from "./cut";
import { shapedInk } from "./layers";
import { noCuts, type Cuts } from "@/font/cuts";
import { BASES, SANS } from "./style";

beforeAll(async () => {
  await ready();
});

const ink = (contours: Contour[]): number =>
  Math.abs(contours.reduce((total, one) => total + contourArea(one), 0));

const cast = (patch: (one: Cast) => void): Cast => {
  const one = noCast();
  patch(one);
  return one;
};

const put = (letter: string, one: Cast, style = SANS): Contour[] => {
  const drawn = drawLetter(letter, style)!;
  return castInk(drawn.contours, [], scaleOf(style), one, "winding");
};

const plain = (letter: string, style = SANS): Contour[] => drawLetter(letter, style)!.contours;

describe("the shadow", () => {
  it("reaches as far as it is thrown, and no further", () => {
    const reach = 1.5;
    const thrown = put("H", cast((one) => { one.extrude = { on: true, distance: reach, angle: 0 }; }));
    const was = contoursBounds(plain("H"));
    const now = contoursBounds(thrown);

    // Thrown due right, so the letter keeps its left edge and gains exactly
    // the throw on its right. In stems, because that is what the setting is in.
    expect(now.xMin).toBeCloseTo(was.xMin, 0);
    expect(now.xMax - was.xMax).toBeCloseTo(reach * SANS.pen.weight, 0);
    expect(now.yMin).toBeCloseTo(was.yMin, 0);
    expect(now.yMax).toBeCloseTo(was.yMax, 0);
  });

  it("covers the ground the shape passes over, corners and all", () => {
    /*
     * A rectangle rather than a letter, because this is the one claim here
     * that is arithmetic, and thrown along a diagonal rather than square,
     * because square is the one direction that cannot go wrong.
     *
     * The ground a convex shape covers is its own area plus the distance times
     * its width measured across the throw. Thrown diagonally, an edge of the
     * answer runs at forty-five degrees -- and an edge at forty-five degrees is
     * where the first version of this went wrong, stamping copies along the
     * line and leaving a staircase as deep as the gap between them. A staircase
     * loses area from under every step, so asking about the area asks about
     * that too.
     *
     * Length would not: a staircase is longer than the run it replaces by the
     * same factor whether its steps are thirty units or one, so the boundary
     * of a shadow that looks perfect measures as long as one that looks awful.
     */
    const stem = SANS.pen.weight;
    const box: Contour = {
      closed: true,
      nodes: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 400 },
        { x: 0, y: 400 },
      ].map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" as const })),
    };
    const thrown = castInk(
      [box],
      [],
      scaleOf(SANS),
      cast((one) => { one.extrude = { on: true, distance: 2, angle: -45 }; }),
      "winding",
    );

    const reach = 2 * stem;
    const across = (100 + 400) * Math.SQRT1_2;
    const swept = 100 * 400 + reach * across;
    /*
     * Within a hundredth. Each round of the halving moves its copy a hundredth
     * of a unit further than asked -- which is what stops the copy's edges
     * landing exactly on the original's -- and the halving's own steps leave a
     * staircase a unit and a half deep, well under what a font file can hold.
     * Stamped copies leave one twenty times that, which this is well inside.
     */
    expect(Math.abs(ink(thrown) - swept) / swept).toBeLessThan(0.01);
  });

  it("leaves the counter of an O open", () => {
    /*
     * The claim two earlier versions failed. Stamping copies along the line
     * left a staircase; laying a band along each piece of the outline fused
     * the bands round the counter into a disc rather than a ring, and the O
     * came back solid at a throw of half a stem.
     *
     * The counter has to shrink -- it is the counter overlapped with itself
     * moved -- and it has to survive.
     */
    const before = plain("O");
    const hole = (contours: Contour[]): number =>
      Math.abs(contours.filter((one) => contourArea(one) < 0).reduce((t, o) => t + contourArea(o), 0));

    let last = hole(before);
    expect(last).toBeGreaterThan(0);
    for (const distance of [0.5, 1, 1.5, 2]) {
      const thrown = put("O", cast((one) => { one.extrude = { on: true, distance, angle: 0 }; }));
      const now = hole(thrown);
      expect(now).toBeGreaterThan(0);
      expect(now).toBeLessThan(last);
      last = now;
    }
  });

  it("throws the way it is pointed", () => {
    const was = contoursBounds(plain("H"));
    const up = contoursBounds(put("H", cast((one) => { one.extrude = { on: true, distance: 1, angle: 90 }; })));
    const down = contoursBounds(put("H", cast((one) => { one.extrude = { on: true, distance: 1, angle: -90 }; })));

    expect(up.yMax).toBeGreaterThan(was.yMax);
    expect(up.yMin).toBeCloseTo(was.yMin, 0);
    expect(down.yMin).toBeLessThan(was.yMin);
    expect(down.yMax).toBeCloseTo(was.yMax, 0);
  });
});

describe("the rim", () => {
  it("grows the letter out by what it is asked for", () => {
    const width = 0.3;
    const was = contoursBounds(plain("H"));
    const now = contoursBounds(put("H", cast((one) => { one.outline = { on: true, width }; })));
    const grew = width * SANS.pen.weight;
    // Every side, and each by the same amount, which is what makes it a rim
    // rather than a shadow. Loosely, because the figure it grows by is a
    // sixteen-sided one and not a circle.
    for (const [got, want] of [
      [was.xMin - now.xMin, grew],
      [now.xMax - was.xMax, grew],
      [was.yMin - now.yMin, grew],
      [now.yMax - was.yMax, grew],
    ]) {
      expect(got / want).toBeGreaterThan(0.9);
      expect(got / want).toBeLessThan(1.1);
    }
  });

  it("closes the counters as it opens the outside", () => {
    /*
     * Said in the panel and worth pinning, because it is a limit of the
     * operation rather than a fault to be found later: growing a shape grows
     * it inwards as well, so the counters shrink as the rim thickens and a
     * light face will lose them altogether.
     */
    const hole = (contours: Contour[]): number =>
      Math.abs(contours.filter((one) => contourArea(one) < 0).reduce((t, o) => t + contourArea(o), 0));

    let last = hole(plain("o"));
    expect(last).toBeGreaterThan(0);
    for (const width of [0.1, 0.2, 0.3]) {
      const now = hole(put("o", cast((one) => { one.outline = { on: true, width }; })));
      expect(now).toBeLessThan(last);
      last = now;
    }
  });
});

describe("nothing added breaks a letter", () => {
  it("leaves every letter of every face in one piece", () => {
    /*
     * Adding material cannot cut a letter in two. Anything here that comes
     * back in more pieces than it went in has gone wrong in the geometry --
     * which is exactly how the spike on a Sans a and the hairline through a
     * thrown H were found.
     */
    const solid = letterNames().filter((name) => /^[A-Za-z]$/.test(name) && name !== "i" && name !== "j");
    const everything = cast((one) => {
      one.extrude = { on: true, distance: 1.2, angle: -45 };
      one.spur = { on: true, size: 0.4 };
      one.weld = { on: true, size: 0.5 };
    });

    const broken: string[] = [];
    for (const style of [SANS, BASES.find((base) => base.name === "Serif")!]) {
      for (const name of solid) {
        const drawn = drawLetter(name, style, undefined, undefined, undefined, everything);
        if (!drawn || drawn.contours.length === 0) continue;
        if (piecesOf(drawn.contours) > 1) broken.push(`${style.name} ${name}`);
      }
    }
    expect(broken).toEqual([]);
  }, 120_000);
});

describe("which layer goes first", () => {
  it("gives two different letters, and the cut one is the smaller", () => {
    /*
     * The whole reason the order is a control. Cut first and the shadow is
     * thrown by a letter with a slot in it, so the slot shows in the shadow;
     * cast first and the slot is cut through face and shadow together.
     *
     * Which is bigger is not the point and is not asserted -- only that the
     * two orders disagree, because an order control that made no difference
     * would be a control that does nothing.
     */
    const cuts: Cuts = noCuts();
    cuts.slot = { on: true, count: 3, width: 0.34, angle: 0, inset: 0.1 };
    const shadow = cast((one) => { one.extrude = { on: true, distance: 1.5, angle: 0 }; });

    const drawn = drawLetter("H", SANS)!;
    const scale = scaleOf(SANS);
    const cutFirst = shapedInk(drawn.contours, [], scale, cuts, { ...shadow, order: "after" });
    const castFirst = shapedInk(drawn.contours, [], scale, cuts, { ...shadow, order: "before" });

    expect(ink(cutFirst.contours)).toBeGreaterThan(0);
    expect(ink(castFirst.contours)).toBeGreaterThan(0);
    expect(ink(cutFirst.contours)).not.toBeCloseTo(ink(castFirst.contours), 0);
  });

  it("does nothing at all when neither layer is switched on", () => {
    const drawn = drawLetter("H", SANS)!;
    const same = shapedInk(drawn.contours, [], scaleOf(SANS), noCuts(), noCast());
    // The same objects, not merely the same shape: a letter nothing reaches
    // should not be rebuilt, which is what keeps a whole font cheap to draw.
    expect(same.contours).toBe(drawn.contours);
  });
});
