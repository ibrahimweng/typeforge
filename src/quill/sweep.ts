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

import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { contourArea } from "@/font/geometry";
import { alongSpine, fitCubics, leftOf, walkOf, type SpineWalk } from "./curve";
import type {
  DrawnStroke,
  Exactness,
  Nib,
  QuillCap,
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
 * How far the ink stands off the spine at one point, given the nib.
 *
 * With no contrast the nib is a circle and this is half the width whichever way
 * the stroke is heading. With contrast it is an ellipse, and how far it reaches
 * across the stroke depends on the angle between the stroke's heading and the
 * nib's own axis -- which is what gives a broad-edged pen its thicks and thins.
 */
export function reachAcross(heading: Vec2, half: number, nib: Nib): number {
  const contrast = Math.min(Math.max(nib.contrast, 0), 0.95);
  if (contrast <= 0) return half;
  const across = half;
  const along = half * (1 - contrast);
  // The normal to the stroke, in the nib's own frame.
  const angle = (nib.angle * Math.PI) / 180;
  const normal = leftOf(heading);
  const inNib = Math.atan2(normal.y, normal.x) - angle;
  /*
   * The ellipse's radius in the direction of the stroke's normal. Written out
   * rather than approximated because this is what decides the weight of every
   * stroke on a face with contrast, and a cheap version of it puts the thin
   * strokes in the wrong place.
   */
  const c = Math.cos(inNib);
  const s = Math.sin(inNib);
  return (across * along) / Math.hypot(along * c, across * s);
}

// ---------------------------------------------------------------------------
// The two sides
// ---------------------------------------------------------------------------

/** One side of the stroke, sampled: the offset points in order. */
function sideOf(
  spine: QuillSpine,
  walk: SpineWalk,
  profile: WidthProfile,
  nib: Nib,
  side: 1 | -1,
  steps: number,
): Vec2[] {
  const points: Vec2[] = [];
  for (let step = 0; step <= steps; step++) {
    const fraction = step / steps;
    const { point, heading } = alongSpine(spine, walk, fraction);
    const half = widthAt(profile, fraction) / 2;
    const reach = reachAcross(heading, half, nib);
    const normal = leftOf(heading);
    points.push(
      at(point.x + normal.x * reach * side, point.y + normal.y * reach * side),
    );
  }
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
  if (cap.kind === "butt" || reach <= 1e-9) return [];
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
    stroke.nib.contrast <= 0 &&
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
        const curvature =
          Math.abs(dx * ddy - dy * ddx) / (speed * speed * speed);
        if (curvature > 1e-9) tightest = Math.min(tightest, 1 / curvature);
      }
    }
  }
  return tightest === Infinity ? Infinity : tightest * 2;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

function nodeAt(
  point: Vec2,
  handleIn: Vec2 | null,
  handleOut: Vec2 | null,
): GlyphNode {
  return {
    point,
    handleIn,
    handleOut,
    type: handleIn || handleOut ? "smooth" : "corner",
  };
}

/** A run of fitted cubics as outline nodes, ending where it began. */
function nodesFrom(
  curves: ReturnType<typeof fitCubics>["curves"],
): GlyphNode[] {
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
  return [...nodes]
    .reverse()
    .map((node) => ({
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
function sweepRing(
  stroke: QuillStroke,
  walk: SpineWalk,
  tolerance: number,
): DrawnStroke {
  const steps = stepsFor(walk.total);
  const exact = isExact(stroke);

  const loopOf = (side: 1 | -1) => {
    const points = sideOf(
      stroke.spine,
      walk,
      stroke.width,
      stroke.nib,
      side,
      steps,
    );
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
    if (areas[outer] > 0)
      for (const one of usable) one.nodes = reversed(one.nodes);
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
  if (walk.total <= 1e-9)
    return { contours: [], exactness: { exact: true, deviation: 0 } };
  if (stroke.spine.closed) return sweepRing(stroke, walk, tolerance);

  const steps = stepsFor(walk.total);
  const left = sideOf(stroke.spine, walk, stroke.width, stroke.nib, 1, steps);
  const right = sideOf(stroke.spine, walk, stroke.width, stroke.nib, -1, steps);

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
    deviation: exact
      ? 0
      : Math.max(fittedLeft.deviation, fittedRight.deviation),
  };

  const startEnd = alongSpine(stroke.spine, walk, 0);
  const finishEnd = alongSpine(stroke.spine, walk, 1);
  const startReach = reachAcross(
    startEnd.heading,
    widthAt(stroke.width, 0) / 2,
    stroke.nib,
  );
  const finishReach = reachAcross(
    finishEnd.heading,
    widthAt(stroke.width, 1) / 2,
    stroke.nib,
  );

  const nodes: GlyphNode[] = [];
  nodes.push(...nodesFrom(fittedLeft.curves));
  for (const point of capPoints(
    finishEnd.point,
    finishEnd.heading,
    finishReach,
    stroke.end,
    1,
  )) {
    nodes.push(nodeAt(point, null, null));
  }
  nodes.push(...nodesFrom(fittedRight.curves));
  for (const point of capPoints(
    startEnd.point,
    startEnd.heading,
    startReach,
    stroke.start,
    -1,
  )) {
    nodes.push(nodeAt(point, null, null));
  }

  return { contours: [{ nodes, closed: true } as Contour], exactness };
}

/** Every stroke of a glyph, drawn, with the weakest promise among them. */
export function sweepAll(
  strokes: QuillStroke[],
  tolerance = TOLERANCE,
): DrawnStroke {
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
