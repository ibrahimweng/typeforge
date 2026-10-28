/**
 * Rounded corners in a font that varies.
 *
 * The corner control rounds a letter after its weight is set, and it used to
 * decide which points were corners from the outline at that weight. The
 * weight moves a join until it turns by less, or folds two points onto one, so
 * the Black rounded fewer corners than the Regular and came out with fewer
 * points -- and a variable font blends point for point. Lora, taken to the
 * corner control's limit at three weights, had 159 letters that could not
 * vary at all: every A, the B, the E, the H, the I and most of the rest.
 *
 * Now the drawing decides which points are corners, and the weight only how
 * far each is rounded, so every weight has the points every other one has.
 */

import { readFileSync } from "node:fs";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ready } from "@/font/boolean";
import { exportFont } from "@/font/export";
import { varyByDrawnVersions } from "@/font/masters";
import { resolveGlyphContours } from "@/font/transform";

const SAMPLE = new Uint8Array(
  readFileSync(new URL("../assets/typeforge-sample.ttf", import.meta.url)),
);

type Store = typeof import("@/state/store")["store"];
let store: Store;

beforeAll(async () => {
  await ready();
});

beforeEach(async () => {
  vi.resetModules();
  store = (await import("@/state/store")).store;
  await store.loadFont(SAMPLE, "sample.ttf");
});

/** Three weights, each with its own Weight and the corners rounded right up. */
function threeRoundedWeights(): void {
  const regular = store.getSnapshot().masters[0].id;
  const bold = store.addMaster()!;
  const black = store.addMaster()!;
  store.placeMaster(black, "wght", 900);
  for (const [id, weight] of [
    [regular, -10],
    [bold, 2],
    [black, 40],
  ] as const) {
    store.goToMaster(id);
    store.setFamilyParam("weight", weight);
    store.setFamilyParam("cornerRadius", 150);
  }
}

describe("rounded corners at every weight", () => {
  it("give every weight of a letter the same points", () => {
    threeRoundedWeights();
    const masters = store.getSnapshot().masters;
    for (const name of ["A", "B", "E", "H", "I", "n", "y", "four", "guillemotright"]) {
      const counts = masters.map((master) => {
        const at = master.typeface.glyphIndex.get(name);
        if (at === undefined) return "absent";
        return resolveGlyphContours(master.typeface.glyphs[at], master.typeface)
          .map((contour) => contour.nodes.length)
          .join("+");
      });
      expect(new Set(counts).size, `${name}: ${counts.join(" | ")}`).toBe(1);
    }
  });

  it("leave no letter out of a variable font", async () => {
    threeRoundedWeights();
    const masters = store.getSnapshot().masters;
    const result = await exportFont(masters[0].typeface, {
      format: "ttf",
      fidelity: "rebuild",
      includeKerning: false,
      mergeOverlaps: false,
      variable: varyByDrawnVersions(masters)!,
    });
    expect(result.held).toEqual([]);
  }, 300_000);
});
