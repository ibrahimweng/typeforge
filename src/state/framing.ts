/**
 * How the canvas on screen is framed, published to the chrome around it.
 *
 * The zoom and the pan belong to the view that draws, and they have to stay
 * there: a pan is written on every frame of a drag, and putting it in the
 * document store would re-render the whole application sixty times a second
 * for a letter that has not changed. So this is the other half of that -- the
 * one number the chrome needs, pushed out of the view, with the two ways to
 * change it.
 *
 * It is a number and two functions rather than a copy of the framing. The
 * status bar shows the zoom and can set it; nothing else out here needs the
 * pan, and a second copy of the pan kept in step by hand would be a copy that
 * eventually is not.
 *
 * `zoom` is null when nothing on screen has a canvas, which is most of the
 * application. The status bar shows no zoom rather than a stale one from the
 * last letter somebody looked at.
 */

import { useSyncExternalStore } from "react";

/** What the chrome knows about the canvas without drawing on it. */
export interface Framing {
  /** One is the fitted view, which is where every letter opens. Null: no canvas. */
  readonly zoom: number | null;
}

/**
 * The two ways the chrome changes the framing, registered by whoever draws.
 *
 * Held apart from the value above because they do not change when the zoom
 * does: a status bar that re-rendered every time it was handed a new pair of
 * closures would re-render on every wheel notch, which is the thing the whole
 * arrangement is here to avoid.
 */
export interface Controls {
  /** Set the zoom, in the same units the bar shows. One is fitted. */
  zoomTo: (zoom: number) => void;
  /** Back to the fitted view, centred. */
  fit: () => void;
}

const NO_CANVAS: Framing = { zoom: null };

let framing: Framing = NO_CANVAS;
let controls: Controls | null = null;
const listeners = new Set<() => void>();

function publish(next: Framing): void {
  framing = next;
  for (const listener of listeners) listener();
}

/**
 * Say what the zoom is now, or that there is no canvas.
 *
 * Compared before publishing, because `useSyncExternalStore` re-renders
 * whoever is listening whenever it is told something changed, and the view
 * that calls this runs on every render of a drag.
 */
export function framedAt(zoom: number | null): void {
  if (zoom === framing.zoom) return;
  publish({ zoom });
}

/** Register how the chrome may change the framing, or that it may not. */
export function canvasControls(next: Controls | null): void {
  controls = next;
}

/** Set the zoom from the chrome. Nothing happens when no canvas is drawing. */
export function zoomTo(zoom: number): void {
  controls?.zoomTo(zoom);
}

/** Put the letter back in the middle at the fitted size. */
export function fitCanvas(): void {
  controls?.fit();
}

/**
 * Exported because it is the store's own interface, not a hatch for a test.
 *
 * `useSyncExternalStore` is handed exactly this, and a test that wants to know
 * whether a listener was woken needs the same thing without a renderer. The
 * alternative is a second door built for the test, which would prove the door
 * works rather than that the store does.
 */
export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const read = (): Framing => framing;

/** Follow the framing of whatever canvas is on screen. */
export function useFraming(): Framing {
  return useSyncExternalStore(subscribe, read, read);
}
