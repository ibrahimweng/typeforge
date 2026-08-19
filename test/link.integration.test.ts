/**
 * Shape links against a real font.
 *
 * The synthetic tests prove the mechanism. These prove the premise: that real
 * letters genuinely share their points, so linking them propagates a design
 * rather than imposing one.
 */

import { describe, expect, it } from "vitest";

import { buildLinks, propagateMoves, pointsThatMoved, summariseLinks } from "../src/font/link";
import { importFont } from "../src/font/parse";
import { FONT_SUITE_TIMEOUT, loadTestFont } from "./fixtures";

const source = loadTestFont();
const suite = source ? describe : describe.skip;

suite("shape links on a real font", { timeout: FONT_SUITE_TIMEOUT }, () => {
  it("finds the letters that are built on n", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const summary = summariseLinks(buildLinks(typeface, "n"));
    // h is the clearest case: it is n with the left stem raised to the
    // ascender, sharing fourteen of n's sixteen points exactly.
    expect(summary.glyphs).toContain("h");
    expect(summary.points).toBeGreaterThanOrEqual(10);
  });

  it("reshaping n's arch reshapes h's arch", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const links = buildLinks(typeface, "n");
    const n = typeface.glyphs[typeface.glyphIndex.get("n")!];
    const h = typeface.glyphs[typeface.glyphIndex.get("h")!];

    // The top of n's arch, which h shares.
    const archTop = n.contours[0].nodes.findIndex((node) => node.point.y === 1147);
    expect(archTop).toBeGreaterThanOrEqual(0);
    const hBefore = h.contours[0].nodes.find((node) => node.point.y === 1147);
    expect(hBefore).toBeDefined();

    const before = structuredClone(n);
    n.contours[0].nodes[archTop].point = { x: n.contours[0].nodes[archTop].point.x, y: 1260 };

    const changed = propagateMoves(typeface, links, pointsThatMoved(before, n));
    expect(changed).toContain("h");
    expect(h.contours[0].nodes.some((node) => node.point.y === 1260)).toBe(true);
  });

  /**
   * The property that makes point matching the right mechanism: h's ascender is
   * its own. Raising n's stem must not shorten it, and nothing had to be told
   * that h has an ascender for that to hold.
   */
  it("raising n's stem leaves h's ascender where it is", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    const links = buildLinks(typeface, "n");
    const n = typeface.glyphs[typeface.glyphIndex.get("n")!];
    const h = typeface.glyphs[typeface.glyphIndex.get("h")!];

    const ascenderBefore = Math.max(...h.contours[0].nodes.map((node) => node.point.y));
    expect(ascenderBefore).toBe(1556);

    // n's stem top sits at the x-height, and h does not share those points.
    const before = structuredClone(n);
    for (const node of n.contours[0].nodes) {
      if (node.point.y === 1120) node.point = { x: node.point.x, y: 1200 };
    }

    propagateMoves(typeface, links, pointsThatMoved(before, n));
    expect(Math.max(...h.contours[0].nodes.map((node) => node.point.y))).toBe(ascenderBefore);
  });

  it("finds the letters built on the other controls too", async () => {
    const { typeface } = await importFont(source!, "DejaVuSans.ttf");
    expect(summariseLinks(buildLinks(typeface, "O")).glyphs).toContain("Q");
    expect(summariseLinks(buildLinks(typeface, "o")).glyphs).toContain("oe");
  });
});
