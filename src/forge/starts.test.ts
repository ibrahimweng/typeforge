/**
 * The faces offered to start from (`starts.ts`), and starting from them.
 *
 * A starting face is a document somebody could have made on a base, offered
 * whole. So it is held to being exactly that: drawn on a base that exists,
 * under that base's name, inside every control the panel shows, a document
 * that opens and is worth keeping -- and started the way a base is started,
 * from the panel and from the palette, without becoming a base itself.
 */

import { describe, expect, it, vi } from "vitest";

import { catalogue, type Shell } from "@/palette/catalogue";
import { forgeControls } from "@/palette/forge-controls";
import { forgeStore } from "@/state/forge-store";
import { BASE_COUNT } from "./base-count";
import { drawLetter, letterNames } from "./build";
import { draw, formOf, startFrom, whole, worthKeeping, type Forge } from "./document";
import {
  METRIC_CONTROLS,
  PART_SPECS,
  PEN_CONTROLS,
  SCRIPT_CONTROLS,
  type FieldControl,
} from "./parts";
import { SOFT_SERIF, STARTS, startNamed } from "./starts";
import { BASES, SERIF, type Style } from "./style";

/** The soft finishes, where they live, and the range each may be set in (plan section 1.2). */
const FINISHES: Array<[string, string, number, number]> = [
  ["slab", "tip", 0, 1],
  ["slab", "swell", 0, 0.6],
  ["terminal", "soft", 0, 0.5],
  ["terminal", "taper", 0, 0.85],
  ["terminal", "dropSize", -0.3, 0.6],
  ["terminal", "dropHang", 0, 1.5],
  ["terminal", "dropCurl", 0, 1],
  ["terminal", "dropNeck", 0, 1],
  ["corner", "fillet", 0, 1],
  ["bowl", "tail", 0, 1.5],
  ["bowl", "heft", 0, 0.5],
  ["shoulder", "rise", 0, 0.8],
];

const partOf = (style: Style, part: string): Record<string, unknown> =>
  (style.parts as unknown as Record<string, Record<string, unknown>>)[part];

/** The style with every soft finish taken out, as a version from before them wrote it. */
function older(forge: Forge): Forge {
  const written = JSON.parse(JSON.stringify(forge)) as Forge;
  for (const [part, key] of FINISHES) delete partOf(written.style, part)[key];
  delete partOf(written.style, "bowl").heftTilt;
  delete (written.style.metrics as unknown as Record<string, unknown>).dotScale;
  return written;
}

const SOFT = startNamed("soft-serif")!;

describe("the faces offered to start from", () => {
  it("are each drawn on a base, under that base's name and heading", () => {
    expect(STARTS.length).toBeGreaterThan(0);
    expect(new Set(STARTS.map((start) => start.id)).size).toBe(STARTS.length);
    expect(new Set(STARTS.map((start) => start.label)).size).toBe(STARTS.length);
    for (const start of STARTS) {
      const base = BASES.find((one) => one.name === start.base);
      expect(base, start.id).toBeDefined();
      // The engine asks a great deal by the base's name, and should get the
      // base's answers for a face drawn on it.
      expect(start.style.name, start.id).toBe(start.base);
      expect(start.style.family, start.id).toBe(base!.family);
      expect(start.family, start.id).toBe(base!.family);
      // Never mistaken for a base: not one of them, and not named as one, so
      // a base's button and the face's are told apart by what they say.
      expect(BASES).not.toContain(start.style);
      expect(BASES.map((one) => one.name)).not.toContain(start.label);
      expect(startNamed(start.id)).toBe(start);
    }
    expect(startNamed("no such face")).toBeUndefined();
  });

  it("leave the bases as many as they were", () => {
    expect(BASES.length).toBe(21);
    expect(BASE_COUNT).toBe(21);
  });

  it("sit inside every control the panel shows, as a base does", () => {
    const outside: string[] = [];
    for (const start of STARTS) {
      const { style } = start;
      const em = style.metrics.unitsPerEm;
      const check = (where: string, control: FieldControl, value: unknown) => {
        if (typeof value !== "number") return;
        const scale = control.emRelative ? em : 1;
        if (value < control.min * scale - 1e-9 || value > control.max * scale + 1e-9)
          outside.push(`${start.id} ${where}.${control.key} = ${value}`);
      };
      for (const control of PEN_CONTROLS)
        check("pen", control, (style.pen as unknown as Record<string, unknown>)[control.key]);
      for (const control of METRIC_CONTROLS)
        check(
          "metrics",
          control,
          (style.metrics as unknown as Record<string, unknown>)[control.key],
        );
      for (const control of SCRIPT_CONTROLS)
        check("script", control, partOf(style, "script")[control.key]);
      for (const spec of PART_SPECS)
        for (const control of spec.controls)
          check(spec.name, control as FieldControl, partOf(style, spec.name)?.[control.key]);
    }
    expect(outside).toEqual([]);
  });
});

describe("the Soft Serif", () => {
  it("is offered as the Soft Serif, on the Serif", () => {
    expect(SOFT.label).toBe("Soft Serif");
    expect(SOFT.base).toBe("Serif");
    expect(SOFT.family).toBe("serif");
    expect(SOFT.style).toBe(SOFT_SERIF);
  });

  it("turns every soft finish on, each inside its range, and leaves the Serif without them", () => {
    for (const [part, key, min, max] of FINISHES) {
      const value = partOf(SOFT_SERIF, part)[key];
      expect(typeof value, `${part}.${key}`).toBe("number");
      expect(value as number, `${part}.${key}`).toBeGreaterThan(0);
      expect(value as number, `${part}.${key}`).toBeGreaterThanOrEqual(min);
      expect(value as number, `${part}.${key}`).toBeLessThanOrEqual(max);
      expect(partOf(SERIF, part)[key], `the Serif's ${part}.${key}`).toBeUndefined();
    }
    const dot = SOFT_SERIF.metrics.dotScale!;
    expect(dot).toBeGreaterThanOrEqual(0.7);
    expect(dot).toBeLessThanOrEqual(1.5);
    expect(SERIF.metrics.dotScale).toBeUndefined();
    // Read only when there is heft, and left level.
    expect(SOFT_SERIF.parts.bowl.heftTilt ?? 0).toBe(0);
  });

  it("draws its own a, y and f, and the Serif's forms for everything else", () => {
    expect(SOFT_SERIF.forms).toEqual({ ...SERIF.forms, a: "curled", y: "swung", f: "tucked" });
    expect(SERIF.forms?.a).toBe("humanist");
    expect(SERIF.forms?.y).toBe("hooked");
    expect(SERIF.forms?.f).toBeUndefined();
  });
});

describe("a Soft Serif document", () => {
  const forge: Forge = { ...startFrom(structuredClone(SOFT.style)), base: SOFT.base };

  it("opens whole, unchanged, and is worth keeping", () => {
    const opened = whole(forge);
    expect(JSON.stringify(opened.style)).toBe(JSON.stringify(forge.style));
    expect(JSON.stringify(opened.style)).toBe(JSON.stringify(SOFT_SERIF));
    expect(opened.base).toBe("Serif");
    expect(formOf(opened, "a")).toBe("curled");
    expect(formOf(opened, "aacute")).toBe("curled");
    expect(formOf(opened, "y")).toBe("swung");
    expect(formOf(opened, "f")).toBe("tucked");
    // A base on its own is not work; this is, whatever it is called.
    expect(worthKeeping(forge, "Untitled")).toBe(true);
    expect(worthKeeping(forge, "Soft Serif")).toBe(true);
    expect(worthKeeping(startFrom(SERIF), "Untitled")).toBe(false);
  });

  it("is the same document written out and read back", () => {
    const read = whole(JSON.parse(JSON.stringify(whole(forge))) as Forge);
    expect(JSON.stringify(read)).toBe(JSON.stringify(whole(forge)));
    for (const letter of ["a", "e", "f", "n", "y", "E", "c", "i"]) {
      expect(draw(letter, read)?.contours, letter).toEqual(draw(letter, forge)?.contours);
    }
  });

  /*
   * Written by a version that knew none of the finishes: every field is filled
   * from the Serif, which has none of them, so it opens as the Serif at the
   * Soft Serif's pen and forms -- every letter drawn, nothing thrown.
   */
  it("opens when it was written by a version without the soft finishes", () => {
    const old = older(forge);
    expect(JSON.stringify(old.style)).not.toContain("dropNeck");
    const opened = whole(old);
    expect(partOf(opened.style, "slab").tip).toBeUndefined();
    expect(opened.style.metrics.dotScale).toBeUndefined();
    const plain = old.style;
    const blank: string[] = [];
    for (const letter of letterNames()) {
      const drawn = draw(letter, opened);
      const inked = (drawLetter(letter, SERIF)?.contours.length ?? 0) > 0;
      if (inked && (!drawn || drawn.contours.length === 0)) blank.push(letter);
    }
    expect(blank).toEqual([]);
    for (const letter of ["a", "c", "e", "f", "n", "y", "E"]) {
      expect(draw(letter, opened)?.contours, letter).toEqual(
        drawLetter(letter, plain, formOf(opened, letter) || undefined)?.contours,
      );
    }
  });
});

describe("starting from the Soft Serif", () => {
  const start = () => forgeStore.startFromStyle(structuredClone(SOFT.style), SOFT.base, SOFT.label);

  it("starts the face on its base, named for it", () => {
    forgeStore.setFamilyName("Untitled");
    start();
    const { forge, familyName } = forgeStore.getSnapshot();
    expect(familyName).toBe("Soft Serif");
    expect(forge.base).toBe("Serif");
    expect(JSON.stringify(forge.style)).toBe(JSON.stringify(SOFT_SERIF));
    expect(forge.alternates).toEqual(SOFT_SERIF.forms);
    expect(forge.exceptions).toEqual({});
    expect(worthKeeping(forge, familyName)).toBe(true);
    // Its own copy: drawing on it does not reach the face it started from.
    expect(forge.style).not.toBe(SOFT_SERIF);
    expect(forge.style.parts).not.toBe(SOFT_SERIF.parts);
  });

  it("hands back the same document, and writes nothing to undo, when started again", () => {
    forgeStore.startFromBase("Sans");
    start();
    const first = forgeStore.getSnapshot().forge;
    start();
    expect(forgeStore.getSnapshot().forge).toBe(first);
    forgeStore.undo();
    expect(forgeStore.getSnapshot().forge.base).toBe("Sans");
    forgeStore.redo();
    expect(forgeStore.getSnapshot().forge).toBe(first);
    // Gone to another base and back, it is the document already drawn.
    forgeStore.startFromBase("Serif");
    start();
    expect(forgeStore.getSnapshot().forge).toBe(first);
  });

  it("goes back to the face as it ships after an edit, undoably", () => {
    start();
    const first = forgeStore.getSnapshot().forge;
    forgeStore.changePen({ weight: 120 }, "single");
    expect(forgeStore.getSnapshot().forge.style.pen.weight).toBe(120);
    start();
    expect(forgeStore.getSnapshot().forge).toBe(first);
    expect(forgeStore.getSnapshot().forge.style.pen.weight).toBe(SOFT_SERIF.pen.weight);
    forgeStore.undo();
    expect(forgeStore.getSnapshot().forge.style.pen.weight).toBe(120);
  });

  it("starts afresh when the document it was started as has changed in place", () => {
    start();
    const first = forgeStore.getSnapshot().forge;
    forgeStore.startFromBase("Sans");
    // Nothing here edits a document in place, and this is what would happen
    // if something ever did.
    first.style.pen.weight += 30;
    start();
    const again = forgeStore.getSnapshot().forge;
    expect(again).not.toBe(first);
    expect(again.style.pen.weight).toBe(SOFT_SERIF.pen.weight);
  });

  it("names the font as a base does: a given name follows it, a typed one stays", () => {
    forgeStore.setFamilyName("Untitled");
    forgeStore.startFromBase("Sans");
    expect(forgeStore.getSnapshot().familyName).toBe("My Sans");
    start();
    expect(forgeStore.getSnapshot().familyName).toBe("Soft Serif");
    forgeStore.startFromBase("Serif");
    expect(forgeStore.getSnapshot().familyName).toBe("My Serif");
    start();
    expect(forgeStore.getSnapshot().familyName).toBe("Soft Serif");
    forgeStore.setFamilyName("Harbour");
    forgeStore.startFromBase("Sans");
    start();
    expect(forgeStore.getSnapshot().familyName).toBe("Harbour");
  });

  it("leaves the library's start as it was: named for the style, undoable every time", () => {
    const measured: Style = { ...structuredClone(SERIF), name: "Measured" };
    forgeStore.startFromBase("Sans");
    forgeStore.startFromStyle(measured, "Serif");
    expect(forgeStore.getSnapshot().familyName).toBe("Measured");
    const first = forgeStore.getSnapshot().forge;
    forgeStore.startFromStyle(structuredClone(measured), "Serif");
    expect(forgeStore.getSnapshot().forge).not.toBe(first);
    forgeStore.undo();
    expect(forgeStore.getSnapshot().forge).toBe(first);
  });

  it("is started the same way from the palette", () => {
    forgeStore.setFamilyName("Untitled");
    forgeStore.startFromBase("Sans");
    forgeControls().startFromFace("soft-serif");
    const { forge, familyName } = forgeStore.getSnapshot();
    expect(familyName).toBe("Soft Serif");
    expect(JSON.stringify(forge.style)).toBe(JSON.stringify(SOFT_SERIF));
    // An id that names nothing does nothing.
    forgeControls().startFromFace("no such face");
    expect(forgeStore.getSnapshot().forge).toBe(forge);
  });
});

describe("the palette's faces", () => {
  const setMode = vi.fn();
  const startFromFace = vi.fn();
  const startFromBase = vi.fn();
  const items = catalogue({
    mode: "forge",
    setMode,
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
    startFromBase,
    startFromFace,
    chooseAlternate: () => {},
    hasFont: true,
    openFonts: [{ id: "font-0", name: "Bakerloo" }],
    openAt: 0,
    goToFont: () => {},
    reopenable: "Bakerloo",
    reopenFont: () => {},
  } as unknown as Shell);

  it("offer each starting face beside the bases, and warn before replacing the work", () => {
    const faces = items.filter((item) => item.kind === "face");
    expect(faces.length).toBe(BASES.length + STARTS.length);
    for (const base of BASES) expect(faces.map((one) => one.id)).toContain(`face:${base.name}`);
    const soft = items.find((item) => item.id === "start:soft-serif")!;
    expect(soft).toBeDefined();
    expect(soft.kind).toBe("face");
    expect(soft.group).toBe("Start from a face");
    expect(soft.label).toBe("Soft Serif");
    expect(soft.hint).toBe(SOFT_SERIF.blurb);
    expect(soft.destructive).toBe(true);
    soft.run!();
    expect(setMode).toHaveBeenCalledWith("forge");
    expect(startFromFace).toHaveBeenCalledWith("soft-serif");
    expect(startFromBase).not.toHaveBeenCalled();
  });
});
