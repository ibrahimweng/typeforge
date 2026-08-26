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
import { noEffects, type Effects } from "@/font/effects";
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
   * Every letter given the same advance, an i as much as an m.
   *
   * A whole family of type that no amount of turning the other controls
   * reaches, because it is not a decision about shape at all: it is a decision
   * about the space each shape is put in. The letters keep the widths they
   * were drawn at and are centred in a common one, which is what a monospaced
   * face does and why its i has such long ears in the ones that draw them.
   */
  monospaced?: boolean;
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
  /**
   * What the tool that drew this face was like.
   *
   * The same kind of statement as `forms`: not a decision the face makes for
   * ever, only the one it starts from. A marker face that begins with no
   * roughening on it is a marker face that begins as a slanted sans, and
   * somebody choosing it has to know to go and switch the thing on that makes
   * it what its name says.
   *
   * Left out by every face that is a printed thing rather than a drawn one,
   * which is most of them.
   */
  effects?: Effects;
  /** What kind of face this is, for the person choosing one. */
  blurb?: string;
  /**
   * Which family of type this face belongs to.
   *
   * Not a label for its own sake. A dozen starting points in one grid is a
   * dozen guesses; the same dozen under four headings is a map of what kind of
   * thing a typeface can be, and it says out loud that the difference between
   * a grotesque and a didone is a set of numbers rather than a different
   * program. It also shows the gaps: what is not here yet is exactly what the
   * controls cannot reach yet.
   */
  family: Family;
}

/**
 * The four kinds of type, which is as many as are worth telling apart here.
 *
 * The usual classifications -- Vox and its descendants -- split the text faces
 * a dozen ways and then put everything else in a bin called "manual" or
 * "decorative". That is the wrong shape for a tool: the interesting question
 * is not which century a serif is from but which controls you reach for, and
 * by that measure a didone and an old-style are near neighbours while a
 * blackletter and a psychedelic poster face are not related at all.
 */
export type Family = "sans" | "serif" | "display" | "hand";

export const FAMILIES: Array<{ id: Family; label: string; hint: string }> = [
  {
    id: "sans",
    label: "Sans",
    hint: "No serifs. What separates them is the shape of the bowls, how open the letters stand, and how even the weight is.",
  },
  {
    id: "serif",
    label: "Serif",
    hint: "A bar across the end of each stroke. Its reach, its depth and how far it is bracketed are three numbers, and they are most of the difference between an old-style, a slab and a didone.",
  },
  {
    id: "display",
    label: "Display",
    hint: "Made to be looked at rather than read. This is where the weight goes past what a text face would allow and where the wave, the flare and the ball live.",
  },
  {
    id: "hand",
    label: "Hand",
    hint: "Faces that remember the tool that made them: a nib held at an angle, a brush, a marker. The lean and the contrast do most of the work.",
  },
];

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
  family: "sans",
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
  family: "serif",
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
  family: "display",
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
  family: "sans",
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
  family: "display",
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
  family: "display",
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
  family: "display",
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
  family: "hand",
  blurb: "A felt tip on paper: one width whichever way it goes, and an edge that followed the grain.",
  metrics: {
    ...SANS.metrics,
    // A hand leans a little; thirteen degrees was a typeface being italic.
    slant: 8,
    // Handwriting runs a larger x-height than type does, and sits looser.
    xHeight: 545,
    counterWidth: 345,
    sidebearing: 58,
  },
  /*
   * Monolinear, and that is the whole correction.
   *
   * This face used to be drawn with contrast at half and the pen turned thirty
   * degrees over, which is a broad nib -- a calligraphy pen, not a marker. A
   * felt tip lays one width whichever way it is dragged; what varies in real
   * marker lettering is ink and pressure, and neither of those is the nib. So
   * the pen says almost nothing here and the tool says the rest.
   */
  pen: { weight: 126, contrast: 0.06, angle: 0 },
  parts: {
    ...SANS.parts,
    // A hand does not close its apertures, and a bullet tip cannot draw a
    // corner: the tip has a radius and so does everything it draws.
    bowl: { width: 0.98, squareness: 0.1, aperture: 1.06 },
    corner: { radius: 30, join: "round" },
    /*
     * Square, and not for want of trying.
     *
     * A bullet tip is round and its caps should be too, and the round terminal
     * exists -- the Display uses it. On this face it breaks three things the
     * alphabet is checked for: the leg of a `k` folds over itself, the figures
     * come out with thirty pieces at one weight and thirty-two at the others so
     * the two cannot be joined into one variable font, and the arms of an `X`
     * stop a hundred and fifty thousandths of a unit past a tolerance of one.
     *
     * The last of those is a hair. The first two are the fault this whole
     * alphabet was walked to nothing to get rid of, and a cap shape is not
     * worth putting one of them back. So the softness comes from the corner
     * radius above and from the tool below, and the round cap waits for the
     * terminal itself to be fixed.
     */
    terminal: { kind: "butt", angle: 0 },
    shoulder: { spring: 0.42, reach: 1.02 },
  },
  /*
   * The shapes a person draws rather than the shapes a punchcutter cut. The
   * single-storey a is already what this engine draws by default -- it is the
   * two-storey one that is the alternate, and it is the text faces that should
   * be asking for it.
   */
  forms: { g: "curled", t: "straight", y: "straight", l: "tailed" },
  /*
   * And the tool, which is where this face stops being a slanted sans.
   *
   * A wander of a twentieth of a stem at a wavelength most of one, which reads
   * as paper rather than as grit; and ink gathering where the tip paused, which
   * is what a wet marker leaves at every join and every stop. No pressure: a
   * felt tip does not taper, it blots. No skip either -- that is a marker
   * running out, which is a thing somebody chooses rather than a thing a marker
   * is.
   */
  effects: {
    ...noEffects(),
    rough: { on: true, amplitude: 0.045, wavelength: 0.8, reach: "all", seed: 7 },
    pool: { on: true, size: 0.4, where: "both" },
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
  family: "display",
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
  family: "display",
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
  family: "display",
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
  family: "hand",
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

/**
 * Grotesque: a sans that has closed up.
 *
 * The other end of the sans family from the geometric one, and the difference
 * is almost entirely aperture and bowl. Where a humanist sans lets its c and
 * its e stand open and its arches spring low, this closes the apertures,
 * springs the shoulders high and squares the bowls a little. Nothing here is a
 * different letter; it is the same skeletons with three numbers moved.
 */
export const GROTESQUE: Style = {
  ...SANS,
  name: "Grotesque",
  family: "sans",
  blurb: "A sans that has closed up: tight apertures, high shoulders, squared bowls.",
  metrics: { ...SANS.metrics, xHeight: 535, width: 0.97, counterWidth: 318 },
  pen: { weight: 104, contrast: 0.06, angle: 0 },
  parts: {
    ...SANS.parts,
    bowl: { width: 0.97, squareness: 0.14, aperture: 0.62 },
    shoulder: { spring: 0.74, reach: 1 },
  },
};

/**
 * Didone: the pen turned right down, and the serifs left as hairlines.
 *
 * Two numbers do all of it. Contrast near its limit makes the horizontals
 * vanish beside the stems, and a serif with almost no depth and no bracket at
 * all leaves a flat line across the end rather than a shape grown out of it.
 * It is the most extreme thing the text controls reach without help from any
 * of the display ones.
 */
export const DIDONE: Style = {
  ...SANS,
  name: "Didone",
  family: "serif",
  blurb: "Contrast at its limit and serifs left as unbracketed hairlines.",
  metrics: { ...SANS.metrics, xHeight: 500, width: 0.98 },
  pen: { weight: 118, contrast: 0.8, angle: 0 },
  parts: {
    ...SANS.parts,
    slab: { on: true, projection: 0.54, thickness: 0.13, bracket: 0.02 },
    bowl: { width: 0.96, squareness: 0, aperture: 0.9 },
    crossbar: { height: 0.52, weight: 0.9 },
  },
};

/**
 * Slab: the serif taken the other way, to a bar as heavy as the stem.
 *
 * The same three serif numbers as the didone with two of them reversed --
 * depth up near the stem's own width, bracket at nothing -- and the contrast
 * taken out. What is left reads as a face built out of rectangles, which is
 * what an Egyptian is.
 */
export const SLAB: Style = {
  ...SANS,
  name: "Slab",
  family: "serif",
  blurb: "Serifs as heavy as the stems, and no contrast to soften them.",
  metrics: { ...SANS.metrics, xHeight: 528, width: 1.02, counterWidth: 340 },
  pen: { weight: 112, contrast: 0.05, angle: 0 },
  parts: {
    ...SANS.parts,
    slab: { on: true, projection: 0.6, thickness: 0.74, bracket: 0.04 },
    bowl: { width: 1, squareness: 0.08, aperture: 0.78 },
    shoulder: { spring: 0.66, reach: 1 },
  },
};

/**
 * Typewriter: one advance for every letter.
 *
 * Here to say that the monospaced face is a family of its own and to show what
 * it costs -- an i in a space made for an m, an m squeezed into one made for
 * an i -- rather than to be a good example of one. Slab serifs, because the
 * ears they give a narrow letter are the traditional answer to that problem.
 */
export const TYPEWRITER: Style = {
  ...SLAB,
  name: "Typewriter",
  family: "serif",
  blurb: "One advance for every letter, wide or narrow, and serifs to fill it.",
  metrics: { ...SLAB.metrics, monospaced: true, width: 0.95, sidebearing: 40 },
  pen: { weight: 96, contrast: 0.04, angle: 0 },
  parts: { ...SLAB.parts, slab: { on: true, projection: 0.72, thickness: 0.5, bracket: 0.06 } },
};

export const BASES: Style[] = [
  SANS,
  GROTESQUE,
  SERIF,
  DISPLAY,
  GEOMETRIC,
  RIBBON,
  TECHNICAL,
  FAIRGROUND,
  DIDONE,
  SLAB,
  TYPEWRITER,
  MARKER,
  WAVY,
  FLARED,
  PSYCHEDELIC,
  BRUSH,
];
