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

**Draw** is the other half of the application, and needs no font to start from.
A letter is a skeleton — where its strokes run — swept by a pen, so weight is an
input to the drawing rather than a shove applied to a finished outline: ask for
a heavier cut and the letter is drawn again, thicker. It cannot fold, because
nothing moved.

It draws Latin-1, the whole of Latin Extended-A, the whole of Greek and the
whole of Cyrillic: four hundred and fifty-two glyphs carrying five hundred and
one characters — the letters, the figures, the accented forms, and the symbols:
the ampersand, the at sign, the currency marks, the brackets and braces, the
arithmetic, the fractions. That is Polish, Czech, Slovak, Hungarian, Turkish,
Latvian, Lithuanian, Romanian, Croatian, Maltese, Welsh, Esperanto, Māori,
French, Catalan, Dutch, Northern Sámi, Greek, Russian, Ukrainian, Serbian and
Bulgarian as well as the western European languages Latin-1 stops at, and there
is a test that sets a sentence of each and fails on a missing letter rather than
on a missing codepoint.

Fifty glyphs answer to more characters than one, because a Greek capital alpha
is a Latin A and a Cyrillic er is a p — the same shape, from the same hand, with
the same history — and every text face draws those once and points both
characters at them. Only where the shapes really are the same: a Cyrillic `И` is
an N drawn the other way round and a Greek `ν` is not a `v` however much it
looks like one, so both are drawn. And most of Cyrillic's lowercase is its
capitals at the x-height — a `н` is an `Н`, a `т` is a `Т` — so each of those
shapes is written once against a height and asked for twice.

All of it comes from the same pen and the same proportions, so one edit reaches
all of it — and most of it is not a separate drawing at all. A cent is the c of
this font with a bar through it, an ordinal is its a set small, an upside-down
question mark is the question mark turned over, a ½ is the figures it is made of
— and every one of the two hundred accented letters is its own base wearing its
own mark, read off Unicode's decomposition rather than listed anywhere. So
changing the a changes the ordinal and the á and the ą and the ā, and there is
no second copy anywhere to fall behind.

And it draws a **family**, not a font. Pick any of the nine weights and each is
worked out from the one on screen: the stem in proportion to the number, the
counters giving back four fifths of what the stems gain, the round letters
widening with the flat ones, and the spacing left exactly where it was. Those
are not invented figures — six families that ship with most Linux machines were
measured for them, and `src/forge/family.test.ts` measures them again. The
specimen shows every weight at once, because nine weights described in a dialog
are a promise and nine lines one under another are the thing itself; and the
warnings strip names any weight whose counters have closed before the files are
written.

Which weight the drawing *is* is asked rather than assumed, because half the
faces here are not a Regular: a stem a third of the x-height is somebody's Bold,
and called a Regular and given a Bold of its own it is asked for a weight that
cannot exist. The tool reads it off the stem when you start and lets you correct
it.

## Joining

A script is not a slanted sans. Every other face draws a letter and leaves a gap
either side of it; a joined one draws the gap as well, because the stroke that
finishes one letter and the stroke that begins the next are the same stroke and
the boundary between two glyphs falls in the middle of it. That is the whole
difference, and no amount of weight or slant produces it.

How the letters reach each other is eleven controls in the **Joining** panel,
and every one of them was a number buried in a face until it was a control. The
seam is the height two letters hand over at, and it has to be one height,
because two letters can only meet in one place. The reach is how far the join
runs sideways, which is the letter-spacing as well as the shape of the join —
on a joined face those are not two things. How that reach divides between the
lead-in and the lead-out is separate again, because a written hand arrives at a
letter late and leaves it long. The loops are what a hand does at the top of an
ascender rather than what a compass does, and how far back down its own stroke
the eye reaches is what separates a round bead from a copperplate blade.

The unsteadiness splits into bounce and lean, and they split because real hands
split them. Measured across two variable script faces: one bounces by a
thirtieth of its x-height at a dead steady thirteen degrees, and the other sits
on exactly its line and leans sixteen. One control asked for both cannot draw
either.

The **Roundhand** is the face built to be moved rather than to be one hand, and
it starts between those two on every axis that separates them. `likeness.ts`
holds what each of them measures and the settings that travel there, and

```bash
npx vite-node scripts/likeness.ts
```

draws the face, measures it with the same ruler the references were measured
with, and prints the difference. Every figure it reports is taken off the drawn
outlines rather than read back out of the settings that produced them, which is
the only way the two can be caught disagreeing — a face that declares an
ascender of 720 draws an `l` that stops somewhere else, because the pen standing
above the skeleton is part of the letter.

What parameters reach is a likeness and not a replica. The proportions, the
rhythm, the weight and the way the letters hand over all travel; the letterforms
underneath stay this engine's own, because a skeleton swept by a pen does not
arrive at outlines somebody drew freehand, at any setting.

## Trace

The third half of the application, and a second engine rather than a mode of
the first. Draw builds letters from a skeleton of straight runs and circular
arcs swept by a fixed pen, which is what makes weight an input rather than a
distortion and why a drawn letter cannot fold at any setting. It is also why it
cannot arrive at somebody else's letterforms: it describes a whole typeface in
forty-six numbers, and a reference script spends twenty-seven thousand.

So `src/quill/` gives the skeleton two things Draw withholds. A spine segment
may be a **cubic**, so curvature varies along a stroke. A stroke carries a
**width profile**, so it swells and tapers along its length — which is what a
nib cannot fake, because a nib is wide across one axis and narrow across the
other and its thicks and thins follow the *heading* of the stroke. Pressure
follows the hand, and a straight downstroke that thickens in its middle is the
shape that proves the difference.

Both are optional and the trade is made per stroke. Lines and arcs at one width
are offset in closed form and say `exact`; reach for a cubic or a varying width
and the offset is fitted, and the stroke reports the deviation it actually
achieved rather than the one it was asked for. The panel says which you have.

**Reading a font in** recovers the strokes that drew each letter: fill it,
measure how far every inside pixel is from the edge, thin that to a line one
pixel wide, break it at its junctions, splice back the arms that plainly carry
on into each other, and fit cubics to what is left. The width comes off the
distance field, which is the same measurement as the stroke's half-width.

```bash
FONT=/path/to/font.ttf npx vite-node scripts/trace.ts
```

prints how far the redrawing strays from what it read, letter by letter. On a
connected script it comes back within about two units on a thousand-unit em,
and — which matters as much — as the handful of strokes a hand would have used
rather than the hundreds a junction-by-junction cut produces.

Then seven controls reach every letter at once: weight, pressure, taper, slant,
nib contrast, nib angle and tracking. The strokes underneath are never touched,
so any of it goes back with one press.

Two honest limits. A junction is one point in the ink and two strokes in the
hand, and nothing in the ink says which two — so some letters come back in more
pieces than a designer would have drawn, and joining those is a hand
correction. And what this reaches is a few units, not a byte-identical copy;
those are different claims and only the smaller one is being made.

Point it only at a font you have the right to derive from. Recovering the
strokes of a typeface and redrawing them makes a derivative work of it, whatever
the representation in between.

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
A drawn family comes out as one zip of one font per weight, named and numbered
so a font menu groups them under a single name — which takes more than sharing a
name string. The old name IDs 1 and 2 hold four styles between them and no more,
so anything outside Regular, Bold, Italic and Bold Italic says its real name in
IDs 16 and 17, carries its own `usWeightClass`, and leaves the bold bit to the
one face that is actually the Bold.

**TrueType** writes `glyf` outlines directly. **OpenType** re-encodes the curves
as PostScript, which is always a rebuild.

**Variable** writes the whole family into one file with a weight slider from one
end of it to the other, and it works here for a reason that has nothing to do
with the file format: every weight is the same skeleton swept with a wider pen,
so the same strokes are drawn in the same order at every weight and the movement
between two of them is a list of points that moved. Drawn by hand, that
correspondence is what a designer spends the time on.

It took two things the drawing engine was not doing. Nothing is fused: a union
re-points an outline, and where a letter's strokes meet differently as the pen
widens the fused outlines stop matching — 187 of a Sans's 196 letters line up as
drawn and 125 once fused — so the strokes are left overlapping and the file says
so, which is what the overlap flag in `glyf` is for and what every variable font
does. And a bowl now keeps the runs between its corners even where the corners
have taken all the length out of them, because the number of nodes in a letter
follows the number of pieces in its spine: a bowl exactly as wide as it is tall
is a circle and has none of them, so an o was coming out seven nodes at a Thin,
four at a Regular and six at a Bold for a shape that is the same shape all the
way along.

Eleven glyphs still follow the axis only part of the way, and a glyph that
cannot follow it is set at the weight of the nearest master it agrees with —
which is not a nicety about shape. A `G` that agrees with no master is a Regular
`G` in a Black word. Thirty-three of them were, and twenty-two came off the list
when a bowl run started carrying the pieces it does not reach; what is left is
nine letters drawn differently rather than counted differently, an `M` whose
vertex crosses the miter limit and a `yen` with two bars at a hairline among
them. The export names them rather than counting them, because six per cent at
the end of the axis and three hundred are not the same thing.

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

The drawn letters have a sheet of their own, because a test can say a glyph is
*built* like one — no stroke crossing itself, nothing off the line, the figures
all one width — and nothing but an eye can say it looks like an ampersand:

```bash
npx vite-node scripts/sheet.ts ampersand at percent
SHEET_BASES=Sans,Display CELL=120 npx vite-node scripts/sheet.ts braceleft
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
  variable.ts   fvar, gvar and STAT: one file, every weight
  composite.ts  letters built from other letters
  accents.ts    recipes from Unicode, anchors, and building
  validate.ts   the checks behind the Checks view
  outline.ts    extremes, winding direction, crossings
  overlap.ts    merging overlapping contours
  transform.ts  the parametric layer
  geometry.ts   vector and bezier maths
  zip.ts        several files as one download
src/state/    document state, undo and redo
src/forge/    the skeleton-and-pen engine behind Draw
  letters.ts    where the strokes of every character run
  style.ts      the pen, the proportions and the named parts
  sweep.ts      the pen carried along a spine
  accents.ts    the accented letters, from Unicode's own decomposition
  family.ts     the nine weights, and what changes between them
  deliver.ts    every weight drawn and written out as one download
  shapes.ts     bowls, bends and the runs a letter is described with
  script.ts     the joining: the seam, the reach, the loops and the bounce
  likeness.ts   what two reference faces measure, and the way to each
src/quill/    the stroke engine behind Trace
  types.ts      spines, width profiles, strokes
  sweep.ts      a centre-line into ink, at a width that varies
  fit.ts        a drawn letter read back as strokes
  raster.ts     fill, distance transform, thinning
  controls.ts   the hand: weight, pressure, taper, slant, nib
src/assemble/ the pile of drawings behind Assemble
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
