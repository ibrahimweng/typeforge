/**
 * Test fonts.
 *
 * Tests read a font from the system rather than committing binaries to the
 * repository. DejaVu ships with essentially every Linux distribution and CI
 * image; when it is missing the tests that need it skip rather than fail, so a
 * checkout on a machine without it still runs green.
 */

import { existsSync, readFileSync } from "node:fs";

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
