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

import { startFrom, whole, worthKeeping, type Forge } from "./document";
import { BASES, SANS, type Parts } from "./style";

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

/*
 * The same question asked of a document that has been away and come back.
 *
 * The test above only covers a base made a moment ago by this version of the
 * code. What is kept in somebody's browser was written by an older one, is
 * missing whatever has been added since, and is filled in by `whole` on the way
 * back -- so the thing this question is actually asked of is the filled
 * document, and it had never been asked of one.
 *
 * It answered wrongly for ninety-eight of them. An untouched base that merely
 * predates a field read as work: written down, and restored over whatever the
 * person was doing, which is precisely what the note above `worthKeeping` says
 * it exists to prevent.
 */
describe("a drawing kept before a field existed", () => {
  const PARTS = Object.keys(SANS.parts) as Array<keyof Parts>;

  /** A kept document, as JSON, without one of the things it now would have. */
  function keptWithout(base: (typeof BASES)[number], drop: (forge: Forge) => void): Forge {
    const forge = JSON.parse(JSON.stringify(startFrom(base))) as Forge;
    drop(forge);
    return whole(forge);
  }

  it("has bases and parts to check", () => {
    expect(BASES.length).toBeGreaterThan(15);
    expect(PARTS.length).toBeGreaterThan(5);
  });

  it("still reads as untouched when a part is missing", () => {
    for (const base of BASES) {
      for (const part of PARTS) {
        const kept = keptWithout(base, (forge) => {
          delete (forge.style.parts as unknown as Record<string, unknown>)[part];
        });
        expect(worthKeeping(kept, "Untitled"), `${base.name} without ${part}`).toBe(false);
      }
    }
  });

  /*
   * `alternates` was the loud one: `whole` filled every other optional field
   * and not that, so it came back undefined and compared unequal to the empty
   * object. `family` was the quiet one, and had a second consequence -- filled
   * with the plain face's weight class rather than the base's own, a Display
   * came back claiming to be a Regular.
   */
  it("still reads as untouched when a whole field is missing", () => {
    const fields = ["family", "cuts", "cast", "kit", "alternates", "effects", "cutExceptions"];
    for (const base of BASES) {
      for (const field of fields) {
        const kept = keptWithout(base, (forge) => {
          delete (forge as unknown as Record<string, unknown>)[field];
        });
        expect(worthKeeping(kept, "Untitled"), `${base.name} without ${field}`).toBe(false);
      }
    }
  });

  it("still reads as untouched when a field inside a group is missing", () => {
    for (const base of BASES) {
      const kept = keptWithout(base, (forge) => {
        const style = forge.style as unknown as Record<
          string,
          Record<string, Record<string, unknown>>
        >;
        delete style.parts.bowl.width;
        delete style.metrics.width;
        delete style.pen.contrast;
      });
      expect(worthKeeping(kept, "Untitled"), base.name).toBe(false);
    }
  });

  /*
   * And what it is filled from, which is the decision the three above rest on.
   * A document says which base it is; a field it never carried is filled from
   * that base rather than from the plain face, so a Grotesque comes back a
   * Grotesque rather than a Grotesque with a Sans shoulder.
   */
  it("fills a missing part from the base the document says it is", () => {
    const grotesque = BASES.find((one) => one.name === "Grotesque")!;
    const kept = keptWithout(grotesque, (forge) => {
      delete (forge.style.parts as unknown as Record<string, unknown>).shoulder;
    });
    expect(kept.style.parts.shoulder).toEqual(grotesque.parts.shoulder);
  });
});
