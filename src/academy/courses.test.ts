/**
 * What a course must not do.
 *
 * The interesting failures here are not "a lesson is missing" -- that shows up
 * the moment anybody opens the drawer. They are the two ways a course can be
 * quietly dishonest: a lesson that reports itself done when the work was not
 * done, and a lesson whose check can never go true, which strands somebody on
 * step two of four for ever with no way to tell whether the fault is theirs.
 *
 * So every checked lesson is asked twice: once of a document where the thing
 * has not happened, and once of one where it has.
 */

import { describe, expect, it } from "vitest";

import { ALL_LESSONS, COURSES, type Progressed } from "./courses";
import { emptyTypeface, type Contour, type Glyph } from "@/font/types";
import type { AppState } from "@/state/store";

const glyph = (name: string, contours: Contour[]): Glyph => ({
  name,
  unicodes: [],
  advanceWidth: 500,
  contours,
  components: [],
  anchors: [],
  params: {},
  dirty: false,
});

/** A document with nothing in it, which is where everybody starts. */
function nothing(): Progressed {
  return {
    app: { typeface: null, selectedGlyph: null, view: "grid" } as unknown as AppState,
    forge: null,
    mode: "edit",
  };
}

/** A document with one letter in it, drawn however the caller says. */
function withGlyph(contours: Contour[]): Progressed {
  const typeface = emptyTypeface();
  typeface.glyphs = [glyph("o", contours)];
  typeface.glyphIndex = new Map([["o", 0]]);
  return {
    app: { typeface, selectedGlyph: "o", view: "glyph", kerning: [] } as unknown as AppState,
    forge: null,
    mode: "edit",
  };
}

/** A circle on its extremes: closed, curved, and nothing missing. */
function circle(): Contour {
  const k = 100 * 0.5523;
  const node = (x: number, y: number, i: [number, number], o: [number, number]) => ({
    point: { x, y },
    handleIn: { x: i[0], y: i[1] },
    handleOut: { x: o[0], y: o[1] },
    type: "smooth" as const,
  });
  return {
    closed: true,
    nodes: [
      node(100, 0, [100, -k], [100, k]),
      node(0, 100, [k, 100], [-k, 100]),
      node(-100, 0, [-100, k], [-100, -k]),
      node(0, -100, [-k, -100], [k, -100]),
    ],
  };
}

/** A triangle: closed, and every point a corner. */
const triangle = (): Contour => ({
  closed: true,
  nodes: [
    { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 100, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
    { point: { x: 50, y: 90 }, handleIn: null, handleOut: null, type: "corner" },
  ],
});

describe("the courses themselves", () => {
  it("has four courses, each with lessons and an honest running time", () => {
    expect(COURSES.length).toBeGreaterThanOrEqual(4);
    for (const course of COURSES) {
      expect(course.lessons.length, course.id).toBeGreaterThan(1);
      expect(course.minutes, course.id).toBeGreaterThan(0);
      expect(course.about.length, course.id).toBeGreaterThan(30);
    }
  });

  it("gives every lesson a unique id, because progress is stored against it", () => {
    const ids = ALL_LESSONS.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("teaches something before it asks for something", () => {
    for (const lesson of ALL_LESSONS) {
      // A lesson whose text is shorter than its task is an instruction wearing
      // a lesson's clothes, and this tool has a help drawer for instructions.
      expect(lesson.teaches.length, lesson.id).toBeGreaterThan(200);
      expect(lesson.task.length, lesson.id).toBeGreaterThan(10);
    }
  });
});

describe("no lesson claims something that has not happened", () => {
  it("is undone on an empty document, every one of them", () => {
    const empty = nothing();
    for (const lesson of ALL_LESSONS) {
      if (!lesson.done) continue;
      expect(lesson.done(empty), lesson.id).toBe(false);
    }
  });
});

describe("and every check can actually go true", () => {
  /*
   * The other half, and the one that strands people. A check that is never
   * satisfiable leaves somebody on step two of four with no way to tell
   * whether the fault is theirs or the course's -- and unlike a wrong lesson,
   * nothing about it looks broken.
   */
  it("ticks the mode lesson when the mode is right", () => {
    const lesson = ALL_LESSONS.find((one) => one.id === "first.base")!;
    expect(lesson.done!({ ...nothing(), mode: "forge" })).toBe(true);
  });

  it("ticks the curve lesson only for a shape with handles", () => {
    const lesson = ALL_LESSONS.find((one) => one.id === "pen.pull")!;
    expect(lesson.done!(withGlyph([triangle()])), "a polygon is not a curve").toBe(false);
    expect(lesson.done!(withGlyph([circle()]))).toBe(true);
  });

  it("ticks the closing lesson for any closed shape, curved or not", () => {
    const lesson = ALL_LESSONS.find((one) => one.id === "pen.close")!;
    const open: Contour = { ...triangle(), closed: false };
    expect(lesson.done!(withGlyph([open])), "an open contour has no inside").toBe(false);
    expect(lesson.done!(withGlyph([triangle()]))).toBe(true);
  });

  it("ticks the extremes lesson only when nothing is missing", () => {
    const lesson = ALL_LESSONS.find((one) => one.id === "pen.extremes")!;
    // A circle drawn on its extremes has none missing; the same circle turned
    // forty-five degrees has four, which is the drawing the rule is for.
    expect(lesson.done!(withGlyph([circle()]))).toBe(true);
    const turn = (v: { x: number; y: number }) => ({
      x: (v.x - v.y) / Math.SQRT2,
      y: (v.x + v.y) / Math.SQRT2,
    });
    const turned: Contour = {
      closed: true,
      nodes: circle().nodes.map((one) => ({
        point: turn(one.point),
        handleIn: one.handleIn ? turn(one.handleIn) : null,
        handleOut: one.handleOut ? turn(one.handleOut) : null,
        type: one.type,
      })),
    };
    expect(lesson.done!(withGlyph([turned]))).toBe(false);
  });

  it("ticks the kerning lesson when a pair has been kerned", () => {
    const lesson = ALL_LESSONS.find((one) => one.id === "space.kern")!;
    const at = withGlyph([circle()]);
    expect(lesson.done!(at)).toBe(false);
    const kerned = {
      ...at,
      app: {
        ...at.app,
        typeface: { ...at.app.typeface!, kerning: [{ left: "A", right: "V", value: -40 }] },
      } as unknown as AppState,
    };
    expect(lesson.done!(kerned)).toBe(true);
  });
});
