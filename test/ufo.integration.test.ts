/**
 * A real UFO, read and written, checked against the implementation everybody
 * else in this ecosystem uses.
 *
 * The unit tests next to the readers use fixtures this project wrote, which
 * proves the reader and the writer agree with each other and not much else. The
 * folder here was produced by `ufoLib2` and is checked in as it came out, and
 * what is written back is handed to `fontTools.ufoLib` to read. Both halves are
 * somebody else's code, which is the whole point: a UFO is an interchange
 * format, and a format only one program can read is not one.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateTypeface } from "../src/font/validate";
import { readUfo, writeUfo } from "../src/ufo/font";
import { hasUfoLib, inspectUfo, loadUfoDirectory, writeUfoDirectory } from "./ufo-tools";

const FIXTURE = join(__dirname, "fixtures", "FixtureSans-Regular.ufo");
const present = existsSync(FIXTURE);
const suite = present ? describe : describe.skip;

suite("a UFO written by another tool", () => {
  const files = present ? loadUfoDirectory(FIXTURE) : new Map();

  it("opens, with its name, its em and its lines", () => {
    const { typeface } = readUfo(files)!;
    expect(typeface.meta.familyName).toBe("Fixture Sans");
    expect(typeface.meta.styleName).toBe("Regular");
    expect(typeface.unitsPerEm).toBe(1000);
    expect(typeface.metrics).toEqual({
      ascender: 750,
      descender: -250,
      capHeight: 700,
      xHeight: 500,
      lineGap: 0,
    });
  });

  it("reads a name with characters that had to be written as entities", () => {
    // The fixture's copyright is "Café & co — test", which reaches the file as
    // numeric character references and an escaped ampersand.
    const { typeface } = readUfo(files)!;
    expect(typeface.meta.copyright).toBe("Café & co — test");
  });

  it("keeps the curve that wraps round the end of a closed contour", () => {
    /*
     * The trap, in a file this project did not write. `o` is four cubic
     * segments and the last two control points in the list belong to the
     * segment arriving back at the first point. A reader that stops at the end
     * of the list gives the `o` a flat bottom.
     */
    const { typeface } = readUfo(files)!;
    const o = typeface.glyphs.find((one) => one.name === "o")!;
    expect(o.contours).toHaveLength(1);
    expect(o.contours[0].closed).toBe(true);
    expect(o.contours[0].nodes).toHaveLength(4);
    const first = o.contours[0].nodes[0];
    expect(first.point).toEqual({ x: 300, y: 0 });
    expect(first.handleIn).toEqual({ x: 130, y: 0 });
    expect(first.handleOut).toEqual({ x: 470, y: 0 });
    // Written smooth by the tool that made it, and still smooth here.
    expect(first.type).toBe("smooth");
  });

  it("keeps an open contour open and a straight one straight", () => {
    const { typeface } = readUfo(files)!;
    const open = typeface.glyphs.find((one) => one.name === "openpath")!;
    expect(open.contours[0].closed).toBe(false);
    expect(open.contours[0].nodes).toHaveLength(2);

    const square = typeface.glyphs.find((one) => one.name === "square")!;
    expect(square.contours[0].nodes.every((node) => !node.handleIn && !node.handleOut)).toBe(true);
  });

  it("reads the components, the anchors and the characters", () => {
    const { typeface } = readUfo(files)!;
    const aacute = typeface.glyphs.find((one) => one.name === "Aacute")!;
    expect(aacute.components.map((one) => one.glyphName)).toEqual(["A", "acute"]);
    expect(aacute.components[1].transform.dx).toBe(100);
    expect(aacute.unicodes).toEqual([0xc1]);

    const a = typeface.glyphs.find((one) => one.name === "A")!;
    expect(a.anchors).toEqual([{ name: "top", x: 350, y: 700 }]);
  });

  it("reads the kerning, groups and pairs alike", () => {
    const { typeface } = readUfo(files)!;
    expect(typeface.kerning).toEqual([{ left: "A", right: "square", value: -15 }]);
    expect(typeface.kernClasses).toHaveLength(1);
    expect(typeface.kernClasses[0].left).toEqual(["A", "Aacute"]);
    expect(typeface.kernClasses[0].right).toEqual(["o"]);
    expect(typeface.kernClasses[0].value).toBe(-40);
  });

  it("puts the glyphs in the order the file asked for", () => {
    const { typeface } = readUfo(files)!;
    expect(typeface.glyphs.map((one) => one.name)).toEqual([
      ".notdef",
      "A",
      "Aacute",
      "o",
      "square",
      "openpath",
    ]);
  });

  it("is not reported as wound the wrong way, which it was", () => {
    /*
     * The fault this found. A UFO winds its outer contours counter-clockwise
     * because PostScript convention is what the format specifies; the checks
     * judged every font against TrueType's, which was right for as long as a
     * font could only arrive from a `.ttf`. So the first thing this
     * application said about a perfectly good source file, written by the
     * reference implementation, was that its round letters were broken.
     */
    const { typeface } = readUfo(files)!;
    const report = validateTypeface(typeface);
    const directions = report.findings.filter((one) => one.check === "contour-direction");
    // A Finding carries a title and a detail; `message` was never a field, so
    // this line used to report "undefined; undefined" on the day it failed.
    expect(
      directions,
      directions.map((one) => `${one.glyph ?? "?"}: ${one.title}`).join("; "),
    ).toEqual([]);
  });

  it("carries through the private key another tool left in the lib", () => {
    // `com.somebody.private` means nothing here and everything to whoever put
    // it there. Losing it on save is what makes an editor a filter.
    const { carried } = readUfo(files)!;
    const out = writeUfo(readUfo(files)!.typeface, carried);
    // It rode in `lib.plist`, which this writer replaces, so this is the case
    // the carried set cannot cover and the reader has to keep deliberately.
    expect(files.has("lib.plist")).toBe(true);
    expect(out.has("lib.plist")).toBe(true);
  });
});

const canCheck = present && hasUfoLib();
const checked = canCheck ? describe : describe.skip;

checked("a UFO written here, read by fontTools", () => {
  const files = present ? loadUfoDirectory(FIXTURE) : new Map();

  it("is a UFO, and says what the one that came in said", () => {
    const first = readUfo(files)!;
    const written = writeUfo(first.typeface, first.carried);
    const report = inspectUfo(writeUfoDirectory(written));

    expect(report.familyName).toBe("Fixture Sans");
    expect(report.styleName).toBe("Regular");
    expect(report.unitsPerEm).toBe(1000);
    expect(report.ascender).toBe(750);
    expect(report.descender).toBe(-250);
    expect(report.capHeight).toBe(700);
    expect(report.xHeight).toBe(500);
    expect(report.copyright).toBe("Café & co — test");
  });

  it("has every glyph in it, at the width it had", () => {
    const first = readUfo(files)!;
    const report = inspectUfo(writeUfoDirectory(writeUfo(first.typeface, first.carried)));

    expect(Object.keys(report.glyphs).sort()).toEqual(
      [".notdef", "A", "Aacute", "o", "openpath", "square"].sort(),
    );
    expect(report.glyphs.o.width).toBe(600);
    expect(report.glyphs.A.width).toBe(700);
    // Four segments, three control pairs written inline and one wrapping, so
    // twelve points -- the same twelve the file came in with.
    expect(report.glyphs.o.points).toBe(12);
    expect(report.glyphs.Aacute.components).toEqual(["A", "acute"]);
  });

  it("keeps the kerning readable as kerning", () => {
    const first = readUfo(files)!;
    const report = inspectUfo(writeUfoDirectory(writeUfo(first.typeface, first.carried)));

    const values = report.kerning.map(([, , value]) => value).sort((a, b) => a - b);
    expect(values).toEqual([-40, -15]);
    // The group has to keep the prefix the format reserves, or kerning will
    // not look in it.
    const groupNames = Object.keys(report.groups);
    expect(groupNames.some((name) => name.startsWith("public.kern1."))).toBe(true);
    expect(Object.values(report.groups)).toContainEqual(["A", "Aacute"]);
  });

  it("keeps the glyph order", () => {
    const first = readUfo(files)!;
    const report = inspectUfo(writeUfoDirectory(writeUfo(first.typeface, first.carried)));
    expect(report.glyphOrder).toEqual([".notdef", "A", "Aacute", "o", "square", "openpath"]);
  });

  it("survives the trip twice, which is what a designer's day looks like", () => {
    // Open, save, open, save. A format that drifts a little each time is a
    // format that has lost something by the end of the week.
    const first = readUfo(files)!;
    const once = writeUfo(first.typeface, first.carried);
    const second = readUfo(once)!;
    const twice = writeUfo(second.typeface, second.carried);

    expect([...twice.keys()].sort()).toEqual([...once.keys()].sort());
    for (const [path, source] of once) {
      expect(twice.get(path), `${path} changed on the second trip`).toBe(source);
    }
  });
});
