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

**Parameters** reshape the whole typeface at once: corner radius, weight, middle
space, width, slant, x-height and tracking. Any glyph can override any of them.

## Parameters are not destructive

Parameters sit on top of the drawn outlines and are re-evaluated on every render
and every export. The curves on disk are never modified, so a value set an hour
ago is still a live control rather than damage that has to be undone. A glyph's
own value wins over the family value, which is what lets you round an entire
typeface and then tell one letter to stay sharp.

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
  transform.ts  the parametric layer
  geometry.ts   vector and bezier maths
src/state/    document state, undo and redo
src/views/    font, glyph, kerning and spacing views
src/anim/     motion, built on anime.js
src/ui/       the Toolcraft component kit, see NOTICE.md
```

`src/font/` has no dependency on React and can be used on its own.

## Licensing

The interface components in `src/ui/` come from Toolcraft and carry the
Toolcraft Designer License, which does not permit selling this application as a
product. Everything in `src/font/` is original work. See `NOTICE.md`.

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
