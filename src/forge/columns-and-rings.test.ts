/**
 * The fourth audit's faults, held down.
 *
 * The Grotesque's tabular one stood most of a stem left of its column; its H
 * stood as wide in the Condensed and the Expanded as in the Normal; three of
 * the grid's traced letters stood a cell over the cap height; the ring of an
 * å closed to a pinhole, or to nothing, at a heavy pen; and a handful of
 * letters touched the one before at a Condensed Black or on a leaning grid.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { longEnoughFor } from "../../test/fixtures";

import { ready, unite } from "@/font/boolean";
import { contourArea, contoursBounds } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { drawLetter } from "./build";
// Named apart from the hooks: `useKit` switches a document onto its grid.
import { draw, formOf, layOut, startFrom, useKit as onGrid, type Forge } from "./document";
import { widthedStyle } from "./family";
import { troubles } from "./health";
import { readyToShape } from "./layers";
import { BASES, GROTESQUE, type Style } from "./style";

const SLOW = longEnoughFor(60_000);

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const face = (name: string): Style => BASES.find((one) => one.name === name)!;

const at = (forge: Forge, weight: number, width = 100): Forge => ({
  ...forge,
  style: widthedStyle({ ...forge.style, pen: { ...forge.style.pen, weight } }, width),
});

const middleOf = (contours: Contour[]): number => {
  const box = contoursBounds(contours);
  return (box.xMin + box.xMax) / 2;
};

describe("the Grotesque's figures and its H", () => {
  it("stands the tabular one where the nought stands, at every weight and width", () => {
    for (const weight of [30, GROTESQUE.pen.weight, 194, 260]) {
      for (const width of [75, 100, 125]) {
        const forge = at(startFrom(GROTESQUE), weight, width);
        const zero = draw("zero", forge)!;
        const one = draw("one", forge)!;
        expect(one.advanceWidth, `${weight}/${width}`).toBe(zero.advanceWidth);
        // On the code before, 76 units left of it at the face's own weight.
        expect(
          Math.abs(middleOf(one.contours) - middleOf(zero.contours)),
          `${weight}/${width}`,
        ).toBeLessThan(3);
      }
    }
  });

  it("centres the one in its advance at the drawn weight", () => {
    const one = draw("one", startFrom(GROTESQUE))!;
    const box = contoursBounds(one.contours);
    // 110 and 262 either side on the code before.
    expect(Math.abs(box.xMin - (one.advanceWidth - box.xMax))).toBeLessThan(15);
  });

  it("draws its H narrower in the Condensed and wider in the Expanded", () => {
    for (const weight of [30, GROTESQUE.pen.weight, 194]) {
      const ink = (width: number, name: string) => {
        const box = contoursBounds(draw(name, at(startFrom(GROTESQUE), weight, width))!.contours);
        return box.xMax - box.xMin;
      };
      for (const name of ["H", "Hbar"]) {
        expect(ink(75, name), `${name} at ${weight}`).toBeLessThan(ink(100, name) - 40);
        expect(ink(125, name), `${name} at ${weight}`).toBeGreaterThan(ink(100, name) + 40);
      }
      // And by about as much as the N, which always followed the width.
      const share = (name: string) => (ink(100, name) - ink(75, name)) / ink(100, name);
      expect(Math.abs(share("H") - share("N")), `at ${weight}`).toBeLessThan(0.08);
    }
  });

  it("leaves the H of every other face as it was at the Normal width", () => {
    for (const base of BASES) {
      expect(base.metrics.counterWidthed ?? false, base.name).toBe(base.name === "Grotesque");
      expect(base.metrics.oneCentred ?? false, base.name).toBe(base.name === "Grotesque");
    }
  });
});

describe("the grid's trademark, De and lambda", () => {
  it("stand under the line on the faces it was warned on", { timeout: SLOW }, () => {
    for (const base of ["Sans", "Flared"]) {
      for (const weight of [30, 87, 142]) {
        const forge = at(onGrid(layOut(startFrom(face(base))), true), weight);
        const over = troubles(forge).find((one) => one.what === "Reaching past the line");
        for (const letter of ["trademark", "Д", "λ"]) {
          expect(over?.letters ?? [], `${base} at ${weight}`).not.toContain(letter);
        }
        const roof = forge.style.metrics.capHeight + forge.style.pen.weight;
        for (const letter of ["trademark", "Д", "λ"]) {
          expect(contoursBounds(draw(letter, forge)!.contours).yMax, letter).toBeLessThan(roof);
        }
      }
    }
  });
});

describe("the ring over an a", () => {
  it("keeps an open counter on every face at a heavy pen", { timeout: SLOW }, () => {
    /*
     * A quarter of a stem square, the least a counter may be before it is a
     * pinhole: on the code before the Fairground's was under it at 260 and
     * the Marker's and the Brush's were filled in by their tools from 194.
     */
    const shut: string[] = [];
    for (const base of BASES) {
      const forge = startFrom(base);
      for (const weight of [142, 194, 260]) {
        const style = { ...forge.style, pen: { ...forge.style.pen, weight } };
        for (const name of ["ring", "aring"]) {
          const drawn = drawLetter(
            name,
            style,
            formOf(forge, name),
            forge.cuts,
            forge.kit,
            forge.cast,
            forge.effects,
          )!;
          const floor = name === "ring" ? -Infinity : style.metrics.xHeight * 0.8;
          const holes = unite(drawn.contours, "winding").filter(
            (one) => contourArea(one) < 0 && contoursBounds([one]).yMin > floor,
          );
          const most = Math.max(0, ...holes.map((one) => -contourArea(one)));
          if (most < (weight * 0.25) ** 2) shut.push(`${base.name} ${name} at ${weight}`);
        }
      }
    }
    expect(shut).toEqual([]);
  });

  it("is no larger outside for being lighter", () => {
    for (const base of ["Grotesque", "Fairground", "Technical"]) {
      const forge = startFrom(face(base));
      const style = { ...forge.style, pen: { ...forge.style.pen, weight: 260 } };
      const ring = contoursBounds(drawLetter("ring", style, formOf(forge, "ring"))!.contours);
      // The box a pen of 260 left before, less nothing: its outside stays put.
      expect(ring.yMax - ring.yMin, base).toBeLessThan(style.metrics.capHeight * 0.5);
    }
  });
});

describe("touching the letter before", () => {
  it("is not said of the Serif's Condensed Black", () => {
    for (const weight of [194, 260]) {
      const said = troubles(at(startFrom(face("Serif")), weight, 75)).find((one) =>
        one.what.startsWith("Touching"),
      );
      expect(said?.letters ?? [], `at ${weight}`).toEqual([]);
    }
  });

  it("is not said of the leaning faces' grid accents", { timeout: SLOW }, () => {
    for (const base of ["Brush", "Formal Script", "Monoline Script"]) {
      for (const weight of [194, 260]) {
        const forge = at(onGrid(layOut(startFrom(face(base))), true), weight);
        const said = troubles(forge).find((one) => one.what.startsWith("Touching"));
        expect(said?.letters ?? [], `${base} at ${weight}`).toEqual([]);
      }
    }
  });

  it("leaves the Fairground's Expanded delta under the line", () => {
    const said = troubles(at(startFrom(face("Fairground")), 87, 125)).find(
      (one) => one.what === "Reaching past the line",
    );
    expect(said?.letters ?? []).not.toContain("δ");
  });
});
