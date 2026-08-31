/**
 * Validation through fontTools.
 *
 * Our own reader agreeing with our own writer proves very little. fontTools is
 * the reference implementation the type industry uses, so exports are checked
 * by handing them to it and asking what it sees. Where fontTools is not
 * installed the tests that use it skip.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function hasFontTools(): boolean {
  const probe = spawnSync("python3", ["-c", "import fontTools"], { encoding: "utf8" });
  return probe.status === 0;
}

export interface FontToolsReport {
  /** "truetype" for glyf outlines, "cff" for PostScript outlines. */
  outlineFormat: "truetype" | "cff" | "unknown";
  tables: string[];
  numGlyphs: number;
  unitsPerEm: number;
  kernPairs: Record<string, number>;
  gposKernPairs: Record<string, number>;
  /** True when fontTools could recompile the font, which exercises every table it parsed. */
  recompiles: boolean;
  /**
   * Curve turns that fall inside a segment rather than on a point. Both
   * outline formats require a point at every extreme, so this should be zero.
   */
  interiorExtremes: number;
  /** Glyphs stored as references to others rather than as their own outline. */
  compositeGlyphs: number;
  /** Component glyph names of a named glyph, for checking structure survived. */
  componentsOf: Record<string, string[]>;
  /**
   * How many closed contours each glyph has, read out of the file.
   *
   * The only way to ask, from outside, whether a cut is really in the font
   * rather than only on the screen: an H drawn in one piece is one contour,
   * and an H with two bands through it is three.
   */
  contoursOf: Record<string, number>;
  /**
   * The signed area of each glyph, measured by fontTools' own pen.
   *
   * The piece count cannot tell a hole from a solid, so it cannot tell whether
   * a contour inside another one was wound to cut ink away or to put it back.
   * This can: an outline whose windings disagree with its nesting comes out
   * with the wrong amount of ink in it, whichever way the format winds.
   */
  inkOf: Record<string, number>;
  /** The Windows clipping boundary, and the real extent of the outlines. */
  winAscent: number;
  winDescent: number;
  yMax: number;
  yMin: number;
  /** The name table, by ID, which is what a font menu reads. */
  names: Record<string, string>;
  /** What OS/2 says this face weighs, and whether it claims to be the bold. */
  weightClass: number;
  isBold: boolean;
  /**
   * Every glyph's name, as the file carries them.
   *
   * A glyph reached only through a feature has no character mapped to it, so
   * its name is the only thing that identifies it from outside -- which is why
   * this font writes a `post` table that has them.
   */
  glyphNames: string[];
  /** Every glyph's advance, by name. */
  advanceWidths: Record<string, number>;
  /**
   * Every glyph's left sidebearing, by name. Held alongside the advance
   * because the pair is what says *where* a glyph differs from another: two
   * drawings of one letter that share a sidebearing differ only on the right,
   * and two that share `advance - sidebearing` differ only on the left.
   */
  sidebearings: Record<string, number>;
  /** Every drawn glyph's rightmost ink, by name. Blank glyphs are absent. */
  rightEdges: Record<string, number>;
  error?: string;
}

const INSPECT = String.raw`
import json, sys
from fontTools.ttLib import TTFont

path = sys.argv[1]
out = {"outlineFormat": "unknown", "tables": [], "numGlyphs": 0, "unitsPerEm": 0,
       "kernPairs": {}, "gposKernPairs": {}, "recompiles": False,
       "interiorExtremes": 0, "compositeGlyphs": 0, "componentsOf": {},
       "contoursOf": {}, "inkOf": {},
       "winAscent": 0, "winDescent": 0,
       "yMax": 0, "yMin": 0,
       "names": {}, "weightClass": 0, "isBold": False,
       "glyphNames": [], "advanceWidths": {}, "sidebearings": {},
       "rightEdges": {}}
try:
    f = TTFont(path)
    # Report the outline flavour rather than the raw version tag, which is
    # unprintable bytes for TrueType.
    out["outlineFormat"] = "cff" if f.sfntVersion == "OTTO" else "truetype"
    out["tables"] = sorted(t for t in f.keys() if t != "GlyphOrder")
    out["numGlyphs"] = f["maxp"].numGlyphs
    out["unitsPerEm"] = f["head"].unitsPerEm
    out["yMax"] = f["head"].yMax
    out["yMin"] = f["head"].yMin
    out["glyphNames"] = list(f.getGlyphOrder())
    out["advanceWidths"] = {n: w for n, (w, _) in f["hmtx"].metrics.items()}
    out["sidebearings"] = {n: b for n, (_, b) in f["hmtx"].metrics.items()}
    if "OS/2" in f:
        out["winAscent"] = f["OS/2"].usWinAscent
        out["winDescent"] = f["OS/2"].usWinDescent
        out["weightClass"] = f["OS/2"].usWeightClass
        out["isBold"] = bool(f["OS/2"].fsSelection & 0x20)

    if "name" in f:
        for rec in f["name"].names:
            out["names"].setdefault(str(rec.nameID), rec.toUnicode())

    if "kern" in f:
        for st in f["kern"].kernTables:
            for (l, r), v in st.kernTable.items():
                out["kernPairs"]["%s,%s" % (l, r)] = v

    # Subtables are tried in order and the first one covering a pair wins, so
    # record with setdefault to mirror how a shaper resolves the value.
    if "GPOS" in f:
        gpos = f["GPOS"].table
        for lookup in (gpos.LookupList.Lookup if gpos.LookupList else []):
            # Type 9 wraps a real lookup so a large table can use wide offsets.
            # Every font of any size uses it, so a reader that skips it sees no
            # kerning at all in most of the fonts there are.
            if lookup.LookupType not in (2, 9):
                continue
            subs = []
            for sub in lookup.SubTable:
                if lookup.LookupType == 9:
                    if sub.ExtensionLookupType != 2:
                        continue
                    subs.append(sub.ExtSubTable)
                else:
                    subs.append(sub)
            for sub in subs:
                if sub.Format == 1:
                    for first, pairset in zip(sub.Coverage.glyphs, sub.PairSet):
                        for rec in pairset.PairValueRecord:
                            val = getattr(rec.Value1, "XAdvance", 0)
                            out["gposKernPairs"].setdefault("%s,%s" % (first, rec.SecondGlyph), val)
                elif sub.Format == 2:
                    c1 = sub.ClassDef1.classDefs
                    c2 = sub.ClassDef2.classDefs
                    for lg, lc in c1.items():
                        for rg, rc in c2.items():
                            rec = sub.Class1Record[lc].Class2Record[rc]
                            val = getattr(rec.Value1, "XAdvance", 0)
                            if val:
                                out["gposKernPairs"].setdefault("%s,%s" % (lg, rg), val)

    # Count curve turns that land inside a segment instead of on a point.
    # A quadratic through on-curve p0, control q, on-curve p2 turns at
    # t = (p0 - q) / (p0 - 2q + p2); anything strictly inside (0,1) is a
    # missing extreme. Implied on-curve midpoints are expanded first.
    # How many closed contours each glyph has, from whichever outline table
    # this font carries. Counted through a pen so the two formats answer the
    # same question the same way.
    from fontTools.pens.recordingPen import RecordingPen
    from fontTools.pens.areaPen import AreaPen
    glyphs = f.getGlyphSet()
    for name in f.getGlyphOrder():
        pen = RecordingPen()
        try:
            glyphs[name].draw(pen)
        except Exception:
            continue
        out["contoursOf"][name] = sum(1 for op, _ in pen.value if op == "closePath")
        area = AreaPen(glyphs)
        try:
            glyphs[name].draw(area)
        except Exception:
            continue
        out["inkOf"][name] = area.value

    if "glyf" in f:
        glyf = f["glyf"]
        for name in f.getGlyphOrder():
            if glyf[name].isComposite():
                out["compositeGlyphs"] += 1
                if name in ("aacute", "agrave", "ccedilla", "Odieresis"):
                    out["componentsOf"][name] = [c.glyphName for c in glyf[name].components]
        for name in f.getGlyphOrder():
            g = glyf[name]
            if g.numberOfContours > 0:
                out["rightEdges"][name] = g.xMax
        for name in f.getGlyphOrder()[:600]:
            g = glyf[name]
            if g.numberOfContours <= 0:
                continue
            coords, endPts, flags = g.getCoordinates(glyf)
            coords = list(coords)
            on_flags = [x & 1 for x in flags]
            start = 0
            for end in endPts:
                pts = coords[start:end + 1]
                ons = on_flags[start:end + 1]
                start = end + 1
                n = len(pts)
                if n < 2:
                    continue
                expanded = []
                for i in range(n):
                    expanded.append((pts[i], ons[i]))
                    if not ons[i] and not ons[(i + 1) % n]:
                        nxt = pts[(i + 1) % n]
                        expanded.append((((pts[i][0] + nxt[0]) / 2, (pts[i][1] + nxt[1]) / 2), 1))
                m = len(expanded)
                for i in range(m):
                    point, is_on = expanded[i]
                    if is_on:
                        continue
                    prev = expanded[(i - 1) % m][0]
                    nxt = expanded[(i + 1) % m][0]
                    for axis in (0, 1):
                        denom = prev[axis] - 2 * point[axis] + nxt[axis]
                        if abs(denom) < 1e-9:
                            continue
                        t = (prev[axis] - point[axis]) / denom
                        if 1e-4 < t < 1 - 1e-4:
                            out["interiorExtremes"] += 1

    # Recompiling forces fontTools to serialise every table it parsed, which is
    # the strongest check available that the file is structurally sound.
    import io
    buf = io.BytesIO()
    f.save(buf)
    out["recompiles"] = True
except Exception as exc:
    out["error"] = "%s: %s" % (type(exc).__name__, exc)

print(json.dumps(out))
`;

/**
 * What a shaper actually does with a font.
 *
 * fontTools reads the tables; HarfBuzz is the thing that lays out text with
 * them, and it is the only witness that settles what a pair really kerns by.
 * The rules that decide -- which subtable answers first, whether two lookups
 * add up or override -- are exactly the kind that can be read confidently off
 * the specification and still be got wrong, so they are asked of the
 * implementation the whole world uses instead.
 */
const SHAPE = String.raw`
import json, sys
import uharfbuzz as hb

path, pairs = sys.argv[1], json.loads(sys.argv[2])
font = hb.Font(hb.Face(open(path, "rb").read()))

def advance(text, kern):
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": kern})
    return buf.glyph_positions[0].x_advance

print(json.dumps({p: advance(p, True) - advance(p, False) for p in pairs}))
`;

/**
 * A font with one of its tables replaced, so a writer can be held up on its own.
 *
 * The alternative is to build a whole font around every table under test, which
 * makes the test about the builder as much as about the table. This takes a
 * real font off the system, swaps in the bytes, and hands the result to
 * fontTools and to HarfBuzz -- so what is being asked about is the table.
 */
export function withTable(bytes: Uint8Array, tag: string, table: Uint8Array): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "typeforge-"));
  const fontPath = join(dir, "font.bin");
  const tablePath = join(dir, "table.bin");
  const outPath = join(dir, "out.ttf");
  writeFileSync(fontPath, bytes);
  writeFileSync(tablePath, table);

  const result = spawnSync("python3", ["-c", SPLICE, fontPath, tag, tablePath, outPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`could not splice ${tag}: ${result.stderr || result.stdout}`);
  }
  return new Uint8Array(readFileSync(outPath));
}

const SPLICE = `
import sys
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.DefaultTable import DefaultTable

source, tag, table, out = sys.argv[1:5]
font = TTFont(source)
if tag in font:
    del font[tag]
holder = DefaultTable(tag)
holder.data = open(table, "rb").read()
font[tag] = holder
font.save(out)
`;

/** The glyph order of a font, so a test can name glyphs and get their ids. */
export function glyphOrder(bytes: Uint8Array): string[] {
  const dir = mkdtempSync(join(tmpdir(), "typeforge-"));
  const fontPath = join(dir, "font.bin");
  writeFileSync(fontPath, bytes);
  const result = spawnSync("python3", ["-c", ORDER, fontPath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`could not read glyph order: ${result.stderr}`);
  return JSON.parse(result.stdout) as string[];
}

const ORDER = `
import json, sys
from fontTools.ttLib import TTFont
print(json.dumps(TTFont(sys.argv[1]).getGlyphOrder()))
`;

export function hasHarfbuzz(): boolean {
  return spawnSync("python3", ["-c", "import uharfbuzz"], { encoding: "utf8" }).status === 0;
}

/** What each pair is kerned by, as the shaper sees it. */
export function shapeKerning(bytes: Uint8Array, pairs: string[]): Record<string, number> {
  const dir = mkdtempSync(join(tmpdir(), "typeforge-"));
  const fontPath = join(dir, "font.bin");
  writeFileSync(fontPath, bytes);

  const result = spawnSync("python3", ["-c", SHAPE, fontPath, JSON.stringify(pairs)], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`HarfBuzz shaping failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as Record<string, number>;
}

/**
 * The glyph names a shaper produces for a word, in order.
 *
 * For the contextual alternates. fontTools says whether the bytes decompile
 * into the rules that were meant; only a shaper says whether those rules fire
 * on real text, which is a different question and the one that matters. Every
 * feature the shaper applies by default is applied, exactly as a line of type
 * would get it.
 */
export function shapeWords(bytes: Uint8Array, words: string[]): Record<string, string[]> {
  const dir = mkdtempSync(join(tmpdir(), "typeforge-"));
  const fontPath = join(dir, "font.bin");
  writeFileSync(fontPath, bytes);

  const result = spawnSync("python3", ["-c", SHAPE_WORDS, fontPath, JSON.stringify(words)], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`HarfBuzz shaping failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as Record<string, string[]>;
}

const SHAPE_WORDS = `
import json, sys
import uharfbuzz as hb

blob = hb.Blob.from_file_path(sys.argv[1])
font = hb.Font(hb.Face(blob))
out = {}
for word in json.loads(sys.argv[2]):
    buf = hb.Buffer()
    buf.add_str(word)
    buf.guess_segment_properties()
    hb.shape(font, buf)
    out[word] = [font.glyph_to_string(info.codepoint) for info in buf.glyph_infos]
print(json.dumps(out))
`;

/**
 * What a varying font says about itself, and what it draws when asked.
 *
 * Separate from the report above because it asks fontTools to do something
 * rather than to read something: instancing a variable font at a position
 * exercises every part of the movement -- the regions, the deltas, the
 * packing -- and produces outlines that can be held up against the separate
 * files the same drawings make. Nothing short of that catches a region that is
 * written to the file perfectly and means the wrong thing.
 */
export interface VariableReport {
  axes: Array<{ tag: string; name: string; min: number; default: number; max: number }>;
  instances: Array<{ name: string; at: Record<string, number> }>;
  statAxes: string[];
  /** How many glyphs carry any movement at all. */
  movingGlyphs: number;
  recompiles: boolean;
  /**
   * How much ink each named glyph holds, at each position asked for.
   *
   * Ink rather than width, because a width says only how far a letter reaches
   * and two quite different letters reach the same distance. Signed area
   * measured by fontTools' own pen answers the question actually being asked:
   * is this the same drawing as the one in the separate file?
   */
  inkAt: Record<string, Record<string, number>>;
  error?: string;
}

const INSTANCE = String.raw`
import json, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
import io

path, glyphs, wants = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])
out = {"axes": [], "instances": [], "statAxes": [], "movingGlyphs": 0,
       "recompiles": False, "inkAt": {}}
try:
    f = TTFont(path)
    names = f["name"]
    for a in f["fvar"].axes:
        out["axes"].append({"tag": a.axisTag, "name": names.getDebugName(a.axisNameID) or "",
                            "min": a.minValue, "default": a.defaultValue, "max": a.maxValue})
    for i in f["fvar"].instances:
        out["instances"].append({"name": names.getDebugName(i.subfamilyNameID) or "",
                                 "at": i.coordinates})
    out["statAxes"] = [a.AxisTag for a in f["STAT"].table.DesignAxisRecord.Axis]
    out["movingGlyphs"] = sum(1 for v in f["gvar"].variations.values() if v)
    buffer = io.BytesIO()
    f.save(buffer)
    out["recompiles"] = len(buffer.getvalue()) > 0

    from fontTools.pens.areaPen import AreaPen
    for want in wants:
        v = TTFont(path)
        instantiateVariableFont(v, want, inplace=True)
        drawings = v.getGlyphSet()
        key = ",".join(f"{k}={v2}" for k, v2 in sorted(want.items()))
        out["inkAt"][key] = {}
        for name in glyphs:
            area = AreaPen(drawings)
            drawings[name].draw(area)
            out["inkAt"][key][name] = area.value
except Exception as error:
    out["error"] = f"{type(error).__name__}: {error}"
print(json.dumps(out))
`;

export function inspectVariable(
  bytes: Uint8Array,
  glyphs: string[],
  positions: Array<Record<string, number>>,
): VariableReport {
  const dir = mkdtempSync(join(tmpdir(), "typeforge-"));
  const fontPath = join(dir, "font.bin");
  writeFileSync(fontPath, bytes);
  const result = spawnSync(
    "python3",
    ["-c", INSTANCE, fontPath, JSON.stringify(glyphs), JSON.stringify(positions)],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`fontTools instancing failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as VariableReport;
}

export function inspectFont(bytes: Uint8Array): FontToolsReport {
  const dir = mkdtempSync(join(tmpdir(), "typeforge-"));
  const fontPath = join(dir, "font.bin");
  writeFileSync(fontPath, bytes);

  const result = spawnSync("python3", ["-c", INSPECT, fontPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`fontTools inspection failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as FontToolsReport;
}
