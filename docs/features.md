# Features: the letters a font draws for more than one character

## What is missing

A font editor where you can draw an `f` and an `i` and cannot make them into
`fi`. That is the whole of it.

The state of things, read off the code rather than guessed at:

- `src/font/gsub.ts` writes **one shape of rule** — a chained context that
  redraws some positions of a matched sequence — and says so in its own
  opening comment: "GSUB can express ligatures, alternates a user picks
  between, many-to-one and one-to-many substitutions and reorderings; this
  writes one shape of rule". It was written for joined scripts and is right
  about what it needed to be.
- The one feature it writes is `calt`, hardcoded: one feature tag, and every
  lookup in the font belongs to it.
- `typeface.alternates` is written by exactly one thing —
  `src/forge/typeface.ts`, generating a joined script. Nothing in the editor
  can make one.
- `src/font/parse.ts` sets `alternates: []` on every import, so a font opened
  here has no rules of its own to start from.
- `src/project/format.ts` does not save `alternates`. Today that loses
  nothing, because in edit mode they are always empty. The moment somebody can
  make one, it loses their work.

So a person can draw `f_i`, name it, see it in the grid, and export it — and
no shaper will ever show it, because nothing writes the rule that selects it.
The Checks page does not say so either: there is no check for a glyph that
nothing can reach.

## What a ligature actually is, in the file

Three different lookup types, for three different things, and the writer
supports one of them.

| What you want | Lookup | Feature | Have it? |
|---|---|---|---|
| `f` `i` become `fi` | 4, LigatureSubst | `liga` | no |
| a single-storey `a` you switch on | 1, SingleSubst | `ss01`, `salt` | no |
| a letter redrawn because of its neighbour | 6 + 1, chained context | `calt` | yes |

The third is the hardest of the three and it is the one that exists, because
it is the one a joined script needed. The first is the one every text face
needs and it is missing.

## The work, in four batches

### A. The writer learns a second rule shape, and more than one feature

- `LigatureSubst` (lookup type 4): a coverage of first glyphs, and for each,
  the component sequences that follow and the glyph they become. Longest match
  first, which the format requires and is easy to get wrong.
- The feature list stops being one hardcoded tag. Each feature carries its own
  lookup indices, so `liga` and `calt` can both be in a font without either
  firing the other's lookups.
- Verified against **fontTools** (it decompiles and recompiles the table) and
  **HarfBuzz** (it lays out the text and says which glyphs came out). Neither
  has a stake in this being right. HarfBuzz is what settles it: shape `fi` and
  count the glyphs.

### B. The model, and the seventh place a name is written

A glyph's name is kept in six places, and every operation here has to reach
all of them. A ligature rule makes it seven: `f_i` names `f` and `i`, and a
rename or a delete that misses it leaves a rule pointing at a glyph that is
not there.

- A `Feature` type covering the three shapes, named rather than indexed —
  glyph ids are not settled until the export orders them.
- `library.ts`: rename, remove and duplicate reach ligature rules too.
- `format.ts`: a project saves and reloads its features.
- The store: undo holds a feature change whole, as it holds a rename.

### C. Making one, in the interface

- A features panel: build a ligature by naming its parts, or take one from the
  list of standard ones whose letters this font already has.
- The same panel makes a stylistic set out of glyphs named `a.ss01`.
- What exists, listed, and a way to take one out.

### D. Saying so, and seeing it work

- A check: **a glyph nothing can reach.** No character maps to it and no rule
  selects it, so it is in the file and can never be shown. Exactly the state
  drawing `f_i` leaves you in today.
- The proof view shows the features working, because a ligature you cannot see
  is a ligature you cannot judge.


---

# What the work turned up

Three batches in, and the pattern holds: the faults that mattered were not on
the list, and two of the three were found by looking at the panel rather than
by running the tests.

**CI had never shaped a word.** The workflow installed fontTools and not
HarfBuzz, so every test that lays out text has been skipping there since the
joined scripts landed -- silently, the way a skipped test does. The comment
beside the font install says the principle out loud: "Tests read a font from
the system and skip when none is present, so install one rather than let that
coverage silently disappear." HarfBuzz was simply missed.

**The panel made a duplicate of a ligature the font already had.** Two naming
conventions are in use and both are correct: `f_i` is what a tool writes when
it makes one, `fi` is what a great many shipped fonts call it. Looking only for
the first offered to *make* `fi` to DejaVu Sans, which draws it -- and pressing
the button added a second, empty glyph beside the real one and wired the rule
to the blank. Which is a worse font than the one the button was there to fix.

**The unreachable check was wrong about every real font.** It reported two
hundred and sixty-five dead letters in DejaVu: Arabic initial, medial and final
forms, reached by the font's own `GSUB`, which this document does not model and
the exporter hands back untouched. A check that is wrong about a correct font
is worse than no check, so on a font with a source it now asks only about the
letters somebody has drawn or changed here -- the only part this document knows
anything about. `.null` and `nonmarkingreturn` went the same way: two glyphs
the old Macintosh tables required, carried by plenty of shipped fonts, reached
by nothing and not a mistake.

And one thing that was on the list and turned out bigger than it looked: a
glyph's name was written in six places, and the two new rule shapes make it
eight. The store's `editFont` was holding five of them for undo -- right until
a ligature could be made by hand, and after that an undo that took the letter
back and left the rule pointing at it.

---

# Variable, from a font somebody opened

The `fvar`/`gvar`/`STAT` writer has been here since the forge learned to ship a
family in one file, and `VariableOptions` takes masters as whole typefaces --
so nothing about it was ever particular to a drawn-from-nothing face. Only the
forge could reach it. A font imported or drawn by hand could not be shipped as
a varying one at all, though `variable.ts` says in its own opening paragraph
that this half of the application is "already a machine for drawing the same
alphabet at any weight".

A master is that same typeface with one parameter moved, and it works because
of a fact about `applyWeight`: it walks the nodes a contour already has and
offsets each one along its own normal. It moves points; it does not make or
remove them. So two weights of a letter come out with the same points in the
same order, which is the one thing a variable font cannot do without. Where
that is not true the export already copes -- `buildGvar` hands back the glyphs
whose masters did not line up, they stay at the default, and the exporter says
which.

## The fault it cost to find

The first version produced a variable font whose bold and light were the same
letters to four decimal places, in a file that was otherwise perfectly formed:
correct axis, correct instances, `STAT` in order, more than a hundred glyphs
carrying deltas, and fontTools reading all of it without complaint.

`params.weight` is kept in **font units**. The slider's own range is a fraction
of the em -- `-0.04` to `0.06` -- and the inspector multiplies by `unitsPerEm`
on the way in. Both halves of that are in the code and neither is in the type,
so masters built at the raw fraction moved a twenty-fifth of a font unit
instead of eighty-two. On DejaVu Sans that is a change of 0.08%: real, provably
non-zero, and invisible.

Nothing about the file said so. It took pinning the font at each end with
fontTools and measuring signed area -- ink rather than width, because a bold
and a light reach the same distance -- to see that `H` came back byte-identical
at 100 and at 900.
