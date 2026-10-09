/**
 * Inside roundings: where a stroke leaves another it is buried in, and on the
 * inside of a corner one stroke turns.
 *
 * Asked for by `parts.corner.fillet`, which no base sets, through the hint a
 * recipe puts on a buried end (`Terminal.fillet`) only while that field is
 * on. A letter of any existing face never reaches anything here.
 *
 * A crossing with no buried end (`Stroke.crossFillets`: a p's bowl against
 * its stem) is not rounded yet. The crotch there is not one corner across the
 * family -- at a heavy pen on a narrow width the bowl's outside passes the
 * stem's head and the notch is gone, on a light wide one it leaves the stem
 * nearly flat -- so a rounding found there was the rounding of a different
 * corner, or none, from one master to the next. Left to the letter's own
 * skeleton, where a branch can name its crotch the way a buried end does.
 *
 * A join between two strokes is rounded by an overlapping contour of its own,
 * as a serif is, never by cutting into either outline: the outlines of a
 * variable font are not unioned, so a rounding has to be ink laid over the
 * corner. Each rounding is three nodes -- two where the arc touches the two
 * edges, joined by that arc, and a third tucked into the ink behind the corner
 * -- and which of those comes first is settled by which end and which side
 * the recipe named, so it is the same contour at every weight however far the
 * pen moves it. Where the corner cannot be found, a sliver of the same three
 * nodes stands buried in the ink instead (see `sliver`).
 */

import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import {
  edgeLength,
  type Flat,
  flatten,
  kappa,
  lineIntersection,
  splitEdgeAtLength,
  tangentAt,
  windingAt,
} from "./soft";
import type { Style } from "./style";
import { leftOf, type PenReach, penReach, reachAlong, segmentEnd, segmentStart } from "./sweep";
import type { SpineSegment, Stroke, Terminal } from "./types";

/**
 * The rounding contours one stroke adds where its hinted ends leave the
 * strokes around it (`others`, already swept), each its own overlapping
 * contour in the stroke's own run, as a serif is.
 *
 * One for every side a buried end names in its `fillet`, at a radius of the
 * style's `corner.fillet` in stems -- times the face's pen weight -- times the
 * share the hint gives it. `_swept`, the stroke's own outline, is not needed
 * for that; a crossing it names is not rounded (see above).
 */
export function filletsFor(
  stroke: Stroke,
  style: Style,
  _swept: Contour[],
  others: Contour[],
): Contour[] {
  const fillet = style.parts.corner.fillet ?? 0;
  if (!(fillet > 0)) return [];
  const radius = fillet * style.pen.weight;
  const out: Contour[] = [];
  let flat: Hosts | null = null;
  const hosts = (): Hosts => {
    flat ??= hostsOf(others);
    return flat;
  };
  if (!stroke.spine.closed && stroke.spine.segments.length > 0) {
    for (const [terminal, atEnd] of [
      [stroke.start, false],
      [stroke.end, true],
    ] as const) {
      // Buried square, or cut along the stroke it is buried in (see `metHairline`).
      if ((terminal.kind !== "butt" && terminal.kind !== "angled") || !terminal.fillet) continue;
      for (const [key, sigma] of [
        ["left", 1],
        ["right", -1],
      ] as const) {
        const share = terminal.fillet[key];
        if (share === undefined) continue;
        out.push(endFillet(stroke, terminal, hosts(), atEnd, sigma, radius * share));
      }
    }
  }
  return out;
}

/**
 * A stroke told how far the inside of its own corners is rounded
 * (`Stroke.inside`), where `parts.corner.fillet` is above nought: that many of
 * its own pen's weight, every stroke alike. Off, the very stroke it was given.
 */
export function withInside(stroke: Stroke, style: Style): Stroke {
  const fillet = style.parts.corner.fillet ?? 0;
  if (!(fillet > 0)) return stroke;
  return { ...stroke, inside: fillet };
}

// ---------------------------------------------------------------------------
// The other strokes, as somewhere to be inside of and edges to meet
// ---------------------------------------------------------------------------

/** The other strokes' outlines, flattened for asking what is inside, with each chord's edge kept. */
interface Hosts {
  contours: Contour[];
  flat: Flat;
  /** For every polygon point of `flat`, the edge it lies on and how far along it. */
  marks: Array<Array<{ edge: number; t: number }>>;
}

/** How many chords a curved edge is flattened into: as `flatten` does. */
const CHORDS = 12;

function hostsOf(contours: Contour[]): Hosts {
  const flat = flatten(contours, CHORDS);
  const marks: Hosts["marks"] = [];
  for (const contour of contours) {
    const { nodes } = contour;
    if (nodes.length === 0) continue;
    const mark: Array<{ edge: number; t: number }> = [];
    const edges = contour.closed ? nodes.length : nodes.length - 1;
    for (let edge = 0; edge < edges; edge++) {
      const from = nodes[edge];
      const to = nodes[(edge + 1) % nodes.length];
      mark.push({ edge, t: 0 });
      if (from.handleOut === null && to.handleIn === null) continue;
      for (let step = 1; step < CHORDS; step++) mark.push({ edge, t: step / CHORDS });
    }
    if (!contour.closed) mark.push({ edge: nodes.length - 2, t: 1 });
    marks.push(mark);
  }
  return { contours: contours.filter((one) => one.nodes.length > 0), flat, marks };
}

/** An edge of one of the other strokes' outlines, and a place on it. */
interface HostAt {
  contour: number;
  edge: number;
  t: number;
}

/**
 * The edge of the other strokes nearest a point, and about where on it: the
 * chord of the flattened outline closest to it. Only polygons whose box,
 * grown by a little, holds the point are looked at.
 */
function nearestHost(hosts: Hosts, point: Vec2): HostAt | null {
  let best: HostAt | null = null;
  let bestDistance = Infinity;
  const grow = 2;
  hosts.flat.polygons.forEach((polygon, index) => {
    if (
      point.x < polygon.xMin - grow ||
      point.x > polygon.xMax + grow ||
      point.y < polygon.yMin - grow ||
      point.y > polygon.yMax + grow
    ) {
      return;
    }
    const { points } = polygon;
    const mark = hosts.marks[index];
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      const d = { x: b.x - a.x, y: b.y - a.y };
      const length2 = d.x * d.x + d.y * d.y;
      const s =
        length2 > 0
          ? Math.min(1, Math.max(0, ((point.x - a.x) * d.x + (point.y - a.y) * d.y) / length2))
          : 0;
      const distance = Math.hypot(point.x - (a.x + d.x * s), point.y - (a.y + d.y * s));
      if (distance < bestDistance) {
        bestDistance = distance;
        const here = mark[k];
        const next = mark[(k + 1) % points.length];
        // The chord's far end is the next edge's start where it closes an edge.
        const tEnd = next.edge === here.edge ? next.t : 1;
        best = { contour: index, edge: here.edge, t: here.t + (tEnd - here.t) * s };
      }
    }
  });
  return best;
}

/** The two nodes either side of a host edge. */
function hostEdge(hosts: Hosts, at: HostAt): [GlyphNode, GlyphNode] {
  const { nodes } = hosts.contours[at.contour];
  return [nodes[at.edge], nodes[(at.edge + 1) % nodes.length]];
}

// ---------------------------------------------------------------------------
// Cubic edges, read as the rest of the application reads them
// ---------------------------------------------------------------------------

type Cubic = [Vec2, Vec2, Vec2, Vec2];

const isLine = (from: GlyphNode, to: GlyphNode): boolean =>
  from.handleOut === null && to.handleIn === null;

function cubicOf(from: GlyphNode, to: GlyphNode): Cubic {
  return [from.point, from.handleOut ?? from.point, to.handleIn ?? to.point, to.point];
}

const mix = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

function bezierAt(edge: [GlyphNode, GlyphNode], t: number): Vec2 {
  const [from, to] = edge;
  if (isLine(from, to)) return mix(from.point, to.point, t);
  const [p0, p1, p2, p3] = cubicOf(from, to);
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** The first and second derivatives of an edge at `t`. */
function bezierSlopes(edge: [GlyphNode, GlyphNode], t: number): { d1: Vec2; d2: Vec2 } {
  const [from, to] = edge;
  if (isLine(from, to)) {
    return {
      d1: { x: to.point.x - from.point.x, y: to.point.y - from.point.y },
      d2: { x: 0, y: 0 },
    };
  }
  const [p0, p1, p2, p3] = cubicOf(from, to);
  const u = 1 - t;
  return {
    d1: {
      x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
      y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
    },
    d2: {
      x: 6 * u * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x),
      y: 6 * u * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y),
    },
  };
}

/**
 * The part of an edge from `t` on, walked forward (`way` +1) toward its end
 * node or back (`way` -1) toward its start node, as an edge of its own that
 * starts at `t`. A line stays a line.
 */
function edgeFrom(edge: [GlyphNode, GlyphNode], t: number, way: number): [GlyphNode, GlyphNode] {
  const [from, to] = edge;
  const point = bezierAt(edge, t);
  const node = (at: Vec2, handleIn: Vec2 | null, handleOut: Vec2 | null): GlyphNode => ({
    point: at,
    handleIn,
    handleOut,
    type: "corner",
  });
  if (isLine(from, to)) {
    return way > 0
      ? [node(point, null, null), node(to.point, null, null)]
      : [node(point, null, null), node(from.point, null, null)];
  }
  // De Casteljau at t.
  const [p0, p1, p2, p3] = cubicOf(from, to);
  const a = mix(p0, p1, t);
  const b = mix(p1, p2, t);
  const c = mix(p2, p3, t);
  const ab = mix(a, b, t);
  const bc = mix(b, c, t);
  return way > 0
    ? [node(point, null, bc), node(p3, c, null)]
    : [node(point, null, ab), node(p0, a, null)];
}

/** The unit tangent and the radius of curvature of an edge at `t`; the radius is infinite on a line. */
function edgeBend(edge: [GlyphNode, GlyphNode], t: number): { tangent: Vec2; radius: number } {
  const { d1, d2 } = bezierSlopes(edge, t);
  const speed = Math.hypot(d1.x, d1.y);
  const tangent =
    speed > 1e-12 ? { x: d1.x / speed, y: d1.y / speed } : tangentAt(edge[0], edge[1], t);
  const cross = Math.abs(d1.x * d2.y - d1.y * d2.x);
  return { tangent, radius: cross > 1e-12 ? (speed * speed * speed) / cross : Infinity };
}

// ---------------------------------------------------------------------------
// One side of a stroke, walked in from a buried end
// ---------------------------------------------------------------------------

/** One spine piece of the walk in from a buried end. */
interface Leg {
  segment: SpineSegment;
  /** How far into the walk it starts, and how long it is. */
  start: number;
  length: number;
  /** Walked against the way the stroke travels: in from its far end. */
  backward: boolean;
}

/**
 * One side's edge of a stroke, walked in from one end: where it is `u` along,
 * the way it is going there (inward), how it bends, and the way the stroke
 * itself travels there.
 *
 * The side is the spine moved by the pen's reach across the stroke's own
 * heading -- the same expression the sweep offsets a piece by, so on a line it
 * is that line moved over, and on an arc the same ellipse about the same
 * centre the sweep draws. Walked on through the spine's pieces for as long as
 * each runs on from the last in the same direction; the first corner ends it.
 */
interface Side {
  /** How long the walk is. */
  length: number;
  at(u: number): SidePoint;
}

interface SidePoint {
  point: Vec2;
  /** The unit direction the side runs inward, and its first and second derivatives by walked length. */
  inward: Vec2;
  d1: Vec2;
  d2: Vec2;
  /** The way the stroke travels here, whichever end it was walked in from. */
  heading: Vec2;
}

function lengthOfSegment(segment: SpineSegment): number {
  if (segment.kind === "line") {
    return Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
  }
  return segment.radius * Math.abs(segment.endAngle - segment.startAngle);
}

/** Whether the first piece that goes anywhere, walked in from one end, is straight. */
function straightFrom(stroke: Stroke, atEnd: boolean): boolean {
  const segments = atEnd ? [...stroke.spine.segments].reverse() : stroke.spine.segments;
  const first = segments.find((segment) => lengthOfSegment(segment) >= 1e-9);
  return first?.kind === "line";
}

/** The way a spine piece travels where it starts and where it ends. */
function headings(segment: SpineSegment): { start: Vec2; end: Vec2 } {
  if (segment.kind === "line") {
    const d = { x: segment.to.x - segment.from.x, y: segment.to.y - segment.from.y };
    const length = Math.hypot(d.x, d.y) || 1;
    const unit = { x: d.x / length, y: d.y / length };
    return { start: unit, end: unit };
  }
  const way = segment.sweepPositive ? 1 : -1;
  const at = (angle: number): Vec2 => ({ x: -Math.sin(angle) * way, y: Math.cos(angle) * way });
  return { start: at(segment.startAngle), end: at(segment.endAngle) };
}

/** Whether two unit directions are the same, near enough for a run that does not turn. */
const sameWay = (a: Vec2, b: Vec2): boolean =>
  Math.abs(a.x * b.y - a.y * b.x) < 1e-6 && a.x * b.x + a.y * b.y > 0;

function sideOf(stroke: Stroke, atEnd: boolean, sigma: number, reach: PenReach): Side {
  const segments = atEnd ? [...stroke.spine.segments].reverse() : stroke.spine.segments;
  const legs: Leg[] = [];
  let walked = 0;
  let last: Vec2 | null = null;
  for (const segment of segments) {
    const length = lengthOfSegment(segment);
    if (length < 1e-9) continue;
    const ways = headings(segment);
    // Inward: the way the walk enters this piece, and the way it leaves it.
    const enters = atEnd ? { x: -ways.end.x, y: -ways.end.y } : ways.start;
    const leaves = atEnd ? { x: -ways.start.x, y: -ways.start.y } : ways.end;
    if (last && !sameWay(last, enters)) break;
    legs.push({ segment, start: walked, length, backward: atEnd });
    walked += length;
    last = leaves;
  }
  const length = walked;
  const shift = (direction: Vec2): Vec2 => reachAlong(direction, reach);
  return {
    length,
    at(u: number): SidePoint {
      if (legs.length === 0) {
        const zero = { x: 0, y: 0 };
        return { point: zero, inward: { x: 1, y: 0 }, d1: zero, d2: zero, heading: { x: 1, y: 0 } };
      }
      // Before the end only along a straight first piece, carried on as the line it is.
      const clamped = Math.min(Math.max(u, legs[0].segment.kind === "line" ? -length : 0), length);
      let leg = legs[legs.length - 1];
      for (const one of legs) {
        if (clamped <= one.start + one.length) {
          leg = one;
          break;
        }
      }
      // How far along the piece in the way the stroke travels.
      const into = clamped - leg.start;
      const along = leg.backward ? leg.length - into : into;
      const toward = leg.backward ? -1 : 1;
      const { segment } = leg;
      if (segment.kind === "line") {
        const d = {
          x: (segment.to.x - segment.from.x) / leg.length,
          y: (segment.to.y - segment.from.y) / leg.length,
        };
        const off = shift(leftOf(d));
        const inward = { x: d.x * toward, y: d.y * toward };
        return {
          point: {
            x: segment.from.x + d.x * along + off.x * sigma,
            y: segment.from.y + d.y * along + off.y * sigma,
          },
          inward,
          d1: inward,
          d2: { x: 0, y: 0 },
          heading: d,
        };
      }
      /*
       * On an arc: the spine is centre + R·e(θ), its left is −way·e(θ), and
       * the side is that moved by the pen's reach -- a linear map of e(θ), so
       * its derivatives are the same map of e's.
       */
      const way = segment.sweepPositive ? 1 : -1;
      const share = along / leg.length;
      const angle = segment.startAngle + (segment.endAngle - segment.startAngle) * share;
      const e = { x: Math.cos(angle), y: Math.sin(angle) };
      const de = { x: -Math.sin(angle), y: Math.cos(angle) };
      const R = segment.radius;
      const pull = shift(e);
      const pullD = shift(de);
      // θ against walked length: the arc's own turning, walked either way.
      const omega = ((segment.endAngle - segment.startAngle) / leg.length) * toward;
      const point = {
        x: segment.centre.x + R * e.x - sigma * way * pull.x,
        y: segment.centre.y + R * e.y - sigma * way * pull.y,
      };
      const d1 = {
        x: omega * (R * de.x - sigma * way * pullD.x),
        y: omega * (R * de.y - sigma * way * pullD.y),
      };
      const d2 = {
        x: omega * omega * (-R * e.x + sigma * way * pull.x),
        y: omega * omega * (-R * e.y + sigma * way * pull.y),
      };
      const speed = Math.hypot(d1.x, d1.y);
      const heading = { x: de.x * way, y: de.y * way };
      return {
        point,
        inward:
          speed > 1e-12
            ? { x: d1.x / speed, y: d1.y / speed }
            : { x: heading.x * toward, y: heading.y * toward },
        d1,
        d2,
        heading,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The rounding
// ---------------------------------------------------------------------------

/** How many samples the walk in from a buried end is first tested at, and how many halvings refine it. */
const SAMPLES = 33;
const HALVINGS = 40;
/** How many Newton steps snap a found corner onto the host's own edge. */
const SNAPS = 8;
/** How far inside its own edge a side is tested, so an edge lying along a host's counts as in it. */
const NUDGE = 0.01;
/** The widest corner rounded: past this the two edges very nearly run on, and a sliver stands in. */
const FLATTEST = (175 * Math.PI) / 180;
/** The legs of the sliver that stands in where no corner is found, in font units. */
const SLIVER = 2.5;

/**
 * The rounding of one side of a buried end, where that side's edge comes out
 * of the other strokes.
 *
 * Walked in from the end along the side's edge, the first place it passes
 * from inside the other strokes to outside is the corner, X; the edge of the
 * other stroke it crosses there is the host. The arc touches the side a
 * tangent length L on from X and the host L along from X, away from the
 * stroke, with L the length a circle of `radius` takes in a corner of that
 * angle -- held to under half of what either edge has to give, and to what
 * keeps a curved host within an eighth of a unit of the chord laid over it.
 */
function endFillet(
  stroke: Stroke,
  terminal: Terminal,
  hosts: Hosts,
  atEnd: boolean,
  sigma: number,
  radius: number,
): Contour {
  const reach = penReach(stroke.pen);
  const side = sideOf(stroke, atEnd, sigma, reach);
  /*
   * Where the side's own corner is. A square end's is on the spine's end; a
   * cut along the stroke it is buried in slides each corner along its side by
   * as much as the sweep slides it (see `terminalNodes`): the left of the
   * end's outward heading on, the right back.
   */
  const leftOfEnd = atEnd ? sigma > 0 : sigma < 0;
  const firstStraight = straightFrom(stroke, atEnd);
  const slide =
    terminal.kind === "angled" && terminal.angle && firstStraight
      ? Math.tan((terminal.angle * Math.PI) / 180) * reach.across
      : 0;
  const from = Math.min(leftOfEnd ? -slide : slide, side.length);
  // The side named against the walk inward rather than the way the stroke travels.
  const turning = atEnd ? -sigma : sigma;
  // The spine's own end, buried in the host, for the sliver that stands in where nothing is found.
  const { segments } = stroke.spine;
  const buriedAt = atEnd ? segmentEnd(segments[segments.length - 1]) : segmentStart(segments[0]);
  const fallback = (): Contour => sliver(buriedAt, side.at(0).inward, turning);
  if (side.length < 1e-6) return fallback();

  // Tested a hair inside the side, toward the stroke's own middle.
  const tested = (u: number): Vec2 => {
    const here = side.at(u);
    const n = leftOf(here.heading);
    return { x: here.point.x - n.x * sigma * NUDGE, y: here.point.y - n.y * sigma * NUDGE };
  };
  const inside = (u: number): boolean => windingAt(hosts.flat, tested(u)) !== 0;

  /*
   * Sampled closer together near the end, where the host is: a hairline bar
   * a dozen units deep under a stem seven hundred long fell between two
   * evenly spaced samples and was never seen.
   */
  const sampleAt = (k: number): number => from + (side.length - from) * (k / (SAMPLES - 1)) ** 2;
  let low = -1;
  let high = -1;
  let was = inside(sampleAt(0));
  for (let k = 1; k < SAMPLES; k++) {
    const u = sampleAt(k);
    const now = inside(u);
    if (was && !now) {
      low = sampleAt(k - 1);
      high = u;
      break;
    }
    was = now;
  }
  if (high < 0) return fallback();
  let lo = low;
  let hi = high;
  for (let step = 0; step < HALVINGS; step++) {
    const middle = (lo + hi) / 2;
    if (inside(middle)) lo = middle;
    else hi = middle;
  }
  const guess = (lo + hi) / 2;
  const host = nearestHost(hosts, side.at(guess).point);
  if (!host) return fallback();
  const edge = hostEdge(hosts, host);

  // Snapped onto where the side truly crosses the host's edge.
  let u = guess;
  let t = host.t;
  for (let step = 0; step < SNAPS; step++) {
    const s = side.at(u);
    const b = bezierAt(edge, t);
    const { d1: db } = bezierSlopes(edge, t);
    const f = { x: s.point.x - b.x, y: s.point.y - b.y };
    // Solve [s.d1, −db]·(du, dt) = −f.
    const det = s.d1.x * -db.y - -db.x * s.d1.y;
    if (Math.abs(det) < 1e-12) break;
    const du = (-f.x * -db.y - -db.x * -f.y) / det;
    const dt = (s.d1.x * -f.y - -f.x * s.d1.y) / det;
    u = Math.min(Math.max(u + du, from), side.length);
    t = Math.min(Math.max(t + dt, 0), 1);
  }
  const snapped = side.at(u);
  const miss = Math.hypot(
    snapped.point.x - bezierAt(edge, t).x,
    snapped.point.y - bezierAt(edge, t).y,
  );
  if (!(miss < 1e-3)) {
    u = guess;
    t = host.t;
  }
  const arriving = side.at(u);
  const corner = arriving.point;

  /*
   * The host's tangent at the corner, turned away from the stroke on this
   * side: out across the side's own edge, square to the way that edge runs
   * there. Not square to the stroke's heading -- under a pen with contrast
   * held at an angle the edge of a curve runs several degrees off the
   * heading, and a host lying along the edge then had its way picked by a
   * hair, into the stroke's own ink.
   */
  const tA = arriving.inward;
  const away = leftOf(arriving.heading);
  const across = leftOf(tA);
  const outward = { x: across.x * turning, y: across.y * turning };
  const bend = edgeBend(edge, t);
  const hostWay = bend.tangent.x * outward.x + bend.tangent.y * outward.y >= 0 ? 1 : -1;
  const tH = { x: bend.tangent.x * hostWay, y: bend.tangent.y * hostWay };
  const alpha = Math.acos(Math.min(1, Math.max(-1, tA.x * tH.x + tA.y * tH.y)));
  if (!(alpha < FLATTEST) || alpha < 1e-6) return fallback();

  // How much room each edge gives.
  const along = edgeFrom(edge, t, hostWay);
  const hostRoom = edgeLength(along[0], along[1]);
  let most = Math.min(0.45 * (side.length - u), 0.45 * hostRoom);
  if (Number.isFinite(bend.radius)) most = Math.min(most, Math.sqrt(bend.radius));
  // A side bending round the hollow lays its chord outside itself: held as the host is.
  const sideBend = curvature(arriving);
  if (
    sideBend.radius < Infinity &&
    sideBend.toward.x * outward.x + sideBend.toward.y * outward.y > 0
  ) {
    most = Math.min(most, Math.sqrt(sideBend.radius));
  }
  const wanted = radius / Math.tan(alpha / 2);
  const most0 = Math.max(0.05, Math.min(Math.max(wanted, 0.5), most));

  const place = (length: number): Touching => {
    const onSide = side.at(u + length);
    const split = splitEdgeAtLength(along[0], along[1], length);
    const hostTangent = tangentAt(split.at, split.to, 0);
    return {
      a: onSide.point,
      ta: onSide.inward,
      h: split.at.point,
      th:
        hostTangent.x === 0 && hostTangent.y === 0 ? tangentAt(along[0], along[1], 1) : hostTangent,
    };
  };
  const { length: L, touching } = heldToCorner(place, corner, along[0].point, most0, alpha);
  const half = Math.hypot(...asPair(reachAlong(away, reach)));
  const bite = Math.min(4, 0.25 * half);
  return rounding(
    corner,
    touching.a,
    touching.ta,
    touching.h,
    touching.th,
    tA,
    tH,
    bite,
    turning,
    L,
  );
}

const asPair = (v: Vec2): [number, number] => [v.x, v.y];

/** Where an arc touches the two edges of a corner, and the way each edge runs on from there. */
interface Touching {
  /** On the arriving edge, and the way it runs on inward. */
  a: Vec2;
  ta: Vec2;
  /** On the host, and the way it runs on away from the corner. */
  h: Vec2;
  th: Vec2;
}

/** How many halvings bring a rounding in until both edges run near enough straight to it. */
const STRAIGHTENINGS = 16;

/** The angle between two directions, either way round, in radians. */
const angleBetween = (one: Vec2, other: Vec2): number =>
  Math.atan2(Math.abs(one.x * other.y - one.y * other.x), one.x * other.x + one.y * other.y);

/**
 * How far along its two edges a rounding touches them: `most` (already held
 * to what each edge has room for), brought in until neither edge, between
 * the corner and where the arc touches it, bends away from the straight line
 * there by more than a quarter of the corner's narrower angle -- `alpha`, or
 * what it leaves of a half turn. `place` says where the arc touches the
 * arriving edge and the host that far along; `corner` is where the arriving
 * edge leaves the host, and `hostFrom` the same place on the host's own edge.
 *
 * The arc is laid between the two tangent lines where it touches, so it is
 * only the rounding of the corner while those lines still cross near it.
 * Between straight edges they cross on it, at any length. A curved edge turns
 * its tangent as it goes, and in a narrow corner a turn of a few degrees is
 * the whole of the angle: a script n's arch leaving its stem four degrees
 * apart, the Wavy's arm bending away just past the stem, had their tangent
 * lines crossing well behind the corner or not at all, and the arc swung out
 * over the edges it was meant to sit between. Held to a quarter, the lines
 * cross within about a tangent length of the corner, on its side of the arc.
 *
 * Nothing is moved where the length asked for already keeps to that; else
 * the longest that does is found by a fixed number of halvings, never less
 * than the twentieth of a unit every rounding keeps. A value, never a shape:
 * the rounding has the same three nodes however short it comes out.
 */
function heldToCorner(
  place: (length: number) => Touching,
  corner: Vec2,
  hostFrom: Vec2,
  most: number,
  alpha: number,
): { length: number; touching: Touching } {
  const limit = Math.min(alpha, Math.PI - alpha) / 4;
  const strays = (touching: Touching): boolean =>
    angleBetween({ x: touching.a.x - corner.x, y: touching.a.y - corner.y }, touching.ta) > limit ||
    angleBetween({ x: touching.h.x - hostFrom.x, y: touching.h.y - hostFrom.y }, touching.th) >
      limit;
  const first = place(most);
  if (!strays(first)) return { length: most, touching: first };
  let lo = 0;
  let hi = most;
  for (let step = 0; step < STRAIGHTENINGS; step++) {
    const middle = (lo + hi) / 2;
    if (strays(place(middle))) hi = middle;
    else lo = middle;
  }
  const length = Math.max(0.05, lo);
  return { length, touching: place(length) };
}

/** How a side bends at a point: its radius, and the way its centre of curvature lies. */
function curvature(point: SidePoint): { radius: number; toward: Vec2 } {
  const { d1, d2 } = point;
  const speed = Math.hypot(d1.x, d1.y);
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-12 || speed < 1e-12) return { radius: Infinity, toward: { x: 0, y: 0 } };
  const n = leftOf({ x: d1.x / speed, y: d1.y / speed });
  const sign = cross > 0 ? 1 : -1;
  return {
    radius: (speed * speed * speed) / Math.abs(cross),
    toward: { x: n.x * sign, y: n.y * sign },
  };
}

/**
 * The three nodes of a rounding: the arc from where it touches the arriving
 * edge (`a`, going on inward `ta`) to where it touches the host (`h`, going
 * on away `th`), and the node tucked into the ink behind the corner `x`,
 * at least `bite` back from it. Its handles point at where the two tangent
 * lines cross, kappa of the turn long, so between straight edges it is the
 * circle, and the tuck lies on past that crossing from the middle of the
 * chord, so the arc keeps inside its own contour (see below); where the
 * lines do not meet ahead of the corner the handles lie along the edges at
 * the length a quarter circle's would, and the tuck is `bite` back along the
 * hollow's middle.
 *
 * `turning` +1 (the hollow to the left of the walk inward) runs arriving
 * edge, host, tuck; -1 runs host, arriving edge, tuck. Either way the arc is
 * the curve and the two edges into the ink are lines, and the contour runs
 * anticlockwise.
 */
function rounding(
  x: Vec2,
  a: Vec2,
  ta: Vec2,
  h: Vec2,
  th: Vec2,
  tA: Vec2,
  tH: Vec2,
  bite: number,
  turning: number,
  L: number,
): Contour {
  const crossing = lineIntersection(a, ta, h, th);
  const turn = Math.acos(Math.min(1, Math.max(-1, -ta.x * th.x - ta.y * th.y)));
  const middle = { x: tA.x + tH.x, y: tA.y + tH.y };
  const length = Math.hypot(middle.x, middle.y) || 1;
  // A bite back from the corner along the hollow's middle, into the ink behind it.
  let tuck = { x: x.x - (middle.x / length) * bite, y: x.y - (middle.y / length) * bite };
  let handleA: Vec2;
  let handleH: Vec2;
  if (crossing && crossing.s < 0 && crossing.t < 0) {
    const k = kappa(turn);
    const meet = crossing.point;
    handleA = mix(a, meet, k);
    handleH = mix(h, meet, k);
    /*
     * And laid so the arc cannot leave the contour: on the line from the
     * middle of the chord through where the tangent lines meet, past that
     * meeting and at least the bite behind the corner. The handles lie on
     * the way from each end to that meeting, so the arc stays inside the
     * triangle of its two ends and the tuck, whatever the edges did, and the
     * contour can neither cross itself nor wind the other way. Between
     * straight edges the lines meet on the corner and this is the bite back
     * along the hollow's middle, as before.
     */
    const chord = { x: (a.x + h.x) / 2, y: (a.y + h.y) / 2 };
    const out = { x: meet.x - chord.x, y: meet.y - chord.y };
    const reach = Math.hypot(out.x, out.y);
    if (reach > 1e-9 && out.x * (x.x - chord.x) + out.y * (x.y - chord.y) > 0) {
      const way = { x: out.x / reach, y: out.y / reach };
      const past = Math.max(0.25 * bite, bite - ((meet.x - x.x) * way.x + (meet.y - x.y) * way.y));
      tuck = { x: meet.x + way.x * past, y: meet.y + way.y * past };
    }
  } else {
    const k = 0.5523 * L;
    handleA = { x: a.x - ta.x * k, y: a.y - ta.y * k };
    handleH = { x: h.x - th.x * k, y: h.y - th.y * k };
  }
  return threeNodes(a, handleA, h, handleH, tuck, turning);
}

/** The rounding's contour in the order `turning` names: see `rounding`. */
function threeNodes(
  a: Vec2,
  handleA: Vec2,
  h: Vec2,
  handleH: Vec2,
  tuck: Vec2,
  turning: number,
): Contour {
  const node = (point: Vec2, handleIn: Vec2 | null, handleOut: Vec2 | null): GlyphNode => ({
    point: { x: point.x, y: point.y },
    handleIn: handleIn && { x: handleIn.x, y: handleIn.y },
    handleOut: handleOut && { x: handleOut.x, y: handleOut.y },
    type: "corner",
  });
  const nodes =
    turning > 0
      ? [node(a, null, handleA), node(h, handleH, null), node(tuck, null, null)]
      : [node(h, null, handleH), node(a, handleA, null), node(tuck, null, null)];
  return { nodes, closed: true };
}

/**
 * The rounding that stands in where no corner was found: the same three
 * nodes in the same order, a small right-angled sliver buried at `at` with
 * legs `SLIVER` long, one inward and one across toward the side named, and
 * the curve between them a curve of no bulge -- handles on their own points.
 * About three square units, so it is still ink, and the letter has the same
 * contours with the same nodes as at a weight where the corner was found.
 */
function sliver(at: Vec2, inward: Vec2, turning: number): Contour {
  const across = leftOf(inward);
  const a = { x: at.x + inward.x * SLIVER, y: at.y + inward.y * SLIVER };
  const h = {
    x: at.x + across.x * turning * SLIVER,
    y: at.y + across.y * turning * SLIVER,
  };
  return threeNodes(a, a, h, h, at, turning);
}
