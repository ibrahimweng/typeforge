/**
 * The split that makes several fonts open at once safe, checked against the
 * state itself rather than against a list somebody remembered to update.
 *
 * The failure this exists for is quiet and specific. A field added to
 * `AppState` later and classified in neither list would silently behave as
 * shared: two fonts would agree about something that belongs to one of them.
 * Your selection would follow you between tabs, or the checks from one font
 * would be reported against another, and nothing anywhere would say so.
 *
 * Read off the source text, which is crude and is why the first test proves
 * the reader found something. A reader that matched nothing would make every
 * other test here pass by finding no problems in no data.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ABOUT_THE_SET, PER_DOCUMENT, SHARED, documentPart, nameOf } from "./documents";

/** Every field `AppState` declares, read from the file that declares it. */
function fieldsOfAppState(): string[] {
  const source = readFileSync("src/state/model.ts", "utf8");
  const at = source.indexOf("export interface AppState {");
  expect(at, "AppState should be declared in model.ts").toBeGreaterThan(-1);

  let depth = 0;
  const body: string[] = [];
  for (const line of source.slice(at).split("\n")) {
    body.push(line);
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth === 0 && body.length > 1) break;
  }
  return [...body.join("\n").matchAll(/^ {2}(\w+)\??:/gm)].map((found) => found[1]);
}

describe("what belongs to a font and what belongs to the desk", () => {
  it("has a reader that actually finds the fields", () => {
    // The guard on every conclusion below.
    const fields = fieldsOfAppState();
    expect(fields.length, "the reader found nothing in AppState").toBeGreaterThan(20);
    expect(fields).toContain("typeface");
    expect(fields).toContain("tool");
  });

  it("classifies every field, with none left over", () => {
    /*
     * The one that matters. A field in neither list is one that quietly
     * becomes shared, and the symptom -- a selection that follows you between
     * tabs -- is a long way from the cause.
     */
    const fields = fieldsOfAppState();
    const classified = new Set<string>([...PER_DOCUMENT, ...SHARED, ...ABOUT_THE_SET]);
    const missing = fields.filter((field) => !classified.has(field));
    expect(missing, "these AppState fields belong to neither list").toEqual([]);
  });

  it("classifies nothing twice, and nothing that has gone", () => {
    const fields = new Set(fieldsOfAppState());
    const all = [...PER_DOCUMENT, ...SHARED, ...ABOUT_THE_SET];
    const twice = all.filter((field, at) => all.indexOf(field) !== at);
    expect(twice, "a field cannot be in two lists").toEqual([]);

    const gone = all.filter((field) => !fields.has(field));
    expect(gone, "these are classified but no longer exist").toEqual([]);
  });

  it("keeps the tool on the desk and the selection with the font", () => {
    // The two that say the split is the right way round rather than merely
    // complete. A tool that changed when you switched font would be a tool
    // changing when you were not looking; a selection that did not would be
    // one font reporting another's.
    expect(SHARED).toContain("tool");
    expect(SHARED).toContain("snapping");
    expect(PER_DOCUMENT).toContain("selectedNodes");
    expect(PER_DOCUMENT).toContain("typeface");
    expect(PER_DOCUMENT).toContain("checks");
    // And undo, which is the one somebody would notice first: two fonts share
    // a history and Cmd-Z in one takes back an edit made in the other.
    expect(PER_DOCUMENT).toContain("canUndo");
    // And the list of fonts is its own thing: switching is what changes it,
    // which is the opposite of what shared means.
    expect(ABOUT_THE_SET).toContain("open");
  });

  it("lifts exactly the per-document fields out of a state", () => {
    const state = Object.fromEntries(
      [...PER_DOCUMENT, ...SHARED].map((field) => [field, field]),
    ) as never;
    const part = documentPart(state);
    expect(Object.keys(part).sort()).toEqual([...PER_DOCUMENT].sort());
  });
});

describe("what a font is called in a tab", () => {
  const font = (familyName: string) => ({ meta: { familyName } }) as never;

  it("uses the family name, which is what a designer calls it", () => {
    expect(nameOf({ typeface: font("Bakerloo"), fileName: "whatever.ttf" })).toBe("Bakerloo");
  });

  it("falls back to the file, without its extension", () => {
    expect(nameOf({ typeface: font("  "), fileName: "DejaVuSans.ttf" })).toBe("DejaVuSans");
  });

  it("says Untitled rather than nothing at all", () => {
    // A tab with an empty label is a tab nobody can aim at.
    expect(nameOf({ typeface: null, fileName: "" })).toBe("Untitled");
  });
});
