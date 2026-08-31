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

import { cursorFor, toolStateFor, type Doing, type Held, type Under } from "./tools";

const NOTHING: Under = { grabbable: false, closingPoint: false, pathOpen: false };
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
    expect(toolStateFor("pen", NOTHING, null, NONE).says).toContain("start an outline");

    const open = toolStateFor("pen", { ...NOTHING, pathOpen: true }, null, NONE);
    expect(open.phase).toBe("ready");
    expect(open.says).toContain("close");

    const closing = toolStateFor("pen", { grabbable: false, closingPoint: true, pathOpen: true }, null, NONE);
    expect(closing.phase).toBe("willDo");
    expect(closing.says).toBe("Click to close the outline.");
  });

  it("points differently when the click would close rather than add", () => {
    const adding = toolStateFor("pen", { ...NOTHING, pathOpen: true }, null, NONE);
    const closing = toolStateFor("pen", { grabbable: false, closingPoint: true, pathOpen: true }, null, NONE);
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

describe("the pencil", () => {
  it("says when letting go would close the loop", () => {
    const drawing = toolStateFor("pencil", NOTHING, { kind: "pencil", wouldClose: false }, NONE);
    expect(drawing.phase).toBe("active");
    expect(drawing.says).toContain("Come back to where you began");

    const closing = toolStateFor("pencil", NOTHING, { kind: "pencil", wouldClose: true }, NONE);
    expect(closing.phase).toBe("willDo");
    expect(closing.says).toContain("closes into a loop");
  });
});

describe("the pointer", () => {
  it("is different for every tool, where it used to be one crosshair for five", () => {
    const armed = (tool: Parameters<typeof cursorFor>[0]) =>
      cursorFor(tool, toolStateFor(tool, NOTHING, null, NONE), false);
    const all = ["select", "pen", "pencil", "rectangle", "ellipse", "knife"] as const;
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
      { grabbable: true, closingPoint: true, pathOpen: true },
      { kind: "pan" },
      NONE,
    );
    expect(state.says).toBe("Moving the page.");
  });
});
