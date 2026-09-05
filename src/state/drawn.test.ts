/**
 * The drawing seen from outside the thing that draws.
 *
 * What is being checked is the part that has to be exactly right for the shell
 * to be able to use this instead of the store: that a change is published once
 * and seen, that a repeat is not published at all, and that the two writers --
 * the counter and the rest of the state -- do not overwrite each other. The
 * counter is what tells the session keeper something happened, and a counter
 * that was quietly reset by the next `drawingIs` would be work that is never
 * written down.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  drawingChanged,
  drawingIs,
  drawingReadableBy,
  drawingSoFar,
  drawingToKeep,
  subscribeToDrawings,
} from "./drawn";

/** The state the store reports when it has just started from a base. */
const FRESH = { canUndo: false, canRedo: false, familyName: "Untitled", base: "Sans" };

describe("what the shell can see", () => {
  beforeEach(() => {
    // Back to something known. There is no reset -- this stands in for the one
    // store there is, and in the application it is written once and lives.
    drawingIs(FRESH);
  });

  it("counts every change and hands the count back", () => {
    const before = drawingSoFar().count;
    expect(drawingChanged()).toBe(before + 1);
    expect(drawingChanged()).toBe(before + 2);
    expect(drawingSoFar().count).toBe(before + 2);
  });

  it("keeps the count across a change to everything else", () => {
    const counted = drawingChanged();
    drawingIs({ ...FRESH, canUndo: true, familyName: "Bakerloo" });
    expect(drawingSoFar().count).toBe(counted);
    expect(drawingSoFar().familyName).toBe("Bakerloo");
  });

  it("keeps the rest across a change to the count", () => {
    drawingIs({ ...FRESH, canUndo: true, base: "Didone" });
    drawingChanged();
    expect(drawingSoFar().canUndo).toBe(true);
    expect(drawingSoFar().base).toBe("Didone");
  });

  it("tells a subscriber, and stops when it lets go", () => {
    let told = 0;
    const letGo = subscribeToDrawings(() => {
      told += 1;
    });
    drawingChanged();
    drawingIs({ ...FRESH, canRedo: true });
    expect(told).toBe(2);

    letGo();
    drawingChanged();
    expect(told).toBe(2);
  });

  /*
   * The guard that keeps this cheap. The store says what it is on every write
   * of its state -- forty times a second while a slider moves -- and almost
   * none of those change any of this. Publishing each one would re-render the
   * toolbar for a font whose name and undo stack are exactly as they were.
   */
  it("says nothing when nothing it holds has changed", () => {
    let told = 0;
    const letGo = subscribeToDrawings(() => {
      told += 1;
    });
    const same = drawingSoFar();
    drawingIs(FRESH);
    drawingIs(FRESH);
    expect(told).toBe(0);
    // And hands back the very same object, which is what React compares.
    expect(drawingSoFar()).toBe(same);
    letGo();
  });

  it("hands back one object per change, so React can compare them", () => {
    const before = drawingSoFar();
    drawingChanged();
    const after = drawingSoFar();
    expect(after).not.toBe(before);
    expect(drawingSoFar()).toBe(after);
  });
});

describe("what there is to keep", () => {
  /*
   * First in the file on purpose: this is the state before anything has
   * registered a reader, which is the state on a first screen nobody has drawn
   * on. The store that holds the drawing has not been imported, so there is no
   * drawing -- and a session written in that moment leaves the half out rather
   * than writing an empty one.
   */
  it("is nothing at all until the store says how to read it", () => {
    expect(drawingToKeep()).toBeUndefined();
  });

  it("is whatever the store hands over, once it has", () => {
    const kept = { forge: { base: "Sans" }, familyName: "Bakerloo", specimen: "Handgloves" };
    drawingReadableBy(() => kept as never);
    expect(drawingToKeep()).toBe(kept);
  });

  /*
   * And nothing when the store says the drawing is not work. That decision is
   * the store's rather than the saver's -- `forge/keeping.test.ts` is where it
   * is checked -- and what matters here is that a `undefined` gets through
   * rather than being turned into an empty document.
   */
  it("is nothing when the store says there is nothing worth keeping", () => {
    drawingReadableBy(() => undefined);
    expect(drawingToKeep()).toBeUndefined();
  });
});
