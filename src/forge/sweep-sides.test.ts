/**
 * The sweep's hooks for the soft finishes, with nothing yet hung on them,
 * drawing what the sweep always drew.
 *
 * An end built from where its sides really stop (`sides`) is the end the pen
 * builds, whenever the sides are where the pen put them; and the seams
 * `joinedAtSeams` reports (`marks`) leave the outline as it was and point at
 * the corners of each end.
 */

import { describe, expect, it, vi } from "vitest";

import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { softCorners } from "./ends";
import {
  type EndSides,
  joinedAtSeams,
  leftOf,
  penReach,
  reachAlong,
  type SeamMark,
  sweep,
  terminalNodes,
} from "./sweep";
import { signatureText } from "./testing/signature";
import type { Pen, Spine, Stroke, Terminal } from "./types";

// The corners are handed on untouched, as they are until they are rounded,
// and every call is kept so the marks can be read.
vi.mock("./ends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ends")>();
  return { ...actual, softCorners: vi.fn(actual.softCorners) };
});

const PENS: Pen[] = [12, 87, 260].flatMap((weight) => [
  { weight, contrast: 0, angle: 0 },
  { weight, contrast: 0.55, angle: 8 },
  { weight, contrast: 0.7, angle: -18 },
]);

const line = (from: Vec2, to: Vec2): Spine => ({
  segments: [{ kind: "line", from, to }],
  closed: false,
});
const arc = (from: number, to: number, positive: boolean): Spine => ({
  segments: [
    {
      kind: "arc",
      centre: { x: 0, y: 0 },
      radius: 300,
      startAngle: (from * Math.PI) / 180,
      endAngle: (to * Math.PI) / 180,
      sweepPositive: positive,
    },
  ],
  closed: false,
});

const SPINES: Array<[string, Spine, boolean]> = [
  ["a diagonal line", line({ x: 0, y: 0 }, { x: 80, y: 300 }), true],
  ["a level line", line({ x: 0, y: 0 }, { x: 300, y: 0 }), true],
  ["an arc anticlockwise", arc(210, 330, true), false],
  ["an arc clockwise", arc(150, 30, false), false],
];

const TERMINALS: Array<[string, Terminal]> = [
  ["butt", { kind: "butt" }],
  ["level", { kind: "butt", level: true }],
  ["level, sunk", { kind: "butt", level: true, sink: 12 }],
  ["aligned", { kind: "butt", aligned: true }],
  ["angled", { kind: "angled", angle: 25 }],
  ["angled back", { kind: "angled", angle: -15 }],
  ["round", { kind: "round" }],
  ["slab", { kind: "slab", projection: 30, thickness: 20 }],
  ["slab, level", { kind: "slab", level: true, projection: 30, thickness: 20 }],
  ["teardrop", { kind: "teardrop" }],
];

/** The far end of a one-piece spine: where it stops, and which way it is going. */
function farEnd(spine: Spine): { at: Vec2; direction: Vec2 } {
  const segment = spine.segments[0];
  if (segment.kind === "line") {
    const d = { x: segment.to.x - segment.from.x, y: segment.to.y - segment.from.y };
    const length = Math.hypot(d.x, d.y);
    return { at: segment.to, direction: { x: d.x / length, y: d.y / length } };
  }
  const way = segment.sweepPositive ? 1 : -1;
  const angle = segment.endAngle;
  return {
    at: {
      x: segment.centre.x + segment.radius * Math.cos(angle),
      y: segment.centre.y + segment.radius * Math.sin(angle),
    },
    direction: { x: -Math.sin(angle) * way, y: Math.cos(angle) * way },
  };
}

/** The near end of a one-piece spine: where it starts, and which way is out past it. */
function nearEnd(spine: Spine): { at: Vec2; direction: Vec2 } {
  const segment = spine.segments[0];
  if (segment.kind === "line") {
    const d = { x: segment.from.x - segment.to.x, y: segment.from.y - segment.to.y };
    const length = Math.hypot(d.x, d.y);
    return { at: segment.from, direction: { x: d.x / length, y: d.y / length } };
  }
  const way = segment.sweepPositive ? 1 : -1;
  const angle = segment.startAngle;
  return {
    at: {
      x: segment.centre.x + segment.radius * Math.cos(angle),
      y: segment.centre.y + segment.radius * Math.sin(angle),
    },
    direction: { x: Math.sin(angle) * way, y: -Math.cos(angle) * way },
  };
}

/** Every coordinate of two node lists within `tolerance`, and the same handles missing. */
function sameNodes(one: GlyphNode[], other: GlyphNode[], tolerance = 1e-9): string | null {
  if (one.length !== other.length) return `${one.length} nodes against ${other.length}`;
  for (let index = 0; index < one.length; index++) {
    for (const key of ["point", "handleIn", "handleOut"] as const) {
      const a = one[index][key];
      const b = other[index][key];
      if ((a === null) !== (b === null)) return `node ${index} ${key}: one missing`;
      if (a && b && Math.hypot(a.x - b.x, a.y - b.y) > tolerance) {
        return `node ${index} ${key} ${Math.hypot(a.x - b.x, a.y - b.y)} apart`;
      }
    }
  }
  return null;
}

function sameContours(one: Contour[], other: Contour[]): string | null {
  if (signatureText(one) !== signatureText(other)) {
    return `${signatureText(one)} against ${signatureText(other)}`;
  }
  for (let index = 0; index < one.length; index++) {
    const wrong = sameNodes(one[index].nodes, other[index].nodes);
    if (wrong) return `contour ${index}: ${wrong}`;
  }
  return null;
}

describe("an end built on its sides", () => {
  it("is the end the pen builds, where the sides are where the pen put them", () => {
    const wrong: string[] = [];
    for (const [spineName, spine, straight] of SPINES) {
      const { at, direction } = farEnd(spine);
      for (const pen of PENS) {
        const reach = penReach(pen);
        const shift = reachAlong(leftOf(direction), reach);
        const sides: EndSides = {
          left: { at: { x: at.x + shift.x, y: at.y + shift.y }, dir: direction },
          right: { at: { x: at.x - shift.x, y: at.y - shift.y }, dir: direction },
        };
        for (const [name, terminal] of TERMINALS) {
          const plain = terminalNodes(terminal, at, direction, reach, straight);
          const sided = terminalNodes(terminal, at, direction, reach, straight, sides);
          const differs = sameNodes(plain, sided);
          if (differs)
            wrong.push(`${name} on ${spineName}, pen ${JSON.stringify(pen)}: ${differs}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  /*
   * And through the sweep, with the sides taken from the runs it drew: a
   * heft of nothing, and an end asked to swell and taper by nothing, both
   * send the ends through `sides` with the runs left where they were.
   */
  it("sweeps a stroke the same with its sides read back off the runs", () => {
    const wrong: string[] = [];
    for (const [spineName, spine] of SPINES) {
      for (const pen of PENS) {
        for (const [name, terminal] of TERMINALS) {
          const stroke: Stroke = { spine, pen, start: terminal, end: terminal };
          const plain = sweep(stroke);
          const hefted = sweep({ ...stroke, heft: { share: 0, tilt: 0 } });
          const shaped = sweep({
            ...stroke,
            start: { ...terminal, taper: 1 },
            end: { ...terminal, swell: 1 },
          });
          const label = `${name} on ${spineName}, pen ${JSON.stringify(pen)}`;
          const one = sameContours(plain, hefted);
          if (one) wrong.push(`${label}, heft: ${one}`);
          const other = sameContours(plain, shaped);
          if (other) wrong.push(`${label}, shaped: ${other}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  /*
   * And where the sides are somewhere else -- an end swelled by a fifth, its
   * sides leaning out as they reach it -- the corners are built on them.
   */
  it("follows sides that are not where the pen put them", () => {
    const pen: Pen = { weight: 87, contrast: 0, angle: 0 };
    const reach = penReach(pen);
    const near = (p: Vec2, q: Vec2) => expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-9);
    const onLine = (p: Vec2, through: Vec2, way: Vec2) =>
      expect(Math.abs((p.x - through.x) * way.y - (p.y - through.y) * way.x)).toBeLessThan(1e-9);
    for (const [, spine, straight] of SPINES) {
      const { at, direction } = farEnd(spine);
      const shift = reachAlong(leftOf(direction), reach);
      const lean = 0.08;
      const turned = (sign: number): Vec2 => {
        const c = Math.cos(lean * sign);
        const s = Math.sin(lean * sign);
        return { x: direction.x * c - direction.y * s, y: direction.x * s + direction.y * c };
      };
      const sides: EndSides = {
        left: { at: { x: at.x + shift.x * 1.2, y: at.y + shift.y * 1.2 }, dir: turned(1) },
        right: { at: { x: at.x - shift.x * 1.2, y: at.y - shift.y * 1.2 }, dir: turned(-1) },
      };
      const build = (terminal: Terminal) =>
        terminalNodes(terminal, at, direction, reach, straight, sides);

      // Cut square: the corners are the sides' own ends.
      const butt = build({ kind: "butt" });
      near(butt[0].point, sides.left.at);
      near(butt[1].point, sides.right.at);

      // Slid: each corner along its own side, onto the line or the upright.
      if (Math.abs(direction.y) > 1e-3) {
        const level = build({ kind: "butt", level: true });
        for (const [corner, side] of [
          [level[0], sides.left],
          [level[1], sides.right],
        ] as const) {
          expect(corner.point.y).toBeCloseTo(at.y, 9);
          onLine(corner.point, side.at, side.dir);
        }
      } else {
        const plumb = build({ kind: "butt", level: true });
        for (const [corner, side] of [
          [plumb[0], sides.left],
          [plumb[1], sides.right],
        ] as const) {
          expect(corner.point.x).toBeCloseTo(at.x, 9);
          onLine(corner.point, side.at, side.dir);
        }
      }

      // An angled cut slides as far again as the end is wider, along each side.
      const angled = build({ kind: "angled", angle: 20 });
      const slide = Math.tan((20 * Math.PI) / 180) * reach.across * 1.2;
      const [on, back] = straight ? [slide, -slide] : [2 * slide, 0];
      near(angled[0].point, {
        x: sides.left.at.x + sides.left.dir.x * on,
        y: sides.left.at.y + sides.left.dir.y * on,
      });
      near(angled[1].point, {
        x: sides.right.at.x + sides.right.dir.x * back,
        y: sides.right.at.y + sides.right.dir.y * back,
      });

      // A round cap from corner to corner, as deep again as the end is wider.
      const round = build({ kind: "round" });
      near(round[0].point, sides.left.at);
      near(round[round.length - 1].point, sides.right.at);
      const tip = round[1].point;
      const out = (tip.x - at.x) * direction.x + (tip.y - at.y) * direction.y;
      expect(out).toBeCloseTo(reach.across * 1.2, 6);
    }
  });

  it("leaves a ring as it was", () => {
    const ring: Stroke = {
      spine: {
        segments: [
          {
            kind: "arc",
            centre: { x: 0, y: 0 },
            radius: 200,
            startAngle: 0,
            endAngle: Math.PI * 2,
            sweepPositive: true,
          },
        ],
        closed: true,
      },
      pen: { weight: 87, contrast: 0.55, angle: 8 },
      start: { kind: "butt" },
      end: { kind: "butt" },
    };
    expect(sweep({ ...ring, heft: { share: 0, tilt: 0 } })).toEqual(sweep(ring));
  });
});

describe("the seams of a joined outline", () => {
  const node = (x: number, y: number): GlyphNode => ({
    point: { x, y },
    handleIn: null,
    handleOut: null,
    type: "corner",
  });

  it("are where each run landed, welded or not", () => {
    // A butt stroke: each end's corners are the sides' own last points.
    const welded = (): GlyphNode[][] => [
      [node(-10, 0), node(-10, 100)],
      [node(-10, 100), node(10, 100)],
      [node(10, 100), node(10, 0)],
      [node(10, 0), node(-10, 0)],
    ];
    const marks: SeamMark[] = [];
    const joined = joinedAtSeams(welded(), marks);
    expect(joined).toEqual(joinedAtSeams(welded()));
    expect(joined).toHaveLength(4);
    expect(marks).toEqual([
      { first: 0, last: 1 },
      { first: 1, last: 2 },
      { first: 2, last: 3 },
      { first: 3, last: 0 },
    ]);

    // Slid cuts replace the sides' last points, so nothing is welded.
    const slid = (): GlyphNode[][] => [
      [node(-10, 0), node(-10, 95)],
      [node(-12, 100), node(12, 100)],
      [node(10, 95), node(10, 5)],
      [node(12, 0), node(-12, 0)],
    ];
    const apart: SeamMark[] = [];
    expect(joinedAtSeams(slid(), apart)).toEqual(joinedAtSeams(slid()));
    expect(apart).toEqual([
      { first: 0, last: 1 },
      { first: 2, last: 3 },
      { first: 4, last: 5 },
      { first: 6, last: 7 },
    ]);

    // A cut carried along the curve leaves its end with no nodes of its own.
    const none: SeamMark[] = [];
    joinedAtSeams([[node(0, 0), node(0, 100)], [], [node(20, 100), node(20, 0)], []], none);
    expect(none).toEqual([
      { first: 0, last: 1 },
      { first: -1, last: -1 },
      { first: 2, last: 3 },
      { first: -1, last: -1 },
    ]);
  });

  /*
   * Asked for by an end that is to have its corners rounded, the marks find
   * those corners in the stroke as it is swept -- each end's run from its
   * left corner to its right, the near end's left being the stroke's right
   * -- and the outline is the one drawn without them.
   */
  it("point at the corners of each end of a swept stroke", () => {
    const spy = vi.mocked(softCorners);
    const pen: Pen = { weight: 87, contrast: 0.55, angle: 8 };
    const reach = penReach(pen);
    for (const terminal of [
      { kind: "butt" },
      { kind: "butt", level: true },
      { kind: "angled", angle: 20 },
      { kind: "round" },
    ] as Terminal[]) {
      for (const spine of [line({ x: 0, y: 0 }, { x: 80, y: 300 }), arc(210, 330, true)]) {
        const stroke: Stroke = { spine, pen, start: terminal, end: terminal };
        const calls = spy.mock.calls.length;
        const plain = sweep(stroke);
        expect(spy.mock.calls.length).toBe(calls);
        const soft = sweep({ ...stroke, end: { ...terminal, soft: { left: 0, right: 0 } } });
        expect(spy.mock.calls.length).toBe(calls + 1);
        expect(soft).toEqual(plain);

        const [nodes, marks] = spy.mock.calls[calls] as [GlyphNode[], SeamMark[], Stroke];
        expect(marks).toHaveLength(4);
        const straight = spine.segments[0].kind === "line";
        const { at, direction } = farEnd(spine);
        const ends = terminalNodes(terminal, at, direction, reach, straight);
        if (ends.length === 0) continue;
        const near = (index: number, point: Vec2) => {
          expect(index).toBeGreaterThanOrEqual(0);
          const there = nodes[index].point;
          expect(Math.hypot(there.x - point.x, there.y - point.y)).toBeLessThan(1e-6);
        };
        near(marks[1].first, ends[0].point);
        near(marks[1].last, ends[ends.length - 1].point);
        // The left side runs up to the far end's left corner, and the right
        // side comes back from its right one -- where a side has any nodes
        // left: two level cuts on one straight run replace all of them.
        if (marks[0].last >= 0) expect(marks[0].last).toBeLessThanOrEqual(marks[1].first);
        if (marks[2].first >= 0) expect(marks[2].first).toBeGreaterThanOrEqual(marks[1].last);
        // And the near end's left corner is the stroke's right side's start.
        const back = nearEnd(spine);
        const start = terminalNodes(terminal, back.at, back.direction, reach, straight);
        near(marks[3].first, start[0].point);
        near(marks[3].last, start[start.length - 1].point);
      }
    }
  });
});
