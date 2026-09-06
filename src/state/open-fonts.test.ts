/**
 * Several fonts open at once: what travels with one and what stays behind.
 *
 * The whole feature is one swap, and a swap has exactly two ways to be wrong.
 * It can leave something behind that should have travelled -- you come back to
 * a font and your selection is another font's -- or it can carry something
 * that should have stayed, so the tool in your hand changes when you switch
 * tabs. Both are quiet: nothing throws, and the symptom turns up minutes later
 * somewhere else.
 *
 * So each test here changes something in one font, goes to another, comes
 * back, and asks whether it is still true. That is the only shape of test that
 * catches either fault.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyTypeface, type Glyph, type Typeface } from "@/font/types";

/** A font with a family name, so the tabs can be told apart. */
function fontCalled(name: string): Typeface {
  const typeface = emptyTypeface();
  typeface.meta = { ...typeface.meta, familyName: name };
  /*
   * One real letter, because `editGlyph` returns without recording anything
   * for a name the font does not have -- so a font of no glyphs would make the
   * history test below pass by having no history to keep apart.
   */
  const a: Glyph = {
    name: "a",
    unicodes: [0x61],
    advanceWidth: 500,
    contours: [],
    components: [],
    anchors: [],
    params: {},
    dirty: false,
  };
  typeface.glyphs = [a];
  typeface.glyphIndex = new Map([["a", 0]]);
  return typeface;
}

/*
 * A store per test, imported afresh.
 *
 * Every test here counts tabs from the left, so they all need a desk with
 * nothing on it to count from -- and there is no way back to nothing once a
 * font is open, which is deliberate (an application with no document is a
 * screen with nothing on it) and inconvenient exactly here. Re-importing the
 * module is the only honest way to have one, and it costs a few milliseconds.
 */
type Store = typeof import("./store")["store"];
let store: Store;

beforeEach(async () => {
  vi.resetModules();
  store = (await import("./store")).store;
});

const tabs = (): string[] => store.getSnapshot().open.map((one) => one.name);
const inFront = (): number => store.getSnapshot().openAt;

describe("opening fonts", () => {
  it("puts the first on the desk rather than in a second tab", () => {
    /*
     * A tab for the first font would leave an empty Untitled beside it, and
     * the last tab never closes -- so it would be a tab nobody wants and
     * nobody can get rid of.
     */
    expect(store.getSnapshot().typeface).toBeNull();

    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    expect(tabs()).toEqual(["Bakerloo"]);
    expect(inFront()).toBe(0);
  });

  it("opens the next one beside it rather than over it", () => {
    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    store.adopt(fontCalled("Metro"), "metro.ttf");
    expect(tabs()).toEqual(["Bakerloo", "Metro"]);
    expect(inFront()).toBe(1);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Metro");
  });

  it("gives a blank one a tab of its own as well", () => {
    // `startBlank` is the other way a document arrives, and a new one should
    // no more close the font you are working on than an opened one does.
    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    store.startBlank();
    expect(tabs()).toEqual(["Bakerloo", "Untitled"]);
    expect(inFront()).toBe(1);
  });
});

describe("switching between them", () => {
  beforeEach(() => {
    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    store.adopt(fontCalled("Metro"), "metro.ttf");
  });

  it("brings back the font that was put aside, whole", () => {
    store.goToDocument(0);
    expect(inFront()).toBe(0);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Bakerloo");
    expect(store.getSnapshot().fileName).toBe("bakerloo.ttf");

    store.goToDocument(1);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Metro");
    expect(store.getSnapshot().fileName).toBe("metro.ttf");
  });

  it("keeps each font's selection to itself", () => {
    // The fault somebody notices first, and the one that looks like the tool
    // is broken rather than like the swap is.
    store.setSelectedNodes(["0:1", "0:2"]);
    store.goToDocument(0);
    expect([...store.getSnapshot().selectedNodes]).toEqual([]);

    store.setSelectedNodes(["0:9"]);
    store.goToDocument(1);
    expect([...store.getSnapshot().selectedNodes]).toEqual(["0:1", "0:2"]);
    store.goToDocument(0);
    expect([...store.getSnapshot().selectedNodes]).toEqual(["0:9"]);
  });

  it("keeps each font's view to itself", () => {
    // Coming back to a font you were kerning ought to put you back in the
    // kerning table: which screen you were on is part of where you were.
    store.setView("kerning");
    store.goToDocument(0);
    store.setView("metrics");
    expect(store.getSnapshot().view).toBe("metrics");
    store.goToDocument(1);
    expect(store.getSnapshot().view).toBe("kerning");
  });

  it("keeps each font's history to itself", () => {
    /*
     * The one that would be worst if it were wrong: a shared stack means
     * Cmd-Z in one font takes back an edit made in another, and the letter it
     * changed is not even on screen.
     */
    store.goToDocument(0);
    expect(store.getSnapshot().canUndo).toBe(false);

    store.editGlyph("a", "Widen the letter", (glyph) => {
      glyph.advanceWidth = 600;
    });
    expect(store.getSnapshot().canUndo, "the edit should be undoable at all").toBe(true);

    store.goToDocument(1);
    expect(store.getSnapshot().canUndo, "the other font should have its own history").toBe(false);
    store.goToDocument(0);
    expect(store.getSnapshot().canUndo).toBe(true);
    expect(store.getSnapshot().undoLabel).toBe("Widen the letter");

    // And it still undoes the right font's edit when it comes back.
    store.undo();
    expect(store.getSnapshot().typeface?.glyphs[0].advanceWidth).toBe(500);
  });

  it("leaves the tool in your hand where it was", () => {
    // Shared, because a tool that changed when you switched font would be a
    // tool changing when you were not looking.
    store.setTool("knife");
    store.goToDocument(0);
    expect(store.getSnapshot().tool).toBe("knife");
    store.goToDocument(1);
    expect(store.getSnapshot().tool).toBe("knife");
  });

  it("leaves snapping and the ground alone too", () => {
    store.setSnapping(false);
    store.setGround("light");
    store.goToDocument(0);
    expect(store.getSnapshot().snapping).toBe(false);
    expect(store.getSnapshot().ground).toBe("light");
  });

  it("does nothing at all when asked for the one already in front", () => {
    const was = store.getSnapshot();
    store.goToDocument(inFront());
    expect(store.getSnapshot().typeface).toBe(was.typeface);
    expect(tabs()).toEqual(["Bakerloo", "Metro"]);
  });

  it("does nothing at all when asked for one that is not there", () => {
    store.goToDocument(9);
    expect(inFront()).toBe(1);
    store.goToDocument(-1);
    expect(inFront()).toBe(1);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Metro");
  });

  it("keeps the tabs in the order they were opened, however you move", () => {
    // Taken out of the drawer and put back in the same place, so wandering
    // between three tabs does not shuffle them.
    store.adopt(fontCalled("Gill"), "gill.ttf");
    expect(tabs()).toEqual(["Bakerloo", "Metro", "Gill"]);
    store.goToDocument(0);
    expect(tabs()).toEqual(["Bakerloo", "Metro", "Gill"]);
    store.goToDocument(2);
    expect(tabs()).toEqual(["Bakerloo", "Metro", "Gill"]);
    store.goToDocument(1);
    expect(tabs()).toEqual(["Bakerloo", "Metro", "Gill"]);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Metro");
  });
});

describe("closing them", () => {
  beforeEach(() => {
    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    store.adopt(fontCalled("Metro"), "metro.ttf");
    store.adopt(fontCalled("Gill"), "gill.ttf");
  });

  it("takes away one that is not in front, and stays where you are", () => {
    expect(store.closeDocument(0)).toBe(true);
    expect(tabs()).toEqual(["Metro", "Gill"]);
    expect(store.getSnapshot().typeface?.meta.familyName, "you should not have moved").toBe("Gill");
    expect(inFront()).toBe(1);
  });

  it("brings the next one forward when the one in front goes", () => {
    store.goToDocument(1);
    expect(store.closeDocument(1)).toBe(true);
    expect(tabs()).toEqual(["Bakerloo", "Gill"]);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Gill");
  });

  it("brings the one to the left forward when the last goes", () => {
    store.goToDocument(2);
    expect(store.closeDocument(2)).toBe(true);
    expect(tabs()).toEqual(["Bakerloo", "Metro"]);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Metro");
  });

  it("never closes the last one", () => {
    /*
     * An application with no document is a screen with nothing on it, and the
     * way back is a menu -- which is a lot to ask of somebody who meant to
     * shut a tab.
     */
    expect(store.closeDocument(2)).toBe(true);
    expect(store.closeDocument(1)).toBe(true);
    expect(store.closeDocument(0)).toBe(false);
    expect(tabs()).toHaveLength(1);
    expect(store.getSnapshot().typeface).not.toBeNull();
  });

  it("forgets the history of a font that has gone", () => {
    // Kept, it would be handed to whatever font later takes that id, and undo
    // would offer to take back an edit made in a font nobody has open.
    store.goToDocument(0);
    store.editGlyph("a", "Widen the letter", (glyph) => {
      glyph.advanceWidth = 600;
    });
    store.goToDocument(2);
    expect(store.closeDocument(0)).toBe(true);
    store.adopt(fontCalled("New"), "new.ttf");
    expect(store.getSnapshot().canUndo).toBe(false);
  });
});
