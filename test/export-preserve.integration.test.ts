/**
 * A preserving export of a font somebody has actually changed.
 *
 * The rest of the export suite preserves fonts nobody touched, or touched one
 * outline of, and in that case "copy what you did not model" and "copy what is
 * still true" are the same instruction. They stop being the same the moment a
 * letter is removed, renamed or given a different character, or the family is
 * renamed -- and every one of those used to go out with the file's own tables
 * describing the font as it was: outlines shifted one glyph along, names from
 * before the rename, a GPOS with its marks thrown away for the sake of the
 * kerning.
 *
 * The font is the sample that ships with the application, with two things
 * added so there is something to lose: a mark attachment feature beside its
 * kerning, and an `hdmx`, which holds one row per glyph.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { exportFont } from "../src/font/export";
import { dependentsOf } from "../src/font/composite";
import { removeGlyph, renameGlyph } from "../src/font/library";
import { importFont } from "../src/font/parse";
import { FONT_SUITE_TIMEOUT } from "./fixtures";
import { hasFontTools, inspectFont } from "./fonttools";

const SAMPLE = join(__dirname, "../src/assets/typeforge-sample.ttf");
const suite = hasFontTools() ? describe : describe.skip;

/** Run a fontTools script over some fonts and return what it prints as JSON. */
function python<T>(script: string, ...fonts: Uint8Array[]): T {
  const dir = mkdtempSync(join(tmpdir(), "typeforge-preserve-"));
  const paths = fonts.map((bytes, index) => {
    const path = join(dir, `font${index}.ttf`);
    writeFileSync(path, bytes);
    return path;
  });
  const result = spawnSync("python3", ["-c", script, dir, ...paths], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as T;
}

/** The sample, with a `mark` feature beside its `kern` and an `hdmx` table. */
function fixture(): Uint8Array {
  const out = python<{ path: string }>(
    `
import sys, json
from fontTools.ttLib import TTFont, newTable
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
font = TTFont(sys.argv[2])
addOpenTypeFeaturesFromString(font, """
languagesystem DFLT dflt;
languagesystem latn dflt;
markClass acute <anchor 150 500> @TOP;
feature kern { pos A V -80; } kern;
feature mark { pos base A <anchor 600 1400> mark @TOP; } mark;
""", tables=["GPOS"])
hdmx = newTable("hdmx")
hdmx.hdmx = {12: {name: 6 for name in font.getGlyphOrder()}}
font["hdmx"] = hdmx
path = sys.argv[1] + "/fixture.ttf"
font.save(path)
print(json.dumps({"path": path}))
`,
    new Uint8Array(readFileSync(SAMPLE)),
  );
  return new Uint8Array(readFileSync(out.path));
}

const READ = `
import sys, json
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from io import BytesIO

def outline(font, name):
    pen = RecordingPen()
    font.getGlyphSet()[name].draw(pen)
    return repr(pen.value)

before = TTFont(sys.argv[2])
after = TTFont(sys.argv[3])
buffer = BytesIO()
after.save(buffer)
TTFont(BytesIO(buffer.getvalue())).ensureDecompiled()
order = after.getGlyphOrder()
glyf = after["glyf"]
names = after["name"]
gpos = after["GPOS"].table if "GPOS" in after else None
features = sorted({r.FeatureTag for r in gpos.FeatureList.FeatureRecord}) if gpos else []
print(json.dumps({
    "numGlyphs": after["maxp"].numGlyphs,
    "postNames": int.from_bytes(after.reader["post"][32:34], "big") if after["post"].formatType == 2 else None,
    "order": order,
    "tables": sorted(after.keys()),
    "sameOutline": {n: outline(before, n) == outline(after, n) for n in order if n in before.getGlyphOrder()},
    "components": {n: [c.glyphName for c in glyf[n].components] for n in order if glyf[n].isComposite()},
    "programs": {n: glyf[n].program.getBytecode().hex() for n in ["A", "B", "Z"] if n in order and hasattr(glyf[n], "program")},
    "sourcePrograms": {n: before["glyf"][n].program.getBytecode().hex() for n in ["A", "B", "Z"] if hasattr(before["glyf"][n], "program")},
    "cmap": {str(k): v for k, v in after.getBestCmap().items()},
    "names": {str(i): names.getDebugName(i) for i in [1, 2, 3, 4, 5, 6, 16, 17]},
    "fontRevision": after["head"].fontRevision,
    "gposFeatures": features,
}))
`;

interface Read {
  numGlyphs: number;
  postNames: number | null;
  order: string[];
  tables: string[];
  sameOutline: Record<string, boolean>;
  components: Record<string, string[]>;
  programs: Record<string, string>;
  sourcePrograms: Record<string, string>;
  cmap: Record<string, string>;
  names: Record<string, string | null>;
  fontRevision: number;
  gposFeatures: string[];
}

/** What the `mark` feature attaches where, followed through extensions. */
const MARKS = `
import sys, json
from fontTools.ttLib import TTFont
font = TTFont(sys.argv[2])
table = font["GPOS"].table
out = {"base": {}, "mark": {}, "scripts": {}}
for record in table.FeatureList.FeatureRecord:
    if record.FeatureTag != "mark":
        continue
    for index in record.Feature.LookupListIndex:
        lookup = table.LookupList.Lookup[index]
        for sub in lookup.SubTable:
            if lookup.LookupType == 9:
                sub = sub.ExtSubTable
            for glyph, base in zip(sub.BaseCoverage.glyphs, sub.BaseArray.BaseRecord):
                anchor = base.BaseAnchor[0]
                out["base"][glyph] = [anchor.XCoordinate, anchor.YCoordinate]
            for glyph, mark in zip(sub.MarkCoverage.glyphs, sub.MarkArray.MarkRecord):
                out["mark"][glyph] = [mark.MarkAnchor.XCoordinate, mark.MarkAnchor.YCoordinate]
features = table.FeatureList.FeatureRecord
for script in table.ScriptList.ScriptRecord:
    lang = script.Script.DefaultLangSys
    out["scripts"][script.ScriptTag] = sorted(features[i].FeatureTag for i in lang.FeatureIndex)
print(json.dumps(out))
`;

interface MarkRead {
  base: Record<string, number[]>;
  mark: Record<string, number[]>;
  scripts: Record<string, string[]>;
}

/** How far a mark is pushed and a pair pulled together, as HarfBuzz shapes them. */
const SHAPE = `
import sys, json
try:
    import uharfbuzz as hb
except ImportError:
    print(json.dumps(None)); sys.exit(0)
blob = hb.Blob.from_file_path(sys.argv[2])
font = hb.Font(hb.Face(blob))
def shape(text):
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, {})
    return [[p.x_advance, p.x_offset, p.y_offset] for p in buf.glyph_positions]
print(json.dumps({"mark": shape("A´"), "kern": shape("AV"), "plain": shape("AH")}))
`;

suite("a preserving export of an edited font", { timeout: FONT_SUITE_TIMEOUT }, () => {
  it("copies each untouched glyph's own outline after a letter is removed", async () => {
    const source = fixture();
    const { typeface } = await importFont(source, "fixture.ttf");
    // The letters built on it lose a part, which is a real change to them.
    const built = dependentsOf(typeface, "exclam");
    expect(removeGlyph(typeface, "exclam")).toBe(true);

    const result = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const read = python<Read>(READ, source, result.bytes);

    expect(read.numGlyphs).toBe(typeface.glyphs.length);
    expect(read.order).not.toContain("exclam");
    // Every glyph still draws what it drew, not what its neighbour drew.
    const wrong = Object.entries(read.sameOutline).filter(
      ([name, same]) => !same && !built.includes(name),
    );
    expect(wrong).toEqual([]);
    // Copied, not rebuilt: the hinting came with them.
    expect(read.programs).toEqual(read.sourcePrograms);
    expect(Object.keys(read.programs).length).toBeGreaterThan(0);
    // And a composite still names its own parts.
    expect(read.components.Aacute).toEqual(["A", "Acute"]);
    // The per-glyph table cannot be carried across a change in the count.
    expect(read.tables).not.toContain("hdmx");
    expect(read.postNames).toBe(read.numGlyphs);
    expect(result.notes.join(" ")).toMatch(/hdmx/);
  });

  it("writes renames, new characters and a new family name into the file", async () => {
    const source = fixture();
    const { typeface } = await importFont(source, "fixture.ttf");
    expect(renameGlyph(typeface, "B", "B.alt")).toBe(true);
    // A new character for an existing letter.
    const z = typeface.glyphs[typeface.glyphIndex.get("Z")!];
    z.unicodes = [...z.unicodes, 0x2124];
    typeface.meta = {
      ...typeface.meta,
      familyName: "Renamed Sans",
      styleName: "SemiBold",
      version: "Version 2.001",
    };

    const result = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const read = python<Read>(READ, source, result.bytes);

    expect(read.order).toContain("B.alt");
    expect(read.order).not.toContain("B");
    expect(read.cmap[String(0x42)]).toBe("B.alt");
    expect(read.cmap[String(0x2124)]).toBe("Z");
    expect(read.names["1"]).toBe("Renamed Sans SemiBold");
    expect(read.names["2"]).toBe("Regular");
    expect(read.names["16"]).toBe("Renamed Sans");
    expect(read.names["17"]).toBe("SemiBold");
    expect(read.names["5"]).toBe("Version 2.001");
    // What the application does not model is left as the file had it.
    expect(read.names["3"]).toBe("Typeforge Sample Regular");
    expect(read.fontRevision).toBeCloseTo(2.001, 3);
    // Nothing added or removed, so the per-glyph table still holds.
    expect(read.tables).toContain("hdmx");
  });

  it("keeps the source font's mark positioning when its kerning is written", async () => {
    const source = fixture();
    const { typeface } = await importFont(source, "fixture.ttf");
    // An edit to the kerning, so there is new kerning to write.
    const pair = typeface.kerning.find((one) => one.left === "A" && one.right === "V");
    if (pair) pair.value = -120;
    else typeface.kerning.push({ left: "A", right: "V", value: -120 });

    const result = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const read = python<Read>(READ, source, result.bytes);
    expect(read.gposFeatures).toEqual(["kern", "mark"]);
    expect(inspectFont(result.bytes).gposKernPairs["A,V"]).toBe(-120);
    // Read by fontTools through the feature, not only listed: the attachment
    // still hangs the acute at the same anchors, and on every script.
    expect(python<MarkRead>(MARKS, result.bytes)).toEqual({
      base: { A: [600, 1400] },
      mark: { acute: [150, 500] },
      scripts: { DFLT: ["kern", "mark"], latn: ["kern", "mark"] },
    });

    const dir = mkdtempSync(join(tmpdir(), "typeforge-shape-"));
    const path = join(dir, "out.ttf");
    writeFileSync(path, result.bytes);
    const shaped = spawnSync("python3", ["-c", SHAPE, dir, path], { encoding: "utf8" });
    const positions = JSON.parse(shaped.stdout) as {
      mark: number[][];
      kern: number[][];
      plain: number[][];
    } | null;
    if (positions) {
      // The acute is lifted onto the A by the mark anchor, not left where its
      // own advance would have put it.
      expect(positions.mark[1][2]).toBe(1400 - 500);
      // And A V is pulled together by the new value, not the old one.
      expect(positions.kern[0][0]).toBe(positions.plain[0][0] - 120);
    }

    // Kerning switched off takes the kerning out and leaves the marks.
    const without = await exportFont(typeface, {
      format: "ttf",
      fidelity: "preserve",
      now: 0,
      includeKerning: false,
    });
    expect(python<Read>(READ, source, without.bytes).gposFeatures).toEqual(["mark"]);
  });
});

const OS2 = `
import sys, json
from fontTools.ttLib import TTFont
font = TTFont(sys.argv[2])
names = font["name"]
print(json.dumps({
    "names": {str(i): names.getDebugName(i) for i in [1, 2, 4, 16, 17]},
    "weightClass": font["OS/2"].usWeightClass,
    "fsSelection": font["OS/2"].fsSelection,
    "macStyle": font["head"].macStyle,
    "italicAngle": font["post"].italicAngle,
    "fontRevision": font["head"].fontRevision,
}))
`;

/**
 * The sample made to vary: a weight axis that moves `A`, `B` and `C` fifty
 * units right, a mark position that changes at the heavy end through GPOS
 * feature variations, and a variation sequence in `cmap`.
 */
function varyingFixture(): Uint8Array {
  const out = python<{ path: string }>(
    `
import sys, json
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables._f_v_a_r import Axis
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
font = TTFont(sys.argv[2])
fvar = newTable("fvar")
axis = Axis()
axis.axisTag, axis.minValue, axis.defaultValue, axis.maxValue, axis.axisNameID = "wght", 400, 400, 700, 256
font["name"].setName("Weight", 256, 3, 1, 0x409)
fvar.axes, fvar.instances = [axis], []
font["fvar"] = fvar
gvar = newTable("gvar")
gvar.version, gvar.reserved, gvar.variations = 1, 0, {}
glyf = font["glyf"]
for name in ["A", "B", "C"]:
    count = len(glyf[name].getCoordinates(glyf)[0]) + 4
    gvar.variations[name] = [TupleVariation({"wght": (0, 1, 1)}, [(50, 0)] * count)]
font["gvar"] = gvar
addOpenTypeFeaturesFromString(font, """
languagesystem DFLT dflt;
markClass acute <anchor 150 500> @TOP;
feature kern { pos A V -80; } kern;
feature mark { pos base A <anchor 600 1400> mark @TOP; } mark;
conditionset heavy { wght 600 700; } heavy;
variation mark heavy { pos base A <anchor 600 1500> mark @TOP; } mark;
""", tables=["GPOS"])
sequences = CmapSubtable.newSubtable(14)
sequences.platformID, sequences.platEncID, sequences.language, sequences.cmap = 0, 5, 0, {}
sequences.uvsDict = {0xFE00: [(0x41, "Aacute"), (0x42, None)]}
font["cmap"].tables.insert(0, sequences)
path = sys.argv[1] + "/varying.ttf"
font.save(path)
print(json.dumps({"path": path}))
`,
    new Uint8Array(readFileSync(SAMPLE)),
  );
  return new Uint8Array(readFileSync(out.path));
}

const VARYING = `
import sys, json
from io import BytesIO
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
font = TTFont(sys.argv[2])
buffer = BytesIO()
font.save(buffer)
heavy = instantiateVariableFont(TTFont(BytesIO(buffer.getvalue())), {"wght": 700})
def xmin(f, name):
    g = f["glyf"][name]
    g.recalcBounds(f["glyf"])
    return g.xMin
gpos = font["GPOS"].table if "GPOS" in font else None
tags = [r.FeatureTag for r in gpos.FeatureList.FeatureRecord] if gpos else []
def anchor(lookup_indices):
    # The last lookup that places A wins: each attachment repositions the mark.
    found = None
    for index in lookup_indices:
        lookup = gpos.LookupList.Lookup[index]
        for sub in lookup.SubTable:
            if lookup.LookupType == 9:
                sub = sub.ExtSubTable
            if hasattr(sub, "BaseCoverage") and "A" in sub.BaseCoverage.glyphs:
                found = sub.BaseArray.BaseRecord[sub.BaseCoverage.glyphs.index("A")].BaseAnchor[0].YCoordinate
    return found
swaps = []
if gpos and getattr(gpos, "FeatureVariations", None):
    for record in gpos.FeatureVariations.FeatureVariationRecord:
        for sub in record.FeatureTableSubstitution.SubstitutionRecord:
            swaps.append([tags[sub.FeatureIndex], anchor(sub.Feature.LookupListIndex)])
default_mark = [r for r in gpos.FeatureList.FeatureRecord if r.FeatureTag == "mark"] if gpos else []
os2, head, post = font["OS/2"], font["head"], font["post"]
print(json.dumps({
    "moved": {n: xmin(heavy, n) - xmin(font, n) for n in ["A", "B", "C"]},
    "sequences": {str(k): [[c, g] for c, g in sorted(v)] for k, v in font["cmap"].getcmap(0, 5).uvsDict.items()},
    "features": sorted(set(tags)),
    "defaultMark": anchor(default_mark[0].Feature.LookupListIndex) if default_mark else None,
    "swaps": swaps,
    "fsSelection": os2.fsSelection,
    "macStyle": head.macStyle,
    "italicAngle": post.italicAngle,
    "style": font["name"].getDebugName(2),
}))
`;

suite("a preserving export of an edited varying font", { timeout: FONT_SUITE_TIMEOUT }, () => {
  it("keeps what varies, stills what was redrawn, and restates the style", async () => {
    const source = varyingFixture();
    const { typeface } = await importFont(source, "varying.ttf");
    expect(removeGlyph(typeface, "exclam")).toBe(true);
    // B redrawn: its old movement described points it no longer has.
    const b = typeface.glyphs[typeface.glyphIndex.get("B")!];
    b.contours = b.contours.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => ({
        ...node,
        point: { x: node.point.x + 10, y: node.point.y },
        handleIn: node.handleIn ? { x: node.handleIn.x + 10, y: node.handleIn.y } : null,
        handleOut: node.handleOut ? { x: node.handleOut.x + 10, y: node.handleOut.y } : null,
      })),
    }));
    b.dirty = true;
    // A new character, so the cmap is rebuilt and has to carry its sequences.
    const z = typeface.glyphs[typeface.glyphIndex.get("Z")!];
    z.unicodes = [...z.unicodes, 0x2124];
    typeface.meta = { ...typeface.meta, styleName: "Bold Italic", weightClass: 700 };

    const result = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const read = python<{
      moved: Record<string, number>;
      sequences: Record<string, Array<[number, string | null]>>;
      features: string[];
      defaultMark: number;
      swaps: Array<[string, number | null]>;
      fsSelection: number;
      macStyle: number;
      italicAngle: number;
      style: string;
    }>(VARYING, result.bytes);

    // (a) A and C still move, each by its own deltas after the removal; B,
    // redrawn, holds still rather than distorting.
    expect(read.moved).toEqual({ A: 50, B: 0, C: 50 });
    expect(result.notes.join(" ")).toMatch(/B keeps the shape/);
    // (c) The variation sequences survived the rebuilt cmap, renumbered.
    expect(read.sequences).toEqual({
      [String(0xfe00)]: [
        [0x41, "Aacute"],
        [0x42, null],
      ],
    });
    // (b) And the bits agree with the new name.
    expect(read.style).toBe("Bold Italic");
    expect(read.fsSelection & 0x61).toBe(0x21);
    expect(read.macStyle & 3).toBe(3);
    expect(read.italicAngle).toBe(-12);
  });

  it("merges new kerning without losing the feature variations", async () => {
    const source = varyingFixture();
    const { typeface } = await importFont(source, "varying.ttf");
    // New kerning, so the GPOS is merged rather than left alone.
    typeface.kerning = [...typeface.kerning, { left: "A", right: "W", value: -30 }];
    const result = await exportFont(typeface, { format: "ttf", fidelity: "preserve", now: 0 });
    const read = python<{
      moved: Record<string, number>;
      features: string[];
      defaultMark: number;
      swaps: Array<[string, number | null]>;
    }>(VARYING, result.bytes);
    expect(read.features).toEqual(["kern", "mark"]);
    expect(read.defaultMark).toBe(1400);
    // The heavy end's mark position is still swapped in, through the merge.
    expect(read.swaps).toEqual([["mark", 1500]]);
    expect(inspectFont(result.bytes).gposKernPairs["A,W"]).toBe(-30);
    // Nothing redrawn, so everything still moves.
    expect(read.moved).toEqual({ A: 50, B: 50, C: 50 });
  });
});

suite("an OpenType export", { timeout: FONT_SUITE_TIMEOUT }, () => {
  it("says what the face weighs and names it the way the TrueType path does", async () => {
    const { typeface } = await importFont(new Uint8Array(readFileSync(SAMPLE)), "sample.ttf");
    typeface.meta = {
      ...typeface.meta,
      familyName: "Sample",
      styleName: "SemiBold",
      weightClass: 600,
      version: "Version 2.001",
    };
    const result = await exportFont(typeface, { format: "otf", fidelity: "rebuild", now: 0 });
    const read = python<{
      names: Record<string, string | null>;
      weightClass: number;
      fsSelection: number;
      macStyle: number;
      italicAngle: number;
      fontRevision: number;
    }>(OS2, result.bytes);

    expect(read.weightClass).toBe(600);
    expect(read.names["1"]).toBe("Sample SemiBold");
    expect(read.names["2"]).toBe("Regular");
    expect(read.names["4"]).toBe("Sample SemiBold");
    expect(read.names["16"]).toBe("Sample");
    expect(read.names["17"]).toBe("SemiBold");
    // Regular in the old pair, and not the family's bold.
    expect(read.fsSelection & 0x40).toBe(0x40);
    expect(read.fsSelection & 0x21).toBe(0);
    expect(read.macStyle).toBe(0);
    expect(read.fontRevision).toBeCloseTo(2.001, 3);
  });

  it("marks a bold italic as both, and slants it", async () => {
    const { typeface } = await importFont(new Uint8Array(readFileSync(SAMPLE)), "sample.ttf");
    typeface.meta = {
      ...typeface.meta,
      familyName: "Sample",
      styleName: "Bold Italic",
      weightClass: 700,
    };
    const result = await exportFont(typeface, { format: "otf", fidelity: "rebuild", now: 0 });
    const read = python<{
      names: Record<string, string | null>;
      weightClass: number;
      fsSelection: number;
      macStyle: number;
      italicAngle: number;
    }>(OS2, result.bytes);
    expect(read.weightClass).toBe(700);
    expect(read.names["2"]).toBe("Bold Italic");
    expect(read.fsSelection & 0x61).toBe(0x21);
    expect(read.macStyle).toBe(3);
    expect(read.italicAngle).toBe(-12);
  });
});
