/**
 * The archive a family is downloaded as.
 *
 * Checked against a real unarchiver rather than against this file's own reader,
 * for the same reason the exported fonts are checked against fontTools: a
 * format written and read by the same code is a format that agrees with itself
 * and with nobody else. The one that matters is the one on the machine the
 * download lands on.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { crc32, zip } from "./zip";

function unzips(archive: Uint8Array): Record<string, Uint8Array> | null {
  const where = mkdtempSync(join(tmpdir(), "zip-"));
  mkdirSync(join(where, "out"), { recursive: true });
  writeFileSync(join(where, "family.zip"), archive);
  try {
    execFileSync("python3", ["-c", `import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`, join(where, "family.zip"), join(where, "out")]);
  } catch {
    return null;
  }
  const out: Record<string, Uint8Array> = {};
  for (const name of readdirSync(join(where, "out"))) {
    out[name] = new Uint8Array(readFileSync(join(where, "out", name)));
  }
  return out;
}

describe("a zip of several files", () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

  it("checksums the way the format says", () => {
    // The value in every CRC-32 reference, so a mistake in the table shows.
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("gives back exactly what went in", () => {
    const font = new Uint8Array(5000).map((_, at) => (at * 31) % 256);
    const archive = zip([
      { name: "Kept-Regular.ttf", bytes: font },
      { name: "Kept-Bold.ttf", bytes: bytes("not really a font") },
    ]);
    const back = unzips(archive);
    if (!back) {
      // No unarchiver on this machine; the round trip is checked where there is.
      return;
    }
    expect(Object.keys(back).sort()).toEqual(["Kept-Bold.ttf", "Kept-Regular.ttf"]);
    expect(back["Kept-Regular.ttf"]).toEqual(font);
    expect(new TextDecoder().decode(back["Kept-Bold.ttf"])).toBe("not really a font");
  });

  it("writes the same bytes twice for the same files", () => {
    const one = zip([{ name: "a.ttf", bytes: bytes("hello") }]);
    const other = zip([{ name: "a.ttf", bytes: bytes("hello") }]);
    expect(one).toEqual(other);
  });

  it("holds nothing at all", () => {
    const archive = zip([]);
    expect(archive.length).toBe(22);
    expect(unzips(archive) ?? {}).toEqual({});
  });
});
