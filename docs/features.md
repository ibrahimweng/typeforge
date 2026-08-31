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
