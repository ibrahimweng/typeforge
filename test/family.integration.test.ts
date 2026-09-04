/**
 * A family, as it comes out of the application.
 *
 * The earlier tests say the shapes are right. This says the files are a family:
 * that a font manager will put nine of them under one name, that it will sort
 * them in the right order, and that when somebody presses the bold button it
 * will reach for exactly one of them.
 *
 * None of that is visible from inside. It lives in the name table and in OS/2,
 * both of which are read here by fontTools rather than by this project's own
 * reader -- a font that only agrees with the code that wrote it is a font that
 * agrees with nobody.
 */

import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { deliver } from "../src/forge/deliver";
import { setFamily, startFrom } from "../src/forge/document";
import { SANS } from "../src/forge/style";
import { FONT_SUITE_TIMEOUT } from "./fixtures";
import { hasFontTools, inspectFont } from "./fonttools";

function unpack(archive: Uint8Array): Record<string, Uint8Array> {
  const where = mkdtempSync(join(tmpdir(), "family-"));
  mkdirSync(join(where, "out"), { recursive: true });
  writeFileSync(join(where, "family.zip"), archive);
  execFileSync("python3", [
    "-c",
    "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
    join(where, "family.zip"),
    join(where, "out"),
  ]);
  const out: Record<string, Uint8Array> = {};
  for (const name of readdirSync(join(where, "out"))) {
    out[name] = new Uint8Array(readFileSync(join(where, "out", name)));
  }
  return out;
}

/*
 * fontTools reads every assertion in this file, so without it there is nothing
 * here to run. Skip rather than fail: that is what every other suite that
 * needs it does, and a missing tool is not a broken build.
 */
const suite = hasFontTools() ? describe : describe.skip;

suite("a family of files", { timeout: FONT_SUITE_TIMEOUT }, () => {
  it("writes one font when there is one weight", async () => {
    const written = await deliver(startFrom(SANS), { familyName: "Solo", format: "ttf" });
    expect(written.fileName).toBe("Solo-Regular.ttf");
    expect(written.members).toHaveLength(1);
    const report = inspectFont(written.bytes);
    expect(report.error).toBeUndefined();
    expect(report.names["1"]).toBe("Solo");
    expect(report.names["2"]).toBe("Regular");
    expect(report.weightClass).toBe(400);
  });

  /**
   * All the kerning, in GPOS, and no legacy `kern` table at all.
   *
   * The legacy table cannot express classes, so it has to be handed every pair
   * the classes stand for -- and a format 0 subtable addresses its pairs with
   * sixteen-bit offsets, so it holds 10,920 of them and no more. This font
   * offers three times that. Written up to the cap it was sixty-four kilobytes
   * carrying a third of the kerning, and not a third picked for mattering: the
   * expansion runs class by class, so `d` and `l` and `H` came out kerned in
   * full while `E` and `F` and `G` came out kerned in part, which sets `LT`
   * closed and `FT` open in the same word. Of forty fonts on this machine that
   * people actually set text in, thirty-nine carry GPOS and not one carries a
   * `kern` table.
   */
  it("carries every kern in GPOS and writes no legacy kern table", async () => {
    const written = await deliver(startFrom(SANS), { familyName: "Kerned", format: "ttf" });
    const report = inspectFont(written.bytes);
    expect(report.error).toBeUndefined();
    expect(report.tables).toContain("GPOS");
    expect(report.tables).not.toContain("kern");
    expect(Object.keys(report.kernPairs)).toHaveLength(0);
    expect(Object.keys(report.gposKernPairs).length).toBeGreaterThan(1000);
  });

  it("writes an archive of the whole family, each one a real font", async () => {
    const forge = setFamily(startFrom(SANS), { drawn: 400, also: [300, 700, 900] });
    const written = await deliver(forge, { familyName: "My Slab", format: "ttf" });

    expect(written.fileName).toBe("MySlab.zip");
    expect(written.members.map((one) => one.styleName)).toEqual([
      "Light",
      "Regular",
      "Bold",
      "Black",
    ]);

    const files = unpack(written.bytes);
    expect(Object.keys(files).sort()).toEqual([
      "MySlab-Black.ttf",
      "MySlab-Bold.ttf",
      "MySlab-Light.ttf",
      "MySlab-Regular.ttf",
    ]);
    for (const [name, bytes] of Object.entries(files)) {
      const report = inspectFont(bytes);
      expect(report.error, name).toBeUndefined();
      expect(report.recompiles, name).toBe(true);
      expect(report.numGlyphs, name).toBeGreaterThan(180);
    }
  });

  /*
   * The whole point of the name table gymnastics.
   *
   * Name IDs 1 and 2 hold four styles between them and no more, so a family of
   * nine puts its real name in 16 and 17 and gives the old pair something they
   * can hold. Read wrongly by any of the three operating systems, the result is
   * either nine families of one weight or one family whose bold button does
   * nothing.
   */
  it("groups every weight under one family name", async () => {
    const forge = setFamily(startFrom(SANS), { drawn: 400, also: [300, 700, 900] });
    const written = await deliver(forge, { familyName: "Grouped", format: "ttf" });
    const files = unpack(written.bytes);

    const seen: Record<
      string,
      {
        one: string;
        two: string;
        sixteen?: string;
        seventeen?: string;
        weight: number;
        bold: boolean;
      }
    > = {};
    for (const [name, bytes] of Object.entries(files)) {
      const report = inspectFont(bytes);
      seen[name] = {
        one: report.names["1"],
        two: report.names["2"],
        sixteen: report.names["16"],
        seventeen: report.names["17"],
        weight: report.weightClass,
        bold: report.isBold,
      };
    }

    // The two that fit the old scheme say so and need nothing more.
    expect(seen["Grouped-Regular.ttf"]).toMatchObject({
      one: "Grouped",
      two: "Regular",
      weight: 400,
      bold: false,
    });
    expect(seen["Grouped-Regular.ttf"].sixteen).toBeUndefined();
    expect(seen["Grouped-Bold.ttf"]).toMatchObject({
      one: "Grouped",
      two: "Bold",
      weight: 700,
      bold: true,
    });

    // The two that do not, say their real name in 16 and 17.
    expect(seen["Grouped-Light.ttf"]).toMatchObject({
      one: "Grouped Light",
      two: "Regular",
      sixteen: "Grouped",
      seventeen: "Light",
      weight: 300,
      bold: false,
    });
    expect(seen["Grouped-Black.ttf"]).toMatchObject({
      one: "Grouped Black",
      two: "Regular",
      sixteen: "Grouped",
      seventeen: "Black",
      weight: 900,
      bold: false,
    });

    // And exactly one of the four claims to be the bold.
    expect(Object.values(seen).filter((one) => one.bold)).toHaveLength(1);
  });

  it("makes each weight heavier than the one before it", async () => {
    const forge = setFamily(startFrom(SANS), { drawn: 400, also: [100, 700, 900] });
    const written = await deliver(forge, { familyName: "Rising", format: "ttf" });
    const files = unpack(written.bytes);
    // More ink is more bytes is a poor measure; the advance of an n is a good
    // one, and it is what a reader actually sees getting wider.
    const order = ["Rising-Thin.ttf", "Rising-Regular.ttf", "Rising-Bold.ttf", "Rising-Black.ttf"];
    const weights = order.map((name) => inspectFont(files[name]).weightClass);
    expect(weights).toEqual([100, 400, 700, 900]);
  });
});
