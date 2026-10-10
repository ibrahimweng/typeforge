/**
 * Starting faces: a finished drawing on one of the bases, offered beside it.
 *
 * A base is a construction -- a pen, a set of proportions, a choice of parts
 * -- and the bases are what the rest of the application is measured against:
 * every test that walks "every face" walks `BASES`, and several of them hold a
 * base to rules that only make sense for a base (that only the Serif draws the
 * humanist forms, that only the Serif holds its serifs to a measured size).
 * A face that is the Serif with its finishes turned up is not a twenty-second
 * construction. It is a document somebody could have made on the Serif, so it
 * is offered as one: started from, it is the Serif with these settings, and
 * every control in the panel moves it as it would move anything drawn on the
 * Serif.
 *
 * That is also why its style keeps the Serif's name. A great deal of the
 * engine asks "is this the Serif?" by name -- how far its serifs are
 * bracketed, how it thickens past a Bold, how dark it lets a Black get -- and a
 * face drawn on the Serif should get the Serif's answers.
 */

import { SERIF, type Family, type Style } from "./style";

/**
 * The soft text serif: the Serif with every corner eased.
 *
 * Rounded serif tips and arm ends that flare as they leave the stem; cut ends
 * softened and the curved ones tapered; pear-shaped drops carried a little
 * past their ends and turned toward the plumb, with a smooth neck; the inside
 * of every join rounded; the c and e tails run long and flat, and the open
 * bowls heavier at the bottom than at the top; the arches springing lower from
 * the stem; bigger dots. On a pen with more contrast at a steeper angle, and
 * with its own a, e, f, s, t and y, an S (and so a dollar) with the s's
 * soft beaks (`letters/soft.ts`), and an oe whose bowls share one wall.
 *
 * Every number here is a field the engine reads, and none of them is special
 * to this face: the same settings on the Serif by hand draw the same letters.
 * Several of them have no slider (the drops' shape, the dot's size, which way
 * the bowls' weight leans), which is the other reason to offer it whole.
 *
 * The letter widths, the drops' size and hang, the bowls' heft and aperture,
 * the serifs' depth, the arches' reach, the bars' weight and the dot were then
 * tuned against the text it was drawn to match, a value at a time (and, where
 * no single value helped any more, a few at once), keeping a change only where
 * the whole line matched better and no letter much worse.
 *
 * And then its spacing, against the same text set in the face's own advances
 * and kerning: the sidebearing, and the sides of the letters in that text
 * (`metrics.sides`, multiples of the sidebearing as the Serif's own table
 * is), set until each pair stood as far apart as the reference's -- the
 * Serif's spacing, taken from Lora, ran the lines three to four per cent long
 * -- and never so that two letters that stood clear of each other came within
 * a hundredth of an em, nor any that stood nearer came nearer still.
 */
export const SOFT_SERIF: Style = {
  ...SERIF,
  name: "Serif",
  blurb: "A soft text serif: rounded tips, pear drops, filleted joins, bottom-heavy bowls.",
  pen: { ...SERIF.pen, weight: 84, contrast: 0.7, angle: 18 },
  metrics: {
    ...SERIF.metrics,
    ascender: 761,
    descender: -258,
    overshoot: 15.25,
    sidebearing: 32,
    capitalSpacing: 1.5,
    dotScale: 1.195,
    middleArm: 0.69,
    oeWall: 0.8,
    proportions: {
      ...SERIF.metrics.proportions,
      f: 1.108,
      h: 0.958,
      m: 0.957,
      n: 0.9565,
      t: 1.075,
      E: 1.1615,
      y: 1.3,
      c: 0.89,
      p: 0.886,
      r: 0.76,
      s: 0.935,
    },
    sides: {
      ...SERIF.metrics.sides,
      a: [1, 0.39],
      e: [1.19, 1.05],
      f: [0.94, -0.14],
      h: [0.96, 0.48],
      i: [1.06, 0.57],
      m: [1.16, 0.54],
      n: [1.065, 0.88],
      p: [0.45, 1.64],
      r: [0.96, 0.46],
      s: [1.58, 1.21],
      t: [0.22, 0.32],
      E: [1.22, 1.02],
    },
  },
  parts: {
    ...SERIF.parts,
    slab: {
      ...SERIF.parts.slab,
      projection: 0.85,
      thickness: 0.55,
      bracket: 0.65,
      tip: 1,
      swell: 0.25,
      headKeep: true,
      headDepth: 0.5,
    },
    shoulder: {
      ...SERIF.parts.shoulder,
      rise: 0.3,
      crest: 0.97,
      reach: 0.785,
      armRise: 0.04,
      angle: 12,
    },
    bowl: {
      ...SERIF.parts.bowl,
      aperture: 0.9,
      tail: 0.675,
      heft: 0.17,
      heftFade: 1,
      blunt: 1,
    },
    terminal: {
      ...SERIF.parts.terminal,
      soft: 0.3,
      taper: 0.45,
      dropTaper: 0.7,
      dropSize: 0.025,
      dropHang: 0.1,
      dropCurl: 0.6,
      dropNeck: 1,
    },
    corner: { ...SERIF.parts.corner, fillet: 0.425 },
    crossbar: { ...SERIF.parts.crossbar, weight: 1.05, height: 0.5125 },
  },
  forms: {
    ...SERIF.forms,
    a: "belted",
    y: "swung",
    f: "tucked",
    e: "wide-eyed",
    t: "wedged",
    s: "beaked",
    S: "beaked",
  },
};

/** A face offered to start from, beside the base it is drawn on. */
export interface Start {
  /** Stable, for the button, the palette and anything saved that names it. */
  id: string;
  /** What the button says. Also what the new drawing is called. */
  label: string;
  /** The base it is drawn on, by name: what the document says it started from. */
  base: string;
  /** The heading it is shown under, which is its base's. */
  family: Family;
  style: Style;
}

export const STARTS: readonly Start[] = [
  {
    id: "soft-serif",
    label: "Soft Serif",
    base: SERIF.name,
    family: SERIF.family,
    style: SOFT_SERIF,
  },
];

export function startNamed(id: string): Start | undefined {
  return STARTS.find((start) => start.id === id);
}
