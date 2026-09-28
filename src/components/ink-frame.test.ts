/**
 * The frames the Draw page shows letters in: the thumbnails of a letter's
 * forms, and the specimen line. Both used to run from the ascender to the
 * descender and no further, and the tails of the g and the y -- the part that
 * tells their forms apart -- and the ring of the Å were cropped away.
 */

import { describe, expect, it } from "vitest";

import { contoursBounds } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { draw, startFrom } from "@/forge/document";
import { formsOf } from "@/forge/letters";
import { SANS, SERIF } from "@/forge/style";
import { inkFrame } from "./ink-frame";

function holds(frame: ReturnType<typeof inkFrame>, b: ReturnType<typeof contoursBounds>, x = 0) {
  expect(-b.yMax).toBeGreaterThan(frame.y);
  expect(-b.yMin).toBeLessThan(frame.y + frame.height);
  expect(b.xMin + x).toBeGreaterThanOrEqual(frame.x);
  expect(b.xMax + x).toBeLessThanOrEqual(frame.x + frame.width);
}

describe("the frame a letter is shown in", () => {
  it("holds every form of the g, y and j whole", () => {
    let below = 0;
    for (const style of [SANS, SERIF]) {
      for (const letter of ["g", "y", "j"]) {
        for (const form of formsOf(letter)) {
          const drawn = drawLetter(letter, style, form.id);
          if (!drawn) continue;
          const bounds = contoursBounds(drawn.contours);
          if (bounds.yMin < style.metrics.descender) below++;
          holds(
            inkFrame(style.metrics, [{ contours: drawn.contours, x: 0 }], drawn.advanceWidth),
            bounds,
          );
        }
      }
    }
    // The case the frame is for: tails that do go below the descender.
    expect(below).toBeGreaterThan(0);
  });

  it("holds a specimen line's accents and descenders, with air below them", () => {
    for (const base of [SANS, SERIF]) {
      const forge = startFrom(base);
      const pieces = [];
      let x = 0;
      for (const name of ["g", "y", "j", "p", "Q", "Aring", "Eacute"]) {
        const drawn = draw(name, forge);
        if (!drawn) continue;
        pieces.push({ contours: drawn.contours, x });
        x += drawn.advanceWidth;
      }
      const frame = inkFrame(forge.style.metrics, pieces, x);
      for (const piece of pieces) {
        const bounds = contoursBounds(piece.contours);
        holds(frame, bounds, piece.x);
        expect(frame.y + frame.height + bounds.yMin).toBeGreaterThan(10);
      }
    }
  });

  it("keeps to the ascender and descender when nothing reaches past them", () => {
    const metrics = { ascender: 800, descender: -200, unitsPerEm: 1000 };
    const frame = inkFrame(metrics, [], 500);
    expect(frame.y).toBeLessThanOrEqual(-800);
    expect(frame.y + frame.height).toBeGreaterThanOrEqual(200);
    expect(frame.height).toBeLessThan(1050);
  });
});
