/**
 * The hints the letters give the soft finishes: absent while the fields are
 * off, and where they are on, each naming the side it means.
 *
 * Sides are named against the way a stroke travels, which is easy to get
 * backwards -- an arm travelling right has its left side on top, a stem rising
 * into an arm has its left side to the left, and an end walked back from is
 * the other way round. So each hinted side is checked against where its
 * hollow actually is: walked in from the buried end along that side's edge,
 * to where the edge comes out of the strokes it was buried in, and the side's
 * outward normal there has to point into the hollow -- below the E's top arm,
 * above its bottom one, over the n's shoulder, into the y's crotch.
 */

import { describe, expect, it } from "vitest";

import type { Vec2 } from "@/font/types";
import { recipeOf } from "./letters";
import { BUTT, frame, partsOfStroke } from "./letters/common";
import { buried, heftable, seen } from "./letters/hints";
import { reversed } from "./shapes";
import { flatten, windingAt } from "./soft";
import { SERIF, SANS, type Style } from "./style";
import { leftOf, penReach, reachAlong, sweep } from "./sweep";
import { withField } from "./testing/fold-sweep";
import type { Spine, Stroke, Terminal } from "./types";

const UP = { x: 0, y: 1 };
const DOWN = { x: 0, y: -1 };
const LEFT = { x: -1, y: 0 };
const RIGHT = { x: 1, y: 0 };

const strokesOf = (name: string, style: Style, form?: string): Stroke[] =>
  recipeOf(name, form)!(style).strokes;

/** Points along a spine, each with the way it is travelling there. */
function walk(spine: Spine, each = 48): Array<{ at: Vec2; heading: Vec2 }> {
  const out: Array<{ at: Vec2; heading: Vec2 }> = [];
  for (const segment of spine.segments) {
    for (let step = 0; step <= each; step++) {
      const t = step / each;
      if (segment.kind === "line") {
        const d = { x: segment.to.x - segment.from.x, y: segment.to.y - segment.from.y };
        const length = Math.hypot(d.x, d.y);
        if (length < 1e-9) continue;
        out.push({
          at: { x: segment.from.x + d.x * t, y: segment.from.y + d.y * t },
          heading: { x: d.x / length, y: d.y / length },
        });
      } else {
        if (Math.abs(segment.endAngle - segment.startAngle) < 1e-9) continue;
        const angle = segment.startAngle + (segment.endAngle - segment.startAngle) * t;
        const way = segment.sweepPositive ? 1 : -1;
        out.push({
          at: {
            x: segment.centre.x + segment.radius * Math.cos(angle),
            y: segment.centre.y + segment.radius * Math.sin(angle),
          },
          heading: { x: -Math.sin(angle) * way, y: Math.cos(angle) * way },
        });
      }
    }
  }
  return out;
}

/**
 * Every hinted side of every buried end of a letter, in the order of its
 * strokes and then left before right: the side's outward normal where its
 * edge first leaves the other strokes' ink.
 */
function hollows(strokes: Stroke[]): Array<{ stroke: number; side: string; normal: Vec2 | null }> {
  const found: Array<{ stroke: number; side: string; normal: Vec2 | null }> = [];
  strokes.forEach((stroke, index) => {
    const others = flatten(strokes.flatMap((other, at) => (at === index ? [] : sweep(other))));
    // A hair inside the pen, so an edge lying along a host's edge counts as in it.
    const reach = penReach({ ...stroke.pen, weight: stroke.pen.weight * 0.98 });
    for (const [terminal, atEnd] of [
      [stroke.start, false],
      [stroke.end, true],
    ] as const) {
      if (!terminal.fillet) continue;
      for (const [side, sign] of [
        ["left", 1],
        ["right", -1],
      ] as const) {
        if (terminal.fillet[side] === undefined) continue;
        // Walked in from the buried end; walked backwards, left and right swap.
        const way = atEnd ? -sign : sign;
        const path = walk(atEnd ? reversed(stroke.spine) : stroke.spine);
        let normal: Vec2 | null = null;
        for (const { at, heading } of path) {
          const n = leftOf(heading);
          const off = reachAlong(n, reach);
          const edge = { x: at.x + off.x * way, y: at.y + off.y * way };
          if (windingAt(others, edge) === 0) {
            normal = { x: n.x * way, y: n.y * way };
            break;
          }
        }
        found.push({ stroke: index, side, normal });
      }
    }
  });
  return found;
}

describe("the hints, off", () => {
  it("hand back the very objects they were given", () => {
    for (const style of [SANS, SERIF]) {
      const f = frame(style);
      expect(buried(f, { left: 1 })).toBe(BUTT);
      const end: Terminal = { kind: "butt", level: true };
      expect(seen(f, end)).toBe(end);
      const stroke = strokesOf("c", style)[0];
      expect(heftable(f, stroke)).toBe(stroke);
    }
  });

  it("leave nothing on the letters they are in", () => {
    for (const style of [SANS, SERIF]) {
      for (const [name, form] of [
        ["E", undefined],
        ["F", undefined],
        ["L", undefined],
        ["T", undefined],
        ["n", undefined],
        ["m", undefined],
        ["h", undefined],
        ["r", undefined],
        ["e", undefined],
        ["e", "humanist"],
        ["c", undefined],
        ["c", "humanist"],
        ["t", undefined],
        ["t", "humanist"],
        ["f", undefined],
        ["y", "hooked"],
      ] as const) {
        for (const stroke of strokesOf(name, style, form)) {
          expect(stroke.heftable, `${name} ${form ?? ""}`).toBeUndefined();
          for (const end of [stroke.start, stroke.end]) {
            expect(end.fillet, `${name} ${form ?? ""}`).toBeUndefined();
            expect(end.seen, `${name} ${form ?? ""}`).toBeUndefined();
          }
        }
      }
    }
  });
});

describe("the buried ends, with the inside rounding on", () => {
  for (const base of [SERIF, SANS]) {
    const style = withField(base, "corner.fillet", 0.35);
    for (const [name, form, expected] of [
      ["E", undefined, [DOWN, UP, DOWN, UP]],
      ["F", undefined, [DOWN, UP, DOWN]],
      ["L", undefined, [UP]],
      ["T", undefined, [LEFT, RIGHT]],
      ["n", undefined, [UP]],
      ["m", undefined, [UP, UP]],
      ["h", undefined, [UP]],
      ["r", undefined, [UP]],
      ["e", undefined, [UP, DOWN]],
      ["e", "humanist", [UP, DOWN]],
      ["y", "hooked", [RIGHT]],
    ] as const) {
      it(`${base.name} ${name}${form ? ` (${form})` : ""} names the side its hollow is on`, () => {
        const strokes = strokesOf(name, style, form);
        const found = hollows(strokes);
        expect(found.map((one) => one.side)).toHaveLength(expected.length);
        found.forEach((one, at) => {
          const label = `${name} stroke ${one.stroke} ${one.side}`;
          expect(one.normal, `${label} never leaves the ink`).not.toBeNull();
          const toward = one.normal!.x * expected[at].x + one.normal!.y * expected[at].y;
          expect(toward, label).toBeGreaterThan(0.5);
          // And its run says it is about the corner.
          expect(partsOfStroke(strokes[one.stroke]), label).toContain("corner");
        });
      });
    }
  }
});

describe("the seen cuts, with the softened cuts on", () => {
  for (const field of ["terminal.soft", "terminal.taper"]) {
    const style = withField(SERIF, field, 0.3);
    it(`marks a crossbar's ends seen (${field})`, () => {
      for (const [name, form] of [
        ["t", undefined],
        ["f", undefined],
        ["t", "humanist"],
      ] as const) {
        const bars = strokesOf(name, style, form).filter(
          (stroke) => stroke.start.seen && stroke.end.seen,
        );
        expect(bars, `${name} ${form ?? ""}`).toHaveLength(1);
      }
    });

    it(`marks the humanist t's stem top and its flag's head seen (${field})`, () => {
      const [stem, flag] = strokesOf("t", style, "humanist");
      expect(stem.start.seen).toBe(true);
      expect(stem.start.level).toBe(true);
      expect(stem.end.seen).toBeUndefined();
      expect(flag.end.seen).toBe(true);
      expect(flag.start.seen).toBeUndefined();
    });
  }
});

describe("the open bowls, with the heft on", () => {
  const style = withField(SERIF, "bowl.heft", 0.08);
  it("marks the c and the belt of the e heftable", () => {
    expect(strokesOf("c", style)[0].heftable).toBe(true);
    expect(strokesOf("c", style, "humanist")[0].heftable).toBe(true);
    expect(strokesOf("e", style)[1].heftable).toBe(true);
    expect(strokesOf("e", style, "humanist")[1].heftable).toBe(true);
    // And the e's bar, which is no bowl, is not.
    expect(strokesOf("e", style)[0].heftable).toBeUndefined();
  });

  it("keeps the run's parts with it", () => {
    const plain = strokesOf("c", SERIF)[0];
    const marked = strokesOf("c", style)[0];
    expect(partsOfStroke(marked)).toEqual(partsOfStroke(plain));
  });
});
