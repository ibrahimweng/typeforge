/**
 * Writing a letter with a pen, from the store's side of it.
 *
 * The sweep itself -- a spine and a nib in, contours out -- is `src/quill/`'s
 * business and is checked there. What is left for this file is the decisions
 * the store makes around it, which are the ones a person notices when they are
 * wrong: whether a click starts a stroke or carries on the last one, what
 * happens to a letter whose ink has been taken, and how far a change to a saved
 * pen reaches.
 *
 * Nearly every test here is a bug that was described in a comment above the
 * code and never pinned by anything. Two strokes of an `n` coming out as a
 * single zig-zag through the middle of it is the loudest of them.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { emptyTypeface, type Glyph } from "@/font/types";
import { STARTING_PENS, STARTING_WIDTH } from "@/quill/written";
import { store } from "./store";

function glyph(name: string): Glyph {
  return {
    name,
    unicodes: [],
    advanceWidth: 500,
    contours: [],
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
}

/** A small font in the store, without going through file parsing. */
function seed(names: string[]): void {
  const typeface = emptyTypeface();
  typeface.glyphs = names.map(glyph);
  typeface.glyphIndex = new Map(typeface.glyphs.map((one, index) => [one.name, index]));
  store.startBlank();
  Object.assign(store.getSnapshot().typeface!, typeface);
}

/*
 * The hand, put back between tests.
 *
 * `startBlank` replaces the document and leaves this alone, which is right --
 * a pen is the hand rather than the drawing, and somebody who sets one to
 * forty degrees means the next letter as well. It does mean the tests have to
 * put it back themselves, or one that saves a pen changes what the next one
 * starts from.
 */
function freshHand(): void {
  store.finishStroke();
  // biome-ignore lint/correctness/useHookAtTopLevel: store.usePen is a method on the document store, not a React hook.
  store.usePen(null);
  for (const one of store.pens.filter((p) => !STARTING_PENS.some((s) => s.id === p.id))) {
    store.deletePen(one.id);
  }
  for (const shipped of STARTING_PENS) {
    const held = store.pens.find((one) => one.id === shipped.id);
    if (held && (held.width !== shipped.width || held.name !== shipped.name)) {
      store.editPen(shipped.id, { ...shipped });
    }
  }
  store.setPen({ width: STARTING_WIDTH, contrast: 0.55, angle: 30 });
}

/*
 * A pen of this test's own, for the tests that take one away.
 *
 * Nothing here deletes a shipped pen. There is no way to put one back -- the
 * store has no "add a pen with this id", and rightly -- so a test that removed
 * `textura` would leave every test after it writing with the hand's own
 * numbers, and the failure would land somewhere else entirely. It cost half an
 * hour to find once.
 */
function ownPen(width: number, contrast: number, angle: number): string {
  store.setPen({ width, contrast, angle });
  return store.savePen("For this test")!;
}

/** Click a stroke out, point by point, and put the pen down at the end. */
function write(name: string, ...points: Array<[number, number]>): void {
  for (const [x, y] of points) store.writePoint(name, { x, y });
  store.finishStroke();
}

/** How tall and wide the ink of a letter is, for asking whether it moved. */
function inkSize(name: string): { width: number; height: number } | null {
  const contours = store.glyph(name)?.contours ?? [];
  const xs = contours.flatMap((one) => one.nodes.map((node) => node.point.x));
  const ys = contours.flatMap((one) => one.nodes.map((node) => node.point.y));
  if (xs.length === 0) return null;
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

describe("writing a stroke a click at a time", () => {
  beforeEach(() => {
    freshHand();
    seed(["a", "b"]);
  });

  /*
   * One point is a place and not a stroke, so the first click puts a stroke on
   * the letter with nothing in it and waits. The alternative -- no stroke until
   * the second click -- would mean nothing on the letter to hang the pen's
   * settings off while the person decides where the line goes.
   */
  it("puts an empty stroke down on the first click, and says it is writing", () => {
    store.writePoint("a", { x: 0, y: 0 });
    expect(store.strokesOf("a")).toHaveLength(1);
    expect(store.strokesOf("a")[0].spine.segments).toHaveLength(0);
    expect(store.writing).toEqual({ name: "a", from: { x: 0, y: 0 } });
  });

  it("draws ink from the second click, which is where there is a line to sweep", () => {
    store.writePoint("a", { x: 0, y: 0 });
    expect(store.glyph("a")!.contours).toHaveLength(0);
    store.writePoint("a", { x: 200, y: 0 });
    expect(store.strokesOf("a")[0].spine.segments).toHaveLength(1);
    expect(store.glyph("a")!.contours.length).toBeGreaterThan(0);
  });

  /*
   * The zig-zag `n`.
   *
   * "Is the last stroke open" is a fact about the shape and "is somebody part
   * way through writing one" is a fact about the session, and with one flag for
   * both, a stroke finished with Escape was still the open one -- so the next
   * click reached back and extended it, and the two strokes of an `n` came out
   * as a single line through the middle of the letter.
   */
  it("starts a second stroke after the first is finished, rather than extending it", () => {
    write("a", [0, 0], [100, 0]);
    write("a", [0, 200], [100, 200]);
    expect(store.strokesOf("a")).toHaveLength(2);
    expect(store.strokesOf("a").map((one) => one.spine.segments.length)).toEqual([1, 1]);
  });

  it("starts a stroke on a different letter rather than carrying on the last one", () => {
    store.writePoint("a", { x: 0, y: 0 });
    store.writePoint("b", { x: 0, y: 0 });
    expect(store.strokesOf("a")).toHaveLength(1);
    expect(store.strokesOf("b")).toHaveLength(1);
    expect(store.writing?.name).toBe("b");
  });

  /*
   * `writing` is a fact about the session, so replacing the document does not
   * clear it -- and a name can match across two documents, because there is an
   * `a` in both. Every click then found nothing to extend and returned, so the
   * first two clicks on the new document drew nothing and said nothing.
   */
  it("recovers when the document was replaced part way through a stroke", () => {
    store.writePoint("a", { x: 0, y: 0 });
    seed(["a", "b"]);
    expect(store.strokesOf("a")).toHaveLength(0);

    store.writePoint("a", { x: 10, y: 10 });
    store.writePoint("a", { x: 90, y: 10 });
    expect(store.strokesOf("a")).toHaveLength(1);
    expect(store.strokesOf("a")[0].spine.segments).toHaveLength(1);
  });

  it("puts the pen down when the stroke is finished", () => {
    store.writePoint("a", { x: 0, y: 0 });
    store.finishStroke();
    expect(store.writing).toBeNull();
  });
});

describe("closing a stroke into a ring", () => {
  beforeEach(() => {
    freshHand();
    seed(["o"]);
  });

  it("refuses a stroke that is one segment long, which is a line and not a ring", () => {
    store.writePoint("o", { x: 0, y: 0 });
    store.writePoint("o", { x: 100, y: 0 });
    expect(store.closeStroke("o")).toBe(false);
    expect(store.strokesOf("o")[0].spine.closed).toBe(false);
  });

  it("closes one with two segments, and puts the pen down", () => {
    store.writePoint("o", { x: 0, y: 0 });
    store.writePoint("o", { x: 100, y: 0 });
    store.writePoint("o", { x: 50, y: 100 });
    expect(store.closeStroke("o")).toBe(true);
    expect(store.strokesOf("o")[0].spine.closed).toBe(true);
    expect(store.writing).toBeNull();
  });

  it("refuses a stroke that is already closed", () => {
    store.writePoint("o", { x: 0, y: 0 });
    store.writePoint("o", { x: 100, y: 0 });
    store.writePoint("o", { x: 50, y: 100 });
    store.closeStroke("o");
    expect(store.closeStroke("o")).toBe(false);
  });

  it("refuses a letter with nothing written on it", () => {
    expect(store.closeStroke("o")).toBe(false);
  });
});

describe("a stroke drawn in one movement", () => {
  beforeEach(() => {
    freshHand();
    seed(["s"]);
  });

  it("refuses a trail too short to be a movement", () => {
    expect(store.writeTrail("s", [{ x: 0, y: 0 }])).toBe(false);
    expect(store.strokesOf("s")).toHaveLength(0);
  });

  it("fits one stroke to the trail, with ink, and leaves nothing being written", () => {
    const drawn = store.writeTrail("s", [
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 0 },
      { x: 150, y: 60 },
    ]);
    expect(drawn).toBe(true);
    expect(store.strokesOf("s")).toHaveLength(1);
    expect(store.glyph("s")!.contours.length).toBeGreaterThan(0);
    expect(store.writing).toBeNull();
  });
});

describe("taking a stroke away", () => {
  beforeEach(() => {
    freshHand();
    seed(["a"]);
  });

  it("leaves the letter with neither strokes nor ink when the last one goes", () => {
    write("a", [0, 0], [100, 0]);
    expect(store.glyph("a")!.contours.length).toBeGreaterThan(0);

    store.deleteStroke("a", 0);
    expect(store.glyph("a")!.written).toBeUndefined();
    expect(store.glyph("a")!.contours).toHaveLength(0);
  });

  it("re-sweeps what is left when one of several goes", () => {
    write("a", [0, 0], [100, 0]);
    write("a", [0, 200], [100, 200]);
    store.deleteStroke("a", 0);
    expect(store.strokesOf("a")).toHaveLength(1);
    expect(store.glyph("a")!.contours.length).toBeGreaterThan(0);
  });
});

describe("taking the ink, and putting it back", () => {
  beforeEach(() => {
    freshHand();
    seed(["a"]);
    write("a", [0, 0], [100, 0]);
  });

  it("takes it once and refuses the second time", () => {
    expect(store.expandWritten("a")).toBe(true);
    expect(store.glyph("a")!.written!.expanded).toBe(true);
    expect(store.expandWritten("a")).toBe(false);
  });

  it("keeps the strokes, so it can be put back", () => {
    store.expandWritten("a");
    expect(store.strokesOf("a")).toHaveLength(1);
    expect(store.unexpandWritten("a")).toBe(true);
    expect(store.glyph("a")!.written!.expanded).toBe(false);
    expect(store.unexpandWritten("a")).toBe(false);
  });

  /*
   * The ink stops following the strokes once it has been taken, so a change to
   * the strokes moved nothing at all. Somebody was drawing into a letter that
   * would not answer, while the status line offered to fill it in.
   */
  it("leaves the ink alone while it is taken, and follows again once it is back", () => {
    store.expandWritten("a");
    const taken = inkSize("a")!;
    store.setStrokePen("a", 0, 0, { width: 400 });
    expect(inkSize("a")).toEqual(taken);

    store.unexpandWritten("a");
    expect(inkSize("a")!.height).toBeGreaterThan(taken.height);
  });

  it("puts a letter back to its strokes when somebody writes on it again", () => {
    store.expandWritten("a");
    store.writePoint("a", { x: 300, y: 300 });
    expect(store.glyph("a")!.written!.expanded).toBe(false);
  });

  it("refuses a letter nobody wrote", () => {
    seed(["z"]);
    expect(store.expandWritten("z")).toBe(false);
    expect(store.unexpandWritten("z")).toBe(false);
  });

  /*
   * The way back survives a change that is not to the outlines.
   *
   * Editing an expanded letter's outlines by hand is meant to throw the
   * strokes away, because un-expanding would re-sweep over the work -- but the
   * check for "were the outlines edited" compared a live glyph against a clone
   * with `JSON.stringify`, and `cloneGlyph` writes a contour's keys in its own
   * order. The two strings never matched, so every edit read as an outline
   * edit. Turning a pen on an expanded letter silently threw away the strokes,
   * and the button went on offering to put them back.
   */
  it("keeps the strokes through a change that is not to the outlines", () => {
    store.expandWritten("a");
    store.setStrokePen("a", 0, 0, { width: 400 });
    expect(store.glyph("a")!.written).toBeDefined();
    expect(store.strokesOf("a")).toHaveLength(1);
    expect(store.unexpandWritten("a")).toBe(true);
  });

  it("still throws them away when the outlines really are edited", () => {
    store.expandWritten("a");
    store.editGlyph("a", "Move points", (editing) => {
      editing.contours[0].nodes[0].point.x += 25;
    });
    expect(store.glyph("a")!.written).toBeUndefined();
  });
});

describe("the pens on the desk", () => {
  beforeEach(() => {
    freshHand();
    seed(["a"]);
  });

  it("saves the hand under a name, and writes with it from then on", () => {
    store.setPen({ width: 77, contrast: 0.3, angle: 12 });
    const id = store.savePen("Mine");
    expect(id).not.toBeNull();
    const saved = store.pens.find((one) => one.id === id)!;
    expect(saved).toMatchObject({ name: "Mine", width: 77, contrast: 0.3, angle: 12 });
    expect(store.getSnapshot().usingPen).toBe(id);
  });

  // Not wrong, but two rows reading the same thing are two rows nobody can
  // tell apart.
  it("numbers a name that is already taken", () => {
    store.savePen("Mine");
    store.savePen("Mine");
    store.savePen("Mine");
    const mine = store.pens.filter((one) => one.name.startsWith("Mine")).map((one) => one.name);
    expect(mine).toEqual(["Mine", "Mine 2", "Mine 3"]);
  });

  it("falls back to a name rather than saving one with none", () => {
    store.savePen("   ");
    expect(store.pens[store.pens.length - 1].name).toBe("Pen");
  });

  /*
   * The panel has to show what will actually be drawn, rather than a set of
   * numbers the saved pen is about to override.
   */
  it("sets the hand to the pen it is told to use", () => {
    store.usePen("textura");
    const textura = STARTING_PENS.find((one) => one.id === "textura")!;
    expect(store.pen).toEqual({
      width: textura.width,
      contrast: textura.contrast,
      angle: textura.angle,
    });
  });

  it("takes no notice of a pen it does not have", () => {
    store.usePen("no-such-pen");
    expect(store.getSnapshot().usingPen).toBeNull();
  });

  it("goes back to the hand's own pen", () => {
    store.usePen("textura");
    store.usePen(null);
    expect(store.getSnapshot().usingPen).toBeNull();
  });
});

describe("changing a saved pen", () => {
  beforeEach(() => {
    freshHand();
    seed(["a", "b"]);
    store.usePen("textura");
    write("a", [0, 0], [200, 0]);
    write("b", [0, 0], [200, 0]);
  });

  /*
   * The whole point of the feature: every written letter in the font follows,
   * not just the one in hand.
   */
  it("reaches every letter written with it", () => {
    const was = { a: inkSize("a")!, b: inkSize("b")! };
    store.editPen("textura", { width: 240 });
    expect(inkSize("a")!.height).toBeGreaterThan(was.a.height);
    expect(inkSize("b")!.height).toBeGreaterThan(was.b.height);
  });

  it("is one entry in the history, because it is one act", () => {
    store.editPen("textura", { width: 240 });
    const changed = inkSize("a")!.height;
    store.undo();
    expect(inkSize("a")!.height).toBeLessThan(changed);
    expect(store.pens.find((one) => one.id === "textura")!.width).not.toBe(240);
  });

  // A rename is not a change to any letter, so nothing is re-swept and nothing
  // goes on the history.
  it("leaves the letters alone when only the name changes", () => {
    const was = inkSize("a")!;
    store.editPen("textura", { name: "Renamed" });
    expect(inkSize("a")).toEqual(was);
    expect(store.pens.find((one) => one.id === "textura")!.name).toBe("Renamed");
  });

  it("leaves a letter written with the hand's own pen alone", () => {
    store.usePen(null);
    seed(["c"]);
    store.usePen("textura");
    write("c", [0, 0], [200, 0]);
    store.usePen(null);
    write("c", [0, 300], [200, 300]);
    const loose = store.strokesOf("c")[1];
    expect(loose.nib.every((stop) => stop.pen === undefined)).toBe(true);
  });
});

describe("a pen that is taken away", () => {
  let mine = "";
  beforeEach(() => {
    freshHand();
    seed(["a"]);
    mine = ownPen(120, 0.9, 45);
    write("a", [0, 0], [200, 0]);
  });

  /*
   * Detached rather than left pointing at nothing. The letters would look the
   * same either way, because a stop falls back to its own numbers -- but a stop
   * naming a pen the font does not have is a thing somebody has to explain.
   */
  it("takes its name off every stop that followed it", () => {
    expect(store.strokesOf("a")[0].nib.some((stop) => stop.pen === mine)).toBe(true);
    store.deletePen(mine);
    expect(store.strokesOf("a")[0].nib.every((stop) => stop.pen === undefined)).toBe(true);
    expect(store.pens.some((one) => one.id === mine)).toBe(false);
  });

  it("leaves the letter looking as it did", () => {
    const was = inkSize("a")!;
    store.deletePen(mine);
    expect(inkSize("a")).toEqual(was);
  });

  it("stops writing with it", () => {
    store.deletePen(mine);
    expect(store.getSnapshot().usingPen).toBeNull();
  });
});

describe("one stop of one stroke", () => {
  beforeEach(() => {
    freshHand();
    seed(["a"]);
    store.usePen("textura");
    write("a", [0, 0], [200, 0]);
  });

  /*
   * The point of detaching is that this one place is nearly right and needs to
   * be its own, so a detach that reset the numbers would throw away the thing
   * being kept.
   */
  it("keeps the numbers when a stop is freed from its pen", () => {
    const textura = STARTING_PENS.find((one) => one.id === "textura")!;
    store.setStopPen("a", 0, 0, null);
    const stop = store.strokesOf("a")[0].nib[0];
    expect(stop.pen).toBeUndefined();
    expect(stop.contrast).toBe(textura.contrast);
    expect(stop.angle).toBe(textura.angle);
  });

  it("puts a pen on a stop, numbers and all", () => {
    store.setStopPen("a", 0, 0, null);
    store.setStopPen("a", 0, 0, "ruqaa");
    const ruqaa = STARTING_PENS.find((one) => one.id === "ruqaa")!;
    const stop = store.strokesOf("a")[0].nib[0];
    expect(stop.pen).toBe("ruqaa");
    expect(stop.angle).toBe(ruqaa.angle);
    expect(store.strokesOf("a")[0].width).toEqual([{ at: 0, width: ruqaa.width }]);
  });

  it("says nothing about a stop that is not there", () => {
    expect(() => store.setStopPen("a", 9, 9, "ruqaa")).not.toThrow();
    expect(() => store.setStrokePen("a", 9, 9, { angle: 10 })).not.toThrow();
  });
});

describe("a freehand stroke put into the letter", () => {
  beforeEach(() => {
    freshHand();
    seed(["a"]);
  });

  it("refuses a trail too short to fit", () => {
    expect(store.addStroke("a", [{ x: 0, y: 0 }])).toBe(false);
    expect(store.glyph("a")!.contours).toHaveLength(0);
  });

  it("adds one contour to the letter", () => {
    expect(
      store.addStroke("a", [
        { x: 0, y: 0 },
        { x: 50, y: 40 },
        { x: 100, y: 0 },
      ]),
    ).toBe(true);
    expect(store.glyph("a")!.contours).toHaveLength(1);
  });
});
