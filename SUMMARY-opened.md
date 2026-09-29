# Opened fonts under the Edit-mode controls

This pass made opened fonts hold up under every Edit-mode control, and under combinations of them. The test fonts were Lora 400, Geist Regular and the bundled sample font. Every setting was rendered at its extremes, and pairs were rendered too, such as weight 0.06 with width 0.7 and radius. Each letter was checked zoomed in, with and without its outline points shown.

Before and after images are in `docs/polish/opened/`. Each pair was made from the commit this work started on (`3050e21`) and from the end of this branch, with the same settings. The blue lines mark the baseline, x-height and cap height.

## What was wrong and what changed

### 1. Condensed heavy letters closed their counters

At weight 0.06 and width 0.7, the eye of e, the bowls of a, o, b, d and B, and the apertures of s and S closed to crumpled specks and cracks. This happened in all three fonts.

The cause: after the width scaling, the width control puts back the stem thickness the scaling took off. But Lora's e at that setting is narrower than two of its stems, so there is no room for them.

The weight engine now takes a share of white to keep, and the width control asks for it. When the strokes are put back, they close only a little of the white they face, and give way where there is no room. This is how a condensed heavy cut is drawn. On the outside of a letter this is measured point by point. A counter instead keeps a minimum mean width (twice its area over its length round), and the whole counter backs off evenly, so it keeps its shape.

Images: `condensed-heavy-lora-*`, `condensed-heavy-sample-*`.

### 2. Dots fused with their stems

When weight was added, every other ink contour of a letter was ignored. That is right for strokes that overlap, but wrong for pieces drawn apart. At the heaviest weight the dots of i and j grew into their stems, so jij read as JIJ. The same happened to ! ? " = and ä.

A contour now measures against the other ink contours that are clear of it. The paper between them keeps a share of itself as well as a minimum opening.

Images: `dots-geist-*`.

### 3. Slab serifs

- **Spacing:** slabs ran past the letter into its side bearings, so neighbouring letters joined along the baseline. The letter now moves over and its advance grows by what the slabs add, so a slab serif is spaced from the tips of its serifs.
- **Weight:** slabs were weighted as overlapping contours. So a light k, x or A stood on heavy blocks, and heavy letters had notches. Slabs are now kept aside while the letter takes its weight, then resized as the bars they are and added back.
- **Cracks:** two slabs that would end a crack apart, such as the feet of k and the arms of x, are joined into one.
- **Conventions:** the fixes follow what slab serifs such as Rockwell and Roboto Slab do.
  - Dots get no slabs.
  - Punctuation gets no slabs.
  - The top of a t, a stub on its crossbar, is left plain.
  - The tops of lowercase stems and of figures get a flag to the left, not a bar across.

Images: `slabs-geist-*`.

### 4. Weight moved letters off the baseline

The weight engine grows the outline in every direction. So a bolder letter dropped below the baseline and rose past its x-height or cap height by the weight: 60 units each way at the heaviest setting. A lighter letter floated and shrank. A single letter given its own weight fell out of the line.

After the weight, a letter is now pinned back to each edge it was drawn to: its descender bottom, the baseline, the x-height or cap height, and its ascender top. It is eased in straight lines between those pins. Each edge moves back by what its own points actually did (the median), not by the weight setting. This matters because a thin serif made lighter keeps a third of itself and moves less than the weight. Handles follow the slope of the map at their point, so smooth points stay smooth.

A mark placed by its middle, such as a hyphen or bullet, touches neither edge and stays where it is. A period or a quote goes back to the one edge it touches. As a side effect, bold horizontals come out a little lighter than bold stems, which is how a bold is drawn.

Images: `heights-lora-*`.

### 5. Ball terminals and dots at light weights

At the lightest setting, Lora's ball terminals (a, c, f, r, j, 2, 3, 5) and the dots of i and j came out the weight of the hairlines, as bumps and specks. A light cut keeps them full.

Taking weight off, a ball now gives up half as much as a stroke does. A ball is recognised by its chords. A ray aimed 50° off straight across is shorter than the straight ray on a round blob, and longer across any stroke, bowl or rounded stroke end. A dot is a small, roughly square or round piece of ink standing clear of the rest; it is treated the same way.

Images: `balls-lora-*`.

### 6. Side bearings after weight

A heavier letter was moved over by the weight, and its advance grew by twice the weight. That is right for a stem, but the level-cut foot of a diagonal runs out further on its mitre. At the heaviest weight the sample font's k reached a tenth of an em into the next letter, and x and v into both neighbours.

The ink's actual growth on each side is now measured, and the shift and the advance follow it. The advance reads this from a cache keyed on the glyph and its settings.

Images: `sidebearings-sample-*`.

### 7. Steps at aperture tips

At the heaviest weight, Lora's a, s and 2 had steps of about 10 units where the weight swallowed the end of an aperture: a run of short curve pieces left behind as the stroke closed up.

Such a run is now laid along one round curve, joined smoothly to the outline either side of it, with the same number of points. Runs with a straight piece in them are left alone, so a stem foot stays straight. If the rounded run would make the outline cross itself, the run is left as it was.

Images: `apertures-lora-*`.

### 8. Edges that share a baseline

Each edge used to move back by one amount. Where a thin bowl bottom and a stem foot share the baseline, as in a light b, the bowl's overshoot ended up about 14 units deeper than drawn.

Moving the pins now tells only where the outline runs level. After the pins, a smooth correction brings back whatever is still off the edge. It only ever moves points inward, and it fades out within a tenth of an em of the edge. A contour it would make cross itself is left as the pins placed it. In all three fonts, every letter's extents now stay within 2 units of the drawing at −0.04 and 0.06.

### 9. Middle space

Closing or opening a counter used to thin or thicken the walls round it by the whole change. At 0.6 the letters with counters set as a bold beside H, n and m, and at 1.4 as a light.

- **Walls follow the counter across.** The ink beside a counter now moves with it, so a closed o is a narrower o with the strokes of the rest, and an opened one a wider o. Round walls and upright stems both follow. Leaning walls, such as the legs of an A, stay where they are.
- **No vertical change when closing.** A closing counter keeps its height, since top and bottom walls can't follow without changing the letter's height.
- **No corner in the map.** The shift blends into the wall's movement over a short run either side of the counter's edge. With a corner there, a closed o came out pointed top and bottom.
- **Stacked counters move together.** The two bowls of a B move their shared stem alike, and together. Moved one after the other, the stem leaned.
- **Spacing.** The side bearings follow the measured change in the ink.

Images: `middle-geist-*`, `middle-lora-*`.

### 10. Slabs on beaks

Lora's S is all curve and measures thinner than its stems, so the tips of its beaks passed for stroke ends, and each got a bar. The top of Lora's 5 flares from a hairline arm into a beak, and a bar stood on that too. Stroke ends are now also measured against the font's stems, and an end much wider than the stroke just behind it counts as a beak, not an end.

Images: `slabs-lora-*`.

### 11. Found by sweeping every glyph

The screenshots show about 28 letters. So I also swept every glyph of the three fonts (602 in all) under 40 settings and combinations, checking for crossed outlines, changed point counts, height drift and ink past the advance. Those checks found:

- **Heavy condensed diagonals:** v, w, x, y, K and M at weight 0.06 with width 0.6 ran up to 0.12 em past their advances. The width control puts back the strokes the condensing took off, and that runs a diagonal's feet out on their mitres. What it adds on each side is now measured, and the letter is spaced by it.
- **Crossbar lowered:** a lowered bar extends the 4's diagonal down to meet it, and the corner came out 60 units into the side bearing. The crossbar and shoulder controls now space the letter by any ink they put beside it.
- **Dotless j:** it was taken for a capital, since it has no uppercase form, so its top was held to the cap height and rose past the x-height by twice the weight. Lowercase is now read from the letter's Unicode category. Letters are also no longer pinned at a line their strokes only pass through.
- **Light u and N:** at −0.04, Lora's u stood 20 units under its x-height and its N 6 over its cap height. Four changes fix this:
  - An edge's move is now taken from the points nearest its line.
  - Top and bottom are corrected separately.
  - A point belongs to the edge it was drawn on.
  - A light letter's edges may now be corrected outward, and a correction never carries an edge point past where it was drawn.

Images: `condensed-diagonals-geist-*`, `crossbar-four-geist-*`, `dotless-j-geist-*`, `heights-light-lora-*`.

### 12. Found in closer screenshots

- **Folded inside corners:** at weight 0.06 with width 0.7, the small inside corner where the tail of Geist's j meets its stem folded into a notch, and the y's did the same. Where a piece of outline now runs back the way it came, it is laid flat against the stem.
- **Stacked counters:** each map eased to nothing halfway across the gap between two stacked counters, so the wall there dented, and the serif on Lora's & arm sheared. The maps now hand over across the whole gap.
- **Slab flags:** a flag reaches out to the side of its stem, and it was tested for sitting on the letter only at its middle, which misses the stem. Heavy, every lowercase flag grew past its stem's top, and on Geist's i and j it met the dot. The test now runs along the whole edge.
- **Slab beaks:** the beak on the sample font's f hung below its hook at heavy weights, nearly closing on the crossbar. A slab end flush with the letter's edge now follows that edge.
- **G spur:** its foot bar reached over the bowl it stands on. A slab no longer reaches out on a side where the stroke is joined to ink.
- **Upright edges between stacked counters:** after the handover fix, the & serif still leaned 19 units at 1.4. Each straight upright run of the outline, however many points it has, now moves across whole, by the shift at its middle.
- **Rim:** the boolean step that builds the rim could leave a tiny figure-eight in the outline of Lora's a and its six accented forms. Its area was right, so the existing retry never caught it. Now each solid's rim is rebuilt on a grid when it crosses itself: a thousandth of a unit, then a hundredth, then a tenth, each coarser than the last. The finished rim is checked once more after the counters are cut out and joined, and rebuilt once if it still crosses. This change is in `src/forge/cast.ts`, which you approved going into.

Images: `folded-corners-geist-*`, `stacked-counters-lora-*`, `slab-flags-geist-*`, `slab-beak-sample-*`.

### 13. Review

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

Images: `light-joins-geist-*`, `light-joins-lora-*`, `parts-apart-geist-*`, `parts-apart-lora-*`.

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
- **A letter the weight couldn't move was squeezed.** Crimson Pro draws its 4 as one contour crossing itself, and the weight's crossing check can't follow those crossings, so the weight leaves it as drawn. The heights were then put back by the weight it would have grown, and it came out 51 units shorter at each end. Where the weight moved nothing, the heights are now left alone. (The 4 not growing is still open: see What is left.)
- **Double work.** Taking the lift off before the heights had the weight stage weigh every contour twice; 300 glyphs of Lora Bold at weight 0.06 took 6.2 s. It weighs once again, and takes 2.9 s (3.1 s before this round).

Images: `accents-lorabold-*` (h, A, l and t with their accents, and Ŗ), `corners-outfit-*` (N, Ñ, ¼, ¾) and `corners-crimson-*` (Y, A, Δ, N, 4), each at rest, at weight 0.06, and at 0.06 condensed to 0.6.

## Tests

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

These checks all pass: `npx tsc -b --noEmit`, `npx biome check .`, and `npx vitest run`, the whole suite of 2,934 tests.

## What is left

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
  - the between-contour check being told which pairs to skip, which only saves work.
  An independent check of every glyph under every setting confirms none of the outlines cross.
- **Corner radius** adds points by design, since it rounds corners with new curves.
- **Heavy counters.** At weight 0.06, Geist's B and R counters shrink to slits. That comes from Geist's own proportions at that weight.
- **Pieces side by side.** They keep half their white, up to 18 units, by being weighed lighter; condensed, all the white the condensing leaves them. At weight 0.06 and width 0.6 that is about 14 units between the dots of Geist's ◌ and the strokes of its 〃.
- **Heights the controls change by design.** The sweep reports every glyph whose top or bottom moves. Most of these are intended: an accent or dot keeps clear of its letter by moving; a mark that touches no line, such as a period, a comma or a subscript figure, grows both ways; a slant moves a letter's top sideways. The scans for letters against themselves alone, and plain letters against where they were drawn, are what tell real faults from these.
- **Fractions at the heaviest weight.** The pieces of a ¼ keep clear of each other, but the one squeezes to do so: at weight 0.06 Outfit's is about a quarter shorter from below. Condensed as well, it can't keep its whole top on the cap height; it stands 37 units over it.
- **Found and not yet fixed** (next on the list):
  - Crimson Pro's 4 doesn't grow at all under the weight: it is one contour crossing itself four times, and the crossing check can't follow those crossings through the weight, even where the weighed 4 still crosses itself exactly four times. It is one of 2 such contours out of about 700 drawn crossing themselves in the eight fonts.
  - Crimson Pro's u under an accent (û, ȗ, ữ) stands about 30 units short of the u alone. Its tops are curves, and only a corner between straight sides is put back where an accent held it. Its 1 stands 33 units over its height, from the pointed tip of its flag.
  - Slabs on the small figures of Outfit's ¼ and ¾ meet each other and the slash at weight 0.06 with slab on. The sweep's crossing check doesn't look at slab pairs.
- **Chevrons at the heaviest weight.** The chevron of a ≥ or ≤ keeps its 18 units of white over the bar by rising, after giving up a quarter of its height. At weight 0.06 the symbol stands 145 to 155 units taller in Geist, Lora Bold, Plex and Work Sans, and 148 in Crimson Pro. Before this round the heights squeezed the chevron without that limit, and it rose 92 to 162 depending on the font, with the bar lighter.
- **Two controls on one gap.** Each control keeps half of the white it is handed, so the crossbar and the heaviest weight together leave Geist's ť about 9 of its 22 units.
- **Pointed ends.** At weight 0.06 the ends of a chevron's arms run out along their mitres, as the weight engine draws any sharp corner away from an edge line; that, and keeping the chevron clear of the bar, is most of the height the ≥ above gains.
