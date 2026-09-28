# Sans polish: summary

Branch `claude/polish-sans`. The goal was to make Draw mode's Sans match Geist
letter for letter from Light (pen 30) through Regular (87) and Black (172), and
stay clean up to the slider maximum (260). Each change was checked against the
Geist npm fonts (Thin, Regular, Black and UltraBlack), with the Geist outline
laid over the Draw fill at the same scale.

## What changed

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
steeper where they leave the bowls than through the centre. From the Regular
to the Black, the s and S spread as wide as Geist's, within about 6 units (the
s was 35 units narrow at pen 130, which sits halfway between Geist's Regular
and Black, and 40 at the Black).

**Heavy s counters.** The lighter pen that rounds them now takes its
lightness mostly from the crowns and spine rather than the sides, as Geist's
weight is set: at the Black the counters are narrow and tall (about 95 across
and 60 high, against Geist's 92 and 70) instead of 150-by-60 slots with the
weight in the spine. The bowls are carried out by what the crowns give up, so
the letter keeps its height. Past the Black the sides take the lightness back,
so the counters' ends stay round up to 260.

**@.** The ring is as wide as Geist 1.7.2's at every weight: it was 31 units
narrow at the Thin, whose ring stands further out than the Regular's, and 45
at the Black. The tail now runs round to where Geist's ends, found by where
it is across rather than by a height. It was 119 short at the Black.

**8.** Heavy weights use the same lighter pen plus a slightly wider ring, so
the upper counter stays an oval past the Black instead of a slot. The rings
also swell outward by up to 24 units a side by the Black, to the weight of
Geist's sides (200 at its Black, heavier than its stem). The eight is now
Geist's width at 130 and 172. It was 30 and 49 narrow.

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
The tilde is two equal arcs cut level. Past the Black the plus, the angles and
the tilde grow as they get heavier, so they stay open at 260.

**( ).** The sidebearings now match Geist's: 45 on the opening side and 15 on
the closing side.

**: ;.** The upper dot now sits at Geist Regular's height (506). The old code
had a mis-measured 0.87 of the x-height there.

**Spacing.** W, X, Y, T, O, Q and the 4, 6, 7 and 9 now stand where Geist
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

**Accent places (shared files, off for other faces).** Geist stands its
accents 55 units over a lowercase letter and 66 over a capital. The shared
gap was 28 and 13. It also sets a steep grave or acute with its foot over the
letter's middle, where centring the whole mark put it half its lean to one
side. The Sans asks for both through a new, optional `metrics.accents`, which
`gapFor` and `build.ts` read. The marks that hang below, such as the cedilla
and ogonek, keep the shared gap. Faces that do not set it are unchanged.

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

## What still differs from Geist

- **s counters at the Black.** Close to Geist's size and shape now; Geist's
  upper counter still runs a little more into the terminal, as a teardrop.
- **8 at the Black.** Now as wide as Geist's, but Geist's waist is pinched
  in a deep notch either side, where Draw's two superelliptic rings meet
  almost upright. Oval rings did not pinch it either, and they left lemon-
  shaped counters.
- **#.** The sidebearings are kept just inside the advance. Geist's reach past
  both sides.
- **Backslash at the Black.** It follows the Sans slash, which is about 45
  units narrower than Geist Black's.
- **Ink widths at the Black.** Pen 172 draws a 172 stem where Geist Black's is
  194, so letters with two stems (H, K, R, B) have 25–40 less ink. Their
  advances stay within about 20 of Geist's, because the sides make up the
  difference.
- **m and X at the Light.** They are plain forms, shared with every base. At
  pen 30 the m is about 19 units wider than Geist Thin's and the X 22 narrower.
- **Circumflex, dieresis and tilde accents.** They now stand at Geist's
  height. Geist's dieresis dots are larger and further apart, its circumflex
  lighter, and its tilde flatter.
- **Past 172.** Geist has nothing heavier than Black (its UltraBlack keeps a
  stem of 172). At 200–260 the letters follow their own rules for keeping
  counters open, not Geist.
- **œ.** Not in the review list, and it is still poor past the Black: its o
  counter closes to a crescent. It uses the plain construction, not the Sans
  letters.
- **Ordinal ª.** It now has the right proportions, but past about 200 it is
  very dark at its small size.

## Pictures

`docs/polish/sans/` has before and after images. `specimen-*.png` shows
"sass eyes Sa8 %#^()" at pens 30, 87, 172 and 260. `overlay-*.png` shows
a s e y S 8 % # ^ with the Geist outline in red over the Draw fill, at the
same four weights: Geist Thin at 30, Regular at 87, Black at 172 and
UltraBlack at 260.
