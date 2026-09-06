/**
 * How much of this repository is not ours to license, kept where it can be seen.
 *
 * `src/ui/` is Toolcraft's, under a licence that permits personal, internal,
 * educational and client work and does not permit selling this application as a
 * product. `NOTICE.md` and `LICENSE` say so. What neither of them said was how
 * much of it there is, and the answer turned out to matter more than the
 * warning did.
 *
 * It was 191 files and 23,635 lines. The application imported three things out
 * of all of it: `cn`, one slider, and a stylesheet. Everything else -- 144
 * files and 18,119 lines, seventy-seven per cent -- was unreachable. Not
 * deprecated, not kept for later. Unreachable: no import anywhere led to it.
 *
 * So it went, and `cn` went with it, since that is six lines of `clsx` and
 * `tailwind-merge` written the way every project using Tailwind writes them,
 * and both of those are ordinary MIT packages this project already depends on.
 * It was forty of the forty-six places the application touched the library at
 * all. `src/cn.ts` is those six lines.
 *
 * What is left is one slider, built on `@base-ui/react/slider`, which is also
 * MIT and also already a direct dependency. Replacing it would make this whole
 * repository MIT with no exceptions, and it is a design decision rather than a
 * cleanup: sliders are the primary control in a tool for drawing type, and how
 * they feel is the product.
 *
 * This file is here so the number goes down and not up. Two ways it could
 * quietly go up: the application reaching for more of the library, or dead code
 * accumulating inside it again. Both fail here.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Every source file under a directory, walked rather than globbed. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else if (/\.tsx?$/.test(path)) found.push(path);
  }
  return found;
}

/** Where an import in `from` would land, or null if it leaves the tree. */
function resolve(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(from, "..", spec);
  else return null;
  for (const suffix of [".tsx", ".ts", "/index.ts", "/index.tsx"]) {
    const candidate = base + suffix;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this one.
    }
  }
  return null;
}

const importsIn = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);

/**
 * The doors the application opens into the library.
 *
 * One, now. It was two until `cn` was brought over, and the reason to write
 * the list down rather than count it is that each entry is a place the licence
 * reaches into code that is otherwise ours.
 */
const DOORS = ["@/ui/components/controls/slider"];

describe("the part of this repository that is not ours to license", () => {
  it("is opened by the doors it says it is", () => {
    const ours = filesUnder("src").filter((file) => !file.startsWith(join("src", "ui")));
    const reached = new Set<string>();
    for (const file of ours) {
      for (const spec of importsIn(file)) {
        if (spec.startsWith("@/ui/")) reached.add(spec);
      }
    }
    expect([...reached].sort()).toEqual([...DOORS].sort());
  });

  it("holds nothing the application cannot reach", () => {
    /*
     * The check that found seventy-seven per cent of it dead. Dead code under a
     * licence like this one is the worst kind there is: it cannot be sold, it
     * cannot be tested -- `src/ui/` is excluded from coverage because it is not
     * ours to measure -- and it costs a bundle. Removing it took the compiled
     * stylesheet from 334 KB to 200 KB, because Tailwind had been generating
     * utilities for a hundred and forty-four components nobody could open.
     */
    const walk = [...DOORS.map((door) => resolve(door, "src/x.ts"))].filter(
      (file): file is string => file !== null,
    );
    const reachable = new Set<string>();
    while (walk.length > 0) {
      const file = walk.pop()!;
      if (reachable.has(file)) continue;
      reachable.add(file);
      for (const spec of importsIn(file)) {
        const next = resolve(spec, file);
        if (next?.startsWith(join("src", "ui"))) walk.push(next);
      }
    }

    const dead = filesUnder(join("src", "ui")).filter((file) => !reachable.has(file));
    expect(dead, "unreachable code under a licence that forbids selling it").toEqual([]);
  });

  it("is smaller than it was, and this is the number", () => {
    /*
     * A ceiling rather than an exact figure, so ordinary edits inside the
     * slider do not fail this, and a second component arriving does. It was
     * 23,635 lines across 191 files.
     */
    const files = filesUnder(join("src", "ui"));
    const lines = files.reduce(
      (sum, file) => sum + readFileSync(file, "utf8").split("\n").length,
      0,
    );
    expect(files.length, "files under a licence that forbids selling them").toBeLessThanOrEqual(50);
    expect(lines, "lines under a licence that forbids selling them").toBeLessThanOrEqual(6_000);
  });

  it("does not lend its `cn` back to the application", () => {
    // The one that would undo the largest part of this without looking like it:
    // a single import, and forty files follow the first one.
    const ours = filesUnder("src").filter((file) => !file.startsWith(join("src", "ui")));
    const borrowed = ours.filter((file) => importsIn(file).includes("@/ui/lib/utils"));
    expect(borrowed, "import cn from @/cn").toEqual([]);
  });
});
