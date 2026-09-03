# Drawing more than one weight

A record of teaching Typeforge the thing it is furthest from Glyphs on: masters
you draw yourself, and a font that interpolates between them. `docs/ease.md` is
the list of things that were hard to use. This is a thing that was not there.

## Where this starts from, measured

Half of it is already built and tested, which is why this is worth doing now.

- `fvar`, `gvar` and `STAT` are written, and `gvar` carries the four **phantom
  points**, so an advance width varies between masters as well as an outline.
- `buildGvar(axes, defaults, masters)` already takes a list of masters, and
  `VariableOptions.masters` already takes each as a whole typeface at a
  location. Nothing in the writer is particular to one axis or two masters.
- A glyph whose masters do not line up is already handled honestly: it is left
  at the default, handed back in `held`, and named in the export's notes.
- `test/variable.integration.test.ts` and `test/varying-drawn.integration.test.ts`
  pin the result with fontTools, measuring ink rather than width because a bold
  and a light reach the same distance.

## What is missing

You cannot draw the other end. The masters are **synthesised** from one number:
`varyByWeight` moves `params.weight`, and `applyWeight` offsets every node along
its own normal. That is a machine-made bold. It is even where a drawn bold is
optical, it thickens a hairline and a stem by the same amount, and the `g` it
produces is the Regular's `g` inflated. Nobody ships that.

So the file-format half exists and the document half does not: a font here has
one set of outlines and no way to say "and here is the Bold".

## What varies and what cannot, and why

The line is drawn by what the format can express with the tables that are
written, not by taste.

| | |
|---|---|
| **Per master** | every glyph's outline, and every glyph's advance width |
| **Shared** | family name, designer, licence, units per em, the vertical metrics, kerning, features, ligatures, sets, and which glyphs exist at all |

The vertical metrics are shared because varying them needs `MVAR`, which is not
written. Kerning is shared for the same reason on `GPOS`. Both are worth saying
out loud rather than discovering at export, and both are candidates for later.

## The rule

Carried from `docs/ease.md`, with one addition: **a font with one weight shows
nothing about masters at all.** This is the advanced feature the plan there
promised to place rather than hide -- it appears where you draw, the moment you
ask for a second weight, and not before.

## A master starts empty and fills up

A new master does not copy the whole font. It holds only the letters actually
drawn in it, and falls back to the default for the rest -- which is the same
thing the exporter already does with a glyph that will not interpolate, and it
means the honest state of the work is always visible: *forty letters drawn in
Bold, a hundred and eighty still following the Regular.* Adding a weight to a
six-thousand-glyph font costs nothing until you draw in it.

## The steps

1. **The model.** A document can hold more than one master: add one, name it,
   place it on the weight axis, switch between them, delete one. Saved and
   restored with the project. The chips sit above the canvas, where the decision
   is taken. **Done. See M1.**
2. **Compatibility, where you draw.** Two masters interpolate only if a letter
   has the same contours with the same points in the same order. Say so on the
   letter, in the grid and in the checks -- not at export, which is far too
   late. **Done. See M2.**
3. **Interpolation.** A slider that draws the letters at any point between the
   masters. The payoff, and the thing that makes a mistake in step 2 visible
   rather than theoretical. **Done, for the grid. See M3.**
4. **Export from the masters you drew.** The variable export uses them when
   they exist and falls back to the synthesised weights when they do not, and
   says which. Verified by pinning the result with fontTools. **Done. See M4.**
5. **A second axis.** Width, or a custom one, once one axis is right.

## Not doing

No per-master vertical metrics or kerning until `MVAR` and `GPOS` variations are
written. No automatic interpolation of a missing master's letters into a real
drawing -- a letter is drawn or it follows, and the difference is stated.


---

# M1. More than one weight in a document — *done*

## What is there now

A font opens with one weight and says so, in one line on the whole-font screen:
its name, and a button that adds another. Press it and you get a copy of what
you have, placed at the far end of the axis -- 700 if you were at 400 -- with
its name and its position beside it and a way to be rid of it. Chips to switch
between them appear above the canvas the moment there are two, because which
weight you are drawing is a decision about what you are looking at.

Everything the application already does works in whichever weight is in hand.
Nothing had to learn about masters: the active master's typeface **is**
`state.typeface`, not a copy of it, so every edit has been landing in the right
weight all along and switching only changes which object that is.

## The rule the document rests on

**A weight owns its letters and shares everything else.** The family name, the
vertical metrics, the kerning, the features and the glyph list are one set of
objects held by every weight; only the drawing is copied.

That is not a convenience. The file this becomes carries one `name` table, one
set of vertical metrics and one `GPOS`, so a document that let them drift would
be describing a font that cannot be built. Two things follow:

- **The glyph list is copied and still has to agree.** A letter added in the
  Regular and missing from the Bold cannot vary, and is a difference nobody
  would think to look for. So adding, removing or renaming a letter lands in
  every weight, detected off the glyph array's identity -- which the library's
  own add and remove replace rather than mutate, so a kerning edit costs
  nothing.
- **Sharing the objects once was not enough.** Kerning a pair *replaces*
  `typeface.kerning` rather than pushing onto it, so the moment anything shared
  was written the two weights held different arrays and the Bold was unkerned.
  Undo has the same shape, assigning old fields back onto one typeface. A test
  found the first door; the second was found by looking for the rest. So the
  rule is enforced after every change instead of at creation, written as "copy
  all of it, then put the drawing back" -- which means a field added to
  `Typeface` later is shared by default, and that is the right default.

## A change of mind about hiding

The plan above said a font with one weight should show nothing at all about
masters. That is how a feature stays undiscovered. `docs/ease.md`'s rule is that
an advanced tool is *placed*, not hidden, and the user's own words for it were
"not hidden but available when the user wants to take the type design a step
further".

So: the line is on the whole-font screen from the first visit, under a label
that says what it is for, and it is the smallest thing that can say a second
weight is possible -- a name and a button. What is genuinely meaningless with
one weight is not drawn: no rename, no axis position, no remove, and no chips
above the canvas, because a switch with one thing to switch to is furniture.
It is also in the palette, where everything else in the application is.

## What the tests caught

**Coming back put you on the first weight.** The document already promises to
put somebody back in the mode they left in, on the letter they were drawing.
Coming back to the Regular after an afternoon in the Black is the same broken
promise one level down. Which weight was in hand is written down now.

**A "clean" master was not clean.** Writing the unit tests found that the square
those tests were built on is wound counter-clockwise, which is the wrong
direction for a TrueType outer contour -- so the letter being used as "nothing
to report" was tripping the direction check.

## What is on disk

A weight is a set of exceptions to the first one, on the same terms as the font
itself is a set of exceptions to the file it came from: only the letters
actually drawn in it. A weight added to a six-thousand-glyph font and drawn in
forty places is forty letters on disk. A font with one weight is written exactly
as it always was, with neither field present, so nothing older reads differently.


---

# M2. Saying which letters will not vary — *done*

## What was wrong

A weight is stored as the difference from the first one, and there is no
difference to store between two drawings that are not the same paths with the
same points in the same order. The exporter has always coped with this
honestly -- the letter stands at the default, `buildGvar` hands it back in
`held`, and the export's notes name it -- but the notes are written *after* the
file is. By then the drawing is finished and the person has gone.

And it is invisible until then. A Bold `o` drawn with one counter instead of two
looks like a Bold `o`. Nothing on screen said the exported font would leave it
standing still while every letter around it moved.

## What is there now

The same fact, in the three places somebody would meet it, before the export:

- **On the letter.** The strip over the canvas gains one more line: *"This letter
  will not vary — 2 paths in Regular and 1 in Bold."* Compared against the first
  weight, because that is what the file compares against.
- **In the grid.** A red dot in the top-left corner of the cell, opposite the
  amber one that means edited. Opposite corners so a letter can carry both,
  which is the usual case: the letter that will not vary is generally the one
  just drawn differently.
- **On the whole-font screen.** The Weights line counts them: *"1 letter will not
  vary."*
- **In the checks**, as a warning naming the first five.

## What it costs to ask

Contour and component counts, and node counts per contour. No geometry. So it is
a walk over the glyph list rather than over the drawing, computed once per view
rather than once per cell, and it is free in a font with one weight -- which is
almost all of them -- because it returns before looking at anything.

The grid cell takes a boolean rather than the set, for the reason its other props
are the shape they are: eighty memoised cells that all take the same object all
re-render together.

## What the test caught about the test

The first version made the mismatch by pressing **Add extremes** on the sample's
`o` and asserting the point count changed. It did not: the sample is well drawn
and has its extremes already, so the operation was a no-op and the test would
have proved nothing. Its own guard -- reading the counts before and after --
caught it. It deletes the `o`'s counter instead, which is a change no well-drawn
letter can absorb.


---

# M3. Seeing between the weights — *done, in the grid*

## Why it matters

A reader will show somebody 437 as readily as 400. Drawing two ends and never
looking at the middle is drawing an axis on faith — and it is where the mistakes
are, because the middle is the only place a badly matched pair of drawings
actually looks wrong.

## What is there now

A slider on the Weights line: **Look at 550**, and the whole grid redraws at 550,
every letter blended between the two weights either side of it. Pressing a
weight, or **Back to the drawing**, puts it back.

Looking rather than editing, and the code says so: nothing writes through the
preview, the letters on screen are a calculation, and the drawing underneath is
untouched. Going to a weight clears it, because the two answer the same question
and a preview left standing over a different master is a screen showing neither
what is drawn nor what was asked for.

## How it blends

Straight lines between the bracketing pair, which is what the format does along
one axis: `gvar` stores each master as a difference from the default and a
reader scales that difference by how far along it is. Three decisions worth
stating:

- **The pair either side, not the ends.** With a Medium drawn deliberately off
  the straight line between Regular and Bold, looking at 450 gives the Medium's
  answer, not the Bold's. A test pins that.
- **The nearest end, past the last weight drawn.** Extrapolating would show
  somebody a letter nobody drew and no reader will produce; the format clamps to
  the axis, so this does.
- **Nothing at all where the drawings do not line up.** Which is not a silent
  failure — M2 says so, in words, on the letter.

Blended per cell rather than for the whole font, because the grid is virtualised:
eighty letters are on screen and six thousand are not, and blending a font nobody
is looking at to answer a slider is the wrong arithmetic by two orders of
magnitude.

## What is measured

The browser test makes a Bold that is genuinely bolder — twelve presses of
**Bigger**, an operation that moves points without adding or removing any — and
then counts the lit pixels in the grid's own canvas at 400, at 700 and at 550.
Ink rather than a bounding box, because the question an axis is asked is whether
the strokes got heavier. 550 comes out between the two, and pressing *Back to
the drawing* returns exactly the ink that was there before.

## Why the proof waits

The proof is where a weight is judged in text, and it should have this slider.
It does not yet, on purpose: the proof lays out the whole font rather than the
letters on screen, so previewing it means building a whole typeface at a
position rather than a letter at one. That is the same object a **static
instance export** needs — "the font at 550, as a file" — so it belongs with step
4 rather than being written twice.


---

# M4. The font shipped from the weights you drew — *done*

## What changed

`varyByDrawnWeights` takes the masters the document holds and hands them to the
exporter that has been waiting for them since the forge learned to ship a
family. The dialog prefers it and falls back to the synthesised pair, so a font
with one weight behaves exactly as it did.

Three decisions, and each of them shows up in the file:

- **The axis is where the weights were put.** A Regular at 400 and a Bold at 700
  give an axis of 400 to 700, not 100 to 900. That number is also the proof that
  the drawings were used: the synthesised path gives 100 to 900 whatever the
  font holds.
- **The default is the first weight**, because that is what the document treats
  as the original everywhere else, and what `gvar` stores every other master as
  a difference from.
- **The instances are the weights that were drawn, by the names they were
  given** -- not the nine standard ones. A menu entry for a Thin this font does
  not have lands on whatever the axis reaches at its lightest and calls it a
  Thin.

## And the dialog says which

Choosing Variable now reads either *"Built from the 2 weights you drew: Regular,
Bold"* or, without a second weight, *"a calculated bold rather than a drawn one.
Add a weight on the Font screen to draw the other end yourself."* The second is
the honest description of what that path has always done, and it was not being
said.

## What is measured

`test/varying-masters.integration.test.ts` builds the file from two drawn
weights, pins it at 400, 550 and 700 with fontTools, and measures **ink** at
each -- because a bold and a light reach the same distance, so a width says
nothing. Every letter is heavier at 700 than at 400 and the middle is genuinely
in the middle, which is the claim a well-formed variable font has got silently
wrong here before: correct axis, correct instances, `STAT` in order, a hundred
glyphs carrying deltas, and both ends drawing the same letters.

Writing it also found that the first weight is called **Book** rather than
Regular for DejaVu, because a master takes the name the font arrived with. The
test's expectation was wrong and the code was right, which is the same point the
instance naming makes: these names come from the document, not from a list.

## And the proof, now that the object exists

`typefaceAt(masters, at)` is the font at one place on the axis, and both halves
wanted it: a static instance is that object written to a file, and a proof
somebody is scrubbing is that object drawn. So it is written once, and the
Weights line now sits on the proof as well -- which is where a weight is really
judged, because a letter tells you about a letter and a paragraph tells you
about a face.

One pass over the font per position of the slider, memoised. On the sample that
is nothing; on a six-thousand-glyph font it is a visible cost, and it is the
honest one: the layout walks the document, so the document is what has to move.
