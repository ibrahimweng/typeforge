"""
Shape a few words with HarfBuzz and print the glyphs that come out.

The last thing worth checking about a GSUB table. fontTools says the bytes
decompile into the rules that were meant; only a shaper says whether those
rules fire on real text, in the order a line of type is actually laid out.
"""

import sys

import uharfbuzz as hb

blob = hb.Blob.from_file_path(sys.argv[1])
face = hb.Face(blob)
font = hb.Font(face)

for word in sys.argv[2].split(","):
    buf = hb.Buffer()
    buf.add_str(word)
    buf.guess_segment_properties()
    hb.shape(font, buf)
    got = [font.glyph_to_string(info.codepoint) for info in buf.glyph_infos]
    print(f"{word:>6} -> {' '.join(got)}")

