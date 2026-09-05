/**
 * The state of a font read back as strokes.
 *
 * The recovery itself -- outlines in, centre-lines out -- is `src/quill/`'s
 * business and is checked there and in `test/trace.integration.test.ts`. What
 * is left for this file is what the store does around it: what survives being
 * saved and reopened, what deliberately does not, and what one keystroke of
 * undo is worth.
 *
 * The round trip is the part with the most to lose. `snapshot` writes a traced
 * letter out field by field, and its own comment says why that is worth
 * watching: a field it enumerates is a field it can lose, and a drawing left
 * behind would look like the drawing had never been made rather than like a
 * bug.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { Contour } from "@/font/types";
import { PLAIN_HAND } from "@/quill/controls";
import type { Traced } from "@/quill/tracing";
import { quillStore as store } from "./quill-store";

const state = () => store.getSnapshot();

const outline = (): Contour[] => [{ closed: true, nodes: [] }];

/** A traced letter, as the recovery hands one over. */
function traced(name: string, over: Partial<Traced> = {}): Traced {
  return {
    glyph: {
      name,
      advanceWidth: 500,
      strokes: [{ spine: { segments: [], closed: false } }],
      unitsPerEm: 1000,
    } as unknown as Traced["glyph"],
    deviation: 0.25,
    source: outline(),
    ...over,
  };
}

/*
 * A document in the store, the way reading a font puts one there.
 *
 * The hand starts plain rather than carrying over whatever the last test left,
 * because this is the one store there is and a setting that leaks between tests
 * is a test that passes for a reason it does not name.
 */
function load(letters: Traced[], over: Record<string, unknown> = {}): void {
  store.restore({
    letters,
    style: { ...PLAIN_HAND },
    from: "DejaVu Sans",
    name: "My Traced Font",
    unitsPerEm: 1000,
    ...over,
  } as never);
}

describe("what is worth keeping", () => {
  beforeEach(() => load([]));

  /*
   * Nothing traced is not an empty traced half, it is no traced half -- which
   * is what keeps a saved file from claiming one nobody opened.
   */
  it("has nothing to keep when nothing has been read", () => {
    expect(store.snapshot()).toBeUndefined();
  });

  it("keeps every field of every letter through a save and a reopen", () => {
    load([traced("a"), traced("b", { byHand: { contours: outline(), advanceWidth: 620 } })], {
      unitsPerEm: 2048,
      name: "Bakerloo Traced",
      from: "Bakerloo",
    });
    store.changeStyle({ bounce: 0.4 }, "single");

    const kept = store.snapshot()!;
    load([]);
    expect(state().document.letters).toHaveLength(0);
    store.restoreSaved(kept);

    const back = state().document;
    expect(back.from).toBe("Bakerloo");
    expect(back.name).toBe("Bakerloo Traced");
    expect(back.unitsPerEm).toBe(2048);
    expect(back.style.bounce).toBe(0.4);
    expect(back.letters.map((one) => one.glyph.name)).toEqual(["a", "b"]);
    expect(back.letters[0].deviation).toBe(0.25);
    expect(back.letters[0].glyph.strokes).toHaveLength(1);
  });

  /*
   * The drawing is the field the comment above `snapshot` is about. Left out,
   * it would be gone the moment somebody saved, and would look like the drawing
   * had never been made.
   */
  it("keeps a letter that was drawn by hand, and what it was drawn as", () => {
    load([traced("b", { byHand: { contours: outline(), advanceWidth: 620 } })]);
    const kept = store.snapshot()!;
    load([]);
    store.restoreSaved(kept);

    expect(store.drawnByHand("b")).toBe(true);
    expect(state().document.letters[0].byHand?.advanceWidth).toBe(620);
  });

  /*
   * And what is deliberately not kept. The source outlines are somebody else's
   * font, and writing them into a document that gets sent on would be carrying
   * a copy of that font around inside a file that is not it. The work survives,
   * the copy does not -- so a reopened letter has its strokes and no ghost
   * behind them until the font is read again.
   */
  it("does not carry the outlines it was read from", () => {
    load([traced("a")]);
    expect(state().document.letters[0].source).toHaveLength(1);

    const kept = store.snapshot()!;
    load([]);
    store.restoreSaved(kept);
    expect(state().document.letters[0].source).toEqual([]);
  });
});

describe("putting a document back", () => {
  beforeEach(() => load([]));

  /*
   * Not undoable, and for the same reason reading a font in is not: what it
   * replaces is the whole document, and offering to step back into the letters
   * of a different font would be offering a state nobody was ever in.
   *
   * The other two halves keep their history across a restore on purpose, so
   * this is a difference between them rather than an oversight in one.
   */
  it("throws the history away, because what it replaces is everything", () => {
    load([traced("a")]);
    store.changeStyle({ bounce: 0.4 }, "single");
    expect(state().canUndo).toBe(true);

    load([traced("z")]);
    expect(state().canUndo).toBe(false);

    /*
     * Asked of the stack rather than of the flag.
     *
     * `restore` sets `canUndo` to false whether or not it emptied the stack, so
     * a test that read the flag would pass with the emptying taken out -- and
     * this one did, until a change to the store that should have broken it did
     * not. What the promise is worth is whether undo moves anything.
     */
    const put = state().document;
    store.undo();
    expect(state().document, "there is nothing behind a restore").toBe(put);
  });

  it("opens on a letter the document has", () => {
    load([traced("a"), traced("b")]);
    expect(state().letter).toBe("a");
  });
});

describe("a letter taken to the point tools", () => {
  beforeEach(() => load([traced("a"), traced("b")]));

  /*
   * The one edit that puts an outline where a description was, so finding out
   * you would rather have kept the strokes should cost one keystroke.
   */
  it("comes back in one undo", () => {
    store.takeLetter("a", outline(), 620);
    expect(store.drawnByHand("a")).toBe(true);

    store.undo();
    expect(store.drawnByHand("a")).toBe(false);
    store.redo();
    expect(store.drawnByHand("a")).toBe(true);
  });

  it("opens the letter it was taken from", () => {
    store.setLetter("b");
    store.takeLetter("a", outline(), 620);
    expect(state().letter).toBe("a");
  });

  it("goes back under the hand when it is asked to", () => {
    store.takeLetter("a", outline(), 620);
    store.redrawLetter("a");
    expect(store.drawnByHand("a")).toBe(false);
    expect(state().document.letters[0].glyph.strokes, "its strokes were waiting").toHaveLength(1);
  });

  it("leaves the other letters alone", () => {
    store.takeLetter("a", outline(), 620);
    expect(store.drawnByHand("b")).toBe(false);
  });

  it("says nothing about a letter the document does not have", () => {
    expect(store.drawnByHand("nowhere")).toBe(false);
    expect(store.letterAsGlyph("nowhere")).toBeNull();
    expect(() => store.redrawLetter("nowhere")).not.toThrow();
  });
});

describe("the hand laid over every letter", () => {
  beforeEach(() => load([traced("a")]));

  it("reaches the whole document at once, and can be put back", () => {
    store.changeStyle({ bounce: 0.5 }, "single");
    expect(state().document.style.bounce).toBe(0.5);

    // Back where it started, which is the plain hand rather than whatever it
    // happened to be a moment ago.
    store.resetStyle();
    expect(state().document.style).toEqual(PLAIN_HAND);
  });

  it("leaves the strokes alone when the hand goes back to plain", () => {
    store.changeStyle({ bounce: 0.5 }, "single");
    store.resetStyle();
    expect(state().document.letters[0].glyph.strokes).toHaveLength(1);
  });

  // Nothing changed is nothing to undo. Typing the name it already has and
  // finding an entry on the history is an entry that means nothing.
  it("records nothing for a name that is already the name", () => {
    store.setName("Chosen");
    const document = state().document;
    store.setName("Chosen");
    expect(state().document).toBe(document);
  });

  it("records a name that is genuinely new", () => {
    store.setName("Chosen");
    store.undo();
    expect(state().document.name).not.toBe("Chosen");
  });
});

describe("giving up on a read", () => {
  beforeEach(() => load([traced("a")]));

  // Nothing is being read, so there is nothing to stop -- and no history entry
  // for a button that did nothing.
  it("does nothing when nothing is being read", () => {
    const document = state().document;
    expect(() => store.stopTracing()).not.toThrow();
    expect(state().document).toBe(document);
    expect(state().progress).toBeNull();
  });

  it("clears what a failed read had to say when asked", () => {
    store.clearTrouble();
    expect(state().trouble).toBeNull();
  });
});
