/**
 * What the tool layer promises.
 *
 * Three of these are here because the thing they check was wrong first, and
 * wrong in a way that looked plausible on a contour count and ruinous on the
 * page. The sheet in `scripts/tools.ts` is what found them; these are what keep
 * them found.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contourArea, contoursBounds } from "@/font/geometry";
import { recipeOf } from "./letters";
import { scaleOf } from "./cut";
import { effectInk, noEffects, pointsIn, reachesEffects, type Effects } from "./effects";
import { drawLetter } from "./build";
import { BASES, type Style } from "./style";

const SANS = BASES.find((one) => one.name === "Sans")!;

const withOnly = (patch: (effects: Effects) => void): Effects => {
  const effects = noEffects();
  patch(effects);
  return effects;
};

/** The letter as the font has it, and the same letter as the tool left it. */
function bothWays(name: string, effects: Effects, style: Style = SANS) {
  const plain = drawLetter(name, style)!;
  const marked = drawLetter(name, style, undefined, undefined, undefined, undefined, effects)!;
  return { plain, marked };
}

beforeAll(async () => {
  await ready();
});

describe("what an effect reaches", () => {
  it("leaves a letter alone when nothing is on", () => {
    const { plain, marked } = bothWays("n", noEffects());
    expect(marked.contours).toEqual(plain.contours);
  });

  /*
   * A space has no strokes and an imported letter has no skeleton, and three of
   * the four effects are questions about the path the tool took. Asking them of
   * a letter that never had one is how a layer ends up doing work to hand back
   * what it was given.
   */
  it("knows that three of the four need a skeleton", () => {
    const rough = withOnly((e) => { e.rough.on = true; });
    const press = withOnly((e) => { e.press.on = true; });
    expect(reachesEffects(rough, [])).toBe(true);
    expect(reachesEffects(press, [])).toBe(false);
    expect(reachesEffects(noEffects(), recipeOf("n")!(SANS).strokes)).toBe(false);
  });
});

describe("the same settings give the same letter", () => {
  /*
   * Not a nicety. A letter that came out differently on each draw could not be
   * cached, could not be compared with itself, and would crawl under the hand.
   */
  it("draws the same outline twice", () => {
    const effects = withOnly((e) => { e.rough.on = true; e.skip.on = true; });
    const once = bothWays("a", effects).marked;
    const twice = bothWays("a", effects).marked;
    expect(twice.contours).toEqual(once.contours);
  });

  it("draws a different one from a different seed", () => {
    const one = withOnly((e) => { e.rough = { ...e.rough, on: true, seed: 1 }; });
    const other = withOnly((e) => { e.rough = { ...e.rough, on: true, seed: 2 }; });
    expect(bothWays("a", other).marked.contours).not.toEqual(bothWays("a", one).marked.contours);
  });
});

describe("the rough edge", () => {
  it("moves the edge without moving the letter", () => {
    const { plain, marked } = bothWays("n", withOnly((e) => { e.rough.on = true; }));
    expect(marked.contours).not.toEqual(plain.contours);

    // Still an n, standing where an n stands. The wander is a fraction of a
    // stem, so nothing may travel further than that.
    const was = contoursBounds(plain.contours);
    const now = contoursBounds(marked.contours);
    const room = SANS.pen.weight * 0.5;
    expect(Math.abs(now.xMin - was.xMin)).toBeLessThan(room);
    expect(Math.abs(now.xMax - was.xMax)).toBeLessThan(room);
    expect(Math.abs(now.yMax - was.yMax)).toBeLessThan(room);
  });

  /*
   * The seam is the artefact this kind of noise is known for: the edge starts
   * wandering at one value and comes back round to a different one, leaving a
   * step where the outline closed. Checked by measuring rather than by looking,
   * because a step of a few units is invisible on a page and glaring in a font.
   */
  it("closes the wander on itself, with no step where the outline began", () => {
    const { marked } = bothWays("o", withOnly((e) => {
      e.rough = { ...e.rough, on: true, amplitude: 0.12, wavelength: 0.7 };
    }));
    for (const contour of marked.contours) {
      const nodes = contour.nodes;
      if (nodes.length < 8) continue;
      const gaps: number[] = [];
      for (let at = 0; at < nodes.length; at++) {
        const next = nodes[(at + 1) % nodes.length].point;
        const here = nodes[at].point;
        gaps.push(Math.hypot(next.x - here.x, next.y - here.y));
      }
      const typical = gaps.reduce((sum, one) => sum + one, 0) / gaps.length;
      // The closing step is the one from the last node back to the first. A
      // seam shows up as that step being wildly out of line with the rest.
      expect(gaps[gaps.length - 1]).toBeLessThan(typical * 6);
    }
  });

  it("can be kept off the counters", () => {
    const inside = bothWays("o", withOnly((e) => { e.rough.on = true; })).marked;
    const outside = bothWays("o", withOnly((e) => {
      e.rough = { ...e.rough, on: true, reach: "outside" };
    })).marked;
    expect(outside.contours).not.toEqual(inside.contours);
  });
});

describe("pressure", () => {
  /*
   * The one that was wrong three times.
   *
   * Cutting at a guessed distance from the spine took the bowl clean off an a
   * and handed back a c, because the flank of a stroke is not half a pen-width
   * from its spine on any letter with a curve or a join in it. The letter has
   * to still be the letter.
   */
  it("thins the a without taking its bowl off", () => {
    const { plain, marked } = bothWays("a", withOnly((e) => { e.press.on = true; }));
    expect(marked.contours.length).toBeGreaterThan(0);

    // An a that has lost its bowl is an a that has lost most of its ink and
    // most of its width. Both are checked, because either alone can be fooled.
    const was = Math.abs(contourArea(plain.contours[0]));
    const now = marked.contours.reduce((sum, one) => sum + Math.abs(contourArea(one)), 0);
    expect(now).toBeGreaterThan(was * 0.5);

    const before = contoursBounds(plain.contours);
    const after = contoursBounds(marked.contours);
    expect(after.xMax - after.xMin).toBeGreaterThan((before.xMax - before.xMin) * 0.9);
  });

  /*
   * Half the stroke ends in the alphabet are buried inside another stroke, and
   * a hand lifting there never happened. Lightened anyway, the letters come
   * apart at exactly the places that hold them together.
   */
  it("lightens only at ends that are really ends", () => {
    const strokes = recipeOf("a")!(SANS).strokes;
    const buried = strokes.filter((one) => one.start.open !== true || one.end.open !== true);
    expect(buried.length).toBeGreaterThan(0);

    const { marked } = bothWays("a", withOnly((e) => {
      e.press = { on: true, at: "middle", amount: 0.8 };
    }));
    // Even at eight tenths, which is far past anything anybody would set, the
    // letter stays in one piece.
    expect(marked.contours.length).toBeLessThan(6);
  });

  it("leaves a letter drawn as one closed ring alone", () => {
    const strokes = recipeOf("o")!(SANS).strokes;
    expect(strokes.every((one) => one.spine.closed)).toBe(true);
    const plain = drawLetter("o", SANS)!;
    const marked = effectInk(
      plain.contours,
      strokes,
      scaleOf(SANS),
      withOnly((e) => { e.press.on = true; }),
    );
    /*
     * Measured rather than compared point for point. Fusing the strokes is the
     * first thing this layer does whatever is switched on, and a fuse re-fits a
     * circle to coordinates a hundred-thousandth of a unit off the ones it was
     * given -- which is not the letter changing, and asserting on it would be a
     * test of the boolean library's arithmetic rather than of this.
     */
    const was = plain.contours.reduce((sum, one) => sum + Math.abs(contourArea(one)), 0);
    const now = marked.reduce((sum, one) => sum + Math.abs(contourArea(one)), 0);
    expect(now).toBeCloseTo(was, 0);
    expect(contoursBounds(marked)).toMatchObject({
      xMin: expect.closeTo(contoursBounds(plain.contours).xMin, 1),
      xMax: expect.closeTo(contoursBounds(plain.contours).xMax, 1),
    });
  });
});

describe("what it costs", () => {
  /*
   * The number the export budget is built on, and the reason the roughening's
   * default wavelength is long rather than short. Held here so that a change to
   * either has to be a decision.
   */
  it("keeps a roughened letter under a few hundred points", () => {
    const { plain, marked } = bothWays("n", withOnly((e) => { e.rough.on = true; }));
    expect(pointsIn(plain.contours)).toBeLessThan(30);
    expect(pointsIn(marked.contours)).toBeGreaterThan(pointsIn(plain.contours));
    expect(pointsIn(marked.contours)).toBeLessThan(320);
  });
});
