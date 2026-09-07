/**
 * The two pieces of arithmetic the dock is made of.
 *
 * Neither is long and both were wrong the first time, in the same way: they
 * looked right in one direction and were off by one in the other, which is
 * exactly the kind of fault a hand test misses. Somebody dragging a panel
 * upwards would have found the dock perfect.
 */

import { describe, expect, it } from "vitest";

import { landingAmong } from "./landing";
import { LEAST_WIDTH, inOrder, widthWithin } from "@/state/layout";

/** Four panels of forty pixels each, starting at the top of the column. */
const MIDDLES = [
  { id: "a", middle: 20 },
  { id: "b", middle: 60 },
  { id: "c", middle: 100 },
  { id: "d", middle: 140 },
];

/** What the drop actually does with the number, so the two are tested as one. */
function dropped(ids: string[], carried: string, at: number): string[] {
  const rest = ids.filter((one) => one !== carried);
  rest.splice(Math.min(rest.length, Math.max(0, at)), 0, carried);
  return rest;
}

describe("where a dragged panel lands", () => {
  it("counts the others above the pointer, not the panels above it", () => {
    // `a` carried down past `b` and `c`: two of the others are above 110.
    expect(landingAmong(MIDDLES, "a", 110)).toBe(2);
    expect(dropped(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("puts a panel dragged down past one neighbour after that neighbour", () => {
    /*
     * The off-by-one. Asked "which panel would it sit before", the pointer
     * just past `b` gives the index of `c`, and splicing there after removing
     * `a` lands it after `c` -- one further than the hand asked for.
     */
    expect(landingAmong(MIDDLES, "a", 70)).toBe(1);
    expect(dropped(["a", "b", "c", "d"], "a", 1)).toEqual(["b", "a", "c", "d"]);
  });

  it("is right upwards too, which is the direction that always looked right", () => {
    expect(landingAmong(MIDDLES, "d", 50)).toBe(1);
    expect(dropped(["a", "b", "c", "d"], "d", 1)).toEqual(["a", "d", "b", "c"]);

    expect(landingAmong(MIDDLES, "d", 10)).toBe(0);
    expect(dropped(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("leaves a panel dropped where it started where it started", () => {
    // Carried and let go without crossing anybody: the two above it are still
    // above it, so it goes back to third.
    expect(landingAmong(MIDDLES, "c", 100)).toBe(2);
    expect(dropped(["a", "b", "c", "d"], "c", 2)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not count the panel being carried, wherever the pointer is", () => {
    // Its own header is under the pointer for most of a drag, and counting it
    // would make every panel land one place too far down.
    expect(landingAmong(MIDDLES, "b", 61)).toBe(1);
    expect(landingAmong(MIDDLES, "b", 300)).toBe(3);
  });

  it("ignores a panel whose header is not on screen", () => {
    // A furled panel still has a header; one scrolled out of the column does
    // not answer `querySelector`, so the list handed here is short.
    expect(landingAmong([{ id: "a", middle: 20 }], "b", 50)).toBe(1);
  });
});

describe("the order the panels are drawn in", () => {
  const declared = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("follows what was arranged", () => {
    expect(inOrder(declared, ["c", "a", "b"]).map((one) => one.id)).toEqual(["c", "a", "b"]);
  });

  it("leaves a panel nobody has moved where its author put it", () => {
    /*
     * The one that matters for the next person to add a panel. A record
     * written before it existed must not decide where it goes, and it must not
     * jump to the top either: it sorts after everything that has been placed,
     * in the order the code declares it.
     */
    expect(inOrder(declared, ["c"]).map((one) => one.id)).toEqual(["c", "a", "b"]);
    expect(inOrder(declared, []).map((one) => one.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mind an arrangement naming a panel that has gone", () => {
    // A record from a version that had a panel this one does not.
    expect(inOrder(declared, ["gone", "b"]).map((one) => one.id)).toEqual(["b", "a", "c"]);
  });
});

describe("how wide the dock may actually be drawn", () => {
  /*
   * The column this replaced was three widths chosen by the stylesheet from
   * the window: 224 pixels on a small one, 288 on a large. A remembered number
   * in pixels is not, and losing that was a real cost rather than a test to
   * update -- a dock set wide on a monitor and then opened on a laptop would
   * have left 460 pixels of canvas out of 900.
   */
  it("gives width back when the window is too small to honour it", () => {
    expect(widthWithin(288, 900)).toBe(270);
    expect(widthWithin(480, 900)).toBe(270);
  });

  it("leaves the width alone when there is room for it", () => {
    expect(widthWithin(288, 1500)).toBe(288);
    expect(widthWithin(480, 1920)).toBe(480);
  });

  it("is a ceiling and not a correction, so a wide window gives it back", () => {
    // The remembered number never changes here. What somebody set is what they
    // meant; a small window is a reason to show less of it, not to forget it.
    const asked = 480;
    expect(widthWithin(asked, 900)).toBeLessThan(asked);
    expect(widthWithin(asked, 1920)).toBe(asked);
  });

  it("never squeezes below the floor, however narrow the window", () => {
    // A dock narrower than this is a column of clipped labels rather than
    // controls, which helps nobody on a small screen either.
    expect(widthWithin(288, 400)).toBe(LEAST_WIDTH);
    expect(widthWithin(288, 100)).toBe(LEAST_WIDTH);
  });
});
