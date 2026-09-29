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
import { contourArea, contoursBounds } from "@/font/geometry";
import type { Contour, Vec2 } from "@/font/types";
import { contoursIntersect } from "@/font/outline";
import { drawLetter } from "./build";
import { readyToShape } from "./layers";
import { joinEnds, joiningHigh, joiningWithout, recipeOf } from "./letters";
import { HANDS_OVER_HIGH, seamHeading, seamsOf } from "./script";
import { alongSpine, spineEnd, spineStart } from "./shapes";
import { sweep } from "./sweep";
import { BASES, heavier, scriptUnit, type Style } from "./style";
import type { Spine } from "./types";

const JOINED = ["Handwriting", "Formal Script", "Casual Script", "Monoline Script", "Roundhand"];
const base = (name: string): Style => BASES.find((one) => one.name === name)!;
const at = (style: Style, weight: number): Style => ({ ...style, pen: { ...style.pen, weight } });
const weightsOf = (style: Style) => [30, style.pen.weight, 200, 260];
const LOWER = "abcdefghijklmnopqrstuvwxyz".split("");
const CAPITAL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

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
   *
   * At every fifth weight the slider reaches, and at the ones where a fold was
   * found between them: the Roundhand's `s` at 209 to 212 and the Monoline's
   * word-end `r` at 217, each a hairline on one weight and on neither side of
   * it, which a handful of weights stepped straight over. The capitals too,
   * which hand on and so are drawn with and without a lead-out.
   */
  it("never crosses itself", () => {
    const crossed: string[] = [];
    const sides = [{}, { entry: false }, { exit: false }, { entry: false, exit: false }];
    const steps = Array.from({ length: 49 }, (_, index) => 20 + index * 5);
    for (const name of JOINED) {
      const own = base(name);
      const weights = [...new Set([30, own.pen.weight, ...steps, 209, 210, 211, 212, 217])];
      for (const weight of weights) {
        const style = at(own, weight);
        for (const letter of [...LOWER, ...CAPITAL]) {
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

describe("a looped ascender and descender", () => {
  /*
   * The run an eye turns off ends round where it turns: a written loop is one
   * stroke going up, turning over and coming back down. Cut square, the run
   * stood up past the eye in a flag at the top of every looped `l` and left a
   * nick at the foot of every looped `g` on the Roundhand.
   */
  it("turns on the pen's round end", () => {
    const square: string[] = [];
    for (const name of JOINED) {
      const own = base(name);
      if (own.parts.script.loop <= 0) continue;
      for (const weight of weightsOf(own)) {
        const style = heavier(at(own, weight));
        for (const [letter, up] of [
          ["l", true],
          ["g", false],
        ] as const) {
          const recipe = recipeOf(letter, own.forms?.[letter])!(style);
          const ends = recipe.strokes.flatMap((stroke) => [
            { at: spineStart(stroke.spine), cap: stroke.start.kind },
            { at: spineEnd(stroke.spine), cap: stroke.end.kind },
          ]);
          const extreme = ends.reduce((best, one) =>
            (up ? one.at.y > best.at.y : one.at.y < best.at.y) ? one : best,
          );
          // Only where this weight draws an eye at all.
          const eyes =
            recipe.strokes.length >
            recipeOf(letter, own.forms?.[letter])!({
              ...style,
              parts: { ...style.parts, script: { ...style.parts.script, loop: 0 } },
            }).strokes.length;
          if (eyes && extreme.cap !== "round")
            square.push(`${name} ${letter} @${weight}: ${extreme.cap}`);
        }
      }
    }
    expect(square).toEqual([]);
  });
});

describe("a looped ascender at a Light", () => {
  /*
   * The eye is measured in the face's own pen, as the joins are, and not in
   * the hairline: at a pen of 30 the eyes of the Casual Script's `l`, `h` and
   * `k` were a few units across and filled in as teardrops.
   */
  it("keeps its eye open", () => {
    const shut: string[] = [];
    for (const name of JOINED) {
      const own = base(name);
      if (own.parts.script.loop <= 0) continue;
      const style = at(own, 30);
      const drawn = drawLetter("l", style, own.forms?.l)!;
      const eye = Math.max(
        0,
        ...unite(drawn.contours, "winding").map((contour) => -contourArea(contour)),
      );
      if (eye < (style.metrics.xHeight * 0.12) ** 2) shut.push(`${name}: ${eye.toFixed(0)}`);
    }
    expect(shut).toEqual([]);
  });
});

describe("a joined face as a variable font", () => {
  /*
   * Every letter and every second drawing of it rides the weight axis: the
   * same points at the Thin, the Light, the Bold and the Black as at the
   * weight the family was drawn at. Joins used to be drawn one way at one
   * weight and another at the next, eyes came and went with the pen, and the
   * second drawings were drawn after the book of the drawn weight's decisions
   * had been put away -- the Monoline held back 107 glyphs and the Roundhand
   * 105.
   */
  it("holds back no lowercase letter or alternate", async () => {
    const { deliver } = await import("./deliver");
    const { setFamily, startFrom } = await import("./document");
    const held: string[] = [];
    // Every joined face: the two whose masters came apart, and the three that
    // rode the axis and have to go on doing so.
    for (const name of JOINED) {
      let forge = startFrom(base(name));
      const drawn = forge.family!.drawn;
      forge = setFamily(forge, {
        drawn,
        also: [100, 300, 700, 900].filter((weight) => weight !== drawn),
      });
      const result = await deliver(forge, { familyName: "T", format: "ttf", variable: true });
      held.push(
        ...result.held
          .filter((glyph) => /^[a-z](\.|$)/.test(glyph))
          .map((glyph) => `${name} ${glyph}`),
      );
    }
    expect(held).toEqual([]);
  }, 900_000);
});

describe("a join and the baseline", () => {
  /*
   * A join never hangs further under the line than a round letter's
   * overshoot, or than the letter it leaves already does. A lead-out that
   * had to leave along the line and be climbing by the seam dipped first --
   * the Monoline `T` went thirteen units under its baseline -- and at 260 the
   * `x` left from the foot of its leg with half its ink below the line.
   */
  it("stays off the line", () => {
    const under: string[] = [];
    for (const name of JOINED) {
      const own = base(name);
      for (const weight of weightsOf(own)) {
        const style = heavier(at(own, weight));
        for (const letter of [..."abcdefghijklmnopqrstuvwxyz", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]) {
          for (const high of [false, true]) {
            if (high && !"bovw".includes(letter)) continue;
            const recipe = joiningHigh({ exit: high }, () =>
              recipeOf(letter as never, own.forms?.[letter])?.(style),
            );
            if (!recipe) continue;
            // The joins are the last strokes: an exit, and an entry unless the
            // letter carries its own lead-in or never has one.
            const ends = joinEnds(letter);
            const count = (ends.exit ? 1 : 0) + (ends.entry && !recipe.entered ? 1 : 0);
            if (count === 0 || recipe.strokes.length <= count) continue;
            const lowest = (strokes: typeof recipe.strokes) =>
              Math.min(
                ...strokes.flatMap((one) => sweep(one)).map((c) => contoursBounds([c]).yMin),
              );
            const body = lowest(recipe.strokes.slice(0, -count));
            const joins = lowest(recipe.strokes.slice(-count));
            const floor = Math.min(-own.metrics.overshoot, body) - 2;
            if (joins < floor)
              under.push(`${name} ${letter}${high ? "*" : ""} @${weight}: ${joins.toFixed(0)}`);
          }
        }
      }
    }
    expect(under).toEqual([]);
  }, 300_000);
});

describe("the written r", () => {
  /*
   * A stem standing the full x-height with an arm springing off it, as the
   * reference scripts write it. Drawn as an up-stroke into a notch and a
   * slanting down-stroke, the lead-in and the down-stroke made the two arms of
   * a `v` after every low join -- `quartz` read `quavtz` -- and with the
   * shoulder rounded over the top it read as a `c`.
   */
  it("stands on a full stem with an arm reaching off it", () => {
    const wrong: string[] = [];
    for (const name of JOINED) {
      const own = base(name);
      if (own.forms?.r !== "written") continue;
      for (const weight of weightsOf(own)) {
        const style = heavier(at(own, weight));
        const x = style.metrics.xHeight;
        const strokes = recipeOf("r", "written")!(style).strokes;
        const points = (spine: Spine) => alongSpine(spine, 64);
        // The stem: one stroke running from the x-height to the line.
        const stem = strokes.find((stroke) => {
          const ys = points(stroke.spine).map((p) => p.y);
          // Its spine, which stands half a pen inside the ink at either end.
          const half = style.pen.weight / 2;
          return Math.max(...ys) >= x * 0.85 - half && Math.min(...ys) <= x * 0.15 + half;
        });
        if (!stem) {
          wrong.push(`${name} @${weight}: no stem`);
          continue;
        }
        const left = Math.min(...points(stem.spine).map((p) => p.x));
        // The arm: ink in the top half reaching well right of the stem.
        const reach = Math.max(
          ...strokes
            .filter((stroke) => stroke !== stem)
            .flatMap((stroke) => points(stroke.spine))
            .filter((p) => p.y > x * 0.5)
            .map((p) => p.x - left),
        );
        if (!(reach >= x * 0.3)) wrong.push(`${name} @${weight}: arm reaches ${reach.toFixed(0)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("a join into a bowl", () => {
  /*
   * The lead-out runs on past the seam by half the weld. It used to run the
   * whole weld, which the next letter's lead-in lies over -- but a bowl with no
   * lead-in of its own took the square end inside its wall, and its corner stood in the
   * counter: a tick inside every `o` and `a` after a low join on the Formal
   * Script and the Monoline, and after `v` and `w` on three faces.
   */
  it("leaves the bowl's counter as it was", () => {
    const holes = (contours: Contour[]) =>
      unite(contours, "winding")
        .map((contour) => -contourArea(contour))
        .filter((area) => area > 0)
        .reduce((sum, area) => sum + area, 0);
    const filled: string[] = [];
    for (const name of JOINED) {
      const own = base(name);
      for (const weight of [30, own.pen.weight]) {
        const style = at(own, weight);
        for (const [first, second] of [
          ["n", "o"],
          ["n", "a"],
          ["v", "o"],
          ["w", "a"],
          ["b", "e"],
        ]) {
          const high = HANDS_OVER_HIGH.has(first);
          const one = joiningHigh({ exit: high }, () =>
            joiningWithout({ entry: false }, () => drawLetter(first, style, own.forms?.[first])),
          )!;
          const two = joiningHigh({ entry: high }, () =>
            joiningWithout({ exit: false }, () => drawLetter(second, style, own.forms?.[second])),
          )!;
          const moved = two.contours.map((contour) => ({
            ...contour,
            nodes: contour.nodes.map((node) => ({
              ...node,
              point: { x: node.point.x + one.advanceWidth, y: node.point.y },
              handleIn: node.handleIn && {
                x: node.handleIn.x + one.advanceWidth,
                y: node.handleIn.y,
              },
              handleOut: node.handleOut && {
                x: node.handleOut.x + one.advanceWidth,
                y: node.handleOut.y,
              },
            })),
          }));
          const lost = holes(one.contours) + holes(moved) - holes([...one.contours, ...moved]);
          if (lost > style.metrics.xHeight ** 2 * 0.002) {
            filled.push(`${name} @${weight} ${first}${second}: ${lost.toFixed(0)}`);
          }
        }
      }
    }
    expect(filled).toEqual([]);
  }, 300_000);
});

describe("the s at a heavy weight", () => {
  /*
   * A joined face's s was always the text s, which grows past its lines
   * rather than close up when the pen leaves it no room. At 260 on an
   * x-height of 332 that room is 72 units, and the s stood a third of an
   * x-height over the line and hung under it: a black `§` in the word. It is
   * the Black s now, as on every other face, which lays its spine flatter
   * instead and keeps to the lines the `o` beside it keeps to -- within a
   * twentieth of an x-height at 260, where even a flat spine has no room left
   * and it grows a little, as the Black s does on every face.
   */
  it("keeps to the lines the o keeps to", () => {
    const out: string[] = [];
    for (const name of JOINED) {
      const own = base(name);
      for (const weight of [200, 260]) {
        const style = at(own, weight);
        const x = style.metrics.xHeight;
        const past = (letter: string) => {
          const drawn = joiningWithout({ entry: false, exit: false }, () =>
            drawLetter(letter, style, own.forms?.[letter]),
          )!;
          const box = contoursBounds(drawn.contours);
          return Math.max(box.yMax - x, -box.yMin);
        };
        const s = past("s");
        const o = past("o");
        if (s > o + x * 0.05) out.push(`${name} @${weight}: s ${s.toFixed(0)}, o ${o.toFixed(0)}`);
      }
    }
    expect(out).toEqual([]);
  });
});

describe("a capital handing on", () => {
  /*
   * Not from the foot of a stem standing on its own under the letter: a foot
   * going right off the `T` or the `Y` is the foot of an `L`, and `The` set
   * as `Lhe`. The pen lifts after them, as it does after an `I`.
   */
  it("lifts after a T and a Y", () => {
    expect(["T", "Y", "I"].filter((letter) => joinEnds(letter).exit)).toEqual([]);
  });
});

describe("the high hand-over at a heavy weight", () => {
  /*
   * Level at every face's own weight, and climbing a little once the pen is
   * heavy against the letter. Held level at 260, it was a thin rule laid
   * between two black shapes after every `o`, `v`, `w` and `b`.
   */
  it("climbs at 260 and runs level at the face's own weight", () => {
    for (const name of JOINED) {
      const own = base(name);
      const x = own.metrics.xHeight;
      const script = own.parts.script;
      const unit = scriptUnit(own);
      const atOwn = seamHeading(script, true, x, own.pen.weight / 2, unit);
      const heavy = seamHeading(script, true, x, 130, unit);
      expect([name, Math.abs(atOwn.y) < 1e-9]).toEqual([name, true]);
      expect([name, heavy.y > 0.15]).toEqual([name, true]);
    }
  });
});

describe("the e set in a word at a heavy weight", () => {
  /*
   * Its eye open by a fortieth of an x-height squared at the least. The bar
   * of the written `e` was drawn at join weight and the Roundhand's plain one
   * at the full stem's, and at 260 each filled the eye to a slit: a hundredth
   * of an x-height squared on the Roundhand, not much more on the Monoline.
   */
  it("keeps its eye open", () => {
    const shut: string[] = [];
    for (const name of JOINED) {
      const own = base(name);
      for (const weight of [200, 260]) {
        const style = at(own, weight);
        const drawn = drawLetter("e", style, own.forms?.e)!;
        const eye = Math.max(
          0,
          ...unite(drawn.contours, "winding")
            .map((contour) => -contourArea(contour))
            .filter((area) => area > 0),
        );
        const x = style.metrics.xHeight;
        if (eye < x * x * 0.025)
          shut.push(`${name} @${weight}: ${((eye / (x * x)) * 100).toFixed(1)}%`);
      }
    }
    expect(shut).toEqual([]);
  });
});

describe("a looped ascender on a broad nib", () => {
  /*
   * Comes home inside its stem, so the top of the letter is the nib's own cut.
   * The eye's round end, swept with a lighter nib than the stem, stood a few
   * units past the stem's flat top: a small horn at the head of every looped
   * `b`, `h`, `k` and `l` on the Handwriting, the Formal and the Casual Script.
   */
  it("stops under the top of its stem", () => {
    const horned: string[] = [];
    for (const name of ["Handwriting", "Formal Script", "Casual Script"]) {
      const own = base(name);
      for (const weight of [30, own.pen.weight]) {
        const style = at(own, weight);
        for (const letter of ["b", "h", "k", "l"]) {
          const drawn = drawLetter(letter, style, own.forms?.[letter])!;
          const boxes = drawn.contours.map((contour) => contoursBounds([contour]));
          const top = boxes.reduce((most, box) => (box.yMax > most.yMax ? box : most));
          // The stem is the one piece that reaches down to the line.
          if (top.yMin > style.metrics.xHeight * 0.3) horned.push(`${name} @${weight} ${letter}`);
        }
      }
    }
    expect(horned).toEqual([]);
  });
});
