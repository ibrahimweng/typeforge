# Cut and cast polish

This pass reviewed every cut (slot, saw, chamfer, breaks, inline, counters) and every cast (shadow, rim, points, fillets). Each was checked alone and in pairs, in both orders ("Cut, then cast" and "Cast, then cut"). The checks covered the Draw bases, mainly Sans and Serif, at pen weights 30, 87 (the default), 200 and 260. They also covered opened fonts: Lora, Geist and `src/assets/typeforge-sample.ttf`. Every change has a test that fails on the old code.

Before and after images are in `docs/polish/cuts/`. Each pair is named `<panel>-before.png` and `<panel>-after.png`.

## What was wrong and what changed

### Inline (`src/forge/cut.ts`, `src/forge/cast.ts`)

- **Problem.** The groove was built by sweeping a thin pen down each stroke on its own. Where strokes met, the grooves had to be patched together, and the patches failed. On a, b and g the wall between the bowl groove and the counter pinched to a hair beside the stem. On the Sans a, bars of ink broke up the stem groove. The R had stubs and small windows.
- **Fix.** The groove is now the letter shrunk inwards by one wall thickness. The new `eroded` function does this with the rim's exact convolution run the other way. Both walls are now the same thickness everywhere, including at joins, so pinches cannot happen.
- The skeleton still decides where the groove may run. It runs only in the thick strokes, so the hairlines of a contrast face stay whole. It is held back only at true terminals. The inset is measured from the real edge of the cut, so a terminal cut on a slant, like the tops of a, e and s, stays closed.
- Slivers shorter than they are wide are dropped. These were the white flecks at the ends of the Serif e and s.
- **Opened fonts.** Shrinking needs no skeleton, so the inline now works on opened fonts too (Lora, Geist, the sample). Only the breaks remain skeleton-only, and the `FROM_SKELETON` set in `src/font/cuts.ts` now lists only them.

### Breaks (`src/forge/cut.ts`)

- The Sans a draws its stem twice. The breaks read the two copies as a join and cut a hairline between them. Two strokes where one lies inside the other, or whose straight runs lie along one line, are no longer a join.
- The second arch of an m was slashed across the first arch's shoulder. It is now measured against the middle stem carried on past its bend, so the gap sits flush beside the stem. The extra ink this left standing over the stem, like a horn, is also cut away.
- Each pair of strokes used to be parted only once. The bowl of an R, B, D, P or a kept one of its two joins, and which one depended on the weight. This was the "busy" Black R and B from the earlier notes. The bowl now comes off its stem at both ends. This only applies off a stem, so the bar of an e is still parted at one end only. It also only applies where the far end really runs into the stem, so the Black r keeps its arm.
- **Cast first.** With a rim cast first, the breaks are planned on strokes as fat as the rim made them. The gaps now run through the rim instead of leaving hairlines across them.

### Rim (`src/forge/cast.ts`)

- The inline leaves each counter's wall standing inside the groove as an island. The rim measured the groove as if it were empty, so it grew the groove shut from outside while the island grew into it from inside. Every letter with a counter came out of inline then rim as a solid blob. This was already true before this pass.
- **Fix.** A counter's depth is now measured by the paper actually in it, and the islands grow into it no further than the counter's own edge does.
- The counter step is now also checked against what shrinking can remove. If the boolean library loses the loop, it retries on a snapped grid. This fixed the e.

### Chamfer and points (`src/forge/cut.ts`, `src/forge/cast.ts`)

- A chamfer through an acute corner leaves more than the two corners that points pairs back into one. Examples are the ends of a k's arm and leg, and the terminals of a and e. Each unpaired corner grew a thorn beside the point. Those corners now grow nothing.
- The chamfer measured its cut points along each edge's tangent. On a curve, that point is not on the outline, so the cut left a step beside it. The points are now found along the edge itself.

### Effects after the cuts (`src/forge/effects.ts`)

- Formal Script ships with the pressure effect on. After slots, the effect's clean-up treated the tail loop of a g as a splinter, because the outline comes back near itself. Three fifths of the letter was deleted. A splinter must now also enclose almost no area.
- Pressure rays that strike the side of a cut are now ignored, instead of being taken for the stroke's flank.
- A pressure or skip subtraction that would remove more ink than its tool covers is not applied.

### General (`src/forge/cut.ts`, `src/forge/cast.ts`)

- The crumb sweep after the cuts treated any piece under a third of a stem wide as a splinter. On a contrast face, every hairline a slot passes through is that thin. The threshold is now held to the letter's own thinnest stroke.
- A cut or cast result that crosses itself is resolved with one more union. These were small loops from a chamfer or a saw tooth.

### Second round: every Draw base, and the fixes it turned up

After the first pass, every Draw base was reviewed with every cut and cast (see the task list in the session). Each problem found was fixed, or checked and documented. Before and after images for this round are the second group in `docs/polish/cuts/`.

**Breaks** (`src/forge/cut.ts`)
- **Script exit flicks.** The short flick off the foot of a script H, A or E was cut loose and read as a full stop. It now stays on if it:
  - leaves the end of the stroke it joins,
  - turns back up that stroke,
  - is shorter than three tenths of the x-height,
  - and is longer than a stem or thinner than two fifths of one.

  Square arms, such as a Display E's, still come off, and so do bars that leave a stem part way up (an f, the middle of an E). Panel: `formal-script-breaks`.
- **Curled arms.** The curled arm of a Display or Psychedelic r now stays on instead of coming off as a wedge. Panel: `display-breaks`.
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

  Panels: `serif-saw`, `sans-black-saw`.

**Effects after the cuts** (`src/forge/effects.ts`)
- **Inline on rough faces.** The roughening's slit sweep took the inline's groove for a slit where it tapers. The Brush rounds and most of the Handwriting had no inline at all. A hole of groove size that runs down a stroke's spine is now kept. Panel: `brush-inline`.
- **Press terminals.** The first pass added a rule that skips press rays striking the side of a cut. It also blunted the tapering terminals of uncut Brush and Formal Script letters. A short ray is now believed when the stroke's own outline is that close too, or when it starts on the edge.
- **Check against the session start.** Uncut script letters were compared with the code at the start of the session. All but five of 208 match exactly, and those five differ by under 1%. The exception is the Handwriting t, whose loop used to fill in and is now open.

**Fillets** (`src/forge/cast.ts`)
- Fillets and points no longer leave a speck of their own beside the letter, such as by the link of a Serif g.
- The cast's pinhole floor now ignores the pinholes left where overlapping strokes are united. Panel: `serif-g-fillets`.

**Checked and left as designed**
- **Rim at weight 260.** The rim keeps about 70% of each counter. The plain counters are already that small, and an outward rim closes the narrow apertures of an e and an a.
- **Brush slots.** The strip under the lowest slot band on the Brush is the foot below a band set at the font's shared heights, as on every face.
- **Bowl breaks.** The small bevel at a bowl's break end is the bowl's inner curve meeting the flush cut.

### Third round: the known leftovers

Each leftover from the second round was fixed or checked and documented. Before and after images for this round are the third group in `docs/polish/cuts/`: `sans-black-leftovers`, `roundhand-exits`, `sans-inline-terminals` and `sans-fillets-after-cuts`.

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

### Fourth round: every weight on every base

The earlier rounds swept Sans and Serif at every weight but the other bases at the default only. This round swept all 21 Draw bases at weights 30, 200 and 260 as well, with every cut and cast alone and in pairs in both orders. The final sweep on the finished code found no crossed outlines and no crashes at any weight on any base (the first found eight crossings and one crash). It also added a key sheet per face for a visual check (default weight on all 21 faces, and 30, 200 and 260 on Sans and Serif). Before and after images are the fourth group in `docs/polish/cuts/`.

**Cuts** (`src/forge/cut.ts`)
- **Tongues on slotted joins.** A band laid across a join at a slant cut most of a stroke away and left its corner standing on the next stroke as a tapering tongue: the crossbar of a slotted A on its leg, the arch of a Slab n, the stem under a Serif t's bar. What a knife leaves of a stroke's own ink is now trimmed if it is thinner than a share of that stroke's pen and runs along the knife's edge. A trim that would close a counter or break off a piece is not made: on a heavy Display m it took the middle stem's own corner. Panel: `sans-slots-joins`.
- **Script exits.** On a running hand, the stroke to or from the next letter now stays on under the breaks wherever it leaves from. The exit of a Roundhand u and the lead-in of its a came off as dashes. Panel: `roundhand-breaks-exits`.
- **Folds with the shadow first.** A cut that comes out folded over on itself where the letter went in clean is now made again with the knife on a fine grid. This fixes the heavy Sans and Serif d and the Wavy g, listed as leftovers last round.
- **Chamfer.** The chamfer now leaves a corner square where cutting it off would break a stroke away. The swash of a heavy Formal Script E came off as a piece of its own.
- **Inline on opened fonts.** Flecks of groove smaller than the groove is wide are dropped.

**Casts** (`src/forge/cast.ts`)
- **A crash.** A heavy Display m, slotted and then given a shadow or a rim, threw a stack overflow. A counter pinched shut at a point took the piece beside it for an island, and each took the other for inside it, over and over. The rim and shadow now only recurse into islands while the set gets smaller.
- **Fillets after slots.** Fillets now stay out of everything the cut took away. A fillet grown at a join a slot cut through stood in the band as a bump. Panel: `sans-black-fillets-after-slots`.
- **Points after slots.** Points are no longer grown at corners a knife made. On a Serif e, o and s every band end grew a star. Panel: `serif-points-after-slots`.
- **Opened fonts with the cast first.** Where the cast could not reach an opened font's letter (fillets need strokes), the letter was handed on with its winding unresolved. The chamfer then cut the Lora H's crossbar loose, and the counter motif lost the n. Panel: `lora-cast-first`.
- **Untangling.** An outline is now accepted only when the exact crossing test passes, preferring one the quick test also passes. The quick test samples curves in six and can be wrong either way. Where a leaned letter will not come untangled, the upright one is tried. The cut and the cast also untangle the letter as it will stand leaned, so a chamfered Handwriting s no longer crosses itself.
- **Groove scraps.** Scraps of the inline's groove smaller than a tenth of a stem square, left by a rim or a shadow, are filled.

**Effects after the cuts** (`src/forge/effects.ts`)
- **Press after a chamfer.** The press no longer lays a band along a face a cut made. On the chamfered stems of a heavy Formal Script it left a staircase of ticks. Panel: `formal-script-black-chamfer`.
- **Press after the inline.** The press now measures a grooved stroke with the groove filled, and thins a share of the wall. On a hairline Formal Script it cut the wall through and folded the outline. Panel: `formal-script-hairline-inline`.
- **Specks.** The effects now sweep for specks again after untangling. A speck stood by the leg of a Formal Script k with points after the chamfer. Panel: `formal-script-chamfer-then-points`.
- **Motif on a roughened face.** The cut now hands on the motif's figures, and the filter for cracks leaves them alone. The roughened diamond in a Marker e was filled as a crack, and the e came back solid. Panel: `marker-motif`.

- **Hairs and crumbs on the Brush.** Found by the final sweep.
  - Where the roughened outline comes back to exactly a point it passed through, and the loop between encloses nothing, the loop is dropped. A point grown on a saw tooth of a Brush e came back as a hair of no width.
  - A point on the thin terminal of a light Brush e stood on a neck that the pressure thinned and the roughening parted. It came back as a crumb beside the letter. The cast now hands on what it grew. After the effects, a piece that broke off one they were given is dropped if it is under half a stem square and is mostly a point or a fillet.
  - A first version dropped any small piece that broke off, and took the tail of a heavy Casual Script p and the exit of its a with it. Those are the letter's own strokes, which that face's roughening parts at weight 260. They are kept again, and a test holds them.

**Checked and not faults**
- **Serif g at 30 and Monoline Script e and t at 200 and 260.** The "lost" holes are pinholes of a few hundred square units or less in the plain drawing. The effects rightly fill them.
- **Inline on an s at 260.** The groove in each terminal stroke is a short dash of its own, because the groove is laid stroke by stroke and ends square at a join.

## Tests

The new tests are in `src/forge/cuts-cast-polish.test.ts`, `src/forge/cut.test.ts` and `src/font/cutting.test.ts`. Three older tests described the old behaviour and were updated:
- The inline used to be kept out of opened fonts. Those tests now use the breaks, which are still skeleton-only.
- A bowl's groove used to stay separate from the stem's. The test now checks instead that no wall pinches.

`npx tsc -b --noEmit`, `npx biome check .` and `npx vitest run src/forge src/font` all pass, with 1791 tests. One older test, the exchange test that cuts slots through a whole opened font, runs close to its 30-second limit on this machine: about 28.4 seconds alone, against 27.6 seconds before this pass. Under full-suite load it once went over.

## Known leftovers

- **Formal Script E foot.** The thin sliver under the foot is in the plain drawing, with or without pressure. It is not made by a cut or a cast.
- **Casual Script at 200 and 260.** The plain letters are already drawn in broken fragments at these weights (the p's descender, the t). The cuts and casts work on the fragments, so piece counts change. This is in the base drawing, not the cuts.
- **Plain letters that cross themselves.** On several bases a few plain letters cross themselves before any cut (for example the Typewriter g, k and s). This is in the base drawing.
- **Small ticks on a heavy Formal Script chamfer.** At weight 260 the chamfered H is clean, but the end of the E's middle arm and the k's arm keep a small tick where the press meets the cut corner.
- **Inline with a shadow or rim at weight 260.** The shadow or rim closes most of the groove. What is left open to the paper can show as slivers on a k, g or p.
- **Shadow cast first.** With the cast first, a shadow followed by breaks shows the breaks as windows in the shadow. This is what "Cast, then cut" means: the block and its shadow are sliced as one.
