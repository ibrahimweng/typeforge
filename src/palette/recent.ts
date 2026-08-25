/**
 * What was picked last, so the palette opens on something useful.
 *
 * Kept in local storage rather than in the project, because it is about the
 * person and not about the font: opening a different typeface should not
 * forget that you always go to the weight slider first.
 *
 * Ids only. The entries themselves are rebuilt from the registries every time
 * the palette opens, so a remembered id that no longer names anything simply
 * finds nothing and is skipped -- which is what should happen when a control is
 * renamed between one visit and the next.
 */

const WHERE = "typeforge.palette.recent";
const KEEP = 8;

export function recentIds(): string[] {
  try {
    const raw = window.localStorage.getItem(WHERE);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((one): one is string => typeof one === "string").slice(0, KEEP);
  } catch {
    // A browser with storage turned off, or something else's key in the way.
    // Recents are a convenience; nothing here is worth an error for.
    return [];
  }
}

export function remember(id: string): void {
  try {
    const next = [id, ...recentIds().filter((one) => one !== id)].slice(0, KEEP);
    window.localStorage.setItem(WHERE, JSON.stringify(next));
  } catch {
    /* see above */
  }
}
