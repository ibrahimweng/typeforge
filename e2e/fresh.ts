/**
 * Did this run test the code that is on disk now?
 *
 * A suite that takes seventeen minutes is easy to start, edit over, and then
 * report. Its result is honest about the tree as it was when the run began and
 * says nothing at all about the tree as it is when the run ends, and the gap
 * between those two is invisible in a passing summary.
 *
 * It has already cost a wrong answer here. Four UFO tests were reported as
 * passing over a change that made them fail deterministically -- the tests had
 * run, they had passed, and they had run before the edit. Nothing in
 * "6 passed" said so, and CI found it instead.
 *
 * So the tree is fingerprinted at the start and again at the end, and a run
 * that was overtaken by an edit fails rather than reporting. Content, not
 * timestamps: a formatter that rewrites a file byte for byte should not fail a
 * run, and a checkout that restores an old mtime should not hide one.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Everything a test could be about: the application, and the tests. */
const WATCHED = ["src", "e2e"];
const EXTENSIONS = /\.(ts|tsx|css)$/;
const STAMP = join(process.cwd(), "node_modules", ".fresh-stamp");

function fingerprint(): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    // Sorted, so the same tree gives the same answer whatever order the
    // filesystem hands it back in.
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!EXTENSIONS.test(entry.name)) continue;
      hash.update(path);
      hash.update(readFileSync(path));
    }
  };
  for (const dir of WATCHED) {
    try {
      if (statSync(dir).isDirectory()) walk(dir);
    } catch {
      // A directory that is not there is not a change.
    }
  }
  return hash.digest("hex");
}

/** Taken before the first test. */
export function stamp(): void {
  writeFileSync(STAMP, fingerprint());
}

/** Taken after the last one, and compared. */
export function check(): void {
  let before: string;
  try {
    before = readFileSync(STAMP, "utf8").trim();
  } catch {
    // Nothing to compare against, which is the bookkeeping's problem and not
    // a reason to fail somebody's run.
    return;
  }
  const after = fingerprint();
  if (before === after) return;
  throw new Error(
    [
      "The source changed while this run was going.",
      "",
      "What it reported is about the tree as it was when it started, not the",
      "tree that is there now. Run it again before believing it.",
      "",
      `  at the start  ${before.slice(0, 12)}`,
      `  at the end    ${after.slice(0, 12)}`,
    ].join("\n"),
  );
}
