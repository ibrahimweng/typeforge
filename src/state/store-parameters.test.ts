/**
 * Parameters, cuts and casts, and which of them a letter can have its own of.
 *
 * Two different rules live in one file and the difference is the point. A
 * parameter is a number, so a letter's own value layers over the family's and
 * either can be set without thinking about the other. A cut is a set of
 * switched-on operations, and half the font's merged with half a letter's is
 * not a description anybody wrote -- so a letter either goes along with the
 * font or is cut its own way, whole.
 *
 * What is checked here is mostly the second rule, because it is the one with
 * consequences that are not obvious: what a letter keeps at the moment it
 * diverges, and what it stops following afterwards.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { emptyTypeface, type Glyph } from "@/font/types";
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

const family = () => store.getSnapshot().typeface!.params;
const undoLabel = () => store.getSnapshot().undoLabel ?? null;

describe("a parameter the whole family follows", () => {
  beforeEach(() => seed(["a", "b"]));

  /*
   * Setting and recording are separate on purpose. A drag is a run of settings
   * and one gesture, and fifty entries for one pull of a slider is not a
   * history anybody wants.
   */
  it("sets without putting anything on the history", () => {
    store.setFamilyParam("weight", 40);
    expect(family().weight).toBe(40);
    expect(undoLabel()).toBeNull();
  });

  it("records the whole gesture as one entry when it is told the gesture ended", () => {
    const before = { ...family() };
    store.setFamilyParam("weight", 10);
    store.setFamilyParam("weight", 25);
    store.setFamilyParam("weight", 40);
    store.commitFamilyParams("Set weight", before);

    expect(undoLabel()).toBe("Set weight");
    store.undo();
    expect(family().weight).toBe(before.weight);
    store.redo();
    expect(family().weight).toBe(40);
  });
});

describe("a letter with a parameter of its own", () => {
  beforeEach(() => seed(["a", "b"]));

  /*
   * An override is a change to the letter as surely as dragging a point is,
   * and two things downstream ask this rather than looking at the outline. A
   * "preserve" export writes the original bytes for any glyph nobody has
   * touched, so an override that did not say so was dropped from the file --
   * the one place it would never be noticed, since the letter is right on
   * screen the whole time.
   */
  it("marks the letter as touched, which is what keeps it in an export", () => {
    expect(store.glyph("a")!.dirty).toBe(false);
    store.setGlyphParam("a", "weight", 90);
    expect(store.glyph("a")!.params.weight).toBe(90);
    expect(store.glyph("a")!.dirty).toBe(true);
  });

  it("leaves every other letter following the family", () => {
    store.setFamilyParam("weight", 40);
    store.setGlyphParam("a", "weight", 90);
    expect(store.glyph("b")!.params.weight).toBeUndefined();
    expect(family().weight).toBe(40);
  });

  /*
   * The one this file was written for.
   *
   * `setGlyphParam` puts nothing on the history by itself, and nothing ever
   * told it a gesture had ended -- so an override could not be taken back. That
   * is the small half of it. The large half is what undo did instead: it took
   * the next entry down, which belonged to whatever came before, so pressing
   * undo after setting an override took back a change to the whole family and
   * left the override sitting there.
   */
  it("can be taken back, and takes back itself rather than what came before", () => {
    const wasFamily = { ...family() };
    store.setFamilyParam("weight", 40);
    store.commitFamilyParams("Set weight", wasFamily);

    const wasOwn = { ...store.glyph("a")!.params };
    store.setGlyphParam("a", "weight", 90);
    store.commitGlyphParams("a", "Set weight", wasOwn);

    store.undo();
    expect(store.glyph("a")!.params.weight, "the override goes first").toBeUndefined();
    expect(family().weight, "and the family is left alone").toBe(40);

    store.undo();
    expect(family().weight, "the family change is the next one down").toBe(wasFamily.weight);

    store.redo();
    expect(family().weight).toBe(40);
    store.redo();
    expect(store.glyph("a")!.params.weight).toBe(90);
  });

  it("records nothing for a gesture that ended where it started", () => {
    const before = { ...store.glyph("a")!.params };
    store.setGlyphParam("a", "weight", 90);
    store.clearGlyphParam("a", "weight");
    const after = undoLabel();
    store.commitGlyphParams("a", "Set weight", before);
    expect(undoLabel()).toBe(after);
  });

  // Going back to the family's value is a decision too, and the letter has to
  // be rebuilt to show it.
  it("is reset by name, which is itself undoable and still counts as touched", () => {
    store.setGlyphParam("a", "weight", 90);
    store.glyph("a")!.dirty = false;

    store.clearGlyphParam("a", "weight");
    expect(store.glyph("a")!.params.weight).toBeUndefined();
    expect(store.glyph("a")!.dirty).toBe(true);
    expect(undoLabel()).toBe("Reset weight");

    store.undo();
    expect(store.glyph("a")!.params.weight).toBe(90);
  });

  it("says nothing about a letter the font does not have", () => {
    expect(() => store.setGlyphParam("nowhere", "weight", 90)).not.toThrow();
    expect(() => store.clearGlyphParam("nowhere", "weight")).not.toThrow();
  });
});

describe("a letter cut its own way", () => {
  beforeEach(() => seed(["a", "b"]));

  it("follows the font until it is given something of its own", () => {
    store.changeCut("slot", { on: true, count: 5 });
    expect(store.isCutException("a")).toBe(false);
    expect(store.cutsFor("a").slot.count).toBe(5);
    expect(store.cutsFor("b").slot.count).toBe(5);
  });

  /*
   * Starting from the font's, so the first change to one operation keeps the
   * rest of what the letter was already showing rather than clearing it. A
   * letter that lost the font's slot the moment somebody touched its teeth
   * would be a letter nobody meant to change.
   */
  it("keeps what it was already showing at the moment it diverges", () => {
    store.changeCut("slot", { on: true, count: 5 });
    store.changeGlyphCut("a", "tooth", { on: true });

    expect(store.isCutException("a")).toBe(true);
    expect(store.cutsFor("a").slot, "the font's slot came across").toMatchObject({
      on: true,
      count: 5,
    });
    expect(store.cutsFor("a").tooth.on).toBe(true);
    expect(store.cutHeldBy("a", "tooth"), "the teeth are its own").toBe(true);
    expect(store.cutHeldBy("a", "slot"), "the slot still agrees with the font").toBe(false);
  });

  /*
   * And stops following afterwards, which is the other half of "either goes
   * along with the font or is cut its own way". A letter that took later
   * changes to operations it had not touched would be the merge this design
   * refuses.
   */
  it("stops following the font once it has diverged", () => {
    store.changeCut("slot", { on: true, count: 5 });
    store.changeGlyphCut("a", "tooth", { on: true });
    store.changeCut("slot", { count: 9 });

    expect(store.cutsFor("b").slot.count, "the rest of the font moves").toBe(9);
    expect(store.cutsFor("a").slot.count, "the letter does not").toBe(5);
    expect(store.cutHeldBy("a", "slot"), "and now says something different").toBe(true);
  });

  it("goes back to the font's, current value and all", () => {
    store.changeCut("slot", { on: true, count: 5 });
    store.changeGlyphCut("a", "tooth", { on: true });
    store.changeCut("slot", { count: 9 });

    store.cutLikeTheRest("a");
    expect(store.isCutException("a")).toBe(false);
    expect(store.cutsFor("a").slot.count).toBe(9);
    expect(store.cutsFor("a").tooth.on, "its own teeth go with it").toBe(false);
    expect(undoLabel()).toBe("Cut a like the rest");

    store.undo();
    expect(store.isCutException("a")).toBe(true);
  });

  it("marks the letter as touched, for the reason an override does", () => {
    store.changeGlyphCut("a", "slot", { on: true });
    expect(store.glyph("a")!.dirty).toBe(true);
  });

  it("does nothing when a letter that follows the font is told to follow it", () => {
    const label = undoLabel();
    store.cutLikeTheRest("a");
    expect(undoLabel()).toBe(label);
  });

  it("records a font-wide gesture as one entry", () => {
    const before = store.getSnapshot().typeface!.cuts;
    store.changeCut("slot", { on: true });
    store.changeCut("slot", { count: 7 });
    store.commitCuts("Cut the font", before);

    expect(undoLabel()).toBe("Cut the font");
    store.undo();
    expect(store.cutsFor("a").slot.on).toBe(false);
  });
});

describe("a letter cast its own way", () => {
  beforeEach(() => seed(["a", "b"]));

  it("keeps what it was showing, and stops following, as the cuts do", () => {
    store.changeCast("extrude", { on: true, distance: 3 });
    store.changeGlyphCast("a", "outline", { on: true });
    expect(store.castFor("a").extrude).toMatchObject({ on: true, distance: 3 });
    expect(store.castHeldBy("a", "outline")).toBe(true);
    expect(store.castHeldBy("a", "extrude")).toBe(false);

    store.changeCast("extrude", { distance: 8 });
    expect(store.castFor("b").extrude.distance).toBe(8);
    expect(store.castFor("a").extrude.distance).toBe(3);
    expect(store.glyph("a")!.dirty).toBe(true);
  });

  it("goes back to the font's", () => {
    store.changeGlyphCast("a", "outline", { on: true });
    store.castLikeTheRest("a");
    expect(store.castFor("a").outline.on).toBe(false);
    expect(undoLabel()).toBe("Cast a like the rest");
  });

  /*
   * Which of the two layers goes first is a decision about the font and never
   * about a letter, so it has no per-letter twin -- and it records itself
   * rather than waiting to be told the gesture ended, because it is a click.
   */
  it("changes which layer goes first, for the whole font, in one entry", () => {
    expect(store.castFor("a").order).toBe("after");
    store.changeCastOrder("before");
    expect(store.castFor("a").order).toBe("before");
    expect(store.castFor("b").order).toBe("before");
    expect(undoLabel()).toBe("Which shaping goes first");

    store.undo();
    expect(store.castFor("a").order).toBe("after");
  });
});

describe("asked about a letter the font does not have", () => {
  beforeEach(() => seed(["a"]));

  // Every one of these answers rather than throwing, because the panel asks
  // them while the selection is changing under it.
  it("gives the font's answer, or none", () => {
    expect(store.cutsFor("nowhere").slot.on).toBe(false);
    expect(store.castFor("nowhere").outline.on).toBe(false);
    expect(store.isCutException("nowhere")).toBe(false);
    expect(store.cutHeldBy("nowhere", "slot")).toBe(false);
    expect(store.castHeldBy("nowhere", "outline")).toBe(false);
    expect(() => store.changeGlyphCut("nowhere", "slot", { on: true })).not.toThrow();
    expect(() => store.changeGlyphCast("nowhere", "outline", { on: true })).not.toThrow();
    expect(() => store.cutLikeTheRest("nowhere")).not.toThrow();
    expect(() => store.castLikeTheRest("nowhere")).not.toThrow();
  });
});
