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

# The two required runs, which the format stores separately from the input
# and which backtrack stores in reverse. A wrong order here still parses.
def runs(st):
    back = [sorted(c.glyphs) for c in getattr(st, "BacktrackCoverage", [])]
    ahead = [sorted(c.glyphs) for c in getattr(st, "LookAheadCoverage", [])]
    return back, ahead

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
            back, ahead = runs(sub)
            short = lambda runs_: [(len(r), r[0], r[-1]) for r in runs_]
            print(
                "lookup", i,
                "chain: before", short(back),
                "input", short([sorted(c.glyphs) for c in sub.InputCoverage]),
                "after", short(ahead),
            )
            print("        records:", [(r.SequenceIndex, r.LookupListIndex) for r in sub.SubstLookupRecord])

# And that the alternates are real glyphs with real outlines, not empty boxes
# the table happens to name.
glyf = font["glyf"]
empty = [n for n in alts if glyf[n].numberOfContours == 0]
print("alternates with no outline:", empty if empty else "none")
widths = font["hmtx"].metrics
off = [n for n in alts if widths[n][0] != widths[n.split(".")[0]][0]]
print("alternates whose advance differs from the letter:", off if off else "none")

# The boundary drawings are the other way round: they are the same letter with a
# half of its join left off, so they have to be narrower than it. One that came
# out the same width would be one that kept the stroke it is there to drop.
edges = [n for n in order if n.split(".")[-1] in ("begin", "end", "alone")]
hollow = [n for n in edges if glyf[n].numberOfContours == 0]
print("boundary drawings with no outline:", hollow if hollow else "none")
# Capitals included. They used to be asked separately, because dropping the one
# side a capital joins on left it with no join at all and it fell through to
# plain roman spacing -- which for a sheared H or X came out *wider* than the
# joined drawing. They are spaced by the join layer now like everything else, so
# the same question is a fair one for all of them.
wide = [n for n in edges if widths[n][0] >= widths[n.split(".")[0]][0]]
print("boundary drawings no narrower than the letter:", wide if wide else "none")
# And a letter standing as a word of its own gave up exactly what the two
# half-drawings gave up between them, which only holds while all three are
# spaced by the same layer.
lone = [n for n in order if n.endswith(".alone")]
def base(n):
    return n.split(".")[0]
# Within a unit: these are four advances each rounded to a whole unit on the way
# into the file, and three roundings do not compose. The engine's own arithmetic
# is exact and the unit tests hold it to that.
off = [n for n in lone
       if abs(widths[n][0] - (widths[base(n) + ".begin"][0] + widths[base(n) + ".end"][0]
                              - widths[base(n)][0])) > 1]
print("one-letter words not the sum of the two ends:", off if off else "none")
