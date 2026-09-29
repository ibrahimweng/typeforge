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
- **The written `r`** was a full stem with its arm carried down beside it at
  52 degrees. It read as a narrow `n` or as `ʌ` (`brown` came out `bʌown`).
- **Ticks inside bowls.** A lead-out ran the whole weld past the seam. A bowl
  with no lead-in of its own (`o`, `a`, `e`) took its square end inside its
  wall, and the corner stood in the counter after every low join on the
  Formal Script and the Monoline, and after `v` and `w` on three faces.
- **The heavy `s`.** Joined faces were held to the text `s`, which grows past
  its lines rather than close up. At 260 it stood a third of an x-height over
  the line and hung as far under it, like a black `§`.
- **The heavy `G` on the Marker and the Brush** read as a 6: the upper
  terminal was cut back off the bowl.

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
  - The `r` is two strokes meeting in a notch: a short up-stroke into a nub,
    and a nearly upright down-stroke from under the nub to the line, turning
    into the lead-out. At the start of a word the up-stroke is a short flick.
- **Lead-out length** (`run`). A lead-out carries on past the seam by half the
  weld. The next letter's lead-in still laps over it, and a written letter's
  own lead-in still meets it over a length of stroke.
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
    only when pulling it back is what crosses the stroke. `blackOf()` no
    longer excludes joined faces, so they get the Black `s` at heavy weights
    (default weights are untouched). `blackS()` never turns tighter than the
    nib's own flattest curve for an angled pen of modest contrast; otherwise
    the Roundhand's `s` folded at 210. Only the Brush among other faces
    reaches that floor, and its `s` is visibly unchanged.
  - `style.ts`: the Marker and the Brush use the existing spurred `G`.
  - `typeface.ts`: the joined faces' alternates are drawn with the same book
    as the letters.
  - `letters.ts`: a written letter's drawn form keeps its own book page.

## Second round: problems found by a full audit

A sweep of every face, every weight from 20 to 260, every letter and every
join position, and a read of pangrams set in each face, found more. Images of
each as it was are in `docs/polish/script/problems/`.

- **The joined `r` read as `v`** after a low join (`quartz` as `quavtz`). It
  is now drawn as the reference scripts write it: a stem standing the full
  x-height, a short drooping arm off its top, and a tight foot into the
  lead-out. A written letter's lead-out now leaves from the end of its last
  stroke, as `Recipe.leaves` already said.
- **The loop pass read an overshoot as an ascender.** At the Thin the `r`'s
  arm crested a few units over the x-height and was asked whether it had an
  eye, which put the book of the drawn weight's decisions out of step: the
  Monoline held its `r` back from the variable font. An end now has to clear
  its line by a tenth of the x-height to count.
- **Folds on a single weight.** The Monoline's word-end `r` at 217 (a stem bow
  turning on the tightest radius the wave allows) and the Roundhand's `s` at
  209 to 212 (a turn tighter than its nib). Bows now turn on a tenth more than
  the pen, and the Black `s` never tighter than its nib's flattest curve.
- **`The` set as `Lhe`.** The `T` and the `Y` handed on from the foot of a
  stem standing on its own. The pen lifts after them now, as after an `I`.
- **The high join a flat rule at 260.** It now climbs a little once the pen
  is past a third of the x-height, up to twelve degrees; level at every
  face's own weight.
- **The heavy `s` a tenth of an x-height too tall.** A joined face's spine
  may lie as flat as six degrees before the letter grows, with shorter
  terminals so the top one stays off the spine. Now within a twentieth.
- **The heavy `e` closed.** The written `e`'s bar goes lighter as the pen
  gets heavy, and the eye is placed for that bar. The Roundhand takes the
  written `e` too. At 260 every joined face's `e` keeps at least 2.5% of an
  x-height squared of eye (Monoline 1.3% → 6.9%, Roundhand 1.0% → 2.8%).
- **The Marker and Brush `k`** at 260 had a long thin blade of an arm. Both
  take the grotesque `k` now.
- **The tests** now draw every fifth weight and the weights where folds were
  found, capitals included, and export all five joined faces as variable
  fonts.

## Results

- No letter of any joined face crosses itself in any drawing (plain, high,
  word start and end) at any whole weight from 20 to 260. There were 53 at
  the six weights first checked.
- No join has a corner in it at any of the four weights. There were 217
  before.
- Variable exports hold back nothing, on all seven hand faces. Monoline
  107 → 0, Roundhand 105 → 0.
- Default weights look as they did, apart from the fixed flags and nicks at
  loop joints.

- No ink from one letter's join falls into the counter of the bowl after it
  (every pair of a joined letter into `a c e o d g q`, at every weight).
- The joined faces' `s` keeps to the lines the `o` keeps to at 200. At 260 it
  is within a twentieth of an x-height of them, where it used to be up to 46
  hundredths out.

Tests: `src/forge/script-polish.test.ts`, fifteen tests, each written to fail
on the old code. `npx tsc -b --noEmit`, `npx biome check .` and
`npx vitest run src/forge src/assemble src/library` (1216 tests) all pass.

## What remains

- **Capitals on the joined faces are print capitals.** They lean and join
  onward, but they are the Sans's letters. Written capitals would be a new set
  of 26 drawings, which is a design project rather than a fault, and the
  capital recipes are shared with the other faces.
- **Heavy scripts are squat.** A 260 pen on a 332 to 420 unit x-height is a
  stem of two thirds of the x-height or more. Every counter is open and every
  join is clean, but the faces read as a heavy display script there. The
  Roundhand's bowls keep a fifth of an x-height squared of counter at 260,
  about half what the other joined faces keep.
- **Nib-pen loop tips.** On the Handwriting and the Casual Script the eye's
  round end stands 2 to 4 units past the corner of the stem's flat top, under
  1% of the x-height and invisible at text size. A square end was tried and
  is worse on the Roundhand, whose round end fills the nick at the foot of
  every loop.
- **Node counts without the exporter's book.** Node counts are equal across
  weights through the export path, which is what a variable font uses. A
  letter drawn at an arbitrary slider weight without the book can still bow a
  stem differently. That is the engine's existing design for bows and balls.
