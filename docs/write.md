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

## What I would build

Five steps. Each is a merge on its own and each is worth having if the next one
never happens.

### 1. The nib per node

`Nib` moves from the stroke to the spine, and gains its second axis:

```ts
/** The pen at one point along the spine. */
interface NibStop {
  at: number;        // arc length along the whole spine, 0..1 -- as WidthStop
  width: number;     // the axis aligned with `angle`
  height: number;    // the axis across it. 0 is legal: a razor blade.
  angle: number;     // degrees, absolute or relative per the spine's mode
}
```

This is deliberately shaped like `WidthStop`, which already exists and already
interpolates along arc length. The two merge: a `WidthProfile` becomes the
degenerate `NibProfile` where every stop shares an angle and a height ratio, and
the migration is mechanical. Keeping stops at arc-length positions rather than
per-node is our answer to the spec's §5.6.1 — it is what the sweep already does
and it survives a handle drag better than per-segment linear.

Angle interpolation takes the spec's rule verbatim (§5.6.2): shortest arc under
a full turn, raw difference at or beyond one, `+180` on the tie. That rule is
right, it is cheap, and getting it wrong is invisible until a letter rotates the
wrong way round.

Cost: `sweep.ts` reads one nib where it will read a profile; `fit.ts` writes one
where it will write several. The tracer keeps emitting single-stop profiles and
nothing about Trace changes.

### 2. Write — the mode that is missing

A fourth mode beside Draw, Trace and Assemble, and the front door to the whole
thing. You draw a skeleton and the pen follows it.

- **Skeleton pen.** The existing `pen` and `freehand` tools, pointed at a spine
  instead of a contour. Click for a corner, drag for a smooth node, draw a line
  freehand and have it fitted. This is the tool people already know.
- **Nib tool.** The spec's signature tool and the reason this is not just a
  panel of numbers. Every node's ellipse drawn on the canvas; drag an axis
  endpoint to change that axis, drag off-axis to rotate, drag the body to move
  the node. Shift snaps the angle to 15°. §10.4 gives the arithmetic and it is
  four lines.
- **Live sweep.** The letter under the skeleton, redrawn on every pointer move,
  off the main thread — the tracing worker already exists and takes the same
  shape of job.
- **The grid.** A document preset that takes a nib width and an x-height in nib
  widths and lays the four guides. Textura at 4.5 nibs, Roundhand at 5, and one
  nib width between stems. This is a small thing that makes the mode legible to
  somebody who has held a broad-nib pen and has never opened a font editor.

### 3. Stroke styles

This is the answer to "requires too much technical know-how", more than any
other single item.

Three named nibs — thick, middle, thin — bound to nodes rather than copied into
them. Edit the thick one and every stem in the alphabet follows. Detach a node
when it needs to be its own. That is how a person keeps forty letters
consistent without knowing what consistent means numerically, and it is the
difference between ten sliders that move everything and a tool that moves the
right things.

Model, operations, the resolver and the adjustment-mode gate are §8 of the spec
and I would follow it closely. Ship the calligraphic presets of §19 as the
starting set.

### 4. Expand, and back

Bake a stroke to outlines with the skeleton kept in the glyph, so **un-expand**
works until the outlines have been hand-edited. Then the fourteen outline tools
become the escape hatch they should always have been: write the letter with a
pen, expand it, and nudge the one curve that is wrong.

That path — write, expand, edit — is the whole product argument. It is also the
route by which a Write letter reaches Masters, the proof page and the exporter,
all of which take outlines already.

### 5. Interpolate the nib

Masters currently interpolate outlines by walking nodes along their normals,
which is right for a forge letter and wrong for a written one: two masters that
differ in pen angle interpolate through shapes no pen ever made. Where both
masters are stroke-drawn and compatible, interpolate the **spine and the nib
profile** and sweep the result. The spec's §9 is the model and its Phase 9 DoD
— expand each master separately, interpolate the outlines, and show that it is
visibly worse — is a test worth writing.

---

## What I would not take from the spec

- **The pipeline.** §5.12's thirteen steps describe what `sweep.ts` and
  `fit.ts` already do, with a different vocabulary and one genuinely good idea
  (§5.9's reconcile-by-envelope-samples) that is worth reading before touching
  the sweep, and no reason to rewrite around.
- **The monorepo, the plugin, `.quill`.** We have a document format, an export
  path and no Illustrator ambitions.
- **The phase order.** It assumes a cold start.
- **`evenodd`, the node budget number, the tolerance formula.** Ours are
  measured against real fonts.

The anti-patterns in §17 are worth reading in full regardless. Four of them —
naïve angle lerp, clamping height to a minimum, assuming the long axis is the
width, interpolating outlines instead of nibs — are traps we would walk into
in step 1 and step 5 if nobody had written them down.

---

## Questions

1. **Where does Write live?** A fourth mode beside Draw, Trace and Assemble, or
   a tool group inside the editor? A mode gets its own canvas and its own
   panel, which suits a nib tool; a tool group means one letter at a time in a
   font that already exists, which suits fixing a `g`. I lean mode, and would
   put a "write this letter" action in the editor pointing at it.

2. **Does the width profile survive?** The per-node nib can express most of what
   pressure does, and the spec has no equivalent. Keeping both is more model
   than either alone needs, and the width profile is what Trace produces. I lean
   keep — profile and nib multiply, exactly as they do in the hand — but it is
   two things to teach instead of one.

3. **How far does the traced font come along?** Once nibs are per node, Trace
   could recover a *varying* angle from the outline rather than a constant one,
   which is a genuinely better fit for a script face and a piece of work in its
   own right. Step 1 makes it possible; I have not costed it.

4. **Is the Illustrator plugin ever wanted?** It is a third of the spec. I have
   assumed not.
