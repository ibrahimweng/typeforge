/**
 * Reading a whole font into strokes, and saying how far along it is.
 *
 * The fitter's accuracy on one glyph is checked in `src/quill/quill.test.ts`
 * against shapes whose strokes are known. What is left for this file is the
 * pass over a real font: that it comes back with letters, and that what it says
 * about its own progress while it does is true.
 *
 * That second one is worth a test rather than an eyeball because a progress
 * report is exactly the kind of thing that looks right and is not. A bar that
 * counts to a total it will never reach stops short on every font that is
 * missing a character; one that reports the letter it has just finished is off
 * by one against what a person reading it expects; one that counts backwards
 * for a moment during a retry is worse than none. None of that is visible from
 * a screenshot of a bar halfway along.
 */

import { describe, expect, it } from "vitest";

import { importFont } from "@/font/parse";
import { looksJoined } from "@/quill/joined";
import { traceFont, WANTED, type TraceProgress } from "@/quill/tracing";
import { findTestFont, loadTestFont } from "./fixtures";

const FONT = findTestFont();
const describeWithFont = FONT ? describe : describe.skip;

/*
 * Longer than a unit test, because this is a whole alphabet.
 *
 * Seventy letters filled, distance-transformed, thinned and fitted. It is the
 * reason the panel runs this in a worker, and the reason it is an integration
 * test rather than something in the fast suite.
 */
describeWithFont("tracing a whole font", { timeout: 180_000 }, () => {
  it("comes back with letters, and says truthfully how it got there", async () => {
    const bytes = loadTestFont()!;
    const seen: TraceProgress[] = [];
    const result = await traceFont(bytes, "test.ttf", (progress) => seen.push({ ...progress }));

    expect(result.letters.length).toBeGreaterThan(20);
    expect(result.unitsPerEm).toBeGreaterThan(0);

    // Every letter it returned is one it was asked for, and only once.
    const names = result.letters.map((one) => one.glyph.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(WANTED).toContain(name);

    // Every letter it returned has strokes, or returning it said nothing.
    for (const one of result.letters) {
      expect(one.glyph.strokes.length, `${one.glyph.name} came back with no strokes`).toBeGreaterThan(0);
      expect(one.source.length, `${one.glyph.name} lost the outline it was read from`).toBeGreaterThan(0);
    }

    expect(seen.length).toBeGreaterThan(1);
    const total = seen[0].total;

    /*
     * The total is fixed before any work starts and never moves.
     *
     * A total that grew as letters were found would make the bar slide
     * backwards, which reads as the thing having gone wrong rather than as
     * having learnt something.
     */
    expect(seen.every((one) => one.total === total)).toBe(true);

    // It starts at nothing and ends at everything, and only ever goes forward.
    expect(seen[0].done).toBe(0);
    expect(seen[seen.length - 1].done).toBe(total);
    for (let index = 1; index < seen.length; index++) {
      expect(seen[index].done).toBeGreaterThanOrEqual(seen[index - 1].done);
    }

    /*
     * The total is what will be attempted rather than what was wanted.
     *
     * Counted against the whole list instead, a bar stops short of its own end
     * on every font that does not have all seventy-one -- which is most of
     * them, and which looks exactly like a trace that died near the finish.
     */
    expect(total).toBeLessThanOrEqual(WANTED.length);
    expect(result.letters.length).toBeLessThanOrEqual(total);

    /*
     * Each report names the letter about to be read rather than the one just
     * finished. "Reading k" beside "10 of 71" is a claim about what is
     * happening, and off by one it is a claim about what already has.
     */
    const named = seen.filter((one) => one.letter !== "");
    expect(named.length).toBe(total);
    expect(new Set(named.map((one) => one.letter)).size).toBe(total);
  });
});

/**
 * That a real text face is not mistaken for a script.
 *
 * The synthetic side of this is next door in `src/quill/quill.test.ts`, where
 * boxes of ink with known sidebearings pin the rule exactly. What that cannot
 * do is stand in for a real font's spacing, and the cost of a wrong answer
 * falls entirely on this side of it: a text face called a script sends somebody
 * who opened a font to edit into a minute of tracing they did not ask for.
 *
 * So the one case worth a real font is the negative. DejaVu is a text face by
 * every measure, and if the detector ever drifts far enough to call it joined,
 * it will call half the fonts in the world joined too.
 */
describeWithFont("what a real text face reads as", () => {
  it("does not read DejaVu as a joined script", async () => {
    const { typeface } = await importFont(loadTestFont()!, "test.ttf");
    const verdict = looksJoined(typeface);
    expect(verdict.joined).toBe(false);
    // Not merely under the line: a text face keeps real space on both sides,
    // and a verdict that scraped in at a hundredth of an em would be one bad
    // font away from flipping.
    expect(verdict.tested).toBeGreaterThanOrEqual(8);
    expect(verdict.sidebearing).toBeGreaterThan(0.03);
  });
});
