/**
 * Drawing a letter from its recipe and the style it belongs to.
 *
 * The strokes are swept and the serifs are laid over them. Overlapping pieces
 * are left overlapping: that is how a serif is drawn by hand, it is invisible
 * under the fill rule font renderers use, and the export already fuses
 * everything before writing a file. Fusing here instead would mean doing
 * boolean geometry on every keystroke to gain nothing anyone can see.
 */

import {
  contourArea,
  contoursBounds,
  inkRuler,
  inkRunsAt,
  polygonContains,
  polygonOf,
  type Polygon,
  reverseContour,
} from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
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
  joiningNow,
  reachesEither,
} from "./letters";
import {
  accentsFor,
  codepointOfAccented,
  gapFor,
  hangsBelow,
  isCapital,
  type Parts,
} from "./accents";
import { reachesCast, type Cast } from "./cast";
import { effectInk, reachesEffects, type Effects } from "./effects";
import { hairlineWeight, risesSteeply, splitVees } from "./letters/humanist";
import { reaches, scaleOf, type Cuts } from "./cut";
import { shapedInk } from "./layers";
import { assemble, gridPen, hasTiles, type Kit, unitOf } from "./kit";
import { thinnedRounds } from "./rounds";
import {
  alongSpine,
  decided,
  endPieces,
  endsStraight,
  hasLength,
  reversed,
  shortened,
  spineLength,
  spinePath,
  bookInUse,
  type Taken,
  waveBookAt,
  wavy,
  writeAgain,
  writing,
} from "./shapes";
import { enclosing, recording as partsRecording, shiftingVees } from "./letters/common";
import { seamsOf, wobbleOf } from "./script";
import { penReach, reachAlong, sweep } from "./sweep";
import {
  BASES,
  blackness,
  capitalled,
  heavier,
  proportioned,
  type Style,
  serifReach,
  spacingOf,
  scriptUnit,
} from "./style";
import type { Spine, Stroke, Terminal } from "./types";

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
  return thinnedRounds(recipe(widthOf(style, name)), style).strokes.map((stroke) => {
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
 * How far this glyph may start left of its own origin, in units: what the
 * face lists in `metrics.overhangs` for it, or for the letter under its mark.
 */
export function overhangOf(name: string, style: Style): number {
  const hangs = style.metrics.overhangs;
  if (!hangs) return 0;
  const parts = builtFrom(name);
  return (hangs[parts ? parts.base : name] ?? 0) * style.metrics.unitsPerEm;
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

/**
 * The style a letter's skeleton is drawn with, at that letter's own width: see
 * `metrics.proportions`. A letter with no entry of its own takes the one of
 * the letter it is built from, so an H-bar is as wide as the H.
 */
function widthOf(style: Style, name: string): Style {
  const table = style.metrics.proportions;
  const owner = table?.[name] !== undefined ? name : decidedBy(name);
  const wide = table ? proportioned(style, owner) : style;
  // A capital's pen, on a face that gives its capitals less contrast.
  return capitalled(wide, owner);
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
  return made ? { contours: made.contours, advanceWidth: made.advanceWidth, cut: made.cut } : null;
}

/**
 * The style a letter on the grid is drawn in: the face's own, with its pen
 * held to what a cell can take (see `gridPen`).
 */
function gridded(style: Style, kit: Kit): Style {
  const base = BASES.find((one) => one.name === style.name);
  const own = base ? { ...style.pen, weight: base.pen.weight } : style.pen;
  const pen = gridPen(style.pen, own, unitOf(style, kit.grid));
  return pen === style.pen ? style : { ...style, pen };
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
  given: Style,
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
  // The style as it is drawn at this weight: see `blackness` in `style.ts`.
  const style = heavier(given);
  // A drawing whose parts are being noted has to be drawn, to be noted.
  if (partsRecording !== null) return drawnFresh(name, style, form, cuts, kit, cast, effects);
  const book = bookInUse();
  const shelf = shelfFor([style, cuts, kit, cast, effects, book]);
  const key = `${name}|${form ?? ""}|${joiningNow()}|${enclosing}|${book?.recording}`;
  const kept = shelf.get(key);
  if (kept) {
    // As a fresh drawing would have: the page opened, and written again.
    waveBookAt(name);
    writeAgain(kept.taken);
    return kept.made;
  }
  const { made, taken } = writing(() => drawnFresh(name, style, form, cuts, kit, cast, effects));
  shelf.set(key, { made, taken });
  return made;
}

/** The vees whose point `landedVees` lands, and which way each points. */
const VEES: Record<string, -1 | 1> = { V: -1, v: -1, "\u0394": 1, "\u039b": 1 };

/**
 * A vee landed on its line by its finished ink, where only the finished letter
 * can say where that is: a written hand's, whose letter is moved and joined
 * after its recipe draws it (the Formal Script's V stood 40 units over the
 * baseline from a pen of 120, and its v at 260 had its point 120 units up,
 * the turn come off a cliff in `corner`), and a text serif's, which takes its
 * vees apart to thin the rising arm (`splitVees`) -- past the Bold only there,
 * run in from nothing at a pen of 194, so the Serif's Lora is as it was.
 * Every other face's vee lands itself: see `veeStroke`.
 *
 * A written letter in the middle of a word is lifted by the hand's own
 * unsteadiness (`wobbleOf`), and lands on its line moved by that.
 */
function landedVees(name: string, style: Style, drawn: (shift: number) => Recipe): Recipe {
  const first = drawn(0);
  const pointing = VEES[name];
  if (!pointing) return first;
  const { script, slab } = style.parts;
  const split = !script.on && style.metrics.risingHairline && slab.on && slab.shape === "wedge";
  if (!script.on && !split) return first;
  const lift =
    script.on && joinEnds(name).entry ? wobbleOf(name, script, style.metrics.xHeight).lift : 0;
  const line = (pointing < 0 ? 0 : style.metrics.capHeight) + lift;
  const miss = (recipe: Recipe) => {
    const box = contoursBounds(inkAll(recipe.strokes, style, name).flat());
    return (pointing < 0 ? box.yMin : box.yMax) - line;
  };
  const was = miss(first);
  if (!Number.isFinite(was)) return first;
  // A written vee hanging past its line is landed whole, however little it
  // hangs; one short of it, from a few units on. Both are nought on the line.
  const past = pointing < 0 ? was < 0 : was > 0;
  const share = script.on
    ? past
      ? 1
      : Math.min(1, Math.max(0, (Math.abs(was) - VEE_LET) / VEE_LET))
    : Math.min(1, Math.max(0, (style.pen.weight - SERIF_BLACK) / (260 - SERIF_BLACK)));
  if (!(share > 0)) return first;
  const wanted = was * (1 - share);
  let shift = 0;
  let best = { recipe: first, off: was - wanted };
  for (let pass = 0; pass < 6 && Math.abs(best.off) >= 0.5; pass++) {
    shift -= best.off;
    const recipe = drawn(shift);
    const off = miss(recipe) - wanted;
    if (!Number.isFinite(off)) break;
    if (Math.abs(off) < Math.abs(best.off)) best = { recipe, off };
    else break;
  }
  return best.recipe;
}

/** How far a vee may miss its line and be left, and over how much more it is landed whole. */
const VEE_LET = 3;
/** The Serif's Black, past which its vees are landed: see `landedVees`. */
const SERIF_BLACK = 194;

/**
 * Letters drawn already, for the letter asked for again with everything that
 * decides it the same.
 *
 * An accented letter is its base drawn again with a mark over it, so a font
 * drew its `a` once for itself and again under each of its accents, and every
 * mark once for each letter wearing it. A letter is a function of its name and
 * form, the style, the cuts, the kit, the cast and the effects, the halves of
 * the join it is drawn without or taking high, whether it is set inside
 * another glyph, and the wave book it is drawn against -- so it is kept
 * against exactly those, the objects by which object they are, and handed back
 * as it was made. Nothing that is handed one changes it.
 *
 * Kept per style, so a style nobody draws with any more takes its letters
 * with it. A book being taken down is written to again as the drawing would
 * have written it: see `writing` in `shapes.ts`.
 */
interface Kept {
  made: Made | null;
  taken: Taken;
}

type Shelves = WeakMap<object, Shelves | Map<string, Kept>>;
const drawnAlready: Shelves = new WeakMap();
/** What stands in for a setting that was not given, as a key. */
const UNGIVEN = {};

function shelfFor(by: Array<object | null | undefined>): Map<string, Kept> {
  let level: Shelves = drawnAlready;
  for (let index = 0; index < by.length - 1; index++) {
    const at = by[index] ?? UNGIVEN;
    let next = level.get(at) as Shelves | undefined;
    if (!next) {
      next = new WeakMap();
      level.set(at, next);
    }
    level = next;
  }
  const last = by[by.length - 1] ?? UNGIVEN;
  let shelf = level.get(last) as Map<string, Kept> | undefined;
  if (!shelf) {
    shelf = new Map();
    level.set(last, shelf);
  }
  return shelf;
}

function drawnFresh(
  name: string,
  style: Style,
  form: string | undefined,
  cuts: Cuts | undefined,
  kit: Kit | undefined,
  cast: Cast | undefined,
  effects: Effects | undefined,
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
  const onGrid = kit?.on && hasTiles(kit, name) ? gridded(style, kit) : null;
  const laid = kit && onGrid ? assemble(kit.glyphs[name], onGrid, kit) : null;
  const recipe = laid ? null : recipeOf(name, form);
  if (!laid && !recipe) return null;
  // Past the Black, a geometric face's rounds thinned at their sides: see `rounds.ts`.
  const drawn = (shift: number): Recipe =>
    shiftingVees(shift, () => thinnedRounds(recipe!(widthOf(style, name)), style));
  const built: Recipe | null = recipe ? landedVees(name, style, drawn) : null;
  const strokes = laid ? laid.strokes : built!.strokes;

  const inked = inkAll(strokes, onGrid ?? style, name);
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
  const seam = seamsOf(script, style.metrics.xHeight, style.pen.weight / 2, scriptUnit(style)).low;
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
  const cutting =
    reaches(cuts, strokes) || reachesCast(cast, strokes)
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
  const marks =
    effects && reachesEffects(effects, strokes)
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
  /*
   * A slanted letter is spaced as it stands upright and then leaned in that
   * space, as an oblique is: the shear about the middle of the x-height keeps
   * the middle of each letter where it was, so the rhythm is the upright's.
   * Spaced off the leaned drawing instead, every letter whose descender swung
   * left past its edge (a g, a y) or whose ascender or bar swung right (an f,
   * a t, an E, a one) took extra room for it, and the line opened into holes
   * beside exactly those letters.
   */
  const upright =
    lean !== 0 && obliqued(style) && !style.metrics.monospaced && !laid && !joinsUp
      ? wobbled(inked.flat())
      : null;
  const measured = upright ?? solid;
  /*
   * And a letter of a face drawn leaning, placed by its leaning ink, never
   * stood back upright past its own origin: where the next letter's ink is
   * at that height, which is how the health check measures a collision (see
   * `leftEdge` in `health.ts`). A bar or a mark standing high on a leaning
   * letter -- the ł's bar, the Ħ's, the Đ's, a free-standing tilde or double
   * acute -- swung back left of the origin by its height times the lean,
   * into the letter before. Only those move: every other letter already
   * stands clear of its origin by more than this.
   *
   * A letter laid on the grid too, to the health check's own line
   * (`SIDE_CLEAR`) and no further, its cells keeping their width: on the
   * Brush and the scripts the grid's accents, the double acute among them,
   * stood in a cell over the cap height and leant back into the letter
   * before.
   */
  const standing =
    lean !== 0 &&
    !upright &&
    !style.metrics.monospaced &&
    !joinsUp &&
    !joinEnds(name).entry &&
    form !== "written" &&
    solid.length > 0
      ? uprightLeft(inked.flat(), style)
      : null;
  const shortfall =
    measured.length > 0 && !joinsUp
      ? Math.max(
          0,
          spacingOf(style) - contoursBounds(measured).xMin,
          standing === null
            ? 0
            : laid
              ? style.metrics.unitsPerEm * SIDE_CLEAR + 1e-6 - standing
              : style.metrics.unitsPerEm * UPRIGHT_CLEAR - standing,
        )
      : 0;
  const placed = slid(cut, shortfall);
  const placedSolid = upright
    ? slid(upright, shortfall)
    : solid === cut
      ? placed
      : slid(solid, shortfall);

  let advanceWidth: number;
  let fittedSides = false;
  /*
   * A monospaced letter keeps the width it was drawn at and is moved to sit in
   * the middle of the common advance. The shapes are not squeezed or stretched
   * to match: they are set in a column and centred there, which is what a
   * monospaced face is. An i in a space made for an m looks lost, and that is
   * the honest answer rather than a fault to be hidden.
   */
  let centring = 0;
  if (style.metrics.monospaced) {
    /*
     * The column is measured off the drawn letters, and a letter laid on the
     * grid can be wider than any of them: the Condensed typewriter's Щ and
     * щ, five cells across, stood past both sides of a column cut for the
     * drawn m. Such a letter is given as much more as keeps it off both
     * edges (`SIDE_CLEAR`); every other keeps the column.
     */
    advanceWidth = monoAdvance(style);
    if (laid && placedSolid.length > 0) {
      const ink = contoursBounds(placedSolid);
      advanceWidth = Math.max(
        advanceWidth,
        ink.xMax - ink.xMin + style.metrics.unitsPerEm * SIDE_CLEAR * 2 + 2e-6,
      );
    }
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
    const sides = fitted(name, built!, placedSolid, style);
    if (sides) {
      fittedSides = true;
      centring = sides.shift;
      advanceWidth = sides.advance;
    } else if (
      FIGURES.includes(name) &&
      built!.width === undefined &&
      style.metrics.figures !== "proportional" &&
      placedSolid.length > 0
    ) {
      /*
       * A tabular figure on a face that is not fitted: in the middle of a
       * column as wide as the widest figure's ink and a sidebearing either
       * side, as a fitted face sets its own. Placed where each was drawn
       * instead, in a column as wide as the furthest any of them reached, the
       * one stood most of a stem left of the nought, and at a Black or an
       * Expanded the whole set sat at the left of a column a third too wide.
       */
      const ink = contoursBounds(placedSolid);
      // And never narrower than this figure, in whatever form it was chosen.
      advanceWidth = Math.max(figureColumnInk(style), ink.xMax - ink.xMin) + spacingOf(style) * 2;
      centring = (advanceWidth - ink.xMin - ink.xMax) / 2;
    } else {
      advanceWidth = advanceFor(name, built!, placedSolid, style);
    }
  }

  /*
   * A capital's extra room, either side. Only where the letter is spaced by
   * its own ink: a monospaced column or a grid cell already says where it goes.
   */
  const extra =
    !style.metrics.monospaced && !laid && !joinsUp && isCapitalLike(name)
      ? spacingOf(style) *
        Math.max(0, (style.metrics.capitalSpacing ?? 1) - 1) *
        (style.metrics.capitalCloses
          ? Math.min(1, spacingOf(style) / style.metrics.sidebearing)
          : 1)
      : 0;
  if (extra > 0) {
    centring += extra;
    advanceWidth += extra * 2;
  }
  /*
   * And a letter that hangs past its side -- the Serif's j, whose tail runs
   * under the letter before it as Lora's does -- hangs as far as the face
   * lets it (`metrics.overhangs`) and no further. Its side is listed in
   * sidebearings like any other, so a face spaced wider (a sidebearing
   * measured off another font, say) hung the tail further back the wider it
   * was, and into the letter before.
   */
  /*
   * And a dash stands off its neighbours by at least two fifths of its own
   * depth (`DASH_SIDE`). Geist and Lora close their dashes with the n, as the
   * fitting does, which at a text weight leaves them a little over half a
   * dash deep either side; at a Black the bar is twice as deep and the white
   * beside it a third less, and "1–9" and "H—H" read as one long bar.
   */
  if (
    DASHES.has(name) &&
    !style.metrics.monospaced &&
    !laid &&
    !joinsUp &&
    placedSolid.length > 0
  ) {
    const ink = contoursBounds(placedSolid);
    const least = (ink.yMax - ink.yMin) * DASH_SIDE;
    const left = least - (ink.xMin + centring);
    if (left > 0) {
      centring += left;
      advanceWidth += left;
    }
    const right = least - (advanceWidth - ink.xMax - centring);
    if (right > 0) advanceWidth += right;
  }
  const hang = fittedSides && placedSolid.length > 0 ? overhangOf(name, style) : 0;
  if (hang > 0) {
    const short = -hang - (contoursBounds(placedSolid).xMin + centring);
    if (short > 0) {
      centring += short;
      advanceWidth += short;
    }
  } else if (fittedSides && lean === 0 && placedSolid.length > 0) {
    /*
     * And a letter that does not hang is never fitted onto its own origin
     * (`SIDE_CLEAR`). The sides the eye sets close in at a Black and close
     * again on a Condensed, and on the Serif's Condensed Black they took the
     * feet of its X and the figure of its one-half past the edge, into the
     * letter before. Only those move: everything else stands clear by more.
     */
    const short =
      style.metrics.unitsPerEm * SIDE_CLEAR - (contoursBounds(placedSolid).xMin + centring);
    if (short > 0) {
      // A hair over, so the sum lands on the near side of the line it is measured against.
      centring += short + 1e-6;
      advanceWidth += short + 1e-6;
    }
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
  // The face's own gap is for the marks over a letter: a cedilla or an
  // ogonek hangs from the foot as close as ever.
  const accents = style.metrics.accents;
  const heavyGap =
    accents?.heavy && accents.heavyAt
      ? ([0, 1].map(
          (i) =>
            accents.gap[i] +
            (accents.heavy![i] - accents.gap[i]) * Math.min(1, blackness(style) / accents.heavyAt!),
        ) as [number, number])
      : accents?.gap;
  const above = gapFor(em, isCapital(parts.base), heavyGap);
  const runs = [...base.runs];
  const contours = [...base.contours];

  for (const markName of parts.marks) {
    // The mark gets the tool's marks too, or an accented letter comes out with
    // a roughened body under a machined accent; and, where the letter is
    // drawn in the face's forms, the face's own form of the mark, or the
    // Sans's à wore the plain sans's grave over Geist's a.
    const mark = makeLetter(
      markName,
      style,
      form === undefined ? undefined : style.forms?.[markName],
      undefined,
      undefined,
      undefined,
      effects,
    );
    if (!mark || mark.contours.length === 0) return null;

    // Measured against everything placed so far, so a second mark stacks on
    // the first rather than landing on top of it.
    const under = contoursBounds(contours);
    const over = contoursBounds(mark.contours);
    const below = hangsBelow(markName);

    // A steep grave or acute set by its foot, where the face asks for that:
    // centred by its whole width, it stood half its lean off the letter.
    const byFoot =
      style.metrics.accents?.byFoot && (markName === "grave" || markName === "acute")
        ? inkRunsAt(mark.contours, over.yMin + 1, "y")
        : [];
    const middle =
      byFoot.length > 0
        ? (byFoot[0][0] + byFoot[byFoot.length - 1][1]) / 2
        : (over.xMin + over.xMax) / 2;
    const move = parts.beside
      ? besideTop(contours, mark.contours, style, isCapital(parts.base), gap)
      : {
          x: (under.xMin + under.xMax) / 2 - middle,
          y: below ? under.yMin - over.yMax - gap : under.yMax - over.yMin + above,
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
  const sidebearing = spacingOf(style);
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
  /*
   * Measured against the letter's own left edge where that stands inside the
   * sidebearing: a face fitted optically sets its O and its v closer than the
   * sidebearing on purpose, and an accent nowhere near that edge is no reason
   * to push the letter back out.
   */
  const edge = Math.min(sidebearing, contoursBounds(base.contours).xMin);
  const shortfall = reaching ? 0 : Math.max(0, edge - bounds.xMin);
  const placed = shortfall > 0 ? shoved(contours, { x: shortfall, y: 0 }) : contours;
  const spaced =
    shortfall > 0
      ? runs.map((run) => ({
          parts: run.parts,
          contours: shoved(run.contours, { x: shortfall, y: 0 }),
        }))
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

/**
 * Where a mark set beside a letter goes (`Parts.beside`): its top on the
 * ascender -- the cap height on a capital -- and clear of the right of the
 * letter's ink at its very top, which is the stem's edge on a d, an l and an
 * L and the top of the stem on a t, over its bar.
 */
function besideTop(
  letter: Contour[],
  mark: Contour[],
  style: Style,
  capital: boolean,
  gap: number,
): Vec2 {
  const under = contoursBounds(letter);
  const over = contoursBounds(mark);
  const band = style.metrics.unitsPerEm * 0.04;
  let right = -Infinity;
  for (const contour of letter) {
    for (const node of contour.nodes) {
      if (node.point.y >= under.yMax - band) right = Math.max(right, node.point.x);
    }
  }
  if (!Number.isFinite(right)) right = under.xMax;
  const top = Math.max(under.yMax, capital ? style.metrics.capHeight : style.metrics.ascender);
  return { x: right + gap * 1.4 - over.xMin, y: top - over.yMax };
}

function shoved(contours: Contour[], by: Vec2): Contour[] {
  return moved(contours, (point) => ({ x: point.x + by.x, y: point.y + by.y }));
}

/**
 * Where a letter's ink starts stood upright, leaving out anything wholly over
 * the ascender, as `leftEdge` in `health.ts` measures it. `inked` is the
 * letter before the lean.
 */
function uprightLeft(inked: Contour[], style: Style): number {
  const { ascender } = style.metrics;
  const among = inked.filter((contour) => contoursBounds([contour]).yMin < ascender);
  return contoursBounds(among.length > 0 ? among : inked).xMin;
}

/** How far a leaning letter stands clear of its origin upright, at the least, in ems. */
const UPRIGHT_CLEAR = 0.01;

/**
 * How far a fitted upright letter that does not hang stands clear of its
 * origin, at the least, in ems: what the health check counts as touching the
 * letter before (`leftEdge` in `health.ts`), and no more.
 */
const SIDE_CLEAR = 0.005;

/** How far a letter leans, as a shear rather than as an angle. */
/**
 * Whether a face is slanted from an upright one -- an oblique, spaced as its
 * upright is -- rather than drawn slanted, as a hand is, whose letters are
 * placed by where their leaning ink falls.
 */
function obliqued(style: Style): boolean {
  const base = BASES.find((one) => one.name === style.name);
  return !base?.metrics.slant;
}

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
  const shortfall = spacingOf(style) - contoursBounds(contours).xMin;
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
 * How much white a side of a letter already has inside its own box, and so how
 * much less it is given outside it: the optical fitting a face asks for with
 * `metrics.fit`.
 *
 * A flat side -- the stem of an n, of an H -- stands right on the edge of its
 * box, and the white beside it is the sidebearing and nothing else. A round
 * side meets its box at one point and leaves wedges of white above and below
 * that; a diagonal leaves a whole triangle. Set all three at the same
 * sidebearing and the round and the pointed letters float apart from their
 * neighbours, which is the oldest problem in spacing and what every foundry
 * answers by spacing its o and its v tighter than its n.
 *
 * Here that is measured rather than tabled. Across the letter's zone -- the
 * x-height for the lowercase, the cap height for the rest -- the distance from
 * the box's edge in to the ink is sampled, each reading held to a limit so a
 * deep bay does not count for more than the eye credits it with, and the mean
 * is how much the side gives back. Against Geist, whose spacing is set by eye,
 * that lands its o at 29 against 33, its v at 51 against 58, its A at 51
 * against 62: the same classes, found from the drawing, so an alternate or a
 * letter somebody has reshaped is spaced by what it now is.
 *
 * Left alone for the figures, which share one width, a letter that sets its
 * own width, and anything too small in its zone to have sides -- a full stop,
 * a quote -- which keeps the plain sidebearing.
 */
/** The dashes, which stand off their neighbours by their own depth: see `drawnFresh`. */
const DASHES = new Set(["endash", "emdash"]);
/** The least white either side of a dash, against its depth. */
const DASH_SIDE = 0.4;

const FIT_LIMIT = 40 / 530;
const FIT_SAMPLES = 32;
/**
 * How much of the white measured is given back. More than all of it, because
 * the zone left out at top and bottom is where a round side has the most.
 */
const FIT_GAIN = 1.8;
/** How far a side's depth changes between two readings to count as an arm. */
const FIT_JUMP = 1.5;
/** The most an arm's side is given back, against the sidebearing. */
const FIT_ARM = 0.45;
/** A proportional figure's sidebearing, against a letter's. */
const FIGURE_SPACING = 0.75;
/** And how much of its white a figure's side gives back, against a letter's. */
const FIGURE_FIT = 0.1;

function fitted(
  name: string,
  recipe: Recipe,
  contours: Contour[],
  style: Style,
): { shift: number; advance: number } | null {
  const fit = style.metrics.fit ?? 0;
  if (fit <= 0 || contours.length === 0) return null;
  if (recipe.width !== undefined) return null;
  const box = contoursBounds(contours);
  // The figures keep their one width, and each is set in the middle of it,
  // which is what a tabular figure is: a one standing at the left of a column
  // made for an eight is a one with a hole after it.
  const figure = FIGURES.includes(name);
  if (figure && style.metrics.figures !== "proportional") {
    const advance = figureInk(style) + spacingOf(style) * FIGURE_SIDES * 2;
    return { shift: (advance - box.xMax - box.xMin) / 2, advance };
  }
  // Opened towards the Thin by the face's own measure (`metrics.lightHeld`),
  // twice that for a figure, as Geist Thin is set.
  const light = style.metrics.lightHeld;
  const opened =
    light?.open && light.from > 30
      ? light.open *
        Math.min(1, Math.max(0, (light.from - style.pen.weight) / (light.from - 30))) *
        (figure ? 2 : 1)
      : 0;
  // The sides the eye sets, where the face lists them: see `metrics.sides`.
  const set = style.metrics.sides?.[name] ?? style.metrics.sides?.[decidedBy(name)];
  if (set) {
    /*
     * And closed at a heavy weight only half as fast as a straight side is:
     * Geist Black's figures and diagonals stand nearly where its Regular's
     * do (its 5 and its v give back six units and one) while its n and H
     * give back twenty.
     */
    const plain = style.metrics.sidebearing;
    const half = plain > 0 ? plain * Math.sqrt(spacingOf(style) / plain) : spacingOf(style);
    // A stem's side, where the entry names one, closes as fast as the n's.
    // One the entry holds keeps the Regular's side at every weight.
    const held = set[2] === "held" ? plain : null;
    const unitLeft =
      held ?? (set[2] === "closes" || set[2] === "stem-left" ? spacingOf(style) : half);
    const unitRight =
      held ?? (set[2] === "closes" || set[2] === "stem-right" ? spacingOf(style) : half);
    const open = set[2] === "unopened" || held !== null ? 0 : opened;
    // And moved at the Thin as far as the entry says, with the light opening.
    const toThin = light?.open && opened > 0 ? opened / (light.open * (figure ? 2 : 1)) : 0;
    const [thinLeft, thinRight] = set[3] ?? [0, 0];
    // And at the Black as far as the entry says, run in with the weight.
    const [blackLeft, blackRight] = set[4] ?? [0, 0];
    const toBlack = set[4] ? Math.min(1, blackness(style) / 0.88) : 0;
    const shift = unitLeft * set[0] + open + thinLeft * toThin + blackLeft * toBlack - box.xMin;
    return {
      shift,
      advance:
        box.xMax + shift + unitRight * set[1] + open + thinRight * toThin + blackRight * toBlack,
    };
  }
  const top = figure || isCapitalLike(name) ? style.metrics.capHeight : style.metrics.xHeight;
  /*
   * The zone with its top and bottom twelfths left out: every shoulder and
   * every bowl turns there, and a flat side that rounds into a crown -- the
   * right of an n, the left of a b -- is still a flat side to the eye.
   */
  const from = Math.max(top / 12, box.yMin);
  const to = Math.min((top * 11) / 12, box.yMax);
  // A proportional figure is set closer than a letter, as figures are: Geist
  // stands its two 60 units off either side, its H 92 and its n 80.
  const spacing = spacingOf(style) * (figure ? FIGURE_SPACING : 1);
  const gain = figure ? FIT_GAIN * FIGURE_FIT : FIT_GAIN;
  const limit = FIT_LIMIT * top;
  let left = 0;
  let right = 0;
  const inkLeft = box.xMin;
  const inkRight = box.xMax;
  /*
   * Whether a side is an arm's rather than a curve's or a diagonal's: its
   * depth jumps, from nothing along the arm to deep beside it, where a round
   * or a slanting side changes a little at every step. An arm stands out
   * into the white beside it and the eye counts that white as the letter's
   * own -- Geist gives its E, L, r and k half what it gives its v -- so an
   * arm's side is given back no more than half the sidebearing.
   */
  let leftJumps = false;
  let rightJumps = false;
  if (to - from >= top * 0.4) {
    let lastLeft = -1;
    let lastRight = -1;
    let leftFlat = 0;
    let rightFlat = 0;
    const runsAt = inkRuler(contours, "y", 16);
    for (let index = 0; index < FIT_SAMPLES; index++) {
      const y = from + ((to - from) * (index + 0.5)) / FIT_SAMPLES;
      const runs = runsAt(y);
      const deepLeft = runs.length === 0 ? limit * 4 : runs[0][0] - inkLeft;
      const deepRight = runs.length === 0 ? limit * 4 : inkRight - runs[runs.length - 1][1];
      if (lastLeft >= 0 && Math.abs(deepLeft - lastLeft) > limit * FIT_JUMP) leftJumps = true;
      if (lastRight >= 0 && Math.abs(deepRight - lastRight) > limit * FIT_JUMP) rightJumps = true;
      lastLeft = deepLeft;
      lastRight = deepRight;
      left += Math.min(deepLeft, limit);
      right += Math.min(deepRight, limit);
      if (deepLeft < 2) leftFlat += 1;
      if (deepRight < 2) rightFlat += 1;
    }
    /*
     * And a side that stands flat on its edge for much of the zone is a stem,
     * however it turns at the top: the right of an n rounds into its shoulder
     * and is spaced as the stem it mostly is.
     */
    left = leftFlat >= FIT_SAMPLES * 0.4 ? 0 : (left / FIT_SAMPLES) * fit * gain;
    right = rightFlat >= FIT_SAMPLES * 0.4 ? 0 : (right / FIT_SAMPLES) * fit * gain;
  } else {
    // A mark with no sides of its own is set as a round letter is.
    left = right = limit * 0.5 * fit;
  }
  // Never closer than a quarter of the plain sidebearing: a v that touched its
  // neighbour would be a kerning pair, not a spacing.
  left = Math.min(left, spacing * (leftJumps ? FIT_ARM : 0.75));
  right = Math.min(right, spacing * (rightJumps ? FIT_ARM : 0.75));
  const shift = spacing - left - inkLeft + opened;
  return { shift, advance: inkRight + shift + spacing - right + opened };
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
    const built = LETTERS[name](widthOf(style, name));
    const contours = insideTheEdge(
      leaning(inkAll(built.strokes, style, name).flat(), style),
      style,
    );
    widest = Math.max(widest, measure(built, contours, style));
  }
  monoCache.set(style, widest);
  return widest;
}

function measure(recipe: Recipe, contours: Contour[], style: Style): number {
  if (contours.length === 0) return spacingOf(style) * 2;
  const trailing = spacingOf(style) * (recipe.round ? ROUND_TIGHTENING : 1);
  return contoursBounds(contours).xMax + trailing;
}

/** The figures are all drawn at the same width, so they need the same lean. */

const figureCache = new WeakMap<Style, number>();

function figureAdvance(style: Style): number {
  const known = figureCache.get(style);
  if (known !== undefined) return known;
  let widest = 0;
  for (const name of FIGURES) {
    const built = LETTERS[name](widthOf(style, name));
    // Nudged inside its own left edge as well, which is what the letters
    // themselves get. Measured without it, the widest figure came out narrower
    // than the letter it was measuring, and the two ran past its own advance.
    const contours = insideTheEdge(
      leaning(inkAll(built.strokes, style, name).flat(), style),
      style,
    );
    widest = Math.max(widest, measure(built, contours, style));
  }
  figureCache.set(style, widest);
  return widest;
}

/**
 * How much of the sidebearing a tabular figure keeps either side of the
 * widest figure, on a face fitted optically: Geist's zero stands 54 units off
 * each side of a column cut for it, on a sidebearing of 80.
 */
const FIGURE_SIDES = 0.68;

const figureInkCache = new WeakMap<Style, number>();

/** The ink width of the widest figure, for a face fitted optically. */
function figureInk(style: Style): number {
  return widestFigure(style, figureInkCache, false);
}

const figureColumnCache = new WeakMap<Style, number>();

/**
 * The same, of the figures in the forms the face draws them in, for the
 * column a face that is not fitted sets each figure in the middle of: the
 * Ribbon's grotesque six is wider than the construction's, and measured off
 * the construction's its column was too narrow to hold it.
 */
function figureColumnInk(style: Style): number {
  return widestFigure(style, figureColumnCache, true);
}

function widestFigure(style: Style, cache: WeakMap<Style, number>, formed: boolean): number {
  const known = cache.get(style);
  if (known !== undefined) return known;
  let widest = 0;
  for (const name of FIGURES) {
    const recipe = formed
      ? (recipeOf(name, style.forms?.[name] ?? "") ?? LETTERS[name])
      : LETTERS[name];
    const built = recipe(widthOf(style, name));
    const contours = leaning(inkAll(built.strokes, style, name).flat(), style);
    if (contours.length === 0) continue;
    const box = contoursBounds(contours);
    widest = Math.max(widest, box.xMax - box.xMin);
  }
  cache.set(style, widest);
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
function inkOf(stroke: Stroke, style: Style, others: Contour[] = []): Contour[] {
  const swept = sweep(stroke);
  return [
    ...swept,
    ...beaksFor(stroke),
    ...ballsFor(stroke, style, swept, others),
    ...flaresFor(stroke, style),
    ...teardropsFor(stroke, swept),
    ...serifsFor(stroke, style, others),
  ];
}

/**
 * The ink of every stroke of a letter, each told where the others are.
 *
 * A serif is the one thing hung on a stroke that has to know about its
 * neighbours: its wings reach sideways along a line, and the next stroke over
 * may be standing on that same line. So every stroke is swept first, and
 * each is inked knowing the swept outlines of all the rest.
 *
 * The letter's name is passed for the two things the strokes cannot say for
 * themselves: whether it is a capital, which never takes a teardrop, and
 * whether it is a lowercase letter, whose stems take a sloped head.
 */
function inkAll(given: Stroke[], style: Style, name = ""): Contour[][] {
  const dressed = given.some((stroke) => stroke.setAs)
    ? dressedSmall(given, style, name)
    : dressedAll(given, style, name);
  const swept = dressed.map((stroke) => sweep(stroke));
  return dressed.map((stroke, index) => {
    const others = swept.flatMap((one, other) => (other === index ? [] : one));
    const as = stroke.setAs;
    if (!as) return inkOf(stroke, style, others);
    // A letter drawn small is inked where it was drawn, on its own lines,
    // with what stands beside it moved there too: see `dressedSmall`.
    return inkOf(
      shiftedStroke(stroke, -as.dx, -as.dy),
      as.style,
      others.map((contour) => shiftedContour(contour, -as.dx, -as.dy)),
    ).map((contour) => shiftedContour(contour, as.dx, as.dy));
  });
}

/** A letter's strokes made ready to ink: thinned where they rise, and their ends dressed. */
function dressedAll(given: Stroke[], style: Style, name: string): Stroke[] {
  const thinned =
    style.metrics.risingHairline && !style.metrics.risingOwn?.includes(decidedBy(name));
  // A text serif's vees drawn in one run are taken apart first, so their
  // rising arms can be thinned too: see `splitVees`.
  const strokes = thinned
    ? (style.parts.slab.on && style.parts.slab.shape === "wedge" ? splitVees(given) : given).map(
        risen,
      )
    : given;
  const capital = isCapitalLike(name);
  const small = !capital && !FIGURES.includes(name);
  const figure = FIGURES.includes(name);
  const lettered =
    name === "" || figure || /^\p{L}$/u.test(decidedBy(name)) || characterOf(name) !== null;
  // The S is the one capital whose foot comes back round to the left and
  // wears a beak there; the J's hook, which does the same, keeps a plain end.
  /*
   * The lowercase s takes the same two beaks, as Lora's and every text s
   * does: a drop on its head and a plain foot read as a c and a hook, and at a
   * black weight the drop filled the upper counter.
   */
  const footBeak = ["S", "\u0405", "s", "\u0455"].includes(decidedBy(name));
  // And which of them stands to the cap height: the S, and the $ drawn from it.
  const tallS = ["S", "\u0405"].includes(decidedBy(name));
  // And the J is the one capital whose hook ends in a drop, as Lora's does:
  // cut plain, its end came to a point under the letter.
  const capitalDrop = capital && ["J", "\u0408"].includes(decidedBy(name));
  /*
   * And a figure's curved ends, and the question mark's, hang a drop wherever
   * they stop -- the head of a 2, both ends of a 3, the hood of a 6 and the
   * tail of a 9 -- as Lora's and every text face's figures do: cut plain, a
   * text face's figures read as a sans's with serifs on their feet.
   */
  const anyDrop = figure || decidedBy(name) === "question";
  return strokes.map((stroke) =>
    dress(
      stroke,
      style,
      small,
      capital,
      lettered ? (figure ? "figure" : "letter") : "other",
      footBeak,
      capitalDrop,
      anyDrop,
      tallS,
    ),
  );
}

/**
 * A straight run rising to the right drawn as a hairline, on a face that asks
 * for it (`metrics.risingHairline`): the thin of the face's own pen, laid
 * round, so it is a hairline at whatever slant it runs.
 */
function risen(stroke: Stroke): Stroke {
  const { segments } = stroke.spine;
  if (stroke.spine.closed || segments.length === 0) return stroke;
  if (segments.some((one) => one.kind !== "line")) return stroke;
  const from = segments[0].kind === "line" ? segments[0].from : null;
  const last = segments[segments.length - 1];
  const to = last.kind === "line" ? last.to : null;
  if (!from || !to) return stroke;
  // One direction all the way: a vee's two arms are one run and keep the pen.
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  const straightOn = segments.every(
    (one) =>
      one.kind === "line" &&
      (Math.hypot(one.to.x - one.from.x, one.to.y - one.from.y) < 1e-6 ||
        Math.abs(Math.sin(Math.atan2(one.to.y - one.from.y, one.to.x - one.from.x) - heading)) <
          1e-3),
  );
  if (!straightOn) return stroke;
  if (!risesSteeply(from, to)) return stroke;
  const thin = hairlineWeight(stroke.pen);
  if (thin >= stroke.pen.weight) return stroke;
  return { ...stroke, pen: { ...stroke.pen, weight: thin, contrast: 0 } };
}

/**
 * `dressedAll` for a glyph some of whose strokes are a letter drawn small:
 * see `Stroke.setAs`. Each such letter's strokes are made ready as that
 * letter at that size -- thinned, and their ends dressed, where it was
 * drawn, on its own lines -- and then moved back to where they stand in the
 * glyph; the rest are made ready as the glyph's own. Handed back in the
 * order given.
 */
function dressedSmall(given: Stroke[], style: Style, name: string): Stroke[] {
  const groups = new Map<string, number[]>();
  given.forEach((stroke, index) => {
    const as = stroke.setAs;
    const key = as ? `${as.name} ${as.dx} ${as.dy}` : "";
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  const dressed: Stroke[][] = given.map(() => []);
  for (const indices of groups.values()) {
    const group = indices.map((index) => given[index]);
    const as = group[0].setAs;
    const done = as
      ? dressedAll(
          group.map((stroke) => shiftedStroke(stroke, -as.dx, -as.dy)),
          as.style,
          as.name,
        ).map((stroke) => shiftedStroke(stroke, as.dx, as.dy))
      : dressedAll(group, style, name);
    /*
     * Dressing can hand back more strokes than it was given: a text serif's
     * vee is taken apart into its two arms first (see `splitVees`). Matched
     * one for one, the second arm fell off the end, and the trade mark's M
     * lost its right diagonal and read as an N. So a group that grew is
     * kept whole, in the place of its first stroke.
     */
    if (done.length === indices.length) {
      indices.forEach((index, at) => {
        dressed[index] = [done[at]];
      });
    } else {
      dressed[indices[0]] = done;
    }
  }
  return dressed.flat();
}

function shiftedContour(contour: Contour, dx: number, dy: number): Contour {
  const point = (p: Vec2): Vec2 => ({ x: p.x + dx, y: p.y + dy });
  return {
    ...contour,
    nodes: contour.nodes.map((node) => ({
      ...node,
      point: point(node.point),
      handleIn: node.handleIn && point(node.handleIn),
      handleOut: node.handleOut && point(node.handleOut),
    })),
  };
}

/** A stroke moved, with the one height its dressed ends carry moved too. */
function shiftedStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  const point = (p: Vec2): Vec2 => ({ x: p.x + dx, y: p.y + dy });
  const spine: Spine = {
    closed: stroke.spine.closed,
    segments: stroke.spine.segments.map((segment) =>
      segment.kind === "line"
        ? { ...segment, from: point(segment.from), to: point(segment.to) }
        : { ...segment, centre: point(segment.centre) },
    ),
  };
  const end = (terminal: Terminal): Terminal =>
    terminal.beak?.bar
      ? {
          ...terminal,
          beak: {
            ...terminal.beak,
            reach: terminal.beak.reach + dy,
            bar: { ...terminal.beak.bar, from: terminal.beak.bar.from + dy },
          },
        }
      : terminal.beak
        ? { ...terminal, beak: { ...terminal.beak, reach: terminal.beak.reach + dy } }
        : terminal;
  return { ...stroke, spine, start: end(stroke.start), end: end(stroke.end) };
}

/**
 * Each end of a stroke made into what it will actually be drawn as.
 *
 * Three decisions that need the finished stroke to make, and so are made here
 * rather than by the recipe:
 *
 * A curved end never wears a serif. A bar laid across the end of a curve sits
 * at whatever angle the curve happened to be travelling and reads as snapped
 * off, so a serif face finishes its curves the way a text face does -- with
 * the face's own terminal -- and until this the serif took every open end and
 * the terminal controls did nothing at all on a serifed face.
 *
 * A teardrop pulls the spine back from its end, so the swelling that closes
 * the end off lands about where the stroke used to stop rather than hanging
 * half a stem past it. Only a curved end takes one; a straight end asked for a
 * teardrop is cut square.
 *
 * And the top of a lowercase stem under a sloped head is cut on a slope, down
 * to the left, so the flag the serif lays there carries on the line the stem
 * was cut along.
 *
 * Every one of these is read off the skeleton -- which way a run ends, which
 * line it stops on -- and none off the pen, so a letter is drawn with the same
 * shapes at every weight.
 */
function dress(
  stroke: Stroke,
  style: Style,
  small: boolean,
  capital: boolean,
  kind: "letter" | "figure" | "other",
  footBeak = false,
  capitalDrop = false,
  anyDrop = false,
  tallS = false,
): Stroke {
  if (stroke.spine.closed || stroke.spine.segments.length === 0) return stroke;
  const straight = endsStraight(stroke.spine);
  const ends = endsOf(stroke);
  let pullStart = 0;
  let pullEnd = 0;
  const made = (terminal: Terminal, index: 0 | 1): Terminal => {
    const [, at, outward] = ends[index];
    const isStraight = index === 0 ? straight.start : straight.end;
    let end = terminal;
    /*
     * A level finish is a plain cut, laid along the nearer of the two lines
     * the letter is built on: see `Terminal.aligned`. Only on an end that is
     * seen -- one buried in another stroke is cut square as it always was.
     */
    if (end.kind === "level") {
      const { kind: _, angle: __, ...rest } = end;
      // A straight end already square to one of the lines is a plain cut:
      // there is nothing to slide, and sliding nothing still costs the side
      // the node it stands in for.
      const square = isStraight && (Math.abs(outward.x) < 1e-6 || Math.abs(outward.y) < 1e-6);
      end =
        end.open === true && !square
          ? { ...rest, kind: "butt", aligned: true }
          : { ...rest, kind: "butt" };
    }
    if (end.kind === "slab" && !isStraight) {
      const curved = end.curved ?? { kind: "butt", angle: 0 };
      /*
       * A plain cut is left as the serif it was, which `serifsFor` already
       * refuses on a curve and draws as a sliver buried in the stroke: the same
       * drawing, and the same shapes every weight has always been drawn with.
       */
      if (curved.kind !== "butt") end = { kind: curved.kind, angle: curved.angle, open: end.open };
    }
    /*
     * A capital's curved end on a face with text serifs wears a beak: the top
     * of a C, a G and an S, and the foot of an S where it comes back round to
     * the left. Not the foot of a C, which Lora and every face like it leave
     * as a plain cut, and no lowercase letter but the s, whose ends take the drop.
     */
    if (
      (capital || footBeak) &&
      !isStraight &&
      terminal.kind === "slab" &&
      terminal.shape === "wedge" &&
      terminal.open === true
    ) {
      const spine = index === 1 ? stroke.spine : reversed(stroke.spine);
      const curve = insideOfCurve(spine, at);
      const top = curve !== null && curve.toward.y < -0.25;
      const foot = footBeak && curve !== null && curve.toward.y > 0.25 && outward.x < -0.2;
      // An S's beaks hang from the cap height, and so do a $'s drawn from it.
      const tall = capital || (tallS && footBeak);
      const height = tall ? style.metrics.capHeight : style.metrics.xHeight;
      if (decided(top || foot)) {
        return {
          kind: "butt",
          open: true,
          beak: {
            reach: top ? height * (1 - BEAK) : height * BEAK,
            way: top ? -1 : 1,
            /*
             * The s's and the S's as Lora's: an upright bar from the line to
             * the beak's depth, the curve running into its inside, where a
             * wedge off the end read as a blob. Lora's are about half a stem
             * across, at the Regular and the Bold.
             */
            bar: footBeak
              ? {
                  // Past the Bold gaining only a third of what the pen does,
                  // or a Black's were blocks closing the counters.
                  width:
                    (tall ? S_BAR : S_BAR_SMALL) *
                    Math.min(
                      stroke.pen.weight,
                      boldPen(style) + (stroke.pen.weight - boldPen(style)) / 3,
                    ),
                  from: top ? height + style.metrics.overshoot : 0,
                }
              : undefined,
          },
        };
      }
    }
    if (end.kind === "teardrop") {
      if (isStraight || end.open !== true) return { ...end, kind: "butt" };
      const spine = index === 1 ? stroke.spine : reversed(stroke.spine);
      const curve = insideOfCurve(spine, at);
      /*
       * Only where the drop hangs: on an end whose curve turns back down
       * beneath it -- the top of a c or an a, the hook of an f, the arm of an
       * r -- or on a tail below the line, as on a j or a y. An end curling up
       * off the baseline, as the foot of a c, an e or a t does, is left plain,
       * and so is every capital: a drop there reads as a blot.
       *
       * Asked of the book, because which way a curve turns is the skeleton's
       * business but the skeleton moves with the pen, and a drop that came and
       * went along the weight axis would leave a letter the axis cannot follow.
       */
      const hangs =
        ((capitalDrop || anyDrop) && curve !== null) ||
        (!capital &&
          curve !== null &&
          (curve.toward.y < -0.25 || at.y < style.metrics.descender * 0.4));
      // Not hung, the end is what it would have been with a plain cut asked
      // for: on a serif face, the serif refused on a curve.
      if (!decided(hangs)) return terminal.kind === "slab" ? terminal : { ...end, kind: "butt" };
      const bend = curve?.radius ?? 0;
      const radius = dropRadius(stroke, style, outward, bend);
      const toward = curve?.toward ?? { x: -outward.y, y: outward.x };
      const side = outward.x * toward.y - outward.y * toward.x > 0 ? 1 : -1;
      // Pulled back by a share of what the drop adds beyond the stroke's own
      // width, so a drop with no room to swell is not a shorter stroke.
      /*
       * Except a tail heading down into the descender -- the hook of a zeta, a
       * xi or a final sigma with no room left to turn -- which is pulled back
       * by as much of the drop as would reach past the descender's overshoot.
       * At a heavy weight it hung twenty-seven units below the descender.
       */
      const pull =
        outward.y < -0.7
          ? Math.max(
              0,
              dropOvershoot(stroke, outward, side, radius) -
                (at.y - (style.metrics.descender - style.metrics.overshoot)),
            )
          : TEAR_PULL * Math.max(0, radius - halfWidthAcross(stroke, outward));
      if (index === 0) pullStart = pull;
      else pullEnd = pull;
      return { ...end, drop: { radius, bend, side } };
    }
    const { metrics } = style;
    const lines = [0, metrics.xHeight, metrics.capHeight, metrics.ascender, metrics.descender];
    const onLine = lines.some((line) => Math.abs(at.y - line) < 1);
    /*
     * A serif goes where a stroke stops on a line, or at the end of an arm
     * lying along one -- the beak on an E, a T, a Z. A stroke that stops in
     * mid-air at an angle is not finished with a bar: the neck of a question
     * mark, the flag of a one and the tail of an ampersand came out with two
     * loose wings each. Nor is anything but a letter or a figure: an
     * exclamation mark wearing serifs is an I. And a figure only stands on
     * serifs, as the one and the four do: the top of a four's stem and the end
     * of its bar are plain in every text face.
     */
    const serifed =
      kind === "letter"
        ? onLine || Math.abs(outward.y) <= 0.35
        : kind === "figure" &&
          ((Math.abs(at.y) < 1 && outward.y < -0.9) ||
            // And a text serif's beak on a figure's arm lying along a line, its
            // edge on the line, as Lora's seven, two and five end.
            (end.kind === "slab" &&
              end.shape === "wedge" &&
              Math.abs(outward.y) <= 0.35 &&
              lines.some((line) => Math.abs(at.y - line) <= halfWidthAcross(stroke, outward) + 1)));
    /*
     * Refused a serif, a straight end is still cut the way it would have been
     * with one: level on the line it stops on, or square across an arm. Cut
     * with the pen instead, the top of a four's stem leaned off the cap line
     * and the end of its bar leaned with it.
     */
    if (end.kind === "slab" && isStraight && !serifed) end = { ...end, bare: true };
    /*
     * Which leaves the uprights: a serif on one, and a plain cut on one where
     * the pen is held at an angle -- the top of a T's stem under its arm,
     * where a cut leaning with the pen stood nine units over the cap line.
     */
    const cuttable =
      end.kind === "slab" || (end.kind === "butt" && style.parts.slab.on && style.pen.angle !== 0);
    /*
     * The end of an arm wearing a beak is cut square across the arm, so the
     * beak's upright outside and the arm's end are one edge.
     */
    if (end.kind === "slab" && isStraight && !end.level && Math.abs(outward.y) < 1e-3) {
      return { ...end, level: true };
    }
    if (!cuttable || !isStraight || end.level || Math.abs(outward.x) > 0.02) return end;
    if (!onLine) return end;
    if (
      end.kind === "slab" &&
      end.head === "sloped" &&
      !end.bare &&
      small &&
      outward.y > 0 &&
      [metrics.xHeight, metrics.ascender].some((line) => Math.abs(at.y - line) < 1)
    ) {
      const inner = levelHalfWidth(stroke, outward);
      return { ...end, level: true, sink: headSlope(style) * 2 * inner };
    }
    /*
     * And under a flag head, the same top with the serif's right wing left off:
     * Rockwell's, Courier's and every slab's l, i, h, k and n. Laid both ways
     * there, the Slab's l and I were the same letter.
     */
    if (
      end.kind === "slab" &&
      end.head === "flag" &&
      !end.bare &&
      small &&
      outward.y > 0 &&
      [metrics.xHeight, metrics.ascender].some((line) => Math.abs(at.y - line) < 1)
    ) {
      return { ...end, level: true, flag: true };
    }
    /*
     * An upright standing on a line is cut along the line. Square to the stroke
     * is the same thing on a pen held straight, but a pen held at an angle
     * leans its cut with it, and a serifed stem then stood on one corner a few
     * units through the baseline with the other a few units short of it.
     */
    return { ...end, level: true };
  };
  const start = made(stroke.start, 0);
  const end = made(stroke.end, 1);
  if (start === stroke.start && end === stroke.end) return rounded(stroke, straight);
  const spine =
    pullStart > 0 || pullEnd > 0 ? pulledBack(stroke.spine, pullStart, pullEnd) : stroke.spine;
  return rounded({ ...stroke, spine, start, end }, straight);
}

/**
 * A run pulled back from its ends, drawn in the same pieces it was before.
 *
 * An arc is cut into as many quarter turns as its sweep needs, so an arc
 * shortened past a right angle comes off the pen with one piece fewer -- and
 * how far a drop pulls a run back is a share of the pen, so a j's tail was
 * drawn in two pieces at the Regular and three at the Bold, which is a letter
 * the weight axis cannot follow. Each arc keeps the count it had.
 */
function pulledBack(spine: Spine, fromStart: number, fromEnd: number): Spine {
  const pulled = shortened(spine, fromStart, fromEnd);
  if (pulled.segments.length !== spine.segments.length) return pulled;
  return {
    ...pulled,
    segments: pulled.segments.map((segment, index) => {
      const was = spine.segments[index];
      if (segment.kind !== "arc" || was.kind !== "arc" || segment.pieces !== undefined) {
        return segment;
      }
      const sweep = Math.abs(was.endAngle - was.startAngle);
      return { ...segment, pieces: Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9)) };
    }),
  };
}

/**
 * A round cap on a curved end, pulled back only as far as it has to be.
 *
 * A round cap adds half a pen past the end of the stroke, and on a straight
 * run that is taken back off the run before it is drawn -- see `capped`. On a
 * curve it is left alone, because the curl is what the face is drawn with and
 * pulling it back cost the hook of an f the top of its arc. But a heavy pen on
 * a tight letter has no room for the extra half pen at all: the end of an e's
 * bowl came back round through its own bar and the outline crossed itself. So
 * where the cap would do that -- and only there -- the curve is pulled back,
 * by as little as clears it.
 */
function rounded(stroke: Stroke, straight: { start: boolean; end: boolean }): Stroke {
  const crosses = (candidate: Stroke) => sweep(candidate).some((one) => contoursIntersect([one]));
  /*
   * And an angled cut on a curved end, turned back toward square only as far
   * as it has to be. On a curve the cut carries one corner on past the end by
   * the whole of its slide (see `terminalNodes` in `sweep.ts`), and at a black
   * weight that is a hundred units: the hook of an s reached into its own
   * spine. Halved until it clears, and never to nothing, so the end is drawn
   * with the same corners at every weight.
   */
  const startAngled = stroke.start.kind === "angled" && !straight.start && !!stroke.start.angle;
  const endAngled = stroke.end.kind === "angled" && !straight.end && !!stroke.end.angle;
  if (startAngled || endAngled) {
    let turned = stroke;
    const scaled = (by: number): Stroke => {
      const turn = (terminal: Terminal, on: boolean): Terminal =>
        on ? { ...terminal, angle: (terminal.angle ?? 0) * by } : terminal;
      return {
        ...stroke,
        start: turn(stroke.start, startAngled),
        end: turn(stroke.end, endAngled),
      };
    };
    for (const by of [0.5, 0.25, 0.125, 0.0625]) {
      if (!crosses(turned)) break;
      turned = scaled(by);
    }
    /*
     * A run with no room at its end for any slant at all -- an s at a black
     * weight whose inner edge has closed to a point beside the cut -- is cut
     * square. The only one of these that changes how many corners the end has,
     * and it only happens where the letter has already run out of room.
     */
    stroke = crosses(turned) ? scaled(0) : turned;
  }
  const anyRound = stroke.start.kind === "round" || stroke.end.kind === "round";
  if (!anyRound || !crosses(stroke)) return stroke;
  const startRound = stroke.start.kind === "round" && !straight.start;
  const endRound = stroke.end.kind === "round" && !straight.end;
  const half = penReach(stroke.pen).across;
  if (startRound || endRound) {
    for (const share of [0.5, 1, 1.5, 2]) {
      const pulled = {
        ...stroke,
        spine: pulledBack(stroke.spine, startRound ? half * share : 0, endRound ? half * share : 0),
      };
      if (!crosses(pulled)) return pulled;
    }
  }
  /*
   * And a run too short for its caps at all -- the two arms of a guillemet at
   * a black weight, whose caps meet each other in the middle -- is cut square
   * instead. Like the square fallback for a slant, it only happens where the
   * letter has run out of room.
   */
  const square = (terminal: Terminal): Terminal =>
    terminal.kind === "round" ? { ...terminal, kind: "butt" } : terminal;
  return { ...stroke, start: square(stroke.start), end: square(stroke.end) };
}

/** A capital in any script: a letter that is its own upper case and has a lower one. */
function isCapitalLike(name: string): boolean {
  if (isCapital(name) || SET_AS_CAPITALS.has(name)) return true;
  const one = [...name].length === 1 ? name : characterOf(name);
  return one !== null && one.toUpperCase() === one && one.toLowerCase() !== one;
}

/**
 * The symbols made of capitals, which are spaced and finished as capitals: the
 * trade mark is a small T and M, and Geist sets it as far off either side as
 * its H (92 units). Finished as a lowercase letter instead, a joined face gave
 * its small T and M the ends of a lowercase stem at the light weights and not
 * at the heavy ones, and the sign changed its points along the weight axis.
 */
const SET_AS_CAPITALS = new Set(["trademark"]);

/** Letters drawn under a name the accented tables do not carry. */
const OTHER_LETTERS: Record<string, number> = { dotlessj: 0x237 };

/**
 * The letter a glyph drawn outright under a name of its own stands for: the
 * H-bar for `Hbar`, the ash for `ae`, the eszett for `germandbls`.
 *
 * Asked by the two decisions a letter's name makes for its strokes -- whether
 * it wears serifs, and whether it is a capital -- which read a single
 * character. Named, the Latin letters with no decomposition were neither:
 * a Slab set a bare Ħ beside a serifed H, a bare Æ beside a serifed E, and
 * took its Ħ for a lowercase letter.
 */
function characterOf(name: string): string | null {
  // The dotless j is Extended-B's, and not a letter any accent is built on
  // there: named only here, it was drawn bare beside a serifed j.
  const code = codepointOfAccented(name) ?? OTHER_LETTERS[name] ?? null;
  if (code === null) return null;
  const one = String.fromCodePoint(code);
  return /^\p{L}$/u.test(one) ? one : null;
}

/**
 * How big a teardrop is.
 *
 * Grown with the pen, but more slowly than the pen: a drop half a stem across
 * on a hairline is lost, and one twice the regular's on a black fills the
 * counter it hangs into. So it is counted from the geometric mean of the stem
 * and a tenth of the em, which is the stem itself at a text weight.
 *
 * And never more than the curve it finishes has room for: the drop hangs into
 * the inside of that curve, and past about half of what is left of the
 * counter across it, it meets whatever is on the other side.
 */
function dropRadius(stroke: Stroke, style: Style, outward: Vec2, curve: number): number {
  const stem = style.pen.weight;
  const h = halfWidthAcross(stroke, outward);
  const wanted = TEAR_SIZE * Math.sqrt(stem * style.metrics.unitsPerEm * 0.1);
  const room = curve > 0 ? h + 0.45 * Math.max(0, curve - 2 * h) : wanted;
  return Math.max(h, Math.min(wanted, room));
}

/**
 * How steeply the top of a lowercase stem falls away to the left under a
 * sloped head: a little under seventeen degrees, which is about where a broad
 * nib entering the stroke leaves it.
 */
const HEAD_SLOPE = 0.3;

/**
 * The slope a head is cut at under this pen: the nib's own through the text
 * weights, and flatter past them, by as much as the serif grows more slowly
 * than the stem (see `serifReach`). Held at the text slope, a black stem's head
 * fell away sixty units across its own width and the flag carried on down
 * another ninety, and the top of every n, i and l was a wedge.
 */
function headSlope(style: Style): number {
  // The nib's slope, however long the face holds its serifs: see `Parts.slab.hold`.
  return HEAD_SLOPE * Math.min(1, serifReach(style, true) / Math.max(style.pen.weight, 1e-9));
}

/**
 * How far past the end of its stroke a drop reaches, along the way the stroke
 * is going: the same arithmetic `teardropsFor` lays the drop out with, asked
 * before the stroke is pulled back to make room for it.
 */
function dropOvershoot(stroke: Stroke, u: Vec2, side: number, radius: number): number {
  const n = { x: -u.y * side, y: u.x * side };
  const shift = reachAlong({ x: -u.y, y: u.x }, penReach(stroke.pen));
  const lean = shift.x * n.x + shift.y * n.y;
  const outer = lean < 0 ? shift : { x: -shift.x, y: -shift.y };
  const h = Math.abs(lean);
  const t = outer.x * u.x + outer.y * u.y;
  const least = (t * t + h * h) / Math.max(h, 1e-6) + 0.5;
  /*
   * Heading straight down, the drop always reaches below the stroke it hangs
   * on, so `teardropsFor` shrinks it to the least that holds the end's two
   * corners -- and that is what it reaches past the end by.
   */
  return Math.max(0, t + (u.y < -0.7 ? least : Math.max(radius, least)));
}

/** A teardrop's radius, in stems. */
const TEAR_SIZE = 0.56;

/**
 * How much of what the drop swells by the stroke is pulled back to make room
 * for it.
 */
const TEAR_PULL = 0.6;

/**
 * The teardrops on one stroke: a curved end swelling into a pear on the inside
 * of its curve.
 *
 * Drawn as one shape laid over the end, like everything else that is hung on a
 * stroke. Its outer side is a circle standing on the stroke's own outside edge,
 * touching it exactly at the end of the stroke, so the outside of the curve
 * runs on into the drop without a step. Its inner side falls back to the
 * stroke's inside edge along one smooth curve, meeting that edge a couple of
 * radii back and running along it there, so the stroke thickens into the drop
 * rather than having a disc stuck on it. The rest of the outline is buried in
 * ink the stroke has already laid down.
 *
 * Always the same five nodes. Where there is no room for the drop -- a heavy
 * pen in a tight aperture -- it shrinks to the stroke's own width rather than
 * going, so the letter is drawn with the same shapes at every weight.
 */
function teardropsFor(stroke: Stroke, swept: Contour[]): Contour[] {
  if (stroke.spine.closed || swept.length === 0) return [];
  const out: Contour[] = [];
  const band = contoursBounds(swept);
  const reach = penReach(stroke.pen);
  const ends = endsOf(stroke);
  for (const index of [0, 1] as const) {
    const [terminal, at, outward] = ends[index];
    if (terminal.kind !== "teardrop" || terminal.open !== true) continue;
    const spine = index === 1 ? stroke.spine : reversed(stroke.spine);
    const drop = terminal.drop;
    if (!drop) continue;
    const u = outward;
    // The inside of the curve, square to the way the stroke is going.
    const side = drop.side;
    const n = { x: -u.y * side, y: u.x * side };
    const shift = reachAlong({ x: -u.y, y: u.x }, reach);
    const lean = shift.x * n.x + shift.y * n.y;
    // The corner on the outside of the curve, where the drop stands.
    const outer = lean < 0 ? shift : { x: -shift.x, y: -shift.y };
    const h = Math.abs(lean);
    const t = outer.x * u.x + outer.y * u.y;
    // Round enough to take both corners of the end inside it.
    const least = (t * t + h * h) / Math.max(h, 1e-6) + 0.5;
    const bend = drop.bend > 0 ? drop.bend : drop.radius * 4;
    let radius = Math.max(drop.radius, least);
    let shape = tear(stroke, spine, at, u, n, outer, radius, bend);
    for (let tries = 0; tries < 8 && !within(shape, band); tries++) {
      radius = Math.max(least, radius * 0.82);
      shape = tear(stroke, spine, at, u, n, outer, radius, bend);
    }
    if (!within(shape, band)) {
      radius = least;
      shape = tear(stroke, spine, at, u, n, outer, least, bend);
    }
    /*
     * And never one that crosses itself: on a hairline of a very high
     * contrast, the neck the drop leaves the stroke by is so narrow that the
     * curve out of it rose over the drop's own closing edge -- the Serif's c
     * at a contrast of 0.9 past a Black. Drawn again until it does not, and
     * only taken again where it does not and still keeps to the stroke's
     * band; a drop that already did not is left as it was.
     */
    const kept = radius;
    // Asked of the drop as it will be stored, on the unit grid: a crossing
    // too slight to see in the drawing is still one once rounded.
    const folds = (drop: Contour) =>
      contoursIntersect([
        {
          ...drop,
          nodes: drop.nodes.map((one) => ({
            ...one,
            point: { x: Math.round(one.point.x), y: Math.round(one.point.y) },
            handleIn: one.handleIn && {
              x: Math.round(one.handleIn.x),
              y: Math.round(one.handleIn.y),
            },
            handleOut: one.handleOut && {
              x: Math.round(one.handleOut.x),
              y: Math.round(one.handleOut.y),
            },
          })),
        },
      ]) || contoursIntersect([drop]);
    const again: Array<[number, boolean]> = [
      // The tail left the stroke less steeply, then closed back onto its own
      // foot, whose edge it cannot then rise over.
      [0.2, false],
      [0.1, false],
      [0, false],
      [0.3, true],
      [0, true],
    ];
    const clean = (drop: Contour) => !folds(drop) && within(drop, band);
    if (folds(shape)) {
      const tries = [
        ...again.map(
          ([pull, close]) =>
            () =>
              tear(stroke, spine, at, u, n, outer, kept, bend, pull, close),
        ),
        // And failing both, taken smaller.
        ...[1, 2, 3, 4, 5, 6].map(
          (k) => () => tear(stroke, spine, at, u, n, outer, Math.max(least, kept * 0.9 ** k), bend),
        ),
      ];
      for (const attempt of tries) {
        const next = attempt();
        if (clean(next)) {
          shape = next;
          break;
        }
      }
    }
    out.push(contourArea(shape) < 0 ? reverseContour(shape) : shape);
  }
  return out;
}

/**
 * Where a capital's curved beak stops, as a share of the cap height from the
 * line it hangs from. Lora's C, G and S beaks all run about three tenths of the
 * cap height down from the top of the letter, or up from the foot.
 */
const BEAK = 0.3;

/** How wide the S's beaks are drawn as bars, against its pen: Lora's are 50 on 87. */
const S_BAR = 0.56;
/** And the s's: Lora's are 40 on 87, and 76 on 142. */
const S_BAR_SMALL = 0.5;

/** The pen of Lora's Bold, 142 on an x-height of 500, on this face. */
function boldPen(style: Style): number {
  return (142 * style.metrics.xHeight) / 500;
}

/**
 * The beaks on one stroke: an upright wedge off a curved end.
 *
 * Its outside is a straight upright line down (or up) from the end's outer
 * corner, which is what makes it read as a beak rather than as a drop: the
 * curve stops and the letter falls away square. Its inside comes back up from
 * the tip in one hollow curve to the end's inner corner, so the stroke
 * thickens into it. Always the same four nodes, and the rest of it is buried
 * in the stroke.
 */
function beaksFor(stroke: Stroke): Contour[] {
  if (stroke.spine.closed) return [];
  const out: Contour[] = [];
  const ends = endsOf(stroke);
  for (const index of [0, 1] as const) {
    const [terminal, at, u] = ends[index];
    const beak = terminal.beak;
    if (!beak) continue;
    const spine = index === 1 ? stroke.spine : reversed(stroke.spine);
    const curve = insideOfCurve(spine, at);
    if (!curve) continue;
    const shift = reachAlong({ x: -u.y, y: u.x }, penReach(stroke.pen));
    const a = { x: at.x + shift.x, y: at.y + shift.y };
    const b = { x: at.x - shift.x, y: at.y - shift.y };
    const outer = shift.x * curve.toward.x + shift.y * curve.toward.y < 0 ? a : b;
    const width = Math.hypot(shift.x, shift.y) * 2;
    // To the height asked for, and never less than most of a stroke past the
    // corner it leaves from.
    const tipY =
      beak.way < 0
        ? Math.min(beak.reach, outer.y - width * 0.8)
        : Math.max(beak.reach, outer.y + width * 0.8);
    const tip = { x: outer.x, y: tipY };
    if (beak.bar) {
      // An upright bar from the line to the tip, standing inside the
      // letter from the end's outer corner: the same four nodes.
      const inward = curve.toward.x < 0 ? -1 : 1;
      const x = outer.x;
      const x2 = outer.x + inward * beak.bar.width;
      const bar: Contour = {
        nodes: [
          node({ x, y: beak.bar.from }),
          node({ x, y: tipY }),
          node({ x: x2, y: tipY }),
          node({ x: x2, y: beak.bar.from }),
        ],
        closed: true,
      };
      out.push(contourArea(bar) < 0 ? reverseContour(bar) : bar);
      continue;
    }
    /*
     * The inside is one hollow curve from the tip back to the end's inner
     * corner: leaving the tip upright and arriving at the corner along the
     * stroke's own inner edge, so the stroke runs on into the beak without a
     * step. Its handles are held short of the upright, so it can never cross
     * it, and it arrives at the corner rather than somewhere back round the
     * curve, where a heavy stroke's inner corner stood out past it as a spike.
     */
    const inner = outer === a ? b : a;
    /*
     * Closed through a point back inside the stroke rather than through the
     * end of its spine: closed along the end's own cut, the beak and the
     * stroke only met edge to edge there, and a renderer drew the seam
     * between them as a hairline of white.
     */
    const within = { x: at.x - u.x * width * 0.5, y: at.y - u.y * width * 0.5 };
    const shape = beakShape(outer, tip, inner, within, u);
    /*
     * At the limit of the weight axis the inner corner can come round past the
     * upright, and the beak would fold. It is then drawn as a speck buried in
     * the stroke a little back from its end: the same four nodes.
     */
    const back = { x: at.x - u.x * 3, y: at.y - u.y * 3 };
    const kept = contoursIntersect([shape])
      ? {
          nodes: [
            node(back),
            node({ x: back.x + 1, y: back.y }),
            node({ x: back.x + 1, y: back.y + 1 }),
            node({ x: back.x, y: back.y + 1 }),
          ],
          closed: true,
        }
      : shape;
    out.push(contourArea(kept) < 0 ? reverseContour(kept) : kept);
  }
  return out;
}

/** The four nodes of a beak: see `beaksFor`. */
function beakShape(outer: Vec2, tip: Vec2, inner: Vec2, at: Vec2, u: Vec2): Contour {
  const across = tip.x - inner.x;
  const rise = inner.y - tip.y;
  const run = Math.hypot(across, rise);
  const along = u.x * across > 1e-6 ? Math.min(run * 0.45, (0.8 * across) / u.x) : run * 0.45;
  return {
    nodes: [
      node(outer),
      {
        point: tip,
        handleIn: null,
        handleOut: { x: tip.x, y: tip.y + rise * 0.5 },
        type: "corner",
      },
      {
        point: inner,
        handleIn: { x: inner.x + u.x * along, y: inner.y + u.y * along },
        handleOut: null,
        type: "corner",
      },
      node(at),
    ],
    closed: true,
  };
}

/** Whether a shape stays between the top and bottom of the stroke it is hung on. */
function within(shape: Contour, band: { yMin: number; yMax: number }): boolean {
  const bounds = contoursBounds([shape]);
  return bounds.yMax <= band.yMax + 1 && bounds.yMin >= band.yMin - 1;
}

/**
 * Which way the inside of the curve is, from the end of a run: toward the
 * centre of the last piece that turns.
 */
function insideOfCurve(spine: Spine, at: Vec2): { toward: Vec2; radius: number } | null {
  for (let index = spine.segments.length - 1; index >= 0; index--) {
    const segment = spine.segments[index];
    /*
     * A turn standing still counts: a tail that hooks only where there is room
     * to hook keeps its hook at a black weight as a piece of no sweep, and the
     * side it would have turned to is still the side the drop hangs on -- asked
     * of the pieces that move instead, the drop came and went along the axis.
     */
    if (segment.kind === "line" && hasLength(segment)) return null;
    if (segment.kind !== "arc" || segment.radius < 1e-6) continue;
    const dx = segment.centre.x - at.x;
    const dy = segment.centre.y - at.y;
    const length = Math.hypot(dx, dy);
    return length > 1e-6
      ? { toward: { x: dx / length, y: dy / length }, radius: segment.radius }
      : null;
  }
  return null;
}

/**
 * The point on a run so far back from its end, and which way the run is
 * travelling there.
 */
function backFromEnd(spine: Spine, distance: number): { point: Vec2; heading: Vec2 } {
  let left = distance;
  const segments = spine.segments;
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    const length =
      segment.kind === "line"
        ? Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y)
        : segment.radius * Math.abs(segment.endAngle - segment.startAngle);
    if (length < 1e-9) continue;
    const share = index === 0 ? Math.min(1, left / length) : left / length;
    if (share <= 1) {
      if (segment.kind === "line") {
        const heading = unit(segment.from, segment.to, 1);
        return {
          point: {
            x: segment.to.x - (segment.to.x - segment.from.x) * share,
            y: segment.to.y - (segment.to.y - segment.from.y) * share,
          },
          heading,
        };
      }
      const angle = segment.endAngle - (segment.endAngle - segment.startAngle) * share;
      return {
        point: onArc(segment.centre, segment.radius, angle),
        heading: tangentOnArc(angle, segment.sweepPositive, 1),
      };
    }
    left -= length;
  }
  const first = segments[0];
  return first.kind === "line"
    ? { point: first.from, heading: unit(first.from, first.to, 1) }
    : {
        point: onArc(first.centre, first.radius, first.startAngle),
        heading: tangentOnArc(first.startAngle, first.sweepPositive, 1),
      };
}

/**
 * One teardrop, worked out in the frame of the end it finishes: `u` the way the
 * stroke was going, `n` toward the inside of its curve.
 */
function tear(
  stroke: Stroke,
  spine: Spine,
  at: Vec2,
  u: Vec2,
  n: Vec2,
  outer: Vec2,
  radius: number,
  bend: number,
  // How far the tail's curve leaves the stroke along it, against its span.
  pull = 0.3,
  // Whether the drop closes back onto the tail's own foot rather than onto
  // the spine: see `teardropsFor`.
  close = false,
): Contour {
  const k = 0.5523 * radius;
  const add = (p: Vec2, d: Vec2, by: number): Vec2 => ({ x: p.x + d.x * by, y: p.y + d.y * by });
  const corner = { x: at.x + outer.x, y: at.y + outer.y };
  const centre = add(corner, n, radius);
  const front = add(centre, u, radius);
  const top = add(centre, n, radius);
  /*
   * Where the drop's inner side comes back onto the stroke: two and a half
   * radii back, or as far as the run goes. Taken off the run itself rather
   * than off a straight line, because the run is curving -- a point on the
   * tangent would sit off the stroke's edge and the drop would meet it at an
   * angle.
   */
  const total = spine.segments.reduce(
    (sum, segment) =>
      sum +
      (segment.kind === "line"
        ? Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y)
        : segment.radius * Math.abs(segment.endAngle - segment.startAngle)),
    0,
  );
  // And no further round the curve than about a radian of it, or on a tight
  // curve the point would come back round to face the drop.
  const back = backFromEnd(spine, Math.min(radius * 2.5, total * 0.8, bend * 1.1));
  const shift = reachAlong({ x: -back.heading.y, y: back.heading.x }, penReach(stroke.pen));
  // The inside of the curve there, which round a tight curve is not where it
  // is at the end: the same side of the way the run is going.
  const way = u.x * n.y - u.y * n.x;
  const local = { x: -back.heading.y * way, y: back.heading.x * way };
  const toward = shift.x * local.x + shift.y * local.y >= 0 ? shift : { x: -shift.x, y: -shift.y };
  let meets = { x: back.point.x + toward.x, y: back.point.y + toward.y };
  let behind = back.point;
  /*
   * A drop with no room to swell is hardly wider than the stroke, and the
   * point it would come back to can then lie inside the drop itself -- where
   * a tail curling back out to it crossed itself. There the drop is closed off
   * as the half disc it is, through its own centre, with the tail drawn as a
   * piece of no length on its top.
   */
  if (Math.hypot(meets.x - centre.x, meets.y - centre.y) < radius * 1.1) {
    meets = top;
    behind = centre;
  }
  const span = Math.hypot(top.x - meets.x, top.y - meets.y);
  // Closed back along the edge to the drop's corner, a hair from the tail's
  // foot, so the closing edge leaves the foot away from the tail.
  if (close) behind = add(meets, { x: corner.x - meets.x, y: corner.y - meets.y }, 0.01);
  return {
    nodes: [
      { point: corner, handleIn: null, handleOut: add(corner, u, k), type: "corner" },
      { point: front, handleIn: add(front, n, -k), handleOut: add(front, n, k), type: "smooth" },
      {
        point: top,
        handleIn: add(top, u, k),
        handleOut: add(top, u, -span * 0.6),
        type: "smooth",
      },
      {
        point: meets,
        handleIn: add(meets, back.heading, span * pull),
        handleOut: null,
        type: "corner",
      },
      node(behind),
    ],
    closed: true,
  };
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

/** How near upright a straight end has to arrive to swell: see `flaresFor`. */
const UPRIGHT_FLARE = 0.992;

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
function ballsFor(
  stroke: Stroke,
  style: Style,
  swept: Contour[],
  others: Contour[] = [],
): Contour[] {
  const { size, drop } = style.parts.ball;
  if (size <= 0 || stroke.spine.closed || swept.length === 0) return [];
  /*
   * A didone's balls (`ball.curved`) grow as its serifs do, not as its stems
   * do: a disc the size of a Black's stem hung on every end was a blot.
   */
  const measure = style.parts.ball.curved ? serifReach(style) : style.pen.weight;
  const radius = (size * measure) / 2;
  const band = contoursBounds(swept);
  const out: Contour[] = [];
  /*
   * Where the rest of the run lies, for keeping a ball out of it: see `clear`
   * below.
   */
  const total = spineLength(stroke.spine);
  const samples = alongSpine(stroke.spine, 240).map((point, index) => ({
    point,
    along: (total * index) / 240,
  }));
  const ends = endsOf(stroke);
  // The outlines of the letter's other strokes, for keeping a ball off them.
  const beside = others.flatMap((contour) => polygonFor(contour).points);
  for (const [which, [terminal, at, outward, straightEnd]] of ends.entries()) {
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
    /*
     * And a face that balls only its curves (`ball.curved`, a didone's) takes
     * a straight end in mid-air as it takes one on a line: the flag of a one,
     * the bar of a sigma and the top of a be are cut, not blotted.
     */
    const blot =
      straightEnd &&
      (style.parts.ball.curved === true ||
        style.parts.ball.straight === false ||
        onALine(stroke, at, outward, style));
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
    /*
     * And not further to the left than the letter already reaches, for the
     * same reason and by the same arithmetic.
     *
     * The hold above says a ball fattens an end and does not make the letter
     * taller. It does not make it start further left either -- the space to a
     * letter's left is where the letter before it finished, and on a joined
     * face it is a stroke rather than a space. A Monoline `j` seated its drop
     * three units outside the room its own descender is allowed, which is a
     * drop resting on whatever was written before it.
     *
     * Left only. A ball on the right is finishing a stroke that runs out to the
     * advance and is spaced with it; it is the left where the letter has
     * already been placed and cannot give any more.
     */
    const spareLeft = (limit: number) => {
      const lean = 1 - outward.x * drop;
      return lean > 1e-6 ? (at.x - limit) / lean : Infinity;
    };
    /*
     * And never smaller than the end it closes, on a face that sizes its balls
     * by its serifs: a Black's S ends on the thick of its turn, and a disc
     * narrower than that left the cut's corners standing out beside it.
     */
    const covering = style.parts.ball.curved
      ? Math.max(radius, halfWidthAcross(stroke, outward) * 1.1)
      : radius;
    const room = Math.min(
      covering,
      spare(band.yMax),
      spare(-band.yMin + 2 * at.y),
      spareLeft(band.xMin),
    );
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
    /*
     * And where the room runs out, the ball is moved in off the line rather
     * than shrunk to nothing: shrunk, every terminal near a line -- the tail
     * of an e, the arm of an r, the head of an a, an f and a t, the hooks of
     * a j, a y and a J -- lost its ball at every weight, and a face promising
     * a ball on every open end had them on a third of its letters. Held to
     * four fifths of its size at the least, it is kept inside the letter's
     * lines by its centre instead.
     */
    // Not a joined hand, whose balls are the pen's own blots and stay where
    // the room leaves them.
    const written = style.parts.script.on;
    const buried = blot || (written && room < penReach(stroke.pen).across);
    /*
     * And never so big that it runs into the rest of its own stroke. A ball
     * sized off the pen alone is a stem and three quarters across, and on a
     * letter whose ends turn back towards its middle -- the s, whose aperture
     * this face all but shuts -- the disc on each end sat across the spine and
     * the letter came out as a blob. Held back to leave a little paper between
     * the two, measured off the spine a ball's width and more away from the
     * end it closes, which is past its own stroke's turn.
     */
    const keep = radius * 1.2 + measure * 0.5;
    const far = samples.filter(({ along }) => (which === 0 ? along > keep : total - along > keep));
    const gap = measure * (0.5 + 0.2);
    /*
     * Nor into the letter's other strokes, nor into the ball on this stroke's
     * other end, with a little paper between. The hood of a six came down on
     * its bowl and the tail of a nine up into its, and a c's two balls met
     * across its aperture: at the Psychedelic's Black each was one black blob.
     * The other ball is taken at the size this one is being tried at, which
     * is what it is where the two ends face each other.
     */
    const paper = measure * 0.2;
    const twinOf = which === 0 ? ends.at(-1) : ends[0];
    const twin = ends.length > 1 && twinOf?.[0].open === true ? twinOf : undefined;
    /*
     * Where a ball of a size goes: dropped past the end, then held inside the
     * lines the letter's ink reaches, as it is below. The two balls of one
     * stroke are tried against each other there, not where they would be
     * before that hold: a c's two, each pushed in off the lines its bowl
     * reaches, met in the aperture.
     */
    const centreOf = (end: Vec2, out: Vec2, size: number): Vec2 => {
      const x = end.x + out.x * size * drop;
      const y = end.y + out.y * size * drop;
      if (written) return { x, y };
      return {
        x: Math.max(x, band.xMin + size),
        y: Math.min(Math.max(y, band.yMin + size), band.yMax - size),
      };
    };
    const clear = (size: number): boolean => {
      const held = centreOf(at, outward, size);
      if (twin) {
        const other = centreOf(twin[1], twin[2], size);
        if (Math.hypot(other.x - held.x, other.y - held.y) < size * 2 + paper) return false;
      }
      /*
       * Against its own stroke where it is dropped: a ball held in off a line
       * is slid along it clear of its stroke as well (see `covered`), which
       * the hold alone does not say -- tried held, the hooks of a j, an f and
       * a y lost theirs.
       */
      const centre = { x: at.x + outward.x * size * drop, y: at.y + outward.y * size * drop };
      return (
        far.every(
          ({ point }) => Math.hypot(point.x - centre.x, point.y - centre.y) >= size + gap,
        ) && beside.every((point) => Math.hypot(point.x - held.x, point.y - held.y) >= size + paper)
      );
    };
    let fits = covering;
    if (!written && !clear(covering)) {
      let low = 0;
      let high = covering;
      for (let pass = 0; pass < 30; pass++) {
        const mid = (low + high) / 2;
        if (clear(mid)) low = mid;
        else high = mid;
      }
      fits = Math.max(low, BURIED);
    }
    const held = buried
      ? BURIED
      : written
        ? room
        : Math.min(
            Math.max(room, covering * 0.8),
            Math.max(fits, halfWidthAcross(stroke, outward) * (style.parts.ball.curved ? 1.1 : 1)),
          );
    /*
     * And where even the least ball is more than there is room for, set back
     * towards the end it closes by the share it could not have, so it rounds
     * the end off rather than standing out past it into what it was kept
     * from: dropped its full way, a c's two stood out across its aperture
     * and met.
     */
    let reach = !written && held > 0 ? Math.min(1, fits / held) : 1;
    /*
     * And where that still leaves the two balls of one stroke touching, set
     * back further, into the stroke's own end, until they stand apart: a
     * c's two, each at least as wide as the stroke it closes, met across an
     * aperture the Psychedelic all but shuts, and the letter's head and
     * foot were one blob. Set back along the stroke they part, since each
     * end is running towards the other.
     */
    if (!written && !buried && !style.parts.ball.curved && twin && held > 0) {
      const apart = (share: number): boolean => {
        const one = {
          x: at.x + outward.x * held * drop * share,
          y: at.y + outward.y * held * drop * share,
        };
        const two = {
          x: twin[1].x + twin[2].x * held * drop * share,
          y: twin[1].y + twin[2].y * held * drop * share,
        };
        return Math.hypot(one.x - two.x, one.y - two.y) >= held * 2 + paper;
      };
      if (!apart(reach) && apart(-1 / drop)) {
        let low = -1 / drop;
        let high = reach;
        for (let pass = 0; pass < 30; pass++) {
          const mid = (low + high) / 2;
          if (apart(mid)) low = mid;
          else high = mid;
        }
        reach = low;
      }
    }
    let placed = {
      x: at.x + outward.x * held * drop * reach,
      y: at.y + outward.y * held * drop * reach,
    };
    /*
     * And where the lines would hold it in across the way it runs -- the
     * end of a parenthesis, running up into the cap line -- set back along
     * the stroke instead, so it stays on the end it closes: held straight
     * down, the Psychedelic's parentheses wore their balls inside their
     * own curves.
     */
    let ceiling = band.yMax;
    let floor = band.yMin;
    let wall = band.xMin;
    if (!written && !buried && !style.parts.ball.curved) {
      const over = placed.y + held - band.yMax;
      const under = band.yMin + held - placed.y;
      const back =
        over > 0 && outward.y > 0.6
          ? over / outward.y
          : under > 0 && outward.y < -0.6
            ? under / -outward.y
            : 0;
      if (back > 0) {
        placed = { x: placed.x - outward.x * back, y: placed.y - outward.y * back };
        /*
         * Set back no further than leaves it covering both corners of the
         * cut, where the letter has room above (or below) its own ink before
         * the next line it is drawn between: set back the whole way, a
         * parenthesis's ball left the cut's inner corner standing out beside
         * it as an ear. A run whose ink already stops on a line keeps the
         * whole set-back.
         */
        const lines = [0, style.metrics.xHeight, style.metrics.capHeight];
        lines.push(style.metrics.ascender, style.metrics.descender);
        const room =
          over > 0
            ? Math.min(...lines.filter((y) => y > band.yMax + 2)) - band.yMax
            : band.yMin - Math.max(...lines.filter((y) => y < band.yMin - 2));
        // How far back along the run the ball may sit and still take in
        // both corners of the cut, which a pen with contrast puts a little
        // ahead of and behind the end rather than square across it.
        const shift = reachAlong({ x: -outward.y, y: outward.x }, penReach(stroke.pen));
        const ahead = Math.abs(shift.x * outward.x + shift.y * outward.y);
        const square = shift.x * shift.x + shift.y * shift.y;
        const reachSq = (held * 0.98) ** 2 - square + ahead * ahead;
        const covers = reachSq > 0 ? Math.sqrt(reachSq) - ahead : -Infinity;
        const behind = { x: at.x - placed.x, y: at.y - placed.y };
        const setBackBy =
          Math.hypot(behind.x, behind.y) *
          (behind.x * outward.x + behind.y * outward.y < 0 ? -1 : 1);
        if (Number.isFinite(room) && room > 0 && covers > 0 && setBackBy > covers) {
          const want = Math.max(covers, setBackBy - room / Math.abs(outward.y));
          placed = { x: at.x - outward.x * want, y: at.y - outward.y * want };
          if (over > 0) ceiling = Math.max(ceiling, placed.y + held);
          else floor = Math.min(floor, placed.y - held);
          // Nor held in off the left, where the corner it covers is the
          // letter's leftmost ink: the bulge of the disc round it is all
          // that passes it.
          wall = Math.min(wall, placed.x - held);
        }
      }
    }
    const kept = written
      ? placed
      : {
          x: Math.max(placed.x, wall + held),
          y: Math.min(Math.max(placed.y, floor + held), ceiling - held),
        };
    /*
     * And, moved in off a line, slid along it until it still covers both
     * corners of the cut it closes. Lifted straight up off the descender, the
     * ball on the hook of a j, an f and a y left the lower corner of the cut
     * standing out beneath it as a spike.
     */
    const inside =
      written || buried || kept.y === placed.y
        ? kept
        : { x: covered(kept, at, stroke, outward, held), y: kept.y };
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
      : inside;
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
  const reaches = Math.abs(reachAlong({ x: -outward.y, y: outward.x }, penReach(stroke.pen)).y);
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
    /*
     * Grown with the pen only up to about the face's own weight: a swelling
     * is a flourish on the end of a stem, not a slab, and grown with a Black's
     * pen it met the one on the next stroke and filled the letter in -- the
     * k, the x, the K and the N went solid from a pen of two hundred.
     */
    // Not a joined hand, whose swellings are its pen's pressure and follow it.
    const written = style.parts.script.on;
    const grows = written ? stem : Math.min(stem, style.metrics.unitsPerEm * 0.12);
    const reach = spread * grows;
    /*
     * And never further back than the stroke runs: the dot of a grid i is
     * half a cell long, and a swelling a pen deep on its top end ran on past
     * its foot and down onto the stem.
     */
    const back = Math.min(depth * grows, spineLength(stroke.spine));
    /*
     * And only on an upright or a level run. On a diagonal cut level the
     * swelling lay along the line and stood out sideways off the slant as a
     * square block -- the arm and leg of every k, the heads of a v, a w and a
     * y -- which is a slab stuck on, not a stroke swelling.
     */
    /*
     * Upright meaning within a few degrees of it: the outer strokes of a W
     * lean about thirteen, and swelled as uprights their heads hooked out
     * over the cap line and their feet met at the baseline in round blobs,
     * beside a V whose own diagonals were left clean.
     */
    const slanted =
      !written && straightEnd && Math.abs(outward.y) < UPRIGHT_FLARE && Math.abs(outward.y) > 0.26;
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
        !swelling || slanted || crossesALine(at, facing, side, inner + reach, inner, style);
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
      /*
       * And a refused one laid back inside the stroke, a little narrower than
       * it: lying on the stroke's own end, its unit-deep sliver ran along the
       * cut and past a curved end's corners, and showed as a hairline spike off
       * every terminal of the Flared c, e and s.
       */
      const shape =
        refused && !written
          ? flare(
              { x: at.x - outward.x * inner * 0.5, y: at.y - outward.y * inner * 0.5 },
              facing,
              side,
              inner * 0.6,
              swells,
              deep,
              curve,
            )
          : flare(at, facing, side, inner, swells, deep, curve);
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

/** The longest a slab's serif on an arm reaches, against the em: see `serifsFor`. */
const ARM_SERIF_HOLD = 0.1;

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
function serifsFor(stroke: Stroke, style: Style, others: Contour[] = []): Contour[] {
  const out: Contour[] = [];
  const reference = penReach(style.pen).across;
  const ends = endsOf(stroke);
  for (const [which, [terminal, at, outward, straightEnd]] of ends.entries()) {
    const mate = ends[1 - which];
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
    let thickness = terminal.thickness ?? 0;
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
    const inner = level ? levelHalfWidth(stroke, outward) : halfWidthAcross(stroke, outward);
    // The font's own stem, or this stroke's edge if that is further out, and
    // the projection beyond it. Measured from the stem so that every serif in
    // the face is the same size, and from the stroke where the stroke is the
    // wider of the two, or the wing would begin inside the ink it sits on.
    let full = Math.max(reference, inner) + projection;
    /*
     * A text serif on the end of an arm is a beak: a long upright wedge, as
     * the arms of Lora's E, T, L and Z end. At the size of a foot it read as
     * a nick at a regular weight and was lost altogether at a light one. So
     * the beak on an arm lying along a line runs down (or up) off it about a
     * quarter of the cap height, and the one on a middle arm, which reaches
     * both ways, about half that each way.
     */
    const arm = winged && terminal.shape === "wedge" && Math.abs(outward.y) < 1e-3;
    /*
     * And a slab's beak on the end of an arm reaches off the arm's own
     * edge, not the stem's: measured from the stem, a Black's grew with the
     * stem and hung the F's middle beak down onto its foot and the Z's into
     * its own diagonal. Rockwell's stay the length of a serif.
     */
    if (!arm && winged && Math.abs(outward.y) < 1e-3) {
      /*
       * And no further than a Black's slab reaches, however heavy the stem:
       * the serif on an arm hangs into a counter, not off a foot into the
       * paper under the letter. Grown with the stem as the feet do, a
       * Black's hung the F's middle beak down within a hair of its foot and
       * stood the Z's into its own diagonal; Rockwell's Extra Bold keeps them
       * the length of its Regular's.
       */
      const reach = serifReach(style);
      const held = projection * Math.min(1, (style.metrics.unitsPerEm * ARM_SERIF_HOLD) / reach);
      full = Math.min(full, inner + held);
    }
    if (arm) {
      const { unitsPerEm, capHeight } = style.metrics;
      const edge = [1, -1].some((side) => crossesALine(at, outward, side, full, inner, style));
      const beak = Math.min(Math.max(full * 1.6, unitsPerEm * 0.11), capHeight * 0.24);
      full = edge ? beak : Math.max(full, beak * 0.5);
      // And never thinner at its root than a third of the serif's reach, or at
      // a hairline weight it is a scratch rather than a beak.
      thickness = Math.max(thickness, serifReach(style) * 0.3);
    }
    /*
     * A sloped head: the stem's top was cut falling away to the left by `sink`
     * across its width, and the flag carries on along the same line.
     */
    const shear = level && (terminal.sink ?? 0) > 0 && inner > 0 ? terminal.sink! / (2 * inner) : 0;
    // And the flag itself no longer than the serif grows, for the same reason.
    if (shear > 0) {
      full =
        Math.max(reference, inner) +
        projection * Math.min(1, serifReach(style) / Math.max(style.pen.weight, 1e-9));
    }
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
      /*
       * A text serif keeps its inner wings to a Black and past it, trimmed:
       * the paper held between two of them stops growing with the pen at a
       * fifth of the x-height, where held at three quarters of the pen the n,
       * the h and the m lost them past a Bold and stood on their outer wings
       * alone -- and a wing trimmed short is still drawn (see `crowded`).
       */
      const text = terminal.shape === "wedge";
      const paper = text ? Math.min(reference, style.metrics.xHeight * 0.14) : reference;
      let room = winged
        ? roomBeside(at, facing, side, inner, full, thickness, paper, others)
        : full;
      /*
       * And never into the other end of its own stroke. The two arms of a v,
       * a V and each vee of a W are one run, so the strokes beside it do not
       * include the arm the inner wing is reaching toward: at a black weight
       * the two inner wings at the top ran almost into each other and left a
       * little heart-shaped counter between them. The other end is given the
       * same room, so the paper left is shared as it is between two strokes.
       */
      if (winged && mate && mate[0].kind === "slab" && Math.abs(mate[1].y - at.y) < 1) {
        const across = { x: -facing.y * side, y: facing.x * side };
        const apart = (mate[1].x - at.x) * across.x + (mate[1].y - at.y) * across.y;
        if (apart > 0) {
          room = Math.min(room, inner + Math.max(0, apart - 2 * inner - reference * 1.5) / 2);
        }
      }
      /*
       * And never into another stroke, or so near one that only a hair of
       * paper is left between them.
       *
       * The foot of a k's leg and the foot of its stem stand on the same line
       * a little way apart, and so do the R's; with long serifs their inner
       * wings ran to within a few units of each other and the white between
       * them came out as a stray hairline under the letter. The foot of a b
       * reached under the bowl, which comes down to the line right beside the
       * stem, and stuck out of the curve as a notch. So a wing is shortened to
       * leave half a stem of paper between it and whatever else is standing on
       * its line -- sharing what there is with a wing coming the other way --
       * and if that leaves less than a third of the serif, it is not drawn at
       * all: a stub that short reads as a mistake rather than as a serif.
       */
      /*
       * And on a face that waves its serifs, most of the wing or none: a wave
       * needs its length to turn in, and a wing cut short beside a bowl -- the
       * inside of the Wavy's a, b, d, p and q -- squeezed its wave into a
       * crumpled hook where the bowl meets the stem.
       */
      const crowded = room < inner + projection / (text ? 5 : waving(style) ? 1.25 : 3);
      /*
       * Nor on the inside of a shallow diagonal.
       *
       * A serif laid level across the end of a leaning stroke has two wings,
       * and one of them points the way the stroke leans -- under the leg of a
       * k, above its arm. Where the stroke meets the line steeply, as the legs
       * of an A do, the stroke covers that wing's root and the two read as
       * one. Where it meets it at less than forty-five degrees, as the arm and
       * leg of a k and the leg of an R do, the stroke lies down over the wing
       * and leaves a long wedge of paper between them: the wing reads as a
       * loose horizontal bar across the letter, which is what a long serif made
       * of the k's arm at its x-height. Only the outer wing is drawn there.
       */
      const into = { x: -outward.x, y: -outward.y };
      const across = { x: -facing.y * side, y: facing.x * side };
      /*
       * Fifty degrees rather than forty-five: a wing that follows the stroke's
       * edge down fills more of that wedge than a bar did, and the arm of a
       * text face's k meets its x-height at forty-seven.
       */
      const underneath =
        level && across.x * into.x + across.y * into.y > Math.cos((50 * Math.PI) / 180);
      /*
       * And under a sloped head, only the flag on the left: the top of a
       * lowercase stem is where the pen came in, and it came in from the left.
       */
      const behind = (shear > 0 || terminal.flag === true) && side < 0;
      const refused =
        !winged ||
        terminal.bare === true ||
        crowded ||
        underneath ||
        behind ||
        crossesALine(at, facing, side, full, inner, style);
      /*
       * Refused, the wing shrinks to a sliver held well inside the stroke --
       * from its spine to a little short of its edge -- so nothing of it shows
       * and it cannot poke out of a curve or a sloped cut.
       */
      /*
       * Where a refused wing goes: back along the run itself rather than along
       * the line the end points, which on a curve leaves the stroke -- see
       * below -- and square across the run there.
       */
      /*
       * Back up the stroke itself, not straight back from the line it stops
       * on: on a shallow diagonal -- the leg of a k -- a point straight up
       * from the end is out beside the stroke, and the sliver stood there as
       * a stray hairline to the right of the leg.
       */
      const buried = straightEnd
        ? {
            point: {
              x: at.x - outward.x * (3 + inner * 0.6),
              y: at.y - outward.y * (3 + inner * 0.6),
            },
            heading: facing,
          }
        : backFromEnd(which === 1 ? stroke.spine : reversed(stroke.spine), 3 + inner * 0.6);
      const from = refused ? 0 : inner;
      // And no longer than the stroke is wide where it is put, which on a
      // curve with contrast is not how wide it is at the end.
      const tip = refused
        ? Math.min(inner, halfWidthAcross(stroke, buried.heading)) * 0.6
        : Math.min(full, room);
      /*
       * A wing cut short by a neighbour is made shallower with it, so it
       * stays the shape of a serif rather than becoming a stub with a full
       * bracket standing on it.
       */
      const short = refused || full <= inner ? 1 : Math.max(0, (tip - inner) / (full - inner));
      /*
       * And a head no deeper than a text weight's. The flag and its bracket
       * grew with the serif, and at a black weight the two together ran a
       * quarter of the x-height down the side of the stem: the top of every
       * n, i and l was a wedge rather than a flag.
       */
      const headCap = shear > 0 ? style.metrics.unitsPerEm * 0.045 : Infinity;
      const deep = refused
        ? BURIED
        : Math.min(thickness * Math.max(0.55, Math.min(1, short)), headCap);
      const tipDeep = terminal.shape === "wedge" ? deep * WEDGE_TIP : deep;
      /*
       * How far the stroke's edge on this side moves out along the wing for
       * every unit back up the stroke: nothing on an upright, and on a serif
       * laid level across a diagonal, the diagonal's own slant.
       */
      const edgeLean = level ? (across.x * into.x + across.y * into.y) / Math.abs(outward.y) : 0;
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
      /*
       * And whatever the bracket asks for past what the serif can take carried
       * on up the stroke, so the whole of the control does something: held to
       * the depth alone, everything past it on the slider was the same serif.
       *
       * Counted from the thickness, a short serif -- cut down in depth, or
       * capped under a sloped head, or with little wing to fillet -- held one
       * drawing all the way from what it can take up to the thickness: a
       * stretch of the slider that did nothing. Counted from what it can take
       * instead, every base's own drawing moved, because every base's own
       * bracket stands in that stretch somewhere (the Serif's X by forty units
       * at a Black). So that stretch is read around the base's own bracket:
       * below it the fillet is scaled down toward none, above it the rest
       * carries on, and at it the drawing is exactly what it always was.
       */
      const asked = terminal.bracket ?? 0;
      const thick = terminal.thickness ?? asked;
      const limit = Math.min(deep, (tip - from) * 0.8, headCap);
      const home = terminal.bracketHome;
      let held = Math.min(asked, limit);
      let past = Math.max(0, asked - thick);
      if (home !== undefined && !refused && limit < thick) {
        const pivot = Math.min(Math.max(home, limit), thick);
        if (pivot > 1e-9) {
          held = asked >= pivot ? limit : (asked * limit) / pivot;
          past = Math.max(0, asked - pivot);
        }
      }
      // A text serif's hollow runs from its tip to wherever it meets the
      // stem, so it can climb as far as it likes; a square serif's fillet
      // turns along the wing too, and stops short of its tip.
      const wedge = terminal.shape === "wedge";
      const wingRoom = wedge ? 0 : Math.max(0, (tip - from) * 0.8 - held);
      const bracket = held + Math.min(past, wingRoom);
      // And past what the wing has room for, a square serif's fillet climbs on
      // up the stroke as a text serif's hollow does: held to the wing, every
      // setting past it drew the same serif.
      const climb = refused ? 0 : Math.min(Math.max(0, past - wingRoom) * BRACKET_CLIMB, headCap);
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
      /*
       * And laid flat where an arm runs on along the line from the other side
       * of the stroke -- the top and foot of an E's stem, the top of an F's:
       * the arm waves away from the stem, and a wing waving the other way
       * beside it put two troughs either side of the stem, which stood up
       * between them as a spike. Flat, it reads as the arm carried on past
       * the stem, as a slab E's corner does. The same pieces as a wave, so
       * the letter has the same points at every weight.
       */
      const calm =
        waving(style) &&
        alongLine(at, facing, -side, inner, Math.max(thickness, inner), thickness, others);
      const shape: Contour[] = waving(style)
        ? sweptWing(stroke, style, at, facing, side, from, tip, deep, calm)
        : [
            wing(
              /*
               * A refused wing is set back into the stroke by a little more
               * than its own depth, so none of it lies on the end: on a curved
               * end cut at the pen's angle the sliver stood out of the foot
               * of every c, e and t at a black weight as a hair. And set back
               * by as much again as it is long, so a cut slanting across the
               * end up to forty-five degrees still covers it: the Didone's s
               * and c, whose ends are cut at a slant, showed both slivers as
               * hairs standing out of the cut.
               */
              refused ? buried.point : at,
              refused ? buried.heading : facing,
              side,
              from,
              tip,
              deep,
              tipDeep,
              bracket,
              shear,
              inner,
              refused ? 0 : edgeLean,
              terminal.shape === "wedge",
              climb,
            ),
          ];
      for (const piece of shape) {
        // Wound with the strokes it sits on, or the serif would cancel the stem
        // it is attached to rather than adding to it.
        out.push(contourArea(piece) < 0 ? reverseContour(piece) : piece);
      }
    }
  }
  return out;
}

/**
 * Another stroke's outline, flattened for asking what lies inside it.
 *
 * Kept against the outline, which the sweep made for this letter and nothing
 * changes afterwards: every stroke of a letter is told about all the others,
 * so each outline is asked about once for every stroke beside it, and each
 * wing walks out along it a point every two units. Flattened once, it is the
 * same polygon `contourContainsPoint` would have made every time.
 */
const polygons = new WeakMap<Contour, Polygon>();

function polygonFor(contour: Contour): Polygon {
  let polygon = polygons.get(contour);
  if (!polygon) {
    polygon = polygonOf(contour);
    polygons.set(contour, polygon);
  }
  return polygon;
}

/**
 * How far out a serif wing can reach before it comes too near another stroke.
 *
 * Walked along the middle of the band the wing would occupy, from the edge of
 * its own stroke out past where it would end, until it meets the ink of any
 * other stroke. The wing may then take half of the paper between, less half a
 * stem: half, because the stroke it has met may be wearing a wing of its own
 * coming the other way, and the half-stem is the least white that reads as a
 * gap rather than as a hairline. Nothing met, and it reaches as far as it
 * asked.
 */
function roomBeside(
  at: Vec2,
  outward: Vec2,
  side: number,
  inner: number,
  full: number,
  thickness: number,
  stem: number,
  others: Contour[],
): number {
  if (others.length === 0) return full;
  const polygons = others.map(polygonFor);
  const across = { x: -outward.y * side, y: outward.x * side };
  const into = { x: -outward.x, y: -outward.y };
  /*
   * Three quarters of the pen, where this was half. Half a pen of paper
   * between two facing wings under the counter of an n is what the eye reads
   * as a gap at a text weight, but at a black one the two bracketed wings
   * rising either side of it closed the bottom of the counter down to a
   * keyhole.
   */
  const clear = stem * 1.5;
  const far = full * 2 + clear;
  const step = 2;
  for (let u = inner; u <= far; u += step) {
    const point = {
      x: at.x + across.x * u + into.x * (thickness / 2),
      y: at.y + across.y * u + into.y * (thickness / 2),
    };
    if (polygons.some((polygon) => polygonContains(polygon, point))) {
      return inner + Math.max(0, u - inner - clear) / 2;
    }
  }
  return full;
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
      standingOn(at.y, line, inner) && Math.abs(across.y) > 0.8 && (far - line) * inward < 0,
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

/** How much of its wave a wing laid flat keeps: enough to keep its pieces. */
const CALM = 1e-3;

/**
 * Whether another stroke lies along the line a wing would run on, on the
 * `side` given, from the stroke's own edge out to `reach`: an arm running on
 * from a stem, rather than a bowl coming down beside it.
 */
function alongLine(
  at: Vec2,
  outward: Vec2,
  side: number,
  inner: number,
  reach: number,
  thickness: number,
  others: Contour[],
): boolean {
  if (others.length === 0) return false;
  const polygons = others.map(polygonFor);
  const across = { x: -outward.y * side, y: outward.x * side };
  const into = { x: -outward.x, y: -outward.y };
  for (let u = inner + 1; u <= inner + reach; u += 2) {
    const point = {
      x: at.x + across.x * u + into.x * (thickness / 2),
      y: at.y + across.y * u + into.y * (thickness / 2),
    };
    if (!polygons.some((polygon) => polygonContains(polygon, point))) return false;
  }
  return true;
}

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
  // Laid flat, in the same pieces: see `calm` where the wings are drawn.
  calm = false,
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
    calm ? depth * CALM : depth,
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
/**
 * Where along its line a ball's centre goes so that the disc covers both
 * corners of the cut at `at`, as near `centre` as that allows; `centre.x`
 * itself where no place on the line covers both.
 */
function covered(centre: Vec2, at: Vec2, stroke: Stroke, outward: Vec2, radius: number): number {
  const shift = reachAlong({ x: -outward.y, y: outward.x }, penReach(stroke.pen));
  let low = -Infinity;
  let high = Infinity;
  for (const side of [1, -1]) {
    const corner = { x: at.x + shift.x * side, y: at.y + shift.y * side };
    const room = radius * radius - (centre.y - corner.y) ** 2;
    if (room < 0) return centre.x;
    const reach = Math.sqrt(room) * 0.98;
    low = Math.max(low, corner.x - reach);
    high = Math.min(high, corner.x + reach);
  }
  if (low > high) return centre.x;
  return Math.min(Math.max(centre.x, low), high);
}

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

  const startPoint =
    first.kind === "line" ? first.from : onArc(first.centre, first.radius, first.startAngle);
  const endPoint = last.kind === "line" ? last.to : onArc(last.centre, last.radius, last.endAngle);

  const startOut =
    first.kind === "line"
      ? unit(startPoint, first.to, -1)
      : tangentOnArc(first.startAngle, first.sweepPositive, -1);
  const endOut =
    last.kind === "line"
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

const node = (point: Vec2): GlyphNode => ({
  point,
  handleIn: null,
  handleOut: null,
  type: "corner",
});

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
 * How far up the stem a serif's fillet climbs for each unit of bracket asked
 * for past what the serif can take: see `serifsFor`.
 */
const BRACKET_CLIMB = 2;

/**
 * How deep a wedge serif is at its tip, against its depth where it meets the
 * stem. A little under half, which is where a text serif stops reading as a bar
 * and starts reading as something that tapers.
 */
const WEDGE_TIP = 0.42;
/**
 * How far out along the inside wing of a diagonal the stroke's edge may run
 * where the serif's hollow meets it, against the wing's length.
 */
const INSIDE_REACH = 0.8;
/** How far the handles of that hollow reach toward its corner. */
const INSIDE_PULL = 0.6;

/**
 * One wing of a serif.
 *
 * Worked out in the stroke's own frame -- `across` runs along the end of the
 * stroke and `into` runs back up it -- and then written out in the letter's
 * coordinates, so the same code serifs the foot of a stem, the top of an
 * ascender and the end of an arm without knowing which is which.
 *
 * `from` is where the wing leaves the stroke and `tip` where it stops; `deep`
 * is how far back up the stroke it reaches where it meets it, and `tipDeep`
 * how far at its tip, which is the same on a square serif and less on a wedge.
 * `shear` tips the whole wing down to the left by so much per unit, which is a
 * sloped head: the stem's own cut falls away along the same line, measured from
 * its right-hand edge at `edge` units right of the spine.
 */
function wing(
  at: Vec2,
  outward: Vec2,
  side: number,
  from: number,
  tip: number,
  deep: number,
  tipDeep: number,
  bracket: number,
  shear = 0,
  edge = 0,
  lean = 0,
  wedge = false,
  climb = 0,
): Contour {
  const across = { x: -outward.y * side, y: outward.x * side };
  const into = { x: -outward.x, y: -outward.y };
  const place = (u: number, v: number): Vec2 => {
    const w = v + shear * (edge + side * u);
    return {
      x: at.x + across.x * u + into.x * w,
      y: at.y + across.y * u + into.y * w,
    };
  };

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
  const held = Math.max(0, from - Math.max(deep, from) * SERIF_BITE);

  /*
   * Where the stroke's own edge is, so far back up it.
   *
   * Straight down from where the wing leaves it on an upright, but a serif
   * laid level across a diagonal meets a stroke whose edge runs off at a
   * slant: on the outside of a V's arm the edge falls away from the wing as it
   * goes down, and a fillet that ran straight up from where the wing began
   * finished in the paper beside the stroke and came back to it along a flat
   * step. So the wing follows the edge, whichever way it runs.
   */
  /*
   * Where the edge runs out over the wing -- the inside of a diagonal -- it is
   * only followed half way to the tip. Past that the stroke has covered the
   * top of the wing already, and a wing that kept following it would fold
   * back over its own tip.
   */
  let cap = lean > 0 ? (0.5 * (tip - from)) / lean : Infinity;
  const shift = (v: number): number => lean * Math.min(v, cap);
  const edgeAt = (v: number): number => from + shift(v);
  const heldAt = (v: number): number => held + shift(v);
  // And whatever the bracket asked for past what the serif can take,
  // climbing on up the stroke: see `BRACKET_CLIMB`.
  // How far along the wing the fillet runs, which the climb never adds to.
  let along = Math.min(bracket, Math.max(0, (tip - edgeAt(deep)) * 0.8));
  let rise = along + climb;
  /*
   * On the inside of a diagonal, no higher up the stroke than the edge is
   * followed, so the hollow arrives along the edge itself. Carried on past
   * that and arriving upright, it bowed out over the edge and came back into
   * it at a corner: a knob either side of a w's middle and inside a V.
   */
  if (lean > 0 && wedge) {
    const most = (INSIDE_REACH * (tip - from)) / lean;
    rise = Math.min(rise, Math.max(0, most - deep));
    if (deep <= most) cap = Infinity;
  }
  /*
   * And where it runs away from the wing -- the outside of a shallow arm, as
   * on a k -- the wing is made shallower rather than followed all the way: an
   * edge leaning that far would carry the wing's root half across the letter,
   * and it would fill the wedge of paper under the arm that the letter needs.
   * A serif on a stroke meeting its line that shallowly is a thin one anyway.
   */
  if (lean < 0) {
    const most = ((wedge ? 0.6 : 1.2) * (tip - from)) / -lean;
    const share = Math.min(1, most / Math.max(deep + rise, 1e-9));
    deep *= share;
    tipDeep *= share;
    rise *= share;
    along *= share;
  }
  const reachUp = deep + rise;

  const nodes: GlyphNode[] = [node(place(held, 0)), node(place(tip, 0))];
  const handle = 0.5523 * rise;
  // A hair inside the edge rather than on it, so the two overlap and no seam
  // is left between them.
  const meetU = Math.max(heldAt(reachUp), edgeAt(reachUp) - Math.min(0.5, from * 0.05));
  const tangent = (() => {
    const slant = reachUp < cap ? lean : 0;
    const length = Math.hypot(slant, 1);
    return { u: slant / length, v: 1 / length };
  })();

  if (wedge) {
    /*
     * A text serif: thin at its tip, and one long hollow curve from there back
     * to the stem, arriving running up the stem's own edge. There is no
     * corner anywhere along the top of it, which is what makes it read as
     * grown out of the stroke rather than laid across it.
     */
    const top = { u: tip, v: tipDeep };
    const du = top.u - meetU;
    const dv = reachUp - top.v;
    if (lean > 0 && cap === Infinity) {
      /*
       * On the inside of a diagonal the edge runs out toward the tip, and a
       * hollow leaving the tip level and arriving along that edge turns more
       * than a right angle: drawn with the upright's handles it swung in to
       * the edge well above where it met it and out again, and the wing was
       * a knob on a neck. So both handles aim at the corner the wing's
       * underside and the stroke's edge would make, and the hollow lies
       * inside that corner as a fillet does.
       */
      const corner = { u: from + lean * tipDeep, v: tipDeep };
      const toward = (u: number, v: number, share: number) =>
        place(u + (corner.u - u) * share, v + (corner.v - v) * share);
      nodes.push({
        point: place(top.u, top.v),
        handleIn: null,
        handleOut: toward(top.u, top.v, INSIDE_PULL),
        type: "corner",
      });
      nodes.push({
        point: place(meetU, reachUp),
        handleIn: toward(meetU, reachUp, INSIDE_PULL),
        handleOut: null,
        type: "corner",
      });
      nodes.push(node(place(heldAt(reachUp), reachUp)));
      return { nodes, closed: true };
    }
    nodes.push({
      point: place(top.u, top.v),
      handleIn: null,
      handleOut: place(top.u - du * 0.55, top.v + dv * 0.12),
      type: "corner",
    });
    const pull = Math.max(dv * 0.6, 0);
    nodes.push({
      point: place(meetU, reachUp),
      handleIn: place(meetU - tangent.u * pull, reachUp - tangent.v * pull),
      handleOut: null,
      type: "corner",
    });
    nodes.push(node(place(heldAt(reachUp), reachUp)));
    return { nodes, closed: true };
  }

  nodes.push(node(place(tip, tipDeep)));
  if (rise > 0) {
    /*
     * The fillet: a quarter turn hollowing out the inside corner where the
     * serif meets the stem. Zero bracket leaves that corner square, which is a
     * slab serif; opening it out is what makes a text serif look grown from the
     * stem rather than stuck on it. A quarter of an ellipse where it climbs:
     * along the wing no further than the wing has room for, and up the stem
     * by that and whatever climbs past it. Drawn round, a fillet taller than
     * the wing began out past the wing's tip and bulged over it.
     */
    const cornerU = edgeAt(deep) + along;
    nodes.push({
      point: place(cornerU, deep),
      handleIn: null,
      handleOut: place(cornerU - 0.5523 * along, deep),
      type: "tangent",
    });
    nodes.push({
      point: place(meetU, reachUp),
      handleIn: place(meetU - tangent.u * handle, reachUp - tangent.v * handle),
      handleOut: null,
      type: "tangent",
    });
    nodes.push(node(place(heldAt(reachUp), reachUp)));
  } else {
    nodes.push(node(place(edgeAt(deep), deep)));
    nodes.push(node(place(heldAt(deep), deep)));
  }

  return { nodes, closed: true };
}
