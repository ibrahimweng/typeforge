/**
 * The box round the selection: where its handles are and what pulling one does.
 *
 * Tested away from the canvas because all of it is arithmetic, and because the
 * failures here are the quiet kind. A scale that anchors on the wrong corner
 * still scales, so it looks like it worked until you notice the selection
 * crawling across the letter; a rotation measured from the wrong centre still
 * rotates. Neither shows up as an error.
 */

import { describe, expect, it } from "vitest";

import {
  HANDLE_REACH,
  boxRound,
  cornersOf,
  edgesOf,
  gripAt,
  quadForPerspective,
  quadPulled,
  scalingFor,
  turnFor,
  worthABox,
} from "./transform-box";
import type { Box } from "@/font/warp";
import type { GlyphView } from "@/components/glyph-render";

const BOX: Box = { left: 0, right: 100, bottom: 0, top: 200 };
/** One canvas pixel per font unit, with the origin at the top left. */
const VIEW: GlyphView = { scale: 1, originX: 0, originY: 200 };

/** Where a font point lands on the canvas under VIEW. */
const on = (x: number, y: number) => ({ x, y: 200 - y });

describe("the box round a selection", () => {
  it("is the extremes of what was picked", () => {
    expect(
      boxRound([
        { x: 10, y: 5 },
        { x: -3, y: 90 },
        { x: 40, y: 12 },
      ]),
    ).toEqual({
      left: -3,
      right: 40,
      bottom: 5,
      top: 90,
    });
  });

  it("is nothing at all when nothing was picked", () => {
    expect(boxRound([])).toBeNull();
  });

  it("is not worth handles when it is smaller than they are", () => {
    /*
     * A selection of one point, or of several sitting on top of each other,
     * has a box whose handles would all be in the same place. Drawing eight of
     * them there gives somebody eight things to grab that do the same thing.
     */
    const tiny: Box = { left: 10, right: 12, bottom: 10, top: 12 };
    expect(worthABox(tiny, VIEW)).toBe(false);
    expect(worthABox(BOX, VIEW)).toBe(true);
    // And the same box is worth handles once it is zoomed into.
    expect(worthABox(tiny, { ...VIEW, scale: 20 })).toBe(true);
  });
});

describe("what is under the pointer", () => {
  it("finds each corner and each edge where it is drawn", () => {
    const corners = cornersOf(BOX);
    expect(gripAt(BOX, VIEW, on(corners.topLeft.x, corners.topLeft.y))).toEqual({
      kind: "corner",
      at: "topLeft",
    });
    const edges = edgesOf(BOX);
    expect(gripAt(BOX, VIEW, on(edges.right.x, edges.right.y))).toEqual({
      kind: "edge",
      at: "right",
    });
  });

  it("gives a corner to a press that could be either", () => {
    /*
     * At a small selection the corner and the edge handle overlap. The corner
     * wins, because an edge handle can always be reached by making the
     * selection bigger and a corner that answered second would be unreachable
     * at exactly the sizes where it is most wanted.
     */
    const narrow: Box = { left: 0, right: HANDLE_REACH, bottom: 0, top: 100 };
    const at = gripAt(narrow, VIEW, on(0, 0));
    expect(at?.kind).toBe("corner");
  });

  it("turns just outside a corner, and not on it", () => {
    expect(gripAt(BOX, VIEW, on(-14, -14))).toEqual({ kind: "turn", at: "bottomLeft" });
    // On the corner itself it is still a scale, because the rotation zone is
    // tested last and must never take a press meant for the handle it rings.
    expect(gripAt(BOX, VIEW, on(0, 0))).toEqual({ kind: "corner", at: "bottomLeft" });
  });

  it("says nothing at all well away from the box", () => {
    expect(gripAt(BOX, VIEW, on(400, 400))).toBeNull();
  });

  it("counts the inside as a grip, for moving what is selected", () => {
    expect(gripAt(BOX, VIEW, on(50, 100))).toEqual({ kind: "inside" });
  });
});

describe("pulling a handle", () => {
  it("scales about the corner opposite the one held", () => {
    /*
     * The quiet failure this is for. Anchored anywhere else the selection
     * scales *and* slides, which looks like a scale that is slightly wrong
     * rather than like an anchor in the wrong place.
     */
    const scaling = scalingFor(
      BOX,
      "topRight",
      { x: 200, y: 400 },
      {
        fromCentre: false,
        square: false,
      },
    );
    expect(scaling.about).toEqual({ x: 0, y: 0 });
    expect(scaling.x).toBeCloseTo(2);
    expect(scaling.y).toBeCloseTo(2);
  });

  it("scales about the middle when alt is held", () => {
    const scaling = scalingFor(
      BOX,
      "topRight",
      { x: 100, y: 200 },
      {
        fromCentre: true,
        square: false,
      },
    );
    expect(scaling.about).toEqual({ x: 50, y: 100 });
  });

  it("moves one axis only from an edge handle", () => {
    const scaling = scalingFor(
      BOX,
      "right",
      { x: 200, y: 999 },
      {
        fromCentre: false,
        square: false,
      },
    );
    expect(scaling.x).toBeCloseTo(2);
    expect(scaling.y, "an edge handle must not touch the other axis").toBe(1);
  });

  it("keeps the proportions under shift", () => {
    const scaling = scalingFor(
      BOX,
      "topRight",
      { x: 300, y: 220 },
      {
        fromCentre: false,
        square: true,
      },
    );
    expect(Math.abs(scaling.x)).toBeCloseTo(Math.abs(scaling.y));
  });

  it("never scales to nothing, however far the handle is dragged", () => {
    // A selection scaled to a single point has no box left to grab, so the
    // drag that did it cannot be undone by dragging back.
    const flat = scalingFor(BOX, "topRight", { x: 0, y: 0 }, { fromCentre: false, square: false });
    expect(Math.abs(flat.x)).toBeGreaterThan(0);
    expect(Math.abs(flat.y)).toBeGreaterThan(0);
  });

  it("measures a turn from the middle of the box", () => {
    // A quarter turn: from the right of the middle to above it.
    expect(turnFor(BOX, { x: 100, y: 100 }, { x: 50, y: 200 }, { square: false })).toBeCloseTo(90);
  });

  it("steps a turn to fifteen degrees under shift", () => {
    const stepped = turnFor(BOX, { x: 100, y: 100 }, { x: 100, y: 110 }, { square: true });
    expect(stepped % 15).toBe(0);
  });

  it("moves one corner and leaves three for a distort", () => {
    const quad = quadPulled(BOX, "topRight", { x: 500, y: 500 });
    expect(quad.topRight).toEqual({ x: 500, y: 500 });
    expect(quad.bottomLeft).toEqual({ x: 0, y: 0 });
    expect(quad.bottomRight).toEqual({ x: 100, y: 0 });
    expect(quad.topLeft).toEqual({ x: 0, y: 200 });
  });

  it("moves the corner beside it the other way for a perspective", () => {
    /*
     * What keeps the shape a trapezoid, and the whole difference between this
     * and a free distort: the top edge grows and the bottom does not, so the
     * shape lies back rather than shearing.
     */
    const quad = quadForPerspective(BOX, "topRight", { x: 140, y: 200 });
    expect(quad.topRight).toEqual({ x: 140, y: 200 });
    expect(quad.topLeft.x, "the far end of the same edge should go out too").toBe(-40);
    // The bottom edge is untouched, which is what makes it a trapezoid.
    expect(quad.bottomLeft).toEqual({ x: 0, y: 0 });
    expect(quad.bottomRight).toEqual({ x: 100, y: 0 });
  });
});
