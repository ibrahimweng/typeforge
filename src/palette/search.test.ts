/**
 * What the palette has to find.
 *
 * Written as sentences rather than as fragments, because that is the case the
 * search exists for: somebody who knows what is wrong with their font and does
 * not know what the control is called. A fragment ("kern") would be found by
 * any substring match; "the gap between letters is too big" is the one that
 * needs the hints, the synonyms and the weighting all working together.
 *
 * Each case names the answer rather than the whole order, because the order
 * below the answer is a matter of taste and the answer is not.
 */

import { describe, expect, it } from "vitest";

import { catalogue, type Shell } from "./catalogue";
import { buildIndex, readQuery, search } from "./search";
import { stem, wordsOf } from "./words";

const shell = {
  mode: "edit",
  setMode: () => {},
  view: "grid",
  setView: () => {},
  openFile: () => {},
  openFolder: () => {},
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

const items = catalogue(shell);
const index = buildIndex(items);

const top = (query: string, howMany = 1): string[] =>
  search(index, query, howMany).map((hit) => hit.entry.label);

describe("finding a control from a description", () => {
  /*
   * The cases that need every part of it. Each of these shares no word with
   * the answer's own name: "rounder" reaches the corner through the synonym
   * table, "the gap between letters" reaches kerning through the hint, and
   * "hole in the middle" reaches the counter through both.
   */
  it.each([
    ["make the letters rounder", "Corner: Rounding"],
    ["fatter", "Weight"],
    ["make it lean over", "Slant"],
    ["the gap between letters is too big", "Kerning"],
    ["hole in the middle of the o", "Middle space"],
    ["save my work", "Save the project"],
    ["get a file i can install", "Export the font"],
  ])("finds %s", (query, answer) => {
    expect(top(query)).toEqual([answer]);
  });

  it("finds a control by its own name before anything that merely mentions it", () => {
    expect(top("corner radius")).toEqual(["Corner radius"]);
    expect(top("slant")).toEqual(["Slant"]);
  });

  it("still finds something when the typing is half there", () => {
    // Not the same as a match: this is the last resort, and all it has to do
    // is keep the palette from going blank on a typo.
    expect(top("crnr rds")).toEqual(["Corner radius"]);
  });
});

describe("what a query does not turn up", () => {
  /*
   * A single letter is a letter only when it is the whole query. Four hundred
   * and fifty glyphs have one-character names, so any sentence with an "i" in
   * it agreed with one of them perfectly.
   */
  it("does not let a stray letter outrank the answer", () => {
    const hits = top("i want feet on the letters", 6);
    expect(hits).not.toContain("i");
    expect(hits).not.toContain("I");
  });

  it("finds the letter when the letter is all that was typed", () => {
    expect(top("i")).toEqual(["i"]);
    expect(top("#o", 2)).toContain("o");
  });

  it("prefers the control that makes a change to one letter's variant", () => {
    // Both agree with the query; only one of them changes the face.
    const hits = top("round", 4);
    expect(hits.some((label) => label.startsWith("Corner"))).toBe(true);
  });
});

describe("prefixes", () => {
  it("reads the mark off the front and searches the rest", () => {
    expect(readQuery(">export")).toEqual({ text: "export", kinds: ["action", "view"], mark: ">" });
    expect(readQuery("#a")).toEqual({ text: "a", kinds: ["letter"], mark: "#" });
    expect(readQuery("~weight")).toEqual({ text: "weight", kinds: ["control"], mark: "~" });
    expect(readQuery("weight")).toEqual({ text: "weight", kinds: null, mark: null });
  });

  it("keeps a filtered search inside its kind", () => {
    for (const hit of search(index, "~weight", 20)) expect(hit.entry.kind).toBe("control");
    for (const hit of search(index, "#a", 20)) expect(hit.entry.kind).toBe("letter");
    for (const hit of search(index, ">a", 20)) expect(["action", "view"]).toContain(hit.entry.kind);
  });

  it("lists everything of a kind when the mark is all there is", () => {
    const letters = search(index, "#", 1000);
    expect(letters.length).toBeGreaterThan(100);
    for (const hit of letters) expect(hit.entry.kind).toBe("letter");
  });
});

describe("the words themselves", () => {
  it("folds the endings that turn one part of speech into another", () => {
    expect(stem("rounder")).toBe("round");
    expect(stem("roundness")).toBe("round");
    expect(stem("thickness")).toBe("thick");
    expect(stem("letters")).toBe("letter");
  });

  it("leaves short words alone rather than eating them", () => {
    // The floors exist so that "sees" does not become "se".
    expect(stem("es")).toBe("es");
    expect(stem("is")).toBe("is");
  });

  it("drops the words that tell nothing apart", () => {
    expect(wordsOf("the letters are too thin")).toEqual(["thin"]);
  });
});

describe("the catalogue", () => {
  it("covers everything the palette is meant to reach", () => {
    const kinds = new Set(items.map((one) => one.kind));
    expect([...kinds].sort()).toEqual(["action", "alternate", "control", "face", "letter", "view"]);
  });

  it("gives every entry something to search on", () => {
    for (const item of items) {
      expect(item.label.length, item.id).toBeGreaterThan(0);
      expect(item.hint.length, `${item.id} has no hint`).toBeGreaterThan(0);
    }
  });

  it("names every entry once", () => {
    const seen = new Set<string>();
    for (const item of items) {
      expect(seen.has(item.id), `${item.id} twice`).toBe(false);
      seen.add(item.id);
    }
  });

  it("offers a way to use every entry", () => {
    for (const item of items) {
      const usable = item.run ?? item.adjust ?? item.choose ?? item.toggle;
      expect(usable, `${item.id} does nothing`).toBeTruthy();
    }
  });

  it("marks the entries that throw work away", () => {
    const byId = new Map(items.map((one) => [one.id, one]));
    expect(byId.get("action:new")?.destructive).toBe(true);
    expect(byId.get("action:open")?.destructive).toBe(true);
    expect(byId.get("action:save")?.destructive).toBeUndefined();
  });
});
