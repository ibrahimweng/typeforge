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
import { NO_SCRIPT, type Script } from "./script";

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
  /**
   * The join, for the faces whose letters reach the ones beside them.
   *
   * The one part here that is not a decoration on a stroke end but a decision
   * about what a letter *is*. Every other face draws a letter and leaves a gap
   * either side; a script draws the gap as well, and the stroke that finishes
   * one letter and starts the next is a single stroke with a glyph boundary in
   * the middle of it.
   *
   * Kept in `parts` rather than beside the pen because it is shared by every
   * letter that has one, which is the test everything else here passes. What it
   * means for a letter is worked out in `script.ts`.
   */
  script: Script;
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
export type Family = "sans" | "serif" | "display" | "hand" | "script";

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
  {
    id: "script",
    label: "Script",
    hint: "The faces whose letters reach the ones beside them. The gap between two letters is not empty space here, it is the stroke that carries one into the next, so the spacing and the joining are the same control.",
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
    script: { ...NO_SCRIPT },
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
  /*
   * The two-storey a, which is what most text faces use and what none of them
   * were asking for.
   *
   * The alternate has said so in its own hint since it was written -- "what
   * most text faces use" -- and single storey is what this engine draws by
   * default. So every face here had the geometric one, which is most of why a
   * Serif and a Geometric read as the same drawings with the pen changed.
   */
  forms: { a: "double", J: "descending" },
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
  blurb: "A fat face: as heavy as the counters will take, with the weight all on the uprights.",
  /*
   * The fat face, which is a category rather than a description.
   *
   * "Display" said only that it was big, and big is what every face in this
   * group is. The fat face is a particular thing -- the nineteenth-century
   * poster letter, taken as heavy as its counters will survive, with vertical
   * stress so the weight piles on the uprights and the curves thin away where
   * they turn. Set tight it reads as one block of colour, which is what it was
   * invented to do.
   */
  metrics: { ...SANS.metrics, xHeight: 575, counterWidth: 285, sidebearing: 34, width: 1.02 },
  pen: { weight: 205, contrast: 0.55, angle: 0 },
  // The apex cut flat, which its own hint says is what a heavy face does to
  // keep the top of an A from going black.
  forms: { A: "flat" },
  parts: {
    ...SANS.parts,
    shoulder: { spring: 0.66, reach: 1.02 },
    /*
     * Narrower than tall, which is both what a fat face is and what keeps its
     * letters in the order the rest of the alphabet stands in. At a round bowl
     * this face's `o` came out seventeen units wider than its `n` -- the stems
     * are two hundred units of ink and the counter between them only two
     * hundred and eighty -- and an `o` wider than an `n` is a face whose
     * rhythm has inverted.
     */
    bowl: { width: 0.92, squareness: 0.12, aperture: 0.9 },
    corner: { radius: 0, join: "round" },
    terminal: { kind: "butt", angle: 0 },
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
  /*
   * The three letters a geometric face argues about, and every one of these
   * alternates names it in its own hint: the tail hung under the bowl rather
   * than crossing its wall, a G with nothing turned back into it, and the M's
   * vertex carried to the baseline to square the letter off. The a stays as it
   * is -- single storey is already what is drawn here, and it is the text faces
   * that wanted the other one.
   */
  forms: { Q: "under", G: "bare", M: "deep" },
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
  // A single bent stroke cannot tell an l from a one, so the l is turned out
  // at the foot -- which is what its alternate exists for.
  forms: { l: "tailed" },
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
  // The t cut off square at the baseline, which its own hint calls the
  // squared or technical face's.
  forms: { t: "straight" },
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
  blurb: "Circus and western wood type: the pen turned a quarter, so the horizontals carry the weight and the verticals thin away.",
  /*
   * Already the one face here drawn with reverse contrast, and that was never
   * the problem: it moved six numbers of thirty-six and drew the same letters
   * as everything else, so its one idea was carrying the whole face alone.
   * Wide, heavy, slabbed and set on the older forms, it reads as the poster it
   * is named after rather than as a sans with its pen turned.
   */
  metrics: { ...SANS.metrics, xHeight: 560, counterWidth: 400, sidebearing: 46, width: 1.1 },
  // Not as far as reverse contrast will go: at seven tenths the uprights thin
  // to hairlines and the right stem of an `n` all but leaves. Six tenths keeps
  // the horizontals carrying the weight and the letters legible, which is what
  // the wood type it is named after actually did.
  pen: { weight: 150, contrast: 0.6, angle: 90 },
  // The older shapes a wood-type poster is cut in: the W built as two vees
  // that overlap, and a one with a foot so it does not lean on its neighbours.
  forms: { W: "crossed", one: "footed" },
  parts: {
    ...SANS.parts,
    // Slabs, because a circus face has them and because a slab laid across a
    // thin vertical is what stops reverse contrast reading as a mistake.
    slab: { on: true, projection: 0.5, thickness: 0.34, bracket: 0 },
    bowl: { width: 1.06, squareness: 0.18, aperture: 1 },
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
  // A wave needs something long and flat to happen along, and the barred seven
  // and the open four both give it one where the plain forms give it a
  // diagonal.
  forms: { seven: "barred", four: "open" },
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
  // The art-nouveau f and J, both carried below the line as a display face
  // does with them.
  forms: { f: "descending", J: "descending" },
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
  // The warm curled g and the descending f, both of which their own hints
  // give to a display face.
  forms: { g: "curled", f: "descending" },
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
  /*
   * The pressure, which is what separates a brush from a slanted pen.
   *
   * A broad nib thins where the stroke turns across it, and the pen here
   * already does that. A brush thins where the hand lifted, which is a fact
   * about position along the stroke and nothing a pen can say. Heaviest in the
   * middle: a stroke laid down and picked up again.
   *
   * A little roughening with it and no ink pooling -- a brush leaves a dry edge
   * where the bristles ran out, not a wet one where it sat.
   */
  effects: {
    ...noEffects(),
    press: { on: true, at: "middle", amount: 0.34 },
    rough: { on: true, amplitude: 0.03, wavelength: 1.2, reach: "all", seed: 11 },
  },
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
  /*
   * The two-storey a, which is what most text faces use and what none of them
   * were asking for.
   *
   * The alternate has said so in its own hint since it was written -- "what
   * most text faces use" -- and single storey is what this engine draws by
   * default. So every face here had the geometric one, which is most of why a
   * Serif and a Geometric read as the same drawings with the pen changed.
   */
  forms: { a: "double", R: "curved" },
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
  /*
   * The two-storey a, which is what most text faces use and what none of them
   * were asking for.
   *
   * The alternate has said so in its own hint since it was written -- "what
   * most text faces use" -- and single storey is what this engine draws by
   * default. So every face here had the geometric one, which is most of why a
   * Serif and a Geometric read as the same drawings with the pen changed.
   */
  forms: { a: "double" },
  parts: {
    ...SANS.parts,
    /*
     * Longer than the old-style's, and no thinner or squarer than this.
     *
     * A didone's serifs are unbracketed hairlines and both of those were tried:
     * a bar at eleven hundredths of a stem, and a bracket of nothing at all.
     * Either on its own pinches the `Q` into two pieces where its tail crosses
     * the bowl -- bisected, and the projection is innocent. Two hundredths of a
     * bracket is a hairline by any reading, and a Q in two pieces is not a Q.
     */
    slab: { on: true, projection: 0.58, thickness: 0.13, bracket: 0.02 },
    /*
     * No balls, and this is the thing this face was most supposed to get.
     *
     * A ball on the `a`, the `c`, the `f`, the `r` and the `y` is half of what
     * makes a didone read as one at a glance, and the part has sat unused since
     * it was written with only the Psychedelic reaching for it. It cannot go on
     * here: a ball goes wherever a stroke stops in mid-air, the tail of a `Q` is
     * such a stop, and at every size tried -- from seven tenths of a stem to a
     * stem and a sixth -- it comes away as a disc of its own and the letter is
     * in two pieces. Hung below the bowl instead of crossing it, the same.
     *
     * So it waits for somewhere a base can say "not on this letter". A face is
     * a set of decisions and this is one it cannot make yet.
     */
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
  /*
   * The two-storey a, which is what most text faces use and what none of them
   * were asking for.
   *
   * The alternate has said so in its own hint since it was written -- "what
   * most text faces use" -- and single storey is what this engine draws by
   * default. So every face here had the geometric one, which is most of why a
   * Serif and a Geometric read as the same drawings with the pen changed.
   */
  forms: { a: "double" },
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
  /*
   * The two-storey a, which is what most text faces use and what none of them
   * were asking for.
   *
   * The alternate has said so in its own hint since it was written -- "what
   * most text faces use" -- and single storey is what this engine draws by
   * default. So every face here had the geometric one, which is most of why a
   * Serif and a Geometric read as the same drawings with the pen changed.
   */
  // And a one with a foot on it: a monospaced face gives every letter the same
  // advance, so a bare one sits in a column of white with nothing to fill it.
  forms: { a: "double", one: "footed" },
  parts: { ...SLAB.parts, slab: { on: true, projection: 0.72, thickness: 0.5, bracket: 0.06 } },
};

/**
 * The handwriting: the plainest of the four that join.
 *
 * A monoline hand with no pretension to calligraphy -- one thickness, a small
 * lean, letters that reach each other and a baseline that does not quite hold
 * still. It is the one to read the others against, because it changes only the
 * things that make a script a script and leaves the pen alone.
 *
 * The sidebearing is left alone, which was not obvious. A joined letter never
 * uses it -- it is drawn deliberately touching its own origin, and the nudge
 * that would push it inside a sidebearing is skipped for exactly that reason --
 * but the capitals, the figures and the marks on this face do not join, and
 * they are spaced by it like any other letter. Set to nothing, as this was at
 * first, every one of them sat flush against its neighbours.
 */
export const HANDWRITING: Style = {
  ...SANS,
  name: "Handwriting",
  family: "script",
  blurb: "A plain joined hand. A line that bows as it goes, a pen that swells on the downstroke, and a lean that will not sit quite still.",
  /*
   * The capitals come down and the ascenders go up, to leave room for the
   * bounce.
   *
   * A hand that puts each letter a little off the line needs somewhere to put
   * it. On the inherited metrics the ascender stood thirty units above the
   * capitals and this face bounces by thirty-one, so an `l` that happened to
   * drop landed under an `H` that could not -- capitals do not join, so they do
   * not bounce. The gap has to be wider than the bounce, and it is.
   */
  metrics: { ...SANS.metrics, xHeight: 520, capHeight: 700, ascender: 790, slant: 6 },
  pen: { weight: 84, contrast: 0.22, angle: 28 },
  /*
   * The single-storey a and the tailed l, which is what a hand writes. Nobody
   * draws a two-storey a with a pen unless they are drawing a typeface.
   */
  forms: { k: "standing", l: "tailed", g: "curled", t: "straight", f: "descending" },
  parts: {
    ...SANS.parts,
    /*
     * Cut square, on all four of these, and the note is here because it is not
     * what any of them would choose.
     *
     * Measured across the four, twenty-six letters each. A butt cap folds
     * nothing anywhere. A round cap folds twenty-five letters on the Formal
     * Script and twenty-four on the Casual -- the two whose pens have contrast
     * -- and on the two that have none it folds nothing at the weight they are
     * drawn at but folds the `W` and the `Y` by the time the weight control
     * reaches 260, which is inside the range every face here has to survive. An
     * angled cut folds fourteen to eighteen letters on every one of the four,
     * contrast or no contrast.
     *
     * So the round cap and the pen do not combine in this engine, and the
     * angled cut does not work at all. The Marker found the first of those the
     * same way and settled on the same answer.
     *
     * It costs less here than it sounds: nearly every terminal on a joined face
     * is buried inside a lead-in or a lead-out, so what the cap looks like only
     * shows on the capitals and the marks.
     */
    terminal: { kind: "butt", angle: 0 },
    corner: { radius: 40, join: "round" },
    shoulder: { spring: 0.55, reach: 1 },
    script: {
      on: true,
      /*
       * Low, so the join runs along the writing line and the letters arch over
       * it. Set near the waist -- which is where these all began -- the
       * connecting stroke crosses every letter at mid height and a word comes
       * out threaded on a rule rather than written on a line. `levelArc`
       * arrives tangent to the horizontal, so a long stretch either side of
       * every seam is flat, and at the waist that flat is the most visible
       * thing on the page.
       */
      height: 0.18,
      reach: 1.5,
      flat: 0.2,
      // No loops. A print hand does not make them, and leaving them off is what
      // separates this from the three below rather than an omission.
      loop: 0,
      irregularity: 1,
      bow: 0.8,
    },
  },
  /*
   * A ballpoint resting where the strokes meet, and nothing else.
   *
   * The joins are where a hand actually pauses -- the pen arrives, changes
   * direction and leaves -- so that is where the ink gathers. No roughening:
   * this is a biro on ordinary paper, which leaves an edge as clean as a
   * printed one, and it is the face the other three are read against.
   */
  effects: {
    ...noEffects(),
    pool: { on: true, size: 0.3, where: "joins" },
  },
};


/**
 * The formal script: a pointed pen held at an angle and moved slowly.
 *
 * The copperplate end of the family. Everything about it says a hand that was
 * being careful: a steep lean, thick downstrokes and hairline upstrokes from a
 * pen with more contrast than any other face here, a small x-height under long
 * ascenders, and loops wide enough to be the point of the letter rather than a
 * detail on it. The join hands over low and reaches far, so the letters stand
 * apart on a long even swing.
 *
 * Its irregularity is nearly nothing, and that is the setting that makes it
 * formal. The others are hands writing; this one is a hand performing.
 */
export const FORMAL_SCRIPT: Style = {
  ...SANS,
  name: "Formal Script",
  family: "script",
  blurb: "A pointed pen held at an angle and moved slowly. Long loops, deep contrast, and a steep even lean.",
  metrics: { ...SANS.metrics, xHeight: 430, ascender: 790, descender: -260, slant: 22 },
  pen: { weight: 96, contrast: 0.58, angle: 42 },
  forms: { k: "standing", a: "double", g: "curled", l: "tailed", f: "descending", one: "footed" },
  parts: {
    ...SANS.parts,
    // Square, for the reason set out on the Handwriting above.
    terminal: { kind: "butt", angle: 0 },
    corner: { radius: 46, join: "round" },
    bowl: { width: 0.92, squareness: 0, aperture: 1 },
    shoulder: { spring: 0.5, reach: 0.96 },
    script: {
      on: true,
      // Low, for the reason set out on the Handwriting above.
      height: 0.16,
      reach: 1.9,
      // Almost no flat: a formal hand swings from one letter into the next in
      // one continuous turn and never runs level between them.
      flat: 0.04,
      loop: 1.8,
      irregularity: 0.12,
      bow: 0.6,
    },
  },
  /*
   * The pressure a pointed pen puts on the paper, and only that.
   *
   * A pointed nib spreads under the hand and closes as it lifts, which is a
   * fact about where along the stroke you are rather than about which way it
   * is going -- the one thing the pen model here cannot say. No roughening and
   * no dry patches: a copperplate hand was written slowly with a wet nib, and
   * the whole character of it is that nothing wavers.
   */
  effects: {
    ...noEffects(),
    press: { on: true, at: "middle", amount: 0.3 },
  },
};

/**
 * The casual script: a felt tip moving fast.
 *
 * The opposite corner from the formal one, and it is the settings rather than
 * the letterforms that put it there. The hand is quick, so the seam is high and
 * the reach is short -- the letters crowd each other the way they do when
 * somebody is not waiting for the last one to dry. The loops are barely there,
 * because a fast hand cuts corners, and the writing does not sit still.
 */
export const CASUAL_SCRIPT: Style = {
  ...SANS,
  name: "Casual Script",
  family: "script",
  blurb: "A felt tip moving fast. High joins, short reach, small loops, and a line that bows and will not sit still.",
  // Bounces hardest of the four, so it needs the most room between its
  // capitals and its ascenders. See the note on the Handwriting.
  metrics: { ...SANS.metrics, xHeight: 560, capHeight: 690, ascender: 800, descender: -200, slant: 13 },
  pen: { weight: 112, contrast: 0.3, angle: 22 },
  forms: { k: "standing", g: "curled", t: "straight", y: "straight", f: "descending" },
  parts: {
    ...SANS.parts,
    // Square, for the reason set out on the Handwriting above.
    terminal: { kind: "butt", angle: 0 },
    corner: { radius: 70, join: "round" },
    bowl: { width: 1.05, squareness: 0, aperture: 1.08 },
    shoulder: { spring: 0.48, reach: 1.06 },
    script: {
      on: true,
      // Low, for the reason set out on the Handwriting above.
      height: 0.17,
      reach: 1.05,
      flat: 0.3,
      loop: 0.7,
      irregularity: 1.6,
      bow: 0.9,
    },
  },
  /*
   * A felt tip that has been used before, moving quickly.
   *
   * All three of the things a marker does: a dragged edge, ink pooling where
   * the hand stopped and turned, and the odd dry patch where it moved faster
   * than the ink could follow. The roughening is long-wavelength rather than
   * gritty -- a tip that wide cannot leave a fine edge, and a long wander is a
   * quarter of the points.
   */
  effects: {
    ...noEffects(),
    rough: { on: true, amplitude: 0.032, wavelength: 1.2, reach: "all", seed: 23 },
    pool: { on: true, size: 0.4, where: "both" },
    /*
     * Sparse. At a sixth of the letter broken the words read as chewed rather
     * than as written with a tired pen -- a marker that skips that much is one
     * nobody would still be using. A tenth leaves a gap every few letters,
     * which is what the real thing does.
     */
    skip: { on: true, density: 0.09, length: 1.5, width: 0.16, seed: 23 },
  },
};

/**
 * The monoline script: one thickness, drawn rather than written.
 *
 * The one of the four that is a lettering job rather than a hand. Nothing about
 * it varies -- no contrast, no bounce, an even seam and an even reach -- and
 * the loops are round rather than pointed because they were constructed rather
 * than turned. It is what a sign painter rules out with a compass, and its
 * evenness is the whole of its character.
 *
 * Drawn at the proportions the genre actually uses, which is where this face
 * was wrong rather than merely different. A monoweight script is a *hairline*:
 * the stroke is somewhere near a thirteenth of the x-height, the x-height is
 * under half the ascender so the loops have room to be the point of the letter,
 * and the whole thing leans hard. Set at a sixth of a much larger x-height with
 * ascenders half again as tall, it was a fat upright cursive -- the shape of a
 * script with none of the proportions of one.
 *
 * Every quantity the join and the loops are measured in is a multiple of the
 * pen, which is right at a text weight and is the trap here: taking the pen
 * down by two thirds takes the reach, the loops and the ball down with it
 * unless they are put back up by the same factor. That is why `reach` and
 * `loop` are numbers that look absurd beside the other three faces.
 */
export const MONOLINE_SCRIPT: Style = {
  ...SANS,
  name: "Monoline Script",
  family: "script",
  blurb: "A hairline of one thickness, drawn rather than written. Long looped ascenders, a hard lean, and a drop of ink on every open end.",
  metrics: {
    ...SANS.metrics,
    xHeight: 360,
    /*
     * Capitals raised with the ascenders rather than left where the sans put
     * them. Every other face here has its ascender a shade over its cap; this
     * one carries the ascender half again as high, and a capital left at the
     * sans' height would be a third of the way down the letter beside it. It is
     * also what keeps an accent on an `l` under the ceiling the drawing is
     * checked against, which is read off the cap.
     */
    capHeight: 800,
    ascender: 900,
    descender: -320,
    /*
     * Twenty-one, and it is the descenders that set the ceiling rather than
     * taste. The lean turns about the seam, so a descender three hundred units
     * below it swings a long way left; past twenty-two the `p` and the `j` come
     * out further left than their own origin and stand in the letter before.
     */
    slant: 21,
    width: 0.95,
    sidebearing: 40,
  },
  pen: { weight: 28, contrast: 0, angle: 0 },
  forms: { k: "standing", l: "tailed", f: "descending", seven: "barred", four: "open" },
  parts: {
    ...SANS.parts,
    // Square, for the reason set out on the Handwriting above.
    terminal: { kind: "butt", angle: 0 },
    /*
     * A drop of ink wherever a stroke stops in mid-air.
     *
     * Five stems across, which is far past what the control offers a face of
     * ordinary weight and is the same disc in absolute terms: the ball is
     * measured against the stem, and this stem is a third of the others'. At
     * the 2.4 the slider stopped at, the drop came out a full stop.
     *
     * The join's own ends are cut square and get none of this -- they are not
     * ends, they are the middle of a stroke that happens to cross a boundary.
     */
    ball: { size: 5, drop: 0.7 },
    corner: { radius: 30, join: "round" },
    bowl: { width: 0.92, squareness: 0, aperture: 1 },
    shoulder: { spring: 0.6, reach: 1 },
    script: {
      on: true,
      // Low, for the reason set out on the Handwriting above.
      height: 0.22,
      // In pens, and this pen is a hairline: five of them is the same run of
      // white that 1.65 was at the old weight.
      reach: 5,
      flat: 0.05,
      loop: 9,
      // Nothing. A drawn script is drawn on a line and stays on it, and this is
      // the setting that says so.
      irregularity: 0,
      bow: 0.2,
    },
  },
  /*
   * And no tool marks either, for the same reason there is no bounce.
   *
   * This face was ruled out rather than written, and a ruled line has no ink
   * pooling in it and no dry patches. Leaving the whole layer off is the
   * decision that makes it the even one of the four rather than an oversight --
   * it is the only face here that would be *wrong* with texture on it.
   */
  effects: { ...noEffects() },
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
  HANDWRITING,
  FORMAL_SCRIPT,
  CASUAL_SCRIPT,
  MONOLINE_SCRIPT,
];
