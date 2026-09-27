/**
 * A Black drawn the way a type designer draws one.
 *
 * Past a face's own text weight the pen takes on contrast, the round letters
 * and the figures widen, the bowls hung on a stem run further out and the
 * letters stand further apart -- see `blackness` in `style.ts`. What that is
 * for is counters: a heavy stem left alone closes every one of them, and the
 * Sans at a pen of 200 had an e with no eye, a B whose upper bowl was a chink
 * and an eight that was two slits.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ready, unite } from "@/font/boolean";
import { contourArea, contourContainsPoint, contoursBounds, flattenContour } from "@/font/geometry";
import type { Contour, Vec2 } from "@/font/types";
import { drawLetter } from "./build";
import { BASES, blackness, spacingOf, type Style } from "./style";

/**
 * A letter in the form its face draws it by default -- the Sans's grotesque
 * s, e, a, and the Serif's Lora-shaped ones (see `letters/humanist.ts`).
 */
const drawnAs = (name: string, style: Style) =>
  drawLetter(
    name,
    style,
    style.name === "Sans" || style.name === "Serif" ? style.forms?.[name] : undefined,
  );

beforeAll(async () => {
  await ready();
});

const face = (name: string): Style => BASES.find((one) => one.name === name)!;
const at = (base: Style, weight: number): Style => ({
  ...base,
  pen: { ...base.pen, weight },
});

/** The letters with a closed counter, and how many each has. */
const COUNTERS: Record<string, number> = {
  o: 1,
  e: 1,
  a: 1,
  b: 1,
  d: 1,
  p: 1,
  q: 1,
  g: 1,
  B: 2,
  D: 1,
  O: 1,
  P: 1,
  R: 1,
  zero: 1,
  six: 1,
  eight: 2,
  nine: 1,
  // The loop at the top and the bowl at the foot: at a pen of 260 on the
  // code before, the loop was a slit a seventh of a stem across.
  ampersand: 2,
};

/**
 * The widest circle that fits inside a counter, across.
 *
 * Not the counter's width or height alone: a slit is wide one way and nothing
 * the other, and the eye reads a counter as open by the round thing it could
 * hold. Found on a grid over the hole, which is plenty for a test.
 */
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

/**
 * Every counter of a letter, as a share of the stem: the openness of each.
 *
 * A hole smaller than a quarter of a stem square is left out -- that is a
 * pinhole where two strokes nearly meet, which some faces have at every
 * weight, and not a counter. A counter that has closed is not left out: it
 * is simply not there, and the count says so.
 */
function counters(name: string, style: Style): number[] {
  const drawn = drawnAs(name, style)!;
  const stem = style.pen.weight;
  return unite(drawn.contours, "winding")
    .filter((contour) => contourArea(contour) < -((stem * 0.25) ** 2))
    .map((hole) => openness(hole) / stem);
}

function expectOpen(names: string[], weight: number, least: number): void {
  for (const name of names) {
    const style = at(face(name), weight);
    for (const [letter, count] of Object.entries(COUNTERS)) {
      const found = counters(letter, style);
      const where = `${name} ${letter} at ${weight}`;
      expect(found.length, `${where} has lost a counter`).toBeGreaterThanOrEqual(count);
      for (const one of found) expect(one, `${where}: ${found.join(", ")}`).toBeGreaterThan(least);
    }
  }
}

describe("a Black keeps its counters open", () => {
  it("at a pen of 200 on every face that has a text weight to come from", () => {
    /*
     * A fifth of a stem across and more at the least -- the eye of an e,
     * which is what closes first on every face -- and most counters a stem or
     * more. On the code before, the Sans e had no eye at all.
     *
     * Not the Fairground, whose pen is held on its side: its horizontals are
     * its heavy strokes, and a Black of a reversed face is its own design. Not
     * the Ribbon or the Marker, which start two thirds of the way to a Black
     * and round their corners into the counters. And not the Didone or the
     * Roundhand, whose B carries a pinhole at every weight.
     */
    expectOpen(
      [
        "Sans",
        "Grotesque",
        "Serif",
        "Display",
        "Geometric",
        "Technical",
        "Slab",
        "Typewriter",
        "Wavy",
        "Flared",
        "Psychedelic",
        "Brush",
        "Handwriting",
        "Formal Script",
        "Casual Script",
        "Monoline Script",
      ],
      200,
      0.22,
    );
  }, 300_000);

  it("and at the end of the weight control on the plain faces", () => {
    expectOpen(
      ["Sans", "Grotesque", "Geometric", "Technical", "Slab", "Typewriter", "Wavy", "Brush"],
      260,
      0.25,
    );
  }, 300_000);
});

describe("what a heavy weight changes", () => {
  it("changes nothing at or below a face's own weight", () => {
    for (const base of BASES) {
      expect(blackness(base), base.name).toBe(0);
      expect(blackness(at(base, 30)), base.name).toBe(0);
      expect(spacingOf(base), base.name).toBe(base.metrics.sidebearing);
    }
  });

  it("thins the horizontals and opens the spacing past it", () => {
    const sans = face("Sans");
    const black = at(sans, 200);
    expect(blackness(black)).toBeGreaterThan(0.9);
    // A face that keeps its counters opens its spacing as its stems grow.
    const grotesque = at(face("Grotesque"), 200);
    expect(spacingOf(grotesque)).toBeGreaterThan(face("Grotesque").metrics.sidebearing + 20);
    /*
     * The Sans closes its counters as Geist's Black does, and its spacing with
     * them: Geist Black sets its n 61 units off each side, its Regular 80.
     */
    expect(spacingOf(black)).toBeLessThan(sans.metrics.sidebearing * 0.85);
    expect(spacingOf(black)).toBeGreaterThan(sans.metrics.sidebearing * 0.6);
    // An o's crown is lighter than its sides.
    const o = drawnAs("o", black)!;
    const hole = unite(o.contours, "winding").find((one) => contourArea(one) < 0)!;
    const outline = flattenContour(hole, 16);
    const ink = unite(o.contours, "winding").find((one) => contourArea(one) > 0)!;
    const outer = flattenContour(ink, 16);
    const side = Math.min(...outline.map((p) => p.x)) - Math.min(...outer.map((p) => p.x));
    const crown = Math.max(...outer.map((p) => p.y)) - Math.max(...outline.map((p) => p.y));
    expect(crown / side).toBeLessThan(0.75);
    // And the o widens with the n, as a Black's does.
    const n = drawnAs("n", black)!;
    expect(o.advanceWidth / n.advanceWidth).toBeGreaterThan(0.85);
  });

  /*
   * A variable font moves every point of a letter between its masters, so the
   * letter has to be drawn with the same points at every weight -- the
   * compensation above changes how far and how heavy, never how many.
   */
  it("draws every letter with the same points at every weight", () => {
    const letters = [
      ...Object.keys(COUNTERS),
      ..."nhmscutAGSKMNWkxy".split(""),
      "two",
      "three",
      "five",
      "ampersand",
    ];
    for (const name of [
      "Sans",
      "Grotesque",
      "Serif",
      "Display",
      "Geometric",
      "Ribbon",
      "Technical",
      "Fairground",
      "Didone",
      "Slab",
      "Typewriter",
      "Marker",
      "Flared",
      "Brush",
    ]) {
      const base = face(name);
      for (const letter of letters) {
        const shape = (weight: number): string =>
          drawnAs(letter, at(base, weight))!
            .contours.map((contour) => contour.nodes.length)
            .join(",");
        const drawn = shape(base.pen.weight);
        for (const weight of [30, 200, 260]) {
          expect(shape(weight), `${name} ${letter} at ${weight}`).toBe(drawn);
        }
      }
    }
  }, 300_000);
});

/**
 * How open the two bowls of an s are, each as a share of the stem: the widest
 * circle that fits in paper walled in above, below and on the letter's own
 * side -- the round end of the counter, not the aperture it runs out into.
 * The upper bowl is looked for in the upper left of the letter, the lower in
 * the lower right.
 */
function sBowls(name: string, style: Style): [number, number] {
  const ink = unite(drawnAs(name, style)!.contours, "winding");
  const edges: [Vec2, Vec2][] = [];
  for (const contour of ink) {
    const outline = flattenContour(contour, 16);
    outline.forEach((point, index) => {
      edges.push([point, outline[(index + 1) % outline.length]]);
    });
  }
  const { xMin, xMax, yMin, yMax } = contoursBounds(ink);
  const inked = (x: number, y: number): boolean =>
    ink.reduce(
      (winding, contour) =>
        winding +
        (contourContainsPoint(contour, { x, y }) ? (contourArea(contour) > 0 ? 1 : -1) : 0),
      0,
    ) > 0;
  const walled = (x: number, y: number, dx: number, dy: number): boolean => {
    for (let t = 4; ; t += 4) {
      const [px, py] = [x + dx * t, y + dy * t];
      if (px < xMin || px > xMax || py < yMin || py > yMax) return false;
      if (inked(px, py)) return true;
    }
  };
  const found: [number, number] = [0, 0];
  const step = 6;
  for (let x = xMin; x <= xMax; x += step) {
    for (let y = yMin; y <= yMax; y += step) {
      const upper = y > (yMin + yMax) / 2;
      const side = (x - xMin) / (xMax - xMin);
      // Each counter in its own two thirds: an old-style s's head runs well
      // out to the right, and its upper counter with it.
      if (upper ? side > 0.62 : side < 0.38) continue;
      if (inked(x, y)) continue;
      if (!walled(x, y, 0, 1) || !walled(x, y, 0, -1) || !walled(x, y, upper ? -1 : 1, 0)) {
        continue;
      }
      let nearest = Number.POSITIVE_INFINITY;
      for (const [a, b] of edges) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length));
        nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
      }
      const which = upper ? 0 : 1;
      found[which] = Math.max(found[which], (nearest * 2) / style.pen.weight);
    }
  }
  return found;
}

describe("the letters a Black closes first", () => {
  it("draws a Black s with two open counters, as wide as its o nearly", () => {
    /*
     * Built as two circles tangent to a straight spine, a Black s had no room
     * to turn in: its spine stood up between two stacked circles, both
     * counters shut, and the letter came out barely half as wide as its o.
     */
    for (const name of ["Sans", "Grotesque", "Geometric", "Slab", "Serif", "Marker", "Flared"]) {
      for (const weight of [200, 260]) {
        const style = at(face(name), weight);
        const [upper, lower] = sBowls("s", style);
        expect(upper, `${name} s at ${weight}, upper`).toBeGreaterThan(0.15);
        expect(lower, `${name} s at ${weight}, lower`).toBeGreaterThan(0.15);
        const wide = (letter: string): number => {
          const box = contoursBounds(drawnAs(letter, style)!.contours);
          return box.xMax - box.xMin;
        };
        /*
         * The Serif's s keeps its bowls round rather than running them out
         * sideways, as Lora's does (its Bold s is 0.77 of its o): run out to
         * the o's width, its spine lay flat across the letter and past a
         * Black the s stood wider than the o.
         */
        expect(wide("s") / wide("o"), `${name} s at ${weight}`).toBeGreaterThan(
          name === "Serif" ? 0.55 : 0.8,
        );
        // And on its lines: at the end of the axis it hung below the baseline.
        const box = contoursBounds(drawnAs("s", style)!.contours);
        expect(box.yMin, `${name} s at ${weight}`).toBeGreaterThan(-style.metrics.overshoot * 2);
      }
    }
  }, 300_000);

  it("keeps the eye of a Black e half a stem open", () => {
    // A third of a stem on the code before, on most faces. (The Ribbon, whose
    // rounded corners fill the eye's, is held to less below.) The break cut's
    // "does not slice the top off a Black e" in `cut.test.ts` holds with it.
    for (const name of [
      "Sans",
      "Grotesque",
      "Serif",
      "Geometric",
      "Technical",
      "Slab",
      "Typewriter",
      "Marker",
      "Wavy",
      "Brush",
    ]) {
      const [eye] = counters("e", at(face(name), 200));
      expect(eye, `${name} e`).toBeGreaterThan(0.45);
    }
    // The Flared's tail ends in a flare that stands up into the aperture, and
    // the bar stops higher to keep that open: the eye a little under half.
    const flared = counters("e", at(face("Flared"), 200));
    expect(flared.length, "Flared e").toBe(1);
    expect(flared[0], "Flared e").toBeGreaterThan(0.4);
  }, 300_000);

  it("opens the Ribbon's and the Marker's B and e at a pen of 200", () => {
    // Starting heavy, they came to 200 not halfway to a Black by `blackness`,
    // and the B's upper counter was a fifth of a stem.
    for (const name of ["Ribbon", "Marker"]) {
      for (const letter of ["B", "e"]) {
        for (const one of counters(letter, at(face(name), 200))) {
          expect(one, `${name} ${letter}`).toBeGreaterThan(0.35);
        }
      }
    }
  }, 300_000);

  it("draws a B with its two counters and no pinhole at its waist", () => {
    /*
     * The two bowls cross at the waist by a fifth of a pen, and with a pen
     * that has contrast the two waist runs are hairlines that do not reach
     * each other across that: a slit of paper between the counters, at every
     * weight on the Didone and at a Black on the Psychedelic and the Brush.
     */
    for (const name of ["Didone", "Psychedelic", "Brush", "Sans", "Serif", "Slab", "Wavy"]) {
      const base = face(name);
      for (const weight of [base.pen.weight, 200, 260]) {
        const style = at(base, weight);
        const holes = unite(drawnAs("B", style)!.contours, "winding").filter(
          (contour) => contourArea(contour) < 0,
        );
        expect(holes.length, `${name} B at ${weight}`).toBe(2);
      }
    }
  }, 300_000);

  it("stands a Black c's ends apart and a Black A's bar off the line", () => {
    for (const name of ["Sans", "Geometric"]) {
      const style = at(face(name), 200);
      const box = (letter: string) => contoursBounds(drawnAs(letter, style)!.contours);
      // The c's ends out over the right of its bowl, not cut off over its
      // middle where it read as a bracket.
      const [c, o] = [box("c"), box("o")];
      expect((c.xMax - c.xMin) / (o.xMax - o.xMin), `${name} c`).toBeGreaterThan(0.8);
      // And paper under the A's bar: sat on the baseline, the A was a solid
      // triangle with a hole in it.
      const holes = unite(drawnAs("A", style)!.contours, "winding").filter(
        (contour) => contourArea(contour) < 0,
      );
      expect(holes.length, `${name} A`).toBe(1);
      const ink = unite(drawnAs("A", style)!.contours, "winding");
      const middle = (box("A").xMin + box("A").xMax) / 2;
      const clear = (y: number): boolean =>
        !ink.some(
          (contour) => contourArea(contour) > 0 && contourContainsPoint(contour, { x: middle, y }),
        );
      expect(clear(style.pen.weight * 0.35), `${name} A`).toBe(true);
    }
  });
});
