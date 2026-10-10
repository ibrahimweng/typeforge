/**
 * Ends shaped after the pen has drawn them: an arm swelled toward its beak, a
 * curved end tapered, and the corners of a seen cut rounded.
 *
 * Each is asked for by a field of the terminal (`swell`, `taper`, `soft`)
 * that `dress` sets only where the style's own field is above nought, so a
 * letter of any existing face never reaches anything here.
 *
 * Every one of them keeps the nodes the end is drawn with to a count the
 * style decides. A swelled or tapered end moves the pieces its sides already
 * have and adds none -- a line stays a line and an ellipse an ellipse -- and a
 * rounded corner is always exactly one node more, with a curve where the
 * corner was, however little room it has. Only how far each reaches follows
 * the pen.
 */

import type { GlyphNode, Vec2 } from "@/font/types";
import { edgeLength, flattenedArea, kappa, splitEdgeAtLength, tangentAt } from "./soft";
import type { Headed, OffsetEllipse, OffsetSegment, PenReach, SeamMark } from "./sweep";
import type { SpineSegment, Stroke, Terminal } from "./types";

/*
 * The sweep's own small pieces of geometry, written out again here rather
 * than imported. The sweep imports this file, and this file must not import
 * the sweep back: a test that stands in for these finishes, to watch the
 * corners being handed over (see `sweep-sides.test.ts`), would otherwise be
 * handed the sweep before its stand-in was ready, and the sweep would call the
 * real thing past it. Each is the same arithmetic as its namesake in sweep.ts.
 */

const rotate = (point: Vec2, angle: number): Vec2 => ({
  x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
  y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
});

/** The pen's reach in a given direction: `reachAlong` in sweep.ts. */
function reachAlong(direction: Vec2, reach: PenReach): Vec2 {
  const local = rotate(direction, -reach.angle);
  return rotate({ x: local.x * reach.across, y: local.y * reach.along }, reach.angle);
}

/** A quarter turn anticlockwise: the left of the direction travelled. */
const leftOf = (direction: Vec2): Vec2 => ({ x: -direction.y, y: direction.x });

/** Where an ellipse arc's parametric angle puts a point: `ellipseAt` in sweep.ts. */
function ellipseAt(arc: OffsetEllipse, t: number): Vec2 {
  const turned = rotate({ x: arc.rx * Math.cos(t), y: arc.ry * Math.sin(t) }, arc.rotation);
  return { x: arc.centre.x + turned.x, y: arc.centre.y + turned.y };
}

/** Its derivative there: `ellipseSlope` in sweep.ts. */
function ellipseSlope(arc: OffsetEllipse, t: number): Vec2 {
  return rotate({ x: -arc.rx * Math.sin(t), y: arc.ry * Math.cos(t) }, arc.rotation);
}

const offsetStart = (segment: OffsetSegment): Vec2 =>
  segment.kind === "line" ? segment.from : ellipseAt(segment, segment.from);

const offsetEnd = (segment: OffsetSegment): Vec2 =>
  segment.kind === "line" ? segment.to : ellipseAt(segment, segment.to);

/** Whether an offset piece travels: `moving` in sweep.ts. */
function moving(segment: OffsetSegment): boolean {
  if (segment.kind === "line") {
    return Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > 1e-6;
  }
  return (
    Math.abs(segment.to - segment.from) > 1e-9 &&
    (Math.abs(segment.rx) > 1e-9 || Math.abs(segment.ry) > 1e-9)
  );
}

/** How many quarter-turn pieces an arc of `sweep` radians is cut into: `piecesFor` in sweep.ts. */
function piecesFor(sweep: number): number {
  return Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
}

/** Whether an end asks for its sides to be moved: swelled or tapered. */
function shapes(terminal: Terminal): boolean {
  return terminal.swell !== undefined || terminal.taper !== undefined;
}

/**
 * The two side runs with each end that carries `swell` or `taper` shaped, or
 * nothing where neither end does -- which is the sweep's sign that the sides
 * are where the pen put them. Shaped runs are new runs: the runs given, and
 * their pieces, are left as they were, since the sweep compares the two (see
 * `sidesAt` in sweep.ts).
 *
 * The near end is shaped first and then the far one, so a single straight
 * run swelled at both ends is the line between its two swelled ends.
 */
export function endsShaped(
  stroke: Stroke,
  headed: Headed[],
  left: OffsetSegment[],
  right: OffsetSegment[],
  reach: PenReach,
): { left: OffsetSegment[]; right: OffsetSegment[] } | null {
  if (stroke.spine.closed) return null;
  if (!shapes(stroke.start) && !shapes(stroke.end)) return null;
  const runs = { left: [...left], right: [...right] };
  for (const [terminal, atEnd] of [
    [stroke.start, false],
    [stroke.end, true],
  ] as const) {
    if (terminal.swell !== undefined) {
      swelled(runs, headed, atEnd, terminal.swell, terminal.swellSide, reach);
    }
    if (terminal.taper !== undefined) tapered(runs, headed, atEnd, terminal.taper);
  }
  return runs;
}

/** Whether a spine segment goes anywhere, asked as the aligned cut asks it. */
function travels(segment: SpineSegment): boolean {
  return segment.kind === "line"
    ? Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > 1e-9
    : Math.abs(segment.endAngle - segment.startAngle) > 1e-9 && segment.radius > 1e-9;
}

/** The spine segment an end is drawn off: the last (or first) one that goes anywhere. */
function endSegment(headed: Headed[], atEnd: boolean): Headed | null {
  const order = atEnd ? [...headed].reverse() : headed;
  return order.find((one) => travels(one.segment)) ?? null;
}

/**
 * Where on a side run its end is drawn: the index of the last piece that
 * travels (the first, at the near end), and the pieces of no length beyond it
 * that the run carries on purpose, which follow wherever that end moves.
 */
function endPiece(run: OffsetSegment[], atEnd: boolean): { at: number; beyond: number[] } | null {
  const order = atEnd ? [...run.keys()].reverse() : [...run.keys()];
  const found = order.findIndex((index) => moving(run[index]));
  if (found < 0) return null;
  return { at: order[found], beyond: order.slice(0, found) };
}

/** A piece of no length stood on `point` instead, keeping its kind and its pieces. */
function standingOn(piece: OffsetSegment, point: Vec2): OffsetSegment {
  if (piece.kind === "line") {
    const dx = piece.to.x - piece.from.x;
    const dy = piece.to.y - piece.from.y;
    return { kind: "line", from: point, to: { x: point.x + dx, y: point.y + dy } };
  }
  const was = ellipseAt(piece, piece.from);
  return {
    ...piece,
    centre: { x: piece.centre.x + point.x - was.x, y: piece.centre.y + point.y - was.y },
  };
}

/**
 * An arm swelled toward one end: each side's last straight piece carried out
 * from its root, where it stays, to `swell` times the pen's reach across it at
 * the end -- both sides, or only the one `side` names (`Terminal.swellSide`).
 * The offset of a line whose width grows evenly along it is a line, so the
 * side is still exactly one straight piece: only its far point moves, by the
 * pen's reach across the end times what the swell adds.
 */
function swelled(
  runs: { left: OffsetSegment[]; right: OffsetSegment[] },
  headed: Headed[],
  atEnd: boolean,
  swell: number,
  only: 1 | -1 | undefined,
  reach: PenReach,
): void {
  const segment = endSegment(headed, atEnd);
  if (segment?.segment.kind !== "line") return;
  const heading = atEnd ? segment.end : segment.start;
  const shift = reachAlong(leftOf(heading), reach);
  for (const [run, side] of [
    [runs.left, 1],
    [runs.right, -1],
  ] as const) {
    if (only !== undefined && only !== side) continue;
    const end = endPiece(run, atEnd);
    if (!end) continue;
    const piece = run[end.at];
    if (piece.kind !== "line") continue;
    const by = { x: shift.x * side * (swell - 1), y: shift.y * side * (swell - 1) };
    const moved = (point: Vec2): Vec2 => ({ x: point.x + by.x, y: point.y + by.y });
    run[end.at] = atEnd
      ? { kind: "line", from: piece.from, to: moved(piece.to) }
      : { kind: "line", from: moved(piece.from), to: piece.to };
    const tip = atEnd ? moved(piece.to) : moved(piece.from);
    for (const index of end.beyond) run[index] = standingOn(run[index], tip);
  }
}

/**
 * How far back from a tapered end its inner side starts drawing in, in the
 * turning of that side: forty-five degrees, or the whole pieces that first
 * reach it.
 */
const TAPER_TURN = Math.PI / 4;

/** The least a tapered inner side is squeezed to across its first tangent: see `tapered`. */
const TAPER_SQUEEZE = 0.35;

/**
 * How narrow a tapered stroke may be pinched short of its end: a quarter as
 * wide as the end is, or as it was already there. An end cut slantwise across
 * the stroke, as a c's foot is, is narrower across the stroke than along its
 * cut, so the side a little way back from it may come nearer the other than
 * the corner does; held to half of that, a c's foot tapered only half as far as
 * it was asked to.
 */
const TAPER_PINCH = 0.25;

/** How many halvings find the most a taper can draw in without pinching the stroke. */
const TAPER_HALVINGS = 10;

/** How many points along each piece a pinch is looked for at. */
const TAPER_SAMPLES = 8;

/** Points along an offset piece, from its start to its end. */
function sampled(piece: OffsetSegment): Vec2[] {
  if (piece.kind === "line") return [piece.from, piece.to];
  const points: Vec2[] = [];
  for (let step = 0; step <= TAPER_SAMPLES; step++) {
    points.push(ellipseAt(piece, piece.from + ((piece.to - piece.from) * step) / TAPER_SAMPLES));
  }
  return points;
}

/**
 * How far a point stands off a polyline, and on which side of it: above
 * nought on the left of the way the polyline runs, below on its right, read
 * off the piece of it the point comes nearest.
 *
 * Signed because a side drawn in too far does not only come near the other:
 * it can go through it. A question mark's hook tapered most of the way ran its
 * inner side out across the outer one near the top, and measured without a
 * sign the points that had gone through stood as far off the outer side as
 * points well inside it, so nothing was held.
 */
function standsOff(line: Vec2[], point: Vec2): number {
  let best = Infinity;
  // The square of the nearest so far, with `SQUARED_SLACK`: a piece past it cannot be nearer.
  let past = Infinity;
  let signed = Infinity;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const b = line[k];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    if (!(length > 0)) continue;
    const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
    const offX = a.x + dx * t - point.x;
    const offY = a.y + dy * t - point.y;
    if (offX * offX + offY * offY > past) continue;
    const distance = Math.hypot(offX, offY);
    if (distance < best) {
      best = distance;
      // Not for a distance so small its square is lost: every piece is then measured.
      past = distance > 1e-100 ? distance * distance * SQUARED_SLACK : Infinity;
      signed = dx * (point.y - a.y) - dy * (point.x - a.x) < 0 ? -distance : distance;
    }
  }
  return signed;
}

/**
 * A little over one. A point whose squared distance is this much more than
 * the square of another distance is further off than it, however `Math.hypot`
 * rounds either: so it can be passed over by its square alone, which costs
 * far less than measuring it.
 */
const SQUARED_SLACK = 1 + 1e-9;

/** Whether two polylines cross, touching at an end not counted. */
function crossing(one: Vec2[], other: Vec2[]): boolean {
  for (let i = 1; i < one.length; i++) {
    const a = one[i - 1];
    const rx = one[i].x - a.x;
    const ry = one[i].y - a.y;
    for (let j = 1; j < other.length; j++) {
      const c = other[j - 1];
      const sx = other[j].x - c.x;
      const sy = other[j].y - c.y;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
      const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) return true;
    }
  }
  return false;
}

/**
 * A curved end tapered: the inner side's last curves drawn in toward the outer
 * side so the stroke ends `taper` of its width across.
 *
 * The inner side is the one toward the centre of the curve the end is on. Its
 * last travelling pieces back to where it has turned through `TAPER_TURN` run
 * from P0 to the corner Q, and the outer side stops at O. The tapered corner
 * Q* lies on the end as it was, the line from Q to O, `1 - taper` of the way
 * across (and never nearer O than a unit).
 *
 * Those pieces are carried there by the one affine map that leaves P0 and its
 * tangent where they are and takes Q to Q*: it moves each point by as much as
 * the point stands off that tangent, so the side draws in from nothing at P0,
 * slowly at first, to the whole of it at the end. An affine map takes an
 * ellipse to an ellipse, so each piece is still one -- the same pieces, with
 * the same nodes -- and the side keeps its direction at P0 and at every join,
 * so it does not kink. And Q* is on the end as it was, so the end is no
 * longer, only narrower.
 *
 * Asked of one piece, as it first was, this fell to pieces: the last piece of
 * a c's inner side is whatever the oval leaves over, two degrees at a regular
 * weight and less than one at the Black, and a sliver that size has nothing
 * to draw in with; and scaled about P0 instead, a hook's one long piece swung
 * out in a loop over the top of the letter.
 *
 * Eased off, continuously, where the inner side hardly curves round a centre
 * of its own any more -- a heavy pen on a tight hook, whose inner offset
 * shrinks to a point and turns inside out -- and held where drawing in that far
 * would squeeze the side to less than `TAPER_SQUEEZE` of its offset from the
 * tangent at P0. The end then has the same nodes, tapered less.
 */
function tapered(
  runs: { left: OffsetSegment[]; right: OffsetSegment[] },
  headed: Headed[],
  atEnd: boolean,
  taper: number,
): void {
  const segment = endSegment(headed, atEnd);
  if (segment?.segment.kind !== "arc") return;
  // Anticlockwise, the left of the way travelled is toward the centre.
  const [inner, outer] = segment.segment.sweepPositive
    ? [runs.left, runs.right]
    : [runs.right, runs.left];
  if (inner.length === 0 || outer.length === 0) return;

  // From the end inward: the pieces of no length it carries, then the curve.
  const order = atEnd ? [...inner.keys()].reverse() : [...inner.keys()];
  let at = 0;
  const beyond: number[] = [];
  while (at < order.length && !moving(inner[order[at]])) beyond.push(order[at++]);
  const chain: number[] = [];
  let turned = 0;
  let least = Infinity;
  while (at < order.length && turned < TAPER_TURN) {
    const piece = inner[order[at]];
    if (piece.kind !== "ellipse" || !moving(piece)) break;
    chain.push(order[at++]);
    turned += Math.abs(piece.to - piece.from);
    least = Math.min(least, piece.rx, piece.ry);
  }
  if (chain.length === 0) return;

  const near = inner[chain[0]] as OffsetEllipse;
  const far = inner[chain[chain.length - 1]] as OffsetEllipse;
  const q = atEnd ? ellipseAt(near, near.to) : ellipseAt(near, near.from);
  const p0 = atEnd ? ellipseAt(far, far.from) : ellipseAt(far, far.to);
  const o = atEnd ? offsetEnd(outer[outer.length - 1]) : offsetStart(outer[0]);
  const width = Math.hypot(o.x - q.x, o.y - q.y);
  const slope = ellipseSlope(far, atEnd ? far.from : far.to);
  const length = Math.hypot(slope.x, slope.y);
  if (width < 1e-9 || length < 1e-12) return;
  const along = { x: slope.x / length, y: slope.y / length };
  const off = leftOf(along);
  // How far Q stands off the tangent at P0, which is how far it can be moved.
  const stands = off.x * (q.x - p0.x) + off.y * (q.y - p0.y);
  if (Math.abs(stands) < 1e-9) return;

  const out = { x: (o.x - q.x) / width, y: (o.y - q.y) / width };
  const ease = Math.min(1, Math.max(0, least / (0.25 * width)));
  let by = ease * Math.max(0, Math.min((1 - taper) * width, width - 1));
  /*
   * In the frame of P0's tangent (`along`) and its normal (`off`), the map is
   * [[stretch, shear], [0, squeeze]]: P0's tangent keeps its direction, Q's
   * offset from it (`stands`) is squeezed to carry Q across to Q*, and of the
   * stretch along the tangent and the shear that between them carry it along
   * to Q*, the pair moving the side least. Each grows with `by`; these are
   * what one unit of it adds.
   */
  const reach = along.x * (q.x - p0.x) + along.y * (q.y - p0.y);
  const forward = along.x * out.x + along.y * out.y;
  const square = reach * reach + stands * stands;
  const stretchBy = (reach * forward) / square;
  const shearBy = (stands * forward) / square;
  const squeezeBy = (off.x * out.x + off.y * out.y) / stands;
  // None of them past what a side drawn in reasonably asks for, which only a
  // run hardly turning at all would want more than.
  for (const [rate, low, high] of [
    [stretchBy, TAPER_SQUEEZE - 1, 1],
    [squeezeBy, TAPER_SQUEEZE - 1, 1],
    [shearBy, -1.5, 1.5],
  ]) {
    if (rate * by < low) by = low / rate;
    if (rate * by > high) by = high / rate;
  }
  if (by <= 0) return;
  // M v = v + (along . v) stretch along + (off . v) (shear along + squeeze off).
  const mapFor = (amount: number) => {
    const stretch = amount * stretchBy;
    const shear = amount * shearBy;
    const squeeze = amount * squeezeBy;
    return (v: Vec2): Vec2 => {
      const a = along.x * v.x + along.y * v.y;
      const k = off.x * v.x + off.y * v.y;
      return {
        x: v.x + a * stretch * along.x + k * (shear * along.x + squeeze * off.x),
        y: v.y + a * stretch * along.y + k * (shear * along.y + squeeze * off.y),
      };
    };
  };
  /*
   * And never so far that the stroke is pinched short of its end: drawn in
   * along a long hook -- a question mark's -- the inner side arrived at the
   * end turned so far that it ran out across the outer side just before it.
   * So nowhere along the way may the side come nearer the outer one than
   * `TAPER_PINCH` of the end's width once tapered, unless it was already
   * nearer than that, nor go through it or through the end; held to the most
   * that keeps to it, found by a fixed number of halvings.
   *
   * The outer side is walked the way the stroke travels, piece after piece in
   * order, so which side of it a point is on means something; its pieces at
   * the end are listed from the end inward.
   */
  const beside = [...chain, ...beyond]
    .sort((one, other) => one - other)
    .map((index) => outer[index])
    .filter(moving);
  const outerLine = beside.flatMap((piece) => sampled(piece));
  // Toward the centre of the curve is the left of the outer side anticlockwise.
  const inward = segment.segment.sweepPositive ? 1 : -1;
  // Each piece of the chain sampled once, for both of the lists below: nothing changes them.
  const samples = new Map(chain.map((index) => [index, sampled(inner[index])]));
  const innerPoints = chain.flatMap((index) => samples.get(index)!);
  // The same side again as one line, walked the way the stroke travels.
  const innerLine = [...chain]
    .sort((one, other) => one - other)
    .flatMap((index) => samples.get(index)!);
  const was = innerPoints.map((point) => inward * standsOff(outerLine, point));
  const pinches = (amount: number): boolean => {
    const map = mapFor(amount);
    const drawnIn = (point: Vec2): Vec2 => {
      const v = map({ x: point.x - p0.x, y: point.y - p0.y });
      return { x: p0.x + v.x, y: p0.y + v.y };
    };
    const gapAt = (index: number): number =>
      inward * standsOff(outerLine, drawnIn(innerPoints[index]));
    // The tapered corner, where the end is as wide as it now is: the end of
    // the first piece listed, which is the one at the end, or its start.
    const corner = atEnd ? TAPER_SAMPLES : 0;
    // A chain is whole pieces of TAPER_SAMPLES + 1 points each, so the corner is always one of
    // them; were it not, no gap could be held against it, as none was before.
    const left = corner < innerPoints.length ? gapAt(corner) : Number.NaN;
    // Pinched at the first point that comes too near, without measuring the rest.
    for (let index = 0; index < innerPoints.length; index++) {
      const gap = index === corner ? left : gapAt(index);
      if (gap < Math.min(was[index], left) * TAPER_PINCH) return true;
    }
    // And the inner side, drawn in, against the outer one and the end across
    // from the outer corner to the inner one.
    const inside = innerLine.map(drawnIn);
    const tip = atEnd ? inside[inside.length - 1] : inside[0];
    return crossing(inside, atEnd ? [...outerLine, tip] : [tip, ...outerLine]);
  };
  if (pinches(by)) {
    let low = 0;
    let high = by;
    for (let step = 0; step < TAPER_HALVINGS; step++) {
      const middle = (low + high) / 2;
      if (pinches(middle)) high = middle;
      else low = middle;
    }
    by = low;
    if (by <= 0) return;
  }
  const map = mapFor(by);
  for (const index of chain) inner[index] = carried(inner[index] as OffsetEllipse, p0, map);
  const last = inner[chain[0]] as OffsetEllipse;
  const tip = atEnd ? ellipseAt(last, last.to) : ellipseAt(last, last.from);
  for (const index of beyond) inner[index] = standingOn(inner[index], tip);
}

/**
 * An ellipse piece carried by the linear map `map` about `about`, written as
 * an ellipse piece again: the map of its centre, and its axes and parametric
 * angles from the map of its two half-axes, split into a turn, two radii and a
 * turn (a two-by-two singular value decomposition). The same parametric steps
 * as before, so the same nodes, each where the map puts the old one. Only for
 * a map and a piece that keep their handedness, which is every one `tapered`
 * makes; its pieces pinned to what they were.
 */
function carried(piece: OffsetEllipse, about: Vec2, map: (v: Vec2) => Vec2): OffsetEllipse {
  const c = Math.cos(piece.rotation);
  const s = Math.sin(piece.rotation);
  // The columns: where the map takes the two half-axes.
  const u = map({ x: c * piece.rx, y: s * piece.rx });
  const v = map({ x: -s * piece.ry, y: c * piece.ry });
  const e = (u.x + v.y) / 2;
  const f = (u.x - v.y) / 2;
  const g = (u.y + v.x) / 2;
  const h = (u.y - v.x) / 2;
  const q = Math.hypot(e, h);
  const r = Math.hypot(f, g);
  const a1 = Math.atan2(g, f);
  const a2 = Math.atan2(h, e);
  const turn = (a2 + a1) / 2;
  const shift = (a2 - a1) / 2;
  const centre = map({ x: piece.centre.x - about.x, y: piece.centre.y - about.y });
  return {
    ...piece,
    centre: { x: about.x + centre.x, y: about.y + centre.y },
    rx: q + r,
    ry: q - r,
    rotation: turn,
    from: piece.from + shift,
    to: piece.to + shift,
    pieces: piece.pieces ?? piecesFor(piece.to - piece.from),
  };
}

/*
 * Softened corners.
 */

/** One corner to round: where it is, which edge is the side, and by how much. */
interface Corner {
  /** The corner's node in the joined outline. */
  at: number;
  /** Whether the side arrives at the corner (and the cut leaves it), or the other way. */
  sideFirst: boolean;
  /** How far along the side, and along the cut, the rounding reaches. */
  side: number;
  cut: number;
  /** How many of the side's edges the rounding may run back over, at most. */
  walk: number;
}

/**
 * A side of the joined outline, from one node on to another: how many edges
 * it is and how long, along them.
 */
function sideFrom(nodes: GlyphNode[], from: number, to: number): { edges: number; length: number } {
  const count = nodes.length;
  const edges = (to - from + count) % count;
  let length = 0;
  for (let step = 0; step < edges; step++) {
    const index = (from + step) % count;
    length += edgeLength(nodes[index], nodes[(index + 1) % count]);
  }
  return { edges, length };
}

/**
 * The corners an outline's ends ask to have rounded, from where the sweep
 * says its four runs landed: the left side, the far end, the right side, the
 * near end. The outline runs up the left side, across the far end from its
 * left corner to its right, back down the right side and across the near end
 * from the right to the left -- so the far end's left corner and the near
 * end's right corner are each arrived at along a side, and the other two each
 * leave along one.
 *
 * Each reaches `soft` along the cut and along the side, never more than 0.49
 * of the cut, so the two corners of one end cannot meet, nor more than 0.45 of
 * the side, so neither can the corners at its two ends.
 */
function cornersOf(nodes: GlyphNode[], marks: SeamMark[], stroke: Stroke): Corner[] {
  if (marks.length < 4) return [];
  const [, endRun, , startRun] = marks;
  if (endRun.first < 0 || startRun.first < 0) return [];
  /*
   * Each side runs from one end's corner to the other's: the left from the
   * near end's left corner up to the far end's, the right from the far end's
   * right corner back down to the near end's. Asked of the ends, not of the
   * sides' own runs, which a stroke of one straight piece cut level at both
   * ends has none of -- both of a side's nodes are the cuts' slid corners.
   */
  const left = sideFrom(nodes, startRun.last, endRun.first);
  const right = sideFrom(nodes, endRun.last, startRun.first);
  const corners: Corner[] = [];
  const add = (soft: Terminal["soft"], run: SeamMark, leftAt: number, rightAt: number) => {
    if (!soft || run.first < 0 || run.first === run.last) return;
    const one = nodes[run.first].point;
    const other = nodes[run.last].point;
    const across = Math.hypot(one.x - other.x, one.y - other.y);
    for (const [radius, at, side] of [
      [soft.left, leftAt, left],
      [soft.right, rightAt, right],
    ] as const) {
      // A corner asked for no rounding at all is left as it is: nought is no finish.
      if (radius === undefined || !(radius > 0)) continue;
      const reach = Math.min(Math.max(0, radius), 0.49 * across);
      corners.push({
        at,
        // The side arrives at the corner the end's own run begins with.
        sideFirst: at === run.first,
        side: Math.min(reach, 0.45 * side.length),
        cut: reach,
        walk: side.edges,
      });
    }
  };
  // The far end runs from its left corner to its right; the near end from its right to its left.
  add(stroke.end.soft, endRun, endRun.first, endRun.last);
  add(stroke.start.soft, startRun, startRun.last, startRun.first);
  return corners;
}

const reversedNodes = (nodes: GlyphNode[]): GlyphNode[] =>
  [...nodes]
    .reverse()
    .map((node) => ({ ...node, handleIn: node.handleOut, handleOut: node.handleIn }));

/**
 * One corner rounded, the side arriving at it: node `corner` becomes A, back
 * along the side, and B, on along the cut, joined by a curve whose handles lie
 * along the two edges, `kappa` of the way each gave -- a circular arc where
 * the two are straight and the lengths equal, as `roundNodeCorner` draws one.
 *
 * A is measured back along the side however many of its edges that takes. A
 * side ends on whatever its pieces leave over -- the last sliver of a c's oval,
 * of no length at one weight and of a few units at the next, or a stall -- and
 * rounded along only the edge next to the corner, a sliver cut the corner
 * short on the side and left it lopsided. So every node the rounding runs back
 * over stands on A with the corner, its handles drawn in onto it, still
 * there and with the same handles present, so the same nodes and the same
 * edges, of no length; the edge A falls on is cut there and keeps its kind.
 * One node more, always.
 */
function roundArriving(
  nodes: GlyphNode[],
  corner: number,
  walk: number,
  side: number,
  cut: number,
  winding: number,
) {
  const count = nodes.length;
  const at = (index: number) => ((index % count) + count) % count;
  const out = [...nodes];
  const after = at(corner + 1);

  /*
   * Only a corner the outline turns outward at is rounded, and less the
   * nearer it comes to running straight on: a corner turned the other way is
   * a notch, and rounded it is a loop -- a heavy, narrow vee whose inner sides
   * cross above its top, the cut's inner corners arrived at from above.
   * Eased to nothing over the last thirty degrees rather than refused, so the
   * corner keeps its node either way and moves without a jump. The side's
   * direction is its first edge back with any length.
   */
  let real = corner;
  for (let steps = 0; steps < walk; steps++) {
    if (edgeLength(out[at(real - 1)], out[at(real)]) > 1e-6) break;
    real--;
  }
  const inWay = tangentAt(out[at(real - 1)], out[at(real)], 1);
  const outWay = tangentAt(out[corner], out[after], 0);
  const turn = Math.atan2(
    inWay.x * outWay.y - inWay.y * outWay.x,
    inWay.x * outWay.x + inWay.y * outWay.y,
  );
  const outward = Math.min(1, Math.max(0, (turn * winding) / (Math.PI / 6)));

  // Back along the side, edge by edge, to the one A falls on.
  let remaining = side * outward;
  let back = 0;
  let reached = 0;
  let first = corner;
  for (let steps = 0; steps < Math.max(1, walk); steps++) {
    const length = edgeLength(out[at(first - 1)], out[at(first)]);
    if (length >= remaining || steps >= walk - 1) {
      back = Math.min(remaining, length);
      reached += back;
      break;
    }
    remaining -= length;
    reached += length;
    first--;
  }
  const from = at(first - 1);
  const to = at(first);
  const arriving = edgeLength(out[from], out[to]);
  const into = splitEdgeAtLength(out[from], out[to], arriving - back);
  const leaving = edgeLength(out[corner], out[after]);
  const on = Math.min(cut * outward, leaving);
  const outOf = splitEdgeAtLength(out[corner], out[after], on);

  const firstOf = (...ways: Vec2[]): Vec2 =>
    ways.find((one) => one.x !== 0 || one.y !== 0) ?? ways[0];
  const tA = firstOf(
    tangentAt(into.from, into.at, 1),
    tangentAt(into.at, into.to, 0),
    tangentAt(out[from], out[to], 1),
  );
  const tB = firstOf(
    tangentAt(outOf.at, outOf.to, 0),
    tangentAt(outOf.from, outOf.at, 1),
    tangentAt(out[corner], out[after], 0),
  );
  const k = kappa(Math.atan2(tA.x * tB.y - tA.y * tB.x, tA.x * tB.x + tA.y * tB.y));

  const a = into.at.point;
  const b = outOf.at.point;
  const onA = (handle: Vec2 | null): Vec2 | null => handle && { x: a.x, y: a.y };
  const cornerNode = out[corner];
  out[from] = { ...out[from], handleOut: into.from.handleOut };
  // The nodes run back over, stood on A.
  for (let index = first; index < corner; index++) {
    const node = out[at(index)];
    out[at(index)] = {
      ...node,
      point: { x: a.x, y: a.y },
      handleIn: index === first ? into.at.handleIn : onA(node.handleIn),
      handleOut: onA(node.handleOut),
    };
  }
  const rounded: GlyphNode[] = [
    {
      point: a,
      handleIn: first === corner ? into.at.handleIn : onA(cornerNode.handleIn),
      handleOut: { x: a.x + tA.x * k * reached, y: a.y + tA.y * k * reached },
      type: "smooth",
    },
    {
      point: b,
      handleIn: { x: b.x - tB.x * k * on, y: b.y - tB.y * k * on },
      handleOut: outOf.at.handleOut,
      type: "smooth",
    },
  ];
  out[after] = { ...out[after], handleIn: outOf.to.handleIn };
  out.splice(corner, 1, ...rounded);
  return out;
}

/**
 * The joined outline begun at the near end's left corner, where the left side
 * starts, and the marks moved round with it.
 *
 * Which is where `joinedAtSeams` begins it whenever the near end's last corner
 * is welded onto the left side's first node, as on most strokes. But a left
 * side that is nothing but the far end's corner -- one straight piece whose
 * cut slides its corners along it -- leaves the near end's corner standing at
 * the back, and the outline begins at the far end; and a flag can be cut so at
 * one width and not at the next. A run of straight edges looks the same from
 * either corner, so nothing shows it until a corner is rounded and one edge of
 * the four is a curve: the figure one's flag on a grotesque was drawn from one
 * corner at one width and from the next corner round at another, and its
 * nodes no longer matched.
 */
function fromNearCorner(
  nodes: GlyphNode[],
  marks: SeamMark[],
): { nodes: GlyphNode[]; seams: SeamMark[] } {
  const count = nodes.length;
  const start = marks.length >= 4 ? marks[3].last : -1;
  if (!(start > 0) || start >= count) return { nodes, seams: marks };
  const moved = (index: number) => (index < 0 ? index : (index - start + count) % count);
  return {
    nodes: [...nodes.slice(start), ...nodes.slice(0, start)],
    seams: marks.map((mark) => ({ first: moved(mark.first), last: moved(mark.last) })),
  };
}

/**
 * The joined outline of a stroke with the corners its ends ask for (`soft`)
 * rounded, found by `marks` -- where `joinedAtSeams` put each of the four
 * runs: the left side, the far end, the right side, the near end -- and begun
 * at the near end's left corner (see `fromNearCorner`).
 *
 * Each corner adds exactly one node, with a curve where the corner was, even
 * rounded by nothing; see `cornersOf` for how far each reaches. Rounded from
 * the last in the outline to the first, so each one's place is where the
 * marks said; a corner the side leaves is rounded on the outline walked
 * backwards, where the side arrives at it.
 */
export function softCorners(given: GlyphNode[], marks: SeamMark[], stroke: Stroke): GlyphNode[] {
  const { nodes, seams } = fromNearCorner(given, marks);
  const corners = cornersOf(nodes, seams, stroke);
  if (corners.length === 0) return given;
  corners.sort((one, other) => other.at - one.at);
  // Which way the outline runs round, by its area: its corners turn that way.
  const area = flattenedArea({ nodes, closed: true });
  const winding = area < 0 ? -1 : 1;
  let out = nodes;
  for (const corner of corners) {
    if (corner.sideFirst) {
      out = roundArriving(out, corner.at, corner.walk, corner.side, corner.cut, winding);
    } else {
      const backwards = reversedNodes(out);
      const at = out.length - 1 - corner.at;
      out = reversedNodes(
        roundArriving(backwards, at, corner.walk, corner.side, corner.cut, -winding),
      );
    }
  }
  return out;
}
