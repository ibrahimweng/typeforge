"""
Read the contextual alternates back out of an exported font.

Opens the file with fontTools, recompiles it -- which exercises every table it
parsed, so a table that only looks right fails here -- and prints the GSUB rules
as the reference implementation sees them.
"""

import io
import sys

from fontTools.ttLib import TTFont

font = TTFont(sys.argv[1])

# Recompile before reading, so a table that decompiles but will not compile
# again is caught here rather than by whatever opens the font next.
buf = io.BytesIO()
font.save(buf)
buf.seek(0)
font = TTFont(buf)

order = font.getGlyphOrder()
alts = [n for n in order if n.endswith(".init") or n.endswith(".medi")]
print("glyphs:", len(order), " alternates:", len(alts))
print("sample alternates:", alts[:6], "..." if len(alts) > 6 else "")

if "GSUB" not in font:
    print("no GSUB")
    sys.exit(0)

g = font["GSUB"].table
print("scripts:", [r.ScriptTag for r in g.ScriptList.ScriptRecord])
print("features:", [r.FeatureTag for r in g.FeatureList.FeatureRecord])
for i, lk in enumerate(g.LookupList.Lookup):
    for sub in lk.SubTable:
        if lk.LookupType == 1:
            pairs = sorted(sub.mapping.items())
            print("lookup", i, "single:", len(pairs), "e.g.", pairs[:3])
        elif lk.LookupType == 6:
            print("lookup", i, "chain input:", [sorted(c.glyphs) for c in sub.InputCoverage])
            print("        records:", [(r.SequenceIndex, r.LookupListIndex) for r in sub.SubstLookupRecord])

# And that the alternates are real glyphs with real outlines, not empty boxes
# the table happens to name.
glyf = font["glyf"]
empty = [n for n in alts if glyf[n].numberOfContours == 0]
print("alternates with no outline:", empty if empty else "none")
widths = font["hmtx"].metrics
off = [n for n in alts if widths[n][0] != widths[n.split(".")[0]][0]]
print("alternates whose advance differs from the letter:", off if off else "none")
