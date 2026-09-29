/**
 * Which of the three generators is on screen, published to the chrome.
 *
 * The status bar sits in the shell, which knows the mode, but the shell hands
 * the mode down as a prop and the bar was drawn without one -- so on the Draw
 * page it described the editor's font and said "Nothing open". The views know
 * when they are showing, and say so here on the way in and out, the way a
 * canvas publishes its zoom in `framing.ts`. Nothing published means the
 * editor, which is what the bar described already.
 */

import { useEffect, useSyncExternalStore } from "react";

export type Surface = "forge" | "assemble" | "quill";

let shown: Surface | null = null;
const listeners = new Set<() => void>();

function publish(next: Surface | null): void {
  if (next === shown) return;
  shown = next;
  for (const listener of listeners) listener();
}

/** Say a view has come on screen. */
export function surfaceShown(surface: Surface): void {
  publish(surface);
}

/** Say it has gone, unless another has already taken its place. */
export function surfaceGone(surface: Surface): void {
  if (shown === surface) publish(null);
}

/** For a view: say it is on screen while it is mounted. */
export function useShowing(surface: Surface): void {
  useEffect(() => {
    surfaceShown(surface);
    return () => surfaceGone(surface);
  }, [surface]);
}

export function subscribeToSurface(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const surfaceNow = (): Surface | null => shown;

/** The generator on screen, or null for the editor. */
export function useSurface(): Surface | null {
  return useSyncExternalStore(subscribeToSurface, surfaceNow, surfaceNow);
}
