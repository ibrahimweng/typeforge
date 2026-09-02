# What is missing

> All four are done. Two later sweeps of every screen added seven more, also done.

An audit of what this application cannot do, taken by reading its capability
surface rather than by looking at it. That distinction is the point: a tour of
the screens finds things that are drawn wrong, and finds nothing at all about
a thing that was never drawn. Every entry below was verified against the code,
and each says how.

It is written down here because the last one was not. That list lived in a
conversation, and when the conversation ended so did the list.

---

## A. The font is not yours — *done*

**A1. A font cannot be renamed, and its designer, version, copyright and
licence cannot be set.**

`store.setMeta` exists and has zero callers anywhere in the application, the
tests or the browser suite. So a font opened in Edit mode keeps the identity
of the file it came from, whatever is done to it: open DejaVu Sans, redraw
every letter, export, and the file still says DejaVu Sans, still carries
DejaVu's copyright string, still names DejaVu's designer, and still claims
DejaVu's licence.

That is worse than a missing field. It is a licensing hazard, and it is the
one the type-design rules are most insistent about — a derivative work has to
say what it is. It is also an inconsistency: Draw, Assemble and Trace all
offer a name in their export dialogs. Edit is the only one that does not.

**A2. The vertical metrics cannot be changed.**

`store.setMetrics` has zero callers too. Ascender, descender, cap height and
x-height come from the file and stay there for ever -- even though the Draw
mode has a slider for each of the four, and even though the importer now
*measures* two of them when the file declines to declare them.

## B. A letter cannot be made or unmade — *done*

**B1. A glyph cannot be added.** There is no `addGlyph` anywhere.

This makes `startBlank()` a dead end rather than a beginning: it hands back
`emptyTypeface()`, whose `glyphs` array is empty, and there is no way to put a
letter into it. The New action leads to a font that can never contain
anything.

**B2. A glyph cannot be deleted.** No `removeGlyph`.

**B3. A glyph cannot be renamed, and its codepoints cannot be changed.**
Neither `renameGlyph` nor `setUnicode` exists. A glyph's codepoints are shown
in a cell's hover text and used by the search box, and are otherwise
unreachable -- so a drawing cannot be told which character it is.

**B4. A glyph cannot be duplicated, and outlines cannot be copied between
letters.** There is no clipboard of any kind: no `copyGlyph`, no `pasteGlyph`,
nothing on the keyboard. So an `m` cannot be started from an `n`, which is how
an `m` is started.

## C. Nothing helps you draw straight — *done*

**C1. Guides are horizontal only.** The type is `Array<{ y: number }>`. There
is no vertical guide, which is the one you would use to mark a stem position
or where a sidebearing should fall.

**C2. Nothing snaps.** Dragging a node lands wherever the pointer was let go:
no pull towards a whole unit, a metric line, a guide, or another point's x or
y. Every number this application displays is displayed rounded, so a letter
drawn by dragging is off the grid in every coordinate and looks perfectly
fine until something measures it.

## D. Three smaller ones — *done*

**D1. A component cannot be placed by hand.** `removeComponent` exists;
nothing adds one except the accent builder, which runs automatically. So a
letter cannot be built out of another on purpose.

**D2. There is no freehand tool.** Deferred when the canvas tools were built.

**D3. There is no printing.** The proofing advice in the type-design rules is
about paper -- print it, look at it, put it on a wall -- and the Proof view is
screen-only.


---

## What was learned doing A and B

Two of these were worse than the audit said, and both only showed up once
something drove them.

**A1 understated it.** `setMeta` was not merely uncalled: nothing in the
application, the tests or the browser suite had ever called it. The three other
modes all offer a family name in their export dialogs, so Edit -- the mode
people spend their time in -- was the only one that could not name its own
work. The checks now warn when an edited font still wears the name it arrived
with.

**B3 hid a second fault.** The obvious half was that codepoints could not be
edited. The half that only appeared once a field existed was how to read one:
bare hex is ambiguous with the character itself, and `A` is valid hex. Somebody
typing `A` into a field labelled Character means the letter A, and read as hex
it is U+000A, a line feed -- a letter put on a different character entirely,
silently, by the input most likely to be typed. So `U+` says hex, anything else
is taken at face value, and nothing is guessed.

**And one that was not in the audit at all.** The letter panel's fields
resynced from the glyph whenever the glyph changed, with an array in the
dependency list. A store update landing mid-edit put the old name back into the
field while somebody was typing in it. Found by a browser test, not by reading.

## What C turned up

A guide survived a change of font. Guides are kept in font units, and font
units are not the same size from one font to the next -- 500 is the x-height of
a thousand-unit font and a quarter of the way up a two-thousand-unit one -- so
guides drawn against one font arrived over the next meaning something else
entirely. They are cleared with the font now.

And snapping had to be a switch rather than a modifier. The two modifiers a
drag already uses are taken: shift holds it to one axis, alt pans the canvas. A
third would have been a chord nobody would find.

## What D turned up

Placing a component by hand needed a guard nothing else in the application
needed. A letter built out of itself is a drawing with no bottom to it, and the
loop worth checking for is not the direct one -- it is `á` built from `a`, `a`
given `acute`, and `acute` then given `á`: three reasonable-looking steps, and
every renderer that meets the result either gives up or hangs. The walk that
finds it is bounded by the glyphs it has already seen rather than by a depth,
so a font that already contains a loop cannot send the check for one round it
for ever.

The pencil needed no fitter. `fitCubics` in the quill engine already turns a
run of points into cubics -- it is how a swept stroke becomes an outline -- and
writing a second one would have been two fitters to keep honest and two sets of
tolerances to argue about. What the pencil adds is the thinning in front of it:
a pointer reports every few milliseconds, and feeding a fitter three hundred
positions makes it work hard to reproduce the shake in somebody's hand.

---

# The audit is finished

Eleven items, four batches, and eight faults found while fixing them that were
not on the list: the importer falling back to half the em on any font with an
OS/2 table older than version 2, a rename that would have silently dropped
kerning, a codepoint field that would have read `A` as a line feed, a panel
that wiped what was being typed into it, guides that survived the font they
were drawn against, and three more.

Every one of those was found by building the thing rather than by reading the
code, which is the argument for writing the list down and working through it
rather than filing it.

---

# A second tour, of a font with nothing in it

The audit above works through a list. This is what a tour finds that no list
does: every view, every scope, every dialog, screenshotted and looked at. The
first tour was of a font that had been opened. This one was of a font that had
just been started, which is the state every font passes through and the one
nobody looks at.

Nine faults, all of them in that state.

**Five of the six edit views had no empty state.** The glyph editor said
"Choose a glyph in the font view", which sends somebody to the one view that
would then tell them to press New letter. Spacing, kerning, proof and checks
showed their furniture over nothing: a table of no rows under its headings, a
proof of no text, a Run button over no glyphs. `NothingDrawnYet` says the same
sentence in all five, with the way out in each of them, because a person who
has just started a font has not chosen a view -- they have arrived in whichever
one was last open.

**A new font failed its own checks.** `startBlank` handed back a typeface with
an empty glyph list, so the first thing the checks page said about a font
nobody had touched was an error: "No .notdef glyph". Every other generator here
-- quill, forge, assemble -- puts one in first, because the format requires it
in position zero. This one path did not.

Which turned `glyphs.length` into the wrong question. A new font now carries
one glyph and is still empty, so the views ask `hasLetters` instead, and
`.notdef` does not count as a letter because nobody drew it.

**The new letter was called `uni0041`.** By convention that name *means*
U+0041, so the font claimed to have an A while the glyph answered to no
character at all -- and the codepoint field's `U+0041` placeholder agreed with
it. Two lies about one glyph, either of which exports. The three New letter
buttons named it three different ways besides: the grid `uni0041`, the letter
panel a timestamp, the empty state `new`. All three now say `newGlyph`, which
asserts nothing, and the placeholder reads `A or U+0041` so it cannot be
mistaken for a value.

**The parameter rail was live on a font with no letters.** Ten sliders
describing what they do to letters -- rounds their corners, thickens their
strokes, opens the counters of o, e and a -- every one of them moving without
moving anything. The letter scope was worse: with no letter selected it fell
back to the family's values and showed them under a tab labelled Letter, so the
numbers on screen belonged to something other than what the tab said they did.

**The coach mark over the control letters said five.** There are seven, and the
panel under it says "0 of 7" in the same screenshot. Prose beside a control is
exactly the text that goes stale silently: nothing type-checks a sentence, and
nobody re-reads the copy when they add a letter to the list. There is a test on
it now, which counts them.

Three more, each a sentence: "1 glyphs" beside the search box, reachable on
every new font the moment one carried a `.notdef`; "1 other glyphs match them"
in the control-letter panel, about a glyph that matches nothing; and a
paragraph in the paths list explaining how the order and direction of paths
decide what fills, printed over a letter with no paths at all.

Every one of these was found by looking at a screenshot. None of them would
have been found by reading the code, and none of them was on any list.

---

# A third tour: Draw, Assemble and Trace

Edit has been toured twice. The other three modes had never been looked at
once. Two faults, and the first is the worst thing either tour has found.

**A font opened from the toolbar left you where you were.** Every other door
already went to the mode that now holds the work -- a UFO, a saved project, a
typeface adopted from the library all set it. A plain font was the one that did
not. So pressing Open while standing in Trace loaded the font into the editor's
document and left the screen exactly as it was: the status line reporting
`Opened -- 6,253 glyphs` above a view saying `Nothing traced yet`. Two
statements about the same action, contradicting each other in the same
screenshot, with the font itself perfectly fine and one mode away.

It is the sort of thing that is invisible from inside the code. The line that
opens a font is correct, the line that switches to Trace for a joined script is
correct, and the fault is the case neither of them covers.

**Trace named nothing.** Three of the four modes say what is open in the
toolbar -- `Untitled Regular`, `Untitled Sans`, `Untitled 0 drawings` -- and
the fourth left the space blank. The one mode whose whole subject is a font
somebody else made was the one that never said which font.

Two more things were looked at and left alone, which is worth writing down
because a tour that reports everything it noticed is a tour nobody reads twice.
Assemble's Export button is disabled with nothing to export, which is right.
And Trace's panel is mostly empty before anything is traced -- a flex column
with a pinned footer, and the one action it has sits at the top with the
explanation filling the canvas beside it. Filling that space would mean
inventing content.

# A fourth tour: the pen, driven rather than read

Two rounds of tool work were checked by reading the code and looking at the
page. This one was checked by making the gestures, and the difference is the
whole entry.

**The pen had stopped working, and the page looked fine.** Placing a point did
nothing at all: no point, no error on screen, the status line still saying
`Click to start an outline`. The cause was a cast four files away. `Drag`
gained a `pen` kind; `reportPhase` passed it to `toolStateFor` through
`drag.kind as Doing["kind"]`; `whileDoing` had no case for it, so a switch
declared to return `ToolState` ran off its end and returned `undefined`; the
store then read `.phase` of nothing and threw inside the pointer-down handler,
which killed the click before it reached the code that adds a point.

Nothing about that is visible from reading either file. The cast is what made
it possible -- it had told the compiler to stop checking in the one place
checking was the point -- and the crash was in a handler, so it never reached
an error boundary and never marked the page. The only signal was that clicking
did nothing.

**A colour that was right on one ground and wrong on the other.** The segment
under the pen is drawn with a casing so it shows where it runs along the edge
of a letter. The casing was `--background`, the chrome colour, where it meant
`--canvas`, the ground the letter sits on. Those are the same colour on the
dark ground, so it looked correct in every screenshot until somebody pressed
`On white` and got a black halo round the highlight. The light ground also had
no darkened `--inspect` or `--attention`: both are picked to carry against a
near-black panel and wash out on a near-white canvas, which is a mark you have
to hunt for.

**A simplify that made outlines heavier.** Asked for a tolerance tighter than
the drawing, `fitCubics` subdivides to reach it -- so a four-point circle asked
to stay within a hundredth of a unit came back as twenty-six points, and the
status line reported it as `-22 points out`. The negative in the message is
what gave it away; the operation had been wrong in both directions before
anybody noticed the sign.

Three faults, none of which a fifth reading would have found, and all three
were sitting in front of the first person to actually draw with the tool.

# A fifth tour: driven as a beginner, from a screenshot

The first four tours were made by somebody who knew what the code did. This one
started from a screenshot of a letter somebody else had made a mess of, and the
mess turned out to be a straight reading of the interface's own instructions.

Reproducing it took four minutes and no guessing. Take the pen, place three
points, aim at the first to close, miss by twelve pixels -- which is a normal
miss on a seven-pixel target -- and get a fourth point with no warning. Press
Escape: nothing. Press Enter: nothing. Take another tool: the half-drawn
contour stays. There was no way to stop drawing, so every attempt anybody
thought better of was permanent, and permanent things accumulate.

Two lessons worth keeping.

**A missing verb is invisible from inside the code.** Every function here was
correct. `addPoint` added a point, `closeOutline` closed an outline, `retract`
retracted. Nothing was broken; something was absent, and absence does not show
up in a file you are reading -- only in a session you are having. Four rounds of
reading this code had not found it.

**The same fix twice, in two places, is a sign the model is wrong.** The
staleness bugs in this view have now happened three times, and the tool phase
had two of them in one round: a handler bound on an earlier render calling a
closure built on an earlier render. Each was fixed locally and the next one
arrived anyway. They stopped when the position and the reporter both moved into
refs -- which is to say, when the rule became "state read inside a handler is
read from a ref" rather than "remember to add this dependency".

And one that is worth saying plainly: the fault the tour found was not in a
feature that had been rushed. The pen work of the previous round was tested,
documented, and correct. It was also unusable for its actual purpose, because
nobody had sat down and drawn a letter with it.

# A sixth tour: arriving knowing nothing

The five tours before this were made by somebody who knew what the code did.
This one was made pretending not to, with one goal: make a typeface, having
never made one.

**The front door does not offer it.** Drop a font file, open a UFO folder, try
the sample. Three doors and all three want a typeface you already have. Draw
mode makes one from nothing, has twenty families under it and a complete
alphabet before you touch a control, and the landing page has never mentioned
it — you have to find the mode switch and guess.

That is the whole finding, and it is worth more than a longer list. The rest of
the journey works: the views are there in Draw, export offers a name and weights
and a format, and a file comes out that installs. Nothing is broken. The thing
this tool is best at was simply not on the door.

The second finding is not a fault, it is an absence, and it produced the
academy: **there is no path from "I know nothing about type" to "I made a
font".** There is a reference manual, a tip per view, and a deep toolset with
about thirty live controls, and nothing that says which order to meet them in.

Worth recording alongside those: this tour began by trying to build a feature
the code told me was missing. `script.ts` said contextual joins were "the next
piece of work" and that the exporter "cannot yet write" the table; both had
stopped being true and the comment had not. One command against the existing
harness settled it in under a minute. **A comment claiming work is undone is a
liability of exactly the same kind as one claiming work is done** — and neither
survives a harness that can be run.

---

# A sweep of every screen — *three found, three fixed, and a third of it looked at*

Driven rather than read: the four modes, the six views inside Edit, the four
tool groups and their flyouts, the command palette, both drawers and the
dialogs, captured at 1440 by 900 and looked at. Everything below was on screen
and wrong.

## S1. The checks stopped a quarter of the way through the font and said "0 errors" — *done, twice*

`validate.ts` capped at five thousand glyphs to stay responsive, and the report
said "5,000 glyphs checked". On this font — six thousand two hundred and
fifty-three — that is a quarter of it never examined, under a headline of no
errors. The count reads as a fact about the font rather than a limit on the
check, and there was no way to tell the two apart.

Saying so was the first fix and it was the wrong one to stop at: a person with
a large font still could not check a quarter of it. The cap was there because
the whole check ran in one synchronous call on the thread that draws the page —
about two and a half seconds on this font, more on a bigger one — so the choice
looked like a frozen tab or a partial answer. It is neither. The glyph walk is
now done twenty-five at a time with a breath between batches, the wording
happens once at the end so a fault is still one finding rather than one per
batch, and the button counts up while it works. The whole font is checked, the
longest unbroken stretch is a hundred and twenty-four milliseconds instead of
two and a half seconds, and the total is unchanged.

Two numbers in that were guesses before they were measurements, and both were
wrong. A batch of two hundred and fifty was annotated as "about eighty
milliseconds"; it was four hundred and ten, because glyphs are nothing like
equal and one accented capital costs more than twenty-five plain ones. And the
smaller batch was assumed to cost throughput: it does not — the total is flat
from twenty-five to two hundred and fifty, so the only thing batch size buys is
the length of the freeze.

## S2. Save was lit with nothing to save — *done*

Export is guarded per mode with a paragraph of reasoning beside it: an imported
font has to have been imported, an assembled one needs drawings, a traced one
needs a font to have been read, and a drawn one is always ready. Save takes the
same four conditions and had none of them, so on the front door — no font open,
Export correctly dark — Save was lit and offered to write out an empty project.

## S3. A warning about the file went into a box ten rem wide — *done*

`importFont` returns warnings. Their only reader appended the first of them to
the status line in the top bar, which is capped and truncates: opening the test
font put `Opened — 6,253 glyphs. 2,6…` on screen. Four characters of a sentence
about somebody's font, with the rest in a tooltip nobody has a reason to hover.
They are now in Checks, where a person goes to find out what is wrong with a
font, kept apart from the findings because they are facts about the *file* —
nothing in the letters will fix one and running the checks again will not clear
one.

# Finishing that sweep — *five more, five fixed*

The sweep above captured twenty-one screens and examined seven. What follows
came from the other fourteen — all four export dialogs, the library, help, the
academy drawer, the palette, Trace's own view, three of the four tool flyouts,
and the Kerning, Spacing and Proof views — plus a nine-hundred-pixel window,
which nothing had been looked at in.

## S4. The export dialog never said what name the file would go out under — *done*

Of the four export dialogs this was the only one that did not. Draw, Assemble
and Trace all name the font on the way out. In Edit the name came from whatever
file was opened, and with "Everything from the original" chosen above it so did
the designer, the copyright and the licence — so a person could open somebody
else's font, redraw every letter and ship a file still claiming to be theirs,
without a word about it at the moment of shipping.

This is section A1 above, half-done. That entry was closed when `setMeta` gained
callers, and it did: the name *can* be changed, in a dialog a page away. It just
could not be changed, or seen, where the decision is actually taken.

## S5. A licence was a one-line box — *done*

A copyright notice and a licence are sentences, and both of DejaVu's are longer
than the field they sat in: the first stopped being visible at "Copyright (c)
2003 by Bitstream, Inc. All Rights Reserve". A field somebody cannot read is a
field they cannot check, and these two are the ones the type licences care
about.

## S6. One document's news showed over another's — *done*

"Opened — 6,253 glyphs" is about the edited font. It sat in the bar over Draw
with "Untitled Sans" named a few inches to its left: two documents in one strip,
and the louder of them not the one on screen. A status now names the half it
belongs to, and the ones that belong everywhere — a refusal to leave a borrowed
letter, say — go on showing everywhere.

## S7. Two findings only a narrow window has — *done*

At nine hundred pixels the inspector clipped its own controls: the Transform
row ran off the edge and the "Back" button read "Bac". And the context strip,
which is a label, three letter boxes and six controls before it gets to its
sentence, had "Dr…" left for the sentence. Truncation is fine while a few words
survive; at two characters it says nothing and reads as a rendering fault. The
rows wrap now, and the sentence stands down where there is no room for it —
it was already on the hover.

## S8. A dialog too tall for the window could not be scrolled — *done*

Found by breaking it, and older than the break. All four export dialogs are
flex children centred in a full-screen backdrop with no height of their own,
and a centred flex child taller than its container is clipped at *both* ends
with nothing scrollable anywhere: the overflow is above the top edge as well as
below the bottom one, and no ancestor scrolls. So the part past the fold is not
awkward to reach — it is unreachable, and a click aimed at it lands on the
backdrop, whose job is to close the dialog.

Measured, at 1280 wide. The editor's export dialog was 805 pixels tall before
any of this, so on a 600-pixel window its Download button sat at y 653–683 —
entirely off screen, with the dialog's whole purpose behind a fold that does
not move. On a 720-pixel window it sat at 713–743: seven pixels of it showing,
which was enough. Adding the name field for S4 above put another 157 pixels
over it and took those seven away, and the export test — which had passed for
months — stopped exporting. Draw's is 560, which overflows a 600-pixel window
by a little; Assemble's and Trace's could not be measured, because their Export
is dark until there is something to export, but neither had a bound either.

All four are bounded now and scroll inside themselves, and a test opens the
editor's on a 600-pixel window, scrolls to the button, exports, and scrolls
back to the field at the top.

The lesson is the one worth keeping. The fix for S4 was two inputs and a
sentence, in a dialog that plainly had room for them, and it took out the one
thing that dialog exists to do. The suite caught it; reading the diff would
not have.

## What the sweep cleared

Worth recording, because a sweep that only lists faults reads as if everything
it did not mention is unexamined. The tool flyouts open as designed and name
every tool with a sentence each; the palette, both drawers, the export dialogs
and the library open and close cleanly; the Checks list, the proof, the kerning
and spacing views and the Draw and Assemble panels all held up. Two things that
looked wrong were not: the top bar's truncation is a deliberate fix for Export
being pushed off the right-hand edge, and the tool flyout wants a second click
on a group you are already in, which is documented where it is decided.

# Trace, measured letter by letter — *two found, one fixed, four rejected*

The sweep above was of the interface. This is of the engine under Trace, and it
starts from the harness rather than from a screen: `scripts/trace.ts` reads a
font, recovers strokes from every lowercase letter, redraws them and measures
how far the redrawing strays. Two fonts, because they fail differently — DejaVu
Sans, which is straight lines and square cuts, and Dancing Script, which is
loops.

## T1. Where two strokes meet, neither filled the corner — *done*

A run is cut at every junction, so where a crossbar meets a stem both pieces end
at the same point, and both were being finished there with a square cut across
their own direction, going no further. Two rectangles meeting at an angle and
each cut off at the meeting point cover everything inside the turn twice over
and leave the wedge outside it empty. That hollow was worth **a hundred and
eight units on the `m`, seventy-three on the `t` and seventy on the `f`** — on
a two-thousand-unit em, so half a millimetre at reading size, and plainly
visible in `scripts/traceshot.ts`.

Each stroke now runs on past the junction by its own half width, held back to
wherever its full width leaves the ink. Both halves of that are needed. Without
the run-on the wedge stays empty; without the bound, a square end driven into
the acute wedge where a script's loop crosses itself hangs out either side, and
a probe with no bound at all takes the shoulder of an `n` out through the far
side of its stem, which is a defect this fitter had once already.

## T2. A `g` that came back as fourteen strokes — *done*

Dancing Script traces accurately and unusably. Its `g` was **fourteen strokes**,
of which three are the letter — eight hundred and ninety-three units, seven
hundred and eleven, two hundred and seventy-five — and eleven are debris from
the three places the letter crosses itself, none longer than forty-five units
and some three units long and two wide. The `y` was fourteen and the `j` twelve,
against one to three for every letter with no loop in it. The harness's own
header says it: a fit can be arithmetically excellent and useless, and what is
wanted is the handful a hand would have used.

Where a stroke crosses itself the four-way meeting rasterises into a knot a
pixel or two across, and thinning leaves scraps around it: two nearly identical
rails a pixel apart, a stub between two junctions, a single pixel standing
alone. Every existing test let them through, and none of those tests is wrong.
A run with a junction at both ends is not a whisker, because a whisker is a
thing with a loose end. A run that is the whole of its own scrap of skeleton is
kept because a mark standing alone is the dot of an `i` — and the dot of an `i`
is forty units across, where this is one pixel.

Two rules, both stated as facts about the raster rather than as thresholds. A
run whose widest reach is a pixel from the edge is not the medial axis of
anything, because a real axis carries a radius of at least half its stroke's
width. And a short run every point of which lies inside the pen at some point of
another run draws no ink that run does not already draw — the whisker test,
applied one point at a time.

The second needs a guard that cost a `u` four per cent of its ink before it was
found. The field balloons at a junction to take in every stroke meeting there,
so the scrap sitting on one carries a wider pen than either stroke it joins, and
the sweep draws each stroke's *profile*, which is read along the whole of that
stroke and does not keep the balloon. Dropped, nothing drew it, and the bottom
right of the `u` came back with a notch in it. A scrap is only covered if it is
no wider than the stroke covering it.

## What the two changes did, measured

| | DejaVu Sans | | Dancing Script | |
|---|---|---|---|---|
| | before | after | before | after |
| worst deviation | 108.6 | **100.6** | 38.8 | **34.0** |
| mean of means | 6.13 | 6.16 | 2.31 | **2.30** |
| nodes | 1134 | **1112** | 1995 | **1945** |
| strokes, whole alphabet | — | — | 131 | **105** |

Letter by letter, where it moved most. DejaVu: `f` 70.2 to **11.6**, `t` 73.4 to
**10.9**, `m` 108.6 to **38.5**, `d` 105.0 to **38.1**, `h` and `n` 6.04 to 5.51
mean. Dancing Script: `g` **14 strokes to 7**, `y` **14 to 9**, `j` **12 to 9**,
`d` 7 to 3, `m` 9 to 7, `f` 6 to 5.

The mean on DejaVu is three hundredths worse, which is worth saying rather than
hiding. That mean is taken over the *source outline's own sample points*, and a
straight-sided letter is flattened to its corners alone — a `v` is seven points,
all of them corners — so for half this alphabet "mean" and "max" are both
measurements of corners, and corners are what T3 below is about. The fitter is
seven per cent slower on a whole alphabet (6.81 to 7.29 seconds), the cost of
two extra ink probes at every join.

## T3. The letters whose strokes meet at a shallow angle — *found, not fixed*

`v` 18.97, `w` 15.32, `z` 14.18, `r` 12.50, `x` 10.78, against an alphabet mean
of 6.13. Two to three times everything else, and measurably all in one place:
each letter's worst point sits on a corner of its outline — the `v`'s at 0 per
cent of the way up the letter, the `z`'s and `w`'s at 100 per cent, the `r`'s at
85 — while the sharpest turn anywhere in that letter's *spine* is between 8.6
and 20.9 degrees. The redraw rounds off what the letter does square.

Four fixes were tried and all four were rejected by measurement. They are
written into `src/quill/fit.ts` beside the code so the next person does not
spend the afternoon again, and the shortest of them is the most useful: reading
the outline's own corners and bending the spine to a vertex at each is right in
principle and wrong in fact, because **DejaVu's `v` has no apex**. It has a
two-hundred-and-fifty-unit flat foot between two hundred-and-ten-degree corners,
and a mitred vertex placed there drove a spike two hundred and ten units below
the baseline.

What survives all four attempts is the diagnosis. A flat foot or a square elbow
is two strokes each cut off at a boundary; this fitter gives that region one
smooth spine, because the skeleton is connected through it. No cap and no join
can put a flat on a round-nibbed sweep of a smooth spine. Splitting a run where
the letter has a flat is the work, and it is a bigger piece than a cap rule.

