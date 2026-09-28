/**
 * The joined faces held together at every weight the slider reaches: the
 * Light, their own, a pen of 200 and the heaviest the slider goes, 260.
 *
 * What these guard is the part of a script that only shows set as a word --
 * the join between two letters -- and they were written against faults that
 * showed there and nowhere else: at a Black every join fell back to a straight
 * run with a stub of the seam's heading hung off it, and the two stubs either
 * side of a seam crossed as an X between each pair of letters.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ready, unite } from "@/font/boolean";
import { contourArea } from "@/font/geometry";
import type { Vec2 } from "@/font/types";
import { contoursIntersect } from "@/font/outline";
import { drawLetter } from "./build";
import { readyToShape } from "./layers";
import { joiningHigh, joiningWithout, recipeOf } from "./letters";
import { seamHeading, seamsOf } from "./script";
import { alongSpine } from "./shapes";
import { BASES, heavier, scriptUnit, type Style } from "./style";
import type { Spine } from "./types";

const JOINED = ["Handwriting", "Formal Script", "Casual Script", "Monoline Script", "Roundhand"];
const base = (name: string): Style => BASES.find((one) => one.name === name)!;
const at = (style: Style, weight: number): Style => ({ ...style, pen: { ...style.pen, weight } });
const weightsOf = (style: Style) => [30, style.pen.weight, 200, 260];
const LOWER = "abcdefghijklmnopqrstuvwxyz".split("");

beforeAll(async () => {
  await ready();
  await readyToShape();
});

/** The heading at each end of every piece of a spine, in degrees. */
function headings(spine: Spine): Array<{ from: number; to: number }> {
  return spine.segments.map((segment) => {
    const points = alongSpine({ segments: [segment], closed: false }, 64);
    const angle = (a: Vec2, b: Vec2) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    return {
      from: angle(points[0], points[1]),
      to: angle(points[points.length - 2], points[points.length - 1]),
    };
  });
}

/** The sharpest turn from one piece of a spine to the next, in degrees. */
function sharpest(spine: Spine): number {
  const ends = headings(spine);
  let most = 0;
  for (let index = 1; index < ends.length; index++) {
    const turn = Math.abs(((ends[index].from - ends[index - 1].to + 540) % 360) - 180);
    most = Math.max(most, turn);
  }
  return most;
}

/** The strokes of a letter that reach out past its origin or its advance: its joins. */
function joinsOf(name: string, style: Style): Spine[] {
  const recipe = recipeOf(name as never)!(heavier(style));
  const width = recipe.width ?? Infinity;
  return recipe.strokes
    .map((stroke) => stroke.spine)
    .filter((spine) => {
      const xs = alongSpine(spine, 16).map((one) => one.x);
      return Math.min(...xs) < -1 || Math.max(...xs) > width + 1;
    });
}

describe("a join at every weight", () => {
  /*
   * A corner in the spine of a join is a stroke that folds over itself when
   * it is swept, and at a heavy weight it showed as a tick either side of
   * every seam. The join is one stroke from the letter to the seam and on
   * past it, and it turns smoothly the whole way.
   */
  it("has no corner in it, low or high", () => {
    const cornered: string[] = [];
    for (const name of JOINED) {
      for (const weight of weightsOf(base(name))) {
        const style = at(base(name), weight);
        for (const letter of LOWER) {
          for (const high of [false, true]) {
            const spines = joiningHigh({ entry: high, exit: high }, () => joinsOf(letter, style));
            for (const spine of spines) {
              const turn = sharpest(spine);
              if (turn > 12)
                cornered.push(
                  `${name} ${letter}${high ? "^" : ""} @${weight}: ${turn.toFixed(0)}°`,
                );
            }
          }
        }
      }
    }
    expect(cornered).toEqual([]);
  }, 300_000);

  /*
   * And the seam is somewhere a stem's foot can climb to. At the default
   * weights nothing moves; at a Black the seam comes up off the line and the
   * heading lies down to what one arc from the foot can reach, so the hand
   * still climbs through the seam rather than running level along it.
   */
  it("crosses its seam climbing, above the foot of the stem", () => {
    for (const name of JOINED) {
      const own = base(name);
      for (const weight of weightsOf(own)) {
        const style = heavier(at(own, weight));
        const half = style.pen.weight / 2;
        const unit = scriptUnit(style);
        const { xHeight } = style.metrics;
        const seams = seamsOf(style.parts.script, xHeight, half, unit);
        const way = seamHeading(style.parts.script, false, xHeight, half, unit);
        const degrees = (Math.atan2(way.y, way.x) * 180) / Math.PI;
        expect([name, weight, degrees >= 12]).toEqual([name, weight, true]);
        // A stem's foot is half a pen up; the seam stands clear of it.
        expect([name, weight, seams.low - half > xHeight * 0.1]).toEqual([name, weight, true]);
        // And the high seam leaves room under the waist to be left from.
        expect([name, weight, seams.high <= xHeight - half + 1e-6]).toEqual([name, weight, true]);
        if (weight === own.pen.weight) {
          expect([name, Math.round(degrees)]).toEqual([name, Math.min(70, own.parts.script.tilt)]);
        }
      }
    }
  });
});

describe("every drawing of a joined letter", () => {
  /*
   * The second drawings a shaper swaps in -- taken high after an `o`, a `v`,
   * a `w` or a `b`, and without a lead-in or a lead-out at the ends of a word
   * -- at every weight the slider reaches. The written `r` set after a `b`
   * aimed its lead-out at the waist and hooked back across itself, and the
   * written `n` taken high folded its lead-in into its own apex on four faces.
   */
  it("never crosses itself", () => {
    const crossed: string[] = [];
    const sides = [{}, { entry: false }, { exit: false }, { entry: false, exit: false }];
    for (const name of JOINED) {
      const own = base(name);
      for (const weight of [30, own.pen.weight, 120, 160, 200, 260]) {
        const style = at(own, weight);
        for (const letter of LOWER) {
          const form = own.forms?.[letter];
          for (const high of [false, true]) {
            for (const without of sides) {
              const drawn = joiningHigh({ entry: high, exit: high }, () =>
                joiningWithout(without, () => drawLetter(letter, style, form)),
              );
              if (!drawn) continue;
              if (drawn.contours.some((contour) => contoursIntersect([contour]))) {
                crossed.push(
                  `${name} ${letter}${high ? "^" : ""} ${JSON.stringify(without)} @${weight}`,
                );
              }
            }
          }
        }
      }
    }
    expect(crossed).toEqual([]);
  }, 600_000);
});

describe("a lead-out at a heavy weight", () => {
  /*
   * It leaves from the right of the letter, not from inside it. At a pen of
   * 260 the `c` and the `e` left from the far wall of their own bowls, and the
   * `b` from its stem, and each ran its lead-out straight through its counter.
   */
  it("starts at the letter's right, not across its counter", () => {
    const across: string[] = [];
    for (const name of JOINED) {
      const own = base(name);
      for (const weight of [200, 260]) {
        const style = at(own, weight);
        for (const letter of ["b", "c", "e", "k", "o", "v", "w", "x"]) {
          for (const high of [false, true]) {
            if (high && !"bovw".includes(letter)) continue;
            const recipe = joiningHigh({ exit: high }, () =>
              recipeOf(letter as never, own.forms?.[letter])!(heavier(style)),
            );
            const width = recipe.width ?? 0;
            const body = recipe.strokes
              .slice(0, -1)
              .flatMap((stroke) => alongSpine(stroke.spine, 32));
            const exit = recipe.strokes[recipe.strokes.length - 1].spine;
            const start = alongSpine(exit, 2)[0];
            if (start.x > width) continue;
            // The body's own right edge, around the height the lead-out leaves at.
            const near = body.filter(
              (one) => Math.abs(one.y - start.y) < style.metrics.xHeight * 0.35,
            );
            const right = Math.max(...near.map((one) => one.x));
            if (start.x < right - style.pen.weight * 0.75) {
              across.push(`${name} ${letter}${high ? "^" : ""} @${weight}`);
            }
          }
        }
      }
    }
    expect(across).toEqual([]);
  });
});

describe("the written e at a heavy weight", () => {
  /*
   * Its loop is as wide as the face's other bowls. Drawn as a circle on the
   * bowl's height, it stayed narrow while every other bowl widened to keep its
   * counter, and from a pen of 200 up the eye closed to nothing.
   */
  it("keeps an eye open", () => {
    const shut: string[] = [];
    for (const name of JOINED) {
      const own = base(name);
      if (own.forms?.e !== "written") continue;
      for (const weight of [200, 260]) {
        const style = at(own, weight);
        // Entered, as it is in a word: without its lead-in a written letter is
        // drawn as the plain one. The eye is then the one closed counter.
        const drawn = joiningWithout({ exit: false }, () => drawLetter("e", style, "written"))!;
        const holes = unite(drawn.contours, "winding")
          .map((contour) => -contourArea(contour))
          .filter((area) => area > 0);
        const eye = Math.max(0, ...holes);
        // A slit of white a tenth of the x-height across at the least.
        const least = (style.metrics.xHeight * 0.1) ** 2;
        if (eye < least) shut.push(`${name} @${weight}: ${eye.toFixed(0)}`);
      }
    }
    expect(shut).toEqual([]);
  });
});
