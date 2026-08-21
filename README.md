# Typeforge

A font editor that runs in the browser. Open a typeface, reshape it, and export
a real TrueType or OpenType file with its kerning and spacing intact.

```bash
npm install
npm run dev
```

Then drop a `.ttf`, `.otf`, `.woff` or `.woff2` file anywhere in the window.

## What it does

**Font view** shows every glyph in the typeface. Search by typing the letter
itself, part of a glyph name, or a codepoint such as `U+0041`. Only the rows on
screen are drawn, so a font with thousands of glyphs stays responsive.

**Glyph view** is direct outline editing. Drag bezier nodes and their handles,
add points with the pen tool, delete them, and nudge a selection with the arrow
keys. Smooth nodes keep their handles in line, so a curve stays smooth while you
reshape it. The metric lines a designer works against are always visible.

**Kerning** is judged in the preview text rather than in a table. Click the gap
between two letters and drag to tighten or open it; the line reflows as you go.
Alongside individual pairs there are kerning classes, where one entry covers
every glyph on its left against every glyph on its right. An individual pair
overrides the class it falls under, and the editor labels a value that came from
a class so the two are never confused.

**Spacing** is a table of sidebearings and advance widths, with a preview strip
above showing the letters in their real rhythm. Sidebearings are measured from
the outline, so they follow any parameter changes.

**Build** is where a letter is put together from parts. `á` is not a drawing,
it is `a` with `acute` above it, and the panel says how many glyphs are built
from the letter you are looking at, so you know what an edit will reach. Anchors
mark where a mark attaches: a letter carries `top`, a mark carries `_top`, and
lining them up is what places the accent. Drag them in the editor.

Which letter is made of which parts comes from Unicode's own decomposition
rather than a list to maintain, so building covers Latin, Greek, Cyrillic and
Vietnamese alike. Where an accent sits comes from the font itself: every
composite it already carries is one observation of the offset between a letter
and its mark, so anchors can be read back out of a font you import. Building
never disturbs what is already there.

**Parameters** reshape the whole typeface at once: corner radius, weight, middle
space, width, slant, x-height and tracking. Any glyph can override any of them.

## Finding your way around

There is a sample font in the toolbar's empty state, so the tool can be tried
without going and finding a `.ttf` first. It is a subset of DejaVu Sans, renamed
as that font's licence requires, and it keeps its glyph names — which matters,
because the control letters are found by name, and a subset that has dropped
them leaves the feature the sample exists to demonstrate reading "0 of 7".

Help sits in a drawer behind the toolbar's **Help** button rather than on a page
of its own, because most of what needs explaining is a control and a control is
easier to understand while you can still see it move. Its parameter section is
generated from the same list the inspector draws its sliders from, so it cannot
come to describe a control that is no longer there.

The rest is one-line tips, shown the first time you arrive somewhere and then
never again. Only one shows at a time — opening a font for the first time
mounts three, and three tinted boxes arriving together is clutter rather than
help. Dismissals are remembered in `localStorage`, and the help drawer brings
them all back.

## Parameters are not destructive

Parameters sit on top of the drawn outlines and are re-evaluated on every render
and every export. The curves on disk are never modified, so a value set an hour
ago is still a live control rather than damage that has to be undone. A glyph's
own value wins over the family value, which is what lets you round an entire
typeface and then tell one letter to stay sharp.

## Keeping your work

**Save** writes a `.typeforge` file: the session as it stands, in every half of
the application at once. It is a description rather than a picture — the drawn
half is its style and the handful of letters told to differ from it, and an
imported font is the file you opened plus the glyphs you have actually touched.
That last one is why it is a format and not a dump of the application: a font is
six thousand glyphs, and writing all of them out to record that you moved two
would be fifty megabytes describing fifty bytes of work.

**Open** takes one back. It is the same button that opens a font, and the same
drop target: what arrives is identified from its own first bytes rather than
from its name, so it does not matter which of the two you are bringing in or
what the browser called it on the way down. Opening a project puts back only the
halves the file actually holds, so a drawing does not wipe a font you had open
beside it.

Alongside that, the session is written down as you go — into IndexedDB, a second
after you stop moving, and again when the tab is hidden. Closing the browser and
coming back lands you where you left off, in the half you were in, with nothing
to have remembered to do. If this browser will not keep anything — a private
window, storage switched off — the toolbar says so where you can see it rather
than letting you find out afterwards.

Exporting is a different thing again, and the buttons are separate for a reason:
a font is for other people to use and cannot be opened back up into the work
that made it.

## Export

Two formats, and a choice about how much of the original font to carry forward.

**TrueType** writes `glyf` outlines directly. **OpenType** re-encodes the curves
as PostScript, which is always a rebuild.

**Everything from the original** keeps every table this editor does not model,
so ligatures, contextual alternates, colour layers and hinting survive. Glyphs
you never touched are copied across byte for byte, which is what keeps their
hinting instructions intact.

**Only what this editor manages** writes a font from the outlines, spacing,
kerning and names. Smaller and entirely predictable, at the cost of dropping
those features.

### Letters are stored once

An accented letter is written to the file as a reference to its parts, not as a
copy of them. Correcting the `a` corrects every accented form of it, in the file
as well as in the editor. A parameter that reshapes letters forces flattening,
because it applies to the assembled letter rather than to the parts, and a
reference would leave the accent behind.

### Why the kerning tables are written by hand

Neither font library available will write kerning back out. Importing DejaVu
Sans and re-exporting it through either one drops all 2,727 of its pairs, and
opentype.js additionally rewrites TrueType outlines as PostScript whether you
asked for that or not.

So Typeforge owns the sfnt container. It writes both a legacy `kern` table and a
real `GPOS` table, and copies untouched tables through unchanged. `GPOS` carries
class kerning as well as individual pairs, with the pairs listed first so a
single awkward pair can override the class it belongs to.

## Tests

```bash
npm test
```

Exports are checked against **fontTools**, the reference implementation used
across the type industry, rather than against this project's own reader. The
tests import a real font, edit it, export it, and confirm that fontTools can
recompile the result and reads back the kerning, outlines and metrics that were
intended. Install it with `pip install fonttools`; the tests that need it skip
when it is absent, as do the tests that need a system font to read.

## Layout

```
src/font/     the font engine, independent of the interface
  sfnt.ts       the container: table directory, checksums
  parse.ts      import
  export.ts     export, both formats and both fidelity modes
  glyf.ts       TrueType outline tables
  tables.ts     head, hhea, maxp, hmtx, cmap, name, post, OS/2
  kern.ts       kern and GPOS writers
  quadratic.ts  cubic and quadratic conversion
  composite.ts  letters built from other letters
  accents.ts    recipes from Unicode, anchors, and building
  validate.ts   the checks behind the Checks view
  outline.ts    extremes, winding direction, crossings
  overlap.ts    merging overlapping contours
  transform.ts  the parametric layer
  geometry.ts   vector and bezier maths
src/state/    document state, undo and redo
src/project/  the saved document: the file format, and keeping it in the browser
src/views/    font, glyph, kerning and spacing views
src/anim/     motion, built on anime.js
src/ui/       the Toolcraft component kit, see NOTICE.md
```

`src/font/` has no dependency on React and can be used on its own.

## Licensing

The interface components in `src/ui/` come from Toolcraft and carry the
Toolcraft Designer License, which does not permit selling this application as a
product. Everything in `src/font/` is original work. See `NOTICE.md`.

The bundled sample font is a subset of DejaVu Sans under the Bitstream Vera
licence, which permits modification and redistribution provided the result is
renamed away from "Bitstream" and "Vera" and carries the notice. Both are done;
the notice is in `LICENSE-sample-font.txt`, and `scripts/build-sample-font.py`
rebuilds the file from a local DejaVu so the derivation is reproducible rather
than a binary of unclear origin.

## Deploying

The build is a static site, so any static host will serve it. There is no
server, and nothing a font is loaded into leaves the browser.

On Vercel, importing this repository is enough: `vercel.json` sets the
framework, the build command and the output directory, so no dashboard
configuration is needed. Every path rewrites to `index.html` because the app
runs on one page, and hashed asset files are marked immutable so repeat visits
do not refetch them.

```bash
npm run build   # produces dist/
npm run preview # serves that build locally
```

## Privacy

Fonts are read and written entirely in the browser. Nothing is uploaded, and
there is no backend to upload it to. That matters when the file you are editing
is a licensed typeface.

The session kept between visits is kept in the same place — IndexedDB, in your
own browser, on your own machine. It includes the font you opened, so clearing
the site's data is all it takes to remove it, and a shared machine keeps it for
whoever uses that browser profile.
