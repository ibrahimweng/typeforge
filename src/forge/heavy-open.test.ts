/**
 * Past the Black, the sans faces keep their counters open.
 *
 * The weight control runs on past Geist Black's stem of 194 to 260. Held to
 * the Black's widths there, the stems grew into the counters from both
 * sides: at 260 the Sans's 6 and 9 were slits a third of a stem across, its
 * four, its number sign and the crossing of its ampersand were pinholes, and
 * the Geometric's o, b, d, p and q closed to slots. Each bowl is now let out
 * by a share of the stem it gains past the Black (`metrics.heavyOpen`, see
 * `pastBlack` in `style.ts`), and the letters that stack their strokes gain
 * weight more slowly there.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ready, unite } from "@/font/boolean";
import { contourArea, contourContainsPoint, contoursBounds, flattenContour } from "@/font/geometry";
import type { Contour, Vec2 } from "@/font/types";
import { proof, startFrom } from "./document";
import { readyToShape } from "./layers";
import { BASES, pastBlack, type Style } from "./style";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const face = (name: string): Style => BASES.find((one) => one.name === name)!;

function drawn(name: string, base: string, weight: number): Contour[] {
  const forge = startFrom(face(base));
  const style = { ...forge.style, pen: { ...forge.style.pen, weight } };
  return proof(name, { ...forge, style })!.contours;
}

/** The widest circle that fits inside a counter, across: see `black.test.ts`. */
function openness(hole: Contour): number {
  const outline = flattenContour(hole, 16);
  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  const [left, right, bottom, top] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const step = Math.max(2, Math.min(right - left, top - bottom) / 25);
  let best = 0;
  for (let x = left; x <= right; x += step) {
    for (let y = bottom; y <= top; y += step) {
      const point: Vec2 = { x, y };
      if (!contourContainsPoint(hole, point)) continue;
      let nearest = Number.POSITIVE_INFINITY;
      for (let index = 0; index < outline.length; index++) {
        const a = outline[index];
        const b = outline[(index + 1) % outline.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length));
        nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
      }
      best = Math.max(best, nearest);
    }
  }
  return best * 2;
}

/** Each counter's openness as a share of the stem, pinholes and all. */
function counters(name: string, base: string, weight: number): number[] {
  return unite(drawn(name, base, weight), "winding")
    .filter((contour) => contourArea(contour) < 0)
    .map((hole) => openness(hole) / weight);
}

describe("past the Black", () => {
  it("keeps every counter of the stacked letters well open at the end of the control", () => {
    /*
     * Two fifths of a stem across at the least, at a pen of 260: on the code
     * before, the Sans's 6 was 0.48 of a stem, its four and number sign 0.21
     * and the pinhole in its ampersand 0.15; the Geometric's e 0.43 and its
     * o 0.53, a slot.
     */
    const letters = [
      "a",
      "e",
      "g",
      "o",
      "b",
      "B",
      "A",
      "three",
      "six",
      "nine",
      "eight",
      "four",
      "numbersign",
      "ampersand",
    ];
    for (const base of ["Sans", "Grotesque", "Geometric"]) {
      for (const letter of letters) {
        const found = counters(letter, base, 260);
        const shown = found.map((v) => v.toFixed(2)).join(", ");
        for (const one of found) expect(one, `${base} ${letter}: ${shown}`).toBeGreaterThan(0.38);
      }
    }
  }, 300_000);

  it("opens the Geometric's rounds from the inside, keeping their outsides", () => {
    /*
     * The Geometric keeps its o round, so past the Black it cannot widen its
     * bowls; its round strokes thin at their sides instead (`rounds.ts`). At
     * 260 its o was a slot 0.55 of a stem across, its b, d, p and q and its
     * 0, 6 and 9 the same.
     */
    for (const letter of ["o", "b", "d", "p", "q", "a", "c", "zero", "six", "nine", "O"]) {
      const found = counters(letter, "Geometric", 260);
      const shown = found.map((v) => v.toFixed(2)).join(", ");
      for (const one of found) expect(one, `${letter}: ${shown}`).toBeGreaterThan(0.7);
    }
    // And the o as wide as it was: the outside does not move.
    const width = (weight: number) => {
      const box = contoursBounds(drawn("o", "Geometric", weight));
      return box.xMax - box.xMin;
    };
    const style = face("Geometric");
    const rounds = (weight: number) =>
      contoursBounds(drawn("o", "Geometric", weight)).yMax -
      contoursBounds(drawn("o", "Geometric", weight)).yMin;
    expect(width(260) / rounds(260)).toBeLessThan(1.28);
    expect(style.metrics.heavyThin).toBeGreaterThan(0);
  }, 300_000);

  it("changes nothing up to the Sans's Black", () => {
    // Geist Black's stem, where the Sans is fitted to Geist Black.
    expect(pastBlack({ ...face("Sans"), pen: { ...face("Sans").pen, weight: 194 } })).toBe(0);
    for (const base of BASES) {
      if (base.metrics.heavyOpenFrom !== undefined) continue;
      expect(pastBlack(base), base.name).toBe(0);
    }
    // And on a face that does not ask for it, at any weight.
    expect(pastBlack({ ...face("Serif"), pen: { ...face("Serif").pen, weight: 260 } })).toBe(0);
  });

  it("keeps the Geometric's ampersand under the cap line and its brackets open", () => {
    const style = face("Geometric");
    const cap = style.metrics.capHeight + style.metrics.overshoot;
    const amp = contoursBounds(drawn("ampersand", "Geometric", 260));
    expect(amp.yMax).toBeLessThanOrEqual(cap + 2);
    /*
     * The bracket's arms reach a quarter of a stem and more past its
     * upright, where on the code before they stopped inside it and the
     * bracket was a slab as wide as its stem.
     */
    for (const name of ["bracketleft", "bracketright"]) {
      const bounds = contoursBounds(unite(drawn(name, "Geometric", 260), "winding"));
      expect(bounds.xMax - bounds.xMin, name).toBeGreaterThan(260 * 1.25);
    }
  });
});

describe("the Display's dollar", () => {
  it("draws its bar no heavier than its stem at a hairline", () => {
    const contours = drawn("dollar", "Display", 30);
    // The bar is the narrowest run that crosses both lines.
    const across = contours
      .map((contour) => contoursBounds([contour]))
      .filter((bounds) => bounds.yMin < 0 && bounds.yMax > face("Display").metrics.capHeight)
      .map((bounds) => bounds.xMax - bounds.xMin);
    // On the code before it was 75 across, two and a half times the stem.
    expect(Math.min(...across)).toBeLessThan(40);
  });
});
