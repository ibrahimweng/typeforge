# Serif polish: summary

This branch (`claude/polish-serif`) brings Draw mode's Serif base closer to Lora, letter by letter, from the Light (pen 30) through the Regular (87) and Lora Bold (142) to the slider's heaviest (260). Every change was checked against Lora Regular and Lora Bold in overlays at the same scale, at all five weights.

Before and after images are in `docs/polish/serif/`. The `specimen-*` pairs show the whole lowercase at each weight. The other pairs show one fix each; `y2j1` shows the second pass's y, 2, j and 1. The "after" images show the code as it now stands.

## What changed

### The s past a Black
At 230 to 260 the s came out slanted like an italic. The widened heavy s asked for bowls too flat for its spine, and the search found a spine that crossed only half of each bowl, so the lower bowl stood back under the upper one. The search now narrows the bowls further and lets the spine lie flatter on a text face. The uprights are lightened less, so the heavy s keeps its weight beside the o. The Didone, which shares this construction, draws exactly as before. At 120 to 172 the spine was already a proper curve, so that item needed no change.

### The t
The flag was a straight band laid from the bar's end to a head as wide as the whole stem. Past a Black the flag was buried in the stem. The t now has Lora's head: a concave flag sweeping up to a head half a stem wide, on the stem's right edge, with the stem's top cut to slope away under it. The bar reaches past the stem by at least half a stem. The flag bows less where a short flag on another base would fold.

### The 2 and the 7
The 2's diagonal was one straight band. It now runs in an S, as Lora's does: steeper than its chord out of the bowl, flattest through the middle, steeper again into the foot. The 7's stem now falls straight down out of the corner and then turns into its slant. Before, it left the corner already slanted and stood half a stem left of Lora's all the way down.

### Beaks on the figures
A text serif's figure arms that lie along a line now wear their beaks: the 7's arm, the 2's foot and the 5's flag. Before, every figure end except a foot was left bare. This is gated to wedge serifs, which only the Serif uses.

### The G
The G's upright stood on its bowl half a stem left of Lora's and ended in a plain cut. It now stands where Lora's does, under a hairline serif reaching both ways.

### The e
The tail runs a little further round up to the Bold, as Lora's reaches out under the bowl. Past a Black the bowl starts further round, which lifts the bar off the tail. At 260 the tail had run up to within six units of the bar and its end looked sliced off; the gap is now about 22 units.

### The R
The leg was bowed all the way down, at 0.9 units across per unit down where Lora's leg falls at 0.66. It now leaves the bowl where Lora's does, runs straight at Lora's 56 degrees, and turns in its last few units into a toe along the line, cut upright, reaching past the bowl as Lora's does.

### The question mark
The neck left the hook on a straight slant and stopped in mid-air at an angle. The hook and neck are now one S, and the neck's foot stands upright over the dot.

### The g
The link bellied in under the bowl because it was bowed to the wrong side. It now swings out to the left, as Lora's does.

### Rising strokes as hairlines
With the pen held nearly level, both arms of a vee came out the same weight: the v's rising arm was 82 units across, against Lora's 52 beside a falling arm of 91. The Serif now draws its rising straight strokes as hairlines, as the Didone does. The exceptions are the z, the Z and the slash, which Lora draws heavy, and the A, which already draws its own hairline.

Vees drawn as one run (v, V, Y, the M's middle, w and W) are first split into one stroke per arm. Each stroke is laid again so that the vee's point stays exactly where it was, and each arm's end is cut along its neighbour's outer edge. A vee is split wherever an arm rises at all, so its points are the same at every weight, and an arm is drawn light only where it rises as a hairline does. The w now runs heavy, light, heavy, light (90, 51, 89, 52 at the Regular, against Lora's 87, 41, 84, 45).

The y's rising arm is drawn light on into its tail, with just enough contrast to keep the tail's foot on the descender. The falling arm's end is cut along the hairline's spine, so its corners stay inside it. The one's flag keeps its own pen: drawn as a hairline, its end stood seven units above the stem's head at the heaviest.

### Spacing at the Bold
Lora Bold sets its rounds about a quarter tighter than its Regular: an o is 31 units a side against 41. The Serif can now name its Bold spacing (`metrics.bold.spacing`, set to 0.82), reached by the Bold and held past it. The Regular's sidebearings, which already matched Lora's exactly, are unchanged.

### The Bracket control
Past about 0.4 the Bracket slider did nothing, because the bracket was clamped to the serif's depth. Whatever the slider asks for past the serif's thickness now carries on: a text serif's hollow climbs further up the stem, and a square serif's fillet turns further along the wing. The carry-on counts from the thickness rather than the depth because every base's default bracket lies between the two, so no base's default drawing moves. The Serif's bracket now changes the n's ink at every step from 0.2 to 0.8, at every weight from 30 to 260.

### Drops that crossed themselves
At contrast 0.9 past a Black, the c's drop crossed its own closing edge. The crossing only showed once the outline was rounded to whole units. A drop that crosses itself is now redrawn: first with its tail leaving the stroke less steeply, then closed back along its own foot, then smaller. A redraw is taken only if it neither crosses itself nor leaves the stroke's band. A drop that did not cross is left exactly as it was.

## Second pass: errors found in the first pass, and fixed
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

## Items from the brief that needed no change
- **The s at 120–172.** The spine was already a proper curve (see above).
- **The 5's width at the Bold.** It already matched Lora Bold (461 against 464) and was held by a test.
- **The e's bar at contrast 0.9.** It already runs flush with the bowl at every weight.
- **The Z and the M at 260.** Both are clean at 260.
- **The R at 260.** Its leg was already present.
- **Slant 12.** Slanted letters are spaced as their upright drawings and then leaned, and kerning is measured along horizontal rows. A shear keeps horizontal distances at every height, so the gaps between d and g, and b and i, are identical at slant 12 and upright. I measured this for a dozen pairs at three heights.

## Checks
- Every glyph in the set (a–z, A–Z, 0–9, & ? ! . , ; : ' " ( ) - / @) has the same node count at ten weights from 10 to 260, with no contour crossing itself. This holds at the defaults and at each of these settings:
  - pen angle -90, -60, -45, -30, -20, -10, 20, 30, 45, 60 and 90
  - contrast 0, 0.3, 0.6, 0.75 and 0.9
  - width 0.8, 1.2 and 1.5
  - x-height 300, 400, 600 and 680
  - slant 12 and -12
  - bracket 0 and 0.8, serif projection 1.2 and thickness 0.8
  - contrast 0.9 with pen angle 30, and contrast 0 with pen angle -30
  
  The one exception is under "Found but not fixed".
- Every test in `src/forge/serif-lora.test.ts` fails on the code before the fix it covers.
- Every other base draws exactly as before at its defaults. I checked this by hashing every letter on every base at five weights, before and after each change to shared code. The humanist alternates chosen on other bases draw as before too, apart from the letters this branch redrew on purpose.
- `npx tsc -b --noEmit`, `npx biome check .` and `npx vitest run src/forge src/assemble src/library` all pass (1225 tests). The run takes about 3% longer than before the second pass, because of the fold checks on swollen bowls.

## What still differs from Lora
- **The j's spacing.** Lora's j has a negative left sidebearing (-88), so its tail runs under the letter before it. The engine keeps every letter's ink inside its advance, and a health check and two character-set tests enforce that. So our j's stem stands about 80 units further from the letter before it at the Regular, and about 60 at the Bold.
- **The vees' feet.** Lora's v, w and M have a narrow flat on the line: 42 units at the Regular and 89 at the Bold. Ours come to a point on the line, as the construction's always did.
- **The vees' opening.** Our v, w, x and y stand a little narrower between their arms than Lora's, with longer serifs making up the ink width.
- **The 2's diagonal.** Ours is 76 to 80 units across at the Regular and 122 to 128 at the Bold, against Lora's 63 to 77 and 98 to 119. It is drawn on the bowl's own pen so the two join without a step.
- **The Bold's serifs.** Our Bold serifs reach about 69 units past the stem against Lora's 62, so Bold pairs are still 15 to 20 units looser than Lora Bold's even with the tighter spacing.
- **The G's serif.** It is a plain hairline bar. Lora's is bracketed into the upright.
- **The R's toe.** Ours turns and is cut upright. Lora's flares out into a small serif.
- **The c's drop at 260.** Where the heavy drop meets the counter, it makes a small sharp notch.

## Found but not fixed
- **The c, C and G at width 0.6 past the Bold.** Whether the c's top hangs a drop, and whether the C and G keep their lower beak, is decided at each weight from the drawn curve. At this width that decision flips between the Regular and the Bold, so a drawing without a record of those decisions (like my sweep) sees the point count change. An exported family records the decisions once, at its drawn weight, and keeps them at every other weight, so an exported font stays consistent. The same happens with contrast 0.9, pen -45 and width 0.7 together. Changing it means changing the shared rule for every base, so I left it.
- **The bracket between depth and thickness.** On a short serif, bracket values between the serif's depth and its thickness draw the same serif. Counting from the depth would fix this, but it moves the Didone, Slab and Typewriter defaults.
- **The e at pen 60, 230 and heavier.** It no longer folds, but its bowl ends in a large wedge out to the right. That wedge is the level cut on a stroke leaning that far.
- **The s at contrast 0.7 to 0.8 at the heaviest.** It now eases into the Didone's s instead of jumping, but past 0.7 it still leans a little, as the Didone's s at that weight always has.
