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
- **The ?'s terminal.** Geist cuts its hook's left end on a slant at the
  heavy weights, so its lower corner stands about 24 units in from Draw's
  level cut 500 up.
- **The 6's hood and the 9's bowl.** Geist's hood is a little lighter than
  Draw's at the heavy weights (165 across 500 up at the UltraBlack against
  175). At the Black the 6's lower left still stands 10 to 14 units out
  past Geist's, and the 9's upper right 17 to 23: rounder quarters, down to
  a circle's, and a bowl tilted up to 12 degrees either way took less than
  a twentieth more off.
- **Heavy b, d, p and q.** Geist's bowl meets the stem in a V notch at the
  top and bottom from the SemiBold on, and its counter is rounder than its
  outside, so its crowns are heavier near the right corners (187 across 420
  in at the UltraBlack, on a stem of 172). Draw's bowl is one ring on the
  pen, running flat into the stem. A lopsided ring, a fuller outer ring laid
  over a rounder inner one, and an open bowl ending inside the stem each
  measured no closer: the letters already cover Geist's to within 5 to 7 per
  cent of its area.
- **The heavy s.** From the SemiBold on, Geist's s has a thin diagonal
  spine and teardrop counters. Draw's has a level spine and counters flat
  where they meet it. It covers Geist's to within 13 to 19 per cent of its
  area.
- **The Thin &.** Its lower bowl is now a little wider at the Thin and
  its sides open with the face's light opening. It still misses Geist
  Thin's ink by half, and 87's by a seventh. Geist's loop is wider at its
  crown and narrower where it crosses, and its arm is shorter. That needs
  the loop drawn on two widths.
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
`overlay-more-after.png` shows the letters fitted to Geist's ink in the last
pass (2 3 4 5 6 7 9 ? , D B P R Q K k x M W f t) at 30, 87, 172 and 194,
against Geist Thin, Regular, UltraBlack and Black.
