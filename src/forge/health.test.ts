/**
 * The warnings, checked for saying something true.
 *
 * A warning that fires on a font nobody would call broken is worse than no
 * warning: it teaches people to ignore the strip it appears in. So the three
 * bases have to come back clean, and a pen wide enough to close an e has to be
 * noticed.
 */

import { describe, expect, it } from "vitest";

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
    // Heavy and condensed together: the figures come down to sixteen units of
    // hole, which is a printing fault rather than a counter.
    const narrow: Forge = {
      ...heavier(startFrom(SANS), 260),
      style: {
        ...heavier(startFrom(SANS), 260).style,
        metrics: { ...SANS.metrics, width: 0.6 },
      },
    };
    const closing = troubles(narrow).find((one) => one.what === "Counters closing up");
    expect(closing, "a heavy condensed cut closes its figures").toBeDefined();
    expect(closing!.letters).toContain("eight");
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
