import { describe, expect, it } from "vitest";

import { nearestTurn, TAU, wrapAngle, wrapDegrees } from "./angles";

describe("bringing an angle within half a turn", () => {
  it("wraps any number of turns back into range", () => {
    expect(wrapAngle(0.5 + TAU * 3)).toBeCloseTo(0.5, 9);
    expect(wrapAngle(-0.5 - TAU * 2)).toBeCloseTo(-0.5, 9);
    expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 9);
  });

  /*
   * The one place the two ranges differ, and the reason both exist: the
   * script's joins read the sign, so half a turn backwards has to come out as
   * half a turn forwards there. Everywhere else it is left where it was.
   */
  it("leaves both ends of the range alone unless asked for half open", () => {
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
    expect(wrapAngle(-Math.PI)).toBe(-Math.PI);
    expect(wrapAngle(Math.PI, true)).toBe(Math.PI);
    expect(wrapAngle(-Math.PI, true)).toBe(Math.PI);
  });

  it("moves the finish of an arc, not the start, to go the short way", () => {
    expect(nearestTurn(3, -3)).toBeCloseTo(-3 + TAU, 12);
    expect(nearestTurn(-3, 3)).toBeCloseTo(3 - TAU, 12);
    expect(nearestTurn(1, 2)).toBe(2);
  });

  it("takes a pen's turn the short way, unless it is a whole turn or more", () => {
    expect(wrapDegrees(340)).toBe(-20);
    expect(wrapDegrees(-340)).toBe(20);
    expect(wrapDegrees(180)).toBe(180);
    expect(wrapDegrees(360)).toBe(360);
    expect(wrapDegrees(-720)).toBe(-720);
  });
});
