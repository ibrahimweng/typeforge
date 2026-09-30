# Polish: summary

This file gathers the summaries of the six polish branches (UI, Serif, Sans, script, cuts and casts, opened fonts), one section per area. The before and after pictures the branches made while the work was going on are not kept in the repository; where a summary named a picture, it now says in words what the picture showed, or the reference is left out. The branches started from commit 3050e21.

The test counts and timings each section quotes are historical: each was
counted on its own branch before the six were merged, and they do not add up to
the merged suite. At the merge (90dfc86) the full `npx vitest run` held 3,296
tests. Run it for the current count.

## Contents

- [UI](#ui)
- [Serif (against Lora)](#serif-against-lora)
- [Sans (against Geist)](#sans-against-geist)
- [Script and hand bases](#script-and-hand-bases)
- [Cuts and casts](#cuts-and-casts)
- [Opened fonts under the Edit-mode controls](#opened-fonts-under-the-edit-mode-controls)
- [Known limits](#known-limits)

## UI

Branch `claude/polish-ui`. This work covers the app UI only: `src/components`,
`src/state`, `src/views`, `src/forge/health.ts`, their tests, and e2e specs.
"Before" is commit 3050e21, the commit before the unfinished WIP. "After" is
this branch.

### The five reported problems

| # | Problem | Status |
|---|---------|--------|
| 1 | The "Shape of g/y/j" thumbnails cut off tails and loops | Fixed (finished from the WIP). Every form is framed on one shared height that holds its ink. |
| 2 | The specimen line cropped accents (Å, É) and descenders | Fixed (from the WIP). The viewBox grows to take in all ink, with a little air around it. |
| 3 | At weight 30 the warnings said "Reaching past the line … or less weight" | Fixed. The slack past a line is now at least 6% of the em (from the WIP). The advice no longer mentions weight. It names the line that is crossed: "A taller ascender", "A deeper descender", or both. |
| 4 | The title read "My Serif Serif" after picking a base | Fixed (from the WIP). The base is left off when the name already says it. A name the tool gave now follows the base, and a name the user typed stays. |
| 5 | Wide glyphs overflowed their Edit grid cells at width 1.25 | Already fixed before this work (`maxWidth` in `glyph-render.ts`). Checked at 1.25 and 1.5, on the sample font and on a Serif drawing taken into Edit. No letter was cut off, and no canvas was squashed at any window width from 640 to 2560 px. |

Why "less weight" was wrong advice: the slack allows the pen its own width, so
a lighter pen takes away as much room as it gives back. The letters that were
reported (parentheses, dollar, ogonek, cedilla) reach the same distance past
the line at every weight. I measured this. Sans `(` tops out at 750 at weights
30, 87 and 172.

### Other problems found by walking the app, all fixed

1. **Slant produced false "Touching the letter before it" warnings.** At 12°
   Sans reported 65+ letters and Serif 217+. A slanted letter leans about the
   middle of the lowercase, so its feet swing left of the origin, as in any
   italic. The letter before it leans the same way, so they never meet. The
   check now measures the outline stood back upright. Once a letter leans, it
   also ignores accents that stand wholly above the ascender, where no ordinary
   neighbour reaches. (`health.ts`)
2. **The Draw letter strip cropped 223 of the Sans cells.** It lost the accents
   of every accented capital and the overshoot of C, G and O, because the Sans
   capitals stand at the ascender. With Shadow on, all 450 cells were cropped.
   Each cell is now framed to its ink. (`ForgeView.tsx`)
3. **The Draw stage cut off ink past its margin.** For example, a shadowed y
   lost its tail. The stage frame now grows to take in the ink.
4. **Part controls that do nothing were still live.** With Serifs off, Reach,
   Depth, Bracket, Shape and Head slid and changed nothing. The terminal's Cut
   moved under every finish, though only Angled uses it. A wave's Depth and
   Wavelength moved with no runs waving. These controls are now dimmed and
   inert, with a line saying what would bring them back. This is the same
   approach the Joining section already used. A unit test proves that each
   idle control changes no letter and that it does change one once live.
   (`part-idle.ts`)
5. **The status bar said "Nothing open" on the Draw page.** It also showed a
   "Select" tool from a tool rail that Draw does not have. It now names what is
   open in each mode ("My Serif — drawn from Serif"), and shows the tool and
   glyph only in Edit. (`StatusBar.tsx`)
6. **The warning chips showed glyph names.** They read "ccedilla
   scommaaccent" next to "δ". They now show the character, with the glyph name
   in the tooltip. (`letter-label.ts`)
7. **Warnings about an earlier font were shown as current.** The warnings are
   worked out in the background and the work restarts on every change, so the
   last answer stayed on screen until a new one finished. After Breaks was
   switched on and off on the Serif, "Counters closing up: t ţ ť ð & ¼ $" stayed
   up through five more cut toggles, about 12 seconds, although no letter was
   closing up any more. An answer about an earlier font is now dimmed and
   marked "Rechecking…" until the new one arrives. (`ForgeView.tsx`)

### Found in review and fixed

A second check of the finished work found these. Each was confirmed in the
browser or with a test before it was fixed.

1. **Letters were drawn at different sizes.** Framing each letter to its own
   ink kept it whole but changed its size: on the stage Å was drawn 14%
   smaller than A and the baseline moved 11 px; in the strip À was 20%
   smaller; the specimen shrank 15% when an Å was typed. Every letter now
   shares one frame taken from the font's own reach (the letters that go
   furthest), grown only for ink that goes further still. The strip letter is
   drawn one size larger to make up for the taller frame.
2. **The stage jumped size when a drag began.** It was framed by the live
   drawing, and a cast is left off during a drag. It is framed by the font as
   it last settled now.
3. **The tool's proof cropped the ring of an Å** by 135 units. It uses the
   same shared frame.
4. **"My Formal Script Formal Script".** The doubled-name check matched single
   words, so two-word styles slipped through. It matches whole phrases now.
5. **Warning chips were named with glyph names for screen readers** ("Show
   ccedilla" on a chip showing ç). They are named with the character shown.
6. **Accents over their limit were told to raise the ascender.** Their limit
   follows the cap height, and raising the ascender changed nothing. The advice
   now says "A taller cap height", and a test checks that following it works.
7. **One line changed in `src/App.tsx`**, outside the folders this work was
   limited to. The views now report which one is on screen
   (`src/state/surface.ts`), and `App.tsx` is back as it was.

### Checked and fine

- On Sans and Serif, one change at a time, with a screenshot after each (113
  screenshots, every one looked at): Weight 30, 87, 172 and 260; Contrast,
  Width, Slant, x-height and Tension; the Serif part's Reach, Depth and Bracket
  at their minimum and maximum, and every Shape and Head; every Terminal
  finish, and Cut at 25° under Angled; every g, y and j alternate; and all 14
  cut and cast switches. Updates took 0.2 to 0.7 s, well under 2 s. Every
  alternate keeps at least 44 units of room on the stage.
- Edit mode Weight, Width, Slant and Corner radius took 0.08 to 0.44 s, with
  a screenshot after each change. A glyph opened in the editor at width 1.25
  shows whole.
- Layout at 768, 1024, 1440 and 2560 px wide: no horizontal page scroll and
  nothing broken. At 768 px the "Letter A" tab truncates to "Lette…" and the
  top bar wraps to two rows. Both are acceptable.
- No console errors or warnings anywhere in the walk.

### Left for the letter sessions (outside this scope)

- **Accents do not lean with a slanted letter.** At 12°, igrave's grave sits
  about 70 units left of where an oblique would put it. Lowercase accents
  under the ascender can then meet a tall neighbour (as in "lì"), and the
  warnings bar reports those letters. That warning is correct.
- **Contrast 0.9 pushes Sans ș past the descender**, and **x-height 640 closes
  the Serif rings** (Å, ů). The warnings report both correctly.
- **`e2e/forge.spec.ts` "draws the symbols and writes them into the font"
  failed on this branch, with or without these changes.** The exported
  font's £ and = measured like missing glyphs. The glyphs were there: the
  test told a missing character by its width matching the font's `.notdef`,
  and Geist's £ is as wide as that box to within a unit. The merge rewrote
  the check to measure each character twice, with a monospace and then a
  serif font behind the exported one, and call it missing only when the two
  disagree. The test passes on the merged code.

### Tests

- New unit tests: `ink-frame.test.ts`, `part-idle.test.ts`,
  `letter-label.test.ts`, `StatusBar.test.ts`, `surface.test.ts`, plus new
  cases in
  `health.test.ts`, `drawn.test.ts` and `forge-store.test.ts`.
- New e2e spec: `e2e/polish-ui.spec.ts` (10 tests). Each fails on the code it
  guards, except the Edit-grid width test. That bug was fixed before this work
  and could not be brought back: with the width cap removed, the widest letter
  at Width 1.5 fills 83.7% of its cell (in the sample font and in DejaVu
  Sans), under the 86% where the cap starts. It stays as a check that widened
  letters are whole; the cap itself is unit-tested in `glyph-render.test.ts`.
- Every commit passed `npx tsc -b --noEmit`, `npx biome check .` and
  `npx vitest run src/components src/state src/views src/forge/health.test.ts`
  (577 tests at the end of the branch; historical). `e2e/polish-ui.spec.ts`
  (run twice over) and `e2e/workspace.spec.ts` pass in Chromium.
  `e2e/forge.spec.ts` passed except for the one failure noted above, which
  the merge fixed in the test. WebKit and Firefox are not installed in this
  container, so those two projects could not run here; CI runs them.

## Serif (against Lora)

This branch (`claude/polish-serif`) brings Draw mode's Serif base closer to Lora, letter by letter, from the Light (pen 30) through the Regular (87) and Lora Bold (142) to the slider's heaviest (260). Every change was checked against Lora Regular and Lora Bold in overlays at the same scale, at all five weights.

### What changed

#### The s past a Black
At 230 to 260 the s came out slanted like an italic. The widened heavy s asked for bowls too flat for its spine, and the search found a spine that crossed only half of each bowl, so the lower bowl stood back under the upper one. The search now narrows the bowls further and lets the spine lie flatter on a text face. The uprights are lightened less, so the heavy s keeps its weight beside the o. The Didone, which shares this construction, draws exactly as before. At 120 to 172 the spine was already a proper curve, so that item needed no change.

#### The t
The flag was a straight band laid from the bar's end to a head as wide as the whole stem. Past a Black the flag was buried in the stem. The t now has Lora's head: a concave flag sweeping up to a head half a stem wide, on the stem's right edge, with the stem's top cut to slope away under it. The bar reaches past the stem by at least half a stem. The flag bows less where a short flag on another base would fold.

#### The 2 and the 7
The 2's diagonal was one straight band. It now runs in an S, as Lora's does: steeper than its chord out of the bowl, flattest through the middle, steeper again into the foot. The 7's stem now falls straight down out of the corner and then turns into its slant. Before, it left the corner already slanted and stood half a stem left of Lora's all the way down.

#### Beaks on the figures
A text serif's figure arms that lie along a line now wear their beaks: the 7's arm, the 2's foot and the 5's flag. Before, every figure end except a foot was left bare. This is gated to wedge serifs, which only the Serif uses.

#### The G
The G's upright stood on its bowl half a stem left of Lora's and ended in a plain cut. It now stands where Lora's does, under a hairline serif reaching both ways.

#### The e
The tail runs a little further round up to the Bold, as Lora's reaches out under the bowl. Past a Black the bowl starts further round, which lifts the bar off the tail. At 260 the tail had run up to within six units of the bar and its end looked sliced off; the gap is now about 22 units.

#### The R
The leg was bowed all the way down, at 0.9 units across per unit down where Lora's leg falls at 0.66. It now leaves the bowl where Lora's does, runs straight at Lora's 56 degrees, and turns in its last few units into a toe along the line, cut upright, reaching past the bowl as Lora's does.

#### The question mark
The neck left the hook on a straight slant and stopped in mid-air at an angle. The hook and neck are now one S, and the neck's foot stands upright over the dot.

#### The g
The link bellied in under the bowl because it was bowed to the wrong side. It now swings out to the left, as Lora's does.

#### Rising strokes as hairlines
With the pen held nearly level, both arms of a vee came out the same weight: the v's rising arm was 82 units across, against Lora's 52 beside a falling arm of 91. The Serif now draws its rising straight strokes as hairlines, as the Didone does. The exceptions are the z, the Z and the slash, which Lora draws heavy, and the A, which already draws its own hairline.

Vees drawn as one run (v, V, Y, the M's middle, w and W) are first split into one stroke per arm. Each stroke is laid again so that the vee's point stays exactly where it was, and each arm's end is cut along its neighbour's outer edge. A vee is split wherever an arm rises at all, so its points are the same at every weight, and an arm is drawn light only where it rises as a hairline does. The w now runs heavy, light, heavy, light (90, 51, 89, 52 at the Regular, against Lora's 87, 41, 84, 45).

The y's rising arm is drawn light on into its tail, with just enough contrast to keep the tail's foot on the descender. The falling arm's end is cut along the hairline's spine, so its corners stay inside it. The one's flag keeps its own pen: drawn as a hairline, its end stood seven units above the stem's head at the heaviest.

#### Spacing at the Bold
Lora Bold sets its rounds about a quarter tighter than its Regular: an o is 31 units a side against 41. The Serif can now name its Bold spacing (`metrics.bold.spacing`, set to 0.82), reached by the Bold and held past it. The Regular's sidebearings, which already matched Lora's exactly, are unchanged.

#### The Bracket control
Past about 0.4 the Bracket slider did nothing, because the bracket was clamped to the serif's depth. There were two more flat stretches. On a short serif, every value between what the serif could take and its thickness drew the same serif. On a square serif (the Didone, Slab and Typewriter), the fillet stopped growing once it reached the end of the wing, so the Didone's n was the same from 0.55 to 1.

Now every step of the slider changes the serif on all four serifed bases, at every weight:
- Whatever the bracket asks for past what the serif can take climbs on up the stem. A text serif's hollow climbs, and so does a square serif's fillet. The square fillet is now drawn as a quarter of an ellipse, running along the wing only as far as the wing allows and up the stem as far as it is asked.
- On a short serif, the stretch that used to be flat is now read around the base's own bracket setting. Below that setting the fillet scales down toward none; above it the rest climbs. At the setting itself the drawing is exactly what it always was. Simply counting the climb from the serif's depth would have moved the Serif's own X by 41 units at 200, and the other bases by 2 to 8.

No base's default drawing moves. I checked every letter on every base at five weights.

#### Drops that crossed themselves
At contrast 0.9 past a Black, the c's drop crossed its own closing edge. The crossing only showed once the outline was rounded to whole units. A drop that crosses itself is now redrawn: first with its tail leaving the stroke less steeply, then closed back along its own foot, then smaller. A redraw is taken only if it neither crosses itself nor leaves the stroke's band. A drop that did not cross is left exactly as it was.

### Second pass: errors found in the first pass, and fixed
I went back over the whole branch looking for errors, fixed each one and checked again, until a pass found nothing new.

- **Regression: the e folded with the pen tilted back.** At pen -10, past a Black, the e's bowl folded under its bar. My heavy-weight lift had caused it. The cause was in the sweep: a level cut's corner slid past the end of the bowl's first, very short piece, and the edge doubled back. A corner now takes any side node it passes with it, which keeps the point count, and a handle that dips back past the cut is levelled. This also cleared the older folds at pen -20, -30 and -45 and at x-height 300. At pen 60 on the heaviest, the bowl began nearly level, and its level cut ran three letters long; the bowl is now cut level only where it rises steeply. Every other base draws exactly as before.
- **The 2's diagonal was being drawn as a hairline.** The y's hairline rule caught any stroke that began on a rising line, including the 2's S, which begins a few units back inside its bowl. The diagonal stood 17 units in from the bowl's end, a visible step. The rule now needs a whole arm.
- **A spur under the y's crotch, and its tail below the descender.** Both came from the y's rising arm becoming a hairline (see above).
- **The one's head grew a spike at 200 to 260** from the same hairline rule (see above).
- **Choosing the humanist e on another base changed its tail.** Lora's longer tail is now for the Serif only. On every other base the alternate draws as it did before this branch. The one exception is the Brush at 260, where one corner moved 1.5 units because of the sweep fix, with no fold either way.
- **The s jumped at contrast 0.6.** Its bowl search, spine slope and upright weight all switched at once. At 260 the s grew 131 units wider and leaned like an italic. They now ease across 0.6 to 0.8. No base's default drawing moves.
- **Older faults that the wider sweep turned up:**
  - At pen -60 past a Black, the @'s ring end reached back over the small a's tail. The ring now stops a few degrees sooner where it would.
  - With the pen at an angle past a Black, the j's tail ended above the line a drop hangs from, and its drop came out as two slivers. The turn now goes round far enough to keep the end below the line.
  - A narrow zero pinched its counter to a point between 110 and 130. The swell now eases back where a bowl would fold.
  - A narrow R's leg stopped with no toe at all. Its toe now always has some length.
- **Smaller fixes:**
  - The teardrop retry now starts from the radius actually drawn.
  - The vee splitter shares the hairline rule's rising test and minimum weight, and no longer divides by zero on parallel edges.
  - Two comments and the R alternate's description said something the code no longer did.
  - Several tests now cover more weights: the bracket at five weights, the seven at 260, the c's drop once rounded to whole units, and the Regular's spacing to within a unit and a half of Lora's.
  - The y's hook test in `serif-forms.test.ts` was calibrated to the old full-pen tail. It is now held to Lora's width: Lora's hook is 163 units at the Regular and 182 at the Bold, and ours is 164 and 197.

### Items from the brief that needed no change
- **The s at 120–172.** The spine was already a proper curve (see above).
- **The 5's width at the Bold.** It already matched Lora Bold (461 against 464) and was held by a test.
- **The e's bar at contrast 0.9.** It already runs flush with the bowl at every weight.
- **The Z and the M at 260.** Both are clean at 260.
- **The R at 260.** Its leg was already present.
- **Slant 12.** Slanted letters are spaced as their upright drawings and then leaned, and kerning is measured along horizontal rows. A shear keeps horizontal distances at every height, so the gaps between d and g, and b and i, are identical at slant 12 and upright. I measured this for a dozen pairs at three heights.

### Checks
- Every glyph in the set (a–z, A–Z, 0–9, & ? ! . , ; : ' " ( ) - / @) has the same node count at ten weights from 10 to 260, with no contour crossing itself. This holds at the defaults and at each of these settings:
  - pen angle -90, -60, -45, -30, -20, -10, 20, 30, 45, 60 and 90
  - contrast 0, 0.3, 0.6, 0.75 and 0.9
  - width 0.8, 1.2 and 1.5
  - x-height 300, 400, 600 and 680
  - slant 12 and -12
  - bracket 0, 0.8 and 1, serif projection 1.2 and thickness 0.8
  - contrast 0.9 with pen angle 30, and contrast 0 with pen angle -30

  The one exception is under "Found but not fixed".
- Every test in `src/forge/serif-lora.test.ts` fails on the code before the fix it covers.
- Every other base draws exactly as before at its defaults. I checked this by hashing every letter on every base at five weights, before and after each change to shared code. The humanist alternates chosen on other bases draw as before too, apart from the letters this branch redrew on purpose.
- `npx tsc -b --noEmit`, `npx biome check .` and `npx vitest run src/forge src/assemble src/library` all pass (1226 tests on the branch; historical). The run takes about 3% longer than before the second pass, because of the fold checks on swollen bowls.

### What still differs from Lora
- **The j's spacing.** Lora's j has a negative left sidebearing (-88), so its tail runs under the letter before it. The engine keeps every letter's ink inside its advance, and a health check and two character-set tests enforce that. So our j's stem stands about 80 units further from the letter before it at the Regular, and about 60 at the Bold.
- **The vees' feet.** Lora's v, w and M have a narrow flat on the line: 42 units at the Regular and 89 at the Bold. Ours come to a point on the line, as the construction's always did.
- **The vees' opening.** Our v, w, x and y stand a little narrower between their arms than Lora's, with longer serifs making up the ink width.
- **The 2's diagonal.** Ours is 76 to 80 units across at the Regular and 122 to 128 at the Bold, against Lora's 63 to 77 and 98 to 119. It is drawn on the bowl's own pen so the two join without a step.
- **The Bold's serifs.** Our Bold serifs reach about 69 units past the stem against Lora's 62, so Bold pairs are still 15 to 20 units looser than Lora Bold's even with the tighter spacing.
- **The G's serif.** It is a plain hairline bar. Lora's is bracketed into the upright.
- **The R's toe.** Ours turns and is cut upright. Lora's flares out into a small serif.
- **The c's drop at 260.** Where the heavy drop meets the counter, it makes a small sharp notch.

### Found but not fixed
- **The c, C and G at width 0.6 past the Bold.** Whether the c's top hangs a drop, and whether the C and G keep their lower beak, is decided at each weight from the drawn curve. At this width that decision flips between the Regular and the Bold, so a drawing without a record of those decisions (like my sweep) sees the point count change. An exported family records the decisions once, at its drawn weight, and keeps them at every other weight, so an exported font stays consistent. The same happens with contrast 0.9, pen -45 and width 0.7 together. Changing it means changing the shared rule for every base, so I left it.
- **The e at pen 60, 230 and heavier.** It no longer folds, but its bowl ends in a large wedge out to the right. That wedge is the level cut on a stroke leaning that far.
- **The s at contrast 0.7 to 0.8 at the heaviest.** It now eases into the Didone's s instead of jumping, but past 0.7 it still leans a little, as the Didone's s at that weight always has.

## Sans (against Geist)

Branch `claude/polish-sans`. The goal was to make Draw mode's Sans match Geist
letter for letter from Light (pen 30) through Regular (87) and the heavy weights, and
stay clean up to the slider maximum (260). Each change was checked against the
Geist npm fonts (Thin, Regular, Black and UltraBlack), with the Geist outline
laid over the Draw fill at the same scale.

### Reference weights

Draw's pen is the stem, so each pen is compared with the Geist font that has
that stem: pen 30 with Geist Thin (a stem of 30), 87 with Regular (84), 130
with SemiBold (128), 172 with **UltraBlack** (172) and 194 with Black (194).
The Sans was first built on an older Geist whose Black had a 172 stem; the
current Geist ships that weight as UltraBlack and has added a heavier Black.
Part of this branch had measured the current Black (194) and aimed it at pen
172, which made those letters 12 to 34 units too wide there. They now reach the
current Black at pen 194 (`squaredNow` in `grotesque.ts`) and land on
UltraBlack at 172. Against UltraBlack, the Sans's n and H at 172 are exact.

### What changed

**a.** Rebuilt from Geist's measured Thin, Regular and Black outlines. The
arch, the stem and the spur now sit where Geist's do. The bowl is drawn with
its own heavier pen, as Geist's is: 199 across at the Black on a stem of 194.
Its last quarter thins into the stem, so the counter is a round teardrop whose
right side is the stem, and the bowl meets the stem's round foot in Geist's
notch. The old a had a crushed, square-cornered counter at 172, and a square
butt at 30. Past the Black, the bowl's pen and heights share out the room the
x-height has left, so both counters and the terminal stay open up to 260. The a
also scales with its x-height when it is drawn as the ordinal ª, and it has
the same points on every family master. The right sidebearing now matches
Geist's (19 at the Regular).

**y.** Rebuilt on Geist's measures. The arms lean less as the pen grows, so the
vee closes high over the line at the Black (220) instead of deep in its crotch.
The left arm is cut level just above the line, inside the right arm, with
Geist's small step. The tail makes a short turn into a flat foot. It no longer
ends in a vertical wall with a step, and past the Black the left arm's step
cannot grow into a ledge.

**e.** The ring now runs upright into the end of the bar, so the bar no longer
sticks out past the bowl. Past the Black the foot is cut a little lower, so the
aperture is not a hairline slit.

**s and S.** From a Bold on, these are drawn with a pen that is lighter across,
and each side is widened again by a run that swells past the bowl and closes
onto the spine on a tangent. The counters now have round ends, as Geist's do,
instead of square-ended slots with a notch at the spine. The lower terminal is
no longer a flat slab. Where the spine lies level and no swell fits, the run
stays hidden inside the bowl, so every weight and every family master has the
same points.
The spine is a gentle S-curve, as Geist's is: two arcs that meet in the middle,
steeper where they leave the bowls than through the centre. The s and S
are Geist's width at the SemiBold, UltraBlack and Black, within a few units
(the s was 22 units narrow at pen 130 and 20 at 172).

**O, D and Q.** New Sans O and D on Geist's measures, each drawn with a pen
as heavy as Geist's sides (heavier than its stem) and as light as its crowns;
the Q takes the new O. The plain bowls grew past Geist's with the weight: the
O 21 units too wide at UltraBlack and 33 at the Black, the D 34 and 66. Now
all three are within 7 at every weight, and the D is set at Geist's sides.

**B, C, G, P and R.** Their older measures stood them about 7 units narrow
at the Regular and 20 from the SemiBold to the Black against the current
Geist. Their right sides now stand out by that (the G's spur with its ring),
and all five are within 8 of Geist's width at every weight.

**A, V, W, Y, K and N.** Measured off an older Geist, the diagonal
capitals stood 2 per cent narrow at the Regular and grew 2 per cent too wide
by the Black; the K and N stood narrow throughout. Each is now drawn to the
current Geist's width, within 6 units from the Thin to UltraBlack and 9 at
the Black. The H, M and zero, 9 to 15 narrow at the Regular and SemiBold,
are within 9 at every weight too.

**f, c, j, e and g.** Against the current Geist the f stood 26 units narrow
at UltraBlack (its bar and hook reach further as the weight grows), the c 13
narrow, the j's foot 12 short, the e 12 wide and the g's bowl 7 wide on its
left. Each now reaches Geist's width within 10 at every weight.

**Lowercase bowls and the y at the Black.** The o, b, d, p and q reached their
UltraBlack widths and kept growing, 14 to 16 units wide at the Black; the y
grew 22 wide because its extra width started at 172. The bowls now give up
width until the Black (`HEAVY_GIVE_LOWER` in `common.ts`, which only the Sans
uses), and the y's growth starts at 194. All of them are now within 4 of
Geist at every weight. The fitted round sides then gave back too much as the
bowls narrowed (26 units against Geist's 34 at UltraBlack). The o, b, d, p, q
and e now have Geist's sides listed: 0.52 of the unit off a bowl, and the
stem beside it closing as fast as the n's (a new "stem-left" / "stem-right"
mark in `metrics.sides`). They are within 3 of Geist's sides at every weight.

**Figures past the UltraBlack.** The figures are measured on the capitals'
bowls, which kept growing from pen 172 to 194 faster than Geist's figures
do. At the Black the 2 was 29 units wide, the 6 22, the 3 17 and the 9 15.
Most were also 6 to 8 narrow at the Regular. Each figure now has its own
correction (`figureFit`: a `refit` plus a steeper term between 172 and 194),
and the 1's stem stands a little further out from the SemiBold on. Every
figure is within 5 of Geist's ink width at every weight. The 0 now stands 50
off either side at the Regular (it was 54). The 7 is flush on its right as
Geist's is, and is no longer opened at the Thin, where it stood 10 further
off each side than Geist Thin's (a new "unopened" mark in `metrics.sides`).

**The 5's flag and terminal.** Geist's flag reaches further with the weight
than the bowl under it: 428 units from the ink's left at the Thin, 457 at the
Regular and 546 at the Black. Ours stood at 454, 458 and 494, and now matches
within 2. Its terminal is cut higher at the heavy weights (at 205 at the
Black, against 187), as Geist's is.

**Horizontals at the Black.** Geist's current Black is heavier across than
its UltraBlack: its 3's foot is 168 units against 148, its 5's flag 157
against 142. The letters drawn "lighter across" (the figures, a, g, f, &)
began lightening their horizontals at 172, so at 194 they stood 15 to 25
units light. That lightening now starts at the current Black and is complete
by the same weight as before, so 260 is unchanged.

**The 6 and 9 bowls.** Geist's 6 bowl comes down as the weight grows (its
top at 477 at the Regular and 448 at the Black), and its crown is lighter than
its foot (120 against 149 at the Black). Ours stood at 484 at every weight
with a 152 crown, which left the counter under the hood at 65 units against
Geist's 112. The Sans now draws the bowl as two rings on a pen lighter across,
sharing the crown, one giving the counter and one the outline and foot. The
top and crown now match within 3, and the white under the hood is 101. This is
a new form, "sided", used by the Sans only; the Ribbon and every face that
picks the grotesque 6 keep the single ring. The 5's bowl is drawn the same
way: its crown was 153 at the Black against Geist's 118, and 20 too high.
Both now match within 6 at every weight. The 3 is drawn in pairs too: its
waist was 149 at the Black against Geist's 132, centred 15 units high, and
its top and foot 8 to 10 light. Each bowl is now a pair on a pen as light as
the waist, sharing it, so the top and foot keep Geist's weight. Every band
matches within 4 at every weight. Its top terminal is cut lower as the weight
grows, as Geist's is (its end at 545 at the Regular and 508 at the Black,
where ours stood at 555), and its upper bowl reaches as far left as Geist's
(it was 14 units short at the Black).

**The 6's and 9's terminals.** Geist cuts its 6's hood lower at the Black
(519 against 552). Its 9 is not its 6 turned: the tail is cut lower at the
Thin and the Regular (124 and 140, where the turned 6 cut it at 158) and
higher at the Black (180). Both are now cut where Geist's are. The 6's hood
is held inside the bowl's side at the heavy weights, as Geist's is, and the
9 has its own width fit (Geist's 9 stands 6 units wider than its 6); both are
within 1 of Geist's width at every weight.

**Sides that close as fast as the n.** The listed sides close at a heavy
weight half as fast as a fitted side, as Geist's figures and diagonals do. But
Geist closes the sides of its B, K, L, R, U and its a, c, f, j, l and r as
fast as its n: its B stands 62 off its bowl at the Regular and 43 at the
Black. Closed half as fast, they stood 8 to 16 units loose at the Black and
added up to 36 to the advance. They are now marked "closes". The l's side is
0.3 of the unit, since its foot turns out nearly to its advance as Geist's
does (it stood 16 units loose at every weight), and the K's arm side is 0.04
(12 loose). All are within 6 of Geist at the Regular and the Black. The S, g and y,
fitted, closed too far at the Black (the S to 40 against Geist's 50, the g's
bowl side to 17 against 32), and the question and ampersand, listed, closed
too slowly; they are now listed as Geist's are, within 5. The Y stood 15 units inside
its right side, where Geist's reaches 6 past it; it now stands 2 to 4 inside
at the Regular and heavier, as close as the rule that no letter runs past
its own advance allows. Its left is held inside by the health check's
"touching the letter before it".

**Hyphen, quotes, asterisk and @ at the heavy weights.** Geist's hyphen
deepens to 0.78 of the stem at the Black (152); on the stem's pen ours stopped
growing past 172 and stood 20 shallow. It is now drawn on a pen as deep as
Geist's. The quotes lighten against the stem as Geist's do (1.27 of it at the
Thin, 0.72 at the Black), where a straight-line lightening left them 17 light
at the Black and 9 heavy at the SemiBold; Geist Thin's also stop 20 units
higher. The asterisk no longer widens at the Thin, and grows past the current
Black rather than from 172 (it stood 13 and 22 wide). Its diagonal arms are a
little longer than its level one, as Geist's are, so it is as tall as Geist's
(it stood 14 short). The @'s ring is as light as Geist 1.7.2's (its sides 110
on a stem of 194, where ours were 148), carried out to Geist's width, and the
a's hook runs flush into it. All are within 5 of Geist. The inner a's hook
now turns into the ring low down on its right side, leaving along the ring's
own heading, as Geist's does; it turned at the letter's middle, 80 units
above Geist's. The @'s mismatch against Geist fell by a third at every
weight.

**The diagonals.** Geist's x grows with the pen by as much as the pen at every
weight. The plain x grew 56 units from the Regular to the SemiBold and 43 on
to the Black, so it stood 13 wide at the SemiBold and 11 narrow at the Black.
The plain X stood 19 wide at the Regular and 17 narrow at the Black. The Sans
now draws its own x and X (new "grotesque" forms, the plain strokes at
Geist's widths, measured at its five weights by a new `atWeights`). The k
grows to Geist's width at the heavy weights (17 narrow at the Black). The
slashes widen with the pen as Geist's do (12 wide at the Thin, 25 narrow at
the Black), and their sides close as fast as the n's. All are within 2 of
Geist's width at every weight.

**Widths that swung about Geist's.** The parentheses (14 wide at the Thin),
the question mark (11 wide at the Thin, 16 narrow at the SemiBold), the
ampersand (14 wide at the Thin, 15 narrow at the SemiBold, 11 wide at the
Black), the percent (13 narrow at the Thin, 8 wide at the Black), the S (16
narrow at the Thin), the dollar (17 wide at UltraBlack; Geist's dollar's S is
11 units narrower than its S) and the number sign (14 wide at the Regular)
are fitted to Geist's widths at its five weights with `atWeights`. All are
within 2.

**The x-height at the heavy weights (shared files, Sans only).** Geist's
lowercase grows taller with the weight: its round and arched letters top out
at 542 at the Regular, 546 at the SemiBold, 550 at UltraBlack and 552 at the
Black. Ours stood at 542 throughout, so every lowercase letter was 10 units
short at the Black. The Sans now sets `metrics.xGrows`, and `frame` in
`common.ts` draws the x-height and the bowls' heights that much taller, with
the bowls' widths and the face's own x-height (and so the weight measured
against it) unchanged. The punctuation, hyphen, t, space and the a's and z's
widths keep to the face's own x-height (a new `xOwn` on the frame). No other
face sets `xGrows`, so none changes.

The split cut (shared, `cut.ts`) left a Black g's bowl on its stem at about
one pen in ten, as a hairline of the ring's outside past the knife. The
x-height change moved one of those pens onto 200, which a test samples. The
knife is now trimmed to a sweep of 1.3 of the stroke's pen (it was 1.2), and
the Black g splits cleanly at every pen from 150 to 260.

**Arches at the SemiBold, and the m (shared file, Sans only).** Geist closes
its counters faster midway to its Black than a straight line from its
Regular to its UltraBlack: its n is 9 units narrower at the SemiBold than
that line gives, and on it at both ends. Ours followed the line, so the n,
h and u stood 9 wide at the SemiBold and the m 18. A new
`metrics.counterBend` (in `narrowed`, `style.ts`) bends the line for the
Sans only. The m is drawn with its counters a little narrower than the n's
(a new Sans form), as Geist's are; it stood 20 wide at the Thin. The u, 9 narrow
at the Thin, is fitted too. The n, m and u are within 3 of Geist at every
weight.

**The stops (shared file, Sans only).** Geist's full stop is a tenth taller
than wide at its Thin, square at its Regular and 0.92 as tall as it is wide
at its Black (180 on 196). The Sans's square dots stood 16 too tall at the
Black. A new `metrics.dotAspect` shapes them; a dot on the line keeps its
foot there and one above it its top, so the colon's upper dot stays level
with Geist's. The stops are within 3 of Geist's height at every weight.

**The G's spur.** Geist's spur drops straight to the line and is lighter than
the stem (0.75 of it at the Regular, 0.6 at the Black); its bowl's lower
right runs flush with the spur's right side and falls away from its left
side into a notch just over the line. Ours ran the bowl up into a spur of the
stem's weight, with no notch. The Sans's spur is now drawn on Geist's pen,
with its right side where Geist's is, and the notch is within a few units of
Geist's. Its bar lightens as Geist's does (0.67 of the stem at the Black,
130 deep, where ours was 149) and starts where Geist's does, within 1.

**The l's foot (rebuilt).** Geist's l turns out of its stem on a tail
lighter than the stem (0.88 of it at the Regular, 0.71 at the Black), round a
corner smaller than the stem is wide at the Black (about 164 against 194),
with a small round in the inside corner, the tail running 79 past the stem.
One run on the stem's pen can't draw that: the Black's tail stood 57 too
deep and its corner cut 30 further in. The Sans's l is now four strokes: the
stem, the corner and tail on a round pen as heavy as Geist's tail, the stem's
right side carried down into the tail, and the inside round. It is within 3
of Geist's width and within about 5 of its outline at every weight.

**The 1 (rebuilt).** Geist's 1 has a cove over its flag that carves into the
stem's head (ending 18 units in from the stem's left at the Regular, 40 at the
Black), over a flag lighter than the stem (74 deep at the Regular, 136 at the
Black on a stem of 196). Ours turned the flag up into the stem on the stem's
pen: the cove was half the size and bulged, and the Black's flag stood 60
too deep. The Sans's 1 is now five strokes: the stem up to the flag, the flag
on Geist's depth, a turn up to the cap line on a pen lighter across whose
inside is the cove, the stem's head narrowed to the cove, and a fill for the
corner under the cove that a thin turn leaves open. It overlays Geist's at
every weight, its cove within a few units (15 fuller at the Thin, whose cove
is a little squarer than the drawn one).

**The 2's diagonal.** Geist's 2 falls from its bowl across the letter in a
near-straight diagonal that rounds upright only as it meets the foot. Draw's
came off a deep quarter into an upright reverse turn, an S: 300 units up it
ran 296-353 in from the foot's left at the Thin where Geist's runs 227-297,
124-395 at the Regular against 168-340, and 51-428 at the Black against
107-418. The reverse turn now leans (12 degrees at the Thin, 18 at the
Regular, 26 at the SemiBold, 34 at the UltraBlack and 38 at the Black) and
rounds upright on a short arc as it meets the foot, so the foot has no step
where it meets it. The arc is never tighter than the pen, whose inner side
would fold. The bowl's lower quarter deepens a little at the heavy weights, the
Thin's bowl is as wide as Geist Thin's, the foot runs out as far as the bowl's
right side, and the Sans's diagonal is laid again on a pen half as light
across, as heavy as Geist's (184 across at the Black). Each weight now stands
within 10 units of Geist's 300 up.

**The ?'s neck.** Geist's hook leaves its bowl and rounds into the neck on
a wide turn, the neck's left side leaning from well above the dot. Draw's
turned upright on a tight turn: 350 up its neck ran 247-280 at the Thin where
Geist's runs 291-331, 252-405 at the Regular against 282-407, and at the
UltraBlack, off a full-depth hook, 255-505 against 231-458. The turn is now
twice as wide, the hook leaves its bowl where Geist's does at each weight,
and from the SemiBold on the hook is a tenth shallower, as Geist's is. The
white over the dot is Geist's at each weight (88 at the Regular, 65 at the
UltraBlack, 60 at the Black), measured from the dot's own top, which is less
tall than wide at a heavy weight: the neck stopped 13 to 17 units high there.

**The 5's stem, flag and bowl.** Geist's stem stands 5 to 13 units further
left than Draw's did, and from the SemiBold on it is lighter than the pen
(162 across at the UltraBlack on a stem of 172, where Draw's was 173). The
Sans's stem now has Geist's left side and weight at every weight. Its flag is
as deep as Geist's (30, 84, 113 and 157 at the Thin, Regular, SemiBold and
Black, where it was 28, 81, 118 and 149). Geist Thin cuts the stem's foot at
327 and the bowl's terminal 176 up, where Draw's stood 17 low and 12 high.
The bowl dips 16 under the line, as Geist's does, and its crown stays up at
the heavy weights: 300 in from the ink's left it tops out at 468 at the
Black, where Geist's is at 469 (the older test held it to 452, which the
current Geist Black does not have). Geist's crown also falls away to the
stem faster than a superellipse, leaving a notch between them at the heavy
weights that Draw's bowl does not. The flag's depth and the stem's weight
are held at the Black's past it, where a deeper flag folded on the Wavy
face.

**The 6's and 9's bowls.** Geist's six bowl is lopsided: rounder than a
superellipse at its left, where the hood rises out of it, and fuller at its
right. Draw's was one superellipse at the face's fullness, so 100 up it
started 13 to 16 units left of Geist's and stopped 6 short on the right. The
Sans's bowl is now four quarters, each as full as Geist's (0.25, 0.03, 0.03
and 0.2 anticlockwise from the upper right), and the nine, the six turned,
takes it too. Fitted across the Thin to the Black, this took 10 to 25 per
cent off both figures' misfit against Geist.

**The 6's hood.** Geist's hood is fuller than the face's round from the
Regular on, and fuller over its crown to the right than down its left. At the
face's fullness it stood 9 to 23 units inside Geist's either side 700 up, with
its left side 5 to 10 units in from Geist's. The Sans's hood is now split at
its crown, with each half as full as Geist's. Its cut is found on the fuller
curve, so the terminal still ends 520 up at the Black, and its reach is held
4 units in so the figure keeps Geist's width. The nine's tail, the hood
turned, fits Geist's nine up to a fifth better.

**The s's width at the Thin and the Black.** Draw's s stood 10 units
narrow at the Thin and 14 wide at the Black. The Thin's s is now a fortieth
wider, with its upper bowl's left side 5 units further in, which is where
Geist Thin's is. That took a fifth off its misfit. The width a heavy s gains
is held back from the UltraBlack on. Both now sit within 1 unit of Geist's
width.

**The heavy A and W.** From the SemiBold on, Geist's A's head and W's
vertices are half as wide as the face's measures gave, and its Black's W
strokes are a twentieth lighter than the pen. The A's head is now narrowed
at the SemiBold and UltraBlack, a sixth off its misfit there. At the Black
it keeps the face's own width, where a narrower head grew an extra point
under a chamfer and a spur. The W's vertices are narrowed from the SemiBold
on, a tenth to a fifth off its misfit.

**The y's left arm.** Geist's is lighter than the pen from the Regular
on, most of all at the SemiBold, where it runs 125 across 300 up. That took
a third off the SemiBold y's misfit and a tenth to a sixth off the others'.

**The v's vertex.** Geist's v is a twentieth lighter at the Regular, and
from the UltraBlack on its vertex's feet stand half as far apart: 10 up at
the Black it runs 215-442, where Draw's ran 202-456. That halved the v's
misfit at the Regular and took two fifths off the Black's.

**The w's strokes.** Geist's w is drawn a twentieth lighter than its pen
from the Regular on, and each vertex's feet close up with the weight until
they meet at the UltraBlack. On the full pen, with its feet apart, Draw's
counters ran shallower and the w missed Geist's ink by a seventh from the
SemiBold on. Its width is held at Geist's. The w's misfit is now down by 40
to 45 per cent from the Regular to the Black.

**The tilde and the w.** The tilde's measures were its spine's reach, so
its level-cut ends stood out past it and its ink ran 12 units wide at the
Regular (9 at the SemiBold). Its reach is now fitted so the ink is Geist's
width at every weight. The w stood 11 narrow at the SemiBold and now sits
within 3 of Geist's at every weight. The $'s bar still stops 33 short of
Geist's 800 at the Thin, where the health check holds it.

**The Q's tail.** Geist's tail lightens with the weight, to 137 across at
the UltraBlack on a stem of 172, where on the pen Draw's stood 201. The
Thin's also stood 29 units right of Geist Thin's. The Sans's tail now has
Geist's weight and keeps its right side at every weight, and the Thin's
stands where Geist's does. Past the Black its lightness is held at the
Black's.

**The B's waist.** Like the 3's, its bowls now round into the waist nearly
as circles, so the notch where they meet runs further in, as Geist's does.
That took a fifth off the Regular's misfit.

**The B's, P's and R's bowls.** The same fit against Geist's ink found
their rounds too short as well. The B's two rounds are now a quarter longer
and the P's 1.3 times. The R's is a fifth longer from the Regular on, and
the R's Thin keeps its old round, which fitted better. That took a quarter
off the B's misfit at the Regular and halved the P's at the UltraBlack.

**The D's bowl.** Geist's D runs flat along its lines further than Draw's
did before it turns: 690 up it reaches 429 at the Thin, where Draw's turned
at 385. Its round is now 0.9 of half its height rather than 1.05, on a fullness of
0.15 (the sided pen's own is fuller at the Thin, which put a fifth of its
ink back off). That took
the D's misfit against Geist from a fifth of its ink to a twentieth at the
Thin, and to half or less at every other weight.

**The comma's tail (shared file, Sans only).** Geist's tail leaves the
dot's foot near its right corner and gets heavier and more upright with the
weight. Draw's left from the middle of the foot, so 40 under the line it
stood 12 units left of Geist's at the Regular and 21 to 35 at the
UltraBlack. It is now within 3 units of Geist's at every weight, and it
is cut level along the dot's foot, with its right side running out of the
dot's corner. Cut square across itself at the dot's middle, its corner
stood out past the dot's side as a spur from the SemiBold on.

**The 7's stroke.** It lands upright on one arc from under the arm. It
landed at one place for every weight, so it stood 14 units right of Geist's
near the foot at the Regular, 26 at the Black, and 12 left of it under the
arm. Its landing is now fitted to Geist's ink at each weight: further right
at the Thin and further left from the Regular on. That halved its misfit at
every weight from the Regular to the Black and took three fifths off the
Thin's. Geist's stroke is also lighter where it leaves the arm at the heavy
weights: 550 up at the Black it is 186 across, where Draw's is 221.

**The 4's stem.** It stood 7 to 9 units right of Geist's at every weight,
with its bar running 81 past it where Geist's runs 86. Both are now Geist's,
which took a third to three fifths off its misfit.

**The t's foot.** Geist's t turns out along its foot more tightly than the
first measures gave: 150 in, its Regular's stem comes down to 57 before it
turns, where Draw's turned at 78. The Sans's turn is now 0.85 of the first
measure at the Thin, 0.75 at the Regular and 0.6 from the SemiBold on. That
took a third off the t's misfit from the Regular to the Black and four
fifths off the Thin's. Geist also sets its heavy t and f 6 to 8 units closer
on the left than its n's rate gives.

**The f's bar and hook.** Geist's f's bar and hook crown are lighter than
the face's horizontals at the Regular and the SemiBold: 74 and 99 across,
where Draw's stood 81 and 117. Its bar also sits at 534 at the SemiBold and
538 at the UltraBlack, then drops to 506 at the Black. Both are now Geist's,
which took a fifth to two fifths off the f's misfit from the Regular to the
Black.

**The x's top.** Geist's x is a little narrower across its top than its
foot up to its SemiBold (520 up at the Regular it runs from 65 to 522,
where Draw's ran from 55 to 531), and its Thin's strokes are a tenth
lighter than the pen. Both are now Geist's, which took two fifths off the
Thin x's misfit and a quarter off the Regular's.

**The K's arm.** From the SemiBold on, Geist's K's arm leaves the stem
lower, so its leg stands where Geist's does (364-558 200 up at the
UltraBlack, where it stood at 343-543). That halved the heavy K's misfit.
The arm's foot now shows a little beside the stem under the leg, where
Geist's arm meets the stem higher on a steeper line.

**The k's arm and leg.** Geist's arm leaves the stem higher than the first
measures gave, and from the SemiBold on its leg leaves the arm a little
higher too. Low on the stem, the Thin's arm stood 21 units right of Geist's
250 up, and a heavy arm's foot showed as a tooth beside the stem under the
leg. Both are now fitted to Geist's ink at each weight. That took five
sixths off the Thin k's misfit and a third off the heavy weights'.

**The Thin W.** Geist Thin's W sets each vee's feet closer in: 20 up they
run 236-294 and 621-679, where Draw's stood at 225-276 and 646-697. Its
Thin is now a hundredth narrower with the feet 13 units further in, which
took its misfit against Geist from a half to an eighth.

**The Thin M and Z, and the R's waist.** Geist Thin's M starts its
diagonals further in from the stems' heads and is a little narrower: Draw's
stood 8 units outside Geist's all the way down, a third of its ink off.
It now misses by a twenty-fifth. Geist Thin's Z is a fortieth narrower than
Draw's was, and it now misses by a twelfth where it missed by a fifth.
Geist's R sets its waist a little lower, most of all at the light weights,
which halved the Thin's and the Regular's misfit.

**Heavy s counters.** The lighter pen that rounds them now takes its
lightness mostly from the crowns and spine rather than the sides, as Geist's
weight is set: at the Black the counters are narrow and tall (about 95 across
and 60 high, against Geist's 92 and 70) instead of 150-by-60 slots with the
weight in the spine. The bowls are carried out by what the crowns give up, so
the letter keeps its height. Past the Black the sides take the lightness back,
so the counters' ends stay round up to 260.

**@.** The ring is as wide as Geist 1.7.2's at every weight: it was 31 units
narrow at the Thin, whose ring stands further out than the Regular's, and 24
at the UltraBlack. The tail now runs round to where Geist's ends, found by where
it is across rather than by a height. The ring also reaches Geist's 710 at every weight; it stopped 27 short at
the Thin, and hung 18 short of Geist's foot at 172.

**8.** Heavy weights use the same lighter pen plus a slightly wider ring, so
the upper counter stays an oval past the Black instead of a slot. The rings
also swell outward by up to 12 units a side, to the weight of Geist's sides
(heavier than its stems). The eight is now Geist's width at 130, 172 and 194.
It was 30 units narrow at 130.

**^.** New Sans caret, measured off Geist: narrow and upright, with a level head
on the cap line and level feet at 383. The plain one was a wide, low chevron.

**%.** Re-measured against the current Geist. The rings are taller and heavier,
the lower ring sits in the right place, and the slash leans as Geist's does.
Past the Black the crowns stop getting heavier and the rings move apart, so the
counters stay open at 260.

**#.** The bar ends are cut along the lean of the uprights, as Geist's are.
Light weights no longer spread wider than Geist Thin.

**[ ] { }.** New Sans brackets and braces, measured off Geist. The brackets
are 240 wide at the Regular and 346 at the Black, from 750 down to -110. The
plain bracket's arms were a fixed share of an arch, so from the Black on the
stem swallowed them and the bracket set as a solid bar. The braces have round
turns into a short level nose, where the plain brace came to a sharp beak.

**\ + < > = _ ~.** New Sans forms, on Geist's measures at the Thin, Regular
and Black. The backslash is the Sans slash turned round. The plus is as tall
as it is wide (it was a third smaller and hung low). The less-than and
greater-than have shallow arms, cut upright, meeting in a short flat. The
equals bars are longer and further apart. The underscore is twice as long.
The tilde is two equal arcs cut level. Past the Black the plus and the angles
grow as they get heavier, and the tilde spreads more than it thickens, so all
of them stay open at 260 and the tilde keeps round turns without a wedge at
its end.

**( ).** The sidebearings now match Geist's: 45 on the opening side and 15 on
the closing side.

**: ;.** The upper dot now sits at Geist Regular's height (506). The old code
had a mis-measured 0.87 of the x-height there.

**Spacing.** W, X, Y, T, O, Q, !, | and & and the 4, 6, 7 and 9 now stand where Geist
1.7.2 sets them, within a few units at the Regular and the Black. The W was 17
units too close on each side. The T, X, Y and 7 were 12 to 26 too loose, and
the 6 and 9 were 10 to 20 too loose. The O closed to 25 at the Black, where
Geist's stays at 40. Three are held a little off Geist so the shared checks
still pass: the Y sits 6–9 inside its advance (Geist reaches 6 past it), the T
at 15 (Geist 12) so the A–T kern still closes, and the 7 at 8 (Geist 0).
`geist.test.ts` had Geist's T at 25; every other number in that test matches
the current Geist, whose T is 12, so the line is corrected.

**Light widths.** The face widens its light letters as Geist Thin's o and n
are widened. The r's arm, the A, v, w and G, and the figures took that widening
on top of their own, and at pen 30 were up to 48 units wider than Geist Thin's
(the r 48, the A 22, the G 30, the 7 26). Each now matches Geist Thin's width
within about 7 units. The k, which Geist Thin draws a little wider, now is too.

**Grave and acute.** New Sans forms on Geist's measures: steep, cut level
at both ends, 128 tall and 160 across at the Regular. The plain ones lay
nearer level. The accented letters now wear them too. `build.ts` (shared)
draws an accented letter's mark in the face's own form of it whenever the
letter is drawn with forms at all. Faces that list no form for their marks
are unchanged.

**Circumflex, dieresis and tilde accents.** New Sans forms on Geist's
measures. The circumflex is the caret's shape with a level head over level
feet (the plain one came to a point). The dieresis dots are cut square,
larger and further apart. The tilde is the same two-arc wave as the ASCII
tilde, smaller.

**| and &.** The bar now runs from 110 under the line to 750, as Geist's
and the brackets do; it stood from the descender to the cap line. The
ampersand is 690 across at 172, UltraBlack's width. It was 678.

**$.** New Sans dollar: the S with Geist's bar, light at every weight (74
across at the Regular, 86 at the Black) and running from 90 under the line
to 800, held a few units inside the health check's allowance. The plain bar
stood out only 53 and was nearly the stem's weight. The dollar also stands
at Geist's 55 off either side; the fitting had set it at 44 and 34.

**Accent places (shared files, off for other faces).** Geist stands its
accents 55 units over a lowercase letter and 66 over a capital. The shared
gap was 28 and 13. It also sets a steep grave or acute with its foot over the
letter's middle, where centring the whole mark put it half its lean to one
side. The Sans asks for both through a new, optional `metrics.accents`, which
`gapFor` and `build.ts` read. The marks that hang below, such as the cedilla
and ogonek, keep the shared gap. Faces that do not set it are unchanged.

**Spacing across the weights (shared files, Sans only).** A survey of
every glyph found the Black drifting: stem capitals 4 units a side loose,
the signs 6 tight, the hyphen 8 loose. At the Thin, the right sides of B, E,
F, L, P and R were 11 to 16 loose. Four changes fix this:

- A capital's extra room now closes as the sidebearing does and as fast
  again (`metrics.capitalCloses`). Geist gives its H 12 more than its n at
  the Regular, 7 at the UltraBlack and 6 at the Black.
- A listed side can be `"held"` at the Regular's at every weight. Geist
  holds its + = < > ^ ~ 40 off, and hardly closes its round and diagonal
  capitals (O Q S C G A V W Z).
- A listed side can carry a move at the Thin, which goes with the face's
  light opening. This covers Geist Thin's closer B E F L P R T and the
  looser backslash.
- The hyphen and underscore close as fast as the n.
- The v, w and y stand 3 units closer at the Thin, and the e closes as fast
  as the n; they stood 3 loose at the Thin and the e 5 loose at the Black.
- The %, * and square brackets close as fast as the n. Half as fast, they
  stood 8 to 16 units loose at the Black. An older test held the % to 864
  wide at the UltraBlack; Geist's is 833, and ours is now 833.

The Y's left moves to 0, the closest the health check's "touching the
letter before it" allows at 175 once the extra closes faster. The O, H, E,
+ and hyphen now stand within 2 units of Geist's from the Thin to the Black.

**Spacing at the Light (shared file, Sans only).** Geist Thin sets its
letters about 5 units further off either side than its Regular, and its
figures 10. The Sans kept the Regular's spacing all the way down. It now
opens by `metrics.lightHeld.open` as it thins, applied where `build.ts` fits
a letter's sides. Only the Sans sets `lightHeld`, so no other face changes.

**Light P and F.** The P's bowl now closes lower at the light weights, as
Geist's does. It had closed 11 units high at the Thin and 14 at the Regular;
the change takes the P's misfit from 0.27 to 0.12 at the Thin and from 0.07 to
0.02 at the Regular. The Thin F's bar was 6 units low and now sits 6 higher,
which takes its misfit from 0.27 to 0.18. Both changes are gated to the Sans.

**Heavy contrast (shared files, Sans only).** Geist's horizontals thin
quickly from the Regular and then level off. Its o's crown is 92 on a stem of
106, 104 on 128, 116 on 150, 129 on 172 and 144 on 194. Ours followed
`blackness` in a straight line, so the crowns came to 100, 116, 125, 131 and
137: too heavy through the middle weights and too light at the Black. A new
Sans metric, `contrastRise` in `style.ts`, gives the heavy pen a contrast that
rises with the pen and levels off. The crowns now come to 97, 107, 118, 131
and 144. The H's bar comes to 112 and 155 at 128 and 194, where Geist's is 113
and 157. The bowls are still sized by the old contrast (`Pen.sized` in
`types.ts`, read by `frame` in `letters/common.ts`), so every letter keeps the
widths it was fitted to. Letters that had made up for the old pen were
refitted:
- The e's ring is a little lighter than the o's at 172 and 194, as Geist's is
  (122 against 129, and 134 against 144). It is let out by the same amount, so
  its eye at a pen of 200 stays half a stem open.
- The f's bar needs less extra contrast at 130.
- The five's flag depth and the w's width are refitted to the new pen.

The mean misfit falls from 0.075 to 0.070 at 130 and from 0.059 to 0.056 at
194. Only the Sans carries the metric, so the other faces draw exactly as
before.

**The e's shoulders.** The e's upper half had been drawn as a squat quarter
over the bar. Its shoulders stood 12 to 17 units outside Geist's on either side,
450 units up. The Sans now draws the left quarter around the bowl's own centre,
as the o's is. From the Regular on, the right quarter is drawn the same way; at
the Thin it stays over the bar, where Geist's does too. The e's misfit falls
from 0.197/0.090/0.079/0.056/0.046 to 0.178/0.060/0.056/0.031/0.025 at the
Thin, Regular, SemiBold, UltraBlack and Black. The test that the bar's end
drops straight into the right side now allows Geist's own 8 units at the
Regular and 14 at the UltraBlack.

**The five's bowl.** The five's bowl is now rounder than the face's other
bowls, and a little fuller at the Black, as Geist's is. Its misfit falls from
0.166/0.053/0.047/0.039/0.039 to 0.155/0.041/0.042/0.038/0.038 at the Thin,
Regular, SemiBold, UltraBlack and Black. It keeps its 26 nodes. Geist's heavy
bowl is also fuller at the upper right and leaner at the upper left. Drawing
that quarter separately would follow it, but at twice the nodes, so I left
it.

**The e's tail.** The e's terminal is now cut lower: 8 units lower at the
Thin, and 4 lower from the Regular to the UltraBlack. At the Thin its tail
also rounds fuller, as Geist Thin's does; there it had stood 15 units over
Geist's. The e's misfit falls from 0.178/0.060/0.056/0.031 to
0.123/0.057/0.053/0.029 at the Thin, Regular, SemiBold and UltraBlack. The
Black is unchanged.

**Slashes and the z.** Geist's slash, backslash and z diagonal are lighter
than its stem: about a tenth lighter at the Regular, and a little lighter at
the heavy weights. Drawn on the full pen, ours carried a seventh more ink
than Geist's at the Regular. Each now draws its diagonal lighter, and the
slashes run a few units further across to keep Geist's widths. At the
Regular the slash's misfit falls from 0.14 to 0.025 and the z's from 0.098
to 0.072.

**Parentheses.** Geist's parentheses taper towards their ends. Ours were one
weight all along, so they carried a tenth more ink than Geist's. The Sans now
draws each parenthesis as two arcs of a lighter pen that share their end
cuts. One arc runs on the inner line; the other bows out to the full weight
at the middle. The ends are two thirds of the middle's weight at the Thin and
three quarters from the SemiBold to the Black, and the taper eases off past
the Black, where the bowed arc's inside would fold. Each arc is split at its
middle, so every weight and family master has the same nodes (6+6). The
misfit of ( falls from 0.23/0.12/0.11/0.10/0.09 to 0.14/0.04/0.04/0.02/0.02
at the Thin, Regular, SemiBold, UltraBlack and Black.

**The heavy percent.** From the SemiBold on, the % now draws its rings, their
crowns and its slash lighter, as Geist's are. At 128 its ring sides had
stood 103 against Geist's 94, and its slash 101 against 88. The rings also
reached 4 units past both lines; they now stay within them. Its misfit falls
from 0.12/0.07/0.12 to 0.05/0.06/0.07 at the SemiBold, UltraBlack and Black.
At the Black the lower ring still sits 10 units left of Geist's.

**Brackets.** The Sans's square brackets are now drawn with a sided pen, as
the D is. Their stem and bars are lighter than the pen, as Geist's are. At
128, Geist's stem is 122 and its bars 102, where ours had stood 130 and 107.
At the Thin the stem is a little heavier than the pen, 32 against 30. From
the SemiBold on the arms are a little longer, and the bars sit on the lines.
The ] misfit falls from 0.13/0.21/0.18/0.17 to 0.009/0.010/0.009/0.004 at the
Regular, SemiBold, UltraBlack and Black.

**Grave and acute.** Geist's grave and acute are wedges: wider at the top cut
than at the foot. The Sans now draws each as two strokes of the foot's width
that meet at the foot and spread apart at the top. The spread is two fifths
at the Thin (a fifth for the acute) and a tenth at the Black. At the
SemiBold the cut is also 4% wider. The grave's misfit falls from
0.20/0.15/0.20/0.10/0.12 to 0.04/0.002/0.09/0.06/0.09 at the Thin, Regular,
SemiBold, UltraBlack and Black. The acute's falls from 0.15 to 0.005 at the
Regular, and by about a third at the heavy weights; at the Thin it is
0.03, where it had been 0.08. Every accented letter built on them improves
slightly.

**Accents over heavy letters (shared files, Sans only).** Geist sets its
accents closer over a heavy letter: 55 units over a lowercase letter at the
Regular but 33 at the Black, and 66 over a capital at the Regular but 47 at
the Black. Ours kept the Regular's gap at every weight, so at the Black an
é's acute stood 22 units high. A new optional `accents.heavy` metric in
`style.ts`, read in `build.ts`, runs the gap in towards the Black's as the
weight grows and holds it past the Black. Only the Sans sets it. The feet of
é, è and á now sit at 585–589, where Geist's are.

**The f's stem.** At the Regular and the SemiBold, the f's stem, hook and the
right end of its bar had stood 6 to 9 units right of Geist's. The stem now
stands 6 units further left, and the bar still reaches as far left as before.
The f's misfit falls from 0.099 to 0.014 at the Regular and from 0.079 to
0.036 at the SemiBold. At the UltraBlack and the Black its shape already
matched; there its left side is spaced 6–7 units wider than Geist's, which
the sides table cannot close faster than the n's.

**The dollar's S.** Geist's dollar draws its S a little shorter than its
capital S. Ours used the S at its own height, so its top stood about 16 units
over Geist's. The S in the $ is now drawn 16 units shorter from the Thin to
the SemiBold, and 8 shorter from the UltraBlack on. The $'s misfit falls from
0.33/0.20/0.13/0.12/0.10 to 0.20/0.15/0.10/0.11/0.10 at the Thin, Regular,
SemiBold, UltraBlack and Black.

**The heavy a's bowl.** From the Regular on, the a's bowl is now lighter along
its crown, as Geist's is. Its join to the stem sits lower at the heavy
weights and a little higher at the light ones. The a's rule for widening
past the Black now starts at Geist's Black (194), not its UltraBlack. The
a's misfit falls from 0.19/0.11/0.10/0.11/0.12 to 0.18/0.10/0.07/0.08/0.09 at
the Thin, Regular, SemiBold, UltraBlack and Black. At the Black its bowl's
top still stands 14 units over Geist's.

**The r's arm.** Geist's r arm leaves the stem lower than ours did, most of
all at the Thin: 390 up there, where ours left at 335. The Sans's arm is now
drawn a little heavier where it leaves the stem (1.2 of its old pen at the
Thin, 1.05 from the SemiBold on), and its turn is deeper and wider. At the
Black the turn is deepened only 10, so the chamfer-and-spur test's r at 200
still grows one point. The r's misfit falls from 0.28/0.09/0.07/0.05/0.07 to
0.08/0.07/0.05/0.04/0.06 at the Thin, Regular, SemiBold, UltraBlack and
Black.

**The n, m and h shoulders (rebuilt).** Geist's arch leaves the stem about
435 up, thinned, in a notch, and its crown is centred right of the arch's
middle. The Sans now draws its own n, h and m arch (`sansArch`). Its first
quarter is drawn on an elliptical pen that is thin across and full along. It
leaves the stem a quarter of the pen wide (seven tenths at the Thin), with its
inside flush with the stem and its outside diving into it. It reaches the
crest at the crown's own weight, so it joins the second quarter without a
step. The first quarter is also a little deeper than the second, and the
crown sits about half a pen right of the middle. The second quarter's leg
starts from where that quarter actually ends, so every weight keeps the same
nodes. The misfits fall:
- n: 0.25/0.09/0.06/0.05/0.06 to 0.14/0.06/0.03/0.03/0.04;
- h: 0.18/0.09/0.05/0.04/0.05 to 0.11/0.06/0.03/0.02/0.03;
- m: 0.21/0.11/0.08/0.08/0.09 to 0.14/0.06/0.05/0.04/0.06;

at the Thin, Regular, SemiBold, UltraBlack and Black.

**The u's trough.** Geist's u is its n turned over: its trough rises into
the stem thinned, in a notch, so 40 units up there is white between the two.
The Sans's u now draws its last quarter on the same thin-across pen as the
n's first, with the same measures turned over. The side runs down to where
the round actually begins, so the points stay the same past the Black. The
u's misfit falls from 0.16/0.11/0.05/0.06/0.05 to 0.05/0.08/0.03/0.04/0.03 at
the Thin, Regular, SemiBold, UltraBlack and Black.

**The b, d, p and q bowls.** Geist's bowls meet their stems in notches at
the top and the foot. The Sans's b, d, p and q now draw their bowls with the
two quarters beside the stem on the n's thin-across pen, flush with the stem
inside and diving into it outside (`sansStemBowl`). The far half keeps the
pen. The join is seven tenths of the pen at the Thin, a little over half at
the Regular, a quarter to three twentieths from the SemiBold to the
UltraBlack, and two fifths at the Black, which is where each fitted Geist's
ink best. The misfits fall:
- b: 0.12/0.06/0.06/0.06/0.06 to 0.11/0.04/0.04/0.04/0.06;
- d: 0.12/0.06/0.05/0.08/0.08 to 0.13/0.04/0.03/0.07/0.08;
- p: 0.11/0.06/0.06/0.06/0.06 to 0.10/0.04/0.04/0.04/0.06;
- q: 0.12/0.06/0.05/0.07/0.08 to 0.11/0.04/0.03/0.06/0.08;

at the Thin, Regular, SemiBold, UltraBlack and Black. The d is a hundredth
worse at the Thin.

**Thin capitals and figures (shared file, Sans only).** Geist Thin draws its
capitals and figures on stems of 32, where its lowercase stems are 30. A new
Sans metric, `capitalThin` in `style.ts`, makes `capitalled` draw capitals
and figures up to 6.7% heavier at the Thin. The gain runs in from nothing at
the Regular. Across the capitals and figures, the Thin's mean misfit falls
from 0.179 to 0.153.

**The Thin H's bar** now sits 7 units higher, where Geist Thin's does.

**The Thin s.** At the Thin its foot is now cut 20 units lower and its
spine's quarters are taller, as Geist Thin's are. Its misfit falls from 0.33
to 0.28. The rest is in the spine's shape (see "The heavy s" below, which is
the same difference at the other end).

**The g's bowl** now meets its stem in Geist's notches too, on the same
construction as the d's (`sansStemBowl`, which now takes the bowl's own width
and height). The g's misfit falls from 0.17/0.09/0.08/0.07/0.08 to
0.16/0.08/0.06/0.06/0.08 at the Thin, Regular, SemiBold, UltraBlack and
Black.

**Heavy t and f sides (shared file, Sans only).** A side entry in the sides
table can now take a fifth element: units added to either side at the Black
(a `blackness` of 0.88), run in with the weight and held past it
(`build.ts`, `style.ts`). The Sans's t and f use it to close their left sides
7 to 8 units further at the Black, as Geist's do; the sides table's closing
at the n's rate had left them that far out. The t's misfit falls from 0.07
to 0.02 at the UltraBlack and from 0.10 to 0.03 at the Black, and the f's
from 0.06–0.07 to 0.02–0.03. This replaces the heavy-f spacing entry in
"What still differs".

**Health check (shared file).** The "Reaching past the line" warning now allows
the larger of a pen's width and 0.06 em. A Light Sans was reporting ( ) / $ ç ą
ę ş ų ș, which Geist Thin carries just as far past its lines as its Regular
does.

**Slant.** At slant 12 the oblique keeps the upright's advances and kerning for
r g f o E S y and the figures. I checked this numerically and added a test to
hold it.

Tests: `geist-weights.test.ts` and `health.test.ts` have new checks (the a's
notch and counter, the y's vee and foot, the e's right side, the s and 8
counters, the Light warnings, the slant spacing). Each one fails on the old
code. Some older s tests used an even-odd ruler that reads two overlapping
strokes as white; they now use a filled (nonzero) ruler.

**Overhangs: Y, j, #.** Geist hangs these past their own sides. The Y is 6
and 4 past at the Regular and 9 and 7 at the Black, the # 10 and 5 at the
Regular, and the j's foot 5 under the letter before. The health check's
"touching the letter before it" forbade any of that, so all three were held 8
to 12 inside. That spacing was their whole misfit. A face can now list letters
in `metrics.overhangs` with how far each may hang, and accented letters take
their base letter's allowance. The Sans lists these three, up to 12
thousandths of the em. Their sides now land within 2 units of Geist's at every
weight, and their misfit at the Regular is 0.02 (Y), 0.04 (#) and 0.06 (j).
The sidebearings test now carries Geist's real values for all three, which
the old spacing missed by 13 to 18 units.

**The Thin j.** Its foot reached 127 past the stem's left edge, against Geist
Thin's 120. Its turn was also wider: an outside radius of about 123 to Geist's
99. Both were Regular measures carried down to the Thin. The turn now tightens
and the foot shortens toward the Thin. The Thin j's misfit went from 0.35 to
0.03, and its sides and advance now match Geist's to the unit.

**The ! and the stops.** The `!` stem stopped at 225 on the light weights,
and kept a fixed height over its dot on the heavy ones: 274 at the Black. Geist's
reaches 205, 220, 235 and 242 from the Regular to the Black, and stands 2 to 4
units right of its dot's middle. The Sans's does both now, and its misfit went
from 0.04–0.11 to 0.01–0.03. The square full stop was fitted to an older
Geist and stood 3 small at the Regular (110 to 113). Its size is now fitted to
the current one (59, 113, 146, 180), for the Sans only. The . , ' sat 2 to 4
units loose on both sides, and the : ; 2 to 4 loose from the SemiBold up. All
of them now sit within 2 units of Geist's at every weight.

**The @.** Geist's ring is not an oval. Its outside is widest 262 units up
on the left and 340 on the right, so it is fuller under its middle on the
left and fuller over it on the right. Draw's single oval stood 35 units out at
the Regular's upper left, 34 in at its lower left and 24 in at its upper right.
The ring is now four pieces, and each meets the next where both run level or
upright:
- from the stem's landing over to the top, round a middle 355 up;
- down the upper left as a circle into a straight side, as Geist's is;
- round the lower left, round a middle 210 up;
- round to the tail, again round the right's middle.

The tail now climbs to its end as Geist's does. With the ring drawn that way,
the stem lands on it 60 units lower (137 at the Regular). The Thin's parts are
a stem and more across, as Geist Thin's are (they were 0.87 of it), and its
inner a is larger and further left. Its sides are 4 units closer. The misfit
went from 0.79, 0.29, 0.23, 0.21 and 0.18 (Thin to Black) to 0.35, 0.16, 0.12,
0.10 and 0.10.

Building it from four pieces first gave 48 empty pieces where they met.
`bowlBetween` keeps the pieces a partial bowl does not reach, at no length, so
the node count stays the same across weights. The ring now drops those empty
turns and keeps its straight runs. It has 26 segments at every weight from 30
to 260 (as before), none crossing, and passes the family's weight-axis check.

**The Thin &.** Its loop came down its right side 90 units further than Geist
Thin's before turning into the crossing, so the crossing ran flatter and 57
units out at 450 up. The Thin's loop is now 20 shorter and 5 further left,
and its bowl 10 further right. The Thin's misfit went from 0.51 to 0.30. The
Regular and heavier weights are unchanged; there, neither change helped.

**The s's bowls.** The Sans's s was still set to an older Geist's bowls. The
current one's upper bowl sits 5 lower and is 10 narrower at the Regular, and
10 lower at the Black. Its lower bowl sits 15 higher at the Regular and 5
higher at the Black. The turns inside both are rounder: the corner share
rises from 0.42 to 0.52, and to 0.8 at the Black. At the Regular the upper
counter reached 45 units too far left. The misfit went from 0.16 to 0.10 at
the Regular and from 0.14 to 0.12 at the UltraBlack, a little better at the
Thin and the Black. Only the Sans changes: the Geometric shares this s, and
its Black s narrowed past its limit.

The crossing check for rebuilt letters now covers the @ and the & as well.

**The S's and the $'s bowls.** These were refit as the s's were. The upper
bowl is 15 lower and 10 narrower at the Regular and 10 lower at the Black; the
lower bowl is 15 and 10 higher. The S's misfit went from 0.26, 0.15, 0.11 and
0.14 to 0.22, 0.12, 0.08 and 0.13 (Thin to UltraBlack); the Black's is 0.12,
from 0.11. The $, drawn on the same S, improved at every weight.

**The O's overshoot.** Geist's O overshoots its lines by 16, not the o's 12.
A face can now give single capitals their own amount (`metrics.overshoots`),
and the Sans gives the O 16. It now stands at Geist's height at every
weight, and its Thin misfit went from 0.26 to 0.14 (the Ö's from 0.28 to 0.16).

**The Q.** Geist's Q ring is 6 or 7 units narrower than its O (643 against
649 at the Regular) and overshoots 16, as the O does. Ours used the O's ring
at the o's overshoot, so it stood 7 wide and 4 low. It now narrows by weight
and overshoots 16. The overshoot moved the tail right with the ring (it is
placed in the letter's own units), so the tail is set back 7 to 9 units and
lands within 2 of Geist's at every weight. The misfit went from 0.24, 0.09,
0.05 and 0.04 to 0.12, 0.07, 0.04 and 0.02 (Thin, Regular, UltraBlack,
Black); the SemiBold's is 0.09, from 0.08.

**The last five: A, ", ?, G and 9.** Surveyed after the merge into the
integration branch, these stood worst at the Thin. The misfit below is the
area where Draw's ink and Geist's differ, over Geist's ink (Thin, Regular,
SemiBold, UltraBlack, Black).
- **A.** The Thin's right leg stood 4 to 7 units right of Geist Thin's and
  its bar 5 low. 0.224 at the Thin to 0.071; the rest unchanged.
- **" and '.** The feet stood 3 or 4 units high at every weight and the
  Thin's pair 6 too far apart. 0.235/0.075/0.076/0.077/0.056 to
  0.063/0.069/0.072/0.068/0.057.
- **?.** Geist's hook leans in from its terminal: the terminal is the
  hook's leftmost point, and the stroke already rises to the right there.
  The left half is now drawn round a lower middle, on an ellipse's quarter.
  0.260/0.103/0.088/0.066/0.076 to 0.182/0.056/0.065/0.043/0.058.
- **G.** The Thin's bowl is 8 wider with its left side held, its terminal
  cut 12 lower and its bar begun 12 further left. 0.249/0.082 to
  0.162/0.079 at the Thin and the Regular.
- **9.** Its bowl's lower left is rounder at the Thin and fuller from the
  SemiBold on, its tail 12 shorter at the Thin, and its bowl's foot lighter
  at the heavy weights. 0.260/0.078/0.076/0.093/0.101 to
  0.197/0.078/0.075/0.082/0.087.

The Q was checked against Geist after its refit and needed nothing more:
0.120/0.066/0.088/0.047/0.022.

### What still differs from Geist

- **s counters at the Black.** Close to Geist's size and shape now; Geist's
  upper counter still runs a little more into the terminal, as a teardrop.
- **8's waist.** Now as wide as Geist's, with the same waist and counters,
  but Geist's waist is notched 135 units in either side at the Regular (150 at
  the Black). Draw's two stacked rings are notched 90 (75). Geist's strokes
  cross in an X there. Rounder rings deepened the notch only to 109 and left
  lemon-shaped counters. Pulling the rings apart matched the notch but made the
  waist half as thick again. Matching it needs the eight rebuilt as crossing
  strokes.
- **The 3's notch.** Geist's bowls meet on the right in a sharp corner, 123
  units in from the bowl's right at the Regular, its upper bowl thinning into
  it. Draw's bowls are strokes on one pen, meeting the waist on a tangent.
  Their quarters on the waist side are now nearly circular, which took a
  sixth off the misfit at the Thin and the Regular, but the notch still
  stands about 40 units out at the Regular and 60 at the Black. Rounder
  quarters, quarters drawn round a centre further in, and taller bowls cut
  at the waist did not deepen it; it needs a stroke that tapers into a
  corner.
- **The @'s ring.** Geist's ring leans (its top stands 78 units right of its
  bottom at the Regular), and its hook thins to the ring's weight as it
  turns. Draw's ring is an upright superellipse and its hook keeps the
  stem's pen, so the ring's left third stands about 17 units high and the
  hook about 28 heavy. A leaning ring needs a spine of arcs fitted to a
  sheared ellipse.
- **The ?'s terminal.** Geist cuts its hook's left end on a slant, so its
  lower corner stands in from Draw's level cut 500 up. The hook now leans
  in from the terminal as Geist's does (see above), but the cut is still
  level.
- **The 6's hood and the 9's bowl.** Geist's hood is a little lighter than
  Draw's at the heavy weights (165 across 500 up at the UltraBlack against
  175). At the Black the 6's lower left still stands 10 to 14 units out
  past Geist's, and the 9's upper right 17 to 23: rounder quarters, down to
  a circle's, and a bowl tilted up to 12 degrees either way took less than
  a twentieth more off.
- **Heavy b, d, p and q.** Their bowls now meet the stem in Geist's
  notches (see above). Geist's counter is still rounder than its outside at
  the UltraBlack and the Black, so its crowns are heavier near the right
  corners; the d and the q still miss Geist's ink by 0.07 to 0.08 there.
- **The heavy s.** From the SemiBold on, Geist's s has a thin diagonal
  spine and teardrop counters. Draw's has a level spine and counters flat
  where they meet it. It covers Geist's to within 13 to 19 per cent of its
  area.
- **The Thin &.** Its lower bowl is now a little wider at the Thin and
  its sides open with the face's light opening. It still misses Geist
  Thin's ink by half, and 87's by a seventh. Geist's loop is wider at its
  crown and narrower where it crosses, and its arm is shorter. That needs
  the loop drawn on two widths.
- **The ~'s middle.** Geist's wave is 20 units lighter than Draw's where it
  crosses the middle (108 against 128 at the Regular), while its crests match.
  A pen held at an angle took off almost nothing, because the difference is
  in the path.
- **The five's bowl at the Black.** Geist's heavy bowl is fuller at its upper
  right and leaner at its upper left. It still stands 26 units inside Geist's
  shoulder at the Black. Drawing that quarter separately follows it, but at
  twice the nodes.
- **Round capitals' overshoot.** Geist's round capitals and figures (C G S 0
  3 6 8 9 &) overshoot 16 units past each line, where its o overshoots 12.
  Draw uses 12 for them, so they stand 8 units short overall. Only the O
  has 16 now (see below). Tried again after the refits, 16 for all of them
  still made most of them fit worse (the Thin's mean for capitals and
  figures went from 0.13 to 0.17). Their curves and apexes are measured from
  the lines at 12.
- **Past 194.** Geist has nothing heavier than its Black. At 200–260 the
  letters follow their own rules for keeping counters open, not Geist.
- **œ.** Not in the review list, and it is still poor past the Black: its o
  counter closes to a crescent. It uses the plain construction, not the Sans
  letters.
- **Ordinal ª.** It now has the right proportions, but past about 200 it is
  very dark at its small size.

### Comparisons made

The before state was the branch's starting point, 3050e21. Specimens set "sass eyes Sa8
%#^()" and "[a]{b} <+=>~_ $@& àéñ WAY7r" at pens 30, 87, 172 and 260.
Overlays laid a s e y 8 S $ @ & [ { < ~ with the Geist outline in red over the
Draw fill at the same four weights: Geist Thin at 30, Regular at 87,
UltraBlack at 172, and Black (the heaviest Geist) at 260. A last overlay
checked the letters fitted to Geist's ink in the last passes
(2 3 4 5 6 7 9 ? , D B P R Q K k x M W f t e P F ( [ / z % ` é) at 30, 87,
172 and 194, against Geist Thin, Regular, UltraBlack and Black.

## Script and hand bases

Branch: `claude/polish-script`. Scope: the joined faces (Handwriting, Formal
Script, Casual Script, Monoline Script, Roundhand) and the two unjoined hand
faces (Marker, Brush), at the Light (pen 30), each face's own weight, 200 and
the slider maximum 260.

Every face was compared at all four weights, before (the original code) and
after (this branch), on sheets that set "minimum Handgloves", "the quick brown fox" and the lowercase alphabet with
the font's own joins, including the high hand-over after `o v w b` and the word
start and end forms.

### What was wrong

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

### What changed

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

### Second round: problems found by a full audit

A sweep of every face, every weight from 20 to 260, every letter and every
join position, and a read of pangrams set in each face, found more.

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
- **Printed capitals.** B D E F H I K L M N P R T U V W X Y Z have a written
  form on the joined faces: the drawn capital entered with a hairline swash
  that lands half a pen into its first stroke. The round capitals keep their
  own curves, and the G and the J are left out because their first stroke
  starts at the top left at some weights and not at others.
- **Loop tips on a broad nib.** The eye's end is set down inside its stem by
  about its own half-width, so the head of a looped letter is the nib's own
  cut rather than a small horn beside it.

### Results

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
`npx vitest run src/forge src/assemble src/library` (1216 tests on the branch; historical) all pass.

### What remains

- **Heavy scripts are squat.** A 260 pen on a 332 to 420 unit x-height is a
  stem of two thirds of the x-height or more. Every counter is open and every
  join is clean, but the faces read as a heavy display script there. Measured
  in units, the counters at 260 are 35,000 to 53,000 square units on every
  joined face, all about 160 units tall: the x-height less the pen.
- **Round capitals.** The C, G, J, O, Q and S on the joined faces are the
  drawn capitals, leaning; they have curves of their own rather than a stroke
  to enter by.
- **Node counts without the exporter's book.** Node counts are equal across
  weights through the export path, which is what a variable font uses. A
  letter drawn at an arbitrary slider weight without the book can still bow a
  stem differently. That is the engine's existing design for bows and balls.

## Cuts and casts

This pass reviewed every cut (slot, saw, chamfer, breaks, inline, counters) and every cast (shadow, rim, points, fillets). Each was checked alone and in pairs, in both orders ("Cut, then cast" and "Cast, then cut"). The checks covered the Draw bases, mainly Sans and Serif, at pen weights 30, 87 (the default), 200 and 260. They also covered opened fonts: Lora, Geist and `src/assets/typeforge-sample.ttf`. Every change has a test that fails on the old code.

### What was wrong and what changed

#### Inline (`src/forge/cut.ts`, `src/forge/cast.ts`)

- **Problem.** The groove was built by sweeping a thin pen down each stroke on its own. Where strokes met, the grooves had to be patched together, and the patches failed. On a, b and g the wall between the bowl groove and the counter pinched to a hair beside the stem. On the Sans a, bars of ink broke up the stem groove. The R had stubs and small windows.
- **Fix.** The groove is now the letter shrunk inwards by one wall thickness. The new `eroded` function does this with the rim's exact convolution run the other way. Both walls are now the same thickness everywhere, including at joins, so pinches cannot happen.
- The skeleton still decides where the groove may run. It runs only in the thick strokes, so the hairlines of a contrast face stay whole. It is held back only at true terminals. The inset is measured from the real edge of the cut, so a terminal cut on a slant, like the tops of a, e and s, stays closed.
- Slivers shorter than they are wide are dropped. These were the white flecks at the ends of the Serif e and s.
- **Opened fonts.** Shrinking needs no skeleton, so the inline now works on opened fonts too (Lora, Geist, the sample). Only the breaks remain skeleton-only, and the `FROM_SKELETON` set in `src/font/cuts.ts` now lists only them.

#### Breaks (`src/forge/cut.ts`)

- The Sans a draws its stem twice. The breaks read the two copies as a join and cut a hairline between them. Two strokes where one lies inside the other, or whose straight runs lie along one line, are no longer a join.
- The second arch of an m was slashed across the first arch's shoulder. It is now measured against the middle stem carried on past its bend, so the gap sits flush beside the stem. The extra ink this left standing over the stem, like a horn, is also cut away.
- Each pair of strokes used to be parted only once. The bowl of an R, B, D, P or a kept one of its two joins, and which one depended on the weight. This was the "busy" Black R and B from the earlier notes. The bowl now comes off its stem at both ends. This only applies off a stem, so the bar of an e is still parted at one end only. It also only applies where the far end really runs into the stem, so the Black r keeps its arm.
- **Cast first.** With a rim cast first, the breaks are planned on strokes as fat as the rim made them. The gaps now run through the rim instead of leaving hairlines across them.

#### Rim (`src/forge/cast.ts`)

- The inline leaves each counter's wall standing inside the groove as an island. The rim measured the groove as if it were empty, so it grew the groove shut from outside while the island grew into it from inside. Every letter with a counter came out of inline then rim as a solid blob. This was already true before this pass.
- **Fix.** A counter's depth is now measured by the paper actually in it, and the islands grow into it no further than the counter's own edge does.
- The counter step is now also checked against what shrinking can remove. If the boolean library loses the loop, it retries on a snapped grid. This fixed the e.

#### Chamfer and points (`src/forge/cut.ts`, `src/forge/cast.ts`)

- A chamfer through an acute corner leaves more than the two corners that points pairs back into one. Examples are the ends of a k's arm and leg, and the terminals of a and e. Each unpaired corner grew a thorn beside the point. Those corners now grow nothing.
- The chamfer measured its cut points along each edge's tangent. On a curve, that point is not on the outline, so the cut left a step beside it. The points are now found along the edge itself.

#### Effects after the cuts (`src/forge/effects.ts`)

- Formal Script ships with the pressure effect on. After slots, the effect's clean-up treated the tail loop of a g as a splinter, because the outline comes back near itself. Three fifths of the letter was deleted. A splinter must now also enclose almost no area.
- Pressure rays that strike the side of a cut are now ignored, instead of being taken for the stroke's flank.
- A pressure or skip subtraction that would remove more ink than its tool covers is not applied.

#### General (`src/forge/cut.ts`, `src/forge/cast.ts`)

- The crumb sweep after the cuts treated any piece under a third of a stem wide as a splinter. On a contrast face, every hairline a slot passes through is that thin. The threshold is now held to the letter's own thinnest stroke.
- A cut or cast result that crosses itself is resolved with one more union. These were small loops from a chamfer or a saw tooth.

#### Second round: every Draw base, and the fixes it turned up

After the first pass, every Draw base was reviewed with every cut and cast. Each problem found was fixed, or checked and documented.

**Breaks** (`src/forge/cut.ts`)
- **Script exit flicks.** The short flick off the foot of a script H, A or E was cut loose and read as a full stop. It now stays on if it:
  - leaves the end of the stroke it joins,
  - turns back up that stroke,
  - is shorter than three tenths of the x-height,
  - and is longer than a stem or thinner than two fifths of one.

  Square arms, such as a Display E's, still come off, and so do bars that leave a stem part way up (an f, the middle of an E).
- **Curled arms.** The curled arm of a Display or Psychedelic r now stays on instead of coming off as a wedge.
- **Chevrons.** A chevron laid point-first against a stem, like the arm and leg of a Display, Didone or Flared k, now gives way itself, with a gap on each limb. Before, the stem gave way and the break took its top off.
- **Lips.** The foot of an arch curves out of its stem just below the gap and stood out of the stem's side as a lip a few units deep, on every n, h, m and r. That ink is now cut too. The guards:
  - It is only cut where the stroke starts buried in its stem, within a gap's width of it.
  - It is never cut on a leaning face.
  - It is kept only if it adds no piece, speck or crossing.

  This also removed the horn on the Grotesque m.
- **Failed cuts.** A cut that removes more ink than its knife covers is retried piece by piece, and a piece that fails on its own is left out. A failed boolean had taken the stem of a hairline Sans a, and the tail of a Formal Script y.
- **Rim first.** With the rim cast first, an E keeps its arm breaks.

**Saw** (`src/forge/cut.ts`)
- Each tooth is now set against the letter's own edge at its height, instead of along the letter's bounds. Before, the teeth left prongs round an o and never reached the stems of a serif face.
- Teeth are left out in three places:
  - where the edge runs across the comb,
  - where the ink is too thin for a tooth to leave it whole,
  - and on inner edges well in from the bounds.



**Effects after the cuts** (`src/forge/effects.ts`)
- **Inline on rough faces.** The roughening's slit sweep took the inline's groove for a slit where it tapers. The Brush rounds and most of the Handwriting had no inline at all. A hole of groove size that runs down a stroke's spine is now kept.
- **Press terminals.** The first pass added a rule that skips press rays striking the side of a cut. It also blunted the tapering terminals of uncut Brush and Formal Script letters. A short ray is now believed when the stroke's own outline is that close too, or when it starts on the edge.
- **Check against the session start.** Uncut script letters were compared with the code at the start of the session. All but five of 208 match exactly, and those five differ by under 1%. The exception is the Handwriting t, whose loop used to fill in and is now open.

**Fillets** (`src/forge/cast.ts`)
- Fillets and points no longer leave a speck of their own beside the letter, such as by the link of a Serif g.
- The cast's pinhole floor now ignores the pinholes left where overlapping strokes are united.

**Checked and left as designed**
- **Rim at weight 260.** The rim keeps about 70% of each counter. The plain counters are already that small, and an outward rim closes the narrow apertures of an e and an a.
- **Brush slots.** The strip under the lowest slot band on the Brush is the foot below a band set at the font's shared heights, as on every face.
- **Bowl breaks.** The small bevel at a bowl's break end is the bowl's inner curve meeting the flush cut.

#### Third round: the known leftovers

Each leftover from the second round was fixed or checked and documented.

- **Heavy n, m and h at weight 260** (`src/forge/cut.ts`). The gap was wider than the counter under the arch. Laid flush on the stem, it bit the top of the leg, and the leg's inner edge stepped in. The gap is now narrowed to the room the stroke leaves beside the stem, and stays flush on the stem.
- **Inline terminals** (`src/forge/cut.ts`). The hold-back at a curving terminal took the paper beside the terminal as well as past it, and bit a step into the groove's side. It now takes only the middle of the stroke, so the groove ends square at the tops of a, e and s.
- **Self-crossings** (`src/forge/cast.ts`, `src/forge/effects.ts`, `src/forge/cut.ts`). Where two points agree to fifteen digits, the boolean library can hand a loop back from a union.
  - A loop that survives is tried again on a fine grid, then on a whole-unit one.
  - The effects stage now resolves loops too, and tests the letter as it will stand once leaned. A Formal Script n came out of the pressure clean and crossed once it leaned.
  - It also tests a few degrees either side of the face's slant. A running hand leans each letter by its own amount after the effects, and the Formal Script y under the inline and fillets crossed at its own lean.
  - Crumbs under a thousandth of the letter's ink are dropped after untangling. The smallest counter a letter draws on purpose, under a Serif t's flag, is eight times that.

  At the end of this round, two cases were still flagged: the Formal Script s with fillets, which was the quick detector's false alarm, and three folds with the shadow cast before the breaks. Both are resolved in the fourth round.
- **Serif g with fillets** (`src/forge/cast.ts`). A fillet grown into a corner too tight for it crossed itself, and its reversed lobe cut a slit into the link. A folded fillet is now left out, and that corner stays as drawn.
- **Script exits** (`src/forge/cut.ts`). A script's exit or entry that leaves the end of its stroke and turns back on it now stays on up to about half the x-height. The Roundhand and Formal Script n, m and h no longer lose their exits as dashes.
- **Slots at weight 260** (`src/forge/cut.ts`). A band passing just by the crotch under a Black k's leg left the crotch's paper standing into its edge as a small V. Paper that lies wholly in a thin strip along a slot, and is smaller than the strip is deep, is now filled back in. It is never filled where that would join two pieces the cut parted. Only the slots do this, because paper in a break's gap is the gap itself.

- **Fillets after a cut** (`src/forge/cast.ts`, `src/forge/cut.ts`). Found in the final review.
  - After slots, the corner a band leaves beside a join can be closer to the next piece than a fillet is long. On nearly every face the weld tied a stem back to the bar a slot had cut it from. A fillet that would join two of the letter's pieces is now left out, counted with the fillets already kept, so two that only touch in a gap are caught too.
  - After the inline, the corner at a join is the groove's. Fillets stood in the groove as stubs, or tied the island to the outer wall. The shape of a hole cannot tell a groove from a counter (a Formal Script e's eye is as thin as a groove), so the cut now hands on where it cut the groove, and the weld keeps out of it.
  - Fillets on letters without a cut are unchanged.
- **Rim after the inline** (`src/forge/cast.ts`). Found in the final review. The groove counted as the letter's smallest counter, which held the pinhole floor so low that what the rim left of the groove's ends by a terminal stayed as ragged pockets. This showed on the s, e and g of several faces. The groove no longer counts as a counter.

#### Fourth round: every weight on every base

The earlier rounds swept Sans and Serif at every weight but the other bases at the default only. This round swept all 21 Draw bases at weights 30, 200 and 260 as well, with every cut and cast alone and in pairs in both orders. The final sweep on the finished code found no crossed outlines and no crashes at any weight on any base (the first found eight crossings and one crash). It also added a key sheet per face for a visual check (default weight on all 21 faces, and 30, 200 and 260 on Sans and Serif).

**Cuts** (`src/forge/cut.ts`)
- **Tongues on slotted joins.** A band laid across a join at a slant cut most of a stroke away and left its corner standing on the next stroke as a tapering tongue: the crossbar of a slotted A on its leg, the arch of a Slab n, the stem under a Serif t's bar. What a knife leaves of a stroke's own ink is now trimmed if it is thinner than a share of that stroke's pen and runs along the knife's edge. A trim that would close a counter or break off a piece is not made: on a heavy Display m it took the middle stem's own corner.
- **Script exits.** On a running hand, the stroke to or from the next letter now stays on under the breaks wherever it leaves from. The exit of a Roundhand u and the lead-in of its a came off as dashes.
- **Folds with the shadow first.** A cut that comes out folded over on itself where the letter went in clean is now made again with the knife on a fine grid. This fixes the heavy Sans and Serif d and the Wavy g, listed as leftovers last round.
- **Chamfer.** The chamfer now leaves a corner square where cutting it off would break a stroke away. The swash of a heavy Formal Script E came off as a piece of its own.
- **Inline on opened fonts.** Flecks of groove smaller than the groove is wide are dropped.

**Casts** (`src/forge/cast.ts`)
- **A crash.** A heavy Display m, slotted and then given a shadow or a rim, threw a stack overflow. A counter pinched shut at a point took the piece beside it for an island, and each took the other for inside it, over and over. The rim and shadow now only recurse into islands while the set gets smaller.
- **Fillets after slots.** Fillets now stay out of everything the cut took away. A fillet grown at a join a slot cut through stood in the band as a bump.
- **Points after slots.** Points are no longer grown at corners a knife made. On a Serif e, o and s every band end grew a star.
- **Opened fonts with the cast first.** Where the cast could not reach an opened font's letter (fillets need strokes), the letter was handed on with its winding unresolved. The chamfer then cut the Lora H's crossbar loose, and the counter motif lost the n.
- **Untangling.** An outline is now accepted only when the exact crossing test passes, preferring one the quick test also passes. The quick test samples curves in six and can be wrong either way. Where a leaned letter will not come untangled, the upright one is tried. The cut and the cast also untangle the letter as it will stand leaned, so a chamfered Handwriting s no longer crosses itself.
- **Groove scraps.** Scraps of the inline's groove smaller than a tenth of a stem square, left by a rim or a shadow, are filled.

**Effects after the cuts** (`src/forge/effects.ts`)
- **Press after a chamfer.** The press no longer lays a band along a face a cut made. On the chamfered stems of a heavy Formal Script it left a staircase of ticks.
- **Press after the inline.** The press now measures a grooved stroke with the groove filled, and thins a share of the wall. On a hairline Formal Script it cut the wall through and folded the outline.
- **Specks.** The effects now sweep for specks again after untangling. A speck stood by the leg of a Formal Script k with points after the chamfer.
- **Motif on a roughened face.** The cut now hands on the motif's figures, and the filter for cracks leaves them alone. The roughened diamond in a Marker e was filled as a crack, and the e came back solid.

- **Hairs and crumbs on the Brush.** Found by the final sweep.
  - Where the roughened outline comes back to exactly a point it passed through, and the loop between encloses nothing, the loop is dropped. A point grown on a saw tooth of a Brush e came back as a hair of no width.
  - A point on the thin terminal of a light Brush e stood on a neck that the pressure thinned and the roughening parted. It came back as a crumb beside the letter. The cast now hands on what it grew. After the effects, a piece that broke off one they were given is dropped if it is under half a stem square and is mostly a point or a fillet.
  - A first version dropped any small piece that broke off, and took the tail of a heavy Casual Script p and the exit of its a with it. Those are the letter's own strokes, which that face's roughening parts at weight 260. They are kept again, and a test holds them.

**Checked and not faults**
- **Serif g at 30 and Monoline Script e and t at 200 and 260.** The "lost" holes are pinholes of a few hundred square units or less in the plain drawing. The effects rightly fill them.
- **Inline on an s at 260.** The groove in each terminal stroke is a short dash of its own, because the groove is laid stroke by stroke and ends square at a join.

### Tests

The new tests are in `src/forge/cuts-cast-polish.test.ts`, `src/forge/cut.test.ts` and `src/font/cutting.test.ts`. Three older tests described the old behaviour and were updated:
- The inline used to be kept out of opened fonts. Those tests now use the breaks, which are still skeleton-only.
- A bowl's groove used to stay separate from the stem's. The test now checks instead that no wall pinches.

`npx tsc -b --noEmit`, `npx biome check .` and `npx vitest run src/forge src/font` all pass, with 1791 tests on the branch (historical). One older test, the exchange test that cuts slots through a whole opened font, runs close to its 30-second limit on this machine: about 28.4 seconds alone, against 27.6 seconds before this pass. Under full-suite load it once went over.

### Known leftovers

- **Formal Script E foot.** The thin sliver under the foot is in the plain drawing, with or without pressure. It is not made by a cut or a cast.
- **Casual Script at 200 and 260.** The plain letters are already drawn in broken fragments at these weights (the p's descender, the t). The cuts and casts work on the fragments, so piece counts change. This is in the base drawing, not the cuts.
- **Plain letters that cross themselves.** On several bases a few plain letters cross themselves before any cut (for example the Typewriter g, k and s). This is in the base drawing.
- **Small ticks on a heavy Formal Script chamfer.** At weight 260 the chamfered H is clean, but the end of the E's middle arm and the k's arm keep a small tick where the press meets the cut corner.
- **Inline with a shadow or rim at weight 260.** The shadow or rim closes most of the groove. What is left open to the paper can show as slivers on a k, g or p.
- **Shadow cast first.** With the cast first, a shadow followed by breaks shows the breaks as windows in the shadow. This is what "Cast, then cut" means: the block and its shadow are sliced as one.

## Opened fonts under the Edit-mode controls

This pass made opened fonts hold up under every Edit-mode control, and under combinations of them. The test fonts were Lora 400, Geist Regular and the bundled sample font. Every setting was rendered at its extremes, and pairs were rendered too, such as weight 0.06 with width 0.7 and radius. Each letter was checked zoomed in, with and without its outline points shown.

Every comparison was made between the commit this work started on (`3050e21`) and the end of this branch, with the same settings.

### What was wrong and what changed

#### 1. Condensed heavy letters closed their counters

At weight 0.06 and width 0.7, the eye of e, the bowls of a, o, b, d and B, and the apertures of s and S closed to crumpled specks and cracks. This happened in all three fonts.

The cause: after the width scaling, the width control puts back the stem thickness the scaling took off. But Lora's e at that setting is narrower than two of its stems, so there is no room for them.

The weight engine now takes a share of white to keep, and the width control asks for it. When the strokes are put back, they close only a little of the white they face, and give way where there is no room. This is how a condensed heavy cut is drawn. On the outside of a letter this is measured point by point. A counter instead keeps a minimum mean width (twice its area over its length round), and the whole counter backs off evenly, so it keeps its shape.

#### 2. Dots fused with their stems

When weight was added, every other ink contour of a letter was ignored. That is right for strokes that overlap, but wrong for pieces drawn apart. At the heaviest weight the dots of i and j grew into their stems, so jij read as JIJ. The same happened to ! ? " = and ä.

A contour now measures against the other ink contours that are clear of it. The paper between them keeps a share of itself as well as a minimum opening.

#### 3. Slab serifs

- **Spacing:** slabs ran past the letter into its side bearings, so neighbouring letters joined along the baseline. The letter now moves over and its advance grows by what the slabs add, so a slab serif is spaced from the tips of its serifs.
- **Weight:** slabs were weighted as overlapping contours. So a light k, x or A stood on heavy blocks, and heavy letters had notches. Slabs are now kept aside while the letter takes its weight, then resized as the bars they are and added back.
- **Cracks:** two slabs that would end a crack apart, such as the feet of k and the arms of x, are joined into one.
- **Conventions:** the fixes follow what slab serifs such as Rockwell and Roboto Slab do.
  - Dots get no slabs.
  - Punctuation gets no slabs.
  - The top of a t, a stub on its crossbar, is left plain.
  - The tops of lowercase stems and of figures get a flag to the left, not a bar across.

#### 4. Weight moved letters off the baseline

The weight engine grows the outline in every direction. So a bolder letter dropped below the baseline and rose past its x-height or cap height by the weight: 60 units each way at the heaviest setting. A lighter letter floated and shrank. A single letter given its own weight fell out of the line.

After the weight, a letter is now pinned back to each edge it was drawn to: its descender bottom, the baseline, the x-height or cap height, and its ascender top. It is eased in straight lines between those pins. Each edge moves back by what its own points actually did (the median), not by the weight setting. This matters because a thin serif made lighter keeps a third of itself and moves less than the weight. Handles follow the slope of the map at their point, so smooth points stay smooth.

A mark placed by its middle, such as a hyphen or bullet, touches neither edge and stays where it is. A period or a quote goes back to the one edge it touches. As a side effect, bold horizontals come out a little lighter than bold stems, which is how a bold is drawn.

#### 5. Ball terminals and dots at light weights

At the lightest setting, Lora's ball terminals (a, c, f, r, j, 2, 3, 5) and the dots of i and j came out the weight of the hairlines, as bumps and specks. A light cut keeps them full.

Taking weight off, a ball now gives up half as much as a stroke does. A ball is recognised by its chords. A ray aimed 50° off straight across is shorter than the straight ray on a round blob, and longer across any stroke, bowl or rounded stroke end. A dot is a small, roughly square or round piece of ink standing clear of the rest; it is treated the same way.

#### 6. Side bearings after weight

A heavier letter was moved over by the weight, and its advance grew by twice the weight. That is right for a stem, but the level-cut foot of a diagonal runs out further on its mitre. At the heaviest weight the sample font's k reached a tenth of an em into the next letter, and x and v into both neighbours.

The ink's actual growth on each side is now measured, and the shift and the advance follow it. The advance reads this from a cache keyed on the glyph and its settings.

#### 7. Steps at aperture tips

At the heaviest weight, Lora's a, s and 2 had steps of about 10 units where the weight swallowed the end of an aperture: a run of short curve pieces left behind as the stroke closed up.

Such a run is now laid along one round curve, joined smoothly to the outline either side of it, with the same number of points. Runs with a straight piece in them are left alone, so a stem foot stays straight. If the rounded run would make the outline cross itself, the run is left as it was.

#### 8. Edges that share a baseline

Each edge used to move back by one amount. Where a thin bowl bottom and a stem foot share the baseline, as in a light b, the bowl's overshoot ended up about 14 units deeper than drawn.

Moving the pins now tells only where the outline runs level. After the pins, a smooth correction brings back whatever is still off the edge. It only ever moves points inward, and it fades out within a tenth of an em of the edge. A contour it would make cross itself is left as the pins placed it. In all three fonts, every letter's extents now stay within 2 units of the drawing at −0.04 and 0.06.

#### 9. Middle space

Closing or opening a counter used to thin or thicken the walls round it by the whole change. At 0.6 the letters with counters set as a bold beside H, n and m, and at 1.4 as a light.

- **Walls follow the counter across.** The ink beside a counter now moves with it, so a closed o is a narrower o with the strokes of the rest, and an opened one a wider o. Round walls and upright stems both follow. Leaning walls, such as the legs of an A, stay where they are.
- **No vertical change when closing.** A closing counter keeps its height, since top and bottom walls can't follow without changing the letter's height.
- **No corner in the map.** The shift blends into the wall's movement over a short run either side of the counter's edge. With a corner there, a closed o came out pointed top and bottom.
- **Stacked counters move together.** The two bowls of a B move their shared stem alike, and together. Moved one after the other, the stem leaned.
- **Spacing.** The side bearings follow the measured change in the ink.

#### 10. Slabs on beaks

Lora's S is all curve and measures thinner than its stems, so the tips of its beaks passed for stroke ends, and each got a bar. The top of Lora's 5 flares from a hairline arm into a beak, and a bar stood on that too. Stroke ends are now also measured against the font's stems, and an end much wider than the stroke just behind it counts as a beak, not an end.

#### 11. Found by sweeping every glyph

The before and after comparisons covered about 28 letters. So I also swept every glyph of the three fonts (602 in all) under 40 settings and combinations, checking for crossed outlines, changed point counts, height drift and ink past the advance. Those checks found:

- **Heavy condensed diagonals:** v, w, x, y, K and M at weight 0.06 with width 0.6 ran up to 0.12 em past their advances. The width control puts back the strokes the condensing took off, and that runs a diagonal's feet out on their mitres. What it adds on each side is now measured, and the letter is spaced by it.
- **Crossbar lowered:** a lowered bar extends the 4's diagonal down to meet it, and the corner came out 60 units into the side bearing. The crossbar and shoulder controls now space the letter by any ink they put beside it.
- **Dotless j:** it was taken for a capital, since it has no uppercase form, so its top was held to the cap height and rose past the x-height by twice the weight. Lowercase is now read from the letter's Unicode category. Letters are also no longer pinned at a line their strokes only pass through.
- **Light u and N:** at −0.04, Lora's u stood 20 units under its x-height and its N 6 over its cap height. Four changes fix this:
  - An edge's move is now taken from the points nearest its line.
  - Top and bottom are corrected separately.
  - A point belongs to the edge it was drawn on.
  - A light letter's edges may now be corrected outward, and a correction never carries an edge point past where it was drawn.

#### 12. Found in closer screenshots

- **Folded inside corners:** at weight 0.06 with width 0.7, the small inside corner where the tail of Geist's j meets its stem folded into a notch, and the y's did the same. Where a piece of outline now runs back the way it came, it is laid flat against the stem.
- **Stacked counters:** each map eased to nothing halfway across the gap between two stacked counters, so the wall there dented, and the serif on Lora's & arm sheared. The maps now hand over across the whole gap.
- **Slab flags:** a flag reaches out to the side of its stem, and it was tested for sitting on the letter only at its middle, which misses the stem. Heavy, every lowercase flag grew past its stem's top, and on Geist's i and j it met the dot. The test now runs along the whole edge.
- **Slab beaks:** the beak on the sample font's f hung below its hook at heavy weights, nearly closing on the crossbar. A slab end flush with the letter's edge now follows that edge.
- **G spur:** its foot bar reached over the bowl it stands on. A slab no longer reaches out on a side where the stroke is joined to ink.
- **Upright edges between stacked counters:** after the handover fix, the & serif still leaned 19 units at 1.4. Each straight upright run of the outline, however many points it has, now moves across whole, by the shift at its middle.
- **Rim:** the boolean step that builds the rim could leave a tiny figure-eight in the outline of Lora's a and its six accented forms. Its area was right, so the existing retry never caught it. Now each solid's rim is rebuilt on a grid when it crosses itself: a thousandth of a unit, then a hundredth, then a tenth, each coarser than the last. The finished rim is checked once more after the counters are cut out and joined, and rebuilt once if it still crosses. This change is in `src/forge/cast.ts`, which you approved going into.

#### 13. Review

A code review of this round's changes found two more, both fixed:
- The edge clamp could change a stroke's weight inside a letter. It now applies only to points on the edges.
- A slab end flush with the letter could shrink to a sliver at light weights. It now keeps the same minimum as any other slab.

A second review, of the upright-edge and rim fixes, found more:
- **The upright-edge fix** left 6 units of lean where an edge has a point in the middle. It also missed the fallback path, ran outside the crossing check, and ignored whether a contour is open. It is now part of the move itself, as described above.
- **The crossing check** (`contoursIntersect`) stops looking past 600 segments and samples each curve with six chords. So it can't see a loop on a detailed letter, and it reported loops on the sample font's n and h that aren't there. The reshaping controls, the weight engine's own safety check and the rim now use `crossesItself` from `geometry.ts` instead. That check already existed and compares curves' control boxes before flattening them; it now takes a step count, and those callers ask for 32 steps a curve. It also skips pieces of no length, as `contoursIntersect` does.
- **A new sweep** of every glyph with the new check found four loops at width 1.5 that the old check had missed. The d and n of Lora and Geist's ª each had a loop about a unit across. Geist's r at the lightest weight had a fold where its arch meets its stem. All four are fixed. The r came from the weight engine's own safety check, which used the old check, missed the fold, and so never backed off. It now uses the fine check.

A third review found my first version of the new check duplicated one that already existed in `geometry.ts`, so it was removed. It also found that a straight upright run moved by only half a counter's shift when one counter is tried alone; a run now moves by the largest shift any of its points is given.

A fourth review found that the existing check I had moved everything onto never compared a curve with itself, or with the curves beside it. So it couldn't see a loop inside one curve, and loops earlier rounds had fixed came back: Lora's A, G, d, n, $, Ú and Ý, heavy and widened or condensed. Worse, my tests asked with that same check, so they couldn't see it either.
- The check now compares each curve's own pieces, and neighbours' pieces except the two that meet at their shared end.
- The tests now ask with `loopsAnywhere`, a check in `test/outlines.ts` that shares no code with the one under test.
- A fresh sweep with an independent check, and one on the previous commit to prove the sweep can see these loops, shows them gone.
- The same review also found smaller issues, now fixed. A contour that already crossed itself before the weight was handed back whole instead of backed off. The unfold guard had dropped its slanted probes. An upright run pushed both ways at once moved by the larger push. The counters' check compared against the wrong outlines. The rim retried more often than it needed to.

A fifth review found that the fuller check now rejected the corner folds the width control lays flat afterwards. So the weight engine backed the whole stroke give off, and the small 4 in Lora's fractions, heavy and condensed, lost a quarter of its ink. Fixes:
- The weight engine now judges an outline after that repair.
- A contour that crossed itself as drawn is kept from crossing any more than it did, counted.
- The counters' check between contours compares which pairs cross before and after.
- Tiny spikes left where two points were brought onto one spot are removed.
- The check is faster: it skips curves that can't loop and only compares pieces near each other.
- The tests' own crossing check now evaluates curves itself.

A sixth review found the checks against a letter as drawn were each separate, and each let something through. They are now one helper, `crossesMoreThan`. It records a letter's crossings by the pair of curves that make them, and a reshaping may keep those but add none: counted alone, a change that removed one crossing and made a new one elsewhere came out even. The counters' check also compares how often each pair of contours crosses.

A seventh review found that this still let things through:
- Crossings were keyed by each curve's place in the outline. Where a corner radius merges and adds points, those places shift, and where the number of points changed, the check fell back to a count.
- The checks between contours only counted. So a wall pulled off one side of a stem and driven through the other came out even.
- The counters' follow step judged against the counters as scaled, which can already stand through a wall.
- The weight engine's choice between a filleted and a plain outline still used the old all-or-nothing rule. My sixth summary wrongly said every step used the new helper.

Fixes:
- **Crossings compared by where they are.** `crossesMoreThan` records each drawn crossing's position, the two curves it is on, and how far along each. A reshaped outline's crossing is accepted only if it is one of those carried along: on the same two curves, or the next ones past a point, and near where the new curves put it. "Near" means within 1% of the letter's size, plus three times how far the two curves moved apart there. Three crossings where two nearly touching curves made one count as that one.
- **Corner radius.** Where a radius adds or merges points, a crossing is looked for only by position, within the radius.
- **Between contours.** `overlapsMoreThan` asks the same of each pair of contours. The counter scale uses it, and the follow step now judges against the letter as drawn. When the follow step falls back to one counter at a time, a counter it refuses stays as drawn and moves with the ink around it.
- **Fillet choice.** The weight engine's choice between filleted and plain now uses `crossesMoreThan`.
- **Rim.** The rim's last retry must be at least the shape's own area, not the first answer's. The first answer is the one known to be wrong, and a loop left in it can make it larger than the right answer.
- **Spike cleanup.** The review took that code's comment at its word and asked that it touch only pieces the repair itself moved. Narrowed that way, loops came back on Lora's A, Á and n and on Geist's ª, heavy and widened. The spikes there are on pieces drawn a fraction of a unit long, which the weight pulls apart and the repair puts back on one spot. The rule is now: a piece brought to one spot loses its handles, unless it was drawn that short and its handles reach no further than they did in the drawing. The comment now says so.
- **Cleanup.** The old counting helpers (`contoursCross`, `contoursCrossings`, `pairCrossings`) are removed. A private box type that duplicated `Bounds` is gone, the box test is one `misses` helper, and a stale comment in the height code is corrected.

An independent sweep of every glyph of all three fonts under 39 settings found the same as before this round: no crossings and no point-count changes. Every outline of Lora and Geist under those settings comes out within half a unit of the previous commit, so this round adds no images: the fixes matter for fonts that are drawn crossing or overlapping, and for shapes these three fonts don't have.

An eighth review found the location rule still wrong both ways:
- A crossing where two curves meet at a shallow angle slides further than three times their move. A bowl leaving its stem at ten degrees, moved four units, read as a new crossing, so in an unmerged font the counters of such letters would back off for nothing.
- With big moves the allowance grew without limit, and any number of crossings could share one drawn crossing.
- Where a stroke's two sides meet at a point, "the next piece" let a wall pulled through the far side of a wedge pass.

Fixes:
- **Crossings followed through the reshaping.** The drawn outline is eased into the reshaped one in steps, every point and handle along a straight line. Each crossing at each step must be one from the step before: within 1% of the letter's size of it, and on the same two curves, or the next ones past the point joining them. A step a crossing can't be followed across is halved, down to 1/256 of the whole. So a crossing sliding a long way at a shallow angle is followed, and one tied anywhere new is caught, whatever the angle or the move. Only letters drawn crossing, and reshapes that cross, go through this.
- **Corner radius.** It can't be followed point for point, so it now allows for a crossing sliding along curves that meet at a shallow angle.
- **Rim.** A retry must now cover the shape, checked with a boolean subtraction. Being at least the shape's area wasn't enough: a retry that dropped the dot of an i and its rim was still larger than the shape.
- **Spike cleanup.** The spikes on Lora's A and n and on Geist's ª are on pieces drawn as a single point. So only a piece drawn short with handles of its own keeps them, however the weight grows them.
- **Follow step.** When one counter without a map is scaled through a wall, it alone is put back as drawn. Before, the whole letter was put back, and every other counter's change with it.
- **Speed.** The counter steps' checks share their flattened outlines, and hold them weakly.

**Between contours.** The review also found that only the counters' steps checked contours against each other. The independent sweep had never checked that either, so I added it. It found real faults:
- **At weight −0.04 a counter cut through its outline**, in Lora's g and Geist's ª and д.
  - In д it was a bug in the weight engine. It turns a straight side to lie parallel to its stroke's other side, and it took the counter's slanted left side, across the white, for the partner of its upright right side. That tilted the side, and its corner ran eighty units out through the stem. Partners must now face each other across ink.
  - In ª and g each contour is weighed on its own, so neither side of a thin join knew the other was moving.
  - The weight, the width's give and the height correction now all check between contours. Where two contours cross that didn't as drawn, both are weighed again with the weight taken down together until they don't. ª keeps about 98% of the weight asked.
  - The height correction had an early return that skipped this guard, and with it Lora's § crossed, light and with its counters opened.
- **At weight 0.06 separate pieces touched.**
  - The lower end of the acute on Lora's Á came down onto the A. The pointed end of the lower arm of Geist's ≥ and ≤ came down onto the bar, which had grown out under it.
  - A piece standing above another is now lifted to keep half the white it had, up to half an opening (18 units). The width's give keeps all of what it is handed, up to the same 18.
  - The crossbar control now stops a bar short of a separate piece. Geist's ť bar used to rise until it touched the caron; it now keeps half of the 22 units between them.

A ninth review tested on Lora Bold, a static font that ships its letters in overlapping pieces, and found that the new guards misfired there:
- **Weight lost on overlapping ink.** The weight's check refused any new crossing between two contours, including two of ink. Two ink contours that overlap as drawn fill their union, however far into each other they grow. Refusing that took Lora Bold's heavy Ħ to 67% of the weight, Ł to 64% and Ŧ to 91%, about 40 glyphs in all. Ink contours that overlap or touch as drawn are now not asked; ink against a counter, and pieces that were apart, still are.
- **Touching pieces couldn't be moved.** Lora Bold's Џ, Ŋ and џ are drawn with a piece standing on another, edge on edge. The smallest move turns that into a crossing, so they refused to lighten at all and kept all their ink. The same rule covers them.
- **The wrong piece lifted.** With a comma below, as in Ŗ, the R was taken for the piece above and lifted 14 units off the baseline, without its counter. And one accent lifted alone left the accent beside it where it was: Ổ condensed and heavy had its circumflex within 3 units of its hook. Now:
  - What stands on the baseline stays put.
  - Every piece floating above it is lifted together, and every piece below it lowered together.
  - Each piece moves with its counters.
- **Smaller fixes:**
  - The corner radius may find a crossing at most three radii along from one the letter had, not ten.
  - The eased check doubles its step only after two steps taken in a row, and may try twice as often.
  - The spike cleanup keeps a short piece's handles only while they reach no more than about twice as far as drawn.
  - The height correction backs off the whole letter together, not one contour at a time.
  - The rim retry sums the uncovered area with signs.
  - The between-contour check scans the drawing only once a reshape crosses.

On Lora Bold, 300 glyphs at weight 0.06 take 2.7 s, as they did before these guards; with them misfiring it had been 4.5 s.

**Five more fonts.** I then swept five more fonts, all under the SIL Open Font License: Lora Bold, IBM Plex Serif, Work Sans, Crimson Pro and Outfit. Each ran under the same 39 settings, with the independent crossing checks. Everything it found was already there before these rounds, and is now fixed:
- **Bar and shoulder moves** were still judged with the old six-chord crossing check. Lowering the arch of Lora Bold's ħ and ћ ran its join through the stem, and the shoulder control put a spike on the bulb of its !. They now use the same fine checks, of each outline and each pair, as the other controls.
- **A handle lying on its own point** came away from it when the heights were put back. It was moved by the field where it stood and held by where it was drawn. At a corner the weight had swallowed onto one spot, that left a half-unit spike, as on Lora Bold's and Plex's heavy ð. Such a handle now stays on its point.
- **Pieces of one letter drawn apart.** Work Sans draws the upper bowl of its g apart from the foot, and the lift took it for an accent. The circumflex seven units above it touched it when heavy, and crossed it condensed. Pieces drawn overlapping or touching now count as one piece of the letter, standing if any of them does. Whether a piece is above or below another is now judged where the two come closest, not by their boxes: the g's ear rises past the circumflex.
- **A lift must not bring the moved pieces nearer anything else.** On Outfit's heavy slabbed ¼ and ¾, lifting a piece clear of the 4 took it into the slash.
- **What the between-contour check ignores.** It now ignores two things the fill doesn't show:
  - ink joined to ink through a third piece, like the a inside Outfit's @;
  - a counter against ink other than its own outline, like the stem of the E of Outfit's Œ, drawn touching the O's counter.

  A counter is still checked against its own outline and against the other counters. The sweep's own check follows the same rules. (The tenth review narrowed both: see below.)

A last sweep of all eight fonts finds one crossing: Crimson Pro's u, heavy and slanted. Four of its points sit on one spot, and the sweep's check, which doesn't merge them, reads rounding after the shear as a crossing. `loopsAnywhere` and the pipeline's own check both find none.

A tenth review, of the ninth review's fixes and the five-font round, found the guards still let things through, and one claim of mine wrong:
- **Pieces taken as joined when they weren't.** The between-contour check let off two pieces of ink joined through a third, so two stems each overlapping a foot bar, with white between them, could be grown through each other. It judged joins from the outlines it was handed, not from the letter as drawn, so two pieces the weight had just brought to touching were never asked again, and Outfit's ť caron could be driven into the t. And it let off a counter against any ink but its own outline, so an island standing inside a counter could be grown through it. Now only two pieces that touch each other as drawn are let off. A counter is let off only against ink laid over it from outside, and the outline it belongs to is found from a point inside it, not from its first point, which in an overlapping font can sit inside another stroke. Two pieces within half a unit of each other also count as touching now: their boxes were compared without that margin.
- **Only pieces over a standing one were kept clear.** A piece floating over another floating piece (a raised ≥, one accent over another) was kept clear of nothing. Any piece over another is now kept clear, lowest first, and a move that brings the moved pieces nearer anything else is refused.
- **A comma under a letter moved the letter.** Weighed round the comma under Lora Bold's R, the R's feet grew down less, the baseline was put back by that, and the R's counter came out 18 units off. What stands on the baseline is now weighed without what hangs under it in the way; the comma is moved clear afterwards.
- **The heights were put back from the wrong moves.** Found by two new scans: every accented letter's base against the same letter alone, and every plain letter against where it was drawn. At weight 0.06, a letter under an accent came out shorter than the letter alone in all eight fonts: Lora Bold's ĥ and Á by 54 units, Crimson's ĺ by 60, Geist's ĺ by 34, Outfit's Ñ by 55. Three causes, all fixed:
  - With an accent over it, the top of the letter is not the top of the glyph, and only the glyph's top was pinned. The ascender of ĥ, which the circumflex had kept from growing, was brought down by all the weight the circumflex had grown. The letter's own top and bottom are now pinned too.
  - An edge the accent kept from growing, like the flat top of the A in Á, didn't move, was not counted, and the full weight was assumed for it. Such a corner now goes back to where it was drawn, and no further. Only a corner between straight sides, at the very edge, with a floating piece just beyond it: a point on a curve held short by the letter's own strokes, as a Q's bowl is by its tail, is left alone.
  - A piece lifted clear before the heights were put back had its lift taken for weight, and the whole letter came down by it. The lift of the one of Outfit's ¼ took the top half of its slash 60 units below where it was drawn. The weight stage now lifts a piece only to see which pieces still cross, and takes the lift back off before the heights; the lift that stays is decided once they are back.
- **A piece drawn to the cap height rose off it.** Lifted clear of the slash, the one of Outfit's heavy ¼ stood 70 units over the cap height. A piece whose top is drawn to the cap or x-height now gives up height from below instead, up to a quarter of it, and rises only by what is left.
- **My claim about the five fonts was wrong.** I said the sweep of the five new fonts found only crossings, all fixed. It also reported height changes, 700 or so per font, which I hadn't read. Most are what the controls do by design: an accent or dot rising as it is kept clear, a mark that touches no line (a period, a subscript) growing both ways, a slant moving a letter's top sideways. The two new scans separate those from real faults. The faults the accents caused are fixed above; the rest are in What is left.

- **Pieces side by side were only kept from crossing.** Standing on the baseline beside each other, the slash and the four of Outfit's ¼, heavy and condensed, came within a fifth of a unit. Pieces drawn apart that the lift doesn't separate now keep the same share of their white as a piece over another, and are weighed lighter together until they do. Condensed, they keep all the white the condensing leaves them, which for Geist's ◌ and 〃 is about 14 units.
- **A piece beside the letter was driven into it.** For the comma under the R, the height correction had stopped asking about floating pieces, on the grounds that they are kept clear afterwards. But only a piece over or under another is moved clear, and the caron of Lora Bold's ť stands beside the top of its stem: brought down with the letter, it went 53 units into the t. Only a floating piece stacked over or under another is now let off there.
- **A lifted piece keeps its top.** Moved clear once the heights are back, a piece keeps its top (or, lowered, its bottom) and gives up up to a quarter of its height, moving only by what is left. So the one of Outfit's ¼ stays on the cap height it is drawn to, and Geist's ≥ and ť are no taller than before this round.
- **Sharp corners at an edge ran out along their mitres.** Found by the same scans, and there before this round too. At weight 0.06 a sharp corner runs out along its mitre, up to three times the weight, and the height correction brought an edge back only by the weight. Outfit's N draws its diagonal as a separate contour whose tips lie inside the tops of its stems: they came out as spikes 100 units past the cap height and the baseline. Crimson Pro's Δ stood 72 units over its height, its A 29, Plex's и 45, Work Sans' t 19. Now a corner between straight sides, at the very edge, that ran out by more than the weight, is brought back to its line, and runs out sideways only as far as the weight would take it.
- **Condensed, the same corners ran out again.** The width control gives a condensed letter's strokes back sideways after the heights are put back, and that ran the tips of Outfit's N up and down their mitres once more: condensed to 0.6 at weight 0.06, its Ñ stood 224 units under the baseline. A corner between straight sides on one of the letter's lines now stays on it when the strokes are given back.
- **Serif tops turned to match the wrong side.** Where a side is held in at a corner, the side across the stroke from it is turned to follow. It was laid parallel, but the two sides of a wedge serif are not drawn parallel: the flat top of a serif of Crimson Pro's Y was turned to lie along its sloped underside and stood 62 units over the cap height, and its N's foot 64 under the baseline. It now turns by as much as the other side turned, keeping the angle between them. And it doesn't follow a side the weight all but swallowed: the underside of a serif of Lora Bold's v, brought from 62 units to 6, tilted its top 10 degrees and it stood 36 over the x-height.
- **A letter the weight couldn't move was squeezed.** Crimson Pro draws its 4 as one contour crossing itself, and the weight's crossing check can't follow those crossings, so the weight leaves it as drawn. The heights were then put back by the weight it would have grown, and it came out 51 units shorter at each end. Where the weight moved nothing, the heights are now left alone. (The 4 not growing is fixed below.)
- **Double work.** Taking the lift off before the heights had the weight stage weigh every contour twice; 300 glyphs of Lora Bold at weight 0.06 took 6.2 s. It weighs once again, and takes 2.9 s (3.1 s before this round).

**Measured from the letter weighed alone.** After that commit, the scan of accented letters, now run at 0.06 of each font's em (it had used 60 units, which for Crimson Pro's 1,024-unit em is not the same weight), still found letters off their heights: Crimson Pro's n under its acute and caron 34 units high, its U with a horn and a tilde 45 low, Plex's s under its acute 12 low, and Crimson's 4 not weighed at all. Each was the heights reading the wrong points, or the crossing check a touch:
- **Points an accent held back were read as the edge.** The top of the arch of Crimson's n under its acute grew 8 units rather than 61, and taken for the x-height's edge, it said the n had hardly grown: the rest of the n was never brought back down. Telling such points apart by their distance from the accent missed points it held back from further off. Now a letter with a floating piece is weighed a second time without the piece in its way, only where the piece is near enough to matter, with its slabs placed on it the same way. The heights are measured from that, which is exactly what the letter alone does. A point that grew less than there is drawn back out to where it was drawn, smoothly with the other such points on the same edge and no further.
- **The letter's own lines were read from a floating piece's points.** A level point of the tilde over Crimson's U with a horn lies on the top of the horn, and was counted with the horn's. The letter's lines, and the baseline and x-height or cap height, are now measured from the letter's standing pieces only, and the letter's own top and bottom are edges for the correction as well as pins.
- **A touch was taken for a crossing.** Crimson's 4 is one contour whose stem touches the bottom of its bar at two points. Any weight at all makes crossings of those, and the crossing check, seeing crossings where the drawing had none, refused every share of the weight. Points of an outline lying on another piece of it now count as crossings that may be carried on, and the 4 grows. None of the 433 contours drawn crossing themselves in Crimson Pro is refused now.
- **Floating pieces are brought back as they were weighed.** Measured from the letter weighed alone, the heights would bring a floating piece down further than it had grown: the dot of Outfit's fi went under the top of the i and couldn't be lifted clear, with the f's hook over it. Floating pieces are now moved by the heights measured as the letter came out, with them in its way, as before this round.
- **Two points on one spot moved apart.** Found on the way, when the first version of the above put the top of Crimson's Z back under its accents: where the weight had swallowed a corner, two points a tenth of a unit apart at the foot of its diagonal were each moved by the field where it stood, and folded across each other, and the fold had the whole correction refused. Points on nearly one spot now move as one.

Every accented letter's base in the eight fonts now comes out within 11 units of the same letter alone at 0.06, most within 1, and none of the eight fonts' plain letters moves further from where it was drawn than before. The sweep of all eight fonts under the 39 settings finds nothing new against the previous commit and no height further out by more than 10 units, and Crimson Pro 24 fewer heights off. 300 glyphs of Lora Bold at weight 0.06 take about 3.5 s, as the previous commit does on the same machine.

Checked by eye on Lora Bold's h, A, l and t with their accents, and Ŗ; Outfit's N, Ñ, ¼ and ¾; and Crimson Pro's Y, A, Δ, N and 4. Each was looked at at rest, at weight 0.06, and at 0.06 condensed to 0.6.

**An eleventh review, and two faults from the list.** The review of the last two commits found three faults in the weight stage:
- **A piece given up entirely lost its lift.** Before the weight stage takes weight off two pieces that cross, a floating piece is lifted clear to see what still crosses, and the lift is taken off every piece afterwards. A pair that had to give up all its weight came back as drawn, without the lift, and taking the lift off then left an accent below where it was drawn. It now comes back as drawn and still lifted. No letter in the eight fonts reaches that case, so this has no test that fails on the old code.
- **The spacing check let most pairs through.** While taking weight off one pair, a trial was refused for bringing pieces too near only if the near pair shared its first piece with the first of the two, or its second with the second. It is now refused if a near pair includes either of the two. The old code met the spacing anyway by fixing the pair in the next round, so nothing in the eight fonts comes out differently, and this has no test that fails on the old code either.
- **The letter alone was weighed at the full weight.** The heights are measured from the letter weighed without its floating pieces in the way. That weighing gave every piece the full weight, even a piece the crossing check had weighed lighter, so the heights read growth that was never applied. Such a piece is now weighed alone at the same share it was given. Geist's Ỡ is an example: its horn and tilde give up a tenth of their weight, and the O under them now comes within 5 units of the O alone.

And from What is left:
- **A tip with a curve on one side ran out along its mitre.** The rule that brings a sharp corner back to its line took only corners between straight sides. The tip where the flag of Crimson Pro's 1 meets its stem has a curve on one side, and stood 33 units over the top of the 1. The rule now takes any corner that isn't smooth, and measures how far it ran by its whole move, not only upward, from where it was drawn after the letter is moved over for its side bearings. Brought back along its mitre, the tip landed inside the stem and leaned it, so a corner now goes back to its line along the steeper of its sides, as long as that is no further out than the mitre allows. Its handles stay where they were: carried with the point, they bent the outer curve of Lora Bold's parenthesis into an S. The same rule now also brings back the tips of Lora's comma, of parentheses, and of the tilde's terminals.
- **Slabs weren't kept off the pieces they aren't on.** At weight 0.06 with slab on, the slabs of Outfit's small four came within 7 units of the slash, and one of the one met another piece. Each slab now keeps the same share of white as pieces side by side from every piece it doesn't stand on, and from those pieces' slabs. Where it would come nearer, it is weighed lighter, only as far as it has to be. In the heavy ¼, the foot slab of the one gives up its weight beside the lower slash.

On the eight fonts, plain letters further from where they were drawn than a scan's tolerance go from 7 to 1 in Lora Bold and from 10 to 3 in Crimson Pro, and are the same in the rest. No accented letter comes out further from the same letter alone than before, except Crimson's Ỡ and Ờ, by the 5 units above. The sweep of all eight fonts under the 39 settings finds nothing new against the previous commit and no height further out by more than 10 units, and fewer findings in six of the eight fonts. 300 glyphs of Lora Bold at weight 0.06 take 3.0 s, against 2.8 s for the previous commit on the same machine.

**A twelfth review, of those fixes,** found two more, and a look at the slabs it pointed to found a third:
- **Weighed lighter, slabs lost their joins.** Two slabs that end a crack apart, like the feet of two stems side by side, are made one slab. That is done when the slabs are weighed together, and once any slab needed less weight, every slab was weighed on its own and none was joined. They are weighed together again, each by its own share.
- **A lighter slab left its stroke's end.** Its share lightened its position as well as its size, so its flush edge stopped short of where the full weight had left the stroke. The foot slab of the one in Outfit's heavy ¼ stood 7 units over the foot. The top slab of the sample font's Í, weighed lighter for the acute, was 63 units thick and sat 106 units down inside the stem. The share now changes only a slab's thickness and length.
- **A slab's end was read too deep in its stroke.** With that fixed, the slabs on the feet of Work Sans' circumflexes hung below the feet, nearly onto the letter. The end of a stroke is read by a ray from inside it, started as deep as the weight might have moved the end. The circumflex's thin diagonal foot is left behind at that depth, so the end was taken to have moved the whole weight, where the A had held it to half. The ray now starts shallower when the deep point misses the ink. The slabs on the accents over Work Sans' and Geist's capitals and ĥ now sit on the accents' feet, where before this round they hung up to 30 units below them. The test for this passes on the previous commit too: the fault only showed once a slab's share stopped moving its end.
- **Slabs joined as drawn were kept apart.** Two stems drawn a crack apart are separate pieces, but their feet share one slab. Each foot was kept off the other stem and given up weight for it. Pieces whose slabs touch as drawn now count as one.
- **A pair gave up weight for a third piece.** Taking weight off two pieces that cross, the spacing check refused any trial that left either of them too near another piece. That included nearness the pair could not mend, a third piece grown toward one of them, so the search ran down to no weight at all. Nearness that is still there with both pieces at no weight is now left for that third piece's own round.

**A thirteenth review** found one fault in those fixes: a nearness the pair couldn't mend was let off altogether, so a trial could close that gap to nothing and leave it for a later round, if one came. Now the pair may bring it no nearer than it is with both at no weight. No glyph in the eight fonts comes out differently, so there is no test for it that fails on the old code.

**A slab under an accent** was found on the way. With slab on at weight 0.06, the top slab of the sample font's Í was 351 units thick against 274 on its I, as it had been before this round. The acute holds the top of the stem back, the heights put that top back on its line, and the slab's underside was moved by the whole correction as if the top had grown. A slab on the standing letter whose flush edge was held back is now the slab the letter has weighed alone, put back as the letter is: Í's is 287 units.

The sweep of all eight fonts under the 39 settings finds the same as before these four fixes: nothing new, and no height further out.

Checked by eye on Crimson Pro's 1, parentheses, comma and ñ and Lora Bold's parentheses, comma and ñ, at rest, at weight 0.06 and at 0.06 condensed to 0.6; and on Outfit's ¼ and ¾ at rest, with slab 0.03, and with slab and weight 0.06.

### Tests

Every fix has a test that fails on the old code and passes now, except those listed under What is left. They are in:
- `src/font/shape-controls.test.ts`
- `src/font/weight.test.ts`
- `src/font/slab.test.ts`
- `src/font/counter.test.ts`
- `src/font/control.test.ts`
- `src/font/geometry.test.ts`
- `src/forge/cast.test.ts`
- `test/outlines.test.ts`

Tests whose faults depend on a real letter's exact geometry use letters from Lora, Lora Bold, Geist, Work Sans and Outfit as fixtures, among them Lora's N, u and a, Geist's r, n, д, ª and ť, Lora Bold's Џ, Ŗ, Ổ, ħ, ð, ĥ, Á and ť, Work Sans' ĝ and Outfit's ¼. They live in `test/outlines.ts`; all five fonts are under the SIL Open Font License. The rim test uses Lora's a at full precision, since the loop disappears if its points move by three thousandths of a unit.

Two of this round's tests pass on the code before it as well: the one of Outfit's ¼ keeping to the cap height, and its slash keeping clear of the four when condensed. The old code met both by taking weight off those pieces for another collision. They guard against this round's own changes, each of which failed them on the way.

Two old expectations in `weight.test.ts` described letters growing past the baseline and cap height; they now expect the letter to keep its heights. The middle-space expectations in `counter.test.ts` and `control.test.ts`, which had walls thickening or thinning by the whole change, now expect walls that keep their weight while the letter narrows or widens. The weight engine keeps each contour's point count, and slabs are still separate contours added to the letter.

These checks all pass: `npx tsc -b --noEmit`, `npx biome check .`, and `npx vitest run`, the whole suite of 2,945 tests on the branch (historical).

### What is left

- **Middle space and colour.** Measured as ink per unit of advance, letters with counters at 0.6 come out up to 10% denser than at rest (Lora's b, d, p, q), and at 1.4 up to 10% lighter. That is the white the control removes or adds while the strokes keep their weight. Thinning or thickening the walls to compensate is what squared the round letters earlier.
- **Some changes have no test of their own**, because in every case I could build they give the same outline as the code they replaced:
  - the edge-only clamp;
  - the rules for moving an upright run (the largest shift on the one-counter-at-a-time path; most-one-way-less-most-the-other when pushed both ways);
  - `crossesItself` skipping pieces of no length;
  - the counter scale and follow step using `overlapsMoreThan`, and the follow step judging against the drawing (the helper itself is tested in `geometry.test.ts`; no letter of Lora or Geist comes out differently);
  - the fillet choice using `crossesMoreThan`;
  - the corner radius passing its radius to the check;
  - the spike cleanup keeping the handles of a piece drawn that short (the loops the narrower rule brought back are covered by the Lora d and n test, which failed on it);
  - the rim's later grid retries, and a retry having to cover the shape;
  - the corner radius allowing for a crossing sliding at a shallow angle;
  - the follow step putting back one counter without a map rather than the whole letter;
  - the spike cleanup's rule for pieces drawn short (the loops on Lora's A and n are covered by the d and n test);
  - the height correction's check between contours (the § it fixed crossed only with this round's other changes), and its backing off the whole letter together;
  - the eased check's step growing after two steps, and its budget;
  - the spike cleanup's limit of about twice the drawn handle;
  - the rim retry's signed uncovered area;
  - the between-contour check ignoring ink joined through a third piece, and a counter against ink other than its own outline (no letter in the eight fonts comes out differently; the sweep's crossings on Outfit's @ and Œ were harmless).
  - a counter going with the smallest ink round it when the letter is split into pieces (no letter in the eight fonts has an island with a counter of its own);
  - a piece lowered clear keeping its bottom and giving up height from above (the pieces lowered in the eight fonts, commas and dots below, don't need it);
  - the between-contour check being told which pairs to skip, which only saves work;
  - a pair given up entirely keeping its lift, and the spacing check refusing a near pair with either piece in it (see the eleventh review);
  - a pair leaving a nearness it can't mend to the third piece, and bringing it no nearer (see the twelfth and thirteenth reviews).
  An independent check of every glyph under every setting confirms none of the outlines cross.
- **Corner radius** adds points by design, since it rounds corners with new curves.
- **Heavy counters.** At weight 0.06, Geist's B and R counters shrink to slits. That comes from Geist's own proportions at that weight.
- **Pieces side by side.** They keep half their white, up to 18 units, by being weighed lighter; condensed, all the white the condensing leaves them. At weight 0.06 and width 0.6 that is about 14 units between the dots of Geist's ◌ and the strokes of its 〃.
- **Heights the controls change by design.** The sweep reports every glyph whose top or bottom moves. Most of these are intended: an accent or dot keeps clear of its letter by moving; a mark that touches no line, such as a period, a comma or a subscript figure, grows both ways; a slant moves a letter's top sideways. The scans for letters against themselves alone, and plain letters against where they were drawn, are what tell real faults from these.
- **Fractions at the heaviest weight.** The pieces of a ¼ keep clear of each other, but the one squeezes to do so: at weight 0.06 Outfit's is about a quarter shorter from below. Condensed as well, it can't keep its whole top on the cap height; it stands 37 units over it.
- **Heavy slabs on small figures.** With slab and weight 0.06 on, the slabs of the figures of a ¼ or ¾ grow as thick as their strokes, and on figures that small they pile into one another within the same figure. That is what slab and weight do to any letter at that size; they are kept off the other pieces.
- **The tilde's terminal, heavy and condensed.** At weight 0.06 and width 0.6 the right-hand terminal of Outfit's tilde comes to a point about 25 units over the tilde's crest, which the heights squeeze down. The point now stops at the top the tilde is drawn to; before this round it stood 71 units over it.
- **Chevrons at the heaviest weight.** The chevron of a ≥ or ≤ keeps its 18 units of white over the bar by rising, after giving up a quarter of its height. At weight 0.06 the symbol stands 145 to 155 units taller in Geist, Lora Bold, Plex and Work Sans, and 148 in Crimson Pro. Before this round the heights squeezed the chevron without that limit, and it rose 92 to 162 depending on the font, with the bar lighter.
- **Two controls on one gap.** Each control keeps half of the white it is handed, so the crossbar and the heaviest weight together leave Geist's ť about 9 of its 22 units.
- **Pointed ends.** At weight 0.06 the ends of a chevron's arms run out along their mitres, as the weight engine draws any sharp corner away from an edge line; that, and keeping the chevron clear of the bar, is most of the height the ≥ above gains.

## Known limits

The polish made two things much slower, and neither is fixed yet. Both are
waiting on the speed work. The figures below are from the audit of the merge
(90dfc86) against the commit the branches started from (3050e21), on one
machine, so read them as proportions rather than as promises.

- **The warnings walk.** The check behind the warnings bar
  (`familyWalk` in `src/forge/health.ts`) draws and inspects every letter of
  every weight. On a Draw face with nothing cut the whole walk takes about 1
  to 2 seconds, where it took about a quarter of a second before. With a slot
  or a split cut on, it takes 17 to 22 seconds, where it took 2 to 4. The page
  runs it a few milliseconds at a time between frames, so the editor keeps
  answering, but the warnings take that long to arrive or to clear after a
  change.
- **The variable export.** Writing a Draw face as one variable font takes
  about 3 minutes, where it took about 1.5. The e2e test that ships an opened
  font as a variable file went from 1.2 to 2.5 minutes. The static export is
  unchanged at about 4.5 seconds.
- **Weight on a large opened font** is slower too: the weight control over all
  6,253 glyphs of DejaVu Sans took 97 seconds at 0.06, against 45 before.
