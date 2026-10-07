/**
 * A varying font's file is named for its family and its axes, sorted, however
 * it was written: an opened font listed its weight axis before its width and
 * came out `Family[wght,wdth]`, while a Draw family with the same two came
 * out `Family[wdth,wght]`.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { exportFont, variableName } from "./export";
import { importFont } from "./parse";

describe("a varying font's file name", () => {
  it("lists the axes sorted, whatever order they were given in", () => {
    expect(variableName("Bench", ["wght", "wdth"])).toBe("Bench[wdth,wght]");
    expect(variableName("Bench", ["wdth", "wght"])).toBe("Bench[wdth,wght]");
    expect(variableName("My Font!", ["wght"])).toBe("MyFont[wght]");
    expect(variableName("  ", ["wght", "GRAD", "opsz"])).toBe("Untitled[GRAD,opsz,wght]");
  });

  it("is what an opened font is written as, with a weight axis listed before a width", async () => {
    const bytes = new Uint8Array(readFileSync("src/assets/typeforge-sample.ttf"));
    const typeface = (await importFont(bytes, "sample.ttf")).typeface;
    const em = typeface.unitsPerEm;
    const at = (weight: number, width: number) => ({
      ...typeface,
      params: { ...typeface.params, weight: weight * em, width },
    });
    const written = await exportFont(typeface, {
      format: "ttf",
      fidelity: "rebuild",
      now: 0,
      resolving: { threads: 0 },
      variable: {
        axes: [
          { tag: "wght", label: "Weight", min: 400, default: 400, max: 700 },
          { tag: "wdth", label: "Width", min: 75, default: 100, max: 100 },
        ],
        instances: [],
        masters: [
          { at: { wght: 700, wdth: 100 }, typeface: at(0.02, 1) },
          { at: { wght: 400, wdth: 75 }, typeface: at(0, 0.8) },
        ],
      },
    });
    expect(written.fileName).toBe(
      `${variableName(typeface.meta.familyName, ["wdth", "wght"])}.ttf`,
    );
    expect(written.fileName).toMatch(/\[wdth,wght\]\.ttf$/);
  });
});
