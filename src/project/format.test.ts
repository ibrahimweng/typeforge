/**
 * The document a session is written down as.
 *
 * What is being checked is that what comes back is what went in, and that what
 * goes in is only what has to. Those pull against each other: the safe thing is
 * to write everything down, and the whole reason this is a format rather than a
 * `JSON.stringify` of the application is that everything is a font of six
 * thousand glyphs recording an edit to two of them.
 *
 * The other half of the file is about refusing. A file picker takes whatever it
 * is pointed at, so a holiday photo, an older Typeforge's document and a
 * truncated download all arrive here, and each has to be turned away at the
 * door rather than half-read into somebody's work.
 */

import { describe, expect, it } from "vitest";

import { emptyAssembly } from "@/assemble/document";
import { startFrom } from "@/forge/document";
import { BASES, SANS } from "@/forge/style";
import { emptyTypeface, type Glyph, type Typeface } from "@/font/types";
import {
  FORMAT,
  applyEdits,
  describe as describeProject,
  fromBase64,
  readProject,
  toBase64,
  toProject,
  type Snapshot,
} from "./format";

const WHEN = new Date("2026-01-02T03:04:05.000Z");

function drawn(over: Partial<Snapshot["draw"]> = {}) {
  return { forge: startFrom(SANS), familyName: "Untitled", specimen: "Handgloves", ...over };
}

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return { mode: "forge", draw: drawn(), ...over };
}

describe("what gets written down", () => {
  it("names the format and when it was written", () => {
    const project = toProject(snapshot(), WHEN);
    expect(project.typeforge).toBe(FORMAT);
    expect(project.saved).toBe(WHEN.toISOString());
    expect(project.mode).toBe("forge");
  });

  /*
   * A base on its own is not work.
   *
   * The application opens on one, so writing that down would restore somebody
   * into a font they never made -- and worse, would do it over the top of the
   * one they did, since arriving is what triggers the restore.
   */
  it("leaves out a drawing nobody has touched", () => {
    expect(toProject(snapshot(), WHEN).draw).toBeUndefined();
  });

  it("keeps one the moment it differs from its base", () => {
    const forge = startFrom(SANS);
    forge.style.pen.weight = SANS.pen.weight + 30;
    expect(toProject(snapshot({ draw: drawn({ forge }) }), WHEN).draw).toBeDefined();
  });

  it("keeps one that has been named, even if nothing else changed", () => {
    const project = toProject(snapshot({ draw: drawn({ familyName: "Bakerloo" }) }), WHEN);
    expect(project.draw?.familyName).toBe("Bakerloo");
  });

  it("keeps a drawing whose letters were told to differ", () => {
    const forge = startFrom(SANS);
    forge.exceptions = { n: { shoulder: { spring: 0.9 } } };
    expect(toProject(snapshot({ draw: drawn({ forge }) }), WHEN).draw).toBeDefined();
  });

  it("holds every base it can be started from", () => {
    // A base whose own style did not survive the comparison would read as
    // touched the moment it was opened, and every session would save one.
    for (const base of BASES) {
      const project = toProject(snapshot({ draw: drawn({ forge: startFrom(base) }) }), WHEN);
      expect(project.draw, `${base.name} reads as edited when it is not`).toBeUndefined();
    }
  });

  it("leaves out an empty pile of drawings and keeps one with anything in it", () => {
    const empty = { assembly: emptyAssembly(), familyName: "Untitled", specimen: "Handgloves" };
    expect(toProject(snapshot({ assemble: empty }), WHEN).assemble).toBeUndefined();

    const assembly = emptyAssembly();
    assembly.pieces = [
      { id: "slot:A", file: "a.svg", character: "A", contours: [], viewBox: { x: 0, y: 0, width: 1, height: 1 } },
    ];
    expect(
      toProject(snapshot({ assemble: { ...empty, assembly } }), WHEN).assemble,
    ).toBeDefined();
  });
});

describe("an edited font", () => {
  function fontWith(dirty: string[]): { typeface: Typeface; fileName: string } {
    const typeface = emptyTypeface();
    typeface.source = {
      bytes: new Uint8Array([0, 1, 0, 0, 9, 9, 9]),
      sfntVersion: 0x10000,
      tables: new Map(),
      isCFF: false,
      fileName: "Test.ttf",
    };
    typeface.glyphs = ["A", "B", "C"].map(
      (name): Glyph => ({
        name,
        unicodes: [name.codePointAt(0)!],
        advanceWidth: 500,
        contours: [],
        components: [],
        anchors: [],
        params: dirty.includes(name) ? { weight: 12 } : {},
        dirty: dirty.includes(name),
      }),
    );
    typeface.glyphIndex = new Map(typeface.glyphs.map((glyph, at) => [glyph.name, at]));
    return { typeface, fileName: "Test.ttf" };
  }

  /*
   * The reason this is a format.
   *
   * A font is six thousand glyphs. Writing all of them down to record that
   * somebody moved two would be fifty megabytes describing fifty bytes of work
   * -- too slow to write while somebody is drawing, and too big to keep.
   */
  it("carries the file and only the glyphs that were touched", () => {
    const project = toProject(snapshot({ mode: "edit", edit: fontWith(["B"]) }), WHEN);
    expect(project.edit?.glyphs.map((glyph) => glyph.name)).toEqual(["B"]);
    expect(project.edit?.fileName).toBe("Test.ttf");
    expect(fromBase64(project.edit!.font)).toEqual(new Uint8Array([0, 1, 0, 0, 9, 9, 9]));
  });

  it("carries a font nobody has edited as its own bytes and nothing else", () => {
    const project = toProject(snapshot({ mode: "edit", edit: fontWith([]) }), WHEN);
    expect(project.edit?.glyphs).toEqual([]);
    expect(project.edit?.font.length).toBeGreaterThan(0);
  });

  /*
   * Matched by name, never by position.
   *
   * A font re-read from its own bytes has its glyphs in the same order, so
   * position would work -- until the day the parser changed, when it would
   * quietly put somebody's edited A onto their B.
   */
  it("lays the saved glyphs back on by name", () => {
    const saved = toProject(snapshot({ mode: "edit", edit: fontWith(["B"]) }), WHEN).edit!;
    saved.glyphs[0].advanceWidth = 987;

    const fresh = fontWith([]).typeface;
    // Read back in a different order, as a changed parser might.
    fresh.glyphs.reverse();
    fresh.glyphIndex = new Map(fresh.glyphs.map((glyph, at) => [glyph.name, at]));

    applyEdits(fresh, saved);
    const b = fresh.glyphs[fresh.glyphIndex.get("B")!];
    expect(b.advanceWidth).toBe(987);
    expect(fresh.glyphs[fresh.glyphIndex.get("A")!].advanceWidth).toBe(500);
  });

  /*
   * A second weight is a set of exceptions to the first, on the same terms as
   * the first is a set of exceptions to the file it came from. A font with one
   * weight -- which is almost all of them -- is written exactly as it always
   * was, with neither field present.
   */
  it("writes nothing about weights when there is only one", () => {
    const one = fontWith(["B"]);
    const saved = toProject(
      snapshot({
        mode: "edit",
        edit: { ...one, masters: [{ id: "m1", name: "Regular", at: { wght: 400 }, glyphs: [] }] },
      }),
      WHEN,
    ).edit!;
    expect(saved.masters).toBeUndefined();
    expect(saved.weight).toEqual({ name: "Regular", at: { wght: 400 } });
  });

  it("writes a second weight as the letters drawn in it, and no others", () => {
    const one = fontWith(["B"]);
    const bold: Glyph = { ...one.typeface.glyphs[0], advanceWidth: 800, dirty: true };
    const saved = toProject(
      snapshot({
        mode: "edit",
        edit: {
          ...one,
          masters: [
            { id: "m1", name: "Regular", at: { wght: 400 }, glyphs: [] },
            { id: "m2", name: "Bold", at: { wght: 700 }, glyphs: [bold] },
          ],
        },
      }),
      WHEN,
    ).edit!;

    expect(saved.masters).toHaveLength(1);
    expect(saved.masters![0].id).toBe("m2");
    expect(saved.masters![0].at).toEqual({ wght: 700 });
    expect(saved.masters![0].glyphs).toHaveLength(1);
    expect(saved.masters![0].glyphs[0].advanceWidth).toBe(800);
    // And the font itself is still the first weight's own letters.
    expect(saved.glyphs.map((one) => one.name)).toEqual(["B"]);
  });

  it("adds a glyph the saved document has and the font does not", () => {
    const saved = toProject(snapshot({ mode: "edit", edit: fontWith(["B"]) }), WHEN).edit!;
    saved.glyphs[0] = { ...saved.glyphs[0], name: "aacute" };
    const fresh = fontWith([]).typeface;
    applyEdits(fresh, saved);
    expect(fresh.glyphIndex.get("aacute")).toBe(3);
    expect(fresh.glyphs).toHaveLength(4);
  });
});

describe("bytes through text and back", () => {
  it("returns exactly what went in", () => {
    const bytes = new Uint8Array(1000);
    for (let at = 0; at < bytes.length; at++) bytes[at] = (at * 7) % 256;
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  /*
   * Big enough to break the one-liner everybody writes.
   *
   * `String.fromCharCode(...bytes)` spreads every byte as an argument, and a
   * real font overflows the call stack doing it -- at exactly the size where
   * somebody has finally opened something worth saving.
   */
  it("survives a font-sized run", () => {
    const bytes = new Uint8Array(700_000).map((_, at) => at % 256);
    const text = toBase64(bytes);
    expect(text.length).toBeGreaterThan(900_000);
    expect(fromBase64(text)).toEqual(bytes);
  });

  it("handles nothing at all", () => {
    expect(fromBase64(toBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });
});

describe("what gets turned away", () => {
  const good = () => JSON.parse(JSON.stringify(toProject(snapshot({ draw: drawn({ familyName: "Kept" }) }), WHEN)));

  it("takes one of its own back", () => {
    const read = readProject(good());
    expect(read).not.toBeNull();
    expect(read!.draw?.familyName).toBe("Kept");
    expect(read!.mode).toBe("forge");
  });

  it("refuses anything that is not a document", () => {
    for (const raw of [null, undefined, 4, "typeforge", [], {}, { hello: "world" }]) {
      expect(readProject(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("refuses a document from another version", () => {
    expect(readProject({ ...good(), typeforge: FORMAT + 1 })).toBeNull();
    expect(readProject({ ...good(), typeforge: "1" })).toBeNull();
  });

  it("refuses one that does not say which half it was", () => {
    expect(readProject({ ...good(), mode: "sideways" })).toBeNull();
    expect(readProject({ ...good(), mode: undefined })).toBeNull();
  });

  it("drops a half that arrived empty rather than restoring nothing over the top", () => {
    const read = readProject({ ...good(), assemble: {}, edit: {} });
    expect(read).not.toBeNull();
    expect(read!.assemble).toBeUndefined();
    expect(read!.edit).toBeUndefined();
  });
});

describe("saying what is in it", () => {
  it("names each half", () => {
    const project = toProject(
      snapshot({ draw: drawn({ familyName: "Bakerloo" }), mode: "forge" }),
      WHEN,
    );
    expect(describeProject(project)).toContain("Bakerloo");
  });

  it("says so when there is nothing in it", () => {
    expect(describeProject(toProject(snapshot(), WHEN))).toBe("nothing");
  });
});
