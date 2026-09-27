/**
 * The Sans, set against Geist.
 *
 * The Sans is modelled on Geist Regular, a neo-grotesque, and these hold it to
 * what was measured there: the proportions letter by letter, the lines, the
 * superelliptic round of the bowls, the level cut of the curved ends, the
 * notch where an arch leaves its stem, and square dots. Geist itself is not in
 * the repository; what is here is a handful of numbers measured off it, which
 * is all a test needs.
 *
 * And the things the construction has to keep while it does it: nothing
 * crossing itself at a hairline or a Black, the same points at every weight,
 * and the other bases drawn as they were.
 */

import { describe, expect, it } from "vitest";
import { contourArea, contoursBounds, inkRunsAt } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { drawLetter } from "./build";
import { formOf, startFrom } from "./document";
import { BASES, SANS, type Style } from "./style";

const forge = startFrom(SANS);
const draw = (name: string, style: Style = SANS) => drawLetter(name, style, formOf(forge, name))!;
const at = (weight: number): Style => ({ ...SANS, pen: { ...SANS.pen, weight } });

/** Geist Regular's ink widths, in units of a thousand to the em. */
const GEIST_WIDTH: Record<string, number> = {
  a: 494,
  b: 472,
  c: 469,
  d: 472,
  e: 474,
  f: 297,
  g: 471,
  h: 422,
  k: 464,
  m: 718,
  n: 422,
  o: 486,
  p: 472,
  q: 472,
  r: 256,
  s: 437,
  t: 305,
  u: 416,
  v: 494,
  w: 776,
  x: 493,
  y: 494,
  z: 436,
  A: 630,
  B: 527,
  C: 609,
  D: 562,
  E: 455,
  F: 447,
  G: 606,
  H: 520,
  J: 454,
  K: 534,
  L: 442,
  M: 694,
  N: 555,
  O: 650,
  P: 507,
  Q: 644,
  R: 519,
  S: 531,
  T: 528,
  U: 536,
  V: 628,
  W: 870,
  X: 575,
  Y: 589,
  Z: 489,
};

describe("the Sans measured against Geist", () => {
  it("stands on Geist's lines", () => {
    const top = (name: string) => contoursBounds(draw(name).contours).yMax;
    const foot = (name: string) => contoursBounds(draw(name).contours).yMin;
    expect(top("x")).toBeCloseTo(530, 0);
    expect(top("H")).toBeCloseTo(710, 0);
    expect(top("l")).toBeCloseTo(710, 0);
    expect(foot("p")).toBeCloseTo(-150, 0);
    // Round letters over by Geist's twelve units.
    expect(top("o") - 530).toBeCloseTo(12, 0);
    expect(-foot("o")).toBeCloseTo(12, 0);
  });

  it("draws every letter within a few percent of Geist's width", () => {
    const off: string[] = [];
    for (const [name, width] of Object.entries(GEIST_WIDTH)) {
      const box = contoursBounds(draw(name).contours);
      const drawn = box.xMax - box.xMin;
      if (Math.abs(drawn - width) > width * 0.07 + 8)
        off.push(`${name} ${Math.round(drawn)}/${width}`);
    }
    expect(off).toEqual([]);
  });

  it("spaces a straight side at the sidebearing and a round one tighter", () => {
    const sides = (name: string) => {
      const drawn = draw(name);
      const box = contoursBounds(drawn.contours);
      return [box.xMin, drawn.advanceWidth - box.xMax];
    };
    // Geist: n 80 and 80, o 47 and 47, v 22 and 22.
    const [nLeft, nRight] = sides("n");
    expect(nLeft).toBeCloseTo(80, -1);
    expect(nRight).toBeCloseTo(80, -1);
    const [oLeft, oRight] = sides("o");
    expect(Math.abs(oLeft - 47)).toBeLessThan(10);
    expect(Math.abs(oRight - 47)).toBeLessThan(10);
    const [vLeft] = sides("v");
    expect(vLeft).toBeLessThan(oLeft);
  });

  it("rounds its bowls as a superellipse, between a circle and a square", () => {
    const outer = draw("o").contours.find((one) => contourArea(one) > 0)!;
    const box = contoursBounds([outer]);
    const middle = { x: (box.xMin + box.xMax) / 2, y: (box.yMin + box.yMax) / 2 };
    const halfW = (box.xMax - box.xMin) / 2;
    const halfH = (box.yMax - box.yMin) / 2;
    // Along the box's own diagonal, how far out the ink reaches: 0.707 on an
    // ellipse, 1 on a rectangle, and 0.72 to 0.74 on Geist's o.
    let reach = 0;
    for (let k = 0.6; k <= 1; k += 0.0005) {
      const y = middle.y + halfH * k;
      const runs = inkRunsAt([outer], y, "y", 64);
      if (runs.length === 0) continue;
      const right = runs[runs.length - 1][1];
      if (right >= middle.x + halfW * k) reach = k;
    }
    expect(reach).toBeGreaterThan(0.715);
    expect(reach).toBeLessThan(0.76);
  });

  it("cuts the curved ends of c, e, s, C, G and S level with the baseline", () => {
    for (const name of ["c", "e", "s", "C", "G", "S"]) {
      const levels = draw(name).contours.flatMap((contour) =>
        contour.nodes.flatMap((node, index) => {
          const next = contour.nodes[(index + 1) % contour.nodes.length];
          // A straight piece between two corners, across the stroke.
          const straight = !node.handleOut && !next.handleIn;
          const across = Math.abs(next.point.x - node.point.x);
          return straight && across > 40 && Math.abs(next.point.y - node.point.y) < 0.5
            ? [node.point.y]
            : [];
        }),
      );
      // The level cuts are the horizontal runs that are not on a line.
      const inAir = levels.filter((y) => y > 40 && y < (name === name.toUpperCase() ? 670 : 490));
      expect(inAir.length, name).toBeGreaterThan(0);
    }
  });

  it("thins the arch of an n where it leaves the stem, with a notch", () => {
    const n = draw("n");
    const box = contoursBounds(n.contours);
    const stemRight = box.xMin + SANS.pen.weight;
    // Just under the x-height the arch has not yet reached the stem: there is
    // white between the stem and the arch's outside edge.
    const runs = inkRunsAt(n.contours, SANS.metrics.xHeight - 25, "y", 64);
    const merged = runs.reduce<Array<[number, number]>>((all, run) => {
      const last = all[all.length - 1];
      if (last && run[0] <= last[1] + 0.5) last[1] = Math.max(last[1], run[1]);
      else all.push([run[0], run[1]]);
      return all;
    }, []);
    expect(merged.length).toBeGreaterThan(1);
    expect(merged[0][1]).toBeLessThan(stemRight + 1);
  });

  it("dots its i and ends its sentences with squares", () => {
    const period = contoursBounds(draw("period").contours);
    expect(period.xMax - period.xMin).toBeCloseTo(period.yMax - period.yMin, 0);
    // Geist's full stop is 109 across on a stem of 87.
    expect(period.xMax - period.xMin).toBeGreaterThan(SANS.pen.weight * 1.15);
  });
});

describe("the Sans stays clean from a hairline to a Black", () => {
  const letters = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"].concat([
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ampersand",
    "question",
    "exclam",
    "period",
    "comma",
    "colon",
    "semicolon",
  ]);

  it("never crosses itself", () => {
    const folded: string[] = [];
    for (const weight of [30, 87, 200, 260]) {
      for (const name of letters) {
        for (const contour of draw(name, at(weight)).contours) {
          if (contoursIntersect([contour])) folded.push(`${name}@${weight}`);
        }
      }
    }
    expect([...new Set(folded)]).toEqual([]);
  });

  it("keeps the same points at every weight, so a weight axis can run through it", () => {
    const moved: string[] = [];
    for (const name of letters) {
      const counts = [30, 87, 200, 260].map((weight) =>
        draw(name, at(weight))
          .contours.map((contour) => contour.nodes.length)
          .join("+"),
      );
      if (new Set(counts).size > 1) moved.push(`${name}: ${counts.join(" | ")}`);
    }
    expect(moved).toEqual([]);
  });
});

describe("the other bases", () => {
  it("keep their round bowls: only the Sans is superelliptic", () => {
    for (const base of BASES) {
      if (base.name === "Sans") continue;
      expect(base.parts.bowl.superness, base.name).toBe(0);
    }
    const geometric = BASES.find((base) => base.name === "Geometric")!;
    const o = contoursBounds(drawLetter("o", geometric)!.contours);
    // A circle, as it was.
    expect((o.xMax - o.xMin) / (o.yMax - o.yMin)).toBeCloseTo(1, 1);
  });
});
