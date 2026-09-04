/**
 * Reading the cuts and the cast off a document, without the engine behind it.
 *
 * These four are field reads with an exception merged over the top. They lived
 * in document.ts, next to the functions that build and change a document, and
 * that is a fair place for them until you notice who calls them: App.tsx, on
 * the first screen, to answer what the command palette shows.
 *
 * Importing them from document.ts imported the drawing engine with them, so
 * they are here instead, where the only things above them are `noCuts` and
 * `noCast`. document.ts re-exports all four, so nothing that already asks it
 * for them has to move.
 */

import { noCast, type Cast } from "./cast";
import { noCuts, type Cuts } from "./cut";
import type { Forge } from "./document";

/** What is taken out of every letter, unless a letter says otherwise. */
export function cutsOf(forge: Forge): Cuts {
  return forge.cuts ?? noCuts();
}

/**
 * What is taken out of one letter.
 *
 * The font's, unless this letter is an exception, in which case the font's
 * with that letter's differences laid over it. The same shape `styleFor` has,
 * and for the same reason: a letter says how it differs, not what it is.
 */
export function cutsFor(letter: string, forge: Forge): Cuts {
  const exception = forge.cutExceptions?.[letter];
  const cuts = cutsOf(forge);
  if (!exception) return cuts;

  const merged: Record<string, unknown> = { ...cuts };
  for (const [name, patch] of Object.entries(exception)) {
    merged[name] = { ...(merged[name] as object), ...patch };
  }
  return merged as unknown as Cuts;
}

export function castOf(forge: Forge): Cast {
  return forge.cast ?? noCast();
}

/** What is put on one letter: the font's, with that letter's differences over it. */
export function castFor(letter: string, forge: Forge): Cast {
  const exception = forge.castExceptions?.[letter];
  const cast = castOf(forge);
  if (!exception) return cast;

  const merged: Record<string, unknown> = { ...cast };
  for (const [name, patch] of Object.entries(exception)) {
    merged[name] = typeof patch === "object" ? { ...(merged[name] as object), ...patch } : patch;
  }
  return merged as unknown as Cast;
}
