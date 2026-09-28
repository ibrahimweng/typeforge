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

**8.** Heavy weights use the same lighter pen plus a slightly wider ring, so
the upper counter stays an oval past the Black instead of a slot.

**^.** New Sans caret, measured off Geist: narrow and upright, with a level head
on the cap line and level feet at 383. The plain one was a wide, low chevron.

**%.** Re-measured against the current Geist. The rings are taller and heavier,
the lower ring sits in the right place, and the slash leans as Geist's does.
Past the Black the crowns stop getting heavier and the rings move apart, so the
counters stay open at 260.

**#.** The bar ends are cut along the lean of the uprights, as Geist's are.
Light weights no longer spread wider than Geist Thin.

**( ).** The sidebearings now match Geist's: 45 on the opening side and 15 on
the closing side.

**: ;.** The upper dot now sits at Geist Regular's height (506). The old code
had a mis-measured 0.87 of the x-height there.

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

- **s counters at the Black.** Geist's are a little taller and more oval than
  Draw's round-ended ones, and past the Black Draw's close to slots.
- **8 at the Black.** Geist's eight is wider with a pinched waist. Draw's is
  two rings touching, and its counters are larger.
- **@.** It is close at the Regular. At the Black the ring is heavier and
  narrower on the right, and at the Light the tail is shorter than Geist's.
- **#.** The sidebearings are kept just inside the advance. Geist's reach past
  both sides.
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
