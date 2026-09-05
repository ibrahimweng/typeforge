/**
 * The font being drawn, reached without the engine that draws it.
 *
 * `forge-store.ts` imports `src/forge/`, which is two hundred and eighty-seven
 * kilobytes of letter recipes, part specifications and geometry. Six things on
 * the first screen wanted something small from it -- a family name in the
 * toolbar, whether undo was available, a letter handed back from the editor,
 * a snapshot to write into the session -- and every one of them imported the
 * whole engine to get it. The palette was deferred and the engine came down
 * anyway, because the toolbar was greying out a button.
 *
 * So this stands in its place. What the shell shows continuously is pushed
 * here by the store as it changes; what the shell only does on a click fetches
 * the store when the click happens. Nothing here reaches `src/forge/` except
 * through an `import()` inside a function.
 *
 * The facts live here rather than being copied here. `forgeStore` takes its
 * own `revision` from `drawingChanged()` and reports the rest through
 * `drawingIs()` from the one place its state is written, so the two cannot
 * come apart. A second copy kept in step by hand is exactly the silent failure
 * the note above `revisions` in App.tsx describes: work that is never saved,
 * and nothing said about it.
 */

import { useSyncExternalStore } from "react";

import type { Arrival } from "@/forge/exchange";
import type { Measured } from "@/library/measure";
import type { DrawnProject } from "@/project/format";

/** What the shell knows about the drawing without having loaded it. */
export interface Drawing {
  /** How many times it has changed, which is the store's revision. */
  readonly count: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** What it is called, and which of the twenty styles it started from. */
  readonly familyName: string;
  readonly base: string;
}

const NOTHING_DRAWN: Drawing = {
  count: 0,
  canUndo: false,
  canRedo: false,
  familyName: "Untitled",
  base: "",
};

let drawing: Drawing = NOTHING_DRAWN;
const listeners = new Set<() => void>();

/*
 * One object per change, kept until the next one.
 *
 * `useSyncExternalStore` compares what it is handed with what it had, and a
 * fresh object on every read never compares equal -- which is a render every
 * time React looks, for a font nobody has touched.
 */
function publish(next: Drawing): void {
  drawing = next;
  for (const listener of listeners) listener();
}

/** Say a drawing changed, and give back the new count for whoever holds one. */
export function drawingChanged(): number {
  const count = drawing.count + 1;
  publish({ ...drawing, count });
  return count;
}

/** Say what the drawing is now, from the one place the store writes its state. */
export function drawingIs(now: Omit<Drawing, "count">): void {
  if (
    now.canUndo === drawing.canUndo &&
    now.canRedo === drawing.canRedo &&
    now.familyName === drawing.familyName &&
    now.base === drawing.base
  ) {
    return;
  }
  publish({ ...now, count: drawing.count });
}

export function subscribeToDrawings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const drawingSoFar = (): Drawing => drawing;

/** For a component that has to re-render when the drawing changes. */
export function useDrawing(): Drawing {
  return useSyncExternalStore(subscribeToDrawings, drawingSoFar, drawingSoFar);
}

// ---------------------------------------------------------------------------
// Reaching the store when something is actually asked of it
// ---------------------------------------------------------------------------

/*
 * Every one of these is a click, and by the time most of them can be clicked
 * the engine has already arrived -- there is nothing to undo until somebody
 * has drawn, and drawing is what loads it, so the `import()` resolves from
 * cache. `startDrawingFrom` is the exception: it is how somebody arrives at
 * the drawing half for the first time, and it is the one that waits.
 */

/** Take back the last change to the drawing. */
export async function undoDrawing(): Promise<void> {
  const { forgeStore } = await import("./forge-store");
  forgeStore.undo();
}

/** And put it back. */
export async function redoDrawing(): Promise<void> {
  const { forgeStore } = await import("./forge-store");
  forgeStore.redo();
}

/** Start a drawing from the proportions measured off somebody else's font. */
export async function startDrawingFrom(measured: Measured, name: string): Promise<void> {
  const [{ seedFrom }, { forgeStore }] = await Promise.all([
    import("@/library/seed"),
    import("./forge-store"),
  ]);
  const seeded = seedFrom(measured, name);
  forgeStore.startFromStyle(seeded.style, seeded.base);
}

/** Put a letter into the drawing, in through the same door a file comes in by. */
export async function lendToDrawing(arrival: Arrival, from: string): Promise<void> {
  const { forgeStore } = await import("./forge-store");
  forgeStore.takeLetter(arrival, from);
}

/** Put a saved drawing back. */
export async function restoreDrawing(saved: DrawnProject): Promise<void> {
  const { forgeStore } = await import("./forge-store");
  forgeStore.restore(saved);
}

/*
 * Saving is the one that cannot wait for a fetch.
 *
 * The session is written on the way out of the page as well as on a timer, and
 * there is no awaiting anything during `pagehide` -- so the store hands over a
 * way to read it as soon as it loads, and until then there is nothing to read.
 * That is not a gap: a store nobody has imported holds the style it opens on,
 * which is not work, and the store refuses to hand that over anyway.
 */
let readDrawing: (() => DrawnProject | undefined) | null = null;

/** Said by the store when it loads, so a save can reach it without a fetch. */
export function drawingReadableBy(read: () => DrawnProject | undefined): void {
  readDrawing = read;
}

/** What there is to keep of the drawing, or nothing if nobody has drawn one. */
export function drawingToKeep(): DrawnProject | undefined {
  return readDrawing?.();
}
