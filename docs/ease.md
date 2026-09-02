# Making this easier to use

A record of the work to make Typeforge usable by somebody who has never drawn a
typeface, without taking anything away from somebody who has. `docs/audit.md`
is the list of things that were wrong. This is the list of things that were
hard.

## The problem

All the tools are there. They sit in panels beside the work instead of on the
screen where you use them. The drawing tools only appear in one view out of six.

## The rule

Every control goes on the screen where you use it, and stays visible. The few
you need right now go at the top. The rest go below a line that says what they
are for. Nothing is hidden behind a menu or a switch.

## Who comes first

1. Someone coming back to their work. They land straight back in their project.
2. Someone new. They see three ways to start, with one recommended.
3. Someone who does not know type design. They see one line telling them what to
   do next.
4. Someone who does know it. They can turn that line off and reach anything from
   the keyboard.

A returning user is every user after the first day. They should not pay every
time for a welcome they needed once.

## The steps

1. A start screen for the first visit. After that you land back in your last
   project where you left it. **Done.**
2. Rename the four modes so they say what you do in them, and put them in the
   order you do them. **Done.**
3. One line under the top bar with the next thing to do and a button that does
   it. **Done.**
4. Move the tools and controls out of the side panels and onto the screens where
   you use them. **Done, and half of it was wrong. See E3.**
5. In each panel, put the few controls for the current job at the top and the
   rest below a labelled line. **Done.**
6. After every action, show what changed. Show mistakes as you make them instead
   of on a separate page. **Done.**
7. Add keyboard shortcuts for everything, so an experienced user never needs the
   mouse. **Done, and most of it was already there. See E5.**

## Not doing

No second, simpler version of the app to maintain alongside this one. No changes
to the drawing engines.

---

# E1. The first screen, and the four tabs above it — *done*

## What a beginner saw

The headline was **No font open**, which names an absence rather than a thing
you can make. The two paragraphs under it were about files. They listed four
formats and explained what a UFO folder is, in that order, before saying
anything about what this tool does. The one route that ends with a whole
alphabet on screen was the third button on the row.

Around that sat furniture for a font that was not there. Six view tabs, none of
which could be pressed to any effect. An undo pair with nothing behind it. A
panel three hundred pixels wide whose only content was the sentence
"Parameters appear once a font is open". On a 1,440-pixel window that is a fifth
of the screen given over to explaining its own emptiness.

## What is there now

A headline saying **Make a typeface**, and three ways to start, ranked. Drawing
is first and marked, because it is the only one that ends with twenty-six
letters on screen before anything is typed. Each route says in one sentence what
it makes and what it wants from you.

The formats are still all said, further down, under **Or start from a font**,
where a person who has a file is standing anyway. The four buttons there are
open a font, open a UFO folder, the library, and the sample.

The view tabs, the undo pair and the parameters panel are hidden until a font is
open.

## The four tabs

They read Edit, Draw, Assemble, Trace, and Edit was first for as long as the bar
has existed. Edit is the one of the four you cannot use until you have been
somewhere else, because it works on a font that is already open.

Three of them make a font and the fourth is where you then work on it, so they
are in that order now: **Draw, Trace, Assemble, Edit**. Each hover says what the
mode takes and what it leaves you with. They are four separate documents rather
than four views of one, which is the thing a beginner gets wrong, so the hovers
say that too.

## Somebody coming back

Nothing needed doing. A session is already put back before the first frame is
drawn, in whichever mode it was left in, and the status line already says
"Picked up where you left off". This screen is only ever seen when there is no
font to go back to.


---

# E2. One line saying what to do next — *done*

## What was wrong

Everything this tool can do was reachable, and nothing said which of it to do
first. The order of the work had to be known before you arrived.

What stood in for it was a coach mark: a five-line paragraph above the canvas,
shown once, dismissed with "Got it". In Draw it read "Nothing here came from
another font. Pick a base, then change a part -- a serif, a shoulder, a corner
-- and every letter that has that part follows..." and ran to four sentences
before it mentioned anything you could press. A beginner does not read that.

## What is there now

One line under the top bar, across the whole width, with the next unfinished
thing and the button that starts it.

- **Draw.** Nothing touched yet, so: pick a style, then drag Weight. Once
  something is on the undo stack it changes to offering the way on to the
  editor.
- **Trace.** No font read yet, so: choose one. Once there are strokes, the way
  on to the editor.
- **Assemble.** No drawings yet, so: add them. Then the way on.
- **Edit.** No letters, then no name, then nothing kerned, then export.

## What it will not do

It does not guess, and it does not record what you have looked at. Every rung is
read off the document itself: how many letters there are, what the font is
called, whether anything is kerned, whether there is a drawing to hand over. A
rung saying "you have not visited Spacing" would be a claim about a person
rather than about a font, and this line only makes claims about the font. A test
walks four views with the same font and the line does not move.

That is also why there is no rung for the checks yet. The honest version is
"this font has faults", which means running the whole-font validation, and that
is the slow job with the progress bar. It joins the ladder at step 6, when the
report becomes state the rest of the app can read rather than something one view
computes for itself.

## The tips, and a change of mind

The first version had the line hold the tips back while it was up, on the
grounds that two banners stacked is worse than either. Reading the tips again
settled it the other way. A tip says what a *screen* is for and the one gesture
it needs, e.g. "click the gap between two letters, not the letters, then drag".
The line says what the *font* still needs. They are different things and a
beginner wants both, so the suppression came out.

What is true is that the tip in Draw runs to five lines before it names anything
you can press. That is one tip being too long rather than tips being wrong, and
it is fixed at step 5, where what a coach mark says about a panel goes into that
panel beside the control it is about.

## Four labels chosen not to collide

Every action on the line reads differently from every button already on screen:
"Open in the editor" rather than the panel's "Edit these letters", "Export the
font" rather than the toolbar's "Export", "Turn this off" rather than a "stop",
and "Nothing is drawn yet" rather than the grid's "No letters yet". Two buttons
reading the same word is a thing a person has to look twice at. It also made
fourteen browser tests ambiguous, which is how each collision was found.


---

# E3. Ranking the two panels somebody lives in — *done*

## Where I was wrong about step 4

The plan said "the drawing tools only appear in one view out of six". That is
true and it is not a defect. Of the editor's six views only Glyph edits
outlines, so the palette is where it belongs, and Draw and Trace already reach
it: each lends a letter to the editor and takes it back. I had not checked that
before writing the step.

So step 4 loses its tools half. What is left of it is the real complaint:
controls that sit in a panel in no particular order.

## What was wrong

Measured, at a 1,440 by 900 window.

**Draw's panel is 8,647 pixels tall.** The panel shows about 810 of them at a
time, so that is ten and a half screens. It had no ranking at all:

| | starts at |
|---|---|
| Start from, the twenty styles you choose once | 0 |
| The pen | 660 |
| nine sections about parts of letters | 1,125 |
| **Proportions** | **4,983** |
| Joining | 6,582 |
| Cut, Cast, the tool | 7,230 |

**The editor's panel is 3,521 pixels.** It opened with seven hundred and forty
pixels of guidance about which letters to draw first, so the parameters -- which
the panel is named for and the reason anybody opens it -- began at 914, below
the fold.

## What is there now

Draw's panel opens with the three things that decide what the whole font looks
like: **Start from, The pen, Proportions**. Proportions begins at 1,860 instead
of 4,983. Everything else is grouped under a rule that says what the group is
for: **Shape the parts**, **Finishing**, and **n alone** for the ones that reach
only the letter on screen.

The editor's panel opens with the parameters. The control letters are one scroll
down under a rule reading **Where to start**.

Nothing is hidden. Scrolling past a rule is one gesture, and the rule tells you
whether what you want is under it. A test asserts the order of both panels and a
second one asserts that Joining, Cut, Cast and "Draw n yourself" are all still
there.

## The order is pinned on marks, not on prose

The first version of the test searched the panel's own text and got two false
answers: the Sans blurb says "ordinary proportions" above the Proportions
heading, and the scope switch says "n alone" above the rule that says the same.
Each section carries a `data-panel-section` name now and the test reads them in
document order.

## One sentence out of the Draw tip

The tip above the canvas ran to five sentences. The second of them said that
changing a part changes every letter that has it, which is what the "Shape the
parts" rule now says a few inches to the right, so it came out. The other four
are gestures and facts with no home yet: what to double-click, how the accented
letters follow, and what Skeleton and the specimen line are for.


---

# E4. Mistakes shown where they are made — *done*

## What was wrong

The application could already find every fault it now reports here. It had
seven checks on a glyph's outline -- unclosed contours, points on top of each
other, paths that draw nothing, a curve turning between points, a negative
width, contours wound the wrong way, contours overlapping -- and it said so in
exactly one place: a separate page, reached by a tab, after a run that walks the
whole font.

That is the wrong moment twice over. A beginner does not know to go and check;
and an unclosed outline is a thing to fix while the pen is still in your hand,
not something to be told about an hour later next to two hundred other findings.

The code said so itself. A comment in `App.tsx` read: "Checks holds its findings
in the view rather than in the store, so a panel out here could not say anything
about them even if it wanted to."

## What is there now

**Over the canvas, the faults of the letter in front of you.** The same seven
checks, asked of one glyph rather than six thousand, which costs nothing and so
runs again after every edit. Nothing is cached, so nothing can be stale. Worded
in the second person and about the letter: the report says "3 glyphs have an
unclosed contour. First: a, e, n" because it is describing a font; standing in
front of the `e`, the useful sentence is "an outline is not closed".

**Laid over the canvas rather than above it.** The first version took its own row
in the column, so the moment a fault appeared the canvas moved down by the
height of the strip -- while the pen was still in the hand that had just caused
it. Drawing the third point of an open contour shifted the drawing thirty pixels
under the pointer. The first test written for this caught it by then missing the
point it was aiming at. It is `pointer-events-none` for the same reason: this
sits on the one surface in the application that is drawn on.

**Nothing at all when there is nothing wrong.** Measured across the sample's `o`,
`a`, `e`, `n` and `s`: no strip on any of them. A warning that is on screen all
the time is a warning nobody reads.

**The Checks tab carries the count.** The number is hidden from the tab's
accessible name and reaches a screen reader as the button's description instead,
because "Checks 3" is a different tab from "Checks" to a screen reader and to
every test that asks for one.

**Two more rungs on the line.** The report now lives in the store, so the line
under the top bar can say "nothing has checked this font yet" and then "N things
to fix. A font with errors may not install." Both are facts about the font
rather than about the person, which is the rule the line was built on. E2 said
this rung was waiting for step 6; this is it.

**Undo and redo say what they moved.** Neither said anything, and the change
they make is often invisible from where you are standing: a point put back in a
letter you are no longer looking at, a path direction corrected. Every entry on
the stack already carried a name and nothing had ever shown it. Now the status
line says "Undone: Close the outline" and the button's hover says what it will
take back. The label is quoted rather than bent into the past tense, because
every one of them is written in the imperative for an undo menu.

The three generators are left alone. Their history is a snapshot of the whole
parameter set with no names on it, and undoing one redraws the alphabet in front
of you, so there is nothing that needs saying.


---

# E5. The keyboard — *done, and most of it was already there*

## Where I was wrong about step 7

The step said "add keyboard shortcuts for everything, so an experienced user
never needs the mouse". Measured before writing any of it, with the harness that
already exists for this (`npx vite-node scripts/reach.ts`):

| kind | reachable by its own description |
|---|---|
| control | 74/75 |
| action | 7/7 |
| view | 7/7 |
| face | 21/21 |
| alternate | 21/21 |
| letter | 10/10 |

582 entries. Space or ⌘K opens the palette, from anywhere, and everything in
that table is one query away. "Everything is reachable from the keyboard" was
true before this step started.

## What was actually missing

The keys a hand already knows. There was no ⌘S, no ⌘E, no ⌘O, no number for a
view, and no key for the one action the line under the toolbar is offering.
Somebody who saves forty times an afternoon should not open a search to do it.

And discovery. The only list of shortcuts in the product was inside the help
drawer, which is a list somebody has to decide to go and study.

## What is there now

- **⌘S, ⌘E, ⌘O** — save, export, open. These stand through typing, as ⌘K does: a
  chord is never mistaken for a character, and somebody halfway through naming a
  glyph who presses ⌘S means to save.
- **1 – 6** — the six views, in the order the tabs sit in. A bare key, so it
  stands aside for anything being typed into: a `2` in the pair filter is a
  number, not a request to go to the second tab.
- **⌘⏎** — do what the line under the toolbar says. Bound only while that line is
  on screen with something to do, because a key whose effect is not visible is a
  key nobody can learn.

The test that says aside for typing is the one the palette's space bar needed
first, so it moved out of the palette into `src/keys/typing.ts` and both use it.

## Where a shortcut is learnt

Beside the slow way to the same thing. The palette now prints the key on any row
that has one, so somebody who opens it and types "save" is shown ⌘S at the exact
moment they are taking the long way round. The buttons say it on their hover,
and the help drawer's list has all five.

## What is deliberately not bound

⌘1 to ⌘9 switch browser tabs and a page cannot take that back in Chrome, so the
modes have no direct key -- switching mode is opening a different document, and
the palette is the right speed for it. The thirteen drawing tools already share
four group keys (`V`, `P`, `R`, `K`, pressed again to walk the group), which is
the arrangement that fits thirteen tools into a keyboard the editor has already
spent.
