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
import { SANS } from "@/forge/style";
import { emptyTypeface, type Glyph, type Typeface } from "@/font/types";
import {
  FORMAT,
  applyEdits,
  describe as describeProject,
  fromBase64,
  migrate,
  OLDEST,
  readDocument,
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
   * Whether a drawing is work at all is decided before this file sees it.
   *
   * It has to be: the answer is a comparison against the base it started from,
   * which means the styles and the parts -- the drawing engine, on the first
   * screen, to write a file. `worthKeeping` in `forge/document.ts` makes the
   * call and `forge/keeping.test.ts` is where it is checked. What this one has
   * to hold is that whatever arrives here is written down as it arrived.
   */
  it("writes down the drawing it is handed", () => {
    const project = toProject(snapshot({ draw: drawn({ familyName: "Bakerloo" }) }), WHEN);
    expect(project.draw?.familyName).toBe("Bakerloo");
  });

  it("leaves out a half it was handed nothing for", () => {
    expect(toProject({ mode: "forge" }, WHEN).draw).toBeUndefined();
  });

  it("leaves out an empty pile of drawings and keeps one with anything in it", () => {
    const empty = { assembly: emptyAssembly(), familyName: "Untitled", specimen: "Handgloves" };
    expect(toProject(snapshot({ assemble: empty }), WHEN).assemble).toBeUndefined();

    const assembly = emptyAssembly();
    assembly.pieces = [
      {
        id: "slot:A",
        file: "a.svg",
        character: "A",
        contours: [],
        viewBox: { x: 0, y: 0, width: 1, height: 1 },
      },
    ];
    expect(toProject(snapshot({ assemble: { ...empty, assembly } }), WHEN).assemble).toBeDefined();
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
  const good = () =>
    JSON.parse(JSON.stringify(toProject(snapshot({ draw: drawn({ familyName: "Kept" }) }), WHEN)));

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

  it("refuses anything whose version is not a version", () => {
    // The `typeforge` field is the whole of what says a file is ours. Without
    // a whole number in it there is nothing here to read.
    for (const version of ["1", 0, -1, 1.5, null, undefined]) {
      expect(readProject({ ...good(), typeforge: version }), String(version)).toBeNull();
    }
  });

  it("reads what it can of a document from a newer Typeforge", () => {
    /*
     * Rather than refusing it, which is what this used to do and is the wrong
     * trade twice over.
     *
     * Every half below is checked on its own, so a document from a later
     * version loses the halves whose shape changed and keeps the ones that did
     * not. Turning the file away loses those as well. And the session in the
     * browser is read through this same door, so refusing on a version number
     * is not a file somebody still has on disk. It is their work, gone,
     * because they opened yesterday's tab.
     */
    const read = readDocument({ ...good(), typeforge: FORMAT + 1 });
    expect(read.project).not.toBeNull();
    expect(read.project!.draw?.familyName).toBe("Kept");
    expect(read.from).toBe(FORMAT + 1);
    // And says so, because a half that quietly did not come back is worse than
    // one somebody was told about.
    expect(read.note).toContain("newer");
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
    // Handed no halves at all, which is what a session with nothing in it
    // gathers: each store is asked for what it holds and holds nothing.
    expect(describeProject(toProject({ mode: "forge" }, WHEN))).toBe("nothing");
  });
});

/**
 * Bringing an old document forward.
 *
 * The chain is empty, because there has only ever been one version of this
 * format. That is exactly why it is tested with steps of its own rather than
 * with the real table: a mechanism whose first use is the day somebody bumps
 * `FORMAT` is a mechanism nobody has ever seen run, and the day it is first
 * needed is the day every document anybody has saved depends on it.
 *
 * So `migrate` takes its steps as an argument. These tests hand it two and
 * check what a real bump would rely on.
 */
describe("bringing a document forward", () => {
  /** A stand-in for a real step: writes down that it ran, and on what. */
  const step = (mark: string, ran: string[]) => (document: Record<string, unknown>) => {
    ran.push(mark);
    return { ...document, [mark]: true };
  };

  it("runs every step between the version written and this one, in order", () => {
    const ran: string[] = [];
    const steps = { 1: step("one-to-two", ran), 2: step("two-to-three", ran) };
    const brought = migrate({ typeforge: 1, kept: "yes" }, 1, { steps, upTo: 3 });

    expect(ran).toEqual(["one-to-two", "two-to-three"]);
    // Each step got what the one before it gave back, rather than the original.
    expect(brought).toEqual({
      typeforge: 1,
      kept: "yes",
      "one-to-two": true,
      "two-to-three": true,
    });
  });

  it("starts from the version the document says, not from the oldest", () => {
    const ran: string[] = [];
    const steps = { 1: step("one-to-two", ran), 2: step("two-to-three", ran) };
    migrate({ typeforge: 2 }, 2, { steps, upTo: 3 });
    expect(ran).toEqual(["two-to-three"]);
  });

  it("does nothing at all to a document already at the version wanted", () => {
    const ran: string[] = [];
    const document = { typeforge: 3 };
    const brought = migrate(document, 3, { steps: { 1: step("one", ran) }, upTo: 3 });
    expect(ran).toEqual([]);
    expect(brought).toBe(document);
  });

  it("refuses a document older than the oldest step there is", () => {
    expect(migrate({ typeforge: OLDEST - 1 }, OLDEST - 1)).toBeNull();
  });

  it("refuses to carry on past a gap in the chain", () => {
    /*
     * A missing step is a mistake in `format.ts` rather than in the document,
     * and the wrong thing to do about it is carry on: what the reader would
     * get is a shape from a version it does not know, checked against fields
     * it does know, which is how half a document gets restored over somebody's
     * work.
     */
    const ran: string[] = [];
    // Version 1 wanting to reach 3, with only the first of the two steps.
    const steps = { 1: step("one-to-two", ran) };
    expect(migrate({ typeforge: 1 }, 1, { steps, upTo: 3 })).toBeNull();
  });

  it("has a step for every version between the oldest and this one", () => {
    /*
     * The table against the two constants that describe it, which is the check
     * that fails on the bump itself rather than on the first document somebody
     * opens afterwards. `FORMAT` raised without a step added is a chain with a
     * gap in it, and this says so in the same commit.
     */
    for (let version = OLDEST; version < FORMAT; version++) {
      expect(migrate({ typeforge: version }, version), `no step from ${version}`).not.toBeNull();
    }
  });

  it("hands a migrated document to the reader like any other", () => {
    /*
     * The join between the two halves, which is the part a real bump gets
     * wrong. A step gives back a plain object, and what makes it a document is
     * `readDocument` checking it afterwards, not the step saying so.
     */
    const older = {
      ...JSON.parse(JSON.stringify(toProject(snapshot({ draw: drawn() }), WHEN))),
      typeforge: FORMAT,
    };
    const read = readDocument(older);
    expect(read.project).not.toBeNull();
    expect(read.from).toBe(FORMAT);
    // Nothing to say about a document written by this version.
    expect(read.note).toBeNull();
  });
});
