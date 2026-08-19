/**
 * Test fonts.
 *
 * Tests read a font from the system rather than committing binaries to the
 * repository. DejaVu ships with essentially every Linux distribution and CI
 * image; when it is missing the tests that need it skip rather than fail, so a
 * checkout on a machine without it still runs green.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/Library/Fonts/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
];

export function findTestFont(): string | null {
  return CANDIDATES.find((path) => existsSync(path)) ?? null;
}

export function loadTestFont(): Uint8Array | null {
  const path = findTestFont();
  return path ? new Uint8Array(readFileSync(path)) : null;
}

/**
 * Timeout for suites that compile a whole font.
 *
 * These tests import DejaVu (≈400ms), run the full export pipeline over every
 * glyph (≈2.2s) and shell out to fontTools to read the result back (≈850ms),
 * so 3-5s per test is the honest cost of the work, not a hang. Vitest's 5s
 * default left no headroom at all: the suite passed on a fast machine and
 * failed on a loaded CI runner, which is a stopwatch result rather than a
 * behavioural one.
 */
export const FONT_SUITE_TIMEOUT = 60_000;

/** WOFF and WOFF2 built from the system font, or null when they cannot be. */
export interface WebFontFixtures {
  woff: Uint8Array;
  woff2: Uint8Array;
}

let webFontCache: WebFontFixtures | null | undefined;

/**
 * WOFF and WOFF2 copies of the test font.
 *
 * These used to be read from two hardcoded paths under /tmp that nothing ever
 * created, so the suite skipped everywhere except a machine where someone had
 * made them by hand — which meant the web font import path, the one a font
 * takes when it comes off a website, had no coverage at all in CI.
 *
 * They are built here instead, with fontTools rather than with this project's
 * own writer: a fixture produced by the code under test would agree with it by
 * construction and prove nothing. WOFF2 additionally needs brotli, so the
 * result stays null when either is missing and the suite skips as before.
 */
export function loadWebFontFixtures(): WebFontFixtures | null {
  if (webFontCache !== undefined) return webFontCache;

  const source = findTestFont();
  if (!source) return (webFontCache = null);

  const dir = mkdtempSync(join(tmpdir(), "typeforge-webfonts-"));
  const woff = join(dir, "DejaVuSans.woff");
  const woff2 = join(dir, "DejaVuSans.woff2");

  const build = spawnSync(
    "python3",
    [
      "-c",
      [
        "import sys",
        "from fontTools.ttLib import TTFont",
        "src, woff, woff2 = sys.argv[1:4]",
        "for path, flavor in ((woff, 'woff'), (woff2, 'woff2')):",
        "    font = TTFont(src)",
        "    font.flavor = flavor",
        "    font.save(path)",
      ].join("\n"),
      source,
      woff,
      woff2,
    ],
    { encoding: "utf8" },
  );

  if (build.status !== 0 || !existsSync(woff) || !existsSync(woff2)) {
    return (webFontCache = null);
  }

  return (webFontCache = {
    woff: new Uint8Array(readFileSync(woff)),
    woff2: new Uint8Array(readFileSync(woff2)),
  });
}
