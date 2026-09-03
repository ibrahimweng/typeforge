# Write: the fourth way in

A review of `QUILL_BUILD_SPEC.md` against what this application already has, and
what I would build from it.

---

## The complaint, stated precisely

There are three ways to get a letterform into this application today and each
one asks for something a person who wants to make a typeface may not have.

**Draw** (the forge) asks for none of it and gives none of it back. Twelve
controls, twenty styles, a whole alphabet from a description — and no way to
reach *your own* letter, because the letter is not a thing you touched. It is
the output of a recipe. That is the right trade for a first font and the wrong
one for a second.

**Trace** asks you to already own the font you are trying to make. It reads
somebody's outlines back into strokes, which is a real and unusual capability,
and then hands you ten sliders that reach every letter at once. There is no
per-letter scope switch and the panel says so in as many words. You cannot
touch one stroke of one letter.

**Edit** asks for the skill the whole product is meant to make unnecessary. The
pen quartet, node operations, boolean paths, transforms: fourteen tools, all of
them outline tools. Drawing a letter here means drawing two nearly-parallel
curves and nudging them until the space between reads as a stem. That is what
type designers do and it is precisely the expertise the person in front of us
does not have.

The missing fourth way is the one every calligrapher already knows: **write the
letter once, down the middle, and let the pen have the width.** One skeleton
stroke per pen stroke. It is what the quill engine was built for and there is
no door to it.

---

## What the spec is, and what it is not

`QUILL_BUILD_SPEC.md` is a build bible for a greenfield product — a
skeleton-and-nib stroke engine plus a studio and an Illustrator plugin, cloning
the *technique* of LTTR/INK. Read as a plan for this repository it is mostly
wrong, because it assumes there is no engine yet. There is one, and on several
axes it is ahead of what the spec asks for.

Read as a **specification of the drawing model and the tool surface**, it is
exactly right, and it is the part this repository is missing.

So I would take from it: the per-node nib, the two angle modes, the nib tool,
stroke styles, expand/un-expand, and the calligraphic grid. I would not take:
the repository layout, the boolean/fitting pipeline, the phase order, the
Illustrator plugin, or the file format. We have those, or do not want them.

### Where we are already ahead

| | the spec | here |
|---|---|---|
| width along a stroke | linear between the two node nibs, per segment | a **width profile** with stops at arc-length positions — a stroke that swells in its middle while running dead straight, which a nib cannot fake and the spec cannot express |
| exactness | one tolerance for everything | lines and arcs offset in **closed form**; only cubics and varying widths are sampled, and `exactness` on the result says which was used |
| reading a font back into strokes | absent entirely | the whole of Trace: rasterise, distance field, skeleton, runs, splice, fit, sweep — with a per-letter error harness and eight audited defects |
| outline quality | a node budget and a warning | the same budget, plus the T-series audit that has been fighting for it letter by letter |
| variable fonts | Phase 9, unbuilt | `fvar`/`gvar`/`STAT` shipped, masters and instances in the document, a second axis |
| booleans | "use a boolean-ops lib" | paper, with the nudge-apart rule, four failure modes named, and a containment classifier that a traced `u` was needed to find |

### Where the spec is ahead, and it matters

| # | The spec asks for | We have |
|---|---|---|
| G1 | a nib **at every node** — width, height and angle interpolated along each segment | one nib per **stroke**: `{ contrast, angle }`, constant for its whole length |
| G2 | **rotation**: the nib turns along the stroke (40° → 110°) | nothing. The angle cannot vary. |
| G3 | **expansion** with the two axes independent (200 → 20 on one axis only) | the width profile scales the whole pen, both axes together |
| G4 | absolute (brush) vs relative (noodle) **angle mode** | absolute only, implicitly |
| G5 | a **nib tool**: every node's ellipse on canvas, drag an axis to resize, drag off-axis to rotate | no such tool, and no way to select a node of a stroke at all |
| G6 | **stroke styles** — named nib presets, bound to nodes, edit one and every node using it changes | ten global sliders that move the whole font at once |
| G7 | **expand / un-expand** — bake a stroke to outlines, and get back | export bakes; there is no un-expand and no per-path bake |
| G8 | a **calligraphic grid**: x-height in nib widths, ascender and descender two nibs beyond, one nib width between stems | ordinary metrics guides |
| G9 | interpolate **nibs**, not outlines | masters interpolate outlines by offsetting nodes along normals |

**G2 is the one to look at first**, because it is the one the reference image is
about. Four arches, one skeleton: translation at a constant 40°, rotation from
40° to 110°, expansion from 200 to 20, and zero thickness. We can draw the
first, the third only as a whole-pen taper, and the fourth. The second — a pen
that turns in the hand as the stroke travels — is Noordzij's third mode, it is
half of what makes a Roundhand or a Ruqaa look written, and this engine has no
way to say it.

---

## The decisions

The four questions above were put and answered, and they are what this plan is
built to.

| Question | Answer |
|---|---|
| A mode of its own, or a tool in the editor? | **A tool under the glyph drawing page**, with its own parameters beside it. Writing is a way of making a letter, not a separate room. |
| Keep pressure as well as the pen? | **Keep both, done properly rather than cheaply.** They multiply, exactly as they do in a hand that both holds a broad pen at an angle and presses harder. |
| Should Trace read a *turning* pen out of a font? | **Yes.** |
| Illustrator plugin? | **Not yet.** |

And one instruction about the reference picture: all four of its arches must
work. That is the acceptance test for step 1 and it is the reason step 1 comes
first.

---

## Step 1 — The turning pen

The nib moves off the stroke and onto the spine, as a profile of stops:

```ts
/** The pen at one place along the spine. */
interface NibStop {
  at: number;        // by arc length along the whole spine, 0..1
  contrast: number;  // 0 is a circle, 1 is a blade with no thickness
  angle: number;     // degrees, which way the blade is held
}
type NibProfile = NibStop[];
```

Shaped like `WidthStop`, which already exists, already interpolates by arc
length, and is already what the sweep asks at every sample. One stop is exactly
today's stroke, so nothing that Trace produces changes.

Three things have to be right.

**Arc length, not per segment.** The spec interpolates the nib linearly across
each Bézier segment between two node nibs. Stops at arc-length positions are
better and are what is here already: a stop halfway along is halfway along the
*ink*, it survives a handle drag without moving, and it does not need a node
where the pen happens to change.

**The angle interpolates the short way.** 350° to 10° is twenty degrees, not
three hundred and forty. Under a full turn take the shortest arc; at or beyond
one take the difference as written, so somebody who asks for a full rotation
gets one. This is `§5.6.2` of the spec and item 4 of its anti-patterns, and it
is invisible until a letter turns the wrong way round.

**Contrast may reach one.** The sweep clamps it to 0.95 today. A blade with no
thickness is not an error, it is the value calligraphers reach for and the
fourth arch in the picture. The clamp goes, and the degenerate case is handled
where it arises rather than smoothed over.

`width` stays what it is: the axis the nib is held along. `contrast` gives the
axis across it, as `width × (1 − contrast)`. So the two axes are independently
controllable, which is what the third arch needs, without a second profile to
keep in step.

**Done when** the four arches of the reference picture are drawn from one
skeleton by four nib profiles, in a test and in a picture, and the trace harness
has not moved.

### Done, and one thing found on the way

`scripts/arches.ts` draws all four arches from one skeleton. The trace harness
did not move: worst 93.6, mean of means 6.11, 1101 nodes, because every stroke
the tracer recovers carries a round pen and a round pen is the one case where
none of this changes anything.

**The reach across a stroke was wrong, and badly.** What the sweep wants at each
sample is the pen's *support* in the direction of the stroke's normal, meaning
how far the furthest point of the pen stands out that way. It was computing the
pen's *radius* in that direction. Those are the same number on the pen's own two
axes, which is the only place the test looked, and nowhere else:

| stroke, to the pen's own axis | the swept pen truly reaches | it was drawn at |
|---|---|---|
| 0° | 20.0 | 20.0 |
| 15° | 32.3 | 20.7 |
| 30° | 52.9 | 22.9 |
| 45° | **72.1** | **27.7** |
| 60° | 87.2 | 37.8 |
| 75° | 96.7 | 61.9 |
| 90° | 100.0 | 100.0 |

A pen a hundred units along by twenty across, run at forty-five degrees to its
own edge, was drawn at two fifths of the weight it has. This is why the nib
contrast control was unusable above about a third: every diagonal in the
alphabet collapsed while the stems stayed exactly where they were, so the
control read as "break the letter" rather than as "hold the pen at an angle".
The numbers in the table are the boundary of an actual swept ellipse, found by
walking the pen's outline, and the support formula matches all seven to three
decimal places.

The contrast control now reaches one, where it was clamped to 0.9, because a
blade with no thickness is the fourth arch and the value blackletter and Ruqaa
are written with.

## Step 2 — Write, the tool

A fifth tool group in the glyph editor beside select, pen, shape and knife.
Choosing it puts the glyph into strokes rather than outlines.

- **Skeleton pen.** The existing `pen` and `freehand`, pointed at a spine
  instead of a contour. Click for a corner, drag for a smooth node, or draw the
  line freehand and have it fitted.
- **Nib tool.** Every stop's ellipse drawn on the canvas. Drag an axis end to
  change that axis. Drag off the axis to turn the pen. Drag the middle to move
  the point. Shift snaps the angle to fifteen degrees.
- **The letter, live.** The ink under the skeleton, redrawn as you drag, off the
  main thread. The tracing worker already takes this shape of job.
- **The parameters.** Width, contrast and angle for the selected stop, and the
  hand's own controls for the whole letter, in the panel where the drawing
  controls already are.
- **A written grid.** A guide preset that takes a pen width and an x-height in
  pen widths and lays the four lines. Textura at four and a half, one pen width
  between stems.

**Done when** somebody can draw a blackletter `n` with a pen at 40°, width 60
and no thickness, and it looks like blackletter.

## Step 3 — Saved pens

Named pens, bound to stops rather than copied into them. Change the thick pen
and every stem in the alphabet follows. Detach a stop when it has to be its own.

This is the answer to the complaint that started this. Forty letters stay a
family because they share three pens, not because somebody kept forty sets of
numbers in line by hand.

Ship the calligraphic set as the starting pens: Textura, Ruqaa, Roundhand
thick, middle and thin.

**Done when** three pens applied across a word, one of them edited, changes
every letter that used it and leaves the rest alone.

## Step 4 — Expand, and back

Bake the strokes of a glyph to outlines, keeping the skeleton in the glyph so
**un-expand** works until the outlines have been edited by hand. Then the
fourteen outline tools are the escape hatch: write the letter, expand it, fix
the one curve that is wrong.

That path is also how a written letter reaches Masters, the proof page and the
exporter, all of which take outlines already.

**Done when** a written letter expands, hand-edits cleanly, and un-expands
until it has been touched.

## Step 5 — Trace reads a turning pen

Today the tracer recovers one nib angle for a whole stroke. With stops on the
spine it can recover the angle where the stroke's own thick and thin say it
turned, which is what a script face actually does. Measured against the trace
harness, letter by letter, and kept only if it is better.

**Done when** the harness says so, or the attempt is recorded as rejected with
its numbers.

## Step 6 — Blend the pen, not the outline

Masters interpolate outlines by walking each node along its normal. That is
right for a forge letter and wrong for a written one: two masters that differ in
pen angle pass through shapes no pen ever made. Where both masters are written
and their skeletons line up, interpolate the spine and the nib profile and sweep
the result.

**Done when** an instance halfway between a 40° pen and a 110° pen is drawn
both ways, and the outline-blended one is visibly worse.

---

## What this plan does not take from the spec

- **The pipeline.** Its thirteen steps describe what `sweep.ts` and `fit.ts`
  already do. One idea in it is worth reading before touching the sweep, which
  is reconciling by envelope samples rather than by ring vertices.
- **The monorepo, `.quill`, the Illustrator plugin.** We have a document format
  and an export path, and the plugin is not wanted yet.
- **The phase order, the tolerance formula, the node budget number.** They
  assume a cold start. Ours are measured against real fonts.

The anti-patterns in its §17 are worth reading in full. Four of them are traps
this plan would walk into: the naïve angle blend in step 1, the clamp on
thickness in step 1, assuming the held axis is the longer one, and blending
outlines instead of pens in step 6.
