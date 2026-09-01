/**
 * A drawn letter, read back as strokes you can edit.
 *
 * This is the inverse of the sweep, and it is the piece that decides whether
 * this engine can be pointed at somebody's typeface at all. Given the outlines
 * of a glyph it recovers the centre-lines that would have drawn it and how wide
 * the pen was at each point along them -- which is a guess, because a filled
 * shape does not carry a record of the strokes that made it, and more than one
 * set of strokes can fill the same area. What makes the guess a good one is
 * that letters are made of strokes in the first place, so the medial axis of
 * the ink is very close to the path the hand took.
 *
 * The order of work: fill the glyph, measure how far every inside pixel is from
 * the edge, thin the fill to a line one pixel wide, break that line into paths
 * at its junctions, throw away the short spurs that thinning always leaves at
 * corners, then fit each path to cubics and read its width off the distance
 * field. The result is `QuillStroke`s, which the sweep draws and the panel
 * edits, so what comes back is not a tracing but a description.
 *
 * Where it is weak, said plainly. A junction -- a crossing, or a place where a
 * bowl meets a stem -- is one point in the ink and two strokes in the hand, and
 * nothing in the ink says which two. The paths this returns break at every
 * junction, so a letter whose strokes cross comes back as more pieces than it
 * was drawn with. Redrawn they cover the same ink and the letter is right; as a
 * description they are cut up in places a designer would not have cut. Joining
 * them back into the strokes a hand would recognise needs judgement about
 * continuity, and that is left as a hand-correction rather than guessed at,
 * because a wrong guess there is much worse than an honest extra node.
 */

import type { Contour } from "@/font/types";
import type { Vec2 } from "@/font/types";
import { fitCubics, walkOf } from "./curve";
import {
  distanceAt,
  distances,
  inside,
  rasterise,
  thin,
  toUnits,
  type Grid,
} from "./raster";
import { widthAt } from "./sweep";
import {
  ROUND_NIB,
  type QuillGlyph,
  type QuillStroke,
  type WidthProfile,
} from "./types";

export interface FitOptions {
  /**
   * The em the glyph is drawn on, so the raster can be sized against it.
   *
   * Accuracy here is worth having in proportion to the letter rather than in
   * absolute units: a unit on a 2048-unit em is half as large as a unit on a
   * 1000-unit em, and rasterising both at a pixel per unit spends four times
   * the work on the larger one for accuracy nobody asked for. Left out, a
   * thousand is assumed, which is what most fonts use.
   */
  unitsPerEm?: number;
  /** Font units per pixel. Worked out from the em unless it is given. */
  scale?: number;
  /** How closely the fitted centre-line has to follow the thinned one. */
  tolerance?: number;
  /**
   * The shortest spur worth keeping, in font units.
   *
   * Thinning leaves a whisker wherever the outline has a corner, because the
   * corner is further from the middle than its neighbours and the thinning
   * cannot tell that from a real stroke ending. A whisker shorter than a stroke
   * is wide is certainly one of those.
   */
  prune?: number;
  /** How many stops the width profile is reduced to. */
  widthStops?: number;
}

// ---------------------------------------------------------------------------
// Tracing the thinned pixels into paths
// ---------------------------------------------------------------------------

const NEIGHBOURS: Array<[number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

function neighboursOf(
  skeleton: Uint8Array,
  grid: Grid,
  x: number,
  y: number,
): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
    if (skeleton[ny * grid.width + nx] === 1) found.push([nx, ny]);
  }
  return found;
}

/**
 * The thinned pixels, split into runs between endpoints and junctions.
 *
 * A pixel with one neighbour is where a stroke stops; one with three or more is
 * where strokes meet. Everything between two of those is a run that no other
 * run touches, and is therefore a stroke -- or a piece of one, in the case the
 * note at the top of this file is about.
 */
function tracePaths(
  skeleton: Uint8Array,
  grid: Grid,
): Array<Array<[number, number]>> {
  const degree = new Uint8Array(grid.width * grid.height);
  const nodes: Array<[number, number]> = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (skeleton[y * grid.width + x] !== 1) continue;
      const count = neighboursOf(skeleton, grid, x, y).length;
      degree[y * grid.width + x] = count;
      if (count !== 2) nodes.push([x, y]);
    }
  }

  const walked = new Uint8Array(grid.width * grid.height);
  const paths: Array<Array<[number, number]>> = [];

  /**
   * Walk the skeleton from a starting pixel until it ends, branches, or
   * arrives back where it began.
   *
   * That last case is the one that was missing, and it was expensive. The walk
   * stopped at any pixel whose degree was not two -- an end or a junction --
   * which is every way a line can finish except the way a ring does. A ring has
   * degree two at every pixel including its start, so the walk went round, came
   * back to the pixel it began at, found degree two there as well, and set off
   * again. It only stopped when the guard ran out.
   *
   * The guard is the size of the grid, so an `o` on a seven-hundred-unit em
   * came back as a path of one million two hundred thousand points: the ring
   * traced some five hundred times over. Nothing crashed and nothing was
   * reported. What it produced was a spine of two hundred and seventy-seven
   * cubics deviating a thousand units from a letter seven hundred units tall,
   * an outline of three hundred and eighty-four nodes, and fifteen seconds of
   * work where every other letter took three.
   */
  const walkFrom = (start: [number, number], first: [number, number]) => {
    const path: Array<[number, number]> = [start];
    let previous = start;
    let here = first;
    for (let guard = 0; guard < grid.width * grid.height; guard++) {
      path.push(here);
      walked[here[1] * grid.width + here[0]] = 1;
      // Back at the beginning: a ring, and it is finished.
      if (here[0] === start[0] && here[1] === start[1]) break;
      if (degree[here[1] * grid.width + here[0]] !== 2) break;
      const next = neighboursOf(skeleton, grid, here[0], here[1]).find(
        (one) => !(one[0] === previous[0] && one[1] === previous[1]),
      );
      if (!next) break;
      previous = here;
      here = next;
    }
    return path;
  };

  for (const [x, y] of nodes) {
    for (const step of neighboursOf(skeleton, grid, x, y)) {
      if (walked[step[1] * grid.width + step[0]] === 1) continue;
      const path = walkFrom([x, y], step);
      if (path.length >= 2) paths.push(path);
    }
  }

  /*
   * A ring has no endpoint and no junction, so the sweep above never starts on
   * one. An `o` drawn in a single closed motion is exactly that, and skipping
   * it would lose the letter rather than a detail of it.
   */
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const index = y * grid.width + x;
      if (skeleton[index] !== 1 || walked[index] === 1 || degree[index] !== 2)
        continue;
      const step = neighboursOf(skeleton, grid, x, y)[0];
      walked[index] = 1;
      const path = walkFrom([x, y], step);
      if (path.length >= 4) paths.push(path);
    }
  }
  return paths;
}

/**
 * Which separate piece of skeleton each pixel belongs to.
 *
 * Needed because "short with a free end" describes two completely different
 * things: a whisker hanging off a stroke, which should go, and the dot of an
 * `i`, which is the whole of a mark and must not. They are told apart by
 * whether anything else is attached -- a whisker is part of a larger piece, a
 * dot is a piece entirely by itself.
 */
function components(skeleton: Uint8Array, grid: Grid): Int32Array {
  const label = new Int32Array(grid.width * grid.height).fill(-1);
  let next = 0;
  const queue: number[] = [];
  for (let start = 0; start < skeleton.length; start++) {
    if (skeleton[start] !== 1 || label[start] !== -1) continue;
    label[start] = next;
    queue.length = 0;
    queue.push(start);
    while (queue.length > 0) {
      const index = queue.pop()!;
      const x = index % grid.width;
      const y = Math.floor(index / grid.width);
      for (const [nx, ny] of neighboursOf(skeleton, grid, x, y)) {
        const at = ny * grid.width + nx;
        if (label[at] !== -1) continue;
        label[at] = next;
        queue.push(at);
      }
    }
    next++;
  }
  return label;
}

/**
 * The paths rejoined where one plainly carries on into the next.
 *
 * A junction in the ink is not a junction in the hand. Where a bowl meets a
 * stem the thinning finds one point and three arms, but two of those arms are
 * the same stroke passing through and only the third is the other one. Cut at
 * every junction, a `g` came back as fifty-one pieces -- ink that redraws
 * correctly and a description nobody could edit.
 *
 * So at each junction the arms are paired by direction: the two whose headings
 * most nearly oppose each other are the same stroke continuing, and they are
 * spliced. An arm with no good partner is left as a stroke end, which is what
 * it is. The threshold is deliberately strict -- an arm has to be within about
 * fifty degrees of straight-on to be spliced -- because joining two strokes
 * that merely touch is a worse error than leaving one stroke in two pieces: the
 * first invents a shape nobody drew, the second only adds a node.
 */
function spliceAtJunctions(
  paths: Array<Array<[number, number]>>,
  grid: Grid,
): Run[] {
  const key = ([x, y]: [number, number]) => y * grid.width + x;
  const headingOf = (
    path: Array<[number, number]>,
    fromStart: boolean,
  ): Vec2 => {
    const look = Math.min(8, path.length - 1);
    const a = fromStart ? path[0] : path[path.length - 1];
    const b = fromStart ? path[look] : path[path.length - 1 - look];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  };

  // Every loose end, by the pixel it sits on.
  const ends = new Map<number, Array<{ path: number; start: boolean }>>();
  paths.forEach((path, index) => {
    for (const start of [true, false]) {
      const point = start ? path[0] : path[path.length - 1];
      const list = ends.get(key(point)) ?? [];
      list.push({ path: index, start });
      ends.set(key(point), list);
    }
  });

  const partner = new Map<string, string>();
  const tag = (path: number, start: boolean) => `${path}:${start ? "s" : "e"}`;
  for (const [, list] of ends) {
    if (list.length < 2) continue;
    const used = new Set<number>();
    // Every pair, best first: the straightest continuation wins.
    const pairs: Array<{ one: number; other: number; score: number }> = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = headingOf(paths[list[i].path], list[i].start);
        const b = headingOf(paths[list[j].path], list[j].start);
        // Both point away from the junction, so a straight-through pair has
        // headings that oppose: a dot product near minus one.
        pairs.push({ one: i, other: j, score: a.x * b.x + a.y * b.y });
      }
    }
    pairs.sort((p, q) => p.score - q.score);
    for (const pair of pairs) {
      if (pair.score > -0.64) break;
      if (used.has(pair.one) || used.has(pair.other)) continue;
      used.add(pair.one);
      used.add(pair.other);
      const a = list[pair.one];
      const b = list[pair.other];
      partner.set(tag(a.path, a.start), tag(b.path, b.start));
      partner.set(tag(b.path, b.start), tag(a.path, a.start));
    }
  }

  /*
   * Walking a chain, entering each path at a named end and leaving by the
   * other.
   *
   * Written out this carefully because the first version was not, and the cost
   * was invisible in every count and glaring in the ink: the stroke totals came
   * out exactly right while the error went from eight units to fifty-five,
   * because paths were being spliced at the wrong ends and the joined line
   * leapt across the letter. A chain assembled backwards still has the right
   * number of pieces.
   *
   * Both paths at a junction include the junction pixel itself, so the piece
   * being added always drops its first point.
   */
  const spent = new Set<number>();
  const out: Run[] = [];
  const chainFrom = (
    from: number,
    enterAt: boolean,
  ): Array<[number, number]> => {
    let run: Array<[number, number]> = [];
    let path = from;
    let start = enterAt;
    for (let guard = 0; guard <= paths.length; guard++) {
      if (spent.has(path)) break;
      spent.add(path);
      const piece = start ? paths[path] : [...paths[path]].reverse();
      run = run.length === 0 ? [...piece] : [...run, ...piece.slice(1)];
      const onward = partner.get(tag(path, !start));
      if (!onward) break;
      const [nextText, side] = onward.split(":");
      const next = Number(nextText);
      if (spent.has(next)) break;
      path = next;
      start = side === "s";
    }
    return run;
  };

  // Chains with a loose end first, entered from that end, so each is walked
  // once and in order. Anything still unspent afterwards is a closed loop.
  /*
   * Whether a run is a ring is a question about the run, not about which loop
   * below caught it.
   *
   * The first version asked the second loop -- "anything still unspent is a
   * closed loop" -- and that is true of a cycle made of several pieces chained
   * through junctions. It is not true of the shape that matters most here. An
   * `o` is one unbroken ring with no junction anywhere on it, so both its ends
   * are unpartnered and the *first* loop takes it, as an open run. The flag
   * never fired on the one letter it was written for.
   *
   * Asked of the geometry it is one line and cannot miss: a run whose last
   * point is back where its first began has no ends.
   */
  const isRing = (run: Array<[number, number]>): boolean => {
    if (run.length < 8) return false;
    const [ax, ay] = run[0];
    const [bx, by] = run[run.length - 1];
    // Within a pixel or two: the walk stops when it meets its own start, which
    // it reaches as a neighbour rather than by landing on it exactly.
    return Math.hypot(ax - bx, ay - by) <= 2;
  };

  for (let index = 0; index < paths.length; index++) {
    if (spent.has(index)) continue;
    for (const start of [true, false]) {
      if (partner.has(tag(index, start))) continue;
      const run = chainFrom(index, start);
      if (run.length >= 2) out.push({ points: run, closed: isRing(run) });
      break;
    }
  }
  /*
   * What is left has no loose end anywhere, which is what a ring is.
   *
   * This was already known here -- the comment above has said "anything still
   * unspent afterwards is a closed loop" for as long as the function has
   * existed -- and then thrown away, because the run went into the same list
   * as every other and the spine was built with `closed: false` regardless.
   *
   * The cost was the worst number in the whole harness. An `o` is one ring, and
   * fitted as though it were an open line its two ends are the same point with
   * opposite tangents: the fitter is asked for a curve that leaves a point
   * heading one way and arrives back at it heading the other, and it answers
   * with something wild. The spine deviation on a DejaVu `o` was 1016 units on
   * a 1000-unit em, and the sweep then spent three hundred and eighty-four
   * nodes drawing it.
   */
  for (let index = 0; index < paths.length; index++) {
    if (spent.has(index)) continue;
    const run = chainFrom(index, true);
    if (run.length >= 2) out.push({ points: run, closed: true });
  }
  return out;
}

/**
 * One run of skeleton, and whether it comes back to where it started.
 *
 * A ring has no ends, so it has no terminals to cap and no tangent
 * discontinuity anywhere along it. Both facts matter downstream and neither
 * survives being reduced to a list of points.
 */
interface Run {
  points: Array<[number, number]>;
  closed: boolean;
}

/** How long a pixel path is, in font units. */
function pathLength(path: Array<[number, number]>, grid: Grid): number {
  let total = 0;
  for (let index = 1; index < path.length; index++) {
    total += Math.hypot(
      path[index][0] - path[index - 1][0],
      path[index][1] - path[index - 1][1],
    );
  }
  return total * grid.scale;
}

/**
 * A ring, fitted in halves so its seam is not a corner.
 *
 * `fitCubics` takes an open run and reads the tangent at each end from the
 * points nearest it. On a ring the two ends are the same place and their
 * tangents are opposite -- the curve leaves heading one way round and comes
 * back heading the other -- so asking for a single open fit is asking for a
 * curve that does something impossible, and the answer is wild: a DejaVu `o`
 * came back with its centre-line a thousand units off a letter seven hundred
 * units tall, and the sweep then spent three hundred and eighty-four nodes
 * drawing the mistake.
 *
 * Cut in half, each piece is an ordinary open arc whose end tangents are read
 * from real neighbours on both sides, and the two pieces meet where the ring
 * genuinely continues. The seam is placed at the halfway point rather than
 * anywhere clever because a ring has no distinguished place on it; what matters
 * is only that there are two seams rather than one, so neither is asked to be a
 * reversal.
 */
function fitRing(
  points: Vec2[],
  tolerance: number,
): { curves: ReturnType<typeof fitCubics>["curves"]; deviation: number } {
  if (points.length < 6) return fitCubics(points, tolerance);

  /*
   * Closed properly before it is cut, because a walk of a ring stops one pixel
   * short of its own start: the first pixel is already spent. Without the
   * wrap the second half ends a step early and the sweep leaves a notch.
   */
  const loop = [...points];
  const first = loop[0];
  const last = loop[loop.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-9)
    loop.push({ ...first });

  const half = Math.floor(loop.length / 2);
  const front = fitCubics(loop.slice(0, half + 1), tolerance);
  const back = fitCubics(loop.slice(half), tolerance);
  return {
    curves: [...front.curves, ...back.curves],
    deviation: Math.max(front.deviation, back.deviation),
  };
}

/**
 * A pixel path, smoothed.
 *
 * The thinned line steps between whole pixels, so it is a staircase at the
 * scale the fitter works at, and fitting cubics straight to a staircase spends
 * nodes on the steps. A short moving average takes the steps out without moving
 * the line off the middle: the ends are held exactly, because where a stroke
 * starts and stops is the one thing not to average away.
 */
/**
 * The last stretch of a skeleton at a free end, straightened out.
 *
 * The width profile already refuses to believe the readings within half a width
 * of a terminal, because the distance field there is measuring the end of the
 * stroke rather than its sides. The *geometry* is no better and was trusted
 * anyway. Thinning an end that is cut at an angle -- which is most terminals on
 * most faces -- leaves the medial axis curling away towards the sharper of the
 * two corners, and that curl is not in the letter. Swept, it came back as a
 * loop hanging off the tip of every `a`, `s`, `v`, `c` and `z` in the alphabet:
 * the spine turned through most of a circle inside half a stroke width, so the
 * inner side of the offset crossed itself.
 *
 * So the corrupted stretch is replaced rather than removed. The direction the
 * stroke was travelling before it reached the terminal is measured where that
 * is still readable, and the tail is laid out straight along it, keeping the
 * spacing it had -- which puts the tip back where the skeleton put it, without
 * the curl it acquired getting there.
 *
 * Only at a free end. A run that stops at a junction is not near a boundary and
 * has nothing wrong with it.
 */
function steadyEnds(
  points: Vec2[],
  free: { start: boolean; end: boolean },
  guard: number,
): Vec2[] {
  if (guard < 2 || points.length < guard * 2 + 3) return points;
  const out = [...points];

  /*
   * The curl is taken out by drawing the chord, which keeps both of its ends.
   *
   * What must not change is where the tail finishes: the skeleton's last point
   * is on the medial axis and everything downstream -- how wide the terminal
   * is, how far past it the ink runs, whether it was cut or rounded -- is
   * measured from there and has to start inside the letter. Straightening the
   * tail while keeping its *length* instead does not: a curl covers far more
   * ground than it gets anywhere, so laid out straight it shot ninety-five
   * units past the end of a `c` and landed outside the ink, where every probe
   * that followed found nothing and every terminal in the font read as round.
   */
  const chord = (tip: number, anchor: number) => {
    const step = tip < anchor ? 1 : -1;
    for (let index = tip; index !== anchor; index += step) {
      const t = Math.abs(index - anchor) / Math.abs(tip - anchor);
      out[index] = {
        x: points[anchor].x + (points[tip].x - points[anchor].x) * t,
        y: points[anchor].y + (points[tip].y - points[anchor].y) * t,
      };
    }
  };

  if (free.start) chord(0, guard);
  if (free.end) chord(points.length - 1, points.length - 1 - guard);
  return out;
}

function smoothed(points: Vec2[], passes = 2): Vec2[] {
  let run = points;
  for (let pass = 0; pass < passes; pass++) {
    if (run.length < 3) break;
    const next: Vec2[] = [run[0]];
    for (let index = 1; index < run.length - 1; index++) {
      next.push({
        x: (run[index - 1].x + run[index].x * 2 + run[index + 1].x) / 4,
        y: (run[index - 1].y + run[index].y * 2 + run[index + 1].y) / 4,
      });
    }
    next.push(run[run.length - 1]);
    run = next;
  }
  return run;
}

// ---------------------------------------------------------------------------
// The width along a path
// ---------------------------------------------------------------------------

/**
 * The width profile of one path, read off the distance field and reduced.
 *
 * Sampled at every point and then thinned down to a handful of stops, because a
 * profile with one stop per pixel is a recording rather than a description and
 * could not be edited by a person. The stops kept are the ones the rest cannot
 * be interpolated from: the two ends always, and then whichever interior point
 * is worst predicted by the stops so far, until either the profile is within a
 * unit everywhere or the budget is spent. That is the same idea as the curve
 * fitter, applied to a scalar.
 */
function widthProfile(
  path: Array<[number, number]>,
  grid: Grid,
  field: Float64Array,
  budget: number,
  free: { start: boolean; end: boolean },
): WidthProfile {
  const widths = path.map(
    ([x, y]) => distanceAt(grid, field, x, y) * 2 * grid.scale,
  );
  if (widths.length === 0) return [{ at: 0, width: 0 }];
  if (widths.length === 1) return [{ at: 0, width: widths[0] }];

  /*
   * The last half-width at each free end is not a reading of the stroke.
   *
   * Only at a *free* end. Thinning stops short of a boundary, and a junction is
   * not a boundary: where the shoulder of an `n` runs into its stem the field
   * does not fall away, it swells, because the largest circle that fits at a
   * join spans both strokes. A ring has no free ends at all, so none of this
   * applies to one -- the reading at the seam of an `o` is as good as the
   * reading anywhere else on it, and holding it flat would put a false step
   * where the profile wraps.
   *
   * The distance field says how far a point is from the nearest edge, and
   * within half a width of the end of a stroke the nearest edge is the end
   * itself rather than either side. So the field falls away to nothing at every
   * terminal, whatever the stroke was actually doing there, and a profile that
   * believes it reports a stroke that tapers to a point at both ends.
   *
   * The cost of believing it was exactly measurable: a plain stroke ninety
   * units wide, cut square at both ends, came back full width in the middle and
   * nothing at the ends, redrawing forty-four and a half units off -- which is
   * half the width, which is the whole of what the field could not see.
   *
   * So the reading is held from the first point that is far enough in to be
   * measuring the sides. Where the stroke really does taper -- a written entry
   * stroke, a pointed terminal -- that taper happens over a much longer run
   * than half a width and survives this untouched.
   */
  /*
   * How far in the reading is untrustworthy, which depends on how wide the
   * stroke is *there* rather than at its widest.
   *
   * The corrupted run is half the local width long, so the answer depends on
   * itself. Started from the widest reading and settled twice, which is enough:
   * on a stroke of one width it does not move, and on one that tapers from a
   * hundred and ten in the middle to thirty at the ends it comes down from
   * fifty-five to about fifteen -- the difference between holding the last
   * fifty-five points flat, which erases a real taper, and holding the last
   * fifteen, which is only the part the field could not see.
   */
  /*
   * How far in the reading is untrustworthy, found from how fast it climbs.
   *
   * Near a free end the field is measuring the end rather than the sides, so
   * the reading climbs steeply as it leaves: two units of width per unit of
   * distance from a square cut, 2cos(the angle) from one cut at an angle, and
   * it stops climbing the moment the sides become the nearer boundary. A
   * stroke that is genuinely widening climbs far more slowly -- a taper from
   * thirty units to a hundred and ten over the length of a letter climbs at a
   * third of a unit -- so the rate separates the two with room on both sides,
   * and eight tenths sits in the gap.
   *
   * Four cruder rules were tried and each failed on a case the others survived.
   * A fixed point settling downwards -- the guard becomes half the width found
   * *at* the guard -- walks to nothing, because the readings near a terminal are
   * small precisely when the guard is too short to have cleared them: a `c` a
   * hundred and ninety units wide settled on fifteen samples and called itself
   * thirty wide at both ends. Settled upwards it stalls on the first step.
   * Asking merely whether the climb has *stopped* cannot tell a terminal from a
   * stroke that is widening, and swallowed a third of every tapered stroke.
   *
   * And asking whether the reading is *proportional* to the distance -- which
   * is what the geometry above says, and what this did until the `w` was
   * measured -- assumes the reading falls to nothing at the tip. It does not:
   * thinning stops a little short of the end, so the reading there is already
   * twice that much, the ratio starts high and falls from the first step
   * whatever the stroke is doing. The top right arm of a `w` got a guard of
   * three samples where its terminal ran sixty, and was drawn seventeen units
   * wide where the letter is a hundred and seventy-nine.
   *
   * The cost of getting this wrong is not subtle. A round cap is a disc of half
   * the width at that end, so thirty units read on a stroke that is really a
   * hundred and ninety puts a fifteen-unit disc where a ninety-five unit one
   * belongs, and the outline loops back on itself getting there.
   */
  const guardFrom = (fromStart: boolean): number => {
    if (!(fromStart ? free.start : free.end)) return 0;
    const ceiling = Math.floor(widths.length / 3);
    const at = (step: number) => (fromStart ? step : widths.length - 1 - step);
    const gap = (step: number) => {
      const [ax, ay] = path[at(step)];
      const [bx, by] = path[at(step + 1)];
      return Math.hypot(bx - ax, by - ay) * grid.scale;
    };
    /*
     * Over a short window rather than between neighbours, because the field is
     * read off a grid: two adjacent samples on a diagonal differ by a step or
     * by nothing depending on which pixels they landed on.
     */
    const span = 8;
    for (let step = 0; step + span <= ceiling; step++) {
      let along = 0;
      for (let k = step; k < step + span; k++) along += gap(k);
      if (along < 1e-9) continue;
      const climb = (widths[at(step + span)] - widths[at(step)]) / along;
      if (climb < 0.8) return step;
    }
    return ceiling;
  };

  /*
   * The corrupted stretch filled in by carrying the stroke's own trend into it,
   * rather than by holding one reading flat across it.
   *
   * Everything from the guard inwards is a true reading, so the two readings
   * either side of the guard say what the stroke is doing there -- steady, or
   * widening, or narrowing -- and continuing that to the tip is the best that
   * can be said about a stretch the field could not see. On a stroke of one
   * width the trend is flat and this holds it flat, which is what a square cut
   * wants. On one that tapers it keeps tapering: a stroke swelling from thirty
   * at its cut to a hundred and ten in its middle was read as thirty-eight at
   * the cut when the widest reading in the zone was held there instead, and
   * thirty-eight against thirty is a cap a quarter too big, which is enough for
   * a round one to describe the end better than the square one it actually has.
   *
   * Clamped either side of the reading at the guard, because an extrapolation
   * is a guess and a guess should not be allowed to run away with a terminal.
   */
  const carryInto = (fromStart: boolean, guard: number) => {
    if (guard <= 0) return;
    const at = (step: number) => (fromStart ? step : widths.length - 1 - step);
    const gap = (step: number) => {
      const [ax, ay] = path[at(step)];
      const [bx, by] = path[at(step + 1)];
      return Math.hypot(bx - ax, by - ay) * grid.scale;
    };
    const reach = Math.min(guard * 2, widths.length - 1);
    let span = 0;
    for (let step = guard; step < reach; step++) span += gap(step);
    const anchor = widths[at(guard)];
    const slope = span > 1e-9 ? (widths[at(reach)] - anchor) / span : 0;
    const floor = anchor * 0.4;
    const ceiling = anchor * 1.6;
    let away = 0;
    for (let step = guard - 1; step >= 0; step--) {
      away += gap(step);
      widths[at(step)] = Math.min(
        ceiling,
        Math.max(floor, anchor - slope * away),
      );
    }
  };

  const headGuard = guardFrom(true);
  const footGuard = guardFrom(false);

  /*
   * A single reading is not evidence, and near a join it is a lie.
   *
   * The field says how far a point is from the nearest edge of the *union* of
   * the strokes, so where the bowl of a `p` meets its stem the largest circle
   * that fits is bigger than either of them, and a little further on -- where
   * the spine has been pulled off the medial axis by the same join -- it is
   * smaller. The `p` read a bowl of a steady hundred and eighty-six as
   * 186, 234, 103, 104, 234, 192, and drawn from that it came back with four
   * fifths of the ink the letter has.
   *
   * A median rejects such an excursion outright instead of averaging it in,
   * provided the window is wider than the excursion is long -- and the
   * excursion is about as long as the joining stroke is wide, which is about as
   * wide as this one. So the window is the stroke's own width, which makes it
   * twice what it has to be on the letters that need it and keeps it in
   * proportion on a hairline. Capped at a quarter of the run, so a short stroke
   * is not flattened to a single number by its own rule.
   *
   * Run after the guards are decided and before they are filled in: the climb
   * at a free end is real and the guard has to see it, and what is carried into
   * that stretch afterwards should be the readings rather than a median of the
   * readings against the empty space past the terminal.
   */
  const sorted = [...widths].sort((one, other) => one - other);
  const typical = sorted[widths.length >> 1];
  const window = Math.min(
    Math.floor(widths.length / 4),
    Math.max(1, Math.round(typical / grid.scale)),
  );
  if (widths.length > window * 2 + 1) {
    const raw = [...widths];
    const sorting: number[] = [];
    for (let index = 0; index < widths.length; index++) {
      /*
       * Kept symmetric about the point, even where that means a shorter window.
       *
       * A window clipped at an end is a window looking only inwards, and on a
       * stroke that widens as it leaves its terminal that reads high: a taper
       * genuinely thirty units wide at its cut came back thirty-eight, which
       * was enough for a round cap to describe its square end better than a
       * square one did. Symmetric, the median of a run that is climbing is the
       * reading in the middle of it, so a terminal is left exactly as measured
       * and only a bump with stroke either side of it is rejected -- which is
       * the only thing this is here to reject.
       */
      const reach = Math.min(window, index, raw.length - 1 - index);
      if (reach < 1) continue;
      sorting.length = 0;
      for (let i = index - reach; i <= index + reach; i++) sorting.push(raw[i]);
      sorting.sort((one, other) => one - other);
      widths[index] = sorting[sorting.length >> 1];
    }
  }

  carryInto(true, headGuard);
  carryInto(false, footGuard);

  /*
   * An end that is a join has the opposite problem, and needed saying
   * separately.
   *
   * The median above rejects a join in the middle of a run because it can look
   * at the stroke either side of it. At an end there is no either side: the run
   * stops inside the swelling, so half the window is swelling and the median
   * keeps it. The two arms of an `x` end at their crossing and read two hundred
   * and thirty where they are a hundred and seventy-two, and the letter came
   * back with a fifth more ink than it has, all of it piled at the middle.
   *
   * Held instead at the first reading past the swelling, which the median has
   * already cleaned: the stroke does not change width in the length of a join,
   * and where it does, that is the joining stroke's doing rather than its own.
   */
  const join = Math.min(Math.floor(widths.length / 6), Math.round(window / 2));
  if (!free.start && join > 0) {
    const width = widths[join];
    for (let index = 0; index < join; index++) widths[index] = width;
  }
  if (!free.end && join > 0) {
    const width = widths[widths.length - 1 - join];
    for (let index = 0; index < join; index++)
      widths[widths.length - 1 - index] = width;
  }

  /*
   * Where each reading sits along the stroke, by arc length rather than by
   * count.
   *
   * The sweep reads a profile by arc length -- that is the whole point of a
   * profile, so that a swelling halfway along is halfway along the ink. The
   * readings come from an eight-connected walk over the skeleton, where a
   * diagonal step is half again as long as an orthogonal one, so counting them
   * puts a stop as much as twenty-nine per cent away from where it was read.
   */
  const run = [0];
  for (let index = 1; index < path.length; index++) {
    const [ax, ay] = path[index - 1];
    const [bx, by] = path[index];
    run.push(run[index - 1] + Math.hypot(bx - ax, by - ay));
  }
  const total = run[run.length - 1];
  const places =
    total > 0
      ? run.map((one) => one / total)
      : widths.map((_, index) => index / (widths.length - 1));

  const kept = [0, widths.length - 1];
  /*
   * Read back the way the sweep will read it, easing included.
   *
   * The reduction is only worth its name if the error it minimises is the error
   * that will be drawn. Thinned against a straight interpolation and then drawn
   * with a smoothstep, a profile certified within a unit everywhere is nothing
   * of the sort.
   */
  const readAt = (index: number): number => {
    const place = places[index];
    let before = kept[0];
    let after = kept[kept.length - 1];
    for (const one of kept) {
      if (places[one] <= place) before = one;
    }
    for (let i = kept.length - 1; i >= 0; i--) {
      if (places[kept[i]] >= place) after = kept[i];
    }
    if (before === after) return widths[before];
    const span = places[after] - places[before];
    const t = span > 0 ? (place - places[before]) / span : 0;
    const eased = t * t * (3 - 2 * t);
    return widths[before] + (widths[after] - widths[before]) * eased;
  };

  while (kept.length < budget) {
    let worst = 0;
    let where = -1;
    for (let index = 1; index < widths.length - 1; index++) {
      if (kept.includes(index)) continue;
      const off = Math.abs(readAt(index) - widths[index]);
      if (off > worst) {
        worst = off;
        where = index;
      }
    }
    if (where < 0 || worst < 1) break;
    kept.push(where);
    kept.sort((one, other) => one - other);
  }

  return kept.map((index) => ({
    at: places[index],
    width: Math.max(0, widths[index]),
  }));
}

// ---------------------------------------------------------------------------
// The whole glyph
// ---------------------------------------------------------------------------

export interface Fitted {
  glyph: QuillGlyph;
  /** How many paths the thinning produced before pruning. */
  found: number;
  /** How many survived, and are therefore strokes. */
  kept: number;
  /** The worst the fitted centre-line strays from the thinned one, in units. */
  spineDeviation: number;
}

/**
 * Read a glyph's outlines back into strokes.
 *
 * Returns null where there is nothing to read: an empty glyph, or one whose
 * bounding box is so large that rasterising it would be unreasonable.
 */
export function fitGlyph(
  name: string,
  contours: Contour[],
  advanceWidth: number,
  options: FitOptions = {},
): Fitted | null {
  /*
   * About a thousand pixels to the em, whatever the em is.
   *
   * Fixed at a pixel per unit this took four times as long on a 2048-unit font
   * as on a 1000-unit one and was no more accurate in any way a reader could
   * see -- and slowly enough that tracing an alphabet ran past a minute and a
   * half. Sized against the em it is the same work and the same proportional
   * accuracy for either.
   */
  const scale =
    options.scale ?? Math.max(1, (options.unitsPerEm ?? 1000) / 1000);
  const budget = options.widthStops ?? 6;

  const grid = rasterise(contours, scale);
  if (!grid) return null;
  /*
   * How closely the spine is fitted, and why it is not as closely as asked.
   *
   * The centre-line being fitted is a walk over a grid of pixels: it is a
   * staircase, and it is not known to better than about a pixel wherever it
   * runs diagonally. Fitted to a fifth of that, the fitter does not follow the
   * letter more faithfully -- it follows the *staircase*, splitting again and
   * again to chase quantisation that is not in the drawing at all. The `o` of
   * a sans came back as a forty-five segment centre-line, which is a circle
   * described eleven times over, and every one of those segments then paid for
   * itself twice in the outline swept from it.
   *
   * Floored at three pixels the same `o` is four segments, the alphabet loses
   * three quarters of its nodes, and the redrawing moves by a tenth of a unit.
   * A caller asking for something finer is honoured -- a test fitting a spine
   * that was not read off a grid has every right to -- but nothing here asks
   * for an accuracy the reading cannot support.
   */
  const tolerance = options.tolerance ?? Math.max(1.2, 3 * grid.scale);

  const field = distances(grid);
  const skeleton = thin(grid);
  const cut = tracePaths(skeleton, grid);
  const paths = spliceAtJunctions(cut, grid);

  /*
   * How many paths share each piece of skeleton.
   *
   * A path that is the only one in its piece is a mark standing alone -- the
   * dot of an `i`, the dot of a `j` -- and is never a whisker, whatever its
   * length. Before this was checked, both dots were pruned as spurs and those
   * two letters came back missing them, which the error harness reported as
   * fifty units of deviation and which is really a missing feature rather than
   * an inaccurate one.
   */
  const label = components(skeleton, grid);
  const share = new Map<number, number>();
  for (const run of paths) {
    const which = label[run.points[0][1] * grid.width + run.points[0][0]];
    share.set(which, (share.get(which) ?? 0) + 1);
  }

  /*
   * How short is too short.
   *
   * Measured against the stroke's own width rather than against the em: a spur
   * on a hairline is a different size from a spur on a heavy stem, and a single
   * number in font units would prune one letter bald and leave the other
   * bristling. Twice the local width is the rule, floored so that a very thin
   * stroke does not set the bar at nothing.
   */
  const prune = options.prune;
  const strokes: QuillStroke[] = [];
  let spineDeviation = 0;

  for (const run of paths) {
    const path = run.points;
    const length = pathLength(path, grid);
    const middle = path[Math.floor(path.length / 2)];
    const localWidth =
      distanceAt(grid, field, middle[0], middle[1]) * 2 * grid.scale;
    /*
     * How short is too short.
     *
     * Measured against the stroke's own width, because a whisker left by
     * thinning is about as long as the stroke is wide -- it is the corner of
     * the outline reaching further from the middle than its neighbours. Three
     * quarters of the width catches those and leaves genuine short strokes
     * alone. It was twice the width to begin with, which on a script pruned
     * every stroke under a hundred and twenty units and took real ones with it.
     */
    const floor = prune ?? Math.max(localWidth * 0.75, 4 * scale);
    const ends = path.filter(
      ([x, y]) => neighboursOf(skeleton, grid, x, y).length === 1,
    ).length;
    /*
     * Which ends of this run are ends of the *letter* rather than joins.
     *
     * A run is cut at every junction, so each of its two ends is either a free
     * terminal -- one skeleton neighbour, nothing beyond it -- or a place where
     * it meets other strokes. Everything below that reasons about terminals
     * has to ask this first, and did not: treated as a terminal, the shoulder
     * of an `n` had its end probed for square corners, found ink on both sides
     * because it was standing in the middle of the stem, concluded the stroke
     * was cut square and ran the spine half a width further -- out through the
     * far side of the stem, where it drew a blob.
     */
    const freeAt = (point: [number, number]) =>
      !run.closed &&
      neighboursOf(skeleton, grid, point[0], point[1]).length === 1;
    const free = { start: freeAt(path[0]), end: freeAt(path[path.length - 1]) };
    const alone =
      (share.get(label[path[0][1] * grid.width + path[0][0]]) ?? 1) <= 1;
    // A run joined at both ends is load-bearing however short. A run that is
    // the whole of its own piece of skeleton is a mark, not a whisker.
    if (!alone && ends > 0 && length < floor) continue;

    /*
     * How much of each end is the terminal rather than the stroke, in samples.
     *
     * The same half-a-width rule the width profile uses, and for the same
     * reason: within that distance of a free end the field and the thinning are
     * both describing the end of the stroke rather than its sides.
     */
    const guard = Math.min(
      Math.floor(path.length / 3),
      Math.max(0, Math.round(localWidth / 2 / grid.scale)),
    );
    const points = smoothed(
      steadyEnds(
        path.map(([x, y]) => toUnits(grid, x, y)),
        free,
        guard,
      ),
      2,
    );
    if (points.length < 2) continue;
    const fitted = run.closed
      ? fitRing(points, tolerance)
      : fitCubics(points, tolerance);
    if (fitted.curves.length === 0) continue;
    spineDeviation = Math.max(spineDeviation, fitted.deviation);

    const profile = widthProfile(path, grid, field, budget, free);
    const segments = [...fitted.curves];

    /*
     * Which way each end was finished, read off the ink rather than assumed.
     *
     * Thinning stops half a width short of *any* terminal, because the end of
     * the stroke is a boundary like the sides are. So a stroke cut square and
     * one rounded off leave the same skeleton, and the only place the two
     * differ is the corners: a square end has ink out at the full width right
     * up to the cut, and a round one does not.
     *
     * So the corners are the question, and they can simply be asked. If the ink
     * covers both corners of the rectangle the stroke would end in, the end was
     * cut square, and the spine is run out to meet it; if it does not, the end
     * was round and the spine stops where it is with a disc on it.
     *
     * Assuming round throughout was the first version and it is right for
     * written scripts -- which is what this engine is for, and it fitted one to
     * within two and a half units. It was wrong by half a width at every corner
     * of anything cut square, which a sans is made of.
     */
    const endCap = (which: "start" | "end") => {
      const edge =
        which === "start" ? segments[0] : segments[segments.length - 1];
      // A join is not a terminal: nothing to run out to, and nothing to cap.
      if (!free[which]) return { cap: { kind: "butt" } as const, tip: null };
      const tip = which === "start" ? edge.from : edge.to;
      /*
       * Which way the stroke was heading when it ran out, taken from the
       * skeleton rather than from the curve fitted to it.
       *
       * A cubic's control point is not a direction. Where the fit falls back --
       * a run that doubles back, two samples on top of each other -- the handle
       * is placed a third of the chord along a tangent that was itself read off
       * two points a fraction of a unit apart, and it can come out anywhere.
       * At the foot of a `c` it came out pointing straight up the page, so the
       * probe that is meant to look past the end of the stroke looked back
       * along it, found no ink where it expected some, and reported a round
       * terminal. Every angled cut in the font was called round that way.
       *
       * The skeleton has no such problem: it is a run of points, and the
       * direction over the last stretch of it is a measurement.
       */
      const span = Math.max(4, Math.min(guard, points.length - 1));
      const from =
        which === "start" ? points[span] : points[points.length - 1 - span];
      const dx = tip.x - from.x;
      const dy = tip.y - from.y;
      const run = Math.hypot(dx, dy);
      if (run < 1e-9) return { cap: { kind: "round" } as const, tip };
      const out = { x: dx / run, y: dy / run };
      const half = widthAt(profile, which === "start" ? 0 : 1) / 2;
      if (half <= grid.scale) return { cap: { kind: "round" } as const, tip };
      const across = { x: -out.y, y: out.x };
      /*
       * How far the ink actually runs past the skeleton, measured on each side
       * rather than guessed from the shape of the corners.
       *
       * Thinning stops half a width short of any terminal, because the end is a
       * boundary like the sides are, so a stroke cut square and one rounded off
       * leave the same skeleton and the difference is entirely in the ink past
       * it. Asked whether the ink covers *both* corners of the rectangle the
       * stroke would end in -- which is what this did -- only a terminal cut
       * dead square says yes, and most terminals on most faces are not: DejaVu
       * cuts the ends of its `c`, `s`, `z` and `v` at an angle, so one corner
       * is covered and one is not, every one of them was called round, and a
       * semicircle of ninety-five units was drawn where an angled cut belongs.
       *
       * Measured instead: walk out along the stroke's heading on each side and
       * see how far the ink goes. Square gives half a width on both sides, an
       * angled cut gives more on one and less on the other about the same mean,
       * and a rounded end -- where the ink at this distance across the stroke
       * has already run out -- gives about half of that on both. The mean is
       * what decides, and it is also how far the spine is then run out, so an
       * angled cut is cut square through its middle rather than rounded off.
       */
      const step = Math.max(grid.scale, 1);
      /*
       * How far the ink runs in a direction, from a point that is in it.
       * Nought when the starting point is already outside.
       */
      const inkFrom = (
        fromX: number,
        fromY: number,
        wayX: number,
        wayY: number,
        cap: number,
      ) => {
        if (!coversPoint(grid, { x: fromX, y: fromY })) return 0;
        let far = 0;
        for (let out2 = 1; out2 <= Math.ceil(cap / step); out2++) {
          const along = out2 * step;
          if (
            !coversPoint(grid, {
              x: fromX + wayX * along,
              y: fromY + wayY * along,
            })
          )
            break;
          far = along;
        }
        return far;
      };

      /*
       * How far past the tip the ink runs, measured on both sides.
       *
       * Thinning stops short of any terminal, because the end of a stroke is a
       * boundary like its sides are, and how far short is not fixed: a stem cut
       * square runs half a width past where the skeleton gave out, while the
       * foot of an `x`, whose arm reaches the baseline first, runs no distance
       * at all. Started half a width back down the spine, which is on the
       * medial axis and so inside the letter by construction, and that distance
       * taken off again.
       */
      const back = half * 0.5;
      const reachOn = (side: 1 | -1) =>
        Math.max(
          0,
          inkFrom(
            tip.x - out.x * back + across.x * half * 0.85 * side,
            tip.y - out.y * back + across.y * half * 0.85 * side,
            out.x,
            out.y,
            half * 3,
          ) - back,
        );
      const onLeft = reachOn(1);
      const onRight = reachOn(-1);
      const reach = (onLeft + onRight) / 2;

      /*
       * Cut or rounded, settled by asking which of the two describes the ink.
       *
       * Every rule tried before this was a threshold on some single number, and
       * each one failed on a case the others handled. Are both corners of the
       * end rectangle covered? Only for a cut dead square, and DejaVu cuts its
       * `c`, `s`, `v` and `z` at an angle -- all of them read round, and a
       * semicircle of ninety-five units went where an angled cut belongs. Does
       * the ink run far enough past the tip? Not at the foot of an `x`, where
       * the arm reaches the baseline before the thinning gives out -- those
       * read round too and hung half a disc below the line, a fifth more ink
       * than the letter has. Is the stroke its full width across, just inside
       * the tip? A round end is full width just inside the tip as well, because
       * the disc is centred there.
       *
       * There is no single number that separates a square cut, an angled cut
       * and a rounded end, and there does not need to be one: the two caps can
       * simply be drawn and compared against the letter. Points are sampled
       * over the ground past the tip that either cap could claim, and each cap
       * is scored on how often it agrees with the ink -- covered where there is
       * ink, clear where there is none. A disc scores badly on a cut end
       * because of the two corners it leaves empty; a rectangle scores badly on
       * a rounded one because of the same two corners filled in. Whichever
       * describes the letter wins, and neither needs tuning.
       */
      const agreement = (rounded: boolean): number => {
        let agree = 0;
        let asked = 0;
        /*
         * Fine enough that the corners decide it, which is the whole question.
         *
         * A disc and a rectangle of the same width differ only in the two
         * corners, and a grid coarse enough to step over them is a coin toss:
         * at a fifth of the half-width the square-cut descender of a `p` scored
         * 0.798 as a disc and 0.762 as the rectangle it actually is, and was
         * drawn ninety units short.
         */
        const grain = Math.max(half / 12, grid.scale);
        for (let a = -half * 1.2; a <= half * 1.2; a += grain) {
          for (
            let along = 0;
            along <= Math.max(reach, half) * 1.3;
            along += grain
          ) {
            const claimed = rounded
              ? Math.hypot(along, a) <= half
              : along <= reach && Math.abs(a) <= half;
            asked++;
            const point = {
              x: tip.x + out.x * along + across.x * a,
              y: tip.y + out.y * along + across.y * a,
            };
            if (claimed === coversPoint(grid, point)) agree++;
          }
        }
        return asked > 0 ? agree / asked : 0;
      };

      if (agreement(true) > agreement(false))
        return { cap: { kind: "round" } as const, tip };
      /*
       * The angle of the cut, carried across as the difference between the two
       * sides rather than thrown away.
       *
       * The probes stand at 0.85 of the half-width off the centre-line, so the
       * difference they see is 0.85 of the difference at the edges of the
       * stroke; dividing puts it back. Without this the cut is drawn square
       * whatever the letter does, which lands one corner short of the ink and
       * the other out past it -- a small flag off the end of every `c`, `s`,
       * `v`, `w`, `y` and `z`, and worth up to half a stroke width.
       */
      return {
        cap: { kind: "butt" as const, lead: (onLeft - onRight) / 0.85 },
        tip: { x: tip.x + out.x * reach, y: tip.y + out.y * reach },
      };
    };

    const head = endCap("start");
    const foot = endCap("end");
    const wasAt = segments[0].from;
    const before = walkOf({ segments, closed: run.closed }).total;
    if (head.cap.kind === "butt" && head.tip)
      segments[0] = { ...segments[0], from: head.tip };
    if (foot.cap.kind === "butt" && foot.tip) {
      segments[segments.length - 1] = {
        ...segments[segments.length - 1],
        to: foot.tip,
      };
    }

    /*
     * A spine run out to a square cut is longer than the one the widths were
     * read along, and the profile is read by arc length.
     *
     * Left as it was, every stop slid towards the start of the stroke by as
     * much as half a width -- ninety units on a DejaVu stem, which on a bowl
     * four hundred long is a fifth of the way round it. The stops are put back
     * where they were read by mapping them through the new length.
     */
    const after = walkOf({ segments, closed: run.closed }).total;
    const shifted =
      after > before + 1e-9 && before > 1e-9
        ? (() => {
            const lead =
              head.cap.kind === "butt" && head.tip
                ? Math.hypot(head.tip.x - wasAt.x, head.tip.y - wasAt.y)
                : 0;
            return profile.map((stop) => ({
              ...stop,
              at: Math.max(0, Math.min(1, (stop.at * before + lead) / after)),
            }));
          })()
        : profile;

    strokes.push({
      spine: { segments, closed: run.closed },
      width: shifted,
      nib: { ...ROUND_NIB },
      start: head.cap,
      end: foot.cap,
    });
  }

  return {
    glyph: {
      name,
      advanceWidth,
      strokes,
      unitsPerEm: options.unitsPerEm ?? 1000,
    },
    found: paths.length,
    kept: strokes.length,
    spineDeviation,
  };
}

/** Whether a point is inside the filled glyph, for checking a fit. */
export function coversPoint(grid: Grid, point: Vec2): boolean {
  const x = Math.round((point.x - grid.originX) / grid.scale - 0.5);
  const y = Math.round((point.y - grid.originY) / grid.scale - 0.5);
  return inside(grid, x, y);
}
