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
import type { JoinKind, Pen, SerifHead, SerifShape, Terminal, TerminalKind } from "./types";
import { NO_SCRIPT, type Script } from "./script";

/** The heights and widths every letter is built against. */
/**
 * How a listed side closes at a heavy weight: as fast as the n's ("closes",
 * or on a stem's side only), half as fast (`"half"`, as a side with no kind
 * does), unopened at the Light, or held at the Regular's at every weight.
 * A fourth entry moves either side by that many units at the Thin, going
 * with the face's own light opening (`metrics.lightHeld`), and a fifth by
 * that many at the Black (a `blackness` of 0.88), run in from the face's own
 * weight and held there past it.
 */
export type SideKind = "closes" | "stem-left" | "stem-right" | "unopened" | "held" | "half";

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
   * How much more of it a capital takes, as a multiple. One, or left out, is
   * the same as the lowercase.
   *
   * A capital is taller, so the same white beside it reads as less: Lora sets
   * its capitals half as loose again as its lowercase -- 45 units a side
   * against 30 -- and a text face spaced for its lowercase alone set words in
   * capitals cramped.
   */
  capitalSpacing?: number;
  /**
   * Whether that extra closes at a heavy weight as the sidebearing does and
   * as fast again: Geist gives its H 12 more than its n at the Regular, 7 at
   * the UltraBlack and 6 at the Black.
   */
  capitalCloses?: boolean;
  /**
   * How wide every letter runs, as a multiple.
   *
   * Applied to the horizontal measures a letter is built from and to nothing
   * else, so the face condenses or extends without the strokes changing
   * thickness -- which is the difference between a width and a scale.
   */
  width: number;
  /**
   * The share of that width a member of the family takes from the width
   * axis, a `wdth` over a hundred (see `widthedStyle`): left out on the
   * drawing, which is the Normal. Said rather than worked out from `width`,
   * since a letter set small (a superior, a fraction's figures) is drawn
   * narrower on purpose and is not thereby a Condensed.
   */
  widthAxis?: number;
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
   * How far each side is fitted to the white it already has, nought to one.
   *
   * Nought, or left out, sets every letter the same sidebearing either side
   * of its ink and tightens the round ones by a fixed share on the right. One
   * measures each side -- a stem is flat against its box, an o leaves wedges
   * of white beside it, a v a whole triangle -- and gives back as much as it
   * already has: see `fitted` in `build.ts`.
   */
  fit?: number;
  /**
   * Whether the figures share one width, as a column of numbers wants, or are
   * each spaced by their own ink, as figures in running text want. Tabular, or
   * left out, is the one width; proportional needs `fit` to space them.
   */
  figures?: "tabular" | "proportional";
  /**
   * Whether the tabular one stands with its ink in the middle of the figures'
   * column, as the nought and the eight do, rather than with its stem there.
   *
   * Asked of a face whose figures stand where they are drawn rather than
   * being fitted: a fitted face centres every figure on its own ink already
   * (`fitted` in `build.ts`). With its stem on the middle line, the one's flag
   * hangs to the left with nothing to balance it on the right, and the
   * Grotesque's one stood most of a stem left of the column's middle at every
   * weight.
   */
  oneCentred?: boolean;
  /**
   * Sides the eye sets rather than the measure, per letter: each side's white
   * as a multiple of the sidebearing at this weight, before a capital's extra.
   *
   * The fitting in `build.ts` finds a letter's white from its drawing and
   * gives it back, and for most letters that is where a foundry lands too.
   * For a few it is not, because a foundry spaces some shapes by habit as much
   * as by area: Geist sets its T and its Z as open as a V (25 a side) but its
   * E at 57 and its L at 47, its x and k at 47 where the measure says 20, and
   * its B and R at 62 where their round sides would give back as much as a D.
   * Those letters are listed here, measured off Geist, and the rest are
   * fitted.
   *
   * They close at a heavy weight only half as fast as a fitted side does (see
   * `fitted` in `build.ts`), unless marked "closes": Geist closes its bar,
   * its stops and its t as fast as its n. "stem-left" and "stem-right" close
   * just that side as fast: the stem beside a b's or a d's bowl. "unopened"
   * sides are not opened towards the Thin (`lightHeld.open`).
   */
  /**
   * How much taller the x-height is drawn by a heavy weight (`by` units, by a
   * blackness of `at`): Geist's rises from 542 at its Regular to 552 at its
   * Black. Only the letters are drawn taller; the face's x-height, and the
   * weight measured against it, stay the face's own.
   */
  xGrows?: { by: number; at: number };
  /**
   * How far the middle arm of an E reaches against the arms above and below
   * it, as a share of theirs, 0.5 to one; and the F's, the Æ's and the
   * Œ's with it. Never so short at a heavy weight that it shows less than a
   * third of what they show past the stem. The Grotesque's E and F keep the
   * arms they are measured to. Left out, 0.86, a little short, as a roman
   * E's is.
   */
  middleArm?: number;
  /**
   * How tall a square dot stands against its width at the Thin and at the
   * Black (by a blackness of `at`): Geist's full stop is a tenth taller than
   * wide at its Thin, square at its Regular and 0.92 as tall at its Black.
   */
  dotAspect?: { thin: number; black: number; at: number };
  /**
   * How large the dot of an i and a j is drawn against what the face would
   * give it, 0.7 to 1.5, still held under the ascender. Left out, one.
   */
  dotScale?: number;
  /**
   * How far the oe's e crosses its side into the o's, at the most, as a share
   * of the two sides' width together, 0.5 to one: the two kept one wall.
   * Left out, the e is set half the o's width on, as the ligature always is,
   * which on a light pen crosses the sides so far that they stand apart
   * inside the overlap and leave a lens of a counter between them.
   */
  oeWall?: number;
  /**
   * How much faster the counters close midway to the Black than the straight
   * line `heavyCounter` gives, as a share of it at its most: see `narrowed`.
   */
  counterBend?: number;
  sides?: Record<
    string,
    | [number, number]
    | [number, number, SideKind]
    | [number, number, SideKind, [number, number]]
    | [number, number, SideKind, [number, number], [number, number]]
  >;
  /**
   * How much counter a heavy weight gives back for the stem it gains, unit
   * for unit, past the text weight (see `blackness`). Left out, a heavier pen keeps the
   * counters where they were and the letters run wider, which is how every
   * face here grows by default. Geist does the other thing -- its Black's n
   * has 155 units of counter where its Regular has 250, on a stem twice as
   * heavy -- and the spacing closes with it: see `narrowed`.
   */
  heavyCounter?: number;
  /**
   * The least a heavy weight's counter closes to, against the x-height, where
   * `heavyCounter` closes it: a fifth when left out. A geometric face goes
   * lower, keeping its rounds round rather than its counters open.
   */
  heavyFloor?: number;
  /**
   * Past the Black (a blackness of `HEAVY_OPEN_FROM`, the Sans at Geist
   * Black's stem of 194), how much of the stem gained each bowl's half-width
   * takes back, so its counter stays about as open as the Black's rather
   * than closing to a slit between two stems: see `pastBlack`. Left out, the
   * bowls past the Black are drawn as before.
   */
  heavyOpen?: number;
  /**
   * Where `heavyOpen` starts, as `stemBlack` counts weight, on a face drawn
   * heavy to begin with: `HEAVY_OPEN_FROM` when left out. The Display's own
   * pen is nearly a Black already, and its counters are what is left.
   */
  heavyOpenFrom?: number;
  /**
   * Past the Black, how much of the stem gained a round stroke gives up at its
   * sides, its outside held where it was: see `rounds.ts`. For a face that
   * keeps its rounds round (`heavyFloor`) and so cannot let its bowls out.
   */
  heavyThin?: number;
  /**
   * Below the pen `from`, each bowl and arch is held as wide through its
   * middle as at `from`, widening by `grow` of it over the whole way to no pen
   * at all: see `frame` in `letters/common.ts`. Left out, a lighter pen widens
   * the bowls (their insides grow taller) and narrows the arches (the counter
   * is kept), which is how every other face here thins.
   */
  lightHeld?: { from: number; grow: number; open?: number };
  /**
   * The word space as shares of the x-height, at the face's own pen and at
   * its Black (see `blackness`), held past it. Left out, it follows the arch.
   */
  wordSpace?: [number, number];
  /**
   * The superior figures and the fractions set as a text face sets them
   * (Lora's): each figure `share` of the cap height, a superior's and a
   * numerator's foot `foot` of the cap height up, and a fraction's two
   * figures either side of a long slash from the line to the cap line,
   * leaning `slope` across for every unit up and `slash` of the pen across,
   * the figures on `pen` of the pen.
   * Left out, a superior is six tenths of a capital hung from the cap line
   * and a fraction's figures stand clear of a short slash.
   */
  superiors?: {
    share: number;
    foot: number;
    slope: number;
    slash: number;
    pen: number;
    /** How much wider than the face's figure set small each is drawn. */
    wide?: Record<string, number>;
    /** How far across a numerator's ink a fraction's slash leaves from. */
    slashAt?: Record<string, number>;
  };
  /**
   * Where a yen's two bars stand, as Lora's do: at `bars` of the cap height,
   * reaching `reach` of it either side of the middle (moved `shift` of it),
   * `deep` of the pen deep and even. Left out, they stand under the fork and
   * run the letter's width, one over the other where two will not fit.
   */
  yen?: {
    bars: [number, number];
    reach: number;
    shift: number;
    deep: number;
    /** Where the yen's own Y's arms meet, against the cap height: see `capitalY`. */
    meets?: number;
  };
  /**
   * Where the accents stand: `gap`, how far over a lowercase letter and over
   * a capital, as shares of the em; and `byFoot`, whether a grave or an
   * acute is set with its foot over the middle of the letter rather than its
   * whole width, as a steep one is. Left out, see `gapFor`.
   */
  accents?: {
    gap: [number, number];
    byFoot?: boolean;
    /**
     * The gap over a lowercase letter and a capital at the Black
     * (`blackness` of `heavyAt`), run in from `gap` as the weight grows and
     * held there past it. Left out, the gap is `gap` at every weight.
     */
    heavy?: [number, number];
    heavyAt?: number;
  };
  /**
   * The most contrast a heavy weight takes on: see `heavierPen`. Left out,
   * the horizontals go on thinning to the pen's limit, which on a face with
   * little contrast of its own reads as a fat face rather than as an Ultra.
   */
  heavyContrast?: number;
  /**
   * How a heavy weight's contrast rises with its pen, where not in step with
   * `blackness`: towards `to`, most of the way there `over` units of pen past
   * `from`, and past `past` of the way to a Black climbing on as every other
   * face's does. Geist's horizontals thin fast from its Regular and then
   * level off -- its o's crown is 104 on a stem of 128 and 144 on 194 -- where
   * in step with `blackness` they came to 116 and 137. Its bowls are still
   * sized by the plain contrast: see `Pen.sized`.
   */
  contrastRise?: { from: number; to: number; over: number; past: number };
  /**
   * How much of the contrast a heavy weight gains the capitals and figures
   * take, as a share. Left out, all of it. Geist Black's E, T and 2 carry
   * horizontals of 142 on a stem of 172, where its o's crown is 127: the
   * capitals stand taller, and thinned as far as the lowercase they look
   * lighter than it.
   */
  capitalContrast?: number;
  /**
   * How much heavier than the pen a face's capitals and figures are drawn at
   * its lightest (pen 30), run in from nothing at `lightHeld.from`. Geist
   * Thin's capital and figure stems are 32 on a lowercase stem of 30.
   */
  capitalThin?: number;
  /**
   * The letters that hang past their own sides, and how far they may -- on
   * the left before the health check calls them touching the letter before
   * -- as a share of the em. A letter not listed starts at least half a
   * hundredth in. Geist hangs its Y, j and # up to ten units past their
   * sides, as a text face's overhangs do.
   */
  overhangs?: Record<string, number>;
  /**
   * The capitals and figures that overshoot their lines by their own amount,
   * in units, rather than by `overshoot`. Geist's O and Q overshoot 16
   * where its o overshoots 12; its other round capitals were fitted to 12,
   * and fit worse at 16.
   */
  overshoots?: Record<string, number>;
  /** Set on the style a capital or figure is drawn with: see `capitalContrast`. Never saved. */
  capital?: boolean;
  /**
   * Set on the style a letter drawn lighter across than the face is drawn
   * with, past the Black (`lighterAcross` in `letters/grotesque.ts`): its pen
   * is taken as it is. Never saved.
   */
  lighterAcross?: boolean;
  /**
   * Whether a straight stroke rising to the right is drawn as a hairline, as
   * a didone's are: the right arm of a v, a y and an x, the left leg of an A.
   * An upright pen gives both diagonals of a vee the same weight, and a
   * didone set that way had a y whose tail was as heavy as its stem.
   */
  risingHairline?: boolean;
  /**
   * The letters left as drawn on a face whose rising strokes are hairlines:
   * a text face's z, Z and slash carry their weight on the rising diagonal,
   * and a letter that draws its own hairline -- the Serif's A -- is not
   * thinned again.
   */
  risingOwn?: string[];
  /** The bowls' superness the face was drawn with, once `heavier` has rounded them. Never saved. */
  drawnSuperness?: number;
  /**
   * Each letter's width at the face's Bold against its Regular, where the
   * construction's own way of growing a heavy letter is not the face's: `at`
   * is how black the Bold is (see `blackness`), and the letter reaches its
   * factor there and holds it past it.
   *
   * A heavy weight here keeps its counters open by widening the letters, and
   * most faces do much the same. Lora does not, or not evenly: its Bold's o is
   * the width of its Regular's to the unit and its A and its w within a
   * dozen, while its B and its n take forty or fifty more -- which is a
   * drawing, letter by letter, and is written down as one.
   */
  bold?: {
    at: number;
    widths: Record<string, number>;
    /**
     * How much of the Bold's width is kept at a Black (a blackness of one),
     * eased back from all of it at the Bold toward halfway between the
     * Regular's own width and the construction's. Past its Bold a face has
     * no drawing to follow, and a Black held to a Bold's widths shut the
     * small counters -- the a's, the e's eye, the v's wings -- that the
     * construction's own widening keeps open. Left out, all of it.
     */
    kept?: number;
    /**
     * Each letter's width at the heaviest weight (a blackness of 1.5) against
     * what the rest of this would give it, reached along the weight from the
     * Bold. The construction widens a letter by the stems it has to fit and
     * the counters between them, so past a Bold an H, a D and an M ran on
     * wide while the letters with no counter to hold open -- the C, the E,
     * the T, the Z -- stood still or narrowed, and the colour of a heavy
     * word came and went letter by letter. Written down as the widths a
     * Black face keeps, against its own H and o. Left out, one.
     */
    past?: Record<string, number>;
    /**
     * The sidebearings at the Bold against the Regular's, reached by the
     * Bold and held past it: Lora Bold sets its rounds a quarter tighter
     * than its Regular (an o 31 a side against 41) and its stems a little.
     */
    spacing?: number;
  };
  /** The counter the face was drawn with, once `heavier` has narrowed it. */
  drawnCounter?: number;
  /**
   * How much wider or narrower than the face's rhythm a letter is drawn, by
   * letter, as a multiple of `width`.
   *
   * The rhythm sets most widths -- an n and an o follow from the counter and
   * the bowl -- but not all of them. How wide an H stands beside its n, how
   * far an x or a z reaches, how broad an S is: each of those is its own
   * decision in every face that has ever been drawn by hand, and a face
   * modelled on one has to be able to say so. Applied exactly as the width
   * is, to the horizontal measures a letter is built from and to nothing
   * else, so the strokes keep their weight.
   */
  proportions?: Record<string, number>;
  /**
   * The factor from `proportions` a letter is being drawn at, set by
   * `proportioned` and read by the few skeletons measured off the counter
   * rather than off the width. Never saved: nought or left out is one.
   */
  stretch?: number;
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
    /**
     * A bar of one depth all the way out, or one that thins toward its tip.
     * Square is a slab's; a wedge is what an old-style text serif is.
     */
    shape: SerifShape;
    /**
     * The top of a lowercase stem: a level bar both ways, or one flag sloping
     * down to the left, which is where a pen enters the stroke.
     */
    head: SerifHead;
    /**
     * The stem, as a share of the em, past which the serif stops lengthening
     * with it, and how much of what the stem gains after that it still takes.
     * Left out, an eighth of the em and a third. A text face like Lora holds
     * its serifs nearly where its Regular has them all the way to its Bold --
     * 64 units past a stem of 87, and 66 past one of 142 -- so a heavy cut's
     * serifs thicken rather than reach.
     */
    hold?: number;
    past?: number;
    /*
     * The soft finishes on a serif, each left out on every base so the old
     * drawing stands: nought, or left out, is the plain one.
     */
    /**
     * How much of the tip's depth is rounded, nought to one: the corner where
     * the bar stops turned on a radius of `tip` times half the tip's depth.
     */
    tip?: number;
    /**
     * How much wider an arm grows toward its beak, nought to 0.6: the end of
     * the arm is `1 + swell` times as wide as its root.
     */
    swell?: number;
    /**
     * Whether a stem an arch springs from keeps its head where the arch stops
     * short of the x-height (`shoulder.crest` below one): stood on the
     * x-height and wearing the head an i's stem wears, rather than stopped
     * with its arch, where there is no line to lay a head on. An arch raised
     * past the x-height takes its stem up with it either way. Left out, the
     * n's and the m's stems stop with their arches.
     */
    headKeep?: boolean;
    /**
     * How much deeper a sloped head's flag runs down its stem, as a share
     * more, nought to one: the flag's depth and the most any head may have
     * both grown by it. Left out, the head is a text weight's.
     */
    headDepth?: number;
  };
  shoulder: {
    /**
     * Where the arch leaves the stem, as a fraction of the x-height. Low is an
     * open, humanist n; high is a squared, industrial one.
     */
    spring: number;
    /** How far the arch reaches over before it turns down. */
    reach: number;
    /**
     * How high the arch rises, as a share of the x-height. One reaches the
     * waist; less stops short of it, which is what a running hand does.
     */
    crest: number;
    /**
     * How much lower an r's arm leaves its stem than the n's shoulder, as a
     * share of the x-height, nought to a tenth: the arm set down whole, its
     * top running under the x-height. Left out, the r's shoulder is the n's.
     */
    armRise?: number;
    /**
     * How much lower the arch leaves the stem, nought to 0.8: the turn up out
     * of the stem grows by this share and the turn down gives up the same.
     * Left out, the arch is drawn as it always was.
     */
    rise?: number;
    /**
     * How much further the pen is turned for an arch, in degrees, -45 to 45:
     * the arches of the n, m and h (and of the letters drawn from them) drawn
     * with the pen at its own angle plus this, so the arch leaves the stem
     * thinner and carries its weight further round onto the shoulder, as a
     * broad nib held steeper for the arches does. The stems, and the r's arm,
     * which is heavy where it leaves its stem, keep the face's own pen. Left
     * out, or nought, an arch is drawn with the face's pen.
     */
    angle?: number;
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
    /**
     * How far the round of a bowl is pushed toward its corners: nought is a
     * circle, and turned up the sides and the crown run flatter and the
     * turning gathers in the corners -- the superellipse of a neo-grotesque's
     * o, firm without being square. Not the squareness, which straightens the
     * sides outright and leaves circular corners on them.
     */
    superness: number;
    /**
     * Whether a bowl taller or wider than it is round is an oval, as a text
     * face's o is, rather than a circle's quarters on straight sides: see
     * `Frame.curve`. Only read where the superness is nought.
     */
    oval?: boolean;
    /**
     * How much of the taper (`terminal.taper`) the ends of an open bowl give
     * back, nought to one: at one the tail of a c and the foot of a C are cut
     * as wide as the pen leaves them, the bowl's end standing blunt, while
     * the hooks and tails of the other letters -- a t's, the foot of an a --
     * still thin as they stop. Left out, or nought, a bowl's ends taper as
     * every other end does.
     */
    blunt?: number;
    /**
     * How flat the tail of a c and an e runs, nought to 1.5: its foot laid
     * again on a circle `1 + tail` times as large, tangent where it leaves
     * the bottom. Left out, the tail is the bowl's own.
     */
    tail?: number;
    /**
     * How far a bowl's inner side is moved off its centre-line, nought to
     * 0.5, as a share of the stroke's width that way: thinner at the top and
     * heavier at the foot. Left out, a bowl is the pen's alone.
     */
    heft?: number;
    /**
     * Which way that inner side is moved, in degrees from straight up and
     * positive to the right, -45 to 45. Read only where `heft` is above nought.
     */
    heftTilt?: number;
    /**
     * How far a bowl's heft fades toward the stem it stands against, nought
     * to one: at one the bowl of a b, d, p or q meets its stem as the pen
     * drew it and takes its whole heft only at its far side, so the joins
     * stay light where a written bowl leaves the stem thin. Read only where
     * `heft` is above nought; left out, or nought, the whole bowl takes it.
     */
    heftFade?: number;
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
    /**
     * How far the inside of a join is rounded, nought to one, in stems: where
     * a stroke leaves another it is buried in, and inside a corner a stroke
     * turns. Left out, the inside of a join is the point the two edges make.
     */
    fillet?: number;
  };
  terminal: {
    kind: TerminalKind;
    /** Degrees off square, for the angled cut a broad nib leaves. */
    angle: number;
    /*
     * The soft finishes on an end, each left out on every base so the old
     * drawing stands: nought, or left out, is the plain one.
     */
    /**
     * How round the corners of a seen cut are, nought to 0.5, as a share of
     * the end's full width: a half makes the end a half circle.
     */
    soft?: number;
    /**
     * How much of a seen curved end's width is taken away, nought to 0.85: the
     * inner side drawn in toward the outer so the stroke thins as it stops.
     */
    taper?: number;
    /**
     * How far a stroke thins into its drop, nought to 0.85: the end's inner
     * side drawn in as `taper` draws a seen curved end's, so the drop need
     * cover only what is left of the end and may be smaller than the stroke
     * is wide -- a small ball on a stroke that narrows to it, where a drop is
     * otherwise never less than the stroke's own half width. Left out, or
     * nought, a drop is hung on the stroke as the pen drew it.
     */
    dropTaper?: number;
    /** The drop's size, -0.3 to 0.6: its radius times one more than this. */
    dropSize?: number;
    /** How far the ball of a drop is carried along its axis, nought to 1.5, in its own radii. */
    dropHang?: number;
    /**
     * How far a drop hanging from a curve above it turns from the end's
     * heading toward plumb, nought to one, at most sixty degrees.
     */
    dropCurl?: number;
    /**
     * How smoothly a drop's neck leaves the stroke, nought to one: at one it
     * departs with the stroke's own curvature, and its closing edge is curved.
     */
    dropNeck?: number;
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
    /** Only on curved ends: a straight end in mid-air is left cut. */
    curved?: boolean;
    /**
     * Whether a straight end in mid-air takes one too; on unless said. Unlike
     * `curved` it leaves the balls sized by the pen.
     */
    straight?: boolean;
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
  // A kind this version no longer draws, from an old document or a script,
  // is drawn as the plain cut rather than as nothing.
  const kind = TERMINAL_KINDS.includes(terminal.kind) ? terminal.kind : "butt";
  const plain = { kind: kind === "slab" ? "butt" : kind, angle: terminal.angle ?? 0 } as const;
  if (!slab.on) return { ...plain, open: true };
  const stem = style.pen.weight;
  const serif: Terminal = {
    kind: "slab",
    open: true,
    projection: slab.projection * serifReach(style),
    // Deep in proportion to the stem, and no deeper than the reach allows: a
    // light cut's serifs thin with its stems, a black's stop growing with them.
    thickness: slab.thickness * Math.min(stem, serifReach(style)),
    bracket: slab.bracket * Math.min(stem, serifReach(style)),
    bracketHome: homeBracket(style),
    shape: slab.shape === "wedge" ? "wedge" : "square",
    head: slab.head === "sloped" || slab.head === "flag" ? slab.head : "level",
    curved: plain,
  };
  // The tip's rounding, carried only where it is asked for: see `Terminal.tip`.
  if ((slab.tip ?? 0) > 0) serif.tip = slab.tip;
  return serif;
}

const TERMINAL_KINDS: TerminalKind[] = ["butt", "angled", "round", "teardrop", "level"];

/**
 * The bracket this style's own base draws at this weight, or nothing for a
 * style that is not one of the bases' or whose base has no serifs.
 */
function homeBracket(style: Style): number | undefined {
  const base = BASES.find((one) => one.name === style.name);
  if (!base?.parts.slab.on) return undefined;
  return base.parts.slab.bracket * Math.min(style.pen.weight, serifReach(style));
}

/**
 * The stem a serif is measured in.
 *
 * The stem itself through the text weights -- and past them it is not, at
 * either end. A serif is something the eye has to find at the end of a
 * stroke, and at a hairline a reach of two thirds of the stem is a dozen
 * units: the serifs of a light cut vanished into their own stems and it read
 * as a sans. Real light cuts keep their serifs about as long as the regular's
 * and only thin them, so below nine hundredths of an em the reach is counted
 * from halfway between the stem and that.
 *
 * And at a black weight a serif two thirds of a two-hundred-unit stem long and
 * as deep again is a flag rather than a serif: the heads of the i, the j and
 * the l stood out like pennants. Real heavy cuts grow their serifs much more
 * slowly than their stems, so past an eighth of an em the serif gains a third
 * of what the stem does.
 */
export function serifReach(style: Style, ordinary = false): number {
  const stem = style.pen.weight;
  const em = style.metrics.unitsPerEm;
  const light = em * 0.09;
  // `ordinary`: as every face grows its serifs, whatever this one's own hold,
  // for the things measured in serifs that are not their length.
  const heavy = em * ((ordinary ? undefined : style.parts.slab.hold) ?? 0.125);
  const past = (ordinary ? undefined : style.parts.slab.past) ?? 1 / 3;
  if (stem < light) return (stem + light) / 2;
  if (stem > heavy) return heavy + (stem - heavy) * past;
  return stem;
}

const EM = 1000;

/**
 * The plain sans every other base is built from.
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
const PLAIN: Style = {
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
    slab: {
      on: false,
      projection: 0.65,
      thickness: 0.43,
      bracket: 0,
      shape: "square",
      head: "level",
    },
    shoulder: { spring: 0.62, reach: 1, crest: 1 },
    bowl: { width: 1, squareness: 0, aperture: 1, superness: 0 },
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
/**
 * The sans: a neo-grotesque in the manner of Geist.
 *
 * Built on the plain sans above, with the decisions that make a modern
 * grotesque rather than a generic one. The proportions are compact -- an n
 * whose counter is not three stems across, an x-height of 0.53 of the em, the
 * ascenders level with the capitals -- and the stems carry a touch of contrast
 * so the crowns of the round letters sit a little lighter than their sides.
 *
 * Measured against Geist Regular at every point, and arrived at by moving the
 * numbers the other faces are built from rather than by drawing anything
 * separately: the same skeletons, the same pen, fitted.
 */
export const SANS: Style = {
  ...PLAIN,
  name: "Sans",
  blurb: "A neo-grotesque: compact, even, cut level at its curved ends.",
  metrics: {
    ...PLAIN.metrics,
    xHeight: 530,
    capHeight: 710,
    ascender: 710,
    descender: -150,
    overshoot: 12,
    counterWidth: 250,
    sidebearing: 80,
    capitalSpacing: 1.15,
    capitalCloses: true,
    fit: 1,
    // Geist's figures are proportional: its one is 385 wide, its zero 672.
    figures: "proportional",
    heavyCounter: 1.3,
    heavyContrast: 0.42,
    heavyOpen: 0.35,
    capitalContrast: 0.61,
    // Geist Thin's capitals and figures stand on stems of 32 to its lowercase's 30.
    capitalThin: 0.067,
    // Geist's Y, j and # hang up to 10 past their left sides.
    overhangs: { Y: 0.012, j: 0.012, numbersign: 0.012 },
    overshoots: { O: 16, Q: 16 },
    contrastRise: { from: 87, to: 0.27, over: 56, past: 0.82 },
    // Geist Thin's o and n are both a little wider down the stroke than the
    // Regular's, and set 5 units further apart on either side (its figures 10).
    lightHeld: { from: 87, grow: 0.085, open: 5 },
    // Geist's word space: 250 at the Thin and the Regular, 221 at the Black.
    wordSpace: [250 / 530, 221 / 530],
    // Geist stands its accents 55 over a lowercase letter and 66 over a
    // capital, and sets its steep grave and acute by their feet; and closer
    // over a heavy letter, 33 and 47 over Geist Black's.
    accents: { gap: [0.055, 0.066], byFoot: true, heavy: [0.033, 0.047], heavyAt: 0.88 },
    xGrows: { by: 10, at: 0.88 },
    counterBend: 0.24,
    dotAspect: { thin: 1.1, black: 0.92, at: 0.88 },
    /* Geist Regular's own sidebearings, over 80 (a capital's over 80 after its 12 of extra). */
    sides: {
      a: [0.59, 0.24, "closes"],
      // Geist's bowls stand 44 off at the Regular and 32 at the Black: a
      // fitted round side gave back twice that as the bowls narrowed. Its
      // v, w and y stand 3 closer at the Thin than the light opening gives,
      // and its e closes as fast as its n.
      b: [1, 0.52, "stem-left"],
      c: [0.59, 0.46, "closes"],
      d: [0.52, 1, "stem-right"],
      e: [0.545, 0.545, "closes", [1, 1]],
      o: [0.52, 0.52],
      p: [1, 0.52, "stem-left"],
      q: [0.52, 1, "stem-right"],
      g: [0.52, 1, "stem-right"],
      f: [0.75, 0.53, "closes", [0, 0], [-7, -3]],
      // Its foot reaches back under the letter before (Geist -5 to -3).
      j: [-0.06, 1, "closes", [-5, -2]],
      k: [1, 0.59, "stem-left"],
      // Fitted, its arm's side closed to 20 at the Light; Geist Thin's is 50.
      r: [1, 0.55, "closes"],
      // Its foot turns out nearly to the advance, as Geist's does (24 off).
      l: [1, 0.3, "closes"],
      v: [0.28, 0.28, "half", [-3, -3]],
      w: [0.28, 0.28, "half", [-3, -3]],
      y: [0.28, 0.28, "half", [-3, -3]],
      t: [0.69, 0.46, "closes", [0, 0], [-8, -5]],
      x: [0.59, 0.59],
      // Geist sets its z 51 off either side from the Regular to the Black.
      z: [0.64, 0.64, "held", [2, 2]],
      A: [0.11, 0.11, "held", [5, 5]],
      // Geist closes its B, K, L, R, U and its a, c, f, j, l and r as fast
      // as its n (its B stands 62 off its bowl at the Regular, 43 at the
      // Black); closed half as fast, they stood 8 to 16 units loose there.
      // Geist Thin sets the right of its B, E, F, L, P and R 7 units closer
      // than its Regular, where opened with the rest they stood 11 to 16 loose.
      B: [1, 0.63, "closes", [0, -12]],
      // Geist's D: 92 off its stem, 41 off its bowl; fitted, the bowl's side
      // closed to 25 at the heavy weights.
      D: [1, 0.36, "stem-left"],
      E: [1, 0.55, "closes", [0, -11]],
      F: [1, 0.5, "closes", [0, -12]],
      P: [1, 0.5, "closes", [0, -12]],
      C: [0.41, 0.35, "held", [5, 5]],
      G: [0.41, 0.48, "held", [5, 5]],
      J: [0.69, 0.81, "closes"],
      K: [1, 0.04, "closes"],
      L: [1, 0.44, "closes", [0, -12]],
      R: [1, 0.63, "closes", [0, -12]],
      // Geist stands its T 12 off either side; 15 here, which still leaves
      // the A and T enough white for the kerning to close.
      T: [0.04, 0.04, "half", [-6, -6]],
      // Set by the measured fit the O closed to 25 at the Black; Geist's is 40.
      // Geist's round and diagonal capitals hardly close at a heavy weight:
      // theirs are held at the Regular's, and give back only the extra a
      // capital closes by (see `capitalCloses`).
      O: [0.41, 0.41, "held", [5, 5]],
      Q: [0.41, 0.41, "held", [5, 5]],
      U: [0.77, 0.77, "closes"],
      // Geist's S stands 55 off either side at the Regular and 50 at the
      // Black, closing as its figures do; fitted, it closed to 40.
      S: [0.54, 0.54, "held", [5, 5]],
      V: [0.11, 0.11, "held", [5, 5]],
      W: [0.33, 0.33, "held", [5, 5]],
      X: [0.04, 0.04],
      // Geist's Y reaches past both its sides (6 and 4 at the Regular, 9 and
      // 7 at the Black), as `overhangs` lets it; held inside, it stood 12 in.
      Y: [-0.225, -0.2, "half", [-1, -4]],
      // Its bars reach further than the Y's arms: held just inside its sides.
      yen: [0.11, 0.11],
      Z: [0.19, 0.19, "held", [5, 5]],
      zero: [0.63, 0.63],
      one: [0.5, 1.38],
      two: [0.75, 0.75],
      three: [0.63, 0.63],
      four: [0.38, 0.63],
      five: [0.75, 0.75],
      six: [0.63, 0.5],
      // Geist's seven reaches right to its advance (held a unit inside it),
      // and its Thin's stands where its Regular's does, unopened.
      seven: [0.25, 0.02, "unopened"],
      eight: [0.5, 0.5],
      nine: [0.5, 0.63],
      question: [0.55, 0.55, "closes"],
      // Geist's stops and quote stand 2 to 4 closer than the first fit had
      // them; its colons 2 to 4 closer again from the SemiBold on, and its
      // quote closes a little slower than the n toward the Black.
      period: [0.565, 0.565, "closes"],
      comma: [0.565, 0.565, "closes"],
      colon: [1.15, 1.15, "closes", [0, 0], [-4, -2]],
      semicolon: [1.15, 1.15, "closes", [0, 0], [-4, -2]],
      quotesingle: [0.57, 0.57, "half", [0, 0], [2, 1]],
      quotedbl: [0.56, 0.56],
      // Geist's parentheses stand 45 off the side they open from and 15 off
      // the side they close on.
      parenleft: [0.56, 0.19],
      parenright: [0.19, 0.56],
      // Geist closes its slashes as fast as its n, the slash's right faster.
      slash: [0.5, 0.72, "closes", [-5, 2]],
      // Geist closes its hyphen and underscore as fast as its n (44 off at
      // the Regular, 32 at the Black); half as fast, they stood 8 loose.
      hyphen: [0.55, 0.55, "closes"],
      // Geist's reaches past both its sides at the Regular (-10 and -5), and
      // stands 8 and 10 in at the Black.
      numbersign: [-0.125, -0.06, "half", [-5, -6], [22, 18]],
      // Geist closes its % * and brackets as fast as its n: half as fast,
      // they stood 8 to 16 units loose at the Black.
      percent: [0.55, 0.55, "closes"],
      asterisk: [0.55, 0.55, "closes"],
      asciicircum: [0.5, 0.5, "held"],
      // Geist's brackets and braces stand well off the side they open from.
      bracketleft: [1.15, 0.19, "closes"],
      bracketright: [0.19, 1.15, "closes"],
      braceleft: [0.56, 0.19],
      braceright: [0.19, 0.56],
      // Geist Thin's stands 60 off either side, its Regular's 40.
      backslash: [0.5, 0.5, "closes", [15, 15]],
      // Geist sets its signs 40 off either side at every weight (50 off the
      // open side of an angle); closed with the letters they stood 6 tight
      // at the Black and opened 5 loose at the Thin.
      plus: [0.5, 0.5, "held"],
      less: [0.5, 0.62, "held"],
      greater: [0.62, 0.5, "held"],
      equal: [0.5, 0.5, "held"],
      underscore: [0.55, 0.55, "closes"],
      asciitilde: [0.5, 0.5, "held"],
      // Geist's stands 55 off either side at the Regular; fitted, 44 and 34.
      dollar: [0.69, 0.69],
      // Geist stands its ! 50 off either side and its bar 92.
      exclam: [0.63, 0.63],
      // Geist's ampersand stands 40 off its left and 20 off its right.
      ampersand: [0.5, 0.25, "closes", [5, 5]],
      bar: [1.15, 1.15, "closes"],
      grave: [0.55, 0.55],
      acute: [0.55, 0.55],
      at: [0.56, 0.57],
      // The typographic punctuation (`letters/typographic.ts`). Geist stands
      // its guillemets 44 off either side at the Regular and 32 at the Black,
      // as its n; its daggers and its trade mark as far off as its H (92,
      // the trade mark after a capital's 12 of extra); its euro 55 and 40.
      guillemotleft: [0.55, 0.55, "closes"],
      guillemotright: [0.55, 0.55, "closes"],
      guilsinglleft: [0.55, 0.55, "closes"],
      guilsinglright: [0.55, 0.55, "closes"],
      dagger: [1.15, 1.15, "closes"],
      daggerdbl: [1.15, 1.15, "closes"],
      trademark: [1, 1, "closes"],
      Euro: [0.69, 0.5],
    },
    /*
     * Each letter's width against the rhythm, fitted to Geist's by measuring
     * the ink: see `proportions`. For the plain forms: the grotesque ones the
     * Sans draws by default are drawn in Geist's own units and take none of it.
     */
    proportions: {
      b: 0.965,
      c: 1.121,
      d: 0.965,
      e: 0.97,

      h: 0.994,

      k: 1.217,
      m: 0.936,
      n: 0.994,
      p: 0.965,
      q: 0.965,

      u: 0.976,
      v: 1.287,
      w: 1.394,
      x: 1.353,

      z: 1.3,
      A: 1.13,
      B: 1.401,
      H: 1.38,
      C: 1.122,
      D: 1.134,
      E: 1.299,
      F: 1.273,

      K: 1.336,
      L: 1.377,
      M: 1.296,
      N: 1.258,
      O: 1.022,
      P: 1.337,
      Q: 1.007,

      T: 1.008,
      U: 1.332,
      V: 1.076,
      W: 1.15,
      X: 1.15,
      Y: 1.066,
      Z: 1.265,
      zero: 1.084,
      two: 1.052,
      four: 1.222,
      five: 0.909,
      six: 1.059,
      eight: 1.403,
      nine: 1.059,
      onequarter: 1.2,
      onehalf: 1.2,
      threequarters: 1.12,
    },
  },
  pen: { weight: 87, contrast: 0.06, angle: 0 },
  /*
   * The forms a neo-grotesque takes where the plain sans takes another: see
   * `letters/grotesque.ts`.
   */
  forms: {
    a: "grotesque",
    c: "grotesque",
    e: "grotesque",
    f: "grotesque",
    g: "grotesque",
    r: "grotesque",
    j: "grotesque",
    t: "grotesque",
    u: "grotesque",
    y: "grotesque",
    G: "grotesque",
    J: "grotesque",
    R: "grotesque",
    one: "grotesque",
    k: "grotesque",
    l: "grotesque",
    K: "grotesque",
    M: "grotesque",
    N: "grotesque",
    W: "grotesque",
    v: "grotesque",
    w: "grotesque",
    A: "grotesque",
    B: "grotesque",
    C: "grotesque",
    P: "grotesque",
    Q: "grotesque",
    O: "grotesque",
    D: "grotesque",
    x: "grotesque",
    X: "grotesque",
    m: "grotesque",
    n: "grotesque",
    h: "grotesque",
    b: "grotesque",
    d: "grotesque",
    p: "grotesque",
    q: "grotesque",
    V: "grotesque",
    Y: "grotesque",
    s: "grotesque",
    S: "grotesque",
    z: "grotesque",
    Z: "grotesque",
    exclam: "grotesque",
    hyphen: "grotesque",
    quotesingle: "grotesque",
    quotedbl: "grotesque",
    parenleft: "grotesque",
    parenright: "grotesque",
    slash: "grotesque",
    numbersign: "grotesque",
    percent: "grotesque",
    section: "grotesque",
    asterisk: "grotesque",
    at: "grotesque",
    asciicircum: "grotesque",
    bracketleft: "grotesque",
    bracketright: "grotesque",
    braceleft: "grotesque",
    braceright: "grotesque",
    backslash: "grotesque",
    plus: "grotesque",
    less: "grotesque",
    greater: "grotesque",
    equal: "grotesque",
    underscore: "grotesque",
    asciitilde: "grotesque",
    grave: "grotesque",
    acute: "grotesque",
    circumflex: "grotesque",
    dieresis: "grotesque",
    tilde: "grotesque",
    dollar: "grotesque",
    bar: "grotesque",
    zero: "grotesque",
    two: "grotesque",
    three: "sided",
    four: "grotesque",
    five: "sided",
    six: "sided",
    seven: "grotesque",
    eight: "grotesque",
    nine: "sided",
    ampersand: "grotesque",
    question: "grotesque",
    E: "grotesque",
    F: "grotesque",
    H: "grotesque",
    L: "grotesque",
    T: "grotesque",
    U: "grotesque",
    i: "grotesque",
  },
  parts: {
    ...PLAIN.parts,
    bowl: { width: 0.845, squareness: 0, aperture: 0.8, superness: 0.15 },
    // High enough that the springing still shapes the arch on an n this narrow:
    // below it the turn is held to the arch's own half-width and the control
    // does nothing.
    shoulder: { spring: 0.72, reach: 1, crest: 1 },
    terminal: { kind: "level", angle: 0 },
  },
};

export const SERIF: Style = {
  ...PLAIN,
  name: "Serif",
  family: "serif",
  blurb: "Contrast, an angled pen, and bracketed serifs.",
  /*
   * Lora's o is 102 units across its sides and 38 across its crown and its
   * base, a thin stroke four tenths of the thick one, and its thinnest point
   * sits a few degrees round from the top. At 0.42 ours was 0.59 of the thick,
   * which reads as a sans with serifs rather than as a text face.
   */
  pen: { weight: 87, contrast: 0.55, angle: 8 },
  /*
   * The two-storey a, which is what most text faces use and what none of them
   * were asking for.
   *
   * The alternate has said so in its own hint since it was written -- "what
   * most text faces use" -- and single storey is what this engine draws by
   * default. So every face here had the geometric one, which is most of why a
   * Serif and a Geometric read as the same drawings with the pen changed.
   */
  /*
   * And the two-storey g beside it, and a J that stands on the line.
   *
   * A text serif's g is binocular far more often than not, and set beside a
   * two-storey a the single-storey one read as a letter borrowed from the sans.
   * The J hung below the baseline was the old-style choice; a contemporary text
   * face -- Lora, Source Serif, Merriweather -- sits it on the line with a hook,
   * which is also what keeps it from colliding with the line below in caps.
   * The G with an upright spur rather than a bar turned in, and the Q whose
   * tail sweeps out under the line, are the same kind of decision.
   */
  forms: {
    a: "humanist",
    g: "humanist",
    G: "humanist",
    Q: "humanist",
    y: "hooked",
    // Lora's own: see `letters/humanist.ts`.
    e: "humanist",
    u: "humanist",
    t: "humanist",
    U: "humanist",
    M: "humanist",
    N: "humanist",
    o: "humanist",
    c: "humanist",
    O: "humanist",
    C: "humanist",
    zero: "humanist",
    j: "humanist",
    five: "humanist",
    hyphen: "humanist",
    slash: "humanist",
    backslash: "humanist",
    exclam: "humanist",
    A: "humanist",
    w: "humanist",
    W: "humanist",
    k: "humanist",
    K: "humanist",
    s: "humanist",
    at: "humanist",
    S: "humanist",
    seven: "humanist",
    two: "humanist",
    question: "humanist",
    ampersand: "humanist",
    R: "humanist",
    // Lora's signs: see `letters/humanist.ts`.
    plus: "humanist",
    equal: "humanist",
    divide: "humanist",
    multiply: "humanist",
    less: "humanist",
    greater: "humanist",
    underscore: "humanist",
    numbersign: "humanist",
    percent: "humanist",
    bracketleft: "humanist",
    bracketright: "humanist",
    braceleft: "humanist",
    braceright: "humanist",
    // Lora's punctuation and symbols: see `letters/humanist-marks.ts`.
    // (The bullet, the cent, the dollar, the euro and the ordinals are drawn
    // out of the full stop, the c, the S, the C and the a and o, and follow
    // their forms.)
    dagger: "humanist",
    daggerdbl: "humanist",
    asterisk: "humanist",
    sterling: "humanist",
    section: "humanist",
    paragraph: "humanist",
    trademark: "humanist",
    copyright: "humanist",
    registered: "humanist",
    bar: "humanist",
    brokenbar: "humanist",
    periodcentered: "humanist",
    degree: "humanist",
    currency: "humanist",
    asciicircum: "humanist",
    asciitilde: "humanist",
    logicalnot: "humanist",
    plusminus: "humanist",
    guilsinglleft: "humanist",
    guilsinglright: "humanist",
    guillemotleft: "humanist",
    guillemotright: "humanist",
    period: "humanist",
    colon: "humanist",
    comma: "humanist",
    semicolon: "humanist",
  },
  /*
   * A text face's proportions rather than the sans's.
   *
   * Measured against Lora at the same x-height: its n is 0.83 of an x-height
   * from stem edge to stem edge where the sans's is 1.07, its o 0.94 inside
   * where ours was 1.03, and its extenders reach 0.51 of an x-height below the
   * line where the sans's stop at 0.40. The capitals were already close -- an
   * H within two hundredths -- so the cap height and the counter of an H are
   * left alone and only the lowercase rhythm and the bowls come in.
   */
  /*
   * And set as tight as Lora: its lowercase averages 32 units a side on an
   * x-height of 500, which is 34 on ours. The sans's 55 set the serif half as
   * loose again as the face it was measured against.
   */
  metrics: {
    ...PLAIN.metrics,
    xHeight: 500,
    capHeight: 700,
    ascender: 755,
    descender: -255,
    overshoot: 16,
    sidebearing: 34,
    capitalSpacing: 1.4,
    /*
     * The rising strokes of the vees and the x drawn as hairlines, as Lora's
     * are -- the right arm of its v is 52 units across against the left's 91
     * -- where a pen held nearly level gave both arms of a v the same weight
     * and the v, w and y stood dark in a line of text. But not the z's and
     * the Z's diagonals, which Lora draws heavy, nor the A, which draws its
     * own: thinned again, its hairline leg stood apart from the other at
     * the apex past a Black. Nor the one's flag, whose thinned end stood
     * seven units over the stem's head at the heaviest.
     */
    risingHairline: true,
    // Nor the signs, which draw their own: Lora's number sign, percent,
    // multiplication sign and angle brackets are as heavy rising as falling.
    risingOwn: [
      "z",
      "Z",
      "slash",
      "A",
      "one",
      "numbersign",
      "percent",
      "multiply",
      "less",
      "greater",
      // And the marks drawn to Lora's (`letters/humanist-marks.ts`): past a
      // Black the upper arm of a guillemet and the right side of the
      // exclamation mark's wedge went to hairlines, and the chevron came apart.
      "exclam",
      "backslash",
      "guilsinglleft",
      "guilsinglright",
      "guillemotleft",
      "guillemotright",
      "asciicircum",
      "asterisk",
      "dagger",
      "daggerdbl",
      "sterling",
      "at",
      "currency",
      "Euro",
    ],
    // Lora's word space, 263 at the Regular and the Bold, a little more past it.
    wordSpace: [263 / 500, 280 / 500],
    // Lora's superior figures, 0.573 of a capital standing 306 up, and its
    // fraction slash, 46 across at the Regular and 81 at the Bold, leaning
    // 0.668: the construction's stood 26 units lower, 0.6 of a capital, beside
    // a slash leaning 0.37 that kept the figures apart by the pen.
    //
    // Drawn as the figures they are, serifs and drops and all (see
    // `dressedAs` in `letters/common.ts`), on 0.68 of the pen, and each as
    // wide as Lora's against the Serif's figure set small: Lora's one a
    // little wider, its two, three and four narrower. A fraction's slash
    // leaves from three quarters across a one, under its foot serif.
    superiors: {
      share: 0.573,
      foot: 306 / 700,
      slope: 0.668,
      slash: 0.55,
      pen: 0.68,
      wide: { one: 1.025, two: 0.98, three: 0.895, four: 0.96 },
      slashAt: { one: 0.75 },
    },
    // Lora's yen: its bars 186 and 294 up, 345 long and 47 deep at the
    // Regular, where the construction's lay one over the other at 127, the
    // letter's whole width long.
    // And its Y is Lora's, not the letter's: the arms run down to meet
    // 0.26 of the cap height up, where the letter's meet at 0.46, so the
    // upper bar crosses them where they close rather than under a vee.
    yen: {
      bars: [186 / 700, 294 / 700],
      reach: 172.5 / 700,
      shift: 7 / 700,
      deep: 0.54,
      meets: 0.26,
    },
    // LORA-BOLD-BEGIN (fitted to Lora Bold at a pen of 142)
    bold: {
      at: 0.47,
      kept: 0.5,
      spacing: 0.82,
      widths: {
        a: 0.879,
        b: 0.929,
        c: 0.962,
        d: 0.928,
        e: 0.95,
        f: 0.923,
        g: 1.021,
        h: 0.951,
        k: 0.978,
        m: 0.98,
        n: 0.957,
        o: 0.94,
        p: 0.945,
        q: 0.948,
        r: 0.985,
        s: 0.88,
        t: 1.087,
        u: 1.013,
        v: 0.906,
        w: 0.807,
        x: 0.829,
        y: 0.879,
        z: 0.993,
        A: 0.762,
        B: 0.727,
        C: 0.996,
        D: 0.979,
        E: 0.989,
        F: 1.056,
        G: 0.95,
        H: 0.938,
        J: 1.211,
        K: 0.974,
        L: 1.055,
        M: 1.008,
        N: 0.961,
        O: 0.952,
        P: 0.698,
        Q: 0.98,
        R: 0.914,
        S: 0.947,
        T: 1.076,
        U: 0.923,
        V: 0.952,
        W: 0.959,
        X: 0.965,
        Y: 0.909,
        Z: 1.032,
        zero: 0.894,
        one: 0.709,
        two: 0.872,
        three: 0.841,
        four: 0.936,
        five: 0.87,
        six: 0.892,
        seven: 0.861,
        eight: 0.833,
        nine: 0.894,
        question: 0.787,
      },
      // Past the Bold: the open letters widening with the stems, as a
      // Black's do (C/O 0.9, E/H 0.75, T/H 0.87, z/x 0.83 at a pen of 260).
      past: {
        C: 1.2,
        G: 1.3,
        E: 1.39,
        F: 1.39,
        L: 1.44,
        T: 1.49,
        Z: 1.41,
        z: 1.45,
        J: 1.43,
        N: 1.3,
        W: 1.33,
        w: 0.75,
        s: 1.54,
        five: 1.19,
        seven: 1.27,
      },
    },
    // LORA-BOLD-END
    // LORA-TABLES-BEGIN (fitted to Lora Regular: see lora.test.ts)
    sides: {
      a: [1, 0.74],
      b: [0.24, 1.24],
      c: [1.21, 1],
      d: [1.24, 0.88],
      e: [1.24, 1.15],
      f: [0.74, 0.06],
      g: [1.03, 0.06],
      h: [0.76, 0.88],
      i: [1.06, 0.97],
      // The j's tail runs under the letter before it, as Lora's does (-88):
      // held inside its advance, its stem stood 80 units off that letter.
      j: [-2.35, 2.18],
      k: [0.76, 0.21],
      l: [0.74, 1],
      m: [1.06, 0.94],
      n: [1.09, 0.88],
      o: [1.21, 1.21],
      p: [0.85, 1.24],
      q: [1.24, 0.44],
      r: [1.06, 0.21],
      s: [1.53, 1.21],
      t: [0.62, 0.12],
      u: [0.76, 0.85],
      v: [0.21, 0.09],
      w: [0.21, 0.06],
      x: [0.65, 0.32],
      y: [0.21, 0.12],
      z: [1.18, 1.29],
      /*
       * The diagonal capitals and the J hang past their sides as Lora's do,
       * and are held six units further in by a Black: past a Bold the
       * capitals' extra room no longer paid for the overhang, and they met
       * the letters either side of them.
       */
      A: [-0.19, -0.34, "half", [0, 0], [6, 6]],
      B: [1.22, 0.75],
      C: [0.95, 0.48],
      D: [1.22, 0.95],
      E: [1.22, 0.92],
      F: [1.22, 0.31],
      G: [0.98, 0.22],
      H: [1.22, 1.22],
      I: [1.22, 1.22],
      J: [-0.19, 0.48, "half", [0, 0], [6, 0]],
      K: [1.22, -0.25],
      L: [1.22, 0.22],
      M: [0.89, 0.6],
      N: [1.28, 0.86],
      O: [0.95, 0.89],
      P: [1.22, 0.36],
      Q: [0.95, -0.11],
      R: [1.22, -0.34, "half", [0, 0], [0, 6]],
      S: [1.31, 0.89],
      T: [0.25, 0.28],
      U: [0.51, 0.48],
      V: [-0.19, -0.34, "half", [0, 0], [6, 6]],
      W: [-0.19, -0.34, "half", [0, 0], [6, 6]],
      X: [-0.14, -0.34, "half", [0, 0], [0, 6]],
      Y: [-0.19, -0.34, "half", [0, 0], [6, 6]],
      Z: [0.86, 1.01],
      zero: [1.65, 1.62],
      one: [0.53, 1.03],
      two: [1.35, 1.53],
      three: [1.29, 1.47],
      four: [0.35, 1],
      five: [1.53, 1.32],
      six: [1.65, 1.44],
      seven: [0.65, 0.59],
      eight: [1.74, 1.47],
      nine: [1.41, 1.74],
      ampersand: [1.06, 0.06, "half", [0, 0], [-15, -13]],
      question: [0.97, 1.08, "half", [0, 0], [17, 24]],
      exclam: [2.18, 2.21, "half", [0, 0], [-15, -15]],
      period: [1.88, 1.91, "half", [0, 0], [-21, -22]],
      ellipsis: [1.88, 1.91, "half", [0, 0], [-21, -22]],
      quotesinglbase: [1.94, 1.79, "half", [0, 0], [-24, -19]],
      quotedblbase: [1.94, 1.79, "half", [0, 0], [-24, -19]],
      comma: [1.94, 1.79, "half", [0, 0], [-24, -19]],
      semicolon: [2.06, 1.97, "half", [0, 0], [-19, -9]],
      colon: [1.97, 1.94, "half", [0, 0], [-13, -6]],
      quotesingle: [1.82, 1.82, "half", [0, 0], [-21, -21]],
      quotedbl: [1.82, 1.85, "half", [0, 0], [-19, -21]],
      parenleft: [1.06, 0.5, "half", [0, 0], [-13, -9]],
      parenright: [0.53, 1.03, "half", [0, 0], [0, -11]],
      hyphen: [1.97, 1.97, "half", [0, 0], [-13, -11]],
      slash: [0.62, 0.59, "half", [0, 0], [13, 15]],
      backslash: [0.62, 0.59, "half", [0, 0], [13, 15]],
      bar: [2.32, 2.26, "half", [0, 0], [-13, -11]],
      ordfeminine: [1.71, 1.21, "half", [0, 0], [-10, -51]],
      ordmasculine: [1.41, 1.35, "half", [0, 0], [-30, -50]],
      cent: [1.06, 1.12, "half", [0, 0], [37, 13]],
      dollar: [1.47, 1.09, "half", [0, 0], [13, 19]],
      onesuperior: [0.9, 1.84, "half", [0, 0], [-20, -37]],
      twosuperior: [1.5, 2.45, "half", [0, 0], [-12, 6]],
      threesuperior: [1.65, 1.86, "half", [0, 0], [-17, -2]],
      onequarter: [0.91, 1.53, "half", [0, 0], [-20, 15]],
      onehalf: [0.97, 2.97, "half", [0, 0], [-20, 20]],
      threequarters: [1.59, 1.49, "half", [0, 0], [-14, 20]],
      sterling: [1.38, 1, "held", [0, 0], [7, 15]],
      paragraph: [0.97, 2.91, "half", [0, 0], [24, 6]],
      section: [1.06, 1.05, "half", [0, 0], [17, 20]],
      copyright: [1.29, 1.24, "held", [0, 0], [4, 7]],
      registered: [1.29, 1.26, "held", [0, 0], [4, 6]],
      brokenbar: [2.47, 2.47, "half", [0, 0], [-9, -7]],
      at: [1.59, 1.12, "half", [0, 0], [12, 6]],
      yen: [0.82, 0.79, "half", [0, 0], [15, 15]],
      // The typographic punctuation (`letters/typographic.ts`). Lora sets its
      // closing quotes tight, 25 and 23 off, and its opening ones 46 and 52;
      // its guillemets 32 off the side they point to and 55 off the other,
      // the single ones 31 and 47; its bullet 50 off either side; its euro
      // 35 and 42; its trade mark 63 (49 and a capital's extra).
      quoteright: [0.74, 0.68, "half", [0, 0], [-2, 9]],
      quotedblright: [0.74, 0.68, "half", [0, 0], [-2, 11]],
      quoteleft: [1.35, 1.53, "half", [0, 0], [-13, -36]],
      quotedblleft: [1.35, 1.53, "half", [0, 0], [-13, -36]],
      guillemotleft: [0.94, 1.62, "half", [0, 0], [-15, -21]],
      guillemotright: [1.62, 0.94, "half", [0, 0], [-21, -15]],
      guilsinglleft: [0.91, 1.38, "half", [0, 0], [-15, -13]],
      guilsinglright: [1.38, 0.91, "half", [0, 0], [-13, -15]],
      bullet: [1.47, 1.47, "half", [0, 0], [-22, -22]],
      trademark: [1.74, 0.94, "half", [0, 0], [40, 9]],
      Euro: [1.03, 1.24, "half", [0, 0], [22, 4]],
      dagger: [0.76, 0.76, "half", [0, 0], [11, 11]],
      exclamdown: [1.85, 1.85, "half", [0, 0], [-15, -15]],
      questiondown: [0.97, 0.88, "half", [0, 0], [22, 11]],
      daggerdbl: [0.76, 0.76],
      asterisk: [1.15, 1.21, "held", [0, 0], [7, 2]],
      // Lora's signs, measured off its Regular.
      numbersign: [0.97, 1, "half", [0, 0], [17, 15]],
      percent: [1.06, 1.03, "half", [0, 0], [19, 19]],
      bracketleft: [2.32, 0.35, "half", [0, 0], [-11, -17]],
      bracketright: [0.35, 2.32, "half", [0, 0], [0, -11]],
      braceleft: [0.21, 0.35],
      braceright: [0.35, 0.21],
      underscore: [1.68, 1.68],
      plus: [1.24, 1.24, "half", [0, 0], [11, 11]],
      equal: [1.24, 1.24, "half", [0, 0], [11, 11]],
      divide: [1.24, 1.24, "half", [0, 0], [11, 11]],
      multiply: [2.6, 2.6, "half", [0, 0], [7, 7]],
      less: [1, 1.5, "half", [0, 0], [21, -7]],
      greater: [1.24, 1.26, "half", [0, 0], [7, 6]],
      // Lora's punctuation and symbols (`letters/humanist-marks.ts`); those
      // Lora sets as far off at its Bold as at its Regular held there.
      periodcentered: [1.97, 1.94, "half", [0, 0], [-32, -32]],
      degree: [1.38, 1.38, "half", [0, 0], [-22, -22]],
      currency: [1.79, 1.76, "held"],
      asciicircum: [1.76, 1.76, "held"],
      asciitilde: [1.26, 1.26, "held"],
      logicalnot: [1.06, 1.41, "held", [0, 0], [0, -7]],
      plusminus: [1.24, 1.24, "held"],
    },
    proportions: {
      a: 1.069,
      b: 0.84,
      c: 0.83,
      d: 0.826,
      e: 0.796,
      f: 1.303,
      g: 1.016,
      h: 0.936,
      k: 0.92,
      m: 0.875,
      n: 0.927,
      o: 0.889,
      p: 0.826,
      q: 0.811,
      r: 0.88,
      s: 0.935,
      t: 1.278,
      u: 0.933,
      v: 0.865,
      x: 0.927,
      y: 0.941,
      z: 1.19,
      A: 0.776,
      B: 1.036,
      C: 0.897,
      D: 1.017,
      E: 1.128,
      F: 0.984,
      G: 1.023,
      H: 0.987,
      J: 1.135,
      K: 1.055,
      L: 1.176,
      M: 1.15,
      N: 1.033,
      O: 0.948,
      P: 1.029,
      Q: 1.027,
      R: 0.964,
      S: 0.96,
      T: 0.984,
      U: 1.035,
      V: 0.795,
      X: 0.857,
      Y: 0.821,
      Z: 1.158,
      zero: 0.943,
      one: 0.981,
      two: 0.942,
      three: 1.226,
      four: 1.141,
      six: 0.984,
      seven: 0.954,
      eight: 1.028,
      nine: 0.982,
      question: 0.889,
    },
    // LORA-TABLES-END
    fit: 1,
    figures: "proportional",
    heavyCounter: 1.3,
    // Lora hangs its j's tail under the letter before it: see `sides`.
    overhangs: { j: 0.09 },
  },
  parts: {
    ...PLAIN.parts,
    /*
     * A text serif rather than a slab: it thins toward its tip, it is
     * bracketed well into the stem, and the top of a lowercase stem wears one
     * flag sloping down to the left, which is where a pen enters the stroke.
     */
    slab: {
      on: true,
      projection: 0.74,
      thickness: 0.4,
      bracket: 0.4,
      shape: "wedge",
      head: "sloped",
      hold: 0.087,
      past: 0.1,
    },
    /*
     * Lora's c and C close in further than the sans's: the drop on the c
     * hangs at about forty degrees round from the top, and its foot ends
     * a third of the way up the right.
     */
    // Ovals, as Lora's o is, not circles stood on straight sides.
    bowl: { ...PLAIN.parts.bowl, width: 0.92, aperture: 0.75, oval: true },
    shoulder: { spring: 0.58, reach: 0.76, crest: 1 },
    // The curved ends -- the hooks of the a, c, f, r, j and y -- swell into a
    // teardrop rather than taking a bar across, which is what a text face does.
    terminal: { kind: "teardrop", angle: 12 },
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
  ...PLAIN,
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
  metrics: {
    ...PLAIN.metrics,
    xHeight: 575,
    counterWidth: 285,
    sidebearing: 34,
    width: 1.02,
    heavyOpen: 0.6,
    heavyOpenFrom: 0.5,
  },
  pen: { weight: 205, contrast: 0.55, angle: 0 },
  // The apex cut flat, which its own hint says is what a heavy face does to
  // keep the top of an A from going black.
  forms: {
    A: "flat",
    G: "grotesque",
    S: "grotesque",
    s: "grotesque",
    c: "grotesque",
    e: "grotesque",
  },
  parts: {
    ...PLAIN.parts,
    shoulder: { spring: 0.66, reach: 1.02, crest: 1 },
    /*
     * Narrower than tall, which is both what a fat face is and what keeps its
     * letters in the order the rest of the alphabet stands in. At a round bowl
     * this face's `o` came out seventeen units wider than its `n` -- the stems
     * are two hundred units of ink and the counter between them only two
     * hundred and eighty -- and an `o` wider than an `n` is a face whose
     * rhythm has inverted.
     */
    bowl: { width: 0.92, squareness: 0.12, aperture: 0.9, superness: 0 },
    corner: { radius: 0, join: "miter" },
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
  ...PLAIN,
  name: "Geometric",
  family: "sans",
  blurb: "Circles and points, one thickness throughout.",
  /*
   * A heavy weight gives its counters back for the stem it gains, as Futura
   * Extra Bold does: its o stays nearly a circle and closes from the inside.
   * Left to widen the letters instead, as every face does by default, a Black
   * Geometric ran its bowls out into flat-topped stadiums and read as an
   * extended face.
   */
  metrics: {
    ...PLAIN.metrics,
    xHeight: 500,
    counterWidth: 380,
    sidebearing: 58,
    heavyCounter: 1.4,
    /*
     * Its bowls let out only a little past the Black, for the same reason:
     * its o keeps its round and closes from the inside. What it keeps open
     * there are the letters that stack or cross their strokes -- the 4, the
     * #, the & and the brackets (see `pastBlack`).
     */
    heavyOpen: 0.05,
    /*
     * So it opens them from the inside instead: its round strokes give up a
     * share of the stem gained at their sides, their outsides held, and an
     * Ultra's o, e and 6 keep a counter rather than a slot (see `rounds.ts`).
     */
    heavyThin: 1.2,
    /*
     * And closing further than that past the Black: a pen a quarter of the
     * em wide leaves an o no rounder than its counter lets it, and held to a
     * counter a fifth of the x-height across, an Ultra's o stood a third as
     * wide again as it was tall.
     */
    heavyFloor: 0.14,
    /*
     * Spaced by what each side leaves inside its own box (see `fitted` in
     * `build.ts`), as the Sans is: at one sidebearing for every side, the A,
     * V, W and Y stood as far off their neighbours as an H, and LATVAWAY was
     * a row of holes.
     */
    fit: 1,
    sides: { T: [0.3, 0.3] },
  },
  pen: { weight: 86, contrast: 0, angle: 0 },
  /*
   * The letters a geometric face argues about, and every one of these
   * alternates names it in its own hint: the tail hung under the bowl rather
   * than crossing its wall, and the M's vertex carried to the baseline to
   * square the letter off. (The G with nothing turned back into it read as a
   * C with a chopped end past a Bold, and gave way to the grotesque's below.) The a stays as it
   * is -- single storey is already what is drawn here, and it is the text faces
   * that wanted the other one.
   */
  /*
   * And the neo-grotesque's own S and s, G, t, g, r, e, c, @, %, # and ? (see
   * `letters/grotesque.ts`), drawn to hold their shape to a Black and past
   * it. The construction's own came apart past a Bold: an S whose spine was a
   * hairline between two blobs, a t notched where its foot turned, a g
   * spurred where its tail left the stem, a percent whose rings ran into its
   * slash, and a G that was a C with a chopped end.
   */
  forms: {
    Q: "under",
    G: "grotesque",
    M: "deep",
    // The grotesque's S and s held narrow, as Futura's are: see `NARROWED`
    // in `letters/alternates.ts`.
    S: "geometric",
    s: "geometric",
    at: "grotesque",
    percent: "grotesque",
    section: "grotesque",
    numbersign: "grotesque",
    question: "grotesque",
    t: "grotesque",
    g: "grotesque",
    r: "grotesque",
    e: "grotesque",
    c: "grotesque",
  },
  parts: {
    ...PLAIN.parts,
    shoulder: { spring: 0.55, reach: 1, crest: 1 },
    bowl: { width: 1, squareness: 0, aperture: 1, superness: 0 },
    corner: { radius: 0, join: "miter" },
    terminal: { kind: "butt", angle: 0 },
  },
};

/** Ribbon: one heavy stroke bent round, with the corners opened right out. */
export const RIBBON: Style = {
  ...PLAIN,
  name: "Ribbon",
  family: "display",
  blurb: "One heavy stroke bent round. Corners opened until the joints disappear.",
  metrics: { ...PLAIN.metrics, xHeight: 560, counterWidth: 330, sidebearing: 46 },
  pen: { weight: 150, contrast: 0, angle: 0 },
  // A single bent stroke cannot tell an l from a one, so the l is turned out
  // at the foot -- which is what its alternate exists for.
  forms: { l: "tailed", two: "grotesque", five: "grotesque", six: "grotesque", nine: "grotesque" },
  parts: {
    ...PLAIN.parts,
    shoulder: { spring: 0.4, reach: 1.05, crest: 1 },
    bowl: { width: 1, squareness: 0.5, aperture: 1, superness: 0 },
    corner: { radius: 220, join: "round" },
    terminal: { kind: "butt", angle: 0 },
  },
};

/** Technical: squared off, narrow, corners just off the pen's limit. */
export const TECHNICAL: Style = {
  ...PLAIN,
  name: "Technical",
  family: "display",
  blurb: "Squared off and narrow, with the corners just off the limit.",
  metrics: { ...PLAIN.metrics, counterWidth: 300, sidebearing: 52, width: 0.9 },
  pen: { weight: 78, contrast: 0, angle: 0 },
  // The t cut off square at the baseline, which its own hint calls the
  // squared or technical face's.
  forms: { t: "straight" },
  parts: {
    ...PLAIN.parts,
    shoulder: { spring: 0.78, reach: 0.82, crest: 1 },
    bowl: { width: 0.82, squareness: 0.92, aperture: 1, superness: 0 },
    corner: { radius: 45, join: "round" },
    terminal: { kind: "butt", angle: 0 },
  },
};

/** Fairground: the pen turned a quarter, so the horizontals are the thick strokes. */
export const FAIRGROUND: Style = {
  ...PLAIN,
  name: "Fairground",
  family: "display",
  blurb:
    "Circus and western wood type: the pen turned a quarter, so the horizontals carry the weight and the verticals thin away.",
  /*
   * Already the one face here drawn with reverse contrast, and that was never
   * the problem: it moved six numbers of thirty-six and drew the same letters
   * as everything else, so its one idea was carrying the whole face alone.
   * Wide, heavy, slabbed and set on the older forms, it reads as the poster it
   * is named after rather than as a sans with its pen turned.
   */
  metrics: { ...PLAIN.metrics, xHeight: 560, counterWidth: 400, sidebearing: 46, width: 1.1 },
  // Not as far as reverse contrast will go: at seven tenths the uprights thin
  // to hairlines and the right stem of an `n` all but leaves. Six tenths keeps
  // the horizontals carrying the weight and the letters legible, which is what
  // the wood type it is named after actually did.
  pen: { weight: 150, contrast: 0.6, angle: 90 },
  // The older shapes a wood-type poster is cut in: the W built as two vees
  // that overlap, and a one with a foot so it does not lean on its neighbours.
  forms: { W: "crossed", one: "footed" },
  parts: {
    ...PLAIN.parts,
    // Slabs, because a circus face has them and because a slab laid across a
    // thin vertical is what stops reverse contrast reading as a mistake.
    slab: { ...PLAIN.parts.slab, on: true, projection: 0.5, thickness: 0.34, bracket: 0 },
    bowl: { width: 1.06, squareness: 0.18, aperture: 1, superness: 0 },
    terminal: { kind: "butt", angle: 0 },
  },
};

/** Marker: leaned over, drawn with a flat pen held at an angle. */
export const MARKER: Style = {
  ...PLAIN,
  name: "Marker",
  family: "hand",
  blurb:
    "A felt tip on paper: one width whichever way it goes, and an edge that followed the grain.",
  metrics: {
    ...PLAIN.metrics,
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
    ...PLAIN.parts,
    // A hand does not close its apertures, and a bullet tip cannot draw a
    // corner: the tip has a radius and so does everything it draws.
    bowl: { width: 0.98, squareness: 0.1, aperture: 1.06, superness: 0 },
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
    shoulder: { spring: 0.42, reach: 1.02, crest: 1 },
  },
  /*
   * The shapes a person draws rather than the shapes a punchcutter cut. The
   * single-storey a is already what this engine draws by default -- it is the
   * two-storey one that is the alternate, and it is the text faces that should
   * be asking for it.
   */
  /*
   * The spurred G. The plain one's upper terminal is cut back as the pen
   * grows, and at the slider's heaviest it stood off the bowl as a hook and
   * the letter read as a 6. The spur keeps the bar on the bowl at every weight.
   */
  /*
   * And the grotesque `k`, its arm and leg meeting the stem on the diagonal.
   * The plain one's arm runs out nearly flat, and as the pen grows it reaches
   * further: at 260 it stood out past the letter as a long thin blade.
   */
  forms: { g: "curled", t: "straight", y: "straight", l: "tailed", G: "spurred", k: "grotesque" },
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
  ...PLAIN,
  name: "Wavy",
  family: "display",
  blurb: "Thin, wide, and rippling along every run that lies flat.",
  metrics: { ...PLAIN.metrics, width: 1.12, sidebearing: 44 },
  pen: { weight: 44, contrast: 0, angle: 0 },
  // A wave needs something long and flat to happen along, and the barred seven
  // and the open four both give it one where the plain forms give it a
  // diagonal.
  forms: { seven: "barred", four: "open" },
  parts: {
    ...PLAIN.parts,
    /*
     * The long serifs held to a hairline face's size as the pen grows: grown with
     * it, a Black's ran a third of an em out from every stem, met the next
     * letter's, and closed a z into a box.
     */
    slab: {
      ...PLAIN.parts.slab,
      on: true,
      projection: 1.55,
      thickness: 0.52,
      bracket: 0,
      hold: 0.06,
      past: 0.1,
    },
    bowl: { width: 1.05, squareness: 0, aperture: 1, superness: 0 },
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
  ...PLAIN,
  name: "Flared",
  family: "display",
  blurb: "Condensed and swelling at every stroke end, the art-nouveau way.",
  metrics: { ...PLAIN.metrics, width: 0.78, capHeight: 740, xHeight: 500, sidebearing: 42 },
  pen: { weight: 118, contrast: 0.34, angle: 0 },
  // The art-nouveau f and J, both carried below the line as a display face
  // does with them.
  forms: { f: "descending", J: "descending" },
  parts: {
    ...PLAIN.parts,
    bowl: { width: 0.94, squareness: 0.1, aperture: 1, superness: 0 },
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
  ...PLAIN,
  name: "Psychedelic",
  family: "display",
  blurb: "Heavy, swollen, nearly shut, with a ball on every end that stops in the air.",
  metrics: { ...PLAIN.metrics, xHeight: 560, counterWidth: 300, sidebearing: 40, width: 1.04 },
  pen: { weight: 168, contrast: 0.62, angle: 0 },
  // The warm curled g and the descending f, both of which their own hints
  // give to a display face -- and the y's tail curled round under the line,
  // so it ends in the air and takes a ball, as the j and the f beside it do.
  // Cut straight on the descender it was the one hook here without one.
  forms: { g: "curled", f: "descending", y: "hooked" },
  parts: {
    ...PLAIN.parts,
    bowl: { width: 1.02, squareness: 0.1, aperture: 0.42, superness: 0 },
    shoulder: { spring: 0.72, reach: 1, crest: 1 },
    /*
     * Balls on the curves only. On the level arms of an E and an F, the bar of
     * a four and the flag of an exclamation, cut square either side of the
     * arms beside them, a disc read as a blot hung in the counter.
     */
    ball: { size: 1.75, drop: 0.4, straight: false },
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
  ...PLAIN,
  name: "Brush",
  family: "hand",
  blurb: "The signwriter's hand: leaned over, chisel-cut, drawn in cursive shapes.",
  metrics: {
    ...PLAIN.metrics,
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
    ...PLAIN.parts,
    bowl: { width: 0.94, squareness: 0.28, aperture: 0.86, superness: 0 },
    shoulder: { spring: 0.5, reach: 0.96, crest: 1 },
    corner: { radius: 0, join: "miter" },
    terminal: { kind: "butt", angle: 0 },
    flare: { spread: 0.14, depth: 1.1, curve: 0.7 },
  },
  /*
   * The spurred G. The plain one's upper terminal is cut back as the pen
   * grows, and at the slider's heaviest it stood off the bowl as a hook and
   * the letter read as a 6. The spur keeps the bar on the bowl at every weight.
   */
  /*
   * And the grotesque `k`, its arm and leg meeting the stem on the diagonal.
   * The plain one's arm runs out nearly flat, and as the pen grows it reaches
   * further: at 260 it stood out past the letter as a long thin blade.
   */
  forms: { g: "curled", f: "descending", y: "straight", l: "tailed", G: "spurred", k: "grotesque" },
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
  ...PLAIN,
  name: "Grotesque",
  family: "sans",
  blurb: "A sans that has closed up: tight apertures, high shoulders, squared bowls.",
  metrics: {
    ...PLAIN.metrics,
    xHeight: 535,
    width: 0.97,
    counterWidth: 318,
    heavyOpen: 0.2,
    oneCentred: true,
  },
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
  /*
   * And the neo-grotesque's own S and s, G, t, g, r, e, c, @, %, # and ? (see
   * `letters/grotesque.ts`), drawn to hold their shape to a Black and past
   * it. The construction's own came apart past a Bold: an S whose spine was a
   * hairline between two blobs, a t notched where its foot turned, a g
   * spurred where its tail left the stem, a percent whose rings ran into its
   * slash, and a G that was a C with a chopped end.
   */
  forms: {
    a: "grotesque",
    R: "curved",
    S: "grotesque",
    s: "grotesque",
    G: "grotesque",
    at: "grotesque",
    percent: "grotesque",
    section: "grotesque",
    numbersign: "grotesque",
    question: "grotesque",
    t: "grotesque",
    g: "grotesque",
    r: "grotesque",
    f: "grotesque",
    j: "grotesque",
    e: "grotesque",
    c: "grotesque",
  },
  parts: {
    ...PLAIN.parts,
    bowl: { width: 0.97, squareness: 0.14, aperture: 0.62, superness: 0 },
    shoulder: { spring: 0.74, reach: 1, crest: 1 },
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
  ...PLAIN,
  name: "Didone",
  family: "serif",
  blurb: "Contrast at its limit and serifs left as unbracketed hairlines.",
  metrics: { ...PLAIN.metrics, xHeight: 500, width: 0.98, risingHairline: true },
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
  /*
   * And the old-style S and s (see `bookSpine` in `letters/humanist.ts`),
   * whose spine is the heaviest stroke in them as a didone's is -- the
   * construction's put the hairline there -- and the neo-grotesque's G, %,
   * # and ?, which hold their shape past a Bold where the construction's
   * came apart. Not its @, though: drawn without contrast, the grotesque's
   * was a monoline ring among hairlines and fat stems, where the plain one,
   * held to the O's size at a heavy weight, keeps the face's own pen.
   */
  forms: {
    a: "double",
    S: "humanist",
    s: "humanist",
    G: "grotesque",
    percent: "grotesque",
    numbersign: "grotesque",
    question: "grotesque",
  },
  parts: {
    ...PLAIN.parts,
    /*
     * Longer than the old-style's, and no thinner or squarer than this.
     *
     * A didone's serifs are unbracketed hairlines and both of those were tried:
     * a bar at eleven hundredths of a stem, and a bracket of nothing at all.
     * Either on its own pinches the `Q` into two pieces where its tail crosses
     * the bowl -- bisected, and the projection is innocent. Two hundredths of a
     * bracket is a hairline by any reading, and a Q in two pieces is not a Q.
     */
    slab: {
      ...PLAIN.parts.slab,
      on: true,
      projection: 0.58,
      thickness: 0.13,
      bracket: 0.02,
      head: "flag",
    },
    /*
     * Balls: a disc on every curved end that stops in mid-air -- the a, the c,
     * the f, the r, the j, the ear of the g, the 2, the 3, the 5, the 9 and
     * the C, G, J and S -- which is half of what makes a didone read as one
     * at a glance. Without them every one of those ends was a flat cut and the
     * face read as a high-contrast sans with serifs added.
     *
     * The Q's tail once came away as a disc of its own when this was tried;
     * it stops on the line now, so the ball on it is buried (see `ballsFor`).
     */
    ball: { size: 1, drop: 0.35, curved: true },
    bowl: { width: 0.96, squareness: 0, aperture: 0.9, superness: 0 },
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
  ...PLAIN,
  name: "Slab",
  family: "serif",
  blurb: "Serifs as heavy as the stems, and no contrast to soften them.",
  // Fitted by its sides, as the Geometric is: see there.
  metrics: {
    ...PLAIN.metrics,
    xHeight: 528,
    width: 1.02,
    counterWidth: 340,
    fit: 1,
    sides: { T: [0.3, 0.3] },
  },
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
  /*
   * And the neo-grotesque's own S and s, G, t, g, r, e, c, @, %, # and ? (see
   * `letters/grotesque.ts`), drawn to hold their shape to a Black and past
   * it. The construction's own came apart past a Bold: an S whose spine was a
   * hairline between two blobs, a t notched where its foot turned, a g
   * spurred where its tail left the stem, a percent whose rings ran into its
   * slash, and a G that was a C with a chopped end.
   */
  forms: {
    a: "double",
    S: "grotesque",
    s: "grotesque",
    G: "grotesque",
    at: "grotesque",
    percent: "grotesque",
    section: "grotesque",
    numbersign: "grotesque",
    question: "grotesque",
    t: "grotesque",
    g: "grotesque",
    r: "grotesque",
    e: "grotesque",
    c: "grotesque",
  },
  parts: {
    ...PLAIN.parts,
    slab: {
      ...PLAIN.parts.slab,
      on: true,
      projection: 0.6,
      thickness: 0.74,
      bracket: 0.04,
      head: "flag",
    },
    bowl: { width: 1, squareness: 0.08, aperture: 0.78, superness: 0 },
    shoulder: { spring: 0.66, reach: 1, crest: 1 },
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
  // One advance for every letter: nothing fitted by its sides.
  metrics: {
    ...SLAB.metrics,
    monospaced: true,
    width: 0.95,
    sidebearing: 40,
    fit: undefined,
    sides: undefined,
  },
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
  /*
   * And the neo-grotesque's own S and s, G, t, g, r, e, c, @, %, # and ? (see
   * `letters/grotesque.ts`), drawn to hold their shape to a Black and past
   * it. The construction's own came apart past a Bold: an S whose spine was a
   * hairline between two blobs, a t notched where its foot turned, a g
   * spurred where its tail left the stem, a percent whose rings ran into its
   * slash, and a G that was a C with a chopped end.
   */
  forms: {
    a: "double",
    one: "footed",
    // And the narrow letters' serifs run out to fill the column, as
    // Courier's are: see `COLUMN` in `letters/alternates.ts`.
    i: "typewriter",
    dotlessi: "typewriter",
    j: "typewriter",
    dotlessj: "typewriter",
    l: "typewriter",
    I: "typewriter",
    S: "grotesque",
    s: "grotesque",
    G: "grotesque",
    at: "grotesque",
    percent: "grotesque",
    section: "grotesque",
    numbersign: "grotesque",
    question: "grotesque",
    t: "grotesque",
    g: "grotesque",
    r: "grotesque",
    e: "grotesque",
    c: "grotesque",
  },
  parts: {
    ...SLAB.parts,
    slab: {
      ...PLAIN.parts.slab,
      on: true,
      projection: 0.72,
      thickness: 0.5,
      bracket: 0.06,
      head: "flag",
    },
  },
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
/*
 * The written capitals, on every joined face: each drawn capital entered with
 * a hairline swash into the top of its first stroke. See the `written`
 * capitals in `alternates.ts`.
 */
const WRITTEN_CAPITALS = Object.fromEntries(
  "BDEFHIJKLMNPRTUVWXYZ".split("").map((letter) => [letter, "written"]),
);

export const HANDWRITING: Style = {
  ...PLAIN,
  name: "Handwriting",
  family: "script",
  blurb:
    "A plain joined hand. A line that bows as it goes, a pen that swells on the downstroke, and a lean that will not sit quite still.",
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
  /*
   * And the lowercase is small on the body, which is the other half of what
   * separates a script from a sans on a slant.
   *
   * Every face here was drawn with a text face's proportions: this one put
   * half the body into its x-height and gave its `l` a rise of one and a half
   * of them. Dancing Script puts a third of the body into its x-height and
   * carries its ascenders two and a fifth. Nothing about the letters was
   * wrong; there was simply not enough of the body left over for the
   * extenders to be the point of the face, and a joined hand whose ascenders
   * barely clear the waist reads as a slanted sans however it is joined.
   *
   * So the lowercase comes down and the extenders stay where they are, which
   * moves both figures at once. Everything measured against the x-height came
   * down with it -- the counter, the sidebearing, the overshoot and the pen --
   * so the face keeps its colour and its fit and only its proportion changes.
   */
  metrics: {
    ...PLAIN.metrics,
    xHeight: 350,
    capHeight: 656,
    ascender: 726,
    descender: -250,
    counterWidth: 249,
    // Under the join's reach in units, which is 0.42 of a 78-unit pen: a
    // letter that gives up a join swaps the reach for this, and has to come out
    // narrower for it, not wider.
    sidebearing: 28,
    /*
     * The round letters go well over the line, which is half of the bounce.
     *
     * The reference tops its `o` at 1.06 of an x-height and its `e` at 1.08,
     * against an `n` at 0.88 -- and ours reached 0.93 to 1.03 for everything,
     * which is a ruled line. The other half is the shoulder's crest above.
     *
     * Large for an overshoot because it is doing more than one job: a pen with
     * this much contrast is at its thinnest across the top of a bowl, so the
     * ink stops short of where the spine goes and the overshoot pays for that
     * before it buys any overshoot at all. At 6 this face's `o` did not reach
     * the x-height at all, topping out at 0.96.
     *
     * Affordable only since a round letter's room came to be measured at the
     * seam: a taller bowl is a wider one, and spaced off its waist it would
     * have taken the width with it.
     *
     * Thirty on all four, which is about a tenth of an x-height and is what the
     * reference overshoots -- its `o` stands 0.06 of one above the waist and
     * 0.10 below the line. Swept further and it keeps paying: 52 on the Casual
     * took the spread of the tops to 0.151 and the face to 1.20 of the
     * reference's width with descenders 0.99 deep against its 0.84, because
     * the overshoot goes under the line as well as over it and a descender is
     * measured from where it lands. Thirty is where the bounce is bought and
     * the descender is not.
     */
    overshoot: 30,
    slant: 6,
  },
  /*
   * A pointed pen, not a ballpoint, and this is what a script's texture is.
   *
   * Read the widths of every run of ink a horizontal line crosses on `noeacsu`
   * and the reference comes out in two heaps: about 350 runs at 0.07 to 0.09 of
   * an x-height and about 440 at 0.19 to 0.21, with a gap between them. That is
   * a nib that swells coming down and lifts going up. This face came out as one
   * spike -- 399 runs at 0.16 and nothing at all thinner -- which is a monoline
   * wearing a script's shapes, and is exactly what it looked like set as words.
   *
   * Contrast below about 0.6 does not open the heap at all: swept at 0.22, 0.45
   * and 0.6, the thin end never leaves the spike. There is no moderate setting
   * here, only spike or spread. At 0.78 the runs spread from 0.10 to 0.35 with
   * the main heap at 0.19, which is the reference's, and the weight goes to 74
   * to put it there and keep the page at 0.99 of the reference's colour.
   *
   * The angle stays at 28. Swept against 0 and -6 -- on the reasoning that a
   * nib square to the downstroke is what the Formal Script wanted -- and both
   * of those close the spread back into a single spike, because at this face's
   * slant it is 28 that puts the two directions of travel across different
   * widths of the nib.
   */
  pen: { weight: 78, contrast: 0.78, angle: 28 },
  /*
   * The single-storey a and the tailed l, which is what a hand writes. Nobody
   * draws a two-storey a with a pen unless they are drawing a typeface.
   */
  /*
   * The plain `g`, not the curled one, and that is a fact about a joined face
   * rather than about the letter.
   *
   * The curl carries the descender further round than a straight hook does,
   * which is what a face without loops wants. This face has loops: the join
   * layer strikes an eye on the lowest end of every descender, so a curled `g`
   * is a written descender drawn twice, and the two ran an x-height apart just
   * under the baseline where the reference has one stroke a fifth of an
   * x-height wide. It set the `g` at 1.26 to 1.41 of this family's own `o`
   * against the reference's 1.07; plain, it is 1.00.
   */
  // And the straight-tailed `y` for the same reason as the plain `g` above: the
  // eye is the join layer's to draw, so a tail that curls round as well draws
  // it twice. Plain, this face set its `y` at 1.44 to 1.68 of its own `o`
  // against the reference's 1.06.
  forms: {
    ...WRITTEN_CAPITALS,
    k: "standing",
    l: "tailed",
    t: "straight",
    y: "straight",
    f: "descending",
    n: "written",
    r: "written",
    o: "written",
    a: "written",
    e: "written",
  },
  parts: {
    ...PLAIN.parts,
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
    /*
     * The arch stops short of the waist, which is what a hand does.
     *
     * The reference tops its `n` at 0.88 of an x-height and its `u` at 0.90
     * while its `m`, `v`, `w` and `x` reach 1.00 and its `o`, `e` and `z` go
     * over to 1.06 and beyond -- a fifth of an x-height between the lowest
     * letter and the highest. Every letter of ours stood within four
     * hundredths of every other, which is what makes a line of type look ruled
     * rather than written.
     *
     * Swept: 0.90 puts the `n` at 0.89 and the `u` at 0.91.
     */
    shoulder: { spring: 0.55, reach: 0.75, crest: 0.9 },
    /*
     * Narrower than a circle, which is what a script's round letters are.
     *
     * This said the opposite for a while and was wrong. The reference's `o`
     * reads 0.799 of an x-height across the middle against a bowl 1.16 tall --
     * a ratio of 0.69, an upright oval, and the same 0.79 the note that stood
     * here before recorded. What overturned it was measuring the waist on a
     * band a tenth of an x-height deep: the reference's exit stroke climbs
     * through 0.3 to 0.4 and reaches 1.18, half an x-height outside the bowl,
     * and a band that wide catches it and reads the letter as a circle. Read on
     * three hundredths either side of the middle it cannot, and the bowl is an
     * oval again.
     *
     * The cost of getting it wrong was not the shape alone. Drawn to 1.15 the
     * bowls filled their own advances: two `o`s left 0.10 of an x-height of
     * white between them at the waist where the reference leaves 0.29, and on
     * the Casual Script and the Monoline they touched and fused.
     *
     * The number is a ratio of the bowl's height, so it moved when the
     * overshoot did -- a taller bowl is a wider one at the same ratio. 0.56
     * reads 0.795 here.
     */
    bowl: { width: 0.56, squareness: 0, aperture: 1, superness: 0 },
    script: {
      ...NO_SCRIPT,
      on: true,
      /*
       * Low, so the join runs along the writing line and the letters arch over
       * it. Set near the waist -- which is where these all began -- the
       * connecting stroke crosses every letter at mid height and a word comes
       * out threaded on a rule rather than written on a line. `levelArc`
       * arrives tangent to the horizontal, so a long stretch either side of
       * every seam is flat, and at the waist that flat is the most visible
       * thing on the page.
       *
       * Low was the wrong answer to that, and the reference says so. Sliced
       * down its own advance, its `n`, `o`, `e`, `a`, `u` and `m` all carry
       * ink from about 0.25 of an x-height to 0.40 -- it hands over a third of
       * the way up, and the crossing is 0.15 of an x-height tall, which is a
       * stroke climbing steeply through the boundary. Ours handed over at 0.15
       * to 0.22, a crossing 0.07 tall, which is a stroke lying flat -- and
       * lying flat right where every letter's foot already is.
       *
       * Taken up to the reference's third. Measured on the longest unbroken
       * run of ink at any height in `handgloves`, which is what a rule through
       * a word is: 0.25 of the word at 0.18, 0.18 at 0.24, and 0.14 from 0.30
       * up, against the reference's 0.06. The rest of that gap is the flat
       * tangent itself and is not a number this control can reach.
       *
       * It is now a number `tilt` reaches, and the height was right all along:
       * `seam.ts` puts the reference's handover at 0.26 to 0.39 on every letter
       * of its lowercase, which is where this already stood. See `tilt`.
       */
      height: 0.3,
      /*
       * Climbing, and steeply, which is the difference between a join and a
       * rule through the word.
       *
       * Twenty was the first attempt and it tilted the wrong thing: the arc
       * turned and the straight run at the seam stayed level, so every letter
       * still laid a flat stretch at the same height. `scallop.ts` draws what
       * the reference does instead -- its `n` leaves the foot of its last stem
       * at the writing line, runs level for a tenth of an x-height, then climbs
       * at about fifty degrees across its own advance and goes on climbing into
       * the letter after it at about seventy.
       *
       * Fifty-five is between the reference's two, which is as close as one
       * number gets: both halves of a join have to leave the seam on the same
       * heading or two letters that have never met cannot meet on it. Swept at
       * 45, 55, 65 and 72 with the ink standing on the origin measured against
       * the reference's -- 0.08, 0.11, 0.16 and 0.19 of an x-height tall
       * against its 0.27 -- and taken by looking rather than by that number,
       * because past about sixty-five the straight run either side of the seam
       * reads as a spike between the letters.
       */
      tilt: 55,
      /*
       * And this is the face's fit as much as its join, which is why it moved.
       *
       * The reach is added to the advance at both ends, so it is the white
       * between two letters as well as the stroke that crosses it. At 1.5 it
       * was a quarter of the x-height at each end where the reference runs
       * about a twelfth, and the letters that have no width of their own paid
       * for it twice: the `o` and the `e` came out as wide as the `n`, where
       * the reference draws them a fifth narrower.
       *
       * Set to where the letters still only lap by what the knit intends. Below
       * that they lap by more, which is two letters colliding rather than one
       * joining, and this face has room all the way down -- at 0.6 the worst
       * pair still laps by exactly the knit's sixteen hundredths.
       *
       * What stops it there is the other end: the reach has to stay above the
       * sidebearing, because that is what stands in for it on the side a
       * boundary letter has no join on. Below it, dropping a join makes a
       * letter *wider* -- the first letter of a word came out broader than the
       * same letter mid-word, and the `.begin` and `.end` forms stopped being
       * the narrower drawings they exist to be. This face's sidebearing is 46
       * units against a pen of 70, so the floor is two thirds of a stem.
       */
      /*
       * Narrower than the arch this face used to carry, and measured stem to
       * stem rather than by the advance.
       *
       * Across an `n` at half the x-height the reference sets its two stems
       * 0.79 of an x-height apart, and its `m` a shade tighter still at 0.73
       * and 0.61. These faces stood at 0.97 to 1.20. It hides in the `n`,
       * which has one arch and came out within a twentieth of the reference's
       * advance, and it doubles in the `m`: 2.37 to 2.75 against 1.95.
       *
       * The join goes up as the arch comes down. The reference builds its `n`
       * out of a narrow arch and a long reach -- 0.55 of the advance is arch
       * and 0.85 is stem and join -- where these were built the other way
       * round, 0.98 and 0.49. Moving one without the other only trades the `m`
       * for the `n`.
       *
       * This face stood at 1.02 and reads 0.78 here.
       */
      reach: 0.55,
      flat: 0.06,
      /*
       * Looped, where this face used to have none.
       *
       * That was a deliberate choice -- a print hand does not turn its
       * ascenders round -- and it is the furthest thing in the family from the
       * reference, which loops every one of them. Sized so the eye's foot lands
       * where the reference's does, just above the x-height, rather than partway
       * up the ascender: see the note on the Formal Script's loop.
       */
      loop: 2.63,
      /*
       * How narrow the eye is for its height, and it was never chosen: one arc
       * bowed to a half is a semicircle, so every eye came out exactly half as
       * wide as it was tall. Measured where the eye is widest, ours spanned 0.79
       * of an x-height against the reference's 0.48, with a counter of 0.47
       * against its 0.20.
       *
       * Swept from 0.5 down to 0.22 on all four; this is where this face's `l`
       * lands on both of the reference's numbers at once. The four differ because
       * they differ in slant and pen and where their eyes sit -- the Formal's is
       * struck at 1.6 x-heights and the Monoline's at 1.3 -- and this is fitted
       * to the same two figures on each.
       */
      eye: 0.28,
      irregularity: 1,
      bow: 0.8,
      /*
       * A tenth of an x-height of overlap either side of the seam, in this
       * face's stems.
       *
       * Sized against the reference rather than guessed: its `n`'s lead-out
       * runs a tenth of an x-height past its own advance and the next letter's
       * lead-in starts a tenth before its own origin, so the two halves lap over
       * a fifth of an x-height and weld into one climbing stroke. Kept in stems
       * so it moves whenever the pen does -- which is why the four numbers
       * differ, the Monoline's pen being a hairline and needing most of one.
       *
       * Up from 0.22, which was the same figure sized for a handover that
       * crossed the seam nearly level. A climbing one spends part of its run
       * going up instead of along, so the same length of stroke laps less.
       */
      knit: 0.45,
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
  ...PLAIN,
  name: "Formal Script",
  family: "script",
  blurb:
    "A pointed pen held at an angle and moved slowly. Long loops, deep contrast, and a steep even lean.",
  /*
   * The lowercase brought down under the extenders, as on the Handwriting and
   * for the reason set out there, and taken the whole way: 0.330 of the em in
   * the x-height and 2.20 x-heights of ascender, against the reference's 0.332
   * and 2.17. It read 0.368 and 2.18 -- right on the rise and a tenth wide on
   * the body, which is a face that has the reference's proportion between its
   * own two lines and not against the em.
   *
   * Everything measured against the x-height came down with it: the counter,
   * the sidebearing, the overshoot and the pen. The descender is set where the
   * ink lands rather than where the loop is aimed, which is a little short of
   * the metric because a descender loop reaches past its line.
   */
  metrics: {
    ...PLAIN.metrics,
    xHeight: 332,
    // Under the ascender by the gap this face already had, brought down in the
    // same proportion. Left at the Sans' 700 it stood level with the new
    // ascender, and a capital that is not shorter than an `l` is not a capital.
    capHeight: 639,
    ascender: 720,
    descender: -262,
    counterWidth: 285,
    sidebearing: 42,
    // Over the line, as on the Handwriting. 30 takes the spread of the tops
    // from 0.147 to 0.202, against the reference's 0.205, for 4 per cent of width.
    overshoot: 30,
    slant: 22,
  },
  /*
   * The nib, set against the Garamond this face is cut to.
   *
   * Forty-two degrees is a broad-nib angle and it was fighting the letters. A
   * nib is thickest across itself, so at forty-two the thick falls on a stroke
   * running down and to the *left* -- and an italic has none: at this slant
   * every downstroke runs at about sixty-eight degrees, sixty off the thickest
   * direction, so the deepest contrast the face could ask for came out as a
   * face with almost none. Set square to the downstrokes instead and the thick
   * lands where a hand puts it and where the reference has it, with the
   * hairlines left on the joins and the tops of the bowls.
   *
   * And then the ratio is worth having: at 0.58 the thin is four tenths of the
   * thick, where the reference's hairlines are nearer a fifth.
   *
   * The weight came up with it, and for the reference's colour rather than its
   * proportion: raising the contrast thins the thins and leaves the thicks
   * where they were, so the page got *lighter* for having more contrast in it.
   * Swept at 96, 108, 120, 132, 145 and 175 against the counters -- the `a`,
   * the `e` and the `g` are closing by 132 and gone by 145, and the reference
   * keeps its counters open. A hundred and twenty is a quarter more colour with
   * the whites still breathing.
   *
   * Two numbers below are measured in stems and so moved with it. The reach
   * would have widened the face by six per cent for a change that is meant to
   * be about colour; at 1.6 the line comes out within one per cent of where it
   * was. The drop would have grown to a hundred and twenty units, which is the
   * size that was already blobbing on the `c`; at 0.8 it stays where it was
   * tuned. The reference is set tighter than either -- closing the reach
   * further is a change to the fit and belongs to itself.
   */
  /*
   * And the weight down with the body.
   *
   * At 103 against a 370-unit x-height this pen was 0.28 of it, against the
   * reference's 0.19 -- and the page still read within five per cent of the
   * reference's colour, because the face was half again too wide and the extra
   * white was paying for the extra black. Closing the fit took that cover away
   * and the colour went to 1.22. At 70 against 332 the stem is 0.21 of the
   * x-height and the two land together: 1.10 on the fit, 1.07 on the colour.
   *
   * Swept at 92, 80 and 70 across four reaches, with the counters watched: the
   * `a`, the `e` and the `g` closed at 132 and above on the old body and are
   * open at every one of these.
   */
  pen: { weight: 70, contrast: 0.78, angle: -22 },
  /*
   * The plain `g`, not the curled one, and that is a fact about a joined face
   * rather than about the letter.
   *
   * The curl carries the descender further round than a straight hook does,
   * which is what a face without loops wants. This face has loops: the join
   * layer strikes an eye on the lowest end of every descender, so a curled `g`
   * is a written descender drawn twice, and the two ran an x-height apart just
   * under the baseline where the reference has one stroke a fifth of an
   * x-height wide. It set the `g` at 1.26 to 1.41 of this family's own `o`
   * against the reference's 1.07; plain, it is 1.00.
   */
  // And the straight-tailed `y` for the same reason as the plain `g` above: the
  // eye is the join layer's to draw, so a tail that curls round as well draws
  // it twice. Plain, this face set its `y` at 1.44 to 1.68 of its own `o`
  // against the reference's 1.06.
  /*
   * The written `a`, as on the other three joined faces. It was the two-storey
   * one, which a pointed-pen hand does not write: pressed into this face's
   * narrow oval and its hairline horizontals, the head lost its join to the
   * bowl and the letter read as a `∂` with a hook floating over it.
   */
  forms: {
    ...WRITTEN_CAPITALS,
    k: "standing",
    a: "written",
    l: "tailed",
    y: "straight",
    f: "descending",
    one: "footed",
    n: "written",
    r: "written",
    o: "written",
    e: "written",
  },
  parts: {
    ...PLAIN.parts,
    // Square, for the reason set out on the Handwriting above.
    terminal: { kind: "butt", angle: 0 },
    /*
     * The drops the reference finishes its `a`, `c`, `f`, `r` and `y` on, which
     * this face had none of: `ball.size` came down from the Sans at nought. One
     * stem across and seated a third of a radius along the stroke, which is the
     * arrangement the Monoline arrived at -- visible and confident rather than
     * timid, and reading as the stroke swelling and stopping.
     */
    ball: { size: 0.8, drop: 0.35 },
    corner: { radius: 46, join: "round" },
    // An oval, as on the Handwriting. 0.55 reads 0.822, and is the floor of
    // its own control; the reference's 0.799 would want 0.539.
    bowl: { width: 0.55, squareness: 0, aperture: 1, superness: 0 },
    // The arch stops short, as on the Handwriting. 0.86 reads 0.88 and 0.88.
    shoulder: { spring: 0.5, reach: 0.7, crest: 0.86 },
    script: {
      ...NO_SCRIPT,
      on: true,
      // Low, for the reason set out on the Handwriting above.
      // A third of the way up, as on the Handwriting. Its run goes 0.19 to 0.15.
      height: 0.3,
      // Climbing, as on the Handwriting, and for the reason set out there.
      tilt: 55,
      /*
       * Down from 1.6, then from 1.1, and the second of those was waiting on
       * the body rather than on the join.
       *
       * At 1.1 this face set 1.48 times as wide as the reference, and closing
       * the reach on its own only traded that for colour: the ink stayed where
       * it was and the room around it came away, so the page went from 1.05 to
       * 1.31 as the fit came from 1.48 to 1.13. The reach was holding a wide
       * face apart, not spacing a right one.
       *
       * With the body and the pen at the reference's proportions there is
       * nothing to hold apart. Swept at 0.8, 0.65 and 0.55 against three knits:
       * the fit and the colour crossed at about 0.7, which read 1.10 and 1.07.
       *
       * The note that used to stand here said the bodies lap by more than the
       * knit intends below 1.1 -- 0.20 against 0.16 at a reach of 0.9. They do
       * not any more; that was the old body's letters being wider than the
       * reference's, and it is 0.16 here.
       *
       * Back up to 0.8, as the arch comes down, for the reason set out on the
       * Handwriting above. That sweep was against a shoulder of 0.96, and it
       * was reading the two together without knowing it. This face stood at
       * 1.09 stem to stem across an `n`, against the reference's 0.79, and
       * reads 0.80 here.
       */
      reach: 0.8,
      // Almost no flat: a formal hand swings from one letter into the next in
      // one continuous turn and never runs level between them.
      flat: 0.04,
      /*
       * Sized on the reference's eye rather than on the pen alone.
       *
       * The eye's *shape* was already close -- half again as tall as it is
       * wide, against the reference's 0.53 -- and its size and its place were
       * not. The reference's `l` turns its ascender round and crosses back over
       * the stem just above the x-height, at 0.64 of one, leaving an eye 1.28
       * x-heights tall. This face crossed at 1.18 and left one 0.85 tall: a
       * small eye stranded near the top of the ascender rather than the loop
       * being the point of the letter.
       *
       * The eye is struck down from the top of the stem, so what moves its foot
       * is how far down it reaches, and that is this number.
       */
      loop: 2.7,
      /*
       * How narrow the eye is for its height, and it was never chosen: one arc
       * bowed to a half is a semicircle, so every eye came out exactly half as
       * wide as it was tall. Measured where the eye is widest, ours spanned 0.76
       * of an x-height against the reference's 0.48, with a counter of 0.37
       * against its 0.20.
       *
       * Swept from 0.5 down to 0.22 on all four; this is where this face's `l`
       * lands on both of the reference's numbers at once. The four differ because
       * they differ in slant and pen and where their eyes sit -- the Formal's is
       * struck at 1.6 x-heights and the Monoline's at 1.3 -- and this is fitted
       * to the same two figures on each.
       */
      eye: 0.3,
      irregularity: 0.12,
      bow: 0.6,
      // The reference's tenth of an x-height either side of the seam, in this
      // face's stems -- so it moves whenever the pen does, and the pen came down
      // by a third. Up from 0.3 with the climbing handover; see the Handwriting.
      knit: 0.48,
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
  ...PLAIN,
  name: "Casual Script",
  family: "script",
  blurb:
    "A felt tip moving fast. High joins, short reach, small loops, and a line that bows and will not sit still.",
  // Bounces hardest of the four, so it needs the most room between its
  // capitals and its ascenders. See the note on the Handwriting.
  // The lowercase brought down under the extenders, as on the Handwriting. This
  // one had the largest x-height of the four and the shortest rise, so it moves
  // furthest; it stops at the Telma end of the range rather than the Dancing
  // Script end, because a fast informal hand is not a formal one.
  metrics: {
    ...PLAIN.metrics,
    xHeight: 350,
    capHeight: 645,
    ascender: 729,
    descender: -239,
    counterWidth: 232,
    sidebearing: 34,
    // Over the line, as on the Handwriting. 52 takes the spread of the tops
    // from 0.049 to 0.150, against the reference's 0.205, for 6 per cent of width.
    // Furthest behind of the four: its round letters topped out at 0.93,
    // below the waist rather than over it, so it asks for the most.
    overshoot: 30,
    slant: 13,
  },
  /*
   * Down with the fit, and for the reason the Formal and the Monoline record:
   * this face was 1.14 times as wide as the reference and 1.29 times as dark,
   * and those are not two faults. Half again the room needs half again the ink
   * to fill it, so closing one without the other only trades them -- swept at
   * 66, 58, 52 and 46 across three reaches, and the colour rises a hundredth
   * for every hundredth the fit comes in.
   *
   * At 52 the fit is exactly the reference's and the page reads 1.17. Lighter
   * closes the rest of it -- 46 reads 1.09 at a fit of 0.96 -- and stops being
   * this face: a felt tip moving fast is not thinner than the plain hand beside
   * it, and 46 is 0.143 of the x-height against the Handwriting's 0.157. What
   * is left is not the pen. It is the line: this face's `d`, `h` and `g` carry
   * a sixth more ink than the reference's at the same width, and its `v` and
   * `e` a third.
   */
  /*
   * And a pointed pen here too, which is the one thing about this face that is
   * not what a felt tip does.
   *
   * A felt tip is monoline, and monoline is what this was: 385 runs at 0.15 of
   * an x-height and nothing thinner. Against the reference that reads as wire
   * rather than as writing -- see the note on the Handwriting for the two heaps
   * a written line comes in. Swept at 0.30, 0.70 and 0.78 across three weights,
   * 0.70 at 66 puts the main heap at 0.19, where the reference's is, and the
   * page at the reference's colour exactly.
   *
   * What is kept of the felt tip is everything else: the speed, the high seam,
   * the short reach, the bounce.
   */
  pen: { weight: 70, contrast: 0.7, angle: 22 },
  // The tailed `l`, as on the other three and as the reference draws it: the
  // plain one is a bare stem with no width of its own, so the join spaced it at
  // 0.47 of this face's `o` where the reference sets its `l` at 0.65.
  /*
   * The plain `g`, not the curled one, and that is a fact about a joined face
   * rather than about the letter.
   *
   * The curl carries the descender further round than a straight hook does,
   * which is what a face without loops wants. This face has loops: the join
   * layer strikes an eye on the lowest end of every descender, so a curled `g`
   * is a written descender drawn twice, and the two ran an x-height apart just
   * under the baseline where the reference has one stroke a fifth of an
   * x-height wide. It set the `g` at 1.26 to 1.41 of this family's own `o`
   * against the reference's 1.07; plain, it is 1.00.
   */
  forms: {
    ...WRITTEN_CAPITALS,
    k: "standing",
    t: "straight",
    y: "straight",
    f: "descending",
    l: "tailed",
    n: "written",
    r: "written",
    o: "written",
    a: "written",
    e: "written",
  },
  parts: {
    ...PLAIN.parts,
    // Square, for the reason set out on the Handwriting above.
    terminal: { kind: "butt", angle: 0 },
    corner: { radius: 70, join: "round" },
    // An oval, as on the Handwriting. 0.56 reads 0.799.
    bowl: { width: 0.56, squareness: 0, aperture: 1.08, superness: 0 },
    // The arch stops short, as on the Handwriting. This face already sat
    // lowest of the four, so it asks for the least. 0.95 reads 0.89 and 0.91.
    shoulder: { spring: 0.48, reach: 0.8, crest: 0.95 },
    script: {
      ...NO_SCRIPT,
      on: true,
      // Low, for the reason set out on the Handwriting above.
      // A third of the way up, as on the Handwriting. Its run goes 0.17 to 0.10, and is worse again above this.
      height: 0.24,
      // Climbing, as on the Handwriting, and for the reason set out there.
      tilt: 55,
      /*
       * Down from 1.05 to 0.6, to where the bodies still lap by only what the
       * knit intends, and then back up to 0.7 as the arch comes down. See the
       * note on the Handwriting.
       *
       * This face stood at 0.97 stem to stem across an `n`, against the
       * reference's 0.79, and reads 0.79 here. It was the closest of the four
       * before and moved the least.
       */
      reach: 0.7,
      flat: 0.1,
      // Was 0.7, which was too small to close an eye at all -- the loop showed
      // as a bulge on the stem. Sized on the reference's, as on the Formal.
      loop: 2.16,
      /*
       * How narrow the eye is for its height, and it was never chosen: one arc
       * bowed to a half is a semicircle, so every eye came out exactly half as
       * wide as it was tall. Measured where the eye is widest, ours spanned 0.64
       * of an x-height against the reference's 0.48, with a counter of 0.34
       * against its 0.20.
       *
       * Swept from 0.5 down to 0.22 on all four; this is where this face's `l`
       * lands on both of the reference's numbers at once. The four differ because
       * they differ in slant and pen and where their eyes sit -- the Formal's is
       * struck at 1.6 x-heights and the Monoline's at 1.3 -- and this is fitted
       * to the same two figures on each.
       */
      eye: 0.4,
      /*
       * The liveliest of the four, and no longer by nearly double.
       *
       * At 1.6 its five square-footed letters spread across 0.142 of an
       * x-height against the Handwriting's 0.089 and the Monoline's 0.090 --
       * and the Monoline asks for no unsteadiness at all, so 0.090 is what the
       * letters' own shapes come to before any is added. Most of what set this
       * face apart was therefore a fifth of an x-height of bounce laid on top
       * of a floor everything shares, which reads as a fault rather than as a
       * fast hand.
       *
       * At 1.2 it spreads 0.107: still the highest of the four, which is what a
       * face whose own blurb says its line will not sit still should be, and no
       * longer twice what the letters do on their own.
       *
       * It measured 0.002 before the seed behind it was found not to scatter,
       * so this is the first setting of it that has ever been fitted to
       * anything.
       */
      irregularity: 1.2,
      bow: 0.9,
      // The reference's lap, in this face's stems, so it moves whenever the pen
      // does -- and the pen came down by a fifth. Up from 0.25 with the climbing
      // handover; see the Handwriting.
      knit: 0.5,
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
 * Drawn at the proportions the genre actually uses: the x-height is under half
 * the ascender so the loops have room to be the point of the letter, and the
 * whole thing leans hard. Set at a sixth of a much larger x-height with
 * ascenders half again as tall, it was a fat upright cursive -- the shape of a
 * script with none of the proportions of one.
 *
 * The stroke was a thirteenth of the x-height, on the reasoning that a
 * monoweight script is a hairline; it was then taken to a sixth, because at a
 * thirteenth the page read half the reference's darkness; and it now sits at
 * about a seventh and a half. The middle of those three was a right reading of
 * a wrong measurement.
 *
 * Colour is ink over the area of the line it sits on, and the area of the line
 * is the advance. This face set 1.46 times as wide as the reference, so every
 * letter had half again the white to fill and no pen light enough to look right
 * could fill it -- the darkness was missing because the room was there, not
 * because the stroke was thin. Raising the pen filled the room and left the
 * face reading as a heavy monoline set loose.
 *
 * With the body at the reference's proportions and the reach closed to match,
 * the room is gone and the hairline is right: pen 44 against a 332 x-height
 * reads 1.02 times the reference's colour at 1.05 times its fit, where the old
 * arrangement read 1.01 at 1.46. The face is a hairline again and the page is
 * the reference's.
 *
 * Every quantity the join and the loops are measured in is a multiple of the
 * pen, which is right at a text weight and is the trap here: the reach at 2.12
 * was that compensation, holding a join the size of the old page's on a pen
 * that had come down. It is 0.9 now because the page it is drawn on is the
 * reference's size, and the loop stays high because it is the point of the
 * face -- swept at 5.8, 4.2, 3.2 and 2.4, and it moves the fit by four
 * hundredths and the colour by nothing that holds a direction.
 */
export const MONOLINE_SCRIPT: Style = {
  ...PLAIN,
  name: "Monoline Script",
  family: "script",
  blurb:
    "A hairline of one thickness, drawn rather than written. Long looped ascenders, a hard lean, and a drop of ink on every open end.",
  metrics: {
    ...PLAIN.metrics,
    // Over the line, as on the Handwriting. Never named here before; it was
    // taking the Sans' 10.
    overshoot: 30,
    xHeight: 332,
    /*
     * Capitals raised with the ascenders rather than left where the sans put
     * them. Every other face here has its ascender a shade over its cap; this
     * one carries the ascender half again as high, and a capital left at the
     * sans' height would be a third of the way down the letter beside it. It is
     * also what keeps an accent on an `l` under the ceiling the drawing is
     * checked against, which is read off the cap.
     *
     * The three came down together, keeping the cap eight ninths of the rise
     * that the paragraph above is about. The body is the reference's now --
     * 0.332 of the em and 2.17 x-heights of ascender, which is its figure to
     * the second place -- where this face read 0.360 and 2.50.
     */
    capHeight: 640,
    ascender: 720,
    descender: -268,
    /*
     * Twenty-one, and it is the descenders that set the ceiling rather than
     * taste. The lean turns about the seam, so a descender three hundred units
     * below it swings a long way left; past twenty-two the `p` and the `j` come
     * out further left than their own origin and stand in the letter before.
     */
    slant: 21,
    width: 0.95,
    // Down with the x-height, and it has to stay under the join's reach in
    // units or a letter that gives up a join comes out wider than the one that
    // keeps it. The reach is 0.9 stems of a 44-unit pen, which is 39.6.
    sidebearing: 34,
  },
  pen: { weight: 44, contrast: 0, angle: 0 },
  // The straight-tailed `y`, for the reason set out on the Handwriting: this
  // face's eye is the join layer's, and a tail that curls as well draws it
  // twice -- 1.68 of its own `o` against the reference's 1.06.
  forms: {
    ...WRITTEN_CAPITALS,
    k: "standing",
    l: "tailed",
    y: "straight",
    f: "descending",
    seven: "barred",
    four: "open",
    n: "written",
    r: "written",
    o: "written",
    a: "written",
    e: "written",
  },
  parts: {
    ...PLAIN.parts,
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
    /*
     * The drop, against the reference this face is cut to.
     *
     * A written drop terminal reads as the stroke swelling and stopping. Five
     * stems on a pen of twenty-eight is a hundred and forty units -- two fifths
     * of the x-height -- and that is not a terminal, it is a dot: it shut the
     * aperture of the `G` and sat beside the `c` and the `S` rather than on
     * them.
     *
     * The overhang was doing as much of the damage as the size. At seven tenths
     * of its own radius the disc's middle sits past the end of the stroke, so
     * most of its mass is outside the ink and it reads as something stuck on.
     * A third of a radius leaves it seated on the end and pulled along it,
     * which is the shape a pen makes when it stops.
     */
    // Held in units as the pen went from 28 to 58: 2.4 stems of the old pen is
    // 1.16 of the new one, and the drop is the same size on the page as before.
    ball: { size: 1.16, drop: 0.35 },
    corner: { radius: 30, join: "round" },
    // An oval, as on the Handwriting. This face runs at a width of 0.95, which
    // multiplies the bowl, so it asks for more than the others; 0.66 reads
    // 0.801.
    bowl: { width: 0.66, squareness: 0, aperture: 1, superness: 0 },
    // The arch stops short, as on the Handwriting. 0.85 reads 0.88 and 0.91.
    shoulder: { spring: 0.6, reach: 0.65, crest: 0.85 },
    script: {
      ...NO_SCRIPT,
      on: true,
      // Low, for the reason set out on the Handwriting above.
      // A third of the way up, as on the Handwriting. Its run goes 0.19 to 0.14.
      height: 0.24,
      // Climbing, as on the Handwriting, and for the reason set out there.
      tilt: 55,
      /*
       * In pens, and this pen is a hairline, so the number is large where the
       * run of white it buys is not.
       *
       * Down from five, and not as far as the others. Two things stop it. The
       * `r` against the `n` begins to lap by more than the knit intends below
       * about three and a half; and before that, at about four and a third,
       * the `p`'s descender swings out past its own origin and into the letter
       * before it -- this face leans twenty-one degrees and its descenders are
       * the deepest of the four, so a tighter fit puts their tails outside the
       * letter rather than under it.
       *
       * It also carries the widest counter of the four against its x-height:
       * still the Sans' 370 over an x-height of 360. Narrowing that is what
       * would let this face close up properly, and it belongs to itself.
       *
       * 4.4 of the old 28-unit pen is 2.12 of the 58-unit one, which is the
       * same 123 units of white and the same two limits above.
       *
       * Up again to 1.0, as the arch comes down, for the reason set out on the
       * Handwriting above -- away from both of those limits, not towards them.
       * This face stood at 1.20 stem to stem across an `n`, the widest of the
       * four against the reference's 0.79, and reads 0.78 here.
       */
      reach: 1.0,
      flat: 0.05,
      // Held in units across the pen change, and then opened to put the eye's
      // foot where the reference puts it. See the note on the Formal's loop.
      loop: 5.8,
      /*
       * How narrow the eye is for its height, and it was never chosen: one arc
       * bowed to a half is a semicircle, so every eye came out exactly half as
       * wide as it was tall. Measured where the eye is widest, ours spanned 0.90
       * of an x-height against the reference's 0.48, with a counter of 0.63
       * against its 0.20.
       *
       * Swept from 0.5 down to 0.22 on all four; this is where this face's `l`
       * lands on both of the reference's numbers at once. The four differ because
       * they differ in slant and pen and where their eyes sit -- the Formal's is
       * struck at 1.6 x-heights and the Monoline's at 1.3 -- and this is fitted
       * to the same two figures on each.
       */
      eye: 0.22,
      // Nothing. A drawn script is drawn on a line and stays on it, and this is
      // the setting that says so.
      irregularity: 0,
      bow: 0.2,
      /*
       * Short of the reference's lap, and knowingly.
       *
       * This pen is a hairline -- seventy-eight thousandths of the x-height
       * against the reference's hundred and ninety -- so the reference's lap
       * costs most of a stem here where it costs a fifth of one on the Formal,
       * and 0.84 is what it takes. At that figure the `e` brings its entry
       * stroke tangent to its own bowl, and the fuse and the painter part
       * company over the sliver between them: `ecircumflex` and `ecaron` come
       * out 2.2% different with a run of 108 pixels disagreeing, which is a
       * boolean failure and not a rounding one.
       *
       * The tangency is this face's, not the lap's -- at 0.84 it is 2.2%, at
       * nothing it is already 1.1% with a 57-pixel run, and everything between
       * 0.2 and 0.6 is under half a per cent.
       *
       * That was at the old hairline pen, where 0.6 of a stem bought only an
       * eighth of an x-height of lap against the reference's sixth. With the
       * pen at 58 the same 0.6 buys a quarter, which is half as much again as
       * the reference, so it comes down to 0.32 and the pair laps by the
       * reference's figure at last.
       *
       * And up to 0.76 once the hand began handing over climbing rather than
       * level. The knit is how far each half carries on past the seam so that
       * the two cross rather than touch, and a climbing handover spends part of
       * that going up instead of along, so the same length of stroke laps less.
       * This is the reference's tenth of an x-height at this face's pen, which
       * is a hairline and so needs most of a stem where the other three need
       * about half of one.
       */
      knit: 0.76,
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

/**
 * The roundhand: the joined face the others are the corners of.
 *
 * The four above each commit to a hand -- a print hand, a pointed pen, a felt
 * tip, a ruled line -- and each is best at being that one thing. This one is
 * built to be moved. Every setting on it sits where a dial has room either
 * side, so the same face reaches a low-waisted flowing script at one end and a
 * tall upright brush hand at the other without any of the controls running
 * into a stop.
 *
 * Where the numbers come from, since a face that is *meant* to travel needs to
 * start somewhere defensible rather than somewhere convenient. Two variable
 * script faces were measured -- one a flowing connected script, one an upright
 * brush -- and this sits between them on every axis that separates the two:
 *
 *                       flowing      brush      here
 *   x-height / em         0.332      0.495     0.433
 *   cap height / em       0.720      0.696     0.712
 *   ascender / em         0.720      0.751     0.743
 *   descender / em       -0.280     -0.250    -0.275
 *   slant                  13deg      16deg     14deg
 *   stroke / x-height      0.179      0.125     0.157
 *   bounce / x-height      0.033      0.000     0.017
 *
 * The middle column is what this face measures, not what it declares -- those
 * are two numbers, and `scripts/dev/likeness.ts` is what keeps them honest.
 *
 * Read off the letters rather than out of the tables, which matters on the two
 * that disagree: both fonts declare an ascender near the top of the em, and in
 * both the actual `l` stops a good way under it. The declared figure is the
 * line spacing and the drawn one is the letter, and it is the letter this
 * engine draws to.
 *
 * `likeness.ts` holds those measurements and the settings that travel to each
 * of them, so the two ends of the dial are written down once and the harness
 * that checks the journey reads the same numbers this face was placed between.
 */
export const ROUNDHAND: Style = {
  ...PLAIN,
  name: "Roundhand",
  family: "script",
  blurb:
    "The joined face built to be moved rather than to be one hand. Middling everything, with room on both sides of every control.",
  metrics: {
    ...PLAIN.metrics,
    xHeight: 420,
    capHeight: 708,
    ascender: 735,
    descender: -265,
    slant: 14,
  },
  /*
   * A little contrast rather than none.
   *
   * The two faces measured have a good deal of it and the engine's own four
   * split evenly -- two with a nib, two without. Starting at nought would put
   * half the range on one side of the rest position and none of it on the
   * other, which is the one thing a face meant to travel cannot afford.
   */
  pen: { weight: 74, contrast: 0.24, angle: 28 },
  forms: {
    ...WRITTEN_CAPITALS,
    k: "standing",
    l: "tailed",
    // The plain `g`, whose descender the join layer loops as it does the
    // other four faces'. The curled one ended its curl in a ball jammed
    // into the left of its own bowl.
    t: "straight",
    f: "descending",
    // Hands on from its arm; see the written `r`.
    r: "written",
    /*
     * And the written `e`, whose rising bar goes lighter as the pen gets
     * heavy. The plain one's bar is the stem's own weight, and from the Bold
     * up it filled the eye: at 260 a hundredth of an x-height squared.
     */
    e: "written",
  },
  parts: {
    ...PLAIN.parts,
    // Square, for the reason set out on the Handwriting above.
    terminal: { kind: "butt", angle: 0 },
    corner: { radius: 60, join: "round" },
    bowl: { width: 0.96, squareness: 0, aperture: 1, superness: 0 },
    shoulder: { spring: 0.56, reach: 0.98, crest: 1 },
    script: {
      ...NO_SCRIPT,
      on: true,
      height: 0.33,
      reach: 1.7,
      flat: 0.12,
      /*
       * Climbing, as on the other four, and for the reason set out on the
       * Handwriting. This face was the one left level, and it showed: every
       * join in a word lay at the same height as every other, so `gloves` and
       * `brown` came out threaded on a rule struck through the `v`, the `w`,
       * the `e` and the `s`.
       */
      tilt: 50,
      // Welded rather than tacked, as on the other four; see `knit`.
      knit: 0.4,
      /*
       * An eye with a counter in it. At 1.4 stems and a semicircle, the loops
       * on the `l`, the `t` and the `b` closed to blobs at this face's own
       * weight; this is the other four's shape at this face's size.
       */
      loop: 2.4,
      eye: 0.32,
      /*
       * Two tenths, which reads as a hand and not as a fault.
       *
       * It was nine tenths until the seed behind it was found not to scatter:
       * every letter was drawing very nearly the same number, so the control
       * was sinking the whole lowercase rather than bouncing it, and nine
       * tenths of nothing is nothing. With a seed that scatters, two tenths
       * puts this between the two faces measured, which is where a face built
       * to be moved belongs.
       */
      irregularity: 0.2,
      bounce: 1,
      /*
       * Leans about half as much as it bounces. The flowing face measured
       * bounces by a thirtieth of its x-height while sitting at a steady
       * thirteen degrees, and the brush face bounces by nothing measurable at
       * sixteen -- so between them the two axes vary independently, which is
       * exactly the split one control could not say.
       */
      lean: 0.55,
    },
  },
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
  ROUNDHAND,
];

/**
 * How far past its own text weight a face has been taken: nought up to it,
 * one at about a Black, and on to one and a half.
 *
 * Measured as a stem against an x-height rather than in units, because that
 * is the question a heavy weight raises -- how much of the room between two
 * lines the ink has taken -- and it holds when the lines move. It starts at
 * whichever is heavier of the base's own weight and a text weight, so a face
 * drawn heavy to begin with (the Display, the Fairground) is left as it was
 * designed, and a hairline base (the Wavy, the Monoline Script) is not treated
 * as bold at a regular stem.
 *
 * Everything a type designer does to a Black hangs off this one number, and
 * none of it changes a node, so every weight still interpolates with every
 * other: the pen takes contrast (`heavierPen`), the letters stand further
 * apart (`spacingOf`), and the bowls widen so their counters keep open
 * (`frame` in `letters/common.ts`).
 */
export function blackness(style: Style): number {
  const { pen, metrics } = style;
  if (pen.black !== undefined) return pen.black;
  if (metrics.xHeight <= 0) return 0;
  const base = BASES.find((one) => one.name === style.name);
  const own = base ? base.pen.weight / base.metrics.xHeight : TEXT_STEM;
  const from = Math.max(own, TEXT_STEM);
  /*
   * And a face that starts heavy has less of the way to go: it arrives at a
   * Black at the same stem as every other face does, because what closes a
   * counter is how much of the x-height the stem has taken, not how far the
   * slider has moved. Counted over the whole span from the Sans's text stem,
   * the Ribbon and the Marker came to a pen of 200 not halfway to a Black
   * and with their B and e nearly shut.
   */
  const span = Math.max(TEXT_STEM + BLACK_SPAN - from, BLACK_SPAN / 4);
  return Math.min(Math.max((pen.weight / metrics.xHeight - from) / span, 0), 1.5);
}

/**
 * How heavy a face that keeps its counters open at a heavy weight
 * (`metrics.heavyOpen`) is drawn, as `blackness` counts it but always from
 * the text stem: nought at a text weight, one at about a Black, on to one
 * and a half. `blackness` starts a face drawn heavy (the Display) at its own
 * weight, which is right for how it grows but not for how much room its
 * counters have left: the Display's own pen already stands where the
 * Sans's Black does against its x-height. Nought on every other face.
 */
export function stemBlack(style: Style): number {
  const { pen, metrics } = style;
  if (!metrics.heavyOpen || metrics.xHeight <= 0) return 0;
  if (pen.black !== undefined) return pen.black;
  return Math.min(Math.max((pen.weight / metrics.xHeight - TEXT_STEM) / BLACK_SPAN, 0), 1.5);
}

/**
 * How much stem a weight has gained past the Black, in units: nought up to
 * `HEAVY_OPEN_FROM` (the Sans at Geist Black's 194) and on with the pen from
 * there, as `stemBlack` counts it. Nought on a face that does not open its
 * bowls past the Black (`metrics.heavyOpen`).
 */
export function pastBlack(style: Style): number {
  const from = style.metrics.heavyOpenFrom ?? HEAVY_OPEN_FROM;
  return Math.max(0, stemBlack(style) - from) * BLACK_SPAN * style.metrics.xHeight;
}

/** Where `pastBlack` starts: the Sans's blackness at a pen of 194. */
export const HEAVY_OPEN_FROM = 0.885;

/**
 * The pen at which a face reaches a given `blackness`: the same measure turned
 * round, for a letter that wants to know where along its axis a Black falls.
 */
export function weightAtBlackness(style: Style, black: number): number {
  const { metrics } = style;
  const base = BASES.find((one) => one.name === style.name);
  const own = base ? base.pen.weight / base.metrics.xHeight : TEXT_STEM;
  const from = Math.max(own, TEXT_STEM);
  const span = Math.max(TEXT_STEM + BLACK_SPAN - from, BLACK_SPAN / 4);
  return (from + black * span) * metrics.xHeight;
}

/**
 * What a joined face measures its joins in, which is its pen -- held near the
 * pen the face was designed at.
 *
 * The reach, the weld and the loop are set in stem widths so they hold as the
 * weight moves a little, and that is right near the face's own weight and wrong
 * far from it. At a Light the stem is a third of what it was, the letters
 * closed up to a third of their spacing, and a lead-in had no room left to
 * climb to the top of its stem except by running up beside it: the
 * Roundhand's `minimum` came out as a row of looped `p`s. At a Black the stem
 * is three times what it was and so was every join, until the words were
 * letters threaded on a bar as heavy as their stems. A hand writing larger or
 * smaller spaces its letters by the size of the writing, not by the width of
 * the pen, so the pen is held within a band either side of the face's own.
 */
export function scriptUnit(style: Style): number {
  const { pen, metrics } = style;
  if (metrics.xHeight <= 0) return pen.weight;
  const base = BASES.find((one) => one.name === style.name);
  if (!base || base.metrics.xHeight <= 0) return pen.weight;
  const own = base.pen.weight / base.metrics.xHeight;
  const stem = pen.weight / metrics.xHeight;
  return metrics.xHeight * Math.min(Math.max(stem, own * SCRIPT_LEAST), own * SCRIPT_MOST);
}

/** How far a joined face's measure may fall below its own pen, and rise above. */
const SCRIPT_LEAST = 0.8;
const SCRIPT_MOST = 1.3;

/** A text stem against its x-height, a little over the Sans's own. */
const TEXT_STEM = 0.19;
/** How much further a Black's stem goes: the Sans at a pen of 200. */
const BLACK_SPAN = 0.2;

/**
 * The pen a heavy weight is drawn with: its horizontals lighter than its stems.
 *
 * A monolinear Black is not monolinear. Drawn with the stem's pen all round,
 * an o at a fifth of the em has a crown and a foot each as thick as its sides
 * and the x-height leaves a pinhole between them; the bowl of a b, the eye of
 * an e and the two counters of an 8 went the same way. Every real Black thins
 * its horizontals -- a third lighter than the stems is where the grotesques
 * sit -- and that is what contrast on an upright pen is. So the pen gains it,
 * never loses any it had, and a face whose own contrast is already more
 * (the Serif, the Display, the scripts) is drawn exactly as before.
 */
export function heavierPen(style: Style): Pen {
  const { pen } = style;
  /*
   * A pen held on its side draws its horizontals with the whole weight, and
   * at a Black of a reversed face two of them took all but a sliver of the
   * x-height: the Fairground's e and o were slits. So there the weight goes
   * where a reversed Black puts it -- into the thin verticals, which carry on
   * growing with the weight asked for -- and the horizontals take only a
   * fifth of what the weight gains past the face's own. At half, an e, a B,
   * an E and an F at the heaviest pen stacked three horizontals into more
   * than the x-height and their counters closed to slits.
   */
  if (Math.abs(Math.abs(pen.angle) - 90) < 30) {
    const black = blackness(style);
    if (black <= 0) return pen;
    const base = BASES.find((one) => one.name === style.name);
    const own = base
      ? base.pen.weight * (style.metrics.xHeight / base.metrics.xHeight)
      : pen.weight;
    if (pen.weight <= own) return pen;
    const weight = own + (pen.weight - own) * 0.2;
    const thin = pen.weight * (1 - pen.contrast);
    return {
      ...pen,
      weight,
      contrast: Math.max(0, 1 - thin / weight),
      own: pen.own ?? pen.contrast,
    };
  }
  const { heavyContrast, capitalContrast, contrastRise } = style.metrics;
  if (style.metrics.lighterAcross) return pen;
  const own = pen.own ?? pen.contrast;
  const capital = style.metrics.capital && capitalContrast !== undefined;
  const settled = (raw: number): number => {
    let wanted = raw;
    /*
     * Given back past the Black, towards the lowercase's own at an Ultra: the
     * capitals' and figures' counters are as short as the lowercase's by then,
     * and an 8 or a 4 with horizontals a third heavier closed up.
     */
    if (capital && wanted > own) {
      const past = Math.min(1, Math.max(0, (blackness(style) - 0.67) / 0.83));
      const share = capitalContrast + (1 - capitalContrast) * past * past;
      wanted = own + (wanted - own) * share;
    }
    /*
     * Eased into the face's limit rather than stopped at it, and only past the
     * Black: the same pen as ever up to there.
     */
    if (heavyContrast !== undefined) {
      const ease = heavyContrast * 0.3;
      const knee = heavyContrast - ease;
      if (wanted > knee) wanted = knee + ease * (1 - Math.exp((knee - wanted) / ease));
    }
    return wanted;
  };
  const plain = settled(Math.min(0.56, 0.37 * blackness(style)));
  // Risen as the face's own measures have it, its bowls still sized by the plain one.
  const wanted = contrastRise
    ? settled(
        Math.min(
          0.56,
          contrastRise.to *
            Math.tanh(Math.max(0, pen.weight - contrastRise.from) / contrastRise.over) +
            0.37 * Math.max(0, blackness(style) - contrastRise.past),
        ),
      )
    : plain;
  const sized = contrastRise ? { sized: Math.max(plain, own) } : {};
  /*
   * Never less than the pen already has -- but a capital's is worked out
   * afresh from the face's own, since the style it is drawn from was made
   * heavier for the lowercase first.
   */
  if (capital) {
    if (wanted <= own) return pen.own === undefined ? pen : { ...pen, contrast: own, ...sized };
    return wanted === pen.contrast && pen.own !== undefined && pen.sized === sized.sized
      ? pen
      : { ...pen, contrast: wanted, own, ...sized };
  }
  if (wanted <= pen.contrast) return pen;
  return { ...pen, contrast: wanted, own, ...sized };
}

const CAPITALLED = new WeakMap<Style, Map<string, Style>>();
const FIGURES = new Set([
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
]);

/**
 * The style a capital or a figure is drawn with, on a face that gives them
 * less of a heavy weight's contrast than its lowercase: see `capitalContrast`.
 * The same object back for everything else.
 */
export function capitalled(style: Style, name: string): Style {
  if (style.metrics.capitalContrast === undefined || style.metrics.capital) return style;
  const capital =
    FIGURES.has(name) ||
    ([...name].length === 1 && name.toUpperCase() === name && name.toLowerCase() !== name);
  if (!capital) return style;
  let known = CAPITALLED.get(style);
  if (!known) {
    known = new Map();
    CAPITALLED.set(style, known);
  }
  const had = known.get(name);
  if (had) return had;
  // Heavier towards the Thin, where the face asks for it: see `metrics.capitalThin`.
  const heavier = style.metrics.capitalThin;
  const held = style.metrics.lightHeld;
  const light =
    heavier && held && held.from > 30
      ? Math.min(1, Math.max(0, (held.from - style.pen.weight) / (held.from - 30)))
      : 0;
  const made = {
    ...style,
    pen:
      light > 0 ? { ...style.pen, weight: style.pen.weight * (1 + heavier! * light) } : style.pen,
    metrics: {
      ...style.metrics,
      capital: true,
      overshoot: style.metrics.overshoots?.[name] ?? style.metrics.overshoot,
    },
  };
  known.set(name, made);
  return made;
}

const PROPORTIONED = new WeakMap<Style, Map<string, Style>>();

/**
 * The style a letter's skeleton is built with: the face's own, with the
 * letter's width from `metrics.proportions` folded into `width`.
 *
 * The same object back for a letter that has no entry, and the same object
 * every time for one that does, so everything cached against a style stays
 * cached.
 */
export function proportioned(style: Style, name: string): Style {
  const own = style.metrics.proportions?.[name] ?? 1;
  let factor = own;
  /*
   * And at a heavy weight, the width the face's Bold draws the letter at: see
   * `metrics.bold`. Reached along the weight, and past the Bold eased back
   * toward halfway between the Regular's own width and the construction's,
   * which is how wide a Black has to stand to keep counters it has no
   * drawing for.
   */
  const bold = style.metrics.bold;
  if (bold) {
    const black = blackness(style);
    const heavy = bold.widths[name] ?? 1;
    if (black <= bold.at) factor = own * (1 + (heavy - 1) * (black / bold.at));
    else {
      const eased =
        (1 - (bold.kept ?? 1)) * Math.min(1, (black - bold.at) / Math.max(1 - bold.at, 1e-6));
      const target = 1 + (own - 1) * 0.5;
      factor = own * heavy + (target - own * heavy) * eased;
      const past = bold.past?.[name];
      if (past !== undefined) {
        factor *= 1 + (past - 1) * Math.min(1, (black - bold.at) / Math.max(1.5 - bold.at, 1e-6));
      }
    }
  }
  if (factor === 1 || !(factor > 0)) return style;
  let known = PROPORTIONED.get(style);
  if (!known) {
    known = new Map();
    PROPORTIONED.set(style, known);
  }
  const had = known.get(name);
  if (had) return had;
  const made = {
    ...style,
    metrics: { ...style.metrics, width: style.metrics.width * factor, stretch: factor },
  };
  known.set(name, made);
  return made;
}

const HEAVIER = new WeakMap<Style, Style>();

/**
 * The pen a joined face draws with past `SCRIPT_HELD_FROM`: only `SCRIPT_GAIN`
 * of the weight asked for beyond it.
 *
 * A joined face's x-height is a third of the em, a little over half a
 * neo-grotesque's, and a pen that is a Black's on the Sans is half of it: at
 * 194 and 260 its lowercase was a black band with the counters gone and every
 * join a bar as heavy as the stems. A heavy script is heavier in its
 * down-strokes and keeps its counters and its hairlines, so past the Bold the
 * pen goes on growing, more slowly. Nothing at or under the Bold moves.
 */
function scriptHeld(style: Style, pen: Pen): Pen {
  if (!style.parts.script.on || !(style.pen.weight > SCRIPT_HELD_FROM)) return pen;
  return {
    ...pen,
    weight: SCRIPT_HELD_FROM + (style.pen.weight - SCRIPT_HELD_FROM) * SCRIPT_GAIN,
  };
}

/** The pen past which a joined face is held: see `scriptHeld`. */
export const SCRIPT_HELD_FROM = 142;

/**
 * How much of the weight past `SCRIPT_HELD_FROM` a joined face's pen still
 * takes. Not 0.4: held to 163 at 194, the Formal Script's x came out with two
 * more pieces than at every other weight, as it does from 162.5 to 166.5.
 */
export const SCRIPT_GAIN = 0.36;

/**
 * The style a letter is actually drawn with at its weight: see `blackness`.
 *
 * The same object back when nothing changes, which is every weight up to the
 * face's own; and the same object for the same style every time, so asking
 * twice costs nothing and a drawing cached against it stays cached.
 */
export function heavier(style: Style): Style {
  const known = HEAVIER.get(style);
  if (known) return known;
  const pen = scriptHeld(style, heavierPen(style));
  const counter = narrowed(style);
  const metrics =
    counter === style.metrics.counterWidth
      ? style.metrics
      : {
          ...style.metrics,
          counterWidth: counter,
          drawnCounter: style.metrics.drawnCounter ?? style.metrics.counterWidth,
        };
  const parts = rounder(style);
  const made =
    pen === style.pen && metrics === style.metrics && parts === style.parts
      ? style
      : {
          ...style,
          pen,
          metrics:
            parts === style.parts
              ? metrics
              : {
                  ...metrics,
                  drawnSuperness: style.metrics.drawnSuperness ?? style.parts.bowl.superness,
                },
          parts,
        };
  HEAVIER.set(style, made);
  HEAVIER.set(made, made);
  return made;
}

/**
 * The parts a heavy weight past the Black is drawn with, on a face that eases
 * its contrast (`metrics.heavyContrast`): the superelliptic bowls rounding
 * off towards ellipses.
 *
 * A superellipse's tight corners, offset inwards by a pen that is by then half
 * the x-height, leave a counter of flats and knuckles -- a lemon rather than
 * an oval -- so past the Black the flat sides give way, and at an Ultra the
 * bowl is an ellipse and its counter a clean pill. Same pieces at every
 * weight: only the shape of the three arcs changes.
 */
function rounder(style: Style): Style["parts"] {
  const drawn = style.metrics.drawnSuperness ?? style.parts.bowl.superness;
  if (!(drawn > 0)) return style.parts;
  /*
   * And lighter than a face that holds its widths below its own pen
   * (`metrics.lightHeld`), towards the plain ellipse Geist Thin's o is: the
   * superness the Regular was tuned to, drawn with a hairline, gave flat
   * flanks and tight shoulders -- rounded rectangles for the o, the % and
   * the loop of the &.
   */
  const held = style.metrics.lightHeld;
  if (held && style.pen.weight < held.from) {
    const light = Math.min(1, (held.from - style.pen.weight) / (held.from - 30));
    const superness = drawn * (1 - 0.7 * light);
    if (superness === style.parts.bowl.superness) return style.parts;
    return { ...style.parts, bowl: { ...style.parts.bowl, superness } };
  }
  if (style.metrics.heavyContrast === undefined) return style.parts;
  const t = Math.min(1, Math.max(0, (blackness(style) - 0.67) / 0.63));
  // Never quite to nought, where an arch is drawn from other pieces: see `archSpine`.
  const superness = drawn * Math.max(0.04, 1 - t * t * (3 - 2 * t));
  if (superness === style.parts.bowl.superness) return style.parts;
  return { ...style.parts, bowl: { ...style.parts.bowl, superness } };
}

/**
 * The white either side of a letter at its weight.
 *
 * A heavy stem pushes its ink out towards the letter beside it, and with the
 * sidebearing held where the regular had it the two stems of an `nn` came
 * nearer each other than the n's own counter is wide -- the word fell into a
 * row of blots. A heavy cut opens its spacing as it closes its counters, by
 * about a quarter of what its stem gains.
 */
export function spacingOf(style: Style): number {
  const { sidebearing, xHeight, bold } = style.metrics;
  // A face drawn to its Bold closes up to the Bold's spacing: see `bold.spacing`.
  const tighter =
    bold?.spacing === undefined
      ? 1
      : 1 + (bold.spacing - 1) * Math.min(1, blackness(style) / bold.at);
  /*
   * A face whose heavy weights close their counters closes its spacing with
   * them, about as the square root of the counter: Geist Black sets its n 61
   * units off each side against the Regular's 80, on a counter of 155
   * against 250.
   */
  if (style.metrics.heavyCounter) {
    const drawn = style.metrics.drawnCounter ?? style.metrics.counterWidth;
    return sidebearing * (narrowed(style) / drawn) ** 0.55 * tighter;
  }
  const gained = blackness(style) * BLACK_SPAN * xHeight;
  return (sidebearing + gained * 0.25) * tighter;
}

/**
 * The counter a letter is drawn with at this weight: the face's own, less
 * what `metrics.heavyCounter` gives back for the stem gained past the face's
 * own pen -- though never less than three quarters of a stem, so the heaviest
 * pen still has a counter to hold open.
 */
export function narrowed(style: Style): number {
  const { metrics, pen } = style;
  const drawn = metrics.drawnCounter ?? metrics.counterWidth;
  const give = metrics.heavyCounter;
  if (!give) return metrics.counterWidth;
  // Past the text weight, as every other heavy-weight change is: see `blackness`.
  let gained = blackness(style) * BLACK_SPAN * metrics.xHeight;
  if (gained <= 0) return drawn;
  /*
   * A face drawn to its Bold (see `metrics.bold`) closes its counters as its
   * Bold does as far as the Bold, and past it a quarter as fast: a Black
   * carried on at a Bold's rate had the feet of its m's serifs meeting.
   */
  /*
   * Bent, on a face that closes its counters faster on the way to its Black
   * than at either end (`metrics.counterBend`): Geist's n is 9 units
   * narrower at its SemiBold than a straight line from its Regular to its
   * UltraBlack gives, and as wide again at both.
   */
  const bend = metrics.counterBend;
  if (bend) {
    const t = Math.min(1, blackness(style) / 0.67);
    gained *= 1 + bend * 4 * t * (1 - t);
  }
  const bold = metrics.bold ? metrics.bold.at * BLACK_SPAN * metrics.xHeight : Infinity;
  if (gained > bold) gained = bold + (gained - bold) * 0.25;
  /*
   * Given back unit for unit as far as the Black; past it, an Ultra's counter
   * keeps closing, but ever more slowly, towards a fifth of the x-height it
   * never reaches. Held at three quarters of the stem instead, as it once was,
   * the counter turned round at the Black and opened again with the pen, and
   * at 0.26 of the em the n stood half as wide again as the Black's.
   */
  const linear = drawn - give * gained;
  const least = metrics.heavyFloor ?? 0.2;
  const floor = Math.min(
    drawn,
    Math.max(metrics.xHeight * least, pen.weight * 0.34 * (least / 0.2)),
  );
  const ease = metrics.xHeight * 0.1 * (least / 0.2);
  if (linear >= floor + ease) return linear;
  return floor + ease * Math.exp((linear - floor - ease) / ease);
}
