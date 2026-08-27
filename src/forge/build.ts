/**
 * Drawing a letter from its recipe and the style it belongs to.
 *
 * The strokes are swept and the serifs are laid over them. Overlapping pieces
 * are left overlapping: that is how a serif is drawn by hand, it is invisible
 * under the fill rule font renderers use, and the export already fuses
 * everything before writing a file. Fusing here instead would mean doing
 * boolean geometry on every keystroke to gain nothing anyone can see.
 */

import { contourArea, contoursBounds, reverseContour } from "@/font/geometry";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import {
  FIGURES,
  LETTERS,
  letterBehind,
  partsOfStroke,
  recipeOf,
  type PartName,
  type Recipe,
  joinEnds,
  reachesEither,
} from "./letters";
import { accentsFor, gapFor, hangsBelow, isCapital, type Parts } from "./accents";
import { reachesCast, type Cast } from "./cast";
import { effectInk, reachesEffects, type Effects } from "./effects";
import { reaches, scaleOf, type Cuts } from "./cut";
import { shapedInk } from "./layers";
import { assemble, hasTiles, type Kit } from "./kit";
import {
  alongSpine,
  decided,
  endPieces,
  endsStraight,
  spinePath,
  waveBookAt,
  wavy,
} from "./shapes";
import { seamsOf, wobbleOf } from "./script";
import { penReach, reachAlong, sweep } from "./sweep";
import type { Style } from "./style";
import type { Stroke, Terminal } from "./types";

export interface Drawn {
  contours: Contour[];
  advanceWidth: number;
  /**
   * What the cuts did, when there were any: how many pieces the letter is in
   * now, and how many it was in before. Absent on a letter nothing was cut
   * out of, which is what "nothing to say" looks like.
   */
  cut?: { pieces: number; was: number };
}

/** A stroke's centre-line and the pen along it, for drawing over the letter. */
export interface Bone {
  path: string;
  /** Where the pen sits, and how wide it is there. */
  pen: { at: Vec2; across: number; along: number; angle: number }[];
}

/**
 * The skeleton of a letter.
 *
 * The point of showing it is that this half of the application is about
 * skeletons and until now there was no way to look at one. A control that moves
 * where an arch springs from is much easier to understand next to the line it
 * moves than next to a number.
 *
 * Taken from the strokes rather than reconstructed, so what is drawn is the
 * spine the sweep actually used -- corners rounded off, radii held at the pen's
 * limit and all.
 */
export function skeletonOf(name: string, style: Style, form?: string): Bone[] {
  const recipe = recipeOf(name, form);
  if (!recipe) return [];
  return recipe(style).strokes.map((stroke) => {
    const reach = penReach(stroke.pen);
    return {
      path: spinePath(stroke.spine),
      pen: alongSpine(stroke.spine, 6).map((where) => ({
        at: where,
        across: reach.across,
        along: reach.along,
        angle: (reach.angle * 180) / Math.PI,
      })),
    };
  });
}

/**
 * The letters this font can draw: the ones with recipes, and the accented ones
 * those recipes can be built into.
 *
 * The second set is not written down anywhere. It is whatever Unicode says can
 * be decomposed into parts that happen to be drawn, so drawing a new mark
 * tomorrow adds every letter that uses it without anybody listing them.
 */
const DRAWN = new Set(Object.keys(LETTERS));

export function letterNames(): string[] {
  return [...DRAWN, ...accentsFor(DRAWN).keys()];
}

export function canDraw(name: string): boolean {
  return DRAWN.has(name) || accentsFor(DRAWN).has(name);
}

/** What an accented letter is built from, or nothing if it is drawn outright. */
export function builtFrom(name: string): Parts | null {
  return DRAWN.has(name) ? null : (accentsFor(DRAWN).get(name) ?? null);
}

/**
 * Whether this glyph is one of the ones a joined face reaches out of.
 *
 * The accented letters answer for the letter under the mark: an `à` in a script
 * has to hand over to the letter after it exactly as an `a` does, or a word
 * with an accent in it comes apart at both ends of it.
 */
export function reachesOut(name: string, style: Style): boolean {
  if (!style.parts.script.on) return false;
  const parts = builtFrom(name);
  return reachesEither(parts ? parts.base : name);
}

export { letterBehind } from "./letters";

/**
 * Which letter owns the decisions a glyph is drawn with.
 *
 * Itself, for most of them. An accented letter reads its base, and a symbol
 * built out of a letter reads that letter -- so choosing the single-storey a
 * lands on the a whether it was asked for on the a, on an á, or on an ª, and
 * all three follow.
 */
export function decidedBy(name: string): string {
  return builtFrom(name)?.base ?? letterBehind(name) ?? name;
}

/** A round letter is set a little tighter, or it looks loose beside a flat one. */
const ROUND_TIGHTENING = 0.82;

/**
 * Draw one letter, in whichever form has been chosen for it.
 *
 * The form changes which skeleton is used and nothing else. The pen, the
 * proportions and every named part are applied to an alternate exactly as they
 * are to the default, so a font with a flat-topped A still has one weight, one
 * shoulder and one serif.
 */
export function drawLetter(
  name: string,
  style: Style,
  form?: string,
  cuts?: Cuts,
  kit?: Kit,
  cast?: Cast,
  effects?: Effects,
): Drawn | null {
  const made = makeLetter(name, style, form, cuts, kit, cast, effects);
  return made
    ? { contours: made.contours, advanceWidth: made.advanceWidth, cut: made.cut }
    : null;
}

/** One run of a letter: its ink, and the named decisions it was built from. */
export interface Run {
  contours: Contour[];
  parts: PartName[];
}

export interface Made extends Drawn {
  /** The letter taken apart again, in the order it was drawn. */
  runs: Run[];
  /**
   * How far sideways the finished drawing was moved.
   *
   * Kept so that a question about the shape can be asked without the answer
   * depending on where the letter came to rest: making a stem heavier pushes
   * its left flank out and then slides the whole letter back by the same
   * amount, and on the page that flank never moves at all.
   */
  slide: number;
}

/**
 * The letter, and each of its runs kept separately.
 *
 * Everything done to the drawing after the strokes are swept -- the lean, the
 * nudge back inside the sidebearing, the centring a monospaced face does -- is
 * one shear and one slide applied to the whole letter. So they are worked out
 * once from the letter as a whole and then applied to each run as well, which
 * is why a run's ink lands exactly where that part of the letter is rather than
 * somewhere near it.
 *
 * Splitting the sweep by run costs nothing: it was already one sweep per stroke
 * and this only declines to pour them into the same bucket.
 */
export function makeLetter(
  name: string,
  style: Style,
  form?: string,
  cuts?: Cuts,
  kit?: Kit,
  // Last rather than beside the cuts it belongs with, because every one of the
  // eighty-odd places that draw a letter passes these by position and only
  // three of them pass a cut at all.
  cast?: Cast,
  /*
   * What the tool that drew this was like, and only where somebody has asked
   * to see it.
   *
   * Passed by the proofing panel and by the exporter and by nothing else. Every
   * other caller leaves it out, which is what keeps the roughening off the four
   * hundred and fifty letters nobody is looking at -- see `@/font/effects`.
   */
  effects?: Effects,
): Made | null {
  // This letter's own page in the wave book, if one is being kept: see
  // `WaveBook`. A letter built from parts keeps no page of its own -- the base
  // and the mark each open theirs as they are drawn.
  waveBookAt(name);
  const parts = builtFrom(name);
  if (parts) return marked(parts, style, form, cuts, kit, cast, effects);

  /*
   * Laid out on a grid, or drawn from a skeleton.
   *
   * A letter the kit has not been given cells for is still drawn from its
   * recipe, so a kit that covers the capitals and nothing else is a font with
   * capitals on the grid rather than a font with holes in it. Which one a
   * letter is comes out here and nowhere else: everything after this point --
   * the ink, the lean, the spacing, the cuts -- is the same either way.
   */
  const laid = kit?.on && hasTiles(kit, name) ? assemble(kit.glyphs[name], style, kit) : null;
  const recipe = laid ? null : recipeOf(name, form);
  if (!laid && !recipe) return null;
  const built: Recipe | null = recipe ? recipe(style) : null;
  const strokes = laid ? laid.strokes : built!.strokes;

  const inked = strokes.map((stroke) => inkOf(stroke, style));
  // Cells filled in outright are ink rather than a path for it, so they join
  // the drawing as their own run.
  if (laid && laid.blocks.length > 0) inked.push(laid.blocks);
  const lean = leanOf(style);
  const pivot = style.metrics.xHeight / 2;
  /*
   * A letter of an unsteady hand leans a little further over than its
   * neighbour, and turns about the seam rather than about the middle of its own
   * x-height.
   *
   * A shear leaves the line it is pivoted on exactly where it was. Pivoting on
   * the seam is therefore the one place this can be done without opening the
   * joins: the lead-out still stops on the advance and the lead-in still starts
   * on the origin, both at the height they always did, while everything above
   * and below them leans.
   *
   * Nought on every face that does not join, where `wobbleOf` returns nothing
   * and this collapses to the shear that was always here.
   */
  const script = style.parts.script;
  // Only the letters of the running hand lean extra; see the lift in `connected`.
  const tilt = joinEnds(name).entry ? wobbleOf(name, script, style.metrics.xHeight).lean : 0;
  const seam = seamsOf(script, style.metrics.xHeight, style.pen.weight / 2).low;
  const wobbled = (contours: Contour[]): Contour[] =>
    tilt === 0 ? contours : sheared(contours, Math.tan((tilt * Math.PI) / 180), seam);

  /*
   * Where the letter sits, and how much room it is given, are read off the
   * uncut drawing.
   *
   * A cut takes ink away and so it moves the letter's edges, and a letter
   * placed by its edges would shuffle sideways and change width every time a
   * saw tooth landed near one of them. Nobody cutting slots through a font
   * means to respace it. So the solid letter decides the spacing, exactly as
   * it did before there were cuts, and the cut one is what gets drawn in that
   * space -- which is the same promise an imported letter is given when it
   * keeps the advance of the letter it replaced.
   */
  const solid = wobbled(sheared(inked.flat(), lean, pivot));
  // Asked of this letter's own strokes rather than of the settings, so a
  // letter nothing can reach -- a space, which has no ink -- is not put through
  // the machinery to come back as what it already was.
  const cutting = reaches(cuts, strokes) || reachesCast(cast, strokes)
    ? shapedInk(inked.flat(), strokes, scaleOf(style), cuts, cast)
    : null;
  /*
   * What the tool left, on the letter as the cut and the cast have made it and
   * before the lean is taken.
   *
   * Before the lean because three of the four effects are found from the
   * skeleton and the skeleton has not been leaned either -- roughen after the
   * shear and every pool would sit off its own join by the width of the lean.
   */
  const marks = effects && reachesEffects(effects, strokes)
    ? effectInk(cutting ? cutting.contours : inked.flat(), strokes, scaleOf(style), effects)
    : null;
  const cut = marks
    ? wobbled(sheared(marks, lean, pivot))
    : cutting
      ? wobbled(sheared(cutting.contours, lean, pivot))
      : solid;

  /*
   * Only the letters that actually cross are moved, and each by exactly what
   * it needs -- and none of them on a face that joins.
   *
   * A joined letter is drawn deliberately touching its own origin, because the
   * stroke it hands over to the next letter with has to start where the last
   * one stopped. Nudged inside a sidebearing it does not have, every letter of
   * a script would slide right by the same few units and every join in the
   * font would open by them.
   */
  const joinsUp = style.parts.script.on && built?.width !== undefined;
  const shortfall = solid.length > 0 && !joinsUp
    ? Math.max(0, style.metrics.sidebearing - contoursBounds(solid).xMin)
    : 0;
  const placed = slid(cut, shortfall);
  const placedSolid = solid === cut ? placed : slid(solid, shortfall);

  let advanceWidth: number;
  /*
   * A monospaced letter keeps the width it was drawn at and is moved to sit in
   * the middle of the common advance. The shapes are not squeezed or stretched
   * to match: they are set in a column and centred there, which is what a
   * monospaced face is. An i in a space made for an m looks lost, and that is
   * the honest answer rather than a fault to be hidden.
   */
  let centring = 0;
  if (style.metrics.monospaced) {
    advanceWidth = monoAdvance(style);
    if (placedSolid.length > 0) {
      const bounds = contoursBounds(placedSolid);
      centring = (advanceWidth - bounds.xMin - bounds.xMax) / 2;
    }
  } else if (laid) {
    // A letter on a grid is as wide as its cells. Working it out from the ink
    // instead would give two letters of the same width different advances
    // because one of them happens to have an empty column down its side.
    advanceWidth = laid.advanceWidth;
  } else {
    advanceWidth = advanceFor(name, built!, placedSolid, style);
  }

  const slide = shortfall + centring;
  return {
    advanceWidth,
    slide,
    cut: cutting?.cut,
    contours: slid(placed, centring),
    runs: inked.map((contours, index) => ({
      contours: slid(wobbled(sheared(contours, lean, pivot)), slide),
      // A cell has no named part behind it: what it is, is where it is.
      parts: built && index < built.strokes.length ? partsOfStroke(built.strokes[index]) : [],
    })),
  };
}

/**
 * A letter with its marks on it.
 *
 * The two are drawn separately and then one is moved onto the other, and where
 * it lands is read off the drawings rather than stated: the mark is centred on
 * the middle of the letter's ink and stood on top of it. Measuring rather than
 * declaring is what makes this hold as the font changes -- lean the face over
 * and the letter's ink leans with it, so the middle moves and the accent
 * follows, without a rule anywhere saying that accents lean.
 *
 * The runs travel too, so everything downstream still works on an accented
 * letter: the skeleton draws, the probe finds the shoulder of an `ñ` under the
 * pointer, and pressing the tilde finds whatever governs the tilde.
 */
function marked(
  parts: Parts,
  style: Style,
  form?: string,
  cuts?: Cuts,
  kit?: Kit,
  cast?: Cast,
  effects?: Effects,
): Made | null {
  const base = makeLetter(parts.base, style, form, cuts, kit, cast, effects);
  if (!base || base.contours.length === 0) return null;

  const em = style.metrics.unitsPerEm;
  const gap = gapFor(em, isCapital(parts.base));
  const runs = [...base.runs];
  const contours = [...base.contours];

  for (const markName of parts.marks) {
    // The mark gets the tool's marks too, or an accented letter comes out with
    // a roughened body under a machined accent.
    const mark = makeLetter(markName, style, undefined, undefined, undefined, undefined, effects);
    if (!mark || mark.contours.length === 0) return null;

    // Measured against everything placed so far, so a second mark stacks on
    // the first rather than landing on top of it.
    const under = contoursBounds(contours);
    const over = contoursBounds(mark.contours);
    const below = hangsBelow(markName);

    const move = {
      x: (under.xMin + under.xMax) / 2 - (over.xMin + over.xMax) / 2,
      y: below ? under.yMin - over.yMax - gap : under.yMax - over.yMin + gap,
    };
    const shifted = shoved(mark.contours, move);
    contours.push(...shifted);
    runs.push(
      ...mark.runs.map((run) => ({ parts: run.parts, contours: shoved(run.contours, move) })),
    );
  }

  /*
   * Room made for a mark that reaches past the letter under it.
   *
   * An accent is centred on its letter and is often wider than one: the acute
   * on an `Í` hangs a long way past a stem, and on the letter's own spacing it
   * hung outside the letter's own left edge and printed over whatever came
   * before it. So the same nudge every letter gets is applied again to the pair
   * -- inside the sidebearing on the left, and enough advance to clear it on
   * the right.
   *
   * Only the narrow letters move. An accent over an `O` reaches nowhere near
   * the edges, so `Ó` is spaced exactly as `O` is, which is what keeps a word
   * with one accent in it from limping.
   */
  const bounds = contoursBounds(contours);
  const { sidebearing } = style.metrics;
  /*
   * And none of it on a joined face, where the letter's width is not the
   * letter's to change.
   *
   * A script letter's advance is where its lead-out stops, to the unit, and the
   * next letter's lead-in starts there. Widened by an accent, an `à` would hand
   * over five units past where the letter after it begins, and a word with one
   * accent in it would come apart at both ends of it. A mark that reaches past
   * the letter under it simply overhangs, which is what a written accent does
   * anyway.
   */
  const reaching = style.parts.script.on && reachesEither(parts.base);
  const shortfall = reaching ? 0 : Math.max(0, sidebearing - bounds.xMin);
  const placed = shortfall > 0 ? shoved(contours, { x: shortfall, y: 0 }) : contours;
  const spaced =
    shortfall > 0
      ? runs.map((run) => ({ parts: run.parts, contours: shoved(run.contours, { x: shortfall, y: 0 }) }))
      : runs;

  /*
   * Widened by exactly what the mark hangs over, and by nothing else.
   *
   * Measured against the letter's own edge rather than against its advance,
   * because a round letter is deliberately set tighter than its ink plus a
   * sidebearing -- so measuring against the advance widened every `Ó` by the
   * amount the `O` had been tightened by, and a word with one accent in it
   * limped.
   */
  const overhang = reaching ? 0 : Math.max(0, bounds.xMax - contoursBounds(base.contours).xMax);
  return {
    advanceWidth: base.advanceWidth + shortfall + overhang,
    slide: base.slide + shortfall,
    /*
     * The base's count, and the marks left out of it.
     *
     * A mark is drawn solid: an acute is a stroke a few units long and a slot
     * through one is a fault rather than a decision. So the accents add a
     * piece each to what is on the page and nothing to what the cuts did,
     * which is what this count is for.
     */
    cut: base.cut,
    contours: placed,
    runs: spaced,
  };
}

function shoved(contours: Contour[], by: Vec2): Contour[] {
  return moved(contours, (point) => ({ x: point.x + by.x, y: point.y + by.y }));
}

/** How far a letter leans, as a shear rather than as an angle. */
function leanOf(style: Style): number {
  return style.metrics.slant ? Math.tan((style.metrics.slant * Math.PI) / 180) : 0;
}

function moved(contours: Contour[], move: (point: Vec2) => Vec2): Contour[] {
  return contours.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: move(node.point),
      handleIn: node.handleIn ? move(node.handleIn) : null,
      handleOut: node.handleOut ? move(node.handleOut) : null,
    })),
  }));
}

function sheared(contours: Contour[], lean: number, pivot: number): Contour[] {
  if (!lean) return contours;
  return moved(contours, (point) => ({ x: point.x + (point.y - pivot) * lean, y: point.y }));
}

function slid(contours: Contour[], by: number): Contour[] {
  if (by === 0) return contours;
  return moved(contours, (point) => ({ x: point.x + by, y: point.y }));
}

/**
 * The letter, leaned over.
 *
 * Done to the finished outline rather than to the skeleton, and that is the
 * whole reason it is exact. A shear is an affine map, an affine map takes a
 * cubic to a cubic with no error at all, so a slanted face is as accurate as an
 * upright one. Slanting the skeleton instead would turn every circular arc into
 * an ellipse, and an ellipse does not offset to an ellipse -- the offsets would
 * have to be sampled and refitted, and the promise that a heavy cut is the same
 * construction as a light one rather than a pushed-about version of it would be
 * gone.
 *
 * Pivoted at the middle of the lowercase, so a letter leans about its own waist
 * instead of swinging out of its space from the baseline.
 */
function leaning(contours: Contour[], style: Style): Contour[] {
  const degrees = style.metrics.slant;
  if (!degrees) return contours;
  const lean = Math.tan((degrees * Math.PI) / 180);
  const pivot = style.metrics.xHeight / 2;
  const move = (point: Vec2): Vec2 => ({ x: point.x + (point.y - pivot) * lean, y: point.y });
  const leant = contours.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: move(node.point),
      handleIn: node.handleIn ? move(node.handleIn) : null,
      handleOut: node.handleOut ? move(node.handleOut) : null,
    })),
  }));

  return leant;
}

/**
 * The letter nudged back inside its own left edge, if anything on it reaches
 * out past the space it was given.
 *
 * Two things do. Leaning about the waist keeps the middle of a letter where it
 * was and swings the two ends in opposite directions, so anything reaching well
 * below the baseline swings left -- a j at thirteen degrees crossed the origin
 * and would have printed over whatever came before it. And a serif laid along a
 * line is as wide as the stroke is across that line, which on a diagonal is
 * wider than the stroke itself: the foot of an x on the serif face reached past
 * its own sidebearing.
 *
 * Only the letters that actually cross are moved, and each by exactly what it
 * needs. The advance is measured off the drawing afterwards, so the letter
 * keeps its spacing rather than losing it on the other side.
 */
function insideTheEdge(contours: Contour[], style: Style): Contour[] {
  if (contours.length === 0) return contours;
  const shortfall = style.metrics.sidebearing - contoursBounds(contours).xMin;
  if (shortfall <= 0) return contours;
  const shift = (point: Vec2): Vec2 => ({ x: point.x + shortfall, y: point.y });
  return contours.map((contour) => ({
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: shift(node.point),
      handleIn: node.handleIn ? shift(node.handleIn) : null,
      handleOut: node.handleOut ? shift(node.handleOut) : null,
    })),
  }));
}

/**
 * How much room the letter takes on the line.
 *
 * Measured off the drawing rather than stated by the recipe, so a terminal or
 * an overshoot that reaches further than expected takes its space with it
 * instead of hanging outside the letter's own width.
 *
 * Figures are the exception: they are all given the width of the widest of
 * them, because a column of numbers only lines up if every digit occupies the
 * same space, and that is worth more than each one being spaced for itself.
 */
function advanceFor(name: string, recipe: Recipe, contours: Contour[], style: Style): number {
  if (recipe.width !== undefined) return recipe.width;
  if (FIGURES.includes(name)) return figureAdvance(style);
  return measure(recipe, contours, style);
}

/**
 * The one advance a monospaced face gives every letter: the widest any of them
 * needs, so nothing is ever cramped by its neighbours' spacing.
 *
 * Built from the recipes rather than by drawing the letters, for the same
 * reason the figures' shared width is: drawing a letter is what asks for this
 * number, and asking it back would not end.
 */
const monoCache = new WeakMap<Style, number>();

function monoAdvance(style: Style): number {
  const known = monoCache.get(style);
  if (known !== undefined) return known;
  let widest = 0;
  // The drawn letters only. An accented one is its base with a mark set over
  // it and carries the base's advance, so it cannot be the widest thing here
  // -- and it has no recipe of its own to ask.
  for (const name of DRAWN) {
    const built = LETTERS[name](style);
    const contours = insideTheEdge(
      leaning(
        built.strokes.flatMap((stroke) => inkOf(stroke, style)),
        style,
      ),
      style,
    );
    widest = Math.max(widest, measure(built, contours, style));
  }
  monoCache.set(style, widest);
  return widest;
}

function measure(recipe: Recipe, contours: Contour[], style: Style): number {
  if (contours.length === 0) return style.metrics.sidebearing * 2;
  const trailing = style.metrics.sidebearing * (recipe.round ? ROUND_TIGHTENING : 1);
  return contoursBounds(contours).xMax + trailing;
}

/** The figures are all drawn at the same width, so they need the same lean. */

const figureCache = new WeakMap<Style, number>();

function figureAdvance(style: Style): number {
  const known = figureCache.get(style);
  if (known !== undefined) return known;
  let widest = 0;
  for (const name of FIGURES) {
    const built = LETTERS[name](style);
    // Nudged inside its own left edge as well, which is what the letters
    // themselves get. Measured without it, the widest figure came out narrower
    // than the letter it was measuring, and the two ran past its own advance.
    const contours = insideTheEdge(
      leaning(
        built.strokes.flatMap((stroke) => inkOf(stroke, style)),
        style,
      ),
      style,
    );
    widest = Math.max(widest, measure(built, contours, style));
  }
  figureCache.set(style, widest);
  return widest;
}

/**
 * Every shape one stroke puts on the page: the swept stroke itself and
 * whatever the face hangs off its ends.
 *
 * In one place because two callers need the same answer and had drifted: the
 * figures are all set to the width of the widest of them, and that measurement
 * swept the strokes and added the serifs but knew nothing about balls or
 * flares. A four with a ball on its diagonal reached twenty units past the
 * advance every figure had been given.
 */
function inkOf(stroke: Stroke, style: Style): Contour[] {
  const swept = sweep(stroke);
  return [
    ...swept,
    ...ballsFor(stroke, style, swept),
    ...flaresFor(stroke, style),
    ...serifsFor(stroke, style),
  ];
}

/**
 * A ball with nowhere to go, in units.
 *
 * Not zero, which would be the obvious way to say it and does not survive the
 * trip: a disc of no radius comes off the sweep with its caps collapsed and
 * its handles in a different order, so the same six nodes stop lining up with
 * the six of a ball that has room, which is the disagreement this is here to
 * end. One unit sweeps as a disc, rounds to four distinct points on the grid,
 * and is a fiftieth of a hairline wide.
 */
const BURIED = 1;

/**
 * The balls on one stroke: a disc closing off an end that stops in mid-air.
 *
 * Drawn as a stroke going nowhere with a round cap on each end, which is how
 * every other disc in this application is drawn: a ring of no radius swept by
 * a fat pen asks the inner offset for a negative radius, and an ellipse with a
 * negative axis turns itself inside out.
 *
 * Only where the stroke stops in mid-air -- the terminals of a c, an e, an a,
 * an r, an S. A stroke that stops on a line already has something finishing
 * it, and a disc there reads as a blot rather than as a terminal; it would
 * also hang past the line, which is the one thing every letter here is now
 * careful not to do.
 */
function ballsFor(stroke: Stroke, style: Style, swept: Contour[]): Contour[] {
  const { size, drop } = style.parts.ball;
  if (size <= 0 || stroke.spine.closed || swept.length === 0) return [];
  const radius = (size * style.pen.weight) / 2;
  const band = contoursBounds(swept);
  const out: Contour[] = [];
  for (const [terminal, at, outward, straightEnd] of endsOf(stroke)) {
    if (terminal.open !== true) continue;
    /*
     * A straight run that stops on a line is already finished by the line, and
     * a disc there reads as a blot. A curve is asked differently: its end can
     * sit near a line without lying along it -- the shoulder of an r stops just
     * under the x-height travelling downwards -- so it is left to the holding
     * below, which shrinks the disc to whatever room there is rather than
     * refusing it outright.
     */
    /*
     * Asked of the book rather than answered outright, because both halves of
     * the question move with the pen: whether a run arrives straight is settled
     * after its corners are rounded and its cap taken off, and whether its ink
     * has reached one of the letter's lines is a question about how wide the
     * pen is. Refused outright, a terminal carried a ball at one weight and not
     * at the next, and a letter drawn with a different number of shapes at the
     * two ends of the axis cannot follow it: the Psychedelic's `Ω` came back
     * with 220 nodes at three weights and 152 at the Thin, which is two balls.
     *
     * The judgement itself stands -- a disc on a run that stops on a line reads
     * as a blot, and it would hang past the line, which every letter here is
     * careful not to do. So it is the drawn weight's answer every master takes,
     * and where a master would have refused, the ball it draws is buried: the
     * shape is there to be joined to and there is nothing of it to see. Which
     * is the arrangement the waves and the bowls already have, and is why the
     * drawn weight comes back byte for byte what it was.
     */
    const blot = straightEnd && onALine(stroke, at, outward, style);
    if (!decided(!blot)) continue;
    /*
     * And held inside the ink the stroke already made.
     *
     * A ball fattens an end; it does not make the letter taller. Left to sit
     * where it liked, the disc on the top terminal of an s carried the letter
     * twenty-three units over the x-height every other letter stops at -- the
     * same fault the alignment pass exists to prevent, arriving on the end of
     * a shape rather than on the end of a stroke.
     *
     * Held by shrinking rather than by moving, because moving cannot always
     * do it: the terminal of an s faces down and to the right while the part
     * of the disc that is in the way is its top, and pulling it back along the
     * stroke lifts that top rather than lowering it.
     */
    const spare = (limit: number) => {
      const lean = 1 + outward.y * drop;
      return lean > 1e-6 ? (limit - at.y) / lean : Infinity;
    };
    const room = Math.min(radius, spare(band.yMax), spare(-band.yMin + 2 * at.y));
    /*
     * A ball with no room for it is drawn buried, rather than not drawn.
     *
     * Below a stroke's own width there is nothing of the ball left outside the
     * stroke to see, and what is left reads as a lump rather than a terminal.
     * That judgement stands; what was wrong was to skip the shape when it
     * failed, because how much room there is moves with the pen. A Psychedelic
     * C opens its aperture as the pen widens -- it has to, or a heavy one fuses
     * shut -- and opening it swings the terminal round toward the top of the
     * bowl, where there is no headroom left. So the ball was there at the Thin
     * and the Regular and gone by the Bold, and a letter drawn with a different
     * number of shapes at different weights cannot follow the axis at all:
     * 74 of the Psychedelic's letters were being left standing at whichever
     * weight they happened to agree with.
     *
     * Buried, it is the same answer the spine gives for a piece it does not
     * reach -- kept, standing still, taking no room -- and it draws what
     * dropping it drew, because a disc two units across inside a stroke three
     * hundred wide is nothing to see. What it buys is a ball that shrinks down
     * the slider between two weights instead of one that vanishes between them.
     */
    const buried = blot || room < penReach(stroke.pen).across;
    const held = buried ? BURIED : room;
    const middle = buried
      ? /*
         * Set back along the stroke by its own radius, so that the far edge of
         * it lands on the end of the spine and no part of it is outside ink the
         * stroke has already laid down. Left where a ball goes, it showed: a
         * unit and a half of halo on the bounds of a Psychedelic t and J, which
         * is nothing to look at and is still the letter changing shape for a
         * shape that is meant not to be there.
         */
        { x: at.x - outward.x * held, y: at.y - outward.y * held }
      : { x: at.x + outward.x * held * drop, y: at.y + outward.y * held * drop };
    out.push(
      ...sweep({
        spine: {
          segments: [
            {
              kind: "line",
              from: { x: middle.x - 0.5, y: middle.y },
              to: { x: middle.x + 0.5, y: middle.y },
            },
          ],
          closed: false,
        },
        pen: { ...style.pen, contrast: 0, weight: held * 2 },
        start: { kind: "round" },
        end: { kind: "round" },
      }),
    );
  }
  return out;
}

/**
 * Whether a stroke's ink already reaches one of the lines the letter is drawn
 * between, at the end being asked about.
 *
 * Asked of the ink rather than of the spine, because the two are only the same
 * on an upright. The arm of an E finishes in mid-air as far as its spine is
 * concerned -- there is nothing beyond it -- but its ink is lying along the cap
 * line, and a disc put on that end reached eighty units above the line every
 * other letter stops at.
 */
function onALine(stroke: Stroke, at: Vec2, outward: Vec2, style: Style): boolean {
  const { metrics } = style;
  /*
   * The up-and-down part of the ink, and not the whole of it.
   *
   * This one does move a little with the pen, and the alternative measured
   * worse. A pen with contrast lies across a stroke at an angle, so the share
   * of it pointing up shrinks as the stroke turns: the foot of a Psychedelic
   * Omega stands 8 units off the baseline at the Thin and 72 at the Black,
   * against an upright share of 8 and 53. Level at the Thin and well short by
   * the Black, so the ball on it is refused at one weight and drawn at the
   * next, and the Omega, delta, zeta and Ghe-with-upturn are four of the
   * fifteen the Psychedelic still leaves standing.
   *
   * Asked of the whole width across the stroke instead -- which is the
   * measurement `standingOn` uses, and would have made the two rules agree --
   * the Omega came right and fourteen other letters went wrong, because that
   * measurement runs the other way past what the ink really reaches: 138 units
   * against 72 at the Black. The Psychedelic went from 15 letters standing to
   * 29. Under-counting is the cheaper of the two mistakes here.
   */
  const reaches = Math.abs(
    reachAlong({ x: -outward.y, y: outward.x }, penReach(stroke.pen)).y,
  );
  return [0, metrics.xHeight, metrics.capHeight, metrics.ascender, metrics.descender].some(
    (line) => Math.abs(at.y - line) <= reaches + 1,
  );
}

/**
 * The flares on one stroke: the swelling where it arrives at its own end.
 *
 * Laid over the stroke rather than drawn into it, for the same reason a serif
 * is. The sweep offsets a spine by a pen of one width, and that one width is
 * what makes the offset exact -- a pen that changed width along the run would
 * offset a line to something that is not a line and an arc to something that
 * is not an arc, and every promise this half of the application makes would
 * have to be given up to get one letter to swell.
 *
 * A shape overlapping the end says the same thing and costs nothing, and it
 * works on a curved end as well as a straight one, which a serif cannot: a bar
 * laid across a curve reads as snapped off, but a stroke that thickens as it
 * arrives is just a stroke thickening.
 */
function flaresFor(stroke: Stroke, style: Style): Contour[] {
  const { spread, depth, curve } = style.parts.flare;
  if (spread <= 0 || depth <= 0 || stroke.spine.closed) return [];
  const stem = style.pen.weight;
  const out: Contour[] = [];
  for (const [terminal, at, outward, straightEnd] of endsOf(stroke)) {
    /*
     * Only a straight end swells, which is the rule a serif follows too.
     *
     * On a curve the end faces whichever way the curve happened to be going,
     * and a swelling laid across that reads as a spur flying off rather than
     * as the stroke thickening -- the c, e, s, C, G and S all came out looking
     * chipped. A curved terminal is finished by the terminal, which is what
     * the terminal is for.
     *
     * A curved end swells by nothing rather than not being drawn, for the same
     * reason the refusal below does. Whether a bowl's run ends on a straight
     * piece or a curved one is a fair question about the drawing and the answer
     * really does move with the pen -- a bowl wide enough to have flat sides
     * ends on one, and the same bowl drawn as a circle ends on the arc beside
     * it -- so a face that swells its ends draws letters with two more contours
     * at one weight than at the next. The Brush's `three`, `\u00e6` and `\u03c2` and the
     * Flared's `three` and `sterling` are all this.
     */
    const swelling = straightEnd;
    // And only a real end. The arm of an E begins inside the stem and the eye
    // of an e inside the bowl; swelling those puts the shape in the counter.
    if (terminal.open !== true) continue;
    // Cut level with a line, the swelling lies along that line as well, for
    // the same reason and by the same measurement as a serif does.
    const level = terminal.level === true && Math.abs(outward.y) > 1e-3;
    const facing = level ? { x: 0, y: Math.sign(outward.y) } : outward;
    const inner = level ? levelHalfWidth(stroke, outward) : halfWidthAcross(stroke, outward);
    const reach = spread * stem;
    const back = depth * stem;
    for (const side of [1, -1]) {
      /*
       * A flare never crosses a line the stroke is standing on, which is the
       * same rule a serif follows and for the same reason: one of its two
       * sides would hang under the baseline the letter is standing on.
       *
       * Refused, it swells by nothing rather than not being drawn. Whether it
       * crosses is measured from the stroke's own half width, which is the pen,
       * so a flare dropped here is a contour the letter has at one weight and
       * not at the next: the Brush's `one` came back with six contours at the
       * Thin and five at the Bold, the `\u0490` with eleven, ten and eleven across the
       * four, and neither can be laid over the other. Drawn on one spot instead
       * it is the same shape the Psychedelic's ball takes when the room for it
       * runs out, and for the same reason.
       */
      const refused =
        !swelling || crossesALine(at, facing, side, inner + reach, inner, style);
      /*
       * Refused, the swelling reaches nowhere and is a unit deep, which puts
       * all four of its nodes on the stroke's own end inside ink that is
       * already there.
       *
       * Reach alone is not enough: a flare of no reach still runs back up the
       * stroke by its full depth, and on a curved end the stroke curves away
       * from that while the shape does not, so the Brush's `c` crested fifty-
       * two units above its own line and its `C` stopped lining up with its
       * `I`. Depth of nothing is not enough either -- that is a shape with no
       * area, which this face is not allowed to draw. A unit is the same
       * measure and the same reasoning as `BURIED` above.
       */
      const swells = refused ? 0 : reach;
      const deep = refused ? BURIED : back;
      // Wound with the stroke it swells, or it would cancel the ink it is
      // meant to be adding to and open a hole where the two overlap.
      const shape = flare(at, facing, side, inner, swells, deep, curve);
      out.push(contourArea(shape) < 0 ? reverseContour(shape) : shape);
    }
  }
  return out;
}

/**
 * One side of a flare.
 *
 * Written in the stroke's own frame, like a serif wing: `across` runs out from
 * the spine and `into` runs back up the stroke. The shape starts on the spine
 * so that it is buried in ink at the inner edge and cannot leave a seam where
 * it meets the stroke it belongs to.
 *
 * The hollow is a quarter ellipse rather than a quarter circle, because the
 * two measurements it spans are independent: a flare can be shallow and wide
 * or deep and narrow, and a circle would force it to be neither.
 */
function flare(
  at: Vec2,
  outward: Vec2,
  side: number,
  inner: number,
  reach: number,
  back: number,
  curve: number,
): Contour {
  const across = { x: -outward.y * side, y: outward.x * side };
  const into = { x: -outward.x, y: -outward.y };
  const place = (u: number, v: number): Vec2 => ({
    x: at.x + across.x * u + into.x * v,
    y: at.y + across.y * u + into.y * v,
  });
  const tip = place(inner + reach, 0);
  const meets = place(inner, back);
  // A quarter ellipse at one, a straight wedge at nought, and the handles
  // scaled between the two so the control reads as opening the edge out.
  const pull = 0.5523 * curve;
  return {
    nodes: [
      node(place(0, 0)),
      {
        point: tip,
        handleIn: null,
        handleOut: {
          x: tip.x - across.x * reach * pull,
          y: tip.y - across.y * reach * pull,
        },
        type: curve > 0 ? "tangent" : "corner",
      },
      {
        point: meets,
        handleIn: {
          x: meets.x - into.x * back * pull,
          y: meets.y - into.y * back * pull,
        },
        handleOut: null,
        type: curve > 0 ? "tangent" : "corner",
      },
      node(place(0, back)),
    ],
    closed: true,
  };
}

/**
 * The serifs on one stroke.
 *
 * A serif is two wings, one either side of the stroke, rather than a bar across
 * it. The middle of a bar would sit inside the stem where there is already ink,
 * so drawing only the parts that stick out says the same thing with less shape,
 * and it keeps the fillet -- the curve where the serif sweeps back into the
 * stem -- as an edge of the wing rather than as a hole that has to be
 * subtracted.
 */
function serifsFor(stroke: Stroke, style: Style): Contour[] {
  const out: Contour[] = [];
  const reference = penReach(style.pen).across;
  const ends = endsOf(stroke);
  for (const [terminal, at, outward, straightEnd] of ends) {
    if (terminal.kind !== "slab") continue;
    /*
     * Only a straight stroke gets a serif.
     *
     * A bar laid across the end of a curve sits at whatever angle the curve
     * happened to be travelling, and it reads as something snapped off rather
     * than as part of the letter: the c, e, s and 2 all came out with wings.
     * Serif faces finish a curved terminal differently -- flared, or with a
     * ball -- and until there is a shape for that, the plain terminal the style
     * already specifies is the honest answer.
     *
     * Refused, the wing is drawn on the stroke's own end rather than not drawn,
     * exactly as a refused flare is -- see below for the shape it takes.
     * Whether a run ends on a straight piece is a fair question with an answer
     * that moves with the pen, and a face that hangs a serif on every straight
     * end otherwise draws letters with two more contours at one weight than at
     * the next.
     */
    const winged = straightEnd;
    const projection = terminal.projection ?? 0;
    const thickness = terminal.thickness ?? 0;
    if (projection <= 0 || thickness <= 0) continue;

    /*
     * How far the serif reaches is measured from the font's stem, not from the
     * stroke it happens to be sitting on.
     *
     * The arm of a T is a thin stroke -- thinner still on a face with contrast,
     * where the pen is narrow across a horizontal -- and sizing its serif from
     * its own width made the serif taller than the arm it belonged to, so a T
     * came out wearing two flags. Every serif in a typeface is the same size
     * whatever it is attached to, which is what makes them read as one family
     * of shapes rather than as decoration scaled to fit.
     *
     * The wing still starts at the edge of the stroke it is on, or it would
     * float clear of a thin one.
     */
    /*
     * A serif on a stroke that stops on a line lies along that line, whichever
     * way the stroke came in.
     *
     * A bar square to a leaning stroke leans with it, so on a serif face the
     * feet of the A, K, R, V, W, X and Y and the arms of the v, w, x and y all
     * finished forty to seventy units past the line the stroke stopped on --
     * which is the same fault as the one the letters themselves had, arriving
     * by a different route. Turned flat, they sit on the line exactly, and the
     * letter reads as one thing again.
     *
     * The wing is worked out in whatever frame it is drawn in, so all that
     * changes is which way is out and how wide the stroke is measured to be:
     * a band crossing a line at an angle is wider across that line than it is
     * across itself.
     */
    const level = terminal.level === true && Math.abs(outward.y) > 1e-3;
    const facing = level ? { x: 0, y: Math.sign(outward.y) } : outward;
    const inner = level
      ? levelHalfWidth(stroke, outward)
      : halfWidthAcross(stroke, outward);
    // The font's own stem, or this stroke's edge if that is further out, and
    // the projection beyond it. Measured from the stem so that every serif in
    // the face is the same size, and from the stroke where the stroke is the
    // wider of the two, or the wing would begin inside the ink it sits on.
    const full = Math.max(reference, inner) + projection;
    for (const side of [1, -1]) {
      /*
       * A serif never crosses a line the stroke it belongs to is standing on.
       *
       * A serif is a bar across the end of a stroke, and on an upright it goes
       * both ways: that is a foot. On an arm lying along the baseline it cannot,
       * because one of its two wings would hang under the line the letter is
       * standing on. The bottom arm of an E did exactly that -- two hundred
       * units below the baseline on the display face -- and so did an L and a
       * Z, while a T grew one above the cap height.
       *
       * Real serif faces have known this forever: the arms of a T turn down and
       * the foot of an L turns up. It falls out of one rule rather than a list
       * of letters, so a letter that gains an arm tomorrow gets it too.
       */
      /*
       * Both refusals leave the wing drawn on the stroke's own end instead:
       * from the spine out to the edge, and a unit deep. Which is the shape a
       * refused flare takes and for the same reasons -- it begins on the spine,
       * so it is buried in ink whichever way the stroke was going, and a unit
       * of depth is little enough that a curved end cannot curve away from it.
       *
       * Proud of the edge by a unit rather than buried in it was tried first
       * and is worse than it sounds: a unit past the baseline is exactly the
       * tolerance the letters are held to, and on a curve the edge is not where
       * `halfWidthAcross` says it is -- the Slab's `s` crested twelve units
       * above its own line and the Didone's `c` and `e` came apart into two
       * pieces, the wing floating clear of the stroke it belonged to.
       *
       * The `one` and the `\u0490` are this refusal on five faces apiece, and so is
       * the Slab's `\u00e6`, the Didone's `\u0431` and the Serif's whole G family.
       */
      const refused = !winged || crossesALine(at, facing, side, full, inner, style);
      const from = refused ? 0 : inner;
      const tip = refused ? inner : full;
      const deep = refused ? BURIED : thickness;
      /*
       * Never fillet more than the wing is deep or wide, or the curve would
       * have to begin before the serif does. Measured against whichever wing is
       * being drawn, so that a refused one is filleted if the face fillets:
       * held at nought instead it comes off the pen with the same four nodes
       * carrying no handles, and a list that agrees on how many nodes it has
       * and disagrees on which of them are curves is no use either -- the
       * Serif, the Didone, the Slab and the Typewriter all stayed exactly where
       * they were.
       */
      const bracket = Math.min(terminal.bracket ?? 0, deep, tip - from);
      /*
       * A face that undulates undulates here too, and the only way to say that
       * is to draw the bar as a stroke rather than as a shape.
       *
       * A serif is a bar across the end of a stroke. Drawn as a wing -- the
       * part that sticks out, with a fillet where it meets the stem -- it is a
       * shape, and a shape has no spine for a wave to run along. So on a face
       * with a wave the bar is swept like anything else, which costs it the
       * bracket and gains it everything the sweep can do. Which is the trade a
       * wavy face wants: the letters it is drawn for have unbracketed serifs,
       * and what they do have is feet that ripple.
       */
      const shape: Contour[] = waving(style)
        ? sweptWing(stroke, style, at, facing, side, from, tip, deep)
        : [wing(at, facing, side, from, tip, deep, bracket)];
      for (const piece of shape) {
        // Wound with the strokes it sits on, or the serif would cancel the stem
        // it is attached to rather than adding to it.
        out.push(contourArea(piece) < 0 ? reverseContour(piece) : piece);
      }
    }
  }
  return out;
}

/** Whether this wing would reach past a line the stroke end is sitting on. */
function crossesALine(
  at: Vec2,
  outward: Vec2,
  side: number,
  tip: number,
  inner: number,
  style: Style,
): boolean {
  const { metrics } = style;
  const across = { x: -outward.y * side, y: outward.x * side };
  const far = at.y + across.y * tip;
  /*
   * Each line with the direction the letter lies in from it. Needed because
   * a stroke ending exactly on a line is on neither side of it, so which way
   * the wing is heading cannot be read off the line alone -- asked that way,
   * both wings of every foot looked like they were crossing and every serif in
   * the font disappeared.
   */
  const lines: Array<[number, number]> = [
    [0, 1],
    [metrics.descender, 1],
    [metrics.xHeight, -1],
    [metrics.capHeight, -1],
    [metrics.ascender, -1],
  ];
  /*
   * A wing is in the way when it leaves squarely across a line, which is what
   * an arm lying along one does and what an upright standing on one does not.
   *
   * Asked instead as "does it reach past", the foot of every diagonal went as
   * well, because a bar square to a leaning stroke always dips a little below
   * the line the stroke stands on -- and a serif face that has lost the feet
   * of its A, K, V and X has lost more than it gained. Asked as a distance
   * from the line, it depended on how the serif was proportioned against the
   * pen: the arms of an E sat exactly on the boundary and flickered.
   *
   * Which way the wing leaves does not depend on either, so that is what is
   * asked. Eight tenths is a wing within about a third of a right angle to the
   * line, which takes in every arm and no diagonal in the alphabet.
   */
  return lines.some(
    ([line, inward]) =>
      standingOn(at.y, line, inner) &&
      Math.abs(across.y) > 0.8 &&
      (far - line) * inward < 0,
  );
}

/**
 * Whether a stroke sitting at this height is standing on this line.
 *
 * Asked of the stroke's edge rather than of its spine, because an arm drawn
 * along the cap line has its spine half the arm's own width below it: the two
 * are the same question asked about different things, and only the edge
 * touches. Reaching past the line counts as standing on it, so that a round
 * letter's overshoot does not read as clearance.
 *
 * Asked instead as "is the line within the serif's reach" -- which is what
 * this was -- the answer moved with the pen, because the serif's reach is the
 * pen. The middle arm of a Slab E is 154 units clear of the x-height at every
 * weight; by the Black the reach had grown to 277, so the arm was ruled to be
 * standing on a line it is nowhere near and lost the wing it wears at every
 * other weight. Both sides of this one grow together, which is what makes the
 * answer the same at every weight.
 */
const standingOn = (height: number, line: number, inner: number): boolean =>
  Math.abs(height - line) <= inner + Math.max(1, inner * 0.02);

/** Whether this face has a wave for a flat run to follow. */
function waving(style: Style): boolean {
  const { depth, along } = style.parts.wave;
  return depth > 0 && (along === "flat" || along === "both");
}

/**
 * One wing of a serif, swept rather than drawn.
 *
 * The bar runs out along the line from the middle of the stroke it belongs to,
 * lying wholly on the inside so it can never cross the line the stroke is
 * standing on. Its inner end is buried in the stroke, which is why it can be a
 * plain square cut: there is nothing there to see.
 *
 * Both wings of a foot are built travelling the same way, so both take their
 * wave to the same side and the two halves of the foot are mirror images
 * rather than a wave with a step in the middle of it.
 */
function sweptWing(
  stroke: Stroke,
  style: Style,
  at: Vec2,
  outward: Vec2,
  side: number,
  inner: number,
  tip: number,
  thickness: number,
): Contour[] {
  const into = { x: -outward.x, y: -outward.y };
  // Travelling so that the left of the way it goes is the inside of the
  // letter, because that is the side the wave rides on.
  const along = { x: into.y, y: -into.x };
  const middle = { x: at.x + into.x * (thickness / 2), y: at.y + into.y * (thickness / 2) };
  const reach = Math.max(tip, inner + 1);
  const from = side > 0 ? middle : { x: middle.x - along.x * reach, y: middle.y - along.y * reach };
  const to = side > 0 ? { x: middle.x + along.x * reach, y: middle.y + along.y * reach } : middle;
  const { length, depth, along: where } = style.parts.wave;
  const spine = wavy(
    { segments: [{ kind: "line", from, to }], closed: false },
    length,
    depth,
    thickness / 2,
    where,
  );
  return sweep({
    spine,
    pen: { ...stroke.pen, contrast: 0, weight: thickness },
    start: { kind: "butt" },
    end: { kind: "butt" },
  });
}

/**
 * How thick a stroke really is at the end being serifed, measured across the
 * way it is travelling.
 *
 * Not `penReach(pen).across`, which is the pen at its widest and so is the
 * answer only for a stroke running the one way the pen is widest across. A
 * contrast pen is an ellipse: the arms of an E run the narrow way, and asked
 * for the wide answer the serif on an arm began nineteen units outside the ink
 * it belonged to and floated there. The letter looked right -- a serif a hair
 * clear of an arm reads as attached at text size -- until a cut was made and
 * the arm serifs turned out to be four loose shapes, which is what left a
 * Serif E in six pieces and a Serif F in four.
 *
 * The pen's own support in that direction is the honest answer, and it agrees
 * with the old one wherever the old one was right: on a stroke running the
 * pen's wide way, or on any face with no contrast at all.
 */
function halfWidthAcross(stroke: Stroke, outward: Vec2): number {
  const shift = reachAlong({ x: -outward.y, y: outward.x }, penReach(stroke.pen));
  return Math.hypot(shift.x, shift.y);
}

/**
 * How far a stroke cut level with a line reaches either side of its own end,
 * measured along that line.
 *
 * Not half the pen: a band crossing a line at an angle covers more of the line
 * than it does of itself, and it is the line the serif is being laid along. The
 * two ends of the cut are the stroke's own two edges slid along it until they
 * are level, which is exactly what the sweep draws, so the serif starts where
 * the ink stops rather than a little inside or outside it.
 */
function levelHalfWidth(stroke: Stroke, outward: Vec2): number {
  const shift = reachAlong({ x: -outward.y, y: outward.x }, penReach(stroke.pen));
  return Math.abs(shift.x - (outward.x * shift.y) / outward.y);
}

/**
 * Both ends of a stroke: the terminal, where it is, which way it faces, and
 * whether the run arriving there is straight.
 */
function endsOf(stroke: Stroke): Array<[Terminal, Vec2, Vec2, boolean]> {
  const segments = stroke.spine.segments;
  if (stroke.spine.closed || segments.length === 0) return [];

  // The pieces the run actually begins and ends on, which are not always the
  // first and last: see `endPieces`.
  const { first, last } = endPieces(stroke.spine)!;

  const startPoint = first.kind === "line" ? first.from : onArc(first.centre, first.radius, first.startAngle);
  const endPoint = last.kind === "line" ? last.to : onArc(last.centre, last.radius, last.endAngle);

  const startOut = first.kind === "line"
    ? unit(startPoint, first.to, -1)
    : tangentOnArc(first.startAngle, first.sweepPositive, -1);
  const endOut = last.kind === "line"
    ? unit(last.from, endPoint, 1)
    : tangentOnArc(last.endAngle, last.sweepPositive, 1);

  // Which piece a run ends on and whether it ends straight are two questions:
  // see `endsStraight`. The first is asked of a piece that goes somewhere, the
  // second of the run's own end, stalls and all.
  const straight = endsStraight(stroke.spine);
  return [
    [stroke.start, startPoint, startOut, straight.start],
    [stroke.end, endPoint, endOut, straight.end],
  ];
}

const onArc = (centre: Vec2, radius: number, angle: number): Vec2 => ({
  x: centre.x + radius * Math.cos(angle),
  y: centre.y + radius * Math.sin(angle),
});

function unit(from: Vec2, to: Vec2, way: number): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: (dx / length) * way, y: (dy / length) * way };
}

function tangentOnArc(angle: number, sweepPositive: boolean, way: number): Vec2 {
  const sign = (sweepPositive ? 1 : -1) * way;
  return { x: -Math.sin(angle) * sign, y: Math.cos(angle) * sign };
}

const node = (point: Vec2): GlyphNode => ({ point, handleIn: null, handleOut: null, type: "corner" });

/**
 * How far a serif reaches back into the stroke it is laid on.
 *
 * A serif is a separate shape unioned in afterwards, which is how one is drawn
 * by hand -- and a shape that begins exactly at the edge of the stroke touches
 * it along a line and overlaps it nowhere. Two shapes that share an edge and
 * no area are two shapes: a union cannot join them, so a serif H came back as
 * nine separate solids rather than one letter, and every boolean after that
 * was free to take a serif off. Cutting a Flared L erased it, because the
 * break took the only piece and the rest had never been attached.
 *
 * It reads as one letter either way -- abutting shapes leave no seam under a
 * non-zero fill -- so this was invisible until something asked the letter how
 * many pieces it was in.
 *
 * A share of the wing's own thickness rather than a fixed distance, so it
 * scales with the face and stays well inside the ink at every weight.
 */
const SERIF_BITE = 0.35;

/**
 * One wing of a serif.
 *
 * Worked out in the stroke's own frame -- `across` runs along the end of the
 * stroke and `into` runs back up it -- and then written out in the letter's
 * coordinates, so the same code serifs the foot of a stem, the top of an
 * ascender and the end of an arm without knowing which is which.
 */
function wing(
  at: Vec2,
  outward: Vec2,
  side: number,
  inner: number,
  tip: number,
  thickness: number,
  bracket: number,
): Contour {
  const across = { x: -outward.y * side, y: outward.x * side };
  const into = { x: -outward.x, y: -outward.y };
  const place = (u: number, v: number): Vec2 => ({
    x: at.x + across.x * u + into.x * v,
    y: at.y + across.y * u + into.y * v,
  });

  /*
   * Started inside the stroke rather than at its edge, so the two overlap and
   * a union can join them. Never further in than the spine itself.
   *
   * Bitten against whichever is thicker, the wing or the stroke it sits on.
   * A share of the wing alone is the same thing on a face with no contrast,
   * where the two are much of a size -- but on a Didone the tail is fifty
   * units of half-width and the serif across it is fifteen, so a third of the
   * serif bought five units of overlap where the stroke had fifty to give. Too
   * thin for the union to find, and the lower wing of the Q's tail came away
   * and hung under the letter as a loose bar.
   */
  const held = Math.max(0, inner - Math.max(thickness, inner) * SERIF_BITE);

  const nodes: GlyphNode[] = [
    node(place(held, 0)),
    node(place(tip, 0)),
    node(place(tip, thickness)),
  ];

  if (bracket > 0) {
    /*
     * The fillet: a quarter turn hollowing out the inside corner where the
     * serif meets the stem. Zero bracket leaves that corner square, which is a
     * slab serif; opening it out is what makes a text serif look grown from the
     * stem rather than stuck on it.
     */
    const corner = place(inner + bracket, thickness);
    const meet = place(held, thickness + bracket);
    const handle = 0.5523 * bracket;
    nodes.push({
      point: corner,
      handleIn: null,
      handleOut: {
        x: corner.x - across.x * handle * 1,
        y: corner.y - across.y * handle * 1,
      },
      type: "tangent",
    });
    nodes.push({
      point: meet,
      handleIn: {
        x: meet.x - into.x * handle,
        y: meet.y - into.y * handle,
      },
      handleOut: null,
      type: "tangent",
    });
  } else {
    nodes.push(node(place(held, thickness)));
  }

  return { nodes, closed: true };
}
