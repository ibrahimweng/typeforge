# Serif polish: summary

This branch (`claude/polish-serif`) brings Draw mode's Serif base closer to Lora, letter by letter, from the Light (pen 30) through the Regular (87) and Lora Bold (142) to the slider's heaviest (260). Every change was checked against Lora Regular and Lora Bold in overlays at the same scale, at all five weights.

Before and after images are in `docs/polish/serif/`. The `specimen-*` pairs show the whole lowercase at each weight. The other pairs show one fix each.

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

Vees drawn as one run (v, V, Y, the M's middle, w and W) are first split into one stroke per arm. Each stroke is laid again so that the vee's point stays exactly where it was, and each arm's end is cut along its neighbour's outer edge. The y's rising arm is drawn light on into its tail. The w now runs heavy, light, heavy, light (90, 51, 89, 52 at the Regular, against Lora's 87, 41, 84, 45).

### Spacing at the Bold
Lora Bold sets its rounds about a quarter tighter than its Regular: an o is 31 units a side against 41. The Serif can now name its Bold spacing (`metrics.bold.spacing`, set to 0.82), reached by the Bold and held past it. The Regular's sidebearings, which already matched Lora's exactly, are unchanged.

### The Bracket control
Past about 0.4 the Bracket slider did nothing, because the bracket was clamped to the serif's depth. Whatever the slider asks for past the depth now carries on: a text serif's hollow climbs further up the stem, and a square serif's fillet turns further along the wing. Every base's default bracket is at or under its depth, so no base's default drawing moves.

### Drops that crossed themselves
At contrast 0.9 past a Black, the c's drop crossed its own closing edge. The crossing only showed once the outline was rounded to whole units. A drop that crosses itself is now redrawn: first with its tail leaving the stroke less steeply, then closed back along its own foot, then smaller. A drop that did not cross is left exactly as it was.

## Items from the brief that needed no change
- **The s at 120–172.** The spine was already a proper curve (see above).
- **The 5's width at the Bold.** It already matched Lora Bold (461 against 464) and was held by a test.
- **The e's bar at contrast 0.9.** It already runs flush with the bowl at every weight.
- **The Z and the M at 260.** Both are clean at 260.
- **The R at 260.** Its leg was already present.
- **Slant 12.** Slanted letters are spaced as their upright drawings and then leaned, and kerning is measured along horizontal rows. A shear keeps horizontal distances at every height, so the gaps between d and g, and b and i, are identical at slant 12 and upright. I measured this for a dozen pairs at three heights.

## Checks
- Every glyph in the set (a–z, A–Z, 0–9, & ? ! . , ; : ' " ( ) - / @) has the same node count at nine weights from 30 to 260.
- No contour crosses itself at the default settings, at contrast 0, 0.3 or 0.9, at pen angle 30, or at bracket 0.8.
- The new tests in `src/forge/serif-lora.test.ts` each fail on the code before the fix they cover.
- Every other base draws exactly as before at its defaults. I checked this by hashing every letter on every base at three weights, before and after each change to shared code.
- `npx tsc -b --noEmit`, `npx biome check .` and `npx vitest run src/forge src/assemble src/library` all pass (1216 tests).

## What still differs from Lora
- **The j's spacing.** Lora's j has a negative left sidebearing (-88), so its tail runs under the letter before it. The engine keeps every letter's ink inside its advance, and a health check and two character-set tests enforce that. So our j's stem stands about 80 units further from the letter before it at the Regular, and about 60 at the Bold.
- **The vees' feet.** Lora's v, w and M have a narrow flat on the line: 42 units at the Regular and 89 at the Bold. Ours come to a point on the line, as the construction's always did.
- **The vees' opening.** Our v, w, x and y stand a little narrower between their arms than Lora's, with longer serifs making up the ink width.
- **The Bold's serifs.** Our Bold serifs reach about 69 units past the stem against Lora's 62, so Bold pairs are still 15 to 20 units looser than Lora Bold's even with the tighter spacing.
- **The G's serif.** It is a plain hairline bar. Lora's is bracketed into the upright.
- **The R's toe.** Ours turns and is cut upright. Lora's flares out into a small serif.
- **The c's drop at 260.** Where the heavy drop meets the counter, it makes a small sharp notch.

## Found but not fixed (present before this work)
- **The e at pen angle -20.** At 200 and 230 the belt's level cut at the bar folds by a few units. Switching that end to an aligned cut fixed the fold, but it opened a gap between the bar and the bowl at the default settings, so I left it.
- **The j at pen angle 30.** At 260 it has 34 nodes instead of 29.
