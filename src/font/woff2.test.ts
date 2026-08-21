/**
 * The WOFF2 decoder's WebAssembly, and the copy of it we serve.
 *
 * `fonteditor-core` ships the decoder as a `.wasm` file but does not export it:
 * its `exports` map offers `./lib/*` and nothing else, so a bundler asked for
 * that path refuses. The file is therefore copied into `public/` and served as
 * one of our own assets.
 *
 * A copy of somebody else's binary is a thing that goes quietly out of date, so
 * this checks it byte for byte. An upgrade to the package that changes the
 * decoder fails here rather than in a browser, months later, as a font that
 * will not open.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

function packagedWasm(): string {
  const main = require.resolve("fonteditor-core");
  // lib/main.js -> the package root -> woff2/woff2.wasm
  return join(dirname(dirname(main)), "woff2", "woff2.wasm");
}

const SERVED = join(process.cwd(), "public", "woff2.wasm");

describe("the WOFF2 decoder we serve", () => {
  it("is there at all", () => {
    expect(existsSync(SERVED)).toBe(true);
  });

  it("is exactly the one the package installed", () => {
    const packaged = packagedWasm();
    expect(existsSync(packaged)).toBe(true);
    const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(digest(SERVED)).toBe(digest(packaged));
  });
});
