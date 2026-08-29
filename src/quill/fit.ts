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
import { fitCubics } from "./curve";
import { distanceAt, distances, inside, rasterise, thin, toUnits, type Grid } from "./raster";
import { widthAt } from "./sweep";
import { ROUND_NIB, type QuillGlyph, type QuillStroke, type WidthProfile } from "./types";

export interface FitOptions {
  /** Font units per pixel. One is a good trade of accuracy against work. */
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

function neighboursOf(skeleton: Uint8Array, grid: Grid, x: number, y: number): Array<[number, number]> {
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
function tracePaths(skeleton: Uint8Array, grid: Grid): Array<Array<[number, number]>> {
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

  const walkFrom = (start: [number, number], first: [number, number]) => {
    const path: Array<[number, number]> = [start];
    let previous = start;
    let here = first;
    for (let guard = 0; guard < grid.width * grid.height; guard++) {
      path.push(here);
      walked[here[1] * grid.width + here[0]] = 1;
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
      if (skeleton[index] !== 1 || walked[index] === 1 || degree[index] !== 2) continue;
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
): Array<Array<[number, number]>> {
  const key = ([x, y]: [number, number]) => y * grid.width + x;
  const headingOf = (path: Array<[number, number]>, fromStart: boolean): Vec2 => {
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
  const out: Array<Array<[number, number]>> = [];
  const chainFrom = (from: number, enterAt: boolean): Array<[number, number]> => {
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
  for (let index = 0; index < paths.length; index++) {
    if (spent.has(index)) continue;
    for (const start of [true, false]) {
      if (partner.has(tag(index, start))) continue;
      const run = chainFrom(index, start);
      if (run.length >= 2) out.push(run);
      break;
    }
  }
  for (let index = 0; index < paths.length; index++) {
    if (spent.has(index)) continue;
    const run = chainFrom(index, true);
    if (run.length >= 2) out.push(run);
  }
  return out;
}

/** How long a pixel path is, in font units. */
function pathLength(path: Array<[number, number]>, grid: Grid): number {
  let total = 0;
  for (let index = 1; index < path.length; index++) {
    total += Math.hypot(path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1]);
  }
  return total * grid.scale;
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
): WidthProfile {
  const widths = path.map(([x, y]) => distanceAt(grid, field, x, y) * 2 * grid.scale);
  if (widths.length === 0) return [{ at: 0, width: 0 }];
  if (widths.length === 1) return [{ at: 0, width: widths[0] }];

  /*
   * The last half-width at each free end is not a reading of the stroke.
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
  let guard = Math.round(widths.reduce((most, one) => Math.max(most, one), 0) / 2 / grid.scale);
  for (let settle = 0; settle < 2; settle++) {
    const reach = Math.min(guard, widths.length - 1);
    guard = Math.round(widths[reach] / 2 / grid.scale);
  }
  guard = Math.min(Math.floor(widths.length / 3), Math.max(0, guard));
  if (guard > 0) {
    for (let index = 0; index < guard; index++) {
      widths[index] = widths[guard];
      widths[widths.length - 1 - index] = widths[widths.length - 1 - guard];
    }
  }

  const places = widths.map((_, index) => index / (widths.length - 1));
  const kept = [0, widths.length - 1];
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
    return widths[before] + (widths[after] - widths[before]) * t;
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

  return kept.map((index) => ({ at: places[index], width: Math.max(0, widths[index]) }));
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
  const scale = options.scale ?? 1;
  const tolerance = options.tolerance ?? 1.2;
  const budget = options.widthStops ?? 6;

  const grid = rasterise(contours, scale);
  if (!grid) return null;
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
  for (const path of paths) {
    const which = label[path[0][1] * grid.width + path[0][0]];
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

  for (const path of paths) {
    const length = pathLength(path, grid);
    const middle = path[Math.floor(path.length / 2)];
    const localWidth = distanceAt(grid, field, middle[0], middle[1]) * 2 * grid.scale;
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
    const ends = path.filter(([x, y]) => neighboursOf(skeleton, grid, x, y).length === 1).length;
    const alone = (share.get(label[path[0][1] * grid.width + path[0][0]]) ?? 1) <= 1;
    // A run joined at both ends is load-bearing however short. A run that is
    // the whole of its own piece of skeleton is a mark, not a whisker.
    if (!alone && ends > 0 && length < floor) continue;

    const points = smoothed(path.map(([x, y]) => toUnits(grid, x, y)));
    if (points.length < 2) continue;
    const fitted = fitCubics(points, tolerance);
    if (fitted.curves.length === 0) continue;
    spineDeviation = Math.max(spineDeviation, fitted.deviation);

    const profile = widthProfile(path, grid, field, budget);
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
      const edge = which === "start" ? segments[0] : segments[segments.length - 1];
      const tip = which === "start" ? edge.from : edge.to;
      const inward = which === "start" ? edge.c1 : edge.c2;
      const dx = tip.x - inward.x;
      const dy = tip.y - inward.y;
      const run = Math.hypot(dx, dy);
      if (run < 1e-9) return { cap: { kind: "round" } as const, tip };
      const out = { x: dx / run, y: dy / run };
      const half = widthAt(profile, which === "start" ? 0 : 1) / 2;
      if (half <= grid.scale) return { cap: { kind: "round" } as const, tip };
      const across = { x: -out.y, y: out.x };
      /*
       * Probed inside the corner rather than at it.
       *
       * Where exactly the thinning stopped is not known to better than a pixel
       * or two, so a probe placed at the corner the stroke *would* end in falls
       * outside the ink whenever the skeleton was worn back a little further
       * than half a width, and reads a square end as a round one.
       *
       * Nine tenths along and seven tenths across clears both ways. On a square
       * end that point is a tenth of a width short of the cut and well inside
       * the sides, so it answers yes even when the reading of the width is a
       * unit or two generous. On a round one it is 1.14 radii from the centre
       * of the end disc, and the disc stops at one, so it answers no. Both
       * margins were needed: at six tenths and nine tenths the probe sat
       * exactly on the edge of a thirty-unit stroke and the answer was a
       * coin toss.
       */
      const corners = [1, -1].map((side) => ({
        x: tip.x + out.x * half * 0.9 + across.x * half * 0.7 * side,
        y: tip.y + out.y * half * 0.9 + across.y * half * 0.7 * side,
      }));
      if (corners.every((corner) => coversPoint(grid, corner))) {
        // Square. Run the spine out to the cut so the flat end lands on the ink.
        return {
          cap: { kind: "butt" } as const,
          tip: { x: tip.x + out.x * half, y: tip.y + out.y * half },
        };
      }
      return { cap: { kind: "round" } as const, tip };
    };

    const head = endCap("start");
    const foot = endCap("end");
    if (head.cap.kind === "butt") segments[0] = { ...segments[0], from: head.tip };
    if (foot.cap.kind === "butt") {
      segments[segments.length - 1] = { ...segments[segments.length - 1], to: foot.tip };
    }

    strokes.push({
      spine: { segments, closed: false },
      width: profile,
      nib: { ...ROUND_NIB },
      start: head.cap,
      end: foot.cap,
    });
  }

  return {
    glyph: { name, advanceWidth, strokes },
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
