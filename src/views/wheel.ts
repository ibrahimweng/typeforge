/**
 * The wheel on a canvas, taken off the page rather than shared with it.
 *
 * React's `onWheel` is registered passive -- React has done that since 17, for
 * the page's scrolling performance -- and a passive listener cannot call
 * `preventDefault`. It can try: the browser ignores it and says so in the
 * console. So a canvas that zoomed on Ctrl-wheel through `onWheel` zoomed the
 * drawing and then the browser zoomed the whole page as well, and a pinch on a
 * trackpad (which the browser reports as a wheel with `ctrlKey` held) did the
 * same. A plain wheel that panned the drawing also scrolled whatever was
 * scrollable around it.
 *
 * The only way to keep the page still is a native listener with
 * `{ passive: false }`, bound to the element itself, and that is what the hook
 * below is. The handler is kept in a ref so the listener is bound once per
 * element rather than once per render -- a view that pans re-renders on every
 * wheel tick, and unbinding and rebinding inside a gesture is how ticks get
 * dropped -- and it is read off the ref at the moment of the event, so it never
 * sees a stale closure.
 *
 * Bound by looking, after every render, at which element the ref now holds,
 * rather than once on mount. Both canvases that use it render an empty state
 * before there is a letter to draw, so on the first render the ref is null; an
 * effect that ran once would have taken its early exit then and never bound
 * anything, which is the fault the glyph editor's measuring ref describes.
 */

import * as React from "react";

export function useNativeWheel<T extends Element>(
  ref: React.RefObject<T | null>,
  handler: (event: WheelEvent) => void,
): void {
  const latest = React.useRef(handler);
  React.useLayoutEffect(() => {
    latest.current = handler;
  });

  const bound = React.useRef<{ element: T; unbind: () => void } | null>(null);
  React.useEffect(() => {
    const element = ref.current;
    if (bound.current?.element === element) return;
    bound.current?.unbind();
    bound.current = null;
    if (!element) return;
    const listen = (event: Event): void => latest.current(event as WheelEvent);
    element.addEventListener("wheel", listen, { passive: false });
    bound.current = { element, unbind: () => element.removeEventListener("wheel", listen) };
  });
  React.useEffect(
    () => () => {
      bound.current?.unbind();
      bound.current = null;
    },
    [],
  );
}

export interface ZoomView {
  zoom: number;
  x: number;
  y: number;
}

/**
 * One wheel tick of zoom about a point, worked out entirely from the view as
 * it was when the tick lands.
 *
 * `at` is where the pointer is, as a fraction of the drawing's box, and
 * `width` and `height` are the drawing's size in its own units at a zoom of
 * one. The view's corner moves by however much the visible span shrank or
 * grew on that side of the pointer, so the point under it stays under it.
 *
 * Both the new zoom and the pan are read off the same `was`. The Forge stage
 * used to take the zoom from the render the handler was made in and the pan
 * from the updater's view: two ticks landing before a re-render both zoomed
 * from the same stale value, the second pan was measured against a zoom the
 * first had already changed, and the letter slid out from under the pointer
 * on a fast scroll.
 */
export function zoomAbout(
  was: ZoomView,
  deltaY: number,
  at: { x: number; y: number },
  size: { width: number; height: number },
  limits: { closest: number; furthest: number },
): ZoomView {
  const zoom = Math.min(
    limits.closest,
    Math.max(limits.furthest, was.zoom * Math.exp(-deltaY / 400)),
  );
  return {
    zoom,
    x: was.x + size.width * (1 / was.zoom - 1 / zoom) * at.x,
    y: was.y + size.height * (1 / was.zoom - 1 / zoom) * at.y,
  };
}
