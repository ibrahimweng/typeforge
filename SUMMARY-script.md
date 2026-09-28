# Script and hand bases: polish summary

Branch: `claude/polish-script`. Scope: the joined faces (Handwriting, Formal
Script, Casual Script, Monoline Script, Roundhand) and the two unjoined hand
faces (Marker, Brush), at the Light (pen 30), each face's own weight, 200 and
the slider maximum 260.

Screenshots of every face at all four weights are in `docs/polish/script/before`
(the original code) and `docs/polish/script/after` (this branch). Each sheet
sets "minimum Handgloves", "the quick brown fox" and the lowercase alphabet with
the font's own joins, including the high hand-over after `o v w b` and the word
start and end forms.

## What was wrong

- **Heavy weights (200 and 260).** The seam, where one letter hands over to
  the next, sat barely above the foot of a stem. No arc could climb from the
  foot to the seam at the face's 55 degree heading, so each half of every join
  fell back to a straight line with a short stub at 55 degrees on the end. The
  two stubs crossed in an X at every seam in a word.
- **Joins leaving from inside a letter.** At 260 the lead-out of `c`, `e`,
  `k` and `x` started on the far wall of the letter and ran through its
  counter. The high lead-out of `b` started on its stem and ran across its bowl
  into the next letter.
- **Steps under every join.** The two halves of a join overlap past the seam
  on a straight run, but each half started to curve right at the seam. The
  other half's square end then stood out under the join. On the Formal
  Script's angled nib this was a visible step at every seam.
- **Dips below the line.** Where a lead-out had to leave along the line and
  then climb, the curve dipped first (the Monoline `T` went 13 units under the
  baseline).
- **Self-crossing letters.** The written `r` after `b`, `o`, `v` or `w` hooked
  back across itself. The written `n` taken high folded into its own apex on
  four faces.
- **Closed `e`.** The written `e` was drawn as a circle on the bowl's height.
  It stayed narrow while every other bowl widened at heavy weights, so its eye
  closed from 200 up.
- **Loop joints.** A looped ascender or descender was a square-cut stroke
  with an eye laid beside it. This left a flag at the top of every looped `l`,
  `b`, `h` and `k`, and a nick at the foot of every looped `g`, `j`, `y` and
  `f`.
- **Light loops.** At pen 30 the ascender eyes on the Casual Script filled
  in as small black teardrops.
- **Variable fonts.** A variable export of the Monoline held back 107 glyphs
  and the Roundhand 105. Their masters had different points, because joins
  were built differently at different weights, eyes came and went with the
  pen, and the alternates were drawn without the family's record of decisions.
- **A straight `y`** had its tail start below its rounded cup at heavy
  weights, so the letter came apart.

## What changed

All in `src/forge/script.ts`, `src/forge/letters.ts` and
`src/forge/letters/alternates.ts`, with small edits to shared files where noted.

- **Seam height and heading** (`seamsOf`, `seamHeading`). The low seam rises
  with the pen, up to half the x-height, so a stem's foot has room to climb.
  The heading is held to what one arc from the foot can reach. At every face's
  own weight nothing moves. The high seam stays a pen and a half under the
  x-height, so a high lead-out always has letter to leave from.
- **Join construction** (`run`, `biarc`, `settled`):
  - Each half runs straight along the heading on its own side of the seam
    for as far as the other half reaches over, so the two halves lie on one
    line.
  - An S-shaped biarc is replaced by the member of the biarc family whose
    first arc is nearly straight (flat, then turning). A straight run and one
    arc is kept only where no two arcs can be drawn.
  - Every half is handed on as a straight run plus two arcs of one piece
    each, so the same letter has the same points at every weight.
  - Where the turn will not draw, the straight run is shortened instead of
    becoming a corner.
  - The fold limit for a join's curves uses the join's own (lighter) width.
- **Where joins attach** (`planJoin`, `attach`). A lead-in lands at the top of
  a bowed stem. A low lead-out leaves from the letter's lower right when the
  band it searches holds only the far wall; it leaves along a level or rising
  run there, never a falling one, so no ink goes under the baseline.
- **Written letters** (`alternates.ts`):
  - The `n`'s up-stroke leans over before its lead-in stands up, so the
    lead-in meets the lead-out before it on one line.
  - Taken high, it flattens until the bend fits under the apex.
  - The `r` builds its lead-out on the low seam whatever it is entered at.
  - The `e`'s loop is as wide as the face's bowls, and its rising bar is
    drawn at join weight past the text weight.
  - The straight `y`'s tail starts inside its rounded cup.
- **Loops** (`loopsOn`, `connected`):
  - The run an eye turns off ends round where it turns. Where the run curls,
    the eye comes home on the run's own end.
  - At a Light the eye's width is measured in the face's own pen, as the
    joins are.
  - Whether a letter has an eye is decided once, at the family's drawn
    weight (the exporter's `WaveBook`). Where a weight cannot draw that eye,
    it is drawn hidden inside its run's ink. Eyes are pinned to two pieces.
- **Shared files (minimal):**
  - `build.ts`: passes `scriptUnit` to `seamsOf`.
  - `letters/common.ts`: `capped()` has an opt-in flag to square a round end
    only when pulling it back is what crosses the stroke.
  - `typeface.ts`: the joined faces' alternates are drawn with the same book
    as the letters.
  - `letters.ts`: a written letter's drawn form keeps its own book page.

## Results

- No lowercase letter of any joined face crosses itself in any drawing
  (plain, high, word start and end) at 30, its own weight, 120, 160, 200 or
  260. There were 53 before.
- No join has a corner in it at any of the four weights. There were 217
  before.
- Variable exports hold back nothing. Monoline 107 → 0, Roundhand 105 → 0;
  Handwriting, Formal and Casual stay at 0.
- Default weights look as they did, apart from the fixed flags and nicks at
  loop joints.

Tests: `src/forge/script-polish.test.ts`, eight tests, each written to fail on
the old code. `npx tsc -b --noEmit`, `npx biome check .` and
`npx vitest run src/forge src/assemble src/library` (1209 tests) all pass.

## What remains

- **Heavy scripts are squat.** A 260 pen on a 332 to 420 unit x-height is a
  stem of two thirds of the x-height or more. The letters are legible and the
  joins are clean, but they read as a heavy display script. Counters in `e`,
  `a` and `g` are slits at 260.
- **The high hand-over after `o v w b`** runs level near the top of the
  letters at heavy weights. That is by design, but at 260 it reads a little
  like a rule.
- **Nib-pen loop tips.** On the Handwriting and the Casual Script the round
  end of a flat nib is the nib itself, so a small nib-corner mark stays where
  an eye meets the top of its stem.
- **`r` into `o`.** The `r`'s weld past the seam pokes slightly into the
  `o`'s counter at the default weight. The same applies to any letter followed
  by a written bowl, which has no lead-in stroke to take the weld. Fixing this
  needs the join to know the next letter, or a lead-in added to written bowls.
- **The written `r`** is a long diagonal from shoulder to valley. It is the
  existing design and reads a little like `ʌ`.
- **The heavy `s`** on the joined faces, and some heavy Marker and Brush
  letters (`k`, `G`, `Z`, `s`), come from recipes shared with the Sans and
  the other text faces. They were left to the sessions that own those recipes.
- **Node counts without the exporter's book.** Node counts are equal across
  weights through the export path, which is what a variable font uses. A
  letter drawn at an arbitrary slider weight without the book can still bow a
  stem differently. That is the engine's existing design for bows and balls.
