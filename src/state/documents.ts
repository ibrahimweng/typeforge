/**
 * Which fields of the application state belong to one font, and which to all.
 *
 * The store held one typeface, one undo stack and one selection, and the whole
 * of "several fonts open at once" is the question this file answers: when you
 * put one font aside and pick up another, what travels with it and what stays
 * on the desk?
 *
 * It is a list rather than a shape, and that is deliberate. The alternative is
 * to nest the per-font fields under a `document` key, which would be tidier
 * and would rewrite a hundred and seventy-eight places that read
 * `state.typeface` today. Those readers do not want to know there is more than
 * one font; they want the one being worked on. So the live state stays flat and
 * *is* the active document, and the others are put aside whole -- which is
 * exactly what a loan already does with `held` in `store-core.ts`, for exactly
 * the same reason.
 *
 * The split itself:
 *
 *   - **Per document.** Anything that is a fact about a particular font: what
 *     it is, what is picked in it, what it can undo, what the checks said. Two
 *     fonts open have two of each, and they must not leak into one another.
 *
 *   - **Shared.** Anything that is a fact about the person working. The tool in
 *     hand, whether snapping is on, which ground letters are judged against.
 *     Switching document with the pen in hand and coming back to the select
 *     tool would be a tool that changes when you were not looking.
 *
 * `view` is the one worth arguing about, and it is per document: which screen
 * you were on is part of where you were in that font, and coming back to a
 * font you were kerning ought to put you back in the kerning table.
 *
 * Every field is in exactly one of the two lists, and the test beside this
 * proves it against `AppState` itself. A field added later and classified in
 * neither is the failure this is built to prevent: it would silently become
 * shared, so two fonts would quietly agree about something that belongs to one
 * of them, and nothing would say so until somebody noticed their selection
 * following them between tabs.
 */

import type { AppState } from "./model";

/** What travels with a font when it is put aside. */
export const PER_DOCUMENT = [
  "typeface",
  "fileName",
  "openWarnings",
  "view",
  "context",
  "guides",
  "selectedGlyph",
  "selectedNodes",
  "selectedGlyphs",
  "canUndo",
  "canRedo",
  "undoLabel",
  "redoLabel",
  "masters",
  "master",
  "preview",
  "revision",
  "checks",
  "lastDerivation",
] as const;

/**
 * The two that are about the set of fonts rather than about any one of them.
 *
 * A third list rather than filing them under shared, which is where they would
 * behave correctly and read wrongly. Shared means "true of the person, not of
 * the font", and these are true of neither: they are the list of fonts and
 * which one is in front. Putting them with the tool and the ground would say
 * that switching document leaves them alone for the same reason it leaves the
 * pen alone, and it does not -- switching is the thing that changes them.
 */
export const ABOUT_THE_SET = ["open", "openAt"] as const;

/** What stays on the desk, because it is about the person rather than the font. */
export const SHARED = [
  "tool",
  "lastInGroup",
  "toolState",
  "snapping",
  "marks",
  "polygonSides",
  "drawing",
  "pen",
  "pens",
  "usingPen",
  "writing",
  "stop",
  "highlightPath",
  "wantsMode",
  "ground",
  "search",
  "previewText",
  "status",
  "busy",
  "loan",
] as const;

export type PerDocument = (typeof PER_DOCUMENT)[number];

/** One font that is open but not in front. */
export interface Aside {
  id: string;
  state: Pick<AppState, PerDocument>;
}

/**
 * A font-shaped hole: every per-document field at the value it has before
 * anything is open.
 *
 * What makes "the new one arrives on a clean desk" true rather than a claim.
 * Without it each of the four doors a font comes in by has to remember the
 * whole list itself, and the one that forgets leaves the last font's guides
 * over the new one -- guides being the field that was actually forgotten, and
 * they are kept in font units, so at a different unit size they arrive meaning
 * something else entirely.
 *
 * The test beside this holds it to the same list as `PER_DOCUMENT`, so a field
 * added to one and not the other is caught rather than quietly inherited.
 */
export function blankDocument(): Pick<AppState, PerDocument> {
  return {
    typeface: null,
    fileName: "",
    openWarnings: [],
    view: "grid",
    context: { before: "n", after: "n" },
    guides: [],
    selectedGlyph: null,
    selectedNodes: new Set(),
    selectedGlyphs: new Set(),
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    masters: [],
    master: "",
    preview: null,
    revision: 0,
    checks: null,
    lastDerivation: [],
  };
}

/** The fields belonging to a font, lifted out of the live state. */
export function documentPart(state: AppState): Pick<AppState, PerDocument> {
  const part = {} as Record<string, unknown>;
  for (const field of PER_DOCUMENT) part[field] = state[field];
  return part as Pick<AppState, PerDocument>;
}

/**
 * What a font is called in a tab.
 *
 * The family name rather than the file name, because that is what a designer
 * calls the thing they are drawing, and the file name is often `Untitled.ttf`
 * for three of the four tabs. The file name is the fallback, and a font with
 * neither is new rather than nameless.
 */
export function nameOf(state: Pick<AppState, "typeface" | "fileName">): string {
  const family = state.typeface?.meta.familyName?.trim();
  if (family) return family;
  const file = state.fileName?.replace(/\.[^.]+$/, "").trim();
  return file || "Untitled";
}

/**
 * A name for one open font, unique within the session.
 *
 * Only ever compared, never shown and never written to a file, so it needs to
 * be unlike its neighbours rather than unguessable. A counter is enough and is
 * the same across a reload, which matters for nothing here because nothing
 * outside the session ever sees one.
 */
let counted = 0;
export const newId = (): string => `font-${++counted}`;
