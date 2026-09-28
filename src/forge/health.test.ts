/**
 * The warnings, checked for saying something true.
 *
 * A warning that fires on a font nobody would call broken is worse than no
 * warning: it teaches people to ignore the strip it appears in. So the three
 * bases have to come back clean, and a pen wide enough to close an e has to be
 * noticed.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { builtFrom } from "./build";
import { readyToShape } from "./layers";
import { noCuts, type Cuts } from "./cut";
import { startFrom, type Forge } from "./document";
import { troubles } from "./health";
import { DISPLAY, SANS, SERIF } from "./style";

const heavier = (forge: Forge, weight: number): Forge => ({
  ...forge,
  style: { ...forge.style, pen: { ...forge.style.pen, weight } },
});

describe("what has gone wrong", () => {
  it("says nothing about the three bases", () => {
    for (const base of [SANS, SERIF, DISPLAY]) {
      expect(troubles(startFrom(base)), `${base.name} was warned about`).toEqual([]);
    }
  });

  it("says nothing about the bases at the lightest weight", () => {
    /*
     * The slack past the ascender and descender used to be the pen's width
     * alone, so at thirty units the parentheses, the dollar, the circumflex and
     * the ogonek -- which reach a set distance past the lines at every weight --
     * were reported as overflowing, with advice to use less weight on a pen
     * already at the minimum.
     */
    for (const base of [SANS, SERIF]) {
      expect(troubles(heavier(startFrom(base), 30)), `${base.name} at 30`).toEqual([]);
    }
  });

  it("still notices a letter reaching well past its line", () => {
    const sans = startFrom(SANS);
    const short = {
      ...sans,
      style: {
        ...sans.style,
        pen: { ...sans.style.pen, weight: 30 },
        metrics: { ...sans.style.metrics, ascender: sans.style.metrics.xHeight + 60 },
      },
    };
    const said = troubles(short).find((one) => one.what === "Reaching past the line");
    expect(said?.letters.length).toBeGreaterThan(10);
    // The capitals stand over an ascender pulled down to them, so the way out
    // is up; and never the weight, which was already at the minimum here.
    expect(said?.fix).toBe("A taller ascender gives them room.");
    expect(said?.fix).not.toMatch(/weight/i);
  });

  it("measures a slanted letter as its neighbour meets it", () => {
    /*
     * Leant about the waist, the feet of a letter swing left of the origin, as
     * in any italic, and the letter before leans with it. Twelve degrees used
     * to report most of the alphabet as touching the letter before it.
     */
    const slanted = (
      forge: Forge,
      slant: number,
      sidebearing = forge.style.metrics.sidebearing,
    ) => ({
      ...forge,
      style: { ...forge.style, metrics: { ...forge.style.metrics, slant, sidebearing } },
    });
    for (const base of [SANS, SERIF]) {
      const said = troubles(slanted(startFrom(base), 12)).find(
        (one) => one.what === "Touching the letter before it",
      );
      // Letters built from an accent are left to the letters: an accent that
      // does not lean with its letter can meet a tall neighbour, and that is
      // worth saying.
      const plain = (said?.letters ?? []).filter((letter) => !builtFrom(letter));
      expect(plain, `${base.name} at 12 degrees`).toEqual([]);
    }
    // With no spacing at all it is still said, slant or none.
    const tight = troubles(slanted(startFrom(SANS), 12, 0)).find(
      (one) => one.what === "Touching the letter before it",
    );
    expect(tight?.letters.length).toBeGreaterThan(10);
  });

  it("names the descender when it is the line being crossed", () => {
    const sans = startFrom(SANS);
    const shallow = {
      ...sans,
      style: {
        ...sans.style,
        pen: { ...sans.style.pen, weight: 30 },
        metrics: { ...sans.style.metrics, descender: -40 },
      },
    };
    const said = troubles(shallow).find((one) => one.what === "Reaching past the line");
    expect(said?.letters).toContain("comma");
    expect(said?.fix).toBe("A deeper descender gives them room.");
  });

  it("stays quiet on a heavy cut that still works", () => {
    /*
     * A pen of a hundred and seventy-five units on a 520 x-height is as heavy
     * as the display face on a narrower letter, and its counters are still a
     * hundred and seventy units across. Warning here would teach people to
     * ignore the strip the warnings appear in.
     *
     * This used to say two hundred and sixty. Once a round letter is drawn to
     * fit between its own two lines rather than straddling them, a pen that
     * heavy leaves twenty units of counter and the warning is telling the
     * truth; the first thing to close is the figure eight, which has two rings
     * to fit into one cap height.
     */
    expect(troubles(heavier(startFrom(SANS), 175))).toEqual([]);
  });

  it("notices a counter that has closed", () => {
    // Heavy and condensed together: the counters come down to a few units of
    // hole, which is a printing fault rather than a counter.
    const narrow: Forge = {
      ...heavier(startFrom(SANS), 260),
      style: {
        ...heavier(startFrom(SANS), 260).style,
        metrics: { ...SANS.metrics, width: 0.6 },
      },
    };
    /*
     * Which letters, rather than the eight by name: a heavy weight now widens
     * its figures to keep their counters (see `heavyFigure`), so at this width
     * it is the letters with two rings side by side that go first.
     */
    const closing = troubles(narrow).find((one) => one.what === "Counters closing up");
    expect(closing, "a heavy condensed cut closes its counters").toBeDefined();
    expect(closing!.letters.length).toBeGreaterThan(0);
  });

  it("notices letters running into the one before", () => {
    const tight: Forge = {
      ...startFrom(SANS),
      style: { ...SANS, metrics: { ...SANS.metrics, sidebearing: 0 } },
    };
    const found = troubles(tight).find((one) => one.what === "Touching the letter before it");
    expect(found).toBeDefined();
  });

  it("names the letters rather than only the fault", () => {
    // The whole point is being able to go and look at one.
    const pushed: Forge = {
      ...heavier(startFrom(SANS), 260),
      style: {
        ...heavier(startFrom(SANS), 260).style,
        metrics: { ...SANS.metrics, width: 0.6, sidebearing: 0 },
      },
    };
    for (const trouble of troubles(pushed)) {
      expect(trouble.letters.length).toBeGreaterThan(0);
      expect(trouble.fix.length).toBeGreaterThan(0);
    }
  });

  it("says more the further it is pushed", () => {
    const count = (width: number) => {
      const forge: Forge = {
        ...heavier(startFrom(SANS), 260),
        style: {
          ...heavier(startFrom(SANS), 260).style,
          metrics: { ...SANS.metrics, width },
        },
      };
      return troubles(forge).reduce((total, one) => total + one.letters.length, 0);
    };
    expect(count(0.6)).toBeGreaterThan(count(1));
  });
});

describe("what a cut did", () => {
  const withCuts = (forge: Forge, patch: (cuts: Cuts) => void): Forge => {
    const cuts = noCuts();
    patch(cuts);
    return { ...forge, cuts };
  };

  beforeAll(async () => {
    await readyToShape();
  });

  it("says nothing when nothing has been cut", () => {
    const cut = withCuts(startFrom(SANS), () => {});
    expect(troubles(cut)).toEqual([]);
  });

  it("counts the letters a break has taken apart", () => {
    const stencil = withCuts(startFrom(SANS), (cuts) => {
      cuts.split.on = true;
    });
    const said = troubles(stencil).find((one) => one.what.includes("cut into pieces"));
    expect(said).toBeDefined();
    // Every letter with two strokes running into each other, which is most of
    // the alphabet -- and the number is what tells somebody this is a stencil
    // rather than an accident. Past a dozen the names are not listed, because
    // fourteen arbitrary letters off the front of the alphabet are not a way
    // in to anything.
    expect(Number(said!.what.split(" ")[0])).toBeGreaterThan(20);
    expect(said!.letters).toEqual([]);
  });

  it("names them while there are few enough for names to help", () => {
    // One letter cut apart, and the rest of the font left alone.
    const forge = startFrom(SANS);
    const nearly = {
      ...forge,
      cuts: noCuts(),
      cutExceptions: { E: { split: { on: true } } },
    };
    const said = troubles(nearly).find((one) => one.what.includes("cut into pieces"));
    expect(said).toBeDefined();
    expect(said!.letters).toEqual(["E"]);
  });

  it("does not call the space a letter cut away to nothing", () => {
    // It has no ink and never had any, which is exactly right for a space.
    const cut = withCuts(startFrom(SANS), (cuts) => {
      cuts.slot.on = true;
    });
    const gone = troubles(cut).find((one) => one.what === "Cut away to nothing");
    expect(gone?.letters ?? []).not.toContain("space");
  });

  it("says when a cut has taken a letter away entirely", () => {
    const eaten = withCuts(startFrom(SANS), (cuts) => {
      // One band twenty stems thick, which is taller than any letter here.
      cuts.slot = { on: true, count: 1, width: 20, angle: 0, inset: 0 };
    });
    const gone = troubles(eaten).find((one) => one.what === "Cut away to nothing");
    expect(gone).toBeDefined();
    expect(gone!.letters.length).toBeGreaterThan(0);
  });
});
