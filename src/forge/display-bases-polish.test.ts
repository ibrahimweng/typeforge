/**
 * The display bases, second pass: the figures of a pen held on its side, the
 * swellings and vees of the heaviest condensed letters, the balls that ran
 * into their own letters, the waves squeezed into stubs beside a bowl, and a
 * fat face's accents drawn at a text face's weight. Measured on the ink.
 */
import { describe, expect, it } from "vitest";
import { contoursBounds, flattenContour } from "@/font/geometry";
import type { Contour, Vec2 } from "@/font/types";
import { draw, startFrom } from "./document";
import { BASES, type Style } from "./style";

const base = (name: string): Style => BASES.find((one) => one.name === name)!;
const at = (face: string, weight?: number): Style => {
  const style = base(face);
  return weight === undefined ? style : { ...style, pen: { ...style.pen, weight } };
};
const ink = (name: string, style: Style): Contour[] => {
  const forge = { ...startFrom(base(style.name)), style };
  return draw(name, forge)!.contours;
};

/** Whether a point is inside the ink, by winding. */
function inked(contours: Contour[], point: Vec2): boolean {
  let winding = 0;
  for (const contour of contours) {
    const points = flattenContour(contour, 12);
    for (let index = 0; index < points.length; index++) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if (a.y <= point.y) {
        if (b.y > point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) > 0)
          winding += 1;
      } else if (
        b.y <= point.y &&
        (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) < 0
      )
        winding -= 1;
    }
  }
  return winding !== 0;
}

/** The runs of ink along a level line, sampled every unit. */
function across(contours: Contour[], y: number): Array<[number, number]> {
  const bounds = contoursBounds(contours);
  const out: Array<[number, number]> = [];
  let start: number | null = null;
  for (let x = bounds.xMin - 4; x <= bounds.xMax + 4; x += 1) {
    const hit = inked(contours, { x, y });
    if (hit && start === null) start = x;
    if (!hit && start !== null) {
      out.push([start, x]);
      start = null;
    }
  }
  if (start !== null) out.push([start, bounds.xMax + 4]);
  return out;
}

/** The runs of ink down an upright line, sampled every unit. */
function down(contours: Contour[], x: number): Array<[number, number]> {
  const bounds = contoursBounds(contours);
  const out: Array<[number, number]> = [];
  let start: number | null = null;
  for (let y = bounds.yMin - 4; y <= bounds.yMax + 4; y += 1) {
    const hit = inked(contours, { x, y });
    if (hit && start === null) start = y;
    if (!hit && start !== null) {
      out.push([start, y]);
      start = null;
    }
  }
  if (start !== null) out.push([start, bounds.yMax + 4]);
  return out;
}

/** The widest white between two runs of ink. */
function widestGap(runs: Array<[number, number]>): number {
  let most = 0;
  for (let index = 1; index < runs.length; index++) {
    most = Math.max(most, runs[index][0] - runs[index - 1][1]);
  }
  return most;
}

const middleOf = (contours: Contour[]): number => {
  const bounds = contoursBounds(contours);
  return (bounds.xMin + bounds.xMax) / 2;
};

describe("the figures of a pen held on its side", () => {
  const style = at("Fairground");

  it("leaves a counter under the five's flag, and between the six's hood and the nine's tail and their bowls", () => {
    /*
     * The horizontals are the heavy strokes on this face, and the bowls were
     * sized as if they were not: the five's bowl rose into its flag, the six's
     * hood lay on its bowl and the nine's tail on its, each one black wedge.
     * Down the middle of each there are three level strokes and white between.
     */
    for (const name of ["five", "six", "nine"]) {
      const contours = ink(name, style);
      const runs = down(contours, middleOf(contours));
      expect(runs.length, name).toBe(3);
      expect(widestGap(runs), name).toBeGreaterThan(20);
    }
  });

  it("gives the two a diagonal of its own over the foot", () => {
    /*
     * Its bowl taken the whole width round left the diagonal so shallow that
     * it lay on the foot as one black wedge, starting four fifths of the way
     * across a third of the way up. A diagonal that is one runs from the
     * middle of the letter there.
     */
    for (const name of ["two", "twosuperior"]) {
      const contours = ink(name, style);
      const bounds = contoursBounds(contours);
      const y = bounds.yMin + (bounds.yMax - bounds.yMin) * 0.36;
      const runs = across(contours, y);
      expect(runs.length, name).toBe(1);
      const from = (runs[0][0] - bounds.xMin) / (bounds.xMax - bounds.xMin);
      expect(from, name).toBeLessThan(0.62);
    }
  });
});

describe("the heaviest condensed letters", () => {
  it("keeps white between a Flared or Technical Black K's stem and its arm", () => {
    for (const face of ["Flared", "Technical"]) {
      const style = at(face, 260);
      const contours = ink("K", style);
      const runs = across(contours, style.metrics.capHeight * 0.9);
      expect(runs.length, face).toBe(2);
      expect(widestGap(runs), face).toBeGreaterThan(12);
    }
  });

  it("keeps the counters of a Flared Black N open", () => {
    const style = at("Flared", 260);
    const contours = ink("N", style);
    const runs = across(contours, style.metrics.capHeight * 0.5);
    expect(runs.length).toBe(3);
    expect(Math.min(runs[1][0] - runs[0][1], runs[2][0] - runs[1][1])).toBeGreaterThan(25);
  });

  it("stands a Ribbon Black k's leg on the line, not under it", () => {
    const bounds = contoursBounds(ink("k", at("Ribbon", 260)));
    expect(bounds.yMin).toBeGreaterThan(-1);
  });

  it("holds a Technical Black s between the baseline and the x-height", () => {
    const style = at("Technical", 260);
    const bounds = contoursBounds(ink("s", style));
    const over = style.metrics.overshoot + 1;
    expect(bounds.yMin).toBeGreaterThan(-over);
    expect(bounds.yMax).toBeLessThan(style.metrics.xHeight + over);
  });
});

describe("the Psychedelic's balls", () => {
  it("keeps paper between an s's balls and its spine", () => {
    /*
     * A ball a stem and three quarters across sat on each end of the nearly
     * shut s and ran into the spine: the letter was one blob. Straight down
     * through either ball there is the ball, paper, and then the rest of the s.
     */
    const style = at("Psychedelic");
    const contours = ink("s", style);
    const bounds = contoursBounds(contours);
    const pen = style.pen.weight;
    for (const x of [bounds.xMax - pen * 0.5, bounds.xMin + pen * 0.5]) {
      const runs = down(contours, x);
      expect(runs.length, `${x}`).toBeGreaterThanOrEqual(2);
      expect(widestGap(runs), `${x}`).toBeGreaterThan(8);
    }
  });

  it("curls the y's tail round under the line so it ends in a ball, as the j does", () => {
    const style = at("Psychedelic");
    expect(style.forms?.y).toBe("hooked");
    const y = contoursBounds(ink("y", style));
    const j = contoursBounds(ink("j", style));
    expect(y.yMin).toBeCloseTo(j.yMin, -1);
  });
});

describe("the Psychedelic's balls, round the letter", () => {
  it("cuts a level arm square rather than hanging a ball on it", () => {
    /*
     * A ball on the middle arm of an E and an F, beside top and bottom arms
     * cut square, hung in the counter as a blot. Down through the end of the
     * middle arm, the ink is an arm's depth, not a ball's.
     */
    for (const weight of [168, 260]) {
      const style = at("Psychedelic", weight);
      for (const name of ["E", "F"]) {
        const contours = ink(name, style);
        const bounds = contoursBounds(contours);
        const x = bounds.xMin + (bounds.xMax - bounds.xMin) * 0.74;
        const column = down(contours, x).filter(
          ([from, to]) => to > bounds.yMin + weight && from < bounds.yMax - weight,
        );
        expect(column.length, `${name} at ${weight}`).toBe(1);
        expect(column[0][1] - column[0][0], `${name} at ${weight}`).toBeLessThan(weight * 1.1);
      }
    }
  });

  it("keeps a six's and a nine's balls off their bowls at the Black", () => {
    /*
     * The hood of the six came down on its bowl and the tail of the nine up
     * into its, each ball filling the counter beside it. Straight through the
     * ball there is the ball, paper, and the bowl.
     */
    const style = at("Psychedelic", 260);
    for (const [name, share, count] of [
      ["six", 0.74, 2],
      ["nine", 0.34, 3],
    ] as const) {
      const contours = ink(name, style);
      const bounds = contoursBounds(contours);
      // Through the ball: the hood's end on the six, the tail's on the nine.
      const runs = down(contours, bounds.xMin + (bounds.xMax - bounds.xMin) * share);
      expect(runs.length, name).toBe(count);
      expect(widestGap(runs), name).toBeGreaterThan(20);
    }
  });

  it("keeps white between a c's two balls at the Black", () => {
    const style = at("Psychedelic", 260);
    const contours = ink("c", style);
    const bounds = contoursBounds(contours);
    // Each ball pushed in off the line its bowl reaches, the two all but met.
    const runs = down(contours, bounds.xMin + (bounds.xMax - bounds.xMin) * 0.9);
    expect(runs.length).toBe(2);
    expect(widestGap(runs)).toBeGreaterThan(50);
  });
});

describe("the Wavy's serifs beside a bowl", () => {
  it("draws the wing on the bowl side of a stem whole or not at all", () => {
    /*
     * Cut short by the bowl, the inner half of the foot squeezed its wave into
     * a crumpled hook standing on its own between the bowl and the stem.
     */
    const style = at("Wavy");
    for (const [name, right] of [
      ["a", true],
      ["d", true],
      ["b", false],
    ] as const) {
      const contours = ink(name, style);
      const middle = across(contours, style.metrics.xHeight * 0.5);
      const stem = right ? middle.at(-1)! : middle[0];
      for (const y of [3, 8, 15]) {
        const loose = across(contours, y).filter(([from, to]) =>
          right ? to > stem[0] - 60 && to < stem[0] - 2 : from < stem[1] + 60 && from > stem[1] + 2,
        );
        expect(loose, `${name} at ${y}`).toEqual([]);
      }
    }
  });
});

describe("the Fairground's s and e", () => {
  it("stops the e's bar flush with the bowl rather than standing out past it", () => {
    const style = at("Fairground");
    const contours = ink("e", style);
    const runs = down(contours, middleOf(contours));
    // The bar is the middle of the three level strokes down the letter.
    const bar = runs[1];
    const right = (y: number): number => across(contours, y).at(-1)![1];
    expect(right(bar[1] - 2) - right(bar[1] + 3)).toBeLessThan(3);
  });
});

describe("a fat face's accents", () => {
  it("weights the macron and the acute to the face, not to a text face", () => {
    /*
     * Held to a text face's share of the room over the x-height, the
     * Display's marks were a third of its stem: hairlines on black letters.
     */
    const style = at("Display");
    const macron = contoursBounds(ink("macron", style));
    expect(macron.yMax - macron.yMin).toBeGreaterThan(style.pen.weight * 0.38);
    // And the acute stands at an angle an accent is read by.
    const acute = contoursBounds(ink("acute", style));
    expect((acute.yMax - acute.yMin) / (acute.xMax - acute.xMin)).toBeGreaterThan(0.55);
  });
});
