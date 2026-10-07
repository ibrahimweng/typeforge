/**
 * Four letters held together past the Black, at the slider's heaviest, where
 * each came apart in its own way: the Sans's nine with notches for counter
 * corners, the Serif's s shrinking as the pen grew, the Technical's M with a
 * spike up out of its valley, and the Sans's Q with its tail out past its
 * ring on a narrow width.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ready, unite } from "@/font/boolean";
import { contourArea, contoursBounds, flattenContour } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { drawLetter } from "./build";
import { widthedStyle } from "./family";
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

describe("the Technical's M at the slider's heaviest", () => {
  it("rounds its valley without a spike of white up into it", () => {
    // How many rows the white between the diagonals is a sliver under a
    // tenth of the pen: 41 at 260, a spike as the A's apex had.
    for (const width of [75, 100, 125]) {
      const style = at("Technical", 260, width);
      const { contours } = draw("M", style);
      const box = contoursBounds(contours);
      const middle = (box.xMin + box.xMax) / 2;
      let sliver = 0;
      for (let y = box.yMin; y <= box.yMax; y += 1) {
        const ink = row(contours, y);
        if (ink.some(([left, right]) => left <= middle && middle <= right)) continue;
        const left = Math.max(...ink.filter(([, right]) => right < middle).map(([, r]) => r));
        const right = Math.min(...ink.filter(([l]) => l > middle).map(([l]) => l));
        if (right - left < style.pen.weight * 0.1) sliver++;
      }
      expect(sliver, `M at width ${width}`).toBeLessThan(10);
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
