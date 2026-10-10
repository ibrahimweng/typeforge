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
 * with its own a, y and f (`letters/soft.ts`).
 *
 * Every number here is a field the engine reads, and none of them is special
 * to this face: the same settings on the Serif by hand draw the same letters.
 * Several of them have no slider (the drops' shape, the dot's size, which way
 * the bowls' weight leans), which is the other reason to offer it whole.
 *
 * The letter widths, the drops' size and hang, the bowls' heft and aperture,
 * the serifs' depth, the arches' reach, the bars' weight and the dot were then
 * tuned against the text it was drawn to match, a value at a time, keeping a
 * value only where the whole line matched better and no letter much worse.
 */
export const SOFT_SERIF: Style = {
  ...SERIF,
  name: "Serif",
  blurb: "A soft text serif: rounded tips, pear drops, filleted joins, bottom-heavy bowls.",
  pen: { ...SERIF.pen, weight: 84, contrast: 0.7, angle: 18 },
  metrics: {
    ...SERIF.metrics,
    dotScale: 1.17,
    middleArm: 0.69,
    proportions: {
      ...SERIF.metrics.proportions,
      f: 1.108,
      h: 0.958,
      m: 0.957,
      n: 0.9565,
      t: 1.09,
      E: 1.154,
      y: 1.25,
      c: 0.86,
      p: 0.886,
      r: 0.79,
      s: 0.965,
    },
  },
  parts: {
    ...SERIF.parts,
    slab: {
      ...SERIF.parts.slab,
      projection: 0.85,
      thickness: 0.45,
      bracket: 0.7,
      tip: 1,
      swell: 0.3,
      headKeep: true,
      headDepth: 0.5,
    },
    shoulder: {
      ...SERIF.parts.shoulder,
      rise: 0.3,
      crest: 0.97,
      reach: 0.785,
      armRise: 0.04,
    },
    bowl: { ...SERIF.parts.bowl, aperture: 0.9, tail: 0.8, heft: 0.16 },
    terminal: {
      ...SERIF.parts.terminal,
      soft: 0.3,
      taper: 0.5,
      dropSize: 0.05,
      dropHang: 0.1,
      dropCurl: 0.6,
      dropNeck: 1,
    },
    corner: { ...SERIF.parts.corner, fillet: 0.35 },
    crossbar: { ...SERIF.parts.crossbar, weight: 1.05 },
  },
  forms: { ...SERIF.forms, a: "curled", y: "swung", f: "tucked" },
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
