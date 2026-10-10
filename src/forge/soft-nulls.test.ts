/**
 * A soft field a document carries as null is a field left out.
 *
 * A document is read back through `settled` (document.ts), which fills in
 * every key the base it started from has and keeps every other key exactly as
 * stored -- nulls included. None of the fields the soft finishes added is on
 * any base, so a document that names one as null hands the null on to the
 * engine. Read as a number, a null is nought, which for most of them is the
 * plain drawing anyway; but a null middle arm drew the E's middle arm at its
 * least, and a null dot scale drew the i with a dot of no size.
 *
 * So each field, set to null in a document started from the Serif (where it
 * is left out) and from the Soft Serif (where it is set), must draw every
 * letter in every form exactly as the same document with the field left out,
 * to the last bit.
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

/** Every field the soft finishes added, by where it lives in the style. */
const FIELDS: Array<[string, string]> = [
  ["metrics", "middleArm"],
  ["metrics", "dotScale"],
  ["metrics", "heldPen"],
  ["slab", "tip"],
  ["slab", "swell"],
  ["slab", "headKeep"],
  ["slab", "headDepth"],
  ["shoulder", "rise"],
  ["shoulder", "armRise"],
  ["shoulder", "angle"],
  ["bowl", "blunt"],
  ["bowl", "tail"],
  ["bowl", "heft"],
  ["bowl", "heftTilt"],
  ["bowl", "heftFade"],
  ["corner", "fillet"],
  ["terminal", "soft"],
  ["terminal", "taper"],
  ["terminal", "dropTaper"],
  ["terminal", "dropSize"],
  ["terminal", "dropHang"],
  ["terminal", "dropCurl"],
  ["terminal", "dropNeck"],
];

/** The group a field lives in, in a style as JSON. */
function groupOf(style: Record<string, unknown>, where: string): Record<string, unknown> {
  return where === "metrics"
    ? (style.metrics as Record<string, unknown>)
    : ((style.parts as Record<string, unknown>)[where] as Record<string, unknown>);
}

/**
 * A document started from `face` and read back as a stored one is, with the
 * field left out, or set to null.
 */
function stored(face: Style, where: string, key: string, value: "absent" | "null"): Forge {
  const forge = JSON.parse(JSON.stringify(startFrom(face))) as Forge;
  const group = groupOf(forge.style as unknown as Record<string, unknown>, where);
  if (value === "absent") delete group[key];
  else group[key] = null;
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

describe("a soft field stored as null", () => {
  it("is still null once the document is read back, so the engine is handed it", () => {
    for (const [where, key] of FIELDS) {
      const forge = stored(SOFT_SERIF, where, key, "null");
      expect(groupOf(forge.style as unknown as Record<string, unknown>, where)[key], key).toBe(
        null,
      );
    }
  });

  it("draws the Serif as the field left out does, every letter in every form", {
    timeout: 300_000,
  }, () => {
    const wrong: string[] = [];
    const plain = drawingsOf(stored(SERIF, "metrics", "middleArm", "absent"));
    for (const [where, key] of FIELDS) {
      for (const name of moved(plain, drawingsOf(stored(SERIF, where, key, "null"))))
        wrong.push(`${where}.${key}: ${name}`);
    }
    expect(wrong).toEqual([]);
  });

  it("draws the Soft Serif as the field left out does, every letter in every form", {
    timeout: 300_000,
  }, () => {
    const wrong: string[] = [];
    for (const [where, key] of FIELDS) {
      const without = drawingsOf(stored(SOFT_SERIF, where, key, "absent"));
      for (const name of moved(without, drawingsOf(stored(SOFT_SERIF, where, key, "null"))))
        wrong.push(`${where}.${key}: ${name}`);
    }
    expect(wrong).toEqual([]);
  });

  it("draws the E's middle arm and the i's dot as left out, not at their least", () => {
    for (const [key, name] of [
      ["middleArm", "E"],
      ["dotScale", "i"],
    ] as const) {
      const without = stored(SERIF, "metrics", key, "absent");
      const nulled = stored(SERIF, "metrics", key, "null");
      const one = drawLetter(name, without.style)!;
      const other = drawLetter(name, nulled.style)!;
      expect(JSON.stringify(other.contours), key).toBe(JSON.stringify(one.contours));
    }
  });
});
