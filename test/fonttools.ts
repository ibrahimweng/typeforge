/**
 * Validation through fontTools.
 *
 * Our own reader agreeing with our own writer proves very little. fontTools is
 * the reference implementation the type industry uses, so exports are checked
 * by handing them to it and asking what it sees. Where fontTools is not
 * installed the tests that use it skip.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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
  /** The Windows clipping boundary, and the real extent of the outlines. */
  winAscent: number;
  winDescent: number;
  yMax: number;
  yMin: number;
  error?: string;
}

const INSPECT = String.raw`
import json, sys
from fontTools.ttLib import TTFont

path = sys.argv[1]
out = {"outlineFormat": "unknown", "tables": [], "numGlyphs": 0, "unitsPerEm": 0,
       "kernPairs": {}, "gposKernPairs": {}, "recompiles": False,
       "interiorExtremes": 0, "compositeGlyphs": 0, "componentsOf": {},
       "winAscent": 0, "winDescent": 0,
       "yMax": 0, "yMin": 0}
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
    if "OS/2" in f:
        out["winAscent"] = f["OS/2"].usWinAscent
        out["winDescent"] = f["OS/2"].usWinDescent

    if "kern" in f:
        for st in f["kern"].kernTables:
            for (l, r), v in st.kernTable.items():
                out["kernPairs"]["%s,%s" % (l, r)] = v

    # Subtables are tried in order and the first one covering a pair wins, so
    # record with setdefault to mirror how a shaper resolves the value.
    if "GPOS" in f:
        gpos = f["GPOS"].table
        for lookup in (gpos.LookupList.Lookup if gpos.LookupList else []):
            if lookup.LookupType != 2:
                continue
            for sub in lookup.SubTable:
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
    if "glyf" in f:
        glyf = f["glyf"]
        for name in f.getGlyphOrder():
            if glyf[name].isComposite():
                out["compositeGlyphs"] += 1
                if name in ("aacute", "agrave", "ccedilla", "Odieresis"):
                    out["componentsOf"][name] = [c.glyphName for c in glyf[name].components]
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
