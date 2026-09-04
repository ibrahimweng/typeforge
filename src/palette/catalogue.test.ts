/**
 * That the palette can reach the whole product, and that it stays that way.
 *
 * The first version of the catalogue read `PARAMS` and `PART_SPECS` and
 * stopped. Both are registries of controls, and so are four more -- the pen,
 * the proportions, the cuts and the casts -- so the palette offered 33 of the
 * product's 64 controls and nothing said so. The pen's own weight, the first
 * thing anybody drawing a face reaches for, could not be found in it at all.
 *
 * It went unnoticed because nothing here knew how many controls there are.
 * The tests asked whether particular queries found particular answers, and
 * every one of them passed: there is a `Weight` in `PARAMS` as well, the
 * whole-font transform in edit mode, so "fatter" had something to answer with.
 *
 * So this counts. Every registry is walked and every control in it has to have
 * an entry, which means a seventh registry added to `parts.ts` and not wired
 * in here fails rather than quietly going missing.
 */

import { describe, expect, it } from "vitest";

import { PARAMS } from "@/components/param-specs";
import { CAST_SPECS, CUT_SPECS, METRIC_CONTROLS, PART_SPECS, PEN_CONTROLS } from "@/forge/parts";

import { catalogue, type Item, type Shell } from "./catalogue";
import { buildIndex, search } from "./search";

const shell = {
  mode: "forge",
  setMode: () => {},
  view: "grid",
  setView: () => {},
  openFile: () => {},
  export: () => {},
  save: () => {},
  newProject: () => {},
  addVersion: () => {},
  toggleHelp: () => {},
  library: () => {},
  selectGlyph: () => {},
  paramOf: () => 0,
  setParam: () => {},
  partOf: () => 0,
  setPart: () => {},
  penOf: () => 0,
  setPen: () => {},
  metricOf: () => 0,
  setMetric: () => {},
  cutOf: () => 0,
  setCut: () => {},
  castOf: () => 0,
  setCast: () => {},
  startFromBase: () => {},
  chooseAlternate: () => {},
  hasFont: true,
} as unknown as Shell;

const items: Item[] = catalogue(shell);
const ids = new Set(items.map((item) => item.id));

describe("the palette reaches every control the product has", () => {
  it("carries the whole font's own numbers", () => {
    for (const spec of PARAMS) expect(ids).toContain(`param:${spec.key}`);
  });

  it("carries every part of a letter", () => {
    for (const part of PART_SPECS)
      for (const control of part.controls)
        expect(ids).toContain(`part:${part.name}:${control.key}`);
  });

  it("carries the pen it is drawn with", () => {
    for (const control of PEN_CONTROLS) expect(ids).toContain(`pen:${control.key}`);
    // Named rather than only counted, because this is the one that was missing
    // and the one anybody reaches for first.
    expect(ids).toContain("pen:weight");
  });

  it("carries the lines the letters stand on", () => {
    for (const control of METRIC_CONTROLS) expect(ids).toContain(`metrics:${control.key}`);
  });

  it("carries every cut, its switch as well as its numbers", () => {
    for (const spec of CUT_SPECS) {
      expect(ids).toContain(`cut:${spec.name}:on`);
      for (const control of spec.controls) expect(ids).toContain(`cut:${spec.name}:${control.key}`);
    }
  });

  it("carries every cast, its switch as well as its numbers", () => {
    for (const spec of CAST_SPECS) {
      expect(ids).toContain(`cast:${spec.name}:on`);
      for (const control of spec.controls)
        expect(ids).toContain(`cast:${spec.name}:${control.key}`);
    }
  });

  /*
   * The count itself, so that a registry added to `parts.ts` and not added
   * here fails rather than passing quietly.
   *
   * Every case above names a registry, and a seventh one would be named by
   * none of them. This one does not have to know what it is called.
   */
  it("offers exactly as many controls as the product has", () => {
    const registries =
      PARAMS.length +
      PART_SPECS.reduce((sum, part) => sum + part.controls.length, 0) +
      PEN_CONTROLS.length +
      METRIC_CONTROLS.length +
      // A cut and a cast are a switch and then their numbers.
      CUT_SPECS.reduce((sum, spec) => sum + spec.controls.length + 1, 0) +
      CAST_SPECS.reduce((sum, spec) => sum + spec.controls.length + 1, 0);
    const offered = items.filter((item) => item.kind === "control").length;
    expect(offered).toBe(registries);
  });

  /* Every control can be moved, chosen or switched. A row that reaches
   * nothing is a row that does nothing when it is picked. */
  it("gives every control something to do", () => {
    const idle = items.filter(
      (item) => item.kind === "control" && !item.adjust && !item.choose && !item.toggle,
    );
    expect(idle.map((item) => item.label)).toEqual([]);
  });
});

describe("the operations answer to what they look like", () => {
  const index = buildIndex(items);
  const onThePage = (query: string, want: string) => {
    const hits = search(index, query, 8);
    const found = hits.map((hit) => hit.entry.label);
    expect(found, `"${query}" did not offer ${want}: ${found.join(", ")}`).toContain(want);
  };

  /*
   * A cut is the thing somebody is most likely to arrive wanting and least
   * likely to know the name of: they have seen the poster, not the panel. So
   * these are written the way somebody describes a shape they have seen, and
   * none of them uses the word the product uses.
   */
  it.each([
    ["make the strokes fatter", "Weight"],
    ["thick and thin like a broad nib", "Contrast"],
    ["the lowercase looks too short", "x-height"],
    ["the tails hang too far below the line", "Descender"],
    ["round letters look smaller than the flat ones", "Overshoot"],
    ["stripes across the letters", "Slots"],
    ["a groove down the middle of every stroke", "Inline"],
    ["jagged teeth down the side", "Saw"],
    ["notches down the left flank", "Saw: Which edge"],
    ["fill the hole in the o with a diamond", "Counters: Shape"],
    ["cut the corners off", "Chamfer"],
    ["a drop shadow like wood type", "Shadow"],
    ["an outline round the letter", "Rim"],
    ["spikes coming off it", "Points"],
    ["soften where strokes meet", "Fillets"],
  ])("%s", (query, want) => onThePage(query, want));
});
