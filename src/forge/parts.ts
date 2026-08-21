/**
 * The named parts, and who uses them.
 *
 * A part is a decision that more than one letter reads: how far a serif
 * projects, where an arch springs, how a stroke ends. There is one copy of each
 * decision, so changing it changes every letter that consults it -- which is
 * the whole point. Draw the slab you want on a p and what you have actually
 * edited is the slab, so the b, the d, the h, the i, the k, the l, the m and
 * the rest all wear it the next time they are drawn.
 *
 * Two things have to be known for that to be usable rather than merely true.
 * Which parts a letter has, so the editor can offer them; and which letters a
 * part reaches, so it can say what an edit is about to do before it does it.
 * Both are found by drawing the letter and watching what it asks for, rather
 * than from a table kept by hand -- a table would be a second description of
 * the alphabet, and this file has already been bitten twice by keeping one of
 * those.
 */

import type { CutName, Cuts } from "./cut";
import { LETTERS, recipeOf, recordPartsWhile, type PartName } from "./letters";
import type { Parts, Style } from "./style";

export type { PartName };
export type { CutName };

/** One editable number on a part. */
export interface PartControl {
  /** The field inside the part, such as `projection` on the slab. */
  key: string;
  label: string;
  /** What moving it does, in the terms a designer would use. */
  hint: string;
  min: number;
  max: number;
  step: number;
  /** True when the range is in font units and should scale with the em. */
  emRelative?: boolean;
  /** True for an on-or-off switch rather than a slider. */
  toggle?: boolean;
  /** A choice between named shapes, rather than a number at all. */
  options?: Array<{ value: string; label: string; hint: string }>;
}

export interface PartSpec {
  name: PartName;
  label: string;
  /** What the part is, for the panel and for the help drawer. */
  hint: string;
  controls: PartControl[];
}

/**
 * Every part and everything about it that can be changed.
 *
 * The editor draws itself from this, and so does the help, so neither can come
 * to describe a control the tool does not have.
 *
 * The order is the order they appear in, and it runs from the decisions that
 * change what kind of face this is down to the ones that adjust it. How square
 * the bowls are and how far a corner is rounded are what separate a geometric
 * face from a technical one from a ribbon; a serif and a crossbar are details
 * on top of whichever of those has been chosen. Somebody who has just arrived
 * should meet the first kind first.
 */
export const PART_SPECS: PartSpec[] = [
  {
    name: "bowl",
    label: "Bowl",
    hint: "The enclosed shapes: o, the belly of a b, the ring of a zero, the right-hand side of a B or a D.",
    controls: [
      {
        key: "squareness",
        label: "Squareness",
        hint: "Nought is a circle. Turned up, the sides straighten and the corners tighten, until the o is a rectangle with rounded corners. This is the single control that separates a geometric face from a technical one, and there is no way to reach the second by adjusting a circle.",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "aperture",
        label: "Aperture",
        hint: "How far open a c, C, S, G or e stands. Below one the two ends reach round toward each other until the letter is nearly closed, which is what a heavy display face does; it never closes further than the pen can clear.",
        min: 0.25,
        max: 1.8,
        step: 0.01,
      },
      {
        key: "width",
        // Named apart from the face's own width, which is a different control
        // in a different section. Two sliders with one name is ambiguous in
        // the panel and worse for anyone reading it out.
        label: "Bowl width",
        hint: "How wide a bowl is against its height, on top of the width of the face itself. One is as wide as it is tall; less is an upright oval, more is a squat one.",
        min: 0.55,
        max: 1.45,
        step: 0.005,
      },
    ],
  },
  {
    name: "corner",
    label: "Corner",
    hint: "Where a stroke changes direction: the apex of an A, the elbow of a k, the turns of a Z. Rounding these off far enough stops the letter reading as strokes joined together and starts it reading as one ribbon bent round.",
    controls: [
      {
        key: "radius",
        label: "Rounding",
        hint: "How wide an arc the stroke turns through. Nought leaves a point. A stroke cannot turn tighter than half its own width without the inside of the turn folding, so anything under that is drawn at that.",
        min: 0,
        max: 0.3,
        step: 0.002,
        emRelative: true,
      },
      {
        key: "join",
        label: "Point",
        hint: "How the outside of a corner that has not been rounded off is finished.",
        min: 0,
        max: 0,
        step: 0,
        options: [
          { value: "miter", label: "Sharp", hint: "Carried out to where the two edges meet." },
          { value: "round", label: "Round", hint: "The pen itself, turned about the corner." },
          { value: "bevel", label: "Cut", hint: "Taken straight across." },
        ],
      },
    ],
  },
  {
    name: "shoulder",
    label: "Shoulder",
    hint: "Where an arch leaves its stem, and therefore how square the top of an n is. The single decision that most changes how a lowercase reads.",
    controls: [
      {
        key: "spring",
        label: "Springing",
        hint: "High squares the shoulder off; low rounds the whole arch.",
        min: 0.3,
        max: 0.85,
        step: 0.005,
      },
      {
        key: "reach",
        label: "Reach",
        hint: "How far the arch carries over before it turns down.",
        min: 0.7,
        max: 1.3,
        step: 0.005,
      },
    ],
  },
  {
    name: "slab",
    label: "Serif",
    hint: "The bar laid across the end of a straight stroke. Turning it on is most of what separates a serif face from a sans; a curved terminal never takes one.",
    controls: [
      { key: "on", label: "Serifs", hint: "Off for a sans.", min: 0, max: 1, step: 1, toggle: true },
      {
        key: "projection",
        label: "Reach",
        hint: "How far the bar sticks out past the stroke on each side, counted in stem widths. Two thirds of a stem is an ordinary text serif; past one it reads as a slab face.",
        min: 0,
        // Far enough to hold every base. The Wavy face is drawn at 1.55, and
        // with the top of this at 1.5 its slider opened pinned at the end and
        // silently shortened the serifs of a font nobody had edited yet.
        max: 1.6,
        step: 0.01,
      },
      {
        key: "thickness",
        label: "Depth",
        hint: "How far the bar reaches back along the stroke, counted in stem widths.",
        min: 0.06,
        max: 1,
        step: 0.01,
      },
      {
        key: "bracket",
        label: "Bracket",
        hint: "How much the inside corner is hollowed out. Zero is a slab serif; opening it makes the serif look grown from the stem rather than stuck on it.",
        min: 0,
        max: 0.8,
        step: 0.01,
      },
    ],
  },
  {
    name: "terminal",
    label: "Terminal",
    hint: "How a stroke stops when it is not wearing a serif. Flat, rounded off, or cut at an angle as a broad nib leaves it.",
    controls: [
      {
        key: "angle",
        label: "Cut",
        hint: "Degrees away from square. Only an angled terminal reads it.",
        min: -30,
        max: 30,
        step: 0.5,
      },
    ],
  },
  {
    name: "ball",
    label: "Ball",
    hint: "A disc finishing a stroke that stops in mid-air, as the c, e, a, r and S all do. Wider than the stroke, it throws the weight to the end, which is what a heavy poster face lives on.",
    controls: [
      {
        key: "size",
        label: "Size",
        hint: "How wide the disc is against the stem. Nought leaves the stroke to stop on its own.",
        min: 0,
        max: 2.4,
        step: 0.02,
      },
      {
        key: "drop",
        label: "Overhang",
        hint: "How far past the end of the stroke the disc's middle sits, as a share of its own radius. Nought centres it on the end; further out and it hangs off like a drop.",
        min: -0.6,
        max: 1,
        step: 0.02,
      },
    ],
  },
  {
    name: "flare",
    label: "Flare",
    hint: "A stroke that swells as it reaches its own end. Flared at both ends a stem is waisted, which is how a face varies its weight along a stroke without the pen having to change width.",
    controls: [
      {
        key: "spread",
        label: "Spread",
        hint: "How much wider the stroke gets at the very end, against the stem. Nought is no flare at all.",
        min: 0,
        max: 0.9,
        step: 0.01,
      },
      {
        key: "depth",
        label: "Reach",
        hint: "How far back along the stroke the swelling carries. Long enough and the stem never stops swelling, which is a waist.",
        min: 0.15,
        max: 3,
        step: 0.05,
      },
      {
        key: "curve",
        label: "Hollow",
        hint: "Nought leaves a straight wedge, which reads as something stuck on the end. Opening it out hollows the edge until the stroke looks like it swelled on its own.",
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  {
    name: "wave",
    label: "Wave",
    hint: "Runs that undulate instead of running straight. Built from arcs, so a wavy stroke is as exact at a heavy weight as at a hairline, and a wave too deep for the pen flattens rather than folding.",
    controls: [
      {
        key: "depth",
        label: "Depth",
        hint: "How far the stroke swings either side of where it would have run. Nought is straight.",
        min: 0,
        max: 0.07,
        step: 0.001,
        emRelative: true,
      },
      {
        key: "length",
        label: "Wavelength",
        hint: "How long one crest and trough is. Held to whole periods across each run, so the ends of a stroke stay where they were put.",
        min: 0.05,
        max: 0.5,
        step: 0.005,
        emRelative: true,
      },
      {
        key: "along",
        label: "Which runs",
        hint: "An undulating baseline is the flat runs waving while the stems stay straight. Both at once is a different face again.",
        min: 0,
        max: 1,
        step: 1,
        options: [
          { value: "off", label: "None", hint: "Every run straight." },
          { value: "flat", label: "Flat", hint: "Arms, bars and feet. The undulating baseline." },
          { value: "upright", label: "Upright", hint: "Stems and legs, rippling down the letter." },
          { value: "both", label: "Both", hint: "Everything straight in the letter moves." },
        ],
      },
    ],
  },
  {
    name: "crossbar",
    label: "Crossbar",
    hint: "The stroke that crosses the middle: the bar of an H, the arms of an E, the eye of an e, the waist of an A.",
    controls: [
      {
        key: "height",
        label: "Height",
        hint: "Where it sits, as a fraction of the letter it crosses.",
        min: 0.3,
        max: 0.72,
        step: 0.005,
      },
      {
        key: "weight",
        // Not "Weight": the pen has one of those and it means something else.
        label: "Thickness",
        hint: "How heavy the bar is against the stems. Below one it stays lighter, which stops a bar looking heavier than the letter around it.",
        min: 0.5,
        max: 1.3,
        step: 0.005,
      },
    ],
  },
];

/**
 * The pen and the proportions, as controls rather than as a list in the panel.
 *
 * Written here for the same reason the parts are: a control that the panel
 * knows about and the drawing does not looks exactly like a control that works.
 * Two shipped that way. Kept in one table, the test that drives every control
 * from one end to the other covers these as well.
 */
export interface FieldControl {
  key: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  /** True when the range is a fraction of the em rather than a plain number. */
  emRelative?: boolean;
  /** True when the only two useful values are on and off. */
  toggle?: boolean;
}

export const PEN_CONTROLS: FieldControl[] = [
  {
    key: "weight",
    label: "Weight",
    hint: "How wide the pen is. Every letter is redrawn at the new width rather than pushed outwards, so this cannot fold a stroke however far it goes.",
    min: 0.01,
    max: 0.26,
    step: 0.001,
    emRelative: true,
  },
  {
    key: "contrast",
    label: "Contrast",
    hint: "How much thinner the strokes running across the pen are. Nought is monolinear, which is a sans; more is what gives a serif its thick and thin.",
    min: 0,
    max: 0.9,
    step: 0.01,
  },
  {
    key: "angle",
    label: "Pen angle",
    hint: "Which way the pen is broadest, as a nib is held. Past sixty degrees the horizontals become the thick strokes and the verticals the thin ones, which is reverse contrast and is most of what makes a face look like a fairground poster.",
    min: -90,
    max: 90,
    step: 1,
  },
];

export const METRIC_CONTROLS: FieldControl[] = [
  {
    key: "monospaced",
    label: "One width",
    hint: "Every letter given the same advance, an i as much as an m. Not a decision about shape but about the space each shape is put in, which is why no other control reaches it.",
    min: 0,
    max: 1,
    step: 1,
    toggle: true,
  },
  {
    key: "xHeight",
    label: "x-height",
    hint: "How tall the lowercase is. Most of reading happens here, so it does more for the character of a face than almost anything else.",
    min: 0.3,
    max: 0.68,
    step: 0.001,
    emRelative: true,
  },
  {
    key: "capHeight",
    label: "Cap height",
    hint: "How tall the capitals are.",
    min: 0.5,
    max: 0.85,
    step: 0.001,
    emRelative: true,
  },
  {
    key: "ascender",
    label: "Ascender",
    hint: "How far a b, a d and an l reach above the x-height.",
    min: 0.52,
    max: 0.95,
    step: 0.001,
    emRelative: true,
  },
  {
    key: "descender",
    label: "Descender",
    hint: "How far a p, a g and a y reach below the baseline.",
    min: -0.35,
    max: -0.04,
    step: 0.001,
    emRelative: true,
  },
  {
    key: "width",
    label: "Width",
    hint: "How wide the whole face runs. The strokes keep their thickness, which is what makes this a width rather than a scale: condensed and extended, not small and large.",
    min: 0.6,
    max: 1.5,
    step: 0.005,
  },
  {
    key: "counterWidth",
    label: "Rhythm",
    hint: "The width inside an n, which sets how wide everything with two uprights runs. The round letters are as wide as they are tall and do not read it.",
    min: 0.15,
    max: 0.6,
    step: 0.001,
    emRelative: true,
  },
  {
    key: "slant",
    label: "Slant",
    hint: "How far the whole letter leans. Taken on the finished outline, which is exact -- leaning the skeleton instead would turn every arc into an ellipse and the offsets would stop being exact at every weight but one.",
    min: -30,
    max: 30,
    step: 0.5,
  },
  {
    key: "overshoot",
    label: "Overshoot",
    hint: "How far a round letter reaches past a flat one so the two look level. Set to nought, an o sits in a hollow between an n and an h.",
    min: 0,
    max: 0.05,
    step: 0.001,
    emRelative: true,
  },
  {
    key: "sidebearing",
    label: "Spacing",
    hint: "White space either side of every letter.",
    min: 0,
    max: 0.2,
    step: 0.001,
    emRelative: true,
  },
];

export function specFor(part: PartName): PartSpec | undefined {
  return PART_SPECS.find((spec) => spec.name === part);
}

/**
 * Which parts a letter is built from.
 *
 * Found by drawing it and noting what it asked for. An o has a bowl and a
 * terminal; an n has a shoulder; an H has a crossbar. Nothing here is written
 * down twice, so a letter that gains a crossbar tomorrow starts offering the
 * crossbar controls without anyone remembering to say so.
 */
export function partsUsedBy(letter: string, style: Style, form?: string): PartName[] {
  const recipe = recipeOf(letter, form);
  if (!recipe) return [];
  const found = recordPartsWhile(() => recipe(style));
  if (found.has("terminal") && takesSerif(letter, style, form)) found.add("slab");
  return [...found].sort((a, b) => order(a) - order(b));
}

/**
 * Whether a serif would land anywhere on this letter.
 *
 * A serif needs a straight stroke end wearing a serif terminal; a c, an s and
 * an o have none, so no bar can be laid on them. The question is put to the
 * strokes rather than to the finished outlines: the recipe is evaluated once,
 * which is cheap, where drawing it twice and counting the pieces would have
 * meant a thousand sweeps on every tick of a slider.
 *
 * The rule here has to say the same thing as the one in `serifsFor` that
 * actually places the wings. If those two ever disagree, the panel will offer a
 * control that changes nothing, or hide one that would.
 *
 * Asked with the serifs forced on and at a size that can land, whatever the
 * font currently says, so the control is offered on a sans and at a reach of
 * zero. Offered only when serifs were already on and already big enough, there
 * was no way to switch them on at all.
 */
function takesSerif(letter: string, style: Style, form?: string): boolean {
  const recipe = recipeOf(letter, form);
  if (!recipe) return false;
  return recipe(serifsForced(style)).strokes.some((stroke) => {
    const segments = stroke.spine.segments;
    if (stroke.spine.closed || segments.length === 0) return false;
    return (
      (stroke.start.kind === "slab" && segments[0].kind === "line") ||
      (stroke.end.kind === "slab" && segments[segments.length - 1].kind === "line")
    );
  });
}

function serifsForced(style: Style): Style {
  return {
    ...style,
    parts: {
      ...style.parts,
      slab: {
        on: true,
        // Measured in stem widths, so a size that lands is a size that lands at
        // every weight rather than at the one this was written against.
        projection: Math.max(style.parts.slab.projection, 0.35),
        thickness: Math.max(style.parts.slab.thickness, 0.25),
        bracket: style.parts.slab.bracket,
      },
    },
  };
}

/** Which letters an edit to this part will reach. */
export function lettersUsing(part: PartName, style: Style): string[] {
  return Object.keys(LETTERS).filter((letter) => partsUsedBy(letter, style).includes(part));
}

/** How many letters an edit reaches, which is what the panel says out loud. */
export function reachOf(part: PartName, style: Style): number {
  return lettersUsing(part, style).length;
}

function order(part: PartName): number {
  const index = PART_SPECS.findIndex((spec) => spec.name === part);
  return index === -1 ? PART_SPECS.length : index;
}

/** A part's current value as a plain record, for reading a control out of it. */
export function valuesOf(part: PartName, parts: Parts): Record<string, number | boolean | string> {
  return parts[part] as unknown as Record<string, number | boolean | string>;
}

// ---------------------------------------------------------------------------
// The cuts
// ---------------------------------------------------------------------------

/**
 * Every cut and everything about it that can be changed.
 *
 * Kept beside the parts and in the same shape, so the panel draws both from
 * one description and neither can come to offer a control the tool does not
 * have. A cut is not a part -- it does not belong to a letter, and it happens
 * after the drawing rather than during it -- so it has its own list rather
 * than a seventh entry in that one.
 */
export interface CutSpec {
  name: CutName;
  label: string;
  /** What it does, in the terms a designer would use. */
  hint: string;
  controls: PartControl[];
}

export const CUT_SPECS: CutSpec[] = [
  {
    name: "slot",
    label: "Slots",
    hint: "Bands cut clean across the letter. The move that reads at any size, and the one that turns a face into a poster.",
    controls: [
      {
        key: "count",
        label: "How many",
        hint: "Spread evenly down the font, at heights every letter agrees on, so a word reads as one striped block rather than as letters each cut to their own rhythm.",
        min: 1,
        max: 8,
        step: 1,
      },
      {
        key: "width",
        label: "Thickness",
        hint: "How thick each band is, in stem widths. Held in stems so the same setting means the same thing at every weight.",
        min: 0.05,
        max: 1.2,
        step: 0.01,
      },
      {
        key: "angle",
        label: "Angle",
        hint: "Degrees the bands lean, turned about the middle of the letter. Off square they stop reading as rules across a page and start reading as a letter that has been sliced.",
        min: -60,
        max: 60,
        step: 1,
      },
      {
        key: "inset",
        label: "Room at the ends",
        hint: "How much of the font's height is left uncut top and bottom. A band through the very top of an l is a nick out of its head.",
        min: 0,
        max: 0.45,
        step: 0.01,
      },
    ],
  },
  {
    name: "tooth",
    label: "Saw",
    hint: "A row of notches run along one edge of the letter. Cut as a comb across the whole letter rather than fitted to its outline, which is what a saw does.",
    controls: [
      {
        key: "pitch",
        label: "Spacing",
        hint: "From one tooth to the next, as a share of the x-height. The one size here that is not in stems: how fine a saw looks is how many teeth run down a letter, and a letter is the same height at every weight.",
        min: 0.03,
        max: 0.5,
        step: 0.005,
      },
      {
        key: "depth",
        label: "Depth",
        hint: "How far each notch reaches in, in stem widths.",
        min: 0.05,
        max: 1.2,
        step: 0.01,
      },
      {
        key: "edge",
        label: "Which edge",
        hint: "Where the saw runs.",
        min: 0,
        max: 0,
        step: 0,
        options: [
          { value: "left", label: "Left", hint: "Down the left flank of every letter." },
          { value: "right", label: "Right", hint: "Down the right flank." },
          { value: "both", label: "Both", hint: "Down both, which reads as a letter torn rather than cut." },
          { value: "top", label: "Top", hint: "Across the top." },
          { value: "bottom", label: "Foot", hint: "Across the foot." },
        ],
      },
    ],
  },
  {
    name: "inline",
    label: "Inline",
    hint: "A groove down the middle of every stroke: the same skeleton swept again with a much thinner pen, and taken away. It follows the letter exactly because it is the letter.",
    controls: [
      {
        key: "width",
        label: "Width",
        hint: "How wide the groove is, as a share of the stem.",
        min: 0.05,
        max: 0.85,
        step: 0.01,
      },
      {
        key: "inset",
        label: "Held back",
        hint: "How far short of each stroke end it stops, in stem widths. At nothing it breaks out through the terminals, which is an outline face rather than an inline one.",
        min: 0,
        max: 1.5,
        step: 0.01,
      },
    ],
  },
  {
    name: "motif",
    label: "Counters",
    hint: "The hole inside a letter, replaced by a shape. Every counter in the font at once, so an o and a B and an a agree.",
    controls: [
      {
        key: "shape",
        label: "Shape",
        hint: "What goes in the hole.",
        min: 0,
        max: 0,
        step: 0,
        options: [
          { value: "diamond", label: "Diamond", hint: "Points at the top, bottom and sides of the counter." },
          { value: "triangle", label: "Triangle", hint: "Flat foot, point at the top." },
          { value: "square", label: "Square", hint: "The counter's own box, which reads as a technical face." },
          { value: "slot", label: "Bar", hint: "A wide, shallow slot: nearly a closed letter with a nick in it." },
          { value: "dot", label: "Dot", hint: "A small disc in the middle, so the letter closes to a ring with a point in it." },
          { value: "ring", label: "Ring", hint: "A ring inside the counter, so the letter reads as one circle inside another." },
        ],
      },
      {
        key: "size",
        label: "Size",
        hint: "Against the hole it replaces. One fills it; below that the letter gains ink and closes up; above it the counter opens out.",
        min: 0.2,
        max: 1.25,
        step: 0.01,
      },
    ],
  },
  {
    name: "split",
    label: "Breaks",
    hint: "A gap wherever two strokes run into each other, which is what makes a stencil. The shorter stroke gives way: the arm of an E leaves the stem, and the stem carries on.",
    controls: [
      {
        key: "size",
        label: "Gap",
        hint: "How wide the break is, in stem widths.",
        min: 0.1,
        max: 2,
        step: 0.01,
      },
    ],
  },
  {
    name: "chamfer",
    label: "Chamfer",
    hint: "Corners cut off square. Applied last, so it finds the corners the other cuts made as well as the ones the letter was drawn with.",
    controls: [
      {
        key: "size",
        label: "Size",
        hint: "How far back along each edge the cut starts, in stem widths. Never more than a share of the shorter edge, so a chamfer cannot reach past its own corner and take the next one with it.",
        min: 0.05,
        max: 2,
        step: 0.01,
      },
    ],
  },
];

export function cutSpecFor(name: CutName): CutSpec | undefined {
  return CUT_SPECS.find((spec) => spec.name === name);
}

/** A cut's current values as a plain record, for reading a control out of it. */
export function cutValuesOf(name: CutName, cuts: Cuts): Record<string, number | boolean | string> {
  return cuts[name] as unknown as Record<string, number | boolean | string>;
}
