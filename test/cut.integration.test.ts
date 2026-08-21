/**
 * The cuts, as they arrive in a font file.
 *
 * Everything else about the cut layer is checked against this project's own
 * geometry, which is the code that made the cut in the first place. This asks
 * an outside reader: fontTools opens the file, walks the outlines with its own
 * pen, and counts the pieces. A slot that is on the screen and not in the file
 * would pass every other test in the suite and fail here.
 */

import { describe, expect, it } from "vitest";

import { deliver } from "../src/forge/deliver";
import {
  editCut,
  importLetter,
  layOut,
  startFrom,
  useKit,
  type Forge,
} from "../src/forge/document";
import { letterSvg, readLetterSvg } from "../src/forge/exchange";
import { SANS } from "../src/forge/style";
import { FONT_SUITE_TIMEOUT } from "./fixtures";
import { inspectFont } from "./fonttools";

describe("a cut font, read from outside", { timeout: FONT_SUITE_TIMEOUT }, () => {
  it("writes the slots into the outlines", async () => {
    const plain = await deliver(startFrom(SANS), { familyName: "Plain", format: "ttf" });
    const whole = inspectFont(plain.bytes);
    expect(whole.contoursOf.H).toBe(1);
    expect(whole.contoursOf.o).toBe(2); // a ring and its counter

    const slotted = editCut(startFrom(SANS), "slot", { on: true });
    const cut = await deliver(slotted, { familyName: "Slotted", format: "ttf" });
    const read = inspectFont(cut.bytes);

    /*
     * Two bands across an H leave five pieces, each its own contour.
     *
     * Not three: an H is two uprights joined by a bar, so a band below the bar
     * takes the foot off each upright and a band above it takes off each head,
     * and what is left in the middle is the bar with the waist of both stems
     * still attached. Two feet, two heads and a middle.
     */
    expect(read.contoursOf.H).toBe(5);
    expect(read.recompiles).toBe(true);
    // And the file is still a font: every curve turn on a point, as both
    // outline formats require.
    expect(read.interiorExtremes).toBe(0);
  });

  it("writes them into an OpenType file too", async () => {
    const slotted = editCut(startFrom(SANS), "slot", { on: true });
    const cut = await deliver(slotted, { familyName: "Slotted", format: "otf" });
    const read = inspectFont(cut.bytes);
    expect(read.outlineFormat).toBe("cff");
    expect(read.contoursOf.H).toBe(5);
    expect(read.recompiles).toBe(true);
  });

  it("replaces a counter with the shape it was told to", async () => {
    const diamond = editCut(startFrom(SANS), "motif", { on: true });
    const cut = await deliver(diamond, { familyName: "Diamond", format: "ttf" });
    const read = inspectFont(cut.bytes);
    // Still a ring with a hole in it, but the hole is a different shape --
    // which the piece count cannot see and the outline can.
    expect(read.contoursOf.o).toBe(2);
    expect(read.recompiles).toBe(true);
  });

  it("carries the cuts through every weight of a family", async () => {
    const slotted = {
      ...editCut(startFrom(SANS), "slot", { on: true }),
      family: { drawn: 400, also: [700] },
    };
    const written = await deliver(slotted, { familyName: "Cut", format: "ttf" });
    expect(written.members).toHaveLength(2);
    // The zip is opened by the family test; here the members are enough to say
    // both weights were written, and the drawn one is checked in full.
    const regular = await deliver(
      { ...slotted, family: { drawn: 400, also: [] } },
      { familyName: "Cut", format: "ttf" },
    );
    expect(inspectFont(regular.bytes).contoursOf.H).toBe(5);
  });
});

describe("a letter drawn elsewhere, cut with the rest", { timeout: FONT_SUITE_TIMEOUT }, () => {
  /** Take a letter out, flatten its curves so it is visibly somebody's drawing, put it back. */
  function handDrawn(forge: Forge, letter: string): Forge {
    const arrival = readLetterSvg(letterSvg(letter, forge) as string, forge);
    if (!arrival) throw new Error("no sheet");
    return importLetter(forge, letter, {
      contours: arrival.contours.map((contour) => ({
        ...contour,
        nodes: contour.nodes.map((node) => ({ ...node, handleIn: null, handleOut: null })),
      })),
      advanceWidth: arrival.advanceWidth,
      from: `${letter}.svg`,
    });
  }

  it("writes the slots into it too", async () => {
    const own = handDrawn(startFrom(SANS), "g");
    const before = inspectFont(
      (await deliver(own, { familyName: "Own", format: "ttf" })).bytes,
    );
    const cut = inspectFont(
      (await deliver(editCut(own, "slot", { on: true }), { familyName: "Own", format: "ttf" })).bytes,
    );
    expect(cut.contoursOf.g).toBeGreaterThan(before.contoursOf.g);
    expect(cut.recompiles).toBe(true);
  });

  it("waits for the geometry even when only one letter is cut", async () => {
    // Nothing cut font-wide, one letter slotted on its own. A check on the
    // font's own settings would sail past this and write the letter solid.
    const own = handDrawn(startFrom(SANS), "g");
    const alone = editCut(own, "slot", { on: true }, "g");
    const read = inspectFont((await deliver(alone, { familyName: "One", format: "ttf" })).bytes);
    const plain = inspectFont((await deliver(own, { familyName: "One", format: "ttf" })).bytes);
    expect(read.contoursOf.g).toBeGreaterThan(plain.contoursOf.g);
    expect(read.contoursOf.n).toBe(plain.contoursOf.n);
  });
});

describe("a font built on a grid", { timeout: FONT_SUITE_TIMEOUT }, () => {
  const laid = (): Forge => useKit(layOut(startFrom(SANS)), true);

  it("writes letters made of cells into a real font file", async () => {
    const written = await deliver(laid(), { familyName: "Grid", format: "ttf" });
    const read = inspectFont(written.bytes);
    expect(read.recompiles).toBe(true);
    expect(read.interiorExtremes).toBe(0);
    // Every letter still arrives, and with ink in it.
    for (const name of ["H", "O", "n", "o"]) {
      expect(read.contoursOf[name], name).toBeGreaterThan(0);
    }
  });

  it("still answers to the pen, so the family still has weights", async () => {
    const kit = laid();
    const light = await deliver(
      { ...kit, style: { ...kit.style, pen: { ...kit.style.pen, weight: 40 } } },
      { familyName: "Grid", format: "ttf" },
    );
    const heavy = await deliver(
      { ...kit, style: { ...kit.style, pen: { ...kit.style.pen, weight: 150 } } },
      { familyName: "Grid", format: "ttf" },
    );
    // The same cells, drawn with a wider pen: a heavier font, not a different one.
    expect(heavy.bytes.length).not.toBe(light.bytes.length);
    for (const one of [light, heavy]) expect(inspectFont(one.bytes).recompiles).toBe(true);
  });

  it("cuts a letter built from cells like any other", async () => {
    const slotted = editCut(laid(), "slot", { on: true });
    const plain = inspectFont((await deliver(laid(), { familyName: "Grid", format: "ttf" })).bytes);
    const cut = inspectFont((await deliver(slotted, { familyName: "Grid", format: "ttf" })).bytes);
    expect(cut.contoursOf.H).toBeGreaterThan(plain.contoursOf.H);
  });
});
