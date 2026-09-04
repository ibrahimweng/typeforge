/**
 * What has been done, and the difference between doing it and saying so.
 *
 * Two kinds of lesson and they are kept apart on purpose. A lesson with a
 * `done` question is answered by the font: it goes green when the document
 * says so and it cannot be pressed. A lesson without one -- read this proof,
 * look at these gaps -- is marked by hand and is drawn differently, because a
 * tick you awarded yourself is a different claim from one the work supports and
 * an interface that showed them identically would be lying about which it had.
 *
 * Only the second kind is stored. The first is asked afresh every render, so a
 * course cannot drift out of step with the font: undo the thing and the lesson
 * goes back to undone, which is correct and is also what makes it teaching
 * rather than a checklist.
 */

const STORAGE_KEY = "typeforge.academy.marked";

let marked: Set<string> = load();
const listeners = new Set<() => void>();

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(list) ? list.filter((one): one is string => typeof one === "string") : [],
    );
  } catch {
    // A browser with storage turned off is a browser that takes the course
    // again next time, which is a smaller loss than not running.
    return new Set();
  }
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...marked]));
  } catch {
    // Nothing to do and nothing worth saying: the course still works.
  }
}

export function subscribeToProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The set itself, for `useSyncExternalStore`, which needs a stable reference. */
export function markedLessons(): ReadonlySet<string> {
  return marked;
}

export function isMarked(id: string): boolean {
  return marked.has(id);
}

export function markLesson(id: string, done: boolean): void {
  if (done === marked.has(id)) return;
  // A new set rather than a mutation, because `useSyncExternalStore` compares
  // by identity and a mutated set is the same object.
  marked = new Set(marked);
  if (done) marked.add(id);
  else marked.delete(id);
  save();
  for (const listener of listeners) listener();
}

export function forgetProgress(): void {
  if (marked.size === 0) return;
  marked = new Set();
  save();
  for (const listener of listeners) listener();
}
