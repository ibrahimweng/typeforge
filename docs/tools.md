# The tools, and saying what they are doing

## What is there now

Six tools down the left of the glyph canvas: select, pen, pencil, rectangle,
ellipse, knife. They work. What they do not do is say anything about
themselves while they are being used.

Read off the code rather than guessed at:

- **Hover does nothing.** The button carries `hover:bg-background` and its
  container *is* `bg-background`, so pointing at an unselected tool changes
  nothing at all. It has looked deliberate and been dead the whole time.
- **A tool's state is invisible to the interface.** Everything a tool is doing
  mid-gesture lives in `dragRef`, a React ref, so nothing re-renders on it.
  The palette could not show what a tool is doing even if it wanted to.
- **One cursor for five tools.** `cursorFor` returns `crosshair` for pen,
  pencil, rectangle, ellipse and knife alike. The pointer says "a tool is
  armed" and never which one.
- **The pen draws no preview.** Marquee, shape, knife and pencil all draw a
  live one; the pen commits a point per click with nothing between the last
  point and the pointer.
- **The pen cannot close a path.** `addPoint` appends to the last open contour
  or starts a new one, and nothing anywhere in the application ever sets
  `closed`. So every outline drawn with the pen stays open, and an open contour
  does not fill. The pen's second main action does not exist.

## What each tool's phases actually are

Not a uniform four states bolted onto six buttons. Each tool has its own
shape, and the states worth showing are the ones that change what the next
click does.

| Tool | Phases |
|---|---|
| Select | idle · something grabbable under the pointer · dragging it · pulling a marquee |
| Pen | nothing started · a path open · the pointer on the point that would close it |
| Pencil | armed · drawing · back near the start, so letting go closes the loop |
| Rectangle | armed · dragging · held square · drawn from the middle |
| Ellipse | armed · dragging · held circular · drawn from the middle |
| Knife | armed · dragging a line · the line crosses something, so it will cut |

## The work

**A. The phase, where the interface can see it.** Lift what a tool is doing out
of the ref and into somewhere the palette, the cursor and the status line all
read from. Fix the dead hover. A cursor per tool rather than one for five.

**B. The pen learns its second action.** A rubber band from the last point to
the pointer, the closing point marked when clicking it would close the outline,
and the close itself -- which is the part that is missing rather than merely
unshown.

**C. Say what happens next.** One line, in the tool's own words, that changes
with the phase: "Click to start an outline", "Click the first point again to
close it", "Drag right across a shape to cut it in two".

**D. Prove it.** Each phase reached in a browser test and looked at in a
screenshot, because a state nobody has seen is a state nobody knows is wrong.

---

# The pen, and the points

## What the pen could not do

It could not draw a curve. `addPoint` made every point
`{ handleIn: null, handleOut: null, type: "corner" }`, so the pen drew
polygons: to get a curve you placed corners and pressed Round afterwards.

Click-and-drag to pull a handle out of the point you are placing is *the* pen
gesture. Illustrator 88 had it and Glyphs, RoboFont, FontForge, Figma and
Inkscape all still do, unchanged. Four more that go with it and were also
absent: alt while placing to break the handle, clicking the point you just
made to retract its outgoing handle so the next segment runs straight, shift to
hold a handle to 45 degrees, and clicking a segment to put a point on it
without moving the curve.

## Reducing points

`fitCubics` in `src/quill/curve.ts` is Schneider's least-squares fit and has
been here since the quill. The pencil runs a hand-drawn trail through it. No
outline that already exists could be handed to it.

"Tidy up" is not that. It drops duplicate and collinear points -- real work,
and not a re-fit: a curve described by forty points it does not consider
redundant stays forty points. Glyphs' Tidy Up Paths re-fits; this did not.

The other half is deleting one point. It removed the node and let the shape
jump, where every editor a type designer has used re-fits the neighbours so the
curve survives losing it. That is the move that actually reduces a count.

## What the code already had

Nearly all of it, unexposed:

- `splitCubic` -- de Casteljau, so a point can go on a segment with the curve
  either side coming out identical
- `fitCubics` -- the re-fit, for simplify and for delete
- `cubicExtremeTs` -- where a curve turns, for showing the extremes that are
  missing rather than only being able to add them
- `smoothed` -- for the points that are nearly smooth and print as a dent

## What was built

**1. The pen's curve.** `src/font/pen.ts` holds the maths: `draggedPoint` pulls
a handle out of the point being placed and mirrors it on the arriving side,
`retracted` takes the leaving handle off, `heldToAngle` snaps a held handle to
the nearest eighth turn. Alt while pulling breaks the pair, so the outline can
turn at a point it curves into. Clicking the point you just placed retracts its
handle, which is how a curve is followed by a straight.

**2. Points in and out, without the shape jumping.** `withPointOn` splits a
segment with de Casteljau, so the curve either side comes out identical to
within floating point. `withoutPoint` re-fits the two segments a removed point
joined into one cubic -- asked with an infinite tolerance, because the question
is "describe this run with one segment" rather than "describe it well", and a
real tolerance answers a bent run with two curves and leaves the point count
where it was. The first version left the handles alone whenever the fit gave
more than one curve, which turned a quarter circle into a straight line.

**3. Simplify.** `simplified` samples each run between corners and hands it to
`fitCubics` at a tolerance the panel shows. Corners split the runs and are
never crossed: a fit allowed to round off a stem end has redrawn the letter.
Three strengths -- within a unit, within four, within twelve -- and the button
says what it would cost before it runs: `Simplify (16 → 8)`.

At a tight tolerance the fit subdivides to hit it, so a four-point circle asked
to stay within a hundredth of a unit came back as twenty-six points -- a
"simplify" that made the outline five times heavier and reported it as
"-22 points out". `simplified` now returns the contour it was given whenever
the fit is not actually shorter.

**4. Picking, and the two faults you cannot see.** A marquee and a click work up
to about a dozen points and stop entirely on an imported outline of two
hundred. Added: every point in the letter (ctrl-A), every point of one kind,
the next point along the path (Tab), and the whole contour under a double-click
-- which is the only reliable way to pick a counter, since any marquee big
enough to catch the inside of an `o` catches the outside too.

`src/font/marks.ts` answers in positions rather than counts, which is the shape
the canvas needs: `extremesMissing` gives the place on the curve where it turns
without a point on it, and `nearlySmooth` gives the points whose handles are
within three degrees of straight -- the kink that is invisible at editing size
and catches the light along an edge at reading size. Both behind a `Faults`
switch, off by default, because a letter halfway through being drawn is covered
in missing extremes and does not need telling.

## What driving it caught that reading it did not

The pen's drag kind went into `Doing` through a cast -- `drag.kind as
Doing["kind"]` -- so `whileDoing` had no case to answer it, ran off the end of
its switch and returned `undefined`. The caller then read `.phase` of nothing
and the whole pointer-down died: the pen looked like it had simply stopped
working. The cast was the defect; it had told the compiler to stop checking in
the one place checking was the point. It is gone, the two lists agree, and the
switch has a floor under it so the next kind added fails loudly instead.

The segment highlight was drawn in `--background`, the chrome colour, where it
meant `--canvas`, the ground the letter sits on. The two are the same on the
dark ground and opposite on the light one, so it read correctly right up until
somebody pressed "On white" and got a black halo. The light ground now also
darkens `--inspect` and `--attention`, which were picked to carry against a
near-black panel and washed out on a near-white canvas.

---

# The tools, grouped

## What a screenshot said

Twelve paths in one letter, most of them three or four points, several
overlapping, the sidebearings eight hundred units negative, and the faults
overlay ringing everything. It was sent with the words "make it more
intuitive", and every one of those twelve paths had the same cause.

**The pen had no verb for "I am done with this."** Not Escape, not Enter, not
picking up another tool. The only exit was a click landing inside seven pixels
of the outline's first point. Miss it -- and a hand aiming at a seven-pixel
target misses often -- and you silently got another point rather than a closed
shape. Think better of the whole thing and the half-drawn contour stayed in the
letter for ever: an open contour of two points draws as nothing, so it is
invisible on the canvas and permanent in the Paths list.

Five attempts, five stubs. Twelve paths is an afternoon.

## What was hiding behind it

Three things, each invisible until the first was fixed.

**"Open" was being read off the shape rather than off the session.** The editor
asked whether the last contour was closed, which is a fact about the geometry.
Whether the hand is part way through drawing it is a different question, and
with one test for both, a pen click anywhere on the canvas reached back and
extended an outline that had been abandoned ten minutes earlier. Five attempts
did not make five stubs; they made one contour wandering across the letter,
whose first point was by then so far from its last that the ring which closes
it could never be found. The fix is a `drawing` flag on the session.

**The status line was describing a different program.** With nothing being
drawn, hovering an edge, it said `Click to start an outline` -- and that click
put a point on the edge under the pointer instead. It also never refreshed when
a gesture ended, so letting go of a pen pull left `Let go for a corner, or pull
to curve out of it` sitting under a point already placed.

**The knife said the same sentence everywhere.** `Drag a line right across a
shape to cut it in two`, over a letter and over blank canvas alike. A sentence
that is identical everywhere carries no information about anywhere, and the one
case worth warning about -- a cut that will do nothing -- looked exactly like
the case that works.

## Thirteen tools, four groups

The pen has four jobs and had one button. Adding a point was a plain click that
*also* had to mean "start a new outline here", which is two jobs on one gesture
and the whole reason a pen kept editing the letter it was drawn beside. Taking
one out was a keypress. Converting one did not exist.

So they are tools: **Pen**, **Freehand**, **Add point**, **Delete point**,
**Convert point**. That is the set Illustrator shipped in 1988 and every editor
since has kept, for the reason that keeps it: they are four verbs of one idea,
and somebody looking for "take this point out" looks under the nib.

`Pencil` became `Freehand` and moved under the pen, because that is what it is
-- a pen that takes a drawn line instead of a series of clicks. Two ways of
drawing the same outline were in two different places on the rail.

The other three groups got the same treatment: **Select path** and **Lasso**
beside Select; **Polygon** beside the rectangle and ellipse; **Scissors**, which
opens a shape at one place, beside the Knife, which cuts one into two. Thirteen
icons will not fit down a rail, so one button per group shows the tool you last
used from it and a flyout holds the rest -- named and explained, because the
reason to open it is not knowing which icon you want.

## The numbers that changed

- **Closing: 7px to 14px.** Closing is an intention already declared -- one open
  outline, one point that ends it, nothing else in reach that means anything --
  so being generous costs nothing and being strict costs a stray point every
  time a hand is a few pixels out. The ring is now the same size as the target
  and fills when a click would close, because a two-pixel thickening inside a
  seven-pixel window is a signal only somebody who knows to look for it can read.
- **Fewer than three points is never kept.** The single rule that clears the
  litter, and safe because three points is also the least that can enclose any
  area at all.
- **Faults speak only about closed shapes.** An open contour is half a drawing
  and is missing most of its extremes by definition, so the switch used to cover
  a work in progress in rings that all said "you have not finished". A person
  who learns to ignore the rings has stopped seeing the real ones.
