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
