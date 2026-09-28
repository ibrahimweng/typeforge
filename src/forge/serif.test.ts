/**
 * The serif and the terminal, as a text face draws them.
 *
 * Set beside Lora, the Serif base read as a sans with small rectangles stuck
 * on: every serif was a bar of one depth, the tops of the lowercase stems wore
 * the same level slab as the feet, the uprights were cut at the angle of the
 * pen rather than along the line they stood on, a light weight's serifs were a
 * dozen units long, and every curved end -- the hook of a c, an f, an r -- was
 * cut square, whatever the terminal controls said. These pin each of those
 * down in numbers taken off the drawing.
 */

import { describe, expect, it } from "vitest";

import { contoursBounds, flattenContour } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import type { Contour, Vec2 } from "@/font/types";
import { drawLetter } from "./build";
import { PART_SPECS } from "./parts";
import { openWaveBook, waveBookAt, type WaveBook } from "./shapes";
import { SERIF, SLAB, serifReach, TYPEWRITER, type Style } from "./style";

function at(
  base: Style,
  pen: Partial<Style["pen"]> = {},
  parts: Record<string, object> = {},
): Style {
  return {
    ...base,
    pen: { ...base.pen, ...pen },
    parts: Object.fromEntries(
      Object.entries(base.parts).map(([key, value]) => [key, { ...value, ...(parts[key] ?? {}) }]),
    ) as unknown as Style["parts"],
  };
}

/** In the form the face starts with, which for the Serif is the two-storey a. */
function draw(name: string, style: Style): Contour[] {
  const drawn = drawLetter(name, style, style.forms?.[name]);
  expect(drawn, `${name} would not draw`).not.toBeNull();
  return drawn!.contours;
}

/**
 * Whether a point is ink: nonzero winding over every contour, which is how the
 * overlapping strokes and serifs are filled.
 */
function inked(contours: Contour[], point: Vec2): boolean {
  let winding = 0;
  for (const contour of contours) {
    const points = flattenContour(contour, 16);
    for (let index = 0; index < points.length; index++) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if (a.y <= point.y) {
        if (b.y > point.y && (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) > 0)
          winding++;
      } else if (
        b.y <= point.y &&
        (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y) < 0
      )
        winding--;
    }
  }
  return winding !== 0;
}

/** The run of ink along a row that contains `x`, walked a unit at a time. */
function runAt(contours: Contour[], y: number, x: number): [number, number] {
  expect(inked(contours, { x, y }), `no ink at ${x.toFixed(1)}, ${y}`).toBe(true);
  let left = x;
  let right = x;
  while (inked(contours, { x: left - 1, y })) left -= 1;
  while (inked(contours, { x: right + 1, y })) right += 1;
  return [left, right];
}

/** The run of ink up a column that contains `y`. */
function columnAt(contours: Contour[], x: number, y: number): [number, number] {
  expect(inked(contours, { x, y }), `no ink at ${x.toFixed(1)}, ${y}`).toBe(true);
  let low = y;
  let high = y;
  while (inked(contours, { x, y: low - 1 })) low -= 1;
  while (inked(contours, { x, y: high + 1 })) high += 1;
  return [low, high];
}

/** The leftmost stem of a letter, measured half way up it: its two edges. */
function stemOf(contours: Contour[], height: number): [number, number] {
  const bounds = contoursBounds(contours);
  let x = bounds.xMin;
  while (!inked(contours, { x, y: height })) x += 1;
  return runAt(contours, height, x + 1);
}

const WEIGHTS = [30, 96, 200];

describe("the serifs on the capitals", () => {
  it("stands every upright on a serif that reaches well past it, at every weight", () => {
    for (const weight of WEIGHTS) {
      const style = at(SERIF, { weight });
      const reach = serifReach(style);
      for (const name of ["H", "I", "L", "E", "F", "K", "N"]) {
        const contours = draw(name, style);
        const [left, right] = stemOf(contours, style.metrics.capHeight * 0.3);
        const middle = (left + right) / 2;
        for (const y of [1.5, style.metrics.capHeight - 1.5]) {
          // F, K and N have their own business at the top; H, I, L and E do not.
          if (y > 100 && name !== "H" && name !== "I" && name !== "L" && name !== "E") continue;
          const [from, to] = runAt(contours, y, middle);
          expect(left - from, `${name} at ${weight}, left of the stem at ${y}`).toBeGreaterThan(
            reach * 0.45,
          );
          if (name === "H" || name === "I")
            expect(to - right, `${name} at ${weight}, right of the stem`).toBeGreaterThan(
              reach * 0.45,
            );
        }
      }
    }
  });

  it("cuts an upright along the line it stands on, whichever way the pen is held", () => {
    for (const angle of [-30, 8, 30]) {
      const style = at(SERIF, { angle });
      for (const name of ["H", "I", "L", "T"]) {
        const bounds = contoursBounds(draw(name, style));
        expect(bounds.yMin, `${name} at a pen of ${angle} degrees`).toBeGreaterThan(-0.5);
        expect(bounds.yMax, `${name} at a pen of ${angle} degrees`).toBeLessThan(
          style.metrics.capHeight + 0.5,
        );
      }
    }
  });

  it("thins a text serif toward its tip, and leaves a slab's square", () => {
    for (const weight of WEIGHTS) {
      const serif = at(SERIF, { weight });
      const slab = at(SLAB, { weight });
      for (const [style, wedge] of [
        [serif, true],
        [slab, false],
      ] as const) {
        const contours = draw("I", style);
        const [left] = stemOf(contours, style.metrics.capHeight * 0.3);
        const [from] = runAt(contours, 1.5, left + 1);
        const tip = columnAt(contours, from + 2, 1)[1];
        const root = columnAt(contours, left - 3, 1)[1];
        if (wedge) {
          expect(tip, `${style.name} I at ${weight}: tip against root`).toBeLessThan(root * 0.6);
        } else {
          expect(tip, `${style.name} I at ${weight}: tip against root`).toBeGreaterThan(root * 0.7);
        }
      }
    }
  });
});

describe("the head of a lowercase stem", () => {
  it("is one flag sloping down to the left on the Serif, and a level bar on the Slab", () => {
    for (const weight of WEIGHTS) {
      for (const name of ["i", "l", "n", "m", "r"]) {
        const sloped = at(SERIF, { weight });
        const contours = draw(name, sloped);
        const top = name === "l" ? sloped.metrics.ascender : sloped.metrics.xHeight;
        const [left, right] = stemOf(contours, sloped.metrics.xHeight * 0.3);
        const stem = right - left;
        // The top of the stem falls away to the left.
        const high = columnAt(contours, right - 2, top - 20)[1];
        const low = columnAt(contours, left + 2, top - stem * 0.45)[1];
        expect(high, `${name} at ${weight}: right corner on the line`).toBeGreaterThan(top - 1.5);
        expect(high - low, `${name} at ${weight}: slope across the stem`).toBeGreaterThan(
          stem * 0.2,
        );
        // A flag out to the left, below the line: the furthest the ink reaches
        // left of the stem anywhere in its head.
        let furthest = left;
        for (let y = top - 2; y > top - stem * 1.5; y -= 2) {
          if (inked(contours, { x: left + 2, y }))
            furthest = Math.min(furthest, runAt(contours, y, left + 2)[0]);
        }
        expect(left - furthest, `${name} at ${weight}: the flag`).toBeGreaterThan(
          serifReach(sloped) * 0.35,
        );
        // And nothing to the right of the i's or the l's stem at its head.
        if (name === "i" || name === "l") {
          expect(inked(contours, { x: right + 6, y: top - 4 }), `${name} at ${weight}`).toBe(false);
        }
      }
    }
    // A level head reaches both ways, as a slab's did before its flag.
    const level = at({
      ...SLAB,
      parts: { ...SLAB.parts, slab: { ...SLAB.parts.slab, head: "level" } },
    });
    const contours = draw("i", level);
    const [, right] = stemOf(contours, level.metrics.xHeight * 0.3);
    expect(inked(contours, { x: right + 6, y: level.metrics.xHeight - 4 })).toBe(true);
  });

  /*
   * The Slab's and the Typewriter's own heads are flags: one level wing to the
   * left, as Rockwell's and Courier's l, i, h and k have, so the l is not the
   * I. With a level bar both ways, as they were, the Slab's l and I were the
   * same letter a little taller.
   */
  it("is one level flag to the left on the Slab and the Typewriter, so the l is not an I", () => {
    for (const base of [SLAB, TYPEWRITER]) {
      for (const weight of [30, base.pen.weight, 200, 260]) {
        const style = at(base, { weight });
        for (const name of ["l", "i", "h", "k"]) {
          const contours = draw(name, style);
          const top = name === "i" ? style.metrics.xHeight : style.metrics.ascender;
          const [left, right] = stemOf(contours, style.metrics.xHeight * 0.3);
          expect(
            inked(contours, { x: right + 6, y: top - 3 }),
            `${base.name} ${name} at ${weight}: nothing right of the head`,
          ).toBe(false);
          expect(
            inked(contours, { x: left - 6, y: top - 3 }),
            `${base.name} ${name} at ${weight}: a flag to the left`,
          ).toBe(true);
        }
        // And the I keeps its serif both ways.
        const capital = draw("I", style);
        const [, right] = stemOf(capital, style.metrics.capHeight * 0.5);
        expect(inked(capital, { x: right + 6, y: style.metrics.capHeight - 3 })).toBe(true);
      }
    }
  });
});

/** How much ink a letter has, counted on a grid. */
function inkOf(contours: Contour[], step = 4): number {
  const bounds = contoursBounds(contours);
  let count = 0;
  for (let x = bounds.xMin; x <= bounds.xMax; x += step) {
    for (let y = bounds.yMin; y <= bounds.yMax; y += step) {
      if (inked(contours, { x, y })) count++;
    }
  }
  return count * step * step;
}

describe("the curved ends of a serif face", () => {
  it("finishes them with the terminal rather than cutting them square", () => {
    for (const weight of WEIGHTS) {
      const drop = at(SERIF, { weight });
      const flat = at(SERIF, { weight }, { terminal: { kind: "butt" } });
      for (const name of ["a", "c", "f", "r", "j"]) {
        const gained = inkOf(draw(name, drop)) - inkOf(draw(name, flat));
        expect(gained, `${name} at ${weight}: what the teardrop adds`).toBeGreaterThan(
          (weight * weight) / 20,
        );
      }
    }
  });

  it("reads the terminal's angle on a serif face", () => {
    const square = at(SERIF, {}, { terminal: { kind: "angled", angle: 0 } });
    const cut = at(SERIF, {}, { terminal: { kind: "angled", angle: 25 } });
    for (const name of ["c", "e"]) {
      expect(draw(name, cut), name).not.toEqual(draw(name, square));
    }
  });

  it("never hangs a teardrop on a capital or on a foot curling up off the line", () => {
    const drop = at(SERIF);
    const flat = at(SERIF, {}, { terminal: { kind: "butt" } });
    // Nor on an s, whose two ends wear beaks as the capital's do.
    for (const name of ["C", "S", "G", "e", "t", "s"]) {
      expect(draw(name, drop), name).toEqual(draw(name, flat));
    }
  });
});

describe("the serif face at the ends of its range", () => {
  const LETTERS = [..."HIETLKMNVWXYZAkvwxyzijlnmhbdpqruacfrjysgt"].concat([
    "one",
    "two",
    "three",
    "four",
    "five",
    "seven",
    "nine",
  ]);

  it("never draws a contour that crosses itself", () => {
    const folded: string[] = [];
    for (const weight of [30, 96, 200]) {
      for (const contrast of [0, 0.8]) {
        for (const angle of [-30, 0, 30]) {
          const style = at(SERIF, { weight, contrast, angle });
          for (const name of LETTERS) {
            for (const contour of draw(name, style)) {
              if (contoursIntersect([contour])) {
                folded.push(`${name} at ${weight}/${contrast}/${angle}`);
                break;
              }
            }
          }
        }
      }
    }
    expect(folded).toEqual([]);
  }, 120_000);

  it("draws a teardrop letter with the same nodes at every weight", () => {
    const book: WaveBook = {
      lengths: new Map(),
      bowls: new Map(),
      balls: new Map(),
      corners: new Map(),
      recording: true,
    };
    const was = openWaveBook(book);
    const adrift: string[] = [];
    try {
      for (const name of ["a", "c", "f", "r", "j", "s", "two", "three", "nine"]) {
        book.recording = true;
        waveBookAt(name);
        drawLetter(name, SERIF, SERIF.forms?.[name]);
        book.recording = false;
        const counts = [30, 60, 96, 150, 200].map((weight) => {
          waveBookAt(name);
          return draw(name, at(SERIF, { weight })).reduce((sum, one) => sum + one.nodes.length, 0);
        });
        if (new Set(counts).size !== 1) adrift.push(`${name}: ${counts.join(", ")}`);
      }
    } finally {
      openWaveBook(was);
    }
    expect(adrift).toEqual([]);
  });
});

describe("the controls", () => {
  it("offers the serif's shape and head, and the terminal's finish, as choices", () => {
    const slab = PART_SPECS.find((spec) => spec.name === "slab")!;
    const options = (key: string) =>
      slab.controls.find((control) => control.key === key)?.options?.map((one) => one.value);
    expect(options("shape")).toEqual(["square", "wedge"]);
    expect(options("head")).toEqual(["level", "sloped", "flag"]);
    const terminal = PART_SPECS.find((spec) => spec.name === "terminal")!;
    expect(
      terminal.controls.find((control) => control.key === "kind")?.options?.map((one) => one.value),
    ).toEqual(["butt", "level", "angled", "round", "teardrop"]);
  });

  it("starts the Serif as a text serif and leaves the slab faces square", () => {
    expect(SERIF.parts.slab.shape).toBe("wedge");
    expect(SERIF.parts.slab.head).toBe("sloped");
    expect(SERIF.parts.terminal.kind).toBe("teardrop");
    expect(SLAB.parts.slab.shape).toBe("square");
    expect(SLAB.parts.slab.head).toBe("flag");
  });
});
