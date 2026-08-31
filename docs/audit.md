# What is missing

> All four are done.

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
