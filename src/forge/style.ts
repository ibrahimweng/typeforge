/**
 * What every letter in the font agrees on.
 *
 * A typeface is not a collection of drawings that happen to look alike. It is
 * one set of decisions -- how tall, how heavy, how round, how the strokes end --
 * applied consistently to every character. That set of decisions lives here,
 * in one object, and every letter is drawn from it.
 *
 * Which is what makes the thing you asked for possible. Draw a slab the way you
 * want it on p, and what you have actually edited is `parts.slab`; every other
 * letter reads the same field the next time it is drawn, so they all change
 * together. Nothing is copied between letters, so nothing can fall out of step.
 *
 * A letter that should keep its own version of something says so in its own
 * overrides, which is the exception rather than the rule.
 */

import type { Pen, Terminal, TerminalKind } from "./types";

/** The heights and widths every letter is built against. */
export interface Metrics {
  unitsPerEm: number;
  /** Height of the lowercase, where most of the reading happens. */
  xHeight: number;
  capHeight: number;
  ascender: number;
  /** Negative: how far below the baseline a p or a g reaches. */
  descender: number;
  /** How far the round letters overshoot the flat ones, so they look level. */
  overshoot: number;
  /** Width of the inside of a lowercase n, which sets the rhythm of the font. */
  counterWidth: number;
  /** White space left either side of a letter. */
  sidebearing: number;
}

/**
 * The named parts, shared by every letter that has one.
 *
 * These are the fields an edit lands on. `slab` is the clearest case: it
 * describes one bar, and every stroke end in the font that wears a serif wears
 * that bar.
 */
export interface Parts {
  slab: {
    /** Off entirely for a sans. */
    on: boolean;
    /** How far the bar reaches past the stroke on each side. */
    projection: number;
    /** How far it reaches back along the stroke. */
    thickness: number;
    /** How much the inside corner is filleted: zero is a slab, more is a text serif. */
    bracket: number;
  };
  shoulder: {
    /**
     * Where the arch leaves the stem, as a fraction of the x-height. Low is an
     * open, humanist n; high is a squared, industrial one.
     */
    spring: number;
    /** How far the arch reaches over before it turns down. */
    reach: number;
  };
  bowl: {
    /** How round the enclosed shapes are: one is a circle, less is an oval. */
    roundness: number;
  };
  terminal: {
    kind: TerminalKind;
    /** Degrees off square, for the angled cut a broad nib leaves. */
    angle: number;
  };
  crossbar: {
    /** Height as a fraction of the letter it crosses. */
    height: number;
    /** Thickness relative to the stems, so a bar can be lighter than a stem. */
    weight: number;
  };
}

export interface Style {
  name: string;
  metrics: Metrics;
  pen: Pen;
  parts: Parts;
}

/** The terminal a stroke end wears under this style, slab included. */
export function terminalFor(style: Style): Terminal {
  const { terminal, slab } = style.parts;
  if (!slab.on) return { kind: terminal.kind, angle: terminal.angle };
  return {
    kind: "slab",
    projection: slab.projection,
    thickness: slab.thickness,
    bracket: slab.bracket,
  };
}

const EM = 1000;

/**
 * The sans.
 *
 * Monolinear, flat terminals, a shoulder springing from just below the middle:
 * the plainest set of decisions that still reads as designed rather than as
 * absent. It is also the base the other two are built from, because a serif is
 * this with contrast and slabs, and a display face is this pushed past where a
 * text face would stop.
 *
 * The proportions are the ordinary ones of Latin type -- an x-height a little
 * over half the cap height, stems around a tenth of the em -- which are
 * conventions of the writing system rather than anyone's design, and are
 * arrived at here by construction rather than measured off an existing font.
 */
export const SANS: Style = {
  name: "Sans",
  metrics: {
    unitsPerEm: EM,
    xHeight: 520,
    capHeight: 720,
    ascender: 750,
    descender: -210,
    overshoot: 10,
    counterWidth: 300,
    sidebearing: 55,
  },
  pen: { weight: 92, contrast: 0, angle: 0 },
  parts: {
    slab: { on: false, projection: 60, thickness: 40, bracket: 0 },
    shoulder: { spring: 0.62, reach: 1 },
    bowl: { roundness: 1 },
    terminal: { kind: "butt", angle: 0 },
    crossbar: { height: 0.52, weight: 1 },
  },
};

/**
 * The serif.
 *
 * The same skeleton with three decisions changed: the pen gains contrast so
 * the horizontals thin, it gains an angle so the thin parts fall where a
 * broad nib would put them, and the slabs come on with a bracket that softens
 * the join. Nothing about the letters themselves is different, which is the
 * point of building it this way.
 */
export const SERIF: Style = {
  ...SANS,
  name: "Serif",
  pen: { weight: 96, contrast: 0.42, angle: 8 },
  parts: {
    ...SANS.parts,
    slab: { on: true, projection: 52, thickness: 34, bracket: 26 },
    shoulder: { spring: 0.58, reach: 1 },
    terminal: { kind: "angled", angle: 12 },
  },
};

/**
 * The display face.
 *
 * Heavy, tight and round: the weight is more than twice the sans, the counters
 * close up behind it, and the terminals are rounded off. It exists to be
 * pulled about rather than read at length, which is why every one of its
 * numbers sits where a text face would refuse to go.
 */
export const DISPLAY: Style = {
  ...SANS,
  name: "Display",
  metrics: { ...SANS.metrics, xHeight: 560, counterWidth: 250, sidebearing: 40 },
  pen: { weight: 190, contrast: 0, angle: 0 },
  parts: {
    ...SANS.parts,
    shoulder: { spring: 0.7, reach: 1 },
    bowl: { roundness: 1 },
    terminal: { kind: "round", angle: 0 },
  },
};

export const BASES: Style[] = [SANS, SERIF, DISPLAY];
