/**
 * The inside roundings (`parts.corner.fillet`): where a stroke leaves another
 * it is buried in, where a bowl crosses a stem, and on the inside of a corner
 * one stroke turns.
 *
 * Each rounding of a join is an overlapping contour of its own -- three
 * nodes, the arc between the two edges it touches and a node tucked into the
 * ink behind the corner -- so these check that it is there at every weight
 * with the same nodes, that it fills the hollow it is for and nothing else,
 * that it touches both edges, and that where no corner can be found a sliver
 * of the same nodes stands in. A corner inside one stroke is rounded in the
 * sweep itself, on the same two pieces the point it replaces had.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { longEnoughFor } from "../../test/fixtures";

import { ready } from "@/font/boolean";
import { contourArea } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { drawLetter } from "./build";
import { widthedStyle } from "./family";
import { filletsFor, withInside } from "./fillet";
import { BUTT, shovedStroke, turnedStroke } from "./letters/common";
import { recipeOf } from "./letters";
import { flatten, windingAt } from "./soft";
import { SANS, SERIF, type Style } from "./style";
import { openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { sweep } from "./sweep";
import { foldSweep, withField } from "./testing/fold-sweep";
import { signatureOf, signatureText } from "./testing/signature";
import type { Stroke } from "./types";

const SLOW = longEnoughFor(120_000);

beforeAll(async () => {
  await ready();
});

const ON = withField(SERIF, "corner.fillet", 0.35);
const PENS = [30, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];

const atPen = (style: Style, weight: number, width = 100): Style =>
  widthedStyle({ ...style, pen: { ...style.pen, weight } }, width);
const drawIn = (name: string, style: Style) => drawLetter(name, style, style.forms?.[name])!;

/** The contours drawn with the rounding on that are not in the drawing without it. */
function added(
  name: string,
  weight: number,
): { all: Contour[]; fillets: Contour[]; rest: Contour[] } {
  const was = drawIn(name, atPen(SERIF, weight)).contours;
  const now = drawIn(name, atPen(ON, weight)).contours;
  const old = new Set(was.map((contour) => JSON.stringify(contour)));
  const fillets = now.filter((contour) => !old.has(JSON.stringify(contour)));
  return { all: now, fillets, rest: now.filter((contour) => !fillets.includes(contour)) };
}

function bezier(p: [Vec2, Vec2, Vec2, Vec2], t: number): Vec2 {
  const u = 1 - t;
  return {
    x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
    y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y,
  };
}

/** A rounding read back: its arc, where the arc's two tangent lines cross, and its tucked node. */
function arcOf(contour: Contour) {
  const [a, b, tuck] = contour.nodes;
  const arc: [Vec2, Vec2, Vec2, Vec2] = [a.point, a.handleOut!, b.handleIn!, b.point];
  const da = { x: a.handleOut!.x - a.point.x, y: a.handleOut!.y - a.point.y };
  const db = { x: b.handleIn!.x - b.point.x, y: b.handleIn!.y - b.point.y };
  const det = da.x * db.y - da.y * db.x;
  const s = ((b.point.x - a.point.x) * db.y - (b.point.y - a.point.y) * db.x) / det;
  const corner = { x: a.point.x + da.x * s, y: a.point.y + da.y * s };
  return { arc, a, b, tuck: tuck.point, corner, middle: bezier(arc, 0.5) };
}

const unit = (v: Vec2): Vec2 => {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
};

const edgeCubic = (from: GlyphNode, to: GlyphNode): [Vec2, Vec2, Vec2, Vec2] => [
  from.point,
  from.handleOut ?? from.point,
  to.handleIn ?? to.point,
  to.point,
];

/**
 * The point of a set of contours nearest `p`, the contour it is on, and the
 * direction of the edge there: sampled, then narrowed down.
 */
function nearestEdge(
  contours: Contour[],
  p: Vec2,
): { distance: number; contour: number; tangent: Vec2 } {
  let best = { distance: Infinity, contour: -1, tangent: { x: 0, y: 0 } };
  contours.forEach((contour, index) => {
    const { nodes } = contour;
    for (let k = 0; k < nodes.length; k++) {
      const cubic = edgeCubic(nodes[k], nodes[(k + 1) % nodes.length]);
      let lo = 0;
      let hi = 1;
      let bestT = 0;
      let bestD = Infinity;
      for (let step = 0; step <= 64; step++) {
        const t = step / 64;
        const q = bezier(cubic, t);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
          bestD = d;
          bestT = t;
        }
      }
      lo = Math.max(0, bestT - 1 / 64);
      hi = Math.min(1, bestT + 1 / 64);
      for (let step = 0; step < 60; step++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        const d1 = Math.hypot(bezier(cubic, m1).x - p.x, bezier(cubic, m1).y - p.y);
        const d2 = Math.hypot(bezier(cubic, m2).x - p.x, bezier(cubic, m2).y - p.y);
        if (d1 < d2) hi = m2;
        else lo = m1;
      }
      const t = (lo + hi) / 2;
      const q = bezier(cubic, t);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < best.distance) {
        const ahead = bezier(cubic, Math.min(1, t + 1e-6));
        const behind = bezier(cubic, Math.max(0, t - 1e-6));
        best = {
          distance: d,
          contour: index,
          tangent: unit({ x: ahead.x - behind.x, y: ahead.y - behind.y }),
        };
      }
    }
  });
  return best;
}

/** How far apart two directions are, either way along a line, in degrees. */
function lineAngle(a: Vec2, b: Vec2): number {
  const one = unit(a);
  const other = unit(b);
  const cross = Math.abs(one.x * other.y - one.y * other.x);
  const along = Math.abs(one.x * other.x + one.y * other.y);
  return (Math.atan2(cross, along) * 180) / Math.PI;
}

describe("the inside rounding on the Serif's E", () => {
  it("adds exactly four roundings of three nodes, an arc and two lines, at every weight", () => {
    for (const weight of [30, 60, ...PENS]) {
      const { all, fillets } = added("E", weight);
      const plain = drawIn("E", atPen(SERIF, weight)).contours;
      expect(all.length, `E at ${weight}`).toBe(plain.length + 4);
      expect(fillets).toHaveLength(4);
      for (const contour of fillets) {
        expect(signatureOf([contour])).toEqual([{ closed: true, nodes: 3, edges: "cll" }]);
        // Wound with the ink at every weight: never turned round by measuring.
        expect(contourArea(contour), `E at ${weight}`).toBeGreaterThan(0);
      }
    }
  });

  it("inks the hollow a fifth of the rounding in from the corner, which was white before", () => {
    for (const weight of PENS) {
      const { all, fillets, rest } = added("E", weight);
      expect(fillets).toHaveLength(4);
      const everything = flatten(all);
      const before = flatten(rest);
      for (const contour of fillets) {
        const { a, b, corner } = arcOf(contour);
        const L = Math.hypot(a.point.x - corner.x, a.point.y - corner.y);
        const ua = unit({ x: a.point.x - corner.x, y: a.point.y - corner.y });
        const ub = unit({ x: b.point.x - corner.x, y: b.point.y - corner.y });
        const probe = {
          x: corner.x + (ua.x + ub.x) * 0.2 * L,
          y: corner.y + (ua.y + ub.y) * 0.2 * L,
        };
        expect(windingAt(everything, probe), `E at ${weight}`).not.toBe(0);
        expect(windingAt(before, probe), `E at ${weight}`).toBe(0);
        // The corner it rounds is the stem's right side against an arm's edge.
        expect(lineAngle(ua, { x: 1, y: 0 }) < 1e-6 || lineAngle(ua, { x: 0, y: 1 }) < 1e-6).toBe(
          true,
        );
        expect(lineAngle(ua, ub)).toBeGreaterThan(89.999);
      }
    }
  });

  it("touches both edges it rounds within a degree, its middle outside the strokes", () => {
    for (const weight of PENS) {
      const { fillets, rest } = added("E", weight);
      expect(fillets).toHaveLength(4);
      const before = flatten(rest);
      for (const contour of fillets) {
        const { a, b, middle } = arcOf(contour);
        for (const [node, handle] of [
          [a, a.handleOut!],
          [b, b.handleIn!],
        ] as const) {
          const edge = nearestEdge(rest, node.point);
          expect(edge.distance, `E at ${weight}`).toBeLessThan(1e-6);
          const way = { x: handle.x - node.point.x, y: handle.y - node.point.y };
          expect(lineAngle(way, edge.tangent), `E at ${weight}`).toBeLessThan(1);
        }
        expect(windingAt(before, middle), `E at ${weight}`).toBe(0);
      }
    }
  });

  it("lays its two straight edges within half a unit of the strokes' ink", () => {
    for (const weight of PENS) {
      const { fillets, rest } = added("E", weight);
      expect(fillets).toHaveLength(4);
      const before = flatten(rest);
      for (const contour of fillets) {
        const [a, b, tuck] = contour.nodes.map((node) => node.point);
        for (const [from, to] of [
          [b, tuck],
          [tuck, a],
        ]) {
          for (let k = 0; k <= 16; k++) {
            const p = {
              x: from.x + ((to.x - from.x) * k) / 16,
              y: from.y + ((to.y - from.y) * k) / 16,
            };
            if (windingAt(before, p) !== 0) continue;
            expect(nearestEdge(rest, p).distance, `E at ${weight}`).toBeLessThan(0.5);
          }
        }
      }
    }
  });
});

describe("the inside rounding at the other joins", () => {
  for (const [name, count] of [
    ["n", 1],
    ["m", 2],
    ["h", 1],
    ["r", 1],
    ["y", 1],
    ["e", 2],
    ["p", 2],
    ["T", 2],
  ] as const) {
    it(`rounds the ${name}'s ${count === 1 ? "join" : "joins"}, inked, on the same strokes at every weight`, () => {
      const hosts = new Set<string>();
      for (const weight of PENS) {
        const { all, fillets, rest } = added(name, weight);
        expect(fillets, `${name} at ${weight}`).toHaveLength(count);
        const everything = flatten(all);
        const before = flatten(rest);
        const found: number[][] = [];
        for (const contour of fillets) {
          expect(signatureOf([contour])).toEqual([{ closed: true, nodes: 3, edges: "cll" }]);
          expect(contourArea(contour), `${name} at ${weight}`).toBeGreaterThan(0);
          const { a, b, corner, middle } = arcOf(contour);
          // Between the arc and the corner it stands in for: ink now, white before.
          const probe = {
            x: middle.x + (corner.x - middle.x) * 0.25,
            y: middle.y + (corner.y - middle.y) * 0.25,
          };
          expect(windingAt(everything, probe), `${name} at ${weight}`).not.toBe(0);
          expect(windingAt(before, probe), `${name} at ${weight}`).toBe(0);
          expect(windingAt(before, middle), `${name} at ${weight}`).toBe(0);
          // Each end of the arc on a stroke's edge, touching it: within what writing an
          // offset ellipse as quarter-turn cubics leaves between the sweep and the true edge.
          const ends = [a, b].map((node) => {
            const edge = nearestEdge(rest, node.point);
            expect(edge.distance, `${name} at ${weight}`).toBeLessThan(0.25);
            const handle = node === a ? a.handleOut! : b.handleIn!;
            const way = { x: handle.x - node.point.x, y: handle.y - node.point.y };
            expect(lineAngle(way, edge.tangent), `${name} at ${weight}`).toBeLessThan(1);
            return edge.contour;
          });
          found.push(ends);
        }
        hosts.add(JSON.stringify(found));
      }
      expect([...hosts], `${name}'s roundings changed hosts`).toHaveLength(1);
    });
  }
});

describe("the inside rounding, held to one drawing across the family", () => {
  it("keeps every letter it rounds the same nodes at every pen and width", {
    timeout: SLOW,
  }, () => {
    const moved: string[] = [];
    const book: WaveBook = {
      lengths: new Map(),
      bowls: new Map(),
      balls: new Map(),
      corners: new Map(),
      recording: true,
    };
    for (const name of [..."EFLTnmhrye", "p", "z", "Z", "ae"]) {
      // Rounded at all: a join with contours of its own, a turn inside one stroke moved.
      if (name === "z" || name === "Z") {
        expect(JSON.stringify(drawIn(name, ON).contours), name).not.toBe(
          JSON.stringify(drawIn(name, SERIF).contours),
        );
      } else {
        expect(drawIn(name, ON).contours.length, name).toBeGreaterThan(
          drawIn(name, SERIF).contours.length,
        );
      }
      const plain = new Set<string>();
      const booked = new Set<string>();
      const was = openWaveBook(book);
      try {
        book.lengths.clear();
        book.bowls.clear();
        book.balls.clear();
        book.corners.clear();
        // Recorded at the drawn weight, read back at the others, as a family is exported.
        book.recording = true;
        waveBookAt(name);
        booked.add(signatureText(drawIn(name, ON).contours));
        book.recording = false;
        for (const weight of [30, 60, 87, 142, 194, 260]) {
          for (const width of WIDTHS) {
            waveBookAt(name);
            booked.add(signatureText(drawIn(name, atPen(ON, weight, width)).contours));
          }
        }
      } finally {
        openWaveBook(was);
      }
      for (const weight of [30, 60, 87, 142, 194, 260]) {
        for (const width of WIDTHS) {
          plain.add(signatureText(drawIn(name, atPen(ON, weight, width)).contours));
        }
      }
      if (plain.size > 1) moved.push(`${name}: ${[...plain].join(" | ")}`);
      if (booked.size > 1) moved.push(`${name} (book): ${[...booked].join(" | ")}`);
    }
    expect(moved).toEqual([]);
  });

  it("crosses no contour over itself, at its least, its middle and its most", {
    timeout: SLOW,
  }, () => {
    // Drawn at all at the least: the E's four roundings.
    const least = withField(SERIF, "corner.fillet", 0.05);
    expect(drawIn("E", least).contours.length).toBe(drawIn("E", SERIF).contours.length + 4);
    expect(foldSweep("corner.fillet", [0.05, 0.5, 1])).toEqual([]);
  });
});

describe("the rounding of a buried end with nothing to come out of", () => {
  it("stands a sliver of the same three nodes in for it", () => {
    const stroke: Stroke = {
      spine: {
        closed: false,
        segments: [{ kind: "line", from: { x: 0, y: 0 }, to: { x: 300, y: 0 } }],
      },
      pen: SERIF.pen,
      start: { ...BUTT, fillet: { left: 1, right: 0.6 } },
      end: BUTT,
    };
    const contours = filletsFor(stroke, ON, sweep(stroke), []);
    expect(contours).toHaveLength(2);
    for (const contour of contours) {
      expect(signatureOf([contour])).toEqual([{ closed: true, nodes: 3, edges: "cll" }]);
      expect(contourArea(contour)).toBeGreaterThanOrEqual(2);
    }
  });

  it("is nothing at all where the rounding is off", () => {
    const stroke: Stroke = {
      spine: {
        closed: false,
        segments: [{ kind: "line", from: { x: 0, y: 0 }, to: { x: 300, y: 0 } }],
      },
      pen: SERIF.pen,
      start: { ...BUTT, fillet: { left: 1 } },
      end: BUTT,
    };
    expect(filletsFor(stroke, SERIF, sweep(stroke), [])).toEqual([]);
    expect(withInside(stroke, SERIF)).toBe(stroke);
    expect(withInside(stroke, ON).inside).toBe(0.35);
  });
});

describe("the crossings a bowl names", () => {
  it("move with the stroke when it is moved or turned", () => {
    const [, bowl] = recipeOf("p")!(ON).strokes;
    expect(bowl.crossFillets).toHaveLength(2);
    const near = bowl.crossFillets![0].near;
    const shoved = shovedStroke(bowl, 30, -12);
    expect(shoved.crossFillets![0].near).toEqual({ x: near.x + 30, y: near.y - 12 });
    const turned = turnedStroke(bowl, { x: 100, y: 200 });
    expect(turned.crossFillets![0].near.x).toBeCloseTo(200 - near.x, 9);
    expect(turned.crossFillets![0].near.y).toBeCloseTo(400 - near.y, 9);
    // And none are named while the rounding is off.
    expect(recipeOf("p")!(SERIF).strokes[1].crossFillets).toBeUndefined();
  });
});

describe("the inside of a corner one stroke turns", () => {
  /** A vee turning anticlockwise at its foot, so its left side is the inside. */
  const vee = (inside?: number): Stroke => ({
    spine: {
      closed: false,
      segments: [
        { kind: "line", from: { x: 0, y: 500 }, to: { x: 200, y: 0 } },
        { kind: "line", from: { x: 200, y: 0 }, to: { x: 400, y: 500 } },
      ],
    },
    pen: { weight: 60, contrast: 0, angle: 0 },
    start: BUTT,
    end: BUTT,
    ...(inside === undefined ? {} : { inside }),
  });

  /** The nodes the rounded corner moved, against the corner brought to a point. */
  function moved(weight: number) {
    const pointed = sweep({ ...vee(), pen: { weight, contrast: 0, angle: 0 } })[0].nodes;
    const rounded = sweep({ ...vee(0.35), pen: { weight, contrast: 0, angle: 0 } })[0].nodes;
    const changed = rounded
      .map((node, index) => ({ node, index }))
      .filter(
        ({ node, index }) =>
          Math.hypot(node.point.x - pointed[index].point.x, node.point.y - pointed[index].point.y) >
          1e-9,
      );
    return { pointed, rounded, changed };
  }

  it("is a circle of the radius asked for, touching both sides, on the stall's own nodes", () => {
    for (const weight of [12, 60, 87, 142]) {
      const { pointed, rounded, changed } = moved(weight);
      expect(signatureText([{ nodes: rounded, closed: true }])).toBe(
        signatureText([{ nodes: pointed, closed: true }]),
      );
      expect(changed.map((one) => one.index)).toEqual([
        changed[0].index,
        changed[0].index + 1,
        changed[0].index + 2,
      ]);
      const [a, m, b] = changed.map((one) => one.node);
      // The three were one point.
      const was = pointed[changed[0].index].point;
      for (const one of changed) {
        expect(
          Math.hypot(pointed[one.index].point.x - was.x, pointed[one.index].point.y - was.y),
        ).toBeLessThan(1e-9);
      }
      // The circle through them: its centre, and every point of both pieces on it.
      const d =
        2 *
        (a.point.x * (m.point.y - b.point.y) +
          m.point.x * (b.point.y - a.point.y) +
          b.point.x * (a.point.y - m.point.y));
      const sq = (p: Vec2) => p.x * p.x + p.y * p.y;
      const centre = {
        x:
          (sq(a.point) * (m.point.y - b.point.y) +
            sq(m.point) * (b.point.y - a.point.y) +
            sq(b.point) * (a.point.y - m.point.y)) /
          d,
        y:
          (sq(a.point) * (b.point.x - m.point.x) +
            sq(m.point) * (a.point.x - b.point.x) +
            sq(b.point) * (m.point.x - a.point.x)) /
          d,
      };
      const r = Math.hypot(a.point.x - centre.x, a.point.y - centre.y);
      expect(r).toBeCloseTo(0.35 * weight, 6);
      for (const [from, to] of [
        [a, m],
        [m, b],
      ]) {
        for (let k = 0; k <= 32; k++) {
          const p = bezier(edgeCubic(from, to), k / 32);
          expect(Math.abs(Math.hypot(p.x - centre.x, p.y - centre.y) - r)).toBeLessThan(0.02);
        }
      }
      // Smooth into both straight sides.
      const before = rounded[changed[0].index - 1].point;
      const into = unit({ x: a.point.x - before.x, y: a.point.y - before.y });
      const leaving = unit({ x: a.handleOut!.x - a.point.x, y: a.handleOut!.y - a.point.y });
      expect(Math.abs(into.x * leaving.y - into.y * leaving.x)).toBeLessThan(1e-9);
      const after = rounded[changed[0].index + 3].point;
      const onward = unit({ x: after.x - b.point.x, y: after.y - b.point.y });
      const arriving = unit({ x: b.point.x - b.handleIn!.x, y: b.point.y - b.handleIn!.y });
      expect(Math.abs(onward.x * arriving.y - onward.y * arriving.x)).toBeLessThan(1e-9);
    }
  });

  it("crosses nothing over itself where the Sans and the Serif turn a corner in one stroke", {
    timeout: SLOW,
  }, () => {
    // The Serif's z turns two corners inside one stroke, and they are rounded.
    expect(JSON.stringify(drawIn("z", ON).contours)).not.toBe(
      JSON.stringify(drawIn("z", SERIF).contours),
    );
    const folds: string[] = [];
    for (const face of [SANS, SERIF]) {
      for (const weight of [12, 40, 92, 150, 210, 260]) {
        const style = withField({ ...face, pen: { ...face.pen, weight } }, "corner.fillet", 0.35);
        for (const name of [
          "v",
          "w",
          "z",
          "Z",
          "Л",
          "Σ",
          "Δ",
          "м",
          "ν",
          "guillemotleft",
          "bracketleft",
          "four",
        ]) {
          const drawn = drawIn(name, style);
          for (const contour of drawn.contours) {
            if (contoursIntersect([contour])) folds.push(`${face.name} ${name} at ${weight}`);
          }
        }
      }
    }
    expect(folds).toEqual([]);
  });
});
