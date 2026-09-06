/**
 * Joining class names, with the later one winning.
 *
 * `clsx` flattens the conditions and `tailwind-merge` drops the loser when two
 * of them set the same thing, so `cn("p-2", wide && "p-4")` is `p-4` rather
 * than both. Every component here uses it, which is why it is worth the six
 * lines rather than a `filter(Boolean).join(" ")` that leaves `p-2 p-4` behind
 * and lets whichever CSS rule happens to be later decide.
 *
 * Written out here rather than imported from `src/ui/lib/utils`, which is
 * where it used to come from and where it is the same six lines. That file is
 * Toolcraft's, under a licence that does not permit selling this application,
 * and it was forty of the forty-six places the rest of the application touched
 * that library at all. `NOTICE.md` has the whole of that argument. Both halves
 * of this are ordinary MIT packages the project already depends on directly.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
