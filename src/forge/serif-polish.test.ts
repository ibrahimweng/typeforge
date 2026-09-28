/**
 * The Serif's letters held clean across the weight axis, from a hairline to
 * past a Black: the faults a close look at every weight found, each held to
 * what Lora draws or to the plain geometry of a clean letter.
 */

import { describe, expect, it } from "vitest";
import { contoursBounds, inkRunsAt } from "@/font/geometry";
import { drawLetter } from "./build";
import { formOf, startFrom } from "./document";
import { humanistS } from "./letters/humanist";
import { SERIF, type Style } from "./style";

const forge = startFrom(SERIF);
const at = (weight: number): Style => ({ ...SERIF, pen: { ...SERIF.pen, weight } });
const draw = (name: string, weight: number) => drawLetter(name, at(weight), formOf(forge, name))!;
const box = (name: string, weight: number) => contoursBounds(draw(name, weight).contours);
/** The runs of ink along a row, overlapping strokes merged. */
function row(name: string, weight: number, y: number): Array<[number, number]> {
  const runs = inkRunsAt(draw(name, weight).contours, y, "y", 64);
  return runs.reduce<Array<[number, number]>>((all, run) => {
    const last = all[all.length - 1];
    if (last && run[0] <= last[1] + 0.5) last[1] = Math.max(last[1], run[1]);
    else all.push([run[0], run[1]]);
    return all;
  }, []);
}
const { xHeight: X, capHeight: CAP, ascender: ASC } = SERIF.metrics;
const WEIGHTS = [30, 87, 142, 200, 260];

describe("the Serif's capitals, clean at every weight", () => {
  it("draws the M's left stem as one straight edge, with no fin off it", () => {
    for (const weight of WEIGHTS) {
      // Down the stem, between its serifs, the left edge of the ink stands
      // still: the fin stood out of it a stem's width and more.
      const lefts = [0.25, 0.4, 0.55, 0.7].map((share) => row("M", weight, CAP * share)[0][0]);
      expect(Math.max(...lefts) - Math.min(...lefts), `M at ${weight}`).toBeLessThan(3);
    }
  });

  it("gives the N its top-left serif", () => {
    for (const weight of [87, 142, 260]) {
      const top = row("N", weight, CAP - 6)[0][0];
      const stem = row("N", weight, CAP * 0.5)[0][0];
      expect(stem - top, `N at ${weight}`).toBeGreaterThan(weight * 0.3);
    }
  });

  it("points the A's apex over the cap line, no higher than Lora's", () => {
    for (const weight of WEIGHTS) {
      expect(box("A", weight).yMax, `A at ${weight}`).toBeLessThan(722);
    }
  });

  it("keeps a counter under the A's bar at a Black", () => {
    for (const weight of [200, 260]) {
      const middle = (box("A", weight).xMin + box("A", weight).xMax) / 2;
      const column = inkRunsAt(draw("A", weight).contours, middle, "x", 64);
      // The first ink up from the baseline down the middle is the bar.
      const bar = Math.min(...column.map(([from]) => from));
      expect(bar, `A at ${weight}`).toBeGreaterThan(CAP * 0.28);
    }
  });

  it("draws round capitals as ovals, with no straight flat down their sides", () => {
    for (const weight of [30, 142]) {
      const at = (share: number) => {
        const runs = row("O", weight, CAP * share);
        return runs[runs.length - 1][1];
      };
      // An oval's side is still turning a third of the way up; a stadium's
      // stood as far out there as at its middle.
      expect(at(0.5) - at(0.34), `O at ${weight}`).toBeGreaterThan(8);
    }
  });
});

describe("the Serif's lowercase, clean at every weight", () => {
  it("runs the e's bar into the bowl's edge, with no step at its end", () => {
    for (const weight of [87, 142, 200]) {
      const b = box("e", weight);
      // The rightmost ink, row by row across the bar and just above it.
      let bar = -Infinity;
      let low = Infinity;
      for (let y = X * 0.4; y < X * 0.75; y += 2) {
        const runs = row("e", weight, y);
        const right = runs[runs.length - 1][1];
        if (right > bar) bar = right;
        low = Math.min(low, right);
      }
      expect(bar - b.xMax, `e at ${weight}`).toBeLessThan(1);
      // And nowhere along the right side does the ink step back in and out
      // again: the edge falls away from its widest steadily.
      const edges: number[] = [];
      for (let y = X * 0.6; y < X * 0.85; y += 2) {
        const runs = row("e", weight, y);
        edges.push(runs[runs.length - 1][1]);
      }
      // A step is the edge jumping between two rows two units apart.
      for (let i = 1; i < edges.length; i++) {
        expect(Math.abs(edges[i] - edges[i - 1]), `e at ${weight}, ${i}`).toBeLessThan(2.5);
      }
    }
  });

  it("stands the t at Lora's height at every weight", () => {
    for (const weight of WEIGHTS) {
      expect(box("t", weight).yMax, `t at ${weight}`).toBeLessThan(680);
    }
  });

  it("keeps the dot of the i and the j under the ascender", () => {
    for (const weight of WEIGHTS) {
      for (const name of ["i", "j"]) {
        expect(box(name, weight).yMax, `${name} at ${weight}`).toBeLessThanOrEqual(ASC + 1);
      }
    }
  });

  it("sits the v's point on the line at a hairline", () => {
    for (const weight of [30, 35, 87]) {
      expect(box("v", weight).yMin, `v at ${weight}`).toBeGreaterThan(-8);
    }
  });

  it("draws the s no wider than the o past a Black", () => {
    for (const weight of [200, 260]) {
      const wide = (name: string) => box(name, weight).xMax - box(name, weight).xMin;
      expect(wide("s"), `s at ${weight}`).toBeLessThan(wide("o"));
    }
  });
});

describe("the Serif's figures and marks", () => {
  it("draws the @ as large as Lora's at every weight, not growing with the pen", () => {
    for (const weight of WEIGHTS) {
      const b = box("at", weight);
      expect(b.yMax - b.yMin, `@ at ${weight}`).toBeLessThan(CAP * 1.25);
      expect(b.xMax - b.xMin, `@ at ${weight}`).toBeLessThan(CAP * 1.25);
    }
  });

  it("draws the Bold's five as wide as Lora Bold's", () => {
    const b = box("five", 142);
    expect(b.xMax - b.xMin).toBeLessThan(464 * 1.05);
  });

  it("sets Lora's word space, and full stops of Lora's size at the Bold", () => {
    expect(draw("space", 87).advanceWidth).toBeCloseTo(263, -1);
    const stop = box("period", 142);
    expect(stop.xMax - stop.xMin).toBeLessThan(145 * 1.05);
  });

  it("keeps the two marks of a double quote apart at a hairline", () => {
    const runs = row("quotedbl", 30, 660);
    const gaps = runs.slice(1).map(([from], index) => from - runs[index][1]);
    expect(Math.max(...gaps)).toBeGreaterThan(40);
  });

  it("ends the seven in a tail, not on a foot serif", () => {
    for (const weight of [87, 142]) {
      // Along the line, the foot is no wider than the stem that falls to it.
      const extent = (y: number) => {
        const runs = row("seven", weight, y);
        return runs[runs.length - 1][1] - runs[0][0];
      };
      expect(extent(4), `7 at ${weight}`).toBeLessThan(extent(CAP * 0.3) * 1.2);
    }
  });
});

describe("the Serif past a close look at every weight, round two", () => {
  const ink = (name: string, weight: number) => {
    const b = box(name, weight);
    return b.xMax - b.xMin;
  };

  it("draws the s's spine as a curve, with no straight run between the bowls", () => {
    for (const weight of [87, 142, 260]) {
      const drawn = humanistS(at(weight));
      const lines = drawn.strokes.flatMap((stroke) =>
        stroke.spine.segments.filter(
          (one) =>
            one.kind === "line" &&
            Math.abs(one.to.y - one.from.y) > 1 &&
            Math.abs(one.to.x - one.from.x) > 1,
        ),
      );
      // The runs along the top and the foot are level; a slanting straight
      // run is the old spine laid across as a band.
      expect(lines, `s at ${weight}`).toEqual([]);
    }
  });

  it("keeps the ampersand near Lora's width and its own at a Black", () => {
    // Lora's is 667 across at the Regular and 652 at the Bold.
    expect(ink("ampersand", 87)).toBeGreaterThan(667 * 0.85);
    expect(ink("ampersand", 87)).toBeLessThan(667 * 1.08);
    expect(ink("ampersand", 142)).toBeLessThan(652 * 1.12);
    // At an Ultra no wider than the H: the loop was pushed out beside the
    // bowl, and the mark ran 1200 across.
    expect(ink("ampersand", 260)).toBeLessThan(ink("H", 260) * 0.8);
    // The loop over the bowl, not beside it.
    const middle = (y: number) => {
      const runs = row("ampersand", 260, y);
      return (runs[0][0] + runs[runs.length - 1][1]) / 2;
    };
    expect(Math.abs(middle(CAP * 0.87) - middle(CAP * 0.17))).toBeLessThan(60);
    expect(box("ampersand", 260).yMax).toBeLessThan(CAP + 20);
  });

  it("widens the open capitals past the Bold as the others widen", () => {
    for (const name of ["C", "E", "T", "Z", "z"]) {
      const widths = [142, 200, 260].map((weight) => ink(name, weight));
      expect(widths[1], `${name} at 200`).toBeGreaterThan(widths[0]);
      expect(widths[2], `${name} at 260`).toBeGreaterThan(widths[1]);
    }
    // And the M no more than Lora's M/H of 1.25 and a little over.
    expect(ink("M", 260) / ink("H", 260)).toBeLessThan(1.33);
  });

  it("holds the g's loop on the descender at a Black", () => {
    for (const weight of [200, 260]) {
      expect(box("g", weight).yMin, `g at ${weight}`).toBeGreaterThan(-275);
    }
  });

  it("turns the j's tail no tighter than keeps a counter between its drop and its stem", () => {
    for (const weight of [142, 200, 260]) {
      // Across the tail a stem's height over its foot: the drop, paper, then
      // the stem -- the counter was a hairline wedge between them.
      const runs = row("j", weight, SERIF.metrics.descender + weight * 0.9);
      expect(runs.length, `j at ${weight}`).toBeGreaterThanOrEqual(2);
      const gap = runs[1][0] - runs[0][1];
      expect(gap, `j at ${weight}`).toBeGreaterThan(weight * 0.45);
    }
  });
});
