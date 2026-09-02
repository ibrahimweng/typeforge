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
   it.
4. Move the tools and controls out of the side panels and onto the screens where
   you use them.
5. In each panel, put the few controls for the current job at the top and the
   rest below a labelled line.
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
