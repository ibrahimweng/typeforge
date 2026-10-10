/**
 * The style field the letter-fault fixes added (`metrics.oeWall`), stored as
 * null, is the field left out -- as `soft-nulls.test.ts` holds every field
 * the soft finishes added before it.
 *
 * A document is read back through `settled` (document.ts), which keeps every
 * key the base it started from does not have exactly as stored, nulls
 * included, so a null reaches the engine. Read as a number, a null wall
 * would set the oe's e at the least crossing; it must draw every letter in
 * every form exactly as the same document with the field left out, on the
 * Serif (where it is left out) and on the Soft Serif (where it is set).
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { drawLetter, letterNames } from "./build";
import { type Forge, startFrom, whole } from "./document";
import { readyToShape } from "./layers";
import { everyFormOf } from "./letters";
import { SOFT_SERIF } from "./starts";
import { SERIF, type Style } from "./style";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

/** A document started from `face`, read back with `oeWall` left out or set to null. */
function stored(face: Style, value: "absent" | "null"): Forge {
  const forge = JSON.parse(JSON.stringify(startFrom(face))) as Forge;
  const metrics = forge.style.metrics as unknown as Record<string, unknown>;
  if (value === "absent") delete metrics.oeWall;
  else metrics.oeWall = null;
  return whole(forge);
}

/** Every letter in every form, as it would be stored. */
function drawingsOf(forge: Forge): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of letterNames()) {
    for (const { id } of everyFormOf(name)) {
      const letter = drawLetter(name, forge.style, id || undefined);
      out.set(
        `${name}${id ? `/${id}` : ""}`,
        JSON.stringify(letter ? { contours: letter.contours, advance: letter.advanceWidth } : null),
      );
    }
  }
  return out;
}

/** The letters two documents draw differently. */
function moved(one: Map<string, string>, other: Map<string, string>): string[] {
  return [...one].filter(([name, drawing]) => other.get(name) !== drawing).map(([name]) => name);
}

describe("the oe wall stored as null", () => {
  it("is still null once the document is read back, so the engine is handed it", () => {
    const forge = stored(SOFT_SERIF, "null");
    expect((forge.style.metrics as unknown as Record<string, unknown>).oeWall).toBe(null);
  });

  it("draws the Soft Serif's oe as the field left out, not as its own wall", () => {
    const own = drawLetter("oe", SOFT_SERIF)!;
    const without = drawLetter("oe", stored(SOFT_SERIF, "absent").style)!;
    const nulled = drawLetter("oe", stored(SOFT_SERIF, "null").style)!;
    // The field does something on the Soft Serif, so this is not passing by default.
    expect(JSON.stringify(own.contours)).not.toBe(JSON.stringify(without.contours));
    expect(JSON.stringify(nulled.contours)).toBe(JSON.stringify(without.contours));
  });

  for (const [label, face] of [
    ["Serif", SERIF],
    ["Soft Serif", SOFT_SERIF],
  ] as const) {
    it(`draws the ${label} as the field left out, every letter in every form`, {
      timeout: 300_000,
    }, () => {
      expect(moved(drawingsOf(stored(face, "absent")), drawingsOf(stored(face, "null")))).toEqual(
        [],
      );
    });
  }
});
