/**
 * Making the letter look like something drew it.
 *
 * Four operations, run in the order the tool itself would have imposed them:
 * the stroke swells and thins under the hand, ink gathers where the hand
 * paused, the tool skips where it ran dry, and the whole edge is a little
 * uncertain because paper is. Everything here works on the finished outline,
 * for the reason set out in `@/font/effects` -- the sweep is exact and has to
 * stay exact, so nothing that varies along a stroke can live inside it.
 *
 * Three of the four need the skeleton. Where the tool pressed, where it paused
 * and where it skipped are facts about the path the hand took, and an outline
 * does not remember one. Only the roughening works on ink alone, which is why
 * it is the only one that reaches a letter somebody imported.
 *
 * Everything is seeded and nothing is random. The same settings on the same
 * letter give the same outline every time, which is not a nicety: a letter
 * that came out differently on each draw could not be cached, could not be
 * compared with itself, and would flicker under the hand.
 */

import { contourArea, flattenContour, rayHitDistance, reverseContour } from "@/font/geometry";
import { loaded, subtract, unite, type Roles } from "@/font/boolean";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import {
  anyEffect,
  EFFECT_NAMES,
  FROM_SKELETON,
  noEffects,
  NO_EFFECTS,
  sameEffect,
  type EffectName,
  type Effects,
  type HeaviestAt,
  type PoolWhere,
  type RoughReach,
} from "@/font/effects";
import type { CutScale } from "./cut";
import { alongSpine } from "./shapes";
import { penReach, reachAlong } from "./sweep";
import type { Stroke } from "./types";

export {
  anyEffect,
  EFFECT_NAMES,
  FROM_SKELETON,
  noEffects,
  NO_EFFECTS,
  sameEffect,
  type EffectName,
  type Effects,
  type HeaviestAt,
  type PoolWhere,
  type RoughReach,
};

/** How many places along a spine are looked at. Enough to follow a bowl. */
const SAMPLES = 64;

/**
 * How many for the pressure, which pays for each one twice over.
 *
 * Every sample on every flank casts a ray at the letter's own outline to find
 * where the ink really stops, and each ray is tested against every edge of it.
 * At sixty-four that came to some forty million tests across a font and took a
 * hundred seconds to write one; at twenty-four it is under twenty, and the
 * taper is a smooth thing that twenty-four points describe as well as sixty-four
 * -- the quads between them are what get subtracted, and they were never going
 * to show the difference.
 */
const PRESS_SAMPLES = 24;

/**
 * How finely the outline is flattened for those rays to hit.
 *
 * Coarser than the roughening's own flattening on purpose. This one is only
 * ever asked "how far to the edge", and an answer off by a unit moves a cut by
 * a unit -- where the roughening's flattening becomes the letter and has to
 * follow every curve it is given.
 */
const RAY_STEPS = 4;

/**
 * The most of a stroke's own half-width one flank may cut away.
 *
 * Both flanks cut, so what is left where the hand was lightest is one part in
 * five of what the stroke had. A stroke can be taken to a hairline by pressing
 * and no further: a press that meets itself in the middle is not a light touch,
 * it is a stroke that has been cut in two.
 */
const MOST_OF_A_STROKE = 0.9;

/**
 * How far past its own half-width a ray may find ink before it has to be
 * treated as having escaped.
 *
 * A stroke is swept by a pen of one width, so its flank is half that from the
 * spine -- further out where a join or a slab has pushed it, and nearer where
 * contrast has pulled it in. A ray that comes back with much more than that did
 * not find this stroke's edge: it left through a junction and hit the far side
 * of the letter, and a wedge built on it is a band laid across ink belonging to
 * something else.
 *
 * Two and a half was the first number and it is a long way past any real flank.
 * The Formal Script's `n` came out with a notch cut through its shoulder, its
 * `i` bitten into and its `l` cut in two at the baseline -- all three at
 * junctions, and all three still there with the cut set to nothing, which is
 * what says the depth was never what was wrong.
 */
const ESCAPED = 1.6;

/**
 * How wide the pen really is across one direction, which is not half its
 * weight on any face that has contrast.
 *
 * The same measurement the flare takes to find where a stroke's own edge is,
 * and it is what the ray has to be believed against. Bounded by a share of the
 * *nominal* stem, a hairline on a face with contrast is under half of it, so a
 * ray that had escaped through a junction and come back with the far side of
 * the letter still looked plausible.
 */
function penHalfAcross(stroke: Stroke, normal: Vec2): number {
  const shift = reachAlong({ x: -normal.y, y: normal.x }, penReach(stroke.pen));
  return Math.hypot(shift.x, shift.y);
}

/**
 * Whether any effect that is on can do anything to this ink.
 *
 * Not the same question as whether any are on. Three of the four are found
 * from the skeleton, so a letter that arrived as an outline -- and a space,
 * which has no strokes at all -- is reached only by the roughening.
 */
export function reachesEffects(effects: Effects | undefined, strokes: Stroke[]): boolean {
  if (effects === undefined) return false;
  return EFFECT_NAMES.some(
    (name) => effects[name].on && (strokes.length > 0 || !FROM_SKELETON.has(name)),
  );
}

/**
 * The letter as the tool left it.
 *
 * The order is the order a hand would have made them in, and it is not
 * arbitrary. The pressure is part of the stroke's body, so it is taken off
 * first, on clean geometry. The pools are ink the tool left, so they gather on
 * the stroke as it now is. The skips are wear, so they come out of the
 * finished ink. And the roughening is the edge itself, so it goes last -- a
 * boolean run over an already-ragged outline multiplies its points and can
 * cross itself, and there is nothing after this to run one.
 */
export function effectInk(
  ink: Contour[],
  strokes: Stroke[],
  scale: CutScale,
  effects: Effects,
  roles: Roles = "winding",
): Contour[] {
  if (!reachesEffects(effects, strokes) || ink.length === 0) return ink;
  const stem = Math.max(scale.stem, 1);

  // Everything but the roughening is a boolean, so without the library there
  // is nothing to do but hand the letter back as it was -- which is the same
  // answer the cut and the cast give while it is still on its way.
  const canCarve = loaded();

  /*
   * Fused first, and this is the one place in the drawing where that is worth
   * doing early.
   *
   * Everywhere else the strokes are left overlapping: the fill rule hides the
   * seams and fusing on every keystroke would cost a boolean to gain nothing.
   * Here it gains something specific. A roughened edge follows the outline it
   * is given, and the outline of two overlapping strokes has edges running
   * through the middle of the letter -- so unfused, the wander is applied twice
   * along every seam, at twice the point count, to draw an edge that is not an
   * edge of the letter. Fused, there is one silhouette and it is roughened
   * once.
   */
  let shape = canCarve ? unite(ink, roles, "whole") : ink;
  if (canCarve && effects.press.on && strokes.length > 0) {
    const wedges = pressWedges(shape, strokes, effects.press, stem);
    if (wedges.length > 0) shape = subtract(shape, wedges, "winding");
  }
  if (canCarve && effects.pool.on && strokes.length > 0) {
    const pools = poolTool(strokes, effects.pool, stem);
    if (pools.length > 0) shape = unite([...shape, ...pools], "winding", "whole");
  }
  if (canCarve && effects.skip.on && strokes.length > 0) {
    const gaps = skipTool(strokes, effects.skip, stem);
    if (gaps.length > 0) shape = subtract(shape, gaps, "winding");
  }
  if (effects.rough.on) {
    shape = roughened(shape, effects.rough, stem, effects.budget);
    // The wander can carry an edge across itself where a stroke is thin or a
    // corner tight. One union afterwards resolves that into the shape somebody
    // would have drawn, and leaves the winding right for whatever writes the
    // file.
    if (canCarve) shape = unite(shape, "winding", "whole");
  }
  return shape;
}

/** How many points the finished letter is made of, for the proofing panel. */
export function pointsIn(contours: Contour[]): number {
  return contours.reduce((sum, contour) => sum + contour.nodes.length, 0);
}

// ---------------------------------------------------------------------------
// The rough edge
// ---------------------------------------------------------------------------

/** How many octaves of wander are laid over each other. */
const HARMONICS = 4;

/** How many points are laid down per full wander. Four is enough to read as one. */
const PER_WAVE = 4;

/**
 * The outline pushed off its own line as it runs.
 *
 * Resampled evenly and displaced along its own normal, which is the only way
 * of doing this that leaves the letter the same letter: adding or subtracting
 * shapes moves ink about, and a drawn edge is not ink moved about, it is the
 * same ink with a less certain boundary.
 *
 * The wander is periodic around each contour -- a whole number of waves fits
 * exactly, whatever the perimeter -- so the edge closes on itself and there is
 * no seam where the outline started. That is worth the arithmetic: a seam on a
 * round letter is the one artefact of this kind the eye finds immediately.
 */
function roughened(
  shape: Contour[],
  rough: Effects["rough"],
  stem: number,
  budget: number,
): Contour[] {
  const amplitude = rough.amplitude * stem;
  const wavelength = Math.max(rough.wavelength * stem, 4);
  if (amplitude <= 0) return shape;

  /*
   * The widest of the two spacings the letter is entitled to.
   *
   * Worked out across every contour at once rather than one at a time, because
   * the budget is a fact about the letter and a letter is not more entitled to
   * points because it happens to be made of more pieces. Taken this way, a
   * simple letter is drawn exactly as its wavelength asks and only a busy one
   * is coarsened -- and a busy one had the least room for fine grain to show
   * in to begin with.
   */
  const asked = wavelength / PER_WAVE;
  const around = shape.reduce((sum, one) => sum + perimeterOf(flattenContour(one, 8)), 0);
  const allowed = budget > 0 ? around / budget : 0;
  const spacing = Math.max(asked, allowed);

  return shape.map((contour, index) => {
    // A counter is wound against the ink. Left alone, the letter reads as
    // having been drawn with a rough tool onto a clean shape, which is what a
    // stencil looks like rather than what a marker does -- so this is offered
    // as a choice rather than decided here.
    if (rough.reach === "outside" && contourArea(contour) < 0) return contour;

    const line = evenly(flattenContour(contour, 8), spacing);
    if (line.length < 6) return contour;

    // A whole number of waves, so the last point wanders by exactly as much as
    // the first and the two meet.
    const around = perimeterOf(line);
    const waves = Math.max(1, Math.round(around / wavelength));
    // Each contour gets its own edge, or every counter in the font wanders in
    // step with the stem beside it and the letter reads as printed on corduroy.
    const seed = rough.seed * 2654435761 + index * 40503;

    const moved: Vec2[] = line.map((point, at) => {
      const before = line[(at - 1 + line.length) % line.length];
      const after = line[(at + 1) % line.length];
      const run = { x: after.x - before.x, y: after.y - before.y };
      const far = Math.hypot(run.x, run.y);
      if (far < 1e-9) return point;
      // The left normal. Which side is which does not matter: the wander is
      // signed and goes both ways.
      const normal = { x: -run.y / far, y: run.x / far };
      const push = amplitude * wobble(seed, waves, at / line.length);
      return { x: point.x + normal.x * push, y: point.y + normal.y * push };
    });
    return poly(moved);
  });
}

/**
 * Smooth, periodic, seeded wander.
 *
 * Octaves of sine laid over each other, each twice as fast and half as strong
 * as the last, with the phase of every one taken from the seed. Periodic
 * because every octave completes a whole number of turns over the interval, so
 * the value at one is the value at nought.
 *
 * Sines rather than a lattice noise because the requirement here is closure
 * rather than statistics -- a value noise would need its ends stitched, and
 * stitched noise is where seams come from.
 */
function wobble(seed: number, waves: number, t: number): number {
  let sum = 0;
  let total = 0;
  for (let octave = 0; octave < HARMONICS; octave++) {
    const strength = 1 / (octave + 1);
    const turns = waves * (1 << octave);
    const phase = hashed(seed, octave) * Math.PI * 2;
    sum += strength * Math.sin(turns * 2 * Math.PI * t + phase);
    total += strength;
  }
  return total > 0 ? sum / total : 0;
}

/** A number in [0, 1) from two whole numbers, the same one every time. */
function hashed(seed: number, index: number): number {
  let value = (seed ^ (index * 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97) >>> 0;
  value = (value ^ (value >>> 15)) >>> 0;
  return value / 4294967296;
}

/** The same line, walked at one pace. */
function evenly(points: Vec2[], spacing: number): Vec2[] {
  if (points.length < 2 || spacing <= 0) return points;
  const around = perimeterOf(points);
  if (around <= 0) return points;
  const count = Math.max(6, Math.round(around / spacing));
  const step = around / count;

  const out: Vec2[] = [];
  let at = 0;
  let walked = 0;
  let carried = 0;
  out.push(points[0]);
  while (out.length < count && at < points.length) {
    const from = points[at];
    const to = points[(at + 1) % points.length];
    const run = Math.hypot(to.x - from.x, to.y - from.y);
    if (run <= 1e-9) {
      at++;
      continue;
    }
    let want = (out.length * step) - walked;
    if (want > run) {
      walked += run;
      at++;
      continue;
    }
    while (want <= run && out.length < count) {
      const share = want / run;
      out.push({ x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share });
      want = (out.length * step) - walked;
    }
    walked += run;
    at++;
    carried++;
    if (carried > points.length * 4) break;
  }
  return out;
}

function perimeterOf(points: Vec2[]): number {
  let total = 0;
  for (let at = 0; at < points.length; at++) {
    const next = points[(at + 1) % points.length];
    total += Math.hypot(next.x - points[at].x, next.y - points[at].y);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Ink gathered
// ---------------------------------------------------------------------------

/**
 * Discs where the tool paused.
 *
 * Two places, and they are different questions. Where two strokes meet the
 * tool went over the same ground twice and left twice the ink, which is found
 * by looking for the closest approach between two spines. Where a stroke stops
 * the tool sat still for an instant before lifting, which is found by looking
 * at the ends -- and only the ends that are really ends, because a pool inside
 * a counter is a blot.
 */
function poolTool(strokes: Stroke[], pool: Effects["pool"], stem: number): Contour[] {
  const size = pool.size * stem;
  if (size <= 0) return [];
  const added: Contour[] = [];

  if (pool.where !== "ends" && strokes.length > 1) {
    const near = stem * 1.15;
    const walked = strokes.map((stroke) => alongSpine(stroke.spine, SAMPLES));
    for (let one = 0; one < walked.length; one++) {
      for (let other = one + 1; other < walked.length; other++) {
        let closest = Infinity;
        let where: Vec2 | null = null;
        for (const a of walked[one]) {
          for (const b of walked[other]) {
            const between = Math.hypot(a.x - b.x, a.y - b.y);
            if (between < closest) {
              closest = between;
              where = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            }
          }
        }
        if (closest < near && where !== null) added.push(disc(where, size * 0.62));
      }
    }
  }

  if (pool.where !== "joins") {
    for (const stroke of strokes) {
      if (stroke.spine.closed) continue;
      const walked = alongSpine(stroke.spine, SAMPLES);
      if (walked.length < 2) continue;
      if (stroke.start.open === true) added.push(disc(walked[0], size * 0.5));
      if (stroke.end.open === true) added.push(disc(walked[walked.length - 1], size * 0.5));
    }
  }
  return added;
}

// ---------------------------------------------------------------------------
// Where the tool ran dry
// ---------------------------------------------------------------------------

/**
 * Gaps taken out along the way the stroke was drawn.
 *
 * Laid along the stroke rather than scattered, because that is the difference
 * between a letter drawn with a dry marker and a letter somebody has spilled
 * something on. Each gap is a thin rectangle following the local direction of
 * the spine and pushed off to one side of it, so what is left reads as the
 * tool having lifted on one edge, which is what running dry actually looks
 * like.
 */
function skipTool(strokes: Stroke[], skip: Effects["skip"], stem: number): Contour[] {
  if (skip.density <= 0 || skip.width <= 0 || skip.length <= 0) return [];
  const long = skip.length * stem;
  const wide = skip.width * stem;
  const gaps: Contour[] = [];

  strokes.forEach((stroke, index) => {
    const walked = alongSpine(stroke.spine, SAMPLES);
    if (walked.length < 3) return;
    const along = runLength(walked);
    // One gap per stroke-length of stroke at full density, so a long stem wears
    // more than a short arm rather than the same amount.
    const many = Math.max(1, Math.round((along / (long * 2.2)) * skip.density * 4));
    const seed = skip.seed * 2246822519 + index * 668265263;

    for (let which = 0; which < many; which++) {
      const at = hashed(seed, which * 3);
      const side = hashed(seed, which * 3 + 1) < 0.5 ? -1 : 1;
      const across = (0.18 + hashed(seed, which * 3 + 2) * 0.34) * stem * side;
      const step = Math.min(walked.length - 2, Math.max(1, Math.floor(at * (walked.length - 2))));
      const here = walked[step];
      const next = walked[step + 1];
      const dx = next.x - here.x;
      const dy = next.y - here.y;
      const far = Math.hypot(dx, dy);
      if (far < 1e-9) continue;
      const tangent = { x: dx / far, y: dy / far };
      const normal = { x: -tangent.y, y: tangent.x };
      const middle = { x: here.x + normal.x * across, y: here.y + normal.y * across };
      const reach = long * (0.6 + hashed(seed, which * 3 + 1) * 0.8) * 0.5;
      const half = wide * 0.5;
      gaps.push(
        poly([
          { x: middle.x - tangent.x * reach - normal.x * half, y: middle.y - tangent.y * reach - normal.y * half },
          { x: middle.x + tangent.x * reach - normal.x * half, y: middle.y + tangent.y * reach - normal.y * half },
          { x: middle.x + tangent.x * reach + normal.x * half, y: middle.y + tangent.y * reach + normal.y * half },
          { x: middle.x - tangent.x * reach + normal.x * half, y: middle.y - tangent.y * reach + normal.y * half },
        ]),
      );
    }
  });
  return gaps;
}

// ---------------------------------------------------------------------------
// Pressure
// ---------------------------------------------------------------------------

/**
 * The stroke thinned where the hand was lightest.
 *
 * Taken off both flanks rather than swept, and the shape taken off is bounded
 * on the outside by a line well clear of the letter and on the inside by the
 * width the stroke should have arrived at. So it does not matter that the pen
 * has contrast and the flank is not where the spine says it is: the cut starts
 * outside the letter in every case and stops exactly where it is told.
 */
function pressWedges(
  ink: Contour[],
  strokes: Stroke[],
  press: Effects["press"],
  stem: number,
): Contour[] {
  if (press.amount <= 0) return [];
  /*
   * The flank is measured, not assumed.
   *
   * Three goes at this assumed the edge of a stroke sits half a pen-width from
   * its spine, and the alphabet has no such edge: contrast pulls it in on every
   * curve, a join pushes it out, a slab hangs a bar across it, and where two
   * strokes overlap there is no single flank at all. Wedges cut at a guessed
   * distance took the bowl clean off an `a` and left a `c`.
   *
   * So a ray is cast from the spine along the normal and the cut is placed
   * against wherever the ink actually stops. That is one ray per sample per
   * side, which is more arithmetic than a multiplication -- and it is the
   * difference between an effect that works on five letters and one that works
   * on all of them.
   */
  const edges = ink.map((contour) => flattenContour(contour, RAY_STEPS));
  const wedges: Contour[] = [];

  for (const stroke of strokes) {
    if (stroke.spine.closed) continue;
    const walked = alongSpine(stroke.spine, PRESS_SAMPLES);
    if (walked.length < 3) continue;
    // Still wanted, for the ray's own reach: a hit further off than this came
    // through a gap and found the far side of the letter.
    const half = Math.max(stroke.pen.weight, stem) * 0.5;
    /*
     * Only the ends that are really ends.
     *
     * Half the stroke ends in the alphabet are buried inside another stroke --
     * the bowl of an a stops inside its stem, the eye of an e runs into the
     * bowl at both ends -- and a hand lifting there is not a thing that ever
     * happened. The flare and the ball both had to learn this. So does this.
     */
    const opens = { start: stroke.start.open === true, end: stroke.end.open === true };
    if (!opens.start && !opens.end) continue;

    for (const side of [1, -1] as const) {
      const flank: Array<{ inner: Vec2; outer: Vec2 } | null> = [];
      for (let at = 0; at < walked.length; at++) {
        flank.push(flankAt(walked, at, side, press.amount, press.at, opens, edges, half, stroke));
      }
      for (let at = 0; at + 1 < flank.length; at++) {
        const here = flank[at];
        const next = flank[at + 1];
        if (!here || !next) continue;
        // Wound one way whichever flank it is on. The two sides put their
        // normals in opposite directions, so their quads come out wound
        // opposite -- and a union told to read winding takes the ones going the
        // other way for holes and cancels the strip against itself.
        wedges.push(oneWay(poly([here.inner, here.outer, next.outer, next.inner])));
      }
    }
  }
  // Fused before they are taken away, so what is subtracted is one strip down
  // each flank rather than a hundred overlapping slivers.
  return wedges.length > 0 && loaded() ? unite(wedges, "winding", "whole") : wedges;
}

/**
 * Where the ink stops on one side of the stroke, and how far into it to cut.
 *
 * Nothing is returned where the ray finds no edge, or finds one so far off that
 * it must have escaped through a gap and hit the far side of the letter. Both
 * happen -- a spine that runs outside its own ink at a tight corner, a stroke
 * that has been cut in two already -- and a wedge built on either would reach
 * across the letter.
 */
function flankAt(
  walked: Vec2[],
  at: number,
  side: 1 | -1,
  press: number,
  when: HeaviestAt,
  opens: { start: boolean; end: boolean },
  edges: Vec2[][],
  half: number,
  stroke: Stroke,
): { inner: Vec2; outer: Vec2 } | null {
  const before = walked[Math.max(0, at - 1)];
  const after = walked[Math.min(walked.length - 1, at + 1)];
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const far = Math.hypot(dx, dy);
  if (far < 1e-9) return null;
  const normal = { x: (-dy / far) * side, y: (dx / far) * side };
  const here = walked[at];

  const hit = rayHitDistance(edges, here, normal);
  // Believed against the pen this stroke is actually swept with, not against
  // the face's nominal stem: see `penHalfAcross`.
  const pen = penHalfAcross(stroke, normal);
  if (!Number.isFinite(hit) || hit > Math.max(pen, half * 0.25) * ESCAPED) return null;

  const u = at / (walked.length - 1);
  /*
   * How far to cut is measured too, and against the ink that is really there.
   *
   * Taken as a share of the nominal stem it is a fixed number of units cut into
   * whatever the stroke happens to be, and on a face with contrast the stroke
   * is not the stem: the Formal Script's hairlines are under half its stem, so
   * a cut of a third of the stem took two thirds of the hairline from each side
   * and met in the middle. That face ships with the press on, and its `n` came
   * out with a gap through the shoulder and its `l` cut in two at the baseline.
   *
   * A share of what the ray found instead, so the stroke keeps the same
   * fraction of itself wherever it is thin, and the two flanks together can
   * never take more of it than there is.
   */
  const thin =
    Math.min(hit, pen) * Math.min(press * lightness(when, u, opens), MOST_OF_A_STROKE);
  return {
    inner: { x: here.x + normal.x * (hit - thin), y: here.y + normal.y * (hit - thin) },
    // Just past the edge that was measured, so the cut always starts in air.
    outer: { x: here.x + normal.x * (hit + half * 0.3), y: here.y + normal.y * (hit + half * 0.3) },
  };
}

/**
 * How light the hand is at this point along the stroke, from nought to one.
 *
 * Nought wherever the end it is running toward is buried in another stroke,
 * because there is no lift there to draw.
 */
function lightness(at: HeaviestAt, u: number, opens: { start: boolean; end: boolean }): number {
  if (at === "middle") {
    return u < 0.5 ? (opens.start ? 1 - u * 2 : 0) : (opens.end ? u * 2 - 1 : 0);
  }
  if (at === "start") return opens.end ? u : 0;
  return opens.start ? 1 - u : 0;
}

/** How far a walked line runs from end to end. */
function runLength(points: Vec2[]): number {
  let total = 0;
  for (let at = 1; at < points.length; at++) {
    total += Math.hypot(points[at].x - points[at - 1].x, points[at].y - points[at - 1].y);
  }
  return total;
}

/** The same shape, always wound the same way round. */
function oneWay(contour: Contour): Contour {
  return contourArea(contour) < 0 ? reverseContour(contour) : contour;
}

/** A closed polygon of corners. */
function poly(points: Vec2[]): Contour {
  const nodes: GlyphNode[] = points.map((point) => ({
    point,
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  }));
  return { nodes, closed: true };
}

/** A circle, as four points with the handles that make a circle out of them. */
function disc(centre: Vec2, radius: number): Contour {
  const pull = radius * 0.5522847498;
  const around: Array<[Vec2, Vec2, Vec2]> = [
    [{ x: centre.x + radius, y: centre.y }, { x: 0, y: -pull }, { x: 0, y: pull }],
    [{ x: centre.x, y: centre.y + radius }, { x: pull, y: 0 }, { x: -pull, y: 0 }],
    [{ x: centre.x - radius, y: centre.y }, { x: 0, y: pull }, { x: 0, y: -pull }],
    [{ x: centre.x, y: centre.y - radius }, { x: -pull, y: 0 }, { x: pull, y: 0 }],
  ];
  return {
    closed: true,
    nodes: around.map(([point, into, outOf]) => ({
      point,
      handleIn: { x: point.x + into.x, y: point.y + into.y },
      handleOut: { x: point.x + outOf.x, y: point.y + outOf.y },
      type: "tangent" as const,
    })),
  };
}
