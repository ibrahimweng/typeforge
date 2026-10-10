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

/*
 * The Soft Serif's sides, set by their shape (`SIDES`), as multiples of its
 * sidebearing as the Serif's own table is.
 */
/** The left of a stem whose foot serif is the letter's edge: b f h i k l m n p r u. */
const STEM_LEFT = 1.02;
/** The right of one: d h i l m n q u. */
const STEM_RIGHT = 0.765;
/** The left of a bowl, the curve itself the edge: a c d e o q. */
const BOWL_LEFT = 1.38;
/** The right of one: b c e o p. */
const BOWL_RIGHT = 1.25;
/** Either side of a slanting stroke, its serif at the top the edge: v w y. */
const SLANT = 0.185;
/** The capitals' stems, left (B D E F H I K L N P R) and right (H I). */
const CAPITAL_STEM = 1.22;
/** The capitals' bowls, left (C G O Q) and right (D O). */
const CAPITAL_BOWL_LEFT = 0.95;
const CAPITAL_BOWL_RIGHT = 0.92;

/**
 * Every side of one shape set to one value, for every letter that has it.
 *
 * Two letters with the same sides then stand as far apart wherever they
 * meet, which is what makes the rhythm of a line: set a side at a time
 * against the few pairs the text it was drawn to match has, the n stood 28
 * units off the letter after it and the h, the m and the i 15 to 18, the p
 * 14 off the letter before it and 52 off the one after, and "input", "happy"
 * and "hn" were set unevenly.
 *
 * A side's shape is what sets the edge of the letter's ink on that side, read
 * off the drawing: a stem's foot serif (the p's descender's, which reaches as
 * far); a bowl's curve, the open ones of the c and the e with the closed; a
 * slant's top serif; and the same among the capitals. The u's left, a stem
 * whose head has no serif to the left, and the a's left, a bowl under its
 * hook, are spaced as the stems and the bowls are, so that "nun" and "nap"
 * are as even as "non". Every other side keeps the Serif's own value: the
 * arms (the f, k, r and t, the E, F, L and T), the a's tail, the s, the g, the
 * x, the z, the j -- whose right edge is its dot and whose left is the tail it
 * runs under the letter before -- the diagonal capitals, the figures and the
 * marks. Among the capitals the Serif's table already gives one value to
 * almost every side of a shape, which is kept; the N's left, the G's and the
 * D's and O's right are brought to it.
 *
 * The lowercase values, the slant, the sidebearing that every side is a
 * multiple of, and the capitals' extra (`capitalSpacing`) were then set
 * against the text it was drawn to match, holding to three things besides: a
 * round side and a straight one stand within four units of each other
 * whichever comes first (on against no), the o's two sides within four units
 * of each other, and no two letters that stood a hundredth of an em apart at
 * the Serif's spacing come nearer than that, nor any that stood nearer come
 * more than three units nearer still (the C and the v, which the kerning
 * already sets into each other, among them).
 */
const SIDES: NonNullable<Style["metrics"]["sides"]> = {
  ...SERIF.metrics.sides,
  a: [BOWL_LEFT, 0.74],
  b: [STEM_LEFT, BOWL_RIGHT],
  c: [BOWL_LEFT, BOWL_RIGHT],
  d: [BOWL_LEFT, STEM_RIGHT],
  e: [BOWL_LEFT, BOWL_RIGHT],
  f: [STEM_LEFT, 0.06],
  h: [STEM_LEFT, STEM_RIGHT],
  i: [STEM_LEFT, STEM_RIGHT],
  k: [STEM_LEFT, 0.21],
  l: [STEM_LEFT, STEM_RIGHT],
  m: [STEM_LEFT, STEM_RIGHT],
  n: [STEM_LEFT, STEM_RIGHT],
  o: [BOWL_LEFT, BOWL_RIGHT],
  p: [STEM_LEFT, BOWL_RIGHT],
  q: [BOWL_LEFT, STEM_RIGHT],
  r: [STEM_LEFT, 0.21],
  u: [STEM_LEFT, STEM_RIGHT],
  v: [SLANT, SLANT],
  w: [SLANT, SLANT],
  y: [SLANT, SLANT],
  B: [CAPITAL_STEM, 0.75],
  C: [CAPITAL_BOWL_LEFT, 0.48],
  D: [CAPITAL_STEM, CAPITAL_BOWL_RIGHT],
  E: [CAPITAL_STEM, 0.92],
  F: [CAPITAL_STEM, 0.31],
  G: [CAPITAL_BOWL_LEFT, 0.22],
  H: [CAPITAL_STEM, CAPITAL_STEM],
  I: [CAPITAL_STEM, CAPITAL_STEM],
  K: [CAPITAL_STEM, -0.25],
  L: [CAPITAL_STEM, 0.22],
  N: [CAPITAL_STEM, 0.86],
  O: [CAPITAL_BOWL_LEFT, CAPITAL_BOWL_RIGHT],
  P: [CAPITAL_STEM, 0.36],
  Q: [CAPITAL_BOWL_LEFT, -0.11],
  R: [CAPITAL_STEM, -0.34, "half", [0, 0], [0, 6]],
};

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
 * and kerning -- the Serif's spacing, taken from Lora, ran the lines three to
 * four per cent long -- as one system for the whole alphabet rather than a
 * side at a time: see `SIDES`.
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
    sidebearing: 27,
    capitalSpacing: 1.6,
    dotScale: 1.195,
    middleArm: 0.69,
    heldPen: true,
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
    sides: SIDES,
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
