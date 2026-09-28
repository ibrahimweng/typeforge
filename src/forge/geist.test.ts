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
    "quotesingle",
    "quotedbl",
    "parenleft",
    "parenright",
    "hyphen",
    "slash",
    "at",
    "numbersign",
    "percent",
  ]);

  it("never crosses itself", () => {
    const folded: string[] = [];
    for (const weight of [30, 87, 172, 200, 230, 260]) {
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
      const counts = [30, 87, 172, 200, 230, 260].map((weight) =>
        draw(name, at(weight))
          .contours.map((contour) => contour.nodes.length)
          .join("+"),
      );
      if (new Set(counts).size > 1) moved.push(`${name}: ${counts.join(" | ")}`);
    }
    expect(moved).toEqual([]);
  });
});

describe("figures and spacing as Geist sets them", () => {
  const sides = (name: string) => {
    const drawn = draw(name);
    const box = contoursBounds(drawn.contours);
    return [box.xMin, drawn.advanceWidth - box.xMax];
  };

  it("sets its figures proportional, each at Geist's own sidebearings", () => {
    // Geist Regular: the one 40 and 110, the zero 54 a side, the two 60.
    const one = sides("one");
    expect(one[0]).toBeCloseTo(40, -1);
    expect(one[1]).toBeCloseTo(110, -1);
    expect(sides("zero")[0]).toBeCloseTo(54, -1);
    expect(sides("two")[1]).toBeCloseTo(60, -1);
    expect(draw("one").advanceWidth).toBeLessThan(draw("zero").advanceWidth * 0.65);
  });

  it("sets the letters the fitting would set too close where Geist opens them", () => {
    // Geist: x and k 47 on the open side, T and Z 12 and 28, B and R 62.
    expect(sides("x")[0]).toBeCloseTo(47, -1);
    expect(sides("k")[1]).toBeCloseTo(47, -1);
    expect(sides("T")[0]).toBeCloseTo(12, -1);
    expect(sides("R")[1]).toBeCloseTo(62, -1);
  });

  it("closes its counters and its spacing at a Black, as Geist Black does", () => {
    const n = (weight: number) => {
      const drawn = draw("n", at(weight));
      const box = contoursBounds(drawn.contours);
      return { width: box.xMax - box.xMin, side: box.xMin };
    };
    // Geist Black's n is 499 of ink on a stem of 172, set 61 off each side.
    const black = n(172);
    expect(black.width).toBeLessThan(560);
    expect(black.side).toBeLessThan(75);
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

describe("past Geist Black, an Ultra", () => {
  const ultras = [200, 230, 260];
  const short = [..."acemnorsuvwxz"];
  const lowercase = [..."abcdefghijklmnopqrstuvwxyz"];

  it("keeps every lowercase letter between its lines", () => {
    const out: string[] = [];
    for (const weight of ultras) {
      for (const name of lowercase) {
        const box = contoursBounds(draw(name, at(weight)).contours);
        const top = short.includes(name) ? SANS.metrics.xHeight : SANS.metrics.ascender;
        const bottom = "gjpqy".includes(name) ? SANS.metrics.descender : 0;
        const over = SANS.metrics.overshoot + 8;
        if (box.yMax > top + over || box.yMin < bottom - over) {
          out.push(`${name}@${weight}: ${Math.round(box.yMin)}..${Math.round(box.yMax)}`);
        }
      }
    }
    expect(out).toEqual([]);
  });

  it("keeps its counters open", () => {
    const pen = 260;
    // Each counter as a gap on a line across the letter: at least a fifth of the pen.
    const gaps = (name: string, at_: number, along: "x" | "y") => {
      const runs = inkRunsAt(draw(name, at(pen)).contours, at_, along);
      const merged: Array<[number, number]> = [];
      for (const run of [...runs].sort((a, b) => a[0] - b[0])) {
        const last = merged[merged.length - 1];
        if (last && run[0] <= last[1] + 0.5) last[1] = Math.max(last[1], run[1]);
        else merged.push([run[0], run[1]]);
      }
      return merged.slice(1).map((run, index) => run[0] - merged[index][1]);
    };
    const middle = (name: string) => {
      const box = contoursBounds(draw(name, at(pen)).contours);
      return (box.xMin + box.xMax) / 2;
    };
    const least = pen * 0.2;
    // Across the n, the o, the e's eye and the u at mid x-height.
    for (const name of ["n", "o", "u", "d", "b"]) {
      const found = gaps(name, SANS.metrics.xHeight * 0.45, "y");
      expect(Math.max(...found), name).toBeGreaterThan(least);
    }
    // Down the middle of the s: two counters; of the e: the eye; of the a: the bowl.
    const s = gaps("s", middle("s"), "x");
    expect(s.length, "s").toBeGreaterThanOrEqual(2);
    for (const gap of s) expect(gap, "s").toBeGreaterThan(least * 0.8);
    expect(Math.max(...gaps("e", middle("e"), "x")), "e").toBeGreaterThan(least);
    expect(Math.max(...gaps("a", middle("a") - 20, "x")), "a").toBeGreaterThan(least * 0.5);
  });

  it("grows only moderately wider, and never narrower, as the pen grows", () => {
    for (const name of ["n", "o", "H", "E", "s", "e"]) {
      const widths = [172, 200, 230, 260].map((weight) => draw(name, at(weight)).advanceWidth);
      for (let index = 1; index < widths.length; index++) {
        expect(widths[index], name).toBeGreaterThanOrEqual(widths[index - 1] - 1);
      }
      expect(widths[3] / widths[0], name).toBeLessThan(1.35);
    }
  });
});

describe("Geist Black's horizontals", () => {
  const thickness = (name: string, x: number, pen = 172) => {
    const drawn = draw(name, at(pen));
    const box = contoursBounds(drawn.contours);
    const runs = inkRunsAt(drawn.contours, box.xMin + (box.xMax - box.xMin) * x, "x");
    return runs.map(([a, b]) => b - a);
  };

  it("draws the capitals' bars heavier than the lowercase's crowns", () => {
    // Geist Black: E and T 142 on a stem of 172; o 127; e's bar 98.
    for (const one of thickness("E", 0.72)) expect(one).toBeCloseTo(142, -1);
    expect(thickness("T", 0.9)[0]).toBeCloseTo(142, -1);
    expect(thickness("o", 0.5)[0]).toBeCloseTo(127, -1);
    expect(thickness("e", 0.45)[1]).toBeCloseTo(98, -1);
  });

  it("sets the E, F and H bars and arms where Geist's are", () => {
    const bar = (name: string, x: number) => {
      const drawn = draw(name, at(172));
      const box = contoursBounds(drawn.contours);
      const runs = inkRunsAt(drawn.contours, box.xMin + (box.xMax - box.xMin) * x, "x");
      return runs.map(([a, b]) => (a + b) / 2);
    };
    // Geist Black: the E's and H's bars centred at 356, the F's at 347.
    expect(bar("E", 0.72)[1]).toBeCloseTo(356, -1);
    expect(bar("F", 0.72)[0]).toBeCloseTo(347, -1);
    expect(bar("H", 0.5)[0]).toBeCloseTo(357, -1);
    // And the E as wide as Geist Black's, 518 of ink.
    const e = contoursBounds(draw("E", at(172)).contours);
    expect(e.xMax - e.xMin).toBeCloseTo(518, -1);
  });
});
