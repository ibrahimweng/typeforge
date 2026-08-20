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

import type { WaveAlong } from "./shapes";
import type { JoinKind, Pen, Terminal, TerminalKind } from "./types";

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
  /**
   * Width of the inside of a lowercase n, which sets the rhythm of the font.
   *
   * The round letters do not read it: an o is as wide as it is tall, because it
   * is round and it fills the x-height. This is what everything with two
   * uprights is spaced by.
   */
  counterWidth: number;
  /** White space left either side of a letter. */
  sidebearing: number;
  /**
   * How wide every letter runs, as a multiple.
   *
   * Applied to the horizontal measures a letter is built from and to nothing
   * else, so the face condenses or extends without the strokes changing
   * thickness -- which is the difference between a width and a scale.
   */
  width: number;
  /**
   * Degrees the whole letter leans, to the right when positive.
   *
   * Taken on the finished outline rather than on the skeleton. A shear is an
   * affine map and an affine map takes a cubic to a cubic exactly, so this
   * costs nothing in accuracy -- where slanting the skeleton would turn every
   * circular arc into an ellipse and the offsets would stop being exact.
   */
  slant: number;
}

/**
 * The named parts, shared by every letter that has one.
 *
 * These are the fields an edit lands on. `slab` is the clearest case: it
 * describes one bar, and every stroke end in the font that wears a serif wears
 * that bar.
 */
export interface Parts {
  /*
   * The serif, measured in stem widths rather than in font units.
   *
   * A serif is a bar across the end of a stroke, and how large it looks is not
   * how many units across it is -- it is how far it stands out past the stroke
   * it is attached to. Held in units, the same numbers gave a bar two and a
   * third times the width of the stem on the sans and a lip on the display,
   * where the pen is nearly twice as wide. Turning serifs on at a heavy weight
   * appeared to do almost nothing, and adding weight to a serifed face made its
   * serifs quietly disappear into their own stems.
   *
   * A multiple of the stem holds across every weight and every base, and it is
   * how a designer says it: this serif reaches out about two thirds of a stem.
   */
  slab: {
    /** Off entirely for a sans. */
    on: boolean;
    /** How far the bar reaches past the stroke on each side, in stem widths. */
    projection: number;
    /** How far it reaches back along the stroke, in stem widths. */
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
    /**
     * How wide an enclosed shape is against its height. One is as wide as it is
     * tall, which is a circle; less is an upright oval and more is a squat one.
     */
    width: number;
    /**
     * How far open the letters that are not closed stand: the c, the C, the S,
     * the bowl of a G, the belly of an e.
     *
     * One is the ordinary opening. Below it the two ends reach round toward
     * each other until the letter is nearly a ring with a slot in it, which is
     * what the heavy poster faces of the seventies do and is most of why they
     * read as one solid block of colour. It is held above what the pen can
     * clear, so closing it too far flattens rather than fusing the letter shut.
     */
    aperture: number;
    /**
     * How square it is. Nought is round, one is as square as a stroke of this
     * width can be asked to turn -- which is what separates a geometric face
     * from a technical one, and is not reachable by adjusting a circle.
     */
    squareness: number;
  };
  corner: {
    /**
     * How far a corner in a stroke is rounded off, in font units. Nought leaves
     * it a point. Opened far enough the whole letter reads as one ribbon bent
     * round rather than as strokes joined together.
     */
    radius: number;
    /** How the outside of a corner that is not rounded off is finished. */
    join: JoinKind;
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
  /**
   * The ball: a disc finishing a stroke that has nothing else to finish it.
   *
   * The other half of what makes a heavy display face read the way it does. A
   * stroke that simply stops leaves a blunt edge; one that ends in a disc
   * wider than itself closes the shape off and throws the weight to the end,
   * which beside a tight aperture is the whole of the seventies poster letter.
   *
   * Only where the stroke stops in mid-air. On a line there is already
   * something finishing the stroke -- the line -- and a ball there reads as a
   * blot rather than as a terminal.
   */
  ball: {
    /** How wide the disc is against the stem. Nought is none. */
    size: number;
    /** How far past the end its middle sits, as a share of its own radius. */
    drop: number;
  };
  /**
   * The flare: a stroke that widens as it arrives at its own end.
   *
   * The other way a face can vary its weight along a stroke. A pen of one
   * width drawn along a skeleton gives a stroke of one width, which is the
   * whole of what makes this construction exact -- so the widening is drawn as
   * a shape laid over the end rather than by asking the pen to change its mind
   * halfway along, and it is exact for the same reason a serif is.
   *
   * Flared at both ends, a stem is widest where it meets its lines and
   * narrowest in the middle, which is what a waisted stem is. Hollow the
   * flare's outer edge and it stops reading as a wedge stuck on the end and
   * starts reading as the stroke itself swelling, which is the difference
   * between a slab and the art-nouveau faces this was built for.
   *
   * Measured in stem widths, like the serif, so it holds at every weight.
   */
  flare: {
    /** How much wider the stroke gets at its very end, in stem widths. */
    spread: number;
    /** How far back along the stroke the widening reaches, in stem widths. */
    depth: number;
    /** Nought is a straight wedge; one hollows it into a quarter ellipse. */
    curve: number;
  };
  /**
   * The wave, for the faces whose strokes undulate rather than run straight.
   *
   * A family of its own rather than a decoration on top of one: a flat run gone
   * wavy is a different letter, not a wobbled version of the old one, and the
   * whole rhythm of the face changes with it. Drawn as arcs, so it offsets
   * exactly like everything else here and holds at every weight.
   */
  wave: {
    /** How long one full crest and trough is, in font units. */
    length: number;
    /** How far it swings either side of the run, in font units. */
    depth: number;
    /** Which runs undulate: the flat ones, the upright ones, or all of them. */
    along: WaveAlong;
  };
}

export interface Style {
  name: string;
  metrics: Metrics;
  pen: Pen;
  parts: Parts;
  /**
   * Letters this face would rather draw from a different skeleton.
   *
   * A base is a set of decisions, and which shape an a or a g is happens to be
   * one of them: a brush script wants the single-storey a and the curled g
   * that a text face does not. The alternates already exist and are already
   * offered letter by letter -- this only says which ones a face starts with,
   * and every one of them can still be changed afterwards like any other.
   */
  forms?: Record<string, string>;
  /** What kind of face this is, for the person choosing one. */
  blurb?: string;
}

/**
 * The terminal a stroke end wears under this style, slab included.
 *
 * Where the serif stops being a multiple of the stem and becomes a measurement.
 * Everything below this point works in font units, so the one place that knows
 * both the pen and the serif does the conversion, and nothing downstream has to
 * carry the question.
 */
export function terminalFor(style: Style): Terminal {
  const { terminal, slab } = style.parts;
  if (!slab.on) return { kind: terminal.kind, angle: terminal.angle, open: true };
  const stem = style.pen.weight;
  return {
    kind: "slab",
    open: true,
    projection: slab.projection * stem,
    thickness: slab.thickness * stem,
    bracket: slab.bracket * stem,
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
  blurb: "The plain case. One thickness, flat ends, ordinary proportions.",
  metrics: {
    unitsPerEm: EM,
    xHeight: 520,
    capHeight: 720,
    ascender: 750,
    descender: -210,
    overshoot: 10,
    counterWidth: 370,
    sidebearing: 55,
    width: 1,
    slant: 0,
  },
  pen: { weight: 92, contrast: 0, angle: 0 },
  parts: {
    slab: { on: false, projection: 0.65, thickness: 0.43, bracket: 0 },
    shoulder: { spring: 0.62, reach: 1 },
    bowl: { width: 1, squareness: 0, aperture: 1 },
    corner: { radius: 0, join: "miter" },
    terminal: { kind: "butt", angle: 0 },
    crossbar: { height: 0.52, weight: 1 },
    ball: { size: 0, drop: 0.45 },
    flare: { spread: 0, depth: 0.9, curve: 0.85 },
    wave: { length: 130, depth: 0, along: "flat" },
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
  blurb: "Contrast, an angled pen, and bracketed serifs.",
  pen: { weight: 96, contrast: 0.42, angle: 8 },
  parts: {
    ...SANS.parts,
    slab: { on: true, projection: 0.46, thickness: 0.48, bracket: 0.23 },
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
  blurb: "Heavy, round and tight. Made to be looked at rather than read.",
  metrics: { ...SANS.metrics, xHeight: 560, counterWidth: 340, sidebearing: 40 },
  pen: { weight: 175, contrast: 0, angle: 0 },
  parts: {
    ...SANS.parts,
    shoulder: { spring: 0.7, reach: 1.05 },
    bowl: { width: 1.06, squareness: 0.2, aperture: 1 },
    corner: { radius: 0, join: "round" },
    terminal: { kind: "round", angle: 0 },
  },
};

/*
 * Places to start.
 *
 * Every one of these is the same skeletons with a different set of decisions
 * over them -- there is not a single letter drawn for any of them -- and every
 * control stays live afterwards. They exist because the controls that reach
 * these shapes are not ones anybody would find by turning knobs: squareness
 * takes a circle to a rectangle and there is no halfway house that suggests it,
 * and a corner opened wide enough stops reading as a joint and starts reading
 * as a bend. Somebody has to be shown that the range goes that far before it is
 * worth their while exploring it.
 */

/** Geometric: circles, points, one thickness. */
export const GEOMETRIC: Style = {
  ...SANS,
  name: "Geometric",
  blurb: "Circles and points, one thickness throughout.",
  metrics: { ...SANS.metrics, xHeight: 500, counterWidth: 380, sidebearing: 58 },
  pen: { weight: 86, contrast: 0, angle: 0 },
  parts: {
    ...SANS.parts,
    shoulder: { spring: 0.55, reach: 1 },
    bowl: { width: 1, squareness: 0, aperture: 1 },
    corner: { radius: 0, join: "miter" },
    terminal: { kind: "butt", angle: 0 },
  },
};

/** Ribbon: one heavy stroke bent round, with the corners opened right out. */
export const RIBBON: Style = {
  ...SANS,
  name: "Ribbon",
  blurb: "One heavy stroke bent round. Corners opened until the joints disappear.",
  metrics: { ...SANS.metrics, xHeight: 560, counterWidth: 330, sidebearing: 46 },
  pen: { weight: 150, contrast: 0, angle: 0 },
  parts: {
    ...SANS.parts,
    shoulder: { spring: 0.4, reach: 1.05 },
    bowl: { width: 1, squareness: 0.5, aperture: 1 },
    corner: { radius: 220, join: "round" },
    terminal: { kind: "butt", angle: 0 },
  },
};

/** Technical: squared off, narrow, corners just off the pen's limit. */
export const TECHNICAL: Style = {
  ...SANS,
  name: "Technical",
  blurb: "Squared off and narrow, with the corners just off the limit.",
  metrics: { ...SANS.metrics, counterWidth: 300, sidebearing: 52, width: 0.9 },
  pen: { weight: 78, contrast: 0, angle: 0 },
  parts: {
    ...SANS.parts,
    shoulder: { spring: 0.78, reach: 0.82 },
    bowl: { width: 0.82, squareness: 0.92, aperture: 1 },
    corner: { radius: 45, join: "round" },
    terminal: { kind: "butt", angle: 0 },
  },
};

/** Fairground: the pen turned a quarter, so the horizontals are the thick strokes. */
export const FAIRGROUND: Style = {
  ...SANS,
  name: "Fairground",
  blurb: "The pen turned a quarter, so the horizontals carry the weight.",
  metrics: { ...SANS.metrics, sidebearing: 50 },
  pen: { weight: 130, contrast: 0.62, angle: 90 },
  parts: {
    ...SANS.parts,
    bowl: { width: 1.08, squareness: 0.15, aperture: 1 },
    terminal: { kind: "butt", angle: 0 },
  },
};

/** Marker: leaned over, drawn with a flat pen held at an angle. */
export const MARKER: Style = {
  ...SANS,
  name: "Marker",
  blurb: "Leaned over, drawn with a flat pen held at an angle.",
  metrics: { ...SANS.metrics, slant: 13, sidebearing: 48 },
  pen: { weight: 118, contrast: 0.5, angle: -32 },
  parts: {
    ...SANS.parts,
    bowl: { width: 0.95, squareness: 0.35, aperture: 1 },
    corner: { radius: 0, join: "bevel" },
    terminal: { kind: "butt", angle: 0 },
  },
};

/**
 * Wavy: thin, wide, and undulating along every flat run.
 *
 * The one base whose letters are not made of straight lines at all where they
 * lie flat. A light monoline with long serifs gives the wave something to
 * happen along -- the arms of an E, the foot of an L, the bar of an H -- and
 * the stems stay upright so the letter still reads as a letter rather than as
 * a ribbon.
 */
export const WAVY: Style = {
  ...SANS,
  name: "Wavy",
  blurb: "Thin, wide, and rippling along every run that lies flat.",
  metrics: { ...SANS.metrics, width: 1.12, sidebearing: 44 },
  pen: { weight: 44, contrast: 0, angle: 0 },
  parts: {
    ...SANS.parts,
    slab: { on: true, projection: 1.55, thickness: 0.52, bracket: 0 },
    bowl: { width: 1.05, squareness: 0, aperture: 1 },
    wave: { length: 152, depth: 34, along: "flat" },
  },
};

/**
 * Flared: condensed, with contrast, and every stroke swelling where it stops.
 *
 * The art-nouveau end of display. The letters are narrow and the pen has
 * contrast, so the curves already thin where they turn; the flare then puts
 * the weight back at the ends of every stem, hollowed enough that it reads as
 * the stroke swelling rather than as a serif stuck on.
 */
export const FLARED: Style = {
  ...SANS,
  name: "Flared",
  blurb: "Condensed and swelling at every stroke end, the art-nouveau way.",
  metrics: { ...SANS.metrics, width: 0.78, capHeight: 740, xHeight: 500, sidebearing: 42 },
  pen: { weight: 118, contrast: 0.34, angle: 0 },
  parts: {
    ...SANS.parts,
    bowl: { width: 0.94, squareness: 0.1, aperture: 1 },
    corner: { radius: 0, join: "miter" },
    flare: { spread: 0.3, depth: 1.1, curve: 0.95 },
  },
};

/**
 * Psychedelic: heavy, high contrast, nearly shut, with a ball on every end.
 *
 * The seventies poster letter. The weight and the contrast together mean the
 * curves swell and vanish rather than holding one thickness, the apertures
 * close until the c and the S are rings with a slot in them, and the balls
 * throw what is left of the weight to the ends. Set tight, it reads as one
 * block of colour with the words cut out of it, which is the point.
 */
export const PSYCHEDELIC: Style = {
  ...SANS,
  name: "Psychedelic",
  blurb: "Heavy, swollen, nearly shut, with a ball on every open end.",
  metrics: { ...SANS.metrics, xHeight: 560, counterWidth: 300, sidebearing: 40, width: 1.04 },
  pen: { weight: 168, contrast: 0.62, angle: 0 },
  parts: {
    ...SANS.parts,
    bowl: { width: 1.02, squareness: 0.1, aperture: 0.42 },
    shoulder: { spring: 0.72, reach: 1 },
    ball: { size: 1.75, drop: 0.4 },
  },
};

/**
 * Brush: leaned over, cut with a chisel brush, and drawn in cursive shapes.
 *
 * The signwriter's hand. A flat brush held at an angle gives strokes that
 * swell and vanish as they turn, the lean carries them along the line, and the
 * cuts at the ends are angled because that is the shape the brush leaves when
 * it lifts. What separates it from a slanted sans is the letterforms rather
 * than the pen, which is why this is the first base to say which ones it
 * wants: the curled g, the f that carries below the line, the straight y and
 * the l with a tail are all hands rather than types.
 */
export const BRUSH: Style = {
  ...SANS,
  name: "Brush",
  blurb: "The signwriter's hand: leaned over, chisel-cut, drawn in cursive shapes.",
  metrics: {
    ...SANS.metrics,
    slant: 15,
    xHeight: 505,
    capHeight: 700,
    ascender: 765,
    descender: -235,
    sidebearing: 34,
    width: 0.93,
    counterWidth: 300,
  },
  pen: { weight: 132, contrast: 0.66, angle: -17 },
  parts: {
    ...SANS.parts,
    bowl: { width: 0.94, squareness: 0.28, aperture: 0.86 },
    shoulder: { spring: 0.5, reach: 0.96 },
    corner: { radius: 0, join: "miter" },
    terminal: { kind: "butt", angle: 0 },
    flare: { spread: 0.14, depth: 1.1, curve: 0.7 },
  },
  forms: { g: "curled", f: "descending", y: "straight", l: "tailed" },
};

export const BASES: Style[] = [
  SANS,
  SERIF,
  DISPLAY,
  GEOMETRIC,
  RIBBON,
  TECHNICAL,
  FAIRGROUND,
  MARKER,
  WAVY,
  FLARED,
  PSYCHEDELIC,
  BRUSH,
];
