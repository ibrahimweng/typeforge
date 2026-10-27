/**
 * Every version of a font keeps its own settings.
 *
 * Weight, width, slant and the rest are applied to every letter on the way out,
 * so they are part of how a version is drawn rather than part of the document
 * around it. They used to be shared like the kerning: moving Weight in the Bold
 * moved the Regular with it, the two were always the same letters, and a
 * variable font exported from them listed a Regular and a Bold that drew
 * exactly alike. Its `gvar` held no movement for a single glyph.
 */

import { readFileSync } from "node:fs";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ready } from "@/font/boolean";
import { exportFont } from "@/font/export";
import { varyByDrawnVersions } from "@/font/masters";
import { toProject } from "@/project/format";

const SAMPLE = new Uint8Array(
  readFileSync(new URL("../assets/typeforge-sample.ttf", import.meta.url)),
);

type Store = typeof import("./store")["store"];
let store: Store;

beforeAll(async () => {
  await ready();
});

beforeEach(async () => {
  vi.resetModules();
  store = (await import("./store")).store;
  await store.loadFont(SAMPLE, "sample.ttf");
});

/** How many glyphs a variable font says move at all, read off its `gvar`. */
function glyphsThatMove(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = view.getUint16(4);
  let gvar = -1;
  for (let at = 0; at < tables; at++) {
    const record = 12 + at * 16;
    const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
    if (tag === "gvar") gvar = view.getUint32(record + 8);
  }
  if (gvar < 0) return 0;
  const count = view.getUint16(gvar + 12);
  const long = (view.getUint16(gvar + 14) & 1) === 1;
  const offset = (index: number): number =>
    long ? view.getUint32(gvar + 20 + index * 4) : view.getUint16(gvar + 20 + index * 2) * 2;
  let moving = 0;
  for (let index = 0; index < count; index++) {
    if (offset(index + 1) > offset(index)) moving += 1;
  }
  return moving;
}

describe("a version's own settings", () => {
  it("start a new weight heavier than the one it was copied from", () => {
    const regular = store.getSnapshot().masters[0];
    store.addMaster();
    const bold = store.getSnapshot().masters[1];

    expect(bold.at.wght).toBe(700);
    expect(bold.typeface.params.weight).toBeGreaterThan(regular.typeface.params.weight);
  });

  it("start a version on another axis from the settings at its own weight", () => {
    // Added while the Bold is open, the Condensed still sits at the Regular's
    // weight, so it starts on the Regular's Weight rather than the Bold's.
    const regular = store.getSnapshot().masters[0];
    store.addMaster();
    store.addMaster("wdth");
    const condensed = store.getSnapshot().masters[2];
    expect(condensed.at.wght).toBe(regular.at.wght);
    expect(condensed.typeface.params.weight).toBe(regular.typeface.params.weight);
  });

  it("change only the version being drawn", () => {
    const regular = store.getSnapshot().masters[0];
    const before = regular.typeface.params.weight;
    store.addMaster();
    const bold = store.getSnapshot().masters[1];

    store.setFamilyParam("weight", 40);
    expect(bold.typeface.params.weight).toBe(40);
    expect(regular.typeface.params.weight, "and the Regular stays where it was").toBe(before);

    // And the other way round, with a different control.
    store.goToMaster(regular.id);
    store.setFamilyParam("slant", 8);
    expect(regular.typeface.params.slant).toBe(8);
    expect(bold.typeface.params.slant).toBe(0);
  });

  it("are put back by undo in the version they were made in", () => {
    store.addMaster();
    const [regular, bold] = store.getSnapshot().masters;
    const was = { ...bold.typeface.params };
    store.setFamilyParam("weight", 45);
    store.commitFamilyParams("Set weight", was);
    store.undo();
    expect(bold.typeface.params.weight).toBe(was.weight);
    expect(regular.typeface.params.weight).toBe(0);
  });

  it("still share the kerning and the names", () => {
    store.addMaster();
    const [regular] = store.getSnapshot().masters;
    store.setMeta({ familyName: "Shared Name" });
    expect(regular.typeface.meta.familyName).toBe("Shared Name");
  });

  it("are saved with each version and come back with it", async () => {
    store.addMaster();
    store.setFamilyParam("weight", 42);
    const kept = toProject(
      { mode: "edit", edits: store.snapshots(), editAt: store.getSnapshot().openAt },
      new Date(),
    );

    store.startBlank();
    await store.restoreAll(kept.edits!, kept.editAt ?? 0);
    const [regular, bold] = store.getSnapshot().masters;
    expect(bold.typeface.params.weight).toBe(42);
    expect(regular.typeface.params.weight).toBe(0);
  });

  it("make a variable font whose weights really differ", async () => {
    store.addMaster();
    const masters = store.getSnapshot().masters;
    const varying = varyByDrawnVersions(masters);
    expect(varying).not.toBeNull();

    const result = await exportFont(masters[0].typeface, {
      format: "ttf",
      fidelity: "rebuild",
      includeKerning: true,
      mergeOverlaps: false,
      variable: varying!,
    });
    // Nought is what the shared settings wrote: a Bold that was the Regular.
    expect(glyphsThatMove(result.bytes)).toBeGreaterThan(100);
  }, 120_000);
});

describe("a font with no style name", () => {
  it("is named as a Regular inside the file, not with a hyphen at the end", async () => {
    store.setMeta({ familyName: "Beetle Sans", styleName: "" });
    const typeface = store.getSnapshot().typeface!;
    const result = await exportFont(typeface, {
      format: "ttf",
      fidelity: "rebuild",
      includeKerning: true,
    });
    const text = new TextDecoder("utf-16be").decode(result.bytes);
    expect(text).toContain("BeetleSans-Regular");
    expect(result.fileName).toBe("BeetleSans-Regular.ttf");
  }, 120_000);
});

describe("the width a person types", () => {
  it("is the width they see, with the Weight setting moved", async () => {
    const { drawnAdvanceFor, resolveAdvanceWidth } = await import("@/font/transform");
    store.addMaster();
    const typeface = store.getSnapshot().typeface!;
    const o = store.glyph("o")!;
    // A heavier Bold carries more room than its drawing, which is the case
    // that read 1034 after 880 was typed.
    expect(resolveAdvanceWidth(o, typeface)).not.toBe(o.advanceWidth);
    const drawn = drawnAdvanceFor(o, typeface, 880);
    expect(
      Math.abs(resolveAdvanceWidth({ ...o, advanceWidth: drawn }, typeface) - 880),
    ).toBeLessThan(1);
  });
});
