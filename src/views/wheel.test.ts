/**
 * A wheel tick of zoom about the pointer, worked from one view throughout.
 */

import { describe, expect, it } from "vitest";

import { zoomAbout } from "./wheel";

const size = { width: 1000, height: 800 };
const limits = { closest: 6, furthest: 0.4 };

describe("zooming about the pointer", () => {
  it("keeps the point under the pointer where it was", () => {
    const was = { zoom: 1, x: 0, y: 0 };
    const at = { x: 0.25, y: 0.75 };
    const next = zoomAbout(was, -200, at, size, limits);
    expect(next.zoom).toBeGreaterThan(1);
    // The font-unit position under the pointer, before and after.
    const under = (view: typeof was) => ({
      x: view.x + (size.width / view.zoom) * at.x,
      y: view.y + (size.height / view.zoom) * at.y,
    });
    expect(under(next).x).toBeCloseTo(under(was).x);
    expect(under(next).y).toBeCloseTo(under(was).y);
  });

  it("compounds two ticks that land before a render", () => {
    // What a stale zoom broke: the second tick must start from the first's.
    const at = { x: 0.5, y: 0.5 };
    const once = zoomAbout({ zoom: 1, x: 0, y: 0 }, -100, at, size, limits);
    const twice = zoomAbout(once, -100, at, size, limits);
    expect(twice.zoom).toBeCloseTo(Math.exp(200 / 400));
    const center = (view: typeof once) => view.x + size.width / view.zoom / 2;
    expect(center(twice)).toBeCloseTo(center({ zoom: 1, x: 0, y: 0 }));
  });

  it("stops at the limits", () => {
    expect(zoomAbout({ zoom: 5.9, x: 0, y: 0 }, -4000, { x: 0, y: 0 }, size, limits).zoom).toBe(6);
    expect(zoomAbout({ zoom: 0.5, x: 0, y: 0 }, 4000, { x: 0, y: 0 }, size, limits).zoom).toBe(0.4);
  });
});
