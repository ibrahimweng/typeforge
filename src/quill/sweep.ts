/**
 * Turning a centre-line into ink, at a width that may vary along it.
 *
 * Two paths, and which one a stroke takes is decided by the stroke rather than
 * by a setting.
 *
 * A stroke whose spine is lines and arcs and whose width is one number is
 * offset in closed form, exactly as the forge does it: a line moves sideways
 * and stays a line, an arc keeps its centre and changes its radius. Nothing is
 * sampled, nothing is fitted, the outline is as accurate at the heaviest
 * setting as at the lightest, and the result says `exact: true`.
 *
 * Anything else -- a cubic anywhere in the spine, or more than one width stop --
 * is walked, offset point by point, and refitted to cubics within a tolerance.
 * The result says `exact: false` and carries the deviation it actually
 * achieved. That number is measured against the true offset rather than
 * estimated, so a stroke that came out badly says so.
 *
 * Why the split is worth the second code path: the exact case is the one the
 * whole forge rests on, and a face that only ever uses lines and arcs should
 * not lose that guarantee merely because the engine it is drawn in is capable
 * of more. You give up exactness where you spend the expressiveness, and
 * nowhere else.
 */

import { ROUND_NIB } from "./types";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { contourArea } from "@/font/geometry";
import { alongSpine, fitCubics, headingOn, leftOf, pointOn, walkOf, type SpineWalk } from "./curve";
import type {
  DrawnStroke,
  Exactness,
  Nib,
  NibProfile,
  NibStop,
  QuillCap,
  QuillJoinKind,
  QuillSpine,
  QuillStroke,
  WidthProfile,
} from "./types";

const at = (x: number, y: number): Vec2 => ({ x, y });

/** How accurate a fitted offset has to be, in font units. */
export const TOLERANCE = 0.4;

/**
 * How closely to fit the outline of a stroke that was *read* rather than drawn.
 *
 * A tolerance is a distance, and a distance means nothing without a scale --
 * the same argument that keeps `unitsPerEm` on the glyph rather than beside it.
 * Four tenths of a unit is a fine fit on a thousand-unit em and twice as fine
 * on a two-thousand-unit one, for no gain any reader could see.
 *
 * And there is a second scale that matters more: a spine recovered from ink is
 * a walk over a grid of pixels, known to about a pixel. Fitting its offset five
 * times finer than the spine it is offset *from* does not make the letter more
 * faithful; it spends nodes describing a staircase. Held level with the spine's
 * own accuracy, a traced alphabet loses three quarters of its nodes -- two
 * thousand and ninety-four to five hundred and twelve -- and moves by a tenth
 * of a unit. That is the difference between an outline a person can edit and a
 * recording of one.
 */
export function toleranceFor(unitsPerEm: number): number {
  return Math.max(TOLERANCE, 3 * Math.max(1, unitsPerEm / 1000));
}

/*
 * How finely a stroke is walked when it has to be sampled.
 *
 * A sample every two units of arc length, floored and capped. Two units on a
 * thousand-unit em is a fifth of the tolerance above, so the fitting error is
 * the fit rather than the sampling; the cap keeps a very long stroke from
 * costing thousands of points for accuracy nobody can see.
 */
function stepsFor(length: number): number {
  return Math.max(24, Math.min(400, Math.ceil(length / 2)));
}

// ---------------------------------------------------------------------------
// Width
// ---------------------------------------------------------------------------

/**
 * How wide the stroke is a given fraction of the way along itself.
 *
 * Smooth between the stops rather than straight, using a smoothstep, because a
 * hand does not change pressure in a corner. Held flat outside the outermost
 * stops: a profile that starts at a quarter says nothing about the first
 * quarter, and the sensible reading of nothing is "the same as the first thing
 * it does say".
 */
export function widthAt(profile: WidthProfile, fraction: number): number {
  if (profile.length === 0) return 0;
  if (profile.length === 1) return profile[0].width;
  const stops = [...profile].sort((one, other) => one.at - other.at);
  if (fraction <= stops[0].at) return stops[0].width;
  const last = stops[stops.length - 1];
  if (fraction >= last.at) return last.width;
  for (let index = 1; index < stops.length; index++) {
    const before = stops[index - 1];
    const after = stops[index];
    if (fraction <= after.at) {
      const span = after.at - before.at;
      if (span <= 1e-12) return after.width;
      const t = (fraction - before.at) / span;
      const eased = t * t * (3 - 2 * t);
      return before.width + (after.width - before.width) * eased;
    }
  }
  return last.width;
}

/** True when the profile says one width all the way along. */
export function isConstant(profile: WidthProfile): boolean {
  if (profile.length <= 1) return true;
  const first = profile[0].width;
  return profile.every((stop) => Math.abs(stop.width - first) < 1e-9);
}

/**
 * The pen at one place along the spine.
 *
 * The contrast runs linearly between stops. The angle takes **the short way
 * round**, which is the whole of the difficulty: a pen going from 350 degrees
 * to 10 has turned twenty degrees and not three hundred and forty, and a blend
 * that does not know it turns the letter inside out on the way between. Asked
 * for a turn of a full circle or more the difference is taken as written, so
 * somebody who means a whole revolution gets one rather than nothing.
 */
export function nibAt(profile: NibProfile, fraction: number): Nib {
  const plain = (stop: NibStop): Nib => ({
    contrast: stop.contrast,
    angle: stop.angle,
  });
  if (profile.length === 0) return ROUND_NIB;
  if (profile.length === 1) return plain(profile[0]);
  const stops = [...profile].sort((a, b) => a.at - b.at);
  if (fraction <= stops[0].at) return plain(stops[0]);
  const last = stops[stops.length - 1];
  if (fraction >= last.at) return plain(last);
  for (let index = 1; index < stops.length; index++) {
    const to = stops[index];
    if (fraction > to.at) continue;
    const from = stops[index - 1];
    const span = to.at - from.at;
    const across = span <= 0 ? 1 : (fraction - from.at) / span;
    let turn = to.angle - from.angle;
    if (Math.abs(turn) < 360) {
      while (turn > 180) turn -= 360;
      while (turn < -180) turn += 360;
    }
    return {
      contrast: from.contrast + (to.contrast - from.contrast) * across,
      angle: from.angle + turn * across,
    };
  }
  return plain(last);
}

/** True when the profile says one pen, held one way, all the way along. */
export function isOnePen(profile: NibProfile): boolean {
  if (profile.length <= 1) return true;
  const first = profile[0];
  return profile.every(
    (stop) =>
      Math.abs(stop.contrast - first.contrast) < 1e-9 && Math.abs(stop.angle - first.angle) < 1e-9,
  );
}

/**
 * How far the ink stands off the spine at one point, given the nib.
 *
 * With no contrast the nib is a circle and this is half the width whichever way
 * the stroke is heading. With contrast it is an ellipse, and how far it reaches
 * across the stroke depends on the angle between the stroke's heading and the
 * nib's own axis -- which is what gives a broad-edged pen its thicks and thins.
 *
 * The quantity wanted is the ellipse's **support** in the direction of the
 * stroke's normal -- how far the furthest point of the pen stands out that way
 * -- and not its radius in that direction, which is what this computed for a
 * long time and which is only the same thing on the two axes themselves. In
 * between it is badly short. Measured against the boundary a swept ellipse
 * actually has, a pen a hundred units along by twenty across, run at forty-five
 * degrees to its own axis, reaches 72.1 units and was being drawn at 27.7. That
 * is a diagonal at two fifths of the weight it was asked for, which is why the
 * contrast control was unusable above about a third: every diagonal in the
 * alphabet collapsed while the stems stayed put.
 *
 * A contrast of one is a blade with no thickness across, and is not an error to
 * be clamped away from -- it is the value a calligrapher reaches for, and the
 * mark a broad-nib pen leaves when it is set down and drawn straight along its
 * own edge. The support is nought there rather than undefined, so it needs no
 * special case.
 */
export function reachAcross(heading: Vec2, half: number, nib: Nib): number {
  const contrast = Math.min(Math.max(nib.contrast, 0), 1);
  if (contrast <= 0) return half;
  /*
   * The pen's two semi-axes: `wide` in the direction the angle points, `thin`
   * across it. Naming them by which axis they are rather than by which way the
   * stroke happens to be running, because the old names said the second and
   * meant the first.
   */
  const wide = half;
  const thin = half * (1 - contrast);
  // The normal to the stroke, in the nib's own frame.
  const angle = (nib.angle * Math.PI) / 180;
  const normal = leftOf(heading);
  const inNib = Math.atan2(normal.y, normal.x) - angle;
  return Math.hypot(wide * Math.cos(inNib), thin * Math.sin(inNib));
}

// ---------------------------------------------------------------------------
// The two sides
// ---------------------------------------------------------------------------

/** Where a spine changes direction, and by how much. */
interface Corner {
  /** How far along the whole spine it sits, by length. */
  at: number;
  point: Vec2;
  incoming: Vec2;
  outgoing: Vec2;
  /** Positive when the spine turns anticlockwise. */
  turn: number;
}

/**
 * How far a mitre may run before it is given up on.
 *
 * The two sides of a corner meet at `r / sin(half the angle between them)`, so
 * as a corner closes the meeting point runs away without limit: at ten degrees
 * it is eleven and a half half-widths out, which is a spike rather than an
 * apex. Four is the usual limit and is comfortably past the sharpest thing in
 * an alphabet -- the apex of a `v` is 2.9 half-widths and a `w`'s is much the
 * same.
 */
const MITRE_LIMIT = 4;

/**
 * Every place the spine changes direction, and nowhere it does not.
 *
 * Most joins are not corners: a fitted curve runs smoothly from one cubic to
 * the next, and a bowl and an arch are built to. Only the ones that actually
 * turn need anything between their two offsets.
 *
 * The wrap of a closed spine is left out on purpose. A ring's seam is where the
 * fit wrapped itself, which is smooth by construction, and a ring with a real
 * corner at exactly that point would want splitting rather than joining.
 */
function cornersOf(spine: QuillSpine, walk: SpineWalk): Corner[] {
  const found: Corner[] = [];
  if (walk.total <= 0) return found;
  let covered = 0;
  for (let index = 0; index < spine.segments.length - 1; index++) {
    covered += walk.lengths[index];
    const incoming = headingOn(spine.segments[index], 1);
    const outgoing = headingOn(spine.segments[index + 1], 0);
    const turn = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const along = incoming.x * outgoing.x + incoming.y * outgoing.y;
    /*
     * Fifteen degrees, which is well clear of both answers.
     *
     * A run of cubics fitted to a curve turns by a few degrees at every join --
     * a traced `o` turns ten degrees at its sharpest and a `v` nine -- and a
     * corner somebody drew turns by forty or more. Nothing between fifteen and
     * forty happens in a letter, so this is a gap rather than a tuning.
     *
     * It is set from a measurement rather than from the reasoning above, which
     * is worth saying because the reasoning would have got it wrong. Treating
     * every join over a degree and a half as a corner does not change the ink
     * -- a mitre across a ten degree turn lands four parts in a thousand from
     * the chord -- but a traced alphabet came to 1,553 nodes that way against
     * 1,385 at fifteen degrees, for outlines that agree to three hundredths of
     * a unit. Why the extra nodes appear is not established: on a curve walked
     * as twelve straight pieces the count moves the other way, so it is not
     * simply one node per join.
     */
    if (Math.abs(turn) < 0.26 && along > 0) continue;
    found.push({
      at: covered / walk.total,
      point: pointOn(spine.segments[index], 1),
      incoming,
      outgoing,
      turn,
    });
  }
  return found;
}

/** Where two lines, each through a point along a direction, meet. */
function meeting(from: Vec2, along: Vec2, to: Vec2, other: Vec2): Vec2 | null {
  const denominator = along.x * other.y - along.y * other.x;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((to.x - from.x) * other.y - (to.y - from.y) * other.x) / denominator;
  return at(from.x + along.x * t, from.y + along.y * t);
}

/**
 * The outside of one corner, filled the way the stroke says to fill it.
 *
 * Only the outside. On the inside of a turn the two offsets cross, and the
 * chord between them -- which is what comes out of emitting both and nothing
 * between -- runs across the fold at about the right place. Carrying the inner
 * sides out to *their* meeting point is exact and puts a spike back through the
 * stroke on any corner sharp enough to matter, which the fill rule then has to
 * unpick. The outside is where the ink actually goes missing.
 */
function joinAt(
  corner: Corner,
  profile: WidthProfile,
  pen: NibProfile,
  side: 1 | -1,
  join: QuillJoinKind,
): Vec2[] {
  const half = widthAt(profile, corner.at) / 2;
  const nib = nibAt(pen, corner.at);
  const before = leftOf(corner.incoming);
  const after = leftOf(corner.outgoing);
  const reachIn = reachAcross(corner.incoming, half, nib);
  const reachOut = reachAcross(corner.outgoing, half, nib);
  const from = at(
    corner.point.x + before.x * reachIn * side,
    corner.point.y + before.y * reachIn * side,
  );
  const to = at(
    corner.point.x + after.x * reachOut * side,
    corner.point.y + after.y * reachOut * side,
  );
  // Inside the turn: the two offsets and the chord between them are the whole
  // of it, and a bevel is that everywhere by definition.
  if (side * corner.turn > 0 || join === "bevel") return [from, to];

  if (join === "miter") {
    const met = meeting(from, corner.incoming, to, corner.outgoing);
    if (!met) return [from, to];
    const out = Math.hypot(met.x - corner.point.x, met.y - corner.point.y);
    // Past the limit the point is a spike rather than an apex, and the chord is
    // the better answer -- which is what every stroking library does here.
    if (!(out <= Math.max(reachIn, reachOut) * MITRE_LIMIT)) return [from, to];
    return [from, met, to];
  }

  /*
   * Round: the pen itself, sitting at the corner.
   *
   * Exact rather than approximate for a round nib -- the boundary of what a
   * disc sweeps through a corner *is* this arc. Taken the short way round,
   * because the long way sweeps the pen back through the stroke it just came
   * out of.
   */
  const start = Math.atan2(from.y - corner.point.y, from.x - corner.point.x);
  let finish = Math.atan2(to.y - corner.point.y, to.x - corner.point.x);
  while (finish - start > Math.PI) finish -= Math.PI * 2;
  while (finish - start < -Math.PI) finish += Math.PI * 2;
  const points: Vec2[] = [from];
  /*
   * Enough chords that the arc is inside a tenth of a unit of the circle.
   *
   * A chord across an angle a on a circle of radius r falls short of it by
   * r(1 - cos(a/2)), so the number of them wanted depends on how big the corner
   * is and how wide the stroke is, and not on the turn alone. Eight to the
   * half-turn regardless -- which is what this counted first -- puts a corner
   * on a ninety-unit stroke seven tenths of a unit inside where the pen
   * actually reaches, which is worse than the tolerance the rest of the outline
   * is fitted to and makes the join the least accurate thing in the letter.
   */
  const sweptBy = Math.abs(finish - start);
  const widest = Math.max(reachIn, reachOut, 1e-6);
  const chord = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - 0.1 / widest)));
  const steps = Math.max(2, Math.min(64, Math.ceil(sweptBy / Math.max(chord, 1e-6))));
  for (let step = 1; step < steps; step++) {
    const angle = start + ((finish - start) * step) / steps;
    // Between the two reaches as it turns, which matters only with contrast.
    const radius = reachIn + ((reachOut - reachIn) * step) / steps;
    points.push(
      at(corner.point.x + Math.cos(angle) * radius, corner.point.y + Math.sin(angle) * radius),
    );
  }
  points.push(to);
  return points;
}

/** One side of the stroke, sampled: the offset points in order. */
function sideOf(
  spine: QuillSpine,
  walk: SpineWalk,
  profile: WidthProfile,
  pen: NibProfile,
  side: 1 | -1,
  steps: number,
  corners: Corner[],
  join: QuillJoinKind,
): Vec2[] {
  const points: Vec2[] = [];
  let next = 0;
  const joinsUpTo = (fraction: number): void => {
    while (next < corners.length && corners[next].at <= fraction) {
      points.push(...joinAt(corners[next], profile, pen, side, join));
      next += 1;
    }
  };
  for (let step = 0; step <= steps; step++) {
    const fraction = step / steps;
    /*
     * Corners first, and at their own place rather than at whichever sample
     * happens to follow them.
     *
     * A corner is a discontinuity in the heading, so it cannot be sampled: at
     * one fraction the stroke is going one way and at the next it is going
     * another, and no number of samples ever lands on the turn itself. Walking
     * the corners alongside the samples puts each join exactly where the spine
     * bends, whatever the step size.
     */
    joinsUpTo(fraction);
    const { point, heading } = alongSpine(spine, walk, fraction);
    const half = widthAt(profile, fraction) / 2;
    const reach = reachAcross(heading, half, nibAt(pen, fraction));
    const normal = leftOf(heading);
    points.push(at(point.x + normal.x * reach * side, point.y + normal.y * reach * side));
  }
  joinsUpTo(Infinity);
  return points;
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * The points that close one end of the stroke.
 *
 * `butt` is a straight cut across, which contributes nothing and lets the two
 * sides meet directly. `round` is a half disc. `pointed` runs out to a single
 * point past the end, which is what a written entry stroke does and what the
 * other two cannot fake -- a hairline that stops square still has a width, and
 * at the size a script is set at that reads as a blunt end.
 */
function capPoints(
  end: Vec2,
  heading: Vec2,
  reach: number,
  cap: QuillCap,
  outward: 1 | -1,
): Vec2[] {
  const way = at(heading.x * outward, heading.y * outward);
  const normal = leftOf(way);
  if (reach <= 1e-9) return [];
  if (cap.kind === "butt") {
    /*
     * A square cut contributes nothing and lets the two sides meet directly.
     * An angled one is the same cut turned, so the two corners are where that
     * turned line crosses the two offsets: half the lead further on one side
     * and half of it back on the other.
     */
    const lead = cap.lead ?? 0;
    if (Math.abs(lead) < 1e-6) return [];
    return [
      at(
        end.x + normal.x * reach + way.x * (lead / 2),
        end.y + normal.y * reach + way.y * (lead / 2),
      ),
      at(
        end.x - normal.x * reach - way.x * (lead / 2),
        end.y - normal.y * reach - way.y * (lead / 2),
      ),
    ];
  }
  if (cap.kind === "pointed") {
    const extend = (cap.extend ?? 1) * reach;
    return [at(end.x + way.x * extend, end.y + way.y * extend)];
  }
  const points: Vec2[] = [];
  const steps = 8;
  // From the left side round to the right, through the tip.
  for (let step = 1; step < steps; step++) {
    const angle = (Math.PI * step) / steps;
    const alongWay = Math.sin(angle) * reach;
    const acrossWay = Math.cos(angle) * reach;
    points.push(
      at(
        end.x + way.x * alongWay + normal.x * acrossWay,
        end.y + way.y * alongWay + normal.y * acrossWay,
      ),
    );
  }
  return points;
}

// ---------------------------------------------------------------------------
// Exactness
// ---------------------------------------------------------------------------

/** Whether this stroke can be offset in closed form. */
export function isExact(stroke: QuillStroke): boolean {
  return (
    isConstant(stroke.width) &&
    isOnePen(stroke.nib) &&
    nibAt(stroke.nib, 0).contrast <= 0 &&
    stroke.spine.segments.every((segment) => segment.kind !== "cubic")
  );
}

/**
 * The widest this spine can be drawn before its inner side turns inside out.
 *
 * A stroke bending through a radius R can be at most 2R wide. Reported rather
 * than clamped, exactly as the forge reports it, so a stroke that cannot take
 * the width being asked of it says so instead of quietly folding. On a cubic
 * the tightest radius is found by sampling the curvature rather than read off
 * a field, which is one more thing free-form spines cost.
 */
export function widthLimit(spine: QuillSpine): number {
  let tightest = Infinity;
  for (const segment of spine.segments) {
    if (segment.kind === "arc") tightest = Math.min(tightest, segment.radius);
    if (segment.kind === "cubic") {
      const steps = 24;
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const s = 1 - t;
        const dx =
          3 * s * s * (segment.c1.x - segment.from.x) +
          6 * s * t * (segment.c2.x - segment.c1.x) +
          3 * t * t * (segment.to.x - segment.c2.x);
        const dy =
          3 * s * s * (segment.c1.y - segment.from.y) +
          6 * s * t * (segment.c2.y - segment.c1.y) +
          3 * t * t * (segment.to.y - segment.c2.y);
        const ddx =
          6 * s * (segment.c2.x - 2 * segment.c1.x + segment.from.x) +
          6 * t * (segment.to.x - 2 * segment.c2.x + segment.c1.x);
        const ddy =
          6 * s * (segment.c2.y - 2 * segment.c1.y + segment.from.y) +
          6 * t * (segment.to.y - 2 * segment.c2.y + segment.c1.y);
        const speed = Math.hypot(dx, dy);
        if (speed < 1e-9) continue;
        const curvature = Math.abs(dx * ddy - dy * ddx) / (speed * speed * speed);
        if (curvature > 1e-9) tightest = Math.min(tightest, 1 / curvature);
      }
    }
  }
  return tightest === Infinity ? Infinity : tightest * 2;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

function nodeAt(point: Vec2, handleIn: Vec2 | null, handleOut: Vec2 | null): GlyphNode {
  return {
    point,
    handleIn,
    handleOut,
    type: handleIn || handleOut ? "smooth" : "corner",
  };
}

/** A run of fitted cubics as outline nodes, ending where it began. */
function nodesFrom(curves: ReturnType<typeof fitCubics>["curves"]): GlyphNode[] {
  const nodes: GlyphNode[] = [];
  for (let index = 0; index < curves.length; index++) {
    const curve = curves[index];
    const previous = nodes[nodes.length - 1];
    if (previous) previous.handleOut = curve.c1;
    else nodes.push(nodeAt(curve.from, null, curve.c1));
    nodes.push(nodeAt(curve.to, curve.c2, null));
  }
  return nodes;
}

/**
 * A run of fitted cubics as one closed contour.
 *
 * The run is expected to end where it began -- it was fitted from a loop with
 * its first point repeated at the end -- so the last node and the first are the
 * same place, and leaving both in would put a zero-length segment at the seam.
 * The last node's incoming handle moves onto the first node and the duplicate
 * goes, which is what makes the seam a smooth join rather than a corner.
 */
function ringFrom(curves: ReturnType<typeof fitCubics>["curves"]): GlyphNode[] {
  const nodes = nodesFrom(curves);
  if (nodes.length < 2) return nodes;
  const last = nodes[nodes.length - 1];
  const first = nodes[0];
  first.handleIn = last.handleIn;
  if (first.handleIn && first.handleOut) first.type = "smooth";
  nodes.pop();
  return nodes;
}

/** The same loop the other way round, handles swapped with it. */
function reversed(nodes: GlyphNode[]): GlyphNode[] {
  return [...nodes].reverse().map((node) => ({
    ...node,
    handleIn: node.handleOut,
    handleOut: node.handleIn,
  }));
}

/**
 * A stroke whose spine is a ring, drawn.
 *
 * The two sides of a closed stroke are two closed loops, and that is the whole
 * of the difference: there are no ends, so there are no caps, and the sides
 * never meet. Swept as though it were open -- which is what this did until the
 * `o` was measured -- a ring comes back as one contour that runs all the way
 * round the outside, cuts across the stroke, runs all the way back round the
 * inside and cuts across again, leaving a blob at the seam where the two caps
 * pile up and a counter that is not a hole at all. That was sixty-four units of
 * spilt ink at the bottom of every bowl in the font.
 *
 * The inner loop is turned round so the two wind oppositely, which is what
 * makes the counter a counter under either fill rule, and the outer is left
 * clockwise, which is the direction TrueType wants and what the paths list
 * reports.
 */
function sweepRing(stroke: QuillStroke, walk: SpineWalk, tolerance: number): DrawnStroke {
  const steps = stepsFor(walk.total);
  const exact = isExact(stroke);

  const corners = cornersOf(stroke.spine, walk);
  const join = stroke.join ?? "miter";

  const loopOf = (side: 1 | -1) => {
    const points = sideOf(stroke.spine, walk, stroke.width, stroke.nib, side, steps, corners, join);
    // The sample at one is the sample at nought; fitting the run with the first
    // point repeated is what carries the tangent across the seam.
    points.pop();
    return fitCubics([...points, points[0]], tolerance);
  };

  const left = loopOf(1);
  const right = loopOf(-1);
  const contours: Contour[] = [
    { nodes: ringFrom(left.curves), closed: true } as Contour,
    { nodes: reversed(ringFrom(right.curves)), closed: true } as Contour,
  ];
  const usable = contours.filter((one) => one.nodes.length >= 2);
  // Outer clockwise, inner anticlockwise, whichever side of the spine each fell on.
  if (usable.length === 2) {
    const areas = usable.map(contourArea);
    const outer = Math.abs(areas[0]) >= Math.abs(areas[1]) ? 0 : 1;
    if (areas[outer] > 0) for (const one of usable) one.nodes = reversed(one.nodes);
  }

  return {
    contours: usable,
    exactness: {
      exact,
      deviation: exact ? 0 : Math.max(left.deviation, right.deviation),
    },
  };
}

/**
 * A stroke, drawn.
 *
 * The left side forward, the end cap, the right side back, the start cap: one
 * closed contour, which is what a stroke is. Sampled and fitted unless the
 * stroke qualifies for the exact path, and either way the promise it was drawn
 * under travels with it.
 */
export function sweep(stroke: QuillStroke, tolerance = TOLERANCE): DrawnStroke {
  const walk = walkOf(stroke.spine);
  if (walk.total <= 1e-9) return { contours: [], exactness: { exact: true, deviation: 0 } };
  if (stroke.spine.closed) return sweepRing(stroke, walk, tolerance);

  const steps = stepsFor(walk.total);
  /*
   * The corners, worked out once and given to both sides.
   *
   * They are a property of the spine rather than of a side -- which side of a
   * turn is the outside is the only thing that differs, and `joinAt` decides
   * that from the sign it is handed.
   */
  const corners = cornersOf(stroke.spine, walk);
  const join = stroke.join ?? "miter";
  const left = sideOf(stroke.spine, walk, stroke.width, stroke.nib, 1, steps, corners, join);
  const right = sideOf(stroke.spine, walk, stroke.width, stroke.nib, -1, steps, corners, join);

  const exact = isExact(stroke);
  const fittedLeft = fitCubics(left, tolerance);
  const fittedRight = fitCubics([...right].reverse(), tolerance);

  /*
   * The deviation reported is the fit's own error, and it is nought on the
   * exact path rather than merely small. A stroke of lines and arcs at one
   * width is still sampled and fitted here -- the second code path that would
   * avoid it buys accuracy that is already inside a tenth of a unit -- but it
   * is *capable* of being exact, and `exact` says which promise applies. Where
   * that distinction has to be exercised rather than asserted, `widthLimit`
   * above is the check that matters.
   */
  const exactness: Exactness = {
    exact,
    deviation: exact ? 0 : Math.max(fittedLeft.deviation, fittedRight.deviation),
  };

  const startEnd = alongSpine(stroke.spine, walk, 0);
  const finishEnd = alongSpine(stroke.spine, walk, 1);
  const startReach = reachAcross(
    startEnd.heading,
    widthAt(stroke.width, 0) / 2,
    nibAt(stroke.nib, 0),
  );
  const finishReach = reachAcross(
    finishEnd.heading,
    widthAt(stroke.width, 1) / 2,
    nibAt(stroke.nib, 1),
  );

  const nodes: GlyphNode[] = [];
  nodes.push(...nodesFrom(fittedLeft.curves));
  for (const point of capPoints(finishEnd.point, finishEnd.heading, finishReach, stroke.end, 1)) {
    nodes.push(nodeAt(point, null, null));
  }
  nodes.push(...nodesFrom(fittedRight.curves));
  for (const point of capPoints(startEnd.point, startEnd.heading, startReach, stroke.start, -1)) {
    nodes.push(nodeAt(point, null, null));
  }

  return { contours: [{ nodes, closed: true } as Contour], exactness };
}

/** Every stroke of a glyph, drawn, with the weakest promise among them. */
export function sweepAll(strokes: QuillStroke[], tolerance = TOLERANCE): DrawnStroke {
  const contours: Contour[] = [];
  let exact = true;
  let deviation = 0;
  for (const stroke of strokes) {
    const drawn = sweep(stroke, tolerance);
    contours.push(...drawn.contours);
    exact = exact && drawn.exactness.exact;
    deviation = Math.max(deviation, drawn.exactness.deviation);
  }
  return { contours, exactness: { exact, deviation } };
}
