/**
 * Letters held together past the Black, at the slider's heaviest, where each
 * came apart in its own way: the Sans's nine and six with notches for counter
 * corners, the Serif's s shrinking as the pen grew, the Technical's M and A
 * with a spike of white into the turn, its V, v, delta and lambda with a
 * needle in the point and standing off their lines, and the Sans's Q with
 * its tail out past its ring on a narrow width.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ready, unite } from "@/font/boolean";
import { contourArea, contoursBounds, flattenContour } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { drawLetter } from "./build";
import { widthedStyle } from "./family";
import { wobbleOf } from "./script";
import { BASES, type Style } from "./style";

beforeAll(async () => {
  await ready();
});

const face = (name: string): Style => BASES.find((one) => one.name === name)!;
const at = (name: string, weight: number, width = 100): Style => {
  const base = face(name);
  return widthedStyle({ ...base, pen: { ...base.pen, weight } }, width);
};
const draw = (name: string, style: Style) => drawLetter(name, style, style.forms?.[name])!;

/** The ink along a row, filled by winding. */
function row(contours: Contour[], y: number): Array<[number, number]> {
  const crossings: Array<[number, number]> = [];
  for (const contour of contours) {
    const points = flattenContour(contour, 48);
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      if (a.y <= y === b.y <= y) continue;
      crossings.push([a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x), b.y > a.y ? 1 : -1]);
    }
  }
  crossings.sort((p, q) => p[0] - q[0]);
  const runs: Array<[number, number]> = [];
  let winding = 0;
  let from = 0;
  for (const [x, turn] of crossings) {
    const was = winding;
    winding += turn;
    if (was === 0 && winding !== 0) from = x;
    if (was !== 0 && winding === 0) runs.push([from, x]);
  }
  return runs;
}

/** The sharpest turn round a hole's outline, in degrees between neighbouring steps. */
function sharpest(hole: Contour): number {
  const flat = flattenContour(hole, 64);
  const points = flat.filter((p, i) => {
    const next = flat[(i + 1) % flat.length];
    return Math.hypot(p.x - next.x, p.y - next.y) > 0.5;
  });
  let most = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[(i - 1 + points.length) % points.length];
    const b = points[i];
    const c = points[(i + 1) % points.length];
    let turn = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    most = Math.max(most, (turn * 180) / Math.PI);
  }
  return most;
}

describe("the Sans's nine past the Black", () => {
  it("keeps the corners of its counter round", () => {
    // At 260 the counter came to a notch at three corners, turning 50
    // degrees in one step where the Black's turns 22.
    for (const weight of [220, 240, 260]) {
      const holes = unite(draw("nine", at("Sans", weight)).contours, "winding").filter(
        (contour) => contourArea(contour) < 0,
      );
      expect(holes.length, `nine at ${weight}`).toBe(1);
      expect(sharpest(holes[0]), `nine at ${weight}`).toBeLessThan(25);
    }
  });
});

describe("the Sans's six past the Black", () => {
  it("keeps the corners of its counter round", () => {
    // At 260 the counter came to a notch at its lower right, turning 51
    // degrees in one step.
    for (const weight of [220, 240, 260]) {
      const holes = unite(draw("six", at("Sans", weight)).contours, "winding").filter(
        (contour) => contourArea(contour) < 0,
      );
      expect(holes.length, `six at ${weight}`).toBe(1);
      expect(sharpest(holes[0]), `six at ${weight}`).toBeLessThan(25);
    }
  });
});

describe("the Serif's s past the Black", () => {
  it("sits no higher off the o's line than at the Black, and is no narrower", () => {
    // At 260 it stood on -4 where the o dips to -16 (the Black's on -12),
    // and 386 across against the Black's 420.
    const measure = (weight: number) => {
      const style = at("Serif", weight);
      const s = contoursBounds(draw("s", style).contours);
      const o = contoursBounds(draw("o", style).contours);
      return { off: s.yMin - o.yMin, wide: s.xMax - s.xMin };
    };
    const black = measure(194);
    for (const weight of [220, 240, 260]) {
      const { off, wide } = measure(weight);
      expect(off, `s at ${weight}`).toBeLessThan(black.off + 0.5);
      expect(wide, `s at ${weight}`).toBeGreaterThan(black.wide - 10);
    }
  });
});

/** How many rows the white at the middle of a letter is a sliver under a tenth of the pen. */
function sliver(contours: Contour[], pen: number): number {
  const box = contoursBounds(contours);
  const middle = (box.xMin + box.xMax) / 2;
  let rows = 0;
  for (let y = box.yMin; y <= box.yMax; y += 1) {
    const ink = row(contours, y);
    if (ink.some(([left, right]) => left <= middle && middle <= right)) continue;
    const left = Math.max(...ink.filter(([, right]) => right < middle).map(([, r]) => r));
    const right = Math.min(...ink.filter(([l]) => l > middle).map(([l]) => l));
    if (right - left < pen * 0.1) rows++;
  }
  return rows;
}

/**
 * How far the white inside a vee runs on past where its legs' inner edges,
 * carried on straight, would meet: the legs fitted where the white between
 * them is from half a pen to a pen and a half across. Nought where there is
 * too little of that to fit.
 */
function needle(contours: Contour[], pen: number, pointing: number): number {
  const box = contoursBounds(contours);
  const middle = (box.xMin + box.xMax) / 2;
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  let tip = pointing < 0 ? Infinity : -Infinity;
  for (let y = box.yMin; y <= box.yMax; y += 1) {
    const ink = row(contours, y);
    if (ink.some(([l, r]) => l <= middle && middle <= r)) continue;
    const l = Math.max(...ink.filter(([, r]) => r < middle).map(([, r]) => r));
    const r = Math.min(...ink.filter(([x]) => x > middle).map(([x]) => x));
    if (!Number.isFinite(l) || !Number.isFinite(r)) continue;
    tip = pointing < 0 ? Math.min(tip, y) : Math.max(tip, y);
    if (r - l > pen * 0.5 && r - l < pen * 1.5) {
      left.push([l, y]);
      right.push([r, y]);
    }
  }
  if (left.length < 3) return 0;
  const line = (points: Array<[number, number]>) => {
    const my = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    const mx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    let num = 0;
    let den = 0;
    for (const [x, y] of points) {
      num += (y - my) * (x - mx);
      den += (y - my) ** 2;
    }
    const b = num / den;
    return { a: mx - b * my, b };
  };
  const l = line(left);
  const r = line(right);
  const meet = (r.a - l.a) / (l.b - r.b);
  return pointing < 0 ? meet - tip : tip - meet;
}

describe("the Technical's M at the slider's heaviest", () => {
  it("rounds its valley without a spike of white up into it", () => {
    // 41 rows of sliver at 260, a spike as the A's apex had.
    for (const width of [75, 100, 125]) {
      const style = at("Technical", 260, width);
      expect(sliver(draw("M", style).contours, 260), `M at width ${width}`).toBeLessThan(10);
    }
  });
});

describe("the Technical's A and M between the Black and the heaviest", () => {
  it("round their turns in step with the spike, leaving no sliver on the way", () => {
    // The wider round came in whole at a quarter of the pen and not before:
    // 47 and 36 rows of sliver at 230.
    for (const weight of [210, 220, 230, 245]) {
      for (const width of [75, 100, 125]) {
        const style = at("Technical", weight, width);
        for (const name of ["A", "M"]) {
          const rows = sliver(draw(name, style).contours, weight);
          expect(rows, `${name} at ${weight}, width ${width}`).toBeLessThan(10);
        }
      }
    }
  });
});

describe("the Technical's vees at a heavy weight", () => {
  it("meet clean in the point and stand on their lines", () => {
    // A needle of white 20 to 30 units on past the legs' meeting on an
    // Expanded at 230 and 260, and the V stood its point 67 units off the
    // line at 260.
    for (const weight of [230, 260]) {
      for (const width of [75, 100, 125]) {
        const style = at("Technical", weight, width);
        const { capHeight } = style.metrics;
        for (const [name, pointing, line] of [
          ["V", -1, 0],
          ["v", -1, 0],
          ["\u0394", 1, capHeight],
          ["\u039b", 1, capHeight],
        ] as const) {
          const { contours } = draw(name, style);
          const where = `${name} at ${weight}, width ${width}`;
          expect(needle(contours, weight, pointing), where).toBeLessThan(3);
          const box = contoursBounds(contours);
          const reached = pointing < 0 ? box.yMin : box.yMax;
          expect(Math.abs(reached - line), where).toBeLessThan(3);
        }
      }
    }
  });
});

describe("the Sans's Q on a narrow width", () => {
  it("keeps its tail inside the ring's reach", () => {
    // On a Condensed at 260 the tail's end stood 125 units out past the ring.
    const right = (contours: Contour[]) =>
      Math.max(...contours.flatMap((contour) => contour.nodes.map((node) => node.point.x)));
    for (const width of [60, 75, 100, 125]) {
      for (const weight of [194, 240, 260]) {
        const { contours } = draw("Q", at("Sans", weight, width));
        const [outer, inner, ...tail] = contours;
        expect(right(tail) - right([outer, inner]), `Q at ${weight}, width ${width}`).toBeLessThan(
          1,
        );
      }
    }
  });
});

describe("every face's vees", () => {
  /*
   * Each vee's point is asked to reach its line, and `corner` reckoned its
   * reach from the pen's half: a pen with contrast reaches less than that
   * along the bisector, and the point stood short of the line, more so the
   * heavier the pen -- the Ribbon's V 66 units over the baseline at 260, the
   * Technical's 31 at its Black, the Didone's 19. Left out: the written
   * hands, whose letters are shaped by their joins after, and the Serif,
   * which takes its vees apart to thin the rising arm and is held to Lora.
   */
  const faces = BASES.filter((one) => !one.parts.script.on && one.name !== "Serif");
  const vees = [
    ["V", -1],
    ["v", -1],
    ["Δ", 1],
    ["Λ", 1],
  ] as const;
  const reach = (name: string, style: Style, pointing: number) => {
    const box = contoursBounds(draw(name, style).contours);
    return pointing < 0 ? box.yMin : box.yMax - style.metrics.capHeight;
  };

  it("stand on their lines at every weight and width", () => {
    for (const face of faces) {
      for (const weight of [30, 87, 142, 194, 230, 260]) {
        for (const width of [75, 100, 125]) {
          const style = at(face.name, weight, width);
          for (const [name, pointing] of vees) {
            const where = `${face.name} ${name} at ${weight}, width ${width}`;
            expect(Math.abs(reach(name, style, pointing)), where).toBeLessThan(3.5);
          }
        }
      }
    }
  }, 300_000);

  it("come onto them a little at a time, with no weight jumping from the next", () => {
    for (const name of ["Ribbon", "Technical", "Didone"]) {
      for (const [letter, pointing] of vees) {
        let last: number | null = null;
        for (let weight = 120; weight <= 260; weight += 4) {
          const now = reach(letter, at(name, weight), pointing);
          if (last !== null) {
            expect(Math.abs(now - last), `${name} ${letter} at ${weight}`).toBeLessThan(8);
          }
          last = now;
        }
      }
    }
  }, 300_000);
});

describe("the written hands' vees", () => {
  /*
   * A written letter is moved and joined after its recipe draws it, so its
   * vee is landed on the finished letter: the Formal Script's V stood 40 units
   * over the baseline from a pen of 120, the Handwriting's 62 at its Black,
   * and the Formal Script's v at 260 had its point 115 units up. A letter in
   * the middle of a word is lifted by the hand's own unsteadiness (`wobbleOf`),
   * and stands on its line moved by that.
   */
  const hands = BASES.filter((one) => one.parts.script.on);
  const vees = [
    ["V", -1],
    ["v", -1],
    ["Δ", 1],
    ["Λ", 1],
  ] as const;

  it("stand on their lines, and never hang past them", () => {
    for (const hand of hands) {
      for (const weight of [30, 87, 142, 194, 230, 260]) {
        for (const width of [75, 100, 125]) {
          const style = at(hand.name, weight, width);
          for (const [name, pointing] of vees) {
            const lift =
              name === "v" ? wobbleOf(name, style.parts.script, style.metrics.xHeight).lift : 0;
            const box = contoursBounds(draw(name, style).contours);
            const off = pointing < 0 ? box.yMin - lift : box.yMax - style.metrics.capHeight - lift;
            const where = `${hand.name} ${name} at ${weight}, width ${width}`;
            expect(Math.abs(off), where).toBeLessThan(3.5);
            // Short of the line by a unit or two at most, and never past it.
            expect(pointing < 0 ? off : -off, where).toBeGreaterThan(-1.5);
          }
        }
      }
    }
  }, 300_000);
});

describe("the Serif's vees past the Bold", () => {
  it("land on their lines by the heaviest, from where Lora leaves them at the Black", () => {
    // They stood 8 to 9 units over the line at 260; at 194 they are Lora's.
    for (const width of [75, 100, 125]) {
      for (const [name, pointing] of [
        ["V", -1],
        ["v", -1],
        ["Δ", 1],
        ["Λ", 1],
      ] as const) {
        const off = (weight: number) => {
          const style = at("Serif", weight, width);
          const box = contoursBounds(draw(name, style).contours);
          return pointing < 0 ? box.yMin : style.metrics.capHeight - box.yMax;
        };
        const black = off(194);
        expect(off(230), `${name} at 230, width ${width}`).toBeLessThanOrEqual(black + 0.5);
        expect(Math.abs(off(260)), `${name} at 260, width ${width}`).toBeLessThan(1.5);
      }
    }
  });
});

describe("the Ribbon's vees at the heaviest", () => {
  it("meet clean in the point", () => {
    // A needle of white 6 to 8 units on past the legs' meeting at 260: the
    // face's own radius is wider than its legs can spare, and reckoned at
    // that the point was taken for clean.
    for (const weight of [245, 260]) {
      for (const [name, pointing] of [
        ["V", -1],
        ["v", -1],
        ["Λ", 1],
      ] as const) {
        const { contours } = draw(name, at("Ribbon", weight));
        expect(needle(contours, weight, pointing), `${name} at ${weight}`).toBeLessThan(2);
      }
    }
  });
});
