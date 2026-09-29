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
- **Upright edges between stacked counters:** after the handover fix, the & serif still leaned 19 units at 1.4. Straight upright edges are now moved across whole, by the mean of their two ends.
- **Rim:** the boolean step that builds the rim could leave a tiny figure-eight in the outline, on Lora's a and the sample font's n and h. Its area was right, so the existing retry never caught it. A result that crosses itself now also goes to the next, finer grid. This change is in `src/forge/cast.ts`, which you approved going into.

Images: `folded-corners-geist-*`, `stacked-counters-lora-*`, `slab-flags-geist-*`, `slab-beak-sample-*`.

### 13. Review

A code review of this round's changes found two more, both fixed:
- The edge clamp could change a stroke's weight inside a letter. It now applies only to points on the edges.
- A slab end flush with the letter could shrink to a sliver at light weights. It now keeps the same minimum as any other slab.

## Tests

Every fix has a test that fails on the old code and passes now. They are in:
- `src/font/shape-controls.test.ts`
- `src/font/weight.test.ts`
- `src/font/slab.test.ts`
- `src/font/counter.test.ts`
- `src/font/control.test.ts`

Two old expectations in `weight.test.ts` described letters growing past the baseline and cap height; they now expect the letter to keep its heights. The middle-space expectations in `counter.test.ts` and `control.test.ts`, which had walls thickening or thinning by the whole change, now expect walls that keep their weight while the letter narrows or widens. The weight engine keeps each contour's point count, and slabs are still separate contours added to the letter.

These checks all pass: `npx tsc -b --noEmit`, `npx biome check .`, and `npx vitest run`, the whole suite of 2,881 tests.

## What is left

- **Middle space and colour.** Measured as ink per unit of advance, letters with counters at 0.6 come out up to 10% denser than at rest (Lora's b, d, p, q), and at 1.4 up to 10% lighter. That is the white the control removes or adds while the strokes keep their weight. Thinning or thickening the walls to compensate is what squared the round letters earlier.
- **The edge-only clamp has no test of its own.** In every case I could build, and in all three fonts, it gives the same outline as the clamp it replaced, so no test can fail on the old code. It stays as a safeguard.
- **Corner radius** adds points by design, since it rounds corners with new curves.
- **Heavy counters.** At weight 0.06, Geist's B and R counters shrink to slits. That comes from Geist's own proportions at that weight.
