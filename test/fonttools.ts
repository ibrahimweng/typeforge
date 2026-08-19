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
  sfntVersion: string;
  tables: string[];
  numGlyphs: number;
  unitsPerEm: number;
  kernPairs: Record<string, number>;
  gposKernPairs: Record<string, number>;
  /** True when fontTools could recompile the font, which exercises every table it parsed. */
  recompiles: boolean;
  error?: string;
}

const INSPECT = String.raw`
import json, sys
from fontTools.ttLib import TTFont

path = sys.argv[1]
out = {"sfntVersion": "", "tables": [], "numGlyphs": 0, "unitsPerEm": 0,
       "kernPairs": {}, "gposKernPairs": {}, "recompiles": False}
try:
    f = TTFont(path)
    out["sfntVersion"] = f.sfntVersion
    out["tables"] = sorted(t for t in f.keys() if t != "GlyphOrder")
    out["numGlyphs"] = f["maxp"].numGlyphs
    out["unitsPerEm"] = f["head"].unitsPerEm

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
