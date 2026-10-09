/**
 * The soft finishes drawn faster, and drawn the same.
 *
 * Every stroke of a letter is swept once to tell the others where it is and
 * once more for its own ink (see `inkAll`). Where the sweep makes soft
 * finishes, the outline already swept is handed on instead -- but not while a
 * wave book is open, where both sweeps ask the book about their corners in
 * turn. A book being taken down answers every question as the drawing would
 * have answered it alone, so a letter drawn against one goes the old way, by
 * two sweeps, to the same drawing: which is what is asked here, of every
 * letter in every form, at the masters a family runs through, of the Soft
 * Serif and of the Serif with each finish turned all the way up.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { drawLetter, letterNames } from "./build";
import { widthedStyle } from "./family";
import { readyToShape } from "./layers";
import { everyFormOf } from "./letters";
import { openWaveBook, type WaveBook } from "./shapes";
import { SOFT_SERIF } from "./starts";
import { SERIF, type Style } from "./style";
import { sweptSoftly } from "./sweep";
import type { Stroke, Terminal } from "./types";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

/** The drawing as it would be stored, to the last bit. */
function drawn(name: string, style: Style, form: string): string {
  const letter = drawLetter(name, style, form || undefined);
  return JSON.stringify(
    letter ? { contours: letter.contours, advance: letter.advanceWidth } : null,
  );
}

/** The same, drawn against a wave book being taken down: by two sweeps of every stroke. */
function drawnTwice(name: string, style: Style, form: string): string {
  const book: WaveBook = {
    lengths: new Map(),
    bowls: new Map(),
    balls: new Map(),
    corners: new Map(),
    recording: true,
  };
  const was = openWaveBook(book);
  try {
    return drawn(name, style, form);
  } finally {
    openWaveBook(was);
  }
}

/** Every letter in every form at these pens and widths, where the two ways disagree. */
function disagreements(face: Style, pens: number[], widths: number[]): string[] {
  const differ: string[] = [];
  for (const pen of pens) {
    for (const width of widths) {
      const style = widthedStyle({ ...face, pen: { ...face.pen, weight: pen } }, width);
      for (const name of letterNames()) {
        for (const { id } of everyFormOf(name)) {
          if (drawn(name, style, id) !== drawnTwice(name, style, id)) {
            differ.push(`${name}${id ? `/${id}` : ""} at ${pen}/${width}`);
          }
        }
      }
    }
  }
  return differ;
}

describe("a stroke's outline handed on to its own ink", () => {
  it("draws every Soft Serif letter as sweeping it again does", { timeout: 300_000 }, () => {
    expect(disagreements(SOFT_SERIF, [30, 87, 194, 260], [75, 125])).toEqual([]);
  });

  it("draws every letter of the Serif with each finish at its most as sweeping it again does", {
    timeout: 300_000,
  }, () => {
    const most: Style = {
      ...SERIF,
      parts: {
        ...SERIF.parts,
        slab: { ...SERIF.parts.slab, tip: 1, swell: 0.6 },
        bowl: { ...SERIF.parts.bowl, heft: 0.5, heftTilt: 30, tail: 1.5 },
        terminal: {
          ...SERIF.parts.terminal,
          soft: 0.5,
          taper: 0.85,
          dropSize: 0.6,
          dropHang: 1.5,
          dropCurl: 1,
          dropNeck: 1,
        },
        corner: { ...SERIF.parts.corner, fillet: 1 },
      },
    };
    expect(disagreements(most, [30, 142, 260], [100])).toEqual([]);
  });
});

describe("sweptSoftly", () => {
  const plain: Terminal = { kind: "butt" };
  const stroke: Stroke = {
    spine: {
      segments: [{ kind: "line", from: { x: 0, y: 0 }, to: { x: 0, y: 500 } }],
      closed: false,
    },
    pen: { weight: 87, contrast: 0, angle: 0 },
    start: plain,
    end: plain,
  };

  it("is false for a stroke with no finish, which is every stroke of every base", () => {
    expect(sweptSoftly(stroke)).toBe(false);
  });

  it("is true for each finish the sweep makes, at either end", () => {
    expect(sweptSoftly({ ...stroke, inside: 0.35 })).toBe(true);
    expect(sweptSoftly({ ...stroke, heft: { share: 0.08, tilt: 0 } })).toBe(true);
    for (const finish of [{ swell: 1.3 }, { taper: 0.5 }, { soft: { left: 4 } }]) {
      expect(sweptSoftly({ ...stroke, start: { ...plain, ...finish } })).toBe(true);
      expect(sweptSoftly({ ...stroke, end: { ...plain, ...finish } })).toBe(true);
    }
  });
});
