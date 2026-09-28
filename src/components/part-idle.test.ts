/**
 * A control is dimmed only when it truly does nothing: moving it, set as the
 * panel would show it dimmed, changes no letter; set so it is live, it does.
 */

import { describe, expect, it } from "vitest";

import { contoursToSvgPath } from "@/font/geometry";
import { draw, startFrom, type Forge } from "@/forge/document";
import type { PartName } from "@/forge/parts";
import { SANS, SERIF } from "@/forge/style";
import { idleControl, idleReason } from "./part-idle";

const SAMPLE = ["n", "c", "a", "r", "f", "j", "s", "e", "H", "S", "E", "l"];

function withPart(forge: Forge, part: PartName, patch: Record<string, unknown>): Forge {
  const parts = forge.style.parts as unknown as Record<string, Record<string, unknown>>;
  return {
    ...forge,
    style: {
      ...forge.style,
      parts: { ...forge.style.parts, [part]: { ...parts[part], ...patch } },
    },
  };
}

const drawing = (forge: Forge) =>
  SAMPLE.map((letter) => contoursToSvgPath(draw(letter, forge)?.contours ?? [])).join("|");

const CASES: Array<{
  part: PartName;
  key: string;
  idle: Record<string, unknown>;
  live: Record<string, unknown>;
  values: [number, number];
}> = [
  { part: "slab", key: "projection", idle: { on: false }, live: { on: true }, values: [0.3, 1.2] },
  { part: "slab", key: "thickness", idle: { on: false }, live: { on: true }, values: [0.2, 0.8] },
  {
    part: "terminal",
    key: "angle",
    idle: { kind: "round" },
    live: { kind: "angled" },
    values: [-25, 25],
  },
  {
    part: "terminal",
    key: "angle",
    idle: { kind: "butt" },
    live: { kind: "angled" },
    values: [-25, 25],
  },
  { part: "wave", key: "depth", idle: { along: "off" }, live: { along: "both" }, values: [0, 0.6] },
];

describe("the controls a part has no use for, as it is set", () => {
  for (const { part, key, idle, live, values } of CASES) {
    it(`${part} ${key} is idle with ${JSON.stringify(idle)} and live with ${JSON.stringify(live)}`, () => {
      const base = startFrom(part === "slab" ? SERIF : SANS);
      const parts = base.style.parts as unknown as Record<
        string,
        Record<string, number | boolean | string>
      >;
      const at = (patch: Record<string, unknown>, value: number) =>
        drawing(withPart(base, part, { ...patch, [key]: value }));

      expect(idleControl(part, key, { ...parts[part], ...idle } as never)).toBe(true);
      expect(idleReason(part, key, { ...parts[part], ...idle } as never)).toBeTruthy();
      expect(at(idle, values[0])).toBe(at(idle, values[1]));

      expect(idleControl(part, key, { ...parts[part], ...live } as never)).toBe(false);
      expect(at(live, values[0])).not.toBe(at(live, values[1]));
    });
  }

  it("never dims the switch itself, or a part with nothing to depend on", () => {
    expect(idleControl("slab", "on", { on: false })).toBe(false);
    expect(idleControl("bowl", "squareness", { squareness: 0 })).toBe(false);
  });
});
