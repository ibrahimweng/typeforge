/**
 * Following a pointer from the press to wherever the gesture ends.
 *
 * Every drag here listened for `pointerup` and nothing else, and a gesture
 * does not always end with one. The browser cancels a pointer instead when it
 * decides the touch was a scroll or a pinch after all, when a pen leaves the
 * range of the tablet, when the window loses the pointer to a system gesture,
 * or when the element holding the capture is taken out of the page. None of
 * those sends an up. The listeners stayed on the window, so the next time the
 * pointer moved anywhere -- with no button down at all -- the tab it had been
 * dragging went on following it, the dock went on resizing, and in Draw the
 * gesture was never closed, so the next unrelated edit folded into it and one
 * undo took both back.
 *
 * So one place that listens for both, and says which it was. A cancel is not
 * always the same as a release: a reorder that was cancelled should put
 * nothing down, where a stem already pulled in Draw has been applied and only
 * wants its gesture closed. Each caller decides.
 */

export type PointerEnd = "up" | "cancel";

export function followPointer(
  on: {
    move: (event: PointerEvent) => void;
    end: (how: PointerEnd, event: PointerEvent) => void;
  },
  target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = window,
): () => void {
  const move = (event: Event): void => on.move(event as PointerEvent);
  const up = (event: Event): void => {
    stop();
    on.end("up", event as PointerEvent);
  };
  const cancel = (event: Event): void => {
    stop();
    on.end("cancel", event as PointerEvent);
  };
  let stopped = false;
  function stop(): void {
    if (stopped) return;
    stopped = true;
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", cancel);
  }
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", cancel);
  return stop;
}
