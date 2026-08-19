/**
 * The controls against each other.
 *
 * Each one was checked on its own as it was built, which is not the same as
 * checking that using two together still works. Every fault below was found by
 * sweeping one control and watching what happened to the rest.
 */

import { describe, expect, it } from "vitest";

import { findCrossbar } from "../src/font/anatomy";
import { contoursBounds } from "../src/font/geometry";
import { measureGlyph } from "../src/font/measure";
import { importFont } from "../src/font/parse";
import { resolveGlyphContours } from "../src/font/transform";
import { DEFAULT_PARAMS, type Typeface } from "../src/font/types";
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
});
