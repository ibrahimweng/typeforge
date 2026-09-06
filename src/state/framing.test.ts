/**
 * The one number that crosses out of the view that draws.
 *
 * Small enough to look obviously right, and worth a test for exactly two
 * reasons. Both are the faults a shared module with state in it actually has,
 * and neither shows up as a failure anywhere near this file.
 *
 * It must not wake its listeners for a change that did not happen. `framedAt`
 * is called from a render of the view that draws, and a pan re-renders that
 * view on every frame while changing no zoom at all. A publish that does not
 * compare first would re-render the status bar sixty times a second to show it
 * the number it is already showing.
 *
 * And it must stop answering once the canvas has gone. Leave the last letter's
 * zoom standing and the spacing table has a zoom control over a canvas that is
 * not there; leave the controls registered and pressing Fit calls into a view
 * that has unmounted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { canvasControls, fitCanvas, framedAt, subscribe, zoomTo } from "./framing";

/*
 * The state is at module scope, which is the point of it, so each test puts it
 * back rather than being given a fresh copy.
 */
beforeEach(() => {
  framedAt(null);
  canvasControls(null);
});

describe("the framing the chrome is told about", () => {
  it("does not wake anybody for a number that has not moved", () => {
    const woken = vi.fn();
    const stop = subscribe(woken);

    framedAt(2);
    expect(woken).toHaveBeenCalledTimes(1);
    // The pan's frames: the view renders, this is called, the zoom is the same.
    framedAt(2);
    framedAt(2);
    expect(woken).toHaveBeenCalledTimes(1);

    framedAt(2.5);
    expect(woken).toHaveBeenCalledTimes(2);
    stop();
  });

  it("counts losing the canvas as a change, so the bar can empty itself", () => {
    const woken = vi.fn();
    framedAt(2);
    const stop = subscribe(woken);
    framedAt(null);
    expect(woken).toHaveBeenCalledTimes(1);
    stop();
  });

  it("hands the chrome's changes to whoever is drawing", () => {
    const zoomed = vi.fn();
    const fitted = vi.fn();
    canvasControls({ zoomTo: zoomed, fit: fitted });

    zoomTo(2);
    fitCanvas();

    expect(zoomed).toHaveBeenCalledWith(2);
    expect(fitted).toHaveBeenCalledTimes(1);
  });

  it("forgets them when the view that drew goes", () => {
    // The status bar is in the shell, so it is on screen on every screen --
    // including the ones with no canvas. Pressing Fit there has to do nothing
    // rather than reach into a view that has unmounted.
    const zoomed = vi.fn();
    canvasControls({ zoomTo: zoomed, fit: () => {} });
    canvasControls(null);

    expect(() => zoomTo(2)).not.toThrow();
    expect(() => fitCanvas()).not.toThrow();
    expect(zoomed).not.toHaveBeenCalled();
  });

  it("lets a listener go, so a bar that unmounts is not kept alive", () => {
    const woken = vi.fn();
    const stop = subscribe(woken);
    stop();
    framedAt(3);
    expect(woken).not.toHaveBeenCalled();
  });
});
