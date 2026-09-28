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

## Tests

The new tests are in `src/forge/cuts-cast-polish.test.ts`, `src/forge/cut.test.ts` and `src/font/cutting.test.ts`. Three older tests described the old behaviour and were updated:
- The inline used to be kept out of opened fonts. Those tests now use the breaks, which are still skeleton-only.
- A bowl's groove used to stay separate from the stem's. The test now checks instead that no wall pinches.

`npx tsc -b --noEmit`, `npx biome check .` and `npx vitest run src/forge src/font` all pass, with 1746 tests.

## Known leftovers

- At weight 260 the gap swallows the whole counter of the m and n arches. This leaves a small notch where the band ends.
- The terminal hold-back on the inline leaves a jog of about 3 units where the groove meets it. It shows only when zoomed in.
- A few script letters with complex outlines still report one self-crossing in the sweep: the Display s with chamfer, and the Formal Script s and n with some effects. Nothing is visible at any size I rendered.
- With the cast first, a shadow followed by breaks shows the breaks as windows in the shadow. This is the documented meaning of "Cast, then cut": the block and its shadow are sliced as one.
