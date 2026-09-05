/**
 * Whether a drawing is work, or is only the style the application opens on.
 *
 * The question matters more than it sounds. Arriving is what triggers a
 * restore, so a drawing written down when nobody had touched it would restore
 * somebody into a font they never made -- over the top of the one they did.
 *
 * It used to be asked by `project/format.ts`, on the way to writing a session
 * down. That put the whole drawing engine on the first screen of everybody who
 * has never opened the drawing half, because answering it means comparing a
 * document against the base it came from, and the bases are the engine. It is
 * asked here now, and `state/forge-store.ts` is what asks it.
 */

import { describe, expect, it } from "vitest";

import { startFrom, worthKeeping } from "./document";
import { BASES, SANS } from "./style";

describe("whether a drawing is worth keeping", () => {
  it("says no to a base nobody has touched", () => {
    expect(worthKeeping(startFrom(SANS), "Untitled")).toBe(false);
  });

  it("says yes the moment it differs from its base", () => {
    const forge = startFrom(SANS);
    forge.style.pen.weight = SANS.pen.weight + 30;
    expect(worthKeeping(forge, "Untitled")).toBe(true);
  });

  it("says yes to one that has been named, even if nothing else changed", () => {
    expect(worthKeeping(startFrom(SANS), "Bakerloo")).toBe(true);
  });

  it("says yes to a drawing whose letters were told to differ", () => {
    const forge = startFrom(SANS);
    forge.exceptions = { n: { shoulder: { spring: 0.9 } } };
    expect(worthKeeping(forge, "Untitled")).toBe(true);
  });

  it("says no to every base it can be started from", () => {
    // A base whose own style did not survive the comparison would read as
    // touched the moment it was opened, and every session would save one.
    for (const base of BASES) {
      expect(worthKeeping(startFrom(base), "Untitled"), `${base.name} reads as edited`).toBe(false);
    }
  });
});
