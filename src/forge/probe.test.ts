/**
 * Pressing a spot and getting the thing behind it.
 *
 * Two claims are being checked, and they are different in kind.
 *
 * The first is that the right control comes back: the arch of an n gives the
 * shoulder, the bar of an H gives the crossbar, the foot of a serifed l gives
 * the serif. Those are written out because they are what somebody would expect,
 * and a version of this that answered "slant" for all of them would look
 * perfectly reasonable from the inside.
 *
 * The second is that the handle tracks the pointer. That one is not an opinion
 * and is not checked against arithmetic: the handle is dragged a known distance,
 * the letter is drawn again, and the edge it was sitting on is measured. If the
 * edge did not move by what the drag asked for, the drag speed is wrong -- and
 * a drag speed being wrong is the failure this whole approach exists to rule
 * out, because it is the one that cannot be seen by reading the code.
 */

import { describe, expect, it } from "vitest";

import { contoursBounds, distance, flattenContour } from "@/font/geometry";
import type { Vec2 } from "@/font/types";
import { canDraw, drawLetter, makeLetter } from "./build";
import { valueAfter } from "./handles";
import { METRIC_CONTROLS, PART_SPECS, PEN_CONTROLS } from "./parts";
import { driveId, whatGoverns, withValue } from "./probe";
import { BASES, SANS, type Style } from "./style";

function baseNamed(name: string): Style {
  const found = BASES.find((base) => base.name === name);
  if (!found) throw new Error(`no base called ${name}`);
  return found;
}

/** Every point along a letter's edge, closely enough spaced to press one. */
function edgeOf(letter: string, style: Style, unslide = false): Vec2[] {
  const drawn = makeLetter(letter, style);
  if (!drawn) return [];
  const slide = unslide ? drawn.slide : 0;
  const points: Vec2[] = [];
  for (const contour of drawn.contours) {
    const walk = flattenContour(contour, 8);
    for (let index = 0; index < walk.length; index++) {
      const from = walk[index];
      const to = walk[(index + 1) % walk.length];
      const steps = Math.max(1, Math.ceil(distance(from, to) / 12));
      for (let step = 0; step < steps; step++) {
        const t = step / steps;
        points.push({
          x: from.x + (to.x - from.x) * t - slide,
          y: from.y + (to.y - from.y) * t,
        });
      }
    }
  }
  return points;
}

describe("what governs a spot", () => {
  it("gives the weight for the side of a stem", () => {
    const style = SANS;
    const { xMin } = contoursBounds(drawLetter("n", style)!.contours);
    // The right flank of the left stem, halfway up.
    const found = whatGoverns("n", style, {
      x: xMin + style.pen.weight,
      y: style.metrics.xHeight * 0.35,
    });
    expect(found).not.toBeNull();
    expect(driveId(found!.handle.drive)).toBe("pen:weight");
    expect(found!.handle.axis).toBe("x");
  });

  it("gives the shoulder for the arch of an n", () => {
    const style = SANS;
    const { xMin } = contoursBounds(drawLetter("n", style)!.contours);
    const found = whatGoverns("n", style, {
      x: xMin + style.pen.weight * 0.6,
      y: style.metrics.xHeight * 0.86,
    });
    expect(found).not.toBeNull();
    expect(driveId(found!.handle.drive)).toBe("part:shoulder:spring");
    // And it knows which run it was: an n's arch is the shoulder's.
    expect(found!.parts).toContain("shoulder");
  });

  it("gives the crossbar for the bar of an H", () => {
    const style = SANS;
    const bounds = contoursBounds(drawLetter("H", style)!.contours);
    const found = whatGoverns("H", style, {
      x: (bounds.xMin + bounds.xMax) / 2,
      y: style.metrics.capHeight * 0.5 + style.pen.weight * 0.4,
    });
    expect(found).not.toBeNull();
    expect(driveId(found!.handle.drive)).toBe("part:crossbar:height");
    expect(found!.handle.axis).toBe("y");
  });

  it("gives a bowl control for the outside of an o, not the weight", () => {
    const style = SANS;
    const bounds = contoursBounds(drawLetter("o", style)!.contours);
    const found = whatGoverns("o", style, {
      x: bounds.xMax - 1,
      y: style.metrics.xHeight * 0.5,
    });
    expect(found).not.toBeNull();
    // The outside of the bowl is where the bowl's own width takes it. The pen
    // thickens the ring inwards and leaves that edge exactly where it was, so
    // answering "weight" here would be answering with something that does not
    // move the place that was pressed.
    expect(found!.handle.drive).toMatchObject({ on: "part", part: "bowl" });
  });

  it("gives the serif for the foot of a slab l", () => {
    const style = baseNamed("Slab");
    const bounds = contoursBounds(drawLetter("l", style)!.contours);
    const found = whatGoverns("l", style, { x: bounds.xMin + 1, y: 4 });
    expect(found).not.toBeNull();
    expect(driveId(found!.handle.drive)).toBe("part:slab:projection");
  });

  it("gives nothing for a press that missed the letter", () => {
    const style = SANS;
    const bounds = contoursBounds(drawLetter("n", style)!.contours);
    expect(whatGoverns("n", style, { x: bounds.xMax + 400, y: 900 })).toBeNull();
  });

  it("has nothing to say about a letter it cannot draw", () => {
    expect(whatGoverns("not-a-letter", SANS, { x: 0, y: 0 })).toBeNull();
  });
});

describe("the drag speed", () => {
  /*
   * The claim: drag the handle by so many font units and the edge it sits on
   * moves by the same amount.
   *
   * Each case measures the one distance the drag is supposed to change, taken
   * off the drawing itself and nowhere near the machinery that set the speed --
   * the far side of a stem, the height of a bar, the outside of a bowl, the tip
   * of a serif. That independence is the point. A divisor out by the height of
   * a letter or the width of a stem produces a handle that runs hundreds of
   * times too fast, and reading the code is exactly how that mistake survives.
   *
   * Measured with the letter's own sideways nudge taken off, because some edges
   * are pinned to the sidebearing: lengthening a serif moves the rest of the
   * letter rather than the serif's tip. The shape did what the drag asked; what
   * stayed still is where the letter came to rest.
   */
  interface Case {
    letter: string;
    base: string;
    what: string;
    press: (style: Style) => Vec2;
    /** The distance the drag should change, in the letter's own frame. */
    measure: (style: Style) => number;
  }

  const boundsOf = (letter: string, style: Style) =>
    contoursBounds(makeLetter(letter, style)!.contours);

  const cases: Case[] = [
    {
      letter: "n",
      base: "Sans",
      what: "the far side of the stem",
      press: (style) => ({
        x: boundsOf("n", style).xMin + style.pen.weight,
        y: style.metrics.xHeight * 0.35,
      }),
      measure: (style) => {
        const made = makeLetter("n", style)!;
        return contoursBounds(made.runs[0].contours).xMax - made.slide;
      },
    },
    {
      letter: "H",
      base: "Sans",
      what: "the height of the bar",
      press: (style) => ({
        x: (boundsOf("H", style).xMin + boundsOf("H", style).xMax) / 2,
        y: style.metrics.capHeight * 0.5 + style.pen.weight * 0.4,
      }),
      measure: (style) => {
        const bar = makeLetter("H", style)!.runs.find((run) => run.parts.includes("crossbar"))!;
        return contoursBounds(bar.contours).yMax;
      },
    },
    {
      letter: "o",
      base: "Sans",
      what: "the outside of the bowl",
      press: (style) => ({ x: boundsOf("o", style).xMax - 1, y: style.metrics.xHeight * 0.5 }),
      measure: (style) => {
        const made = makeLetter("o", style)!;
        return contoursBounds(made.contours).xMax - made.slide;
      },
    },
    {
      letter: "l",
      base: "Slab",
      what: "the tip of the serif",
      press: (style) => ({ x: boundsOf("l", style).xMin + 1, y: 4 }),
      measure: (style) => {
        const made = makeLetter("l", style)!;
        return contoursBounds(made.contours).xMin - made.slide;
      },
    },
  ];

  for (const one of cases) {
    it(`follows the pointer on ${one.what} of a ${one.base} ${one.letter}`, () => {
      const style = baseNamed(one.base);
      const found = whatGoverns(one.letter, style, one.press(style));
      expect(found).not.toBeNull();
      const { handle } = found!;

      const before = one.measure(style);
      // Far enough to measure, small enough to stay inside the control.
      for (const pull of [14, -14]) {
        const value = valueAfter(handle, pull);
        if (value === handle.value) continue;
        const after = one.measure(withValue(style, handle.drive, value));
        // What the drag could actually take, which is less than what was asked
        // for when the control was already near one of its ends.
        const asked = (value - handle.value) / handle.perUnit;
        expect(after - before).toBeCloseTo(asked, -0.6);
      }
    });
  }
});

describe("whatever comes back", () => {
  const known = new Set<string>([
    ...PEN_CONTROLS.map((control) => `pen:${control.key}`),
    ...METRIC_CONTROLS.map((control) => `metrics:${control.key}`),
    ...PART_SPECS.flatMap((spec) => spec.controls.map((control) => `part:${spec.name}:${control.key}`)),
  ]);

  /*
   * Pressed all over, on every kind of face this application draws.
   *
   * The point is not that the answers are the ones a designer would give -- the
   * cases above say that -- but that there is never an answer the panel cannot
   * show. A handle naming a control that does not exist would drive nothing and
   * look exactly like one that works.
   */
  it("names a control the panel has, at a value the control allows", () => {
    for (const base of BASES) {
      for (const letter of ["n", "o", "H", "A", "e", "g", "s", "l"]) {
        if (!canDraw(letter)) continue;
        const edge = edgeOf(letter, base);
        if (edge.length === 0) continue;
        for (let index = 0; index < edge.length; index += Math.ceil(edge.length / 12)) {
          const found = whatGoverns(letter, base, edge[index]);
          if (!found) continue;
          const { handle } = found;
          expect(known.has(driveId(handle.drive))).toBe(true);
          expect(handle.value).toBeGreaterThanOrEqual(handle.min - 1e-9);
          expect(handle.value).toBeLessThanOrEqual(handle.max + 1e-9);
          expect(Number.isFinite(handle.perUnit)).toBe(true);
          expect(handle.perUnit).not.toBe(0);
        }
      }
    }
  }, 120_000);

  /*
   * The two things done to a letter after it is drawn.
   *
   * A slant shears the finished outline and a monospaced face slides it into
   * the middle of a common advance, so on both of those the place a press lands
   * is not the place the strokes were drawn. Both are the same reading of the
   * letter through a different transform, and the way to find out whether that
   * survives is to press the same features and see the same answers.
   */
  it("still finds the same things through a slant and a common width", () => {
    const upright = baseNamed("Sans");
    const leaning: Style = {
      ...upright,
      metrics: { ...upright.metrics, slant: 12 },
    };
    const boxed: Style = {
      ...upright,
      metrics: { ...upright.metrics, monospaced: true },
    };

    for (const style of [leaning, boxed]) {
      const bounds = contoursBounds(drawLetter("H", style)!.contours);
      const bar = whatGoverns("H", style, {
        x: (bounds.xMin + bounds.xMax) / 2,
        y: style.metrics.capHeight * 0.5 + style.pen.weight * 0.4,
      });
      expect(bar).not.toBeNull();
      expect(driveId(bar!.handle.drive)).toBe("part:crossbar:height");

      const round = contoursBounds(drawLetter("o", style)!.contours);
      const bowl = whatGoverns("o", style, {
        x: round.xMax - 1,
        y: style.metrics.xHeight * 0.5,
      });
      expect(bowl).not.toBeNull();
      expect(bowl!.handle.drive).toMatchObject({ on: "part", part: "bowl" });
    }
  });

  it("only ever names a run's own parts, or the pen", () => {
    for (const letter of ["n", "o", "H", "l"]) {
      for (const at of edgeOf(letter, SANS).filter((_, index) => index % 17 === 0)) {
        const found = whatGoverns(letter, SANS, at);
        if (!found || found.handle.drive.on !== "part") continue;
        const part = found.handle.drive.part;
        // The serif lives on a terminal, so a run wearing one may answer with it.
        const allowed = part === "slab" ? found.parts.includes("terminal") : found.parts.includes(part);
        expect(allowed).toBe(true);
      }
    }
  });
});

describe("taking a letter apart", () => {
  it("draws the same letter whether or not the runs are kept", () => {
    for (const base of BASES) {
      for (const letter of ["n", "o", "H", "g"]) {
        const made = makeLetter(letter, base);
        const drawn = drawLetter(letter, base);
        expect(made === null).toBe(drawn === null);
        if (!made || !drawn) continue;
        expect(made.advanceWidth).toBeCloseTo(drawn.advanceWidth, 6);
        expect(contoursBounds(made.contours)).toEqual(contoursBounds(drawn.contours));
      }
    }
  });

  it("puts every run's ink where the letter's ink is", () => {
    for (const letter of ["n", "H", "o", "E"]) {
      const made = makeLetter(letter, SANS);
      if (!made) continue;
      const whole = contoursBounds(made.contours);
      for (const run of made.runs) {
        const part = contoursBounds(run.contours);
        expect(part.xMin).toBeGreaterThanOrEqual(whole.xMin - 1e-6);
        expect(part.xMax).toBeLessThanOrEqual(whole.xMax + 1e-6);
        expect(part.yMin).toBeGreaterThanOrEqual(whole.yMin - 1e-6);
        expect(part.yMax).toBeLessThanOrEqual(whole.yMax + 1e-6);
      }
    }
  });

  it("says which named decisions each run was built from", () => {
    const n = makeLetter("n", SANS)!;
    expect(n.runs).toHaveLength(2);
    expect(n.runs[1].parts).toContain("shoulder");
    // The stem is not the shoulder's, whatever else it is.
    expect(n.runs[0].parts).not.toContain("shoulder");

    const H = makeLetter("H", SANS)!;
    expect(H.runs.map((run) => run.parts.includes("crossbar"))).toEqual([false, false, true]);

    expect(makeLetter("o", SANS)!.runs[0].parts).toContain("bowl");
  });
});
