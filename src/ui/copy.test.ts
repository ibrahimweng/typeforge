/**
 * That the interface does not talk to people in source-comment prose.
 *
 * This file exists because of one small, embarrassing, entirely systematic
 * fault: thirty-eight lines of text a person reads on screen contained a
 * literal `--` where an em dash belonged. Not a typo in one place -- a habit,
 * carried in from the comments above the code, where a double hyphen is the
 * house style and is correct. In a hint under a slider it is not correct, and
 * in a typography tool of all things it is the kind of detail a reader notices
 * before they notice anything the tool can do.
 *
 * The check runs over the source rather than over a rendered page, because
 * what is being caught is a keystroke and the cheapest place to catch a
 * keystroke is where it was typed. Comments are exempt: their convention is
 * deliberate and is not shown to anybody.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every source file under `src`, skipping the tests themselves. */
function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      found.push(path);
    }
  };
  walk(root);
  return found;
}

/*
 * A comment line, by the only test that is cheap and does not need a parser.
 *
 * A block comment's continuation lines start with an asterisk and its opener
 * with a slash; a line comment starts with two slashes. That misses a `--`
 * sitting in a trailing comment after code on the same line, which is a case
 * this codebase does not have and which would be caught by eye in review. What
 * it must not do is the opposite -- call a line of user-facing text a comment --
 * and it cannot, because none of those three prefixes can start one.
 */
const isComment = (line: string): boolean => {
  const start = line.trimStart();
  return start.startsWith("*") || start.startsWith("//") || start.startsWith("/*");
};

describe("the words the interface uses", () => {
  it("has no double hyphens outside comments", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles("src")) {
      const lines = readFileSync(path, "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        if (isComment(line)) continue;
        /*
         * Three shapes, because prose wraps.
         *
         * A dash spaced on both sides is the obvious one. The other two are a
         * dash left at the end of a line and one carried to the start of the
         * next, which is what a formatter does to a long sentence -- and which
         * a check for the first shape alone walks straight past. Five of them
         * survived the first pass here for exactly that reason, all in the
         * longest prose in the application.
         *
         * A CSS custom property (`--accent`) and a command-line flag
         * (`--host`) match none of the three, and both appear legitimately.
         */
        if (/\s--(\s|$)|^\s*--\s/.test(line)) offenders.push(`${path}:${index + 1}`);
      }
    }
    expect(offenders, "an em dash belongs here, not two hyphens").toEqual([]);
  });
});
