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

import { contoursToSvgPath } from "@/font/geometry";
import { exportFont } from "@/font/export";
import { importFont } from "@/font/parse";
import { PLAIN_HAND } from "@/quill/controls";
import { toTypeface } from "@/quill/typeface";
import { drawTraced, quillStore } from "@/state/useQuill";
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
      expect(
        one.glyph.strokes.length,
        `${one.glyph.name} came back with no strokes`,
      ).toBeGreaterThan(0);
      expect(
        one.source.length,
        `${one.glyph.name} lost the outline it was read from`,
      ).toBeGreaterThan(0);
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

/**
 * That a traced font can leave, and can come back.
 *
 * The two faults these cover were the worst in the application and they were
 * the same fault twice: the engine that recovers strokes produced nothing
 * anybody could keep. The Download button opened no dialog, and Save wrote the
 * other half of the application, so a minute of tracing and every slider after
 * it lasted exactly as long as the tab did.
 *
 * Both are checked against a real font rather than a fixture, because what is
 * being asserted is that the whole path holds: fill, thin, fit, restyle, sweep,
 * fuse, write -- and, separately, that the strokes survive a trip through JSON
 * and redraw the same ink on the way back.
 */
describeWithFont("what a traced font can be turned into", { timeout: 180_000 }, () => {
  it("writes a font file, with metrics measured off its own letters", async () => {
    const { letters, unitsPerEm } = await traceFont(loadTestFont()!, "test.ttf");
    const typeface = await toTypeface(letters, PLAIN_HAND, unitsPerEm, {
      familyName: "Test Traced",
      styleName: "Regular",
      from: "test.ttf",
    });

    expect(typeface.glyphs.length).toBeGreaterThan(20);
    // Every font must open with the box a renderer shows when it has nothing
    // else to show, and it must be first.
    expect(typeface.glyphs[0].name).toBe(".notdef");
    expect(typeface.unitsPerEm).toBe(unitsPerEm);

    /*
     * The lines, read off the ink rather than carried over.
     *
     * Checked as an ordering rather than against numbers, because the numbers
     * belong to whichever font the machine had: what has to hold on any of them
     * is that the lowercase sits under the capitals, the capitals under the
     * ascenders, and the descenders below the baseline.
     */
    const { xHeight, capHeight, ascender, descender } = typeface.metrics;
    expect(xHeight).toBeGreaterThan(0);
    expect(capHeight).toBeGreaterThan(xHeight);
    expect(ascender).toBeGreaterThanOrEqual(capHeight);
    expect(descender).toBeLessThan(0);

    // Punctuation takes the name the rest of the world uses, so a file written
    // here has a `period` where every other font has one.
    const names = new Set(typeface.glyphs.map((one) => one.name));
    if (letters.some((one) => one.glyph.name === ".")) expect(names.has("period")).toBe(true);
    expect(names.has(".")).toBe(false);

    // And it says what it is. A derivative work that has lost track of what it
    // derives from is the one thing worse than a derivative work.
    expect(typeface.meta.copyright).toContain("test.ttf");
    expect(typeface.meta.copyright).toContain("derivative");

    const written = await exportFont(typeface, {
      format: "ttf",
      fidelity: "rebuild",
      includeKerning: false,
      mergeOverlaps: false,
    });
    // A real file rather than a plausible object: the sfnt magic, and a size
    // that could not be an empty shell.
    expect(written.bytes.length).toBeGreaterThan(2000);
    expect([...written.bytes.slice(0, 4)]).toEqual([0x00, 0x01, 0x00, 0x00]);
  });

  it("survives being saved and reopened, drawing the same ink", async () => {
    const { letters, unitsPerEm } = await traceFont(loadTestFont()!, "test.ttf");
    quillStore.restore({
      letters,
      style: { ...PLAIN_HAND, weight: 1.2, slant: 8, bounce: 0.4 },
      from: "test.ttf",
      hand: null,
      name: "Test Traced",
      unitsPerEm,
    });

    const saved = quillStore.snapshot();
    expect(saved, "a traced document saved as nothing").toBeDefined();
    // Through JSON rather than by reference, which is the trip a file actually
    // takes and the one that loses anything not plain data.
    const reopened = JSON.parse(JSON.stringify(saved!)) as typeof saved;

    /*
     * The same ink exactly, not merely nearly.
     *
     * Written at full precision on purpose -- see `quill-store.ts`, where the
     * measurement is recorded -- so this can assert the strings match rather
     * than that they are close. It is the stronger claim and it is available,
     * and a tolerance here would have quietly absorbed the bug that rounding
     * introduced: two decimal places on the spine moved a letter's edge by five
     * and a half units, and every tolerance loose enough to pass that is loose
     * enough to miss a real fault.
     */
    const pathsOf = (source: typeof letters, style: typeof PLAIN_HAND) =>
      source.slice(0, 8).map((one) => contoursToSvgPath(drawTraced(one, style).contours));
    const before = pathsOf(letters, quillStore.getSnapshot().document.style);

    quillStore.restore({
      letters: [],
      style: { ...PLAIN_HAND },
      from: "",
      hand: null,
      name: "",
      unitsPerEm: 1000,
    });
    quillStore.restoreSaved(reopened!);

    const back = quillStore.getSnapshot().document;
    expect(back.letters.length).toBe(letters.length);
    expect(back.name).toBe("Test Traced");
    expect(back.from).toBe("test.ttf");
    // The hand came back too, or the sliders would silently reset every time a
    // project was opened.
    expect(back.style.weight).toBeCloseTo(1.2, 4);
    expect(back.style.slant).toBeCloseTo(8, 4);
    expect(back.style.bounce).toBeCloseTo(0.4, 4);

    /*
     * The same ink, not merely the same count.
     *
     * Rounded to a hundredth of a unit on the way into the file, so the paths
     * are compared at the precision the file actually carries rather than at
     * the precision the tracer produced.
     */
    const after = pathsOf(back.letters, back.style);
    for (const [index, path] of after.entries()) {
      expect(
        path.length,
        `letter ${back.letters[index].glyph.name} came back empty`,
      ).toBeGreaterThan(0);
    }
    expect(after).toEqual(before);

    /*
     * And the outlines it was read from are *not* in the file.
     *
     * The strokes are the work and they are kept; the source outlines are the
     * other font, and a project somebody saves and sends on has no business
     * carrying a copy of it.
     */
    expect(back.letters.every((one) => one.source.length === 0)).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("nodes");
  });
});
