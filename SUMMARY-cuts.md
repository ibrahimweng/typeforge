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

## Tests

The new tests are in `src/forge/cuts-cast-polish.test.ts`, `src/forge/cut.test.ts` and `src/font/cutting.test.ts`. Three older tests described the old behaviour and were updated:
- The inline used to be kept out of opened fonts. Those tests now use the breaks, which are still skeleton-only.
- A bowl's groove used to stay separate from the stem's. The test now checks instead that no wall pinches.

`npx tsc -b --noEmit`, `npx biome check .` and `npx vitest run src/forge src/font` all pass, with 1760 tests.

## Known leftovers

- **Heavy n, m and h at weight 260.** The gap is about 4 units wider than the counter below it, which leaves a small step on the inside of the leg.
- **Inline terminals.** The hold-back leaves a jog of about 3 units where the groove meets it. It shows only when zoomed in.
- **Self-crossings.** A few outlines still report one self-crossing in the sweep:
  - Formal Script h, m and e with slots or a cast after the breaks,
  - Serif 260 B, R and p with the saw,
  - the Display s with chamfer.

  Nothing is visible at any size rendered.
- **Serif g with fillets.** A small notch remains at the top of the link.
- **Script breaks.** A thin sliver is left under the foot of the Formal Script E. The Roundhand and Formal Script tails that are longer than the flick limit still come off as dashes.
- **Slots at weight 260.** A small spike is left on the k's leg.
- **Shadow cast first.** With the cast first, a shadow followed by breaks shows the breaks as windows in the shadow. This is what "Cast, then cut" means: the block and its shadow are sliced as one.
