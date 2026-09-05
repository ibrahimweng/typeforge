/**
 * The state of a font being assembled.
 *
 * Most of what this store does is hand an edit to `assemble/document.ts` and
 * keep the answer, and that half is checked there. What is left for here is
 * what the store adds: which drop of files got read and which did not, what a
 * drag counts as when it comes to undo, and the rhythm borrowed off another
 * font.
 *
 * The history is the part with the bugs in it. A gesture is a run of edits that
 * has to end up as one entry, and deciding when one is over is the only piece
 * of state in this file that is not the document.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { emptyAssembly } from "@/assemble/document";
import { assembleStore as store } from "./assemble-store";

/** A drawing, as a file somebody dropped. */
function drawing(name: string, width = 300): File {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800">` +
    `<rect x="50" y="300" width="${width}" height="400"/></svg>`;
  return new File([svg], name, { type: "image/svg+xml" });
}

/** Something that is not a drawing at all, which is what gets dropped by mistake. */
function notADrawing(name: string): File {
  return new File(["a screenshot, or a readme, or anything else"], name);
}

const state = () => store.getSnapshot();
const upm = () => state().assembly.metrics.unitsPerEm;
const white = () => state().assembly.spacing.white;

/*
 * The store is the one there is, so each test puts it back rather than making
 * its own. `restore` is the way in, and it is what the session does too.
 */
function empty(): void {
  store.restore({ assembly: emptyAssembly(), familyName: "Untitled", specimen: "Handgloves" });
}

describe("a pile of files", () => {
  beforeEach(empty);

  /*
   * Everything that could be read is taken and everything that could not is
   * named. Dropping thirty files and being told nothing happened is the worst
   * possible answer, and refusing the whole drop because one of them was a
   * screenshot is how that happens.
   */
  it("takes what it can read and names what it cannot", async () => {
    const refused = await store.take([
      drawing("A_.svg"),
      notADrawing("screenshot.png"),
      drawing("B_.svg"),
    ]);

    expect(refused).toEqual(["screenshot.png"]);
    expect(state().assembly.pieces.map((one) => one.character)).toEqual(["A", "B"]);
  });

  it("opens the first drawing it read, when nothing was open", async () => {
    expect(state().selected).toBe("");
    await store.take([drawing("A_.svg"), drawing("B_.svg")]);
    expect(state().selected).toBe("A");
  });

  it("leaves open whatever was already open", async () => {
    await store.take([drawing("A_.svg")]);
    store.select("B");
    await store.take([drawing("C_.svg")]);
    expect(state().selected).toBe("B");
  });

  it("changes nothing when it could read none of them", async () => {
    const refused = await store.take([notADrawing("one.txt"), notADrawing("two.txt")]);
    expect(refused).toEqual(["one.txt", "two.txt"]);
    expect(state().assembly.pieces).toHaveLength(0);
    expect(state().reading).toBe(false);
  });

  it("says nothing happened when nothing was dropped", async () => {
    expect(await store.take([])).toEqual([]);
    expect(state().reading).toBe(false);
  });
});

describe("one file into one box", () => {
  beforeEach(empty);

  it("puts it where it was asked to and opens that box", async () => {
    expect(await store.takeInto("Z", drawing("anything-at-all.svg"))).toBe(true);
    expect(state().assembly.pieces.map((one) => one.character)).toEqual(["Z"]);
    expect(state().selected).toBe("Z");
    expect(state().problem).toBeNull();
  });

  // Rather than sitting there looking as though nothing happened.
  it("says so when the file held nothing drawable", async () => {
    expect(await store.takeInto("Z", notADrawing("holiday.jpg"))).toBe(false);
    expect(state().problem).toContain("holiday.jpg");
    expect(state().assembly.pieces).toHaveLength(0);
    expect(state().reading).toBe(false);
  });
});

describe("what counts as one thing to undo", () => {
  beforeEach(empty);

  /*
   * A drag is a run of edits and one gesture. Fifty entries for one pull of a
   * slider is not a history anybody wants, so the run folds into one.
   */
  it("folds a drag into a single entry", () => {
    const before = state().assembly;
    store.changeMetrics({ unitsPerEm: 1200 }, "during");
    store.changeMetrics({ unitsPerEm: 1400 }, "during");
    store.changeMetrics({ unitsPerEm: 1600 }, "end");
    expect(upm()).toBe(1600);

    store.undo();
    expect(state().assembly).toBe(before);
  });

  it("still moves the revision on every step of it, for the views watching", () => {
    const was = state().revision;
    store.changeMetrics({ unitsPerEm: 1200 }, "during");
    store.changeMetrics({ unitsPerEm: 1400 }, "during");
    expect(state().revision).toBe(was + 2);
  });

  /*
   * `single` says this is a whole edit by itself, and it was folding into an
   * open drag anyway -- so a click that landed while one was in flight could
   * not be taken back on its own, and one undo took both.
   */
  it("gives a finished edit its own entry even mid-drag", () => {
    store.changeMetrics({ unitsPerEm: 1200 }, "during");
    store.setFit("together");
    expect(state().assembly.fit).toBe("together");

    store.undo();
    expect(state().assembly.fit, "the click goes back").toBe("alone");
    expect(upm(), "and the drag is left where it was").toBe(1200);
  });

  /*
   * Undo is somebody stepping outside a gesture, and the step they took back
   * may well be the gesture itself. Left open, the next edit folded into an
   * entry that had already been undone, so one undo went back two steps and the
   * state in between could not be reached at all.
   */
  it("closes a drag that was undone in the middle of it", () => {
    store.changeSpacing({ white: 0.1 }, "single");
    store.changeSpacing({ white: 0.2 }, "single");
    store.changeMetrics({ unitsPerEm: 1200 }, "during");
    store.undo();
    expect(upm()).toBe(1000);

    store.changeSpacing({ white: 0.99 }, "single");
    store.undo();
    expect(white(), "one step back, not two").toBe(0.2);
  });

  /*
   * There is no test for the same thing on redo, and there cannot be: opening a
   * gesture clears the redo stack on its first commit, so nothing is ever there
   * to redo while one is open. The store closes the gesture on redo anyway, for
   * the symmetry.
   */

  it("says which way it can go", () => {
    empty();
    store.changeSpacing({ white: 0.1 }, "single");
    expect(state().canUndo).toBe(true);
    store.undo();
    expect(state().canRedo).toBe(true);
    store.redo();
    expect(white()).toBe(0.1);
  });

  it("does nothing when there is nothing to go back to", () => {
    const was = state().assembly;
    for (let attempt = 0; attempt < 60; attempt++) store.undo();
    expect(() => store.undo()).not.toThrow();
    expect(state().canUndo).toBe(false);
    expect(was).toBeDefined();
  });
});

describe("the pile, and one drawing in it", () => {
  beforeEach(empty);

  it("empties a box and takes a drawing away", async () => {
    await store.take([drawing("A_.svg"), drawing("B_.svg")]);
    store.empty("A");
    expect(state().assembly.pieces.some((one) => one.character === "A")).toBe(false);

    const id = state().assembly.pieces[0].id;
    store.drop(id);
    expect(state().assembly.pieces.some((one) => one.id === id)).toBe(false);
  });

  it("says which character a drawing is for, and opens it", async () => {
    await store.take([drawing("mystery.svg")]);
    const id = state().assembly.pieces[0].id;
    store.map(id, "Q");
    expect(state().assembly.pieces[0].character).toBe("Q");
    expect(state().selected).toBe("Q");
  });

  /*
   * Rebuilt rather than asked again: `build` keeps its answer against the
   * assembly it was given, so a pile built before the boolean library landed
   * would stay uncut however many times it was asked. A new object is a new
   * question.
   */
  it("asks the question again by handing over a new object", () => {
    const was = state().assembly;
    const revision = state().revision;
    store.refresh();
    expect(state().assembly).not.toBe(was);
    expect(state().assembly).toEqual(was);
    expect(state().revision).toBe(revision + 1);
  });
});

describe("writing the half down and putting it back", () => {
  beforeEach(empty);

  it("hands back what it holds, and takes it again", async () => {
    await store.take([drawing("A_.svg")]);
    store.setFamilyName("Bakerloo");
    store.setSpecimen("Handgloves");
    const kept = store.snapshot();

    empty();
    expect(state().assembly.pieces).toHaveLength(0);

    store.restore(kept);
    expect(state().familyName).toBe("Bakerloo");
    expect(state().assembly.pieces).toHaveLength(1);
    expect(state().selected, "opened on the first drawing that has a character").toBe("A");
  });

  // Which is what somebody expects after opening the wrong file.
  it("can be undone away from", async () => {
    await store.take([drawing("A_.svg")]);
    const mine = store.snapshot();
    store.restore({ assembly: emptyAssembly(), familyName: "Other", specimen: "" });
    store.undo();
    expect(state().assembly.pieces).toHaveLength(1);
    expect(mine.assembly.pieces).toHaveLength(1);
  });
});
