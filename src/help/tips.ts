/**
 * The one line each part of the tool gets to introduce itself.
 *
 * A tip appears the first time you arrive somewhere and then never again. It
 * sits in the flow rather than over it, so nothing is blocked and nothing has
 * to be clicked through: someone who already knows what a kerning view is can
 * ignore it entirely, and someone who does not gets told the one thing that is
 * not guessable from looking.
 *
 * Which is the point of the wording below. "This is the kerning view" is worth
 * nothing -- the tab already says that. What is worth saying is that you click
 * the gap rather than the letter, because there is no way to discover that by
 * looking at a line of type.
 */

const STORAGE_KEY = "typeforge.tips.seen";

export type TipId =
  | "grid"
  | "glyph"
  | "kerning"
  | "metrics"
  | "report"
  | "family"
  | "controls"
  | "forge"
  | "export";

export const TIPS: Record<TipId, string> = {
  grid: "Every glyph in the font. Click one to open it, or select several to change them together.",
  glyph:
    "Drag a point to move it; drag its handle to bend the curve either side. Family parameters stay live on top of whatever you draw, shown behind as a guide.",
  kerning:
    "Click the gap between two letters, not the letters, then drag left or right to close or open that pair.",
  metrics:
    "The white space either side of each letter. Compare down a column: even spacing is what makes a line read evenly.",
  report:
    "Most font faults are invisible on the machine that made them. This finds them while the work is still open — click any one to go to the glyph that caused it.",
  family:
    "These change every glyph at once. A single letter can overrule any of them from its own tab.",
  controls:
    "Change one of these five letters and Typeforge works out what you meant — heavier, wider, taller — and applies it to the whole alphabet.",
  forge:
    "Nothing here came from another font. Pick a base, then change a part \u2014 a serif, a shoulder, a crossbar \u2014 and every letter that has that part follows. The panel says how many before you touch it.",
  export:
    "Preserve keeps everything the original font carried and swaps in your outlines. Rebuild writes a clean file from what is on screen.",
};

/**
 * Reading and writing the seen set.
 *
 * Wrapped because localStorage is not always there to be written to: Safari in
 * private browsing throws on write rather than failing quietly, and a tip that
 * cannot remember being dismissed is a small annoyance, not a reason to take
 * the view down with it.
 */
// Held in memory as well as on disk. React asks for the current answer during
// render, several times per render, and parsing JSON out of storage on each of
// those is work for nothing when this side of the application is the only thing
// that ever writes it.
let cache: Set<string> | null = null;

function read(): Set<string> {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cache = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

function write(seen: Set<string>): void {
  cache = seen;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // Nothing to be done, and nothing worth interrupting anyone over.
  }
}

export function markTipSeen(id: TipId): void {
  const seen = read();
  if (seen.has(id)) return;
  seen.add(id);
  write(seen);
  notify();
}

/** Show every tip again, which is what the help drawer's reset does. */
export function forgetTips(): void {
  write(new Set());
  notify();
}

export function seenTipCount(): number {
  return read().size;
}

/**
 * Which tip gets the floor when more than one could show.
 *
 * Opening a font for the first time mounts three at once -- one for the grid,
 * one for the control letters, one for the parameters -- and three tinted boxes
 * arriving together is not help, it is clutter, and it teaches nothing about
 * where to start. Only the first unseen one on this list is shown, so they
 * arrive one at a time in the order someone would meet them.
 *
 * A dialog comes first because it is what the person is looking at; then
 * whichever view they are in; then the panels beside it.
 */
const ORDER: TipId[] = [
  "export",
  "forge",
  "grid",
  "glyph",
  "kerning",
  "metrics",
  "report",
  "controls",
  "family",
];

const mounted = new Map<TipId, number>();

/** Called by each coach mark while it is on screen. */
export function holdTipSlot(id: TipId): () => void {
  mounted.set(id, (mounted.get(id) ?? 0) + 1);
  notify();
  return () => {
    const count = (mounted.get(id) ?? 1) - 1;
    if (count > 0) mounted.set(id, count);
    else mounted.delete(id);
    notify();
  };
}

/** The one tip that may show right now, if any. */
export function tipOnDuty(): TipId | null {
  const seen = read();
  return ORDER.find((id) => mounted.has(id) && !seen.has(id)) ?? null;
}

// Tips are dismissed in one place and counted in another, so the count has to
// hear about it. Small enough not to warrant the store.
const listeners = new Set<() => void>();

export function subscribeToTips(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}
