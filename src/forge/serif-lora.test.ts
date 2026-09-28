/**
 * The Serif held to Lora across the whole weight axis, round three: the
 * faults a letter-by-letter comparison with Lora Regular and Lora Bold found
 * at a Light, the Regular, the Bold, a Black and the slider's heaviest, each
 * held to what Lora draws or to the plain geometry of a clean letter.
 */

import { describe, expect, it } from "vitest";
import { contoursBounds, flattenContour } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { drawLetter } from "./build";
import { formOf, startFrom } from "./document";
import { SERIF, type Style } from "./style";

const forge = startFrom(SERIF);
const at = (weight: number): Style => ({ ...SERIF, pen: { ...SERIF.pen, weight } });
const drawn = new Map<string, ReturnType<typeof drawLetter>>();
/** Drawn once for each letter and weight: the scans below ask again and again. */
const draw = (name: string, weight: number, style?: Style) => {
  if (style) return drawLetter(name, style, formOf(forge, name))!;
  const key = `${name} ${weight}`;
  if (!drawn.has(key)) drawn.set(key, drawLetter(name, at(weight), formOf(forge, name)));
  return drawn.get(key)!;
};
const box = (name: string, weight: number) => contoursBounds(draw(name, weight).contours);
/**
 * The ink along a row, as the union the strokes are filled as: overlapping
 * strokes counted by their winding, not paired crossing by crossing.
 */
function row(name: string, weight: number, y: number, style?: Style): Array<[number, number]> {
  const crossings: Array<[number, number]> = [];
  for (const contour of draw(name, weight, style).contours) {
    const points = flattenContour(contour, 24);
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
/** The same, down a column. */
function column(name: string, weight: number, x: number, style?: Style): Array<[number, number]> {
  const drawn = draw(name, weight, style);
  const crossings: Array<[number, number]> = [];
  for (const contour of drawn.contours) {
    const points = flattenContour(contour, 24).map((p) => ({ x: p.y, y: -p.x }));
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      if (a.y <= -x === b.y <= -x) continue;
      crossings.push([a.x + ((-x - a.y) / (b.y - a.y)) * (b.x - a.x), b.y > a.y ? 1 : -1]);
    }
  }
  crossings.sort((p, q) => p[0] - q[0]);
  const runs: Array<[number, number]> = [];
  let winding = 0;
  let from = 0;
  for (const [y, turn] of crossings) {
    const was = winding;
    winding += turn;
    if (was === 0 && winding !== 0) from = y;
    if (was !== 0 && winding === 0) runs.push([from, y]);
  }
  return runs;
}
const WEIGHTS = [30, 87, 142, 200, 260];

describe("the Serif's s", () => {
  it("stands upright at every weight, the upper bowl over the lower one", () => {
    for (const weight of WEIGHTS) {
      const b = box("s", weight);
      const wide = b.xMax - b.xMin;
      const through = (k: number) => row("s", weight, b.yMin + (b.yMax - b.yMin) * k);
      // The upper bowl's side is the letter's left, the lower bowl's its
      // right: past a Black they stood a quarter of the letter in from them,
      // the lower bowl back under the upper one like an italic's.
      expect(through(0.75)[0][0] - b.xMin, `s at ${weight}`).toBeLessThan(wide * 0.05);
      const low = through(0.25);
      expect(b.xMax - low[low.length - 1][1], `s at ${weight}`).toBeLessThan(wide * 0.05);
    }
  });
});

describe("the Serif's t", () => {
  it("carves its head to Lora's share of the stem, under a flag that shows at every weight", () => {
    for (const weight of [87, 142, 200, 260]) {
      const b = box("t", weight);
      const stem = row("t", weight, 250)[0];
      const stemWide = stem[1] - stem[0];
      // Lora's head is 0.41 of its stem at the Regular and 0.53 at the Bold,
      // just under the top; the construction's was the whole stem.
      const head = row("t", weight, b.yMax - 8)[0];
      expect(head[1] - head[0], `t at ${weight}`).toBeLessThan(stemWide * 0.7);
      expect(head[1], `t at ${weight}`).toBeGreaterThan(stem[1] - 3);
      // The flag stands out past the stem's left edge just over the bar, as
      // Lora's sweeps out to meet the bar's end: past a Black it was buried
      // in the stem.
      let barTop = SERIF.metrics.xHeight + weight;
      while (barTop > 300) {
        const runs = row("t", weight, barTop);
        if (runs.length > 0 && runs[0][1] - runs[0][0] > (b.xMax - b.xMin) * 0.7) break;
        barTop -= 2;
      }
      const flag = row("t", weight, barTop + 4)[0];
      expect(stem[0] - flag[0], `t at ${weight}`).toBeGreaterThan(weight * 0.1);
    }
  });
});

describe("the Serif's two and seven", () => {
  const CAP = SERIF.metrics.capHeight;
  /** The middle of the one run of ink a row crosses the diagonal in. */
  const through = (name: string, weight: number, y: number) => {
    const [run] = row(name, weight, y);
    return (run[0] + run[1]) / 2;
  };

  it("runs the two's diagonal in an S, flatter through its middle than out of the bowl", () => {
    for (const weight of [30, 87, 142]) {
      const at = [0.5, 0.4, 0.3, 0.2].map((k) => through("two", weight, CAP * k));
      // Lora's leaves the bowl at 22 degrees steeper than its chord and eases
      // to its flattest through the middle; the construction's was straight.
      const upper = at[0] - at[1];
      const middle = at[1] - at[2];
      expect(middle, `2 at ${weight}`).toBeGreaterThan(upper * 1.12);
    }
  });

  it("stands the two on a foot with Lora's upright serif at its right end", () => {
    for (const weight of [30, 87, 142, 260]) {
      // Over the foot's top, at the foot's right end: the serif.
      const foot = row("two", weight, 4);
      const runs = row("two", weight, weight * 0.35 + 45);
      const end = foot[foot.length - 1][1];
      expect(Math.abs(end - runs[runs.length - 1][1]), `2 at ${weight}`).toBeLessThan(3);
    }
  });

  it("drops the seven's stem straight down out of the corner, under a beak at the arm's end", () => {
    for (const weight of [30, 87, 142, 200, 260]) {
      const b = box("seven", weight);
      const wide = b.xMax - b.xMin;
      // Its right edge a twelfth of the height under the arm still within a
      // few units of the arm's end, as Lora's is (15 on 419): it slanted off
      // from the corner.
      if (weight <= 200) {
        const under = row("seven", weight, CAP - weight * 0.55 - CAP * 0.08);
        expect(b.xMax - under[under.length - 1][1], `7 at ${weight}`).toBeLessThan(wide * 0.065);
      }
      // And the beak hanging under the arm's left end.
      const beak = row("seven", weight, CAP - weight * 0.55 - 20)[0];
      expect(beak[0] - b.xMin, `7 at ${weight}`).toBeLessThan(3);
    }
  });
});

describe("the Serif's G", () => {
  const CAP = SERIF.metrics.capHeight;
  it("stands its upright where Lora's does, under a serif reaching both ways", () => {
    for (const weight of [30, 87, 142, 200, 260]) {
      const b = box("G", weight);
      const upright = row("G", weight, CAP * 0.3);
      const [from, to] = upright[upright.length - 1];
      // Lora's upright's right edge is 0.9 of the way across (668 of 740).
      expect((to - b.xMin) / (b.xMax - b.xMin), `G at ${weight}`).toBeGreaterThan(0.86);
      // Its serif reaching past it each side: the spur's head was a plain cut.
      let reaches = 0;
      for (let y = CAP * 0.62; y > CAP * 0.35; y -= 2) {
        const runs = row("G", weight, y);
        const [left, right] = runs[runs.length - 1];
        if (left > b.xMin + (b.xMax - b.xMin) / 2) {
          reaches = Math.max(reaches, Math.min(from - left, right - to));
        }
      }
      expect(reaches, `G at ${weight}`).toBeGreaterThan(20);
    }
  });
});

describe("the Serif's e", () => {
  it("keeps its aperture open between the tail and the bar past a Black", () => {
    for (const weight of [200, 230, 260]) {
      const b = box("e", weight);
      const across = (k: number) => b.xMin + (b.xMax - b.xMin) * k;
      // The bar's underside, where only the bar and the bowl over it stand.
      const barFoot = column("e", weight, across(0.9))[0][0];
      // And the highest the tail comes under it, across the aperture.
      let tail = -Infinity;
      for (let k = 0.45; k <= 0.9; k += 0.025) {
        for (const [, top] of column("e", weight, across(k))) {
          if (top < barFoot - 0.5) tail = Math.max(tail, top);
        }
      }
      // At an Ultra the tail ran up to within a few units of the bar, and
      // its end was sliced off against it.
      expect(barFoot - tail, `e at ${weight}`).toBeGreaterThan(weight * 0.08);
    }
  });
});

describe("the Serif's R", () => {
  it("puts the leg's toe out past the bowl at every weight, as Lora's is", () => {
    for (const weight of WEIGHTS) {
      const b = box("R", weight);
      const foot = row("R", weight, 4);
      const toe = foot[foot.length - 1][1];
      // At an Ultra the bowl widened with the pen and the toe stood 180 units
      // back under it: a P with a stub under it.
      expect(b.xMax - toe, `R at ${weight}`).toBeLessThan(Math.max(8, weight * 0.08));
      // And the leg straight down its slant, not bowed all the way down.
      const at = (y: number) => {
        const runs = row("R", weight, y);
        return runs[runs.length - 1][1];
      };
      // Its right edge between the bowl and the turn into the toe.
      // Lora's falls 0.66 across for every unit down (56 degrees); bowled
      // out, the construction's ran at 0.9 and more there.
      if (weight <= 142) {
        const [high, middle, low] = [220, 180, 140].map(at);
        expect((low - high) / 80, `R at ${weight}`).toBeLessThan(0.78);
        expect(Math.abs(middle - high - (low - middle)), `R at ${weight}`).toBeLessThan(4);
      }
    }
  });
});

describe("the Serif's bracket control", () => {
  it("does something along the whole of its range, past the serif's depth", () => {
    const with_ = (bracket: number): Style => ({
      ...at(87),
      parts: { ...SERIF.parts, slab: { ...SERIF.parts.slab, bracket } },
    });
    // How much ink the hollow leaves beside the n's stem, a little way up.
    const ink = (bracket: number) =>
      row("n", 87, 55, with_(bracket)).reduce((sum, [a, b]) => sum + b - a, 0);
    const widths = [0.4, 0.5, 0.6, 0.7, 0.8].map(ink);
    // Held to the serif's depth, everything past 0.4 was the same serif.
    for (let k = 1; k < widths.length; k++) {
      expect(widths[k], `bracket ${0.4 + k * 0.1}`).toBeGreaterThan(widths[k - 1] + 1);
    }
  });
});

describe("the Serif's spacing", () => {
  it("closes up at the Bold as Lora Bold does", () => {
    // Lora Bold sets its o 31 a side against the Regular's 41, and its e
    // 31 and 27 against 42 and 39.
    const side = (name: string, weight: number) => {
      const drawn = draw(name, weight);
      const b = contoursBounds(drawn.contours);
      return [b.xMin, drawn.advanceWidth - b.xMax];
    };
    expect(side("o", 142)[0]).toBeLessThan(side("o", 87)[0] - 5);
    expect(side("e", 142)[1]).toBeLessThan(side("e", 87)[1] - 4);
    // And the Regular's where they were.
    expect(side("o", 87)[0]).toBeCloseTo(41, -1);
  });
});

describe("the Serif's question mark", () => {
  it("stands its neck upright over the dot, the hook handing over in an S", () => {
    for (const weight of WEIGHTS) {
      // Up from the line: the dot, the paper over it, then the neck's foot.
      let y = 0;
      while (y < 500 && row("question", weight, y).length > 0) y += 2;
      while (y < 500 && row("question", weight, y).length === 0) y += 2;
      const middle = (at: number) => {
        const [run] = row("question", weight, at);
        return (run[0] + run[1]) / 2;
      };
      // Upright over its last stretch, as Lora's is: the construction's
      // neck came down at a slant and stopped in mid-air at an angle.
      expect(
        Math.abs(middle(y + 12) - middle(y + 12 + Math.min(weight * 0.35, 40))),
        `? at ${weight}`,
      ).toBeLessThan(2 + weight * 0.04);
    }
  });
});

describe("the Serif's g", () => {
  it("swings its link out to the left under the bowl, as Lora's does", () => {
    for (const weight of [30, 87, 142]) {
      const b = box("g", weight);
      // Just over the line, where the link runs between the bowl and the
      // loop: Lora's stands at 0.04 of the letter's width from its left, and
      // the construction's bowed out the other way, to 0.37.
      const [link] = row("g", weight, 60);
      expect((link[0] - b.xMin) / (b.xMax - b.xMin), `g at ${weight}`).toBeLessThan(0.25);
    }
  });
});

describe("the Serif's diagonals", () => {
  const widths = (name: string, weight: number, y: number) =>
    row(name, weight, y).map(([from, to]) => to - from);

  it("draws the rising arms of the vees as hairlines, as Lora's are", () => {
    for (const weight of [87, 142]) {
      // Lora's v is 91 across its falling arm and 52 across its rising one;
      // on a pen held nearly level the construction's were 90 and 82.
      const [falling, rising] = widths("v", weight, 350);
      expect(rising / falling, `v at ${weight}`).toBeLessThan(0.7);
      const y = widths("y", weight, 350);
      expect(y[1] / y[0], `y at ${weight}`).toBeLessThan(0.7);
    }
    // And the w's two rising arms (Lora's 41 and 45 against 87 and 84).
    const w = widths("w", 87, 300);
    expect(w).toHaveLength(4);
    expect(w[1] / w[0]).toBeLessThan(0.7);
    expect(w[3] / w[2]).toBeLessThan(0.7);
  });

  it("keeps the z's diagonal heavy, as Lora's is", () => {
    const [diagonal] = widths("z", 87, 250);
    // Thinned with the vees it would be 49; Lora's is 91.
    expect(diagonal).toBeGreaterThan(70);
  });
});

describe("the Serif at the ends of its contrast", () => {
  it("draws the c's drop without crossing itself at a contrast of 0.9 past a Black", () => {
    for (const weight of [200, 230, 260]) {
      const style: Style = { ...SERIF, pen: { ...SERIF.pen, weight, contrast: 0.9 } };
      for (const contour of draw("c", weight, style).contours) {
        expect(contoursIntersect([contour]), `c at ${weight}`).toBe(false);
      }
    }
  });
});
