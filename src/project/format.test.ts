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
  /** A font that never came from a file: no source, and letters of its own. */
  function madeHere(names: string[]): Typeface {
    const typeface = emptyTypeface();
    typeface.meta = { ...typeface.meta, familyName: "Made Here" };
    typeface.glyphs = names.map((name) => ({
      name,
      unicodes: [name.codePointAt(0)!],
      advanceWidth: 500,
      contours: [],
      components: [],
      anchors: [],
      params: {},
      dirty: false,
    }));
    typeface.glyphIndex = new Map(typeface.glyphs.map((glyph, at) => [glyph.name, at]));
    return typeface;
  }

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
    const project = toProject(snapshot({ mode: "edit", edits: [fontWith(["B"])] }), WHEN);
    expect(project.edits?.[0]?.glyphs.map((glyph) => glyph.name)).toEqual(["B"]);
    expect(project.edits?.[0]?.fileName).toBe("Test.ttf");
    expect(fromBase64(project.edits![0].font!)).toEqual(new Uint8Array([0, 1, 0, 0, 9, 9, 9]));
  });

  it("carries a font nobody has edited as its own bytes and nothing else", () => {
    const project = toProject(snapshot({ mode: "edit", edits: [fontWith([])] }), WHEN);
    expect(project.edits?.[0]?.glyphs).toEqual([]);
    expect(project.edits?.[0]?.font?.length).toBeGreaterThan(0);
  });

  it("writes down every font that is open, in the order their tabs sit in", () => {
    /*
     * All of them, because the session is written on a timer: one that kept
     * only the front font would lose the other tabs on the next reload, work
     * that was on screen a second earlier, with nothing said.
     */
    const project = toProject(
      { mode: "edit", edits: [fontWith([]), fontWith(["B"])], editAt: 1 },
      WHEN,
    );
    expect(project.edits).toHaveLength(2);
    expect(project.edits![0].glyphs).toEqual([]);
    expect(project.edits![1].glyphs.map((glyph) => glyph.name)).toEqual(["B"]);
    expect(project.editAt).toBe(1);
  });

  it("writes down a font with no file behind it, whole", () => {
    /*
     * The case this used to skip, and skipping it was not a small gap: a font
     * started blank here, or drawn and taken to the tools, was simply never
     * saved. Drawing in a new font and reloading gave back nothing.
     *
     * There is no file for anything to be an exception to, so the whole font
     * goes down -- which is affordable exactly because a font with no file
     * behind it only ever holds what somebody made in here.
     */
    const blank = { typeface: madeHere(["A", "B"]), fileName: "" };
    const project = toProject({ mode: "edit", edits: [blank] }, WHEN);
    expect(project.edits).toHaveLength(1);
    expect(project.edits![0].font, "no file to point at").toBeUndefined();
    expect(project.edits![0].glyphs.map((one) => one.name)).toEqual(["A", "B"]);
    expect(project.edits![0].meta.familyName).toBe("Made Here");
  });

  it("writes the em of a font with no file to read it from", () => {
    /*
     * Not a detail that can be defaulted: a blank font is a thousand units, an
     * assembled one is whatever its drawings were measured against, and a
     * traced one is whatever it was traced from. Restored at the wrong size,
     * every letter in it is the wrong size.
     */
    const wide = madeHere(["A"]);
    wide.unitsPerEm = 2048;
    const project = toProject({ mode: "edit", edits: [{ typeface: wide, fileName: "" }] }, WHEN);
    expect(project.edits![0].unitsPerEm).toBe(2048);

    // And it is not written for a font that has a file, which already says so.
    const opened = toProject(snapshot({ mode: "edit", edits: [fontWith([])] }), WHEN);
    expect(opened.edits![0].unitsPerEm, "the file is the one place that says").toBeUndefined();
  });

  it("keeps the tabs one for one, so the front font is the front font", () => {
    // Nothing falls out on the way down any more, so the index of the one in
    // front is the index it was handed rather than a count of what survived.
    const blank = { typeface: madeHere(["A"]), fileName: "" };
    const project = toProject({ mode: "edit", edits: [blank, fontWith(["B"])], editAt: 1 }, WHEN);
    expect(project.edits).toHaveLength(2);
    expect(project.editAt).toBe(1);
  });

  /*
   * Matched by name, never by position.
   *
   * A font re-read from its own bytes has its glyphs in the same order, so
   * position would work -- until the day the parser changed, when it would
   * quietly put somebody's edited A onto their B.
   */
  it("lays the saved glyphs back on by name", () => {
    const saved = toProject(snapshot({ mode: "edit", edits: [fontWith(["B"])] }), WHEN).edits![0];
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
        edits: [
          { ...one, masters: [{ id: "m1", name: "Regular", at: { wght: 400 }, glyphs: [] }] },
        ],
      }),
      WHEN,
    ).edits![0];
    expect(saved.masters).toBeUndefined();
    expect(saved.weight).toEqual({ name: "Regular", at: { wght: 400 } });
  });

  it("writes a second weight as the letters drawn in it, and no others", () => {
    const one = fontWith(["B"]);
    const bold: Glyph = { ...one.typeface.glyphs[0], advanceWidth: 800, dirty: true };
    const saved = toProject(
      snapshot({
        mode: "edit",
        edits: [
          {
            ...one,
            masters: [
              { id: "m1", name: "Regular", at: { wght: 400 }, glyphs: [] },
              { id: "m2", name: "Bold", at: { wght: 700 }, glyphs: [bold] },
            ],
          },
        ],
      }),
      WHEN,
    ).edits![0];

    expect(saved.masters).toHaveLength(1);
    expect(saved.masters![0].id).toBe("m2");
    expect(saved.masters![0].at).toEqual({ wght: 700 });
    expect(saved.masters![0].glyphs).toHaveLength(1);
    expect(saved.masters![0].glyphs[0].advanceWidth).toBe(800);
    // And the font itself is still the first weight's own letters.
    expect(saved.glyphs.map((one) => one.name)).toEqual(["B"]);
  });

  it("adds a glyph the saved document has and the font does not", () => {
    const saved = toProject(snapshot({ mode: "edit", edits: [fontWith(["B"])] }), WHEN).edits![0];
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
    const read = readProject({ ...good(), assemble: {}, edits: [{}] });
    expect(read).not.toBeNull();
    expect(read!.assemble).toBeUndefined();
    expect(read!.edits).toBeUndefined();
  });

  it("keeps the fonts it can read and drops the ones it cannot", () => {
    // One unreadable font among several costs the one, on the same terms as
    // every other half here: a document is not turned away for a part of it.
    const read = readProject({
      ...good(),
      edits: [{}, { font: "AAA", fileName: "Kept.ttf" }, {}],
      editAt: 1,
    });
    expect(read!.edits).toHaveLength(1);
    expect(read!.edits![0].fileName).toBe("Kept.ttf");
    // And the index follows what is left rather than pointing past the end.
    expect(read!.editAt).toBe(0);
  });

  it("will not be sent past the end by an index that is wrong", () => {
    const edits = [
      { font: "AAA", fileName: "One.ttf" },
      { font: "BBB", fileName: "Two.ttf" },
    ];
    expect(readProject({ ...good(), edits, editAt: 9 })!.editAt).toBe(1);
    expect(readProject({ ...good(), edits, editAt: -3 })!.editAt).toBe(0);
    expect(readProject({ ...good(), edits })!.editAt).toBe(0);
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
 * There is one real step in the chain now -- format 1's single edited font
 * becoming format 2's list of them -- and it is tested below on its own. What
 * these tests are for is the machinery around it: that steps run in order,
 * that each is handed what the one before gave back, and that a gap in the
 * chain stops rather than hands the reader a shape it does not know. One step
 * cannot show any of that, so `migrate` takes its steps as an argument and
 * these hand it two.
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

/**
 * The one real step there is, run through the real table.
 *
 * Every document anybody saved before several fonts could be open at once is a
 * format 1 document with one `edit` in it, and this is the whole of what
 * happens to it. The chain's machinery is checked above with steps of its own;
 * what is checked here is that this step does the right thing to a real
 * document, since that is the part nobody can test twice.
 */
describe("a document from format 1", () => {
  const older = () => ({
    typeforge: 1,
    saved: WHEN.toISOString(),
    mode: "edit" as const,
    edit: { font: "AAA", fileName: "One.ttf" },
  });

  it("becomes a list of one font, in front", () => {
    const brought = migrate(older(), 1) as Record<string, unknown>;
    expect(brought.edits).toEqual([{ font: "AAA", fileName: "One.ttf" }]);
    expect(brought.editAt).toBe(0);
  });

  it("carries one answer rather than two", () => {
    /*
     * The font is moved out of `edit` and not copied. Left in both places the
     * reader would have two answers to the same question and nothing to say
     * which was newer, and the first time they disagreed somebody would get
     * back a font they had already changed.
     */
    expect(migrate(older(), 1)).not.toHaveProperty("edit");
  });

  it("reads end to end, and says which version it came from", () => {
    const read = readDocument(older());
    expect(read.project!.edits).toHaveLength(1);
    expect(read.project!.edits![0].fileName).toBe("One.ttf");
    expect(read.project!.editAt).toBe(0);
    expect(read.from).toBe(1);
    // Older, not newer: there is nothing missing from it to warn about.
    expect(read.note).toBeNull();
  });

  it("comes through untouched when it had no font in it at all", () => {
    const { edit: _, ...without } = older();
    expect(migrate(without, 1)).toEqual(without);
  });
});
