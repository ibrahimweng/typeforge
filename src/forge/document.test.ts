/**
 * Propagation, checked on the letters rather than on the data.
 *
 * It is easy to assert that a field changed. What matters is that the drawing
 * changed, everywhere it should have and nowhere it should not, so these tests
 * compare outlines: draw the alphabet, make one edit, draw it again, and see
 * which letters moved.
 *
 * That is also what tells the two halves of the promise apart. "Everything
 * follows" is only half of it; the other half is that a letter told to keep its
 * own version keeps it, and that a letter which never had the part in the first
 * place is left completely alone.
 */

import { describe, expect, it } from "vitest";

import { contoursToSvgPath } from "@/font/geometry";
import { letterNames } from "./build";
import {
  clearException,
  draw,
  editPart,
  editPen,
  isException,
  partsOf,
  reach,
  startFrom,
  styleFor,
  type Forge,
} from "./document";
import { lettersUsing, partsUsedBy, PART_SPECS } from "./parts";
import { DISPLAY, SANS, SERIF, type Style } from "./style";

/** What a letter actually looks like, as a string that can be compared. */
const shapeOf = (letter: string, forge: Forge): string => {
  const drawn = draw(letter, forge);
  return drawn ? contoursToSvgPath(drawn.contours, 3) : "";
};

/** Every letter whose drawing differs between two documents. */
function moved(before: Forge, after: Forge): string[] {
  return letterNames().filter((letter) => shapeOf(letter, before) !== shapeOf(letter, after));
}

describe("which letters have which parts", () => {
  it("gives an n a shoulder and an o none", () => {
    expect(partsUsedBy("n", SANS)).toContain("shoulder");
    expect(partsUsedBy("o", SANS)).not.toContain("shoulder");
  });

  it("gives an o a bowl and an H none", () => {
    expect(partsUsedBy("o", SANS)).toContain("bowl");
    expect(partsUsedBy("H", SANS)).not.toContain("bowl");
  });

  it("gives an H a crossbar and an l none", () => {
    expect(partsUsedBy("H", SANS)).toContain("crossbar");
    expect(partsUsedBy("l", SANS)).not.toContain("crossbar");
  });

  /**
   * The serif is offered wherever one could land, whether the face wears them
   * or not -- switching them on is the whole reason anyone opens the control,
   * and offering it only once they were already on left no way to do that.
   */
  it("offers the serif on a sans as readily as on a serif", () => {
    expect(lettersUsing("slab", SANS).length).toBeGreaterThan(40);
    expect(lettersUsing("slab", SERIF).length).toBeGreaterThan(40);
  });

  /**
   * And withholds it from the letters a serif cannot sit on. A c, an s and an o
   * have no straight stroke end, so there is nothing to lay a bar across; the
   * answer comes from drawing them rather than from guessing at the recipe.
   */
  it("withholds the serif from letters with no straight stroke end", () => {
    for (const letter of ["o", "O", "c", "s", "S", "zero", "period"]) {
      expect(lettersUsing("slab", SERIF), `${letter} cannot take a serif`).not.toContain(letter);
    }
  });

  it("finds every part described in the panel on some letter of a serif", () => {
    // With the wave switched on, because a part nobody has asked for is a part
    // no letter uses -- which is true of it and would be true of the serif too
    // if the serif face did not have serifs.
    const waving: Style = {
      ...SERIF,
      parts: {
        ...SERIF.parts,
        wave: { ...SERIF.parts.wave, depth: 26 },
        flare: { ...SERIF.parts.flare, spread: 0.4 },
        ball: { ...SERIF.parts.ball, size: 1.2 },
      },
    };
    for (const spec of PART_SPECS) {
      expect(lettersUsing(spec.name, waving).length, `nothing uses ${spec.name}`).toBeGreaterThan(0);
    }
  });
});

describe("editing a part", () => {
  it("changes every letter that has it", () => {
    const before = startFrom(SERIF);
    const after = editPart(before, "slab", { projection: before.style.parts.slab.projection + 30 });

    const changed = moved(before, after);
    expect(changed.length).toBeGreaterThan(40);
    for (const letter of ["p", "b", "d", "h", "i", "k", "l", "m", "n", "H", "E", "T"]) {
      expect(changed, `${letter} did not follow`).toContain(letter);
    }
  });

  /**
   * The other half. An o has no straight stroke to put a serif on, so moving
   * the serif has to leave it exactly as it was -- not nearly, exactly.
   */
  it("leaves alone every letter that does not have it", () => {
    const before = startFrom(SERIF);
    const after = editPart(before, "slab", { projection: 120 });
    for (const letter of ["o", "O", "c", "s", "zero", "period", "comma"]) {
      expect(shapeOf(letter, after), `${letter} changed`).toBe(shapeOf(letter, before));
    }
  });

  it("moves the shoulder on the arched letters and on nothing else", () => {
    const before = startFrom(SANS);
    const after = editPart(before, "shoulder", { spring: 0.8 });
    const changed = moved(before, after);
    expect(changed.sort()).toEqual(["h", "m", "n", "r", "u", "U"].sort());
  });

  it("moves the crossbar on every letter whose bar can move", () => {
    const before = startFrom(SANS);
    const after = editPart(before, "crossbar", { height: 0.65 });
    const changed = moved(before, after);
    for (const letter of ["H", "E", "F", "A", "e"]) {
      expect(changed, `${letter} did not follow`).toContain(letter);
    }
    for (const letter of ["o", "l", "i", "n"]) {
      expect(changed, `${letter} should not have moved`).not.toContain(letter);
    }
  });

  /**
   * A t and an f carry their bar at the x-height because that is what a t and
   * an f are, so the height control does not reach them -- but the weight
   * control does, and they are still crossbar letters. The distinction is
   * worth a test of its own, because "it has a crossbar" and "its crossbar can
   * be moved up and down" are not the same statement.
   */
  it("keeps the bar of a t and an f at the x-height, but not at any weight", () => {
    const before = startFrom(SANS);
    const raised = editPart(before, "crossbar", { height: 0.65 });
    const lightened = editPart(before, "crossbar", { weight: 0.6 });
    for (const letter of ["t", "f"]) {
      expect(partsOf(letter, before), `${letter} should be a crossbar letter`).toContain("crossbar");
      expect(moved(before, raised), `${letter} moved with the height`).not.toContain(letter);
      expect(moved(before, lightened), `${letter} ignored the weight`).toContain(letter);
    }
  });

  it("says how many letters an edit will reach before it is made", () => {
    const forge = startFrom(SERIF);
    const { letters, held } = reach(forge, "slab");
    expect(letters.length).toBeGreaterThan(40);
    expect(held).toHaveLength(0);
  });
});

describe("a letter told to differ", () => {
  it("keeps its own version while the rest of the font moves on", () => {
    let forge = startFrom(SERIF);
    const original = shapeOf("p", forge);

    // p is pinned to the serif it has now.
    forge = editPart(forge, "slab", { projection: forge.style.parts.slab.projection }, "p");
    // Then the family's serif changes underneath it.
    const before = forge;
    forge = editPart(forge, "slab", { projection: 120 });

    expect(shapeOf("p", forge), "p followed when it should have held").toBe(original);
    expect(shapeOf("b", forge), "b should have followed").not.toBe(shapeOf("b", before));
  });

  it("is the only letter that differs", () => {
    let forge = startFrom(SERIF);
    forge = editPart(forge, "slab", { projection: 10 }, "p");
    expect(isException(forge, "p")).toBe(true);
    expect(isException(forge, "b")).toBe(false);
    expect(Object.keys(forge.exceptions)).toEqual(["p"]);
  });

  it("says which letters are holding back", () => {
    let forge = startFrom(SERIF);
    forge = editPart(forge, "slab", { projection: 10 }, "p");
    const { letters, held } = reach(forge, "slab");
    expect(held).toEqual(["p"]);
    expect(letters).not.toContain("p");
  });

  it("rejoins the family when the exception is dropped", () => {
    let forge = startFrom(SERIF);
    const asDrawn = shapeOf("p", forge);
    forge = editPart(forge, "slab", { projection: 10 }, "p");
    expect(shapeOf("p", forge)).not.toBe(asDrawn);
    forge = clearException(forge, "p");
    expect(shapeOf("p", forge)).toBe(asDrawn);
    expect(forge.exceptions).toEqual({});
  });

  it("keeps its exception to the one part it was given", () => {
    let forge = startFrom(SERIF);
    // n rather than p: an exception has to be tested on a letter that has both
    // parts, and a p has no arch for the shoulder to reach.
    forge = editPart(forge, "slab", { projection: 10 }, "n");
    // The shoulder is still the family's, so a family change to it reaches n.
    const before = shapeOf("n", forge);
    forge = editPart(forge, "shoulder", { spring: 0.8 });
    expect(shapeOf("n", forge)).not.toBe(before);
  });
});

describe("the pen", () => {
  it("reaches every letter, with no exceptions to be had", () => {
    const before = startFrom(SANS);
    const after = editPen(before, { weight: before.style.pen.weight + 40 });
    const drawn = letterNames().filter((letter) => draw(letter, before)!.contours.length > 0);
    expect(moved(before, after).sort()).toEqual(drawn.sort());
  });
});

describe("starting a document", () => {
  it("takes a copy, so the base it came from is never edited", () => {
    const forge = startFrom(SANS);
    const was = SANS.parts.shoulder.spring;
    const edited = editPart(forge, "shoulder", { spring: 0.4 });
    expect(SANS.parts.shoulder.spring).toBe(was);
    expect(edited.style.parts.shoulder.spring).toBe(0.4);
    expect(forge.style.parts.shoulder.spring).toBe(was);
  });

  it("remembers which base it started from", () => {
    expect(startFrom(DISPLAY).base).toBe("Display");
  });

  it("hands a letter the family's own style when it is not an exception", () => {
    const forge = startFrom(SANS);
    expect(styleFor("n", forge)).toBe(forge.style);
  });

  it("lists the parts a letter offers, in the order they are shown", () => {
    const forge = startFrom(SERIF);
    const parts = partsOf("H", forge);
    expect(parts).toContain("crossbar");
    expect(parts).toContain("slab");
    // Ordered as the panel lists them rather than as the drawing happened to
    // ask for them, so the controls do not move about between letters.
    const order = PART_SPECS.map((spec) => spec.name);
    expect([...parts].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(parts);
  });
});
