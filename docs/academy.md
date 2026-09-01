# Type Academy

## The shape of teaching that was missing

There were two already and both are good at their job.

A **tip** is one line that appears the first time you arrive somewhere and then
never again. It teaches by *place*, and it is the right answer to "what is this
view for" — `kerning` says you click the gap rather than the letter, which is
not discoverable by looking.

The **help drawer** is prose under searchable headings. It teaches by *topic*,
and it is the right answer to "what does bounce do".

Neither answers the question somebody actually arrives with, which is **"I have
never made a typeface and I would like to make one."** That question wants an
order — this, then this — and it wants to know whether what you did worked.

## Lessons that ask the font

The design turns on one decision: a lesson is not a paragraph with a tick box
you press yourself. It is a paragraph, a task, and **a question asked of the
real document**.

```ts
done: (at) => at.app.typeface?.kerning.length > 0
```

Nobody can complete a course by reading it. Undo the work and the lesson goes
back to undone, which is correct and is also what makes it teaching rather than
a checklist.

Some lessons have nothing checkable — read this proof, look at those gaps — and
those are marked by hand. **They are drawn differently on purpose.** A filled
tick is the font saying so; a hollow one is you saying so. Those are two
different claims and an interface that showed them identically would be lying
about which it had. Pressing "start again" clears only the second kind, and says
so: the font still says what it says.

## Beside the work, never over it

A drawer, for the same reason the help is one and more so: **a lesson that takes
over the screen cannot teach a tool, because the tool is not on the screen any
more.** Everything is written to be read with the letter still in front of you,
and the lesson stays open while you go and do it.

`Take me there` moves you to where the lesson happens — including across
document kinds, which is what `store.askForMode` exists for.

## The four courses

| Course | What you have at the end |
|---|---|
| **Your first typeface** | A working font file, installed, without drawing a letter |
| **Drawing a letter by hand** | The pen's real gesture, and the four tools that do what a pen alone cannot |
| **Spacing, and then kerning** | The two jobs in the right order, and why the other order never ends |
| **Making it a real font** | The faults that are invisible on the machine that made them |

The lessons teach what is true and why it matters, not what to click. A lesson
whose text is a list of clicks teaches somebody to use this version of this
program and nothing else — which is why the tests hold every lesson to more
prose than task.

## What the tour found

Building this meant drawing a typeface from nothing and writing down what
fought me. One thing did, immediately, and it had nothing to do with courses:

**The front door never offered to make a font.** Three doors — drop a file, open
a UFO folder, try the sample — and all three wanted a typeface you already had.
The thing this tool is best at was behind a mode switch nobody had been told
about. That is now the first button on the screen.
