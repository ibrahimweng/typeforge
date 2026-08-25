/**
 * Saying out loud when a setting has gone somewhere the font cannot follow.
 *
 * The letters here cannot fold, and that is worth something, but it is not the
 * same as the letters being all right. A pen wide enough closes the counter of
 * an e until it is a scratch; a rhythm narrow enough runs the two stems of an n
 * together; an x-height taller than the cap height is a font, just not one
 * anybody meant.
 *
 * None of that is a fault to be prevented -- somebody drawing a display face
 * may want to go exactly there, and a tool that refused would be worse than one
 * that let it happen. What is a fault is finding out later. So the drawing is
 * measured after every change and anything that has closed up is named, with
 * the letters it happened to, while there is still a slider under the hand that
 * caused it.
 *
 * Everything here is measured off the outlines rather than inferred from the
 * settings, because a setting is only ever an argument about what the drawing
 * will do and the drawing is the thing itself.
 */

import { contourArea, contoursBounds } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { builtFrom, letterNames } from "./build";
import { draw, familyOf, weighted, type Forge } from "./document";
import { nameOfWeight, weightsOf } from "./family";

export interface Trouble {
  /** What has gone wrong, in one line. */
  what: string;
  /** Which letters it happened to, worst first. */
  letters: string[];
  /** What to reach for. */
  fix: string;
}

/**
 * How narrow a counter may get before it is worth mentioning, as a fraction of
 * the em.
 *
 * Forty-five thousandths is about where a hole stops reading as a hole and
 * starts reading as a printing fault. It is well under what a display face uses
 * on purpose -- the heaviest of the three bases keeps a hundred and forty units
 * in the tightest counter it has, and a pen of two hundred and sixty on a
 * five-hundred-and-twenty x-height still keeps fifty -- so this stays quiet on
 * a heavy cut that works and speaks up on one that has stopped.
 */
const TIGHT = 0.045;

/** Said in one place, because the family check looks for it by name. */
const CLOSING = "Counters closing up";

/** Above this many letters, a list of them stops being something to act on. */
const MANY = 12;

/**
 * The whole typeface, weight by weight.
 *
 * A family's Regular can be perfect and its Black unusable, and the Black is
 * the one nobody is looking at while they draw. Every weight is measured, and
 * the ones that have closed up are named by their own names rather than by
 * their letters -- "the Black and the ExtraBold" is what somebody can act on;
 * a list of forty letters from a weight they have not seen is not.
 */
export function familyTroubles(forge: Forge): Trouble[] {
  return allOf(familyWalk(forge));
}

/**
 * The same walk, handed back a letter at a time.
 *
 * This is the most expensive thing on the draw page and it runs after every
 * change: the whole alphabet, at every weight the family has, drawn in full --
 * and with a cast switched on a letter costs several milliseconds, so the pass
 * takes a second or two. Run in one go it is one task that long, and a task
 * that long is a window that does not answer: the release of a slider froze the
 * page for as long as it took.
 *
 * Nothing about the work got cheaper. What changed is that it can be put down:
 * the caller runs it a few milliseconds at a time between frames and drops it
 * if the font moves again first, so the same answer arrives at the same moment
 * without the page going deaf to get there.
 *
 * Both entry points stay as they were -- everything that wants the answer and
 * does not care about frames, the tests included, calls the plain function.
 */
export function* familyWalk(forge: Forge): Generator<void, Trouble[], void> {
  const family = familyOf(forge);
  const weights = weightsOf(family);
  const found = yield* walk(forge);
  if (weights.length < 2) return found;

  const closed: string[] = [];
  const letters = new Set<string>();
  for (const weight of weights) {
    if (weight === family.drawn) continue;
    const gone = yield* walk(weighted(forge, weight));
    const tight = gone.find((one) => one.what === CLOSING);
    if (!tight) continue;
    closed.push(nameOfWeight(weight));
    for (const letter of tight.letters) letters.add(letter);
  }
  if (closed.length > 0) {
    found.push({
      // Named for the weights rather than for the letters, because the letters
      // are the same ones every time and the weight is the thing to act on.
      what: `${said(closed)} ${closed.length === 1 ? "closes" : "close"} up`,
      letters: [...letters],
      fix: "Take those out, or say the drawing is heavier than a Regular, which moves the whole family down with it.",
    });
  }
  return found;
}

/** A list of names as somebody would read it out, to start a sentence with. */
function said(names: string[]): string {
  const the = names.map((name, at) => `${at === 0 ? "The" : "the"} ${name}`);
  if (the.length === 1) return the[0];
  return `${the.slice(0, -1).join(", ")} and ${the[the.length - 1]}`;
}

export function troubles(forge: Forge): Trouble[] {
  return allOf(walk(forge));
}

/** Run a walk to the end without stopping, for a caller with no frames to keep. */
function allOf(walking: Generator<void, Trouble[], void>): Trouble[] {
  let step = walking.next();
  while (!step.done) step = walking.next();
  return step.value;
}

function* walk(forge: Forge): Generator<void, Trouble[], void> {
  const em = forge.style.metrics.unitsPerEm;
  const closing: Array<{ letter: string; room: number }> = [];
  const overflowing: string[] = [];
  const touching: string[] = [];
  const inPieces: string[] = [];
  const erased: string[] = [];

  const ceiling = forge.style.metrics.ascender + forge.style.pen.weight;
  // What an accented letter is allowed, which is more: a third again over the
  // capitals is about where a text face keeps its own.
  const capped = forge.style.metrics.capHeight * 1.4 + forge.style.pen.weight;
  const floor = forge.style.metrics.descender - forge.style.pen.weight;

  for (const letter of letterNames()) {
    // Offered before the letter rather than after it, so a caller that has run
    // out of time in this frame stops without having paid for one more.
    yield;
    const drawn = draw(letter, forge);
    if (!drawn) continue;
    /*
     * A letter cut away to nothing.
     *
     * Always a fault, and the only thing here that is: every other complaint
     * is about a letter that has gone somewhere extreme on purpose, and this
     * one is a hole in the alphabet with nothing in the settings to say which
     * letter it happened to.
     *
     * Asked of the cut rather than of the outline, because a letter with no
     * ink is not by itself unusual -- the space has none and is exactly right.
     * What is wrong is ink that was there before the cut and is not there
     * after it, which is the one thing the count can say and an empty outline
     * cannot.
     */
    if (drawn.contours.length === 0) {
      if (drawn.cut && drawn.cut.was > 0) erased.push(letter);
      continue;
    }
    if (drawn.cut && drawn.cut.pieces > drawn.cut.was) inPieces.push(letter);

    /*
     * A counter is a contour wound against the ink, which is now true by
     * construction: every outline the sweep produces is wound to match its
     * neighbours so that overlapping strokes add rather than cancel, and the
     * only shapes left running the other way are holes.
     *
     * Working it out from nesting instead read the two diagonals of an X as one
     * being inside the other, because the middle of the second sits inside the
     * ink of the first, and reported a counter the letter does not have.
     */
    for (const contour of drawn.contours) {
      if (contourArea(contour) >= 0) continue;
      const room = narrowest(contour);
      if (room < em * TIGHT) closing.push({ letter, room });
    }

    const bounds = contoursBounds(drawn.contours);
    /*
     * An accented letter stands above the ascender because that is where its
     * accent goes, so it is measured against a ceiling of its own rather than
     * reported as a fault. Without this every font ever drawn here opened with
     * twenty complaints about letters that were exactly right, which is the
     * fastest way to teach somebody to stop reading the warnings.
     */
    const roof = builtFrom(letter) ? capped : ceiling;
    if (bounds.yMax > roof || bounds.yMin < floor) overflowing.push(letter);
    if (bounds.xMin < em * 0.005) touching.push(letter);
  }

  const found: Trouble[] = [];
  if (erased.length > 0) {
    found.push({
      what: "Cut away to nothing",
      letters: erased,
      fix: "A thinner slot, a shallower saw, or a smaller counter shape. This is the one cut that leaves a hole in the alphabet.",
    });
  }
  if (inPieces.length > 0) {
    /*
     * Said, and not judged.
     *
     * Letters in pieces is what a stencil is, so this is not a fault -- and
     * whether it was meant is a thing the count answers at a glance and this
     * file could never answer at all. Forty letters in pieces is a stencil.
     * Two letters in pieces, in a font where nothing else moved, is the cut
     * that went through something it should not have.
     */
    found.push({
      what: `${inPieces.length} ${inPieces.length === 1 ? "letter is" : "letters are"} cut into pieces`,
      // Named one by one while there are few enough for the names to be worth
      // reading, and counted once there are not. A handful is a list to go and
      // look at; most of the alphabet is a fact about the font, and fourteen
      // arbitrary letters off the front of it are not a way in to anything.
      letters: inPieces.length <= MANY ? inPieces : [],
      fix: "Which is what a stencil is. If it was not meant: a narrower gap, a thinner slot, or more room at the ends.",
    });
  }
  if (closing.length > 0) {
    closing.sort((one, other) => one.room - other.room);
    found.push({
      what: CLOSING,
      letters: [...new Set(closing.map((one) => one.letter))],
      fix: "Lighter, wider, or a taller x-height.",
    });
  }
  if (overflowing.length > 0) {
    found.push({
      what: "Reaching past the line",
      letters: overflowing,
      fix: "A shorter ascender or descender, or less weight.",
    });
  }
  if (touching.length > 0) {
    found.push({
      what: "Touching the letter before it",
      letters: touching,
      fix: "More spacing.",
    });
  }
  return found;
}

/**
 * The narrowest a counter gets.
 *
 * Not its area: a long thin slot and a small round hole can have the same area
 * and only one of them is a problem. Measured instead as the smallest distance
 * across it, which is the thing that decides whether it survives being printed
 * or rendered small.
 *
 * Taken as the shorter side of the box it sits in, which is exact for the
 * shapes counters actually are -- rings, ovals, rounded rectangles -- and
 * cheap, which matters because this runs over the whole alphabet after every
 * change to a slider.
 */
function narrowest(counter: Contour): number {
  const room = Math.abs(contourArea(counter));
  if (room < 1e-9) return 0;
  const bounds = contoursBounds([counter]);
  const across = Math.min(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin);
  // A counter that has been squeezed into a crescent has a box much larger than
  // the room inside it, so the area is used as a second opinion: a shape can
  // never be wider than its area divided by its longer side.
  const along = Math.max(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin);
  const byArea = along > 0 ? room / along : 0;
  return Math.min(across, byArea * 1.6);
}
