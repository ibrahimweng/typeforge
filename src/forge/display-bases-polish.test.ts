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

describe("the Wavy's T", () => {
  it("stops its stem inside its arm rather than standing up into the troughs", () => {
    /*
     * The arm waves under the cap line, and a stem carried up to the line
     * stood square between two troughs where it met the arm. At the stem's
     * edges the ink now tops out where the arm's does just beside them.
     */
    for (const weight of [undefined, 30, 87]) {
      const style = at("Wavy", weight);
      const contours = ink("T", style);
      const box = contoursBounds(contours);
      const middle = (box.xMin + box.xMax) / 2;
      const half = style.pen.weight / 2;
      const top = (x: number): number => down(contours, x).at(-1)![1];
      for (const side of [-1, 1]) {
        const edge = middle + side * (half - 2);
        const beside = middle + side * (half + 6);
        expect(top(edge) - top(beside), `${weight} ${side}`).toBeLessThan(8);
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

describe("a squared s at a heavy regular", () => {
  it("runs the Ribbon's s counters out sideways rather than closing them", () => {
    /*
     * Three level strokes of the Ribbon's pen all but fill its x-height, and
     * the s -- at the width of a bend, not of its o -- came out as a stack of
     * blocks with two notches for counters.
     */
    for (const weight of [150, 200]) {
      const style = at("Ribbon", weight);
      for (const name of ["s", "S"]) {
        const contours = ink(name, style);
        const runs = down(contours, middleOf(contours));
        expect(runs.length, `${name} at ${weight}`).toBe(3);
        // And each counter run out sideways a stem and more: the s as wide
        // as its o near enough, not a stack of blocks half as wide again.
        if (name === "S") continue;
        const o = contoursBounds(ink("o", style));
        const own = contoursBounds(contours);
        expect((own.xMax - own.xMin) / (o.xMax - o.xMin), `${name} at ${weight}`).toBeGreaterThan(
          0.72,
        );
      }
    }
  });
});

describe("the at sign of a heavy display face", () => {
  it("stays about the size of the O and keeps the a inside clear of the ring", () => {
    /*
     * Grown round a small a whose counter has to stay open, a Black's ring
     * came out half as tall again as the O and hung a stem below the line,
     * and on a condensed face the a ran into the ring on the right.
     */
    for (const face of ["Display", "Technical", "Flared"]) {
      const style = at(face, 260);
      const mark = ink("at", style);
      const box = contoursBounds(mark);
      const o = contoursBounds(ink("O", style));
      expect((box.yMax - box.yMin) / (o.yMax - o.yMin), face).toBeLessThan(1.45);
      // Across the middle of the a: ring, bowl, bowl and stem, ring.
      const rows = [0.45, 0.5, 0.55].map((share) =>
        across(mark, box.yMin + (box.yMax - box.yMin) * share),
      );
      expect(Math.max(...rows.map((row) => row.length)), face).toBeGreaterThanOrEqual(4);
    }
  });

  it("grows heavier with the face, not lighter, where its pen is held", () => {
    // Measured on a text face as well, whose own share of the ring is larger
    // and which, held to a lighter pen's share, fell to a hairline past a Bold.
    for (const face of ["Technical", "Display", "Didone"]) {
      let last = 0;
      for (const weight of [78, 118, 160, 200, 260]) {
        const mark = ink("at", at(face, weight));
        const box = contoursBounds(mark);
        const ring = across(mark, (box.yMin + box.yMax) / 2)[0];
        const drawn = ring[1] - ring[0];
        expect(drawn, `${face} at ${weight}`).toBeGreaterThan(last);
        last = drawn;
      }
    }
  });
});

describe("the Flared's steep diagonals", () => {
  it("does not swell the heads of a W's outer strokes as if they stood upright", () => {
    /*
     * The outer strokes of a W lean about thirteen degrees, near enough
     * upright to be swelled as stems: their heads hooked out over the cap line
     * beside a V whose diagonals were left clean.
     */
    const style = at("Flared");
    for (const name of ["W", "w"]) {
      const contours = ink(name, style);
      const box = contoursBounds(contours);
      const head = across(contours, box.yMax - 4)[0];
      const below = across(contours, box.yMax - 80)[0];
      expect(head[1] - head[0], name).toBeLessThan(below[1] - below[0] + 12);
    }
  });
});
