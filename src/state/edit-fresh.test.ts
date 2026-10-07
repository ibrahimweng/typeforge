/**
 * An edit shows at once, on the canvas and in the file, with the family
 * weighted.
 *
 * What a letter was weighed at is kept against the glyph object, so a gesture
 * on the weight can be drawn from it (`draft.ts`) and the end of one is not
 * weighed twice. The store edits glyphs in place, and the key that said which
 * drawing a kept outline was for was a sum of `x * 3 + y` over the points: a
 * moved handle left it as it was, and so did a point moved ten across and
 * thirty down. The letter then came back as it was before the edit -- on the
 * canvas and in the font written from it -- until something else moved.
 *
 * Every edit here is checked the same way: the letter in the store, resolved
 * through the same caches the canvas uses, against the same letter copied to
 * a fresh object nobody has kept anything for; and the file written from the
 * store against the file written from a fresh copy of the whole font.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { markDraft } from "@/font/draft";
import { exportFont } from "@/font/export";
import { resolveAdvanceWidth, resolveGlyphContours } from "@/font/transform";
import { cloneGlyph, type Glyph, type Typeface } from "@/font/types";
import { store } from "./store";

const SAMPLE = new Uint8Array(
  readFileSync(new URL("../assets/typeforge-sample.ttf", import.meta.url)),
);

const face = (): Typeface => store.getSnapshot().typeface!;
const letter = (name: string): Glyph => face().glyphs[face().glyphIndex.get(name)!];

/** A copy of the font with every glyph a new object: nothing is kept for any of them. */
function fresh(typeface: Typeface): Typeface {
  const glyphs = typeface.glyphs.map(cloneGlyph);
  return {
    ...typeface,
    params: { ...typeface.params },
    glyphs,
    glyphIndex: new Map(glyphs.map((one, index) => [one.name, index])),
  };
}

const write = async (typeface: Typeface) =>
  (
    await exportFont(typeface, {
      format: "ttf",
      fidelity: "rebuild",
      mergeOverlaps: false,
      now: 0,
      resolving: { threads: 0 },
    })
  ).bytes;

/** The canvas's answer for a letter, and the answer for the same drawing from nothing. */
function bothWays(name: string) {
  const typeface = face();
  const glyph = letter(name);
  const copy = cloneGlyph(glyph);
  return {
    canvas: {
      contours: resolveGlyphContours(glyph, typeface),
      advance: resolveAdvanceWidth(glyph, typeface),
    },
    truth: {
      contours: resolveGlyphContours(copy, typeface),
      advance: resolveAdvanceWidth(copy, typeface),
    },
  };
}

/** Weighed once before the edit, the way the canvas has always drawn it by then. */
function seen(names: string[]) {
  return new Map(names.map((name) => [name, JSON.stringify(bothWays(name).canvas)]));
}

async function expectFresh(name: string, before: Map<string, string>): Promise<void> {
  const { canvas, truth } = bothWays(name);
  expect(canvas).toEqual(truth);
  // And the edit did change the weighted letter, so the check above means something.
  expect(JSON.stringify(canvas)).not.toBe(before.get(name));
  const written = await write(face());
  const fromNothing = await write(fresh(face()));
  expect(Buffer.from(written).equals(Buffer.from(fromNothing))).toBe(true);
}

describe("an edit to a letter of a weighted font", () => {
  beforeEach(async () => {
    await store.loadFont(SAMPLE, "sample.ttf");
    store.setFamilyParam("weight", Math.round(face().unitsPerEm * 0.03));
  });

  it("shows a moved handle, as a drag moves it", async () => {
    const before = seen(["o"]);
    store.editGlyphLive("o", (glyph) => {
      const node = glyph.contours[0].nodes.find((one) => one.handleOut)!;
      node.handleOut = { x: node.handleOut!.x + 60, y: node.handleOut!.y + 60 };
    });
    await expectFresh("o", before);
  });

  it("shows a point moved where three across and one down sum to nothing", async () => {
    const before = seen(["H"]);
    store.editGlyph("H", "Move point", (glyph) => {
      const node = glyph.contours[0].nodes[0];
      node.point = { x: node.point.x + 10, y: node.point.y - 30 };
    });
    await expectFresh("H", before);
  });

  it("shows a point added, and a point taken away", async () => {
    const before = seen(["H"]);
    store.editGlyph("H", "Add point", (glyph) => {
      const nodes = glyph.contours[0].nodes;
      const a = nodes[0].point;
      const b = nodes[1].point;
      nodes.splice(1, 0, {
        point: { x: (a.x + b.x) / 2 + 40, y: (a.y + b.y) / 2 },
        handleIn: null,
        handleOut: null,
        type: "corner",
      });
    });
    await expectFresh("H", before);

    const added = seen(["H"]);
    store.editGlyph("H", "Delete point", (glyph) => {
      glyph.contours[0].nodes.splice(1, 1);
    });
    await expectFresh("H", added);
  });

  it("shows the letter as it was once undone, and the edit again once redone", async () => {
    const original = seen(["o"]);
    store.editGlyph("o", "Move handle", (glyph) => {
      const node = glyph.contours[0].nodes.find((one) => one.handleIn)!;
      node.handleIn = { x: node.handleIn!.x - 50, y: node.handleIn!.y + 40 };
    });
    const edited = seen(["o"]);
    await expectFresh("o", original);

    store.undo();
    expect(JSON.stringify(bothWays("o").canvas)).toBe(original.get("o"));
    await expectFresh("o", edited);

    store.redo();
    expect(JSON.stringify(bothWays("o").canvas)).toBe(edited.get("o"));
    await expectFresh("o", original);
  });

  it("shows a drag that ends with an entry in the history", async () => {
    const before = seen(["n"]);
    const was = cloneGlyph(letter("n"));
    store.editGlyphLive("n", (glyph) => {
      for (const node of glyph.contours[0].nodes) {
        if (node.handleOut) node.handleOut = { x: node.handleOut.x + 25, y: node.handleOut.y };
      }
    });
    store.commitGlyphEdit("n", "Move handles", was);
    await expectFresh("n", before);
  });
});

describe("a font written in the middle of a gesture on the weight", () => {
  it("is written with the exact letters, not the drafts drawn between them", async () => {
    await store.loadFont(SAMPLE, "sample.ttf");
    const em = face().unitsPerEm;
    const names = ["H", "o", "n", "a", "e", "s", "g", "W"];
    // The letters weighed at the start of the gesture, as the canvas does.
    store.setFamilyParam("weight", Math.round(em * 0.01));
    for (const name of names) resolveGlyphContours(letter(name), face());

    // An arrow press: a draft for half a second.
    store.setFamilyParam("weight", Math.round(em * 0.02), true);
    const draft = face();
    const exact = { ...draft, params: { ...draft.params } };
    // A draft really is drawn between weights, so the file below could have had it.
    expect(
      names.some(
        (name) =>
          JSON.stringify(resolveGlyphContours(letter(name), draft)) !==
          JSON.stringify(resolveGlyphContours(letter(name), exact)),
      ),
    ).toBe(true);

    const written = await write(draft);
    const truth = await write(fresh(exact));
    expect(Buffer.from(written).equals(Buffer.from(truth))).toBe(true);
  });

  it("is written with the exact masters as well", async () => {
    await store.loadFont(SAMPLE, "sample.ttf");
    const typeface = fresh(face());
    const params = { ...typeface.params, weight: Math.round(typeface.unitsPerEm * 0.02) };
    markDraft(params);
    const drafted = { ...typeface, params };
    const plain = { ...typeface, params: { ...params } };
    // Weighed once a little way off, so a draft would be drawn from it.
    for (const glyph of typeface.glyphs)
      resolveGlyphContours(glyph, {
        ...typeface,
        params: { ...params, weight: params.weight / 2 },
      });
    const axes = [{ tag: "wght", label: "Weight", min: 100, default: 400, max: 700 }];
    const options = (master: Typeface) => ({
      format: "ttf" as const,
      fidelity: "rebuild" as const,
      now: 0,
      resolving: { threads: 0 },
      variable: { axes, instances: [], masters: [{ at: { wght: 700 }, typeface: master }] },
    });
    const base = fresh(face());
    const one = await exportFont(base, options(drafted));
    const other = await exportFont(fresh(face()), options(fresh(plain)));
    expect(Buffer.from(one.bytes).equals(Buffer.from(other.bytes))).toBe(true);
  });
});

/**
 * The font's stem follows an edit to the letters it is measured from.
 *
 * The stem -- which sets how thick a slab is and how much of a stroke a change
 * of width gives back -- is read off the I (or whichever of the stem letters
 * the font has) and kept against the typeface object. The store edits a
 * letter in place, in the same typeface, so a thicker I left every slab and
 * every narrowed letter at the old stem until the font was opened again: the
 * canvas and the file both disagreed with the same font read from nothing.
 *
 * Checked on letters other than the one edited, since those are the ones
 * nothing else would have told to look again.
 */
describe("an edit to the letter the font's stem is measured from", () => {
  const OTHERS = ["H", "n", "o", "E"];

  /** The I with its right side moved out, so its stem is thicker. */
  const thicken = (glyph: Glyph) => {
    const xs = glyph.contours.flatMap((contour) => contour.nodes.map((node) => node.point.x));
    const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    const by = Math.round(face().unitsPerEm * 0.06);
    for (const contour of glyph.contours)
      for (const node of contour.nodes) {
        if (node.point.x <= middle) continue;
        node.point = { x: node.point.x + by, y: node.point.y };
        if (node.handleIn) node.handleIn = { x: node.handleIn.x + by, y: node.handleIn.y };
        if (node.handleOut) node.handleOut = { x: node.handleOut.x + by, y: node.handleOut.y };
      }
  };

  /** Every letter named, as the store's font draws it and as a fresh copy of it does. */
  function drawnBothWays(names: string[]) {
    const typeface = face();
    const copy = fresh(typeface);
    const of = (one: Typeface, name: string) => {
      const glyph = one.glyphs[one.glyphIndex.get(name)!];
      return {
        contours: resolveGlyphContours(glyph, one),
        advance: resolveAdvanceWidth(glyph, one),
      };
    };
    return {
      canvas: names.map((name) => of(typeface, name)),
      truth: names.map((name) => of(copy, name)),
    };
  }

  async function expectStemFollowed(before: string): Promise<void> {
    const { canvas, truth } = drawnBothWays(OTHERS);
    expect(canvas).toEqual(truth);
    // And the edit did change the letters it was not made to, through the stem.
    expect(JSON.stringify(canvas)).not.toBe(before);
    const written = await write(face());
    const fromNothing = await write(fresh(face()));
    expect(Buffer.from(written).equals(Buffer.from(fromNothing))).toBe(true);
  }

  beforeEach(async () => {
    await store.loadFont(SAMPLE, "sample.ttf");
    expect(face().glyphIndex.has("I")).toBe(true);
  });

  it("thickens the slabs on every other letter", async () => {
    store.setFamilyParam("slab", Math.round(face().unitsPerEm * 0.1));
    const before = JSON.stringify(drawnBothWays(OTHERS).canvas);
    store.editGlyph("I", "Move points", thicken);
    await expectStemFollowed(before);
  });

  it("gives back the thicker stroke on every narrowed letter", async () => {
    store.setFamilyParam("width", 0.8);
    const before = JSON.stringify(drawnBothWays(OTHERS).canvas);
    store.editGlyph("I", "Move points", thicken);
    await expectStemFollowed(before);
  });

  it("follows a drag, and goes back with an undo", async () => {
    store.setFamilyParam("slab", Math.round(face().unitsPerEm * 0.1));
    const original = JSON.stringify(drawnBothWays(OTHERS).canvas);
    const was = cloneGlyph(letter("I"));
    store.editGlyphLive("I", thicken);
    await expectStemFollowed(original);
    store.commitGlyphEdit("I", "Move points", was);
    const edited = JSON.stringify(drawnBothWays(OTHERS).canvas);

    store.undo();
    expect(JSON.stringify(drawnBothWays(OTHERS).canvas)).toBe(original);
    await expectStemFollowed(edited);
    store.redo();
    expect(JSON.stringify(drawnBothWays(OTHERS).canvas)).toBe(edited);
  });
});
