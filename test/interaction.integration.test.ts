/**
 * The controls against each other.
 *
 * Each one was checked on its own as it was built, which is not the same as
 * checking that using two together still works. Every fault below was found by
 * sweeping one control and watching what happened to the rest.
 */

import { describe, expect, it } from "vitest";

import { findCrossbar } from "../src/font/anatomy";
import { contourArea, contoursBounds } from "../src/font/geometry";
import { measureGlyph } from "../src/font/measure";
import { contoursIntersect } from "../src/font/outline";
import { importFont } from "../src/font/parse";
import { resolveGlyphContours } from "../src/font/transform";
import { DEFAULT_PARAMS, type Contour, type Typeface } from "../src/font/types";
import { FONT_SUITE_TIMEOUT, loadTestFont } from "./fixtures";

const source = loadTestFont();
const suite = source ? describe : describe.skip;

suite("controls used together", { timeout: FONT_SUITE_TIMEOUT }, () => {
  const open = async (): Promise<Typeface> => (await importFont(source!, "DejaVuSans.ttf")).typeface;
  const resolve = (typeface: Typeface, name: string, params: Partial<typeof DEFAULT_PARAMS>) => {
    typeface.params = { ...DEFAULT_PARAMS, ...params };
    const glyph = typeface.glyphs[typeface.glyphIndex.get(name)!];
    return resolveGlyphContours(glyph, typeface);
  };

  /**
   * Weight ran the wrong way. The offset that adds it points out of a
   * counter-clockwise contour and into a clockwise one, and the sign was
   * inverted, so every letter in a TrueType font -- where outer contours are
   * wound clockwise -- got thinner as the weight went up. An n's stem measured
   * 184 units at rest and 37 at weight +80.
   */
  it("thickens every letter as the weight goes up", async () => {
    const typeface = await open();
    for (const name of ["I", "H", "A", "o", "n", "m", "e", "O", "s"]) {
      const stems = [-60, 0, 60].map((weight) => {
        const contours = resolve(typeface, name, { weight });
        return measureGlyph(contours, 0)?.stemWidth ?? 0;
      });
      expect(stems[0], `${name} lighter`).toBeLessThan(stems[1]);
      expect(stems[1], `${name} bolder`).toBeLessThan(stems[2]);
    }
  });

  /**
   * Fixing only the winding left o alone: its counter grew at the same rate as
   * its outside, so the stroke between them never changed, holding at 206, 205
   * and 204 units across the whole range. A hole has to close as the outline
   * opens.
   */
  it("closes the counter of a round letter as it is emboldened", async () => {
    const typeface = await open();
    const counters = [-60, 0, 60].map((weight) => {
      const contours = resolve(typeface, "o", { weight });
      return measureGlyph(contours, 0)?.closedCounterWidth ?? 0;
    });
    expect(counters[0]).toBeGreaterThan(counters[1]);
    expect(counters[1]).toBeGreaterThan(counters[2]);
  });

  /**
   * The crossbar used to take with it whatever else stood at its height. The
   * bowl of an e lost three curve points to it; B, P and R one each.
   */
  it("moves the crossbar without disturbing the rest of the letter", async () => {
    const typeface = await open();
    for (const name of ["H", "E", "F", "A"]) {
      const before = resolve(typeface, name, {});
      const after = resolve(typeface, name, { crossbar: 150 });

      const moved = before.flatMap((contour, ci) =>
        contour.nodes.filter((node, ni) => {
          const now = after[ci].nodes[ni].point;
          return now.x !== node.point.x || now.y !== node.point.y;
        }),
      );
      // Only the bar's own two edges, four points in all.
      expect(moved, `${name} moved too much`).toHaveLength(4);

      const bar = findCrossbar(after)!;
      expect(Math.round(bar.bottom - findCrossbar(before)!.bottom)).toBe(150);

      const wasBounds = contoursBounds(before);
      const nowBounds = contoursBounds(after);
      expect(nowBounds.yMax).toBeCloseTo(wasBounds.yMax, 3);
      expect(nowBounds.yMin).toBeCloseTo(wasBounds.yMin, 3);
    }
  });

  /**
   * A bar whose ends meet curves moves too, by stretching the short curves that
   * join it to the bowl. An exact slide is often unavailable: e's bar ends at
   * (305,516) on a curve running down to (420,227), so there is no point on it
   * at any greater height. Only the bar's own points move either way.
   */
  it("moves a bar whose ends meet curves, without disturbing the bowl", async () => {
    const typeface = await open();
    for (const name of ["e", "B", "P", "R"]) {
      const before = resolve(typeface, name, {});
      const barBefore = findCrossbar(before)!;

      for (const shift of [-100, 100]) {
        const after = resolve(typeface, name, { crossbar: shift });
        const moved = before.flatMap((contour, ci) =>
          contour.nodes.filter((node, ni) => {
            const now = after[ci].nodes[ni].point;
            return now.x !== node.point.x || now.y !== node.point.y;
          }),
        );
        // The bar's two edges and nothing else.
        expect(moved, `${name} moved too much at ${shift}`).toHaveLength(4);
        expect(Math.round(findCrossbar(after)!.bottom - barBefore.bottom)).toBe(shift);

        // The letter keeps its height: the bowl is not dragged with the bar.
        const was = contoursBounds(before);
        const now = contoursBounds(after);
        expect(now.yMax).toBeCloseTo(was.yMax, 3);
        expect(now.yMin).toBeCloseTo(was.yMin, 3);
      }
    }
  });

  /**
   * Serifs were decided last, on a shape the other controls had already moved,
   * so they came and went as unrelated sliders were dragged: sweeping the
   * weight took n and m from three stroke ends to none, and the x-height took
   * one off t. They are now put on first and carried through with the letter.
   */
  it("keeps the same serifs while every other control is swept", async () => {
    const typeface = await open();
    const sweeps: Array<[string, number[]]> = [
      ["crossbar", [-164, 0, 164]],
      ["shoulder", [-164, 0, 164]],
      ["weight", [-80, 0, 120]],
      ["xHeightScale", [0.8, 1, 1.25]],
      ["width", [0.6, 1, 1.5]],
    ];
    for (const [key, values] of sweeps) {
      for (const name of ["H", "E", "F", "I", "T", "t", "n", "l", "m"]) {
        const counts = values.map(
          (value) => resolve(typeface, name, { slab: 90, [key]: value }).length,
        );
        expect(new Set(counts).size, `${name} serifs drifted while ${key} moved`).toBe(1);
      }
    }
  });

  /**
   * A serif pasted on after the weight kept its size however heavy the letter
   * became, so a bold cut wore the serifs of a light one. Worse, the bars were
   * wound against the letter, so adding weight shrank them: an I with serifs
   * measured 382 units wide unweighted and 269 at weight 80.
   */
  it("grows the serifs along with the letter", async () => {
    const typeface = await open();
    const width = (weight: number): number => {
      const bounds = contoursBounds(resolve(typeface, "I", { slab: 90, weight }));
      return bounds.xMax - bounds.xMin;
    };
    expect(width(80)).toBeGreaterThan(width(0));
    expect(width(0)).toBeGreaterThan(width(-60));
  });

  /*
   * The weight slider, end to end, on every letter and figure.
   *
   * Thinning past half a stroke's width sends its two sides through each other.
   * Seven of the first ten letters tried failed that way at the light end --
   * n, o, e, a, s, g and m all crossed themselves, with stems down to twenty
   * units on a font whose stems are 184. The heavy end does the same thing to
   * white space: the aperture of an s closed and came out the other side, two
   * points ninety units apart ending up on top of each other.
   *
   * Each contour is checked on its own. Two contours that meet -- an ogonek
   * touching the letter it hangs off, a serif laid over a stem -- is how a bold
   * cut is drawn and how the export expects to receive it; a contour crossing
   * itself is the letter coming apart.
   */
  const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
  // The ends of the slider, in ems, as the inspector offers them.
  const LIGHTEST = -0.04;
  const HEAVIEST = 0.06;

  const folds = (contours: Contour[]): boolean =>
    contours.some((contour) => contoursIntersect([contour]));

  it("never lets a letter cross itself, wherever the weight slider is put", async () => {
    const typeface = await open();
    const em = typeface.unitsPerEm;
    for (const name of ALPHABET) {
      if (!typeface.glyphIndex.has(name)) continue;
      for (const fraction of [-1, -0.75, -0.5, -0.25, 0.25, 0.5, 0.75, 1]) {
        const weight = em * fraction * (fraction < 0 ? -LIGHTEST : HEAVIEST);
        expect(folds(resolve(typeface, name, { weight })), `${name} at ${Math.round(weight)}`).toBe(
          false,
        );
      }
    }
  });

  it("never turns a shape inside out, wherever the weight slider is put", async () => {
    const typeface = await open();
    const em = typeface.unitsPerEm;
    for (const name of ALPHABET) {
      if (!typeface.glyphIndex.has(name)) continue;
      const facing = resolve(typeface, name, {}).map((contour) => Math.sign(contourArea(contour)));
      for (const fraction of [-1, -0.5, 0.5, 1]) {
        const weight = em * fraction * (fraction < 0 ? -LIGHTEST : HEAVIEST);
        const now = resolve(typeface, name, { weight }).map((contour) =>
          Math.sign(contourArea(contour)),
        );
        expect(now, `${name} at ${Math.round(weight)}`).toEqual(facing);
      }
    }
  });

  /**
   * Reaching the limit has to leave something to look at. A stroke stops at a
   * width rather than at nothing, so the lightest setting is a hairline and not
   * a gap.
   */
  it("leaves ink in every letter at the lightest setting", async () => {
    const typeface = await open();
    const floor = typeface.unitsPerEm * 0.012;
    for (const name of ALPHABET) {
      if (!typeface.glyphIndex.has(name)) continue;
      const contours = resolve(typeface, name, { weight: typeface.unitsPerEm * LIGHTEST });
      const stem = measureGlyph(contours, 0)?.stemWidth ?? 0;
      expect(stem, `${name} vanished`).toBeGreaterThan(floor);
    }
  });

  /**
   * Holding a whole contour back for one bad corner is its own fault: it left
   * a's stem at 241 units while every other letter reached 325, so one letter
   * stopped getting bolder while the rest carried on. The restraint has to stay
   * where it is needed.
   */
  it("goes on getting bolder to the end of the slider, letter by letter", async () => {
    const typeface = await open();
    const em = typeface.unitsPerEm;
    for (const name of ["a", "n", "o", "H", "i", "g", "y"]) {
      const stems = [0.25, 0.5, 0.75, 1].map(
        (fraction) =>
          measureGlyph(resolve(typeface, name, { weight: em * HEAVIEST * fraction }), 0)
            ?.stemWidth ?? 0,
      );
      for (let step = 1; step < stems.length; step++) {
        expect(stems[step], `${name} stopped growing at step ${step}`).toBeGreaterThan(
          stems[step - 1],
        );
      }
    }
  });

  /**
   * Every control, over its whole range, has to produce numbers.
   *
   * The stroke floor is a fraction of the em, and the fit builds a stand-in
   * typeface to try candidate parameters on. That stand-in had no em, so the
   * floor came out as NaN and took every coordinate with it -- quietly, because
   * a NaN outline still draws, just nowhere. A stem asked to lose twenty units
   * came back with a weight of minus two hundred.
   */
  it("never produces a coordinate that is not a number", async () => {
    const typeface = await open();
    const em = typeface.unitsPerEm;
    const sweeps: Array<[string, number[]]> = [
      ["weight", [-0.04 * em, 0.06 * em]],
      ["width", [0.6, 1.5]],
      ["counterScale", [0.6, 1.4]],
      ["xHeightScale", [0.8, 1.25]],
      ["slant", [-20, 20]],
      ["cornerRadius", [0.15 * em]],
      ["slab", [0.1 * em]],
      ["crossbar", [-0.08 * em, 0.08 * em]],
      ["shoulder", [-0.08 * em, 0.08 * em]],
      ["pixelGrid", [16, 64]],
    ];
    for (const [key, values] of sweeps) {
      for (const value of values) {
        for (const name of ["n", "o", "e", "a", "H", "t"]) {
          for (const contour of resolve(typeface, name, { [key]: value })) {
            for (const node of contour.nodes) {
              for (const point of [node.point, node.handleIn, node.handleOut]) {
                if (!point) continue;
                expect(
                  Number.isFinite(point.x) && Number.isFinite(point.y),
                  `${name} lost a point to ${key}=${value}`,
                ).toBe(true);
              }
            }
          }
        }
      }
    }
  });
});
