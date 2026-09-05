/**
 * What the draw page's store promises the views that draw the whole alphabet.
 *
 * Two of those promises are new and both were bought with performance in mind,
 * which is exactly why they want holding down by a test: they are invisible
 * when they work and look like a bug when they do not.
 */
import { describe, expect, it, vi } from "vitest";

import { draw } from "@/forge/document";
import { forgeStore } from "./forge-store";

describe("saying when a hand is on a control", () => {
  it("is at rest until a run starts, and not again until it ends", () => {
    forgeStore.changePen({ weight: 90 }, "single");
    expect(forgeStore.getSnapshot().resting).toBe(true);

    forgeStore.changePen({ weight: 100 }, "during");
    expect(forgeStore.getSnapshot().resting).toBe(false);
    forgeStore.changePen({ weight: 110 }, "during");
    expect(forgeStore.getSnapshot().resting).toBe(false);

    forgeStore.changePen({ weight: 120 }, "end");
    expect(forgeStore.getSnapshot().resting).toBe(true);
  });

  /*
   * The one that made the page slow.
   *
   * The trailing catch-up is there so a view following the settled document is
   * never left behind by a control that forgets to say it has finished. It used
   * to say the gesture had finished as well, and a drag on a heavy font stalls
   * for longer than the catch-up waits -- so every stalled frame read as a hand
   * coming off the slider, the expensive layers went back on, and the next
   * frame stalled harder.
   */
  it("lets the views catch up in a pause without calling the pause an ending", () => {
    vi.useFakeTimers();
    try {
      forgeStore.changePen({ weight: 200 }, "single");
      forgeStore.changePen({ weight: 210 }, "during");

      vi.advanceTimersByTime(300);
      const paused = forgeStore.getSnapshot();
      expect(paused.settled).toBe(paused.forge);
      expect(paused.resting).toBe(false);

      // And a long enough silence does end it, for the control that never says.
      vi.advanceTimersByTime(2000);
      expect(forgeStore.getSnapshot().resting).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the run when a gesture says so, and when the work is undone", () => {
    forgeStore.changePen({ weight: 300 }, "during");
    forgeStore.endGesture();
    expect(forgeStore.getSnapshot().resting).toBe(true);

    forgeStore.changePen({ weight: 310 }, "during");
    expect(forgeStore.getSnapshot().resting).toBe(false);
    forgeStore.undo();
    expect(forgeStore.getSnapshot().resting).toBe(true);
  });
});

/**
 * Drawings are remembered against the document they were drawn from, which is
 * what keeps a re-render from redrawing four hundred and fifty-two letters. It
 * also means that saying "draw it all again" by bumping a number says nothing
 * at all: the document is the same object, so the same drawings come back.
 *
 * There is one caller that needs exactly that -- the boolean library the cuts
 * are made of arrives after the application does, and every letter drawn before
 * it landed was drawn without it.
 */
describe("asking for the drawing to happen again", () => {
  it("hands out a document that has to be drawn afresh", () => {
    forgeStore.changePen({ weight: 400 }, "single");
    const before = forgeStore.getSnapshot().forge;
    const wasDrawn = draw("n", before);

    forgeStore.refresh();
    const after = forgeStore.getSnapshot().forge;

    expect(after).not.toBe(before);
    expect(after.style).toEqual(before.style);
    // A different thing to remember against, so the letter is drawn again --
    // and drawn the same, because nothing about the font changed.
    expect(draw("n", after)).not.toBe(wasDrawn);
    expect(draw("n", after)).toEqual(wasDrawn);
    expect(forgeStore.getSnapshot().settled).toBe(after);
  });
});

/*
 * What one thing to undo means, which is the same question the other two
 * document stores answer and answered differently.
 *
 * A drag is a run of edits and one gesture, so the run folds into one entry --
 * fifty of them for one pull of a slider is not a history anybody wants. The
 * awkward case is what happens to an edit that is *not* part of the drag while
 * one is open, and this store used to fold that in too.
 */
describe("what counts as one thing to undo", () => {
  it("folds a drag into a single entry", () => {
    const before = forgeStore.getSnapshot().forge;
    const weight = before.style.pen.weight;
    forgeStore.changePen({ weight: weight + 10 }, "during");
    forgeStore.changePen({ weight: weight + 20 }, "during");
    forgeStore.changePen({ weight: weight + 30 }, "end");

    forgeStore.undo();
    expect(forgeStore.getSnapshot().forge).toBe(before);
  });

  /*
   * A click on one control while another is still being dragged. Folded in, it
   * could not be taken back on its own: one undo took the click and the drag
   * together, and the letter jumped further than the person had asked for.
   */
  it("gives a finished edit its own entry even mid-drag", () => {
    const weight = forgeStore.getSnapshot().forge.style.pen.weight;
    const xHeight = forgeStore.getSnapshot().forge.style.metrics.xHeight;

    forgeStore.changePen({ weight: weight + 40 }, "during");
    forgeStore.changeMetrics({ xHeight: xHeight - 40 }, "single");

    forgeStore.undo();
    expect(forgeStore.getSnapshot().forge.style.metrics.xHeight, "the click goes back").toBe(
      xHeight,
    );
    expect(
      forgeStore.getSnapshot().forge.style.pen.weight,
      "and the drag is left where it was",
    ).toBe(weight + 40);
  });

  /*
   * Undo is somebody stepping outside a gesture, and the step they took back
   * may well be the gesture itself, so `stopMoving` closes it. Left open, the
   * next edit would fold into an entry that had already been undone.
   */
  it("closes a drag that was undone in the middle of it", () => {
    const weight = forgeStore.getSnapshot().forge.style.pen.weight;
    forgeStore.changePen({ weight: weight + 10 }, "single");
    const after = forgeStore.getSnapshot().forge.style.pen.weight;

    forgeStore.changeMetrics({ xHeight: 480 }, "during");
    forgeStore.undo();

    forgeStore.changePen({ weight: 200 }, "single");
    forgeStore.undo();
    expect(forgeStore.getSnapshot().forge.style.pen.weight, "one step back, not two").toBe(after);
  });
});
