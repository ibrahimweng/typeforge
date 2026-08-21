import { beforeAll, describe, expect, it } from "vitest";

import { ready, unite } from "@/font/boolean";
import { contourArea, contoursBounds } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { drawLetter } from "./build";
import { anyCut, noCuts, piecesOf, type Cuts } from "./cut";
import { weightedStyle } from "./family";
import { BASES, type Style } from "./style";

const sans = BASES.find((base) => base.name === "Sans")!;
const display = BASES.find((base) => base.name === "Display")!;

const ink = (contours: Contour[]): number =>
  Math.abs(contours.reduce((total, contour) => total + contourArea(contour), 0));

const cutWith = (patch: (cuts: Cuts) => void): Cuts => {
  const cuts = noCuts();
  patch(cuts);
  return cuts;
};

function drawn(letter: string, style: Style, cuts?: Cuts) {
  const made = drawLetter(letter, style, undefined, cuts);
  if (!made) throw new Error(`${letter} did not draw`);
  return made;
}

/**
 * How much of a letter one setting takes away, as a share of what was there.
 *
 * Measured against the fused letter rather than against the strokes it was
 * drawn from. A letter here is overlapping pieces, so adding up their areas
 * counts every overlap twice -- and a heavy face overlaps far more than a
 * light one, which made a cut that behaves identically at both weights look
 * like it took a fifth more away from one of them.
 */
function removed(letter: string, style: Style, cuts: Cuts): number {
  const before = ink(unite(drawn(letter, style).contours, "winding"));
  const after = ink(drawn(letter, style, cuts).contours);
  return before > 0 ? 1 - after / before : 0;
}

beforeAll(async () => {
  await ready();
});

describe("the cut layer", () => {
  it("is off to begin with", () => {
    expect(anyCut(noCuts())).toBe(false);
    expect(anyCut(undefined)).toBe(false);
  });

  it("leaves the letter exactly as it was when nothing is on", () => {
    for (const letter of "AEHOSaegno") {
      const plain = drawn(letter, sans);
      const through = drawn(letter, sans, noCuts());
      expect(ink(through.contours)).toBeCloseTo(ink(plain.contours), 6);
      expect(through.advanceWidth).toBeCloseTo(plain.advanceWidth, 6);
    }
  });

  it("never moves a letter or changes its width", () => {
    // The promise the spacing rests on: a cut takes ink away and so it moves
    // the letter's edges, but the letter is placed and spaced by the solid
    // drawing, so nobody cutting slots through a font respaces it by accident.
    const all = cutWith((cuts) => {
      cuts.slot = { on: true, count: 3, width: 0.4, angle: 15, inset: 0.05 };
      cuts.tooth = { on: true, pitch: 0.09, depth: 0.5, edge: "both" };
      cuts.split.on = true;
      cuts.chamfer.on = true;
    });
    for (const letter of "ABEHKMORSaebgnors") {
      expect(drawn(letter, sans, all).advanceWidth).toBeCloseTo(
        drawn(letter, sans).advanceWidth,
        6,
      );
    }
  });
});

describe("slot", () => {
  it("takes ink away and leaves the letter in pieces", () => {
    const cuts = cutWith((one) => { one.slot.on = true; });
    expect(removed("H", sans, cuts)).toBeGreaterThan(0.05);
    expect(piecesOf(drawn("H", sans, cuts).contours)).toBeGreaterThan(1);
  });

  it("cuts more bands when asked for more", () => {
    const few = cutWith((one) => { one.slot = { on: true, count: 2, width: 0.3, angle: 0, inset: 0.1 }; });
    const many = cutWith((one) => { one.slot = { on: true, count: 6, width: 0.3, angle: 0, inset: 0.1 }; });
    expect(piecesOf(drawn("H", sans, many).contours)).toBeGreaterThan(
      piecesOf(drawn("H", sans, few).contours),
    );
  });

  it("leaves the top and bottom of the letter alone when inset", () => {
    const cuts = cutWith((one) => { one.slot = { on: true, count: 2, width: 0.3, angle: 0, inset: 0.3 }; });
    const before = contoursBounds(drawn("H", sans).contours);
    const after = contoursBounds(drawn("H", sans, cuts).contours);
    expect(after.yMax).toBeCloseTo(before.yMax, 3);
    expect(after.yMin).toBeCloseTo(before.yMin, 3);
  });
});

describe("tooth", () => {
  it("cuts one edge, or both, and leaves the letter the size it was", () => {
    const left = cutWith((one) => { one.tooth = { on: true, pitch: 0.1, depth: 0.4, edge: "left" }; });
    const both = cutWith((one) => { one.tooth = { on: true, pitch: 0.1, depth: 0.4, edge: "both" }; });

    // Both flanks of an H are the same, so sawing both takes about twice as
    // much as sawing one.
    const one = removed("H", sans, left);
    expect(one).toBeGreaterThan(0.01);
    expect(removed("H", sans, both) / one).toBeGreaterThan(1.7);

    /*
     * And the letter still measures the same across.
     *
     * Worth stating because it is the difference between a saw and a trim: the
     * teeth reach in from outside the letter, so the peaks between them are
     * still on the letter's original edge and the silhouette keeps its box.
     */
    const before = contoursBounds(drawn("H", sans).contours);
    const after = contoursBounds(drawn("H", sans, left).contours);
    expect(after.xMin).toBeCloseTo(before.xMin, 3);
    expect(after.xMax).toBeCloseTo(before.xMax, 3);
  });

  it("keeps the letter whole", () => {
    const cuts = cutWith((one) => { one.tooth.on = true; });
    for (const letter of "HOSaeno") {
      expect(piecesOf(drawn(letter, sans, cuts).contours)).toBe(
        piecesOf(drawn(letter, sans).contours),
      );
    }
  });

  it("runs the same number of teeth down a letter at any weight", () => {
    // Pitch is a share of the x-height rather than of the stem, so a Display
    // gets a saw and not three wedges.
    const cuts = cutWith((one) => { one.tooth = { on: true, pitch: 0.1, depth: 0.3, edge: "left" }; });
    const thin = removed("H", sans, cuts);
    const fat = removed("H", display, cuts);
    expect(Math.abs(thin - fat)).toBeLessThan(0.1);
  });
});

describe("inline", () => {
  it("grooves the letter without breaking it", () => {
    const cuts = cutWith((one) => { one.inline.on = true; });
    expect(removed("H", sans, cuts)).toBeGreaterThan(0.15);
    expect(piecesOf(drawn("H", sans, cuts).contours)).toBe(1);
  });

  it("breaks out through the ends when the inset is taken off", () => {
    const held = cutWith((one) => { one.inline = { on: true, width: 0.34, inset: 0.6 }; });
    const loose = cutWith((one) => { one.inline = { on: true, width: 0.34, inset: 0 }; });
    expect(piecesOf(drawn("H", sans, held).contours)).toBe(1);
    expect(piecesOf(drawn("H", sans, loose).contours)).toBeGreaterThan(1);
  });
});

describe("split", () => {
  it("takes the arms off a letter that has them", () => {
    const cuts = cutWith((one) => { one.split.on = true; });
    expect(piecesOf(drawn("E", sans, cuts).contours)).toBeGreaterThan(1);
    expect(piecesOf(drawn("H", sans, cuts).contours)).toBeGreaterThan(1);
  });

  it("leaves a letter drawn in one stroke alone", () => {
    // An o and an S have nothing to break: there is no second stroke to leave.
    const cuts = cutWith((one) => { one.split.on = true; });
    for (const letter of "oS") {
      expect(removed(letter, sans, cuts)).toBeCloseTo(0, 6);
    }
  });
});

describe("chamfer", () => {
  it("cuts the corners and leaves the round letters alone", () => {
    const cuts = cutWith((one) => { one.chamfer.on = true; });
    expect(removed("A", sans, cuts)).toBeGreaterThan(0.02);
    expect(removed("o", sans, cuts)).toBeCloseTo(0, 6);
  });

  it("cuts more when asked for more", () => {
    const light = cutWith((one) => { one.chamfer = { on: true, size: 0.3 }; });
    const heavy = cutWith((one) => { one.chamfer = { on: true, size: 1.2 }; });
    expect(removed("E", sans, heavy)).toBeGreaterThan(removed("E", sans, light));
  });
});

describe("motif", () => {
  it("replaces the hole rather than filling it in", () => {
    const cuts = cutWith((one) => { one.motif.on = true; });
    const before = drawn("o", sans).contours;
    const after = drawn("o", sans, cuts).contours;
    const hole = after.find((contour) => contourArea(contour) < 0);
    expect(hole).toBeDefined();
    // A diamond has four corners where a round counter has rather more.
    expect(hole!.nodes.length).toBe(4);
    // And it is smaller than the counter it replaced, so the letter gains ink.
    expect(ink(after)).toBeGreaterThan(ink(before) * 0.99);
  });

  it("leaves a letter with no counter alone", () => {
    const cuts = cutWith((one) => { one.motif.on = true; });
    expect(removed("H", sans, cuts)).toBeCloseTo(0, 6);
  });

  it("holds a large motif inside the letter", () => {
    const cuts = cutWith((one) => { one.motif = { on: true, shape: "square", size: 1.25 }; });
    const before = contoursBounds(drawn("o", sans).contours);
    const after = contoursBounds(drawn("o", sans, cuts).contours);
    for (const edge of ["xMin", "xMax", "yMin", "yMax"] as const) {
      expect(after[edge]).toBeCloseTo(before[edge], 3);
    }
  });
});

describe("measured in stems", () => {
  /*
   * What the whole family rests on: one description of a cut, applied to every
   * weight, meaning the same thing at each of them.
   *
   * Which is not the same as taking the same share of every weight away, and
   * the difference is worth being exact about. A slot is a band of a fixed
   * number of stems across cutting through a letter a fixed number of stems
   * wide, so the ink it removes goes as the square of the stem while the
   * letter's own ink goes as the stem -- and a Black must lose a larger share
   * to a slot than a Thin does. A groove down the middle of every stroke is
   * the other case: it runs the length of the skeleton exactly as the stroke
   * does, so there the share is what holds.
   */
  const light = weightedStyle(sans, 400, 200);
  const bold = weightedStyle(sans, 400, 800);

  it("cuts a slot the same number of stems across at any weight", () => {
    const cuts = cutWith((one) => {
      one.slot = { on: true, count: 3, width: 0.3, angle: 0, inset: 0.1 };
    });
    // Measured on an I, which is one stem and nothing else. On an H the middle
    // band lands on the crossbar, and a crossbar is not a stem: how wide it
    // runs is a decision about the rhythm of the font rather than about the
    // pen, so it does not follow the weight and it spoils the sum.
    const inStems = (style: Style): number => {
      const stem = style.pen.weight;
      const gone =
        ink(unite(drawn("I", style).contours, "winding")) - ink(drawn("I", style, cuts).contours);
      return gone / (stem * stem);
    };
    const thin = inStems(light);
    const heavy = inStems(bold);
    expect(thin).toBeGreaterThan(0.5);
    expect(Math.abs(thin - heavy) / thin).toBeLessThan(0.05);
  });

  it("grooves the same share of a letter at any weight", () => {
    const cuts = cutWith((one) => { one.inline = { on: true, width: 0.3, inset: 0.45 }; });
    const thin = removed("H", light, cuts);
    const heavy = removed("H", bold, cuts);
    expect(thin).toBeGreaterThan(0.15);
    expect(Math.abs(thin - heavy)).toBeLessThan(0.06);
  });
});
