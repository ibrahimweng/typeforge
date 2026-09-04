/**
 * The parametric shapes, checked against what they claim to be.
 *
 * A bowl that is supposed to be a circle when its corners are fully rounded had
 * better be one, and the part of a bowl between two directions had better start
 * and finish in those directions whether the bowl is round or square. Both are
 * measurable, so both are measured rather than looked at.
 */

import { describe, expect, it } from "vitest";

import { contourArea, contoursBounds } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { bowl, bowlBetween, bowlRadius, roundCorners, wavy } from "./shapes";
import { sweep } from "./sweep";
import type { Pen, Spine, Stroke } from "./types";

const MONOLINE: Pen = { weight: 80, contrast: 0, angle: 0 };
const centre = { x: 300, y: 300 };

const drawn = (spine: Spine): Stroke => ({
  spine,
  pen: MONOLINE,
  start: { kind: "butt" },
  end: { kind: "butt" },
});

const degrees = (point: { x: number; y: number }): number =>
  ((Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI + 360) % 360;

describe("a bowl", () => {
  it("is a circle when its corners are as round as they go", () => {
    const round = bowl(centre, 200, 200, 1, 40);
    /*
     * Nine pieces at every shape, four of which travel: a bowl is a rounded
     * rectangle, and the runs between its corners are kept even where the
     * corners have taken all the length out of them.
     *
     * Kept, rather than dropped for being empty, because the number of nodes
     * in the swept letter follows the number of pieces in its spine -- so
     * dropping them made an o seven nodes at a Thin, four at a Regular and six
     * at a Bold, for a shape that is the same shape throughout. See
     * `bowlSegments`.
     */
    expect(round.segments).toHaveLength(9);
    const travelling = round.segments.filter((segment) =>
      segment.kind === "arc"
        ? Math.abs(segment.endAngle - segment.startAngle) > 1e-9
        : Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > 1e-9,
    );
    expect(travelling).toHaveLength(4);
    expect(travelling.every((segment) => segment.kind === "arc")).toBe(true);

    // And it is a circle: every corner of it turns about the same middle, at
    // the same radius, which is what the four quarters being all there means.
    for (const segment of travelling) {
      if (segment.kind !== "arc") continue;
      expect(segment.radius).toBeCloseTo(200, 6);
      expect(Math.hypot(segment.centre.x - centre.x, segment.centre.y - centre.y)).toBeCloseTo(
        0,
        6,
      );
    }
  });

  it("is a rectangle with rounded corners when they are not", () => {
    const squared = bowl(centre, 200, 200, 0, 40);
    const lines = squared.segments.filter((segment) => segment.kind === "line");
    const arcs = squared.segments.filter((segment) => segment.kind === "arc");
    expect(arcs).toHaveLength(4);
    // Five, not four: the run up the right-hand side is written as two, because
    // the loop starts halfway along it at the rightmost point.
    expect(lines).toHaveLength(5);
  });

  it("fills more of its box the squarer it is", () => {
    const area = (roundness: number) =>
      Math.abs(contourArea(sweep(drawn(bowl(centre, 200, 200, roundness, 40)))[0]));
    expect(area(0)).toBeGreaterThan(area(1));
  });

  it("stays inside its box at every squareness", () => {
    for (const roundness of [0, 0.25, 0.5, 0.75, 1]) {
      const bounds = contoursBounds(sweep(drawn(bowl(centre, 200, 160, roundness, 40))));
      // The box plus the pen either side of it, and no more.
      expect(bounds.xMax).toBeLessThanOrEqual(300 + 200 + 40 + 1e-6);
      expect(bounds.yMax).toBeLessThanOrEqual(300 + 160 + 40 + 1e-6);
    }
  });

  it("never draws a counter that has turned inside out", () => {
    for (const roundness of [0, 0.25, 0.5, 0.75, 1]) {
      for (const weight of [20, 80, 160, 240]) {
        const contours = sweep({
          ...drawn(bowl(centre, 200, 160, roundness, weight / 2)),
          pen: { ...MONOLINE, weight },
        });
        expect(contoursIntersect(contours), `roundness ${roundness} at weight ${weight}`).toBe(
          false,
        );
      }
    }
  });

  it("holds its corners at half the pen, however square it is asked to be", () => {
    /*
     * Which is the whole promise: a stroke cannot turn tighter than half its own
     * width without the inside of the turn folding, so it never is asked to.
     *
     * A few per cent above that rather than exactly at it. At exactly half, the
     * inner edge has no radius left and its arc collapses to a point, so the
     * outline comes back with a coordinate written twice where a curve should
     * be -- which a squared-off figure eight at a hairline weight did, and which
     * reads as the outline crossing itself.
     */
    expect(bowlRadius(200, 200, 0, 40)).toBeCloseTo(42.4, 6);
    expect(bowlRadius(200, 200, 0, 90)).toBeCloseTo(95.4, 6);
    expect(bowlRadius(200, 200, 1, 40)).toBe(200);
    // Never past the shape, however wide the pen gets.
    expect(bowlRadius(200, 160, 0, 400)).toBe(160);
  });
});

describe("part of a bowl", () => {
  it("starts and ends in the directions it was given", () => {
    for (const roundness of [0, 0.5, 1]) {
      const run = bowlBetween(centre, 200, 200, roundness, 40, 55, 305);
      const first = run.segments[0];
      const last = run.segments[run.segments.length - 1];
      const from =
        first.kind === "line"
          ? first.from
          : {
              x: first.centre.x + first.radius * Math.cos(first.startAngle),
              y: first.centre.y + first.radius * Math.sin(first.startAngle),
            };
      const to =
        last.kind === "line"
          ? last.to
          : {
              x: last.centre.x + last.radius * Math.cos(last.endAngle),
              y: last.centre.y + last.radius * Math.sin(last.endAngle),
            };
      expect(degrees(from), `roundness ${roundness}`).toBeCloseTo(55, 4);
      expect(degrees(to), `roundness ${roundness}`).toBeCloseTo(305, 4);
    }
  });

  it("runs the long way round, not the short one", () => {
    // Fifty-five to three hundred and five anticlockwise is most of the ring,
    // which is what makes a c a c rather than the notch out of one.
    const long = bowlBetween(centre, 200, 200, 1, 40, 55, 305);
    const short = bowlBetween(centre, 200, 200, 1, 40, 305, 415);
    const span = (spine: Spine) =>
      spine.segments.reduce(
        (total, segment) =>
          total +
          (segment.kind === "arc"
            ? segment.radius * Math.abs(segment.endAngle - segment.startAngle)
            : 0),
        0,
      );
    expect(span(long)).toBeGreaterThan(span(short));
  });

  it("crosses the seam at the rightmost point without falling apart", () => {
    // The loop is written starting from the right, so a run through that point
    // is the one that would be cut in half by a careless walk.
    const run = bowlBetween(centre, 200, 200, 0.1, 40, 300, 420);
    expect(run.segments.length).toBeGreaterThan(0);
    const contour = sweep(drawn(run))[0];
    expect(contoursIntersect([contour])).toBe(false);
  });
});

describe("rounding a corner", () => {
  const elbow: Spine = {
    segments: [
      { kind: "line", from: { x: 0, y: 0 }, to: { x: 400, y: 0 } },
      { kind: "line", from: { x: 400, y: 0 }, to: { x: 400, y: 400 } },
    ],
    closed: false,
  };

  it("replaces the point with an arc tangent to both runs", () => {
    const rounded = roundCorners(elbow, 100, 40);
    expect(rounded.segments).toHaveLength(3);
    const arc = rounded.segments[1];
    expect(arc.kind).toBe("arc");
    if (arc.kind !== "arc") return;
    expect(arc.radius).toBeCloseTo(100, 6);
    expect(arc.centre.x).toBeCloseTo(300, 6);
    expect(arc.centre.y).toBeCloseTo(100, 6);
  });

  it("will not turn tighter than half the pen", () => {
    // Asked for twenty with a pen of a hundred and eighty, which would offset
    // the inside of the turn past its own centre. It is drawn at the limit
    // instead, plus the clearance that keeps the inner arc an arc.
    const rounded = roundCorners(elbow, 20, 90);
    const arc = rounded.segments[1];
    expect(arc.kind === "arc" && arc.radius).toBeCloseTo(95.4, 6);
  });

  it("will not eat a run shorter than the corner it is asked for", () => {
    const cramped: Spine = {
      segments: [
        { kind: "line", from: { x: 0, y: 0 }, to: { x: 60, y: 0 } },
        { kind: "line", from: { x: 60, y: 0 }, to: { x: 60, y: 400 } },
      ],
      closed: false,
    };
    const rounded = roundCorners(cramped, 300, 20);
    const arc = rounded.segments[1];
    expect(arc.kind === "arc" && arc.radius).toBeLessThanOrEqual(30 + 1e-6);
  });

  it("leaves a stroke whole at every radius and weight", () => {
    for (const radius of [0, 25, 50, 100, 200, 400]) {
      for (const weight of [20, 80, 160]) {
        const contours = sweep({
          ...drawn(roundCorners(elbow, radius, weight / 2)),
          pen: { ...MONOLINE, weight },
        });
        expect(contoursIntersect(contours), `radius ${radius} at weight ${weight}`).toBe(false);
      }
    }
  });
});

describe("a wave", () => {
  const run: Spine = {
    segments: [{ kind: "line", from: { x: 0, y: 300 }, to: { x: 800, y: 300 } }],
    closed: false,
  };
  const ends = (segment: (typeof run)["segments"][number]) =>
    segment.kind === "line"
      ? [segment.from, segment.to]
      : [
          {
            x: segment.centre.x + segment.radius * Math.cos(segment.startAngle),
            y: segment.centre.y + segment.radius * Math.sin(segment.startAngle),
          },
          {
            x: segment.centre.x + segment.radius * Math.cos(segment.endAngle),
            y: segment.centre.y + segment.radius * Math.sin(segment.endAngle),
          },
        ];
  /** Which way a piece is travelling where it starts and where it stops. */
  const ways = (segment: (typeof run)["segments"][number]) => {
    if (segment.kind === "line") {
      const dx = segment.to.x - segment.from.x;
      const dy = segment.to.y - segment.from.y;
      const length = Math.hypot(dx, dy) || 1;
      return [
        { x: dx / length, y: dy / length },
        { x: dx / length, y: dy / length },
      ];
    }
    const way = segment.endAngle >= segment.startAngle ? 1 : -1;
    return [segment.startAngle, segment.endAngle].map((angle) => ({
      x: -Math.sin(angle) * way,
      y: Math.cos(angle) * way,
    }));
  };

  it("begins and ends exactly where the straight run did", () => {
    const waved = wavy(run, 200, 40, 40, "flat");
    const first = ends(waved.segments[0])[0];
    const last = ends(waved.segments[waved.segments.length - 1])[1];
    expect(first.x).toBeCloseTo(0, 6);
    expect(first.y).toBeCloseTo(300, 6);
    expect(last.x).toBeCloseTo(800, 6);
    expect(last.y).toBeCloseTo(300, 6);
  });

  it("never leaves a gap or a kink between one piece and the next", () => {
    /*
     * Both halves matter. A gap is a stroke in two pieces; a kink is a corner,
     * and the sweep cuts a corner back by crossing the two offsets -- which
     * where a line meets an arc are a line and an ellipse, with no closed form
     * to cross. So the wave has to arrive at its straight stub travelling the
     * way the stub travels, and the first attempt, which met it at a right
     * angle, folded every letter it was applied to.
     */
    for (const depth of [5, 20, 40, 80, 160]) {
      const waved = wavy(run, 200, depth, 40, "flat");
      for (let index = 1; index < waved.segments.length; index++) {
        const before = waved.segments[index - 1];
        const after = waved.segments[index];
        const [, leaves] = ends(before);
        const [arrives] = ends(after);
        expect(
          Math.hypot(leaves.x - arrives.x, leaves.y - arrives.y),
          `gap at ${index}, depth ${depth}`,
        ).toBeLessThan(1e-6);
        const [, going] = ways(before);
        const [coming] = ways(after);
        expect(
          going.x * coming.x + going.y * coming.y,
          `kink at ${index}, depth ${depth}`,
        ).toBeCloseTo(1, 5);
      }
    }
  });

  it("holds every arc at half the pen, however deep it is asked to go", () => {
    for (const penHalf of [10, 40, 90, 130]) {
      for (const depth of [10, 60, 200]) {
        for (const segment of wavy(run, 160, depth, penHalf, "flat").segments) {
          if (segment.kind !== "arc") continue;
          expect(segment.radius, `pen ${penHalf}, depth ${depth}`).toBeGreaterThanOrEqual(
            penHalf * 1.06 - 1e-6,
          );
        }
      }
    }
  });

  it("leaves a straight piece at each end for a terminal to sit on", () => {
    const waved = wavy(run, 200, 40, 40, "flat");
    expect(waved.segments[0].kind).toBe("line");
    expect(waved.segments[waved.segments.length - 1].kind).toBe("line");
  });

  it("only touches the runs it was pointed at", () => {
    const upright: Spine = {
      segments: [{ kind: "line", from: { x: 0, y: 0 }, to: { x: 0, y: 700 } }],
      closed: false,
    };
    expect(wavy(upright, 200, 40, 40, "flat").segments).toHaveLength(1);
    expect(wavy(upright, 200, 40, 40, "upright").segments.length).toBeGreaterThan(1);
    expect(wavy(run, 200, 40, 40, "upright").segments).toHaveLength(1);
    expect(wavy(run, 200, 40, 40, "off").segments).toHaveLength(1);
  });

  it("draws a stroke that does not cross itself at any weight", () => {
    for (const weight of [16, 80, 160, 240]) {
      for (const depth of [10, 45, 120]) {
        const contours = sweep({
          ...drawn(wavy(run, 190, depth, weight / 2, "flat")),
          pen: { ...MONOLINE, weight },
        });
        expect(contoursIntersect(contours), `weight ${weight}, depth ${depth}`).toBe(false);
      }
    }
  });
});
