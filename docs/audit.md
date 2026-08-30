# What is missing

> **A** and **B** are done. **C** and **D** are open.

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

## C. Nothing helps you draw straight — *open*

**C1. Guides are horizontal only.** The type is `Array<{ y: number }>`. There
is no vertical guide, which is the one you would use to mark a stem position
or where a sidebearing should fall.

**C2. Nothing snaps.** Dragging a node lands wherever the pointer was let go:
no pull towards a whole unit, a metric line, a guide, or another point's x or
y. Every number this application displays is displayed rounded, so a letter
drawn by dragging is off the grid in every coordinate and looks perfectly
fine until something measures it.

## D. Three smaller ones — *open*

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
