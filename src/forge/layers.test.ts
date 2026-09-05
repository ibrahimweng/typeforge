/**
 * The door to the shaping, and what comes back while it is still shut.
 *
 * The gate is the whole of what makes the cutting deferrable, and the thing it
 * has to get right is the answer it gives before the shaping has arrived: the
 * ink it was handed, unchanged, rather than nothing, an empty outline or a
 * throw. Any of those three is a letter that vanishes for a moment on a screen
 * somebody is drawing on.
 *
 * Each case gets its own copy of the module, because the arrival is a fact
 * about the module rather than about a call -- once it has landed for one test
 * it has landed for every test after it, and the interesting half of this is
 * what happens before.
 */

import { describe, expect, it, vi } from "vitest";

import { noCast } from "@/font/cast";
import { noCuts } from "@/font/cuts";
import type { Contour } from "@/font/types";
import { SANS } from "./style";
import { scaleOf } from "./cut";

/** A fresh gate, with nothing fetched yet. */
async function shut() {
  vi.resetModules();
  return import("./layers");
}

const corner = (x: number, y: number) => ({
  point: { x, y },
  handleIn: { x, y },
  handleOut: { x, y },
  type: "corner" as const,
});

const SQUARE: Contour[] = [
  { closed: true, nodes: [corner(0, 0), corner(500, 0), corner(500, 700), corner(0, 700)] },
];

const SCALE = scaleOf(SANS);

/** Cuts with one thing switched on, which is what opens the door. */
function slotted() {
  const cuts = noCuts();
  cuts.slot.on = true;
  return cuts;
}

describe("the shaping gate", () => {
  it("hands the ink straight back when neither layer is on", async () => {
    const gate = await shut();
    expect(gate.shapedInk(SQUARE, [], SCALE, noCuts(), noCast()).contours).toBe(SQUARE);
  });

  /*
   * And does not go and fetch anything to find that out. Most letters in most
   * fonts are neither cut nor cast, so this is the common path, and a fetch
   * here would be the whole deferral undone by the first letter drawn.
   */
  it("fetches nothing to answer for a letter with neither", async () => {
    const gate = await shut();
    gate.shapedInk(SQUARE, [], SCALE, noCuts(), noCast());
    expect(gate.shapingLoaded()).toBe(false);
  });

  /*
   * The case the whole design rests on. A letter that is cut, asked for before
   * the cutting has arrived, comes back uncut rather than coming back wrong --
   * the same answer it has always given while the boolean library was still
   * on its way.
   */
  it("hands the ink back uncut while the shaping is still coming", async () => {
    const gate = await shut();
    expect(gate.shapedInk(SQUARE, [], SCALE, slotted(), noCast()).contours).toBe(SQUARE);
  });

  it("asks for the shaping when it finds it needs it", async () => {
    const gate = await shut();
    expect(gate.shapingLoaded()).toBe(false);
    gate.shapedInk(SQUARE, [], SCALE, slotted(), noCast());
    await gate.readyToShape();
    expect(gate.shapingLoaded()).toBe(true);
  });

  it("is open after waiting for it, whether or not anything asked first", async () => {
    const gate = await shut();
    await gate.readyToShape();
    expect(gate.shapingLoaded()).toBe(true);
  });

  /*
   * Asked for once, however many letters ask. `shapedInk` runs during a
   * render, forty times a second while a slider moves, so a fresh promise per
   * call would be a fresh promise per letter per frame.
   */
  it("asks once however many letters ask", async () => {
    const gate = await shut();
    for (let letter = 0; letter < 50; letter++) {
      gate.shapedInk(SQUARE, [], SCALE, slotted(), noCast());
    }
    await gate.readyToShape();
    expect(gate.shapingLoaded()).toBe(true);
  });

  it("says whether either layer is on without fetching either", async () => {
    const gate = await shut();
    expect(gate.anyShaping(noCuts(), noCast())).toBe(false);
    expect(gate.anyShaping(slotted(), noCast())).toBe(true);
    expect(gate.shapingLoaded()).toBe(false);
  });
});
