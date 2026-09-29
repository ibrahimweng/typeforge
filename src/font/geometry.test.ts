import { describe, expect, it } from "vitest";

import {
  crossesItself,
  crossesMoreThan,
  crossingsOf,
  overlapsMoreThan,
  rayHitDistance,
} from "./geometry";
import type { Contour, Vec2 } from "./types";
import { loopsAnywhere } from "../../test/outlines";

/** A square, wound however; only its edges matter here. */
const square = (x: number, y: number, size: number): Vec2[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

describe("rayHitDistance", () => {
  it("measures the distance to the first edge in the way", () => {
    expect(rayHitDistance([square(0, 0, 100)], { x: 50, y: 50 }, { x: 1, y: 0 })).toBeCloseTo(
      50,
      6,
    );
  });

  it("says nothing is in the way when nothing is", () => {
    expect(rayHitDistance([square(0, 0, 100)], { x: 200, y: 50 }, { x: 1, y: 0 })).toBe(Infinity);
  });

  it("ignores what is behind it", () => {
    // Facing away from the square entirely.
    expect(rayHitDistance([square(0, 0, 100)], { x: 200, y: 50 }, { x: -1, y: 0 })).toBeCloseTo(
      100,
      6,
    );
    expect(rayHitDistance([square(0, 0, 100)], { x: 150, y: 150 }, { x: 1, y: 1 })).toBe(Infinity);
  });

  /**
   * The crossing has to fall on the edge itself, not on the line the edge would
   * make if it ran on forever. Testing that the wrong way round meant a ray in
   * clear air read as blocked a few units away, because it caught the line
   * behind some edge nearby: every point on the outside of an a's bowl was told
   * it had nowhere to go, and the counter of an o could not open at all.
   */
  it("does not catch the line an edge sits on beyond its ends", () => {
    // A short edge well off to the right, whose line passes straight through
    // the ray's path.
    const stub: Vec2[] = [
      { x: 100, y: 400 },
      { x: 100, y: 300 },
    ];
    expect(rayHitDistance([stub], { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(Infinity);
    // The same edge, extended down to where the ray actually runs.
    const reaching: Vec2[] = [
      { x: 100, y: 400 },
      { x: 100, y: -400 },
    ];
    expect(rayHitDistance([reaching], { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(100, 6);
  });

  it("ignores the outline it is standing on", () => {
    // Starting on the left edge, facing across: the far edge answers, not the
    // one underfoot.
    expect(rayHitDistance([square(0, 0, 100)], { x: 0, y: 50 }, { x: 1, y: 0 })).toBeCloseTo(
      100,
      6,
    );
  });

  it("takes the nearest of several things in the way", () => {
    const near = square(200, 0, 100);
    const far = square(400, 0, 100);
    expect(rayHitDistance([far, near], { x: 0, y: 50 }, { x: 1, y: 0 })).toBeCloseTo(200, 6);
  });
});

/** A closed contour through the given corners, all of them corner nodes. */
const corners = (points: Vec2[]): Contour => ({
  closed: true,
  nodes: points.map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" })),
});

describe("crossesItself", () => {
  it("a square does not", () => {
    expect(crossesItself(corners(square(0, 0, 100)))).toBe(false);
  });

  it("a bowtie does", () => {
    expect(
      crossesItself(
        corners([
          { x: 0, y: 0 },
          { x: 100, y: 100 },
          { x: 100, y: 0 },
          { x: 0, y: 100 },
        ]),
      ),
    ).toBe(true);
  });

  /*
   * The shape a swept `e` makes: the outline of a band whose centre-line goes
   * round a square and then carries on past where it started, written down one
   * side and back up the other the way a sweep writes one. The crossings are
   * the real ones rather than a pair of lines drawn to cross.
   */
  it("a band that laps its own start does", () => {
    expect(
      crossesItself(
        corners([
          { x: 0, y: 20 },
          { x: 180, y: 20 },
          { x: 180, y: 180 },
          { x: 20, y: 180 },
          { x: 20, y: -60 },
          { x: -20, y: -60 },
          { x: -20, y: 220 },
          { x: 220, y: 220 },
          { x: 220, y: -20 },
          { x: 0, y: -20 },
        ]),
      ),
    ).toBe(true);
  });

  /*
   * Curves whose boxes overlap but which never meet. The cheap rejection has
   * to be a rejection and not the answer, or a C would be called self-crossing
   * because the boxes of its two ends sit on top of each other.
   */
  it("a C whose ends face each other does not", () => {
    const arc = (radius: number, from: number, to: number, steps: number): Vec2[] =>
      Array.from({ length: steps + 1 }, (_, i) => {
        const angle = from + ((to - from) * i) / steps;
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      });
    expect(crossesItself(corners([...arc(200, -1.2, 1.2, 12), ...arc(140, 1.2, -1.2, 12)]))).toBe(
      false,
    );
  });

  it("two nodes cannot cross anything", () => {
    expect(
      crossesItself(
        corners([
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ]),
      ),
    ).toBe(false);
  });
});

describe("crossesItself on long and open outlines", () => {
  const around = (count: number, point: (t: number) => { x: number; y: number }): Contour => ({
    closed: true,
    nodes: Array.from({ length: count }, (_, k) => ({
      point: point((k / count) * Math.PI * 2),
      handleIn: null,
      handleOut: null,
      type: "corner" as const,
    })),
  });

  // A figure-eight of a thousand points: past where the quick check,
  // contoursIntersect, stops asking -- where the rim round a detailed
  // letter lands.
  it("finds a crossing in an outline of many pieces", () => {
    const eight = around(1000, (t) => ({ x: Math.sin(2 * t) * 300, y: Math.sin(t) * 500 }));
    expect(crossesItself(eight)).toBe(true);
  });

  it("finds none in a round outline of as many", () => {
    const ring = around(1000, (t) => ({ x: Math.cos(t) * 300, y: Math.sin(t) * 500 }));
    expect(crossesItself(ring)).toBe(false);
  });

  it("does not close an open outline to find a crossing", () => {
    // Closed, the chord from the last point back to the first would cross
    // the middle piece; open, there is no such chord.
    const zigzag = (closed: boolean): Contour => ({
      closed,
      nodes: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ].map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" as const })),
    });
    expect(crossesItself(zigzag(true))).toBe(true);
    expect(crossesItself(zigzag(false))).toBe(false);
  });

  const curve = (from: Vec2, c1: Vec2, c2: Vec2, to: Vec2, rest: Vec2[]): Contour => ({
    closed: true,
    nodes: [
      { point: from, handleIn: null, handleOut: c1, type: "corner" as const },
      { point: to, handleIn: c2, handleOut: null, type: "corner" as const },
      ...rest.map((point) => ({ point, handleIn: null, handleOut: null, type: "corner" as const })),
    ],
  });

  // Found in review: the offset of a curve tighter than the weight ties a
  // loop inside the one curve, and a fold at a corner crosses the curve
  // beside it away from where they meet. Neither touches a third piece.
  it("finds a loop inside one curve", () => {
    const looped = curve(
      { x: 0, y: 0 },
      { x: 300, y: 300 },
      { x: -200, y: 300 },
      { x: 100, y: 0 },
      [
        { x: 100, y: -100 },
        { x: 0, y: -100 },
      ],
    );
    expect(crossesItself(looped, 32)).toBe(true);
  });

  it("finds the last curve crossing the first away from where they meet", () => {
    // Round the join of the outline: the curve back to the start rises
    // through the first piece before coming down onto its start.
    const around: Contour = {
      closed: true,
      nodes: [
        {
          point: { x: 0, y: 0 },
          handleIn: { x: 40, y: 60 },
          handleOut: null,
          type: "corner" as const,
        },
        { point: { x: 100, y: 0 }, handleIn: null, handleOut: null, type: "corner" as const },
        { point: { x: 100, y: -100 }, handleIn: null, handleOut: null, type: "corner" as const },
        {
          point: { x: 50, y: -100 },
          handleIn: null,
          handleOut: { x: 50, y: 100 },
          type: "corner" as const,
        },
      ],
    };
    expect(loopsAnywhere(around)).toBe(true);
    expect(crossesItself(around, 32)).toBe(true);
  });

  it("finds a curve crossing the piece beside it", () => {
    const folded: Contour = {
      closed: true,
      nodes: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" as const },
        {
          point: { x: 100, y: 0 },
          handleIn: null,
          handleOut: { x: 20, y: 100 },
          type: "corner" as const,
        },
        {
          point: { x: 50, y: -100 },
          handleIn: { x: 50, y: -50 },
          handleOut: null,
          type: "corner" as const,
        },
        { point: { x: 0, y: -100 }, handleIn: null, handleOut: null, type: "corner" as const },
      ],
    };
    expect(crossesItself(folded, 32)).toBe(true);
  });
});

describe("crossesMoreThan", () => {
  // A band whose two sides swap over at a twist, low or high up it.
  const band = (twistLow: boolean, twistHigh: boolean): Contour => {
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    for (const [y, twist] of [
      [0, false],
      [100, twistLow],
      [200, false],
      [300, twistHigh],
      [400, false],
    ] as const) {
      left.push(twist ? [100, y] : [0, y]);
      right.push(twist ? [0, y] : [100, y]);
    }
    return corners([...left, ...right.reverse()].map(([x, y]) => ({ x, y })));
  };

  it("lets a letter drawn crossing itself keep its crossings, or lose them", () => {
    const drawn = band(true, false);
    expect(crossingsOf(drawn)).toBe(2);
    expect(crossesMoreThan(drawn)(drawn)).toBe(false);
    expect(crossesMoreThan(drawn)(band(false, false))).toBe(false);
  });

  /*
   * Found in review: counted alone, a reshaping that undid the crossing a
   * letter was drawn with and tied a new one elsewhere came out even, and
   * passed. Where they are is compared, not only how many.
   */
  it("does not let it trade the crossing it had for one somewhere else", () => {
    const drawn = band(true, false);
    const moved = band(false, true);
    expect(crossingsOf(moved)).toBe(crossingsOf(drawn));
    expect(crossesMoreThan(drawn)(moved)).toBe(true);
  });

  /*
   * Found in review: where a reshaping added points -- a corner radius does
   * -- only how many crossings there were was compared, and the same trade
   * went through.
   */
  it("does not let it trade one where the points no longer line up either", () => {
    const drawn = band(true, false);
    const moved = band(false, true);
    const added: Contour = {
      closed: true,
      nodes: [
        moved.nodes[0],
        { ...moved.nodes[0], point: { x: 0, y: 50 } },
        ...moved.nodes.slice(1),
      ],
    };
    expect(crossesMoreThan(drawn)(added, 10)).toBe(true);
  });

  /*
   * Found in review: a radius merges points and adds others, and the same
   * number of them can come out with every curve at another place in the
   * outline, so a crossing kept where it was read as new. Where the points
   * do not line up, it is looked for by where it is.
   */
  it("finds a crossing it had by where it is where the points no longer line up", () => {
    const drawn = band(true, false);
    const turned: Contour = {
      closed: true,
      nodes: [...drawn.nodes.slice(3), ...drawn.nodes.slice(0, 3)],
    };
    expect(crossesMoreThan(drawn)(turned, 10)).toBe(false);
  });

  /*
   * Found in review: counted curve by curve, three crossings where two
   * curves meeting at a shallow angle made one -- their flattened pieces
   * waver across each other when either is nudged by a unit -- were two new
   * ones, and a reshaping was backed off for nothing.
   */
  it("takes three crossings at the one place it crossed for that one", () => {
    const bowtie = (wavering: boolean): Contour =>
      corners([
        { x: 0, y: 0 },
        { x: 48, y: 48 },
        wavering ? { x: 50, y: 51 } : { x: 49, y: 49 },
        wavering ? { x: 50, y: 49 } : { x: 51, y: 51 },
        { x: 52, y: 52 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ]);
    expect(crossingsOf(bowtie(false))).toBe(1);
    expect(crossingsOf(bowtie(true))).toBe(3);
    expect(crossesMoreThan(bowtie(false))(bowtie(true))).toBe(false);
  });
});

describe("overlapsMoreThan", () => {
  const rect = (x: number, y: number, width: number, height: number): Contour =>
    corners([
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ]);
  // A stem, and a bowl drawn as a contour of its own overlapping its left
  // side, as an unmerged font draws them.
  const stem = rect(0, 0, 100, 500);
  const drawn = [stem, rect(-200, 100, 220, 300)];

  it("lets contours drawn overlapping carry their overlap along", () => {
    expect(overlapsMoreThan(drawn)(drawn)).toBe(false);
    // Grown ten units all round: the same two crossings, moved with it.
    expect(overlapsMoreThan(drawn)([stem, rect(-210, 90, 240, 320)])).toBe(false);
    // Or pushed further into the stem, which crosses where it did.
    expect(overlapsMoreThan(drawn)([stem, rect(-200, 100, 260, 300)])).toBe(false);
  });

  /*
   * Found in review: counted pair by pair, a bowl pulled off the side of
   * the stem it overlapped and driven through the other side crossed it as
   * often as it had, and passed.
   */
  it("refuses a wall pulled off one side of a stem and through the other", () => {
    expect(overlapsMoreThan(drawn)([stem, rect(10, 100, 140, 300)])).toBe(true);
  });

  it("refuses contours that did not touch crossing", () => {
    const apart = [stem, rect(200, 100, 200, 300)];
    expect(overlapsMoreThan(apart)([stem, rect(50, 100, 350, 300)])).toBe(true);
  });
});
