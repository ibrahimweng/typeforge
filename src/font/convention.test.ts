/**
 * Which way round a font winds, and why it cannot be assumed.
 *
 * This exists because of a fault shipped one commit earlier. The checks judged
 * every font against TrueType's convention, which was right for as long as a
 * font could only arrive from a `.ttf`. A UFO winds the other way -- PostScript
 * convention is what the format specifies and what every tool that writes one
 * produces -- so the moment UFO import landed, opening a perfectly good source
 * file reported its round letters as wound the wrong way.
 *
 * A check that is confidently wrong about correct work is worse than no check.
 * The one thing it teaches is to stop reading the panel it appears in.
 */

import { describe, expect, it } from "vitest";

import { dominantConvention, directionIsCorrect } from "./outline";
import type { Contour } from "./types";

/** A square, wound whichever way is asked for. */
function square(size: number, clockwise: boolean, at = 0): Contour {
  const corner = (x: number, y: number) => ({
    point: { x: at + x, y: at + y },
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  });
  const nodes = [corner(0, 0), corner(size, 0), corner(size, size), corner(0, size)];
  // In font coordinates the signed area of a clockwise contour is negative,
  // which is the reverse of the order these are written in.
  return { closed: true, nodes: clockwise ? nodes.reverse() : nodes };
}

describe("reading a font's winding convention off the font", () => {
  it("calls a font of clockwise outers TrueType", () => {
    const glyphs = [{ contours: [square(100, true)] }, { contours: [square(80, true)] }];
    expect(dominantConvention(glyphs)).toBe("truetype");
    expect(directionIsCorrect(glyphs[0].contours, "truetype")).toBe(true);
  });

  it("calls a font of counter-clockwise outers PostScript", () => {
    /*
     * Which is what a UFO is. Getting this wrong is not a cosmetic
     * disagreement: it is every round letter in somebody's source file
     * reported as broken the first time they open it here.
     */
    const glyphs = [{ contours: [square(100, false)] }, { contours: [square(80, false)] }];
    expect(dominantConvention(glyphs)).toBe("cff");
  });

  it("goes with the larger half when a font disagrees with itself", () => {
    // Which is what a font with a real direction fault looks like. The
    // majority is the convention the designer was working in, so the minority
    // is what should be reported and repaired.
    const glyphs = [
      { contours: [square(100, false)] },
      { contours: [square(90, false)] },
      { contours: [square(80, false)] },
      { contours: [square(70, true)] },
    ];
    expect(dominantConvention(glyphs)).toBe("cff");
  });

  it("keeps to TrueType when there is nothing to go on", () => {
    // An empty font, and a font of glyphs with no outlines in them. Both
    // answered TrueType before this could tell, and nothing should move.
    expect(dominantConvention([])).toBe("truetype");
    expect(dominantConvention([{ contours: [] }])).toBe("truetype");
  });

  it("is not swayed by a contour that satisfies both", () => {
    /*
     * A two-point contour and an open one have no enclosed area, so they are
     * correct under either convention and counted under both. A font of
     * nothing else must not be dragged either way by them.
     */
    const line: Contour = {
      closed: false,
      nodes: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 10, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
      ],
    };
    expect(dominantConvention([{ contours: [line] }])).toBe("truetype");

    // And a real counter-clockwise letter beside it still decides.
    expect(
      dominantConvention([{ contours: [line] }, { contours: [square(100, false)] }]),
    ).toBe("cff");
  });

  it("reads a counter inside a letter as the opposite of its outer", () => {
    // An `o` is two contours that must wind against each other, and the
    // convention is a statement about the outer one only.
    const outer = square(100, false);
    const counter = square(40, true, 30);
    expect(directionIsCorrect([outer, counter], "cff", "nesting")).toBe(true);
    expect(directionIsCorrect([outer, counter], "truetype", "nesting")).toBe(false);
    expect(dominantConvention([{ contours: [outer, counter] }])).toBe("cff");
  });
});
