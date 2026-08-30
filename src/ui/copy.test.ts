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
 * The lines of a file with the comments taken out.
 *
 * This started as a one-line test on how a line begins: an asterisk, two
 * slashes, a slash-star. That is how a comment looks in this codebase and was
 * true of every comment in it at the time. It stopped being true the first
 * time a JSX comment was written, because that form puts its prose flush
 * against the margin with no asterisk down the side, and the guard read four
 * lines of a perfectly ordinary comment as text somebody was going to see.
 *
 * So it tracks the delimiters instead of guessing from the shape. An opener
 * with no closer after it on the same line opens a block, everything up to the
 * close is comment, and a block that begins and ends on one line is cut out
 * where it sits, leaving whatever code shared the line with it. Two slashes
 * still end a line.
 *
 * What it does not do is parse. An opener inside a string literal would start
 * a block that never closes and silence the rest of the file -- which is why
 * this test does not read itself, and why the file that holds it is one of the
 * few in the tree that has such a string. A test that reads its subject as
 * text rather than as a syntax tree is still worth having: it costs
 * milliseconds and it catches a keystroke, which is all it is for.
 */
function withoutComments(source: string): Array<{ number: number; text: string }> {
  const kept: Array<{ number: number; text: string }> = [];
  let inBlock = false;
  for (const [index, line] of source.split("\n").entries()) {
    if (inBlock) {
      const closes = line.indexOf("*/");
      if (closes < 0) continue;
      inBlock = false;
      kept.push({ number: index + 1, text: line.slice(closes + 2) });
      continue;
    }
    const withoutLine = line.replace(/\/\/.*$/, " ");
    // Whole block comments first, so what is left is the code around them.
    const flattened = withoutLine.replace(/\/\*[\s\S]*?\*\//g, " ");
    const opens = flattened.indexOf("/*");
    if (opens >= 0) {
      inBlock = true;
      kept.push({ number: index + 1, text: flattened.slice(0, opens) });
      continue;
    }
    kept.push({ number: index + 1, text: flattened });
  }
  return kept;
}

describe("the words the interface uses", () => {
  it("has no double hyphens outside comments", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles("src")) {
      for (const { number, text } of withoutComments(readFileSync(path, "utf8"))) {
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
        if (/\s--(\s|$)|^\s*--\s/.test(text)) offenders.push(`${path}:${number}`);
      }
    }
    expect(offenders, "an em dash belongs here, not two hyphens").toEqual([]);
  });
});
