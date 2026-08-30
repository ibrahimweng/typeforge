/**
 * That the advice stays quiet about fonts that were drawn right.
 *
 * The unit tests next door prove each rule fires when it should, on letters
 * built to fail it. This proves the other half, which is the half that
 * actually decides whether anybody keeps reading the report: run over real
 * fonts, professionally drawn and shipping on millions of machines, it should
 * have nothing to say.
 *
 * Four rules were removed or narrowed because this test caught them. `i`, `r`,
 * `n` and `m` came out of the flat-topped list -- a dot, a terminal and two
 * shoulders, all of them above the x-height on purpose. The `E` against `F`
 * arm comparison went, because DejaVu draws its `F` narrower than its `E` and
 * means to. Monospaced faces stopped being asked about their stems, because an
 * `m` fitting three stems into a `u`'s width has no other option. And the
 * whole diagonal rule went, having fired on five of the eight faces here at
 * between ten and twelve per cent, which is a convention rather than five
 * faults.
 *
 * Every one of those was a check that was wrong about correct work, and the
 * only reason any of them was found is that this test exists.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { importFont } from "../src/font/parse";
import { opticalAdvice } from "../src/font/optical";
import { FONT_SUITE_TIMEOUT } from "./fixtures";

/** Whatever of these the machine happens to have. */
const CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
  "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
  "/usr/share/fonts/truetype/freefont/FreeSerif.ttf",
];

const present = CANDIDATES.filter((path) => existsSync(path));
const suite = present.length > 0 ? describe : describe.skip;

suite("optical advice, against fonts drawn by people", { timeout: FONT_SUITE_TIMEOUT }, () => {
  for (const path of present) {
    const name = path.split("/").pop()!;
    it(`has nothing to say about ${name}`, async () => {
      const { typeface } = await importFont(new Uint8Array(readFileSync(path)), name);
      const said = opticalAdvice(typeface).map((one) => `${one.check}: ${one.title}`);
      expect(said).toEqual([]);
    });
  }

  it("reads the heights off the letters when the file does not declare them", async () => {
    /*
     * DejaVu ships an OS/2 table at version 1, which predates `sxHeight` and
     * `sCapHeight`, so the file declares neither. Falling back to half the em
     * and seven tenths of it gave 1024 and 1434 against real heights of 1120
     * and 1493 -- out by nine and four per cent, on numbers every guide and
     * every metric line in the application is drawn from.
     */
    const dejavu = present.find((path) => path.endsWith("DejaVuSans.ttf"));
    if (!dejavu) return;
    const { typeface } = await importFont(new Uint8Array(readFileSync(dejavu)), "DejaVuSans.ttf");
    expect(typeface.unitsPerEm).toBe(2048);
    expect(typeface.metrics.xHeight).toBe(1120);
    expect(typeface.metrics.capHeight).toBe(1493);
  });
});
