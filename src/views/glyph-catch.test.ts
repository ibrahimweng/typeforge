/**
 * The rule that says what a selection shape has hold of.
 *
 * Worth testing on its own because it is now asked twice: once by the canvas,
 * sixty times a second while the shape is being dragged, and once by the
 * pointer coming up. Those two used to be different code, and the day they
 * disagreed the preview would have been a guide that lied -- points lit up
 * that the release did not take, or the other way round.
 *
 * So what is checked here is the rule itself, and that both callers get the
 * same answer from it is a matter of there only being one.
 */

import { describe, expect, it } from "vitest";

import type { Contour } from "@/font/types";
import type { GlyphView } from "@/components/glyph-render";
import { caughtBy, catches, keepCatching } from "./glyph-catch";

/** A view with no zoom and no offset, so font units are canvas pixels. */
const VIEW: GlyphView = { originX: 0, originY: 0, scale: 1 } as GlyphView;

/** Points at the places named, as one contour. */
function at(...points: Array<[number, number]>): Contour[] {
  return [
    {
      closed: true,
      nodes: points.map(([x, y]) => ({
        point: { x, y: -y },
        type: "corner" as const,
        handleIn: null,
        handleOut: null,
      })),
    },
  ];
}

const box = (from: [number, number], to: [number, number]) => ({
  kind: "marquee" as const,
  from: { x: from[0], y: from[1] },
  to: { x: to[0], y: to[1] },
  additive: false,
});

const ring = (...points: Array<[number, number]>) => ({
  kind: "lasso" as const,
  trail: points.map(([x, y]) => ({ x, y })),
  additive: false,
});

describe("what a box has hold of", () => {
  const three = at([10, 10], [50, 50], [90, 90]);

  it("takes the points inside it and leaves the rest", () => {
    expect([...caughtBy(box([0, 0], [60, 60]), three, VIEW)]).toEqual(["0:0", "0:1"]);
  });

  it("is the same box dragged from any corner", () => {
    /*
     * A box dragged up and to the left is the same box as one dragged down and
     * to the right, and a hand does both. Written without the min and max, a
     * backwards drag catches nothing and looks like a broken tool.
     */
    const forwards = caughtBy(box([0, 0], [60, 60]), three, VIEW);
    expect([...caughtBy(box([60, 60], [0, 0]), three, VIEW)]).toEqual([...forwards]);
  });

  it("takes a point exactly on its edge", () => {
    // The edge is somewhere a hand deliberately puts the line, so a point on
    // it is a point somebody meant. Excluded, the answer changes on a pixel.
    expect([...caughtBy(box([10, 10], [10, 10]), three, VIEW)]).toEqual(["0:0"]);
  });

  it("has nothing when it has no size", () => {
    expect(caughtBy(box([5, 5], [5, 5]), three, VIEW).size).toBe(0);
  });
});

describe("what a ring has hold of", () => {
  // A square ring, drawn the long way round, with one point in and one out.
  const drawn = ring([0, 0], [60, 0], [60, 60], [0, 60]);

  it("takes what falls inside the ring", () => {
    const points = at([30, 30], [90, 30]);
    expect([...caughtBy(drawn, points, VIEW)]).toEqual(["0:0"]);
  });

  it("takes the inside of a ring that folds back on itself", () => {
    /*
     * A lasso is whatever the hand drew and need not be tidy. A C-shape has a
     * mouth that is outside it despite being surrounded on three sides, which
     * is the case a bounding-box answer gets wrong.
     */
    const c = ring([0, 0], [60, 0], [60, 20], [20, 20], [20, 40], [60, 40], [60, 60], [0, 60]);
    const points = at([10, 30], [40, 30]);
    expect([...caughtBy(c, points, VIEW)], "the mouth is outside").toEqual(["0:0"]);
  });
});

describe("keeping hold between moves", () => {
  const three = at([10, 10], [50, 50], [90, 90]);

  it("stamps a point when it is first taken, and not again", () => {
    const first = keepCatching(null, box([0, 0], [20, 20]), three, VIEW, 100);
    expect(first.since.get("0:0")).toBe(100);

    const wider = keepCatching(first, box([0, 0], [60, 60]), three, VIEW, 200);
    expect(wider.since.get("0:0"), "already held, so not taken again").toBe(100);
    expect(wider.since.get("0:1"), "newly taken").toBe(200);
  });

  it("stamps a point again when it is let go of and swept back over", () => {
    // The flash is a picture of the hand taking a point, and a hand that
    // shrinks the box past a point and grows it back has taken it twice.
    const wide = keepCatching(null, box([0, 0], [60, 60]), three, VIEW, 100);
    const narrow = keepCatching(wide, box([0, 0], [20, 20]), three, VIEW, 200);
    expect(narrow.keys.has("0:1")).toBe(false);
    const again = keepCatching(narrow, box([0, 0], [60, 60]), three, VIEW, 300);
    expect(again.since.get("0:1")).toBe(300);
  });

  it("keeps a stamp for what it holds and nothing else", () => {
    // A sweep across a letter of two hundred points should carry the handful
    // under the shape, not a stamp per point in the font.
    const held = keepCatching(null, box([0, 0], [20, 20]), three, VIEW, 100);
    expect(held.since.size).toBe(held.keys.size);
  });
});

describe("which drags pick points by drawing round them", () => {
  it("is the box and the ring, and nothing else", () => {
    expect(catches(box([0, 0], [1, 1]))).toBe(true);
    expect(catches(ring([0, 0], [1, 1]))).toBe(true);
    expect(catches(null)).toBe(false);
    expect(catches({ kind: "pan", from: { x: 0, y: 0 }, startPan: { x: 0, y: 0 } })).toBe(false);
  });
});
