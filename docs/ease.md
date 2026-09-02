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
   of on a separate page.
7. Add keyboard shortcuts for everything, so an experienced user never needs the
   mouse.

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
