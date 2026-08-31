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
