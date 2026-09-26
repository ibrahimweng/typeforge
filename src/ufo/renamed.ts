/**
 * A carried set, with one more rename folded in.
 *
 * Kept apart from `font.ts` for the one reason that the store has to call it
 * on every rename, and `font.ts` -- the reader, the writer, the plist and XML
 * underneath them -- is loaded only when somebody opens or saves a UFO. A
 * static import of it from the store would put all of that on the first
 * screen for the sake of five lines.
 *
 * A new object rather than an edit to the old one, because the old one is what
 * an undo puts back, and because a saved session caches its copy of a carried
 * set by identity. Chains collapse -- `a` to `b` to `c` is `a` to `c` -- and a
 * rename back to what the file called it is no rename at all.
 */

import type { UfoCarried } from "./font";

export function withRename(carried: UfoCarried, from: string, to: string): UfoCarried {
  const renamed = { ...carried.renamed };
  const original = Object.keys(renamed).find((key) => renamed[key] === from) ?? from;
  if (original === to) delete renamed[original];
  else renamed[original] = to;
  return { ...carried, renamed };
}
