/**
 * Which of a part's controls have nothing to act on, the way the part is set.
 *
 * The panel drew every control live whatever the rest of the part said: with
 * the serifs switched off, Reach, Depth and Bracket still slid and changed
 * nothing; the terminal's Cut says "only an angled terminal reads it" and
 * moved under a teardrop all the same; a wave's depth moved with every run
 * straight. A control that does nothing when moved reads as a broken one.
 *
 * They are dimmed and left in place, as the joining controls are, rather than
 * hidden: they say what the switch or the choice would give access to.
 */

import type { PartName } from "@/forge/parts";

type Values = Record<string, number | boolean | string>;

export function idleControl(part: PartName, key: string, values: Values): boolean {
  // A part with a switch: everything else on it is about the thing switched.
  if ("on" in values && key !== "on" && !values.on) return true;
  if (part === "terminal" && key === "angle") return values.kind !== "angled";
  if (part === "wave" && (key === "depth" || key === "length")) return values.along === "off";
  return false;
}

/** Why it is idle, for the tooltip on the dimmed row. */
export function idleReason(part: PartName, key: string, values: Values): string | undefined {
  if (!idleControl(part, key, values)) return undefined;
  if ("on" in values && !values.on) return "Turn the switch above on to use this.";
  if (part === "terminal") return "Only an Angled finish uses this.";
  if (part === "wave") return "Pick which runs wave to use this.";
  return undefined;
}
