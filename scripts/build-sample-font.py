"""
Build the sample font that ships with Typeforge.

The tool does nothing until a font is open, which makes the first thirty
seconds a search of your disk for a .ttf rather than a look at what this is.
So one is bundled.

It is a subset of DejaVu Sans, whose licence allows modification and
redistribution provided the result is renamed away from "Bitstream" and "Vera"
and carries the notice; both are done below and the notice is kept beside the
font in LICENSE-sample-font.txt. Only the characters a first look needs are
kept, which is what takes it from 757KB to something worth shipping.

Run from the repository root:

    python3 scripts/build-sample-font.py [path/to/DejaVuSans.ttf]
"""

import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

SOURCES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
]

FAMILY = "Typeforge Sample"
STYLE = "Regular"
OUT = Path("src/assets/typeforge-sample.ttf")

# Printable ASCII, then the accented letters and the loose accents that give the
# component and anchor views something real to work on.
CHARACTERS = (
    [chr(code) for code in range(0x20, 0x7F)]
    + [chr(code) for code in range(0xC0, 0x100)]
    + list(" ¨´¸ˆ˚˜–—‘’“”•")
)


def main() -> int:
    source = sys.argv[1] if len(sys.argv) > 1 else next(
        (path for path in SOURCES if Path(path).exists()), None
    )
    if not source or not Path(source).exists():
        print("DejaVuSans.ttf not found; pass its path as an argument", file=sys.stderr)
        return 1

    font = TTFont(source)
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True
    # Keep the glyph names. Subsetting drops them by default, renaming every
    # glyph to glyph37 and writing a post table with no names in it -- which
    # leaves Typeforge unable to find n, o, H or O, so the control letters read
    # "0 of 7" and the feature the sample exists to show off does nothing at
    # all.
    options.glyph_names = True
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text="".join(CHARACTERS))
    subsetter.subset(font)

    # Renamed as the licence requires, and so the file says what it is when it
    # turns up in someone's font menu.
    names = {
        1: FAMILY,
        2: STYLE,
        3: f"{FAMILY} {STYLE}",
        4: f"{FAMILY} {STYLE}",
        6: FAMILY.replace(" ", "") + "-" + STYLE,
        16: FAMILY,
        17: STYLE,
    }
    for record in font["name"].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(
                "utf-16-be" if record.platformID == 3 else "ascii"
            )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(OUT)
    print(f"{OUT}: {OUT.stat().st_size / 1024:.0f}KB, {font['maxp'].numGlyphs} glyphs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
