/**
 * That a dragged shape is one a checker would pass.
 *
 * The claim these make is narrow and worth making: a rectangle and an ellipse
 * drawn here land on whole units, reach exactly the box they were dragged in,
 * carry a point at every extreme, and run the way the rest of the font runs.
 * Those are four of the things the outline checks report, and a shape tool
 * that produced shapes failing its own application's checks would be a strange
 * thing to have built.
 */

import { describe, expect, it } from "vitest";

import { boxOf, ellipse, rectangle, shapeFrom, worthDrawing } from "./shapes";
import { contourArea, contoursBounds } from "./geometry";

const close = (value: number, want: number, digits = 6) =>
  expect(value).toBeCloseTo(want, digits);

describe("the box a drag describes", () => {
  it("normalises a drag made in any direction", () => {
    expect(boxOf({ x: 100, y: 200 }, { x: 20, y: 40 })).toEqual({
      xMin: 20,
      yMin: 40,
      xMax: 100,
      yMax: 200,
    });
  });

  it("puts it on whole units, because a font is drawn on them", () => {
    expect(boxOf({ x: 0.4, y: 0.6 }, { x: 99.5, y: 50.2 })).toEqual({
      xMin: 0,
      yMin: 1,
      xMax: 100,
      yMax: 50,
    });
  });

  it("holds the corner still when the shift key squares it off", () => {
    /*
     * The shorter side wins and the longer is cut down to it, growing away
     * from where the drag began. Squaring about the middle instead would slide
     * the anchored corner out from under the point somebody put it at.
     */
    const box = boxOf({ x: 0, y: 0 }, { x: 300, y: 100 }, { square: true });
    expect(box).toEqual({ xMin: 0, yMin: 0, xMax: 100, yMax: 100 });
  });

  it("squares off just as well when the drag runs backwards", () => {
    const box = boxOf({ x: 300, y: 300 }, { x: 0, y: 200 }, { square: true });
    expect(box).toEqual({ xMin: 200, yMin: 200, xMax: 300, yMax: 300 });
  });

  it("takes the start for the middle when asked", () => {
    // Alt, in every drawing tool there has ever been.
    expect(boxOf({ x: 100, y: 100 }, { x: 150, y: 120 }, { fromCentre: true })).toEqual({
      xMin: 50,
      yMin: 80,
      xMax: 150,
      yMax: 120,
    });
  });

  it("knows a click from a drag", () => {
    expect(worthDrawing(boxOf({ x: 10, y: 10 }, { x: 10.4, y: 10.4 }))).toBe(false);
    expect(shapeFrom("rectangle", boxOf({ x: 10, y: 10 }, { x: 11, y: 11 }), false)).toBeNull();
    expect(shapeFrom("rectangle", boxOf({ x: 10, y: 10 }, { x: 40, y: 40 }), false)).not.toBeNull();
  });
});

describe("a rectangle", () => {
  const box = { xMin: 0, yMin: 0, xMax: 100, yMax: 200 };

  it("is four corners on the box it was dragged in", () => {
    const shape = rectangle(box, false);
    expect(shape.closed).toBe(true);
    expect(shape.nodes.map((one) => one.point)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ]);
    expect(shape.nodes.every((one) => one.handleIn === null && one.handleOut === null)).toBe(true);
  });

  it("runs the way it is asked to run", () => {
    // Which way a contour runs decides whether it fills or cuts a hole, so a
    // shape dropped into a font wound the other way is a shape that punches a
    // hole in the letter it was added to.
    expect(Math.sign(contourArea(rectangle(box, false)))).not.toBe(
      Math.sign(contourArea(rectangle(box, true))),
    );
  });
});

describe("an ellipse", () => {
  const box = { xMin: 0, yMin: 0, xMax: 200, yMax: 100 };

  it("puts its four points where the outline reaches furthest", () => {
    /*
     * Not at the corners of the box. This is the whole reason to have an
     * ellipse tool rather than a rounded rectangle: those four places are the
     * extremes, and a curve with a point at each needs nothing added at export
     * and reports nothing in the checks.
     */
    expect(ellipse(box, false).nodes.map((one) => one.point)).toEqual([
      { x: 200, y: 50 },
      { x: 100, y: 100 },
      { x: 0, y: 50 },
      { x: 100, y: 0 },
    ]);
  });

  it("fills the box it was dragged in, to within half a unit", () => {
    // Four cubics cannot be a circle exactly. This is how close they get, and
    // it is closer than the format can express.
    const bounds = contoursBounds([ellipse(box, false)]);
    close(bounds.xMin, 0, 1);
    close(bounds.yMin, 0, 1);
    close(bounds.xMax, 200, 1);
    close(bounds.yMax, 100, 1);
  });

  it("calls its points smooth, because they are", () => {
    // The curve runs through each without turning, and saying so is what keeps
    // the handles opposite each other when somebody drags one.
    expect(ellipse(box, false).nodes.every((one) => one.type === "smooth")).toBe(true);
  });

  it("keeps its handles when it is wound the other way", () => {
    /*
     * The one that would ship quietly: reversing a list without swapping each
     * node's handles gives a shape with every curve inside out, which still
     * looks like an ellipse from a distance.
     */
    const forward = ellipse(box, false);
    const back = ellipse(box, true);
    expect(Math.sign(contourArea(forward))).not.toBe(Math.sign(contourArea(back)));
    const bounds = contoursBounds([back]);
    close(bounds.xMax, 200, 1);
    close(bounds.yMax, 100, 1);
  });

  it("lands on whole units even when the box has an odd side", () => {
    const odd = ellipse({ xMin: 0, yMin: 0, xMax: 101, yMax: 51 }, false);
    for (const node of odd.nodes) {
      expect(Number.isInteger(node.point.x) && Number.isInteger(node.point.y)).toBe(true);
      expect(Number.isInteger(node.handleIn!.x) && Number.isInteger(node.handleIn!.y)).toBe(true);
    }
  });
});
