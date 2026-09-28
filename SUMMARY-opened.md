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

## Tests

Every fix has a test that fails on the old code and passes now. They are in:
- `src/font/shape-controls.test.ts`
- `src/font/weight.test.ts`
- `src/font/slab.test.ts`

Two old expectations in `weight.test.ts` described letters growing past the baseline and cap height; they now expect the letter to keep its heights. The weight engine keeps each contour's point count, and slabs are still separate contours added to the letter.

These checks all pass: `npx tsc -b --noEmit`, `npx biome check .`, and `npx vitest run` (the whole suite, 2,863 tests).

## What is left

- **Middle space at 0.6.** The control closes counters by thickening their walls. So at the far end, letters with counters are darker than letters without them. The code documents this as the limit of a control that moves only counters. Fixing it would change what the control does.
- **Small steps at aperture tips.** At the heaviest weight, Lora's a, s and 2 have steps of about 10 units, roughly 1% of the em, where the aperture closes. I tried smoothing them, but it turned the steps into small nibs, so I left them as they are.
- **Shared baseline edges.** Where a thin bowl bottom and a stem foot share an edge, as in a light b, the bowl's overshoot can end up about 14 units deeper than drawn. Correcting single points put lumps into the curves, so each edge moves by one amount.
- **Corner radius** adds points by design, since it rounds corners with new curves.
- **Rim in Geist.** One run of the effects sheet flagged a crossed contour on Geist's a under the rim cast. It did not reproduce on four later runs. The cast code is outside the files changed here.
