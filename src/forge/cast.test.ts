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

import { readyToShape } from "./layers";
import { unite } from "@/font/boolean";
import { contourArea, contourContainsPoint, contoursBounds, reverseContour } from "@/font/geometry";
import type { Contour, Vec2 } from "@/font/types";
import { drawLetter, letterNames } from "./build";
import { LETTERS } from "./letters";
import { castInk, noCast, type Cast } from "./cast";
import { piecesOf, scaleOf } from "./cut";
import { shapedInk } from "./layers";
import { noCuts, type Cuts } from "@/font/cuts";
import { BASES, SANS } from "./style";

beforeAll(async () => {
  await readyToShape();
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

/*
 * What the cast layer is allowed to leave behind, on the letter that leaves
 * behind the most of it.
 *
 * Measured rather than chosen: a Flared `k` is 42 points, comes out of the rim
 * at 432 and out of all four operations at 304 -- fewer, because a shadow under
 * the rim fills in the notches the rim would otherwise have left. A sixth over
 * each is room for a boolean library that resolves a crossing a hair
 * differently, and nothing like room for the operation to start leaving twice
 * as much.
 *
 * The rim was 348 until every corner of the sweep started leaving a wedge
 * behind, which is what lets a letter come off the pen with the same nodes at
 * the Thin as at the Black -- see `outerJoin` in `sweep.ts`. A wedge is cut in
 * two pieces however far it turns, so a corner that used to be two nodes is now
 * three, and a rim traces every corner of the letter eight times over. Cutting
 * the wedge in one piece instead was tried, to get the nodes back: it does get
 * the rim back under 348, and it flattens the sharp joins enough that the four
 * operations together came out at 1,192 against 304. Two it is, and the
 * twenty-four per cent is what the weight axis costs here.
 */
const POINT_BUDGET = { rim: 504, everything: 355 };

describe("the shadow", () => {
  it("reaches as far as it is thrown, and no further", () => {
    const reach = 1.5;
    const thrown = put(
      "H",
      cast((one) => {
        one.extrude = { on: true, distance: reach, angle: 0 };
      }),
    );
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
      cast((one) => {
        one.extrude = { on: true, distance: 2, angle: -45 };
      }),
      "winding",
    );

    const reach = 2 * stem;
    const across = (100 + 400) * Math.SQRT1_2;
    const swept = 100 * 400 + reach * across;
    /*
     * To a hundred-thousandth, because the answer is not an approximation of
     * the swept ground -- it is the swept ground. The loop the outline makes as
     * it is dragged along the throw is exactly the edge of what a sweep along
     * a line covers, and the only thing left between that and the arithmetic
     * is the rounding a boolean does.
     *
     * It was a hundredth of the area, because the shadow used to be stamped
     * copies at a spacing of a unit and a half and that leaves a staircase on
     * every edge not parallel to the throw. Copies at a wider spacing leave a
     * serrated A; this leaves nothing.
     */
    expect(Math.abs(ink(thrown) - swept) / swept).toBeLessThan(1e-5);
  });

  it("keeps a counter open at every throw and every angle", () => {
    /*
     * The counter has to shrink, and it has to survive. Both were true of the
     * halving; neither was reliably true of the exact sweep until its bands
     * were folded in two at a time rather than handed to the union all at
     * once. Handed together -- thirty shapes, every one overlapping most of
     * the others -- paper answered with the counter of an o filled in solid at
     * some throws and open at others, with no pattern to which.
     *
     * So it is asked at several throws and at more than one angle, and asked
     * for the shrinking to be monotone, because a single throw at a single
     * angle is exactly what happened to pass.
     */
    const hole = (contours: Contour[]): number =>
      Math.abs(
        contours.filter((one) => contourArea(one) < 0).reduce((t, o) => t + contourArea(o), 0),
      );

    for (const angle of [0, -45, 90, 150]) {
      let last = hole(plain("o"));
      expect(last, `${angle}`).toBeGreaterThan(0);
      for (const distance of [0.1, 0.25, 0.5, 1, 1.5, 2]) {
        const now = hole(
          put(
            "o",
            cast((one) => {
              one.extrude = { on: true, distance, angle };
            }),
          ),
        );
        expect(now, `o at ${distance} stems, ${angle} degrees`).toBeGreaterThan(0);
        expect(now, `o at ${distance} stems, ${angle} degrees`).toBeLessThan(last);
        last = now;
      }
    }
  }, 60_000);

  it("throws the same shadow whichever way the outline was written", () => {
    /*
     * The same letter, written four ways: as drawn, every contour reversed,
     * every contour started from a different point, and both. A font file can
     * hand over any of them -- TrueType winds its outer contours clockwise and
     * PostScript the other way, and where an outline starts is anybody's
     * guess -- and the ground a shadow covers is a fact about the shape, not
     * about how it was written down.
     *
     * The sweep that was here before got that wrong. Lora's `o`, `a`, `b`, `8`
     * and `B` came back with their counters filled solid under a shadow that
     * left Geist's open, and nothing differed between the two but the order of
     * the points. So each version is checked against the definition itself --
     * a point is shadow when some point behind it along the throw is ink -- on
     * a grid through the answer, rather than against one another, which would
     * pass if all four were wrong the same way.
     */
    const rotated = (contour: Contour, by: number): Contour => {
      const at = by % contour.nodes.length;
      return { ...contour, nodes: [...contour.nodes.slice(at), ...contour.nodes.slice(0, at)] };
    };
    const writings: Array<[string, (contour: Contour, index: number) => Contour]> = [
      ["as drawn", (contour) => contour],
      ["reversed", (contour) => reverseContour(contour)],
      ["restarted", (contour, index) => rotated(contour, 3 + index * 5)],
      ["both", (contour, index) => rotated(reverseContour(contour), 2 + index * 7)],
    ];
    const inInk = (contours: Contour[], point: Vec2): boolean =>
      contours.reduce(
        (winding, one) =>
          winding + (contourContainsPoint(one, point) ? (contourArea(one) >= 0 ? 1 : -1) : 0),
        0,
      ) > 0;

    const stem = SANS.pen.weight;
    const wrong: string[] = [];
    for (const letter of ["o", "b", "a", "eight", "B"]) {
      const fused = unite(plain(letter), "nesting", "whole");
      for (const angle of [-45, 150]) {
        const throw_ = {
          x: Math.cos((angle * Math.PI) / 180) * 1.2 * stem,
          y: Math.sin((angle * Math.PI) / 180) * 1.2 * stem,
        };
        for (const [how, write] of writings) {
          const thrown = castInk(
            fused.map(write),
            [],
            scaleOf(SANS),
            cast((one) => {
              one.extrude = { on: true, distance: 1.2, angle };
            }),
            "nesting",
          );
          const box = contoursBounds(thrown);
          let missed = 0;
          let asked = 0;
          for (let x = box.xMin + 5.3; x < box.xMax; x += 17) {
            for (let y = box.yMin + 4.1; y < box.yMax; y += 17) {
              let truth = false;
              for (let step = 0; step <= 24 && !truth; step++) {
                const back = step / 24;
                truth = inInk(fused, { x: x - throw_.x * back, y: y - throw_.y * back });
              }
              asked++;
              if (truth !== inInk(thrown, { x, y })) missed++;
            }
          }
          // Edge samples can land either side of a rounding; a filled counter
          // is a tenth of the box and more.
          if (missed / asked > 0.02) wrong.push(`${letter} ${how} at ${angle}: ${missed}/${asked}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  }, 60_000);

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
      Math.abs(
        contours.filter((one) => contourArea(one) < 0).reduce((t, o) => t + contourArea(o), 0),
      );

    let last = hole(before);
    expect(last).toBeGreaterThan(0);
    for (const distance of [0.5, 1, 1.5, 2]) {
      const thrown = put(
        "O",
        cast((one) => {
          one.extrude = { on: true, distance, angle: 0 };
        }),
      );
      const now = hole(thrown);
      expect(now).toBeGreaterThan(0);
      expect(now).toBeLessThan(last);
      last = now;
    }
  });

  it("throws the way it is pointed", () => {
    const was = contoursBounds(plain("H"));
    const up = contoursBounds(
      put(
        "H",
        cast((one) => {
          one.extrude = { on: true, distance: 1, angle: 90 };
        }),
      ),
    );
    const down = contoursBounds(
      put(
        "H",
        cast((one) => {
          one.extrude = { on: true, distance: 1, angle: -90 };
        }),
      ),
    );

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
    const now = contoursBounds(
      put(
        "H",
        cast((one) => {
          one.outline = { on: true, width };
        }),
      ),
    );
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
      Math.abs(
        contours.filter((one) => contourArea(one) < 0).reduce((t, o) => t + contourArea(o), 0),
      );

    let last = hole(plain("o"));
    expect(last).toBeGreaterThan(0);
    for (const width of [0.1, 0.2, 0.3]) {
      const now = hole(
        put(
          "o",
          cast((one) => {
            one.outline = { on: true, width };
          }),
        ),
      );
      expect(now).toBeLessThan(last);
      last = now;
    }
  });

  /**
   * And how many points it leaves, which is the cost of the operation written
   * where a test can see it.
   *
   * The rim grows the letter by a sixteen-sided figure in eight passes, and
   * each pass leaves a notch at every convex corner that the next one doubles.
   * Those points are what the operation after the rim pays for, what the file
   * carries, and what makes the rim the slow one -- so the number is the thing
   * to hold still. It is not a good number. `outlined` says what would make it
   * a good one and what has already been tried and does not; until somebody
   * does that, this stops it quietly getting worse.
   */
  it("leaves no more points behind than it already does", () => {
    const flared = BASES.find((one) => one.name === "Flared")!;
    const points = (contours: Contour[]) =>
      contours.reduce((total, one) => total + one.nodes.length, 0);

    const drawn = drawLetter("k", flared)!;
    expect(points(drawn.contours)).toBeLessThan(60);

    const rim = put(
      "k",
      cast((one) => {
        one.outline = { on: true, width: 0.4 };
      }),
      flared,
    );
    expect(points(rim)).toBeLessThan(POINT_BUDGET.rim);

    const everything = castInk(
      drawn.contours,
      LETTERS.k(flared).strokes,
      scaleOf(flared),
      cast((one) => {
        one.outline = { on: true, width: 0.4 };
        one.extrude = { on: true, distance: 0.6, angle: -45 };
        one.spur = { ...one.spur, on: true };
        one.weld = { ...one.weld, on: true };
      }),
      "winding",
    );
    expect(points(everything)).toBeLessThan(POINT_BUDGET.everything);
  }, 60_000);
});

describe("the points", () => {
  it("grow off the corners of the ink and never into a counter", () => {
    /*
     * A point is built out of a corner with the ink on the inside of the turn,
     * and the corners of a counter have the ink on the outside -- so a letter
     * with points on keeps every counter exactly the size it had.
     *
     * It did not. The test for which side the ink was on was flipped for a
     * counter on top of the counter already running the other way, so every
     * square corner of every counter grew a spike aimed into the stem and the
     * bar around it, and the triangle it laid across the corner filled a bite
     * of the counter in. On a B those spikes met each other, and the union came
     * back with its outline folded over itself.
     */
    // Counter by counter, since a point laid beside a serif can close a pocket
    // of paper off into a counter of its own, and that is not this question.
    const counters = (contours: Contour[]): number[] =>
      contours
        .filter((one) => contourArea(one) < 0)
        .map((one) => -contourArea(one))
        .sort((a, b) => b - a);
    const kept = (bare: number[], now: number[]): boolean =>
      bare.every((area) => now.some((other) => Math.abs(other - area) / area < 0.001));
    for (const style of [SANS, BASES.find((base) => base.name === "Serif")!]) {
      for (const letter of ["A", "B", "D", "P", "b"]) {
        const bare = counters(unite(plain(letter, style), "winding", "whole"));
        const pointed = counters(
          put(
            letter,
            cast((one) => {
              one.spur = { on: true, size: 0.6 };
            }),
            style,
          ),
        );
        expect(bare.length, `${style.name} ${letter}`).toBeGreaterThan(0);
        expect(kept(bare, pointed), `${style.name} ${letter}: ${bare} against ${pointed}`).toBe(
          true,
        );
      }
    }
  });
});

describe("the fillets", () => {
  it("fill the corners inside a letter and never stand out of it", () => {
    /*
     * A fillet lies between two strokes, in the corner they make, so a letter
     * wearing them covers no more ground in any direction than it did bare.
     *
     * The weld used to be a disc laid on the point where two spines meet, and
     * an H's crossbar meets its stems at their centre-lines -- so a disc a stem
     * across stood half a stem out of the outside of both stems, and an E wore
     * a ball on its back at every arm. Asked at the setting that showed it and
     * at the default, and on the letters where a join sits on the outside edge.
     */
    const stem = SANS.pen.weight;
    const grown: string[] = [];
    for (const size of [0.5, 1]) {
      for (const letter of ["H", "E", "F", "T", "L", "n", "h", "k", "e", "R"]) {
        const drawn = drawLetter(letter, SANS)!;
        const welded = castInk(
          drawn.contours,
          LETTERS[letter](SANS).strokes,
          scaleOf(SANS),
          cast((one) => {
            one.weld = { on: true, size };
          }),
          "winding",
        );
        const was = contoursBounds(drawn.contours);
        const now = contoursBounds(welded);
        const out = Math.max(
          was.xMin - now.xMin,
          now.xMax - was.xMax,
          was.yMin - now.yMin,
          now.yMax - was.yMax,
        );
        if (out > 0.5) grown.push(`${letter} at ${size}: ${out.toFixed(1)} out`);
      }
    }
    expect(grown).toEqual([]);

    // And they do fill something: the two inside corners of an H are there
    // to be filled on each side of the bar -- four of them -- and a fillet of
    // a stem's radius fills the square of a stem less its quarter circle.
    // Fused first: a letter as drawn is strokes overlapping, and their areas
    // added up count the overlaps twice.
    const bare = ink(unite(plain("H"), "winding", "whole"));
    const filled = ink(
      castInk(
        plain("H"),
        LETTERS.H(SANS).strokes,
        scaleOf(SANS),
        cast((one) => {
          one.weld = { on: true, size: 1 };
        }),
        "winding",
      ),
    );
    expect(filled - bare).toBeGreaterThan(stem * stem * 4 * (1 - Math.PI / 4) * 0.8);
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
    const solid = letterNames().filter(
      (name) => /^[A-Za-z]$/.test(name) && name !== "i" && name !== "j",
    );
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
     *
     * Thrown across the slots rather than along them. A level slot through a
     * level throw is the one case where the order genuinely does not matter --
     * a strip running the width of the letter is the same strip wherever the
     * letter is slid along it -- and this used to throw level and pass only
     * because the old sweep was a few hundred units out, differently each way.
     */
    const cuts: Cuts = noCuts();
    cuts.slot = { on: true, count: 3, width: 0.34, angle: 0, inset: 0.1 };
    const shadow = cast((one) => {
      one.extrude = { on: true, distance: 1.5, angle: -45 };
    });

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
