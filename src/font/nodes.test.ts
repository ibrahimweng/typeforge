/**
 * That the node operations change what they say they change.
 *
 * Two things are worth a test here rather than an eye. The first is that every
 * one of these is destructive in a way a transform is not: `tidy` takes points
 * out, `reconnect` takes two points and gives back one, and a handle lost in
 * either is a curve that has quietly changed shape. The second is that the
 * tolerances are the whole design -- half a unit and a fiftieth of a degree
 * are the difference between cleaning up a path and redrawing it -- and a
 * number in a constant proves nothing about the comparison it is used in.
 */

import { describe, expect, it } from "vitest";

import {
  OPEN_BY,
  cornered,
  isOnGrid,
  openCorner,
  reconnect,
  reconnectionPoint,
  rounded,
  smoothed,
  tidy,
  tidyWouldRemove,
} from "./nodes";
import { distance } from "./geometry";
import type { Contour, GlyphNode } from "./types";

const node = (x: number, y: number, hi?: [number, number], ho?: [number, number]): GlyphNode => ({
  point: { x, y },
  handleIn: hi ? { x: hi[0], y: hi[1] } : null,
  handleOut: ho ? { x: ho[0], y: ho[1] } : null,
  type: "corner",
});

const closed = (nodes: GlyphNode[]): Contour => ({ closed: true, nodes });
const open = (nodes: GlyphNode[]): Contour => ({ closed: false, nodes });
const places = (contour: Contour): Array<[number, number]> =>
  contour.nodes.map((one) => [one.point.x, one.point.y]);

/**
 * The points of a contour, to within a rounding error.
 *
 * `openCorner` finds where to cut by halving an interval thirty times rather
 * than by arithmetic, because the distance along a curve is not proportional
 * to its parameter. That converges to about a billionth of a unit, which is a
 * thousand times finer than the format can express and still not equality.
 */
const nearPlaces = (contour: Contour, want: Array<[number, number]>) => {
  expect(contour.nodes).toHaveLength(want.length);
  contour.nodes.forEach((one, index) => {
    close(one.point.x, want[index][0], 6);
    close(one.point.y, want[index][1], 6);
  });
};

const close = (value: number, want: number, digits = 6) => expect(value).toBeCloseTo(want, digits);

describe("putting a point on the grid", () => {
  it("rounds the handles as well as the point", () => {
    // A handle left on a fraction is a control point the exported file rounds
    // anyway, which is how a rounded outline comes back subtly different.
    const snapped = rounded(node(10.4, 20.6, [5.5, 5.4], [15.5, 0.5]));
    expect(snapped.point).toEqual({ x: 10, y: 21 });
    expect(snapped.handleIn).toEqual({ x: 6, y: 5 });
    expect(snapped.handleOut).toEqual({ x: 16, y: 1 });
  });

  it("leaves a handle that was not there alone", () => {
    const snapped = rounded(node(0.2, 0.2));
    expect(snapped.handleIn).toBeNull();
    expect(snapped.handleOut).toBeNull();
  });

  it("can say a point is already there, so nothing has to be edited to find out", () => {
    // Every coordinate this application displays is displayed rounded, so a
    // point a tenth of a unit off looks identical to one on the grid. Asking
    // before editing is the only way to tell somebody the operation did
    // nothing, instead of marking the font modified and saying nothing.
    expect(isOnGrid(node(10, 20, [5, 5], [15, 0]))).toBe(true);
    expect(isOnGrid(node(10, 20))).toBe(true);
    expect(isOnGrid(node(10.5, 20))).toBe(false);
    // A handle off the grid counts, because it is a coordinate the exported
    // file has to round too.
    expect(isOnGrid(node(10, 20, undefined, [15.5, 0]))).toBe(false);
  });
});

describe("smoothing a point", () => {
  it("keeps the longer handle and swings the shorter one into line", () => {
    /*
     * The decision the whole operation turns on. Both handles cannot stay
     * where they are, so one has to move, and moving the longer one would take
     * the bigger of two decisions -- the one that shapes more of the curve --
     * and throw it away.
     */
    const smooth = smoothed(node(0, 0, [-100, 10], [10, 0]));
    expect(smooth.handleIn).toEqual({ x: -100, y: 10 });
    expect(smooth.type).toBe("smooth");
    // The stub is now opposite the long one, and still its own length.
    close(distance(smooth.point, smooth.handleOut!), 10);
    close(smooth.handleOut!.x, (100 / Math.hypot(100, 10)) * 10);
    close(smooth.handleOut!.y, (-10 / Math.hypot(100, 10)) * 10);
  });

  it("really is smooth afterwards, not merely labelled so", () => {
    const smooth = smoothed(node(30, 40, [10, 90], [33, 12]));
    const inward = {
      x: smooth.point.x - smooth.handleIn!.x,
      y: smooth.point.y - smooth.handleIn!.y,
    };
    const outward = {
      x: smooth.handleOut!.x - smooth.point.x,
      y: smooth.handleOut!.y - smooth.point.y,
    };
    // Collinear and pointing the same way: the curve passes through without a
    // kink, which is the only thing "smooth" can mean.
    close(inward.x * outward.y - inward.y * outward.x, 0, 5);
    expect(inward.x * outward.x + inward.y * outward.y).toBeGreaterThan(0);
  });

  it("moves nothing on a point with one handle, and calls it a tangent", () => {
    // There is nothing on the other side to line up with, so smoothing it
    // would mean inventing a handle rather than moving one.
    const one = node(10, 10, undefined, [40, 10]);
    const smooth = smoothed(one);
    expect(smooth.handleOut).toEqual({ x: 40, y: 10 });
    expect(smooth.handleIn).toBeNull();
    expect(smooth.type).toBe("tangent");
  });

  it("calls a point with no handles at all a corner", () => {
    expect(smoothed(node(1, 2)).type).toBe("corner");
  });
});

describe("letting a curve turn again", () => {
  it("changes the type and not one coordinate", () => {
    const before = { ...node(5, 6, [1, 2], [9, 10]), type: "smooth" as const };
    const after = cornered(before);
    expect(after.type).toBe("corner");
    expect(after.point).toEqual(before.point);
    expect(after.handleIn).toEqual(before.handleIn);
    expect(after.handleOut).toEqual(before.handleOut);
  });
});

describe("tidying a path", () => {
  it("drops the last point when it sits on the first", () => {
    // The commonest way a closed path picks up a duplicate: a pen that closed
    // it by clicking the start rather than by closing it.
    const square = closed([node(0, 0), node(100, 0), node(100, 100), node(0, 100), node(0, 0)]);
    expect(places(tidy(square))).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
  });

  it("merges a doubled point rather than dropping one, so no handle is lost", () => {
    /*
     * The one that would ship quietly. Two points in the same place are one
     * point written twice -- but the second may be carrying the handle that
     * shapes the curve leaving it, and a tidy that deleted the node would take
     * the curve with it.
     */
    const path = closed([
      node(0, 0),
      node(50, 0),
      node(50, 0, undefined, [60, 20]),
      node(100, 50, [90, 60]),
    ]);
    const tidied = tidy(path);
    expect(places(tidied)).toEqual([
      [0, 0],
      [50, 0],
      [100, 50],
    ]);
    expect(tidied.nodes[1].handleOut).toEqual({ x: 60, y: 20 });
    expect(tidied.nodes[1].type).toBe("tangent");
  });

  it("keeps two points a whole unit apart, because that is a decision", () => {
    const path = closed([node(0, 0), node(1, 0), node(100, 80), node(0, 80)]);
    expect(tidy(path).nodes).toHaveLength(4);
  });

  it("removes a point sitting in the middle of a straight run", () => {
    const path = closed([node(0, 0), node(50, 0), node(100, 0), node(100, 100), node(0, 100)]);
    expect(places(tidy(path))).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
  });

  it("will not remove a point that carries a handle, however redundant it looks", () => {
    // A handle is a statement about the curve either side of it. The point is
    // exactly as colinear as the one above and stays, because somebody put it
    // there and then did something with it.
    const path = closed([
      node(0, 0),
      node(50, 0, undefined, [70, 0]),
      node(100, 0, [80, 0]),
      node(100, 100),
      node(0, 100),
    ]);
    expect(tidy(path).nodes).toHaveLength(5);
  });

  it("keeps both ends of an open path, which are not in the middle of anything", () => {
    const line = open([node(0, 0), node(50, 0), node(100, 0)]);
    expect(places(tidy(line))).toEqual([
      [0, 0],
      [100, 0],
    ]);
  });

  it("stands a handle up that was a hundredth of a degree off vertical", () => {
    const path = closed([node(0, 0, undefined, [0.01, 100]), node(100, 0), node(100, 100)]);
    expect(tidy(path).nodes[0].handleOut).toEqual({ x: 0, y: 100 });
  });

  it("leaves a handle alone that is angled on purpose", () => {
    // Five degrees off vertical is a drawing decision. The tolerance is small
    // precisely so it cannot reach one.
    const lean: [number, number] = [100 * Math.tan((5 * Math.PI) / 180), 100];
    const path = closed([node(0, 0, undefined, lean), node(100, 0), node(100, 100)]);
    expect(tidy(path).nodes[0].handleOut).toEqual({ x: lean[0], y: lean[1] });
  });

  it("does not empty a path that is entirely straight", () => {
    // Three colinear points on a closed contour are all removable by the rule
    // above, and removing all of them would leave nothing to draw or to undo.
    const flat = closed([node(0, 0), node(50, 0), node(100, 0)]);
    expect(tidy(flat).nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("counts what it would remove without removing it", () => {
    const path = closed([node(0, 0), node(50, 0), node(100, 0), node(100, 100), node(0, 100)]);
    expect(tidyWouldRemove([path])).toBe(1);
    expect(path.nodes).toHaveLength(5);
  });
});

describe("opening a corner", () => {
  const square = closed([node(0, 0), node(100, 0), node(100, 100), node(0, 100)]);

  it("cuts both sides by the same distance, measured along the outline", () => {
    /*
     * The reason a stem join gets opened at all: a sharp inside angle in a
     * merged outline is where the ink pools and the rasteriser puts a black
     * pixel. Two points and a flat between them give the join a width somebody
     * can decide on.
     */
    const opened = openCorner(square, 1, 20);
    const [first, second] = [opened.nodes[1], opened.nodes[2]];
    close(distance(first.point, { x: 100, y: 0 }), 20, 6);
    close(distance(second.point, { x: 100, y: 0 }), 20, 6);
    nearPlaces(opened, [
      [0, 0],
      [80, 0],
      [100, 20],
      [100, 100],
      [0, 100],
    ]);
  });

  it("leaves a flat between the two, which is the thing to be dragged", () => {
    const opened = openCorner(square, 1, 20);
    expect(opened.nodes[1].handleOut).toBeNull();
    expect(opened.nodes[2].handleIn).toBeNull();
    expect(opened.nodes[1].type).toBe("corner");
  });

  it("keeps a straight side straight", () => {
    // A degenerate cubic split anywhere is still a straight run, but written
    // with handles it becomes a curve segment the rest of the editor has to
    // treat as one. The nulls are what keep it a line.
    const opened = openCorner(square, 1, 20);
    expect(opened.nodes[0].handleOut).toBeNull();
    expect(opened.nodes[3].handleIn).toBeNull();
  });

  it("never eats past the far end of either side", () => {
    // Asked to open by five times the side of the square, it reaches the
    // middle of each side and stops: opening a corner must not consume the
    // points next to it.
    const opened = openCorner(square, 1, 500);
    expect(places(opened)).toEqual([
      [0, 0],
      [50, 0],
      [100, 50],
      [100, 100],
      [0, 100],
    ]);
    // Exactly the middle, not thirty halvings away from it.
  });

  it("opens by a default that suits a thousand-unit em", () => {
    expect(OPEN_BY).toBe(20);
    expect(openCorner(square, 1).nodes[1].point.x).toBeCloseTo(80, 3);
  });

  it("refuses at the end of an open path, which has only one side", () => {
    const line = open([node(0, 0), node(50, 50), node(100, 0)]);
    expect(openCorner(line, 0, 20)).toBe(line);
    expect(openCorner(line, 2, 20)).toBe(line);
    expect(openCorner(line, 1, 20).nodes).toHaveLength(4);
  });

  it("refuses on a path too short to have a corner", () => {
    const stub = closed([node(0, 0), node(100, 0)]);
    expect(openCorner(stub, 1, 20)).toBe(stub);
  });
});

describe("reconnecting an opened corner", () => {
  const square = closed([node(0, 0), node(100, 0), node(100, 100), node(0, 100)]);

  it("puts the corner back exactly where it was", () => {
    // The round trip, which is the only claim worth making about a pair of
    // inverse operations.
    const back = reconnect(openCorner(square, 1, 20), 1);
    expect(back.nodes).toHaveLength(4);
    close(back.nodes[1].point.x, 100, 6);
    close(back.nodes[1].point.y, 0, 6);
  });

  it("works when the pair wraps the end of the list", () => {
    /*
     * A contour is a ring and the list is not, so the two points of an opened
     * corner can be the last and the first. The arithmetic is the same; the
     * splicing is not.
     */
    const rolled = closed([node(100, 20), node(100, 100), node(0, 100), node(0, 0), node(80, 0)]);
    const back = reconnect(rolled, 4);
    expect(back.nodes).toHaveLength(4);
    close(back.nodes[0].point.x, 100);
    close(back.nodes[0].point.y, 0);
  });

  it("says there is no corner when the two sides are parallel", () => {
    // Sides that never meet have no corner to put back, and a point somewhere
    // between them would be a guess.
    const parallel = closed([node(0, 0), node(50, 0), node(50, 10), node(100, 10)]);
    expect(reconnectionPoint(parallel, 1)).toBeNull();
    expect(reconnect(parallel, 1)).toBe(parallel);
  });

  it("reports where the corner would go before anything moves", () => {
    const meeting = reconnectionPoint(openCorner(square, 1, 20), 1);
    close(meeting!.x, 100);
    close(meeting!.y, 0);
  });

  it("refuses where one of the pair is the end of an open path", () => {
    const line = open([node(0, 0), node(40, 40), node(60, 40), node(100, 0)]);
    expect(reconnectionPoint(line, 0)).toBeNull();
    expect(reconnectionPoint(line, 2)).toBeNull();
    // The pair in the middle has a side on each outer flank and does reconnect.
    close(reconnectionPoint(line, 1)!.x, 50);
    close(reconnectionPoint(line, 1)!.y, 50);
  });

  it("carries a curved flank through the join instead of dropping its handle", () => {
    /*
     * The destructive case. Two points become one, and the curve arriving at
     * the first has to arrive at the survivor instead -- so the handle facing
     * the join has to be stretched, not discarded.
     */
    const curved = closed([
      node(0, 0, undefined, [0, 60]),
      node(80, 0, [40, 40]),
      node(100, 20),
      node(100, 100),
    ]);
    const back = reconnect(curved, 1);
    expect(back.nodes).toHaveLength(3);
    expect(back.nodes[0].handleOut).not.toBeNull();
    expect(back.nodes[1].handleIn).not.toBeNull();
  });
});
