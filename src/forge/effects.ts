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
import { intersect, loaded, subtract, unite, type Roles } from "@/font/boolean";
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
import { addedOf, figuresOf, groovesOf, inGroove, untangled } from "./cast";
import type { CutScale } from "./cut";
import { alongSpine, spineLength } from "./shapes";
import { penReach, reachAlong, sweep } from "./sweep";
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
/**
 * How closely the flank is walked, at the least and at the most.
 *
 * The strip is quads between one sample and the next, and a quad has straight
 * sides. On a straight run that is exact; on a curve the sides cut the chord,
 * and if the chord is long against the pen they cut across the stroke instead
 * of along it. Twenty-four samples is plenty for a stem and nowhere near enough
 * for the long turn of a `G`: the Formal Script's came out of `proof` as two
 * fragments of fifteen hundred and twenty-four hundred units with the body of
 * the letter gone.
 *
 * So the count comes off the run's own length against the pen that draws it,
 * which is what decides how long a chord may be. The bounds are there to keep
 * a dot from costing twenty-four rays and a swash from costing a thousand.
 */
const FEWEST_SAMPLES = 24;
const MOST_SAMPLES = 160;
/** How much of a half-pen one step along the flank may cover. */
const STEP_OF_A_PEN = 0.35;

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
 * How much nearer than its own half-width a stroke's flank may be before the
 * ray that found it has to be taken for having struck a cut instead.
 */
const SHORT = 0.55;

/** Over how many samples a pressure band eases in where it starts or stops short of its stroke's end. */
const EASE = 3;

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
   * The motif's figures, which the roughening can wander into the shape of a
   * crack: a diamond set in the eye of a Marker e was filled as one, and the
   * e came back solid.
   */
  const figures = figuresOf.get(ink) ?? [];

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
  const given = shape.filter((contour) => contourArea(contour) > 0);
  if (canCarve && effects.press.on && strokes.length > 0) {
    const wedges = pressWedges(shape, strokes, effects.press, stem, groovesOf.get(ink) ?? []);
    if (wedges.length > 0) shape = takenAway(shape, wedges);
  }
  if (canCarve && effects.pool.on && strokes.length > 0) {
    const pools = poolTool(strokes, effects.pool, stem, shape);
    if (pools.length > 0) shape = unite([...shape, ...pools], "winding", "whole");
  }
  // The dry brush's streaks, which are holes in the ink on purpose: see below.
  const streaks: Contour[] = [];
  if (canCarve && effects.skip.on && strokes.length > 0) {
    const gaps = skipTool(strokes, effects.skip, stem, shape);
    streaks.push(...gaps);
    if (gaps.length > 0) shape = takenAway(shape, gaps);
  }
  if (effects.rough.on) {
    shape = roughened(shape, effects.rough, stem, effects.budget);
    // The wander can carry an edge across itself where a stroke is thin or a
    // corner tight. One union afterwards resolves that into the shape somebody
    // would have drawn, and leaves the winding right for whatever writes the
    // file.
    if (canCarve) shape = unite(shape, "winding", "whole");
  }
  /*
   * And the floor swept, once, after all of them.
   *
   * Every tool here works on the whole outline, and two of them can leave a
   * speck behind: the press cuts a straight band across an outline that steps
   * at every junction, and the roughening carries an edge across itself where a
   * stroke is thin. Done after the press alone it caught the press's; the
   * Brush's `e`, `f`, `k`, `u`, `v` and `w` kept theirs, because the wander
   * comes afterwards and makes its own.
   */
  /*
   * A splinter is thinner than anything the letter means to draw, and on a
   * contrast face that is less than a share of the stem: the hairlines of a
   * Formal Script are under an eighth of one, and every hairline end a slot
   * had left was taken for a splinter -- a slotted g lost three fifths of its
   * ink, the loop of its tail and most of its stroke with it.
   */
  const hairline = Math.min(
    stem,
    ...strokes.map(
      (stroke) => stroke.pen.weight * (1 - Math.min(Math.max(stroke.pen.contrast, 0), 0.95)),
    ),
  );
  if (!canCarve) return shape;
  // And no outline left crossing itself, as after the cut and the cast.
  // And swept again after it, which can tie off a speck of its own: under a
  // Formal Script k with points grown after the chamfer, one stood by the leg.
  /*
   * A dry brush's streak is a slit in the ink, and that is what it is for:
   * the sweeps for slits between two strokes, and for splinters, are not
   * asked about one.
   */
  const exempt = [...figures, ...streaks];
  const unsplit = (contour: Contour) =>
    streaks.length > 0 && contourArea(contour) < 0 && inGroove(contour, streaks)
      ? contour
      : unsplintered(contour, stem, hairline);
  const done = swept(
    untangled(swept(shape, stem, strokes, exempt).map(unsplit), scale.slant),
    stem,
    strokes,
    exempt,
  ).map(unpinched);
  /*
   * Nor a crumb of what the cast grew. A point on the thin terminal of a
   * light Brush e stood on a neck the pressure thinned and the roughening
   * then parted, and it came back as a crumb beside the letter. A piece
   * that broke off one the effects were given, is under half a stem square,
   * and is mostly a point or a fillet goes. Only those: at its heaviest the
   * Casual Script's roughening parts the tail of a p from its bowl, and the
   * tail is the letter's own stroke.
   */
  const grown = addedOf.get(ink) ?? [];
  const solids = done.filter((contour) => contourArea(contour) > 0);
  const crumbs: Contour[] = [];
  if (grown.length > 0 && solids.length > given.length) {
    const inkOf = (contours: Contour[]) =>
      contours.reduce((total, contour) => total + contourArea(contour), 0);
    const from = new Map<number, Contour[]>();
    for (const solid of solids) {
      let parent = -1;
      let most = 0;
      given.forEach((one, at) => {
        const shared = inkOf(intersect([solid], [one], "winding"));
        if (shared > most) {
          most = shared;
          parent = at;
        }
      });
      if (parent >= 0) from.set(parent, [...(from.get(parent) ?? []), solid]);
    }
    for (const family of from.values()) {
      const largest = Math.max(...family.map((one) => contourArea(one)));
      for (const one of family) {
        const area = contourArea(one);
        if (area >= largest || area >= stem * stem * 0.5) continue;
        if (inkOf(intersect([one], grown, "winding")) > area * 0.5) crumbs.push(one);
      }
    }
  }
  const kept = crumbs.length > 0 ? done.filter((contour) => !crumbs.includes(contour)) : done;
  /*
   * Nor scraps of an inline's groove. A rim grown into the groove narrows it,
   * and the roughening then pinched it shut in places: the letter was left
   * pricked with slivers of groove, each a few units across. What is left of
   * the groove smaller than a tenth of a stem square is filled.
   */
  const grooves = groovesOf.get(ink) ?? [];
  if (grooves.length === 0) return kept;
  return kept.filter(
    (contour) =>
      contourArea(contour) >= 0 ||
      -contourArea(contour) >= stem * stem * 0.1 ||
      !inGroove(contour, grooves),
  );
}

/**
 * A shape with a tool taken out of it, checked against the one thing a
 * subtraction cannot do: take away more ink than the tool covers.
 *
 * Paper can lose track of a shape the cuts have already been through: on a
 * Formal Script g with slots through it, the press took away the stroke round
 * the lower loop and left its counter filled, three fifths of the letter gone
 * to a tool a tenth its size. Where that happens the letter is left as the
 * cuts made it -- unthinned is a letter, and that was not.
 */
function takenAway(shape: Contour[], tool: Contour[]): Contour[] {
  const result = subtract(shape, tool, "winding");
  const inkOf = (contours: Contour[]) =>
    contours.reduce((total, contour) => total + contourArea(contour), 0);
  const lost = inkOf(shape) - inkOf(result);
  const most = inkOf(unite(tool, "winding"));
  return lost <= most * 1.02 + 1 && lost >= -1 ? result : shape;
}

/**
 * The outline without the loops of no width it ties off at a point.
 *
 * Where the outline comes back to exactly a point it has passed through, the
 * run between is a loop of its own, and one that encloses nothing is a hair:
 * roughened, the point grown on a saw tooth of a Brush e came back as a
 * spike four units long and no width, out and back to the same point, and
 * anything that fused the letter again found it a piece of its own. Runs too
 * short for the splinter sweep, which is looking for strips, not hairs.
 */
function unpinched(contour: Contour): Contour {
  let nodes = contour.nodes;
  if (!contour.closed || nodes.length < 4) return contour;
  for (let pass = 0; pass < 4; pass++) {
    const count = nodes.length;
    let cut: [number, number] | null = null;
    for (let start = 0; start < count && !cut; start++) {
      const from = nodes[start].point;
      for (let step = 2; step <= 8 && step < count - 1; step++) {
        const end = (start + step) % count;
        const to = nodes[end].point;
        if (Math.hypot(to.x - from.x, to.y - from.y) > 0.01) continue;
        const loop = {
          ...contour,
          nodes: Array.from({ length: step }, (_, k) => nodes[(start + k) % count]),
        };
        if (Math.abs(contourArea(loop)) < 1) cut = [start, step];
        break;
      }
    }
    if (!cut) break;
    const [start, step] = cut;
    const drop = new Set(Array.from({ length: step }, (_, k) => (start + 1 + k) % count));
    const kept = nodes.filter((_, index) => !drop.has(index));
    if (kept.length < 3) break;
    nodes = kept;
  }
  return nodes === contour.nodes ? contour : { ...contour, nodes };
}

/**
 * The outline with its splinters taken off.
 *
 * The press cuts its wedges along a flank it has measured, and where the cut
 * runs a unit off the edge it leaves a strip of ink a unit wide standing
 * along it -- or a crack of paper as wide running into it; the roughening
 * then drags each into a whisker. On the Brush they stood off the top of the
 * `c`, along the arms of the `x` and the `k`, and beside the serifs of the
 * `V`: debris finer than any bristle leaves. So wherever the outline comes
 * back within a sliver of where it was after running a good way out, the run
 * out and back is dropped. Nothing a letter means to draw is that thin: a
 * hairline at the Brush's contrast is a third of a stem, and this is an eighth.
 */
function unsplintered(contour: Contour, stem: number, hairline = stem): Contour {
  const thin = Math.min(stem * 0.12, hairline * 0.5);
  let nodes = contour.nodes;
  if (!contour.closed || nodes.length < 8) return contour;
  for (let pass = 0; pass < 4; pass++) {
    const count = nodes.length;
    const drop = new Set<number>();
    for (let start = 0; start < count; start++) {
      if (drop.has(start)) continue;
      let along = 0;
      for (let step = 1; step <= 12 && step < count - 2; step++) {
        const a = nodes[(start + step - 1) % count].point;
        const b = nodes[(start + step) % count].point;
        along += Math.hypot(b.x - a.x, b.y - a.y);
        if (step < 2) continue;
        const from = nodes[start].point;
        const gap = Math.hypot(b.x - from.x, b.y - from.y);
        if (gap < thin && along > thin * 2.5 && enclosed(nodes, start, step) < thin * along) {
          for (let inner = 1; inner < step; inner++) drop.add((start + inner) % count);
          break;
        }
      }
    }
    if (drop.size === 0 || count - drop.size < 4) break;
    nodes = nodes.filter((_, index) => !drop.has(index));
  }
  return nodes === contour.nodes ? contour : { ...contour, nodes };
}

/**
 * The area the outline encloses between one point and another a few steps on,
 * closed straight back: small for a splinter, which runs out and back along
 * itself, and not for a loop that happens to come back near where it left --
 * the tail of a Formal Script g, which went with the splinters.
 */
function enclosed(nodes: GlyphNode[], start: number, steps: number): number {
  let twice = 0;
  for (let step = 0; step <= steps; step++) {
    const a = nodes[(start + step) % nodes.length].point;
    const b = nodes[(start + ((step + 1) % (steps + 1))) % nodes.length].point;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
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
    let want = out.length * step - walked;
    if (want > run) {
      walked += run;
      at++;
      continue;
    }
    while (want <= run && out.length < count) {
      const share = want / run;
      out.push({ x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share });
      want = out.length * step - walked;
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
 * The ink as it reads across and along one place on a stroke: where its edges
 * are either side of a point in it, square to the way it runs.
 */
interface Inked {
  outlines: Vec2[][];
  inside: (point: Vec2) => boolean;
}

function inkedOf(shape: Contour[]): Inked {
  const outlines = shape.map((contour) => flattenContour(contour, 12));
  const inside = (point: Vec2): boolean => {
    let winding = 0;
    for (const points of outlines) {
      for (let index = 0; index < points.length; index++) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
        if (a.y <= point.y) {
          if (b.y > point.y && side > 0) winding++;
        } else if (b.y <= point.y && side < 0) winding--;
      }
    }
    return winding !== 0;
  };
  return { outlines, inside };
}

/** How far the ink runs from a point in it, each way along a line. */
function across(ink: Inked, at: Vec2, normal: Vec2): { left: number; right: number } | null {
  if (!ink.inside(at)) return null;
  const left = rayHitDistance(ink.outlines, at, normal);
  const right = rayHitDistance(ink.outlines, at, { x: -normal.x, y: -normal.y });
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return { left, right };
}

/**
 * Ink gathered where the tool stopped, and where it went over the same ground.
 *
 * Where two strokes meet the tool went over the same ground twice and the ink
 * ran into the corner between them: each inside corner by a join is filled
 * with a fillet, as ink fills a crotch. At an end the pen sat still for an
 * instant before it lifted, and the ink spread past the cut and softened its
 * corners: the cut is domed a little, corner to corner, and no wider than the
 * stroke. Both are found on the outline as the ink draws it, not on the
 * skeleton, so they land where the ink really turns and ends -- which on a
 * heavy face and at a dressed terminal is well off the end and the line of
 * the spine.
 *
 * It used to be a disc of a fixed share of the stem on the end of every
 * spine and at the middle of every join: at a Black a bead hung off every
 * foot, and on an s and a g it sat on the curve beside the terminal. Only the
 * ends that are really ends pool, and only a plain cut: a serif, a beak, a
 * drop or a round end has nowhere to pool. A dot, a mark no longer than it is
 * wide, joins nothing and ends nowhere.
 */
function poolTool(
  strokes: Stroke[],
  pool: Effects["pool"],
  stem: number,
  shape: Contour[],
): Contour[] {
  if (pool.size <= 0) return [];
  const ink = inkedOf(shape);
  const added: Contour[] = [];

  if (pool.where !== "ends" && strokes.length > 1) {
    /*
     * Where two strokes meet the tool went over the same ground twice and
     * the ink ran into the corner between them: each inside corner near a
     * join is filled with a fillet, as ink fills a crotch. Found on the
     * outline, so it lands in the corner the ink really makes.
     */
    const near = stem * 1.15;
    const walked = strokes.map((stroke) => alongSpine(stroke.spine, SAMPLES));
    const mark = walked.map(
      (points, at) => runLength(points) < Math.max(strokes[at].pen.weight, stem),
    );
    const joins: Vec2[] = [];
    for (let one = 0; one < walked.length; one++) {
      if (mark[one]) continue;
      for (let other = one + 1; other < walked.length; other++) {
        if (mark[other]) continue;
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
        /*
         * Only on ink. Two strokes can pass within a stem of each other
         * without touching -- the lead-in and the arm of a Handwriting `k`
         * either side of its stem -- and half-way between them is the
         * counter: there is no join there for ink to gather in.
         */
        if (closest < near && where !== null && ink.inside(where)) joins.push(where);
      }
    }
    const radius = pool.size * stem * 0.3;
    if (joins.length > 0 && radius >= 1) {
      for (const contour of shape) {
        const nodes = contour.nodes;
        const count = nodes.length;
        if (count < 3) continue;
        nodes.forEach((node, index) => {
          const corner = node.point;
          if (!joins.some((join) => Math.hypot(join.x - corner.x, join.y - corner.y) < stem))
            return;
          const before = nodes[(index - 1 + count) % count];
          const after = nodes[(index + 1) % count];
          const back = unit(node.handleIn ?? before.point, corner);
          const on = unit(corner, node.handleOut ?? after.point);
          if (!back || !on) return;
          // Ink on the left: a turn to the right is an inside corner.
          const turn = Math.atan2(back.x * on.y - back.y * on.x, back.x * on.x + back.y * on.y);
          if (turn > -(20 * Math.PI) / 180 || turn < -(160 * Math.PI) / 180) return;
          // The paper's angle in the corner, and how far along each edge the
          // fillet runs before it leaves it.
          const open = Math.PI + turn;
          const reach = Math.min(
            radius / Math.tan(open / 2),
            Math.hypot(before.point.x - corner.x, before.point.y - corner.y) * 0.45,
            Math.hypot(after.point.x - corner.x, after.point.y - corner.y) * 0.45,
          );
          if (reach < 1) return;
          const from = { x: corner.x - back.x * reach, y: corner.y - back.y * reach };
          const to = { x: corner.x + on.x * reach, y: corner.y + on.y * reach };
          const pull = 0.55;
          added.push(
            oneWay({
              closed: true,
              nodes: [
                { point: corner, handleIn: null, handleOut: null, type: "corner" },
                {
                  point: from,
                  handleIn: null,
                  handleOut: {
                    x: from.x + (corner.x - from.x) * pull,
                    y: from.y + (corner.y - from.y) * pull,
                  },
                  type: "corner",
                },
                {
                  point: to,
                  handleIn: {
                    x: to.x + (corner.x - to.x) * pull,
                    y: to.y + (corner.y - to.y) * pull,
                  },
                  handleOut: null,
                  type: "corner",
                },
              ],
            }),
          );
        });
      }
    }
  }

  if (pool.where !== "joins") {
    for (const stroke of strokes) {
      if (stroke.spine.closed) continue;
      const walked = alongSpine(stroke.spine, SAMPLES);
      if (walked.length < 3) continue;
      if (runLength(walked) < Math.max(stroke.pen.weight, stem)) continue;
      const ends: Array<[boolean, Vec2, Vec2]> = [
        [stroke.start.open === true, walked[0], walked[2]],
        [stroke.end.open === true, walked[walked.length - 1], walked[walked.length - 3]],
      ];
      for (const [open, tip, inward] of ends) {
        if (!open) continue;
        const out = unit(inward, tip);
        if (!out) continue;
        const normal = { x: -out.y, y: out.x };
        const half = penHalfAcross(stroke, normal);
        // A little in from the end of the spine, where the stroke is itself.
        const back = { x: tip.x - out.x * half, y: tip.y - out.y * half };
        const wide = across(ink, back, normal);
        if (!wide) continue;
        // Only a plain end: one much wider or narrower than the pen is a
        // serif, a beak or a drop, which pools no more than it is.
        if (Math.abs(wide.left + wide.right - half * 2) > half * 2 * 0.25) continue;
        const side = (wide.left + wide.right) / 2;
        const middle = (wide.left - wide.right) / 2;
        // The cut the stroke ends in, found either side of its middle.
        const hit = (offset: number): Vec2 | null => {
          const from = {
            x: back.x + normal.x * (middle + offset),
            y: back.y + normal.y * (middle + offset),
          };
          if (!ink.inside(from)) return null;
          const reach = rayHitDistance(ink.outlines, from, out);
          if (!Number.isFinite(reach) || reach > half * 3) return null;
          return { x: from.x + out.x * reach, y: from.y + out.y * reach };
        };
        const one = hit(-side * 0.7);
        const two = hit(side * 0.7);
        const mid = hit(0);
        if (!one || !two || !mid) continue;
        // A straight cut, or it is a round end already and has nowhere to pool.
        const chord = { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2 };
        if (Math.hypot(mid.x - chord.x, mid.y - chord.y) > side * 0.08) continue;
        const along = unit(one, two);
        if (!along) continue;
        const face = { x: along.y, y: -along.x };
        const outward = face.x * out.x + face.y * out.y >= 0 ? face : { x: -face.x, y: -face.y };
        // Across the whole cut, from corner to corner, and domed past it.
        const width = (Math.hypot(two.x - one.x, two.y - one.y) / 0.7 / 2) * (1 + pool.size * 0.08);
        const dome = side * pool.size * 0.5;
        added.push(oval(chord, outward, dome, width));
      }
    }
  }
  return added;
}

/** Which way one point lies from another, or nothing where they are the same. */
function unit(from: Vec2, to: Vec2): Vec2 | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const run = Math.hypot(dx, dy);
  return run < 1e-9 ? null : { x: dx / run, y: dy / run };
}

// ---------------------------------------------------------------------------
// Where the tool ran dry
// ---------------------------------------------------------------------------

/**
 * Streaks of paper where the brush ran out of ink.
 *
 * What a dry brush leaves: towards the end of a stroke the ink gives out, the
 * bristles part and the paper shows through in fine streaks that run with the
 * stroke, following its curve, and open out as they run off its end. So each
 * gap starts as a hair inside the stroke, is laid along its own middle and
 * bent with it, set off to one side of it and kept a wall's width inside its
 * edges -- measured on the ink, not on the pen, so it holds on a heavy face
 * too -- and runs out through the end. Only at an end the brush lifted from:
 * none is laid across a join, where it would cut two strokes at once. And no
 * streak closed at both ends: a letter keeps its counters and nothing else,
 * and a slit of paper shut up inside a stroke reads as a fault in the file.
 *
 * It used to be a straight rectangle laid along the spine's local direction
 * and pushed off to one side: square ends, and wherever the stroke curved or
 * met another, a corner through the edge. On a heavy Serif the letters came
 * back chipped with white rectangles and shards of ink floating in them, and
 * a Sans S, 4, 8 and & had gaps slashed across them on the slant. A streak
 * that stops short of an edge is a streak; one that bites it is damage.
 */
function skipTool(
  strokes: Stroke[],
  skip: Effects["skip"],
  stem: number,
  shape: Contour[],
): Contour[] {
  if (skip.density <= 0 || skip.width <= 0 || skip.length <= 0) return [];
  const long = skip.length * stem;
  const wide = skip.width * stem;
  // How much ink a streak leaves either side of it, at the least.
  const wall = stem * 0.12;
  const ink = inkedOf(shape);
  const gaps: Contour[] = [];

  strokes.forEach((stroke, index) => {
    const length = spineLength(stroke.spine);
    if (!(length > 0) || length < Math.max(stroke.pen.weight, stem) * 1.5) return;
    const seed = skip.seed * 2246822519 + index * 668265263;
    const others = strokes.filter((_, at) => at !== index);
    const count = Math.max(8, Math.ceil(length / (stem * 0.1)));
    const walked = alongSpine(stroke.spine, count);
    const step = length / count;
    // Where the brush lifted: an end with no other stroke near it. One that
    // runs into another stroke is a join, and the ink there is both of them;
    // and a round drawn closed, the o's, has no end at all, only the place
    // its two ends meet.
    const head = walked[0];
    const tail = walked[walked.length - 1];
    if (stroke.spine.closed || Math.hypot(tail.x - head.x, tail.y - head.y) < stem) return;
    const free = [0, walked.length - 1].filter((at) => !nearAny(walked[at], others, stem * 0.6));
    if (free.length === 0) return;
    // At full density every free end runs dry; a long stroke sooner than a
    // short arm.
    const many = Math.min(
      free.length,
      Math.max(1, Math.round((length / (long * 2.2)) * skip.density * 4)),
    );
    if (hashed(seed, 999) < 0.5) free.reverse();
    // The last few steps before the end are the cap, round or pooled, and
    // measure as neither the stroke's middle nor its width.
    const trim = Math.ceil((stem * 0.3) / step);

    for (let placed = 0; placed < many; placed++) {
      const end = free[placed];
      // Tried a few times over for each: a stretch that would cross a join
      // or run out of room is not laid, and the next is tried instead.
      for (let which = 0; which < 6; which++) {
        const pick = (k: number) => hashed(seed, (placed * 6 + which) * 8 + k);
        const span = Math.min(long * (0.6 + pick(1) * 0.8), length * 0.6);
        const reach = Math.round(span / step);
        const first = end === 0 ? trim : walked.length - 1 - reach;
        const last = end === 0 ? reach : walked.length - 1 - trim;
        if (last - first < 6) continue;
        // The stroke along the stretch, read off the ink: where its middle is
        // and how wide it is at each step.
        type Place = { here: Vec2; normal: Vec2; middle: number; thick: number };
        const places: Place[] = [];
        for (let at = first; at <= last; at++) {
          const here = walked[at];
          const before = walked[Math.max(0, at - 1)];
          const after = walked[Math.min(walked.length - 1, at + 1)];
          const heading = { x: after.x - before.x, y: after.y - before.y };
          const run = Math.hypot(heading.x, heading.y);
          if (run < 1e-9) break;
          const normal = { x: -heading.y / run, y: heading.x / run };
          // Not through a join: another stroke's ink here is not this stroke's.
          if (nearAny(here, others, stem * 0.1)) break;
          const edges = across(ink, here, normal);
          if (!edges) break;
          const thick = edges.left + edges.right;
          // Wider than the pen by half again is a join or a serif.
          if (thick > Math.max(penHalfAcross(stroke, normal) * 2, stem) * 1.5) break;
          places.push({ here, normal, middle: (edges.left - edges.right) / 2, thick });
        }
        if (places.length !== last - first + 1) continue;
        // Steady all along: a stretch whose middle jumps or whose width
        // swings is running round a corner.
        const steady = places.every(
          (one, at) =>
            at === 0 ||
            (Math.abs(one.middle - places[at - 1].middle) < stem * 0.08 &&
              Math.abs(one.thick - places[at - 1].thick) < stem * 0.1),
        );
        if (!steady) continue;
        // From inside the stroke out to its end.
        if (end === 0) places.reverse();
        const narrowest = Math.min(...places.map((one) => one.thick));
        /*
         * One to three bristles' worth of streak, side by side, as a dry
         * brush parts: one wide gap reads as a highlight, several fine ones
         * as bristles.
         */
        const bristles = 1 + Math.floor(pick(2) * 3);
        const fine = (wide * (0.55 + 0.45 * pick(3))) / Math.sqrt(bristles);
        const spread = fine * 1.7 * (bristles - 1);
        const spare = narrowest / 2 - wall - fine / 2 - spread / 2;
        if (spare < 0) continue;
        const lane = (pick(4) * 2 - 1) * 0.7 * spare;
        const outer = places[places.length - 1];
        const previous = places[places.length - 2];
        const out = unit(previous.here, outer.here);
        if (!out) continue;
        for (let bristle = 0; bristle < bristles; bristle++) {
          // Each starts at its own place, fine as a hair, and opens out to
          // its full width by the time it runs off the end.
          const start = pick(5 + bristle) * 0.35;
          const shift = lane + (bristle - (bristles - 1) / 2) * fine * 1.7;
          const left: Vec2[] = [];
          const right: Vec2[] = [];
          const lay = (here: Vec2, normal: Vec2, off: number, half: number) => {
            left.push({ x: here.x + normal.x * (off + half), y: here.y + normal.y * (off + half) });
            right.push({
              x: here.x + normal.x * (off - half),
              y: here.y + normal.y * (off - half),
            });
          };
          places.forEach((one, at) => {
            const u = at / (places.length - 1);
            if (u < start) return;
            const v = (u - start) / (1 - start);
            lay(
              one.here,
              one.normal,
              one.middle + shift,
              (fine / 2) * Math.sin((Math.PI / 2) * v) ** 0.7,
            );
          });
          if (left.length < 5) continue;
          // And on past the cap, straight, clear of the ink.
          for (const past of [stem * 0.4, stem * 0.8]) {
            const here = { x: outer.here.x + out.x * past, y: outer.here.y + out.y * past };
            lay(here, outer.normal, outer.middle + shift, fine / 2);
          }
          gaps.push(oneWay(smoothLoop([...left, ...right.slice(1).reverse()])));
        }
        break;
      }
    }
  });
  return gaps;
}

/** Whether a point lies in the ink of any of some strokes, grown by a margin. */
function nearAny(point: Vec2, strokes: Stroke[], margin: number): boolean {
  return strokes.some((stroke) => {
    const line = alongSpine(stroke.spine, 32);
    for (let at = 0; at + 1 < line.length; at++) {
      const a = line[at];
      const b = line[at + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const span = dx * dx + dy * dy;
      const t =
        span > 0
          ? Math.min(Math.max(((point.x - a.x) * dx + (point.y - a.y) * dy) / span, 0), 1)
          : 0;
      const x = a.x + dx * t - point.x;
      const y = a.y + dy * t - point.y;
      const off = Math.hypot(x, y);
      const normal = off > 1e-9 ? { x: x / off, y: y / off } : { x: 1, y: 0 };
      if (off < penHalfAcross(stroke, normal) + margin) return true;
    }
    return false;
  });
}

/**
 * A closed curve through some points, each a smooth node with its handles
 * laid along the line between its neighbours a sixth of the way to each.
 */
function smoothLoop(points: Vec2[]): Contour {
  const count = points.length;
  const nodes: GlyphNode[] = points.map((point, at) => {
    const before = points[(at - 1 + count) % count];
    const after = points[(at + 1) % count];
    const dx = (after.x - before.x) / 6;
    const dy = (after.y - before.y) / 6;
    return {
      point,
      handleIn: { x: point.x - dx, y: point.y - dy },
      handleOut: { x: point.x + dx, y: point.y + dy },
      type: "smooth" as const,
    };
  });
  return { nodes, closed: true };
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
/**
 * The specks a cut leaves behind, taken off the floor.
 *
 * A wedge is a straight strip laid along one flank, and a letter's flank is not
 * straight where two strokes meet: the outline steps in and out at every
 * junction, and the strip cuts across the step and leaves the little triangle
 * beyond it standing on its own. Sixteen letters of the Formal Script came out
 * of `proof` in more than one piece and every extra piece was one of these --
 * the `v` shed twelve square units out of eighty thousand, the `h` two of
 * thirty-one, and they sit in the notch under a shoulder or beside a stem where
 * nothing about the drawing wanted an island.
 *
 * Not fixed by cutting less. The strip cuts across the step wherever the step
 * is, so a shallower cut moves the speck rather than removing it; a strip that
 * followed the outline instead of running straight would be a different effect
 * from this one. What is wrong is not the depth, it is that a thinning tool has
 * left a crumb, and a crumb is not something the press is entitled to draw.
 *
 * So they are dropped, and the bound is measured rather than chosen. The
 * largest speck any of the sixteen faces sheds is under seven hundred square
 * units; the smallest mark any of them means to draw is the dot of an `i`, at
 * two thousand two hundred on the Formal Script and three thousand four on the
 * Brush. An eighth of the stem squared falls between the two on every face --
 * eleven hundred and twenty-two hundred respectively -- which is the gap this
 * sits in and not a number with a reason of its own. The test holds both ends
 * of it: no letter in more pieces than it was drawn in, and the `i` and the `j`
 * still keeping their dots.
 *
 * Only the outer contours are looked at, so a counter this size is left alone:
 * filling a hole is as wrong as leaving an island.
 */
function swept(
  shape: Contour[],
  stem: number,
  strokes: Stroke[] = [],
  // The counter motif's figures, which are never cracks however they wander.
  figures: Contour[] = [],
): Contour[] {
  if (shape.length < 2) return shape;
  const areas = shape.map((contour) => contourArea(contour));
  let widest = 0;
  for (let at = 1; at < areas.length; at++) {
    if (Math.abs(areas[at]) > Math.abs(areas[widest])) widest = at;
  }
  // Which way round this shape draws its solids, read off the biggest of them,
  // which is the letter's own body.
  const solid = Math.sign(areas[widest]);
  const least = stem * stem * 0.125;
  const kept = shape.filter(
    (contour, at) =>
      !(Math.sign(areas[at]) === solid && Math.abs(areas[at]) < least) &&
      !(
        Math.sign(areas[at]) !== solid &&
        slit(contour, Math.abs(areas[at]), stem) &&
        !inGroove(contour, figures) &&
        !(Math.abs(areas[at]) >= stem * stem * 0.08 && downTheMiddle(contour, strokes, stem))
      ),
  );
  return kept.length > 0 ? kept : shape;
}

/**
 * Whether a hole is a slit in the ink rather than a counter.
 *
 * Where two strokes of a joined letter run into each other nearly side by
 * side -- a lead-in into the flank of a bowl, a loop down onto its stem --
 * their edges part by a unit or two before they meet, and the union keeps the
 * sliver between them as a hole. Roughened, it opens into a white knife-cut
 * through a solid stroke: the Casual Script's `m`, `u`, `d`, `g` and `l` all
 * had them. A counter is never that thin: measured by its mean width, twice
 * its area over its perimeter, a slit is a fifth of a stem across or less,
 * and nothing a letter means to leave open is both that thin and that small.
 */
/**
 * Whether a hole runs down the middle of a stroke, as the inline's groove
 * does, rather than between two, as a slit does.
 *
 * The two can be the same width: an inline tapers where its stroke thins,
 * and round a Brush o or down a Handwriting stem it was as thin as the slits
 * the Casual Script's joins leave, and was swept away with them. A slit lies
 * where two strokes' edges meet, half a pen from either spine; a groove lies
 * on one, so nearly all of its outline is within a sixth of a stem of it:
 * the Casual Script's slits have half of theirs that near, or less. A speck
 * of a hole is never a groove, wherever it lies.
 */
function downTheMiddle(contour: Contour, strokes: Stroke[], stem: number): boolean {
  if (strokes.length === 0) return false;
  const lines = strokes.map((stroke) => alongSpine(stroke.spine, 64));
  const points = flattenContour(contour);
  if (points.length === 0) return false;
  const step = Math.max(1, Math.floor(points.length / 24));
  let near = 0;
  let count = 0;
  for (let at = 0; at < points.length; at += step) {
    count++;
    const point = points[at];
    if (lines.some((line) => nearLine(line, point, stem * 0.16))) near++;
  }
  return near >= count * 0.85;
}

/** Whether a point is within some distance of a sampled line. */
function nearLine(line: Vec2[], point: Vec2, within: number): boolean {
  for (let at = 0; at + 1 < line.length; at++) {
    const a = line[at];
    const b = line[at + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const span = dx * dx + dy * dy;
    const t =
      span > 0 ? Math.min(Math.max(((point.x - a.x) * dx + (point.y - a.y) * dy) / span, 0), 1) : 0;
    if (Math.hypot(a.x + dx * t - point.x, a.y + dy * t - point.y) < within) return true;
  }
  return false;
}

function slit(contour: Contour, area: number, stem: number): boolean {
  if (area >= stem * stem) return false;
  const points = flattenContour(contour);
  let perimeter = 0;
  for (let at = 0; at < points.length; at++) {
    const next = points[(at + 1) % points.length];
    perimeter += Math.hypot(next.x - points[at].x, next.y - points[at].y);
  }
  return perimeter > 0 && (2 * area) / perimeter < stem * 0.2;
}

function pressWedges(
  ink: Contour[],
  strokes: Stroke[],
  press: Effects["press"],
  stem: number,
  // The inline's groove, where there is one: see below.
  grooves: Contour[] = [],
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
  /*
   * Measured on the letter with its groove filled, and spent on the wall.
   *
   * The spine runs down the middle of an inline's groove, and a ray from it
   * found the groove's edge a unit or two off: the band was laid from there
   * out past the flank, across the whole wall between the groove and the
   * paper. On a hairline Formal Script the wall is a few units thick, and the
   * pressed e came back with its wall cut through and its outline folded
   * over itself. So the flank is found with the groove filled in, and the
   * cut is a share of the wall that stands between the two.
   */
  const inGrooves = ink.filter((contour) => contourArea(contour) < 0 && inGroove(contour, grooves));
  const edges = ink
    .filter((contour) => !inGrooves.includes(contour))
    .map((contour) => flattenContour(contour, RAY_STEPS));
  const walls = inGrooves.map((contour) => flattenContour(contour, RAY_STEPS));
  const wedges: Contour[] = [];

  for (const stroke of strokes) {
    // The stroke's own outline, uncut, for telling its flank from the side of
    // a cut: see `flankAt`.
    const own = sweep(stroke).map((contour) => flattenContour(contour, RAY_STEPS));
    if (stroke.spine.closed) continue;
    const reach = Math.max(stroke.pen.weight, stem) * 0.5;
    const walked = alongSpine(
      stroke.spine,
      Math.min(
        MOST_SAMPLES,
        Math.max(FEWEST_SAMPLES, Math.ceil(spineLength(stroke.spine) / (reach * STEP_OF_A_PEN))),
      ),
    );
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

    const strip: Contour[] = [];
    for (const side of [1, -1] as const) {
      const flank: Array<{ inner: Vec2; outer: Vec2; edge: Vec2 } | null> = [];
      for (let at = 0; at < walked.length; at++) {
        flank.push(
          flankAt(walked, at, side, press.amount, press.at, opens, edges, half, stroke, own, walls),
        );
      }
      /*
       * One band per unbroken run of flank, and not one quad per pair of
       * samples.
       *
       * A quad has straight sides and a flank does not, so on a curve every
       * quad cuts its own chord and the strip is a chain of overlapping
       * lozenges rather than a band. Where they overlap they pile winding on
       * winding, and the boolean has to make sense of a hundred of them at once
       * -- which it does until the letter is a long turn under a broad pen, and
       * then it does not: the Formal Script `E` and `F` came back with their
       * bodies gone and four thousand units of fragment where the letter was.
       *
       * Walked as one polygon -- out along the inner edge and back along the
       * outer -- there is nothing to overlap and nothing to add up. The chords
       * are still chords, which is what the sample count above is for.
       */
      let run: Array<{ inner: Vec2; outer: Vec2; edge: Vec2 }> = [];
      let first = 0;
      /*
       * And a band that stops short of the stroke's end stops by running out
       * onto the flank, not square across it. Where a sample is left out --
       * the ray found a cut, a neighbour, or the letter's far side -- the band
       * broke there with the whole depth of the cut standing as a step, and
       * on a contrast face that was a notch at every place the hairline turned
       * into a bowl or a join: the Formal Script's `c`, `s`, the swashes of
       * its capitals and the hook of its `J` were saw-toothed along their
       * thins. Eased in over a few samples from each end the stroke itself
       * does not have, the pressure comes and goes as a hand's does; at a
       * real end of the stroke it is still cut to the tip.
       *
       * Eased out past the run, though, where the ink's edge runs on. A run
       * most often stops where the stroke swells -- the ray from the spine
       * reaches further than a flank is believed -- and that is where the
       * band cuts deepest, a share of a body that is growing. Eased over the
       * run's own last samples, the pressure came off just where it was
       * greatest: the Formal Script's S kept half the thinning of its
       * swashes. So where the edge goes on smoothly to the next sample, the
       * run keeps its whole depth and the band slopes out of the ink to that
       * sample, a sample's length rather than a step. Out to the band's own
       * outer side there, and no nearer the edge: brought out only as far as
       * the eased samples are, it ran close along the edge for that length,
       * and the subtraction folded the S and the z over themselves.
       */
      const onward = (from: number, toward: 1 | -1): Vec2 | null => {
        const at = from + toward;
        if (walls.length > 0) return null;
        /*
         * Only into a gap at least as long as an ease. Across a sample or
         * two left out mid-flank, the bands either side would both keep their
         * depth up to it and leave the ink between standing as a tooth; there
         * the runs ease inside themselves, as they did.
         */
        for (let step = 0; step < EASE; step++) {
          const gap = at + step * toward;
          if (gap < 0 || gap >= walked.length || flank[gap]) return null;
        }
        const before = walked[Math.max(0, at - 1)];
        const after = walked[Math.min(walked.length - 1, at + 1)];
        const far = Math.hypot(after.x - before.x, after.y - before.y);
        if (far < 1e-9) return null;
        const normal = {
          x: (-(after.y - before.y) / far) * side,
          y: ((after.x - before.x) / far) * side,
        };
        const here = walked[at];
        const hit = rayHitDistance(edges, here, normal);
        // The edge running on rather than jumping to another: no further
        // from the run's own than the samples are apart.
        const end = run[toward === 1 ? run.length - 1 : 0].edge;
        const was = Math.hypot(end.x - walked[from].x, end.y - walked[from].y);
        const apart = Math.hypot(here.x - walked[from].x, here.y - walked[from].y);
        if (!Number.isFinite(hit) || hit < 0.5 || Math.abs(hit - was) > apart * 1.5) return null;
        return {
          x: here.x + normal.x * (hit + half * 0.3),
          y: here.y + normal.y * (hit + half * 0.3),
        };
      };
      const close = (after: number) => {
        if (run.length >= 2) {
          const last = first + run.length - 1;
          const before = first === 0 ? null : onward(first, -1);
          const beyond = last === walked.length - 1 ? null : onward(last, 1);
          const eased = run.map((one, index) => {
            const fromStart = first === 0 || before ? EASE : index;
            const fromEnd = last === walked.length - 1 || beyond ? EASE : run.length - 1 - index;
            const share = Math.min(1, fromStart / EASE, fromEnd / EASE);
            // Eased out to well clear of the edge rather than onto it: a
            // band lying along the ink's own edge leaves the subtraction a
            // sliver of no width, and the Formal Script's `)` and `ς` came
            // back crossing themselves.
            const clear = {
              x: one.edge.x + (one.outer.x - one.edge.x) * 0.6,
              y: one.edge.y + (one.outer.y - one.edge.y) * 0.6,
            };
            return {
              inner: {
                x: clear.x + (one.inner.x - clear.x) * share,
                y: clear.y + (one.inner.y - clear.y) * share,
              },
              outer: one.outer,
            };
          });
          const inner = eased.map((one) => one.inner);
          if (before) inner.unshift(before);
          if (beyond) inner.push(beyond);
          strip.push(oneWay(poly([...inner, ...eased.map((one) => one.outer).reverse()])));
        }
        run = [];
        first = after;
      };
      flank.forEach((edge, index) => {
        if (edge) run.push(edge);
        else close(index + 1);
      });
      close(walked.length);
    }
    if (strip.length === 0) continue;
    /*
     * Clipped to the stroke it is thinning, and this is what makes it safe.
     *
     * The band has to be measured against the *letter's* outline, because that
     * is the only place the ink really stops -- contrast pulls a flank in, a
     * join pushes it out, and a guess at half a pen took the bowl off an `a`
     * three times over. But the ink out there is not always this stroke's: a
     * letter is strokes laid over one another, and where two overlap the band
     * runs on through the neighbour. Thinning an `n`'s stem took the flag off
     * its own lead-in; thinning a `u` cut along the top of its lead-out and
     * left fifteen thousand square units of it lying beside the letter.
     *
     * Measuring against the stroke's own sweep instead does not work either,
     * and the letters say so plainly: forty-seven of them came apart, because a
     * band that stops at a buried stroke's own flank is a slot cut through the
     * middle of the letter. Both halves are wanted -- measured on the letter,
     * spent on the stroke.
     */
    if (!loaded()) {
      wedges.push(...strip);
      continue;
    }
    wedges.push(...intersect(strip, sweep(stroke), "winding").map(oneWay));
  }
  /*
   * Handed over as they are. They used to be fused first, so that what was
   * taken away was one strip down each flank rather than a hundred overlapping
   * slivers -- and that was right while a flank *was* a hundred slivers. It is
   * one band per run now, clipped to its own stroke, and fusing them turns a
   * set the subtraction can read into one it cannot: the Formal Script `E` and
   * the Brush `s` came back *as* their own wedges, a few thousand units of band
   * where the letter had been.
   */
  return wedges;
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
  own: Vec2[][] = [],
  walls: Vec2[][] = [],
): { inner: Vec2; outer: Vec2; edge: Vec2 } | null {
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
  // Where the band is laid: the ink's edge, unless a cut made it (below).
  let flank = hit;
  /*
   * Nor where the edge is far nearer than the pen could have put it. That is
   * not a flank: it is the side of a cut. A slot or a groove taken out of the
   * letter first leaves edges running across the stroke, and a ray from the
   * spine beside one -- or from inside it, where the spine is paper -- came
   * back with a few units; the band built along it swung across the stroke
   * between that sample and the next, and a slotted Formal Script g lost
   * three fifths of its ink to the press.
   */
  if (hit < pen * SHORT) {
    // Unless the stroke itself is that thin there, as a contrast face's is
    // towards a terminal: then the ray found its flank. Measured against the
    // pen alone, every tapering end went unthinned.
    const itself = own.length > 0 ? rayHitDistance(own, here, normal) : Number.POSITIVE_INFINITY;
    // And not a ray that starts on the edge itself, where the spine runs on
    // past the ink of a brush's terminal: the wedge cut from there is what
    // tapers the tip, and has always been.
    if (hit > 0.5 && !(hit >= itself * 0.8)) return null;
  } else if (own.length > 0 && hit > 0.5) {
    /*
     * Nor where a cut made the edge rather than the stroke: the ink stops
     * well inside the stroke's own flank. The corners a chamfer cuts off the
     * stems of a heavy Formal Script take most of the hairline entry strokes
     * on them with it, and a band laid along the faces the cut left notched
     * them sample by sample: every chamfered corner came back a staircase.
     */
    const itself = rayHitDistance(own, here, normal);
    if (Number.isFinite(itself) && hit < itself * 0.8) return null;
    /*
     * And where a cut took less than that, the sample is taken as it stood
     * before the cut: laid along the stroke's own flank, and left out where
     * that flank is further off than the pen could have put it, as the uncut
     * letter's is. Measured to the cut's face instead, a sample the uncut
     * letter leaves out came inside that reach, and the band ran on past where
     * it stops on the uncut letter, notching the chamfered tip of a written
     * Formal Script H's swash with two steps.
     */
    if (Number.isFinite(itself) && hit < itself) {
      if (itself > Math.max(pen, half * 0.25) * ESCAPED) return null;
      flank = itself;
    }
  }
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
  // Where a groove runs down the stroke, what there is to thin is the wall
  // between it and the flank.
  const groove = walls.length > 0 ? rayHitDistance(walls, here, normal) : Number.POSITIVE_INFINITY;
  const body = groove < flank ? flank - groove : flank;
  const thin = Math.min(body, pen) * Math.min(press * lightness(when, u, opens), MOST_OF_A_STROKE);
  return {
    inner: { x: here.x + normal.x * (flank - thin), y: here.y + normal.y * (flank - thin) },
    edge: { x: here.x + normal.x * flank, y: here.y + normal.y * flank },
    // Just past the edge that was measured, so the cut always starts in air.
    outer: {
      x: here.x + normal.x * (flank + half * 0.3),
      y: here.y + normal.y * (flank + half * 0.3),
    },
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
    return u < 0.5 ? (opens.start ? 1 - u * 2 : 0) : opens.end ? u * 2 - 1 : 0;
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

/**
 * An oval, as four points with the handles that make one: `along` either way
 * down `axis` and `across` either side of it.
 */
function oval(centre: Vec2, axis: Vec2, along: number, across: number): Contour {
  const side = { x: -axis.y, y: axis.x };
  const at = (u: number, v: number): Vec2 => ({
    x: centre.x + axis.x * u + side.x * v,
    y: centre.y + axis.y * u + side.y * v,
  });
  const k = 0.5522847498;
  const ends: Array<[number, number, number, number]> = [
    [along, 0, 0, across * k],
    [0, across, -along * k, 0],
    [-along, 0, 0, -across * k],
    [0, -across, along * k, 0],
  ];
  return {
    closed: true,
    nodes: ends.map(([u, v, du, dv]) => ({
      point: at(u, v),
      handleIn: at(u - du, v - dv),
      handleOut: at(u + du, v + dv),
      type: "tangent" as const,
    })),
  };
}
