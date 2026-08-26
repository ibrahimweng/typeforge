/**
 * Documents written before the fields they are missing.
 *
 * This application writes the drawing into the browser as it goes and reads it
 * back on the next visit, so every field added to a drawing is a field that
 * somebody's kept document does not have. That is fine for an optional one and
 * fatal for a required one: a `parts` object with a key missing is not a
 * document that reads a little oddly, it is `undefined.on` thrown on the first
 * letter drawn, and with the whole tree unmounted and the page nearly black
 * what the person sees is a black screen with nothing on it.
 *
 * Which is what happened. The join went in as a required part, the reader was
 * not told, and anybody who had opened the page before that day lost it.
 *
 * So this walks the parts the current shape has and checks each one can be
 * missing -- not the one that was missed last time. A test naming `script`
 * would have been written the same day the bug was, and would have passed.
 */
import { describe, expect, it } from "vitest";

import { drawLetter } from "@/forge/build";
import { startFrom, whole } from "@/forge/document";
import { BASES, SANS, type Parts } from "@/forge/style";
import { readProject } from "./format";

/** A document as it would have been written before `part` existed. */
function savedWithout(part: string): unknown {
  const forge = JSON.parse(JSON.stringify(startFrom(SANS)));
  delete forge.style.parts[part];
  return {
    typeforge: 1,
    saved: new Date(0).toISOString(),
    mode: "forge",
    draw: { familyName: "Kept", forge },
  };
}

const PARTS = Object.keys(SANS.parts) as Array<keyof Parts>;

describe("a drawing kept before a part existed", () => {
  it("has parts to check", () => {
    expect(PARTS.length).toBeGreaterThan(5);
  });

  it.each(PARTS)("still opens when %s is missing, and still draws", (part) => {
    const project = readProject(savedWithout(part));
    expect(project?.draw).toBeTruthy();
    const style = project!.draw!.forge.style;
    expect(style.parts[part]).toBeDefined();
    // The letter is the real check: a filled-in part that is filled in wrongly
    // throws here rather than in front of somebody.
    expect(drawLetter("n", style)!.contours.length).toBeGreaterThan(0);
  });

  /*
   * The neutral setting, not the current face's. A part that did not exist was
   * a part nobody had set, so what the drawing was actually made with is
   * whatever that part does when it is doing nothing.
   */
  it("fills a missing part with the setting that changes nothing", () => {
    const project = readProject(savedWithout("script"));
    expect(project!.draw!.forge.style.parts.script).toEqual(SANS.parts.script);
    expect(project!.draw!.forge.style.parts.script.on).toBe(false);
  });

  it("leaves a document that has everything exactly as it was", () => {
    for (const base of BASES) {
      const forge = startFrom(base);
      expect(whole(forge).style.parts).toEqual(forge.style.parts);
    }
  });

  /*
   * And the fields above `parts`, which were filled in before this and are
   * checked here so that the two kinds of filling-in cannot drift apart.
   */
  it("still fills the document's own fields", () => {
    const bare = JSON.parse(JSON.stringify(startFrom(SANS)));
    delete bare.family;
    delete bare.cuts;
    delete bare.cast;
    delete bare.kit;
    const back = whole(bare);
    expect(back.family).toBeDefined();
    expect(back.cuts).toBeDefined();
    expect(back.cast).toBeDefined();
    expect(back.kit).toBeDefined();
  });
});
