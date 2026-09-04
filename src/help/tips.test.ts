/**
 * That the coaching says what is actually there.
 *
 * A tip is prose beside a control, which is exactly the kind of text that goes
 * stale silently: nothing type-checks a sentence, and nobody re-reads the copy
 * when they add a parameter. This one had drifted -- the coach mark over the
 * control letters offered to carry an edit from "one of these five letters"
 * while the panel under it showed seven and counted "0 of 7".
 *
 * Found by looking at the panel and the sentence over it in the same
 * screenshot, which is the only way a fact like this is ever found.
 */

import { describe, expect, it } from "vitest";

import { CONTROL_GLYPHS } from "@/font/control";
import { TIPS } from "./tips";

/** The small numbers, as prose writes them. */
const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

describe("the coaching", () => {
  it("counts the control letters the way the panel does", () => {
    expect(TIPS.controls).toContain(`these ${WORDS[CONTROL_GLYPHS.length]} letters`);
  });

  it("is a sentence everywhere, so it reads as one beside a control", () => {
    for (const [where, text] of Object.entries(TIPS)) {
      expect(text.trim(), where).toBe(text);
      expect(text.length, where).toBeGreaterThan(20);
      expect(text.trimEnd().endsWith("."), `${where} does not end in a full stop`).toBe(true);
    }
  });
});
