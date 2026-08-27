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

# The two ends of a word are the other way round: they are the same letter with
# one half of its join left off, so they have to be narrower than it. One that
# came out the same width would be one that kept the stroke it is there to drop.
edges = [n for n in order if n.endswith(".begin") or n.endswith(".end")]
hollow = [n for n in edges if glyf[n].numberOfContours == 0]
print("word ends with no outline:", hollow if hollow else "none")
# Asked of the lowercase only. A capital joins on one side, so dropping that
# side leaves it with no join at all and it goes back to being spaced by its
# sidebearings like every letter on every other face -- which for a sheared H or
# X is wider than the joined drawing, not narrower. The lowercase keeps a join
# either way, so for those the question is a fair one.
lower = [n for n in edges if n[0].islower()]
wide = [n for n in lower if widths[n][0] >= widths[n.split(".")[0]][0]]
print("lowercase word ends no narrower than the letter:", wide if wide else "none")
