/**
 * What each tool says it is about to do.
 *
 * Worth testing as prose rather than as pixels, because the failure this
 * guards against is not a state that fails to appear -- it is a state that
 * appears and is wrong. A cursor promising "this will cut" over a line that
 * will not is worse than a cursor promising nothing, and the only way that
 * happens is the palette, the pointer and the status line reading the same
 * gesture three different ways. So there is one function and these hold it to
 * what it claims.
 */

import { describe, expect, it } from "vitest";

import { NOTHING_UNDER, cursorFor, toolStateFor, type Doing, type Held, type Under } from "./tools";
import { TOOLS } from "./toolset";

const NOTHING: Under = NOTHING_UNDER;
const NONE: Held = { shift: false, alt: false };

describe("the select tool", () => {
  it("says nothing over empty canvas, which is where most time is spent", () => {
    const state = toolStateFor("select", NOTHING, null, NONE);
    expect(state.phase).toBe("idle");
    expect(state.says).toBe("");
  });

  it("offers the drag when something is under the pointer", () => {
    const state = toolStateFor("select", { ...NOTHING, grabbable: true }, null, NONE);
    expect(state.phase).toBe("ready");
    expect(state.says).toContain("Drag to move it");
  });

  it("says what a marquee will take while one is being pulled", () => {
    const state = toolStateFor("select", NOTHING, { kind: "marquee" }, NONE);
    expect(state.phase).toBe("active");
    expect(state.says).toContain("Everything inside");
  });
});

describe("the pen", () => {
  /*
   * Three clicks that mean three different things, and until this the button,
   * the pointer and the line said the same thing for all three.
   */
  it("starts, extends, and closes, and says which", () => {
    /*
     * `Click to start an outline` is gone on purpose.
     *
     * It was the sentence the pen said over an existing edge while a click
     * there put a point on that edge instead, and it said nothing about the
     * one gesture nobody guesses. What is left names both things a press can
     * be, because the pen has exactly two.
     */
    const fresh = toolStateFor("pen", NOTHING, null, NONE).says;
    expect(fresh).toContain("corner");
    expect(fresh).toContain("pull");

    const open = toolStateFor("pen", { ...NOTHING, pathOpen: true, openPoints: 3 }, null, NONE);
    expect(open.phase).toBe("ready");
    expect(open.says).toContain("close");
    // The way out, said while there is something to get out of. Its absence is
    // what left a dozen half-drawn stubs in a letter.
    expect(open.says).toContain("Escape");

    const closing = toolStateFor("pen", { ...NOTHING, closingPoint: true, pathOpen: true, openPoints: 3 }, null, NONE);
    expect(closing.phase).toBe("willDo");
    expect(closing.says).toBe("Click to close the outline.");
  });

  it("points differently when the click would close rather than add", () => {
    const adding = toolStateFor("pen", { ...NOTHING, pathOpen: true, openPoints: 3 }, null, NONE);
    const closing = toolStateFor("pen", { ...NOTHING, closingPoint: true, pathOpen: true, openPoints: 3 }, null, NONE);
    expect(cursorFor("pen", adding, false)).not.toBe(cursorFor("pen", closing, false));
  });
});

describe("the knife", () => {
  /*
   * The one worth saying out loud. A knife drawn short, or down beside a stem
   * rather than across it, does nothing at all -- and did it silently, so the
   * only way to find out was to let go and watch nothing happen.
   */
  it("says plainly when the line is not across anything yet", () => {
    const state = toolStateFor("knife", NOTHING, { kind: "knife", wouldCut: false }, NONE);
    expect(state.phase).toBe("active");
    expect(state.says).toContain("has to cross a shape");
  });

  it("changes its mind the moment the line crosses something", () => {
    const state = toolStateFor("knife", NOTHING, { kind: "knife", wouldCut: true }, NONE);
    expect(state.phase).toBe("willDo");
    expect(state.says).toBe("Let go to cut here.");
  });

  it("refuses the cutting pointer while the line would do nothing", () => {
    const no = toolStateFor("knife", NOTHING, { kind: "knife", wouldCut: false }, NONE);
    const yes = toolStateFor("knife", NOTHING, { kind: "knife", wouldCut: true }, NONE);
    expect(cursorFor("knife", no, true)).not.toBe(cursorFor("knife", yes, false));
  });
});

describe("the shape tools", () => {
  const dragging: Doing = { kind: "shape" };

  it("names the modifier that is actually held", () => {
    expect(toolStateFor("rectangle", NOTHING, dragging, NONE).says).toContain("Shift holds it square");
    expect(toolStateFor("rectangle", NOTHING, dragging, { shift: true, alt: false }).says).toBe(
      "Held to a square. Let go to keep it.",
    );
    expect(toolStateFor("ellipse", NOTHING, dragging, { shift: true, alt: false }).says).toBe(
      "Held to a circle. Let go to keep it.",
    );
    expect(toolStateFor("ellipse", NOTHING, dragging, { shift: false, alt: true }).says).toContain(
      "from the middle",
    );
    expect(toolStateFor("rectangle", NOTHING, dragging, { shift: true, alt: true }).says).toBe(
      "A square, from the middle. Let go to keep it.",
    );
  });

  it("counts a held modifier as doing its particular thing", () => {
    expect(toolStateFor("rectangle", NOTHING, dragging, NONE).phase).toBe("active");
    expect(toolStateFor("rectangle", NOTHING, dragging, { shift: true, alt: false }).phase).toBe("willDo");
  });
});

describe("freehand", () => {
  it("says when letting go would close the loop", () => {
    const drawing = toolStateFor("freehand", NOTHING, { kind: "freehand", wouldClose: false }, NONE);
    expect(drawing.phase).toBe("active");
    expect(drawing.says).toContain("Come back to where you began");

    const closing = toolStateFor("freehand", NOTHING, { kind: "freehand", wouldClose: true }, NONE);
    expect(closing.phase).toBe("willDo");
    expect(closing.says).toContain("closes into a loop");
  });
});

describe("the pointer", () => {
  it("is different for every tool, where it used to be one crosshair for five", () => {
    const armed = (tool: Parameters<typeof cursorFor>[0]) =>
      cursorFor(tool, toolStateFor(tool, NOTHING, null, NONE), false);
    const all = TOOLS.map((one) => one.id);
    const cursors = all.map(armed);
    // Not all identical, which is what it was: `crosshair` for everything but
    // select, so the pointer said "a tool is armed" and never which one.
    expect(new Set(cursors).size).toBeGreaterThan(2);
  });

  it("says a gesture is under way while one is", () => {
    const state = toolStateFor("select", NOTHING, { kind: "node" }, NONE);
    expect(cursorFor("select", state, true)).toBe("cursor-grabbing");
  });
});

describe("what wins", () => {
  /*
   * A gesture under way is what the person is attending to. What might have
   * been grabbed instead stopped mattering the moment they pressed.
   */
  it("prefers the gesture in progress to whatever is under the pointer", () => {
    const state = toolStateFor(
      "select",
      { ...NOTHING, grabbable: true, closingPoint: true, pathOpen: true },
      { kind: "pan" },
      NONE,
    );
    expect(state.says).toBe("Moving the page.");
  });
});

/*
 * The four that work on what is already there, and the one rule they share:
 * over empty canvas they must not look armed.
 *
 * Each of these used to be a modifier on the pen or nothing at all, and the
 * complaint that produced them -- twelve junk paths in one sitting -- came
 * from a pen whose single click had to mean three things at once. As separate
 * tools each click means one thing, which only helps if the tool says clearly
 * when it can do nothing.
 */
describe("the tools that need something under them", () => {
  const NEEDS_A_TARGET = ["addPoint", "deletePoint", "convertPoint", "scissors"] as const;

  it("never promises anything over empty canvas", () => {
    for (const tool of NEEDS_A_TARGET) {
      const state = toolStateFor(tool, NOTHING, null, NONE);
      expect(state.phase, tool).not.toBe("willDo");
      expect(cursorFor(tool, state, false), tool).toBe("cursor-not-allowed");
    }
  });

  it("arms over the thing each one works on", () => {
    expect(toolStateFor("addPoint", { ...NOTHING, edge: true }, null, NONE).phase).toBe("willDo");
    expect(toolStateFor("deletePoint", { ...NOTHING, node: true }, null, NONE).phase).toBe("willDo");
    expect(toolStateFor("convertPoint", { ...NOTHING, node: true }, null, NONE).phase).toBe("willDo");
    expect(toolStateFor("scissors", { ...NOTHING, node: true }, null, NONE).phase).toBe("willDo");
  });

  it("does not arm add-point over a bare point, which has no edge to split", () => {
    // `idle` rather than `ready`: a tool that can do nothing where it is
    // pointing is not ready for anything, and the palette dot should be dark.
    expect(toolStateFor("addPoint", { ...NOTHING, node: true }, null, NONE).phase).toBe("idle");
  });

  it("says what is wrong and then what would fix it, in one voice", () => {
    /*
     * Four tools inventing four phrasings for one situation is how an
     * interface stops sounding like one person wrote it. This is the shape the
     * knife's sentence already had.
     */
    for (const tool of NEEDS_A_TARGET) {
      const says = toolStateFor(tool, NOTHING, null, NONE).says;
      expect(says, tool).toMatch(/^Nothing here to /);
      expect(says, tool).toContain("Point at");
    }
  });
});

describe("the knife knows whether there is anything to cut", () => {
  /*
   * It said `Drag a line right across a shape to cut it in two` over an empty
   * canvas and over a letter alike, which is a sentence that has stopped being
   * advice: identical everywhere, so it carries nothing about anywhere.
   */
  it("goes quiet where there is no shape", () => {
    const empty = toolStateFor("knife", NOTHING, null, NONE);
    expect(empty.phase).toBe("idle");
    expect(empty.says).toContain("Nothing to cut");
    expect(cursorFor("knife", empty, false)).toBe("cursor-not-allowed");
  });

  it("arms where there is one", () => {
    const over = toolStateFor("knife", { ...NOTHING, shape: true }, null, NONE);
    expect(over.phase).toBe("ready");
    expect(over.says).toContain("across a shape");
  });
});

describe("every tool answers", () => {
  /*
   * The guard that would have caught the pen going dead: a tool with no case
   * in the switch returned undefined, the caller read `.phase` of nothing and
   * threw inside the pointer handler, and the tool simply stopped working with
   * no error on the page. Thirteen tools is enough that the next one added
   * will be forgotten somewhere.
   */
  it("with a state and a cursor, for every tool in the set", () => {
    for (const tool of TOOLS) {
      const state = toolStateFor(tool.id, NOTHING, null, NONE);
      expect(state, tool.id).toBeDefined();
      expect(typeof state.phase, tool.id).toBe("string");
      expect(typeof state.says, tool.id).toBe("string");
      expect(cursorFor(tool.id, state, false), tool.id).toMatch(/^cursor-/);
    }
  });

  it("and every tool has a name and a hint worth reading", () => {
    for (const tool of TOOLS) {
      expect(tool.name.length, tool.id).toBeGreaterThan(2);
      // The flyout is the only place most of these are ever explained.
      expect(tool.hint.length, tool.id).toBeGreaterThan(20);
    }
  });
});
