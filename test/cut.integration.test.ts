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

import { exportFont } from "../src/font/export";
import { importFont } from "../src/font/parse";
import { noCuts } from "../src/font/cuts";
import { addPieces, editCuts, emptyAssembly, pieceInto } from "../src/assemble/document";
import { toTypeface } from "../src/assemble/typeface";
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
import type { MotifShape } from "../src/forge/cut";
import { SANS } from "../src/forge/style";
import { FONT_SUITE_TIMEOUT, loadTestFont } from "./fixtures";
import { hasFontTools, inspectFont } from "./fonttools";

/*
 * Every suite in this file reads its result through fontTools, so without it
 * there is nothing here to run. Skip rather than fail, as the other suites
 * that need it do.
 */
const suite = hasFontTools() ? describe : describe.skip;

suite("a cut font, read from outside", { timeout: FONT_SUITE_TIMEOUT }, () => {
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

  it("keeps the island in a nested counter solid, and the hole around it hollow", async () => {
    /*
     * Every other counter shape is one hole. This one is a hole with a piece
     * of ink standing in the middle of it, which is the only place in the
     * whole font where a contour sits two deep. Wind that island the way the
     * hole around it is wound and it does not come out wrong, it does not come
     * out at all: the boolean reads the two diamonds as one region and fuses
     * them, and what should be a face with a dot in every counter ships as a
     * face with a plain diamond. So both are asked here -- the piece count,
     * and then the ink, which is the half that would catch a winding that
     * survived as far as the file.
     */
    const ink = async (shape: MotifShape): Promise<number> => {
      const forge = editCut(startFrom(SANS), "motif", { on: true, shape });
      const written = await deliver(forge, { familyName: "Nested", format: "ttf" });
      return Math.abs(inspectFont(written.bytes).inkOf.o);
    };
    const plain = await deliver(startFrom(SANS), { familyName: "Plain", format: "ttf" });
    const round = inspectFont(plain.bytes);
    const nested = await deliver(
      editCut(startFrom(SANS), "motif", { on: true, shape: "nested" }),
      { familyName: "Nested", format: "ttf" },
    );

    // The bowl, the diamond hole, and the diamond standing inside it.
    expect(inspectFont(nested.bytes).contoursOf.o).toBe(3);

    // A diamond takes less out of the bowl than the round counter did, and the
    // island puts some of it back -- so the ink rises twice over. Wind the
    // island the way the hole is wound and it would subtract instead, which
    // lands it below the plain diamond and fails here.
    const hollow = Math.abs(round.inkOf.o);
    const diamond = await ink("diamond");
    const island = await ink("nested");
    expect(diamond).toBeGreaterThan(hollow);
    expect(island).toBeGreaterThan(diamond);
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


suite("a font somebody opened, cut and written back out", { timeout: FONT_SUITE_TIMEOUT }, () => {
  /*
   * The other two halves of the application cut the same description with the
   * same code, and the thing that could still go wrong is different: here the
   * outlines came out of a file rather than off a pen, nothing has promised
   * which way a counter is wound, and the stem every size is a multiple of has
   * to be measured rather than asked for. So it is read back from outside.
   */
  const opened = async () => {
    const bytes = loadTestFont();
    if (!bytes) throw new Error("no font to open");
    return (await importFont(bytes, "test.ttf")).typeface;
  };

  const written = async (face: Awaited<ReturnType<typeof opened>>) =>
    inspectFont((await exportFont(face, { format: "ttf", fidelity: "rebuild" })).bytes);

  it("writes the slots into the outlines of a font it did not draw", async () => {
    const plain = await opened();
    expect((await written(plain)).contoursOf.H).toBe(1);

    const cut = await opened();
    cut.cuts = { ...noCuts(), slot: { on: true, count: 2, width: 0.34, angle: 0, inset: 0.14 } };
    // Two bands across both stems and the bar leaves an H in five pieces, and
    // a piece count is the one thing a reader outside can be sure of.
    expect((await written(cut)).contoursOf.H).toBe(5);
  });

  it("does not respace the font it cut", async () => {
    const plain = await opened();
    const before = plain.glyphs[plain.glyphIndex.get("H")!].advanceWidth;
    const cut = await opened();
    cut.cuts = { ...noCuts(), slot: { on: true, count: 3, width: 0.4, angle: 0, inset: 0.1 } };
    const read = await written(cut);
    expect(read.contoursOf.H).toBeGreaterThan(1);
    expect(cut.glyphs[cut.glyphIndex.get("H")!].advanceWidth).toBe(before);
  });

  it("lets one letter keep out of it", async () => {
    const cut = await opened();
    cut.cuts = { ...noCuts(), slot: { on: true, count: 2, width: 0.34, angle: 0, inset: 0.14 } };
    cut.glyphs[cut.glyphIndex.get("H")!].cuts = noCuts();
    const read = await written(cut);
    expect(read.contoursOf.H).toBe(1);
    // And the rest of the font was still cut.
    expect(read.contoursOf.I).toBeGreaterThan(1);
  });
});

suite("a pile of drawings, cut and written out", { timeout: FONT_SUITE_TIMEOUT }, () => {
  const svg = (d: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${d}"/></svg>`;

  const pile = () => {
    const drawings = [
      ["I", "M40 8H60V92H40Z"],
      ["H", "M20 8H36V92H20Z M36 42H64V58H36Z M64 8H80V92H64Z"],
    ] as const;
    const pieces = drawings.map(([character, d]) => {
      const one = pieceInto(character, `${character}.svg`, svg(d));
      if (!one) throw new Error(`${character} did not read`);
      return one;
    });
    return addPieces(emptyAssembly(), pieces);
  };

  it("writes the cuts into a font built from drawings", async () => {
    const plain = await toTypeface(pile(), { familyName: "Pile", styleName: "Regular", merge: true });
    const before = inspectFont(
      (await exportFont(plain, { format: "ttf", fidelity: "rebuild" })).bytes,
    );
    expect(before.contoursOf.I).toBe(1);

    const cut = await toTypeface(
      editCuts(pile(), { ...noCuts(), slot: { on: true, count: 2, width: 0.34, angle: 0, inset: 0.14 } }),
      { familyName: "Pile", styleName: "Regular", merge: true },
    );
    const after = inspectFont((await exportFont(cut, { format: "ttf", fidelity: "rebuild" })).bytes);
    // A stem with two bands through it arrives as three pieces.
    expect(after.contoursOf.I).toBe(3);
    // And the drawing was still spaced as the solid shape it was drawn as.
    expect(cut.glyphs[cut.glyphIndex.get("I")!].advanceWidth).toBe(
      plain.glyphs[plain.glyphIndex.get("I")!].advanceWidth,
    );
  });
});

suite("a letter drawn elsewhere, cut with the rest", { timeout: FONT_SUITE_TIMEOUT }, () => {
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

suite("a font built on a grid", { timeout: FONT_SUITE_TIMEOUT }, () => {
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
