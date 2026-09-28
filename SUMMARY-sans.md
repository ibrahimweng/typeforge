# Sans polish: summary

Branch `claude/polish-sans`. The goal was to make Draw mode's Sans match Geist
letter for letter from Light (pen 30) through Regular (87) and the heavy weights, and
stay clean up to the slider maximum (260). Each change was checked against the
Geist npm fonts (Thin, Regular, Black and UltraBlack), with the Geist outline
laid over the Draw fill at the same scale.

## Reference weights

Draw's pen is the stem, so each pen is compared with the Geist font that has
that stem: pen 30 with Geist Thin (a stem of 30), 87 with Regular (84), 130
with SemiBold (128), 172 with **UltraBlack** (172) and 194 with Black (194).
The Sans was first built on an older Geist whose Black had a 172 stem; the
current Geist ships that weight as UltraBlack and has added a heavier Black.
Part of this branch had measured the current Black (194) and aimed it at pen
172, which made those letters 12 to 34 units too wide there. They now reach the
current Black at pen 194 (`squaredNow` in `grotesque.ts`) and land on
UltraBlack at 172. Against UltraBlack, the Sans's n and H at 172 are exact.

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

**Spacing at the Light (shared file, Sans only).** Geist Thin sets its
letters about 5 units further off either side than its Regular, and its
figures 10. The Sans kept the Regular's spacing all the way down. It now
opens by `metrics.lightHeld.open` as it thins, applied where `build.ts` fits
a letter's sides. Only the Sans sets `lightHeld`, so no other face changes.

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
- **8's waist.** Now as wide as Geist's, with the same waist and counters,
  but Geist's waist is notched 135 units in either side at the Regular (150 at
  the Black). Draw's two stacked rings are notched 90 (75). Geist's strokes
  cross in an X there. Rounder rings deepened the notch only to 109 and left
  lemon-shaped counters. Pulling the rings apart matched the notch but made the
  waist half as thick again. Matching it needs the eight rebuilt as crossing
  strokes.
- **#.** The sidebearings are kept just inside the advance. Geist's reach past
  both sides.
- **Backslash at the Black.** It follows the Sans slash, which is about 45
  units narrower than Geist Black's.
- **m and X at the Light.** They are plain forms, shared with every base. At
  pen 30 the m is about 19 units wider than Geist Thin's and the X 22 narrower.
- **7 at the Light.** Geist Thin opens its figures by 10 a side, but not its
  7. The Sans opens all of them, so its Thin 7 stands 10 further off.
- **Past 194.** Geist has nothing heavier than its Black. At 200–260 the
  letters follow their own rules for keeping counters open, not Geist.
- **œ.** Not in the review list, and it is still poor past the Black: its o
  counter closes to a crescent. It uses the plain construction, not the Sans
  letters.
- **Ordinal ª.** It now has the right proportions, but past about 200 it is
  very dark at its small size.

## Pictures

`docs/polish/sans/` has before and after images. The before images are from
the branch's starting point, 3050e21. `specimen-*.png` shows "sass eyes Sa8
%#^()" and "[a]{b} <+=>~_ $@& àéñ WAY7r" at pens 30, 87, 172 and 260.
`overlay-*.png` shows a s e y 8 S $ @ & [ { < ~ with the Geist outline in red
over the Draw fill, at the same four weights: Geist Thin at 30, Regular at 87,
UltraBlack at 172, and Black (the heaviest Geist) at 260.
