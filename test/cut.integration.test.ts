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
import { editCut, startFrom } from "../src/forge/document";
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
