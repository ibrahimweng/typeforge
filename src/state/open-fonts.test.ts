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

import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { toProject } from "@/project/format";
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

describe("putting them in another order", () => {
  beforeEach(() => {
    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    store.adopt(fontCalled("Metro"), "metro.ttf");
    store.adopt(fontCalled("Gill"), "gill.ttf");
  });

  it("moves one along, and leaves you standing in the same font", () => {
    // Where you are is a font, not a place in a row. Moving a tab about must
    // not change which one you are working on.
    store.goToDocument(1);
    store.moveDocument(0, 2);
    expect(tabs()).toEqual(["Metro", "Gill", "Bakerloo"]);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Metro");
    expect(inFront()).toBe(0);
  });

  it("moves the one in front, and you go with it", () => {
    /*
     * The case every in-place version of this gets wrong. The font in front is
     * the live state rather than an entry in the list, so its position is a
     * number kept beside the list -- and moving it has to move that number
     * without disturbing the order of everything else.
     */
    store.goToDocument(2);
    store.moveDocument(2, 0);
    expect(tabs()).toEqual(["Gill", "Bakerloo", "Metro"]);
    expect(inFront()).toBe(0);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Gill");
  });

  it("moves one from either side of the one in front", () => {
    // Past the front font from the left, and back from the right. The two
    // directions are where an index kept beside a list goes wrong one way and
    // looks right the other.
    store.goToDocument(1);
    store.moveDocument(2, 0);
    expect(tabs()).toEqual(["Gill", "Bakerloo", "Metro"]);
    expect(inFront()).toBe(2);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Metro");

    store.moveDocument(0, 2);
    expect(tabs()).toEqual(["Bakerloo", "Metro", "Gill"]);
    expect(inFront()).toBe(1);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Metro");
  });

  it("does nothing when asked to put one where it already is, or nowhere", () => {
    store.moveDocument(1, 1);
    expect(tabs()).toEqual(["Bakerloo", "Metro", "Gill"]);
    store.moveDocument(0, 9);
    expect(tabs()).toEqual(["Bakerloo", "Metro", "Gill"]);
    store.moveDocument(-1, 0);
    expect(tabs()).toEqual(["Bakerloo", "Metro", "Gill"]);
    expect(inFront()).toBe(2);
  });

  it("keeps what belongs to each font with it", () => {
    // The order is a fact about the strip, not about any of the fonts in it.
    store.goToDocument(0);
    store.setSelectedNodes(["0:7"]);
    store.moveDocument(0, 2);
    expect(tabs()).toEqual(["Metro", "Gill", "Bakerloo"]);
    expect([...store.getSnapshot().selectedNodes]).toEqual(["0:7"]);
    store.goToDocument(0);
    expect([...store.getSnapshot().selectedNodes]).toEqual([]);
    store.goToDocument(2);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Bakerloo");
    expect([...store.getSnapshot().selectedNodes]).toEqual(["0:7"]);
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

  it("gives back the font that was closed, with its history", () => {
    /*
     * The cross is small, permanent and beside the name of a font somebody has
     * spent an afternoon on, and the session is written down straight
     * afterwards -- so without this a misclick and a reload were the whole of
     * it. Everything else here can be taken back.
     */
    store.goToDocument(0);
    store.editGlyph("a", "Widen the letter", (glyph) => {
      glyph.advanceWidth = 600;
    });
    store.goToDocument(2);
    expect(store.closeDocument(0)).toBe(true);
    expect(tabs()).toEqual(["Metro", "Gill"]);
    expect(store.getSnapshot().reopenable).toBe("Bakerloo");

    expect(store.reopenDocument()).toBe(true);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Bakerloo");
    expect(store.getSnapshot().canUndo, "and what was done in it").toBe(true);
    expect(store.getSnapshot().undoLabel).toBe("Widen the letter");
    // Nothing left to come back to, so nothing offers to.
    expect(store.getSnapshot().reopenable).toBeNull();
  });

  it("gives back the one that was in front when it was closed, history and all", () => {
    /*
     * The other way a tab goes: the one you are looking at. Closing that has
     * to bring a neighbour forward first, so the going font's history is put
     * away a step before it is remembered -- which is a step at which it can
     * be dropped instead, leaving a font that comes back with a live Undo
     * button and an empty stack behind it.
     */
    store.goToDocument(1);
    store.editGlyph("a", "Widen the letter", (glyph) => {
      glyph.advanceWidth = 600;
    });
    expect(store.closeDocument(1)).toBe(true);
    expect(tabs()).toEqual(["Bakerloo", "Gill"]);

    expect(store.reopenDocument()).toBe(true);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Metro");
    expect(store.getSnapshot().canUndo).toBe(true);
    expect(store.getSnapshot().undoLabel).toBe("Widen the letter");
    store.undo();
    expect(store.getSnapshot().typeface?.glyphs[0].advanceWidth).toBe(500);
  });

  it("offers the one closed most recently, and says so only when there is one", () => {
    expect(store.getSnapshot().reopenable).toBeNull();
    store.closeDocument(0);
    expect(store.getSnapshot().reopenable).toBe("Bakerloo");
    store.closeDocument(0);
    expect(store.getSnapshot().reopenable).toBe("Metro");
    store.reopenDocument();
    expect(store.getSnapshot().reopenable).toBe("Bakerloo");
    store.reopenDocument();
    expect(store.getSnapshot().reopenable).toBeNull();
    expect(store.reopenDocument(), "and there is nothing else to give back").toBe(false);
  });

  it("puts the one that comes back in front, beside the rest", () => {
    store.closeDocument(0);
    expect(tabs()).toEqual(["Metro", "Gill"]);
    store.reopenDocument();
    // Beside them rather than back where it was: a tab strip is the order
    // things were opened in, and this one has just been opened.
    expect(tabs()).toEqual(["Metro", "Gill", "Bakerloo"]);
    expect(inFront()).toBe(2);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Bakerloo");
  });

  it("does not hand a closed font's history to the next font opened", () => {
    /*
     * The history goes with the font rather than with the slot it was in. It
     * is kept while the font can still be reopened -- but a *new* font must
     * not arrive able to undo an edit made in one nobody has open, which is
     * what would happen if a stack were left behind under an id that came
     * round again.
     */
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

/*
 * The four doors a font comes in by, tested through the doors themselves.
 *
 * The tests above all use `adopt`, which is the door a generator uses. It is
 * *not* the one anybody opening a file goes through -- that is `loadFont` --
 * and when this feature was first wired only two of the four had been thought
 * about. A test that only ever knocks on one door would have said the feature
 * worked while the ordinary way in still replaced whatever was open.
 *
 * The font is the sample the application ships with, read off disk rather than
 * fetched, because a real file is the only way to exercise a door whose first
 * act is to parse one.
 */
const SAMPLE = new Uint8Array(
  readFileSync(new URL("../assets/typeforge-sample.ttf", import.meta.url)),
);

describe("the doors a font comes in by", () => {
  it("opens a file beside what is already there", async () => {
    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    await store.loadFont(SAMPLE, "sample.ttf");
    expect(tabs()).toHaveLength(2);
    expect(inFront()).toBe(1);
    store.goToDocument(0);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Bakerloo");
  });

  it("leaves the desk alone when the file will not open", async () => {
    /*
     * Which is why the room is made after the parse and not before it. Made
     * first, a file that turns out not to be a font would still have put the
     * work in a tab and left somebody on a blank document with an error on
     * it -- nothing lost, but nowhere they asked to be, over a file that never
     * opened.
     */
    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    await store.loadFont(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "notafont.ttf");
    expect(tabs()).toEqual(["Bakerloo"]);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Bakerloo");
    expect(store.getSnapshot().status?.tone).toBe("error");
  });

  it("does not carry the last font's guides onto the new one", async () => {
    /*
     * The reason a new document starts from a written-down blank rather than
     * from whatever the last one left on the desk. `adopt` clears the guides by
     * hand and `loadFont` does not, so this passes through the door that
     * forgets -- and guides are kept in font units, so the ones drawn against a
     * two-thousand-unit face arrive over a thousand-unit one meaning something
     * else entirely.
     */
    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    store.addGuide(500, "y");
    await store.loadFont(SAMPLE, "sample.ttf");
    expect(store.getSnapshot().guides).toEqual([]);
    store.goToDocument(0);
    expect(store.getSnapshot().guides, "and they are still the first font's").toHaveLength(1);
  });

  it("gives a blank font a tab as an opened one gets", () => {
    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    store.startBlank();
    expect(tabs()).toEqual(["Bakerloo", "Untitled"]);
  });

  it("writes every open font down and gives them all back", async () => {
    /*
     * The round trip, through the real store rather than through a snapshot
     * somebody wrote by hand. Without this the session keeps only the font in
     * front, and opening a second one then reloading loses the first -- work
     * that was on screen a second earlier, gone with nothing said.
     */
    await store.loadFont(SAMPLE, "one.ttf");
    await store.loadFont(SAMPLE, "two.ttf");
    store.goToDocument(0);
    const kept = toProject(
      { mode: "edit", edits: store.snapshots(), editAt: inFront() },
      new Date(),
    );
    expect(kept.edits).toHaveLength(2);

    // A different desk entirely, so what comes back has to have come from the
    // document rather than from what happened to still be lying about.
    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    store.adopt(fontCalled("Metro"), "metro.ttf");

    await store.restoreAll(kept.edits!, kept.editAt ?? 0);
    expect(tabs()).toHaveLength(2);
    expect(store.getSnapshot().fileName, "and standing where it was left").toBe("one.ttf");
    store.goToDocument(1);
    expect(store.getSnapshot().fileName).toBe("two.ttf");
  });

  it("writes down a font that never came from a file, and gives it back whole", async () => {
    /*
     * The one that used to be dropped in silence. A font started blank here
     * carries no bytes to lay its edits back over, so the whole half was
     * skipped -- draw in a new font, reload, and there was nothing there. The
     * same went for a letter taken to the tools from Draw and then edited:
     * the drawing came back and the point edits did not.
     */
    store.startBlank();
    store.editGlyph(".notdef", "Widen the letter", (glyph) => {
      glyph.advanceWidth = 613;
    });
    store.setMeta({ familyName: "Drawn Here" });

    const kept = toProject(
      { mode: "edit", edits: store.snapshots(), editAt: inFront() },
      new Date(),
    );
    expect(kept.edits, "a font with no file is still a font").toHaveLength(1);
    expect(kept.edits![0].font, "and has no file to point at").toBeUndefined();

    // A different desk, so what comes back has to have come from the document.
    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    await store.restoreAll(kept.edits!, kept.editAt ?? 0);

    const back = store.getSnapshot().typeface;
    expect(back?.meta.familyName).toBe("Drawn Here");
    expect(back?.glyphs.map((one) => one.name)).toEqual([".notdef"]);
    expect(back?.glyphs[0].advanceWidth, "the edit came back with it").toBe(613);
    expect(back?.source, "and it still has no file behind it").toBeNull();
  });

  it("gives back a font made here at the size it was made at", async () => {
    // A blank font is a thousand units and an assembled one is whatever its
    // drawings were measured against. Restored at the wrong size, every letter
    // in it is the wrong size.
    const wide = fontCalled("Wide");
    wide.unitsPerEm = 2048;
    store.adopt(wide, "");
    expect(store.getSnapshot().typeface?.source).toBeNull();

    const kept = toProject(
      { mode: "edit", edits: store.snapshots(), editAt: inFront() },
      new Date(),
    );
    await store.restoreAll(kept.edits!, kept.editAt ?? 0);
    expect(store.getSnapshot().typeface?.unitsPerEm).toBe(2048);
  });

  it("brings back a file-backed font and a made-here one side by side", async () => {
    // The two shapes in one document, because a desk holds both and the
    // reader has to tell them apart by what each one carries.
    await store.loadFont(SAMPLE, "sample.ttf");
    store.startBlank();
    store.setMeta({ familyName: "Beside It" });
    expect(tabs()).toEqual(["Typeforge Sample", "Beside It"]);

    const kept = toProject(
      { mode: "edit", edits: store.snapshots(), editAt: inFront() },
      new Date(),
    );
    expect(kept.edits).toHaveLength(2);
    expect(kept.edits![0].font, "opened from a file").toBeDefined();
    expect(kept.edits![1].font, "made here").toBeUndefined();

    await store.restoreAll(kept.edits!, kept.editAt ?? 0);
    expect(tabs()).toEqual(["Typeforge Sample", "Beside It"]);
    expect(store.getSnapshot().typeface?.meta.familyName).toBe("Beside It");
    store.goToDocument(0);
    expect(store.getSnapshot().typeface?.source, "still read from its file").not.toBeNull();
  });

  it("puts a saved project back over the desk rather than beside it", async () => {
    /*
     * The one door that replaces. A project is the whole session coming back --
     * which mode you were in, the drawing, the tracing -- so opening one beside
     * your work would restore half a session next to the other half.
     */
    await store.loadFont(SAMPLE, "sample.ttf");
    const kept = toProject(
      { mode: "edit", edits: store.snapshots(), editAt: inFront() },
      new Date(),
    );
    expect(kept.edits, "the sample should be saveable at all").toHaveLength(1);

    store.adopt(fontCalled("Bakerloo"), "bakerloo.ttf");
    expect(tabs()).toHaveLength(2);

    await store.restoreAll(kept.edits!, kept.editAt ?? 0);
    expect(tabs()).toHaveLength(1);
    expect(store.getSnapshot().fileName).toBe("sample.ttf");
  });
});
