/**
 * The weight control: an outline made lighter or bolder by offsetting it.
 *
 * What a lighter or bolder cut of a letter is, drawn by hand, is its outline
 * moved square to itself -- every stem and bowl a little thinner or thicker,
 * straight edges still straight, curves still smooth, corners still where the
 * two sides of them meet. Done here in four steps.
 *
 * 1. Measure. Every segment is sampled, and at each sample the stroke (lighter)
 *    or the white (bolder) in front of it is measured, the way that bit of
 *    outline is going to move. That decides how far the sample may
 *    go: a stroke that is thin already is thinned proportionally less and never
 *    below a hairline, and an aperture that is closing is left open.
 *
 * 2. Smooth. Those allowances are eased along the outline, so a stroke that has
 *    to be held back thins gradually rather than in a step, and the change
 *    happens round curves rather than along straights. A straight segment
 *    takes one allowance for its whole length, so it moves parallel to itself.
 *
 * 3. Trace. The exact offset -- every sample of every segment pushed along its
 *    own normal by its own amount, each outside corner filled with the point
 *    where its two moved sides meet -- is laid down as a fine polyline, and
 *    every small loop it makes (an inside corner, a serif step shorter than the
 *    weight) is cut out.
 *
 * 4. Refit. Each of the letter's own points is put where its part of the trace
 *    survived, and each curve's handles are fitted to the stretch of trace
 *    between its two ends, leaving each end in the direction the offset
 *    outline does there, the same on both sides of a smooth point. The same
 *    points come out as went in, which a variable font needs.
 */

import {
  splitCubic,
  contourArea,
  contourSegments,
  crossesItself,
  crossingsOf,
  cubicAt,
  cubicDerivativeAt,
  FINE_STEPS,
  distance,
  isClockwise,
  lerp,
  normalize,
  sub,
  type Segment,
} from "./geometry";
import type { Contour, GlyphNode, Vec2 } from "./types";

/**
 * Which way a point moves, given the way its outline faces: the whole of the
 * normal for weight, or only the sideways part of it for putting back the
 * stroke a change of width took away.
 */
export type Shape = (normal: Vec2) => Vec2;
export const ROUND: Shape = (normal) => normal;
export const SIDEWAYS: Shape = (normal) => ({ x: normal.x, y: 0 });

/** The letter a contour belongs to, for measuring how much room it has. */
export interface Surroundings {
  /** Every contour of the letter, flattened. */
  obstacles: Vec2[][];
  /** Whether each contour is ink (true) or a counter. */
  roles: boolean[];
  unitsPerEm: number;
}

/**
 * The thinnest a stroke may become when the weight is taken off, as a fraction
 * of the em, and as a share of what it was. A hairline serif thins by a third
 * of what a stem does rather than vanishing, which is how a light cut of a
 * serif face is drawn: its contrast drops.
 */
const HAIRLINE = 0.008;
const KEPT_SHARE = 1 / 3;
/**
 * The narrowest white a bolder letter may leave between two walls of the same
 * contour or between ink and a counter, as a fraction of the em. Narrower and
 * it reads as a crack through the letter rather than as an opening.
 */
const OPENING = 0.036;
/**
 * A ball is told by the chords across it: aimed this far off square to the
 * outline, a ray across a round blob is shorter than straight across it, and
 * a ray across any stroke longer.
 */
const BALL_ANGLE = (50 * Math.PI) / 180;
/** How much of the weight a ball gives up, lighter, against a stroke. */
const BALL_SHARE = 0.5;
/** The share of the paper between two separate pieces of ink that stays. */
const GAP_KEPT = 0.45;
/** How much of its mean width a counter narrower than an opening keeps. */
const KEPT_OPEN = 0.75;
/** And how much of it any counter keeps where some white is to be kept. */
const COUNTER_KEPT = 0.85;
/**
 * How sharply the allowance takes over from the weight asked for. Sharper
 * taking weight off: eased as gently as adding it, a stroke drawn heavier --
 * the diagonals of a W or an M beside the stems of an H -- stopped well short
 * of its own floor while the stems reached theirs, and a Thin came out with
 * its diagonals twice the weight of its stems.
 */
const KNEE = 6;
const LIGHT_KNEE = 12;
/**
 * The furthest a corner may run out, as a multiple of the weight: a serif's tip
 * made bolder, and -- much less -- the crotch where an arch leaves its stem
 * made lighter. Run out the whole way, a thinned crotch became a long white
 * slit up into the stem; held in, the arch keeps a little more ink where it
 * joins, which is how a light cut is drawn.
 */
const MITRE_LIMIT = 3;
const CROTCH_LIMIT = 1.5;
/**
 * How far a straight side may lean, across its length, to meet a corner held
 * in short of where its offset would put it.
 */
const LEAN = 0.12;
/** Samples per curve for measuring, and for the trace. */
const MEASURE = 12;
const TRACE = 16;
const LINE_MEASURE = 5;
/** How far along a segment its offset's direction is measured over. */
const STEP = 0.01;
/** How finely the retreat below is searched. Six steps resolve a sixty-fourth. */
const BACK_OFF_STEPS = 6;

/** The smaller of two amounts, with the corner between them rounded off. */
function softMin(wanted: number, allowed: number, knee = KNEE): number {
  if (!Number.isFinite(allowed)) return wanted;
  if (allowed <= 0 || wanted <= 0) return 0;
  return (wanted * allowed) / (wanted ** knee + allowed ** knee) ** (1 / knee);
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}
function times(a: Vec2, by: number): Vec2 {
  return { x: a.x * by, y: a.y * by };
}
function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

function pointOn(segment: Segment, t: number): Vec2 {
  return segment.kind === "line"
    ? lerp(segment.from, segment.to, t)
    : cubicAt(segment.from, segment.c1, segment.c2, segment.to, t);
}

/**
 * Which way the outline is travelling partway along a segment. A cubic's
 * derivative vanishes at an end whose handle sits on its own point; the next
 * control point, or the chord, stands in for it there.
 */
function headingOn(segment: Segment, t: number): Vec2 {
  if (segment.kind === "line") return normalize(sub(segment.to, segment.from));
  const direction = normalize(
    cubicDerivativeAt(segment.from, segment.c1, segment.c2, segment.to, t),
  );
  if (direction.x !== 0 || direction.y !== 0) return direction;
  const nudged = normalize(
    cubicDerivativeAt(
      segment.from,
      segment.c1,
      segment.c2,
      segment.to,
      t < 0.5 ? t + 1e-3 : t - 1e-3,
    ),
  );
  if (nudged.x !== 0 || nudged.y !== 0) return nudged;
  return normalize(sub(segment.to, segment.from));
}

function segmentLength(segment: Segment): number {
  if (segment.kind === "line") return distance(segment.from, segment.to);
  let total = 0;
  let last = segment.from;
  for (let i = 1; i <= 16; i++) {
    const point = pointOn(segment, i / 16);
    total += distance(last, point);
    last = point;
  }
  return total;
}

/** How far a ray goes before it crosses the edge from a to b, ignoring its own start. */
function rayToEdge(from: Vec2, heading: Vec2, a: Vec2, b: Vec2): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denominator = heading.x * ey - heading.y * ex;
  if (Math.abs(denominator) < 1e-12) return Infinity;
  const dx = a.x - from.x;
  const dy = a.y - from.y;
  const t = (dx * ey - dy * ex) / denominator;
  const u = (dx * heading.y - dy * heading.x) / denominator;
  // Half a unit: a sample sits on its own curve, and the flattened copy of
  // that curve passes a hair from it.
  return t > 0.5 && u >= 0 && u <= 1 ? t : Infinity;
}

/**
 * The radius of the circle that touches `from`, has its centre straight ahead
 * of it along `heading`, and just reaches the edge from a to b.
 */
function ballTouch(from: Vec2, heading: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(a, from);
  const e = sub(b, a);
  const dd = d.x * d.x + d.y * d.y;
  const de = d.x * e.x + d.y * e.y;
  const ee = e.x * e.x + e.y * e.y;
  const dn = d.x * heading.x + d.y * heading.y;
  const en = e.x * heading.x + e.y * heading.y;
  const radius = (x: number): number => {
    const ahead = dn + x * en;
    // Half a unit clear of the start, which is the outline it sits on.
    if (ahead <= 1e-9) return Infinity;
    const squared = dd + 2 * x * de + x * x * ee;
    if (squared < 0.25) return Infinity;
    return squared / (2 * ahead);
  };
  let best = Math.min(radius(0), radius(1));
  // Where the radius along the edge is least: a quadratic in x.
  const qa = ee * en;
  const qb = 2 * ee * dn;
  const qc = 2 * de * dn - en * dd;
  const roots: number[] = [];
  if (Math.abs(qa) < 1e-12) {
    if (Math.abs(qb) > 1e-12) roots.push(-qc / qb);
  } else {
    const disc = qb * qb - 4 * qa * qc;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      roots.push((-qb + root) / (2 * qa), (-qb - root) / (2 * qa));
    }
  }
  for (const x of roots) if (x > 0 && x < 1) best = Math.min(best, radius(x));
  return best;
}

interface Vertex {
  point: Vec2;
  /** The node this vertex stands for, if any. */
  nodes: number[];
  /** The segment and parameter it was traced from. */
  seg: number;
  t: number;
  /** Arc length round the original outline, for deciding what is nearby. */
  along: number;
  /** For a vertex made by cutting a loop: where it sits on each side. */
  before?: { seg: number; t: number };
  after?: { seg: number; t: number };
}

/**
 * How far apart two closed polylines are: nought where they cross or one is
 * inside the other.
 */
function apart(one: Vec2[], other: Vec2[]): number {
  if (one.length < 2 || other.length < 2) return 0;
  const inside = (point: Vec2, polygon: Vec2[]): boolean => {
    let odd = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if (a.y > point.y !== b.y > point.y) {
        const x = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (x > point.x) odd = !odd;
      }
    }
    return odd;
  };
  if (inside(one[0], other) || inside(other[0], one)) return 0;
  const toSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
    const d = sub(b, a);
    const length = d.x * d.x + d.y * d.y;
    const t =
      length > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / length)) : 0;
    return distance(p, { x: a.x + d.x * t, y: a.y + d.y * t });
  };
  let least = Infinity;
  for (const [from, to] of [
    [one, other],
    [other, one],
  ])
    for (const p of from)
      for (let k = 0; k < to.length; k++) {
        least = Math.min(least, toSegment(p, to[k], to[(k + 1) % to.length]));
        if (least === 0) return 0;
      }
  // Crossing edges come close at some vertex, but not always to nought.
  for (let i = 0; i < one.length; i++)
    for (let k = 0; k < other.length; k++)
      if (segmentsCross(one[i], one[(i + 1) % one.length], other[k], other[(k + 1) % other.length]))
        return 0;
  return least;
}

/**
 * Offset one contour by `amount` -- positive adds weight -- keeping its points.
 */
export function applyWeight(
  contour: Contour,
  amount: number,
  self: number,
  around: Surroundings,
  shape: Shape = ROUND,
  /**
   * The share of any white in front of it that a bolder contour leaves open,
   * however small the weight makes the rest; nought for no more than the
   * opening every weight keeps.
   */
  whiteKept = 0,
  /**
   * A repair the caller makes to what comes back, which the checks below are
   * asked of: putting back a condensed letter's strokes folds small inside
   * corners that `unfold` then lays flat, and judged before that, the fold
   * backed the whole give off. Lora's ¼ and ¾ condensed at the heaviest
   * weight lost a quarter of their ink.
   */
  repair: (trial: Contour) => Contour = (trial) => trial,
): Contour {
  const nodes = contour.nodes;
  const count = nodes.length;
  if (count < 2 || !contour.closed || amount === 0) return contour;
  const segments = contourSegments(contour);
  if (segments.length !== count) return contour;
  const isOuter = around.roles[self] ?? true;
  /*
   * Which way this contour moves to add weight. The normal below is
   * (tangent.y, -tangent.x), which leaves a counter-clockwise contour and
   * enters a clockwise one; a counter goes the other way again, since
   * thickening the stroke round it means closing it. Winding alone cannot say
   * which is which -- DejaVu winds the outside of I one way and of o the other.
   */
  const sign = (isClockwise(contour) ? -1 : 1) * (isOuter ? 1 : -1) * Math.sign(amount);
  const move = (heading: Vec2): Vec2 => shape({ x: heading.y * sign, y: -heading.x * sign });
  const wanted = Math.abs(amount);
  const bolder = amount > 0;
  const em = around.unitsPerEm;

  const lengths = segments.map(segmentLength);
  const starts: number[] = [];
  let total = 0;
  for (const length of lengths) {
    starts.push(total);
    total += length;
  }
  if (total < 1e-6) return contour;

  /*
   * What lies ahead of each sample. Lighter, that is the ink of the stroke:
   * every wall of the letter counts. Bolder, it is paper, and only walls that
   * are really somewhere else count -- a counter's far side, the other side of
   * an aperture. Ink running into ink is not a collision (the letter simply
   * overlaps itself, which fills a notch the way a heavier cut fills it), and
   * the walls of a notch right beside the point are its own corner closing.
   *
   * Measured two ways, and the nearer taken. A ray straight ahead finds the
   * wall across a stem. But where the far wall runs off at a slant -- the
   * crotch where an arch leaves its stem -- a ray skims past it and reports a
   * thick stroke that is not there, so the largest circle that fits in front
   * of the sample is also found: its diameter is the stroke's thickness there.
   * Only walls that face back towards the sample stop the circle, or the side
   * of a serif would read as a wall to the end of it.
   */
  const window = wanted * 4;
  interface Wall {
    a: Vec2;
    b: Vec2;
    /** Which way this wall moves for the same change of weight. */
    normal: Vec2;
    /** Round its own outline, for a wall of this contour; else -1. */
    middle: number;
    /** The segment of this contour it was flattened from; else -1. */
    seg: number;
    /** Which way it runs. */
    edge: Vec2;
    /** Whether it is another piece of ink with paper between them. */
    foreign: boolean;
  }
  const segmentAt = (position: number): number => {
    let found = 0;
    for (let index = 0; index < count; index++) if (starts[index] <= position) found = index;
    return found;
  };
  const walls: Wall[] = [];
  around.obstacles.forEach((polyline, which) => {
    const own = which === self;
    /*
     * Another piece of ink is let run into this one where it overlaps it
     * already -- the parts of a letter built from overlapping strokes -- but
     * not where there is paper between them. The dot of an i or a j, the
     * halves of a colon and the tail of a Q drawn apart from its bowl are
     * separate for a reason: made bolder with no regard for each other, the
     * dot of Geist's j grew into its stem and the letter read as a J.
     */
    const foreign =
      bolder && !own && around.roles[which] === isOuter
        ? isOuter && apart(around.obstacles[self] ?? [], polyline) > em * 0.004
        : false;
    if (bolder && !own && around.roles[which] === isOuter && !foreign) return;
    let area = 0;
    polyline.forEach((point, k) => {
      const next = polyline[(k + 1) % polyline.length];
      area += point.x * next.y - next.x * point.y;
    });
    // Ink lies to the left of an outline running anticlockwise.
    const inkLeft = area > 0 === (around.roles[which] ?? true);
    const facingInk = (inkLeft ? 1 : -1) * (bolder ? -1 : 1);
    let run = 0;
    const perimeter = polyline.reduce(
      (sum, point, k) => sum + distance(point, polyline[(k + 1) % polyline.length]),
      0,
    );
    polyline.forEach((point, k) => {
      const next = polyline[(k + 1) % polyline.length];
      const length = distance(point, next);
      const edge = length > 1e-9 ? times(sub(next, point), 1 / length) : { x: 0, y: 0 };
      const middle = own ? ((run + length / 2) / (perimeter || 1)) * total : -1;
      walls.push({
        foreign,
        a: point,
        b: next,
        normal: { x: -edge.y * facingInk, y: edge.x * facingInk },
        middle,
        seg: own ? segmentAt(middle) : -1,
        edge,
      });
      run += length;
    });
  });
  /*
   * Past this, a wall is too far off to hold anything back -- the allowance
   * is three times the weight or more -- so it need not be asked about. Most
   * of a letter is that far from any one point of it.
   */
  const horizon = bolder ? em * OPENING + wanted * 7 : wanted * 10 + em * HAIRLINE;
  const turnAt = (index: number): number => {
    const a = headingOn(segments[(index - 1 + count) % count], 1);
    const b = headingOn(segments[index], 0);
    return a.x * b.x + a.y * b.y;
  };
  // Smooth: one direction through the point, which the result keeps.
  const smoothJoin = nodes.map((_, index) => turnAt(index) > 0.995);
  /*
   * Flowing: a turn too slight to be a corner of the letter. Fonts converted
   * from quadratic outlines are full of these -- the leg of Lora's R is a
   * dozen pieces meeting a few degrees apart -- and treating each as a corner
   * gave every piece its own amount, which stepped the edge at every point.
   */
  const flowing = nodes.map((_, index) => turnAt(index) > 0.9);
  /*
   * The side across an inside corner is that corner closing, not a wall in
   * the way: the notch between two strokes of a W fills from its point as the
   * letter gets bolder, and the end of a stroke comes in square as it gets
   * lighter. Read as the far side of an opening, it held the whole of both
   * straight sides still -- a W, M, N or z made bolder kept the weight it was
   * drawn at while an H beside it went to Black. Only the part of the
   * neighbouring side that runs on as it leaves the corner counts as that;
   * a curve that turns right round further on is somewhere else again.
   */
  const insideAt = nodes.map((_, index) => {
    if (flowing[index]) return false;
    const previous = (index - 1 + count) % count;
    const arriving = move(headingOn(segments[previous], 1));
    const leaving = headingOn(segments[index], 0);
    return arriving.x * leaving.x + arriving.y * leaving.y > 0.05;
  });
  const ownCorner = (wall: Wall, seg: number): boolean => {
    if (wall.seg < 0) return false;
    const next = (seg + 1) % count;
    const previous = (seg - 1 + count) % count;
    let along: Vec2;
    if (wall.seg === next && insideAt[next]) along = headingOn(segments[next], 0);
    else if (wall.seg === previous && insideAt[seg]) along = headingOn(segments[previous], 1);
    else return false;
    return wall.edge.x * along.x + wall.edge.y * along.y > 0.82;
  };
  /*
   * And the same for a notch drawn with a rounded point, as a font converted
   * from quadratics draws the crotch of Lora's M: two walls joined by a run
   * of outline that only ever turns into the white between them, however
   * many pieces it is in, are the sides of one notch, which a bolder letter
   * fills from its point.
   */
  // How far the outline turns away from the white it faces at a join, and
  // along a segment: nothing where it only turns into it.
  const outAt = (a: Vec2, b: Vec2): number => {
    const pushed = move(a);
    if (pushed.x * b.x + pushed.y * b.y >= -1e-3) return 0;
    return Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)));
  };
  const nodeOut = nodes.map((_, index) =>
    outAt(headingOn(segments[(index - 1 + count) % count], 1), headingOn(segments[index], 0)),
  );
  const segmentOut = segments.map((segment) => {
    if (segment.kind === "line") return 0;
    let out = 0;
    for (let k = 0; k < 8; k++)
      out += outAt(headingOn(segment, k / 8), headingOn(segment, (k + 1) / 8));
    return out;
  });
  // A few degrees of wobble in a converted outline, and no more.
  const WOBBLE = 0.3;
  const NOTCH_PIECES = 10;
  const notch = (from: number, to: number): boolean => {
    if (from === to) return false;
    const walk = (step: 1 | -1): boolean => {
      let at = from;
      let out = 0;
      for (let pieces = 0; pieces < NOTCH_PIECES; pieces++) {
        const next = (at + step + count) % count;
        // The join crossed going from `at` to `next`.
        out += nodeOut[step > 0 ? next : at];
        if (out > WOBBLE) return false;
        if (next === to) return true;
        out += segmentOut[next];
        if (out > WOBBLE) return false;
        at = next;
      }
      return false;
    };
    return walk(1) || walk(-1);
  };
  const room = (from: Vec2, heading: Vec2, position: number, seg: number): number => {
    let nearest = Infinity;
    let nearestForeign = Infinity;
    for (const wall of walls) {
      if (ownCorner(wall, seg)) continue;
      if (bolder && wall.seg >= 0 && notch(seg, wall.seg)) {
        // Unless the two walls stand square across from each other, which
        // is a counter or a gap, however it is reached.
        const across = wall.normal.x * heading.x + wall.normal.y * heading.y;
        if (across > -0.975) continue;
      }
      if (
        Math.min(wall.a.x, wall.b.x) - from.x > horizon ||
        from.x - Math.max(wall.a.x, wall.b.x) > horizon ||
        Math.min(wall.a.y, wall.b.y) - from.y > horizon ||
        from.y - Math.max(wall.a.y, wall.b.y) > horizon
      )
        continue;
      if (bolder && wall.middle >= 0) {
        const apart = Math.abs(wall.middle - position) % total;
        if (Math.min(apart, total - apart) < window) continue;
      }
      // Only a wall that faces back can be the far side of the stroke: one
      // facing the same way is the near side, the sample's own outline.
      const facing = wall.normal.x * heading.x + wall.normal.y * heading.y;
      if (facing >= 0) continue;
      let hit = rayToEdge(from, heading, wall.a, wall.b);
      if (facing < -0.3) hit = Math.min(hit, 2 * ballTouch(from, heading, wall.a, wall.b));
      if (wall.foreign) nearestForeign = Math.min(nearestForeign, hit);
      else nearest = Math.min(nearest, hit);
    }
    /*
     * The paper between two pieces of ink keeps a share of itself, not just
     * an opening: a dot a crack above its stem reads as part of it. Put as
     * the distance to an ordinary wall that would leave the same.
     */
    if (Number.isFinite(nearestForeign))
      nearest = Math.min(
        nearest,
        nearestForeign - Math.max(0, nearestForeign * GAP_KEPT - em * OPENING),
      );
    return nearest;
  };
  const hairline = em * HAIRLINE;
  /*
   * The white to be left in front of a point: an opening, or where asked, a
   * share of what is there. On the outside of the letter only -- the gap
   * between the arms of an s, the white inside an n -- since a share taken
   * sample by sample puts a nick in a counter wherever the ruler finds a
   * slightly different wall; a counter keeps its share whole, below.
   */
  const leftOpen = (ahead: number): number =>
    Math.max(em * OPENING, isOuter && Number.isFinite(ahead) ? ahead * whiteKept : 0);
  const allowance = (ahead: number): number =>
    bolder ? (ahead - leftOpen(ahead)) / 2 : (ahead - Math.max(hairline, ahead * KEPT_SHARE)) / 2;

  /*
   * And a dot -- of an i, a j, a period, however it is drawn, round or
   * square -- is a ball whole: a small piece of ink about as wide as it is
   * tall, standing clear of the rest. Geist's square dot on the i thinned
   * with its stem to a speck.
   */
  const isDot = (() => {
    if (bolder || !isOuter) return false;
    const own = around.obstacles[self] ?? [];
    if (own.length < 3) return false;
    const xs = own.map((point) => point.x);
    const ys = own.map((point) => point.y);
    const wide = Math.max(...xs) - Math.min(...xs);
    const tall = Math.max(...ys) - Math.min(...ys);
    if (!(Math.min(wide, tall) > 0) || Math.max(wide, tall) > em * 0.2) return false;
    if (Math.max(wide, tall) > Math.min(wide, tall) * 1.6) return false;
    return around.obstacles.every(
      (other, which) => which === self || !around.roles[which] || apart(own, other) > 0,
    );
  })();

  /*
   * 1. Measure: how far each sample may move, along the way it moves.
   */
  interface Sample {
    seg: number;
    t: number;
    along: number;
    by: number;
    /** What was asked, what the room allows, and the stroke measured. */
    want: number;
    allow: number;
    across: number;
  }
  const samples: Sample[] = [];
  const lineBy: number[] = new Array(count).fill(0);
  segments.forEach((segment, index) => {
    const n = segment.kind === "line" ? LINE_MEASURE : MEASURE;
    let lowest = Infinity;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const direction = move(headingOn(segment, t));
      const size = Math.hypot(direction.x, direction.y);
      let by = wanted * size;
      let want = by;
      let allow = Infinity;
      let across = Infinity;
      // A part of the outline this shape of offset barely moves -- the top of
      // a bowl when only the sides are pushed -- has nothing worth measuring,
      // and a ray skimming along it finds walls that are not in its way.
      if (size > 0.2) {
        const ahead = room(
          pointOn(segment, t),
          times(direction, 1 / size),
          starts[index] + t * lengths[index],
          index,
        );
        want = by;
        allow = allowance(ahead);
        across = ahead;
        /*
         * Lighter, a ball -- the round ends of Lora's a, c, f, r and j, the
         * dot of an i -- gives up less than the strokes do. Taken down by
         * the same amount, the ball of Lora's a came out the weight of its
         * hairline at the lightest setting, a bump where a light cut keeps
         * a full round end. Where the chords either side of straight across
         * are those of a circle, only part of the weight comes off.
         */
        if (!bolder && segment.kind !== "line" && Number.isFinite(ahead) && ahead > hairline * 3) {
          const at = pointOn(segment, t);
          const heading = times(direction, 1 / size);
          const turned = (angle: number) => ({
            x: heading.x * Math.cos(angle) - heading.y * Math.sin(angle),
            y: heading.x * Math.sin(angle) + heading.y * Math.cos(angle),
          });
          const position = starts[index] + t * lengths[index];
          const chord = Math.max(
            room(at, turned(BALL_ANGLE), position, index),
            room(at, turned(-BALL_ANGLE), position, index),
          );
          if (chord < ahead * Math.cos(BALL_ANGLE) * 1.35) want = by * BALL_SHARE;
        }
        if (!bolder && isDot) want = by * BALL_SHARE;
        by = softMin(want, allow, bolder ? KNEE : LIGHT_KNEE);
      }
      samples.push({
        seg: index,
        t,
        along: starts[index] + t * lengths[index],
        by,
        want,
        allow,
        across,
      });
      lowest = Math.min(lowest, by);
    }
    if (segment.kind === "line") lineBy[index] = lowest;
  });

  /*
   * 2. Smooth. A straight run moves by one amount so it stays straight. Along
   * the curves the allowance is first spread (each sample takes the least of
   * those within reach) and then averaged over the same reach, which never
   * lets a sample move further than its own measurement allowed and turns a
   * sudden hold-back into an even taper.
   */
  for (const sample of samples)
    if (segments[sample.seg].kind === "line") sample.by = lineBy[sample.seg];
  /*
   * Only along a smooth run of outline, though: at a corner the two sides are
   * different strokes. Easing across it carried a serif's hairline allowance
   * up the stem it stands under, and the foot of the stem bent in.
   */
  const run = new Array<number>(count).fill(0);
  const firstCorner = flowing.indexOf(false);
  if (firstCorner >= 0) {
    let id = 0;
    for (let step = 0; step < count; step++) {
      const index = (firstCorner + step) % count;
      if (step > 0 && !flowing[index]) id++;
      run[index] = id;
    }
  }
  /*
   * A sharp corner whose sides part as they move -- the tip of a serif made
   * bolder, the crotch where an arch leaves its stem made lighter -- has its
   * point run out along the mitre, which at a narrow angle is many times the
   * weight. Held in at the point alone, the curve beside it had to swing back
   * to meet its own offset and crossed the stroke's other side. So the curves
   * at such a corner move less as they near it, just enough for the mitre to
   * stay within reach; a straight side keeps its amount.
   */
  const mitreReach = (bolder ? MITRE_LIMIT : CROTCH_LIMIT) * wanted;
  const lineCap = new Array<number>(count).fill(Infinity);
  // How far each corner was found to have room to go, where that was asked.
  const reachAt = new Array<number>(count).fill(0);
  // Where a corner between two straights is held in by itself, and how.
  const holds: Array<Hold | null> = new Array(count).fill(null);
  const caps: Array<{ node: number; seg: number; cap: number }> = [];
  const movedBy = (seg: number): number => {
    if (segments[seg].kind === "line") return lineBy[seg];
    const own = samples.filter((sample) => sample.seg === seg);
    return own.length ? own.reduce((sum, sample) => sum + sample.by, 0) / own.length : wanted;
  };
  nodes.forEach((node, index) => {
    if (flowing[index]) return;
    const previous = (index - 1 + count) % count;
    const tA = headingOn(segments[previous], 1);
    const tB = headingOn(segments[index], 0);
    const mA = move(tA);
    const mB = move(tB);
    const det = cross(tA, tB);
    if (Math.abs(det) < 1e-9) return;
    const corner = (dA: number, dB: number): Vec2 => {
      const apart = sub(times(mB, dB), times(mA, dA));
      const s = cross(apart, tB) / det;
      const u = cross(apart, tA) / det;
      if (!(s > -1e-6 && u < 1e-6)) return { x: 0, y: 0 };
      return { x: mA.x * dA + tA.x * s, y: mA.y * dA + tA.y * s };
    };
    const reachOf = (vector: Vec2) => Math.hypot(vector.x, vector.y);
    const lineA = segments[previous].kind === "line";
    const lineB = segments[index].kind === "line";
    // What each side would move by at the corner, as measured beside it.
    const endOf = (seg: number, last: boolean) => {
      const own = samples.filter((sample) => sample.seg === seg);
      return own.length ? own[last ? own.length - 1 : 0].by : wanted;
    };
    const dA = lineA ? lineBy[previous] : endOf(previous, true);
    const dB = lineB ? lineBy[index] : endOf(index, false);
    const full = corner(dA, dB);
    const out = reachOf(full);
    if (out < 1e-9) return;
    // As far as the corner may go: a few times the weight, and never through
    // the stroke or the white in front of it -- the crotch of a y thinned ran
    // out through its own foot. Measured straight ahead, and by the circle in
    // front as far as walls squarely across the way go -- not the walls of the
    // corner itself, which it is moving away from, nor ones it passes at a
    // slant.
    const heading = times(full, 1 / out);
    let ahead = Infinity;
    let farWall: Wall | null = null;
    for (const wall of walls) {
      const facing = wall.normal.x * heading.x + wall.normal.y * heading.y;
      if (facing >= 0) continue;
      if (distance(wall.a, node.point) < 1 || distance(wall.b, node.point) < 1) continue;
      let reach = rayToEdge(node.point, heading, wall.a, wall.b);
      if (facing < -0.7)
        reach = Math.min(reach, 2 * ballTouch(node.point, heading, wall.a, wall.b));
      if (reach < ahead) {
        ahead = reach;
        farWall = wall;
      }
    }
    // How far the side it runs towards comes in to meet it, as measured.
    const farBy = farWall && farWall.seg >= 0 ? movedBy(farWall.seg) : wanted;
    /*
     * Between two straights -- the notch of a W, the point of a V -- a light
     * cut's corner runs as far as the stroke ahead of it has room for, less
     * what that stroke's own far side comes in by: a W thinned has its middle
     * point rise nearly to the top, as a Thin is drawn. The crotch limit is for
     * an arch leaving its stem, which is a curve.
     */
    const straights = lineA && lineB;
    const limit =
      straights && !bolder
        ? Math.max(0, allowance(ahead), ahead - farBy - 2 * hairline)
        : Math.min(mitreReach, Math.max(0, allowance(ahead)));
    reachAt[index] = limit;
    if (out <= limit) return;
    /*
     * And rather than hold both straights back for the whole of their length
     * -- which left every diagonal of a W or M at the weight it was drawn
     * while the H beside it went to Black or Thin -- the corner alone is held
     * in, and the straights lean to meet it, where that leans them only a
     * little over their length.
     */
    if (straights) {
      const fullPoint = add(node.point, full);
      let hold: Hold = { side: 0, amount: limit };
      let held = add(node.point, times(full, limit / out));
      const side = bolder ? 0 : uprightSide(tA, tB);
      if (side !== 0) {
        /*
         * Slid along the upright side's own moved line, as far as there is
         * ink ahead of it along that line -- less what the far side comes in
         * by -- and no further than halfway to another corner running along
         * the same line towards it: the arm and the leg of a k, meeting the
         * stem a little apart, come together on it rather than cross.
         */
        const start = side > 0 ? add(node.point, times(mA, dA)) : add(node.point, times(mB, dB));
        const along = side > 0 ? tA : times(tB, -1);
        const reach = distance(start, fullPoint);
        let travel = Infinity;
        let far: Wall | null = null;
        for (const wall of walls) {
          if (wall.normal.x * along.x + wall.normal.y * along.y >= 0) continue;
          const hit = rayToEdge(start, along, wall.a, wall.b);
          if (hit < travel) {
            travel = hit;
            far = wall;
          }
        }
        travel -= (far && far.seg >= 0 ? movedBy(far.seg) : wanted) + 2 * hairline;
        const line = side > 0 ? previous : index;
        nodes.forEach((other, at) => {
          if (at === index || flowing[at] || insideAt[at]) return;
          const beside = [(at - 1 + count) % count, at].filter(
            (seg) => seg !== line && segments[seg].kind === "line",
          );
          const offset = sub(other.point, node.point);
          if (Math.abs(cross(offset, along)) > 1) return;
          const ahead = offset.x * along.x + offset.y * along.y;
          if (ahead <= 0 || beside.length === 0) return;
          travel = Math.min(travel, (ahead - 2 * hairline) / 2);
        });
        travel = Math.max(0, travel);
        if (travel >= reach) return;
        hold = { side, amount: travel };
        held = add(start, times(along, travel));
      }
      const off = sub(held, fullPoint);
      const leanA = Math.abs(cross(off, tA)) / Math.max(lengths[previous], 1e-9);
      const leanB = Math.abs(cross(off, tB)) / Math.max(lengths[index], 1e-9);
      if (leanA <= LEAN && leanB <= LEAN) {
        holds[index] = hold;
        return;
      }
    }
    // The curves give way first; straight sides only if that is not enough.
    const fits = (share: number, lines: number) =>
      reachOf(corner(dA * (lineA ? lines : share), dB * (lineB ? lines : share))) <= limit;
    const search = (ok: (value: number) => boolean) => {
      let low = 0;
      let high = 1;
      for (let step = 0; step < 12; step++) {
        const middle = (low + high) / 2;
        if (ok(middle)) low = middle;
        else high = middle;
      }
      return low;
    };
    let curveShare = lineA && lineB ? 1 : search((value) => fits(value, 1));
    let lineShare = 1;
    if (!fits(curveShare, 1)) {
      curveShare = lineA && lineB ? 1 : 0;
      lineShare = search((value) => fits(curveShare, value));
    }
    if (lineA) lineCap[previous] = Math.min(lineCap[previous], dA * lineShare);
    else caps.push({ node: index, seg: previous, cap: dA * curveShare });
    if (lineB) lineCap[index] = Math.min(lineCap[index], dB * lineShare);
    else caps.push({ node: index, seg: index, cap: dB * curveShare });
  });
  // Held in before the easing and again after it, which can carry a larger
  // amount from further along back up to the corner.
  const holdCorners = () => {
    for (const sample of samples)
      if (segments[sample.seg].kind === "line")
        sample.by = Math.min(sample.by, lineCap[sample.seg]);
    for (const { node, seg, cap } of caps) {
      const at = starts[node];
      for (const sample of samples) {
        if (sample.seg !== seg) continue;
        const apart = Math.abs(sample.along - at) % total;
        sample.by = Math.min(sample.by, cap + 0.5 * Math.min(apart, total - apart));
      }
    }
  };
  holdCorners();
  /*
   * Distance along the outline measured in how far it turns, with a little
   * for how far it runs. A straight stretch then counts as one place and takes
   * one amount, and the change from a stem's amount to a serif's happens
   * round the bracket between them, where the curve hides it, rather than as
   * a bulge on the straight.
   */
  const tau = new Array<number>(samples.length).fill(0);
  const order = samples.map((_, index) => index);
  const origin = firstCorner >= 0 ? firstCorner : 0;
  order.sort(
    (a, b) =>
      ((samples[a].seg - origin + count) % count) - ((samples[b].seg - origin + count) % count) ||
      samples[a].t - samples[b].t,
  );
  const angleOf = (sample: Sample) => {
    const heading = headingOn(segments[sample.seg], sample.t);
    return Math.atan2(heading.y, heading.x);
  };
  let turned = 0;
  order.forEach((index, k) => {
    if (k > 0) {
      const before = samples[order[k - 1]];
      let turn = Math.abs(angleOf(samples[index]) - angleOf(before));
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      const apart = Math.abs(samples[index].along - before.along);
      turned += turn + Math.min(apart, total - apart) / (em * 0.5);
    }
    tau[index] = turned;
  });
  const lap = firstCorner >= 0 ? Infinity : turned;
  const within = (a: number, b: number) => {
    if (run[samples[a].seg] !== run[samples[b].seg]) return Infinity;
    const apart = Math.abs(tau[a] - tau[b]);
    return Number.isFinite(lap) ? Math.min(apart, lap - apart) : apart;
  };
  const erode = 0.3;
  const blur = 0.8;
  const spread = samples.map((sample, index) => {
    let least = sample.by;
    samples.forEach((other, k) => {
      if (within(k, index) <= erode) least = Math.min(least, other.by);
    });
    return least;
  });
  const average = (values: number[], radius: number) =>
    samples.map((_, index) => {
      let sum = 0;
      let weight = 0;
      samples.forEach((_, k) => {
        const tent = 1 - within(k, index) / radius;
        if (tent > 0) {
          sum += values[k] * tent;
          weight += tent;
        }
      });
      return weight ? sum / weight : values[index];
    });
  const smooth = average(spread, blur);
  samples.forEach((sample, index) => {
    sample.by = smooth[index];
  });
  // A straight segment moves by the mean of its eased samples, all of it, so
  // it stays straight and meets the curves either side of it at their amount.
  segments.forEach((segment, index) => {
    if (segment.kind !== "line") return;
    const own = samples.filter((sample) => sample.seg === index);
    lineBy[index] = own.reduce((sum, sample) => sum + sample.by, 0) / own.length;
    for (const sample of own) sample.by = lineBy[index];
  });
  holdCorners();
  segments.forEach((segment, index) => {
    if (segment.kind === "line") lineBy[index] = Math.min(lineBy[index], lineCap[index]);
  });

  // Each segment's allowance as a function of t, pinned at smooth joins so the
  // two curves meeting there move together.
  const bySegment: Array<Array<[number, number]>> = segments.map(() => []);
  for (const sample of samples) bySegment[sample.seg].push([sample.t, sample.by]);
  const pins: Array<number | null> = nodes.map((_, index) => {
    if (!flowing[index]) return null;
    const previous = (index - 1 + count) % count;
    const lineA = segments[previous].kind === "line";
    const lineB = segments[index].kind === "line";
    if (lineA && lineB) return Math.min(lineBy[previous], lineBy[index]);
    if (lineA) return lineBy[previous];
    if (lineB) return lineBy[index];
    const a = bySegment[previous][bySegment[previous].length - 1];
    const b = bySegment[index][0];
    const da = (1 - a[0]) * lengths[previous];
    const db = b[0] * lengths[index];
    return da + db > 0 ? (a[1] * db + b[1] * da) / (da + db) : (a[1] + b[1]) / 2;
  });
  const byAt = (index: number, t: number): number => {
    if (segments[index].kind === "line") return lineBy[index];
    const table = bySegment[index];
    const startPin = pins[index];
    const endPin = pins[(index + 1) % count];
    const first: [number, number] = [0, startPin ?? table[0][1]];
    const last: [number, number] = [1, endPin ?? table[table.length - 1][1]];
    const points = [first, ...table, last];
    for (let k = 1; k < points.length; k++) {
      if (t <= points[k][0]) {
        const [t0, v0] = points[k - 1];
        const [t1, v1] = points[k];
        return t1 - t0 < 1e-9 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
      }
    }
    return last[1];
  };

  /*
   * A straight leaned to meet a held corner makes its stroke a wedge unless
   * the other side of that stroke leans with it. The arm and the leg of a
   * DejaVu k thinned hard no longer reach the stem where they did -- moved
   * square, they come apart from it -- so their inner ends are brought
   * together on the stem, which leans both edges they start from; turning
   * the far edges of the arm and the leg the same way keeps each an even
   * stroke, now meeting the stem at one point, which is how a Thin k is
   * drawn. Likewise the diagonal of a thin M, turned to meet its stem at
   * the top rather than thickening into it.
   */
  const leaned: Array<{ seg: number; held: number }> = [];
  holds.forEach((hold, index) => {
    if (!hold) return;
    const previous = (index - 1 + count) % count;
    if (hold.side >= 0) leaned.push({ seg: index, held: index });
    if (hold.side <= 0) leaned.push({ seg: previous, held: index });
  });
  const lineDirection = (seg: number) => headingOn(segments[seg], 0);
  const partners = leaned.map(({ seg, held }) => {
    const t = lineDirection(seg);
    const from = segments[seg].from;
    const reach = lengths[seg];
    let best = -1;
    let bestGap = Infinity;
    segments.forEach((other, index) => {
      if (index === seg || other.kind !== "line") return;
      const u = lineDirection(index);
      if (t.x * u.x + t.y * u.y > -0.97) return;
      const gap = Math.abs(cross(sub(other.from, from), t));
      if (gap > em * 0.3 || gap < 1) return;
      // Beside it for at least half of the shorter of the two.
      const a = (other.from.x - from.x) * t.x + (other.from.y - from.y) * t.y;
      const b = (other.to.x - from.x) * t.x + (other.to.y - from.y) * t.y;
      const overlap = Math.min(reach, Math.max(a, b)) - Math.max(0, Math.min(a, b));
      if (overlap < 0.5 * Math.min(reach, lengths[index])) return;
      if (gap < bestGap) {
        bestGap = gap;
        best = index;
      }
    });
    if (best < 0) return null;
    const heldPoint = nodes[held].point;
    const start = best;
    const end = (best + 1) % count;
    const near =
      distance(nodes[start].point, heldPoint) < distance(nodes[end].point, heldPoint) ? start : end;
    // A partner held in at the end beside this one leans already.
    if (leaned.some((one) => one.seg === best && one.held === near)) return null;
    return { seg, partner: best, near, far: near === start ? end : start };
  });
  const restoreStrokes = (out: GlyphNode[], share: number) => {
    const wantedLines = new Map<number, Array<{ through: Vec2; direction: Vec2 }>>();
    partners.forEach((pair) => {
      if (!pair) return;
      const a = out[pair.seg].point;
      const b = out[(pair.seg + 1) % count].point;
      let direction = normalize(sub(b, a));
      /*
       * Both sides of the stroke held in, at opposite ends -- the diagonal of
       * an M, held at the stem at the top and at the point at the bottom.
       * Then neither side's lean is the one to follow: the two turn together,
       * each about its held end, to the one direction that leaves the stroke
       * between them as thick as the rest of the letter's strokes became.
       */
      const mutual = partners.find((other) => other && other.seg === pair.partner);
      if (mutual && mutual.partner === pair.seg) {
        const t = lineDirection(pair.seg);
        const segment = segments[pair.seg];
        const across = cross(sub(segments[pair.partner].from, segment.from), t);
        const thick = Math.max(
          hairline,
          Math.abs(across) - (lineBy[pair.seg] + lineBy[pair.partner]) * share,
        );
        const heldHere = leaned.find((one) => one.seg === pair.seg)?.held ?? pair.seg;
        const v = sub(out[pair.far].point, out[heldHere].point);
        const span = Math.hypot(v.x, v.y);
        if (span > thick) {
          const alpha = Math.atan2(v.y, v.x);
          const turn = Math.asin((Math.sign(across) * thick) / span);
          const options = [alpha + turn, alpha + Math.PI - turn].map((phi) => ({
            x: Math.cos(phi),
            y: Math.sin(phi),
          }));
          const best = options.reduce((one, other) =>
            one.x * t.x + one.y * t.y >= other.x * t.x + other.y * t.y ? one : other,
          );
          if (best.x * t.x + best.y * t.y > 0.9) direction = best;
        }
      }
      const list = wantedLines.get(pair.near) ?? [];
      list.push({ through: { ...out[pair.far].point }, direction });
      wantedLines.set(pair.near, list);
    });
    const meet = (p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null => {
      const det = cross(d, e);
      if (Math.abs(det) < 1e-6) return null;
      const s = cross(sub(q, p), e) / det;
      return add(p, times(d, s));
    };
    const moves = new Map<number, Vec2>();
    wantedLines.forEach((lines, index) => {
      const previous = (index - 1 + count) % count;
      if (segments[previous].kind !== "line" || segments[index].kind !== "line") return;
      let point: Vec2 | null = null;
      if (lines.length >= 2) {
        point = meet(lines[0].through, lines[0].direction, lines[1].through, lines[1].direction);
      } else {
        // Slid along its other side, which keeps its direction.
        const partnerSeg = partners.find((pair) => pair && pair.near === index)?.partner;
        const otherSeg = partnerSeg === previous ? index : previous;
        const otherEnd = otherSeg === index ? (index + 1) % count : otherSeg;
        const along = normalize(sub(out[otherEnd].point, out[index].point));
        point = meet(lines[0].through, lines[0].direction, out[index].point, along);
      }
      if (!point || distance(point, out[index].point) > 3 * wanted) return;
      moves.set(index, point);
    });
    moves.forEach((point, index) => {
      out[index].point = point;
    });
  };

  const build = (share: number): Contour => {
    const offsetAt = (index: number, t: number): Vec2 => {
      const segment = segments[index];
      const direction = move(headingOn(segment, t));
      return add(pointOn(segment, t), times(direction, byAt(index, t) * share));
    };
    /*
     * 3. Trace. Each segment's offset as samples; at each node the two moved
     * sides are joined -- an outside corner at the point where they meet, an
     * inside corner left for the loop cutting to find where they cross.
     */
    const pieces: Vertex[][] = segments.map((segment, index) => {
      const steps = segment.kind === "line" ? 1 : TRACE;
      const piece: Vertex[] = [];
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        piece.push({
          point: offsetAt(index, t),
          nodes: [],
          seg: index,
          t,
          along: starts[index] + t * lengths[index],
        });
      }
      return piece;
    });
    const trace: Vertex[] = [];
    let pendingFirst = -1;
    for (let index = 0; index < count; index++) {
      const previous = (index - 1 + count) % count;
      const arriving = pieces[previous][pieces[previous].length - 1];
      const leaving = pieces[index][0];
      const gap = distance(arriving.point, leaving.point);
      const piece = pieces[index];
      if (gap < 1e-6) {
        piece[0].nodes.push(index);
        trace.push(...piece);
        continue;
      }
      const tA = headingOn(segments[previous], 1);
      const tB = headingOn(segments[index], 0);
      const det = cross(tA, tB);
      const apart = sub(leaving.point, arriving.point);
      const s = Math.abs(det) > 1e-9 ? cross(apart, tB) / det : Number.NaN;
      const u = Math.abs(det) > 1e-9 ? cross(apart, tA) / det : Number.NaN;
      if (s > -1e-6 && u < 1e-6) {
        // The two sides part: the corner goes where they meet, held in to a
        // few times the weight so a hairline tip does not become a spike.
        const node = nodes[index].point;
        let corner = add(arriving.point, times(tA, s));
        const out = distance(node, corner);
        const hold = holds[index];
        if (hold) {
          if (hold.side === 0) {
            if (out > hold.amount * share)
              corner = add(node, times(sub(corner, node), (hold.amount * share) / out));
          } else {
            const start = hold.side > 0 ? arriving.point : leaving.point;
            const reach = distance(start, corner);
            const travel = hold.amount * share;
            if (reach > travel)
              corner = add(start, times(sub(corner, start), travel / Math.max(reach, 1e-9)));
          }
          trace.push({ point: corner, nodes: [index], seg: index, t: 0, along: starts[index] });
          trace.push(...piece);
          continue;
        }
        // Or as far as it was found to have room for, which the amounts
        // either side were already held to: a narrow crotch whose corner was
        // clamped here, short of where its sides meet, leaned the stem.
        const limit =
          Math.max(MITRE_LIMIT * Math.max(byAt(previous, 1), byAt(index, 0)), reachAt[index]) *
          share;
        if (out > limit && out > 1e-9) corner = add(node, times(sub(corner, node), limit / out));
        trace.push({ point: corner, nodes: [index], seg: index, t: 0, along: starts[index] });
        trace.push(...piece);
      } else if (Math.abs(u) < 1e-6) {
        // The side leaving starts exactly where the one arriving, run on,
        // would meet it: that is the corner.
        piece[0].nodes.push(index);
        trace.push(...piece);
      } else if (
        Number.isFinite(s) &&
        s < 0 === u < 0 &&
        !piecesCross(pieces[previous], piece) &&
        distance(nodes[index].point, add(arriving.point, times(tA, s))) <=
          MITRE_LIMIT * Math.max(byAt(previous, 1), byAt(index, 0), 1e-9) * share
      ) {
        /*
         * The sides overlap but their traces stop short of each other -- a
         * sharp foot thinned, where one side's offset ends before reaching
         * the other's. The corner is still where the two, run on, meet; the
         * overshoot either side of it folds back and is cut off below.
         */
        trace.push({
          point: add(arriving.point, times(tA, s)),
          nodes: [index],
          seg: index,
          t: 0,
          along: starts[index],
        });
        trace.push(...piece);
      } else if (trace.length > 0) {
        // The two sides run into each other: the end of the one arriving
        // stands for the node until the cut moves it to the crossing.
        trace[trace.length - 1].nodes.push(index);
        trace.push(...piece);
      } else {
        pendingFirst = index;
        trace.push(...piece);
      }
    }
    if (pendingFirst >= 0) trace[trace.length - 1].nodes.push(pendingFirst);

    const moved = Math.max(...samples.map((sample) => sample.by)) * share;
    const kept = cutLoops(trace, total, Math.min(total / 2, moved * 6 + 100), (moved * 4) ** 2);

    /*
     * 4. Refit.
     */
    const where = new Array<number>(count).fill(-1);
    kept.forEach((vertex, index) => {
      for (const node of vertex.nodes) where[node] = index;
    });
    /*
     * A loop cut out of the middle of a curve leaves a corner there -- the
     * offset of a bracket tighter than the weight comes to a point -- and one
     * cubic cannot turn a corner in its middle: it drew a hook. So the nearer
     * of the curve's two points moves to the corner, and the corner is drawn
     * as one.
     */
    kept.forEach((vertex, at) => {
      if (!vertex.before || vertex.nodes.length > 0) return;
      const size = kept.length;
      const a = sub(vertex.point, kept[(at - 1 + size) % size].point);
      const b = sub(kept[(at + 1) % size].point, vertex.point);
      const lengths = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
      if (lengths < 1e-12 || (a.x * b.x + a.y * b.y) / lengths > 0.85) return;
      // The points either side of it round the trace.
      let before = -1;
      let after = -1;
      for (let step = 1; step < size && before < 0; step++)
        if (kept[(at - step + size) % size].nodes.length) before = (at - step + size) % size;
      for (let step = 1; step < size && after < 0; step++)
        if (kept[(at + step) % size].nodes.length) after = (at + step) % size;
      if (before < 0 || after < 0) return;
      const nearer =
        distance(kept[before].point, vertex.point) <= distance(kept[after].point, vertex.point)
          ? before
          : after;
      if (distance(kept[nearer].point, vertex.point) > MITRE_LIMIT * wanted * share) return;
      // Only a point that stands alone, so a corner of the drawing stays put.
      if (kept[nearer].nodes.length !== 1 || !smoothJoin[kept[nearer].nodes[0]]) return;
      const node = kept[nearer].nodes.pop() as number;
      vertex.nodes.push(node);
      where[node] = at;
    });
    const out: GlyphNode[] = nodes.map((node, index) => ({
      ...node,
      point: where[index] >= 0 ? { ...kept[where[index]].point } : offsetAt(index, 0),
      handleIn: node.handleIn ? { ...node.handleIn } : null,
      handleOut: node.handleOut ? { ...node.handleOut } : null,
    }));
    for (let index = 0; index < count; index++) {
      const segment = segments[index];
      if (segment.kind !== "cubic") continue;
      const next = (index + 1) % count;
      const from = out[index].point;
      const to = out[next].point;
      const start = where[index];
      const end = where[next];
      const points: Vec2[] = [];
      const params: number[] = [];
      if (start >= 0 && end >= 0) {
        for (
          let at = start, guard = 0;
          guard <= kept.length;
          at = (at + 1) % kept.length, guard++
        ) {
          const vertex = kept[at];
          let t: number | null;
          if (at === start)
            t =
              vertex.after?.seg === index
                ? vertex.after.t
                : vertex.seg === index && !vertex.after
                  ? vertex.t
                  : 0;
          else if (at === end)
            t =
              vertex.before?.seg === index
                ? vertex.before.t
                : vertex.seg === index && !vertex.before
                  ? vertex.t
                  : 1;
          else if (vertex.before && vertex.after) {
            const ts = [vertex.before, vertex.after]
              .filter((side) => side.seg === index)
              .map((side) => side.t);
            t = ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : null;
          } else t = vertex.seg === index ? vertex.t : null;
          if (at === start && t === 1) t = 0;
          if (at === end && t === 0 && at !== start) t = 1;
          if (t !== null) {
            points.push(vertex.point);
            params.push(t);
          }
          if (at === end) break;
        }
      }
      const t0 = params.length ? params[0] : 0;
      const t1 = params.length ? params[params.length - 1] : 1;
      /*
       * The directions the handles leave in: the offset outline's own, which
       * is not the drawing's where the amount changes along the stroke -- kept
       * to the drawing's, a stroke that thins towards its end bulged between
       * every pair of points. A smooth join takes one direction for both of
       * its sides, measured across it, so it stays smooth.
       */
      const drawnOut =
        t0 <= 1e-9 && distance(segment.c1, segment.from) > 1e-9
          ? normalize(sub(segment.c1, segment.from))
          : headingOn(segment, t0);
      const drawnIn =
        t1 >= 1 - 1e-9 && distance(segment.c2, segment.to) > 1e-9
          ? normalize(sub(segment.c2, segment.to))
          : times(headingOn(segment, t1), -1);
      const previous = (index - 1 + count) % count;
      // Beside a straight, the straight's own direction: its offset is
      // parallel to it, and a curve leaving it any other way kinks.
      const movedOut =
        t0 <= 1e-9 && smoothJoin[index]
          ? segments[previous].kind === "line"
            ? headingOn(segments[previous], 1)
            : normalize(sub(offsetAt(index, STEP), offsetAt(previous, 1 - STEP)))
          : normalize(sub(offsetAt(index, Math.min(1, t0 + STEP)), offsetAt(index, t0)));
      const movedIn =
        t1 >= 1 - 1e-9 && smoothJoin[next]
          ? segments[next].kind === "line"
            ? times(headingOn(segments[next], 0), -1)
            : normalize(sub(offsetAt(index, 1 - STEP), offsetAt(next, STEP)))
          : normalize(sub(offsetAt(index, Math.max(0, t1 - STEP)), offsetAt(index, t1)));
      const agrees = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y > 0.5;
      let tangentOut = agrees(movedOut, drawnOut) ? movedOut : drawnOut;
      let tangentIn = agrees(movedIn, drawnIn) ? movedIn : drawnIn;
      /*
       * An outside corner's point is off the end of the curve beside it, the
       * two sharing a parameter but not a place. The curve then runs on in a
       * straight line to its corner, and is fitted as the shape it is, by
       * distance along it, rather than by where on the drawing each sample
       * came from, which would have it be in two places at once.
       */
      const last = points.length - 1;
      const mitred =
        points.length > 2 &&
        ((params[1] <= t0 + 1e-9 && distance(points[0], points[1]) > 0.5) ||
          (params[last - 1] >= t1 - 1e-9 && distance(points[last], points[last - 1]) > 0.5));
      /*
       * Where a cut took off the start or the end, what is left leaves the
       * way the trace does, which is not the way the drawing did: past a
       * bracket smaller than the weight the offset has turned right round.
       */
      const span = distance(from, to);
      if (t0 > 1e-9 && points.length >= 3) {
        const onward = points.find((point, k) => k > 0 && distance(point, from) > span * 0.15);
        if (onward) tangentOut = normalize(sub(onward, from));
      }
      if (t1 < 1 - 1e-9 && points.length >= 3) {
        const back = [...points]
          .reverse()
          .find((point, k) => k > 0 && distance(point, to) > span * 0.15);
        if (back) tangentIn = normalize(sub(back, to));
      }
      let us: number[] | null = null;
      if (points.length >= 3 && t1 - t0 > 1e-4) {
        us = params.map((t) => (t - t0) / (t1 - t0));
        if (us.some((value, k) => k > 0 && value < us![k - 1] - 1e-9)) us = null;
      }
      if (mitred) us = null;
      points[0] = from;
      if (points.length > 1) points[points.length - 1] = to;
      let [c1, c2] = fitHandles(
        points.length >= 3 ? points : [from, to],
        tangentOut,
        tangentIn,
        us,
        !nodes[index].handleOut,
        !nodes[next].handleIn,
      );
      // A curve cut down to a sliver can be left with handles that point back
      // past each other, and a cubic like that loops; and a few units left of
      // a bracket smaller than the weight, bent to any directions at all, is a
      // hook. Straight is the honest shape for either.
      const swallowed = (t0 > 1e-9 || t1 < 1 - 1e-9) && distance(from, to) < wanted * share * 0.5;
      if (swallowed || loops(from, c1, c2, to)) [c1, c2] = [{ ...from }, { ...to }];
      if (nodes[index].handleOut) out[index].handleOut = c1;
      if (nodes[next].handleIn) out[next].handleIn = c2;
    }
    restoreStrokes(out, share);
    const plain: Contour = { closed: true, nodes: out };
    const rounded = roundSwallowed(out, wanted * share);
    if (!rounded) return plain;
    const filleted: Contour = { closed: true, nodes: rounded };
    return crossesItself(filleted, FINE_STEPS) && !crossesItself(plain, FINE_STEPS)
      ? plain
      : filleted;
  };

  const facingBefore = Math.sign(contourArea(contour));
  /*
   * And a counter made smaller is never closed up. The rulers above ask a few
   * places along each side how far it is to the wall across; a small counter
   * -- the eye of an e condensed and made bolder -- can be narrower than the
   * weight everywhere and still have no wall squarely across from any one
   * sample, and it came out a crumpled speck. So a counter keeps at least an
   * opening's worth of mean width (twice its area over its length round, which
   * is the width of a slot and the radius of a circle), or most of what it had
   * where it had less -- and most of it whatever it had, where white is to be
   * kept -- and the whole contour backs off evenly to keep it, so the counter
   * stays the shape it was.
   */
  const meanWidth = (trial: Contour): number => {
    const round = contourSegments(trial).reduce((sum, segment) => sum + segmentLength(segment), 0);
    return round > 1e-9 ? (2 * Math.abs(contourArea(trial))) / round : 0;
  };
  const leastWidth =
    bolder && !isOuter
      ? Math.max(
          Math.min(meanWidth(contour) * KEPT_OPEN, (em * OPENING) / 2),
          whiteKept > 0 ? meanWidth(contour) * COUNTER_KEPT : 0,
        )
      : 0;
  /*
   * Crossed asked finely: the quick check stops past six hundred segments and
   * reads a curve in six chords, and the fold at the thin join of the arch of
   * Geist's r to its stem, a light letter widened, slipped past it.
   */
  /*
   * Measured against how many times the drawn letter crossed itself, asked
   * only when it matters: some fonts ship outlines crossing themselves, and
   * those are kept from crossing any more than they did, not let off.
   */
  let drawnCrossings: number | undefined;
  const crossedMore = (trial: Contour): boolean => {
    if (!crossesItself(trial, FINE_STEPS)) return false;
    drawnCrossings ??= crossingsOf(contour, FINE_STEPS);
    return drawnCrossings === 0 || crossingsOf(trial, FINE_STEPS) > drawnCrossings;
  };
  // The cheap tests first; the crossing is asked of what passes them.
  const intact = (trial: Contour): boolean =>
    // Turned inside out is as broken as crossed: ink become a hole.
    Math.sign(contourArea(trial)) === facingBefore &&
    (leastWidth === 0 || meanWidth(trial) >= leastWidth) &&
    !crossedMore(trial);
  const built = (by: number): Contour => repair(build(by));
  const full = built(1);
  if (intact(full)) return full;
  // Otherwise back the whole contour off evenly until it is sound; an even
  // retreat keeps the stroke even.
  let low = 0;
  let high = 1;
  for (let step = 0; step < BACK_OFF_STEPS; step++) {
    const middle = (low + high) / 2;
    if (intact(built(middle))) low = middle;
    else high = middle;
  }
  return low === 0 ? contour : built(low);
}

/**
 * Points the offset swallowed, spread round the corner they left.
 *
 * Where a stretch of outline is shorter than the weight -- the inner end of
 * the aperture of Lora's a, s and 2 made bolder -- the loop cutting leaves
 * several points on one spot, or a few units apart, and the outline turns a
 * sharp corner there and runs a short straight stub into the next curve: a
 * step where the aperture closes. Those points are spare, and a bold is
 * drawn with the end of the white rounded. So each such run is taken as one
 * corner: the stretch of outline before it is cut back and the stretch after
 * it cut forward by a little, and the points of the run are laid along the
 * circular arc between the two cuts, leaving and arriving the way the
 * outline does. The same points come out as went in, and a straight piece
 * stays straight, so a variable font keeps its structure. Null where there
 * is nothing to round.
 */
function roundSwallowed(nodes: GlyphNode[], weight: number): GlyphNode[] | null {
  const count = nodes.length;
  if (count < 4 || !(weight > 0)) return null;
  const out = nodes.map((node) => ({
    ...node,
    point: { ...node.point },
    handleIn: node.handleIn ? { ...node.handleIn } : null,
    handleOut: node.handleOut ? { ...node.handleOut } : null,
  }));
  const at = (index: number) => out[((index % count) + count) % count];
  const curve = (index: number): [Vec2, Vec2, Vec2, Vec2] => {
    const a = at(index);
    const b = at(index + 1);
    return [a.point, a.handleOut ?? a.point, b.handleIn ?? b.point, b.point];
  };
  const length = (index: number): number => {
    const [p0, p1, p2, p3] = curve(index);
    let total = 0;
    let last = p0;
    for (let i = 1; i <= 12; i++) {
      const point = cubicAt(p0, p1, p2, p3, i / 12);
      total += distance(last, point);
      last = point;
    }
    return total;
  };
  const lengths = out.map((_, index) => length(index));
  const tiny = Math.max(1, weight * 0.5);
  const small = lengths.map((value) => value < tiny);
  if (small.every(Boolean) || !small.some(Boolean)) return null;
  // Runs of short pieces, each from the first piece to the last.
  const runs: Array<{ first: number; last: number }> = [];
  const start = small.indexOf(false);
  for (let step = 1; step <= count; step++) {
    const index = (start + step) % count;
    if (!small[index]) continue;
    const previous = runs[runs.length - 1];
    if (previous && (previous.last + 1) % count === index) previous.last = index;
    else runs.push({ first: index, last: index });
  }
  const used = new Set<number>();
  let changed = false;
  for (const { first, last } of runs) {
    const pieces = ((last - first + count) % count) + 1;
    // Only a run of curves: a straight piece of the drawing, however short
    // the weight left it -- the foot of a stem -- stays the straight it was.
    let straight = false;
    for (let k = 0; k < pieces; k++)
      if (!at(first + k).handleOut && !at(first + k + 1).handleIn) straight = true;
    if (straight) continue;
    const before = (first - 1 + count) % count;
    const after = (last + 1) % count;
    if (used.has(before) || used.has(after)) continue;
    const [b0, b1, b2, b3] = curve(before);
    const [a0, a1, a2, a3] = curve(after);
    const arriving = normalize(sub(b3, distance(b2, b3) > 1e-6 ? b2 : b1));
    const leaving = normalize(sub(distance(a1, a0) > 1e-6 ? a1 : a2, a0));
    const turn = Math.acos(
      Math.max(-1, Math.min(1, arriving.x * leaving.x + arriving.y * leaving.y)),
    );
    // Turning less than this is a curve passing through, not a corner.
    if (!(turn > (20 * Math.PI) / 180) || turn > (170 * Math.PI) / 180) continue;
    const reach = Math.min(lengths[before] * 0.4, lengths[after] * 0.4, weight * 1.5);
    if (reach < 1) continue;
    // Cut the piece before back by the reach, and the piece after forward.
    const cutAt = (p: [Vec2, Vec2, Vec2, Vec2], total: number, fromEnd: boolean): number => {
      const goal = fromEnd ? total - reach : reach;
      let run = 0;
      let last = p[0];
      for (let i = 1; i <= 48; i++) {
        const point = cubicAt(p[0], p[1], p[2], p[3], i / 48);
        const step = distance(last, point);
        if (run + step >= goal) return (i - 1 + (step > 0 ? (goal - run) / step : 0)) / 48;
        run += step;
        last = point;
      }
      return 1;
    };
    const tb = cutAt([b0, b1, b2, b3], lengths[before], true);
    const ta = cutAt([a0, a1, a2, a3], lengths[after], false);
    const [keepBefore] = splitCubic(b0, b1, b2, b3, tb);
    const [, keepAfter] = splitCubic(a0, a1, a2, a3, ta);
    const from = keepBefore[3];
    const to = keepAfter[0];
    const chord = distance(from, to);
    if (chord < 1e-6) continue;
    // Leaving and arriving the way the outline does where it was cut.
    const tangent = (a: Vec2, b: Vec2, fallback: Vec2) =>
      distance(a, b) > 1e-6 ? normalize(sub(b, a)) : fallback;
    const inward = tangent(
      distance(keepBefore[2], from) > 1e-6 ? keepBefore[2] : keepBefore[1],
      from,
      arriving,
    );
    const outward = tangent(
      to,
      distance(keepAfter[1], to) > 1e-6 ? keepAfter[1] : keepAfter[2],
      leaving,
    );
    const bend = Math.acos(Math.max(-1, Math.min(1, inward.x * outward.x + inward.y * outward.y)));
    if (!(bend > 1e-3)) continue;
    // A circle's arc through the turn: handles four thirds of the tangent of
    // a quarter of the turn, of its radius.
    const radius = chord / (2 * Math.sin(bend / 2));
    const handle = (4 / 3) * Math.tan(bend / 4) * radius;
    const arc: [Vec2, Vec2, Vec2, Vec2] = [
      from,
      { x: from.x + inward.x * handle, y: from.y + inward.y * handle },
      { x: to.x - outward.x * handle, y: to.y - outward.y * handle },
      to,
    ];
    // Laid out: the node before keeps its place, its handle shortened; the
    // run's first point at the cut, its last at the other cut, and any
    // between along the arc.
    const lineBefore = !at(before).handleOut && !at(before + 1).handleIn;
    const lineAfter = !at(after).handleOut && !at(after + 1).handleIn;
    if (!lineBefore) {
      if (at(before).handleOut) at(before).handleOut = keepBefore[1];
    }
    const pieceCurves: Array<[Vec2, Vec2, Vec2, Vec2]> = [];
    let rest = arc;
    for (let k = 0; k < pieces; k++) {
      if (k === pieces - 1) {
        pieceCurves.push(rest);
        break;
      }
      const [head, tail] = splitCubic(rest[0], rest[1], rest[2], rest[3], 1 / (pieces - k));
      pieceCurves.push(head);
      rest = tail;
    }
    for (let k = 0; k <= pieces; k++) {
      const node = at(first + k);
      node.point = { ...(k < pieces ? pieceCurves[k][0] : to) };
      if (k === 0) {
        if (node.handleIn) node.handleIn = lineBefore ? { ...node.point } : { ...keepBefore[2] };
      } else if (node.handleIn) node.handleIn = { ...pieceCurves[k - 1][2] };
      if (k < pieces) {
        if (node.handleOut) node.handleOut = { ...pieceCurves[k][1] };
      } else if (node.handleOut)
        node.handleOut = lineAfter ? { ...node.point } : { ...keepAfter[1] };
    }
    if (!lineAfter && at(after + 1).handleIn) at(after + 1).handleIn = { ...keepAfter[2] };
    used.add(before);
    used.add(after);
    changed = true;
  }
  return changed ? out : null;
}

/**
 * A closed polyline with the loops it makes nearby cut out of it.
 *
 * Two edges no more than `window` apart round the original outline that cross
 * enclose a loop -- a corner or a short curve the offset ran over -- and
 * everything between them goes, replaced by the point where they cross. Edges
 * further apart than that are two different parts of the letter meeting, such
 * as the walls of an aperture, and are left alone.
 */
function cutLoops(trace: Vertex[], total: number, window: number, limit: number): Vertex[] {
  let vertices = trace.map((vertex) => ({ ...vertex, nodes: [...vertex.nodes] }));
  const ahead = (a: number, b: number) => (((b - a) % total) + total) % total;
  // Where a crossing on the edge from a to b sits, as a segment and parameter.
  const sideOf = (a: Vertex, b: Vertex, s: number) => {
    const first = a.after ?? { seg: a.seg, t: a.t };
    const second = b.before ?? { seg: b.seg, t: b.t };
    if (first.seg === second.seg) return { seg: first.seg, t: first.t + (second.t - first.t) * s };
    return s < 0.5 ? first : second;
  };
  type Cut = { i: number; j: number; point: Vec2; span: number; s: number; u: number };
  for (let round = 0; round < 64; round++) {
    const size = vertices.length;
    /*
     * Every loop there is, each found from the edge that starts it, and then
     * cut smallest first -- not the first found from wherever the search
     * happened to start: a loop that straddles the start of the list looked,
     * from the other side, like a crossing that took most of the outline with
     * it, and on a thin serif bar thinned hard that is what got cut. Loops
     * that share no part of the outline are cut in the same round.
     */
    const found: Cut[] = [];
    for (let i = 0; i < size; i++) {
      const a = vertices[i].point;
      const a2 = vertices[(i + 1) % size].point;
      const left = Math.min(a.x, a2.x);
      const right = Math.max(a.x, a2.x);
      const low = Math.min(a.y, a2.y);
      const high = Math.max(a.y, a2.y);
      for (let span = 2; span <= size - 2; span++) {
        const j = (i + span) % size;
        if (ahead(vertices[(i + 1) % size].along, vertices[j].along) > window) break;
        const b = vertices[j].point;
        const b2 = vertices[(j + 1) % size].point;
        if (
          Math.max(b.x, b2.x) < left ||
          Math.min(b.x, b2.x) > right ||
          Math.max(b.y, b2.y) < low ||
          Math.min(b.y, b2.y) > high
        )
          continue;
        const hit = segmentsCross(a, a2, b, b2);
        if (!hit) continue;
        // A loop the offset made is small, of the order of the weight squared;
        // anything bigger is two parts of the letter that have met.
        let area = 0;
        let previous = hit.point;
        for (let k = (i + 1) % size; ; k = (k + 1) % size) {
          const point = vertices[k].point;
          area += previous.x * point.y - point.x * previous.y;
          previous = point;
          if (k === j) break;
        }
        area += previous.x * hit.point.y - hit.point.x * previous.y;
        if (Math.abs(area) / 2 > limit) continue;
        found.push({ i, j, point: hit.point, span, s: hit.s, u: hit.u });
        break;
      }
    }
    if (found.length === 0) break;
    found.sort((one, other) => one.span - other.span);
    const taken = new Array<boolean>(size).fill(false);
    const cuts = new Map<number, Cut>();
    const gone = new Array<boolean>(size).fill(false);
    for (const cut of found) {
      let free = true;
      for (let step = 0; step <= cut.span + 1 && free; step++)
        if (taken[(cut.i + step) % size]) free = false;
      if (!free) continue;
      for (let step = 0; step <= cut.span + 1; step++) taken[(cut.i + step) % size] = true;
      for (let step = 1; step <= cut.span; step++) gone[(cut.i + step) % size] = true;
      cuts.set(cut.i, cut);
    }
    const survivors: Vertex[] = [];
    for (let index = 0; index < size; index++) {
      if (!gone[index]) survivors.push(vertices[index]);
      const cut = cuts.get(index);
      if (!cut) continue;
      const moved: number[] = [];
      for (let step = 1; step <= cut.span; step++)
        moved.push(...vertices[(cut.i + step) % size].nodes);
      const before = sideOf(vertices[cut.i], vertices[(cut.i + 1) % size], cut.s);
      const after = sideOf(vertices[cut.j], vertices[(cut.j + 1) % size], cut.u);
      survivors.push({
        point: cut.point,
        nodes: moved,
        seg: before.seg,
        t: before.t,
        along: vertices[(cut.i + 1) % size].along,
        before,
        after,
      });
    }
    vertices = survivors;
  }
  /*
   * And the folds. Where a short serif is swallowed by the stem beside it, the
   * trace runs out along the serif's edge and straight back: a loop with no
   * area, which crosses nothing and so is never cut. Its tip is taken off
   * until the outline no longer doubles back on itself.
   */
  for (let guard = 0; guard < trace.length && vertices.length > 3; guard++) {
    const size = vertices.length;
    let removed = false;
    for (let k = 0; k < size; k++) {
      const a = vertices[(k - 1 + size) % size].point;
      const b = vertices[k].point;
      const c = vertices[(k + 1) % size].point;
      const one = sub(b, a);
      const two = sub(c, b);
      const lengths = Math.hypot(one.x, one.y) * Math.hypot(two.x, two.y);
      if (lengths < 1e-12) continue;
      if ((one.x * two.x + one.y * two.y) / lengths > -0.995) continue;
      const keep = distance(a, b) < distance(b, c) ? (k - 1 + size) % size : (k + 1) % size;
      vertices[keep].nodes.push(...vertices[k].nodes);
      vertices.splice(k, 1);
      removed = true;
      break;
    }
    if (!removed) break;
  }
  return vertices;
}

/**
 * How a corner between two straights is held in short of where its moved
 * sides meet: straight in towards its point (`side` 0, `amount` how far from
 * it), or slid along one side's moved line (1 the side arriving, -1 the one
 * leaving; `amount` how far along it), so that side stays parallel to itself
 * and only the other leans to meet it.
 */
interface Hold {
  side: -1 | 0 | 1;
  amount: number;
}

/**
 * Which of two sides meeting at a corner stands nearer upright or level: the
 * one to keep parallel, since a stem or a bar that tapers shows where a
 * diagonal a shade heavier at its join does not. Nought when they are alike.
 */
function uprightSide(tA: Vec2, tB: Vec2): -1 | 0 | 1 {
  const upright = (t: Vec2) => Math.max(Math.abs(t.x), Math.abs(t.y));
  const lean = upright(tA) - upright(tB);
  if (Math.abs(lean) < 0.03) return 0;
  return lean > 0 ? 1 : -1;
}

/** Whether two traced pieces cross anywhere. */
function piecesCross(one: Vertex[], other: Vertex[]): boolean {
  for (let i = 0; i + 1 < one.length; i++)
    for (let j = 0; j + 1 < other.length; j++)
      if (segmentsCross(one[i].point, one[i + 1].point, other[j].point, other[j + 1].point))
        return true;
  return false;
}

/** Whether a cubic doubles back across itself. */
function loops(from: Vec2, c1: Vec2, c2: Vec2, to: Vec2): boolean {
  const chord = sub(to, from);
  const a = sub(c1, from);
  const b = sub(to, c2);
  if (a.x * chord.x + a.y * chord.y < 0 && Math.hypot(a.x, a.y) > 1e-6) return true;
  if (b.x * chord.x + b.y * chord.y < 0 && Math.hypot(b.x, b.y) > 1e-6) return true;
  const points: Vec2[] = [];
  for (let i = 0; i <= 12; i++) points.push(cubicAt(from, c1, c2, to, i / 12));
  for (let i = 0; i < 12; i++)
    for (let j = i + 2; j < 12; j++)
      if (segmentsCross(points[i], points[i + 1], points[j], points[j + 1])) return true;
  return false;
}

function segmentsCross(
  p: Vec2,
  p2: Vec2,
  q: Vec2,
  q2: Vec2,
): { point: Vec2; s: number; u: number } | null {
  const r = sub(p2, p);
  const d = sub(q2, q);
  const denominator = cross(r, d);
  if (Math.abs(denominator) < 1e-12) return null;
  const qp = sub(q, p);
  const s = cross(qp, d) / denominator;
  const u = cross(qp, r) / denominator;
  if (s <= 1e-9 || s >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { point: { x: p.x + r.x * s, y: p.y + r.y * s }, s, u };
}

/**
 * Handles for a cubic from the first point of `points` to its last that
 * follows the points between, leaving along `leaving` and arriving along
 * `arriving`, so a smooth join stays smooth.
 * Only how long each handle is gets chosen, by least squares (Schneider), with
 * the samples' parameters refined by Newton's method as he does it. A handle
 * the drawing did not have stays on its point.
 */
function fitHandles(
  points: Vec2[],
  leaving: Vec2,
  arriving: Vec2,
  given: number[] | null,
  noOut: boolean,
  noIn: boolean,
): [Vec2, Vec2] {
  const from = points[0];
  const to = points[points.length - 1];
  const chord = distance(from, to);
  if (chord < 1e-6) return [{ ...from }, { ...to }];
  const fallback: [Vec2, Vec2] = [
    noOut ? { ...from } : add(from, times(leaving, chord / 3)),
    noIn ? { ...to } : add(to, times(arriving, chord / 3)),
  ];
  if (points.length < 3) return fallback;
  let ts: number[];
  if (given && given.length === points.length) ts = [...given];
  else {
    ts = [0];
    for (let i = 1; i < points.length; i++) ts.push(ts[i - 1] + distance(points[i - 1], points[i]));
    const length = ts[ts.length - 1];
    if (length < 1e-9) return fallback;
    ts = ts.map((t) => t / length);
  }
  let alpha1 = chord / 3;
  let alpha2 = chord / 3;
  for (let round = 0; round < 3; round++) {
    let c00 = 0;
    let c01 = 0;
    let c11 = 0;
    let x0 = 0;
    let x1 = 0;
    for (let i = 0; i < points.length; i++) {
      const t = ts[i];
      const v = 1 - t;
      const b0 = v * v * v;
      const b1 = 3 * v * v * t;
      const b2 = 3 * v * t * t;
      const b3 = t * t * t;
      const a1 = times(leaving, b1);
      const a2 = times(arriving, b2);
      c00 += a1.x * a1.x + a1.y * a1.y;
      c01 += a1.x * a2.x + a1.y * a2.y;
      c11 += a2.x * a2.x + a2.y * a2.y;
      const rest = {
        x: points[i].x - (from.x * (b0 + b1) + to.x * (b2 + b3)),
        y: points[i].y - (from.y * (b0 + b1) + to.y * (b2 + b3)),
      };
      x0 += a1.x * rest.x + a1.y * rest.y;
      x1 += a2.x * rest.x + a2.y * rest.y;
    }
    if (noOut && noIn) return fallback;
    if (noOut) {
      alpha1 = 0;
      alpha2 = c11 > 1e-12 ? x1 / c11 : chord / 3;
    } else if (noIn) {
      alpha2 = 0;
      alpha1 = c00 > 1e-12 ? x0 / c00 : chord / 3;
    } else {
      const det = c00 * c11 - c01 * c01;
      alpha1 = Math.abs(det) > 1e-12 ? (x0 * c11 - x1 * c01) / det : chord / 3;
      alpha2 = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : chord / 3;
    }
    // A handle pointing backwards, or out past anything sensible, means the
    // stretch is no curve these directions can make; a third of the chord is.
    if (!noOut && (!(alpha1 > 1e-6) || alpha1 > chord * 2)) alpha1 = chord / 3;
    if (!noIn && (!(alpha2 > 1e-6) || alpha2 > chord * 2)) alpha2 = chord / 3;
    // Never reaching past the far end of the curve, which folds it back.
    const along = sub(to, from);
    const reachOut = (leaving.x * along.x + leaving.y * along.y) / chord;
    const reachIn = -(arriving.x * along.x + arriving.y * along.y) / chord;
    if (reachOut > 1e-9) alpha1 = Math.min(alpha1, chord / reachOut);
    if (reachIn > 1e-9) alpha2 = Math.min(alpha2, chord / reachIn);
    // Newton: move each interior parameter to the nearest point of the curve.
    const c1 = add(from, times(leaving, alpha1));
    const c2 = add(to, times(arriving, alpha2));
    for (let i = 1; i < points.length - 1; i++) {
      const t = ts[i];
      const q = cubicAt(from, c1, c2, to, t);
      const d1 = cubicDerivativeAt(from, c1, c2, to, t);
      const v = 1 - t;
      const d2 = {
        x: 6 * v * (c2.x - 2 * c1.x + from.x) + 6 * t * (to.x - 2 * c2.x + c1.x),
        y: 6 * v * (c2.y - 2 * c1.y + from.y) + 6 * t * (to.y - 2 * c2.y + c1.y),
      };
      const diff = sub(q, points[i]);
      const numerator = diff.x * d1.x + diff.y * d1.y;
      const denominator = d1.x * d1.x + d1.y * d1.y + diff.x * d2.x + diff.y * d2.y;
      if (Math.abs(denominator) > 1e-12)
        ts[i] = Math.min(1, Math.max(0, t - numerator / denominator));
    }
  }
  return [add(from, times(leaving, alpha1)), add(to, times(arriving, alpha2))];
}
