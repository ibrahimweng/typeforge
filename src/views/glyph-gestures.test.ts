/**
 * What the pointer is doing to a letter.
 *
 * The file under test is one hook with five handlers in it, and what those
 * handlers do is almost entirely invisible from inside React: they reach into
 * the store, start and finish drags, and write the sentence under the canvas.
 * So that is what is checked here -- what the store holds afterwards -- rather
 * than anything about rendering.
 *
 * The hook is run with `renderToString`, which executes a function component
 * and its hooks in Node with no DOM at all. Two things do not survive that and
 * are worth knowing about rather than discovering:
 *
 * `useEffect` does not run, so the two effects -- finishing an open outline
 * when the tool changes, and speaking when a tool is picked up -- are not
 * exercised. The second matters less than it looks: it now reports through the
 * same `aboutTheLetter` that `refreshPhase` does, and that path is covered.
 *
 * And state set from a handler does not come back as a new render, so `hover`
 * and `at` stay as they were. Neither is read here. Everything asserted is the
 * store, or a ref, both of which are as live in a test as in a browser -- and
 * the drags this file is mostly about live in a ref on purpose.
 *
 * One consequence worth stating, because it decides how the tests are written:
 * every render here is a fresh component, so its refs are fresh too, where a
 * browser keeps the same ones across renders. A gesture therefore runs on one
 * mount from press to release -- which is what a browser does with the ref, and
 * is the whole reason the drag lives in one. What it cannot show is a gesture
 * spanning a re-render, which is where the three staleness bugs in this file
 * lived; those want a real renderer and are not claimed here.
 */

import { beforeEach, describe, expect, it } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

import type { GlyphView } from "@/components/glyph-render";
import { emptyTypeface, type Contour, type Glyph, type GlyphNode } from "@/font/types";
import { store } from "@/state/useStore";
import { useGlyphGestures, type Gestures } from "./glyph-gestures";

const VIEW: GlyphView = { scale: 0.5, originX: 100, originY: 400 };

/** Where a font-unit point lands on the canvas. */
const at = (x: number, y: number) => ({
  x: VIEW.originX + x * VIEW.scale,
  y: VIEW.originY - y * VIEW.scale,
});

const node = (x: number, y: number, over: Partial<GlyphNode> = {}): GlyphNode => ({
  point: { x, y },
  handleIn: null,
  handleOut: null,
  type: "corner",
  ...over,
});

/** A closed rectangle: something to cut, to pick and to point at. */
const stem = (): Contour => ({
  closed: true,
  nodes: [node(100, 0), node(200, 0), node(200, 700), node(100, 700)],
});

/** A letter in the store, without going through file parsing. */
function seed(contours: Contour[] = [], over: Partial<Glyph> = {}): void {
  const one: Glyph = {
    name: "a",
    unicodes: [],
    advanceWidth: 500,
    contours,
    components: [],
    anchors: [],
    params: {},
    dirty: false,
    ...over,
  };
  const typeface = emptyTypeface();
  typeface.glyphs = [one];
  typeface.glyphIndex = new Map([["a", 0]]);
  store.startBlank();
  Object.assign(store.getSnapshot().typeface!, typeface);
  store.setSelectedNodes([]);
}

/**
 * The hook, run once, with its handlers handed back.
 *
 * Props come from the store rather than being passed in, so a step reads the
 * letter as it stands rather than as it was when the gesture began -- which is
 * what the view does.
 */
function mount(over: Record<string, unknown> = {}): Gestures {
  let captured: Gestures | null = null;
  function Probe(): null {
    captured = useGlyphGestures({
      typeface: store.getSnapshot().typeface,
      glyph: store.glyph("a") ?? null,
      state: store.getSnapshot(),
      view: VIEW,
      pan: { x: 0, y: 0 },
      setPan: () => {},
      ...over,
    } as never);
    return null;
  }
  renderToString(React.createElement(Probe));
  if (!captured) throw new Error("the hook did not run");
  return captured;
}

/** A pointer event with only what these handlers actually read. */
const press = (where: { x: number; y: number }, over: Record<string, unknown> = {}) =>
  ({
    clientX: where.x,
    clientY: where.y,
    button: 0,
    pointerId: 1,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture: () => {},
    },
    ...over,
  }) as never;

/**
 * One whole gesture, press to release, on one mount.
 *
 * On one because the drag lives in a ref, and a ref is what survives a render
 * in a browser and does not survive a second `renderToString` here. Split
 * across mounts the release sees no drag at all and every gesture silently
 * does nothing -- which is how these tests first read, all passing at each end
 * and testing neither.
 */
function gesture(
  from: { x: number; y: number },
  through: { x: number; y: number }[] = [],
  held: Record<string, unknown> = {},
): void {
  const one = mount();
  one.on.pointerDown(press(from, held));
  for (const point of through) one.on.pointerMove(press(point, held));
  one.on.pointerUp();
}

/** Undo to the bottom, naming each step, so a gesture's cost is countable. */
function undoStack(): string[] {
  const labels: string[] = [];
  while (store.getSnapshot().canUndo && labels.length < 30) {
    labels.push(store.getSnapshot().undoLabel ?? "?");
    store.undo();
  }
  return labels;
}

const says = (): string => store.getSnapshot().toolState.says;
const selected = (): string[] => [...store.getSnapshot().selectedNodes].sort();

beforeEach(() => {
  seed();
  store.setTool("select");
});

describe("what a press picks up, tool by tool", () => {
  beforeEach(() => seed([stem()]));

  it("pans on the middle button and on alt, whatever tool is in hand", () => {
    store.setTool("knife");
    const one = mount();
    one.on.pointerDown(press(at(150, 300), { button: 1 }));
    expect(one.drag.current).toMatchObject({ kind: "pan" });

    const two = mount();
    two.on.pointerDown(press(at(150, 300), { altKey: true }));
    expect(two.drag.current).toMatchObject({ kind: "pan" });
  });

  /*
   * A guide is a full-width line, so it crosses points and outlines all the way
   * across the canvas. Tested first and within a few pixels, so it never steals
   * a click meant for a node -- and catchable on a letter with no room beside
   * it, which is why it comes before every tool rather than after.
   */
  it("takes a guide before it considers anything else", () => {
    store.addGuide(300, "y");
    store.setTool("select");
    const one = mount();
    one.on.pointerDown(press({ x: 150, y: at(0, 300).y }));
    expect(one.drag.current).toMatchObject({ kind: "guide", index: 0 });
  });

  it("draws a shape, a knife line or a trail with the tools that take the canvas", () => {
    for (const [tool, kind] of [
      ["rectangle", "shape"],
      ["ellipse", "shape"],
      ["polygon", "shape"],
      ["knife", "knife"],
      ["freehand", "freehand"],
      ["lasso", "lasso"],
      ["skeletonFreehand", "writeTrail"],
    ] as const) {
      store.setTool(tool);
      const one = mount();
      one.on.pointerDown(press(at(150, 300)));
      expect(one.drag.current?.kind, tool).toBe(kind);
    }
  });

  /*
   * A drawing tool takes the whole canvas: there is nothing under the pointer
   * to grab while a rectangle is being dragged out, and a knife that picked up
   * a node the moment it started on one could not cut through a corner.
   */
  it("does not grab a node with a tool that draws, even pressed right on one", () => {
    store.setTool("knife");
    const one = mount();
    one.on.pointerDown(press(at(100, 0)));
    expect(one.drag.current?.kind).toBe("knife");
  });

  it("falls through to a marquee where there is nothing to take hold of", () => {
    const one = mount();
    one.on.pointerDown(press(at(400, 400)));
    expect(one.drag.current).toMatchObject({ kind: "marquee", additive: false });
  });
});

/**
 * The four tools that act on the press rather than starting a drag.
 *
 * Each was a modifier on the pen or nothing at all. As their own tools each
 * click means one thing -- and each has to say so when there is nothing under
 * it, because a tool that silently does nothing is indistinguishable from one
 * that is broken.
 */
describe("the tools that act at once", () => {
  beforeEach(() => seed([stem()]));

  it("adds a point to the edge under the pointer", () => {
    store.setTool("addPoint");
    mount().on.pointerDown(press(at(150, 0)));
    expect(store.glyph("a")?.contours[0].nodes).toHaveLength(5);
  });

  it("takes out the point under the pointer", () => {
    store.setTool("deletePoint");
    mount().on.pointerDown(press(at(100, 0)));
    expect(store.glyph("a")?.contours[0].nodes).toHaveLength(3);
  });

  it("picks the whole contour the pointer is on", () => {
    store.setTool("selectPath");
    mount().on.pointerDown(press(at(100, 0)));
    expect(selected()).toEqual(["0:0", "0:1", "0:2", "0:3"]);
  });

  it("lets go of the selection when it lands on nothing", () => {
    store.setTool("selectPath");
    store.setSelectedNodes(new Set(["0:0"]));
    mount().on.pointerDown(press(at(400, 400)));
    expect(selected()).toEqual([]);
  });

  /*
   * Each says what is wrong and then what would fix it. A tool that can do
   * nothing where the pointer is has to say so, or a click that did nothing
   * reads as a tool that is broken.
   */
  it("says what is missing rather than doing nothing quietly", () => {
    for (const [tool, expected] of [
      ["addPoint", "Nothing there to add a point to. Point at an edge."],
      ["deletePoint", "Nothing there to take out. Point at a point."],
      ["convertPoint", "Nothing there to change. Point at a point."],
      ["scissors", "Nothing there to open. Point at a point or an edge."],
    ] as const) {
      store.setTool(tool);
      mount().on.pointerDown(press(at(400, 400)));
      expect(store.getSnapshot().status?.message, tool).toBe(expected);
    }
  });

  /*
   * A cut lands anywhere rather than only where a point is: on an edge the
   * scissors put a point in first and then open at it.
   */
  it("opens a closed contour, on a point or on an edge", () => {
    store.setTool("scissors");
    mount().on.pointerDown(press(at(100, 0)));
    expect(store.glyph("a")?.contours[0].closed).toBe(false);

    seed([stem()]);
    mount().on.pointerDown(press(at(150, 0)));
    expect(store.glyph("a")?.contours[0].closed).toBe(false);
    expect(store.glyph("a")?.contours[0].nodes).toHaveLength(5);
  });

  /*
   * The one of the four that holds rather than acting, because it has two
   * gestures: a click switches the point between a curve and a corner, and a
   * pull brings a handle out of it. Which it was is not known until the pointer
   * either moves or does not.
   */
  it("holds on to a point rather than acting, for the tool with two gestures", () => {
    store.setTool("convertPoint");
    const one = mount();
    one.on.pointerDown(press(at(100, 0)));
    expect(one.drag.current).toMatchObject({ kind: "pen", contour: 0, node: 0, pulled: false });
  });
});

describe("what the select tool takes hold of", () => {
  /*
   * Anchor, then handle, then node -- the same order the hover resolves in, so
   * the highlight and the click can never disagree.
   */
  it("prefers an anchor to a handle, and a handle to a node", () => {
    seed([{ closed: false, nodes: [node(100, 100, { handleOut: { x: 160, y: 100 } })] }], {
      anchors: [{ name: "top", x: 250, y: 700 }],
    });

    const one = mount();
    one.on.pointerDown(press(at(250, 700)));
    expect(one.drag.current).toMatchObject({ kind: "anchor", name: "top" });

    const two = mount();
    two.on.pointerDown(press(at(160, 100)));
    expect(two.drag.current).toMatchObject({ kind: "handle", side: "out" });

    const three = mount();
    three.on.pointerDown(press(at(100, 100)));
    expect(three.drag.current).toMatchObject({ kind: "node" });
  });

  it("picks the point it grabbed, and drops whatever was picked before", () => {
    seed([stem()]);
    store.setSelectedNodes(new Set(["0:2"]));
    mount().on.pointerDown(press(at(100, 0)));
    expect(selected()).toEqual(["0:0"]);
  });

  it("adds to the selection when a modifier is held, and takes away again", () => {
    seed([stem()]);
    store.setSelectedNodes(new Set(["0:2"]));
    mount().on.pointerDown(press(at(100, 0), { shiftKey: true }));
    expect(selected()).toEqual(["0:0", "0:2"]);

    mount().on.pointerDown(press(at(100, 0), { shiftKey: true }));
    expect(selected()).toEqual(["0:2"]);
  });

  /*
   * A press on one of several picked points keeps the rest, so a group can be
   * dragged. Replacing the selection here would make dragging two points
   * impossible: the press would drop the other one before the drag began.
   */
  it("keeps a group when the press lands on one of them", () => {
    seed([stem()]);
    store.setSelectedNodes(new Set(["0:0", "0:1"]));
    const one = mount();
    one.on.pointerDown(press(at(100, 0)));
    expect(selected()).toEqual(["0:0", "0:1"]);
    expect(one.drag.current).toMatchObject({ kind: "node", anchor: { contour: 0, node: 0 } });
  });
});

describe("dragging a letter about", () => {
  it("moves every picked point by what the anchor moved", () => {
    seed([stem()]);
    store.setSelectedNodes(new Set(["0:0", "0:1"]));
    gesture(at(100, 0), [at(140, 60)]);

    const nodes = store.glyph("a")?.contours[0].nodes ?? [];
    expect(nodes[0].point).toMatchObject({ x: 140, y: 60 });
    expect(nodes[1].point).toMatchObject({ x: 240, y: 60 });
    // And the ones that were not picked stayed exactly where they were.
    expect(nodes[2].point).toMatchObject({ x: 200, y: 700 });
  });

  /**
   * Shift holds a drag to one axis, as it does in every drawing tool -- and
   * after the constraint the snap must not give the other axis back.
   *
   * Held from the move rather than from the press, because on the press the
   * same key means something else entirely: it adds to the selection, and on a
   * point already in it, takes it out. Pressed with shift down on the point
   * about to be dragged, the drag begins with nothing picked and moves nothing
   * at all -- which is how this test first read, passing on a letter that had
   * not changed.
   */
  it("holds a drag to one axis while shift is down", () => {
    seed([stem()]);
    store.setSelectedNodes(new Set(["0:0"]));
    const one = mount();
    one.on.pointerDown(press(at(100, 0)));
    one.on.pointerMove(press(at(180, 20), { shiftKey: true }));
    one.on.pointerUp();
    expect(store.glyph("a")?.contours[0].nodes[0].point).toMatchObject({ x: 180, y: 0 });
  });

  it("moves a handle to where the pointer let go of it", () => {
    seed([{ closed: false, nodes: [node(100, 100, { handleOut: { x: 160, y: 100 } })] }]);
    store.setSnapping(false);
    gesture(at(160, 100), [at(200, 160)]);
    expect(store.glyph("a")?.contours[0].nodes[0].handleOut).toMatchObject({ x: 200, y: 160 });
  });

  /*
   * A guide belongs to the font rather than to a letter, so dragging one has to
   * work on a letter with no outlines at all -- which is where somebody setting
   * up their lines before drawing anything is standing.
   */
  it("drags a guide on a letter with nothing drawn in it", () => {
    seed();
    store.addGuide(300, "y");
    const one = mount();
    one.on.pointerDown(press({ x: 150, y: at(0, 300).y }));
    one.on.pointerMove(press({ x: 150, y: at(0, 500).y }));
    expect(store.getSnapshot().guides[0].at).toBeCloseTo(500);
  });
});

describe("picking points with a band and with a ring", () => {
  it("takes everything inside the marquee", () => {
    seed([stem()]);
    gesture(at(50, -50), [at(250, 100)]);
    expect(selected()).toEqual(["0:0", "0:1"]);
  });

  it("starts again unless shift says otherwise", () => {
    seed([stem()]);
    store.setSelectedNodes(new Set(["0:2"]));
    gesture(at(50, -50), [at(250, 100)]);
    expect(selected()).toEqual(["0:0", "0:1"]);

    store.setSelectedNodes(new Set(["0:2"]));
    gesture(at(50, -50), [at(250, 100)], { shiftKey: true });
    expect(selected()).toEqual(["0:0", "0:1", "0:2"]);
  });

  /*
   * A ring rather than a box, because a box cannot pick the points on one side
   * of a curve without taking the other side too.
   */
  it("takes everything inside the lasso's ring", () => {
    seed([stem()]);
    store.setTool("lasso");
    gesture(at(50, -50), [at(250, -50), at(250, 100), at(50, 100)]);
    expect(selected()).toEqual(["0:0", "0:1"]);
  });
});

describe("what a gesture costs to undo", () => {
  /*
   * One entry per gesture. A drag writes live so the letter moves under the
   * hand, and records once on release -- `editGlyphLive` per pointer move would
   * put thirty entries on the stack for one pull.
   */
  it("puts one thing on the stack for a whole drag, however far it went", () => {
    seed([stem()]);
    store.setSelectedNodes(new Set(["0:0"]));
    gesture(at(100, 0), [at(120, 20), at(140, 40), at(160, 60), at(180, 80)]);
    expect(undoStack()).toEqual(["Move points"]);
  });

  it("puts nothing on the stack for the two that change no letter", () => {
    seed([stem()]);
    store.addGuide(300, "y");
    const before = undoStack().length;
    expect(before).toBe(0);

    gesture({ x: 150, y: at(0, 300).y }, [{ x: 150, y: at(0, 500).y }]);
    mount().on.pointerDown(press(at(150, 300), { button: 1 }));
    mount().on.pointerUp();
    expect(undoStack()).toEqual([]);
  });

  /**
   * The one that made undo look broken.
   *
   * A click and a pull are the same press until the pointer either moves or
   * does not, and only the pull has anything to record: the click already wrote
   * its own point down. This asked `drag.node > 0` instead -- the index of the
   * point just placed, which is greater than zero for every point after the
   * first -- so each plain click from the second onwards committed an empty
   * edit on top of its own.
   *
   * Three clicks left five things to undo, two of which changed nothing on
   * screen. The pen's drag beside it has always asked the right question.
   */
  it("costs one press per click when nothing was pulled", () => {
    seed();
    store.setTool("skeleton");
    for (const point of [at(100, 300), at(200, 300), at(300, 300)]) {
      const one = mount();
      one.on.pointerDown(press(point));
      one.on.pointerUp();
    }
    expect(store.glyph("a")?.written?.strokes[0]?.spine.segments).toHaveLength(2);
    expect(undoStack()).toEqual(["Write", "Write", "Write"]);
  });

  it("costs one more when something was pulled", () => {
    seed();
    store.setTool("skeleton");
    const first = mount();
    first.on.pointerDown(press(at(100, 300)));
    first.on.pointerUp();
    gesture(at(240, 300), [at(340, 400)]);
    expect(undoStack()).toEqual(["Write a curve", "Write", "Write"]);
  });

  /*
   * And the pen the same way round: a plain click placed its point through
   * `addPoint`, which recorded itself.
   */
  it("costs one press per pen click, and one more for a pull", () => {
    seed();
    store.setTool("pen");
    const one = mount();
    one.on.pointerDown(press(at(100, 300)));
    one.on.pointerUp();
    expect(undoStack()).toEqual(["Add point"]);

    seed();
    store.setTool("pen");
    gesture(at(100, 300), [at(200, 400)]);
    expect(undoStack()).toEqual(["Draw a curve", "Add point"]);
  });
});

describe("cutting, drawing and closing", () => {
  it("cuts a shape in two with a line drawn across it", () => {
    seed([stem()]);
    store.setTool("knife");
    expect(store.glyph("a")?.contours).toHaveLength(1);
    gesture(at(50, 300), [at(250, 300)]);
    expect(store.glyph("a")?.contours).toHaveLength(2);
  });

  it("leaves the letter alone when the line crosses nothing", () => {
    seed([stem()]);
    store.setTool("knife");
    gesture(at(300, 100), [at(300, 600)]);
    expect(store.glyph("a")?.contours).toHaveLength(1);
  });

  /*
   * Shift squares a shape off and alt draws it from the middle, read off the
   * last move rather than off the pointer-up: letting go of the modifier a
   * moment before the button is a thing hands do, and is not a change of mind
   * about wanting a square.
   */
  it("squares a shape off from the modifier held during the drag, not at the end", () => {
    seed();
    store.setTool("rectangle");
    const one = mount();
    one.on.pointerDown(press(at(0, 0)));
    one.on.pointerMove(press(at(400, 100), { shiftKey: true }));
    // Let go of shift before the button, as a hand does.
    one.on.pointerUp();

    const nodes = store.glyph("a")?.contours[0]?.nodes ?? [];
    const width =
      Math.max(...nodes.map((one) => one.point.x)) - Math.min(...nodes.map((one) => one.point.x));
    const height =
      Math.max(...nodes.map((one) => one.point.y)) - Math.min(...nodes.map((one) => one.point.y));
    expect(width).toBeCloseTo(height);
  });

  it("closes the outline when the pen comes back to where it started", () => {
    seed();
    store.setTool("pen");
    for (const point of [at(100, 100), at(300, 100), at(300, 300)]) {
      const one = mount();
      one.on.pointerDown(press(point));
      one.on.pointerUp();
    }
    expect(store.glyph("a")?.contours[0].closed).toBe(false);

    mount().on.pointerDown(press(at(100, 100)));
    expect(store.glyph("a")?.contours[0].closed).toBe(true);
  });

  /**
   * The pen on an existing edge puts a point there instead of starting an
   * outline somewhere -- but only while nothing is being drawn.
   *
   * Mid-outline the pen is placing points, and a click that landed on an
   * existing edge would silently stop drawing and edit something else. Which is
   * the more surprising of the two by far: the outline in progress is
   * abandoned, and the point appears somewhere the person was not looking.
   */
  it("puts a point on an edge it lands on, until it is drawing something", () => {
    seed([stem()]);
    store.setTool("pen");
    const one = mount();
    one.on.pointerDown(press(at(150, 0)));
    one.on.pointerUp();
    // The existing contour grew; no second one was begun.
    expect(store.glyph("a")?.contours).toHaveLength(1);
    expect(store.glyph("a")?.contours[0].nodes).toHaveLength(5);

    // Now with an outline in progress, the same press adds to that instead.
    seed([stem()]);
    const two = mount();
    two.on.pointerDown(press(at(400, 400)));
    two.on.pointerUp();
    expect(store.glyph("a")?.contours).toHaveLength(2);

    const three = mount();
    three.on.pointerDown(press(at(150, 0)));
    three.on.pointerUp();
    expect(store.glyph("a")?.contours[0].nodes).toHaveLength(4);
    expect(store.glyph("a")?.contours[1].nodes).toHaveLength(2);
  });

  it("says so rather than drawing when a stroke was a click", () => {
    seed();
    store.setTool("freehand");
    gesture(at(150, 300));
    expect(store.getSnapshot().status?.message).toBe(
      "That was a click rather than a stroke. Drag to draw.",
    );
  });
});

/**
 * The sentence under the canvas, which has to describe the program the person
 * is actually looking at.
 *
 * Three places work out what is true of the letter with no pointer to speak of:
 * the pointer leaving, a tool being picked up, and a phase refreshed after
 * something else changed the letter. They disagreed, and the two that were
 * short of facts said things that were flatly untrue of what was on screen.
 */
describe("what the tool says", () => {
  it("says what the knife will do, and warns when there is nothing to cut", () => {
    seed([stem()]);
    store.setTool("knife");
    mount().on.pointerMove(press(at(150, 300)));
    expect(says()).toBe("Drag a line right across a shape to cut it in two.");

    seed();
    store.setTool("knife");
    mount().on.pointerMove(press(at(150, 300)));
    expect(says()).toBe("Nothing to cut here. The line has to cross a shape.");
  });

  /**
   * The one that warned about an empty letter over a full one.
   *
   * Whether there is a shape to cut is a fact about the letter, not about the
   * place under the pointer, so taking the pointer off the canvas must not
   * change the answer. It did: the knife's one warning -- the case it exists
   * for -- appeared over a letter with plenty to cut, every time the pointer
   * went to the toolbar. Which is a move that necessarily leaves the canvas.
   */
  it("keeps saying it when the pointer leaves the canvas", () => {
    seed([stem()]);
    store.setTool("knife");
    const one = mount();
    one.on.pointerMove(press(at(150, 300)));
    const onCanvas = says();
    one.on.pointerLeave();
    expect(says()).toBe(onCanvas);
    expect(says()).toBe("Drag a line right across a shape to cut it in two.");
  });

  /*
   * And the same for the pen, which has a different sentence for an outline in
   * progress. Leaving the canvas mid-outline went back to the one for starting
   * a new one, over an outline three points into being drawn.
   */
  it("still knows an outline is open once the pointer leaves", () => {
    seed();
    store.setTool("pen");
    for (const point of [at(100, 100), at(300, 100), at(300, 300)]) {
      const one = mount();
      one.on.pointerDown(press(point));
      one.on.pointerUp();
    }
    const one = mount();
    one.on.pointerMove(press(at(400, 400)));
    expect(says()).toContain("Click to add a point");
    one.on.pointerLeave();
    expect(says()).toContain("Click to add a point");
  });

  /*
   * A phase asked for without a pointer at all, which is what a change made
   * somewhere else in the application comes through. The same facts again.
   */
  it("knows the same things when asked with no pointer at all", () => {
    seed([stem()]);
    store.setTool("knife");
    mount().refreshPhase();
    expect(says()).toBe("Drag a line right across a shape to cut it in two.");
  });

  it("offers to close the outline on the point that would close it", () => {
    seed();
    store.setTool("pen");
    for (const point of [at(100, 100), at(300, 100), at(300, 300)]) {
      const one = mount();
      one.on.pointerDown(press(point));
      one.on.pointerUp();
    }
    mount().on.pointerMove(press(at(100, 100)));
    expect(says()).toBe("Click to close the outline.");
  });
});

describe("double clicking", () => {
  it("takes a guide away", () => {
    seed([stem()]);
    store.addGuide(300, "y");
    expect(store.getSnapshot().guides).toHaveLength(1);
    mount().on.doubleClick(press({ x: 150, y: at(0, 300).y }));
    expect(store.getSnapshot().guides).toHaveLength(0);
  });

  /*
   * The only reliable way to pick a counter without the outline round it: a
   * marquee big enough to catch the inner circle of an `o` catches the outer
   * one too, and there is no rubber band that does not.
   */
  it("picks the whole contour under the pointer, and only that one", () => {
    seed([stem(), { closed: true, nodes: [node(300, 0), node(400, 0), node(400, 700)] }]);
    mount().on.doubleClick(press(at(300, 0)));
    expect(selected()).toEqual(["1:0", "1:1", "1:2"]);

    /*
     * And the other way round, which is the half that bites. `selectAllNodes`
     * replaces the selection rather than adding to it, so picking every contour
     * in turn would leave the last one picked -- and against a letter whose
     * wanted contour is the last, that reads exactly like picking the right
     * one. The first contour is the one that can tell them apart.
     */
    seed([stem(), { closed: true, nodes: [node(300, 0), node(400, 0), node(400, 700)] }]);
    mount().on.doubleClick(press(at(100, 0)));
    expect(selected()).toEqual(["0:0", "0:1", "0:2", "0:3"]);
  });
});
