/**
 * Where the strokes of each letter run.
 *
 * A recipe here says nothing about weight, contrast, serifs or terminals. It
 * says only that an n is a stem on the left, an arch springing off it, and a
 * second stem coming down on the right -- the skeleton, which is what a letter
 * is underneath. Everything else arrives from the style when it is drawn.
 *
 * Splitting it that way is what lets one edit reach the whole font. The arch of
 * an n, the arch of an m and the arch of an h are not three drawings that
 * resemble each other; they are three uses of one description, so moving where
 * the arch springs from moves all three, and there is no fourth copy somewhere
 * that got missed. The same goes for every bowl, every bar and every diagonal.
 *
 * The proportions are the ordinary ones of Latin writing -- an x-height a
 * little over half the cap height, round letters overshooting the flat ones so
 * they look level, an s narrower than an o. Those are properties of the
 * alphabet rather than of anyone's typeface. None of these shapes is traced
 * from or fitted to an existing font: each is constructed from the metrics and
 * the parts, which is what makes what comes out yours.
 */

/*
 * The recipes themselves are in `./letters/`, a file to each group -- the
 * lowercase, the capitals, the figures, the punctuation and symbols, the
 * extra Latin letters, the marks, Cyrillic and Greek -- with the alternates
 * in one more and what they are all drawn with in `common.ts`. This file puts
 * the table back together in the order it has always had, and is still the
 * only thing anybody imports: nothing outside the folder names it.
 */

import { ALTERNATES } from "./letters/alternates";
import {
  beginLetter,
  BUTT,
  enclosing,
  frame,
  ink,
  lighter,
  type LetterName,
  type Recipe,
} from "./letters/common";
import {
  BOTH_ENDS,
  type Ends,
  HANDS_OVER_HIGH,
  movedSpine,
  planJoin,
  planLoops,
  seamHeading,
  seamsOf,
  wobbleOf,
} from "./script";
import { bowRuns, spineEnd } from "./shapes";
import { blackness, scriptUnit } from "./style";
import type { Style } from "./style";
import type { Spine } from "./types";
import type { Vec2 } from "@/font/types";
import { LOWERCASE_RECIPES } from "./letters/lowercase";
import { CAPITAL_RECIPES } from "./letters/capitals";
import { FIGURE_RECIPES } from "./letters/figures";
import { PUNCTUATION_RECIPES } from "./letters/punctuation";
import { LATIN_RECIPES } from "./letters/latin";
import { MARK_RECIPES } from "./letters/marks";
import { CYRILLIC_RECIPES } from "./letters/cyrillic";
import { GREEK_RECIPES } from "./letters/greek";

export {
  FIGURES,
  letterBehind,
  partsOfStroke,
  recordPartsWhile,
  type LetterName,
  type PartName,
  type Recipe,
} from "./letters/common";
export { ALTERNATES, type Alternate } from "./letters/alternates";

// ---------------------------------------------------------------------------
// The recipes
// ---------------------------------------------------------------------------

/**
 * Each is a function of the style rather than a fixed set of coordinates, so
 * changing the x-height or the width of a counter redraws every letter at the
 * new proportions instead of scaling a drawing made for the old ones.
 */
export const LETTERS: Record<LetterName, (style: Style) => Recipe> = {
  ...LOWERCASE_RECIPES,
  ...CAPITAL_RECIPES,
  ...FIGURE_RECIPES,
  ...PUNCTUATION_RECIPES,
  ...LATIN_RECIPES,
  ...MARK_RECIPES,
  ...CYRILLIC_RECIPES,
  ...GREEK_RECIPES,
};

/**
 * Every way this letter can be drawn, the default one first.
 *
 * The default has no identifier of its own: a letter that has never been given
 * an alternate is not carrying a choice, it is simply itself.
 */
export function formsOf(name: LetterName): Array<{ id: string; label: string; hint: string }> {
  const others = ALTERNATES[name] ?? [];
  if (others.length === 0) return [];
  return [
    { id: "", label: "Default", hint: "The letter as this face draws it." },
    ...others.map(({ id, label, hint }) => ({ id, label, hint })),
  ];
}

/**
 * Every form of a letter that can be drawn, which is not the same list.
 *
 * `formsOf` answers a picker's question -- what is there to choose between --
 * and a letter carrying no alternate is not a choice, so it answers with
 * nothing. Seven loops across the tests and the scripts read that list to
 * decide what to draw, and so drew nothing: thirty-six of the fifty letters,
 * every capital but seven, the whole of the round letters. A Formal Script `Y`
 * in two pieces sat in front of all of them and none of them saw it, and the
 * one test that did catch it was the one that had never been given the forms
 * loop at all.
 *
 * So: the ids to draw, always at least the default.
 */
export function everyFormOf(name: LetterName): Array<{ id: string; label: string; hint: string }> {
  const forms = formsOf(name);
  if (forms.length > 0) return forms;
  return [{ id: "", label: "Default", hint: "The letter as this face draws it." }];
}

/** The recipe for a letter, in whichever form has been chosen. */
export function recipeOf(name: LetterName, form?: string): ((style: Style) => Recipe) | undefined {
  const build = form
    ? (ALTERNATES[name]?.find((alternate) => alternate.id === form)?.build ?? LETTERS[name])
    : LETTERS[name];
  if (!build) return undefined;
  /*
   * Every letter starts with nothing collected.
   *
   * A recipe that builds a spine and thinks better of it leaves what that spine
   * said behind, and without this it would be handed to the next run inked --
   * which might be the next run of the next letter. One line, and the run-level
   * collection cannot leak across a boundary it was never meant to cross.
   */
  return (style: Style) => {
    // Carried so that a symbol built out of a letter draws the same letter the
    // font does: an ordinal on a font with the single-storey a is that a.
    beginLetter(form);
    return connected(name, build(style), style);
  };
}

/**
 * The letters a joined face reaches out of, which is the lowercase and nothing
 * else.
 *
 * Not an oversight about the capitals. A cursive capital is a different letter
 * from a cursive lowercase rather than a larger one -- it is swashed, it is
 * built from a flourish rather than from a stem, and in every hand that has
 * ever been written it joins on its right at best and usually on neither side.
 * Reaching a lead-in out of the left of a script `A` would draw a stroke into a
 * letter nothing is ever set before.
 *
 * The figures and the punctuation are out for the plainer reason that nothing
 * joins to them either.
 */
export const JOINS = new Set<string>("abcdefghijklmnopqrstuvwxyz".split(""));

/**
 * The capitals, which reach out on their right and never on their left.
 *
 * Which is the whole of what makes a written capital a written capital rather
 * than a roman one leaning over. A hand sets a capital at the start of a word
 * and carries straight on out of it into the lowercase; nothing is ever set
 * before it, so a lead-in out of its left would be a stroke reaching into an
 * empty page.
 *
 * Four are left out because in a written hand they are the ones a pen finishes
 * on the wrong side of. An `O`, a `D`, a `P` and a `B` all close their bowl at
 * the top, and the hand lifts there rather than carrying on -- so the letter
 * after one of them starts a fresh stroke, which is what the reader sees in
 * every copperplate ever cut.
 *
 * And two more for a harder reason: the hand-over draws them into a different
 * letter. Every lead-out leaves along the baseline, and on an `F` the baseline
 * is exactly where an `E` keeps its bottom arm -- so an `F` that hands on *is*
 * an `E`, and `Fox` sets as `Eox`. An `I` with a foot going right is an `L`.
 * Neither is a matter of taste or of how far the stroke reaches: it is the
 * letter as `cmap` maps it, which is what a reader gets in any renderer that
 * applies no features at all.
 *
 * Nothing else in the alphabet does it. Drawn with and without their lead-outs
 * side by side, the other twenty carry a tail off a terminal that was already
 * pointing that way -- the `E` and the `L` simply grow a longer bottom arm, and
 * the rest end in clear air.
 */
const NEVER_HANDS_ON = new Set(["B", "D", "F", "I", "O", "P"]);
export const CAPITALS = new Set<string>("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));

/** Which halves of the join this letter has, if any. */
export function joinEnds(name: string): Ends {
  if (JOINS.has(name)) return BOTH_ENDS;
  if (CAPITALS.has(name) && !NEVER_HANDS_ON.has(name)) return { entry: false, exit: true };
  return { entry: false, exit: false };
}

/**
 * Whether the cursive loop belongs on this letter.
 *
 * It is an ascender's loop and a descender's, and a capital has neither -- it
 * is a capital, not a tall lowercase. The eye is struck straight down from the
 * highest end of the letter and it does not ask what that end belongs to, so
 * every capital built on an upright was taking one: `ITEM LIFT` came out of
 * the Formal Script as `P PEM PPF P`, the `I` and the `T` both reading as a
 * `P` because on both of them the loop is the only thing the eye finds first.
 *
 * Not that a written capital never has a loop -- half of them do, in a formal
 * hand. But the loop on a capital is part of how that capital is drawn, sized
 * and placed by whoever drew it, and this one is a semicircle of so many pen
 * widths struck on whatever stem stands highest. That is the right construction
 * for the ascender it was written for and no construction at all for a `T`.
 *
 * And the `p` has neither, which is a fact about the order the strokes are
 * made in rather than about the letter's shape. A loop is what a pen leaves
 * when it turns round at the end of a stroke and carries on. On a `g`, a `y`,
 * a `j` and an `f` the descender is the last thing drawn, so it turns; on a
 * `p` it is the first, and the pen lifts at the bottom of it and comes back up
 * to start the bowl. The reference draws it exactly so -- its `p` is a single
 * stroke 0.18 of an x-height wide at every depth below the line, where its `q`,
 * `g`, `y`, `j` and `f` all read as two.
 *
 * It cost the `p` a fifth of its width. The loop swung out to the left of the
 * stem and the spacing counted that swing as part of the letter, so the `p`
 * came out at 1.19 to 1.34 of its own face's `o` against the reference's 1.07,
 * and at 1.01 to 1.07 with the loop turned off.
 */
/*
 * And the `d`, which the reference draws with no loop at all.
 *
 * It is the one ascender in the font that does not take one. Read across the
 * ascender the reference's `l`, `h`, `b`, `k` and `f` all come to two runs of
 * ink -- a loop and the stem beside it -- and every one of them spans 0.39 to
 * 0.54 of an x-height. Its `d` is a single run of 0.24 to 0.27 at every height,
 * which is one stroke and its lean and nothing else: the ascender goes up,
 * curves over to the right, and comes back down into the bowl.
 *
 * Ours gave it the loop the others have, two runs and 0.37 to 0.52 wide, so the
 * `d` carried an ornament no `d` in the reference has.
 */
const NO_LOOP = new Set(["p", "thorn", "d", "dcroat"]);

export function takesLoop(name: string): boolean {
  return !CAPITALS.has(name) && !NO_LOOP.has(name);
}

/** Whether the join reaches out of this letter at all, on either side. */
export function reachesEither(name: string): boolean {
  const ends = joinEnds(name);
  return ends.entry || ends.exit;
}

/**
 * Which half of the join, if either, this drawing of a letter takes high.
 *
 * Module state with a scoped setter, which is how everything else here that has
 * to reach a recipe without threading a parameter through it is done: the wave
 * book does it, and so does the alternate a symbol borrows. The alternative was
 * an eighth positional argument on `drawLetter`, which already has seven.
 *
 * It cannot be the `form` argument, which is the other obvious place. A face
 * that draws the two-storey `a` needs the alternate of its `a` to be the
 * two-storey one *and* to come in high, and `form` can only say one of those.
 */
let takingHigh: { entry?: boolean; exit?: boolean } = {};

/**
 * Draw whatever this does with one half of every join taken high.
 *
 * For building the contextual alternates, and nothing else calls it: the plain
 * glyphs of a joined face all meet each other at the low seam, which is what
 * makes the font correct in a renderer that never applies the feature. The flag
 * is put back afterwards whatever happens, because a letter drawn high by
 * accident is a letter that does not meet the one before it.
 */
/**
 * Which half of its join this drawing of a letter goes without.
 *
 * The same module-scoped, scoped-setter arrangement as `takingHigh` above, and
 * for the same reason: a second drawing of a letter that a shaper swaps in.
 *
 * A word does not begin with a stroke reaching out of its first letter towards
 * nothing, or end with one reaching out of its last. The letter as `cmap` maps
 * it has both halves, so a renderer that never applies a feature still gets a
 * face whose letters meet; these are the drawings for the two ends of a word.
 */
let endsWithout: Partial<Ends> | null = null;

export function joiningWithout<T>(which: Partial<Ends>, run: () => T): T {
  const was = endsWithout;
  endsWithout = which;
  try {
    return run();
  } finally {
    endsWithout = was;
  }
}

export function joiningHigh<T>(which: { entry?: boolean; exit?: boolean }, run: () => T): T {
  const was = takingHigh;
  takingHigh = which;
  try {
    return run();
  } finally {
    takingHigh = was;
  }
}

/** The end of whichever open stroke finishes furthest right. */
function rightmostEnd(strokes: Array<{ spine: Spine }>): Vec2 | null {
  let best: Vec2 | null = null;
  for (const { spine } of strokes) {
    if (spine.closed) continue;
    const end = spineEnd(spine);
    if (!best || end.x > best.x) best = end;
  }
  return best;
}

/**
 * How heavy a join is drawn against the letters it joins.
 *
 * The whole pen at a text weight. Past it the joins give some of it back: a
 * heavy script is heavy in its down-strokes, and its connecting strokes stay
 * the up-strokes they are. Drawn at the stem's weight, a Black joined face
 * laid a bar as heavy as its stems between every two letters and `minimum`
 * was one black ribbon. A written letter's own lead-in is a join too and is
 * drawn at the same weight, or the two halves of one stroke would not match.
 */
export function joinWeight(style: Style): number {
  return 1 - 0.45 * Math.min(1, blackness(style));
}

/**
 * Where a written letter's own lead-in has to cross its origin, in the
 * letter's own drawing, and on what heading.
 *
 * A written letter carries its up-stroke as part of itself, and the join layer
 * slides it until that stroke crosses the origin at the seam. It used to be
 * struck from the writing line, which put everything below the seam to the
 * left of the origin -- inside the letter before, where it cut straight across
 * that letter's last stem and its lead-out: `in`, `an` and `mn` each had an X
 * at the join, and `vn` a V with a 4 after it. So the recipe asks here instead,
 * and starts its stroke at the seam, on the heading the letter before arrives
 * on, carrying on past it only by the weld every join has.
 *
 * In the recipe's coordinates: `connected` lifts a letter off its line before
 * the join is planned, so the seam the recipe has to hit is that much lower.
 */
export function writtenLead(
  name: string,
  style: Style,
  /*
   * Which end of the letter the stroke is at. A written `r` hands on from the
   * end of its arm through a valley, and that is its lead-out: struck off the
   * entry's seam, the `r` that arrives high after an `o` fell only to the
   * waist, and came out 125 units narrower than the `r` it stands in for --
   * so the letter after it started where the `r` had not finished. The exit
   * is taken high only by the letters that hand over high, as `connected`
   * plans the join itself.
   */
  end: "entry" | "exit" = "entry",
): Lead {
  const script = style.parts.script;
  const f = frame(style);
  const seams = seamsOf(script, f.x, f.half);
  const asked =
    end === "entry"
      ? takingHigh.entry === true
      : takingHigh.exit === true && HANDS_OVER_HIGH.has(name);
  const high = asked && seams.high > seams.low + 1e-9;
  const lift = script.on ? wobbleOf(name, script, f.x).lift : 0;
  const unit = scriptUnit(style);
  const reach = script.reach * unit;
  const weld = Math.max(0, script.knit) * unit + Math.max(0, Math.min(1, script.flat)) * reach;
  const low: Lead = { y: seams.low - lift, way: seamHeading(script, false), weld, high: false };
  if (!high) return low;
  return { y: seams.high - lift, way: seamHeading(script, true), weld, high, low };
}

/** Where a written lead-in crosses its seam and how; see `writtenLead`. */
export interface Lead {
  y: number;
  way: { x: number; y: number };
  weld: number;
  high: boolean;
  /** The same lead-in taken low, which a high one keeps the reach of. */
  low?: Lead;
}

/**
 * The letter with its lead-in and lead-out, for a face that connects.
 *
 * Done here rather than in `finish` because `finish` does not know which letter
 * it is finishing, and the answer for a capital is different from the answer
 * for an n. Done after the recipe rather than inside it so that every one of
 * the ninety-odd recipes below stays a description of a letter and none of them
 * has to know this exists.
 *
 * The width comes back stated rather than measured. Every other letter in this
 * engine takes its advance from where its ink happened to stop, which is right
 * when the gap either side is empty space and wrong when the gap is a stroke:
 * the exit has to stop *on* the advance, to the unit, or the next letter's
 * entry starts somewhere the last one did not finish.
 */
function connected(name: LetterName, recipe: Recipe, style: Style): Recipe {
  const script = style.parts.script;
  /*
   * A word does not begin with a connecting stroke, so the letter that begins
   * one is drawn rather than written.
   *
   * A written letter carries its own lead-in -- the up-stroke it is entered
   * with is the first part of its own path, not a stroke laid against it -- and
   * that is exactly the stroke a boundary form exists to drop. Left on, the
   * first letter of a word reaches back past its own origin and the word hangs
   * over its own left margin, and there is no join for it to hang over.
   *
   * The join layer cannot take it off, because by then it is one of the
   * letter's own strokes and indistinguishable from the rest. So the recipe is
   * asked again, in its plain form, before anything else is done to it: the
   * `.begin` drawing of a written `n` is the drawn `n`, which is the letter
   * that has a lead-in to lose and loses it. Everything downstream -- the bow,
   * the loops, the spacing, the promise that a boundary form is narrower than
   * the letter it stands in for -- then holds unchanged.
   */
  if (recipe.entered && script.on && endsWithout?.entry === false && LETTERS[name]) {
    recipe = LETTERS[name](style);
  }
  // And a letter written to hand on from the end of its last stroke, with
  // nothing to hand on to, is the drawn one and finishes that stroke on the
  // face's own terminal.
  if (recipe.leaves && script.on && endsWithout?.exit === false && LETTERS[name]) {
    recipe = LETTERS[name](style);
  }
  /*
   * The bow first: the letters are bowed before their loops are found and
   * their joins are planned, so both are struck against the letter as it
   * really ends up rather than against a straight one it never was.
   *
   * The lowercase only. A capital is set down deliberately at the head of a
   * word -- the same reason it takes no bounce -- and its strokes meet at
   * points that were solved with them straight: bowed, the stems of the
   * Handwriting's and the Formal Script's `M`, `N` and `W` stood off their
   * diagonals in ledges at every apex, and the `Q`'s tail knotted.
   */
  if (script.on && script.bow > 0 && joinEnds(name).entry) {
    const half = style.pen.weight / 2;
    recipe = {
      ...recipe,
      strokes: recipe.strokes.map((stroke) => ({
        ...stroke,
        spine: bowRuns(stroke.spine, script.bow, half),
      })),
    };
  }
  /*
   * What the letter has, less whatever this drawing is doing without.
   *
   * The override can only take a half away, never hand one over: a capital that
   * gained a lead-in because something asked for one would be reaching into a
   * letter nothing is ever set before, which is the thing `joinEnds` exists to
   * prevent.
   */
  const has = joinEnds(name);
  const without = endsWithout ?? {};
  const ends: Ends = {
    entry: has.entry && without.entry !== false,
    exit: has.exit && without.exit !== false,
  };
  /*
   * Asked on what the letter *has*, not on what this drawing kept. A letter
   * that never joins -- a capital that hands on to nothing, a digit, a comma --
   * has no business in the join layer and is spaced as the roman letter it is.
   * A letter that joins and has been asked to give up both halves is still a
   * letter of a joined face, and has to be spaced like one: it goes through,
   * and comes out with the room either side and no strokes in it.
   */
  if (!script.on || enclosing || (!has.entry && !has.exit)) return recipe;
  const f = frame(style);
  /*
   * Off its line first, then the join, then over into its room.
   *
   * The order is the whole of why an unsteady hand does not open the joins. The
   * letter is lifted before the join is planned, so the join is drawn to where
   * the letter actually ended up rather than to where it would have been -- the
   * lead-in climbs a little further on a letter that bounced up and a little
   * less on one that dropped, and both still leave the seam at exactly the
   * height everything else leaves it at.
   */
  const room = {
    half: f.half,
    upright: f.upright,
    // What the pen is certain to reach, which is what it is at its narrowest.
    narrow: f.half * Math.max(0, 1 - Math.abs(style.pen.contrast)),
    x: f.x,
    unit: scriptUnit(style),
    sidebearing: f.edge - f.half,
  };
  /*
   * Loops first, then the lift, then the join. The order is the whole of why
   * this works, and each step of it was wrong once.
   *
   * The loops are found on the letter as its recipe drew it, before the hand
   * has moved it anywhere. Found afterwards instead, a letter the hand happened
   * to drop had stroke ends below the baseline that its recipe never put there
   * -- so an `m` grew a descender loop, and hung ninety-five units under a line
   * it is supposed to stand on.
   *
   * The lift then moves the letter and its loops together, before the join is
   * planned, so the join is drawn to where the letter actually ended up rather
   * than to where it would have been. The seam never moves; the lead-in simply
   * climbs a little further or a little less.
   *
   * And the join is planned last of all, with the loops already part of the
   * letter it is measuring -- a loop reaches left of the stem it is on, and a
   * lead-in drawn to the stem instead would cross it.
   */
  /*
   * Which height each half of this letter's join crosses at, and the plain
   * answer is: both low.
   *
   * A written `o`, `v`, `w` and `b` hand over at the waist where everything
   * else hands over at the baseline -- but that is a fact about the *pair*, and
   * drawing it into the letter is what would make this font wrong wherever the
   * feature is not applied. So the letter as it is mapped in `cmap` joins low at
   * both ends like every other, and the high hand-over lives in a second
   * drawing that a shaper swaps in when the pair actually occurs. `o` and the
   * letter after it are both replaced, so the two that meet always agree.
   */
  const seams = seamsOf(script, f.x, f.half);
  const crossing = {
    entry: takingHigh.entry ? seams.high : seams.low,
    exit: takingHigh.exit && HANDS_OVER_HIGH.has(name) ? seams.high : seams.low,
  };
  const loops = planLoops(
    recipe.strokes.map((stroke) => stroke.spine),
    room,
    script,
    takesLoop(name),
  );
  /*
   * And the hand is only unsteady in the middle of a word.
   *
   * A capital is set down deliberately at the start of one, on the line, and
   * the bounce is a property of a running hand rather than of every letter that
   * hand ever writes. Lifted with the rest, the capitals came off their lines by
   * thirty units on the Handwriting and fifty on the Casual Script -- which is
   * the one thing every face here promises not to do.
   */
  const lift = ends.entry ? wobbleOf(name, script, f.x).lift : 0;
  /*
   * A loop is the up-stroke of the letter it hangs on -- the hand going up to
   * turn round and come back down the stem -- and a pen with contrast draws its
   * up-strokes light. Drawn at the stem's weight on a nib held at an angle, the
   * eye of a `b` or an `l` swelled into a black crescent round a sliver of a
   * counter, and a `y`'s closed up altogether. A monoline pen has no light
   * stroke to give, so there it is the stem's.
   */
  const loopWeight = (1 - 0.45 * Math.min(1, Math.abs(style.pen.contrast))) * joinWeight(style);
  const body = [
    ...recipe.strokes,
    ...loops.map((loop) => lighter(ink(f, loop, BUTT, BUTT), loopWeight)),
  ].map((stroke) => ({
    ...stroke,
    spine: movedSpine(stroke.spine, 0, lift),
  }));
  const plan = planJoin(
    body.map((stroke) => stroke.spine),
    room,
    script,
    crossing,
    ends,
    recipe.round,
    // Where this letter's waist has ended up, so what rises above it can hang
    // over the letter beside it -- and `null` for a capital, which has no
    // letter set before it and is spaced off the whole of its own ink.
    has.entry ? f.x + lift : null,
    recipe.air,
    recipe.entered === true,
    recipe.leaves ? rightmostEnd(body.slice(0, recipe.strokes.length)) : null,
  );
  if (!plan) return recipe;
  /*
   * The letter moves over; the join does not.
   *
   * The lead-in needs a run of its own to climb along, and on a joined face
   * there is no sidebearing for it to borrow -- the space either side of a
   * letter here is the join itself. So the letter is given that room by being
   * slid into it, and the join is drawn where it already belongs.
   */
  const strokes = body.map((stroke) => ({
    ...stroke,
    spine: movedSpine(stroke.spine, plan.inset, 0),
  }));
  /*
   * Cut square at both ends, whatever the face's terminal is.
   *
   * The seam end has to be: two square cuts along the same line meet exactly,
   * and a round cap would add half a pen of length to each half of the join and
   * push the two ends through each other. The buried end is square because
   * nothing can see it.
   */
  const light = joinWeight(style);
  if (plan.entry) strokes.push(lighter(ink(f, plan.entry, BUTT, BUTT), light));
  if (plan.exit) strokes.push(lighter(ink(f, plan.exit, BUTT, BUTT), light));
  return { ...recipe, strokes, width: plan.width };
}
