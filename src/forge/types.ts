/**
 * Drawing letters instead of editing them.
 *
 * The other half of this application takes a font someone else drew and
 * reshapes it. This half has no font to start from: a letter is described by
 * where its strokes run and how they are drawn, and the outline is worked out
 * from that description every time it is needed.
 *
 * That difference is the whole point. Reshaping a finished outline means
 * pushing points about and hoping they do not run into each other, which is why
 * the weight control on an imported font has to spend so much effort defending
 * itself. Here, weight is an input to the drawing rather than a shove applied
 * afterwards, so there is nothing to defend against: ask for a lighter cut and
 * the letter is drawn again, thinner. It cannot fold, because nothing moved.
 *
 * The other consequence is ownership. Nothing here is traced from or derived
 * from any existing typeface; the shapes are constructed from a skeleton and a
 * pen. What comes out is yours to use without crediting anyone.
 */

import type { Vec2 } from "@/font/types";
import type { Style } from "./style";

// ---------------------------------------------------------------------------
// Spines
// ---------------------------------------------------------------------------

/**
 * A straight run of a stroke's centre-line.
 *
 * Kept apart from curves rather than treated as a degenerate one, because the
 * two offset differently and both offsets are exact only if the distinction
 * survives.
 */
export interface SpineLine {
  kind: "line";
  from: Vec2;
  to: Vec2;
}

/**
 * A circular run of a stroke's centre-line.
 *
 * Circular rather than free-form on purpose, and this is the decision the
 * promise about weight rests on. Offsetting a straight line gives a straight
 * line; offsetting a circular arc gives a circular arc about the same centre
 * with the radius grown or shrunk. Both are exact -- no sampling, no curve
 * fitting, no error to accumulate -- so the outline at any weight is as
 * accurate as the outline at any other, and a heavy cut is not a light one that
 * has been pushed around until it broke.
 *
 * Angles are in radians, measured the usual way: zero along +x, increasing
 * anticlockwise.
 */
export interface SpineArc {
  kind: "arc";
  centre: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
  /** Anticlockwise from start to end when true. */
  sweepPositive: boolean;
  /**
   * Cut into this many pieces rather than as few as the sweep needs.
   *
   * An arc becomes quarter turns at most, so how many nodes it comes to is
   * `ceil(sweep / 90 degrees)` -- right for a turn the letter decides on, and
   * wrong for one the pen decides on. A tail that hooks only where there is
   * room to hook is the second kind: it turns a hundred and five degrees at the
   * Regular and not at all at the Black, which is three nodes against two, and
   * two weights drawn with different nodes cannot be joined into one variable
   * font. Pinning it says the turn is always drawn in the same pieces, and a
   * turn of nothing is drawn in those same pieces stood on one spot.
   */
  pieces?: number;
}

export type SpineSegment = SpineLine | SpineArc;

/** A stroke's centre-line, in order. */
export interface Spine {
  segments: SpineSegment[];
  /** A ring, such as the o, which has no ends and therefore no terminals. */
  closed: boolean;
}

// ---------------------------------------------------------------------------
// The pen
// ---------------------------------------------------------------------------

/**
 * How a stroke ends.
 *
 * - `butt` cuts square across the spine, which is what a sans does.
 * - `round` caps with a half-disc, for a soft display face.
 * - `angled` cuts across at an angle, as a broad nib leaves.
 * - `slab` squares off and then lays a bar across, which is a serif.
 * - `teardrop` swells into a pear on the inside of a curve, which is how a
 *   text face finishes the hook of an a, c, f, r or j. Only a curved end takes
 *   one; a straight end wearing it is cut square.
 * - `level` cuts every open end along the nearer of the two lines the letter
 *   is built on: level with the baseline where the stroke arrives more up and
 *   down than across, upright where it arrives across. On a curve that is not
 *   square to the stroke -- the outside runs on past the spine and the inside
 *   stops short -- which is how a neo-grotesque finishes its c, its s and its
 *   G. See `Terminal.aligned`.
 */
export type TerminalKind = "butt" | "round" | "angled" | "slab" | "teardrop" | "level";

/**
 * How a serif's bar is drawn: a bar of one depth all the way out, or one that
 * thins toward its tip, which is what a text serif does.
 */
export type SerifShape = "square" | "wedge";

/**
 * How the serif at the top of a lowercase stem sits: laid level and reaching
 * both ways, as a slab does, or as one flag sloping down to the left, which is
 * what a pen leaves where it enters the stroke -- or, `flag`, as one level
 * flag to the left, which is how a slab and a typewriter face tell an l from
 * an I.
 */
export type SerifHead = "level" | "sloped" | "flag";

export interface Terminal {
  kind: TerminalKind;
  /**
   * Cut flat along a line rather than square to the stroke, and -- where the
   * terminal is a slab -- lay its bar along that line too.
   *
   * Not a style anybody picks. It is what a square cut and a serif both mean
   * on a stroke that is meant to stop on a line and does not arrive square to
   * it: the arms of a v, an x and a w all end at the x-height, and finished
   * square to their own direction they end in a corner well above it and wear
   * a serif that leans off with them. A designer cutting those by hand cuts
   * them along the line and sets the serif along it, so that is what is drawn.
   *
   * Only meaningful on the terminals that draw a square cut -- `butt` and
   * `slab`. A round cap is dealt with by pulling the spine back instead.
   */
  level?: boolean;
  /**
   * Cut along the nearer of the level and the upright through the end of the
   * spine, whichever is closer to square across the stroke: the `level`
   * terminal, settled when the end is dressed. On a straight end it slides the
   * corners as a level cut does; on a curved one it carries each side along
   * its own curve to the line, so the cut is exact and nothing the sides drew
   * is moved off them.
   */
  aligned?: boolean;
  /**
   * Whether this is a real end of the letter rather than one buried inside
   * another stroke.
   *
   * Half the stroke ends in the alphabet are not ends at all: the arm of an E
   * starts inside the stem, the crossbar of an A starts and finishes inside
   * its two diagonals, and the eye of an e runs into the bowl at both ends.
   * They are cut square because nothing there is ever seen. Anything that adds
   * shape to an end -- a flare, a ball -- has to know the difference, or it
   * puts that shape inside the counter.
   *
   * A serif does not need to ask, because it only goes on the slab terminal
   * the style names and the buried ends are plain cuts. Everything since has
   * needed to.
   */
  open?: boolean;
  /**
   * On a stroke's start: cut level or square as its line and its pen decide,
   * but drawn with the points a square cut has, in the order a square cut
   * has them, either way.
   *
   * A level cut on a straight end stands in for the last node of each side
   * rather than following it (see `sweep`), and at the start that leaves its
   * left corner at the end of the outline where a square cut's is welded to
   * the front: the same points, begun one along. Whether an end is cut level
   * is asked of where it lands, to within a unit of a line, and a few ends
   * are set near a line by the pen rather than written on it -- the four's
   * diagonal starts a reach of the pen under the cap line, the nine's tail at
   * the middle of its bowl -- and on a nib held at eighteen degrees with
   * contrast 0.7 those land inside that unit at some weights and widths and
   * outside it at others. Begun one along at some masters and not at the
   * rest, neither letter could ride a weight axis. Only the order changes:
   * the cut is drawn as it was. Set by a letter's recipe, on ends that are
   * never seen and so never softened.
   */
  keepsPoints?: true;
  /** For `angled`, degrees away from square. Ignored otherwise. */
  angle?: number;
  /** For `slab`: how far the bar reaches past the stroke on each side. */
  projection?: number;
  /**
   * For `slab`: how far each wing reaches past the stroke, as a share of the
   * reach the serif is given, named against the way the stroke travels; a
   * wing left out reaches the whole way. Set by a letter's recipe -- the swung
   * y's arms, whose outer wings are short -- and never by the face.
   */
  wings?: { left?: number; right?: number };
  /** For `slab`: how far the bar reaches back along the stroke. */
  thickness?: number;
  /**
   * For `slab`: how much the join between bar and stroke is filleted. Zero is
   * a hard corner, which reads as a slab serif; more than zero brackets it,
   * which is what a text serif has.
   */
  bracket?: number;
  /**
   * For `slab`: the bracket the face's own base draws at this weight, in the
   * same units. Where the serif is too short to take the bracket asked for,
   * the control is read around this, so the base's own drawing stays put and
   * no stretch of the slider is dead. See `serifsFor`.
   */
  bracketHome?: number;
  /** For `slab`: a bar of one depth, or one that thins toward its tip. */
  shape?: SerifShape;
  /** For `slab`: how the top of a lowercase stem is finished. */
  head?: SerifHead;
  /**
   * For `slab`: what a curved end is finished with instead.
   *
   * A bar laid across the end of a curve reads as snapped off, so a serif face
   * finishes its curved ends -- the hook of a c, the arm of an r -- with the
   * style's own terminal, and this is that terminal.
   */
  curved?: { kind: Exclude<TerminalKind, "slab">; angle: number };
  /**
   * How far the left corner of a level cut is carried back down the stroke,
   * in font units: the sloped top a lowercase stem has under a sloped head.
   * Only read on a level cut.
   */
  sink?: number;
  /**
   * On a level cut: a serif with its left wing only, the head of a lowercase
   * stem on a face whose heads are flags (`SerifHead` "flag").
   */
  flag?: boolean;
  /**
   * For `teardrop`: the drop, settled when the end is dressed -- its radius,
   * the radius of the curve it finishes, and which side of the stroke that
   * curve turns to (one for the left of the way it is going, minus one for the
   * right). Settled before the stroke is pulled back to make room for it, so a
   * pull that swallows the last of a curve does not lose the drop.
   */
  drop?: {
    radius: number;
    bend: number;
    side: number;
    /**
     * How far the ball is carried along the pear's axis, in drop radii (the
     * style's `terminal.dropHang`, times the end's `pear.hang`). Set only
     * where a drop field is on; left out, the drop is drawn as it always was.
     */
    hang?: number;
    /** How far the pear's axis turns from the end's heading toward plumb, in radians. */
    turn?: number;
    /** How far the neck blends toward a departure of matching curvature, nought to one. */
    neck?: number;
  };
  /**
   * For `slab`: an end that is cut plain rather than serifed -- one stopping in
   * mid-air at an angle, as the neck of a question mark and the flag of a one
   * do, or one on a symbol rather than a letter. Drawn as the serif refused.
   */
  bare?: boolean;
  /**
   * A beak on a curved end: the upright wedge a text face's C, G and S carry
   * where their curves stop, running from the end straight down (or up) the
   * outside of the letter. `reach` is the height its tip stops at, in font
   * units, and `way` which way it runs: minus one down, one up.
   * Settled when the end is dressed; the end itself is then a plain cut.
   */
  beak?: {
    reach: number;
    way: number;
    /**
     * Drawn as an upright bar `width` across, from the line at `from` to the
     * tip, standing inside the letter from the end's outer corner: the s's
     * and the S's, as Lora draws them.
     */
    bar?: { width: number; from: number };
    /** The serif's tip rounding (`Terminal.tip`), carried onto the beak. */
    tip?: number;
  };

  /*
   * The soft finishes, every one of them optional and absent unless its own
   * field of the style is above nought: a terminal without them is drawn
   * exactly as it was before they existed. Sides are named against the way
   * the stroke travels -- `left` is the left of its direction of travel, in
   * font units that run up -- whichever end they are on. Which of them are
   * present decides how many nodes an end has, so they are settled from the
   * style and the skeleton only, never from the pen.
   */

  /**
   * For `slab`: the share of the serif's tip depth that is rounded, copied
   * from `parts.slab.tip` by `terminalFor` where it is above nought.
   */
  tip?: number;
  /**
   * The radius each corner of a seen cut is rounded by, in font units: one
   * added node a corner. Set by `softened` when the end is dressed.
   */
  soft?: { left?: number; right?: number };
  /**
   * A cut that is seen though it is not `open` -- the ends of a crossbar, the
   * flag and the top of a t -- hinted by the recipe so a softened finish can
   * reach it. Only ever set where `terminal.soft` or `terminal.taper` is on.
   */
  seen?: true;
  /**
   * How much wider the stroke is at this end than at the root of its last
   * straight piece, as a factor of its half width: the flared arm of a beak.
   */
  swell?: number;
  /**
   * Which side of a swelled end grows, against the way the stroke travels:
   * one for its left, minus one for its right; left out, both do. An arm
   * lying along a line keeps its edge on the line and flares away from it
   * into its beak, as the top and foot of an E do, where a middle arm flares
   * both ways. Set with `swell`, and only read with it.
   */
  swellSide?: 1 | -1;
  /**
   * The share of the stroke's width kept at a seen curved end, from 0.15 to
   * one: the inner side is drawn in toward the outer.
   */
  taper?: number;
  /**
   * An end of an open bowl -- the c's, the C's, the G's -- hinted by the
   * recipe, which gives back `bowl.blunt` of the taper. Only ever set where
   * that field is on.
   */
  blunt?: true;
  /**
   * On a butt end buried in another stroke: how much of an inside rounding
   * each side gets where it leaves that stroke, as a share of the style's
   * `corner.fillet`. Only ever set where that field is on.
   */
  fillet?: { left?: number; right?: number };
  /**
   * This end's own multipliers on the face's pear drop: its size, how far it
   * hangs and how far it curls. Set by a letter's recipe.
   */
  pear?: { size?: number; hang?: number; curl?: number };
}

/**
 * The tool the spine is drawn with.
 *
 * `weight` is the stroke's width where the pen is at its broadest. `contrast`
 * is how much narrower it gets at the other extreme: zero is monolinear, which
 * is a sans, and higher values thin the strokes running across the pen, which
 * is what gives a serif its thick and thin. `angle` says which direction the
 * pen is broadest in, as a real nib's angle does.
 *
 * With contrast the offset of a circular arc is an ellipse arc rather than a
 * circular one -- still exact geometry, still closed-form, and still nothing
 * that can be off by more than the fixed error of writing an ellipse quadrant
 * as a cubic, which at a thousand units to the em is a small fraction of one
 * unit.
 */
export interface Pen {
  weight: number;
  contrast: number;
  /** Degrees. Zero means the pen is broadest vertically, thinning horizontals. */
  angle: number;
  /**
   * The contrast the face itself was drawn with, where a heavy weight has
   * added some of its own: see `heavierPen` in `style.ts`. Left out otherwise.
   *
   * For the decisions about what kind of face this is -- whether it draws its
   * punctuation as a text serif does -- which must not change along a weight
   * axis, or the letters stop having the same points at every weight.
   */
  own?: number;
  /**
   * The contrast a heavy weight's bowls are sized by, where its horizontals
   * thin faster than that (`metrics.contrastRise`): see `frame` in
   * `letters/common.ts`. Left out otherwise.
   */
  sized?: number;
  /**
   * How far past its text weight the letter this is drawn for stands, where
   * that is a different letter: a superior figure is drawn with a pen heavier
   * against its size than the full-size letters, so that it holds its colour,
   * and it is a Regular's figure all the same. See `blackness` in `style.ts`.
   */
  black?: number;
}

/**
 * How the outside of a corner is finished where a stroke changes direction.
 *
 * - `miter` carries both edges on until they meet, which keeps an apex sharp.
 * - `round` turns the pen about the corner, which is exactly the boundary of
 *   the swept region and can never overshoot.
 * - `bevel` cuts straight across, which is what a very sharp miter falls back
 *   to rather than growing a spike several stem-widths long.
 */
export type JoinKind = "miter" | "round" | "bevel";

export interface Stroke {
  spine: Spine;
  pen: Pen;
  start: Terminal;
  end: Terminal;
  /** How the outside of a corner is finished. Miter unless said otherwise. */
  join?: JoinKind;
  /**
   * A flourish the hand starts the letter with, in clear air: the swash a
   * written capital is entered by. It belongs to the letter as a lead-in
   * does, so a split leaves it on rather than cutting it loose.
   */
  swash?: boolean;
  /**
   * A letter or figure of the face drawn small inside a symbol -- a superior
   * figure, a fraction's, an ordinal's letter, the trade mark's T and M --
   * which is to have its ends finished as that letter's are at that size: its
   * serifs on its own lines, the drops on its curved ends. `style` is the
   * small style it was drawn with and `dx`, `dy` how far it has been moved
   * since. Left out, a stroke is finished as part of the glyph it is in.
   */
  setAs?: { name: string; style: Style; dx: number; dy: number };

  /*
   * The soft finishes again, on the stroke rather than on one end. Absent
   * unless the style's own field is above nought, as on the terminal.
   */

  /**
   * An open bowl that takes the style's `bowl.heft` -- the c, the belt of an
   * e -- hinted by the recipe. Closed spines take it without being told.
   */
  heftable?: true;
  /**
   * The bowl's inner side moved off its centre-line by `share` of the
   * stroke's width, toward `tilt` degrees from straight up (positive to the
   * right): thinner at the top, heavier at the foot. Set by `withHeft`.
   */
  heft?: {
    share: number;
    tilt: number;
    /**
     * Faded toward the stem the bowl stands against (`stemSide`), by `share`
     * of it at that side: see `bowl.heftFade`. Left out, the heft is even.
     */
    fade?: { side: 1 | -1; share: number };
  };
  /**
   * Which side of a bowl its stem stands on -- minus one for the left, as a
   * b's and a p's do, one for the right, as a d's and a q's -- hinted by the
   * recipe. Only ever set where `bowl.heft` and `bowl.heftFade` are both on.
   */
  stemSide?: 1 | -1;
  /**
   * The radius the inside of a corner within this stroke is rounded by, as a
   * share of `pen.weight`. Set by `withInside`.
   */
  inside?: number;
  /**
   * Inside roundings where this stroke crosses another with no end buried in
   * it -- the bowl of a p against its stem -- each nearest the point given,
   * at a share of the style's `corner.fillet`.
   */
  crossFillets?: Array<{ near: Vec2; share: number }>;
}

export const BUTT: Terminal = { kind: "butt" };
